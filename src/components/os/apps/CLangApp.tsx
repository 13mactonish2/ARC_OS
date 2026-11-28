// REDSEC 5.x — C Compiler & C++ Compiler (Task 29).
// Two OS apps over one component: a native code editor wired to the REDSEC
// toolchain (gcc / g++ -std=c++20 via /api/code/run — compiles & runs on the
// server, no cloud account needed). stdin support, real compile-error surface,
// exit codes, examples, and Save-into-File-Manager.
'use client'

import React, { useCallback, useRef, useState } from 'react'
import { AppShell, Toolbar, TBtn } from './_shared'
import { useOS } from '@/lib/os/store'
import { fs } from '@/lib/os/fs'
import { Play, Save, ChevronDown, Loader2, FileCode2, CheckCircle2, XCircle } from 'lucide-react'

interface RunResp {
  ok: boolean
  error?: string
  compile?: { stdout: string; stderr: string } | null
  run?: { stdout: string; stderr: string; code: number | null; signal: string | null }
  time?: string
  engine?: string
}

const C_DEFAULT = `#include <stdio.h>

int main(void) {
    printf("Hello from REDSEC C!\\n");

    int nums[] = { 5, 9, 1, 7, 3 };
    int n = sizeof(nums) / sizeof(nums[0]);
    int sum = 0;
    for (int i = 0; i < n; i++) sum += nums[i];
    printf("sum of array = %d\\n", sum);

    return 0;
}
`

const CPP_DEFAULT = `#include <iostream>
#include <vector>
#include <numeric>

int main() {
    std::cout << "Hello from REDSEC C++!\\n";

    std::vector<int> nums{ 5, 9, 1, 7, 3 };
    int sum = std::accumulate(nums.begin(), nums.end(), 0);
    std::cout << "sum of vector = " << sum << "\\n";

    return 0;
}
`

const C_EXAMPLES: Array<{ name: string; code: string }> = [
  {
    name: 'Hello + array sum',
    code: C_DEFAULT,
  },
  {
    name: 'Recursion — factorial',
    code: `#include <stdio.h>

long fact(int n) {
    return n <= 1 ? 1 : n * fact(n - 1);
}

int main(void) {
    for (int i = 1; i <= 10; i++)
        printf("%2d! = %ld\\n", i, fact(i));
    return 0;
}
`,
  },
  {
    name: 'Pointers — swap two ints',
    code: `#include <stdio.h>

void swap(int *a, int *b) {
    int t = *a;
    *a = *b;
    *b = t;
}

int main(void) {
    int x = 42, y = 99;
    printf("before: x=%d y=%d\\n", x, y);
    swap(&x, &y);
    printf("after:  x=%d y=%d\\n", x, y);
    printf("swap runs at %p\\n", (void *)&swap);
    return 0;
}
`,
  },
  {
    name: 'Structs — student records',
    code: `#include <stdio.h>
#include <string.h>

typedef struct {
    char name[32];
    int marks;
} Student;

int main(void) {
    Student cls[3];
    strcpy(cls[0].name, "Aarav"); cls[0].marks = 91;
    strcpy(cls[1].name, "Riya");  cls[1].marks = 87;
    strcpy(cls[2].name, "Kabir"); cls[2].marks = 95;

    int best = 0;
    for (int i = 0; i < 3; i++) {
        printf("%-6s -> %d\\n", cls[i].name, cls[i].marks);
        if (cls[i].marks > cls[best].marks) best = i;
    }
    printf("topper: %s\\n", cls[best].name);
    return 0;
}
`,
  },
]

const CPP_EXAMPLES: Array<{ name: string; code: string }> = [
  {
    name: 'Hello + vector sum',
    code: CPP_DEFAULT,
  },
  {
    name: 'Class — Bank account',
    code: `#include <iostream>
#include <string>

class Account {
    std::string owner;
    double balance = 0.0;
public:
    explicit Account(std::string o) : owner(std::move(o)) {}
    void deposit(double amt) { balance += amt; }
    bool withdraw(double amt) {
        if (amt > balance) return false;
        balance -= amt;
        return true;
    }
    void show() const {
        std::cout << owner << ": Rs. " << balance << '\\n';
    }
};

int main() {
    Account a("RedSec");
    a.deposit(500);
    a.deposit(250);
    if (!a.withdraw(1000)) std::cout << "withdraw failed (insufficient)\\n";
    a.withdraw(300);
    a.show();
    return 0;
}
`,
  },
  {
    name: 'STL — sort & unique',
    code: `#include <iostream>
#include <vector>
#include <algorithm>

int main() {
    std::vector<int> v{ 8, 3, 8, 1, 9, 3, 5 };
    std::sort(v.begin(), v.end());
    v.erase(std::unique(v.begin(), v.end()), v.end());

    for (int x : v) std::cout << x << ' ';
    std::cout << "\\nmin=" << *std::min_element(v.begin(), v.end())
              << " max=" << *std::max_element(v.begin(), v.end()) << '\\n';
    return 0;
}
`,
  },
  {
    name: 'Templates — generic max',
    code: `#include <iostream>
#include <string>

template <typename T>
const T &mymax(const T &a, const T &b) {
    return a > b ? a : b;
}

int main() {
    std::cout << mymax(7, 12) << '\\n';
    std::cout << mymax(3.14, 2.72) << '\\n';
    std::cout << mymax(std::string("redsec"), std::string("os")) << '\\n';
    return 0;
}
`,
  },
]

type Lang = 'c' | 'cpp'

function CompilerApp({ lang }: { lang: Lang }) {
  const isC = lang === 'c'
  const notify = useOS((s) => s.notify)
  const [code, setCode] = useState(isC ? C_DEFAULT : CPP_DEFAULT)
  const [stdin, setStdin] = useState('')
  const [showStdin, setShowStdin] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RunResp | null>(null)
  const [netErr, setNetErr] = useState('')
  const [tab, setTab] = useState<'out' | 'err'>('out')
  const [saving, setSaving] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const fileLabel = isC ? 'main.c' : 'main.cpp'
  const toolchain = isC ? 'REDSEC C17 · rscc -O1' : 'REDSEC C++20 · rs++ -O1'
  const examples = isC ? C_EXAMPLES : CPP_EXAMPLES
  const accent = isC ? '#f59e0b' : '#14b8a6'

  const lines = code.split('\n').length

  const doRun = useCallback(async () => {
    if (running) return
    setRunning(true)
    setNetErr('')
    try {
      const res = await fetch('/api/code/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang, code, stdin }),
      })
      const j = (await res.json()) as RunResp
      if (!j.ok) throw new Error(j.error || 'Execution failed.')
      setResult(j)
      /* show the printed output first — errors live in the Errors tab, never hiding stdout */
      const hasOut = Boolean(j.run?.stdout?.trim())
      const hasErr = Boolean(j.run?.stderr?.trim()) || Boolean(j.compile?.stderr?.trim())
      setTab(hasOut ? 'out' : hasErr ? 'err' : 'out')
    } catch (e) {
      setResult(null)
      setNetErr(e instanceof Error ? e.message : 'Execution failed — toolchain unreachable.')
    } finally {
      setRunning(false)
    }
  }, [running, lang, code, stdin])

  const doSave = useCallback(async () => {
    if (saving) return
    setSaving(true)
    const name = `main-${Date.now()}.${isC ? 'c' : 'cpp'}`
    try {
      await fs.addFile('downloads', name, {
        blob: new Blob([code], { type: 'text/plain' }),
        mime: 'text/plain',
        size: code.length,
        meta: { kind: 'code', language: lang },
      })
      notify({ title: 'Saved to File Manager ▸ Downloads', body: `${name} · ${lang}`, kind: 'success', emoji: '💾' })
    } catch {
      notify({ title: 'Save failed', body: 'Could not write into the File Manager.', kind: 'error' })
    } finally {
      setSaving(false)
    }
  }, [saving, code, isC, lang, notify])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      void doRun()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const s = el.selectionStart
      const en = el.selectionEnd
      const next = code.slice(0, s) + '  ' + code.slice(en)
      setCode(next)
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = s + 2
      })
    }
  }

  const compileErr = result?.compile?.stderr?.trim() || ''
  const runOut = result?.run?.stdout?.trimEnd() || ''
  const runErr = result?.run?.stderr?.trimEnd() || ''
  const exitCode = result?.run?.code
  const ok = exitCode === 0 && !compileErr

  return (
    <AppShell>
      <Toolbar>
        <span className="flex items-center gap-1.5 text-xs font-bold" style={{ color: accent }}>
          <FileCode2 className="h-4 w-4" />
          {isC ? 'C Compiler' : 'C++ Compiler'}
        </span>
        <span className="hidden rounded bg-black/30 px-1.5 py-0.5 font-mono text-[9px] text-slate-400 md:inline">{toolchain}</span>

        <div className="relative">
          <select
            aria-label="Load an example"
            value=""
            onChange={(e) => {
              const ex = examples[Number(e.target.value)]
              if (ex) {
                setCode(ex.code)
                setResult(null)
                setNetErr('')
              }
            }}
            className="h-8 appearance-none rounded-md bg-white/5 pr-6 pl-2.5 text-xs text-slate-200 outline-none hover:bg-white/12 focus:ring-1 focus:ring-sky-500/40"
          >
            <option value="" disabled>
              Examples
            </option>
            {examples.map((ex, i) => (
              <option key={ex.name} value={i} className="bg-[#161b28]">
                {ex.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-1.5 h-3 w-3 -translate-y-1/2 text-slate-500" />
        </div>

        <TBtn active={showStdin} onClick={() => setShowStdin((v) => !v)} title="Standard input for the run">
          stdin
        </TBtn>
        <TBtn onClick={() => void doSave()} disabled={saving} title="Save source into File Manager ▸ Downloads">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">Save</span>
        </TBtn>

        <span className="ml-auto hidden font-mono text-[9px] text-slate-600 lg:inline">Ctrl+Enter to run</span>
        <button
          type="button"
          onClick={() => void doRun()}
          disabled={running}
          className="flex h-8 items-center gap-1.5 rounded-md bg-sky-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {running ? 'Compiling…' : 'Run'}
        </button>
      </Toolbar>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* editor */}
        <div className="flex min-h-[180px] min-w-0 flex-1 flex-col border-b border-white/10 md:border-b-0 md:border-r">
          <div className="flex items-center gap-2 border-b border-white/5 bg-[#0d1120] px-3 py-1.5">
            <span className="font-mono text-[11px] text-slate-300">{fileLabel}</span>
            <span className="ml-auto font-mono text-[9px] text-slate-600">
              {lines} lines · {code.length} chars
            </span>
          </div>
          <textarea
            ref={areaRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={`${isC ? 'C' : 'C++'} source editor`}
            className="os-scroll min-h-0 flex-1 resize-none bg-[#0b0f19] p-3 font-mono text-[12px] leading-relaxed text-slate-100 outline-none"
          />
          {showStdin && (
            <div className="flex-none border-t border-white/10 bg-[#0d1120]">
              <div className="flex items-center gap-2 px-3 pt-1.5">
                <span className="font-mono text-[10px] font-bold tracking-wide text-slate-500">STDIN — fed to the program on Run</span>
                <button type="button" onClick={() => setStdin('')} className="ml-auto text-[10px] text-slate-500 hover:text-rose-300">
                  clear
                </button>
              </div>
              <textarea
                value={stdin}
                onChange={(e) => setStdin(e.target.value)}
                placeholder="input your program will read (scanf / cin >> …)"
                aria-label="Standard input"
                className="os-scroll h-20 w-full resize-none bg-transparent p-3 font-mono text-[11px] text-slate-200 outline-none"
              />
            </div>
          )}
        </div>

        {/* output */}
        <div className="flex min-h-[160px] min-w-0 flex-1 flex-col md:max-w-[44%]">
          <div className="flex flex-none items-center gap-1 border-b border-white/10 bg-[#0d1120] px-2 py-1.5">
            <button
              type="button"
              onClick={() => setTab('out')}
              className={`h-7 rounded-md px-2.5 text-[11px] font-semibold ${tab === 'out' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Output
            </button>
            <button
              type="button"
              onClick={() => setTab('err')}
              className={`h-7 rounded-md px-2.5 text-[11px] font-semibold ${tab === 'err' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Errors
              {compileErr && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-rose-500 align-middle" />}
            </button>
            {result && (
              <span className="ml-auto flex items-center gap-1.5">
                {ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-sky-400" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-rose-400" />
                )}
                <span className={`font-mono text-[9px] ${ok ? 'text-sky-400' : 'text-rose-400'}`}>
                  exit {exitCode === null ? '—' : exitCode}
                  {result?.time ? ` · ${result.time}` : ''}
                </span>
              </span>
            )}
          </div>

          <div className="os-scroll min-h-0 flex-1 overflow-y-auto bg-[#0b0f19] p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
            {running && <span className="text-slate-500">{isC ? 'gcc' : 'g++'}: compiling & running…</span>}
            {!running && netErr && <span className="text-rose-400">run failed — {netErr}</span>}
            {!running && !result && !netErr && (
              <span className="text-slate-600">
                Press <span className="text-slate-400">Run</span> to compile with the {isC ? 'gcc' : 'g++'} toolchain.
                {'\n'}Compile errors and runtime errors show in the Errors tab — printed output always shows here.
              </span>
            )}
            {!running && result && tab === 'out' && (
              <span className={runOut ? 'text-slate-100' : 'text-slate-600'}>
                {runOut || '(the program printed nothing to stdout)'}
                {runOut && runErr && <span className="mt-2 block text-[10px] text-amber-400/80">⚠ this program also wrote to stderr — see the Errors tab</span>}
              </span>
            )}
            {!running && result && tab === 'err' && (
              <span className="text-rose-300">
                {compileErr && (
                  <>
                    <span className="mb-1 block text-[10px] font-bold tracking-wide text-rose-400">COMPILE ERRORS ({isC ? 'gcc' : 'g++'})</span>
                    {compileErr}
                  </>
                )}
                {runErr && (
                  <>
                    {compileErr && <span className="mt-2 block" />}
                    <span className="mb-1 block text-[10px] font-bold tracking-wide text-rose-400">RUNTIME STDERR</span>
                    {runErr}
                  </>
                )}
                {!compileErr && !runErr && <span className="text-slate-600">no errors — clean run ✓</span>}
                {runOut && (
                  <>
                    <span className="mt-3 block text-[10px] font-bold tracking-wide text-slate-500">PROGRAM OUTPUT</span>
                    <span className="text-slate-100">{runOut}</span>
                  </>
                )}
              </span>
            )}
          </div>

          {result?.engine && (
            <div className="flex-none border-t border-white/5 px-3 py-1 font-mono text-[9px] text-slate-600">
              engine: {result.engine} · local toolchain · no cloud account needed
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}

/** the "C Compiler" desktop app */
export default function CLangApp() {
  return <CompilerApp lang="c" />
}

/** the "C++ Compiler" desktop app (registry maps cppapp → this export) */
export function CppApp() {
  return <CompilerApp lang="cpp" />
}

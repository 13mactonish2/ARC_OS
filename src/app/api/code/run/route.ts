// REDSEC v5.0 — Task 26d: /api/code/run : OpenCode compile & execute endpoint
// Three-tier engine chain, tried in order until one produces output:
//   1. LOCAL sandbox toolchains (python3 / node / bun / gcc / g++ / java / bash / perl)
//      — fastest, no rate limits, works offline.
//   2. Wandbox (wandbox.org/api/compile.json) — ~35 more compilers (ruby, php, go,
//      rust, haskell, lua, c#, swift, ocaml, d…), compiler list cached 1 h.
//   3. Piston (emkc.org) — kept as a final fallback for everything else.
// Always answers application/json: {ok, compile?, run:{stdout,stderr,code,signal}, time, engine}
// or {ok:false, error} with a friendly message.
import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const runtime = 'nodejs'
export const maxDuration = 60

const PISTON = 'https://emkc.org/api/v2/piston'
const WANDBOX = 'https://wandbox.org/api/compile.json'
const EXEC_TIMEOUT_MS = 15_000

interface ExecOut {
  stdout: string
  stderr: string
  code: number | null
  signal: string | null
  output?: string
}

export interface RunResult {
  ok: boolean
  compile?: ExecOut | null
  run?: ExecOut
  time?: number
  engine?: string
  /** human compiler/runtime id, e.g. "gcc 14.2.0" — surfaced in the IDE chips */
  engineVersion?: string
  error?: string
}

/* ------------------------------------------------------------------ */
/* engine 1 — LOCAL toolchains                                         */
/* ------------------------------------------------------------------ */

interface LocalSpec {
  id: string
  ext: string
  args: (file: string) => string[]
  /** compile-then-run (C / C++): args produce a binary, then it is executed */
  compileThenRun?: { cc: string; cArgs: (src: string, out: string) => string[] }
}

const LOCAL: Record<string, LocalSpec> = {
  python: { id: 'python3', ext: 'py', args: (f) => [f] },
  python3: { id: 'python3', ext: 'py', args: (f) => [f] },
  javascript: { id: 'bun', ext: 'js', args: (f) => ['run', f] },
  node: { id: 'bun', ext: 'js', args: (f) => ['run', f] },
  typescript: { id: 'bun', ext: 'ts', args: (f) => ['run', f] },
  bash: { id: 'bash', ext: 'sh', args: (f) => [f] },
  sh: { id: 'bash', ext: 'sh', args: (f) => [f] },
  perl: { id: 'perl', ext: 'pl', args: (f) => [f] },
  c: { id: 'gcc', ext: 'c', args: () => [], compileThenRun: { cc: 'gcc', cArgs: (src, out) => ['-O1', '-o', out, src, '-lm'] } },
  'c++': { id: 'g++', ext: 'cpp', args: () => [], compileThenRun: { cc: 'g++', cArgs: (src, out) => ['-O1', '-std=c++20', '-o', out, src] } },
  cpp: { id: 'g++', ext: 'cpp', args: () => [], compileThenRun: { cc: 'g++', cArgs: (src, out) => ['-O1', '-std=c++20', '-o', out, src] } },
  java: { id: 'java', ext: 'java', args: (f) => [f] }, // Java 11+ single-file source launch
}

/* Task 31 — cached toolchain version probe ("one compiler built into the OS") */
const verCache: Record<string, string> = {}
function toolVersion(cmd: string, args: string[]): Promise<string> {
  if (verCache[cmd]) return Promise.resolve(verCache[cmd])
  return new Promise((resolve) => {
    let out = ''
    let child: ReturnType<typeof spawn> | null = null
    try {
      child = spawn(cmd, args, { timeout: 3000 })
    } catch {
      resolve('')
      return
    }
    if (!child) {
      resolve('')
      return
    }
    child.stdout?.on('data', (d: Buffer) => { if (out.length < 1000) out += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { if (out.length < 1000) out += d.toString() })
    child.on('error', () => resolve(''))
    child.on('close', () => {
      const line = out.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
      const v = line.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? ''
      verCache[cmd] = v
      resolve(v)
    })
  })
}

async function localEngineVersion(specId: string): Promise<string> {
  let v = ''
  switch (specId) {
    case 'gcc': v = await toolVersion('gcc', ['--version']); return v ? `gcc ${v}` : 'gcc'
    case 'g++': v = await toolVersion('g++', ['--version']); return v ? `g++ ${v}` : 'g++'
    case 'python3': v = await toolVersion('python3', ['--version']); return v ? `python ${v}` : 'python'
    case 'bun': v = await toolVersion('bun', ['--version']); return v ? `bun ${v}` : 'bun'
    case 'bash': v = await toolVersion('bash', ['--version']); return v ? `bash ${v}` : 'bash'
    case 'perl': v = await toolVersion('perl', ['-e', 'printf "%vd", $^V;']); return v ? `perl ${v}` : 'perl'
    case 'java': v = await toolVersion('java', ['-version']); return v ? `java ${v}` : 'java'
    default: return specId
  }
}

function execCmd(cmd: string, args: string[], stdin: string, cwd: string, timeoutMs: number): Promise<ExecOut> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, timeout: timeoutMs, killSignal: 'SIGKILL' })
    let stdout = ''
    let stderr = ''
    let killed = false
    const outLimit = 64_000
    child.stdout.on('data', (d: Buffer) => { if (stdout.length < outLimit) stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { if (stderr.length < outLimit) stderr += d.toString() })
    child.on('error', (e) => resolve({ stdout, stderr: stderr + String(e), code: null, signal: null }))
    child.on('close', (code, signal) => {
      if (killed) return
      killed = true
      resolve({ stdout, stderr, code, signal })
    })
    try {
      if (stdin) child.stdin.write(stdin)
      child.stdin.end()
    } catch { /* stdin may already be gone */ }
    setTimeout(() => {
      if (!killed) {
        killed = true
        try { child.kill('SIGKILL') } catch { /* gone */ }
        resolve({ stdout, stderr: stderr + (stderr ? '\n' : '') + 'Killed after ' + Math.round(timeoutMs / 1000) + 's (time limit)', code: null, signal: 'SIGKILL' })
      }
    }, timeoutMs + 500)
  })
}

async function runLocal(language: string, code: string, stdin: string): Promise<ExecOut | null> {
  const spec = LOCAL[language.toLowerCase().trim()]
  if (!spec) return null
  let dir: string | null = null
  try {
    dir = await mkdtemp(join(tmpdir(), 'opencode-'))
    const file = join(dir, spec.id === 'java' ? 'Main.java' : `main.${spec.ext}`)
    await writeFile(file, code, 'utf8')
    if (spec.compileThenRun) {
      const bin = join(dir, 'main.bin')
      const cc = await execCmd(spec.compileThenRun.cc, spec.compileThenRun.cArgs(file, bin), '', dir, EXEC_TIMEOUT_MS)
      if (cc.code !== 0 || cc.stderr) {
        // compilation failed → surface as compile error
        return cc.code === 0 ? null : { stdout: '', stderr: cc.stderr || 'compilation failed', code: cc.code, signal: cc.signal, output: undefined }
      }
      return await execCmd(bin, [], stdin, dir, EXEC_TIMEOUT_MS)
    }
    return await execCmd(spec.id, spec.args(file), stdin, dir, EXEC_TIMEOUT_MS)
  } catch {
    return null
  } finally {
    if (dir) void rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/* ------------------------------------------------------------------ */
/* engine 2 — Wandbox                                                  */
/* ------------------------------------------------------------------ */

interface WbCompiler { name: string; language: string; version?: string }
let wbCache: { at: number; list: WbCompiler[] } | null = null

async function wandboxCompilers(): Promise<WbCompiler[]> {
  if (wbCache && Date.now() - wbCache.at < 60 * 60_000) return wbCache.list
  const res = await fetch('https://wandbox.org/api/list.json', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`wandbox list ${res.status}`)
  const list = (await res.json()) as WbCompiler[]
  if (!Array.isArray(list) || list.length === 0) throw new Error('wandbox list empty')
  wbCache = { at: Date.now(), list }
  return list
}

const WB_LANGUAGE_ALIAS: Record<string, string> = {
  'c++': 'C++', cpp: 'C++', csharp: 'C#', 'c#': 'C#', cs: 'C#', golang: 'Go',
  js: 'JavaScript', node: 'JavaScript', python3: 'Python', py: 'Python',
  bash: 'Bash', sh: 'Bash', shell: 'Bash', ts: 'TypeScript', rb: 'Ruby', rs: 'Rust',
}

async function runWandbox(language: string, code: string, stdin: string): Promise<{ out: ExecOut; compiler: string } | null> {
  try {
    const list = await wandboxCompilers()
    const low = language.toLowerCase().trim()
    const wanted = WB_LANGUAGE_ALIAS[low] || low.replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace('#', '#')
    const hit =
      list.find((c) => c.language.toLowerCase() === wanted.toLowerCase() && !c.name.includes('head')) ??
      list.find((c) => c.language.toLowerCase() === wanted.toLowerCase())
    if (!hit) return null
    const res = await fetch(WANDBOX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, compiler: hit.name, save: false }),
      cache: 'no-store',
      signal: AbortSignal.timeout(EXEC_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const j = (await res.json()) as {
      status?: string; compiler_output?: string; compiler_error?: string
      program_output?: string; program_error?: string; signal?: string
    }
    const stderr = [j.compiler_error, j.program_error].filter(Boolean).join('\n').trim()
    const stdout = (j.program_output || '').trim()
    if (!stdout && !stderr && j.status === undefined) return null
    return {
      out: {
        stdout,
        stderr,
        code: j.status === undefined ? null : Number(j.status) || 0,
        signal: j.signal || null,
      },
      compiler: hit.name,
    }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* engine 3 — Piston (fallback)                                        */
/* ------------------------------------------------------------------ */

interface PistonRuntime { language: string; version: string; aliases?: string[] }
let rtCache: { at: number; list: PistonRuntime[] } | null = null

async function pistonRuntimes(): Promise<PistonRuntime[]> {
  if (rtCache && Date.now() - rtCache.at < 10 * 60_000) return rtCache.list
  const res = await fetch(`${PISTON}/runtimes`, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
  if (!res.ok) throw new Error(`runtimes responded ${res.status}`)
  const list = (await res.json()) as PistonRuntime[]
  if (!Array.isArray(list) || list.length === 0) throw new Error('runtimes catalog is empty')
  rtCache = { at: Date.now(), list }
  return list
}

function resolveVersion(list: PistonRuntime[], language: string): string | null {
  const low = language.toLowerCase().trim()
  const hit =
    list.find((r) => r.language.toLowerCase() === low) ??
    list.find((r) => Array.isArray(r.aliases) && r.aliases.some((a) => a.toLowerCase() === low))
  return hit?.version ?? null
}

const EXT: Record<string, string> = {
  python: 'py', python3: 'py', javascript: 'js', typescript: 'ts', c: 'c', 'c++': 'cpp', 'c#': 'cs',
  java: 'java', go: 'go', rust: 'rs', ruby: 'rb', php: 'php', swift: 'swift',
  kotlin: 'kt', scala: 'scala', haskell: 'hs', lua: 'lua', perl: 'pl', r: 'r',
  dart: 'dart', elixir: 'ex', erlang: 'erl', clojure: 'clj', 'f#': 'fs', groovy: 'groovy',
  julia: 'jl', nim: 'nim', ocaml: 'ml', pascal: 'pas', prolog: 'pl', smalltalk: 'st',
  sqlite3: 'sql', sqlite: 'sql', bash: 'sh', basic: 'bas', cobol: 'cob', fortran: 'f90',
  lisp: 'lisp', scheme: 'scm', asm: 'asm', nasm: 'asm', nasm64: 'asm', d: 'd',
  crystal: 'cr', zig: 'zig', vlang: 'v', raku: 'raku', tcl: 'tcl', verilog: 'v',
  coffeescript: 'coffee', awk: 'awk', brainfk: 'bf', powershell: 'ps1', batch: 'bat',
  'objective-c': 'm', ada: 'ada', octave: 'm', lolcode: 'lol', sh: 'sh', cpp: 'cpp', cs: 'cs',
}

function fileNameFor(language: string): string {
  const low = language.toLowerCase().trim()
  const ext = EXT[low] || low.replace(/[^a-z0-9+#]/g, '') || 'txt'
  return `main.${ext}`
}

/* ------------------------------------------------------------------ */

function friendlyError(status: number, message: string): string {
  if (status === 429) return 'The free execution queue is rate-limited right now — wait a few seconds and press Run again.'
  if (status === 400 || status === 404) return message || 'The runner rejected this request — check the language and version.'
  return 'The execution service is unreachable right now — try again shortly.'
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  try {
    const body = (await req.json().catch(() => null)) as
      | { language?: string; version?: string; code?: string; stdin?: string }
      | null
    const language = typeof body?.language === 'string' ? body.language.trim().slice(0, 64) : ''
    const code = typeof body?.code === 'string' ? body.code.slice(0, 64_000) : ''
    const stdin = typeof body?.stdin === 'string' ? body.stdin.slice(0, 16_000) : ''

    if (!language) {
      return NextResponse.json({ ok: false, error: 'Pick a language before running.' } satisfies RunResult, { status: 400 })
    }
    if (!code.trim()) {
      return NextResponse.json({ ok: false, error: 'The editor is empty — write some code first.' } satisfies RunResult, { status: 400 })
    }

    /* engine 1 — local sandbox toolchains (C/C++ report compile errors via stderr) */
    const localSpecId = LOCAL[language.toLowerCase().trim()]?.id
    const local = await runLocal(language, code, stdin)
    if (local) {
      return NextResponse.json({
        ok: true,
        compile: null,
        run: local,
        engine: 'local',
        engineVersion: localSpecId ? await localEngineVersion(localSpecId) : undefined,
        time: Date.now() - started,
      } satisfies RunResult)
    }

    /* engine 2 — Wandbox (~35 languages) */
    const wb = await runWandbox(language, code, stdin)
    if (wb) {
      return NextResponse.json({
        ok: true,
        compile: null,
        run: wb.out,
        engine: 'wandbox',
        engineVersion: wb.compiler,
        time: Date.now() - started,
      } satisfies RunResult)
    }

    /* engine 3 — Piston */
    let version: string | null = null
    try {
      const list = await pistonRuntimes()
      version = resolveVersion(list, language)
    } catch { /* catalog unreachable */ }
    if (version) {
      const payload = {
        language: language === 'sqlite' || language === 'sql' ? 'sqlite3' : language.trim(),
        version,
        files: [{ name: fileNameFor(language), content: code }],
        ...(stdin ? { stdin } : {}),
      }
      try {
        const res = await fetch(`${PISTON}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
          signal: AbortSignal.timeout(EXEC_TIMEOUT_MS),
        })
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as { compile?: ExecOut | null; run?: ExecOut } | null
          if (data?.run) {
            return NextResponse.json({
              ok: true,
              compile: data.compile ?? null,
              run: data.run,
              engine: 'piston',
              engineVersion: version ? `v${version}` : undefined,
              time: Date.now() - started,
            } satisfies RunResult)
          }
        }
      } catch { /* fall through to the friendly error */ }
    }

    return NextResponse.json(
      {
        ok: false,
        error: `No runner is reachable for “${language}” right now. Popular languages (Python, JavaScript, TypeScript, C, C++, Java, Bash, Ruby, Go, Rust…) always run — try one of those.`,
      } satisfies RunResult,
      { status: 200 }
    )
  } catch (err) {
    console.error('opencode run error:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Execution failed unexpectedly.' } satisfies RunResult,
      { status: 200 }
    )
  }
}

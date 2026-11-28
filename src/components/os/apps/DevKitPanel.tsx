// REDSEC v7.0 "Black Sea" — DevKit, ported into Settings ▸ Developer options.
// (v7.0.1 — the standalone DevKit app is retired; this panel is its home now.)
// Sub-tabs: Node.js runtime (real server-side sandbox) · API Hub (connectivity)
//           OS State (live JSON inspector + importer) · Window (shape/size)
'use client'

import { useCallback, useMemo, useState } from 'react'
import { Check, Copy, Download, Eraser, Loader2, Play, RotateCcw } from 'lucide-react'
import { useOS } from '@/lib/os/store'
import type { OSStore } from '@/lib/os/types'

interface ExecResult {
  ok: boolean
  logs?: string[]
  error?: string
  stackLine?: string
  ms?: number
}

const SAMPLES: Record<string, string> = {
  'Hello Node': "console.log('Hello from the Black Sea Node.js runtime!');",
  'Async timers': `console.log('start');
setTimeout(() => console.log('async log from the server timer'), 40);
console.log('end (logs stream back when timers settle)');`,
  'Math + JSON': `const data = { os: 'REDSEC v7.0', codename: 'Black Sea' };
console.log(JSON.stringify(data, null, 2));
console.log('sum:', [1, 2, 3, 4].reduce((a, b) => a + b, 0));`,
}

const SCROLL =
  '[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb:hover]:bg-white/20'

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{children}</h4>
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-white/10 bg-white/[0.03] p-3 ${className}`}>{children}</div>
}

type SubTab = 'node' | 'hub' | 'state' | 'window'

const SUBTABS: Array<{ id: SubTab; label: string }> = [
  { id: 'node', label: 'Node.js Runtime' },
  { id: 'hub', label: 'API Hub' },
  { id: 'state', label: 'OS State' },
  { id: 'window', label: 'Window & Panel' },
]

const SERVICES: Array<{ name: string; desc: string; method: 'GET' | 'POST' }> = [
  { name: 'ai/chat', desc: 'BlackSea-N1 assistant backend', method: 'POST' },
  { name: 'ai/research', desc: 'Deep Research (web search + synthesis)', method: 'POST' },
  { name: 'ai/asr', desc: 'Speech-to-text (voice input)', method: 'POST' },
  { name: 'ai/tts', desc: 'Text-to-speech synthesis', method: 'POST' },
  { name: 'code/run', desc: 'Multi-language code runner', method: 'POST' },
  { name: 'os/security/handshake', desc: 'Black Sea ban registry + browser guard', method: 'POST' },
  { name: 'os/security/status', desc: 'Realtime ban watchdog', method: 'GET' },
  { name: 'sec/feed', desc: 'Security audit feed (Velikan)', method: 'GET' },
  { name: 'weather', desc: 'Weather service', method: 'GET' },
  { name: 'news', desc: 'News feed', method: 'GET' },
  { name: 'ytsearch', desc: 'YouTube search', method: 'GET' },
  { name: 'github', desc: 'GitHub tools', method: 'GET' },
  { name: 'discord', desc: 'Text ER Discord bridge', method: 'GET' },
]

function lineClass(l: string): string {
  if (l.startsWith('[error]')) return 'text-rose-400'
  if (l.startsWith('[warn]')) return 'text-amber-300'
  if (l.startsWith('[info]')) return 'text-cyan-300/80'
  return 'text-slate-200'
}

/* ---------------- Node.js runtime ---------------- */

function NodePane() {
  const [sample, setSample] = useState('Hello Node')
  const [code, setCode] = useState(SAMPLES['Hello Node'])
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ExecResult | null>(null)
  const lineCount = useMemo(() => code.split('\n').length, [code])

  const run = useCallback(async () => {
    if (running) return
    setRunning(true)
    setResult(null)
    try {
      const res = await fetch('/api/devkit/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      setResult((await res.json()) as ExecResult)
    } catch {
      setResult({ ok: false, error: 'Network error — /api/devkit/exec unreachable' })
    } finally {
      setRunning(false)
    }
  }, [code, running])

  const logs = result?.logs ?? []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sample}
          onChange={(e) => {
            setSample(e.target.value)
            setCode(SAMPLES[e.target.value] ?? '')
          }}
          className="h-8 rounded-md border border-white/10 bg-[#0b0f1a] px-2 text-xs text-slate-200 outline-none focus:border-cyan-500/60"
          aria-label="Sample program"
        >
          {Object.keys(SAMPLES).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run
        </button>
        <button type="button" onClick={() => setCode('')} className="flex h-8 items-center gap-1.5 rounded-md bg-white/5 px-3 text-xs text-slate-300 hover:bg-white/12">
          <Eraser className="h-3.5 w-3.5" /> Clear
        </button>
        {result && (
          <span className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold ${result.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
            {result.ok ? 'exit 0' : 'error'} · exec {result.ms ?? 0} ms
          </span>
        )}
      </div>
      <div className="flex h-44 overflow-hidden rounded-lg border border-white/10 bg-[#0b0f1a]">
        <div className="w-9 flex-none border-r border-white/10 bg-white/[0.02] py-3 text-right font-mono text-[10.5px] leading-5 text-slate-600" aria-hidden>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              void run()
            }
          }}
          spellCheck={false}
          aria-label="Node.js code editor"
          className="h-full w-full flex-1 resize-none bg-transparent p-3 font-mono text-[11.5px] leading-5 text-emerald-100/90 outline-none"
        />
      </div>
      {result && !result.ok && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 font-mono text-[11px] text-rose-200">
          {result.error}
        </div>
      )}
      <div className="max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-[#0b0f1a] p-3 font-mono text-[11.5px] leading-5">
        {logs.length === 0 && <span className="text-slate-600">No output yet — press Run (Ctrl+Enter).</span>}
        {logs.map((l, i) => (
          <div key={i} className={`whitespace-pre-wrap break-words ${lineClass(l)}`}>
            {l || '\u00a0'}
          </div>
        ))}
        {result && result.ok && logs.length === 0 && <span className="text-slate-600">(no console output — script finished clean)</span>}
      </div>
      <p className="text-[10px] text-slate-500">Server-side Node.js (vm sandbox) — the real Black Sea runtime.</p>
    </div>
  )
}

/* ---------------- API hub ---------------- */

function HubPane() {
  const [pinged, setPinged] = useState<string | null>(null)
  const [pingState, setPingState] = useState<'ok' | 'fail' | 'busy' | null>(null)

  const ping = async (name: string): Promise<void> => {
    setPinged(name)
    setPingState('busy')
    try {
      const res = await fetch(`/api/devkit/ping?target=${encodeURIComponent(name)}`)
      const d = (await res.json()) as { ok?: boolean }
      setPingState(d.ok ? 'ok' : 'fail')
    } catch {
      setPingState('fail')
    }
    setTimeout(() => setPingState(null), 1600)
  }

  return (
    <div className="space-y-2">
      {SERVICES.map((s) => (
        <div key={s.name} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#0b0f1a] px-3 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[11px] text-cyan-200">
              <span className={`rounded px-1 text-[9px] font-bold ${s.method === 'GET' ? 'bg-sky-500/15 text-sky-300' : 'bg-violet-500/15 text-violet-300'}`}>{s.method}</span>
              <span className="truncate">/api/{s.name}</span>
            </div>
            <div className="text-[10px] text-slate-500">{s.desc}</div>
          </div>
          <button
            type="button"
            onClick={() => void ping(s.name)}
            disabled={pingState === 'busy'}
            className="h-7 flex-none rounded-md bg-white/5 px-2.5 text-[10px] font-medium text-slate-200 hover:bg-cyan-600/80 hover:text-white disabled:opacity-50"
          >
            {pinged === s.name && pingState === 'busy' ? '…' : pinged === s.name && pingState === 'ok' ? 'OK' : pinged === s.name && pingState === 'fail' ? 'FAIL' : 'ping'}
          </button>
        </div>
      ))}
    </div>
  )
}

/* ---------------- OS state inspector ---------------- */

function computeSnapshot(): { snap: string; err: string } {
  try {
    const st = useOS.getState() as unknown as Record<string, unknown>
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(st)) {
      if (typeof v === 'function') continue
      clean[k] = v
    }
    return { snap: JSON.stringify(clean, null, 2), err: '' }
  } catch (e) {
    return { snap: '', err: `State is not serializable: ${e instanceof Error ? e.message : String(e)}` }
  }
}

function StatePane() {
  const [{ snap, err: snapErr }, setSnapState] = useState(() => computeSnapshot())
  const [imp, setImp] = useState('')
  const [impErr, setImpErr] = useState('')
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(() => setSnapState(computeSnapshot()), [])

  const doCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(snap)
      setCopied(true)
      useOS.getState().notify({ title: 'Copied to clipboard', body: `${snap.length} chars of OS state`, kind: 'success' })
      setTimeout(() => setCopied(false), 1500)
    } catch {
      useOS.getState().notify({ title: 'Clipboard blocked', kind: 'error' })
    }
  }

  const doDownload = (): void => {
    const blob = new Blob([snap], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `redsec-state-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    useOS.getState().notify({ title: 'State downloaded', kind: 'success' })
  }

  const applyImport = (): void => {
    setImpErr('')
    let parsed: unknown
    try {
      parsed = JSON.parse(imp)
    } catch {
      setImpErr('Invalid JSON — parse failed.')
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setImpErr('Expected a single JSON object.')
      return
    }
    const cur = useOS.getState() as unknown as Record<string, unknown>
    const out: Record<string, unknown> = {}
    let applied = 0
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (k in cur && typeof v !== 'function') {
        out[k] = v
        applied++
      }
    }
    if (applied === 0) {
      setImpErr('No known keys found — nothing to apply.')
      return
    }
    useOS.setState(out as unknown as Partial<OSStore>)
    useOS.getState().notify({ title: 'State applied', body: `${applied} key${applied === 1 ? '' : 's'} merged`, kind: 'success' })
    refresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubTitle>useOS.getState() — live snapshot</SubTitle>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => void doCopy()} className="flex h-7 items-center gap-1 rounded-md bg-white/5 px-2 text-[10px] text-slate-200 hover:bg-white/12">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={doDownload} className="flex h-7 items-center gap-1 rounded-md bg-white/5 px-2 text-[10px] text-slate-200 hover:bg-white/12">
            <Download className="h-3 w-3" /> Download
          </button>
          <button type="button" onClick={refresh} className="flex h-7 items-center gap-1 rounded-md bg-white/5 px-2 text-[10px] text-slate-200 hover:bg-white/12">
            <RotateCcw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </div>
      {snapErr ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 font-mono text-[11px] text-rose-200">{snapErr}</div>
      ) : (
        <pre className={`max-h-64 overflow-auto rounded-lg border border-white/10 bg-[#0b0f1a] p-3 font-mono text-[11px] leading-5 text-emerald-100/90 ${SCROLL}`}>{snap}</pre>
      )}
      <Panel>
        <SubTitle>Import — paste state JSON and apply (saved forever)</SubTitle>
        <textarea
          value={imp}
          onChange={(e) => setImp(e.target.value)}
          spellCheck={false}
          placeholder='{ "themeBg": "#101418", "winBtnShape": "macos" }'
          aria-label="State JSON to import"
          className={`mt-2 h-24 w-full resize-none rounded-lg border border-white/10 bg-[#0b0f1a] p-3 font-mono text-[11px] leading-5 text-slate-200 outline-none focus:border-cyan-500/60 ${SCROLL}`}
        />
        {impErr && <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 font-mono text-[10.5px] text-rose-200">{impErr}</div>}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={applyImport}
            disabled={!imp.trim()}
            className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Apply
          </button>
          <button
            type="button"
            onClick={() => {
              setImp('')
              setImpErr('')
            }}
            className="flex h-8 items-center gap-1.5 rounded-md bg-white/5 px-3 text-xs text-slate-300 hover:bg-white/12"
          >
            <Eraser className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      </Panel>
    </div>
  )
}

/* ---------------- window & panel customization ---------------- */

function WindowPane() {
  const devWinRadius = useOS((s) => s.devWinRadius)
  const devWinScale = useOS((s) => s.devWinScale)
  const setS = useOS((s) => s.set)

  return (
    <div className="space-y-3">
      <Panel>
        <SubTitle>Window shape — corner radius (saved forever)</SubTitle>
        <div className="mt-2 flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={28}
            step={1}
            value={devWinRadius ?? 10}
            onChange={(e) => setS({ devWinRadius: Number(e.target.value) })}
            className="h-1.5 flex-1 accent-cyan-500"
            aria-label="Window corner radius"
          />
          <span className="w-14 text-right font-mono text-[11px] text-cyan-200">{devWinRadius ?? 10}px</span>
          <button
            type="button"
            onClick={() => setS({ devWinRadius: null })}
            className="h-7 rounded-md bg-white/5 px-2 text-[10px] text-slate-300 hover:bg-white/12"
          >
            Stock
          </button>
        </div>
      </Panel>
      <Panel>
        <SubTitle>Window size — default size scale (saved forever)</SubTitle>
        <div className="mt-2 flex items-center gap-3">
          <input
            type="range"
            min={60}
            max={140}
            step={5}
            value={Math.round((devWinScale ?? 1) * 100)}
            onChange={(e) => setS({ devWinScale: Number(e.target.value) / 100 })}
            className="h-1.5 flex-1 accent-cyan-500"
            aria-label="Window default size scale"
          />
          <span className="w-14 text-right font-mono text-[11px] text-cyan-200">{Math.round((devWinScale ?? 1) * 100)}%</span>
          <button
            type="button"
            onClick={() => setS({ devWinScale: null })}
            className="h-7 rounded-md bg-white/5 px-2 text-[10px] text-slate-300 hover:bg-white/12"
          >
            Stock
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-slate-500">Applies to every newly opened window. Taskbar & panel styling lives in Settings ▸ Taskbar / ▸ Window Panel.</p>
      </Panel>
    </div>
  )
}

/* ---------------- root panel ---------------- */

export function DevKitPanel() {
  const [tab, setTab] = useState<SubTab>('node')
  return (
    <div className="rounded-xl border border-cyan-400/20 bg-[#0b1120]/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-slate-100">DevKit</span>
        <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-300">ported into Settings</span>
        <span className="text-[10px] text-slate-500">the OS development kit — customize everything, saved forever</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="DevKit sections">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`h-8 rounded-lg px-3 text-[11px] font-medium transition-colors ${
              tab === t.id ? 'bg-cyan-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {tab === 'node' && <NodePane />}
        {tab === 'hub' && <HubPane />}
        {tab === 'state' && <StatePane />}
        {tab === 'window' && <WindowPane />}
      </div>
    </div>
  )
}

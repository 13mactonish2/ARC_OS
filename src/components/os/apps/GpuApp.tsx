// REDSEC 5.0 — GPU app: the VXR-5 virtual GPU card console. Live FPS +
// frame-time sparkline, VXR benchmark, GPU Boost toggle (blur off, GPU
// compositing on), Game Mode, realtime long-task monitor, hardware chips.
'use client'

import React, { useEffect, useState } from 'react'
import { Cpu, Gauge, Rocket, Gamepad2, Zap, Activity, Info } from 'lucide-react'
import { AppShell, Toolbar, TBtn } from './_shared'
import { detectGpu, gpuScore, scoreBand, useFpsMeter, useGpuBoost, useGameMode, type GpuInfo } from '@/lib/os/gpu'
import { logSecEvent } from '@/lib/os/comm'

export default function GpuApp({ winId }: { winId: string; args?: Record<string, unknown> }) {
  const [info] = useState<GpuInfo>(() => detectGpu())
  const { fps, frameMs, history } = useFpsMeter()
  const { boost, setBoost } = useGpuBoost()
  const { gameMode, setGameMode } = useGameMode()
  const [score, setScore] = useState<number | null>(null)
  const [benchBusy, setBenchBusy] = useState(false)
  const [longTasks, setLongTasks] = useState(0)

  /* long-task monitor (30s window) */
  useEffect(() => {
    let count = 0
    let obs: PerformanceObserver | null = null
    try {
      obs = new PerformanceObserver((list) => {
        count += list.getEntries().length
      })
      obs.observe({ entryTypes: ['longtask'] })
    } catch { /* unsupported */ }
    const iv = setInterval(() => setLongTasks(count), 2000)
    return () => {
      obs?.disconnect()
      clearInterval(iv)
    }
  }, [])

  const runBench = () => {
    setBenchBusy(true)
    setTimeout(() => {
      const s = gpuScore()
      setScore(s)
      setBenchBusy(false)
      logSecEvent('system', `VXR benchmark complete — score ${s} (${scoreBand(s)})`)
    }, 900)
  }

  return (
    <AppShell>
      <Toolbar>
        <Cpu className="h-4 w-4 text-violet-400" />
        <span className="text-xs font-semibold">GPU</span>
        <span className="ml-1 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">VXR-5</span>
        <span className="ml-auto text-[10px] text-slate-500">realtime · multitasking · gaming</span>
      </Toolbar>

      <div className="min-h-0 flex-1 overflow-y-auto os-scroll p-4">
        <div className="mx-auto grid max-w-3xl gap-3">
          {/* card identity */}
          <section className="rounded-xl border border-white/10 bg-[#141926] p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-violet-500/15">
                <Cpu className="h-6 w-6 text-violet-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-100">REDSEC VXR-5 Virtual GPU</div>
                <div className="mt-0.5 break-words text-[11px] text-slate-400">{info?.renderer || 'Detecting renderer…'}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px]">
                  <span className={`rounded-full px-2 py-0.5 font-bold ${info?.software ? 'bg-amber-500/15 text-amber-300' : 'bg-sky-500/15 text-sky-300'}`}>
                    {info ? (info.software ? 'Software fallback' : 'Dedicated · hardware accelerated') : '…'}
                  </span>
                  {info?.webgl2 && <span className="rounded-full bg-violet-500/15 px-2 py-0.5 font-bold text-violet-300">WebGL2</span>}
                  {info && <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-400">max texture {info.maxTexture}px</span>}
                  {info && <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-400">{info.vendor}</span>}
                </div>
              </div>
            </div>
          </section>

          {/* live performance */}
          <section className="rounded-xl border border-white/10 bg-[#141926] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <Activity className="h-3.5 w-3.5 text-violet-300" /> Realtime monitor
            </div>
            <div className="mt-3 flex items-end gap-6">
              <div>
                <div className="font-mono text-4xl font-bold leading-none text-violet-300">{fps}</div>
                <div className="mt-1 text-[9px] uppercase tracking-wider text-slate-500">FPS</div>
              </div>
              <div>
                <div className="font-mono text-xl font-bold leading-none text-slate-200">{frameMs}<span className="text-[10px] text-slate-500"> ms</span></div>
                <div className="mt-1 text-[9px] uppercase tracking-wider text-slate-500">frame time</div>
              </div>
              <div>
                <div className="font-mono text-xl font-bold leading-none text-slate-200">{longTasks}</div>
                <div className="mt-1 text-[9px] uppercase tracking-wider text-slate-500">long tasks / 30s</div>
              </div>
            </div>
            {/* hand-drawn sparkline */}
            <div className="mt-3">
              <FpsChart history={history} />
            </div>
          </section>

          {/* benchmark */}
          <section className="rounded-xl border border-white/10 bg-[#141926] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <Gauge className="h-3.5 w-3.5 text-violet-300" /> VXR benchmark
            </div>
            <div className="mt-2 flex items-center gap-4">
              <button
                type="button"
                onClick={runBench}
                disabled={benchBusy}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-[11px] font-bold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {benchBusy ? 'Running…' : score ? 'Re-run benchmark' : 'Run benchmark'}
              </button>
              {benchBusy && <Zap className="h-4 w-4 animate-pulse text-violet-300" />}
              {score !== null && !benchBusy && (
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-bold text-violet-300">{score.toLocaleString()}</span>
                    <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[9px] font-bold text-violet-300">{scoreBand(score)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400" style={{ width: `${Math.min(100, (score / 60000) * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* boost + game mode */}
          <section className="grid gap-3 sm:grid-cols-2">
            <div className={`rounded-xl border p-4 transition-colors ${boost ? 'border-violet-400/40 bg-violet-500/10' : 'border-white/10 bg-[#141926]'}`}>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Rocket className={`h-3.5 w-3.5 ${boost ? 'text-violet-300' : 'text-slate-500'}`} /> GPU Boost
              </div>
              <p className="mt-1.5 text-[10px] leading-snug text-slate-500">Blur off, windows &amp; media promoted to GPU layers, compositing priority — smoother multitasking and video.</p>
              <button
                type="button"
                onClick={() => {
                  setBoost(!boost)
                  logSecEvent('system', boost ? 'GPU Boost disengaged' : 'GPU Boost engaged — blur reduced, compositing on GPU')
                }}
                aria-pressed={boost}
                className={`mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[11px] font-bold transition-colors ${boost ? 'bg-violet-500 text-white' : 'bg-white/8 text-slate-200 hover:bg-white/15'}`}
              >
                <Zap className="h-3.5 w-3.5" /> {boost ? 'Boost engaged' : 'Boost off'}
              </button>
            </div>
            <div className={`rounded-xl border p-4 transition-colors ${gameMode ? 'border-lime-400/40 bg-lime-500/10' : 'border-white/10 bg-[#141926]'}`}>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Gamepad2 className={`h-3.5 w-3.5 ${gameMode ? 'text-lime-300' : 'text-slate-500'}`} /> Game Mode
              </div>
              <p className="mt-1.5 text-[10px] leading-snug text-slate-500">Trims shadows, shortens transitions and reserves frame budget for Gaming Hub emulators.</p>
              <button
                type="button"
                onClick={() => setGameMode(!gameMode)}
                aria-pressed={gameMode}
                className={`mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[11px] font-bold transition-colors ${gameMode ? 'bg-lime-500 text-[#15230a]' : 'bg-white/8 text-slate-200 hover:bg-white/15'}`}
              >
                <Gamepad2 className="h-3.5 w-3.5" /> {gameMode ? 'Game Mode active' : 'Game Mode off'}
              </button>
              {gameMode && (
                <div className="mt-2 flex items-center gap-1 rounded-lg bg-lime-500/15 px-2 py-1 text-[9px] text-lime-300">
                  <Info className="h-3 w-3 flex-none" /> close heavy apps for the cleanest frame pacing
                </div>
              )}
            </div>
          </section>

          {/* hardware chips */}
          <section className="flex flex-wrap gap-1.5 text-[9px] text-slate-400">
            {typeof navigator !== 'undefined' && (
              <>
                <span className="rounded-full bg-white/5 px-2.5 py-1">DPR {window.devicePixelRatio}×</span>
                <span className="rounded-full bg-white/5 px-2.5 py-1">{navigator.hardwareConcurrency || '?'} threads</span>
                {(navigator as Navigator & { deviceMemory?: number }).deviceMemory ? (
                  <span className="rounded-full bg-white/5 px-2.5 py-1">{(navigator as Navigator & { deviceMemory?: number }).deviceMemory} GB RAM</span>
                ) : null}
                {(performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory ? (
                  <span className="rounded-full bg-white/5 px-2.5 py-1">
                    heap {Math.round((performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory!.usedJSHeapSize / 1048576)} / {Math.round((performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory!.jsHeapSizeLimit / 1048576)} MB
                  </span>
                ) : null}
              </>
            )}
          </section>

          <div className="pb-1 text-center text-[9px] text-slate-600">VXR-5 drivers v5.0.13 · RedSec graphics bridge · RedSec microkernel scheduler</div>
        </div>
      </div>
    </AppShell>
  )
}

/** hand-drawn FPS sparkline (no chart libs) */
function FpsChart({ history }: { history: number[] }) {
  const HEIGHT = 56
  const W = 560
  const pts = history.length ? history : [0]
  const max = Math.max(60, ...pts)
  const step = W / Math.max(59, pts.length - 1)
  const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(HEIGHT - (v / max) * (HEIGHT - 6) - 3).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${HEIGHT}`} className="h-14 w-full rounded-lg bg-black/30" preserveAspectRatio="none" role="img" aria-label="FPS history chart">
      {/* guides */}
      <line x1="0" y1={HEIGHT / 3} x2={W} y2={HEIGHT / 3} stroke="#ffffff14" strokeWidth="1" />
      <line x1="0" y1={(HEIGHT / 3) * 2} x2={W} y2={(HEIGHT / 3) * 2} stroke="#ffffff14" strokeWidth="1" />
      <path d={path} fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <text x="6" y="12" fill="#64748b" fontSize="9">60fps</text>
    </svg>
  )
}

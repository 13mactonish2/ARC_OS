// REDSEC v5.0 — Host for apps installed from the Open Store (HTML / link)
// 8.0 upgrade —
//   · GAME MODE: a pasted link classified as a GAME gets a real-time FPS
//     overlay (toggleable) + a benchmark recorder (toggleable) that measures
//     avg / min / max FPS across the session and keeps the last result.
//   · SIGN IN: every web app can hand off sign-in to any supported company
//     (Meta, Microsoft, Google, Oracle, NVIDIA, X…) through the Accounts hub.
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { RotateCw, ExternalLink, ShieldCheck, LogIn, Activity, Gauge } from 'lucide-react'
import { useOS } from '@/lib/os/store'
import { AppShell, Loading, WifiGate } from './_shared'
import { SignInHubModal } from './SignInHub'
import type { InstalledApp } from '@/lib/os/types'

/* ---------------- FPS meter + benchmark recorder ---------------- */

function useFpsMeter(enabled: boolean, onFrame: (fps: number) => void) {
  useEffect(() => {
    if (!enabled) return
    let raf = 0
    let frames = 0
    let last = performance.now()
    const tick = (now: number) => {
      frames++
      if (now - last >= 500) {
        const fps = Math.round((frames * 1000) / (now - last))
        onFrame(fps)
        frames = 0
        last = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
     
  }, [enabled])
}

function FpsOverlay({ appId }: { appId: string }) {
  const [fps, setFps] = useState(0)
  const [min, setMin] = useState(999)
  const [max, setMax] = useState(0)
  const [open, setOpen] = useState(false)
  useFpsMeter(true, (v) => {
    setFps(v)
    setMin((m) => Math.min(m, v))
    setMax((m) => Math.max(m, v))
    // feed the benchmark recorder ring buffer
    ringRef.push(v)
  })
  const color = fps >= 50 ? 'text-emerald-300' : fps >= 30 ? 'text-amber-300' : 'text-rose-300'
  return (
    <div className="absolute right-2 top-2 z-20 select-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 font-mono text-[11px] font-bold backdrop-blur ${color}`}
        title="Live FPS — click for session stats"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute h-2 w-2 animate-ping rounded-full bg-current opacity-40" />
          <span className="h-2 w-2 rounded-full bg-current" />
        </span>
        {fps || '—'} FPS
      </button>
      {open && (
        <div className="mt-1 rounded-lg bg-black/85 p-2 font-mono text-[10px] text-slate-300 backdrop-blur">
          <div className="flex justify-between gap-3"><span>avg</span><span>{ringRef.avg(appId)}</span></div>
          <div className="flex justify-between gap-3"><span>min</span><span>{min === 999 ? '—' : min}</span></div>
          <div className="flex justify-between gap-3"><span>max</span><span>{max || '—'}</span></div>
        </div>
      )}
    </div>
  )
}

/* benchmark ring buffer — shared per app window, lives outside React */
const benchBuffers = new Map<string, number[]>()
const ringRef = {
  push(v: number) {
    // the appId is passed via a module-level "current" set before mount
    if (!ringRef.cur) return
    const arr = benchBuffers.get(ringRef.cur) || []
    arr.push(v)
    if (arr.length > 900) arr.shift()
    benchBuffers.set(ringRef.cur, arr)
  },
  cur: '' as string,
  avg(id: string): string {
    const arr = benchBuffers.get(id) || []
    if (!arr.length) return '—'
    return `${Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)} fps`
  },
}

function saveBenchmark(id: string): string | null {
  const arr = benchBuffers.get(id) || []
  if (arr.length < 10) return null
  const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
  const min = Math.min(...arr)
  const max = Math.max(...arr)
  const seconds = Math.round(arr.length / 2) // samples land every ~500ms
  return JSON.stringify({ avg, min, max, seconds, at: Date.now() })
}

/* ---------------- main host ---------------- */

export default function InstalledAppHost({ args }: { winId: string; args?: Record<string, unknown> }) {
  const installedApps = useOS((s) => s.installedApps)
  const notify = useOS((s) => s.notify)
  const id = (args?.installedId as string) || ''
  const app = installedApps.find((a) => a.id === id)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const [signInOpen, setSignInOpen] = useState(false)

  /* wire the benchmark ring buffer to this app */
  useEffect(() => {
    ringRef.cur = id
    return () => {
      if (ringRef.cur === id) ringRef.cur = ''
    }
  }, [id])

  useEffect(() => {
    queueMicrotask(() => setLoading(true))
  }, [id, nonce])

  const patchApp = (patch: Partial<InstalledApp>) => {
    const st = useOS.getState()
    useOS.setState({ installedApps: st.installedApps.map((a) => (a.id === id ? { ...a, ...patch } : a)) })
  }

  const toggleFps = () => {
    if (!app) return
    patchApp({ fpsOverlay: !app.fpsOverlay })
    notify({ title: `FPS overlay ${!app.fpsOverlay ? 'ON' : 'OFF'}`, body: app.name, kind: 'success', emoji: '🎯' })
  }

  const toggleBench = () => {
    if (!app) return
    const next = !app.benchmarks
    patchApp({ benchmarks: next })
    if (!next) {
      const res = saveBenchmark(id)
      if (res) {
        patchApp({ lastBenchmark: res })
        const b = JSON.parse(res) as { avg: number; min: number; max: number; seconds: number }
        notify({ title: 'Benchmark saved', body: `${app.name} — avg ${b.avg} fps · min ${b.min} · max ${b.max} over ${b.seconds}s`, kind: 'success', emoji: '📊' })
      }
    } else {
      benchBuffers.set(id, [])
      notify({ title: 'Benchmark recording ON', body: `${app.name} — play for a while, then toggle OFF to save the result.`, kind: 'info', emoji: '📊' })
    }
  }

  if (!app) {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-4xl">📦</div>
          <div className="text-sm font-medium text-slate-300">App not found</div>
          <div className="text-xs text-slate-500">It may have been uninstalled. Open the Open Store to reinstall it.</div>
        </div>
      </AppShell>
    )
  }

  if (app.status === 'uninstalled') {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-4xl">🗑️</div>
          <div className="text-sm font-medium text-slate-300">{app?.name || 'App'} is uninstalled</div>
          <div className="text-xs text-slate-500">Open the Open Store → Installed to install it again.</div>
        </div>
      </AppShell>
    )
  }

  const bench = (() => {
    try {
      return app.lastBenchmark ? (JSON.parse(app.lastBenchmark) as { avg: number; min: number; max: number; seconds: number }) : null
    } catch {
      return null
    }
  })()

  return (
    <WifiGate app={app.name}>
      <AppShell>
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-white/10 bg-[#161b28] px-3 py-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-sky-400" />
          <span className="text-xs font-medium text-slate-300">{app.name}</span>
          <span className="rounded bg-white/6 px-1.5 py-0.5 text-[10px] text-slate-500">v{app.version || '1.0'} • sandboxed</span>
          {app.isGame && (
            <span className="flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
              <Gauge className="h-3 w-3" /> GAME
            </span>
          )}
          {bench && (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums text-emerald-300" title="Last saved benchmark">
              bench avg {bench.avg} · min {bench.min} · max {bench.max}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {app.kind === 'link' && app.url && (
              <button
                onClick={() => setSignInOpen(true)}
                title="Sign in — Meta, Microsoft, Google, Oracle, NVIDIA, X and more"
                className="flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] font-semibold text-emerald-300 hover:bg-emerald-500/15"
              >
                <LogIn className="h-3.5 w-3.5" /> Sign in
              </button>
            )}
            {app.isGame && (
              <>
                <button
                  onClick={toggleFps}
                  title="Toggle the live FPS overlay"
                  className={`flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] font-semibold ${app.fpsOverlay ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:bg-white/10'}`}
                >
                  <Activity className="h-3.5 w-3.5" /> FPS
                </button>
                <button
                  onClick={toggleBench}
                  title="Toggle benchmark recording — toggle OFF to save the session result"
                  className={`flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] font-semibold ${app.benchmarks ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:bg-white/10'}`}
                >
                  <Gauge className="h-3.5 w-3.5" /> Bench
                </button>
              </>
            )}
            <button
              onClick={() => setNonce((n) => n + 1)}
              title="Reload app"
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            {app.kind === 'link' && app.url && (
              <button
                onClick={() => window.open(app.url, '_blank')}
                title="Open externally"
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="relative min-h-0 flex-1 bg-white">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#10141f]">
              <Loading label={`Starting ${app.name}…`} />
            </div>
          )}
          {app.isGame && app.fpsOverlay && !loading && <FpsOverlay appId={id} />}
          {app.kind === 'html' && app.html ? (
            <iframe
              key={nonce}
              title={app.name}
              srcDoc={app.html}
              className="h-full w-full border-0 bg-white"
              /* Task 35 hardening — no allow-same-origin: every installed web app runs
                 in an opaque origin. It can script itself but can NEVER read the OS
                 localStorage/cookies/DOM — a hacked app stays inside its own cage. */
              sandbox="allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock"
              referrerPolicy="no-referrer"
              onLoad={() => setLoading(false)}
            />
          ) : app.kind === 'link' && app.url ? (
            <iframe
              key={nonce}
              title={app.name}
              src={app.url}
              className="h-full w-full border-0 bg-white"
              allow="fullscreen; autoplay; clipboard-write; camera; microphone"
              referrerPolicy="no-referrer"
              onLoad={() => setLoading(false)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">App has no content.</div>
          )}
          <SignInHubModal open={signInOpen} appName={app.name} onClose={() => setSignInOpen(false)} />
        </div>
      </AppShell>
    </WifiGate>
  )
}

// REDSEC v5.0 — Task 42: Screen 2 — Wide Screen extended display (pair tab)
//
// Opened via the screen link (origin/?screen=pair). Flow:
//   1. tab shows the 6-digit code entry
//   2. user types the code generated in Settings ▸ Wide Screen on the PC
//   3. BroadcastChannel pairs the tabs (no server → no lag)
//   4. the tab becomes a real extended display: windows sent from the PC
//      (title-bar ⭳ button or drag past the right edge) render here for
//      multitasking, and can be sent back or closed.
'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Monitor, MonitorUp, PlugZap, RotateCcw, Square, X } from 'lucide-react'
import { ws, useWsStatus, useWsScreens, type WsScreen } from '@/lib/os/widescreen'
import { APP_COMPONENTS, InstalledHost } from './registry'
import { AppIcon } from './AppIcon'

/* flip this tab into the ext role FIRST (also disables store persistence so
   the pair tab never writes over the PC's localStorage OS state) */
if (typeof window !== 'undefined') ws.markExt()

type Phase = 'reconnect' | 'code' | 'pairing'

export default function WideScreenPair() {
  const status = useWsStatus()
  const screens = useWsScreens()
  const paired = status.paired
  const [phase, setPhase] = useState<Phase>(() => {
    try {
      return sessionStorage.getItem('redsec-ws-ext') ? 'reconnect' : 'code'
    } catch {
      return 'code'
    }
  })
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''))
  const [err, setErr] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [full, setFull] = useState(false)
  const inputsRef = useRef<Array<HTMLInputElement | null>>([])

  /* auto-reconnect on reload while the PC still holds the pairing */
  const reconnectRan = useRef(false)
  useEffect(() => {
    if (paired || reconnectRan.current || phase !== 'reconnect') return
    reconnectRan.current = true
    let dead = false
    ;(async () => {
      let code = ''
      try {
        code = sessionStorage.getItem('redsec-ws-ext') || ''
      } catch { /* noop */ }
      const ok = code ? await ws.requestPair(code) : false
      if (!dead && !ok) setPhase('code')
    })()
    return () => {
      dead = true
    }
  }, [paired, phase])

  const submit = useCallback(async () => {
    const code = digits.join('')
    if (code.length !== 6 || /\D/.test(code)) {
      setErr('Enter the 6-digit code')
      return
    }
    setErr('')
    setPhase('pairing')
    const ok = await ws.requestPair(code)
    if (ok) {
      try {
        sessionStorage.setItem('redsec-ws-ext', code)
      } catch { /* noop */ }
      /* paired renders via status.paired */
    } else {
      setPhase('code')
      setErr('Could not reach the PC — keep the PC tab open on Settings ▸ Wide Screen, then press Connect again.')
      inputsRef.current[0]?.focus()
    }
  }, [digits])

  const submitRef = useRef<(() => Promise<void>) | null>(null)
  useEffect(() => {
    submitRef.current = submit
  }, [submit])

  /* never leave the UI stuck on the "linking" spinner — if the pairing drops
     (watchdog, PC tab closed) fall back to the code entry with digits kept */
  useEffect(() => {
    if (!paired && phase === 'pairing') {
      const t = setTimeout(() => setPhase('code'), 0)
      return () => clearTimeout(t)
    }
  }, [paired, phase])

  const setDigit = useCallback(
    (i: number, v: string) => {
      const clean = v.replace(/\D/g, '')
      if (!clean) {
        setDigits((d) => d.map((x, j) => (j === i ? '' : x)))
        return
      }
      setDigits((d) => {
        const nd = [...d]
        let k = i
        for (const ch of clean) {
          if (k > 5) break
          nd[k] = ch
          k++
        }
        const next = k < 6 ? k : 5
        setTimeout(() => inputsRef.current[next]?.focus(), 0)
        if (nd.every((x) => /\d/.test(x))) setTimeout(() => void submitRef.current?.(), 30)
        return nd
      })
    },
    [],
  )

  const activeScreen = useMemo(() => screens.find((s) => s.key === active) ?? screens[screens.length - 1] ?? null, [screens, active])

  /* ---------------- paired workspace ---------------- */
  if (paired) {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#07120e] text-slate-100" data-ws-ext="1">
        {/* top status bar */}
        {!full && (
          <header className="flex h-11 flex-none items-center justify-between border-b border-emerald-500/15 bg-[#0a1a14]/90 px-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/20 text-[11px] font-black text-emerald-300">R</span>
              <span className="text-[12px] font-semibold tracking-wide">REDSEC — Screen 2</span>
              <span className="ml-1 flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Extended display connected
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {screens.length > 0 && (
                <button onClick={() => { setFull((v) => !v); if (activeScreen) setActive(activeScreen.key) }} className="flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-slate-300 hover:bg-white/10" title={full ? 'Exit full screen' : 'Full screen this display'}>
                  <Square className="h-3 w-3" /> {full ? 'Exit full' : 'Full screen'}
                </button>
              )}
              <button onClick={() => ws.unpair('ext')} className="flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-1 text-[10.5px] font-medium text-rose-300 hover:bg-rose-500/25" title="Disconnect Screen 2">
                <X className="h-3 w-3" /> Unpair
              </button>
            </div>
          </header>
        )}
        <div className="flex min-h-0 flex-1">
          {/* screen rail */}
          {!full && (
            <aside className="flex w-44 flex-none flex-col gap-1.5 overflow-y-auto border-r border-white/8 bg-[#081510]/80 p-2 os-scroll">
              <div className="px-1 pb-1 text-[9.5px] font-bold uppercase tracking-widest text-slate-500">Sent windows ({screens.length})</div>
              {screens.length === 0 && (
                <div className="rounded-lg border border-dashed border-white/10 p-2.5 text-[10px] leading-relaxed text-slate-500">
                  Nothing on Screen 2 yet. On the PC: press <b className="text-slate-300">⭳</b> in a window title bar, or drag a window past the right screen edge.
                </div>
              )}
              {screens.map((s) => (
                <button key={s.key} onClick={() => setActive(s.key)} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${activeScreen?.key === s.key ? 'border-emerald-400/40 bg-emerald-500/15' : 'border-white/8 bg-white/[0.03] hover:bg-white/8'}`}>
                  <AppIcon appId={s.appId} size={14} />
                  <span className="truncate text-[10.5px] text-slate-200">{s.title}</span>
                </button>
              ))}
            </aside>
          )}
          {/* active window area */}
          <main className="relative min-w-0 flex-1 overflow-hidden bg-[#0b1220]">
            {activeScreen ? <ExtWindow screen={activeScreen} full={full} onBack={() => ws.sendBack(activeScreen)} onClose={() => ws.closeScreen(activeScreen.key)} onFull={() => setFull((v) => !v)} fullAllowed /> : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="relative">
                  <Monitor className="h-16 w-16 text-emerald-500/25" />
                  <MonitorUp className="absolute -right-2 -top-2 h-6 w-6 text-emerald-400/60" />
                </div>
                <div className="text-sm font-semibold text-slate-200">Screen 2 is ready</div>
                <p className="max-w-xs text-[11px] leading-relaxed text-slate-500">
                  Wide Screen dual connect is active. Send any app window here from the PC — perfect for multitasking: work on Screen 1, reference on Screen 2.
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    )
  }

  /* ---------------- pairing (code entry) ---------------- */
  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center overflow-hidden bg-[#07120e] px-4 text-slate-100" data-ws-ext="1">
      {/* ambient glow */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #34d399 1px, transparent 0)', backgroundSize: '26px 26px' }} />

      <div className="relative w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-500/15 shadow-lg shadow-emerald-500/10">
            <PlugZap className="h-7 w-7 text-emerald-300" />
          </div>
          <h1 className="text-lg font-bold tracking-tight">Screen 2 — Extended Display</h1>
          <p className="mt-1 text-[12px] text-slate-400">
            {phase === 'reconnect' ? 'Reconnecting to the PC…' : phase === 'pairing' ? 'Linking with the PC…' : 'Enter the 6-digit code shown in Settings ▸ Wide Screen on the PC'}
          </p>
        </div>

        {phase !== 'code' ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
            <span className="text-[11px] text-slate-400">{phase === 'reconnect' ? 'Restoring previous Wide Screen session…' : 'Waiting for the PC to accept the code…'}</span>
          </div>
        ) : (
          <div className={`rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/40 ${err ? 'animate-[shakeW_0.32s_ease]' : ''}`}>
            <div className="mb-4 flex justify-center gap-2" onPaste={(e) => {
              const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
              if (pasted.length > 1) {
                e.preventDefault()
                setDigits(pasted.padEnd(6, '').slice(0, 6).split(''))
                if (pasted.length === 6) setTimeout(() => void submitRef.current?.(), 60)
              }
            }}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { inputsRef.current[i] = el }}
                  value={d}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !digits[i] && i > 0) inputsRef.current[i - 1]?.focus()
                    if (e.key === 'ArrowLeft' && i > 0) inputsRef.current[i - 1]?.focus()
                    if (e.key === 'ArrowRight' && i < 5) inputsRef.current[i + 1]?.focus()
                    if (e.key === 'Enter') void submit()
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label={`Digit ${i + 1}`}
                  maxLength={6}
                  className="h-14 w-11 rounded-xl border border-white/12 bg-[#0b1a13] text-center text-2xl font-bold text-emerald-200 outline-none transition-all placeholder:text-slate-700 focus:border-emerald-400/70 focus:bg-emerald-500/10 focus:shadow-[0_0_0_3px_rgba(52,211,153,0.15)]"
                />
              ))}
            </div>
            {err && (
              <div className="mb-3 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-center text-[11px] font-medium text-rose-300">
                {err}
              </div>
            )}
            <button onClick={() => void submit()} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60">
              <Monitor className="h-4 w-4" /> Connect as Screen 2
            </button>
            <div className="mt-4 space-y-1.5 border-t border-white/8 pt-3 text-[10.5px] leading-relaxed text-slate-500">
              <div className="flex gap-2"><span className="text-emerald-400/70">1.</span> On the PC open <b className="text-slate-300">Settings ▸ Wide Screen</b></div>
              <div className="flex gap-2"><span className="text-emerald-400/70">2.</span> Requires a detected HDMI cable (Wide Screen hides without one)</div>
              <div className="flex gap-2"><span className="text-emerald-400/70">3.</span> Enter the code above — this tab becomes the extended display</div>
              <div className="flex gap-2"><span className="text-emerald-400/70">4.</span> Works from another device too (phone / tablet) — keep the PC tab open</div>
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-center gap-2 text-[10px] text-slate-600">
          <RotateCcw className="h-3 w-3" /> This tab is Screen 2 — close it any time to end Wide Screen
        </div>
      </div>
    </div>
  )
}

/* ---------------- one app window living on Screen 2 ---------------- */
function ExtWindow({ screen, full, onBack, onClose, onFull, fullAllowed }: { screen: WsScreen; full: boolean; onBack: () => void; onClose: () => void; onFull: () => void; fullAllowed: boolean }) {
  const Cmp = APP_COMPONENTS[screen.appId]
  return (
    <div className="flex h-full w-full flex-col overflow-hidden border border-white/10 bg-[#10141f] shadow-2xl">
      <div className="flex h-9 flex-none items-center justify-between border-b border-white/8 bg-[#151a26] px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <AppIcon appId={screen.appId} size={15} />
          <span className="truncate text-xs font-medium text-slate-200">{screen.title}</span>
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider text-emerald-300">Screen 2</span>
        </div>
        <div className="flex items-center gap-0.5">
          {fullAllowed && (
            <button onClick={onFull} title={full ? 'Restore' : 'Full screen'} className="flex h-7 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-white/10 hover:text-white">
              <Square className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={onBack} title="Send back to the PC (Screen 1)" className="flex h-7 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-white/10 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button onClick={onClose} title="Close" className="flex h-7 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-rose-600 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0e1220]">
        {Cmp ? <Cmp winId={`ext_${screen.key}`} args={screen.args} /> : screen.appId.startsWith('inst:') ? <InstalledHost appId={screen.appId} /> : (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">This app cannot be shown on Screen 2.</div>
        )}
      </div>
    </div>
  )
}

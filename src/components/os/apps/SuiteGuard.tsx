// REDSEC 5.0 — Open Suite gate: wraps every Open Suite app with the
// activation licensing flow. Unlicensed apps run a 5-minute free demo with a
// live countdown ribbon; when the demo is used up (or an activation pack
// expires) the app is replaced by an "activate" screen that deep-links into
// the App Store → Open Suite section.
'use client'

import React from 'react'
import { KeyRound, Lock, Store, Timer, ShieldCheck } from 'lucide-react'
import { useOS, APP_META } from '@/lib/os/store'
import { useSuiteGate, fmtDemoClock, type SuiteAppId } from '@/lib/os/suite'

function openSuiteStore(): void {
  useOS.getState().openApp('appstore', { section: 'suite' }, 'App Store — Open Suite')
}

/** live demo ribbon (bottom of the app while the free demo is running) */
function DemoRibbon({ app, remaining }: { app: SuiteAppId; remaining: number }) {
  const meta = APP_META[app]
  const urgent = remaining <= 60
  return (
    <div
      className={`pointer-events-auto absolute inset-x-0 bottom-0 z-30 flex flex-wrap items-center justify-center gap-2 border-t px-3 py-1.5 text-[11px] backdrop-blur-md transition-colors ${
        urgent ? 'border-amber-400/30 bg-amber-950/70 text-amber-200' : 'border-white/10 bg-[#0c101c]/85 text-slate-300'
      }`}
      role="status"
    >
      <Timer className={`h-3.5 w-3.5 ${urgent ? 'text-amber-300' : 'text-slate-400'}`} />
      <span>
        Free demo — <span className={`font-mono font-semibold ${urgent ? 'text-amber-300' : 'text-slate-100'}`}>{fmtDemoClock(remaining)}</span> left in {meta?.name || app}
      </span>
      <span className="hidden sm:inline text-slate-500">· after the demo ends, activate the package in the store</span>
      <button
        type="button"
        onClick={openSuiteStore}
        className="ml-1 flex h-6 items-center gap-1 rounded-md bg-sky-600 px-2.5 text-[10.5px] font-semibold text-white hover:bg-sky-500"
      >
        <Store className="h-3 w-3" /> Activate
      </button>
    </div>
  )
}

/** full gate screen once the demo is used up or a pack has expired */
function GateScreen({ app, expired }: { app: SuiteAppId; expired: boolean }) {
  const meta = APP_META[app]
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[#0c101c] p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-rose-500/25 bg-rose-950/30">
        {expired ? <Lock className="h-9 w-9 text-rose-300" /> : <KeyRound className="h-9 w-9 text-amber-300" />}
      </div>
      <div>
        <div className="text-lg font-semibold text-slate-100">
          {expired ? `${meta?.name || app} — activation expired` : `${meta?.name || app} — free demo ended`}
        </div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
          {expired
            ? 'Your activation pack has run out. Go to the store and activate the software package to keep using this app.'
            : 'You used the full 5-minute free demo. Go to the store and activate the software package — activation is free and takes one click.'}
        </p>
      </div>
      <button
        type="button"
        onClick={openSuiteStore}
        className="flex h-11 items-center gap-2 rounded-lg bg-sky-600 px-6 text-sm font-semibold text-white shadow-lg shadow-sky-900/40 hover:bg-sky-500"
      >
        <Store className="h-4 w-4" /> Go to Store — activate the package
      </button>
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
        Open Suite packs: 1 month · 3 months · 1 year — all free for REDSEC v6.0 users
      </div>
    </div>
  )
}

export function SuiteGuard({ app, children }: { app: SuiteAppId; children: React.ReactNode }) {
  const gate = useSuiteGate(app)
  if (gate.status === 'blocked') return <GateScreen app={app} expired={gate.reason === 'expired'} />
  return (
    <div className="relative h-full w-full">
      {children}
      {gate.status === 'demo' && <DemoRibbon app={app} remaining={gate.remaining} />}
    </div>
  )
}

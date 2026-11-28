// REDSEC v5.0 — Graphic Calculator (Desmos in-frame)
'use client'

import { useState } from 'react'
import { ExternalLink, LineChart, Loader2, RotateCw } from 'lucide-react'
import { AppShell, TBtn, Toolbar, WifiGate } from './_shared'

const DESMOS_URL = 'https://www.desmos.com/calculator'

export default function GraphCalcApp({ winId, args }: { winId: string; args?: Record<string, unknown> }) {
  const [reload, setReload] = useState(0)
  const [loaded, setLoaded] = useState(false)

  const doReload = () => {
    setLoaded(false)
    setReload((r) => r + 1)
  }

  return (
    <WifiGate app="Graphic Calc">
      <AppShell>
        <Toolbar>
          <LineChart className="mx-1 h-4 w-4 flex-none text-teal-300" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-slate-200">Graphic Calculator</div>
            <div className="text-[10px] text-slate-500">Desmos · type equations on the left panel</div>
          </div>
          <TBtn title="Reload" onClick={doReload}>
            <RotateCw className={`h-4 w-4 ${loaded ? '' : 'animate-spin'}`} />
          </TBtn>
          <TBtn title="Open in browser tab" onClick={() => window.open(DESMOS_URL, '_blank')}>
            <ExternalLink className="h-4 w-4" />
          </TBtn>
        </Toolbar>
        <div className="relative min-h-0 flex-1">
          <iframe
            key={reload}
            src={DESMOS_URL}
            title="Desmos Graphing Calculator"
            className="h-full w-full border-0 bg-white"
            allow="fullscreen; autoplay; clipboard-write"
            onLoad={() => setLoaded(true)}
          />
          {!loaded && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#10141f]">
              <Loader2 className="h-6 w-6 animate-spin text-teal-300" />
              <div className="text-xs text-slate-400">Plotting the grid…</div>
            </div>
          )}
        </div>
      </AppShell>
    </WifiGate>
  )
}

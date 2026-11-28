// REDSEC 5.0 — "Our Website" app: the project showcase site (public/website)
// rendered inside an OS window, with open-external + reload controls.
'use client'

import React, { useRef, useState } from 'react'
import { ExternalLink, RotateCw } from 'lucide-react'
import { AppShell } from './_shared'

const SITE_URL = '/website/index.html'

export default function WebsiteApp() {
  const [nonce, setNonce] = useState(0)
  const [loading, setLoading] = useState(true)
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <div className="flex flex-none items-center gap-2 border-b border-white/10 bg-[#161b28] px-3 py-1.5">
          <span className="rounded bg-rose-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white">OFFICIAL SITE</span>
          <span className="truncate text-xs text-slate-500">/website — RedSec OS showcase</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => {
                setLoading(true)
                setNonce((n) => n + 1)
              }}
              title="Reload"
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => window.open(SITE_URL, '_blank')}
              title="Open in browser tab"
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0b0f19]">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-rose-500/30 border-t-rose-500" />
                <span className="text-xs text-slate-500">Loading website…</span>
              </div>
            </div>
          )}
          <iframe
            ref={frameRef}
            key={nonce}
            src={SITE_URL}
            title="RedSec OS website"
            onLoad={() => setLoading(false)}
            className="h-full w-full border-0 bg-[#0b0f19]"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          />
        </div>
      </div>
    </AppShell>
  )
}

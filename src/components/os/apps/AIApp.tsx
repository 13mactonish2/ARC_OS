// REDSEC v5.0 — AI (easemate.ai chat in-frame with friendly fallback)
'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, RotateCw, Sparkles } from 'lucide-react'
import { AppShell, TBtn, Toolbar, WifiGate } from './_shared'

const AI_URL = 'https://www.easemate.ai/ai-chat'

export default function AIApp({ winId, args }: { winId: string; args?: Record<string, unknown> }) {
  const [reload, setReload] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (loaded) return
    const t = setTimeout(() => setSlow(true), 9000)
    return () => clearTimeout(t)
  }, [loaded])

  const doReload = () => {
    setLoaded(false)
    setSlow(false)
    setReload((r) => r + 1)
  }

  return (
    <WifiGate app="AI">
      <AppShell>
        <Toolbar>
          <Sparkles className="mx-1 h-4 w-4 flex-none text-fuchsia-300" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-slate-200">AI Assistant</div>
            <div className="text-[10px] text-slate-500">easemate.ai · chat in-frame</div>
          </div>
          <TBtn title="Reload" onClick={doReload}>
            <RotateCw className={`h-4 w-4 ${loaded ? '' : 'animate-spin'}`} />
          </TBtn>
          <TBtn title="Open easemate.ai in a browser tab" onClick={() => window.open(AI_URL, '_blank')}>
            <ExternalLink className="h-4 w-4" />
          </TBtn>
        </Toolbar>

        <div className="relative min-h-0 flex-1">
          <iframe
            key={reload}
            src={AI_URL}
            title="AI Assistant — easemate.ai"
            className="h-full w-full border-0 bg-white"
            allow="fullscreen; autoplay; clipboard-write; camera; microphone"
            onLoad={() => setLoaded(true)}
          />
          {!loaded && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#10141f]">
              <Loader2 className="h-6 w-6 animate-spin text-fuchsia-300" />
              <div className="text-xs text-slate-400">Waking up the AI…</div>
            </div>
          )}
          {slow && !loaded && (
            <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 border-t border-white/10 bg-[#161b28] p-4 text-center">
              <div className="text-xs text-slate-300">
                The AI site is taking a while — it may be slow or refuse embedding.
              </div>
              <div className="flex gap-2">
                <TBtn onClick={doReload}>Retry</TBtn>
                <TBtn onClick={() => window.open(AI_URL, '_blank')}>
                  <ExternalLink className="h-3.5 w-3.5" /> Open easemate.ai
                </TBtn>
              </div>
            </div>
          )}
        </div>
      </AppShell>
    </WifiGate>
  )
}

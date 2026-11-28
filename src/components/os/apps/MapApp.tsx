// REDSEC v5.0 — Map (Google Maps embed + location search via output=embed)
'use client'

import { useState } from 'react'
import { Loader2, Map as MapIcon, MapPin, RotateCw, Search } from 'lucide-react'
import { AppShell, TBtn, Toolbar, WifiGate, useVoiceTyping } from './_shared'

const DEFAULT_EMBED =
  'https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d10614.564339207162!2d88.37455714608603!3d22.572476659871867!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1sen!2sin!4v1769314986227!5m2!1sen!2sin'

export default function MapApp({ winId, args }: { winId: string; args?: Record<string, unknown> }) {
  const [q, setQ] = useState('')
  const [src, setSrc] = useState<string>(
    typeof args?.query === 'string' && args.query.trim()
      ? `https://www.google.com/maps?q=${encodeURIComponent(args.query.trim())}&output=embed`
      : DEFAULT_EMBED
  )
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)

  useVoiceTyping((text) => setQ((prev) => (prev ? `${prev} ${text}` : text)))

  const doSearch = () => {
    const query = q.trim()
    if (!query) return
    setLoading(true)
    setSrc(`https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`)
  }

  return (
    <WifiGate app="Map">
      <AppShell>
        <Toolbar>
          <MapIcon className="mx-1 h-4 w-4 flex-none text-emerald-300" />
          <div className="relative mx-1 min-w-0 flex-1">
            <Search className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSearch()
                if (e.key === 'Escape') setQ('')
              }}
              placeholder="Search a place, address or landmark…"
              className="h-9 w-full rounded-full border border-white/10 bg-[#0e1320] pr-3 pl-9 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20 focus:outline-none"
            />
          </div>
          <TBtn title="Search location" onClick={doSearch}>
            <MapPin className="h-4 w-4" />
          </TBtn>
          <TBtn
            title="Default view (Kolkata)"
            onClick={() => {
              setLoading(true)
              setSrc(DEFAULT_EMBED)
            }}
          >
            Home
          </TBtn>
          <TBtn
            title="Reload map"
            onClick={() => {
              setLoading(true)
              setReload((r) => r + 1)
            }}
          >
            <RotateCw className="h-4 w-4" />
          </TBtn>
        </Toolbar>
        <div className="relative min-h-0 flex-1">
          <iframe
            key={`${src}:${reload}`}
            src={src}
            title="REDSEC Map"
            className="h-full w-full border-0"
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={() => setLoading(false)}
          />
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#10141f]">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-300" />
              <div className="text-xs text-slate-400">Loading map…</div>
            </div>
          )}
        </div>
      </AppShell>
    </WifiGate>
  )
}

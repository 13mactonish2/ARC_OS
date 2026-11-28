// REDSEC v5.0.2 — Secret Tab: a zero-history browser window.
// Black screen. One search button. Nothing is recorded — no Records entries,
// no "recent apps" churn, no persistence beyond the window itself.
'use client'

import { useMemo, useRef, useState } from 'react'
import { Ghost, Loader2, Search as SearchIcon, ShieldX } from 'lucide-react'
import { AppShell } from './_shared'

type Engine = 'google' | 'ddg' | 'bing'
const ENGINE_LABEL: Record<Engine, string> = { google: 'G', ddg: 'D', bing: 'B' }
const ENGINE_NEXT: Record<Engine, Engine> = { google: 'ddg', ddg: 'bing', bing: 'google' }

function isUrlLike(s: string): boolean {
  const t = s.trim()
  if (!t || /\s/.test(t)) return false
  if (/^https?:\/\//i.test(t)) return true
  if (/^localhost(:\d+)?(\/|$)/i.test(t)) return true
  return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(t)
}

function frameSrcFor(query: string, engine: Engine): string {
  if (isUrlLike(query)) {
    const url = /^https?:\/\//i.test(query) ? query : `https://${query}`
    return `/api/proxy?url=${encodeURIComponent(url)}`
  }
  if (engine === 'ddg') {
    return `/api/proxy?url=${encodeURIComponent(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`)}`
  }
  if (engine === 'bing') {
    return `https://www.bing.com/search?q=${encodeURIComponent(query)}&form=QBLH`
  }
  return `https://www.google.com/search?igu=1&q=${encodeURIComponent(query)}`
}

export default function SecretTabApp() {
  const [query, setQuery] = useState('')
  const [input, setInput] = useState('')
  const [engine, setEngine] = useState<Engine>('google')
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const src = useMemo(() => (query ? `${frameSrcFor(query, engine)}${reload ? (frameSrcFor(query, engine).includes('?') ? '&' : '?') + `__rf=${reload}` : ''}` : ''), [query, engine, reload])

  const search = () => {
    const q = input.trim()
    if (!q) return
    setQuery(q)
    setLoading(true)
    setReload((r) => r + 1)
  }

  return (
    <AppShell>
      <div className="relative flex h-full flex-col bg-black">
        {/* minimal top strip — search button only, no address history, no records */}
        <div className="flex flex-none items-center gap-2 border-b border-white/8 bg-black px-3 py-2">
          <Ghost className="h-3.5 w-3.5 text-white/40" />
          <span className="text-[11px] font-medium tracking-wide text-white/50">SECRET TAB</span>
          <span className="hidden rounded bg-white/8 px-1.5 py-0.5 text-[9.5px] text-white/40 sm:inline">nothing is saved</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => {
                setEngine((e) => ENGINE_NEXT[e])
                if (query) setReload((r) => r + 1)
              }}
              title="Switch search engine"
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-white/50 hover:bg-white/10 hover:text-white"
            >
              engine
              <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-white/15 text-[9px] font-bold text-white">{ENGINE_LABEL[engine]}</span>
            </button>
          </div>
        </div>

        {/* idle state: pure black + one search button */}
        {!query && (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6">
            <Ghost className="h-14 w-14 text-white/10" />
            <div className="text-center">
              <div className="text-lg font-semibold text-white/85">Secret Tab</div>
              <div className="mt-1 max-w-sm text-xs leading-relaxed text-white/40">
                What happens here stays here — searches and sites are never written to Records, recents or storage.
              </div>
            </div>
            <div className="flex w-full max-w-lg items-center gap-2">
              <div className="relative flex-1">
                <SearchIcon className="absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-white/30" />
                <input
                  ref={inputRef}
                  autoFocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && search()}
                  placeholder="Search or enter address…"
                  spellCheck={false}
                  className="h-12 w-full rounded-full border border-white/12 bg-white/[0.06] pr-4 pl-11 text-sm text-white placeholder:text-white/30 focus:border-white/35 focus:ring-2 focus:ring-white/15 focus:outline-none"
                />
              </div>
              <button
                onClick={search}
                className="flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-black transition-transform hover:scale-[1.03] active:scale-95"
              >
                <SearchIcon className="h-4 w-4" /> Search
              </button>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-white/25">
              <ShieldX className="h-3 w-3" /> no history · no cookies kept · no Records
            </div>
          </div>
        )}

        {/* results — iframe over pure black, floating search button only */}
        {query && (
          <>
            <div className="relative min-h-0 flex-1 bg-black">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
                  <Loader2 className="h-7 w-7 animate-spin text-white/40" />
                </div>
              )}
              <iframe
                key={`${query}:${engine}:${reload}`}
                src={src}
                title="Secret Tab results"
                className={`h-full w-full border-0 bg-black ${loading ? 'opacity-0' : 'opacity-100'}`}
                allow="fullscreen; autoplay; clipboard-write"
                referrerPolicy="no-referrer"
                onLoad={() => setLoading(false)}
              />
            </div>
            <div className="pointer-events-none absolute bottom-5 left-1/2 z-20 -translate-x-1/2">
              <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/12 bg-black/85 px-2 py-1.5 shadow-2xl backdrop-blur">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && search()}
                  placeholder="Search secretly…"
                  spellCheck={false}
                  className="h-8 w-56 rounded-full bg-transparent px-3 text-xs text-white placeholder:text-white/30 focus:outline-none sm:w-72"
                />
                <button
                  onClick={search}
                  title="Search"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105 active:scale-95"
                >
                  <SearchIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => {
                    setQuery('')
                    setInput('')
                    setLoading(false)
                    queueMicrotask(() => inputRef.current?.focus())
                  }}
                  title="Close this page — back to black"
                  className="flex h-8 items-center rounded-full px-3 text-[11px] font-medium text-white/60 hover:bg-white/10 hover:text-white"
                >
                  Clear
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

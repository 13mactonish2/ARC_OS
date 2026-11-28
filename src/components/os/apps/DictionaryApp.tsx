// REDSEC v5.0 — Dictionary (Wikipedia REST summary + mobile-wiki article frame)
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, ExternalLink, Loader2, Mic, Search } from 'lucide-react'
import { AppShell, EmptyState, TBtn, Toolbar, WifiGate, useVoiceTyping } from './_shared'

interface WikiSummary {
  title: string
  description?: string
  extract: string
  thumbnail?: { source: string }
  content_urls?: { desktop?: { page?: string } }
}

const RECENTS_KEY = 'redsec4.dict.recents'

function wikiSlug(title: string): string {
  return encodeURIComponent(title.trim().replace(/\s+/g, '_'))
}

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

export default function DictionaryApp({ winId, args }: { winId: string; args?: Record<string, unknown> }) {
  const [q, setQ] = useState('')
  const [card, setCard] = useState<WikiSummary | null>(null)
  const [article, setArticle] = useState<string | null>(null)
  const [frameLoading, setFrameLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [recents, setRecents] = useState<string[]>(loadRecents)
  const ranInit = useRef(false)

  const lookup = useCallback(async (raw: string) => {
    const title = raw.trim()
    if (!title) return
    setQ(title)
    setErr('')
    setLoading(true)
    setCard(null)
    setArticle(null)
    try {
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${wikiSlug(title)}`)
      if (!res.ok) {
        throw new Error(
          res.status === 404 ? `No Wikipedia page found for “${title}”.` : `Wikipedia responded with ${res.status}.`
        )
      }
      const j = (await res.json()) as WikiSummary
      setCard(j)
      setRecents((prev) => {
        const next = [title, ...prev.filter((x) => x.toLowerCase() !== title.toLowerCase())].slice(0, 8)
        try {
          localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
        } catch {
          /* storage full / blocked */
        }
        return next
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lookup failed.')
    } finally {
      setLoading(false)
    }
  }, [])

  /* initial lookup from args */
  useEffect(() => {
    const s = args?.search
    if (typeof s === 'string' && s.trim() && !ranInit.current) {
      ranInit.current = true
      void lookup(s)
    }
  }, [args, lookup])

  useVoiceTyping((text) => setQ((prev) => (prev ? `${prev} ${text}` : text)))

  /* ------------ article reader view ------------ */
  if (article) {
    return (
      <WifiGate app="Dictionary">
        <AppShell>
          <Toolbar>
            <TBtn
              title="Back"
              onClick={() => {
                setArticle(null)
                setFrameLoading(true)
              }}
            >
              <ArrowLeft className="h-4 w-4" />
            </TBtn>
            <BookOpen className="mx-1 h-4 w-4 flex-none text-purple-300" />
            <div className="min-w-0 flex-1 truncate text-xs text-slate-300">{article}</div>
            <TBtn title="Open in browser tab" onClick={() => window.open(`https://en.wikipedia.org/wiki/${wikiSlug(article)}`, '_blank')}>
              <ExternalLink className="h-4 w-4" />
            </TBtn>
          </Toolbar>
          <div className="relative min-h-0 flex-1">
            <iframe
              src={`https://en.m.wikipedia.org/wiki/${wikiSlug(article)}`}
              title={`Wikipedia — ${article}`}
              className="h-full w-full border-0 bg-white"
              onLoad={() => setFrameLoading(false)}
            />
            {frameLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#10141f]">
                <Loader2 className="h-6 w-6 animate-spin text-purple-300" />
                <div className="text-xs text-slate-400">Loading article…</div>
              </div>
            )}
          </div>
        </AppShell>
      </WifiGate>
    )
  }

  /* ------------ lookup view ------------ */
  return (
    <WifiGate app="Dictionary">
      <AppShell>
        <div className="os-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-5 py-8">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/15">
                <BookOpen className="h-6 w-6 text-purple-300" />
              </div>
              <div>
                <div className="text-lg font-semibold text-slate-100">Dictionary</div>
                <div className="text-[11px] text-slate-500">Powered by Wikipedia — search any word, place or person</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void lookup(q)}
                  placeholder="Type a word or topic…"
                  className="h-12 w-full rounded-xl border border-white/10 bg-[#161b28] pr-4 pl-10 text-sm text-slate-100 placeholder:text-slate-500 focus:border-purple-400/60 focus:ring-2 focus:ring-purple-400/20 focus:outline-none"
                />
              </div>
              <TBtn title="Voice typing (speak while window is focused)" className="h-12 w-12">
                <Mic className="h-4 w-4" />
              </TBtn>
              <button
                onClick={() => void lookup(q)}
                className="h-12 rounded-xl bg-purple-500 px-5 text-sm font-medium text-white transition-colors hover:bg-purple-400"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
              </button>
            </div>

            {recents.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500">Recent:</span>
                {recents.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => void lookup(r)}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-slate-300 transition-colors hover:border-purple-400/40 hover:text-white"
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}

            {loading && (
              <div className="mt-8 animate-pulse rounded-xl border border-white/10 bg-white/[0.03] p-5">
                <div className="h-4 w-1/3 rounded bg-white/[0.08]" />
                <div className="mt-3 h-3 w-full rounded bg-white/[0.06]" />
                <div className="mt-2 h-3 w-5/6 rounded bg-white/[0.06]" />
              </div>
            )}

            {!loading && err && (
              <div className="mt-8 flex flex-col items-center gap-3">
                <EmptyState icon="🔎" title="Not found" sub={err} />
                <TBtn onClick={() => void lookup(q)}>Retry</TBtn>
              </div>
            )}

            {!loading && !err && !card && (
              <EmptyState
                icon="📖"
                title="Look up anything"
                sub="Get a quick summary card, then open the full Wikipedia article right inside REDSEC."
              />
            )}

            {!loading && card && (
              <div className="mt-8 overflow-hidden rounded-xl border border-white/10 bg-[#161b28]">
                {card.thumbnail?.source && (
                  <img src={card.thumbnail.source} alt={card.title} className="max-h-56 w-full object-cover" />
                )}
                <div className="p-5">
                  <div className="text-base font-semibold text-slate-100">{card.title}</div>
                  {card.description && <div className="mt-0.5 text-xs text-purple-300/90">{card.description}</div>}
                  <p className="mt-3 text-[13px] leading-relaxed text-slate-300">{card.extract}</p>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => {
                        setArticle(card.title)
                        setFrameLoading(true)
                      }}
                      className="flex h-10 items-center gap-2 rounded-lg bg-purple-500 px-4 text-xs font-medium text-white transition-colors hover:bg-purple-400"
                    >
                      <BookOpen className="h-4 w-4" /> Open full article
                    </button>
                    <TBtn
                      title="Open in browser tab"
                      onClick={() => window.open(`https://en.wikipedia.org/wiki/${wikiSlug(card.title)}`, '_blank')}
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> External
                    </TBtn>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </AppShell>
    </WifiGate>
  )
}

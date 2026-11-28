// REDSEC — Extension upgrade: uploaded extension links (shared by Settings
// and the Setup wizard). Users can UPLOAD their own extension store links
// for any browser — the links are stored server-side so they:
//   - SAVE FOREVER (they survive a factory reset — the DB is never wiped),
//   - DISTRIBUTED TO ALL OS USERS (every device reads the same table).
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Link2, Loader2, Puzzle, Trash2, X } from 'lucide-react'

export type ExtBrowser = 'chrome' | 'firefox' | 'edge' | 'all'

export interface ExtLinkRow {
  id: string
  browser: ExtBrowser
  name: string
  url: string
  desc: string
  color: string
  createdAt: string
}

const BROWSER_LABEL: Record<ExtBrowser, string> = {
  chrome: 'Google Chrome',
  firefox: 'Mozilla Firefox',
  edge: 'Microsoft Edge',
  all: 'All browsers',
}

/** fetch + add + remove — one shared store for every surface */
export function useCustomExtLinks() {
  const [links, setLinks] = useState<ExtLinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/extlinks', { cache: 'no-store' })
      const j = (await r.json()) as { ok?: boolean; links?: ExtLinkRow[] }
      if (alive.current) setLinks(Array.isArray(j.links) ? j.links : [])
    } catch {
      /* offline — keep whatever we have */
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    return () => {
      alive.current = false
    }
  }, [refresh])

  const add = useCallback(
    async (input: { name: string; url: string; browser: ExtBrowser; desc?: string; color?: string }) => {
      const r = await fetch('/api/extlinks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const j = (await r.json()) as { ok?: boolean; link?: ExtLinkRow; error?: string }
      if (!j.ok || !j.link) throw new Error(j.error || 'Could not save the link.')
      await refresh()
      return j.link
    },
    [refresh]
  )

  const remove = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/extlinks?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      } finally {
        await refresh()
      }
    },
    [refresh]
  )

  /** custom rows that belong to a given browser tab ('all' rows appear everywhere) */
  const forBrowser = useCallback(
    (b: Exclude<ExtBrowser, 'all'>) => links.filter((l) => l.browser === b || l.browser === 'all'),
    [links]
  )

  return { links, loading, refresh, add, remove, forBrowser }
}

/* ---------------- upload form ---------------- */

export function ExtUploadForm({
  open,
  defaultBrowser,
  add,
  onClose,
  onSaved,
}: {
  open: boolean
  defaultBrowser: Exclude<ExtBrowser, 'all'>
  add: (input: { name: string; url: string; browser: ExtBrowser; desc?: string }) => Promise<unknown>
  onClose: () => void
  onSaved: (name: string) => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [desc, setDesc] = useState('')
  const [browser, setBrowser] = useState<ExtBrowser>(defaultBrowser)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setUrl('')
      setDesc('')
      setBrowser(defaultBrowser)
      setErr('')
    }
  }, [open, defaultBrowser])

  if (!open) return null

  const submit = async () => {
    setErr('')
    setBusy(true)
    try {
      await add({ name, url, browser, desc: desc || undefined })
      onSaved(name)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the link.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-sky-400/25 bg-sky-400/[0.04] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-sky-200">
          <Link2 className="h-4 w-4" /> Upload an extension link
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        Saved forever in the OS — survives a factory reset and is distributed to every OS user.
      </p>
      <div className="mt-3 grid gap-2.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Extension name — e.g. Ad Guard Pro"
          className="h-9 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-sky-400/50"
          aria-label="Extension name"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Store link — https://chromewebstore.google.com/detail/…"
          className="h-9 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-sky-400/50"
          aria-label="Extension link URL"
        />
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Description (optional)"
          className="h-9 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-sky-400/50"
          aria-label="Extension description"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">Browser:</span>
          {(['chrome', 'firefox', 'edge', 'all'] as ExtBrowser[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBrowser(b)}
              className={`rounded-full px-3 py-1 text-[10.5px] font-semibold transition-colors ${
                browser === b ? 'bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/40' : 'bg-white/6 text-slate-400 hover:bg-white/12'
              }`}
            >
              {b === 'all' ? 'All browsers' : BROWSER_LABEL[b].replace('Google ', '').replace('Mozilla ', '').replace('Microsoft ', '')}
            </button>
          ))}
        </div>
        {err ? <div className="text-[11px] font-medium text-rose-300">{err}</div> : null}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !name.trim() || !url.trim()}
          className="flex h-9 items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 text-xs font-bold text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save link forever
        </button>
      </div>
    </div>
  )
}

/* ---------------- custom link cards (rendered after the built-in ones) ---------------- */

export function CustomExtCards({
  rows,
  showRemove,
  onRemove,
}: {
  rows: ExtLinkRow[]
  showRemove?: boolean
  onRemove?: (id: string) => void
}) {
  if (!rows.length) return null
  return (
    <>
      {rows.map((l) => (
        <div
          key={l.id}
          className="group relative rounded-xl border border-white/10 bg-[#161b28] p-4 transition-all hover:border-sky-400/40"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg" style={{ background: `${l.color}22`, color: l.color }}>
                <Puzzle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-100">{l.name}</div>
                <div className="truncate text-[10.5px] text-slate-500">
                  {l.browser === 'all' ? 'All browsers' : BROWSER_LABEL[l.browser]}
                </div>
              </div>
            </div>
            <span className="flex-none rounded-full bg-sky-500/15 px-2 py-0.5 text-[9.5px] font-bold tracking-wide text-sky-300">UPLOADED</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">{l.desc}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <a
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-medium text-sky-400 hover:underline"
              aria-label={`Open ${l.name} store link`}
            >
              Install extension →
            </a>
            {showRemove && onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(l.id)}
                aria-label={`Remove ${l.name}`}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
              >
                <Trash2 className="h-3 w-3" /> Remove
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </>
  )
}

// REDSEC v5.0 — Task 42: shared "Share" panel for Word / PowerPoint / Excel
//
// Builds the app's REAL file (.docx / .pptx / .xlsx), uploads it to /api/share
// and hands back a plain link that can be pasted into WhatsApp / Telegram / X /
// Email / anything. Opening the link on a REDSEC OS device drops the file into
// Documents and opens it straight in the matching app.
'use client'

import React, { useState } from 'react'
import { Check, Copy, Link2, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { copyText, createShareLink, fmtBytes, socialLinks, type ShareApp, type ShareInfo } from '@/lib/os/share'

type Phase = 'idle' | 'working' | 'done' | 'error'

export function SharePanel({ app, name, buildBlob, accent }: { app: ShareApp; name: string; buildBlob: () => Promise<Blob>; accent: string }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const create = async () => {
    setPhase('working')
    setError('')
    try {
      const blob = await buildBlob()
      const res = await createShareLink(app, name || 'Document', blob)
      setInfo(res)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  const appLabel = app === 'word' ? 'Word' : app === 'presentation' ? 'PowerPoint' : 'Excel'

  if (phase === 'idle' || phase === 'working') {
    return (
      <div>
        <p className="mb-3 text-[12px] leading-relaxed text-zinc-400">
          Uploads the real <strong>{app === 'word' ? '.docx' : app === 'presentation' ? '.pptx' : '.xlsx'}</strong> file and gives you one short link — paste it into WhatsApp, Telegram, X, Email or anywhere. Anyone opening it on a REDSEC OS gets {name || 'the document'} opened straight in {appLabel}.
        </p>
        <button type="button" onClick={() => void create()} disabled={phase === 'working'} className={`flex items-center gap-2 rounded-md px-4 py-2 text-[12px] font-medium text-white disabled:opacity-60 ${accent}`}>
          {phase === 'working' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          {phase === 'working' ? 'Creating link…' : 'Create share link'}
        </button>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div>
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[11.5px] text-rose-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" />
          <span>{error || 'Could not create the share link.'}</span>
        </div>
        <button type="button" onClick={() => void create()} className="flex items-center gap-2 rounded-md bg-rose-700 px-4 py-2 text-[12px] font-medium text-white hover:bg-rose-600">
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      </div>
    )
  }

  const socials = socialLinks(info!.url, `${name || 'Document'} — shared from REDSEC OS`)

  return (
    <div>
      {info && (
        <div className="mb-2 text-[11px] text-zinc-500">
          Link ready · {fmtBytes(info.size)} · id <span className="font-mono text-zinc-400">{info.id}</span>
        </div>
      )}
      <div className="mb-3 flex items-center gap-2">
        <input
          readOnly
          value={info?.url ?? ''}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Share link"
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 font-mono text-[11.5px] text-sky-300 outline-none"
        />
        <button
          type="button"
          onClick={async () => {
            if (info && (await copyText(info.url))) {
              setCopied(true)
              setTimeout(() => setCopied(false), 1800)
            }
          }}
          className="flex flex-none items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-[11.5px] font-semibold text-white hover:bg-sky-500"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>

      <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">Send straight to</div>
      <div className="grid grid-cols-3 gap-2">
        {socials.map((s) => (
          <a
            key={s.id}
            href={s.href}
            target="_blank"
            rel="noreferrer"
            title={`Share via ${s.label}`}
            className="flex items-center gap-2 rounded-lg border border-zinc-700/80 bg-zinc-800/40 px-2.5 py-2 text-[11px] font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-700/50"
          >
            <span aria-hidden className="text-sm leading-none">{s.icon}</span>
            {s.label}
          </a>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3">
        <span className="text-[10px] text-zinc-600">The link works on any device that can reach this REDSEC OS.</span>
        <button type="button" onClick={() => void create()} className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-[10.5px] text-zinc-400 hover:bg-zinc-800" title="Upload the current version again (new link)">
          <RefreshCw className="h-3 w-3" /> New link from current version
        </button>
      </div>
    </div>
  )
}

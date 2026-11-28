// REDSEC v5.0 — SVR app (Screenshots & Screen Recordings viewer)
'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Camera, Clapperboard, Download, Film, Loader2, Trash2, X } from 'lucide-react'
import { useOS } from '@/lib/os/store'
import { fs, fsLoad, fmtSize } from '@/lib/os/fs'
import type { FSNode } from '@/lib/os/types'
import { AppShell, Toolbar, TBtn, EmptyState } from './_shared'

function useSrc(node: FSNode | null | undefined): string {
  const [src, setSrc] = useState('')
  const id = node?.id
  const remote = node?.url
  useEffect(() => {
    let dead = false
    if (remote) {
      Promise.resolve().then(() => {
        if (!dead) setSrc(remote)
      })
      return () => {
        dead = true
      }
    }
    if (id) {
      fs.blobUrl(id)
        .then((u) => {
          if (!dead) setSrc(u || '')
        })
        .catch(() => {})
    }
    return () => {
      dead = true
    }
  }, [id, remote])
  return src
}

function ShotThumb({ node, onOpen }: { node: FSNode; onOpen: () => void }) {
  const src = useSrc(node)
  const [err, setErr] = useState(false)
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${node.name} — ${fmtSize(node.size || 0)}`}
      className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] transition-all hover:border-sky-400/40 hover:bg-white/[0.06]"
    >
      <div className="aspect-video w-full bg-black/40">
        {src && !err ? (
          <img src={src} alt={node.name} draggable={false} loading="lazy" onError={() => setErr(true)} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl">📸</div>
        )}
      </div>
      <div className="p-2 text-left">
        <div className="line-clamp-1 text-[11.5px] font-medium text-slate-200">{node.name}</div>
        <div className="text-[10px] text-slate-500">{fmtSize(node.size || 0)}</div>
      </div>
    </button>
  )
}

function RecCard({
  node,
  onTrash,
}: {
  node: FSNode
  onTrash: (n: FSNode) => void
}) {
  const src = useSrc(node)
  const notify = useOS((s) => s.notify)

  const download = async () => {
    try {
      const blob = await fs.getBlob(node.id)
      if (!blob) throw new Error('no blob')
      const u = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = u
      a.download = node.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(u), 5000)
      notify({ title: 'Download started', body: node.name, kind: 'success', emoji: '⬇️' })
    } catch {
      notify({ title: 'Download failed', body: node.name, kind: 'error' })
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="aspect-video w-full bg-black/60">
        {src ? <video src={src} controls preload="metadata" className="h-full w-full" /> : <div className="flex h-full w-full items-center justify-center text-2xl">🎬</div>}
      </div>
      <div className="flex items-center gap-2 p-2.5">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-[12px] font-medium text-slate-200">{node.name}</div>
          <div className="text-[10px] text-slate-500">{fmtSize(node.size || 0)}</div>
        </div>
        <TBtn title="Download" onClick={() => void download()}>
          <Download className="h-4 w-4" />
        </TBtn>
        <TBtn title="Move to Bin" onClick={() => onTrash(node)}>
          <Trash2 className="h-4 w-4 text-rose-300" />
        </TBtn>
      </div>
    </div>
  )
}

/** full-screen (in-app) screenshot viewer with download */
function ShotViewer({ node, onClose, onTrash }: { node: FSNode; onClose: () => void; onTrash: (n: FSNode) => void }) {
  const src = useSrc(node)
  const notify = useOS((s) => s.notify)

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const download = async () => {
    try {
      if (node.url) {
        const res = await fetch(node.url)
        const blob = await res.blob()
        await fsLoad()
        await fs.addFile('downloads', node.name, { blob, mime: node.mime || blob.type })
        notify({ title: 'Saved to Downloads', body: node.name, kind: 'success', emoji: '📥' })
        return
      }
      const blob = await fs.getBlob(node.id)
      if (!blob) throw new Error('no blob')
      const u = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = u
      a.download = node.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(u), 5000)
      notify({ title: 'Download started', body: node.name, kind: 'success', emoji: '⬇️' })
    } catch {
      notify({ title: 'Download failed', body: node.name, kind: 'error' })
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-black/95 backdrop-blur-sm">
      <div className="flex flex-none items-center gap-3 border-b border-white/10 px-3 py-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">{node.name}</div>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-slate-300">{fmtSize(node.size || 0)}</span>
        <TBtn title="Download" onClick={() => void download()}>
          <Download className="h-4 w-4" /> <span className="hidden sm:inline">Download</span>
        </TBtn>
        <TBtn title="Move to Bin" onClick={() => onTrash(node)}>
          <Trash2 className="h-4 w-4 text-rose-300" />
        </TBtn>
        <TBtn title="Close (Esc)" onClick={onClose}>
          <X className="h-4 w-4" />
        </TBtn>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {src ? (
          <img src={src} alt={node.name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        )}
      </div>
    </div>
  )
}

type Tab = 'shots' | 'recs'

export default function SvrApp(_props: { winId: string; args?: Record<string, unknown> }) {
  const notify = useOS((s) => s.notify)
  const focused = useOS((s) => s.focusedWin)
  const [tab, setTab] = useState<Tab>('shots')
  const [version, setVersion] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [viewer, setViewer] = useState<FSNode | null>(null)

  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let dead = false
    fsLoad()
      .then(() => {
        if (!dead) {
          setLoaded(true)
          setVersion((v) => v + 1)
        }
      })
      .catch(() => {
        if (!dead) setLoaded(true)
      })
    return () => {
      dead = true
    }
  }, [])

  /* refresh when this window refocuses (screenshots may land anytime via P) */
  useEffect(() => {
    if (!focused) return
    fsLoad()
      .then(() => setVersion((v) => v + 1))
      .catch(() => {})
  }, [focused])

  const shots = loaded ? fs.children('screenshots').sort((a, b) => b.createdAt - a.createdAt) : []
  const recs = loaded
    ? fs
        .children('videos')
        .filter((n) => n.meta?.kind === 'recording')
        .sort((a, b) => b.createdAt - a.createdAt)
    : []
  const list = tab === 'shots' ? shots : recs
  const totalSize = list.reduce((a, n) => a + (n.size || 0), 0)

  const trash = async (n: FSNode) => {
    try {
      await fs.trash(n.id)
      notify({ title: 'Moved to Bin', body: n.name, kind: 'success', emoji: '🗑️' })
      setViewer(null)
      refresh()
    } catch {
      notify({ title: 'Could not delete item', kind: 'error' })
    }
  }

  const grid = 'grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3'

  return (
    <AppShell className="relative">
      <Toolbar>
        <div className="flex flex-none items-center gap-0.5 rounded-lg bg-black/30 p-0.5">
          <TBtn active={tab === 'shots'} onClick={() => setTab('shots')}>
            <Camera className="h-4 w-4" /> Screenshots
            <span className="ml-1 rounded-full bg-white/15 px-1.5 text-[10px] tabular-nums">{shots.length}</span>
          </TBtn>
          <TBtn active={tab === 'recs'} onClick={() => setTab('recs')}>
            <Clapperboard className="h-4 w-4" /> Recordings
            <span className="ml-1 rounded-full bg-white/15 px-1.5 text-[10px] tabular-nums">{recs.length}</span>
          </TBtn>
        </div>
        <div className="flex-1" />
        <span className="flex-none rounded-full bg-white/8 px-2.5 py-1 text-[11px] text-slate-400">
          {list.length} item{list.length === 1 ? '' : 's'} · {fmtSize(totalSize)}
        </span>
      </Toolbar>

      <main className="os-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {!loaded ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : tab === 'shots' ? (
          shots.length === 0 ? (
            <EmptyState icon="📸" title="No screenshots yet" sub="Press P anywhere in the OS to capture the screen — screenshots appear here." />
          ) : (
            <div className={grid}>
              {shots.map((n) => (
                <ShotThumb key={n.id} node={n} onOpen={() => setViewer(n)} />
              ))}
            </div>
          )
        ) : recs.length === 0 ? (
          <EmptyState icon="🎬" title="No recordings yet" sub="Press V anywhere in the OS to start/stop screen recording — recordings appear here." />
        ) : (
          <div className={grid}>
            {recs.map((n) => (
              <RecCard key={n.id} node={n} onTrash={(x) => void trash(x)} />
            ))}
          </div>
        )}

        {loaded && list.length > 0 && (
          <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500">
            <Film className="h-3.5 w-3.5" />
            {tab === 'shots' ? 'Tip: press P for a new screenshot' : 'Tip: press V to record the screen'}
          </div>
        )}
      </main>

      {viewer && <ShotViewer node={viewer} onClose={() => setViewer(null)} onTrash={(n) => void trash(n)} />}
    </AppShell>
  )
}

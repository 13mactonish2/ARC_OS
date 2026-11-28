// REDSEC v5.0 — Bin app (trashed items: restore / delete forever / empty bin)
'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Loader2, RotateCcw, Trash2, X } from 'lucide-react'
import { useOS } from '@/lib/os/store'
import { fs, fsLoad, fmtSize, ROOTS } from '@/lib/os/fs'
import type { FSNode } from '@/lib/os/types'
import { AppShell, Toolbar, TBtn, EmptyState } from './_shared'

function rootName(id: string | null | undefined): string {
  if (!id) return 'Unknown'
  const root = ROOTS.find((r) => r.id === id)
  if (root) return root.name
  const node = fs.get(id)
  return node ? node.name : 'Unknown'
}

function typeBadge(n: FSNode): { label: string; emoji: string } {
  if (n.kind === 'folder') return { label: 'Folder', emoji: '📁' }
  if (fs.isVideo(n)) return { label: 'Video', emoji: '🎬' }
  if (fs.isAudio(n)) return { label: 'Audio', emoji: '🎵' }
  if (fs.isImage(n)) return { label: 'Image', emoji: '🖼️' }
  if (fs.isPdf(n)) return { label: 'PDF', emoji: '📕' }
  if (fs.isText(n)) return { label: 'Document', emoji: '📄' }
  return { label: 'File', emoji: '📦' }
}

/** in-app confirm dialog */
function Confirm({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-2xl border border-white/12 bg-[#161b28] p-5 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xl">⚠️</span>
          <span className="text-sm font-semibold text-slate-100">{title}</span>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-slate-400">{body}</p>
        <div className="flex gap-2">
          <TBtn className="flex-1" onClick={onCancel}>
            Cancel
          </TBtn>
          <button
            type="button"
            onClick={onConfirm}
            className="h-8 flex-1 rounded-md bg-rose-600 text-xs font-medium text-white transition-colors hover:bg-rose-500"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BinApp(_props: { winId: string; args?: Record<string, unknown> }) {
  const notify = useOS((s) => s.notify)
  const focused = useOS((s) => s.focusedWin)
  const [version, setVersion] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ kind: 'empty' } | { kind: 'purge'; node: FSNode } | null>(null)

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

  useEffect(() => {
    if (!focused) return
    fsLoad()
      .then(() => setVersion((v) => v + 1))
      .catch(() => {})
  }, [focused])

  const items = loaded ? fs.children('bin', true).sort((a, b) => b.modifiedAt - a.modifiedAt) : []
  const totalSize = items.reduce((a, n) => a + (n.size || 0), 0)

  const restore = async (n: FSNode) => {
    try {
      setBusy(true)
      await fs.restore(n.id)
      notify({ title: 'Restored', body: `${n.name} → ${rootName(n.prevParent)}`, kind: 'success', emoji: '↩️' })
      refresh()
    } catch {
      notify({ title: 'Could not restore item', kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const purge = async (n: FSNode) => {
    try {
      setBusy(true)
      await fs.purge(n.id)
      notify({ title: 'Deleted forever', body: n.name, kind: 'success', emoji: '💥' })
      refresh()
    } catch {
      notify({ title: 'Could not delete item', kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const emptyBin = async () => {
    try {
      setBusy(true)
      await fs.emptyBin()
      notify({ title: 'Bin emptied', body: 'All items permanently deleted', kind: 'success', emoji: '🗑️' })
      refresh()
    } catch {
      notify({ title: 'Could not empty Bin', kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell className="relative">
      <Toolbar>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-base">🗑️</span>
          <span className="text-xs font-semibold text-slate-200">Bin</span>
          {loaded && (
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-slate-400">
              {items.length} item{items.length === 1 ? '' : 's'} · {fmtSize(totalSize)}
            </span>
          )}
        </div>
        <TBtn title="Permanently delete everything in the Bin" onClick={() => setConfirm({ kind: 'empty' })} disabled={items.length === 0 || busy}>
          <Trash2 className="h-4 w-4" /> <span className="hidden sm:inline">Empty Bin</span>
        </TBtn>
      </Toolbar>

      <main className="os-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {!loaded ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="🗑️"
            title="Bin is empty"
            sub="Deleted files and folders from everywhere arrive here. You can restore them or delete them forever."
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            {items.map((n) => {
              const t = typeBadge(n)
              return (
                <div
                  key={n.id}
                  className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.05]"
                >
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-black/30 text-xl">{t.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-slate-200">{n.name}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-[10.5px] text-slate-500">
                      <span className="rounded-full bg-white/8 px-1.5 py-0.5">{t.label}</span>
                      <span>{fmtSize(n.size || 0)}</span>
                      <span>
                        from <b className="font-semibold text-slate-400">{rootName(n.prevParent)}</b>
                      </span>
                    </div>
                  </div>
                  <TBtn title="Restore to original location" onClick={() => void restore(n)} disabled={busy}>
                    <RotateCcw className="h-4 w-4" /> <span className="hidden sm:inline">Restore</span>
                  </TBtn>
                  <TBtn title="Delete forever" onClick={() => setConfirm({ kind: 'purge', node: n })} disabled={busy}>
                    <X className="h-4 w-4 text-rose-300" /> <span className="hidden sm:inline text-rose-300">Delete</span>
                  </TBtn>
                </div>
              )
            })}
            <div className="mt-2 px-1 text-[10.5px] text-slate-600">
              Items stay in the Bin until you remove them. Restoring puts them back to their original location.
            </div>
          </div>
        )}
      </main>

      {confirm?.kind === 'empty' && (
        <Confirm
          title="Empty the Bin?"
          body={`All ${items.length} item${items.length === 1 ? '' : 's'} (${fmtSize(totalSize)}) will be permanently deleted. This cannot be undone.`}
          confirmLabel="Empty Bin"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            void emptyBin()
          }}
        />
      )}
      {confirm?.kind === 'purge' && (
        <Confirm
          title="Delete forever?"
          body={`“${confirm.node.name}” will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete forever"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const node = confirm.node
            setConfirm(null)
            void purge(node)
          }}
        />
      )}
    </AppShell>
  )
}

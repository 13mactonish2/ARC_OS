// REDSEC v5.0 — OS File Picker: the system file-open dialog.
// Instead of the browser's native <input type=file>, apps open THIS picker —
// a live view of the OS File Manager (virtual FS) where the user's files are
// stored. "Import from device" inside the picker copies device files into the
// OS File Manager first, then attaches them — one hub for every file.
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { ChevronRight, Folder, HardDrive, Loader2, Upload, X } from 'lucide-react'
import { fs, fsLoad, fmtSize } from '@/lib/os/fs'
import type { FSNode, RootId } from '@/lib/os/types'
import { useOS } from '@/lib/os/store'

const ROOT_ICON: Record<string, string> = {
  desktop: '🖥️',
  documents: '📄',
  downloads: '📥',
  photos: '🖼️',
  videos: '🎬',
  screenshots: '📸',
  music: '🎵',
  archive: '🗄️',
  bin: '🗑️',
}

const USER_ROOTS: RootId[] = ['desktop', 'documents', 'downloads', 'photos', 'videos', 'screenshots', 'music']

function emojiFor(n: FSNode): string {
  if (n.kind === 'folder') return '📁'
  if (fs.isImage(n)) return '🖼️'
  if (fs.isVideo(n)) return '🎬'
  if (fs.isAudio(n)) return '🎵'
  if (fs.isPdf(n)) return '📕'
  return '📄'
}

/** Resolve any FS node (blob / remote url / text) into a real File object. */
export async function nodeToFile(n: FSNode): Promise<File> {
  const text = n.meta?.text
  if (typeof text === 'string') return new File([text], n.name, { type: n.mime || 'text/plain' })
  const blob = await fs.getBlob(n.id)
  if (blob) return new File([blob], n.name, { type: blob.type || n.mime || 'application/octet-stream' })
  if (n.url) {
    const res = await fetch(`/api/download?url=${encodeURIComponent(n.url)}`)
    if (!res.ok) throw new Error(`Could not fetch ${n.name}`)
    const b = await res.blob()
    return new File([b], n.name, { type: b.type || n.mime || 'application/octet-stream' })
  }
  throw new Error(`${n.name} has no stored data`)
}

export function OSFilePicker({
  open,
  multiple = false,
  title = 'Open from File Manager',
  onClose,
  onPick,
}: {
  open: boolean
  multiple?: boolean
  title?: string
  onClose: () => void
  onPick: (nodes: FSNode[]) => void
}) {
  const notify = useOS((s) => s.notify)
  const [curId, setCurId] = useState<string>('documents')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [version, setVersion] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [importing, setImporting] = useState(false)
  const deviceRef = useRef<HTMLInputElement>(null)
  const pickedRef = useRef(false)

  useEffect(() => {
    if (!open) return
    pickedRef.current = false
    let dead = false
    fsLoad()
      .then(() => {
        if (!dead) {
          setLoaded(true)
          setVersion((v) => v + 1)
        }
      })
      .catch(() => !dead && setLoaded(true))
    return () => {
      dead = true
    }
  }, [open])

  if (!open) return null

  const cur = fs.get(curId)
  const kids = loaded ? fs.children(curId) : []
  const folders = kids.filter((n) => n.kind === 'folder').sort((a, b) => a.name.localeCompare(b.name))
  const files = kids.filter((n) => n.kind === 'file').sort((a, b) => a.name.localeCompare(b.name))
  const path = loaded ? fs.path(curId) : []
  const parent = cur?.parent ? fs.get(cur.parent) : null

  const refresh = () => setVersion((v) => v + 1)

  const toggle = (n: FSNode) => {
    if (n.kind === 'folder') {
      setCurId(n.id)
      setSel(new Set())
      return
    }
    setSel((prev) => {
      const next = multiple ? new Set(prev) : new Set<string>()
      if (multiple && next.has(n.id)) next.delete(n.id)
      else next.add(n.id)
      return next
    })
  }

  const importFromDevice = async (list: FileList | null) => {
    if (!list || !list.length) return
    setImporting(true)
    const newIds: string[] = []
    try {
      await fsLoad()
      for (const f of Array.from(list)) {
        const node = await fs.addFile(curId, f.name, { blob: f, mime: f.type || undefined, meta: { importedFrom: 'device' } })
        newIds.push(node.id)
      }
      notify({ title: `Imported ${newIds.length} file${newIds.length === 1 ? '' : 's'}`, body: `Saved to File Manager ▸ ${cur?.name || 'folder'}`, kind: 'success', emoji: '📥' })
      refresh()
      setSel(new Set(newIds))
    } catch {
      notify({ title: 'Import failed', kind: 'error' })
    } finally {
      setImporting(false)
      if (deviceRef.current) deviceRef.current.value = ''
    }
  }

  const confirm = async () => {
    if (pickedRef.current || sel.size === 0) return
    pickedRef.current = true
    const nodes = Array.from(sel)
      .map((id) => fs.get(id))
      .filter((n): n is FSNode => !!n && n.kind === 'file')
    onPick(nodes)
  }

  const selNodes = Array.from(sel)
    .map((id) => fs.get(id))
    .filter((n): n is FSNode => !!n)

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="flex h-full max-h-[520px] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/12 bg-[#121724] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex flex-none items-center gap-2 border-b border-white/10 px-4 py-2.5">
          <HardDrive className="h-4 w-4 flex-none text-sky-400" />
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">{title}</div>
          <span className="hidden flex-none text-[10px] text-slate-500 sm:block">the OS file hub — everything lives here</span>
          <button type="button" onClick={onClose} aria-label="Close file picker" className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* roots sidebar */}
          <aside className="os-scroll hidden w-36 flex-none flex-col gap-0.5 overflow-y-auto border-r border-white/10 bg-[#131826] p-2 sm:flex">
            <div className="px-2 pb-1 pt-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">File Manager</div>
            {USER_ROOTS.map((r) => {
              const node = fs.get(r)
              const active = curId === r || (path.length > 1 && path[0]?.id === r)
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setCurId(r)
                    setSel(new Set())
                  }}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${active ? 'bg-sky-500/15 font-semibold text-sky-200' : 'text-slate-300 hover:bg-white/5'}`}
                >
                  <span>{ROOT_ICON[r] || '📁'}</span>
                  <span className="flex-1 truncate">{node?.name || r}</span>
                </button>
              )
            })}
          </aside>

          {/* main browse area */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* breadcrumb */}
            <div className="flex flex-none items-center gap-0.5 border-b border-white/10 px-3 py-1.5">
              {parent && (
                <button type="button" onClick={() => { setCurId(parent.id); setSel(new Set()) }} className="mr-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-white/8 hover:text-white">
                  ↑ Up
                </button>
              )}
              {path.map((p, i) => (
                <span key={p.id} className="flex min-w-0 items-center">
                  {i > 0 && <ChevronRight className="mx-0.5 h-3 w-3 flex-none text-slate-600" />}
                  <button
                    type="button"
                    onClick={() => { setCurId(p.id); setSel(new Set()) }}
                    className={`truncate rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-white/8 ${i === path.length - 1 ? 'font-semibold text-sky-300' : 'text-slate-300'}`}
                  >
                    {p.name}
                  </button>
                </span>
              ))}
            </div>

            <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-2.5">
              {!loaded ? (
                <div className="flex h-24 items-center justify-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading File Manager…
                </div>
              ) : folders.length === 0 && files.length === 0 ? (
                <div className="flex h-24 flex-col items-center justify-center gap-1 text-center">
                  <Folder className="h-6 w-6 text-slate-600" />
                  <div className="text-xs text-slate-500">This folder is empty.</div>
                  <button type="button" onClick={() => deviceRef.current?.click()} className="mt-1 text-[11px] font-medium text-sky-300 hover:underline">
                    Import files from this device →
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                  {folders.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => toggle(n)}
                      className="flex flex-col items-center gap-1 rounded-xl border border-white/8 bg-white/[0.03] p-2.5 transition-all hover:border-sky-400/40 hover:bg-white/[0.06]"
                    >
                      <span className="text-2xl">📁</span>
                      <span className="line-clamp-2 w-full break-all text-center text-[10.5px] text-slate-200">{n.name}</span>
                    </button>
                  ))}
                  {files.map((n) => {
                    const active = sel.has(n.id)
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => toggle(n)}
                        aria-pressed={active}
                        className={`relative flex flex-col items-center gap-1 rounded-xl border p-2.5 transition-all ${
                          active ? 'border-sky-400/70 bg-sky-500/15' : 'border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
                        }`}
                      >
                        {fs.isImage(n) && (n.url || n.meta?.kind === 'photo' || n.meta?.blob) ? (
                          <PickerThumb node={n} />
                        ) : (
                          <span className="text-2xl">{emojiFor(n)}</span>
                        )}
                        <span className="line-clamp-2 w-full break-all text-center text-[10.5px] text-slate-200">{n.name}</span>
                        <span className="text-[9px] text-slate-500">{fmtSize(n.size || 0)}</span>
                        {active && (
                          <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[9px] font-bold text-white">
                            {multiple ? sel.size && Array.from(sel).indexOf(n.id) + 1 : '✓'}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="flex flex-none items-center gap-2 border-t border-white/10 px-4 py-2.5">
          <button
            type="button"
            onClick={() => deviceRef.current?.click()}
            disabled={importing}
            className="flex h-8 items-center gap-1.5 rounded-md bg-white/5 px-2.5 text-[11px] font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:opacity-40"
            title="Copy files from this device into the OS File Manager"
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Import from device
          </button>
          <input
            ref={deviceRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void importFromDevice(e.target.files)}
            aria-hidden="true"
            tabIndex={-1}
          />
          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
            {selNodes.length === 0 ? 'Nothing selected' : `${selNodes.length} file${selNodes.length === 1 ? '' : 's'} selected`}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 items-center rounded-md bg-white/5 px-3 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={sel.size === 0}
            className="flex h-8 items-center gap-1.5 rounded-md bg-sky-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
          >
            {multiple ? `Attach ${sel.size || ''}` : 'Attach'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** thumbnail with graceful fallback (blobs resolve async → tiny local cache) */
const thumbCache = new Map<string, string>()
function PickerThumb({ node }: { node: FSNode }) {
  const cached = thumbCache.get(node.id)
  const [src, setSrc] = useState<string>(cached || (node.url || ''))
  useEffect(() => {
    let dead = false
    if (cached) return
    fs.blobUrl(node.id)
      .then((u) => {
        if (!dead && u) {
          thumbCache.set(node.id, u)
          setSrc(u)
        }
      })
      .catch(() => {})
    return () => {
      dead = true
    }
  }, [node.id])
  if (!src) return <span className="text-2xl">🖼️</span>
  return <img src={src} alt={node.name} className="h-10 w-10 rounded-lg object-cover" loading="lazy" />
}

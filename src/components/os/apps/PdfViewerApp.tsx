// REDSEC v5.0 — PDF Viewer (upload, save to FS, list, view, download, delete)
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { ExternalLink, FileText, Download, Trash2, Upload, Loader2, FileQuestion } from 'lucide-react'
import { AppShell, Toolbar, TBtn, EmptyState, fmtBytes } from './_shared'
import { fs } from '@/lib/os/fs'
import { scanOfficeFiles, PDF_FILE_RE } from '@/lib/os/officeFiles'
import { useOS } from '@/lib/os/store'
import type { AppProps, FSNode } from '@/lib/os/types'

/* typed accessor for store actions (OSStore interface lacks action declarations) */
type OSApi = {
  notify: (n: { title: string; body?: string; emoji?: string; kind?: 'info' | 'success' | 'warn' | 'error' | 'voice' }) => unknown
  set: (patch: Partial<Record<string, unknown>>) => void
}
const osApi = () => useOS.getState() as unknown as OSApi

export default function PdfViewerApp({ args }: AppProps) {
  const [pdfs, setPdfs] = useState<{ n: FSNode; folder: string }[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [loadingUrl, setLoadingUrl] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [listLoading, setListLoading] = useState(true)

  const active = pdfs.find((p) => p.n.id === activeId)?.n || null

  /* ---------- list ---------- */
  const refresh = useCallback(() => {
    try {
      /* Task 73 — scan EVERY folder on the PC (Documents, Downloads, Desktop,
         Archive…), not just Documents, so PDFs are always detected. */
      const list = scanOfficeFiles((n) => fs.isPdf(n) || PDF_FILE_RE.test(n.name))
      setPdfs(list.map(({ node, folder }) => ({ n: node, folder })))
    } catch {
      setPdfs([])
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(refresh, [refresh])

  /* ---------- open ---------- */
  const openPdf = useCallback(async (id: string) => {
    try {
      setActiveId(id)
      setLoadingUrl(true)
      setUrl('')
      const u = await fs.blobUrl(id)
      if (!u) throw new Error('no blob')
      setUrl(u)
    } catch {
      osApi().notify({ title: 'Could not open PDF', kind: 'error' })
      setActiveId(null)
    } finally {
      setLoadingUrl(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const nodeId = typeof args?.nodeId === 'string' ? args.nodeId : null
    const node = nodeId ? fs.get(nodeId) : undefined
    if (nodeId && node && fs.isPdf(node)) void openPdf(nodeId)
  }, [args, openPdf, refresh])

  /* ---------- upload ---------- */
  const onFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        osApi().notify({ title: 'Not a PDF file', body: file.name, kind: 'warn' })
        return
      }
      setUploading(true)
      try {
        const node = await fs.addFile('documents', file.name, {
          blob: file,
          mime: 'application/pdf',
          meta: { kind: 'pdf' },
        })
        refresh()
        await openPdf(node.id)
        osApi().notify({ title: 'PDF saved to Documents', body: node.name, kind: 'success', emoji: '📕' })
      } catch {
        osApi().notify({ title: 'Upload failed', kind: 'error' })
      } finally {
        setUploading(false)
      }
    },
    [refresh, openPdf]
  )

  /* ---------- actions ---------- */
  const download = useCallback(async () => {
    if (!active) return
    try {
      const blob = await fs.getBlob(active.id)
      if (!blob) throw new Error('no blob')
      const u = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = u
      a.download = active.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(u), 4000)
      osApi().notify({ title: 'PDF downloaded', body: active.name, kind: 'success', emoji: '⬇️' })
    } catch {
      osApi().notify({ title: 'Download failed', kind: 'error' })
    }
  }, [active])

  const del = useCallback(
    async (id: string) => {
      try {
        await fs.trash(id)
        if (id === activeId) {
          setActiveId(null)
          setUrl('')
        }
        refresh()
        osApi().notify({ title: 'PDF moved to Bin', kind: 'success', emoji: '🗑️' })
      } catch {
        osApi().notify({ title: 'Delete failed', kind: 'error' })
      }
    },
    [activeId, refresh]
  )

  return (
    <AppShell>
      <Toolbar>
        <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-sky-600/80 px-2.5 text-xs font-medium text-white hover:bg-sky-500">
          <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload PDF'}
          <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void onFile(e)} />
        </label>
        <span className="ml-1 hidden text-xs text-slate-500 sm:block">{pdfs.length} PDF(s) on this PC — every folder</span>
        <div className="ml-auto flex items-center gap-1.5">
          <TBtn
            onClick={() => active && url && window.open(url, '_blank', 'noopener,noreferrer')}
            disabled={!active || !url}
            title="Open in a new tab"
          >
            <ExternalLink className="h-4 w-4" />
          </TBtn>
          <TBtn onClick={() => void download()} disabled={!active} title="Download PDF">
            <Download className="h-4 w-4" />
          </TBtn>
          <TBtn onClick={() => active && void del(active.id)} disabled={!active} title="Move to Bin">
            <Trash2 className="h-4 w-4" />
          </TBtn>
        </div>
      </Toolbar>

      <div className="flex min-h-0 flex-1">
        {/* sidebar */}
        <div className="flex w-52 flex-none flex-col border-r border-white/10 bg-[#121724]">
          <div className="border-b border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Saved PDFs — all folders</div>
          <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
            {listLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : pdfs.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-slate-500">
                No PDFs yet.<br />Upload one above — it stays saved forever.
              </div>
            ) : (
              pdfs.map(({ n: p, folder }) => (
                <div
                  key={p.id}
                  onClick={() => void openPdf(p.id)}
                  className={`group mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 transition-colors ${activeId === p.id ? 'bg-sky-600/25 ring-1 ring-sky-500/40' : 'hover:bg-white/5'}`}
                >
                  <FileText className="h-4 w-4 flex-none text-orange-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-200">{p.name}</div>
                    <div className="text-[10px] text-slate-500">{fmtBytes(p.size)} · {folder}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); void del(p.id) }}
                    className="rounded p-1 text-slate-500 opacity-0 hover:bg-rose-500/20 hover:text-rose-400 group-hover:opacity-100"
                    aria-label={`Delete ${p.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* viewer */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-[#0c101c]">
          {loadingUrl ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading PDF…
            </div>
          ) : active && url ? (
            <iframe
              src={url}
              title={active.name}
              className="h-full w-full flex-1 border-0 bg-white"
            />
          ) : (
            <EmptyState
              icon={<FileQuestion className="h-10 w-10 text-slate-600" />}
              title="No PDF open"
              sub="Upload a PDF or pick one from the sidebar. Files are stored in Documents and persist across reboots."
            />
          )}
        </div>
      </div>
    </AppShell>
  )
}

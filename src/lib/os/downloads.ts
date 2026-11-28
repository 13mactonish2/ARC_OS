// REDSEC v5.0 — OS Download Manager (global, zustand)
// Every download started anywhere in the OS (Web Browser, Mail links, file
// pickers) flows through here: streamed via /api/download with live progress,
// speed and ETA, then saved into the virtual File System (Downloads root) so
// it appears in the File Manager automatically — where it was downloaded.
'use client'

import { create } from 'zustand'
import { fsLoad, fs } from './fs'
import { useOS } from './store'

export interface DownloadItem {
  id: string
  name: string
  url: string
  origin: string // 'browser' | 'mail' | 'picker' | ...
  mime: string
  convert?: boolean // Task 36 — this item was a link→file conversion (/api/linkfile)
  total: number // bytes (0 = unknown size)
  received: number
  speed: number // bytes/s (EMA)
  status: 'active' | 'done' | 'error' | 'cancelled'
  error?: string
  startedAt: number
  endedAt?: number
  fileId?: string // FS node id once saved into Downloads
  etaSec?: number
}

interface DownloadsStore {
  items: DownloadItem[]
  /** begin a download — returns the id immediately, progress flows into `items`.
   *  convert: true → ANY link is turned into a REAL file (Task 36 /api/linkfile):
   *  pages become workable .html snapshots, binaries keep their real types. */
  start: (opts: { url: string; name?: string; origin?: string; convert?: boolean }) => string
  cancel: (id: string) => void
  retry: (id: string) => void
  remove: (id: string) => void
  clearFinished: () => void
}

const activeControllers = new Map<string, AbortController>()

/* Task 36 — mime → real extension so ANY converted link lands as a workable file */
const EXT_BY_MIME: Array<[RegExp, string]> = [
  [/^image\/png/, 'png'], [/^image\/jpe?g/, 'jpg'], [/^image\/gif/, 'gif'], [/^image\/webp/, 'webp'],
  [/^image\/svg/, 'svg'], [/^image\/avif/, 'avif'],
  [/^audio\/mpeg/, 'mp3'], [/^audio\/wav|^audio\/x-wav/, 'wav'], [/^audio\/ogg/, 'ogg'],
  [/^audio\/flac/, 'flac'], [/^audio\/aac/, 'aac'], [/^audio\/mp4|^audio\/x-m4a/, 'm4a'], [/^audio\/opus/, 'opus'], [/^audio\/midi/, 'mid'],
  [/^video\/mp4/, 'mp4'], [/^video\/webm/, 'webm'], [/^video\/x-matroska/, 'mkv'], [/^video\/quicktime/, 'mov'],
  [/^application\/pdf/, 'pdf'], [/^application\/zip/, 'zip'], [/^application\/gzip/, 'gz'], [/^application\/x-tar/, 'tar'],
  [/^application\/json/, 'json'], [/^text\/html/, 'html'], [/^text\/plain/, 'txt'], [/^text\/csv/, 'csv'],
]

/** ensure a file name carries a real, openable extension */
function ensureRealExtension(name: string, mime: string): string {
  if (/\.[a-z0-9]{1,8}$/i.test(name)) return name
  const m = (mime || '').split(';')[0].trim().toLowerCase()
  for (const [re, ext] of EXT_BY_MIME) if (re.test(m)) return `${name.replace(/[.]+$/, '')}.${ext}`
  return name
}

/** derive a friendly file name from a URL */
function nameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')
    if (seg && /\.[a-z0-9]{1,8}$/i.test(seg)) return seg.slice(0, 120)
    if (seg) return `${seg.slice(0, 60)}.bin`
    return `${(u.hostname || 'download').replace(/^www\./, '')}.bin`
  } catch {
    return 'download.bin'
  }
}

export function fmtSpeed(bps: number): string {
  if (!bps || bps < 1) return '—'
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

export const useDownloads = create<DownloadsStore>((set, get) => ({
  items: [],

  start: ({ url, name, origin = 'browser', convert = false }) => {
    const id = `dl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const item: DownloadItem = {
      id,
      name: name || nameFromUrl(url),
      url,
      origin,
      mime: 'application/octet-stream',
      total: 0,
      received: 0,
      speed: 0,
      status: 'active',
      startedAt: Date.now(),
    }
    set((s) => ({ items: [item, ...s.items.filter((x) => !(x.url === url && x.status === 'active'))] }))
    useOS.getState().notify({
      title: convert ? '🔁 Converting link into a real file' : '⬇️ Download started',
      body: `${item.name} — saving to File Manager ▸ Downloads`,
      kind: 'info',
    })
    void runDownload(id, url, item.name, origin, convert)
    return id
  },

  cancel: (id) => {
    const c = activeControllers.get(id)
    if (c) c.abort()
  },

  retry: (id) => {
    const it = get().items.find((x) => x.id === id)
    if (!it || it.status === 'active') return
    set((s) => ({ items: s.items.filter((x) => x.id !== id) }))
    get().start({ url: it.url, name: it.name, origin: it.origin, convert: it.convert })
  },

  remove: (id) => {
    const c = activeControllers.get(id)
    if (c) c.abort()
    set((s) => ({ items: s.items.filter((x) => x.id !== id) }))
  },

  clearFinished: () => set((s) => ({ items: s.items.filter((x) => x.status === 'active') })),
}))

/** the streaming worker — writes progress into the store, saves into the FS at the end.
 *  convert=true routes through /api/linkfile so ANY link becomes a real, workable file. */
async function runDownload(id: string, url: string, fallbackName: string, origin: string, convert = false): Promise<void> {
  const ctrl = new AbortController()
  activeControllers.set(id, ctrl)
  const chunks: BlobPart[] = []
  let lastTick = performance.now()
  let lastBytes = 0
  let lastPush = 0
  let speedEma = 0
  let received = 0

  const patch = (p: Partial<DownloadItem>) =>
    useDownloads.setState((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, ...p } : x)) }))

  try {
    const endpoint = convert ? '/api/linkfile' : '/api/download'
    const res = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`, { signal: ctrl.signal })
    if (!res.ok) {
      let msg = `Download failed (${res.status})`
      try {
        const j = (await res.json()) as { message?: string }
        if (j.message) msg = j.message
      } catch {
        /* keep default */
      }
      throw new Error(msg)
    }
    const mime = res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream'
    const hintedRaw = res.headers.get('x-filename')
    const hinted = hintedRaw ? decodeURIComponent(hintedRaw) : null
    const finalUrl = res.headers.get('x-final-url')
    const total = Number(res.headers.get('content-length'))
    const body = res.body
    if (!body) throw new Error('Empty stream from host')

    const name = ensureRealExtension(hinted || fallbackName, mime)
    patch({
      mime,
      convert,
      total: Number.isFinite(total) ? total : 0,
      name,
      url: finalUrl || url,
    })

    const reader = body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value as unknown as BlobPart)
        received += value.byteLength
        const now = performance.now()
        if (now - lastPush > 250) {
          const inst = (received - lastBytes) / Math.max(1, (now - lastTick) / 1000)
          lastTick = now
          lastBytes = received
          lastPush = now
          speedEma = speedEma ? speedEma * 0.65 + inst * 0.35 : inst
          const etaSec = Number.isFinite(total) && total > 0 && speedEma > 1 ? Math.round((total - received) / speedEma) : undefined
          patch({ received, speed: speedEma, etaSec })
        }
      }
    }

    const blob = new Blob(chunks, { type: mime })
    /* ---- save into the virtual FS so the File Manager shows it immediately ---- */
    await fsLoad()
    const node = await fs.addFile('downloads', name, {
      blob,
      mime,
      size: blob.size,
      meta: { downloadedFrom: finalUrl || url, downloadedAt: Date.now(), origin },
    })
    patch({
      status: 'done',
      received: blob.size,
      total: blob.size || (Number.isFinite(total) ? total : 0),
      endedAt: Date.now(),
      fileId: node.id,
      etaSec: 0,
    })
    useOS.getState().notify({
      title: '✅ Download complete',
      body: `${name} saved to File Manager ▸ Downloads`,
      kind: 'success',
      app: 'filemanager',
    })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    if (aborted) {
      patch({ status: 'cancelled', endedAt: Date.now() })
    } else {
      patch({ status: 'error', error: e instanceof Error ? e.message : 'Download failed', endedAt: Date.now() })
      useOS.getState().notify({
        title: '⚠️ Download failed',
        body: e instanceof Error ? e.message : 'Could not download this file.',
        kind: 'error',
      })
    }
  } finally {
    activeControllers.delete(id)
  }
}

/** true when the URL points straight at a downloadable file */
export function isDirectFileUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|iso|img|pdf|docx?|xlsx?|pptx?|odt|ods|odp|csv|tsv|txt|rtf|md|markdown|epub|mp3|wav|ogg|flac|m4a|mp4|mkv|webm|mov|avi|apk|exe|msi|dmg|deb|rpm|jar|ttf|otf|woff2?|psd|ai|bin|sql|json|xml)$/i.test(
      u.pathname,
    )
  } catch {
    return false
  }
}

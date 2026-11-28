// REDSEC v5.0 — export the virtual file system as a downloadable ZIP
'use client'

import JSZip from 'jszip'
import { fs } from './fs'
import type { FSNode } from './types'

export type ZipProgress = { done: number; total: number; name: string }
export type ZipResult = { files: number; skipped: number; size: number }

/** every non-trashed node inside a folder (recursive) */
function collectTree(rootId: string): FSNode[] {
  const out: FSNode[] = []
  const walk = (id: string) => {
    for (const c of fs.children(id)) {
      out.push(c)
      if (c.kind === 'folder') walk(c.id)
    }
  }
  walk(rootId)
  return out
}

/** path of node below `rootId` (excluding the root's own name) */
function relPathUnder(n: FSNode, rootId: string): string {
  const parts: string[] = [n.name]
  let cur = fs.get(n.parent || '')
  while (cur && cur.id !== rootId) {
    parts.unshift(cur.name)
    cur = fs.get(cur.parent || '')
  }
  return parts.join('/')
}

/** full path including root folder name, e.g. Documents/Welcome.txt */
function fullPath(n: FSNode): string {
  const parts: string[] = [n.name]
  let cur = fs.get(n.parent || '')
  while (cur) {
    parts.unshift(cur.name)
    cur = fs.get(cur.parent || '')
  }
  return parts.join('/')
}

/** stored blob → meta.text fallback */
async function fileBlob(n: FSNode): Promise<Blob | null> {
  const b = await fs.getBlob(n.id)
  if (b) return b
  if (typeof n.meta?.text === 'string') return new Blob([n.meta.text], { type: n.mime || 'text/plain' })
  return null
}

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t))
}

/** run async workers over a list with limited concurrency */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx])
    }
  })
  await Promise.all(workers)
}

/**
 * Zip the whole virtual FS (rootId omitted) or one folder subtree and trigger a download.
 * Blob-backed files and text files are added directly; remote (stock) files are fetched
 * on a best-effort basis — unreachable ones get a `.URL.txt` stub instead.
 */
export async function exportFsZip(
  opts: { rootId?: string; zipName?: string; onProgress?: (p: ZipProgress) => void } = {}
): Promise<ZipResult | null> {
  const { rootId, zipName, onProgress } = opts
  const rootNode = rootId ? fs.get(rootId) : undefined
  if (rootId && !rootNode) return null

  const zip = new JSZip()
  const scopeId = rootId as string | undefined
  const fileNodes: FSNode[] = rootNode
    ? collectTree(scopeId!).filter((n) => n.kind === 'file')
    : fs.all().filter((n) => n.kind === 'file' && !n.trashed)

  const total = fileNodes.length
  const manifest: string[] = [
    'REDSEC v5.0 — Files backup',
    `Exported: ${new Date().toLocaleString()}`,
    `Scope: ${rootNode ? `${rootNode.name}/ (full subtree)` : 'entire file system'}`,
    `Files: ${total}`,
    '',
    'Tip: this ZIP mirrors your OS folder structure. Unreachable remote files',
    '(stock photos / videos) are saved as .URL.txt stubs pointing to their source.',
    '',
    '— REDSEC Team',
  ]

  let done = 0
  let skipped = 0
  /* local blobs / text resolve instantly; remote (stock) files fetch 8-at-a-time
     with an 8s timeout each so an offline sandbox never stalls the export */
  const pathOf = (n: FSNode) => (rootNode ? `${rootNode.name}/${relPathUnder(n, scopeId!)}` : fullPath(n))

  const handle = async (n: FSNode) => {
    const path = pathOf(n)
    manifest.push(`${(n.size || 0).toString().padStart(10)}  ${path}`)
    const b = await fileBlob(n)
    if (b) {
      zip.file(path, b)
    } else if (n.url) {
      try {
        const res = await fetchWithTimeout(n.url, 8000)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        zip.file(path, await res.blob())
      } catch {
        zip.file(`${path}.URL.txt`, `${n.name}\n\nRemote file (could not be fetched during export):\n${n.url}\n`)
        skipped++
      }
    } else {
      skipped++
    }
    done++
    onProgress?.({ done, total, name: n.name })
  }

  await pool(fileNodes, 8, handle)

  zip.file('RE-FALCON-BACKUP.txt', manifest.join('\n'))
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } })

  const u = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = u
  a.download = zipName || `REDSEC-Files-${new Date().toISOString().slice(0, 10)}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(u), 8000)
  return { files: done, skipped, size: blob.size }
}

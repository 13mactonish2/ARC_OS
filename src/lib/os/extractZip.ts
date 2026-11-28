// REDSEC 5.x — ZIP extractor (Task 29): unzip archives from the File Manager
// into the OS virtual file system, nested folders included, so every extracted
// file is immediately usable (open images/videos/text, run code, set wallpaper…).
// Uses JSZip (already shipped for the ZIP *export* feature) — pure client-side.
'use client'

import JSZip from 'jszip'
import { fs, fsLoad, fsCreateFolder } from './fs'
import type { FSNode } from './types'

export interface ZipEntry {
  path: string
  size: number
  dir: boolean
}

export interface ExtractResult {
  rootId: string
  files: number
  folders: number
  skipped: number
}

/** safety rails — protect the IndexedDB-backed FS from archive bombs */
const MAX_FILES = 1500
const MAX_UNCOMPRESSED = 768 * 1024 * 1024 // 768 MB

const MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  pdf: 'application/pdf', zip: 'application/zip', json: 'application/json', wasm: 'application/wasm',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', htm: 'text/html',
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', ts: 'text/plain', tsx: 'text/plain',
  py: 'text/x-python', java: 'text/plain', c: 'text/plain', cpp: 'text/plain', h: 'text/plain', hpp: 'text/plain',
  sh: 'text/x-sh', yaml: 'text/yaml', yml: 'text/yaml', xml: 'text/xml', ini: 'text/plain', cfg: 'text/plain',
  sql: 'text/plain', toml: 'text/plain', log: 'text/plain',
}

export function mimeForExt(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return MIME_MAP[ext] || 'application/octet-stream'
}

/** clean a zip path: strip drive letters / absolute roots / traversal */
function safeParts(p: string): string[] {
  return p
    .replace(/^[a-zA-Z]:[\\/]/, '') // C:\
    .replace(/^[\\/]+/, '') // /root
    .split(/[\\/]/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
}

function sizeOfEntry(entry: JSZip.JSZipObject): number {
  try {
    return (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
  } catch {
    return 0
  }
}

async function zipBlobOf(node: FSNode): Promise<Blob> {
  const b = await fs.getBlob(node.id)
  if (b) return b
  if (node.url) {
    const r = await fetch(node.url)
    if (!r.ok) throw new Error(`could not fetch archive (HTTP ${r.status})`)
    return r.blob()
  }
  throw new Error('archive has no stored data')
}

/** entry list for the archive preview overlay (cheap — no data decompressed) */
export async function listZipEntries(node: FSNode): Promise<ZipEntry[]> {
  const blob = await zipBlobOf(node)
  const zip = await JSZip.loadAsync(blob)
  const out: ZipEntry[] = []
  zip.forEach((path, entry) => {
    out.push({ path, size: entry.dir ? 0 : sizeOfEntry(entry), dir: Boolean(entry.dir) })
  })
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

/**
 * Extract `node` (a .zip file in the OS FS) into a new folder inside `destParent`.
 * Nested zip folders become real OS folders; every file lands usable with a
 * proper mime type. Returns the created root folder so callers can navigate to it.
 */
export async function extractZipArchive(
  node: FSNode,
  destParent: string,
  onProgress?: (done: number, total: number, name: string) => void
): Promise<ExtractResult> {
  const blob = await zipBlobOf(node)
  const zip = await JSZip.loadAsync(blob)

  /* collect + validate file entries first (skip mac junk, traversal, caps) */
  const fileEntries: Array<{ parts: string[]; entry: JSZip.JSZipObject }> = []
  let skipped = 0
  let overFiles = false
  zip.forEach((path, entry) => {
    if (entry.dir) return
    if (/^__MACOSX\//i.test(path) || /(^|\/)\.DS_Store$/i.test(path) || /(^|\/)Thumbs\.db$/i.test(path)) {
      skipped++
      return
    }
    const parts = safeParts(path)
    if (!parts.length) {
      skipped++
      return
    }
    if (fileEntries.length >= MAX_FILES) {
      overFiles = true
      return
    }
    fileEntries.push({ parts, entry })
  })
  if (overFiles) throw new Error(`archive holds more than ${MAX_FILES} files — too large to extract safely`)

  const totalBytes = fileEntries.reduce((s, f) => s + sizeOfEntry(f.entry), 0)
  if (totalBytes > MAX_UNCOMPRESSED) {
    throw new Error(`archive decompresses to ${(totalBytes / 1024 / 1024).toFixed(0)} MB — over the ${(MAX_UNCOMPRESSED / 1024 / 1024).toFixed(0)} MB limit`)
  }

  await fsLoad()
  const base = (node.name.replace(/\.zip$/i, '').trim() || 'Extracted files').slice(0, 60)
  const root = await fsCreateFolder(destParent, base)

  const dirCache = new Map<string, string>()
  let folders = 0
  const ensureDir = async (parts: string[]): Promise<string> => {
    let pid = root.id
    let key = ''
    for (const part of parts) {
      key = key ? `${key}/${part}` : part
      const hit = dirCache.get(key)
      if (hit) {
        pid = hit
        continue
      }
      const f = await fsCreateFolder(pid, part)
      dirCache.set(key, f.id)
      pid = f.id
      folders++
    }
    return pid
  }

  let files = 0
  for (let i = 0; i < fileEntries.length; i++) {
    const { parts, entry } = fileEntries[i]
    try {
      const pid = await ensureDir(parts.slice(0, -1))
      const name = parts[parts.length - 1]
      const data = await entry.async('blob')
      await fs.addFile(pid, name, {
        blob: data,
        mime: mimeForExt(name) || data.type,
        meta: { fromZip: node.name },
      })
      files++
    } catch {
      skipped++
    }
    onProgress?.(i + 1, fileEntries.length, parts.join('/'))
  }

  return { rootId: root.id, files, folders, skipped }
}

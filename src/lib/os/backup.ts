// REDSEC 5.0 — Backup Center engine (full OS backup / restore as a store-only ZIP)
'use client'

import { set } from 'idb-keyval'
import { K } from './keys'
import { fs, fsAll, fsGetBlob } from './fs'
import { useOS } from './store'
import type { FSNode, OSStore } from './types'

/* ---------------- localStorage stamps ---------------- */

export const BACKUP_LAST_KEY = 'redsec5.backup.last'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function lastBackupAt(): number {
  try {
    return Number(localStorage.getItem(BACKUP_LAST_KEY) || 0) || 0
  } catch {
    return 0
  }
}

export function markBackupDone(): void {
  try {
    localStorage.setItem(BACKUP_LAST_KEY, String(Date.now()))
  } catch {
    /* storage unavailable */
  }
}

/** true when the last backup stamp is older than 7 days (never-backed-up → not due) */
export function backupDue(): boolean {
  const t = lastBackupAt()
  if (!t) return false
  return Date.now() - t > WEEK_MS
}

/* ---------------- store-only ZIP writer ----------------
   Same technique as exportZip.ts's ZIP output, but hand-rolled so the archive is
   guaranteed STORE-only (method 0, sizes in the local headers, no data
   descriptors) — exactly the format restoreBackupZip() parses back. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  name: string
  data: Uint8Array<ArrayBuffer>
}

function u16at(b: Uint8Array, off: number, v: number): void {
  new DataView(b.buffer, b.byteOffset, b.byteLength).setUint16(off, v, true)
}
function u32at(b: Uint8Array, off: number, v: number): void {
  new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(off, v, true)
}

/** build a ZIP with every entry stored uncompressed (method 0) */
function buildStoreZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder()
  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff
  const dosDate = ((((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff

  const locals: Uint8Array<ArrayBuffer>[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0

  for (const e of entries) {
    const name = enc.encode(e.name)
    const crc = crc32(e.data)
    const size = e.data.length

    // local file header (30 bytes) + name + payload
    const lh = new Uint8Array(30)
    u32at(lh, 0, 0x04034b50) // local file header signature
    u16at(lh, 4, 20) // version needed
    u16at(lh, 6, 0x0800) // flags: UTF-8 names, no data descriptor
    u16at(lh, 8, 0) // method: STORE
    u16at(lh, 10, dosTime)
    u16at(lh, 12, dosDate)
    u32at(lh, 14, crc)
    u32at(lh, 18, size) // compressed size
    u32at(lh, 22, size) // uncompressed size
    u16at(lh, 26, name.length)
    u16at(lh, 28, 0) // extra length
    locals.push(lh, name, e.data)

    // central directory record (46 bytes) + name
    const cd = new Uint8Array(46)
    u32at(cd, 0, 0x02014b50) // central directory signature
    u16at(cd, 4, 20) // version made by
    u16at(cd, 6, 20) // version needed
    u16at(cd, 8, 0x0800) // flags
    u16at(cd, 10, 0) // method: STORE
    u16at(cd, 12, dosTime)
    u16at(cd, 14, dosDate)
    u32at(cd, 16, crc)
    u32at(cd, 20, size)
    u32at(cd, 24, size)
    u16at(cd, 28, name.length)
    u32at(cd, 42, offset) // local header offset
    central.push(cd, name)

    offset += 30 + name.length + size
  }

  const centralSize = central.reduce((a, b) => a + b.length, 0)
  const eocd = new Uint8Array(22)
  u32at(eocd, 0, 0x06054b50) // end-of-central-directory signature
  u16at(eocd, 8, entries.length)
  u16at(eocd, 10, entries.length)
  u32at(eocd, 12, centralSize)
  u32at(eocd, 16, offset)
  return new Blob([...locals, ...central, eocd], { type: 'application/zip' })
}

/* ---------------- settings snapshot ---------------- */

/** transient keys stripped from the backup — the SAME list the zustand persist partialize drops */
const TRANSIENT_KEYS: ReadonlySet<string> = new Set([
  'windows', 'zCounter', 'focusedWin', 'ctx', 'snapPreview', 'snapAssist', 'phase', 'startOpen',
  'widgetOpen', 'notifOpen', 'searchOpen', 'runOpen', 'clipOpen', 'emojiOpen', 'keyboardOpen',
  'recording', 'sessionStart', 'locked', 'closing', 'minimizing', 'vdeskActive',
  'taskViewOpen', 'mixerOpen', 'shakeRestore', 'deskPicker', 'fullscreenActive', 'fsPromptOff',
  // zustand actions are functions — skipped below as well
])

/** persisted snapshot of the store (same shape zustand writes to localStorage) */
function settingsSnapshot(): Record<string, unknown> {
  const st = useOS.getState() as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(st)) {
    if (TRANSIENT_KEYS.has(k)) continue
    if (typeof v === 'function') continue // actions
    out[k] = v
  }
  return out
}

/** whitelisted fields applyBackupSettings is allowed to write back — never phase/windows/transients */
const SAFE_SETTINGS: readonly (keyof OSStore)[] = [
  'setupComplete',
  'username', 'password', 'continent',
  'wallpaper', 'themeBg', 'taskbarColor', 'taskbarAlign', 'taskbarTheme', 'taskbarPinned', 'panelSize',
  'wifi', 'bluetooth', 'airplane', 'nightLight', 'brightness', 'volume', 'sharing', 'autoTime',
  'desktopItems', 'installedApps', 'updates', 'drivers',
  'storeAgreed', 'voiceEnabled', 'securityPatchLevel', 'desktopWidgets', 'dnd',
  'clipboardHistory', 'wallpaperSlideshow', 'emojiRecents', 'appVolumes', 'mixerSolo', 'notifPrefs', 'recentApps',
'fullscreenWanted', 'shieldAutoScan', 'vdeskCount',
]

/** apply only safe persisted fields from a restored settings.json (never phase/windows/transients) */
export function applyBackupSettings(s: Partial<OSStore>): void {
  if (!s || typeof s !== 'object') return
  const patch: Record<string, unknown> = {}
  for (const k of SAFE_SETTINGS) {
    if (k in s && s[k] !== undefined) patch[k] = s[k]
  }
  if (!Object.keys(patch).length) return
  useOS.getState().set(patch as Partial<OSStore>)
}

/* ---------------- export ---------------- */

/** build the full OS backup (manifest + settings + fs nodes + blobs) as a store-only ZIP */
export async function exportBackupZip(): Promise<Blob> {
  const enc = new TextEncoder()
  const nodes = fsAll()
  const fileNodes = nodes.filter((n) => n.kind === 'file')
  const manifest = {
    product: 'REDSEC',
    version: '5.0',
    at: Date.now(),
    files: fileNodes.length,
    settings: true,
  }
  const entries: ZipEntry[] = [
    { name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 2)) },
    { name: 'settings.json', data: enc.encode(JSON.stringify(settingsSnapshot(), null, 2)) },
    { name: 'fs/nodes.json', data: enc.encode(JSON.stringify(nodes)) },
  ]
  // stored blobs (text-only nodes keep their text inlined in nodes.json meta, like fs stores them)
  for (const n of fileNodes) {
    const b = await fsGetBlob(n.id)
    if (b) entries.push({ name: `fs/blobs/${n.id}`, data: new Uint8Array(await b.arrayBuffer()) })
  }
  return buildStoreZip(entries)
}

/* ---------------- restore ---------------- */

export interface BackupRestoreResult {
  ok: boolean
  restored: number // number of file blobs written back into IDB
  settings: boolean // settings.json was present in the archive
  data?: Partial<OSStore> // parsed settings.json — pass to applyBackupSettings()
  error?: string // soft warnings (e.g. skipped deflate entries) or the hard failure
}

/**
 * Parse a store-only ZIP backup and write it back into IndexedDB.
 * Reads local file headers (0x04034b50, sizes inline, no data descriptor).
 * Deflate (method 8) entries are skipped with a soft warning — our own
 * backups are always store-only. NOTE: this replaces the whole virtual FS;
 * the caller must location.reload() afterwards so the fs module re-loads.
 */
export async function restoreBackupZip(file: File): Promise<BackupRestoreResult> {
  try {
    const buf = new Uint8Array(await file.arrayBuffer())
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    const dec = new TextDecoder()
    const entries = new Map<string, Uint8Array<ArrayBuffer>>()
    const warnings: string[] = []

    // ---- parse local file headers sequentially ----
    let p = 0
    while (p + 30 <= buf.length) {
      const sig = dv.getUint32(p, true)
      if (sig !== 0x04034b50) break // central directory reached (or trailing garbage)
      const flags = dv.getUint16(p + 6, true)
      const method = dv.getUint16(p + 8, true)
      const compSize = dv.getUint32(p + 18, true)
      const nameLen = dv.getUint16(p + 26, true)
      const extraLen = dv.getUint16(p + 28, true)
      const nameStart = p + 30
      const dataStart = nameStart + nameLen + extraLen
      if (nameLen <= 0 || dataStart + compSize > buf.length) {
        warnings.push('corrupt local header — archive truncated')
        break
      }
      const name = dec.decode(buf.subarray(nameStart, nameStart + nameLen))
      if (flags & 0x08) {
        // data descriptor: sizes are zeroed in the header — cannot skip reliably
        warnings.push(`${name}: data descriptor entries unsupported`)
        break
      }
      if (method === 8) {
        warnings.push(`${name}: deflated entry skipped (backups must be store-only)`)
      } else if (method === 0 && !name.endsWith('/')) {
        entries.set(name, buf.subarray(dataStart, dataStart + compSize))
      }
      p = dataStart + compSize
    }
    if (!entries.size && !warnings.length) {
      return { ok: false, restored: 0, settings: false, error: 'Not a ZIP archive (no local file headers found)' }
    }

    // ---- settings.json (returned to the caller; applied via applyBackupSettings) ----
    let settings = false
    let data: Partial<OSStore> | undefined
    const sRaw = entries.get('settings.json')
    if (sRaw) {
      try {
        data = JSON.parse(dec.decode(sRaw)) as Partial<OSStore>
        settings = true
      } catch {
        warnings.push('settings.json unreadable')
      }
    }

    // ---- manifest sanity (soft) ----
    const mRaw = entries.get('manifest.json')
    if (mRaw) {
      try {
        const m = JSON.parse(dec.decode(mRaw)) as { product?: string; version?: string }
        if (m && m.product !== 'REDSEC') warnings.push('manifest: not a REDSEC backup')
      } catch {
        /* manifest is advisory only */
      }
    }

    // ---- fs/nodes.json is mandatory ----
    const nRaw = entries.get('fs/nodes.json')
    if (!nRaw) {
      return { ok: false, restored: 0, settings, error: warnings[0] || 'Not a REDSEC 5.0 backup — fs/nodes.json missing' }
    }
    let parsedNodes: FSNode[]
    try {
      const arr = JSON.parse(dec.decode(nRaw)) as unknown
      if (!Array.isArray(arr) || !arr.length) throw new Error('empty node list')
      parsedNodes = arr as FSNode[]
    } catch {
      return { ok: false, restored: 0, settings, error: warnings[0] || 'fs/nodes.json unreadable' }
    }

    // ---- write blobs first, then swap the node tree (fs.wipeAll clears the
    //      in-memory cache + old K.fsNodes; K.fsNodes is written back last so a
    //      valid tree only appears once every blob is in place) ----
    let restored = 0
    for (const [name, bytes] of entries) {
      if (!name.startsWith('fs/blobs/')) continue
      const id = name.slice('fs/blobs/'.length)
      if (!id) continue
      const node = parsedNodes.find((n) => n.id === id)
      await set(K.blob(id), new Blob([bytes], { type: node?.mime || 'application/octet-stream' }))
      restored++
    }
    await fs.wipeAll() // drop fs module cache + delete the old K.fsNodes key
    await set(K.fsNodes, parsedNodes)

    return { ok: true, restored, settings, data, error: warnings.length ? warnings.join('; ') : undefined }
  } catch (e) {
    return { ok: false, restored: 0, settings: false, error: e instanceof Error ? e.message : 'Restore failed' }
  }
}

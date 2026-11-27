// REDSEC 5.0 — comm client lib: socket singleton, QR, join links, security events
'use client'

import { io, type Socket } from 'socket.io-client'

let socketInst: Socket | null = null

/** shared connection to the comm-service (call signaling + chat relay) */
export function commSocket(): Socket {
  if (socketInst?.connected) return socketInst
  if (!socketInst) {
    // NEVER use a port in the URL — Caddy forwards via XTransformPort
    socketInst = io('/?XTransformPort=3005', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 12,
      reconnectionDelay: 900,
      timeout: 12000,
    })
  }
  socketInst.connect()
  return socketInst
}

/* ---------------- codes & links ---------------- */
export function localCode(): string {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return String(a[0] % 1_000_000).padStart(6, '0')
}

/* ---------------- Task 67: zero-JSON-error fetch ----------------
   Every chat API call goes through here: the response is ALWAYS parsed
   inside a guard, a 404/500 HTML page can never throw "Unexpected token",
   and callers always get a shaped result with a human message. */
export interface JsonFetchResult<T> {
  ok: boolean
  status: number
  data: T | null
  message?: string
}
export async function jsonFetch<T = unknown>(url: string, init?: RequestInit): Promise<JsonFetchResult<T>> {
  let r: Response
  try {
    r = await fetch(url, init)
  } catch (e) {
    return { ok: false, status: 0, data: null, message: e instanceof Error ? e.message : 'Network error' }
  }
  let data: unknown = null
  let message: string | undefined
  try {
    data = await r.json()
  } catch {
    message = r.ok ? 'Unexpected server response' : `Service error (${r.status})`
  }
  const obj = (data && typeof data === 'object' ? data : {}) as { ok?: boolean; message?: string }
  if (!r.ok && !message) message = obj.message || `Request failed (${r.status})`
  return { ok: r.ok && obj.ok !== false, status: r.status, data: data as T, message }
}

/* --------------- Task 67: Global Lounge presence socket ---------------
   The shared commSocket() can only sit in ONE chat room at a time (the
   relay swaps the peer entry on re-join). This second, dedicated
   connection parks in the Global Lounge (code 000000) for the whole OS
   session so EVERY OS user on EVERY device is visible in the Chat app's
   People list — no code, no invite, and it works before Chat even opens. */
let presInst: Socket | null = null
const lobbyPeers = new Map<string, { id: string; name: string }>()
const lobbyListeners = new Set<(peers: Array<{ id: string; name: string }>) => void>()

function lobbyRoster(): Array<{ id: string; name: string }> {
  return [...lobbyPeers.values()]
}
function emitLobby(): void {
  const roster = lobbyRoster()
  for (const cb of lobbyListeners) {
    try {
      cb(roster)
    } catch {
      /* a dead listener never breaks the rest */
    }
  }
}

/** subscribe to live Global Lounge presence (fires immediately with the roster) */
export function onLobbyPresence(cb: (peers: Array<{ id: string; name: string }>) => void): () => void {
  lobbyListeners.add(cb)
  cb(lobbyRoster())
  return () => {
    lobbyListeners.delete(cb)
  }
}

/** join the Global Lounge presence channel — idempotent, safe at OS boot */
export function lobbyPresenceJoin(name: string): Socket {
  if (!presInst) {
    // NEVER use a port in the URL — Caddy forwards via XTransformPort
    presInst = io('/?XTransformPort=3005', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 999,
      reconnectionDelay: 1200,
      timeout: 12000,
    })
    presInst.on('chat:presence', (d: { peers?: Array<{ id: string; name: string }> }) => {
      if (d.peers) {
        lobbyPeers.clear()
        for (const p of d.peers) lobbyPeers.set(p.id, p)
      }
      emitLobby()
    })
    presInst.on('disconnect', () => {
      lobbyPeers.clear()
      emitLobby()
    })
  }
  const join = () => {
    presInst?.emit('chat:join', { code: '000000', name: name || 'User' }, (res: { peers?: Array<{ id: string; name: string }> }) => {
      if (res?.peers) {
        lobbyPeers.clear()
        for (const p of res.peers) lobbyPeers.set(p.id, p)
        emitLobby()
      }
    })
  }
  if (presInst.connected) join()
  else presInst.once('connect', join)
  return presInst
}

export function callJoinUrl(code: string): string {
  return `${typeof location !== 'undefined' ? location.origin : ''}/?app=call&join=${code}`
}

export function chatJoinUrl(code: string): string {
  return `${typeof location !== 'undefined' ? location.origin : ''}/?app=chat&join=${code}`
}

/** Workspace QR: the same 6-digit/QR invite environment chat rooms use,
 *  landing any device on the files-only workspace join page. */
export function workspaceJoinUrl(code: string): string {
  return `${typeof location !== 'undefined' ? location.origin : ''}/?app=chat&wsjoin=${code}`
}

/** Task 66 — the Mail QR: lands any phone on the REDSEC Mobile hub (mail tab) */
export function mailAppUrl(): string {
  return `${typeof location !== 'undefined' ? location.origin : ''}/?app=mail`
}

export type GuestMode = 'chat' | 'workspace' | 'hub' | 'mobileos' | 'owner'
export interface GuestIntent {
  mode: GuestMode
  code: string
}
export function readGuestIntent(): GuestIntent | null {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search)
  const legacyJoin = q.get('join')
  const legacyChat = q.get('chatjoin')
  const app = (q.get('app') || '').toLowerCase()
  const join = (q.get('join') || '').replace(/\D/g, '').slice(0, 6)
  // Task 16/18 — Mobile OS (RedSec Mobile VM): /?mobileos=1&pair=<token>
  // (QR scan) or /?mobileos=1&pin=<6 digits> (typed pairing)
  if (q.get('mobileos') === '1' || app === 'mobileos' || app === 'z10' || app === 'redsecmobile') {
    const pair = (q.get('pair') || '').trim().slice(0, 48)
    const pin = (q.get('pin') || '').replace(/\D/g, '').slice(0, 6)
    return { mode: 'mobileos', code: pair || pin }
  }
  // Task 18 — Owner Console (mobile-only, QR entry): /?owner=<ownerToken>
  const ownerTok = (q.get('owner') || '').trim().slice(0, 48)
  if (ownerTok) return { mode: 'owner', code: ownerTok }
  // legacy QRs keep working (retired call/mail QRs land on the mobile hub)
  if (legacyJoin && /^\d{6}$/.test(legacyJoin)) return { mode: 'chat', code: legacyJoin }
  if (legacyChat && /^\d{6}$/.test(legacyChat)) return { mode: 'chat', code: legacyChat }
  // Workspace QRs — /?app=chat&wsjoin=CODE → the files-only workspace join page
  const wsJoin = (q.get('wsjoin') || '').replace(/\D/g, '').slice(0, 6)
  if (wsJoin && /^\d{6}$/.test(wsJoin)) return { mode: 'workspace', code: wsJoin }
  if (/^\d{6}$/.test(legacyJoin) && q.get('ws') === '1') return { mode: 'workspace', code: legacyJoin }
  if (app === 'call' || app === 'mail') return { mode: 'hub', code: '' }
  if (app === 'chat') return { mode: 'chat', code: /^\d{6}$/.test(join) ? join : '' }
  if (q.get('mobile') === '1' || app === 'hub' || app === 'home') return { mode: 'hub', code: '' }
  return null
}

/* ---------------- QR (client-side, no network needed) ---------------- */
export async function makeQr(text: string): Promise<string> {
  const QR = (await import('qrcode')).default
  return QR.toDataURL(text, {
    margin: 1,
    width: 320,
    color: { dark: '#0b1220', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  })
}

/* ---------------- security event bus (Security Core live feed) ---------------- */
export interface ClientSecEvent {
  at: number
  scope: string // chat | call | mail | system
  msg: string
  kind?: 'allow' | 'block' | 'warn'
}

const SEC_LOG_KEY = 'redsec5.secfeed.v1'

export function logSecEvent(scope: string, msg: string, kind: ClientSecEvent['kind'] = 'allow'): void {
  try {
    const raw = localStorage.getItem(SEC_LOG_KEY)
    const arr: ClientSecEvent[] = raw ? JSON.parse(raw) : []
    arr.unshift({ at: Date.now(), scope, msg, kind })
    localStorage.setItem(SEC_LOG_KEY, JSON.stringify(arr.slice(0, 200)))
    window.dispatchEvent(new CustomEvent('sec-event', { detail: { scope, msg, kind } }))
  } catch {
    /* storage full/blocked — feed is best-effort */
  }
}

export function readSecLog(): ClientSecEvent[] {
  try {
    return JSON.parse(localStorage.getItem(SEC_LOG_KEY) || '[]')
  } catch {
    return []
  }
}

/* ---------------- uploads ---------------- */
export interface UploadedFile {
  id: string
  name: string
  mime: string
  size: number
  url: string
}

/** upload a blob/file through the guarded API; source tags it for the archive.
    Task 67 — response is parsed through the zero-JSON-error guard, so a failed
    upload can never blow up with "Unexpected token '<' in JSON". */
export async function uploadFile(file: File | Blob, name: string, source: 'chat' | 'mail' | 'call' | 'manual' | 'workspace'): Promise<UploadedFile> {
  const fd = new FormData()
  fd.append('file', file instanceof File ? file : new File([file], name))
  fd.append('source', source)
  const res = await jsonFetch<{ ok?: boolean; file?: UploadedFile; message?: string }>('/api/upload', { method: 'POST', body: fd })
  if (!res.ok || !res.data?.file) throw new Error(res.message || res.data?.message || 'Upload failed')
  return res.data.file
}

/** WORKSPACE UPLOAD — unlimited size, any type. The file body streams raw to
 *  /api/workspace/upload (never fully buffered on the server), so photos,
 *  videos, sounds, archives — anything — land in the vault no matter how big
 *  they are. The response is parsed through the zero-JSON-error guard. */
export async function uploadWorkspaceFile(file: File | Blob, name: string): Promise<UploadedFile> {
  const res = await jsonFetch<{ ok?: boolean; file?: UploadedFile; message?: string }>('/api/workspace/upload', {
    method: 'POST',
    headers: {
      'x-ws-name': encodeURIComponent(name || (file instanceof File ? file.name : 'file.bin')),
      'content-type': 'application/octet-stream',
    },
    body: file,
  })
  if (!res.ok || !res.data?.file) throw new Error(res.message || res.data?.message || 'Upload failed')
  return res.data.file
}

export function fileKindOf(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

/* ---------------- misc ---------------- */
export function fmtTime(ts: number | string | Date): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function fmtDateTime(ts: number | string | Date): string {
  return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** capture a frame from a video element as a JPEG blob (call snapshots) */
export function snapshotVideo(v: HTMLVideoElement, quality = 0.95): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = v.videoWidth || 1280
  c.height = v.videoHeight || 720
  const ctx = c.getContext('2d')!
  ctx.drawImage(v, 0, 0, c.width, c.height)
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('snapshot failed'))), 'image/jpeg', quality))
}

// REDSEC 5.0 — Mobile Link (Task 16/18): the PC ↔ RedSec Mobile VM bridge.
// A pairing token lives on the PC (localStorage); phones scan a QR (or type a
// 6-digit PIN over the comm-service) to join room mlink:<token>. The PC then
// mirrors its recent chats / notifications into the phone's RedSec Hub
// Hub. Same stores, same functions — a mobile UI that is NOT the PC UI.
'use client'

export const ML_KEY = 'redsec5.mobilelink.v1'
export const PHONE_TOKEN_KEY = 'redsec5.mobile.token.v1'
export const PHONE_SYNC_KEY = 'redsec5.mobile.sync.v1'
export const PHONE_EVENTS_KEY = 'redsec5.mobile.events.v1'
export const PHONE_PREFS_KEY = 'redsec5.mobile.os.v1'

export type MLinkKind = 'pc' | 'phone' | 'vm'

export interface MLinkPaired {
  device: string
  kind: MLinkKind
  pairedAt: number
  lastSeen: number
}

export interface MLinkInfo {
  token: string
  createdAt: number
  paired: MLinkPaired | null
  history: Array<{ device: string; kind: MLinkKind; at: number }>
}

export interface MLinkSyncPayload {
  username: string
  at: number
  notifs: Array<{ id: string; title: string; body?: string; at: number; kind?: string; app?: string }>
  mail: { signedIn: boolean; address?: string; provider?: string }
  chat: { name: string; rooms: Array<{ code: string; name: string; lastAt: number }> }
  counts: { notes: number; photos: number }
}

export function newToken(): string {
  const a = new Uint8Array(9)
  crypto.getRandomValues(a)
  const hex = [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `r5-${hex}`
}

export function loadInfo(): MLinkInfo | null {
  try {
    const raw = localStorage.getItem(ML_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<MLinkInfo>
    if (!p || typeof p.token !== 'string' || !/^r5-[a-z0-9]{6,40}$/i.test(p.token)) return null
    return {
      token: p.token,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
      paired: p.paired ?? null,
      history: Array.isArray(p.history) ? p.history.slice(-12) : [],
    }
  } catch {
    return null
  }
}

export function saveInfo(info: MLinkInfo): void {
  try {
    localStorage.setItem(ML_KEY, JSON.stringify({ ...info, history: (info.history || []).slice(-12) }))
  } catch {
    /* best effort */
  }
}

/** token is created on first use and survives forever (like the username) */
export function ensureInfo(): MLinkInfo {
  const existing = loadInfo()
  if (existing) return existing
  const info: MLinkInfo = { token: newToken(), createdAt: Date.now(), paired: null, history: [] }
  saveInfo(info)
  return info
}

export function regenToken(): MLinkInfo {
  const prev = loadInfo()
  const info: MLinkInfo = {
    token: newToken(),
    createdAt: Date.now(),
    paired: null,
    history: prev?.history || [],
  }
  saveInfo(info)
  return info
}

export function markPaired(token: string, device: string, kind: MLinkKind): MLinkInfo | null {
  const info = loadInfo()
  if (!info || info.token !== token) return null
  const now = Date.now()
  const wasNew = info.paired?.device !== device || info.paired?.kind !== kind
  info.paired = { device, kind, pairedAt: wasNew ? now : info.paired?.pairedAt || now, lastSeen: now }
  if (wasNew && !info.history.some((h) => h.device === device && h.kind === kind)) {
    info.history.push({ device, kind, at: now })
  }
  saveInfo(info)
  return info
}

export function markSeen(): void {
  const info = loadInfo()
  if (!info?.paired) return
  info.paired.lastSeen = Date.now()
  saveInfo(info)
}

export function clearPaired(): MLinkInfo | null {
  const info = loadInfo()
  if (!info) return null
  info.paired = null
  saveInfo(info)
  return info
}

/** deterministic 6-digit PIN derived from the token — typed on the phone as a QR alternative */
export function pinFromToken(token: string): string {
  let h = 5381
  for (let i = 0; i < token.length; i++) h = ((h * 33) ^ token.charCodeAt(i)) >>> 0
  return String(h % 1_000_000).padStart(6, '0')
}

/** the URL encoded into the QR code — lands the phone straight in the RedSec Mobile VM */
export function mlPhoneUrl(token: string): string {
  const origin = typeof location !== 'undefined' ? location.origin : ''
  return `${origin}/?mobileos=1&pair=${encodeURIComponent(token)}`
}

/**
 * Build a sync snapshot from THIS browser's stores. Used as the fallback when
 * the VM runs on the same page/browser as the PC (embedded VM in Mobile
 * Link) — there the socket relay cannot answer because both peers share one
 * socket instance. A scanned phone gets its snapshot over the socket instead.
 */
export function buildLocalSync(): MLinkSyncPayload {
  let username = 'User'
  const notifs: MLinkSyncPayload['notifs'] = []
  try {
    // read the persisted zustand store directly (no store import cycle)
    const raw = localStorage.getItem('redsec5.settings')
    if (raw) {
      const st = JSON.parse(raw) as { state?: { username?: string; notifications?: Array<{ id: string; title: string; body?: string; at: number; kind?: string; app?: string }> } }
      if (st?.state?.username) username = st.state.username
      for (const n of (st.state?.notifications || []).slice(0, 20)) {
        notifs.push({ id: n.id, title: n.title, body: n.body, at: n.at, kind: n.kind, app: n.app })
      }
    }
  } catch { /* best effort */ }
  let mail: MLinkSyncPayload['mail'] = { signedIn: false }
  try {
    const raw = localStorage.getItem('redsec5.mail.session.v1')
    if (raw) {
      const s = JSON.parse(raw) as { address?: string; provider?: string }
      mail = { signedIn: true, address: s.address, provider: s.provider }
    }
  } catch { /* best effort */ }
  const chat: MLinkSyncPayload['chat'] = { name: 'Me', rooms: [] }
  try {
    chat.name = localStorage.getItem('redsec5.chat.name.v1') || 'Me'
    const rooms = JSON.parse(localStorage.getItem('redsec5.chat.rooms.v1') || '[]')
    chat.rooms = Array.isArray(rooms) ? rooms.slice(0, 10) : []
  } catch { /* best effort */ }
  const counts = { notes: 0, photos: 0 }
  return { username, at: Date.now(), notifs, mail, chat, counts }
}

/* ---------------- phone-side persistence ---------------- */

export function phoneSaveToken(token: string): void {
  try {
    localStorage.setItem(PHONE_TOKEN_KEY, token)
  } catch {
    /* best effort */
  }
}

export function phoneLoadToken(): string {
  try {
    return localStorage.getItem(PHONE_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function phoneSaveSync(p: MLinkSyncPayload): void {
  try {
    localStorage.setItem(PHONE_SYNC_KEY, JSON.stringify(p))
  } catch {
    /* best effort */
  }
}

export function phoneLoadSync(): MLinkSyncPayload | null {
  try {
    const raw = localStorage.getItem(PHONE_SYNC_KEY)
    return raw ? (JSON.parse(raw) as MLinkSyncPayload) : null
  } catch {
    return null
  }
}

export interface PhoneEvent {
  id: string
  title: string
  body?: string
  at: number
  kind: 'chat' | 'mail' | 'call' | 'system'
  app?: string
}

export function phoneAddEvent(ev: Omit<PhoneEvent, 'id' | 'at'> & { at?: number }): PhoneEvent[] {
  const list = phoneLoadEvents()
  const item: PhoneEvent = { ...ev, id: `pe_${Math.random().toString(36).slice(2, 9)}`, at: ev.at ?? Date.now() }
  const next = [item, ...list].slice(0, 60)
  try {
    localStorage.setItem(PHONE_EVENTS_KEY, JSON.stringify(next))
  } catch {
    /* best effort */
  }
  return next
}

export function phoneLoadEvents(): PhoneEvent[] {
  try {
    const raw = localStorage.getItem(PHONE_EVENTS_KEY)
    const arr = raw ? (JSON.parse(raw) as PhoneEvent[]) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function phoneClearEvents(): void {
  try {
    localStorage.removeItem(PHONE_EVENTS_KEY)
  } catch {
    /* best effort */
  }
}

export interface PhonePrefs {
  accent: string
  theme: 'dark' | 'light'
  wallpaper: number
  hubReadAt: number
  boots: number
}

export const MB_ACCENTS = ['#e4002b', '#ffffff', '#7c3aed', '#0ea5e9', '#0ea5e9', '#f59e0b']

export function phoneLoadPrefs(): PhonePrefs {
  try {
    const raw = localStorage.getItem(PHONE_PREFS_KEY)
    const p = raw ? (JSON.parse(raw) as Partial<PhonePrefs>) : {}
    return {
      accent: typeof p.accent === 'string' ? p.accent : '#e4002b',
      theme: p.theme === 'light' ? 'light' : 'dark',
      wallpaper: typeof p.wallpaper === 'number' ? p.wallpaper : 0,
      hubReadAt: typeof p.hubReadAt === 'number' ? p.hubReadAt : 0,
      boots: typeof p.boots === 'number' ? p.boots : 0,
    }
  } catch {
    return { accent: '#e4002b', theme: 'dark', wallpaper: 0, hubReadAt: 0, boots: 0 }
  }
}

export function phoneSavePrefs(p: PhonePrefs): void {
  try {
    localStorage.setItem(PHONE_PREFS_KEY, JSON.stringify(p))
  } catch {
    /* best effort */
  }
}

// REDSEC 5.0 — Security Core (server side)
// Rate limiting, input hardening and secure code generation for every
// InterCore API (chat / mail / call / archive / upload). Every route in the
// OS goes through here so a rogue client cannot hammer or bypass the stack.
import { NextResponse } from 'next/server'

/* ---------------- rate limiting (sliding window, in-memory) ---------------- */
type Bucket = { hits: number[] }
const buckets = new Map<string, Bucket>()

export function rateLimit(key: string, limit = 30, windowMs = 60_000): { ok: boolean; retryAfter?: number } {
  const now = Date.now()
  const b = buckets.get(key) || { hits: [] }
  b.hits = b.hits.filter((t) => now - t < windowMs)
  if (b.hits.length >= limit) {
    buckets.set(key, b)
    const retryAfter = Math.ceil((windowMs - (now - b.hits[0])) / 1000)
    return { ok: false, retryAfter }
  }
  b.hits.push(now)
  buckets.set(key, b)
  // opportunistic cleanup so the map cannot grow forever
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.hits.length === 0 || now - v.hits[v.hits.length - 1] > 10 * windowMs) buckets.delete(k)
    }
  }
  return { ok: true }
}

export function clientKey(req: Request, scope: string): string {
  const fwd = req.headers.get('x-forwarded-for') || ''
  const ip = fwd.split(',')[0].trim() || 'local'
  return `${scope}:${ip}`
}

/* ---------------- responses ---------------- */
export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: code, message }, { status })
}

export function tooMany(retryAfter = 60) {
  const r = jsonError(429, 'rate_limited', 'Too many requests — slow down.')
  r.headers.set('Retry-After', String(retryAfter))
  return r
}

/* ---------------- input hardening ---------------- */
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** strip control chars, collapse length — every user string passes through this */
export function sanitizeText(raw: unknown, maxLen = 4000): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(CTRL, '').slice(0, maxLen)
}

export function sanitizeName(raw: unknown, maxLen = 60): string {
  const s = sanitizeText(raw, maxLen)
  // display names: keep letters/numbers/space/@/._- and unicode letters
  return s.replace(/[<>"/\\]/g, '').trim() || 'Guest'
}

const CODE_RE = /^\d{6}$/
export function isValidCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_RE.test(code)
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}$/
export function isEmail(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 320 && EMAIL_RE.test(s)
}

/* ---------------- secure generators ---------------- */
const rand = (n: number) => {
  const a = new Uint32Array(n)
  crypto.getRandomValues(a)
  return a
}

/** cryptographically random 6-digit room code (not guessable by sequence) */
export function genCode(): string {
  const [n] = rand(1)
  return String(n % 1_000_000).padStart(6, '0')
}

/** 32-hex session token */
export function genToken(): string {
  return Array.from(rand(16), (x) => x.toString(16).padStart(2, '0')).join('')
}

/** short fingerprint for the UI ("AB12-CD34") */
export function fingerprint(seed: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x1000193
  for (let i = 0; i < seed.length; i++) {
    h1 = (h1 ^ seed.charCodeAt(i)) * 0x01000193
    h2 = (h2 + seed.charCodeAt(i) * (i + 7)) >>> 0
  }
  const a = (h1 >>> 0).toString(16).padStart(8, '0').slice(0, 4).toUpperCase()
  const b = (h2 >>> 0).toString(16).padStart(8, '0').slice(0, 4).toUpperCase()
  return `${a}-${b}`
}

/* ---------------- upload guard ---------------- */
/* Task 35 — raised to 100 MB so any image / audio (FLAC, ALAC, …) / video
   transfers complete without errors while still capping abuse. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

export const ALLOWED_MIME = [
  'image/', 'video/', 'audio/',
  'application/pdf', 'application/zip', 'application/x-zip-compressed',
  'text/plain', 'text/markdown', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/json', 'application/octet-stream',
]

export function mimeAllowed(mime: string): boolean {
  return ALLOWED_MIME.some((p) => mime.startsWith(p))
}

/** security audit log — appended to by every guarded route (shown in Security Core) */
export interface SecEvent {
  at: number
  kind: 'allow' | 'block' | 'warn'
  scope: string
  msg: string
}
const secLog: SecEvent[] = []
export function logSec(kind: SecEvent['kind'], scope: string, msg: string) {
  secLog.push({ at: Date.now(), kind, scope, msg })
  if (secLog.length > 400) secLog.splice(0, secLog.length - 400)
}
export function recentSec(limit = 60): SecEvent[] {
  return secLog.slice(-limit).reverse()
}

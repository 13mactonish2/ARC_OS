// REDSEC 6.0 — Task 66: Term X Mobile (`mobile` in the OS terminal).
// Pairs a phone/tablet to the PC's terminal through the comm-service
// term:<token> rooms. The pairing token lives on BOTH sides forever (PC:
// localStorage here; phone: redsec5.mobile.token.v1 — the same token the
// RedSec Mobile VM already persists), so the terminal is available on the
// mobile device permanently until the owner turns it off from the PC.
'use client'

import { commSocket } from './comm'
import type { Socket } from 'socket.io-client'

export interface TermMobileState {
  token: string // r5-… pairing token (same family as Mobile Link tokens)
  enabled: boolean // false → the phone side shows "terminal disabled"
  paired: { device: string; pairedAt: number; lastSeen: number } | null
  history: Array<{ device: string; at: number }>
}

const KEY = 'redsec5.termmobile.v1'

export function termMobileLoad(): TermMobileState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<TermMobileState>
    if (!p || typeof p.token !== 'string' || !/^r5-[a-z0-9]{6,40}$/i.test(p.token)) return null
    return {
      token: p.token,
      enabled: p.enabled !== false,
      paired: p.paired ?? null,
      history: Array.isArray(p.history) ? p.history.slice(-12) : [],
    }
  } catch {
    return null
  }
}

export function termMobileSave(st: TermMobileState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...st, history: (st.history || []).slice(-12) }))
  } catch { /* best effort */ }
}

function newToken(): string {
  const a = new Uint8Array(9)
  crypto.getRandomValues(a)
  const hex = [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `r5-${hex}`
}

/** ensure a pairing state exists (created once, survives forever) */
export function termMobileEnsure(): TermMobileState {
  const existing = termMobileLoad()
  if (existing) return existing
  const fresh: TermMobileState = { token: newToken(), enabled: true, paired: null, history: [] }
  termMobileSave(fresh)
  return fresh
}

/** regenerate the token — every previously paired device stops working */
export function termMobileNewToken(): TermMobileState {
  const prev = termMobileLoad()
  const fresh: TermMobileState = { token: newToken(), enabled: true, paired: null, history: prev?.history || [] }
  termMobileSave(fresh)
  return fresh
}

export function termMobilePatch(p: Partial<TermMobileState>): TermMobileState {
  const st = { ...termMobileEnsure(), ...p }
  termMobileSave(st)
  return st
}

/** mark a phone as paired (called when it joins the room) */
export function termMobileMarkPaired(device: string): void {
  const st = termMobileEnsure()
  const now = Date.now()
  const isNew = st.paired?.device !== device
  st.paired = { device, pairedAt: isNew ? now : st.paired?.pairedAt || now, lastSeen: now }
  if (isNew && !st.history.some((h) => h.device === device)) st.history.push({ device, at: now })
  termMobileSave(st)
}

/** the URL the QR encodes — lands the phone in RedSec Mobile with the Term X app open */
export function termMobileUrl(token: string): string {
  const origin = typeof location !== 'undefined' ? location.origin : ''
  return `${origin}/?mobileos=1&pair=${encodeURIComponent(token)}&term=1`
}

/* ---------------- the live bridge (socket singleton per page) ---------------- */

type CmdHandler = (cmd: string, device: string) => void
type PhoneHandler = (device: string, joined: boolean) => void

let socket: Socket | null = null
let joinedToken = ''
let cmdHandler: CmdHandler | null = null
let phoneHandler: PhoneHandler | null = null
let relayBound = false

export function termMobileOnCommand(cb: CmdHandler): void {
  cmdHandler = cb
}

export function termMobileOnPhone(cb: PhoneHandler): void {
  phoneHandler = cb
}

export interface JoinResult {
  ok: boolean
  error?: string
}

/** join the PC side of the room + wire the relay listeners (idempotent) */
export function termMobileJoin(token: string, device = 'REDSEC PC'): Promise<JoinResult> {
  return new Promise((resolve) => {
    const s = commSocket()
    socket = s
    /* bind the relay listeners exactly once per page — the terminal registers
       its handlers BEFORE calling join, so this must not depend on cmdHandler */
    if (!relayBound) {
      relayBound = true
      s.on('term:cmd', (d: { cmd?: string; device?: string }) => {
        if (d?.cmd) cmdHandler?.(String(d.cmd), String(d.device || 'phone'))
      })
      s.on('term:phone', (d: { device?: string; joined?: boolean }) => {
        phoneHandler?.(String(d?.device || 'phone'), !!d?.joined)
      })
      s.on('term:pc-online', () => {
        // a second PC tab joined — harmless (both can drive the OS)
      })
    }
    let settled = false
    const finish = (r: JoinResult): void => {
      if (settled) return
      settled = true
      try {
        ;(window as unknown as { __termx?: unknown }).__termx = {
          token,
          connected: s.connected,
          joined: joinedToken === token,
          ...r,
        }
      } catch { /* noop */ }
      resolve(r)
    }
    const to = setTimeout(() => finish({ ok: false, error: 'the comm service did not answer — retry `mobile` in a moment' }), 9000)
    const doJoin = (): void => {
      s.emit('term:join', { token, device, kind: 'pc' }, (r: { ok?: boolean }) => {
        clearTimeout(to)
        if (r?.ok) joinedToken = token
        finish({ ok: !!r?.ok, error: r?.ok ? undefined : 'join rejected — regenerate the pairing with `mobile new`' })
      })
    }
    /* join only once the relay link is actually up (socket.io queues the emit,
       but waiting for `connect` keeps the ack well inside the timeout) */
    if (s.connected) doJoin()
    else s.once('connect', doJoin)
  })
}

export function termMobileJoined(): boolean {
  return !!socket && !!joinedToken && socket.connected
}

/** stream terminal output to the paired phone(s) */
export function termMobilePushOut(lines: string[]): void {
  if (!socket || !joinedToken || !lines.length) return
  socket.emit('term:out', { token: joinedToken, lines: lines.slice(-80) })
}

/** broadcast the enabled/disabled state to the phone(s) */
export function termMobilePushState(state: { enabled: boolean; reason?: string }): void {
  if (!socket || !joinedToken) return
  socket.emit('term:state', { token: joinedToken, state })
}

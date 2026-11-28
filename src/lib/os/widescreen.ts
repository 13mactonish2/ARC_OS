// REDSEC v5.0 — Task 42/43: Wide Screen dual connect (HDMI extended display)
//
// The OS tab ("main") generates a 6-digit pairing code + a screen link
// (origin/?screen=pair). A NEW browser tab (or another device!) opened with
// that link becomes "Screen 2 — Extended Display": it enters the code, pairs,
// and windows sent from the main desktop render inside it for real
// multitasking.
//
// WHY THREE TRANSPORTS (fixes "can't connect"):
//   1. BroadcastChannel — instant, same tab-space (default path, zero lag)
//   2. localStorage bus + storage events — same-origin tabs even when
//      BroadcastChannel is blocked by the browser
//   3. /api/screenpair server relay — works even when the OS tab runs inside
//      a partitioned iframe (preview panels) or Screen 2 is on ANOTHER DEVICE
// Every message carries a unique `mid`; duplicates from parallel transports
// are dropped. The 6-digit code is persisted to localStorage so reloading the
// PC tab (e.g. pasting the link into the SAME tab) never kills the pairing —
// the previous in-memory-only code was the #1 "code rejected" cause.
'use client'

import { useSyncExternalStore } from 'react'
import { useOS } from './store'

export interface WsScreen {
  key: string
  appId: string
  title: string
  args?: Record<string, unknown>
}

export interface WsStatus {
  role: 'main' | 'ext'
  paired: boolean
  code: string | null
  pairedAt: number
}

type StatusFn = (s: WsStatus) => void
type ScreensFn = (s: WsScreen[]) => void

const CH_NAME = 'redsec-ws-v1'
const BUS_KEY = 'redsec5.ws.bus'
const CODE_KEY = 'redsec5.ws.code'
const HB_MS = 4000
const HB_TIMEOUT = 12000
const PAIR_TIMEOUT = 7000
const RELAY_MS = 1000

type WsMsg =
  | { t: 'pair_req'; extId: string; code: string }
  | { t: 'pair_ok'; extId: string }
  | { t: 'pair_bad'; extId: string }
  | { t: 'pair_bye'; from: string }
  | { t: 'hb'; extId: string }
  | { t: 'open'; key: string; appId: string; title: string; args?: Record<string, unknown> }
  | { t: 'close'; key: string }
  | { t: 'back'; key: string; appId: string; title: string; args?: Record<string, unknown> }
  | { t: 'closed'; key: string }

type WsMsgId = WsMsg & { mid?: string }

class WsManager {
  private ch: BroadcastChannel | null = null
  private extId = `ext_${Math.random().toString(36).slice(2, 8)}`
  private status: WsStatus = { role: 'main', paired: false, code: null, pairedAt: 0 }
  private screens: WsScreen[] = []
  private statusListeners = new Set<StatusFn>()
  private screenListeners = new Set<ScreensFn>()
  private statusSnap: WsStatus = { ...this.status }
  private screensSnap: WsScreen[] = []
  private hbTimer: ReturnType<typeof setInterval> | null = null
  private watchTimer: ReturnType<typeof setInterval> | null = null
  private relayTimer: ReturnType<typeof setInterval> | null = null
  private lastHb = 0
  private inited = false
  private seen = new Map<string, number>()
  private pendingCode: string | null = null
  private pairWaiter: ((m: WsMsgId) => void) | null = null
  private relaySeqByCode = new Map<string, number>()
  private busNonce = 0

  /* ---------------- subscription (useSyncExternalStore-ready) ---------------- */
  subscribeStatus = (fn: StatusFn): (() => void) => {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }
  getStatusSnapshot = (): WsStatus => this.statusSnap
  subscribeScreens = (fn: ScreensFn): (() => void) => {
    this.screenListeners.add(fn)
    return () => this.screenListeners.delete(fn)
  }
  getScreensSnapshot = (): WsScreen[] => this.screensSnap

  private emitStatus() {
    this.statusSnap = { ...this.status }
    this.statusListeners.forEach((fn) => fn(this.statusSnap))
  }
  private emitScreens() {
    this.screensSnap = this.screens.map((s) => ({ ...s }))
    this.screenListeners.forEach((fn) => fn(this.screensSnap))
  }

  /* ---------------- transports ---------------- */
  private ensureChannel(): BroadcastChannel | null {
    if (!this.ch && typeof BroadcastChannel !== 'undefined') {
      try {
        this.ch = new BroadcastChannel(CH_NAME)
        this.ch.onmessage = (ev: MessageEvent<WsMsgId>) => this.handleIncoming(ev.data)
      } catch {
        this.ch = null
      }
    }
    return this.ch
  }

  /** code used to route bus/relay envelopes for the NEXT message */
  private routeCode(): string | null {
    return this.status.code || this.pendingCode
  }

  private uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }

  private send(m: WsMsg) {
    const mid = this.uid()
    this.seen.set(mid, Date.now())
    if (this.seen.size > 300) {
      for (const k of Array.from(this.seen.keys()).slice(0, 100)) this.seen.delete(k)
    }
    const full: WsMsgId = { ...m, mid }
    // 1 — BroadcastChannel (instant)
    try {
      const ch = this.ensureChannel()
      ch?.postMessage(full)
    } catch { /* channel unavailable */ }
    // 2 — localStorage bus (survives blocked BroadcastChannel)
    try {
      const code = this.routeCode()
      if (code) {
        this.busNonce++
        localStorage.setItem(BUS_KEY, JSON.stringify({ code, n: this.busNonce, m: full }))
      }
    } catch { /* storage unavailable */ }
    // 3 — server relay (partitioned iframes + other devices)
    const code = this.routeCode()
    if (code) {
      try {
        void fetch('/api/screenpair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, body: JSON.stringify(full) }),
        }).catch(() => { /* relay down — BC/localStorage still flow */ })
      } catch { /* noop */ }
    }
  }

  private handleIncoming(raw: unknown) {
    const m = raw as WsMsgId | null
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return
    if (m.mid) {
      if (this.seen.has(m.mid)) return
      this.seen.set(m.mid, Date.now())
      if (this.seen.size > 300) {
        for (const k of Array.from(this.seen.keys()).slice(0, 100)) this.seen.delete(k)
      }
    }
    if (this.pairWaiter && (m.t === 'pair_ok' || m.t === 'pair_bad')) this.pairWaiter(m)
    this.onMsg(m)
  }

  private relayPoll = false
  private async relayTick() {
    if (this.relayPoll) return
    const code = this.routeCode()
    if (!code) return
    this.relayPoll = true
    try {
      const since = this.relaySeqByCode.get(code) ?? 0
      const res = await fetch(`/api/screenpair?code=${encodeURIComponent(code)}&since=${since}`, { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as { seq: number; msgs: string[] }
        if (typeof data.seq === 'number' && data.seq > since) this.relaySeqByCode.set(code, data.seq)
        for (const body of data.msgs || []) {
          try {
            this.handleIncoming(JSON.parse(body))
          } catch { /* bad body */ }
        }
      }
    } catch { /* relay down */ } finally {
      this.relayPoll = false
    }
  }

  /** call once in the OS tab (main role) — also restores a persisted code */
  init() {
    if (this.inited) return
    this.inited = true
    this.ensureChannel()
    try {
      window.addEventListener('storage', (e) => {
        if (e.key !== BUS_KEY || !e.newValue) return
        try {
          const entry = JSON.parse(e.newValue) as { code?: string; m?: WsMsgId }
          if (entry.code && entry.code === this.routeCode()) this.handleIncoming(entry.m)
        } catch { /* bad bus payload */ }
      })
    } catch { /* noop */ }
    this.relayTimer = setInterval(() => void this.relayTick(), RELAY_MS)
    /* restore a persisted main-side code — a reload of the PC tab (very easy
       to trigger by pasting the screen link into the SAME tab) must not kill
       the pairing window */
    if (this.status.role === 'main' && !this.status.paired) {
      try {
        const saved = localStorage.getItem(CODE_KEY)
        if (saved && /^\d{6}$/.test(saved)) {
          this.status = { ...this.status, code: saved }
          this.emitStatus()
        }
      } catch { /* noop */ }
    }
    this.ensureWatchdog()
    try {
      ;(window as unknown as { __redsecWs?: WsManager }).__redsecWs = this
    } catch { /* noop */ }
  }

  /** call in the pair tab — flips this tab into the extended-display role and
   *  disables the OS store persist layer (two tabs must not share localStorage) */
  markExt() {
    if (this.status.role === 'ext') return
    this.status = { ...this.status, role: 'ext' }
    this.emitStatus()
    try {
      const memory = {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      }
      ;(useOS as unknown as { persist?: { setOptions: (o: object) => void } }).persist?.setOptions({ storage: memory })
    } catch {
      /* persist API unavailable */
    }
  }

  isExt(): boolean {
    return this.status.role === 'ext'
  }
  isPaired(): boolean {
    return this.status.paired
  }
  /** active (still valid) main-side pairing for Settings restore */
  getActivePairing(): { code: string; link: string } | null {
    if (this.status.role !== 'main' || this.status.paired || !this.status.code) return null
    return { code: this.status.code, link: `${location.origin}/?screen=pair` }
  }

  /* ---------------- main side: pairing ---------------- */
  generatePairing(): { code: string; link: string } {
    this.init()
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    const code = String(buf[0] % 1_000_000).padStart(6, '0')
    this.status = { ...this.status, code, paired: false, pairedAt: 0 }
    this.emitStatus()
    try {
      localStorage.setItem(CODE_KEY, code)
    } catch { /* noop */ }
    this.ensureWatchdog()
    return { code, link: `${location.origin}/?screen=pair` }
  }

  private ensureWatchdog() {
    if (this.watchTimer) return
    this.watchTimer = setInterval(() => {
      /* MAIN-ONLY: the ext role SENDS heartbeats (it never receives them), so
         an ext-side watchdog would self-unpair ~12s after every pairing */
      if (this.status.role !== 'main') return
      if (this.status.paired && Date.now() - this.lastHb > HB_TIMEOUT) {
        /* keep the code alive so Screen 2 can reconnect with the same code */
        this.status = { ...this.status, paired: false, pairedAt: 0 }
        this.emitStatus()
        this.lastHb = 0
        try {
          useOS.getState().notify({ title: 'Screen 2 disconnected', body: 'The extended display tab was closed — Wide Screen paused. The same code still works to reconnect.', kind: 'warn', emoji: '🖥️', app: 'settings' })
        } catch { /* noop */ }
      }
    }, HB_MS)
  }

  /** ext side: ask the main tab to pair with this code. Resolves true on success. */
  requestPair(code: string): Promise<boolean> {
    this.init()
    return new Promise((resolve) => {
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        clearTimeout(timer)
        this.pairWaiter = null
        this.pendingCode = null
        resolve(ok)
      }
      const timer = setTimeout(() => finish(false), PAIR_TIMEOUT)
      this.pendingCode = code
      this.pairWaiter = (m: WsMsgId) => {
        if ((m.t === 'pair_ok' || m.t === 'pair_bad') && m.extId === this.extId) {
          if (m.t === 'pair_ok') {
            this.status = { ...this.status, paired: true, code, pairedAt: Date.now() }
            this.emitStatus()
            try {
              sessionStorage.setItem('redsec-ws-ext', code) // keep the code for auto-reconnect on reload
            } catch { /* noop */ }
            this.startHb()
          }
          finish(m.t === 'pair_ok')
        }
      }
      this.send({ t: 'pair_req', extId: this.extId, code })
      /* retry the request — relay polling may not be aligned with the first shot */
      setTimeout(() => { if (!done) this.send({ t: 'pair_req', extId: this.extId, code }) }, PAIR_TIMEOUT / 2)
    })
  }

  private startHb() {
    this.stopHb()
    this.hbTimer = setInterval(() => {
      this.lastHb = Date.now() /* ext tracks its own liveness too */
      this.send({ t: 'hb', extId: this.extId })
    }, HB_MS)
  }
  private stopHb() {
    if (this.hbTimer) clearInterval(this.hbTimer)
    this.hbTimer = null
  }

  /** unpair from either side */
  unpair(from: 'main' | 'ext') {
    this.send({ t: 'pair_bye', from })
    if (from === 'main') {
      this.status = { role: 'main', paired: false, code: null, pairedAt: 0 }
      this.lastHb = 0
      this.emitStatus()
      try {
        localStorage.removeItem(CODE_KEY)
      } catch { /* noop */ }
    } else {
      this.status = { ...this.status, paired: false, code: null, pairedAt: 0 }
      this.emitStatus()
      try {
        sessionStorage.removeItem('redsec-ws-ext')
      } catch { /* noop */ }
      this.stopHb()
    }
  }

  /* ---------------- window transport ---------------- */
  /** main → ext: render an app on Screen 2. Returns false when not paired. */
  sendOpen(appId: string, title: string, args?: Record<string, unknown>): boolean {
    if (!this.status.paired) return false
    this.send({ t: 'open', key: `ws_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, appId, title, args })
    return true
  }
  /** ext → main: put the window back on the primary desktop */
  sendBack(s: WsScreen) {
    this.send({ t: 'back', key: s.key, appId: s.appId, title: s.title, args: s.args })
    this.removeScreen(s.key)
  }
  /** ext → main: the app was closed on Screen 2 (informational) */
  closeScreen(key: string) {
    this.send({ t: 'closed', key })
    this.removeScreen(key)
  }
  /** main → ext: close a sent window remotely */
  sendClose(key: string) {
    this.send({ t: 'close', key })
  }
  extScreens(): WsScreen[] {
    return this.screens
  }
  private removeScreen(key: string) {
    this.screens = this.screens.filter((s) => s.key !== key)
    this.emitScreens()
  }
  /** ext opens an app card */
  private addScreen(m: Extract<WsMsg, { t: 'open' }>) {
    if (this.screens.some((s) => s.key === m.key)) return
    this.screens = [...this.screens, { key: m.key, appId: m.appId, title: m.title, args: m.args }]
    this.emitScreens()
  }

  /* ---------------- message router ---------------- */
  private onMsg(m: WsMsgId) {
    if (this.status.role === 'main') {
      switch (m.t) {
        case 'pair_req': {
          if (this.status.code && m.code === this.status.code && !this.status.paired) {
            this.status = { ...this.status, paired: true, pairedAt: Date.now() }
            this.emitStatus()
            this.lastHb = Date.now()
            this.send({ t: 'pair_ok', extId: m.extId })
            try {
              useOS.getState().notify({ title: 'Wide Screen active — 2 screens', body: 'Screen 2 is connected. Use the ⭳ button in a window title bar (or drag a window past the right edge) to send it over.', kind: 'success', emoji: '🖥️', app: 'settings' })
            } catch { /* noop */ }
          } else if (this.status.code && m.code === this.status.code) {
            /* already paired with this code — accept as a reconnect of the
               same screen (handles duplicate tabs and flaky heartbeats) */
            this.send({ t: 'pair_ok', extId: m.extId })
          } else {
            this.send({ t: 'pair_bad', extId: m.extId })
          }
          break
        }
        case 'hb':
          this.lastHb = Date.now()
          break
        case 'pair_bye':
          if (this.status.paired) {
            this.status = { ...this.status, paired: false, pairedAt: 0 }
            this.lastHb = 0
            this.emitStatus()
            try {
              useOS.getState().notify({ title: 'Screen 2 disconnected', body: 'Wide Screen ended from the extended display. The same code still works to reconnect.', kind: 'info', emoji: '🖥️', app: 'settings' })
            } catch { /* noop */ }
          }
          break
        case 'back':
          try {
            useOS.getState().openApp(m.appId, m.args, m.title)
          } catch { /* noop */ }
          this.send({ t: 'close', key: m.key })
          break
        case 'closed':
          try {
            useOS.getState().notify({ title: 'Window closed on Screen 2', body: 'The app was closed on the extended display.', kind: 'info', emoji: '🖥️', app: 'settings' })
          } catch { /* noop */ }
          break
        default:
          break
      }
    } else {
      switch (m.t) {
        case 'open':
          this.addScreen(m)
          break
        case 'close':
          this.removeScreen(m.key)
          break
        case 'pair_bye':
          if (this.status.paired) this.unpair('ext')
          break
        default:
          break
      }
    }
  }
}

export const ws = new WsManager()

/* ---------------- react hooks ---------------- */
export function useWsStatus(): WsStatus {
  return useSyncExternalStore(ws.subscribeStatus, ws.getStatusSnapshot, ws.getStatusSnapshot)
}
export function useWsScreens(): WsScreen[] {
  return useSyncExternalStore(ws.subscribeScreens, ws.getScreensSnapshot, ws.getScreensSnapshot)
}

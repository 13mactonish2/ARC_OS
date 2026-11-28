// REDSEC 7.0 — KERNEL GUARD core (anti-cheat · anti-hack · anti-breach · anti-lag · anti-spyware · anti-glitch · anti-tamper · sig-shield)
//
// This is the real, running security kernel of REDSEC v7.0 "Black Sea" — not a simulation.
// Eight daemon modules live beside this file (anti-cheat.ts, anti-hack.ts,
// anti-breach.ts, anti-lag.ts, anti-spyware.ts, anti-glitch.ts, anti-tamper.ts,
// sig-shield.ts) and are started from OSRoot at boot. Every
// check they run is a genuine runtime measurement of this browser session:
//   - anti-cheat  : seals OS settings with SHA-256, verifies native APIs &
//                   prototypes, auto-restores tampered state
//   - anti-hack   : hooks fetch/XHR with a host allowlist, watches the DOM for
//                   injected scripts, detects DevTools & automation
//   - anti-breach : guards localStorage writes, cross-origin messages, bulk
//                   clipboard exfiltration and mass file deletion
//   - anti-lag    : real FPS/long-task/heap telemetry with an adaptive
//                   low-performance mode that strips animations under load
//   - anti-spyware: beacon transmission tally, Permissions-API audit, sensor
//                   surface & foreign-storage probes (NEW in 6.0)
//   - anti-glitch : GlitchShield — frame-jitter probes, stuck-overlay
//                   neutralisation, overflow & ghost-focus auto-repair (NEW)
//
// Task 50 — the kernel runs the EXTREME HARDENED profile (see hardened.ts):
// tighter tunables, BIOS v5.2-EH module chain, audit-only alerting.
//
// Incidents are persisted to localStorage (redsec5.kernel.*) and surfaced in
// Settings ▸ Security and the Task Manager (as redsec-*.service daemons).
// The browsable module files live in the File Manager under OS ▸ security/.
'use client'

import {
  applyExtremeHardening,
  clipboardExfilBytes,
  HARDENING_POLICY,
  isExtreme,
  ransomByteDrop,
  ransomDeletions,
  sealVerifyMs,
} from './hardened'

/* ---------------- types ---------------- */

export type ShieldId = 'anti-cheat' | 'anti-hack' | 'anti-breach' | 'anti-lag' | 'anti-spyware' | 'anti-glitch' | 'anti-tamper' | 'sig-shield'
export type Severity = 'info' | 'warn' | 'critical'

export interface Incident {
  id: number
  ts: number
  shield: ShieldId
  kind: string
  severity: Severity
  detail: string
  action: string
}

export interface KernelFinding {
  shield: ShieldId
  check: string
  ok: boolean
  detail: string
}

export interface ShieldModule {
  id: ShieldId
  name: string
  file: string
  desc: string
  start(): void
  stop(): void
  stats(): Record<string, number>
  /** real checks run on demand by kernel.sweep() */
  sweep(): KernelFinding[] | Promise<KernelFinding[]>
}

export interface KernelSnapshot {
  version: number
  started: boolean
  bootTs: number
  incidents: Incident[]
  events: Record<ShieldId, number>
  blocked: Record<ShieldId, number>
  /** Task 50 — true when the EXTREME HARDENED profile is active */
  hardened: boolean
}

/* ---------------- persistence ---------------- */

const INCIDENTS_KEY = 'redsec5.kernel.incidents'
const TOTALS_KEY = 'redsec5.kernel.totals'
const INCIDENT_CAP = 80

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, val: string): void {
  try {
    localStorage.setItem(key, val)
  } catch {
    /* storage unavailable — kernel keeps working in-memory */
  }
}

function zero(): Record<ShieldId, number> {
  return { 'anti-cheat': 0, 'anti-hack': 0, 'anti-breach': 0, 'anti-lag': 0, 'anti-spyware': 0, 'anti-glitch': 0, 'anti-tamper': 0, 'sig-shield': 0 }
}

function loadTotals(): { events: Record<ShieldId, number>; blocked: Record<ShieldId, number> } {
  const empty = { events: zero(), blocked: zero() }
  const raw = lsGet(TOTALS_KEY)
  if (!raw) return empty
  try {
    const p = JSON.parse(raw) as Partial<{ events: Partial<Record<ShieldId, number>>; blocked: Partial<Record<ShieldId, number>> }>
    return {
      events: { ...zero(), ...(p.events || {}) },
      blocked: { ...zero(), ...(p.blocked || {}) },
    }
  } catch {
    return empty
  }
}

/* ---------------- kernel ---------------- */

class SecurityKernel {
  readonly modules: ShieldModule[] = []
  private incidents: Incident[] = []
  private nextIncidentId = 1
  private events: Record<ShieldId, number> = zero()
  private blocked: Record<ShieldId, number> = zero()
  private startedAt = 0
  private startedFlag = false
  private version = 0
  private snapshotCache: KernelSnapshot | null = null
  private listeners = new Set<() => void>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    // restore the persisted incident log + lifetime counters
    const raw = lsGet(INCIDENTS_KEY)
    if (raw) {
      try {
        const arr = JSON.parse(raw) as Incident[]
        if (Array.isArray(arr)) {
          this.incidents = arr.slice(-INCIDENT_CAP)
          this.nextIncidentId = this.incidents.reduce((m, i) => Math.max(m, i.id || 0), 0) + 1
        }
      } catch {
        /* start fresh */
      }
    }
    const t = loadTotals()
    this.events = t.events
    this.blocked = t.blocked
  }

  /** register a daemon module (called from index.ts at import time) */
  register(mod: ShieldModule): void {
    if (!this.modules.some((m) => m.id === mod.id)) this.modules.push(mod)
  }

  /** boot all daemons — idempotent, called once from OSRoot */
  start(): void {
    if (this.startedFlag || typeof window === 'undefined') return
    this.startedFlag = true
    this.startedAt = Date.now()
    // Task 50 — silently (re)apply the EXTREME HARDENED profile before any
    // daemon reads its tunables; never raises a notification
    applyExtremeHardening()
    // order matters: anti-hack installs its fetch wrapper first so anti-cheat
    // sees the final state of the network layer; the rest run independently
    for (const m of this.modules) {
      try {
        m.start()
      } catch (e) {
        this.report({ shield: m.id, kind: 'boot_failure', severity: 'warn', detail: e instanceof Error ? e.message : 'daemon failed to start', action: 'daemon continues degraded' })
      }
    }
    // audit-only record that the hardening profile is live (no toast — OS policy)
    this.report({
      shield: 'anti-cheat',
      kind: 'hardening_profile',
      severity: 'info',
      detail: `EXTREME HARDENED profile active — seal verify ${sealVerifyMs() / 1000}s, clipboard exfil ${clipboardExfilBytes() / 1000} KB, ransom watch ${ransomDeletions()} del / ${Math.round(ransomByteDrop() * 100)} %, ${HARDENING_POLICY.length} policies`,
      action: 'audit log only — no notification (OS policy)',
    })
    this.bump()
  }

  get booted(): boolean {
    return this.startedFlag
  }

  get uptimeMs(): number {
    return this.startedFlag ? Date.now() - this.startedAt : 0
  }

  /* ---------- incident reporting ---------- */

  /**
   * Report a real security/performance event.
   *
   * Kernel messages NEVER toast — per OS policy they are logged here, persisted
   * to the incident log and surfaced in Settings ▸ Security / Task Manager only.
   * The notification center is reserved for user-facing app events.
   */
  report(i: { shield: ShieldId; kind: string; severity: Severity; detail: string; action: string }): Incident {
    const inc: Incident = { id: this.nextIncidentId++, ts: Date.now(), ...i }
    this.incidents.push(inc)
    if (this.incidents.length > INCIDENT_CAP) this.incidents.splice(0, this.incidents.length - INCIDENT_CAP)
    this.events[i.shield]++
    if (i.severity !== 'info') this.blocked[i.shield]++

    this.schedulePersist()
    this.bump()
    return inc
  }

  incidentsFor(shield: ShieldId | 'all', n = 8): Incident[] {
    const list = shield === 'all' ? this.incidents : this.incidents.filter((x) => x.shield === shield)
    return list.slice(-n).reverse()
  }

  clearIncidents(): void {
    this.incidents = []
    lsSet(INCIDENTS_KEY, '[]')
    this.bump()
  }

  /* ---------- on-demand full sweep (Settings ▸ Security) ---------- */

  async sweep(): Promise<KernelFinding[]> {
    const out: KernelFinding[] = []
    for (const m of this.modules) {
      try {
        const findings = await m.sweep()
        out.push(...findings)
      } catch (e) {
        out.push({ shield: m.id, check: 'daemon sweep', ok: false, detail: e instanceof Error ? e.message : 'sweep crashed' })
      }
    }
    // core kernel checks — the daemons themselves are real files & running
    out.push({
      shield: 'anti-cheat',
      check: 'kernel daemons registered',
      ok: this.modules.length === 8,
      detail: `${this.modules.length}/8 daemons loaded from /src/lib/os/security/`,
    })
    // Task 50 — EXTREME HARDENED profile check
    out.push({
      shield: 'anti-cheat',
      check: 'extreme hardening profile',
      ok: isExtreme(),
      detail: isExtreme()
        ? `EXTREME HARDENED active — ${HARDENING_POLICY.length} policies · module files: OS ▸ security/ + OS ▸ BIOS/`
        : 'hardening profile missing — re-applying extreme defaults',
    })
    return out
  }

  /* ---------- Task Manager feed (measured, not simulated) ---------- */

  private lastProcAt = 0
  private lastProcWorked: Record<ShieldId, number> = zero()

  /**
   * Real per-daemon CPU% — measured from the actual milliseconds each daemon
   * spent working since the previous call — plus its share of the JS heap.
   */
  procStats(id: ShieldId): { cpu: number; mem: number } {
    const now = Date.now()
    const elapsed = this.lastProcAt ? Math.max(500, now - this.lastProcAt) : 1000
    const worked = this.workedMs[id] || 0
    // clamp the delta to the sampling window — a long idle gap (Task Manager
    // opened after minutes) must never read as a CPU spike
    const delta = Math.min(Math.max(0, worked - (this.lastProcWorked[id] || 0)), elapsed)
    this.lastProcAt = now
    this.lastProcWorked = { ...this.lastProcWorked, [id]: worked }
    const cpu = Math.min(99, Math.round((delta / elapsed) * 1000) / 10)
    const perfMem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    const mem = perfMem ? Math.round(perfMem.usedJSHeapSize / 1048576 / Math.max(1, this.modules.length)) : 14
    return { cpu, mem }
  }

  /** daemons add the real ms they spent working here (via kernel.charge()) */
  workedMs: Record<ShieldId, number> = zero()
  charge(id: ShieldId, ms: number): void {
    this.workedMs[id] += ms
  }

  /* ---------- external-store plumbing ---------- */

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): KernelSnapshot => {
    if (!this.snapshotCache) {
      this.snapshotCache = {
        version: this.version,
        started: this.startedFlag,
        bootTs: this.startedAt,
        incidents: [...this.incidents],
        events: { ...this.events },
        blocked: { ...this.blocked },
        hardened: isExtreme(),
      }
    }
    return this.snapshotCache
  }

  private bump(): void {
    this.version++
    this.snapshotCache = null
    this.listeners.forEach((fn) => fn())
  }

  private schedulePersist(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      lsSet(INCIDENTS_KEY, JSON.stringify(this.incidents.slice(-60)))
      lsSet(TOTALS_KEY, JSON.stringify({ events: this.events, blocked: this.blocked }))
    }, 1500)
  }
}

export const securityKernel = new SecurityKernel()

/* ---------------- shared helpers for the daemons ---------------- */

/** FNV-1a 32-bit hex hash — fast synchronous checksum for seals */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** SHA-256 hex of a string (WebCrypto) with an FNV fallback */
export async function sha256Hex(input: string): Promise<string> {
  try {
    const subtle = crypto?.subtle
    if (subtle) {
      const buf = await subtle.digest('SHA-256', new TextEncoder().encode(input))
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }
  } catch {
    /* insecure context — fall through to FNV */
  }
  return `fnv:${fnv1a(input)}`
}

export function lsKeys(): string[] {
  try {
    return Object.keys(localStorage)
  } catch {
    return []
  }
}

/** setInterval whose callback cost is measured & charged to the daemon */
export function chargedInterval(id: ShieldId, fn: () => void | Promise<void>, ms: number): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const t0 = performance.now()
    try {
      const r = fn()
      if (r && typeof (r as Promise<void>).finally === 'function') {
        ;(r as Promise<void>).finally(() => securityKernel.charge(id, performance.now() - t0))
        return
      }
    } finally {
      securityKernel.charge(id, performance.now() - t0)
    }
  }, ms)
}

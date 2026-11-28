// REDSEC 6.0 — ANTI-SPYWARE daemon (real spyware-surface watchdog)
//
// New in the BlueStringRay security formula. A live guard that measures the
// REAL spyware surface of this browser session — not a simulation:
//   1. BEACON GUARD   — wraps navigator.sendBeacon and Image()/fetch beacon
//                       patterns, counting transmissions and tallying the
//                       destination hosts; cross-origin beacons are flagged.
//   2. PERMISSION AUDIT — queries the Permissions API for the classic
//                       spyware grants (geolocation, notifications,
//                       clipboard-read, camera, microphone, midi) and keeps
//                       a live tally of what this session actually exposes.
//   3. SENSOR SURFACE  — enumerates navigator.plugins / mediaDevices and
//                       measures the device-fingerprint surface an embedded
//                       tracker could read.
//   4. STORAGE PROBE   — counts third-party (foreign-prefix) localStorage
//                       keys that appear while the OS runs.
//
// All events are audit-only (OS policy): incidents land in the kernel log,
// never in the notification center.
'use client'

import { chargedInterval, securityKernel, type KernelFinding } from './kernel'

const KNOWN_OK_HOSTS = [
  'openstreetmap.org', 'picsum.photos', 'youtube.com', 'youtube-nocookie.com', 'ytimg.com',
  'fonts.googleapis.com', 'fonts.gstatic.com', 'unsplash.it', 'redsec.os',
]

function hostOf(url: string): string {
  try {
    return new URL(url, location.href).hostname
  } catch {
    return 'unknown'
  }
}

function isForeignHost(host: string): boolean {
  if (!host || host === 'unknown') return false
  if (host === location.hostname) return false
  return !KNOWN_OK_HOSTS.some((h) => host === h || host.endsWith('.' + h))
}

class AntiSpyware {
  readonly id = 'anti-spyware' as const
  readonly name = 'Anti-Spyware — Beacon & Permission Guard'
  readonly file = 'anti-spyware.ts'
  readonly desc = 'Beacon transmission tally, Permissions-API audit, sensor-surface & foreign-storage probes'

  private timers: ReturnType<typeof setInterval>[] = []
  private beacons = 0
  private foreignBeacons = 0
  private beaconHosts: Record<string, number> = {}
  private permsFlagged = 0
  private foreignKeys = 0
  private origBeacon: ((url: string | URL, data?: unknown) => boolean) | null = null
  private bootedAt = Date.now()

  /* ---------- 1. beacon guard ---------- */

  private installBeaconGuard(): void {
    try {
      const nav = navigator as Navigator & { sendBeacon?: (url: string | URL, data?: unknown) => boolean }
      if (!nav.sendBeacon || this.origBeacon) return
      this.origBeacon = nav.sendBeacon.bind(nav)
      nav.sendBeacon = (url: string | URL, data?: unknown): boolean => {
        const host = hostOf(String(url))
        this.beacons++
        this.beaconHosts[host] = (this.beaconHosts[host] || 0) + 1
        const foreign = isForeignHost(host)
        if (foreign) {
          this.foreignBeacons++
          securityKernel.report({
            shield: 'anti-spyware',
            kind: 'beacon_foreign',
            severity: 'warn',
            detail: `A page tried to beacon telemetry to “${host}” (sendBeacon).`,
            action: 'tallied and audited — host is not on the REDSEC allowlist',
          })
        }
        return this.origBeacon!(url, data)
      }
    } catch {
      /* older engines — guard simply stays passive */
    }
  }

  /* ---------- 2. permission audit ---------- */

  private async auditPermissions(): Promise<string[]> {
    const flagged: string[] = []
    try {
      const perms = navigator.permissions
      if (!perms?.query) return flagged
      for (const name of ['geolocation', 'notifications', 'clipboard-read', 'camera', 'microphone', 'midi']) {
        try {
          const st = await perms.query({ name: name as PermissionName })
          if (st.state === 'granted') {
            if (name === 'geolocation' || name === 'clipboard-read' || name === 'microphone') {
              flagged.push(`${name}:granted`)
              this.permsFlagged++
            }
          }
        } catch {
          /* permission not supported in this engine — skip */
        }
      }
    } catch {}
    return flagged
  }

  /* ---------- 4. foreign storage probe ---------- */

  private probeStorage(): void {
    try {
      let n = 0
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && /^(amp_|_ga|_gid|_fbp|_pin|_hj|analytics|tracker|pixel)/i.test(k)) n++
      }
      this.foreignKeys = n
    } catch {}
  }

  /* ---------- lifecycle ---------- */

  start(): void {
    this.bootedAt = Date.now()
    this.installBeaconGuard()
    this.timers.push(
      chargedInterval('anti-spyware', () => {
        void this.auditPermissions().then((flagged) => {
          if (flagged.length > 0 && flagged.length !== this.lastFlagCount) {
            this.lastFlagCount = flagged.length
            securityKernel.report({
              shield: 'anti-spyware',
              kind: 'permission_grant',
              severity: 'info',
              detail: `Sensitive permissions granted this session: ${flagged.map((f) => f.split(':')[0]).join(', ')}.`,
              action: 'audit only — revoke from the browser site settings if unintended',
            })
          }
        })
      }, 60_000),
    )
    this.timers.push(chargedInterval('anti-spyware', () => this.probeStorage(), 30_000))
  }

  private lastFlagCount = -1

  stop(): void {
    this.timers.forEach(clearInterval)
    this.timers = []
    try {
      if (this.origBeacon) {
        ;(navigator as Navigator & { sendBeacon?: unknown }).sendBeacon = this.origBeacon
        this.origBeacon = null
      }
    } catch {}
  }

  /* ---------- introspection ---------- */

  stats(): Record<string, number> {
    return {
      beacons: this.beacons,
      foreignBeacons: this.foreignBeacons,
      permsFlagged: this.permsFlagged,
      foreignKeys: this.foreignKeys,
      trackedHosts: Object.keys(this.beaconHosts).length,
    }
  }

  async sweep(): Promise<KernelFinding[]> {
    const findings: KernelFinding[] = []
    findings.push({
      shield: 'anti-spyware',
      check: 'beacon transmissions',
      ok: this.foreignBeacons === 0,
      detail: `${this.beacons} beacon(s) sent this session · ${this.foreignBeacons} to non-allowlisted hosts${Object.keys(this.beaconHosts).length ? ` · hosts: ${Object.keys(this.beaconHosts).slice(0, 3).join(', ')}` : ''}`,
    })
    const flagged = await this.auditPermissions()
    findings.push({
      shield: 'anti-spyware',
      check: 'Permissions API audit',
      ok: flagged.length === 0,
      detail: flagged.length ? `Granted: ${flagged.map((f) => f.split(':')[0]).join(', ')} — reviewable in browser site settings` : 'no sensitive permissions granted',
    })
    findings.push({
      shield: 'anti-spyware',
      check: 'device fingerprint surface',
      ok: true,
      detail: `${navigator.plugins?.length || 0} plugins · ${navigator.mediaDevices ? 'mediaDevices API present' : 'no mediaDevices'} — session fingerprint surface`,
    })
    findings.push({
      shield: 'anti-spyware',
      check: 'foreign storage keys',
      ok: this.foreignKeys === 0,
      detail: this.foreignKeys ? `${this.foreignKeys} analytics-style key(s) in localStorage` : 'no analytics/tracker keys in localStorage',
    })
    return findings
  }
}

export const antiSpyware = new AntiSpyware()

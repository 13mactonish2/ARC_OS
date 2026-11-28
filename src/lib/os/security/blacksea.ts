// REDSEC v7.0 "Black Sea" — device ban + browser compatibility engine (client side)
//
// This is the real enforcement bridge between the OS shell and the server-side
// ban registry (Prisma: BannedDevice / SecurityIncident / TrustedBrowser).
//
//   • deviceId()      — stable hardware fingerprint (canvas + UA + screen + cores +
//                       memory + timezone), cached in localStorage. The SAME id is
//                       produced in every browser on the same device, so a ban
//                       follows the DEVICE, not the session.
//   • handshake()     — called on every boot: registers the device, checks the
//                       permanent ban registry and the trusted-browser allowlist.
//   • reportBreach()  — tamper / breach events are logged server-side; breach-level
//                       events create a FOREVER ban which every device sees in
//                       realtime through pollStatus().
//   • pollStatus()    — realtime watchdog (OSRoot polls every 20 s while running).
//
// The OS also listens for the `redsec-breach` CustomEvent: any surface (File
// Manager, lock screen, kernel daemons) can fire it to trigger the ban flow.

import { K } from '@/lib/os/keys'

export const BREACH_EVENT = 'redsec-breach'

export interface BanInfo {
  banId: string
  reason: string
  detail: string
  bannedAt: string
  attempts: number
}

export interface HandshakeResult {
  deviceId: string
  banned: BanInfo | null
  browserAllowed: boolean
  trusted: string[]
  browser: string
}

export interface IncidentRow {
  id: string
  kind: string
  detail: string
  browser: string
  at: string
}

/** breach kinds that trigger a FOREVER device ban (everything else just logs) */
export const BREACH_LEVEL = new Set(['os_password_breach', 'os_file_tamper', 'kernel_breach'])

/* ------------------------------------------------------------------ */
/* device fingerprint                                                  */
/* ------------------------------------------------------------------ */

function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function canvasSig(): string {
  try {
    const c = document.createElement('canvas')
    c.width = 220
    c.height = 40
    const g = c.getContext('2d')
    if (!g) return 'nocanvas'
    g.textBaseline = 'top'
    g.font = "16px 'Arial'"
    g.fillStyle = '#f60'
    g.fillRect(0, 0, 100, 20)
    g.fillStyle = '#0af'
    g.fillText('REDSEC Black Sea \u{1F41B}', 4, 6)
    g.strokeStyle = 'rgba(0,180,60,0.7)'
    g.arc(180, 20, 14, 0, Math.PI * 1.5)
    g.stroke()
    return c.toDataURL().slice(-64)
  } catch {
    return 'nocanvas'
  }
}

let cachedDeviceId: string | null = null

/** Stable per-DEVICE fingerprint — same value in every browser on this machine. */
export function deviceId(): string {
  if (cachedDeviceId) return cachedDeviceId
  let id = ''
  try {
    id = localStorage.getItem(K.deviceId) || ''
  } catch {
    /* storage unavailable — recompute every time */
  }
  if (!id) {
    const raw = [
      typeof navigator !== 'undefined' ? navigator.userAgent : '',
      typeof screen !== 'undefined' ? `${screen.width}x${screen.height}x${screen.colorDepth}` : '',
      typeof navigator !== 'undefined' ? String(navigator.hardwareConcurrency || 0) : '',
      typeof navigator !== 'undefined' ? String((navigator as { deviceMemory?: number }).deviceMemory || 0) : '',
      typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone || '' : '',
      canvasSig(),
      'redsec-black-sea-v7',
    ].join('|')
    id = `BS-${fnv1a(raw)}-${fnv1a(raw.split('').reverse().join(''))}`
    try {
      localStorage.setItem(K.deviceId, id)
    } catch {
      /* ignore */
    }
  }
  cachedDeviceId = id
  return id
}

/* ------------------------------------------------------------------ */
/* browser brand (for the compatibility gate)                          */
/* ------------------------------------------------------------------ */

export function browserBrand(): string {
  if (typeof navigator === 'undefined') return 'Unknown browser'
  const ua = navigator.userAgent
  const table: Array<[RegExp, string]> = [
    [/Edg(?:e|A|iOS)?\/[\d.]+/, 'Microsoft Edge'],
    [/OPR\/[\d.]+/, 'Opera'],
    [/SamsungBrowser\/[\d.]+/, 'Samsung Internet'],
    [/Firefox\/[\d.]+/, 'Mozilla Firefox'],
    [/CriOS\/[\d.]+/, 'Chrome'],
    [/Chrome\/[\d.]+/, 'Google Chrome'],
    [/Version\/[\d.]+.*Safari/, 'Safari'],
    [/Safari\/[\d.]+/, 'Safari'],
  ]
  for (const [re, name] of table) {
    if (re.test(ua)) return name
  }
  return 'Unknown browser'
}

/* ------------------------------------------------------------------ */
/* server bridge                                                       */
/* ------------------------------------------------------------------ */

export async function handshake(): Promise<HandshakeResult> {
  const id = deviceId()
  const brand = browserBrand()
  const base: HandshakeResult = {
    deviceId: id,
    banned: null,
    browserAllowed: true,
    trusted: [],
    browser: brand,
  }
  try {
    const res = await fetch('/api/os/security/handshake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: id,
        browser: brand,
        ua: navigator.userAgent,
        screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : '',
        osName: navigator.platform || '',
      }),
    })
    const d = (await res.json()) as Partial<HandshakeResult>
    return {
      deviceId: id,
      banned: d.banned ?? null,
      browserAllowed: d.browserAllowed !== false,
      trusted: Array.isArray(d.trusted) ? d.trusted : [],
      browser: brand,
    }
  } catch {
    /* server unreachable — fail OPEN (the OS still boots; the registry re-checks on the next poll) */
    return base
  }
}

export async function reportBreach(kind: string, detail: string): Promise<{ banned: boolean; ban: BanInfo | null }> {
  try {
    const res = await fetch('/api/os/security/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: deviceId(),
        kind,
        detail,
        browser: browserBrand(),
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      }),
    })
    const d = (await res.json()) as { banned?: boolean; ban?: BanInfo | null }
    return { banned: !!d.banned, ban: d.ban ?? null }
  } catch {
    return { banned: false, ban: null }
  }
}

export async function pollStatus(): Promise<{ banned: boolean; ban: BanInfo | null; incidents: IncidentRow[] }> {
  try {
    const res = await fetch(`/api/os/security/status?deviceId=${encodeURIComponent(deviceId())}`, { cache: 'no-store' })
    const d = (await res.json()) as { banned?: boolean; ban?: BanInfo | null; incidents?: IncidentRow[] }
    return { banned: !!d.banned, ban: d.ban ?? null, incidents: Array.isArray(d.incidents) ? d.incidents : [] }
  } catch {
    return { banned: false, ban: null, incidents: [] }
  }
}

export async function revokeBan(passphrase: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/os/security/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId(), passphrase }),
    })
    const d = (await res.json()) as { ok?: boolean; error?: string }
    return { ok: !!d.ok, error: d.error }
  } catch {
    return { ok: false, error: 'security service unreachable' }
  }
}

export async function trustCurrentBrowser(): Promise<{ ok: boolean; trusted?: string[]; error?: string }> {
  try {
    const res = await fetch('/api/os/security/handshake', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId(), browser: browserBrand() }),
    })
    const d = (await res.json()) as { ok?: boolean; trusted?: string[]; error?: string }
    return { ok: !!d.ok, trusted: d.trusted, error: d.error }
  } catch {
    return { ok: false, error: 'security service unreachable' }
  }
}

/* ------------------------------------------------------------------ */
/* breach event bus — any surface can fire a breach                    */
/* ------------------------------------------------------------------ */

/** fire-and-forget breach dispatch; OSRoot listens and runs the ban flow */
export function dispatchBreach(kind: string, detail: string): void {
  try {
    window.dispatchEvent(new CustomEvent(BREACH_EVENT, { detail: { kind, detail } }))
  } catch {
    /* ignore */
  }
}

/** realtime watchdog handle */
export function startBanWatchdog(onBan: (ban: BanInfo) => void, intervalMs = 20_000): () => void {
  let stopped = false
  const tick = async (): Promise<void> => {
    if (stopped) return
    const st = await pollStatus()
    if (st.banned && st.ban) onBan(st.ban)
  }
  const iv = window.setInterval(tick, intervalMs)
  void tick()
  return () => {
    stopped = true
    window.clearInterval(iv)
  }
}

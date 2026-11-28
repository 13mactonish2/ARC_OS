// REDSEC 5.0 — Task 18: Owner tracking + fleet update (client side).
//
// The OS is distributed to many devices. The OWNER is whoever set the OS up
// first (the very first username that ever calls ensureOwner claims the role).
// Every device boots → trackDevice() registers its username + browser/device
// fingerprint with the fleet API. The owner opens the Owner Console (PC app)
// or the mobile console (/?owner=<token>) to watch the fleet and push
// system updates; every running device shows the FleetUpdateToast.
//
// EXPORTS (for the main agent to wire):
//   OWNER_KEY            — localStorage key holding { username, token }
//   getLocalOwner()      — read the local owner record (null when absent)
//   isOwner()            — true when this device holds a real owner token
//   ensureOwner(username)— claim/refresh the owner role (async, caches locally)
//   trackDevice(username)— fire-and-forget boot registration (once per boot)
//   parseUA(ua, nav?)    — { browser, osName, device } from a user agent
//   ownerUrl(token)      — `${origin}/?owner=${token}` deep link
//   FLEET_BUILD_KEY      — localStorage key with the last seen fleet build
export const OWNER_KEY = 'redsec5.owner.v1'
export const FLEET_BUILD_KEY = 'redsec5.fleet.lastBuild'

export interface LocalOwner {
  username: string
  token: string // '' → this device is NOT the owner
}

export function getLocalOwner(): LocalOwner | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(OWNER_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as LocalOwner
    if (!o || typeof o.username !== 'string') return null
    return { username: o.username, token: typeof o.token === 'string' ? o.token : '' }
  } catch {
    return null
  }
}

export function isOwner(): boolean {
  const o = getLocalOwner()
  return !!o && o.token.startsWith('r5own-')
}

export function ownerUrl(token: string): string {
  return `${typeof location !== 'undefined' ? location.origin : ''}/?owner=${token}`
}

/* ---------------- Task 56 — Developer Options fleet grant ---------------- */

export const DEV_KEY = 'redsec5.owner.dev.v1'

/** Cached developer fleet grant for this device ({ username, token } | null). */
export function getLocalDevGrant(): LocalOwner | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(DEV_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as LocalOwner
    if (!o || typeof o.token !== 'string' || !o.token.startsWith('r5dev-')) return null
    return { username: typeof o.username === 'string' ? o.username : '', token: o.token }
  } catch {
    return null
  }
}

/**
 * Ask the server for the scoped Developer Options fleet token (r5dev-…).
 * `code`/`sig` come from the QR + 6-digit handshake payload so the server log
 * records a real grant; the token opens the SAME Owner Console as the owner
 * token (fleet view + push) while Developer Options stays ON.
 */
export async function ensureDevGrant(username: string, code: string, sig: string): Promise<LocalOwner | null> {
  const cached = getLocalDevGrant()
  if (cached && cached.username === username) return cached
  try {
    const r = await fetch('/api/owner/devgrant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, code, sig }),
    })
    if (!r.ok) return cached
    const j = (await r.json()) as { ok?: boolean; token?: string }
    if (!j.ok || !j.token) return cached
    const rec: LocalOwner = { username, token: j.token }
    localStorage.setItem(DEV_KEY, JSON.stringify(rec))
    return rec
  } catch {
    return cached
  }
}

/** Forget the developer grant (called when Developer Options turn OFF). */
export function clearDevGrant(): void {
  try {
    localStorage.removeItem(DEV_KEY)
  } catch {
    /* storage unavailable */
  }
}

const DEV_HANDSHAKE_KEY = 'redsec5.owner.dev.handshake.v1'

export interface DevHandshake {
  username: string
  code: string
  sig: string
}

/** Persist the verified handshake so a later session can re-ensure the grant. */
export function saveDevHandshake(h: DevHandshake): void {
  try {
    localStorage.setItem(DEV_HANDSHAKE_KEY, JSON.stringify(h))
  } catch {
    /* storage unavailable */
  }
}

export function getDevHandshake(username: string): DevHandshake | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(DEV_HANDSHAKE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as DevHandshake
    if (!o || typeof o.code !== 'string' || o.code.length !== 6 || typeof o.sig !== 'string') return null
    return { username: typeof o.username === 'string' && o.username ? o.username : username, code: o.code, sig: o.sig }
  } catch {
    return null
  }
}

/**
 * One-stop helper for the console surfaces: with Developer Options ON, make
 * sure this device holds the scoped fleet grant (cached → re-ensure from the
 * stored handshake → null when nothing is available). Null = show the
 * device-required screen even in dev mode (no handshake ever verified here).
 */
export async function resolveDevFleetToken(username: string): Promise<string | null> {
  const cached = getLocalDevGrant()
  if (cached && cached.token) return cached.token
  const hs = getDevHandshake(username)
  if (!hs) return null
  const rec = await ensureDevGrant(hs.username || username, hs.code, hs.sig)
  return rec?.token || null
}

/**
 * Claim the owner role for `username`.
 * - First username ever seen by the server becomes the owner and gets a token.
 * - Any other username gets token '' (non-owner) and stays that way.
 * The result is cached in localStorage so later boots don't re-ask — BUT a
 * cached NON-owner record (token '') is retried on every boot: if the fleet
 * DB was ever reset, the very first real setup must be able to reclaim the
 * owner role without the user clearing their browser storage.
 */
export async function ensureOwner(username: string): Promise<LocalOwner> {
  const cached = getLocalOwner()
  // cached owner record with a real token for the same username — nothing to do
  if (cached && cached.username === username && cached.token) {
    return cached
  }
  try {
    const r = await fetch('/api/owner/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    })
    const j = (await r.json()) as { owner?: boolean; token?: string }
    const rec: LocalOwner = j.owner && j.token ? { username, token: j.token } : { username, token: '' }
    localStorage.setItem(OWNER_KEY, JSON.stringify(rec))
    return rec
  } catch {
    // network down — fall back to a non-owner record so callers don't crash
    const rec: LocalOwner = { username, token: '' }
    if (!cached) localStorage.setItem(OWNER_KEY, JSON.stringify(rec))
    return cached || rec
  }
}

/* ---------------- user-agent / device parsing ---------------- */

export interface DeviceInfo {
  browser: string
  osName: string
  device: 'Desktop' | 'Mobile' | 'Tablet'
}

/** Parse a UA string into display strings (client-side, no network needed). */
export function parseUA(ua: string, maxTouchPoints = 0): DeviceInfo {
  const u = ua || ''
  const pick = (re: RegExp, fallback: string): string => {
    const m = u.match(re)
    return m ? `${m[1]} ${m[2]}` : fallback
  }

  // Browser — order matters (Edge/Opera/Chrome all contain "Chrome/")
  let browser = 'Unknown browser'
  if (/Edg(?:e|A|iOS)?\//.test(u)) browser = pick(/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge')
  else if (/OPR\/|Opera/.test(u)) browser = pick(/(?:OPR|Opera)[/ ]([\d.]+)/, 'Opera')
  else if (/SamsungBrowser\//.test(u)) browser = pick(/SamsungBrowser\/([\d.]+)/, 'Samsung Internet')
  else if (/Firefox\/|FxiOS/.test(u)) browser = /FxiOS/.test(u) ? 'Firefox iOS' : pick(/Firefox\/([\d.]+)/, 'Firefox')
  else if (/Chrome\/|CriOS/.test(u)) browser = /CriOS/.test(u) ? 'Chrome iOS' : pick(/Chrome\/([\d.]+)/, 'Chrome')
  else if (/Safari\//.test(u)) {
    const v = u.match(/Version\/([\d.]+)/)
    browser = v ? `Safari ${v[1]}` : 'Safari'
  }
  // trim long versions to major.minor for tidy chips
  browser = browser.replace(/(\d+\.\d+)(\.\d+)+/, '$1')

  // OS
  let osName = 'Unknown OS'
  if (/Windows NT/.test(u)) {
    const v = u.match(/Windows NT ([\d.]+)/)
    const map: Record<string, string> = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' }
    osName = `Windows ${v ? map[v[1]] || v[1] : ''}`.trim()
  } else if (/iPhone/.test(u)) osName = 'iOS (iPhone)'
  else if (/iPad/.test(u)) osName = 'iPadOS'
  else if (/Android/.test(u)) {
    const v = u.match(/Android ([\d.]+)/)
    osName = `Android ${v ? v[1].split('.').slice(0, 2).join('.') : ''}`.trim()
  } else if (/Mac OS X/.test(u)) {
    const v = u.match(/Mac OS X ([\d_.]+)/)
    osName = `macOS ${v ? v[1].replace(/_/g, '.').split('.').slice(0, 2).join('.') : ''}`.trim()
  } else if (/CrOS/.test(u)) osName = 'ChromeOS'
  else if (/Linux/.test(u)) osName = 'Linux'

  // Device class
  let device: DeviceInfo['device'] = 'Desktop'
  const touch = maxTouchPoints || 0
  if (/iPhone|iPod/.test(u)) device = 'Mobile'
  else if (/iPad/.test(u)) device = 'Tablet'
  else if (/Android/.test(u)) device = /Mobile/.test(u) ? 'Mobile' : 'Tablet'
  else if (/Mobile|Windows Phone/.test(u)) device = 'Mobile'
  else if (touch > 1 && /Macintosh/.test(u)) device = 'Tablet' // iPadOS 13+ masquerades as Mac

  return { browser, osName, device }
}

/** collect full device fingerprint info for tracking */
export function collectDeviceInfo(): {
  ua: string
  languages: string
  screen: string
  hardwareConcurrency: number
  deviceMemory: number
  touch: number
} & DeviceInfo {
  const nav = typeof navigator !== 'undefined' ? navigator : ({} as Navigator)
  const ua = nav.userAgent || ''
  const info = parseUA(ua, nav.maxTouchPoints || 0)
  const w = typeof screen !== 'undefined' ? screen : ({ width: 0, height: 0 } as Screen)
  return {
    ua,
    languages: (nav.languages || [nav.language || 'en']).join(','),
    screen: `${w.width}x${w.height}@${typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1}`,
    hardwareConcurrency: nav.hardwareConcurrency || 0,
    deviceMemory: (nav as Navigator & { deviceMemory?: number }).deviceMemory || 0,
    touch: nav.maxTouchPoints || 0,
    ...info,
  }
}

/* ---------------- boot tracking (fire-and-forget) ---------------- */

/**
 * Register this device+username with the fleet API.
 * Called ONCE per desktop boot — no polling interval needed; the DeviceSession
 * row is upserted by @@unique([username, browser, device]) with pings+1.
 */
export function trackDevice(username: string): void {
  if (!username || typeof window === 'undefined') return
  try {
    const d = collectDeviceInfo()
    void fetch('/api/owner/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        browser: d.browser,
        osName: d.osName,
        device: d.device,
        screen: d.screen,
      }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* never block boot */
  }
}

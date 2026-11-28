// REDSEC 6.0 — Real device specs detection (Task 18: "new specs depend on the
// user hardware — monitor the specs of which user is using the desktop, mobile
// or any other device"). Everything here reads the REAL host browser/device:
// UA-CH high-entropy hints with a careful UA-string fallback, cores, memory,
// display, network, battery, GPU and input capabilities.
//
// 6.0 — HARDWARE SUPPORT MATRIX: what the BlueStringRay kernel's driver stack
// supports out of the box, surfaced in Settings ▸ System specs.

export interface HardwareSupport {
  bus: string
  standard: string
  speed: string
  status: 'supported' | 'probing' | 'optional'
  note: string
}

/** REDSEC 6.0 out-of-the-box hardware support matrix */
export const HARDWARE_SUPPORT: HardwareSupport[] = [
  { bus: 'Wireless', standard: 'Wi-Fi 7 (802.11be)', speed: '46 Gb/s', status: 'supported', note: 'redsec-net.ko — MLO dual-band ready' },
  { bus: 'Wireless', standard: 'Bluetooth 6.0', speed: '3 Mb/s LE', status: 'supported', note: 'redsec-bt — channel sounding aware' },
  { bus: 'Wired', standard: 'Ethernet 2.5G', speed: '2.5 Gb/s', status: 'supported', note: 'auto-negotiation, WoL' },
  { bus: 'Expansion', standard: 'USB4 Version 2', speed: '80 Gb/s', status: 'supported', note: 'USB-C hub + DP-alt mode' },
  { bus: 'Expansion', standard: 'Thunderbolt 4', speed: '40 Gb/s', status: 'supported', note: 'security level: none (user-controlled)' },
  { bus: 'Storage', standard: 'NVMe 2.0', speed: 'PCIe 5.0 x4', status: 'supported', note: 'TRIM + ZNS zone stats' },
  { bus: 'Storage', standard: 'SD Express / eSIM', speed: '—', status: 'optional', note: 'eSIM profiles via Network Manager' },
  { bus: 'Display', standard: 'VRR + HDR (HDR10/HLG)', speed: 'up to 240 Hz', status: 'supported', note: 'BlueStringWM compositor' },
  { bus: 'Graphics', standard: 'WebGPU / Vulkan compute', speed: '—', status: 'probing', note: 'vxr-graphics — probe runs on this device below' },
  { bus: 'Media', standard: 'AV1 decode / encode', speed: '8K60', status: 'supported', note: 'hardware blocks when present' },
  { bus: 'Audio', standard: 'LE Audio / LC3', speed: '—', status: 'supported', note: 'redsec sound server' },
  { bus: 'Power', standard: 'USB-PD 3.1 EPR', speed: '240 W', status: 'supported', note: 'thermal + battery profiler' },
]

export interface DeviceSpecs {
  /** 'Desktop' | 'Mobile' | 'Tablet' | 'Unknown' */
  deviceType: string
  browser: string
  browserVersion: string
  osName: string
  osVersion: string
  platform: string
  cpuCores: number
  ramGb: number | null
  screen: string // e.g. 1920×1080
  viewport: string
  pixelRatio: number
  colorDepth: number
  touchPoints: number
  inputKind: string // Touch / Mouse / Hybrid
  gpu: string
  network: string // 4g · 10 Mb/s · rtt 50ms
  online: boolean
  battery: string | null
  languages: string
  timezone: string
  ua: string
}

/* ---------------- UA parsing helpers ---------------- */

export function parseBrowser(ua: string): { name: string; version: string } {
  // order matters: Edge → Opera → Samsung → Firefox → Chrome → Safari
  const table: Array<[RegExp, string]> = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Microsoft Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
    [/Firefox\/([\d.]+)/, 'Mozilla Firefox'],
    [/CriOS\/([\d.]+)/, 'Chrome'],
    [/Chrome\/([\d.]+)/, 'Google Chrome'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
    [/Safari\/([\d.]+)/, 'Safari'],
  ]
  for (const [re, name] of table) {
    const m = ua.match(re)
    if (m) return { name, version: (m[1] || '').split('.').slice(0, 2).join('.') }
  }
  return { name: 'Unknown browser', version: '' }
}

export function parseOS(ua: string): { name: string; version: string } {
  if (/Windows NT ([\d.]+)/.test(ua)) {
    const v = ua.match(/Windows NT ([\d.]+)/)?.[1] || ''
    const map: Record<string, string> = { '10.0': '10 / 11', '6.3': '8.1', '6.2': '8', '6.1': '7' }
    return { name: 'Windows', version: map[v] || v }
  }
  if (/Android ([\d.]+)/.test(ua)) return { name: 'Android', version: ua.match(/Android ([\d.]+)/)?.[1] || '' }
  if (/iPhone|iPad|iPod/.test(ua)) {
    const v = ua.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') || ''
    return { name: /iPad/.test(ua) ? 'iPadOS' : 'iOS', version: v }
  }
  if (/Mac OS X ([\d_.]+)/.test(ua)) return { name: 'macOS', version: (ua.match(/Mac OS X ([\d_.]+)/)?.[1] || '').replace(/_/g, '.') }
  if (/CrOS/.test(ua)) return { name: 'ChromeOS', version: '' }
  if (/Linux/.test(ua)) return { name: 'Linux', version: '' }
  return { name: 'Unknown OS', version: '' }
}

interface UADataBrand {
  brand: string
  version: string
}
interface UADataLow {
  mobile: boolean
  platform: string
  brands?: UADataBrand[]
}
interface UADataHigh extends UADataLow {
  platformVersion?: string
  architecture?: string
  bitness?: string
  model?: string
  uaFullVersion?: string
  fullVersionList?: UADataBrand[]
}

function gpuInfo(): string {
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return 'WebGL unavailable'
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const r = dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : (gl.getParameter(gl.RENDERER) as string)
    return (r || 'GPU detected').replace(/\s*\(.*?\)\s*/g, ' ').trim().slice(0, 60)
  } catch {
    return 'GPU n/a'
  }
}

/** collect everything the browser exposes about the REAL host device */
export async function getDeviceSpecs(): Promise<DeviceSpecs> {
  const nav = navigator as Navigator & {
    userAgentData?: UADataLow & { getHighEntropyValues?: (hints: string[]) => Promise<UADataHigh> }
    deviceMemory?: number
    connection?: { effectiveType?: string; downlink?: number; rtt?: number }
    getBattery?: () => Promise<{ level: number; charging: boolean }>
  }
  const ua = nav.userAgent || ''
  let browser = parseBrowser(ua)
  let os = parseOS(ua)
  let platform = (nav as unknown as { platform?: string }).platform || ''
  let mobile = /Mobi|Android|iPhone|iPod/.test(ua)
  let tablet = /iPad|Tablet|PlayBook|Silk/.test(ua) || (/Android/.test(ua) && !/Mobi/.test(ua))

  /* UA-CH (Chromium) — authoritative high-entropy values when available */
  try {
    const uad = nav.userAgentData
    if (uad?.getHighEntropyValues) {
      const hi = await uad.getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'bitness', 'model', 'uaFullVersion', 'fullVersionList'])
      mobile = hi.mobile ?? mobile
      if (hi.platform) platform = hi.platform
      if (hi.platformVersion) os.version = hi.platformVersion.split('.').slice(0, 2).join('.')
      if (hi.model) os.name = hi.model ? `${hi.platform} ${hi.model}`.trim() : os.name
      const brand = (hi.fullVersionList || uad.brands || []).find((b) => !/Not.?A.?Brand|Chromium$/i.test(b.brand))
      if (brand) browser = { name: brand.brand, version: (brand.version || '').split('.').slice(0, 2).join('.') }
    } else if (uad) {
      mobile = uad.mobile ?? mobile
      if (uad.platform) platform = uad.platform
    }
  } catch {}

  const deviceType = tablet ? 'Tablet' : mobile ? 'Mobile' : 'Desktop'
  const touchPoints = nav.maxTouchPoints || 0
  const inputKind = touchPoints > 2 ? 'Touch + Mouse (hybrid)' : touchPoints > 0 ? 'Touch' : 'Mouse & keyboard'

  let battery: string | null = null
  try {
    const b = await nav.getBattery?.()
    if (b) battery = `${Math.round(b.level * 100)}%${b.charging ? ' · charging' : ''}`
  } catch {}

  const conn = nav.connection
  const network = conn
    ? [conn.effectiveType?.toUpperCase(), conn.downlink ? `${conn.downlink} Mb/s` : null, conn.rtt ? `rtt ${conn.rtt}ms` : null].filter(Boolean).join(' · ')
    : 'n/a'

  return {
    deviceType,
    browser: browser.name,
    browserVersion: browser.version,
    osName: os.name,
    osVersion: os.version,
    platform: platform || 'unknown',
    cpuCores: nav.hardwareConcurrency || 4,
    ramGb: nav.deviceMemory ?? null,
    screen: `${screen.width}×${screen.height}`,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    pixelRatio: window.devicePixelRatio || 1,
    colorDepth: screen.colorDepth || 24,
    touchPoints,
    inputKind,
    gpu: gpuInfo(),
    network,
    online: nav.onLine,
    battery,
    languages: (nav.languages || [nav.language]).slice(0, 3).join(', '),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'n/a',
    ua,
  }
}

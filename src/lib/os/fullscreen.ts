// REDSEC v5.0 — Fullscreen engine
// True full screen (1920×1080-class display fill) via the W3C Fullscreen API with
// webkit fallbacks. Kept store-free so both the store and components can import it
// without circular imports; the fullscreenchange sync lives in OSRoot.
'use client'

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}
type FsEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

/* is the document currently in real (Fullscreen-API) full screen? */
export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false
  const d = document as FsDoc
  return !!(document.fullscreenElement || d.webkitFullscreenElement)
}

/* enter full screen. Returns true on success — false when the browser/iframe
   blocks it (then the UI falls back to the ⛶ pill + F11 guidance). */
export async function enterFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false
  const el = document.documentElement as FsEl
  try {
    if (document.fullscreenEnabled === false) return false
    if (el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' })
      return true
    }
    if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen()
      return true
    }
    return false
  } catch {
    return false
  }
}

/* exit full screen. Returns true when the document is windowed afterwards. */
export async function exitFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false
  const d = document as FsDoc
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return true
    }
    if (d.webkitFullscreenElement && d.webkitExitFullscreen) {
      await d.webkitExitFullscreen()
      return true
    }
    return !isFullscreen()
  } catch {
    return false
  }
}

/* toggle. Resolves to "is the document fullscreen now?" */
export async function toggleFullscreen(): Promise<boolean> {
  if (isFullscreen()) {
    const ok = await exitFullscreen()
    return ok ? false : isFullscreen()
  }
  return enterFullscreen()
}

/* ---------------- resolution helpers (Settings card / toasts) ---------------- */

const RES_LABEL: Record<string, string> = {
  '3840x2160': '4K UHD',
  '5120x2880': '5K',
  '3440x1440': 'UW-QHD',
  '2560x1440': 'QHD 2K',
  '2560x1080': 'UW-FHD',
  '1920x1200': 'WUXGA',
  '1920x1080': 'Full HD',
  '1680x1050': 'WSXGA+',
  '1600x900': 'HD+',
  '1440x900': 'WXGA+',
  '1366x768': 'HD',
  '1280x1024': 'SXGA',
  '1280x800': 'WXGA',
  '1280x720': 'HD',
}

export function screenKey(): string {
  if (typeof window === 'undefined') return '0x0'
  return `${window.screen?.width || 0}x${window.screen?.height || 0}`
}

/* "Full HD" / "QHD 2K" / "Custom" for the detected display resolution */
export function screenLabel(): string {
  return RES_LABEL[screenKey()] || 'Custom'
}

/* aspect ratio of the display: "16:9" when possible, else reduced ints */
export function aspectLabel(): string {
  if (typeof window === 'undefined') return '—'
  const w = window.screen?.width || 0
  const h = window.screen?.height || 0
  if (!w || !h) return '—'
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const d = gcd(w, h) || 1
  const aw = Math.round(w / d)
  const ah = Math.round(h / d)
  const r = aw / ah
  if (Math.abs(r - 16 / 9) < 0.02) return '16:9'
  if (Math.abs(r - 16 / 10) < 0.02) return '16:10'
  if (Math.abs(r - 21 / 9) < 0.07) return '21:9'
  if (Math.abs(r - 4 / 3) < 0.02) return '4:3'
  if (Math.abs(r - 3 / 2) < 0.02) return '3:2'
  return `${aw}:${ah}`
}

/* live viewport size (re-read on resize/fullscreenchange by callers) */
export function viewportSize(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 0, h: 0 }
  return { w: window.innerWidth, h: window.innerHeight }
}

/* "1920 × 1080 · Full HD · 16:9" one-liner for titles/toasts */
export function displayLine(): string {
  if (typeof window === 'undefined') return '1920 × 1080'
  const w = window.screen?.width || 0
  const h = window.screen?.height || 0
  return `${w} × ${h} · ${screenLabel()} · ${aspectLabel()}`
}

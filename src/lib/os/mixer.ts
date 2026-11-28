// REDSEC v5.0 — Per-app Volume Mixer engine
// Routes OS master volume × per-app volume into every controllable <audio>/<video>
// element inside app windows (direct media + same-origin iframes such as installed
// HTML apps). Cross-origin frames manage their own audio and are skipped safely.
'use client'

import { useOS } from './store'

function setMediaVolume(el: HTMLMediaElement, vol: number): void {
  try {
    el.volume = Math.max(0, Math.min(1, vol))
    el.muted = vol <= 0.001
  } catch {
    /* element may be cross-origin or detached */
  }
}

/** apply master × app volume to every controllable media element of one window */
function applyToWindow(winId: string, appId: string, master: number, solo: string | null): void {
  const appVol = useOS.getState().appVolumes[appId] ?? 100
  // solo mode: only the solo app is audible, everything else is silenced
  const eff = solo && appId !== solo ? 0 : (master / 100) * (appVol / 100)
  const root = document.querySelector(`[data-win-id="${winId}"]`)
  if (!root) return
  // direct media elements (local apps: camera preview, svr player, …)
  // [data-os-wall] = decorative live wallpapers — always silent, never mixer-controlled
  root.querySelectorAll?.('video, audio').forEach((el) => {
    if ((el as HTMLElement).dataset?.osWall) return
    setMediaVolume(el as HTMLMediaElement, eff)
  })
  // same-origin iframes (installed HTML apps, srcdoc games, …)
  root.querySelectorAll?.('iframe').forEach((fr) => {
    try {
      const doc = (fr as HTMLIFrameElement).contentDocument
      if (!doc) return
      doc.querySelectorAll?.('video, audio').forEach((el) => setMediaVolume(el as HTMLMediaElement, eff))
    } catch {
      /* cross-origin — browser sandbox protects it; skip */
    }
  })
}

let timer: ReturnType<typeof setInterval> | null = null
let subscribed = false

/** one pass over all open windows */
export function applyMixer(): void {
  const st = useOS.getState()
  const master = st.volume
  const solo = st.mixerSolo
  for (const w of st.windows) applyToWindow(w.id, w.appId, master, solo)
  // Task 18 — REAL volume: media outside app windows too (RedSec Mobile VM
  // music/video, guest pages, floating players) follows the master volume.
  try {
    document.querySelectorAll('video, audio').forEach((el) => {
      if ((el as HTMLElement).dataset?.osWall) return // live wallpapers stay silent
      const win = el.closest('[data-win-id]')
      if (win) return // windowed elements already handled above
      setMediaVolume(el as HTMLMediaElement, master / 100)
    })
  } catch {
    /* document not ready */
  }
}

/** start the background sync loop + INSTANT reaction to volume changes */
export function startMixerLoop(): void {
  if (timer || typeof window === 'undefined') return
  timer = setInterval(applyMixer, 1500)
  // the 1.5s loop catches newly-created media; the subscription makes the
  // taskbar/widget sliders act on every element the very same frame
  if (!subscribed) {
    subscribed = true
    useOS.subscribe((st, prev) => {
      if (st.volume !== prev.volume || st.mixerSolo !== prev.mixerSolo || st.appVolumes !== prev.appVolumes) applyMixer()
    })
  }
}

/** how many media elements an app window currently exposes (same-origin only) */
export function countControllableMedia(winId: string): number {
  const root = document.querySelector(`[data-win-id="${winId}"]`)
  if (!root) return 0
  let n = root.querySelectorAll?.('video, audio').length || 0
  root.querySelectorAll?.('iframe').forEach((fr) => {
    try {
      const doc = (fr as HTMLIFrameElement).contentDocument
      if (doc) n += doc.querySelectorAll?.('video, audio').length || 0
    } catch {
      /* cross-origin */
    }
  })
  return n
}

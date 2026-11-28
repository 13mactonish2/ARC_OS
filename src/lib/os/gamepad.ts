// REDSEC v5.0 — Task 26: universal gamepad support for the Gaming Hub.
// Works with any pad the browser's Gamepad API exposes — wired USB, wireless
// (BT dongle / Bluetooth), Xbox / DualSense / DualShock / PS1-PS2 via USB
// adapters, generic HID — the driver abstracts them all behind the standard
// mapping with a deadzoned fallback for non-standard pads.
'use client'

import { useOS } from './store'

export interface GamepadInfo {
  index: number
  id: string
  connected: boolean
  mapping: string // 'standard' | '' (non-standard pads get heuristic mapping)
  buttons: boolean[] // pressed state per button index
  axes: number[] // raw axes (already deadzoned)
  wireless: boolean // heuristic from the id string
}

export interface PadButtons {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
  a: boolean // bottom (Enter)
  b: boolean // right (Escape/Back)
  x: boolean // left
  y: boolean // top
  lb: boolean
  rb: boolean
  start: boolean
  select: boolean
}

const DEADZONE = 0.35
const listeners = new Set<() => void>()
let raf = 0
let snapshot: GamepadInfo[] = []
let dirty = true

function wirelessHeuristic(id: string): boolean {
  const s = id.toLowerCase()
  return /bluetooth|wireless|bt|dualsense|dualshock|wiimote|switch|stadia/.test(s) || /081f|054c|057e|046d.{0,6}c52/.test(s.replace(/[^a-z0-9]/g, ''))
}

function readPads(): GamepadInfo[] {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return []
  const out: GamepadInfo[] = []
  for (const gp of navigator.getGamepads()) {
    if (!gp) continue
    const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : v)
    out.push({
      index: gp.index,
      id: gp.id,
      connected: gp.connected,
      mapping: gp.mapping || '',
      buttons: Array.from(gp.buttons, (b) => b.pressed || b.value > 0.5),
      axes: Array.from(gp.axes, dz),
      wireless: wirelessHeuristic(gp.id),
    })
  }
  return out
}

function loop() {
  const next = readPads()
  const prevJson = JSON.stringify(snapshot)
  const nextJson = JSON.stringify(next)
  if (nextJson !== prevJson) {
    dirty = true
    snapshot = next
  }
  if (dirty) {
    dirty = false
    listeners.forEach((fn) => fn())
  }
  raf = requestAnimationFrame(loop)
}

function ensureLoop() {
  if (!raf) raf = requestAnimationFrame(loop)
}

function maybeStopLoop() {
  if (!listeners.size && raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
}

/** Subscribe to live gamepad snapshots (starts the rAF poll while anyone listens). */
export function subscribeGamepads(fn: () => void): () => void {
  snapshot = readPads()
  listeners.add(fn)
  ensureLoop()
  return () => {
    listeners.delete(fn)
    maybeStopLoop()
  }
}

export function getGamepads(): GamepadInfo[] {
  return snapshot.filter((g) => g.connected)
}

/** Normalize any pad (standard or heuristic) to the classic face/d-pad layout. */
export function padButtons(gp: GamepadInfo): PadButtons {
  const b = gp.buttons
  const ax = gp.axes
  const std = gp.mapping === 'standard' && b.length >= 17
  const axisUp = (ax[1] ?? 0) < -0.5
  const axisDown = (ax[1] ?? 0) > 0.5
  const axisLeft = (ax[0] ?? 0) < -0.5
  const axisRight = (ax[0] ?? 0) > 0.5
  if (std) {
    return {
      up: b[12] || axisUp,
      down: b[13] || axisDown,
      left: b[14] || axisLeft,
      right: b[15] || axisRight,
      a: b[0],
      b: b[1],
      x: b[2],
      y: b[3],
      lb: b[4],
      rb: b[5],
      start: b[9],
      select: b[8],
    }
  }
  // non-standard pad — best-effort: first 4 buttons are the face cluster
  return {
    up: axisUp,
    down: axisDown,
    left: axisLeft,
    right: axisRight,
    a: !!b[0],
    b: !!b[1],
    x: !!b[2],
    y: !!b[3],
    lb: !!b[4],
    rb: !!b[5],
    start: !!b[9],
    select: !!b[8],
  }
}

/* ---------------- driver (Settings → Drivers / Gaming Hub / App Store) ---------------- */

export function isGamepadDriverInstalled(): boolean {
  return !!useOS.getState().drivers.gamepad
}

export function installGamepadDriver(): void {
  const st = useOS.getState()
  if (st.drivers.gamepad) return
  st.set({ drivers: { ...st.drivers, gamepad: true } })
  st.notify({ title: 'Gamepad driver installed', body: 'Wired & wireless controllers, PlayStation, Xbox, generic HID — ready in the Gaming Hub', kind: 'success', emoji: '🎮' })
}

export function uninstallGamepadDriver(): void {
  const st = useOS.getState()
  if (!st.drivers.gamepad) return
  st.set({ drivers: { ...st.drivers, gamepad: false } })
  st.notify({ title: 'Gamepad driver removed', kind: 'info' })
}

/* ---------------- pad → keyboard bridge (drives every Hub game/emulator) ---------------- */

type KeyMap = [keyof PadButtons, string]
const BRIDGE_MAP: KeyMap[] = [
  ['up', 'ArrowUp'],
  ['down', 'ArrowDown'],
  ['left', 'ArrowLeft'],
  ['right', 'ArrowRight'],
  ['a', 'Enter'],
  ['b', 'Escape'],
  ['x', 'KeyZ'],
  ['y', 'Space'],
  ['start', 'Space'],
]

/**
 * While the bridge is active, every connected pad feeds synthetic keyboard
 * events into the page (and any same-origin emulator iframe) — so EVERY game
 * in the Hub becomes playable without touching a keyboard. Edge-triggered:
 * a key fires once per physical press (hold repeats are throttled per key).
 */
export function startKeyBridge(): () => void {
  let last: Partial<Record<keyof PadButtons, boolean>> = {}
  const heldSince: Partial<Record<keyof PadButtons, number>> = {}
  const REPEAT_MS = 160

  const fire = (key: string, type: 'keydown' | 'keyup') => {
    try {
      window.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }))
    } catch {
      /* synthetic events are best-effort */
    }
    // same-origin emulator iframes (EmulatorJS hosts) get a copy too
    try {
      document.querySelectorAll('iframe').forEach((f) => {
        try {
          if (f.contentWindow && f.src.startsWith(window.location.origin)) {
            f.contentWindow.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true }))
          }
        } catch {
          /* cross-origin iframe — ignore */
        }
      })
    } catch {
      /* ignore */
    }
  }

  const tick = () => {
    const pads = getGamepads()
    const now = Date.now()
    const cur: Partial<Record<keyof PadButtons, boolean>> = {}
    for (const gp of pads) {
      const pb = padButtons(gp)
      for (const [btn] of BRIDGE_MAP) cur[btn] = cur[btn] || pb[btn]
    }
    for (const [btn, key] of BRIDGE_MAP) {
      const was = !!last[btn]
      const is = !!cur[btn]
      if (is && !was) {
        fire(key, 'keydown')
        heldSince[btn] = now
      } else if (!is && was) {
        fire(key, 'keyup')
        delete heldSince[btn]
      } else if (is && now - (heldSince[btn] ?? now) > REPEAT_MS) {
        // gentle auto-repeat for the d-pad only (platformers need held movement)
        if (btn === 'up' || btn === 'down' || btn === 'left' || btn === 'right') {
          fire(key, 'keydown')
          heldSince[btn] = now
        }
      }
    }
    last = cur
  }

  const stop = subscribeGamepads(tick)
  return () => {
    stop()
    // release anything still held
    for (const [btn, key] of BRIDGE_MAP) {
      if (last[btn]) fire(key, 'keyup')
    }
  }
}

/** Best-effort rumble (DualSense/DualShock/Xbox pads with the haptics actuator). */
export function rumble(gpIndex: number, strong = 0.8, weak = 0.4, ms = 200): boolean {
  try {
    const gp = navigator.getGamepads()?.[gpIndex] as Gamepad & { vibrationActuator?: { playEffect: (t: string, o: object) => Promise<unknown> } } | null
    if (gp?.vibrationActuator?.playEffect) {
      void gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })
      return true
    }
  } catch {
    /* no haptics */
  }
  return false
}

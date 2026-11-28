// REDSEC v5.0 — Synthesized system sounds (WebAudio, no assets)
// Task 18 — REAL volume: every tone routes through a persistent master GainNode
// so the taskbar/widget volume slider controls system sounds sample-accurately.
'use client'

import { useOS } from './store'

let ctx: AudioContext | null = null
let master: GainNode | null = null

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      ctx = new Ctor()
      master = ctx.createGain()
      master.gain.value = useOS.getState().volume / 100
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

/** keep the master gain glued to the OS volume (called on every store change) */
export function syncSoundMaster(): void {
  try {
    if (master && ctx) master.gain.setTargetAtTime(useOS.getState().volume / 100, ctx.currentTime, 0.02)
  } catch {
    /* audio not initialised yet */
  }
}

function tone(
  volume: number,
  notes: Array<{ f: number; t: number; d: number; type?: OscillatorType; g?: number }>,
  masterLvl = 0.5
): void {
  const a = ac()
  if (!a || volume <= 0) return
  const now = a.currentTime
  const comp = a.createGain()
  // 0.35 headroom — the OS master gain (volume/100) is applied downstream
  comp.gain.value = masterLvl * 0.35
  // route through the persistent master gain when available (Task 18);
  // fall back to the destination directly if audio init was blocked
  comp.connect(master && master.context === a ? master : a.destination)
  for (const n of notes) {
    const osc = a.createOscillator()
    const gain = a.createGain()
    osc.type = n.type || 'sine'
    osc.frequency.value = n.f
    const t0 = now + n.t
    const peak = n.g ?? 1
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + n.d)
    osc.connect(gain)
    gain.connect(comp)
    osc.start(t0)
    osc.stop(t0 + n.d + 0.05)
  }
}

/* live-glue: widget/slider volume changes retune the master gain instantly */
if (typeof window !== 'undefined') {
  try {
    useOS.subscribe((st, prev) => {
      if (st.volume !== prev.volume) syncSoundMaster()
    })
  } catch {
    /* store not ready during SSR — harmless */
  }
}

export const osSound = {
  boot(volume = 70): void {
    // rising falcon chime: A3 → E4 → A4
    tone(volume, [
      { f: 220, t: 0, d: 0.5, type: 'triangle', g: 0.5 },
      { f: 329.6, t: 0.16, d: 0.5, type: 'triangle', g: 0.6 },
      { f: 440, t: 0.34, d: 0.9, type: 'triangle', g: 0.8 },
      { f: 880, t: 0.36, d: 0.9, type: 'sine', g: 0.18 },
    ])
  },
  login(volume = 70): void {
    tone(volume, [
      { f: 523.3, t: 0, d: 0.18, type: 'sine', g: 0.6 },
      { f: 659.3, t: 0.1, d: 0.28, type: 'sine', g: 0.6 },
    ])
  },
  shutter(volume = 70): void {
    // camera shutter click
    tone(volume, [
      { f: 1800, t: 0, d: 0.05, type: 'square', g: 0.25 },
      { f: 900, t: 0.06, d: 0.07, type: 'square', g: 0.2 },
    ])
  },
  notify(volume = 70): void {
    tone(volume, [
      { f: 880, t: 0, d: 0.12, type: 'sine', g: 0.35 },
      { f: 1174.7, t: 0.09, d: 0.22, type: 'sine', g: 0.3 },
    ])
  },
  error(volume = 70): void {
    tone(volume, [
      { f: 220, t: 0, d: 0.16, type: 'sawtooth', g: 0.3 },
      { f: 180, t: 0.14, d: 0.2, type: 'sawtooth', g: 0.3 },
    ])
  },
  open(volume = 70): void {
    tone(volume, [{ f: 660, t: 0, d: 0.1, type: 'sine', g: 0.2 }])
  },
  tick(volume = 70): void {
    // subtle UI click for menus / dialogs
    tone(volume, [
      { f: 1200, t: 0, d: 0.035, type: 'sine', g: 0.14 },
      { f: 700, t: 0.02, d: 0.045, type: 'sine', g: 0.1 },
    ])
  },
  alarm(volume = 70): void {
    // rising siren for Clock 5.0 alarms & timers (4-beep loop seed)
    tone(volume, [
      { f: 880, t: 0, d: 0.18, type: 'square', g: 0.28 },
      { f: 660, t: 0.2, d: 0.18, type: 'square', g: 0.28 },
      { f: 880, t: 0.4, d: 0.18, type: 'square', g: 0.28 },
      { f: 660, t: 0.6, d: 0.26, type: 'square', g: 0.28 },
    ])
  },
  merge(volume = 70): void {
    // soft pop for 2048 tile merges
    tone(volume, [
      { f: 520, t: 0, d: 0.06, type: 'sine', g: 0.22 },
      { f: 780, t: 0.05, d: 0.09, type: 'sine', g: 0.2 },
    ])
  },
}

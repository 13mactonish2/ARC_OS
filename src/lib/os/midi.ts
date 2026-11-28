// REDSEC v5.0 — MIDI engine (Task 35)
// A real Standard MIDI File (SMF) parser + WebAudio synthesizer so .mid/.midi
// files are actually HEARABLE in the OS (browsers have no native MIDI decoder).
// Parses header/tracks, running status, tempo maps, note on/off with velocity,
// then schedules oscillator voices with a per-track ADSR envelope.
'use client'

export interface MidiNote {
  tick: number
  durTicks: number
  midi: number // 0-127
  vel: number // 0-127
  track: number
  channel: number
}

export interface MidiTempo {
  tick: number
  usPerQuarter: number
}

export interface MidiSong {
  ppq: number // ticks per quarter note
  notes: MidiNote[]
  tempos: MidiTempo[]
  durationSec: number
  trackCount: number
  noteCount: number
}

export function isMidiName(name: string): boolean {
  return /\.(mid|midi|kar|rmi)$/i.test(name)
}

/* ---------------- parser ---------------- */

class Reader {
  p = 0
  constructor(public v: DataView) {}
  u8(): number {
    return this.v.getUint8(this.p++)
  }
  u16(): number {
    const x = this.v.getUint16(this.p)
    this.p += 2
    return x
  }
  u32(): number {
    const x = this.v.getUint32(this.p)
    this.p += 4
    return x
  }
  str(n: number): string {
    let s = ''
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.v.getUint8(this.p++))
    return s
  }
  varlen(): number {
    let out = 0
    for (let i = 0; i < 4; i++) {
      const b = this.u8()
      out = (out << 7) | (b & 0x7f)
      if (!(b & 0x80)) break
    }
    return out
  }
  skip(n: number): void {
    this.p += n
  }
  get eof(): boolean {
    return this.p >= this.v.byteLength
  }
}

export function parseMidi(buf: ArrayBuffer): MidiSong {
  const r = new Reader(new DataView(buf))
  if (buf.byteLength < 14 || r.str(4) !== 'MThd') throw new Error('Not a MIDI file (missing MThd)')
  const hdrLen = r.u32()
  const fmt = r.u16()
  r.u16() // ntrks (fmt-1 files may declare more chunks) — we read until EOF instead
  const ppq = r.u16() & 0x7fff
  r.skip(hdrLen - 6)

  const notes: MidiNote[] = []
  const tempos: MidiTempo[] = [{ tick: 0, usPerQuarter: 500000 }]
  let trackCount = 0

  while (!r.eof) {
    let id = ''
    try {
      id = r.str(4)
    } catch {
      break
    }
    if (id === 'MTrk') {
      trackCount++
      const len = r.u32()
      const end = r.p + len
      let tick = 0
      let running = 0
      /* per-track channel state for running status + note-on tracking */
      const open: Record<number, { tick: number; vel: number }> = {}
      while (r.p < end) {
        tick += r.varlen()
        let status = r.v.getUint8(r.p)
        if (status & 0x80) {
          r.p++
          running = status
        } else {
          status = running
          if (!(status & 0x80)) break // corrupt stream guard
        }
        const type = status & 0xf0
        const chan = status & 0x0f
        if (type === 0x90 || type === 0x80) {
          const note = r.u8()
          const vel = r.u8()
          const key = chan * 128 + note
          if (type === 0x90 && vel > 0) {
            open[key] = { tick, vel }
          } else {
            const on = open[key]
            if (on) {
              const dur = Math.max(1, tick - on.tick)
              notes.push({ tick: on.tick, durTicks: dur, midi: note, vel: on.vel, track: trackCount - 1, channel: chan })
              delete open[key]
            }
          }
        } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
          r.skip(2)
        } else if (type === 0xc0 || type === 0xd0) {
          r.skip(1)
        } else if (status === 0xff) {
          const meta = r.u8()
          const len2 = r.varlen()
          if (meta === 0x51 && len2 === 3) {
            const us = (r.u8() << 16) | (r.u8() << 8) | r.u8()
            tempos.push({ tick, usPerQuarter: us || 500000 })
          } else if (meta === 0x2f) {
            r.skip(len2)
            break // end of track
          } else {
            r.skip(len2)
          }
        } else if (status === 0xf0 || status === 0xf7) {
          r.skip(r.varlen())
        } else {
          break // unknown — bail out of this track defensively
        }
      }
      r.p = end
      void fmt
    } else {
      /* unknown chunk — skip its declared length when sane, else stop */
      let len = 0
      try {
        len = r.u32()
      } catch {
        break
      }
      if (len < 0 || len > r.v.byteLength - r.p) break
      r.skip(len)
    }
  }

  if (!notes.length) throw new Error('No playable notes in this MIDI file')
  notes.sort((a, b) => a.tick - b.tick)
  tempos.sort((a, b) => a.tick - b.tick)

  /* tick → seconds via the tempo map */
  const tickToSec = (tick: number): number => {
    let sec = 0
    let lastTick = 0
    let us = 500000
    for (const t of tempos) {
      if (t.tick >= tick) break
      sec += ((t.tick - lastTick) * us) / ppq / 1e6
      lastTick = t.tick
      us = t.usPerQuarter
    }
    sec += ((tick - lastTick) * us) / ppq / 1e6
    return sec
  }

  let lastTick = 0
  for (const n of notes) {
    const end = n.tick + n.durTicks
    if (end > lastTick) lastTick = end
  }
  return { ppq, notes, tempos, durationSec: Math.max(0.4, tickToSec(lastTick) + 0.4), trackCount, noteCount: notes.length }
}

export function midiTickToSec(song: MidiSong, tick: number): number {
  let sec = 0
  let lastTick = 0
  let us = song.tempos[0]?.usPerQuarter || 500000
  for (const t of song.tempos) {
    if (t.tick >= tick) break
    sec += ((t.tick - lastTick) * us) / song.ppq / 1e6
    lastTick = t.tick
    us = t.usPerQuarter
  }
  sec += ((tick - lastTick) * us) / song.ppq / 1e6
  return sec
}

/* ---------------- synthesizer ---------------- */

/** instrument colors per MIDI channel (rough GM flavor) */
function voiceFor(channel: number): { type: OscillatorType; attack: number; release: number; gain: number } {
  if (channel === 9) return { type: 'square', attack: 0.002, release: 0.14, gain: 0.24 } // drums-ish punch
  if (channel === 0) return { type: 'triangle', attack: 0.008, release: 0.3, gain: 0.3 } // lead
  if (channel % 3 === 1) return { type: 'sawtooth', attack: 0.015, release: 0.35, gain: 0.16 } // pads/strings
  if (channel % 3 === 2) return { type: 'sine', attack: 0.01, release: 0.4, gain: 0.26 } // bass/keys
  return { type: 'triangle', attack: 0.006, release: 0.3, gain: 0.26 }
}

export class MidiPlayer {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private timers: number[] = []
  private nodes: Array<{ osc: OscillatorNode; g: GainNode }> = []
  private stopped = true
  private song: MidiSong | null = null
  private startedAt = 0
  private pausedSec = 0
  onEnd: (() => void) | null = null
  onTick: ((sec: number) => void) | null = null

  get playing(): boolean {
    return !this.stopped
  }

  get positionSec(): number {
    if (!this.song) return 0
    return this.stopped ? this.pausedSec : Math.min(this.song.durationSec, this.pausedSec + (this.ctx ? this.ctx.currentTime - this.startedAt : 0))
  }

  load(song: MidiSong): void {
    this.stop()
    this.song = song
    this.pausedSec = 0
  }

  /** start (or resume) playback from the current position */
  play(): void {
    if (!this.song || !this.stopped) return
    const AC: typeof AudioContext | undefined =
      typeof window !== 'undefined' ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined
    if (!AC) return
    this.ctx = this.ctx || new AC()
    void this.ctx.resume()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(this.ctx.destination)
    this.stopped = false
    this.startedAt = this.ctx.currentTime

    const from = this.pausedSec
    /* schedule every note that ends after `from`; skip ones already finished */
    const lookahead = this.song.durationSec - from
    const step = Math.min(1.2, Math.max(0.35, lookahead / 400))
    let idx = 0
    const notes = this.song.notes
    /* advance idx to the first note whose end is >= from */
    while (idx < notes.length && midiTickToSec(this.song, notes[idx].tick + notes[idx].durTicks) < from) idx++

    const schedule = () => {
      if (this.stopped || !this.ctx || !this.song) return
      const now = this.pausedSec + (this.ctx.currentTime - this.startedAt)
      const until = now + 1.5
      while (idx < notes.length) {
        const n = notes[idx]
        const tOn = midiTickToSec(this.song, n.tick)
        const tOff = midiTickToSec(this.song, n.tick + n.durTicks)
        if (tOff < from) {
          idx++
          continue
        }
        if (tOn > until) break
        idx++
        if (tOff <= now) continue // already passed
        const at = Math.max(this.ctx.currentTime + 0.02, this.startedAt + (tOn - this.pausedSec))
        this.voice(n.midi, n.vel, n.channel, at, Math.max(0.06, tOff - tOn))
      }
      if (this.onTick) this.onTick(Math.min(this.song.durationSec, now))
      if (now >= this.song.durationSec) {
        this.stop()
        if (this.onEnd) this.onEnd()
        return
      }
      this.timers.push(window.setTimeout(schedule, step * 1000))
    }
    schedule()
  }

  /** one synth voice — osc → gain(ADSR) → lowpass → master */
  private voice(midi: number, vel: number, channel: number, at: number, durSec: number): void {
    if (!this.ctx || !this.master) return
    const v = voiceFor(channel)
    const freq = 440 * Math.pow(2, (midi - 69) / 12)
    const osc = this.ctx.createOscillator()
    osc.type = v.type
    osc.frequency.value = freq
    const g = this.ctx.createGain()
    const amp = v.gain * (0.25 + (vel / 127) * 0.75)
    const peak = Math.max(0.0001, at + v.attack)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0012, amp), peak)
    g.gain.setTargetAtTime(0.0001, Math.max(peak, at + durSec * 0.7), Math.max(0.02, durSec * 0.18))
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = channel === 9 ? 3200 : 5200
    osc.connect(g).connect(lp).connect(this.master)
    const stopAt = at + durSec + v.release + 0.15
    osc.start(at)
    osc.stop(stopAt)
    const rec = { osc, g }
    this.nodes.push(rec)
    osc.onended = () => {
      this.nodes = this.nodes.filter((x) => x !== rec)
    }
  }

  pause(): void {
    if (this.stopped) return
    const pos = this.positionSec
    this.killVoices()
    this.stopped = true
    this.pausedSec = pos
  }

  stop(): void {
    this.killVoices()
    this.stopped = true
    this.pausedSec = 0
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  seek(sec: number): void {
    const wasPlaying = !this.stopped
    this.pause()
    this.pausedSec = Math.max(0, Math.min(this.song?.durationSec || 0, sec))
    if (wasPlaying) this.play()
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v))
  }

  private killVoices(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    for (const { osc, g } of this.nodes) {
      try {
        g.gain.cancelScheduledValues(0)
        g.gain.value = 0
        osc.stop()
      } catch {
        /* already stopped */
      }
    }
    this.nodes = []
    try {
      this.master?.disconnect()
    } catch {
      /* noop */
    }
    this.master = null
  }
}

/* ---------------- React hook ---------------- */

import { useEffect, useRef, useState } from 'react'

export function useMidiPlayer(src: string | null): {
  song: MidiSong | null
  error: string | null
  playing: boolean
  pos: number
  toggle: () => void
  stop: () => void
  seek: (sec: number) => void
  duration: number
} {
  const [song, setSong] = useState<MidiSong | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const playerRef = useRef<MidiPlayer | null>(null)

  useEffect(() => {
    let dead = false
    const player = new MidiPlayer()
    playerRef.current = player
    player.onEnd = () => {
      setPlaying(false)
      setPos(0)
    }
    if (!src) return
    let cancelled = false
    /* reset outside the effect body (React lint: no sync setState in effects) */
    queueMicrotask(() => {
      if (cancelled) return
      setError(null)
      setSong(null)
      setPos(0)
      setPlaying(false)
    })
    fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => {
        if (dead) return
        const parsed = parseMidi(buf)
        player.load(parsed)
        setSong(parsed)
      })
      .catch((e) => {
        if (!dead) setError(e instanceof Error ? e.message : 'MIDI decode failed')
      })
    return () => {
      dead = true
      player.stop()
      playerRef.current = null
    }
  }, [src])

  /* rAF position ticker */
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const loop = () => {
      const p = playerRef.current
      if (p) setPos(p.positionSec)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const toggle = () => {
    const p = playerRef.current
    if (!p || !song) return
    if (p.playing) {
      p.pause()
      setPlaying(false)
    } else {
      p.play()
      setPlaying(true)
    }
  }
  const stop = () => {
    playerRef.current?.stop()
    setPlaying(false)
    setPos(0)
  }
  const seek = (sec: number) => {
    playerRef.current?.seek(sec)
    setPos(sec)
  }

  return { song, error, playing, pos, toggle, stop, seek, duration: song?.durationSec || 0 }
}

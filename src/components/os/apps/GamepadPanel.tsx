// REDSEC v5.0 — Universal Gamepad panel for Gaming Hub (Task 26)
// Supports any controller the Gamepad API exposes: wired/wireless Xbox/XInput,
// DualShock 1-5 / DualSense, PS1/PS2 USB adapters, 8BitDo, retro & arcade sticks.
// Captured ONLY while Gaming Hub is open — the rest of the OS ignores pads.
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Gamepad2, Usb, Bluetooth, Zap, ShieldCheck, Download, CheckCircle2, Loader2 } from 'lucide-react'
import { useOS } from '@/lib/os/store'

export interface PadInfo {
  index: number
  id: string
  klass: 'ps1ps2' | 'ps' | 'xbox' | '8bitdo' | 'retro' | 'generic'
  label: string
  connection: 'wired' | 'wireless'
  mapping: string
}

export interface PadState {
  buttons: boolean[]
  axes: number[]
}

const CLASS_STYLE: Record<PadInfo['klass'], { chip: string; text: string }> = {
  ps1ps2: { chip: 'bg-sky-500/15 text-sky-300', text: 'PS1/PS2 adapter' },
  ps: { chip: 'bg-blue-500/15 text-blue-300', text: 'PlayStation pad' },
  xbox: { chip: 'bg-sky-500/15 text-sky-300', text: 'Xbox / XInput' },
  '8bitdo': { chip: 'bg-amber-500/15 text-amber-300', text: '8BitDo' },
  retro: { chip: 'bg-violet-500/15 text-violet-300', text: 'Retro / arcade' },
  generic: { chip: 'bg-slate-500/15 text-slate-300', text: 'Generic HID pad' },
}

function classify(gp: Gamepad): PadInfo {
  const id = gp.id || 'Gamepad'
  const l = id.toLowerCase()
  let klass: PadInfo['klass'] = 'generic'
  let label = 'Generic HID gamepad'
  if (/ps1|ps2|playstation ?[12]|dual ?adapter|mayflash|psx/.test(l)) {
    klass = 'ps1ps2'
    label = 'PS1/PS2 classic adapter'
  } else if (/dualsense|ps5|playstation ?5/.test(l)) {
    klass = 'ps'
    label = 'DualSense (PS5)'
  } else if (/dualshock\s*4|ds4|playstation ?4|084f|05c4|09cc/.test(l)) {
    klass = 'ps'
    label = 'DualShock 4 (PS4)'
  } else if (/dualshock|playstation|sixaxis|0268|026/.test(l)) {
    klass = 'ps'
    label = 'DualShock (PS3)'
  } else if (/xbox|xinput|045e|xone|series/.test(l)) {
    klass = 'xbox'
    label = /360/.test(l) ? 'Xbox 360 pad' : 'Xbox / XInput pad'
  } else if (/8bitdo/.test(l)) {
    klass = '8bitdo'
    label = '8BitDo controller'
  } else if (/snes|nes|retro|arcade|fightstick|usb gamepad/.test(l)) {
    klass = 'retro'
    label = 'Retro / arcade stick'
  }
  const wireless = /bluetooth|wireless|dualsense|dualshock|xinput|series|084f|05c4/.test(l) && !/wired/.test(l)
  return {
    index: gp.index,
    id,
    klass,
    label,
    connection: wireless ? 'wireless' : 'wired',
    mapping: gp.mapping === 'standard' ? 'Standard mapping ✓' : 'Vendor mapping (auto-mapped)',
  }
}

function PadVisualizer({ padIndex, pollKey }: { padIndex: number; pollKey: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    let last = 0
    const BTN_LABELS = ['A', 'B', 'X', 'Y', 'L1', 'R1', 'L2', 'R2', '—', '—', 'L3', 'R3', '↑', '↓', '←', '→']
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (t - last < 33) return // ~30 fps is plenty
      last = t
      const cv = canvasRef.current
      const ctx = cv?.getContext('2d')
      if (!cv || !ctx) return
      const gp = navigator.getGamepads?.()[padIndex]
      const W = cv.width
      const H = cv.height
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(0, 0, W, H)
      if (!gp) return
      // button grid (first 16 buttons, 8 per row)
      const per = 8
      const r = 9
      const gap = 8
      const startX = (W - (per * (r * 2 + gap) - gap)) / 2 + r
      const y1 = 22
      const y2 = 22 + r * 2 + gap
      gp.buttons.forEach((b, i) => {
        if (i >= 16) return
        const row = Math.floor(i / per)
        const cx = startX + (i % per) * (r * 2 + gap)
        const cy = row === 0 ? y1 : y2
        const pressed = b.pressed || b.value > 0.5
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = pressed ? '#4ade80' : 'rgba(255,255,255,0.10)'
        ctx.fill()
        ctx.strokeStyle = pressed ? '#166534' : 'rgba(255,255,255,0.18)'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = pressed ? '#052e16' : 'rgba(255,255,255,0.55)'
        ctx.font = '8px monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(BTN_LABELS[i] || String(i), cx, cy)
      })
      // analog sticks — left axes 0/1, right axes 2/3
      const stick = (x: number, y: number, ax: number, ay: number, name: string) => {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'
        ctx.beginPath()
        ctx.arc(x, y, 16, 0, Math.PI * 2)
        ctx.stroke()
        const dx = (gp.axes[ax] ?? 0) * 12
        const dy = (gp.axes[ay] ?? 0) * 12
        ctx.beginPath()
        ctx.arc(x + dx, y + dy, 7, 0, Math.PI * 2)
        ctx.fillStyle = Math.abs(dx) + Math.abs(dy) > 2 ? '#a3e635' : 'rgba(255,255,255,0.35)'
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.font = '8px monospace'
        ctx.fillText(name, x, y + 28)
      }
      stick(52, H - 44, 0, 1, 'L-stick')
      stick(W - 52, H - 44, 2, 3, 'R-stick')
      // triggers as bars
      const trig = (x: number, v: number, name: string) => {
        ctx.fillStyle = 'rgba(255,255,255,0.12)'
        ctx.fillRect(x, H - 30, 8, 26)
        ctx.fillStyle = '#a3e635'
        ctx.fillRect(x, H - 4 - 26 * v, 8, 26 * v)
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.font = '8px monospace'
        ctx.fillText(name, x + 4, H - 32)
      }
      trig(96, gp.buttons[6]?.value ?? 0, 'L2')
      trig(W - 104, gp.buttons[7]?.value ?? 0, 'R2')
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [padIndex, pollKey])
  return <canvas ref={canvasRef} width={380} height={150} className="h-[150px] w-full rounded-lg border border-white/10" aria-label="Live controller input" />
}

function rumble(padIndex: number): Promise<boolean> {
  try {
    const gp = navigator.getGamepads?.()[padIndex] as (Gamepad & { vibrationActuator?: { playEffect: (t: string, o: Record<string, number>) => Promise<string> } }) | null
    if (gp?.vibrationActuator?.playEffect) {
      return gp.vibrationActuator
        .playEffect('dual-rumble', { startDelay: 0, duration: 350, weakMagnitude: 0.9, strongMagnitude: 1.0 })
        .then(() => true)
        .catch(() => false)
    }
    if ('vibrate' in navigator) {
      navigator.vibrate?.(200)
      return Promise.resolve(true)
    }
  } catch {
    /* fall through */
  }
  return Promise.resolve(false)
}

export function PadsView({ onClose }: { onClose: () => void }) {
  const webDrivers = useOS((s) => s.webDrivers)
  const notify = useOS((s) => s.notify)
  const [pads, setPads] = useState<PadInfo[]>([])
  const [tick, setTick] = useState(0) // rescan trigger for the canvas
  const driverInstalled = !!webDrivers['gamepad-universal']
  const [installing, setInstalling] = useState(false)
  const [pollKey, setPollKey] = useState(0)

  useEffect(() => {
    let raf = 0
    let last = 0
    const scan = (t: number) => {
      raf = requestAnimationFrame(scan)
      if (t - last < 250) return // 4 Hz is enough for the pad list
      last = t
      const list = navigator.getGamepads ? navigator.getGamepads() : []
      const infos: PadInfo[] = []
      for (const gp of list) {
        if (gp) infos.push(classify(gp))
      }
      setPads((prev) => {
        const a = prev.map((p) => `${p.index}|${p.id}`).join(',')
        const b = infos.map((p) => `${p.index}|${p.id}`).join(',')
        return a === b ? prev : infos
      })
    }
    raf = requestAnimationFrame(scan)
    const onChange = () => setPollKey((k) => k + 1)
    window.addEventListener('gamepadconnected', onChange)
    window.addEventListener('gamepaddisconnected', onChange)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('gamepadconnected', onChange)
      window.removeEventListener('gamepaddisconnected', onChange)
    }
  }, [])

  const installDriver = () => {
    if (installing) return
    setInstalling(true)
    setTimeout(() => {
      const os = useOS.getState()
      os.set({ webDrivers: { ...os.webDrivers, 'gamepad-universal': { name: 'Universal Gamepad Driver', version: '2.0.1', installedAt: Date.now() } } })
      os.notify({ title: 'Universal Gamepad Driver installed', body: 'Xbox · PlayStation · PS1/PS2 adapters · 8BitDo — hot-plug enabled', kind: 'success', emoji: '🎮' })
      setInstalling(false)
    }, 900)
  }

  return (
    <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto max-w-4xl space-y-4">
        {/* header */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-lime-400/25 bg-lime-400/[0.07] px-4 py-3">
          <Gamepad2 className="h-4 w-4 text-lime-300" />
          <span className="text-xs font-semibold text-lime-100/90">Controllers — captured inside Gaming Hub only</span>
          <span className={`ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${driverInstalled ? 'bg-sky-500/15 text-sky-300' : 'bg-amber-500/15 text-amber-300'}`}>
            {driverInstalled ? <CheckCircle2 className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
            {driverInstalled ? 'Driver active' : 'Driver not installed'}
          </span>
          <button type="button" onClick={onClose} className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] text-slate-300 hover:bg-white/10">Back to library</button>
        </div>

        {/* driver card */}
        <div className="rounded-xl border border-white/10 bg-[#161b28] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-white/5 text-xl">🎮</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-100">Universal Gamepad Driver v2.0.1</div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                Works with <span className="text-slate-300">any controller</span> — wired or wireless Xbox/XInput, DualShock 1·2·3·4·5 / DualSense, PS1/PS2 USB adapters, 8BitDo, SNES/NES retro pads and arcade sticks. Hot-plug: just connect and press any button.
              </div>
            </div>
            {driverInstalled ? (
              <span className="flex flex-none items-center gap-1 rounded-lg bg-sky-500/15 px-3 py-2 text-[11px] font-semibold text-sky-400"><ShieldCheck className="h-4 w-4" /> Installed</span>
            ) : (
              <button type="button" onClick={installDriver} disabled={installing} className="flex flex-none items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Install driver
              </button>
            )}
          </div>
        </div>

        {/* connected pads */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <Gamepad2 className="h-3 w-3" /> Connected controllers — {pads.length}
          </div>
          {pads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
              <span className="text-3xl">🕹️</span>
              <span className="text-sm font-medium text-slate-300">No controller detected yet</span>
              <span className="max-w-sm text-[11px] text-slate-500">
                Plug in a USB pad (or pair a Bluetooth one), then <span className="text-slate-300">press any button</span> — it appears here instantly. PS1/PS2 adapters show up as classic pads.
              </span>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {pads.map((p) => (
                <div key={`${p.index}-${p.id}`} className="rounded-xl border border-white/10 bg-[#161b28] p-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-lime-500/15 text-lg">🎮</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-100">{p.label}</div>
                      <div className="truncate text-[10px] text-slate-500" title={p.id}>{p.id}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                    <span className={`rounded-full px-2 py-0.5 font-bold ${CLASS_STYLE[p.klass].chip}`}>{CLASS_STYLE[p.klass].text}</span>
                    <span className="flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-slate-300">
                      {p.connection === 'wired' ? <Usb className="h-3 w-3" /> : <Bluetooth className="h-3 w-3" />} {p.connection}
                    </span>
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-400">{p.mapping}</span>
                  </div>
                  <div className="mt-3">
                    <PadVisualizer padIndex={p.index} pollKey={pollKey} />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await rumble(p.index)
                      notify({ title: ok ? 'Rumble test sent' : 'No rumble motor on this pad', kind: ok ? 'success' : 'info', emoji: '📳' })
                    }}
                    className="mt-2.5 h-8 w-full rounded-lg bg-white/5 text-[11px] font-medium text-slate-200 hover:bg-white/10"
                  >
                    📳 Rumble test
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* mapping legend */}
        <div className="rounded-xl border border-white/10 bg-[#161b28] p-4">
          <div className="mb-2 text-sm font-medium text-slate-200">Controls inside the emulator</div>
          <div className="grid gap-2 text-[11px] text-slate-400 sm:grid-cols-2">
            <div>⬆️⬇️⬅️➡️ D-pad / left stick — directions</div>
            <div>🅰 A / Cross — button 1 (B on NES-style)</div>
            <div>🅱 B / Circle — button 2 (A on NES-style)</div>
            <div>▶️ Start — Start · ⏸ Select — Select</div>
            <div>Shoulder L1/R1 — L / R buttons</div>
            <div>Emulator menu — gamepad icon in the player bar</div>
          </div>
          <div className="mt-2 rounded-lg bg-black/25 p-2.5 text-[10.5px] text-slate-500">
            🔒 Gamepad input is <span className="text-slate-300">captured by Gaming Hub only</span> — desktop shortcuts, the taskbar and other apps ignore controllers. Web-game frames receive keyboard remaps too; console cores take pads natively.
          </div>
        </div>
      </div>
    </div>
  )
}

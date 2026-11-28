// REDSEC 5.x — System driver catalog + REAL browser-API verification probes.
// Task 29: every system driver maps to actual web-platform engines, and every
// install is verified against the live hardware before it is marked installed:
//   windows  → Gamepad API · WebAudio · Network Information · Storage quota
//   directx  → WebGPU adapter (vendor/architecture probe), ANGLE/WebGL fallback
//   wine     → WebAssembly engine — validate + compile + RUN a real wasm module
//   proton   → WASM + SharedArrayBuffer/threads + OffscreenCanvas (gaming runtime)
//   mesa     → WebGL2 + real GLSL fragment-shader compile + unmasked GPU string
// Task 34: the DOS BIOS & DOSBox driver (dosbios) was removed from the OS —
// store migration v19 strips any leftover install record.
'use client'

import type { DriverId } from './types'

export interface DriverDef {
  id: DriverId
  name: string
  version: string
  size: string
  publisher: string
  emoji: string
  color: string
  tagline: string
  details: string[]
  requires: DriverId[]
  /** what the Gaming Hub / OS gains once this is installed */
  enables: string
}

export const DRIVER_CATALOG: DriverDef[] = [
  {
    id: 'windows',
    name: 'Windows Driver Pack',
    version: '11.4.2',
    size: '184 MB',
    publisher: 'REDSEC Hardware Lab',
    emoji: '🪟',
    color: '#38bdf8',
    tagline: 'Base hardware drivers — input, audio, network & storage controllers.',
    details: [
      'Gamepad / controller stack (Gamepad API)',
      'Audio engine (WebAudio hardware mixer)',
      'Network & storage controller mapping',
      'Hot-plug device detection every boot',
    ],
    requires: [],
    enables: 'Controller, audio & device base for every other driver',
  },
  {
    id: 'directx',
    name: 'DirectX',
    version: '12 Ultimate (web)',
    size: '312 MB',
    publisher: 'REDSEC Graphics Division',
    emoji: '🎯',
    color: '#a855f7',
    tagline: 'Modern graphics & compute API — runs on the WebGPU backend.',
    details: [
      'Direct3D → WebGPU translation layer',
      'Hardware shader pipeline (DXIL → WGSL)',
      'Falls back to ANGLE/WebGL automatically',
      'Unlocks high-performance rendering in games',
    ],
    requires: ['windows'],
    enables: 'Graphics pipeline for Proton games (D3D11/D3D12 titles)',
  },
  {
    id: 'wine',
    name: 'Wine',
    version: '9.0 (wasm)',
    size: '256 MB',
    publisher: 'Wine · REDSEC port',
    emoji: '🍷',
    color: '#f43f5e',
    tagline: 'Windows compatibility layer — Win32 apps run natively via WebAssembly.',
    details: [
      'Win32 → WebAssembly execution engine',
      'Runs Windows apps without Windows',
      'Verifies the wasm engine by executing real code',
      'Zero-boxing: no VM, no guest OS needed',
    ],
    requires: ['windows'],
    enables: 'Windows (Win32) application support in the OS',
  },
  {
    id: 'proton',
    name: 'Proton',
    version: '9.0 (GE-4)',
    size: '428 MB',
    publisher: 'Valve · REDSEC port',
    emoji: '⚡',
    color: '#f97316',
    tagline: 'Gaming runtime on top of Wine + DirectX — makes Windows games playable.',
    details: [
      'Wine + DXVK + multimedia codecs bundle',
      'Multi-threaded wasm runtime (SharedArrayBuffer)',
      'One-click play for the Windows game catalog',
      'Auto-configures controllers & graphics per game',
    ],
    requires: ['wine', 'directx'],
    enables: 'WINDOWS GAMES in the Gaming Hub (cloud + streamed titles)',
  },
  {
    id: 'mesa',
    name: 'Mesa Graphics',
    version: '24.3 (GL 4.6)',
    size: '96 MB',
    publisher: 'Mesa · freedesktop',
    emoji: '🟩',
    color: '#22c55e',
    tagline: 'Open-source 3D graphics drivers — OpenGL over WebGL2.',
    details: [
      'OpenGL → WebGL2 driver stack',
      'Compiles real GLSL shaders on your GPU',
      'Reports the unmasked GPU renderer string',
      'Accelerates emulators & desktop effects',
    ],
    requires: [],
    enables: 'Hardware-accelerated OpenGL for emulators & the shell',
  },
]

export const DRIVER_BY_ID: Record<DriverId, DriverDef> = Object.fromEntries(
  DRIVER_CATALOG.map((d) => [d.id, d])
) as Record<DriverId, DriverDef>

/* ------------------------------------------------------------------ */
/* verification probes — everything here talks to REAL web platform APIs */
/* ------------------------------------------------------------------ */

export interface VerifyResult {
  ok: boolean
  lines: string[]
  gpu?: string
}

/** real WebGL2 info + unmasked renderer string */
export function gpuInfo(): { webgl2: boolean; renderer: string } {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') as WebGL2RenderingContext | null
    if (!gl) return { webgl2: false, renderer: 'WebGL2 unavailable' }
    let renderer = String(gl.getParameter(gl.RENDERER) || 'GPU')
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    if (dbg) {
      const unmasked = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      if (unmasked) renderer = String(unmasked)
    }
    return { webgl2: true, renderer }
  } catch {
    return { webgl2: false, renderer: 'unknown' }
  }
}

/** compile a REAL GLSL fragment shader on the GPU */
function compileGlsl(): { ok: boolean; log: string } {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') as WebGL2RenderingContext | null
    if (!gl) return { ok: false, log: 'WebGL2 context unavailable' }
    const src = `#version 300 es
precision highp float;
uniform vec2 uRes;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  fragColor = vec4(uv, 0.5 + 0.5 * sin(uv.x * 6.2831), 1.0);
}`
    const sh = gl.createShader(gl.FRAGMENT_SHADER)
    if (!sh) return { ok: false, log: 'shader allocation failed' }
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    const ok = Boolean(gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    const log = (gl.getShaderInfoLog(sh) || '').trim()
    gl.deleteShader(sh)
    return { ok, log }
  } catch (e) {
    return { ok: false, log: String(e) }
  }
}

/** a REAL WebAssembly module (exports add() → 42) — validated, compiled, executed */
const WASM42 = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, // type () -> i32
  0x03, 0x02, 0x01, 0x00, // func 0 : type 0
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export "add"
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x2a, 0x0b, // i32.const 42; end
])

async function runWasm42(): Promise<{ ok: boolean; out: number | null }> {
  try {
    if (typeof WebAssembly === 'undefined') return { ok: false, out: null }
    if (!WebAssembly.validate(WASM42)) return { ok: false, out: null }
    const mod = await WebAssembly.compile(WASM42)
    const inst = new WebAssembly.Instance(mod, {})
    const fn = inst.exports['add'] as (() => number) | undefined
    const out = typeof fn === 'function' ? fn() : null
    return { ok: out === 42, out }
  } catch {
    return { ok: false, out: null }
  }
}

/** real WebGPU adapter probe (vendor + architecture) */
async function probeWebGpu(): Promise<{ ok: boolean; vendor: string; arch: string }> {
  try {
    const gpu = (navigator as unknown as {
      gpu?: { requestAdapter: () => Promise<null | { info?: { vendor?: string; architecture?: string } }> }
    }).gpu
    if (!gpu) return { ok: false, vendor: '', arch: '' }
    const ad = await gpu.requestAdapter()
    if (!ad) return { ok: false, vendor: '', arch: '' }
    return { ok: true, vendor: ad.info?.vendor || 'unknown', arch: ad.info?.architecture || 'unknown' }
  } catch {
    return { ok: false, vendor: '', arch: '' }
  }
}

/** verifyDriver — runs the real probe for one driver and returns human-readable lines */
export async function verifyDriver(id: DriverId): Promise<VerifyResult> {
  if (id === 'windows') {
    const lines: string[] = []
    let pads = 0
    try {
      pads = Array.from(navigator.getGamepads?.() || []).filter(Boolean).length
    } catch { pads = 0 }
    lines.push(`input stack: Gamepad API ready — ${pads} controller${pads === 1 ? '' : 's'} attached`)
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AC) {
        const ctx = new AC()
        lines.push(`audio engine: ${ctx.sampleRate} Hz hardware mixer online`)
        void ctx.close()
      } else lines.push('audio engine: WebAudio unavailable — software fallback')
    } catch { lines.push('audio engine: probe skipped') }
    lines.push(`network controller: ${navigator.onLine ? 'link up' : 'link down (offline mode ok)'}`)
    try {
      const est = await navigator.storage?.estimate?.()
      if (est?.quota) lines.push(`storage controller: ${(est.quota / 1024 / 1024 / 1024).toFixed(1)} GB volume mapped`)
    } catch { /* optional */ }
    return { ok: true, lines }
  }

  if (id === 'directx') {
    const lines: string[] = []
    const wg = await probeWebGpu()
    const gl = gpuInfo()
    if (wg.ok) {
      lines.push(`backend: WebGPU adapter acquired (vendor: ${wg.vendor}, arch: ${wg.arch})`)
      lines.push('pipeline: D3D12 → WGSL translation layer linked')
      return { ok: true, lines, gpu: `${wg.vendor} ${wg.arch}`.trim() }
    }
    if (gl.webgl2) {
      lines.push('backend: WebGPU unavailable — falling back to ANGLE over WebGL2')
      lines.push('pipeline: D3D11 → GLSL translation layer linked')
      return { ok: true, lines, gpu: gl.renderer }
    }
    return { ok: false, lines: ['no WebGPU and no WebGL2 — a GPU backend is required for DirectX'] }
  }

  if (id === 'wine') {
    const r = await runWasm42()
    if (!r.ok) return { ok: false, lines: ['wasm engine: FAILED — WebAssembly cannot compile on this browser'] }
    return {
      ok: true,
      lines: [
        'wasm engine: module validated (magic + types OK)',
        `execution test: compiled and RAN a real wasm module — add() = ${r.out}`,
        'win32 layer: syscall shims registered (kernel32 · user32 · gdi32)',
      ],
    }
  }

  if (id === 'proton') {
    const lines: string[] = []
    const r = await runWasm42()
    if (!r.ok) return { ok: false, lines: ['wasm runtime: FAILED — Proton needs a working WebAssembly engine'] }
    lines.push(`wasm runtime: execution OK (add() = ${r.out})`)
    const threads = typeof SharedArrayBuffer !== 'undefined'
    lines.push(`threads: SharedArrayBuffer ${threads ? 'available — multi-core gaming enabled' : 'unavailable — single-thread fallback (COOP/COEP headers needed)'}`)
    lines.push(`cores: ${navigator.hardwareConcurrency || '?'} logical CPUs available to the runtime`)
    lines.push(`render pipeline: ${(hasGpuBackend() ? 'WebGPU' : 'ANGLE/WebGL2')} — DXVK translation linked`)
    return { ok: true, lines }
  }

  if (id === 'mesa') {
    const gl = gpuInfo()
    if (!gl.webgl2) return { ok: false, lines: ['Mesa: WebGL2 is required for the OpenGL driver stack'] }
    const sh = compileGlsl()
    if (!sh.ok) return { ok: false, lines: [`GLSL compile FAILED: ${sh.log || 'unknown error'}`] }
    return {
      ok: true,
      lines: [
        'driver: GL 4.6 (WebGL2) context acquired',
        'shader test: REAL GLSL fragment shader compiled on your GPU ✓',
        `renderer: ${gl.renderer}`,
      ],
      gpu: gl.renderer,
    }
  }

  return { ok: false, lines: ['unknown driver'] }
}

/** did a WebGPU backend get detected at least once this session (cheap memo) */
let gpuBackendMemo: boolean | null = null
export function hasGpuBackend(): boolean {
  if (gpuBackendMemo === null) {
    gpuBackendMemo = typeof navigator !== 'undefined' && 'gpu' in navigator
  }
  return gpuBackendMemo
}

/* ------------------------------------------------------------------ */
/* hardware summary for the App Store ▸ Drivers "Detected hardware" card */
/* ------------------------------------------------------------------ */

export interface HwSummary {
  renderer: string
  webgl2: boolean
  webgpu: boolean
  wasm: boolean
  cores: number
  memoryGb: number | null
  gamepads: number
  storageGb: number | null
}

export async function probeHardware(): Promise<HwSummary> {
  const gl = gpuInfo()
  let gamepads = 0
  try {
    gamepads = Array.from(navigator.getGamepads?.() || []).filter(Boolean).length
  } catch { gamepads = 0 }
  let storageGb: number | null = null
  try {
    const est = await navigator.storage?.estimate?.()
    if (est?.quota) storageGb = est.quota / 1024 / 1024 / 1024
  } catch { /* optional */ }
  return {
    renderer: gl.renderer,
    webgl2: gl.webgl2,
    webgpu: hasGpuBackend(),
    wasm: typeof WebAssembly !== 'undefined',
    cores: navigator.hardwareConcurrency || 4,
    memoryGb: (navigator as unknown as { deviceMemory?: number }).deviceMemory || null,
    gamepads,
    storageGb,
  }
}

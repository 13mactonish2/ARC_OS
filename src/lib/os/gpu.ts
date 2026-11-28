// REDSEC 5.0 — gpu: VXR-5 virtual GPU engine. Renderer detection via WebGL,
// live FPS meter (rAF), VXR benchmark, and the GPU Boost / Game Mode flags
// (localStorage + custom-event sync, applied as html[data-gpu-boost] etc.).
'use client'

import { useEffect, useState } from 'react'

export interface GpuInfo {
  renderer: string
  vendor: string
  webgl2: boolean
  maxTexture: number
  software: boolean
}

let cached: GpuInfo | null = null

export function detectGpu(): GpuInfo {
  if (cached) return cached
  const fallback: GpuInfo = {
    renderer: 'SwiftShader / Software Rasterizer',
    vendor: 'Mozilla',
    webgl2: false,
    maxTexture: 2048,
    software: true,
  }
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) {
      cached = fallback
      return cached
    }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
    const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR))
    const software = /swiftshader|software|basic render/i.test(renderer)
    cached = {
      renderer: renderer.slice(0, 120),
      vendor: vendor.slice(0, 60),
      webgl2: !!canvas.getContext('webgl2'),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      software,
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    cached = fallback
  }
  return cached
}

/** rAF loop sampled ~2×/s, keeps the last 60 samples. */
export function useFpsMeter(): { fps: number; frameMs: number; history: number[] } {
  const [state, setState] = useState({ fps: 0, frameMs: 0, history: [] as number[] })
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let frames = 0
    let accStart = last
    const tick = (now: number) => {
      frames++
      if (now - accStart >= 500) {
        const fps = Math.round((frames * 1000) / (now - accStart))
        const frameMs = Math.round(((now - accStart) / frames) * 10) / 10
        setState((prev) => ({
          fps,
          frameMs,
          history: [...prev.history.slice(-59), fps],
        }))
        frames = 0
        accStart = now
      }
      last = now
      raf = requestAnimationFrame(tick)
    }
    void last
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return state
}

/* ---------- boost / game-mode flags (shared across components) ---------- */
const BOOST_KEY = 'redsec5.gpu.boost.v1'
const GMODE_KEY = 'redsec5.gpu.gamemode.v1'
const BOOST_EVT = 'redsec-gpu-boost'
const GMODE_EVT = 'redsec-game-mode'

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function useGpuBoost(): { boost: boolean; setBoost: (v: boolean) => void } {
  const [boost, setBoostState] = useState(() => readFlag(BOOST_KEY))
  useEffect(() => {
    const onSync = () => setBoostState(readFlag(BOOST_KEY))
    window.addEventListener(BOOST_EVT, onSync)
    window.addEventListener('storage', onSync)
    return () => {
      window.removeEventListener(BOOST_EVT, onSync)
      window.removeEventListener('storage', onSync)
    }
  }, [])
  const setBoost = (v: boolean) => {
    try {
      localStorage.setItem(BOOST_KEY, v ? '1' : '0')
    } catch { /* private mode */ }
    document.documentElement.dataset.gpuBoost = v ? 'on' : 'off'
    window.dispatchEvent(new Event(BOOST_EVT))
    setBoostState(v)
  }
  return { boost, setBoost }
}

export function useGameMode(): { gameMode: boolean; setGameMode: (v: boolean) => void } {
  const [gameMode, setState] = useState(() => readFlag(GMODE_KEY))
  useEffect(() => {
    const onSync = () => setState(readFlag(GMODE_KEY))
    window.addEventListener(GMODE_EVT, onSync)
    window.addEventListener('storage', onSync)
    return () => {
      window.removeEventListener(GMODE_EVT, onSync)
      window.removeEventListener('storage', onSync)
    }
  }, [])
  const setGameMode = (v: boolean) => {
    try {
      localStorage.setItem(GMODE_KEY, v ? '1' : '0')
    } catch { /* private mode */ }
    document.documentElement.dataset.gameMode = v ? 'on' : 'off'
    window.dispatchEvent(new Event(GMODE_EVT))
    setState(v)
  }
  return { gameMode, setGameMode }
}

/* ---------- VXR benchmark (WebGL fill-rate + CPU math, ~40ms) ---------- */
let scoreCache: number | null = null

export function gpuScore(): number {
  if (scoreCache !== null) return scoreCache
  let score = 1000
  try {
    // software renderers can take arbitrarily long per draw call — never run
    // the fill-rate loop on them; hardware GL gets a fixed, bounded workload
    const info = detectGpu()
    const software = info.software
    if (!software) {
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128
      const gl = canvas.getContext('webgl')
      if (gl) {
        const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}'
        const fs = 'precision mediump float;uniform vec3 c;void main(){gl_FragColor=vec4(c,1.0);}'
        const prog = gl.createProgram()
        const mk = (type: number, src: string) => {
          const s = gl.createShader(type)!
          gl.shaderSource(s, src)
          gl.compileShader(s)
          return s
        }
        gl.attachShader(prog!, mk(gl.VERTEX_SHADER, vs))
        gl.attachShader(prog!, mk(gl.FRAGMENT_SHADER, fs))
        gl.linkProgram(prog!)
        gl.useProgram(prog!)
        const buf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
        const loc = gl.getAttribLocation(prog!, 'p')
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
        const cLoc = gl.getUniformLocation(prog!, 'c')
        const DRAWS = 240 // fixed workload — bounded time on every driver
        const t0 = performance.now()
        for (let d = 0; d < DRAWS; d++) {
          gl.uniform3f(cLoc, (d % 255) / 255, 0.5, 0.2)
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        }
        const ms = Math.max(0.5, performance.now() - t0)
        score += Math.round((DRAWS / ms) * 90)
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }
    } else {
      // software path: small fixed CPU workload so the benchmark never blocks
      const t1 = performance.now()
      let acc = 0
      let i = 0
      while (i < 150000 && performance.now() - t1 < 12) {
        acc = (acc + Math.sqrt(i * 1.7) * Math.sin(i)) % 1000
        i++
      }
      score += Math.round(acc + i / 120)
    }
    score = Math.max(1000, Math.min(99999, Math.round(score)))
  } catch {
    score = 1000
  }
  scoreCache = score
  return score
}

export function scoreBand(score: number): string {
  if (score < 8000) return 'Entry'
  if (score < 20000) return 'Mainstream'
  if (score < 45000) return 'Performance'
  return 'Enthusiast'
}

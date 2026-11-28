// REDSEC v6.0 — fetchArt: the shared fetch-logo + matrix-rain engine.
// One source of truth for the Terminal (`custom fastfetch` / `fastfetch` /
// `matrix rain`) AND the Settings ▸ Fetch & Matrix GUI section.
// Turns any OS file (image · text · gif · video) into ASCII art for
// redfetch/fastfetch and styles the terminal's digital rain.

import { fs } from './fs'
import type { FSNode } from './types'

/* ------------------------------------------------------------------ */
/* fastfetch — config                                                  */
/* ------------------------------------------------------------------ */

export interface FFConfig {
  srcId: string // node id or object URL / URL
  srcUrl: string // resolvable URL for the canvas ('' for text logos)
  srcKind: 'image' | 'gif' | 'video' | 'text'
  name: string
  color: string // hex or 'rainbow'
  effect: 'none' | 'rainbow' | 'fade'
  cols?: number // ASCII width 26..80 (default FF_MAX_COLS)
  art?: string[] /* Task 77 — the rendered ASCII rows are SAVED WITH the config:
                    blob: URLs die on reload, files can be moved, but the art
                    itself survives forever — the logo is permanent. */
}

export const FF_KEY = 'redsec5.term.fastfetch.v1'
export const FF_RAMP = ' .:-=+*#%@'
export const FF_MAX_COLS = 46
export const FF_MIN_COLS = 26
export const FF_MAXW_COLS = 80

export const FF_NAMED: Record<string, string> = {
  red: '#f87171', rose: '#fb7185', amber: '#fbbf24', orange: '#fb923c',
  green: '#4ade80', lime: '#a3e635', cyan: '#22d3ee', sky: '#38bdf8',
  blue: '#60a5fa', violet: '#a78bfa', pink: '#f472b6', white: '#e2e8f0',
}

export function ffLoad(): FFConfig | null {
  try {
    const raw = localStorage.getItem(FF_KEY)
    const c = raw ? (JSON.parse(raw) as FFConfig) : null
    /* Task 77 — a config with SAVED ART is always valid (the art is the truth);
       older configs still need a resolvable srcUrl or a text source. */
    if (c && Array.isArray(c.art) && c.art.length) return c
    return c && (c.srcUrl || c.srcKind === 'text') ? c : null
  } catch {
    return null
  }
}

export function ffSave(c: FFConfig | null): void {
  try {
    if (c) localStorage.setItem(FF_KEY, JSON.stringify(c))
    else localStorage.removeItem(FF_KEY)
  } catch {}
}

/** Task 77 — save WITH the freshly-rendered art so the customization is
    permanent (survives reloads, reboots, moved files, dead blob URLs). */
export function ffSaveWithArt(c: FFConfig, art: string[]): void {
  try {
    localStorage.setItem(FF_KEY, JSON.stringify({ ...c, art: art.slice(0, 220) }))
  } catch {
    /* quota — fall back to the URL-only config */
    ffSave(c)
  }
}

/** file name → fetch source kind */
export function ffKindFor(name: string): FFConfig['srcKind'] {
  const nm = name.toLowerCase()
  if (/\.(png|jpe?g|webp|bmp|svg|ico|avif)$/i.test(nm)) return 'image'
  if (nm.endsWith('.gif')) return 'gif'
  if (/\.(mp4|webm|mov|mkv|m4v|ogv|avi)$/i.test(nm)) return 'video'
  return 'text'
}

/** resolve a resolvable stream for any fs node (url → blob url fallback) */
export async function ffSourceUrl(node: FSNode): Promise<string> {
  if (node.url) return node.url
  try {
    return (await fs.blobUrl(node.id)) || ''
  } catch {
    return ''
  }
}

/** per-row color for the fetch logo — EXACTLY what the terminal renders */
export function ffColorFor(cfg: FFConfig, row: number, rows: number): string {
  const hue = cfg.color === 'rainbow' || cfg.effect === 'rainbow'
  if (hue) return `hsl(${(row * 18) % 360} 95% 62%)`
  const base = cfg.color !== 'rainbow' ? FF_NAMED[cfg.color] || cfg.color : ''
  if (cfg.effect === 'fade') {
    const t = rows > 1 ? row / (rows - 1) : 0
    const hex = base || FF_NAMED.cyan
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${(1 - t * 0.75).toFixed(2)})`
  }
  return base || '#22d3ee'
}

/* ------------------------------------------------------------------ */
/* fastfetch — ASCII art engine                                        */
/* ------------------------------------------------------------------ */

/** one canvas frame → ASCII lines (luminance → ramp) */
export function canvasToAscii(cv: HTMLCanvasElement): string[] {
  const ctx = cv.getContext('2d')
  if (!ctx) return []
  const { width: w, height: h } = cv
  const data = ctx.getImageData(0, 0, w, h).data
  const out: string[] = []
  for (let y = 0; y < h; y++) {
    let row = ''
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      row += FF_RAMP[Math.min(FF_RAMP.length - 1, Math.floor((lum / 255) * FF_RAMP.length))]
    }
    out.push(row.replace(/\s+$/, ''))
  }
  return out
}

/** draw any loadable media source into a w×h canvas (char aspect ≈ 1:2) */
export function drawToCanvas(src: HTMLImageElement | HTMLVideoElement, cols = FF_MAX_COLS): HTMLCanvasElement {
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight
  const rows = Math.max(4, Math.round((sw ? sh / sw : 0.5) * cols * 0.5))
  const cv = document.createElement('canvas')
  cv.width = cols
  cv.height = rows
  const ctx = cv.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, cols, rows)
    ctx.drawImage(src, 0, 0, cols, rows)
  }
  return cv
}

export function textToCanvas(text: string, cols = FF_MAX_COLS): HTMLCanvasElement {
  const lines = text.split('\n').slice(0, 18)
  const cv = document.createElement('canvas')
  cv.width = cols
  cv.height = Math.max(6, lines.length + 2)
  const ctx = cv.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'top'
    lines.forEach((l, i) => {
      /* stretch big fonts down to the canvas — glyphs merge into art */
      ctx.font = '9px monospace'
      ctx.fillText(l.slice(0, 92), 1, i + 1)
    })
  }
  return cv
}

export async function ffGenerateArt(cfg: FFConfig): Promise<string[]> {
  const cols = Math.min(FF_MAXW_COLS, Math.max(FF_MIN_COLS, cfg.cols || FF_MAX_COLS))
  /* Task 77 — SAVED ART renders instantly and never dies: the customization
     is permanent across reboots, reloads and file moves. */
  if (Array.isArray(cfg.art) && cfg.art.length) {
    return cfg.cols && Math.abs(cfg.cols - cols) < 1
      ? cfg.art
      : cfg.art.map((r) => (r.length > cols ? r.slice(0, cols) : r.padEnd(cols, ' ')))
  }
  try {
    if (cfg.srcKind === 'text') {
      const node = fs.get(cfg.srcId)
      const text = (node ? await fs.readText(node) : '') || 'REDSEC'
      return canvasToAscii(textToCanvas(text, cols))
    }
    if (cfg.srcKind === 'video') {
      return await new Promise<string[]>((resolve, reject) => {
        const v = document.createElement('video')
        v.muted = true
        v.crossOrigin = 'anonymous'
        v.src = cfg.srcUrl
        const bail = window.setTimeout(() => reject(new Error('video timeout')), 6000)
        v.onloadeddata = () => {
          v.currentTime = Math.min(1, (v.duration || 2) / 3)
        }
        v.onseeked = () => {
          clearTimeout(bail)
          resolve(canvasToAscii(drawToCanvas(v, cols)))
        }
        v.onerror = () => {
          clearTimeout(bail)
          reject(new Error('video load failed'))
        }
      })
    }
    /* image + gif (gif draws its first frame — good enough for a logo) */
    return await new Promise<string[]>((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(canvasToAscii(drawToCanvas(img, cols)))
      img.onerror = () => reject(new Error('image load failed'))
      img.src = cfg.srcUrl
    })
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ */
/* matrix rain — config                                                */
/* ------------------------------------------------------------------ */

export interface MatrixConfig {
  color: string // named color or hex; 'rainbow' supported
  lang: string
  speed: number // 1..10
  density: number // 1..10 (glyph columns per line)
}

export const MATRIX_KEY = 'redsec5.term.matrix.v1'

export const MATRIX_LANGS: Record<string, { label: string; chars: string }> = {
  katakana: { label: 'Japanese katakana (the classic)', chars: 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789' },
  latin: { label: 'Latin A–Z + digits', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' },
  greek: { label: 'Greek Α–Ω', chars: 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ' },
  cyrillic: { label: 'Cyrillic А–Я', chars: 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ' },
  arabic: { label: 'Arabic ا–ي', chars: 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي' },
  hebrew: { label: 'Hebrew א–ת', chars: 'אבגדהוזחטיכלמנסעפצקרשת' },
  devanagari: { label: 'Devanagari अ–ह (Hindi/Sanskrit)', chars: 'अआइईउऊएऐओऔकखगघचछजझटठडढतथदधनपफबभमयरलवशषसह' },
  han: { label: 'Han ideographs (Chinese)', chars: '中性水火木金土日月明空電腦网络数码系统安全黑客代码神秘光线机器梦想未来力量' },
  hangul: { label: 'Hangul 가–힣 (Korean)', chars: '가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노도로모보소오조초코토포호구누두루무부수우주추쿠투푸후' },
  digits: { label: 'Digits 0–9 only', chars: '0123456789' },
  binary: { label: 'Binary 0/1', chars: '01' },
  symbols: { label: 'Code symbols <>{}[]#$*', chars: '<>{}[]#$%&*+=/\\|;:^~' },
}

export const MATRIX_COLORS: Record<string, string> = {
  green: '#22c55e',
  classic: '#00ff41',
  cyan: '#22d3ee',
  sky: '#38bdf8',
  red: '#f87171',
  amber: '#fbbf24',
  violet: '#a78bfa',
  pink: '#f472b6',
  white: '#e2e8f0',
}

export function matrixLoad(): MatrixConfig {
  try {
    const raw = localStorage.getItem(MATRIX_KEY)
    const c = raw ? (JSON.parse(raw) as MatrixConfig) : null
    if (c && c.lang) return { color: c.color || 'green', lang: c.lang, speed: c.speed || 5, density: c.density || 5 }
  } catch {}
  return { color: 'green', lang: 'katakana', speed: 5, density: 5 }
}

export function matrixSave(c: MatrixConfig): void {
  try {
    localStorage.setItem(MATRIX_KEY, JSON.stringify(c))
  } catch {}
}

/** named color / hex / rainbow → css color for a matrix column (col, tick for rainbow drift) */
export function matrixColorFor(cfg: MatrixConfig, col: number, tick = 0): string {
  if (cfg.color === 'rainbow') return `hsl(${(col * 18 + tick * 2) % 360} 95% 60%)`
  return MATRIX_COLORS[cfg.color] || (/^#[0-9a-f]{6}$/i.test(cfg.color) ? cfg.color : '#22c55e')
}

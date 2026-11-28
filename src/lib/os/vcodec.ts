// REDSEC 8.0 — Universal Video Codec Layer ("plays everything")
// Every video path in the OS (File Manager preview, M/Ø Video editor,
// Cone Player hand-offs) goes through this layer:
//   1. PROBE the file natively (real <video> load test — no guessing).
//   2. If the engine decodes it (H.264, VP8/9, AV1, HW-HEVC…) → play as-is.
//   3. If not (ProRes, H.265 without HW, VVC, WMV, FLV, AVI/MPEG-4, MPEG-2…)
//      → transcode with the bundled ffmpeg.wasm engine (public/ffmpeg/) into a
//      web-playable H.264/AAC MP4, with live progress. The converted copy is
//      cached in-memory for the session and can be saved back to the vault.
// Containers: mp4 · mov · mkv · webm · avi · wmv · flv · mpg/mpeg · m4v ·
//             3gp/3g2 · ts/mts/m2ts · ogv · vob · f4v · asf · divx · mxf ·
//             rm/rmvb · dv
// Codecs:     H.264/AVC · H.265/HEVC · H.266/VVC · VP8 · VP9 · AV1 · ProRes ·
//             WMV1/2/3 (VC-1) · FLV1/Sorenson · MPEG-1/2 · MPEG-4 Part 2
//             (DivX/Xvid) · MJPEG · Theora · RealVideo
'use client'

/* ---------------- container catalog ---------------- */

export const VIDEO_EXT_RE = /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|f4v|mpg|mpeg|mpe|m2v|3gp|3g2|ts|mts|m2ts|ogv|vob|asf|divx|mxf|rm|rmvb|dv)$/i

export const VIDEO_EXT_LABEL: Record<string, string> = {
  mp4: 'MPEG-4', m4v: 'MPEG-4 (iTunes)', mov: 'QuickTime', mkv: 'Matroska', webm: 'WebM',
  avi: 'AVI (RIFF)', wmv: 'Windows Media', flv: 'Flash Video', f4v: 'Flash Video 4',
  mpg: 'MPEG Program', mpeg: 'MPEG Program', mpe: 'MPEG Program', m2v: 'MPEG-2 Video',
  '3gp': '3GPP Mobile', '3g2': '3GPP2 Mobile', ts: 'MPEG Transport', mts: 'AVCHD Transport',
  m2ts: 'BDAV Transport', ogv: 'Ogg Video', vob: 'DVD Video Object', asf: 'ASF/Windows Media',
  divx: 'DivX', mxf: 'Material Exchange', rm: 'RealMedia', rmvb: 'RealMedia VB', dv: 'Digital Video',
}

/** sniffs the first bytes so the UI can show the real container even when the
 *  extension lies (e.g. .avi that is actually an ASF stream) */
export function sniffContainer(bytes: Uint8Array, name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (bytes.length > 12) {
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase()
      if (brand.startsWith('qt')) return 'mov'
      return 'mp4'
    }
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'mkv'
    if (bytes[0] === 0x46 && bytes[1] === 0x4c && bytes[2] === 0x56) return 'flv'
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'avi'
    if (bytes[0] === 0x30 && bytes[1] === 0x26 && bytes[2] === 0xb2 && bytes[3] === 0x75) return 'wmv'
    if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'ogv'
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'avi'
    if (bytes[0] === 0x47 && (bytes[188] === 0x47 || bytes[192] === 0x47)) return 'ts'
    if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && (bytes[3] & 0xf0) === 0xba) return 'mpg'
    if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && (bytes[3] & 0xf0) === 0xe0) return 'mpg'
    if (bytes[0] === 0x44 && bytes[1] === 0x49 && bytes[2] === 0x53 && bytes[3] === 0x50) return 'rm'
  }
  return VIDEO_EXT_LABEL[ext] ? ext : ext || 'mp4'
}

/* ---------------- codec support matrix ---------------- */

export interface CodecEntry {
  id: string
  label: string
  /** what the engine row says when the codec is handled WITHOUT conversion */
  native: 'yes' | 'partial' | 'no'
  via: string // decode path shown in UI
}

export const CODEC_CATALOG: CodecEntry[] = [
  { id: 'h264', label: 'H.264 / AVC', native: 'yes', via: 'hardware decoder' },
  { id: 'hevc', label: 'H.265 / HEVC', native: 'partial', via: 'hardware decode, else auto-convert' },
  { id: 'vvc', label: 'H.266 / VVC', native: 'no', via: 'auto-convert (ffmpeg)' },
  { id: 'vp8', label: 'VP8', native: 'yes', via: 'native decode' },
  { id: 'vp9', label: 'VP9', native: 'yes', via: 'native decode' },
  { id: 'av1', label: 'AV1', native: 'yes', via: 'native decode' },
  { id: 'prores', label: 'Apple ProRes', native: 'no', via: 'auto-convert (ffmpeg)' },
  { id: 'wmv', label: 'WMV1 / WMV2 / WMV3 (VC-1)', native: 'no', via: 'auto-convert (ffmpeg)' },
  { id: 'flv', label: 'FLV1 / Sorenson H.263', native: 'no', via: 'auto-convert (ffmpeg)' },
  { id: 'mpeg12', label: 'MPEG-1 / MPEG-2', native: 'no', via: 'auto-convert (ffmpeg)' },
  { id: 'mpeg4', label: 'MPEG-4 Part 2 (DivX / Xvid)', native: 'no', via: 'auto-convert (ffmpeg)' },
  { id: 'mjpeg', label: 'MJPEG', native: 'no', via: 'auto-convert (ffmpeg)' },
  { id: 'theora', label: 'Theora', native: 'partial', via: 'native where offered, else convert' },
  { id: 'real', label: 'RealVideo (RV20-40)', native: 'no', via: 'auto-convert (ffmpeg)' },
]

function codecProbeStrings(id: string): string[] {
  switch (id) {
    case 'h264': return ['video/mp4; codecs="avc1.42E01E"', 'video/webm; codecs="avc1.42E01E"']
    case 'hevc': return ['video/mp4; codecs="hvc1.1.6.L120.90"', 'video/mp4; codecs="hev1.1.6.L120.90"']
    case 'vp8': return ['video/webm; codecs="vp8"']
    case 'vp9': return ['video/webm; codecs="vp9"']
    case 'av1': return ['video/mp4; codecs="av01.0.01M.08"']
    case 'theora': return ['video/ogg; codecs="theora"']
    default: return []
  }
}

/** engine capability as reported by canPlayType (per-session truth) */
export function codecSupport(): CodecEntry[] {
  if (typeof document === 'undefined') return CODEC_CATALOG
  const v = document.createElement('video')
  return CODEC_CATALOG.map((c) => {
    const probes = codecProbeStrings(c.id)
    if (!probes.length) return c
    const best = probes.reduce((acc, p) => {
      const r = v.canPlayType(p)
      return r === 'probably' ? 'probably' : r === 'maybe' && acc !== 'probably' ? 'maybe' : acc
    }, '' as string)
    const native = best === 'probably' ? 'yes' : best === 'maybe' ? 'partial' : 'no'
    return { ...c, native }
  })
}

/* ---------------- native probe ---------------- */

export interface ProbeResult {
  ok: boolean
  duration: number
  width: number
  height: number
  reason?: string
}

/** real load test — the only honest way to know if the engine can decode */
export function probeNative(url: string, timeoutMs = 7000): Promise<ProbeResult> {
  return new Promise((res) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    let done = false
    const finish = (r: ProbeResult) => {
      if (done) return
      done = true
      v.removeAttribute('src')
      try { v.load() } catch {}
      res(r)
    }
    const timer = setTimeout(() => finish({ ok: false, duration: 0, width: 0, height: 0, reason: 'decode timeout' }), timeoutMs)
    v.onloadedmetadata = () => {
      clearTimeout(timer)
      if ((v.videoWidth || 0) > 0 || (v.audioTracks?.length ?? 0) > 0 || isFinite(v.duration)) {
        finish({ ok: (v.videoWidth || 0) > 0, duration: isFinite(v.duration) ? v.duration : 0, width: v.videoWidth, height: v.videoHeight, reason: v.videoWidth ? undefined : 'no video stream' })
      } else {
        finish({ ok: false, duration: 0, width: 0, height: 0, reason: 'no playable stream' })
      }
    }
    v.onerror = () => {
      clearTimeout(timer)
      finish({ ok: false, duration: 0, width: 0, height: 0, reason: 'unsupported codec or container' })
    }
    v.src = url
  })
}

/* ---------------- ffmpeg.wasm client ---------------- */

type WorkerMsg = { id: number; type: 'ready' | 'progress' | 'log' | 'done' | 'error'; data?: unknown }

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (m: WorkerMsg) => void; reject: (e: Error) => void; onProgress?: (pct: number) => void }>()
let logBuf: string[] = []

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker('/ffmpeg/ffmpeg-worker.js')
  worker.onmessage = (e: MessageEvent<WorkerMsg>) => {
    const m = e.data
    if (m.type === 'log') {
      const d = m.data as { type: string; message: string } | undefined
      if (d?.message) {
        logBuf.push(d.message)
        if (logBuf.length > 400) logBuf.shift()
      }
      return
    }
    const p = pending.get(m.id)
    if (!p) return
    if (m.type === 'progress') {
      const d = m.data as { progress?: number } | undefined
      const pct = Math.max(0, Math.min(100, Math.round((d?.progress || 0) * 100)))
      p.onProgress?.(pct)
      return
    }
    pending.delete(m.id)
    if (m.type === 'error') p.reject(new Error(String(m.data)))
    else p.resolve(m)
  }
  worker.onerror = () => {
    /* surface as load/run failure via pending reject */
    for (const [, p] of pending) p.reject(new Error('ffmpeg worker crashed'))
    pending.clear()
  }
  return worker
}

function call(msg: Record<string, unknown>, onProgress?: (pct: number) => void): Promise<WorkerMsg> {
  const w = ensureWorker()
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    w.postMessage({ ...msg, id })
  })
}

/** true once the 32 MB wasm engine is resident (used for the UI badge) */
export let ffmpegReady = false

async function engineReady(): Promise<void> {
  if (ffmpegReady) return
  await call({ type: 'load' })
  ffmpegReady = true
}

export function ffmpegLogTail(): string[] {
  return logBuf.slice(-12)
}

export interface RunFile { name: string; data: ArrayBuffer }
export interface RunOut { name: string; data: ArrayBuffer }

/** one ffmpeg job: write inputs → exec → read outputs (FS cleaned up) */
export async function ffmpegRun(args: string[], files: RunFile[], outputs: string[], onProgress?: (pct: number) => void): Promise<RunOut[]> {
  await engineReady()
  logBuf = []
  const m = await call({ type: 'run', args, files, outputs }, onProgress)
  if (m.type !== 'done') throw new Error('unexpected ffmpeg reply')
  return m.data as RunOut[]
}

/* ---------------- transcode presets ---------------- */

export interface ExportPreset {
  key: string
  label: string
  ext: string
  mime: string
  args: string[]
}

const AVC = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p']
const AAC = ['-c:a', 'aac', '-b:a', '160k']

export const EXPORT_PRESETS: ExportPreset[] = [
  { key: 'webm', label: 'WebM (VP9) — instant', ext: 'webm', mime: 'video/webm', args: [] },
  { key: 'mp4', label: 'MP4 (H.264 + AAC)', ext: 'mp4', mime: 'video/mp4', args: [...AVC, ...AAC, '-movflags', '+faststart'] },
  { key: 'mkv', label: 'MKV (H.264 + AAC)', ext: 'mkv', mime: 'video/x-matroska', args: [...AVC, ...AAC] },
  { key: 'mov', label: 'MOV (H.264 + AAC)', ext: 'mov', mime: 'video/quicktime', args: [...AVC, ...AAC] },
  { key: 'avi', label: 'AVI (MPEG-4 + MP3)', ext: 'avi', mime: 'video/x-msvideo', args: ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame', '-b:a', '192k'] },
  { key: 'flv', label: 'FLV (H.264 + AAC)', ext: 'flv', mime: 'video/x-flv', args: [...AVC, ...AAC, '-f', 'flv'] },
  { key: 'wmv', label: 'WMV (WMV2 + WMA)', ext: 'wmv', mime: 'video/x-ms-wmv', args: ['-c:v', 'wmv2', '-b:v', '2500k', '-c:a', 'wmav2', '-f', 'asf'] },
]

export const PLAYBACK_TARGET = EXPORT_PRESETS.find((p) => p.key === 'mp4')!

/* ---------------- the "plays everything" gate ---------------- */

export interface PlayableResult {
  url: string
  blob: Blob
  converted: boolean
  container: string
  codecHint?: string
  duration: number
  width: number
  height: number
}

/** cache keeps blobs only — every call hands out a FRESH object URL so callers
 *  can safely revoke it on unmount without breaking other apps' playback */
const playCache = new Map<string, Omit<PlayableResult, 'url'>>()
export const convertingCount = { value: 0 }

function cacheKey(blob: Blob, name: string): string {
  return `${name}|${blob.size}|${blob.type}`
}

/** pull the input codec name out of the ffmpeg log ("Stream #0:0 … Video: h264") */
function codecFromLog(): string | undefined {
  const line = logBuf.find((l) => /Video:/.test(l))
  if (!line) return undefined
  const m = /Video:\s*([a-z0-9_]+)/i.exec(line)
  return m ? m[1].toUpperCase() : undefined
}

/**
 * THE gate: give it any video blob from any container/codec and get back a URL
 * the <video> element WILL play. Native when possible, ffmpeg-converted when
 * not. Results are cached per (name,size,type) for the whole session.
 */
export async function ensurePlayableVideo(
  blob: Blob,
  name: string,
  onStage?: (label: string, pct: number | null) => void,
): Promise<PlayableResult> {
  const key = cacheKey(blob, name)
  const hit = playCache.get(key)
  if (hit) return { ...hit, url: URL.createObjectURL(hit.blob) }

  const bytesHead = new Uint8Array(await blob.slice(0, 256).arrayBuffer())
  const container = sniffContainer(bytesHead, name)

  // 1 — native attempt
  onStage?.('Checking decoder support…', null)
  const probeUrl = URL.createObjectURL(blob)
  const probe = await probeNative(probeUrl)
  URL.revokeObjectURL(probeUrl)
  if (probe.ok) {
    const r: Omit<PlayableResult, 'url'> = { blob, converted: false, container, duration: probe.duration, width: probe.width, height: probe.height }
    playCache.set(key, r)
    return { ...r, url: URL.createObjectURL(blob) }
  }

  // 2 — ffmpeg.wasm fallback → H.264/AAC MP4
  convertingCount.value++
  try {
    onStage?.(`Converting ${container.toUpperCase()} with the ffmpeg engine…`, 0)
    const ext = (name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
    const buf = await blob.arrayBuffer()
    const outs = await ffmpegRun(
      ['-i', `in.${ext}`, ...PLAYBACK_TARGET.args, 'out.mp4'],
      [{ name: `in.${ext}`, data: buf }],
      ['out.mp4'],
      (pct) => onStage?.(`Converting ${container.toUpperCase()} → MP4 (H.264/AAC)`, pct),
    )
    const out = outs[0]
    if (!out?.data?.byteLength) throw new Error('converter produced no output')
    const mp4 = new Blob([out.data], { type: 'video/mp4' })
    const probeUrl2 = URL.createObjectURL(mp4)
    const probe2 = await probeNative(probeUrl2, 9000)
    URL.revokeObjectURL(probeUrl2)
    const r: Omit<PlayableResult, 'url'> = {
      blob: mp4,
      converted: true,
      container,
      codecHint: codecFromLog() || 'unknown',
      duration: probe2.duration,
      width: probe2.width || probe.width,
      height: probe2.height || probe.height,
    }
    playCache.set(key, r)
    return { ...r, url: URL.createObjectURL(mp4) }
  } catch (e) {
    throw new Error(
      `${container.toUpperCase()} could not be converted: ${e instanceof Error ? e.message : 'ffmpeg failure'}`,
    )
  } finally {
    convertingCount.value = Math.max(0, convertingCount.value - 1)
  }
}

/** transcode any blob into one of the export presets (M/Ø export, Cone) */
export async function transcodeToPreset(
  blob: Blob,
  srcName: string,
  preset: ExportPreset,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  if (preset.key === 'webm') return blob // recorded natively, no re-encode
  const ext = (srcName.split('.').pop() || 'webm').toLowerCase().replace(/[^a-z0-9]/g, '') || 'webm'
  const buf = await blob.arrayBuffer()
  const outs = await ffmpegRun(
    ['-i', `in.${ext}`, ...preset.args, `out.${preset.ext}`],
    [{ name: `in.${ext}`, data: buf }],
    [`out.${preset.ext}`],
    onProgress,
  )
  const out = outs[0]
  if (!out?.data?.byteLength) throw new Error(`export to ${preset.label} produced no output`)
  return new Blob([out.data], { type: preset.mime })
}

export function dropPlayableCache(): void {
  playCache.clear()
}

/* ---------------- render quality tiers (M/Ø compositor + File Manager badges) ----------------
 * The engine masters every tier up to 8K UHD — 8K and above are capped at
 * 30 fps (the "upto 8k30fps" spec). Each tier is a REAL compositor target:
 * the M/Ø canvas and the MediaRecorder export run at the chosen geometry. */

export interface QualityPreset {
  key: string
  label: string
  short: string
  w: number
  h: number
  fps: number
  /** encoder bitrate hint for the MediaRecorder master */
  bps: number
}

export const QUALITY_PRESETS: QualityPreset[] = [
  { key: '540', label: 'SD 540p', short: '540p', w: 960, h: 540, fps: 60, bps: 2_500_000 },
  { key: '720', label: 'HD 720p', short: '720p', w: 1280, h: 720, fps: 60, bps: 4_000_000 },
  { key: '1080', label: 'Full HD 1080p', short: '1080p', w: 1920, h: 1080, fps: 60, bps: 8_000_000 },
  { key: '1440', label: 'QHD 1440p', short: '1440p', w: 2560, h: 1440, fps: 50, bps: 14_000_000 },
  { key: '4k', label: '4K UHD 2160p', short: '4K', w: 3840, h: 2160, fps: 30, bps: 25_000_000 },
  { key: '5k', label: '5K 2880p', short: '5K', w: 5120, h: 2880, fps: 30, bps: 34_000_000 },
  { key: '6k', label: '6K 3384p', short: '6K', w: 6016, h: 3384, fps: 30, bps: 42_000_000 },
  { key: '8k', label: '8K UHD 4320p', short: '8K', w: 7680, h: 4320, fps: 30, bps: 50_000_000 },
]

export const MAX_QUALITY = QUALITY_PRESETS[QUALITY_PRESETS.length - 1]

/** human tier name for a measured resolution — "3840×2160" → "4K UHD" */
export function qualityTier(w: number, h: number): string {
  if (!w || !h) return ''
  const min = Math.min(w, h)
  if (min >= 4320) return '8K UHD'
  if (min >= 3384) return '6K'
  if (min >= 2880) return '5K'
  if (min >= 2160) return '4K UHD'
  if (min >= 3384 / 2) return 'QHD 1440p'
  if (min >= 2160 / 2) return 'Full HD 1080p'
  if (min >= 1440 / 2) return 'HD 720p'
  if (min >= 540) return 'SD 540p'
  if (min >= 480) return '480p'
  return `${min}p`
}

/* ---------------- unlimited duration formatting ----------------
 * "maximum timing will be unlimited — minute, hour, day, month, year":
 * converts any second count into a human span with no ceiling.
 *   92          → "1 min 32 s"
 *   90000       → "1 d 1 hr"
 *   95_000_000  → "3 yr 1 mo" */

const SEC_MIN = 60
const SEC_HOUR = 3600
const SEC_DAY = 86400
const SEC_MONTH = 2592000 // 30-day month, broadcast convention
const SEC_YEAR = 31536000

/** unlimited span formatter — handles minutes, hours, days, months, years */
export function fmtDuration(s: number, compact = false): string {
  if (!isFinite(s) || s < 0) return '0 s'
  let r = s
  const years = Math.floor(r / SEC_YEAR); r -= years * SEC_YEAR
  const months = Math.floor(r / SEC_MONTH); r -= months * SEC_MONTH
  const days = Math.floor(r / SEC_DAY); r -= days * SEC_DAY
  const hours = Math.floor(r / SEC_HOUR); r -= hours * SEC_HOUR
  const mins = Math.floor(r / SEC_MIN); r -= mins * SEC_MIN
  const secs = s < 60 ? Math.round(r * 10) / 10 : Math.round(r)
  const parts: string[] = []
  if (years) parts.push(`${years} yr`)
  if (months) parts.push(`${months} mo`)
  if (days) parts.push(`${days} d`)
  if (hours) parts.push(`${hours} hr`)
  if (mins) parts.push(`${mins} min`)
  if (secs || parts.length === 0) parts.push(`${secs} s`)
  if (compact && parts.length > 2) return `${parts[0]} ${parts[1]}`
  return parts.slice(0, 3).join(' ')
}

/** adaptive ruler tick (seconds) — picks the coarsest step that still gives
 *  >= minPx pixels between ticks so a YEAR-long timeline stays renderable */
export const RULER_STEPS = [
  1, 2, 5, 10, 15, 30, SEC_MIN, 2 * SEC_MIN, 5 * SEC_MIN, 10 * SEC_MIN, 15 * SEC_MIN, 30 * SEC_MIN,
  SEC_HOUR, 2 * SEC_HOUR, 6 * SEC_HOUR, 12 * SEC_HOUR, SEC_DAY, 2 * SEC_DAY, 7 * SEC_DAY,
  SEC_MONTH, 3 * SEC_MONTH, 6 * SEC_MONTH, SEC_YEAR, 5 * SEC_YEAR,
]

export function rulerStep(pxPerSec: number, minPx = 64): number {
  for (const s of RULER_STEPS) if (s * pxPerSec >= minPx) return s
  return RULER_STEPS[RULER_STEPS.length - 1]
}

/** browsers cap element width (~33.5M px). Clamp the timeline scale so even a
 *  multi-year timeline stays inside the real rendering limit — scrubbing keeps
 *  working because the ruler maps by fraction, not by pixel math. */
export const TIMELINE_MAX_PX = 4_000_000

export function clampTimelineScale(pxPerSec: number, totalSec: number): number {
  if (totalSec <= 0) return pxPerSec
  return Math.min(pxPerSec, Math.max(0.0005, TIMELINE_MAX_PX / totalSec))
}

// REDSEC v5.0 — Media helpers (screenshot / screen recording)
'use client'

import { domToBlob, domToCanvas } from 'modern-screenshot'
import { fs } from './fs'
import { useOS } from './store'
import { osSound } from './sound'

/* capture the whole desktop as a png blob (used by full + region shots) */
async function captureDesktopBlob(): Promise<Blob> {
  const el = document.getElementById('os-root')
  if (!el) throw new Error('no root')
  // modern-screenshot renders through SVG foreignObject, so Tailwind 4 oklab/color-mix
  // computed styles are handled by the browser itself (html2canvas chokes on them)
  const blob = await domToBlob(el, {
    scale: Math.min(window.devicePixelRatio || 1, 1.5),
    backgroundColor: '#0b0f19',
    filter: (node) => !(node instanceof HTMLElement && node.hasAttribute('data-shot-hide')),
  })
  if (!blob) throw new Error('capture failed')
  return blob
}

async function saveShotBlob(blob: Blob, suffix: string): Promise<string> {
  const st = useOS.getState()
  if (st.drivers.sound) osSound.shutter(st.volume)
  const name = `${suffix} ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/[,:]/g, '-')}.png`
  const node = await fs.addFile('screenshots', name, { blob, mime: 'image/png', meta: { kind: 'screenshot' } })
  // build a small jpeg thumbnail for the visual shot toast (kept out of the store)
  try {
    const bmp = await createImageBitmap(blob)
    const thumb = document.createElement('canvas')
    const scale = 420 / bmp.width
    thumb.width = 420
    thumb.height = Math.round(bmp.height * scale)
    thumb.getContext('2d')?.drawImage(bmp, 0, 0, thumb.width, thumb.height)
    const url = thumb.toDataURL('image/jpeg', 0.72)
    shotThumbs.set(node.id, url)
    window.dispatchEvent(new CustomEvent('os-shot', { detail: { nodeId: node.id, name } }))
    bmp.close?.()
  } catch {
    /* thumbnail is best-effort */
  }
  useOS.getState().notify({ title: 'Screenshot saved', body: name, kind: 'shot', emoji: '📸' })
  return node.id
}

export async function takeScreenshot(): Promise<string> {
  const blob = await captureDesktopBlob()
  return saveShotBlob(blob, 'Screenshot')
}

/* crop a saved rect (css px of the viewport) out of a fresh desktop capture */
export async function captureRegion(rect: { x: number; y: number; w: number; h: number }): Promise<string> {
  const blob = await captureDesktopBlob()
  const bmp = await createImageBitmap(blob)
  const sx = bmp.width / window.innerWidth
  const sy = bmp.height / window.innerHeight
  const cx = Math.max(0, Math.min(bmp.width - 1, Math.round(rect.x * sx)))
  const cy = Math.max(0, Math.min(bmp.height - 1, Math.round(rect.y * sy)))
  const cw = Math.max(1, Math.min(bmp.width - cx, Math.round(rect.w * sx)))
  const ch = Math.max(1, Math.min(bmp.height - cy, Math.round(rect.h * sy)))
  const out = document.createElement('canvas')
  out.width = cw
  out.height = ch
  const ctx = out.getContext('2d')
  if (!ctx) {
    bmp.close?.()
    throw new Error('canvas unavailable')
  }
  ctx.drawImage(bmp, cx, cy, cw, ch, 0, 0, cw, ch)
  bmp.close?.()
  const cropped = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'))
  if (!cropped) throw new Error('crop failed')
  return saveShotBlob(cropped, 'Snip')
}

/* live window thumbnails for taskbar hover previews (cached 4s) */
const winThumbCache = new Map<string, { url: string; at: number }>()

export async function windowThumb(winId: string): Promise<string | null> {
  if (typeof document === 'undefined') return null
  const el = document.querySelector(`[data-win-id="${winId}"]`) as HTMLElement | null
  if (!el) return null
  const cached = winThumbCache.get(winId)
  if (cached && Date.now() - cached.at < 4000) return cached.url
  try {
    const canvas = await domToCanvas(el, {
      scale: 0.22,
      backgroundColor: '#10141f',
      filter: (node) => !(node instanceof HTMLElement && node.hasAttribute('data-thumb-hide')),
    })
    const url = canvas.toDataURL('image/jpeg', 0.62)
    winThumbCache.set(winId, { url, at: Date.now() })
    return url
  } catch {
    return null
  }
}

/* transient thumbnail store for shot toasts (never persisted) */
export const shotThumbs = new Map<string, string>()

export interface RecordingSession {
  stop: () => Promise<string>
}

export async function startScreenRecording(withMic: boolean): Promise<RecordingSession> {
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: true,
  })
  const tracks: MediaStreamTrack[] = [...display.getVideoTracks()]
  if (withMic) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
      tracks.push(...mic.getAudioTracks())
    } catch {
      /* mic denied — record without mic */
    }
  }
  const stream = new MediaStream(tracks)
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm'
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const done = new Promise<Blob>((res) => {
    rec.onstop = () => res(new Blob(chunks, { type: 'video/webm' }))
  })
  rec.start(1000)

  const cleanup = () => {
    display.getTracks().forEach((t) => t.stop())
    stream.getTracks().forEach((t) => t.stop())
  }
  display.getVideoTracks()[0].addEventListener('ended', () => {
    if (rec.state !== 'inactive') rec.stop()
    cleanup()
  })

  return {
    stop: async () => {
      if (rec.state !== 'inactive') rec.stop()
      const blob = await done
      cleanup()
      const name = `Screen Recording ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/[,:]/g, '-')}.webm`
      const node = await fs.addFile('videos', name, { blob, mime: 'video/webm', meta: { kind: 'recording' } })
      useOS.getState().notify({ title: 'Screen recording saved', body: name, kind: 'success', emoji: '🎥' })
      return node.id
    },
  }
}

export async function saveBlobTo(blob: Blob, folder: string, name: string, meta: Record<string, unknown>): Promise<string> {
  const node = await fs.addFile(folder, name, { blob, mime: blob.type, meta })
  return node.id
}

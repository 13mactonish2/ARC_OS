// REDSEC v5.0.1 — UI skin engine: custom images for the Start button, taskbar/panel
// and desktop icons (right-click → "Customize image"). Heavy image bytes never enter
// the persisted zustand store — files live in the OS file system (Photos, meta.kind
// 'skin', blobs in IndexedDB) and only the node ids are persisted, so localStorage
// quota can never be blown by a big GIF.
'use client'

import { useEffect, useState } from 'react'
import { fs } from './fs'

export const MAX_SKIN_FILE = 12 * 1024 * 1024 // 12 MB — generous room for live GIFs
export const MAX_SKIN_VIDEO = 512 * 1024 * 1024 // 512 MB — any resolution, incl. 4K live video wallpapers

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
}

const VIDEO_EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
  ts: 'video/mp2t',
}

export function isVideoFile(f: File): boolean {
  if (f.type.startsWith('video/')) return true
  const ext = f.name.split('.').pop()?.toLowerCase() || ''
  return !!VIDEO_EXT_MIME[ext]
}

function videoMimeFor(f: File): string {
  if (f.type && f.type.startsWith('video/')) return f.type
  const ext = f.name.split('.').pop()?.toLowerCase() || ''
  return VIDEO_EXT_MIME[ext] || 'video/mp4'
}

export function isImageFile(f: File): boolean {
  if (f.type.startsWith('image/')) return true
  const ext = f.name.split('.').pop()?.toLowerCase() || ''
  return !!EXT_MIME[ext]
}

/**
 * Open a file picker and persist the picked image into the OS file system,
 * then hand the node id to the caller (which stores it in the OS store).
 * Accepts .png .jpg .jpeg .gif (animated → live) .webp .svg .bmp .ico .avif.
 * The file input is one persistent hidden element on <body> so automation and
 * popup blockers can always target `#os-skin-input`.
 */
export function pickSkinImage(
  apply: (nodeId: string, name: string, isGif: boolean) => void,
  onErr?: (msg: string) => void
): void {
  if (typeof document === 'undefined') return
  let input = document.getElementById('os-skin-input') as HTMLInputElement | null
  if (!input) {
    input = document.createElement('input')
    input.type = 'file'
    input.id = 'os-skin-input'
    input.dataset.skinInput = '1'
    input.style.display = 'none'
    document.body.appendChild(input)
  }
  input.accept =
    'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp,image/x-icon,image/avif,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.ico,.avif'
  const inp = input
  inp.onchange = () => {
    const f = inp.files?.[0]
    inp.value = ''
    if (!f) return
    if (!isImageFile(f)) {
      onErr?.('That file is not an image — pick a .png, .jpg, .gif, .webp or .svg')
      return
    }
    if (f.size > MAX_SKIN_FILE) {
      onErr?.('Image is too large — the limit is 12 MB')
      return
    }
    const ext = f.name.split('.').pop()?.toLowerCase() || ''
    const mime = f.type && f.type.startsWith('image/') ? f.type : EXT_MIME[ext] || 'image/png'
    fs.addFile('photos', f.name || 'skin.png', { blob: f, mime, meta: { kind: 'skin' } })
      .then((node) => apply(node.id, node.name, mime === 'image/gif'))
      .catch(() => onErr?.('Could not save that image'))
  }
  input.click()
}

/**
 * Open a file picker and persist the picked IMAGE or VIDEO into the OS file
 * system as a wallpaper, then hand the result to the caller.
 * Images: .png .jpg .gif (animated → live) .webp .svg .bmp .ico .avif
 * Videos: .mp4 .webm .mov .mkv .avi .m4v .ogv .3gp .ts — ANY resolution
 * (4K/8K included; no dimension checks — browsers scale natively).
 * The file input is one persistent hidden element on <body> so automation and
 * popup blockers can always target `#os-wall-input`.
 */
export interface PickedWall {
  nodeId: string
  name: string
  isVideo: boolean
  isGif: boolean
}

export function pickWallpaperMedia(
  apply: (w: PickedWall) => void,
  onErr?: (msg: string) => void,
  opts?: { videoOnly?: boolean; imageOnly?: boolean }
): void {
  if (typeof document === 'undefined') return
  let input = document.getElementById('os-wall-input') as HTMLInputElement | null
  if (!input) {
    input = document.createElement('input')
    input.type = 'file'
    input.id = 'os-wall-input'
    input.dataset.wallInput = '1'
    input.style.display = 'none'
    document.body.appendChild(input)
  }
  const videoAcc =
    'video/mp4,video/webm,video/quicktime,video/x-matroska,video/x-msvideo,video/ogg,.mp4,.m4v,.webm,.mov,.mkv,.avi,.ogv,.3gp,.ts'
  const imgAcc =
    'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp,image/x-icon,image/avif,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.ico,.avif'
  input.accept = opts?.videoOnly ? videoAcc : opts?.imageOnly ? imgAcc : `${imgAcc},${videoAcc}`
  const inp = input
  inp.onchange = () => {
    const f = inp.files?.[0]
    inp.value = ''
    if (!f) return
    const video = isVideoFile(f)
    const image = isImageFile(f)
    if (!video && !image) {
      onErr?.('Pick an image (.png .jpg .gif .webp) or a video (.mp4 .webm .mov .mkv)')
      return
    }
    if (opts?.videoOnly && !video) {
      onErr?.('That slot needs a video — pick an .mp4, .webm or .mov')
      return
    }
    if (opts?.imageOnly && video) {
      onErr?.('That slot needs an image — pick a .png, .jpg or .gif')
      return
    }
    if (video ? f.size > MAX_SKIN_VIDEO : f.size > MAX_SKIN_FILE) {
      onErr?.(video ? 'Video is too large — the limit is 512 MB' : 'Image is too large — the limit is 12 MB')
      return
    }
    const mime = video ? videoMimeFor(f) : f.type && f.type.startsWith('image/') ? f.type : EXT_MIME[f.name.split('.').pop()?.toLowerCase() || ''] || 'image/png'
    fs.addFile('photos', f.name || (video ? 'wallpaper.mp4' : 'wallpaper.png'), {
      blob: f,
      mime,
      meta: { kind: 'wallpaper', live: video || mime === 'image/gif' },
    })
      .then((node) => apply({ nodeId: node.id, name: node.name, isVideo: video, isGif: !video && mime === 'image/gif' }))
      .catch(() => onErr?.('Could not save that file'))
  }
  input.click()
}

/** Resolve a skin node id to a blob URL (re-resolves when the id changes). */
export function useSkinUrl(nodeId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let dead = false
    if (!nodeId) {
      queueMicrotask(() => {
        if (!dead) setUrl(null)
      })
      return
    }
    fs.blobUrl(nodeId).then((u) => {
      if (!dead) setUrl(u || null)
    })
    return () => {
      dead = true
    }
  }, [nodeId])
  return url
}

/** Open the native color picker and hand the chosen hex color to the callback. */
export function pickColor(apply: (hex: string) => void, initial = '#131826'): void {
  if (typeof document === 'undefined') return
  const input = document.createElement('input')
  input.type = 'color'
  input.value = /^#[0-9a-fA-F]{6}$/.test(initial) ? initial : '#131826'
  input.onchange = () => {
    if (input.value) apply(input.value)
  }
  input.click()
}

/* ---------------- Custom fonts (Settings → Fonts) ----------------
   Same pattern as the skin engine above: heavy font bytes never enter the
   persisted zustand store — the file lives in the OS file system (Downloads,
   meta.kind 'font', blob in IndexedDB) and only the node id is persisted.
   OSRoot resolves the node, registers it as a FontFace named 'REDSEC Custom'
   and renders it ahead of the chosen preset stack. */

export const CUSTOM_FONT_FAMILY = 'REDSEC Custom'
export const MAX_FONT_FILE = 10 * 1024 * 1024 // 10 MB — plenty for any desktop font

const FONT_EXT_MIME: Record<string, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

export function isFontFile(f: File): boolean {
  const ext = f.name.split('.').pop()?.toLowerCase() || ''
  if (FONT_EXT_MIME[ext]) return true
  return f.type.startsWith('font/') || f.type === 'application/font-woff' || f.type === 'application/x-font-ttf' || f.type === 'application/x-font-opentype'
}

/**
 * Open a file picker and persist the picked font into the OS file system
 * (Downloads, meta.kind 'font' so it doesn't pollute Photos), then hand the
 * node id to the caller (which stores it in the OS store).
 * Accepts .ttf .otf .woff .woff2 — 10 MB cap.
 * The file input is one persistent hidden element on <body> so automation and
 * popup blockers can always target `#os-font-input`.
 */
export function pickFontFile(
  apply: (nodeId: string, name: string) => void,
  onErr?: (msg: string) => void
): void {
  if (typeof document === 'undefined') return
  let input = document.getElementById('os-font-input') as HTMLInputElement | null
  if (!input) {
    input = document.createElement('input')
    input.type = 'file'
    input.id = 'os-font-input'
    input.dataset.fontInput = '1'
    input.style.display = 'none'
    document.body.appendChild(input)
  }
  input.accept = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2'
  const inp = input
  inp.onchange = () => {
    const f = inp.files?.[0]
    inp.value = ''
    if (!f) return
    if (!isFontFile(f)) {
      onErr?.('That file is not a font — pick a .TTF, .OTF, .WOFF or .WOFF2 file')
      return
    }
    if (f.size > MAX_FONT_FILE) {
      onErr?.('Font file is too large — the limit is 10 MB')
      return
    }
    const ext = f.name.split('.').pop()?.toLowerCase() || ''
    const mime = f.type && f.type.startsWith('font/') ? f.type : FONT_EXT_MIME[ext] || 'font/ttf'
    fs.addFile('downloads', f.name || 'custom.ttf', { blob: f, mime, meta: { kind: 'font' } })
      .then((node) => apply(node.id, node.name))
      .catch(() => onErr?.('Could not save that font file'))
  }
  input.click()
}

/**
 * Load a font file (fs node id → blob → FontFace) and register it on
 * document.fonts under the 'REDSEC Custom' family name. Returns the family
 * name once parsed & registered, null while loading / when unset / when the
 * file is missing or broken — callers silently fall back to the preset stack.
 * The blob URL is revoked as soon as the face holds its parsed data, and the
 * face is removed from document.fonts on change/unmount.
 */
export function useCustomFontFace(nodeId: string | null | undefined): string | null {
  const [family, setFamily] = useState<string | null>(null)
  useEffect(() => {
    let dead = false
    let face: FontFace | null = null
    let objUrl: string | null = null
    if (!nodeId) {
      queueMicrotask(() => {
        if (!dead) setFamily(null)
      })
      return
    }
    ;(async () => {
      try {
        if (typeof window === 'undefined' || !('FontFace' in window)) return
        const blob = await fs.getBlob(nodeId)
        if (dead) return
        if (!blob) {
          console.warn('[redsec] custom font file is missing — falling back to the preset stack')
          return
        }
        objUrl = URL.createObjectURL(blob)
        face = new FontFace(CUSTOM_FONT_FAMILY, `url(${objUrl})`, { display: 'swap' })
        await face.load()
        if (dead) return
        document.fonts.add(face)
        setFamily(CUSTOM_FONT_FAMILY)
      } catch (err) {
        console.warn('[redsec] custom font could not be loaded — falling back to the preset stack', err)
      } finally {
        // the FontFace keeps its parsed data after load(); the blob URL is dead weight now
        if (objUrl) URL.revokeObjectURL(objUrl)
      }
    })()
    return () => {
      dead = true
      if (face) {
        try { document.fonts.delete(face) } catch {}
        face = null
      }
      if (objUrl) URL.revokeObjectURL(objUrl) // still loading — drop the URL too
    }
  }, [nodeId])
  return family
}

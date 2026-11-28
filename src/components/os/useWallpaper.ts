// REDSEC v5.0 — shared wallpaper resolver hook (desktop, login, lock screen)
// v5.0.2: video-aware — useWallpaperMedia returns { url, isVideo } so the
// desktop can play live video wallpapers; useWallpaperUrl keeps returning the
// blob URL for images and NULL for videos (login/lock fall back gracefully).
'use client'

import { useEffect, useState } from 'react'
import { useOS } from '@/lib/os/store'
import { fs, fsGet } from '@/lib/os/fs'

function isVideoNode(id: string): boolean {
  const n = fsGet(id)
  const mime = n?.mime || (n?.meta?.mime as string) || ''
  return mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v|ogv|3gp|ts)$/i.test(n?.name || '')
}

export function useWallpaperUrl(): string | null {
  const wallpaper = useOS((s) => s.wallpaper)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let dead = false
    if (wallpaper.startsWith('stock:')) {
      const raw = parseInt(wallpaper.split(':')[1], 10)
      const n = Number.isNaN(raw) ? 1 : raw
      // stock:0 — the dedicated REDSEC 6.0 BlueStringRay backdrop (bundled, offline)
      const u = n === 0 ? '/wallpapers/bluestringray.jpg' : `https://picsum.photos/seed/redsec6-w${n}/1920/1080`
      queueMicrotask(() => {
        if (!dead) setUrl(u)
      })
    } else if (wallpaper.startsWith('custom:')) {
      const id = wallpaper.slice(7)
      if (isVideoNode(id)) {
        // videos are rendered by useWallpaperMedia consumers, not as a css background
        queueMicrotask(() => {
          if (!dead) setUrl(null)
        })
        return
      }
      fs.blobUrl(id).then((u) => {
        if (!dead && u) setUrl(u)
      })
    } else {
      queueMicrotask(() => {
        if (!dead) setUrl(null)
      })
    }
    return () => {
      dead = true
    }
  }, [wallpaper])
  return url
}

/** full media info for the desktop wallpaper layer — supports live video wallpapers */
export function useWallpaperMedia(): { url: string | null; isVideo: boolean } {
  const wallpaper = useOS((s) => s.wallpaper)
  const [state, setState] = useState<{ url: string | null; isVideo: boolean }>({ url: null, isVideo: false })
  useEffect(() => {
    let dead = false
    if (wallpaper.startsWith('stock:')) {
      const raw = parseInt(wallpaper.split(':')[1], 10)
      const n = Number.isNaN(raw) ? 1 : raw
      const u = n === 0 ? '/wallpapers/bluestringray.jpg' : `https://picsum.photos/seed/redsec6-w${n}/1920/1080`
      queueMicrotask(() => {
        if (!dead) setState({ url: u, isVideo: false })
      })
    } else if (wallpaper.startsWith('custom:')) {
      const id = wallpaper.slice(7)
      const video = isVideoNode(id)
      fs.blobUrl(id).then((u) => {
        if (!dead) setState({ url: u || null, isVideo: video })
      })
    } else {
      queueMicrotask(() => {
        if (!dead) setState({ url: null, isVideo: false })
      })
    }
    return () => {
      dead = true
    }
  }, [wallpaper])
  return state
}

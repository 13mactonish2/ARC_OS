// REDSEC v5.0 — Win+Shift+S region snip overlay (Windows "Snipping Tool" style)
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { captureRegion } from '@/lib/os/media'
import { useOS } from '@/lib/os/store'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function RegionCapture() {
  const [active, setActive] = useState(false)
  const [rect, setRect] = useState<Rect | null>(null)
  const [busy, setBusy] = useState(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const layerRef = useRef<HTMLDivElement>(null)

  const open = useCallback(() => {
    setRect(null)
    setActive(true)
  }, [])

  const close = useCallback(() => {
    setActive(false)
    setRect(null)
    startRef.current = null
  }, [])

  useEffect(() => {
    const h = () => open()
    window.addEventListener('os-region-shot', h)
    return () => window.removeEventListener('os-region-shot', h)
  }, [open])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, close])

  const norm = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
    x: Math.max(0, Math.min(a.x, b.x)),
    y: Math.max(0, Math.min(a.y, b.y)),
    w: Math.min(window.innerWidth, Math.max(a.x, b.x)) - Math.max(0, Math.min(a.x, b.x)),
    h: Math.min(window.innerHeight, Math.max(a.y, b.y)) - Math.max(0, Math.min(a.y, b.y)),
  })

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    startRef.current = { x: e.clientX, y: e.clientY }
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current || busy) return
    setRect(norm(startRef.current, { x: e.clientX, y: e.clientY }))
  }

  const onPointerUp = async () => {
    const r = rect
    startRef.current = null
    if (!r || r.w < 12 || r.h < 12) {
      // too small — treat as cancel
      close()
      return
    }
    setBusy(true)
    try {
      await captureRegion(r)
    } catch {
      useOS.getState().notify({ title: 'Snip failed', body: 'Could not capture that region', kind: 'error' })
    }
    setBusy(false)
    close()
  }

  if (!active) return null

  return (
    <div
      ref={layerRef}
      data-shot-hide
      className="fixed inset-0 z-[9500] cursor-crosshair select-none"
      style={{ background: 'rgba(4,7,12,0.42)', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* clear window inside selection: 4 shade strips around the rect */}
      {rect && rect.w > 0 && (
        <>
          <div className="pointer-events-none absolute left-0 right-0 top-0 bg-black/45" style={{ height: rect.y }} />
          <div className="pointer-events-none absolute left-0 right-0" style={{ top: rect.y + rect.h, bottom: 0 }} />
          <div className="pointer-events-none absolute left-0" style={{ top: rect.y, height: rect.h, width: rect.x }} />
          <div className="pointer-events-none absolute right-0" style={{ top: rect.y, height: rect.h, left: rect.x + rect.w }} />
          <div
            className="pointer-events-none absolute border-2 border-sky-400 shadow-[0_0_0_1px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.25)]"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          />
          {/* size badge */}
          <div
            className="pointer-events-none absolute rounded-md bg-[#0d1320]/95 px-2 py-0.5 font-mono text-[11px] text-sky-300 ring-1 ring-sky-400/40"
            style={{
              left: Math.min(rect.x + rect.w - 40, window.innerWidth - 84),
              top: rect.y + rect.h + 8 > window.innerHeight - 30 ? rect.y - 26 : rect.y + rect.h + 8,
            }}
          >
            {Math.round(rect.w)} × {Math.round(rect.h)}
          </div>
          {/* corner handles */}
          {(
            [
              [rect.x, rect.y],
              [rect.x + rect.w, rect.y],
              [rect.x, rect.y + rect.h],
              [rect.x + rect.w, rect.y + rect.h],
            ] as const
          ).map(([hx, hy], i) => (
            <div
              key={i}
              className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-200 bg-sky-400 shadow"
              style={{ left: hx, top: hy }}
            />
          ))}
        </>
      )}

      {/* instruction toolbar */}
      {!rect && (
        <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-full border border-white/15 bg-[#0d1320]/95 px-5 py-2.5 shadow-2xl backdrop-blur">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-500/20 text-sm">✂️</span>
            <span className="text-[13px] font-medium text-slate-200">Drag to select a region to snip</span>
            <span className="rounded border border-white/15 bg-white/8 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">Esc to cancel</span>
          </div>
        </div>
      )}

      {busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-[#0d1320]/95 px-5 py-3 shadow-2xl">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            <span className="text-[13px] text-slate-200">Capturing…</span>
          </div>
        </div>
      )}
    </div>
  )
}

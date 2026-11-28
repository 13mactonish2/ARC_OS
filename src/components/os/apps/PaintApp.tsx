// REDSEC v5.0 — Paint app (canvas drawing: pen/eraser/line/rect/circle, undo, save to Photos)
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Circle, Eraser, Minus, Pencil, Redo2, Save, Square, Trash2, Undo2 } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useOS } from '@/lib/os/store'
import { AppShell, Toolbar, TBtn, saveImageToPhotos } from './_shared'

type Tool = 'pen' | 'eraser' | 'line' | 'rect' | 'circle'
type Pt = { x: number; y: number }

const PALETTE = [
  '#111827',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#92400e',
  '#94a3b8',
]

const MAX_UNDO = 40

function stampName(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
}

const TOOL_ICONS: Array<{ id: Tool; label: string; icon: React.ReactNode }> = [
  { id: 'pen', label: 'Pen', icon: <Pencil className="h-4 w-4" /> },
  { id: 'eraser', label: 'Eraser', icon: <Eraser className="h-4 w-4" /> },
  { id: 'line', label: 'Line', icon: <Minus className="h-4 w-4" /> },
  { id: 'rect', label: 'Rectangle', icon: <Square className="h-4 w-4" /> },
  { id: 'circle', label: 'Circle', icon: <Circle className="h-4 w-4" /> },
]

export default function PaintApp(_props: { winId: string; args?: Record<string, unknown> }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const drawing = useRef(false)
  const last = useRef<Pt | null>(null)
  const startPt = useRef<Pt | null>(null)
  const preStroke = useRef<ImageData | null>(null)
  const undoStack = useRef<ImageData[]>([])
  const redoStack = useRef<ImageData[]>([])

  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#111827')
  const [size, setSize] = useState(4)
  const [undoLen, setUndoLen] = useState(0)
  const [redoLen, setRedoLen] = useState(0)
  const [saving, setSaving] = useState(false)

  /* ---------------- canvas plumbing ---------------- */

  const getCtx = useCallback((): CanvasRenderingContext2D | null => {
    const c = canvasRef.current
    return c ? c.getContext('2d') : null
  }, [])

  /** resize canvas to wrapper, preserving current drawing (stretched) */
  const resizeNow = useCallback(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = wrap.getBoundingClientRect()
    const w = Math.max(1, Math.floor(rect.width))
    const h = Math.max(1, Math.floor(rect.height))
    if (canvas.width === Math.floor(w * dpr) && canvas.height === Math.floor(h * dpr)) return

    let snap: HTMLCanvasElement | null = null
    if (canvas.width > 0 && canvas.height > 0) {
      snap = document.createElement('canvas')
      snap.width = canvas.width
      snap.height = canvas.height
      snap.getContext('2d')?.drawImage(canvas, 0, 0)
    }
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (snap) ctx.drawImage(snap, 0, 0, snap.width, snap.height, 0, 0, w, h)
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => resizeNow())
    ro.observe(wrap)
    resizeNow()
    return () => ro.disconnect()
  }, [resizeNow])

  const getPos = (e: { clientX: number; clientY: number }): Pt => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const pushUndo = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (!canvas || !ctx) return
    undoStack.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift()
    setUndoLen(undoStack.current.length)
  }, [getCtx])

  const undo = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (!canvas || !ctx || !undoStack.current.length) return
    const img = undoStack.current.pop() as ImageData
    const cur = ctx.getImageData(0, 0, canvas.width, canvas.height)
    redoStack.current.push(cur)
    ctx.putImageData(img, 0, 0)
    setUndoLen(undoStack.current.length)
    setRedoLen(redoStack.current.length)
  }, [getCtx])

  const redo = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (!canvas || !ctx || !redoStack.current.length) return
    const img = redoStack.current.pop() as ImageData
    const cur = ctx.getImageData(0, 0, canvas.width, canvas.height)
    undoStack.current.push(cur)
    ctx.putImageData(img, 0, 0)
    setUndoLen(undoStack.current.length)
    setRedoLen(redoStack.current.length)
  }, [getCtx])

  const clearAll = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (!canvas || !ctx) return
    pushUndo()
    redoStack.current = []
    setRedoLen(0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [getCtx, pushUndo])

  /* Ctrl+Z / Ctrl+Y keyboard */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (((e.ctrlKey || e.metaKey) && k === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'z')) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [undo, redo])

  /* ---------------- drawing ---------------- */

  const drawStroke = (from: Pt, to: Pt) => {
    const ctx = getCtx()
    if (!ctx) return
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color
    ctx.lineWidth = tool === 'eraser' ? size * 2.5 : size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }

  const drawShape = (a: Pt, b: Pt) => {
    const ctx = getCtx()
    if (!ctx) return
    ctx.strokeStyle = color
    ctx.lineWidth = size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    if (tool === 'line') {
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    } else if (tool === 'rect') {
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
      ctx.stroke()
    } else if (tool === 'circle') {
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      ctx.ellipse(cx, cy, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (!canvas || !ctx) return
    canvas.setPointerCapture(e.pointerId)
    pushUndo()
    redoStack.current = []
    setRedoLen(0)
    const p = getPos(e)
    startPt.current = p
    last.current = p
    drawing.current = true
    preStroke.current = ctx.getImageData(0, 0, canvas.width, canvas.height)
    if (tool === 'pen' || tool === 'eraser') drawStroke(p, { x: p.x + 0.01, y: p.y + 0.01 })
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const p = getPos(e)
    if (tool === 'pen' || tool === 'eraser') {
      if (last.current) drawStroke(last.current, p)
      last.current = p
    } else if (preStroke.current && startPt.current) {
      const ctx = getCtx()
      if (!ctx) return
      ctx.putImageData(preStroke.current, 0, 0)
      drawShape(startPt.current, p)
    }
  }

  const endStroke = () => {
    drawing.current = false
    last.current = null
    startPt.current = null
    preStroke.current = null
  }

  /* ---------------- save ---------------- */

  const save = async () => {
    const canvas = canvasRef.current
    if (!canvas || saving) return
    setSaving(true)
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('toBlob failed')
      await saveImageToPhotos(blob, `Painting ${stampName()}.png`, 'painting')
    } catch {
      useOS.getState().notify({ title: 'Could not save painting', kind: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell>
      <Toolbar className="flex-wrap">
        {/* tools */}
        <div className="flex flex-none items-center gap-0.5 rounded-lg bg-black/30 p-0.5">
          {TOOL_ICONS.map((t) => (
            <TBtn key={t.id} title={t.label} active={tool === t.id} onClick={() => setTool(t.id)}>
              {t.icon}
            </TBtn>
          ))}
        </div>

        {/* palette */}
        <div className="flex flex-none flex-wrap items-center gap-1">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              aria-label={`Color ${c}`}
              onClick={() => {
                setColor(c)
                if (tool === 'eraser') setTool('pen')
              }}
              className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                color === c && tool !== 'eraser' ? 'border-white ring-2 ring-sky-400/80' : 'border-white/25'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
          <label
            title="Custom color"
            className={`ml-0.5 flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border transition-transform hover:scale-110 ${
              !PALETTE.includes(color) && tool !== 'eraser' ? 'border-white ring-2 ring-sky-400/80' : 'border-white/25'
            }`}
            style={{ background: 'conic-gradient(#ef4444,#eab308,#22c55e,#06b6d4,#8b5cf6,#ec4899,#ef4444)' }}
          >
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value)
                if (tool === 'eraser') setTool('pen')
              }}
              className="h-0 w-0 opacity-0"
              aria-label="Custom color picker"
            />
          </label>
        </div>

        {/* size */}
        <div className="flex flex-none items-center gap-2 pl-1">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Size</span>
          <input
            type="range"
            min={1}
            max={40}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-20 accent-sky-500 sm:w-24"
            aria-label="Brush size"
          />
          <span className="w-6 text-xs tabular-nums text-slate-400">{size}</span>
        </div>

        <div className="flex-1" />

        {/* actions */}
        <TBtn title="Undo (Ctrl+Z)" onClick={undo} disabled={undoLen === 0}>
          <Undo2 className="h-4 w-4" />
        </TBtn>
        <TBtn title="Redo (Ctrl+Y)" onClick={redo} disabled={redoLen === 0}>
          <Redo2 className="h-4 w-4" />
        </TBtn>
        <TBtn title="Clear canvas" onClick={clearAll}>
          <Trash2 className="h-4 w-4" /> <span className="hidden sm:inline">Clear</span>
        </TBtn>
        <TBtn
          title="Save to Photos"
          onClick={() => void save()}
          className="bg-sky-600/80 text-white hover:bg-sky-500"
          disabled={saving}
        >
          <Save className="h-4 w-4" /> <span className="hidden sm:inline">{saving ? 'Saving…' : 'Save'}</span>
        </TBtn>
      </Toolbar>

      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
        />
        <div className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] text-white/70">
          {tool === 'eraser' ? 'Eraser' : tool === 'pen' ? 'Pen' : tool === 'line' ? 'Line' : tool === 'rect' ? 'Rectangle' : 'Circle'} · Ctrl+Z to undo
        </div>
      </div>
    </AppShell>
  )
}

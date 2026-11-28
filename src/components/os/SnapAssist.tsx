// REDSEC v5.0 — Snap Assist (Windows 11 style): after snapping a window,
// offer other open windows for the NEXT empty zone of the layout — chains
// through halves → thirds → quads until the layout is full or dismissed.
// Keyboard: ↑↓←→ move the selection, ↵ snaps, 1-9 snaps the Nth candidate, Esc dismisses.
'use client'

import { useEffect, useRef, useState } from 'react'
import { useOS } from '@/lib/os/store'
import { APP_META } from '@/lib/os/store'
import { SNAP_FRACTIONS, SnapZone, panelPx, workAreaRect } from '@/lib/os/types'
import { AppIcon } from './AppIcon'
import { WinThumb } from './WinThumb'
import { X, SkipForward } from 'lucide-react'

const ZONE_LABEL: Partial<Record<SnapZone, string>> = {
  left: 'left half',
  right: 'right half',
  'third-l': 'left third',
  'third-c': 'center third',
  'third-r': 'right third',
  twoleft: 'wide left zone',
  tworight: 'wide right zone',
  tl: 'top-left quadrant',
  tr: 'top-right quadrant',
  bl: 'bottom-left quadrant',
  br: 'bottom-right quadrant',
}

export function SnapAssist() {
  const snapAssist = useOS((s) => s.snapAssist)
  const windows = useOS((s) => s.windows)
  const snapWindow = useOS((s) => s.snapWindow)
  const setSnapAssist = useOS((s) => s.setSnapAssist)
  const tbH = useOS((s) => panelPx(s.taskbarTheme, s.panelSize, s.panelThickness))
  const taskbarPos = useOS((s) => s.taskbarPos)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [selRaw, setSel] = useState(0)

  const target = snapAssist?.chain?.[0] ?? null
  const open = !!snapAssist && !!target
  const candidates = open ? windows.filter((w) => w.id !== snapAssist?.forWin) : []
  /* keyboard selection clamped to the live candidate list (no effect needed) */
  const sel = Math.min(selRaw, Math.max(0, candidates.length - 1))

  /* auto-dismiss after 7s like Windows */
  useEffect(() => {
    if (!open) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSnapAssist(null), 7000)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSnapAssist(null)
    window.addEventListener('keydown', onKey)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, setSnapAssist, snapAssist?.forWin, target])

  /* keyboard navigation: arrows move, Enter snaps the selected candidate */
  useEffect(() => {
    if (!open) return
    const onNav = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const cols = 2
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        setSel((s) => {
          const n = candidates.length
          if (n === 0) return 0
          if (e.key === 'ArrowRight') return Math.min(n - 1, s + 1)
          if (e.key === 'ArrowLeft') return Math.max(0, s - 1)
          if (e.key === 'ArrowDown') return Math.min(n - 1, s + cols)
          return Math.max(0, s - cols)
        })
      } else if (e.key === 'Enter') {
        const w = candidates[sel]
        if (w) {
          e.preventDefault()
          snapWindow(w.id, target!, true)
        }
      } else if (/^[1-9]$/.test(e.key)) {
        // Win11-style quick snap: press 1-9 to snap the Nth candidate instantly
        const w = candidates[Number(e.key) - 1]
        if (w) {
          e.preventDefault()
          snapWindow(w.id, target!, true)
        }
      }
    }
    window.addEventListener('keydown', onNav)
    return () => window.removeEventListener('keydown', onNav)
  }, [open, candidates, sel, snapWindow, target])

  /* dismiss if the snapped window dies */
  useEffect(() => {
    if (!open) return
    const st = useOS.getState()
    if (!st.windows.some((w) => w.id === snapAssist?.forWin)) setSnapAssist(null)
  }, [open, windows, snapAssist?.forWin, setSnapAssist])

  if (!open || !snapAssist || !target) return null

  const chain = snapAssist.chain
  /* zone rect against the DOCK-AWARE work area (not raw innerHeight) */
  const wa = workAreaRect(taskbarPos, tbH)
  const f = SNAP_FRACTIONS[target]

  const px = Math.round(wa.x + f.fx * wa.w)
  const py = Math.round(wa.y + f.fy * wa.h)
  const pw = Math.round(f.fw * wa.w)
  const ph = Math.round(f.fh * wa.h)
  const total = (chain?.length || 1) + 1 // zones left in this layout incl. the one being offered

  const skip = () => {
    const rest = chain.slice(1)
    setSnapAssist(rest.length > 0 ? { ...snapAssist, chain: rest } : null)
  }

  return (
    <div
      data-snap-assist
      className="fixed z-[8500] flex flex-col rounded-xl border-2 border-dashed border-sky-400/60 bg-[#0a0e18]/88 p-3 backdrop-blur-md animate-[popIn_0.16s_ease]"
      style={{ left: px, top: py, width: pw, height: ph }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setSnapAssist(null)
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-sky-300/90">
          Snap assist — {ZONE_LABEL[target] || target} <span className="ml-1 normal-case text-sky-400/60">zone {total - chain.length + 1} in layout</span>
        </span>
        <div className="flex flex-none items-center gap-1">
          {chain.length > 1 && (
            <button
              onClick={skip}
              title="Skip this zone"
              className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-slate-400 hover:bg-white/10 hover:text-slate-200"
            >
              <SkipForward className="h-3 w-3" /> Skip
            </button>
          )}
          <button
            aria-label="Dismiss snap assist"
            onClick={() => setSnapAssist(null)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto os-scroll pr-0.5" style={{ gridAutoRows: 'min-content' }}>
        {candidates.map((w, i) => {
          const meta = APP_META[w.appId.split(':')[0]]
          const selected = i === sel
          return (
            <button
              key={w.id}
              onMouseEnter={() => setSel(i)}
              onClick={() => {
                // snap the candidate into this zone; the store re-chains the assist
                // to the next empty zone automatically (assist stays alive)
                snapWindow(w.id, target, true)
              }}
              className={`group flex flex-col overflow-hidden rounded-lg border bg-[#151b2a]/95 text-left shadow-lg transition-all ${
                selected
                  ? 'border-sky-400 ring-1 ring-sky-400/60 shadow-sky-500/20'
                  : 'border-white/12 hover:border-sky-400/60 hover:shadow-sky-500/10'
              }`}
            >
              {/* live captured thumbnail strip */}
              <div className="relative h-[64px] w-full overflow-hidden border-b border-white/8" style={{ background: 'linear-gradient(135deg, #10141f, #1a2130)' }}>
                <WinThumb winId={w.id} appId={w.appId} iconSize={26} />
                <span
                  className={`absolute right-1.5 top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded text-[8.5px] font-bold ${
                    selected ? 'bg-sky-400 text-slate-900' : 'bg-black/60 text-slate-300'
                  }`}
                  title={`Press ${i + 1} to snap instantly`}
                >
                  {i + 1}
                </span>
                {w.minimized && (
                  <span className="absolute bottom-1 right-1.5 z-10 rounded bg-black/65 px-1.5 py-0.5 text-[8.5px] font-medium text-slate-300">minimized</span>
                )}
                {selected && (
                  <span className="absolute left-1.5 top-1.5 z-10 flex items-center gap-1 rounded bg-sky-500/85 px-1.5 py-0.5 text-[8.5px] font-bold text-white">
                    ↵ snap
                  </span>
                )}
              </div>
              <span className="flex items-center gap-2 p-2">
                <AppIcon appId={w.appId} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-slate-200">{w.title || meta?.name || w.appId}</span>
                  <span className="block text-[10px] text-slate-500">{w.minimized ? 'click to restore here' : 'click to snap here'}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-2 border-t border-white/8 pt-1.5 text-[9px] text-slate-500">
        <kbd className="rounded border border-white/12 bg-white/5 px-1 font-sans">↑↓←→</kbd> navigate
        <kbd className="rounded border border-white/12 bg-white/5 px-1 font-sans">↵</kbd> snap
        <kbd className="rounded border border-white/12 bg-white/5 px-1 font-sans">1-9</kbd> snap Nth
        <kbd className="rounded border border-white/12 bg-white/5 px-1 font-sans">esc</kbd> dismiss
        <span className="ml-auto">{candidates.length} candidate{candidates.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  )
}

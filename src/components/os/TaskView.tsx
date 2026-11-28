// REDSEC v5.0 — Task View (Win+Tab): virtual desktops overview + window management
// Windows can be DRAGGED onto a desktop card (or "New desktop") to move them — Win11 parity
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Plus, X, ArrowLeft, ArrowRight, Monitor, GripVertical } from 'lucide-react'
import { useOS, APP_META } from '@/lib/os/store'
import { AppIcon } from './AppIcon'
import { windowThumb } from '@/lib/os/media'

/* live captured thumbnail with icon fallback (shared pattern with taskbar previews) */
function Thumb({ winId, appId }: { winId: string; appId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let dead = false
    windowThumb(winId).then((u) => {
      if (!dead && u) setUrl(u)
    })
    return () => {
      dead = true
    }
  }, [winId])
  if (url) return <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover object-top" draggable={false} />
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#10141f] to-[#1a2130]">
      <AppIcon appId={appId} size={34} />
    </div>
  )
}

interface DragInfo {
  winId: string
  appId: string
  title: string
  x: number
  y: number
  moved: boolean
}

export function TaskView() {
  const open = useOS((s) => s.taskViewOpen)
  const windows = useOS((s) => s.windows)
  const vdeskCount = useOS((s) => s.vdeskCount)
  const vdeskActive = useOS((s) => s.vdeskActive)
  const installedApps = useOS((s) => s.installedApps)
  const [deskThumbs, setDeskThumbs] = useState<Record<number, string[]>>({})
  const [drag, setDrag] = useState<DragInfo | null>(null)
  const [overDesk, setOverDesk] = useState<number | 'new' | null>(null)
  const dragRef = useRef<DragInfo | null>(null)
  const suppressClickRef = useRef(false)

  /* Esc / click-outside closes; refresh per-desktop window lists for rendering */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useOS.getState().set({ taskViewOpen: false })
      if (e.key === 'Tab' && e.metaKey) {
        e.preventDefault()
        useOS.getState().set({ taskViewOpen: false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  /* capture one live thumbnail per desktop (topmost window) for the desktop cards */
  useEffect(() => {
    if (!open) return
    let dead = false
    const byDesk: Record<number, string[]> = {}
    for (const w of windows) {
      const d = w.desk ?? 0
      byDesk[d] = byDesk[d] ? [...byDesk[d], w.id] : [w.id]
    }
    const entries = Object.entries(byDesk)
    Promise.all(
      entries.map(async ([d, ids]) => {
        const topId = ids[ids.length - 1]
        const url = await windowThumb(topId)
        return [parseInt(d), url] as const
      })
    ).then((pairs) => {
      if (dead) return
      const next: Record<number, string[]> = {}
      for (const [d, url] of pairs) if (url) next[d] = [url]
      setDeskThumbs(next)
    })
    return () => {
      dead = true
    }
  }, [open, windows])

  /* ---- drag a window card onto a desktop card ---- */
  useEffect(() => {
    if (!drag) return
    const hitDesk = (x: number, y: number): number | 'new' | null => {
      const els = document.elementsFromPoint(x, y)
      for (const el of els) {
        const card = (el as HTMLElement).closest?.('[data-desk-card]')
        if (card) return parseInt((card as HTMLElement).dataset.deskCard || '0')
        const newCard = (el as HTMLElement).closest?.('[data-desk-new]')
        if (newCard) return 'new'
      }
      return null
    }
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.moved && Math.hypot(dx, dy) > 6) {
        d.moved = true
        suppressClickRef.current = true
        setDrag({ ...d })
      }
      if (d.moved) {
        const next = { ...d, x: e.clientX, y: e.clientY }
        dragRef.current = next
        setDrag(next)
        setOverDesk(hitDesk(e.clientX, e.clientY))
      }
    }
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      setOverDesk(null)
      if (!d?.moved) return
      setTimeout(() => (suppressClickRef.current = false), 0)
      const target = hitDesk(e.clientX, e.clientY)
      const st = useOS.getState()
      if (target === 'new') {
        const before = st.vdeskCount
        st.addDesktop(true) // stays inside Task View
        const s2 = useOS.getState()
        if (s2.vdeskCount > before) st.moveWinToDesktop(d.winId, s2.vdeskCount - 1)
        return
      }
      if (target !== null && target !== (st.windows.find((w) => w.id === d.winId)?.desk ?? 0)) {
        st.moveWinToDesktop(d.winId, target)
        st.notify({ title: `Moved to Desktop ${target + 1}`, body: d.title, kind: 'info', emoji: '🖥️' })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag?.winId])

  if (!open) return null

  const appName = (appId: string) =>
    appId.startsWith('inst:')
      ? installedApps.find((a) => a.id === appId.slice(5))?.name || 'App'
      : APP_META[appId]?.name || appId

  const desks = Array.from({ length: vdeskCount }, (_, i) => i)
  const curWins = windows.filter((w) => (w.desk ?? 0) === vdeskActive)

  return (
    <div
      className="fixed inset-0 z-[9500] animate-[fadeIn_0.15s_ease] select-none bg-[#0a0e18]/88 backdrop-blur-xl"
      onClick={(e) => {
        if (e.target === e.currentTarget) useOS.getState().set({ taskViewOpen: false })
      }}
    >
      {/* drag ghost */}
      {drag?.moved && (
        <div
          className="pointer-events-none fixed z-[9600] w-[196px] rotate-2 overflow-hidden rounded-lg border-2 border-sky-400/70 bg-[#151b2a] opacity-90 shadow-2xl shadow-black/70"
          style={{ left: drag.x - 98, top: drag.y - 30 }}
        >
          <div className="flex items-center gap-1.5 px-2 py-1.5">
            <AppIcon appId={drag.appId} size={15} />
            <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-slate-200">{drag.title}</span>
          </div>
        </div>
      )}
      <div className="flex h-full flex-col px-8 pb-24 pt-8">
        {/* header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Monitor className="h-5 w-5 text-sky-400" />
            <span className="text-sm font-semibold tracking-wide text-slate-200">Task View</span>
            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-400">
              {vdeskCount} desktop{vdeskCount > 1 ? 's' : ''} • {windows.length} window{windows.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-slate-500">
            <kbd className="rounded border border-white/12 bg-white/6 px-1.5 py-0.5 font-sans">Win</kbd>
            <kbd className="rounded border border-white/12 bg-white/6 px-1.5 py-0.5 font-sans">Tab</kbd>
            <span>toggle</span>
            <span className="mx-1 text-slate-700">|</span>
            <kbd className="rounded border border-white/12 bg-white/6 px-1.5 py-0.5 font-sans">Esc</kbd>
            <span>close</span>
          </div>
        </div>

        {/* desktop cards */}
        <div className="flex flex-wrap items-stretch justify-center gap-4">
          {desks.map((d) => {
            const wins = windows.filter((w) => (w.desk ?? 0) === d)
            const activeDesk = d === vdeskActive
            const thumb = deskThumbs[d]?.[0]
            const hovered = overDesk === d
            return (
              <div key={d} className="group/desk relative">
                <button
                  onClick={() => useOS.getState().switchDesktop(d)}
                  data-desk-card={d}
                  className={`flex w-[218px] flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 ${
                    hovered
                      ? 'scale-[1.05] border-sky-400 shadow-[0_0_26px_rgba(14,165,233,0.45)]'
                      : activeDesk
                        ? 'border-sky-400/80 shadow-[0_0_22px_rgba(14,165,233,0.28)] hover:scale-[1.03]'
                        : 'border-white/14 opacity-85 hover:scale-[1.03] hover:opacity-100'
                  }`}
                  title={`Switch to Desktop ${d + 1}`}
                >
                  <div className="relative h-[122px] w-full bg-gradient-to-br from-[#141a29] to-[#0d1220]">
                    {thumb ? (
                      <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover object-top opacity-95" draggable={false} />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-slate-600">
                        {wins.length === 0 ? (
                          <>
                            <Monitor className="h-7 w-7" />
                            <span className="text-[10px]">Empty desktop</span>
                          </>
                        ) : (
                          <div className="flex gap-1.5">
                            {wins.slice(0, 4).map((w) => (
                              <AppIcon key={w.id} appId={w.appId} size={26} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {hovered && (
                      <span className="absolute inset-0 flex items-center justify-center bg-sky-500/18 text-[11px] font-bold uppercase tracking-widest text-sky-200">
                        Drop to move
                      </span>
                    )}
                    {activeDesk && !hovered && <span className="absolute left-2 top-2 rounded-md bg-sky-500 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">CURRENT</span>}
                    {wins.length > 0 && <span className="absolute bottom-1.5 right-2 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold text-slate-300">{wins.length} win</span>}
                  </div>
                  <div className="flex items-center justify-between bg-[#151b2a] px-2.5 py-1.5">
                    <span className="text-[11px] font-semibold text-slate-300">Desktop {d + 1}</span>
                    <span className="text-[9.5px] text-slate-500">{wins.length === 0 ? 'No apps' : wins.slice(0, 2).map((w) => appName(w.appId)).join(', ').slice(0, 26)}</span>
                  </div>
                </button>
                {vdeskCount > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      useOS.getState().removeDesktop(d)
                    }}
                    title={`Close Desktop ${d + 1} — windows move to Desktop ${Math.max(1, d)}`}
                    className="absolute -right-2 -top-2 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-[#1a2130] text-slate-300 shadow-lg transition-colors hover:border-rose-400/60 hover:bg-rose-600 hover:text-white group-hover/desk:flex"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )
          })}
          {/* new desktop — also a drop target */}
          <button
            onClick={() => useOS.getState().addDesktop()}
            data-desk-new="1"
            className={`flex w-[150px] flex-col items-center justify-center gap-1.5 self-stretch rounded-xl border border-dashed transition-all ${
              overDesk === 'new'
                ? 'scale-105 border-sky-400 bg-sky-400/15 text-sky-200 shadow-[0_0_26px_rgba(14,165,233,0.4)]'
                : 'border-white/18 bg-white/3 text-slate-400 hover:border-sky-400/50 hover:bg-sky-400/8 hover:text-sky-300'
            }`}
            title="New desktop (Win+Ctrl+D)"
          >
            <Plus className="h-6 w-6" />
            <span className="text-[11px] font-medium">{overDesk === 'new' ? 'Drop on new desktop' : 'New desktop'}</span>
          </button>
        </div>

        {/* current desktop windows strip */}
        <div className="mt-auto">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Windows on Desktop {vdeskActive + 1}
            </span>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-400 md:flex">
                <GripVertical className="h-3 w-3 text-sky-400/70" />
                Drag a window onto a desktop above to move it
              </span>
              <button
                onClick={() => useOS.getState().cycleDesktop(-1)}
                disabled={vdeskActive === 0}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/12 bg-white/5 text-slate-300 transition-colors hover:bg-white/12 disabled:opacity-30"
                title="Previous desktop (Win+Ctrl+←)"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => useOS.getState().cycleDesktop(1)}
                disabled={vdeskActive >= vdeskCount - 1}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/12 bg-white/5 text-slate-300 transition-colors hover:bg-white/12 disabled:opacity-30"
                title="Next desktop (Win+Ctrl+→)"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex max-h-[236px] flex-wrap gap-3 overflow-y-auto os-scroll pb-1">
            {curWins.length === 0 && (
              <div className="w-full rounded-xl border border-dashed border-white/12 py-8 text-center text-xs text-slate-600">
                No windows on this desktop — open something or drag windows onto this desktop's card
              </div>
            )}
            {curWins.map((w) => (
              <div key={w.id} className={`group/win relative w-[196px] ${drag?.moved && drag.winId === w.id ? 'opacity-40' : ''}`}>
                <button
                  onClick={() => {
                    // a completed drag suppresses the click-to-focus
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false
                      return
                    }
                    useOS.getState().focusWindow(w.id)
                  }}
                  onPointerDown={(e) => {
                    const info: DragInfo = { winId: w.id, appId: w.appId, title: w.title || appName(w.appId), x: e.clientX, y: e.clientY, moved: false }
                    dragRef.current = info
                    setDrag(info)
                  }}
                  className="block w-full cursor-grab overflow-hidden rounded-lg border border-white/14 text-left shadow-lg transition-all hover:border-sky-400/60 hover:shadow-sky-500/10 active:cursor-grabbing"
                  title="Focus window — or drag onto a desktop card above"
                >
                  <div className="relative h-[108px] w-full">
                    <Thumb winId={w.id} appId={w.appId} />
                    {w.minimized && (
                      <span className="absolute bottom-1.5 left-2 z-10 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-medium text-slate-300">minimized</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 bg-[#151b2a] px-2 py-1.5">
                    <AppIcon appId={w.appId} size={13} />
                    <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-slate-300">{w.title || appName(w.appId)}</span>
                  </div>
                </button>
                {/* move-to-desktop controls */}
                <div className="absolute -top-2.5 right-1.5 z-10 hidden items-center gap-1 group-hover/win:flex">
                  {vdeskActive > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        useOS.getState().moveWinToDesktop(w.id, vdeskActive - 1)
                      }}
                      title={`Move to Desktop ${vdeskActive}`}
                      className="flex h-5.5 w-5.5 items-center justify-center rounded-full border border-white/20 bg-[#1a2130] p-1 text-slate-300 shadow hover:border-sky-400/60 hover:text-sky-300"
                    >
                      <ArrowLeft className="h-3 w-3" />
                    </button>
                  )}
                  {vdeskActive < vdeskCount - 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        useOS.getState().moveWinToDesktop(w.id, vdeskActive + 1)
                      }}
                      title={`Move to Desktop ${vdeskActive + 2}`}
                      className="flex h-5.5 w-5.5 items-center justify-center rounded-full border border-white/20 bg-[#1a2130] p-1 text-slate-300 shadow hover:border-sky-400/60 hover:text-sky-300"
                    >
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

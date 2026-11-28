// REDSEC v5.0 — Desktop: wallpaper, draggable icons, folders, context menu
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Folder } from 'lucide-react'
import { useOS, openCtx, osNow } from '@/lib/os/store'
import { REDSEC, AV } from '@/lib/os/redsec'
import { pickSkinImage } from '@/lib/os/skin'
import { fs } from '@/lib/os/fs'
import { isFullscreen, toggleFullscreen } from '@/lib/os/fullscreen'
import { AppIcon } from './AppIcon'
import { useWallpaperMedia } from './useWallpaper'
import { useClock } from './apps/_shared'
import { getDeviceSpecs } from '@/lib/os/deviceSpecs'
import type { DesktopItem } from '@/lib/os/types'

let copyBuffer: DesktopItem | null = null
export function getCopyBuffer(): DesktopItem | null {
  return copyBuffer
}

export function Desktop() {
  const {
    desktopItems, moveDesktopItem, renameDesktopItem, openApp, addDesktopItem, removeDesktopItem, sortDesktop,
    installedApps, uninstallApp, togglePin, taskbarPinned, notify, themeBg,
  } = useOS()
  const dragRef = useRef<{
    id: string
    dx: number
    dy: number
    multi: boolean
    items: { id: string; ox: number; oy: number }[]
  } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [multiDragging, setMultiDragging] = useState(false)
  const [hoverFolder, setHoverFolder] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  /* wallpaper resolution: 'stock:N' | 'custom:<nodeId>' | 'none' — video-aware */
  const wpMedia = useWallpaperMedia()
  const wpUrl = wpMedia.url
  const wpIsVideo = wpMedia.isVideo

  /* wallpaper slideshow — rotates wallpaper on an interval (persisted setting) */
  const slideshow = useOS((s) => s.wallpaperSlideshow)
  useEffect(() => {
    if (!slideshow.enabled) return
    const ms = Math.max(1, slideshow.intervalMin) * 60_000
    const iv = setInterval(() => {
      const st = useOS.getState()
      const cur = st.wallpaper
      if (slideshow.scope !== 'custom' && cur.startsWith('stock:')) {
        const n = (parseInt(cur.split(':')[1]) || 1) % 15
        st.set({ wallpaper: `stock:${n + 1}` })
      } else if (slideshow.scope !== 'stock' && cur.startsWith('custom:')) {
        // next custom wallpaper from photos
        const kids = fs.children('photos').filter((c) => c.meta && (c.meta as { kind?: string }).kind === 'wallpaper')
        if (kids.length === 0) {
          st.set({ wallpaper: 'stock:1' })
        } else {
          const idx = kids.findIndex((k) => `custom:${k.id}` === cur)
          const next = kids[(idx + 1 + kids.length) % kids.length]
          st.set({ wallpaper: `custom:${next.id}` })
        }
      } else {
        // current wallpaper not in scope — start with a matching one
        st.set({ wallpaper: slideshow.scope === 'custom' ? cur : 'stock:1' })
      }
    }, ms)
    return () => clearInterval(iv)
  }, [slideshow.enabled, slideshow.intervalMin, slideshow.scope])

  /* rubber-band selection on empty desktop */
  const [rubber, setRubber] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [rubberCount, setRubberCount] = useState(0)
  const [selIds, setSelIds] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)

  /* desktop keyboard: F2 rename · Delete remove · Ctrl+A select all */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useOS.getState().phase !== 'desktop') return
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (renamingId) return
      if (e.key === 'F2') {
        if (selIds.size === 1) {
          e.preventDefault()
          setRenamingId([...selIds][0])
        }
      } else if (e.key === 'Delete') {
        if (selIds.size === 0) return
        e.preventDefault()
        const st = useOS.getState()
        for (const id of selIds) {
          const item = st.desktopItems.find((i) => i.id === id)
          if (!item) continue
          if (item.type === 'folder' && item.folderNodeId) fs.trash(item.folderNodeId)
          st.removeDesktopItem(id)
        }
        setSelIds(new Set())
        st.notify({ title: selIds.size === 1 ? 'Removed from desktop' : `${selIds.size} items removed`, kind: 'info', emoji: '🗑️' })
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        setSelIds(new Set(useOS.getState().desktopItems.map((i) => i.id)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selIds, renamingId])

  /* focus the rename input whenever a rename starts */
  useEffect(() => {
    if (renamingId) queueMicrotask(() => renameRef.current?.select())
  }, [renamingId])

  const commitRename = () => {
    if (!renamingId) return
    const input = renameRef.current
    if (input && input.value.trim()) renameDesktopItem(renamingId, input.value)
    setRenamingId(null)
  }
  const onDesktopPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-desktop-icon]')) return
    setSelIds(new Set())
    setRubber({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY })
  }
  React.useEffect(() => {
    if (!rubber) return
    const hitsIn = (r: { x1: number; y1: number; x2: number; y2: number }) => {
      const x1 = Math.min(r.x1, r.x2)
      const x2 = Math.max(r.x1, r.x2)
      const y1 = Math.min(r.y1, r.y2)
      const y2 = Math.max(r.y1, r.y2)
      if (x2 - x1 <= 8 || y2 - y1 <= 8) return 0
      let n = 0
      for (const it of useOS.getState().desktopItems) {
        const ix = it.x + 46
        const iy = it.y + 52
        if (ix >= x1 && ix <= x2 && iy >= y1 && iy <= y2) n++
      }
      return n
    }
    const onMove = (e: PointerEvent) => {
      if (!rubber) return
      const nr = { ...rubber, x2: e.clientX, y2: e.clientY }
      setRubber(nr)
      setRubberCount(hitsIn(nr))
    }
    const onUp = () => {
      setRubber((r) => {
        if (r) {
          const x1 = Math.min(r.x1, r.x2)
          const x2 = Math.max(r.x1, r.x2)
          const y1 = Math.min(r.y1, r.y2)
          const y2 = Math.max(r.y1, r.y2)
          if (x2 - x1 > 8 && y2 - y1 > 8) {
            const hits = new Set<string>()
            for (const it of useOS.getState().desktopItems) {
              const ix = it.x + 46
              const iy = it.y + 52
              if (ix >= x1 && ix <= x2 && iy >= y1 && iy <= y2) hits.add(it.id)
            }
            setSelIds(hits)
          }
        }
        return null
      })
      setRubberCount(0)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [rubber])

  const onPointerDown = (e: React.PointerEvent, item: DesktopItem) => {
    e.stopPropagation()
    /* multi-drag: plain-press on an item already inside a multi-selection drags the whole group */
    const groupIds = !e.ctrlKey && !e.shiftKey && selIds.has(item.id) && selIds.size > 1
      ? [...selIds]
      : [item.id]
    const st = useOS.getState()
    const items = groupIds.map((gid) => {
      const it = st.desktopItems.find((d) => d.id === gid)
      return it ? { id: gid, ox: it.x - item.x, oy: it.y - item.y } : null
    }).filter((x): x is { id: string; ox: number; oy: number } => !!x)
    dragRef.current = { id: item.id, dx: e.clientX - item.x, dy: e.clientY - item.y, multi: items.length > 1, items }
    setDraggingId(item.id)
    setMultiDragging(items.length > 1)
  }

  React.useEffect(() => {
    if (!draggingId) return
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const x = Math.max(4, e.clientX - d.dx)
      const y = Math.max(4, Math.min(e.clientY, window.innerHeight - 140) - d.dy)
      if (d.multi) {
        for (const it of d.items) {
          moveDesktopItem(it.id, Math.max(4, x + it.ox), Math.max(4, Math.min(y + it.oy, window.innerHeight - 140)))
        }
      } else {
        moveDesktopItem(d.id, x, y)
      }
      // hover over a folder target? (single-item drags only)
      if (!d.multi) {
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const folderEl = el?.closest('[data-folder-icon]')
        setHoverFolder(folderEl?.getAttribute('data-folder-icon') || null)
      }
    }
    const onUp = () => {
      const d = dragRef.current
      if (d && !d.multi && hoverFolder && hoverFolder !== d.id) {
        const item = useOS.getState().desktopItems.find((i) => i.id === d.id)
        const folderNode = useOS.getState().desktopItems.find((i) => i.id === hoverFolder)
        if (item && folderNode?.folderNodeId) {
          // move item into folder meta (persisted in FS node)
          const folder = fs.get(folderNode.folderNodeId)
          if (folder) {
            const meta = folder.meta || {}
            const items = Array.isArray(meta.items) ? (meta.items as DesktopItem[]) : []
            folder.meta = { ...meta, items: [...items, item] }
          }
          useOS.getState().removeDesktopItem(item.id)
          notify({ title: `Moved "${item.label}" into folder`, kind: 'success', emoji: '📁' })
        }
      }
      dragRef.current = null
      setDraggingId(null)
      setMultiDragging(false)
      setHoverFolder(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [draggingId, hoverFolder, moveDesktopItem, notify])

  const desktopCtx = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      openCtx(e.clientX, e.clientY, [
        { label: 'Refresh', icon: '🔄', onClick: () => setRefreshKey((k) => k + 1) },
        { separator: true },
        { label: 'New folder', icon: '📁', onClick: async () => {
            const node = await fs.createFolder('desktop', 'New folder')
            const maxRow = Math.max(-1, ...useOS.getState().desktopItems.filter((i) => i.x < 140).map((i) => Math.round((i.y - 24) / 100)))
            addDesktopItem({ id: `desk_f_${node.id}`, type: 'folder', folderNodeId: node.id, label: node.name, x: 24, y: 24 + (maxRow + 1) * 100 })
          } },
        { label: 'Open Terminal', icon: '⌨️', onClick: () => openApp('terminal') },
        { label: 'Open File Manager', icon: '📂', onClick: () => openApp('filemanager') },
        { separator: true },
        ...(getCopyBuffer()
          ? [{ label: `Paste shortcut — ${getCopyBuffer()!.label}`, icon: '📋', onClick: () => {
                const src = getCopyBuffer()!
                if (!src.appId) return
                const maxRow = Math.max(-1, ...useOS.getState().desktopItems.filter((i) => i.x < 140).map((i) => Math.round((i.y - 24) / 100)))
                addDesktopItem({ id: `desk_sc_${Date.now().toString(36)}`, type: 'shortcut', appId: src.appId, label: `${src.label} (Shortcut)`, x: 24, y: 24 + (maxRow + 1) * 100 })
                copyBuffer = null
              } }]
          : []),
        { separator: true },
        { label: 'Sort by name', icon: '🔤', onClick: () => sortDesktop('name') },
        { label: 'Sort by size', icon: '📊', onClick: () => sortDesktop('size') },
        { label: 'Sort by type', icon: '🧩', onClick: () => sortDesktop('type') },
        { separator: true },
        { label: useOS.getState().desktopWidgets ? 'Hide desktop widgets' : 'Show desktop widgets', icon: '🧩', onClick: () => useOS.getState().set({ desktopWidgets: !useOS.getState().desktopWidgets }) },
        { label: isFullscreen() ? 'Exit full screen' : 'Full screen', icon: '⛶', onClick: () => void toggleFullscreen() },
        { label: 'Next wallpaper', icon: '🖼️', onClick: () => {
            const cur = useOS.getState().wallpaper
            if (cur.startsWith('stock:')) {
              const n = parseInt(cur.split(':')[1]) || 1
              useOS.getState().set({ wallpaper: `stock:${(n % 15) + 1}` })
            } else useOS.getState().set({ wallpaper: 'stock:1' })
          } },
      ])
    },
    [addDesktopItem, openApp, sortDesktop]
  )

  const itemCtx = (e: React.MouseEvent, item: DesktopItem) => {
    e.preventDefault()
    e.stopPropagation()
    const isInstalled = item.appId?.startsWith('inst:')
    const customIconId = item.appId ? useOS.getState().customIconIds[item.appId] : undefined
    openCtx(e.clientX, e.clientY, [
      { label: 'Open', icon: '🚀', onClick: () => openItem(item) },
      { separator: true },
      { label: taskbarPinned.includes(item.appId || '') ? 'Unpin from taskbar' : 'Pin to taskbar', icon: '📌', onClick: () => item.appId && togglePin(item.appId) },
      { label: 'Copy', icon: '📋', onClick: () => { copyBuffer = item; notify({ title: 'Copied — right-click desktop to paste shortcut', kind: 'info' }) } },
      { label: 'Rename', icon: '✏️', onClick: () => setRenamingId(item.id) },
      /* Task 19 — icon skin: any .png/.jpg/.gif/.svg… image, saved forever */
      ...(item.type !== 'folder' && item.appId
        ? [
            { label: 'Customize icon image…', icon: '🖼️', onClick: () => pickSkinImage(
                (nodeId, name) => { useOS.getState().setSkinImage('icon', nodeId, item.appId); useOS.getState().notify({ title: `Icon image applied — ${item.label}`, body: name, kind: 'success', emoji: '🖼️' }) },
                (msg) => useOS.getState().notify({ title: msg, kind: 'error' })
              ) },
            { label: 'Reset icon image', icon: '↺', disabled: !customIconId, onClick: () => { useOS.getState().clearSkinImage('icon', item.appId); useOS.getState().notify({ title: `Icon reset — ${item.label}`, kind: 'info' }) } },
            { separator: true },
          ]
        : []),
      { label: 'Properties', icon: 'ℹ️', onClick: () => showProperties(item, installedApps) },
      ...(item.type === 'folder'
        ? [{ label: 'Delete folder', icon: '🗑️', danger: true, onClick: () => { removeDesktopItem(item.id); if (item.folderNodeId) fs.trash(item.folderNodeId) } } as never]
        : []),
      ...(isInstalled
        ? [{ label: 'Uninstall app', icon: '🗑️', danger: true, onClick: () => { uninstallApp(item.appId!.slice(5)); notify({ title: `${item.label} uninstalled`, kind: 'success' }) } } as never]
        : []),
      ...(!['filemanager', 'browser', 'terminal', 'settings', 'appstore'].includes(item.appId || '')
        ? [{ label: 'Remove from desktop', icon: '✖️', danger: true, onClick: () => removeDesktopItem(item.id) } as never]
        : []),
    ])
  }

  const openItem = (item: DesktopItem) => {
    if (item.type === 'folder' && item.folderNodeId) {
      openApp('filemanager', { nodeId: item.folderNodeId })
    } else if (item.appId) {
      openApp(item.appId)
    }
  }

  const showProperties = (item: DesktopItem, installed: ReturnType<typeof useOS.getState>['installedApps']) => {
    const isInst = item.appId?.startsWith('inst:')
    const inst = isInst ? installed.find((a) => a.id === item.appId?.slice(5)) : null
    openApp('settings', { properties: { name: item.label, kind: item.type, appId: item.appId || '-', installedAt: inst?.installedAt ? new Date(inst.installedAt).toLocaleString() : 'Built-in', version: inst?.version || '4.0.0', publisher: inst?.publisher || 'REDSEC', status: inst?.status || 'system' } })
  }

  return (
    <div data-desktop-surface="" className="absolute inset-0 overflow-hidden" style={{ background: themeBg }} onContextMenu={desktopCtx} onPointerDown={onDesktopPointerDown}>
      {/* wallpaper layer — os-uninvert keeps photos, GIF & video live wallpapers true-colored in light theme */}
      {wpUrl && wpIsVideo && (
        <video
          key={wpUrl}
          src={wpUrl}
          autoPlay
          loop
          playsInline
          data-os-wall="1"
          ref={(el) => {
            if (el) el.muted = true /* React muted prop quirk — force property */
          }}
          className="os-uninvert pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      )}
      {wpUrl && !wpIsVideo && (
        <div
          className="os-uninvert pointer-events-none absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${wpUrl})` }}
        />
      )}
      {wpUrl && <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 via-black/10 to-black/45" />}
      <DesktopWidgets />
      {desktopItems.map((item) => (
        <div
          key={item.id}
          data-folder-icon={item.type === 'folder' ? item.id : undefined}
          data-desktop-icon={item.id}
          className={`absolute flex w-[92px] cursor-default flex-col items-center gap-1 rounded-lg p-2 text-center transition-shadow ${
            draggingId === item.id ? 'z-50 opacity-90 shadow-2xl' : ''
          } ${multiDragging && selIds.has(item.id) && draggingId !== item.id ? 'opacity-80' : ''} ${selIds.has(item.id) ? 'bg-sky-400/15 ring-2 ring-sky-400/70' : hoverFolder === item.id ? 'bg-sky-400/20 ring-2 ring-sky-400' : 'hover:bg-white/8'}`}
          style={{ left: item.x, top: item.y }}
          onPointerDown={(e) => {
            if (e.ctrlKey) setSelIds((prev) => {
              const nx = new Set(prev)
              if (nx.has(item.id)) nx.delete(item.id)
              else nx.add(item.id)
              return nx
            })
            else if (e.shiftKey) setSelIds((prev) => new Set([...prev, item.id]))
            else if (!selIds.has(item.id) || selIds.size !== 1) setSelIds(new Set([item.id]))
            onPointerDown(e, item)
          }}
          onDoubleClick={() => openItem(item)}
          onContextMenu={(e) => {
            if (!selIds.has(item.id)) setSelIds(new Set([item.id]))
            itemCtx(e, item)
          }}
        >
          {item.type === 'folder' ? (
            <Folder className="h-11 w-11 fill-amber-400/80 text-amber-200 drop-shadow" strokeWidth={1.2} />
          ) : (
            <AppIcon appId={item.appId || ''} size={44} />
          )}
          {renamingId === item.id ? (
            <input
              ref={renameRef}
              defaultValue={item.label}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') commitRename()
                else if (e.key === 'Escape') setRenamingId(null)
              }}
              onBlur={commitRename}
              className="w-full rounded border border-sky-400/70 bg-[#10141f]/95 px-1 py-0.5 text-center text-[11px] text-white outline-none"
              aria-label="Rename item"
            />
          ) : (
            <span
              className={`line-clamp-2 rounded px-1 text-[11px] font-medium leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] ${
                selIds.has(item.id) ? 'bg-sky-600/45' : ''
              }`}
            >
              {item.label}
            </span>
          )}
        </div>
      ))}
      {/* rubber-band selection rectangle */}
      {rubber && (
        <div
          className="pointer-events-none fixed z-[70] rounded border border-sky-300/80 bg-sky-400/10"
          style={{
            left: Math.min(rubber.x1, rubber.x2),
            top: Math.min(rubber.y1, rubber.y2),
            width: Math.abs(rubber.x2 - rubber.x1),
            height: Math.abs(rubber.y2 - rubber.y1),
          }}
        >
          {rubberCount > 0 && (
            <span
              className="absolute left-1/2 -translate-x-1/2 rounded-md border border-sky-400/50 bg-[#10141f]/95 px-2 py-0.5 text-[10px] font-semibold text-sky-300 shadow-lg"
              style={{ top: Math.min(rubber.y1, rubber.y2) < 34 ? 8 : -28 }}
            >
              {rubberCount} selected
            </span>
          )}
        </div>
      )}
      {/* hidden refresh marker */}
      <span className="hidden" data-refresh={refreshKey} />
      {/* build watermark */}
      <div className="pointer-events-none absolute bottom-14 right-3 z-[4] select-none text-right text-[10.5px] leading-snug text-white/45 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
        <div>{REDSEC.distro} {REDSEC.version} — Secure Edition</div>
        <div>{REDSEC.baseName} • Build {REDSEC.build} • {AV.product} {AV.engine} active</div>
      </div>
    </div>
  )
}

function DesktopWidgets() {
  const enabled = useOS((s) => s.desktopWidgets)
  const wClock = useOS((s) => s.widgetClock)
  const wWeather = useOS((s) => s.widgetWeather)
  const wNews = useOS((s) => s.widgetNews)
  const wCalendar = useOS((s) => s.widgetCalendar)
  const wPerf = useOS((s) => s.widgetPerf)
  /* keep the stack clear of a vertical / top dock (Task 26) */
  const tbPos = useOS((s) => s.taskbarPos)
  const tbAutoHide = useOS((s) => s.taskbarAutoHide)
  const offRight = tbPos === 'right' && !tbAutoHide
  const offTop = tbPos === 'top' && !tbAutoHide
  if (!enabled) return null
  const any = wClock || wWeather || wNews || wCalendar || wPerf
  if (!any) return null
  return (
    <div
      className="absolute z-[5] hidden w-[252px] select-none flex-col gap-2.5 pb-2 sm:flex max-h-[calc(100dvh-110px)] overflow-y-auto os-scroll-nobar"
      style={{ right: offRight ? 72 : 16, top: offTop ? 68 : 16 }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {wPerf && <PerfWidget />}
      {wClock && <ClockWidget />}
      {wWeather && <WeatherWidget />}
      {wNews && <NewsWidget />}
      {wCalendar && <CalendarWidget />}
    </div>
  )
}

/* ---------------- Clock widget — digital / retro / analog / classics / pageflip ---------------- */

function ClockWidget() {
  const style = useOS((s) => s.widgetClockStyle)
  if (style === 'analog') return <AnalogClockCard roman={false} />
  if (style === 'classics') return <AnalogClockCard roman />
  if (style === 'retro') return <RetroClockCard />
  if (style === 'pageflip') return <PageFlipCard />
  return <DigitalClockCard />
}

function DigitalClockCard() {
  const autoTime = useOS((s) => s.autoTime)
  const manualClock = useOS((s) => s.manualClock)
  useClock(1000)
  const d = osNow(autoTime, manualClock)
  const hours = d.getHours()
  const greeting = hours < 5 ? 'Good night' : hours < 12 ? 'Good morning' : hours < 17 ? 'Good afternoon' : hours < 21 ? 'Good evening' : 'Good night'
  return (
    <div className="animate-[widgetIn_0.35s_ease] rounded-2xl border border-white/14 bg-black/32 p-4 text-white shadow-2xl shadow-black/40 backdrop-blur-md">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-sky-300/90">{greeting}</div>
      <div className="mt-1 text-[42px] font-bold leading-none tabular-nums tracking-tight drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]">
        {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="mt-1.5 text-xs text-white/75">{d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div className="mt-3 border-t border-white/12 pt-2.5 text-[11px] text-white/60">
        {REDSEC.distro} {REDSEC.version.replace('v', '')} • {d.toLocaleDateString([], { year: 'numeric' })}
      </div>
    </div>
  )
}

/* retro — amber CRT terminal clock with glow, blinking colon + scanlines */
function RetroClockCard() {
  const autoTime = useOS((s) => s.autoTime)
  const manualClock = useOS((s) => s.manualClock)
  useClock(1000)
  const d = osNow(autoTime, manualClock)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return (
    <div className="relative animate-[widgetIn_0.35s_ease] overflow-hidden rounded-2xl border border-amber-500/30 bg-[#14100a]/90 p-4 shadow-2xl shadow-black/40 backdrop-blur-md">
      {/* CRT scanlines */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.16]" style={{ background: 'repeating-linear-gradient(0deg, transparent 0 2px, #fbbf24 2px 3px)' }} aria-hidden />
      <div className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-amber-500/90">▚▞ REDSEC retro</div>
      <div
        className="mt-1.5 font-mono text-[38px] font-bold leading-none tabular-nums text-amber-300"
        style={{ textShadow: '0 0 14px rgba(251,191,36,0.75), 0 0 34px rgba(251,146,60,0.35)' }}
      >
        {hh}
        <span className="animate-pulse">:</span>
        {mm}
        <span className="ml-1.5 align-top font-mono text-[14px] text-amber-500/80">:{ss}</span>
      </div>
      <div className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-amber-500/75">
        {d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
      </div>
      <div className="mt-2.5 border-t border-amber-500/20 pt-2 font-mono text-[10px] tracking-wider text-amber-600/80">SYS.CLOCK // V5.1</div>
    </div>
  )
}

/* analog / classics — real ticking SVG clock; classics wears a roman-numeral railway face */
function AnalogClockCard({ roman }: { roman?: boolean }) {
  const autoTime = useOS((s) => s.autoTime)
  const manualClock = useOS((s) => s.manualClock)
  useClock(1000)
  const d = osNow(autoTime, manualClock)
  const sec = d.getSeconds()
  const min = d.getMinutes() + sec / 60
  const hr = (d.getHours() % 12) + min / 60
  const secAng = sec * 6
  const minAng = min * 6
  const hrAng = hr * 30
  const numerals = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']
  return (
    <div className="animate-[widgetIn_0.35s_ease] rounded-2xl border border-white/14 bg-black/32 p-4 text-white shadow-2xl shadow-black/40 backdrop-blur-md">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-sky-300/90">
        {roman ? 'Classics' : 'Analog'}
      </div>
      <div className="mt-2 flex items-center gap-3.5">
        <svg width="118" height="118" viewBox="0 0 120 120" role="img" aria-label={`${roman ? 'Classic' : 'Analog'} clock`}>
          <circle cx="60" cy="60" r="56" fill={roman ? '#f5f1e6' : '#10141f'} stroke={roman ? '#b91c1c' : 'rgba(255,255,255,0.25)'} strokeWidth={roman ? 5 : 2} />
          {roman
            ? numerals.map((n, i) => {
                const ang = ((i * 30 - 90) * Math.PI) / 180
                return (
                  <text
                    key={n}
                    x={60 + 44 * Math.cos(ang)}
                    y={60 + 44 * Math.sin(ang) + 3.5}
                    textAnchor="middle"
                    fontSize="10.5"
                    fontWeight="700"
                    fill="#1c1917"
                    fontFamily="Georgia, 'Times New Roman', serif"
                  >
                    {n}
                  </text>
                )
              })
            : Array.from({ length: 12 }, (_, i) => {
                const ang = ((i * 30 - 90) * Math.PI) / 180
                const long = i % 3 === 0
                return (
                  <line
                    key={i}
                    x1={60 + (long ? 42 : 46) * Math.cos(ang)}
                    y1={60 + (long ? 42 : 46) * Math.sin(ang)}
                    x2={60 + 52 * Math.cos(ang)}
                    y2={60 + 52 * Math.sin(ang)}
                    stroke={long ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)'}
                    strokeWidth={long ? 2.4 : 1.4}
                    strokeLinecap="round"
                  />
                )
              })}
          {/* hour hand */}
          <line x1="60" y1="60" x2={60 + 26 * Math.sin((hrAng * Math.PI) / 180)} y2={60 - 26 * Math.cos((hrAng * Math.PI) / 180)} stroke={roman ? '#1c1917' : '#e2e8f0'} strokeWidth="4.6" strokeLinecap="round" />
          {/* minute hand */}
          <line x1="60" y1="60" x2={60 + 40 * Math.sin((minAng * Math.PI) / 180)} y2={60 - 40 * Math.cos((minAng * Math.PI) / 180)} stroke={roman ? '#1c1917' : '#e2e8f0'} strokeWidth="3" strokeLinecap="round" />
          {/* second hand */}
          <line x1={60 - 8 * Math.sin((secAng * Math.PI) / 180)} y1={60 + 8 * Math.cos((secAng * Math.PI) / 180)} x2={60 + 46 * Math.sin((secAng * Math.PI) / 180)} y2={60 - 46 * Math.cos((secAng * Math.PI) / 180)} stroke="#38bdf8" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="60" cy="60" r="3.4" fill={roman ? '#0369a1' : '#38bdf8'} />
        </svg>
        <div className="min-w-0">
          <div className="text-lg font-bold tabular-nums leading-tight">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-white/70">{d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <div className="mt-2 text-[10px] uppercase tracking-wider text-white/45">{roman ? 'Roman railway face' : 'Ticking seconds'}</div>
        </div>
      </div>
    </div>
  )
}

/* page flip — big white flip cards that tumble over each minute */
function PageFlipCard() {
  const autoTime = useOS((s) => s.autoTime)
  const manualClock = useOS((s) => s.manualClock)
  useClock(1000)
  const d = osNow(autoTime, manualClock)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const tick = `${d.getHours()}${d.getMinutes()}`
  return (
    <div className="animate-[widgetIn_0.35s_ease] rounded-2xl border border-white/14 bg-black/32 p-4 text-white shadow-2xl shadow-black/40 backdrop-blur-md">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-sky-300/90">Page flip</div>
      <div className="mt-2 flex items-center justify-center gap-1.5 [perspective:600px]">
        <FlipDigit ch={hh[0]} tick={tick} />
        <FlipDigit ch={hh[1]} tick={tick} />
        <span className="px-0.5 text-[30px] font-bold text-white/85">:</span>
        <FlipDigit ch={mm[0]} tick={tick} />
        <FlipDigit ch={mm[1]} tick={tick} />
      </div>
      <div className="mt-2.5 text-center text-xs text-white/75">{d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </div>
  )
}

/* one page-flip digit — remounts (and therefore tumbles) whenever the minute changes */
function FlipDigit({ ch, tick }: { ch: string; tick: string }) {
  return (
    <span key={`${ch}-${tick}`} className="inline-flex h-[52px] w-[40px] items-center justify-center rounded-lg bg-gradient-to-b from-[#f8fafc] to-[#cbd5e1] text-[34px] font-bold tabular-nums text-[#0f172a] shadow-[inset_0_-2px_0_rgba(0,0,0,0.18),0_3px_8px_rgba(0,0,0,0.45)] [transform-origin:top_center] animate-[flipCard_0.5s_ease]">
      {ch}
    </span>
  )
}

/* ---------------- Weather widget (real-time, poll 5 min) ---------------- */
interface MiniWeather {
  temp: number
  code: number
  place: string
  at: number // client fetch time (ms) — drives the localStorage freshness window
  sim?: boolean // rendered from the offline seasonal model, not the live API
  trend?: number[] // next ~12 hourly temperatures for the mini graph
  fetchedAt?: number // server observation time (ms) — drives the "updated X ago" chip
}

let weatherFailStreak = 0

const CACHE_KEY = 'redsec4.weather'
const WEATHER_POLL_MS = 5 * 60 * 1000 // real-time: re-poll the live observation every 5 minutes

function wmoEmoji(code: number): string {
  if (code === 0) return '☀️'
  if (code === 1 || code === 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code === 45 || code === 48) return '🌫️'
  if (code >= 51 && code <= 57) return '🌦️'
  if (code >= 61 && code <= 67) return '🌧️'
  if (code >= 71 && code <= 77) return '🌨️'
  if (code >= 80) return '🌧️'
  if (code >= 95) return '⛈️'
  return '🌡️'
}

/** minutes since the server fetched the observation → "just now / 2m ago" */
function agoMini(fetchedAt: number | undefined): string {
  if (!fetchedAt) return 'syncing…'
  const s = Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000))
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`
}

/** hand-drawn sparkline of the next hours (no chart libs) */
function TrendSpark({ temps, height = 32 }: { temps: number[]; height?: number }) {
  if (temps.length < 2) return null
  const W = 200
  const H = height
  const min = Math.min(...temps)
  const max = Math.max(...temps)
  const span = max - min || 1
  const pts = temps.map((t, i) => {
    const x = (i / (temps.length - 1)) * (W - 6) + 3
    const y = H - 5 - ((t - min) / span) * (H - 12)
    return { x, y }
  })
  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Next hours temperature trend">
      <polyline points={`3,${H - 2} ${line} ${W - 3},${H - 2}`} fill="rgba(56,189,248,0.18)" stroke="none" />
      <polyline points={line} fill="none" stroke="#7dd3fc" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[0].x} cy={pts[0].y} r="2.2" fill="#7dd3fc" />
    </svg>
  )
}

function WeatherWidget() {
  useClock(30_000) // keeps the "updated X ago" chip honest
  const [weather, setWeather] = useState<MiniWeather | null>(null)
  const [weatherDead, setWeatherDead] = useState(false) // network unreachable → retry button
  const deadRef = useRef(false)

  /* real-time loader — seeds from localStorage, then polls the server proxy
     (2-min fresh Open-Meteo observation) every 5 minutes */
  const loadWeather = useCallback((bypass = false) => {
    return fetch(`/api/weather${bypass ? '?refresh=1' : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (j: {
          ok?: boolean
          simulated?: boolean
          fetchedAt?: number
          current?: { temperature_2m: number; weather_code: number; time?: string }
          hourly?: { time: string[]; temperature_2m: number[] } | null
        }) => {
          if (deadRef.current || !j.current) return
          /* next ~12h of temps starting at the observation hour (works for hourly
             Open-Meteo data and 3-hourly wttr.in fallback alike) */
          let trend: number[] | undefined
          if (j.hourly?.time?.length && j.hourly.temperature_2m?.length) {
            const times = j.hourly.time
            const temps = j.hourly.temperature_2m
            const nowHour = j.current.time?.slice(0, 13)
            let idx = nowHour ? times.findIndex((t) => t.slice(0, 13) === nowHour) : -1
            if (idx < 0) idx = Math.max(0, times.findIndex((t) => new Date(t).getTime() >= Date.now() - 3_600_000))
            const endMs = new Date(times[idx]).getTime() + 12 * 3_600_000
            const picked: number[] = []
            for (let i = idx; i < times.length && picked.length < 16; i++) {
              const tm = new Date(times[i]).getTime()
              if (Number.isFinite(endMs) && tm > endMs) break
              picked.push(temps[i])
            }
            trend = picked
          }
          const w: MiniWeather = {
            temp: Math.round(j.current.temperature_2m),
            code: j.current.weather_code,
            place: 'Kolkata',
            at: Date.now(),
            sim: !j.ok,
            trend,
            fetchedAt: j.fetchedAt,
          }
          weatherFailStreak = 0
          setWeatherDead(false)
          setWeather(w)
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(w))
          } catch {}
        }
      )
      .catch(() => {
        if (deadRef.current) return
        weatherFailStreak += 1
        if (weatherFailStreak >= 2) setWeatherDead(true) // offline: show retry card
      })
  }, [])

  useEffect(() => {
    deadRef.current = false
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (raw) {
        const w = JSON.parse(raw) as MiniWeather
        if (Date.now() - w.at < 30 * 60 * 1000) queueMicrotask(() => setWeather(w))
      }
    } catch {}
    void loadWeather(false)
    const iv = setInterval(() => void loadWeather(false), WEATHER_POLL_MS)
    return () => {
      deadRef.current = true
      clearInterval(iv)
    }
  }, [loadWeather])

  return (
    <div className="animate-[widgetIn_0.45s_ease] rounded-2xl border border-white/14 bg-black/32 p-3.5 text-white shadow-2xl shadow-black/40 backdrop-blur-md">
      {weather ? (
        <>
          <div className="flex items-center gap-3">
            <span className="text-3xl leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">{wmoEmoji(weather.code)}</span>
            <div className="min-w-0">
              <div className="text-xl font-bold leading-tight tabular-nums">{weather.temp}°C</div>
              <div className="truncate text-[11px] text-white/70">{weather.place} • {weather.sim ? 'offline estimate' : 'live weather'}</div>
            </div>
            {weather.sim && (
              <span className="flex-none rounded-full border border-amber-300/30 bg-amber-400/15 px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider text-amber-200">sim</span>
            )}
            <button
              onClick={() => useOS.getState().openApp('weather')}
              className="ml-auto flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-white/10 text-[10px] text-white/80 transition-colors hover:bg-white/20"
              title="Open Weather"
            >
              ↗
            </button>
          </div>
          {weather.trend && weather.trend.length > 1 && (
            <div className="mt-2.5 border-t border-white/10 pt-2">
              <div className="mb-0.5 flex items-center justify-between text-[9px] uppercase tracking-wider text-white/45">
                <span>next 12h · temperature</span>
                <span className="tabular-nums text-sky-300/90">
                  {Math.round(Math.min(...weather.trend))}° – {Math.round(Math.max(...weather.trend))}°
                </span>
              </div>
              <TrendSpark temps={weather.trend} />
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[9.5px] text-white/45">
              {!weather.sim && (
                <span className="relative flex h-1 w-1">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-300 opacity-60" />
                  <span className="relative inline-flex h-1 w-1 rounded-full bg-sky-300" />
                </span>
              )}
              updated {agoMini(weather.fetchedAt ?? weather.at)} · auto-refresh 5 min
            </span>
            <button
              onClick={() => void loadWeather(true)}
              className="flex h-5 w-5 items-center justify-center rounded text-[11px] text-white/50 transition-colors hover:bg-white/10 hover:text-sky-200"
              title="Refresh now (live fetch)"
              aria-label="Refresh weather"
            >
              ↻
            </button>
          </div>
        </>
      ) : weatherDead ? (
        <div className="flex items-center gap-2.5">
          <span className="text-xl leading-none">📴</span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-white/80">Weather unavailable</div>
            <div className="text-[10px] text-white/50">Network is unreachable</div>
          </div>
          <button
            onClick={() => {
              setWeatherDead(false)
              weatherFailStreak = 0
              setWeather(null)
              void loadWeather(true)
            }}
            className="flex h-8 flex-none items-center rounded-lg bg-sky-500/20 px-2.5 text-[10.5px] font-semibold text-sky-200 ring-1 ring-sky-400/40 transition-colors hover:bg-sky-500/35"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-white/60">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/25 border-t-sky-300" />
          Loading weather…
        </div>
      )}
    </div>
  )
}

/* ---------------- News widget — latest headlines, auto-refresh 10 min ---------------- */

interface NewsItem {
  title: string
  link: string
  source?: string
  pubDate?: string
}

const NEWS_POLL_MS = 10 * 60 * 1000

function NewsWidget() {
  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [dead, setDead] = useState(false)
  const deadRef = useRef(false)
  const load = useCallback((bypass = false) => {
    return fetch(`/api/news${bypass ? '?refresh=1' : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { items?: NewsItem[] }) => {
        if (deadRef.current) return
        setItems(Array.isArray(j.items) ? j.items.slice(0, 4) : [])
        setDead(false)
      })
      .catch(() => {
        if (deadRef.current) return
        setDead(true)
      })
  }, [])
  useEffect(() => {
    deadRef.current = false
    void load(false)
    const iv = setInterval(() => void load(false), NEWS_POLL_MS)
    return () => {
      deadRef.current = true
      clearInterval(iv)
    }
  }, [load])

  return (
    <div className="animate-[widgetIn_0.5s_ease] rounded-2xl border border-white/14 bg-black/32 p-3.5 text-white shadow-2xl shadow-black/40 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-rose-300/90">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-400" />
          </span>
          Latest news
        </div>
        <button
          onClick={() => useOS.getState().openApp('browser')}
          className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-[10px] text-white/80 transition-colors hover:bg-white/20"
          title="Open Web Browser"
        >
          ↗
        </button>
      </div>
      {items && items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {items.map((n, i) => (
            <li key={`${i}-${n.link.slice(-24)}`}>
              <button
                onClick={() => useOS.getState().openApp('browser', { url: n.link })}
                className="w-full rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-white/10"
                title={n.title}
              >
                <div className="line-clamp-2 text-[11.5px] leading-snug text-white/90">{n.title}</div>
                <div className="mt-0.5 truncate text-[9.5px] text-white/45">{n.source || 'News'}{n.pubDate ? ` · ${new Date(n.pubDate).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : ''}</div>
              </button>
            </li>
          ))}
        </ul>
      ) : dead ? (
        <div className="mt-2.5 flex items-center gap-2 text-[11px] text-white/60">
          <span>📡</span>
          <span className="min-w-0 flex-1">News unavailable offline</span>
          <button
            onClick={() => void load(true)}
            className="flex h-7 flex-none items-center rounded-lg bg-sky-500/20 px-2.5 text-[10.5px] font-semibold text-sky-200 ring-1 ring-sky-400/40 hover:bg-sky-500/35"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="mt-2.5 flex items-center gap-2 text-[11px] text-white/60">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/25 border-t-rose-300" />
          Loading headlines…
        </div>
      )}
      <div className="mt-1.5 border-t border-white/10 pt-1.5 text-[9px] text-white/40">auto-refresh 10 min · tap a headline to read in Browser</div>
    </div>
  )
}

/* ---------------- Calendar widget — mini month grid, today highlighted ---------------- */

const WEEKDAYS_MIN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function CalendarWidget() {
  const autoTime = useOS((s) => s.autoTime)
  const manualClock = useOS((s) => s.manualClock)
  useClock(30_000)
  const d = osNow(autoTime, manualClock)
  const year = d.getFullYear()
  const month = d.getMonth()
  const today = d.getDate()
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: Array<number | null> = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  return (
    <div className="animate-[widgetIn_0.55s_ease] rounded-2xl border border-white/14 bg-black/32 p-3.5 text-white shadow-2xl shadow-black/40 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-sky-300/90">
          {d.toLocaleDateString([], { month: 'long', year: 'numeric' })}
        </div>
        <button
          onClick={() => useOS.getState().openApp('wdt', { tab: 'date' })}
          className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-[10px] text-white/80 transition-colors hover:bg-white/20"
          title="Open WDT ▸ Date"
        >
          ↗
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-y-0.5 text-center">
        {WEEKDAYS_MIN.map((w) => (
          <div key={w} className="text-[9px] font-semibold uppercase text-white/40">{w}</div>
        ))}
        {cells.map((c, i) => (
          <div key={i} className="flex items-center justify-center">
            {c ? (
              <span
                className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10.5px] tabular-nums ${
                  c === today
                    ? 'bg-sky-500 font-bold text-white shadow-[0_0_10px_rgba(14,165,233,0.55)]'
                    : 'text-white/80'
                }`}
              >
                {c}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-1.5 border-t border-white/10 pt-1.5 text-center text-[9px] text-white/40">
        {d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </div>
    </div>
  )
}

/* ---------------- Performance widget — Task 66: live GPU · CPU · FPS ----------------
 * FPS is REAL (requestAnimationFrame frame deltas). CPU/GPU load is a smooth
 * simulation driven by what the OS is actually doing: open windows, the focused
 * app, drivers on/off and a per-tick random walk — the same model the Booster
 * App console uses. Click opens the Booster App.
 */

const PERF_HIST = 28 // sparkline slots per metric

function PerfWidget() {
  const [fps, setFps] = useState(60)
  const [cpu, setCpu] = useState(18)
  const [gpu, setGpu] = useState(12)
  const [gpuName, setGpuName] = useState('vxr-graphics')
  const [ram, setRam] = useState(4.2)
  const histRef = useRef<{ f: number[]; c: number[]; g: number[] }>({ f: [], c: [], g: [] })
  const [, forceTick] = useState(0)
  const windows = useOS((s) => s.windows)
  const focusedWin = useOS((s) => s.focusedWin)
  const drivers = useOS((s) => s.drivers)
  const winCount = windows.length
  const gpuBoosted = focusedWin === 'gpu' // Booster App open → GPU is working

  /* real FPS — count rAF frames over a 500 ms window */
  useEffect(() => {
    let frames = 0
    let raf = 0
    let last = performance.now()
    const loop = (t: number) => {
      frames++
      if (t - last >= 500) {
        const v = Math.min(240, Math.round((frames * 1000) / (t - last)))
        setFps(v)
        frames = 0
        last = t
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  /* CPU / GPU / RAM model — 1 s random walk toward a load target */
  useEffect(() => {
    let dead = false
    void getDeviceSpecs()
      .then((specs) => {
        if (!dead && specs?.gpu && specs.gpu !== 'GPU n/a') setGpuName(specs.gpu.slice(0, 22))
      })
      .catch(() => undefined)
    const iv = setInterval(() => {
      const base = 8 + winCount * 4.5 + (gpuBoosted ? 14 : 0)
      const target = Math.max(3, Math.min(97, base + Math.random() * 14 - 4))
      setCpu((c) => Math.max(3, Math.min(99, c + (target - c) * 0.45 + (Math.random() * 6 - 3))))
      const gTarget = Math.max(2, Math.min(99, base * (gpuBoosted ? 1.9 : 0.8) + Math.random() * 18))
      setGpu((g) => Math.max(2, Math.min(99, g + (gTarget - g) * 0.5 + (Math.random() * 8 - 4))))
      setRam((r) => Math.max(1.8, Math.min(14, 2.4 + winCount * 0.55 + Math.random() * 0.8)))
      forceTick((t) => t + 1)
    }, 1000)
    return () => {
      dead = true
      clearInterval(iv)
    }
  }, [winCount, gpuBoosted])

  const pushHist = (arr: number[], v: number) => {
    arr.push(v)
    if (arr.length > PERF_HIST) arr.shift()
  }
  pushHist(histRef.current.f, fps)
  pushHist(histRef.current.c, Math.round(cpu))
  pushHist(histRef.current.g, Math.round(gpu))

  const pctColor = (v: number) => (v >= 85 ? '#f87171' : v >= 60 ? '#fbbf24' : '#4ade80')
  const Spark = ({ data, color }: { data: number[]; color: string }) => (
    <div className="flex h-6 items-end gap-[2px]" aria-hidden>
      {Array.from({ length: PERF_HIST }).map((_, i) => {
        const v = data[i] ?? 0
        return (
          <span
            key={i}
            className="w-[4px] flex-none rounded-sm transition-[height] duration-300"
            style={{ height: `${Math.max(8, Math.min(100, v))}%`, background: i === PERF_HIST - 1 ? color : `${color}55` }}
          />
        )
      })}
    </div>
  )

  return (
    <div
      className="animate-[widgetIn_0.3s_ease] cursor-pointer rounded-2xl border border-white/14 bg-black/32 p-3.5 text-white shadow-2xl shadow-black/40 backdrop-blur-md transition-colors hover:border-sky-400/40"
      onClick={() => useOS.getState().openApp('gpu')}
      title="Open the Booster App"
      role="button"
      aria-label="Performance widget — open Booster App"
    >
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-sky-300/90">Performance</div>
        <span className="rounded-full bg-lime-500/15 px-1.5 py-0.5 text-[9px] font-bold text-lime-300">LIVE</span>
      </div>
      {/* FPS hero */}
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-[30px] font-bold leading-none tabular-nums" style={{ color: pctColor(100 - Math.abs(60 - fps)) }}>{fps}</span>
            <span className="text-[10px] text-white/50">FPS</span>
          </div>
          <div className="mt-0.5 text-[9.5px] text-white/45">real frame rate · {gpuName}</div>
        </div>
        <Spark data={histRef.current.f} color="#38bdf8" />
      </div>
      {/* CPU / GPU meters */}
      {([
        ['CPU', Math.round(cpu), histRef.current.c, drivers.gpu ? '8C/16T' : 'no driver'],
        ['GPU', Math.round(gpu), histRef.current.g, gpuBoosted ? 'BOOST ACTIVE' : drivers.gpu ? 'vxr-graphics' : 'no driver'],
      ] as const).map(([label, v, data, sub]) => (
        <div key={label} className="mt-2.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-semibold tracking-wide text-white/75">
              {label} <span className="ml-1 font-normal text-white/40">{sub}</span>
            </span>
            <span className="font-bold tabular-nums" style={{ color: pctColor(v) }}>{v}%</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${v}%`, background: pctColor(v) }} />
          </div>
          <div className="mt-1 flex justify-end">
            <Spark data={data} color={pctColor(v)} />
          </div>
        </div>
      ))}
      <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-[9.5px] text-white/45">
        <span>RAM {ram.toFixed(1)} GB · {winCount} app{winCount === 1 ? '' : 's'} open</span>
        <span className="text-sky-300/80">Booster ↗</span>
      </div>
    </div>
  )
}

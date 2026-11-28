// REDSEC 7.0 "Black Sea" — ChromeOS launcher bubble (the OS start menu).
// A floating pill-search bubble docked to the panel: FasterNet shortcut,
// Open Store "+" button, "Continue where you left off" recents strip and a
// 5-column circular app grid. Right-click any app for Open / Create desktop
// shortcut / Pin to panel / App info. Bottom bar: user avatar + POWER menu
// (v38.2 — Lock · Restart · Shut down, ChromeOS style). The panel stays PERMANENT.
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Plus, Globe, Search, MonitorSmartphone, FolderOpen, Power, PowerOff, RotateCw, Lock, User as UserIcon } from 'lucide-react'
import { useOS, APP_META, MENU_HIDDEN, openCtx } from '@/lib/os/store'
import { panelPx, panelAnchorStyle, TB_SIDE, type TaskbarPos } from '@/lib/os/types'
import { neuralRankOrder } from '@/lib/os/neural'
import { fs, fmtSize } from '@/lib/os/fs'
import { useSkinUrl } from '@/lib/os/skin'
import { AppIcon } from './AppIcon'

/* first free slot on the desktop icon grid (24px origin, 104x100 pitch) */
function freeDeskSlot(): { x: number; y: number } {
  const items = useOS.getState().desktopItems
  const taken = new Set(items.map((i) => `${Math.round((i.x - 24) / 104)}:${Math.round((i.y - 24) / 100)}`))
  for (let col = 0; col < 14; col++) {
    for (let row = 0; row < 7; row++) {
      if (!taken.has(`${col}:${row}`)) return { x: 24 + col * 104, y: 24 + row * 100 }
    }
  }
  return { x: 24, y: 24 }
}

/* every launchable id: built-ins (minus MENU_HIDDEN) + installed apps (inst:) */
function allApps(): { id: string; name: string; icon: string; color: string }[] {
  const st = useOS.getState()
  const builtins = Object.entries(APP_META)
    .filter(([id, m]) => !MENU_HIDDEN.has(id) && m.name)
    .map(([id, m]) => ({ id, name: m.name, icon: m.icon, color: m.color }))
  const installed = st.installedApps
    .filter((a) => a.status === 'installed')
    .map((a) => ({ id: `inst:${a.id}`, name: a.name, icon: 'AppWindow', color: a.color || '#38bdf8' }))
  return [...builtins, ...installed]
}

export function ChromeLauncher() {
  const startOpen = useOS((s) => s.startOpen)
  const taskbarPos = useOS((s) => s.taskbarPos)
  const taskbarTheme = useOS((s) => s.taskbarTheme)
  const panelThickness = useOS((s) => s.panelThickness)
  const panelAnchor = useOS((s) => s.panelAnchor)
  const panelLength = useOS((s) => s.panelLength)
  const recentApps = useOS((s) => s.recentApps)
  const installedApps = useOS((s) => s.installedApps)
  /* v38.2 — power menu (Lock / Restart / Shut down) + profile avatar */
  const [powerOpen, setPowerOpen] = useState(false)
  const profilePhoto = useOS((s) => s.profilePhoto)
  const profileImgUrl = useSkinUrl(profilePhoto)
  const username = useOS((s) => s.username)
  const [q, setQ] = useState('')
  const [showRecent, setShowRecent] = useState(true)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /* reset on open (render-time state adjust — lint-safe) */
  const [prevOpen, setPrevOpen] = useState(startOpen)
  if (prevOpen !== startOpen) {
    setPrevOpen(startOpen)
    if (startOpen) {
      setQ('')
      setShowRecent(true)
      setPowerOpen(false)
    }
  }

  /* outside click + Escape close — the taskbar itself stays clickable */
  useEffect(() => {
    if (!startOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (bubbleRef.current && !bubbleRef.current.contains(t) && !t.closest('[data-taskbar]')) {
        useOS.getState().set({ startOpen: false })
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        /* Escape closes the power popover first, then the launcher */
        if (powerOpen) setPowerOpen(false)
        else useOS.getState().set({ startOpen: false })
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      clearTimeout(t)
    }
  }, [startOpen, powerOpen])

  if (!startOpen) return null

  const openApp = (id: string) => {
    useOS.getState().openApp(id)
    useOS.getState().set({ startOpen: false })
  }

  /* v38.2 — power actions: same paths as the classic menus (fake power log +
     off/reboot screens via the store; lock goes straight to the lock screen) */
  const powerAct = (kind: 'shutdown' | 'restart' | 'lock') => {
    const st = useOS.getState()
    if (kind === 'shutdown') st.shutdown()
    else if (kind === 'restart') st.restart()
    else st.set({ startOpen: false, locked: true })
  }

  /* panel geometry — the bubble pins to the panel edge */
  const pb = panelPx(taskbarTheme, undefined, panelThickness)
  const sideW = taskbarPos === 'left' || taskbarPos === 'right' ? Math.max(24, panelThickness ?? TB_SIDE) : TB_SIDE
  const shortAnchor = panelLength < 100 ? panelAnchor : 'center'
  const anchorStyle = panelAnchorStyle(taskbarPos as TaskbarPos, pb, sideW, shortAnchor)

  /* recents strip — most recently launched real apps */
  const recents = recentApps
    .slice(-10)
    .reverse()
    .map((r) => {
      const meta = APP_META[r.appId.split(':')[0]]
      const inst = r.appId.startsWith('inst:') ? installedApps.find((a) => a.id === r.appId.slice(5)) : null
      const name = inst?.name || meta?.name || r.appId
      return { id: r.appId, name, icon: meta?.icon || 'AppWindow', color: inst?.color || meta?.color || '#38bdf8', at: r.at }
    })
    .slice(0, 8)

  /* app grid — neural-ranked when the core has learned enough */
  const apps = neuralRankOrder(
    allApps().filter((a) => a.name.toLowerCase() !== 'loading'),
    (a) => a.id,
  )

  /* search results: apps → files → web */
  const needle = q.trim().toLowerCase()
  const searched = needle.length > 0
  const appHits = searched ? apps.filter((a) => a.name.toLowerCase().includes(needle)).slice(0, 10) : []
  const fileHits = searched && appHits.length < 8 ? fs.search(q.trim()).filter((n) => !n.trashed).slice(0, 6) : []
  const openFile = (nodeId: string) => {
    useOS.getState().openApp('filemanager', { nodeId })
    useOS.getState().set({ startOpen: false })
  }

  /* right-click menu — Open / Create desktop shortcut / Pin / App info */
  const appContext = (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault()
    e.stopPropagation()
    const st = useOS.getState()
    const baseId = id.startsWith('inst:') ? id.slice(5) : id
    const onDesk = st.desktopItems.some((d) => d.type === 'app' && d.appId === id)
    const pinned = st.taskbarPinned.includes(baseId)
    openCtx(e.clientX, e.clientY, [
      { label: 'Open', icon: 'Play', onClick: () => openApp(id) },
      {
        label: onDesk ? 'Remove desktop shortcut' : 'Create desktop shortcut',
        icon: 'MonitorSmartphone',
        onClick: () => {
          const s2 = useOS.getState()
          if (onDesk) {
            const desk = s2.desktopItems.find((d) => d.type === 'app' && d.appId === id)
            if (desk) s2.removeDesktopItem(desk.id)
            s2.notify({ title: 'Shortcut removed', body: `${name} was removed from the desktop.`, kind: 'info' })
          } else {
            const slot = freeDeskSlot()
            s2.addDesktopItem({ id: `desk_sc_${Date.now().toString(36)}`, type: 'app', appId: id, label: name, x: slot.x, y: slot.y })
            s2.notify({ title: 'Shortcut created', body: `${name} now has a desktop shortcut.`, kind: 'success' })
          }
        },
      },
      { separator: true },
      {
        label: pinned ? 'Unpin from panel' : 'Pin to panel',
        icon: 'Pin',
        onClick: () => {
          const s2 = useOS.getState()
          s2.set({ taskbarPinned: pinned ? s2.taskbarPinned.filter((x) => x !== baseId) : [...s2.taskbarPinned, baseId] })
        },
      },
      {
        label: 'App info',
        icon: 'Info',
        onClick: () =>
          useOS.getState().notify({
            title: name,
            body: id.startsWith('inst:') ? 'Installed web app · REDSEC Open Store' : `Built-in REDSEC app · opens in a ${APP_META[baseId]?.w || 900}x${APP_META[baseId]?.h || 620} window`,
            kind: 'info',
          }),
      },
    ])
  }

  const gridCell = (a: { id: string; name: string; icon: string; color: string }) => (
    <button
      key={a.id}
      onClick={() => openApp(a.id)}
      onContextMenu={(e) => appContext(e, a.id, a.name)}
      className="group flex flex-col items-center gap-1.5 outline-none"
      title={a.name}
    >
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white/[0.07] ring-1 ring-white/10 transition-all duration-150 group-hover:scale-105 group-hover:bg-white/[0.14] group-active:scale-95">
        <AppIcon appId={a.id} size={30} />
      </span>
      <span className="max-w-[92px] truncate text-[11px] font-medium text-white/85 group-hover:text-white">{a.name}</span>
    </button>
  )

  return (
    <div
      ref={bubbleRef}
      data-start-menu
      className="fixed z-[9200] w-[640px] max-w-[calc(100vw-16px)] animate-[slideUp_0.18s_ease] rounded-3xl border border-white/10 p-5 shadow-2xl shadow-black/60 backdrop-blur-2xl"
      style={{ background: 'rgba(27,27,32,0.92)', ...anchorStyle }}
      role="dialog"
      aria-label="Apps launcher"
    >
      {/* click-away layer for the power popover (under the menu, over the bubble) */}
      {powerOpen && <div className="absolute inset-0 rounded-3xl" onClick={() => setPowerOpen(false)} aria-hidden="true" />}
      {/* pill search row */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-12 flex-1 items-center gap-3 rounded-full bg-white/[0.08] px-4 ring-1 ring-white/10 transition focus-within:bg-white/[0.12] focus-within:ring-white/25">
          <Search className="h-4.5 w-4.5 flex-none text-white/55" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && appHits[0]) openApp(appHits[0].id)
            }}
            placeholder="Search your shortcuts, files, apps, and more…"
            className="h-full w-full bg-transparent text-sm text-white/95 outline-none placeholder:text-white/45"
            aria-label="Search apps and files"
          />
        </div>
        <button
          onClick={() => openApp('browser')}
          title="FasterNet — open the web browser"
          className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-white/[0.08] ring-1 ring-white/10 transition hover:bg-white/[0.16] hover:ring-white/25 active:scale-95"
        >
          <Globe className="h-5 w-5 text-sky-300" />
        </button>
        <button
          onClick={() => openApp('appstore')}
          title="Open Store — install more apps"
          className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-white/[0.08] ring-1 ring-white/10 transition hover:bg-white/[0.16] hover:ring-white/25 active:scale-95"
        >
          <Plus className="h-5 w-5 text-white/85" />
        </button>
      </div>

      {/* continue where you left off */}
      {!searched && recents.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowRecent((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45 transition hover:text-white/75"
          >
            <MonitorSmartphone className="h-3.5 w-3.5" />
            Continue where you left off
            <span className="ml-1 text-white/30">{showRecent ? '−' : '+'}</span>
          </button>
          {showRecent && (
            <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {recents.map((r) => (
                <button
                  key={r.id + r.at}
                  onClick={() => openApp(r.id)}
                  title={`${r.name} — ${new Date(r.at).toLocaleTimeString()}`}
                  className="flex flex-none items-center gap-2 rounded-full bg-white/[0.06] py-1.5 pl-1.5 pr-3.5 ring-1 ring-white/10 transition hover:bg-white/[0.13] active:scale-95"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/30">
                    <AppIcon appId={r.id} size={16} />
                  </span>
                  <span className="max-w-[130px] truncate text-xs text-white/85">{r.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* content: search results or the 5-column app grid */}
      {searched ? (
        <div className="mt-4 max-h-[46vh] space-y-1 overflow-y-auto pr-1 [scrollbar-color:rgba(255,255,255,0.2)_transparent] [scrollbar-width:thin]">
          {appHits.length > 0 && (
            <>
              <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">Apps</div>
              <div className="grid grid-cols-5 gap-y-3 pb-1">{appHits.map(gridCell)}</div>
            </>
          )}
          {fileHits.length > 0 && (
            <>
              <div className="px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">Files</div>
              {fileHits.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openFile(n.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.08]"
                >
                  {n.kind === 'folder' ? <FolderOpen className="h-4 w-4 flex-none text-amber-300" /> : <span className="h-4 w-4 flex-none rounded bg-white/15" />}
                  <span className="flex-1 truncate text-sm text-white/90">{n.name}</span>
                  <span className="flex-none text-[11px] text-white/40">{n.kind === 'file' ? fmtSize(n.size || 0) : 'Folder'}</span>
                </button>
              ))}
            </>
          )}
          {needle.length > 1 && (
            <button
              onClick={() => {
                useOS.getState().openApp('browser', { search: q.trim() })
                useOS.getState().set({ startOpen: false })
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.08]"
            >
              <Globe className="h-4 w-4 flex-none text-sky-300" />
              <span className="flex-1 truncate text-sm text-white/90">
                Search web for <span className="font-semibold text-white">“{q.trim()}”</span>
              </span>
            </button>
          )}
          {appHits.length === 0 && fileHits.length === 0 && needle.length <= 1 && (
            <div className="py-8 text-center text-sm text-white/45">Type to search apps, files and the web</div>
          )}
        </div>
      ) : (
        <div className="mt-4 max-h-[46vh] overflow-y-auto pr-1 [scrollbar-color:rgba(255,255,255,0.2)_transparent] [scrollbar-width:thin]">
          <div className="grid grid-cols-5 gap-y-4 sm:grid-cols-6 md:grid-cols-5">{apps.map(gridCell)}</div>
        </div>
      )}

      {/* v38.2 — bottom bar: profile avatar + power menu (Lock · Restart · Shut down) */}
      <div className="relative z-10 mt-4 flex items-center justify-between border-t border-white/10 pt-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-white/10 ring-1 ring-white/15">
            {profileImgUrl ? (
              <img src={profileImgUrl} alt="Profile" className="h-full w-full object-cover" />
            ) : (
              <UserIcon className="h-4 w-4 text-white/70" />
            )}
          </span>
          <span className="truncate text-xs font-medium text-white/75">{username}</span>
        </div>
        <div className="relative flex-none">
          <button
            onClick={() => setPowerOpen((v) => !v)}
            title="Power — shut down, restart, lock"
            aria-haspopup="menu"
            aria-expanded={powerOpen}
            aria-label="Power options"
            className={`flex h-9 w-9 items-center justify-center rounded-full ring-1 transition active:scale-95 ${powerOpen ? 'bg-rose-500/25 ring-rose-400/40' : 'bg-white/[0.08] ring-white/10 hover:bg-white/[0.16] hover:ring-white/25'}`}
          >
            <Power className={`h-4.5 w-4.5 ${powerOpen ? 'text-rose-300' : 'text-white/85'}`} />
          </button>
          {powerOpen && (
            <div
              role="menu"
              aria-label="Power options"
              className="absolute bottom-11 right-0 w-44 overflow-hidden rounded-2xl border border-white/10 bg-[#1c1c22]/97 py-1.5 shadow-2xl shadow-black/60 animate-[slideUp_0.15s_ease]"
            >
              <button
                role="menuitem"
                onClick={() => powerAct('lock')}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/[0.10] hover:text-white"
              >
                <Lock className="h-4 w-4 flex-none text-sky-300" /> Lock
              </button>
              <button
                role="menuitem"
                onClick={() => powerAct('restart')}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/[0.10] hover:text-white"
              >
                <RotateCw className="h-4 w-4 flex-none text-amber-300" /> Restart
              </button>
              <button
                role="menuitem"
                onClick={() => powerAct('shutdown')}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-white/85 transition hover:bg-rose-500/20 hover:text-rose-200"
              >
                <PowerOff className="h-4 w-4 flex-none text-rose-300" /> Shut down
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

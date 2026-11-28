// REDSEC v5.0 — Alt+Tab window switcher (live thumbnails) + Meta key Start toggle
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useOS, APP_META } from '@/lib/os/store'
import { AppIcon } from './AppIcon'
import { windowThumb } from '@/lib/os/media'

/* live captured thumbnail with graceful icon fallback */
function SwitchThumb({ winId, appId }: { winId: string; appId: string }) {
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
  if (url) return <img src={url} alt="" className="h-[92px] w-full rounded-lg object-cover object-top" draggable={false} />
  return (
    <div className="flex h-[92px] w-full items-center justify-center rounded-lg bg-gradient-to-br from-[#10141f] to-[#1a2130]">
      <div className="absolute inset-0 rounded-lg opacity-[0.35]" style={{ background: 'radial-gradient(circle at 30% 20%, rgba(14,165,233,0.16), transparent 55%)' }} />
      <AppIcon appId={appId} size={38} />
    </div>
  )
}

export function WindowSwitcher() {
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const windows = useOS((s) => s.windows)
  const vdeskActive = useOS((s) => s.vdeskActive)
  const winsOnDesk = windows.filter((w) => (w.desk ?? 0) === vdeskActive)
  const tick = useRef(0)

  useEffect(() => {
    let altDown = false

    const onKeyDown = (e: KeyboardEvent) => {
      const st = useOS.getState()
      if (st.phase !== 'desktop') return
      if (e.key === 'Meta' || e.key === 'OS') {
        e.preventDefault()
        st.set({ startOpen: !st.startOpen, searchOpen: false })
        return
      }
      if (e.altKey && e.key === 'Tab') {
        e.preventDefault()
        const wins = useOS.getState().windows.filter((w) => (w.desk ?? 0) === st.vdeskActive)
        if (!wins.length) return
        if (!altDown) {
          altDown = true
          tick.current = 0
          setOpen(true)
          setIdx(wins.length > 1 ? 1 : 0)
        } else {
          tick.current += 1
          setIdx((i) => (i + 1) % wins.length)
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        altDown = false
        setOpen((o) => {
          if (o) {
            const st = useOS.getState()
            const wins = st.windows.filter((w) => (w.desk ?? 0) === st.vdeskActive)
            setIdx((i) => {
              const win = wins[i % Math.max(1, wins.length)]
              if (win) useOS.getState().focusWindow(win.id)
              return 0
            })
          }
          return false
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  if (!open || winsOnDesk.length === 0) return null

  return (
    <div className="fixed inset-0 z-[9700] flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
      <div className="flex max-w-[82vw] flex-wrap justify-center gap-2.5 rounded-2xl border border-white/12 bg-[#131826]/95 p-3 shadow-2xl animate-[ctxIn_0.12s_ease]">
        {winsOnDesk.map((w, i) => {
          const name = w.appId.startsWith('inst:')
            ? useOS.getState().installedApps.find((a) => a.id === w.appId.slice(5))?.name || w.title
            : APP_META[w.appId]?.name || w.title
          const active = i === idx % winsOnDesk.length
          return (
            <button
              key={w.id}
              onClick={() => {
                useOS.getState().focusWindow(w.id)
                setOpen(false)
              }}
              onMouseEnter={() => setIdx(i)}
              className={`flex w-[152px] flex-col gap-1.5 rounded-xl border p-2 transition-all ${
                active ? 'scale-[1.04] border-sky-400/70 bg-sky-400/10 shadow-[0_0_18px_rgba(14,165,233,0.25)]' : 'border-white/8 bg-white/4 opacity-70 hover:opacity-90'
              }`}
            >
              <SwitchThumb winId={w.id} appId={w.appId} />
              <div className="flex items-center gap-1.5 px-0.5">
                <AppIcon appId={w.appId} size={13} />
                <span className="min-w-0 flex-1 truncate text-left text-[10.5px] font-medium text-slate-200">{w.title || name}</span>
              </div>
            </button>
          )
        })}
      </div>
      <div className="absolute bottom-24 text-[11px] text-slate-400">Hold Alt • press Tab to cycle • release Alt to switch</div>
    </div>
  )
}

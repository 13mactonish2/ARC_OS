// REDSEC v5.0 — Global context menu
'use client'

import React, { useEffect, useRef } from 'react'
import { useOS, closeCtx } from '@/lib/os/store'

export function ContextMenu() {
  const ctx = useOS((s) => s.ctx)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ctx?.open) return
    /* opening the context menu closes every other floating panel */
    useOS.getState().set({ startOpen: false, searchOpen: false, widgetOpen: false, notifOpen: false, runOpen: false, clipOpen: false, emojiOpen: false })
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeCtx()
    }
    const onTouch = (e: TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeCtx()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeCtx()
    /* any other floating panel opening dismisses the menu */
    const unsub = useOS.subscribe((s, prev) => {
      if (
        (s.startOpen && !prev.startOpen) ||
        (s.searchOpen && !prev.searchOpen) ||
        (s.widgetOpen && !prev.widgetOpen) ||
        (s.notifOpen && !prev.notifOpen) ||
        (s.runOpen && !prev.runOpen) ||
        (s.clipOpen && !prev.clipOpen) ||
        (s.emojiOpen && !prev.emojiOpen)
      )
        closeCtx()
    })
    window.addEventListener('mousedown', close)
    window.addEventListener('touchstart', onTouch)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', closeCtx)
    return () => {
      unsub()
      window.removeEventListener('mousedown', close)
      window.removeEventListener('touchstart', onTouch)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', closeCtx)
    }
  }, [ctx?.open])

  if (!ctx?.open) return null
  const x = Math.min(ctx.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 230)
  const y = Math.min(ctx.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - (ctx.items.length * 34 + 16))

  return (
    <div
      ref={ref}
      className="fixed z-[10000] min-w-52 overflow-hidden rounded-xl border border-white/12 bg-[#171c29]/97 py-1.5 shadow-2xl shadow-black/60 backdrop-blur animate-[ctxIn_0.12s_ease]"
      style={{ left: x, top: y }}
    >
      {ctx.items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 h-px bg-white/8" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              closeCtx()
              item.onClick?.()
            }}
            className={`flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-[13px] transition-colors disabled:opacity-40 ${
              item.danger ? 'text-rose-300 hover:bg-rose-500/15' : 'text-slate-200 hover:bg-white/8'
            }`}
          >
            <span className="w-4 text-center">{item.icon || ''}</span>
            {item.label}
          </button>
        )
      )}
    </div>
  )
}

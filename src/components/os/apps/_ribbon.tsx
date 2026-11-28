/* REDSEC v5.0 — shared Microsoft-Office-style ribbon atoms (Task 41).
 * Used by WordApp + PresentationApp to reproduce the real desktop-Office
 * ribbon: tab strip, grouped buttons with captions, popout menus, dialogs. */
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'

/* ---------- small icon button inside a ribbon group ---------- */
export function RBtn({ icon, label, onClick, active, disabled, wide, title }: {
  icon: React.ReactNode; label?: string; onClick?: () => void; active?: boolean; disabled?: boolean; wide?: boolean; title?: string
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-[42px] ${wide ? 'w-[74px]' : 'w-[52px]'} flex-col items-center justify-center gap-0.5 rounded px-1 text-[9px] leading-tight text-zinc-200 transition-colors ${active ? 'bg-white/15 text-white' : 'hover:bg-white/10'} disabled:cursor-not-allowed disabled:opacity-35`}
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {label && <span className="w-full truncate text-center">{label}</span>}
    </button>
  )
}

/* ---------- 32px compact button (rows inside groups) ---------- */
export function SBtn({ icon, label, onClick, active, disabled, title, check, className = '' }: {
  icon?: React.ReactNode; label: React.ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean; title?: string; check?: boolean; className?: string
}) {
  return (
    <button
      type="button"
      title={title ?? (typeof label === 'string' ? label : undefined)}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 whitespace-nowrap rounded px-1.5 text-[10.5px] text-zinc-200 transition-colors ${active || check ? 'bg-white/15 text-white' : 'hover:bg-white/10'} disabled:cursor-not-allowed disabled:opacity-35 ${className}`}
    >
      {check !== undefined && <span className={`w-3 flex-none text-center text-[10px] ${check ? 'text-sky-400' : 'text-zinc-600'}`}>{check ? '✓' : '·'}</span>}
      {icon && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5 flex-none">{icon}</span>}
      <span className="truncate">{label}</span>
    </button>
  )
}

/* ---------- grouped section with caption ---------- */
export function RGroup({ label, children, grow }: { label: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <div className={`relative flex h-full flex-col items-center justify-start border-r border-white/[0.07] px-1.5 pb-3.5 pt-0.5 ${grow ? 'min-w-0' : ''}`}>
      <div className="flex flex-1 items-stretch gap-0.5">{children}</div>
      <span className="absolute bottom-0 left-0 right-0 truncate text-center text-[8.5px] text-zinc-500">{label}</span>
    </div>
  )
}

/* ---------- column of small buttons inside a group ---------- */
export function RCol({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex flex-col justify-center gap-px ${className}`}>{children}</div>
}

/* ---------- row of controls inside a group ---------- */
export function RRow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex items-center gap-0.5 ${className}`}>{children}</div>
}

/* ---------- button that opens a floating panel ----------
 * v7.0.2 fix — the two bugs that made every ribbon menu dead:
 *  1. the app root's onMouseDown (which closes popovers) fired BEFORE the
 *     panel item's onClick → menus closed themselves before a click landed.
 *     Fix: the panel + the trigger stop mousedown propagation, so only a
 *     click OUTSIDE the popover reaches the root handler.
 *  2. the ribbon container clipped panels vertically (overflow-y-hidden).
 *     Fix lives in the apps (container is now overflow-visible); panels here
 *     also carry data-pop-panel for robust outside-close checks. */
export function RPop({ icon, label, open, onToggle, children, wide, disabled, panelW }: {
  icon: React.ReactNode; label: string; open: boolean; onToggle: () => void; children: React.ReactNode; wide?: boolean; disabled?: boolean; panelW?: number
}) {
  return (
    <div className="relative">
      <div data-pop-trigger="1" onMouseDown={(e) => e.stopPropagation()}>
        <RBtn icon={icon} label={label} onClick={onToggle} active={open} wide={wide} disabled={disabled} />
      </div>
      {open && (
        <div
          data-pop-panel="1"
          onMouseDown={(e) => e.stopPropagation()}
          style={panelW ? { minWidth: panelW } : undefined}
          className="absolute left-0 top-[44px] z-50 min-w-[190px] rounded-md border border-white/10 bg-[#26272b] py-1 shadow-2xl shadow-black/60"
        >
          {children}
        </div>
      )}
    </div>
  )
}

/* ---------- menu item ---------- */
export const MItem = ({ children, onClick, disabled, check, icon }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; check?: boolean; icon?: React.ReactNode }) => (
  <button type="button" disabled={disabled} onClick={onClick} className={`flex w-full items-center gap-2 px-3 py-[5px] text-left text-[11px] text-zinc-200 ${disabled ? 'opacity-40' : 'hover:bg-white/10'}`}>
    <span className="w-3 flex-none text-sky-400">{check ? <Check className="h-3 w-3" /> : icon}</span>{children}
  </button>
)
export const MSep = () => <div className="my-1 h-px bg-white/10" />
export const MTitle = ({ children }: { children: React.ReactNode }) => (
  <div className="px-3 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{children}</div>
)

/* ---------- inline dropdown (select-like) ---------- */
export function MiniSelect({ value, onChange, options, width = 108, title, ariaLabel }: {
  value: string; onChange: (v: string) => void; options: { v: string; t: string }[]; width?: number; title?: string; ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div ref={ref} className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        title={title}
        aria-label={ariaLabel ?? title}
        onClick={() => setOpen((v) => !v)}
        className="flex h-[22px] items-center justify-between rounded border border-white/15 bg-[#1c1d21] px-1.5 text-[10.5px] text-zinc-200 hover:border-white/30"
        style={{ width }}
      >
        <span className="truncate">{value}</span>
        <span className="text-[8px] text-zinc-500">▼</span>
      </button>
      {open && (
        <div data-pop-panel="1" className="absolute left-0 top-6 z-50 max-h-56 overflow-y-auto rounded-md border border-white/10 bg-[#26272b] py-1 shadow-2xl shadow-black/60 os-scroll" style={{ width: Math.max(width, 150) }}>
          {options.map((o) => (
            <button key={o.v} type="button" onClick={() => { onChange(o.v); setOpen(false) }} className={`flex w-full items-center gap-2 px-2.5 py-1 text-left text-[11px] ${o.v === value ? 'bg-white/10 text-white' : 'text-zinc-300 hover:bg-white/10'}`}>
              <span className="w-3 text-sky-400">{o.v === value ? <Check className="h-3 w-3" /> : null}</span>{o.t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- color grid + swatch button ---------- */
export const OFFICE_COLORS = [
  '#000000', '#404040', '#7f7f7f', '#bfbfbf', '#ffffff',
  '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050',
  '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0',
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c',
  '#3498db', '#9b59b6', '#ec4899', '#14b8a6', '#f97316',
]
export function ColorGrid({ onPick, onNone, noneLabel }: { onPick: (c: string) => void; onNone?: () => void; noneLabel?: string }) {
  return (
    <div className="p-1.5" onMouseDown={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-5 gap-1">
        {OFFICE_COLORS.map((c) => (
          <button key={c} type="button" title={c} onClick={() => onPick(c)} className="h-5 w-7 rounded border border-black/40 ring-1 ring-white/10 transition-transform hover:scale-110" style={{ background: c }} aria-label={`color ${c}`} />
        ))}
      </div>
      {onNone && (
        <button type="button" onClick={onNone} className="mt-1.5 w-full rounded px-2 py-1 text-left text-[10.5px] text-zinc-300 hover:bg-white/10">
          {noneLabel ?? 'No color'}
        </button>
      )}
    </div>
  )
}

/* ---------- toast helper (same shape as app notify) ---------- */
export type Notify = (n: { title: string; body?: string; kind?: 'success' | 'error' | 'warn' | 'info'; emoji?: string }) => void

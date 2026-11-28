// REDSEC 5.0 — Task 16/18 shared layer for the RedSec Mobile OS apps.
// The mobile VM deliberately does NOT reuse the PC window chrome: every app
// here is drawn with RedSec Mobile styling (crisp headers, action bar,
// crimson accents) on top of the SAME data stores the PC apps use.
'use client'

import React, { createContext, useContext } from 'react'
import { ChevronLeft } from 'lucide-react'

/* ---------------- context ---------------- */

export interface MbCtx {
  /** open another mobile app (pushes an active frame) */
  openApp: (id: string) => void
  /** minimize to the home screen (bottom-bezel gesture) */
  goHome: () => void
  /** raise a RedSec Hub event */
  hubEvent: (ev: { title: string; body?: string; kind: 'chat' | 'system' }) => void
  /** Mobile Link pairing token ('' when unpaired) */
  token: string
  /** true when the PC is currently linked */
  pcLinked: boolean
  /** PC owner name (from sync) */
  owner: string
  /** accent color (BB red by default) */
  accent: string
}

const defaultCtx: MbCtx = {
  openApp: () => {},
  goHome: () => {},
  hubEvent: () => {},
  token: '',
  pcLinked: false,
  owner: '',
  accent: '#e4002b',
}

export const MbContext = createContext<MbCtx>(defaultCtx)
export const useMb = () => useContext(MbContext)

/* ---------------- RedSec Mobile header ---------------- */

export function MbBar({
  title,
  subtitle,
  onBack,
  right,
  accent,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  right?: React.ReactNode
  accent?: string
}) {
  return (
    <div
      className="flex h-11 flex-none items-center gap-1 border-b px-2"
      style={{
        borderColor: 'color-mix(in srgb, var(--mb-text) 10%, transparent)',
        background: 'var(--mb-bar)',
      }}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full active:scale-95"
          style={{ color: accent || 'var(--mb-accent)' }}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0 flex-1 pl-1">
        <div className="truncate text-[13px] font-semibold leading-tight" style={{ color: 'var(--mb-text)' }}>
          {title}
        </div>
        {subtitle && (
          <div className="truncate text-[9px] uppercase tracking-wider" style={{ color: 'var(--mb-dim)' }}>
            {subtitle}
          </div>
        )}
      </div>
      {right}
    </div>
  )
}

/* ---------------- shared bits ---------------- */

export function MbEmpty({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      {icon}
      <div className="text-[11px] leading-relaxed" style={{ color: 'var(--mb-dim)' }}>
        {text}
      </div>
    </div>
  )
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export const hslOf = (name: string): number => {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

// REDSEC 6.0 — Task 82: Mobile Apps hub (formerly "PC Mirror").
// EVERY OS app transforms into a MOBILE app inside the RedSec Mobile VM:
// it opens with a real app-launch animation, runs in a full-bleed phone
// viewport with mobile chrome (app bar, back, reload, badge), and stays the
// REAL app component — same license, same data, same state. Search +
// category chips make the hub itself feel like a phone launcher.
'use client'

import React, { useMemo, useState } from 'react'
import { MonitorSmartphone, RotateCw, Search, ChevronLeft, Smartphone } from 'lucide-react'
import { APP_META } from '@/lib/os/store'
import { APP_COMPONENTS } from '../registry'
import { AppIcon } from '../AppIcon'
import { MbBar, MbEmpty, useMb } from './mb-shared'

/** every PC app without a native mobile edition can be transformed
 *  (Task 47 — 'clock' + 'calendar' merged into the native 'wdt' app) */
const NATIVE_MOBILE = new Set(['hub', 'chat', 'browser', 'camera', 'gallery', 'notes', 'files', 'settings', 'calc', 'wdt', 'weather', 'music', 'game2048', 'gaming', 'pcmirror', 'mobileapps'])
const PC_MIRROR_IDS = Object.keys(APP_META).filter((id) => !NATIVE_MOBILE.has(id))

/** category buckets for the launcher feel */
const CATS: Array<{ id: string; label: string; ids: string[] }> = [
  { id: 'all', label: 'All', ids: [] },
  { id: 'work', label: 'Work', ids: ['sheet', 'word', 'presentation', 'pdfviewer', 'notes', 'opencode', 'onecompiler'] },
  { id: 'web', label: 'Web', ids: ['youtube', 'map', 'news', 'dictionary', 'gaming', 'caterpillar'] },
  { id: 'media', label: 'Media', ids: ['coneplayer', 'mirror', 'camera', 'photoeditor', 'paint', 'svr'] },
  { id: 'system', label: 'System', ids: ['gpu', 'shield', 'wdt', 'bin', 'provide'] },
]

function catOf(id: string): string {
  for (const c of CATS) if (c.ids.includes(id)) return c.id
  return 'all'
}

/** apps whose window size we should emulate per-app (defaults 960x640) */
function sizeOf(id: string): { w: number; h: number } {
  const meta = APP_META[id]
  return { w: Math.min(meta?.w || 960, 1280), h: Math.min(meta?.h || 640, 820) }
}

export default function MbMirror({ initialApp }: { initialApp?: string | null }) {
  const { accent } = useMb()
  const [sel, setSel] = useState<string | null>(initialApp && (APP_COMPONENTS[initialApp] || APP_COMPONENTS[`inst:${initialApp}`]) ? initialApp : null)
  const [nonce, setNonce] = useState(0)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [launching, setLaunching] = useState<string | null>(null)

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return PC_MIRROR_IDS.filter((id) => {
      const meta = APP_META[id]
      if (cat !== 'all' && catOf(id) !== cat) return false
      if (ql && !(meta?.name || id).toLowerCase().includes(ql)) return false
      return true
    })
  }, [q, cat])

  const launch = (id: string) => {
    if (!APP_COMPONENTS[id] && !APP_COMPONENTS[`inst:${id}`]) return
    // real app-launch choreography: tile pops, then the app slides in
    setLaunching(id)
    window.setTimeout(() => {
      setSel(id)
      setLaunching(null)
    }, 190)
  }

  if (sel) {
    const Comp = APP_COMPONENTS[sel] || APP_COMPONENTS[`inst:${sel}`]
    const { w, h } = sizeOf(sel)
    const scale = 356 / w
    const boxH = h * scale
    const meta = APP_META[sel]
    return (
      <div className="flex h-full flex-col" style={{ background: 'var(--mb-bg)', animation: 'mbAppIn 0.22s ease' }}>
        <MbBar
          title={meta?.name || sel}
          subtitle="MOBILE APP · the real OS app, transformed"
          onBack={() => setSel(null)}
          right={
            <button type="button" onClick={() => setNonce((n) => n + 1)} aria-label="Reload app" className="rounded-full p-1.5" style={{ color: 'var(--mb-dim)' }}>
              <RotateCw className="h-4 w-4" />
            </button>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto" style={{ background: 'var(--mb-bg2)' }}>
          {Comp ? (
            <div key={`${sel}_${nonce}`} style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left', marginBottom: boxH - h }}>
              <Comp winId={`mirror_${sel}`} />
            </div>
          ) : (
            <div className="p-6 text-[11px]" style={{ color: 'var(--mb-dim)' }}>This app cannot be mirrored.</div>
          )}
        </div>
        <div className="flex flex-none items-center justify-center gap-1.5 px-3 py-1.5 text-center text-[8px] uppercase tracking-[0.25em]" style={{ color: 'var(--mb-dim)', background: 'var(--mb-card)' }}>
          <Smartphone size={9} /> mobile app · live · {Math.round(scale * 100)}% fit
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <MbBar title="Mobile Apps" subtitle={`${PC_MIRROR_IDS.length} OS apps · transformed for mobile`} />
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="mx-1 mb-2 flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'color-mix(in srgb, var(--mb-accent) 12%, var(--mb-card))' }}>
          <MonitorSmartphone size={16} style={{ color: 'var(--mb-accent)' }} />
          <div className="text-[10px] leading-snug" style={{ color: 'var(--mb-dim)' }}>
            <b style={{ color: 'var(--mb-text)' }}>Every OS app becomes a mobile app</b> — Sheet, Word, YouTube, Caterpillar, Gaming Hub, Paint, Velikan and more, launched like phone apps with the same data.
          </div>
        </div>

        {/* search — launcher style */}
        <div className="relative mx-1 mb-2">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--mb-dim)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search apps…"
            aria-label="Search mobile apps"
            className="h-8 w-full rounded-full border border-white/10 bg-black/25 pl-8 pr-3 text-[11px] outline-none"
            style={{ color: 'var(--mb-text)' }}
          />
        </div>

        {/* category chips */}
        <div className="mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {CATS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCat(c.id)}
              className={`flex-none rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                cat === c.id ? 'text-white' : ''
              }`}
              style={cat === c.id ? { background: 'var(--mb-accent)' } : { background: 'var(--mb-card)', color: 'var(--mb-dim)' }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-x-1 gap-y-3 px-1.5">
          {list.map((id) => {
            const meta = APP_META[id]
            const Host = APP_COMPONENTS[id] || APP_COMPONENTS[`inst:${id}`]
            const isLaunching = launching === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => launch(id)}
                className={`flex flex-col items-center gap-1.5 transition-transform disabled:opacity-40 ${isLaunching ? 'scale-125 opacity-70' : 'active:scale-95'}`}
                disabled={!Host}
              >
                <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px] shadow-md" style={{ background: `linear-gradient(150deg, ${meta?.color || '#666'}dd 0%, ${meta?.color || '#666'}88 100%)`, border: '1px solid rgba(255,255,255,0.14)' }}>
                  <AppIcon appId={id} size={26} />
                </span>
                <span className="max-w-full truncate px-0.5 text-[8.5px] font-medium" style={{ color: 'var(--mb-dim)' }}>{meta?.name || id}</span>
              </button>
            )
          })}
        </div>
        {list.length === 0 && <MbEmpty text="No apps match that search." />}
      </div>
      <style jsx>{`
        @keyframes mbAppIn {
          from { transform: scale(0.94); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

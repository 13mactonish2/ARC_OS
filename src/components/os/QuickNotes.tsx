// REDSEC v5.0 — Sticky Quick Notes (Win+N), persisted, draggable, color-coded
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useOS } from '@/lib/os/store'
import { panelPx } from '@/lib/os/types'
import { StickyNote, Plus, X } from 'lucide-react'

const COLORS: Record<string, { bg: string; head: string; ring: string; dot: string }> = {
  amber: { bg: '#3a3113', head: '#524412', ring: '#d9a521', dot: '#eab308' },
  emerald: { bg: '#0f2f22', head: '#14402e', ring: '#2f9e6e', dot: '#0ea5e9' },
  rose: { bg: '#3a1420', head: '#4d1a2b', ring: '#c2456b', dot: '#f43f5e' },
  slate: { bg: '#232a38', head: '#2c3547', ring: '#64748b', dot: '#94a3b8' },
}

function QuickNoteCard({ id }: { id: string }) {
  const note = useOS((s) => s.quickNotes.find((q) => q.id === id))
  const updateQuickNote = useOS((s) => s.updateQuickNote)
  const removeQuickNote = useOS((s) => s.removeQuickNote)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const c = COLORS[note?.color || 'amber']

  const onPointerDown = (e: React.PointerEvent) => {
    if (!note) return
    e.preventDefault()
    dragRef.current = { dx: e.clientX - note.x, dy: e.clientY - note.y }
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  useEffect(() => {
    if (!dragging || !note) return
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      updateQuickNote(id, {
        x: Math.max(4, Math.min(window.innerWidth - 120, e.clientX - d.dx)),
        y: Math.max(4, Math.min(window.innerHeight - 90, e.clientY - d.dy)),
      })
    }
    const onUp = () => {
      dragRef.current = null
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, note, id, updateQuickNote])

  if (!note) return null

  return (
    <div
      className={`fixed z-[9200] w-[248px] overflow-hidden rounded-xl border shadow-2xl shadow-black/50 backdrop-blur animate-[popIn_0.15s_ease] ${dragging ? 'opacity-95' : ''}`}
      style={{ left: note.x, top: note.y, background: c.bg, borderColor: `${c.ring}55` }}
    >
      <div
        className="flex cursor-grab items-center gap-1.5 px-2 py-1.5 active:cursor-grabbing"
        style={{ background: c.head }}
        onPointerDown={onPointerDown}
      >
        <StickyNote className="h-3.5 w-3.5" style={{ color: c.ring }} />
        <span className="flex-1 select-none text-[10px] font-semibold uppercase tracking-wider text-white/70">Quick note</span>
        {(['amber', 'emerald', 'rose', 'slate'] as const).map((col) => (
          <button
            key={col}
            aria-label={`Note color ${col}`}
            onClick={() => updateQuickNote(id, { color: col })}
            className={`h-3 w-3 rounded-full transition-transform hover:scale-125 ${note.color === col ? 'ring-2 ring-white/80' : 'opacity-60'}`}
            style={{ background: COLORS[col].dot }}
          />
        ))}
        <button
          aria-label="Delete note"
          onClick={() => removeQuickNote(id)}
          className="ml-1 flex h-4.5 w-4.5 items-center justify-center rounded text-white/60 hover:bg-rose-600 hover:text-white"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <textarea
        ref={taRef}
        value={note.text}
        onChange={(e) => updateQuickNote(id, { text: e.target.value })}
        placeholder="Jot something down…"
        rows={6}
        className="os-scroll block w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-white/90 outline-none placeholder:text-white/35"
      />
      <div className="px-3 pb-1.5 text-right font-mono text-[9px] text-white/35">saved automatically</div>
    </div>
  )
}

export function QuickNotes() {
  const quickNotes = useOS((s) => s.quickNotes)
  const quickNotesOpen = useOS((s) => s.quickNotesOpen)
  const addQuickNote = useOS((s) => s.addQuickNote)
  const set = useOS((s) => s.set)
  const dockBottom = useOS((s) => panelPx(s.taskbarTheme, s.panelSize, s.panelThickness)) + 4

  const toggle = useCallback(() => {
    const st = useOS.getState()
    if (!st.quickNotesOpen && st.quickNotes.length === 0) st.addQuickNote()
    else st.set({ quickNotesOpen: !st.quickNotesOpen })
  }, [])

  useEffect(() => {
    const h = () => toggle()
    window.addEventListener('os-quick-notes', h)
    return () => window.removeEventListener('os-quick-notes', h)
  }, [toggle])

  if (!quickNotesOpen) return null

  return (
    <>
      {quickNotes.map((q) => (
        <QuickNoteCard key={q.id} id={q.id} />
      ))}
      {/* launcher dock so you can always add another / close all */}
      <div className="fixed left-1/2 z-[9200] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/14 bg-[#0d1320]/95 px-3 py-1.5 shadow-2xl backdrop-blur" style={{ bottom: dockBottom }}>
        <StickyNote className="h-3.5 w-3.5 text-amber-300" />
        <span className="text-[11px] text-slate-300">{quickNotes.length} note{quickNotes.length === 1 ? '' : 's'}</span>
        <button
          aria-label="New quick note"
          onClick={addQuickNote}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/20 text-sky-300 hover:bg-sky-500/35"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          aria-label="Hide all quick notes"
          onClick={() => set({ quickNotesOpen: false })}
          className="rounded-full bg-white/8 px-2.5 py-0.5 text-[10.5px] text-slate-300 hover:bg-white/15"
        >
          Hide all
        </button>
      </div>
    </>
  )
}

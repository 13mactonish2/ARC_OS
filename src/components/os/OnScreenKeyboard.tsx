// REDSEC v5.0 — Movable on-screen keyboard (toggle with K)
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { X, Move } from 'lucide-react'
import { useOS } from '@/lib/os/store'

type KeyDef = [string, string] | { special: 'shift' | 'back' | 'enter' | 'space' | 'caps' }

const ROWS: KeyDef[][] = [
  [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['0', '0'], ['-', '_'], ['=', '+']],
  [['q', 'Q'], ['w', 'W'], ['e', 'E'], ['r', 'R'], ['t', 'T'], ['y', 'Y'], ['u', 'U'], ['i', 'I'], ['o', 'O'], ['p', 'P'], ['[', '{'], [']', '}']],
  [{ special: 'caps' }, ['a', 'A'], ['s', 'S'], ['d', 'D'], ['f', 'F'], ['g', 'G'], ['h', 'H'], ['j', 'J'], ['k', 'K'], ['l', 'L'], [';', ':'], ["'", '"'], { special: 'back' }],
  [{ special: 'shift' }, ['z', 'Z'], ['x', 'X'], ['c', 'C'], ['v', 'V'], ['b', 'B'], ['n', 'N'], ['m', 'M'], [',', '<'], ['.', '>'], ['/', '?'], { special: 'enter' }],
]

export function OnScreenKeyboard() {
  const keyboardOpen = useOS((s) => s.keyboardOpen)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [shift, setShift] = useState(false)
  const [caps, setCaps] = useState(false)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      setPos({ x: Math.max(0, e.clientX - d.dx), y: Math.max(0, e.clientY - d.dy) })
    }
    const onUp = () => (dragRef.current = null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  if (!keyboardOpen) return null

  const style: React.CSSProperties = pos ? { left: pos.x, top: pos.y } : { left: '50%', transform: 'translateX(-50%)', bottom: 60 }

  const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string, caret: number) => {
    const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')
    desc?.set?.call(el, value)
    el.setSelectionRange(caret, caret)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.focus()
  }

  const insertText = (key: string) => {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)) {
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? start
      const v = el.value
      const next = v.slice(0, start) + key + v.slice(end)
      setNativeValue(el, next, start + key.length)
    } else {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    }
  }

  const backspace = () => {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? start
      const v = el.value
      if (start === end && start > 0) {
        setNativeValue(el, v.slice(0, start - 1) + v.slice(end), start - 1)
      } else {
        setNativeValue(el, v.slice(0, start) + v.slice(end), start)
      }
    }
  }

  const upper = shift || caps

  return (
    <div className="fixed z-[9500] rounded-2xl border border-white/15 bg-[#151a26]/97 p-2.5 shadow-2xl shadow-black/70 backdrop-blur-xl" style={style}>
      <div
        className="mb-1.5 flex cursor-move items-center gap-2 px-1"
        onPointerDown={(e) => {
          const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
          dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
          setPos({ x: rect.left, y: rect.top })
        }}
      >
        <Move className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">On-screen keyboard</span>
        <button
          onClick={() => useOS.getState().set({ keyboardOpen: false })}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white/10 hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-1">
        {ROWS.map((row, ri) => (
          <div key={ri} className="flex justify-center gap-1">
            {row.map((k, ki) => {
              if (typeof k === 'object' && 'special' in k) {
                if (k.special === 'shift') return <Key key={ki} label={shift ? '⇧•' : '⇧'} wide active={shift} onDown={() => setShift(!shift)} />
                if (k.special === 'caps') return <Key key={ki} label={caps ? '⇪•' : '⇪'} wide active={caps} onDown={() => setCaps(!caps)} />
                if (k.special === 'back') return <Key key={ki} label="⌫" wide onDown={backspace} />
                if (k.special === 'enter') return <Key key={ki} label="⏎" wide onDown={() => {
                  const el = document.activeElement as HTMLElement | null
                  if (el) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
                }} />
                return null
              }
              return (
                <Key
                  key={ki}
                  label={upper ? k[1] : k[0]}
                  onDown={() => {
                    insertText(upper ? k[1] : k[0])
                    setShift(false)
                  }}
                />
              )
            })}
          </div>
        ))}
        <div className="flex justify-center gap-1">
          <Key label="space" wide2 onDown={() => insertText(' ')} />
        </div>
      </div>
    </div>
  )
}

function Key({ label, onDown, wide, wide2, active }: { label: string; onDown: () => void; wide?: boolean; wide2?: boolean; active?: boolean }) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault()
        onDown()
      }}
      className={`h-9 rounded-md border border-white/8 bg-white/6 text-xs text-slate-200 transition-all hover:bg-white/15 active:bg-sky-500/40 ${
        wide ? 'w-14' : wide2 ? 'w-56' : 'w-8'
      } ${active ? 'border-sky-400/40 bg-sky-500/30' : ''}`}
    >
      {label}
    </button>
  )
}

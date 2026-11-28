// REDSEC v6.0 (BlueStringRay) — Task 73: real screen-lock credentials.
// PatternLock  — 3×3 Android-style pattern: drag to connect, min 4 dots, no dot reuse,
//                segments passing over an unselected dot fold it into the pattern (AOSP
//                LockPatternView behaviour), live trail, error flash + reset.
// PinPad       — numeric keypad with dot feedback, ⌫ + ✓, keyboard support.
// UnlockMethods— one panel shared by BOTH the boot login screen and the lock screen:
//                renders every configured method (password / PIN / pattern) with a
//                chooser, verifies input, and reports success / failure to the host.
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Delete, Hash, KeyRound, LayoutGrid, LogIn } from 'lucide-react'
import { useOS } from '@/lib/os/store'

export type UnlockMethodId = 'password' | 'pin' | 'pattern'

/* ================================ PatternLock ================================ */
/* Real Android rules: min 4 dots · dots cannot repeat · when a segment passes
 * exactly over an unselected dot, that dot is folded into the pattern first. */

const SKIP_OVER: Record<string, number> = {
  '0-2': 1, '2-0': 1,
  '0-6': 3, '6-0': 3,
  '2-8': 5, '8-2': 5,
  '6-8': 7, '8-6': 7,
  '0-8': 4, '8-0': 4,
  '2-6': 4, '6-2': 4,
  '1-7': 4, '7-1': 4,
  '3-5': 4, '5-3': 4,
}

export function patternsEqual(a: number[] | null, b: number[] | null): boolean {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

interface PatternLockProps {
  /** fired on pointer release with the drawn dot sequence */
  onComplete: (pattern: number[]) => void
  /** increment to flash red + reset the view */
  errorNonce?: number
  /** visual size (px) of the square canvas */
  size?: number
  disabled?: boolean
  ariaLabel?: string
}

export function PatternLock({ onComplete, errorNonce = 0, size = 236, disabled = false, ariaLabel = 'Unlock pattern' }: PatternLockProps) {
  const [seq, setSeq] = useState<number[]>([])
  const [trail, setTrail] = useState<{ x: number; y: number } | null>(null)
  const [seenNonce, setSeenNonce] = useState(errorNonce)
  const [err, setErr] = useState(false)
  const [isDrawing, setIsDrawing] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const drawing = useRef(false)
  const seqRef = useRef<number[]>([])

  const DOT = 15
  const PAD = 26
  const cell = (size - PAD * 2) / 2
  const centers = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => ({
        x: PAD + (i % 3) * cell,
        y: PAD + Math.floor(i / 3) * cell,
      })),
    [cell, size],
  )

  /* error flash: adjust state when the nonce changes (render-time, sanctioned) */
  if (errorNonce !== seenNonce) {
    setSeenNonce(errorNonce)
    if (errorNonce > 0) setErr(true)
  }
  useEffect(() => {
    if (!err) return
    const t = setTimeout(() => {
      setErr(false)
      setSeq([])
      setTrail(null)
    }, 620)
    return () => clearTimeout(t)
  }, [err])

  const hitDot = (x: number, y: number): number | null => {
    const r = cell * 0.42 + 6
    for (let i = 0; i < 9; i++) {
      const dx = x - centers[i].x
      const dy = y - centers[i].y
      if (dx * dx + dy * dy <= r * r) return i
    }
    return null
  }

  const addDot = (i: number) => {
    const cur = seqRef.current
    if (cur.includes(i)) return // a dot can never repeat (real Android)
    let next: number[]
    const last = cur[cur.length - 1]
    if (cur.length > 0) {
      const mid = SKIP_OVER[`${last}-${i}`]
      next = mid !== undefined && !cur.includes(mid) ? [...cur, mid, i] : [...cur, i]
    } else next = [i]
    seqRef.current = next
    setSeq(next)
  }

  const pos = (e: React.PointerEvent): { x: number; y: number } => {
    const r = wrapRef.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }

  const start = (e: React.PointerEvent) => {
    if (disabled || err) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drawing.current = true
    setIsDrawing(true)
    const p = pos(e)
    const hit = hitDot(p.x, p.y)
    /* every new drag is a fresh attempt (real Android) */
    seqRef.current = hit !== null ? [hit] : []
    setSeq(seqRef.current)
    setTrail(hit === null ? p : null)
  }

  const move = (e: React.PointerEvent) => {
    if (disabled || err || !drawing.current) return
    const p = pos(e)
    const hit = hitDot(p.x, p.y)
    if (hit !== null) {
      addDot(hit)
      setTrail(null) // snapped to a dot — no dangling trail
    } else setTrail(p)
  }

  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    setIsDrawing(false)
    setTrail(null)
    if (seqRef.current.length > 0) onComplete(seqRef.current)
    /* the drawn pattern stays visible for feedback; the next drag starts fresh,
       and errorNonce clears it after the red flash */
  }

  /* render geometry */
  const segs: [number, number][] = []
  for (let i = 1; i < seq.length; i++) segs.push([seq[i - 1], seq[i]])
  const active = isDrawing && trail && seq.length > 0 ? seq[seq.length - 1] : null
  const stroke = err ? '#fb7185' : '#7dd3fc'
  const glow = err ? 'rgba(251,113,133,.5)' : 'rgba(125,211,252,.45)'

  return (
    <div
      ref={wrapRef}
      role="application"
      aria-label={ariaLabel}
      className={`relative touch-none select-none ${disabled ? 'opacity-50' : ''}`}
      style={{ width: size, height: size }}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
    >
      <svg width={size} height={size} className="pointer-events-none absolute inset-0">
        {segs.map(([a, b], i) => (
          <line key={i} x1={centers[a].x} y1={centers[a].y} x2={centers[b].x} y2={centers[b].y} stroke={stroke} strokeWidth={5} strokeLinecap="round" opacity={0.85} style={{ filter: `drop-shadow(0 0 6px ${glow})` }} />
        ))}
        {active !== null && trail && (
          <line x1={centers[active].x} y1={centers[active].y} x2={trail.x} y2={trail.y} stroke={stroke} strokeWidth={4} strokeLinecap="round" opacity={0.5} />
        )}
      </svg>
      {centers.map((c, i) => {
        const on = seq.includes(i)
        return (
          <span
            key={i}
            className="pointer-events-none absolute rounded-full transition-all duration-150"
            style={{
              left: c.x - DOT / 2,
              top: c.y - DOT / 2,
              width: DOT,
              height: DOT,
              background: on ? stroke : 'rgba(255,255,255,0.16)',
              border: `2px solid ${on ? stroke : 'rgba(255,255,255,0.35)'}`,
              boxShadow: on ? `0 0 ${err ? 14 : 10}px ${glow}` : 'none',
              transform: on ? 'scale(1.25)' : 'scale(1)',
            }}
          />
        )
      })}
    </div>
  )
}

/* ================================== PinPad =================================== */

interface PinPadProps {
  /** fired on ✓ (or Enter) with the entered digits */
  onSubmit: (pin: string) => void
  /** increment to flash red + clear the entry */
  errorNonce?: number
  disabled?: boolean
  ariaLabel?: string
}

export function PinPad({ onSubmit, errorNonce = 0, disabled = false, ariaLabel = 'PIN entry' }: PinPadProps) {
  const [entry, setEntry] = useState('')
  const [seenNonce, setSeenNonce] = useState(errorNonce)
  const [err, setErr] = useState(false)
  const MAX = 8

  /* error flash: adjust state when the nonce changes (render-time, sanctioned) */
  if (errorNonce !== seenNonce) {
    setSeenNonce(errorNonce)
    if (errorNonce > 0) setErr(true)
  }
  useEffect(() => {
    if (!err) return
    const t = setTimeout(() => {
      setErr(false)
      setEntry('')
    }, 620)
    return () => clearTimeout(t)
  }, [err])

  const push = (d: string) => {
    if (disabled || err) return
    setEntry((e) => (e.length >= MAX ? e : e + d))
  }
  const back = () => setEntry((e) => e.slice(0, -1))
  const submit = () => {
    if (disabled || err || !entry) return
    onSubmit(entry)
    /* entry kept until the host signals errorNonce — on success the screen unmounts */
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (/^[0-9]$/.test(e.key)) push(e.key)
    else if (e.key === 'Backspace') back()
    else if (e.key === 'Enter') submit()
  }

  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok']

  return (
    <div tabIndex={0} onKeyDown={onKey} aria-label={ariaLabel} className="flex flex-col items-center gap-3 outline-none">
      {/* entered digits as dots */}
      <div className={`flex h-8 min-w-40 items-center justify-center gap-2 rounded-full border px-4 transition-colors ${err ? 'border-rose-400/70 bg-rose-950/40' : 'border-white/20 bg-black/40'}`}>
        {entry.length === 0 ? (
          <span className="text-[10px] tracking-wider text-slate-500">ENTER PIN</span>
        ) : (
          Array.from({ length: entry.length }, (_, i) => (
            <span key={i} className={`h-2.5 w-2.5 rounded-full transition-colors ${err ? 'bg-rose-400' : 'bg-sky-300'} ${err ? 'animate-[shake_0.4s_ease]' : ''}`} />
          ))
        )}
      </div>
      <div className="grid w-56 grid-cols-3 gap-2">
        {KEYS.map((k) => {
          if (k === 'del')
            return (
              <button key={k} type="button" onClick={back} disabled={disabled} aria-label="Delete digit" className="flex h-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 active:scale-95 disabled:opacity-40">
                <Delete className="h-5 w-5" />
              </button>
            )
          if (k === 'ok')
            return (
              <button key={k} type="button" onClick={submit} disabled={disabled || !entry} aria-label="Submit PIN" className="flex h-12 items-center justify-center rounded-xl bg-sky-600 text-white transition-colors hover:bg-sky-500 active:scale-95 disabled:opacity-40">
                <Check className="h-5 w-5" />
              </button>
            )
          return (
            <button key={k} type="button" onClick={() => push(k)} disabled={disabled} className="flex h-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-base font-semibold text-slate-100 transition-colors hover:bg-white/10 active:scale-95 disabled:opacity-40">
              {k}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* =============================== UnlockMethods =============================== */
/* The shared unlock panel: password / PIN / pattern with a chooser.
 * Used by the boot login screen AND the lock screen (Win+L / auto-lock). */

interface UnlockMethodsProps {
  /** verified — unlock the OS */
  onSuccess: () => void
  /** a wrong attempt with any method (host counts attempts / escalates lockout) */
  onFail?: () => void
  /** current wrong-attempt count (drives the "N of 5" note) */
  wrongCount?: number
  maxWrong?: number
  /** label for the no-auth button */
  noAuthLabel?: string
}

/* password entry — own component so switching methods unmounts it and the
   entry state resets naturally (no reset effects needed) */
function PasswordEntry({ password, onSuccess, onFail }: { password: string; onSuccess: () => void; onFail?: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  const [shake, setShake] = useState(false)
  const fail = () => {
    setErr(true)
    setShake(true)
    setTimeout(() => setShake(false), 500)
    onFail?.()
  }
  return (
    <div className={`flex items-center gap-2 ${shake ? 'animate-[shake_0.4s_ease]' : ''}`}>
      <input
        autoFocus
        type="password"
        value={pw}
        onChange={(e) => {
          setPw(e.target.value)
          setErr(false)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          if (pw === password) onSuccess()
          else fail()
        }}
        placeholder="Password"
        aria-label="Password"
        className="w-60 rounded-full border border-white/20 bg-black/45 px-5 py-2.5 text-center text-sm text-slate-100 outline-none focus:border-sky-400"
      />
      <button
        onClick={() => (pw === password ? onSuccess() : fail())}
        title="Unlock"
        aria-label="Unlock"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-600 text-white hover:bg-sky-500"
      >
        <LogIn className="h-4 w-4" />
      </button>
    </div>
  )
}

export function UnlockMethods({ onSuccess, onFail, wrongCount = 0, maxWrong = 5, noAuthLabel = 'Sign in' }: UnlockMethodsProps) {
  const password = useOS((s) => s.password)
  const pin = useOS((s) => s.pin)
  const pattern = useOS((s) => s.pattern)
  const prefUnlock = useOS((s) => s.prefUnlock)

  const methods = useMemo(() => {
    const list: { id: UnlockMethodId; label: string; icon: React.ComponentType<{ className?: string }> }[] = []
    if (password) list.push({ id: 'password', label: 'Password', icon: KeyRound })
    if (pin) list.push({ id: 'pin', label: 'PIN', icon: Hash })
    if (pattern && pattern.length >= 4) list.push({ id: 'pattern', label: 'Pattern', icon: LayoutGrid })
    return list
  }, [password, pin, pattern])

  const [active, setActive] = useState<UnlockMethodId | null>(null)
  const method = active && methods.some((m) => m.id === active) ? active : methods.find((m) => m.id === prefUnlock)?.id || methods[0]?.id || null

  /* per-method error nonces + which method failed last (for the note) */
  const [pinErrNonce, setPinErrNonce] = useState(0)
  const [patErrNonce, setPatErrNonce] = useState(0)
  const [lastWrong, setLastWrong] = useState<UnlockMethodId | null>(null)

  const fail = (m: UnlockMethodId) => {
    setLastWrong(m)
    onFail?.()
  }

  /* no method configured → plain button (original behaviour) */
  if (!method) {
    return (
      <button onClick={onSuccess} className="flex items-center gap-2 rounded-full bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-sky-500">
        <LogIn className="h-4 w-4" /> {noAuthLabel}
      </button>
    )
  }

  const wrongNote = wrongCount > 0 ? `Wrong ${method} — ${wrongCount} of ${maxWrong} before lockout` : lastWrong === method ? `Wrong ${method} — try again` : null

  return (
    <div className="flex flex-col items-center gap-3">
      {/* method chooser — only rendered when more than one method is configured */}
      {methods.length > 1 && (
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Unlock method">
          {methods.map((m) => {
            const on = m.id === method
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActive(m.id)}
                className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition-colors ${
                  on ? 'border-sky-400/60 bg-sky-500/20 text-sky-200' : 'border-white/15 bg-black/30 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                }`}
              >
                <m.icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            )
          })}
        </div>
      )}

      {wrongNote && <div className="text-xs text-rose-400">{wrongNote}</div>}

      {method === 'password' && <PasswordEntry password={password!} onSuccess={onSuccess} onFail={() => fail('password')} />}

      {method === 'pin' && (
        <PinPad
          errorNonce={pinErrNonce}
          onSubmit={(entered) => {
            if (entered === pin) {
              onSuccess()
            } else {
              setPinErrNonce((n) => n + 1)
              fail('pin')
            }
          }}
        />
      )}

      {method === 'pattern' && (
        <div className="rounded-3xl border border-white/15 bg-black/35 p-3 backdrop-blur">
          <PatternLock
            size={220}
            errorNonce={patErrNonce}
            onComplete={(drawn) => {
              if (patternsEqual(drawn, pattern)) {
                onSuccess()
              } else {
                setPatErrNonce((n) => n + 1)
                fail('pattern')
              }
            }}
          />
          <div className="mt-1 text-center text-[10px] tracking-wider text-slate-500">DRAW YOUR UNLOCK PATTERN</div>
        </div>
      )}
    </div>
  )
}

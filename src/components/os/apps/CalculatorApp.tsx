// REDSEC v5.0 — Calculator (scientific, mathjs-powered)
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { evaluate as mathEvaluate } from 'mathjs'
import { Delete, History, Trash2, X } from 'lucide-react'
import { AppShell, Toolbar, TBtn } from './_shared'
import { useOS } from '@/lib/os/store'
import type { AppProps } from '@/lib/os/types'

/* typed accessor for store actions (OSStore interface lacks action declarations) */
type OSApi = {
  notify: (n: { title: string; body?: string; emoji?: string; kind?: 'info' | 'success' | 'warn' | 'error' | 'voice' }) => unknown
  set: (patch: Partial<Record<string, unknown>>) => void
}
const osApi = () => useOS.getState() as unknown as OSApi

type Scope = Record<string, unknown>

function fmtResult(v: unknown): string {
  if (typeof v === 'number') {
    if (!isFinite(v)) return v > 0 ? '∞' : '-∞'
    return String(Number(v.toPrecision(12)))
  }
  if (v === null || v === undefined) return '0'
  try {
    const s = String(v)
    return s === 'Infinity' ? '∞' : s
  } catch {
    return '#ERR'
  }
}

function buildScope(deg: boolean, ans: number, mem: number): Scope {
  const D = Math.PI / 180
  const scope: Scope = { Ans: ans, M: mem }
  if (deg) {
    scope.sin = (x: number) => Math.sin(x * D)
    scope.cos = (x: number) => Math.cos(x * D)
    scope.tan = (x: number) => Math.tan(x * D)
    scope.asin = (x: number) => Math.asin(x) / D
    scope.acos = (x: number) => Math.acos(x) / D
    scope.atan = (x: number) => Math.atan(x) / D
    scope.sinh = (x: number) => Math.sinh(x * D)
    scope.cosh = (x: number) => Math.cosh(x * D)
    scope.tanh = (x: number) => Math.tanh(x * D)
  } else {
    scope.sin = Math.sin
    scope.cos = Math.cos
    scope.tan = Math.tan
    scope.asin = Math.asin
    scope.acos = Math.acos
    scope.atan = Math.atan
    scope.sinh = Math.sinh
    scope.cosh = Math.cosh
    scope.tanh = Math.tanh
  }
  return scope
}

function evaluateExpr(raw: string, deg: boolean, ans: number, mem: number): unknown {
  let e = raw.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
  // percent as /100 (50% → 0.5)
  e = e.replace(/(\d|\))\s*%/g, '$1/100')
  // calculator conventions: ln → natural log, log → log10
  e = e.replace(/\bln\s*\(/g, 'log(').replace(/\blog\s*\(/g, 'log10(')
  if (deg) {
    // longest names first so sin isn't matched inside asin
    e = e.replace(/\b(asinh|acosh|atanh|sinh|cosh|tanh|asin|acos|atan|sin|cos|tan)\s*\(/g, '$1D(')
  }
  const scope = buildScope(deg, ans, mem)
  if (deg) {
    const D = Math.PI / 180
    scope.sinD = (x: number) => Math.sin(x * D)
    scope.cosD = (x: number) => Math.cos(x * D)
    scope.tanD = (x: number) => Math.tan(x * D)
    scope.asinD = (x: number) => Math.asin(x) / D
    scope.acosD = (x: number) => Math.acos(x) / D
    scope.atanD = (x: number) => Math.atan(x) / D
    scope.sinhD = (x: number) => Math.sinh(x * D)
    scope.coshD = (x: number) => Math.cosh(x * D)
    scope.tanhD = (x: number) => Math.tanh(x * D)
  } else {
    scope.sinD = Math.sin
    scope.cosD = Math.cos
    scope.tanD = Math.tan
    scope.asinD = Math.asin
    scope.acosD = Math.acos
    scope.atanD = Math.atan
    scope.sinhD = Math.sinh
    scope.coshD = Math.cosh
    scope.tanhD = Math.tanh
  }
  return mathEvaluate(e, scope)
}

interface HistItem { expr: string; out: string }

export default function CalculatorApp({ winId }: AppProps) {
  const [expr, setExpr] = useState('')
  const [deg, setDeg] = useState(true)
  const [ans, setAns] = useState(0)
  const [mem, setMem] = useState(0)
  const [history, setHistory] = useState<HistItem[]>([])
  const [showHist, setShowHist] = useState(true)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState(false)

  /* live preview */
  const preview = useMemo<{ ok: boolean; val: string }>(() => {
    const t = expr.trim()
    if (!t) return { ok: false, val: '' }
    try {
      const v = evaluateExpr(t, deg, ans, mem)
      if (v === undefined || (typeof v === 'number' && isNaN(v))) return { ok: false, val: '' }
      return { ok: true, val: fmtResult(v) }
    } catch {
      return { ok: false, val: '' }
    }
  }, [expr, deg, ans, mem])

  const insert = useCallback((s: string) => {
    setExpr((e) => e + s)
    setError('')
  }, [])

  const equals = useCallback(() => {
    const t = expr.trim()
    if (!t) return
    try {
      const v = evaluateExpr(t, deg, ans, mem)
      const out = fmtResult(v)
      if (out === '#ERR' || v === undefined || (typeof v === 'number' && isNaN(v))) {
        setError('Invalid expression')
        setFlash(true)
        setTimeout(() => setFlash(false), 400)
        return
      }
      const num = typeof v === 'number' ? v : Number(v)
      setAns(isFinite(num) ? num : ans)
      setHistory((h) => [{ expr: t, out }, ...h].slice(0, 10))
      setExpr(out === '∞' || out === '-∞' ? '' : out)
      setError('')
    } catch {
      setError('Invalid expression')
      setFlash(true)
      setTimeout(() => setFlash(false), 400)
    }
  }, [expr, deg, ans, mem])

  const memPlus = useCallback(() => {
    let v = mem
    if (preview.ok) {
      const n = Number(preview.val)
      if (!isNaN(n)) v = n
    }
    setMem(v)
    osApi().notify({ title: `Memory = ${fmtResult(v)}`, emoji: '🧮', kind: 'info' })
  }, [preview, mem])

  /* keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useOS.getState().focusedWin !== winId) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' && e.key !== 'Enter' && e.key !== 'Escape') return
      if (e.key === 'Enter') {
        e.preventDefault()
        equals()
      } else if (e.key === 'Escape') {
        setExpr('')
        setError('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [equals, winId])

  const sciBtns: Array<[string, string, string?]> = [
    ['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('], ['ln', 'ln('], ['log', 'log('],
    ['sin⁻¹', 'asin('], ['cos⁻¹', 'acos('], ['tan⁻¹', 'atan('], ['√', 'sqrt('], ['∛', 'cbrt('],
    ['π', 'pi'], ['e', 'e'], ['xʸ', '^'], ['(', '('], [')', ')'],
    ['abs', 'abs('], ['exp', 'exp('], ['x!', '!'], ['sinh', 'sinh('], ['cosh', 'cosh('],
  ]

  const mainBtns: string[] = [
    'C', '⌫', '%', '÷',
    '7', '8', '9', '×',
    '4', '5', '6', '−',
    '1', '2', '3', '+',
    '0', '.', 'Ans', '=',
  ]

  const onMain = useCallback(
    (label: string) => {
      if (label === 'C') { setExpr(''); setError(''); return }
      if (label === '⌫') { setExpr((e) => e.slice(0, -1)); return }
      if (label === '=') { equals(); return }
      if (label === 'Ans') { insert('Ans'); return }
      insert(label)
    },
    [equals, insert]
  )

  return (
    <AppShell>
      <Toolbar>
        <TBtn active={deg} onClick={() => setDeg(true)} title="Degree mode">DEG</TBtn>
        <TBtn active={!deg} onClick={() => setDeg(false)} title="Radian mode">RAD</TBtn>
        <TBtn onClick={memPlus} title="Add current result to memory">M+</TBtn>
        <TBtn onClick={() => insert('M')} title="Recall memory">MR</TBtn>
        <TBtn onClick={() => setMem(0)} title="Clear memory" disabled={mem === 0}><Trash2 className="h-3.5 w-3.5" /></TBtn>
        <div className="ml-auto flex items-center gap-2">
          {mem !== 0 && <span className="rounded bg-sky-600/30 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">M {fmtResult(mem)}</span>}
          <TBtn active={showHist} onClick={() => setShowHist((s) => !s)} title="History"><History className="h-4 w-4" /></TBtn>
        </div>
      </Toolbar>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* display */}
        <div className={`flex-none border-b border-white/10 px-4 pb-3 pt-4 text-right transition-colors ${flash ? 'bg-rose-950/40' : ''}`}>
          <input
            value={expr}
            onChange={(e) => { setExpr(e.target.value); setError('') }}
            placeholder="0"
            aria-label="Expression"
            className="w-full bg-transparent text-right text-2xl font-semibold text-slate-100 outline-none placeholder:text-slate-600"
          />
          <div className="mt-1 h-6 text-base font-medium">
            {error ? (
              <span className="text-rose-400">{error}</span>
            ) : preview.ok ? (
              <span className="text-sky-400">= {preview.val}</span>
            ) : (
              <span className="text-slate-600">ready · {deg ? 'degrees' : 'radians'}</span>
            )}
          </div>
        </div>

        {/* history */}
        {showHist && (
          <div className="os-scroll max-h-[130px] min-h-[52px] flex-none overflow-y-auto border-b border-white/10 bg-[#121724] px-2 py-1.5">
            {history.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-slate-600">History appears here (last 10) — click to reuse.</div>
            ) : (
              history.map((h, i) => (
                <button
                  key={`${i}-${h.expr}`}
                  onClick={() => { setExpr(h.expr); setError('') }}
                  className="flex h-8 w-full items-center justify-between rounded-md px-2 text-left hover:bg-white/5"
                >
                  <span className="max-w-[60%] truncate text-[11px] text-slate-400">{h.expr}</span>
                  <span className="text-xs font-medium text-sky-300">= {h.out}</span>
                </button>
              ))
            )}
          </div>
        )}

        {/* sci pad */}
        <div className="grid flex-none grid-cols-5 gap-1 p-2 pb-0">
          {sciBtns.map(([label, ins]) => (
            <button
              key={label}
              onClick={() => insert(ins)}
              className="flex h-9 items-center justify-center rounded-md bg-white/5 text-[11px] font-medium text-slate-300 transition-all hover:bg-white/12 hover:text-white active:scale-95"
            >
              {label}
            </button>
          ))}
        </div>

        {/* main pad */}
        <div className="grid flex-1 grid-cols-4 gap-1 p-2">
          {mainBtns.map((label, i) => {
            const isEq = label === '='
            const isOp = ['÷', '×', '−', '+', '%'].includes(label)
            const isClear = label === 'C' || label === '⌫'
            return (
              <button
                key={`${label}-${i}`}
                onClick={() => onMain(label)}
                className={`flex items-center justify-center rounded-md text-base font-semibold transition-all active:scale-95 ${
                  isEq
                    ? 'bg-sky-600 text-white hover:bg-sky-500'
                    : isOp
                      ? 'bg-white/10 text-sky-300 hover:bg-white/16'
                      : isClear
                        ? 'bg-white/5 text-rose-300 hover:bg-white/12'
                        : 'bg-white/8 text-slate-100 hover:bg-white/14'
                }`}
              >
                {label === '⌫' ? <Delete className="h-4 w-4" /> : label}
              </button>
            )
          })}
        </div>

        <div className="flex flex-none items-center justify-between border-t border-white/10 px-3 py-1 text-[10px] text-slate-600">
          <span>Enter = solve · Esc = clear · Ans & M supported</span>
          <X className="h-3 w-3 opacity-0" />
        </div>
      </div>
    </AppShell>
  )
}

// REDSEC v5.0 — Task 26: OpenCode lightweight code editor (zero dependencies).
// Line-number gutter + highlighted <pre> underlay + transparent textarea on
// top, all scroll-synced. Handles Tab→2 spaces, auto-indent, auto-close pairs,
// Ctrl/Cmd+S save and Ctrl/Cmd+Enter run.
'use client'

import React, { useLayoutEffect, useMemo, useRef } from 'react'
import { tokenize } from './highlight'

const MONO: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontVariantLigatures: 'none',
  tabSize: 2,
}

const TOK_CLS: Record<string, string> = {
  com: 'text-slate-500 italic',
  str: 'text-sky-300',
  num: 'text-amber-300',
  kw: 'text-orange-400',
  tag: 'text-rose-400',
  attr: 'text-amber-200',
}

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', "'": "'", '"': '"', '`': '`' }

interface Props {
  code: string
  family: string
  onChange: (code: string) => void
  onSave: () => void
  onRun: () => void
}

export default function CodeEditor({ code, family, onChange, onSave, onRun }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const gutRef = useRef<HTMLDivElement>(null)
  const selRef = useRef<{ s: number; e: number } | null>(null)

  const toks = useMemo(() => tokenize(`${code}\n`, family), [code, family])
  const lineCount = useMemo(() => code.split('\n').length, [code])

  useLayoutEffect(() => {
    if (selRef.current && taRef.current) {
      try {
        taRef.current.selectionStart = selRef.current.s
        taRef.current.selectionEnd = selRef.current.e
      } catch {
        /* ignore */
      }
      selRef.current = null
    }
  }, [code])

  const syncScroll = () => {
    const ta = taRef.current
    if (!ta) return
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop
      preRef.current.scrollLeft = ta.scrollLeft
    }
    if (gutRef.current) gutRef.current.scrollTop = ta.scrollTop
  }

  const commit = (next: string, caret: number) => {
    selRef.current = { s: caret, e: caret }
    onChange(next)
  }

  const insertAt = (pos: number, text: string, caretAt: number) => {
    commit(code.slice(0, pos) + text + code.slice(pos), caretAt)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = taRef.current
    if (!ta) return
    const s = ta.selectionStart
    const en = ta.selectionEnd
    const mod = e.ctrlKey || e.metaKey

    if (mod && (e.key === 's' || e.key === 'S')) {
      e.preventDefault()
      onSave()
      return
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault()
      onRun()
      return
    }
    if (mod) return

    if (e.key === 'Tab') {
      e.preventDefault()
      insertAt(s, '  ', s + 2)
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const lineStart = code.lastIndexOf('\n', s - 1) + 1
      const line = code.slice(lineStart, s)
      const indent = (line.match(/^[ \t]*/) || [''])[0]
      const opens = /[{([]\s*$/.test(line.trimEnd())
      const extra = opens ? '  ' : ''
      const nextCh = code[s] || ''
      if (opens && (nextCh === '}' || nextCh === ')' || nextCh === ']')) {
        const text = `\n${indent}${extra}\n${indent}`
        onChange(code.slice(0, s) + text + code.slice(en))
        selRef.current = { s: s + 1 + indent.length + extra.length, e: s + 1 + indent.length + extra.length }
      } else {
        insertAt(s, `\n${indent}${extra}`, s + 1 + indent.length + extra.length)
      }
      return
    }

    if (PAIRS[e.key]) {
      const closer = PAIRS[e.key]
      const isQuote = e.key === closer
      e.preventDefault()
      if (s !== en) {
        // wrap the selection
        const sel = code.slice(s, en)
        const next = code.slice(0, s) + e.key + sel + closer + code.slice(en)
        const caret = s + 1 + sel.length + 1
        onChange(next)
        selRef.current = { s: caret, e: caret }
        return
      }
      if (isQuote && code[s] === e.key) {
        commit(code, s + 1) // type over the closing quote
        return
      }
      if (isQuote && /[\w$]/.test(code[s - 1] || '')) {
        insertAt(s, e.key, s + 1) // plain quote after a word char
        return
      }
      if (!isQuote && /[\w$]/.test(code[s] || '')) {
        insertAt(s, e.key, s + 1)
        return
      }
      insertAt(s, e.key + closer, s + 1)
      return
    }

    if ((e.key === ')' || e.key === ']' || e.key === '}') && code[s] === e.key) {
      e.preventDefault()
      commit(code, s + 1) // skip over the auto-closed bracket
      return
    }

    if (e.key === 'Backspace' && s === en && s > 0) {
      const prev = code[s - 1]
      if (PAIRS[prev] && PAIRS[prev] === code[s]) {
        e.preventDefault()
        commit(code.slice(0, s - 1) + code.slice(s + 1), s - 1)
      }
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0d1117]">
      {/* line-number gutter */}
      <div
        ref={gutRef}
        aria-hidden
        className="absolute bottom-0 left-0 top-0 z-10 w-11 select-none overflow-hidden border-r border-white/5 bg-[#0d1117] px-0 pb-10 pt-3 text-right"
        style={MONO}
      >
        <div className="text-[12px] leading-[20px] text-slate-600">
          {Array.from({ length: Math.max(lineCount, 1) }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
      </div>
      {/* highlighted underlay */}
      <pre
        ref={preRef}
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-11 right-0 top-0 overflow-hidden whitespace-pre px-3 pb-10 pt-3 text-[12px] leading-[20px] text-slate-200"
        style={MONO}
      >
        {toks.map((tk, i) =>
          tk.c ? (
            <span key={i} className={TOK_CLS[tk.c] || ''}>
              {tk.t}
            </span>
          ) : (
            <React.Fragment key={i}>{tk.t}</React.Fragment>
          )
        )}
      </pre>
      {/* input layer */}
      <textarea
        ref={taRef}
        value={code}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={syncScroll}
        spellCheck={false}
        wrap="off"
        aria-label="Code editor"
        className="absolute bottom-0 left-11 right-0 top-0 resize-none overflow-auto whitespace-pre bg-transparent px-3 pb-10 pt-3 text-[12px] leading-[20px] text-transparent caret-white outline-none selection:bg-sky-500/25"
        style={MONO}
      />
    </div>
  )
}

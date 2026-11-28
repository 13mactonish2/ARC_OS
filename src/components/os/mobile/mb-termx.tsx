// REDSEC 6.0 — Task 66: Term X on RedSec Mobile (the phone side of `mobile`
// in the OS terminal). Joins the same term:<token> room the PC terminal is in,
// sends commands, streams the real output. The pairing token is saved on the
// phone forever — the terminal stays available until the owner turns it off
// from the OS (`mobile off` / `mobile new`).
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Send, TerminalSquare, Loader2 } from 'lucide-react'
import { commSocket } from '@/lib/os/comm'
import { MbBar, useMb } from './mb-shared'

interface TermLine {
  id: number
  text: string
  mine?: boolean // echoed command
  dim?: boolean
}

const MAX_LINES = 400

export function MbTermX() {
  const { token, owner } = useMb()
  const [lines, setLines] = useState<TermLine[]>([])
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'connecting' | 'live' | 'off' | 'nopc'>('connecting')
  const [disabledMsg, setDisabledMsg] = useState('')
  const idRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const pushLine = useCallback((t: string, opts?: { mine?: boolean; dim?: boolean }) => {
    setLines((prev) => {
      const next = [...prev, { id: idRef.current++, text: t, ...opts }]
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
    })
  }, [])

  /* join the term room as the phone side */
  useEffect(() => {
    if (!token) return
    const s = commSocket()
    let joined = false
    let dead = false

    const onOut = (d: { lines?: string[] }) => {
      for (const l of d?.lines || []) pushLine(String(l))
    }
    const onCmd = (d: { cmd?: string; device?: string }) => {
      // our own command echoed by the PC (prompt + output follow via term:out)
      if (d?.cmd) pushLine(`${d.device || 'phone'} ❯ ${d.cmd}`, { mine: true, dim: true })
    }
    const onState = (d: { state?: { enabled?: boolean; reason?: string } }) => {
      if (d?.state?.enabled === false) {
        setStatus('off')
        setDisabledMsg(d.state.reason || 'The terminal was turned off on the OS.')
      } else if (d?.state?.enabled === true) {
        setStatus(joined ? 'live' : 'connecting')
        setDisabledMsg('')
        pushLine('Term X mobile is back ON — commands run on the OS again.', { dim: true })
      }
    }
    const onPcOnline = () => {
      setStatus((cur) => (cur === 'nopc' ? 'live' : cur))
    }

    s.on('term:out', onOut)
    s.on('term:cmd', onCmd)
    s.on('term:state', onState)
    s.on('term:pc-online', onPcOnline)

    void (async () => {
      for (let i = 0; i < 8 && !joined && !dead; i++) {
        joined = await new Promise<boolean>((res) => {
          const to = setTimeout(() => res(false), 2200)
          s.emit('term:join', { token, device: 'RedSec Mobile', kind: 'phone' }, (r: { ok?: boolean }) => {
            clearTimeout(to)
            res(!!r?.ok)
          })
        })
      }
      if (dead) return
      if (!joined) {
        setStatus('nopc')
        pushLine('could not reach the comm service — check the network and reopen Term X.', { dim: true })
        return
      }
      setStatus('live')
      pushLine(`── TERM X MOBILE ── linked with ${owner || 'the OS'} ──`, { dim: true })
      pushLine('type a command — it runs on the OS in real time. output streams back here.', { dim: true })
      pushLine('try: help · open songs · pkg list · scan quick · mobile off turns it off from the OS side', { dim: true })
    })()

    return () => {
      dead = true
      s.off('term:out', onOut)
      s.off('term:cmd', onCmd)
      s.off('term:state', onState)
      s.off('term:pc-online', onPcOnline)
      s.emit('term:leave')
    }
  }, [token, owner, pushLine])

  /* auto-scroll */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [lines, status])

  const send = () => {
    const cmd = text.trim()
    if (!cmd) return
    if (status === 'off') return
    setText('')
    if (!token) {
      pushLine('not paired yet — scan the QR from the OS terminal first ("mobile" in Term X on the PC).', { dim: true })
      return
    }
    commSocket().emit('term:cmd', { token, cmd })
    pushLine(`❯ ${cmd}`, { mine: true })
  }

  if (!token) {
    return (
      <div className="flex h-full flex-col">
        <MbBar title="Term X" subtitle="not paired" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <TerminalSquare className="h-8 w-8" style={{ color: 'var(--mb-dim)' }} />
          <div className="text-[12px] font-semibold" style={{ color: 'var(--mb-text)' }}>Not paired yet</div>
          <div className="text-[10.5px] leading-snug" style={{ color: 'var(--mb-dim)' }}>
            Open Term X on the OS and type <b>mobile</b> — then scan the QR with this device. The pairing is saved forever.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <MbBar
        title="Term X"
        subtitle={
          status === 'live' ? `live · runs on ${owner || 'the OS'}` : status === 'off' ? 'turned off on the OS' : status === 'nopc' ? 'comm service unreachable' : 'connecting…'
        }
        right={
          status === 'connecting' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--mb-accent)' }} />
          ) : (
            <span className="h-2 w-2 rounded-full" style={{ background: status === 'live' ? '#4ade80' : status === 'off' ? '#f87171' : '#fbbf24' }} />
          )
        }
      />
      {status === 'off' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <TerminalSquare className="h-8 w-8" style={{ color: '#f87171' }} />
          <div className="text-[12px] font-semibold" style={{ color: 'var(--mb-text)' }}>Terminal turned off</div>
          <div className="text-[10.5px] leading-snug" style={{ color: 'var(--mb-dim)' }}>
            {disabledMsg || 'The terminal was disabled on the OS.'} Re-open it with <b>mobile on</b> in Term X on the OS — or start fresh with <b>mobile new</b>.
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-2.5 py-2 font-mono text-[10.5px] leading-[1.5]" style={{ background: '#050807', color: '#c9f7d4' }}>
            {lines.map((l) => (
              <div
                key={l.id}
                className="whitespace-pre-wrap break-words"
                style={{ color: l.mine ? '#7dd3fc' : l.dim ? '#4b6b58' : '#c9f7d4' }}
              >
                {l.text}
              </div>
            ))}
            {status === 'connecting' && (
              <div className="flex items-center gap-1.5 py-1" style={{ color: '#4b6b58' }}>
                <Loader2 className="h-3 w-3 animate-spin" /> reaching the OS…
              </div>
            )}
          </div>
          <div className="flex flex-none items-center gap-2 border-t px-2.5 py-2" style={{ borderColor: 'color-mix(in srgb, var(--mb-text) 10%, transparent)' }}>
            <span className="font-mono text-[12px] font-bold" style={{ color: 'var(--mb-accent)' }}>❯</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder={status === 'live' ? 'run a command on the OS…' : 'waiting for the link…'}
              className="min-w-0 flex-1 rounded-xl border px-3 py-2 font-mono text-[12px] outline-none"
              style={{ borderColor: 'color-mix(in srgb, var(--mb-text) 14%, transparent)', background: 'var(--mb-bg2)', color: 'var(--mb-text)' }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={send}
              aria-label="Send command"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-white active:scale-95"
              style={{ background: 'var(--mb-accent)' }}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

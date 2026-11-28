// REDSEC 5.0 — Task 18: MobileOwnerConsole, the phone-side fleet cockpit.
// Standalone full-screen page: opens via the owner QR → /?owner=<r5own-token>.
// Shows every tracked device/user, fleet stats, and can push system updates
// (POST /api/owner/update + fleet:update broadcast over the comm-service).
// HARDENED: locked behind the FINAL-PASSWORD vault gate (server-verified) —
// even a leaked QR link is useless without the owner's final password.
//
// EXPORTS (main agent wiring — render at /?owner=, ssr:false):
//   export default MobileOwnerConsole — reads ?owner= from the URL itself,
//   no props. Final-password vault first, then the console (or the red
//   "OWNER ONLY" lock card when the token is rejected (403)).
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Copy, Check, Lock, Loader2, MonitorSmartphone, RefreshCw,
  Send, ShieldCheck, Users,
} from 'lucide-react'
import { commSocket } from '@/lib/os/comm'
import { OwnerVaultGate } from '../OwnerVaultGate'
import { REDSEC } from '@/lib/os/redsec'

interface SessionRow {
  id: string
  username: string
  browser: string
  osName: string
  device: string
  screen: string
  firstSeen: string
  lastSeen: string
  pings: number
}

interface SessionsPayload {
  ok?: boolean
  owner?: string
  sessions?: SessionRow[]
  total?: number
  fleetUpdate?: { build: string; note: string; at: number } | null
}

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 45) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const ACCENT = '#e4002b'

export default function MobileOwnerConsole() {
  return (
    <OwnerVaultGate fullscreen>
      <MobileOwnerConsoleInner />
    </OwnerVaultGate>
  )
}

function MobileOwnerConsoleInner() {
  const [token, setToken] = useState('')
  const [data, setData] = useState<SessionsPayload | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'forbidden' | 'error'>('loading')
  const [copied, setCopied] = useState(false)
  const [build, setBuild] = useState<string>(REDSEC.build)
  const [note, setNote] = useState('')
  const [pushing, setPushing] = useState(false)
  const [pushed, setPushed] = useState<string | null>(null)
  const sockRef = useRef<ReturnType<typeof commSocket> | null>(null)

  /* token from the QR deep-link (?owner=r5own-…) */
  useEffect(() => {
    let dead = false
    Promise.resolve().then(() => {
      if (dead) return
      const t = (new URLSearchParams(window.location.search).get('owner') || '').trim()
      setToken(t)
    })
    return () => { dead = true }
  }, [])

  const load = useCallback(async () => {
    if (!token) return
    setState((s) => (s === 'ok' ? s : 'loading'))
    try {
      const r = await fetch(`/api/owner/sessions?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      if (r.status === 403) { setState('forbidden'); return }
      const j = (await r.json()) as SessionsPayload
      if (r.ok) { setData(j); setState('ok') } else setState('error')
    } catch { setState('error') }
  }, [token])

  /* fleet poll — every 15 s on mobile */
  useEffect(() => {
    if (!token) return
    let dead = false
    void load()
    const t = setInterval(() => { if (!dead) void load() }, 15_000)
    return () => { dead = true; clearInterval(t) }
  }, [token, load])

  /* keep a comm socket warm so pushes broadcast instantly */
  useEffect(() => {
    if (!token) return
    let dead = false
    Promise.resolve().then(() => { if (!dead) sockRef.current = commSocket() })
    return () => { dead = true }
  }, [token])

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { /* clipboard blocked */ }
  }

  const pushUpdate = async () => {
    if (!token || !build.trim() || pushing) return
    setPushing(true)
    try {
      const r = await fetch('/api/owner/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, build: build.trim(), note: note.trim() }),
      })
      const j = (await r.json()) as { ok?: boolean }
      if (r.ok && j.ok) {
        sockRef.current?.emit('fleet:update', { build: build.trim(), note: note.trim(), at: Date.now() })
        setPushed(build.trim())
        setNote('')
        setTimeout(() => setPushed(null), 5000)
        void load()
      } else if (r.status === 403) setState('forbidden')
    } catch { /* keep going */ }
    finally { setPushing(false) }
  }

  const sessions = data?.sessions || []
  const users = new Set(sessions.map((s) => s.username)).size

  return (
    <div className="min-h-screen w-full bg-[#050608] text-slate-100" style={{ WebkitTapHighlightColor: 'transparent' }}>
      {/* sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-white/8 bg-[#0a0b10]/95 px-4 py-3 backdrop-blur"
      >
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl" style={{ background: 'rgba(228,0,43,.14)' }}>
          <ShieldCheck className="h-5 w-5" style={{ color: '#ff5d76' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold">Owner Console · REDSEC</div>
          <div className="truncate text-[9px] uppercase tracking-wider text-slate-500">
            {state === 'ok' ? `fleet of ${data?.owner || '—'}` : 'secure fleet management'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh fleet"
          className="flex h-11 w-11 items-center justify-center rounded-xl active:scale-95"
          style={{ background: 'rgba(255,255,255,.06)', color: '#94a3b8' }}
        >
          <RefreshCw className={`h-5 w-5 ${state === 'loading' ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mx-auto max-w-md space-y-4 p-4 pb-10">
        {/* ---------- no token yet ---------- */}
        {!token && (
          <div className="rounded-2xl border border-rose-400/30 bg-[#170609] p-5 text-center">
            <Lock className="mx-auto h-9 w-9 text-rose-300" />
            <div className="mt-2 text-[15px] font-bold text-rose-200">OWNER ONLY</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">
              No owner token in this link. Scan the QR from the Owner Console on the owner&apos;s PC.
            </p>
          </div>
        )}

        {/* ---------- rejected token ---------- */}
        {token && state === 'forbidden' && (
          <div className="rounded-2xl border border-rose-400/40 bg-[#170609] p-5 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/15">
              <Lock className="h-6 w-6 text-rose-300" />
            </div>
            <div className="mt-2 text-[15px] font-extrabold tracking-wide text-rose-200">OWNER ONLY</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-rose-100/70">
              This token was rejected — the link is invalid or the owner role changed. The fleet refuses to talk to strangers.
            </p>
            <div className="mt-3 truncate rounded-xl bg-black/40 px-3 py-2 font-mono text-[10px] text-slate-600">{token.slice(0, 14)}…</div>
          </div>
        )}

        {token && state === 'error' && (
          <div className="rounded-2xl border border-white/10 bg-white/4 p-4 text-center text-[12px] text-slate-400">
            Fleet unreachable — tap the refresh button to retry.
          </div>
        )}

        {/* ---------- fleet ---------- */}
        {token && state === 'ok' && (
          <>
            {/* stat chips */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-white/8 bg-white/4 p-3 text-center">
                <MonitorSmartphone className="mx-auto h-4 w-4 text-sky-300" />
                <div className="mt-1 text-xl font-extrabold text-sky-300">{data?.total ?? sessions.length}</div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">devices</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/4 p-3 text-center">
                <Users className="mx-auto h-4 w-4 text-violet-300" />
                <div className="mt-1 text-xl font-extrabold text-violet-300">{users}</div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">users</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/4 p-3 text-center">
                <ShieldCheck className="mx-auto h-4 w-4 text-sky-300" />
                <div className="mt-1 truncate text-[13px] font-extrabold leading-7 text-sky-300">{data?.fleetUpdate?.build || REDSEC.build}</div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">build</div>
              </div>
            </div>

            {/* session cards */}
            {sessions.length === 0 && (
              <div className="rounded-2xl border border-white/8 bg-white/4 p-4 text-[11.5px] leading-relaxed text-slate-500">
                No devices tracked yet. Every device that boots this OS registers itself automatically.
              </div>
            )}
            {sessions.map((s) => (
              <div key={s.id} className="rounded-2xl border border-white/8 bg-white/4 p-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-white/8 text-[12px] font-extrabold uppercase text-slate-200">
                    {s.username.slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold text-slate-100">{s.username}</div>
                    <div className="text-[10px] text-slate-500">seen {relTime(s.lastSeen)} ago · {s.pings} pings</div>
                  </div>
                  <span className="flex-none rounded-full px-2.5 py-1 text-[9px] font-bold" style={{ background: 'rgba(14,165,233,.12)', color: '#38bdf8' }}>
                    {s.device}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-white/8 px-2.5 py-1 text-[9.5px] font-semibold text-slate-300">{s.browser}</span>
                  <span className="rounded-full bg-white/8 px-2.5 py-1 text-[9.5px] font-semibold text-slate-400">{s.osName}</span>
                  <span className="rounded-full bg-white/8 px-2.5 py-1 font-mono text-[9.5px] text-slate-500">{s.screen}</span>
                </div>
              </div>
            ))}

            {/* push system update */}
            <div className="rounded-2xl border border-rose-400/25 bg-[#170609] p-4">
              <div className="flex items-center gap-2 text-[13px] font-bold text-rose-200">
                <AlertTriangle className="h-4 w-4" /> Push system update
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Every running device pops a red SYSTEM UPDATE warning instantly.
              </p>
              <input
                value={build}
                onChange={(e) => setBuild(e.target.value)}
                placeholder="build"
                aria-label="Build number"
                className="mt-3 h-11 w-full rounded-xl border border-white/12 bg-black/40 px-3 font-mono text-[13px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-rose-400/60"
              />
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What changed in this build…"
                aria-label="Update note"
                rows={3}
                className="mt-2 w-full resize-none rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[13px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-rose-400/60"
              />
              <button
                type="button"
                onClick={() => void pushUpdate()}
                disabled={pushing || !build.trim()}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-bold text-white active:scale-[.99] disabled:opacity-50"
                style={{ background: ACCENT, boxShadow: '0 10px 30px rgba(228,0,43,.3)' }}
              >
                {pushing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                Push update to all devices
              </button>
              {pushed && (
                <div className="mt-2 rounded-xl border border-sky-400/25 bg-sky-400/8 px-3 py-2 text-[11.5px] font-semibold text-sky-300">
                  Build {pushed} broadcast — all devices warned.
                </div>
              )}
            </div>

            {/* owner token footer */}
            <button
              type="button"
              onClick={() => void copyToken()}
              className="flex w-full items-center justify-between rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-left active:scale-[.99]"
            >
              <span className="min-w-0">
                <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500">owner token</span>
                <span className="block truncate font-mono text-[11px] text-slate-400">{token}</span>
              </span>
              {copied ? <Check className="h-5 w-5 flex-none text-sky-400" /> : <Copy className="h-5 w-5 flex-none text-slate-500" />}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

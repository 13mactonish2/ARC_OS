// REDSEC 5.0 — Task 18: Owner Console (PC app, id 'ownerconsole').
// The owner's cockpit for the distributed fleet: shows the mobile-console QR,
// every tracked device/user session, and can push a system update that pops a
// warning toast on ALL running devices (via the comm-service broadcast).
// HARDENED: the whole app sits behind the FINAL-PASSWORD vault gate
// (OwnerVaultGate → server-verified /api/owner/vault) — nobody gets past the
// lock screen without the final password, owner device or not.
//
// EXPORTS: default OwnerConsoleApp — props { winId: string; args?: Record<string, unknown> }
// Registry wiring (main agent): APP_META.ownerconsole + suite(() => import('./apps/OwnerConsoleApp'))
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Copy, Check, ExternalLink, RefreshCw, Send, ShieldCheck, Lock, MonitorSmartphone,
  Users, Globe, QrCode, AlertTriangle, Loader2,
} from 'lucide-react'
import { AppShell } from './_shared'
import { OwnerVaultGate } from '../OwnerVaultGate'
import { useOS } from '@/lib/os/store'
import { makeQr, commSocket, logSecEvent } from '@/lib/os/comm'
import { REDSEC } from '@/lib/os/redsec'
import { ensureOwner, getLocalOwner, ownerUrl, resolveDevFleetToken, type LocalOwner } from '@/lib/os/owner'

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
  devGrant?: boolean
  sessions?: SessionRow[]
  total?: number
  fleetUpdate?: { build: string; note: string; at: number } | null
}

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default function OwnerConsoleApp(props: { winId: string; args?: Record<string, unknown> }) {
  return (
    <OwnerVaultGate>
      <OwnerConsoleInner {...props} />
    </OwnerVaultGate>
  )
}

function OwnerConsoleInner({ winId }: { winId: string; args?: Record<string, unknown> }) {
  void winId
  const username = useOS((s) => s.username)
  const devMode = useOS((s) => s.devMode) // Task 56 — Developer Options unlock the console
  const [owner, setOwner] = useState<LocalOwner | null>(null)
  const [devToken, setDevToken] = useState<string>('')
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  const [data, setData] = useState<SessionsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [build, setBuild] = useState<string>(REDSEC.build)
  const [note, setNote] = useState('')
  const [pushing, setPushing] = useState(false)
  const [pushed, setPushed] = useState<string | null>(null)
  const tickRef = useRef(0)

  /* claim / load the owner role (deferred — localStorage + fetch out of effect body) */
  useEffect(() => {
    let dead = false
    Promise.resolve().then(() => {
      if (dead) return
      const cached = getLocalOwner()
      if (cached) setOwner(cached)
      if (username) void ensureOwner(username).then((rec) => { if (!dead) setOwner(rec) })
    })
    return () => { dead = true }
  }, [username])

  /* Task 56 — with Developer Options ON, claim the scoped r5dev-… grant */
  useEffect(() => {
    if (!devMode) {
      setDevToken('')
      return
    }
    let dead = false
    Promise.resolve().then(async () => {
      const t = await resolveDevFleetToken(username || 'owner')
      if (!dead && t) setDevToken(t)
    })
    return () => {
      dead = true
    }
  }, [devMode, username])

  const token = owner?.token || ''
  const isRealOwner = token.startsWith('r5own-')
  const fleetToken = isRealOwner ? token : devMode ? devToken : ''
  const devWatching = !!fleetToken && !isRealOwner

  /* QR for the mobile console deep-link */
  useEffect(() => {
    if (!isRealOwner) return
    let dead = false
    void makeQr(ownerUrl(token)).then((url) => { if (!dead) setQr(url) })
    return () => { dead = true }
  }, [isRealOwner, token])

  const load = useCallback(async () => {
    if (!fleetToken) return
    tickRef.current++
    try {
      const r = await fetch(`/api/owner/sessions?token=${encodeURIComponent(fleetToken)}`, { cache: 'no-store' })
      const j = (await r.json()) as SessionsPayload
      if (r.ok) setData(j)
    } catch { /* transient — next poll retries */ }
    finally { setLoading(false) }
  }, [fleetToken])

  /* fleet poll — every 10 s */
  useEffect(() => {
    if (!fleetToken) return
    let dead = false
    void load()
    const t = setInterval(() => { if (!dead) void load() }, 10_000)
    return () => { dead = true; clearInterval(t) }
  }, [fleetToken, load])

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(ownerUrl(token))
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { /* clipboard blocked */ }
  }

  const pushUpdate = async () => {
    if (!fleetToken || !build.trim() || pushing) return
    setPushing(true)
    const at = Date.now()
    try {
      const r = await fetch('/api/owner/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: fleetToken, build: build.trim(), note: note.trim() }),
      })
      const j = (await r.json()) as { ok?: boolean }
      if (r.ok && j.ok) {
        // broadcast to every running OS instance — FleetUpdateToast pops fleet-wide
        commSocket().emit('fleet:update', { build: build.trim(), note: note.trim(), at })
        logSecEvent('owner', `Fleet update pushed: build ${build.trim()} → all devices`, 'warn')
        setPushed(build.trim())
        setNote('')
        setTimeout(() => setPushed(null), 5000)
        void load()
      }
    } catch { /* next poll shows the state */ }
    finally { setPushing(false) }
  }

  /* ---------------- locked state ----------------
     Task 56 — Developer Options also unlock the device gate (r5dev-… grant) */
  if (owner && !isRealOwner && !devWatching) {
    return (
      <AppShell>
        <div className="flex min-h-full flex-col items-center justify-center gap-4 p-10 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-rose-500/10">
            <Lock className="h-9 w-9 text-rose-300" />
          </div>
          <div className="text-lg font-semibold text-slate-100">Owner device required</div>
          <p className="max-w-sm text-[12px] leading-relaxed text-slate-400">
            The first account that set up this OS is the owner
            {owner.username ? <b className="text-slate-200"> ({owner.username})</b> : null}.
            Only that account&apos;s device can open the Owner Console and push fleet updates.
          </p>
          <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-2 font-mono text-[11px] text-slate-500">
            redsec5.owner.v1 · token: empty
          </div>
        </div>
      </AppShell>
    )
  }

  const sessions = data?.sessions || []
  const users = new Set(sessions.map((s) => s.username)).size

  return (
    <AppShell>
      <div className="flex min-h-full flex-col gap-5 p-5">
        {/* header */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-sky-500/12">
            <ShieldCheck className="h-5.5 w-5.5 text-sky-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-bold text-slate-100">
              Owner Console <span className="text-slate-500">— REDSEC Fleet</span>
              {devWatching && (
                <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                  Developer grant
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500">
              owner <b className="text-slate-400">{data?.owner || owner?.username || username}</b> · every device running REDSEC reports here
              {devWatching ? ' · watching via Developer Options (all actions logged)' : ''}
            </div>
          </div>
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3 py-1.5 text-[10px] font-bold text-sky-300">
            <Globe className="h-3.5 w-3.5" /> build {data?.fleetUpdate?.build || REDSEC.build}
          </span>
        </div>

        <div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
          {/* ---------- left: mobile console QR ---------- */}
          <div className="rounded-2xl border border-white/10 bg-white/4 p-5">
            <div className="flex items-center gap-2 text-[13px] font-bold text-slate-100">
              <QrCode className="h-4 w-4 text-rose-400" /> Mobile console
            </div>
            <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div className="flex-none rounded-2xl bg-white p-2.5 shadow-lg">
                {devWatching ? (
                  <div className="flex h-40 w-40 flex-col items-center justify-center gap-1.5 rounded-lg bg-[#fffbeb] text-center" aria-label="Owner QR hidden while watching via Developer Options">
                    <Lock className="h-7 w-7 text-amber-500" />
                    <div className="px-2 text-[10px] font-bold uppercase tracking-wider text-amber-600">owner link hidden</div>
                    <div className="px-2 text-[9px] leading-snug text-amber-700/80">Developer grant is watching the fleet</div>
                  </div>
                ) : qr ? (
                  <img src={qr} alt="Owner Console QR — opens the mobile fleet console" className="h-40 w-40" />
                ) : (
                  <div className="flex h-40 w-40 items-center justify-center text-[11px] text-slate-400">making QR…</div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">owner only</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    Mobile only — scan with any phone camera. It opens <span className="font-mono text-rose-300">/?owner=…</span> with
                    your secret token. Only you (the owner) can open this.
                    {devWatching && (
                      <>
                        {' '}
                        <span className="text-amber-300">This device watches the fleet via the Developer Options grant — the owner link stays hidden.</span>
                      </>
                    )}
                  </p>
                </div>
                {!devWatching && (
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-black/30 px-2.5 py-1.5 font-mono text-[10px] text-slate-400">
                      {isRealOwner ? ownerUrl(token) : ''}
                    </code>
                    <button type="button" onClick={() => void copyUrl()} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Copy owner link">
                      {copied ? <Check className="h-4 w-4 text-sky-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {!devWatching && (
                <button
                  type="button"
                  onClick={() => window.open(ownerUrl(token), '_blank')}
                  className="flex items-center justify-center gap-2 rounded-xl bg-rose-600 py-3 text-[12px] font-bold text-white shadow-lg shadow-rose-900/30 hover:bg-rose-500"
                >
                  <ExternalLink className="h-4 w-4" /> Open on this device
                </button>
              )}
              <button
                type="button"
                onClick={() => void load()}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/5 py-3 text-[12px] font-semibold text-slate-200 hover:bg-white/10"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh fleet
              </button>
            </div>
          </div>

          {/* ---------- right: live fleet ---------- */}
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/4 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-[13px] font-bold text-slate-100">
                  <MonitorSmartphone className="h-4 w-4 text-sky-300" /> Live fleet
                </div>
                <div className="ml-auto flex flex-wrap gap-2">
                  <span className="flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3 py-1 text-[10px] font-bold text-sky-300">
                    <MonitorSmartphone className="h-3 w-3" /> {data?.total ?? sessions.length} devices
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full bg-violet-500/10 px-3 py-1 text-[10px] font-bold text-violet-300">
                    <Users className="h-3 w-3" /> {users} users
                  </span>
                </div>
              </div>

              <div className="os-scroll mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {loading && sessions.length === 0 && (
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 p-3.5 text-[11px] text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> contacting the fleet…
                  </div>
                )}
                {!loading && sessions.length === 0 && (
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3.5 text-[11px] leading-relaxed text-slate-500">
                    No devices tracked yet. Every device that boots this OS registers itself automatically —
                    open REDSEC on another browser/username and it will appear here.
                  </div>
                )}
                {sessions.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-white/6 text-[11px] font-bold uppercase text-slate-300">
                      {s.username.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-bold text-slate-100">{s.username}</span>
                        <span className="rounded-full bg-sky-500/12 px-2 py-0.5 text-[9px] font-bold text-sky-300">{s.device}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
                        <span className="text-slate-400">{s.browser}</span>
                        <span>· {s.osName}</span>
                        <span>· {s.screen}</span>
                        <span>· seen {relTime(s.lastSeen)}</span>
                        <span>· {s.pings} pings</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ---------- push system update ---------- */}
            <div className="flex-1 rounded-2xl border border-rose-400/20 bg-rose-500/4 p-5">
              <div className="flex items-center gap-2 text-[13px] font-bold text-slate-100">
                <AlertTriangle className="h-4 w-4 text-rose-300" /> Push system update
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Writes the new build record and broadcasts a fleet-wide warning — every running device
                shows a &ldquo;SYSTEM UPDATE&rdquo; toast instantly.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                <input
                  value={build}
                  onChange={(e) => setBuild(e.target.value)}
                  placeholder="build"
                  aria-label="Build number"
                  className="h-10 rounded-xl border border-white/12 bg-black/30 px-3 font-mono text-[12px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-rose-400/50"
                />
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What changed in this build…"
                  aria-label="Update note"
                  rows={2}
                  className="min-h-10 resize-none rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-[12px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-rose-400/50"
                />
              </div>
              <button
                type="button"
                onClick={() => void pushUpdate()}
                disabled={pushing || !build.trim()}
                className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-rose-600 py-3 text-[12px] font-bold text-white shadow-lg shadow-rose-900/30 transition hover:bg-rose-500 disabled:opacity-50"
              >
                {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Push update to all devices
              </button>
              {pushed && (
                <div className="mt-2 rounded-lg border border-sky-400/25 bg-sky-400/8 px-3 py-2 text-[11px] font-semibold text-sky-300">
                  Build {pushed} broadcast — every running device was warned.
                </div>
              )}
              {data?.fleetUpdate && (
                <div className="mt-2 text-[10px] text-slate-500">
                  last fleet record: build {data.fleetUpdate.build} · {new Date(data.fleetUpdate.at).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

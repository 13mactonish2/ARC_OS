// REDSEC 5.0 — Task 16/18: Mobile Link, the PC side of the RedSec Mobile bridge.
// Shows the pairing QR + PIN, watches the comm-service for the RedSec Mobile joining,
// answers sync requests (recent notifications / chat / mail state) and can
// launch the RedSec Mobile virtual machine right inside this window.
'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from './_shared'
import {
  QrCode, Copy, RefreshCw, Smartphone, Check, Play, Square, Send, MonitorSmartphone,
  History, Link2, ShieldCheck,
} from 'lucide-react'
import { useOS } from '@/lib/os/store'
import { fs } from '@/lib/os/fs'
import { makeQr, commSocket } from '@/lib/os/comm'
import {
  ensureInfo, regenToken, markPaired, markSeen, clearPaired, mlPhoneUrl, pinFromToken,
  buildLocalSync, type MLinkInfo, type MLinkSyncPayload,
} from '@/lib/os/mobilelink'
import dynamic from 'next/dynamic'
import { LogoMobileLink } from '../Logos'

const MobileOS = dynamic(() => import('../mobile/MobileOS'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-slate-500">Booting RedSec Mobile VM…</div>,
})

interface MailProbe { signedIn: boolean; address?: string; provider?: string }

function probeMail(): MailProbe {
  try {
    const raw = localStorage.getItem('redsec5.mail.session.v1')
    if (!raw) return { signedIn: false }
    const s = JSON.parse(raw) as { address?: string; provider?: string }
    return { signedIn: true, address: s.address, provider: s.provider }
  } catch {
    return { signedIn: false }
  }
}

function probeChat(): { name: string; rooms: Array<{ code: string; name: string; lastAt: number }> } {
  try {
    const rooms = JSON.parse(localStorage.getItem('redsec5.chat.rooms.v1') || '[]') as Array<{ code: string; name: string; lastAt: number }>
    return { name: localStorage.getItem('redsec5.chat.name.v1') || 'Me', rooms: Array.isArray(rooms) ? rooms.slice(0, 10) : [] }
  } catch {
    return { name: 'Me', rooms: [] }
  }
}

function buildSyncPayload(username: string): MLinkSyncPayload {
  const payload = buildLocalSync()
  // overlay the freshest live values where available
  payload.username = username || payload.username
  payload.at = Date.now()
  try {
    payload.counts.notes = fs.children('documents').filter((n) => (n.meta as { kind?: string } | undefined)?.kind === 'note').length
    payload.counts.photos = fs.children('photos').filter((n) => n.kind === 'file').length
  } catch { /* fs not ready */ }
  payload.mail = probeMail()
  payload.chat = probeChat()
  return payload
}

export default function MobileLinkApp() {
  const username = useOS((s) => s.username)
  const notifications = useOS((s) => s.notifications)
  const [info, setInfo] = useState<MLinkInfo | null>(null)
  const [qr, setQr] = useState('')
  const [vmOn, setVmOn] = useState(false)
  const [copied, setCopied] = useState<'url' | 'pin' | null>(null)
  const [liveRoster, setLiveRoster] = useState<Array<{ id: string; device: string; kind: string }>>([])
  const socketRef = useRef<ReturnType<typeof commSocket> | null>(null)

  /* token + QR */
  useEffect(() => {
    const inf = ensureInfo()
    setInfo(inf)
    void makeQr(mlPhoneUrl(inf.token)).then(setQr)
  }, [])

  const refreshInfo = useCallback(() => setInfo(loadInfoSafe()), [])
  useEffect(() => {
    const t = setInterval(refreshInfo, 4000)
    return () => clearInterval(t)
  }, [refreshInfo])

  /* keep-alive while the VM is running on this page (shared socket can't self-ping) */
  useEffect(() => {
    if (!vmOn) return
    markSeen()
    const t = setInterval(markSeen, 15000)
    return () => clearInterval(t)
  }, [vmOn])

  /* pairing socket */
  useEffect(() => {
    if (!info?.token) return
    const s = commSocket()
    socketRef.current = s
    const token = info.token
    const pin = pinFromToken(token)

    const join = () => {
      s.emit('mlink:join', { token, device: 'REDSEC PC', kind: 'pc' }, (r: { ok?: boolean; roster?: Array<{ id: string; device: string; kind: string }> }) => {
        if (r?.ok && Array.isArray(r.roster)) setLiveRoster(r.roster)
      })
      s.emit('mlink:claim', { pin, device: 'REDSEC PC' })
    }
    join()
    const rejoin = setInterval(() => { if (s.connected) join() }, 15000)

    const onPeer = (data: { device?: string; kind?: string; joined?: boolean }) => {
      if (data?.joined && data.device && (data.kind === 'phone' || data.kind === 'vm')) {
        const next = markPaired(token, data.device, data.kind)
        if (next) setInfo({ ...next })
      }
      setLiveRoster((r) => (data?.joined ? [...r.filter((x) => x.device !== data.device), { id: '', device: data.device || '?', kind: data.kind || 'phone' }] : r.filter((x) => x.device !== data.device)))
    }
    const onHello = (data: { from?: string; device?: string; kind?: string }) => {
      if (data?.device && (data.kind === 'phone' || data.kind === 'vm')) {
        const next = markPaired(token, data.device, data.kind)
        if (next) setInfo({ ...next })
      }
      // answer the hello with a full sync snapshot
      s.emit('mlink:sync', { token, to: data?.from, payload: buildSyncPayload(username) })
    }
    const onSyncReq = (data: { from?: string }) => {
      s.emit('mlink:sync', { token, to: data?.from, payload: buildSyncPayload(username) })
    }
    const onPing = () => {
      markSeen()
      refreshInfo()
    }
    const onClaim = (data: { to?: string; device?: string }) => {
      // a phone typed our PIN — grant it the real token privately
      if (data?.to) s.emit('mlink:grant', { to: data.to, token })
      if (data?.device) {
        const next = markPaired(token, data.device, 'phone')
        if (next) setInfo({ ...next })
      }
    }

    s.on('mlink:peer', onPeer)
    s.on('mlink:hello', onHello)
    s.on('mlink:sync-req', onSyncReq)
    s.on('mlink:ping', onPing)
    s.on('mlink:claim', onClaim)
    return () => {
      clearInterval(rejoin)
      s.off('mlink:peer', onPeer)
      s.off('mlink:hello', onHello)
      s.off('mlink:sync-req', onSyncReq)
      s.off('mlink:ping', onPing)
      s.off('mlink:claim', onClaim)
      s.emit('mlink:leave')
    }
  }, [info?.token, username, refreshInfo])

  /* live-push PC notifications to the phone */
  const lastNotifId = useRef<string | null>(null)
  useEffect(() => {
    if (!info?.token) return
    const latest = notifications[0]
    if (!latest) return
    if (lastNotifId.current === null) {
      lastNotifId.current = latest.id
      return
    }
    if (latest.id !== lastNotifId.current) {
      lastNotifId.current = latest.id
      socketRef.current?.emit('mlink:push', {
        token: info.token,
        event: { title: latest.title, body: latest.body, kind: latest.app === 'chat' ? 'chat' : 'system' },
      })
    }
  }, [notifications, info?.token])

  const phoneUrl = useMemo(() => (info ? mlPhoneUrl(info.token) : ''), [info])
  const pin = info ? pinFromToken(info.token) : ''
  const paired = info?.paired || null
  const seenAgo = paired ? Math.floor((Date.now() - paired.lastSeen) / 1000) : Infinity
  const online = paired && seenAgo < 70

  const copy = async (text: string, which: 'url' | 'pin') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 1400)
    } catch { /* noop */ }
  }

  const doRegen = () => {
    const next = regenToken()
    setInfo(next)
    void makeQr(mlPhoneUrl(next.token)).then(setQr)
    setLiveRoster([])
  }

  const pushTest = () => {
    if (!info) return
    socketRef.current?.emit('mlink:push', { token: info.token, event: { title: 'Hello from your PC', body: `${username} pinged this RedSec Mobile from Mobile Link.`, kind: 'system' } })
  }

  return (
    <AppShell>
      <div className="flex min-h-full flex-col gap-5 p-5">
        {/* header */}
        <div className="flex flex-wrap items-center gap-3">
          <LogoMobileLink size={38} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-bold text-slate-100">Mobile Link</div>
            <div className="text-[11px] text-slate-500">PC ↔ RedSec Mobile · RedSec Mobile OS VM · same apps, same data, mobile UI</div>
          </div>
          <span
            className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold"
            style={{ background: online ? '#0ea5e918' : '#ffffff0d', color: online ? '#0ea5e9' : '#94a3b8' }}
          >
            <Link2 className="h-3.5 w-3.5" />
            {online ? `${paired?.device || 'RedSec Mobile'} · linked` : paired ? `${paired?.device} · last seen ${Math.floor(seenAgo / 60)}m ago` : 'waiting for device…'}
          </span>
        </div>

        {vmOn ? (
          /* ---------- embedded RedSec Mobile VM ---------- */
          <div className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/40">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
              <MonitorSmartphone className="h-4 w-4 text-rose-400" />
              <div className="text-[12px] font-semibold text-slate-200">RedSec Mobile — virtual machine</div>
              <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[9px] font-bold text-rose-300">RedSec OS 5.0</span>
              <button
                type="button"
                onClick={() => setVmOn(false)}
                className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-white/10"
              >
                <Square className="h-3 w-3" /> Stop VM
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <MobileOS pairToken={info?.token} embedded />
            </div>
          </div>
        ) : (
          <div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
            {/* ---------- QR / pairing ---------- */}
            <div className="rounded-2xl border border-white/10 bg-white/4 p-5">
              <div className="flex items-center gap-2 text-[13px] font-bold text-slate-100">
                <QrCode className="h-4 w-4 text-rose-400" /> Pair a phone
              </div>
              <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                <div className="flex-none rounded-2xl bg-white p-2.5 shadow-lg">
                  {qr ? (
                     
                    <img src={qr} alt="Pairing QR — opens the RedSec Mobile OS" className="h-40 w-40" />
                  ) : (
                    <div className="flex h-40 w-40 items-center justify-center text-[11px] text-slate-400">making QR…</div>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">1 · scan</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                      Point any phone camera at the QR — it opens <span className="font-mono text-rose-300">/?mobileos=1</span> and boots the RedSec&nbsp;Mobile VM edge-to-edge on that phone.
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">2 · or type the 6-digit code on the phone</div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="rounded-lg bg-rose-500/15 px-3 py-1.5 font-mono text-lg font-bold tracking-[0.3em] text-rose-300">{pin}</span>
                      <button type="button" onClick={() => void copy(pin, 'pin')} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Copy PIN">
                        {copied === 'pin' ? <Check className="h-4 w-4 text-sky-400" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="mt-1.5 text-[10.5px] leading-relaxed text-slate-500">
                      On the phone: open <span className="font-mono">/?mobileos=1</span> and type this code on the <b className="text-slate-400">entry screen</b> — the whole OS becomes mobile apps on that phone.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-black/30 px-2.5 py-1.5 font-mono text-[10px] text-slate-400">{phoneUrl}</code>
                    <button type="button" onClick={() => void copy(phoneUrl, 'url')} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Copy link">
                      {copied === 'url' ? <Check className="h-4 w-4 text-sky-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                    <button type="button" onClick={doRegen} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-slate-400 hover:bg-white/10" title="Invalidate the old QR and make a new one">
                      <RefreshCw className="h-3.5 w-3.5" /> New code
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => {
                    // same-browser VM: mark paired locally (shared socket can't self-relay)
                    if (info) {
                      const next = markPaired(info.token, 'RedSec Mobile', 'vm')
                      if (next) setInfo({ ...next })
                    }
                    setVmOn(true)
                  }}
                  className="flex items-center justify-center gap-2 rounded-xl bg-rose-600 py-3 text-[12px] font-bold text-white shadow-lg shadow-rose-900/30 hover:bg-rose-500"
                >
                  <Play className="h-4 w-4" /> Launch Mobile VM here
                </button>
                <button
                  type="button"
                  onClick={pushTest}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/5 py-3 text-[12px] font-semibold text-slate-200 hover:bg-white/10"
                >
                  <Send className="h-4 w-4 text-rose-300" /> Ping RedSec Mobile
                </button>
                <a
                  href={phoneUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/5 py-3 text-[12px] font-semibold text-slate-200 hover:bg-white/10"
                >
                  <Smartphone className="h-4 w-4 text-sky-300" /> Open VM in new tab
                </a>
              </div>
            </div>

            {/* ---------- status / what mirrors ---------- */}
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-white/10 bg-white/4 p-5">
                <div className="flex items-center gap-2 text-[13px] font-bold text-slate-100">
                  <ShieldCheck className="h-4 w-4 text-sky-400" /> What the phone mirrors
                </div>
                <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-slate-400">
                  <div className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-violet-400" /><span><b className="text-slate-200">Recent chat</b> — room list + live messages through the same chat server &amp; keys.</span></div>
                  <div className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-amber-400" /><span><b className="text-slate-200">Mail session</b> — the signed-in account mirrors into the phone&apos;s Mail app.</span></div>
                  <div className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-rose-400" /><span><b className="text-slate-200">Live notifications</b> — every PC notification lands in the RedSec Hub instantly.</span></div>
                  <div className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-sky-400" /><span><b className="text-slate-200">All PC apps</b> — native mobile editions + PC Mirror for the rest (Sheet, Word, Paint…).</span></div>
                </div>
              </div>

              <div className="min-h-0 flex-1 rounded-2xl border border-white/10 bg-white/4 p-5">
                <div className="flex items-center gap-2 text-[13px] font-bold text-slate-100">
                  <History className="h-4 w-4 text-sky-300" /> Devices
                </div>
                {paired ? (
                  <div className="mt-3 rounded-xl border border-sky-400/25 bg-sky-400/8 p-3.5">
                    <div className="flex items-center gap-2.5">
                      <Smartphone className="h-5 w-5 text-sky-300" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-bold text-slate-100">{paired.device}</div>
                        <div className="text-[10px] text-slate-400">
                          {paired.kind === 'vm' ? 'virtual machine on this PC' : 'physical phone'} · paired {new Date(paired.pairedAt).toLocaleString()}
                        </div>
                      </div>
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ background: online ? '#0ea5e918' : '#ffffff0d', color: online ? '#0ea5e9' : '#94a3b8' }}>
                        {online ? 'ONLINE' : 'AWAY'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3.5 text-[11px] text-slate-500">
                    No device yet — scan the QR, or launch the VM right here on this PC.
                  </div>
                )}
                {liveRoster.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {liveRoster.map((r, i) => (
                      <span key={`${r.device}_${i}`} className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-semibold text-slate-300">
                        {r.device} · {r.kind}
                      </span>
                    ))}
                  </div>
                )}
                {(info?.history?.length || 0) > 0 && (
                  <div className="mt-3 border-t border-white/8 pt-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Recent links</div>
                    <div className="mt-2 space-y-1">
                      {[...(info?.history || [])].reverse().slice(0, 5).map((h, i) => (
                        <div key={`${h.device}_${h.at}_${i}`} className="flex items-center justify-between text-[10.5px] text-slate-400">
                          <span>{h.device} <span className="text-slate-600">· {h.kind}</span></span>
                          <span className="text-slate-600">{new Date(h.at).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {paired && (
                  <button type="button" onClick={() => { clearPaired(); refreshInfo() }} className="mt-3 text-[10.5px] font-semibold text-rose-300/80 hover:text-rose-300">
                    Unlink device
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function loadInfoSafe(): MLinkInfo | null {
  try {
    return JSON.parse(localStorage.getItem('redsec5.mobilelink.v1') || 'null') as MLinkInfo | null
  } catch {
    return null
  }
}

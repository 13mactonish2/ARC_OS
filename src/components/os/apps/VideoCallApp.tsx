// REDSEC 5.0 — Video Call: PC ↔ mobile over WebRTC (DTLS-SRTP), joined by
// QR code or a crypto-secure 6-digit code. Snapshots land in InterCore.
// Licensed by the Open Suite Infinite 2-year pack (5-min demo otherwise).
'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Copy, Video, VideoOff, Mic, MicOff, Camera, PhoneOff, QrCode, X, ShieldCheck, Loader2, Keyboard, Download, Users, Volume2 } from 'lucide-react'
import { AppShell, Toolbar, TBtn } from './_shared'
import { useOS } from '@/lib/os/store'
import { useCallRoom, useLocalVideo, useRemoteVideo } from '@/lib/os/useCallRoom'
import { callJoinUrl, makeQr, localCode, snapshotVideo, uploadFile, logSecEvent } from '@/lib/os/comm'

export default function VideoCallApp({ winId }: { winId: string; args?: Record<string, unknown> }) {
  const username = useOS((s) => s.username)
  const [room, setRoom] = useState<{ code: string; host: string } | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const start = useCallback(
    async (code: string, host: string) => {
      setBusy(true)
      setErr('')
      try {
        const r = await fetch('/api/call/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, hostName: host }),
        })
        const j = await r.json()
        if (!r.ok || !j.ok) throw new Error(j.message || 'Call service unavailable')
        logSecEvent('call', `Call session ${code} opened for ${host}`)
        setRoom({ code, host })
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not open the call room')
      } finally {
        setBusy(false)
      }
    },
    []
  )

  return (
    <AppShell>
      <Toolbar>
        <Video className="h-4 w-4 text-sky-400" />
        <span className="text-xs font-semibold">Video Call</span>
        <span className="ml-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-400">E2E · DTLS-SRTP</span>
        <span className="ml-auto text-[10px] text-slate-500">PC ↔ Mobile · QR / 6-digit</span>
      </Toolbar>
      {room ? (
        <CallRoom code={room.code} myName={room.host} onLeave={() => setRoom(null)} />
      ) : (
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
          <div className="w-full max-w-3xl">
            <div className="mb-5 text-center">
              <div className="text-lg font-bold text-slate-100">Connect your PC and any phone</div>
              <div className="mt-1 text-xs text-slate-400">Start here, then scan the QR with the other device — or type the 6-digit code. Video &amp; voice flow peer-to-peer, encrypted.</div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {/* host */}
              <div className="rounded-xl border border-sky-400/25 bg-[#161b28] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-sky-300"><Camera className="h-4 w-4" /> Start a call</div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">Creates a locked room. A QR code + 6-digit code appears — the other device joins from its browser, no install needed.</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void start(localCode(), username || 'Host')}
                  className="mt-4 h-10 w-full rounded-lg bg-sky-500 text-xs font-bold text-[#03211d] transition-transform hover:scale-[1.02] disabled:opacity-50"
                >
                  {busy ? 'Opening…' : 'Start call as host'}
                </button>
              </div>
              {/* join */}
              <div className="rounded-xl border border-white/10 bg-[#161b28] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-200"><Keyboard className="h-4 w-4" /> Join a call</div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">Type the 6-digit code shown on the other device.</p>
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  placeholder="000000"
                  aria-label="6-digit call code"
                  className="mt-3 h-11 w-full rounded-lg border border-white/10 bg-black/30 text-center font-mono text-2xl tracking-[0.45em] text-slate-100 outline-none focus:border-sky-400/50"
                />
                <button
                  type="button"
                  disabled={busy || joinCode.length !== 6}
                  onClick={() => void start(joinCode, username || 'Guest')}
                  className="mt-3 h-10 w-full rounded-lg bg-white/10 text-xs font-bold text-slate-100 hover:bg-white/15 disabled:opacity-40"
                >
                  Join room
                </button>
              </div>
            </div>
            {err && <div className="mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-center text-xs text-rose-300">{err}</div>}
            <div className="mt-5 flex items-center justify-center gap-2 text-[10px] text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 text-sky-500" /> Media is encrypted end-to-end (DTLS-SRTP) · codes are crypto-random · snapshots archive to InterCore
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}

/* ------------------------------------------------------------------ */

function CallRoom({ code, myName, onLeave }: { code: string; myName: string; onLeave: () => void }) {
  const { status, error, localStream, mediaNote, peers, micOn, camOn, toggleMic, toggleCam } = useCallRoom(code, myName)
  const [showQr, setShowQr] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [snapBusy, setSnapBusy] = useState(false)
  const [secs, setSecs] = useState(0)
  const localVid = useLocalVideo(localStream)
  const notify = useOS((s) => s.notify)

  useEffect(() => {
    void makeQr(callJoinUrl(code)).then(setQr)
  }, [code])

  useEffect(() => {
    if (status !== 'live') return
    const t = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [status])

  const copy = () => {
    void navigator.clipboard.writeText(code)
    notify({ title: 'Code copied', body: code, kind: 'success', emoji: '📋' })
  }

  const snapshot = useCallback(async () => {
    const v = localVid.current
    if (!v || !localStream) return
    setSnapBusy(true)
    try {
      const blob = await snapshotVideo(v)
      const f = await uploadFile(blob, `call-${code}-${Date.now()}.jpg`, 'call')
      notify({ title: 'Snapshot archived', body: `${f.name} → InterCore (original quality)`, kind: 'success', emoji: '📸' })
      logSecEvent('call', `Snapshot ${f.name} encrypted & archived to InterCore`)
    } catch {
      notify({ title: 'Snapshot failed', body: 'Camera frame could not be captured', kind: 'error', emoji: '📸' })
    } finally {
      setSnapBusy(false)
    }
  }, [code, localStream, notify])

  const hangUp = useCallback(() => {
    void fetch(`/api/call/sessions/${code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended: true, peakPeers: peers.length + 1 }),
    })
    logSecEvent('call', `Left call ${code} — session closed & keys discarded`)
    onLeave()
  }, [code, onLeave, peers.length])

  const clock = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-black">
      {/* video stage */}
      <div className="relative flex-1 overflow-hidden">
        {peers.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            {status === 'connecting' ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
                <div className="text-sm text-slate-300">Securing channel…</div>
              </>
            ) : (
              <>
                <div className="relative">
                  <div className="absolute inset-0 animate-ping rounded-full bg-sky-500/20" />
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-500/15">
                    <Video className="h-7 w-7 text-sky-400" />
                  </div>
                </div>
                <div className="text-sm font-medium text-slate-200">Waiting for the other device…</div>
                <div className="text-xs text-slate-500">Scan the QR on your phone, or open <span className="font-mono text-slate-300">{callJoinUrl(code).replace(/^https?:\/\//, '')}</span> and enter the code</div>
              </>
            )}
          </div>
        ) : (
          <div className={`grid h-full gap-1 p-1 ${peers.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {peers.map((p) => (
              <RemoteTile key={p.id} peer={p} />
            ))}
          </div>
        )}
        {mediaNote !== 'av' && (
          <div className="absolute left-1/2 top-12 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-[10px] text-slate-200">
            {mediaNote === 'audio-only' ? '🎤 Voice-only — camera unavailable on this device' : mediaNote === 'none' ? 'Allow camera & mic to be seen and heard — the call upgrades automatically once granted' : 'Waiting for camera & mic…'}
          </div>
        )}
        {/* local PiP */}
        <div className="absolute bottom-3 right-3 h-28 w-44 overflow-hidden rounded-lg border border-white/15 bg-black shadow-xl sm:h-36 sm:w-56">
          <video ref={localVid} autoPlay playsInline muted className={`h-full w-full object-cover ${camOn ? '' : 'opacity-0'}`} />
          {!camOn && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-400">
              <VideoOff className="h-5 w-5" />
              <span className="text-[10px]">Camera off</span>
            </div>
          )}
          <span className="absolute bottom-1 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-slate-200">{myName} (you)</span>
        </div>
        {/* status pills */}
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 font-mono text-[11px] tracking-widest text-sky-300">
            <ShieldCheck className="h-3 w-3" /> {code}
          </span>
          {status === 'live' && <span className="rounded-full bg-black/60 px-2.5 py-1 font-mono text-[11px] text-slate-200">{clock}</span>}
          {peers.length >= 2 && (
            <span className="flex items-center gap-1 rounded-full bg-sky-500/20 px-2.5 py-1 text-[11px] font-semibold text-sky-300">
              <Users className="h-3 w-3" /> Group · {peers.length + 1} connected
            </span>
          )}
        </div>
        <button type="button" onClick={copy} title="Copy code" className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-slate-200 hover:bg-black/80">
          <Copy className="h-3.5 w-3.5" />
        </button>
        {showQr && qr && <QrPanel url={callJoinUrl(code)} qr={qr} code={code} onClose={() => setShowQr(false)} />}
      </div>

      {/* controls */}
      <div className="flex flex-none items-center justify-center gap-3 border-t border-white/10 bg-[#0c101c] py-3">
        <CtrlBtn on={micOn} onClick={toggleMic} label={micOn ? 'Mute' : 'Unmute'}>
          {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </CtrlBtn>
        <CtrlBtn on={camOn} onClick={toggleCam} label={camOn ? 'Camera off' : 'Camera on'}>
          {camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </CtrlBtn>
        <button
          type="button"
          onClick={() => void snapshot()}
          disabled={snapBusy || !localStream}
          title="Take snapshot → InterCore"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-slate-100 hover:bg-white/20 disabled:opacity-40"
        >
          {snapBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={() => setShowQr((v) => !v)}
          title="Show QR / invite"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-slate-100 hover:bg-white/20"
        >
          <QrCode className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={hangUp}
          title="Hang up"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg shadow-rose-900/40 hover:bg-rose-500"
        >
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>
      {error && (
        <div className="absolute inset-x-0 top-12 mx-auto w-fit rounded-lg border border-rose-400/40 bg-rose-950/80 px-4 py-2 text-xs text-rose-200">{error}</div>
      )}
    </div>
  )
}

function RemoteTile({ peer }: { peer: { id: string; name: string; stream: MediaStream | null; camOn: boolean; micOn: boolean; videoStalled?: boolean } }) {
  const ref = useRemoteVideo(peer.stream)
  const hue = (() => { let h = 0; for (let i = 0; i < peer.name.length; i++) h = (h * 31 + peer.name.charCodeAt(i)) % 360; return h })()
  return (
    <div className="relative overflow-hidden rounded-lg bg-[#0b0f19]">
      <video ref={ref} autoPlay playsInline className="h-full w-full object-cover" />
      {!peer.camOn && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span
            className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold text-white"
            style={{ backgroundColor: `hsl(${hue} 40% 30%)` }}
          >
            {peer.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <VideoOff className="h-3.5 w-3.5" /> {peer.micOn ? 'voice only' : 'camera & mic off'}
          </span>
        </div>
      )}
      {peer.camOn && peer.videoStalled && (
        <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-1 bg-amber-950/70 px-2 py-1 text-[9px] text-amber-200">
          <Volume2 className="h-3 w-3" /> pixel pipe stalled — voice keeps flowing
        </div>
      )}
      <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-slate-100">
        {!peer.micOn && <MicOff className="h-3 w-3 text-rose-400" />} {peer.name}
      </span>
    </div>
  )
}

function CtrlBtn({ children, on, onClick, label }: { children: React.ReactNode; on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${on ? 'bg-white/10 text-slate-100 hover:bg-white/20' : 'bg-rose-600/90 text-white hover:bg-rose-500'}`}
    >
      {children}
    </button>
  )
}

function QrPanel({ url, qr, code, onClose }: { url: string; qr: string; code: string; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-label="Invite QR code">
      <div className="relative w-full max-w-xs rounded-xl bg-[#141926] p-5 text-center shadow-2xl">
        <button type="button" onClick={onClose} className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:text-white" aria-label="Close QR">
          <X className="h-4 w-4" />
        </button>
        <div className="text-sm font-semibold text-slate-100">Join from phone</div>
        <div className="mt-1 text-[11px] text-slate-400">Scan with any camera app — it opens the guest call page.</div>
        <img src={qr} alt={`QR code joining call ${code}`} className="mx-auto mt-3 h-52 w-52 rounded-lg bg-white p-1.5" />
        <div className="mt-3 font-mono text-2xl tracking-[0.4em] text-sky-300">{code}</div>
        <div className="mt-1 break-all text-[10px] text-slate-500">{url}</div>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(url)}
          className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-white/5 text-[11px] text-slate-200 hover:bg-white/10"
        >
          <Download className="h-3.5 w-3.5" /> Copy invite link
        </button>
      </div>
    </div>
  )
}

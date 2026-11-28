// REDSEC v7.0 "Black Sea" — the two full-screen security gates.
//
//  BanScreen   — a FOREVER-banned device lands here. The registry is checked
//                server-side on every boot and every 20 s while running, so a
//                ban follows the DEVICE across browsers and sessions. No UI can
//                bypass it; only the owner recovery channel (OS password) can
//                clear it, and every wrong attempt is logged server-side.
//  CompatGate  — the browser compatibility gate. The first browser that ever
//                completed OS setup is the trusted one; any other brand
//                (Firefox, Safari, Edge, another Chrome profile brand…) is told
//                the device is not compatible. Developer Options / the owner
//                can authorize the current browser with the OS password.
'use client'

import { useState } from 'react'
import { AlertTriangle, Fingerprint, Globe, Lock, RefreshCcw, ShieldAlert, ShieldX } from 'lucide-react'
import { revokeBan, trustCurrentBrowser, type BanInfo } from '@/lib/os/security/blacksea'

const REASONS: Record<string, string> = {
  os_password_breach: 'OS password breach — repeated failed attempts on protected system files',
  os_file_tamper: 'OS file tampering — a protected system file was modified without authorization',
  kernel_breach: 'Kernel breach — the security kernel detected an unauthorized intrusion',
  manual: 'Manual ban issued by the security kernel',
}

function GateShell({ children, tone }: { children: React.ReactNode; tone: 'ban' | 'compat' }) {
  const ban = tone === 'ban'
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={ban ? 'Device banned' : 'Device not compatible'}
      className={`fixed inset-0 z-[20000] flex flex-col items-center justify-center overflow-y-auto p-6 ${ban ? 'bg-[#160404]' : 'bg-[#040a16]'}`}
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 opacity-[0.14] ${ban ? 'bg-[radial-gradient(circle_at_50%_0%,#ff2d2d_0%,transparent_60%)]' : 'bg-[radial-gradient(circle_at_50%_0%,#2d7dff_0%,transparent_60%)]'}`}
      />
      <div className="relative w-full max-w-lg">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* BAN — forever                                                       */
/* ------------------------------------------------------------------ */

export function BanScreen({ ban, deviceId }: { ban: BanInfo; deviceId: string }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [recovered, setRecovered] = useState(false)

  const recover = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setErr('')
    const r = await revokeBan(pw)
    setBusy(false)
    if (r.ok) setRecovered(true)
    else setErr(r.error || 'recovery failed')
  }

  return (
    <GateShell tone="ban">
      <div className="rounded-2xl border border-red-500/40 bg-[#1d0808]/90 p-6 shadow-[0_0_80px_rgba(255,0,0,0.25)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <ShieldX className="h-10 w-10 flex-none text-red-500" aria-hidden="true" />
          <div>
            <div className="text-lg font-black uppercase tracking-widest text-red-400">REDSEC Black Sea</div>
            <div className="text-2xl font-black tracking-tight text-red-300">DEVICE BANNED FOREVER</div>
          </div>
        </div>

        <div className="mt-4 space-y-1.5 rounded-xl border border-red-500/25 bg-black/40 p-4 font-mono text-[12px] text-red-200/90">
          <div>
            <span className="text-red-400/70">ban id&nbsp;&nbsp;&nbsp;:</span> {ban.banId}
          </div>
          <div>
            <span className="text-red-400/70">device&nbsp;&nbsp;&nbsp;:</span> {deviceId}
          </div>
          <div>
            <span className="text-red-400/70">reason&nbsp;&nbsp;&nbsp;:</span> {REASONS[ban.reason] || ban.reason}
          </div>
          {ban.detail && (
            <div className="break-words">
              <span className="text-red-400/70">evidence&nbsp;:</span> {ban.detail}
            </div>
          )}
          <div>
            <span className="text-red-400/70">issued&nbsp;&nbsp;&nbsp;:</span> {new Date(ban.bannedAt).toLocaleString()}
          </div>
          <div>
            <span className="text-red-400/70">return&nbsp;&nbsp;&nbsp;:</span> boot attempt #{ban.attempts} — blocked in realtime
          </div>
        </div>

        <p className="mt-4 text-[12.5px] leading-relaxed text-red-100/80">
          This device triggered the Black Sea anti-tamper kernel. The ban is permanent, device-wide and enforced in
          realtime in every browser. No reinstall, cache clear or new session can lift it.
        </p>

        {recovered ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-[12px] text-emerald-200">
            <ShieldAlert className="h-4 w-4 flex-none" aria-hidden="true" />
            Ban revoked via owner recovery. Reload the page to boot the OS again.
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowRecovery((v) => !v)}
              className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-red-300/70 transition-colors hover:text-red-200"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Owner recovery channel
            </button>
            {showRecovery && (
              <div className="mt-3 rounded-xl border border-red-500/25 bg-black/40 p-3">
                <label htmlFor="bs-recover-pw" className="text-[10.5px] font-bold uppercase tracking-wider text-red-300/70">
                  OS password
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="bs-recover-pw"
                    type="password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void recover()}
                    className="h-9 flex-1 rounded-lg border border-red-500/30 bg-black/50 px-3 font-mono text-[12px] text-red-100 outline-none focus:border-red-400/60"
                    placeholder="owner passphrase"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => void recover()}
                    disabled={busy}
                    className="h-9 rounded-lg bg-red-600 px-4 text-[11px] font-bold text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {busy ? 'Verifying…' : 'Revoke ban'}
                  </button>
                </div>
                {err && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {err}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="mt-4 text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-red-500/40">
        REDSEC v7.0 · Black Sea kernel · anti-tamper extreme
      </div>
    </GateShell>
  )
}

/* ------------------------------------------------------------------ */
/* COMPATIBILITY GATE                                                  */
/* ------------------------------------------------------------------ */

export function CompatGate({
  browser,
  trusted,
  deviceId,
  onRetry,
}: {
  browser: string
  trusted: string[]
  deviceId: string
  onRetry: () => void
}) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [showTrust, setShowTrust] = useState(false)

  const trust = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setErr('')
    const r = await trustCurrentBrowser(pw)
    setBusy(false)
    if (r.ok) onRetry()
    else setErr(r.error || 'authorization failed')
  }

  return (
    <GateShell tone="compat">
      <div className="rounded-2xl border border-sky-500/30 bg-[#061120]/90 p-6 shadow-[0_0_80px_rgba(0,80,255,0.18)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <Globe className="h-10 w-10 flex-none text-sky-400" aria-hidden="true" />
          <div>
            <div className="text-lg font-black uppercase tracking-widest text-sky-300">REDSEC Black Sea</div>
            <div className="text-2xl font-black tracking-tight text-sky-100">DEVICE NOT COMPATIBLE</div>
          </div>
        </div>

        <p className="mt-4 text-[12.5px] leading-relaxed text-slate-300">
          This operating system is bound to its trusted browser. <b className="text-sky-300">{browser}</b> is not
          authorized to run REDSEC v7.0 “Black Sea” on this device.
        </p>

        <div className="mt-4 space-y-1.5 rounded-xl border border-sky-500/20 bg-black/40 p-4 font-mono text-[12px] text-sky-100/90">
          <div className="flex items-center gap-2">
            <ShieldX className="h-3.5 w-3.5 flex-none text-rose-400" aria-hidden="true" />
            detected&nbsp;&nbsp;: {browser} — blocked by the browser guard
          </div>
          <div className="flex items-center gap-2">
            <Fingerprint className="h-3.5 w-3.5 flex-none text-sky-400" aria-hidden="true" />
            device&nbsp;&nbsp;&nbsp;: {deviceId}
          </div>
          <div className="flex items-start gap-2">
            <Lock className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-400" aria-hidden="true" />
            <span className="min-w-0 break-words">trusted&nbsp;: {trusted.length ? trusted.join(' · ') : 'none'}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowTrust((v) => !v)}
          className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-sky-300/70 transition-colors hover:text-sky-200"
        >
          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Authorize this browser (owner)
        </button>
        {showTrust && (
          <div className="mt-3 rounded-xl border border-sky-500/25 bg-black/40 p-3">
            <label htmlFor="bs-trust-pw" className="text-[10.5px] font-bold uppercase tracking-wider text-sky-300/70">
              OS password
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="bs-trust-pw"
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void trust()}
                className="h-9 flex-1 rounded-lg border border-sky-500/30 bg-black/50 px-3 font-mono text-[12px] text-sky-100 outline-none focus:border-sky-400/60"
                placeholder="owner passphrase"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => void trust()}
                disabled={busy}
                className="h-9 rounded-lg bg-sky-600 px-4 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {busy ? 'Verifying…' : 'Authorize'}
              </button>
            </div>
            {err && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {err}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-200"
        >
          <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry handshake
        </button>
      </div>
      <div className="mt-4 text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-sky-500/40">
        REDSEC v7.0 · Black Sea kernel · browser guard
      </div>
    </GateShell>
  )
}

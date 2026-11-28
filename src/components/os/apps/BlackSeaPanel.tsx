// REDSEC v7.0 "Black Sea" — Security Center panel (Settings ▸ Security).
// Live view of the ban registry + browser guard: device fingerprint, trusted
// browsers, permanent bans and the realtime incident feed.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Fingerprint, Globe, Gavel, RefreshCcw, ShieldCheck, ScrollText, Loader2 } from 'lucide-react'
import { useOS } from '@/lib/os/store'
import {
  browserBrand,
  deviceId,
  pollStatus,
  type BanInfo,
  type IncidentRow,
} from '@/lib/os/security/blacksea'

const KIND_LABEL: Record<string, string> = {
  handshake: 'boot handshake',
  banned_boot: 'banned boot blocked',
  os_password_breach: 'OS password breach',
  os_file_tamper: 'OS file tamper',
  kernel_breach: 'kernel breach',
  tamper_warning: 'tamper warning',
  device_banned: 'device banned',
  unlock: 'unlock / trust change',
  trust_denied: 'trust denied',
  revoke_denied: 'revoke denied',
}

export function BlackSeaPanel() {
  const securityExtreme = useOS((s) => s.securityExtreme)
  const browserGuard = useOS((s) => s.browserGuard)
  const setS = useOS((s) => s.set)
  const [did, setDid] = useState('')
  const [brand, setBrand] = useState('')
  const [trusted, setTrusted] = useState<string[]>([])
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [bans, setBans] = useState<BanInfo | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setDid(deviceId())
    setBrand(browserBrand())
    const st = await pollStatus()
    setBans(st.banned && st.ban ? st.ban : null)
    setIncidents(st.incidents)
    try {
      const res = await fetch('/api/os/security/handshake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId(), browser: browserBrand(), ua: navigator.userAgent, screen: `${screen.width}x${screen.height}`, osName: navigator.platform || '' }),
      })
      const d = (await res.json()) as { trusted?: string[]; banned?: BanInfo | null }
      setTrusted(Array.isArray(d.trusted) ? d.trusted : [])
    } catch {
      /* feed shows what we have */
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    /* deferred — the refresh is async (server round-trips), never a sync setState */
    const t = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(t)
  }, [refresh])

  return (
    <div className="rounded-xl border border-sky-500/25 bg-gradient-to-r from-[#04101f] via-[#161b28] to-[#161b28] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-500/40 bg-sky-500/10">
          <ShieldCheck className="h-5 w-5 text-sky-300" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-100">Black Sea Shield — v7.0 enforcement</div>
          <div className="text-[11px] text-slate-400">
            Extreme anti-tamper + browser guard · realtime ban registry · device-wide, forever
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-slate-200 hover:bg-white/10"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />} Refresh
        </button>
      </div>

      {/* device fingerprint */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <Fingerprint className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" /> device fingerprint
          </div>
          <div className="mt-1 break-all font-mono text-[11px] text-sky-100">{did || '…'}</div>
          <div className="mt-0.5 text-[10px] text-slate-500">browser: {brand || '…'}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <Globe className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" /> trusted browsers (compatibility gate)
          </div>
          <div className="mt-1 break-words font-mono text-[11px] text-emerald-200">{trusted.length ? trusted.join(' · ') : '…'}</div>
          <div className="mt-0.5 text-[10px] text-slate-500">other browser brands get the DEVICE NOT COMPATIBLE screen</div>
        </div>
      </div>

      {/* toggles */}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 p-3">
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-slate-100">Extreme anti-tamper</span>
            <span className="block text-[10px] text-slate-500">OS-file tampering & password breaches = PERMANENT ban</span>
          </span>
          <input
            type="checkbox"
            checked={securityExtreme}
            onChange={(e) => {
              setS({ securityExtreme: e.target.checked })
              useOS.getState().notify({ title: e.target.checked ? 'Extreme anti-tamper ON' : 'Extreme anti-tamper OFF', body: e.target.checked ? 'Breaches now ban the device forever' : 'Breaches are blocked and logged only', kind: 'success', emoji: '🛡️' })
            }}
            className="h-4 w-4 accent-rose-500"
          />
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 p-3">
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-slate-100">Browser guard</span>
            <span className="block text-[10px] text-slate-500">only trusted browser brands can boot this OS</span>
          </span>
          <input
            type="checkbox"
            checked={browserGuard}
            onChange={(e) => {
              setS({ browserGuard: e.target.checked })
              useOS.getState().notify({ title: e.target.checked ? 'Browser guard ON' : 'Browser guard OFF', body: e.target.checked ? 'Untrusted browsers are blocked at boot' : 'Any browser may boot this OS', kind: 'success', emoji: '🌐' })
            }}
            className="h-4 w-4 accent-sky-500"
          />
        </label>
      </div>

      {/* ban status */}
      {bans && (
        <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
            <Gavel className="h-4 w-4" aria-hidden="true" /> THIS DEVICE IS BANNED FOREVER — {bans.banId}
          </div>
          <div className="mt-1 text-[11px] text-rose-200/80">
            {bans.reason} · issued {new Date(bans.bannedAt).toLocaleString()} · boot attempts seen: {bans.attempts}
          </div>
        </div>
      )}

      {/* incident feed */}
      <div className="mt-2 rounded-lg border border-white/10 bg-black/30">
        <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <ScrollText className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" /> security incident feed (realtime, server-side)
        </div>
        <div className="max-h-44 overflow-y-auto p-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar]:w-2">
          {incidents.length === 0 && <div className="px-1 py-2 text-[11px] text-slate-600">{loading ? 'Loading…' : 'No incidents recorded for this device.'}</div>}
          {incidents.map((i) => (
            <div key={i.id} className="flex items-start gap-2 px-1 py-1 font-mono text-[10.5px] leading-4">
              <span className="flex-none text-slate-600">{new Date(i.at).toLocaleTimeString()}</span>
              <span className={`flex-none font-semibold ${i.kind.includes('breach') || i.kind.includes('ban') ? 'text-rose-300' : 'text-sky-300'}`}>{KIND_LABEL[i.kind] || i.kind}</span>
              <span className="min-w-0 break-words text-slate-400">{i.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

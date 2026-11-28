// REDSEC 5.0 — Owner Console FINAL-PASSWORD vault gate.
//
// The fleet-command cockpit now lives inside VELIKAN (owner section)
// and on the phone (mobile /?owner=<token> page) — both locked behind ONE
// final password that only the owner knows. The password is verified
// SERVER-SIDE (/api/owner/vault) so it never appears in the client bundle —
// even with DevTools there is nothing to find. A successful unlock is
// remembered in sessionStorage, so every new browser session re-locks the
// vault (close the tab → locked again).
//
// EXPORTS:
//   export function OwnerVaultGate({ children, fullscreen }) — renders
//   `children` once the final password is accepted; a vault lock screen until
//   then. fullscreen=true for standalone pages (mobile console), default
//   fills its container (Velikan owner section).
//   export function vaultUnlocked() — true when this session already unlocked.
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { logSecEvent } from '@/lib/os/comm'
import { useOS } from '@/lib/os/store'

const VAULT_KEY = 'redsec5.owner.vault.ok'

export function vaultUnlocked(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem(VAULT_KEY) === '1'
  } catch {
    return false
  }
}

export function OwnerVaultGate({ children, fullscreen = false }: { children: React.ReactNode; fullscreen?: boolean }) {
  /* Task 55 — Developer Options unlock the Owner Console: while the QR +
     6-digit handshake is ON, the final password is bypassed and the bypass
     itself is recorded in the security event log. */
  const devMode = useOS((s) => s.devMode)
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking')

  useEffect(() => {
    Promise.resolve().then(() => {
      if (devMode) {
        if (!vaultUnlocked()) {
          logSecEvent('owner', 'Owner Console unlocked via Developer Options — final password bypassed', 'warn')
        }
        setState('open')
        return
      }
      setState(vaultUnlocked() ? 'open' : 'locked')
    })
  }, [devMode])

  if (state === 'checking') {
    return (
      <div className={`flex w-full items-center justify-center p-6 ${fullscreen ? 'min-h-dvh bg-[#050608]' : 'min-h-full bg-[#0b0e15]'}`}>
        <Loader2 className="h-6 w-6 animate-spin text-rose-400" aria-label="Checking vault" />
      </div>
    )
  }
  if (state === 'open') return <>{children}</>
  return <VaultLock fullscreen={fullscreen} onOpen={() => setState('open')} />
}

function VaultLock({ fullscreen, onOpen }: { fullscreen: boolean; onOpen: () => void }) {
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const fail = (msg: string) => {
    setErr(msg)
    setShake((n) => n + 1)
    setPw('')
    inputRef.current?.focus()
  }

  const unlock = async () => {
    if (busy || !pw.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch('/api/owner/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      if (r.status === 429) {
        const j = (await r.json().catch(() => ({}))) as { retryAfter?: number }
        fail(`Too many attempts — vault locked for ${Math.max(1, Math.ceil(j.retryAfter || 30))}s`)
        return
      }
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean }
      if (r.ok && j.ok) {
        try {
          sessionStorage.setItem(VAULT_KEY, '1')
        } catch {
          /* private mode — stays unlocked for this render only */
        }
        logSecEvent('owner', 'Owner Console unlocked with the final password', 'warn')
        onOpen()
        return
      }
      fail('ACCESS DENIED — invalid final password')
    } catch {
      fail('Vault unreachable — check the connection and retry')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`flex w-full items-center justify-center p-5 ${fullscreen ? 'min-h-dvh bg-[#050608]' : 'min-h-full bg-[#0b0e15]'}`}>
      <style>{`@keyframes vaultShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(4px)}}`}</style>
      <div className="w-full max-w-sm">
        <div key={shake} className={shake ? 'animate-[vaultShake_0.4s_ease]' : ''}>
          <div className="rounded-3xl border border-rose-400/25 bg-[#10131c] p-6 shadow-2xl shadow-black/60">
            {/* badge */}
            <div className="flex flex-col items-center text-center">
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/12">
                <span className="absolute inset-0 animate-ping rounded-2xl bg-rose-500/10" aria-hidden="true" />
                <Lock className="h-7 w-7 text-rose-300" aria-hidden="true" />
              </div>
              <div className="mt-3 flex items-center gap-2 text-base font-bold tracking-wide text-slate-100">
                OWNER CONSOLE
              </div>
              <span className="mt-1.5 rounded-full bg-rose-500/12 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-rose-300">
                restricted · final password required
              </span>
              <p className="mt-3 text-[11.5px] leading-relaxed text-slate-400">
                This console answers to a single final password, known only by the owner.
                The password is verified on the server — it exists nowhere on this device.
              </p>
            </div>

            {/* form */}
            <form
              className="mt-5 space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                void unlock()
              }}
            >
              <div className="relative">
                <input
                  ref={inputRef}
                  type={show ? 'text' : 'password'}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="Final password"
                  aria-label="Owner Console final password"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="h-11 w-full rounded-xl border border-white/12 bg-black/35 pl-10 pr-11 font-mono text-[13px] text-slate-100 outline-none transition placeholder:font-sans placeholder:text-slate-600 focus:border-rose-400/60 focus:bg-black/45"
                />
                <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-white/8 hover:text-slate-300"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <button
                type="submit"
                disabled={busy || !pw.trim()}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-rose-600 text-[12.5px] font-bold text-white shadow-lg shadow-rose-900/30 transition hover:bg-rose-500 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {busy ? 'Verifying…' : 'Unlock Owner Console'}
              </button>
            </form>

            {err && (
              <div role="alert" className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-center text-[11.5px] font-semibold text-rose-300">
                {err}
              </div>
            )}

            <div className="mt-5 border-t border-white/8 pt-3 text-center">
              <div className="font-mono text-[9.5px] uppercase tracking-wider text-slate-600">
                redsec5.owner.vault · server-verified · session-locked
              </div>
              <div className="mt-1 text-[10px] text-slate-600">
                🛡️ Right-click &amp; DevTools are disabled on REDSEC devices
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

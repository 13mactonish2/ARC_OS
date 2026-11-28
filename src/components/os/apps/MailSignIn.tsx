// REDSEC 5.0 — Mail Sign-In: the SEPARATED sign-in experience.
// A full-stage, standalone flow (brand panel → provider pick → credentials →
// secure provisioning) that lives entirely outside the mailbox UI. The
// mailbox never renders until a session is granted here.
'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  Fingerprint,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  X,
} from 'lucide-react'
import { logSecEvent } from '@/lib/os/comm'

/* ---------------- types + session vault (shared with the mailbox) ---------------- */

export type Provider = 'google' | 'apple' | 'microsoft' | 'yahoo'

export interface MailSession {
  accountId: string
  provider: Provider
  address: string
  displayName: string
  token: string
  keyId: string
}

export const SESSION_KEY = 'redsec5.mail.session.v1'

export function loadSession(): MailSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<MailSession> | null
    if (
      !s ||
      typeof s.accountId !== 'string' ||
      typeof s.token !== 'string' ||
      typeof s.address !== 'string' ||
      typeof s.displayName !== 'string' ||
      typeof s.keyId !== 'string' ||
      (s.provider !== 'google' && s.provider !== 'apple' && s.provider !== 'microsoft' && s.provider !== 'yahoo')
    ) {
      return null
    }
    return { accountId: s.accountId, provider: s.provider, address: s.address, displayName: s.displayName, token: s.token, keyId: s.keyId }
  } catch {
    return null
  }
}

export function saveSession(s: MailSession): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  } catch {
    /* storage blocked — session just won't survive reboot */
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

/** keyId → "A1B2-C3D4" style fingerprint */
export function fmtKeyFp(keyId: string): string {
  const clean = keyId.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8)
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean || '----'
}

export interface LoginRes {
  ok: boolean
  message?: string
  account?: { id: string; address: string; displayName: string }
  token?: string
  keyId?: string
}

/* ---------------- provider brand logos (inline SVG) ---------------- */

export function GoogleLogo({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

export function AppleLogo({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M16.365 12.79c-.025-2.532 2.066-3.745 2.16-3.803-1.177-1.72-3.007-1.956-3.658-1.983-1.556-.157-3.038.916-3.827.916-.788 0-2.008-.894-3.3-.868-1.7.024-3.268.988-4.14 2.51-1.767 3.063-.451 7.6 1.27 10.088.843 1.218 1.848 2.584 3.163 2.535 1.268-.05 1.746-.82 3.278-.82 1.532 0 1.962.82 3.302.794 1.365-.024 2.23-1.242 3.066-2.465.962-1.407 1.358-2.77 1.382-2.84-.03-.014-2.652-1.018-2.678-4.064z" />
      <path d="M13.838 4.856c.7-.848 1.172-2.025 1.043-3.2-1.007.041-2.227.672-2.95 1.518-.648.75-1.215 1.95-1.062 3.101 1.123.087 2.27-.569 2.969-1.419z" />
    </svg>
  )
}

export function MicrosoftLogo({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 23 23" className={className} aria-hidden="true">
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  )
}

export function YahooLogo({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="10.6" y="1.6" width="3.6" height="12.6" rx="1.8" fill="#6001D2" transform="rotate(9 12.4 8)" />
      <circle cx="12" cy="19.2" r="2.2" fill="#6001D2" />
    </svg>
  )
}

export interface ProviderMeta {
  id: Provider
  name: string
  tagline: string
  placeholder: string
  tint: string
  Logo: (props: { className?: string }) => React.JSX.Element
}

export const PROVIDERS: ProviderMeta[] = [
  { id: 'google', name: 'Google', tagline: 'Gmail & Google Workspace', placeholder: 'you@gmail.com', tint: '#ea4335', Logo: GoogleLogo },
  { id: 'apple', name: 'Apple', tagline: 'iCloud Mail', placeholder: 'you@icloud.com', tint: '#e5e7eb', Logo: AppleLogo },
  { id: 'microsoft', name: 'Microsoft', tagline: 'Outlook & Microsoft 365', placeholder: 'you@outlook.com', tint: '#00a4ef', Logo: MicrosoftLogo },
  { id: 'yahoo', name: 'Yahoo', tagline: 'Yahoo Mail', placeholder: 'you@yahoo.com', tint: '#6001d2', Logo: YahooLogo },
]

export function providerMeta(id: Provider): ProviderMeta {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/* ---------------- the separated sign-in stage ---------------- */

type Stage = 'providers' | 'form' | 'signing' | 'granted'

export function MailSignIn({ onDone }: { onDone: (s: MailSession) => void }) {
  const [stage, setStage] = useState<Stage>('providers')
  const [picked, setPicked] = useState<ProviderMeta | null>(null)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [err, setErr] = useState('')
  const [step, setStep] = useState(0)
  const cancelledRef = useRef(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const steps = useMemo(
    () => ['Opening secure channel…', `Verifying with ${picked?.name ?? 'provider'}…`, 'Provisioning encrypted mailbox…'],
    [picked],
  )

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      cancelledRef.current = true
      timers.forEach((t) => clearTimeout(t))
    }
  }, [])

  const submit = async () => {
    if (stage !== 'form' || !picked) return
    const addr = email.trim().toLowerCase()
    if (!EMAIL_RE.test(addr)) {
      setErr('Enter a valid email address.')
      return
    }
    setErr('')
    setStage('signing')
    setStep(0)
    timersRef.current.push(setTimeout(() => setStep(1), 500))
    timersRef.current.push(setTimeout(() => setStep(2), 1150))
    try {
      const started = Date.now()
      const res = await fetch('/api/mail/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: picked.id, email: addr, displayName: displayName.trim() }),
      })
      const data = (await res.json()) as LoginRes
      const minAnim = 1500 - (Date.now() - started)
      if (minAnim > 0) await new Promise<void>((resolve) => setTimeout(resolve, minAnim))
      if (cancelledRef.current) return
      if (!data.ok || !data.account || !data.token || !data.keyId) {
        setStage('form')
        setErr(data.message || 'Sign-in failed — check the address and try again.')
        logSecEvent('mail', `sign-in rejected for ${addr} (${picked.id})`, 'warn')
        return
      }
      setStep(3)
      const s: MailSession = {
        accountId: data.account.id,
        provider: picked.id,
        address: data.account.address,
        displayName: data.account.displayName,
        token: data.token,
        keyId: data.keyId,
      }
      saveSession(s)
      setStage('granted')
      timersRef.current.push(
        setTimeout(() => {
          if (!cancelledRef.current) onDone(s)
        }, 700),
      )
    } catch {
      if (!cancelledRef.current) {
        setStage('form')
        setErr('Network error — the mail cloud is unreachable.')
      }
    }
  }

  const meta = picked

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[#0c101b]">
      {/* ---------- left brand panel ---------- */}
      <aside className="hidden w-72 flex-none flex-col justify-between border-r border-white/8 bg-gradient-to-b from-amber-500/[0.07] to-transparent p-5 lg:flex">
        <div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-400/25 bg-amber-500/10 shadow-lg shadow-amber-950/30">
            <Mail className="h-6 w-6 text-amber-400" />
          </div>
          <h2 className="mt-3 text-lg font-bold tracking-tight text-slate-50">REDSEC Mail</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            Private mailbox by Security Core. The sign-in lives in its own secure stage — your mailbox opens only after access is granted.
          </p>
          <ul className="mt-5 space-y-2.5">
            {[
              { icon: <Lock className="h-3.5 w-3.5 text-sky-300" />, text: 'AES-256 encrypted at rest' },
              { icon: <ShieldCheck className="h-3.5 w-3.5 text-sky-300" />, text: 'TLS 1.3 in transit' },
              { icon: <Fingerprint className="h-3.5 w-3.5 text-sky-300" />, text: 'Device-grant key, auto-expiring' },
            ].map((b) => (
              <li key={b.text} className="flex items-center gap-2 text-[11px] text-slate-300">
                {b.icon}
                {b.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-white/8 bg-white/[0.03] p-2.5 text-[10px] leading-relaxed text-slate-500">
          Your provider password never touches this OS — REDSEC receives a restricted token only.
        </div>
      </aside>

      {/* ---------- right flow ---------- */}
      <section className="os-scroll flex min-w-0 flex-1 items-center justify-center overflow-y-auto p-4">
        <div className="w-full max-w-sm">
          {/* stage header */}
          <div className="mb-4 flex items-center gap-2">
            {stage !== 'providers' && stage !== 'granted' && (
              <button
                type="button"
                onClick={() => {
                  setStage('providers')
                  setPicked(null)
                  setErr('')
                }}
                aria-label="Back to provider choice"
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-100"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-100">
                {stage === 'providers' && 'Choose your mail provider'}
                {stage === 'form' && `Sign in — ${meta?.name ?? ''}`}
                {stage === 'signing' && 'Securing your session…'}
                {stage === 'granted' && 'Access granted'}
              </div>
              <div className="truncate text-[10px] text-slate-500">REDSEC Mail · separated sign-in stage</div>
            </div>
            <span className="flex-none rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[9.5px] font-semibold text-amber-300">
              STEP {stage === 'providers' ? '1' : stage === 'form' ? '2' : '3'}/3
            </span>
          </div>

          {/* providers */}
          {stage === 'providers' && (
            <div className="rounded-xl border border-white/10 bg-[#151a29] p-3 shadow-2xl">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPicked(p)
                    setStage('form')
                    setErr('')
                  }}
                  className="group mb-1.5 flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left transition-all last:mb-0 hover:border-white/25 hover:bg-white/[0.08]"
                >
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-white text-neutral-900">
                    <p.Logo className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-slate-100">{p.name}</span>
                    <span className="block truncate text-[10px] text-slate-500">{p.tagline}</span>
                  </span>
                  <span className="flex-none text-[10px] font-medium text-amber-300 opacity-0 transition-opacity group-hover:opacity-100">
                    Continue →
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* credentials */}
          {stage === 'form' && meta && (
            <form
              className="rounded-xl border border-white/10 bg-[#151a29] p-4 shadow-2xl"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <div
                className="mb-4 flex items-center gap-2.5 rounded-lg border border-white/8 p-2.5"
                style={{ background: `linear-gradient(90deg, ${meta.tint}22, transparent 70%)` }}
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-white text-neutral-900">
                  <meta.Logo className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-100">{meta.name}</div>
                  <div className="truncate text-[10px] text-slate-400">{meta.tagline} · OAuth 2.0 device grant</div>
                </div>
              </div>

              <label htmlFor="mailsi-email" className="mb-1 block text-[11px] font-medium text-slate-300">
                Email
              </label>
              <input
                id="mailsi-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={meta.placeholder}
                autoComplete="off"
                className="mb-3 h-9 w-full rounded-md border border-white/12 bg-white/[0.05] px-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none"
              />
              <label htmlFor="mailsi-name" className="mb-1 block text-[11px] font-medium text-slate-300">
                Display name
              </label>
              <input
                id="mailsi-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How recipients see you (optional)"
                autoComplete="off"
                className="mb-3 h-9 w-full rounded-md border border-white/12 bg-white/[0.05] px-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none"
              />

              {err && (
                <p role="alert" className="mb-2.5 text-[11px] font-medium text-rose-400">
                  {err}
                </p>
              )}

              <div className="mb-3 flex flex-wrap gap-1">
                {['OAuth 2.0', 'TLS 1.3', 'device grant'].map((b) => (
                  <span key={b} className="rounded-full border border-sky-400/25 bg-sky-500/10 px-2 py-0.5 text-[9.5px] font-medium text-sky-300">
                    {b}
                  </span>
                ))}
              </div>

              <button
                type="submit"
                className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-amber-500 text-xs font-semibold text-black transition-colors hover:bg-amber-400"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Continue with {meta.name}
              </button>
            </form>
          )}

          {/* signing animation */}
          {stage === 'signing' && (
            <div className="rounded-xl border border-white/10 bg-[#151a29] p-4 shadow-2xl" role="status" aria-live="polite">
              <div className="mb-3 flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 font-medium text-amber-300">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Signing in securely…
                </span>
                <span className="font-mono text-slate-500">{Math.min(step + 1, 3)}/3</span>
              </div>
              <div className="mb-4 h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-sky-400 transition-all duration-500"
                  style={{ width: `${(Math.min(step + 1, 3) / 3) * 100}%` }}
                />
              </div>
              <ol className="space-y-2.5">
                {steps.map((label, i) => {
                  const state = i < step ? 'done' : i === step ? 'active' : 'todo'
                  return (
                    <li key={label} className="flex items-center gap-2.5 text-xs">
                      {state === 'done' ? (
                        <CheckCircle2 className="h-4 w-4 flex-none text-sky-400" />
                      ) : state === 'active' ? (
                        <Loader2 className="h-4 w-4 flex-none animate-spin text-amber-300" />
                      ) : (
                        <span className="flex h-4 w-4 flex-none items-center justify-center">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                        </span>
                      )}
                      <span className={state === 'todo' ? 'text-slate-500' : 'text-slate-200'}>{label}</span>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}

          {/* granted */}
          {stage === 'granted' && (
            <div className="flex flex-col items-center rounded-xl border border-sky-400/20 bg-[#12201a] p-8 text-center shadow-2xl" role="status">
              <ShieldCheck className="h-10 w-10 text-sky-400" />
              <div className="mt-2 text-sm font-semibold text-slate-100">Mailbox provisioned</div>
              <div className="mt-1 text-[11px] text-slate-400">Encrypted with AES-256 — opening your inbox…</div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-center gap-1.5 px-2 text-center text-[10px] leading-relaxed text-slate-500">
            <ShieldCheck className="h-3 w-3 flex-none text-sky-500/80" />
            Sessions persist on this device only — sign out any time from the mailbox sidebar.
          </div>
        </div>
      </section>

      {/* close affordance for keyboard users (no-op visual X — stage is mandatory) */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-md text-slate-600"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// REDSEC 8.0 — Accounts hub: sign in to ANY company's apps from inside the OS.
// Web apps (social media, tools, games, productivity) can hand off sign-in to
// the provider's real login page (first-party context, cookies stay with the
// real company), and the OS remembers which accounts are linked on this device.
'use client'

import React, { useCallback, useSyncExternalStore } from 'react'
import { BadgeCheck, LogOut, ShieldCheck, X } from 'lucide-react'

export interface Provider {
  id: string
  name: string
  loginUrl: string
  color: string
  glyph: string
  apps: string
}

export const PROVIDERS: Provider[] = [
  { id: 'meta', name: 'Meta', loginUrl: 'https://www.facebook.com/login/', color: '#0866ff', glyph: 'M', apps: 'Facebook · Instagram · WhatsApp' },
  { id: 'google', name: 'Google', loginUrl: 'https://accounts.google.com/signin', color: '#ea4335', glyph: 'G', apps: 'YouTube · Drive · Gmail · Play' },
  { id: 'microsoft', name: 'Microsoft', loginUrl: 'https://login.live.com/', color: '#50e0a0', glyph: 'W', apps: 'Office · Xbox · OneDrive · Edge' },
  { id: 'apple', name: 'Apple', loginUrl: 'https://appleid.apple.com/sign-in', color: '#e8e8ed', glyph: '', apps: 'iCloud · App Store · Music' },
  { id: 'x', name: 'X', loginUrl: 'https://x.com/i/flow/login', color: '#e7e9ea', glyph: 'X', apps: 'X (Twitter) · X Premium' },
  { id: 'nvidia', name: 'NVIDIA', loginUrl: 'https://www.nvidia.com/en-us/login/', color: '#76b900', glyph: 'N', apps: 'GeForce NOW · NVIDIA App' },
  { id: 'oracle', name: 'Oracle', loginUrl: 'https://profile.oracle.com/myprofile/account/secure/sign-in.jspx', color: '#f80000', glyph: 'O', apps: 'Oracle Cloud · Java' },
  { id: 'amazon', name: 'Amazon', loginUrl: 'https://www.amazon.com/ap/signin', color: '#ff9900', glyph: 'a', apps: 'Prime · Twitch · AWS' },
  { id: 'steam', name: 'Steam', loginUrl: 'https://store.steampowered.com/login/', color: '#66c0f4', glyph: 'S', apps: 'Steam games · Workshop' },
  { id: 'adobe', name: 'Adobe', loginUrl: 'https://account.adobe.com/', color: '#ff0000', glyph: 'A', apps: 'Creative Cloud · Photoshop' },
  { id: 'github', name: 'GitHub', loginUrl: 'https://github.com/login', color: '#e6edf3', glyph: 'G', apps: 'GitHub · Copilot' },
  { id: 'discord', name: 'Discord', loginUrl: 'https://discord.com/login', color: '#5865f2', glyph: 'D', apps: 'Discord app sign-in' },
]

const KEY = 'redsec.accounts.v1'

const ACCOUNTS_EVENT = 'redsec-accounts-changed'
const accountListeners = new Set<() => void>()

/* cached snapshot — useSyncExternalStore requires a stable reference */
let cachedAccounts: Record<string, { at: number; user?: string }> = {}
let cacheFresh = false

function loadLinked(): Record<string, { at: number; user?: string }> {
  if (!cacheFresh) {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || '{}')
      cachedAccounts = j && typeof j === 'object' ? j : {}
    } catch {
      cachedAccounts = {}
    }
    cacheFresh = true
  }
  return cachedAccounts
}

function subscribeAccounts(cb: () => void): () => void {
  if (accountListeners.size === 0) loadLinked() // warm the cache before first read
  /* cross-tab 'storage' events must invalidate the snapshot cache first */
  const wrapped = () => {
    cacheFresh = false
    cb()
  }
  accountListeners.add(wrapped)
  window.addEventListener('storage', wrapped)
  window.addEventListener(ACCOUNTS_EVENT, wrapped)
  return () => {
    accountListeners.delete(wrapped)
    window.removeEventListener('storage', wrapped)
    window.removeEventListener(ACCOUNTS_EVENT, wrapped)
  }
}

function saveLinked(map: Record<string, { at: number; user?: string }>) {
  cachedAccounts = map
  cacheFresh = true
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* best effort */
  }
  window.dispatchEvent(new Event(ACCOUNTS_EVENT))
}

/** shared linked-accounts state — every surface (Settings, web app windows) */
export function useAccounts() {
  const linked = useSyncExternalStore(subscribeAccounts, loadLinked, () => ({} as Record<string, { at: number; user?: string }>))

  const signIn = useCallback((p: Provider) => {
    window.open(p.loginUrl, 'redsec-signin', 'width=1020,height=720,noopener')
    const map = { ...loadLinked(), [p.id]: { at: Date.now() } }
    saveLinked(map)
  }, [])

  const markLinked = useCallback((id: string, user?: string) => {
    const map = { ...loadLinked(), [id]: { at: Date.now(), user } }
    saveLinked(map)
  }, [])

  const signOut = useCallback((id: string) => {
    const map = { ...loadLinked() }
    delete map[id]
    saveLinked(map)
  }, [])

  return { linked, signIn, markLinked, signOut }
}

/** compact grid of provider cards — used by Settings ▸ Accounts */
export function AccountsGrid({ compact }: { compact?: boolean }) {
  const { linked, signIn, signOut } = useAccounts()
  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-2 @[700px]:grid-cols-3' : 'grid-cols-1 @[560px]:grid-cols-2 @[900px]:grid-cols-3'}`}>
      {PROVIDERS.map((p) => {
        const isLinked = !!linked[p.id]
        return (
          <div key={p.id} className="rounded-xl border border-white/10 bg-[#161b28] p-3">
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-sm font-black"
                style={{ background: `${p.color}26`, color: p.color }}
                aria-hidden
              >
                {p.glyph || p.name.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
                  {p.name}
                  {isLinked && <BadgeCheck className="h-3.5 w-3.5 text-emerald-400" />}
                </div>
                <div className="truncate text-[9.5px] text-slate-500">{p.apps}</div>
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => signIn(p)}
                className="h-7 flex-1 rounded-md bg-white/8 px-2 text-[10.5px] font-semibold text-slate-200 transition-colors hover:bg-white/16"
                title={`Opens the real ${p.name} sign-in page in a first-party window`}
              >
                {isLinked ? 'Re-sign in' : 'Sign in'}
              </button>
              {isLinked && (
                <>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold text-emerald-300">LINKED</span>
                  <button
                    type="button"
                    onClick={() => signOut(p.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-rose-500/15 hover:text-rose-300"
                    title="Remove the linked marker from this device"
                    aria-label={`Unlink ${p.name}`}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** modal picker — dropped into web-app windows ("Sign in" in the toolbar) */
export function SignInHubModal({ open, appName, onClose }: { open: boolean; appName: string; onClose: () => void }) {
  const { linked, signIn } = useAccounts()
  if (!open) return null
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6" role="dialog" aria-label="Sign in with a company account" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-xl flex-col rounded-xl border border-white/10 bg-[#12161f] p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-100">Sign in to {appName || 'this app'}</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 flex items-center gap-1.5 text-[10.5px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          Pick a company — the REAL sign-in page opens in a first-party window, so passwords never touch the OS. The OS remembers the link on this device.
        </p>
        <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto os-scroll pr-1 @[520px]:grid-cols-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                signIn(p)
                onClose()
              }}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#161b28] p-2.5 text-left transition-colors hover:border-white/25"
            >
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-xs font-black" style={{ background: `${p.color}26`, color: p.color }}>
                {p.glyph || p.name.slice(0, 1)}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-xs font-semibold text-slate-100">
                  {p.name}
                  {linked[p.id] && <BadgeCheck className="h-3 w-3 flex-none text-emerald-400" />}
                </span>
                <span className="block truncate text-[9px] text-slate-500">{p.apps}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

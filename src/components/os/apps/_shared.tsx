// REDSEC v5.0 — Shared UI kit for all apps
'use client'

import React, { useEffect, useState } from 'react'
import { WifiOff, Loader2 } from 'lucide-react'
import { useOS, osNow } from '@/lib/os/store'
import { fs } from '@/lib/os/fs'
import type { AppProps } from '@/lib/os/types'

export function AppShell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  /* @container — every @[...] container-query breakpoint in every app now
     reacts to the real app-window width (maximize / snap included) */
  return <div className={`@container flex h-full w-full flex-col overflow-hidden bg-[#10141f] text-slate-100 ${className}`}>{children}</div>
}

export function Toolbar({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div style={style} className={`flex flex-none items-center gap-1.5 border-b border-white/10 bg-[#161b28] px-2.5 py-1.5 ${className}`}>{children}</div>
  )
}

export function TBtn({
  children,
  onClick,
  title,
  active,
  className = '',
  disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  title?: string
  active?: boolean
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all disabled:opacity-40 ${
        active ? 'bg-sky-600/80 text-white' : 'bg-white/5 text-slate-200 hover:bg-white/12 hover:text-white'
      } ${className}`}
    >
      {children}
    </button>
  )
}

export function EmptyState({ icon, title, sub }: { icon?: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-4xl opacity-60">{icon || '📂'}</div>
      <div className="text-sm font-medium text-slate-300">{title}</div>
      {sub && <div className="max-w-xs text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

/** Gate: if WiFi / airplane / internet driver off → offline screen (web apps)
 *  Task 66 — also watches the REAL network (browser online/offline events):
 *  when the device actually loses its internet connection while the app is
 *  running, every web app instantly shows the No-network screen. */
export function useRealOnline(): boolean {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine !== false)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])
  return online
}

export function WifiGate({ children, app }: { children: React.ReactNode; app: string }) {
  const { wifi, airplane, drivers } = useOS()
  const realOnline = useRealOnline()
  if (!drivers.internet) {
    return (
      <AppShell>
        <OfflineScreen title="No Internet Driver" body="The internet driver is disabled in Settings → Drivers. Enable it to use this app." />
      </AppShell>
    )
  }
  if (airplane) {
    return (
      <AppShell>
        <OfflineScreen title="Airplane mode is ON" body={`Turn off airplane mode to use ${app}.`} />
      </AppShell>
    )
  }
  if (!wifi) {
    return (
      <AppShell>
        <OfflineScreen title="WiFi is OFF — No Network" body={`${app} needs an internet connection. Turn on WiFi in the taskbar or Settings → Network.`} />
      </AppShell>
    )
  }
  if (!realOnline) {
    return (
      <AppShell>
        <OfflineScreen title="No Network" body={`${app} is running but the device is offline right now. Reconnect the internet — the app resumes automatically.`} />
      </AppShell>
    )
  }
  return <>{children}</>
}

export function OfflineScreen({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#0c101c] p-10 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/5">
        <WifiOff className="h-9 w-9 text-slate-400" />
      </div>
      <div className="text-lg font-semibold text-slate-200">{title}</div>
      {body && <div className="max-w-sm text-sm text-slate-500">{body}</div>}
      <button
        onClick={() => useOS.getState().set({ wifi: true, airplane: false })}
        className="mt-2 rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-500"
      >
        Turn on WiFi
      </button>
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  )
}

/** live clock hook */
export function useClock(intervalMs = 1000): Date {
  const [now, setNow] = useState<Date>(() => new Date())
  const autoTime = useOS((s) => s.autoTime)
  const manualClock = useOS((s) => s.manualClock)
  useEffect(() => {
    const t = setInterval(() => setNow(osNow(autoTime, manualClock)), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs, autoTime, manualClock])
  return now
}

/** subscribe to global voice typing events targeted at focused windows */
export function useVoiceTyping(onText: (text: string) => void): void {
  useEffect(() => {
    const h = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail
      if (detail?.text) onText(detail.text)
    }
    window.addEventListener('os-voice-type', h)
    return () => window.removeEventListener('os-voice-type', h)
  }, [onText])
}

/** save an image blob into Photos (with screenshot/painting meta) */
export async function saveImageToPhotos(blob: Blob, name: string, kind = 'screenshot'): Promise<void> {
  await fs.addFile('photos', name, { blob, mime: blob.type || 'image/png', meta: { kind } })
  useOS.getState().notify({ title: 'Saved to Photos', body: name, kind: 'success', emoji: '🖼️' })
}

export async function saveImageToScreenshots(blob: Blob, name: string): Promise<void> {
  await fs.addFile('screenshots', name, { blob, mime: blob.type || 'image/png', meta: { kind: 'screenshot' } })
  useOS.getState().notify({ title: 'Screenshot saved', body: name, kind: 'success', emoji: '📸' })
}

export function fmtBytes(bytes = 0): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** renders node media as blob URL if stored, else remote url */
export function useNodeUrl(nodeId?: string, remote?: string): string {
  const [url, setUrl] = useState(remote || '')
  useEffect(() => {
    let dead = false
    if (nodeId) {
      fs.blobUrl(nodeId).then((u) => {
        if (!dead && u) setUrl(u)
      })
    } else if (remote) {
      queueMicrotask(() => {
        if (!dead) setUrl(remote)
      })
    }
    return () => {
      dead = true
    }
  }, [nodeId, remote])
  return url
}

export { type AppProps }

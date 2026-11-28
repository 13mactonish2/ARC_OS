// REDSEC 5.0 — Task 18: FleetUpdateToast, the fleet-wide update warning.
// A dramatic top-center modal that pops on EVERY running device when the owner
// pushes a system update. Two triggers:
//   1. live — joins the comm-service and listens for 'fleet:update' broadcasts
//   2. local — on mount, compares localStorage redsec5.fleet.lastBuild with the
//      current REDSEC.build; an older stored build means this device was updated
//
// EXPORTS (main agent wiring):
//   export default FleetUpdateToast  — render ONCE near the OS root (no props)
//   showFleetUpdate(info)            — imperatively pop the warning
//     info: { build: string; note?: string; at?: number }
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { AlertTriangle, ShieldCheck, X } from 'lucide-react'
import { commSocket } from '@/lib/os/comm'
import { REDSEC } from '@/lib/os/redsec'
import { FLEET_BUILD_KEY } from '@/lib/os/owner'

export interface FleetUpdateInfo {
  build: string
  note?: string
  at?: number
}

/* ---------------- tiny module store (zustand, no context needed) ---------------- */
interface FleetStore {
  info: FleetUpdateInfo | null
  visible: boolean
}

const useFleetStore = create<FleetStore>(() => ({ info: null, visible: false }))

/** pop the SYSTEM UPDATE warning on this device (used by the socket + boot check) */
export function showFleetUpdate(info: FleetUpdateInfo): void {
  useFleetStore.setState({ info: { note: '', at: Date.now(), ...info }, visible: true })
}

function dismissFleetUpdate(): void {
  useFleetStore.setState({ visible: false })
}

/* ---------------- the toast ---------------- */
export default function FleetUpdateToast() {
  const info = useFleetStore((s) => s.info)
  const visible = useFleetStore((s) => s.visible)
  const [mounted, setMounted] = useState(false)
  const sockRef = useRef<ReturnType<typeof commSocket> | null>(null)

  useEffect(() => {
    let dead = false
    const onFleet = (p: { build?: string; note?: string; at?: number } | undefined) => {
      if (p && typeof p.build === 'string' && p.build) {
        showFleetUpdate({ build: p.build, note: String(p.note || ''), at: Number(p.at) || Date.now() })
      }
    }
    Promise.resolve().then(() => {
      if (dead) return
      setMounted(true)
      // (1) live fleet broadcast
      const s = commSocket()
      sockRef.current = s
      s.on('fleet:update', onFleet)
      // (2) local boot check — stored build older than the running build = updated offline
      try {
        const stored = localStorage.getItem(FLEET_BUILD_KEY)
        if (stored && stored !== REDSEC.build) {
          showFleetUpdate({
            build: REDSEC.build,
            note: `Your device moved from build ${stored} to ${REDSEC.build} while you were away.`,
            at: Date.now(),
          })
        }
        localStorage.setItem(FLEET_BUILD_KEY, REDSEC.build)
      } catch { /* private mode */ }
    })
    return () => {
      dead = true
      sockRef.current?.off('fleet:update', onFleet)
    }
  }, [])

  if (!mounted) return null
  if (!visible || !info) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[9999] flex justify-center px-3">
      <style>{`@keyframes fleetToastIn { 0% { transform: translateY(-140%) scale(.96); opacity: 0 } 60% { transform: translateY(6%) scale(1.01); opacity: 1 } 100% { transform: translateY(0) scale(1); opacity: 1 } } @keyframes fleetToastPulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }`}</style>
      <div
        role="alert"
        className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-rose-400/40 bg-gradient-to-b from-[#2a0a10] to-[#170609] shadow-[0_18px_60px_rgba(244,63,94,0.35)]"
        style={{ animation: 'fleetToastIn .45s cubic-bezier(.2,.9,.3,1.2) both' }}
      >
        <div className="h-1 w-full bg-gradient-to-r from-rose-600 via-rose-400 to-rose-600" style={{ animation: 'fleetToastPulse 1.6s ease-in-out infinite' }} />
        <div className="flex items-start gap-3 p-4">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-rose-500/15">
            <AlertTriangle className="h-6 w-6 text-rose-300" style={{ animation: 'fleetToastPulse 1.2s ease-in-out infinite' }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-extrabold tracking-wide text-rose-200">
              ⚠ SYSTEM UPDATE — REDSEC OS was updated to build {info.build}
            </div>
            {info.note ? (
              <div className="mt-1 text-[11.5px] leading-relaxed text-rose-100/80">{info.note}</div>
            ) : null}
            <div className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300/90">
              <ShieldCheck className="h-3 w-3" /> Distributed to all devices · Applied
            </div>
          </div>
          <button
            type="button"
            onClick={dismissFleetUpdate}
            aria-label="Dismiss update warning"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-rose-200/70 transition hover:bg-white/10 hover:text-rose-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

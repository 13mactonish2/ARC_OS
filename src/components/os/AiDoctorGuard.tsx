// REDSEC 8.0 — AI Doctor boot guard.
// Lives at the OS root: (1) keeps the global JS error ring buffer the doctor
// reads from, (2) when AUTO-FIX is ON it silently scans the whole OS shortly
// after boot and applies every safe repair without bothering the user.
'use client'

import { useEffect } from 'react'

const ERR_KEY = 'redsec.aidoctor.errors'
const AUTO_KEY = 'redsec.aidoctor.autofix'

export default function AiDoctorGuard() {
  useEffect(() => {
    /* 1 — global JS error ring (last 10 messages, deduped) */
    const pushErr = (msg: string) => {
      try {
        const raw = JSON.parse(localStorage.getItem(ERR_KEY) || '[]') as string[]
        const clean = msg.replace(/\s+/g, ' ').slice(0, 160)
        if (!clean || raw[raw.length - 1] === clean) return
        raw.push(clean)
        localStorage.setItem(ERR_KEY, JSON.stringify(raw.slice(-10)))
      } catch {
        /* ignore */
      }
    }
    const onErr = (e: ErrorEvent) => pushErr(e.message || String(e.error || 'unknown error'))
    const onRej = (e: PromiseRejectionEvent) => pushErr(`unhandled rejection: ${String(e.reason).slice(0, 140)}`)
    window.addEventListener('error', onErr)
    window.addEventListener('unhandledrejection', onRej)

    /* 2 — silent boot scan + self-heal when auto-fix is enabled */
    let dead = false
    const bootScan = async () => {
      if (localStorage.getItem(AUTO_KEY) === '0') return
      await new Promise((r) => setTimeout(r, 25_000)) // let the OS settle first
      if (dead) return
      try {
        const est = await navigator.storage?.estimate?.()
        const report = {
          device: navigator.userAgent.slice(0, 120),
          online: navigator.onLine,
          storageUsedMb: est ? Math.round((est.usage || 0) / 1_048_576) : undefined,
          storageQuotaMb: est ? Math.round((est.quota || 0) / 1_048_576) : undefined,
          jsErrors: (() => {
            try {
              return JSON.parse(localStorage.getItem(ERR_KEY) || '[]') as string[]
            } catch {
              return []
            }
          })(),
          bootScan: true,
        }
        const r = await fetch('/api/system/doctor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ report }),
        })
        const j = (await r.json()) as {
          ok?: boolean
          issues?: Array<{ id: string; severity: string; title: string; autoFixable?: boolean; fix?: { action: string; target?: string } }>
        }
        if (!j.ok || !j.issues || dead) return
        for (const issue of j.issues) {
          if (!issue.autoFixable || !issue.fix) continue
          if (issue.fix.action === 'clear_temp_caches') {
            try {
              sessionStorage.clear()
            } catch {
              /* ignore */
            }
          }
        }
        /* boot scan intentionally only clears harmless caches — window-level
           repairs stay inside the Settings ▸ AI Doctor experience, where the
           user can see exactly what happened. */
      } catch {
        /* doctor unreachable — silently skip */
      }
    }
    void bootScan()

    return () => {
      dead = true
      window.removeEventListener('error', onErr)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }, [])

  return null
}

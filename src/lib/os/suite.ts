// REDSEC 5.0 — Open Suite activation packs & 5-minute free demo licensing.
// The Open Suite apps (Word, Sheet, Presentation, Kalkulator, PDF Viewer,
// Songs, YouTube + the InterCore comm apps) run as a 5-minute free demo out
// of the box; when the demo is used up (or a pack expires) the app asks the
// user to go to the App Store and activate the software package. Packs are
// free and time-boxed:
//   1 month  → Word, Sheet, Presentation
//   3 months → + Kalkulator (Task 37 — the Calculator, renamed), PDF Viewer
//   1 year   → + Songs, YouTube
//   2 years  → everything + UNLIMITED Video Call, Chat & Mail
//
// Task 53 (REDSEC 6.0 BlueStringRay) — the AI gets its OWN Open Suite family:
// AI Suite packs are separate from the office packs and come in 1 / 2 / 6 / 12
// month free terms. Activating an AI pack runs the QR + 6-digit code ceremony
// (QR is scanned with REDSEC Mobile, the phone shows a six-digit number, the
// code is typed back on the PC) — after verification the AI (terminal `AI`
// command — the neural core that controls every app) is licensed and flagged to run smoothly with zero
// corruption (integrity-guarded inference).
'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type SuiteAppId = 'word' | 'sheet' | 'presentation' | 'kalkulator' | 'pdfviewer' | 'songs' | 'youtube' | 'chat' | 'ai'

export const SUITE_APPS: SuiteAppId[] = ['word', 'sheet', 'presentation', 'kalkulator', 'pdfviewer', 'songs', 'youtube']

/** comm apps are only licensed by the Infinite 2-year pack (unlimited use) */
export const SUITE_COMM_APPS: SuiteAppId[] = ['chat']

/** Task 53 — the AI is licensed ONLY by its own AI Suite packs (QR + 6-digit) */
export const SUITE_AI_APPS: SuiteAppId[] = ['ai']

export const SUITE_NAME: Record<SuiteAppId, string> = {
  word: 'Word',
  sheet: 'Sheet',
  presentation: 'Presentation',
  kalkulator: 'Kalkulator',
  pdfviewer: 'PDF Viewer',
  songs: 'Audio Fly',
  youtube: 'YouTube',
  chat: 'Chat',
  ai: 'AI Suite',
}

/** demo budget per app: 5 minutes of open-usage */
export const DEMO_SECONDS = 5 * 60

const DAY = 86_400_000

export interface SuitePack {
  id: string
  name: string
  tagline: string
  months: 1 | 2 | 3 | 6 | 12 | 24
  ms: number
  apps: SuiteAppId[]
  accent: string
  popular?: boolean
  best?: boolean
}

export const SUITE_PACKS: SuitePack[] = [
  {
    id: 'suite1m',
    name: 'Open Suite Starter',
    tagline: 'The office trio',
    months: 1,
    ms: 30 * DAY,
    apps: ['word', 'sheet', 'presentation'],
    accent: '#38bdf8',
  },
  {
    id: 'suite3m',
    name: 'Open Suite Plus',
    tagline: 'Office + documents',
    months: 3,
    ms: 90 * DAY,
    apps: ['word', 'sheet', 'presentation', 'kalkulator', 'pdfviewer'],
    accent: '#38bdf8',
    popular: true,
  },
  {
    id: 'suite12m',
    name: 'Open Suite Ultra',
    tagline: 'Everything, incl. Songs & YouTube',
    months: 12,
    ms: 365 * DAY,
    apps: [...SUITE_APPS],
    accent: '#f59e0b',
  },
  {
    id: 'suite24m',
    name: 'Open Suite Infinite',
    tagline: 'Everything + UNLIMITED Video Call, Chat & Mail',
    months: 24,
    ms: 730 * DAY,
    apps: [...SUITE_APPS, ...SUITE_COMM_APPS],
    accent: '#e11d48',
    best: true,
  },
]

/** Task 53 — AI Suite: separate free terms — 1 / 2 / 6 / 12 months */
export const AI_SUITE_PACKS: SuitePack[] = [
  {
    id: 'ai1m',
    name: 'AI Suite Basic',
    tagline: 'BlackSea-N1 — 1 month free',
    months: 1,
    ms: 30 * DAY,
    apps: ['ai'],
    accent: '#22d3ee',
  },
  {
    id: 'ai2m',
    name: 'AI Suite Plus',
    tagline: 'Neural core + voice persona — 2 months free',
    months: 2,
    ms: 61 * DAY,
    apps: ['ai'],
    accent: '#38bdf8',
    popular: true,
  },
  {
    id: 'ai6m',
    name: 'AI Suite Pro',
    tagline: 'Deep neural activation — 6 months free',
    months: 6,
    ms: 183 * DAY,
    apps: ['ai'],
    accent: '#818cf8',
  },
  {
    id: 'ai12m',
    name: 'AI Suite Ultra',
    tagline: 'Everything unlocked — 1 year free',
    months: 12,
    ms: 365 * DAY,
    apps: ['ai'],
    accent: '#f59e0b',
    best: true,
  },
]

export function packById(id: string): SuitePack | undefined {
  return SUITE_PACKS.find((p) => p.id === id) || AI_SUITE_PACKS.find((p) => p.id === id)
}

export interface SuiteActivation {
  packId: string
  at: number
  expiresAt: number
}

interface SuiteStore {
  activations: SuiteActivation[]
  demoUsed: Record<string, number> // SuiteAppId → seconds consumed
  activate: (packId: string) => void
  deactivate: (index: number) => void
  addDemo: (app: SuiteAppId, secs: number) => void
}

export const useSuite = create<SuiteStore>()(
  persist(
    (set, get) => ({
      activations: [],
      demoUsed: {},
      activate: (packId: string) => {
        const p = packById(packId)
        if (!p) return
        set({ activations: [...get().activations, { packId, at: Date.now(), expiresAt: Date.now() + p.ms }] })
      },
      deactivate: (index: number) => set({ activations: get().activations.filter((_, i) => i !== index) }),
      addDemo: (app: SuiteAppId, secs: number) =>
        set({ demoUsed: { ...get().demoUsed, [app]: Math.min(DEMO_SECONDS, (get().demoUsed[app] || 0) + secs) } }),
    }),
    {
      name: 'redsec5.suite.v1',
      storage: createJSONStorage(() => localStorage),
      // v2 — Task 37: the Calculator suite app is renamed Kalkulator; demo
      // seconds recorded under the old 'calculator' key are carried over.
      version: 2,
      migrate: (persisted: unknown, version: number) => {
        const p = (persisted || {}) as { demoUsed?: Record<string, number> }
        if (version < 2 && p.demoUsed && typeof p.demoUsed === 'object') {
          const du = p.demoUsed
          if (typeof du.calculator === 'number') {
            du.kalkulator = Math.max(du.kalkulator ?? 0, du.calculator)
            delete du.calculator
          }
        }
        return p as never
      },
    }
  )
)

/** non-expired activations (real clock based) */
export function activeActivations(now = Date.now()): Array<SuiteActivation & { pack: SuitePack }> {
  return useSuite
    .getState()
    .activations.filter((a) => a.expiresAt > now)
    .map((a) => ({ ...a, pack: packById(a.packId) }))
    .filter((a): a is SuiteActivation & { pack: SuitePack } => !!a.pack)
}

export interface SuiteStatus {
  licensed: boolean
  packName?: string
  packId?: string
  expiresAt?: number
  demoUsed: number
  demoLeft: number
  everActivated: boolean
}

/** synchronous status check (e.g. for the store UI).
 * v7.0.2 — ALL Open Suite apps are permanently unlocked: every app reports a
 * full lifetime license, so the demo ribbon / activation gate can never
 * appear again. Kept as a function so the store UI keeps working. */
export const SUITE_UNLOCK_FOREVER = Date.now() + 3650 * DAY

export function suiteStatus(app: SuiteAppId, now = Date.now()): SuiteStatus {
  void now
  void useSuite.getState()
  return {
    licensed: true,
    packName: 'Open Suite Infinite — unlocked',
    packId: 'suite24m',
    expiresAt: SUITE_UNLOCK_FOREVER,
    demoUsed: 0,
    demoLeft: DEMO_SECONDS,
    everActivated: true,
  }
}

export type SuiteGateInfo =
  | { status: 'licensed'; packName: string; expiresAt: number; daysLeft: number }
  | { status: 'demo'; remaining: number }
  | { status: 'blocked'; reason: 'demo' | 'expired' }

/** live gate hook — v7.0.2: every Open Suite app is PERMANENTLY licensed.
 * The 5-minute demo timer is gone (it was killing the office apps after
 * 5 minutes of total usage and replacing them with an activation screen).
 * No interval runs, so opening the apps costs nothing and never blocks. */
export function useSuiteGate(app: SuiteAppId): SuiteGateInfo {
  void app
  return { status: 'licensed', packName: 'Open Suite Infinite — unlocked', expiresAt: SUITE_UNLOCK_FOREVER, daysLeft: 3650 }
}

/** Task 53 — AI license status (terminal banner / Provide App activation hub) */
export interface AiLicense {
  active: boolean
  planName: string
  expiresAt: number
  daysLeft: number
  smooth: boolean // integrity-guard verified — "runs smoothly, no corruption"
}
export function aiLicenseStatus(now = Date.now()): AiLicense {
  const st = suiteStatus('ai', now)
  return {
    active: st.licensed,
    planName: st.packName || 'Not activated',
    expiresAt: st.expiresAt || 0,
    daysLeft: st.expiresAt ? daysLeft(st.expiresAt, now) : 0,
    smooth: st.licensed,
  }
}

/* formatting helpers */
export function fmtDemoClock(secs: number): string {
  const s = Math.max(0, Math.ceil(secs))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function fmtPackTerm(months: number): string {
  if (months === 24) return '2 years'
  if (months === 12) return '1 year'
  return `${months} month${months > 1 ? 's' : ''}`
}

export function fmtExpiry(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function daysLeft(ts: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((ts - now) / DAY))
}

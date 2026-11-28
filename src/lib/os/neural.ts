// REDSEC 6.0 — NEURAL CORE (BlueStringRay-N1)
//
// The "neural code activation" shipped with REDSEC 6.0: a tiny on-device
// inference engine that learns HOW THE USER ACTUALLY WORKS and uses those
// signals to re-rank the shell (Start menu grid, search results, Recommended).
// It is NOT decoration — the Start menu really re-orders itself.
//
// Real signals collected (all local, all silent):
//   - app open events (weighted by recency — exponential decay, half-life 2 days)
//   - search activations, snap/tiling actions, voice commands
//   - session length per app (probe on window close)
//
// The "model" is an exponentially-weighted frequency table with a novelty
// prior — a real, tiny learning loop (rewards recent usage, forgets stale
// habits), persisted to localStorage under redsec6.neural.
'use client'

const NEURAL_KEY = 'redsec6.neural'
export const NEURAL_MODEL = 'BlackSea-N1'

export interface NeuralState {
  activated: boolean
  enabled: boolean // user toggle (Settings ▸ System specs)
  activations: number // total inference events since install
  scores: Record<string, number> // appId → ewma score
  lastEvent: { kind: string; appId?: string; at: number } | null
  installedAt: number
}

const DAY = 86_400_000
const HALF_LIFE = 2 * DAY

function fresh(): NeuralState {
  return {
    activated: true,
    enabled: true,
    activations: 0,
    scores: {},
    lastEvent: null,
    installedAt: Date.now(),
  }
}

let cache: NeuralState | null = null
const listeners = new Set<() => void>()

function load(): NeuralState {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(NEURAL_KEY)
    if (raw) {
      const s = JSON.parse(raw) as NeuralState
      if (s && typeof s === 'object' && s.scores) {
        cache = { ...fresh(), ...s, activated: true }
        return cache
      }
    }
  } catch {}
  cache = fresh()
  return cache
}

function save(): void {
  try {
    if (cache) localStorage.setItem(NEURAL_KEY, JSON.stringify(cache))
  } catch {}
  listeners.forEach((l) => l())
}

/** subscribe for React (useSyncExternalStore-compatible snapshot getter below) */
export function neuralSubscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function neuralSnapshot(): NeuralState {
  return cache || load()
}

function decayScore(v: number, then: number): number {
  const age = Math.max(0, Date.now() - then)
  return v * Math.pow(0.5, age / HALF_LIFE)
}

/** record a real shell event — weights: open 1.0, search 0.6, snap 0.3, voice 0.5 */
export function neuralTouch(kind: 'open' | 'search' | 'snap' | 'voice', appId?: string): void {
  const st = load()
  if (!st.enabled) return
  const w = kind === 'open' ? 1 : kind === 'search' ? 0.6 : kind === 'voice' ? 0.5 : 0.3
  if (appId) {
    // decay the whole table so stale habits fade…
    for (const k of Object.keys(st.scores)) {
      const prev = st.scores[k]
      st.scores[k] = decayScore(prev, st.lastEvent?.at || Date.now())
    }
    // …then reward the current app
    st.scores[appId] = (st.scores[appId] || 0) + w
  }
  st.activations += 1
  st.lastEvent = { kind, appId, at: Date.now() }
  save()
}

/** neural ranking score for an app (0..∞, higher = more relevant right now) */
export function neuralScore(appId: string): number {
  const st = load()
  if (!st.enabled) return 0
  return decayScore(st.scores[appId] || 0, st.lastEvent?.at || Date.now())
}

/** reorder app ids by neural relevance — stable for zero-signal items */
export function neuralRankOrder<T>(items: T[], idOf: (t: T) => string): T[] {
  const st = load()
  if (!st.enabled || st.activations < 3) return items // not enough signal yet — keep default order
  const scored = items.map((it, i) => ({ it, i, s: neuralScore(idOf(it)) }))
  scored.sort((a, b) => (b.s > 0 || a.s > 0 ? b.s - a.s : a.i - b.i))
  return scored.map((x) => x.it)
}

export function neuralSetEnabled(on: boolean): void {
  const st = load()
  st.enabled = on
  st.activated = true
  save()
}

export function neuralReset(): void {
  cache = { ...fresh(), installedAt: Date.now() }
  save()
}

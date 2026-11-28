// REDSEC 5.0 — storage key namespace (single source of truth)
// v5.0 moved every persisted key from the old "redsec4.*" namespace to
// "redsec5.*". A one-time migration copies the old namespace verbatim so
// existing installs keep all their data (files, settings, pkg state…).
// (History: v3.0 = refalcon3.* → v4.0 = redsec4.* → v5.0 = redsec5.*)

export const KEYNS = 'redsec5.'
const OLD_NS = 'redsec4.'

export const K = {
  settings: 'redsec5.settings',
  fsNodes: 'redsec5.fs.nodes',
  blob: (id: string) => `redsec5.blob.${id}`,
  // pkg database (same storage slot the package state has always lived in)
  pkg: 'redsec5.pkg.v1',
  weather: 'redsec5.weather',
  av: 'redsec5.av.v1',
  // Black Sea — stable per-device security fingerprint (survives cache wipes via recompute)
  deviceId: 'redsec5.device_id',
} as const

let migrated = false

/** one-time copy of the legacy redsec4.* keys into the redsec5.* namespace */
export function migrateKeys(): void {
  if (migrated) return
  migrated = true
  try {
    if (typeof localStorage === 'undefined') return
    if (localStorage.getItem(K.settings)) return // already on the redsec5 namespace
    if (!localStorage.getItem('redsec4.settings')) return // fresh install — nothing to copy
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(OLD_NS)) keys.push(k)
    }
    for (const k of keys) {
      const v = localStorage.getItem(k)
      if (v != null) localStorage.setItem(KEYNS + k.slice(OLD_NS.length), v)
    }
  } catch {
    /* storage unavailable — run without persistence */
  }
}

// run as soon as the module is imported (before any key is read)
migrateKeys()

/* ---- IndexedDB namespace migration (virtual FS + blobs live in IDB) ---- */
import { get, set, keys as idbKeys } from 'idb-keyval'

/** one-time copy of redsec4.fs.nodes + redsec4.blob.* → redsec5.* (called by fsLoad) */
export async function migrateIdbNamespace(): Promise<void> {
  try {
    const fresh = await get<unknown>(K.fsNodes)
    if (fresh) return // already on the redsec5 namespace
    const old = await get<unknown>('redsec4.fs.nodes')
    if (!old) return // fresh install — nothing to copy
    await set(K.fsNodes, old)
    const all = await idbKeys()
    for (const k of all) {
      const s = String(k)
      if (s.startsWith('redsec4.blob.')) {
        const v = await get(s)
        if (v) await set(K.blob(s.slice('redsec4.blob.'.length)), v)
      }
    }
  } catch {
    /* IDB unavailable — run without persistence */
  }
}

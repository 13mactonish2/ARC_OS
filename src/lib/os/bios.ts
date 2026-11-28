// REDSEC 5.0 — BIOS Vault: per-console firmware storage.
// Firmware images (BIOS / OFW) are stored locally in IndexedDB — they never
// leave the device and are NEVER bundled with the OS (copyright stays with
// the console maker; users flash dumps from hardware they own).
// Consumed by Gaming Hub → EmulatorJS `EJS_biosUrl`.
import { createStore, get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from 'idb-keyval'

export interface BiosMeta {
  consoleId: string
  fileName: string
  size: number
  addedAt: number
  version: string // firmware version label the slot targets (e.g. "6.61")
}

interface StoredBios {
  meta: BiosMeta
  blob: Blob
}

let cachedStore: ReturnType<typeof createStore> | null = null
function store() {
  if (!cachedStore) cachedStore = createStore('redsec5-bios', 'bios')
  return cachedStore
}

const KEY = (consoleId: string) => `bios:${consoleId}`

/** Flash (upload) a firmware image for a console — replaces any previous one. */
export async function putBios(consoleId: string, file: File, version: string): Promise<BiosMeta> {
  const meta: BiosMeta = {
    consoleId,
    fileName: file.name,
    size: file.size,
    addedAt: Date.now(),
    version,
  }
  await idbSet(KEY(consoleId), { meta, blob: file } satisfies StoredBios, store())
  return meta
}

/** Metadata for the flashed firmware of a console (null when not flashed). */
export async function getBios(consoleId: string): Promise<BiosMeta | null> {
  try {
    const rec = await idbGet<StoredBios>(KEY(consoleId), store())
    return rec?.meta ?? null
  } catch {
    return null
  }
}

/** Object-URL of the flashed firmware blob, ready for EJS_biosUrl (null when none). */
export async function getBiosUrl(consoleId: string): Promise<string | null> {
  try {
    const rec = await idbGet<StoredBios>(KEY(consoleId), store())
    if (!rec?.blob) return null
    return URL.createObjectURL(new Blob([rec.blob], { type: 'application/octet-stream' }))
  } catch {
    return null
  }
}

export async function deleteBios(consoleId: string): Promise<void> {
  try {
    await idbDel(KEY(consoleId), store())
  } catch {
    /* ignore */
  }
}

/** All flashed firmware across consoles. */
export async function listBios(): Promise<BiosMeta[]> {
  try {
    const ks = await idbKeys(store())
    const out: BiosMeta[] = []
    for (const k of ks) {
      if (typeof k === 'string' && k.startsWith('bios:')) {
        const rec = await idbGet<StoredBios>(k, store())
        if (rec?.meta) out.push(rec.meta)
      }
    }
    return out
  } catch {
    return []
  }
}

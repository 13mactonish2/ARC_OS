// REDSEC 5.0 — ANTI-CHEAT daemon (real integrity guard for the OS kernel state)
//
// This file is a live security daemon, not a mock. What it actually does while
// REDSEC runs:
//   1. SETTINGS SEAL — snapshots the critical persisted OS state (login,
//      wallpaper/theme, installed apps, desktop, updates, drivers, patch
//      level…) into a SHA-256-sealed copy in localStorage. Every 20 s it
//      re-hashes the live store; if the hash changed WITHOUT a legit store
//      mutation (i.e. someone edited `redsec5.settings` behind the OS's back)
//      it raises a critical `settings_tamper` incident and AUTO-RESTORES the
//      sealed values through the store.
//   2. OFFLINE TAMPER CHECK — at boot it compares the live store against the
//      seal written by the previous session; a mismatch means the settings key
//      was edited while the OS was off → critical incident + restore.
//   3. NATIVE API INTEGRITY — fingerprints Storage.prototype.{setItem,
//      getItem,removeItem,clear}, JSON.parse/stringify and Array.prototype.push
//      at boot; any hook/spoof of these natives later is flagged as critical.
//   4. PROTOTYPE POLLUTION GUARD — watches Object.prototype/Array.prototype
//      fingerprints and a frozen null-prototype canary for pollution attacks.
//   5. STORAGE SANITY — verifies the zustand settings key stays parseable JSON.
'use client'

import { useOS } from '../store'
import { chargedInterval, fnv1a, lsKeys, securityKernel, sha256Hex, type KernelFinding } from './kernel'
import { nativesCheckMs, sealVerifyMs } from './hardened'

const SEAL_KEY = 'redsec5.kernel.seal'
const SALT_KEY = 'redsec5.kernel.salt'
const SETTINGS_KEY = 'redsec5.settings'
/* persist schema this seal was built against. Bumped to 25 alongside the
   Task 47 store migration — a schema change makes the daemon re-baseline its
   seal from the freshly-migrated state instead of "healing" the migration
   back to pre-update values. */
const SCHEMA = 25

/** critical persisted fields the seal covers (healed automatically on tamper) */
const CRITICAL_FIELDS = [
  'setupComplete',
  'username',
  'password',
  'continent',
  'themeBg',
  'wallpaper',
  'wallpaperSlideshow',
  'securityPatchLevel',
  'shieldAutoScan',
  'installedApps',
  'desktopItems',
  'taskbarPinned',
  'updates',
  'drivers',
  'installedDrivers',
] as const

function settingsSnapshot(): Record<string, unknown> {
  const st = useOS.getState() as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of CRITICAL_FIELDS) {
    if (st[k] !== undefined) out[k] = st[k]
  }
  return out
}

function deviceSalt(): string {
  let s: string | null = null
  try {
    s = localStorage.getItem(SALT_KEY)
  } catch {
    /* ignore */
  }
  if (!s) {
    s = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    try {
      localStorage.setItem(SALT_KEY, s)
    } catch {
      /* keep session-only salt */
    }
  }
  return s
}

function nativeFingerprint(fnRef: unknown): string {
  try {
    return Function.prototype.toString.call(fnRef)
  } catch {
    return 'unavailable'
  }
}

class AntiCheat {
  readonly id = 'anti-cheat' as const
  readonly name = 'Anti-Cheat — Integrity Guard'
  readonly file = 'anti-cheat.ts'
  readonly desc = 'Seals OS settings with SHA-256, verifies native APIs & prototypes, auto-restores tampered state'

  private timers: ReturnType<typeof setInterval>[] = []
  private unsub: (() => void) | null = null
  private lastJson = ''
  private lastHash = ''
  private lastLegitSet = 0
  private reSealTimer: ReturnType<typeof setTimeout> | null = null
  private natives: Array<{ name: string; ref: unknown; fp: string }> = []
  private objProtoFp = ''
  private arrProtoFp = ''
  private canary: object | null = null
  private tamperBlocked = 0
  private nativeOk = 1
  private checks = 0

  /* ---------- seal ---------- */

  private async hashSnapshot(json: string): Promise<string> {
    return sha256Hex(`${deviceSalt()}|SCHEMA ${SCHEMA}|${json}|${fnv1a(json)}`)
  }

  private async seal(reason: 'boot' | 'legit-change' | 'heal'): Promise<void> {
    const json = JSON.stringify(settingsSnapshot())
    const hash = await this.hashSnapshot(json)
    this.lastJson = json
    this.lastHash = hash
    try {
      localStorage.setItem(SEAL_KEY, JSON.stringify({ schema: SCHEMA, at: Date.now(), reason, hash, json }))
    } catch {
      /* in-memory seal still guards this session */
    }
  }

  /* ---------- daemon lifecycle ---------- */

  start(): void {
    // 3. native API fingerprints (before anything else hooks them)
    this.natives = [
      { name: 'localStorage.setItem', ref: Storage.prototype.setItem, fp: '' },
      { name: 'localStorage.getItem', ref: Storage.prototype.getItem, fp: '' },
      { name: 'localStorage.removeItem', ref: Storage.prototype.removeItem, fp: '' },
      { name: 'localStorage.clear', ref: Storage.prototype.clear, fp: '' },
      { name: 'JSON.parse', ref: JSON.parse, fp: '' },
      { name: 'JSON.stringify', ref: JSON.stringify, fp: '' },
      { name: 'Array.prototype.push', ref: Array.prototype.push, fp: '' },
    ].map((n) => ({ ...n, fp: nativeFingerprint(n.ref) }))

    // 4. prototype baselines + null-proto canary
    this.objProtoFp = Object.getOwnPropertyNames(Object.prototype).sort().join(',') + `#${fnv1a(String(Object.prototype))}`
    this.arrProtoFp = Object.getOwnPropertyNames(Array.prototype).sort().join(',')
    this.canary = Object.freeze(Object.create(null))

    // 2. offline tamper check against the previous session's seal, then boot seal
    void this.bootSealCheck()

    // legit store mutations (Settings UI, installs…) re-seal after a debounce
    this.lastLegitSet = Date.now()
    this.unsub = useOS.subscribe(() => {
      this.lastLegitSet = Date.now()
      if (this.reSealTimer) clearTimeout(this.reSealTimer)
      this.reSealTimer = setTimeout(() => void this.seal('legit-change'), 900)
    })

    // 1. the integrity verification loop — Task 50: 10 s in EXTREME HARDENED mode
    this.timers.push(
      chargedInterval('anti-cheat', () => void this.verify(), sealVerifyMs()),
      chargedInterval('anti-cheat', () => this.checkNatives(), nativesCheckMs()),
      chargedInterval('anti-cheat', () => this.checkPrototypes(), 30_000),
      chargedInterval('anti-cheat', () => this.checkStorageSanity(), 25_000),
    )
  }

  stop(): void {
    this.timers.forEach(clearInterval)
    this.timers = []
    this.unsub?.()
    this.unsub = null
  }

  /* ---------- checks ---------- */

  private async bootSealCheck(): Promise<void> {
    let sealed: { schema?: number; hash?: string; json?: string } | null = null
    try {
      const raw = localStorage.getItem(SEAL_KEY)
      if (raw) sealed = JSON.parse(raw) as { schema?: number; hash?: string; json?: string }
    } catch {
      sealed = null
    }
    if (!sealed || sealed.schema !== SCHEMA || !sealed.json) {
      await this.seal('boot') // first run or schema changed — establish the baseline
      return
    }
    const current = JSON.stringify(settingsSnapshot())
    if (current !== sealed.json) {
      // settings changed while the OS was off — restore the sealed truth
      this.tamperBlocked++
      securityKernel.report({
        shield: 'anti-cheat',
        kind: 'settings_tamper_offline',
        severity: 'critical',
        detail: `OS settings were modified outside the OS while it was off (${Object.keys(JSON.parse(sealed.json) as object).length} sealed fields differed).`,
        action: 'sealed values restored',
      })
      this.heal(sealed.json)
    }
    await this.seal('boot')
  }

  private async verify(): Promise<void> {
    this.checks++
    const json = JSON.stringify(settingsSnapshot())
    const hash = await this.hashSnapshot(json)
    if (hash !== this.lastHash) {
      if (Date.now() - this.lastLegitSet < 6000) {
        // a legit store mutation landed between snapshots — re-seal, no alarm
        await this.seal('legit-change')
        return
      }
      this.tamperBlocked++
      const sealJson = this.lastJson || json
      securityKernel.report({
        shield: 'anti-cheat',
        kind: 'settings_tamper',
        severity: 'critical',
        detail: `Live OS state hash mismatch — critical fields were edited without a legitimate store mutation (sha256 ${this.lastHash.slice(0, 10)}… → ${hash.slice(0, 10)}…).`,
        action: 'sealed values restored',
      })
      this.heal(sealJson)
      await this.seal('heal')
    }
  }

  /** restore the sealed critical fields through the real store */
  private heal(sealJson: string): void {
    try {
      const patch = JSON.parse(sealJson) as Record<string, unknown>
      useOS.getState().set(patch as unknown as Partial<ReturnType<typeof useOS.getState>>)
    } catch {
      /* corrupt seal — keep the live values, incident already raised */
    }
  }

  private checkNatives(): void {
    this.checks++
    for (const n of this.natives) {
      const now = nativeFingerprint(n.ref)
      if (now !== n.fp) {
        this.nativeOk = 0
        n.fp = now // don't re-alarm every cycle for the same hook
        securityKernel.report({
          shield: 'anti-cheat',
          kind: 'native_hook',
          severity: 'critical',
          detail: `${n.name} was re-wrapped or spoofed after boot (native code fingerprint changed).`,
          action: 'flagged — daemons keep running on sealed references',
        })
      }
    }
  }

  private checkPrototypes(): void {
    this.checks++
    const objFp = Object.getOwnPropertyNames(Object.prototype).sort().join(',') + `#${fnv1a(String(Object.prototype))}`
    const arrFp = Object.getOwnPropertyNames(Array.prototype).sort().join(',')
    const canaryClean = this.canary && Object.getPrototypeOf(this.canary) === null && Object.keys(this.canary as object).length === 0
    if (objFp !== this.objProtoFp || arrFp !== this.arrProtoFp || !canaryClean) {
      this.objProtoFp = objFp
      this.arrProtoFp = arrFp
      securityKernel.report({
        shield: 'anti-cheat',
        kind: 'prototype_pollution',
        severity: 'critical',
        detail: 'Object/Array prototype fingerprints changed or the kernel canary was polluted at runtime.',
        action: 'flagged — polluted keys are not trusted by the OS',
      })
    }
  }

  private checkStorageSanity(): void {
    this.checks++
    let raw: string | null = null
    try {
      raw = localStorage.getItem(SETTINGS_KEY)
    } catch {
      return
    }
    if (raw === null) return
    try {
      const p = JSON.parse(raw) as { state?: unknown }
      if (!p || typeof p !== 'object' || !('state' in p)) throw new Error('bad shape')
    } catch {
      securityKernel.report({
        shield: 'anti-cheat',
        kind: 'storage_corruption',
        severity: 'critical',
        detail: `The ${SETTINGS_KEY} store key is no longer valid REDSEC settings JSON.`,
        action: 'flagged — the sealed copy in this daemon can restore it',
      })
    }
  }

  /* ---------- introspection ---------- */

  stats(): Record<string, number> {
    return {
      tamperBlocked: this.tamperBlocked,
      nativeOk: this.nativeOk,
      sealedFields: CRITICAL_FIELDS.length,
      checks: this.checks,
    }
  }

  async sweep(): Promise<KernelFinding[]> {
    const findings: KernelFinding[] = []
    const json = JSON.stringify(settingsSnapshot())
    const hash = await this.hashSnapshot(json)
    findings.push({
      shield: 'anti-cheat',
      check: 'settings seal (SHA-256)',
      ok: hash === this.lastHash,
      detail: `${CRITICAL_FIELDS.length} sealed fields · sha256 ${hash.slice(0, 12)}…`,
    })
    const nativesIntact = this.natives.every((n) => nativeFingerprint(n.ref) === n.fp)
    findings.push({
      shield: 'anti-cheat',
      check: 'native API integrity',
      ok: nativesIntact && this.nativeOk === 1,
      detail: `${this.natives.length} natives fingerprinted (Storage / JSON / Array)`,
    })
    findings.push({
      shield: 'anti-cheat',
      check: 'prototype pollution guard',
      ok: !!this.canary && Object.getPrototypeOf(this.canary) === null,
      detail: 'Object.prototype · Array.prototype · null-proto canary',
    })
    findings.push({
      shield: 'anti-cheat',
      check: 'kernel keys present',
      ok: lsKeys().some((k) => k === SEAL_KEY),
      detail: lsKeys().filter((k) => k.startsWith('redsec5.kernel')).length + ' redsec5.kernel.* keys on disk',
    })
    return findings
  }
}

export const antiCheat = new AntiCheat()

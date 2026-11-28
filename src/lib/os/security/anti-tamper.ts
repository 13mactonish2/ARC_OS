// REDSEC 7.0 "Black Sea" — ANTI-TAMPER daemon (EXTREME level, real counters)
//
// New in the Black Sea security formula. A live guard that keeps the OS's
// system surface tamper-proof — not a simulation:
//   1. SYSTEM FILE SEALS — every file under /etc, /boot and /usr/bin is
//      checksummed (FNV-1a) at boot; a 30s watchdog re-hashes them and any
//      byte-level change raises a CRITICAL incident and is AUTO-RESTORED
//      from the sealed snapshot in memory (self-heal).
//   2. BOOT CHAIN SEAL  — the boot/system file set is sealed as one chain
//      hash; a broken chain is reported on every watchdog tick.
//   3. CROSS-TAB WRITE GUARD — the browser `storage` event only fires for
//      writes made by OTHER tabs/windows; any external write touching a
//      redsec.* key is logged as a tamper attempt with the key name.
//   4. SEALED WATERMARK — the daemon keeps a rolling watermark of the
//      settings payload length; violent truncation/replace attacks (wiping
//      localStorage then re-seeding a fake store) are reported.
//
// All events are audit-only (OS policy): incidents land in the kernel log,
// never in the notification center.
'use client'

import { chargedInterval, fnv1a, securityKernel, type KernelFinding } from './kernel'
import { fs } from '../fs'
import type { FSNode } from '../types'

interface FileSeal {
  id: string
  path: string
  hash: string
  text: string
}

const WATCH_ROOTS = ['/etc', '/boot', '/usr/bin']
const SETTINGS_KEY = 'redsec5.settings'

class AntiTamper {
  readonly id = 'anti-tamper'
  readonly name = 'Anti-Tamper — EXTREME System Seal'
  readonly file = 'anti-tamper.ts'
  readonly desc = 'System-file seals with self-heal, boot-chain hash, cross-tab write guard, settings watermark'

  private timers: ReturnType<typeof setInterval>[] = []
  private seals = new Map<string, FileSeal>()
  private chainHash = ''
  private tamperHits = 0
  private restored = 0
  private crossTabWrites = 0
  private watermark = 0
  private bootedAt = 0
  private busy = false

  /* path string of a node, e.g. /etc/pkg.conf */
  private pathOf(n: FSNode): string {
    try {
      return '/' + fs.path(n.id).slice(1).map((x) => x.name).join('/')
    } catch {
      return '/' + n.name
    }
  }

  /* ---------- 1. system file seals ---------- */

  private async snapshot(): Promise<void> {
    const next = new Map<string, FileSeal>()
    try {
      for (const n of fs.all()) {
        if (n.trashed || n.kind !== 'file') continue
        const p = this.pathOf(n)
        if (!WATCH_ROOTS.some((r) => p === r || p.startsWith(r + '/'))) continue
        const text = await fs.readText(n)
        next.set(n.id, { id: n.id, path: p, hash: fnv1a(text), text })
      }
      this.seals = next
      this.chainHash = fnv1a([...next.keys()].sort().map((id) => next.get(id)!.hash).join('|'))
      try {
        this.watermark = (localStorage.getItem(SETTINGS_KEY) || '').length
      } catch {}
    } catch {
      /* fs not mounted yet — sweep() reports the gap */
    }
  }

  private async verify(): Promise<{ broken: FileSeal[]; chainOk: boolean }> {
    const broken: FileSeal[] = []
    for (const seal of this.seals.values()) {
      const node = fs.get(seal.id)
      if (!node || node.trashed) {
        broken.push(seal)
        continue
      }
      const text = await fs.readText(node)
      if (fnv1a(text) !== seal.hash) broken.push(seal)
    }
    return { broken, chainOk: broken.length === 0 }
  }

  /* ---------- 3. cross-tab write guard ---------- */

  private installStorageGuard(): void {
    try {
      window.addEventListener('storage', (e) => {
        if (!e.key || !e.key.startsWith('redsec')) return
        this.crossTabWrites++
        securityKernel.report({
          shield: 'anti-tamper',
          kind: 'cross_tab_write',
          severity: 'warn',
          detail: `Another tab/window wrote “${e.key}” (${(e.newValue || '').length} bytes) — outside this session.`,
          action: 'audited; seals re-verified on the next watchdog tick',
        })
      })
    } catch {
      /* storage events unsupported — guard passive */
    }
  }

  /* ---------- lifecycle ---------- */

  start(): void {
    this.bootedAt = Date.now()
    void this.snapshot()
    this.installStorageGuard()
    this.timers.push(
      chargedInterval('anti-tamper', async () => {
        if (this.busy) return
        this.busy = true
        try {
          const { broken } = await this.verify()
          if (broken.length > 0) {
            this.tamperHits += broken.length
            for (const seal of broken) {
              const node = fs.get(seal.id)
              if (node && !node.trashed) {
                try {
                  await fs.writeText(node, seal.text)
                  this.restored++
                  securityKernel.report({
                    shield: 'anti-tamper',
                    kind: 'sysfile_restored',
                    severity: 'critical',
                    detail: `${seal.path} failed its seal — restored from the sealed snapshot.`,
                    action: 'self-healed · file content re-sealed',
                  })
                } catch {
                  securityKernel.report({
                    shield: 'anti-tamper',
                    kind: 'sysfile_tampered',
                    severity: 'critical',
                    detail: `${seal.path} failed its seal and could not be restored (read-only?).`,
                    action: 'manual inspection required — File Manager ▸ ' + seal.path,
                  })
                }
              } else {
                securityKernel.report({
                  shield: 'anti-tamper',
                  kind: 'sysfile_missing',
                  severity: 'critical',
                  detail: `${seal.path} was deleted or trashed while the seal was active.`,
                  action: 'restore from Backup (Settings ▸ Backup) or reinstall the base',
                })
              }
            }
            await this.snapshot() // re-seal the healed state
          }
          // watermark: violent truncation of the settings payload
          try {
            const len = (localStorage.getItem(SETTINGS_KEY) || '').length
            if (this.watermark > 4096 && len > 0 && len < this.watermark * 0.25) {
              securityKernel.report({
                shield: 'anti-tamper',
                kind: 'settings_truncated',
                severity: 'warn',
                detail: `Settings payload shrank from ${this.watermark} to ${len} bytes — possible wipe/replace attack.`,
                action: 'watermark updated; Backup restore available in Settings',
              })
            }
            if (len > 0) this.watermark = len
          } catch {}
        } finally {
          this.busy = false
        }
      }, 30_000),
    )
  }

  stop(): void {
    this.timers.forEach(clearInterval)
    this.timers = []
  }

  /* ---------- introspection ---------- */

  stats(): Record<string, number> {
    return {
      sealedFiles: this.seals.size,
      tamperHits: this.tamperHits,
      restored: this.restored,
      crossTabWrites: this.crossTabWrites,
      chainHashNum: parseInt(this.chainHash.slice(0, 6), 16) || 0,
    }
  }

  async sweep(): Promise<KernelFinding[]> {
    const findings: KernelFinding[] = []
    const { broken, chainOk } = await this.verify()
    findings.push({
      shield: 'anti-tamper',
      check: 'system file seals (EXTREME)',
      ok: broken.length === 0,
      detail:
        `${this.seals.size} files sealed under ${WATCH_ROOTS.join(' / ')} · ${this.tamperHits} tamper hit(s) · ${this.restored} self-heal(s)` +
        (broken.length ? ` · BROKEN: ${broken.map((b) => b.path).slice(0, 3).join(', ')}` : ''),
    })
    findings.push({
      shield: 'anti-tamper',
      check: 'boot chain integrity',
      ok: chainOk && this.chainHash !== '',
      detail: chainOk && this.chainHash ? `chain hash ${this.chainHash.slice(0, 12)}… sealed across ${this.seals.size} boot/system files` : 'boot chain broken — see incidents',
    })
    findings.push({
      shield: 'anti-tamper',
      check: 'cross-tab write guard',
      ok: this.crossTabWrites === 0,
      detail: this.crossTabWrites ? `${this.crossTabWrites} write(s) arrived from other tabs — reviewed` : 'no foreign tab writes observed',
    })
    findings.push({
      shield: 'anti-tamper',
      check: 'settings watermark',
      ok: true,
      detail: `watermark ${this.watermark} bytes · level EXTREME · watchdog every 30s (uptime ${Math.round((Date.now() - this.bootedAt) / 1000)}s)`,
    })
    return findings
  }
}

export const antiTamper = new AntiTamper()

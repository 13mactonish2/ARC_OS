// REDSEC 5.0 — ANTI-BREACH daemon (real data-leak & ransomware guard)
//
// A live guard, not a simulation. While REDSEC runs it:
//   1. STORAGE GUARD — hooks Storage.prototype.setItem; a write OUTSIDE the
//      redsec5.* namespace that looks like credentials/secrets/large payloads
//      raises a `sensitive_write` incident (rate-limited per key).
//   2. CROSS-ORIGIN MESSAGE GUARD — window "message" events from foreign
//      origins (iframe ads, embeds) are counted; unexpected origins raise a
//      rate-limited `cross_origin_msg` incident.
//   3. CLIPBOARD EXFIL GUARD — navigator.clipboard.writeText is wrapped; bulk
//      copies (>50 KB in one call) raise a `clipboard_bulk` incident.
//   4. RANSOMWARE WATCH — samples the virtual FS every 6 s; ≥15 nodes deleted
//      inside one sampling window (or >30 % of used bytes vanishing) raises a
//      critical `mass_delete` incident — the classic ransomware signature.
//   5. SESSION FINGERPRINT — SHA-256 of UA/language/screen/timezone; a
//      mid-session change raises `session_swap`.
'use client'

import { fs } from '../fs'
import { chargedInterval, lsKeys, securityKernel, sha256Hex, type KernelFinding } from './kernel'
import { clipboardExfilBytes, ransomByteDrop, ransomDeletions } from './hardened'

const SFP_KEY = 'redsec5.kernel.sfp'

function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin
  } catch {
    return origin || 'unknown'
  }
}

class AntiBreach {
  readonly id = 'anti-breach' as const
  readonly name = 'Anti-Breach — Data Leak Guard'
  readonly file = 'anti-breach.ts'
  readonly desc = 'Storage/clipboard/foreign-message guards, ransomware watch on the virtual FS'

  private timers: ReturnType<typeof setInterval>[] = []
  private onMsg: ((e: MessageEvent) => void) | null = null
  private origSetItem: ((k: string, v: string) => void) | null = null
  private origWriteText: ((t: string) => Promise<void>) | null = null
  private flaggedWrites = 0
  private storageWrites = 0
  private foreignMsgs = 0
  private msgOrigins = new Set<string>()
  private clipboardWrites = 0
  private prevCount = -1
  private prevUsed = -1
  private deletesCaught = 0
  private checks = 0

  /* ---------- 1. storage guard ---------- */

  private installStorageGuard(): void {
    this.origSetItem = Storage.prototype.setItem
    const orig = this.origSetItem
    const bumpWrites = () => {
      this.storageWrites++
    }
    const flagWrite = (key: string, len: number) => {
      this.flaggedWrites++
      securityKernel.report({
        shield: 'anti-breach',
        kind: 'sensitive_write',
        severity: 'warn',
        detail: `A ${len}-byte value resembling credentials was written to storage key "${key.slice(0, 60)}" outside the OS namespace.`,
        action: 'flagged — key recorded in the breach log',
      })
    }
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      try {
        bumpWrites()
        if (!key.startsWith('redsec5') && typeof value === 'string' && value.length > 1024) {
          const head = value.slice(0, 512)
          if (/passw|token|secret|credential|apikey|api_key|private[_-]?key/i.test(`${key} ${head}`)) flagWrite(key, value.length)
        }
      } catch {
        /* the guard must never break a write */
      }
      return orig!.call(this, key, value)
    } as typeof Storage.prototype.setItem
  }

  /* ---------- 2. cross-origin messages ---------- */

  private installMessageGuard(): void {
    this.onMsg = (e: MessageEvent) => {
      try {
        if (!e.origin || e.origin === location.origin) return
        this.foreignMsgs++
        const host = hostOf(e.origin)
        this.msgOrigins.add(host)
        // rate-limited by kernel.report (2 min per kind) — embeds stay quiet
        securityKernel.report({
          shield: 'anti-breach',
          kind: 'cross_origin_msg',
          severity: 'info',
          detail: `A cross-origin message arrived from ${host} (${typeof e.data === 'string' ? `${e.data.length}B text` : typeof e.data}).`,
          action: 'counted — embeds (e.g. the player API) legitimately post messages',
        })
      } catch {
        /* ignore malformed events */
      }
    }
    window.addEventListener('message', this.onMsg)
  }

  /* ---------- 3. clipboard exfil ---------- */

  private installClipboardGuard(): void {
    try {
      const clip = navigator.clipboard
      if (!clip?.writeText) return
      const orig = clip.writeText.bind(clip)
      this.origWriteText = orig
      const bump = () => {
        this.clipboardWrites++
      }
      const flag = (kb: string) => {
        securityKernel.report({
          shield: 'anti-breach',
          kind: 'clipboard_bulk',
          severity: 'warn',
          detail: `${kb} KB was written to the system clipboard in a single call.`,
          action: 'flagged — possible bulk data export',
        })
      }
      clip.writeText = (text: string) => {
        try {
          bump()
          // Task 50: EXTREME HARDENED mode flags at 20 KB instead of 50 KB
          if (text.length > clipboardExfilBytes()) flag((text.length / 1024).toFixed(1))
        } catch {
          /* never break a copy */
        }
        return orig(text)
      }
    } catch {
      /* clipboard API unavailable — skip */
    }
  }

  /* ---------- 4. ransomware watch ---------- */

  private ransomwareTick(): void {
    this.checks++
    const count = fs.fileCount()
    const used = fs.usedSize()
    if (this.prevCount >= 0) {
      const dropped = this.prevCount - count
      const usedDrop = this.prevUsed > 0 ? (this.prevUsed - used) / this.prevUsed : 0
      // Task 50: EXTREME HARDENED — alarms trip at 8 deletes / 20 % byte drop
      if (dropped >= ransomDeletions() || usedDrop > ransomByteDrop()) {
        this.deletesCaught++
        securityKernel.report({
          shield: 'anti-breach',
          kind: 'mass_delete',
          severity: 'critical',
          detail: `${dropped} OS files disappeared in one 6-second window${usedDrop > ransomByteDrop() ? ` and ${(usedDrop * 100).toFixed(0)}% of stored bytes vanished` : ''} — ransomware signature.`,
          action: 'alerted — restore from Settings ▸ Backup if files are missing',
        })
      }
    }
    this.prevCount = count
    this.prevUsed = used
  }

  /* ---------- 5. session fingerprint ---------- */

  private async sessionFingerprint(): Promise<void> {
    const fp = await sha256Hex(`${navigator.userAgent}|${navigator.language}|${screen.width}x${screen.height}|${Intl.DateTimeFormat().resolvedOptions().timeZone}`)
    let prev: string | null = null
    try {
      prev = localStorage.getItem(SFP_KEY)
    } catch {
      /* ignore */
    }
    if (prev && prev !== fp) {
      securityKernel.report({
        shield: 'anti-breach',
        kind: 'session_swap',
        severity: 'warn',
        detail: 'The device fingerprint (UA / language / screen / timezone) changed since the last session on this storage.',
        action: 'flagged — breach log updated',
      })
    }
    try {
      localStorage.setItem(SFP_KEY, fp)
    } catch {
      /* ignore */
    }
  }

  /* ---------- lifecycle ---------- */

  start(): void {
    this.installStorageGuard()
    this.installMessageGuard()
    this.installClipboardGuard()
    void this.sessionFingerprint()

    // ransomware watch starts 5 s after boot so the FS has finished loading
    setTimeout(() => this.ransomwareTick(), 5_000)
    this.timers.push(chargedInterval('anti-breach', () => this.ransomwareTick(), 6_000))
  }

  stop(): void {
    this.timers.forEach(clearInterval)
    this.timers = []
    if (this.onMsg) window.removeEventListener('message', this.onMsg)
    if (this.origSetItem) Storage.prototype.setItem = this.origSetItem
    if (this.origWriteText) {
      try {
        navigator.clipboard.writeText = this.origWriteText
      } catch {
        /* ignore */
      }
    }
  }

  /* ---------- introspection ---------- */

  stats(): Record<string, number> {
    return {
      storageWrites: this.storageWrites,
      flaggedWrites: this.flaggedWrites,
      foreignMsgs: this.foreignMsgs,
      clipboardWrites: this.clipboardWrites,
      deletesCaught: this.deletesCaught,
      checks: this.checks,
    }
  }

  async sweep(): Promise<KernelFinding[]> {
    const findings: KernelFinding[] = []
    const keys = lsKeys()
    const osKeys = keys.filter((k) => k.startsWith('redsec5'))
    let osBytes = 0
    let foreignSensitive: string[] = []
    try {
      for (const k of keys) {
        const v = localStorage.getItem(k) || ''
        if (k.startsWith('redsec5')) osBytes += k.length + v.length
        else if (/passw|token|secret|credential/i.test(k) || (v.length > 4096 && /passw|secret/i.test(v.slice(0, 512))))
          foreignSensitive = [...foreignSensitive, k].slice(0, 8)
      }
    } catch {
      /* storage unavailable */
    }
    findings.push({
      shield: 'anti-breach',
      check: 'storage namespace audit',
      ok: foreignSensitive.length === 0,
      detail: `${osKeys.length} redsec5.* keys (${(osBytes / 1024).toFixed(1)} KB) · ${foreignSensitive.length ? `sensitive foreign keys: ${foreignSensitive.join(', ')}` : 'no sensitive data outside the OS namespace'}`,
    })
    findings.push({
      shield: 'anti-breach',
      check: 'cross-origin message audit',
      ok: true,
      detail: `${this.foreignMsgs} foreign messages from ${this.msgOrigins.size || 0} origin(s)${this.msgOrigins.size ? `: ${Array.from(this.msgOrigins).slice(0, 4).join(', ')}` : ''}`,
    })
    findings.push({
      shield: 'anti-breach',
      check: 'virtual FS integrity watch',
      ok: this.deletesCaught === 0,
      detail: `${fs.fileCount()} nodes · ${this.deletesCaught} mass-delete events caught this session`,
    })
    findings.push({
      shield: 'anti-breach',
      check: 'clipboard guard',
      ok: true,
      detail: `${this.clipboardWrites} writes this session · bulk threshold ${Math.round(clipboardExfilBytes() / 1000)} KB (extreme)`,
    })
    return findings
  }
}

export const antiBreach = new AntiBreach()

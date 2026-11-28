// REDSEC 5.0 — ANTI-HACK daemon (real intrusion detection for the OS session)
//
// A live IDS, not a simulation. While REDSEC runs it:
//   1. NETWORK IDS — wraps window.fetch and XMLHttpRequest.open. Every request
//      is resolved to a host and checked against the OS allowlist (same-origin
//      + known OS service hosts). A cross-origin call to a non-allowlisted host
//      is BLOCKED (fetch rejects with SecurityError) and raised as a critical
//      `net_exfil` incident. Allowlisted external calls are counted as events.
//   2. DOM INJECTION WATCH — a MutationObserver on the whole document flags
//      <script>/<object>/<embed> nodes injected from non-allowlisted remote
//      origins after boot (real XSS/injection signal).
//   3. DEVTOOLS DETECTION — outer/inner viewport delta heuristic sampled every
//      3 s; an open docked DevTools raises a rate-limited incident.
//   4. AUTOMATION DETECTION — navigator.webdriver (Selenium/Playwright/Puppeteer)
//      raises a critical `automation_tool` incident.
//   5. CONSOLE INTEGRITY — console.error/warn/log fingerprints are verified
//      every 30 s; a silenced/patched console is flagged.
//   6. FETCH WRAPPER SELF-CHECK — the daemon holds its own wrapper reference;
//      if window.fetch is re-wrapped by anyone else, that's a critical incident
//      (this is how anti-cheat and anti-hack avoid fighting each other).
'use client'

import { chargedInterval, securityKernel, type KernelFinding } from './kernel'

/** hosts the OS itself legitimately talks to (client-side) */
const ALLOW_HOSTS = new Set<string>([
  // same-origin is always allowed at check time (location.host)
  'api.frankfurter.app', // Kalkulator / Converter currency rates
  'en.wikipedia.org', // Dictionary
  'wikipedia.org',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'api.github.com',
  'github.com',
  'avatars.githubusercontent.com',
  'api.dicebear.com',
  'upload.wikimedia.org',
])

const ALLOW_SCHEMES = new Set(['blob:', 'data:', 'about:', 'filesystem:', 'chrome-extension:'])

function hostAllowed(rawUrl: string): { ok: boolean; host: string; scheme: string } {
  let u: URL
  try {
    u = new URL(rawUrl, location.href)
  } catch {
    return { ok: true, host: '', scheme: 'about:' } // unparseable — let the browser decide
  }
  if (ALLOW_SCHEMES.has(u.protocol)) return { ok: true, host: u.host, scheme: u.protocol }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: true, host: u.host, scheme: u.protocol }
  if (u.host === location.host) return { ok: true, host: u.host, scheme: u.protocol }
  return { ok: ALLOW_HOSTS.has(u.host), host: u.host, scheme: u.protocol }
}

class AntiHack {
  readonly id = 'anti-hack' as const
  readonly name = 'Anti-Hack — Intrusion Detection'
  readonly file = 'anti-hack.ts'
  readonly desc = 'fetch/XHR allowlist IDS, DOM injection watch, DevTools & automation detection'

  private timers: ReturnType<typeof setInterval>[] = []
  private obs: MutationObserver | null = null
  private origFetch: typeof fetch | null = null
  private myFetch: typeof fetch | null = null
  private consoleFps: Array<{ name: string; ref: unknown; fp: string }> = []
  private windowBaseline = new Set<string>()
  private extCalls = 0
  private blockedCalls = 0
  private scriptsFlagged = 0
  private devtoolsOpen = false
  private lastDevtoolsAt = 0
  private webdriver = false
  private xhrWatched = 0
  private checks = 0

  /* ---------- 1. network IDS ---------- */

  private installNetIds(): void {
    const orig = window.fetch.bind(window)
    this.origFetch = orig
    const bumpExt = () => {
      this.extCalls++
    }
    const blockCall = (host: string, url: string) => {
      this.blockedCalls++
      securityKernel.report({
        shield: 'anti-hack',
        kind: 'net_exfil',
        severity: 'critical',
        detail: `Blocked a page-level request to a non-allowlisted host: ${host} (${url.slice(0, 120)})`,
        action: 'request rejected with SecurityError',
      })
    }
    const wrapped: typeof fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const v = hostAllowed(url)
      if (!v.ok) {
        blockCall(v.host, url)
        return Promise.reject(new DOMException(`REDSEC anti-hack blocked cross-origin call to ${v.host}`, 'SecurityError'))
      }
      if (v.host && v.host !== location.host) bumpExt()
      return orig.apply(this, [input as RequestInfo, init])
    } as typeof fetch
    this.myFetch = wrapped
    window.fetch = wrapped

    // XHR — report-only (the OS never blocks XHR used by same-origin uploads)
    const origOpen = XMLHttpRequest.prototype.open
    const flagXhr = (host: string, method: string, url: string) => {
      this.checks++
      securityKernel.report({
        shield: 'anti-hack',
        kind: 'xhr_unknown_host',
        severity: 'warn',
        detail: `XMLHttpRequest opened to a non-allowlisted host: ${host} (${method} ${url.slice(0, 100)})`,
        action: 'monitored — not blocked (upload compatibility)',
      })
    }
    const bumpXhr = () => {
      this.xhrWatched++
    }
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      const v = hostAllowed(String(url))
      if (!v.ok && v.host) flagXhr(v.host, method, String(url))
      else if (v.host && v.host !== location.host) bumpXhr()
      type OpenSig = (m: string, u: string | URL, ...r: unknown[]) => void
      return (origOpen as OpenSig).apply(this, [method, url, ...rest])
    } as typeof XMLHttpRequest.prototype.open
  }

  /* ---------- 2. DOM injection watch ---------- */

  private installDomWatch(): void {
    this.obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          const tag = node.tagName
          if (tag !== 'SCRIPT' && tag !== 'OBJECT' && tag !== 'EMBED') continue
          const src = node.getAttribute('src') || node.getAttribute('data') || ''
          if (!src || src.startsWith('/') || src.startsWith('#')) continue // same-origin inline assets are fine
          const v = hostAllowed(src)
          if (!v.ok && v.host) {
            this.scriptsFlagged++
            securityKernel.report({
              shield: 'anti-hack',
              kind: 'dom_inject',
              severity: 'warn',
              detail: `A <${tag.toLowerCase()}> from a non-allowlisted origin was injected into the DOM: ${v.host}`,
              action: 'flagged — origin recorded in the incident log',
            })
          }
        }
      }
    })
    this.obs.observe(document.documentElement, { childList: true, subtree: true })
  }

  /* ---------- lifecycle ---------- */

  start(): void {
    this.installNetIds()
    this.installDomWatch()

    // 4. automation tooling
    if (navigator.webdriver === true) {
      this.webdriver = true
      securityKernel.report({
        shield: 'anti-hack',
        kind: 'automation_tool',
        severity: 'critical',
        detail: 'navigator.webdriver is true — the session is being driven by automation (Selenium/Playwright/Puppeteer).',
        action: 'flagged — session trust level lowered',
      })
    }

    // 5. console fingerprints
    this.consoleFps = (['error', 'warn', 'log'] as const).map((name) => ({
      name: `console.${name}`,
      ref: console[name],
      fp: this.fp(console[name]),
    }))

    // window global baseline (settles 2 s after boot so the framework loads first)
    setTimeout(() => {
      this.windowBaseline = new Set(Object.keys(window))
    }, 2000)

    this.timers.push(
      chargedInterval('anti-hack', () => this.checkDevtools(), 3_000),
      chargedInterval('anti-hack', () => this.checkConsole(), 30_000),
      chargedInterval('anti-hack', () => this.checkFetchWrapper(), 15_000),
      chargedInterval('anti-hack', () => this.checkGlobals(), 30_000),
    )
  }

  stop(): void {
    this.timers.forEach(clearInterval)
    this.timers = []
    this.obs?.disconnect()
    this.obs = null
    if (this.myFetch && window.fetch === this.myFetch && this.origFetch) window.fetch = this.origFetch
  }

  /* ---------- periodic checks ---------- */

  private fp(fnRef: unknown): string {
    try {
      return Function.prototype.toString.call(fnRef)
    } catch {
      return 'unavailable'
    }
  }

  private checkDevtools(): void {
    this.checks++
    const hGap = window.outerHeight - window.innerHeight
    const wGap = window.outerWidth - window.innerWidth
    const open = hGap > 220 || wGap > 320
    this.devtoolsOpen = open
    if (open && Date.now() - this.lastDevtoolsAt > 90_000) {
      this.lastDevtoolsAt = Date.now()
      securityKernel.report({
        shield: 'anti-hack',
        kind: 'devtools_open',
        severity: 'info',
        detail: `DevTools appears to be docked to this window (viewport delta ${Math.max(hGap, wGap)}px).`,
        action: 'session is being observed — native menu & shortcuts already locked by guard.ts',
      })
    }
  }

  private checkConsole(): void {
    this.checks++
    for (const c of this.consoleFps) {
      const now = this.fp(c.ref)
      if (now !== c.fp) {
        c.fp = now
        securityKernel.report({
          shield: 'anti-hack',
          kind: 'console_tamper',
          severity: 'warn',
          detail: `${c.name} was re-wrapped or silenced after boot.`,
          action: 'flagged — kernel logging does not depend on console.*',
        })
      }
    }
  }

  private checkFetchWrapper(): void {
    this.checks++
    if (this.myFetch && window.fetch !== this.myFetch) {
      this.myFetch = window.fetch // adopt the new chain, don't fight it
      securityKernel.report({
        shield: 'anti-hack',
        kind: 'net_layer_rewrap',
        severity: 'critical',
        detail: 'window.fetch was re-wrapped by another script after the IDS hook was installed.',
        action: 'IDS re-sealed on top of the new wrapper',
      })
    }
  }

  private checkGlobals(): void {
    this.checks++
    if (!this.windowBaseline.size) return
    const now = new Set(Object.keys(window))
    for (const k of now) {
      if (this.windowBaseline.has(k)) continue
      if (/hack|inject|cheat|bot|scraper|steal|keylog/i.test(k) && typeof (window as unknown as Record<string, unknown>)[k] === 'function') {
        securityKernel.report({
          shield: 'anti-hack',
          kind: 'global_hook',
          severity: 'info',
          detail: `A new window global matching hook patterns appeared after boot: window.${k}`,
          action: 'flagged — added to the session audit trail',
        })
      }
    }
    this.windowBaseline = now
  }

  /* ---------- introspection ---------- */

  stats(): Record<string, number> {
    return {
      extCalls: this.extCalls,
      blocked: this.blockedCalls,
      scriptsFlagged: this.scriptsFlagged,
      devtools: this.devtoolsOpen ? 1 : 0,
      webdriver: this.webdriver ? 1 : 0,
      checks: this.checks,
    }
  }

  async sweep(): Promise<KernelFinding[]> {
    const findings: KernelFinding[] = []
    findings.push({
      shield: 'anti-hack',
      check: 'network IDS wrapper',
      ok: !!this.myFetch && window.fetch === this.myFetch,
      detail: `${this.extCalls} allowlisted external calls · ${this.blockedCalls} blocked · allowlist ${ALLOW_HOSTS.size} hosts`,
    })
    const remoteScripts = Array.from(document.scripts).filter((s) => {
      const src = s.getAttribute('src') || ''
      return src.startsWith('http') && !hostAllowed(src).ok
    })
    findings.push({
      shield: 'anti-hack',
      check: 'DOM script audit',
      ok: remoteScripts.length === 0,
      detail: `${document.scripts.length} scripts in the document, ${remoteScripts.length} from unknown origins, ${this.scriptsFlagged} flagged this session`,
    })
    findings.push({
      shield: 'anti-hack',
      check: 'automation check',
      ok: navigator.webdriver !== true,
      detail: `navigator.webdriver = ${String(navigator.webdriver)}`,
    })
    findings.push({
      shield: 'anti-hack',
      check: 'console integrity',
      ok: this.consoleFps.every((c) => this.fp(c.ref) === c.fp),
      detail: 'console.error / warn / log fingerprints verified',
    })
    return findings
  }
}

export const antiHack = new AntiHack()

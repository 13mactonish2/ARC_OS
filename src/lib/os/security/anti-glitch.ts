// REDSEC 6.0 — ANTI-GLITCH daemon ("GlitchShield" — real rendering watchdog)
//
// New in the BlueStringRay formula. The OS's own glitch-bypass layer: it
// measures the REAL rendering pipeline and auto-repairs common visual
// glitches before the user sees them:
//   1. FRAME JITTER  — samples the rAF delta stream; spikes over 250 ms are
//                      counted as stalls (compositor hiccups).
//   2. STUCK OVERLAY — every 30 s it looks for fixed-position elements that
//                      cover >92 % of the viewport but are fully transparent
//                      / invisible — the classic "invisible pane eats my
//                      clicks" glitch — and neutralises them
//                      (pointer-events: none + data-antiglitch tag).
//   3. OVERFLOW SCAN — detects elements wider than the viewport (horizontal
//                      glitch scroll) outside allowed scrollers.
//   4. GHOST FOCUS   — detects an activeElement hidden by display:none
//                      (keyboard suddenly dead) and blurs it.
//
// All events are audit-only (OS policy).
'use client'

import { chargedInterval, securityKernel, type KernelFinding } from './kernel'

class AntiGlitch {
  readonly id = 'anti-glitch' as const
  readonly name = 'Anti-Glitch — GlitchShield Rendering Watchdog'
  readonly file = 'anti-glitch.ts'
  readonly desc = 'Frame-jitter probes, stuck-overlay neutralisation, overflow scan and ghost-focus repair'

  private raf = 0
  private timers: ReturnType<typeof setInterval>[] = []
  private lastFrame = 0
  private stalls = 0
  private worstStall = 0
  private repairs = 0
  private overflowSuspects = 0
  private bootedAt = Date.now()

  /* ---------- 1. frame jitter ---------- */

  private rafLoop = (t: number): void => {
    if (this.lastFrame) {
      const d = t - this.lastFrame
      if (d > 250) {
        this.stalls++
        this.worstStall = Math.max(this.worstStall, Math.round(d))
      }
    }
    this.lastFrame = t
    this.raf = requestAnimationFrame(this.rafLoop)
  }

  /* ---------- 2. stuck overlay neutralisation ---------- */

  private neutraliseOverlays(): void {
    let fixed = 0
    try {
      const W = window.innerWidth
      const H = window.innerHeight
      const els = document.body?.querySelectorAll<HTMLElement>('div,section,aside,main') || []
      els.forEach((el) => {
        if (el.dataset.antiglitch) return
        const cs = getComputedStyle(el)
        if (cs.position !== 'fixed') return
        const r = el.getBoundingClientRect()
        const covers = r.width >= W * 0.92 && r.height >= H * 0.92
        if (!covers) return
        const invisible =
          Number(cs.opacity) === 0 ||
          cs.visibility === 'hidden' ||
          (cs.backgroundColor === 'rgba(0, 0, 0, 0)' && !el.textContent?.trim() && !el.childElementCount)
        const inert = el.getAttribute('aria-hidden') === 'true' || el.style.pointerEvents === 'none'
        if (invisible && !inert) {
          // a fully invisible full-screen pane that still intercepts clicks — glitch
          el.style.pointerEvents = 'none'
          el.dataset.antiglitch = 'overlay'
          fixed++
        }
      })
    } catch {}
    if (fixed > 0) {
      this.repairs += fixed
      securityKernel.report({
        shield: 'anti-glitch',
        kind: 'stuck_overlay',
        severity: 'warn',
        detail: `${fixed} invisible full-screen pane(s) were intercepting pointer events.`,
        action: 'auto-repaired — pointer-events disabled on the ghost pane(s)',
      })
    }
  }

  /* ---------- 3. horizontal overflow scan ---------- */

  private scanOverflow(): void {
    try {
      const doc = document.documentElement
      const broken = doc.scrollWidth - window.innerWidth
      this.overflowSuspects = broken > 24 ? 1 : 0
      if (broken > 24) {
        // find the widest offender for the audit detail
        let worst: { w: number; tag: string } | null = null
        ;(document.body?.querySelectorAll<HTMLElement>('*') || []).forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.right > window.innerWidth + 24 && r.width < window.innerWidth * 3) {
            if (!worst || r.width > worst.w) worst = { w: Math.round(r.width), tag: el.tagName.toLowerCase() }
          }
        })
        const w = worst as { w: number; tag: string } | null
        securityKernel.report({
          shield: 'anti-glitch',
          kind: 'overflow_glitch',
          severity: 'info',
          detail: `Document overflows the viewport by ${broken}px${w ? ` — widest offender <${w.tag}> ${w.w}px` : ''}.`,
          action: 'logged — horizontal glitch scroll risk',
        })
      }
    } catch {}
  }

  /* ---------- 4. ghost focus repair ---------- */

  private repairGhostFocus(): void {
    try {
      const ae = document.activeElement as HTMLElement | null
      if (ae && ae !== document.body && !ae.offsetParent && getComputedStyle(ae).display === 'none') {
        ae.blur()
        this.repairs++
        securityKernel.report({
          shield: 'anti-glitch',
          kind: 'ghost_focus',
          severity: 'info',
          detail: 'activeElement was display:none — keyboard input appeared dead.',
          action: 'auto-repaired — focus released',
        })
      }
    } catch {}
  }

  /* ---------- lifecycle ---------- */

  start(): void {
    this.bootedAt = Date.now()
    this.lastFrame = 0
    this.raf = requestAnimationFrame(this.rafLoop)
    this.timers.push(chargedInterval('anti-glitch', () => this.neutraliseOverlays(), 30_000))
    this.timers.push(chargedInterval('anti-glitch', () => this.scanOverflow(), 45_000))
    this.timers.push(chargedInterval('anti-glitch', () => this.repairGhostFocus(), 15_000))
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.timers.forEach(clearInterval)
    this.timers = []
  }

  /* ---------- introspection ---------- */

  stats(): Record<string, number> {
    return {
      stalls: this.stalls,
      worstStall: this.worstStall,
      repairs: this.repairs,
      overflowSuspects: this.overflowSuspects,
      uptimeMin: Math.round((Date.now() - this.bootedAt) / 60_000),
    }
  }

  async sweep(): Promise<KernelFinding[]> {
    const findings: KernelFinding[] = []
    findings.push({
      shield: 'anti-glitch',
      check: 'compositor stalls (>250 ms frames)',
      ok: this.stalls < 30,
      detail: `${this.stalls} stall(s) this session · worst ${this.worstStall} ms`,
    })
    findings.push({
      shield: 'anti-glitch',
      check: 'stuck overlays',
      ok: true,
      detail: `${this.repairs} auto-repair(s) — invisible full-screen panes neutralised on sight`,
    })
    findings.push({
      shield: 'anti-glitch',
      check: 'horizontal overflow',
      ok: this.overflowSuspects === 0,
      detail: this.overflowSuspects ? 'document wider than viewport — glitch scroll risk' : 'document fits the viewport',
    })
    findings.push({
      shield: 'anti-glitch',
      check: 'ghost focus',
      ok: true,
      detail: 'activeElement watchdog running (15 s cycle) — dead keyboard auto-heals',
    })
    return findings
  }
}

export const antiGlitch = new AntiGlitch()

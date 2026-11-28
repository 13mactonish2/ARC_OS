// REDSEC 5.0 — ANTI-LAG daemon (real performance watchdog & adaptive tuning)
//
// A live performance guard, not a simulation. While REDSEC runs it:
//   1. FPS TELEMETRY — a requestAnimationFrame loop counts real frames every
//      second and keeps an exponential moving average of the true frame rate.
//   2. LONG-TASK WATCH — a PerformanceObserver('longtask') counts main-thread
//      tasks over 50 ms and tracks the worst offender.
//   3. HEAP PRESSURE — performance.memory is sampled every 5 s; sustained
//      growth over a settled baseline raises `mem_pressure` (real leak signal).
//   4. ADAPTIVE MODE — if the real FPS average stays under the hardened
//      threshold (27 in EXTREME HARDENED mode) for 5 straight
//      samples, the daemon sets <html data-perf="low"> which strips CSS
//      animations, transitions and backdrop blurs OS-wide (see globals.css).
//      When the frame rate recovers for 15 straight samples the flag is lifted.
'use client'

import { chargedInterval, securityKernel, type KernelFinding } from './kernel'
import { lowFps, recoverFps } from './hardened'

/* Task 50 — EXTREME HARDENED: engages at 27 fps / recovers at 45 fps
   (relaxed defaults were 24 / 42). Read at daemon start so the active
   profile is always what the running loop enforces. */
const LOW_FPS = lowFps()
const RECOVER_FPS = recoverFps()
const ENGAGE_STREAK = 5
const RECOVER_STREAK = 15

interface PerfMemory {
  usedJSHeapSize: number
  jsHeapSizeLimit: number
}

class AntiLag {
  readonly id = 'anti-lag' as const
  readonly name = 'Anti-Lag — Performance Watchdog'
  readonly file = 'anti-lag.ts'
  readonly desc = 'Real FPS / long-task / heap telemetry with an adaptive low-performance mode'

  private raf = 0
  private timers: ReturnType<typeof setInterval>[] = []
  private observer: PerformanceObserver | null = null
  private frames = 0
  private fps = 60
  private fpsEma = 60
  private longTasks = 0
  private worstTask = 0
  private heapMB = 0
  private heapBaseline = 0
  private heapHighStreak = 0
  private lowStreak = 0
  private recoverStreak = 0
  private engaged = false
  private engageCount = 0
  private bootedAt = Date.now()
  private lastReportAt: Record<string, number> = {}

  /* ---------- 1. real FPS loop ---------- */

  private rafLoop = (): void => {
    this.frames++
    this.raf = requestAnimationFrame(this.rafLoop)
  }

  private sampleFps(): void {
    const now = performance.now()
    const seconds = 1 // the sampler interval is 1 s
    void seconds
    const fps = this.frames // frames counted since the last sample
    this.frames = 0
    this.fps = fps
    // clamp absurd first samples (tab was backgrounded → rAF paused)
    const clamped = Math.min(fps, 120)
    this.fpsEma = this.fpsEma * 0.7 + clamped * 0.3

    // 4. adaptive mode (only 20 s after boot — startup jank doesn't count)
    if (Date.now() - this.bootedAt < 20_000) return
    if (this.fpsEma < LOW_FPS) {
      this.lowStreak++
      this.recoverStreak = 0
      if (this.lowStreak >= ENGAGE_STREAK && !this.engaged) this.engage()
    } else if (this.fpsEma >= RECOVER_FPS) {
      this.recoverStreak++
      this.lowStreak = 0
      if (this.recoverStreak >= RECOVER_STREAK && this.engaged) this.disengage()
    } else {
      this.lowStreak = Math.max(0, this.lowStreak - 1)
    }
  }

  private engage(): void {
    this.engaged = true
    this.engageCount++
    this.lowStreak = 0
    document.documentElement.setAttribute('data-perf', 'low')
    securityKernel.report({
      shield: 'anti-lag',
      kind: 'perf_mode',
      severity: 'info',
      detail: `Real frame rate averaged ${this.fpsEma.toFixed(0)} fps for 5 samples — below the ${LOW_FPS} fps floor.`,
      action: 'adaptive mode ON — animations, transitions & backdrop blurs paused OS-wide',
    })
  }

  private disengage(): void {
    this.engaged = false
    this.recoverStreak = 0
    document.documentElement.removeAttribute('data-perf')
    securityKernel.report({
      shield: 'anti-lag',
      kind: 'perf_recovered',
      severity: 'info',
      detail: `Frame rate recovered to ${this.fpsEma.toFixed(0)} fps.`,
      action: 'adaptive mode OFF — full visual effects restored',
    })
  }

  /* ---------- 2. long tasks ---------- */

  private installLongTaskObserver(): void {
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          this.longTasks++
          if (e.duration > this.worstTask) this.worstTask = Math.round(e.duration)
        }
      })
      this.observer.observe({ entryTypes: ['longtask'] })
    } catch {
      /* longtask not supported in this engine — fps + heap still cover it */
    }
  }

  /* ---------- 3. heap pressure ---------- */

  private heapTick(): void {
    const mem = (performance as unknown as { memory?: PerfMemory }).memory
    if (!mem) return
    this.heapMB = Math.round(mem.usedJSHeapSize / 1048576)
    // settle the baseline 30 s after boot
    if (!this.heapBaseline && Date.now() - this.bootedAt > 30_000) {
      this.heapBaseline = this.heapMB
      return
    }
    if (!this.heapBaseline) return
    const over = this.heapMB > Math.max(300, this.heapBaseline * 1.6)
    this.heapHighStreak = over ? this.heapHighStreak + 1 : 0
    if (this.heapHighStreak >= 6 && Date.now() - (this.lastReportAt.mem_pressure || 0) > 600_000) {
      this.lastReportAt.mem_pressure = Date.now()
      this.heapHighStreak = 0
      securityKernel.report({
        shield: 'anti-lag',
        kind: 'mem_pressure',
        severity: 'warn',
        detail: `JS heap has been sitting at ${this.heapMB} MB — ${(this.heapMB / Math.max(1, this.heapBaseline)).toFixed(1)}× the settled baseline of ${this.heapBaseline} MB.`,
        action: 'flagged — close unused windows or reboot from the Start menu',
      })
    }
  }

  /* ---------- lifecycle ---------- */

  start(): void {
    this.bootedAt = Date.now()
    this.raf = requestAnimationFrame(this.rafLoop)
    this.timers.push(chargedInterval('anti-lag', () => this.sampleFps(), 1_000))
    this.timers.push(chargedInterval('anti-lag', () => this.heapTick(), 5_000))
    this.installLongTaskObserver()
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.timers.forEach(clearInterval)
    this.timers = []
    this.observer?.disconnect()
    this.observer = null
    document.documentElement.removeAttribute('data-perf')
    this.engaged = false
  }

  /* ---------- introspection ---------- */

  stats(): Record<string, number> {
    return {
      fps: Math.round(this.fpsEma),
      heapMB: this.heapMB,
      longTasks: this.longTasks,
      engaged: this.engaged ? 1 : 0,
      engages: this.engageCount,
      worstTask: this.worstTask,
    }
  }

  async sweep(): Promise<KernelFinding[]> {
    const findings: KernelFinding[] = []
    findings.push({
      shield: 'anti-lag',
      check: 'frame rate (10 s EMA)',
      ok: this.fpsEma >= LOW_FPS,
      detail: `${this.fpsEma.toFixed(0)} fps average · last sample ${this.fps} fps`,
    })
    findings.push({
      shield: 'anti-lag',
      check: 'main-thread long tasks',
      ok: this.longTasks < 60,
      detail: `${this.longTasks} tasks over 50 ms · worst ${this.worstTask} ms`,
    })
    const mem = (performance as unknown as { memory?: PerfMemory }).memory
    findings.push({
      shield: 'anti-lag',
      check: 'heap pressure',
      ok: !mem || !this.heapBaseline || this.heapMB < Math.max(300, this.heapBaseline * 1.6),
      detail: mem ? `${this.heapMB} MB used · baseline ${this.heapBaseline || 'settling…'} MB` : 'performance.memory not exposed by this engine',
    })
    findings.push({
      shield: 'anti-lag',
      check: 'adaptive mode',
      ok: true,
      detail: this.engaged ? `ON — visuals reduced (${this.engageCount} engagements this session)` : 'OFF — full visual effects running',
    })
    return findings
  }
}

export const antiLag = new AntiLag()

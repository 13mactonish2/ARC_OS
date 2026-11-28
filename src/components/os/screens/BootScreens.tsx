// REDSEC v5.0 — RedSec loader menu + init boot / OS setup (30s)
// Task 66 — the boot is CUSTOMIZABLE: Settings ▸ Boot Loader stores up to 50
// custom boot lines + a custom title + custom colors in the OS store. When
// enabled, the boot log runs YOUR code (loader stage + progress bar included)
// instead of the stock boot.cfg log.
'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ShieldMark } from '../ShieldMark'
import { REDSEC, AV, LOADER_ENTRIES, BOOT_LINES } from '@/lib/os/redsec'
import { useOS } from '@/lib/os/store'

const SETUP_TASKS = [
  `Unpacking ${REDSEC.distro} packages (pkg install)…`,
  'Installing system drivers (sound, internet, sharing, GPU)…',
  'Applying security patches & anti-virus signatures…',
  'Configuring built-in apps (update-alternatives)…',
  'Building desktop layout (RedSecShell)…',
  'Updating boot loader & RedSec kernel modules…',
  'Finalizing…',
]

const LOADER_SECONDS = 3

/* Task 66 — resolve the boot plan: custom (Settings ▸ Boot Loader) or stock */
interface BootPlan {
  title: string
  lines: Array<[boolean, string]>
  okColor: string
  warnColor: string
  textColor: string
  accentColor: string
  showLoader: boolean
}
const STOCK_PLAN: BootPlan = {
  title: '',
  lines: BOOT_LINES,
  okColor: '#38bdf8',
  warnColor: '#fbbf24',
  textColor: '#cbd5e1',
  accentColor: '#38bdf8',
  showLoader: true,
}
function resolveBootPlan(): BootPlan {
  const c = useOS.getState().bootCustom
  if (!c || !c.enabled) return STOCK_PLAN
  const lines: Array<[boolean, string]> = c.lines.length
    ? c.lines.map((l) => [!l.trim().startsWith('..'), l] as [boolean, string])
    : STOCK_PLAN.lines
  return {
    title: c.title.trim(),
    lines,
    okColor: c.okColor || STOCK_PLAN.okColor,
    warnColor: c.warnColor || STOCK_PLAN.warnColor,
    textColor: c.textColor || STOCK_PLAN.textColor,
    accentColor: c.accentColor || STOCK_PLAN.accentColor,
    showLoader: c.showLoader !== false,
  }
}

export function BootScreen({ duration = 10, onDone }: { duration?: number; onDone: () => void }) {
  const [pct, setPct] = useState(0)
  const [countdown, setCountdown] = useState(LOADER_SECONDS)
  const doneRef = useRef(false)
  /* Task 66 — custom boot plan is resolved ONCE per boot (it is the code that
   * runs — editing it mid-boot would be like hot-patching the kernel) */
  const [plan] = useState<BootPlan>(() => resolveBootPlan())

  useEffect(() => {
    const start = Date.now()
    const t = setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / (duration * 1000)) * 100)
      setPct(p)
      const loaderLeft = Math.max(0, Math.ceil(LOADER_SECONDS - (Date.now() - start) / 1000))
      setCountdown(loaderLeft)
      if (p >= 100 && !doneRef.current) {
        doneRef.current = true
        clearInterval(t)
        setTimeout(onDone, 350)
      }
    }, 50)
    return () => clearInterval(t)
  }, [duration, onDone])

  /* stage 1 — RedSec loader menu (auto-boots the default entry) */
  if (pct < (LOADER_SECONDS / duration) * 100 && plan.showLoader) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-black font-mono text-[#aaaaaa] select-none" aria-label="RedSec loader boot menu">
        <div className="w-[640px] max-w-[92vw] border border-[#3a3a3a]">
          <div className="border-b border-[#3a3a3a] px-4 py-2 text-sm">REDSEC Loader&nbsp;&nbsp;({`loader.efi`} · native v{REDSEC.loader})</div>
          <div className="space-y-0.5 px-4 py-3 text-sm">
            {LOADER_ENTRIES.map((e, i) => (
              <div key={e.label} className={`flex items-center gap-2 px-1 py-0.5 ${e.primary ? 'bg-[#075985] text-white' : ''}`}>
                <span className="w-4">{e.primary ? '>' : ''}</span>
                <span>
                  {e.label}
                  {e.sub && <span className="ml-2 text-[11px] opacity-60">{e.sub}</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-[#3a3a3a] px-4 py-2 text-[11px] leading-relaxed text-[#888]">
            Use the ↑ and ↓ keys to select which entry is highlighted.
            <br />
            Press enter to boot the selected OS — auto-booting default in <span className="text-white">{countdown}s</span>…
          </div>
        </div>
        <div className="mt-6 text-[10px] tracking-widest text-[#555]">{REDSEC.distro.toUpperCase()} {REDSEC.version} • REDSEC NATIVE BASE • SECURE BOOT REDSEC-SIGNED</div>
      </div>
    )
  }

  /* stage 2 — microkernel + init boot log (stock boot.cfg or YOUR code) */
  const total = plan.lines.length
  const shown = Math.min(total, Math.floor(((pct - (LOADER_SECONDS / duration) * 100) / (100 - (LOADER_SECONDS / duration) * 100)) * total))
  return (
    <div
      className="flex h-screen w-screen flex-col bg-black font-mono text-[12.5px] leading-[1.45] select-none"
      style={{ color: plan.textColor }}
      aria-label="REDSEC boot log"
    >
      <div className="flex-1 overflow-hidden px-5 pt-5">
        <div className="text-slate-500">REDSEC Loader — booting &apos;{LOADER_ENTRIES[0].label}&apos;…</div>
        {plan.title && <div className="mb-1 font-semibold" style={{ color: plan.accentColor }}>{plan.title}</div>}
        {plan.lines.slice(0, shown).map(([ok, text], i) => (
          <div key={`${i}-${text}`} className="flex items-baseline gap-2">
            <span className="w-[76px] flex-none text-right" style={{ color: ok ? plan.okColor : plan.warnColor }}>
              [{ok ? ' DONE ' : '  ..  '}]
            </span>
            <span style={{ color: plan.textColor }}>{text}</span>
          </div>
        ))}
        {shown >= total && (
          <div className="mt-1 flex items-baseline gap-2">
            <span className="w-[76px] flex-none text-right" style={{ color: plan.okColor }}>[ DONE ]</span>
            <span style={{ color: plan.okColor }}>
              {plan.title || `Welcome to ${REDSEC.distro} ${REDSEC.version} (REDSEC Native kernel ${REDSEC.qnxVersion})!`}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-4 pb-6">
        <div className="h-1 w-56 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full transition-all duration-100" style={{ width: `${pct}%`, background: plan.accentColor }} />
        </div>
        <div className="text-[10px] text-slate-600">
          {REDSEC.distro} {REDSEC.version} • {REDSEC.kernel}
        </div>
      </div>
    </div>
  )
}

/* ---------- Task 69 — POWER SEQUENCES ----------
   The fake service log every power action plays first:
   • shutdown → 30 codes: 20 [ DONE ] + 10 [ ERROR ]   (shutdown codes)
   • restart  → 30 codes: 20 [ DONE ] shutdown codes + 10 [ ERROR ] restart codes
   After the log: shutdown lands on the off screen, restart replays the boot. */

const SHUTDOWN_DONE: string[] = [
  'systemd-logind: stopping user session for owner…',
  'Saving desktop session state (icons · pins · wallpaper)…',
  'Flushing package database to /var/lib/pkg/db',
  'Syncing file systems (vxrfs · ext4)…',
  'Preserving user vault (SecureStore · AES-256-GCM)…',
  `Stopping ${AV.product.toLowerCase()} real-time protection…`,
  'Stopping network manager (netd)…',
  'Closing 12 open sockets on eth0',
  'Stopping container runtime (redsec-containers)',
  'Killing remaining user processes (7 stopped)',
  'Stopping audio daemon (sndio)…',
  'Stopping GPU compositor (vxr-compositor)',
  'Detaching loop devices (4 released)',
  'Deactivating swap /dev/vxr2',
  'Unmounting /home/owner…',
  'Unmounting /boot/efi (loader.efi)…',
  'Writing shutdown journal (30 entries)',
  'Stopping cron daemon (crond)',
  'Saving thermal + battery state to NVRAM',
  'Sending SIGTERM to all processes',
]

const SHUTDOWN_ERR: string[] = [
  'umount: /dev/vxr1: target is busy — forced after 3 tries',
  'velikan.service: kill (pid 1284) not permitted — SIGKILL sent',
  'netd: 2 sockets refused to close (leaked fd 17, 23)',
  'watchdog: no ack within 500ms — proceeding anyway',
  'journald: log rotation failed (disk busy) — kept in memory',
  'swapoff: /dev/vxr2 timeout — swap left active',
  'crond: job "nightly-scan" missed its window',
  'sndio: sink "analog-stereo" busy — 1 stream dropped',
  'tmpfs: /tmp not fully drained (3 stale handles)',
  'powerd: battery query failed (-1) — assuming AC power',
]

const RESTART_ERR: string[] = [
  'init: re-exec /sbin/init failed once — retrying (1/3)',
  'kexec: kernel signature check skipped (REDSEC-SIGNED)',
  'initrd: rebuilding initramfs on the fly…',
  'loader.efi: boot entry #2 marked stale — using default',
  'module vxr_gpu: refcount not zero — force-unloading',
  'netd: renewing DHCP lease on warm boot…',
  'fsck: deferred — journal replay on next mount',
  'ntp: clock skew +2.1s detected — resync queued',
  'redsec-boot: fast-restart path taken (warm boot)',
  'init: session restore skipped — starting fresh desktop',
]

export function PowerSeqScreen({ mode, onDone }: { mode: 'shutdown' | 'restart'; onDone: () => void }) {
  /* the plan is frozen once per run — like the boot log, hot-editing the
     service list mid-halt would be like rewriting init while it runs */
  const lines = useMemo<Array<[boolean, string]>>(() => {
    const done = SHUTDOWN_DONE.map((t) => [true, t] as [boolean, string])
    const errs = (mode === 'shutdown' ? SHUTDOWN_ERR : RESTART_ERR).map((t) => [false, t] as [boolean, string])
    return [...done, ...errs]
  }, [mode])
  const [shown, setShown] = useState(0)
  const doneRef = useRef(false)

  /* reveal one service code every 80ms — 30 codes ≈ 2.4s */
  useEffect(() => {
    const t = setInterval(() => {
      setShown((s) => {
        if (s >= lines.length) {
          clearInterval(t)
          return s
        }
        return s + 1
      })
    }, 80)
    return () => clearInterval(t)
  }, [lines.length])

  /* hold the finished log for a beat, then hand over (off screen / boot) */
  useEffect(() => {
    if (shown >= lines.length && !doneRef.current) {
      doneRef.current = true
      const t = setTimeout(onDone, 1000)
      return () => clearTimeout(t)
    }
  }, [shown, lines.length, onDone])

  const pct = Math.min(100, (shown / lines.length) * 100)
  const accent = mode === 'shutdown' ? '#fbbf24' : '#38bdf8'
  const finished = shown >= lines.length

  return (
    <div
      className="flex h-screen w-screen flex-col bg-black font-mono text-[12.5px] leading-[1.45] select-none"
      style={{ color: '#cbd5e1' }}
      aria-label={mode === 'shutdown' ? 'REDSEC shutdown service log' : 'REDSEC restart service log'}
    >
      <div className="flex-1 overflow-hidden px-5 pt-5">
        <div className="text-slate-500">
          {mode === 'shutdown' ? 'REDSEC v7.0 — system halt requested (poweroff)' : 'REDSEC v7.0 — restart requested (reboot)'}
        </div>
        <div className="mb-1 font-semibold" style={{ color: accent }}>
          {mode === 'shutdown'
            ? `Stopping ${REDSEC.distro} ${REDSEC.version} “${REDSEC.codename}”…`
            : `Restarting ${REDSEC.distro} ${REDSEC.version} “${REDSEC.codename}”…`}
        </div>
        {lines.slice(0, shown).map(([ok, text], i) => (
          <div key={`${i}-${text}`} className="flex items-baseline gap-2">
            <span className="w-[86px] flex-none text-right" style={{ color: ok ? '#4ade80' : '#f87171' }}>
              [{ok ? ' DONE ' : ' ERROR '}]
            </span>
            <span style={{ color: '#cbd5e1' }}>{text}</span>
          </div>
        ))}
        {finished && (
          <div className="mt-1 flex items-baseline gap-2">
            <span className="w-[86px] flex-none text-right" style={{ color: accent }}>[&nbsp;OK&nbsp;&nbsp;]</span>
            <span style={{ color: accent }}>
              {mode === 'shutdown' ? 'System halted — it is now safe to power off.' : 'Warm boot handed to loader.efi — rebooting…'}
            </span>
          </div>
        )}
        {!finished && <span className="mt-1 inline-block h-4 w-2.5 animate-pulse bg-slate-300" />}
      </div>
      <div className="flex items-center justify-center gap-4 pb-6">
        <div className="h-1 w-56 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full transition-all duration-100" style={{ width: `${pct}%`, background: accent }} />
        </div>
        <div className="text-[10px] text-slate-600">
          {REDSEC.distro} {REDSEC.version} • {REDSEC.kernel} • {mode === 'shutdown' ? 'SYSTEM HALT' : 'SYSTEM RESTART'}
        </div>
      </div>
    </div>
  )
}

export function OsSetupScreen({ duration = 30, onDone }: { duration?: number; onDone: () => void }) {
  const [pct, setPct] = useState(0)
  const [sec, setSec] = useState(duration)
  const doneRef = useRef(false)

  useEffect(() => {
    const start = Date.now()
    const t = setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / (duration * 1000)) * 100)
      setPct(p)
      setSec(Math.ceil((duration * 1000 - (Date.now() - start)) / 1000))
      if (p >= 100 && !doneRef.current) {
        doneRef.current = true
        clearInterval(t)
        setTimeout(onDone, 400)
      }
    }, 100)
    return () => clearInterval(t)
  }, [duration, onDone])

  const taskIdx = Math.min(SETUP_TASKS.length - 1, Math.floor((pct / 100) * SETUP_TASKS.length))

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-gradient-to-b from-[#0a1120] to-[#05070c] text-slate-200 select-none">
      <ShieldMark size={84} />
      <div className="mt-6 text-xl font-semibold text-slate-100">Setting up {REDSEC.distro} {REDSEC.version}</div>
      <div className="mt-1 text-sm text-slate-500">REDSEC Native base — your OS is being configured</div>

      <div className="mt-8 h-2 w-[420px] max-w-[86vw] overflow-hidden rounded-full bg-white/8">
        <div className="h-full rounded-full bg-gradient-to-r from-sky-400 via-teal-400 to-cyan-300 transition-all duration-200" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex w-[420px] max-w-[86vw] justify-between font-mono text-[11px] text-slate-500">
        <span>{Math.round(pct)}%</span>
        <span>{sec}s remaining</span>
      </div>

      <div className="mt-8 space-y-2.5">
        {SETUP_TASKS.map((task, i) => (
          <div key={task} className={`flex items-center gap-2.5 text-sm transition-all ${i < taskIdx ? 'text-sky-400' : i === taskIdx ? 'text-slate-100' : 'text-slate-600'}`}>
            {i < taskIdx ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/20 text-[11px] text-sky-400">✓</span>
            ) : i === taskIdx ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            ) : (
              <span className="h-5 w-5 rounded-full border border-white/15" />
            )}
            {task}
          </div>
        ))}
      </div>
      <div className="absolute bottom-6 text-[11px] text-slate-600">Don&apos;t turn off your computer — pkg is working · {AV.product} signatures applied</div>
    </div>
  )
}

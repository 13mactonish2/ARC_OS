// REDSEC 5.0 — Task Manager (live processes, End-task control)
'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Activity, AppWindow, ArrowDown, ArrowUp, Cpu, MemoryStick, ShieldCheck, Timer, X } from 'lucide-react'
import { AppShell, Toolbar } from './_shared'
import { useOS, APP_META } from '@/lib/os/store'
import { securityKernel, type ShieldId } from '@/lib/os/security'
import type { AppProps, WinState } from '@/lib/os/types'

/* ---------- simulated per-process metrics (stable per row, slow sine + jitter) ---------- */

/** seed derived from the char codes of a window id */
function seedOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h += id.charCodeAt(i)
  return h
}

/** app CPU% — base 0.5–18% seeded by id, oscillating with a slow sine + small jitter */
function appCpu(seed: number, tick: number): number {
  const base = 0.5 + (seed % 1700) / 100 // 0.5 … 17.5
  const osc = Math.sin(tick / 5 + (seed % 13)) * base * 0.35
  const jit = (Math.random() - 0.5) * 0.6
  return Math.round(Math.min(18, Math.max(0.5, base + osc + jit)) * 10) / 10
}

/** app Memory MB — stable-ish per row (80–420MB) with a gentle wobble */
function appMem(seed: number, tick: number): number {
  const base = 80 + (seed % 341) // 80 … 420
  const wobble = Math.sin(tick / 7 + (seed % 7)) * 4
  return Math.round(Math.min(420, Math.max(80, base + wobble)))
}

interface SysProc {
  name: string
  cpu: number
  mem: number
}

/** static system processes — End task is refused with a "Permission denied" toast */
const SYS_PROCS: SysProc[] = [
  { name: 'velikan.service', cpu: 1.8, mem: 96 }, // the Velikan anti-virus
  { name: 'redsec-wm', cpu: 2.1, mem: 88 },
  { name: 'systemd(1)', cpu: 0.1, mem: 12 },
  { name: 'pulseaudio', cpu: 0.5, mem: 34 },
  { name: 'NetworkManager', cpu: 0.3, mem: 22 },
  { name: 'redsec-desktop', cpu: 1.1, mem: 64 },
]

interface ProcRow {
  key: string
  name: string
  cpu: number
  mem: number
  kind: 'app' | 'sys' | 'kernel'
  color?: string
  winId?: string
  shield?: ShieldId
}

function fmtUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s` : m > 0 ? `${m}m ${String(ss).padStart(2, '0')}s` : `${ss}s`
}

function StatCard({ icon, label, value, tone = 'slate' }: { icon: React.ReactNode; label: string; value: string; tone?: 'rose' | 'slate' }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#161b28] p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <span className={tone === 'rose' ? 'text-rose-400' : 'text-slate-400'}>{icon}</span>
        {label}
      </div>
      <div className={`mt-1 font-mono text-lg font-semibold ${tone === 'rose' ? 'text-rose-300' : 'text-slate-100'}`}>{value}</div>
    </div>
  )
}

export default function TaskManagerApp({ winId, args: _args }: AppProps) {
  const windows = useOS((s) => s.windows)
  const sessionStart = useOS((s) => s.sessionStart)
  const kSnap = useSyncExternalStore(securityKernel.subscribe, securityKernel.getSnapshot)
  const [tick, setTick] = useState(0)
  const [cpuAsc, setCpuAsc] = useState(false)

  /* 1s refresh interval — cleaned up on unmount */
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const rows = useMemo<ProcRow[]>(() => {
    const list: ProcRow[] = windows.map((w: WinState) => {
      const seed = seedOf(w.id)
      return {
        key: w.id,
        name: APP_META[w.appId]?.name ?? w.appId,
        cpu: appCpu(seed, tick),
        mem: appMem(seed, tick),
        kind: 'app',
        color: APP_META[w.appId]?.color ?? '#64748b',
        winId: w.id,
      }
    })
    SYS_PROCS.forEach((p, i) => {
      list.push({
        key: p.name,
        name: p.name,
        cpu: Math.round(Math.max(0.1, p.cpu + Math.sin(tick / 4 + i * 1.7) * 0.15) * 10) / 10,
        mem: p.mem,
        kind: 'sys',
      })
    })
    // REDSEC Kernel Guard daemons — real measured CPU (ms worked / window) and
    // heap-share memory from the live security kernel, not simulated numbers
    if (kSnap.started) {
      for (const m of securityKernel.modules) {
        const { cpu, mem } = securityKernel.procStats(m.id)
        list.push({ key: m.id, name: `redsec-${m.id}.service`, cpu: Math.max(0.1, cpu), mem, kind: 'kernel', shield: m.id })
      }
    }
    return list
  }, [windows, tick, kSnap])

  const sorted = useMemo(() => [...rows].sort((a, b) => (cpuAsc ? a.cpu - b.cpu : b.cpu - a.cpu)), [rows, cpuAsc])

  const totalCpu = Math.min(99.9, rows.reduce((a, r) => a + r.cpu, 0))
  const totalMem = Math.round(rows.reduce((a, r) => a + r.mem, 0))

  const endTask = (row: ProcRow) => {
    if (row.kind === 'app' && row.winId) {
      useOS.getState().closeWindow(row.winId)
      useOS.getState().notify({ title: `✅ Ended ${row.name}`, body: `${row.name} window closed`, kind: 'success' })
    } else {
      useOS.getState().notify({
        title: 'Permission denied',
        body: `${row.name.replace(/\.service$/, '')} is a protected system process`,
        kind: 'error',
      })
    }
  }

  return (
    <AppShell>
      <Toolbar>
        <Activity className="h-4 w-4 text-rose-400" />
        <span className="text-xs font-semibold text-slate-100">Task Manager</span>
        <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-rose-300">
          REDSEC Task Manager 5.0
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" /> live · 1s
        </span>
      </Toolbar>

      {/* ---- summary cards ---- */}
      <div className="grid flex-none grid-cols-2 gap-2 p-3 lg:grid-cols-4">
        <StatCard icon={<Cpu className="h-3.5 w-3.5" />} label="CPU" value={`${totalCpu.toFixed(1)}%`} tone="rose" />
        <StatCard icon={<MemoryStick className="h-3.5 w-3.5" />} label="Memory" value={`${totalMem.toLocaleString()} MB`} />
        <StatCard icon={<AppWindow className="h-3.5 w-3.5" />} label="Running apps" value={String(windows.length)} />
        <StatCard icon={<Timer className="h-3.5 w-3.5" />} label="Uptime" value={fmtUptime(Date.now() - sessionStart)} />
      </div>

      {/* ---- processes table ---- */}
      <div className="os-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="sticky top-0 z-10 border-b border-white/10 bg-[#10141f] px-2 py-2 font-semibold">Process</th>
              <th className="sticky top-0 z-10 border-b border-white/10 bg-[#10141f] px-2 py-2 font-semibold">
                <button
                  type="button"
                  onClick={() => setCpuAsc((v) => !v)}
                  title="Sort by CPU"
                  className="flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-rose-300"
                >
                  CPU {cpuAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                </button>
              </th>
              <th className="sticky top-0 z-10 border-b border-white/10 bg-[#10141f] px-2 py-2 font-semibold">Memory</th>
              <th className="sticky top-0 z-10 border-b border-white/10 bg-[#10141f] px-2 py-2 font-semibold">Status</th>
              <th className="sticky top-0 z-10 border-b border-white/10 bg-[#10141f] px-2 py-2 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key} className="border-b border-white/5 hover:bg-white/[0.03]">
                <td className="border-b border-white/5 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    {r.kind === 'app' ? (
                      <span className="h-2 w-2 flex-none rounded-full" style={{ background: r.color }} />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5 flex-none text-rose-400" />
                    )}
                    <span className="truncate font-mono text-[11px] text-slate-200">{r.name}</span>
                    {r.winId === winId && <span className="flex-none rounded bg-rose-500/15 px-1 text-[9px] text-rose-300">this window</span>}
                  </div>
                </td>
                <td className="border-b border-white/5 px-2 py-1.5 font-mono text-slate-300">{r.cpu.toFixed(1)}%</td>
                <td className="border-b border-white/5 px-2 py-1.5 font-mono text-slate-300">{r.mem} MB</td>
                <td className="border-b border-white/5 px-2 py-1.5">
                  {r.kind === 'kernel' && r.shield ? (
                    <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-300" title={securityKernel.modules.find((m) => m.id === r.shield)?.desc}>
                      <ShieldCheck className="h-2.5 w-2.5" /> Kernel
                    </span>
                  ) : r.kind === 'sys' ? (
                    <span className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-300">
                      <ShieldCheck className="h-2.5 w-2.5" /> System
                    </span>
                  ) : (
                    <span className="text-[11px] text-sky-400">Running</span>
                  )}
                </td>
                <td className="border-b border-white/5 px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => endTask(r)}
                    title={r.kind === 'sys' ? 'Protected system process' : `End ${r.name}`}
                    className="inline-flex h-6 items-center gap-1 rounded-md bg-white/5 px-2 text-[10px] text-slate-300 transition-colors hover:bg-rose-600/80 hover:text-white"
                  >
                    <X className="h-3 w-3" /> End task
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- footer ---- */}
      <div className="flex flex-none items-center justify-between border-t border-white/10 bg-[#0e1320] px-3 py-1.5 text-[10px] text-slate-500">
        <span>REDSEC Task Manager 5.0 · {rows.length} processes</span>
        <span className="font-mono">
          {securityKernel.booted ? `${securityKernel.modules.length} kernel · ` : ''}{SYS_PROCS.length} system · {rows.filter((r) => r.kind === 'app').length} apps
        </span>
      </div>
    </AppShell>
  )
}

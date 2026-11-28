// REDSEC 5.0 — Backup Center (one-click OS backup & restore)
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DatabaseBackup, HardDriveDownload, Upload, CheckCircle2, FileText, HardDrive, Clock, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react'
import { AppShell, Toolbar, TBtn, fmtBytes } from './_shared'
import { fs } from '@/lib/os/fs'
import { useOS } from '@/lib/os/store'
import { backupDue, exportBackupZip, restoreBackupZip, applyBackupSettings, lastBackupAt, markBackupDone } from '@/lib/os/backup'
import type { AppProps } from '@/lib/os/types'

interface RestoreDone {
  restored: number
  settings: boolean
  warn?: string
}

export default function BackupCenterApp({ winId, args }: AppProps) {
  const [files, setFiles] = useState(0)
  const [used, setUsed] = useState(0)
  const [last, setLast] = useState(0)
  const [due, setDue] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [done, setDone] = useState<RestoreDone | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    setFiles(fs.fileCount())
    setUsed(fs.usedSize())
    setLast(lastBackupAt())
    setDue(backupDue())
  }, [])

  useEffect(() => {
    void fs.load().then(refresh)
  }, [refresh])

  const notify = useCallback((title: string, body: string, kind: 'success' | 'error' | 'info', emoji: string) => {
    useOS.getState().notify({ title, body, kind, emoji })
  }, [])

  /* ---------- back up now ---------- */
  const backupNow = useCallback(async () => {
    if (backingUp || restoring) return
    setBackingUp(true)
    try {
      const blob = await exportBackupZip()
      const name = `REDSEC5-Backup-${new Date().toISOString().slice(0, 10)}.zip`
      const u = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = u
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(u), 8000)
      markBackupDone()
      refresh()
      notify('Backup complete', `${name} · ${fmtBytes(blob.size)} downloaded`, 'success', '🛡️')
    } catch (e) {
      notify('Backup failed', e instanceof Error ? e.message : 'Could not build the backup archive', 'error', '🛡️')
    } finally {
      setBackingUp(false)
    }
  }, [backingUp, restoring, refresh, notify])

  /* ---------- restore ---------- */
  const onPickFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = '' // allow re-picking the same file later
      if (!file || restoring) return
      setRestoring(true)
      try {
        const res = await restoreBackupZip(file)
        if (!res.ok) {
          notify('Restore failed', res.error || 'Not a valid REDSEC 5.0 backup', 'error', '⚠️')
          return
        }
        if (res.data) applyBackupSettings(res.data) // safe persisted fields only (wallpaper, username, apps…)
        if (res.error) notify('Restore finished with warnings', res.error, 'info', '⚠️')
        setDone({ restored: res.restored, settings: res.settings, warn: res.error })
      } catch (err) {
        notify('Restore failed', err instanceof Error ? err.message : 'Unknown error while restoring', 'error', '⚠️')
      } finally {
        setRestoring(false)
      }
    },
    [restoring, notify]
  )

  const fmtDate = (t: number) => (t ? new Date(t).toLocaleString() : 'Never')

  return (
    <AppShell className="relative">
      <Toolbar>
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
          <DatabaseBackup className="h-4 w-4 text-rose-400" /> Backup Center
        </div>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-400">store-only ZIP · offline</span>
        <div className="ml-auto">
          <TBtn onClick={() => void backupNow()} disabled={backingUp || restoring} title="Export a full OS backup as a ZIP download">
            {backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />} {backingUp ? 'Packing…' : 'Back up now'}
          </TBtn>
        </div>
      </Toolbar>

      <div className="os-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 p-4">
          {/* ---------- status cards ---------- */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/10 bg-[#161b28] p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <FileText className="h-3.5 w-3.5 text-emerald-400" /> Files
              </div>
              <div className="mt-1 text-xl font-bold text-slate-100">{files}</div>
              <div className="text-[10px] text-slate-500">in the virtual FS</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#161b28] p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <HardDrive className="h-3.5 w-3.5 text-rose-400" /> Space used
              </div>
              <div className="mt-1 text-xl font-bold text-slate-100">{fmtBytes(used)}</div>
              <div className="text-[10px] text-slate-500">file blobs on disk</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#161b28] p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <Clock className="h-3.5 w-3.5 text-emerald-400" /> Last backup
              </div>
              <div className="mt-1 truncate text-sm font-bold text-slate-100" title={fmtDate(last)}>{fmtDate(last)}</div>
              <div className="text-[10px] text-slate-500">{last ? 'local ZIP download' : 'no backup yet'}</div>
            </div>
          </div>

          {/* ---------- weekly reminder ---------- */}
          {due && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 flex-none text-rose-400" />
              <div className="min-w-0 flex-1 text-xs text-rose-200">
                <span className="font-semibold">Weekly reminder:</span> last backup over a week ago — keep a fresh copy of your OS.
              </div>
              <button
                type="button"
                onClick={() => void backupNow()}
                disabled={backingUp || restoring}
                className="flex h-7 flex-none items-center gap-1.5 rounded-md bg-rose-600/80 px-2.5 text-xs font-medium text-white transition-all hover:bg-rose-500 disabled:opacity-40"
              >
                <HardDriveDownload className="h-3.5 w-3.5" /> Back up now
              </button>
            </div>
          )}

          {/* ---------- backup card ---------- */}
          <section className="overflow-hidden rounded-xl border border-white/10 bg-[#161b28]">
            <header className="flex items-center gap-2 border-b border-white/10 bg-emerald-600/10 px-4 py-2.5">
              <HardDriveDownload className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-slate-100">Full OS backup</h2>
            </header>
            <div className="space-y-3 p-4">
              <p className="text-xs leading-relaxed text-slate-400">
                Packs your entire system into a single <code className="rounded bg-black/40 px-1 text-emerald-300">REDSEC5-Backup-&lt;date&gt;.zip</code> and downloads it to your real computer. The archive is store-only (uncompressed) so it can be restored byte-perfect without any extra tooling.
              </p>
              <ul className="space-y-1 text-[11px] leading-relaxed text-slate-500">
                <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 flex-none text-emerald-500" /> Every file &amp; folder — Documents, Photos, Downloads, Bin and the REDSEC system trees /etc /usr /var /tmp /opt</li>
                <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 flex-none text-emerald-500" /> Personal settings — username, wallpaper, theme, taskbar, network, volume, drivers</li>
                <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 flex-none text-emerald-500" /> Installed apps, OS updates and Shield settings (auto-scan + notification preferences)</li>
              </ul>
              <button
                type="button"
                onClick={() => void backupNow()}
                disabled={backingUp || restoring}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-semibold text-white transition-all hover:bg-emerald-500 disabled:opacity-40 sm:w-auto sm:px-5"
              >
                {backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />}
                {backingUp ? 'Packing backup…' : 'Back up now'}
              </button>
            </div>
          </section>

          {/* ---------- restore card ---------- */}
          <section className="overflow-hidden rounded-xl border border-white/10 bg-[#161b28]">
            <header className="flex items-center gap-2 border-b border-white/10 bg-rose-600/10 px-4 py-2.5">
              <ShieldCheck className="h-4 w-4 text-rose-400" />
              <h2 className="text-sm font-semibold text-slate-100">Restore from backup</h2>
            </header>
            <div className="space-y-3 p-4">
              <p className="text-xs leading-relaxed text-slate-400">
                Pick a Backup Center ZIP to replace this system&apos;s files and settings with the archived copy. Restoring is all-or-nothing — anything created after the backup is gone, and the OS reloads once the data is written.
              </p>
              <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => void onPickFile(e)} aria-label="Backup archive" />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={backingUp || restoring}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-rose-500/40 bg-rose-600/20 text-sm font-semibold text-rose-200 transition-all hover:bg-rose-600/30 disabled:opacity-40 sm:w-auto sm:px-5"
              >
                {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {restoring ? 'Restoring…' : 'Choose backup ZIP…'}
              </button>
              <p className="text-[10px] leading-relaxed text-slate-600">
                A backup includes: all files &amp; folders, personal settings, installed web apps, OS updates and Shield settings. Open windows and other running state are intentionally not part of a backup.
              </p>
            </div>
          </section>
        </div>
      </div>

      {/* ---------- restore-complete modal ---------- */}
      {done && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#161b28] p-5 text-center shadow-2xl">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600/20">
              <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            </div>
            <h3 className="text-base font-semibold text-slate-100">Restore complete</h3>
            <p className="mt-1 text-xs text-slate-400">
              {done.restored} file blob{done.restored === 1 ? '' : 's'} written{done.settings ? ' · settings restored' : ' · no settings in archive'}.
              Reload to load the restored system.
            </p>
            {done.warn && (
              <p className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-300" title={done.warn}>
                ⚠ {done.warn}
              </p>
            )}
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => location.reload()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                Reload now
              </button>
              <button
                type="button"
                onClick={() => setDone(null)}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/20"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}

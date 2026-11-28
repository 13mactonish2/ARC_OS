// REDSEC v5.0 — Storage plans (Task 45)
// All tiers are free and selectable — the old live-QR + 6-digit vault gate was
// removed by request. StorageTierCards is shared by Settings ▸ Storage.
'use client'

import React from 'react'
import { HardDrive } from 'lucide-react'
import { useOS } from '@/lib/os/store'

/** the three storage plans (50 / 100 / 150 GB — all free) */
export type StorageTier = 50 | 100 | 150

export function StorageTierCards({ picked, onPick, compact }: { picked: 50 | 100 | 150; onPick: (t: 50 | 100 | 150) => void; compact?: boolean }) {
  const tiers: Array<{ gb: 50 | 100 | 150; name: string; blurb: string }> = [
    { gb: 50, name: 'Starter', blurb: 'Every core feature — free forever, no card, no catch.' },
    { gb: 100, name: 'Vault', blurb: 'Double the space for documents, media and installed apps.' },
    { gb: 150, name: 'Fortress', blurb: 'The full vault — maximum room for everything you keep on the OS.' },
  ]

  return (
    <div className={compact ? 'space-y-2' : 'grid gap-3 sm:grid-cols-3'}>
      {tiers.map((t) => {
        const active = picked === t.gb
        return (
          <div
            key={t.gb}
            className={`relative flex flex-col rounded-xl border p-3.5 text-left transition-all ${
              active ? 'border-sky-400 bg-sky-400/10 shadow-[0_0_24px_rgba(14,165,233,0.12)]' : 'border-white/10 bg-white/[0.04] hover:border-white/25'
            } ${compact ? '' : 'min-h-[132px]'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-lg font-extrabold tracking-tight text-slate-100">{t.gb} GB</span>
              <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${active ? 'bg-sky-500/20 text-sky-300' : 'bg-white/8 text-slate-400'}`}>
                {active ? 'ACTIVE' : 'FREE'}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.name}</div>
            <p className="mt-1.5 flex-1 text-[11px] leading-relaxed text-slate-400">{t.blurb}</p>
            <button
              type="button"
              onClick={() => onPick(t.gb)}
              aria-label={`Use the ${t.gb} GB storage plan`}
              className={`mt-2.5 flex h-8 items-center justify-center gap-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                active ? 'bg-sky-500 text-black' : 'bg-white/8 text-slate-100 hover:bg-white/15'
              }`}
            >
              {active ? (
                '✓ Selected'
              ) : (
                <>
                  <HardDrive className="h-3.5 w-3.5" /> Use {t.gb} GB
                </>
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** convenience hook — the active tier, for any surface that needs it */
export function useStorageTier(): 50 | 100 | 150 {
  return useOS((s) => s.storageTier)
}

// REDSEC v5.0 — App icons (built-in lucide + installed app icons + custom skin images)
'use client'

import React from 'react'
import * as Icons from 'lucide-react'
import { APP_META, useOS } from '@/lib/os/store'
import { useSkinUrl } from '@/lib/os/skin'
import { BRAND_LOGOS } from './Logos'

const ICONS: Record<string, string> = {
  FolderOpen: 'FolderOpen',
  Globe: 'Globe',
  Youtube: 'Youtube',
  BookOpen: 'BookOpen',
  Newspaper: 'Newspaper',
  Gamepad2: 'Gamepad2',
  ImagePlus: 'ImagePlus',
  Palette: 'Palette',
  Store: 'Store',
  Table: 'Table',
  FileText: 'FileText',
  Presentation: 'Presentation',
  NotebookPen: 'NotebookPen',
  Settings: 'Settings',
  Calculator: 'Calculator',
  Sparkles: 'Sparkles',
  Code2: 'Code2',
  Camera: 'Camera',
  Map: 'Map',
  Satellite: 'Satellite',
  Music: 'Music',
  TerminalSquare: 'SquareTerminal',
  CloudSun: 'CloudSun',
  MonitorPlay: 'MonitorPlay',
  Ruler: 'Ruler',
  Gauge: 'Gauge',
  File: 'File',
  Mic: 'Mic',
  LineChart: 'LineChart',
  Shield: 'Shield',
  Image: 'Image',
  Trash2: 'Trash2',
  Folder: 'Folder',
  Link: 'Link',
  Puzzle: 'Puzzle',
  /* REDSEC 5.0 */
  ShieldCheck: 'ShieldCheck',
  Globe2: 'Globe2',
  Activity: 'Activity',
  DatabaseBackup: 'DatabaseBackup',
  Rocket: 'Rocket',
  MessageSquareText: 'MessageSquareText',
  Bug: 'Bug',
  /* REDSEC 7.0 "Black Sea" */
  Wrench: 'Wrench',
}

export function AppIcon({ appId, size = 20 }: { appId: string; size?: number }) {
  const installedApps = useOS((s) => s.installedApps)
  /* custom skin image — right-click an app icon → "Customize icon image" (persisted forever) */
  const customId = useOS((s) => (appId ? s.customIconIds[appId] : undefined))
  const customUrl = useSkinUrl(customId)
  if (customUrl) {
    return (
      <span
        className="relative inline-flex flex-none items-center justify-center overflow-hidden rounded-[24%] bg-black/40"
        style={{ width: size, height: size, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16), 0 1px 3px rgba(0,0,0,0.45)' }}
      >
        <img src={customUrl} alt="" width={size} height={size} className="h-full w-full object-cover" />
      </span>
    )
  }
  if (appId.startsWith('inst:')) {
    const inst = installedApps.find((a) => a.id === appId.slice(5))
    const color = inst?.color || '#14b8a6'
    const label = inst?.name || 'App'
    if (inst?.iconUrl) {
      return (
        <span className="inline-flex flex-none items-center justify-center overflow-hidden rounded-md bg-white" style={{ width: size, height: size }}>
          <img src={inst.iconUrl} alt={label} width={size} height={size} className="h-full w-full object-cover" />
        </span>
      )
    }
    return (
      <span
        className="inline-flex flex-none items-center justify-center rounded-md font-bold text-white"
        style={{ width: size, height: size, background: `linear-gradient(135deg, ${color}, ${color}88)`, fontSize: size * 0.55 }}
      >
        {label.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  const meta = APP_META[appId]
  const color = meta?.color || '#14b8a6'
  const Brand = BRAND_LOGOS[appId]
  return (
    <span
      className="relative inline-flex flex-none items-center justify-center overflow-hidden rounded-[24%]"
      style={{
        width: size,
        height: size,
        background: Brand
          ? `linear-gradient(145deg, ${color}55, ${color}20 55%, ${color}33)`
          : `linear-gradient(145deg, ${color}40, ${color}16 55%, ${color}2b)`,
        boxShadow: `inset 0 0 0 1px ${color}45, inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 3px rgba(0,0,0,0.45)`,
      }}
    >
      <span style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.45))', display: 'inline-flex' }}>
        {Brand ? (
          <Brand size={Math.round(size * 0.78)} />
        ) : (
          (() => {
            const iconName = ICONS[meta?.icon || 'Globe'] || 'Globe'
            const IconCmp = (Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>>)[iconName] || Icons.Globe
            return <IconCmp size={Math.round(size * 0.7)} color={color} strokeWidth={2.1} />
          })()
        )}
      </span>
      {/* glass sheen */}
      <span
        className="pointer-events-none absolute inset-0"
        style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.16), rgba(255,255,255,0) 42%)' }}
      />
    </span>
  )
}

export function getIconColor(appId: string): string {
  if (appId.startsWith('inst:')) return '#14b8a6'
  return APP_META[appId]?.color || '#14b8a6'
}

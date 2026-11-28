// REDSEC 5.0 — App registry (dynamic imports, code-split)
'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import { SuiteGuard } from './apps/SuiteGuard'
import type { SuiteAppId } from '@/lib/os/suite'

const loading = () => <div className="flex h-full items-center justify-center text-xs text-slate-500">Loading app…</div>

type AppCmp = ComponentType<{ winId: string; args?: Record<string, unknown> }>

/** Open Suite apps load through the activation gate (5-min demo → packs) */
function suite(app: SuiteAppId, loader: () => Promise<{ default: AppCmp }>): AppCmp {
  const Inner = dynamic(loader, { loading, ssr: false })
  const Host = (props: { winId: string; args?: Record<string, unknown> }) => (
    <SuiteGuard app={app}>
      <Inner {...props} />
    </SuiteGuard>
  )
  return Host
}

export const APP_COMPONENTS: Record<string, ComponentType<{ winId: string; args?: Record<string, unknown> }>> = {
  filemanager: dynamic(() => import('./apps/FileExplorer'), { loading, ssr: false }),
  browser: dynamic(() => import('./apps/Browser'), { loading, ssr: false }),
  youtube: suite('youtube', () => import('./apps/YouTubeApp')),
  dictionary: dynamic(() => import('./apps/DictionaryApp'), { loading, ssr: false }),
  news: dynamic(() => import('./apps/NewsApp'), { loading, ssr: false }),
  gaming: dynamic(() => import('./apps/GamingHub'), { loading, ssr: false }),
  photoeditor: dynamic(() => import('./apps/PhotoEditorApp'), { loading, ssr: false }),
  /* ---- M/Ø — kdenlive-class timeline video editor ---- */
  mvideo: dynamic(() => import('./apps/MVideoApp'), { loading, ssr: false }),
  paint: dynamic(() => import('./apps/PaintApp'), { loading, ssr: false }),
  appstore: dynamic(() => import('./apps/AppStore'), { loading, ssr: false }),
  sheet: suite('sheet', () => import('./apps/SheetApp')),
  word: suite('word', () => import('./apps/WordApp')),
  presentation: suite('presentation', () => import('./apps/PresentationApp')),
  notes: dynamic(() => import('./apps/NotesApp'), { loading, ssr: false }),
  settings: dynamic(() => import('./apps/SettingsApp'), { loading, ssr: false }),
  /* Task 37 — Calculator + Graphic Calc + Sci Converter merged into Kalkulator */
  kalkulator: suite('kalkulator', () => import('./apps/KalkulatorApp')),
  /* ---- Task 58: the standalone AI app is REMOVED FOREVER — the AI lives in
   * the Terminal (`AI` command) and controls every app from there ---- */
  onecompiler: dynamic(() => import('./apps/OneCompilerApp'), { loading, ssr: false }),
  camera: dynamic(() => import('./apps/CameraApp'), { loading, ssr: false }),
  /* ---- Task 48: Map renamed GLONASS — OpenStreetMap embed (osm.org /export/embed format) ---- */
  map: dynamic(() => import('./apps/GlonassApp'), { loading, ssr: false }),
  songs: suite('songs', () => import('./apps/SongsApp')),
  terminal: dynamic(() => import('./apps/TerminalApp'), { loading, ssr: false }),
  weather: dynamic(() => import('./apps/WeatherApp'), { loading, ssr: false }),
  mirror: dynamic(() => import('./apps/MirrorApp'), { loading, ssr: false }),
  pdfviewer: suite('pdfviewer', () => import('./apps/PdfViewerApp')),
  provide: dynamic(() => import('./apps/ProvideApp'), { loading, ssr: false }),
  svr: dynamic(() => import('./apps/SvrApp'), { loading, ssr: false }),
  bin: dynamic(() => import('./apps/BinApp'), { loading, ssr: false }),
  shield: dynamic(() => import('./apps/ShieldApp'), { loading, ssr: false }),
  /* ---- REDSEC 5.0 — Code Studio retired in 5.0.1 (its slot: 2048 / backup) ----
   * Task 47 — Clock + Calendar retired as separate apps; both merge into WDT
   * (World Date Time) which carries world clocks, the date calendar, alarms,
   * stopwatch and timer in one window. Old icons are remapped by the v25 store
   * migration. */
  wdt: dynamic(() => import('./apps/WdtApp'), { loading, ssr: false }),
  game2048: dynamic(() => import('./apps/Game2048App'), { loading, ssr: false }),
  /* ---- Task 46: Backup Center retired as an app — ported into Settings ▸ Backup ---- */
  /* ---- Comm suite (licensed by Open Suite Infinite) — Video Call & Mail retired in v5.0 ---- */
  chat: suite('chat', () => import('./apps/ChatApp')),
  /* ---- Task 78: Caterpillar — GitHub tool packs + git terminal ---- */
  caterpillar: dynamic(() => import('./apps/CaterpillarApp'), { loading, ssr: false }),
  /* ---- Task 13 GPU card → Task 18-final: Booster App (GPU + Task Manager + Performance merged) ---- */
  gpu: dynamic(() => import('./apps/BoosterApp'), { loading, ssr: false }),
  /* ---- Task 16/18: Mobile Link (RedSec Mobile VM bridge) ---- */
  mobilelink: dynamic(() => import('./apps/MobileLinkApp'), { loading, ssr: false }),
  /* Task 20: 'website' (Our Website) app removed in v5.1 — showcase stays a public page only.
   * ---- Task 21: Secret Tab — black-screen zero-history browsing ---- */
  secret: dynamic(() => import('./apps/SecretTabApp'), { loading, ssr: false }),
  /* Task 18-final: Owner Console retired as an app — fleet command lives in Velikan */
  /* ---- Task 26d: OpenCode — native code IDE (real Run, AI chat) ---- */
  opencode: dynamic(() => import('./apps/OpenCodeApp'), { loading, ssr: false }),
  /* ---- Task 53: Cone Player — VLC-class media player + text→stream converter ---- */
  coneplayer: dynamic(() => import('./apps/ConePlayerApp'), { loading, ssr: false }),
  /* ---- REDSEC 7.0 "Black Sea" — DevKit RETIRED as an app: the whole development
   * kit is ported into Settings ▸ Developer options (v7.0.1). ---- */
  /* ---- REDSEC 7.0 "Black Sea" — DeepClean (RAM + storage memory cleaner) ---- */
  cleaner: dynamic(() => import('./apps/CleanerApp'), { loading, ssr: false }),
  /* ---- Task 30: the standalone Driver Manager + C / C++ Compiler apps are retired —
   * C and C++ compile inside OpenCode; drivers install from App Store ▸ Drivers ---- */
}

const InstalledHostDyn = dynamic(() => import('./apps/InstalledAppHost'), { loading, ssr: false })

/** installed (html / link) apps rendered generically */
export function InstalledHost({ appId }: { appId: string }) {
  const instId = appId.startsWith('inst:') ? appId.slice(5) : appId
  return <InstalledHostDyn winId={`host_${instId}`} args={{ installedId: instId }} />
}

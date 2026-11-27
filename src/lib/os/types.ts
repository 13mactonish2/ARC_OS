// REDSEC v5.0 — Core OS Types
import type { CSSProperties } from 'react'

/** LXQt panel size preset (Settings › Taskbar) */
export type PanelSize = 'small' | 'medium'

export type TaskbarThemeId = 'redsec6' | 'redsec5' | 'default' | 'niri' | 'hyprland' | 'lxqt'
export type TaskbarPos = 'bottom' | 'top' | 'left' | 'right'
/** width of the vertical (left/right) dock */
export const TB_SIDE = 56

/* Task 76 — Dash to Panel types */
export type PanelAnchor = 'center' | 'start' | 'end'
export type PanelIntellihide = 'off' | 'always' | 'maximized'
export type PanelIndicatorPos = 'bottom' | 'top' | 'left' | 'right'
export type PanelIndicatorStyle = 'dots' | 'dash' | 'solid' | 'none'
export type PanelClickAction = 'cycle-min' | 'cycle' | 'minimize' | 'launch'
export type PanelScrollPanelAction = 'none' | 'desk' | 'cycle'
export type PanelScrollIconAction = 'none' | 'cycle' | 'min'
export type StartMenuStyle = 'chromeos' | 'auto' | 'modern' | 'category'

/** where the launcher/start bubble anchors to the panel */
export type PanelAnchorStylePos = 'bottom' | 'top' | 'left' | 'right'

/** ChromeOS launcher anchor — computes the floating bubble position pinned to
 *  the panel edge (used by ChromeLauncher and the start menus). */
export function panelAnchorStyle(
  pos: PanelAnchorStylePos,
  panelH: number,
  sideW: number,
  anchor: 'center' | 'start' | 'end' = 'center',
): CSSProperties {
  if (pos === 'top') return { top: panelH }
  if (pos === 'left') return { left: sideW + 8, bottom: 10 }
  if (pos === 'right') return { right: sideW + 8, bottom: 10 }
  const style: CSSProperties = { bottom: panelH + 10 }
  if (anchor === 'start') style.left = 10
  else if (anchor === 'end') style.right = 10
  else {
    style.left = '50%'
    style.transform = 'translateX(-50%)'
  }
  return style
}

/** where the maximized window should sit given the panel dock position (auto-hide keeps the reserve — like Windows)
 *  sideW: custom vertical-dock width (Dash to Panel thickness), defaults to TB_SIDE */
export function taskbarMaxRect(pos: TaskbarPos, h: number, sideW?: number): { left: number; top: number; width: string; height: string } {
  /* Task 77 — MAXIMIZE NOW COVERS THE ENTIRE SCREEN (user mandate). A maximized
     window is a true full-screen takeover of the monitor — every pixel, no
     panel strip left visible. The panel auto-hides underneath and reveals
     from the screen edge (Intellihide), exactly like GNOME/Unity fullscreen.
     `pos`/`h` stay in the signature for callers that still pass them. */
  void pos
  void h
  void sideW
  return { left: 0, top: 0, width: '100vw', height: '100vh' }
}

/**
 * Central taskbar/panel height in px — single source of truth.
 * RedSec Shell 5.0 is the new default: a taller glass dock with a crimson top glow.
 * The LXQt panel stays intentionally slimmer (matches the compact reference bar).
 * thickness: Dash to Panel custom thickness (24–96px) — overrides the theme default when set.
 */
export function panelPx(theme?: string, size?: PanelSize, thickness?: number | null): number {
  if (typeof thickness === 'number' && thickness >= 24) return thickness
  if (theme === 'redsec6' || theme === 'redsec5') return 52
  if (theme === 'lxqt') return size === 'medium' ? 40 : 32
  return 48
}

/** dock-aware usable desktop rect — every snap/split geometry MUST be computed
    against this, not raw innerWidth/innerHeight (which ignores top/left/right docks)
    sideW: custom vertical-dock width (Dash to Panel thickness) */
export function workAreaRect(pos: TaskbarPos, tbH: number, sideW?: number): { x: number; y: number; w: number; h: number } {
  if (typeof window === 'undefined') return { x: 0, y: 0, w: 1280, h: 800 }
  const W = window.innerWidth
  const H = window.innerHeight
  const sw = Math.max(24, sideW ?? TB_SIDE)
  if (pos === 'top') return { x: 0, y: tbH, w: W, h: Math.max(200, H - tbH) }
  if (pos === 'left') return { x: sw, y: 0, w: Math.max(200, W - sw), h: H }
  if (pos === 'right') return { x: 0, y: 0, w: Math.max(200, W - sw), h: H }
  return { x: 0, y: 0, w: W, h: Math.max(200, H - tbH) }
}

export type Phase =
  | 'boot'
  | 'welcome' // first-run: chrome extensions + Next
  | 'setup' // setup wizard: continents / username / password
  | 'ossetup' // 30s OS setup boot
  | 'ads' // welcome window screen with ads + Done
  | 'login'
  | 'desktop'
  | 'shutting' // Task 69 — fake power log (30 service codes) played before the off screen or a reboot
  | 'shutdown'
  | 'sleep'

export interface WinState {
  id: string
  appId: string
  title?: string
  x: number
  y: number
  w: number
  h: number
  z: number
  minimized: boolean
  maximized: boolean
  snap: SnapZone | null
  prev?: { x: number; y: number; w: number; h: number } | null
  args?: Record<string, unknown>
  desk?: number // virtual desktop index (0-based)
}

export type DesktopItemType = 'app' | 'folder' | 'shortcut'

export interface DesktopItem {
  id: string
  type: DesktopItemType
  appId?: string
  folderNodeId?: string
  label: string
  x: number
  y: number
}

export interface InstalledApp {
  id: string
  name: string
  kind: 'html' | 'link'
  html?: string
  url?: string
  color?: string
  iconUrl?: string
  installedAt: number
  status: 'installed' | 'uninstalled' // uninstalled kept forever in store history
  category?: string
  publisher?: string
  version?: string
  description?: string
  /* Open Store upgrade — a pasted link is CLASSIFIED (app vs game). Games get
     an FPS overlay + a benchmark recorder, both user-toggleable. */
  isGame?: boolean
  fpsOverlay?: boolean
  benchmarks?: boolean
  lastBenchmark?: string // JSON benchmark summary of the last recorded session
}

export interface OSUpdate {
  id: string
  name: string
  kind: 'css' | 'js' | 'html' | 'security' | 'os'
  content?: string
  at: number
}

export interface Notif {
  id: string
  title: string
  body?: string
  emoji?: string
  at: number
  kind?: 'info' | 'success' | 'warn' | 'error' | 'voice' | 'shot'
  silent?: boolean // set when Do-Not-Disturb is on: recorded in center, no toast/sound
  app?: string // appId that raised it (shown as a chip; per-app prefs can block it)
}

export interface ClipItem {
  id: string
  text: string
  at: number
  pinned: boolean
}

export interface WallpaperSlideshow {
  enabled: boolean
  intervalMin: number
  scope: 'stock' | 'custom' | 'all'
}

/* UI theme — 'light' applies the realtime inverted-skin (no reload); 'auto' follows the OS preference */
export type UITheme = 'dark' | 'light' | 'auto'

/* a driver installed from the App Store → Drivers tab (persisted forever) */
export interface WebDriverInstall {
  name: string
  version: string
  installedAt: number
}

/* an emulation core installed from the App Store → Emulation tab (persisted forever) */
export interface EmuCoreInstall {
  name: string
  console: string
  bios: string[] // bundled BIOS pack fingerprints — always complete, never empty
  installedAt: number
}

/* Task 30 — App Store ▸ Drivers: the five system drivers and their install record
   (Task 34 — the DOS BIOS & DOSBox driver was removed from the OS entirely) */
export type DriverId = 'windows' | 'directx' | 'wine' | 'proton' | 'mesa'
export interface InstalledDriverState {
  version: string
  installedAt: number
}

/* snap-layout zones (fractions of the work area) */
export type SnapZone =
  | 'left' | 'right' | 'top'
  | 'third-l' | 'third-c' | 'third-r'
  | 'twoleft' | 'tworight'
  | 'tl' | 'tr' | 'bl' | 'br'

export const SNAP_FRACTIONS: Record<SnapZone, { fx: number; fy: number; fw: number; fh: number }> = {
  left: { fx: 0, fy: 0, fw: 0.5, fh: 1 },
  right: { fx: 0.5, fy: 0, fw: 0.5, fh: 1 },
  top: { fx: 0, fy: 0, fw: 1, fh: 1 },
  'third-l': { fx: 0, fy: 0, fw: 1 / 3, fh: 1 },
  'third-c': { fx: 1 / 3, fy: 0, fw: 1 / 3, fh: 1 },
  'third-r': { fx: 2 / 3, fy: 0, fw: 1 / 3, fh: 1 },
  twoleft: { fx: 0, fy: 0, fw: 2 / 3, fh: 1 },
  tworight: { fx: 1 / 3, fy: 0, fw: 2 / 3, fh: 1 },
  tl: { fx: 0, fy: 0, fw: 0.5, fh: 0.5 },
  tr: { fx: 0.5, fy: 0, fw: 0.5, fh: 0.5 },
  bl: { fx: 0, fy: 0.5, fw: 0.5, fh: 0.5 },
  br: { fx: 0.5, fy: 0.5, fw: 0.5, fh: 0.5 },
}

/* Split-screen divider resize: the zone that shares the DRAGGED edge of the
   resized window and must grow/shrink in lock-step so the tiling stays seamless.
   EAST partner = zone to the right sharing the vertical divider (for resize-e/se);
   SOUTH partner = zone below sharing the horizontal divider (for resize-s/se). */
export const SNAP_EAST_PARTNER: Partial<Record<SnapZone, SnapZone>> = {
  left: 'right',
  'third-l': 'third-c',
  'third-c': 'third-r',
  twoleft: 'third-r',
  tl: 'tr',
  bl: 'br',
}
export const SNAP_SOUTH_PARTNER: Partial<Record<SnapZone, SnapZone>> = {
  tl: 'bl',
  tr: 'br',
}

/* sticky quick-notes (Win+N) */
export interface QuickNote {
  id: string
  text: string
  color: 'amber' | 'emerald' | 'rose' | 'slate'
  x: number
  y: number
}

export interface Drivers {
  sound: boolean
  internet: boolean
  sharing: boolean
  gpu: boolean
  gamepad: boolean // Task 66 — gamepad HID driver (Gaming Hub / App Store)
}

export interface OsLockState {
  attempts: number
  lockedUntil: number
}

export interface ManualClock {
  base: number
  at: number
}

export interface OSStore {
  /* ---- persisted ---- */
  setupComplete: boolean
  username: string
  password: string | null
  /** Task 73 — screen-lock PIN (4–8 digits) usable on the boot login + lock screens */
  pin: string | null
  /** Task 73 — Android-style unlock pattern (dot indices 0–8, row-major, 4+ dots, no repeats) */
  pattern: number[] | null
  /** Task 73 — which method the lock/login screens open with first */
  prefUnlock: 'password' | 'pin' | 'pattern'
  continent: string
  wallpaper: string // 'stock:N' | 'custom:<fsNodeId>' | 'none'
  themeBg: string
  taskbarColor: string
  taskbarAlign: 'left' | 'center'
  taskbarPos: TaskbarPos // which screen edge the panel docks to (bottom default; left/right = vertical dock)
  taskbarAutoHide: boolean // slide the panel off-screen; pointer near the edge slides it back
  taskbarTheme: TaskbarThemeId
  taskbarPinned: string[]
  panelSize: PanelSize // LXQt panel height: small = 32px (reference slim bar), medium = 40px
  /* Task 76 — Dash to Panel: full panel customization (all persisted — permanent for the OS) */
  panelThickness: number | null // custom panel thickness 24–96px (null = theme default)
  panelLength: number // % of the screen edge the panel spans (40–100)
  panelAnchor: PanelAnchor // where a shortened panel sits: start / center / end
  panelIntellihide: PanelIntellihide // off | always (legacy auto-hide) | maximized (hide only under a maximized window)
  panelShowStart: boolean
  panelShowSearch: boolean
  panelShowTaskView: boolean
  panelShowFavs: boolean // show favorite (pinned) applications
  panelShowRunning: boolean // show running applications
  panelShowTray: boolean // system tray icons (wifi/volume/night light/widgets)
  panelShowClock: boolean
  panelIconPad: number // px gap between panel app buttons (0–12)
  panelIconSize: number // app icon size on the panel (16–32px)
  panelIndPos: PanelIndicatorPos // running-indicator position
  panelIndStyle: PanelIndicatorStyle // dots | dash | solid | none
  panelBgOverride: boolean // override the theme background with a solid color + opacity
  panelBgColor: string
  panelBgOpacity: number // 40–100 (%)
  panelGradient: boolean // vertical gradient background override (top → bottom)
  panelGradTop: string
  panelGradBottom: string
  panelAnimateHover: boolean // animate hovering app icons
  panelTooltip: boolean // show app-name tooltip on hover
  panelPreviews: boolean // show live window previews on hover
  panelClickAction: PanelClickAction // what clicking a panel app button does
  panelScrollPanel: PanelScrollPanelAction // wheel over empty panel space
  panelScrollIcon: PanelScrollIconAction // wheel over an app icon
  panelHotkeys: boolean // Super+0..9 activates the nth panel app
  panelTrayFont: number // tray/clock font size px (0 = theme default)
  panelItemPad: number // padding around panel items px (-1 = theme default)
  panelAnimLaunch: boolean // pop animation when a new window joins the panel
  /* Task 77 — Window Panel: titlebar button customization (Settings ▸ Window Panel) */
  winBtnPos: 'right' | 'center' | 'left' // where the min/max/close cluster sits
  winBtnShape: 'macos' | 'circle' | 'square' | 'rounded' | 'pill' // button shape language
  winBtnSize: number // button px (9–20)
  winBtnGap: number // px gap between buttons (2–16)
  winBtnColorMin: string // minimize button color
  winBtnColorMax: string // maximize button color
  winBtnColorClose: string // close button color
  winBtnGlyph: boolean // show the − ▢ ✕ glyphs
  winBtnOrder: 'min-max-close' | 'close-max-min' // button order in the cluster
  taskbarLocked: boolean // Task 77 — Lock taskbar: pinned set can't change
  startMenuStyle: StartMenuStyle // start menu layout: auto (theme) | modern grid | category browser
  widgetWorldClocks: boolean // world clocks card in the widget panel
  wifi: boolean
  bluetooth: boolean
  airplane: boolean
  nightLight: boolean
  brightness: number
  volume: number
  sharing: boolean
  autoTime: boolean
  manualClock: ManualClock | null
  desktopItems: DesktopItem[]
  installedApps: InstalledApp[]
  updates: OSUpdate[]
  drivers: Drivers
  osLock: OsLockState
  lockScreen: { wrong: number; level: number; until: number } // Task 22 — Win+L lock-screen guard: wrong=consecutive wrong attempts, level=escalation tier 0/1/2 (30s/60s/1day), until=epoch ms the lockout ends (persisted — survives reloads)
  storeAgreed: boolean
  voiceEnabled: boolean
  securityPatchLevel: number
  desktopWidgets: boolean // clock/weather widget on the desktop
  dnd: boolean // Do-Not-Disturb: notifications record silently, no toast/sound
  clipboardHistory: ClipItem[]
  wallpaperSlideshow: WallpaperSlideshow
  emojiRecents: string[]
  appVolumes: Record<string, number> // per-app volume mixer (appId → 0-100, missing = 100)
  mixerSolo: string | null // solo mode: only this appId is audible, everything else is muted
  notifPrefs: Record<string, boolean> // per-app notification switches (missing = allowed, false = blocked)
  recentApps: { appId: string; at: number }[] // start-menu "Recommended" history
  fullscreenWanted: boolean // persisted — auto-enter full screen at login (first gesture)
  shieldAutoScan: boolean // Velikan 5.0 — scheduled daily quick scan (persisted)
  uiTheme: UITheme // realtime theme — dark (default) / light (inverted skin) / auto
  skinStartIcon: string | null // fs nodeId — custom Start-button image (right-click → Customize)
  skinTaskbarImage: string | null // fs nodeId — custom taskbar/panel background image
  customIconIds: Record<string, string> // appId → fs nodeId — custom desktop/start icon images
  startBarColor: string | null // Start-menu panel color override (null = default glass)
  taskbarCustomColor: string | null // taskbar/panel color override — beats every panel theme
  windowBarColor: string | null // window title-bar color override (null = default)
  webDrivers: Record<string, WebDriverInstall> // driver slug → install record (App Store → Drivers)
  emuCores: Record<string, EmuCoreInstall> // core slug → install record (App Store → Emulation)
  installedDrivers: Partial<Record<DriverId, InstalledDriverState>> // Task 30 App Store ▸ Drivers — installed system drivers (windows/directx/wine/proton/mesa)
  browserBgColor: string // Web Browser chrome color override ('' = default)
  browserWallpaperId: string // fs nodeId — browser background image or video ('' = none)
  browserWallpaperVideo: boolean // true → the browserWallpaperId node is a video (live 4K wallpaper)
  browserHistory: BrowserHistoryEntry[] // browser "Records" — secret-tab visits never land here
  profilePhoto: string | null // fs nodeId — personal profile photo (Settings → Security); shown on the lock screen avatar AND the Start button
  autoLock: boolean // idle auto-lock — lock the screen after N idle minutes while the OS is running
  autoLockMins: number // idle minutes before the auto-lock fires (default 2)
  osFont: string // global OS font family key ('' = system default, see FONT_STACKS in store)
  customFontId: string // fs nodeId — user-uploaded font file rendered ahead of the preset stack (Settings → Fonts); '' = none
  widgetClock: boolean // desktop clock widget on/off
  widgetClockStyle: 'digital' | 'retro' | 'analog' | 'classics' | 'pageflip' // clock widget face
  widgetWeather: boolean // desktop weather widget on/off
  widgetNews: boolean // desktop news widget on/off
  widgetCalendar: boolean // desktop calendar widget on/off
  widgetPerf: boolean // Task 66 — live performance widget (GPU / CPU / FPS)
  bootCustom: null | {
    enabled: boolean // false → stock boot code
    title: string // custom welcome line ("" → stock)
    lines: string[] // max 50 custom boot lines
    okColor: string // [ DONE ] tag color
    warnColor: string // [  ..  ] tag color
    textColor: string // boot text color
    accentColor: string // progress bar + accent color
    showLoader: boolean // keep the RedSec loader menu stage before the log
  } // Task 66 — boot loader customization (null → stock)
  storageTier: 50 | 100 | 150 // storage plan (all tiers free — the old QR + 6-digit code gate was removed)
  devMode: boolean // Task 55 — Developer Options: granted by the REDSEC Mobile QR handshake, unlocks the screen lock, OS files, text editing and the Owner Console
  devSince: number | null // epoch ms the developer handshake was verified (null = off)
  /* ---- REDSEC v7.0 "Black Sea" — enforcement + developer customization ---- */
  securityExtreme: boolean // extreme anti-tamper: OS-file tampering without Developer Options = PERMANENT device ban
  browserGuard: boolean // compatibility gate: untrusted browser brands get the DEVICE NOT COMPATIBLE screen
  termxTextColor: string | null // Term X custom text colour (Settings ▸ Fonts) — saved forever
  devWinRadius: number | null // developer window shape: corner radius override in px (null = stock)
  devWinScale: number | null // developer window size: default window size scale (null/1 = stock)

  /* ---- transient ---- */
  phase: Phase
  powerSeq: 'shutdown' | 'restart' // Task 69 — which power log the 'shutting' phase renders
  bootedOnce: boolean
  locked: boolean // Win+L lock screen over the running desktop
  windows: WinState[]
  zCounter: number
  focusedWin: string | null
  startOpen: boolean
  widgetOpen: boolean
  notifOpen: boolean
  searchOpen: boolean
  runOpen: boolean
  clipOpen: boolean
  emojiOpen: boolean
  keyboardOpen: boolean
  recording: boolean
  notifications: Notif[]
  ctx: { open: boolean; x: number; y: number; items: MenuItem[] } | null
  snapPreview: SnapZone | null
  snapAssist: { forWin: string; zone: SnapZone; chain: SnapZone[] } | null
  mixerOpen: boolean // volume mixer panel
  quickNotes: QuickNote[]
  quickNotesOpen: boolean
  sessionStart: number
  closing: string[] // window ids playing the close animation
  minimizing: string[] // window ids playing the minimize animation
  vdeskActive: number // current virtual desktop (transient)
  taskViewOpen: boolean // Win+Tab task view overlay
  vdeskCount: number // number of virtual desktops (persisted)
  shakeRestore: string[] // windows hidden by an Aero-Shake (shake again to restore) — [shakerId, ...hidden]
  deskPicker: boolean // drag-window-over-Task-View-button desktop picker popover
  fullscreenActive: boolean // transient — real Fullscreen-API state (synced by fullscreenchange)
  fsPromptOff: boolean // transient — user dismissed the ⛶ full-screen pill this session
}

export interface MenuItem {
  label?: string
  icon?: string
  onClick?: () => void
  danger?: boolean
  separator?: boolean
  disabled?: boolean
}

/* ---------------- File System ---------------- */

export interface FSNode {
  id: string
  name: string
  kind: 'file' | 'folder'
  parent: string | null
  mime?: string
  size?: number
  url?: string // remote URL for stock media
  trashed?: boolean
  prevParent?: string | null
  createdAt: number
  modifiedAt: number
  meta?: Record<string, unknown>
}

export type RootId =
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'archive'
  | 'photos'
  | 'videos'
  | 'screenshots'
  | 'music'
  | 'os'
  | 'bin'
  | 'docker' // Task 35 — the Docker container root: every file, photo, video & sound in one view

export interface AppProps {
  winId: string
  args?: Record<string, unknown>
}

/* Actions implemented by the store (src/lib/os/store.ts) */
export interface BrowserHistoryEntry {
  url: string // logical url (site mode) or '' for searches
  query: string // search query (search mode)
  mode: 'search' | 'site'
  at: number
}

export interface OSActions {
  setPhase: (p: Phase) => void
  completeSetup: (opts: { username: string; password: string | null; continent: string }) => void
  login: () => void
  shutdown: () => void
  restart: () => void
  factoryReset: (keepUpdates: boolean) => void
  destroyOS: () => void
  openApp: (appId: string, args?: Record<string, unknown>, titleOverride?: string) => string
  closeWindow: (id: string) => void
  closeAll: () => void
  focusWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  toggleMaximize: (id: string) => void
  snapWindow: (id: string, zone: SnapZone, assist?: boolean) => void
  setSnapAssist: (a: { forWin: string; zone: SnapZone; chain: SnapZone[] } | null) => void
  /* re-fit every snapped window into its zone against the CURRENT work area
     (viewport resize, device rotation, dock move) — keeps splits seamless */
  relayoutSnapped: () => void
  /* virtual desktops */
  switchDesktop: (n: number) => void
  cycleDesktop: (dir: 1 | -1) => void
  addDesktop: (stayInOverview?: boolean) => void
  removeDesktop: (n: number) => void
  moveWinToDesktop: (winId: string, desk: number) => void
  moveFocusedToDesktop: (desk: number) => void
  addQuickNote: () => void
  updateQuickNote: (id: string, patch: Partial<QuickNote>) => void
  removeQuickNote: (id: string) => void
  setSnapPreview: (zone: SnapZone | null) => void
  pushClipboard: (text: string) => void
  removeClipboard: (id: string) => void
  togglePinClipboard: (id: string) => void
  clearClipboard: () => void
  pushBrowserHistory: (e: BrowserHistoryEntry) => void // Records — capped, secret tabs never call this
  clearBrowserHistory: () => void
  moveWindow: (id: string, x: number, y: number) => void
  resizeWindow: (id: string, w: number, h: number) => void
  setWindowTitle: (id: string, title: string) => void
  addDesktopItem: (item: DesktopItem) => void
  removeDesktopItem: (id: string) => void
  moveDesktopItem: (id: string, x: number, y: number) => void
  renameDesktopItem: (id: string, label: string) => void
  sortDesktop: (by: 'name' | 'size' | 'type') => void
  installDesktopApp: (app: InstalledApp) => void
  installApp: (app: InstalledApp) => void
  uninstallApp: (id: string) => void
  set: (patch: Partial<OSStore>) => void
  togglePin: (appId: string) => void
  notify: (n: { title: string; body?: string; emoji?: string; kind?: Notif['kind']; app?: string; silent?: boolean }) => string
  dismissNotif: (id: string) => void
  clearNotifs: () => void
  addUpdate: (u: OSUpdate) => void
  removeUpdate: (id: string) => void
  setOsLock: (lock: OsLockState) => void
  setLockScreen: (s: { wrong: number; level: number; until: number }) => void
  setDevMode: (on: boolean) => void // Task 55 — flip Developer Options (on = the QR handshake verified; off = protections restore instantly)
  setAppVolume: (appId: string, vol: number) => void
  aeroShake: (winId: string) => void
  setNotifPref: (appId: string, allowed: boolean) => void
  executeVoiceCommand: (raw: string) => string
  setSkinImage: (slot: 'start' | 'taskbar' | 'icon', nodeId: string, appId?: string) => void
  clearSkinImage: (slot: 'start' | 'taskbar' | 'icon', appId?: string) => void
}

export type OSStoreWithActions = OSStore & OSActions

/* Events */
export const EV_VOICE_TYPE = 'os-voice-type'
export const EV_TASK_VIEW = 'os-task-view'
export const EV_FS_TOGGLE = 'os-fullscreen-toggle' // internal: request a fullscreen toggle from anywhere

// REDSEC v5.0 — Task 42/43: hardware port detection (USB / HDMI / Ethernet)
//
// REDSEC watches the machine's ports continuously — not just once at boot —
// and raises a desktop notification + option popup for every port event:
//   • USB    — real WebUSB hot-plug: navigator.usb connect/disconnect events,
//              a 5s getDevices() re-probe for newly authorized devices, plus a
//              virtual flash-drive so the flow is demoable everywhere. A USB
//              device entering the port opens the option popup immediately:
//              Media / Files / Internet (USB tethering).
//   • HDMI   — a connected HDMI port unlocks the Settings ▸ Wide Screen dual
//              connect (6-digit code pairing with a second tab/device acting
//              as an extended display). screen.isExtension is re-polled every
//              5s so plugging a REAL monitor in mid-session upgrades the port
//              from virtual to real with a toast. When NO HDMI is detected the
//              wide screen options are never shown.
//   • Ethernet — link state follows navigator.onLine live (online/offline
//              events), not just the boot snapshot.
//
// All UI (toasts, prompts, tray, Settings) subscribes to this singleton —
// no store surgery, zero re-render cost when idle.
'use client'

import { useOS } from './store'

export type PortKind = 'usb' | 'hdmi' | 'ethernet'

export interface PortDevice {
  id: string
  kind: PortKind
  name: string
  detail: string
  connected: boolean
  virtual: boolean
  speed?: string
}

export interface PortToast {
  id: string
  title: string
  body: string
  emoji: string
  at: number
  tone: 'info' | 'success' | 'warn'
}

type DevListener = (devices: PortDevice[]) => void
type PromptListener = (device: PortDevice | null) => void
type ToastListener = (toasts: PortToast[]) => void

const TOAST_TTL = 5600
const RESCAN_MS = 5000

interface WebUsbLike {
  getDevices: () => Promise<Array<{ vendorId: number; productId?: number; productName?: string; manufacturerName?: string }>>
  addEventListener: (t: string, fn: (e?: unknown) => void) => void
  removeEventListener?: (t: string, fn: (e?: unknown) => void) => void
}

class PortManager {
  private devices: PortDevice[] = []
  private devListeners = new Set<DevListener>()
  private promptListeners = new Set<PromptListener>()
  private toastListeners = new Set<ToastListener>()
  private toasts: PortToast[] = []
  private promptId: string | null = null
  private started = false
  private timers: ReturnType<typeof setTimeout>[] = []
  private loops: ReturnType<typeof setInterval>[] = []
  private onlineFn: (() => void) | null = null
  private offlineFn: (() => void) | null = null
  private screenFn: ((e?: unknown) => void) | null = null
  private usbConnectFn: ((e?: unknown) => void) | null = null
  private usbDisconnectFn: ((e?: unknown) => void) | null = null
  /** USB tethering ("Use for Internet") active for a device id */
  tetherId: string | null = null
  /** last rescan toast time — keeps "Scan again" feedback honest */
  private lastScanAt = 0

  /* ---------------- subscriptions ---------------- */
  subscribe(fn: DevListener): () => void {
    this.devListeners.add(fn)
    fn(this.devices.map((d) => ({ ...d })))
    return () => this.devListeners.delete(fn)
  }
  subscribePrompt(fn: PromptListener): () => void {
    this.promptListeners.add(fn)
    /* replay the live prompt — a popup raised before <UsbPrompt> mounted must
       still appear (this race made USB popups "never show" for some users) */
    const cur = this.getPrompt()
    if (cur) fn({ ...cur })
    return () => this.promptListeners.delete(fn)
  }
  subscribeToasts(fn: ToastListener): () => void {
    this.toastListeners.add(fn)
    fn(this.liveToasts())
    return () => this.toastListeners.delete(fn)
  }

  getDevices(): PortDevice[] {
    return this.devices
  }
  getPrompt(): PortDevice | null {
    return this.devices.find((d) => d.id === this.promptId) ?? null
  }
  getHdmi(): PortDevice | undefined {
    return this.devices.find((d) => d.kind === 'hdmi')
  }
  getUsbDrives(): PortDevice[] {
    return this.devices.filter((d) => d.kind === 'usb' && d.connected)
  }
  isTethered(): boolean {
    return this.tetherId !== null
  }
  private liveToasts(): PortToast[] {
    const now = Date.now()
    return this.toasts.filter((t) => now - t.at < TOAST_TTL)
  }
  private emit() {
    const snapshot = this.devices.map((d) => ({ ...d }))
    this.devListeners.forEach((fn) => fn(snapshot))
  }
  private emitPrompt() {
    const p = this.getPrompt()
    this.promptListeners.forEach((fn) => fn(p ? { ...p } : null))
  }
  private emitToasts() {
    const live = this.liveToasts()
    this.toastListeners.forEach((fn) => fn(live))
  }

  /** transient top-right desktop toast (auto-dismiss) + notification tray entry */
  pushToast(title: string, body: string, emoji: string, tone: PortToast['tone'] = 'info') {
    const t: PortToast = { id: `pt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, title, body, emoji, at: Date.now(), tone }
    this.toasts = [...this.toasts, t].slice(-4)
    this.emitToasts()
    setTimeout(() => {
      this.toasts = this.liveToasts()
      this.emitToasts()
    }, TOAST_TTL + 60)
    try {
      useOS.getState().notify({ title, body, kind: tone === 'warn' ? 'warn' : tone === 'success' ? 'success' : 'info', app: 'settings' })
    } catch {
      /* store may not be ready during early boot */
    }
  }

  /* ---------------- device mutations ---------------- */
  private upsert(dev: PortDevice, announce = true) {
    const i = this.devices.findIndex((d) => d.id === dev.id)
    const prev = i >= 0 ? this.devices[i] : null
    /* identical snapshot (5s re-probe loops) → no emit, no listeners churned */
    if (prev && prev.kind === dev.kind && prev.name === dev.name && prev.detail === dev.detail && prev.connected === dev.connected && prev.virtual === dev.virtual && prev.speed === dev.speed) return
    if (i >= 0) this.devices[i] = { ...dev }
    else this.devices.push(dev)
    this.emit()
    if (!announce) return
    if (!prev || !prev.connected) {
      if (dev.connected) {
        this.pushToast(dev.kind === 'usb' ? 'USB device connected' : dev.kind === 'hdmi' ? 'HDMI cable detected' : 'Ethernet link up', `${dev.name} — ${dev.detail}`, dev.kind === 'usb' ? '🔌' : dev.kind === 'hdmi' ? '🖥️' : '🌐', 'success')
        if (dev.kind === 'usb') this.showOptions(dev.id)
      } else {
        this.pushToast(dev.kind === 'usb' ? 'USB device removed' : dev.kind === 'hdmi' ? 'HDMI cable disconnected' : 'Ethernet link down', dev.name, dev.kind === 'usb' ? '🔌' : dev.kind === 'hdmi' ? '🖥️' : '🌐', 'warn')
      }
    }
  }

  setConnected(id: string, connected: boolean) {
    const d = this.devices.find((x) => x.id === id)
    if (!d || d.connected === connected) return
    d.connected = connected
    if (!connected && this.promptId === id) {
      this.promptId = null
      this.emitPrompt()
    }
    if (!connected && this.tetherId === id) this.tetherId = null
    this.emit()
    this.pushToast(
      connected ? (d.kind === 'usb' ? 'USB device connected' : d.kind === 'hdmi' ? 'HDMI cable detected' : 'Ethernet link up') : d.kind === 'usb' ? 'USB device removed' : d.kind === 'hdmi' ? 'HDMI cable disconnected' : 'Ethernet link down',
      d.name,
      d.kind === 'usb' ? '🔌' : d.kind === 'hdmi' ? '🖥️' : '🌐',
      connected ? 'success' : 'warn',
    )
    if (connected && d.kind === 'usb') this.showOptions(id)
  }

  /* ---------------- USB option popup ---------------- */
  showOptions(deviceId: string) {
    this.promptId = deviceId
    this.emitPrompt()
  }
  dismissPrompt() {
    this.promptId = null
    this.emitPrompt()
  }
  setTether(id: string | null) {
    this.tetherId = id
    this.emit()
    if (id) this.pushToast('USB tethering active', "This PC's internet connection is shared over USB.", '🌐', 'success')
  }

  /* ---------------- boot probe + continuous hot-plug watch ---------------- */
  async start() {
    if (this.started) return
    this.started = true

    const offline = typeof navigator !== 'undefined' && !navigator.onLine

    /* 1 — Ethernet (real link state) */
    this.timers.push(
      setTimeout(() => {
        this.upsert({ id: 'eth0', kind: 'ethernet', name: 'Ethernet (eth0)', detail: offline ? 'Cable connected — no link' : 'Link up — 1 Gbps full duplex', connected: !offline, virtual: true, speed: '1 Gbps' }, false)
        if (!offline) this.pushToast('Ethernet detected', 'eth0 link up — 1 Gbps full duplex. Internet ready.', '🌐', 'success')
      }, 900),
    )

    /* 2 — USB: real WebUSB devices + virtual flash drive */
    this.timers.push(
      setTimeout(() => {
        void (async () => {
          let real = 0
          try {
            const usb = this.usb()
            if (usb) {
              real = await this.probeUsbDevices(usb)
              this.watchUsb(usb)
            }
          } catch {
            /* WebUSB unavailable — virtual device covers the demo */
          }
          if (real === 0) {
            this.upsert({ id: 'usb_sandisk', kind: 'usb', name: 'SanDisk Ultra 64GB', detail: 'USB 3.2 Gen 1 — mass storage · 58.6 GB free', connected: true, virtual: true, speed: '5 Gbps' }, false)
            this.pushToast('USB device connected', 'SanDisk Ultra 64GB — choose what to do with this device.', '🔌', 'success')
            this.upsert({ id: 'usb_mouse', kind: 'usb', name: 'HID-compliant mouse', detail: 'USB 2.0 — human interface device', connected: true, virtual: true, speed: '480 Mbps' }, false)
            this.showOptions('usb_sandisk')
          }
        })()
      }, 2100),
    )

    /* 3 — HDMI (real multi-monitor signal first, virtual cable fallback) */
    this.timers.push(setTimeout(() => this.probeHdmi(true), 3400))

    /* 4 — continuous hot-plug watch: "when the port enters, detect it" */
    this.startWatch()
  }

  private usb(): WebUsbLike | null {
    try {
      return (navigator as Navigator & { usb?: WebUsbLike }).usb ?? null
    } catch {
      return null
    }
  }

  /** pull the current WebUSB device list into the port list (returns count) */
  private async probeUsbDevices(usb: WebUsbLike): Promise<number> {
    let n = 0
    try {
      const devs = await usb.getDevices()
      for (const d of devs.slice(0, 4)) {
        n++
        const id = `usb_real_${d.vendorId}_${d.productId ?? 0}`
        this.upsert(
          {
            id,
            kind: 'usb',
            name: d.productName || `USB device ${d.vendorId.toString(16)}:${(d.productId ?? 0).toString(16)}`,
            detail: `WebUSB device — browser authorized${d.manufacturerName ? ` · ${d.manufacturerName}` : ''}`,
            connected: true,
            virtual: false,
          },
          true,
        )
      }
    } catch { /* getDevices failed */ }
    return n
  }

  /** live WebUSB hot-plug: plugging an authorized device fires instantly */
  private watchUsb(usb: WebUsbLike) {
    this.usbConnectFn = (e) => {
      const dev = (e as { device?: { vendorId?: number; productId?: number; productName?: string; manufacturerName?: string } } | undefined)?.device
      const id = `usb_real_${dev?.vendorId ?? 0}_${dev?.productId ?? 0}`
      this.upsert(
        {
          id,
          kind: 'usb',
          name: dev?.productName || `USB device ${(dev?.vendorId ?? 0).toString(16)}`,
          detail: 'WebUSB device — just plugged in',
          connected: true,
          virtual: false,
        },
        true,
      )
      this.showOptions(id)
    }
    this.usbDisconnectFn = (e) => {
      const dev = (e as { device?: { vendorId?: number; productId?: number } } | undefined)?.device
      const id = `usb_real_${dev?.vendorId ?? 0}_${dev?.productId ?? 0}`
      const d = this.devices.find((x) => x.id === id)
      if (d) this.setConnected(id, false)
    }
    try {
      usb.addEventListener('connect', this.usbConnectFn)
      usb.addEventListener('disconnect', this.usbDisconnectFn)
    } catch { /* noop */ }
  }

  /** HDMI probe — real screen.isExtended upgrades the virtual cable to a real
   *  external display; a real monitor disappearing downgrades back */
  private probeHdmi(boot: boolean) {
    const extended = typeof screen !== 'undefined' && (screen as Screen & { isExtended?: boolean }).isExtended === true
    const cur = this.devices.find((d) => d.kind === 'hdmi')
    if (extended) {
      const dev: PortDevice = { id: 'hdmi1', kind: 'hdmi', name: 'HDMI 1 — external display', detail: 'Real display detected via browser (screen.isExtended)', connected: true, virtual: false }
      if (!cur || cur.virtual) {
        this.upsert(dev, false)
        this.pushToast(boot ? 'HDMI port detected' : 'External display detected', boot ? 'HDMI 1 connected — Wide Screen dual connect is now available in Settings.' : 'A real monitor was plugged in — Wide Screen dual connect is available in Settings.', '🖥️', 'success')
      }
    } else {
      const dev: PortDevice = { id: 'hdmi1', kind: 'hdmi', name: 'HDMI 1', detail: 'HDMI 2.1 — 4K@60 ready · virtual cable', connected: true, virtual: true }
      if (!cur) {
        this.upsert(dev, false)
        this.pushToast('HDMI port detected', 'HDMI 1 connected — Wide Screen dual connect is now available in Settings.', '🖥️', 'success')
      } else if (!cur.virtual) {
        this.upsert(dev, false)
        this.pushToast('External display removed', 'The real monitor was unplugged — HDMI 1 fell back to the virtual cable.', '🖥️', 'warn')
      }
    }
  }

  /** continuous watch — re-probes every 5s + real browser events */
  private startWatch() {
    /* online / offline → live Ethernet port state */
    this.onlineFn = () => {
      this.upsert({ id: 'eth0', kind: 'ethernet', name: 'Ethernet (eth0)', detail: 'Link up — 1 Gbps full duplex', connected: true, virtual: true, speed: '1 Gbps' }, true)
    }
    this.offlineFn = () => {
      const d = this.devices.find((x) => x.id === 'eth0')
      if (d) this.setConnected('eth0', false)
    }
    try {
      window.addEventListener('online', this.onlineFn)
      window.addEventListener('offline', this.offlineFn)
    } catch { /* noop */ }

    /* screen change event (Window Management API, when available) */
    try {
      this.screenFn = () => this.probeHdmi(false)
      ;(screen as Screen & { addEventListener?: (t: string, fn: (e?: unknown) => void) => void }).addEventListener?.('change', this.screenFn)
    } catch { /* noop */ }

    /* periodic re-probe: newly authorized USB devices + real HDMI changes */
    this.loops.push(
      setInterval(() => {
        void (async () => {
          const usb = this.usb()
          if (usb) await this.probeUsbDevices(usb)
          this.probeHdmi(false)
        })()
      }, RESCAN_MS),
    )
  }

  /** manual rescan (Settings ▸ Scan ports again / tray) — announces only changes */
  rescan() {
    void (async () => {
      const before = this.devices.map((d) => `${d.id}:${d.connected ? 1 : 0}`).join('|')
      const usb = this.usb()
      if (usb) await this.probeUsbDevices(usb)
      this.probeHdmi(false)
      const after = this.devices.map((d) => `${d.id}:${d.connected ? 1 : 0}`).join('|')
      this.lastScanAt = Date.now()
      if (before === after) {
        this.pushToast('Port scan complete', 'No changes — all ports are in their previous state.', '🧭', 'info')
      } else {
        this.pushToast('Port scan complete', 'Port changes were applied and announced.', '🧭', 'success')
      }
    })()
  }
  lastScan(): number {
    return this.lastScanAt
  }

  /** unhook everything (factory reset / hot unload) */
  stop() {
    this.timers.forEach(clearTimeout)
    this.timers = []
    this.loops.forEach(clearInterval)
    this.loops = []
    const usb = this.usb()
    try {
      if (usb && this.usbConnectFn) usb.removeEventListener?.('connect', this.usbConnectFn)
      if (usb && this.usbDisconnectFn) usb.removeEventListener?.('disconnect', this.usbDisconnectFn)
      if (this.onlineFn) window.removeEventListener('online', this.onlineFn)
      if (this.offlineFn) window.removeEventListener('offline', this.offlineFn)
      if (this.screenFn) (screen as Screen & { removeEventListener?: (t: string, fn: (e?: unknown) => void) => void }).removeEventListener?.('change', this.screenFn)
    } catch { /* noop */ }
    this.devices = []
    this.toasts = []
    this.promptId = null
    this.tetherId = null
    this.started = false
    this.emit()
  }
}

export const ports = new PortManager()

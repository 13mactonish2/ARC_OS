// REDSEC 5.0 — global user-hardening guard (final project hardening pass).
//
// Blocks the NATIVE browser context menu (right-click → "Inspect") and the
// common DevTools shortcuts on EVERY surface of the OS — boot, welcome,
// setup, desktop, guest chat, RedSec Mobile VM and the Owner Console.
//
// SILENT BY DESIGN (user directive): blocks happen with NO notification and
// no popup — right-click simply does nothing visible, exactly like a locked
// desktop. DevTools shortcut attempts are still recorded into the REDSEC
// Shield security feed (logSecEvent, rate-limited) so the owner can audit
// them, but nothing is shown to the user.
//
// The OS's own custom context menus (openCtx on desktop / taskbar / files /
// window frames) KEEP WORKING: React's onContextMenu handlers run after this
// capture-phase preventDefault (preventDefault does not stop propagation), so
// those surfaces still open the REDSEC menu — but the browser menu with the
// "Inspect" entry can never appear anywhere, for any user.
//
// EXPORTS: installSecurityGuard() — idempotent; call once from OSRoot.
'use client'

import { logSecEvent } from '@/lib/os/comm'

let installed = false

export function installSecurityGuard(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  let lastLog = 0

  // right-click / long-press native menu — suppressed EVERYWHERE, fully silent
  // (no toast, no feed entry: right-click is a normal interaction, not a threat)
  document.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault()
    },
    true,
  )

  // DevTools shortcuts — F12 · Ctrl/Cmd+Shift+I/J/C/K/E · Ctrl/Cmd+U (view-source)
  // blocked silently + a rate-limited entry into the Velikan security feed only
  window.addEventListener(
    'keydown',
    (e) => {
      const k = (e.key || '').toLowerCase()
      const mod = e.ctrlKey || e.metaKey
      const blocked =
        k === 'f12' ||
        (mod && e.shiftKey && ['i', 'j', 'c', 'k', 'e'].includes(k)) ||
        (mod && !e.shiftKey && k === 'u')
      if (!blocked) return
      e.preventDefault()
      e.stopPropagation()
      const now = Date.now()
      if (now - lastLog < 4000) return // never flood the feed
      lastLog = now
      try {
        logSecEvent('shield', `DevTools shortcut blocked (${e.key})`, 'block')
      } catch {
        /* security feed is best-effort */
      }
    },
    true,
  )
}

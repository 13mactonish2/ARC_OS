# REDSEC OS (ARC OS)

REDSEC is a **browser-based desktop operating system**: a full Debian-style desktop environment running entirely inside a Next.js 16 app — GRUB-style boot sequence, login screen, draggable desktop, taskbar, window manager, 60+ built-in apps, a virtual file system, an app store, a kernel security subsystem ("Black Sea") and a factory-reset lifecycle.

**Try it now — no install needed:** copy and paste this link into your web browser (Google Chrome recommended):

> ### https://s1ht4704n0e0-d.space-z.ai/

---

## What's new

Every update to the OS is documented here, grouped by area — **apps · UI · OS core · security**.

### Audio Fly v2 — music app refresh (latest)
- **Apps** — the music app header no longer shows "Audio Fly — Metro home" or the "14 tracks · unlimited — scroll for more" count line. The home header is now a clean time-based greeting (Good morning / Good afternoon / Good evening / Late night listening), and the Liked tab simply shows its song count.
- **UI** — premium streaming-app look across the music app: deep charcoal surfaces, signature green accents, circular green play buttons, green seek bar, green liked hearts and a dark now-playing bar.
- **Apps / logic** — streaming-style autoplay: when the queue reaches its end, the radio chain automatically appends a fresh page of similar tracks and keeps playing, so the music never stops.
- **Unchanged on purpose** — the Windows-Phone-8 METRO tile home is exactly the same, and the YouTube Music-powered backend (real-time search, full-length songs, official artist verification, live view/like counts) is untouched. No third-party music branding appears anywhere in the app.

---

## Features

### Desktop shell
- GRUB-style boot sequence + BIOS screen, login / guest sign-in, profile avatars
- Full window manager: draggable, resizable windows, minimize / maximize, taskbar with pinned apps
- Task View, Snap Assist (window snapping), window switcher, right-click desktop context menu
- On-screen keyboard, wallpapers / themes, dark mode, wide-screen pairing for external displays
- Start menu, app store with install / uninstall, factory reset + server-side backup & restore (Backup Center)

### Security subsystem — Kernel "Black Sea"
- Black Sea security panel with live incident feed (server-persisted security events)
- Shield antivirus scanner, SuiteGuard office protection, AI Doctor Guard
- Secret Tab (hidden vault area), Owner Console + Owner Vault Gate, storage gates
- Update system with security patches, kernel lockdown, device fleet update toasts

### Files & system
- File Explorer (virtual file system), Bin (recycle bin), Backup Center
- Task Manager, Performance monitor, Booster, Cleaner, Driver Hub, GPU panel, InterCore
- Disk/storage management, system info with full device specs

### Internet & communication
- Browser (Chrome-style with tabs), Mail client with sign-in, Chat (NeoChat)
- Video Call, News app with feed, Weather, YouTube app, Maps + Glonass satellite navigation
- Website builder app, web games portal

### Media & entertainment — Mirror TV
- **Mirror TV entertainment center**: upload any movie / series / live TV / sports / music link — it is stored server-side (Prisma + SQLite) and automatically distributed to every device signed into the OS
- Built-in universal player (HLS streaming support), watchdog auto-recovery
- Cone Net Stream + Cone Player, M Video, Songs / music player, Camera, Voice (speech synthesis + recognition)
- ffmpeg.wasm media engine built in

### Productivity (full Office suite)
- Word (documents), Sheet (spreadsheets), Presentation (slides), PDF Viewer
- Notes + Quick Notes widget, Calendar, Clock, Calculator, Graphing Calculator, Kalkulator
- Unit Converter, Dictionary, Paint, Photo Editor (filters / adjustments)

### Developer tools
- Terminal (Debian-style shell), Code Studio (Monaco editor, multi-language)
- C Lang app, OneCompiler (online compiler), OpenCode workspace, DevKit panel
- Built-in AI assistant app, AI activation modal

### Gaming
- Gaming Hub, 2048, Gamepad panel, installable games via the App Store

### Mobile companion
- Mobile Link — virtual phone companion, QR + pairing-code screen pairing to control / mirror the OS from a phone

---

## Tech stack

- **Next.js 16** (App Router) + **TypeScript 5**
- **Prisma ORM (SQLite)** for persistent server state (users, entertainment links, security incidents, uploads)
- **Tailwind CSS 4** + shadcn/ui (New York) + Lucide icons
- **Bun** runtime, socket.io mini-services, hls.js for streaming, ffmpeg.wasm for media

---

## Run locally on your PC (Bun)

### 1. Install Bun (one time)

**Linux / macOS:**
```bash
curl -fsSL https://bun.sh/install | bash
```

**Windows (PowerShell, admin):**
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

Verify it works:
```bash
bun --version
```

### 2. Get the source
Clone or download this repository, then open a terminal inside the project folder.

### 3. Install dependencies
```bash
bun install
```

### 4. Create the database
```bash
bun run db:push
```
(This generates the Prisma/SQLite database file used for users, files, Mirror TV links and security events.)

### 5. Start the OS
```bash
bun run dev
```

### 6. Open it
Copy and paste this address into Google Chrome (or any modern browser):

```
http://localhost:3000
```

The desktop will boot with the GRUB-style boot sequence and drop you at the login screen.

### One-liner (after `bun install`)
```bash
bun run db:push && bun run dev
```

### Troubleshooting
- **Port 3000 busy** — stop the other process or run `bun run dev:danger` after freeing the port.
- **Database errors** — re-run `bun run db:push`.
- **ffmpeg media features** — `public/ffmpeg/ffmpeg-core.wasm` (~32 MB) is regenerated automatically from `node_modules/@ffmpeg/core` after `bun install`.

---

## Repository layout

- `src/app` — pages + REST API routes (backend)
- `src/components/os` — the desktop OS (shell, window manager, 60+ apps)
- `src/lib/os` — OS core logic (virtual FS, store, security, codecs)
- `prisma` — database schema
- `scripts` — deploy & QA tooling
- `mini-services` — independent socket.io services
- `public` — static assets (ffmpeg.wasm runtime, media, DOS box)

## Notes

- `.env`, dev logs, `gitdata/` and build output are intentionally not committed.
- [`FILE-MANIFEST.md`](./FILE-MANIFEST.md) lists all source files with exact sizes.

# REDSEC OS

REDSEC is a browser-based desktop operating system: a full Debian-style desktop environment running entirely inside a Next.js 16 app — boot sequence, login, draggable desktop, taskbar, window manager, 40+ built-in apps, a virtual file system, an app store, a security subsystem ("Black Sea") and a factory-reset lifecycle.

## Tech stack

- Next.js 16 (App Router) + TypeScript 5
- Prisma ORM (SQLite) for persistent server state (users, entertainment links, security incidents, uploads)
- Tailwind CSS 4 + shadcn/ui (New York) + Lucide icons
- Bun runtime, socket.io mini-services, hls.js for streaming

## Highlights

- 40+ apps: File Explorer, Debian-style Terminal, Shield antivirus, Browser, Mail, Chat, Code Studio, Office suite (Word / Sheet / Presentation), Photo Editor, Music, News, Gaming Hub, Mirror TV entertainment center (upload any movie / series / live / sports / music link — stored server-side and synced to every device), Private vault, Mobile phone companion and more
- Server-side data survives factory resets (Prisma/SQLite), so uploaded entertainment links are saved forever
- Kernel v7.0 "Black Sea" security layer, GRUB-style boot, update system with security patches

## Repository layout

- `src/app` — pages + REST API routes (backend)
- `src/components/os` — the desktop OS (shell, window manager, apps)
- `src/lib` — OS core logic (virtual FS, store, security, codecs)
- `prisma` — database schema
- `scripts` — deploy & QA tooling
- `mini-services` — independent socket.io services
- `public` — static assets (ffmpeg.wasm runtime, media, DOS box)

## Run locally

```
bun install
bun run db:push
bun run dev   # http://localhost:3000
```

## Full source snapshot

A complete snapshot of the entire project (including binary assets: ffmpeg.wasm, media, sample documents) is served by the app itself at `/api/srczip` (file: `public/redsec-src.zip`).

## Notes

- `.env`, dev logs, `gitdata/` (fork test data) and build output are intentionally not included.
- `public/ffmpeg/ffmpeg-core.wasm` (~32MB) exceeds GitHub's browser-upload limit; it is regenerable from `node_modules/@ffmpeg/core` after `bun install`.

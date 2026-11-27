# RE Falcon v3.0 — App Development Spec (READ THIS FULLY BEFORE CODING)

You are building apps for a browser-based desktop OS called **RE Falcon v3.0** built with Next.js 16 App Router + TypeScript + Tailwind CSS 4 (dark theme OS). The OS core is DONE. You only write/replace app component files listed in YOUR task.

## Golden rules
- TypeScript, `'use client'` at top of every component file. NO `any` where avoidable.
- Dark OS aesthetic: backgrounds `#10141f`, panels `#161b28`, borders `border-white/10`, text `text-slate-100/300`, accent emerald/teal. NO blue/indigo primary.
- Do NOT modify any file outside the ones your task lists (except appending to /home/z/my-project/worklog.md).
- Do NOT run `bun run build`. You may run `bun run lint` scoped errors for YOUR files.
- Do NOT edit `src/lib/os/*` or other agents' app files. If you need a missing helper, implement it locally in your own file.
- Keep components self-contained; no test files.

## Core APIs (already exist — import and use)

### Store `import { useOS, APP_META, osNow } from '@/lib/os/store'`
- `const s = useOS()` → state fields: `wifi, bluetooth, airplane, nightLight, brightness, volume, sharing, drivers {sound,internet,sharing,gpu}, username, password, withPrivate, desktopItems, installedApps, updates, taskbarPinned, notifications, windows, focusedWin, keyboardOpen, voiceEnabled …`
- Actions: `openApp(appId, args?, title?)`, `closeWindow(winId)`, `focusWindow(winId)`, `minimizeWindow(winId)`, `toggleMaximize(winId)`, `notify({title, body?, emoji?, kind?})`, `set({partialState})`, `installApp(app)`, `uninstallApp(id)`, `togglePin(appId)`, `executeVoiceCommand(text)`, `factoryReset(keepUpdates: boolean)`, `addUpdate({id,name,kind,content,at})`, `removeUpdate(id)`, `set({ manualClock: {base,at}, autoTime })`, `installDesktopApp(installedApp)`.
- `useOS.getState()` for imperative access outside React.
- Never persist blobs in store; files go to the FS below.

### File System `import { fs, fmtSize } from '@/lib/os/fs'`
- Root folder ids: `'desktop' | 'documents' | 'downloads' | 'photos' | 'videos' | 'screenshots' | 'music' | 'os' | 'bin'`
- `fs.children(parentId)` → FSNode[] (folders+files, trashed excluded; bin keeps trashed ones)
- `fs.get(id)`, `fs.createFolder(parentId, name)` → Promise<FSNode>
- `fs.addFile(parentId, name, { blob?, url?, mime?, size?, meta? })` → Promise<FSNode>  ← uploads/saves
- `fs.rename(id, name)`, `fs.trash(id)` (→ Bin), `fs.restore(id)`, `fs.purge(id)`, `fs.emptyBin()`
- `fs.blobUrl(nodeId)` → Promise<string> (object URL of stored blob), `fs.getBlob(nodeId)`
- `fs.readText(node)` → Promise<string> (meta.text or blob text)
- `fs.search(q)`, `fs.usedSize()`, `fs.fileCount()`, `fs.path(id)`
- Predicates: `fs.isImage(n)`, `fs.isVideo(n)`, `fs.isPdf(n)`, `fs.isAudio(n)`, `fs.isText(n)`
- FSNode: `{ id, name, kind:'file'|'folder', parent, mime?, size?, url?, trashed?, createdAt, modifiedAt, meta? }`
- Stock media seeded: photos `photo1..photo30` (meta.kind='photo', remote url), videos `video1`,`video2` (meta.kind='video'), OS files in folder 'os' with `meta.locked=true, meta.kind='osfile', meta.text`.

### Voice typing (real, already wired by OS)
- `import { useVoiceTyping } from './_shared'` — `useVoiceTyping((text) => {...})` fires when user speaks while your window is focused, or says "type X".
- Use it in editor-like apps (Notes, Word, Sheet, Terminal, Browser search) to insert text at caret.

### Shared UI `import { AppShell, Toolbar, TBtn, EmptyState, Loading, WifiGate, useClock, saveImageToPhotos, saveImageToScreenshots, fmtBytes, useNodeUrl } from './_shared'`
- `AppShell` = full-size dark flex-col container. `Toolbar` = top bar row. `TBtn` = small toolbar button.
- `WifiGate({children, app:"YouTube"})` — wraps ENTIRE web app content; shows "Turn on WiFi — it is offline" screen when wifi/airplane/internet-driver off. REQUIRED for every internet app.
- `saveImageToPhotos(blob, name, kind)` / `saveImageToScreenshots(blob, name)` — save + notify.
- `useVoiceTyping(onText)` as above.

### Media capture `import { takeScreenshot } from '@/lib/os/media'` (global P key already does OS screenshots — don't rebind).

## App component contract
Every app file default-exports: `export default function MyApp({ winId, args }: { winId: string; args?: Record<string, unknown> })`.
`args` may carry e.g. `{ folder: 'photos' }` or `{ search: 'query' }` or `{ nodeId }`. Use `useOS((s)=>s.focusedWin) === winId` to know if focused.
If your app needs a window title change: `useOS.getState().setWindowTitle(winId, 'New Title')` — but don't fight the frame.

## Design quality bar (MANDATORY)
- 44px+ touch targets, rounded-xl panels, subtle borders, focus rings, hover states, empty states, loading states.
- Long lists: `max-h-96 overflow-y-auto os-scroll` or flex-1 scroll area.
- No page errors: guard against missing data, wrap async in try/catch with notify on failure.
- Apps fill window: `h-full` layouts, `flex-1 min-h-0` scroll zones.
- Add polish: keyboard shortcuts inside app where natural (Enter to search, Esc to close pickers).

## worklog (MANDATORY)
Before coding read `/home/z/my-project/worklog.md`. After finishing, APPEND (never overwrite) a section:
```
---
Task ID: <YOUR_ID>
Agent: <your agent name>
Task: <short>

Work Log:
- ...

Stage Summary:
- files created/changed, key decisions
```

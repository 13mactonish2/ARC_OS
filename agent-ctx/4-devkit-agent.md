# Task 4 — REDSEC DevKit (work record)

Agent: devkit-agent (Task ID 4)
Status: DONE — all three files created, gates green.

## Files created (FILE OWNERSHIP respected — nothing else touched)

1. `src/app/api/devkit/exec/route.ts` — real server-side Node.js execution
   - `export const runtime = 'nodejs'`; POST JSON `{ code }`.
   - `node:vm` sandbox: `vm.Script` (filename `redsec-sandbox.js`) +
     `runInContext({ timeout: 2000, displayErrors: true })`.
   - Captured console: log/info/debug -> plain line, warn -> `[warn] ...`,
     error -> `[error] ...`; non-strings via `util.inspect` (depth 2).
   - Timers: setTimeout/clearTimeout/setInterval/clearInterval tracked in a
     pending set; after the sync run the route drains pending timers
     (poll 20ms) until none remain or the 5s async deadline, then kills
     leftovers so nothing fires after the response.
   - Sandbox globals: console, timers, queueMicrotask, Buffer, TextEncoder/
     TextDecoder, structuredClone, `module`/`exports` shim, `require` shim
     allowing ONLY `events` (node:events EventEmitter) and `util`
     (inspect/format). Everything else -> thrown error "blocked in the
     REDSEC sandbox". NO network, NO fs, NO process/env.
   - Hard limits: code <= 20,000 chars (413), output capped at 200 lines
     (appends `[info] output truncated...`), rateLimit(clientKey(req,
     'devkit-exec'), 20, 60_000) via `@/lib/server/security`, logSec() rows
     feed the Velikan security audit feed.
   - Errors: cross-realm vm errors are not `instanceof Error` under bun, so
     `errText()` falls back to `String(e)` ("TypeError: ..."), and
     `extractStackLine()` parses `redsec-sandbox.js:line:col` from the stack.
     Response `{ ok:false, error, stackLine, ms, logs }`.
   - Success: `{ ok:true, logs:string[], ms }`.
   - No eval/Function anywhere; verified: no fs/process/env imports.

2. `src/app/api/devkit/ping/route.ts` — endpoint health prober
   - `GET ?target=<name>`; `runtime = 'nodejs'`; rateLimit 90/min
     (clientKey 'devkit-ping'); 4s AbortController timeout; dependency-free.
   - Static catalog (25 services) mirroring the REAL api surface:
     ai/chat, ai/asr, ai/tts, code/run, code/runtimes, opencode/run,
     opencode/toolchain, sec/feed, weather, news, ytsearch, webgames, github,
     git, chat/rooms, chat/lobby, files, proxy, share, owner/track, geocode,
     glonass, music, devkit/exec, devkit/ping (methods verified by grepping
     every route file; 'discord' does not exist so it was omitted).
   - Probe is LOCAL ONLY: one real self-request to
     `http://127.0.0.1:${PORT||3000}/api/sec/feed` measured in ms ->
     `{ ok:true, name, desc, method, path, ms, httpStatus, status:
     'operational'|'degraded', probedAt }`. Unknown target -> 404
     `unknown_service`. No target -> catalog + one health reading.
   - Verified live from the harness: `sec/feed` -> HTTP 200 operational
     (ms ~12-49).

3. `src/components/os/apps/DevKitApp.tsx` — window app (AppProps
   `{ winId, args }` pattern, AppShell/Toolbar/TBtn from `_shared.tsx`,
   dark slate theme, lucide icons, cyan/emerald/amber/rose accents, no new
   deps, no emojis). Left icon tab rail; four tabs:

   TAB 1 Studio — Theme Studio (live)
   - Live preview strip: mini window titlebar rendering the EXACT button
     cluster (pos/shape/size/gap/glyph/order/colors) + mini panel strip using
     the real panel background rules (gradient > bg override > taskbarColor),
     plus theme/panel swatch chips.
   - Colors: themeBg + taskbarColor (color input + hex text, draft-buffer
     pattern so external store changes always win — avoids setState-in-effect).
   - Panel background: panelBgOverride toggle, panelBgColor, panelBgOpacity
     slider (40-100), panelGradient toggle, panelGradTop/panelGradBottom —
     all real store fields (verified in store.ts/types.ts; there is NO top-level
     `accent` or `fontScale` field, so none were invented).
   - Window buttons: winBtnPos (right/center/left), winBtnShape
     (macos/circle/square/rounded/pill), winBtnOrder (min-max-close /
     close-max-min), winBtnGlyph toggle, winBtnSize 9-20, winBtnGap 2-16,
     three color pickers (min/max/close). Defaults match store exactly
     (13px/7px, rounded, right, #f6c343/#3ecf6f/#f4574d).
   - Wallpaper: 18 thumbnails stock:0..stock:17 using the REAL formula from
     useWallpaper.ts (stock:0 -> /wallpapers/bluestringray.jpg, stock:N ->
     picsum seed redsec6-w{N}) with a deterministic CSS-gradient fallback
     layer + onError hide; grid scrolls (max-h-64 overflow-y-auto); click
     patches `wallpaper`.
   - "Reset" restores Black Sea defaults (themeBg #0f172a, taskbarColor
     #0a1424, stock:0, win button defaults) + notify toast.
   - Everything applies instantly via useOS.setState (store persists).

   TAB 2 Node.js
   - Note in header: "Server-side Node.js (vm sandbox) — REDSEC BlackSea
     runtime". Mono textarea with line-number gutter (scroll-synced),
     Ctrl/Cmd+Enter runs, sample select, Run (spinner while busy), Clear,
     `exit 0 / error · exec N ms` chip.
   - Samples (5): Hello Node (Buffer/TextDecoder), EventEmitter
     (require('events')), Algorithm (fibonacci), Async timers (chained
     setTimeout + microtask + warn), JSON transformer.
   - Output pane (scrolling): stdout slate, `[warn]` amber, `[error]` rose,
     `[info]` cyan; error pane shows real exception message + stack line.

   TAB 3 API Hub
   - 25-service catalog (mirrors ping route) with per-row Ping + "Ping all"
     (sequential), status dot (emerald/rose/gray), `ms · HTTP xxx` chip,
     "N/M up" counter; list scrolls (max-h-96 overflow-y-auto).
   - Quick-launch tiles (real APP_META ids only): Streaming -> youtube +
     coneplayer; Gaming -> gaming; Chat -> chat; Online work -> opencode +
     onecompiler; Browser -> browser; Terminal -> terminal. All open via
     `useOS.getState().openApp(id)`.
   - Multitasking strip: OpenCode / Term X / File Manager buttons + "Open all
     three" + hint "Drag a window to a screen edge to snap — multitask view:
     Super+Tab".

   TAB 4 OS State
   - Pretty JSON of useOS.getState() (functions stripped) computed at mount
     (tab remounts -> always fresh) + Refresh button; max-h-96 overflow-auto
     custom-scrollbar pre; Copy (clipboard + toast) and Download
     (redsec-state-<ts>.json).
   - Import: paste JSON -> Apply does a SHALLOW MERGE filtered to keys that
     already exist (`k in useOS.getState()`), drops function values, notifies
     "State applied (N keys merged)"; inline errors for bad JSON.

## Quality gates
- `bunx eslint <my 3 files>` -> exit 0, zero findings (full-project lint
  exceeds the 5-min command timeout — this project is huge; my files are
  clean under the same config).
- Full-project `tsc --noEmit` is OOM-killed on this 4 GB sandbox (exit 137,
  even with --max-old-space-size=6144) — NOT caused by my files. Ran a scoped
  tsconfig (extends project tsconfig, includes my 3 files + their import
  graph: store.ts, fs.ts, types.ts, security.ts, _shared.tsx):
  `bunx tsc --noEmit -p /tmp/tsconfig.devkit.json` -> exit 0. So
  `tsc | grep DevKitApp` and `| grep devkit` are both empty.
- Runtime-verified the REAL route handlers with a bun harness (mock Request):
  events/util shims, async timer drain (chain logs arrive), syntax error,
  runtime error, vm 2s timeout, blocked require, empty code 400, util.format,
  errors inside timer callbacks, ping operational/degraded/404/catalog —
  all correct.
- Lucide icons verified to exist via `import('lucide-react')` check.

## Notes for the wiring agent (Task: registry)
- Default export: `DevKitApp` in `src/components/os/apps/DevKitApp.tsx`
  (props `{ winId, args }`). Suggested APP_META id: `devkit`.
- Routes are new: POST /api/devkit/exec, GET /api/devkit/ping?target=.
  They appear after the next serve-production rebuild (the auto server
  builds on source change; verified handlers directly meanwhile).

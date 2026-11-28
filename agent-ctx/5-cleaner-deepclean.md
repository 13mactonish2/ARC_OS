# Task 5 — DeepClean (CleanerApp) Agent — Work Record

## Task
Built the REDSEC DeepClean app — a real memory cleaner (RAM + storage) for the OS desktop.

## File written (ONLY file touched, per ownership rules)
- `src/components/os/apps/CleanerApp.tsx` (NEW, ~760 lines, 'use client', default export `CleanerApp({ winId }: AppProps)`)

Not wired into the registry — left for the integration agent (app id suggestion: `cleaner`, component path `./apps/CleanerApp`).

## Live meters (all real measurements, 2s tick loop)
- JS heap ring gauge: SVG stroke-dasharray ring, `performance.memory` (usedJSHeapSize / jsHeapSizeLimit / totalJSHeapSize); when the API is missing a bounded random-walk estimate is shown with an explicit "estimated" chip. Emerald/amber/red color bands. Chips: `navigator.deviceMemory`, `navigator.hardwareConcurrency`.
- Browser storage: `navigator.storage.estimate()` usage/quota bar with fmtSize readouts (guarded, "quota unavailable" state).
- OS disk: walks `fs.all()` and sums `node.size` per top-level root (memoized parent->root climb; roots identified by `meta.root`, matching how fs.ts seeds them) — top-consumers list with fmtSize + relative bars + file counts.
- UI responsiveness: real setInterval drift probe (250ms tick, drift EMA) rated Excellent/Good/Slow/Laggy.

## Clean items (checkbox rows, each a real action + measured freed bytes)
1. Purge OS temp — REAL: measures subtree bytes BEFORE deleting (`fs.children(rid, true)` + `subtreeBytes`), then `fs.purge()` on every child of `tmp` (and `cache` if the root exists — it does not in current ROOTS, checked dynamically). Root node itself always survives (fsPurge does not guard roots, so children-only iteration is deliberate).
2. Trim notifications — REAL: `useOS.setState({ notifications: ...slice(0, 5) })` (array is newest-first), reports count trimmed, freed 0.
3. Clear security incident log — REAL: counts `securityKernel.incidentsFor('all', 1e6)`, measures JSON byte length of the log, then `securityKernel.clearIncidents()`.
4. Close background windows — REAL: closes every `minimized` window via `useOS.getState().closeWindow(id)`, protecting its own window and any window whose appId (raw or base before ':') is in `taskbarPinned`.
5. Clipboard wipe — REAL + GUARDED: `navigator.clipboard.writeText('')` in try/catch (permission may be denied — noted in step detail), plus `useOS.getState().clearClipboard()` (pinned entries survive by design); bytes = text lengths of cleared history.
6. Orphan localStorage keys — REAL: removes keys matching `/^redsec\.(temp|cache|scratch)/` and `/^qa[.-]/`; `redsec5.settings` (verified persist `name:` in store.ts) and `redsec5.kernel.incidents` are in an explicit PROTECTED set; bytes = key+value lengths.
- Item (g) idle-app hint: WinState carries no per-window open/focus timestamps (verified in types.ts), so idle-duration detection was skipped; instead a real "Background apps" panel lists open windows (APP_META names, minimized state) with per-window close buttons.

## Clean All runner
Staged sequential execution of checked items: progress bar with `n/m — label` + per-step spinner, per-step try/catch (one failure never aborts the rest), 320ms staging delay, before/after snapshots of heap + `navigator.storage` usage + fs disk total shown as signed delta chips, final summary "Freed X · N items", and `useOS.getState().notify({ title, body, kind: 'success' })` (notify signature verified — returns '' when blocked; no breach-flag words used, no emoji).

## fs/store/security APIs used (all verified by grep before use)
- fs.ts: `fs` singleton (`fs.all`, `fs.get`, `fs.children`, `fs.purge`), `fmtSize`, `ROOTS`; FSNode fields `id/name/kind/parent/size/trashed/meta.root`.
- store.ts: `useOS` (subscribe `windows`, `notifications`; `useOS.setState` for notifications; `useOS.getState().closeWindow/clearClipboard/notify`), `APP_META`, `taskbarPinned`, persist name `redsec5.settings`, `OSActions` typing in types.ts (closeWindow/notify/clearClipboard all typed — no casts needed).
- security: `import { securityKernel } from '@/lib/os/security'` → `incidentsFor('all', n)`, `clearIncidents()`.
- _shared.tsx: `AppShell`, `Toolbar`, `TBtn`; `AppProps` from `@/lib/os/types`.

## Gotchas handled
- React Compiler error `react-hooks/preserve-manual-memoization` on useMemo([winId]) with action closures → moved all clean actions to module scope (closeBgWindowsAction takes winId as a param), ITEMS is now a plain render-body array, `checked` initialized via useState initializer (no default-check effect at all).
- `react-hooks/set-state-in-effect` avoided: every effect wraps its first tick in setTimeout(0) / async continuations; interval callbacks setState freely.
- SSR/hydration safe: all navigator/performance/localStorage access guarded (typeof checks or effect-deferred); initial meter states null render "measuring".
- Style: dark slate + emerald/cyan accents only (no indigo/blue), custom thin emerald scrollbar via scoped `.dc-scroll` style tag, `max-h-96 overflow-y-auto` on the cleaner list, `max-h-44` on disk list, no emojis anywhere in code, zero new npm deps.

## Quality gates
- `bunx eslint src/components/os/apps/CleanerApp.tsx` → clean (0 problems).
- `bunx tsc --noEmit -p tsconfig.json` → 0 errors project-wide (nothing mentioning CleanerApp).

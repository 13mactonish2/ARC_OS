# Task 22 — Lock Screen Security Upgrade — Work Record

## Task
REDSEC OS v5.0 lock screen upgrade (Task ID 22): power buttons (shutdown/restart), escalating lockout (5 wrongs → 30s → 60s → 1 day, persisted), lock-screen recovery terminal with `lock` QR remote-unlock (6-digit code), mobile /unlock page with Show Password (10s auto-hide) + remote Factory Reset.

## Files written/changed (all under /home/z/my-project)
NEW:
- `src/app/api/os/lockpair/route.ts` — in-memory pairing sessions (module Map, TTL 10 min, sweep per request + 60s grace for 410/expired). POST create/reveal/factory/complete, GET ?token= status. `runtime='nodejs'`, `dynamic='force-dynamic'`. Token = 32-char hex, code = zero-padded 6-digit.
- `public/unlock/index.html` — self-contained mobile page (no CDN): dark #09090b / rose #e11d48 / emerald #10b981, mobile-first, ≥48px targets, safe-area. States: dead / main (code 3+3 tap-to-copy, Show Password, Factory Reset) / reveal (10s shrinking bar + countdown → auto-hide → "Auto-locked"; Factory reset button inside reveal view) / confirm sheet / armed. Status line polls GET every 4s. Inline SVG icons only.

EDITED:
- `src/lib/os/types.ts` — OSStore +`lockScreen: { wrong; level; until }` (persisted section, next to osLock); OSActions +`setLockScreen`.
- `src/lib/os/store.ts` — initial +`lockScreen: { wrong: 0, level: 0, until: 0 }`; action `setLockScreen` next to `setOsLock`. Persist version NOT bumped (stays 14) — shallow-merge default; lockScreen not in partialize exclusions → persisted (survives reloads, verified).
- `next.config.ts` — beforeFiles rewrite `{ source: '/unlock', destination: '/unlock/index.html' }` below /website.
- `src/components/os/OSRoot.tsx` — imports +RefreshCw, SquareTerminal (exists in lucide 0.525), +`import QRCode from 'qrcode'`; LockScreen rewritten (power cluster bottom-right above caption: Shutdown rose / Restart amber / Terminal emerald → shutdown()/restart()/LockTerminal; escalating lockout in unlock() per spec; hardLocked UI with M:SS countdown; 1-4-wrongs hint; err/shake kept); new LockPowerBtn + LockTerminal (z-9800, X-only chrome, help/lock/clear/exit, QR via QRCode.toDataURL(origin/unlock?t=,240px), expiry countdown, 6-digit verify → reset lockScreen + POST complete + unlock; 3s polling with cleanup → factory_reset fires factoryReset(false); deduped offline line; expiry handling).

## Key decisions / deviations
- GET /api/os/lockpair ALSO returns `code` for active sessions (spec listed no code field): the QR only carries the token, so the phone page cannot display the 6-digit code otherwise. Safe — the token already grants reveal (password).
- Sweep keeps expired sessions 60s in a grace window so POST returns 410/'expired' (vs 404) meaningfully, then hard-deletes.
- Sessions are in-memory by spec: server rebuild/restart loses them → PC terminal prints 'pairing session lost — type lock again'.
- Lockout countdown uses real Date.now() (not the simulated manual clock) — useClock(1000) only drives re-render cadence.
- react-hooks/set-state-in-effect (error rule) avoided: setState only in async continuations / interval callbacks; QR cleared where pair is cleared.

## Verification (all done)
- `bun run lint` → clean; `bunx tsc --noEmit` filtered to my files → clean.
- Build/restart via mandated procedure; BUILD_ID TjbmkkhvYdf72I6dMlHC1; /api/os/lockpair in route table; /unlock 200.
- curl: create→ok + 6-digit zero-padded code; GET active; reveal→password; factory→GET action=factory_reset; complete→unlocked:true; unknown token→404 session_not_found; bad action→400; empty-password create ok.
- agent-browser E2E: full OOBE→desktop→lock → 3 power buttons verified; 5 wrong→"Too many wrong attempts / Try again in 0:29" (level 1); 5 more→0:59 (level 2); RELOAD+reboot+login → lock screen still "Try again in 0:15" (UI proof of persistence); terminal help/unknown/lock; QR+URL+countdown+code input rendered; wrong code rejected; correct code unlocked (server unlocked:true); remote factory via curl while terminal open → OS wiped within 3s → rebooted to OOBE; mobile page code display, reveal 10s auto-hide + Auto-locked note, confirm sheet cancel/erase, armed state, dead state on bad token.
- VLM screenshots confirmed lock screen cluster styling and terminal QR card layout. dev.log: zero runtime errors from this task.

## Handoff notes
- Don't bump persist version; `osLock`/`setOsLock` (FileExplorer private vault) untouched.
- Clipboard tap-copy shows a graceful fallback message in headless browsers (no permission); real mobile browsers use navigator.clipboard fine.
- After lock-screen Restart, the OS reboots to login and the desktop re-locks (existing `locked` flag is not cleared by restart() — per spec handlers were called as-is).

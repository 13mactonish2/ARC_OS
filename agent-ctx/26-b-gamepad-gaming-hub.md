# Task 26-b — Gamepad support in the Gaming Hub (GamingHub.tsx)

Agent: gamepad-hub-agent (Z.ai Code subagent)
Status: DONE — lint clean, tsc clean for owned files, awaiting main-agent rebuild + E2E

## What was built (all inside src/components/os/apps/GamingHub.tsx ONLY)

1. **Controllers tab (new `view === 'pads'`)**
   - View union extended: `'lib' | 'frame' | 'emu' | 'bios' | 'cloud' | 'pads'`.
   - Entry points: "Controllers" button in the library toolbar (Gamepad icon + emerald pad-count chip, hidden md:text on tiny screens) + the live pad-status chip is also clickable.
   - Driver NOT installed → driver card: "Gamepad driver required" + full universal-support body text (wired USB, wireless BT/dongle, DualSense/DualShock PS3/PS4/PS5, PS1/PS2 USB adapters, Xbox, generic HID) + emerald Install button → `installGamepadDriver()`.
   - Driver installed → live panel:
     - Per-pad cards: truncated `gp.id` (full id in `title`), Wireless/Wired chip, `standard`/`heuristic` mapping chip, `PAD n` index chip.
     - Live test row: one small square per reported button index (16+), lights emerald + glow when pressed.
     - Left-stick viz: 64px square with crosshair, dot positioned by `axes[0]/axes[1]` (±26px radius).
     - Face cluster A/B/X/Y diamond via `padButtons(gp)`; LB/RB trigger bars (width 100%/0 when pressed).
     - "Vibration test" button → `rumble(gp.index)`; inline result "Rumble sent" / "No haptics on this pad" auto-clears after 2s (timer map ref, cleaned up on unmount).
     - No pad → dim placeholder "No controller detected — connect one or press any button to wake it."
     - Subtle rose-outline "Remove driver" → `uninstallGamepadDriver()`.

2. **Pad → game input bridge**
   - Hooked to the same source of truth as `gameMode.set(true/false)` (`gameRunning` derived from `gameModeTitle`) AND `drivers.gamepad`.
   - `bridgeRef` guard → `startKeyBridge()` starts exactly once per run; stopped when the game stops (error cards / goHome / view exit), when the driver is removed, and on hub unmount. `bridgeActive` state mirrors it for UI.
   - Chip "🎮 Controller bridge active" (emerald, title-tooltip explains mapping) rendered in ALL THREE running-view headers: emulator toolbar, Cloud Play toolbar, web-frame toolbar. Hidden on the smallest screens (`hidden sm:flex`) like the neighbouring FIRMWARE chip.

3. **Header chip**
   - Library toolbar gets a compact Gamepad2 status button: emerald icon + green dot + pad count when ≥1 pad connected; gray when none/driver missing. Tooltip lists connected pad names (or driver-missing hint). Clicking opens the Controllers tab.
   - Live subscription at component top: `subscribeGamepads(() => setHubPads(getGamepads()))` only while driver installed (effect unsubscribes + clears list otherwise) — the gamepad lib's rAF loop only runs while someone listens.

4. **Nothing else touched** — ROM manager, pre-flight core probing, EmulatorJS lifecycle, BIOS Studio, Cloud Play, web frames, GameBanana-like flows, gameMode wiring: all original code untouched; additions are purely additive (new imports, module-level `FaceBtn`/`TriggerBar` helpers, new hooks before the first early-return, new view block between BIOS view and frame view).

## Notes for the main agent
- New lucide imports used: `Gamepad`, `Usb`, `Vibrate` (Gamepad2 was already the app icon).
- No driver/gamepad store changes needed — reads `drivers.gamepad`, calls the pre-built install/uninstall/bridge/rumble APIs.
- tsc: the 4 pre-existing project type errors (skills/*, api/os/llm/route.ts) are untouched/unrelated; zero errors in GamingHub.tsx or gamepad.ts.
- dev.log: no compile/runtime errors from this change.

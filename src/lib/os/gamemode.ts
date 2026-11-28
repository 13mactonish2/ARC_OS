// REDSEC v5.0 — OS game-mode registry (Task 24).
// While a game actually RUNS (Gaming Hub emulator, web-game frame, cloud
// stream, or a built-in game app) the OS pauses its global keyboard shortcuts
// so the game owns the keyboard. Merely opening the hub never activates it.
//
// Tiny dependency-free external store — importable from both the OS shell
// (OSRoot) and game apps (GamingHub / Game2048App) with zero circular imports.
// Deliberately NOT part of the persisted zustand store: game mode is
// inherently transient, so persist stays at v15 and nothing is written to it.

export interface GameModeState {
  active: boolean
  title: string | null
}

let state: GameModeState = { active: false, title: null }
const listeners = new Set<() => void>()

export const gameMode = {
  get: () => state,
  set(active: boolean, title: string | null = null) {
    if (state.active === active && state.title === title) return
    state = { active, title }
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}

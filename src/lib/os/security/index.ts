// REDSEC 6.0 — Kernel Guard assembly point
//
//   src/lib/os/security/
//     ├── kernel.ts        ← incident bus, seal helpers, Task Manager feed
//     ├── anti-cheat.ts    ← settings seal (SHA-256) + native/prototype integrity + auto-heal
//     ├── anti-hack.ts     ← fetch/XHR IDS allowlist + DOM injection + DevTools/automation
//     ├── anti-breach.ts   ← storage/clipboard/foreign-message guards + ransomware watch
//     ├── anti-lag.ts      ← real FPS/long-task/heap telemetry + adaptive perf mode
//     ├── anti-spyware.ts  ← NEW 6.0 — beacon guard, Permissions audit, sensor surface
//     ├── anti-glitch.ts   ← NEW 6.0 — GlitchShield rendering watchdog & auto-repair
//     └── index.ts         ← this file: registers the daemons, boots the kernel
//
// OSRoot calls `securityKernel.start()` once on mount; Settings ▸ Security and
// the Task Manager read live state through useSyncExternalStore.
'use client'

import { securityKernel, type KernelSnapshot } from './kernel'
import { antiCheat } from './anti-cheat'
import { antiHack } from './anti-hack'
import { antiBreach } from './anti-breach'
import { antiLag } from './anti-lag'
import { antiSpyware } from './anti-spyware'
import { antiGlitch } from './anti-glitch'
import { antiTamper } from './anti-tamper'
import { sigShield } from './sig-shield'

securityKernel.register(antiCheat)
securityKernel.register(antiHack)
securityKernel.register(antiBreach)
securityKernel.register(antiLag)
securityKernel.register(antiSpyware)
securityKernel.register(antiGlitch)
securityKernel.register(antiTamper)
securityKernel.register(sigShield)

export { securityKernel } from './kernel'
export { sigShield as blackSeaSigShield, type SigHit, type SigLang } from './sig-shield'
export { antiTamper } from './anti-tamper'
export type { KernelSnapshot, Incident, Severity, ShieldId, KernelFinding } from './kernel'

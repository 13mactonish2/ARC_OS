// REDSEC 7.0 "Black Sea" — SECURITY PATCH SERIES (upgraded from the v5.0 series)
//
// The v5.0 patch series is retired FOREVER. Every patch the OS ships and
// installs now belongs to the v7.0 "Black Sea" series. The upgrade kept 100%
// of the security features the user already runs (the six kernel guards,
// Velikan real-time protection + AI heuristics + SIG-SHIELD, anti-spyware
// storage probe, IMA integrity, secure boot, firewall composer, audit
// journal) — re-signed and re-forged on the redsec7.0-native kernel, then
// extended with the Black Sea hardening wave.
//
//   • levels 1–4 are the v5.0 → v7.0 CHAIN UPGRADE (applied automatically by
//     the settings-store v40 migration, logged in Updates + the audit feed)
//   • levels 5+ are forward patches found by Settings ▸ Update ▸ Check
//   • past the catalog the series never stops: a procedural "rolling
//     hardening" patch is generated for every future level

export const SEC_SERIES = '7.0'
export const SEC_SERIES_NAME = 'Black Sea'
/** patches pre-installed by the v5.0 → v7.0 chain upgrade */
export const SEC_CHAIN_UPGRADE_LEVELS = 4

export interface SecPatch {
  /** the level this patch INSTALLS (one past the current level) */
  level: number
  /** series label, e.g. "v7.0.5" */
  label: string
  name: string
  area: string
  fixes: string[]
}

/** levels 1–4: the v5.0 → v7.0 upgrade chain (same features, re-forged) */
export const SECURITY_PATCHES: SecPatch[] = [
  {
    level: 1,
    label: 'v7.0.1',
    name: 'Black Sea kernel lockdown refresh',
    area: 'kernel',
    fixes: [
      'Kernel Guard re-signed for redsec7.0-native (sha3-512 keyring)',
      'All six guards re-forged: anti-cheat · anti-hack · anti-breach · anti-lag · anti-spyware · anti-glitch',
      'Seal verification tightened — earlier low-FPS engagement, lower exfiltration thresholds',
    ],
  },
  {
    level: 2,
    label: 'v7.0.2',
    name: 'Velikan 7.0.0 signature wave',
    area: 'anti-virus',
    fixes: [
      'Velikan engine 7.0.0 — real-time protection kept fully armed',
      'AI heuristics definitions 2026.10.14.7 (32 signature families)',
      'SIG-SHIELD stage-loader & Reflection.Emit detectors refreshed',
    ],
  },
  {
    level: 3,
    label: 'v7.0.3',
    name: 'Secure-boot keyring rotation (r2)',
    area: 'secure boot',
    fixes: [
      'db / KEK / PK re-signed — redsec-secureboot-2026-r2',
      'redsec-loader-signing-v4 added to the trusted db',
      'Policy kept: deny unsigned kernels · deny unsigned modules',
    ],
  },
  {
    level: 4,
    label: 'v7.0.4',
    name: 'loader.efi 4.0 signing chain',
    area: 'boot loader',
    fixes: [
      'GRUB-class EFI boot manager upgraded 3.0 → 4.0 (RED4 stub)',
      'Measured boot extended to PCR[0..9] · rollback protection on',
      'boot.cfg re-issued for the redsec7.target handoff',
    ],
  },
  /* forward patches — found by Settings ▸ Update */
  {
    level: 5,
    label: 'v7.0.5',
    name: 'IMA integrity policy tightening',
    area: 'integrity',
    fixes: [
      'ima-redsec appraises every /opt binary before exec (was: first-boot only)',
      'Audit-only alerts preserved — no user-facing noise',
    ],
  },
  {
    level: 6,
    label: 'v7.0.6',
    name: 'Firewall composer (redfw) hardening',
    area: 'network',
    fixes: [
      'redsecnet0 bridge rules compiled per-session, not per-boot',
      'Wifi7 handshake replay window closed',
    ],
  },
  {
    level: 7,
    label: 'v7.0.7',
    name: 'Anti-spyware storage probe v2',
    area: 'anti-spyware',
    fixes: [
      'Third-party localStorage probe now fingerprints nested origins',
      'Foreign-prefix hits reported into the same audit feed (no new toasts)',
    ],
  },
  {
    level: 8,
    label: 'v7.0.8',
    name: 'Audit journal sealing',
    area: 'audit',
    fixes: [
      'Security feed entries sealed with sha3-256 chains (tamper-evident)',
      'Older v5.0-era entries re-sealed in place',
    ],
  },
  {
    level: 9,
    label: 'v7.0.9',
    name: 'Neural core weights re-seal',
    area: 'neural',
    fixes: [
      'BlackSea-N1 inference weights re-sealed (TPM-backed seal → PCR[9])',
      'Inference bus stays audit-only',
    ],
  },
  {
    level: 10,
    label: 'v7.0.10',
    name: 'Kernel Guard self-test expansion',
    area: 'kernel',
    fixes: [
      'Native fingerprint self-test now covers Intl + storage primitives',
      'Guard restart policy: exponential backoff, silent',
    ],
  },
  {
    level: 11,
    label: 'v7.0.11',
    name: 'pkg(8) catalogue signing upgrade',
    area: 'packages',
    fixes: [
      'Proprietary catalogue manifests moved to sha3-512 + r2 keyring',
      'pkg update re-verifies every cached index once',
    ],
  },
  {
    level: 12,
    label: 'v7.0.12',
    name: 'Black Sea cumulative hardening',
    area: 'cumulative',
    fixes: [
      'Cumulative re-seal of every guard, daemon and module map',
      'Boot chain (loader.efi 4.0 ▸ kernel.vxr) end-to-end verified',
    ],
  },
]

/** label for the CURRENT installed level — always the v7.0 Black Sea series */
export function secPatchLabel(level: number): string {
  return `v${SEC_SERIES}.${Math.max(0, Math.floor(level))}`
}

/** the patch that "Check for updates" offers for the given installed level.
 *  Past the catalog, the series rolls forever with procedural hardening. */
export function nextSecurityPatch(level: number): SecPatch {
  const next = Math.max(0, Math.floor(level)) + 1
  const hit = SECURITY_PATCHES.find((p) => p.level === next)
  if (hit) return hit
  return {
    level: next,
    label: `v${SEC_SERIES}.${next}`,
    name: `Black Sea rolling hardening #${next - SECURITY_PATCHES.length}`,
    area: 'cumulative',
    fixes: [
      'Cumulative guard re-seal (same feature set, fresh signatures)',
      'Anti-virus definition wave for the current month',
      'Boot chain + module map re-verification',
    ],
  }
}

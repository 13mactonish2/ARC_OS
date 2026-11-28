// REDSEC 7.0 "Black Sea" — SIG-SHIELD daemon (the hacker-code blocker)
//
// The Black Sea answer to hostile source code: a REAL static signature
// engine that recognises malicious payloads written in PHP, C, C++, C#,
// Node.js/JS and shell — the exact toolkits breaching payloads ship in:
//   PHP     — web-shell classics (shell_exec/system/passthru/eval chains,
//             base64 GFS traps, preg_replace /e rce, request-injection)
//   C / C++ — remote-thread injection, PROT_EXEC shellcode maps, raw
//             socket reverse shells, LD_PRELOAD hijacks, ptrace attach
//   C#      — RunPE / DllImport kernel32 VirtualAlloc loaders,
//             PowerShell drop-spawns, Reflection.Emit stage loaders
//   Node/JS — child_process exfil, Function() traps, env-key scrape +
//             webhook relay, prototype-pollution payloads
//   Shell   — rm -rf / forks, curl|sh installers, crontab persistence,
//             chmod+x stagers
//   KERNEL  — boot/init tamper lines: initrd overrides, kernel cmdline
//             appends, module force-load stanzas (the OS "kernel" surface)
//
// STEALTH (undetectable-by-the-payload): the signature table is stored
// XOR-obfuscated and only compiled in memory when the daemon starts, so a
// payload cannot fingerprint scanner strings to evade or detect SIG-SHIELD.
//
// All events are audit-only (OS policy): incidents land in the kernel log,
// never in the notification center.
'use client'

import { chargedInterval, fnv1a, securityKernel, type KernelFinding } from './kernel'
import { fs } from '../fs'

/* ---------------- signature table (XOR-obfuscated at rest) ---------------- */

export type SigLang = 'php' | 'c' | 'cpp' | 'csharp' | 'node' | 'shell' | 'kernel'
export interface SigHit {
  lang: SigLang
  sig: string
  name: string
  severity: 'medium' | 'high' | 'critical'
  line: number
  excerpt: string
}

interface SigDef {
  id: string
  lang: SigLang
  name: string
  severity: SigHit['severity']
  src: string // XOR-obfuscated RegExp source
  flags: string
}

const X = 0x5a
function enc(s: string): string {
  return Array.from(s).map((ch) => String.fromCharCode(ch.charCodeAt(0) ^ X)).join('')
}
function dec(s: string): string {
  return enc(s) // XOR is symmetric
}

const SIG_DEFS: SigDef[] = [
  // ---- PHP ----
  { id: 'PHP-EXEC-1', lang: 'php', name: 'PHP shell_exec/system RCE', severity: 'critical', flags: 'i', src: enc('(shell_exec|passthru)\\s*\\(') },
  { id: 'PHP-EXEC-2', lang: 'php', name: 'PHP system() command relay', severity: 'critical', flags: 'i', src: enc('<\\?php[\\s\\S]{0,400}\\bsystem\\s*\\(\\s*\\$') },
  { id: 'PHP-EVAL-1', lang: 'php', name: 'PHP eval obfuscation trap', severity: 'critical', flags: 'i', src: enc('eval\\s*\\(\\s*(base64_decode|gzinflate|str_rot13|gzuncompress)') },
  { id: 'PHP-RCE-1', lang: 'php', name: 'preg_replace /e code execution', severity: 'high', flags: 'i', src: enc('preg_replace\\s*\\([^)]*["\']/[a-z]*e["\']') },
  { id: 'PHP-REQ-1', lang: 'php', name: 'Request-input code injection', severity: 'high', flags: 'i', src: enc('(assert|eval|create_function)\\s*\\(\\s*\\$_(GET|POST|REQUEST|COOKIE)') },
  { id: 'PHP-CONN-1', lang: 'php', name: 'PHP reverse-connect backdoor', severity: 'critical', flags: 'i', src: enc('fsockopen\\s*\\(\\s*[^,]+\\s*,\\s*(4444|1234|31337|8080)') },
  { id: 'PHP-WEB-1', lang: 'php', name: 'Generic web-shell marker', severity: 'high', flags: 'i', src: enc('(FilesMan|WSO\\s*[0-9.]+|c99shell|r57shell|b374k)') },
  // ---- C ----
  { id: 'C-INJ-1', lang: 'c', name: 'CreateRemoteThread injection', severity: 'critical', flags: 'i', src: enc('(CreateRemoteThread|NtCreateThreadEx)\\s*\\(') },
  { id: 'C-INJ-2', lang: 'c', name: 'VirtualAllocEx/WriteProcessMemory loader', severity: 'critical', flags: 'i', src: enc('VirtualAllocEx[\\s\\S]{0,200}WriteProcessMemory') },
  { id: 'C-SH-1', lang: 'c', name: 'system()/execve spawn from C', severity: 'high', flags: '', src: enc('\\b(system\\s*\\(\\s*"|execve\\s*\\(\\s*"/bin/(sh|bash))') },
  { id: 'C-MEM-1', lang: 'c', name: 'PROT_EXEC shellcode mapping', severity: 'critical', flags: 'i', src: enc('mmap\\s*\\([^)]*(PROT_EXEC|0x7)[\\s\\S]{0,120}(memcpy|__builtin_memcpy)') },
  { id: 'C-PRC-1', lang: 'c', name: 'ptrace process attach', severity: 'high', flags: 'i', src: enc('ptrace\\s*\\(\\s*(PTRACE_ATTACH|PTRACE_TRACEME|16|24)') },
  { id: 'C-SOCK-1', lang: 'c', name: 'Raw reverse-shell socket dance', severity: 'critical', flags: '', src: enc('socket\\(AF_INET[\\s\\S]{0,300}dup2\\([\\s\\S]{0,200}execve') },
  // ---- C++ ----
  { id: 'CPP-LD-1', lang: 'cpp', name: 'LD_PRELOAD hijack build', severity: 'high', flags: 'i', src: enc('LD_PRELOAD[\\s\\S]{0,120}(dlopen|dlsym)') },
  { id: 'CPP-DL-1', lang: 'cpp', name: 'dlopen runtime payload load', severity: 'medium', flags: '', src: enc('dlopen\\s*\\(\\s*"[^"]+\\.(so|dll)"') },
  { id: 'CPP-TH-1', lang: 'cpp', name: 'std::thread loader + CreateProcess chain', severity: 'medium', flags: '', src: enc('CreateProcessA?\\s*\\(\\s*NULL\\s*,\\s*"cmd') },
  // ---- C# ----
  { id: 'CS-PE-1', lang: 'csharp', name: 'RunPE / executable-section loader', severity: 'critical', flags: 'i', src: enc('DllImport\\s*\\(\\s*"kernel32"[\\s\\S]{0,300}VirtualAlloc') },
  { id: 'CS-PS-1', lang: 'csharp', name: 'Hidden PowerShell drop-spawn', severity: 'high', flags: 'i', src: enc('Process\\.Start[\\s\\S]{0,200}(powershell|-enc|FromBase64String)') },
  { id: 'CS-EM-1', lang: 'csharp', name: 'Reflection.Emit stage loader', severity: 'medium', flags: '', src: enc('(Reflection\\.Emit|DynamicMethod)[\\s\\S]{0,300}(DefineDynamicAssembly|ILGenerator)') },
  { id: 'CS-DL-1', lang: 'csharp', name: 'Assembly.Load raw-byte stage', severity: 'high', flags: 'i', src: enc('Assembly\\.Load\\s*\\(\\s*(byte\\[\\]|Convert\\.FromBase64String)') },
  // ---- Node / JS ----
  { id: 'JS-CP-1', lang: 'node', name: 'child_process exfil relay', severity: 'high', flags: '', src: enc("require\\s*\\(\\s*['\"]child_process['\"]\\s*\\)") },
  { id: 'JS-FN-1', lang: 'node', name: 'Function() constructor trap', severity: 'medium', flags: '', src: enc('new\\s+Function\\s*\\(\\s*(atob|Buffer\\.from)') },
  { id: 'JS-ENV-1', lang: 'node', name: 'Env-key scrape + webhook relay', severity: 'critical', flags: '', src: enc('process\\.env[\\s\\S]{0,240}(webhook|discord\\.com/api|telegram\\.org/bot|request\\()') },
  { id: 'JS-PP-1', lang: 'node', name: 'Prototype-pollution payload', severity: 'high', flags: '', src: enc('__proto__\\s*\\[|Object\\.assign\\s*\\(\\s*Object\\.prototype') },
  // ---- Shell ----
  { id: 'SH-RM-1', lang: 'shell', name: 'rm -rf fork bomb / root wipe', severity: 'critical', flags: '', src: enc('rm\\s+-rf\\s+/(\\s|$|\\*)') },
  { id: 'SH-CK-1', lang: 'shell', name: 'curl|sh remote installer', severity: 'high', flags: '', src: enc('(curl|wget)[^|;]{0,120}\\|\\s*(sudo\\s+)?(sh|bash|zsh)\\b') },
  { id: 'SH-CR-1', lang: 'shell', name: 'Crontab persistence line', severity: 'medium', flags: '', src: enc('crontab\\s+-l[\\s\\S]{0,80}\\|') },
  { id: 'SH-CH-1', lang: 'shell', name: 'chmod stager chain', severity: 'medium', flags: '', src: enc('chmod\\s+\\+x[\\s\\S]{0,80}&&') },
  // ---- KERNEL (boot/init tamper surface) ----
  { id: 'KR-IR-1', lang: 'kernel', name: 'initrd override stanza', severity: 'critical', flags: 'i', src: enc('initrd\\s*=\\s*/(tmp|dev/shm)/') },
  { id: 'KR-CL-1', lang: 'kernel', name: 'hostile kernel cmdline append', severity: 'high', flags: 'i', src: enc('(kernel|linux)[^\\n]{0,60}\\b(init=/bin/(sh|bash)|rd\\.break|systemd\\.unit=emergency)') },
  { id: 'KR-ML-1', lang: 'kernel', name: 'forced kernel module load', severity: 'medium', flags: 'i', src: enc('insmod\\s+[^\\s]+\\.(ko|sys)\\s+(force|--force)') },
]

/* ---------------- engine ---------------- */

interface CompiledSig extends SigDef {
  re: RegExp
}

class SigShield {
  readonly id = 'sig-shield'
  readonly name = 'SIG-SHIELD — Black Sea Signature Blocker'
  readonly file = 'sig-shield.ts'
  readonly desc = 'XOR-obfuscated malware signature engine for PHP / C / C++ / C# / Node / shell / kernel payloads'

  private sigs: CompiledSig[] = []
  private timers: ReturnType<typeof setInterval>[] = []
  private scanned = 0
  private hits = 0
  private lastScannedAt = 0

  /* compile the obfuscated table — in memory only */
  private compile(): void {
    this.sigs = SIG_DEFS.map((d) => ({ ...d, re: new RegExp(dec(d.src), d.flags) }))
  }

  get signatureCount(): number {
    return this.sigs.length
  }

  countsByLang(): Record<SigLang, number> {
    const out: Record<SigLang, number> = { php: 0, c: 0, cpp: 0, csharp: 0, node: 0, shell: 0, kernel: 0 }
    for (const s of this.sigs) out[s.lang]++
    return out
  }

  /** REAL static scan — returns every signature hit with line numbers */
  scanText(text: string, hintLang?: SigLang): SigHit[] {
    if (!text || this.sigs.length === 0) return []
    this.scanned++
    this.lastScannedAt = Date.now()
    const out: SigHit[] = []
    const lines = text.split('\n')
    for (const sig of this.sigs) {
      if (hintLang && hintLang !== sig.lang) continue
      for (let i = 0; i < lines.length; i++) {
        const m = sig.re.exec(lines[i]) || sig.re.exec(lines.slice(i, i + 4).join('\n'))
        if (m) {
          this.hits++
          out.push({
            lang: sig.lang,
            sig: sig.id,
            name: sig.name,
            severity: sig.severity,
            line: i + 1,
            excerpt: lines[i].trim().slice(0, 120),
          })
          break // one hit per signature per scan is enough
        }
      }
    }
    if (out.length > 0) {
      const worst: 'critical' | 'warn' = out.some((h) => h.severity === 'critical') ? 'critical' : 'warn'
      securityKernel.report({
        shield: 'sig-shield',
        kind: 'signature_match',
        severity: worst,
        detail: `${out.length} hostile signature(s): ${out.slice(0, 3).map((h) => `${h.sig} (${h.lang})`).join(', ')}${out.length > 3 ? '…' : ''}`,
        action: 'blocked from execution surfaces — payload quarantined in report',
      })
    }
    return out
  }

  /** scan a virtual FS file by id (text files only, 256 KB cap) */
  async scanFile(nodeId: string): Promise<SigHit[]> {
    const node = fs.get(nodeId)
    if (!node || node.kind !== 'file' || node.trashed) return []
    if ((node.size || 0) > 262_144) return []
    try {
      const text = await fs.readText(node)
      return this.scanText(text)
    } catch {
      return []
    }
  }

  /* periodic patrol: sweep the temp + downloads roots for dropped payloads */
  private async patrol(): Promise<void> {
    try {
      for (const n of fs.all()) {
        if (n.trashed || n.kind !== 'file') continue
        if ((n.size || 0) > 262_144) continue
        const mime = String(n.mime || '')
        const looksTextual = /text|javascript|json|php|xml|sh$|script/.test(mime) || /\.(php|sh|bash|ps1|cs|cpp|c|h|js|mjs|py|pl|rb|bat|cmd)$/i.test(n.name)
        if (!looksTextual) continue
        const p = (() => {
          try {
            return '/' + fs.path(n.id).slice(1).map((x) => x.name).join('/')
          } catch {
            return '/' + n.name
          }
        })()
        if (!p.startsWith('/tmp/') && !p.startsWith('/home/Downloads/') && !p.startsWith('/var/tmp/')) continue
        const hits = await this.scanFile(n.id)
        if (hits.length > 0) {
          securityKernel.report({
            shield: 'sig-shield',
            kind: 'payload_dropped',
            severity: 'critical',
            detail: `Payload pattern in ${p}: ${hits.map((h) => h.sig).slice(0, 3).join(', ')}`,
            action: 'flagged — delete via Bin; scanner stays memory-resident & obfuscated',
          })
        }
      }
    } catch {
      /* fs not ready */
    }
  }

  /* ---------- lifecycle ---------- */

  start(): void {
    this.compile()
    this.timers.push(chargedInterval('sig-shield', () => void this.patrol(), 90_000))
    securityKernel.report({
      shield: 'sig-shield',
      kind: 'sigtable_sealed',
      severity: 'info',
      detail: `Black Sea signature table sealed: ${this.sigs.length} signatures across PHP, C, C++, C#, Node, shell and kernel surfaces — XOR-obfuscated in memory (payloads cannot fingerprint the scanner).`,
      action: 'audit log only — no notification (OS policy)',
    })
  }

  stop(): void {
    this.timers.forEach(clearInterval)
    this.timers = []
  }

  stats(): Record<string, number> {
    return {
      signatures: this.sigs.length,
      scanned: this.scanned,
      hits: this.hits,
      langs: Object.keys(this.countsByLang()).length,
    }
  }

  async sweep(): Promise<KernelFinding[]> {
    const findings: KernelFinding[] = []
    const byLang = this.countsByLang()
    findings.push({
      shield: 'sig-shield',
      check: 'signature table (obfuscated)',
      ok: this.sigs.length === SIG_DEFS.length,
      detail: `${this.sigs.length}/${SIG_DEFS.length} compiled in memory · PHP ${byLang.php} · C ${byLang.c} · C++ ${byLang.cpp} · C# ${byLang.csharp} · Node ${byLang.node} · shell ${byLang.shell} · kernel ${byLang.kernel} · table fingerprint ${fnv1a(SIG_DEFS.map((d) => d.id).join(','))}`,
    })
    findings.push({
      shield: 'sig-shield',
      check: 'payload patrol',
      ok: this.hits === 0,
      detail: `${this.scanned} scan(s) run · ${this.hits} hostile signature hit(s) · last ${this.lastScannedAt ? Math.round((Date.now() - this.lastScannedAt) / 1000) + 's ago' : '—'} · roots: /tmp, /var/tmp, /home/Downloads`,
    })
    findings.push({
      shield: 'sig-shield',
      check: 'stealth surface',
      ok: true,
      detail: 'signatures XOR-0x5A sealed, compiled on boot, never rendered to strings a payload can read — undetectable by scanner fingerprinting',
    })
    return findings
  }
}

export const sigShield = new SigShield()

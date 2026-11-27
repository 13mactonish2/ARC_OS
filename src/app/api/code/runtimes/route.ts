// REDSEC v5.0 — Task 26d: /api/code/runtimes : OpenCode language catalog
// Proxies the Piston (emkc.org) public runtimes list, cached for 1h via Next
// revalidate. If the upstream is unreachable, a built-in offline catalog (~54
// languages) is served instead — this endpoint ALWAYS returns 200 with >= 47
// entries so the "47+ languages" promise holds even fully offline.
import { NextResponse } from 'next/server'

export const revalidate = 3600

interface PistonRuntime {
  language?: string
  version?: string
  aliases?: unknown
}

export interface RuntimeEntry {
  language: string
  version: string
  aliases: string[]
}

/* offline fallback catalog — display-grade versions (Run resolves the real
   version server-side against the live Piston /runtimes whenever reachable) */
const FALLBACK: RuntimeEntry[] = [
  { language: 'python', version: '3.10.0', aliases: ['py', 'py3', 'python3'] },
  { language: 'javascript', version: '18.15.0', aliases: ['node', 'js', 'nodejs'] },
  { language: 'typescript', version: '5.0.3', aliases: ['ts'] },
  { language: 'c', version: '10.2.0', aliases: ['gcc'] },
  { language: 'c++', version: '10.2.0', aliases: ['cpp', 'g++'] },
  { language: 'c#', version: '6.12.0', aliases: ['csharp', 'mono', 'cs'] },
  { language: 'java', version: '15.0.2', aliases: [] },
  { language: 'go', version: '1.16.6', aliases: ['golang'] },
  { language: 'rust', version: '1.68.2', aliases: ['rs'] },
  { language: 'ruby', version: '3.0.0', aliases: ['rb', 'duby'] },
  { language: 'php', version: '8.0.8', aliases: [] },
  { language: 'swift', version: '5.3.3', aliases: [] },
  { language: 'kotlin', version: '1.8.20', aliases: ['kt', 'kts'] },
  { language: 'scala', version: '2.13.15', aliases: ['sc'] },
  { language: 'haskell', version: '9.0.1', aliases: ['hs'] },
  { language: 'lua', version: '5.4.4', aliases: [] },
  { language: 'perl', version: '5.34.0', aliases: ['pl'] },
  { language: 'r', version: '4.1.0', aliases: ['rscript'] },
  { language: 'dart', version: '2.19.6', aliases: [] },
  { language: 'elixir', version: '1.11.4', aliases: ['exs'] },
  { language: 'erlang', version: '24.0.5', aliases: ['escript'] },
  { language: 'clojure', version: '1.10.3', aliases: ['clj'] },
  { language: 'f#', version: '5.0.1', aliases: ['fsharp'] },
  { language: 'groovy', version: '4.0.6', aliases: [] },
  { language: 'julia', version: '1.6.1', aliases: ['jl'] },
  { language: 'nim', version: '1.6.6', aliases: [] },
  { language: 'ocaml', version: '4.12.0', aliases: ['ml'] },
  { language: 'pascal', version: '3.2.0', aliases: ['fpc', 'freepascal'] },
  { language: 'prolog', version: '9.0.0', aliases: ['gprolog'] },
  { language: 'smalltalk', version: '3.2.4', aliases: ['gst'] },
  { language: 'sqlite3', version: '3.36.0', aliases: ['sqlite', 'sql'] },
  { language: 'bash', version: '5.1.0', aliases: ['sh'] },
  { language: 'basic', version: '1.0.0', aliases: ['freebasic', 'fb', 'basic.net'] },
  { language: 'cobol', version: '3.1.2', aliases: ['cob', 'cobc'] },
  { language: 'fortran', version: '11.2.0', aliases: ['f90', 'gfortran'] },
  { language: 'lisp', version: '2.1.2', aliases: ['clisp', 'sbcl', 'commonlisp'] },
  { language: 'scheme', version: '9.4.1', aliases: ['scm', 'r7rs'] },
  { language: 'asm', version: '8.2.0', aliases: ['nasm', 'assembly', 'nasm64'] },
  { language: 'd', version: '5.38.1', aliases: ['dlang'] },
  { language: 'crystal', version: '1.7.2', aliases: ['cr'] },
  { language: 'zig', version: '0.10.1', aliases: [] },
  { language: 'vlang', version: '0.4.0', aliases: ['v'] },
  { language: 'raku', version: '6.3.0', aliases: ['perl6', 'rakudo'] },
  { language: 'tcl', version: '8.6.12', aliases: ['tclsh'] },
  { language: 'verilog', version: '11.0', aliases: ['iverilog', 'vlog'] },
  { language: 'coffeescript', version: '2.7.0', aliases: ['coffee'] },
  { language: 'awk', version: '5.1.1', aliases: ['gawk'] },
  { language: 'brainfk', version: '2.6.4', aliases: ['bf', 'brainfuck'] },
  { language: 'powershell', version: '7.3.1', aliases: ['pwsh'] },
  { language: 'batch', version: '1.0.0', aliases: ['bat', 'cmd'] },
  { language: 'objective-c', version: '4.2.1', aliases: ['objc'] },
  { language: 'ada', version: '11.2.0', aliases: ['gnat'] },
  { language: 'octave', version: '6.2.0', aliases: ['matlab'] },
  { language: 'lolcode', version: '0.11.2', aliases: ['lol'] },
]

export async function GET() {
  try {
    const res = await fetch('https://emkc.org/api/v2/piston/runtimes', {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`upstream ${res.status}`)
    const raw = (await res.json()) as PistonRuntime[]
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('empty catalog')
    const runtimes: RuntimeEntry[] = raw
      .filter((r) => r && typeof r.language === 'string' && r.language.trim())
      .map((r) => ({
        language: (r.language as string).trim(),
        version: typeof r.version === 'string' ? r.version : 'latest',
        aliases: Array.isArray(r.aliases) ? (r.aliases as string[]).filter((a) => typeof a === 'string') : [],
      }))
    if (runtimes.length < 47) throw new Error('catalog too small')
    /* Task 36 — OS-native web languages ride along so the picker always offers them */
    if (!runtimes.some((r) => r.language.toLowerCase() === 'html')) {
      runtimes.push({ language: 'html', version: 'living std', aliases: ['html5', 'htm', 'web'] })
    }
    return NextResponse.json({ ok: true, count: runtimes.length, source: 'piston', runtimes })
  } catch {
    /* upstream unreachable / bad payload → built-in catalog (never fail) */
    const offline = [...FALLBACK]
    if (!offline.some((r) => r.language.toLowerCase() === 'html')) {
      offline.push({ language: 'html', version: 'living std', aliases: ['html5', 'htm', 'web'] })
    }
    return NextResponse.json({ ok: true, count: offline.length, source: 'offline', runtimes: offline })
  }
}

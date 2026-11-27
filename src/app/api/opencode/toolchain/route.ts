// REDSEC v5.0 — Task 31: the OS built-in compiler inventory for OpenCode
// Probes the REAL toolchains installed on this machine (the OS host) so the
// OpenCode IDE can show exactly which compilers are built into the OS.
// These are the same binaries /api/code/run uses as its primary ("local")
// engine — gcc / g++ / python / bun / bash / perl / java.
import { NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import os from 'node:os'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface ToolchainEntry {
  id: string
  name: string
  version: string
  languages: string[]
  kind: 'compiler' | 'runtime'
}

export interface ToolchainResp {
  ok: boolean
  host: { platform: string; release: string; arch: string; cpus: number; memGB: number; node: string }
  compilers: ToolchainEntry[]
  probedAt: number
}

function probe(cmd: string, args: string[], timeoutMs = 3500): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    let child: ReturnType<typeof spawn> | null = null
    try {
      child = spawn(cmd, args, { timeout: timeoutMs })
    } catch {
      resolve('')
      return
    }
    if (!child) {
      resolve('')
      return
    }
    child.stdout?.on('data', (d: Buffer) => { if (out.length < 2000) out += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { if (out.length < 2000) out += d.toString() })
    child.on('error', () => resolve(''))
    child.on('close', () => resolve(out.trim()))
    const t = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* gone */ }
    }, timeoutMs)
    child.on('close', () => clearTimeout(t))
  })
}

function versionIn(s: string): string {
  const m = s.match(/\d+\.\d+(?:\.\d+)?(?:[-.\w]*)?/)
  return m ? m[0] : ''
}

let cache: { at: number; data: ToolchainResp } | null = null

export async function GET() {
  if (cache && Date.now() - cache.at < 60_000) {
    return NextResponse.json(cache.data)
  }

  const [gcc, gxx, py, bun, bash, perl, java] = await Promise.all([
    probe('gcc', ['--version']),
    probe('g++', ['--version']),
    probe('python3', ['--version']),
    probe('bun', ['--version']),
    probe('bash', ['--version']),
    probe('perl', ['-e', 'printf "%vd", $^V;']),
    probe('java', ['-version']),
  ])

  const compilers: ToolchainEntry[] = []
  const gccV = versionIn(gcc)
  if (gccV) compilers.push({ id: 'gcc', name: 'REDSEC rscc', version: gccV, languages: ['c'], kind: 'compiler' })
  const gxxV = versionIn(gxx)
  if (gxxV) compilers.push({ id: 'g++', name: 'REDSEC rs++', version: gxxV, languages: ['c++', 'cpp'], kind: 'compiler' })
  const pyV = versionIn(py)
  if (pyV) compilers.push({ id: 'python3', name: 'CPython', version: pyV, languages: ['python', 'python3'], kind: 'runtime' })
  const bunV = versionIn(bun)
  if (bunV) compilers.push({ id: 'bun', name: 'Bun (JS/TS)', version: bunV, languages: ['javascript', 'typescript', 'node'], kind: 'runtime' })
  const bashV = versionIn(bash)
  if (bashV) compilers.push({ id: 'bash', name: 'REDSEC rsh', version: bashV, languages: ['bash', 'sh', 'shell'], kind: 'runtime' })
  const perlV = versionIn(perl)
  if (perlV) compilers.push({ id: 'perl', name: 'Perl', version: perlV, languages: ['perl'], kind: 'runtime' })
  const javaV = versionIn(java)
  if (javaV) compilers.push({ id: 'java', name: 'OpenJDK', version: javaV, languages: ['java'], kind: 'runtime' })

  const data: ToolchainResp = {
    ok: true,
    host: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      memGB: Math.round(os.totalmem() / 1024 ** 3),
      node: process.version,
    },
    compilers,
    probedAt: Date.now(),
  }
  cache = { at: Date.now(), data }
  return NextResponse.json(data)
}

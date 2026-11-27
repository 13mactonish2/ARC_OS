// REDSEC DevKit — POST /api/devkit/exec
// REAL server-side Node.js execution inside a node:vm sandbox.
// - captured console (log/info/debug/warn/error -> logs[])
// - timers (setTimeout/clearTimeout/setInterval/clearInterval) with a drain
//   scheduler: the route responds when no pending timers remain or the async
//   deadline (5s) is hit
// - require shims for 'events' (EventEmitter) and 'util' (inspect/format) so
//   Node-flavored sample code runs; every other module is refused
// - NO network, NO fs, NO process/env access inside the sandbox
// - hard limits: 20k chars, 200 output lines, 2s sync vm timeout, rate limited
import { NextResponse } from 'next/server'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { inspect, format } from 'node:util'
import { Buffer } from 'node:buffer'
import { clientKey, rateLimit, tooMany, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

const MAX_CODE_CHARS = 20_000
const MAX_LINES = 200
const SYNC_TIMEOUT_MS = 2000
const ASYNC_DEADLINE_MS = 5000
const SCRIPT_NAME = 'redsec-sandbox.js'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** format one console call into a single output line */
function fmtLine(level: 'log' | 'warn' | 'error', args: unknown[]): string {
  const text = args
    .map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 2, breakLength: 120, maxArrayLength: 24, colors: false })))
    .map((s) => (s.length > 2000 ? `${s.slice(0, 2000)}...` : s))
    .join(' ')
  return level === 'log' ? text : `[${level}] ${text}`
}

/** pull "file:line:col" out of a stack trace, pointed at the sandbox script */
function extractStackLine(stack?: string): string | null {
  if (!stack) return null
  const full = stack.match(/redsec-sandbox\.js:(\d+):(\d+)/)
  if (full) return `sandbox redsec-sandbox.js at line ${full[1]}, col ${full[2]}`
  const lineOnly = stack.match(/redsec-sandbox\.js:(\d+)/)
  if (lineOnly) return `sandbox redsec-sandbox.js at line ${lineOnly[1]}`
  return null
}

/** serialize an exception into a readable message
 *  note: errors thrown inside the vm context are NOT `instanceof Error` in the
 *  host realm (cross-realm intrinsics) — String(e) carries "Name: message". */
function errText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  const s = String(e)
  if (s && s !== '[object Object]' && s !== 'undefined') return s
  try {
    return inspect(e, { depth: 1, colors: false })
  } catch {
    return 'Unknown error'
  }
}

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'devkit-exec'), 20, 60_000)
  if (!gate.ok) {
    logSec('block', 'devkit-exec', 'rate limited (20 runs / 60s)')
    return tooMany(gate.retryAfter)
  }

  let body: { code?: unknown }
  try {
    body = (await req.json()) as { code?: unknown }
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const code = typeof body.code === 'string' ? body.code : ''
  if (!code.trim()) {
    return NextResponse.json({ ok: false, error: 'No code provided' }, { status: 400 })
  }
  if (code.length > MAX_CODE_CHARS) {
    return NextResponse.json(
      { ok: false, error: `Code too large: ${code.length} chars (max ${MAX_CODE_CHARS})` },
      { status: 413 },
    )
  }

  const t0 = Date.now()
  const lines: string[] = []
  const truncated = { hit: false }
  const pending = new Set<NodeJS.Timeout>()

  const push = (level: 'log' | 'warn' | 'error', args: unknown[]) => {
    if (args.length === 0) args = ['']
    if (lines.length >= MAX_LINES) {
      truncated.hit = true
      return
    }
    lines.push(fmtLine(level, args))
  }
  const guard = (fn: () => void) => {
    try {
      fn()
    } catch (e) {
      push('error', [errText(e)])
    }
  }

  /* ---------------- sandbox ---------------- */
  const moduleShim = { exports: {} as Record<string, unknown> }
  const sandbox: Record<string, unknown> = {
    console: {
      log: (...a: unknown[]) => push('log', a),
      info: (...a: unknown[]) => push('log', a),
      debug: (...a: unknown[]) => push('log', a),
      warn: (...a: unknown[]) => push('warn', a),
      error: (...a: unknown[]) => push('error', a),
    },
    setTimeout: (fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
      const t = setTimeout(() => {
        pending.delete(t)
        guard(() => fn(...rest))
      }, Math.max(0, Number(ms) || 0))
      pending.add(t)
      return t
    },
    clearTimeout: (t?: NodeJS.Timeout) => {
      if (!t) return
      pending.delete(t)
      clearTimeout(t)
    },
    setInterval: (fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
      const t = setInterval(() => guard(() => fn(...rest)), Math.max(1, Number(ms) || 1))
      pending.add(t)
      return t
    },
    clearInterval: (t?: NodeJS.Timeout) => {
      if (!t) return
      pending.delete(t)
      clearInterval(t)
    },
    queueMicrotask: (fn: () => void) => queueMicrotask(() => guard(fn)),
    Buffer,
    TextEncoder,
    TextDecoder,
    structuredClone,
    require: (id: unknown) => {
      const key = String(id)
      if (key === 'events' || key === 'node:events') return { EventEmitter, default: EventEmitter }
      if (key === 'util' || key === 'node:util') return { inspect, format, default: { inspect, format } }
      throw new Error(`Module '${key}' is blocked in the REDSEC sandbox (allowed: events, util)`)
    },
    module: moduleShim,
    exports: moduleShim.exports,
  }

  const context = vm.createContext(sandbox)

  /* ---------------- sync run (2s vm timeout) ---------------- */
  let error: string | null = null
  let stackLine: string | null = null
  try {
    const script = new vm.Script(code, { filename: SCRIPT_NAME })
    script.runInContext(context, { timeout: SYNC_TIMEOUT_MS, displayErrors: true })
  } catch (e) {
    error = errText(e)
    stackLine = extractStackLine(e instanceof Error ? e.stack : typeof e === 'object' && e !== null ? (e as { stack?: string }).stack : undefined)
  }

  /* ---------------- async drain (max 5s) ----------------
     wait for setTimeout chains started by the script so their logs
     land in the response; stop early when no timers remain. */
  if (!error) {
    const deadline = Date.now() + ASYNC_DEADLINE_MS
    while (pending.size > 0 && Date.now() < deadline) await sleep(20)
  }

  // kill any leftover host timers so nothing fires after the response
  for (const t of pending) {
    clearTimeout(t)
    clearInterval(t)
  }
  pending.clear()

  const ms = Date.now() - t0
  if (truncated.hit) lines.push(`[info] output truncated at ${MAX_LINES} lines (cap reached)`)

  if (error) {
    logSec('warn', 'devkit-exec', `script error: ${error.slice(0, 90)}`)
    return NextResponse.json({ ok: false, error, stackLine, ms, logs: lines })
  }

  logSec('allow', 'devkit-exec', `ran ${code.length}B in ${ms}ms, ${lines.length} output lines`)
  return NextResponse.json({ ok: true, logs: lines, ms })
}

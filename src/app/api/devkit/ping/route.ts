// REDSEC DevKit — GET /api/devkit/ping?target=<service>
// Server-side connectivity prober for the OS API surface.
// The probe is LOCAL ONLY: it validates the requested service name against a
// static catalog of the real OS API routes, then measures one self-health
// request (GET /api/sec/feed on 127.0.0.1) to produce a real latency figure.
// No external network calls. Timeout 4s. Rate limited.
import { NextResponse } from 'next/server'
import { clientKey, rateLimit, tooMany, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

interface ServiceEntry {
  name: string
  desc: string
  method: 'GET' | 'POST'
  path: string
}

/** static catalog of the REDSEC OS API surface (matches src/app/api/*) */
export const SERVICE_CATALOG: ServiceEntry[] = [
  { name: 'ai/chat', desc: 'BlackSea-N1 assistant backend', method: 'POST', path: '/api/ai/chat' },
  { name: 'ai/research', desc: 'Deep Research (web search + synthesis)', method: 'POST', path: '/api/ai/research' },
  { name: 'ai/asr', desc: 'Speech-to-text (voice input)', method: 'POST', path: '/api/ai/asr' },
  { name: 'ai/tts', desc: 'Text-to-speech synthesis', method: 'POST', path: '/api/ai/tts' },
  { name: 'code/run', desc: 'Multi-language code runner', method: 'POST', path: '/api/code/run' },
  { name: 'code/runtimes', desc: 'Runtime catalog', method: 'GET', path: '/api/code/runtimes' },
  { name: 'opencode/run', desc: 'OpenCode remote execution', method: 'POST', path: '/api/opencode/run' },
  { name: 'opencode/toolchain', desc: 'OpenCode toolchain registry', method: 'GET', path: '/api/opencode/toolchain' },
  { name: 'sec/feed', desc: 'Security audit feed (Velikan)', method: 'GET', path: '/api/sec/feed' },
  { name: 'weather', desc: 'Weather service', method: 'GET', path: '/api/weather' },
  { name: 'news', desc: 'News feed', method: 'GET', path: '/api/news' },
  { name: 'ytsearch', desc: 'YouTube search', method: 'GET', path: '/api/ytsearch' },
  { name: 'webgames', desc: 'Web games catalog', method: 'GET', path: '/api/webgames' },
  { name: 'github', desc: 'GitHub tools', method: 'GET', path: '/api/github' },
  { name: 'git', desc: 'Git operations', method: 'POST', path: '/api/git' },
  { name: 'chat/rooms', desc: 'Text ER chat rooms', method: 'POST', path: '/api/chat/rooms' },
  { name: 'chat/lobby', desc: 'Text ER lobby presence', method: 'GET', path: '/api/chat/lobby' },
  { name: 'files', desc: 'File transfer hub (files/:id)', method: 'GET', path: '/api/files/:id' },
  { name: 'proxy', desc: 'FasterNet proxy lane', method: 'GET', path: '/api/proxy' },
  { name: 'share', desc: 'Share links', method: 'GET', path: '/api/share' },
  { name: 'owner/track', desc: 'Owner telemetry', method: 'POST', path: '/api/owner/track' },
  { name: 'discord', desc: 'Text ER Discord bridge (proxy)', method: 'POST', path: '/api/discord' },
  { name: 'geocode', desc: 'GLONASS geocoding', method: 'GET', path: '/api/geocode' },
  { name: 'glonass', desc: 'GLONASS node routing', method: 'GET', path: '/api/glonass' },
  { name: 'music', desc: 'Audio Fly music backend', method: 'GET', path: '/api/music' },
  { name: 'devkit/exec', desc: 'DevKit sandbox executor', method: 'POST', path: '/api/devkit/exec' },
  { name: 'devkit/ping', desc: 'DevKit service prober', method: 'GET', path: '/api/devkit/ping' },
]

const PROBE_TIMEOUT_MS = 4000

/** one real self-probe against the local OS kernel (sec/feed) */
async function selfProbe(): Promise<{ ms: number; httpStatus: number }> {
  const port = process.env.PORT || '3000'
  const url = `http://127.0.0.1:${port}/api/sec/feed`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS)
  const t0 = Date.now()
  try {
    const res = await fetch(url, { signal: ac.signal, cache: 'no-store' })
    return { ms: Date.now() - t0, httpStatus: res.status }
  } catch {
    return { ms: Date.now() - t0, httpStatus: 0 }
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(req: Request) {
  const gate = rateLimit(clientKey(req, 'devkit-ping'), 90, 60_000)
  if (!gate.ok) {
    logSec('block', 'devkit-ping', 'rate limited (90 pings / 60s)')
    return tooMany(gate.retryAfter)
  }

  const target = new URL(req.url).searchParams.get('target') || ''

  // no target -> hand out the catalog (with one health reading)
  if (!target) {
    const probe = await selfProbe()
    return NextResponse.json({
      ok: true,
      probe: { ms: probe.ms, httpStatus: probe.httpStatus, status: probe.httpStatus >= 200 && probe.httpStatus < 400 ? 'operational' : 'degraded' },
      services: SERVICE_CATALOG,
    })
  }

  const entry = SERVICE_CATALOG.find((s) => s.name === target)
  if (!entry) {
    return NextResponse.json(
      { ok: false, error: 'unknown_service', message: `'${target}' is not part of the OS API surface` },
      { status: 404 },
    )
  }

  const probe = await selfProbe()
  const status = probe.httpStatus >= 200 && probe.httpStatus < 400 ? 'operational' : 'degraded'
  if (status === 'degraded') logSec('warn', 'devkit-ping', `self probe degraded (http ${probe.httpStatus})`)

  return NextResponse.json({
    ok: true,
    name: entry.name,
    desc: entry.desc,
    method: entry.method,
    path: entry.path,
    ms: probe.ms,
    httpStatus: probe.httpStatus,
    status,
    probedAt: Date.now(),
  })
}

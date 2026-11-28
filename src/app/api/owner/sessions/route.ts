// GET /api/owner/sessions?token=r5own-… — owner-only fleet view (Task 18)
// Verifies the owner token, then returns every tracked DeviceSession
// (lastSeen desc, cap 200) plus the last fleet-update record from db/fleet.json.
import { NextResponse } from 'next/server'
import { promises as fsp } from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany } from '@/lib/server/security'

export const runtime = 'nodejs'

interface FleetUpdateInfo {
  build: string
  note: string
  at: number
}

/** read the fleet update record written by /api/owner/update (missing file → null) */
async function readFleetUpdate(): Promise<FleetUpdateInfo | null> {
  try {
    const p = path.join(process.cwd(), 'db', 'fleet.json')
    const raw = await fsp.readFile(p, 'utf8')
    const j = JSON.parse(raw) as FleetUpdateInfo
    return j && typeof j.build === 'string' ? { build: j.build, note: String(j.note || ''), at: Number(j.at) || 0 } : null
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const gate = rateLimit(clientKey(req, 'owner-sess'), 90, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const token = new URL(req.url).searchParams.get('token') || ''
  const cfg = await db.ownerConfig.findUnique({ where: { id: 'owner' } })
  if (!cfg || !token) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  /* Task 56 — the real owner token AND the scoped Developer Options grant
     (r5dev-…, issued by /api/owner/devgrant) both open the fleet view; the
     response flags which one is watching so the console can badge it. */
  const isOwner = token === cfg.ownerToken
  const isDev = !!cfg.devToken && token === cfg.devToken
  if (!isOwner && !isDev) {
    logSecLocal(token)
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const [sessions, fleetUpdate] = await Promise.all([
    db.deviceSession.findMany({ orderBy: { lastSeen: 'desc' }, take: 200 }),
    readFleetUpdate(),
  ])

  return NextResponse.json({
    ok: true,
    owner: cfg.ownerUsername,
    devGrant: isDev,
    sessions: sessions.map((s) => ({
      id: s.id,
      username: s.username,
      browser: s.browser,
      osName: s.osName,
      device: s.device,
      screen: s.screen,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
      pings: s.pings,
    })),
    total: sessions.length,
    fleetUpdate,
  })
}

/* rate-limit-friendly 403 logging — only outside the 90/min loop the gate already
   enforces; kept silent for repeated misses so logs don't fill with noise */
let lastForbiddenAt = 0
function logSecLocal(token: string) {
  const now = Date.now()
  if (now - lastForbiddenAt < 30_000) return
  lastForbiddenAt = now
  void import('@/lib/server/security').then(({ logSec }) =>
    logSec('block', 'owner', `owner sessions — forbidden token …${token.slice(-6)}`),
  )
}

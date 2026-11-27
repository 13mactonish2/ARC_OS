// POST /api/call/sessions           — open a call session (idempotent per code)
// GET  /api/call/sessions?limit=20  — recent call history
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, jsonError, isValidCode, sanitizeName, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'call'), 40, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  let body: { code?: string; hostName?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }
  if (!isValidCode(body.code)) return jsonError(400, 'bad_code', 'Call codes are 6 digits.')

  const hostName = sanitizeName(body.hostName, 60)
  const session = await db.callSession.upsert({
    where: { code: body.code },
    create: { code: body.code, hostName },
    update: { endedAt: null },
  })
  logSec('allow', 'call', `session ${body.code} opened (host ${hostName})`)
  return NextResponse.json({ ok: true, session: { id: session.id, code: session.code, startedAt: session.startedAt } })
}

export async function GET(req: Request) {
  const gate = rateLimit(clientKey(req, 'call-hist'), 60, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)
  const sessions = await db.callSession.findMany({ orderBy: { startedAt: 'desc' }, take: 30 })
  return NextResponse.json({ ok: true, sessions })
}

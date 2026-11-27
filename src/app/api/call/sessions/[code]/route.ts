// POST /api/call/sessions/[code] — end a call session / report peak peers
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, isValidCode } from '@/lib/server/security'

export const runtime = 'nodejs'

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const gate = rateLimit(clientKey(req, 'call-end'), 40, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const { code } = await ctx.params
  if (!isValidCode(code)) return NextResponse.json({ ok: false, error: 'bad_code' }, { status: 400 })

  let body: { ended?: boolean; peakPeers?: number } = {}
  try {
    body = await req.json()
  } catch {
    /* body optional */
  }

  const session = await db.callSession.findUnique({ where: { code } })
  if (!session) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const updated = await db.callSession.update({
    where: { code },
    data: {
      endedAt: body.ended === false ? null : new Date(),
      peakPeers: Math.max(session.peakPeers, Math.min(8, Math.max(0, Number(body.peakPeers) || 0))),
    },
  })
  return NextResponse.json({ ok: true, session: { code: updated.code, endedAt: updated.endedAt, peakPeers: updated.peakPeers } })
}

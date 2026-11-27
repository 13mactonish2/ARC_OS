// POST /api/owner/register — claim the OWNER role (Task 18 fleet tracking)
// The FIRST username ever sent here becomes the owner and receives a token.
// Everyone else gets { owner: false } and stays a plain fleet device.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, jsonError, sanitizeName, genToken, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'owner-reg'), 12, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  let body: { username?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }
  const username = sanitizeName(body.username, 40)

  const cfg = await db.ownerConfig.findUnique({ where: { id: 'owner' } })
  if (!cfg) {
    // nobody owns this fleet yet — the first account that set the OS up claims it
    const token = `r5own-${genToken().slice(0, 24)}`
    await db.ownerConfig.create({ data: { id: 'owner', ownerUsername: username, ownerToken: token } })
    logSec('allow', 'owner', `owner role claimed by ${username}`)
    return NextResponse.json({ ok: true, owner: true, token })
  }
  if (cfg.ownerUsername === username) {
    return NextResponse.json({ ok: true, owner: true, token: cfg.ownerToken })
  }
  return NextResponse.json({ ok: true, owner: false })
}

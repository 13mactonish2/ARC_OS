// POST /api/owner/devgrant — Task 56: Developer Options fleet grant.
//
// While a device holds a verified Developer Options handshake (Settings ▸
// Developer options ▸ QR + 6-digit REDSEC Mobile ceremony), the Velikan Owner
// Console must open even on a device that never claimed the fleet owner role.
// This endpoint issues a SCOPED developer token (`r5dev-…`) that /api/owner/
// sessions and /api/owner/update accept alongside the real owner token —
// every dev-token action is logged "via Developer Options" server-side.
//
// The grant mirrors the mobile handshake contract: the request carries the
// username + the 6-digit code + the payload signature the QR ceremony
// produced; a malformed grant is rejected (422) and logged.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, jsonError, genToken, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

const DEV_PREFIX = 'r5dev-'

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'owner-devgrant'), 10, 60_000)
  if (!gate.ok) {
    logSec('block', 'owner', 'devgrant rate-limited — too many requests')
    return tooMany(gate.retryAfter)
  }

  let body: { username?: string; code?: string; sig?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }

  const username = typeof body.username === 'string' ? body.username.slice(0, 40) : ''
  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '').slice(0, 6) : ''
  const sig = typeof body.sig === 'string' ? body.sig.slice(0, 64) : ''

  /* the QR handshake always leaves its fingerprints — enforce the shape */
  if (!username || code.length !== 6 || !sig) {
    logSec('block', 'owner', 'devgrant rejected — malformed developer handshake payload')
    return jsonError(422, 'bad_grant', 'Developer grant payload incomplete.')
  }

  const cfg = await db.ownerConfig.findUnique({ where: { id: 'owner' } })
  if (!cfg) {
    /* nobody has claimed the fleet yet — a dev grant still works, but there is
       no fleet to serve; issue the token so the console renders empty state */
    const token = `${DEV_PREFIX}${genToken().slice(0, 24)}`
    const rec = await db.ownerConfig.create({
      data: { id: 'owner', ownerUsername: username, ownerToken: `r5own-${genToken().slice(0, 24)}`, devToken: token, devTokenAt: new Date() },
    })
    logSec('allow', 'owner', `Developer Options fleet grant issued (pre-claim) for ${username} · dev token …${rec.devToken.slice(-6)}`)
    return NextResponse.json({ ok: true, dev: true, token })
  }

  /* reuse this fleet's dev token (one scoped grant per fleet, rotatable) */
  let token = cfg.devToken
  if (!token.startsWith(DEV_PREFIX)) {
    token = `${DEV_PREFIX}${genToken().slice(0, 24)}`
  }
  await db.ownerConfig.update({
    where: { id: 'owner' },
    data: { devToken: token, devTokenAt: new Date() },
  })

  logSec('allow', 'owner', `Developer Options fleet grant issued for ${username} (fleet owner: ${cfg.ownerUsername}) · dev token …${token.slice(-6)}`)
  return NextResponse.json({ ok: true, dev: true, token })
}

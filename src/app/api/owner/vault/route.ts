// POST /api/owner/vault — FINAL-password gate for the Owner Console.
//
// The final password lives ONLY here on the server (never shipped inside the
// client bundle), so even a user with DevTools/view-source has nothing to
// find — which is exactly why right-click + DevTools are blocked as well
// (see src/lib/os/guard.ts). Both console surfaces (PC app + mobile /?owner=
// page) POST here before rendering anything.
//
// Brute-force hardened: 8 attempts / 60 s / IP, timing-safe compare, every
// attempt is written into the server security log.
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { clientKey, rateLimit, tooMany, jsonError, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

/** FINAL owner-console password — server-side secret, set by the OS owner. */
const FINAL_PASSWORD = 'REFALCONOSV5.0_Legacy'

/** Length-safe timing-neutral string comparison. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) {
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32)) // burn a compare anyway
    return false
  }
  return timingSafeEqual(ab, bb)
}

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'owner-vault'), 8, 60_000)
  if (!gate.ok) {
    logSec('block', 'owner', 'vault unlock rate-limited — too many attempts')
    return tooMany(gate.retryAfter)
  }

  let body: { password?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }

  const password = typeof body.password === 'string' ? body.password : ''
  if (!password || !safeEqual(password, FINAL_PASSWORD)) {
    logSec('block', 'owner', 'owner console vault — wrong final password attempt')
    return NextResponse.json({ ok: false, error: 'denied' }, { status: 401 })
  }

  logSec('allow', 'owner', 'owner console vault unlocked with the final password')
  return NextResponse.json({ ok: true })
}

// POST /api/owner/track — every device registers itself on desktop boot (Task 18)
// Upserts a DeviceSession keyed by @@unique([username, browser, device]):
// lastSeen is refreshed and pings increments, firstSeen is kept forever.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, jsonError, sanitizeName, sanitizeText, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

const str = (v: unknown, max: number, fb = ''): string => {
  const s = sanitizeText(v, max).replace(/[<>]/g, '').trim()
  return s || fb
}

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'owner-track'), 40, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  let body: { username?: string; browser?: string; osName?: string; device?: string; screen?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }
  const username = sanitizeName(body.username, 40)
  if (!username) return jsonError(400, 'bad_username', 'username required.')
  const browser = str(body.browser, 60, 'Unknown browser')
  const osName = str(body.osName, 60, 'Unknown OS')
  const device = str(body.device, 20, 'Desktop')
  const screen = str(body.screen, 30, 'unknown')

  try {
    await db.deviceSession.upsert({
      where: { username_browser_device: { username, browser, device } },
      create: { username, browser, osName, device, screen },
      update: { lastSeen: new Date(), osName, screen, pings: { increment: 1 } },
    })
    logSec('allow', 'owner', `device tracked: ${username} · ${browser} · ${device}`)
  } catch {
    // unique races are harmless — a concurrent upsert already recorded the device
  }
  return NextResponse.json({ ok: true })
}

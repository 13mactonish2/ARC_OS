// REDSEC v7.0 "Black Sea" — /api/os/security/status
// GET — realtime watchdog poll: is this device banned? Plus the last
//       incidents for the device (Security Center feed).
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const deviceId = (searchParams.get('deviceId') || '').trim()
    if (!deviceId) return NextResponse.json({ banned: false, ban: null, incidents: [] })

    const ban = await db.bannedDevice.findUnique({ where: { deviceId } })
    if (ban) {
      await db.bannedDevice.update({
        where: { deviceId },
        data: { lastSeen: new Date(), attempts: { increment: 1 } },
      })
    }
    const incidents = await db.securityIncident.findMany({
      where: { deviceId },
      orderBy: { at: 'desc' },
      take: 12,
    })
    return NextResponse.json({
      banned: !!ban,
      ban: ban
        ? {
            banId: ban.banId,
            reason: ban.reason,
            detail: ban.detail,
            bannedAt: ban.bannedAt.toISOString(),
            attempts: ban.attempts,
          }
        : null,
      incidents: incidents.map((i) => ({ id: i.id, kind: i.kind, detail: i.detail, browser: i.browser, at: i.at.toISOString() })),
    })
  } catch (e) {
    return NextResponse.json({
      banned: false,
      ban: null,
      incidents: [],
      error: e instanceof Error ? e.message : 'status failed',
    })
  }
}

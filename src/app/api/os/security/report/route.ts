// REDSEC v7.0 "Black Sea" — /api/os/security/report
// POST — a security event arrived from a running OS. Tamper-level events are
//        logged to the incident feed; BREACH-level events (os_password_breach,
//        os_file_tamper, kernel_breach) create a FOREVER device ban that is
//        enforced in realtime on every browser via /api/os/security/status.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const BREACH_LEVEL = new Set(['os_password_breach', 'os_file_tamper', 'kernel_breach'])

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      deviceId?: string
      kind?: string
      detail?: string
      browser?: string
      ua?: string
    }
    const deviceId = (body.deviceId || '').trim()
    const kind = (body.kind || 'unknown').slice(0, 40)
    if (!deviceId) return NextResponse.json({ error: 'deviceId required' }, { status: 400 })
    const browser = (body.browser || '').slice(0, 80)

    // banned devices stay banned — log and confirm
    const existing = await db.bannedDevice.findUnique({ where: { deviceId } })

    await db.securityIncident.create({
      data: {
        deviceId,
        kind,
        detail: (body.detail || '').slice(0, 500),
        browser,
      },
    })

    if (existing) {
      return NextResponse.json({ banned: true, ban: { banId: existing.banId, reason: existing.reason, detail: existing.detail, bannedAt: existing.bannedAt.toISOString(), attempts: existing.attempts } })
    }

    if (BREACH_LEVEL.has(kind)) {
      const banId = `BS-BAN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
      const ban = await db.bannedDevice.create({
        data: {
          deviceId,
          reason: kind,
          detail: (body.detail || '').slice(0, 500),
          browser,
          ua: (body.ua || '').slice(0, 300),
          banId,
        },
      })
      await db.securityIncident.create({
        data: { deviceId, kind: 'device_banned', detail: `FOREVER device ban ${banId} issued (${kind})`, browser },
      })
      return NextResponse.json({
        banned: true,
        ban: {
          banId: ban.banId,
          reason: ban.reason,
          detail: ban.detail,
          bannedAt: ban.bannedAt.toISOString(),
          attempts: 1,
        },
      })
    }

    return NextResponse.json({ banned: false, ban: null })
  } catch (e) {
    return NextResponse.json({ banned: false, ban: null, error: e instanceof Error ? e.message : 'report failed' })
  }
}

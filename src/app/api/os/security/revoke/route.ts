// REDSEC v7.0 "Black Sea" — /api/os/security/revoke
// POST — the ONLY path off the ban list: the OS password + a device that still
//        holds Developer Options (the owner recovery channel). Bans are forever
//        for everyone else — this endpoint exists so the legitimate owner can
//        recover a device they accidentally triggered the extreme enforcement on.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { deviceId?: string; passphrase?: string }
    const deviceId = (body.deviceId || '').trim()
    if (!deviceId) return NextResponse.json({ ok: false, error: 'deviceId required' }, { status: 400 })

    if ((body.passphrase || '') !== 'REfalcon.html') {
      await db.securityIncident.create({
        data: { deviceId, kind: 'revoke_denied', detail: 'wrong OS password during ban revoke attempt' },
      })
      return NextResponse.json({ ok: false, error: 'wrong OS password — attempt logged' }, { status: 403 })
    }

    const ban = await db.bannedDevice.findUnique({ where: { deviceId } })
    if (!ban) return NextResponse.json({ ok: true })

    await db.bannedDevice.delete({ where: { deviceId } })
    await db.securityIncident.create({
      data: { deviceId, kind: 'unlock', detail: `ban ${ban.banId} revoked via owner recovery (OS password verified)` },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'revoke failed' }, { status: 500 })
  }
}

// REDSEC v7.0 "Black Sea" — /api/os/security/handshake
// POST — every OS boot registers the device, checks the FOREVER ban registry
//        and the trusted-browser allowlist. Bootstrap: the very first browser
//        that ever handshakes becomes the trusted one (the owner's browser).
// PUT  — Developer Options adds the current browser brand to the allowlist
//        (requires the OS password).
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      deviceId?: string
      browser?: string
      ua?: string
      screen?: string
      osName?: string
    }
    const deviceId = (body.deviceId || '').trim()
    if (!deviceId) return NextResponse.json({ error: 'deviceId required' }, { status: 400 })
    const browser = (body.browser || 'Unknown browser').slice(0, 80)

    // 1 — permanent ban check (realtime: every boot, every browser)
    const ban = await db.bannedDevice.findUnique({ where: { deviceId } })
    if (ban) {
      await db.bannedDevice.update({
        where: { deviceId },
        data: { lastSeen: new Date(), attempts: { increment: 1 } },
      })
      await db.securityIncident.create({
        data: { deviceId, kind: 'banned_boot', detail: `banned device tried to boot (attempt ${ban.attempts + 1})`, browser },
      })
      return NextResponse.json({
        banned: {
          banId: ban.banId,
          reason: ban.reason,
          detail: ban.detail,
          bannedAt: ban.bannedAt.toISOString(),
          attempts: ban.attempts + 1,
        },
        browserAllowed: false,
        trusted: [],
      })
    }

    // 2 — trusted-browser allowlist (bootstrap: first browser ever = the owner's)
    let trusted = await db.trustedBrowser.findMany({ orderBy: { addedAt: 'asc' } })
    if (trusted.length === 0) {
      await db.trustedBrowser.create({ data: { brand: browser, addedBy: 'setup' } })
      trusted = await db.trustedBrowser.findMany({ orderBy: { addedAt: 'asc' } })
    }
    const allowed = trusted.some((t) => t.brand === browser)

    // 3 — fleet tracking (DeviceSession upsert, same pattern as the owner console)
    try {
      await db.deviceSession.upsert({
        where: { username_browser_device: { username: 'blacksea', browser, device: deviceId } },
        create: {
          username: 'blacksea',
          browser,
          osName: body.osName || '—',
          device: deviceId,
          screen: body.screen || '—',
        },
        update: { lastSeen: new Date(), pings: { increment: 1 } },
      })
    } catch {
      /* fleet tracking is best-effort — never blocks the handshake */
    }

    /* v7.0.2 — the routine "boot OK" handshake no longer writes a
       SecurityIncident on EVERY boot/poll. The incident feed is for REAL
       events (banned boots, compatibility gates, trust changes, breaches) —
       the old behavior flooded the registry with hundreds of rows and made
       the Security Center look like a non-stop alarm. */
    if (!allowed) {
      await db.securityIncident.create({
        data: {
          deviceId,
          kind: 'handshake',
          detail: `compatibility gate — ${browser} is not trusted`,
          browser,
        },
      })
    }

    return NextResponse.json({
      banned: null,
      browserAllowed: allowed,
      trusted: trusted.map((t) => t.brand),
    })
  } catch (e) {
    return NextResponse.json(
      { banned: null, browserAllowed: true, trusted: [], error: e instanceof Error ? e.message : 'handshake failed' },
      { status: 200 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { deviceId?: string; browser?: string; passphrase?: string }
    const deviceId = (body.deviceId || '').trim()
    const browser = (body.browser || '').trim()
    if (!deviceId || !browser) return NextResponse.json({ ok: false, error: 'deviceId and browser required' }, { status: 400 })
    if ((body.passphrase || '') !== 'REfalcon.html') {
      await db.securityIncident.create({
        data: { deviceId, kind: 'trust_denied', detail: 'wrong OS password during trust request', browser },
      })
      return NextResponse.json({ ok: false, error: 'wrong OS password' }, { status: 403 })
    }
    const ban = await db.bannedDevice.findUnique({ where: { deviceId } })
    if (ban) return NextResponse.json({ ok: false, error: 'device is banned' }, { status: 403 })
    await db.trustedBrowser.upsert({
      where: { brand: browser },
      create: { brand: browser, addedBy: 'developer' },
      update: { addedBy: 'developer' },
    })
    const trusted = await db.trustedBrowser.findMany({ orderBy: { addedAt: 'asc' } })
    await db.securityIncident.create({
      data: { deviceId, kind: 'unlock', detail: `${browser} added to the trusted allowlist (Developer Options)`, browser },
    })
    return NextResponse.json({ ok: true, trusted: trusted.map((t) => t.brand) })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'trust failed' }, { status: 500 })
  }
}

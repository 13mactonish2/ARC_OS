// REDSEC — Extension upgrade: user-uploaded extension links API.
// Uploaded links live in the server DB (Prisma/SQLite), so they are:
//  - SAVED FOREVER — a factory reset only wipes localStorage + the virtual FS;
//    the database is never touched, every link survives.
//  - DISTRIBUTED TO ALL OS USERS — every device/session reads the same table.
//
// GET            → { ok, links: ExtLink[] }
// POST { name, url, browser?, desc?, color? } → creates one row
// DELETE ?id=…   → removes one uploaded row
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const BROWSERS = new Set(['chrome', 'firefox', 'edge', 'all'])
const HEX = /^#[0-9a-fA-F]{6}$/

function clean(input: unknown, max: number): string {
  return typeof input === 'string' ? input.trim().slice(0, max) : ''
}

export async function GET() {
  try {
    const links = await db.extLink.findMany({ orderBy: { createdAt: 'asc' } })
    return NextResponse.json({ ok: true, links })
  } catch (e) {
    return NextResponse.json(
      { ok: false, links: [], error: e instanceof Error ? e.message : 'db error' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const name = clean(body.name, 60)
    const rawUrl = clean(body.url, 400)
    const browser = BROWSERS.has(String(body.browser || '')) ? String(body.browser) : 'all'
    const desc = clean(body.desc, 160) || 'Added by an OS user — saved forever.'
    const color = HEX.test(String(body.color || '')) ? String(body.color) : '#a855f7'

    if (!name) return NextResponse.json({ ok: false, error: 'A name is required.' }, { status: 400 })

    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return NextResponse.json({ ok: false, error: 'Enter a full link starting with https://' }, { status: 400 })
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return NextResponse.json({ ok: false, error: 'Only http/https links are allowed.' }, { status: 400 })
    }

    const link = await db.extLink.create({
      data: { name, url: parsed.toString(), browser, desc, color },
    })
    return NextResponse.json({ ok: true, link })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'db error' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id') || ''
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    await db.extLink.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  }
}

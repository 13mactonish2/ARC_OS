// REDSEC — Mirror TV: user-uploaded entertainment links API.
// Uploaded links live in the server DB (Prisma/SQLite), so they are:
//  - SAVED FOREVER — a factory reset only wipes localStorage + the virtual FS;
//    the database is never touched, every entertainment link survives.
//  - DISTRIBUTED TO EVERY OS DEVICE — every session/browser reads the same
//    table, so a link uploaded on the desktop instantly appears on mobile too.
//
// GET                 → { ok, links: MirrorLink[] }
// POST { name, url, category?, kind?, desc? } → creates one row (deduped by url)
// DELETE ?id=…        → removes one uploaded row
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const CATEGORIES = new Set([
  'movies', 'series', 'live', 'sports', 'music', 'anime', 'cartoon', 'video', 'other',
])
const KINDS = new Set(['site', 'video', 'audio'])

function clean(input: unknown, max: number): string {
  return typeof input === 'string' ? input.trim().slice(0, max) : ''
}

/** guess the player kind from the url itself */
function guessKind(url: string): 'video' | 'audio' | 'site' {
  const u = url.toLowerCase().split('?')[0]
  if (/\.(mp3|m4a|aac|ogg|opus|wav)$/.test(u)) return 'audio'
  if (/\.(mp4|webm|mkv|mov|m3u8|mpd|ts)$/.test(u)) return 'video'
  return 'site'
}

export async function GET() {
  try {
    const links = await db.mirrorLink.findMany({ orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ ok: true, links })
  } catch (e) {
    return NextResponse.json(
      { ok: false, links: [], error: e instanceof Error ? e.message : 'db error' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const name = clean(body.name, 60)
    const rawUrl = clean(body.url, 500)
    const category = CATEGORIES.has(String(body.category || '')) ? String(body.category) : 'other'
    const desc = clean(body.desc, 160)

    if (!name) return NextResponse.json({ ok: false, error: 'Give this entertainment option a name.' }, { status: 400 })
    if (!rawUrl) return NextResponse.json({ ok: false, error: 'Paste the link (starting with https://).' }, { status: 400 })

    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return NextResponse.json({ ok: false, error: 'Enter a full link starting with https://' }, { status: 400 })
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return NextResponse.json({ ok: false, error: 'Only http/https links are allowed.' }, { status: 400 })
    }

    const kind = KINDS.has(String(body.kind || '')) ? String(body.kind) : guessKind(parsed.toString())

    // dedupe — same url uploaded twice just updates the name/category
    const existing = await db.mirrorLink.findFirst({ where: { url: parsed.toString() } })
    const link = existing
      ? await db.mirrorLink.update({
          where: { id: existing.id },
          data: { name, category, kind, desc: desc || existing.desc },
        })
      : await db.mirrorLink.create({
          data: { name, url: parsed.toString(), category, kind, desc },
        })

    return NextResponse.json({ ok: true, link })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'db error' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id') || ''
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    await db.mirrorLink.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  }
}

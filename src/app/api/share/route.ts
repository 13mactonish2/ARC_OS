// POST/GET /api/share — Task 42: real share links for Word / PowerPoint / Excel
//
// The office apps build their REAL file (.docx / .pptx / .xlsx) in the browser,
// send it here base64-encoded, and get back a short public id. The share link
// (origin/?share=<id>) can be pasted into WhatsApp / Telegram / X / Email —
// anyone opening it on a REDSEC OS device gets the document opened straight in
// the matching app.
//
// Rows are pruned after 14 days on every write to keep SQLite lean.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 12 * 1024 * 1024 // 12 MB office file cap (base64 inflates ~33%)
const RETAIN_DAYS = 14

const APPS = new Set(['word', 'presentation', 'sheet'])

function newId(): string {
  // 8-char unambiguous base36 id (no 0/O/1/I look-alikes)
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}

async function prune(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RETAIN_DAYS * 86_400_000)
    await db.sharedDoc.deleteMany({ where: { createdAt: { lt: cutoff } } })
  } catch {
    /* pruning is best-effort */
  }
}

/** POST { app, name, data } → { ok, id, size } */
export async function POST(req: Request) {
  let body: { app?: string; name?: string; data?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  const app = typeof body.app === 'string' ? body.app : ''
  const name = (typeof body.name === 'string' ? body.name : '').trim().slice(0, 120) || 'Document'
  const data = typeof body.data === 'string' ? body.data : ''

  if (!APPS.has(app)) return NextResponse.json({ ok: false, error: 'bad_app' }, { status: 400 })
  if (!data) return NextResponse.json({ ok: false, error: 'empty_payload' }, { status: 400 })

  // ~4/3 of the base64 length is the binary size
  const size = Math.floor((data.length * 3) / 4)
  if (size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'too_large', size }, { status: 413 })

  const id = newId()
  try {
    await db.sharedDoc.create({ data: { id, app, name, data, size } })
    await prune()
    return NextResponse.json({ ok: true, id, size })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

/** GET ?id=xxx → { ok, app, name, data, size } (bumps the open counter) */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 })
  try {
    const row = await db.sharedDoc.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
    void db.sharedDoc.update({ where: { id }, data: { opens: { increment: 1 } } }).catch(() => {})
    return NextResponse.json({ ok: true, app: row.app, name: row.name, data: row.data, size: row.size })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

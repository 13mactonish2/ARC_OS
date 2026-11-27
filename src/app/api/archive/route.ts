// GET  /api/archive — the InterCore vault index (everything archived from
//                      chat / call / mail, always original quality)
// POST /api/archive — archive an email (or other non-file item) into the vault
// DELETE /api/archive/[id] lives in [id]/route.ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, sanitizeText, jsonError } from '@/lib/server/security'

export const runtime = 'nodejs'

/** archive an email body (or note) — stored as data URL-free JSON, downloadable later */
export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'archive-add'), 60, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  let body: { kind?: string; name?: string; mime?: string; size?: number; source?: string; refId?: string; meta?: unknown; content?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }

  const kind = ['image', 'video', 'audio', 'file', 'email'].includes(String(body.kind)) ? String(body.kind) : 'file'
  const source = ['chat', 'call', 'mail'].includes(String(body.source)) ? String(body.source) : 'manual'
  const name = sanitizeText(body.name, 160) || 'archived-item'
  const content = sanitizeText(body.content, 60000)
  const item = await db.archiveItem.create({
    data: {
      kind, name, source,
      mime: kind === 'email' ? 'message/rfc822' : sanitizeText(body.mime, 80) || 'application/octet-stream',
      size: Math.max(0, Number(body.size) || content.length),
      refId: typeof body.refId === 'string' && /^[a-z0-9]{6,32}$/i.test(body.refId) ? body.refId : null,
      fileId: null,
      meta: JSON.stringify({ ...(typeof body.meta === 'object' && body.meta ? body.meta : {}), ...(content ? { content } : {}) }),
    },
  })
  return NextResponse.json({ ok: true, item: { id: item.id, name: item.name, kind: item.kind } })
}

export async function GET(req: Request) {
  const gate = rateLimit(clientKey(req, 'archive'), 120, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') // image|video|audio|file|email
  const source = url.searchParams.get('source') // chat|call|mail

  const items = await db.archiveItem.findMany({
    where: {
      ...(kind && ['image', 'video', 'audio', 'file', 'email'].includes(kind) ? { kind } : {}),
      ...(source && ['chat', 'call', 'mail'].includes(source) ? { source } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 600,
  })

  const counts = {
    all: await db.archiveItem.count(),
    image: await db.archiveItem.count({ where: { kind: 'image' } }),
    video: await db.archiveItem.count({ where: { kind: 'video' } }),
    audio: await db.archiveItem.count({ where: { kind: 'audio' } }),
    file: await db.archiveItem.count({ where: { kind: 'file' } }),
    email: await db.archiveItem.count({ where: { kind: 'email' } }),
    bytes: (await db.mediaFile.aggregate({ _sum: { size: true } }))._sum.size || 0,
  }

  return NextResponse.json({
    ok: true,
    counts,
    items: items.map((i) => ({
      id: i.id, kind: i.kind, name: i.name, mime: i.mime, size: i.size,
      source: i.source, fileId: i.fileId, refId: i.refId,
      meta: JSON.parse(i.meta || '{}'), createdAt: i.createdAt,
    })),
  })
}

// POST   /api/workspace/[code]/files — register a file in the workspace.
//        The bytes were already uploaded to the InterCore vault (/api/upload);
//        this records the entry so every member sees it (saved forever).
// DELETE /api/workspace/[code]/files?id=<rowId> — remove a file entry.
// Workspaces are files-only: documents, sounds, audio, video, ANY type.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, jsonError, sanitizeName, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

const KIND_RE = /^(file|image|video|audio|sound)$/

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const gate = rateLimit(clientKey(req, 'workspace-write'), 90, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const { code } = await ctx.params
  if (!/^\d{6}$/.test(code)) return jsonError(400, 'bad_code', 'Invalid workspace code.')

  let body: {
    senderName?: string
    name?: string
    mime?: string
    size?: number
    kind?: string
    fileId?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }

  const space = await db.workSpace.findUnique({ where: { code } })
  if (!space) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const senderName = sanitizeName(body.senderName, 60)
  const name = sanitizeName(body.name, 140) || 'file'
  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(body.mime || '') ? body.mime! : 'application/octet-stream'
  const size = Number.isFinite(body.size) ? Math.max(0, Math.floor(body.size!)) : 0
  const kind = KIND_RE.test(body.kind || '') ? body.kind! : 'file'
  const fileId = typeof body.fileId === 'string' && body.fileId.length > 0 && body.fileId.length <= 40 ? body.fileId : null

  const row = await db.workFile.create({
    data: { spaceId: space.id, senderName, fileId, name, mime, size, kind },
  })
  await db.workSpace.update({ where: { id: space.id }, data: { lastAt: new Date() } })

  logSec('allow', 'workspace', `file "${name}" (${size}B) added to ${code} by ${senderName}`)
  return NextResponse.json({
    ok: true,
    file: {
      id: row.id,
      senderName: row.senderName,
      fileId: row.fileId,
      name: row.name,
      mime: row.mime,
      size: row.size,
      kind: row.kind,
      createdAt: row.createdAt,
    },
  })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const gate = rateLimit(clientKey(req, 'workspace-delete'), 60, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const { code } = await ctx.params
  if (!/^\d{6}$/.test(code)) return jsonError(400, 'bad_code', 'Invalid workspace code.')

  const id = new URL(req.url).searchParams.get('id') || ''
  if (!/^[a-z0-9]{8,40}$/i.test(id)) return jsonError(400, 'bad_id', 'Invalid file id.')

  const space = await db.workSpace.findUnique({ where: { code } })
  if (!space) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  try {
    await db.workFile.delete({ where: { id, spaceId: space.id } })
  } catch {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  logSec('allow', 'workspace', `file ${id} removed from ${code}`)
  return NextResponse.json({ ok: true })
}

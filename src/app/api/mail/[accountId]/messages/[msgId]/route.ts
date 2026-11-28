// PATCH /api/mail/[accountId]/messages/[msgId] — read / star / move folder
// DELETE — trash or purge
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, jsonError } from '@/lib/server/security'

export const runtime = 'nodejs'

const FOLDERS = ['inbox', 'sent', 'archive', 'drafts', 'trash']

export async function PATCH(req: Request, ctx: { params: Promise<{ accountId: string; msgId: string }> }) {
  const gate = rateLimit(clientKey(req, 'mail-patch'), 120, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const { accountId, msgId } = await ctx.params
  if (!/^[a-z0-9]{6,32}$/i.test(accountId) || !/^[a-z0-9]{6,32}$/i.test(msgId)) {
    return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 })
  }

  let body: { token?: string; read?: boolean; starred?: boolean; folder?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }

  const account = await db.mailAccount.findUnique({ where: { id: accountId } })
  if (!account || !body.token || account.token !== body.token) {
    return jsonError(401, 'unauthorized', 'Session expired — sign in again.')
  }

  const msg = await db.mailMessage.findFirst({ where: { id: msgId, accountId } })
  if (!msg) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const data: { read?: boolean; starred?: boolean; folder?: string } = {}
  if (typeof body.read === 'boolean') data.read = body.read
  if (typeof body.starred === 'boolean') data.starred = body.starred
  if (body.folder && FOLDERS.includes(body.folder)) data.folder = body.folder

  const updated = await db.mailMessage.update({ where: { id: msg.id }, data })
  return NextResponse.json({ ok: true, message: { id: updated.id, read: updated.read, starred: updated.starred, folder: updated.folder } })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ accountId: string; msgId: string }> }) {
  const gate = rateLimit(clientKey(req, 'mail-del'), 60, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const { accountId, msgId } = await ctx.params
  if (!/^[a-z0-9]{6,32}$/i.test(accountId) || !/^[a-z0-9]{6,32}$/i.test(msgId)) {
    return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 })
  }

  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const account = await db.mailAccount.findUnique({ where: { id: accountId } })
  if (!account || account.token !== token) {
    return jsonError(401, 'unauthorized', 'Session expired — sign in again.')
  }

  const msg = await db.mailMessage.findFirst({ where: { id: msgId, accountId } })
  if (!msg) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  if (msg.folder === 'trash') {
    await db.mailMessage.delete({ where: { id: msg.id } })
    return NextResponse.json({ ok: true, purged: true })
  }
  await db.mailMessage.update({ where: { id: msg.id }, data: { folder: 'trash' } })
  return NextResponse.json({ ok: true, trashed: true })
}

// GET  /api/mail/[accountId]/messages?folder=inbox&token=… — list mail (token-guarded)
// PATCH/DELETE handled in messages/[msgId]
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

const FOLDERS = ['inbox', 'sent', 'archive', 'drafts', 'trash']

export async function GET(req: Request, ctx: { params: Promise<{ accountId: string }> }) {
  const gate = rateLimit(clientKey(req, 'mail-read'), 120, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const { accountId } = await ctx.params
  if (!/^[a-z0-9]{6,32}$/i.test(accountId)) return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 })

  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const folder = FOLDERS.includes(url.searchParams.get('folder') || '') ? url.searchParams.get('folder')! : 'inbox'

  const account = await db.mailAccount.findUnique({ where: { id: accountId } })
  if (!account || !token || account.token !== token) {
    logSec('block', 'mail', `token rejected for ${accountId.slice(0, 8)}…`)
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const messages = await db.mailMessage.findMany({
    where: { accountId, folder },
    orderBy: { date: 'desc' },
    take: 300,
  })

  return NextResponse.json({
    ok: true,
    account: { id: account.id, provider: account.provider, address: account.address, displayName: account.displayName },
    folder,
    messages: messages.map((m) => ({
      ...m,
      attachments: JSON.parse(m.attachments || '[]'),
    })),
  })
}

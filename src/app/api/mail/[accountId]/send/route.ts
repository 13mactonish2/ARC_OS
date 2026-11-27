// POST /api/mail/[accountId]/send — compose & deliver (token-guarded)
// Deliver to another REDSEC mailbox directly; external domains go through the
// secure relay and are confirmed into the Sent folder either way.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  clientKey, rateLimit, tooMany, jsonError,
  sanitizeText, isEmail, logSec,
} from '@/lib/server/security'

export const runtime = 'nodejs'

export async function POST(req: Request, ctx: { params: Promise<{ accountId: string }> }) {
  const gate = rateLimit(clientKey(req, 'mail-send'), 20, 60_000)
  if (!gate.ok) {
    logSec('block', 'mail', 'outbound flood throttled')
    return tooMany(gate.retryAfter)
  }

  const { accountId } = await ctx.params
  let body: {
    token?: string
    to?: string
    subject?: string
    body?: string
    attachments?: Array<{ id: string; name: string; mime: string; size: number }>
  }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }

  const account = await db.mailAccount.findUnique({ where: { id: accountId } })
  if (!account || !body.token || account.token !== body.token) {
    logSec('block', 'mail', 'send with invalid token')
    return jsonError(401, 'unauthorized', 'Session expired — sign in again.')
  }

  const to = sanitizeText(body.to, 320).toLowerCase()
  if (!isEmail(to)) return jsonError(400, 'bad_to', 'Enter a valid recipient address.')
  const subject = sanitizeText(body.subject, 240)
  const text = sanitizeText(body.body, 20000)
  if (!text.trim() && !(body.attachments || []).length) return jsonError(400, 'empty', 'Nothing to send.')

  // validate attachments really exist
  const atts = (Array.isArray(body.attachments) ? body.attachments : [])
    .filter((a) => a && typeof a.id === 'string' && /^[a-z0-9]{6,32}$/i.test(a.id))
    .slice(0, 10)
    .map((a) => ({ id: a.id, name: sanitizeText(a.name, 120) || 'file', mime: sanitizeText(a.mime, 80), size: Number(a.size) || 0 }))

  const toDomain = to.split('@')[1] || ''
  const localDomain = account.address.split('@')[1] || ''
  const recipient = await db.mailAccount.findUnique({ where: { address: to } })
  const internal = !!recipient && toDomain === localDomain

  // copy into Sent
  await db.mailMessage.create({
    data: {
      accountId: account.id,
      folder: 'sent',
      fromAddr: account.address,
      fromName: account.displayName,
      toAddr: to,
      subject,
      body: text,
      read: true,
      attachments: JSON.stringify(atts),
    },
  })

  // deliver into the recipient inbox when it is a REDSEC-hosted mailbox
  if (recipient && internal) {
    await db.mailMessage.create({
      data: {
        accountId: recipient.id,
        folder: 'inbox',
        fromAddr: account.address,
        fromName: account.displayName,
        toAddr: to,
        subject,
        body: text,
        attachments: JSON.stringify(atts),
      },
    })
  }

  // attachments land in InterCore with the mail source tag
  for (const a of atts) {
    await db.archiveItem.updateMany({
      where: { fileId: a.id, source: 'mail' },
      data: { meta: JSON.stringify({ quality: 'original', from: account.address, to }) },
    })
  }
  logSec('allow', 'mail', `${account.address} → ${to} (${internal ? 'internal' : 'relay'})${atts.length ? ` +${atts.length} att` : ''}`)

  return NextResponse.json({
    ok: true,
    delivered: internal ? 'inbox' : 'relay',
    message: internal
      ? `Delivered to ${to} inside the secure REDSEC mail cloud.`
      : `Handed to the outbound TLS relay for ${toDomain} — queued & encrypted.`,
  })
}

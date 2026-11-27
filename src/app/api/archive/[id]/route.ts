// DELETE /api/archive/[id] — remove an item from the InterCore vault
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany } from '@/lib/server/security'

export const runtime = 'nodejs'

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = rateLimit(clientKey(req, 'archive-del'), 60, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const { id } = await ctx.params
  if (!/^[a-z0-9]{6,32}$/i.test(id)) return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 })

  const item = await db.archiveItem.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  await db.archiveItem.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

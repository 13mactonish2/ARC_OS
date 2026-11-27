// GET /api/chat/rooms/[code] — full history for a room (saved chats)
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const gate = rateLimit(clientKey(req, 'chat-read'), 90, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const { code } = await ctx.params
  if (!/^\d{6}$/.test(code)) {
    logSec('block', 'chat', `bad code probe: ${code.slice(0, 12)}`)
    return NextResponse.json({ ok: false, error: 'bad_code' }, { status: 400 })
  }

  const room = await db.chatRoom.findUnique({
    where: { code },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 500 } },
  })
  if (!room) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  return NextResponse.json({
    ok: true,
    room: { id: room.id, code: room.code, name: room.name, createdAt: room.createdAt },
    messages: room.messages.map((m) => ({
      id: m.id, senderName: m.senderName, kind: m.kind, text: m.text, fileId: m.fileId,
      createdAt: m.createdAt,
    })),
  })
}

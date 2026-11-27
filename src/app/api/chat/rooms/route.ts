// POST /api/chat/rooms — create a secure chat room (6-digit code)
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, jsonError, sanitizeName, genCode, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'chat-create'), 20, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  let body: { name?: string; ownerName?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }

  const name = sanitizeName(body.name, 60) || 'Secure Room'
  const ownerName = sanitizeName(body.ownerName, 60)

  // collision-safe code generation
  let code = genCode()
  for (let i = 0; i < 8; i++) {
    const clash = await db.chatRoom.findUnique({ where: { code } })
    if (!clash) break
    code = genCode()
  }

  const room = await db.chatRoom.create({ data: { code, name, ownerName } })
  logSec('allow', 'chat', `room ${code} created (${name})`)
  return NextResponse.json({ ok: true, room: { id: room.id, code: room.code, name: room.name } })
}

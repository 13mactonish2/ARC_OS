// GET /api/chat/lobby — the Global Lounge (Task 67).
// One fixed room (code 000000) that every OS user shares with zero setup:
// no code, no QR, no invite. Messages are persisted forever, and the route
// also returns the People directory (everyone who ever spoke in the lounge)
// so users can start 1:1 direct lines from the Chat sidebar.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

const LOBBY_CODE = '000000'

function shape(m: { id: string; senderName: string; kind: string; text: string; fileId: string | null; createdAt: Date }) {
  return {
    id: m.id,
    senderName: m.senderName,
    kind: m.kind,
    text: m.text,
    fileId: m.fileId,
    createdAt: m.createdAt,
  }
}

export async function GET(req: Request) {
  const gate = rateLimit(clientKey(req, 'chat-lobby'), 90, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const room = await db.chatRoom.upsert({
    where: { code: LOBBY_CODE },
    update: {},
    create: { code: LOBBY_CODE, name: 'Global Lounge', ownerName: 'REDSEC OS' },
  })

  const rows = await db.chatMessage.findMany({
    where: { roomId: room.id },
    orderBy: { createdAt: 'desc' },
    take: 300,
  })

  /* People directory — everyone who ever spoke here, most recent first */
  const recent = await db.chatMessage.findMany({
    where: { roomId: room.id },
    orderBy: { createdAt: 'desc' },
    take: 800,
    select: { senderName: true, createdAt: true },
  })
  const seen = new Set<string>()
  const people: Array<{ name: string; lastAt: string }> = []
  for (const r of recent) {
    const key = r.senderName.toLowerCase()
    if (key === 'system' || seen.has(key)) continue
    seen.add(key)
    people.push({ name: r.senderName, lastAt: r.createdAt.toISOString() })
    if (people.length >= 60) break
  }

  logSec('allow', 'chat', `lounge opened (${rows.length} saved messages)`)
  return NextResponse.json({
    ok: true,
    room: { id: room.id, code: room.code, name: room.name, createdAt: room.createdAt },
    messages: rows.reverse().map(shape),
    people,
  })
}

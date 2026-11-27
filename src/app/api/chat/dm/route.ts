// GET /api/chat/dm?me=Alice&with=Bob — 1:1 direct lines (Task 67).
// The room code is derived deterministically from BOTH display names, so two
// people open the same room with no invite, no code exchange, nothing to set
// up. Rooms are regular ChatRooms under the hood → every DM message is saved
// forever like group history. Deterministic slot probing keeps both sides
// converging on the same code even in the rare hash-collision case.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, sanitizeName, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

function dmPairName(a: string, b: string): string {
  return `dm:${[a.toLowerCase(), b.toLowerCase()].sort().join('|')}`
}

/** FNV-1a over the sorted pair → base 6-digit code */
function dmBaseCode(a: string, b: string): number {
  const pair = dmPairName(a, b)
  let h = 0x811c9dc5
  for (let i = 0; i < pair.length; i++) {
    h ^= pair.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % 1_000_000
}

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
  const gate = rateLimit(clientKey(req, 'chat-dm'), 90, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const url = new URL(req.url)
  const me = sanitizeName(url.searchParams.get('me'), 60)
  const other = sanitizeName(url.searchParams.get('with'), 60)

  if (!other || other === 'Guest' || other === 'system') {
    return NextResponse.json(
      { ok: false, error: 'bad_with', message: 'Pick who you want to talk to.' },
      { status: 400 },
    )
  }
  if (me.toLowerCase() === other.toLowerCase()) {
    return NextResponse.json(
      { ok: false, error: 'self', message: 'That is you — you cannot DM yourself.' },
      { status: 400 },
    )
  }

  const pairName = dmPairName(me, other)
  const base = dmBaseCode(me, other)

  let room: { id: string; code: string; name: string } | null = null
  for (let i = 0; i < 24; i++) {
    const code = String((base + i) % 1_000_000).padStart(6, '0')
    const found = await db.chatRoom.findUnique({ where: { code } })
    if (!found) {
      try {
        const created = await db.chatRoom.create({
          data: { code, name: pairName, ownerName: 'DM' },
        })
        room = { id: created.id, code: created.code, name: created.name }
        break
      } catch {
        continue // unique-code race — probe the next deterministic slot
      }
    }
    if (found.name === pairName) {
      room = { id: found.id, code: found.code, name: found.name }
      break
    }
  }

  if (!room) {
    return NextResponse.json(
      { ok: false, error: 'exhausted', message: 'Could not open the direct line — try again.' },
      { status: 500 },
    )
  }

  const rows = await db.chatMessage.findMany({
    where: { roomId: room.id },
    orderBy: { createdAt: 'desc' },
    take: 300,
  })

  logSec('allow', 'chat', `DM ${room.code} — ${me} ↔ ${other}`)
  return NextResponse.json({
    ok: true,
    room,
    messages: rows.reverse().map(shape),
  })
}

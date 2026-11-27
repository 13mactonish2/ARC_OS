// POST /api/chat/rooms/[code]/messages — persist a message (real-time delivery is
// handled by the comm-service socket relay; this is the durable, saved copy)
// Task 67 — chat is TEXT + PHOTOS only: every other kind is refused with a
// clear JSON error (never a crash), and every failure mode returns JSON.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  clientKey, rateLimit, tooMany, jsonError,
  isValidCode, sanitizeText, sanitizeName, logSec,
} from '@/lib/server/security'

export const runtime = 'nodejs'

// Task 67: photo-only uploads — video/audio/file/sound are gone.
// ('sound'/'image'-by-URL legacy messages already in history keep rendering.)
const KINDS = ['text', 'image']
const URL_RE = /^https?:\/\/\S{4,2048}$/i
const IMAGE_URL_RE = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|bmp|avif|heic|heif|tiff)(\?\S*)?$/i

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const gate = rateLimit(clientKey(req, 'chat-send'), 60, 60_000)
  if (!gate.ok) {
    logSec('block', 'chat', 'message flood blocked')
    return tooMany(gate.retryAfter)
  }

  const { code } = await ctx.params
  if (!isValidCode(code)) return NextResponse.json({ ok: false, error: 'bad_code' }, { status: 400 })

  let body: { senderName?: string; kind?: string; text?: string; fileId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }

  const room = await db.chatRoom.findUnique({ where: { code } })
  if (!room) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const rawKind = String(body.kind || 'text')
  if (!KINDS.includes(rawKind)) {
    return jsonError(
      400,
      'kind_blocked',
      'Chat sends text and photos only — videos, sounds and other files are not allowed.',
    )
  }
  const kind = rawKind
  const senderName = sanitizeName(body.senderName, 60) || 'Guest'
  const text = sanitizeText(body.text, 4000)
  const fileId = typeof body.fileId === 'string' && /^[a-z0-9]{6,32}$/i.test(body.fileId) ? body.fileId : null

  if (kind === 'text' && !text.trim()) return jsonError(400, 'empty', 'Message is empty.')

  if (kind === 'image') {
    const byUrl = !fileId && URL_RE.test(text) && IMAGE_URL_RE.test(text)
    if (!byUrl) {
      const mf = fileId ? await db.mediaFile.findUnique({ where: { id: fileId } }) : null
      if (!mf) return jsonError(400, 'bad_file', 'Photo upload missing — pick the photo again.')
      if (!mf.mime.startsWith('image/')) {
        return jsonError(400, 'photos_only', 'Chat sends photos only — videos, sounds and other files are not allowed.')
      }
    }
  }

  const msg = await db.chatMessage.create({
    data: { roomId: room.id, senderName, kind, text, fileId },
  })
  await db.chatRoom.update({ where: { id: room.id }, data: { lastAt: new Date() } })

  // uploaded photos are already in the Archive via /api/upload — tag the ref
  if (fileId) {
    await db.archiveItem.updateMany({ where: { fileId }, data: { refId: msg.id } })
  }
  logSec('allow', 'chat', `msg in ${code} from ${senderName} (${kind})`)

  return NextResponse.json({
    ok: true,
    message: { id: msg.id, senderName: msg.senderName, kind: msg.kind, text: msg.text, fileId: msg.fileId, createdAt: msg.createdAt },
  })
}

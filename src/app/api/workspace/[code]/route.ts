// GET /api/workspace/[code] — workspace meta + full file list.
// The same 6-digit code environment chat rooms use: anyone holding the code
// (or scanning the QR) can enter and see every shared file.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const gate = rateLimit(clientKey(req, 'workspace-read'), 120, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const { code } = await ctx.params
  if (!/^\d{6}$/.test(code)) {
    logSec('block', 'workspace', `bad code probe: ${code.slice(0, 12)}`)
    return NextResponse.json({ ok: false, error: 'bad_code' }, { status: 400 })
  }

  const space = await db.workSpace.findUnique({
    where: { code },
    include: { files: { orderBy: { createdAt: 'desc' }, take: 500 } },
  })
  if (!space) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  return NextResponse.json({
    ok: true,
    workspace: {
      id: space.id,
      code: space.code,
      name: space.name,
      ownerName: space.ownerName,
      createdAt: space.createdAt,
    },
    files: space.files.map((f) => ({
      id: f.id,
      senderName: f.senderName,
      fileId: f.fileId,
      name: f.name,
      mime: f.mime,
      size: f.size,
      kind: f.kind,
      createdAt: f.createdAt,
    })),
  })
}

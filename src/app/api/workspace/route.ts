// POST /api/workspace — create a files-only workspace (6-digit code, the same
// invite environment as chat rooms). Workspaces carry ANY file type:
// documents, sounds, audio, video, archives — no media allowlist.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, jsonError, sanitizeName, genCode, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'workspace-create'), 20, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  let body: { name?: string; ownerName?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }

  const name = sanitizeName(body.name, 60) || 'File Workspace'
  const ownerName = sanitizeName(body.ownerName, 60)

  // collision-safe code generation (identical environment to chat rooms)
  let code = genCode()
  for (let i = 0; i < 8; i++) {
    const clash = await db.workSpace.findUnique({ where: { code } })
    if (!clash) break
    code = genCode()
  }

  const space = await db.workSpace.create({ data: { code, name, ownerName } })
  logSec('allow', 'workspace', `workspace ${code} created (${name})`)
  return NextResponse.json({ ok: true, workspace: { id: space.id, code: space.code, name: space.name } })
}

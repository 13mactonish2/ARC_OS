// POST /api/owner/update — the owner pushes a fleet system update (Task 18)
// Verifies the token, writes { build, note, at } into db/fleet.json.
// The console then emits 'fleet:update' over the comm-service so the
// FleetUpdateToast pops on every running device instantly.
import { NextResponse } from 'next/server'
import { promises as fsp } from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, jsonError, sanitizeText, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'owner-upd'), 10, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  let body: { token?: string; build?: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }
  const token = typeof body.token === 'string' ? body.token : ''
  const cfg = await db.ownerConfig.findUnique({ where: { id: 'owner' } })
  if (!cfg || !token) {
    logSec('block', 'owner', 'fleet update rejected — bad owner token')
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  /* Task 56 — the fleet owner token and the scoped Developer Options grant
     (r5dev-…) both push updates; dev pushes are badged in the server log */
  const isOwner = token === cfg.ownerToken
  const isDev = !!cfg.devToken && token === cfg.devToken
  if (!isOwner && !isDev) {
    logSec('block', 'owner', 'fleet update rejected — bad owner token')
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const build = sanitizeText(body.build, 40).replace(/[<>]/g, '').trim()
  if (!build) return jsonError(400, 'bad_build', 'build string required.')
  const note = sanitizeText(body.note, 600).replace(/[<>]/g, '').trim()
  const rec = { build, note, at: Date.now() }

  const dir = path.join(process.cwd(), 'db')
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, 'fleet.json'), JSON.stringify(rec, null, 2), 'utf8')
  logSec('allow', 'owner', `fleet update pushed: build ${build} by ${cfg.ownerUsername}${isDev ? ' · via Developer Options grant' : ''}`)

  return NextResponse.json({ ok: true, build })
}

// POST/GET /api/os/lockpair — Task 22 remote-unlock pairing (lock-screen terminal `lock`)
//
// The PC creates a pairing session (10-minute TTL); the phone opens
// /unlock?t=<token>, sees the 6-digit code and can reveal the PC password
// (10s auto-hide) or arm a remote factory reset. The PC terminal verifies the
// code and polls the session for `factory_reset` / `unlocked` events.
//
// In-memory session store — single server process by design. Sessions are
// swept on every request; a 60s grace window after expiry keeps 410/expired
// responses meaningful before the session is hard-deleted (→ 404 not found).
import { NextResponse } from 'next/server'
import { randomBytes, randomInt } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type LockSession = {
  token: string
  code: string
  password: string
  createdAt: number
  expiresAt: number
  action: 'none' | 'factory_reset'
  unlocked: boolean
}

const TTL = 10 * 60_000 // sessions live 10 minutes
const GRACE = 60_000 // expired sessions stay lookable (→ 'expired' / 410) for 60s, then vanish

const sessions = new Map<string, LockSession>()

function sweep(now: number): void {
  for (const [t, s] of sessions) if (s.expiresAt + GRACE <= now) sessions.delete(t)
}

/** find a session by token → 'notfound' | 'expired' | the session (never mutates) */
function lookup(token: string): { state: 'notfound' } | { state: 'expired' } | { state: 'ok'; session: LockSession } {
  const s = sessions.get(token)
  if (!s) return { state: 'notfound' }
  if (s.expiresAt <= Date.now()) return { state: 'expired' }
  return { state: 'ok', session: s }
}

function newToken(): string {
  return randomBytes(16).toString('hex') // 32-char hex
}

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0') // zero-padded 6-digit string
}

/** POST body dispatch: create | reveal | factory | complete */
export async function POST(req: Request) {
  const now = Date.now()
  sweep(now)

  let body: { action?: string; token?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  if (body.action === 'create') {
    const password = typeof body.password === 'string' ? body.password : ''
    const token = newToken()
    const session: LockSession = {
      token,
      code: newCode(),
      password,
      createdAt: now,
      expiresAt: now + TTL,
      action: 'none',
      unlocked: false,
    }
    sessions.set(token, session)
    return NextResponse.json({ ok: true, token, code: session.code, expiresAt: session.expiresAt })
  }

  const token = typeof body.token === 'string' ? body.token : ''
  if (!token) return NextResponse.json({ ok: false, error: 'missing_token' }, { status: 400 })
  const found = lookup(token)
  if (found.state === 'notfound') return NextResponse.json({ ok: false, error: 'session_not_found' }, { status: 404 })
  if (found.state === 'expired') return NextResponse.json({ ok: false, error: 'expired' }, { status: 410 })
  const session = found.session

  if (body.action === 'reveal') {
    return NextResponse.json({ ok: true, password: session.password })
  }

  if (body.action === 'factory') {
    session.action = 'factory_reset' // idempotent — arming twice changes nothing
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'complete') {
    session.unlocked = true
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 400 })
}

/** GET /api/os/lockpair?token=xxx — session status for the phone page + PC polling */
export async function GET(req: Request) {
  sweep(Date.now())

  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!token) return NextResponse.json({ ok: false, error: 'missing_token' }, { status: 400 })

  const found = lookup(token)
  if (found.state === 'notfound') return NextResponse.json({ ok: false, error: 'session_not_found' }, { status: 404 })

  if (found.state === 'expired') {
    // known token that ran out of time — report 'expired' so the phone can tell the user to re-run `lock`
    return NextResponse.json({ ok: true, status: 'expired', action: 'none', unlocked: false, expiresAt: 0, code: '' })
  }

  const s = found.session
  return NextResponse.json({
    ok: true,
    status: 'active',
    action: s.action,
    unlocked: s.unlocked,
    expiresAt: s.expiresAt,
    // The QR only carries the token, so the phone page needs the code here.
    // Safe: the token is already a full capability (it can reveal the password).
    code: s.code,
  })
}

// POST/GET /api/screenpair — Task 43: Wide Screen pairing relay
//
// Fallback signaling channel for the Wide Screen dual connect. The primary
// transport is BroadcastChannel (same tab-space, zero lag); this HTTP relay
// keeps pairing working when that is impossible:
//   • the OS tab runs inside a partitioned iframe (preview panels) while
//     Screen 2 is a real top-level tab — different BroadcastChannel partitions
//   • BroadcastChannel is unavailable in old browsers
//   • Screen 2 is on a DIFFERENT DEVICE entirely (phone as second display)
//
// In-memory ring buffer keyed by the 6-digit code (globalThis survives across
// requests in the single standalone server process). Entries live 120s —
// heartbeats re-post constantly, so nothing needs to persist.
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Slot {
  seq: number
  msgs: { seq: number; body: string; at: number }[]
}

const g = globalThis as typeof globalThis & { __redsecPairBus?: Map<string, Slot> }
const bus: Map<string, Slot> = g.__redsecPairBus ?? (g.__redsecPairBus = new Map())

const TTL_MS = 120_000
const MAX_PER_CODE = 120
const MAX_BODY = 32_000

function pruneSlot(slot: Slot, now: number) {
  if (slot.msgs.length > MAX_PER_CODE || slot.msgs.some((m) => now - m.at > TTL_MS)) {
    slot.msgs = slot.msgs.filter((m) => now - m.at <= TTL_MS).slice(-MAX_PER_CODE)
  }
}

function cleanCode(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '').slice(0, 6)
}

/** POST { code, body } → { ok, seq } */
export async function POST(req: Request) {
  let payload: { code?: string; body?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }
  const code = cleanCode(payload.code)
  const body = typeof payload.body === 'string' ? payload.body.slice(0, MAX_BODY) : ''
  if (code.length !== 6 || !body) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 })

  const slot = bus.get(code) ?? { seq: 0, msgs: [] }
  slot.seq += 1
  slot.msgs.push({ seq: slot.seq, body, at: Date.now() })
  pruneSlot(slot, Date.now())
  bus.set(code, slot)
  return NextResponse.json({ ok: true, seq: slot.seq })
}

/** GET ?code=123456&since=N → { ok, seq, msgs: string[] } — bodies with seq > since */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = cleanCode(url.searchParams.get('code'))
  const since = parseInt(url.searchParams.get('since') || '0', 10) || 0
  if (code.length !== 6) return NextResponse.json({ ok: true, seq: 0, msgs: [] })

  const slot = bus.get(code)
  if (!slot) return NextResponse.json({ ok: true, seq: since, msgs: [] })
  pruneSlot(slot, Date.now())
  return NextResponse.json({
    ok: true,
    seq: slot.seq,
    msgs: slot.msgs.filter((m) => m.seq > since).map((m) => m.body),
  })
}

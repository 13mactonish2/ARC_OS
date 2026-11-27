// REDSEC v6.0 — /api/glonass/verifykey : server-side provider-key verification
// GET ?keyId=maptiler&key=…  →  { result: 'ok' | 'bad', http: number | null }
// Runs the z0 tile probe server-side — tile providers answer 403 with a valid
// PNG error image, so the HTTP status (not image decode) is the real signal.
import { NextResponse } from 'next/server'
import { GLONASS_KEYS, applyKey, probeUrlFor } from '@/lib/os/glonass'

export const dynamic = 'force-dynamic'

const CACHE = new Map<string, { at: number; result: 'ok' | 'bad'; http: number | null }>()
const TTL_MS = 60 * 1000
const CACHE_MAX = 60

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const keyId = (searchParams.get('keyId') || '').trim()
  const key = (searchParams.get('key') || '').trim().slice(0, 300)

  if (!GLONASS_KEYS.some((k) => k.id === keyId) || !key) {
    return NextResponse.json({ error: 'bad keyId or key' }, { status: 400 })
  }

  const ck = `${keyId}:${key}`
  const hit = CACHE.get(ck)
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ result: hit.result, http: hit.http, cached: true })
  }

  const probe = probeUrlFor(keyId)
  if (!probe) return NextResponse.json({ error: 'no probe for keyId' }, { status: 400 })

  let result: 'ok' | 'bad' = 'bad'
  let http: number | null = null
  try {
    const res = await fetch(applyKey(probe, key), {
      cache: 'no-store',
      signal: AbortSignal.timeout(9000),
      headers: { 'User-Agent': 'REDSEC-OS/6.0 GLONASS key check' },
    })
    http = res.status
    if (res.ok) {
      const type = res.headers.get('content-type') || ''
      const buf = await res.arrayBuffer()
      result = buf.byteLength > 64 && (type.startsWith('image/') || type === '') ? 'ok' : 'bad'
    }
  } catch {
    result = 'bad'
    http = null
  }

  if (CACHE.size >= CACHE_MAX) {
    const oldest = CACHE.keys().next().value
    if (oldest) CACHE.delete(oldest)
  }
  CACHE.set(ck, { at: Date.now(), result, http })

  return NextResponse.json({ result, http })
}

// REDSEC v5.0 — /api/geocode : place search via OpenStreetMap Nominatim (server-side, no key)
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Nominatim usage policy: requests must identify the application
const UA = 'REDSEC-OS/5.0 (REDSEC Map app geocoder)'

interface GeoPlace {
  label: string
  lat: number
  lon: number
}

// tiny in-memory cache — polite to the upstream geocoder
const CACHE = new Map<string, { at: number; out: GeoPlace[] }>()
const TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 200

function toPlaces(raw: unknown, fallbackLabel: string): GeoPlace[] {
  const arr = Array.isArray(raw) ? raw : []
  return arr
    .slice(0, 1)
    .map((r) => {
      const item = r as { lat?: string; lon?: string; display_name?: string }
      return {
        label:
          typeof item.display_name === 'string' && item.display_name
            ? item.display_name
            : fallbackLabel,
        lat: Number(item.lat),
        lon: Number(item.lon),
      }
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim()
    if (!q) return NextResponse.json({ results: [] })

    const key = q.toLowerCase()
    const hit = CACHE.get(key)
    if (hit && Date.now() - hit.at < TTL_MS) {
      return NextResponse.json({ results: hit.out })
    }

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`geocoder responded ${res.status}`)
    const raw = await res.json()
    const results = toPlaces(raw, q)

    if (CACHE.size >= CACHE_MAX) {
      const oldest = CACHE.keys().next().value
      if (oldest !== undefined) CACHE.delete(oldest)
    }
    CACHE.set(key, { at: Date.now(), out: results })
    return NextResponse.json({ results })
  } catch (err) {
    console.error('[geocode]', err instanceof Error ? err.message : err)
    return NextResponse.json({ results: [], error: 'geocoder unavailable' }, { status: 502 })
  }
}

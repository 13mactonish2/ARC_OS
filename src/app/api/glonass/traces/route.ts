// REDSEC v6.0 — /api/glonass/traces : PUBLIC GPS traces from the OpenStreetMap trackpoints API
// GET ?bbox=minLon,minLat,maxLon,maxLat → { traces: GTrace[], totalPoints }
// OSM endpoint: /api/0.6/trackpoints?bbox=…&page=0 (GPX XML) — parsed server-side, no key.
import { NextResponse } from 'next/server'
import { colorFor } from '@/lib/os/glonass'

export const dynamic = 'force-dynamic'

const CACHE = new Map<string, { at: number; traces: unknown[]; totalPoints: number }>()
const TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 60
const MAX_TRACES = 120
const MAX_POINTS_PER_TRACE = 400

interface OsmTrk {
  name: string
  pts: [number, number][]
}

/** regex GPX parse — the OSM trackpoints payload is flat <trk>/<trkseg>/<trkpt> XML */
function parseGpx(xml: string): OsmTrk[] {
  const unesc = (s: string) =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const trks: OsmTrk[] = []
  const trkRe = /<trk[\s>]([\s\S]*?)<\/trk>/g
  let m: RegExpExecArray | null
  while ((m = trkRe.exec(xml)) !== null) {
    const body = m[1]
    const nameMatch = /<name>([\s\S]*?)<\/name>/.exec(body)
    const pts: [number, number][] = []
    const ptRe = /<trkpt[^>]*?lat="(-?[\d.]+)"[^>]*?lon="(-?[\d.]+)"/g
    let p: RegExpExecArray | null
    while ((p = ptRe.exec(body)) !== null) {
      const lat = Number(p[1])
      const lon = Number(p[2])
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon])
      if (pts.length >= MAX_POINTS_PER_TRACE) break
    }
    if (pts.length >= 2) {
      const rawName = unesc((nameMatch?.[1] || '').replace(/<[^>]*>/g, ' ').trim())
      trks.push({ name: rawName || `Trace ${trks.length + 1}`, pts })
    }
  }
  return trks
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const bbox = (searchParams.get('bbox') || '').trim()
  if (!/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(bbox)) {
    return NextResponse.json({ traces: [], error: 'bad bbox' }, { status: 400 })
  }

  const key = bbox
  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ traces: hit.traces, totalPoints: hit.totalPoints, cached: true })
  }

  /* the OSM trackpoints API 503s (first-byte timeout) on large windows —
     clamp to a small sample box centered on the view, shrink once more if needed */
  const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number)
  const cLat = (minLat + maxLat) / 2
  const cLon = (minLon + maxLon) / 2
  const clampSpan = (span: number): string => {
    const lonHalf = Math.min(span / 2, 0.009)
    const latHalf = Math.min(span / 2, 0.006)
    const f = (n: number) => n.toFixed(4)
    return `${f(cLon - lonHalf)},${f(cLat - latHalf)},${f(cLon + lonHalf)},${f(cLat + latHalf)}`
  }
  const attempts = [bbox, clampSpan(Math.min(maxLon - minLon, 0.018)), clampSpan(0.01)]

  let lastErr = ''
  for (const ab of attempts) {
    try {
      const url = `https://api.openstreetmap.org/api/0.6/trackpoints?bbox=${encodeURIComponent(ab)}&page=0`
      const res = await fetch(url, {
        headers: { 'User-Agent': 'REDSEC-OS/6.0 GLONASS public-traces', Accept: 'application/gpx+xml, application/xml' },
        cache: 'no-store',
        signal: AbortSignal.timeout(24000),
      })
      if (!res.ok) throw new Error(`trackpoints ${res.status}`)
      const xml = await res.text()
      const trks = parseGpx(xml)

      const traces = trks.slice(0, MAX_TRACES).map((t, i) => ({
        id: `${t.name.slice(0, 24)}#${i}`,
        name: t.name.slice(0, 60),
        points: t.pts,
        color: colorFor(t.name || String(i), i),
      }))
      const totalPoints = traces.reduce((n, t) => n + t.points.length, 0)

      if (CACHE.size >= CACHE_MAX) {
        const oldest = CACHE.keys().next().value
        if (oldest !== undefined) CACHE.delete(oldest)
      }
      CACHE.set(key, { at: Date.now(), traces, totalPoints })
      return NextResponse.json({ traces, totalPoints, area: ab === bbox ? 'view' : 'center sample' })
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
  }
  console.error('[glonass/traces]', lastErr)
  return NextResponse.json({ traces: [], error: 'trace feed unavailable' }, { status: 502 })
}

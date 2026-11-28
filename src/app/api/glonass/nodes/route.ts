// REDSEC v6.0 — /api/glonass/nodes : real OSM map nodes (server proxy, no key)
// GET ?bbox=minLon,minLat,maxLon,maxLat&cat=cafe   → { nodes: GNode[], source }
// Chain: Overpass mirrors → OSM /api/0.6/map (clamped window, parsed here) → Nominatim bounded scan.
import { NextResponse } from 'next/server'
import { catById, type GNode } from '@/lib/os/glonass'

export const dynamic = 'force-dynamic'

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
const NOMINATIM_KEYWORD: Record<string, string> = {
  cafe: 'cafe',
  food: 'restaurant',
  fuel: 'petrol station',
  atm: 'atm',
  bank: 'bank',
  hospital: 'hospital',
  pharmacy: 'pharmacy',
  police: 'police',
  school: 'school',
  hotel: 'hotel',
  parking: 'parking',
  charging: 'charging station',
  market: 'supermarket',
  bus: 'bus stop',
  library: 'library',
  water: 'drinking water',
}

const CACHE = new Map<string, { at: number; nodes: GNode[]; source: string }>()
const TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 80
const LIMIT = 90

/* raw /map cache — one fetch feeds every category filter */
const MAPCACHE = new Map<string, { at: number; nodes: { id: number; lat: number; lon: number; tags: Record<string, string> }[] }>()
const MAP_TTL_MS = 10 * 60 * 1000
const MAP_CACHE_MAX = 24

/* circuit breaker — when Overpass is unreachable (restricted egress), skip it for a while */
let overpassDeadUntil = 0

interface OverpassEl {
  type?: string
  id?: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
}

interface NominatimEl {
  osm_type?: string
  osm_id?: number
  lat?: string
  lon?: string
  name?: string
  display_name?: string
  category?: string
  type?: string
  extratags?: Record<string, string>
}

function cacheSet(key: string, nodes: GNode[], source: string) {
  if (CACHE.size >= CACHE_MAX) {
    const oldest = CACHE.keys().next().value
    if (oldest !== undefined) CACHE.delete(oldest)
  }
  CACHE.set(key, { at: Date.now(), nodes, source })
}

/** parse <node> elements (with tags) from an OSM /map XML payload */
function parseMapXml(xml: string): { id: number; lat: number; lon: number; tags: Record<string, string> }[] {
  const unesc = (s: string) =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const out: { id: number; lat: number; lon: number; tags: Record<string, string> }[] = []
  const nodeRe = /<node\s([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g
  const tagRe = /<tag\s+k="([^"]+)"\s+v="([^"]*)"\s*\/>/g
  let m: RegExpExecArray | null
  while ((m = nodeRe.exec(xml)) !== null) {
    const attrs = m[1]
    const body = m[2] || ''
    const id = /id="(\d+)"/.exec(attrs)?.[1]
    const lat = /lat="(-?[\d.]+)"/.exec(attrs)?.[1]
    const lon = /lon="(-?[\d.]+)"/.exec(attrs)?.[1]
    if (!id || !lat || !lon) continue
    if (body.indexOf('<tag') === -1) continue // untagged nodes are noise for the node explorer
    const tags: Record<string, string> = {}
    let t: RegExpExecArray | null
    while ((t = tagRe.exec(body)) !== null) tags[unesc(t[1])] = unesc(t[2])
    if (Object.keys(tags).length === 0) continue
    out.push({ id: Number(id), lat: Number(lat), lon: Number(lon), tags })
    if (out.length >= 30000) break
  }
  return out
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const bbox = (searchParams.get('bbox') || '').trim()
  const catId = (searchParams.get('cat') || '').trim()

  const cat = catById(catId)
  if (!cat || !/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(bbox)) {
    return NextResponse.json({ nodes: [], error: 'bad bbox or category' }, { status: 400 })
  }

  const key = `${bbox}|${catId}`
  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ nodes: hit.nodes, source: hit.source, cached: true })
  }

  // bbox = minLon,minLat,maxLon,maxLat
  const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number)
  const cLat = (minLat + maxLat) / 2
  const cLon = (minLon + maxLon) / 2

  const toGNodes = (raw: { id: number; lat: number; lon: number; tags: Record<string, string> }[]): GNode[] =>
    raw
      .filter((n) => n.tags[cat.tag[0]] === cat.tag[1])
      .map<GNode>((n) => ({
        id: n.id,
        lat: n.lat,
        lon: n.lon,
        cat: catId,
        name: n.tags.name || n.tags.brand || n.tags.operator || `${cat.label.replace(/s$/, '')} ${n.id}`,
        tags: n.tags,
      }))
      .slice(0, LIMIT)

  /* ---- 1) Overpass mirrors ---- */
  if (Date.now() > overpassDeadUntil) {
    const ql = `[out:json][timeout:14];node["${cat.tag[0]}"="${cat.tag[1]}"](${minLat},${minLon},${maxLat},${maxLon});out ${LIMIT};`
    let overpassErr = ''
    for (const ep of OVERPASS) {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'REDSEC-OS/6.0 GLONASS' },
          body: `data=${encodeURIComponent(ql)}`,
          cache: 'no-store',
          signal: AbortSignal.timeout(9000),
        })
        if (!res.ok) throw new Error(`overpass ${res.status}`)
        const raw = (await res.json()) as { elements?: OverpassEl[] }
        const nodes = (raw.elements || [])
          .filter((e) => e.type === 'node' && Number.isFinite(e.lat) && Number.isFinite(e.lon))
          .map<GNode>((e) => ({
            id: e.id ?? 0,
            lat: e.lat as number,
            lon: e.lon as number,
            cat: catId,
            name: e.tags?.name || `${cat.label.replace(/s$/, '')} ${e.id}`,
            tags: e.tags || {},
          }))
        cacheSet(key, nodes, 'overpass')
        return NextResponse.json({ nodes, source: 'overpass' })
      } catch (err) {
        overpassErr = err instanceof Error ? err.message : String(err)
      }
    }
    // all mirrors failed — trip the breaker for 10 min
    overpassDeadUntil = Date.now() + 10 * 60 * 1000
    console.error('[glonass/nodes] overpass down →', overpassErr)
  }

  /* ---- 2) OSM /map API — clamp to a ≤0.02° window around the view center ---- */
  try {
    const half = 0.01
    const f = (n: number) => n.toFixed(3)
    const mb = `${f(cLon - half)},${f(cLat - half * 0.62)},${f(cLon + half)},${f(cLat + half * 0.62)}`
    let entry = MAPCACHE.get(mb)
    if (!entry || Date.now() - entry.at > MAP_TTL_MS) {
      const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${mb}`
      const res = await fetch(url, {
        headers: { 'User-Agent': 'REDSEC-OS/6.0 GLONASS node explorer', Accept: 'application/xml' },
        cache: 'no-store',
        signal: AbortSignal.timeout(25000),
      })
      if (!res.ok) throw new Error(`map ${res.status}`)
      const xml = await res.text()
      const parsed = parseMapXml(xml)
      if (MAPCACHE.size >= MAP_CACHE_MAX) {
        const oldest = MAPCACHE.keys().next().value
        if (oldest !== undefined) MAPCACHE.delete(oldest)
      }
      MAPCACHE.set(mb, { at: Date.now(), nodes: parsed })
      entry = { at: Date.now(), nodes: parsed }
    }
    const nodes = toGNodes(entry.nodes)
    cacheSet(key, nodes, 'osm-map')
    return NextResponse.json({ nodes, source: 'osm-map' })
  } catch (err) {
    console.error('[glonass/nodes] map fallback failed:', err instanceof Error ? err.message : err)
  }

  /* ---- 3) Nominatim bounded POI search (last resort) ---- */
  try {
    const vb = `${minLon},${maxLat},${maxLon},${minLat}` // left,top,right,bottom
    const kw = NOMINATIM_KEYWORD[catId] || catId
    const url =
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(kw)}` +
      `&viewbox=${encodeURIComponent(vb)}&bounded=1&format=jsonv2&extratags=1&limit=${LIMIT}&accept-language=en`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'REDSEC-OS/6.0 GLONASS node scan', Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) throw new Error(`nominatim ${res.status}`)
    const raw = (await res.json()) as NominatimEl[]
    const nodes = (Array.isArray(raw) ? raw : [])
      .filter((e) => e.osm_type === 'node' && Number.isFinite(Number(e.lat)) && Number.isFinite(Number(e.lon)))
      .map<GNode>((e) => ({
        id: e.osm_id ?? 0,
        lat: Number(e.lat),
        lon: Number(e.lon),
        cat: catId,
        name: e.name || (e.display_name ? e.display_name.split(',')[0] : `${cat.label.replace(/s$/, '')} ${e.osm_id}`),
        tags: { [e.category || cat.tag[0]]: e.type || cat.tag[1], ...(e.extratags || {}) },
      }))
    cacheSet(key, nodes, 'nominatim')
    return NextResponse.json({ nodes, source: 'nominatim' })
  } catch (err) {
    console.error('[glonass/nodes] all sources failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ nodes: [], error: 'node scan unavailable' }, { status: 502 })
  }
}

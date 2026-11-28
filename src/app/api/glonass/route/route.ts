// REDSEC v6.0 — /api/glonass/route : live directions on public routing engines (server proxy).
// GET ?from=lon,lat&to=lon,lat&profile=bus|car|train|bike|foot → { route: GRoute }
// car / bike / foot → OSRM profiles · bus → Valhalla bus costing · train → rail network router.
// Every request is computed fresh (no cache, no stored geometries) — real engines, real
// geometry, real durations; nothing is simulated client-side.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const UA = { 'User-Agent': 'REDSEC-OS/6.0 GLONASS routing' }

interface RouteStepLike {
  distance?: number
  name?: string
  maneuver?: { type?: string; modifier?: string }
}

interface GRouteOut {
  distance: number
  duration: number
  coords: [number, number][]
  steps: { text: string; distance: number }[]
  profile: string
}

/* --------------------------------- OSRM ------------------------------------- */

const OSRM_HOSTS: Record<string, string[]> = {
  car: ['https://routing.openstreetmap.de/routed-car', 'https://router.project-osrm.org'],
  bike: ['https://routing.openstreetmap.de/routed-bike'],
  foot: ['https://routing.openstreetmap.de/routed-foot'],
}

function humanize(s: RouteStepLike): string {
  const t = s.maneuver?.type || ''
  const mod = s.maneuver?.modifier || ''
  const onto = s.name && s.name !== '' ? ` onto ${s.name}` : ''
  const map: Record<string, string> = {
    depart: `Head out${onto}`,
    arrive: 'Arrive at destination',
    turn: `Turn ${mod}${onto}`,
    'new name': `Continue${onto}`,
    merge: `Merge ${mod}${onto}`,
    'on ramp': `Take the ramp${onto}`,
    'off ramp': `Take the exit${onto}`,
    fork: `Keep ${mod} at the fork${onto}`,
    'end of road': `At the end of the road, turn ${mod}${onto}`,
    continue: `Continue ${mod}${onto}`,
    roundabout: `Enter the roundabout${onto}`,
    rotary: `Enter the rotary${onto}`,
  }
  return map[t] || `Continue${onto}`
}

async function osrmRoute(from: string, to: string, profile: string): Promise<GRouteOut> {
  const coords = `${from};${to}`
  let lastErr = ''
  for (const host of OSRM_HOSTS[profile]) {
    try {
      const url = `${host}/route/v1/driving/${encodeURIComponent(coords)}?overview=full&geometries=geojson&steps=true&alternatives=false`
      const res = await fetch(url, { headers: UA, cache: 'no-store', signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`router ${res.status}`)
      const raw = (await res.json()) as {
        code?: string
        routes?: {
          distance?: number
          duration?: number
          geometry?: { coordinates?: [number, number][] }
          legs?: { steps?: RouteStepLike[] }[]
        }[]
      }
      const r = raw.routes?.[0]
      if (raw.code !== 'Ok' || !r || !r.geometry?.coordinates?.length) throw new Error('no route found')
      const coordsLL: [number, number][] = r.geometry.coordinates.map(([lon, lat]) => [lat, lon])
      const steps = (r.legs?.[0]?.steps || []).slice(0, 40).map((s) => ({
        text: humanize(s),
        distance: s.distance ?? 0,
      }))
      return {
        distance: r.distance ?? 0,
        duration: r.duration ?? 0,
        coords: coordsLL,
        steps,
        profile,
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
  }
  throw new Error(lastErr || 'routing unavailable')
}

/* -------------------------------- Valhalla ---------------------------------- */
/* FOSSGIS public Valhalla — the "bus" costing follows roads a bus is allowed on
 * (buses only restrictions honoured), durations from the live engine. */

const VALHALLA_HOSTS = [
  'https://valhalla1.openstreetmap.de/route',
  'https://valhalla2.openstreetmap.de/route',
  'https://valhalla3.openstreetmap.de/route',
]

interface ValhallaManeuver {
  instruction?: string
  length?: number // km
  time?: number // s
}

/** decode a Valhalla encoded polyline (1e6 precision) into [lat, lon] pairs */
function decodeShape(enc: string): [number, number][] {
  const out: [number, number][] = []
  let i = 0
  let lat = 0
  let lon = 0
  while (i < enc.length) {
    let result = 1
    let shift = 0
    let b = 0
    do {
      b = enc.charCodeAt(i++) - 63 - 1
      result += b << shift
      shift += 5
    } while (b >= 0x1f)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    result = 1
    shift = 0
    do {
      b = enc.charCodeAt(i++) - 63 - 1
      result += b << shift
      shift += 5
    } while (b >= 0x1f)
    lon += result & 1 ? ~(result >> 1) : result >> 1
    out.push([lat / 1e6, lon / 1e6])
  }
  return out
}

function cleanStepText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim()
}

async function valhallaRoute(fromLat: number, fromLon: number, toLat: number, toLon: number): Promise<GRouteOut> {
  let lastErr = ''
  for (const host of VALHALLA_HOSTS) {
    try {
      const res = await fetch(host, {
        method: 'POST',
        headers: { ...UA, 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(18000),
        body: JSON.stringify({
          locations: [
            { lat: fromLat, lon: fromLon },
            { lat: toLat, lon: toLon },
          ],
          costing: 'bus',
          directions_options: { units: 'kilometers' },
        }),
      })
      if (!res.ok) throw new Error(`router ${res.status}`)
      const raw = (await res.json()) as {
        trip?: {
          summary?: { length?: number; time?: number }
          legs?: { shape?: string; maneuvers?: ValhallaManeuver[] }[]
        }
      }
      const trip = raw.trip
      if (!trip?.legs?.length) throw new Error('no route found')
      const coords: [number, number][] = []
      for (const leg of trip.legs) if (leg.shape) coords.push(...decodeShape(leg.shape))
      if (coords.length < 2) throw new Error('empty geometry')
      const steps = trip.legs
        .flatMap((l) => l.maneuvers || [])
        .filter((m) => m.instruction && m.instruction.trim())
        .slice(0, 50)
        .map((m) => ({ text: cleanStepText(m.instruction || ''), distance: Math.round((m.length || 0) * 1000) }))
      return {
        distance: (trip.summary?.length ?? 0) * 1000,
        duration: trip.summary?.time ?? 0,
        coords,
        steps,
        profile: 'bus',
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
  }
  throw new Error(lastErr || 'bus routing unavailable')
}

/* ------------------------------- rail network ------------------------------- */
/* Public railway router over OSM rail infrastructure — routes along real
 * tracks (main lines, branches), durations from the live engine. */

interface GHPath {
  distance?: number
  time?: number // ms
  points?: { coordinates?: [number, number][] }
  instructions?: { text?: string; distance?: number }[]
}

async function railRoute(fromLat: number, fromLon: number, toLat: number, toLon: number): Promise<GRouteOut> {
  const q =
    `?point=${fromLat},${fromLon}&point=${toLat},${toLon}` +
    `&profile=all_tracks&points_encoded=false&calc_points=true&instructions=true&locale=en`
  let lastErr = ''
  try {
    const res = await fetch(`https://routing.openrailrouting.org/route${q}`, {
      headers: UA,
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`router ${res.status}`)
    const raw = (await res.json()) as { paths?: GHPath[]; message?: string }
    const p = raw.paths?.[0]
    if (!p || !p.points?.coordinates?.length) {
      const msg = (raw.message || '').slice(0, 140)
      throw new Error(msg.includes('point') ? 'no rail route found — pick points closer to a railway line' : msg || 'no route found')
    }
    const coordsLL: [number, number][] = p.points.coordinates.map(([lon, lat]) => [lat, lon])
    const steps = (p.instructions || [])
      .filter((i) => i.text && i.text.trim())
      .slice(0, 50)
      .map((i) => ({ text: cleanStepText(i.text || ''), distance: i.distance ?? 0 }))
    return {
      distance: p.distance ?? 0,
      duration: (p.time ?? 0) / 1000,
      coords: coordsLL,
      steps,
      profile: 'train',
    }
  } catch (err) {
    lastErr = err instanceof Error ? err.message : String(err)
  }
  throw new Error(lastErr || 'rail routing unavailable')
}

/* --------------------------------- handler ---------------------------------- */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const from = (searchParams.get('from') || '').trim()
  const to = (searchParams.get('to') || '').trim()
  const profile = (searchParams.get('profile') || 'car').trim()
  const okPair = (p: string) => /^-?[\d.]+,-?[\d.]+$/.test(p)
  const KNOWN = ['bus', 'car', 'train', 'bike', 'foot']
  if (!okPair(from) || !okPair(to) || !KNOWN.includes(profile)) {
    return NextResponse.json({ error: 'bad coordinates or profile' }, { status: 400 })
  }

  const [fromLon, fromLat] = from.split(',').map(Number)
  const [toLon, toLat] = to.split(',').map(Number)
  try {
    const route =
      profile === 'bus'
        ? await valhallaRoute(fromLat, fromLon, toLat, toLon)
        : profile === 'train'
          ? await railRoute(fromLat, fromLon, toLat, toLon)
          : await osrmRoute(from, to, profile)
    return NextResponse.json({ route })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[glonass/route]', profile, msg)
    const friendly =
      msg.includes('Cannot find point') || msg.includes('no rail route')
        ? 'No rail route found — pick points closer to a railway line'
        : msg.includes('point') || msg.includes('route found')
          ? 'No route found between those points for this mode'
          : 'Router unreachable — try again'
    return NextResponse.json({ error: friendly }, { status: 502 })
  }
}

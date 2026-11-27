// REDSEC v5.0 — Weather API (server-side proxy, real-time)
// The desktop widget / Weather app used to hit api.open-meteo.com directly from
// the browser; when the public API rate-limits or the network hiccups the widget
// span forever. This route fetches server-side and always answers with usable
// data — falling back to a clearly-labeled seasonal estimate.
//
// Real-time contract (user directive: "real time weather and graph with time and
// real time temperature"):
//  - per-location cache (2 min TTL) so every poll returns the freshest allowed
//    observation; `refresh=1` bypasses the cache for manual refreshes
//  - the payload carries the Open-Meteo observation timestamp (`current.time`)
//    and `is_day` so UIs can show "updated X ago" + day/night states
//  - full hourly series (7 days) for time-axis temperature graphs
//  - `?geocode=<query>` proxies location search through the server as well
import { NextResponse } from 'next/server'

interface WeatherPayload {
  ok: boolean
  simulated?: boolean
  source?: string
  place?: string
  fetchedAt: number // server time of this observation (ms epoch)
  current: {
    temperature_2m: number
    weather_code: number
    relative_humidity_2m?: number
    wind_speed_10m?: number
    apparent_temperature?: number
    is_day?: number
    time?: string // Open-Meteo observation timestamp (ISO)
  }
  daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[] } | null
  hourly?: { time: string[]; temperature_2m: number[] } | null
}

/* per-location cache — the widget and the app poll different places */
const cacheMap = new Map<string, { at: number; data: WeatherPayload }>()
const CACHE_MS = 2 * 60 * 1000
const CACHE_MAX = 24 // bound memory: 24 locations × ~2KB

/* rough monthly mean high (°C) for Kolkata-like climate, used only when no live provider is reachable */
const SEASONAL = [27, 30, 34, 36, 36, 33, 32, 32, 32, 32, 30, 27]

/* wttr.in weatherCode (ww codes) → WMO code used across the OS UI */
function wttrToWmo(c: number): number {
  if (c === 113) return 0 // sunny
  if (c === 116) return 2 // partly cloudy
  if (c === 119) return 3 // cloudy
  if (c === 122) return 3 // overcast
  if (c === 143 || c === 248 || c === 260) return 45 // mist / fog
  if ([176, 263, 266, 293, 353].includes(c)) return 61 // light rain / drizzle
  if ([296, 299].includes(c)) return 63 // rain
  if ([302, 305, 356, 359].includes(c)) return 65 // heavy rain
  if ([179, 323, 326, 227].includes(c)) return 71 // snow
  if (c === 230) return 75 // blizzard
  if ([182, 185, 281, 284, 311, 312, 314, 350, 362, 365, 374, 377].includes(c)) return 66 // sleet
  if (c === 200 || c === 386 || c === 389) return 95 // thunder
  if ([320, 379, 392, 395].includes(c)) return 73 // heavy snow
  if ([360, 368, 371].includes(c)) return 68 // sleet
  return 3
}

/* wttr.in needs no key and rides a different quota than Open-Meteo — used as the
   live fallback when the primary provider is rate-limited (the sandbox IP hits
   Open-Meteo's daily cap) */
async function fetchWttr(lat: string, lon: string, place: string): Promise<WeatherPayload> {
  const r = await fetch(`https://wttr.in/${lat},${lon}?format=j1`, {
    signal: AbortSignal.timeout(7000),
    headers: { 'User-Agent': 'REDSEC-OS/5.0 (weather widget)' },
  })
  if (!r.ok) throw new Error(`wttr ${r.status}`)
  const j = (await r.json()) as {
    current_condition?: Array<{
      temp_C: string
      FeelsLikeC: string
      humidity: string
      weatherCode: string
      windspeedKmph: string
      localObsDateTime?: string
      observation_time?: string
    }>
    weather?: Array<{
      date: string
      mintempC?: string
      maxtempC?: string
      hourly?: Array<{ time: string; tempC: string; weatherCode: string }>
    }>
  }
  const cur = j.current_condition?.[0]
  if (!cur) throw new Error('wttr: no current')
  const temp = Number(cur.temp_C)
  /* observation timestamp in the place's local time ("2026-10-07 15:10" → ISO) */
  let obsIso: string | undefined
  const rawObs = cur.localObsDateTime
  if (rawObs) obsIso = rawObs.replace(' ', 'T')
  const obsHour = obsIso ? Number(obsIso.slice(11, 13)) : new Date().getHours()
  const isDay = obsHour >= 6 && obsHour < 19 ? 1 : 0
  /* 3-hourly series → hourly ISO grid (place-local by construction) */
  const hTimes: string[] = []
  const hTemps: number[] = []
  const dTime: string[] = []
  const dMax: number[] = []
  const dMin: number[] = []
  const dCode: number[] = []
  for (const day of j.weather ?? []) {
    dTime.push(day.date)
    dMax.push(Number(day.maxtempC ?? cur.temp_C))
    dMin.push(Number(day.mintempC ?? cur.temp_C))
    const mid = day.hourly?.find((h) => String(h.time).padStart(4, '0') === '1200') ?? day.hourly?.[4]
    dCode.push(wttrToWmo(Number(mid?.weatherCode ?? cur.weatherCode)))
    for (const h of day.hourly ?? []) {
      const hhmm = String(h.time).padStart(4, '0')
      hTimes.push(`${day.date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}`)
      hTemps.push(Number(h.tempC))
    }
  }
  return {
    ok: true,
    source: 'wttr.in',
    place,
    fetchedAt: Date.now(),
    current: {
      temperature_2m: temp,
      weather_code: wttrToWmo(Number(cur.weatherCode)),
      relative_humidity_2m: Number(cur.humidity),
      wind_speed_10m: Number(cur.windspeedKmph),
      apparent_temperature: Number(cur.FeelsLikeC),
      is_day: isDay,
      time: obsIso,
    },
    daily: dTime.length ? { time: dTime, temperature_2m_max: dMax, temperature_2m_min: dMin, weather_code: dCode } : null,
    hourly: hTimes.length ? { time: hTimes, temperature_2m: hTemps } : null,
  }
}

function simulatedWeather(place: string): WeatherPayload {
  const month = new Date().getMonth()
  const dayCurve = Math.sin(((Date.now() / 86400000) % 1) * Math.PI * 2) // day/night wobble
  const temp = Math.round(SEASONAL[month] + dayCurve * 4 - 2)
  const now = new Date()
  const hourly = {
    time: Array.from({ length: 24 }, (_, i) => {
      const d = new Date(now.getTime() + i * 3_600_000)
      return d.toISOString().slice(0, 13) + ':00'
    }),
    temperature_2m: Array.from({ length: 24 }, (_, i) => {
      const h = (now.getHours() + i) % 24
      return Math.round((SEASONAL[month] + Math.sin(((h - 9) / 24) * Math.PI * 2) * 4 - 2) * 10) / 10
    }),
  }
  return {
    ok: false,
    simulated: true,
    source: 'REDSEC offline model',
    place,
    fetchedAt: Date.now(),
    current: { temperature_2m: temp, weather_code: 1, relative_humidity_2m: 64, wind_speed_10m: 9, apparent_temperature: temp - 1, is_day: now.getHours() > 6 && now.getHours() < 19 ? 1 : 0, time: now.toISOString().slice(0, 16) + '00' },
    daily: null,
    hourly,
  }
}

async function fetchForecast(lat: string, lon: string, place: string, bypassCache: boolean): Promise<WeatherPayload> {
  const key = `${lat},${lon}`
  const hit = cacheMap.get(key)
  if (!bypassCache && hit && Date.now() - hit.at < CACHE_MS) return hit.data
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m,apparent_temperature,is_day` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code&hourly=temperature_2m&timezone=auto&forecast_days=7`,
      { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'REDSEC-OS/5.0' } }
    )
    if (!r.ok) throw new Error(`open-meteo ${r.status}`)
    const j = (await r.json()) as {
      current?: WeatherPayload['current']
      daily?: WeatherPayload['daily']
      hourly?: WeatherPayload['hourly']
    }
    if (!j.current) throw new Error('no current block') // e.g. daily quota error body
    const data: WeatherPayload = { ok: true, source: 'open-meteo.com', place, fetchedAt: Date.now(), current: j.current, daily: j.daily ?? null, hourly: j.hourly ?? null }
    if (cacheMap.size >= CACHE_MAX) {
      const oldest = [...cacheMap.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) cacheMap.delete(oldest[0])
    }
    cacheMap.set(key, { at: Date.now(), data })
    return data
  } catch {
    /* primary provider down / rate-limited → wttr.in live fallback → simulated */
    try {
      const alt = await fetchWttr(lat, lon, place)
      if (cacheMap.size >= CACHE_MAX) {
        const oldest = [...cacheMap.entries()].sort((a, b) => a[1].at - b[1].at)[0]
        if (oldest) cacheMap.delete(oldest[0])
      }
      cacheMap.set(key, { at: Date.now(), data: alt })
      return alt
    } catch {
      // never 5xx — the OS UI treats this as "simulated" data and labels it honestly
      return simulatedWeather(place)
    }
  }
}

/* GET /api/weather?lat=&lon=&place=&refresh=1   → forecast payload
   GET /api/weather?geocode=<query>             → { ok, results: GeoPlace[] } */
export async function GET(req: Request) {
  const url = new URL(req.url)

  /* location search passthrough (server-side, cached 10 min) */
  const geocode = url.searchParams.get('geocode')
  if (geocode) {
    const q = geocode.trim()
    if (!q) return NextResponse.json({ ok: true, results: [] })
    const gKey = `geo:${q.toLowerCase()}`
    const gHit = cacheMap.get(gKey)
    if (gHit && Date.now() - gHit.at < 10 * 60 * 1000) return NextResponse.json(gHit.data)
    try {
      const r = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`,
        { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'REDSEC-OS/5.0' } }
      )
      if (!r.ok) throw new Error(`geocode ${r.status}`)
      const j = (await r.json()) as {
        results?: Array<{ name: string; admin1?: string; country?: string; latitude: number; longitude: number }>
      }
      const payload = {
        ok: true,
        results: (j.results ?? []).map((x) => ({ name: x.name, admin: x.admin1, country: x.country, lat: x.latitude, lon: x.longitude })),
      }
      if (cacheMap.size >= CACHE_MAX) {
        const oldest = [...cacheMap.entries()].sort((a, b) => a[1].at - b[1].at)[0]
        if (oldest) cacheMap.delete(oldest[0])
      }
      cacheMap.set(gKey, { at: Date.now(), data: payload as unknown as WeatherPayload })
      return NextResponse.json(payload)
    } catch {
      return NextResponse.json({ ok: false, results: [], error: 'Location search unavailable' })
    }
  }

  const lat = encodeURIComponent(url.searchParams.get('lat') || '22.5726')
  const lon = encodeURIComponent(url.searchParams.get('lon') || '88.3639')
  const place = url.searchParams.get('place') || 'Kolkata'
  const bypass = url.searchParams.get('refresh') === '1'
  const data = await fetchForecast(lat, lon, place, bypass)
  return NextResponse.json(data)
}

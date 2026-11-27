// REDSEC v6.0 — GLONASS X shared model: basemaps, node categories, geo helpers
// Used by GlonassApp (UI) + GlonassMap (Leaflet renderer) + /api/glonass/* proxies.

export interface View {
  lat: number
  lon: number
  zoom: number
}

/* ---------------------------------- basemaps --------------------------------- */

export interface BaseMapDef {
  id: string
  label: string
  group: 'streets' | 'terrain' | 'imagery' | 'theme'
  /** OSM XYZ template — {s} subdomain, {z} {x} {y} tiles, {r} retina, {key} provider key */
  url: string
  attribution: string
  maxZoom: number
  subdomains?: string
  /** darker UI accents when this basemap is dark */
  dark?: boolean
  /** when set, this layer is locked until the given provider key is saved (Task 70) */
  needsKey?: string
}

export const BASEMAPS: BaseMapDef[] = [
  {
    id: 'standard',
    label: 'Standard',
    group: 'streets',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  {
    id: 'humanitarian',
    label: 'Humanitarian',
    group: 'streets',
    url: 'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors · HOT style',
    maxZoom: 19,
    subdomains: 'abc',
  },
  {
    id: 'cycle',
    label: 'Cycle',
    group: 'streets',
    url: 'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attribution: 'CyclOSM © OpenStreetMap contributors',
    maxZoom: 18,
    subdomains: 'abc',
  },
  {
    id: 'transport',
    label: 'Transport',
    group: 'streets',
    url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors · © CARTO',
    maxZoom: 19,
  },
  {
    id: 'terrain',
    label: 'Terrain',
    group: 'terrain',
    url: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
    subdomains: 'abc',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    group: 'imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    maxZoom: 18,
  },
  {
    id: 'dark',
    label: 'Dark Matter',
    group: 'theme',
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors · © CARTO',
    maxZoom: 19,
    dark: true,
  },
  {
    id: 'night',
    label: 'Midnight Streets',
    group: 'theme',
    url: 'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors · © CARTO',
    maxZoom: 19,
    dark: true,
  },
]

/* ------------------------- PREMIUM layers (need API key) ---------------------- */
/* Task 70 — GLONASS X API-key system: these tile providers hand out free keys.
 * Each URL carries {key} — filled in from the user's saved key at render time. */

export const PREMIUM_BASEMAPS: BaseMapDef[] = [
  {
    id: 'maptiler-streets', label: 'MapTiler Streets+', group: 'streets', needsKey: 'maptiler',
    url: 'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key={key}',
    attribution: '© MapTiler © OpenStreetMap contributors', maxZoom: 20,
  },
  {
    id: 'maptiler-satellite', label: 'MapTiler Satellite+', group: 'imagery', needsKey: 'maptiler',
    url: 'https://api.maptiler.com/maps/satellite-v2/{z}/{x}/{y}.jpg?key={key}',
    attribution: '© MapTiler © OpenStreetMap contributors', maxZoom: 20,
  },
  {
    id: 'maptiler-topo', label: 'MapTiler Topo+', group: 'terrain', needsKey: 'maptiler',
    url: 'https://api.maptiler.com/maps/topo-v2/{z}/{x}/{y}.png?key={key}',
    attribution: '© MapTiler © OpenStreetMap contributors', maxZoom: 20,
  },
  {
    id: 'maptiler-dark', label: 'MapTiler Dataviz+', group: 'theme', needsKey: 'maptiler', dark: true,
    url: 'https://api.maptiler.com/maps/dataviz-dark/{z}/{x}/{y}.png?key={key}',
    attribution: '© MapTiler © OpenStreetMap contributors', maxZoom: 20,
  },
  {
    id: 'mapbox-streets', label: 'Mapbox Streets+', group: 'streets', needsKey: 'mapbox',
    url: 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token={key}',
    attribution: '© Mapbox © OpenStreetMap', maxZoom: 20,
  },
  {
    id: 'mapbox-satellite', label: 'Mapbox Satellite+', group: 'imagery', needsKey: 'mapbox',
    url: 'https://api.mapbox.com/styles/v1/mapbox/satellite-v12/tiles/{z}/{x}/{y}?access_token={key}',
    attribution: '© Mapbox © OpenStreetMap', maxZoom: 20,
  },
  {
    id: 'mapbox-outdoors', label: 'Mapbox Outdoors+', group: 'terrain', needsKey: 'mapbox',
    url: 'https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/{z}/{x}/{y}?access_token={key}',
    attribution: '© Mapbox © OpenStreetMap', maxZoom: 20,
  },
  {
    id: 'mapbox-dark', label: 'Mapbox Night+', group: 'theme', needsKey: 'mapbox', dark: true,
    url: 'https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token={key}',
    attribution: '© Mapbox © OpenStreetMap', maxZoom: 20,
  },
  {
    id: 'tf-neighbourhood', label: 'Thunderforest Neighbourhood', group: 'streets', needsKey: 'thunderforest',
    url: 'https://{s}.tile.thunderforest.com/neighbourhood/{z}/{x}/{y}.png?apikey={key}',
    attribution: 'Maps © Thunderforest, Data © OpenStreetMap contributors', maxZoom: 20, subdomains: 'abc',
  },
  {
    id: 'tf-cycle', label: 'Thunderforest Cycle+', group: 'streets', needsKey: 'thunderforest',
    url: 'https://{s}.tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey={key}',
    attribution: 'Maps © Thunderforest, Data © OpenStreetMap contributors', maxZoom: 20, subdomains: 'abc',
  },
  {
    id: 'tf-outdoors', label: 'Thunderforest Outdoors+', group: 'terrain', needsKey: 'thunderforest',
    url: 'https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey={key}',
    attribution: 'Maps © Thunderforest, Data © OpenStreetMap contributors', maxZoom: 20, subdomains: 'abc',
  },
  {
    id: 'tf-transport-dark', label: 'Thunderforest Transport+', group: 'theme', needsKey: 'thunderforest', dark: true,
    url: 'https://{s}.tile.thunderforest.com/transport-dark/{z}/{x}/{y}.png?apikey={key}',
    attribution: 'Maps © Thunderforest, Data © OpenStreetMap contributors', maxZoom: 20, subdomains: 'abc',
  },
  {
    id: 'stadia-smooth', label: 'Stadia Alidade', group: 'streets', needsKey: 'stadia',
    url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key={key}',
    attribution: '© Stadia Maps © OpenStreetMap contributors', maxZoom: 20,
  },
  {
    id: 'stadia-dark', label: 'Stadia Alidade Dark', group: 'theme', needsKey: 'stadia', dark: true,
    url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png?api_key={key}',
    attribution: '© Stadia Maps © OpenStreetMap contributors', maxZoom: 20,
  },
  {
    id: 'stadia-terrain', label: 'Stamen Terrain+', group: 'terrain', needsKey: 'stadia',
    url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png?api_key={key}',
    attribution: '© Stadia Maps © Stamen Design © OpenStreetMap', maxZoom: 20,
  },
  {
    id: 'geo-bright', label: 'Geoapify Bright', group: 'streets', needsKey: 'geoapify',
    url: 'https://maps.geoapify.com/v1/tiles/osm-bright/{z}/{x}/{y}.png?apiKey={key}',
    attribution: 'Powered by © Geoapify © OpenStreetMap contributors', maxZoom: 20,
  },
  {
    id: 'geo-dark', label: 'Geoapify Dark', group: 'theme', needsKey: 'geoapify', dark: true,
    url: 'https://maps.geoapify.com/v1/tiles/dark-matter/{z}/{x}/{y}.png?apiKey={key}',
    attribution: 'Powered by © Geoapify © OpenStreetMap contributors', maxZoom: 20,
  },
  {
    id: 'geo-positron', label: 'Geoapify Positron', group: 'streets', needsKey: 'geoapify',
    url: 'https://maps.geoapify.com/v1/tiles/positron/{z}/{x}/{y}.png?apiKey={key}',
    attribution: 'Powered by © Geoapify © OpenStreetMap contributors', maxZoom: 20,
  },
]

/** every layer GLONASS X can render — free first, premium after */
export const ALL_LAYERS: BaseMapDef[] = [...BASEMAPS, ...PREMIUM_BASEMAPS]

export function layerById(id: string): BaseMapDef | undefined {
  return ALL_LAYERS.find((l) => l.id === id)
}

/* ----------------------------- GLONASS API keys ------------------------------- */
/* Task 70 — provider key vault. Keys are stored in the OS profile (localStorage),
 * injected into premium layer URLs and verified against a live z0 tile probe. */

export interface KeyDef {
  id: string
  label: string
  /** where the user gets a free key */
  keyUrl: string
  /** input placeholder hint */
  hint: string
  note: string
}

export const GLONASS_KEYS: KeyDef[] = [
  {
    id: 'maptiler', label: 'MapTiler', keyUrl: 'https://cloud.maptiler.com/account/keys',
    hint: 'e.g. aB3xY7…MapTiler key', note: 'Unlocks Streets+, Satellite+, Topo+, Dataviz+ · free tier 100k tiles/mo',
  },
  {
    id: 'mapbox', label: 'Mapbox', keyUrl: 'https://account.mapbox.com/auth/signup/',
    hint: 'pk.eyJ1…public access token', note: 'Unlocks Streets+, Satellite+, Outdoors+, Night+ · free tier 50k loads/mo',
  },
  {
    id: 'thunderforest', label: 'Thunderforest', keyUrl: 'https://www.thunderforest.com/pricing/',
    hint: 'e.g. 8f2a…32-char apikey', note: 'Unlocks Neighbourhood+, Cycle+, Outdoors+, Transport+ · free 150k tiles/mo',
  },
  {
    id: 'stadia', label: 'Stadia Maps', keyUrl: 'https://client.stadiamaps.com/accounts/signup/',
    hint: 'e.g. 4a8c…api_key UUID', note: 'Unlocks Alidade, Alidade Dark, Stamen Terrain+ · free 200k tiles/mo',
  },
  {
    id: 'geoapify', label: 'Geoapify', keyUrl: 'https://myprojects.geoapify.com/',
    hint: 'e.g. 9c1f…apiKey UUID', note: 'Unlocks Bright, Dark, Positron · free 3k requests/day',
  },
]

export function keyDefById(id: string): KeyDef | undefined {
  return GLONASS_KEYS.find((k) => k.id === id)
}

/** inject the saved provider key into a {key} URL template */
export function applyKey(url: string, key: string | undefined): string {
  if (!url.includes('{key}')) return url
  return url.replace('{key}', encodeURIComponent((key || '').trim()))
}

/** build the z0 tile probe URL used to verify a provider key */
export function probeUrlFor(keyId: string): string | null {
  const layer = PREMIUM_BASEMAPS.find((l) => l.needsKey === keyId)
  if (!layer) return null
  return layer.url.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0').replace('{r}', '').replace('{s}', 'a')
}

/** verify a key through the server-side probe (/api/glonass/verifykey) —
 * the OS anti-hack guard blocks raw cross-origin fetches, so the real HTTP
 * status is read on the server where the 403-error-image trick is visible */
export async function verifyGlonassKey(keyId: string, key: string): Promise<'ok' | 'bad'> {
  const val = (key || '').trim()
  if (!val) return 'bad'
  try {
    const res = await fetch(`/api/glonass/verifykey?keyId=${encodeURIComponent(keyId)}&key=${encodeURIComponent(val)}`)
    const data = (await res.json()) as { result?: 'ok' | 'bad' }
    return data.result === 'ok' ? 'ok' : 'bad'
  } catch {
    return 'bad'
  }
}

/* key store — lives in the OS profile (localStorage), saved forever */
export type KeyStatus = 'set' | 'ok' | 'bad'
export interface GlonassKeyEntry {
  key: string
  status: KeyStatus
  at: number
}
export type GlonassKeyStore = Record<string, GlonassKeyEntry>

export const GLONASS_KEYS_LS = 'redsec.glonass.keys.v1'

export function loadGlonassKeys(): GlonassKeyStore {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(GLONASS_KEYS_LS)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as GlonassKeyStore
    const out: GlonassKeyStore = {}
    for (const def of GLONASS_KEYS) {
      const e = parsed[def.id]
      if (e && typeof e.key === 'string' && e.key.trim()) {
        out[def.id] = { key: e.key, status: e.status === 'ok' || e.status === 'bad' ? e.status : 'set', at: Number(e.at) || 0 }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function saveGlonassKeys(store: GlonassKeyStore): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(GLONASS_KEYS_LS, JSON.stringify(store))
  } catch {
    /* storage full / disabled — keys stay in memory for this session */
  }
}

/* ------------------------------- node categories ------------------------------ */

export interface NodeCategory {
  id: string
  label: string
  /** Overpass tag filter [key, value] — must be safe ASCII, no quotes */
  tag: [string, string]
  emoji: string
  color: string
}

export const NODE_CATEGORIES: NodeCategory[] = [
  { id: 'cafe', label: 'Cafés', tag: ['amenity', 'cafe'], emoji: '☕', color: '#f59e0b' },
  { id: 'food', label: 'Food', tag: ['amenity', 'restaurant'], emoji: '🍽️', color: '#fb7185' },
  { id: 'fuel', label: 'Fuel', tag: ['amenity', 'fuel'], emoji: '⛽', color: '#a3e635' },
  { id: 'atm', label: 'ATMs', tag: ['amenity', 'atm'], emoji: '🏧', color: '#34d399' },
  { id: 'bank', label: 'Banks', tag: ['amenity', 'bank'], emoji: '🏦', color: '#2dd4bf' },
  { id: 'hospital', label: 'Hospitals', tag: ['amenity', 'hospital'], emoji: '🏥', color: '#f87171' },
  { id: 'pharmacy', label: 'Pharmacy', tag: ['amenity', 'pharmacy'], emoji: '💊', color: '#f472b6' },
  { id: 'police', label: 'Police', tag: ['amenity', 'police'], emoji: '🚓', color: '#60a5fa' },
  { id: 'school', label: 'Schools', tag: ['amenity', 'school'], emoji: '🏫', color: '#c084fc' },
  { id: 'hotel', label: 'Hotels', tag: ['tourism', 'hotel'], emoji: '🏨', color: '#e879f9' },
  { id: 'parking', label: 'Parking', tag: ['amenity', 'parking'], emoji: '🅿️', color: '#38bdf8' },
  { id: 'charging', label: 'Charging', tag: ['amenity', 'charging_station'], emoji: '🔌', color: '#22d3ee' },
  { id: 'market', label: 'Markets', tag: ['shop', 'supermarket'], emoji: '🛒', color: '#fbbf24' },
  { id: 'bus', label: 'Bus stops', tag: ['highway', 'bus_stop'], emoji: '🚏', color: '#94a3b8' },
  { id: 'library', label: 'Libraries', tag: ['amenity', 'library'], emoji: '📚', color: '#a78bfa' },
  { id: 'water', label: 'Drinking water', tag: ['amenity', 'drinking_water'], emoji: '🚰', color: '#67e8f9' },
]

export function catById(id: string): NodeCategory | undefined {
  return NODE_CATEGORIES.find((c) => c.id === id)
}

/* ------------------------------- GLONASS types -------------------------------- */

/** one scanned OSM node (Overpass) */
export interface GNode {
  id: number
  lat: number
  lon: number
  cat: string
  name: string
  tags: Record<string, string>
}

/** one public GPS trace (parsed from OSM trackpoints GPX) */
export interface GTrace {
  id: string
  name: string
  points: [number, number][] // [lat, lon]
  color: string
}

export interface RouteStep {
  text: string
  distance: number
}

export interface GRoute {
  distance: number // meters
  duration: number // seconds
  coords: [number, number][] // [lat, lon]
  steps: RouteStep[]
  profile: string
}

/* --------------------------------- helpers ------------------------------------ */

/** great-circle distance in meters */
export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function fmtDist(m: number): string {
  if (!Number.isFinite(m)) return '—'
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`
}

export function fmtDur(s: number): string {
  if (!Number.isFinite(s)) return '—'
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${min % 60} min`
}

/** bbox string in every order the 3 APIs need, from a view + meters span */
export function viewBbox(v: View): { lonSpan: number; latSpan: number } {
  const lonSpanAtZ = 360 / Math.pow(2, v.zoom)
  return { lonSpan: lonSpanAtZ, latSpan: lonSpanAtZ * 0.62 }
}

export const TRACE_COLORS = ['#38bdf8', '#f59e0b', '#34d399', '#f472b6', '#a78bfa', '#fb7185', '#22d3ee', '#a3e635', '#fb923c', '#e879f9']

export function colorFor(id: string, i = 0): string {
  let h = i
  for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0
  return TRACE_COLORS[h % TRACE_COLORS.length]
}

// REDSEC v6.0 — GLONASS X map engine (Leaflet): basemaps, OSM node markers, public GPS
// trace polylines, route line, A/B pins, measure overlay, drop pin, context clicks.
// Loaded only client-side (registry imports GlonassApp with ssr:false → leaflet is safe here).
'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BASEMAPS, catById } from '@/lib/os/glonass'
import type { GNode, GRoute, GTrace, View } from '@/lib/os/glonass'

export interface GlonassMapApi {
  zoomIn: () => void
  zoomOut: () => void
  fitTraces: () => void
  /** fit one public GPS trace by id (Task 70) */
  fitTrace: (id: string) => void
}

export interface MapClickInfo {
  lat: number
  lon: number
  x: number
  y: number
}

interface Props {
  initial: View
  fly: { lat: number; lon: number; zoom?: number; k: number } | null
  basemapId: string
  /** Task 70 — resolved tile URL (keys already injected); overrides the basemapId lookup */
  tileUrl?: string
  tileAttribution?: string
  tileMaxZoom?: number
  tileSubdomains?: string
  /** Task 70 — fired (debounced) with the accumulated tile-error count of the active layer */
  onTileStatus?: (errors: number) => void
  nodes: GNode[]
  traces: GTrace[]
  route: GRoute | null
  measurePoints: [number, number][]
  dropPin: { lat: number; lon: number } | null
  routeEnds: { from?: [number, number]; to?: [number, number] }
  pickMode: string | null
  onMapClick: (info: MapClickInfo) => void
  onContext: (info: MapClickInfo) => void
  onNode: (n: GNode | null) => void
  onTrace: (t: GTrace) => void
  onView: (v: View) => void
  /** called once the map is ready (and with null on unmount) */
  onApi: (api: GlonassMapApi | null) => void
}

/* ----------------------------- marker HTML builders ---------------------------- */

function nodeIcon(cat: string, selected: boolean): L.DivIcon {
  const c = catById(cat)
  const color = c?.color || '#38bdf8'
  const emoji = c?.emoji || '📍'
  const size = selected ? 32 : 24
  return L.divIcon({
    className: '',
    html:
      `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;` +
      `border-radius:9999px;background:#10141f;border:2px solid ${color};box-shadow:0 0 ${selected ? 14 : 6}px ${color}66, 0 2px 6px rgba(0,0,0,.5);` +
      `font-size:${selected ? 16 : 12}px;line-height:1;transform:translateZ(0);${selected ? 'outline:2px solid #ffffffaa;outline-offset:2px;' : ''}">` +
      emoji +
      `</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function pinIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    html:
      `<div style="width:26px;height:26px;background:linear-gradient(135deg,#38bdf8,#0ea5e9);transform:rotate(-45deg);` +
      `border-radius:50% 50% 50% 0;box-shadow:0 3px 10px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;">` +
      `<div style="width:8px;height:8px;background:#fff;border-radius:9999px;transform:rotate(45deg);"></div></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  })
}

function endIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html:
      `<div style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:9999px;` +
      `background:${color};color:#0b0f19;font:700 12px/1 ui-sans-serif,system-ui;border:2px solid #ffffffcc;box-shadow:0 2px 8px rgba(0,0,0,.5);">${label}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

const dotIcon = (color: string) =>
  L.divIcon({
    className: '',
    html:
      `<div style="width:10px;height:10px;border-radius:9999px;background:${color};border:2px solid #fff;` +
      `box-shadow:0 1px 4px rgba(0,0,0,.5);"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  })

/* --------------------------------- component ---------------------------------- */

export default function GlonassMap(props: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const nodeLayer = useRef<L.LayerGroup | null>(null)
  const traceLayer = useRef<L.LayerGroup | null>(null)
  const tracePolys = useRef<Map<string, L.Polyline>>(new Map())
  const routeLayer = useRef<L.LayerGroup | null>(null)
  const measureLayer = useRef<L.LayerGroup | null>(null)
  const endLayer = useRef<L.LayerGroup | null>(null)
  const pinMarker = useRef<L.Marker | null>(null)
  const cbRef = useRef(props)
  useEffect(() => {
    cbRef.current = props
  })

  /* mount / unmount */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const map = L.map(host, {
      center: [props.initial.lat, props.initial.lon],
      zoom: props.initial.zoom,
      minZoom: 3,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: true,
      preferCanvas: true,
    })
    mapRef.current = map

    nodeLayer.current = L.layerGroup().addTo(map)
    traceLayer.current = L.layerGroup().addTo(map)
    routeLayer.current = L.layerGroup().addTo(map)
    measureLayer.current = L.layerGroup().addTo(map)
    endLayer.current = L.layerGroup().addTo(map)

    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map)

    map.on('moveend zoomend', () => {
      const c = map.getCenter()
      cbRef.current.onView({ lat: c.lat, lon: c.lng, zoom: map.getZoom() })
    })
    map.on('click', (e: L.LeafletMouseEvent) => {
      cbRef.current.onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng, x: e.containerPoint.x, y: e.containerPoint.y })
    })
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      cbRef.current.onContext({ lat: e.latlng.lat, lon: e.latlng.lng, x: e.containerPoint.x, y: e.containerPoint.y })
    })

    cbRef.current.onApi({
      zoomIn: () => mapRef.current?.zoomIn(),
      zoomOut: () => mapRef.current?.zoomOut(),
      fitTraces: () => {
        const g = traceLayer.current
        if (!g) return
        const b = L.latLngBounds([])
        g.eachLayer((l) => {
          const pl = l as L.Polyline
          if (pl.getBounds) b.extend(pl.getBounds())
        })
        if (b.isValid()) mapRef.current?.fitBounds(b, { padding: [40, 40], maxZoom: 15 })
      },
      fitTrace: (id) => {
        const pl = tracePolys.current.get(id)
        if (pl && mapRef.current) {
          const b = pl.getBounds()
          if (b.isValid()) mapRef.current.fitBounds(b, { padding: [48, 48], maxZoom: 16 })
        }
      },
    })

    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(host)

    return () => {
      ro.disconnect()
      cbRef.current.onApi(null)
      map.remove()
      mapRef.current = null
    }
  }, [])

  /* basemap swap — uses the app-resolved tileUrl (keys injected) when present;
     counts tile errors so the app can flag missing/blocked keys (Task 70) */
  const tileUrl = props.tileUrl
  const tileAttribution = props.tileAttribution
  const tileMaxZoom = props.tileMaxZoom
  const tileSubdomains = props.tileSubdomains
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const def = BASEMAPS.find((b) => b.id === props.basemapId) || BASEMAPS[0]
    if (tileRef.current) {
      map.removeLayer(tileRef.current)
      tileRef.current = null
    }
    const url = tileUrl || def.url
    const tl = L.tileLayer(url, {
      maxZoom: tileMaxZoom ?? def.maxZoom,
      subdomains: tileSubdomains || def.subdomains || 'abc',
      crossOrigin: true,
    })
    let errors = 0
    let t: ReturnType<typeof setTimeout> | null = null
    tl.on('tileerror', () => {
      errors += 1
      if (t) clearTimeout(t)
      t = setTimeout(() => cbRef.current.onTileStatus?.(errors), 600)
    })
    tl.addTo(map)
    tileRef.current = tl
    map.setMaxZoom(tileMaxZoom ?? def.maxZoom)
    cbRef.current.onTileStatus?.(0)
  }, [props.basemapId, tileUrl, tileMaxZoom, tileSubdomains, tileAttribution])

  /* node markers */
  useEffect(() => {
    const g = nodeLayer.current
    if (!g) return
    g.clearLayers()
    for (const n of props.nodes) {
      const m = L.marker([n.lat, n.lon], { icon: nodeIcon(n.cat, false), riseOnHover: true })
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e as unknown as Event)
        cbRef.current.onNode(n)
      })
      m.addTo(g)
    }
  }, [props.nodes])

  /* trace polylines */
  useEffect(() => {
    const g = traceLayer.current
    if (!g) return
    g.clearLayers()
    tracePolys.current.clear()
    for (const t of props.traces) {
      const pl = L.polyline(t.points, { color: t.color, weight: 2.5, opacity: 0.85 })
      pl.on('click', (e) => {
        L.DomEvent.stopPropagation(e as unknown as Event)
        cbRef.current.onTrace(t)
      })
      pl.addTo(g)
      tracePolys.current.set(t.id, pl)
    }
  }, [props.traces])

  /* route line (casing + core) + fit */
  useEffect(() => {
    const g = routeLayer.current
    const map = mapRef.current
    if (!g || !map) return
    g.clearLayers()
    const r = props.route
    if (r && r.coords.length >= 2) {
      L.polyline(r.coords, { color: '#0c4a6e', weight: 8, opacity: 0.5 }).addTo(g)
      L.polyline(r.coords, { color: '#38bdf8', weight: 4, opacity: 0.95 }).addTo(g)
      map.fitBounds(L.latLngBounds(r.coords), { padding: [46, 46], maxZoom: 16 })
    }
  }, [props.route])

  /* measure vertices + dashed line */
  useEffect(() => {
    const g = measureLayer.current
    if (!g) return
    g.clearLayers()
    const pts = props.measurePoints
    if (pts.length >= 2) L.polyline(pts, { color: '#fbbf24', weight: 3, dashArray: '6 6', opacity: 0.95 }).addTo(g)
    for (const p of pts) L.marker(p, { icon: dotIcon('#fbbf24'), interactive: false }).addTo(g)
  }, [props.measurePoints])

  /* A/B route ends */
  useEffect(() => {
    const g = endLayer.current
    if (!g) return
    g.clearLayers()
    const { from, to } = props.routeEnds
    if (from) L.marker(from, { icon: endIcon('A', '#34d399') }).addTo(g)
    if (to) L.marker(to, { icon: endIcon('B', '#fb7185') }).addTo(g)
  }, [props.routeEnds])

  /* search / locate drop pin */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (pinMarker.current) {
      map.removeLayer(pinMarker.current)
      pinMarker.current = null
    }
    const p = props.dropPin
    if (p) pinMarker.current = L.marker([p.lat, p.lon], { icon: pinIcon(), zIndexOffset: 900 }).addTo(map)
  }, [props.dropPin])

  /* external fly requests */
  useEffect(() => {
    const map = mapRef.current
    const f = props.fly
    if (!map || !f) return
    map.flyTo([f.lat, f.lon], f.zoom ?? map.getZoom(), { duration: 0.9 })
  }, [props.fly?.k])

  /* cursor for pick modes */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.style.cursor = props.pickMode ? 'crosshair' : ''
  }, [props.pickMode])

  return (
    <>
      <style>{`
        .leaflet-container { background:#0b0f19; font-family: inherit; }
        .leaflet-control-scale-line { background: rgba(10,14,25,.78) !important; color:#cbd5e1 !important; border-color:#475569 !important; }
      `}</style>
      <div ref={hostRef} className="h-full w-full" aria-label="GLONASS X interactive map" />
    </>
  )
}

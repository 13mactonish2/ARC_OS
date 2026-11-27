// REDSEC v5.0 — /api/news : Google News RSS → JSON (server-side, no key)
import { NextResponse } from 'next/server'
import { XMLParser } from 'fast-xml-parser'

export const dynamic = 'force-dynamic'

const CAT_QUERIES: Record<string, string> = {
  latest: 'top news',
  world: 'world',
  nation: 'India',
  tech: 'technology',
  sports: 'sports',
  business: 'business',
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function asText(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o['#text'] === 'string') return o['#text']
  }
  return ''
}

interface NewsOut {
  title: string
  link: string
  pubDate: string
  source: string
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const cat = (searchParams.get('cat') || 'latest').trim()
    let query: string
    if (cat.startsWith('search:')) {
      query = cat.slice('search:'.length).trim() || 'top news'
    } else {
      query = CAT_QUERIES[cat] || CAT_QUERIES.latest
    }
    const feed = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`
    const res = await fetch(feed, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`news feed responded ${res.status}`)
    const xml = await res.text()

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      trimValues: true,
      processEntities: true,
    })
    const doc = parser.parse(xml) as { rss?: { channel?: { item?: unknown } } }
    const raw = doc?.rss?.channel?.item
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : []

    const items: NewsOut[] = []
    for (const it of arr.slice(0, 30)) {
      const o = (it || {}) as Record<string, unknown>
      const fullTitle = asText(o.title)
      // Google News titles end with " - Source" — split them apart
      const cut = fullTitle.lastIndexOf(' - ')
      const title = cut > 8 ? fullTitle.slice(0, cut) : fullTitle
      const fallbackSource = cut > 8 ? fullTitle.slice(cut + 3) : ''
      const srcRaw = asText(o.source)
      const link = asText(o.link)
      if (!title || !link) continue
      items.push({
        title,
        link,
        pubDate: asText(o.pubDate),
        source: srcRaw || fallbackSource || 'Google News',
      })
    }
    return NextResponse.json({ items })
  } catch (e) {
    return NextResponse.json({
      items: [],
      error: e instanceof Error ? e.message : 'news fetch failed',
    })
  }
}

// GET /api/webgames — Gaming Hub's live AAA web-game catalog (Task 81).
// Pulls the GameMonetize distribution feed (a legal HTML5 game CDN that
// explicitly supports iframe embedding), caches it in memory, and answers
// JSON-only. UNLIMITED catalog: the whole feed is indexed (up to 2000 games)
// and every entry is returned in paged form — ?q= searches ALL of them,
// ?limit= up to 300 rows per answer. Games play INSIDE the OS via the hub's
// guarded frame.
import { NextResponse } from 'next/server'
import { clientKey, rateLimit, tooMany } from '@/lib/server/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FEED = 'https://gamemonetize.com/rss.xml' // the .com host serves the real ArrayOfRSSViewModel feed
const TTL = 30 * 60 * 1000

interface WebGame {
  id: string
  title: string
  thumb: string
  url: string
  width: number
  height: number
  category: string
  description: string
}

interface CacheEntry { at: number; games: WebGame[]; error?: string }
const cache: CacheEntry = { at: 0, games: [] }
let pending: Promise<CacheEntry> | null = null

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  return m ? decode(m[1]) : ''
}

async function loadFeed(): Promise<CacheEntry> {
  try {
    const res = await fetch(FEED, {
      headers: { 'User-Agent': 'Mozilla/5.0 (REDSEC OS GamingHub/6.0)', Accept: 'application/xml, text/xml, application/rss+xml' },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) throw new Error(`feed responded ${res.status}`)
    const xml = await res.text()
    /* ArrayOfRSSViewModel shape: <RSSViewModel><title/><description/><instructions/>
       <url>https://html5.gamemonetize.co/<hash>/</url><width/><height/>
       <categorylist><Category><Name>…</Name></Category></categorylist> */
    const items = xml.split('<RSSViewModel>').slice(1)
    const games: WebGame[] = []
    for (const raw of items) {
      const block = raw.slice(0, raw.indexOf('</RSSViewModel>') + 15)
      const title = tag(block, 'title')
      const link = tag(block, 'url')
      const width = Number(tag(block, 'width')) || 800
      const height = Number(tag(block, 'height')) || 600
      const description = tag(block, 'description').slice(0, 220)
      const cat = /<Category>\s*<Name>((?:[^<]|<(?!\/Name>))*)<\/Name>/.exec(block)
      const category = cat ? decode(cat[1]) : 'Game'
      if (!title || !link) continue
      const m = /^https:\/\/html5\.gamemonetize\.\w+\/([a-z0-9]+)\//i.exec(link)
      if (!m) continue
      const id = m[1]
      // thumbs follow the CDN pattern https://img.gamemonetize.com/<hash>/512x384.jpg
      games.push({ id, title, thumb: `https://img.gamemonetize.com/${id}/512x384.jpg`, url: link, width, height, category, description })
      if (games.length >= 2000) break
    }
    return { at: Date.now(), games }
  } catch (e) {
    return { at: Date.now(), games: cache.games, error: e instanceof Error ? e.message : 'feed fetch failed' }
  }
}

export async function GET(req: Request) {
  const gate = rateLimit(clientKey(req, 'webgames'), 60, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  if (Date.now() - cache.at > TTL) {
    if (!pending) {
      pending = loadFeed().then((r) => {
        Object.assign(cache, r)
        pending = null
        return r
      })
    }
    const r = await pending
    if (!r.games.length) {
      return NextResponse.json({ ok: false, error: 'The web-game catalog feed is unreachable right now — the built-in list still works.', games: [] }, { status: 502 })
    }
  }

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim().toLowerCase()
  const cat = (url.searchParams.get('category') || '').trim().toLowerCase()
  const limit = Math.min(300, Math.max(1, Number(url.searchParams.get('limit')) || 120))
  const page = Math.min(20, Math.max(1, Number(url.searchParams.get('page')) || 1))
  let games = cache.games
  const totalAll = games.length
  if (q) games = games.filter((g) => g.title.toLowerCase().includes(q) || g.category.toLowerCase().includes(q))
  if (cat) games = games.filter((g) => g.category.toLowerCase() === cat)
  const cats = [...new Set(cache.games.map((g) => g.category))].sort()
  const total = games.length
  const start = (page - 1) * limit

  return NextResponse.json({
    ok: true,
    total,
    totalAll,
    page,
    hasMore: start + limit < total,
    categories: cats,
    games: games.slice(start, start + limit),
  })
}

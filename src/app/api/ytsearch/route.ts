// REDSEC v5.1 — /api/ytsearch : YouTube search (regex scrape of ytInitialData renderers)
// returns id, title, channel, verified, duration, views, published, live
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function decodeJsString(s: string): string {
  return s
    .replace(/\\u([\dA-Fa-f]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\n/g, ' ')
    .replace(/\\\\/g, '\\')
}

interface YtItem {
  id: string
  title: string
  channel?: string
  verified?: boolean
  duration?: string
  views?: string
  published?: string
  live?: boolean
  shorts?: boolean
}

const JS_STR = '((?:[^"\\\\]|\\\\.)*)'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  // ?id=VIDEO_ID → resolve metadata via oEmbed (title + channel)
  const vid = (searchParams.get('id') || '').trim()
  if (vid && /^[\w-]{11}$/.test(vid)) {
    let title = 'YouTube Video'
    let channel: string | undefined
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${vid}`)}&format=json`,
        { headers: { 'User-Agent': UA }, cache: 'no-store' }
      )
      if (res.ok) {
        const j = (await res.json()) as { title?: string; author_name?: string }
        if (j?.title) title = j.title
        if (j?.author_name) channel = j.author_name
      }
    } catch {
      /* keep fallbacks */
    }
    return NextResponse.json({ items: [{ id: vid, title, channel } satisfies YtItem] })
  }

  // ?q=QUERY → scrape the results page videoRenderer objects
  // ?shorts=1&q=QUERY → scrape the SHORTS shelf (reelShelfRenderer / shortsLockupViewModel)
  const wantShorts = searchParams.get('shorts') === '1'
  const q = (searchParams.get('q') || '').trim()
  if (!q) return NextResponse.json({ items: [] })

  try {
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en&gl=IN`, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`youtube responded ${res.status}`)
    const html = await res.text()

    if (wantShorts) {
      /* ---------- SHORTS: shortsLockupViewModel (2024+) + legacy reelShelfRenderer ----------
         The modern shell carries: entityId, accessibilityText ("TITLE"),
         onTap.innertubeCommand.reelWatchEndpoint.videoId, overlayMetadata
         ("#tag · 1.2M views") — all scraped with bounded regexes. */
      const seen = new Set<string>()
      const shorts: YtItem[] = []
      const lockupRe = /"shortsLockupViewModel":\{"entityId":"[^"]*","accessibilityText":"((?:[^"\\]|\\.)*)"[\s\S]{0,2400}?"reelWatchEndpoint":\{"videoId":"([\w-]{11})"/g
      for (let m = lockupRe.exec(html); m && shorts.length < 24; m = lockupRe.exec(html)) {
        const id = m[2]
        if (seen.has(id)) continue
        seen.add(id)
        shorts.push({ id, title: decodeJsString(m[1]).trim() || 'Shorts', shorts: true })
      }
      if (shorts.length < 6) {
        const reelRe = /"reelItemRenderer":\{"videoId":"([\w-]{11})"[\s\S]{0,2400}?"headline":\{"simpleText":"((?:[^"\\]|\\.)*)"/g
        for (let m = reelRe.exec(html); m && shorts.length < 24; m = reelRe.exec(html)) {
          const id = m[1]
          if (seen.has(id)) continue
          seen.add(id)
          shorts.push({ id, title: decodeJsString(m[2]).trim() || 'Shorts', shorts: true })
        }
      }
      return NextResponse.json({ items: shorts })
    }

    // split on each videoRenderer and parse fields within its chunk
    const parts = html.split('"videoRenderer":{"videoId":"')
    const seen = new Set<string>()
    const items: YtItem[] = []

    for (let i = 1; i < parts.length && items.length < 24; i++) {
      const chunk = parts[i].slice(0, 6000)
      const idm = chunk.match(/^([\w-]{11})/)
      if (!idm) continue
      const id = idm[1]
      if (seen.has(id)) continue
      seen.add(id)

      const titleM = chunk.match(new RegExp(`"title":\\{"runs":\\[\\{"text":"${JS_STR}`))
      const channelM = chunk.match(new RegExp(`"ownerText":\\{"runs":\\[\\{"text":"${JS_STR}`))
      const lengthM = chunk.match(/"lengthText":\{[\s\S]*?"simpleText":"([\d:]+)"/)
      const viewsM = chunk.match(/"(?:shortViewCountText|viewCountText)":\{"simpleText":"([^"]+)"/)
      const pubM = chunk.match(new RegExp(`"publishedTimeText":\\{"simpleText":"${JS_STR}`))
      const live = /"BADGE_STYLE_TYPE_LIVE_NOW"|"label":"LIVE"/.test(chunk)

      const item: YtItem = {
        id,
        title: titleM ? decodeJsString(titleM[1]).trim() || 'Untitled video' : 'Untitled video',
      }
      if (/shorts/i.test(item.title)) item.shorts = true
      if (channelM) item.channel = decodeJsString(channelM[1]).trim()
      if (/BADGE_STYLE_TYPE_VERIFIED|"ownerVerifiedBadge"/.test(chunk)) item.verified = true
      if (lengthM) item.duration = lengthM[1]
      if (viewsM) item.views = decodeJsString(viewsM[1]).trim()
      if (pubM) item.published = decodeJsString(pubM[1]).trim()
      if (live) {
        item.live = true
        item.duration = 'LIVE'
      }
      items.push(item)
    }
    return NextResponse.json({ items })
  } catch (e) {
    return NextResponse.json({
      items: [],
      error: e instanceof Error ? e.message : 'youtube search failed',
    })
  }
}

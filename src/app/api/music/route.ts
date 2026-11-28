// REDSEC 6.0 — Task 68: Audio Fly × YouTube Music (real-time engine).
// Server-side proxy to music.youtube.com youtubei/v1 (WEB_REMIX client) —
// live search with songs / videos / artists / albums, the Quick-picks home
// feed, artist pages, and OFFICIAL artist verification resolved against
// youtube.com channels ("Official Artist Channel" verified badge).
//
// UNLIMITED: every listing mode returns a `continuation` token — pass it back
// as &ct= to stream the next page, forever, straight from youtubei (exactly
// what the real app does). Views/plays ride along on every track (`extra`).
//
// GET /api/music?mode=home [&ct=...]              → Quick picks (real-time, unlimited pages)
// GET /api/music?mode=search&q=... [&ct=...]      → songs/videos/artists/albums (unlimited pages)
// GET /api/music?mode=artist&id=UC... [&ct=...]   → artist page (songs+albums, unlimited pages)
// GET /api/music?mode=verify&ids=Name1,Name2...   → verified map (subs+badge)
//
// The browser never talks to YouTube directly (context headers + parsing live
// here) and every payload is cached in memory so repeat taps feel instant.
import { NextResponse } from 'next/server'
import type { YtmAlbum, YtmArtist, YtmArtistPage, YtmHomeResult, YtmSearchResult, YtmTrack, YtmVerifyMap, YtmVerified } from '@/lib/os/ytm'

export const dynamic = 'force-dynamic'

/* ---------------- tiny safe JSON navigation ---------------- */
type J = Record<string, unknown>
const asJ = (v: unknown): J | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as J) : null)
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function digs(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, seg) => {
    const m = /^([\w$]+)(?:\[(\d+)\])?$/.exec(seg)
    if (!m) return undefined
    const o = asJ(acc)
    if (!o) return undefined
    const next = o[m[1]]
    return m[2] ? asArr(next)[Number(m[2])] : next
  }, obj)
}

const runs = (v: unknown): J[] => asArr(digs(v, 'runs')).map((r) => asJ(r) ?? ({} as J))
/** flexColumns[i] → musicResponsiveListItemFlexColumnRenderer.text (safely) */
const colText = (col: unknown): unknown => asJ(asJ(col)?.musicResponsiveListItemFlexColumnRenderer)?.text
const runsText = (v: unknown): string => runs(v).map((r) => String(r.text ?? '')).join('')
/** metadata runs are split by " • " nodes — squash them into clean segments */
const segments = (v: unknown): string[] =>
  runs(v).map((r) => String(r.text ?? '')).map((t) => t.trim()).filter((t) => t.length > 0 && t !== '•')

const thumbOf = (item: J): string => {
  const thumbs = asArr(digs(item, 'thumbnail.musicThumbnailRenderer.thumbnail.thumbnails')) as J[]
  if (!thumbs.length) return ''
  const usable = thumbs.filter((t) => Number(t.width) <= 544)
  const pick = usable.length ? usable[usable.length - 1] : thumbs[thumbs.length - 1]
  return String(pick.url ?? '')
}

const videoIdOf = (item: J): string => {
  const direct = digs(item, 'playlistItemData.videoId')
  if (typeof direct === 'string' && direct) return direct
  const viaPlay = digs(item, 'overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint.videoId')
  if (typeof viaPlay === 'string' && viaPlay) return viaPlay
  const cols = asArr(item.flexColumns)
  for (const col of cols) {
    const runsArr = runs(colText(col))
    for (const r of runsArr) {
      const v = digs(r, 'navigationEndpoint.watchEndpoint.videoId')
      if (typeof v === 'string' && v) return v
    }
  }
  return ''
}

const browseIdOf = (item: J): string => {
  const cands: unknown[] = [
    digs(item, 'navigationEndpoint.browseEndpoint.browseId'),
    ...asArr(item.flexColumns).flatMap((col) => runs(colText(col)).map((r) => digs(r, 'navigationEndpoint.browseEndpoint.browseId'))),
  ]
  for (const c of cands) if (typeof c === 'string' && c) return c
  return ''
}

const artistRefOf = (item: J): { artist: string; artistId: string } => {
  const cols = asArr(item.flexColumns)
  for (let i = 1; i < cols.length; i++) {
    for (const r of runs(colText(cols[i]))) {
      const bid = digs(r, 'navigationEndpoint.browseEndpoint.browseId')
      if (typeof bid === 'string' && bid.startsWith('UC')) {
        return { artist: String(r.text ?? 'Unknown artist'), artistId: bid }
      }
    }
  }
  const segs = cols.length > 1 ? segments(colText(cols[1])) : []
  return { artist: segs[1] || 'Unknown artist', artistId: '' }
}

const DUR_RE = /^\d{1,2}:\d{2}(:\d{2})?$/
/* date-stamped recommendation junk ("2d ago", "5h ago", "Oct 19") — never a real artist */
const DATE_JUNK_RE = /^(today|yesterday|just now|\d+\s?(min|h|hr|hour|day|d|week|w|month|mo|year|y)s?\s?ago|[a-z]{3}\s\d{1,2}|\d{1,2}[/.]\d{1,2})$/i

/** classify a musicResponsiveListItemRenderer into song / video / artist / album */
function parseItem(item: J, forcedKind?: 'song' | 'video' | 'artist' | 'album'): { song?: YtmTrack; artist?: YtmArtist; album?: YtmAlbum } {
  const cols = asArr(item.flexColumns)
  if (!cols.length) return {}
  const col0 = asJ(cols[0])?.musicResponsiveListItemFlexColumnRenderer
  const title = runsText(asJ(col0)?.text).trim()
  if (!title) return {}
  const metaSegs = cols.length > 1 ? segments(colText(cols[1])) : []
  const kind = forcedKind || (metaSegs[0]?.toLowerCase() as string | undefined) || ''
  const { artist, artistId } = artistRefOf(item)
  const thumb = thumbOf(item)

  if (kind === 'artist' || (!kind && item.navigationEndpoint && browseIdOf(item).startsWith('UC') && !videoIdOf(item))) {
    return {
      artist: { id: browseIdOf(item), name: title, thumb, audience: metaSegs.slice(1).join(' • ') || '' },
    }
  }

  if (kind === 'album' || kind === 'single' || kind === 'ep') {
    return {
      album: { id: browseIdOf(item), title, artist: metaSegs[1] || artist, year: metaSegs[2] && metaSegs[2] !== ',' ? metaSegs[2] : '', thumb },
    }
  }

  const vid = videoIdOf(item)
  if (!vid) return {}
  /* drop date-stamped recommendation junk — the "artist" is a timestamp */
  if (DATE_JUNK_RE.test(artist.trim())) return {}
  const isVideo = kind === 'video'
  const durIdx = metaSegs.findIndex((s) => DUR_RE.test(s))
  const duration = durIdx >= 0 ? metaSegs[durIdx] : ''
  /* 2025 layout keeps plays/views in a third column */
  const col2Text = cols.length > 2 ? runsText(colText(cols[2])).trim() : ''
  const extra =
    metaSegs.find((s) => /\b(plays?|views?|watching)\b/i.test(s)) ||
    (/\b(plays?|views?|watching)\b/i.test(col2Text) ? col2Text : '')
  /* anything sitting between the artist and the duration is the album */
  const album = !isVideo && durIdx >= 3 ? metaSegs[durIdx - 1] : ''
  return {
    song: {
      videoId: vid,
      title,
      artist,
      artistId,
      album,
      duration,
      thumb,
      extra,
      kind: isVideo ? 'video' : 'song',
    },
  }
}

/* ---------------- youtubei core ---------------- */
const CTX = {
  context: {
    client: { clientName: 'WEB_REMIX', clientVersion: '1.20240610.01.00', hl: 'en', gl: 'US' },
  },
}
const WCTX = {
  context: {
    client: { clientName: 'WEB', clientVersion: '2.20240610.01.00', hl: 'en', gl: 'US' },
  },
}
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function ytm<T>(endpoint: string, body: J): Promise<T> {
  const r = await fetch(`https://music.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/' },
    body: JSON.stringify({ ...CTX, ...body }),
    signal: AbortSignal.timeout(9000),
  })
  if (!r.ok) throw new Error(`youtubei ${endpoint} ${r.status}`)
  return (await r.json()) as T
}

async function ytWeb<T>(endpoint: string, body: J): Promise<T> {
  const r = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Origin: 'https://www.youtube.com' },
    body: JSON.stringify({ ...WCTX, ...body }),
    signal: AbortSignal.timeout(9000),
  })
  if (!r.ok) throw new Error(`youtubei ${endpoint} ${r.status}`)
  return (await r.json()) as T
}

/* ---------------- caching ---------------- */
const CACHE_MS = 5 * 60 * 1000
const VERIFY_MS = 24 * 60 * 60 * 1000
const cache = new Map<string, { at: number; data: unknown }>()
function cacheGet<T>(key: string, ttl: number): T | null {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.data as T
  return null
}
function cacheSet(key: string, data: unknown): void {
  cache.set(key, { at: Date.now(), data })
  if (cache.size > 120) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
}

/* ---------------- search ---------------- */
interface SearchPayload {
  top: YtmSearchResult['top']
  songs: YtmTrack[]
  videos: YtmTrack[]
  artists: YtmArtist[]
  albums: YtmAlbum[]
  continuation: string
  /** videoId that seeds the radio chain — the client hops from here for unlimited pages */
  seed: string
}

function parseSearch(j: unknown): SearchPayload {
  const out: SearchPayload = { top: null, songs: [], videos: [], artists: [], albums: [], continuation: '', seed: '' }
  /* first page and continuation pages carry the same shapes in two spots */
  const firstPageSections = asArr(
    digs(j, 'contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents')
  )
  const sections = firstPageSections.length
    ? firstPageSections
    : asArr(digs(j, 'continuationContents.sectionListContinuation.contents'))
  const pushItem = (item: J, forced?: 'song' | 'video' | 'artist' | 'album') => {
    const { song, artist, album } = parseItem(item, forced)
    if (song && !out.songs.some((s) => s.videoId === song.videoId)) out.songs.push(song)
    if (song?.kind === 'video' && !out.videos.some((v) => v.videoId === song.videoId)) out.videos.push(song)
    if (artist && !out.artists.some((a) => a.id === artist.id)) out.artists.push(artist)
    if (album && album.id && !out.albums.some((b) => b.id === album.id)) out.albums.push(album)
  }

  for (const secRaw of sections) {
    const sec = asJ(secRaw)
    if (!sec) continue

    /* top-result card */
    const card = asJ(sec.musicCardShelfRenderer)
    if (card) {
      const title = runsText(asJ(card.title)).trim()
      const subs = segments(asJ(card.subtitle))
      const kind = (subs[0] || '').toLowerCase()
      const bid = digs(runs(asJ(card.title))[0], 'navigationEndpoint.browseEndpoint.browseId')
      const cardThumb = thumbOf(card)
      if (kind === 'artist' && title && typeof bid === 'string' && bid.startsWith('UC')) {
        out.top = { kind: 'artist', artist: { id: bid, name: title, thumb: cardThumb, audience: subs.slice(1).join(' • ') } }
      } else if ((kind === 'song' || kind === 'video') && asArr(card.contents).length) {
        const inner = asJ(asArr(card.contents)[0])
        const item = inner ? asJ(inner.musicResponsiveListItemRenderer) : null
        if (item) {
          const parsed = parseItem(item, kind === 'video' ? 'video' : 'song')
          if (parsed.song) {
            out.top =
              kind === 'video'
                ? { kind: 'video', video: parsed.song }
                : { kind: 'song', song: parsed.song }
          }
        }
      }
      continue
    }

    /* flat 2025 layout: itemSectionRenderer → bare list items */
    const inner = asJ(sec.itemSectionRenderer)
    const items = asArr(inner?.contents)
    for (const itRaw of items) {
      const it = asJ(itRaw)
      if (!it) continue
      if (it.musicResponsiveListItemRenderer) {
        const item = asJ(it.musicResponsiveListItemRenderer)
        if (item) pushItem(item)
      } else if (it.musicShelfRenderer) {
        /* legacy grouped layout */
        const shelf = asJ(it.musicShelfRenderer)
        const shelfTitle = (runsText(asJ(shelf?.title)) || '').toLowerCase()
        const forced = shelfTitle.includes('song') ? 'song' : shelfTitle.includes('video') ? 'video' : shelfTitle.includes('artist') ? 'artist' : shelfTitle.includes('album') ? 'album' : undefined
        for (const c of asArr(shelf?.contents)) {
          const cJ = asJ(asJ(c)?.musicResponsiveListItemRenderer)
          if (cJ) pushItem(cJ, forced)
        }
      }
    }
  }
  out.songs = out.songs.filter((s) => s.kind === 'song')
  out.continuation = continuationOf(j)
  return out
}

/* ---------------- continuation tokens (unlimited pages) ----------------
   youtubei answers always hide the next-page token in one of a few places —
   pull them all, plus a deep sweep for shelf/carousel continuations. */
function continuationOf(j: unknown): string {
  const pools = [
    asArr(digs(j, 'contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.continuations')),
    asArr(digs(j, 'continuationContents.sectionListContinuation.continuations')),
    asArr(digs(j, 'continuationContents.itemSectionContinuation.continuations')),
  ]
  for (const pool of pools) {
    for (const c of pool) {
      const t = digs(c, 'nextContinuationData.continuation')
      if (typeof t === 'string' && t) return t
    }
  }
  return findContinuationDeep(j, 0)
}

/** deep walk — first nextContinuationData.continuation anywhere in the payload */
function findContinuationDeep(node: unknown, depth: number): string {
  if (depth > 40) return ''
  if (Array.isArray(node)) {
    for (const v of node) {
      const hit = findContinuationDeep(v, depth + 1)
      if (hit) return hit
    }
    return ''
  }
  const o = asJ(node)
  if (!o) return ''
  const direct = digs(o, 'nextContinuationData.continuation')
  if (typeof direct === 'string' && direct) return direct
  for (const k of Object.keys(o)) {
    const hit = findContinuationDeep(o[k], depth + 1)
    if (hit) return hit
  }
  return ''
}

async function search(q: string, ct?: string): Promise<SearchPayload> {
  const key = `search:${q.toLowerCase()}:${ct || ''}`
  const hit = cacheGet<SearchPayload>(key, CACHE_MS)
  if (hit) return hit
  if (ct) {
    const j = await ytm<unknown>('search', { continuation: ct })
    const parsed = parseSearch(j)
    cacheSet(key, parsed)
    return parsed
  }
  /* search: base query + the songs-filter query merged (two real pages, deduped) */
  const j = await ytm<unknown>('search', { query: q })
  const parsed = parseSearch(j)
  let songsFilter: SearchPayload | null = null
  try {
    songsFilter = parseSearch(await ytm<unknown>('search', { query: q, params: 'EgIQAQ%3D%3D' }))
    for (const s of songsFilter.songs) {
      if (!parsed.songs.some((x) => x.videoId === s.videoId)) parsed.songs.push(s)
    }
    for (const a of songsFilter.artists) {
      if (!parsed.artists.some((x) => x.id === a.id)) parsed.artists.push(a)
    }
    for (const b of songsFilter.albums) {
      if (!parsed.albums.some((x) => x.id === b.id)) parsed.albums.push(b)
    }
  } catch { /* filter page is a bonus — never block the main search */ }
  parsed.seed = parsed.top?.kind === 'song' ? parsed.top.song.videoId : parsed.top?.kind === 'video' ? parsed.top.video.videoId : parsed.songs[0]?.videoId || ''
  cacheSet(key, parsed)
  return parsed
}

/* ---------------- RADIO — the unlimited engine ----------------
   youtubei/v1 next with playlistId=RDAMVM<videoId> is the real YouTube Music
   autoplay queue: 50 tracks per call, every one carrying official VIEWS and
   LIKES in the byline. Chaining the call on the last returned track pages
   forever (verified: ~43+ fresh tracks per hop) — that is how the OS streams
   "unlimited songs", straight from the real API. */
function parseRadio(j: unknown): { songs: YtmTrack[]; seed: string } {
  const songs: YtmTrack[] = []
  const walk = (node: unknown, depth = 0): void => {
    if (Array.isArray(node)) {
      node.forEach((v) => walk(v, depth + 1))
      return
    }
    const o = asJ(node)
    if (!o || depth > 40) return
    const item = asJ(o.playlistPanelVideoRenderer)
    if (item) {
      const vid = String(item.videoId ?? '')
      const title = runsText(asJ(item.title)).trim()
      if (vid && title && !songs.some((s) => s.videoId === vid)) {
        const byline = segments(asJ(item.longBylineText))
        const views = byline.find((s) => /\bviews?\b/i.test(s)) || ''
        const likes = byline.find((s) => /\blikes?\b/i.test(s)) || ''
        const artist = byline.find((s) => !/\b(views?|likes?)\b/i.test(s)) || 'Unknown artist'
        const dur = runsText(asJ(item.lengthText)).trim() || String(digs(item, 'lengthText.simpleText') ?? '')
        const thumbs = asArr(digs(item, 'thumbnail.thumbnails')) as J[]
        const usable = thumbs.filter((t) => Number(t.width) <= 544)
        const thumb = thumbs.length ? String((usable.length ? usable[usable.length - 1] : thumbs[thumbs.length - 1]).url ?? '') : ''
        songs.push({ videoId: vid, title, artist, artistId: '', album: '', duration: dur, thumb, extra: '', views, likes, kind: 'song' })
      }
    }
    for (const k of Object.keys(o)) walk(o[k], depth + 1)
  }
  walk(asJ(j)?.contents)
  return { songs, seed: songs.length ? songs[songs.length - 1].videoId : '' }
}

async function radio(seed: string): Promise<{ songs: YtmTrack[]; seed: string }> {
  const key = `radio:${seed}`
  const hit = cacheGet<{ songs: YtmTrack[]; seed: string }>(key, CACHE_MS)
  if (hit) return hit
  const j = await ytm<unknown>('next', { videoId: seed, playlistId: `RDAMVM${seed}` })
  const parsed = parseRadio(j)
  if (!parsed.songs.length) throw new Error('radio queue empty')
  cacheSet(key, parsed)
  return parsed
}

/* ---------------- home (real-time feed — every carousel, UNLIMITED pages) ---------------- */
async function home(ct?: string): Promise<{ songs: YtmTrack[]; continuation: string; seed: string }> {
  const key = `home:${ct || ''}`
  const hit = cacheGet<{ songs: YtmTrack[]; continuation: string; seed: string }>(key, 3 * 60 * 1000)
  if (hit) return hit
  const j = await ytm<unknown>(
    'browse',
    ct ? { browseId: 'FEmusic_home', continuation: ct } : { browseId: 'FEmusic_home' }
  )
  const songs: YtmTrack[] = []
  const carousels: unknown[] = []
  const walk = (node: unknown, depth = 0): void => {
    if (Array.isArray(node)) {
      node.forEach((v) => walk(v, depth + 1))
      return
    }
    const o = asJ(node)
    if (!o || depth > 40) return
    if (o.musicCarouselShelfRenderer) carousels.push(o.musicCarouselShelfRenderer)
    for (const k of Object.keys(o)) walk(o[k], depth + 1)
  }
  walk(asJ(j)?.contents)
  if (ct) walk(asJ(j)?.continuationContents) /* continuation pages live here */
  for (const cRaw of carousels) {
    const c = asJ(cRaw)
    const headerTitle = runsText(digs(c, 'header.musicCarouselShelfBasicHeaderRenderer.title')).toLowerCase()
    /* collect EVERY carousel the feed serves — Song mixes, decades, quick picks,
       new releases — every real track on the home page, no filters, no caps */
    void headerTitle
    for (const itRaw of asArr(c?.contents)) {
      const two = asJ(asJ(itRaw)?.musicTwoRowItemRenderer)
      if (!two) continue
      const title = runsText(asJ(two.title)).trim()
      const vid = digs(two, 'navigationEndpoint.watchEndpoint.videoId') || digs(runs(asJ(two.title))[0], 'navigationEndpoint.watchEndpoint.videoId')
      const segs = segments(asJ(two.subtitle))
      const thumbs = asArr(digs(two, 'thumbnailRenderer.musicThumbnailRenderer.thumbnail.thumbnails')) as J[]
      const thumb = thumbs.length ? String((thumbs.filter((t) => Number(t.width) <= 544)[thumbs.filter((t) => Number(t.width) <= 544).length - 1] || thumbs[thumbs.length - 1]).url ?? '') : ''
      const kindSeg = (segs[0] || 'song').toLowerCase()
      /* junk filter: quick picks sometimes slip in date-stamped video/episode
         recommendations ("4d ago", "Oct 19") with no real artist — drop them */
      const artistSeg = segs[1] || ''
      if (!artistSeg || DATE_JUNK_RE.test(artistSeg.trim())) continue
      if (title && typeof vid === 'string' && vid && (kindSeg === 'song' || kindSeg === 'video')) {
        if (!songs.some((s) => s.videoId === vid)) {
          songs.push({
            videoId: vid,
            title,
            artist: segs[1] || 'Unknown artist',
            artistId: '',
            album: '',
            duration: '',
            thumb,
            extra: '',
            kind: kindSeg === 'video' ? 'video' : 'song',
          })
        }
      }
    }
    /* NO early break, NO 15/25 caps — every song the feed serves, we serve */
  }
  if (!songs.length) {
    /* real-time fallback — always returns something */
    const res = await search('top hits this week')
    return { songs: res.songs.slice(0, 60), continuation: res.continuation, seed: res.seed }
  }
  const data = {
    songs: songs.slice(0, 150),
    continuation: continuationOf(j),
    seed: songs[songs.length - 1].videoId, /* radio chain grows from the tail */
  }
  cacheSet(key, data)
  return data
}

/* ---------------- artist page ---------------- */
function parseArtistPage(j: unknown, id: string): { artist: YtmArtistPage['artist']; songs: YtmTrack[]; albums: YtmAlbum[]; continuation: string; seed: string } {
  const hdr = asJ(digs(j, 'header.musicImmersiveHeaderRenderer')) || asJ(digs(j, 'header.musicResponsiveHeaderRenderer'))
  const name = hdr ? runsText(asJ(hdr.title)).trim() : 'Artist'
  const banner = hdr ? thumbOf(hdr) : ''
  const audience = hdr
    ? segments(asJ(hdr.monthlyListenerCount)).join(' • ') || segments(asJ(hdr.secondSubtitle)).join(' • ')
    : ''
  const description = hdr ? runsText(asJ(hdr.description)).trim() : ''

  const shelves: J[] = []
  const walk = (node: unknown, depth = 0): void => {
    if (Array.isArray(node)) {
      node.forEach((v) => walk(v, depth + 1))
      return
    }
    const o = asJ(node)
    if (!o || depth > 40) return
    if (o.musicShelfRenderer) shelves.push(asJ(o.musicShelfRenderer) as J)
    if (o.musicShelfContinuation) shelves.push(asJ(o.musicShelfContinuation) as J) /* continuation pages */
    for (const k of Object.keys(o)) walk(o[k], depth + 1)
  }
  walk(asJ(j)?.contents)
  if (asJ(j)?.continuationContents) walk(asJ(j)?.continuationContents) /* continuation pages live here */

  const songs: YtmTrack[] = []
  let firstSongVid = ''
  for (const shelf of shelves) {
    for (const c of asArr(shelf.contents)) {
      const item = asJ(asJ(c)?.musicResponsiveListItemRenderer)
      if (!item) continue
      const vid = videoIdOf(item)
      const title = runsText(colText(asArr(item.flexColumns)[0])).trim()
      if (!vid || !title) continue
      const cols = asArr(item.flexColumns)
      const colTexts = cols.slice(1).map((c) => runsText(colText(c)).trim())
      const meta = colTexts.length ? segments(colText(cols[1])) : []
      const extra = colTexts.find((t) => /\bplays?\b/i.test(t)) || ''
      const album = colTexts.find((t) => t && !/\bplays?\b/i.test(t) && t !== name) || ''
      if (songs.some((s) => s.videoId === vid)) continue
      if (!firstSongVid) firstSongVid = vid
      songs.push({
        videoId: vid,
        title,
        artist: name,
        artistId: id,
        album,
        duration: '',
        thumb: thumbOf(item),
        extra: meta.find((s) => /\bplays?\b/i.test(s)) || '',
        kind: 'song',
      })
    }
    if (songs.length >= 120) break /* per-page sanity — pagination continues via continuation */
  }

  /* albums from two-row carousels */
  const albums: YtmAlbum[] = []
  const walk2 = (node: unknown, depth = 0): void => {
    if (Array.isArray(node)) {
      node.forEach((v) => walk2(v, depth + 1))
      return
    }
    const o = asJ(node)
    if (!o || depth > 40) return
    if (o.musicTwoRowItemRenderer) {
      const two = asJ(o.musicTwoRowItemRenderer) as J
      const bid = digs(two, 'navigationEndpoint.browseEndpoint.browseId')
      const title = runsText(asJ(two.title)).trim()
      const segs = segments(asJ(two.subtitle))
      const thumbs = asArr(digs(two, 'thumbnailRenderer.musicThumbnailRenderer.thumbnail.thumbnails')) as J[]
      const thumb = thumbs.length ? String((thumbs[thumbs.length - 1] || {}).url ?? '') : ''
      if (typeof bid === 'string' && bid.startsWith('MPREb') && title && !albums.some((a) => a.id === bid)) {
        albums.push({ id: bid, title, artist: segs[1] || name, year: segs[2] || '', thumb })
      }
    }
    for (const k of Object.keys(o)) walk2(o[k], depth + 1)
  }
  walk2(asJ(j)?.contents)

  return {
    artist: { id, name, banner, audience, description },
    songs,
    albums: albums.slice(0, 16),
    continuation: continuationOf(j),
    seed: firstSongVid || songs[songs.length - 1]?.videoId || '',
  }
}

async function artistPage(id: string, ct?: string): Promise<{ artist: YtmArtistPage['artist']; songs: YtmTrack[]; albums: YtmAlbum[]; continuation: string; seed: string }> {
  if (!/^UC[\w-]{10,}$/.test(id)) throw new Error('bad artist id')
  const key = `artist:${id}:${ct || ''}`
  const hit = cacheGet<{ artist: YtmArtistPage['artist']; songs: YtmTrack[]; albums: YtmAlbum[]; continuation: string; seed: string }>(key, CACHE_MS)
  if (hit) return hit
  const j = await ytm<unknown>(
    'browse',
    ct ? { browseId: id, continuation: ct } : { browseId: id }
  )
  const parsed = parseArtistPage(j, id)
  cacheSet(key, parsed)
  return parsed
}

/* ---------------- verified artists (Official Artist Channel) ---------------- */
const normName = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').replace(/ - topic$/, '').trim()

async function verifyOne(name: string): Promise<YtmVerified> {
  const key = `verify:${normName(name)}`
  const hit = cacheGet<YtmVerified>(key, VERIFY_MS)
  if (hit) return hit
  const j = await ytWeb<unknown>('search', { query: name, params: 'EgIQAg%3D%3D' }) /* channels filter */
  const sections = asArr(digs(j, 'contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents'))
  let best: YtmVerified = { verified: false, subs: '', handle: '' }
  for (const secRaw of sections) {
    for (const itRaw of asArr(asJ(asJ(secRaw)?.itemSectionRenderer)?.contents)) {
      const ch = asJ(asJ(itRaw)?.channelRenderer)
      if (!ch) continue
      const chName = runsText(asJ(ch.title)).trim() || String(digs(ch, 'title.simpleText') || '')
      const badges = asArr(ch.ownerBadges) as J[]
      const isArtistVerified = badges.some((b) => digs(b, 'metadataBadgeRenderer.style') === 'BADGE_STYLE_TYPE_VERIFIED_ARTIST')
      const subs = String(digs(ch, 'videoCountText.simpleText') || digs(ch, 'videoCountText.accessibility.accessibilityData.label') || '')
      const handle = String(digs(ch, 'subscriberCountText.simpleText') || '')
      const same = normName(chName) === normName(name)
      if (same && isArtistVerified) {
        best = { verified: true, subs: subs || '', handle: handle.startsWith('@') ? handle : '' }
        cacheSet(key, best)
        return best
      }
      if (same && !best.verified) best = { verified: false, subs: subs || '', handle: handle.startsWith('@') ? handle : '' }
      if (!same && isArtistVerified && !best.verified && normName(chName).includes(normName(name))) {
        best = { verified: true, subs: subs || '', handle: handle.startsWith('@') ? handle : '' }
      }
    }
  }
  cacheSet(key, best)
  return best
}

async function verifyBatch(names: string[]): Promise<Record<string, YtmVerified>> {
  const out: Record<string, YtmVerified> = {}
  await Promise.all(
    names.slice(0, 8).map(async (n) => {
      try {
        out[n] = await verifyOne(n)
      } catch {
        out[n] = { verified: false, subs: '', handle: '' }
      }
    })
  )
  return out
}

/* ---------------- handler ---------------- */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const mode = (url.searchParams.get('mode') || 'home').toLowerCase()
  try {
    if (mode === 'search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 120)
      const ct = (url.searchParams.get('ct') || '').trim().slice(0, 1024)
      if (!q) return NextResponse.json({ ok: true, query: '', top: null, songs: [], videos: [], artists: [], albums: [], continuation: '', seed: '' } satisfies YtmSearchResult)
      const res = await search(q, ct || undefined)
      const payload: YtmSearchResult = { ok: true, query: q, ...res }
      return NextResponse.json(payload)
    }
    if (mode === 'home') {
      const ct = (url.searchParams.get('ct') || '').trim().slice(0, 1024)
      const res = await home(ct || undefined)
      return NextResponse.json({ ok: true, songs: res.songs, continuation: res.continuation, seed: res.seed } satisfies YtmHomeResult)
    }
    if (mode === 'radio') {
      /* the unlimited engine — real autoplay queue, 50 tracks w/ views+likes */
      const v = (url.searchParams.get('v') || '').trim().slice(0, 16)
      if (!/^([\w-]{11})$/.test(v)) return NextResponse.json({ ok: false, error: 'bad seed', songs: [], seed: '' }, { status: 400 })
      const res = await radio(v)
      return NextResponse.json({ ok: true, songs: res.songs, seed: res.seed } satisfies YtmHomeResult)
    }
    if (mode === 'artist') {
      const id = (url.searchParams.get('id') || '').trim().slice(0, 60)
      const ct = (url.searchParams.get('ct') || '').trim().slice(0, 1024)
      const res = await artistPage(id, ct || undefined)
      const payload: YtmArtistPage = { ok: true, ...res }
      return NextResponse.json(payload)
    }
    if (mode === 'verify') {
      const ids = (url.searchParams.get('ids') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8)
      const verified = ids.length ? await verifyBatch(ids) : {}
      const payload: YtmVerifyMap = { ok: true, verified }
      return NextResponse.json(payload)
    }
    return NextResponse.json({ ok: false, error: 'unknown mode' }, { status: 400 })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Music service unreachable' },
      { status: 502 }
    )
  }
}

// REDSEC v7.0 — /api/news/article : the full-detail news engine.
// When a story is opened in the News app the server brings the WHOLE article
// into the OS — no redirect to the publisher's site, no iframe, no leaving
// the reading view:
//   1. RESOLVE — Google News RSS links are redirects whose hop page no longer
//      carries the target (Google resolves it in JS now). Legacy tokens are
//      decoded first; anything else is resolved by searching the headline
//      across the live web (z.ai web_search) and picking the publisher URL.
//   2. EXTRACT — the publisher page is parsed server-side: title, hero image,
//      publish date and the full body paragraphs (readability-style, no deps).
//   3. BRIEF  — when a publisher blocks bots or strips its body, the REDSEC
//      AI core writes the complete article briefing from live web sources,
//      with a source list attached.
// The response is always JSON — the reader renders a full-length article.
import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

interface ArticleOut {
  ok: boolean
  url: string
  title: string
  source: string
  pubDate: string
  hero: string
  description: string
  paragraphs: string[]
  wordCount: number
  method: 'extract' | 'ai'
  error?: string
  sources?: Array<{ name: string; url: string }>
}

/* ---------------- helpers ---------------- */

function decodeEntities(s: string): string {
  return s
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(Number(d))
      } catch {
        return ' '
      }
    })
    .replace(/&[a-z]+;/gi, ' ')
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function metaContent(html: string, key: string): string {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${esc}["']`, 'i'),
  ]
  for (const p of patterns) {
    const m = html.match(p)
    if (m?.[1]) return decodeEntities(m[1]).trim()
  }
  return ''
}

/** fetch text with a size ceiling so a huge "page" can never stall us */
async function fetchPage(url: string, timeoutMs = 15000): Promise<string> {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      cache: 'no-store',
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`publisher responded ${res.status}`)
    const buf = await res.arrayBuffer()
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 5_000_000))
    return text
  } finally {
    clearTimeout(to)
  }
}

/** legacy Google News tokens carry the URL in base64 — dig it out */
function resolveLegacyToken(html: string): string {
  const nau = html.match(/data-n-au=["']([^"']+)["']/i)?.[1]
  if (nau && /^https?:\/\//.test(nau) && !/news\.google\./.test(nau)) return nau
  const b64 = html.match(/(?:data-n-au|href)=["'][^"']*\/articles\/([A-Za-z0-9_-]{20,})/i)?.[1]
  if (b64) {
    try {
      const dec = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
      const u = dec.match(/https?:\/\/[^\s"'\\<>]+/)?.[0]
      if (u && !/news\.google\./.test(u)) return u
    } catch { /* not base64 */ }
  }
  return ''
}

function isPrivateUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (!/^https?:$/.test(u.protocol)) return true
    const h = u.hostname
    if (/^(localhost|127\.|10\.|0\.|169\.254\.|::1)/.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
    return false
  } catch {
    return true
  }
}

/** readability-style body extraction — regex based, zero dependencies */
function extractBody(html: string): string[] {
  let h = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<(nav|header|footer|aside|menu)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  const art = h.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1]
  if (art && art.length > 500) h = art

  const paras: string[] = []
  const seen = new Set<string>()
  for (const m of h.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = stripTags(m[1])
    if (t.length < 45) continue
    if (t.split(' ').length < 7) continue
    const key = t.slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    paras.push(t)
    if (paras.length >= 140) break
  }
  return paras
}

function extractDate(html: string): string {
  const cand =
    metaContent(html, 'article:published_time') ||
    metaContent(html, 'og:article:published_time') ||
    html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1] ||
    html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] ||
    ''
  return cand.slice(0, 40)
}

function extractHero(html: string): string {
  const cand =
    metaContent(html, 'og:image') ||
    metaContent(html, 'twitter:image') ||
    metaContent(html, 'og:image:secure_url') ||
    html.match(/<img[^>]+src=["'](https?:\/\/[^"']+\.(?:jpe?g|png|webp|avif))["']/i)?.[1] ||
    ''
  return cand
}

/* ---------------- AI core (lazy singleton) ---------------- */

let zaiInst: Awaited<ReturnType<typeof ZAI.create>> | null = null
async function getZai() {
  if (!zaiInst) zaiInst = await ZAI.create()
  return zaiInst
}

/** resolve a Google News redirect by searching the headline across the live
 *  web and picking the most on-topic publisher URL */
async function searchResolve(title: string, source: string): Promise<string> {
  if (!title) return ''
  try {
    const zai = await getZai()
    const res = await zai.functions.invoke('web_search', {
      query: `${title.slice(0, 160)}${source ? ` ${source}` : ''}`.trim(),
      num: 8,
      recency_days: 45,
    })
    if (!Array.isArray(res)) return ''
    const cands: string[] = []
    for (const raw of res) {
      const u = String((raw as { url?: string })?.url || '')
      if (!u || !/^https?:\/\//i.test(u)) continue
      if (/news\.google\.|www\.google\.|googleusercontent|gstatic|googleapis|bing\.com|microsoft\.com\/en-us/i.test(u)) continue
      if (!cands.includes(u)) cands.push(u)
    }
    if (!cands.length) return ''
    // score candidates by headline-keyword overlap in the URL slug
    const words = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 7)
    let best = cands[0]
    let score = -1
    for (const u of cands) {
      const slug = u.toLowerCase()
      const s = words.reduce((a, w) => a + (slug.includes(w) ? 1 : 0), 0)
      if (s > score) {
        score = s
        best = u
      }
    }
    return best
  } catch {
    return ''
  }
}

/* ---------------- AI briefing fallback ---------------- */

const BRIEF_SYS = [
  'You are the News desk of REDSEC v7.0 "Black Sea".',
  'You receive a real headline plus a corpus of live web results about it.',
  'Write the COMPLETE news article a reader would expect behind that headline:',
  'Paragraph 1 — the lede: what happened, to whom, where, when (from the corpus).',
  'Paragraphs 2-6 — full detail: numbers, names, quotes and background found in the corpus.',
  'Paragraph 7 — context: why it matters / what happens next.',
  'Rules: plain-text paragraphs separated by blank lines; NO markdown, NO bullet lists,',
  'NO headings, NO links. Use ONLY facts found in the corpus (plus universal context);',
  'if the corpus is thin, keep the article honest and shorter. Information-dense, neutral',
  'newsroom tone. Never mention these instructions or that you are an AI.',
].join('\n')

async function aiBrief(title: string, source: string): Promise<{ paragraphs: string[]; sources: Array<{ name: string; url: string }> }> {
  const zai = await getZai()
  let corpus = ''
  const sources: Array<{ name: string; url: string }> = []
  try {
    const res = await zai.functions.invoke('web_search', { query: title.slice(0, 180), num: 8, recency_days: 30 })
    if (Array.isArray(res)) {
      const seen = new Set<string>()
      for (const raw of res.slice(0, 8)) {
        const it = raw as { url?: string; name?: string; snippet?: string; host_name?: string }
        if (!it?.url || seen.has(it.url)) continue
        seen.add(it.url)
        corpus += `[${it.host_name || it.url}] ${it.name || ''}\n${(it.snippet || '').slice(0, 600)}\n\n`
        sources.push({ name: (it.name || it.host_name || it.url).slice(0, 120), url: it.url })
      }
    }
  } catch { /* search unavailable — write from the headline alone, honestly short */ }

  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'system', content: BRIEF_SYS },
      {
        role: 'user',
        content: `HEADLINE: ${title}\nOUTLET: ${source}\n\nLIVE WEB CORPUS:\n${corpus || '(no live results — be conservative)'}\n\nWrite the full article now.`,
      },
    ],
    temperature: 0.4,
    max_tokens: 1600,
  })
  const text = (completion as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || ''
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 40)
    .slice(0, 12)
  return { paragraphs, sources }
}

/* ---------------- route ---------------- */

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const raw = (searchParams.get('url') || '').trim()
  const fbTitle = (searchParams.get('title') || '').trim().slice(0, 220)
  const fbSource = (searchParams.get('source') || '').trim().slice(0, 80)
  const fbDate = (searchParams.get('date') || '').trim().slice(0, 40)

  const out: ArticleOut = {
    ok: false,
    url: raw,
    title: fbTitle,
    source: fbSource,
    pubDate: fbDate,
    hero: '',
    description: '',
    paragraphs: [],
    wordCount: 0,
    method: 'extract',
  }

  if (!raw || isPrivateUrl(raw)) {
    out.error = 'bad_url'
    return NextResponse.json(out, { status: 400 })
  }

  /* 1 — resolve the real publisher URL */
  let target = raw
  if (/news\.google\./i.test(target)) {
    let real = ''
    try {
      const hop = await fetchPage(target, 12000)
      real = resolveLegacyToken(hop)
    } catch { /* hop fetch failed — try search */ }
    if (!real) real = await searchResolve(fbTitle, fbSource)
    if (real) target = real
  }
  out.url = target

  /* 2 — extract the publisher article */
  try {
    const html = await fetchPage(target, 15000)
    const paragraphs = extractBody(html)
    const ogTitle = metaContent(html, 'og:title') || stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    const title = fbTitle && paragraphs.length > 0 ? fbTitle : (ogTitle || fbTitle)
    const hero = extractHero(html)
    const description = metaContent(html, 'og:description') || metaContent(html, 'description')
    const date = extractDate(html) || fbDate
    const words = paragraphs.join(' ').split(/\s+/).length

    // a real article: at least 3 paragraphs or 400+ words of body prose
    if (paragraphs.length >= 3 || words >= 400) {
      out.ok = true
      out.title = title
      out.source = new URL(target).hostname.replace(/^www\./, '')
      out.pubDate = date
      out.hero = hero
      out.description = description.slice(0, 400)
      out.paragraphs = paragraphs.slice(0, 120)
      out.wordCount = words
      out.method = 'extract'
      return NextResponse.json(out)
    }

    // thin body — keep what we learned for the AI step
    out.hero = hero
    out.description = description.slice(0, 400)
    out.pubDate = date
    if (ogTitle) out.title = ogTitle
    out.error = 'thin_body'
  } catch (e) {
    out.error = e instanceof Error ? e.message : 'extract_failed'
    // search-resolved extraction failed at the network level — try one more
    // candidate from the live web before falling back to the briefing
    if (/news\.google\./i.test(target) === false && /publisher responded|extract_failed|abort/i.test(out.error) && fbTitle) {
      const alt = await searchResolve(fbTitle, fbSource)
      if (alt && alt !== target) {
        try {
          const html2 = await fetchPage(alt, 15000)
          const paras2 = extractBody(html2)
          const words2 = paras2.join(' ').split(/\s+/).length
          if (paras2.length >= 3 || words2 >= 400) {
            out.ok = true
            out.url = alt
            out.title = fbTitle
            out.source = new URL(alt).hostname.replace(/^www\./, '')
            out.hero = extractHero(html2)
            out.pubDate = extractDate(html2) || fbDate
            out.paragraphs = paras2.slice(0, 120)
            out.wordCount = words2
            out.method = 'extract'
            out.error = undefined
            return NextResponse.json(out)
          }
        } catch { /* fall through to the briefing */ }
      }
    }
  }

  /* 3 — AI briefing: the full detail behind the headline (needs a title) */
  const briefTitle = out.title || fbTitle
  if (briefTitle) {
    try {
      const brief = await aiBrief(briefTitle, fbSource)
      if (brief.paragraphs.length >= 2) {
        out.ok = true
        out.method = 'ai'
        out.paragraphs = brief.paragraphs
        out.wordCount = brief.paragraphs.join(' ').split(/\s+/).length
        out.source = out.source || fbSource || 'REDSEC AI desk'
        out.sources = brief.sources.slice(0, 8)
        out.error = undefined
      }
    } catch { /* AI unreachable — the reader shows the graceful error state */ }
  }

  if (!out.ok) out.error = out.error || 'unavailable'
  return NextResponse.json(out)
}

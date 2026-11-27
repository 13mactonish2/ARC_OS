// GET /api/github — Caterpillar's GitHub gateway (Task 78).
// Server-side proxy for the GitHub REST API so the app never fights CORS or
// per-browser rate limits, with an in-memory cache and JSON-only responses.
// UNLIMITED mode: search pages through every result (limit ≤ 100 + page), so
// the whole GitHub tool universe is reachable, installable and savable.
//   ?mode=search&q=...&sort=stars&limit=100&page=1 → repository search
//   ?mode=repo&owner=..&name=..              → one repo (details + languages)
//   ?mode=readme&owner=..&name=..            → README (rendered markdown → text)
//   ?mode=tree&owner=..&name=..&branch=..    → top-level file tree
//   ?mode=releases&owner=..&name=..&limit=8  → latest releases / tags
import { NextResponse } from 'next/server'
import { clientKey, rateLimit, tooMany } from '@/lib/server/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GH = 'https://api.github.com'
const cache = new Map<string, { at: number; body: unknown; status: number }>()
const TTL = 5 * 60 * 1000

const HEADERS: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'REDSEC-OS-Caterpillar/6.0',
}

async function gh(path: string): Promise<{ status: number; body: unknown }> {
  const key = path
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return { status: hit.status, body: hit.body }
  const res = await fetch(`${GH}${path}`, { headers: HEADERS, cache: 'no-store' })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  cache.set(key, { at: Date.now(), body, status: res.status })
    // keep the cache bounded
  if (cache.size > 600) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 200)
    for (const [k] of oldest) cache.delete(k)
  }
  return { status: res.status, body }
}

function bad(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status })
}

const REPO_LIM = 100

function slimRepo(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    owner: (r.owner as Record<string, unknown>)?.login || '',
    description: r.description || '',
    stars: r.stargazers_count || 0,
    forks: r.forks_count || 0,
    lang: r.language || '',
    updated: r.pushed_at || r.updated_at || '',
    topics: Array.isArray(r.topics) ? (r.topics as string[]).slice(0, 6) : [],
    archived: !!r.archived,
    url: r.html_url || `https://github.com/${r.full_name || ''}`,
    size: r.size || 0,
  }
}

export async function GET(req: Request) {
  const gate = rateLimit(clientKey(req, 'github'), 300, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') || 'search'
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200)
  const owner = (url.searchParams.get('owner') || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64)
  const name = (url.searchParams.get('name') || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64)
  const branch = (url.searchParams.get('branch') || '').replace(/[^A-Za-z0-9_.\-/]/g, '').slice(0, 96)
  const sort = (url.searchParams.get('sort') || 'stars').replace(/[^a-z-]/g, '')
  const page = Math.min(50, Math.max(1, Number(url.searchParams.get('page')) || 1))
  const limit = Math.min(REPO_LIM, Math.max(1, Number(url.searchParams.get('limit')) || 12))

  try {
    if (mode === 'search') {
      if (!q) return bad('Search query is empty.')
      const { status, body } = await gh(
        `/search/repositories?q=${encodeURIComponent(q)}&sort=${sort}&order=desc&per_page=${limit}&page=${page}`,
      )
      if (status !== 200 || !body || typeof body !== 'object') {
        return NextResponse.json({ ok: false, error: 'GitHub search failed — try again in a minute.' }, { status: 502 })
      }
      const items = (body as { items?: Record<string, unknown>[] }).items || []
      return NextResponse.json({
        ok: true,
        total: (body as { total_count?: number }).total_count || items.length,
        page,
        repos: items.map(slimRepo),
      })
    }

    if (mode === 'repo') {
      if (!owner || !name) return bad('owner and name are required.')
      const { status, body } = await gh(`/repos/${owner}/${name}`)
      if (status === 404) return NextResponse.json({ ok: false, error: 'Repository not found.' }, { status: 404 })
      if (status !== 200 || !body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'GitHub request failed.' }, { status: 502 })
      return NextResponse.json({ ok: true, repo: slimRepo(body as Record<string, unknown>) })
    }

    if (mode === 'readme') {
      if (!owner || !name) return bad('owner and name are required.')
      const { status, body } = await gh(`/repos/${owner}/${name}/readme`)
      if (status === 404) return NextResponse.json({ ok: true, readme: '' })
      if (status !== 200 || !body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'README fetch failed.' }, { status: 502 })
      const b64 = (body as { content?: string; encoding?: string }).content || ''
      const text = (body as { encoding?: string }).encoding === 'base64'
        ? Buffer.from(b64, 'base64').toString('utf8').slice(0, 24000)
        : ''
      return NextResponse.json({ ok: true, readme: text })
    }

    if (mode === 'tree') {
      if (!owner || !name) return bad('owner and name are required.')
      const { status, body } = await gh(`/repos/${owner}/${name}/contents${branch ? `?ref=${encodeURIComponent(branch)}` : ''}`)
      if (status === 404) return NextResponse.json({ ok: false, error: 'Repository or branch not found.' }, { status: 404 })
      if (status !== 200 || !Array.isArray(body)) return NextResponse.json({ ok: false, error: 'Tree fetch failed.' }, { status: 502 })
      const files = (body as Record<string, unknown>[]).map((f) => ({
        name: f.name, path: f.path, type: f.type, size: f.size || 0,
        download: f.download_url || null,
      }))
      return NextResponse.json({ ok: true, files })
    }

    if (mode === 'releases') {
      if (!owner || !name) return bad('owner and name are required.')
      const { status, body } = await gh(`/repos/${owner}/${name}/releases?per_page=${limit}`)
      if (status !== 200 || !Array.isArray(body)) return NextResponse.json({ ok: true, releases: [] })
      const releases = (body as Record<string, unknown>[]).map((r) => ({
        tag: r.tag_name || '',
        name: r.name || r.tag_name || '',
        at: r.published_at || '',
        body: String(r.body || '').slice(0, 4000),
        assets: Array.isArray(r.assets)
          ? (r.assets as Record<string, unknown>[]).map((a) => ({
              name: a.name, size: a.size || 0, downloads: a.download_count || 0,
              url: a.browser_download_url || '',
            })).slice(0, 12)
          : [],
      }))
      return NextResponse.json({ ok: true, releases })
    }

    return bad('Unknown mode.')
  } catch {
    return NextResponse.json({ ok: false, error: 'GitHub gateway unreachable — check the network.' }, { status: 502 })
  }
}

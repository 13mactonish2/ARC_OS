// REDSEC v5.0 — /api/linkfile : "convert any link into a real file"
// Task 36 — the OS Web Browser can turn ANY link into a REAL, workable file
// that lands in File Manager ▸ Downloads:
//   • a direct file (pdf/zip/mp3/png/...) is streamed through as-is with a
//     proper filename (extension synthesized from the MIME type when missing)
//   • an HTML page becomes a real single-file .html — relative URLs are
//     rewritten to absolute so the saved page works offline in the OS
//   • JSON / text responses keep their real types (.json / .txt)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const MAX_BYTES = 512 * 1024 * 1024 // 512 MB — same cap as the download relay

function bad(status: number, msg: string): Response {
  return new Response(JSON.stringify({ ok: false, message: msg }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** SSRF guard: block loopback / private / link-local / cloud-metadata hosts */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === '::1' || h === '[::1]' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true
  if (/^0\.0\.0\.0$/.test(h) || h.startsWith('0.')) return true
  if (/^127\./.test(h)) return true
  if (/^10\./.test(h)) return true
  if (/^192\.168\./.test(h)) return true
  if (/^169\.254\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true
  if (h === 'metadata.google.internal' || h === 'metadata.goog') return true
  return false
}

/** mime → real file extension (used when the URL path carries none) */
const EXT_BY_MIME: Array<[RegExp, string]> = [
  [/^image\/png/, 'png'], [/^image\/jpe?g/, 'jpg'], [/^image\/gif/, 'gif'], [/^image\/webp/, 'webp'],
  [/^image\/svg/, 'svg'], [/^image\/avif/, 'avif'], [/^image\/bmp/, 'bmp'], [/^image\/x-icon/, 'ico'],
  [/^audio\/mpeg/, 'mp3'], [/^audio\/wav|^audio\/x-wav/, 'wav'], [/^audio\/ogg/, 'ogg'],
  [/^audio\/flac/, 'flac'], [/^audio\/aac/, 'aac'], [/^audio\/mp4|^audio\/x-m4a/, 'm4a'],
  [/^audio\/opus/, 'opus'], [/^audio\/midi/, 'mid'],
  [/^video\/mp4/, 'mp4'], [/^video\/webm/, 'webm'], [/^video\/x-matroska/, 'mkv'], [/^video\/quicktime/, 'mov'],
  [/^application\/pdf/, 'pdf'], [/^application\/zip/, 'zip'], [/^application\/x-7z-compressed/, '7z'],
  [/^application\/x-rar/, 'rar'], [/^application\/gzip/, 'gz'], [/^application\/x-tar/, 'tar'],
  [/^application\/json/, 'json'], [/^text\/plain/, 'txt'], [/^text\/csv/, 'csv'],
  [/^text\/html/, 'html'], [/^application\/x-iso9660-image/, 'iso'],
  [/^application\/vnd\.openxmlformats-officedocument\.wordprocessingml/, 'docx'],
  [/^application\/vnd\.openxmlformats-officedocument\.spreadsheetml/, 'xlsx'],
  [/^application\/vnd\.openxmlformats-officedocument\.presentationml/, 'pptx'],
  [/^application\/epub/, 'epub'], [/^font\/woff2/, 'woff2'], [/^font\/woff/, 'woff'], [/^font\/ttf/, 'ttf'],
]

function extForMime(mime: string): string | null {
  for (const [re, ext] of EXT_BY_MIME) if (re.test(mime)) return ext
  return null
}

function slugify(s: string, fallback: string): string {
  const t = (s || '').replace(/\s+/g, ' ').trim().replace(/[\\/:*?"<>|]+/g, '').slice(0, 80)
  return t || fallback
}

function baseName(url: string, fallback: string): string {
  try {
    const u = new URL(url)
    const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')
    if (seg) return seg.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 100)
    return slugify(u.hostname.replace(/^www\./, ''), fallback)
  } catch {
    return fallback
  }
}

/* ---- HTML → real single-file page: rewrite every relative URL to absolute ---- */
function absolutize(html: string, base: string): string {
  // href/src/poster attributes
  let out = html.replace(
    /\s(href|src|poster)(\s*=\s*)(["'])(.*?)\3/gi,
    (m, attr, eq, q, val: string) => {
      const v = val.trim()
      if (!v || /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i.test(v)) return m
      try {
        return ` ${attr}${eq}${q}${new URL(v, base).href}${q}`
      } catch {
        return m
      }
    },
  )
  // srcset candidates
  out = out.replace(/\ssrcset(\s*=\s*)(["'])(.*?)\2/gi, (m, attr, q, val: string) => {
    const parts = val.split(',').map((part) => {
      const seg = part.trim().split(/\s+/)
      if (!seg[0] || /^(data:|blob:)/i.test(seg[0])) return part
      try {
        seg[0] = new URL(seg[0], base).href
        return seg.join(' ')
      } catch {
        return part
      }
    })
    return ` ${attr}${q}${parts.join(', ')}${q}`
  })
  // css url(...)
  out = out.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, q, val: string) => {
    const v = val.trim()
    if (!v || /^(data:|blob:|about:|#)/i.test(v)) return m
    try {
      return `url(${q}${new URL(v, base).href}${q})`
    } catch {
      return m
    }
  })
  return out
}

function filenameFromDisposition(cd: string | null): string | null {
  if (!cd) return null
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/^"|"$/g, '').trim()) || null
    } catch {
      /* fall through */
    }
  }
  const plain = /filename=("([^"]+)"|([^;\s]+))/i.exec(cd)
  const raw = plain?.[2] || plain?.[3]
  return raw ? raw.trim() : null
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const target = (searchParams.get('url') || '').trim()
  if (!target || !/^https?:\/\//i.test(target)) {
    return bad(400, 'Invalid or missing url — http(s) links only.')
  }
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return bad(400, 'Malformed URL.')
  }
  if (isPrivateHost(parsed.hostname)) {
    return bad(403, 'Blocked — private / loopback addresses cannot be converted.')
  }

  let upstream: Response
  try {
    upstream = await fetch(target, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'upstream unreachable'
    return bad(502, `Couldn't reach the host — ${detail}`)
  }

  if (!upstream.ok && upstream.status !== 206) {
    return bad(upstream.status === 404 ? 404 : 502, `Host responded ${upstream.status} ${upstream.statusText || ''}`.trim())
  }

  const ctype = (upstream.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase()
  const finalUrl = upstream.url || target
  const dispositionName = filenameFromDisposition(upstream.headers.get('content-disposition'))

  const headers = (name: string, mime: string, converted: string, length?: number): Record<string, string> => {
    const mimeFull = mime === 'text/html' || mime === 'text/plain' || mime.startsWith('text/') ? `${mime}; charset=utf-8` : mime
    const h: Record<string, string> = {
      'content-type': mimeFull,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'x-final-url': encodeURI(finalUrl),
      'x-filename': encodeURIComponent(name),
      'x-converted': converted,
    }
    if (typeof length === 'number' && Number.isFinite(length) && length > 0) h['content-length'] = String(length)
    h['accept-ranges'] = 'none'
    return h
  }

  /* ---- HTML page → real, workable single-file .html ---- */
  if (ctype === 'text/html' || ctype === 'application/xhtml+xml') {
    const raw = await upstream.text()
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1]?.replace(/\s+/g, ' ').trim() || ''
    const html = absolutize(raw, finalUrl)
    const name = `${slugify(title || baseName(finalUrl, 'page'), 'page')}.html`
    const body = new TextEncoder().encode(html)
    return new Response(body, { status: 200, headers: headers(name, 'text/html', 'html', body.byteLength) })
  }

  /* ---- JSON → real .json ---- */
  if (ctype === 'application/json' || ctype.endsWith('+json')) {
    const name =
      dispositionName ||
      (/\.(json)$/i.test(finalUrl.split('?')[0]) ? baseName(finalUrl, 'data.json') : `${slugify(baseName(finalUrl, 'data'), 'data')}.json`)
    const text = await upstream.text()
    const body = new TextEncoder().encode(text)
    return new Response(body, { status: 200, headers: headers(name, 'application/json', 'json', body.byteLength) })
  }

  /* ---- other text → real .txt (csv keeps its own) ---- */
  if (ctype.startsWith('text/') && ctype !== 'text/csv') {
    const name =
      dispositionName ||
      (/\.(txt|md|log)$/i.test(finalUrl.split('?')[0]) ? baseName(finalUrl, 'page.txt') : `${slugify(baseName(finalUrl, 'page'), 'page')}.txt`)
    const text = await upstream.text()
    const body = new TextEncoder().encode(text)
    return new Response(body, { status: 200, headers: headers(name, ctype, 'text', body.byteLength) })
  }

  /* ---- csv passthrough ---- */
  if (ctype === 'text/csv') {
    const name = dispositionName || (/\.(csv|tsv)$/i.test(finalUrl.split('?')[0]) ? baseName(finalUrl, 'data.csv') : `${slugify(baseName(finalUrl, 'data'), 'data')}.csv`)
    const text = await upstream.text()
    const body = new TextEncoder().encode(text)
    return new Response(body, { status: 200, headers: headers(name, 'text/csv', 'text', body.byteLength) })
  }

  /* ---- binary → stream through with a REAL filename ---- */
  let name = dispositionName || baseName(finalUrl, 'file')
  if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
    const ext = extForMime(ctype)
    if (ext) name = `${name.replace(/[.]+$/, '')}.${ext}`
  }
  const lenHeader = upstream.headers.get('content-length')
  const total = lenHeader ? Number(lenHeader) : NaN
  if (Number.isFinite(total) && total > MAX_BYTES) {
    return bad(413, `File is ${(total / 1024 / 1024).toFixed(0)} MB — over the 512 MB OS limit.`)
  }
  if (!upstream.body) return bad(502, 'Host returned an empty stream.')
  const h = headers(name, ctype, 'binary', Number.isFinite(total) ? total : undefined)
  if (upstream.headers.get('content-range')) h['content-range'] = upstream.headers.get('content-range') || ''
  return new Response(upstream.body, { status: 200, headers: h })
}

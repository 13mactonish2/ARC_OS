// REDSEC v5.0 — /api/download : streaming download relay for the OS Download
// Manager. Fetches a remote file server-side and streams the raw body through
// with Content-Length / Content-Disposition passthrough so the client can show
// real progress (bytes, speed, ETA) while it saves into the virtual File
// Manager (Downloads). Also used as a CORS-free fetcher for OS file operations.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** hard cap — the OS Download Manager refuses anything bigger */
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024 // 512 MB

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
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true // CGNAT 100.64/10
  if (h === 'metadata.google.internal' || h === 'metadata.goog') return true
  return false
}

/** filename from Content-Disposition, if the server sent one */
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
    return bad(403, 'Blocked — private / loopback addresses are not downloadable.')
  }

  const range = req.headers.get('range')
  let upstream: Response
  try {
    upstream = await fetch(target, {
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(range ? { Range: range } : {}),
      },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'upstream unreachable'
    return bad(502, `Couldn't reach the file host — ${detail}`)
  }

  if (!upstream.ok && upstream.status !== 206) {
    return bad(upstream.status === 404 ? 404 : 502, `Host responded ${upstream.status} ${upstream.statusText || ''}`.trim())
  }

  const lenHeader = upstream.headers.get('content-length')
  const total = lenHeader ? Number(lenHeader) : NaN
  if (Number.isFinite(total) && total > MAX_DOWNLOAD_BYTES) {
    return bad(413, `File is ${(total / 1024 / 1024).toFixed(0)} MB — over the 512 MB OS download limit.`)
  }

  const ctype = upstream.headers.get('content-type') || 'application/octet-stream'
  const disposition = upstream.headers.get('content-disposition')
  const fname = filenameFromDisposition(disposition)
  const finalUrl = upstream.url || target

  // passthrough filename hint so the client names the file correctly
  const headers: Record<string, string> = {
    'content-type': ctype,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'x-final-url': encodeURI(finalUrl),
  }
  if (Number.isFinite(total)) headers['content-length'] = String(total)
  if (fname) headers['x-filename'] = encodeURIComponent(fname)
  if (upstream.headers.get('content-range')) headers['content-range'] = upstream.headers.get('content-range') || ''
  headers['accept-ranges'] = 'none'

  if (!upstream.body) {
    return bad(502, 'Host returned an empty stream.')
  }
  return new Response(upstream.body, { status: 200, headers })
}

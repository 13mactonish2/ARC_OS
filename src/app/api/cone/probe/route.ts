// REDSEC 6.0 BlueStringRay — Task 57 : /api/cone/probe
// Cone Player "paste link" support probe. Before the player queues a pasted
// network link it asks this route what the link actually IS:
//   • content-type sniff (audio / video / other) from a 1-byte ranged GET
//   • real filename from Content-Disposition or the URL path
//   • stream size from Content-Range / Content-Length
// The player then decides: native decode (direct URL) vs REDSEC relay vs
// YouTube engine. Same-origin links answer instantly without any fetch.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|wma|aiff?|weba|mid|midi)(\?|#|$)/i
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|ogv|3gp|ts|mpd|m3u8)(\?|#|$)/i

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function fail(message: string, status = 400): Response {
  return json({ ok: false, message }, status)
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

function baseName(url: string): string | null {
  try {
    const u = new URL(url)
    const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')
    return seg ? seg.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 100) : null
  } catch {
    return null
  }
}

function kindFromMime(mime: string, url: string): 'audio' | 'video' | 'other' {
  const m = mime.split(';')[0].trim().toLowerCase()
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'application/ogg') return 'audio'
  if (m.startsWith('video/') || m === 'application/x-matroska' || m === 'application/vnd.apple.mpegurl') return 'video'
  if (AUDIO_EXT.test(url)) return 'audio'
  if (VIDEO_EXT.test(url)) return 'video'
  return 'other'
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const target = (searchParams.get('url') || '').trim()
  if (!target || !/^https?:\/\//i.test(target)) return fail('Invalid or missing url — http(s) links only.')

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return fail('Malformed URL.')
  }

  // same-origin fast path — the OS itself serves these files, no probe needed
  const reqOrigin = new URL(req.url).origin
  if (parsed.origin === reqOrigin) {
    const name = baseName(target) || 'os-stream'
    return json({
      ok: true,
      sameOrigin: true,
      kind: AUDIO_EXT.test(target) ? 'audio' : VIDEO_EXT.test(target) ? 'video' : 'other',
      title: name,
      contentType: '',
      size: null,
      finalUrl: target,
      host: parsed.hostname,
    })
  }

  if (isPrivateHost(parsed.hostname)) return fail('Blocked — private / loopback hosts cannot be probed.', 403)

  let upstream: Response
  try {
    upstream = await fetch(target, {
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Range: 'bytes=0-0', // 1 byte is enough to read the response headers
        Referer: parsed.origin + '/',
      },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    })
  } catch (e) {
    return fail(`Host unreachable — ${e instanceof Error ? e.message : 'network error'}`, 502)
  }

  // release the (tiny) body immediately
  try {
    await upstream.body?.cancel()
  } catch {}

  const status = upstream.status
  if (status >= 400) {
    return fail(`Host responded ${status} ${upstream.statusText || ''}`.trim(), status === 403 || status === 404 ? 404 : 502)
  }

  const ctype = upstream.headers.get('content-type') || 'application/octet-stream'
  const finalUrl = upstream.url || target
  const dispName = filenameFromDisposition(upstream.headers.get('content-disposition'))
  const range = upstream.headers.get('content-range') // bytes 0-0/123456
  const totalM = /\/(\d+)\s*$/.exec(range || '')
  const lenHeader = upstream.headers.get('content-length')
  const size = totalM ? Number(totalM[1]) : Number(lenHeader)

  const kind = kindFromMime(ctype, finalUrl)
  const name = dispName || baseName(finalUrl) || 'network stream'

  // an HTML page is not directly playable — tell the player so it can relay/iframe
  if (/^text\/html/i.test(ctype)) {
    return json({
      ok: true,
      kind: 'page',
      title: name,
      contentType: ctype,
      size: null,
      finalUrl,
      host: parsed.hostname.replace(/^www\./, ''),
    })
  }

  return json({
    ok: true,
    kind,
    title: name,
    contentType: ctype.split(';')[0].trim(),
    size: Number.isFinite(size) && size > 0 ? size : null,
    finalUrl,
    host: parsed.hostname.replace(/^www\./, ''),
    status,
  })
}

// REDSEC v5.0 — /api/proxy : same-origin web proxy for the OS Browser
// Fetches a URL server-side, strips frame-blocking headers, injects <base>,
// and rewrites relative links so pages render inside the OS browser iframe.

export const dynamic = 'force-dynamic'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const SKIP_SCHEME = /^(data:|javascript:|mailto:|tel:|about:|blob:|sms:|#)/i
const ANY_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

function errorPage(msg: string, status = 502): Response {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>REDSEC Proxy</title>
<style>
 body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#10141f;color:#e2e8f0;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
 .card{max-width:420px;text-align:center;padding:40px 32px;border:1px solid rgba(255,255,255,.1);border-radius:18px;background:#161b28}
 .emoji{font-size:44px;margin-bottom:10px}
 h1{font-size:17px;margin:8px 0 6px;font-weight:600}
 p{font-size:13px;line-height:1.6;color:#94a3b8;margin:0}
 .tag{display:inline-block;margin-top:18px;font-size:11px;color:#34d399;border:1px solid rgba(52,211,153,.35);border-radius:999px;padding:3px 12px}
</style></head>
<body><div class="card"><div class="emoji">🛡️</div><h1>${msg}</h1>
<p>The site may be unreachable, or it may refuse embedded access. Try another address, refresh, or use the start page search.</p>
<div class="tag">REDSEC Proxy</div></div></body></html>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}

function toAbs(raw: string, base: string): string | null {
  const t = raw.trim()
  if (!t || t.length > 2048) return null
  if (t.startsWith('#') || SKIP_SCHEME.test(t)) return null
  if (ANY_SCHEME.test(t)) {
    if (/^https?:\/\//i.test(t)) {
      try {
        return new URL(t, base).toString()
      } catch {
        return null
      }
    }
    return null // other schemes (tel:, app:, etc.) — leave untouched
  }
  try {
    return new URL(t, base).toString()
  } catch {
    return null
  }
}

/** best-effort rewrite of relative href/src/action/poster attributes to absolute URLs */
function absolutize(html: string, base: string): string {
  return html.replace(
    /(href|src|action|poster)(\s*=\s*)("([^"]*)"|'([^']*)')/gi,
    (full, attr: string, eq: string, _quoted: string, dq?: string, sq?: string) => {
      const val = dq !== undefined ? dq : (sq ?? '')
      const abs = toAbs(val, base)
      if (abs === null || abs === val) return full
      return `${attr}${eq}"${abs}"`
    }
  )
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const target = (searchParams.get('url') || '').trim()
  if (!target || !/^https?:\/\//i.test(target)) {
    return errorPage('Invalid or missing URL', 400)
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      cache: 'no-store',
    })
    const ctype = upstream.headers.get('content-type') || 'application/octet-stream'

    // non-HTML: stream through unchanged with original content-type
    if (!/text\/html|application\/xhtml\+xml/i.test(ctype)) {
      const buf = await upstream.arrayBuffer()
      return new Response(buf, {
        status: upstream.status,
        headers: {
          'content-type': ctype,
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      })
    }

    const base = upstream.url || target
    let html = await upstream.text()

    // rewrite relative references against the final (post-redirect) URL
    html = absolutize(html, base)

    // inject <base> right after <head> (or prepend) so anything we missed resolves too
    const baseTag = `<base href="${base}">`
    const head = /<head[^>]*>/i.exec(html)
    if (head) {
      const at = head.index + head[0].length
      html = html.slice(0, at) + baseTag + html.slice(at)
    } else {
      html = baseTag + html
    }

    // NOTE: we deliberately do NOT forward CSP / X-Frame-Options — we serve the page ourselves.
    return new Response(html, {
      status: upstream.status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'upstream unreachable'
    return errorPage(`Couldn't reach this site — ${detail}`)
  }
}

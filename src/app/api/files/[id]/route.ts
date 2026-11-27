// GET /api/files/[id] — serve a stored file (original bytes, high quality).
// v7.0: the response is STREAMED from disk instead of buffered, and HTTP
// Range requests are honoured — that is what lets a 20 GB workspace video
// start playing instantly and seek, and keeps server memory flat no matter
// how big the file is.   ?download=1 → Content-Disposition: attachment
import { NextResponse } from 'next/server'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { db } from '@/lib/db'
import { clientKey, rateLimit, tooMany, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Task 67 — uploads live OUTSIDE the repo so workspace resets can never
// wipe chat photos (see lib/server/uploads.ts)
const UPLOAD_DIR = '/home/z/.redsec-uploads'

function nodeToWeb(stream: Readable): ReadableStream {
  return Readable.toWeb(stream) as unknown as ReadableStream
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = rateLimit(clientKey(req, 'files'), 240, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const { id } = await ctx.params
  if (!/^[a-z0-9]{6,32}$/i.test(id)) {
    logSec('block', 'files', `malformed id probe: ${id.slice(0, 24)}`)
    return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 })
  }

  const mf = await db.mediaFile.findUnique({ where: { id } })
  if (!mf) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  // path traversal guard: the stored name is generated server-side, but double check
  if (mf.path.includes('/') || mf.path.includes('..')) {
    logSec('block', 'files', `path traversal attempt on ${id}`)
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const filePath = path.join(UPLOAD_DIR, mf.path)
  let info
  try {
    info = await stat(filePath)
  } catch {
    return NextResponse.json({ ok: false, error: 'gone' }, { status: 410 })
  }

  const download = new URL(req.url).searchParams.get('download') === '1'
  /* Task 35 hardening — active content (SVG/HTML) can execute scripts when
     opened directly, so it is forced to download AND served with a sandboxed
     CSP. Everything else stays inline (images, audio, video previews). */
  const active = /^(image\/svg|text\/html|application\/xhtml)/.test(mf.mime)
  const disposition = `${active || download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(mf.name)}"`
  const baseHeaders: Record<string, string> = {
    'Content-Type': mf.mime,
    'Content-Disposition': disposition,
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400',
    ...(active ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
  }

  /* Range request — partial content so big media plays + seeks */
  const range = req.headers.get('range')
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0
    let end = m[2] ? parseInt(m[2], 10) : info.size - 1
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= info.size) {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${info.size}` },
      })
    }
    start = Math.max(0, start)
    end = Math.min(end, info.size - 1)
    const stream = createReadStream(filePath, { start, end })
    return new NextResponse(nodeToWeb(stream), {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${info.size}`,
        'Content-Length': String(end - start + 1),
      },
    })
  }

  /* full body — streamed straight from disk */
  const stream = createReadStream(filePath)
  return new NextResponse(nodeToWeb(stream), {
    headers: {
      ...baseHeaders,
      'Content-Length': String(info.size),
    },
  })
}

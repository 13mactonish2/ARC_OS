// POST /api/workspace/upload — UNLIMITED workspace ingest.
// NeoChat Workspaces carry ANY file — photos, video, sounds, audio, archives,
// disk images, anything — with NO size cap and NO media allowlist. The bytes
// are STREAMED straight to the vault (/home/z/.redsec-uploads, outside the
// repo so sandbox resets never wipe them): the request body never fully
// buffers in memory, so a 40 GB video costs ~40 KB of RAM while it lands.
//   headers:  x-ws-name (URI-encoded display name) · x-ws-mime (optional)
//   body:     raw file bytes
//   returns:  { ok, file: { id, name, mime, size, url } } — the id the
//             workspace API needs to register the entry row.
import { NextResponse } from 'next/server'
import { createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import path from 'path'
import { db } from '@/lib/db'
import { ensureUploadDir, UPLOAD_DIR } from '@/lib/server/uploads'
import { clientKey, rateLimit, tooMany, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SAFE_EXT = /^[a-z0-9]{1,12}$/i

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'ws-upload'), 30, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  if (!req.body) {
    return NextResponse.json({ ok: false, message: 'No file stream in the request.' }, { status: 400 })
  }

  const rawName = (() => {
    try {
      return decodeURIComponent(req.headers.get('x-ws-name') || 'file.bin').replace(/[\r\n"\\]/g, '').slice(0, 180)
    } catch {
      return 'file.bin'
    }
  })()
  const ext = rawName.match(/\.([a-z0-9]{1,12})$/i)?.[1] || ''
  const safeExt = ext && SAFE_EXT.test(ext) ? `.${ext.toLowerCase()}` : ''
  const stored = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${safeExt}`
  const mime = (() => {
    const m = req.headers.get('x-ws-mime') || req.headers.get('content-type') || ''
    return /^[\w.+-]+\/[\w.+-]+/.test(m) ? m.split(';')[0].trim() : 'application/octet-stream'
  })()

  await ensureUploadDir()
  const dest = path.join(UPLOAD_DIR, stored)

  let size = 0
  try {
    // stream the body to disk — memory stays flat no matter how big the file is
    const nodeStream = Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0])
    nodeStream.on('data', (chunk: Buffer) => {
      size += chunk.length
    })
    await pipeline(nodeStream, createWriteStream(dest))
  } catch (e) {
    logSec('warn', 'workspace', `stream upload failed: ${e instanceof Error ? e.message : 'error'}`)
    return NextResponse.json({ ok: false, message: 'The upload stream failed — check the connection and retry.' }, { status: 500 })
  }

  if (size <= 0) {
    return NextResponse.json({ ok: false, message: 'The file arrived empty — nothing was stored.' }, { status: 400 })
  }

  try {
    const mf = await db.mediaFile.create({
      data: {
        name: rawName || stored,
        mime,
        size,
        path: stored,
        source: 'workspace',
      },
    })
    logSec('allow', 'workspace', `unlimited upload ${size}B as ${mf.id} (${mime})`)
    return NextResponse.json({
      ok: true,
      file: {
        id: mf.id,
        name: mf.name,
        mime: mf.mime,
        size: mf.size,
        url: `/api/files/${mf.id}`,
      },
    })
  } catch {
    return NextResponse.json({ ok: false, message: 'The file landed but could not be registered.' }, { status: 500 })
  }
}

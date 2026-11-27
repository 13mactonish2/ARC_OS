// POST /api/upload — the InterCore media vault ingest endpoint.
// Chat (NeoChat), mail and call snapshots all upload through here:
// multipart/form-data { file, source } → stored OUTSIDE the repo tree
// (/home/z/.redsec-uploads, so sandbox resets never wipe chat photos)
// and registered as a MediaFile row. The response carries the id the
// chat pipeline needs to render + download the attachment.
import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { ensureUploadDir, UPLOAD_DIR } from '@/lib/server/uploads'
import { clientKey, rateLimit, tooMany, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

const MAX_BYTES = 50 * 1024 * 1024 // 50 MB hard cap (chat media cap 25 MB, workspaces 50 MB)

const SAFE_EXT = /^[a-z0-9]{1,8}$/i

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'upload'), 60, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  try {
    const form = await req.formData()
    const file = form.get('file')
    const source = String(form.get('source') || 'manual')
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: 'No file in the request.' }, { status: 400 })
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, message: `File must be between 1 byte and ${MAX_BYTES / 1048576} MB.` }, { status: 400 })
    }

    // sanitize the stored name: keep the human name for display, generate a
    // safe filename server-side (path traversal can never happen)
    const rawName = (file.name || 'upload.bin').replace(/[\r\n"\\]/g, '').slice(0, 120)
    const ext = rawName.match(/\.([a-z0-9]{1,8})$/i)?.[1] || ''
    const safeExt = ext && SAFE_EXT.test(ext) ? `.${ext.toLowerCase()}` : ''
    const stored = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${safeExt}`

    const mime = /^[\w.+-]+\/[\w.+-]+$/.test(file.type || '') ? file.type : 'application/octet-stream'

    await ensureUploadDir()
    const buf = Buffer.from(await file.arrayBuffer())
    await writeFile(path.join(UPLOAD_DIR, stored), buf)

    const mf = await db.mediaFile.create({
      data: {
        name: rawName || stored,
        mime,
        size: buf.length,
        path: stored,
        source: ['chat', 'mail', 'call', 'manual', 'workspace'].includes(source) ? source : 'manual',
      },
    })

    logSec('allow', 'upload', `${source} ${buf.length}B as ${mf.id}`)
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
  } catch (e) {
    logSec('warn', 'upload', e instanceof Error ? e.message : 'upload failed')
    return NextResponse.json({ ok: false, message: 'Upload failed on the server.' }, { status: 500 })
  }
}

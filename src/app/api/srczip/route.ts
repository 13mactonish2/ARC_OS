import { NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

// Streams the complete REDSEC OS source snapshot (public/redsec-src.zip)
// as a downloadable archive. Rebuilt on demand from the live project tree.
export async function GET() {
  try {
    const zipPath = path.join(process.cwd(), 'public', 'redsec-src.zip')
    const st = await stat(zipPath)
    const data = await readFile(zipPath)
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(st.size),
        'Content-Disposition': 'attachment; filename="REDSEC-OS-source.zip"',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Source snapshot not found. Run the packaging step to regenerate public/redsec-src.zip.' },
      { status: 404 }
    )
  }
}

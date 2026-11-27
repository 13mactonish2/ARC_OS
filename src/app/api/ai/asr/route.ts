// REDSEC 5.0 — AI Voice backend: Speech-to-Text (z-ai ASR)
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

let zaiPromise: Promise<Awaited<ReturnType<typeof import('z-ai-web-dev-sdk').default.create>>> | null = null
async function getZAI() {
  if (!zaiPromise) {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    zaiPromise = ZAI.create()
  }
  return zaiPromise
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { audio?: string }
    const audio = typeof body.audio === 'string' ? body.audio : ''
    if (!audio) return NextResponse.json({ error: 'audio (base64) is required' }, { status: 400 })
    // hard cap ~20 MB of base64 to keep the route safe
    if (audio.length > 20 * 1024 * 1024) return NextResponse.json({ error: 'audio too large (max ~15MB)' }, { status: 413 })

    const zai = await getZAI()
    const res = await zai.audio.asr.create({ file_base64: audio })
    const text = (res?.text || '').trim()
    return NextResponse.json({ text })
  } catch (err) {
    console.error('ASR route error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'transcription failed' }, { status: 500 })
  }
}

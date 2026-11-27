// REDSEC 5.0 — AI Voice backend: Text-to-Speech (z-ai TTS) → wav binary
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 120

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
    const body = (await req.json()) as { text?: string; voice?: string; speed?: number }
    const text = (body.text || '').trim()
    if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 })
    // API hard limit is 1024 chars per request — clamp to a safe slice
    const input = text.slice(0, 1000)
    const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : 'tongtong'
    const speed = Math.min(2, Math.max(0.5, Number(body.speed) || 1))

    const zai = await getZAI()
    const res = await zai.audio.tts.create({
      input,
      voice,
      speed,
      response_format: 'wav',
      stream: false,
    })

    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(new Uint8Array(arrayBuffer))
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('TTS route error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'tts failed' }, { status: 500 })
  }
}

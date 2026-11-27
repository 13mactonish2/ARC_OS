// REDSEC 6.0 — BlueStringRay-N1 backend: LLM chat completion (z-ai grid)
// Task 62 — always requests the LATEST generation model first, with an
// automatic fallback chain + one retry on transient grid failures.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 120

type Msg = { role: 'user' | 'assistant'; content: string }

/* Latest → proven fallback. The grid serves the first model it has; when a
   newer generation lands, it is picked up by simply leading the chain. */
const MODEL_CHAIN = ['glm-4.6', 'glm-4.5', 'glm-4-plus'] as const

let zaiPromise: Promise<Awaited<ReturnType<typeof import('z-ai-web-dev-sdk').default.create>>> | null = null
async function getZAI() {
  if (!zaiPromise) {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    zaiPromise = ZAI.create()
  }
  return zaiPromise
}

function isTransient(err: unknown): boolean {
  const msg = String((err as Error)?.message || err || '')
  return /\b(429|5\d\d|timeout|ECONN|ENOTFOUND|fetch failed|network)\b/i.test(msg)
}

async function completeOnGrid(messages: { role: 'assistant' | 'user'; content: string }[]): Promise<string> {
  const zai = await getZAI()
  let lastErr: unknown = null
  /* walk the model chain, newest first */
  for (const model of MODEL_CHAIN) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const completion = await zai.chat.completions.create({
          model,
          messages,
          thinking: { type: 'disabled' },
        })
        const reply = completion?.choices?.[0]?.message?.content?.trim() || ''
        if (reply) return reply
        lastErr = new Error('empty reply')
      } catch (err) {
        lastErr = err
      }
      /* only retry transient failures (rate limit / 5xx / network) */
      if (!isTransient(lastErr)) break
      if (attempt === 0) await new Promise((r) => setTimeout(r, 700))
    }
  }
  throw lastErr || new Error('inference grid unavailable')
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { messages?: Msg[]; system?: string }
    const history = Array.isArray(body.messages) ? body.messages.slice(-16) : []
    if (history.length === 0) return NextResponse.json({ error: 'messages required' }, { status: 400 })

    const messages: { role: 'assistant' | 'user'; content: string }[] = [
      {
        role: 'assistant',
        content:
          body.system ||
          'You are Nova, the built-in AI voice assistant of the REDSEC 6.0 desktop OS (a fully proprietary REDSEC web desktop). ' +
            'Answers are spoken aloud through text-to-speech, so keep them SHORT (1-4 sentences), natural and conversational. ' +
            'No markdown, no bullet points, no emoji, no code blocks unless explicitly asked — plain spoken sentences only. ' +
            'If asked what you can do, mention: answering questions, opening installed apps by voice, telling time and date, and general help.',
      },
      ...history.map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 4000) })),
    ]

    const reply = await completeOnGrid(messages)
    return NextResponse.json({ reply })
  } catch (err) {
    console.error('chat route error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'chat failed' }, { status: 500 })
  }
}

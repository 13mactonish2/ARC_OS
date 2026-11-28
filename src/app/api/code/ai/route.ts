// REDSEC v5.0 — Task 26d: /api/code/ai : OpenCode built-in AI coding assistant
// Backend-only chat completions via z-ai-web-dev-sdk (same pattern as the
// REDSEC AI voice route: module-level singleton, thinking disabled, last-16
// history). Returns {ok, content} or {ok:false, error} — always application/json.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 120

type Msg = { role: 'user' | 'assistant'; content: string }

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
    const body = (await req.json()) as { messages?: Msg[] }
    const history = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-16)
    if (history.length === 0) {
      return NextResponse.json({ ok: false, error: 'messages required' }, { status: 400 })
    }

    const messages: { role: 'assistant' | 'user'; content: string }[] = [
      {
        role: 'assistant',
        content:
          'You are the built-in AI coding assistant inside OpenCode, the code IDE of the REDSEC 5.0 desktop OS. ' +
            'You are an expert programmer across 60+ languages (Python, JavaScript/TypeScript, C/C++/C#, Java, Go, Rust, Ruby, PHP, Swift, Kotlin, Haskell, and more). ' +
            'Give concise, correct, production-grade answers: diagnose bugs, explain code line by line when asked, and always put code inside fenced markdown blocks with the language tag (```python … ```). ' +
            'Keep prose short and practical — no filler, no unnecessary disclaimers. If the user pastes code, assume it runs inside OpenCode and they want it fixed, explained or improved.',
      },
      ...history.map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 6000) })),
    ]

    const zai = await getZAI()
    const completion = await zai.chat.completions.create({
      messages,
      thinking: { type: 'disabled' },
    })

    const content = completion?.choices?.[0]?.message?.content?.trim() || ''
    if (!content) {
      return NextResponse.json({ ok: false, error: 'The AI returned an empty reply — try again.' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, content })
  } catch (err) {
    console.error('opencode ai error:', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'AI request failed' }, { status: 500 })
  }
}

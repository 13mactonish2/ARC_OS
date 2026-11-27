// REDSEC v5.0 — OpenCode AI chat bot backend (Task 26)
// POST { messages: [{role: 'user'|'assistant', content}], context? } → { ok, reply }
// Hardened: input sanitization, retries with backoff, hard timeout, never 5xx-crashes the UI.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are OpenCode AI — the built-in coding assistant of the OpenCode IDE inside the RedSec OS.
Rules:
- Be concise, correct and friendly. Get straight to the answer.
- You can help with ALL programming languages: Python, Java, C, C++, C#, Go, Rust, Ruby, Kotlin, Swift, Scala, Dart, TypeScript, Lua, Perl, R, Haskell, Erlang, Elixir, Fortran, Bash, Lisp, Racket, Assembly, HTML5, CSS3, JavaScript, React, Angular, VueJS, NodeJS, Express, NestJS, Fastify, Django, Flask, FastAPI, Streamlit, Spring Boot, SQL (MySQL/PostgreSQL/PL-SQL), MongoDB, Redis, Verilog, VHDL.
- When you show code, use fenced code blocks with the language tag.
- When asked to fix code, first name the bug in one line, then give the corrected code.
- Never claim to run code yourself — the user can press the Run button in OpenCode.`

interface ChatMsg {
  role: string
  content: string
}

function sanitize(messages: unknown): ChatMsg[] {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m): m is ChatMsg => !!m && typeof m === 'object' && typeof (m as ChatMsg).content === 'string')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, 8000),
    }))
    .slice(-16)
}

async function askZAI(messages: ChatMsg[], context: string): Promise<string> {
  const { default: ZAI } = await import('z-ai-web-dev-sdk')
  const zai = await ZAI.create()
  const payload: Array<{ role: 'assistant' | 'user'; content: string }> = [
    { role: 'assistant', content: context ? `${SYSTEM_PROMPT}\n\nCurrent editor context:\n${context.slice(0, 6000)}` : SYSTEM_PROMPT },
    ...messages.map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content })),
  ]
  const completion = await zai.chat.completions.create({
    messages: payload,
    thinking: { type: 'disabled' },
  })
  const reply = completion?.choices?.[0]?.message?.content ?? ''
  if (!reply.trim()) throw new Error('empty reply')
  return reply
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { messages?: unknown; context?: unknown }
    const messages = sanitize(body.messages)
    const context = typeof body.context === 'string' ? body.context : ''
    const last = [...messages].reverse().find((m) => m.role === 'user')
    if (!last || !last.content.trim()) {
      return NextResponse.json({ ok: false, error: 'Type a question first' }, { status: 400 })
    }

    let reply = ''
    let lastErr: unknown = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        reply = await Promise.race([
          askZAI(messages, context),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('AI timeout')), 90_000)),
        ])
        break
      } catch (e) {
        lastErr = e
        if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt))
      }
    }
    if (!reply.trim()) {
      const msg = lastErr instanceof Error ? lastErr.message : 'unknown error'
      return NextResponse.json({ ok: false, error: `The AI service didn't respond (retried 3×). ${msg}` })
    }
    return NextResponse.json({ ok: true, reply })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: `AI chat error: ${msg}` })
  }
}

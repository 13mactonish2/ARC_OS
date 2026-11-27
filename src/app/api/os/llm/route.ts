// REDSEC v5.0 — Task 26: OpenCode AI chat backend (z-ai-web-dev-sdk, server-only).
// Multi-turn chat completions with strict input sanitation — the client shows a
// friendly bubble on failure, so the chat never crashes the app.
import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SYSTEM = `You are OpenCode AI, the built-in coding assistant of the REDSEC OpenCode IDE.
You help with ANY programming language (Python, Java, C/C++, C#, Go, Rust, Ruby, Kotlin, Swift, Scala, Dart, TypeScript, Lua, Perl, R, Haskell, Erlang, Elixir, Fortran, Bash, Lisp, Racket, Assembly, HTML/CSS/JS, React, Angular, Vue, Node, Express, NestJS, Fastify, Django, Flask, FastAPI, Streamlit, Spring Boot, MySQL, PostgreSQL, MongoDB, PL/SQL, Redis, Verilog, VHDL).
Rules: be concise and practical; always format code in fenced blocks with the language tag; when asked to fix code, return the corrected full snippet; never invent APIs; if unsure, say what to check. Answer in the user's language.`

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { messages?: unknown } | null
    const raw = Array.isArray(body?.messages) ? body.messages : null
    if (!raw || raw.length === 0) {
      return NextResponse.json({ ok: false, error: 'messages array required' }, { status: 400 })
    }
    // keep only the last 16 turns, sanitize roles/content, cap sizes
    const clean = raw
      .slice(-16)
      .map((m): { role: 'user' | 'assistant'; content: string } => {
        const msg = m as { role?: unknown; content?: unknown }
        return {
          role: msg?.role === 'user' ? 'user' : 'assistant',
          content: String(msg?.content ?? '').slice(0, 8000),
        }
      })
      .filter((m) => m.content.trim().length > 0)
    if (!clean.length || clean[clean.length - 1].role !== 'user') {
      return NextResponse.json({ ok: false, error: 'last message must be from the user' }, { status: 400 })
    }

    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [{ role: 'assistant', content: SYSTEM }, ...clean],
      thinking: { type: 'disabled' },
    })
    const reply = completion?.choices?.[0]?.message?.content ?? ''
    if (!reply.trim()) throw new Error('empty reply from the model')
    return NextResponse.json({ ok: true, reply })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI request failed'
    // 200 + ok:false so the client renders a graceful chat bubble instead of an error screen
    return NextResponse.json({ ok: false, error: msg })
  }
}

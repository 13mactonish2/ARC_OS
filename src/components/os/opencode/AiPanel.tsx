// REDSEC v5.0 — Task 26: OpenCode AI assistant panel.
// Talks to POST /api/os/llm (server-only SDK). Renders a defensive
// markdown-lite (fenced code blocks + copy, inline code, bold, dash lists).
// The chat can never crash the IDE — every render path has a fallback.
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Copy, Eraser, Send, Sparkles } from 'lucide-react'

export interface AiMsg {
  role: 'user' | 'assistant'
  content: string
}

const AI_ERROR = '⚠ AI is unavailable right now — please try again in a moment.'

export interface CodeCtx {
  name: string
  langName: string
  code: string
}

/* ---------------- markdown-lite (defensive) ---------------- */

function inline(s: string, keyBase: string): React.ReactNode[] {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((p, i) => {
    const key = `${keyBase}-${i}`
    try {
      if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={key}>{p.slice(2, -2)}</strong>
      if (p.startsWith('`') && p.endsWith('`') && p.length > 2)
        return (
          <code key={key} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[11px] text-sky-300">
            {p.slice(1, -1)}
          </code>
        )
    } catch {
      /* fall through */
    }
    return <React.Fragment key={key}>{p}</React.Fragment>
  })
}

function renderMd(text: string): React.ReactNode {
  try {
    if (typeof text !== 'string') return <span>{String(text)}</span>
    const chunks = text.split('```')
    const out: React.ReactNode[] = []
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      if (i % 2 === 1) {
        // fenced code — first line may be a language tag
        let body = chunk
        const nl = body.indexOf('\n')
        const first = nl === -1 ? body : body.slice(0, nl)
        if (/^[\w+#-]{1,20}$/.test(first.trim())) body = nl === -1 ? '' : body.slice(nl + 1)
        out.push(
          <div key={`code-${i}`} className="relative my-1.5 overflow-hidden rounded-lg border border-white/10 bg-[#0b0f16]">
            <div className="flex items-center justify-between border-b border-white/10 px-2 py-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-slate-500">{(first.trim() || 'code').slice(0, 16)}</span>
              <button
                type="button"
                onClick={() => {
                  try {
                    void navigator.clipboard?.writeText(body)
                  } catch {
                    /* ignore */
                  }
                }}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-slate-200"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
            <pre className="max-h-64 overflow-auto os-scroll px-3 py-2 font-mono text-[11px] leading-[18px] text-sky-200/90" style={{ whiteSpace: 'pre' }}>
              {body}
            </pre>
          </div>
        )
      } else if (chunk) {
        const lines = chunk.split('\n')
        let list: string[] = []
        const flush = (key: string) => {
          if (!list.length) return
          out.push(
            <ul key={key} className="my-1 list-disc space-y-0.5 pl-4">
              {list.map((li, j) => (
                <li key={j}>{inline(li, `${key}-${j}`)}</li>
              ))}
            </ul>
          )
          list = []
        }
        for (let ln = 0; ln < lines.length; ln++) {
          const line = lines[ln]
          if (/^\s*[-*]\s+/.test(line)) {
            list.push(line.replace(/^\s*[-*]\s+/, ''))
          } else {
            flush(`ul-${i}-${ln}`)
            if (line.trim()) out.push(<div key={`t-${i}-${ln}`}>{inline(line, `t-${i}-${ln}`)}</div>)
          }
        }
        flush(`ul-${i}-end`)
      }
    }
    return <>{out}</>
  } catch {
    return <span className="whitespace-pre-wrap">{String(text)}</span>
  }
}

/* ---------------- the panel ---------------- */

const QUICK = [
  { label: 'Explain code', prefix: (ctx: CodeCtx) => `Explain what this ${ctx.langName} file does, step by step:\n\n\`\`\`\n${ctx.code}\n\`\`\`` },
  { label: 'Find bugs', prefix: (ctx: CodeCtx) => `Find bugs and potential issues in this ${ctx.langName} file. List each problem with a fix:\n\n\`\`\`\n${ctx.code}\n\`\`\`` },
  { label: 'Add comments', prefix: (ctx: CodeCtx) => `Add helpful comments to this ${ctx.langName} file and return the full commented code:\n\n\`\`\`\n${ctx.code}\n\`\`\`` },
]

export default function AiPanel({ getCodeCtx }: { getCodeCtx: () => CodeCtx | null }) {
  const [msgs, setMsgs] = useState<AiMsg[]>([
    { role: 'assistant', content: 'Hi — I am OpenCode AI. Ask me anything about the file you are editing, or use a quick action below.' },
  ])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const el = listRef.current
      if (el) el.scrollTop = el.scrollHeight
    } catch {
      /* ignore */
    }
  }, [msgs, pending])

  const send = async (text: string) => {
    const t = text.trim()
    if (!t || pending) return
    const next: AiMsg[] = [...msgs, { role: 'user', content: t }]
    setMsgs(next)
    setInput('')
    setPending(true)
    try {
      const res = await fetch('/api/os/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.slice(-16) }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; reply?: string } | null
      if (data && data.ok && typeof data.reply === 'string' && data.reply.trim()) {
        setMsgs((m) => [...m, { role: 'assistant', content: data.reply as string }])
      } else {
        setMsgs((m) => [...m, { role: 'assistant', content: AI_ERROR }])
      }
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: AI_ERROR }])
    } finally {
      setPending(false)
    }
  }

  return (
    <aside className="flex w-[340px] flex-none flex-col border-l border-white/10 bg-[#10141f]">
      <div className="flex h-10 flex-none items-center gap-2 border-b border-white/10 px-3">
        <Sparkles className="h-4 w-4 text-orange-400" />
        <span className="text-xs font-semibold text-slate-200">OpenCode AI</span>
        <button
          type="button"
          onClick={() => setMsgs([{ role: 'assistant', content: 'Cleared. What would you like to work on next?' }])}
          className="ml-auto flex h-7 items-center gap-1 rounded-md bg-white/5 px-2 text-[10px] text-slate-300 hover:bg-white/10"
          title="Clear conversation"
        >
          <Eraser className="h-3 w-3" /> Clear
        </button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto os-scroll p-3">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[92%] rounded-xl px-3 py-2 text-[11.5px] leading-relaxed ${
                m.role === 'user' ? 'bg-sky-600/25 text-sky-50' : 'bg-white/[0.06] text-slate-200'
              }`}
            >
              {m.role === 'user' ? <span className="whitespace-pre-wrap break-words">{m.content}</span> : renderMd(m.content)}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-xl bg-white/[0.06] px-3 py-2.5" aria-label="AI is typing">
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" style={{ animationDelay: `${d * 160}ms` }} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-none flex-wrap gap-1.5 px-3 pb-2">
        {QUICK.map((q) => (
          <button
            key={q.label}
            type="button"
            disabled={pending}
            onClick={() => {
              const ctx = getCodeCtx()
              if (!ctx) return
              void send(q.prefix(ctx))
            }}
            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            {q.label}
          </button>
        ))}
      </div>

      <div className="flex flex-none items-end gap-2 border-t border-white/10 p-2.5">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(input)
            }
          }}
          rows={2}
          placeholder="Ask OpenCode AI…"
          aria-label="Message OpenCode AI"
          className="max-h-24 min-h-[38px] flex-1 resize-none rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-[11.5px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-orange-500/40"
        />
        <button
          type="button"
          onClick={() => void send(input)}
          disabled={pending || !input.trim()}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-orange-500 text-white transition-colors hover:bg-orange-400 disabled:opacity-40"
          title="Send (Enter)"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </aside>
  )
}

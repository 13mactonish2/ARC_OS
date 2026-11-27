// /api/store/classify — Open Store upgrade: a pasted link is CLASSIFIED as an
// APP or a GAME before install. Games get the FPS overlay + benchmark suite
// (both user-toggleable). Uses the z-ai LLM with a deterministic keyword
// fallback, so classification still works if the AI core is unreachable.
import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const dynamic = 'force-dynamic'

const GAME_HINTS = /\b(game|games|gaming|play|playable|arcade|io\b|puzzle|rpg|shooter|fps|mmorpg|roguelike|platformer|strategy|chess|sudoku|solitaire|tetris|snake|minecraft|roblox|steam|itch\.io|gamejolt|crazygames|poki|y8|miniclip|kongregate|battle|arena|quest|dungeon|mmo|esports)/i
const APP_HINTS = /\b(tool|tools|editor|converter|docs|document|office|mail|calendar|notes|todo|dev|sdk|github|gitlab|search|news|shop|store|bank|cloud|drive|analytics|dashboard|compiler|calculator|weather|map|maps|chat|messenger|social|network|design|photo|video|music|stream|learn|course|wiki|encyclopedia)/i

function heuristic(hay: string): { type: 'app' | 'game'; genre: string; confidence: number } {
  const g = GAME_HINTS.test(hay)
  const a = APP_HINTS.test(hay)
  if (g && !a) return { type: 'game', genre: guessGenre(hay), confidence: 0.72 }
  if (a && !g) return { type: 'app', genre: guessAppGenre(hay), confidence: 0.72 }
  if (g && a) return { type: 'game', genre: guessGenre(hay), confidence: 0.58 }
  return { type: 'app', genre: 'web app', confidence: 0.5 }
}

function guessGenre(hay: string): string {
  if (/shooter|fps|battle|arena/i.test(hay)) return 'action / shooter'
  if (/puzzle|sudoku|solitaire|2048/i.test(hay)) return 'puzzle'
  if (/rpg|mmo|quest|dungeon/i.test(hay)) return 'RPG / MMO'
  if (/platformer|jump|runner/i.test(hay)) return 'platformer'
  if (/strategy|tower|defense/i.test(hay)) return 'strategy'
  return 'arcade'
}

function guessAppGenre(hay: string): string {
  if (/docs|document|office|word/i.test(hay)) return 'productivity'
  if (/photo|image|design/i.test(hay)) return 'photo & design'
  if (/video|stream|movie/i.test(hay)) return 'video'
  if (/music|audio|song/i.test(hay)) return 'music'
  if (/mail|calendar|todo|notes/i.test(hay)) return 'productivity'
  if (/dev|sdk|github|compiler|ide/i.test(hay)) return 'developer tools'
  if (/news|wiki|learn|course/i.test(hay)) return 'knowledge'
  return 'web tool'
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { url?: string; name?: string }
    const raw = String(body.url || '')
    const name = String(body.name || '')
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid url' }, { status: 400 })
    }

    const host = url.hostname.replace(/^www\./, '')
    const nice = name || host.split('.')[0]

    /* fast path — deterministic heuristics first (never blocks install) */
    const heur = heuristic(`${host}/${url.pathname} ${nice}`)

    /* AI path — enrich when the neural core answers quickly */
    try {
      const zai = await ZAI.create()
      const completion = await zai.chat.completions.create({
        messages: [
          {
            role: 'assistant',
            content:
              'You classify a website link for an operating system app store. Answer with STRICT JSON only, no markdown: {"type":"app"|"game","genre":"short genre label","summary":"one sentence (max 90 chars)","confidence":0..1}. A GAME is a playable/entertainment experience. Anything else (tools, social, media, docs, shopping, portals) is an APP.',
          },
          { role: 'user', content: `URL: ${url.toString()}\nProposed name: ${nice}` },
        ],
        thinking: { type: 'disabled' },
      })
      const txt = completion.choices[0]?.message?.content || ''
      const m = txt.match(/\{[\s\S]*\}/)
      if (m) {
        const parsed = JSON.parse(m[0]) as { type?: string; genre?: string; summary?: string; confidence?: number }
        if (parsed.type === 'game' || parsed.type === 'app') {
          return NextResponse.json({
            ok: true,
            type: parsed.type,
            genre: (parsed.genre || (parsed.type === 'game' ? 'arcade' : 'web app')).slice(0, 40),
            summary: (parsed.summary || '').slice(0, 120),
            confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.8,
            engine: 'ai',
          })
        }
      }
    } catch {
      /* AI unreachable — fall through to heuristic */
    }

    return NextResponse.json({ ok: true, ...heur, summary: '', engine: 'heuristic' })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'classify failed' }, { status: 500 })
  }
}

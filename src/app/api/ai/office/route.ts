// REDSEC — /api/ai/office : real AI endpoint for the Open Suite office apps
// (Sheet · Word · Presentation). Every "smart" office feature (Translate,
// Thesaurus, Smart Lookup, Define) calls THIS single route — backend-only
// z-ai-web-dev-sdk completions, same singleton pattern as /api/code/ai.
// POST { mode, text, target? } → { ok, result?, data?, error? }
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 120

type Mode = 'translate' | 'thesaurus' | 'define' | 'lookup'

let zaiPromise: Promise<Awaited<ReturnType<typeof import('z-ai-web-dev-sdk').default.create>>> | null = null
async function getZAI() {
  if (!zaiPromise) {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    zaiPromise = ZAI.create()
  }
  return zaiPromise
}

const LANGS: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
  nl: 'Dutch', ru: 'Russian', zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean',
  ar: 'Arabic', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada',
  bn: 'Bengali', ur: 'Urdu', tr: 'Turkish', id: 'Indonesian', vi: 'Vietnamese',
}

function clip(s: string, n: number): string {
  return String(s || '').slice(0, n)
}

function systemFor(mode: Mode, target?: string): string {
  if (mode === 'translate') {
    const lang = LANGS[(target || 'en').toLowerCase()] || 'English'
    return 'You are the translation engine of the REDSEC office suite. Translate the user text into ' + lang +
      ' with natural, professional phrasing. Return ONLY the translated text — no quotes, no explanation, no language name. ' +
      'Preserve line breaks and numbers exactly. If the text is already in ' + lang + ', still return it unchanged in ' + lang + '.'
  }
  if (mode === 'thesaurus') {
    return 'You are the thesaurus service of the REDSEC office suite. Reply with STRICT JSON only, no markdown fences: ' +
      '{"word":"the word","synonyms":["up to 10 synonyms, best first"],"antonyms":["up to 6"],"note":"one short usage note"}. ' +
      'If the input is a phrase, give synonyms for its dominant sense.'
  }
  if (mode === 'define') {
    return 'You are the dictionary service of the REDSEC office suite. Reply with STRICT JSON only, no markdown fences: ' +
      '{"word":"...","partOfSpeech":"noun|verb|...","definitions":["up to 3 concise definitions"],"example":"one usage sentence"}.'
  }
  return 'You are the Smart Lookup research assistant of the REDSEC office suite. Summarise the user topic in a compact encyclopedic way: ' +
    '2-3 short factual paragraphs, then a "Key facts" bullet list (max 6 bullets). No preamble, no disclaimer. If the topic looks like a person, place, company, technology or concept, cover what it is and why it matters.'
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { mode?: string; text?: string; target?: string }
    const mode = (body.mode || 'lookup') as Mode
    const text = clip(body.text || '', 6000).trim()
    if (!text) return NextResponse.json({ ok: false, error: 'text required' }, { status: 400 })
    if (!['translate', 'thesaurus', 'define', 'lookup'].includes(mode)) {
      return NextResponse.json({ ok: false, error: 'unknown mode' }, { status: 400 })
    }

    const zai = await getZAI()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemFor(mode, body.target) },
        { role: 'user', content: mode === 'translate' ? text : clip(text, 300) },
      ],
      thinking: { type: 'disabled' },
    })

    const raw = completion?.choices?.[0]?.message?.content?.trim() || ''
    if (!raw) return NextResponse.json({ ok: false, error: 'The AI returned an empty reply — try again.' }, { status: 502 })

    if (mode === 'thesaurus' || mode === 'define') {
      // robust JSON extraction (model may wrap in fences)
      const m = /\{[\s\S]*\}/.exec(raw)
      let data: unknown = null
      if (m) {
        try { data = JSON.parse(m[0]) } catch { data = null }
      }
      if (!data) {
        // graceful fallback — treat whole reply as a synonym / definition list
        data = mode === 'thesaurus'
          ? { word: text, synonyms: raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 10), antonyms: [], note: '' }
          : { word: text, partOfSpeech: '', definitions: [raw.slice(0, 400)], example: '' }
      }
      return NextResponse.json({ ok: true, mode, data })
    }

    return NextResponse.json({ ok: true, mode, result: raw })
  } catch (err) {
    console.error('office ai error:', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'AI request failed' }, { status: 500 })
  }
}

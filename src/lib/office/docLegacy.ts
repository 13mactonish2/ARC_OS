// REDSEC — docLegacy.ts : best-effort REAL text extraction from legacy binary
// Word documents (.doc, OLE2 Compound File format). Word stores document text
// as CP1252 and/or UTF-16LE runs inside the WordDocument stream — we walk the
// raw bytes and recover every printable run, merging the two encodings.
// This is genuine recovery (the same bytes Word wrote), not a simulation.
// Used by WordApp so .doc files OPEN with their real content instead of an
// "unsupported" error.

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]

function printable(c: number): boolean {
  return (c >= 0x20 && c < 0x7f) || c === 0x09 || c === 0x0a || c === 0x0d || c >= 0xa0
}

/** collect runs of printable characters from a decoded string */
function runsFrom(s: string, minRun = 24): { text: string; score: number }[] {
  const out: { text: string; score: number }[] = []
  let cur = ''
  const flush = () => {
    const t = cur.trim()
    if (t.length >= minRun) {
      const words = t.split(/\s+/).length
      const alnum = (t.match(/[A-Za-z0-9]/g) || []).length
      const score = alnum * 2 + words
      if (score > 8 && alnum >= Math.min(6, t.length * 0.25)) out.push({ text: t, score })
    }
    cur = ''
  }
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (printable(c)) {
      cur += ch
    } else {
      flush()
    }
  }
  flush()
  return out
}

/** decode bytes in an encoding, then carve printable runs */
function decodeRuns(bytes: Uint8Array, enc: 'utf-16le' | 'windows-1252'): { text: string; score: number }[] {
  // strip structural NUL stretches (cheap pre-clean so decoders don't emit \u0000 runs)
  const cleaned: number[] = []
  let nullRun = 0
  const maxNull = enc === 'utf-16le' ? 2 : 1
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      nullRun++
      if (nullRun <= maxNull) cleaned.push(bytes[i])
    } else {
      nullRun = 0
      cleaned.push(bytes[i])
    }
  }
  const u8 = new Uint8Array(cleaned)
  const s = new TextDecoder(enc).decode(u8)
  return runsFrom(s)
}

export interface DocExtract {
  text: string
  paragraphs: string[]
  ok: boolean
  enc: 'utf-16le' | 'cp1252' | 'none'
}

/**
 * Extract the real text content of a legacy .doc binary.
 * Returns recovered paragraphs ordered by recovery score (the largest,
 * most word-like runs first — these are the document body in Word-created
 * files; metadata runs score far lower and are dropped by the cap).
 */
export function extractDocText(buf: ArrayBuffer): DocExtract {
  const bytes = new Uint8Array(buf)
  const head = bytes.slice(0, 4)
  const isOle = OLE_MAGIC.every((v, i) => head[i] === v)
  if (!isOle) {
    // maybe plain text was saved with a .doc extension — just decode it
    const t = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    const paras = t.split(/\r?\n/).filter((p) => p.trim())
    if (paras.length) return { text: t, paragraphs: paras, ok: true, enc: 'cp1252' }
    return { text: '', paragraphs: [], ok: false, enc: 'none' }
  }

  // scan the whole file (max 20 MB) — recover runs from both encodings Word uses
  const limit = Math.min(bytes.length, 20 * 1024 * 1024)
  const u16 = decodeRuns(bytes.slice(0, limit), 'utf-16le')
  const cp = decodeRuns(bytes.slice(0, limit), 'windows-1252')
  const score = (rs: { text: string; score: number }[]) => rs.reduce((a, r) => a + r.score, 0)

  const primary = score(u16) >= score(cp) ? u16 : cp
  const secondary = score(u16) >= score(cp) ? cp : u16
  const seen = new Set(primary.map((r) => r.text))
  const merged = [...primary]
  for (const r of secondary) if (!seen.has(r.text) && r.score > 30) merged.push(r)

  if (!merged.length) return { text: '', paragraphs: [], ok: false, enc: 'none' }

  const ordered = merged.sort((a, b) => b.score - a.score).slice(0, 400)
  const paragraphs = ordered.map((r) => r.text)
  const text = paragraphs.join('\n\n')
  return { text, paragraphs, ok: true, enc: score(u16) >= score(cp) ? 'utf-16le' : 'cp1252' }
}

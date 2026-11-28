// REDSEC 5.0 — ooxml.ts — dependency-free .docx / .pptx text extraction.
// Reads the ZIP central directory directly and inflates members with the
// browser's native DecompressionStream('deflate-raw'), so real Word /
// PowerPoint files can be opened in the OS Word / Presentation apps without
// shipping a parser library.
'use client'

export interface ZipEntry {
  name: string
  method: number
  compSize: number
  offset: number
}

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

/** walk the ZIP central directory */
export function zipEntries(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  let eocd = -1
  const min = Math.max(0, buf.byteLength - 22 - 65535)
  for (let i = buf.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip archive')
  const count = view.getUint16(eocd + 10, true)
  let ptr = view.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const entries: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.byteLength || view.getUint32(ptr, true) !== CEN_SIG) break
    const method = view.getUint16(ptr + 10, true)
    const compSize = view.getUint32(ptr + 20, true)
    const nameLen = view.getUint16(ptr + 28, true)
    const extraLen = view.getUint16(ptr + 30, true)
    const commLen = view.getUint16(ptr + 32, true)
    const localOff = view.getUint32(ptr + 42, true)
    const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen))
    entries.push({ name, method, compSize, offset: localOff })
    ptr += 46 + nameLen + extraLen + commLen
  }
  return entries
}

/** inflate one member (method 0 stored / 8 deflate-raw) */
export async function zipRead(buf: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buf)
  const p = entry.offset
  if (p + 30 > buf.byteLength || view.getUint32(p, true) !== LOC_SIG) throw new Error('corrupt zip member')
  const nameLen = view.getUint16(p + 26, true)
  const extraLen = view.getUint16(p + 28, true)
  const start = p + 30 + nameLen + extraLen
  const raw = new Uint8Array(buf, start, entry.compSize)
  if (entry.method === 0) return raw
  if (entry.method !== 8) throw new Error('unsupported zip compression')
  if (typeof DecompressionStream === 'undefined') throw new Error('decompression unsupported in this browser')
  const stream = new Blob([raw as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
}
const decodeEntities = (s: string): string => s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] || m)

/** .docx → ordered paragraph texts from word/document.xml (<w:p> / <w:t>) */
export async function docxParagraphs(buf: ArrayBuffer): Promise<string[]> {
  const entries = zipEntries(buf)
  const doc = entries.find((e) => e.name === 'word/document.xml')
  if (!doc) throw new Error('not a .docx (word/document.xml missing)')
  const xml = new TextDecoder().decode(await zipRead(buf, doc))
  return xml
    .split(/<\/w:p>/)
    .map((para) =>
      [...para.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => decodeEntities(m[1])).join('')
    )
    .map((t) => t.trim())
    .filter(Boolean)
}

/* ---------- Task 73 — rich .docx → HTML extraction ----------
 * Keeps document STRUCTURE (headings, bulleted/numbered lists, bold, italic,
 * underline, quotes) instead of flattening everything to bare paragraphs, so
 * real Word files open in the Word app looking like the original. */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const wStyleOf = (para: string): string =>
  /<w:pStyle(?:\s[^>]*)?w:val="([^"]+)"/.exec(para)?.[1] || ''

const wIsList = (para: string): boolean => /<w:numPr\s*\/?>/.test(para)

/** runs of one paragraph → inline HTML (strong/em/u kept) */
function wRunsHtml(para: string): string {
  let out = ''
  for (const rm of para.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
    const r = rm[1]
    let txt = [...r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => decodeEntities(m[1])).join('')
    if (!txt) continue
    const bold = /<w:b\s*\/>/.test(r) || /<w:b(?:\s[^>]*w:val="(?:true|1|on)"[^>]*)\/?>/.test(r)
    const ital = /<w:i\s*\/>/.test(r) || /<w:i(?:\s[^>]*w:val="(?:true|1|on)"[^>]*)\/?>/.test(r)
    /* v7.0.3 — underline also arrives as <w:u w:val="single"/> (the docx library
       and Google export form); the bare <w:u/> test missed it */
    const und = /<w:u(?:\s[^>]*)?\/?>/.test(r) && !/<w:u(?:\s[^>]*w:val="(?:none|0|off)")/.test(r)
    txt = escapeHtml(txt)
    if (bold) txt = `<strong>${txt}</strong>`
    if (ital) txt = `<em>${txt}</em>`
    if (und) txt = `<u>${txt}</u>`
    out += txt
  }
  if (!out) {
    // rare: text outside <w:r> — grab any w:t so nothing is silently lost
    out = [...para.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => escapeHtml(decodeEntities(m[1]))).join('')
  }
  return out
}

/** .docx → structured HTML (h1–h4, ul/ol+li, blockquote, strong/em/u, p, TABLES) */
export async function docxToHtml(buf: ArrayBuffer): Promise<string> {
  const entries = zipEntries(buf)
  const doc = entries.find((e) => e.name === 'word/document.xml')
  if (!doc) throw new Error('not a .docx (word/document.xml missing)')
  const xml = new TextDecoder().decode(await zipRead(buf, doc))

  /* v7.0.2 — TABLES: w:tbl blocks were previously shredded by the paragraph
     splitter (their nested w:p produced garbage lines). Extract each table
     first, convert it to a real <table>, and splice it back in position. */
  const tablesHtml: string[] = []
  const xmlNoTables = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const rows: string[] = []
    for (const trm of tbl.matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)) {
      const cells: string[] = []
      for (const tcm of trm[1].matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)) {
        const cellText = [...tcm[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
          .map((m) => decodeEntities(m[1]))
          .join(' ')
          .trim()
        cells.push(`<td>${escapeHtml(cellText) || '&nbsp;'}</td>`)
      }
      if (cells.length) rows.push(`<tr>${cells.join('')}</tr>`)
    }
    tablesHtml.push(rows.length ? `<table>${rows.join('')}</table><p><br/></p>` : '')
    return `\u0000TBL${tablesHtml.length - 1}\u0000`
  })

  let html = ''
  let listOpen: 'ul' | 'ol' | null = null
  const closeList = () => {
    if (listOpen) {
      html += `</${listOpen}>`
      listOpen = null
    }
  }
  const emitParas = (chunk: string) => {
    for (const para of chunk.split(/<\/w:p>/)) {
      const body = wRunsHtml(para)
      if (!body.trim()) continue // spacing paragraph — skip, keeps lists tight
      const style = wStyleOf(para)
      const hm = /^heading([1-6])$/i.exec(style)
      if (/^title$/i.test(style)) {
        closeList()
        html += `<h1>${body}</h1>`
      } else if (hm) {
        closeList()
        const lvl = Math.min(4, Number(hm[1]))
        html += `<h${lvl}>${body}</h${lvl}>`
      } else if (/^subtitle$/i.test(style)) {
        closeList()
        html += `<h2>${body}</h2>`
      } else if (/^quote$|^blockquotation$/i.test(style)) {
        closeList()
        html += `<blockquote>${body}</blockquote>`
      } else if (wIsList(para)) {
        // numbered lists carry w:numPr too — numbering.xml would tell ul vs ol;
        // most real docs mix both, ul renders both safely.
        if (listOpen !== 'ul') {
          closeList()
          html += '<ul>'
          listOpen = 'ul'
        }
        html += `<li>${body}</li>`
      } else {
        closeList()
        html += `<p>${body}</p>`
      }
    }
  }
  /* paragraphs between placeholders, with each table at its original spot */
  const parts = xmlNoTables.split(/\u0000TBL\d+\u0000/)
  for (let i = 0; i < parts.length; i++) {
    emitParas(parts[i])
    if (i < tablesHtml.length && tablesHtml[i]) {
      closeList()
      html += tablesHtml[i]
    }
  }
  closeList()
  return html || '<p><br/></p>'
}

const slideNum = (name: string): number => Number(/slide(\d+)\.xml$/.exec(name)?.[1] || 0)

/** .pptx → slides in deck order: [{ title, body[] }] from ppt/slides/slideN.xml (<a:t> runs) */
export async function pptxSlides(buf: ArrayBuffer): Promise<Array<{ title: string; body: string[] }>> {
  const entries = zipEntries(buf)
  const slides = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
    .sort((a, b) => slideNum(a.name) - slideNum(b.name))
  if (!slides.length) throw new Error('not a .pptx (no slides found)')
  const out: Array<{ title: string; body: string[] }> = []
  for (const s of slides) {
    const xml = new TextDecoder().decode(await zipRead(buf, s))
    const runs = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
      .map((m) => decodeEntities(m[1]).trim())
      .filter(Boolean)
    if (!runs.length && /^ppt\/slides\/slide1\.xml$/.test(s.name)) continue // title-only cover keeps going
    out.push({ title: runs[0] || `Slide ${out.length + 1}`, body: runs.slice(1) })
  }
  return out
}

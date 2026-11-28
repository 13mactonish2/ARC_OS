// REDSEC v7.0 Black Sea — import-engine.ts — the Advanced Import Processing Unit.
// One real, dependency-free core that every Open Suite app (Word / Sheet /
// Presentation) routes ALL imports through for the Google + OpenDocument
// family, on top of the existing Microsoft OOXML path (ooxml.ts + SheetJS):
//
//   Microsoft   .docx .doc (OLE2) .xlsx .xls .csv …   → ooxml.ts / SheetJS
//   Google      .gdoc .gsheet .gslides (Drive pointer JSON)
//               .odt .odp (Google Takeout / Docs "Export as ODF")
//               .html (Google Docs "Download as HTML") → existing Word path
//   OpenDocument full .odt / .odp walkers (content.xml, automatic styles,
//               lists, tables, presentation pages)
//
// Every successful import is ALSO stashed into the OS virtual FS (Documents)
// so it instantly shows up in File Manager ▸ OS files, deduped by name+size.
'use client'

import { zipEntries, zipRead } from './ooxml'
import { fs } from './fs'

/* ================= engine stats ================= */

export interface ImportStats {
  format: string // "Excel workbook (.xlsx)"
  family: string // "Microsoft OOXML" | "Google Workspace" | "OpenDocument"
  parser: string // "SheetJS XLSX.read" | "ODF content.xml walker" …
  ms: number
  elements: string[] // ["2 sheets", "148 rows", "6 formulas"]
}

/** one-line engine report for notify() bodies — the "advanced processing unit" made visible */
export function engineLine(s: ImportStats): string {
  const el = s.elements.filter(Boolean).join(' · ')
  return `Import Engine ▸ ${s.format} ▸ ${s.parser}${el ? ` ▸ ${el}` : ''} ▸ ${s.ms}ms`
}

/* ================= shared XML helpers (same philosophy as ooxml.ts) ================= */

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'",
}
const decodeEntities = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos|#39|#[0-9]+|#x[0-9a-fA-F]+);/g, (m) => {
    if (ENTITIES[m]) return ENTITIES[m]
    const num = m.startsWith('&#x') ? parseInt(m.slice(3, -1), 16) : m.startsWith('&#') ? parseInt(m.slice(2, -1), 10) : NaN
    return Number.isFinite(num) ? String.fromCodePoint(num) : m
  })

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Balanced extractor/replacer for possibly-nested XML blocks (e.g.
 * <text:list> inside <text:list>). fn receives each top-level block and
 * returns its replacement text.
 */
function replaceBalanced(xml: string, tag: string, fn: (block: string) => string): string {
  const openRe = new RegExp(`<${tag}(?=[\\s>/])`, 'g')
  const closeRe = new RegExp(`</${tag}(?=[\\s>])`, 'g')
  let result = ''
  let pos = 0
  for (;;) {
    openRe.lastIndex = pos
    const m = openRe.exec(xml)
    if (!m) {
      result += xml.slice(pos)
      break
    }
    const start = m.index
    result += xml.slice(pos, start)
    // find the matching close, honouring nesting
    let depth = 1
    let scan = openRe.lastIndex
    for (;;) {
      closeRe.lastIndex = scan
      const c = closeRe.exec(xml)
      if (!c) {
        scan = xml.length
        break
      }
      openRe.lastIndex = c.index + c[0].length
      const o = openRe.exec(xml)
      if (o && o.index < c.index) {
        depth++
        scan = o.index + o[0].length
      } else {
        depth--
        scan = c.index + c[0].length
        if (depth === 0) break
      }
    }
    result += fn(xml.slice(start, scan))
    pos = scan
  }
  return result
}

/* ================= ODF (OpenDocument) — Google Takeout .odt / .odp ================= */

interface OdfSpanStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

/** automatic-styles → name → inline properties (fo:font-weight etc.) */
function parseOdfTextStyles(xml: string): Map<string, OdfSpanStyle> {
  const map = new Map<string, OdfSpanStyle>()
  for (const m of xml.matchAll(/<style:style\b([^>]*)>([\s\S]*?)<\/style:style>/g)) {
    const name = /style:name="([^"]+)"/.exec(m[1])?.[1]
    if (!name) continue
    const tp = /<style:text-properties\b([^>]*?)\/?>/.exec(m[2])?.[1] || ''
    if (!tp) continue
    map.set(name, {
      bold: /fo:font-weight="(?:bold|[6-9]\d\d)"/.test(tp),
      italic: /fo:font-style="italic"/.test(tp),
      underline: /style:text-underline-style="/.test(tp) && !/style:text-underline-style="none"/.test(tp),
    })
  }
  return map
}

/** leaf-level ODF fragment → safe HTML text (bold spans handled upstream) */
function odfPlainText(frag: string): string {
  const s = frag
    .replace(/<text:s\b[^>]*>/g, (t) => {
      const n = /text:c="(\d+)"/.exec(t)?.[1]
      return '\u0003'.repeat(n ? Number(n) + 1 : 2)
    })
    .replace(/<text:line-break\s*\/?>/g, '\u0001')
    .replace(/<text:tab\s*\/?>/g, '\u0002')
    .replace(/<[^>]+>/g, '')
    .replace(/\u0003/g, ' ')
  return decodeEntities(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u0001/g, '<br/>')
    .replace(/\u0002/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
}

/** inline ODF → HTML keeping bold / italic / underline from automatic styles */
function odfInline(frag: string, styles: Map<string, OdfSpanStyle>, depth = 0): string {
  if (depth > 8) return odfPlainText(frag)
  let out = ''
  let last = 0
  for (const m of frag.matchAll(/<text:span\b([^>]*)>([\s\S]*?)<\/text:span>/g)) {
    out += odfPlainText(frag.slice(last, m.index))
    const styleName = /text:style-name="([^"]+)"/.exec(m[1])?.[1] || ''
    const st = styles.get(styleName) || {}
    let inner = odfInline(m[2], styles, depth + 1)
    if (!inner) inner = ''
    if (st.bold) inner = `<strong>${inner}</strong>`
    if (st.italic) inner = `<em>${inner}</em>`
    if (st.underline) inner = `<u>${inner}</u>`
    out += inner
    last = m.index + m[0].length
  }
  out += odfPlainText(frag.slice(last))
  return out
}

/** ordered list? — the list's style lives in automatic-styles as text:list-style */
function odfListIsOrdered(listXml: string, fullXml: string): boolean {
  const styleName = /<text:list\b[^>]*text:style-name="([^"]+)"/.exec(listXml)?.[1]
  if (!styleName) return false
  const block = new RegExp(`<text:list-style[^>]*style:name="${styleName}"[\\s\\S]*?<\\/text:list-style>`).exec(fullXml)?.[0]
  return !!block && /<text:list-level-style-number\b/.test(block)
}

function odfListHtml(listXml: string, fullXml: string, styles: Map<string, OdfSpanStyle>): string {
  let inner = ''
  for (const itm of listXml.matchAll(/<text:list-item\b[^>]*>([\s\S]*?)<\/text:list-item>/g)) {
    // nested sub-lists first → they become a <ul> inside the <li>
    let nested = ''
    const stripped = replaceBalanced(itm[1], 'text:list', (nb) => {
      nested += odfListHtml(nb, fullXml, styles)
      return ''
    })
    const paras = [...stripped.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)]
      .map((p) => odfInline(p[1], styles))
      .filter((t) => t.replace(/<[^>]+>/g, '').trim())
    inner += `<li>${paras.join('<br/>')}${nested}</li>`
  }
  if (!inner) {
    // malformed list without items — recover any direct paragraphs
    inner = [...listXml.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)]
      .map((p) => `<li>${odfInline(p[1], styles)}</li>`)
      .join('')
  }
  const tag = odfListIsOrdered(listXml, fullXml) ? 'ol' : 'ul'
  return `<${tag}>${inner}</${tag}>`
}

function odfTableHtml(tbl: string, styles: Map<string, OdfSpanStyle>): string {
  const rows: string[] = []
  for (const tr of tbl.matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g)) {
    const cells: string[] = []
    for (const tc of tr[1].matchAll(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/g)) {
      const cellText = [...tc[1].matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)]
        .map((p) => odfInline(p[1], styles))
        .filter((t) => t.replace(/<[^>]+>/g, '').trim())
        .join('<br/>')
      cells.push(`<td>${cellText || '&nbsp;'}</td>`)
    }
    if (cells.length) rows.push(`<tr>${cells.join('')}</tr>`)
  }
  return rows.length ? `<table>${rows.join('')}</table><p><br/></p>` : ''
}

/** .odt → structured HTML, exactly the fidelity of docxToHtml for Word files */
export async function odtToHtml(buf: ArrayBuffer): Promise<{ html: string; stats: ImportStats }> {
  const t0 = performance.now()
  const entries = zipEntries(buf)
  const entry = entries.find((e) => e.name === 'content.xml') || entries.find((e) => e.name.endsWith('/content.xml'))
  if (!entry) throw new Error('not an .odt (content.xml missing)')
  const xml = new TextDecoder().decode(await zipRead(buf, entry))
  const styles = parseOdfTextStyles(xml)

  const bodyAll = /<office:body>([\s\S]*)<\/office:body>/.exec(xml)?.[1] || xml
  const text = /<office:text\b[^>]*>([\s\S]*)<\/office:text>/.exec(bodyAll)?.[1] || bodyAll

  const counts = { h: 0, p: 0, list: 0, table: 0 }
  const stashArr: string[] = []
  const stash = (html: string) => {
    stashArr.push(html)
    return `\u0000ODF${stashArr.length - 1}\u0000`
  }
  const restore = (seg: string): string => seg.replace(/\u0000ODF(\d+)\u0000/g, (_, i) => stashArr[Number(i)] ?? '')

  // 1) tables (balanced — they never nest), 2) lists (may nest), 3) paragraphs
  let work = replaceBalanced(text, 'table:table', (b) => {
    counts.table++
    return stash(odfTableHtml(b, styles))
  })
  work = replaceBalanced(work, 'text:list', (b) => {
    counts.list++
    return stash(odfListHtml(b, xml, styles))
  })

  let out = ''
  let last = 0
  for (const m of work.matchAll(/<text:h\b[^>]*>([\s\S]*?)<\/text:h>|<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)) {
    out += restore(work.slice(last, m.index))
    if (m[0].startsWith('<text:h')) {
      const lvl = Math.min(4, Number(/text:outline-level="(\d+)"/.exec(m[0])?.[1] || 1))
      const inner = odfInline(m[1], styles)
      if (inner.trim()) {
        counts.h++
        out += `<h${lvl}>${inner}</h${lvl}>`
      }
    } else {
      const inner = odfInline(m[2], styles)
      if (inner.trim()) {
        counts.p++
        out += `<p>${inner}</p>`
      }
    }
    last = m.index + m[0].length
  }
  out += restore(work.slice(last))

  return {
    html: out || '<p><br/></p>',
    stats: {
      format: 'OpenDocument text (.odt)',
      family: 'OpenDocument — Google Docs / LibreOffice',
      parser: 'ODF content.xml walker',
      ms: Math.round(performance.now() - t0),
      elements: [
        `${counts.h} heading${counts.h === 1 ? '' : 's'}`,
        `${counts.p} paragraph${counts.p === 1 ? '' : 's'}`,
        counts.list ? `${counts.list} list${counts.list === 1 ? '' : 's'}` : '',
        counts.table ? `${counts.table} table${counts.table === 1 ? '' : 's'}` : '',
      ],
    },
  }
}

/** .odp → slides in page order — same shape pptxSlides returns for PowerPoint */
export async function odpSlides(
  buf: ArrayBuffer
): Promise<{ slides: Array<{ title: string; body: string[]; notes: string }>; stats: ImportStats }> {
  const t0 = performance.now()
  const entries = zipEntries(buf)
  const entry = entries.find((e) => e.name === 'content.xml') || entries.find((e) => e.name.endsWith('/content.xml'))
  if (!entry) throw new Error('not an .odp (content.xml missing)')
  const xml = new TextDecoder().decode(await zipRead(buf, entry))
  const styles = parseOdfTextStyles(xml)

  const pres = /<office:presentation\b[^>]*>([\s\S]*)<\/office:presentation>/.exec(xml)?.[1] || ''
  if (!/<draw:page\b/.test(pres)) throw new Error('not an .odp (no draw:page found)')

  const slides: Array<{ title: string; body: string[]; notes: string }> = []
  for (const pm of pres.matchAll(/<draw:page\b([^>]*)>([\s\S]*?)<\/draw:page>/g)) {
    const attrs = pm[1]
    let page = pm[2]
    // speaker notes first — they must not leak into the visible bullets
    let notes = ''
    page = page.replace(/<presentation:notes\b[^>]*>([\s\S]*?)<\/presentation:notes>/g, (_, np) => {
      notes = [...np.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)]
        .map((p) => odfPlainText(p[1]).replace(/<br\/>/g, ' '))
        .map((t) => t.replace(/<[^>]+>/g, '').trim())
        .filter(Boolean)
        .join('\n')
      return ''
    })
    let title = ''
    const body: string[] = []
    for (const fm of page.matchAll(/<draw:frame\b([^>]*)>([\s\S]*?)<\/draw:frame>/g)) {
      const cls = /presentation:class="([^"]+)"/.exec(fm[1])?.[1] || ''
      const paras = [...fm[2].matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)]
        .map((p) => odfPlainText(p[1]).replace(/<br\/>/g, ' ').replace(/<[^>]+>/g, '').trim())
        .filter(Boolean)
      if (cls === 'title' || cls === 'ctrTitle') {
        if (!title && paras.length) title = paras[0]
        else body.push(...paras)
      } else {
        body.push(...paras)
      }
    }
    if (!title) title = /draw:name="([^"]+)"/.exec(attrs)?.[1] || `Slide ${slides.length + 1}`
    slides.push({ title, body: body.slice(0, 14), notes })
  }

  const bullets = slides.reduce((a, s) => a + s.body.length, 0)
  return {
    slides,
    stats: {
      format: 'OpenDocument presentation (.odp)',
      family: 'OpenDocument — Google Slides / LibreOffice',
      parser: 'ODF content.xml page walker',
      ms: Math.round(performance.now() - t0),
      elements: [`${slides.length} slide${slides.length === 1 ? '' : 's'}`, `${bullets} bullet${bullets === 1 ? '' : 's'}`],
    },
  }
}

/* ================= Google Drive pointer files (.gdoc .gsheet .gslides) =================
 * Google Drive for desktop stores real cloud documents on disk as tiny JSON
 * pointer files: { "doc_id": "…", "url": "https://docs.google.com/…", "title": "…" }
 * The engine reads that JSON for real and lands the live link + metadata in the
 * matching OS app; full offline round-trip stays honest (File ▸ Download in
 * Google → .docx/.xlsx/.pptx → Import). */

export type GooglePtrKind = 'gdoc' | 'gsheet' | 'gslides'

export interface GooglePtr {
  kind: GooglePtrKind
  url: string
  docId: string
  title: string
}

export const GOOGLE_POINTER_RE = /\.(gdoc|gsheet|gslides)$/i

export function googlePtrKindOf(name: string): GooglePtrKind | null {
  if (/\.gdoc$/i.test(name)) return 'gdoc'
  if (/\.gsheet$/i.test(name)) return 'gsheet'
  if (/\.gslides$/i.test(name)) return 'gslides'
  return null
}

const unescapeJsonStr = (s: string): string =>
  s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\"/g, '"').replace(/\\\\/g, '\\')

export function googlePointerParse(name: string, text: string): GooglePtr {
  const kind = googlePtrKindOf(name) || 'gdoc'
  let url = ''
  let docId = ''
  let title = ''
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    if (typeof j.url === 'string') url = j.url
    if (typeof j.doc_id === 'string') docId = j.doc_id
    else if (typeof j.docId === 'string') docId = j.docId
    if (typeof j.title === 'string') title = j.title
  } catch {
    // tolerate hand-made or Takeout-variant pointers (regex recovery)
    url = /"url"\s*:\s*"([^"]+)"/.exec(text)?.[1] || /(https:\/\/docs\.google\.com[^\s"']+)/.exec(text)?.[1] || ''
    docId = /"(?:doc_id|docId)"\s*:\s*"([^"]+)"/.exec(text)?.[1] || ''
    title = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1] || ''
    if (title) title = unescapeJsonStr(title)
  }
  if (url && !docId) docId = /\/d\/([A-Za-z0-9_-]+)/.exec(url)?.[1] || ''
  if (!url && !docId && !title) {
    throw new Error(`Not a Google Drive pointer file — .${kind} expects JSON with url / doc_id / title`)
  }
  return { kind, url, docId, title: title || name.replace(/\.(gdoc|gsheet|gslides)$/i, '') }
}

const PTR_LABEL: Record<GooglePtrKind, string> = {
  gdoc: 'Docs',
  gsheet: 'Sheets',
  gslides: 'Slides',
}

export function googlePtrStats(ptr: GooglePtr, t0: number): ImportStats {
  return {
    format: `Google Drive pointer (.${ptr.kind})`,
    family: 'Google Workspace',
    parser: 'Drive pointer JSON reader',
    ms: Math.round(performance.now() - t0),
    elements: [PTR_LABEL[ptr.kind], ptr.docId ? `id ${ptr.docId.slice(0, 12)}…` : 'no doc id'],
  }
}

export function googlePointerDocHtml(ptr: GooglePtr): string {
  const link = ptr.url
    ? `<a href="${escapeHtml(ptr.url)}" target="_blank" rel="noreferrer">${escapeHtml(ptr.url)}</a>`
    : '(no URL stored inside this pointer)'
  return [
    `<h1>${escapeHtml(ptr.title)}</h1>`,
    `<p><strong>Google ${PTR_LABEL[ptr.kind]}</strong> — Drive pointer file imported by the REDSEC Import Engine.</p>`,
    `<blockquote><p>${link}</p></blockquote>`,
    `<p>Doc ID: <em>${escapeHtml(ptr.docId || '—')}</em></p>`,
    '<h2>Work with this document</h2>',
    '<ul>',
    '<li>Click the link above to open the live Google document in this browser.</li>',
    '<li>For full offline editing: in Google choose <strong>File ▸ Download</strong> → .docx / .xlsx / .pptx, then Import here — the engine parses every element.</li>',
    '<li>This page stays in REDSEC ▸ Documents and can be edited, exported (.docx/.html/.txt/.md) and shared like any other document.</li>',
    '</ul>',
  ].join('')
}

export function googlePointerSheetRows(ptr: GooglePtr): string[][] {
  return [
    ['REDSEC Sheet — Google Sheets link'],
    [],
    ['Item', 'Value'],
    ['Document title', ptr.title],
    ['Live document', ptr.url || '(no URL stored in pointer)'],
    ['Doc ID', ptr.docId || '—'],
    ['Imported at', new Date().toISOString()],
    [],
    ['Note', 'Live cell data needs a Google export: in Sheets choose File ▸ Download ▸ .xlsx, then File ▸ Import here — formulas, formats and all sheets come through the engine.'],
  ]
}

export function googlePointerDeckSlides(ptr: GooglePtr): Array<{ title: string; body: string[] }> {
  return [
    {
      title: ptr.title || 'Google Slides',
      body: [`Open the live deck: ${ptr.url || '(no URL stored in pointer)'}`, ptr.docId ? `Doc ID: ${ptr.docId}` : '', 'Import real slides: in Google Slides choose File ▸ Download ▸ .pptx, then Import.'].filter(Boolean),
    },
  ]
}

/* ================= OS files auto-stash (File Manager ▸ OS files section) =================
 * Every successful import drops the ORIGINAL bytes into OS ▸ Documents so the
 * file instantly shows in File Manager and re-opens in the right app. Deduped
 * by name + byte size, so opening from FS → import never doubles the node. */
export async function stashImportToOs(f: { name: string; type?: string }, ab: ArrayBuffer): Promise<boolean> {
  try {
    const dupe = fs
      .all()
      .find((n) => n.kind === 'file' && !n.trashed && !n.meta?.root && n.name === f.name && n.size === ab.byteLength)
    if (dupe) return false
    await fs.addFile('documents', f.name, {
      blob: new Blob([ab], { type: f.type || 'application/octet-stream' }),
      mime: f.type || undefined,
    })
    return true
  } catch {
    return false // File Manager stash must NEVER break the import itself
  }
}

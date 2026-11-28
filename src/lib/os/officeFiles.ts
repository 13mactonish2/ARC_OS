// REDSEC 6.0 BlueStringRay — officeFiles.ts — the shared office-file detection brain.
// One module used by File Manager + Word + Sheet + Presentation + PDF Viewer:
//   • extension & mime mapping (which Open Suite app owns which file)
//   • magic-byte content sniffing (%PDF- header / ZIP→OOXML member peek) so
//     files saved with the wrong or missing extension STILL open correctly
//   • a whole-VFS scan so files saved in ANY folder (Downloads, Desktop,
//     Archive, Photos…) are detected — not just Documents
//   • honest, friendly reasons when a legacy format (.doc / .ppt) can't open
'use client'

import { fs, ROOTS } from './fs'
import { zipEntries } from './ooxml'
import type { FSNode } from './types'

export type OfficeApp = 'sheet' | 'word' | 'presentation' | 'pdfviewer'

/** spreadsheet formats the Sheet engine (SheetJS) really parses */
export const SHEET_FILE_RE = /\.(xlsx|xlsm|xlsb|xls|ods|csv|tsv|gsheet)$/i
/** Word-importable documents — .odt/.gdoc = Google Docs (ODF export / Drive pointer) */
export const WORD_FILE_RE = /\.(docx|odt|gdoc)$/i
export const WORD_TEXT_RE = /\.(txt|md|html?)$/i
export const SLIDES_FILE_RE = /\.(pptx|deck\.json|odp|gslides)$/i
export const PDF_FILE_RE = /\.(pdf)$/i
/** binary office types that must NEVER fall into the raw text viewer */
export const OFFICE_BINARY_RE = /\.(xlsx|xlsm|xlsb|xls|ods|csv|tsv|docx|doc|pptx|ppt|pdf|deck\.json|odt|odp|gdoc|gsheet|gslides)$/i

export const OFFICE_APP_NAME: Record<OfficeApp, string> = {
  sheet: 'Sheet',
  word: 'Word',
  presentation: 'Presentation',
  pdfviewer: 'PDF Viewer',
}

export function officeEmoji(app: OfficeApp): string {
  return app === 'sheet' ? '📈' : app === 'word' ? '📝' : app === 'presentation' ? '📊' : '📕'
}

/** which Open Suite app owns this file? (null = not an office file) */
export function officeAppOf(name: string, mime?: string): OfficeApp | null {
  const m = mime || ''
  if (PDF_FILE_RE.test(name) || m === 'application/pdf' || m.startsWith('application/pdf')) return 'pdfviewer'
  if (SHEET_FILE_RE.test(name)) return 'sheet'
  if (WORD_FILE_RE.test(name)) return 'word'
  if (SLIDES_FILE_RE.test(name)) return 'presentation'
  if (WORD_TEXT_RE.test(name) && (m.startsWith('text/') || !m)) return 'word'
  return null
}

/** human label for the file type, used in toasts & viewers */
export function officeKindLabel(name: string): string {
  if (/\.xlsx$/i.test(name)) return 'Excel workbook'
  if (/\.(xlsm|xlsb)$/i.test(name)) return 'Excel macro workbook'
  if (/\.xls$/i.test(name)) return 'Excel 97 workbook'
  if (/\.ods$/i.test(name)) return 'OpenDocument spreadsheet'
  if (/\.csv$/i.test(name)) return 'CSV data'
  if (/\.tsv$/i.test(name)) return 'TSV data'
  if (/\.docx$/i.test(name)) return 'Word document'
  if (/\.pptx$/i.test(name)) return 'PowerPoint deck'
  if (/\.pdf$/i.test(name)) return 'PDF document'
  if (/\.(doc|ppt)$/i.test(name)) return 'legacy Office document'
  if (/\.odt$/i.test(name)) return 'OpenDocument text (Google Docs export)'
  if (/\.odp$/i.test(name)) return 'OpenDocument presentation (Google Slides export)'
  if (/\.gdoc$/i.test(name)) return 'Google Docs pointer'
  if (/\.gsheet$/i.test(name)) return 'Google Sheets pointer'
  if (/\.gslides$/i.test(name)) return 'Google Slides pointer'
  return 'document'
}

/** honest reason why a file can't be parsed (legacy formats etc.) */
export function officeUnsupportedMsg(name: string): string {
  if (/\.doc$/i.test(name)) return 'Legacy .doc isn’t supported — open it in Microsoft Word and re-save as .docx.'
  if (/\.ppt$/i.test(name)) return 'Legacy .ppt isn’t supported — open it in Microsoft PowerPoint and re-save as .pptx.'
  return 'This file type isn’t supported here.'
}

/**
 * Magic-byte sniff — the detection fix for files saved with the wrong or no
 * extension. Returns the app that can truly open the bytes:
 *   • `%PDF-` header → PDF Viewer
 *   • `PK\x03\x04` ZIP → peek the OOXML member names:
 *       word/document.xml → Word · ppt/* → Presentation · xl/* → Sheet
 */
export async function sniffOfficeApp(buf: ArrayBuffer): Promise<OfficeApp | null> {
  try {
    const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength))
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdfviewer' // %PDF
    if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) {
      const names = zipEntries(buf).map((e) => e.name)
      if (names.some((n) => n === 'word/document.xml' || n.startsWith('word/'))) return 'word'
      if (names.some((n) => n === 'ppt/presentation.xml' || /^ppt\//.test(n))) return 'presentation'
      if (names.some((n) => n === 'xl/workbook.xml' || /^xl\//.test(n))) return 'sheet'
      // OpenDocument family: read the stored `mimetype` member to tell ODS from ODT
      if (names.includes('mimetype')) {
        const mtEntry = zipEntries(buf).find((e) => e.name === 'mimetype')
        if (mtEntry) {
          const { zipRead } = await import('./ooxml')
          const mt = new TextDecoder().decode(await zipRead(buf, mtEntry))
          if (mt.includes('spreadsheet')) return 'sheet'
          if (mt.includes('presentation')) return 'presentation'
          if (mt.includes('text')) return 'word'
        }
      }
    }
  } catch {
    /* not a zip / corrupt — fall through */
  }
  return null
}

export interface OfficeFileHit {
  node: FSNode
  folder: string // friendly folder name (Documents, Downloads, Desktop…)
}

/** every matching file across ALL user folders, newest first — "Files → open in app" scans everywhere */
export function scanOfficeFiles(test: (n: FSNode) => boolean): OfficeFileHit[] {
  const folderName = new Map<string, string>()
  for (const r of ROOTS) folderName.set(r.id, r.name)
  return fs
    .all()
    .filter((n) => n.kind === 'file' && !n.trashed && !n.meta?.root && test(n))
    .map((n) => {
      const pid = n.parent || ''
      return { node: n, folder: folderName.get(pid) || (pid ? fs.get(pid)?.name : undefined) || 'Files' }
    })
    .sort((a, b) => b.node.modifiedAt - a.node.modifiedAt)
}

/** detect + open a node in the right suite app; returns the app used (null = not office) */
export function openOfficeNode(node: FSNode, openApp: (appId: string, args?: Record<string, unknown>, title?: string) => unknown): OfficeApp | null {
  const app = officeAppOf(node.name, node.mime)
  if (!app) return null
  openApp(app, { nodeId: node.id }, node.name)
  return app
}

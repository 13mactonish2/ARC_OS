// QA sample generator — real Microsoft + Google/ODF files for Import Engine testing.
// Run: bun scripts/qa-samples.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'

const OUT = 'public/qa-samples'
mkdirSync(OUT, { recursive: true })

/* ---------- 1) real .xlsx via SheetJS ---------- */
const XLSX = await import('xlsx')
{
  const wb = XLSX.utils.book_new()
  const rows = [
    ['Region', 'Product', 'Units', 'Price', 'Total'],
    ['North', 'Widget', 12, 4.5, null],
    ['South', 'Gadget', 7, 9.99, null],
    ['East', 'Sprocket', 21, 2.25, null],
    ['West', 'Widget', 5, 4.5, null],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['E2'] = { t: 'n', v: 54, f: 'C2*D2' }
  ws['E3'] = { t: 'n', v: 69.93, f: 'C3*D3' }
  ws['E4'] = { t: 'n', v: 47.25, f: 'C4*D4' }
  ws['E5'] = { t: 'n', v: 22.5, f: 'C5*D5' }
  ws['C8'] = { t: 'n', v: 45, f: 'SUM(C2:C5)' }
  XLSX.utils.book_append_sheet(wb, ws, 'Sales')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
  writeFileSync(`${OUT}/quarter-sales.xlsx`, buf)
}

/* ---------- 2) real .docx via the docx package ---------- */
{
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import('docx')
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('REDSEC Import Report')] }),
        new Paragraph({ children: [new TextRun('This document was generated as a real '), new TextRun({ text: 'Word .docx', bold: true }), new TextRun(' to verify the Import Engine walker.')] }),
        new Paragraph({ children: [new TextRun({ text: 'Styled run: ', }), new TextRun({ text: 'bold', bold: true }), new TextRun({ text: ', ', }), new TextRun({ text: 'italic', italics: true }), new TextRun({ text: ', ', }), new TextRun({ text: 'underline', underline: {} })] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Findings')] }),
        new Paragraph({ text: 'Headings map to real heading levels.', bullet: { level: 0 } }),
        new Paragraph({ text: 'Bullets stay bullets.', bullet: { level: 0 } }),
        new Paragraph({ text: 'Numbered steps stay numbered.', numbering: { reference: 'qa-ol', level: 0 } }),
        new Paragraph({ text: 'Engine emits structured HTML.', numbering: { reference: 'qa-ol', level: 0 } }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('— end of sample —')] }),
      ],
    }],
    numbering: { config: [{ reference: 'qa-ol', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'start' }] }] },
  })
  const buf = await Packer.toBuffer(doc)
  writeFileSync(`${OUT}/import-report.docx`, buf)
}

/* ---------- 3) real .pptx via pptxgenjs ---------- */
{
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  pptx.title = 'Q4 Briefing'
  const s1 = pptx.addSlide()
  s1.addText('Quarterly Briefing', { x: 0.5, y: 0.6, fontSize: 36, bold: true })
  s1.addText('Import Engine verification deck', { x: 0.5, y: 1.6, fontSize: 18 })
  const s2 = pptx.addSlide()
  s2.addText('Roadmap', { x: 0.5, y: 0.5, fontSize: 32, bold: true })
  s2.addText([
    { text: 'Ship Google pointer import', options: { bullet: true } },
    { text: 'Ship ODF walkers', options: { bullet: true } },
    { text: 'Deploy to REDSEC OS files', options: { bullet: true } },
  ], { x: 0.5, y: 1.4, fontSize: 16 })
  const buf = await pptx.write({ outputType: 'nodebuffer' })
  writeFileSync(`${OUT}/q4-briefing.pptx`, buf)
}

/* ---------- 4) real .odt (Google Docs Takeout shape) ---------- */
{
  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' })
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
 <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`)
  zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.2">
 <office:automatic-styles>
  <style:style style:name="TBold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
  <style:style style:name="TIt" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
 </office:automatic-styles>
 <office:body><office:text>
  <text:h text:outline-level="1">Docs Migration Notes</text:h>
  <text:p>Exported from Google Docs as <text:span text:style-name="TBold">ODF text</text:span> to test the engine.</text:p>
  <text:list><text:list-item><text:p>First migration step</text:p></text:list-item><text:list-item><text:p>Second migration step</text:p></text:list-item></text:list>
  <text:h text:outline-level="2">Budget table</text:h>
  <table:table><table:table-row><table:table-cell><text:p>Item</text:p></table:table-cell><table:table-cell><text:p>Cost</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>License</text:p></table:table-cell><table:table-cell><text:p><text:span text:style-name="TIt">12 USD</text:span></text:p></table:table-cell></table:table-row></table:table>
  <text:p>Footer paragraph with a <text:line-break/>line break inside.</text:p>
 </office:text></office:body>
</office:document-content>`)
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  writeFileSync(`${OUT}/docs-migration.odt`, buf)
}

/* ---------- 5) real .odp (Google Slides Takeout shape) ---------- */
{
  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.presentation', { compression: 'STORE' })
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
 <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.presentation"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`)
  zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" office:version="1.2">
 <office:body><office:presentation>
  <draw:page draw:name="Cover">
   <draw:frame presentation:class="title"><text:p>Slide Deck From Google</text:p></draw:frame>
   <draw:frame presentation:class="subtitle"><text:p>ODP import verification</text:p></draw:frame>
   <presentation:notes><text:p>Remember to test notes extraction.</text:p></presentation:notes>
  </draw:page>
  <draw:page draw:name="Agenda">
   <draw:frame presentation:class="title"><text:p>Agenda</text:p></draw:frame>
   <draw:frame presentation:class="outline"><text:p>Engine overview</text:p><text:p>Pointer files</text:p><text:p>ODF walkers</text:p></draw:frame>
  </draw:page>
 </office:presentation></office:body>
</office:document-content>`)
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  writeFileSync(`${OUT}/slide-deck.odp`, buf)
}

/* ---------- 6) Google Drive pointer files ---------- */
writeFileSync(`${OUT}/project-brief.gdoc`, JSON.stringify({
  doc_id: '1aREdSeCqAdOcSuMple0001',
  url: 'https://docs.google.com/document/d/1aREdSeCqAdOcSuMple0001/edit',
  title: 'Project Brief (Google Docs)',
  resourceKey: null,
}, null, 2))
writeFileSync(`${OUT}/metrics-tracker.gsheet`, JSON.stringify({
  doc_id: '1aREdSeCqAdOcSuMple0002',
  url: 'https://docs.google.com/spreadsheets/d/1aREdSeCqAdOcSuMple0002/edit',
  title: 'Metrics Tracker (Google Sheets)',
  resourceKey: null,
}, null, 2))
writeFileSync(`${OUT}/launch-deck.gslides`, JSON.stringify({
  doc_id: '1aREdSeCqAdOcSuMple0003',
  url: 'https://docs.google.com/presentation/d/1aREdSeCqAdOcSuMple0003/edit',
  title: 'Launch Deck (Google Slides)',
  resourceKey: null,
}, null, 2))

console.log('qa-samples written to', OUT)

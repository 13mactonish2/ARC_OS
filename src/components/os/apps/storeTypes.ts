// REDSEC 5.0 — App Store shared catalog types
// html: self-contained single-file HTML5 app (sandboxed iframe via srcDoc)
// url:  external web app (kind 'link' install, iframe embed)
export type CatalogItem = {
  slug: string
  name: string
  color: string
  category: 'game' | 'tool' | 'web'
  size: string
  rating: number
  desc: string
  html?: string
  url?: string
}

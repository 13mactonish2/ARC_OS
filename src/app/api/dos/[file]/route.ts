// REDSEC 5.0 — DOS core proxy: serves the emulators (wdosbox/wlibzip) worker
// scripts + wasm binaries SAME-ORIGIN. Browsers forbid `new Worker(crossOriginUrl)`,
// so the DOSBox core must be reachable from this origin — we stream the pinned
// jsDelivr dist through here (the DOS BIOS driver probes this exact upstream).
export const dynamic = 'force-dynamic'

const BASE = 'https://cdn.jsdelivr.net/npm/emulators@0.73.9/dist/'
const ALLOW = /^[\w.\-]+$/ // wdosbox.js · wdosbox.wasm · wlibzip.js · wlibzip.wasm · …

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  if (!ALLOW.test(file)) {
    return Response.json({ error: 'bad file' }, { status: 400 })
  }
  try {
    const upstream = await fetch(BASE + file, { cache: 'no-store' })
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: `upstream ${upstream.status}` }, { status: 502 })
    }
    const buf = await upstream.arrayBuffer()
    const type = file.endsWith('.wasm')
      ? 'application/wasm'
      : file.endsWith('.js')
        ? 'application/javascript'
        : 'application/octet-stream'
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(buf.byteLength),
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 })
  }
}

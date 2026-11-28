// REDSEC v5.0 — Task 36: the OS web-export bridge.
// Lets ANY web file written in code (OpenCode HTML sessions, previews)
// turn into REAL files in the File Manager: photo (PNG), sound (WAV),
// media (WebM clip) and games (standalone playable .html).
// The bridge is injected as the FIRST script of the preview document so it
// wraps AudioContext before user code runs; the OS talks to it with
// postMessage({ __osExport }) and receives { __osFile } / { __osFileErr }.
'use client'

export const OS_EXPORT_BRIDGE = `
(function () {
  if (window.__osBridge) return
  window.__osBridge = true
  var post = function (m) { try { parent.postMessage(m, '*') } catch (e) {} }

  /* ---------- sound: tap every AudioContext graph ---------- */
  var chunks = [], capturing = false, sampleRate = 48000, tapped = new WeakSet(), tappedCtxs = []
  function tap(ctx) {
    if (!ctx || !ctx.createScriptProcessor || tapped.has(ctx)) return
    try {
      tapped.add(ctx)
      tappedCtxs.push(ctx)
      sampleRate = ctx.sampleRate || 48000
      try { if (ctx.state === 'suspended') ctx.resume() } catch (e) {}
      var sp = ctx.createScriptProcessor(4096, 2, 2)
      sp.onaudioprocess = function (ev) {
        if (!capturing) return
        var l = ev.inputBuffer.getChannelData(0)
        var r = ev.inputBuffer.numberOfChannels > 1 ? ev.inputBuffer.getChannelData(1) : l
        var mono = new Float32Array(l.length)
        for (var i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) / 2
        if (chunks.length < 6000) chunks.push(mono) /* ~8 min cap */
      }
      /* silent keep-alive: the processor is only pulled while it reaches the destination */
      var sink = ctx.createGain(); sink.gain.value = 0
      sp.connect(sink); sink.connect(ctx.destination)
      /* every node that routes into the speakers also feeds the tap */
      var conn = AudioNode.prototype.connect
      AudioNode.prototype.connect = function (target) {
        var ret = conn.apply(this, arguments)
        try { if (target === ctx.destination && this !== sink && this !== sp) conn.call(this, sp) } catch (e) {}
        return ret
      }
    } catch (e) {}
  }
  var RealAC = window.AudioContext || window.webkitAudioContext
  if (RealAC) {
    var Wrapped = function () { var c = new (Function.prototype.bind.apply(RealAC, [null].concat(Array.prototype.slice.call(arguments))))(); try { tap(c) } catch (e) {} return c }
    Wrapped.prototype = RealAC.prototype
    window.AudioContext = Wrapped
    if (window.webkitAudioContext) window.webkitAudioContext = Wrapped
  }
  function encodeWAV(list, rate) {
    var total = 0; list.forEach(function (c) { total += c.length })
    var buf = new ArrayBuffer(44 + total * 2), v = new DataView(buf)
    var w = function (o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
    w(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
    w(36, 'data'); v.setUint32(40, total * 2, true)
    var off = 44
    list.forEach(function (c) { for (var i = 0; i < c.length; i++, off += 2) { var s = Math.max(-1, Math.min(1, c[i])); v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true) } })
    return new Blob([buf], { type: 'audio/wav' })
  }

  /* ---------- photo: biggest canvas, else a DOM snapshot ---------- */
  function biggestCanvas() {
    var best = null, area = 0
    document.querySelectorAll('canvas').forEach(function (c) {
      var a = (c.width || 0) * (c.height || 0)
      if (a > area && c.width > 8 && c.height > 8) { area = a; best = c }
    })
    return best
  }
  function domSnapshot(cb) {
    try {
      var clone = document.documentElement.cloneNode(true)
      clone.querySelectorAll('script,noscript,iframe').forEach(function (n) { n.remove() })
      var src = document.documentElement
      var walk = function (a, b) {
        try {
          var cs = getComputedStyle(b)
          var css = ''
          for (var i = 0; i < cs.length; i++) { var p = cs[i]; if (p !== 'width' && p !== 'height') css += p + ':' + cs.getPropertyValue(p) + ';' }
          a.setAttribute('style', css)
        } catch (e) {}
        var ac = a.children, bc = b.children
        for (var k = 0; k < ac.length && k < bc.length; k++) walk(ac[k], bc[k])
      }
      walk(clone, src)
      var xhtml = new XMLSerializer().serializeToString(clone)
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.max(document.body.scrollWidth, 320) + '" height="' + Math.max(document.body.scrollHeight, 240) + '"><foreignObject width="100%" height="100%">' + xhtml.replace(/^\\s*<[?]xml[^>]*\\?>/, '') + '</foreignObject></svg>'
      var img = new Image()
      img.onload = function () {
        var c = document.createElement('canvas')
        c.width = img.width || 800; c.height = img.height || 600
        var g = c.getContext('2d')
        g.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff'
        g.fillRect(0, 0, c.width, c.height)
        g.drawImage(img, 0, 0)
        try { cb(null, c.toDataURL('image/png')) } catch (e) { cb(e) }
      }
      img.onerror = function () { cb(new Error('snapshot failed')) }
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    } catch (e) { cb(e) }
  }

  /* ---------- media: record the biggest canvas as WebM ---------- */
  var recorder = null, recChunks = []
  function startMedia() {
    var c = biggestCanvas()
    if (!c || !c.captureStream) { post({ __osFileErr: { op: 'media', msg: 'No canvas found — a game or animation with a <canvas> is needed for a video clip' } }); return false }
    try {
      var stream = c.captureStream(30)
      var mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].filter(function (m) { return window.MediaRecorder && MediaRecorder.isTypeSupported(m) })[0]
      if (!mime) { post({ __osFileErr: { op: 'media', msg: 'MediaRecorder is not available in this browser' } }); return false }
      recChunks = []
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data) }
      recorder.onstop = function () {
        var blob = new Blob(recChunks, { type: 'video/webm' })
        blobToB64(blob, function (b64) { post({ __osFile: { kind: 'media', mime: 'video/webm', ext: 'webm', b64: b64 } }) })
      }
      recorder.start(250)
      return true
    } catch (e) { post({ __osFileErr: { op: 'media', msg: String(e && e.message || e) } }); return false }
  }
  function stopMedia() { try { recorder && recorder.state !== 'inactive' && recorder.stop() } catch (e) {} }

  function blobToB64(blob, cb) {
    var fr = new FileReader()
    fr.onload = function () { cb(String(fr.result).split(',')[1] || '') }
    fr.onerror = function () { cb('') }
    fr.readAsDataURL(blob)
  }

  /* ---------- command pump ---------- */
  window.addEventListener('message', function (ev) {
    var d = ev && ev.data
    if (!d || !d.__osExport) return
    try {
      if (d.__osExport === 'photo') {
        var c = biggestCanvas()
        if (c) {
          try { var png = c.toDataURL('image/png'); post({ __osFile: { kind: 'photo', mime: 'image/png', ext: 'png', b64: png.split(',')[1] } }); return } catch (e) {}
        }
        domSnapshot(function (err, dataUrl) {
          if (err || !dataUrl) post({ __osFileErr: { op: 'photo', msg: 'Could not snapshot the page — it may use cross-origin assets' } })
          else post({ __osFile: { kind: 'photo', mime: 'image/png', ext: 'png', b64: dataUrl.split(',')[1] } })
        })
      } else if (d.__osExport === 'sound-start') {
        chunks = []; capturing = true
        /* autoplay policy: a suspended context never fires onaudioprocess */
        tappedCtxs.forEach(function (c) { try { if (c.state === 'suspended') c.resume() } catch (e) {} })
        post({ __osNote: { msg: 'Recording everything this page plays — click stop when done' } })
      } else if (d.__osExport === 'sound-stop') {
        capturing = false
        if (!chunks.length) { post({ __osFileErr: { op: 'sound', msg: 'No audio captured — the page did not play any sound (interact with the page first)' } }); return }
        var blob = encodeWAV(chunks, sampleRate)
        chunks = []
        blobToB64(blob, function (b64) { post({ __osFile: { kind: 'sound', mime: 'audio/wav', ext: 'wav', b64: b64 } }) })
      } else if (d.__osExport === 'media-start') {
        startMedia()
      } else if (d.__osExport === 'media-stop') {
        stopMedia()
      }
    } catch (e) { post({ __osFileErr: { op: String(d.__osExport || ''), msg: String(e && e.message || e) } }) }
  })
})()
`

/** inject the bridge as the first script of a full HTML document (or prefix it) */
export function injectBridge(srcdoc: string): string {
  const bridge = `<script>${OS_EXPORT_BRIDGE}<\/script>`
  if (/<head[^>]*>/i.test(srcdoc)) return srcdoc.replace(/<head[^>]*>/i, (m) => `${m}${bridge}`)
  if (/<html[^>]*>/i.test(srcdoc)) return srcdoc.replace(/<html[^>]*>/i, (m) => `${m}<head>${bridge}</head>`)
  return `${bridge}${srcdoc}`
}

export interface OsExportFile {
  kind: 'photo' | 'sound' | 'media'
  mime: string
  ext: string
  b64: string
}

export interface OsExportErr {
  op: string
  msg: string
}

/** parse a postMessage payload coming from the bridge */
export function parseExportData(data: unknown): { file?: OsExportFile; err?: OsExportErr; note?: string } {
  if (!data || typeof data !== 'object') return {}
  const d = data as { __osFile?: OsExportFile; __osFileErr?: OsExportErr; __osNote?: { msg?: string } }
  if (d.__osFile) return { file: d.__osFile }
  if (d.__osFileErr) return { err: d.__osFileErr }
  if (d.__osNote?.msg) return { note: d.__osNote.msg }
  return {}
}

/** b64 → Blob */
export function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** save an exported file into the right File-Manager root + toast */
export async function saveWebExport(f: OsExportFile, baseName: string): Promise<void> {
  const { fs } = await import('./fs')
  const { useOS } = await import('./store')
  const os = useOS.getState()
  try {
    const blob = b64ToBlob(f.b64, f.mime)
    const base = (baseName || 'web-app').replace(/[\\/:*?"<>|]+/g, '').trim() || 'web-app'
    const root = f.kind === 'photo' ? 'photos' : f.kind === 'sound' ? 'music' : 'videos'
    const label = f.kind === 'photo' ? 'Photos' : f.kind === 'sound' ? 'Music' : 'Videos'
    const suffix = f.kind === 'photo' ? 'snapshot' : f.kind === 'sound' ? 'sound' : 'clip'
    const node = await fs.addFile(root, `${base}-${suffix}.${f.ext}`, {
      blob,
      mime: f.mime,
      size: blob.size,
      meta: { kind: f.kind, app: 'opencode', exportedFrom: `${base}.html` },
    })
    os.notify({
      title: `Web code turned into a real ${f.kind} 📦`,
      body: `${node.name} → File Manager ▸ ${label}`,
      kind: 'success',
      emoji: f.kind === 'photo' ? '📸' : f.kind === 'sound' ? '🔊' : '🎬',
      app: 'filemanager',
    })
  } catch {
    os.notify({ title: 'Export failed', body: 'Could not save the file', kind: 'error' })
  }
}

/** package an HTML document as a standalone playable game file (Documents) */
export async function saveWebGame(html: string, baseName: string): Promise<void> {
  const { fs } = await import('./fs')
  const { useOS } = await import('./store')
  const os = useOS.getState()
  try {
    const base = (baseName || 'game').replace(/[\\/:*?"<>|]+/g, '').trim() || 'game'
    const blob = new Blob([html], { type: 'text/html' })
    const node = await fs.addFile('documents', `${base}-game.html`, {
      blob,
      mime: 'text/html',
      size: blob.size,
      meta: { kind: 'game', app: 'opencode', text: html },
    })
    os.notify({
      title: 'Web code turned into a playable game 🎮',
      body: `${node.name} → File Manager ▸ Documents — open it to play`,
      kind: 'success',
      emoji: '🎮',
      app: 'filemanager',
    })
  } catch {
    os.notify({ title: 'Export failed', kind: 'error' })
  }
}

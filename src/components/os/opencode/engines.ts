// REDSEC v5.0 — Task 26: OpenCode run engines (client-side).
// - runJsRunner: JS/TS in a hidden sandboxed iframe (console capture, 6s cap)
// - transformTs: naive type-stripper so TypeScript samples run as JS
// - runPython:   Pyodide in a cached hidden iframe, CDN fallback to the sim
// - buildPreview / PREVIEW_LANGS: live HTML/CSS/React/Vue/Angular previews
// Every engine is defensive: nothing it does can crash the IDE.
export interface RunHandle {
  stop: () => void
}

export type RunEmit = (line: string, kind?: 'log' | 'error') => void

const FRAME_STYLE = 'position:fixed;left:-99999px;top:0;width:0;height:0;border:0;visibility:hidden;pointer-events:none'
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/'
const JS_TIMEOUT = 6000

/** embed code as a JS string literal; `<\/` keeps </script> from terminating the tag */
const asJs = (code: string) => JSON.stringify(code).replace(/<\//g, '<\\/')

/* ------------------------------------------------------------------ */
/*  JS / TS runner — hidden sandboxed iframe                          */
/* ------------------------------------------------------------------ */

const HARNESS = `
['log','info','warn','error'].forEach(function(k){
  var orig = console[k] ? console[k].bind(console) : function(){};
  console[k] = function(){
    var a = [].slice.call(arguments).map(function(v){
      if (typeof v === 'string') return v;
      try { return JSON.stringify(v); } catch (e) { return String(v); }
    });
    try { parent.postMessage({ __oc: TOK, line: a.join(' '), kind: (k === 'error' || k === 'warn') ? 'error' : 'log' }, '*'); } catch (e) {}
    try { orig.apply(null, arguments); } catch (e) {}
  };
});
window.onerror = function(msg){ try { parent.postMessage({ __oc: TOK, line: 'Unhandled error: ' + msg, kind: 'error' }, '*'); } catch (e) {} return false; };
window.addEventListener('unhandledrejection', function(e){
  var r = e && e.reason;
  try { parent.postMessage({ __oc: TOK, line: 'Unhandled rejection: ' + ((r && (r.message || String(r))) || 'unknown'), kind: 'error' }, '*'); } catch (err) {}
});
/* tiny node-ish shims so require('http') samples don't hard-crash the sandbox */
window.require = function(name){
  if (name === 'http') {
    var s = { listen: function(_p, cb){ if (cb) { try { cb(); } catch (e) {} } return s; }, get: function(){ return s; }, post: function(){ return s; } };
    return { createServer: function(){ return s; }, request: function(){ return s; }, get: function(){}, STATUS_CODES: {} };
  }
  if (name === 'fs') return { readFileSync: function(){ return ''; }, writeFileSync: function(){}, existsSync: function(){ return false; }, readdirSync: function(){ return []; } };
  if (name === 'path') return { join: function(){ return [].slice.call(arguments).join('/'); }, resolve: function(){ return [].slice.call(arguments).join('/'); } };
  return {};
};`

export function runJsRunner(code: string, emit: RunEmit, onDone: (exit: number) => void, timeoutMs = JS_TIMEOUT): RunHandle {
  try {
    const token = `oc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    let finished = false

    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.setAttribute('sandbox', 'allow-scripts allow-modals')
    iframe.style.cssText = FRAME_STYLE

    const listener = (e: MessageEvent) => {
      const d = e.data as { __oc?: string; line?: unknown; kind?: string; done?: boolean } | null
      if (!d || d.__oc !== token || finished) return
      if (d.done) {
        finish(0)
        return
      }
      emit(String(d.line ?? ''), d.kind === 'error' ? 'error' : 'log')
    }

    const finish = (exit: number) => {
      if (finished) return
      finished = true
      window.clearTimeout(timer)
      window.removeEventListener('message', listener)
      window.setTimeout(() => {
        try {
          iframe.remove()
        } catch {
          /* ignore */
        }
      }, 40)
      onDone(exit)
    }

    const timer = window.setTimeout(() => {
      if (!finished) {
        emit('[timed out]', 'error')
        finish(1)
      }
    }, timeoutMs)

    window.addEventListener('message', listener)
    iframe.srcdoc =
      `<!doctype html><html><head><meta charset="utf-8"></head><body><script>var TOK=${asJs(token)};${HARNESS}<\/script>` +
      `<script>try{\n(0,eval)(${asJs(code)});\n}catch(__e){try{console.error((__e&&__e.message)||String(__e));}catch(_e){}}\n` +
      `setTimeout(function(){try{parent.postMessage({__oc:${asJs(token)},done:true},'*')}catch(__e){}},80);\n<\/script></body></html>`
    document.body.appendChild(iframe)

    return { stop: () => finish(1) }
  } catch {
    emit('[runtime] failed to start the sandbox', 'error')
    onDone(1)
    return { stop: () => {} }
  }
}

/* ------------------------------------------------------------------ */
/*  TypeScript → JS (naive, safe-pattern type stripping)              */
/* ------------------------------------------------------------------ */

export function transformTs(src: string): string {
  try {
    // remove `interface X { … }` blocks line-wise (brace-aware)
    const lines = src.split('\n')
    const kept: string[] = []
    let inIface = false
    let depth = 0
    for (const line of lines) {
      if (!inIface) {
        if (/^\s*(?:export\s+)?interface\s+[A-Za-z_$][\w$]*[^{]*\{/.test(line)) {
          inIface = true
          depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
          continue
        }
        kept.push(line)
      } else {
        depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
        if (depth <= 0) inIface = false
      }
    }
    let out = kept.join('\n')
    out = out.replace(/\bexport\s+default\s+/g, '').replace(/\bexport\s+/g, '').replace(/\bdeclare\s+/g, '')
    out = out.replace(/\s+as\s+const\b/g, '')
    out = out.replace(/\s+as\s+[A-Za-z_$][\w$$.]*(?:<[^>()]*>)?(?:\[\])*/g, '')
    // return annotations: ): string => {   →   ) => {
    out = out.replace(/\)\s*:\s*[A-Za-z_$][\w$$.<>]*(?:\[\])*(?=\s*(?:=>|\{))/g, ')')
    // parameter annotations: (name: string[, …])
    out = out.replace(/([(,]\s*)[A-Za-z_$][\w$]*\??\s*:\s*[A-Za-z_$][\w$$.<[\]|]*(?=\s*[),])/g, '$1')
    // variable annotations: const x: number = …
    out = out.replace(/((?:const|let|var)\s+[A-Za-z_$][\w$]*)\s*:\s*[^=\n]+?(?=\s*=)/g, '$1')
    // class field modifiers
    out = out.replace(/\b(?:public|private|protected|readonly)\s+(?=[A-Za-z_$])/g, '')
    // remaining primitive annotations (incl. class fields `x: number = 1`)
    out = out.replace(/:\s*(?:string|number|boolean|object|any|unknown|void|never|bigint|undefined|null)\b(?:\[\])*/g, '')
    return out
  } catch {
    return src
  }
}

/* ------------------------------------------------------------------ */
/*  Python runner — Pyodide in a cached hidden iframe                 */
/* ------------------------------------------------------------------ */

type PyMsg = { status?: 'loading' | 'ready' | 'fail'; line?: string; kind?: string; done?: boolean; __ocpy?: boolean }

let pyFrame: HTMLIFrameElement | null = null
let pyReady = false
let pyFailed = false
let pyPending: string | null = null
let pyHandler: ((m: PyMsg) => void) | null = null
let pyListener = false

const PY_BOOT = `
window.__ocFail = function(m){ try { parent.postMessage({ __ocpy: true, status: 'fail', line: String(m || 'download failed') }, '*'); } catch (e) {} };
window.addEventListener('message', function(e){
  var d = e.data; if (!d || !d.__ocpyrun || !window.__py) return;
  (async function(){
    try {
      window.__py.setStdout({ batched: function(s){ try { parent.postMessage({ __ocpy: true, line: s, kind: 'log' }, '*'); } catch (e) {} } });
      window.__py.setStderr({ batched: function(s){ try { parent.postMessage({ __ocpy: true, line: s, kind: 'error' }, '*'); } catch (e) {} } });
      await window.__py.runPythonAsync(d.code);
      try { parent.postMessage({ __ocpy: true, done: true }, '*'); } catch (e) {}
    } catch (err) {
      try {
        parent.postMessage({ __ocpy: true, line: String((err && err.message) || err), kind: 'error' }, '*');
        parent.postMessage({ __ocpy: true, done: true }, '*');
      } catch (e) {}
    }
  })();
});
(async function(){
  try {
    try { parent.postMessage({ __ocpy: true, status: 'loading' }, '*'); } catch (e) {}
    window.__py = await loadPyodide({ indexURL: '${PYODIDE_URL}' });
    try { parent.postMessage({ __ocpy: true, status: 'ready' }, '*'); } catch (e) {}
  } catch (err) {
    try { parent.postMessage({ __ocpy: true, status: 'fail', line: String((err && err.message) || err) }, '*'); } catch (e) {}
  }
})();`

function sendPyCode(code: string): void {
  try {
    pyFrame?.contentWindow?.postMessage({ __ocpyrun: true, code }, '*')
  } catch {
    /* ignore */
  }
}

function ensurePyFrame(): HTMLIFrameElement {
  if (pyFrame) return pyFrame
  const f = document.createElement('iframe')
  f.setAttribute('aria-hidden', 'true')
  f.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups')
  f.style.cssText = FRAME_STYLE
  if (!pyListener) {
    pyListener = true
    window.addEventListener('message', (e: MessageEvent) => {
      const d = e.data as PyMsg | null
      if (!d || d.__ocpy !== true) return
      if (d.status === 'ready') pyReady = true
      if (d.status === 'fail') {
        pyFailed = true
        pyReady = false
      }
      if (d.status === 'ready' && pyPending !== null) {
        const code = pyPending
        pyPending = null
        sendPyCode(code)
      }
      try {
        pyHandler?.(d)
      } catch {
        /* ignore */
      }
    })
  }
  f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>window.__ocFail = window.__ocFail || function(){};<\/script><script src="${PYODIDE_URL}pyodide.js" onerror="__ocFail('CDN unreachable')"><\/script><script>${PY_BOOT}<\/script></body></html>`
  document.body.appendChild(f)
  pyFrame = f
  return f
}

export interface PyRunOpts {
  onStatus?: (s: 'loading' | 'ready') => void
  onLine: RunEmit
  onDone: (exit: number) => void
  onUnavailable: () => void
}

export function runPython(code: string, opts: PyRunOpts): RunHandle {
  if (pyFailed) {
    opts.onUnavailable()
    return { stop: () => {} }
  }
  try {
    ensurePyFrame()
    let stopped = false
    let watch = 0
    pyHandler = (m) => {
      if (stopped) return
      if (m.status === 'loading') {
        opts.onStatus?.('loading')
        return
      }
      if (m.status === 'ready') {
        if (watch) {
          window.clearTimeout(watch)
          watch = 0
        }
        opts.onStatus?.('ready')
        return
      }
      if (m.status === 'fail') {
        if (watch) window.clearTimeout(watch)
        stopped = true
        pyHandler = null
        pyPending = null
        opts.onUnavailable()
        return
      }
      if (m.done) {
        if (watch) window.clearTimeout(watch)
        stopped = true
        pyHandler = null
        opts.onDone(0)
        return
      }
      if (typeof m.line === 'string') opts.onLine(m.line, m.kind === 'error' ? 'error' : 'log')
    }
    if (pyReady) {
      sendPyCode(code)
    } else {
      pyPending = code
      opts.onStatus?.('loading')
      watch = window.setTimeout(() => {
        if (!stopped && !pyReady) {
          pyFailed = true
          stopped = true
          pyHandler = null
          pyPending = null
          opts.onUnavailable()
        }
      }, 25000)
    }
    return {
      stop: () => {
        stopped = true
        pyHandler = null
        if (watch) window.clearTimeout(watch)
      },
    }
  } catch {
    pyFailed = true
    opts.onUnavailable()
    return { stop: () => {} }
  }
}

/* ------------------------------------------------------------------ */
/*  Live preview builders                                             */
/* ------------------------------------------------------------------ */

export interface PreviewSpec {
  srcdoc: string
  needsInternet: boolean
}

const BASE_CSS = `html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#10141f;font-family:system-ui,-apple-system,sans-serif;overflow:auto}`

function doc(head: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`
}

export function buildPreview(langId: string, code: string): PreviewSpec {
  switch (langId) {
    case 'html5':
      return { srcdoc: /<html[\s>]/i.test(code) ? code : doc('', code), needsInternet: false }
    case 'css3':
      return {
        srcdoc: doc(
          `<style>${BASE_CSS}</style><style>\n${code.replace(/<\//g, '<\\/')}\n</style>`,
          `<div class="card">CSS3 is live</div>`
        ),
        needsInternet: false,
      }
    case 'react':
      return {
        srcdoc: doc(
          `<style>${BASE_CSS}</style>` +
            `<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>` +
            `<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>` +
            `<script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>`,
          `<div id="root"></div><script type="text/babel" data-presets="react">\n${code.replace(/<\//g, '<\\/')}\n<\/script>`
        ),
        needsInternet: true,
      }
    case 'vuejs': {
      const tplMatch = code.match(/<template>([\s\S]*?)<\/template>/i)
      const tpl = tplMatch ? tplMatch[1] : '<div id="app"></div>'
      const scriptMatch = code.match(/<script[^>]*>([\s\S]*?)<\/script>/i)
      const body = (scriptMatch ? scriptMatch[1] : '').replace(/export\s+default\s*/, 'var __ocOpts = ')
      const optsJs = scriptMatch ? `${body}\ntry{ window.__ocOpts = __ocOpts; }catch(e){}` : 'window.__ocOpts = {};'
      return {
        srcdoc: doc(
          `<style>${BASE_CSS}</style><script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"><\/script>`,
          `<div id="app"></div><script>${optsJs.replace(/<\//g, '<\\/')}\n` +
            `try{ var o = window.__ocOpts || {}; o.template = ${asJs(tpl)}; Vue.createApp(o).mount('#app'); }catch(e){ document.body.insertAdjacentHTML('beforeend', '<pre style="color:#f87171;padding:16px">'+e+'</pre>'); }\n<\/script>`
        ),
        needsInternet: true,
      }
    }
    case 'angular': {
      let tpl = ''
      try {
        const m = code.match(new RegExp('template\\s*:\\s*`([\\s\\S]*?)`')) || code.match(/template\s*:\s*['"]([\s\S]*?)['"]/)
        tpl = m ? m[1] : '<p style="color:#94a3b8">No inline template found in this component.</p>'
      } catch {
        tpl = '<p style="color:#94a3b8">Template parse failed.</p>'
      }
      return {
        srcdoc: doc(
          `<style>${BASE_CSS} body{place-items:start center;padding:24px}</style>`,
          `<div style="font:12px system-ui;color:#94a3b8;margin-bottom:12px">Angular preview — template render (full CLI build not available in-browser)</div>` +
            tpl.replace(/\{\{[^}]*\}\}/g, (m2) => `<span style="color:#fdba74">${m2}</span>`)
        ),
        needsInternet: false,
      }
    }
    default:
      return { srcdoc: doc('', `<pre>${code.replace(/</g, '&lt;')}</pre>`), needsInternet: false }
  }
}

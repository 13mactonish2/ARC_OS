// REDSEC v5.0 — Task 26: OpenCode emulated run engine (the "sim" runner).
// PURE + TOTAL: given a language and source code it always returns an array of
// output lines and never throws (every stage is wrapped). It extracts plausible
// program output (print/printf/cout/println/echo/… statements, SQL results,
// redis replies, server boot logs …) from the source — enough to feel real.
import type { CodeLang } from './codelangs'

/* loop-var markers: invisible sentinels expanded into N lines afterwards */
const M = '\u0000'
const ME = '\u0001'
const mark = (v: string) => `${M}${v}${ME}`
const MAX_LINES = 220
const MAX_LOOP = 50

interface Loop {
  v: string
  vals: string[]
}

/* ------------------------------------------------------------------ utils */

function unesc(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
}

/** split on `sep` only outside quotes/brackets */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  let q: string | null = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      cur += ch
      if (ch === '\\') {
        cur += s[i + 1] || ''
        i++
      } else if (ch === q) q = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      q = ch
      cur += ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    if (ch === ')' || ch === ']' || ch === '}') depth--
    if (depth <= 0 && s.startsWith(sep, i)) {
      out.push(cur)
      cur = ''
      i += sep.length - 1
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

/** quoted-string literal at both ends → inner text */
function stripQuotes(p: string): string | null {
  const t = p.trim()
  if (t.length >= 2) {
    const a = t[0]
    const b = t[t.length - 1]
    if ((a === '"' || a === "'" || a === '`') && a === b) return t.slice(1, -1)
  }
  return null
}

function detectLoops(code: string): Loop[] {
  const loops: Loop[] = []
  const seen = new Set<string>()
  const add = (v: string, from: number, to: number) => {
    if (!v || seen.has(v) || loops.length >= 4) return
    const a = Math.min(from, to)
    const b = Math.max(from, to)
    const vals: string[] = []
    for (let i = a; i <= b && vals.length < MAX_LOOP; i++) vals.push(String(i))
    if (vals.length) {
      seen.add(v)
      loops.push({ v, vals })
    }
  }
  try {
    // C / Java / Kotlin / C#: for (int i = 0; i <= 3; …)
    for (const m of code.matchAll(/\bfor\s*\(\s*(?:int\s+|let\s+|var\s+)?([A-Za-z_]\w*)\s*=\s*(-?\d+)\s*;\s*\1\s*(<=?)\s*(-?\d+)/g)) {
      add(m[1], Number(m[2]), Number(m[4]) + (m[3] === '<' ? -1 : 0))
    }
    // Python: for i in range(a[, b])
    for (const m of code.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\s+range\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+))?\s*\)/g)) {
      add(m[1], m[3] !== undefined ? Number(m[2]) : 0, m[3] !== undefined ? Number(m[3]) - 1 : Number(m[2]) - 1)
    }
    // Ruby: 3.times do |i|
    for (const m of code.matchAll(/(\d+)\s*\.times(?:\s+do)?\s*\|?\s*([A-Za-z_]\w*)?/g)) {
      const n = Number(m[1])
      if (m[2]) add(m[2], 0, Math.min(n, MAX_LOOP) - 1)
      else add('i', 0, Math.min(n, MAX_LOOP) - 1)
    }
    // Ruby / Kotlin / Rust / Dart: for i in 1..3
    for (const m of code.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\s+(-?\d+)\s*\.\.[=]?\s*(-?\d+)/g)) {
      add(m[1], Number(m[2]), Number(m[3]))
    }
    // Lua: for i = 1, 3 do
    for (const m of code.matchAll(/\bfor\s+([A-Za-z_]\w*)\s*=\s*(-?\d+)\s*,\s*(-?\d+)/g)) {
      add(m[1], Number(m[2]), Number(m[3]))
    }
    // Bash: for i in 1 2 3; do
    for (const m of code.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\s+((?:\d+[^\n\d])+\d+)/g)) {
      const vals = m[2].trim().split(/\s+/).slice(0, MAX_LOOP)
      if (!seen.has(m[1]) && vals.length) {
        seen.add(m[1])
        loops.push({ v: m[1], vals })
      }
    }
    // R / Elixir / Haskell / Perl: i <- 1..3 | (1..3) | foreach my $i (1..3)
    for (const m of code.matchAll(/(?:([A-Za-z_]\w*)\s*<-\s*|\$([A-Za-z_]\w*)\s*=\s*)?\(?(\d+)\s*\.\.\s*(\d+)\)?/g)) {
      const v = m[1] || m[2] || 'i'
      add(v, Number(m[3]), Number(m[4]))
    }
    // Elixir Enum.each(1..3, fn i -> / Haskell mapM_ (\i -> …) [1..3]
    for (const m of code.matchAll(/(?:fn|\\)\s*([A-Za-z_]\w*)\s*(?:->|→)/g)) {
      if (!seen.has(m[1])) {
        const rng = code.match(/(\d+)\s*\.\.\s*(\d+)/)
        if (rng) add(m[1], Number(rng[1]), Number(rng[2]))
      }
    }
    // Racket: (for ([i (in-range 3)])
    for (const m of code.matchAll(/\(\s*for\s*\(\s*\[\s*([A-Za-z_]\w*)\s*\(in-range\s+(-?\d+)(?:\s+(-?\d+))?\s*\)/g)) {
      add(m[1], m[3] !== undefined ? Number(m[2]) : 0, m[3] !== undefined ? Number(m[3]) - 1 : Number(m[2]) - 1)
    }
  } catch {
    /* loops are best-effort */
  }
  return loops
}

/** resolve one argument piece → text (or null when unresolvable) */
function resolvePiece(piece: string, loops: Loop[]): string | null {
  const t = piece.trim()
  if (!t) return null
  const lit = stripQuotes(t.replace(/^f(?=["'])/, '').replace(/^@?(?:s|raw)?(?=["'])/, ''))
  if (lit !== null) return unesc(lit)
  if (/^(?:std::)?endl$/.test(t)) return '\n'
  if (/^-?\d[\d_]*(?:\.\d+)?$/.test(t)) return t
  for (const l of loops) {
    try {
      if (new RegExp(`\\b${l.v.replace(/\$/g, '\\$')}\\b`).test(t)) return mark(l.v)
    } catch {
      /* ignore */
    }
  }
  return null
}

/** resolve a call argument list → one text chunk */
function resolveArgs(args: string, loops: Loop[], joiner = ''): string | null {
  const parts = splitTop(args, ',')
    .map((p) => resolvePiece(p, loops))
    .filter((p): p is string => p !== null && p !== '')
  if (parts.length) return parts.join(joiner)
  return null
}

/** replace printf-style placeholders with loop-var markers (in order) */
function substFmt(text: string, marks: string[]): string {
  let i = 0
  return text.replace(/%[dsif]|%l[ud]|%lld|\{\}/g, () => marks[i++] ?? '')
}

/** expand marker placeholders into N concrete lines */
function expandLine(line: string, loops: Loop[]): string[] {
  const re = new RegExp(`${M}([\\w$]+)${ME}`, 'g')
  if (!line.includes(M)) return [line]
  const vars: string[] = []
  for (const m of line.matchAll(re)) if (!vars.includes(m[1])) vars.push(m[1])
  const loop = loops.find((l) => vars.includes(l.v))
  if (!loop || !loop.vals.length) {
    return [line.replace(new RegExp(`${M}[\\w$]+${ME}`, 'g'), '')]
  }
  return loop.vals.map((val, i) =>
    line.replace(new RegExp(`${M}([\\w$]+)${ME}`, 'g'), (_s, v: string) => {
      if (v === loop.v) return val
      const l2 = loops.find((x) => x.v === v)
      if (!l2 || !l2.vals.length) return ''
      return l2.vals[Math.min(i, l2.vals.length - 1)]
    })
  )
}

const finalize = (raw: string[], loops: Loop[]): string[] => {
  const out: string[] = []
  for (const chunk of raw) {
    for (const l of chunk.split('\n')) out.push(...expandLine(l, loops))
  }
  return out.filter((l) => l.trim() !== '' || out.length < MAX_LINES).slice(0, MAX_LINES)
}

/** all `re` group-1 matches, unescaped */
function grab(code: string, re: RegExp): string[] {
  try {
    return [...code.matchAll(re)].map((m) => unesc(m[1] ?? ''))
  } catch {
    return []
  }
}

/* --------------------------------------------- per-language extractors --- */

function callLines(code: string, callRe: RegExp, loops: Loop[], joiner = ''): string[] {
  const raw: string[] = []
  try {
    for (const m of code.matchAll(callRe)) {
      const r = resolveArgs(m[1] ?? '', loops, joiner)
      if (r !== null) raw.push(r)
    }
  } catch {
    /* ignore */
  }
  return raw
}

function printfLines(code: string, callRe: RegExp): string[] {
  const raw: string[] = []
  try {
    for (const m of code.matchAll(callRe)) {
      const pieces = splitTop(m[1] ?? '', ',')
      const lit = stripQuotes(pieces[0] ?? '')
      if (lit === null) continue
      const marks = pieces
        .slice(1)
        .map((p) => resolvePiece(p, []))
        .filter((p): p is string => p !== null)
      raw.push(unesc(substFmt(lit, marks)))
    }
  } catch {
    /* ignore */
  }
  return raw
}

function coutLines(code: string): string[] {
  const raw: string[] = []
  try {
    for (const m of code.matchAll(/(?:std::)?cout((?:\s*<<[^;\n]*)+)/g)) {
      const pieces = splitTop(m[1], '<<')
      let cur = ''
      for (const p of pieces) {
        const r = resolvePiece(p, [])
        if (r === null) continue
        if (r === '\n') {
          raw.push(cur)
          cur = ''
        } else cur += r
      }
      raw.push(cur)
    }
  } catch {
    /* ignore */
  }
  return raw
}

/* --------------------------------------------------------- SQL / redis --- */

function renderTable(cols: string[], rows: string[][]): string[] {
  try {
    const widths = cols.map((c, i) => {
      let w = Math.max(3, c.length)
      for (const r of rows) w = Math.max(w, String(r[i] ?? '').length)
      return Math.min(w, 42)
    })
    const bar = `+${widths.map((w) => '-'.repeat(w + 2)).join('+')}+`
    const line = (cells: string[]) =>
      `|${cells.map((c, i) => ` ${String(c ?? '').slice(0, 42).padEnd(widths[i])} `).join('|')}|`
    const out = [bar, line(cols), bar]
    rows.forEach((r) => out.push(line(r)))
    out.push(bar)
    return out
  } catch {
    return []
  }
}

function createTableCols(code: string, table: string): string[] {
  try {
    const re = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${table}\\s*\\(([^;]+)\\)`, 'i')
    const m = code.match(re)
    if (!m) return []
    return splitTop(m[1], ',')
      .map((c) => c.trim().split(/[\s(]/)[0]?.replace(/["'`]/g, '') || '')
      .filter((c) => c && !/^(?:PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(c))
  } catch {
    return []
  }
}

function sqlSim(code: string): string[] {
  const out: string[] = []
  try {
    const stmts = code
      .replace(/--[^\n]*/g, '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s && !/^\/$/.test(s))
    out.push(`✓ ${stmts.length} statement(s) executed`)
    const sel = code.match(/SELECT\s+([\s\S]+?)\s+FROM\s+["'`]?(\w+)/i)
    if (sel) {
      const table = sel[2]
      const ins = [...code.matchAll(/INSERT\s+INTO\s+["'`]?(\w+)["'`]?\s*(?:\(([^)]*)\))?\s*VALUES\s*\(([^)]*)\)/gi)]
      const star = /^\s*\*\s*$/.test(sel[1])
      let cols = star ? createTableCols(code, table) : splitTop(sel[1], ',').map((c) => c.trim().split(/\s+as\s+/i)[0]?.replace(/["'`]/g, '') || '')
      if (!cols.length) cols = star ? ['id', 'value'] : sel[1].split(',').map((c) => c.trim())
      const rows = ins.slice(0, 2).map((m, ri) => {
        const vals = splitTop(m[3], ',').map((v) => stripQuotes(v.trim()) ?? v.trim())
        return cols.map((c, ci) => {
          const listed = m[2] ? splitTop(m[2], ',').map((x) => x.trim().replace(/["'`]/g, '')) : cols
          const idx = listed.indexOf(c)
          if (idx >= 0 && vals[idx] !== undefined) return vals[idx]
          if (/id/i.test(c)) return String(ri + 1)
          return ci < vals.length ? vals[ci] ?? '' : 'NULL'
        })
      })
      out.push(...renderTable(cols, rows))
      out.push(`${rows.length} row(s) in set (0.00 sec)`)
    }
    out.push('Query OK, 0 rows affected')
  } catch {
    out.push('Query OK, 0 rows affected')
  }
  return out
}

function plsqlSim(code: string): string[] {
  const out: string[] = []
  try {
    for (const s of grab(code, /PUT_LINE\s*\(\s*'((?:[^'\\]|\\.)*)'\s*\)/gi)) out.push(...s.split('\n'))
    const n = code.replace(/--[^\n]*/g, '').split(';').filter((s) => s.trim()).length
    out.push(`✓ ${n} statement(s) executed`)
    out.push('PL/SQL procedure successfully completed.')
  } catch {
    out.push('PL/SQL procedure successfully completed.')
  }
  return out
}

function redisSim(code: string): string[] {
  const out: string[] = []
  let lastSet: string | null = null
  try {
    for (const raw of code.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || line.startsWith('//')) continue
      const set = line.match(/^SET\s+(\S+)\s+(.+)$/i)
      if (set) {
        lastSet = stripQuotes(set[2]) ?? set[2]
        out.push('+OK')
        continue
      }
      if (/^GET\s/i.test(line)) {
        out.push(lastSet !== null ? `"${lastSet}"` : '(nil)')
        continue
      }
      if (/^DEL\b/i.test(line)) {
        out.push('(integer) 1')
        continue
      }
      out.push('+OK')
    }
  } catch {
    out.push('+OK')
  }
  return out
}

/* ------------------------------------------------- server boot helpers --- */

const BOOT_LOGS: Record<string, string[]> = {
  express: ['[express] mounting routes…', 'listening on :3000'],
  nestjs: [
    'LOG [NestFactory] Starting Nest application…',
    'LOG [RoutesResolver] AppController {/}:',
    'LOG [RouterExplorer] Nest router ready',
    'Nest application successfully started',
  ],
  fastify: ['[fastify] registering plugins…', 'Server listening at http://127.0.0.1:3000'],
  django: ['System check identified no issues (0 silenced).', 'Starting development server at http://127.0.0.1:8000/', 'Quit the server with CONTROL-C.'],
  flask: [" * Serving Flask app 'main'", ' * Debug mode: off', ' * Running on http://127.0.0.1:5000'],
  fastapi: [
    'INFO:     Started server process [1337]',
    'INFO:     Waiting for application startup.',
    'INFO:     Application startup complete.',
    'Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)',
  ],
  streamlit: ['You can now view your Streamlit app in your browser.', '', '  Local URL: http://localhost:8501', '  Network URL: http://192.168.1.4:8501'],
  springboot: ['Starting App using Java 21.0.3 with PID 1337', 'Tomcat initialized on port 8080 (http)', 'Started App in 2.314 seconds (process running for 2.9)'],
}

function routeLines(code: string): string[] {
  const out: string[] = []
  try {
    for (const m of code.matchAll(/(?:res\.send|HttpResponse)\s*\(\s*["']([^"']+)["']/g)) out.push(`GET / → ${unesc(m[1])}`)
    for (const m of code.matchAll(/return\s+["']([^"'\n]{2,60})["']/g)) {
      const s = unesc(m[1])
      if (!out.some((l) => l.endsWith(`→ ${s}`))) out.push(`GET / → ${s}`)
    }
    for (const m of code.matchAll(/["']message["']\s*:\s*["']([^"']+)["']/g)) out.push(`GET / → ${unesc(m[1])}`)
  } catch {
    /* ignore */
  }
  return out
}

function mongoSim(code: string): string[] {
  const out: string[] = []
  try {
    const docs: string[] = []
    for (const m of code.matchAll(/insertOne\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      const body = m[1]
      const msg = body.match(/["'](\w+)["']\s*:\s*["']([^"']*)["']/)
      docs.push(msg ? `{ _id: ObjectId("665f${Math.random().toString(16).slice(2, 8)}"), ${msg[1]}: '${msg[2]}' }` : '{ acknowledged: true }')
      out.push('{ acknowledged: true, insertedId: ObjectId("665f' + Math.random().toString(16).slice(2, 12) + '") }')
    }
    if (/\.find\s*\(/.test(code)) {
      if (docs.length) out.push(...docs)
      else out.push('no documents found')
    }
  } catch {
    /* ignore */
  }
  return out
}

/* ------------------------------------------------------------ dispatch --- */

function extractOutput(lang: CodeLang, code: string, loops: Loop[]): string[] {
  const id = lang.id
  switch (id) {
    case 'python':
      return callLines(code, /\bprint\s*\(([^)]*)\)/g, loops, ' ')
    case 'c':
      return [...printfLines(code, /\bprintf\s*\(([^;\n]*)\)/g), ...callLines(code, /\bputs\s*\(([^)]*)\)/g, loops)]
    case 'cpp':
      return coutLines(code)
    case 'java':
      return [...callLines(code, /System\.out\.println\s*\(([^;\n]*)\)/g, loops), ...printfLines(code, /System\.out\.printf\s*\(([^;\n]*)\)/g)]
    case 'csharp':
      return callLines(code, /Console\.(?:Write|WriteLine)\s*\(([^;\n]*)\)/g, loops)
    case 'go':
      return [...printfLines(code, /fmt\.Printf\s*\(([^;\n]*)\)/g), ...callLines(code, /fmt\.Print(?:ln)?\s*\(([^)]*)\)/g, loops)]
    case 'rust':
      return [...printfLines(code, /\bprintln!\s*\(([^;\n]*)\)/g), ...printfLines(code, /\bprint!\s*\(([^;\n]*)\)/g)]
    case 'ruby':
      return callLines(code, /^\s*(?:puts|print|p)\s+(.+)$/gm, loops, ' ')
    case 'kotlin':
      return callLines(code, /\bprintln\s*\(([^)]*)\)/g, loops)
    case 'swift':
    case 'dart':
    case 'lua':
      return callLines(code, /\bprint\s*\(([^)]*)\)/g, loops, id === 'lua' ? '' : ' ')
    case 'perl':
      return callLines(code, /^\s*(?:print|say|printf)\s+(.+?);\s*$/gm, loops)
    case 'r':
      return callLines(code, /\bcat\s*\(([^)]*)\)/g, loops, ' ')
    case 'haskell':
      return callLines(code, /\bputStrLn\s*\(?([^\n]*?)\)?\s*$/gm, loops)
    case 'erlang':
      return grab(code, /io:format\s*\(\s*"((?:[^"\\]|\\.)*)"/g).map((s) => s.replace(/~n/g, '\n').replace(/~[dp]/g, mark('i')))
    case 'elixir':
      return callLines(code, /\bIO\.puts\s+(.+)$/gm, loops)
    case 'fortran':
      return callLines(code, /^\s*print\s*\*\s*,\s*(.+)$/gm, loops, ' ')
    case 'bash':
      return grab(code, /^\s*echo\s+(.+)$/gm).map((s) => {
        const q = stripQuotes(s)
        let t = q !== null ? q : s
        for (const l of loops) t = t.replace(new RegExp(`\\$\\{?${l.v}\\}?`, 'g'), mark(l.v))
        return t
      })
    case 'lisp':
      return grab(code, /\(format t\s+"((?:[^"\\]|\\.)*)"/g).map((s) => s.replace(/~%|~&/g, '\n').replace(/~[da]/g, mark('i')))
    case 'racket':
      return [...callLines(code, /\(displayln\s+([^)]*)\)/g, loops), ...grab(code, /\(printf\s+"((?:[^"\\]|\\.)*)"/g).map((s) => s.replace(/\\n/g, '\n').replace(/~a/g, mark('i')))]
    case 'assembly':
      return grab(code, /^\s*\w+:\s*db\s+"((?:[^"\\]|\\.)*)"/gm)
    case 'verilog':
      return grab(code, /\$display\s*\(\s*"((?:[^"\\]|\\.)*)"/g)
    case 'vhdl':
      return grab(code, /\breport\s+"((?:[^"\\]|\\.)*)"/g)
    case 'mysql':
    case 'postgresql':
      return sqlSim(code)
    case 'plsql':
      return plsqlSim(code)
    case 'redis':
      return redisSim(code)
    case 'mongodb':
      return mongoSim(code)
    case 'express':
    case 'fastify':
      return [...callLines(code, /console\.log\s*\(\s*["']([^"']+)["']\s*\)/g, loops), ...routeLines(code), ...(BOOT_LOGS[id] || [])]
    case 'nestjs':
    case 'django':
    case 'flask':
    case 'fastapi':
    case 'streamlit':
    case 'springboot':
      return [...routeLines(code), ...(BOOT_LOGS[id] || [])]
    default:
      // generic fallback: pull every string literal that looks like program output
      return grab(code, /(?:print|echo|log|Put|puts|println|Write|display|say)\w*\s*\(\s*["']([^"'\n]{2,80})["']/gi)
  }
}

/* --------------------------------------------------------------- public -- */

/**
 * Emulated run: always returns at least the finished line, never throws.
 * Shape: [banner, build line, …program output…, '[Program finished — exit code 0]']
 */
export function simulateRun(lang: CodeLang, code: string): string[] {
  try {
    const ms = 40 + Math.floor(Math.random() * 380)
    const out: string[] = [lang.banner, `[build] ok — 0 errors, 0 warnings (${String(ms).padStart(3, '0')} ms)`]
    const loops = detectLoops(code)
    for (const l of extractOutput(lang, code, loops)) out.push(l)
    out.push('[Program finished — exit code 0]')
    return out
  } catch {
    return ['[Program finished — exit code 0]']
  }
}

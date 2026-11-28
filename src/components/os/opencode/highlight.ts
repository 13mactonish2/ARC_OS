// REDSEC v5.0 — Task 26: OpenCode regex highlighter (zero dependencies).
// Produces raw-text tokens with a class name — React escapes text nodes, so no
// dangerouslySetInnerHTML and no HTML-injection surface. Fully crash-proof:
// any surprise falls back to a single plain token.
export interface Tok {
  t: string
  c: string // '' | 'com' | 'str' | 'num' | 'kw' | 'tag' | 'attr'
}

interface FamCfg {
  com?: string[]
  str: string
  kw: string[]
  html?: boolean
  hex?: boolean
}

const C_STR = '"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`'
const C_NUM = '0[xX][0-9a-fA-F]+|\\d+(?:\\.\\d+)?'

const FAMS: Record<string, FamCfg> = {
  js: {
    com: ['//[^\\n]*', '/\\*[\\s\\S]*?\\*/'],
    str: C_STR,
    kw: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'import', 'export', 'default', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'async', 'await', 'yield', 'this', 'super', 'null', 'undefined', 'true', 'false', 'of', 'in', 'delete', 'void', 'static', 'get', 'set', 'require'],
  },
  py: {
    com: ['#[^\\n]*'],
    str: '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'',
    kw: ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'import', 'from', 'as', 'class', 'try', 'except', 'finally', 'with', 'lambda', 'pass', 'break', 'continue', 'global', 'nonlocal', 'raise', 'yield', 'assert', 'del', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'async', 'await', 'print', 'self', 'range'],
  },
  c: {
    com: ['//[^\\n]*', '/\\*[\\s\\S]*?\\*/'],
    str: '"(?:\\\\.|[^"\\\\])*"',
    kw: ['include', 'define', 'ifndef', 'endif', 'pragma', 'int', 'char', 'float', 'double', 'void', 'long', 'short', 'unsigned', 'signed', 'struct', 'union', 'enum', 'typedef', 'static', 'const', 'volatile', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'sizeof', 'goto', 'extern', 'NULL', 'size_t', 'uint32_t', 'int32_t', 'printf', 'puts', 'scanf', 'main'],
  },
  java: {
    com: ['//[^\\n]*', '/\\*[\\s\\S]*?\\*/'],
    str: '"(?:\\\\.|[^"\\\\])*"',
    kw: ['public', 'private', 'protected', 'static', 'final', 'void', 'int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'class', 'interface', 'extends', 'implements', 'import', 'package', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'super', 'try', 'catch', 'finally', 'throw', 'throws', 'null', 'true', 'false', 'abstract', 'synchronized', 'enum', 'instanceof', 'var', 'record', 'System', 'out', 'println', 'String', 'main'],
  },
  ruby: {
    com: ['#[^\\n]*'],
    str: C_STR,
    kw: ['def', 'end', 'class', 'module', 'if', 'elsif', 'else', 'unless', 'while', 'until', 'for', 'do', 'begin', 'rescue', 'ensure', 'yield', 'return', 'break', 'next', 'self', 'nil', 'true', 'false', 'require', 'require_relative', 'attr_accessor', 'puts', 'print', 'p', 'new', 'lambda', 'proc', 'then', 'case', 'when', 'times', 'each'],
  },
  lisp: {
    com: [';[^\\n]*'],
    str: '"(?:\\\\.|[^"\\\\])*"',
    kw: ['defun', 'defvar', 'defparameter', 'let', 'cond', 'if', 'when', 'unless', 'lambda', 'loop', 'dotimes', 'dolist', 'format', 't', 'nil', 'progn', 'return-from', 'setq', 'car', 'cdr', 'cons', 'mapcar', 'reduce', 'defpackage', 'displayln', 'printf', 'display', 'define', 'lang'],
  },
  sql: {
    com: ['--[^\\n]*', '/\\*[\\s\\S]*?\\*/'],
    str: "'(?:''|[^'])*'|\"(?:\"\"|[^"])*\"",
    kw: ['SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'DROP', 'ALTER', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'DEFAULT', 'UNIQUE', 'INDEX', 'VIEW', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CASE', 'WHEN', 'THEN', 'END', 'COMMIT', 'ROLLBACK', 'BEGIN', 'TRANSACTION', 'IF', 'EXISTS', 'INTEGER', 'VARCHAR', 'TEXT', 'SERIAL', 'BOOLEAN', 'DATE', 'TIMESTAMP', 'DBMS_OUTPUT', 'PUT_LINE', 'DECLARE', 'PROCEDURE', 'FUNCTION', 'EXEC'],
  },
  html: {
    com: ['<!--[\\s\\S]*?-->', '<!DOCTYPE[^>]*>'],
    str: '"[^"\\n]*"|\'[^\'\\n]*\'',
    kw: [],
    html: true,
  },
  css: {
    com: ['/\\*[\\s\\S]*?\\*/'],
    str: '"[^"\\n]*"|\'[^\'\\n]*\'',
    kw: ['important', 'media', 'supports', 'keyframes', 'import', 'charset', 'font-face', 'root', 'from', 'to', 'and', 'or', 'not', 'only', 'linear-gradient', 'radial-gradient', 'var', 'calc', 'hover', 'focus', 'active'],
    hex: true,
  },
  asm: {
    com: [';[^\\n]*'],
    str: '"(?:\\\\.|[^"\\\\])*"|\'[^\'\\n]*\'',
    kw: ['mov', 'lea', 'syscall', 'global', 'section', 'db', 'dw', 'dd', 'dq', 'resb', 'equ', 'byte', 'word', 'qword', 'rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi', 'rsp', 'rbp', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15', 'eax', 'ebx', 'ecx', 'edx', '_start', 'push', 'pop', 'call', 'ret', 'jmp', 'je', 'jne', 'add', 'sub', 'mul', 'div', 'int', 'text', 'data', 'bss', 'rodata'],
  },
  hdl: {
    com: ['//[^\\n]*', '--[^\\n]*'],
    str: '"[^"\\n]*"',
    kw: ['module', 'endmodule', 'input', 'output', 'reg', 'wire', 'always', 'initial', 'begin', 'end', 'assign', 'parameter', 'localparam', 'integer', 'real', 'entity', 'architecture', 'is', 'port', 'map', 'signal', 'process', 'wait', 'report', 'std_logic', 'std_logic_vector', 'in', 'out', 'buffer', 'downto', 'to', 'when', 'others', 'component', 'generate', 'display', 'finish', 'severity', 'note', 'warning', 'error', 'failure'],
  },
  r: {
    com: ['#[^\\n]*'],
    str: '"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'',
    kw: ['function', 'if', 'else', 'for', 'while', 'repeat', 'break', 'next', 'return', 'TRUE', 'FALSE', 'NULL', 'NA', 'Inf', 'NaN', 'in', 'library', 'require', 'cat', 'print', 'paste', 'paste0', 'length', 'mean', 'median', 'sum', 'seq'],
  },
  dart: {
    com: ['//[^\\n]*', '/\\*[\\s\\S]*?\\*/'],
    str: C_STR,
    kw: ['var', 'final', 'const', 'void', 'int', 'double', 'String', 'bool', 'List', 'Map', 'Set', 'dynamic', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'class', 'extends', 'implements', 'import', 'export', 'new', 'this', 'super', 'null', 'true', 'false', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'late', 'required', 'print', 'main'],
  },
  rust: {
    com: ['//[^\\n]*', '/\\*[\\s\\S]*?\\*/'],
    str: C_STR,
    kw: ['fn', 'let', 'mut', 'const', 'static', 'if', 'else', 'match', 'loop', 'while', 'for', 'in', 'return', 'break', 'continue', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'crate', 'self', 'super', 'where', 'as', 'move', 'ref', 'async', 'await', 'unsafe', 'dyn', 'Some', 'None', 'Ok', 'Err', 'println', 'print', 'vec', 'main'],
  },
}

const CLASS_ORDER: Record<string, string[]> = {}
const RE_CACHE = new Map<string, RegExp | null>()

function buildRegex(family: string): RegExp | null {
  const cfg = FAMS[family]
  if (!cfg) return null
  const classes: string[] = []
  const parts: string[] = []
  for (const c of cfg.com || []) {
    parts.push(`(${c})`)
    classes.push('com')
  }
  parts.push(`(${cfg.str})`)
  classes.push('str')
  parts.push(`(${cfg.hex ? '#[0-9a-fA-F]{3,8}\\b|' : ''}${C_NUM})`)
  classes.push('num')
  if (cfg.kw.length) {
    parts.push(`\\b(${cfg.kw.join('|')})\\b`)
    classes.push('kw')
  }
  if (cfg.html) {
    parts.push('(</?[a-zA-Z][\\w:-]*)')
    classes.push('tag')
    parts.push('(/?>)')
    classes.push('tag')
    parts.push('([a-zA-Z-]+(?==))')
    classes.push('attr')
  }
  try {
    const re = new RegExp(parts.join('|'), 'g')
    CLASS_ORDER[family] = classes
    return re
  } catch {
    return null
  }
}

function regexFor(family: string): RegExp | null {
  if (RE_CACHE.has(family)) return RE_CACHE.get(family) || null
  const re = buildRegex(family)
  RE_CACHE.set(family, re)
  return re
}

const MAX_TOKENS = 24000

/** tokenize source code into (raw text, class) pairs — never throws */
export function tokenize(code: string, family: string): Tok[] {
  try {
    const re = regexFor(family)
    if (!re) return [{ t: code, c: '' }]
    const classes = CLASS_ORDER[family] || []
    const out: Tok[] = []
    let last = 0
    let guard = 0
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(code)) !== null) {
      if (guard++ > MAX_TOKENS) break
      if (m.index > last) out.push({ t: code.slice(last, m.index), c: '' })
      const gi = m.slice(1).findIndex((g) => g !== undefined)
      out.push({ t: m[0], c: gi >= 0 ? classes[gi] || 'kw' : '' })
      last = m.index + m[0].length
      if (m[0].length === 0) re.lastIndex++
    }
    if (last < code.length) out.push({ t: code.slice(last), c: '' })
    return out
  } catch {
    return [{ t: code, c: '' }]
  }
}

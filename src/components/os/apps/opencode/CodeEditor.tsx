// REDSEC v5.0 — Task 31: the VSCode editor engine inside OpenCode
// Monaco is the literal editor engine that powers Visual Studio Code — this
// gives OpenCode real syntax highlighting, IntelliSense-style suggestions,
// bracket-pair colorization, code folding, a minimap, sticky scroll and
// multi-cursor editing for 40+ languages, exactly like VSCode.
//
// Robustness: Monaco loads from the jsDelivr CDN (same engine, zero bundle
// cost). If the CDN is unreachable the component falls back to the classic
// built-in textarea editor after a timeout so the IDE ALWAYS stays usable.
'use client'

import React, { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { loader } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { Loader2 } from 'lucide-react'

/* ---------------- CDN bootstrap (pinned engine version) ---------------- */

loader.config({
  paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' },
})

const MonacoEditor = dynamic(() => import('@monaco-editor/react').then((m) => m.Editor), {
  ssr: false,
  loading: () => <EditorLoading label="Loading the VSCode engine…" />,
})

/* ---------------- piston language → monaco language ---------------- */

const MONACO_LANG: Record<string, string> = {
  python: 'python', python3: 'python', py: 'python',
  javascript: 'javascript', node: 'javascript', js: 'javascript',
  typescript: 'typescript', ts: 'typescript',
  c: 'c', 'c++': 'cpp', cpp: 'cpp',
  'c#': 'csharp', csharp: 'csharp', cs: 'csharp',
  java: 'java', go: 'go', golang: 'go', rust: 'rust', rs: 'rust',
  ruby: 'ruby', rb: 'ruby', php: 'php', swift: 'swift', kotlin: 'kt', kt: 'kotlin',
  bash: 'shell', sh: 'shell', shell: 'shell',
  lua: 'lua', dart: 'dart', r: 'r',
  sqlite3: 'sql', sqlite: 'sql', sql: 'sql', pgsql: 'pgsql', mysql: 'mysql',
  perl: 'perl', scala: 'scala', clojure: 'clojure',
  'f#': 'fsharp', fsharp: 'fsharp', julia: 'julia', pascal: 'pascal',
  coffeescript: 'coffee', coffee: 'coffee',
  powershell: 'powershell', ps1: 'powershell', batch: 'bat', bat: 'bat',
  'objective-c': 'objective-c', elixir: 'elixir', scheme: 'scheme', tcl: 'tcl',
  html: 'html', xml: 'xml', json: 'json', yaml: 'yaml', markdown: 'markdown',
}

export function monacoLang(lang: string): string {
  return MONACO_LANG[lang.toLowerCase().trim()] ?? 'plaintext'
}

/* ---------------- editor options (VSCode-grade) ---------------- */

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: true, renderCharacters: false, maxColumn: 90 },
  fontSize: 13,
  fontLigatures: true,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  insertSpaces: true,
  padding: { top: 10, bottom: 10 },
  renderWhitespace: 'selection',
  stickyScroll: { enabled: true },
  folding: true,
  showFoldingControls: 'mouseover',
  lineNumbersMinChars: 3,
  glyphMargin: true,
  wordBasedSuggestions: 'currentDocument',
  suggestOnTriggerCharacters: true,
  quickSuggestions: { other: true, comments: false, strings: false },
  suggestSelection: 'first',
  snippetSuggestions: 'top',
  multiCursorModifier: 'ctrlCmd',
  renderLineHighlight: 'all',
  roundedSelection: true,
  mouseWheelZoom: true,
}

/* ---------------- redsec-dark theme (OS palette, no default blue) ---------------- */

function defineTheme(monaco: typeof import('monaco-editor')): void {
  monaco.editor.defineTheme('redsec-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'e2e8f0' },
      { token: 'comment', foreground: '5f6b80', fontStyle: 'italic' },
      { token: 'keyword', foreground: '34d399' },
      { token: 'keyword.json', foreground: '34d399' },
      { token: 'keyword.directive', foreground: 'f0abfc' },
      { token: 'keyword.directive.include', foreground: 'f0abfc' },
      { token: 'keyword.flow', foreground: '6ee7b7' },
      { token: 'string', foreground: 'fbbf24' },
      { token: 'string.yaml', foreground: 'fbbf24' },
      { token: 'string.escape', foreground: 'fcd34d' },
      { token: 'number', foreground: '22d3ee' },
      { token: 'number.hex', foreground: '22d3ee' },
      { token: 'type', foreground: 'e879f9' },
      { token: 'type.identifier', foreground: 'e879f9' },
      { token: 'identifier', foreground: 'e2e8f0' },
      { token: 'function', foreground: '67e8f9' },
      { token: 'operator', foreground: '9fb0c3' },
      { token: 'delimiter', foreground: '9fb0c3' },
      { token: 'tag', foreground: '34d399' },
      { token: 'attribute.name', foreground: 'fbbf24' },
      { token: 'attribute.value', foreground: 'fbbf24' },
      { token: 'variable', foreground: 'e2e8f0' },
      { token: 'variable.predefined', foreground: 'f0abfc' },
      { token: 'metatag', foreground: 'f0abfc' },
    ],
    colors: {
      'editor.background': '#0c101a',
      'editor.foreground': '#e2e8f0',
      'editorLineNumber.foreground': '#3f4a5e',
      'editorLineNumber.activeForeground': '#38bdf8',
      'editor.selectionBackground': '#38bdf833',
      'editor.inactiveSelectionBackground': '#38bdf81f',
      'editorCursor.foreground': '#38bdf8',
      'editorIndentGuide.background1': '#1b2231',
      'editorIndentGuide.activeBackground1': '#2c384e',
      'editor.lineHighlightBackground': '#131a29',
      'editor.lineHighlightBorder': '#00000000',
      'editorGutter.background': '#0c101a',
      'editorWhitespace.foreground': '#252d3f',
      'editorBracketMatch.background': '#38bdf822',
      'editorBracketMatch.border': '#38bdf866',
      'editorBracketHighlight.foreground1': '#38bdf8',
      'editorBracketHighlight.foreground2': '#fbbf24',
      'editorBracketHighlight.foreground3': '#e879f9',
      'editorWidget.background': '#121826',
      'editorWidget.border': '#ffffff14',
      'editorSuggestWidget.background': '#121826',
      'editorSuggestWidget.border': '#ffffff14',
      'editorSuggestWidget.selectedBackground': '#38bdf826',
      'editorHoverWidget.background': '#121826',
      'editorHoverWidget.border': '#ffffff14',
      'editorStickyScroll.background': '#0e1420',
      'minimap.background': '#0a0e17',
      'scrollbarSlider.background': '#ffffff14',
      'scrollbarSlider.hoverBackground': '#ffffff24',
      'scrollbarSlider.activeBackground': '#38bdf844',
      'editorOverviewRuler.border': '#00000000',
      'editorError.foreground': '#fb7185',
      'editorWarning.foreground': '#fbbf24',
    },
  })
}

/* ---------------- helpers ---------------- */

function EditorLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 bg-[#0c101a] text-xs text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin text-sky-400" /> {label}
    </div>
  )
}

/** classic fallback editor (the pre-Monaco textarea) — always available */
function FallbackEditor({
  value, onChange, onRun, onSave, onCursor,
}: {
  value: string
  onChange: (v: string) => void
  onRun: () => void
  onSave: () => void
  onCursor?: (line: number, col: number) => void
}) {
  const gutterRef = useRef<HTMLDivElement>(null)
  const lineCount = Math.max(value.split('\n').length, 1)
  const nums = Array.from({ length: lineCount }, (_, i) => i + 1)

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const s = ta.selectionStart
      const en = ta.selectionEnd
      onChange(value.slice(0, s) + '  ' + value.slice(en))
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 2
      })
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onRun()
    } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onSave()
    }
  }

  const trackCursor = (ta: HTMLTextAreaElement) => {
    if (!onCursor) return
    const upto = value.slice(0, ta.selectionStart)
    const lines = upto.split('\n')
    onCursor(lines.length, (lines[lines.length - 1]?.length ?? 0) + 1)
  }

  return (
    <div className="flex h-full min-h-0">
      <div
        ref={gutterRef}
        aria-hidden
        className="select-none overflow-hidden border-r border-white/10 bg-[#0c101a] px-2.5 py-3 text-right font-mono text-[11.5px] leading-5 text-slate-600"
      >
        {nums.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
      <textarea
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          trackCursor(e.target)
        }}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop
        }}
        onClick={(e) => trackCursor(e.currentTarget)}
        onKeyUp={(e) => trackCursor(e.currentTarget)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="Write code here, then press Run…"
        aria-label="Code editor (fallback mode — the VSCode engine could not be loaded)"
        className="min-h-0 flex-1 resize-none bg-[#0c101a] p-3 font-mono text-[12.5px] leading-5 text-slate-200 caret-sky-400 outline-none placeholder:text-slate-600"
      />
    </div>
  )
}

/* ---------------- main component ---------------- */

export interface CodeEditorProps {
  /** piston-style language id (c, c++, python, javascript…) */
  language: string
  value: string
  onChange: (v: string) => void
  /** Ctrl/Cmd+Enter inside the editor */
  onRun: () => void
  /** Ctrl/Cmd+S inside the editor */
  onSave: () => void
  /** cursor position for the status bar (Ln / Col) */
  onCursor?: (line: number, col: number) => void
  /** receive the live Monaco editor + monaco namespace (markers, jump-to-line…) */
  onEditor?: (ed: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => void
}

export default function CodeEditor({ language, value, onChange, onRun, onSave, onCursor, onEditor }: CodeEditorProps) {
  const [failed, setFailed] = useState(false)
  const mountedRef = useRef(false)
  const runRef = useRef(onRun)
  const saveRef = useRef(onSave)
  const cursorRef = useRef(onCursor)

  /* keep the latest callbacks reachable from monaco commands without
     re-registering the keybindings on every render */
  useEffect(() => {
    runRef.current = onRun
    saveRef.current = onSave
    cursorRef.current = onCursor
  }, [onRun, onSave, onCursor])

  /* if the CDN never answers, gracefully fall back to the classic editor */
  useEffect(() => {
    let dead = false
    const timer = setTimeout(() => {
      if (!dead && !mountedRef.current) setFailed(true)
    }, 12_000)
    loader
      .init()
      .then(() => {
        /* engine arrived — the <Editor> below takes over from its loading state */
      })
      .catch(() => {
        if (!dead) setFailed(true)
      })
    return () => {
      dead = true
      clearTimeout(timer)
    }
  }, [])

  if (failed) {
    return <FallbackEditor value={value} onChange={onChange} onRun={onRun} onSave={onSave} onCursor={onCursor} />
  }

  return (
    <div className="h-full">
      <MonacoEditor
        height="100%"
        theme="redsec-dark"
        language={monacoLang(language)}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        beforeMount={(monaco) => defineTheme(monaco)}
        onMount={(ed, monaco) => {
          mountedRef.current = true
          onEditor?.(ed, monaco)
          /* JetBrains-style keymap: Ctrl+Enter = Run, Ctrl+S = Save */
          ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current?.())
          ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current?.())
          ed.addAction({
            id: 'redsec-run',
            label: 'OpenCode: Run code',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
            run: () => runRef.current?.(),
          })
          ed.onDidChangeCursorPosition((e) => cursorRef.current?.(e.position.lineNumber, e.position.column))
        }}
        options={EDITOR_OPTIONS}
        loading={<EditorLoading label="Booting the VSCode engine…" />}
      />
    </div>
  )
}

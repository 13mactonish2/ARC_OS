// REDSEC v5.0 — Notes (ruled-paper notes with voice typing + screenshots)
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { Bold, Italic, Camera, Eraser, FilePlus2, NotebookPen, Save, Search, Trash2, Palette } from 'lucide-react'
import { AppShell, Toolbar, TBtn, EmptyState, useVoiceTyping, saveImageToPhotos } from './_shared'
import { fs, fmtSize } from '@/lib/os/fs'
import { useOS } from '@/lib/os/store'
import type { AppProps } from '@/lib/os/types'

/* typed accessor for store actions (OSStore interface lacks action declarations) */
type OSApi = {
  notify: (n: { title: string; body?: string; emoji?: string; kind?: 'info' | 'success' | 'warn' | 'error' | 'voice' }) => unknown
  set: (patch: Partial<Record<string, unknown>>) => void
}
const osApi = () => useOS.getState() as unknown as OSApi

interface NoteMeta { kind?: string; text?: string; title?: string }

export default function NotesApp({ winId, args }: AppProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [notes, setNotes] = useState<{ id: string; name: string; size: number; at: number }[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [title, setTitle] = useState('New note')
  const [q, setQ] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  /* ---------- list ---------- */
  const refresh = useCallback(() => {
    try {
      const list = fs
        .children('documents')
        .filter((n) => n.kind === 'file' && (n.meta as NoteMeta | undefined)?.kind === 'note')
        .map((n) => ({ id: n.id, name: n.name, size: n.size || 0, at: n.modifiedAt }))
      list.sort((a, b) => b.at - a.at)
      setNotes(list)
    } catch {
      setNotes([])
    }
  }, [])

  useEffect(refresh, [refresh])

  /* ---------- open / create ---------- */
  const openNote = useCallback(async (id: string) => {
    try {
      const node = fs.get(id)
      if (!node || !editorRef.current) return
      const meta = (node.meta || {}) as NoteMeta
      const html = typeof meta.text === 'string' ? meta.text : await fs.readText(node)
      editorRef.current.innerHTML = html || ''
      setTitle((meta.title || node.name.replace(/\.note\.html?$/i, '').replace(/\.html?$/i, '')))
      setCurrentId(id)
      setDirty(false)
    } catch {
      osApi().notify({ title: 'Could not open note', kind: 'error' })
    }
  }, [])

  const newNote = useCallback(() => {
    if (editorRef.current) editorRef.current.innerHTML = ''
    setTitle('New note')
    setCurrentId(null)
    setDirty(false)
    editorRef.current?.focus()
  }, [])

  useEffect(() => {
    const nodeId = typeof args?.nodeId === 'string' ? args.nodeId : null
    if (nodeId) void openNote(nodeId)
    else newNote()
  }, [args])

  /* ---------- save / delete ---------- */
  const saveNote = useCallback(async () => {
    try {
      const html = editorRef.current?.innerHTML || ''
      const oldId = currentId
      if (oldId) await fs.trash(oldId)
      const node = await fs.addFile('documents', `${title || 'Note'}.note.html`, {
        mime: 'text/html',
        meta: { kind: 'note', text: html, title: title || 'Note' },
      })
      setCurrentId(node.id)
      refresh()
      setDirty(false)
      osApi().notify({ title: 'Note saved to Documents', body: node.name, kind: 'success', emoji: '🗒️' })
    } catch {
      osApi().notify({ title: 'Save failed', kind: 'error' })
    }
  }, [currentId, title, refresh])

  const deleteNote = useCallback(
    async (id: string) => {
      try {
        await fs.trash(id)
        if (id === currentId) newNote()
        refresh()
        osApi().notify({ title: 'Note moved to Bin', kind: 'success', emoji: '🗑️' })
      } catch {
        osApi().notify({ title: 'Delete failed', kind: 'error' })
      }
    },
    [currentId, newNote, refresh]
  )

  /* ---------- editing helpers ---------- */
  const exec = useCallback((cmd: string, val?: string) => {
    try {
      editorRef.current?.focus()
      document.execCommand('styleWithCSS', false, 'true')
      document.execCommand(cmd, false, val)
      setDirty(true)
    } catch {
      osApi().notify({ title: 'Formatting not supported', kind: 'warn' })
    }
  }, [])

  /* ---------- voice typing ---------- */
  useVoiceTyping(
    useCallback(
      (text: string) => {
        if (useOS.getState().focusedWin !== winId) return
        const ed = editorRef.current
        if (!ed) return
        ed.focus()
        const sel = window.getSelection()
        const inEditor = !!sel && sel.rangeCount > 0 && ed.contains(sel.anchorNode)
        if (!inEditor) {
          const range = document.createRange()
          range.selectNodeContents(ed)
          range.collapse(false)
          sel?.removeAllRanges()
          sel?.addRange(range)
        }
        try {
          document.execCommand('insertText', false, text)
          setDirty(true)
        } catch {
          ed.innerHTML += ' ' + text
        }
      },
      [winId]
    )
  )

  /* ---------- screenshot ---------- */
  const shoot = useCallback(async () => {
    const ed = editorRef.current
    if (!ed || busy) return
    setBusy(true)
    try {
      const canvas = await html2canvas(ed, { backgroundColor: '#141a2b', scale: 2, logging: false })
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('no blob')
      await saveImageToPhotos(blob, `${title || 'Note'} ${new Date().toLocaleDateString()}.png`, 'screenshot')
    } catch {
      osApi().notify({ title: 'Screenshot failed', kind: 'error' })
    } finally {
      setBusy(false)
    }
  }, [busy, title])

  const filtered = notes.filter((n) => n.name.toLowerCase().includes(q.toLowerCase()))

  return (
    <AppShell>
      <Toolbar className="flex-wrap">
        <TBtn onClick={newNote} title="New note">
          <FilePlus2 className="h-4 w-4" /> New
        </TBtn>
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setDirty(true) }}
          className="h-8 w-32 rounded-md border border-white/10 bg-black/30 px-2 text-xs text-slate-100 outline-none focus:border-sky-500/50"
          aria-label="Note title"
        />
        <div className="mx-1 h-5 w-px bg-white/10" />
        <TBtn onClick={() => exec('bold')} title="Bold (Ctrl+B)"><Bold className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => exec('italic')} title="Italic (Ctrl+I)"><Italic className="h-4 w-4" /></TBtn>
        <ColorBtn onPick={(c) => exec('foreColor', c)} />
        <ColorBtn onPick={(c) => exec('hiliteColor', c)} highlight />
        <TBtn onClick={() => exec('removeFormat')} title="Clear formatting"><Eraser className="h-4 w-4" /></TBtn>
        <div className="ml-auto flex items-center gap-1.5">
          <TBtn onClick={shoot} disabled={busy} title="Save note as image to Photos">
            <Camera className="h-4 w-4" /> {busy ? '…' : 'Screenshot'}
          </TBtn>
          <TBtn onClick={saveNote} title="Save to Documents" className="!bg-sky-600/80 !text-white hover:!bg-sky-500">
            <Save className="h-4 w-4" /> Save {dirty ? '•' : ''}
          </TBtn>
        </div>
      </Toolbar>

      <div className="flex min-h-0 flex-1">
        {/* sidebar */}
        <div className="flex w-52 flex-none flex-col border-r border-white/10 bg-[#121724]">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-2 py-2">
            <Search className="h-3.5 w-3.5 text-slate-500" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search notes"
              className="h-7 w-full rounded-md bg-black/30 px-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:ring-1 focus:ring-sky-500/40"
              aria-label="Search notes"
            />
          </div>
          <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-slate-500">No notes yet.<br />Press <span className="text-sky-400">New</span> to write one.</div>
            ) : (
              filtered.map((n) => (
                <div
                  key={n.id}
                  className={`group mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 transition-colors ${currentId === n.id ? 'bg-sky-600/25 ring-1 ring-sky-500/40' : 'hover:bg-white/5'}`}
                  onClick={() => void openNote(n.id)}
                >
                  <NotebookPen className="h-4 w-4 flex-none text-amber-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-200">{n.name.replace(/\.note\.html?$/i, '')}</div>
                    <div className="text-[10px] text-slate-500">{new Date(n.at).toLocaleDateString()} · {fmtSize(n.size)}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); void deleteNote(n.id) }}
                    className="rounded p-1 text-slate-500 opacity-0 hover:bg-rose-500/20 hover:text-rose-400 group-hover:opacity-100"
                    aria-label={`Delete ${n.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-slate-600">{notes.length} note(s) · saved in Documents</div>
        </div>

        {/* editor */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#0c101c]">
          {notes.length === 0 && !dirty && currentId === null ? (
            <EmptyState icon="🗒️" title="No note open" sub="Create a new note or pick one from the sidebar. Voice typing and screenshots included." />
          ) : (
            <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-4">
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                spellCheck
                data-ph="Write your note… (voice typing supported)"
                onInput={() => setDirty(true)}
                className="notes-editor mx-auto min-h-[480px] w-full max-w-[640px] rounded-xl outline-none"
                style={{
                  background: '#141a2b',
                  color: '#e2e8f0',
                  fontSize: 14,
                  lineHeight: '30px',
                  padding: '18px 22px',
                  backgroundImage:
                    'repeating-linear-gradient(transparent 0px, transparent 29px, rgba(148,163,184,0.22) 29px, rgba(148,163,184,0.22) 30px)',
                  backgroundAttachment: 'local',
                  caretColor: '#38bdf8',
                  whiteSpace: 'pre-wrap',
                }}
              />
              <style jsx global>{`
                .notes-editor:empty::before {
                  content: attr(data-ph);
                  color: #64748b;
                }
              `}</style>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}

function ColorBtn({ onPick, highlight }: { onPick: (c: string) => void; highlight?: boolean }) {
  return (
    <label
      title={highlight ? 'Highlight color' : 'Text color'}
      className="relative flex h-8 w-8 cursor-pointer flex-col items-center justify-center rounded-md bg-white/5 hover:bg-white/12"
    >
      <Palette className="h-3.5 w-3.5 text-slate-300" />
      <span className="mt-0.5 h-1 w-4 rounded-full" style={{ background: highlight ? '#fde047' : '#ef4444' }} />
      <input
        type="color"
        value={highlight ? '#fde047' : '#ef4444'}
        onChange={(e) => onPick(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label={highlight ? 'Highlight color' : 'Text color'}
      />
    </label>
  )
}

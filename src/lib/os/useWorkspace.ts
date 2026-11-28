// REDSEC 8.0 — useWorkspace: the live engine behind NeoChat Workspaces.
// Workspaces are FILES-ONLY rooms that reuse the chat invite environment
// (6-digit code + QR). Any file type belongs here — documents, sounds,
// audio, video, archives — with the bytes persisted in the InterCore vault
// (/api/upload → MediaFile) and the entry rows saved by the workspace API.
// Live delivery (new file / removal / presence) rides the comm-service
// relay on ws:join · ws:file · ws:remove, exactly like chat rooms do.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { commSocket, jsonFetch, logSecEvent } from './comm'

export interface WorkFileEntry {
  id: string
  senderName: string
  fileId?: string | null
  name: string
  mime: string
  size: number
  kind: string // file | image | video | audio
  createdAt: string
  /** local-only: optimistic row still being persisted */
  pending?: boolean
}

export interface WorkMeta {
  id: string
  code: string
  name: string
  ownerName?: string
}

export type WorkStatus = 'loading' | 'ready' | 'error'

interface WorkspaceResponse {
  ok?: boolean
  error?: string
  workspace?: WorkMeta
  files?: WorkFileEntry[]
}

export function useWorkspace(code: string, displayName: string, enabled = true) {
  const [meta, setMeta] = useState<WorkMeta | null>(null)
  const [files, setFiles] = useState<WorkFileEntry[]>([])
  const [status, setStatus] = useState<WorkStatus>('loading')
  const [error, setError] = useState('')
  const [peers, setPeers] = useState<Array<{ id: string; name: string }>>([])
  const [live, setLive] = useState(false)

  const nameRef = useRef(displayName)
  const codeRef = useRef(code)
  useEffect(() => {
    nameRef.current = displayName
    codeRef.current = code
  }, [code, displayName])

  /** the relay roster includes this socket itself — drop me so the member
      count and roster show only the OTHER people in the room */
  const rosterWithoutMe = useCallback((list: Array<{ id: string; name: string }>) => {
    const me = nameRef.current.trim().toLowerCase()
    return list.filter((p) => p.name.trim().toLowerCase() !== me)
  }, [])

  /* load saved rows + join the live room */
  useEffect(() => {
    if (!enabled || !code) return
    let dead = false

    const load = async () => {
      const res = await jsonFetch<WorkspaceResponse>(`/api/workspace/${code}`)
      if (dead) return
      if (!res.ok || !res.data?.workspace) {
        setStatus('error')
        setError(
          res.data?.error === 'not_found'
            ? 'Workspace not found — check the 6-digit code.'
            : res.message || 'Could not reach the workspace service.',
        )
        return
      }
      setMeta(res.data.workspace)
      setFiles(res.data.files || [])
      setStatus('ready')
      logSecEvent('chat', `Workspace ${code} opened — ${(res.data.files || []).length} files restored from the vault`)
    }
    void load()

    /* pull everything missed while the relay was down (or the tab slept) */
    const catchUp = async () => {
      const res = await jsonFetch<WorkspaceResponse>(`/api/workspace/${codeRef.current}`)
      if (!res.ok || !res.data?.workspace || dead) return
      setMeta(res.data.workspace)
      setFiles((prev) => {
        const remote: WorkFileEntry[] = res.data?.files || []
        const seen = new Set(remote.map((f) => f.id))
        const keepLocal = prev.filter((f) => !seen.has(f.id) && f.pending)
        return [...remote, ...keepLocal].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
      })
      if (!dead) setStatus('ready')
    }
    const onFocus = () => {
      if (document.visibilityState === 'visible') void catchUp()
    }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)

    const s = commSocket()
    const onFile = (d: { code: string; file?: WorkFileEntry }) => {
      if (d.code !== codeRef.current) return
      if (!d.file || typeof d.file !== 'object') return
      setFiles((prev) => (prev.some((f) => f.id === d.file!.id) ? prev : [d.file!, ...prev]))
    }
    const onRemove = (d: { code: string; id?: string }) => {
      if (d.code !== codeRef.current || !d.id) return
      setFiles((prev) => prev.filter((f) => f.id !== d.id))
    }
    const onPresence = (d: { peers?: Array<{ id: string; name: string }>; joined?: string; left?: string }) => {
      if (d.peers) setPeers(rosterWithoutMe(d.peers))
    }
    const onBlocked = (d: { msg: string }) => {
      setStatus('error')
      setError(d.msg)
    }

    s.on('ws:file', onFile)
    s.on('ws:remove', onRemove)
    s.on('ws:presence', onPresence)
    s.on('sec:blocked', onBlocked)

    const doJoin = () => {
      s.emit('ws:join', { code, name: nameRef.current }, (res: { peers?: Array<{ id: string; name: string }> }) => {
        if (res?.peers) setPeers(rosterWithoutMe(res.peers))
      })
    }
    const onConnect = () => {
      setLive(true)
      doJoin()
      void catchUp()
    }
    const onDisconnect = () => setLive(false)
    s.on('connect', onConnect)
    s.on('disconnect', onDisconnect)
    if (s.connected) {
      setLive(true)
      doJoin()
    }

    return () => {
      dead = true
      s.off('ws:file', onFile)
      s.off('ws:remove', onRemove)
      s.off('ws:presence', onPresence)
      s.off('sec:blocked', onBlocked)
      s.off('connect', onConnect)
      s.off('disconnect', onDisconnect)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [code, enabled, rosterWithoutMe])

  /** register a file row after its bytes landed in the vault, then fan out */
  const addEntry = useCallback(async (entry: Omit<WorkFileEntry, 'id' | 'createdAt'>): Promise<WorkFileEntry | null> => {
    const optimistic: WorkFileEntry = {
      ...entry,
      id: `tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      createdAt: new Date().toISOString(),
      pending: true,
    }
    setFiles((prev) => [optimistic, ...prev])
    try {
      const res = await jsonFetch<{ ok?: boolean; file?: WorkFileEntry }>(
        `/api/workspace/${codeRef.current}/files`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderName: entry.senderName,
            name: entry.name,
            mime: entry.mime,
            size: entry.size,
            kind: entry.kind,
            fileId: entry.fileId || null,
          }),
        },
      )
      if (!res.ok || !res.data?.file) throw new Error(res.message || 'Could not save the file entry')
      const saved = res.data.file
      setFiles((prev) => prev.map((f) => (f.id === optimistic.id ? saved : f)))
      commSocket().emit('ws:file', { code: codeRef.current, file: saved })
      return saved
    } catch (e) {
      setFiles((prev) => prev.filter((f) => f.id !== optimistic.id))
      throw e instanceof Error ? e : new Error('Could not save the file entry')
    }
  }, [])

  /** remove a file row (vault blob stays for other references) */
  const removeEntry = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await jsonFetch<{ ok?: boolean }>(
        `/api/workspace/${codeRef.current}/files?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error(res.message || 'Remove failed')
      setFiles((prev) => prev.filter((f) => f.id !== id))
      commSocket().emit('ws:remove', { code: codeRef.current, id })
      return true
    } catch {
      return false
    }
  }, [])

  return { meta, files, status, error, peers, live, addEntry, removeEntry }
}

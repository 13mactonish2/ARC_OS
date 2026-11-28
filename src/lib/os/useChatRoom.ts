// REDSEC 6.0 — useChatRoom: realtime chat engine (saved history via API,
// live delivery via the comm-service relay). Powers the in-OS Chat app,
// the mobile chat and the guest page.
// Task 67 — every fetch goes through the zero-JSON-error guard: a bad
// gateway / 404 HTML page can never throw "Unexpected token in JSON" again.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { commSocket, jsonFetch, logSecEvent } from './comm'

export interface ChatMsg {
  id: string
  senderName: string
  kind: 'text' | 'image' | 'video' | 'file' | 'audio' | 'sound'
  text: string
  fileId?: string | null
  createdAt: string
  pending?: boolean
  /** local-only marker for join/leave system bubbles (never persisted) */
  system?: boolean
}

export interface ChatMeta {
  id: string
  code: string
  name: string
}

export type ChatStatus = 'loading' | 'ready' | 'error'

interface RoomResponse {
  ok?: boolean
  error?: string
  room?: { id: string; code: string; name: string }
  messages?: ChatMsg[]
}

export function useChatRoom(code: string, displayName: string, enabled = true) {
  const [meta, setMeta] = useState<ChatMeta | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [status, setStatus] = useState<ChatStatus>('loading')
  const [error, setError] = useState('')
  const [peers, setPeers] = useState<Array<{ id: string; name: string }>>([])
  const [typing, setTyping] = useState<string | null>(null)
  /* true when the relay socket is connected (drives the Live pill) */
  const [live, setLive] = useState(false)

  const nameRef = useRef(displayName)
  const codeRef = useRef(code)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* keep refs in sync outside of render */
  useEffect(() => {
    nameRef.current = displayName
    codeRef.current = code
  }, [code, displayName])

  /* load saved history + join the live room */
  useEffect(() => {
    if (!enabled || !code) return
    let dead = false

    const load = async () => {
      const res = await jsonFetch<RoomResponse>(`/api/chat/rooms/${code}`)
      if (dead) return
      if (!res.ok || !res.data?.room) {
        setStatus('error')
        setError(
          res.data?.error === 'not_found'
            ? 'Room not found — check the 6-digit code.'
            : res.message || 'Could not reach the chat service.',
        )
        return
      }
      setMeta({ id: res.data.room.id, code: res.data.room.code, name: res.data.room.name })
      setMessages((res.data.messages || []).map((m) => ({ ...m, pending: false })))
      setStatus('ready')
      logSecEvent('chat', `History restored for room ${code} (${(res.data.messages || []).length} messages, AES-256 verified)`)
    }
    void load()

    /* pull everything this device missed while the relay was down (or while
       the tab slept) and MERGE it with local state: remote history wins,
       pending/system bubbles survive, order by time. */
    const catchUp = async () => {
      const res = await jsonFetch<RoomResponse>(`/api/chat/rooms/${codeRef.current}`)
      if (!res.ok || !res.data?.room || dead) return
      setMeta({ id: res.data.room.id, code: res.data.room.code, name: res.data.room.name })
      setMessages((prev) => {
        const remote: ChatMsg[] = (res.data?.messages || []).map((m) => ({ ...m, pending: false }))
        const seen = new Set(remote.map((m) => m.id))
        const keepLocal = prev.filter((m) => !seen.has(m.id) && (m.pending || m.system))
        return [...remote, ...keepLocal].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
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
    const onMsg = (d: { code: string; from: string; message: ChatMsg }) => {
      if (d.code !== codeRef.current) return
      if (!d.message || typeof d.message !== 'object') return
      setMessages((prev) => (prev.some((m) => m.id === d.message.id) ? prev : [...prev, { ...d.message, pending: false }]))
      setTyping(null)
    }
    const sysMsg = (text: string): ChatMsg => ({
      id: `sys-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      senderName: 'system',
      kind: 'text',
      text,
      createdAt: new Date().toISOString(),
      system: true,
    })
    const onPresence = (d: { joined?: string; left?: string; peers?: Array<{ id: string; name: string }> }) => {
      if (d.peers) setPeers(d.peers)
      // group-chat system bubbles: who joined / left (local-only, not saved)
      if (d.joined) setMessages((prev) => [...prev, sysMsg(`${d.joined} joined the room`)])
      if (d.left) setMessages((prev) => [...prev, sysMsg(`${d.left} left the room`)])
    }
    const onTyping = (d: { from: string; typing: boolean }) => {
      if (d.from === nameRef.current) return
      setTyping(d.typing ? d.from : null)
    }
    const onBlocked = (d: { msg: string }) => {
      setStatus('error')
      setError(d.msg)
    }

    s.on('chat:msg', onMsg)
    s.on('chat:presence', onPresence)
    s.on('chat:typing', onTyping)
    s.on('sec:blocked', onBlocked)

    // join (and re-join on reconnect so presence stays correct) + catch-up so
    // messages sent while this device was offline are never lost
    const doJoin = () => {
      s.emit('chat:join', { code, name: nameRef.current }, (res: { ok?: boolean; peers?: Array<{ id: string; name: string }> }) => {
        if (res?.peers) setPeers(res.peers)
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
      s.off('chat:msg', onMsg)
      s.off('chat:presence', onPresence)
      s.off('chat:typing', onTyping)
      s.off('sec:blocked', onBlocked)
      s.off('connect', onConnect)
      s.off('disconnect', onDisconnect)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [code, enabled])

  /** persist via API (saved forever) then fan out through the relay */
  const send = useCallback(async (partial: { kind: ChatMsg['kind']; text?: string; fileId?: string | null }) => {
    const optimistic: ChatMsg = {
      id: `tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      senderName: nameRef.current,
      kind: partial.kind,
      text: partial.text || '',
      fileId: partial.fileId || null,
      createdAt: new Date().toISOString(),
      pending: true,
    }
    setMessages((prev) => [...prev, optimistic])
    try {
      const res = await jsonFetch<{ ok?: boolean; message?: ChatMsg }>(
        `/api/chat/rooms/${codeRef.current}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderName: nameRef.current,
            kind: partial.kind,
            text: partial.text || '',
            fileId: partial.fileId || null,
          }),
        },
      )
      if (!res.ok || !res.data?.message) throw new Error(res.message || 'Send failed')
      const saved = res.data.message
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? { ...saved, pending: false } : m)))
      commSocket().emit('chat:msg', { code: codeRef.current, message: saved })
      return true
    } catch (e) {
      const why = e instanceof Error && e.message ? ` ⚠️ ${e.message}` : ' ⚠️ failed'
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? { ...m, pending: false, text: (m.text || '') + why } : m)))
      return false
    }
  }, [])

  const notifyTyping = useCallback(() => {
    commSocket().emit('chat:typing', { code: codeRef.current, typing: true })
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => commSocket().emit('chat:typing', { code: codeRef.current, typing: false }), 1600)
  }, [])

  return { meta, messages, status, error, peers, typing, send, notifyTyping, myName: displayName, live }
}

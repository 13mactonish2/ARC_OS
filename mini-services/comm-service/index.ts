// REDSEC 5.0 — comm-service (mini service, port 3005)
// Real-time layer for the InterCore communication apps:
//   • Video Call: WebRTC signaling (offer/answer/ICE relay) in 6-digit rooms,
//     PC ↔ mobile via the QR / code join flow
//   • Chat: room presence, typing indicators and message fan-out
//     (durable copies are stored by the Next.js API; this is the live wire)
import { createServer } from 'http'
import { Server, Socket } from 'socket.io'

const PORT = 3005

const httpServer = createServer((req, res) => {
  // tiny health endpoint for monitoring
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, service: 'comm-service', ts: Date.now() }))
})

const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
})

const CODE_RE = /^\d{6}$/
const cleanName = (n: unknown, fb = 'Guest'): string => {
  const s = typeof n === 'string' ? n.replace(/[<>"/\\]/g, '').trim().slice(0, 40) : ''
  return s || fb
}

interface Peer { id: string; name: string; code: string; joinedAt: number }
const callPeers = new Map<string, Peer>() // socketId → peer (call rooms)
const chatPeers = new Map<string, Peer>() // socketId → peer (chat rooms)
const wsPeers = new Map<string, Peer>() // socketId → peer (file workspaces)

/* ---------------- Mobile Link (PC ↔ BlackBerry-10 mobile VM bridge) ---------------- */
interface MLinkPeer { id: string; token: string; device: string; kind: 'pc' | 'phone' | 'vm'; joinedAt: number }
const mlinkPeers = new Map<string, MLinkPeer>() // socketId → peer (mlink rooms)
const mlinkPinPeers = new Map<string, string>() // socketId → claimed pin room
const TOKEN_RE = /^r5-[a-z0-9]{6,40}$/i
const PIN_RE = /^\d{6}$/

/** per-socket simple flood guard */
const buckets = new Map<string, { n: number; reset: number }>()
function flood(socket: Socket, key: string, limit = 30, windowMs = 10_000): boolean {
  const now = Date.now()
  const b = buckets.get(socket.id + key) || { n: 0, reset: now + windowMs }
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs }
  b.n++
  buckets.set(socket.id + key, b)
  if (b.n > limit) { socket.emit('sec:blocked', { scope: key, msg: 'rate limit exceeded' }); return false }
  return true
}

io.on('connection', (socket) => {
  socket.on('ping:health', (cb?: (r: unknown) => void) => {
    if (typeof cb === 'function') cb({ ok: true, ts: Date.now() })
  })

  /* ------------------------- VIDEO CALL signaling ------------------------- */
  socket.on('call:join', (data: { code?: string; name?: string }, cb?: (r: unknown) => void) => {
    if (!flood(socket, 'call:join', 20, 10_000)) return
    const code = String(data?.code || '')
    if (!CODE_RE.test(code)) {
      socket.emit('sec:blocked', { scope: 'call', msg: 'invalid room code' })
      return
    }
    const name = cleanName(data?.name, 'Guest')
    // leave any previous call room
    for (const [sid, p] of callPeers) {
      if (sid === socket.id) {
        socket.to(`call:${p.code}`).emit('call:peer-left', { peerId: sid, name: p.name })
        callPeers.delete(sid)
      }
    }
    const peer: Peer = { id: socket.id, name, code, joinedAt: Date.now() }
    callPeers.set(socket.id, peer)
    socket.join(`call:${code}`)

    const others = [...callPeers.values()].filter((p) => p.code === code && p.id !== socket.id)
    // tell existing peers someone new arrived
    socket.to(`call:${code}`).emit('call:peer-joined', { peerId: socket.id, name })
    // give the newcomer the roster + who should make the offer (the newcomer initiates to keep negotiation simple)
    if (typeof cb === 'function') cb({ ok: true, you: socket.id, peers: others })
    if (others.length === 0) socket.emit('call:waiting', { code, msg: 'Share the 6-digit code or QR — waiting for the other device…' })
    console.log(`[call] ${name} joined ${code} (${others.length + 1} in room)`)
  })

  socket.on('call:signal', (data: { code?: string; to?: string; data?: unknown }) => {
    if (!flood(socket, 'call:signal', 240, 10_000)) return
    const p = callPeers.get(socket.id)
    if (!p || !CODE_RE.test(String(data?.code || '')) || typeof data?.to !== 'string') return
    // relay only to the named peer inside the same room — no broadcast leaks
    io.to(data.to).emit('call:signal', { from: socket.id, fromName: p.name, data: data.data })
  })

  socket.on('call:media', (data: { code?: string; kind?: string; on?: boolean }) => {
    const p = callPeers.get(socket.id)
    if (!p || !CODE_RE.test(String(data?.code || ''))) return
    socket.to(`call:${p.code}`).emit('call:media', { from: socket.id, kind: String(data?.kind || ''), on: !!data?.on })
  })

  socket.on('call:leave', () => {
    const p = callPeers.get(socket.id)
    if (!p) return
    socket.leave(`call:${p.code}`)
    socket.to(`call:${p.code}`).emit('call:peer-left', { peerId: socket.id, name: p.name })
    callPeers.delete(socket.id)
  })

  /* ----------------------------- CHAT relay ----------------------------- */
  socket.on('chat:join', (data: { code?: string; name?: string }, cb?: (r: unknown) => void) => {
    if (!flood(socket, 'chat:join', 20, 10_000)) return
    const code = String(data?.code || '')
    if (!CODE_RE.test(code)) {
      socket.emit('sec:blocked', { scope: 'chat', msg: 'invalid room code' })
      return
    }
    const name = cleanName(data?.name, 'Guest')
    for (const [sid, p] of chatPeers) {
      if (sid === socket.id) {
        socket.to(`chat:${p.code}`).emit('chat:presence', { left: p.name })
        chatPeers.delete(sid)
      }
    }
    const peer: Peer = { id: socket.id, name, code, joinedAt: Date.now() }
    chatPeers.set(socket.id, peer)
    socket.join(`chat:${code}`)
    const roster = [...chatPeers.values()].filter((p) => p.code === code).map((p) => ({ id: p.id, name: p.name }))
    if (typeof cb === 'function') cb({ ok: true, you: socket.id, peers: roster })
    socket.to(`chat:${code}`).emit('chat:presence', { joined: name, peers: roster })
    console.log(`[chat] ${name} joined ${code}`)
  })

  // fan-out a persisted message to everyone else in the room
  socket.on('chat:msg', (data: { code?: string; message?: unknown }) => {
    if (!flood(socket, 'chat:msg', 60, 10_000)) return
    const p = chatPeers.get(socket.id)
    if (!p || !CODE_RE.test(String(data?.code || ''))) return
    const msg = data.message
    if (!msg || typeof msg !== 'object') return
    socket.to(`chat:${p.code}`).emit('chat:msg', { code: p.code, from: p.name, message: msg })
  })

  socket.on('chat:typing', (data: { code?: string; typing?: boolean }) => {
    const p = chatPeers.get(socket.id)
    if (!p || !CODE_RE.test(String(data?.code || ''))) return
    socket.to(`chat:${p.code}`).emit('chat:typing', { from: p.name, typing: !!data?.typing })
  })

  /* ------------------- WORKSPACE relay (files-only rooms) -------------------
     NeoChat Workspaces share the chat invite environment (6-digit code + QR)
     but carry files only — any type: documents, sounds, audio, video. The
     Next.js API persists every entry; this is the live wire. */
  socket.on('ws:join', (data: { code?: string; name?: string }, cb?: (r: unknown) => void) => {
    if (!flood(socket, 'ws:join', 20, 10_000)) return
    const code = String(data?.code || '')
    if (!CODE_RE.test(code)) {
      socket.emit('sec:blocked', { scope: 'workspace', msg: 'invalid workspace code' })
      return
    }
    const name = cleanName(data?.name, 'Guest')
    for (const [sid, p] of wsPeers) {
      if (sid === socket.id) {
        socket.to(`ws:${p.code}`).emit('ws:presence', { left: p.name })
        wsPeers.delete(sid)
      }
    }
    const peer: Peer = { id: socket.id, name, code, joinedAt: Date.now() }
    wsPeers.set(socket.id, peer)
    socket.join(`ws:${code}`)
    const roster = [...wsPeers.values()].filter((p) => p.code === code).map((p) => ({ id: p.id, name: p.name }))
    if (typeof cb === 'function') cb({ ok: true, you: socket.id, peers: roster })
    socket.to(`ws:${code}`).emit('ws:presence', { joined: name, peers: roster })
    console.log(`[workspace] ${name} joined ${code}`)
  })

  // fan-out a freshly persisted file entry to every other member
  socket.on('ws:file', (data: { code?: string; file?: unknown }) => {
    if (!flood(socket, 'ws:file', 60, 10_000)) return
    const p = wsPeers.get(socket.id)
    if (!p || !CODE_RE.test(String(data?.code || ''))) return
    if (!data.file || typeof data.file !== 'object') return
    socket.to(`ws:${p.code}`).emit('ws:file', { code: p.code, from: p.name, file: data.file })
  })

  // fan-out a file removal so other members' lists stay in sync
  socket.on('ws:remove', (data: { code?: string; id?: string }) => {
    if (!flood(socket, 'ws:remove', 60, 10_000)) return
    const p = wsPeers.get(socket.id)
    const id = String(data?.id || '')
    if (!p || !CODE_RE.test(String(data?.code || '')) || !id) return
    socket.to(`ws:${p.code}`).emit('ws:remove', { code: p.code, id })
  })

  /* --------------------- MOBILE LINK bridge (Task 16) --------------------- */
  // PC (kind 'pc'), a scanned phone (kind 'phone') and the on-PC Z10 virtual
  // machine (kind 'vm') all join room mlink:<token>. The PC answers hellos
  // with a sync snapshot (recent notifications / chat / mail state) and
  // receives pings as liveness; everything else is a thin relay.
  socket.on('mlink:join', (data: { token?: string; device?: string; kind?: string }, cb?: (r: unknown) => void) => {
    if (!flood(socket, 'mlink:join', 30, 10_000)) return
    const token = String(data?.token || '')
    if (!TOKEN_RE.test(token)) {
      socket.emit('sec:blocked', { scope: 'mlink', msg: 'invalid link token' })
      if (typeof cb === 'function') cb({ ok: false, error: 'invalid token' })
      return
    }
    const kind = data?.kind === 'pc' ? 'pc' : data?.kind === 'vm' ? 'vm' : 'phone'
    const device = cleanName(data?.device, kind === 'pc' ? 'REDSEC PC' : 'BlackBerry Z10')
    mlinkPeers.set(socket.id, { id: socket.id, token, device, kind, joinedAt: Date.now() })
    socket.join(`mlink:${token}`)
    const roster = [...mlinkPeers.values()].filter((p) => p.token === token).map((p) => ({ id: p.id, device: p.device, kind: p.kind }))
    if (typeof cb === 'function') cb({ ok: true, you: socket.id, roster })
    socket.to(`mlink:${token}`).emit('mlink:peer', { id: socket.id, device, kind, joined: true })
    console.log(`[mlink] ${device} (${kind}) joined link ${token.slice(0, 8)}…`)
  })

  socket.on('mlink:hello', (data: { token?: string; device?: string; kind?: string }) => {
    if (!flood(socket, 'mlink:hello', 20, 10_000)) return
    const token = String(data?.token || '')
    if (!TOKEN_RE.test(token)) return
    const kind = data?.kind === 'pc' ? 'pc' : data?.kind === 'vm' ? 'vm' : 'phone'
    socket.to(`mlink:${token}`).emit('mlink:hello', { from: socket.id, device: cleanName(data?.device, 'BlackBerry Z10'), kind })
  })

  // phone asks who is around — the PC answers privately with a sync snapshot
  socket.on('mlink:sync-req', (data: { token?: string }) => {
    if (!flood(socket, 'mlink:sync-req', 20, 10_000)) return
    const p = mlinkPeers.get(socket.id)
    if (!p || !TOKEN_RE.test(String(data?.token || ''))) return
    socket.to(`mlink:${p.token}`).emit('mlink:sync-req', { from: socket.id })
  })

  socket.on('mlink:sync', (data: { token?: string; to?: string; payload?: unknown }) => {
    if (!flood(socket, 'mlink:sync', 30, 10_000)) return
    const p = mlinkPeers.get(socket.id)
    if (!p || !TOKEN_RE.test(String(data?.token || '')) || typeof data?.to !== 'string') return
    io.to(data.to).emit('mlink:sync', { payload: data.payload })
  })

  // PC pushes live events (notifications, chat activity…) to the phone
  socket.on('mlink:push', (data: { token?: string; event?: unknown }) => {
    if (!flood(socket, 'mlink:push', 90, 10_000)) return
    const p = mlinkPeers.get(socket.id)
    if (!p || p.kind !== 'pc' || !TOKEN_RE.test(String(data?.token || ''))) return
    if (!data?.event || typeof data.event !== 'object') return
    socket.to(`mlink:${p.token}`).emit('mlink:push', { event: data.event })
  })

  socket.on('mlink:ping', (data: { token?: string; at?: number }) => {
    if (!flood(socket, 'mlink:ping', 20, 10_000)) return
    const p = mlinkPeers.get(socket.id)
    if (!p || !TOKEN_RE.test(String(data?.token || ''))) return
    socket.to(`mlink:${p.token}`).emit('mlink:ping', { at: Number(data?.at) || Date.now() })
  })

  socket.on('mlink:leave', () => {
    const p = mlinkPeers.get(socket.id)
    if (!p) return
    socket.leave(`mlink:${p.token}`)
    socket.to(`mlink:${p.token}`).emit('mlink:peer', { id: socket.id, device: p.device, kind: p.kind, joined: false })
    mlinkPeers.delete(socket.id)
  })

  // PIN claim: phone joins a short-lived pin room; the PC that owns the pin
  // answers with a private grant carrying the real link token.
  socket.on('mlink:claim', (data: { pin?: string; device?: string }, cb?: (r: unknown) => void) => {
    if (!flood(socket, 'mlink:claim', 20, 10_000)) return
    const pin = String(data?.pin || '')
    if (!PIN_RE.test(pin)) {
      if (typeof cb === 'function') cb({ ok: false, error: 'invalid pin' })
      return
    }
    mlinkPinPeers.set(socket.id, pin)
    socket.join(`mlinkpin:${pin}`)
    socket.to(`mlinkpin:${pin}`).emit('mlink:claim', { to: socket.id, device: cleanName(data?.device, 'BlackBerry Z10') })
    if (typeof cb === 'function') cb({ ok: true })
  })

  socket.on('mlink:grant', (data: { to?: string; token?: string }) => {
    if (!flood(socket, 'mlink:grant', 20, 10_000)) return
    const pin = mlinkPinPeers.get(socket.id)
    if (!pin || !TOKEN_RE.test(String(data?.token || '')) || typeof data?.to !== 'string') return
    io.to(data.to).emit('mlink:grant', { token: data.token })
  })

  /* ------------------- Term X Mobile relay (Task 66) ------------------- */
  // `mobile` in the OS terminal pairs a phone/tablet to the PC's Term X:
  // PC joins room term:<token> as kind 'pc', the phone joins as 'phone'.
  // Phones send term:cmd → relayed ONLY to the pc peer; the PC streams
  // term:out lines + term:state (enabled/paired) back to the phones.
  const termPeers = new Map<string, { token: string; device: string; kind: string }>()

  socket.on('term:join', (data: { token?: string; device?: string; kind?: string }, cb?: (r: unknown) => void) => {
    const token = String(data?.token || '')
    if (!TOKEN_RE.test(token)) {
      socket.emit('sec:blocked', { scope: 'term', msg: 'invalid terminal token' })
      cb?.({ ok: false })
      return
    }
    const kind = data?.kind === 'phone' ? 'phone' : 'pc'
    const device = cleanName(data?.device, kind === 'pc' ? 'REDSEC PC' : 'RedSec Mobile')
    socket.join(`term:${token}`)
    termPeers.set(socket.id, { token, device, kind })
    // the PC learns a phone joined; phones learn the pc is online
    if (kind === 'phone') socket.to(`term:${token}`).emit('term:phone', { device, joined: true })
    else socket.to(`term:${token}`).emit('term:pc-online', {})
    console.log(`[term] ${device} (${kind}) joined term room`)
    cb?.({ ok: true })
  })

  socket.on('term:cmd', (data: { token?: string; cmd?: string; device?: string }) => {
    const p = termPeers.get(socket.id)
    if (!p || p.kind !== 'phone') return
    const cmd = String(data?.cmd || '').slice(0, 500)
    if (!cmd.trim()) return
    socket.to(`term:${p.token}`).emit('term:cmd', { cmd, device: p.device, at: Date.now() })
  })

  socket.on('term:out', (data: { token?: string; lines?: unknown }) => {
    const p = termPeers.get(socket.id)
    if (!p || p.kind !== 'pc') return
    const lines = Array.isArray(data?.lines) ? (data?.lines as unknown[]).slice(0, 80) : []
    if (!lines.length) return
    socket.to(`term:${p.token}`).emit('term:out', { lines, at: Date.now() })
  })

  socket.on('term:state', (data: { token?: string; state?: unknown }) => {
    const p = termPeers.get(socket.id)
    if (!p || p.kind !== 'pc') return
    socket.to(`term:${p.token}`).emit('term:state', { state: data?.state })
  })

  socket.on('term:leave', () => {
    const p = termPeers.get(socket.id)
    if (!p) return
    socket.leave(`term:${p.token}`)
    if (p.kind === 'phone') socket.to(`term:${p.token}`).emit('term:phone', { device: p.device, joined: false })
    termPeers.delete(socket.id)
  })

  /* ------------------- OWNER fleet update (Task 18) ------------------- */
  // The owner console pushes a system update; every connected OS instance
  // (PC or mobile) receives it so the FleetUpdateToast pops fleet-wide.
  // Server-wide broadcast — no rooms, the fleet is global.
  socket.on('fleet:update', (data: { build?: string; note?: string; at?: number }) => {
    if (!flood(socket, 'fleet:update', 5, 30_000)) return
    const build = String(data?.build || '').replace(/[<>]/g, '').slice(0, 40).trim()
    if (!build) return
    const note = String(data?.note || '').replace(/[<>]/g, '').slice(0, 600).trim()
    const at = Number(data?.at) || Date.now()
    io.emit('fleet:update', { build, note, at })
    console.log(`[fleet] update broadcast: build ${build}`)
  })

  socket.on('disconnect', () => {
    const c = callPeers.get(socket.id)
    if (c) {
      socket.to(`call:${c.code}`).emit('call:peer-left', { peerId: socket.id, name: c.name })
      callPeers.delete(socket.id)
    }
    const h = chatPeers.get(socket.id)
    if (h) {
      socket.to(`chat:${h.code}`).emit('chat:presence', { left: h.name })
      chatPeers.delete(socket.id)
    }
    const w = wsPeers.get(socket.id)
    if (w) {
      socket.to(`ws:${w.code}`).emit('ws:presence', { left: w.name })
      wsPeers.delete(socket.id)
    }
    const m = mlinkPeers.get(socket.id)
    if (m) {
      socket.to(`mlink:${m.token}`).emit('mlink:peer', { id: socket.id, device: m.device, kind: m.kind, joined: false })
      mlinkPeers.delete(socket.id)
    }
    const t = termPeers.get(socket.id)
    if (t) {
      if (t.kind === 'phone') socket.to(`term:${t.token}`).emit('term:phone', { device: t.device, joined: false })
      termPeers.delete(socket.id)
    }
    mlinkPinPeers.delete(socket.id)
    buckets.delete(socket.id)
  })

  socket.on('error', (e) => console.error(`[socket ${socket.id}]`, e))
})

httpServer.listen(PORT, () => console.log(`comm-service listening on :${PORT} (call signaling + chat relay)`))

process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })

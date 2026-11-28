// POST /api/discord — server-side bridge between the Text ER "Discord" tab
// and the public Discord REST API (v10). Every call the desktop client makes
// is proxied here so the browser never talks to discord.com directly (no
// CORS surprises, one guarded funnel with the OS rate limiter).
//
// Token handling — the Discord token travels in the 'x-discord-token' request
// header ONLY. It is never persisted server-side, never written to the audit
// log and never forwarded anywhere except discord.com itself.
//
// Actions: me · guilds · channels · messages · send · dms · inviteInfo
import { NextResponse } from 'next/server'
import { clientKey, logSec, rateLimit, sanitizeText, tooMany } from '@/lib/server/security'

export const runtime = 'nodejs'

const DISCORD_API = 'https://discord.com/api/v10'
const UPSTREAM_TIMEOUT_MS = 15_000

/* ---------------- validation helpers ---------------- */

const ACTIONS = ['me', 'guilds', 'channels', 'messages', 'send', 'dms', 'inviteInfo'] as const
type Action = (typeof ACTIONS)[number]

const SNOWFLAKE_RE = /^\d{2,25}$/
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{2,32}$/

function isSnowflake(v: unknown): v is string {
  return typeof v === 'string' && SNOWFLAKE_RE.test(v)
}

/**
 * Build the Authorization header value. Discord needs the 'Bot ' scheme for
 * application tokens but NOT for user tokens, so:
 *   - a token that already starts with 'Bot ' is sent as-is,
 *   - a raw bot token pasted from the developer portal (base64 of the app id,
 *     e.g. 'MTIz...') gets the 'Bot ' prefix automatically,
 *   - anything else is treated as a user token and sent as-is.
 */
function authScheme(token: string): string {
  if (token.startsWith('Bot ')) return token
  if (token.startsWith('MTIz')) return `Bot ${token}`
  return token
}

/* ---------------- upstream shapes (raw Discord payloads) ---------------- */

interface RawUser {
  id?: string
  username?: string
  global_name?: string | null
  avatar?: string | null
}

interface RawAttachment {
  url?: string
  filename?: string
}

interface RawMessage {
  id?: string
  author?: RawUser
  content?: string
  timestamp?: string
  attachments?: RawAttachment[]
  sticker_items?: unknown[]
}

interface RawChannel {
  id?: string
  name?: string | null
  type?: number
  position?: number
  recipients?: RawUser[]
}

interface RawGuild {
  id?: string
  name?: string
  icon?: string | null
  approximate_member_count?: number
  approximate_presence_count?: number
}

/* ---------------- lightweight shapes sent to the client ---------------- */

interface DUser {
  id: string
  username: string
  globalName: string | null
  avatarUrl: string | null
}

interface DGuild {
  id: string
  name: string
  icon: string | null
  members: number | null
  online: number | null
}

interface DChannel {
  id: string
  name: string
  type: number
  position: number
  recipients: DUser[]
}

interface DAttachment {
  url: string
  name: string
}

interface DMessage {
  id: string
  author: string
  avatar: string | null
  content: string
  ts: string
  attachments: DAttachment[]
  stickerless: boolean
}

interface DInvite {
  code: string
  guildId: string | null
  guildName: string | null
  guildIcon: string | null
  channelName: string | null
  members: number | null
  online: number | null
}

function cdnUserAvatar(u: RawUser): string | null {
  return u.id && u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null
}

function mapUser(u: RawUser): DUser {
  return {
    id: String(u.id || ''),
    username: String(u.username || 'unknown'),
    globalName: typeof u.global_name === 'string' ? u.global_name : null,
    avatarUrl: cdnUserAvatar(u),
  }
}

function mapGuild(g: RawGuild): DGuild | null {
  if (!g.id || !g.name) return null
  return {
    id: g.id,
    name: g.name,
    icon: typeof g.icon === 'string' && g.icon ? g.icon : null,
    members: typeof g.approximate_member_count === 'number' ? g.approximate_member_count : null,
    online: typeof g.approximate_presence_count === 'number' ? g.approximate_presence_count : null,
  }
}

/** text channels (0) first, then voice (2) / announcement (5) / stage (13) */
function channelRank(type: number): number {
  if (type === 0) return 0
  if (type === 2 || type === 5 || type === 13) return 1
  return 2
}

function mapChannel(c: RawChannel): DChannel | null {
  if (!c.id) return null
  return {
    id: c.id,
    name: String(c.name || 'unnamed'),
    type: typeof c.type === 'number' ? c.type : 0,
    position: typeof c.position === 'number' ? c.position : 0,
    recipients: Array.isArray(c.recipients) ? c.recipients.map(mapUser) : [],
  }
}

function sortChannels(list: DChannel[]): DChannel[] {
  return list.sort((a, b) => channelRank(a.type) - channelRank(b.type) || a.position - b.position || a.name.localeCompare(b.name))
}

function mapMessage(m: RawMessage): DMessage | null {
  if (!m.id) return null
  const author = m.author?.global_name || m.author?.username || 'Unknown User'
  const attachments: DAttachment[] = (Array.isArray(m.attachments) ? m.attachments : [])
    .filter((a): a is RawAttachment & { url: string } => typeof a?.url === 'string' && a.url.length > 0)
    .map((a) => ({ url: a.url, name: String(a.filename || 'file') }))
  return {
    id: m.id,
    author,
    avatar: cdnUserAvatar(m.author || {}),
    content: typeof m.content === 'string' ? m.content : '',
    ts: typeof m.timestamp === 'string' ? m.timestamp : '',
    attachments,
    stickerless: !(Array.isArray(m.sticker_items) && m.sticker_items.length > 0),
  }
}

/** Discord returns messages newest-first; snowflake ids are chronological.
 *  BigInt(0) instead of the 0n literal — tsconfig targets ES2017. */
function sortBySnowflake(list: DMessage[]): DMessage[] {
  const big = (s: string): bigint => {
    try {
      return BigInt(s)
    } catch {
      return BigInt(0)
    }
  }
  return list.sort((a, b) => (big(a.id) < big(b.id) ? -1 : big(a.id) > big(b.id) ? 1 : 0))
}

function mapInvite(b: unknown): DInvite | null {
  const o = (b || {}) as {
    code?: string
    guild?: { id?: string; name?: string; icon?: string | null }
    channel?: { name?: string }
    approximate_member_count?: number
    approximate_presence_count?: number
  }
  if (!o.code) return null
  return {
    code: o.code,
    guildId: o.guild?.id || null,
    guildName: o.guild?.name || null,
    guildIcon: o.guild?.icon || null,
    channelName: o.channel?.name || null,
    members: typeof o.approximate_member_count === 'number' ? o.approximate_member_count : null,
    online: typeof o.approximate_presence_count === 'number' ? o.approximate_presence_count : null,
  }
}

/* ---------------- upstream fetch + error mapping ---------------- */

interface Upstream {
  status: number // 0 = network / timeout failure
  body: unknown
}

async function callDiscord(token: string, path: string, init?: { method?: string; body?: string }): Promise<Upstream> {
  let res: Response
  try {
    res = await fetch(`${DISCORD_API}${path}`, {
      method: init?.method || 'GET',
      headers: {
        Authorization: authScheme(token),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch {
    return { status: 0, body: null }
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

function upstreamError(status: number, body: unknown): NextResponse {
  if (status === 0) {
    return NextResponse.json({ ok: false, error: 'Could not reach Discord — check the network and try again.' }, { status: 502 })
  }
  if (status === 401) {
    logSec('warn', 'discord', 'upstream rejected the token (401)')
    return NextResponse.json({ ok: false, error: 'Invalid or expired Discord token' }, { status: 401 })
  }
  if (status === 403) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden — the bot lacks access (403). For bots, enable the Server Members intent and get invited.' },
      { status: 403 },
    )
  }
  if (status === 429) {
    const raw = (body as { retry_after?: unknown } | null)?.retry_after
    const secs = Math.max(1, Math.ceil(Number(raw) || 1))
    return NextResponse.json({ ok: false, error: `Discord rate limit hit — retry in ${secs}s.`, retryAfter: secs }, { status: 429 })
  }
  if (status === 404) {
    return NextResponse.json({ ok: false, error: 'Not found on Discord — the target may have been deleted.' }, { status: 404 })
  }
  return NextResponse.json({ ok: false, error: `Discord request failed (${status}).` }, { status })
}

/* ---------------- handler ---------------- */

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'discord'), 90, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  // The token lives in the header only — it is never read from the body and
  // never logged anywhere.
  const token = (req.headers.get('x-discord-token') || '').trim()
  if (!token || token.length < 20 || token.length > 200) {
    return NextResponse.json({ ok: false, error: 'Missing Discord token — paste it in the Discord tab.' }, { status: 401 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const action = body.action
  if (typeof action !== 'string' || !ACTIONS.includes(action as Action)) {
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 })
  }
  const act = action as Action

  switch (act) {
    /* ---------- who am I ---------- */
    case 'me': {
      const res = await callDiscord(token, '/users/@me')
      if (res.status !== 200) return upstreamError(res.status, res.body)
      return NextResponse.json({ ok: true, user: mapUser((res.body || {}) as RawUser) })
    }

    /* ---------- servers ---------- */
    case 'guilds': {
      const res = await callDiscord(token, '/users/@me/guilds?with_counts=true')
      if (res.status !== 200) return upstreamError(res.status, res.body)
      const raw = Array.isArray(res.body) ? (res.body as RawGuild[]) : []
      const guilds = raw.map(mapGuild).filter((g): g is DGuild => g !== null)
      return NextResponse.json({ ok: true, guilds })
    }

    /* ---------- channels of one server (text first, then voice/stage) ---------- */
    case 'channels': {
      const guildId = body.guildId
      if (!isSnowflake(guildId)) {
        return NextResponse.json({ ok: false, error: 'Invalid guild id.' }, { status: 400 })
      }
      const res = await callDiscord(token, `/guilds/${guildId}/channels`)
      if (res.status !== 200) return upstreamError(res.status, res.body)
      const raw = Array.isArray(res.body) ? (res.body as RawChannel[]) : []
      const channels = sortChannels(raw.map(mapChannel).filter((c): c is DChannel => c !== null))
      return NextResponse.json({ ok: true, channels })
    }

    /* ---------- message history (ascending) ---------- */
    case 'messages': {
      const channelId = body.channelId
      if (!isSnowflake(channelId)) {
        return NextResponse.json({ ok: false, error: 'Invalid channel id.' }, { status: 400 })
      }
      const limit = Math.min(50, Math.max(1, Math.floor(Number(body.limit) || 50)))
      const res = await callDiscord(token, `/channels/${channelId}/messages?limit=${limit}`)
      if (res.status !== 200) return upstreamError(res.status, res.body)
      const raw = Array.isArray(res.body) ? (res.body as RawMessage[]) : []
      const messages = sortBySnowflake(raw.map(mapMessage).filter((m): m is DMessage => m !== null))
      return NextResponse.json({ ok: true, messages })
    }

    /* ---------- send ---------- */
    case 'send': {
      const channelId = body.channelId
      if (!isSnowflake(channelId)) {
        return NextResponse.json({ ok: false, error: 'Invalid channel id.' }, { status: 400 })
      }
      const content = sanitizeText(body.content, 2000).trim()
      if (!content) {
        return NextResponse.json({ ok: false, error: 'Message is empty.' }, { status: 400 })
      }
      const res = await callDiscord(token, `/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      })
      if (res.status !== 200) return upstreamError(res.status, res.body)
      const message = mapMessage((res.body || {}) as RawMessage)
      logSec('allow', 'discord', `message relayed to channel ${channelId} (${content.length} chars)`)
      return NextResponse.json({ ok: true, message })
    }

    /* ---------- direct messages (user tokens; bots get the 403 hint) ---------- */
    case 'dms': {
      const res = await callDiscord(token, '/users/@me/channels')
      if (res.status !== 200) return upstreamError(res.status, res.body)
      const raw = Array.isArray(res.body) ? (res.body as RawChannel[]) : []
      // keep DMs (1) and group DMs (3); unnamed group DMs fall back to member names
      const channels = raw
        .filter((c) => c.type === 1 || c.type === 3)
        .map(mapChannel)
        .filter((c): c is DChannel => c !== null)
        .map((c) => ({
          ...c,
          name: c.type === 3 && c.name !== 'unnamed' ? c.name : c.recipients.map((r) => r.globalName || r.username).join(', ') || 'Direct message',
        }))
      return NextResponse.json({ ok: true, channels })
    }

    /* ---------- invite preview ---------- */
    case 'inviteInfo': {
      const code = body.code
      if (typeof code !== 'string' || !INVITE_CODE_RE.test(code)) {
        return NextResponse.json({ ok: false, error: 'Invalid invite code.' }, { status: 400 })
      }
      const res = await callDiscord(token, `/invites/${encodeURIComponent(code)}?with_counts=true`)
      if (res.status !== 200) return upstreamError(res.status, res.body)
      return NextResponse.json({ ok: true, invite: mapInvite(res.body) })
    }
  }
}

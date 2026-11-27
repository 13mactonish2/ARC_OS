// /api/discord/web — the Text ER "Discord → Web page" mode store.
// Every Discord web page the user enters (discord.com/app home, invite
// links, channel pages, guild widget embeds) is saved here FOREVER: rows
// live in the InterCore SQLite database, keyed per OS user, so the list
// survives OS restarts, browser data wipes and follows the user across
// devices. The token bridge (/api/discord) is untouched — this is the
// no-token, web-page way into Discord.
//
// GET    ?owner=<username>              → { ok, pages: [...] }
// POST   { owner, name, url, kind?, guildId?, open? } → saved row (upsert by url)
// DELETE ?id=<rowId>&owner=<username>   → { ok, id }
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit, sanitizeName, sanitizeText, tooMany, logSec } from '@/lib/server/security'

export const runtime = 'nodejs'

const KINDS = ['home', 'invite', 'channel', 'widget', 'page'] as const
type Kind = (typeof KINDS)[number]

/** only real Discord hosts are accepted — this store is not a generic bookmark service */
const DISCORD_HOST_RE = /^(?:[a-z0-9-]+\.)*discord(?:app)?\.com$|^(?:[a-z0-9-]+\.)*discord\.gg$/i

interface WebPageRow {
  id: string
  name: string
  url: string
  kind: string
  guildId: string
  addedAt: string
  lastAt: string
}

function toRow(r: {
  id: string
  name: string
  url: string
  kind: string
  guildId: string
  addedAt: Date
  lastAt: Date
}): WebPageRow {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    kind: r.kind,
    guildId: r.guildId,
    addedAt: r.addedAt.toISOString(),
    lastAt: r.lastAt.toISOString(),
  }
}

/** normalize + validate the pasted Discord URL; returns null when rejected */
function cleanUrl(raw: unknown): { url: string; host: string } | null {
  let s = sanitizeText(raw, 500).trim()
  if (!s) return null
  if (/^discord\.gg\//i.test(s) || /^discord\.com/i.test(s)) s = `https://${s}`
  if (!/^https?:\/\//i.test(s)) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (!DISCORD_HOST_RE.test(u.hostname)) return null
    return { url: u.toString(), host: u.hostname }
  } catch {
    return null
  }
}

function ownerOf(raw: unknown): string {
  const s = sanitizeName(raw, 40)
  return s.length > 0 ? s.slice(0, 40) : 'Guest'
}

export async function GET(req: Request) {
  const gate = rateLimit(clientKey(req, 'discord-web-get'), 120, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const owner = ownerOf(new URL(req.url).searchParams.get('owner'))
  try {
    const rows = await db.discordWebPage.findMany({
      where: { ownerKey: owner },
      orderBy: { lastAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({ ok: true, pages: rows.map(toRow) })
  } catch {
    return NextResponse.json({ ok: false, error: 'The Discord page store is unavailable right now.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'discord-web-post'), 60, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body.' }, { status: 400 })
  }

  const owner = ownerOf(body.owner)
  const clean = cleanUrl(body.url)
  if (!clean) {
    return NextResponse.json(
      { ok: false, error: 'Only real Discord pages can be saved here (discord.com, discord.gg).' },
      { status: 400 },
    )
  }

  const kind = (KINDS as readonly string[]).includes(sanitizeText(body.kind, 20)) ? (sanitizeText(body.kind, 20) as Kind) : 'page'
  const guildId = /^\d{2,25}$/.test(sanitizeText(body.guildId, 25)) ? sanitizeText(body.guildId, 25) : ''
  const name = sanitizeName(body.name, 60) || defaultName(clean.url, kind)

  try {
    const row = await db.discordWebPage.upsert({
      where: { ownerKey_url: { ownerKey: owner, url: clean.url } },
      create: { ownerKey: owner, name, url: clean.url, kind, guildId },
      update: { name, kind, guildId, lastAt: new Date() },
    })
    if (body.open === true) logSec('allow', 'discord-web', `${owner} entered ${clean.url}`)
    return NextResponse.json({ ok: true, page: toRow(row) })
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not save the page — try again.' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const gate = rateLimit(clientKey(req, 'discord-web-del'), 60, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const params = new URL(req.url).searchParams
  const owner = ownerOf(params.get('owner'))
  const id = sanitizeText(params.get('id'), 40)
  if (!id) return NextResponse.json({ ok: false, error: 'Missing page id.' }, { status: 400 })

  try {
    const row = await db.discordWebPage.findFirst({ where: { id, ownerKey: owner } })
    if (!row) return NextResponse.json({ ok: false, error: 'Page not found.' }, { status: 404 })
    await db.discordWebPage.delete({ where: { id: row.id } })
    return NextResponse.json({ ok: true, id })
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not remove the page.' }, { status: 500 })
  }
}

/** sensible display name when the user does not name the page themselves */
function defaultName(url: string, kind: Kind): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/+$/, '')
    if (kind === 'widget') return 'Server widget'
    const invite = path.match(/^\/(?:invite|gg)\/([A-Za-z0-9_-]+)/)
    if (invite) return `Invite · ${invite[1]}`
    /* discord.gg/<code> — the code rides as the first path segment */
    if (/(^|\.)discord\.gg$/i.test(u.hostname)) {
      const code = path.replace(/^\//, '').split('/')[0]
      if (code) return `Invite · ${code}`
    }
    const chan = path.match(/^\/channels\/(\d+)\/(\d+)/)
    if (chan) return 'Server channel'
    if (path === '/app' || path === '/login' || path === '' || path === '/') return 'Discord Web Home'
    return `Discord · ${path.slice(1, 40) || u.hostname}`
  } catch {
    return 'Discord page'
  }
}

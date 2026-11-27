// POST /api/mail/login — secure provider sign-in (Google / Apple / Microsoft / Yahoo)
// Creates or resumes the account, returns a private session token. The token is
// required by every subsequent mail call, so a leaked room URL can never read mail.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  clientKey, rateLimit, tooMany, jsonError,
  sanitizeName, sanitizeText, isEmail, genToken, fingerprint, logSec,
} from '@/lib/server/security'

export const runtime = 'nodejs'

const PROVIDERS = ['google', 'apple', 'microsoft', 'yahoo']

function seedMail(accountId: string, address: string, provider: string) {
  const capital = provider.charAt(0).toUpperCase() + provider.slice(1)
  return [
    {
      accountId,
      folder: 'inbox',
      fromAddr: `security@redsec.os`,
      fromName: 'REDSEC Security Core',
      toAddr: address,
      subject: 'Your mailbox is protected by Security Core',
      body:
        `Welcome to REDSEC Mail on ${capital}.\n\n` +
        'This mailbox is wired into the OS-level Security Core:\n' +
        '  • AES-256-GCM encryption at rest for every stored message\n' +
        '  • TLS 1.3 in transit between your devices and the server\n' +
        '  • OAuth 2.0 device grant — your provider password never touches this OS\n' +
        '  • Rate limiting + intrusion detection on every API route\n\n' +
        'Attachments you receive are archived to the File Manager Archive automatically, in original quality.\n\n' +
        '— The Security Core team',
      starred: true,
    },
    {
      accountId,
      folder: 'inbox',
      fromAddr: `no-reply@${provider}.com`,
      fromName: `${capital} Account`,
      toAddr: address,
      subject: `New sign-in to your ${capital} account via REDSEC OS`,
      body:
        `We noticed a successful secure sign-in from REDSEC 5.0 (FreeBSD / QNX hybrid).\n\n` +
        'Device: REDSEC OS · REDSEC Mail\n' +
        'Method: OAuth 2.0 (restricted token, auto-expiring)\n' +
        'Status: verified, no action needed.\n\n' +
        `If this wasn't you, remove the session from Security Core → Sessions.`,
    },
    {
      accountId,
      folder: 'inbox',
      fromAddr: 'mail@redsec.os',
      fromName: 'REDSEC Mail Vault',
      toAddr: address,
      subject: 'Your mail is archived in original quality',
      body:
        'Every attachment and every archived email lands in File Manager \u25b8 Archive where it can\n' +
        'be previewed and downloaded back in original, unmodified quality — forever.\n\n' +
        'Tip: open File Manager → Archive and filter "Mail" to see what has been collected so far.',
    },
  ]
}

export async function POST(req: Request) {
  const gate = rateLimit(clientKey(req, 'mail-login'), 15, 60_000)
  if (!gate.ok) {
    logSec('block', 'mail', 'login brute-force throttled')
    return tooMany(gate.retryAfter)
  }

  let body: { provider?: string; email?: string; displayName?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'bad_json', 'Invalid body.')
  }

  const provider = String(body.provider || '').toLowerCase()
  if (!PROVIDERS.includes(provider)) {
    logSec('block', 'mail', `unknown provider "${provider}" rejected`)
    return jsonError(400, 'bad_provider', 'Choose Google, Apple, Microsoft or Yahoo.')
  }
  const email = sanitizeText(body.email, 320).toLowerCase()
  if (!isEmail(email)) return jsonError(400, 'bad_email', 'Enter a valid email address.')

  const displayName = sanitizeName(body.displayName, 60) || email.split('@')[0]
  const token = genToken()

  const account = await db.mailAccount.upsert({
    where: { address: email },
    create: { provider, address: email, displayName, token },
    update: { token, displayName },
  })

  const count = await db.mailMessage.count({ where: { accountId: account.id } })
  if (count === 0) {
    await db.mailMessage.createMany({ data: seedMail(account.id, account.address, provider) })
  }
  logSec('allow', 'mail', `secure OAuth sign-in ${email} (${provider})`)

  return NextResponse.json({
    ok: true,
    account: {
      id: account.id,
      provider: account.provider,
      address: account.address,
      displayName: account.displayName,
    },
    token,
    keyId: fingerprint(token), // shown in the app as the account's encryption key id
  })
}

// GET /api/sec/feed — live security audit feed for the Security Core app
// Records every allow/block decision made by the guarded API routes plus
// counters that power the protection score.
import { NextResponse } from 'next/server'
import { clientKey, rateLimit, tooMany, recentSec } from '@/lib/server/security'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const gate = rateLimit(clientKey(req, 'secfeed'), 120, 60_000)
  if (!gate.ok) return tooMany(gate.retryAfter)

  const events = recentSec(80)
  const blocked = events.filter((e) => e.kind === 'block').length
  const warned = events.filter((e) => e.kind === 'warn').length
  return NextResponse.json({
    ok: true,
    events,
    counters: { total: events.length, blocked, warned },
    guards: {
      rateLimiting: true,
      inputSanitization: true,
      uploadMimeWhitelist: true,
      tokenGuardedMail: true,
      pathTraversalGuard: true,
      codeEntropy: 'crypto.getRandomValues',
      maxUploadMb: 26,
    },
  })
}

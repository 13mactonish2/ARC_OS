// /api/system/doctor — REDSEC AI DOCTOR.
// The Settings ▸ AI Doctor section collects a full health report of the OS,
// every OS app and every web app running in the OS, then this endpoint feeds
// it to the z-ai neural core. The AI returns REAL, client-executable fix
// actions (clear app storage, close wedged windows, reset caches…) so the OS
// fixes itself automatically — no app has to be created by hand.
// Every response is best-effort: if the AI is unreachable, the endpoint still
// returns a deterministic rule-based diagnosis so auto-fix keeps working.
import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const dynamic = 'force-dynamic'

export interface DoctorIssue {
  id: string
  area: string // os | app:<id> | web | network | storage | memory
  severity: 'info' | 'warn' | 'critical'
  title: string
  detail: string
  autoFixable: boolean
  fix?: { action: string; target?: string }
}

interface Report {
  device?: string
  online?: boolean
  windows?: Array<{ appId: string; title?: string; minimized?: boolean; ageMin?: number }>
  installed?: number
  storageUsedMb?: number
  storageQuotaMb?: number
  localStorageKb?: number
  jsErrors?: string[] // recent window.onerror messages (ring buffer)
  apiChecks?: Array<{ name: string; ok: boolean; ms: number; status?: number }>
  memoryMb?: number
  appsOpened?: Array<string>
  uptimeMin?: number
  webAppIssues?: string[]
}

function ruleDiagnose(r: Report): DoctorIssue[] {
  const out: DoctorIssue[] = []
  const push = (i: DoctorIssue) => out.push(i)

  for (const api of r.apiChecks || []) {
    if (!api.ok) {
      push({
        id: `api_${api.name}`,
        area: 'network',
        severity: 'critical',
        title: `Service "${api.name}" is unreachable`,
        detail: `The health probe to ${api.name} failed after ${api.ms}ms. Restarting the affected app windows usually reconnects it.`,
        autoFixable: true,
        fix: { action: 'restart_windows' },
      })
    } else if (api.ms > 2500) {
      push({
        id: `api_slow_${api.name}`,
        area: 'network',
        severity: 'warn',
        title: `Service "${api.name}" is slow (${api.ms}ms)`,
        detail: 'The service answered but took unusually long. Closing idle windows frees the network queue.',
        autoFixable: true,
        fix: { action: 'close_minimized' },
      })
    }
  }

  if ((r.jsErrors?.length || 0) > 0) {
    push({
      id: 'js_errors',
      area: 'os',
      severity: 'critical',
      title: `${r.jsErrors!.length} runtime error${r.jsErrors!.length === 1 ? '' : 's'} captured`,
      detail: `Recent errors: ${r.jsErrors!.slice(0, 3).join(' | ').slice(0, 300)}. Clearing the affected app caches and restarting windows clears wedged states.`,
      autoFixable: true,
      fix: { action: 'restart_windows' },
    })
  }

  if (typeof r.memoryMb === 'number' && r.memoryMb > 1200) {
    push({
      id: 'memory_high',
      area: 'memory',
      severity: 'warn',
      title: `High memory pressure (${Math.round(r.memoryMb)} MB JS heap)`,
      detail: 'Close background/minimized windows or run DeepClean to free RAM.',
      autoFixable: true,
      fix: { action: 'close_minimized' },
    })
  }

  if (typeof r.storageUsedMb === 'number' && typeof r.storageQuotaMb === 'number' && r.storageQuotaMb > 0 && r.storageUsedMb / r.storageQuotaMb > 0.85) {
    push({
      id: 'storage_full',
      area: 'storage',
      severity: 'critical',
      title: `OS vault ${Math.round((r.storageUsedMb / r.storageQuotaMb) * 100)}% full`,
      detail: 'Empty the Bin and remove old downloads from File Manager to reclaim space.',
      autoFixable: false,
    })
  }

  if (typeof r.localStorageKb === 'number' && r.localStorageKb > 4096) {
    push({
      id: 'localstorage_bloat',
      area: 'storage',
      severity: 'warn',
      title: `Browser-local OS state is heavy (${Math.round(r.localStorageKb)} KB)`,
      detail: 'Old cached app states can slow boot. A safe clear of temp caches is available.',
      autoFixable: true,
      fix: { action: 'clear_temp_caches' },
    })
  }

  if (r.online === false) {
    push({
      id: 'offline',
      area: 'network',
      severity: 'critical',
      title: 'The device is offline',
      detail: 'Web apps and the chat relay cannot reach the server. Turn on WiFi or disable airplane mode.',
      autoFixable: false,
    })
  }

  const wedged = (r.windows || []).filter((w) => typeof w.ageMin === 'number' && w.ageMin > 180)
  if (wedged.length >= 3) {
    push({
      id: 'windows_stale',
      area: 'os',
      severity: 'warn',
      title: `${wedged.length} windows have been open for hours`,
      detail: 'Long-lived windows accumulate state. Restarting them refreshes memory and connections.',
      autoFixable: true,
      fix: { action: 'close_minimized' },
    })
  }

  if (out.length === 0) {
    push({
      id: 'healthy',
      area: 'os',
      severity: 'info',
      title: 'No issues detected — the OS is healthy',
      detail: 'Every OS app, web app and service answered within normal limits.',
      autoFixable: false,
    })
  }
  return out
}

export async function POST(req: NextRequest) {
  let report: Report = {}
  try {
    report = ((await req.json().catch(() => ({}))) as { report?: Report }).report || {}
  } catch {
    /* keep empty report */
  }

  const base = ruleDiagnose(report)

  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content:
            'You are the REDSEC AI Doctor, an automated repair agent for a browser-based desktop OS. You receive a JSON health report of the OS, its native apps and its embedded web apps. Reply with STRICT JSON only, no markdown, shaped as: {"healthScore":0..100,"summary":"max 2 sentences","issues":[{"id":"kebab-id","area":"os|app:<id>|web|network|storage|memory","severity":"info|warn|critical","title":"max 70 chars","detail":"max 220 chars","autoFixable":true|false,"fix":{"action":"clear_app_storage|restart_windows|close_minimized|clear_temp_caches|reset_settings|none","target":"app id or empty"}}]}. List at most 6 issues, most severe first. Use fix actions ONLY from the allowed set. If everything is fine, return one info issue with fix.action "none".',
        },
        { role: 'user', content: JSON.stringify(report).slice(0, 6000) },
      ],
      thinking: { type: 'disabled' },
    })
    const txt = completion.choices[0]?.message?.content || ''
    const m = txt.match(/\{[\s\S]*\}/)
    if (m) {
      const parsed = JSON.parse(m[0]) as { healthScore?: number; summary?: string; issues?: DoctorIssue[] }
      if (Array.isArray(parsed.issues) && parsed.issues.length) {
        const allowed = new Set(['clear_app_storage', 'restart_windows', 'close_minimized', 'clear_temp_caches', 'reset_settings', 'none'])
        const issues = parsed.issues.slice(0, 6).map((i, idx) => ({
          ...i,
          id: String(i.id || `ai_${idx}`).slice(0, 40),
          severity: ['info', 'warn', 'critical'].includes(i.severity) ? i.severity : 'warn',
          autoFixable: !!(i.autoFixable && i.fix && allowed.has(i.fix.action)),
        }))
        return NextResponse.json({
          ok: true,
          engine: 'ai',
          healthScore: typeof parsed.healthScore === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.healthScore))) : Math.max(10, 100 - issues.filter((i) => i.severity !== 'info').length * 15),
          summary: String(parsed.summary || '').slice(0, 300),
          issues,
        })
      }
    }
  } catch {
    /* AI unreachable — rule-based result below */
  }

  const criticals = base.filter((i) => i.severity === 'critical').length
  const warns = base.filter((i) => i.severity === 'warn').length
  return NextResponse.json({
    ok: true,
    engine: 'rules',
    healthScore: Math.max(10, 100 - criticals * 30 - warns * 12),
    summary: base[0]?.id === 'healthy' ? 'All systems nominal — no issues detected.' : `${base.length} issue(s) found by the rule engine; the AI core was unreachable, safe auto-fixes are still available.`,
    issues: base,
  })
}

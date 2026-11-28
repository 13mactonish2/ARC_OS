// REDSEC v5.0 — Task 42: office share links (client helper)
//
// Word / Presentation / Sheet build their real .docx / .pptx / .xlsx blob and
// call createShareLink() → POST /api/share → short public id. The returned
// link (?share=<id>) can be pasted into any social app. Opening it on a
// REDSEC OS device drops the file into Documents and opens the matching app.
'use client'

export type ShareApp = 'word' | 'presentation' | 'sheet'

export interface ShareInfo {
  id: string
  url: string
  size: number
}

/** blob → base64 (no data: prefix), chunked to avoid stack overflow */
export async function blobToB64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < buf.length; i += CH) {
    bin += String.fromCharCode(...buf.subarray(i, i + CH))
  }
  return btoa(bin)
}

/** base64 → Blob with the given mime */
export function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < buf.length; i++) buf[i] = bin.charCodeAt(i)
  return new Blob([buf], { type: mime })
}

/** Build a shareable link for a real office file blob. */
export async function createShareLink(app: ShareApp, name: string, blob: Blob): Promise<ShareInfo> {
  const data = await blobToB64(blob)
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app, name, data }),
  })
  const json = (await res.json()) as { ok: boolean; id?: string; size?: number; error?: string }
  if (!res.ok || !json.ok || !json.id) throw new Error(json.error || `Upload failed (${res.status})`)
  const url = `${location.origin}/?share=${json.id}`
  return { id: json.id, url, size: json.size ?? blob.size }
}

/** Fetch a shared document payload by id. */
export async function fetchShare(id: string): Promise<{ app: ShareApp; name: string; blob: Blob }> {
  const res = await fetch(`/api/share?id=${encodeURIComponent(id)}`)
  const json = (await res.json()) as { ok: boolean; app?: string; name?: string; data?: string; size?: number; error?: string }
  if (!res.ok || !json.ok || !json.data || !json.app) throw new Error(json.error === 'not_found' ? 'This share link has expired or was revoked.' : `Could not load shared document (${res.status})`)
  const mimes: Record<ShareApp, string> = {
    word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    sheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  const app = json.app as ShareApp
  return { app, name: json.name || 'Shared file', blob: b64ToBlob(json.data, mimes[app]) }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch {
      return false
    }
  }
}

export interface SocialLink {
  id: string
  label: string
  icon: string
  color: string
  href: string
}

/** Ready-to-open share intents for the big social apps (all free, no keys). */
export function socialLinks(url: string, title: string): SocialLink[] {
  const u = encodeURIComponent(url)
  const t = encodeURIComponent(title)
  return [
    { id: 'whatsapp', label: 'WhatsApp', icon: '🟢', color: '#25D366', href: `https://wa.me/?text=${encodeURIComponent(`${title} — ${url}`)}` },
    { id: 'telegram', label: 'Telegram', icon: '✈️', color: '#229ED9', href: `https://t.me/share/url?url=${u}&text=${t}` },
    { id: 'x', label: 'X', icon: '𝕏', color: '#000000', href: `https://twitter.com/intent/tweet?text=${t}&url=${u}` },
    { id: 'reddit', label: 'Reddit', icon: '👽', color: '#FF4500', href: `https://www.reddit.com/submit?url=${u}&title=${t}` },
    { id: 'linkedin', label: 'LinkedIn', icon: 'in', color: '#0A66C2', href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { id: 'email', label: 'Email', icon: '✉️', color: '#64748b', href: `mailto:?subject=${t}&body=${encodeURIComponent(`${title}\n${url}`)}` },
  ]
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

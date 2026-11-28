// REDSEC — git↔File-Manager bridge (client).
// After a real clone lands in /gitdata (server-side isomorphic-git), this module
// mirrors the repository's working tree into the virtual File System so every
// cloned file shows up in the File Manager ▸ Downloads ▸ Git Repos — exactly
// where downloads go. Used by Term X (`git clone` / `git save`) and Caterpillar.
'use client'

import { fs, fsLoad } from './fs'
import { useOS } from './store'

export interface GitPullResult {
  ok: boolean
  pulled: number
  skipped: number
  total: number
  bytes: number
  folderId: string
  folderPath: string
  error?: string
}

export interface PullOptions {
  /** max files to copy (default 400) */
  limit?: number
  /** max total bytes to store (default 24 MB — protects OS storage) */
  maxBytes?: number
  /** progress callback — one line per file copied */
  onLine?: (line: string) => void
  /** FS root to store under (default 'downloads') */
  root?: string
}

/* git API results */
interface FilesResult { ok?: boolean; log?: string[]; error?: string; files?: Array<{ path: string; size: number }>; truncated?: boolean; total?: number }
interface FileResult { ok?: boolean; log?: string[]; error?: string; content?: string; size?: number; mime?: string }

const GIT_POST = '/api/git'

async function gitOp(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string } & FilesResult & FileResult> {
  const res = await fetch(GIT_POST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      /* keep default */
    }
    return { ok: false, error: msg }
  }
  return (await res.json()) as { ok: boolean; error?: string } & FilesResult & FileResult
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime || 'application/octet-stream' })
}

/** find-or-create a folder by name under `parent` (idempotent) */
async function ensureFolder(parent: string, name: string): Promise<string> {
  const existing = fs.children(parent).find((n) => n.kind === 'folder' && !n.trashed && n.name === name)
  if (existing) return existing.id
  const node = await fs.createFolder(parent, name)
  return node.id
}

/** create (or reuse) a nested folder path like "src/lib/os" under `root`; returns leaf id */
async function ensureFolderTree(rootId: string, segments: string[]): Promise<string> {
  let cur = rootId
  for (const seg of segments) cur = await ensureFolder(cur, seg)
  return cur
}

function dirOf(path: string): string[] {
  const parts = path.split('/')
  parts.pop()
  return parts
}

function baseOf(path: string): string {
  return path.split('/').pop() || path
}

/**
 * Mirror a cloned server-side repo into the OS File Manager.
 * Real file bytes are copied (text + small binaries); anything over the per-file
 * cap is reported and skipped instead of failing the whole pull.
 */
export async function pullRepoIntoFS(repo: string, opts: PullOptions = {}): Promise<GitPullResult> {
  const limit = Math.max(1, Math.min(1500, opts.limit ?? 400))
  const maxBytes = opts.maxBytes ?? 24 * 1024 * 1024
  const root = opts.root || 'downloads'
  const result: GitPullResult = { ok: false, pulled: 0, skipped: 0, total: 0, bytes: 0, folderId: '', folderPath: '' }

  try {
    await fsLoad()
    /* Downloads ▸ Git Repos ▸ <repo> */
    const gitRootId = await ensureFolder(root, 'Git Repos')
    const repoId = await ensureFolder(gitRootId, repo)
    result.folderId = repoId

    const listing = await gitOp({ op: 'files', repo, limit: 4000 })
    if (!listing.ok) {
      result.error = listing.error || 'could not list repository files'
      return result
    }
    const files = (listing.files || []).slice(0, limit)
    result.total = listing.total || files.length

    for (const f of files) {
      if (result.bytes >= maxBytes) {
        opts.onLine?.(`storage cap reached — stopped after ${result.pulled} file(s)`)
        break
      }
      try {
        const one = await gitOp({ op: 'file', repo, path: f.path })
        if (!one.ok || typeof one.content !== 'string') {
          result.skipped++
          opts.onLine?.(`skipped ${f.path} — ${one.error || 'unreadable'}`)
          continue
        }
        const blob = base64ToBlob(one.content, one.mime || 'application/octet-stream')
        const parent = await ensureFolderTree(repoId, dirOf(f.path))
        await fs.addFile(parent, baseOf(f.path), {
          blob,
          mime: one.mime || 'application/octet-stream',
          size: blob.size,
          meta: { gitRepo: repo, gitPath: f.path, source: 'git-clone' },
        })
        result.pulled++
        result.bytes += blob.size
        opts.onLine?.(`+ ${f.path} (${(blob.size / 1024).toFixed(1)} KB)`)
      } catch {
        result.skipped++
      }
    }

    result.folderPath = `File Manager ▸ Downloads ▸ Git Repos ▸ ${repo}`
    result.ok = true
    return result
  } catch (e) {
    result.error = e instanceof Error ? e.message : 'File Manager sync failed'
    return result
  }
}

/** one-shot helper: notify + return summary line for terminals */
export async function pullRepoIntoFSWithNotify(repo: string, opts: PullOptions = {}): Promise<GitPullResult> {
  const r = await pullRepoIntoFS(repo, opts)
  const os = useOS.getState()
  if (r.ok) {
    os.notify({
      title: 'Repository saved to File Manager',
      body: `${repo}: ${r.pulled} file(s) stored in Downloads ▸ Git Repos`,
      kind: 'success',
      app: 'filemanager',
    })
  } else {
    os.notify({ title: 'File Manager sync failed', body: r.error || 'unknown error', kind: 'error' })
  }
  return r
}

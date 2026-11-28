// REDSEC v5.0 — /api/git : real git operations for the OS terminal (server-side isomorphic-git)
// POST { op, repo?, url?, message?, branch?, paths?, name?, email?, count?, token?, path?, limit? }
// → always application/json: { ok: true, log: string[], ...extras } | { ok: false, error: string, log?: string[] }
// op=files: { repo, limit? }  → working-tree file list (excludes .git) so clones can be
//                             pulled into the OS File Manager (Term X / Caterpillar).
// op=file:  { repo, path }    → one file as base64 (≤ 4 MB) with a guessed mime type.
import { NextResponse } from 'next/server'
import * as git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import nodeFs from 'node:fs'
import path from 'node:path'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/* Repos live OUTSIDE .next so production rebuilds never touch them */
const REPOS_ROOT = '/home/z/my-project/gitdata'
const REPO_RE = /^[\w.-]{1,64}$/
const BRANCH_RE = /^[\w.-]+(?:\/[\w.-]+){0,4}$/

const MAX = { message: 512, url: 2048, token: 256, branch: 128, paths: 64, pathLen: 256, name: 128, count: 50, path: 300, files: 4000, fileBytes: 4 * 1024 * 1024 }

type GitBody = {
  op?: string
  repo?: string
  url?: string
  message?: string
  branch?: string
  paths?: string[]
  name?: string
  email?: string
  count?: number
  token?: string
  path?: string
  limit?: number
}

const ok = (log: string[], extra: Record<string, unknown> = {}) => NextResponse.json({ ok: true, log, ...extra })
const fail = (error: string, log: string[] = []) => NextResponse.json({ ok: false, error, log })

/* strict repo-name validation: no slashes, no '..' — one flat folder under REPOS_ROOT */
function validRepo(r: unknown): string | null {
  if (typeof r !== 'string') return null
  if (!REPO_RE.test(r) || r.includes('..') || r === '.') return null
  return r
}

function validBranch(r: unknown): string | null {
  if (typeof r !== 'string') return null
  if (!BRANCH_RE.test(r) || r.includes('..') || r.length > MAX.branch) return null
  return r
}

function validUrl(r: unknown): string | null {
  if (typeof r !== 'string' || r.length > MAX.url) return null
  try {
    const u = new URL(r)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (u.username || u.password) return null
    return u.toString()
  } catch {
    return null
  }
}

function dirFor(repo: string): string {
  return path.join(REPOS_ROOT, repo)
}

function repoDirExists(repo: string): boolean {
  return nodeFs.existsSync(dirFor(repo))
}

/* a usable repo needs an actual .git (a bare folder is not one) */
function repoHasGit(repo: string): boolean {
  return nodeFs.existsSync(path.join(dirFor(repo), '.git'))
}

/* every library op runs under a deadline so the terminal never hangs forever */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

const T = { clone: 120_000, transfer: 60_000, quick: 20_000 }

function onAuthFor(token?: string): (() => { username: string; password: string }) | undefined {
  return token ? () => ({ username: 'x-access-token', password: token }) : undefined
}

/* map an isomorphic-git failure to a terminal-friendly message */
function friendlyError(e: unknown, op: string): string {
  const err = e as { name?: string; code?: string; message?: string; data?: { statusCode?: number } }
  const status = err?.data?.statusCode
  if (status === 401 || status === 403) {
    return `Authentication failed (HTTP ${status}) — private repos need a personal-access-token: append it to the command (git push <repo> <url> <token>). Public repos work without one — if the repo is public, double-check the URL (GitHub also answers 401 for repos that do not exist).`
  }
  if (err?.name === 'NotFoundError' || err?.code === 'NotFoundError') {
    return 'not found — check the repository (\`git repos\`), the branch name, or the remote URL'
  }
  if (err?.name === 'EmptyCommitError') {
    return 'nothing to commit — nothing new is staged (use `git add`, then check `git status`)'
  }
  if (err?.name === 'MergeConflictError' || err?.name === 'CheckoutConflictError' || err?.name === 'UnmergedPathsError') {
    return 'merge conflict — fix the marked files, `git add` them, then commit'
  }
  if (err?.name === 'PushRejectedError' || err?.name === 'GitPushError') {
    return 'push rejected — the remote has work you do not have. Run `git pull <repo> <url>` first, then push again.'
  }
  if (err?.name === 'HttpError' || err?.name === 'SmartHttpError' || err?.name === 'UnknownTransportError') {
    return `remote said: ${err?.message || 'http error'} — check the URL (only http(s) git URLs are supported)`
  }
  if (err?.name === 'MissingParameterError') return `${op}: missing parameter — ${err?.message || ''}`
  if (err?.name === 'InvalidRefNameError') return 'invalid branch name — use letters, digits, dot, dash, underscore'
  return err?.message ? `${err.name || op}: ${err.message}` : `${op} failed`
}

/* ---------------- status helpers ---------------- */

/* [filepath, headStatus, workdirStatus, stageStatus] → porcelain-style 2-char code */
type Row = [string, 0 | 1, 0 | 1 | 2, 0 | 1 | 2 | 3]

function rowCode(row: Row): string {
  const [, head, workdir, stage] = row
  if (stage === 3) return 'UU'
  if (head === 0 && workdir === 2 && stage === 2) return 'A '
  if (head === 1 && workdir === 2 && stage === 2) return 'M '
  if (head === 1 && workdir === 0 && stage !== 1) return 'D ' // staged delete (index no longer matches HEAD)
  if (head === 1 && workdir === 0 && stage === 1) return ' D' // deleted from workdir, index still matches HEAD
  if (head === 1 && workdir === 2 && stage <= 1) return ' M'
  if (head === 0 && workdir === 2) return '??'
  if (head === 1 && workdir === 1 && stage === 1) return '' // clean
  return 'M '
}

/* the ONLY clean row is [in-HEAD, matches-index, index-matches-HEAD]; [0,2,0] is untracked */
const isCleanRow = (row: Row) => row[1] === 1 && row[2] === 1 && row[3] === 1

function fmtDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

/* progress events → a few readable lines (never one line per chunk) */
function makeProgressLog(log: string[], cap = 40): (p: { phase: string; loaded: number; total: number }) => void {
  let lastPhase = ''
  let lastPct = -1
  return (p) => {
    const pct = p.total ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : -1
    if (p.phase !== lastPhase) {
      lastPhase = p.phase
      lastPct = pct
      log.push(pct >= 0 ? `${p.phase}… ${pct}%` : `${p.phase}…`)
    } else if (pct >= 0 && pct - lastPct >= 25) {
      lastPct = pct
      log.push(`${p.phase}… ${pct}%`)
    }
    if (log.length > cap) log.splice(0, log.length - cap)
  }
}

/* ---------------- ops ---------------- */

async function opInit(repo: string) {
  const dir = dirFor(repo)
  if (repoDirExists(repo)) return fail(`destination '${repo}' already exists — pick another name or run \`git rm-repo ${repo}\` first`)
  await withTimeout(git.init({ fs: nodeFs, dir, defaultBranch: 'main' }), T.quick, 'git init')
  return ok([`Initialized empty repository ${repo}`, `(dir: ${dir} · default branch: main)`])
}

async function opClone(repo: string, url: string, token?: string, log: string[] = []) {
  if (!repo) return fail('missing repository name — usage: git clone <url> <name>')
  if (repoDirExists(repo)) {
    return fail(`destination '${repo}' already exists — pick another name: \`git clone <url> <name>\`, or remove it first: \`git rm-repo ${repo}\``, log)
  }
  try {
    await withTimeout(
      git.clone({
        fs: nodeFs,
        http,
        dir: dirFor(repo),
        url,
        singleBranch: false,
        onProgress: makeProgressLog(log),
        onAuth: onAuthFor(token),
      }),
      T.clone,
      'git clone'
    )
  } catch (e) {
    /* failed clone → sweep the half-written folder so it never pollutes `git repos` */
    try {
      if (!repoHasGit(repo)) nodeFs.rmSync(dirFor(repo), { recursive: true, force: true })
    } catch {
      /* best effort */
    }
    throw e
  }
  const branch = await git.currentBranch({ fs: nodeFs, dir: dirFor(repo) }).catch(() => undefined)
  log.push(`✓ Cloned ${url}`)
  log.push(`  → ${REPOS_ROOT}/${repo}${branch ? ` · branch: ${String(branch)}` : ''}`)
  return ok(log)
}

async function opStatus(repo: string) {
  const dir = dirFor(repo)
  const branch = (await git.currentBranch({ fs: nodeFs, dir }).catch(() => undefined)) || '(no commits yet)'
  const matrix = (await withTimeout(git.statusMatrix({ fs: nodeFs, dir }), T.quick, 'git status')) as Row[]
  const log: string[] = [`On branch ${branch}`]
  const changed = matrix.filter((r) => !isCleanRow(r))
  if (!changed.length) {
    log.push('nothing to commit, working tree clean')
    return ok(log)
  }
  const CAP = 200
  const rows = changed.slice(0, CAP)
  const staged = rows.filter((r) => ['A ', 'M ', 'D '].includes(rowCode(r)))
  const unstaged = rows.filter((r) => [' M', ' D'].includes(rowCode(r)))
  const untracked = rows.filter((r) => rowCode(r) === '??')
  const conflicts = rows.filter((r) => rowCode(r) === 'UU')
  const label = (r: Row) => (rowCode(r) === 'A ' ? 'new file:   ' : rowCode(r) === 'D ' ? 'deleted:    ' : 'modified:   ')
  if (staged.length) {
    log.push('')
    log.push('Changes to be committed:')
    staged.forEach((r) => log.push(`  ${label(r)}${r[0]}`))
  }
  if (conflicts.length) {
    log.push('')
    log.push('Unmerged paths:')
    conflicts.forEach((r) => log.push(`  both modified: ${r[0]}`))
  }
  if (unstaged.length) {
    log.push('')
    log.push('Changes not staged for commit:')
    unstaged.forEach((r) => log.push(`  ${label(r)}${r[0]}`))
  }
  if (untracked.length) {
    log.push('')
    log.push('Untracked files:')
    untracked.forEach((r) => log.push(`  ${r[0]}`))
  }
  log.push('')
  log.push(`${changed.length} changed file${changed.length === 1 ? '' : 's'} — stage with \`git add ${repo}\``)
  if (changed.length > CAP) log.push(`… and ${changed.length - CAP} more (output truncated at ${CAP} lines)`)
  return ok(log)
}

async function opAdd(repo: string, paths?: string[]) {
  const dir = dirFor(repo)
  const matrix = (await withTimeout(git.statusMatrix({ fs: nodeFs, dir }), T.quick, 'git add')) as Row[]
  const rows = matrix.filter((r) => !isCleanRow(r))
  let targets = rows
  if (paths && paths.length && !(paths.length === 1 && paths[0] === '.')) {
    targets = rows.filter((r) => paths.some((p) => p === r[0] || r[0].startsWith(`${p.replace(/\/+$/, '')}/`)))
  }
  if (!targets.length) {
    return ok(['nothing to stage — working tree clean' + (paths?.length ? ` (no changes matched: ${paths.join(', ')})` : '')])
  }
  const toAdd = targets.filter((r) => r[2] > 0).map((r) => r[0]) // exists in workdir
  const toRm = targets.filter((r) => r[2] === 0 && r[1] === 1).map((r) => r[0]) // deleted from workdir
  if (toAdd.length) await withTimeout(git.add({ fs: nodeFs, dir, filepath: toAdd }), T.quick, 'git add')
  if (toRm.length) await withTimeout(git.remove({ fs: nodeFs, dir, filepath: toRm }), T.quick, 'git rm')
  const log: string[] = [`staged ${targets.length} file(s)`]
  const stagedCode = (r: Row) => (r[2] === 0 ? 'D ' : r[1] === 0 ? 'A ' : 'M ') // state as it lands in the index
  targets.slice(0, 50).forEach((r) => log.push(`  ${stagedCode(r).padEnd(3)} ${r[0]}`))
  if (targets.length > 50) log.push(`  … and ${targets.length - 50} more`)
  log.push(`ready: \`git commit ${repo} -m "message"\``)
  return ok(log)
}

async function opCommit(repo: string, message: string, name?: string, email?: string) {
  const dir = dirFor(repo)
  const branch = (await git.currentBranch({ fs: nodeFs, dir }).catch(() => undefined)) || 'main'
  const sha = await withTimeout(
    git.commit({
      fs: nodeFs,
      dir,
      message,
      author: { name: name || 'REDSEC User', email: email || 'user@redsec.os' },
      disallowEmpty: true,
    }),
    T.quick,
    'git commit'
  )
  return ok([`[${String(branch)} ${String(sha).slice(0, 7)}] ${message.split('\n')[0]}`, ` author: ${name || 'REDSEC User'} <${email || 'user@redsec.os'}>`])
}

async function opLog(repo: string, count: number) {
  const dir = dirFor(repo)
  const commits = await withTimeout(git.log({ fs: nodeFs, dir, depth: count }), T.quick, 'git log')
  if (!commits.length) return ok(['no commits yet — `git add` then `git commit`'])
  const log = commits.slice(0, count).map((c) => {
    const a = c.commit.author
    return `${c.oid.slice(0, 7)} ${a.name} ${fmtDate(a.timestamp)} ${c.commit.message.split('\n')[0]}`
  })
  if (commits.length > count) log.push(`… older commits hidden (show more: git log ${repo} -n ${Math.min(MAX.count, count * 2)})`)
  return ok(log)
}

async function opBranchList(repo: string) {
  const dir = dirFor(repo)
  const cur = (await git.currentBranch({ fs: nodeFs, dir }).catch(() => undefined)) || ''
  const branches = await withTimeout(git.listBranches({ fs: nodeFs, dir }), T.quick, 'git branch')
  const log = branches.map((b) => `${b === cur ? '* ' : '  '}${b}`)
  log.push('')
  log.push(`${branches.length} local branch${branches.length === 1 ? '' : 'es'}${cur ? ` · on '${cur}'` : ''}`)
  return ok(log)
}

async function opBranchCreate(repo: string, branch: string) {
  const dir = dirFor(repo)
  await withTimeout(git.branch({ fs: nodeFs, dir, ref: branch }), T.quick, 'git branch')
  return ok([`created branch '${branch}' — switch with \`git checkout ${repo} ${branch}\``])
}

async function opCheckout(repo: string, branch: string) {
  const dir = dirFor(repo)
  await withTimeout(git.checkout({ fs: nodeFs, dir, ref: branch }), T.quick, 'git checkout')
  return ok([`Switched to branch '${branch}'`])
}

async function opPush(repo: string, url: string, token?: string, log: string[] = []) {
  const result = await withTimeout(
    git.push({
      fs: nodeFs,
      http,
      dir: dirFor(repo),
      url,
      onProgress: makeProgressLog(log),
      onAuth: onAuthFor(token),
    }),
    T.transfer,
    'git push'
  )
  if (!result.ok) return fail(result.error || 'push rejected by remote', log)
  log.push('✓ Pushed to remote')
  Object.entries(result.refs || {}).forEach(([ref, st]) => log.push(`  ${ref} → ${st.ok ? 'updated' : st.error || 'unchanged'}`))
  return ok(log)
}

async function opPull(repo: string, url: string | undefined, token?: string, name?: string, email?: string, log: string[] = []) {
  await withTimeout(
    git.pull({
      fs: nodeFs,
      http,
      dir: dirFor(repo),
      ...(url ? { url } : {}),
      author: { name: name || 'REDSEC User', email: email || 'user@redsec.os' },
      onProgress: makeProgressLog(log),
      onAuth: onAuthFor(token),
    }),
    T.transfer,
    'git pull'
  )
  const branch = (await git.currentBranch({ fs: nodeFs, dir: dirFor(repo) }).catch(() => undefined)) || ''
  log.push(`✓ Pulled from remote${branch ? ` — '${branch}' now includes the fetched result` : ''}`)
  return ok(log)
}

async function opRepos() {
  nodeFs.mkdirSync(REPOS_ROOT, { recursive: true })
  const names = nodeFs
    .readdirSync(REPOS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => REPO_RE.test(n) && !n.includes('..'))
    .sort()
  if (!names.length) return ok(['no repositories yet — try `git clone <url> [name]` or `git init <name>`'], { repos: [] })
  const repos = names.map((n) => {
    const st = nodeFs.statSync(path.join(REPOS_ROOT, n))
    const hasGit = nodeFs.existsSync(path.join(REPOS_ROOT, n, '.git'))
    return { repo: n, git: hasGit, modified: fmtDate(Math.floor(st.mtimeMs / 1000)) }
  })
  const log = ['REPO           GIT   LAST MODIFIED']
  repos.forEach((r) => log.push(`${r.repo.padEnd(15)}${r.git ? 'yes' : 'no '}   ${r.modified}`))
  log.push('')
  log.push(`${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'} at ${REPOS_ROOT}`)
  return ok(log, { repos })
}

async function opRmRepo(repo: string) {
  const dir = dirFor(repo)
  if (!repoDirExists(repo)) return fail(`repository '${repo}' not found — try \`git repos\``)
  nodeFs.rmSync(dir, { recursive: true, force: true })
  return ok([`✓ Removed repository '${repo}' (working tree + .git history)`])
}

/* ---------------- File Manager bridge ----------------
 * list every file of a repo working tree (skipping .git) so the OS can mirror
 * a freshly cloned repository into the virtual File System. */

async function opFiles(repo: string, limit: number) {
  const dir = dirFor(repo)
  const root = path.resolve(dir)
  const out: Array<{ path: string; size: number }> = []
  let truncated = false
  const walk = (d: string, rel: string): void => {
    if (out.length >= limit || truncated) {
      if (out.length >= limit) truncated = true
      return
    }
    let entries: nodeFs.Dirent[]
    try {
      entries = nodeFs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= limit) {
        truncated = true
        return
      }
      if (e.name === '.git' || e.name === 'node_modules') continue
      const abs = path.join(d, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(abs, r)
      else if (e.isFile()) {
        try {
          out.push({ path: r, size: nodeFs.statSync(abs).size })
        } catch {
          /* raced file — skip silently */
        }
      }
    }
  }
  walk(root, '')
  const totalBytes = out.reduce((a, f) => a + f.size, 0)
  const log = [
    `${out.length} file${out.length === 1 ? '' : 's'} · ${(totalBytes / 1024).toFixed(1)} KB${truncated ? ' (list truncated at limit)' : ''}`,
  ]
  return ok(log, { files: out, truncated, total: out.length })
}

const MIME_BY_EXT: Array<[RegExp, string]> = [
  [/\.(txt|log|md|markdown|rst)$/i, 'text/plain'],
  [/\.(html?|xhtml)$/i, 'text/html'],
  [/\.css$/i, 'text/css'],
  [/\.m?js$/i, 'text/javascript'],
  [/\.tsx?$/i, 'text/typescript'],
  [/\.json$/i, 'application/json'],
  [/\.xml$/i, 'application/xml'],
  [/\.svg$/i, 'image/svg+xml'],
  [/\.(png)$/i, 'image/png'],
  [/\.(jpe?g)$/i, 'image/jpeg'],
  [/\.gif$/i, 'image/gif'],
  [/\.(mp3|wav|ogg|flac|m4a)$/i, 'audio/mpeg'],
  [/\.(mp4|webm|mov|mkv)$/i, 'video/mp4'],
  [/\.pdf$/i, 'application/pdf'],
  [/\.zip$/i, 'application/zip'],
  [/\.(gz|tgz)$/i, 'application/gzip'],
]

function guessMime(p: string): string {
  for (const [re, m] of MIME_BY_EXT) if (re.test(p)) return m
  return 'application/octet-stream'
}

async function opFile(repo: string, filePath: string) {
  const dir = dirFor(repo)
  const root = path.resolve(dir)
  const abs = path.resolve(dir, filePath)
  if (abs !== root && !abs.startsWith(root + path.sep)) return fail('invalid path — outside the repository')
  let st: nodeFs.Stats
  try {
    st = nodeFs.statSync(abs)
  } catch {
    return fail(`file not found: ${filePath}`)
  }
  if (!st.isFile()) return fail(`not a regular file: ${filePath}`)
  if (st.size > MAX.fileBytes) return fail(`file too large to pull (${(st.size / 1024 / 1024).toFixed(1)} MB > 4 MB cap)`)
  const buf = nodeFs.readFileSync(abs)
  return ok([`pulled ${filePath} (${buf.length} bytes)`], { content: buf.toString('base64'), size: buf.length, mime: guessMime(filePath) })
}

/* ---------------- handler ---------------- */

export async function POST(request: Request) {
  let body: GitBody
  try {
    const raw = await request.text()
    if (raw.length > 8192) return fail('request body too large')
    body = JSON.parse(raw || '{}') as GitBody
  } catch {
    return fail('invalid JSON body')
  }

  const op = typeof body.op === 'string' ? body.op.toLowerCase().trim() : ''
  if (!op) return fail('missing op — POST { op: "init|clone|status|add|commit|log|branch|checkout|push|pull|files|file|repos|rm-repo", ... }')
  if (!/^[a-z-]{1,20}$/.test(op)) return fail('invalid op name')

  /* shared arg sanitising */
  const repo = validRepo(body.repo)
  const url = body.url === undefined ? undefined : validUrl(body.url)
  const token = typeof body.token === 'string' ? body.token.slice(0, MAX.token) : undefined
  const message = typeof body.message === 'string' ? body.message.slice(0, MAX.message) : undefined
  const branch = validBranch(body.branch)
  const name = typeof body.name === 'string' ? body.name.slice(0, MAX.name) : undefined
  const email = typeof body.email === 'string' ? body.email.slice(0, MAX.name) : undefined
  const count = Math.max(1, Math.min(MAX.count, Math.floor(Number(body.count) || 10)))
  const paths = Array.isArray(body.paths)
    ? body.paths
        .slice(0, MAX.paths)
        .filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length <= MAX.pathLen && !p.startsWith('/') && !p.includes('..'))
    : undefined
  const filePath = typeof body.path === 'string'
    ? body.path.trim().replace(/^\/+/, '').slice(0, MAX.path)
    : ''
  if (filePath && filePath.includes('..')) return fail('invalid path — ".." is not allowed')
  const filesLimit = Math.max(1, Math.min(MAX.files, Math.floor(Number(body.limit) || 1000)))

  if (['status', 'add', 'commit', 'log', 'branch', 'checkout', 'push', 'pull', 'rm-repo', 'files', 'file'].includes(op) && !repo) {
    return fail('invalid or missing repository name — letters/digits/dot/dash/underscore only (no slashes)')
  }
  if ((op === 'clone' || op === 'push') && !url) return fail('invalid or missing url — an http(s) git remote URL is required')
  if (op === 'checkout' && !branch) return fail('missing branch — usage: git checkout <repo> <branch>')
  if (op === 'branch' && typeof body.branch === 'string' && body.branch.trim() && !branch) {
    return fail('invalid branch name — letters/digits/dot/dash/underscore (max 128)')
  }
  if (op === 'commit' && (!message || !message.trim())) return fail('missing commit message — use -m "message"')
  if (op === 'clone' && !repo) return fail('missing repository name — usage: git clone <url> <name>')

  if ((op === 'file') && !filePath) return fail('missing path — usage: { op: "file", repo, path: "src/index.ts" }')

  if (repo && !['init', 'clone'].includes(op)) {
    if (!repoDirExists(repo)) return fail(`repository '${repo}' not found — try \`git repos\``)
    if (['status', 'add', 'commit', 'log', 'branch', 'checkout', 'push', 'pull'].includes(op) && !repoHasGit(repo)) {
      return fail(`'${repo}' is not a git repository (no .git) — re-init with \`git init ${repo}\` after \`git rm-repo ${repo}\`, or clone it fresh`)
    }
  }

  try {
    switch (op) {
      case 'init':
        if (!repo) return fail('missing repo name — usage: git init <name>')
        return await opInit(repo)
      case 'clone':
        return await opClone(repo as string, url as string, token)
      case 'status':
        return await opStatus(repo as string)
      case 'add':
        return await opAdd(repo as string, paths)
      case 'commit':
        return await opCommit(repo as string, message as string, name, email)
      case 'log':
        return await opLog(repo as string, count)
      case 'branch':
        if (branch) return await opBranchCreate(repo as string, branch)
        return await opBranchList(repo as string)
      case 'checkout':
        return await opCheckout(repo as string, branch as string)
      case 'push':
        return await opPush(repo as string, url as string, token)
      case 'pull':
        return await opPull(repo as string, url ?? undefined, token, name, email)
      case 'files':
        return await opFiles(repo as string, filesLimit)
      case 'file':
        return await opFile(repo as string, filePath)
      case 'repos':
        return await opRepos()
      case 'rm-repo':
        return await opRmRepo(repo as string)
      default:
        return fail(`unknown op '${op}' — try init, clone, status, add, commit, log, branch, checkout, push, pull, files, file, repos, rm-repo`)
    }
  } catch (e) {
    console.error(`[api/git] op=${op} repo=${repo || '-'} failed:`, e)
    return fail(friendlyError(e, op))
  }
}

/* this endpoint is terminal-only — everything else gets a JSON 405 */
export function GET() {
  return NextResponse.json({ ok: false, error: 'method not allowed — POST /api/git with JSON body { op, ... }' }, { status: 405 })
}

#!/usr/bin/env node
// ARC_OS upload state rebuild: disk manifest -> SHA reconcile vs remote clone -> batch packing.
// Idempotent & self-healing: safe to re-run after a sandbox recycle.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROJ = '/home/z/my-project';
const STATE = path.join(PROJ, '.upload-state');
const CLONE = '/tmp/arcos-verify';
const REPO_URL = 'https://github.com/13mactonish2/ARC_OS.git';
const CAP = 130 * 1024;   // per-batch byte cap for normal batches
const PROBE_MAX = 80 * 1024; // batch-01 (first push of a chain) stays under this

const EXCL_DIRS = new Set(['.git', 'node_modules', '.next', 'download', 'gitdata', 'upload',
  'skills', '.upload-state', '.agent-browser', '.pfs-topup-tmp', '.zcode']);
const EXCL_FILES = new Set(['.env', 'dev.log', 'dev.log.old', 'worklog.md', 'bun.lock',
  'bun.lock.old', 'tsconfig.tsbuildinfo', '.DS_Store']);
const BIN_EXT = new Set(['png','jpg','jpeg','gif','ico','webp','woff','woff2','ttf','otf','eot',
  'db','sqlite','sqlite3','mp4','mp3','m4a','wav','ogg','zip','gz','tar','wasm','mpg','mpeg',
  'avi','flv','wmv','mkv','mov','webm','jar','exe','dll','so','bin','pptx','docx','xlsx','pdf',
  'odp','odt','ods','odg','jsdos','epub','ipa','apk','7z','rar','bz2','xz','class','pyc']);

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(base, e.name);
    if (e.isDirectory()) {
      if (EXCL_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), rel, out);
    } else if (e.isFile()) {
      if (e.name.startsWith('--')) continue;
      if (EXCL_FILES.has(e.name)) continue;
      if (/^\.env/.test(e.name)) continue;
      const ext = e.name.split('.').pop().toLowerCase();
      if (BIN_EXT.has(ext)) continue;
      out.push(rel);
    }
  }
}

// 1) disk manifest
const files = [];
walk(PROJ, '', files);
files.sort();

// 2) local blob SHAs (batch)
fs.writeFileSync('/tmp/manifest-paths.txt', files.join('\n') + '\n');
let localSha = new Map();
{
  const out = execSync('git hash-object --stdin-paths', { cwd: PROJ, input: files.join('\n') + '\n',
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
  const lines = out.trim().split('\n');
  files.forEach((f, i) => localSha.set(f, lines[i]));
}

// 3) remote state (fresh shallow clone)
fs.rmSync(CLONE, { recursive: true, force: true });
execSync(`git clone -q --depth 1 --single-branch --branch main ${REPO_URL} ${CLONE}`,
  { env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' }, stdio: 'pipe' });
const remoteSha = new Map();
{
  const out = execSync('git ls-files -s', { cwd: CLONE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' } });
  for (const line of out.trim().split('\n')) {
    const m = line.match(/^\d+\s+([0-9a-f]{40})\s+\d+\s+(.*)$/);
    if (m) remoteSha.set(m[2], m[1]);
  }
}

// 4) reconcile
const need = [];
let sameCount = 0, diffCount = 0;
for (const f of files) {
  const rs = remoteSha.get(f);
  if (rs === undefined) need.push(f);
  else if (rs === localSha.get(f)) sameCount++;
  else { need.push(f); diffCount++; }
}

// 5) size info + pack (220KB cap, smallest first, megas last as single-file batches)
const sized = need.map(f => ({ f, s: fs.statSync(path.join(PROJ, f)).size }));
sized.sort((a, b) => a.s - b.s);
const normal = [], mega = [];
for (const it of sized) (it.s > 220 * 1024 ? mega : normal).push(it);

const batches = [];
// batch-01: probe, smallest files until PROBE_MAX
let probe = [], probeBytes = 0, pi = 0;
for (; pi < normal.length; pi++) {
  if (probeBytes + normal[pi].s > PROBE_MAX && probe.length) break;
  probe.push(normal[pi]); probeBytes += normal[pi].s;
}
if (probe.length) batches.push(probe);
// remaining normal batches at CAP
let cur = [], curBytes = 0;
for (; pi < normal.length; pi++) {
  const it = normal[pi];
  if (curBytes + it.s > CAP && cur.length) { batches.push(cur); cur = []; curBytes = 0; }
  cur.push(it); curBytes += it.s;
}
if (cur.length) batches.push(cur);
for (const it of mega) batches.push([it]); // mega single-file batches at the end, ascending

// 6) write state
fs.rmSync(STATE, { recursive: true, force: true });
fs.mkdirSync(path.join(STATE, 'batches'), { recursive: true });
fs.writeFileSync(path.join(STATE, 'pushset.paths'), need.join('\n') + (need.length ? '\n' : ''));
fs.writeFileSync(path.join(STATE, 'done.txt'), '');
fs.writeFileSync(path.join(STATE, 'attempts.txt'), '');
fs.writeFileSync(path.join(STATE, 'skipped.txt'), '');
fs.writeFileSync(path.join(STATE, 'lock.txt'), '');
let megaNote = '';
for (let i = 0; i < batches.length; i++) {
  const nn = String(i + 1).padStart(2, '0');
  const body = batches[i].map(it => `${it.s}\t${it.f}`).join('\n') + '\n';
  fs.writeFileSync(path.join(STATE, 'batches', `batch-${nn}.txt`), body);
  if (batches[i].length === 1 && batches[i][0].s > CAP) megaNote += ` batch-${nn}=${batches[i][0].f}`;
}
fs.writeFileSync(path.join(STATE, 'state.log'),
  `REBUILD ${new Date().toISOString()} manifest=${files.length} same=${sameCount} diff=${diffCount} need=${need.length} batches=${batches.length}\n`);
const needBytes = sized.reduce((a, b) => a + b.s, 0);
fs.writeFileSync(path.join(STATE, 'totals.txt'),
  JSON.stringify({ manifest: files.length, same: sameCount, changed: diffCount, need: need.length,
    batches: batches.length, needBytes }, null, 1));

console.log(`manifest=${files.length} already-on-remote-same=${sameCount} changed=${diffCount} need-push=${need.length}`);
console.log(`batches=${batches.length} needBytes=${needBytes}`);
console.log(`largest:${sized.slice(-5).reverse().map(x => ` ${x.f}(${x.s})`).join('') || ' none'}`);
console.log(`mega-single-file-batches:${megaNote || ' none'}`);
console.log(`batch-01 bytes=${batches[0].reduce((a, b) => a + b.s, 0)} files=${batches[0].length}`);

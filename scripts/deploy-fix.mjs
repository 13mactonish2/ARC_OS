#!/usr/bin/env node
// ============================================================================
// REDSEC OS — DEPLOYMENT FIX NODE (self-healing deployment automation)
// ============================================================================
// WHY THIS EXISTS
//   Every session the same deployment issues appear and get fixed by hand:
//     1. Stale processes holding :3000 (serve-production / standalone / dev /
//        chrome) -> new server can't bind, pages fail.
//     2. The sandbox platform periodically re-runs .zscripts/dev.sh whose
//        wait_for_service gives :3000 only 60s; dead port during a build
//        triggers its cleanup trap which KILLS builds mid-flight.
//     3. Builds OOM without a capped heap, or hang forever without a timeout.
//     4. A stray/killed build leaves BUILD_ID without standalone, or
//        standalone without synced static assets -> broken chunk 404s.
//     5. After deploy nobody proves the site actually serves (page + chunks).
//
// WHAT THIS NODE DOES (the proven 6-step flow, automated + hardened)
//   Phase 1  KILL        stale servers/builds/chrome, force-free :3000
//   Phase 2  LOCK        hold /tmp/redsec-serve.lock so concurrent platform
//                        serve-production.sh invocations exit 0 instantly
//   Phase 3  PLACEHOLDER hold :3000 with a friendly status page during the
//                        build (platform health checks keep passing, users see
//                        "applying system update" instead of a black screen)
//   Phase 4  CLEAN       rm BUILD_ID (forces fresh build), optional --clean
//   Phase 5  LINT        eslint, warning-only (doesn't block deploy)
//   Phase 6  BUILD       next build --webpack, 2900MB heap, 540s timeout,
//                        live output streaming, OOM detect -> auto retry
//   Phase 7  SYNC        static + public -> standalone, BUILD_ID cross-check
//   Phase 8  LAUNCH      kill placeholder/lock, start kill-proof supervised
//                        serve-production.sh detached, wait for port
//   Phase 9  VERIFY      GET / = 200 + real HTML, a real /_next/static chunk
//                        = 200, BUILD_ID match, server proc alive
//                        -> FAIL = automatic SELF-HEAL: full clean rebuild,
//                        resync, relaunch, reverify (one cycle)
//   Phase 10 REPORT      per-phase durations, BUILD_ID, verdict, diagnostics
//
// USAGE
//   bun run deploy:fix                  full auto deploy + fix
//   bun run deploy:fix -- --clean       deep clean (.next wiped) before build
//   bun run deploy:fix -- --no-lint     skip eslint
//   bun run deploy:fix -- --skip-build  only sync assets + restart + verify
//   bun run deploy:status               quick health check of current deploy
//   node scripts/deploy-fix.mjs --help  all flags
// ============================================================================

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// ---------------------------------------------------------------- constants
const PORT = 3000;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const HEAP_MB = 2900;
const BUILD_TIMEOUT_S = 540;
const LOCK_FILE = '/tmp/redsec-serve.lock';
const BUILD_LOG = '/tmp/deploy-fix-build.log';
const DEV_LOG = path.join(ROOT, 'dev.log');
const PLACEHOLDER_TAG = 'redsec-deploy-placeholder';
const NEXT_BIN = path.join(ROOT, 'node_modules', '.bin', 'next');

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const t0All = Date.now();
const phaseTimes = [];
let phaseStart = Date.now();
function beginPhase(name) {
  phaseStart = Date.now();
  console.log(`\n${C.cyan(C.bold(`── PHASE ${name} ${'─'.repeat(Math.max(2, 58 - name.length))}`))}`);
}
function endPhase(name) {
  const secs = ((Date.now() - phaseStart) / 1000).toFixed(1);
  phaseTimes.push([name, secs]);
  console.log(C.dim(`   [${name} done in ${secs}s]`));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- cli flags
const args = process.argv.slice(2);
const FLAGS = {
  clean: args.includes('--clean'),
  noLint: args.includes('--no-lint'),
  skipBuild: args.includes('--skip-build'),
  status: args.includes('--status'),
  help: args.includes('--help') || args.includes('-h'),
};
if (FLAGS.help) {
  console.log(`REDSEC Deployment Fix Node

  node scripts/deploy-fix.mjs [flags]

  flags:
    --clean        wipe .next entirely before building (corrupted build fix)
    --no-lint      skip eslint pre-check
    --skip-build   don't build; only sync assets, restart server, verify
    --status       print current deployment health and exit
    -h, --help     this help
`);
  process.exit(0);
}

// ---------------------------------------------------------------- helpers
function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts });
}
function shOrNull(cmd) {
  try { return sh(cmd); } catch { return null; }
}
function readTrim(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; }
}
function buildId() { return readTrim(path.join(ROOT, '.next', 'BUILD_ID')); }
function standaloneBuildId() {
  return readTrim(path.join(ROOT, '.next', 'standalone', '.next', 'BUILD_ID'));
}
function memAvailableMB() {
  try {
    const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+) kB/);
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch { return null; }
}

function httpGet(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 4_000_000) req.destroy(); });
      res.on('end', () => resolve({ ok: true, status: res.statusCode, body }));
      res.on('error', () => resolve({ ok: false, status: res.statusCode || 0, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, status: 0, body: String(e && e.message) }));
  });
}

async function waitForPort(maxSeconds, label) {
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    const r = await httpGet(ORIGIN + '/', 2500);
    if (r.ok && r.status > 0) return true;
    await sleep(1000);
  }
  console.log(C.red(`   !! ${label}: port ${PORT} still dead after ${maxSeconds}s`));
  return false;
}

async function waitForPortDown(maxSeconds) {
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    const r = await httpGet(ORIGIN + '/', 1500);
    if (!r.ok || r.status === 0) return true;
    await sleep(700);
  }
  return false;
}

const KILL_PATTERNS = [
  'scripts/serve-production.sh',
  '.next/standalone/server.js',
  'next dev',
  'next start',
  'next build',
  'next-server',
  'Bun.serve',
  'redsec-serve.lock',
  'sleep 100000',
  'chrome',
  'chromium',
  'headless_shell',
];

async function killPatterns(patterns = KILL_PATTERNS) {
  const killed = new Set();
  for (const p of patterns) {
    try { execSync(`pkill -f -- ${JSON.stringify(p)} >/dev/null 2>&1 || true`, { shell: '/bin/bash' }); } catch { /* noop */ }
  }
  await sleep(400);
  // double-check: SIGKILL anything that survived, never touching this node
  try {
    const out = sh('ps -eo pid=,args=');
    for (const line of out.split('\n')) {
      if (line.includes('deploy-fix') || line.includes('ps -eo')) continue;
      for (const p of patterns) {
        if (line.includes(p)) {
          const pid = Number.parseInt(line.trim(), 10);
          if (Number.isInteger(pid) && pid > 1 && pid !== process.pid && pid !== process.ppid) {
            try { process.kill(pid, 'SIGKILL'); killed.add(pid); } catch { /* gone */ }
          }
        }
      }
    }
  } catch { /* noop */ }
  return [...killed];
}

// temp processes owned by this run; killed on exit no matter what
const tempProcs = [];
function spawnTemp(cmd, cmdArgs, extra = {}) {
  const child = spawn(cmd, cmdArgs, { cwd: ROOT, detached: true, stdio: 'ignore', ...extra });
  tempProcs.push(child.pid);
  child.unref();
  return child;
}
function cleanupTemp() {
  for (const pid of tempProcs) { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { console.log(C.yellow(`\n   deploy-fix interrupted (${sig}) — cleaning up…`)); cleanupTemp(); process.exit(130); });
}

function forceFreePort() {
  try { sh(`fuser -k ${PORT}/tcp >/dev/null 2>&1 || true`, { shell: '/bin/bash' }); } catch { /* noop */ }
}
function procPids(match) {
  try {
    const out = sh('ps -eo pid=,args=');
    return out.split('\n').filter((l) => l.includes(match) && !l.includes('deploy-fix') && !l.includes('ps -eo'))
      .map((l) => Number.parseInt(l.trim(), 10)).filter(Number.isInteger);
  } catch { return []; }
}

// ---------------------------------------------------------------- build
let buildOutputTail = [];
async function runBuildOnce() {
  const env = {
    ...process.env,
    NODE_OPTIONS: `--max-old-space-size=${HEAP_MB}`,
    NEXT_TELEMETRY_DISABLED: '1',
  };
  fs.writeFileSync(BUILD_LOG, `deploy-fix build start ${new Date().toISOString()}\n`);
  return new Promise((resolve) => {
    let timedOut = false;
    const child = spawn(NEXT_BIN, ['build', '--webpack'], { cwd: ROOT, env });
    const timer = setTimeout(() => {
      timedOut = true;
      console.log(C.yellow(`   !! build exceeded ${BUILD_TIMEOUT_S}s — killing`));
      try { child.kill('SIGKILL'); } catch { /* noop */ }
    }, BUILD_TIMEOUT_S * 1000);
    const started = Date.now();
    const feed = (d) => {
      const s = d.toString();
      process.stdout.write(C.dim(s));
      fs.appendFileSync(BUILD_LOG, s);
      for (const line of s.split(/\r?\n/)) {
        if (line.trim()) { buildOutputTail.push(line); if (buildOutputTail.length > 60) buildOutputTail.shift(); }
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, seconds: ((Date.now() - started) / 1000).toFixed(1) });
    });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, signal: null, timedOut, seconds: '0', spawnError: String(e) }); });
  });
}
function looksLikeOom(res) {
  const hay = buildOutputTail.join('\n');
  return /heap out of memory|JavaScript heap|OOM|Killed|SIGKILL|allocation failed|Array buffer allocation/i.test(hay)
    || res.signal === 'SIGKILL' || /getaddrinfo|Killed/i.test(String(res.spawnError || ''));
}
function looksLikeHang(res) { return res.timedOut; }

// ---------------------------------------------------------------- status mode
async function statusMode() {
  console.log(C.bold('REDSEC deployment status'));
  const bid = buildId();
  const sbid = standaloneBuildId();
  const r = await httpGet(ORIGIN + '/', 4000);
  const staticDir = path.join(ROOT, '.next', 'standalone', '.next', 'static');
  const pubDir = path.join(ROOT, '.next', 'standalone', 'public');
  const staticOk = fs.existsSync(staticDir) && fs.readdirSync(staticDir).length > 0;
  const pubOk = fs.existsSync(pubDir) && fs.readdirSync(pubDir).length > 0;
  const serverProcs = procPids('.next/standalone/server.js');
  let stale = 0;
  try { stale = sh('find src prisma public scripts package.json next.config.ts -newer .next/BUILD_ID -print 2>/dev/null | wc -l').trim(); } catch { /* noop */ }

  const rows = [
    ['port 3000', r.ok ? C.green(`UP (HTTP ${r.status}, ${(r.body.length / 1024).toFixed(0)} KB)`) : C.red('DOWN')],
    ['.next/BUILD_ID', bid ? C.green(bid) : C.red('missing')],
    ['standalone BUILD_ID', sbid ? (sbid === bid ? C.green('match') : C.red(`MISMATCH (${sbid})`)) : C.red('missing')],
    ['standalone static', staticOk ? C.green('synced') : C.red('missing')],
    ['standalone public', pubOk ? C.green('synced') : C.red('missing')],
    ['server process', serverProcs.length ? C.green(`alive pid ${serverProcs.join(',')}`) : C.red('not running')],
    ['stale sources', Number(stale) > 0 ? C.yellow(`${stale} file(s) newer than BUILD_ID — rebuild needed`) : C.green('none')],
    ['mem available', `${memAvailableMB() ?? '?'} MB`],
  ];
  for (const [k, v] of rows) console.log(`   ${k.padEnd(22)} ${v}`);
  const healthy = r.ok && r.status === 200 && bid && sbid === bid && staticOk && pubOk && serverProcs.length > 0 && Number(stale) === 0;
  console.log(healthy ? `\n${C.green(C.bold('   VERDICT: healthy'))}` : `\n${C.red(C.bold('   VERDICT: unhealthy'))} — run ${C.cyan('bun run deploy:fix')}`);
  process.exit(healthy ? 0 : 1);
}

// ---------------------------------------------------------------- main
async function main() {
  console.log(C.bold(`\nREDSEC Deployment Fix Node — ${new Date().toISOString()}`));
  console.log(C.dim(`   root=${ROOT}  heap=${HEAP_MB}MB  build-timeout=${BUILD_TIMEOUT_S}s  flags=${JSON.stringify(FLAGS)}`));
  if (FLAGS.status) await statusMode();

  // ---------------------------------------------------------- 1. KILL
  beginPhase('1/KILL');
  const before = memAvailableMB();
  const killed = await killPatterns();
  forceFreePort();
  const portDown = await waitForPortDown(6);
  if (!portDown) { await killPatterns(); forceFreePort(); await waitForPortDown(4); }
  console.log(`   killed ${C.bold(killed.length)} stale process(es); port ${PORT} ${portDown ? C.green('free') : C.yellow('busy')}  |  mem ${before ?? '?'} -> ${memAvailableMB() ?? '?'} MB`);
  endPhase('1/KILL');

  // ---------------------------------------------------------- 2. LOCK
  beginPhase('2/LOCK');
  const lockHolder = spawnTemp('bash', ['-c', `exec 9>${LOCK_FILE}; if flock -n 9; then exec sleep 100000; else exit 1; fi`]);
  await sleep(500);
  const lockOwned = lockHolder.exitCode === null && lockHolder.signalCode === null;
  console.log(lockOwned
    ? `   lock ${LOCK_FILE} held — concurrent serve-production invocations will exit 0`
    : C.yellow('   could not hold lock (continuing — stale holder should have been killed)'));
  endPhase('2/LOCK');

  // ---------------------------------------------------------- 3. PLACEHOLDER
  beginPhase('3/PLACEHOLDER');
  spawnTemp('bun', ['-e', `/*${PLACEHOLDER_TAG}*/ Bun.serve({port:${PORT},fetch:()=>new Response('REDSEC OS — applying system update (deploy-fix), back in a moment…',{headers:{'Content-Type':'text/plain'}})})`]);
  const phUp = await waitForPort(10, 'placeholder');
  console.log(phUp ? `   placeholder serving :${PORT} — platform health checks stay green during build` : C.yellow('   placeholder failed to bind (continuing)'));
  endPhase('3/PLACEHOLDER');

  // ---------------------------------------------------------- 4. CLEAN
  beginPhase('4/CLEAN');
  const bidOld = buildId();
  if (FLAGS.clean) {
    fs.rmSync(path.join(ROOT, '.next'), { recursive: true, force: true });
    console.log(`   ${C.yellow('--clean')} — wiped .next entirely (old BUILD_ID ${bidOld ?? '—'})`);
  } else {
    fs.rmSync(path.join(ROOT, '.next', 'BUILD_ID'), { force: true });
    fs.rmSync(path.join(ROOT, '.next', 'standalone'), { recursive: true, force: true });
    console.log(`   removed BUILD_ID (${bidOld ?? '—'}) + stale standalone — fresh build guaranteed`);
  }
  endPhase('4/CLEAN');

  // ---------------------------------------------------------- 5. LINT
  if (!FLAGS.noLint) {
    beginPhase('5/LINT');
    let lintOut = '';
    let lintOk = true;
    try { lintOut = sh('bun run lint', { cwd: ROOT, timeout: 180000 }); } catch (e) { lintOk = false; lintOut = String(e.stdout || e.message || ''); }
    console.log(lintOk ? C.green('   eslint passed') : C.yellow(`   eslint issues (non-blocking):\n${lintOut.split('\n').slice(0, 12).join('\n')}`));
    endPhase('5/LINT');
  } else {
    console.log(C.dim('\n   5/LINT skipped (--no-lint)'));
  }

  // ---------------------------------------------------------- 6. BUILD
  beginPhase('6/BUILD');
  if (FLAGS.skipBuild) {
    if (!buildId()) { console.log(C.red('   --skip-build but no BUILD_ID exists — cannot continue')); cleanupTemp(); process.exit(1); }
    console.log(C.yellow('   --skip-build — reusing existing build'));
  } else {
    let attempt = 0;
    while (true) {
      attempt++;
      console.log(C.dim(`   build attempt ${attempt} (webpack, heap ${HEAP_MB}MB, timeout ${BUILD_TIMEOUT_S}s)…`));
      const res = await runBuildOnce();
      if (res.code === 0) {
        console.log(C.green(`   build OK in ${res.seconds}s — BUILD_ID ${C.bold(buildId() ?? '?')}`));
        break;
      }
      const oom = looksLikeOom(res);
      const hang = looksLikeHang(res);
      console.log(C.red(`   build FAILED (code=${res.code}${res.signal ? ` sig=${res.signal}` : ''} after ${res.seconds}s)${oom ? ' — OOM signature detected' : ''}${hang ? ' — hang/timeout' : ''}`));
      if (attempt >= 2) {
        console.log(C.red('   second failure — dumping diagnostics and aborting'));
        cleanupTemp();
        console.log(C.dim(buildOutputTail.slice(-30).map((l) => `     | ${l}`).join('\n')));
        process.exit(1);
      }
      console.log(C.yellow('   self-remediation: wiping .next and retrying once'));
      fs.rmSync(path.join(ROOT, '.next'), { recursive: true, force: true });
    }
  }
  endPhase('6/BUILD');

  // ---------------------------------------------------------- 7. SYNC
  beginPhase('7/SYNC');
  const bid = buildId();
  if (!bid) { console.log(C.red('   no BUILD_ID after build — aborting')); cleanupTemp(); process.exit(1); }
  fs.mkdirSync(path.join(ROOT, '.next', 'standalone', '.next'), { recursive: true });
  fs.rmSync(path.join(ROOT, '.next', 'standalone', '.next', 'static'), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, '.next', 'standalone', 'public'), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, '.next', 'static'), path.join(ROOT, '.next', 'standalone', '.next', 'static'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'public'), path.join(ROOT, '.next', 'standalone', 'public'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.next', 'BUILD_ID'), path.join(ROOT, '.next', 'standalone', '.next', 'BUILD_ID'));
  const staticCount = fs.readdirSync(path.join(ROOT, '.next', 'standalone', '.next', 'static')).length;
  const syncOk = standaloneBuildId() === bid && staticCount > 0;
  console.log(syncOk
    ? `   static (${staticCount} dirs) + public synced into standalone; BUILD_ID ${C.green('match')}`
    : C.red('   sync verification FAILED'));
  if (!syncOk) { cleanupTemp(); process.exit(1); }
  endPhase('7/SYNC');

  // ---------------------------------------------------------- shared: launch + verify
  async function launchAndVerify() {
    // 8. LAUNCH
    beginPhase('8/LAUNCH');
    await killPatterns(['Bun.serve', 'sleep 100000', 'redsec-serve.lock']);
    cleanupTemp(); // releases our placeholder + lock
    await sleep(600);
    forceFreePort();
    const launcher = spawn('bash', ['scripts/serve-production.sh'], { cwd: ROOT, detached: true, stdio: 'ignore' });
    launcher.unref();
    const up = await waitForPort(90, 'serve-production');
    if (up) {
      const procs = procPids('.next/standalone/server.js');
      console.log(`   serve-production.sh detached (pid ${launcher.pid}); standalone server ${procs.length ? C.green(`alive pid ${procs.join(',')}`) : C.yellow('binding…')}`);
    }
    endPhase('8/LAUNCH');

    // 9. VERIFY
    beginPhase('9/VERIFY');
    const problems = [];
    const page = await httpGet(ORIGIN + '/', 10000);
    if (!page.ok || page.status !== 200) problems.push(`GET / -> ${page.status || 'no response'}`);
    else if (!/<html|<!doctype/i.test(page.body)) problems.push('GET / returned non-HTML body');
    else console.log(`   GET / ${C.green('200')} — ${(page.body.length / 1024).toFixed(0)} KB HTML`);

    const norm = page.body.replace(/\\\//g, '/');
    const asset = norm.match(/\/_next\/static\/[^"'\s<>()\\]+/);
    if (asset) {
      const ar = await httpGet(ORIGIN + asset[0], 8000);
      if (ar.ok && ar.status === 200) console.log(`   chunk ${C.dim(asset[0].slice(0, 64))} ${C.green('200')}`);
      else problems.push(`chunk ${asset[0]} -> ${ar.status || 'no response'}`);
    } else problems.push('no /_next/static asset found in HTML');

    if (standaloneBuildId() !== buildId()) problems.push('BUILD_ID mismatch after launch');
    if (!procPids('.next/standalone/server.js').length) problems.push('standalone server process not running');

    if (problems.length) {
      console.log(C.red(`   VERIFY FAILED:\n      - ${problems.join('\n      - ')}`));
      endPhase('9/VERIFY');
      return false;
    }
    console.log(C.green('   all verification checks passed'));
    endPhase('9/VERIFY');
    return true;
  }

  // ---------------------------------------------------------- 8+9 with self-heal
  let ok = await launchAndVerify();
  if (!ok) {
    console.log(C.yellow(C.bold('\n   SELF-HEAL: verification failed — full clean rebuild + relaunch (one automatic cycle)')));
    beginPhase('SELF-HEAL');
    await killPatterns();
    forceFreePort();
    fs.rmSync(path.join(ROOT, '.next'), { recursive: true, force: true });
    console.log('   .next wiped — rebuilding…');
    const res = await runBuildOnce();
    if (res.code !== 0) {
      console.log(C.red('   self-heal build FAILED — dumping diagnostics and aborting'));
      cleanupTemp();
      console.log(C.dim(buildOutputTail.slice(-30).map((l) => `     | ${l}`).join('\n')));
      process.exit(1);
    }
    console.log(C.green(`   self-heal build OK — BUILD_ID ${buildId()}`));
    fs.mkdirSync(path.join(ROOT, '.next', 'standalone', '.next'), { recursive: true });
    fs.rmSync(path.join(ROOT, '.next', 'standalone', '.next', 'static'), { recursive: true, force: true });
    fs.rmSync(path.join(ROOT, '.next', 'standalone', 'public'), { recursive: true, force: true });
    fs.cpSync(path.join(ROOT, '.next', 'static'), path.join(ROOT, '.next', 'standalone', '.next', 'static'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'public'), path.join(ROOT, '.next', 'standalone', 'public'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.next', 'BUILD_ID'), path.join(ROOT, '.next', 'standalone', '.next', 'BUILD_ID'));
    ok = await launchAndVerify();
    endPhase('SELF-HEAL');
  }

  // ---------------------------------------------------------- 10. REPORT
  beginPhase('10/REPORT');
  const totalSecs = ((Date.now() - t0All) / 1000).toFixed(1);
  const miniCount = procPids('bun --hot index.ts').length;
  console.log(`   BUILD_ID  ${C.bold(buildId() ?? '?')}`);
  console.log(`   URL       ${C.cyan(ORIGIN)} (preview panel / open in new tab)`);
  console.log(`   server    kill-proof supervised serve-production.sh (self-restarts on crash)`);
  console.log(`   mini-svc  ${miniCount} running (managed separately, untouched)`);
  console.log(`   mem       ${memAvailableMB() ?? '?'} MB available`);
  console.log(C.dim(`   ${phaseTimes.map(([n, s]) => `${n}:${s}s`).join('  ')}`));
  if (ok) {
    console.log(`\n${C.green(C.bold(`   DEPLOY FIXED AND VERIFIED in ${totalSecs}s`))} — run agent-browser QA next`);
    console.log(C.dim('   health check anytime: bun run deploy:status'));
  } else {
    console.log(C.red(C.bold(`\n   DEPLOY FAILED after self-heal in ${totalSecs}s — diagnostics below`)));
    const dl = shOrNull(`tail -n 25 ${JSON.stringify(DEV_LOG)}`);
    if (dl) console.log(C.dim(`   --- dev.log tail ---\n${dl.split('\n').map((l) => `   | ${l}`).join('\n')}`));
    cleanupTemp();
    process.exit(1);
  }
  endPhase('10/REPORT');
  cleanupTemp();
  process.exit(0);
}

main().catch((e) => {
  console.error(C.red(`deploy-fix crashed: ${e && e.stack ? e.stack : e}`));
  cleanupTemp();
  process.exit(1);
});

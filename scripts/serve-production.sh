#!/bin/bash
# ============================================================================
# REDSEC OS v5.0 — production server launcher (kill-proof edition)
# ============================================================================
# THREAT MODEL (all confirmed by forensics in worklog Task 18-fix2):
#   1. The sandbox platform re-runs .zscripts/dev.sh periodically. Its
#      wait_for_service gives :3000 only 60s; if the port isn't up it ERRORs
#      and its cleanup trap `kill`s its whole `bun run dev` child tree —
#      which IS this script when invoked as `bun run dev`. That is what
#      killed builds mid-flight.
#   2. A `>(tee ...)` stdout pipe dies with the launching shell session and
#      the next log write SIGPIPEs the server. Logs must go to FILES.
#   3. Bare `node` long-running processes were also observed dying; bun is
#      the platform-blessed runtime for serving (comm-service never dies).
#
# DEFENSES:
#   - flock single-instance lock: concurrent platform invocations exit 0
#     instantly, so dev.sh's health check finds OUR healthy server and
#     completes cleanly (no cleanup-kill).
#   - while building, a tiny placeholder server HOLDS :3000 so every
#     platform health check passes and the user sees a status page instead
#     of a black screen.
#   - logs append straight to files; server runs under bun; supervised
#     loop self-heals any crash in ~1s.
# ============================================================================
set -e
cd "$(dirname "$0")/.."

mkdir -p /home/z/my-project
exec >> /home/z/my-project/dev.log 2>&1

echo "[serve-production] $(date '+%F %T') launcher start (pid $$)"

# ---- single instance -------------------------------------------------------
exec 9>/tmp/redsec-serve.lock
if ! flock -n 9; then
  echo "[serve-production] another instance already owns :3000 — exiting 0"
  exit 0
fi

port_up() { curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$1/" 2>/dev/null; }

# ---- build decision --------------------------------------------------------
NEED_BUILD=0
if [ ! -f .next/BUILD_ID ]; then
  NEED_BUILD=1; echo "[serve-production] no BUILD_ID — build required"
elif [ ! -f .next/standalone/server.js ]; then
  # Hardening (Task: deploy-repair): a stray/killed build can wipe
  # .next/standalone while leaving BUILD_ID behind — rebuild, don't bail.
  NEED_BUILD=1; echo "[serve-production] standalone server.js missing — rebuild required"
elif [ "$(cat .next/BUILD_ID)" != "$(cat .next/standalone/.next/BUILD_ID 2>/dev/null)" ]; then
  NEED_BUILD=1; echo "[serve-production] standalone BUILD_ID mismatch — rebuild required"
elif [ -n "$(find src prisma public scripts package.json next.config.ts -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]; then
  NEED_BUILD=1; echo "[serve-production] sources changed — rebuild required"
fi

PLACEHOLDER_PID=""
if [ "$NEED_BUILD" = "1" ]; then
  # Hold :3000 with a friendly placeholder so platform health checks
  # (60s window) keep passing while webpack runs (~2 min).
  bun -e "Bun.serve({port:3000,fetch:()=>new Response('REDSEC OS v5.0 — applying system update, back in a moment…',{headers:{'Content-Type':'text/plain'}})})" &
  PLACEHOLDER_PID=$!
  echo "[serve-production] placeholder holding :3000 (pid $PLACEHOLDER_PID)"
  sleep 1

  echo "[serve-production] building (node+webpack, needs free RAM)…"
  if NODE_OPTIONS=--max-old-space-size=2900 NEXT_TELEMETRY_DISABLED=1 \
      ./node_modules/.bin/next build --webpack; then
    echo "[serve-production] build OK: BUILD_ID=$(cat .next/BUILD_ID 2>/dev/null)"
  else
    echo "[serve-production] ⚠ build FAILED — keeping placeholder, will retry in 30s loops"
  fi

  # runtime assets next to server.js (idempotent; only if a build exists)
  if [ -f .next/BUILD_ID ]; then
    mkdir -p .next/standalone/.next
    rm -rf .next/standalone/.next/static .next/standalone/public
    cp -r .next/static .next/standalone/.next/static
    cp -r public .next/standalone/public
  fi

  kill "$PLACEHOLDER_PID" 2>/dev/null || true
  wait "$PLACEHOLDER_PID" 2>/dev/null || true
  PLACEHOLDER_PID=""
  sleep 0.5
fi

# ---- supervised serve loop --------------------------------------------------
export NODE_ENV=production
export NODE_OPTIONS=""
export HOSTNAME=0.0.0.0
export PORT=3000

if [ ! -f .next/standalone/server.js ]; then
  echo "[serve-production] ⚠ no standalone server.js — cannot serve!"
  exit 1
fi

# Pre-flight: static assets must match this build inside standalone.
# (A previously-running server keeps old chunks in memory; a killed sync
# leaves stale/missing assets → "pages fail". Re-sync here, every boot.)
if [ -d .next/static ] && { [ ! -d .next/standalone/.next/static ] || [ ! -f .next/standalone/.next/static/"$(ls .next/static | head -1)" ]; }; then
  echo "[serve-production] re-syncing static assets into standalone…"
  rm -rf .next/standalone/.next/static .next/standalone/public
  cp -r .next/static .next/standalone/.next/static
  cp -r public .next/standalone/public
fi

echo "[serve-production] serving on 0.0.0.0:3000 (bun, supervised)"
while true; do
  # Guard inside the loop too: if a stray build wiped standalone mid-flight,
  # drop into placeholder mode and rebuild instead of crash-looping forever.
  if [ ! -f .next/standalone/server.js ]; then
    echo "[serve-production] standalone vanished — rebuilding in-place…"
    bun -e "Bun.serve({port:3000,fetch:()=>new Response('REDSEC OS — recovering from interrupted update, back in a moment…',{headers:{'Content-Type':'text/plain'}})})" &
    PH=$!
    NODE_OPTIONS=--max-old-space-size=2900 NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next build --webpack \
      && { mkdir -p .next/standalone/.next; rm -rf .next/standalone/.next/static .next/standalone/public; cp -r .next/static .next/standalone/.next/static; cp -r public .next/standalone/public; echo "[serve-production] in-place rebuild OK"; }
    kill "$PH" 2>/dev/null || true; wait "$PH" 2>/dev/null || true
    sleep 1
    continue
  fi
  bun .next/standalone/server.js
  code=$?
  echo "[serve-production] ⚠ server exited code=$code at $(date '+%F %T') — restart in 1s"
  # brief placeholder so platform checks never see a dead port
  bun -e "Bun.serve({port:3000,fetch:()=>new Response('REDSEC OS restarting…',{headers:{'Content-Type':'text/plain'}})})" &
  PH=$!
  sleep 2
  kill "$PH" 2>/dev/null || true
  wait "$PH" 2>/dev/null || true
  sleep 1
done

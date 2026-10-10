#!/usr/bin/env bash
# Stakehouse hosted deploy — pull origin/main, rebuild, atomically swap, restart.
#
# Runs on the PROJECT sandbox inside the deployed clone (/home/user/work/stakehouse).
# Safe to run repeatedly: it no-ops when origin/main is already deployed, builds
# the SPA into a temp directory, and only swaps + restarts after a successful
# build — and rolls the previous build back if the restarted server fails its
# health check. Untracked runtime state (apps/web/data — the SQLite ledger) is
# never touched: `git reset --hard` does not remove untracked files.
#
# The updater pulls over unauthenticated HTTPS, which works while the repo is
# public. If lowemajid/stakehouse ever goes private, give the sandbox read
# access (deploy key or token) or deploys become manual: run this script by hand.
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PORT="${PORT:-8817}"
LOG_DIR="${LOG_DIR:-/home/user/work/logs}"

start_server() {
  mkdir -p "$LOG_DIR"
  tmux kill-session -t "svc-$PORT" 2>/dev/null || true
  tmux new-session -d -s "svc-$PORT" \
    "PORT=$PORT bash '$REPO_DIR/ops/start-hosted.sh' >> '$LOG_DIR/stakehouse-server.log' 2>&1"
}

health() { curl -sf "http://localhost:$PORT/api/health" >/dev/null; }

cd "$REPO_DIR"
git fetch origin main

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"

# The updater only takes over once ops/ itself is on main; before that merge
# the bootstrap deploy (built by hand) keeps serving.
if ! git cat-file -e "$REMOTE_SHA:ops/deploy.sh" 2>/dev/null; then
  echo "deploy: ops/ not on origin/main yet — updater idle, bootstrap build stays live"
  exit 0
fi

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  echo "deploy: up to date at ${LOCAL_SHA:0:7}"
  exit 0
fi

echo "deploy: ${LOCAL_SHA:0:7} -> ${REMOTE_SHA:0:7}"
git reset --hard origin/main

if [ ! -d node_modules ]; then
  echo "deploy: node_modules missing — npm ci"
  npm ci
elif ! git diff --quiet "$LOCAL_SHA" "$REMOTE_SHA" -- package-lock.json; then
  echo "deploy: package-lock.json changed — npm ci"
  npm ci
fi

echo "deploy: building SPA into apps/web/dist-next"
rm -rf apps/web/dist-next
(cd apps/web && npx vite build --outDir dist-next --emptyOutDir)

rm -rf apps/web/dist-prev
if [ -d apps/web/dist ]; then
  mv apps/web/dist apps/web/dist-prev
fi
mv apps/web/dist-next apps/web/dist

echo "deploy: restarting svc-$PORT"
start_server

for i in $(seq 1 20); do
  health && break
  sleep 1
done

if health; then
  echo "deploy: live at ${REMOTE_SHA:0:7} — /api/health ok"
  rm -rf apps/web/dist-prev
else
  echo "deploy: health check failed on ${REMOTE_SHA:0:7} — rolling back" >&2
  tmux kill-session -t "svc-$PORT" 2>/dev/null || true
  if [ -d apps/web/dist-prev ]; then
    rm -rf apps/web/dist
    mv apps/web/dist-prev apps/web/dist
  fi
  start_server
  exit 1
fi

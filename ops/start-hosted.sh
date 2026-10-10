#!/usr/bin/env bash
# Hosted entrypoint for the project sandbox. The hosting wake path runs this
# command inside tmux session svc-$PORT, so it must end with the server in the
# foreground (exec). It also makes sure the deploy watchdog is running —
# idempotently — so a sandbox wake after a pause brings the updater back too.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8817}"
LOG_DIR="${LOG_DIR:-/home/user/work/logs}"
mkdir -p "$LOG_DIR"

if ! tmux has-session -t deploy-watchdog 2>/dev/null; then
  tmux new-session -d -s deploy-watchdog \
    "bash '$REPO_DIR/ops/deploy-watchdog.sh' >> '$LOG_DIR/stakehouse-deploy.log' 2>&1"
fi

cd "$REPO_DIR"
exec env PORT="$PORT" ./node_modules/.bin/tsx apps/web/src/server/main.ts

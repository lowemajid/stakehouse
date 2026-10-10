#!/usr/bin/env bash
# Pull-based updater: run deploy.sh whenever origin/main moves. Runs as the
# tmux session `deploy-watchdog`; start-hosted.sh re-spawns it after a sandbox
# wake if it died. A failed deploy never takes the current build down —
# deploy.sh exits nonzero and the loop retries on the next tick.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL="${DEPLOY_INTERVAL:-120}"

echo "watchdog: polling origin/main every ${INTERVAL}s"
while true; do
  if ! bash "$REPO_DIR/ops/deploy.sh"; then
    echo "watchdog: deploy attempt failed — keeping the current build, retrying next tick"
  fi
  sleep "$INTERVAL"
done

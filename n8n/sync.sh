#!/usr/bin/env bash
# Import the workflow files and restart n8n so they take effect.
#
# Two things this handles that a bare `n8n import:workflow` does not:
#   1. Stable ids in each file, so imports update in place instead of cloning.
#   2. n8n 2.x will not activate a workflow whose `activeVersionId` does not
#      point at its current `versionId`, and import bumps the version — so the
#      pointer has to be re-aimed afterwards or nothing goes live.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$HERE")"
DB="${N8N_USER_FOLDER:-$HOME}/.n8n/database.sqlite"
LOG="${N8N_LOG_FILE:-/tmp/n8n.log}"

echo "→ stopping n8n"
pkill -f "n8n start" 2>/dev/null || true
sleep 3

echo "→ importing workflows"
cd "$APP_DIR"
n8n import:workflow --separate --input=./n8n

# `import:workflow` deactivates everything it touches and ignores the `active`
# field in the file, so the webhook workflows are switched back on by id here.
echo "→ activating the webhook workflows"
sqlite3 "$DB" "UPDATE workflow_entity SET active = 1 WHERE id IN ('otcPipeline00001','otcOutcome000001');"

echo "→ pointing each active workflow at its current version"
sqlite3 "$DB" "UPDATE workflow_entity SET activeVersionId = versionId WHERE active = 1;"

echo "→ clearing webhook rows orphaned by removed workflows"
sqlite3 "$DB" "DELETE FROM webhook_entity WHERE workflowId NOT IN (SELECT id FROM workflow_entity);"

echo "→ starting n8n"
export N8N_SECURE_COOKIE=false N8N_DIAGNOSTICS_ENABLED=false N8N_RUNNERS_ENABLED=true
n8n start > "$LOG" 2>&1 &

for _ in $(seq 1 90); do
  curl -s -o /dev/null http://localhost:5678/healthz 2>/dev/null && break
  sleep 2
done
sleep 3

echo "→ active workflows:"
grep -E "^Activated" "$LOG" | sed 's/^/   /' || echo "   (none — check $LOG)"

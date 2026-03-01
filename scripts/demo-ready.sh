#!/usr/bin/env bash
set -euo pipefail

# One-command local demo prep for ClickUp webhook flow.
#
# What it does:
# 1) Loads .env values for required ClickUp vars
# 2) Restarts local services cleanly
# 3) Re-registers webhook in strict demo mode
# 4) Restarts services again so refreshed webhook URL/secret are applied
#
# Usage:
#   scripts/demo-ready.sh

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "❌ .env not found in repo root."
  exit 1
fi

echo "📦 Loading .env variables needed for reset..."
set -a
# shellcheck disable=SC1091
source .env
set +a

: "${CLICKUP_API_TOKEN:?CLICKUP_API_TOKEN missing in .env}"
: "${CLICKUP_TEAM_ID:?CLICKUP_TEAM_ID missing in .env}"

echo
echo "🧹 Clearing shell overrides for webhook URL/secret..."
unset CLICKUP_WEBHOOK_URL CLICKUP_WEBHOOK_SECRET

echo
echo "🔁 Restarting local services (pass 1)..."
./stop-services.sh || true
./start-services.sh

echo
echo "🔗 Re-registering ClickUp webhook in demo-ready mode..."
scripts/clickup-webhook-reset.sh --demo-ready

echo
echo "🔁 Restarting local services (pass 2) to load updated .env webhook values..."
unset CLICKUP_WEBHOOK_URL CLICKUP_WEBHOOK_SECRET
./stop-services.sh || true
./start-services.sh

echo
echo "✅ Local demo setup complete."
echo "Final manual check:"
echo "1) In ClickUp, toggle one task: Approved -> To Do -> Approved"
echo "2) Watch logs:"
echo "   tail -f logs/clickup-integration.log logs/differ.log"
echo "3) Confirm /learning updated in dashboard"

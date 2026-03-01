#!/usr/bin/env bash
set -euo pipefail

# Reset/re-register ClickUp webhook with pre-demo checks.
#
# Required env:
#   CLICKUP_API_TOKEN
#   CLICKUP_TEAM_ID
#
# Optional env:
#   CLICKUP_WEBHOOK_URL (fallback when ngrok API is unavailable)
#   CLICKUP_INTEGRATION_BASE (default: http://localhost:3007)
#   DB_BASE (default: http://localhost:3004)
#   DIFFER_BASE (default: http://localhost:3006)
#   NGROK_API_BASE (default: http://127.0.0.1:4040)
#   ENV_FILE (default: .env)
#
# Flags:
#   --delete-existing   Delete existing team webhooks before creating a new one
#   --backfill-pending  Call local /webhook/backfill-pending after registration
#   --demo-ready        Alias for: --delete-existing --backfill-pending
#   --skip-local-checks Skip localhost health checks (not recommended)

DELETE_EXISTING=false
BACKFILL_PENDING=false
SKIP_LOCAL_CHECKS=false

for arg in "$@"; do
  case "$arg" in
    --delete-existing) DELETE_EXISTING=true ;;
    --backfill-pending) BACKFILL_PENDING=true ;;
    --demo-ready)
      DELETE_EXISTING=true
      BACKFILL_PENDING=true
      ;;
    --skip-local-checks) SKIP_LOCAL_CHECKS=true ;;
    *)
      echo "Unknown arg: $arg"
      echo "Usage: $0 [--delete-existing] [--backfill-pending] [--demo-ready] [--skip-local-checks]"
      exit 1
      ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required"
  exit 1
fi

: "${CLICKUP_API_TOKEN:?CLICKUP_API_TOKEN is required}"
: "${CLICKUP_TEAM_ID:?CLICKUP_TEAM_ID is required}"

CLICKUP_INTEGRATION_BASE="${CLICKUP_INTEGRATION_BASE:-http://localhost:3007}"
DB_BASE="${DB_BASE:-http://localhost:3004}"
DIFFER_BASE="${DIFFER_BASE:-http://localhost:3006}"
NGROK_API_BASE="${NGROK_API_BASE:-http://127.0.0.1:4040}"
ENV_FILE="${ENV_FILE:-.env}"

trim_env() {
  # Trim CR/LF and surrounding whitespace from env values.
  printf '%s' "$1" | tr -d '\r\n' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g'
}

fail() {
  echo
  echo "❌ $1"
  exit 1
}

check_local_json() {
  local url="$1"
  local jq_expr="$2"
  local label="$3"
  local body
  body="$(curl -fsS "$url" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    fail "$label check failed: cannot reach $url"
  fi
  if ! echo "$body" | jq -e "$jq_expr" >/dev/null 2>&1; then
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    fail "$label check failed for $url (jq: $jq_expr)"
  fi
  echo "✅ $label"
}

upsert_env_kv() {
  local file="$1"
  local key="$2"
  local value="$3"
  if [[ ! -f "$file" ]]; then
    printf '%s="%s"\n' "$key" "$value" > "$file"
    return
  fi
  local tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v val="$value" '
    BEGIN { done = 0 }
    $0 ~ ("^" key "=") {
      print key "=\"" val "\""
      done = 1
      next
    }
    { print }
    END {
      if (!done) print key "=\"" val "\""
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

CLICKUP_API_TOKEN="$(trim_env "$CLICKUP_API_TOKEN")"
CLICKUP_TEAM_ID="$(trim_env "$CLICKUP_TEAM_ID")"

discover_ngrok_public_url() {
  local response
  response="$(curl -fsS "$NGROK_API_BASE/api/tunnels" 2>/dev/null || true)"
  if [[ -z "$response" ]]; then
    return 0
  fi
  echo "$response" | jq -r '.tunnels[]? | select(.proto=="https") | .public_url' | head -n 1
}

validate_endpoint() {
  local endpoint="$1"
  if [[ -z "$endpoint" ]]; then
    fail "Webhook endpoint is empty. Start ngrok and/or set CLICKUP_WEBHOOK_URL."
  fi
  if [[ ! "$endpoint" =~ ^https://[^/]+(/.*)?$ ]]; then
    fail "Webhook endpoint must be a valid HTTPS URL. Got: $endpoint"
  fi
  # Guard against truncated hosts like free.dev seen from bad copy/paste exports.
  if [[ "$endpoint" =~ ^https?://free\.dev(/|$) ]] || [[ "$endpoint" =~ ^http:// ]]; then
    fail "Webhook endpoint is malformed or insecure ($endpoint). Use the full ngrok HTTPS URL."
  fi
}

NGROK_PUBLIC_URL="$(discover_ngrok_public_url | tr -d '\r\n' | sed -E 's/[[:space:]]+$//g')"
if [[ -n "$NGROK_PUBLIC_URL" ]]; then
  WEBHOOK_ENDPOINT="$NGROK_PUBLIC_URL"
  echo "Using ngrok-discovered endpoint base: $NGROK_PUBLIC_URL"
else
  WEBHOOK_ENDPOINT="$(trim_env "${CLICKUP_WEBHOOK_URL:-}")"
  echo "ngrok API not reachable; falling back to CLICKUP_WEBHOOK_URL."
fi

if [[ "$WEBHOOK_ENDPOINT" != */webhook/clickup ]]; then
  WEBHOOK_ENDPOINT="${WEBHOOK_ENDPOINT%/}/webhook/clickup"
fi
validate_endpoint "$WEBHOOK_ENDPOINT"

if ! $SKIP_LOCAL_CHECKS; then
  echo "Running local preflight checks..."
  check_local_json "$CLICKUP_INTEGRATION_BASE/health" '.status == "ok" and .service == "clickup-integration" and .configured == true' "ClickUp integration health/config"
  check_local_json "$DB_BASE/submissions/pending" 'type == "array"' "DB connectivity"
  check_local_json "$DIFFER_BASE/stats" '.total_comparisons >= 0' "Differ health"
fi

if [[ "$WEBHOOK_ENDPOINT" != *"/webhook/clickup" ]]; then
  fail "Webhook endpoint must end with /webhook/clickup"
fi

echo "Validating ClickUp token..."
TEAM_CHECK="$(curl -s -H "Authorization: $CLICKUP_API_TOKEN" "https://api.clickup.com/api/v2/team")"
if ! echo "$TEAM_CHECK" | jq -e '.teams | length > 0' >/dev/null 2>&1; then
  echo "Token validation failed:"
  echo "$TEAM_CHECK"
  exit 1
fi
echo "Token is valid."

echo
echo "Current team webhooks:"
CURRENT_HOOKS="$(curl -s -H "Authorization: $CLICKUP_API_TOKEN" "https://api.clickup.com/api/v2/team/$CLICKUP_TEAM_ID/webhook")"
echo "$CURRENT_HOOKS" | jq '.'

if $DELETE_EXISTING; then
  echo
  echo "Deleting existing webhooks..."
  IDS="$(echo "$CURRENT_HOOKS" | jq -r '.webhooks[]?.id')"
  if [[ -z "$IDS" ]]; then
    echo "No existing webhooks to delete."
  else
    while IFS= read -r id; do
      [[ -z "$id" ]] && continue
      curl -s -X DELETE -H "Authorization: $CLICKUP_API_TOKEN" "https://api.clickup.com/api/v2/webhook/$id" >/dev/null || true
      echo "Deleted webhook: $id"
    done <<< "$IDS"
  fi
fi

echo
echo "Registering webhook endpoint: $WEBHOOK_ENDPOINT"
REGISTER_PAYLOAD="$(jq -cn --arg endpoint "$WEBHOOK_ENDPOINT" '{endpoint:$endpoint,events:["taskStatusUpdated"]}')"
REGISTER_RESPONSE="$(curl -s -X POST \
  -H "Authorization: $CLICKUP_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$REGISTER_PAYLOAD" \
  "https://api.clickup.com/api/v2/team/$CLICKUP_TEAM_ID/webhook")"

echo "$REGISTER_RESPONSE" | jq '.'

NEW_ID="$(echo "$REGISTER_RESPONSE" | jq -r '.id // .webhook.id // empty')"
NEW_SECRET="$(echo "$REGISTER_RESPONSE" | jq -r '.secret // .webhook.secret // empty')"

if [[ -z "$NEW_ID" ]]; then
  echo
  echo "Failed to register webhook (missing id)."
  exit 1
fi

echo
echo "Webhook registered: $NEW_ID"
if [[ -n "$NEW_SECRET" ]]; then
  upsert_env_kv "$ENV_FILE" "CLICKUP_WEBHOOK_SECRET" "$NEW_SECRET"
  echo "Updated $ENV_FILE with CLICKUP_WEBHOOK_SECRET"
fi
upsert_env_kv "$ENV_FILE" "CLICKUP_WEBHOOK_URL" "$WEBHOOK_ENDPOINT"
echo "Updated $ENV_FILE with CLICKUP_WEBHOOK_URL"

echo
echo "Verifying current team webhooks..."
FINAL_HOOKS="$(curl -s -H "Authorization: $CLICKUP_API_TOKEN" "https://api.clickup.com/api/v2/team/$CLICKUP_TEAM_ID/webhook")"
echo "$FINAL_HOOKS" | jq '.'

MATCHED="$(echo "$FINAL_HOOKS" | jq -e --arg id "$NEW_ID" --arg ep "$WEBHOOK_ENDPOINT" \
  '.webhooks[] | select(.id == $id and .endpoint == $ep)')"
if [[ -z "$MATCHED" ]]; then
  fail "Registered webhook was not found with exact endpoint match."
fi

HEALTH_STATUS="$(echo "$MATCHED" | jq -r '.health.status // "unknown"')"
if [[ "$HEALTH_STATUS" != "active" ]]; then
  echo "$MATCHED" | jq '.'
  fail "Webhook health is '$HEALTH_STATUS' (expected 'active')."
fi
echo "✅ Webhook endpoint + health are active"

if $BACKFILL_PENDING; then
  echo
  echo "Running pending backfill via local integration service..."
  BACKFILL_RESPONSE="$(curl -fsS -X POST "$CLICKUP_INTEGRATION_BASE/webhook/backfill-pending" 2>/dev/null || true)"
  if [[ -z "$BACKFILL_RESPONSE" ]]; then
    fail "Backfill call failed: cannot reach $CLICKUP_INTEGRATION_BASE/webhook/backfill-pending"
  fi
  echo "$BACKFILL_RESPONSE" | jq '.'
fi

echo
echo "✅ Pre-demo setup complete."
echo "ℹ️  If services were already running, restart so updated .env values are loaded."
echo
echo "Manual final check (required):"
echo "1) In ClickUp, move one test task Approved -> To Do -> Approved"
echo "2) Watch logs:"
echo "   tail -f logs/clickup-integration.log logs/differ.log"
echo "3) Confirm /learning updates in dashboard."

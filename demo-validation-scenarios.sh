#!/bin/bash

# Demo helper for validation scenarios.
# Usage:
#   ./demo-validation-scenarios.sh wrong
#   ./demo-validation-scenarios.sh empty
#   ./demo-validation-scenarios.sh messy
#   ./demo-validation-scenarios.sh clean
#   ./demo-validation-scenarios.sh all   # run every scenario

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PARSER_ENDPOINT="${PARSER_ENDPOINT:-http://localhost:3001/parser}"
SUBMITTER_EMAIL="${SUBMITTER_EMAIL:-chef.demo@example.com}"

declare -A FILE_MAP=(
  ["wrong"]="$ROOT_DIR/samples/demo-docs/demo_wrong_template.docx"
  ["empty"]="$ROOT_DIR/samples/demo-docs/demo_empty_template.docx"
  ["messy"]="$ROOT_DIR/samples/demo-docs/demo_messy_menu.docx"
  ["clean"]="$ROOT_DIR/samples/demo-docs/demo_clean_menu.docx"
)

declare -A DESC_MAP=(
  ["wrong"]="Rejects a random Word doc that ignores the RSH template"
  ["empty"]="Template passes but no menu content after the boundary marker"
  ["messy"]="Template passes yet QA pre-check fails because of placeholders"
  ["clean"]="Fully compliant submission that flows into AI review"
)

print_usage() {
  cat <<'EOF'
Demo Validation Runner
----------------------
Pass one of: wrong, empty, messy, clean, all

Example:
  ./demo-validation-scenarios.sh messy

Environment overrides:
  PARSER_ENDPOINT   (default http://localhost:3001/parser)
  SUBMITTER_EMAIL   (default chef.demo@example.com)
EOF
}

check_prereqs() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required but not installed."
    exit 1
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required for pretty-printing responses."
    exit 1
  fi

  if ! command -v nc >/dev/null 2>&1; then
    echo "nc (netcat) is required but not installed."
    exit 1
  fi

  local parser_host parser_port parser_scheme
  parser_scheme="$(echo "$PARSER_ENDPOINT" | sed -E 's#(https?)://.*#\1#')"
  parser_host="$(echo "$PARSER_ENDPOINT" | sed -E 's#https?://([^:/]+).*#\1#')"
  parser_port="$(echo "$PARSER_ENDPOINT" | sed -E 's#https?://[^:/]+:([0-9]+).*#\1#')"
  if [[ "$parser_port" == "$PARSER_ENDPOINT" ]]; then
    if [[ "$parser_scheme" == "https" ]]; then
      parser_port=443
    else
      parser_port=80
    fi
  fi

  if ! nc -z "$parser_host" "$parser_port" >/dev/null 2>&1; then
    echo "Parser service not reachable at $parser_host:$parser_port."
    echo "Start services with ./start-services.sh and try again."
    exit 1
  fi
}

pretty_print() {
  local payload="$1"
  if printf '%s' "$payload" | python3 -m json.tool 2>/dev/null; then
    return
  fi
  echo "$payload"
}

run_scenario() {
  local name="$1"
  local file="${FILE_MAP[$name]}"
  local desc="${DESC_MAP[$name]}"

  if [[ -z "${file:-}" ]]; then
    echo "Unknown scenario: $name"
    exit 1
  fi

  if [[ ! -f "$file" ]]; then
    echo "Missing sample file for '$name': $file"
    exit 1
  fi

  echo "=============================================="
  echo "Scenario: $name"
  echo "File: $file"
  echo "Goal: $desc"
  echo "----------------------------------------------"

  response="$(curl -s -w $'\nHTTP_STATUS:%{http_code}' \
    -X POST "$PARSER_ENDPOINT" \
    -F "file=@$file" \
    -F "submitter_email=$SUBMITTER_EMAIL")"

  http_code="${response##*HTTP_STATUS:}"
  body="${response%HTTP_STATUS:*}"

  echo "HTTP $http_code"
  pretty_print "$body"
  echo ""
}

main() {
  if [[ $# -lt 1 ]]; then
    print_usage
    exit 1
  fi

  check_prereqs

  local arg="$1"
  if [[ "$arg" == "all" ]]; then
    for scenario in wrong empty messy clean; do
      run_scenario "$scenario"
    done
  else
    run_scenario "$arg"
  fi
}

main "$@"



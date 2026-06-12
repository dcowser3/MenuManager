#!/usr/bin/env bash
# Daily improvement-cycle cron entrypoint (installed on the Lightsail host by
# the deploy workflow). Runs the cycle inside the deployed dashboard container
# so it gets the compose env (.env), the built dist/, and the persistent
# tmp/logs volumes. The script itself gates on new reviewer corrections, so an
# idle day costs one database count query.
set -euo pipefail

cd "$(dirname "$0")/.."

if docker ps >/dev/null 2>&1; then
  DOCKER=(docker)
elif sudo -n docker ps >/dev/null 2>&1; then
  DOCKER=(sudo docker)
else
  echo "Docker is not available for this user." >&2
  exit 1
fi

if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  COMPOSE=("${DOCKER[@]}" compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "Docker Compose is not installed." >&2
  exit 1
fi

exec "${COMPOSE[@]}" exec -T dashboard sh -c \
  'node /app/scripts/improvement-cycle.js >> /app/logs/improvement-cycle.log 2>&1'

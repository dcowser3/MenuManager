#!/usr/bin/env bash
#
# Dev-environment wrapper for docker compose. Replaces ./start-services.sh.
#
#   ./dev-up.sh                 — build (if needed) + start everything, follow logs
#   ./dev-up.sh -d              — start detached (no log follow)
#   ./dev-up.sh dashboard       — only dashboard + its declared deps
#   ./dev-up.sh --rebuild       — force rebuild of the dev image before starting
#   ./dev-up.sh --reset-venv    — rebuild only the dev image (nukes the Python
#                                 venv inside it). Use when docx-redliner
#                                 errors with empty stderr / SIGTERM.
#   ./dev-up.sh --down          — stop and remove containers
#   ./dev-up.sh --nuke          — stop + remove containers, networks, AND named
#                                 volumes (anonymous node_modules / venv).
#                                 Recovers from "module not found" after a
#                                 dependency change.
#
# Anything not recognized is forwarded straight to `docker compose up`.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v docker >/dev/null 2>&1; then
    echo "error: docker is not on PATH. install Docker Desktop first." >&2
    exit 1
fi

if [[ ! -f .env ]]; then
    echo "error: .env not found at repo root. copy .env.example and fill it in." >&2
    exit 1
fi

COMPOSE=(docker compose -f docker-compose.dev.yml)

case "${1:-}" in
    --down)
        "${COMPOSE[@]}" down
        exit 0
        ;;
    --nuke)
        "${COMPOSE[@]}" down -v
        echo "containers and anonymous volumes removed. next ./dev-up.sh will rebuild deps + venv."
        exit 0
        ;;
    --rebuild)
        shift
        "${COMPOSE[@]}" build
        exec "${COMPOSE[@]}" up "$@"
        ;;
    --reset-venv)
        echo "rebuilding dev image to refresh the Python venv..."
        "${COMPOSE[@]}" build --no-cache
        echo "venv refreshed. start services with: ./dev-up.sh"
        exit 0
        ;;
esac

exec "${COMPOSE[@]}" up "$@"

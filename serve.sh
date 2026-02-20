#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_DIR="$SCRIPT_DIR/docs"
PORT="${1:-8080}"
LOG_FILE="${2:-}"

if [ ! -f "$DOCS_DIR/index.html" ]; then
  echo "Build output not found. Running build first..."
  node "$SCRIPT_DIR/build.mjs"
fi

if [ -n "$LOG_FILE" ]; then
  echo "Starting server on http://localhost:$PORT (logging to $LOG_FILE)"
  npx http-server "$DOCS_DIR" -p "$PORT" --cors -c-1 > "$LOG_FILE" 2>&1
else
  echo "Starting server on http://localhost:$PORT"
  npx http-server "$DOCS_DIR" -p "$PORT" --cors -c-1
fi

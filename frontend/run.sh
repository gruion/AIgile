#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# Run the Jira AI Dashboard frontend standalone (no Docker)
#
# Requirements: Node.js >= 18
#
# Usage:
#   ./run.sh                                 # defaults: API at http://localhost:3011, port 3000
#   ./run.sh -p 8080                         # serve on port 8080
#   ./run.sh -a http://myapi:3011            # custom API URL
#   ./run.sh -d                              # dev mode (hot reload)
# ──────────────────────────────────────────────────────────
set -euo pipefail

PORT=3000
API_URL="http://localhost:3011"
DEV_MODE=false

while getopts "p:a:dh" opt; do
  case $opt in
    p) PORT="$OPTARG" ;;
    a) API_URL="$OPTARG" ;;
    d) DEV_MODE=true ;;
    h)
      echo "Usage: $0 [-p port] [-a api_url] [-d]"
      echo "  -p  Port to serve on (default: 3000)"
      echo "  -a  API base URL (default: http://localhost:3011)"
      echo "  -d  Run in dev mode with hot reload"
      exit 0
      ;;
    *) echo "Unknown option: -$opt" >&2; exit 1 ;;
  esac
done

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is required (>= 18). Install from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Error: Node.js >= 18 required (found v$(node -v))"
  exit 1
fi

export NEXT_PUBLIC_API_URL="$API_URL"

echo "Installing dependencies..."
npm install

if [ "$DEV_MODE" = true ]; then
  echo ""
  echo "Starting in dev mode on port $PORT..."
  echo "  API URL: $API_URL"
  echo ""
  PORT=$PORT npx next dev -p "$PORT"
else
  echo ""
  echo "Building production bundle..."
  npx next build

  echo ""
  echo "Starting production server on port $PORT..."
  echo "  API URL: $API_URL"
  echo ""
  PORT=$PORT npx next start -p "$PORT"
fi

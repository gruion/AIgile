#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# Run the Jira AI Dashboard frontend via Docker
#
# Usage:
#   ./docker-run.sh                          # defaults: API at http://localhost:3011, port 3010
#   ./docker-run.sh -p 8080                  # serve on port 8080
#   ./docker-run.sh -a http://myapi:3011     # custom API URL
#   ./docker-run.sh -p 8080 -a http://api:3011
# ──────────────────────────────────────────────────────────
set -euo pipefail

PORT=3010
API_URL="http://localhost:3011"

while getopts "p:a:h" opt; do
  case $opt in
    p) PORT="$OPTARG" ;;
    a) API_URL="$OPTARG" ;;
    h)
      echo "Usage: $0 [-p port] [-a api_url]"
      echo "  -p  Port to expose (default: 3010)"
      echo "  -a  API base URL (default: http://localhost:3011)"
      exit 0
      ;;
    *) echo "Unknown option: -$opt" >&2; exit 1 ;;
  esac
done

IMAGE_NAME="jira-dashboard-frontend"
CONTAINER_NAME="jira-dashboard-frontend"

echo "Building Docker image..."
docker build -t "$IMAGE_NAME" .

echo ""
echo "Starting container on port $PORT..."
echo "  API URL: $API_URL"
echo ""

# Stop existing container if running
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${PORT}:3000" \
  -e "NEXT_PUBLIC_API_URL=${API_URL}" \
  "$IMAGE_NAME"

echo ""
echo "Dashboard is running at: http://localhost:${PORT}"
echo ""
echo "Commands:"
echo "  docker logs -f $CONTAINER_NAME   # view logs"
echo "  docker stop $CONTAINER_NAME      # stop"
echo "  docker rm $CONTAINER_NAME        # remove"

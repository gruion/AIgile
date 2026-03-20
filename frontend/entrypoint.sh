#!/bin/sh
# Replace build-time placeholder with runtime NEXT_PUBLIC_API_URL
# Works on OpenShift (restricted SCC) by copying everything to writable /tmp
if [ -n "$NEXT_PUBLIC_API_URL" ] && [ "$NEXT_PUBLIC_API_URL" != "__API_URL_PLACEHOLDER__" ]; then
  echo "Patching API URL → $NEXT_PUBLIC_API_URL"
  cp -r /app /tmp/app
  find /tmp/app -name '*.js' -exec sed -i "s|__API_URL_PLACEHOLDER__|$NEXT_PUBLIC_API_URL|g" {} +
  cd /tmp/app
fi
exec node server.js

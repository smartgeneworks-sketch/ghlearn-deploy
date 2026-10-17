#!/usr/bin/env bash
# Run ONLY after https://ghlearn.com and https://api.ghlearn.com serve valid certificates.
# Requires RENDER_API_KEY in the environment. Does not print secrets.
set -euo pipefail
: "${RENDER_API_KEY:?Set RENDER_API_KEY}"
S=https://api.render.com/v1/services/srv-db81vb5g1s2s738nji8g
curl -sf -X PUT -H "Authorization: Bearer $RENDER_API_KEY" -H 'Content-Type: application/json' \
  -d '{"value":"lax"}' "$S/env-vars/COOKIE_SAMESITE" >/dev/null
curl -sf -X PUT -H "Authorization: Bearer $RENDER_API_KEY" -H 'Content-Type: application/json' \
  -d '{"value":"https://ghlearn.com"}' "$S/env-vars/APP_URL" >/dev/null
echo "COOKIE_SAMESITE=lax"
# Host-only cookies on api.ghlearn.com are same-site with ghlearn.com under Lax; Domain is optional.
if [[ "${SET_COOKIE_DOMAIN:-}" == "1" ]]; then
  curl -sf -X PUT -H "Authorization: Bearer $RENDER_API_KEY" -H 'Content-Type: application/json' \
    -d '{"value":".ghlearn.com"}' "$S/env-vars/COOKIE_DOMAIN" >/dev/null
  echo "COOKIE_DOMAIN=.ghlearn.com"
fi
dep=$(curl -sf -X POST -H "Authorization: Bearer $RENDER_API_KEY" -H 'Content-Type: application/json' \
  -d '{"clearCache":"do_not_clear"}' "$S/deploys")
echo "deploy $(python3 -c "import json,sys;d=json.loads(sys.argv[1]);print(d.get('id'), d.get('status'))" "$dep")"
echo "When live: open https://ghlearn.com and sign in again. web.app redirects to ghlearn.com."

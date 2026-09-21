#!/usr/bin/env bash
# Optional: put the site behind Cloudflare Access so only Halo emails can reach it.
# Leave this unrun if the download page is meant to be public.
#
# Prereqs (one-time, in the Cloudflare dashboard):
#   * Zero Trust enabled on the account - https://one.dash.cloudflare.com
#   * Default "One-time PIN" login method on (default)
#
# Env:
#   CLOUDFLARE_API_TOKEN   token with "Access: Apps and Policies - Edit" + "Account - Read"
#   CLOUDFLARE_ACCOUNT_ID  account id (see: npx wrangler whoami)
#   PAGES_DOMAIN           host to protect; default: bi-assistant.halo-powered-labs.com
#   ALLOWED_DOMAINS        comma-separated email domains; default: halopowered.com
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
PAGES_DOMAIN="${PAGES_DOMAIN:-bi-assistant.halo-powered-labs.com}"
ALLOWED_DOMAINS="${ALLOWED_DOMAINS:-halopowered.com}"

API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/access/apps"
AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")

INCLUDE=$(python3 -c '
import json,sys
print(json.dumps([{"email_domain":{"domain":d.strip()}} for d in sys.argv[1].split(",") if d.strip()]))
' "$ALLOWED_DOMAINS")

echo "> Creating self-hosted Access application for ${PAGES_DOMAIN}"
APP_ID=$(curl -sS "${AUTH[@]}" -X POST "${API}" \
  --data "{\"name\":\"Halo BI Assistant - download\",\"domain\":\"${PAGES_DOMAIN}\",\"type\":\"self_hosted\",\"session_duration\":\"24h\"}" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["result"]["id"]) if d.get("success") else sys.exit(json.dumps(d["errors"]))')
echo "  app id: ${APP_ID}"

echo "> Adding allow policy (email domains: ${ALLOWED_DOMAINS})"
curl -sS "${AUTH[@]}" -X POST "${API}/${APP_ID}/policies" \
  --data "{\"name\":\"Allowed email domains\",\"decision\":\"allow\",\"precedence\":1,\"include\":${INCLUDE}}" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("  ok policy:", d["result"]["name"]) if d.get("success") else sys.exit(json.dumps(d["errors"]))'

echo "OK - protected. Only ${ALLOWED_DOMAINS} can reach https://${PAGES_DOMAIN}"

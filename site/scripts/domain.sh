#!/usr/bin/env bash
# Attach a subdomain of halo-powered-labs.com to this Pages project.
# The zone halo-powered-labs.com must already be in this Cloudflare account —
# Cloudflare then auto-creates the CNAME and issues the TLS cert.
#
# Env:
#   CLOUDFLARE_API_TOKEN   token with "Cloudflare Pages — Edit" (+ "DNS — Edit" on the zone)
#   CLOUDFLARE_ACCOUNT_ID  account id (see `npx wrangler whoami`)
#   CUSTOM_DOMAIN          default: bi-assistant.halo-powered-labs.com
#   CF_PAGES_PROJECT       default: halo-bi-assistant
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
DOMAIN="${CUSTOM_DOMAIN:-bi-assistant.halo-powered-labs.com}"
PROJECT="${CF_PAGES_PROJECT:-halo-bi-assistant}"
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT/domains"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")

echo "▸ Attaching $DOMAIN to Pages project '$PROJECT'…"
curl -sS "${AUTH[@]}" -X POST "$API" --data "{\"name\":\"$DOMAIN\"}" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("  ✔", d["result"]["name"], "→ status:", d["result"].get("status","pending")) if d.get("success") else sys.exit(json.dumps(d["errors"]))'

echo "✔ $DOMAIN attached. Cloudflare will auto-create the CNAME + TLS cert (a minute or two)."
echo "  Optional: lock it — PAGES_DOMAIN=$DOMAIN ./scripts/protect.sh"

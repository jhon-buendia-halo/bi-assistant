#!/usr/bin/env bash
# Publish site/public to Cloudflare Pages.
#
# The site is plain static files — there is no build step, so this uploads
# ./public as-is. First run creates the Pages project.
#
# Env:
#   CLOUDFLARE_API_TOKEN   token with "Cloudflare Pages — Edit"   (or run `wrangler login`)
#   CLOUDFLARE_ACCOUNT_ID  account id (see `npx wrangler whoami`)
#   CF_PAGES_PROJECT       default: halo-bi-assistant
set -euo pipefail
PROJECT="${CF_PAGES_PROJECT:-halo-bi-assistant}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "▸ Deploying $ROOT/public to Pages project '$PROJECT'…"
npx --yes wrangler@4 pages deploy "$ROOT/public" \
  --project-name "$PROJECT" \
  --branch main \
  --commit-dirty=true

echo "✔ Deployed. Preview: https://$PROJECT.pages.dev"
echo "  Next: attach the subdomain — ./scripts/domain.sh"

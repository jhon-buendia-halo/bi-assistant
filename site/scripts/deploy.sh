#!/usr/bin/env bash
# Publish the site to Cloudflare Pages.
#
# `public/` is plain static files — no build step. `functions/` is picked up by
# wrangler relative to its working directory, which is why this cd's to the
# site root instead of passing an absolute path.
#
# Env:
#   CLOUDFLARE_API_TOKEN   token with "Cloudflare Pages — Edit"   (or run `wrangler login`)
#   CLOUDFLARE_ACCOUNT_ID  account id (see `npx wrangler whoami`)
#   CF_PAGES_PROJECT       default: halo-bi-assistant
set -euo pipefail
PROJECT="${CF_PAGES_PROJECT:-halo-bi-assistant}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "▸ Deploying $ROOT (public/ + functions/) to Pages project '$PROJECT'…"
npx --yes wrangler@4 pages deploy public \
  --project-name "$PROJECT" \
  --branch main \
  --commit-dirty=true

echo "✔ Deployed. Preview: https://$PROJECT.pages.dev"
echo "  The download routes need the GITHUB_TOKEN secret:"
echo "    npx wrangler@4 pages secret put GITHUB_TOKEN --project-name $PROJECT"

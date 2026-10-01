# Halo BI Assistant — public page

The product page for this app, styled to match
[halo-powered-labs.pages.dev](https://halo-powered-labs.pages.dev/) (same tokens, same
components) so it reads as a section of the Labs site rather than a separate one.

Plain static HTML/CSS in `public/` — no build step, no framework.

```
public/
  index.html          the page
  styles.css          Labs design tokens + the Labs component CSS + page-specific additions
  halo-logo.svg       the Halo wordmark, lifted from the Labs site
  app-icon.png        the app's own icon (copied from frontend/build/icon.png)
  favicon.png, apple-touch-icon.png
functions/          Pages Functions — the download routes (see Downloads below)
lib/                shared Function code
scripts/
  dev.sh              serve locally on :4500 via `wrangler pages dev`
  deploy.sh           publish to Cloudflare Pages
  domain.sh           attach bi-assistant.halo-powered-labs.com to the Pages project
  protect.sh          optional: lock it behind Cloudflare Access
```

## About the "subdomain"

`*.pages.dev` hostnames are one per Pages **project** — you cannot nest a path-free
subdomain under `halo-powered-labs.pages.dev`. So this page is its own Pages project
(`halo-bi-assistant` → `halo-bi-assistant.pages.dev`) and gets the real subdomain from the
`halo-powered-labs.com` zone that already hosts the other Labs prototypes:

**`bi-assistant.halo-powered-labs.com`**

That matches the existing pattern (`mercerfiber.halo-powered-labs.com`). The header and
footer link back to the Labs home so the two sites are connected both ways.

## Deploy

```bash
export CLOUDFLARE_API_TOKEN=...      # "Cloudflare Pages — Edit" (+ "DNS — Edit" on the zone)
export CLOUDFLARE_ACCOUNT_ID=...     # npx wrangler whoami

./scripts/deploy.sh                  # creates the project on first run
./scripts/domain.sh                  # attaches bi-assistant.halo-powered-labs.com
```

Override the project or hostname with `CF_PAGES_PROJECT` / `CUSTOM_DOMAIN`.

## Downloads

The download button links to this site's own route — `/download/win-x64` — not
to a versioned GitHub URL. **A new release needs no edit here**: the route
resolves the newest published installer and redirects to it.

The macOS cards are currently static "Coming soon" placeholders: they carry no
`data-target`, so the page script leaves them alone. The `/download/mac-arm64`
and `/download/mac-x64` routes still work — to put the buttons back, restore
`data-target` and the `<a class="btn btn-grad" href="/download/…">` on those two
cards in `public/index.html`.

```
functions/download/[target].js   resolve a platform → 302 to the installer
functions/api/latest.js          JSON the page uses for version + file sizes
lib/github-release.js            shared resolution logic (outside functions/, so it isn't routed)
```

### How it gets at a private repo's assets

`bi-assistant` is private, so `releases/download/…` returns 404 to the
public. The GitHub API will still hand out a credential-free link: request an
asset with `Accept: application/octet-stream` and it answers `302` with a
short-lived `release-assets.githubusercontent.com` URL that needs no auth. The
Function reads that `Location` and redirects the browser to it — the token never
leaves the edge, and the installer streams from GitHub's CDN rather than through
a Worker.

Per platform it picks the newest release that actually carries that installer,
so a Windows-only build (as v0.10.1 was) leaves the macOS buttons pointing at
the last release that had them, instead of breaking. When a platform lags the
headline release, its card names its own version.

### The token

One secret, `GITHUB_TOKEN` — a fine-grained PAT with **Contents: Read-only**,
scoped to `bi-assistant` alone:

```bash
npx wrangler@4 pages secret put GITHUB_TOKEN --project-name halo-bi-assistant
```

Without it both routes answer `503` and the page keeps its static copy, so the
page never looks broken — the buttons just say *Unavailable*.

Fine-grained PATs expire (a year at most). When it lapses, downloads stop until
the secret is replaced; nothing else on the page is affected.

### Local development

```bash
GITHUB_TOKEN=ghp_... ./scripts/dev.sh     # wrangler pages dev on :4500, Functions included
```

Omit the token to exercise the unconfigured path.

## Screenshots

`public/shots/` holds the images the page walks through. They are the real app
running against the **World Cup demo fixture that ships with it** — never a
customer's data, and never a mockup. The hero caption says as much on the page.

Re-shoot them whenever the interface moves:

```bash
# 1. a demo database (docker compose at the repo root) and a backend pointed at
#    a scratch data directory, so nothing touches your own app data
docker compose up -d postgres
(cd backend && npm run build)
APP_DATA_DIR="$PWD/.context/demo-data" node backend/dist/main.js &

# 2. load the fixture: creates the connection and a dataset of 9 entities
curl -sX POST localhost:3000/testing-data/world-cup/load -H 'content-type: application/json' \
  -d '{"host":"127.0.0.1","port":55432,"database":"world_cup","user":"world_cup","password":"world_cup_dev","ssl":false}'
curl -sX POST localhost:3000/sessions -H 'content-type: application/json' \
  -d '{"name":"Finishing quality at the World Cup","datasets":["World Cup"]}'

# 3. write the demo transcript, its two visual versions and the sibling sessions
node site/scripts/screenshots/seed-demo.cjs

# 4. drive the running app and capture (`npm start` in frontend/ first)
node site/scripts/screenshots/capture.mjs            # every shot
node site/scripts/screenshots/capture.mjs hero sql   # or just these

# 5. downscale into the page — the hero at 2360px, the rest at 1800px
sips --resampleWidth 2360 .context/shots/01-hero.png --out site/public/shots/app.png
```

`seed-demo.cjs` writes the session document straight into the scratch
`app.sqlite` and the visual versions through the app's own spec renderer
(`backend/dist/modules/sessions/…`), so the panel renders them exactly as it
renders a generated one. **The SQL and every row in it were run against the
demo database** — only the assistant's prose is authored, because seeding needs
no model provider key. If you re-word an answer, re-run the query too.

`export.png` is the odd one out: it is not a screen but the artefact the app
produces. Serve any stored version directory over http and shoot it whole —
`file://` will not do, because the exported document's CSP is `script-src 'self'`
and the chart runtime ships as a sibling file:

```bash
(cd .context/demo-data/workspaces/session-*/visuals/*/v2 && python3 -m http.server 4610) &
# then screenshot http://localhost:4610/index.html with fullPage: true
```

`capture.mjs` takes an optional list of shot names (`hero`, `clarify`,
`provenance`, `sql`, `visual`, `versions`, `knowledge`, `datasets`, `settings`,
`llm`, `agents`); with none it captures all of them. Output goes to
`.context/shots/` unless `SHOTS_OUT` says otherwise.

## Filename note

Installers are named `Questions-to-Insights-<version>-<os>-<arch>.<ext>` while
the product is branded *Halo BI Assistant*. Change `build.artifactName` in
`frontend/package.json` if the downloaded file should carry the product name.

# Halo Workbench — public page

The product page for this app, styled to match
[halo-powered-labs.pages.dev](https://halo-powered-labs.pages.dev/) (same tokens, same
components) so it reads as a section of the Labs site rather than a separate one.

Plain static HTML/CSS in `public/` — no build step, no framework.

```
public/
  index.html          the page
  styles.css          Labs design tokens + the Labs component CSS + page-specific additions
  halo-logo.svg       the Halo wordmark, lifted from the Labs site
  app-icon.png        the Halo Workbench icon (from frontend/brands/halo/public/brand/icon.png)
  agentic-hub-icon.png  the Agentic Hub icon (from frontend/brands/mercer/public/brand/icon.png)
  favicon.png, apple-touch-icon.png
  shots/              the screenshots (see Screenshots below)
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

The page offers two downloads, both Windows x64 (only the Windows installer is
built since BA-302), one per edition (ADR-0045):

| Button | Route | Installer |
|---|---|---|
| Halo Workbench | `/download/win-x64` | `Halo-Workbench-*-win-x64.exe` (or an older `Questions-to-Insights-*-win-x64.exe`) |
| Agentic Hub | `/download/agentic-hub-win-x64` | `Agentic-Hub-*-win-x64.exe` |

The buttons link to this site's own routes, not to a versioned GitHub URL.
`/download/mac-arm64` and `/download/mac-x64` still exist, unlinked, so old
links keep resolving to the last macOS installers (v0.13.1). **A new release
needs no edit here**: each route resolves the newest release that carries its
edition's installer and redirects to it. The desktop workflow builds both
editions onto the same release by default (`brand: both`).

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
so a Windows-only release leaves the macOS routes pointing at the last release
that had them (v0.13.1), instead of breaking. When a platform lags the
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

Re-shoot them whenever the interface moves. Everything below runs on a scratch
data directory, so nothing touches your own app data:

```bash
# 1. the demo Postgres (docker compose at the repo root, port 55432) and a web
#    build of the app on a free port with a scratch data directory
docker compose up -d postgres
npm --prefix backend run build:all
node backend/dist/cli.js --port 3210 --data-dir "$PWD/.context/shots-data" --no-open &

# 2. the local LLM and every Testing Data fixture, including the "World Cup" dataset
node scripts/setup-local.mjs http://127.0.0.1:3210

# 3. two real runs for the shots to show (each takes under a minute)
curl -sX POST http://127.0.0.1:3210/workflows/answer-business-question/runs \
  -H 'content-type: application/json' \
  -d '{"input":{"question":"Which teams finished their chances best across the 2018 and 2022 World Cups? Compare goals scored with expected goals.","datasets":["World Cup"]}}'
curl -sX POST http://127.0.0.1:3210/workflows/data-readiness-assessment/runs \
  -H 'content-type: application/json' -d '{"input":{"dataset":"World Cup"}}'

# 4. drive the running app and capture (2x, into .context/shots/)
APP_URL=http://127.0.0.1:3210/ node site/scripts/screenshots/capture.mjs
APP_URL=http://127.0.0.1:3210/ node site/scripts/screenshots/capture.mjs hero inspector   # or just these

# 5. downscale into the page — the hero at 2360px, the rest at 1800px
sips -s format png --resampleWidth 2360 .context/shots/hero.png --out site/public/shots/app.png
for n in inspector evidence workflows agents readiness; do
  sips --resampleWidth 1800 .context/shots/$n.png --out site/public/shots/$n.png
done
```

`capture.mjs` takes an optional list of shot names (`hero`, `inspector`,
`evidence`, `workflows`, `agents`, `readiness`); with none it captures all of
them. It opens the two runs from **Runs** by their titles, so keep the
question above (or change `QUESTION_START` in the script). The answers are the
model's own, so the copy that quotes them (the hero and readiness captions) may
need a touch after a re-shoot.

## Filename note

Since the rename (ADR-0046) the desktop app is *Halo Workbench* and its
installers are named `Halo-Workbench-<version>-<os>-<arch>.<ext>` (earlier
releases: `Questions-to-Insights-…`); the Agentic Hub edition's are
`Agentic-Hub-<version>-<os>-<arch>.<ext>`. The resolver matches a prefix per
edition plus the platform suffix (`lib/github-release.js`), so the old Halo
names still resolve and the two editions never pick each other's file.

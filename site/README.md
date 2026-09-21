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
scripts/
  dev.sh              serve locally on :4500
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

## Adding the download links

The three download buttons are deliberately inert until the installer URLs exist. In
`public/index.html`, find the `DOWNLOAD LINKS` comment and, for each card:

1. replace `href="#"` with the installer URL, and
2. delete `aria-disabled="true"` on that same `<a>`.

Installer filenames follow `Questions-to-Insights-<version>-<os>-<arch>.<dmg|exe>`, produced
by the **Build desktop installers** workflow (`.github/workflows/build-desktop.yml`). If that
run is published to a GitHub release, the URLs look like:

```
https://github.com/jhon-buendia-halo/questions-to-insights/releases/download/v0.10.1/Questions-to-Insights-0.10.1-mac-arm64.dmg
```

Those release assets are private while the repo is private — for an external audience, upload
the installers somewhere publicly readable (or an R2 bucket) and point the buttons there.

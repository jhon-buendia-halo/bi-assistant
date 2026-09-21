---
name: deploy-labs-site
description: Publish or update a Halo Powered Labs product page on Cloudflare Pages — the static page styled from the Labs design system, its `<name>.halo-powered-labs.com` subdomain, and download buttons that resolve installers from this private repo's GitHub releases. Use when asked to add a Labs subdomain, ship or redeploy the BI Assistant landing page, wire release downloads to a page, or when a download button or that subdomain is broken.
user-invocable: true
disable-model-invocation: false
---

# Deploying a Halo Powered Labs site

The live example of everything below is `site/` in this repo → **https://bi-assistant.halo-powered-labs.com**
(Pages project `halo-bi-assistant`). Read `site/README.md` first; this skill is the
procedure and the traps, not a duplicate of that file.

## Fixed values

| Thing | Value |
|---|---|
| Cloudflare account id | `09dc11f152a020c4b384099a22408120` |
| Zone | `halo-powered-labs.com` — id `a2335bade80faa00e866a56e23359fc4` |
| Labs home | `https://halo-powered-labs.pages.dev` (source not in any repo we have — the GitHub `halo-powered-labs` repo is empty) |
| Existing sibling | `mercerfiber.halo-powered-labs.com` — same pattern, scripts mirrored from `~/Documents/projects/halo/mercer-client-portfolio-view/prototypes/v3/app/scripts/` |

## One hostname per project

`*.pages.dev` gives exactly one hostname per Pages **project**; nothing can nest under
`halo-powered-labs.pages.dev`. So each Labs page is its own project plus a real subdomain
off the `halo-powered-labs.com` zone. Don't promise a `pages.dev` subpath — it isn't a thing.

## Matching the Labs look

Don't invent a palette. Lift the real one from the deployed Labs bundle:

```bash
curl -s https://halo-powered-labs.pages.dev/ -o /tmp/hpl.html
grep -oE 'main-[A-Z0-9]+\.js' /tmp/hpl.html      # bundle name changes per deploy
curl -s https://halo-powered-labs.pages.dev/main-XXXX.js -o /tmp/hpl.js
```

The `:root` tokens are inline in the HTML `<style>`. The component CSS and all the copy live
in the JS bundle: find `styles:[` inside the app component's `ɵcmp` definition, concatenate
the string array, and replace `[_nghost-%COMP%]`/`[_ngcontent-%COMP%]`. The Halo wordmark is
four `<path d="M …">` consts in the `halo-logo` component.

Reuse the class names verbatim (`.wrap`, `.section`, `.section-head`, `.eyebrow`,
`.grad-text`, `.btn`/`.btn-grad`/`.btn-ghost`, `.focus-grid`, `.halo-glow`) so the two pages
read as one site, and link back to the Labs home in the header and footer.

Two fixes that page needed and yours will too:
- A standalone SVG loaded via `<img src>` needs `xmlns` **and** literal fill colours —
  `currentColor` resolves to black because nothing is inherited into an `<img>`.
- The Labs CSS hides `.nav` and `.header-cta` under 720px. A download page wants its CTA on
  phones: `@media(max-width:720px){.header-cta{display:inline-flex}}`.

## Authenticating wrangler

**Run `npx wrangler@4 login` in the user's own terminal.** Do not try to drive the OAuth flow
from an agent session — it cannot work, for two compounding reasons:

- The callback server binds **`[::1]:8976` only**. `localhost` resolves to `127.0.0.1` first on
  macOS, so the browser gets connection-refused and the code never arrives.
- wrangler waits roughly **2 minutes** for the callback. A chat round-trip (post link → user
  reads → clicks → approves) loses that race essentially every time.

An IPv4→IPv6 bridge on 127.0.0.1:8976 does fix the first half, but the timeout still wins.
Also: **never `curl` the callback URL to test it** — it is single-shot, and a request without a
`code` makes wrangler exit with *"did not return an authorisation code"*. Each link is bound to
one process's PKCE challenge, so an old tab yields `ErrorInvalidReturnedStateParam`.

Expired credentials cannot be revived: the stored refresh token comes back `invalid_grant`.

Once logged in, the token is at `~/Library/Preferences/.wrangler/config/default.toml` and is
usable directly — read `oauth_token` from it when an API call needs a bearer (never print it).

## Deploy

```bash
cd site
CLOUDFLARE_ACCOUNT_ID=09dc11f152a020c4b384099a22408120 ./scripts/deploy.sh
```

First run only, to create the project:

```bash
npx wrangler@4 pages project create <name> --production-branch main --force
```

`--force` is **required**. Without it wrangler delegates to the new Workers-based Pages and
fails with *"Could not detect a directory containing static files"*. Its own warning says not
to retry unchanged — it means it. After the project exists, never pass `--force` again.

`deploy.sh` `cd`s to the site root and deploys `public` as a **relative** path. wrangler
discovers `functions/` relative to its working directory and has no `--functions` flag, so
running it from elsewhere risks shipping the static files without the Functions bundle. A
successful deploy prints `✨ Uploading Functions bundle` — if that line is absent, the
download routes did not ship.

## Attaching the subdomain

```bash
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... ./scripts/domain.sh
```

Then **the CNAME must be created by hand** — `bi-assistant` → `<project>.pages.dev`, proxied
(orange cloud). A `wrangler login` token has `zone:read` and `ssl_certs:write` but **no
`dns_records` scope**, so both reading and writing DNS return
`{"code":10000,"message":"Authentication error"}` and Cloudflare never auto-creates the record.
Either walk the user through the dashboard or ask for a token with **Zone › DNS › Edit**.

Expect `522` for the first minute or two after the record appears — that is the validation
window, not a fault. The Pages API may keep reporting `status: pending` long after the host
serves fine over a valid cert; ignore it if HTTPS works.

## Wiring downloads from a private repo

`questions-to-insights` is private, so `releases/download/…` and `releases/latest` both answer
`404` to the public — a versioned GitHub URL on the page cannot work.

The mechanism that does work: ask the API for an asset with `Accept: application/octet-stream`
and **do not follow the redirect**. It answers `302` with a `release-assets.githubusercontent.com`
URL that needs **no credential**. Hand that to the browser.

```
functions/download/[target].js   resolve a platform → 302 to the signed URL
functions/api/latest.js          JSON for the version line and file sizes
lib/github-release.js            shared logic — lives OUTSIDE functions/ so it isn't routed
```

Rules that matter:
- Redirect; never proxy. Streaming a 250 MB installer through a Worker is pointless when the
  client can fetch it from GitHub's CDN.
- `Cache-Control: no-store` on the redirect — the signed URL is short-lived.
- Cache the *release list* (~5 min, Cache API) so page loads don't burn API quota.
- Resolve **per platform** to the newest release that actually carries that installer. Builds
  are per-checkbox, so a Windows-only run happens (v0.10.1) and must not break macOS buttons.
- Check `env.GITHUB_TOKEN` at the top of each handler and return `503`. A cached release list
  will otherwise carry an unconfigured deployment far enough to fail with a misleading `502`.
- Send a `User-Agent` — GitHub rejects API requests without one.
- When the page's `fetch('/api/latest')` returns `503`/`error`, mark the cards unavailable.
  Leaving live-looking buttons that hand back a 503 text page is worse than a disabled button.

### The token

Fine-grained PAT, **Contents: Read-only**, **Only select repositories** → this repo alone.
Nothing else. Then:

```bash
npx wrangler@4 pages secret put GITHUB_TOKEN --project-name <name>   # reads stdin
./scripts/deploy.sh                                                   # redeploy to pick it up
```

Ask the user to run the `secret put` themselves so the value never lands in a transcript. If
they paste a token in chat, set it, then tell them plainly it is now in conversation history
and should be rotated. Fine-grained PATs expire (1 year max) — when it lapses the buttons go
back to "Unavailable" and nothing else on the page changes.

## Verify before reporting success

A `200` on the homepage proves nothing about downloads. Check all of it:

```bash
B=https://bi-assistant.halo-powered-labs.com
curl -s $B/api/latest | python3 -m json.tool
for t in mac-arm64 mac-x64 win-x64; do curl -so /dev/null -D - $B/download/$t | grep -i '^HTTP\|^x-installer-name'; done
curl -sL -r 0-2097151 -o /tmp/c.bin -w '%{http_code} %{size_download} %{content_type}\n' $B/download/mac-arm64
curl -s $B/download/bogus -o /dev/null -w '%{http_code}\n'   # expect 404
```

A real `.dmg` starts `78da`/`7801`/`789c` (zlib UDIF) — that distinguishes an installer from an
HTML error page of the same status. Then load the page in a browser and assert the version line
and card text, watching for console errors and failed requests.

## Local development

```bash
GITHUB_TOKEN=github_pat_... ./scripts/dev.sh      # wrangler pages dev on :4500, Functions included
./scripts/dev.sh                                   # no token → exercises the 503 path
```

Note that `caches.default` persists between local runs, so a cached release list can make a
tokenless instance look configured. That is exactly why the handlers check the token up front.

## Access control

`./scripts/protect.sh` puts the host behind Cloudflare Access (email-domain allowlist, default
`halopowered.com`). Leave it unrun for a public download page. Needs Zero Trust enabled on the
account, and a token with *Access: Apps and Policies — Edit*.

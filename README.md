# Questions to Insights

Ask questions of your data in plain language and get answers, SQL, and interactive visuals back. It ships as a desktop app (Halo BI Assistant) and as an npm package that runs the same app in your browser.

## Run it with npx

Requirements: Node.js >= 22.13.0 and npm.

The package is published to GitHub Packages, and the repo is private. Create a GitHub personal access token (classic) with the `read:packages` scope, and authorize it for SSO if your organization requires it. Then add this to `~/.npmrc`:

```
@jhon-buendia-halo:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<GITHUB_TOKEN with read:packages>
```

Run it:

```bash
npx @jhon-buendia-halo/questions-to-insights
```

Or install it globally:

```bash
npm i -g @jhon-buendia-halo/questions-to-insights
questions-to-insights
```

The command prints the URL and the data directory, and opens your browser. Press Ctrl+C to stop.

| Flag | Default | Description |
| --- | --- | --- |
| `--port <n>` | `3000` | Port to listen on. If the default is busy it falls back to a free port. An explicit busy port exits with code 1. |
| `--host <h>` | `127.0.0.1` | Interface to bind. |
| `--data-dir <path>` | `$QTI_DATA_DIR`, then `$APP_DATA_DIR`, then `~/.questions-to-insights` | Where app data is stored. |
| `--no-open` | | Do not open the browser. |
| `-h`, `--help` | | Show help. |
| `-v`, `--version` | | Show the version. |

The native modules (`better-sqlite3`, DuckDB, libsql) ship prebuilt binaries for supported Node versions. If npm starts compiling them, your Node version is unsupported or a build toolchain is missing.

## Where data lives

The data directory holds:

- `app.sqlite`: settings and datasources (credentials are encrypted).
- `mastra.sqlite`: agent memory.
- `observability.duckdb`: agent observability data.
- `workspaces/`: one workspace per session.
- `.app-secret`: the key that encrypts stored API keys.

Back up `.app-secret` together with the rest of the directory. If you lose it, stored keys become unreadable.

Web mode deliberately uses a different data directory from the desktop app, so both can run at the same time without SQLite lock conflicts.

## First run

1. Open Settings in the UI and configure the LLM provider: an OpenAI key or a LenAI-compatible endpoint.
2. Add a datasource (PostgreSQL or Databricks).

If no LLM settings are saved, the backend falls back to `openai/gpt-4o-mini` using the `OPENAI_API_KEY` environment variable.

## Desktop app

The Electron desktop app (Halo BI Assistant) is built for macOS (arm64, x64) and Windows (x64). Installers are produced by the "Build desktop installers" GitHub Actions workflow (`.github/workflows/build-desktop.yml`) and attached to GitHub releases. See `CLAUDE.md` for the packaging details.

## Development

The repo has two projects: `frontend/` (Angular app and Electron main process) and `backend/` (NestJS API).

Setup:

```bash
(cd backend && npm ci)
(cd frontend && npm ci)
```

Run:

```bash
# Backend only: API on :3000, data in backend/data
cd backend && npm run start:dev

# Frontend: ng serve on :4200
cd frontend && npm start

# Desktop shell pointed at ng serve (run npm start first)
cd frontend && npm run electron:dev

# Full web mode locally (builds the UI into the backend, then runs the CLI)
cd backend && npm run build:all && npm run start:web
```

Test:

```bash
cd backend && npm test        # jest
cd frontend && npm test       # karma
cd frontend && npm run test:e2e   # Playwright driving the real Electron app
```

The e2e suite needs the seeded World Cup Postgres. The suite starts it through Docker (`docker compose up -d postgres` at the repo root). Set `E2E_SKIP_DOCKER=1` only when an equivalent database is already running; the specs that need it still run.

## Releasing

Versioning is automatic and building is manual.

- **Version bump**: on every push to the default branch, `.github/workflows/version-on-merge.yml` derives the bump from Conventional Commit subjects since the last `v*` tag (`BREAKING CHANGE` or `type!:` is major, `feat:` is minor, anything else is patch). It commits `chore(release): vX.Y.Z` and pushes the tag. It builds nothing.
- **Desktop installers**: run Actions, then "Build desktop installers", then Run workflow. Pick the platforms, set `ref` (usually the new `vX.Y.Z` tag), and choose whether to `publish` to the release.
- **npm package**: run Actions, then "Publish npm package" (`.github/workflows/publish-npm.yml`). Inputs are `ref` (usually the `vX.Y.Z` tag) and `dry_run`.

## Architecture

An Angular renderer (inside Electron, or served by the backend in web mode) talks to a NestJS API. The API uses a Mastra agent harness for the assistant and visual designer agents, and a SQLite document store for application data. The npm package is the backend with the built Angular app bundled in. Details on modules, versioning, the datastore, and the agent harness are in [`CLAUDE.md`](CLAUDE.md).

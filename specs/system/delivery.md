# Delivery

How the app is built, run, packaged, distributed and released. The stack and code layout are in [tech-stack.md](tech-stack.md); the reasons for the delivery shape are ADR-0001 and ADR-0002 in [architecture.md](architecture.md). The CLI flags and the desktop IPC bridge are contracts, specified in [api.md](api.md); this file records how they are delivered.

The app ships three ways from one codebase: the **Halo BI Assistant** desktop installers (Electron), the **npm package** that runs the same app in a browser, and, separately, a static **product page** (`site/`).

## 1. Electron single-app delivery

The desktop app is one installable unit. The Electron main process (`frontend/electron/main.cjs`) starts the NestJS backend as a child process, waits until it answers, then opens the window.

| Concern | Behaviour |
|---|---|
| Backend process | `spawn(process.execPath, [backend/dist/main.js])` with `ELECTRON_RUN_AS_NODE=1`: Electron's own binary runs as plain Node, so packaged apps need no system Node. stdout/stderr are piped into the diagnostics log (see [capabilities/diagnostics/spec.md](../capabilities/diagnostics/spec.md)). Working directory is the folder containing `main.js`. |
| Backend entry | Packaged: `<resources>/backend/dist/main.js` (from `extraResources`). Unpackaged: `backend/dist/main.js` in the repo. A missing entry is logged as a diagnostics error and the backend is not started. |
| Environment given to the backend | `ELECTRON_RUN_AS_NODE=1`, `PORT` (from `BACKEND_PORT`, default `3000`), `APP_DATA_DIR`, `APP_SECRET`, `DESKTOP_PARENT_PID`, `BACKEND_INSTANCE_ID`, plus the parent environment. |
| Port | Backend listens on `PORT` (default 3000) on all interfaces, with CORS enabled (`main.ts` calls `createApp({ cors: true })`) because the renderer's origin under `file://` is `null`. |
| Readiness probe | `GET http://127.0.0.1:<BACKEND_PORT>/health` every 100 ms (500 ms request timeout) until it returns 200 carrying this spawn's `X-Backend-Instance` header, for up to 30 s. On timeout the window opens anyway, a diagnostics error is recorded, and the supervisor keeps polling. |
| Backend status to the UI | The main process pushes `backend-status` events (`starting`, `ready`, `restarting`, `down`) to every window and re-sends the current status after each page load. The renderer subscribes through the preload bridge (`window.desktop.onBackendStatus`) and shows a banner. |
| Supervisor | An unexpected backend exit restarts it with backoff 1 s, 2 s, 4 s (three attempts, status `restarting`); after that status is `down`. A backend that stays ready for 60 s resets the restart budget. |
| Quit | `before-quit` marks the app as quitting (so the exit handler does not restart), clears timers, kills the backend and removes `backend.pid`. On Windows and Linux closing the last window quits the app; on macOS it does not. |
| No leftover processes | Windows does not end a child when its parent dies, so a crashed or force-ended window could leave the backend holding the port. Three guards (roadmap 1.7.21; contract in [api.md](api.md) 4.3): the backend exits once the main process is gone (`DESKTOP_PARENT_PID`); startup stops a backend recorded in `backend.pid` that is still running as the app's executable; the readiness probe accepts only the backend it just spawned (`X-Backend-Instance`). A single-instance lock makes a second launch focus the running window instead of starting a second backend. |
| Window | 1440x900, minimum 960x600, `titleBarStyle: 'hiddenInset'`, `contextIsolation: true`, `nodeIntegration: false`, preload `electron/preload.cjs`. Loads `dist/frontend/browser/index.html`, or `ELECTRON_DEV_URL` when set. A `file://` `ERR_FILE_NOT_FOUND` load failure is retried by reloading the real entry file, at most 3 times. |
| Renderer to backend | `API_BASE_URL` is hardcoded to `http://localhost:3000` under `file://`. **Known gap (roadmap 1.7.20, BA-109):** the preload bridge does not expose the port, so a non-default `BACKEND_PORT` makes the readiness probe and the backend use the new port while the renderer still calls 3000, which breaks the app. |

### Why `--base-href ./`

Electron loads the renderer from `file://`. An absolute base (`/`) would resolve assets against the filesystem root and the app would not load, so every Electron build uses `ng build --base-href ./`. The web build (`build:web`) uses the Angular default base `/`, because the backend serves it from the site root.

### Data directory and secret

| Item | Behaviour |
|---|---|
| `APP_DATA_DIR` | Electron's `userData` directory. The profile name tracks the app name; if only the pre-rename directory (`Questions to Insights`) exists on an existing install, that one is kept. On **Windows**, backend data (`app.sqlite`, `mastra.sqlite`, `workspaces`) is moved once from the roaming profile to `%LOCALAPPDATA%\Halo BI Assistant`, with rollback and a diagnostics entry on failure, because roaming profiles are often synced or locked. |
| `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR` | Overrides `userData` entirely and disables the Windows redirect. Used by the Playwright fixture so tests never touch a real profile; also the way to run an isolated desktop instance from a worktree. |
| `APP_SECRET` | The backend derives the AES-256-GCM key that encrypts stored API keys from it. Taken from the `APP_SECRET` environment variable if set; otherwise read from `<APP_DATA_DIR>/.app-secret`, or generated (32 random bytes, hex) and written there with mode 0600. It must stay stable across launches. Back up `.app-secret` with the data; without it stored keys cannot be decrypted. The backend itself, run bare without `APP_SECRET`, reads or creates `.app-secret` in its own data dir the same way. |
| `.intellify-api-key` | The key of the embedded Intellify RFP API (ADR-0027). Taken from `INTELLIFY_API_KEY` if set; otherwise read from `<APP_DATA_DIR>/.intellify-api-key`, or generated (32 random bytes, hex) and written there with mode 0600, as `.app-secret` is. The Testing Data registration stores it on the "Intellify RFP API" datasource, so a lost file only means registering the sample again. |
| Other files in the profile | `logs/system.ndjson` (diagnostics, rotated to `system.previous.ndjson` above 5 MB; the last 2,000 entries are kept in memory). |

### Dev and branding helpers

- `frontend/scripts/brand-electron.sh` renames `node_modules/electron/dist/Electron.app` to `Halo BI Assistant.app`, rewrites its `CFBundleName` / `CFBundleDisplayName` and the launcher's `path.txt`, and refreshes LaunchServices, so the macOS menu bar and Dock show the product name in unpackaged runs. Idempotent; a no-op off macOS. Packaged builds get the name from electron-builder's `productName`.
- The app icon is `frontend/build/icon.png` (electron-builder derives `.icns` / `.ico`); a copy ships in the renderer bundle under `brand/`.

## 2. npm scripts

### `frontend/package.json`

| Script | Runs | Purpose |
|---|---|---|
| `ng` | `ng` | Angular CLI passthrough. |
| `start` | `ng serve` | Dev server on http://localhost:4200 (development configuration, base href `/`). |
| `build` | `ng build` | Production Angular build into `dist/frontend/browser` (base href `/`). |
| `build:web` | `ng build` | Same as `build`; named so the backend's `build:web` can call it. |
| `watch` | `ng build --watch --configuration development` | Rebuild on change. |
| `test` | `ng test` | Karma + Jasmine unit tests. |
| `test:e2e:prepare` | `tsc -p e2e/tsconfig.json && npm --prefix ../backend run build:all` | Type-check the e2e code, build the backend and the web UI into `backend/public/`. |
| `test:e2e:prepare:desktop` | `tsc -p e2e/tsconfig.json && npm --prefix ../backend run build && ng build --base-href ./` | Type-check the e2e code, build the backend, build the Angular app for Electron. |
| `test:e2e` | prepare + `playwright test --project=web` | The full Playwright suite against the web app (the default target). The app has one built-in user and no sign-in, so the fixture only starts the app ([tech-stack.md](tech-stack.md)). |
| `test:e2e:ui` | prepare + `playwright test --project=web --ui` | Same, in Playwright's UI mode. |
| `test:e2e:update` | prepare + `playwright test --project=web --update-snapshots` | Regenerate the web visual baselines; only for an intended visual change. |
| `test:e2e:desktop` | desktop prepare + `playwright test --project=desktop` | The same suite against the real Electron app. Run only when a desktop run is requested. |
| `test:e2e:desktop:update` | desktop prepare + `playwright test --project=desktop --update-snapshots` | Regenerate the desktop visual baselines. |
| `brand:electron` | `bash scripts/brand-electron.sh` | See above. |
| `electron` | `brand:electron`, backend build, `ng build --base-href ./`, `electron .` | Production-style run: builds everything, opens the app. |
| `electron:dev` | `brand:electron`, then `ELECTRON_DEV_URL=http://localhost:4200 electron .` | Window pointed at `ng serve` for live reload. Run `npm start` first; the backend spawns from `backend/dist`, so build it once. |
| `stage:backend` | `bash scripts/stage-backend.sh` | Build and stage the backend for packaging (section 3). |
| `electron:dist` | `stage:backend`, `ng build --base-href ./`, `electron-builder` | Full installer build into `frontend/release/`. Extra arguments select the target, for example `-- --mac dmg --arm64` or `-- --win nsis --x64`. |

### `backend/package.json`

| Script | Runs | Purpose |
|---|---|---|
| `build` | `nest build` | Compile to `dist/` (clears the folder first; copies `mastra/skills` and testing-data SQL fixtures). |
| `start` | `nest start` | Run the API once (port 3000, data in `<cwd>/data`). |
| `start:dev` | `nest start --watch` | Watch mode. |
| `start:debug` | `nest start --debug --watch` | Watch mode with the inspector. |
| `start:prod` | `node dist/main` | Run the compiled API (the Electron path). |
| `start:web` | `node dist/cli.js` | Run the npm CLI from the working tree (needs `build:all` first). |
| `format` | `prettier --write` on `src` and `test` | Format. |
| `lint` | `eslint … --fix` | Lint **and auto-fix**; run it on specific files, not project-wide, because it reformats unrelated files. |
| `test`, `test:watch`, `test:cov`, `test:debug` | Jest | Unit tests (`src/**/*.spec.ts`), watch, coverage, debugger. |
| `test:e2e` | `jest --config ./test/jest-e2e.json` | API-level e2e specs in `test/`; the live-data specs skip without the World Cup Postgres. |
| `eval` | `ts-node scripts/run-eval.ts` | Golden-set harness: asks each question in `eval/golden-set.json` in a throwaway session and compares the result set of the SQL the assistant ran with the case's trusted SQL. No HTTP port. |
| `check:answers` | `ts-node scripts/check-answers.ts` | Opt-in live answer-quality gate over the World Cup fixture; costs real model calls and needs `OPENAI_API_KEY`. Tunable by `CHECK_TRIALS`, `CHECK_ARM`, `CHECK_MODEL`, `CHECK_TIMEOUT_MS`. |
| `evals:assistant` | `nest build && node dist/mastra/evals/run-assistant-evals.js` | The assistant eval suite from the command line, same suite the Agents screen runs. Needs `EVAL_DATASETS` (comma-separated saved dataset names) and one of `EVAL_SET` (a question set id) or `EVAL_CASES` (comma-separated case ids); optional `EVAL_RESULTS_FILE` (a path: the run's full results, answers and tool calls included, written there as JSON). It prints every check of each question, passed or failed with its reason. Example: `EVAL_DATASETS="World Cup Core" EVAL_SET=world-cup npm run evals:assistant`. |
| `worldcup:api:dump` | `ts-node scripts/worldcup-rest-api/dump.ts` | Snapshot the World Cup Postgres into JSON files for the test REST API (`WORLD_CUP_DB_*` env). |
| `worldcup:api` | `ts-node scripts/worldcup-rest-api/serve.ts` | Zero-dependency REST + OpenAPI server over that snapshot on `127.0.0.1:55080` (`WORLD_CUP_API_PORT`), for exercising the REST connector. |
| `intellify-api` | `node dist/intellify-api/main.js` | Run the Intellify RFP API alone (ADR-0027; needs `build` first), configured only by environment: `INTELLIFY_API_KEY` (required), `INTELLIFY_API_HOST`, `INTELLIFY_API_PORT` (3100), `INTELLIFY_DB_*` ([api.md](api.md) 6.1). Not needed for local runs: the app starts the API embedded unless `INTELLIFY_API=off`. |
| `worldcup:rest:setup` | `ts-node scripts/setup-worldcup-rest.ts` | Registers that API as a `rest` datasource and a dataset in a running backend through its HTTP API (`BACKEND_URL`, `WORLD_CUP_API_URL`); idempotent. |
| `build:web` | `npm --prefix ../frontend run build:web && node scripts/copy-web.js` | Build the UI and copy it to `backend/public/` (gitignored). `copy-web.js` fails if the frontend build has no `index.html`. |
| `build:all` | `build` then `build:web` | Everything the npm package needs. |
| `prepack` | `build:all` | `npm pack` / `npm publish` always ship a fresh UI. |

### Repo scripts (`scripts/`, no root `package.json`)

The repo keeps no root `package.json`; its developer scripts are plain Node files run as `node scripts/<name>.mjs` (pure logic in `<name>-lib.mjs`, tests in `scripts/*.test.mjs`, run with `node --test scripts/*.test.mjs`).

| Command | Purpose |
|---|---|
| `node scripts/spec-index.mjs [--check]` | Writes `specs/INDEX.md` (section index with line ranges); `--check` exits 1 when it is stale. Roadmap 1.23.29, see 13. |
| `node scripts/story-pack.mjs <roadmap-id> [--out <file>]` | Writes `.context/story-packs/<id>.md`, the builder's starting brief. Roadmap 1.23.29, see 13. |
| `node scripts/qa.mjs …` | Deterministic QA, see 13. |
| `node scripts/demo-page.mjs <roadmap-id>` | Shareable demo page, see 13. |
| `node scripts/bootstrap.mjs` | Workspace bootstrap, see above. |

### Local run recipes

```bash
node scripts/bootstrap.mjs                           # install, Playwright browsers, build (below)

cd backend && npm run start:dev                      # API only, :3000, data in backend/data
cd frontend && npm start                             # ng serve :4200
cd frontend && npm run electron:dev                  # desktop shell on ng serve
cd frontend && npm run electron                      # production-style desktop run
cd backend && npm run build:all && npm run start:web # web mode from the working tree
node scripts/setup-local.mjs http://127.0.0.1:<port>  # configure the running instance (below)
```

**Preparing a fresh checkout or worktree (roadmap 0.5.5).** `node scripts/bootstrap.mjs [--force] [--no-build] [--no-playwright]` (Node 22+, no dependencies) runs `npm ci --legacy-peer-deps` in `backend/` and `frontend/` at once (the same flags as CI; a package whose `node_modules/.package-lock.json` is newer than its lockfile is skipped unless `--force`), then installs Playwright's Chromium and runs `npm --prefix backend run build:all` side by side, logging each step to `.qa-reports/bootstrap/<step>.log`. It ends by reporting whether Postgres answers on 55432 and whether Docker runs, and prints the command that starts it; it never starts the app or the compose stack. Every peer dependency the build needs is a direct dependency (the frontend lists `@floating-ui/dom`, the peer of `@tiptap/suggestion`), because `--legacy-peer-deps` skips peers. The repository's Conductor settings (`.conductor/settings.toml`) run it as the workspace setup script and add a **web** action that starts the CLI on the workspace's `CONDUCTOR_PORT` (Intellify API on the next port) with the data dir `.context/qti-data`.

**Configuring a local instance for hand testing (BA-325).** `scripts/setup-local.mjs [baseUrl]` (default `http://127.0.0.1:3000`, Node only, no dependencies) configures a running instance through its own API:

- **LLM:** saves `PUT /llm/settings` from `.env.llm.local`: `LLM_PROVIDER` (default `custom`), `LLM_API_STYLE` (default `anthropic`), `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. The file is read from the checkout, else from the main checkout (through `git rev-parse --git-common-dir`), so a worktree needs no copy; environment variables win over it. It is gitignored (`*.local`); [.env.llm.example](../../.env.llm.example) is the committed template. Without `LLM_BASE_URL` and `LLM_MODEL` this step is skipped.
- **Testing Data:** loads every seedable fixture with its defaults and registers the Intellify RFP API (`POST /testing-data/:id/load`, [api.md](api.md) 56); a fixture already loaded is skipped, so a re-run is safe. The Intellify sample is loaded into the database the embedded Intellify RFP API reads (`INTELLIFY_DB_NAME`, default `intellify_mercer_demo`) rather than the fixture's own default, so the API registers in the same run; the script then says to restart the app once, because the API applies its `rfp` migrations only at start. Tests: `node --test scripts/setup-local.test.mjs`.

It exits non-zero when any step fails. It writes to the sample Postgres the fixtures name (127.0.0.1:55432 by default), creating their databases if missing.

### Verification gate (what must be green before a change ships)

| Where | Commands |
|---|---|
| `frontend/` | `npm test`, `npm run build`, `npm run test:e2e` |
| `backend/` | `npm test`, `npm run build`, lint on the files you touched, and `npm run test:e2e` |

`node scripts/qa.mjs <roadmap-id> --gate` runs these for a story, with the story's step-6 Playwright list, and writes `evidence/<roadmap-id>/tests.md`; `--fast` runs the per-story subset for a plain session or an S change and records the demo (section 13).

`test:e2e` builds the backend with the web UI and drives the web app; its global setup starts the World Cup Postgres itself (see section 6). The desktop target (`test:e2e:desktop`) runs only when a desktop run is requested, and refuses to launch the app if port 3000 is taken. Which target to test, and how skipped desktop-only scenarios are reported, is the *Test target convention* in the [`workflow-gate`](../../.claude/skills/workflow-gate/SKILL.md) project skill (section 10).

## 3. Desktop packaging (electron-builder)

Configuration lives in the `build` block of `frontend/package.json`.

| Setting | Value |
|---|---|
| `appId` | `com.halopowered.questions-to-insights` |
| `productName` | `Halo BI Assistant` |
| `artifactName` | `Questions-to-Insights-${version}-${os}-${arch}.${ext}`, for example `Questions-to-Insights-0.20.3-mac-arm64.dmg`, `…-win-x64.exe` |
| Output | `frontend/release/` (gitignored) |
| Build resources / icon | `frontend/build/`, `build/icon.png` (also set for `mac` and `win`) |
| Packaged files | `dist/frontend/**`, `electron/**` except `electron/**/*.test.cjs` (the shell's `node --test` unit tests), `package.json` |
| macOS | category `public.app-category.productivity`; `.dmg` for arm64 and x64 |
| Windows | NSIS `.exe` for x64, electron-builder's default one-click per-user installer: it silently runs the previous version's uninstaller (keeping app data) before installing. `build/installer.nsh` (picked up automatically from build resources) defines `customCheckAppRunning`: electron-builder's usual check (asks to close a running app) runs first, then `taskkill /F /T` ends every `Halo BI Assistant.exe` the current user still runs, such as an orphaned backend, so no file in the install folder stays locked. The installer and the uninstaller both run it. |
| Signing | none: CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and produces unsigned artifacts |

**Backend staging** (`frontend/scripts/stage-backend.sh`): runs `npm run build` in `backend/`; recreates `backend/release-staging/` (gitignored); copies in `dist/`, `package.json` and `package-lock.json`; then runs `npm ci --omit=dev --ignore-scripts --legacy-peer-deps --no-audit --no-fund` there. Production dependencies only; install scripts are skipped, so the native modules come from their prebuilt binaries. Last, `frontend/scripts/prune-node-modules.mjs` deletes build-time leftovers from that `node_modules` (roadmap 1.7.22): type declarations (`*.d.ts`, `*.d.mts`, `*.d.cts`), TypeScript sources (`*.ts`, `*.mts`, `*.cts`), source maps (`*.js.map` and the like, never a bare `.map`), docs (`*.md`, `*.mdx`, `*.markdown`), lint and CI configs (`.eslintrc*`, `.nycrc*`, `.prettierrc*`, `.editorconfig`, `.travis.yml`, `.npmignore`, `.gitattributes`, `.jshintrc`, `.babelrc`) and `__tests__/` and `.github/` folders. Licence files (`LICENSE*`, `LICENCE*`, `NOTICE*`, `COPYING*`) are kept, and `@github/copilot-sdk*` is left whole because its bundled runtime reads its own `.md` and `.ts` files. Install time on Windows grows with the file count, and this halves it (0.48.1: 46,955 installed files before, 22,906 after).

**`extraResources`** copies the staged backend into the app's resources as `backend/`. It needs **two entries**:

```json
"extraResources": [
  { "from": "../backend/release-staging",              "to": "backend" },
  { "from": "../backend/release-staging/node_modules", "to": "backend/node_modules" }
]
```

The second, explicit `node_modules` mapping is required: electron-builder silently drops `node_modules` from a directory-level `extraResources` copy, and the packaged app would start without its dependencies.

`better-sqlite3` is loaded by the backend under Electron's runtime; if an ABI error ever appears after upgrading Electron or Node, rebuild it for Electron.

## 4. The web app as an npm package

| Item | Value |
|---|---|
| Package | `@jhon-buendia-halo/questions-to-insights` (`backend/package.json`; the backend is the package, the built Angular UI is bundled into it) |
| Registry | GitHub Packages, `https://npm.pkg.github.com` (`publishConfig.registry`). The scope must equal the repository owner (lowercase), which is why the name is scoped; the installed binary is still `questions-to-insights` (`bin` → `dist/cli.js`). |
| License | `UNLICENSED` (private repository, no LICENSE file) |
| Node | `engines.node >= 22.13.0` |
| Tarball contents | `files`: `dist`, `!dist/**/*.tsbuildinfo`, `public`. No `src/`, `test/`. |
| Run | `npx @jhon-buendia-halo/questions-to-insights`, or `npm i -g …` then `questions-to-insights` |

**Consumer auth.** GitHub Packages requires a token for every install, `npx` included. `~/.npmrc` needs:

```
@jhon-buendia-halo:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<PAT with read:packages>
```

**CLI** (`backend/src/cli.ts`):

| Flag | Default | Notes |
|---|---|---|
| `--port <n>` | 3000 | Falls back to a free port when the default is busy. An explicit busy port prints an error and exits 1. `0` lets the OS pick. Valid range 0 to 65535. |
| `--host <h>` | `127.0.0.1` | Interface to bind. The web CLI binds loopback by default, so only the machine itself reaches it. `--host 0.0.0.0` exposes it to the network with no sign-in (see *Security boundary* below). |
| `--data-dir <path>` | `$QTI_DATA_DIR`, else `$APP_DATA_DIR`, else `~/.questions-to-insights` | Deliberately separate from the Electron `userData` dir so desktop and web can run together without SQLite lock fights. |
| `--no-open` | | Do not open the browser. |
| `-h`, `--help` / `-v`, `--version` | | Print and exit. |

Startup order matters: the CLI creates the data directory, sets `APP_DATA_DIR`, resolves and sets `APP_SECRET` (read or create `<data-dir>/.app-secret`, mode 0600, same semantics as the Electron main process) and **only then** dynamically imports the app, because `database.module.ts` and `mastra/storage.ts` read `APP_DATA_DIR` at import time. It prints the URL and data dir (no mode line: there is one mode), opens the default browser (best effort: `open`, `cmd /c start`, `xdg-open`), and on SIGINT/SIGTERM closes the app (forced exit after 5 s). It warns when no web UI build is found. CORS is off in this mode (same origin); the Electron entry `main.ts` keeps it on.

**Bootstrap** (`backend/src/app-bootstrap.ts`, `createApp()`, shared by `main.ts` and the CLI): when `<webRoot>/index.html` exists, it serves the static files and installs a SPA fallback. `webRoot` is the `WEB_ROOT` env, else `backend/public/` (next to `dist/`). The fallback is a filter on Nest's not-found path, so API controllers always win: only an unmatched `GET`/`HEAD` with `Accept: text/html` and no file extension receives `index.html`; everything else keeps Nest's 404. With no `index.html`, the app serves the API only (the Electron-staged backend has no `public/`).

**Frontend in this mode:** `API_BASE_URL` is `''` (same-origin relative URLs such as `/sessions`) unless running from `file://`.

**Build and pack:** in `backend/`, `npm run build:web` (frontend build then `scripts/copy-web.js` into `public/`), `npm run build:all`, and `prepack` runs `build:all`. To test locally: `npm pack`, then `npm i <tarball>` in a scratch directory and run the bin.

**Data layout the CLI creates** under the data dir: `app.sqlite`, `mastra.sqlite`, `observability.duckdb`, `workspaces/`, `.app-secret`, `.intellify-api-key` (see [data-model.md](data-model.md) and section 1). The native modules (better-sqlite3, DuckDB, LibSQL) arrive as prebuilt binaries; if npm starts compiling them, the Node version is unsupported or a toolchain is missing.

**Security boundary.** The app has no sign-in: whoever reaches the port acts as the one built-in super admin and has full access, including the stored LLM key and the developer settings ([product/non-functional.md](../product/non-functional.md), ADR-0030). The web CLI therefore binds `127.0.0.1` by default. The desktop backend keeps listening on all interfaces (the Port row in section 1), by the user's choice, so anyone on the network who can reach its port has full access; `--host 0.0.0.0` on the CLI exposes it the same way. Put the app behind your own network controls when exposing it.

First run needs an LLM provider in Settings (or `OPENAI_API_KEY` in the environment, which makes the backend fall back to `openai/gpt-4o-mini` when no settings are saved).

## 5. Versioning and releases

`frontend/package.json` `version` is the single source of truth. `backend/package.json` is kept in lockstep, and both lockfiles are committed with each bump. electron-builder reads the frontend version, the installers carry it through `artifactName`, and the app shows it (`APP_VERSION`). **Versioning is automatic; building is manual.**

All release workflows run on Node 22 and live in `.github/workflows/`. The one pull-request check, `spec-checks.yml`, is described after them.

### `version-on-merge.yml` — Version on merge

| Aspect | Behaviour |
|---|---|
| Trigger | Push to `main` or `implement-empty-layout`, and manual dispatch. |
| Skipped when | The head commit message starts with `chore(release):` (its own bump commit). |
| Concurrency | Group `version-on-merge`, no cancellation, so quick back-to-back merges queue. |
| Bump level | From commits since the last `v*` tag: `BREAKING CHANGE` / `BREAKING-CHANGE` in any body, or a subject `type!:` → **major**; any subject `feat:` / `feat(scope):` → **minor**; otherwise **patch**. |
| Effects | `npm version <level> --no-git-tag-version` in `frontend/`, then the same version in `backend/`; commits both `package.json` and `package-lock.json` pairs as `chore(release): vX.Y.Z` as `github-actions[bot]`; creates annotated tag `vX.Y.Z`; pushes the branch over SSH with the `RELEASE_DEPLOY_KEY` deploy key and the tag with `GITHUB_TOKEN` (see *Release push* and *Chaining* below). Builds nothing. The run summary says which tag to build. |
| Release push | `main` requires a reviewed PR (see *Branch rulesets* below), and GitHub Actions can't be put on a bypass list in a personal-account repo. So checkout uses `ssh-key: secrets.RELEASE_DEPLOY_KEY`: a write deploy key titled "version-on-merge release push (BA-110)", on the review ruleset's bypass list. The staging-branch and `main` pushes go through it. The tag is pushed over HTTPS with `GITHUB_TOKEN`, because no ruleset covers tags. |
| Spec check | The default branch also requires the "Specs match the code" check (see *Branch rulesets* below), and that ruleset has no bypass, so the deploy key doesn't skip it. So before pushing, the job runs `scripts/check-specs.py` on the bump commit. It then pushes the commit to a temporary `release-staging/<sha>` branch so GitHub knows the commit, and reports a successful `Specs match the code` commit status on it. Only then does it push to `main`, push the tag, and delete the staging branch. If the check fails, nothing is pushed. |
| Permissions | `contents: write` (the tag push), `statuses: write` (the spec-check status). Branch pushes use the deploy key. |
| Chaining | Pushes made with the deploy key do trigger workflows. The bump commit starts `spec-checks.yml` on `main` and a `version-on-merge.yml` run that skips itself (see *Skipped when*). `build-desktop.yml` runs on any pushed `v*` tag, so the tag is pushed with `GITHUB_TOKEN`, whose pushes start no workflows. That keeps merge-time tagging from starting builds; a tag pushed by hand still builds. |

Conventional Commit subjects therefore drive the bump, Because the bump reads every commit since the last tag, an epic's single PR with mixed `feat`/`fix`/`docs` commits still bumps at the highest level it contains. The epic branch's type names that highest-impact type (see *Branching convention* in the [`workflow-start`](../../.claude/skills/workflow-start/SKILL.md) project skill).

### `build-desktop.yml` — Build desktop installers

Manual: Actions → Build desktop installers → Run workflow. A hand-pushed `v*` tag also triggers it. It builds and publishes **only the Windows x64 installer** (BA-302); macOS `.dmg` files can still be built locally with `electron:dist` (section 2) but CI no longer builds them.

| Input | Default | Meaning |
|---|---|---|
| `ref` | empty | Tag, branch or SHA to build; empty = the branch the run was started from |
| `publish` | false | Attach the Windows installer to the GitHub release for the resolved tag |

Jobs:

1. **`prepare`** checks out the ref with full history and tags, emits the build matrix (`{"include":[…]}`) with its one entry, Windows x64 (runner `windows-2022`, NSIS `.exe`), and resolves the tag:
   - a `v*` ref publishes to exactly that tag;
   - anything else (branch, SHA, empty) takes the version committed at that ref (`frontend/package.json`) and **walks the patch level up** until it finds a tag that either does not exist or already points at this commit, so building `main` twice gives `v0.13.0` then `v0.13.1` instead of clobbering a shipped release.
2. **`build`** (one runner per matrix entry, so one Windows runner; 45 min timeout, `fail-fast: false`): checks out the resolved SHA, **stamps the resolved version** into both `package.json`s (so the installer filename and the tag never disagree), `npm ci --legacy-peer-deps` in `backend/` and `frontend/`, then `npm run electron:dist -- --<target> <format> --<arch>`, and uploads the installer as an Actions artifact (retention 14 days). Artifacts are unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`).
3. **`publish`** runs when `publish` is true or the trigger was a `v*` tag: downloads all artifacts, creates the GitHub release empty if it does not exist (`gh release create --target <sha> --generate-notes`, which also creates the tag at the built commit, so no tag is pushed unless the build succeeded), then uploads each installer one at a time with up to 3 attempts and `--clobber` (installers run to hundreds of MB and the upload endpoint rejects them intermittently). Because of `--clobber`, rebuilding the same tag replaces its installer instead of failing.

Publishing therefore never needs an existing tag.

### `publish-npm.yml` — Publish npm package

Manual only: Actions → Publish npm package → Run workflow. There is no tag event to hook onto (see *Chaining* above), and a merge should not ship a package nobody asked for.

| Input | Default | Meaning |
|---|---|---|
| `ref` | empty | The `vX.Y.Z` tag from version-on-merge, or any branch/SHA; empty = dispatch branch |
| `dry_run` | false | `npm publish --dry-run`, nothing uploaded |

Steps: check out the ref; Node 22 with the GitHub Packages registry and scope; read `name@version` from `backend/package.json`; **refuse an already-published version** (`npm view`; success means it exists → fail with a readable message, `E404` means free, any other failure is fatal; skipped on dry runs, because GitHub Packages answers a re-publish with a bare 409); `npm ci --legacy-peer-deps` in `frontend/` and `backend/`; explicit `npm run build:all`; `npm publish --ignore-scripts` (so `prepack` does not rebuild and the tarball is exactly the logged build). Auth is `GITHUB_TOKEN` (`packages: write`); the `repository` field in `backend/package.json` links the package to this repo, so no personal token is needed. The run summary prints `name@version` and the `.npmrc` + `npx` install commands.

### `spec-checks.yml` — Spec checks

Runs on every pull request, on every push to `main`, and on manual dispatch. It is the only pull-request check. It checks out the repo and runs `python3 scripts/check-specs.py` (standard library only, no install step, about one second). It fails the run when `specs/` drifts from the code:

| Check | Fails when |
|---|---|
| Layout | a product or system spec is missing, or the capability or epic tables in `specs/README.md` don't match the folders on disk |
| Links | a relative link in `CLAUDE.md`, `README.md`, `roadmap.md`, any spec, any project skill (`.claude/skills/*/SKILL.md`) or any tool README (`.claude/tools/**/*.md`) doesn't resolve. `changelog.md` and `retrospective.md` are skipped, because their past entries are never rewritten. |
| Capability format | a capability spec lacks one of the required sections |
| E2E mirror | a `frontend/e2e/*.spec.ts` file is not the `E2E:` line of exactly one capability spec, or an `E2E:` line names a missing file |
| API | a backend controller route is not written as `` `METHOD /path` `` in `system/api.md` |
| Data model | a collection in `database.module.ts` is not in `system/data-model.md` |
| Agents | an agent registered in `mastra/index.ts` is not in `system/agents.md` |
| Epic gate | a roadmap milestone's epic has no spec, or an epic spec has no `Status` |

The checks prove coverage, not correctness. Reviewers still check that the spec text is right. Run the same check locally with `python3 scripts/check-specs.py`.

### Branch rulesets on `main`

Two repository rulesets apply to the default branch.

#### "main: specs match the code"

Repository ruleset **"main: specs match the code"**, enforcement *active*, target `~DEFAULT_BRANCH`. It has one rule: the required status check `Specs match the code`, from any source and without requiring the branch to be up to date. It has no bypass actors.

- **Pull requests** can merge only once `spec-checks.yml` has passed on their head commit.
- **Direct pushes to `main`** are rejected unless the pushed commit already carries a successful `Specs match the code` status. Only the release workflow does this (see *Spec check* in `version-on-merge.yml` above). Everyone else goes through a PR.

#### "main: PR approval, admin may merge without"

Repository ruleset **"main: PR approval, admin may merge without"**, enforcement *active*, target `~DEFAULT_BRANCH`. It has one rule, *pull request required*:

| Parameter | Value |
|---|---|
| Required approving reviews | 1 |
| Dismiss stale approvals when new commits are pushed | yes |
| Code-owner review, approval of the last push, resolved threads | not required |

Bypass list:

| Actor | Mode | Effect |
|---|---|---|
| Repository admin role | *pull requests only* | Can merge a PR without an approval (`gh pr merge --admin`, or the bypass checkbox in the merge box). Can't push straight to `main`. In this personal-account repo the owner is the only admin, so the owner is the only person who can merge without a review. Collaborators have write access. |
| Deploy keys | *always* | The release workflow's `RELEASE_DEPLOY_KEY` pushes the bump commit straight to `main` (see *Release push* above). |

- **Everyone else** needs one approving review before merging, and the spec check must still pass.
- Granting another person admin, or adding a deploy key with write access, also lets them skip the review. Keep the repo's admin list and its write deploy keys to the owner and the release key.

#### Both rulesets

- **Inspect or change the rules:** Settings → Rules → Rulesets, or `gh api repos/<owner>/<repo>/rulesets`.

## 6. Docker Compose: the World Cup sample database and the observability profile

`docker-compose.yml` at the repo root defines the sample PostgreSQL datasource used by the Playwright suite, the live-data backend specs, the testing-data feature and the product-page screenshots.

| Setting | Value |
|---|---|
| Compose project name | `questions-to-insights-world-cup` |
| Service / image | `postgres` / `postgres:16-alpine` |
| Database, user, password | `world_cup` / `world_cup` / `world_cup_dev` |
| Host port | `${WORLD_CUP_DB_PORT:-55432}` → container 5432 |
| Seed | `docker/postgres/init/001_world_cup.sql` mounted read-only at `/docker-entrypoint-initdb.d`; tables and analytics views live in schema `world_cup` (quarter-finals to final of the 2018 and 2022 tournaments; scores and outcomes mirror reality, detailed metrics such as xG are representative sample values) |
| Volume | `world_cup_postgres_data`; to re-run the init scripts: `docker compose down -v` then `docker compose up -d postgres` |
| Healthcheck | `pg_isready -U world_cup -d world_cup`, every 5 s, 10 retries, 10 s start period |

Start it with `docker compose up -d postgres` from the repo root. App datasource settings: host `localhost`, port `55432`, database `world_cup`, user `world_cup`, password `world_cup_dev`, SSL off. The Playwright global setup runs `docker compose up -d --wait postgres` itself, unless `E2E_SKIP_DOCKER=1`.

### Observability profile (opt-in)

Local developer tools for [ADR-0006](architecture.md) and the [BA-111 epic](../epics/BA-111/spec.md). Both services carry `profiles: [observability]`, so a plain `docker compose up` and the E2E global setup (which names `postgres` explicitly) never start them. They have no volumes: data is lost when the containers are removed.

| Service | Image | Host port (override) | Use |
|---|---|---|---|
| `phoenix` | `arizephoenix/phoenix:version-20.19.0` | `${PHOENIX_PORT:-6006}` → 6006 | Phoenix UI and OTLP HTTP at `/v1/traces`. It accepts OTLP **protobuf** only: `application/json` gets 415, `application/x-protobuf` gets 200. |
| `otel-lgtm` | `grafana/otel-lgtm:0.35.0` | `${GRAFANA_PORT:-3001}` → 3000 (Grafana UI; 3000 on the host is the backend), `${OTLP_GRPC_PORT:-4317}` → 4317, `${OTLP_HTTP_PORT:-4318}` → 4318 | Grafana, Tempo, Loki, Prometheus and the OTLP collector. Healthcheck: `curl -sf http://localhost:3000/api/health`. |

- **Start:** `docker compose --profile observability up -d --wait phoenix otel-lgtm` (omit the names to include `postgres`). Grafana is at `http://localhost:3001`, Phoenix at `http://localhost:6006`. The image has no healthcheck for `phoenix`, so `--wait` only waits for it to be running; poll `http://localhost:6006`.
- **Stop only the tools:** `docker compose --profile observability stop phoenix otel-lgtm`, then `rm -f phoenix otel-lgtm`. Do not use `docker compose down` on a shared stack: it also removes `postgres`.
- **Isolation:** use `-p <name>` and the four port variables, as in section 7.
- **Pinned tags:** Bump them deliberately; they were the latest releases on 2026-10-05.

## 7. Running a second instance (worktrees and parallel runs)

Defaults are shared state: the desktop app uses Electron's `userData` directory and port 3000; the npm CLI uses `~/.questions-to-insights` and port 3000; Compose uses project `questions-to-insights-world-cup` and port 55432. A second instance (for example from a git worktree) collides unless isolated.

| Resource | Default | Isolation knob |
|---|---|---|
| Desktop data dir | Electron `userData` | `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR=<dir>` |
| Desktop backend port | 3000 | `BACKEND_PORT` for the main process and backend, but the renderer is hardcoded to 3000 (known gap, roadmap 1.7.20, BA-109), so two desktop instances cannot run side by side yet |
| Web (CLI) data dir | `~/.questions-to-insights` | `--data-dir`, `QTI_DATA_DIR` or `APP_DATA_DIR` |
| Web (CLI) port | 3000 (falls back to a free port) | `--port` |
| Bare backend (`start:dev`) data dir and port | `<cwd>/data`, `PORT` or 3000 | `APP_DATA_DIR`, `PORT` |
| Secret | persisted `.app-secret` in the data dir | `APP_SECRET` |
| Intellify API port | 3100 (the embedded Intellify RFP API) | `--intellify-api-port <n>` (CLI) or `INTELLIFY_API_PORT`; `0` picks a free port, printed on the CLI banner (`Intellify API: http://127.0.0.1:<port>`); the E2E fixture sets `0`. `--no-intellify-api` or `INTELLIFY_API=off` skips it |
| Readiness row cap (tests only) | 100,000,000 rows: tables above it are not column-profiled (ADR-0033) | `READINESS_MAX_PROFILED_ROWS` (positive integer), read per assessment; the E2E sets it low to exercise the `too-large` path on the sample tables |
| Sample Postgres | project `questions-to-insights-world-cup`, port 55432 | `docker compose -p <name>` plus `WORLD_CUP_DB_PORT=<port>`; the e2e fixtures read the same variable (and `WORLD_CUP_DB_HOST`) |
| Observability profile | same project; ports 6006, 3001, 4317, 4318 | `docker compose -p <name>` plus `PHOENIX_PORT`, `GRAFANA_PORT`, `OTLP_GRPC_PORT`, `OTLP_HTTP_PORT` (see *Observability profile* above) |
| Playwright | needs port 3000 free | one e2e run at a time per machine; each test already gets its own temp profile |

The project rule: when work happens in a worktree, ask which target (shared or isolated) before starting the app or the Compose stack. See *Worktree deploy convention* in the [`workflow-implement`](../../.claude/skills/workflow-implement/SKILL.md) project skill.

## 8. The product page (`site/`)

A separate, static deliverable: the public page for the app, a section of the Halo Powered Labs site. Not part of the app or its releases.

| Item | Detail |
|---|---|
| Content | Plain static HTML/CSS in `site/public/` (no build step, no framework), styled with the Labs design tokens; screenshots in `public/shots/` |
| Hosting | Cloudflare Pages project `halo-bi-assistant` (`halo-bi-assistant.pages.dev`), custom domain `bi-assistant.halo-powered-labs.com` |
| Scripts | `scripts/dev.sh` (local on :4500 via `wrangler pages dev`), `deploy.sh` (publish; needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, optional `CF_PAGES_PROJECT`), `domain.sh` (attach the domain), `protect.sh` (optional Cloudflare Access lock) |
| Download routes | Pages Functions: `/download/mac-arm64`, `/download/mac-x64`, `/download/win-x64` redirect to the newest published installer for that platform. The page links only `/download/win-x64` (BA-304); the macOS routes stay, unlinked, for old links and serve v0.13.1, the last release with macOS installers; `/api/latest` returns JSON (version, file sizes) for the page. A new release needs no site edit. |
| Private-repo trick | The repo is private, so `releases/download/…` 404s publicly. The Function asks the GitHub API for the asset with `Accept: application/octet-stream`, takes the credential-free short-lived `Location`, and redirects the browser to it; the token never leaves the edge. Per platform it picks the newest release that carries that installer, so a Windows-only release leaves the macOS routes on the last release that had them. |
| Secret | `GITHUB_TOKEN` (fine-grained PAT, Contents: read-only, scoped to this repo; expires within a year) set with `wrangler pages secret put`. Without it both routes answer 503 and the page shows static copy with buttons marked unavailable. |
| Screenshots | Re-shot from the real app against the World Cup demo fixture with `site/scripts/screenshots/seed-demo.cjs` and `capture.mjs` (see `site/README.md` for the full procedure). |
| Skill | The project skill `deploy-labs-site` covers publishing or redeploying it. |

Installers are named `Questions-to-Insights-<version>-<os>-<arch>.<ext>` while the product is branded Halo BI Assistant; change `build.artifactName` if the downloaded file should carry the product name.

## 9. Claude Code mods (`.claude/mods/`)

Developer tooling for people who work on this repository in Claude Code, not part of the app or its releases. A *mod* is a Claude Code plugin whose hooks module runs inside Claude Code and draws in its interface (early access: Claude Code 2.1.287 or later; the hooks API may change between releases). Epic [BA-169](../epics/BA-169/spec.md).

| Item | Detail |
|---|---|
| Layout | One directory per mod under `.claude/mods/<name>/`: `.claude-plugin/plugin.json` (manifest: `name`, `version`, `description`, `author`, `types`), `hooks/hooks.json` (points at the hooks module), the hooks module (`hooks/register.tsx`), `types/index.d.ts` (the `$.state` values it keeps), `tests/*.test.ts`, a README naming the Claude Code version it was tested with. Claude Code writes `.claude-plugin/types/` (the API declarations of the running build) beside a loaded mod; it is git-ignored. |
| Marketplace | The repository root is a plugin marketplace: `.claude-plugin/marketplace.json` (`name` `bi-assistant`, `owner`, `plugins[]`) lists each mod with a `source` path relative to the root, as `./.claude/mods/workflow-steps`. The install id is `<mod name>@bi-assistant`. |
| Project settings | `.claude/settings.json` (committed) registers the marketplace under `extraKnownMarketplaces` as the GitHub repository `jhon-buendia-halo/bi-assistant` and lists each mod under `enabledPlugins`. Claude Code offers the install to a developer who trusts the folder; the marketplace is fetched from the default branch, so a new mod installs this way once its PR has merged. |
| Install by hand | `claude plugin marketplace add jhon-buendia-halo/bi-assistant` (or the repository path, for a branch), then `claude plugin install <mod name>@bi-assistant`; `/plugin` inside a session does the same. |
| Develop | `claude --plugin-dir .claude/mods/<name>` loads the directory for one session and hot-reloads it on every save, so edits show without an install. An installed copy is cached by version: bump `version` in the manifest and `/plugin update` for installed developers to get a change. |
| Verify | `claude plugin validate .claude/mods/<name>` (static analysis of the hooks module: every event it hooks and every API method it calls) and `claude plugin validate .` (the marketplace); `claude plugin test` in the mod runs its `*.test.ts` with the test kit, no session or network. |

### `workflow-steps`

Opens a **Workflow** pane (the right-hand sidebar in a wide fullscreen terminal or the desktop app, a framed region above the prompt otherwise) that shows the development workflow from [CLAUDE.md](../../CLAUDE.md) as a **task queue inferred from tool calls**. Nothing is asked of Claude and no prompt is changed: the mod watches every tool call, maps the file or command to a step, and moves the queue itself.

- **Steps.** At session start, and whenever `/workflow` runs, it reads `CLAUDE.md` in the working directory, takes the `## Workflow` section and parses the mandatory first action (the `MANDATORY FIRST ACTION — …` line) and the steps (`<n>. **<title>** — <description>`). When the file can't be read or has no `## Workflow` section, a built-in copy of the eleven steps is used and the pane says `CLAUDE.md not readable here: built-in copy.`
- **Inference rules**, matched top to bottom on each tool call; the first match names the step, and a call that matches nothing leaves the queue as it is:

  | Signal | Step |
  |---|---|
  | `Read` of `retrospective.md` | marks the first action done (header check); counts as step 1 before the first write |
  | any call that matches no other rule, before the first write of the session (reads, searches, shell commands, other tools) | 1 Understand the goal |
  | `AskUserQuestion` | 2 Ask clarifying questions |
  | a write (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`) or read of `roadmap.md` | 3 |
  | … of `specs/system/architecture.md` | 4 |
  | … under `specs/` | 5 |
  | … of `evidence/<id>/e2e-impact.md` | 6 |
  | … under `frontend/e2e/`, or under `backend/test/` ending in `.e2e-spec.ts` | 7 |
  | … under `frontend/src/`, `backend/src/` or `.claude/` | 8 |
  | `Bash` whose command contains `test:e2e`, `check-specs.py`, `jest`, `playwright test`, or `npm [--prefix <dir>] [run] test|build|lint` | 9, with the task marked `passed` or `failed` from the last such command's result |
  | any other `Bash` command naming a path one of the rules above owns | that path's step: strong when the command writes (a `>` or `>>` redirect, `tee`, `sed -i`, `cp`, `mv`, `rm`, `touch`, `mkdir`, a heredoc or a `python3 -` script), weak otherwise; a read naming `retrospective.md` is the first action |
  | … of `changelog.md` or under `evidence/` | 10 |
  | … of `retrospective.md` | 11 |

  A write, a question or a step-9 command is a *strong* signal; a read is a *weak* one. Paths are matched after any `…/.claude/worktrees/<name>/` prefix is removed, so a worktree checkout behaves like the main one; in a shell command the redirect target is matched first, then the other paths in order.
- **Queue.** Task `#1` (step 1) starts with the session. A call for a step other than the running task's opens a *tentative* task, drawn as `#n?` under the running one. It earns its number and becomes the running task after three matched calls or one strong signal; three unmatched calls, or a call for the running task's step, drop it. A later call for an earlier step makes a new task, so a step that runs twice appears twice with two numbers. Sequence numbers are never reused.
- **Rows.** Every row is `#n`, title, `step s`, the agent, duration, tokens, cost, a completion bar with its %, `▸` (`▾` while open) and the task's summary, dim. The agent is `main`, or `main +<k>` when the task spawned subagents; a queued step shows the agent it is expected to use, as `~main` (`~main+sub` for steps 7 and 8, where CLAUDE.md fans independent units out to subagents). A step-9 task's row marks its last test `✓ passed` or `✗ failed` after the %, or, when the row has no room for that, draws the % in green or red. Running: the same plus one indented line per subagent spawned during the task (`↳ <type> · <model> · "<description>"`, `● running` until the subagent's own run ends) while its detail is closed. Tentative: as running, with `#n?`. Queued: every step above the highest step started, in CLAUDE.md order, numbered from the next free sequence number (one later while a tentative task holds, which takes the step it is for out of the list), with no duration, tokens or cost. Steps below the highest started that never had a task are listed as `no signal yet`. When more than twelve tasks are done, the earlier ones fold into `… <k> earlier tasks · <tokens> · $<cost>`. The header shows the running task, the queued count, the session's tokens and cost, and `overall <p>%`: the mean completion of the done, running and queued rows (folded rows included; the tentative row and steps with no signal left out).
- **Summary.** Built from the task's own calls, in this order, joined with ` · `: the files it edited (`Edited roadmap.md ×2, ui.md`), the files shell commands named (`Shell scratch.md`), the test and build commands it ran (`Ran npm run test:e2e ×2`), its questions (`1 question`), its reads and searches (`7 reads`), other calls (`2 other calls`), a step-9 task's last result (`last run passed`) and its subagents (`2 subagents`). A task with none says `no calls counted for this step` (its step's calls may all have gone to other steps, as a shell read of `retrospective.md` does); a queued step shows `Expected: ` and its CLAUDE.md summary.
- **Completion.** Each step has a checklist; a task's completion is the share of its step's checks met, and a queued step's is 0%. A check is met by a fact the rules read off a call counted for the task (the *written text* is an `Edit` or `MultiEdit` `new_string`, a `Write` `content`, a `NotebookEdit` `new_source`, or the command of a shell call that writes), or, for those marked *live*, by the task's or the session's current state:

  | Step | Checks |
  |---|---|
  | 1 | retrospective.md read (*live*: the session's first action, the header's check) · files read before the first edit (*live*: any call other than a write before the session's first write). Both are the session's, whichever task their calls were counted for: a shell read of `retrospective.md` is a step-11 signal and a read of `roadmap.md` a step-3 one |
  | 2 | questions asked (`AskUserQuestion`) · answers received (`AskUserQuestion` returned without an error) |
  | 3 | roadmap.md edited · Intent, Scope and Acceptance written (the written text contains `Acceptance`) · status set (the written text contains `🚧` or `✅`) |
  | 4 | architecture.md edited · an ADR written (the written text contains `ADR-` and digits) |
  | 5 | a spec edited (a write under `specs/`) · a Gherkin scenario written (the written text contains `Scenario:`) |
  | 6 | e2e-impact.md written |
  | 7 | an E2E spec written (a write under `frontend/e2e/`, or of `backend/test/*.e2e-spec.ts`) |
  | 8 | source files edited (a write under `frontend/src/`, `backend/src/` or `.claude/`) · no subagent still running (*live*) |
  | 9 | tests run (a step-9 command ran) · last run passed (*live*: the last step-9 command's result) |
  | 10 | changelog entry written (a write of `changelog.md` or under `changelog.d/`) · evidence added (a write under `evidence/`) |
  | 11 | retrospective entry written (a write of `retrospective.md` or under `retrospective.d/`) |

  The confidence the rows used to show (matched calls over all calls) moves into the detail: it says how sure the mod is that the calls belong to that step, not how far the step has got.
- **Details.** Rows are plain `Button`s, keyed `row-<n>` (a numbered task), `row-tentative` or `queued-<step>`. A click, or Enter under the focus once `ctrl+x tab` has given the pane the keyboard, opens an indented detail under the row; pressing again closes it, and several rows can be open at once. The detail lists `Summary` (the full summary), `Progress` (`<met> of <all> checks · <p>%`, then one line per check, `✓` met or `○` not), `Agents` (`main` with the task's own tokens, then one line per subagent with its type, model, description, tokens and `✓` or `● running`; a queued step names its expected agent) and `Cost` (`$<cost> while the task ran · confidence <p>% (<matched> of <calls> calls matched)`; absent for a queued step). Which rows are open is kept in `$.state` as `open`; `/workflow reset` closes them.
- **Figures.** Tokens: each main-loop `turn.complete` usage's input and output tokens are added to the running task (cache reads are counted separately and not shown). A subagent's run ends in its own `turn.complete` carrying its `agentId`: that usage goes to the subagent and to the task it was spawned under, and marks it finished. Cost: the session cost from `$.session.usage()` at the task's start subtracted from the cost at its end (US dollars as `/cost` totals them); no price table, so there is no cost per agent. Duration: wall clock from the task's first signal to its end.
- **Commands.** `/workflow` re-reads `CLAUDE.md` and opens (and focuses) the pane; Esc closes it. `/workflow reset` clears the queue and starts `#1` again, for a new change in the same session.
- A pane opened by the mod itself only appears in a terminal at least 144 columns wide (110 once the developer has opened it themselves); narrower, a toast says to run `/workflow`, which opens it at any width. A row is never wider than the pane, because a `Button` does not truncate its children: it always has the `#n`, a 16-column title, the % and the caret, then takes, while they fit, tokens, cost, the agent and the 8-cell bar, the title up to 28 columns, the step and the duration, the title up to 34, and finally the summary when at least 12 columns are left (about 110 columns in all). At 96 columns a row has every figure and a 32-column title, and the summary is read in the detail; in a 74-column sidebar it drops the step and duration columns.
- State lives in `$.state` for the session only (`steps`, `source`, `firstAction`, `queue`, `open`). Nothing is stored across sessions and nothing is written back to the repository.

## 10. Claude Code project skills (`.claude/skills/`)

Developer tooling for people who work on this repository in Claude Code, not part of the app or its releases. `CLAUDE.md` holds only the always-on core: the mandatory first action (read `lessons.md`), the eleven-step `## Workflow` list, the change sizes (S, M, L), the decide-before-build rule, the story lane, wave check and acceptance gate, the read and output rules, the hard gates and the model and effort routing table. The steps' conventions live in four project skills. Claude loads a skill before its steps start, and a developer can invoke it as `/<name>`. Epic [BA-119](../epics/BA-119/spec.md); merged from nine skills into four by roadmap 0.5.2 ([M0-5](../epics/M0-5/spec.md)).

| Skill | Steps | Holds |
|---|---|---|
| `workflow-start` | 1–5 | restating the goal and sizing it, clarifying questions, Planning convention, Epic gate (repo-only epics), Branching convention, Architecture convention (C4, ADRs), Spec convention (where facts go, Gherkin, CI coverage) |
| `workflow-implement` | 8 | Code rules, the lean builder lane, Worktree deploy convention |
| `verify` | wave check, 9 | `qa.mjs --wave` (agent-built stories), `--fast` (plain session, S change) and `--gate`, the eval bar (base vs branch, parallel runs), checking a change in the running web app |
| `workflow-gate` | 6, 7, 10, 11 | E2E impact analysis and test conventions, Test target convention, per-story evidence, the per-epic changelog entry and PR, the demo artifact, the `.context/handoff.md` template, post-merge cleanup, the per-epic retrospective and `lessons.md` |

**The story lane (roadmap 1.23.28, [M1-23](../epics/M1-23/spec.md)).** It replaces the per-story fast loop for agent-built stories. A `builder` starts from its story pack, writes the code, its unit tests, for a UI story one Playwright scenario (`@demo @story-<id>`) and only the spec lines its change makes false, and runs only the related unit tests and its own Playwright file, with no axe scan, screenshots, evidence, demo or `qa.mjs` unless the brief asks. The lead merges the wave (the stories built in parallel) and runs one `qa.mjs --wave`, then hands over the running app, with a demo only for the wave's user-visible milestone. Evidence and demos are recorded per wave; the acceptance gate stays per epic. A plain session without a builder, and every S change, may run `qa.mjs <id> --fast` instead.

**Decide before you build.** Before an L epic, or an M feature whose end state is unclear, the lead shows a cheap prototype (an HTML mock or a sketch, at most 10 minutes, no spec, no ADR), then asks one batched confirmation per epic: spec, ADR, open questions with recommendations, and branch. A direction change afterwards is re-planned once.

**Gherkin once.** A flow's steps live in its Playwright test (`scenarioStep` lines). The capability spec keeps the Feature heading, its `E2E:` line and one `Scenario: <title>` line per scenario; `check-specs.py` checks each title exists in the named file (1.23.29). Existing Features keep their steps until edited.

**Model and effort routing** is the table in `CLAUDE.md` "Model usage" (Opus for plans, ADRs and risky paths; Sonnet for UI on an existing pattern, tests, deletions and docs; Haiku `Explore` for searches). With two or more builders in parallel, at most two use Opus.

**Read and output rules, for every agent.** Never read a file over 500 lines whole: `grep -n` or the generated section index [specs/INDEX.md](../INDEX.md) (`path:start-end heading`), then read the range. Run Playwright with `--reporter=dot` (or `line`) and Jest with `--silent`, send builds and test runs to a log file, and read back only the summary or the failure block.

**Session hygiene.** One lead session per epic wave; before a new session, write `.context/handoff.md` (template in `workflow-gate`).

**Change sizes.** S (a fix, copy, config, dependency, docs or process change with no new user flow, endpoint, persisted shape or agent input) runs a reduced set of steps with no demo (`qa.mjs --no-demo`), no new epic spec and one changelog bullet; M (a story) runs every step; L (architectural) adds an ADR and a written plan. The table is in `CLAUDE.md`.

**Process records.** `lessons.md` (about 80 lines, the distilled rules) is the mandatory first read; `retrospective.md` stays the full append-only history, one entry per epic. `changelog.md` gets one entry per epic, when its PR opens, with a bullet per story linking its evidence folder. Each story's `evidence/<roadmap-id>/` holds what `qa.mjs` writes plus a one-line `README.md` with the demo artifact URL.

Other project skills are task runbooks, not workflow steps: `intellify-api` and `deploy-labs-site` (section 8). Each step line in `CLAUDE.md` keeps the `<n>. **<title>** — <description>` form, followed by `Skill: \`<name>\``, so the `workflow-steps` mod (section 9) still parses it. `check-specs.py` checks the relative links inside `CLAUDE.md`, `lessons.md`, every `SKILL.md` and every Markdown file under `.claude/tools/` (section 5).

## 11. Claude Code tools (`.claude/tools/`)

Developer tooling for people who work on this repository in Claude Code, not part of the app or its releases. A tool is code Claude Code (and developers) run; the skill that names it says when and how. Epic [BA-119](../epics/BA-119/spec.md). Each tool has its own folder, a README (kind, files, how to test) and a row in `.claude/tools/README.md`. A tool is one of two kinds:

| Kind | When | Wiring |
|---|---|---|
| MCP server | An external, authenticated service that Claude is the main user of, with structured inputs and shared writes that need approval per call | Registered in a repo-root `.mcp.json` (stdio, `node .claude/tools/<name>/server.mjs`) and enabled for every developer by `enabledMcpjsonServers` in the committed `.claude/settings.json`; its read tools are in `permissions.allow` there, its write tools ask on every call |
| Script | Deterministic, repo-local work that people and CI also run (checks, generators) | Run from the shell; no server |

There are no tools at the moment. The `jira` MCP server, its skill, `.mcp.json` and the `JIRA_*` template `.env.example` were removed by roadmap 0.5.1 ([M0-5](../epics/M0-5/spec.md)): planning lives only in the repository, epics are roadmap milestones with a spec in `specs/epics/`.

## 12. Claude Code agents (`.claude/agents/`)

Developer tooling for people who work on this repository in Claude Code, not part of the app or its releases. Epic [BA-119](../epics/BA-119/spec.md), roadmap 0.4.3–0.4.8. These definitions run the workflow as a **token-minimal agent org**. An LLM is used only where judgment is needed: writing code, reviewing a diff, and talking to the human. Dispatch, checks, QA, the board and the evidence are scripts and hooks. Manager mode is opt-in. A plain session keeps the single-agent workflow, and the eleven steps, the story lane and acceptance gate, and one branch and PR per epic are unchanged.

| Agent | Model | Tools | Job |
|---|---|---|---|
| `builder` | inherits the session's | all, in a temporary worktree (`isolation: worktree`, which starts from `main`, so the builder first cuts its unit branch from the epic branch) | Builds one roadmap story on a `unit/<EPIC-ID>-<roadmap-id>` branch, from the brief it is given, starting from the story pack (`.context/story-packs/<id>.md`, made by `scripts/story-pack.mjs`). Writes the failing unit test first, then the code. For a UI story, writes the main Gherkin scenario once, as a Playwright test whose `test.step` titles are its Given/When/Then lines. Runs only the related unit tests and its own Playwright file, with no axe scan, screenshots, evidence, demo or `qa.mjs` unless the brief asks; reads line ranges, not whole files over 500 lines; keeps output quiet. Commits on its unit branch and reports the branch, the commit and the tests it added. |
| `reviewer` | `sonnet` | read and search only (`Read`, `Grep`, `Glob`) | Reviews one story's diff against the story's Intent, Scope and Acceptance. It is given the diff and the story, never the builder's transcript. It answers `approve`, or a numbered list of findings, each with file, line, the failure it causes and the fix. It flags no style point that lint already covers. |
| `manager` | inherits the session's | `Read`, `Grep`, `Glob`, `AskUserQuestion`, `PushNotification` | The human's single point of contact, started with `claude --agent manager`. It reads `roadmap.md` (the ticket board), the epic spec and the evidence, and answers "what needs me?" with exactly one question, recommended option first. When a story escalates after 3 failed reviews, it states the disagreement and recommends a way forward. It has no `Edit`, `Write`, `Bash` or `Agent`, so it cannot change files or start work; the pipeline does that. |

`builder` and `reviewer` set `omitClaudeMd: true`: they work from their brief, so they don't load `CLAUDE.md` (roadmap 0.5.2).

Rules every builder follows (from the retrospective):
- Write files with Edit/Write, or in a scratch folder of its own; never use shared `/tmp` names.
- Never stop a process it did not start; record the PIDs it starts.
- Run Playwright with `E2E_SKIP_DOCKER=1` when a Postgres is already listening on 55432.
- Never run `npm test`/`build` alongside `test:e2e` in the same worktree.
- Never start the app on the default ports.

Unit worktrees that the harness creates for a builder are temporary. They are exempt from the epic worktree naming rule (`workflow-start`) and removed once their branch is merged into the epic branch.

## 13. Deterministic QA (`scripts/qa.mjs`)

Developer tooling, epic [BA-119](../epics/BA-119/spec.md), roadmap 0.4.5; made faster by roadmap 0.5.3 ([M0-5](../epics/M0-5/spec.md)). One script runs a story's checks, picks its tests, records its demo and writes its evidence, with no LLM. The `verify` and `workflow-gate` skills call it; 0.4.4's story pipeline will call it as its QA step. Node 22, no dependencies; its logic lives in `scripts/qa-lib.mjs`, tested with `node --test scripts/qa-lib.test.mjs`.

```
node scripts/qa.mjs <roadmap-id> --fast|--gate [--base <ref>] [--rebuild] [--no-demo] [--dry-run]
node scripts/qa.mjs <roadmap-id> --draft-impact [--base <ref>] [--dry-run]
node scripts/qa.mjs --wave <id>,<id>,… [--base <ref>] [--no-demo] [--demo <id>] [--rebuild] [--dry-run]
```

- **Exit codes:** 0 passed, 1 a check failed, 2 bad usage.
- **Locks.** Two lock files, each `{ pid, story, mode, startedAt }`, created exclusively. A waiting run prints `Waiting for <lock> (held by <story>, pid <pid>)` and polls every 2 s. A lock whose pid is no longer running is stale and is removed. Both are released on exit, including on a failure or Ctrl+C (which also stops the run's child processes).
  - **One run per checkout:** `qa-checkout.lock` in the worktree's own git dir, held for the whole run. Runs in one checkout share its `backend/dist`, `backend/public`, `frontend/test-results` and `.qa-reports/`. The report folder is set up only after this lock is taken.
  - **One Playwright phase across worktrees (the QA lane):** `qa.lock` in git's common dir, held only around the Playwright run and the demo recording. Every worktree's E2E uses the one compose Postgres on 55432 (fixed compose project `questions-to-insights-world-cup`): the global setup may start it, and specs create and drop databases on it. Builds, unit suites, lint and `check-specs` run outside the lane, so another worktree's run can do those while one runs Playwright. Each web E2E test starts the CLI on a free port with its own temp data dir, and the embedded Intellify API also takes a free port, so nothing else is shared; port 3000 is used only by the desktop project, which `qa.mjs` never runs.
- **Epic base.** `--base`, else `git merge-base HEAD origin/main`. The changed files are `git diff --name-only <base>` (committed and uncommitted) plus untracked files.
- **Build, skipped when up to date.** `npm --prefix backend run build:all` runs unless all of these hold: `--rebuild` was not passed; the last build `qa.mjs` ran succeeded (`.qa-reports/build-stamp.json`, deleted before a build and written only after a passing one, holding the build's start time); `backend/dist/cli.js` and `backend/public/index.html` exist; and every input is older than that build's start and than both outputs. The inputs are `backend/src/**`, `frontend/src/**`, `frontend/public/**` (directories' own mtimes included, so a deleted or renamed file counts), `backend/` `package.json`, `package-lock.json`, `nest-cli.json`, `tsconfig.json`, `tsconfig.build.json`, `scripts/copy-web.js`, `frontend/` `package.json`, `package-lock.json`, `angular.json`, `tsconfig.json`, `tsconfig.app.json`, `.postcssrc.json`, and each `node_modules/.package-lock.json` (rewritten by every npm install). Anything unknown builds. A skipped build prints `build: up to date, skipped (pass --rebuild to force)` and is recorded as a passed `build … (up to date, skipped)` row; otherwise the run prints `build: will run (<reason>)`. A build run outside `qa.mjs` leaves no stamp, so the next `qa.mjs` run builds again.
- **Parallel checks.** After the build, the backend unit tests, backend lint and `check-specs.py` run concurrently; the frontend unit tests (Karma) run alone right after them, because its browser tests are timing-sensitive and leaked HTTP requests under the others' CPU load (3 of 5 gate runs failed that way on 2026-11-11, none of 4 alone). Each prints its block (command, status, log path, the last 30 output lines on failure) when it finishes; results are recorded in their declared order, so `tests.md` and the logs (`.qa-reports/<roadmap-id>/<n>-<step>.log`) keep the same order. Neither Jest nor `ng test` writes `backend/dist` or `backend/public`. Playwright runs after them, in the lane.
- **Test selection (mechanical).**
  - Backend unit: `npx jest --findRelatedTests <changed backend/src files>`; skipped when none changed.
  - Frontend unit: `ng test --watch=false --browsers=ChromeHeadless` with `--include` for each changed `frontend/src/**/*.spec.ts` and the spec beside each changed source file; skipped when there are none.
  - Playwright (`web` project): `--only-changed=<base>`, plus every spec in the story's step-6 list whose decision is not `delete`, plus every changed `frontend/e2e/*.spec.ts`, plus the story's demo spec. `E2E_SKIP_DOCKER=1` is set when a Postgres already listens on 55432 (checked again once the lane is taken).
- **Step-6 list.** `evidence/<roadmap-id>/e2e-impact.md`, written in step 6 (`workflow-gate`). It holds a Markdown table whose first column is the Playwright spec path (``frontend/e2e/<name>.spec.ts``, in backticks) and whose second column is the decision: `add`, `update`, `delete` or `re-run`. Other rows and text are ignored.
- **`--draft-impact`:** writes a draft step-6 list, `evidence/<roadmap-id>/e2e-impact.md`, from the same selection `--fast` uses (minus the step-6 list itself). Every spec is `re-run` (`delete` when the diff removed the file), the scenarios column says `TODO: review`, and a header line marks it as a draft to review. It never overwrites: if the file exists it prints so and exits 0. It runs no checks and takes no lock.
- **`--dry-run`:** prints the base, the build decision, the parallel commands, the Playwright specs and the demo or demo-evidence plan; runs nothing, writes nothing, takes no lock. With `--draft-impact` it prints the draft instead of writing it.
- **`--fast` (plain-session story run):** the build (unless up to date), the selected backend and frontend unit tests with `check-specs.py` in parallel, the selected Playwright specs, then the **demo**:
  - **UI story:** the Playwright test tagged `@story-<roadmap-id>` (and `@demo`) is run again with `DEMO=1`. That turns on `slowMo` (400 ms), a 1280×720 video of the app window and a caption overlay showing each Gherkin line the test passes to `scenarioStep` ([frontend/e2e/support/demo-captions.ts](../../frontend/e2e/support/demo-captions.ts)). The video is saved as `evidence/<roadmap-id>/demo.webm`. A demo over **5 MB** fails the run. Without `DEMO=1` the same test runs at normal speed with no captions and no video.
  - **Story with no UI** (no test carries its tag): `evidence/<roadmap-id>/demo.txt`, a transcript of the commands the run executed, each with its exit status and the summary lines of its output.
  - **`--no-demo` (an S change):** no video is recorded (a tagged test still runs at normal speed with the selected specs); `demo.txt` is written as the transcript, saying the run used `--no-demo`.
- **`--gate` (acceptance gate):** the build (unless up to date), then in parallel the full backend unit suite (`jest --json`), backend lint (errors fail; warnings do not) and `check-specs.py`, then the full frontend unit suite alone, then every spec of the step-6 list (decision not `delete`) with Playwright's JSON and HTML reporters (`QA_REPORT_DIR` = `.qa-reports/<roadmap-id>/` at the repo root, git-ignored and outside Playwright's `test-results` folder, which Playwright empties at the start of every run). Video and trace are kept for failures. It writes `evidence/<roadmap-id>/tests.md`:
  - one row per command: what ran, passed / failed / skipped, read from the reports (Jest JSON, Playwright JSON, the Karma `TOTAL` line) or the exit code;
  - the specs run, compared with the step-6 list: a listed spec that did not run fails the gate and is named (`Listed in step 6 but not run: <spec>`); a missing step-6 list fails the gate;
  - links to `demo.webm` or `demo.txt` when present, the reports, and the video of each failed test;
  - a **demo evidence** row (since roadmap 1.21.12): the gate fails when the story has no `demo.webm` while a test carries its `@story-<roadmap-id>` tag, has neither `demo.webm` nor `demo.txt`, or its `evidence/<roadmap-id>/README.md` has no `https://claude.ai/artifact/…` link to the demo page (`demoEvidenceProblems` in `scripts/qa-lib.mjs`);
  - **`--no-demo` (an S change):** no demo evidence row and no demo check; `tests.md` names the command as `--gate --no-demo` and says `Demo: skipped (--no-demo, small change).`
- **Demo reminder hook** (`scripts/hooks/demo-reminder.mjs`, a `PreToolUse` hook on `Bash|PowerShell` in `.claude/settings.json`, since roadmap 1.21.12): when a command starts the web app (`backend/dist/cli.js`) from a worktree under `.claude/worktrees/`, it lists the stories the branch marked `🚧 In progress` (its `roadmap.md` diff against `main`) that have no `demo.webm` or `demo.txt`, and reminds the session to run `qa.mjs --fast` and publish the demo page before handing the app over. It never blocks a command and stays silent on any error.
- **Committed evidence:** `e2e-impact.md`, `demo.webm`, `demo.txt`, `demo-page.html`, `tests.md` and the one-line `README.md` with the demo artifact link. The reports and the build stamp stay local.
- **Shareable demo (`scripts/demo-page.mjs`).** So a teammate can watch the demo and read what was done from one link:
  1. `node scripts/demo-page.mjs <roadmap-id>` (no LLM) writes `evidence/<roadmap-id>/demo-page.html` from `roadmap.md` (the story's title, Intent, Scope, Acceptance, status, milestone and epic), `changelog.md` (the story's entry, "What shipped"), `evidence/<roadmap-id>/tests.md` (gate results) and `demo.webm` (or `demo.txt` for a story with no UI). The page follows the Artifact page contract (theme tokens, phone width, no external resources) and references the video by the relative URL `demo.webm`. It is committed under `evidence/` with the video.
  2. The Claude session publishes it with its Artifact tool: `file_path` = the generated `demo-page.html`, `files` = `{ "demo.webm": "evidence/<roadmap-id>/demo.webm" }` (omitted for `demo.txt`), an `icon` such as `video` on the first publish and a one-sentence `description`. Publishing the same story's page again (for example after the gate adds `tests.md`) updates the same artifact: pass its `url`.
  3. The artifact link is recorded in `evidence/<roadmap-id>/README.md` and linked from the story's changelog entry (`Demo: <artifact url>`). Artifacts are private by default: sharing the link with teammates, from the page's Share menu, is the human's step.
  4. When: publish right after `qa.mjs --wave … --demo <id>` (or the plain-session `qa.mjs --fast`) so the user can review the demo by hand; at step 10, regenerate and republish to the same URL only when the demo changed after the wave check; the epic's changelog entry links it.
- **Playwright configuration** (`frontend/playwright.config.ts`): when `QA_REPORT_DIR` is set, the reporters are `list`, `json` (`<dir>/results.json`) and `html` (`<dir>/html`). `DEMO=1` is read by the app fixture (video, `slowMo`) and by `scenarioStep` (captions).
- **Playwright workers (`E2E_WORKERS`, since roadmap 1.23.32):** spec files run in parallel, 3 workers locally and 1 on CI (`CI` set); `E2E_WORKERS=<n>` overrides both (e.g. `E2E_WORKERS=1` for a serial run while debugging). Tests within one file stay in order (`fullyParallel: false`). This is safe because each web test has its own CLI port, data dir and stub servers, and the specs that create databases on the shared Postgres give them unique names. A new spec that writes to the shared Postgres must do the same (a unique database name, or rows it creates and deletes itself). The QA lane still covers the whole Playwright phase, so one worktree's workers never overlap another's. Timings: [evidence/1.23.32/timings.md](../../evidence/1.23.32/timings.md).
- **`check-specs.py` on Windows:** paths are compared with forward slashes, so the Playwright-mirror check passes on Windows as it does on Linux.
- **Spec section index and story pack (roadmap 1.23.29).**
  - `node scripts/spec-index.mjs` writes `specs/INDEX.md`: for every `specs/**/*.md`, `roadmap.md`, `roadmap-archive.md` and `roadmap-backlog.md`, each heading (levels 2-4) and each rule id (`- R<n>.`) as `path:first-last  heading`, outside code fences. A heading runs to the line before the next heading of its level or higher; a rule to the line before the next rule or heading. Never edit it by hand; regenerate it after any spec or roadmap edit.
  - `check-specs.py` fails when the index is stale (it runs `node scripts/spec-index.mjs --check`; skipped when `node` is missing), and when a `Scenario:` of a Feature that has no Given/When/Then lines under its scenarios has a title that is not in its `E2E:` file (a Feature that keeps its steps in the spec is not checked).
  - `node scripts/story-pack.mjs <roadmap-id> [--out <file>]` writes `.context/story-packs/<id>.md` (gitignored): the story's roadmap entry verbatim (from `roadmap.md` or `roadmap-archive.md`); the plan sections it cites (links to `docs/plans/*.md`, "plan section N", "plan 1.24.x", looked up in every plan file when unlinked), capped at 400 lines; the spec sections it names (`specs/...md#anchor` paths, or `Specs: <capability> R2, R5` short names, with their line ranges); a file map (top-level symbols with line numbers of each code path named); the `lessons.md` lines for the touched areas; the builder rules and report block. It prints the size and warns above 60 KB.
- **Roadmap archive (roadmap 1.23.30).** `node scripts/roadmap-archive.mjs [--dry-run]` moves every milestone whose `####` features are all `✅ Done` or `🚫 Cut` (or, after its open features moved to the backlog, only `- <id> <title> — moved to Backlog` placeholder lines; and that is not Milestone 1.23, the active epic) from `roadmap.md` to `roadmap-archive.md`, verbatim and in order. `roadmap.md` keeps one heading per archived milestone: the original heading (it names the epic) plus ` — archived, see roadmap-archive.md`. The script is idempotent. `check-specs.py` (epic gate and link check), `qa.mjs` (`storyTitle` for `demo.txt`), `demo-page.mjs`, `story-pack.mjs` and `spec-index.mjs` read **all three** files (`roadmap.md`, `roadmap-archive.md`, `roadmap-backlog.md`), so an archived or backlogged story is still found by `qa.mjs <id> --dry-run` and `demo-page.mjs <id>`. Open stories moved out of a finished or stale milestone live verbatim in `roadmap-backlog.md` under `### Moved from Milestone <x.y> — <title> (<date>)`, with a placeholder line left in the milestone; `roadmap.md` keeps a `## Backlog` heading that points to it. Re-run the script when an epic finishes.
- **`--wave <id>,<id>,…` (roadmap 1.23.31): one verification for several stories.** It reuses the `--fast` step runners (build decision, parallel unit tests and `check-specs.py`, Playwright, demo), once for the whole wave:
  - the build (unless up to date), the related unit tests of the union of files changed since `--base`, `check-specs.py`, and the union of Playwright specs (`--only-changed=<base>`, the union of the stories' step-6 lists in `evidence/<id>/e2e-impact.md`, every changed `frontend/e2e/*.spec.ts`);
  - one demo only, for `--demo <id>` (its `@story-<id>` test with `DEMO=1`, or its `demo.txt`); `--no-demo` (the default) records none and writes no `demo.txt`. `--demo` and `--no-demo` exclude each other, and the demo story must be one of the wave's;
  - evidence: `evidence/waves/<first-id>…<last-id>.md` is the shared report (steps, counts, the spec union, failures, links); each story gets `evidence/<id>/tests.md` that states the result and points to the shared report. The step-6 coverage check and the demo evidence row of `--gate` are not part of a wave: the acceptance gate still runs per story;
  - `--dry-run` prints the plan: the stories, base, build decision, parallel commands, Playwright specs, demo and the evidence files it would write; nothing runs and no lock is taken. Reports go to `.qa-reports/wave-<first>-<last>/`.
- **Quiet output (roadmap 1.23.31).** Every Playwright run uses `--reporter=dot,json,html` (the demo run, which writes no reports, `--reporter=dot`), with `PLAYWRIGHT_JSON_OUTPUT_NAME`, `PLAYWRIGHT_HTML_OUTPUT_DIR` and `PLAYWRIGHT_HTML_OPEN=never` pointing at the report dir (a command-line `--reporter` replaces the config's). Every command's output goes to its log file in the report dir; the console prints one line per step (`✔|✖ <name>: <status> (exit, seconds), log <path>`) and, for a failed step only, the last 30 lines of its log.

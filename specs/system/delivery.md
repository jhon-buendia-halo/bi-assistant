# Delivery

How the app is built, run, packaged, distributed and released. The stack and code layout are in [tech-stack.md](tech-stack.md); the reasons for the delivery shape are ADR-0001 and ADR-0002 in [architecture.md](architecture.md). The CLI flags and the desktop IPC bridge are contracts, specified in [api.md](api.md); this file records how they are delivered.

The app ships three ways from one codebase: the **Halo BI Assistant** desktop installers (Electron), the **npm package** that runs the same app in a browser, and, separately, a static **product page** (`site/`).

## 1. Electron single-app delivery

The desktop app is one installable unit. The Electron main process (`frontend/electron/main.cjs`) starts the NestJS backend as a child process, waits until it answers, then opens the window.

| Concern | Behaviour |
|---|---|
| Backend process | `spawn(process.execPath, [backend/dist/main.js])` with `ELECTRON_RUN_AS_NODE=1`: Electron's own binary runs as plain Node, so packaged apps need no system Node. stdout/stderr are piped into the diagnostics log (see [capabilities/diagnostics/spec.md](../capabilities/diagnostics/spec.md)). Working directory is the folder containing `main.js`. |
| Backend entry | Packaged: `<resources>/backend/dist/main.js` (from `extraResources`). Unpackaged: `backend/dist/main.js` in the repo. A missing entry is logged as a diagnostics error and the backend is not started. |
| Environment given to the backend | `ELECTRON_RUN_AS_NODE=1`, `PORT` (from `BACKEND_PORT`, default `3000`), `APP_DATA_DIR`, `APP_SECRET`, plus the parent environment. |
| Port | Backend listens on `PORT` (default 3000) on all interfaces, with CORS enabled (`main.ts` calls `createApp({ cors: true })`) because the renderer's origin under `file://` is `null`. |
| Readiness probe | `GET http://127.0.0.1:<BACKEND_PORT>/sessions` every 100 ms (500 ms request timeout) until it returns 200, for up to 30 s. On timeout the window opens anyway, a diagnostics error is recorded, and the supervisor keeps polling. |
| Backend status to the UI | The main process pushes `backend-status` events (`starting`, `ready`, `restarting`, `down`) to every window and re-sends the current status after each page load. The renderer subscribes through the preload bridge (`window.desktop.onBackendStatus`) and shows a banner. |
| Supervisor | An unexpected backend exit restarts it with backoff 1 s, 2 s, 4 s (three attempts, status `restarting`); after that status is `down`. A backend that stays ready for 60 s resets the restart budget. |
| Quit | `before-quit` marks the app as quitting (so the exit handler does not restart), clears timers and kills the backend. On Windows and Linux closing the last window quits the app; on macOS it does not. |
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
| `test:e2e` | prepare + `playwright test --project=web` | The full Playwright suite against the web app (the default target). |
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
| `evals:assistant` | `nest build && node dist/mastra/evals/run-assistant-evals.js` | The assistant eval suite from the command line, same suite the Agents screen runs. Needs `EVAL_DATASETS` (comma-separated saved dataset names); optional `EVAL_TIMEOUT_MS`, `EVAL_ROW_LIMIT`. |
| `worldcup:api:dump` | `ts-node scripts/worldcup-rest-api/dump.ts` | Snapshot the World Cup Postgres into JSON files for the test REST API (`WORLD_CUP_DB_*` env). |
| `worldcup:api` | `ts-node scripts/worldcup-rest-api/serve.ts` | Zero-dependency REST + OpenAPI server over that snapshot on `127.0.0.1:55080` (`WORLD_CUP_API_PORT`), for exercising the REST connector. |
| `worldcup:rest:setup` | `ts-node scripts/setup-worldcup-rest.ts` | Registers that API as a `rest` datasource and a dataset in a running backend through its HTTP API (`BACKEND_URL`, `WORLD_CUP_API_URL`); idempotent. |
| `build:web` | `npm --prefix ../frontend run build:web && node scripts/copy-web.js` | Build the UI and copy it to `backend/public/` (gitignored). `copy-web.js` fails if the frontend build has no `index.html`. |
| `build:all` | `build` then `build:web` | Everything the npm package needs. |
| `prepack` | `build:all` | `npm pack` / `npm publish` always ship a fresh UI. |

### Local run recipes

```bash
(cd backend && npm ci) && (cd frontend && npm ci)    # install

cd backend && npm run start:dev                      # API only, :3000, data in backend/data
cd frontend && npm start                             # ng serve :4200
cd frontend && npm run electron:dev                  # desktop shell on ng serve
cd frontend && npm run electron                      # production-style desktop run
cd backend && npm run build:all && npm run start:web # web mode from the working tree
```

### Verification gate (what must be green before a change ships)

| Where | Commands |
|---|---|
| `frontend/` | `npm test`, `npm run build`, `npm run test:e2e` |
| `backend/` | `npm test`, `npm run build`, lint on the files you touched |

`test:e2e` builds the backend with the web UI and drives the web app; its global setup starts the World Cup Postgres itself (see section 6). The desktop target (`test:e2e:desktop`) runs only when a desktop run is requested, and refuses to launch the app if port 3000 is taken. Which target to test, and how skipped desktop-only scenarios are reported, is the *Test target convention* in [CLAUDE.md](../../CLAUDE.md).

## 3. Desktop packaging (electron-builder)

Configuration lives in the `build` block of `frontend/package.json`.

| Setting | Value |
|---|---|
| `appId` | `com.halopowered.questions-to-insights` |
| `productName` | `Halo BI Assistant` |
| `artifactName` | `Questions-to-Insights-${version}-${os}-${arch}.${ext}`, for example `Questions-to-Insights-0.20.3-mac-arm64.dmg`, `…-win-x64.exe` |
| Output | `frontend/release/` (gitignored) |
| Build resources / icon | `frontend/build/`, `build/icon.png` (also set for `mac` and `win`) |
| Packaged files | `dist/frontend/**`, `electron/**`, `package.json` |
| macOS | category `public.app-category.productivity`; `.dmg` for arm64 and x64 |
| Windows | NSIS `.exe` for x64 |
| Signing | none: CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and produces unsigned artifacts |

**Backend staging** (`frontend/scripts/stage-backend.sh`): runs `npm run build` in `backend/`; recreates `backend/release-staging/` (gitignored); copies in `dist/`, `package.json` and `package-lock.json`; then runs `npm ci --omit=dev --ignore-scripts --legacy-peer-deps --no-audit --no-fund` there. Production dependencies only; install scripts are skipped, so the native modules come from their prebuilt binaries.

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
| `--host <h>` | `127.0.0.1` | Interface to bind. |
| `--data-dir <path>` | `$QTI_DATA_DIR`, else `$APP_DATA_DIR`, else `~/.questions-to-insights` | Deliberately separate from the Electron `userData` dir so desktop and web can run together without SQLite lock fights. |
| `--no-open` | | Do not open the browser. |
| `-h`, `--help` / `-v`, `--version` | | Print and exit. |

Startup order matters: the CLI creates the data directory, sets `APP_DATA_DIR`, resolves and sets `APP_SECRET` (read or create `<data-dir>/.app-secret`, mode 0600, same semantics as the Electron main process) and **only then** dynamically imports the app, because `database.module.ts` and `mastra/storage.ts` read `APP_DATA_DIR` at import time. It prints the URL and data dir, opens the default browser (best effort: `open`, `cmd /c start`, `xdg-open`), and on SIGINT/SIGTERM closes the app (forced exit after 5 s). It warns when no web UI build is found. CORS is off in this mode (same origin); the Electron entry `main.ts` keeps it on.

**Bootstrap** (`backend/src/app-bootstrap.ts`, `createApp()`, shared by `main.ts` and the CLI): when `<webRoot>/index.html` exists, it serves the static files and installs a SPA fallback. `webRoot` is the `WEB_ROOT` env, else `backend/public/` (next to `dist/`). The fallback is a filter on Nest's not-found path, so API controllers always win: only an unmatched `GET`/`HEAD` with `Accept: text/html` and no file extension receives `index.html`; everything else keeps Nest's 404. With no `index.html`, the app serves the API only (the Electron-staged backend has no `public/`).

**Frontend in this mode:** `API_BASE_URL` is `''` (same-origin relative URLs such as `/sessions`) unless running from `file://`.

**Build and pack:** in `backend/`, `npm run build:web` (frontend build then `scripts/copy-web.js` into `public/`), `npm run build:all`, and `prepack` runs `build:all`. To test locally: `npm pack`, then `npm i <tarball>` in a scratch directory and run the bin.

**Data layout the CLI creates** under the data dir: `app.sqlite`, `mastra.sqlite`, `observability.duckdb`, `workspaces/`, `.app-secret` (see [data-model.md](data-model.md)). The native modules (better-sqlite3, DuckDB, LibSQL) arrive as prebuilt binaries; if npm starts compiling them, the Node version is unsupported or a toolchain is missing.

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

Conventional Commit subjects therefore drive the bump, Because the bump reads every commit since the last tag, an epic's single PR with mixed `feat`/`fix`/`docs` commits still bumps at the highest level it contains. The epic branch's type names that highest-impact type (see *Branching convention* in [CLAUDE.md](../../CLAUDE.md)).

### `build-desktop.yml` — Build desktop installers

Manual: Actions → Build desktop installers → Run workflow. A hand-pushed `v*` tag also triggers it.

| Input | Default | Meaning |
|---|---|---|
| `windows_x64` | true | Windows x64 `.exe` (runner `windows-2022`, NSIS) |
| `macos_arm64` | true | macOS Apple Silicon `.dmg` (runner `macos-latest`) |
| `macos_x64` | true | macOS Intel `.dmg` (runner `macos-15-intel`) |
| `ref` | empty | Tag, branch or SHA to build; empty = the branch the run was started from |
| `publish` | false | Attach the installers to the GitHub release for the resolved tag |

Jobs:

1. **`prepare`** checks out the ref with full history and tags, turns the ticked boxes into the matrix (`{"include":[…]}`; a tag push carries no inputs and means "build everything"; unticking every box fails with "tick at least one platform"), and resolves the tag:
   - a `v*` ref publishes to exactly that tag;
   - anything else (branch, SHA, empty) takes the version committed at that ref (`frontend/package.json`) and **walks the patch level up** until it finds a tag that either does not exist or already points at this commit, so building `main` twice gives `v0.13.0` then `v0.13.1` instead of clobbering a shipped release.
2. **`build`** (one runner per ticked platform, 45 min timeout, `fail-fast: false`): checks out the resolved SHA, **stamps the resolved version** into both `package.json`s (so the installer filename and the tag never disagree), `npm ci --legacy-peer-deps` in `backend/` and `frontend/`, then `npm run electron:dist -- --<target> <format> --<arch>`, and uploads the installer as an Actions artifact (retention 14 days). Artifacts are unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`).
3. **`publish`** runs when `publish` is true or the trigger was a `v*` tag: downloads all artifacts, creates the GitHub release empty if it does not exist (`gh release create --target <sha> --generate-notes`, which also creates the tag at the built commit, so no tag is pushed unless the build succeeded), then uploads each installer one at a time with up to 3 attempts and `--clobber` (installers run to hundreds of MB and the upload endpoint rejects them intermittently). Because of `--clobber`, separate per-platform runs accumulate on the same release instead of replacing each other.

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
| Links | a relative link in `CLAUDE.md`, `README.md`, `roadmap.md` or any spec doesn't resolve. `changelog.md` and `retrospective.md` are skipped, because their past entries are never rewritten. |
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
| Sample Postgres | project `questions-to-insights-world-cup`, port 55432 | `docker compose -p <name>` plus `WORLD_CUP_DB_PORT=<port>`; the e2e fixtures read the same variable (and `WORLD_CUP_DB_HOST`) |
| Observability profile | same project; ports 6006, 3001, 4317, 4318 | `docker compose -p <name>` plus `PHOENIX_PORT`, `GRAFANA_PORT`, `OTLP_GRPC_PORT`, `OTLP_HTTP_PORT` (see *Observability profile* above) |
| Playwright | needs port 3000 free | one e2e run at a time per machine; each test already gets its own temp profile |

The project rule: when work happens in a worktree, ask which target (shared or isolated) before starting the app or the Compose stack. See *Worktree deploy convention* in [CLAUDE.md](../../CLAUDE.md).

## 8. The product page (`site/`)

A separate, static deliverable: the public page for the app, a section of the Halo Powered Labs site. Not part of the app or its releases.

| Item | Detail |
|---|---|
| Content | Plain static HTML/CSS in `site/public/` (no build step, no framework), styled with the Labs design tokens; screenshots in `public/shots/` |
| Hosting | Cloudflare Pages project `halo-bi-assistant` (`halo-bi-assistant.pages.dev`), custom domain `bi-assistant.halo-powered-labs.com` |
| Scripts | `scripts/dev.sh` (local on :4500 via `wrangler pages dev`), `deploy.sh` (publish; needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, optional `CF_PAGES_PROJECT`), `domain.sh` (attach the domain), `protect.sh` (optional Cloudflare Access lock) |
| Download routes | Pages Functions: `/download/mac-arm64`, `/download/mac-x64`, `/download/win-x64` redirect to the newest published installer for that platform; `/api/latest` returns JSON (version, file sizes) for the page. A new release needs no site edit. |
| Private-repo trick | The repo is private, so `releases/download/…` 404s publicly. The Function asks the GitHub API for the asset with `Accept: application/octet-stream`, takes the credential-free short-lived `Location`, and redirects the browser to it; the token never leaves the edge. Per platform it picks the newest release that carries that installer, so a Windows-only release leaves macOS buttons on the last release that had them. |
| Secret | `GITHUB_TOKEN` (fine-grained PAT, Contents: read-only, scoped to this repo; expires within a year) set with `wrangler pages secret put`. Without it both routes answer 503 and the page shows static copy with buttons marked unavailable. |
| Screenshots | Re-shot from the real app against the World Cup demo fixture with `site/scripts/screenshots/seed-demo.cjs` and `capture.mjs` (see `site/README.md` for the full procedure). |
| Skill | The project skill `deploy-labs-site` covers publishing or redeploying it. |

Installers are named `Questions-to-Insights-<version>-<os>-<arch>.<ext>` while the product is branded Halo BI Assistant; change `build.artifactName` if the downloaded file should carry the product name.

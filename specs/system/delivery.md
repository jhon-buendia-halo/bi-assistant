# Delivery

How the app is built, run, packaged, distributed and released. The stack and code layout are in [tech-stack.md](tech-stack.md); the reasons for the delivery shape are ADR-0001 and ADR-0002 in [architecture.md](architecture.md). The CLI flags and the desktop IPC bridge are contracts, specified in [api.md](api.md); this file records how they are delivered.

The app ships three ways from one codebase: the **Halo Workbench** desktop installers (Electron), the **npm package** that runs the same app in a browser, and, separately, a static **product page** (`site/`).

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
| Supervisor | An unexpected backend exit restarts it with backoff 1 s, 2 s, 4 s (three attempts, status `restarting`); after that status is `down`. A backend that exits with code 98 (its port is taken) is not restarted: status `down` at once. A backend that stays ready for 60 s resets the restart budget. |
| Quit | `before-quit` marks the app as quitting (so the exit handler does not restart), clears timers, kills the backend and removes `backend.pid`. On Windows and Linux closing the last window quits the app; on macOS it does not. |
| No leftover processes | Windows does not end a child when its parent dies, so a crashed or force-ended window could leave the backend holding the port. Three guards (roadmap 1.7.21; contract in [api.md](api.md) 4.3): the backend exits once the main process is gone (`DESKTOP_PARENT_PID`); startup stops a backend recorded in `backend.pid` that is still running as the app's executable; the readiness probe accepts only the backend it just spawned (`X-Backend-Instance`). A single-instance lock makes a second launch focus the running window instead of starting a second backend. |
| Window | 1440x900, minimum 960x600, `titleBarStyle: 'hiddenInset'`, `contextIsolation: true`, `nodeIntegration: false`, preload `electron/preload.cjs`. Loads `dist/frontend/browser/index.html`, or `ELECTRON_DEV_URL` when set. A `file://` `ERR_FILE_NOT_FOUND` load failure is retried by reloading the real entry file, at most 3 times. |
| Renderer to backend | `API_BASE_URL` is hardcoded to `http://localhost:3000` under `file://`. **Known gap (roadmap 1.7.20, BA-109):** the preload bridge does not expose the port, so a non-default `BACKEND_PORT` makes the readiness probe and the backend use the new port while the renderer still calls 3000, which breaks the app. |

### Why `--base-href ./`

Electron loads the renderer from `file://`. An absolute base (`/`) would resolve assets against the filesystem root and the app would not load, so every Electron build uses `ng build --base-href ./`. The web build (`build:web`) uses the Angular default base `/`, because the backend serves it from the site root.

### Data directory and secret

| Item | Behaviour |
|---|---|
| `APP_DATA_DIR` | Electron's `userData` directory. The profile name tracks the app name; if it does not exist, the newest existing pre-rename directory (`Halo BI Assistant`, then `Questions to Insights`; brand.json `legacyOsNames`) is kept in place (ADR-0046). On **Windows**, backend data (`app.sqlite`, `mastra.sqlite`, `workspaces`) lives in `%LOCALAPPDATA%\Halo Workbench` (or an existing pre-rename `%LOCALAPPDATA%\<legacy name>`) and is moved there once from the roaming profile, with rollback and a diagnostics entry on failure, because roaming profiles are often synced or locked. |
| `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR` | Overrides `userData` entirely and disables the Windows redirect. Used by the Playwright fixture so tests never touch a real profile; also the way to run an isolated desktop instance from a worktree. |
| `APP_SECRET` | The backend derives the AES-256-GCM key that encrypts stored API keys from it. Taken from the `APP_SECRET` environment variable if set; otherwise read from `<APP_DATA_DIR>/.app-secret`, or generated (32 random bytes, hex) and written there with mode 0600. It must stay stable across launches. Back up `.app-secret` with the data; without it stored keys cannot be decrypted. The backend itself, run bare without `APP_SECRET`, reads or creates `.app-secret` in its own data dir the same way. |
| Other files in the profile | `logs/system.ndjson` (diagnostics, rotated to `system.previous.ndjson` above 5 MB; the last 2,000 entries are kept in memory). |

### Dev and branding helpers

- `frontend/scripts/brand-electron.sh` renames `node_modules/electron/dist/Electron.app` to `<osName>.app` (the selected brand's `osName`, "Halo Workbench" by default), rewrites its `CFBundleName` / `CFBundleDisplayName` and the launcher's `path.txt`, and refreshes LaunchServices, so the macOS menu bar and Dock show the product name in unpackaged runs. Idempotent; a no-op off macOS. Packaged builds get the name from electron-builder's `productName`.
- The app icon is per brand: `frontend/brands/<id>/public/brand/icon.png` (electron-builder derives `.icns` / `.ico`), rendered at 1024 px from `frontend/brands/<id>/art/app-icon.svg` (ADR-0044, ADR-0045); a copy ships in the renderer bundle as `brand/icon.png`.
- The Electron main process reads `frontend/electron/brand.json` (a gitignored copy of the selected brand's `brand.json`, written by `brand.mjs electron-prepare`; it falls back to `brands/halo/brand.json` when absent) for the app name, window title, legacy userData migration (halo only), window background per theme and icon. Mercer has its own userData folder and no migration, so both apps install and run side by side.

### Brands (ADR-0045)

`BRAND=halo|mercer` (default `halo`) picks the brand for every build; one build is one brand. Each brand is a folder `frontend/brands/<id>/` (`brand.json`, `tokens.css`, `public/`, `art/`), and `brand.json` carries `id`, `osName`, `legacyOsNames` (earlier OS names, newest first), `windowTitle`, `appId`, `artifactName`, `icon`, `canvas {light, dark}` and `publishNpm`.

| Brand | Product | OS name | appId | Installer | npm |
|---|---|---|---|---|---|
| `halo` | Halo Powered | Halo Workbench | `com.halopowered.questions-to-insights` (kept from before the rename so installs upgrade in place) | `Halo-Workbench-<version>-<os>-<arch>.<ext>` | yes |
| `mercer` | Agentic Hub | Agentic Hub | `com.halopowered.agentic-hub` | `Agentic-Hub-<version>-<os>-<arch>.<ext>` | no |

```bash
npm --prefix backend run build:all                           # web UI, Halo
BRAND=mercer npm --prefix backend run build:all              # web UI, Agentic Hub (served by node backend/dist/cli.js)
BRAND=mercer npm --prefix frontend run electron:dist         # Agentic Hub installer
BRAND=mercer npm --prefix frontend run electron        # production-style desktop run of the brand
```

The web build writes `dist/frontend/browser/brand.json` (`{ "id" }`), which `copy-web.js` carries to `backend/public/brand.json`; the npm guard and `e2e/brand-mercer.spec.ts` read it. Rebuild without `BRAND` after a mercer build before running the rest of the E2E suite.

## 2. npm scripts

### `frontend/package.json`

| Script | Runs | Purpose |
|---|---|---|
| `ng` | `ng` | Angular CLI passthrough. |
| `start` | `ng serve` | Dev server on http://localhost:4200 (development configuration, base href `/`). |
| `build` | `ng build` | Production Angular build into `dist/frontend/browser` (base href `/`). |
| `build:web` | `node scripts/brand.mjs ng-build` | `build` for the selected brand (`BRAND`, default halo; `ng build -c production,mercer` for mercer) and writes `dist/frontend/browser/brand.json`; the backend's `build:web` calls it. |
| `watch` | `ng build --watch --configuration development` | Rebuild on change. |
| `test` | `ng test` | Karma + Jasmine unit tests. |
| `test:e2e:prepare` | `tsc -p e2e/tsconfig.json && npm --prefix ../backend run build:all` | Type-check the e2e code, build the backend and the web UI into `backend/public/`. |
| `test:e2e:prepare:desktop` | `tsc -p e2e/tsconfig.json && npm --prefix ../backend run build && node scripts/brand.mjs electron-prepare && node scripts/brand.mjs ng-build --base-href ./` | Type-check the e2e code, build the backend, write `electron/brand.json`, build the Angular app for Electron (selected brand). |
| `test:e2e` | prepare + `playwright test --project=web` | The full Playwright suite against the web app (the default target). The app has one built-in user and no sign-in, so the fixture only starts the app ([tech-stack.md](tech-stack.md)). |
| `test:e2e:ui` | prepare + `playwright test --project=web --ui` | Same, in Playwright's UI mode. |
| `test:e2e:update` | prepare + `playwright test --project=web --update-snapshots` | Regenerate the web visual baselines; only for an intended visual change. |
| `test:e2e:desktop` | desktop prepare + `playwright test --project=desktop` | The same suite against the real Electron app. Run only when a desktop run is requested. |
| `test:e2e:desktop:update` | desktop prepare + `playwright test --project=desktop --update-snapshots` | Regenerate the desktop visual baselines. |
| `brand:electron` | `bash scripts/brand-electron.sh` | See above. |
| `electron` | `brand:electron`, `brand.mjs electron-prepare`, backend build, `brand.mjs ng-build --base-href ./`, `electron .` | Production-style run: builds everything for the selected brand, opens the app. |
| `electron:dev` | `brand:electron`, `brand.mjs electron-prepare`, then `ELECTRON_DEV_URL=http://localhost:4200 electron .` | Window pointed at `ng serve` for live reload. Run `npm start` first; the backend spawns from `backend/dist`, so build it once. |
| `stage:backend` | `bash scripts/stage-backend.sh` | Build and stage the backend for packaging (section 3). |
| `electron:dist` | `stage:backend`, `brand.mjs electron-prepare`, `brand.mjs ng-build --base-href ./`, `node scripts/electron-dist.mjs` | Full installer build into `frontend/release/`; `electron-dist.mjs` runs electron-builder with the selected brand's appId, product name, artifact name and icons. Extra arguments select the target, for example `-- --mac dmg --arm64` or `-- --win nsis --x64`. |

### `backend/package.json`

| Script | Runs | Purpose |
|---|---|---|
| `build` | `nest build` | Compile to `dist/` (clears the folder first; copies `mastra/skills` and the testing-data SQL fixtures; the eval question bank files are imported by their loader and the eval price table by `eval-usage.ts`, so both are copied into `dist` next to the module that imports them, [data-model.md](data-model.md) 4.9 and 4.11). |
| `start` | `nest start` | Run the API once (port 3000, data in `<cwd>/data`). |
| `start:dev` | `nest start --watch` | Watch mode. |
| `start:debug` | `nest start --debug --watch` | Watch mode with the inspector. |
| `start:prod` | `node dist/main` | Run the compiled API (the Electron path). |
| `start:web` | `node dist/cli.js` | Run the npm CLI from the working tree (needs `build:all` first). |
| `format` | `prettier --write` on `src` and `test` | Format. |
| `lint` | `eslint … --fix` | Lint **and auto-fix**; run it on specific files, not project-wide, because it reformats unrelated files. |
| `test`, `test:watch`, `test:cov`, `test:debug` | Jest | Unit tests (`src/**/*.spec.ts`, and `scripts/**/*.spec.ts` since BA-187: Jest's `roots` take both), watch, coverage, debugger. |
| `test:e2e` | `jest --config ./test/jest-e2e.json` | API-level e2e specs in `test/`; the live-data specs skip without the World Cup Postgres. |
| `test:live-llm` | `jest --config ./test/jest-live-llm.json --runInBand` | The live-LLM integration layer (`test/*.live-llm-spec.ts`): Answer a Business Question run through the HTTP API on the **real** model and the World Cup Postgres, checking that the parts fit (every structured reply parses, queries run, Validate passes within its attempts, the answer's figures equal the same figures queried directly, each query reaches the query inspector and can be explained, a wait, a resume, a follow-up and reference images keep the run's contract). Not an eval: it judges no answer's quality. Opt-in, never run by `qa.mjs` (about 50 model calls a run). The model is `LIVE_LLM_PROVIDER`, `LIVE_LLM_API_STYLE`, `LIVE_LLM_BASE_URL`, `LIVE_LLM_MODEL`, `LIVE_LLM_API_KEY`, else the `LLM_*` keys of `.env.llm.local` (this checkout, else the main one); without a model or the Postgres the suite skips, visibly. Each run writes what it saw (steps, attempts, queries, notes, the answers) to `.qa-reports/live-llm/report.md` and `report.json`. |
| `evals:assistant` | `nest build && node dist/mastra/evals/run-assistant-evals.js` | The assistant eval suite from the command line, same suite the Agents screen runs. Needs `EVAL_DATASETS` (comma-separated saved dataset names) and one of `EVAL_SET` (a set id, such as `world-cup-rest`, or `query-explainer` for the Query Explainer) or `EVAL_CASES` (comma-separated case ids); with neither or both it runs nothing, as [agents-evals](../capabilities/agents-evals/spec.md) R251 explains. `EVAL_SPLIT` (`dev` or `held-out`) and `EVAL_CATEGORY` (comma-separated categories) narrow that selection, `EVAL_REPEATS` (`1` by default, `3` or `5`) asks each question that many times and reports pass^k with flaky questions (R209 to R213, R222). `EVAL_MEMORY` (`none` by default, `mastra` or `hindsight-mastra`) sets the run's memory arm, for the memory sets of BA-190 (R231, R232; `mastra` runs only on a build that has BA-81's store, and `hindsight-mastra` is never built in this version, so both are refused as not built until then). `EVAL_JUDGE` (`off` by default, `on` or `categories`, with `EVAL_JUDGE_CATEGORIES`) sets the judge option (R154); with it off, judge checks are not scored and cost nothing. It prints every check of each question, passed or failed with its reason, then dev and held-out side by side with their intervals, the tokens and the cost. The run is saved in the data directory it runs with (`APP_DATA_DIR`, else `backend/data`) like a run started in the app, so it prints `Run id: <jobId>` and the comparison with the previous comparable run (R223). Optional `EVAL_RESULTS_FILE` (a path: the run's full results, answers and tool calls included, written there as JSON) and `EVAL_RUN_FILE` (a path: the saved run record, written there as JSON; R224). Every refusal comes before the backend boots and costs no model call. Example: `EVAL_DATASETS="World Cup" EVAL_SET=world-cup EVAL_REPEATS=3 npm run evals:assistant`. Costs model calls. |
| `evals:assistant:run` | `node dist/mastra/evals/run-assistant-evals.js` | `evals:assistant` without the build, for a `dist/` that is already built and must not change while it runs (the improvement loop runs the same file from its snapshot of `dist/`, *Improvement loop* below). Same settings. |
| `eval:validate` | `nest build && node dist/mastra/evals/validate-eval-sets.js` | The eval-set validator: checks one set's reference queries on its datasource with no model call; what it runs, prints and exits with is [agents-evals](../capabilities/agents-evals/spec.md) R250. Needs `EVAL_DATASETS` (comma-separated saved dataset names) and `EVAL_SET` (the set id). Boots the backend without an HTTP port, like `evals:assistant`. Both rebuild `dist/` first (`nest build` clears it), so neither should run while the E2E suite or a long eval run uses that build. |
| `eval:diff` | `ts-node -T -P tsconfig.json scripts/eval-diff.ts --before <runs> --after <runs> [--data-dir <dir>] [--target <categories>] [--round <n>] [--lever "<text>"] [--hypothesis "<text>"] [--tsv]` | Compares two sides of saved runs (run ids, whole or 8-character prefixes, read without writing from `<data dir>/app.sqlite`; or exported run files): per split and category the before and after pass rates with their intervals, the change with Newcombe's interval and an `up` / `down` / `within` flag, flipped questions, questions only on one side, cost per question, warnings when sets, model, repeats, judge or memory arm differ (`the memory arm differs: <before> → <after>`, R246), a draft change-log line and, with `--tsv`, a draft [`results.tsv`](../../docs/evals/loop/results.tsv) row. With `--target` it checks the accept rule and exits with code 1 when it is not met. No model call. [agents-evals](../capabilities/agents-evals/spec.md) R224 to R227. |
| `eval:export-failures` | `ts-node -T -P tsconfig.json scripts/eval-export-failures.ts --run <run> --out <folder> [--data-dir <dir>] [--force]` | Writes the dev failures of one run as one Markdown file per failed dev question, plus a README with the dev counts and only the counts of the held-out split: what the loop's fixer reads. Refuses a non-empty folder unless it holds an earlier export and `--force` is given. No model call. R228. |
| `eval:leak-check` | `ts-node -T -P tsconfig.json scripts/eval-leak-check.ts [--base <ref>] [--staged] [--diff-file <path>] [--fixer] [--json]` | Rejects added lines in the lever files that quote a question bank (question words, entity names, numbers, quoted values) from any split or a planted-facts file; exits with code 1 on a rejection. `--fixer` names no held-out case in its report. R229, R230. |
| `worldcup:api:dump` | `ts-node scripts/worldcup-rest-api/dump.ts` | Snapshot the World Cup Postgres into JSON files for the test REST API (`WORLD_CUP_DB_*` env). |
| `fixtures:<domain>` (`fixtures:finance`, `fixtures:health-insurance`, `fixtures:genomics`, `fixtures:supply-chain`, `fixtures:marketing-analytics`) | `ts-node ../docker/postgres/generate/<domain>.ts` | Regenerate a synthetic domain sample's seed SQL (and its planted facts, for the domains written for BA-9) from its fixed seed; byte-identical on every run, and it fails when a planted trap drifts. Files: [data-model.md](data-model.md) 4.10. |
| `fixture:dump` | `ts-node scripts/dump-fixture.ts --fixture <id> [--database <db>] [--host …] [--port …] [--user …] [--password …]` | Export a loaded PostgreSQL sample to `scripts/fixtures/<id>/data/` (one gzipped compact JSON file, `<relation>.json.gz`, per required table and view, plus a plain `_meta.json`), the source of the REST server and the Databricks loader. Connects with the sample's default coordinates unless overridden. Format: [data-model.md](data-model.md) 4.10. |
| `fixture:databricks` | `ts-node scripts/setup-fixture-databricks.ts --fixture <world-cup\|finance\|marketing-analytics> [--dry-run [--full]] [--no-register \| --register-only] [--batch-rows <n>]` | Load a sample's JSON dump into a Databricks Unity Catalog schema (`evals.<schema>` by default), check its row counts, and register its datasource and dataset in a running backend, calling its HTTP API directly with no sign-in and no token; what it runs and checks is [testing-data](../capabilities/testing-data/spec.md) R24, R25 and R28. Environment: `DATABRICKS_HOST`; `DATABRICKS_HTTP_PATH` (the SQL warehouse's `/sql/1.0/warehouses/<id>`) or `DATABRICKS_WAREHOUSE_ID`; `DATABRICKS_TOKEN` (a token that can create schemas and tables in the catalog); `DATABRICKS_CATALOG` (default `evals`; any catalog works, since the references run in the dataset's catalog, [agents-evals](../capabilities/agents-evals/spec.md) R192); `DATABRICKS_SCHEMA` (default the sample's schema); `BACKEND_URL` (default `http://127.0.0.1:3000`), the backend it registers in. `--dry-run` needs none of them and connects to nothing. Idempotent. Run with a warehouse in the VDI: [docs/evals/databricks-vdi.md](../../docs/evals/databricks-vdi.md). |
| `worldcup:api`, `finance:api`, `marketing-analytics:api` | `ts-node scripts/worldcup-rest-api/serve.ts [--fixture finance\|marketing-analytics]` | Zero-dependency REST + OpenAPI server over a sample's JSON dump, for exercising the REST connector: World Cup on `127.0.0.1:55080` (the snapshot above), finance on 55081 and marketing analytics on 55082 (their `fixture:dump` files). With no switch it answers as it always did; the switches are under *The fixture REST API* below. |
| `worldcup:rest:setup` | `ts-node scripts/setup-worldcup-rest.ts` | `fixture:rest:setup` with its World Cup defaults, kept for existing docs (`WORLD_CUP_API_URL` still works). |
| `fixture:rest:setup`, `finance:rest:setup`, `marketing-analytics:rest:setup` | `ts-node scripts/setup-fixture-rest.ts [--fixture <id>] [flags]` | Registers a running fixture REST API as a `rest` datasource and a dataset in a running backend through its HTTP API, called directly with no sign-in and no token; one datasource per server variant; idempotent. Flags under *The fixture REST API* below. |
| `build:web` | `npm --prefix ../frontend run build:web && node scripts/copy-web.js` | Build the UI and copy it to `backend/public/` (gitignored). `copy-web.js` fails if the frontend build has no `index.html`. |
| `build:all` | `build` then `build:web` | Everything the npm package needs. |
| `prepack` | `build:all && node scripts/assert-publishable-brand.js` | `npm pack` / `npm publish` always ship a fresh UI, and fail unless its brand (`backend/public/brand.json`) has `publishNpm: true` in `frontend/brands/<id>/brand.json`. |

### Repo scripts (`scripts/`, no root `package.json`)

The repo keeps no root `package.json`; its developer scripts are plain Node files run as `node scripts/<name>.mjs` (pure logic in `<name>-lib.mjs`, tests in `scripts/*.test.mjs`, run with `node --test scripts/*.test.mjs`).

| Command | Purpose |
|---|---|
| `node scripts/spec-index.mjs [--check]` | Writes `specs/INDEX.md` (section index with line ranges); `--check` exits 1 when it is stale. Roadmap 1.23.29, see 13. |
| `node scripts/story-pack.mjs <roadmap-id> [--out <file>]` | Writes `.context/story-packs/<id>.md`, the builder's starting brief. Roadmap 1.23.29, see 13. |
| `node scripts/qa.mjs …` | Deterministic QA, see 13. |
| `node scripts/demo-page.mjs <roadmap-id>` | Shareable demo page, see 13. |
| `node scripts/bootstrap.mjs` | Workspace bootstrap, see above. |
| `node scripts/fetch-duckdb-extensions.mjs <platform…> --out <dir>` | Downloads DuckDB's `excel` extension, see "DuckDB's `excel` extension" below. Roadmap 1.31.2. |

### The fixture REST API: switches, variants and setup

Added 2026-10-13 (BA-187). `scripts/worldcup-rest-api/serve.ts` serves one sample's JSON dump under one set of switches per process: one process is one *variant*. Each switch is an environment variable or the flag of the same name (`REST_API_PAGING=cursor` or `--paging cursor`); a flag beats its variable, and a variable beats the profile. The logic and its unit tests: `scripts/worldcup-rest-api/rest-fixture.ts` and `rest-fixture.spec.ts`.

| Variable / flag | Values (default) | What the server does |
|---|---|---|
| `REST_API_FIXTURE` / `--fixture` | `world-cup` (default), `finance`, `marketing-analytics` | Serves `scripts/worldcup-rest-api/data/*.json` or `scripts/fixtures/<id>/data/*.json.gz` ([data-model.md](data-model.md) 4.10). Endpoints are `/api/<schema>/<relation>` (schema `world_cup`, `finance` or `marketing_analytics`), tagged with the schema in the OpenAPI document, so the connector keys them `api.<schema>.<relation>`, the names the SQLite references read. |
| `REST_API_PORT` / `--port` | 55080, 55081 or 55082 by fixture | `WORLD_CUP_API_PORT` still works. |
| `REST_API_PAGING` / `--paging` | `page` (default), `offset`, `cursor`, `next-url` | `page`: `?page=&per_page=` returns `{ data, page, per_page, total }`. `offset`: `?offset=&limit=` returns `{ data, offset, limit, total }`. `cursor`: `?cursor=&limit=` returns `{ data, next_cursor }`, null on the last page, no total. `next-url`: `?page_token=&limit=` returns `{ data, next }`, the absolute URL of the next page, as OData's `@odata.nextLink` or Django REST's `next`. A cursor or page token the server did not issue is a 400. |
| `REST_API_PAGE_SIZE` / `--page-size` | none: 100 per page, at most 500 | Rows per page, and the most one request gets whatever it asks for (1 to 500). |
| `REST_API_NESTED` / `--nested` | `0` | `1` adds one endpoint whose rows hold objects, built from the dump: World Cup `matches_nested` (`venue`, `home.team`, `away.team` and `winner` as objects, two levels deep), finance `accounts_nested` (`customer`, `account_type`, `branch.region`), marketing analytics `campaign_results_nested` (`campaign`, `funnel`). |
| `REST_API_WRAPPED` / `--wrapped` | none | Comma-separated endpoints whose rows and page fields sit under `result` (`{ result: { items, … } }`) instead of at the top. |
| `REST_API_REFUSE` / `--refuse` | none | Comma-separated endpoints that answer 503 with `{ error }`. |
| `REST_API_RETRY_AFTER` / `--retry-after` | none | Seconds sent as `Retry-After` with each 503. Off by default: the backend's global `fetch` honours it, so `120` stalls every request to the endpoint for two minutes ([evidence/1.1.9/](../../evidence/1.1.9/)). |
| `REST_API_TOKEN` / `--token` | none | A bearer token every `/api` request must carry, checked first; without it, 401 with `WWW-Authenticate: Bearer`. `/`, `/openapi.json` and `/docs` stay public, and the OpenAPI document declares the bearer scheme. |
| `REST_API_PROFILE` / `--profile` | none | A named set of the switches above. `connector` (World Cup only): pages of 20, `matches_nested`, `tournament_teams` wrapped, `squad_members` refused, the token `world-cup-test-token`, and, for the setup script, a datasource cap of 20 rows on `match_team_statistics`. |

An unknown fixture, profile or paging style, a wrapped or refused endpoint the sample does not serve, or a page size outside 1 to 500 stops the server with a message. `GET /` lists the endpoints, their row counts and the switches (never the token); the setup script reads it.

The eval variants of [agents-evals](../capabilities/agents-evals/spec.md) R164 to R169 run on ports 55090 and up, clear of the defaults:

```bash
cd backend
REST_API_PROFILE=connector REST_API_PAGING=page     REST_API_PORT=55090 npm run worldcup:api
REST_API_PROFILE=connector REST_API_PAGING=offset   REST_API_PORT=55091 npm run worldcup:api
REST_API_PROFILE=connector REST_API_PAGING=cursor   REST_API_PORT=55092 npm run worldcup:api
REST_API_PROFILE=connector REST_API_PAGING=next-url REST_API_PORT=55093 npm run worldcup:api
npm run finance:api                 # 55081
npm run marketing-analytics:api     # 55082

npm run fixture:rest:setup -- --api-url http://127.0.0.1:55092 --variant cursor
npm run fixture:rest:setup -- --api-url http://127.0.0.1:55093 --variant next-url --allow-unavailable
npm run finance:rest:setup
npm run marketing-analytics:rest:setup
```

`scripts/setup-fixture-rest.ts` (tests: `setup-fixture-rest.spec.ts`) reads the API's `/`, checks its token with one request, then calls the backend directly, with no sign-in and no token: it takes the endpoints from the backend's OpenAPI discovery (`POST /datasources/rest/discover`, what the Discover button calls), adds row caps, saves the datasource, refreshes its inventory and saves a dataset of every endpoint. It upserts both by name.

| Flag | Variable | Default | Meaning |
|---|---|---|---|
| `--api-url` | `REST_API_URL`, `WORLD_CUP_API_URL` | the fixture's port on 127.0.0.1 | The API to register. |
| `--fixture` | | what the API serves | `world-cup`, `finance` or `marketing-analytics` (or the `-rest` id). The setup fails when the API serves another; the REST sample `<id>-rest` of the fixture registry gives the names. |
| `--variant` | | none | Appended to the names: datasource "World Cup REST API (cursor)", dataset "World Cup (REST cursor)". No commas, because `EVAL_DATASETS` is comma-separated. Without it, the registry's names. |
| `--api-token` | `REST_API_TOKEN` | the profile's token | Saved as the datasource's bearer token. |
| `--max-rows <endpoint>=<n>` | | the profile's caps | Repeatable or comma-separated: the endpoint's `maxRows` on the datasource. |
| `--allow-unavailable` | | off | Keeps endpoints the inventory cannot read (the `next-url` variant) instead of failing. Refused endpoints are always expected unreadable and kept with no columns; a refused endpoint the inventory could read fails the setup. |
| `--backend-url` | `BACKEND_URL` | `http://127.0.0.1:3000` | |

Besides the caps asked for, the setup gives an endpoint with more rows than the connector's default cap (10,000) a `maxRows` of its row count, and gives a page or offset endpoint whose rows need more than the connector's 50 pages a bigger page, up to the server's maximum: marketing analytics `policy_sales` (10,822 rows) gets `maxRows` 10,822 and pages of 217. What still cannot be read whole is printed as a warning.

### Improvement loop

Added 2026-10-20 (BA-242, roadmap 1.1.20). Developer tooling for the supervised improvement loop of [the BA-9 plan, section 3.6](../../docs/plans/BA-9.md#36-the-improvement-loop), run from a worktree of the repository; nothing here is part of the app or its releases. A person decides every change: the supervisor (the user with the lead Claude Code session) picks the slice and the lever, a **fixer** session proposes one change, and the user accepts it or the lead reverts it. Since 2026-10-21 the lead reverts on its own a round that fails the accept rule's conditions on held-out, on categories going down or on cost, and the user decides each round that meets them, keeping a change whose target did not rise as the new baseline (`kept`) or one that meets the whole rule (`accepted`). The runbook (roles, the split rule, the levers and what is forbidden, the round steps with their commands, the accept and stop rules, the budget) is [docs/evals/loop/program.md](../../docs/evals/loop/program.md), with its log [docs/evals/loop/results.tsv](../../docs/evals/loop/results.tsv) and the leak check's allowlist [docs/evals/loop/leak-allowlist.txt](../../docs/evals/loop/leak-allowlist.txt); the project skill [`eval-loop`](../../.claude/skills/eval-loop/SKILL.md) (section 10) walks a round, and the tool [`eval-loop`](../../.claude/tools/eval-loop/README.md) (section 11) isolates the fixer.

- **Working folder.** `.eval-loop/` at the worktree root, gitignored and regenerated from runs: `data/<set>/` (the loop's own data directories, one per set since 2026-10-21 so the three sets run at once, each the `APP_DATA_DIR` of its set's runs, so the loop never touches `~/.questions-to-insights` or `backend/data`; `data/gpt-4o-mini/` keeps the first model's single data directory), `build/<round>/backend/` (a snapshot of one build per round, from which every eval of the round runs: a later `nest build` clears `dist/` and must never change a running round; it holds copies of `dist/`, `public/` (the web UI, for starting the app from the snapshot to load the samples) and `package.json` (read by `cli.js`), with `node_modules` linked), `runs/r<round>-<set>.json` (`EVAL_RUN_FILE` of each run) with the run's printed output beside it as `runs/r<round>-<set>.log`, `exports/<round>/` (the round's failure export, R228, which `start-fixer.sh` copies from), and `fixer/<round>/` (below).
- **Runs.** The three sets at once, each from its own data directory, never two runs at once on one data directory (they share its database, agents-evals R223): `APP_DATA_DIR=.eval-loop/data/<set> EVAL_DATASETS=… EVAL_SET=<set> EVAL_REPEATS=3 EVAL_JUDGE=off EVAL_RUN_FILE=.eval-loop/runs/r<N>-<set>.json`, then `eval:diff` between the rounds' runs (R225 to R227). The model is gpt-5.6-luna at low reasoning effort (gpt-4o-mini until 2026-10-21), set in each data directory.
- **Fixer isolation.** `.claude/tools/eval-loop/start-fixer.sh <round> [--export <dir>] [--lever "<lever>"] [--target <categories>] [--allow-dirty] [--headless [--max-budget-usd <n>]] [--dry-run]` adds a detached worktree, `git worktree add --detach .eval-loop/fixer/<round>/tree HEAD` (no branch), so the fixer starts from `HEAD`: it refuses while the lever files (R229) have uncommitted changes, unless `--allow-dirty` is given, since the tree would lack them and the run would not match the code. It deletes from the tree's working copy (never committed) every path that carries held-out content: `backend/src/mastra/evals/` (sets, checks and harness), `backend/scripts/fixtures/`, `docker/postgres/`, `specs/capabilities/agents-evals/`, `docs/evals/domains/`, `docs/research/`, `docs/plans/`, `evidence/`, `frontend/e2e/`, and `roadmap.md`, `proposals/`, the leak check's allowlist and any `dist/`; then any other file that names a held-out case id or quotes a held-out question (`.claude/tools/eval-loop/held-out-scan.mjs`; a lever file that does stops the start). It copies the round's failure export (R228; `--export`, else `.eval-loop/exports/<round>/`) to `.eval-loop/fixer/<round>/export/` and starts `claude` inside the tree: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude --settings <absolute path of .claude/tools/eval-loop/fixer-settings.json> --tools Read,Edit,Write,Glob,Grep --permission-mode acceptEdits --strict-mcp-config --add-dir .eval-loop/fixer/<round>/export -n "eval-loop fixer <round>" --append-system-prompt "<the fixer's role>" "<the round, its lever and target, and the export's path>"`. With `--headless` (added 2026-10-21; how the lead runs it) the same command runs in print mode, `-p --output-format stream-json --verbose --no-session-persistence --max-budget-usd <n>` (default 5), so a permission it would ask for is refused and no session is saved; its transcript is written to `.eval-loop/fixer/<round>/fixer.jsonl` and its final report to `report.md`. No Bash, because the read and edit rules do not stop a `node` or `python` subprocess; no MCP server (`--strict-mcp-config` with no `--mcp-config`, so none of the account's connectors; and `mcp__ide` denied, since that flag does not remove the `ide` server VS Code gives a session started in its integrated terminal, which can run code); and no auto-memory (the variable, and `autoMemoryEnabled: false` in the settings), since the lead's memory may name held-out cases. `fixer-settings.json` is the second layer: deny rules that forbid editing `**/src/mastra/evals/**`, `**/scripts/**`, `**/docker/**`, the testing-data fixtures' SQL and `registry.ts`, `**/docs/**`, `**/specs/**`, `**/.claude/**`, the package and lock files, `**/.gitignore`, `**/*.spec.ts`, `**/__fixtures__/**`, `**/backend/test/**`, `**/frontend/**`, the model routing files (`model-resolver.ts`, `model-compat.ts`, `effort-levels.ts`, `agent-constants.ts`) and `**/src/modules/llm/**`, and reading the held-out paths above, `**/dist/**`, `**/.eval-loop/runs/**`, `**/.eval-loop/data/**`, `~/.questions-to-insights/**` and `~/.claude/projects/**` (the lead's auto-memory and session transcripts). The rules are written as `**/` patterns, which cover the tree, and, for the Read rules, also as `//**/` patterns, which cover the same paths anywhere on the disk (a `/` rule is anchored at the settings file's folder). No absolute rule may name `.claude`: the tree sits under `.claude/worktrees/`. A unit test holds the deny list to every path the loop must protect, and a headless `claude -p` smoke run checks that Claude Code applies it (section 11). `.claude/tools/eval-loop/collect-fixer.sh <round>` writes the tree's change to the lever files (R229) as `.eval-loop/fixer/<round>/change.patch` and removes the worktree; the lead runs `eval:leak-check --diff-file` on the patch, applies it with `git apply`, rebuilds, snapshots and runs the target slice (`EVAL_SPLIT=dev EVAL_CATEGORY=<category>`), then the full run. An accepted change is committed with its `eval:diff` output; a rejected one is reverted with `git restore`.
- **Levers.** One per round: the assistant's prompt, tool descriptions and error messages, the context blocks, and the knowledge seeds of the domain samples (`backend/src/modules/testing-data/fixtures/knowledge/`); the World Cup sample stays unseeded, since its sets are the team's gate. A changed knowledge seed reaches the loop's data directory only when its sample is loaded again, and a load keeps an entry of the same kind and title, or a metric of the same name, as it is ([testing-data](../capabilities/testing-data/spec.md) R26), so the entries the change touches are deleted first. Never the sets, checks, thresholds, model, effort, step budget, fixtures, facts, harness, specs or tests; when a change is accepted the supervisor updates the specs and tests it affects (such as [agents.md](agents.md) Appendix A).

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

**Preparing a fresh checkout or worktree (roadmap 0.5.5).** `node scripts/bootstrap.mjs [--force] [--no-build] [--no-playwright]` (Node 22+, no dependencies) runs `npm ci --legacy-peer-deps` in `backend/` and `frontend/` at once (the same flags as CI; a package whose `node_modules/.package-lock.json` is newer than its lockfile is skipped unless `--force`), then installs Playwright's Chromium and runs `npm --prefix backend run build:all` side by side, logging each step to `.qa-reports/bootstrap/<step>.log`. It ends by reporting whether Postgres answers on 55432 and whether Docker runs, and prints the command that starts it; it never starts the app or the compose stack. Every peer dependency the build needs is a direct dependency (the frontend lists `@floating-ui/dom`, the peer of `@tiptap/suggestion`), because `--legacy-peer-deps` skips peers. The repository's Conductor settings (`.conductor/settings.toml`) run it as the workspace setup script and add a **web** action that starts the CLI on the workspace's `CONDUCTOR_PORT` with the data dir `.context/qti-data`.

**Configuring a local instance for hand testing (BA-325).** `scripts/setup-local.mjs [baseUrl]` (default `http://127.0.0.1:3000`, Node only, no dependencies) configures a running instance through its own API:

- **LLM:** saves `PUT /llm/settings` from `.env.llm.local`: `LLM_PROVIDER` (default `custom`), `LLM_API_STYLE` (default `anthropic`), `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. The file is read from the checkout, else from the main checkout (through `git rev-parse --git-common-dir`), so a worktree needs no copy; environment variables win over it. It is gitignored (`*.local`); [.env.llm.example](../../.env.llm.example) is the committed template. Without `LLM_BASE_URL` and `LLM_MODEL` this step is skipped.
- **Testing Data:** loads every seedable fixture with its defaults, and the World Cup Excel sample (a `file` fixture: no connection, an empty body) (`POST /testing-data/:id/load`, [api.md](api.md) 56); a fixture already loaded is skipped, so a re-run is safe. Tests: `node --test scripts/setup-local.test.mjs`.

It exits non-zero when any step fails. It writes to the sample Postgres the fixtures name (127.0.0.1:55432 by default), creating their databases if missing.

### DuckDB's `excel` extension (ADR-0052, roadmap 1.31.2)

Importing `.xlsx` files needs DuckDB's `excel` extension, and DuckDB would install it from the internet on first use. The app never does: it ships the file and loads it by path (datasources R58).

- **Where it lives.** `<backend root>/vendor/duckdb-extensions/v<version>/<platform>/excel.duckdb_extension`, `<platform>` being DuckDB's name (`windows_amd64`, `osx_arm64`, `osx_amd64`, `linux_amd64`). `excelExtension()` (`backend/src/modules/datasources/connectors/excel-extension.ts`) builds the path from the loaded DuckDB library's own `version()` and `process.platform`/`process.arch`, four levels above its own directory (the backend root from `src/`, `dist/` and the bundle alike, since the bundle keeps `__dirname` meaning the module's place in `dist/`). A missing file throws `Excel support is missing from this installation (DuckDB <version>, <platform>)`.
- **Where it comes from.** `node scripts/fetch-duckdb-extensions.mjs <platform…> --out <dir>` (Node built-ins only) reads the DuckDB version from `backend/package-lock.json` (`node_modules/@duckdb/node-bindings`, the `-r.N` suffix stripped), downloads `https://extensions.duckdb.org/v<version>/<platform>/excel.duckdb_extension.gz`, gunzips it into `<dir>/v<version>/<platform>/`, keeps a file already there with the same size and fails on any status but 200. Development: `scripts/bootstrap.mjs` fetches the host platform into `backend/vendor/duckdb-extensions/` (git-ignored). Installer: `frontend/scripts/stage-backend.sh` fetches `windows_amd64` (plus the host platform when staging elsewhere) into the staged backend's `vendor/duckdb-extensions/`, after bundling and pruning, which touch only `dist/` and `node_modules/`. npm package: `prepack` and `publish-npm.yml` (which publishes with `--ignore-scripts`) fetch all four platforms into `backend/vendor/duckdb-extensions/`, which `files` publishes.
- **Version check.** A DuckDB upgrade must be followed by a new fetch, because the path carries the version. `excel-extension.spec.ts` fails when the lockfile's DuckDB version differs from the loaded library's `version()`, and with the extension present reads a workbook with no `INSTALL`.

### Verification gate (what must be green before a change ships)

| Where | Commands |
|---|---|
| `frontend/` | `npm test`, `npm run build`, `npm run test:e2e` |
| `backend/` | `npm test`, `npm run build`, lint on the files you touched, and `npm run test:e2e` |

`node scripts/qa.mjs <roadmap-id> --gate` runs these for a story, with the story's step-6 Playwright list, and writes `evidence/<roadmap-id>/tests.md`; `--fast` runs the per-story subset for a plain session or an S change and records the demo (section 13).

`test:e2e` builds the backend with the web UI and drives the web app; its global setup starts the World Cup Postgres itself (see section 6). The desktop target (`test:e2e:desktop`) runs only when a desktop run is requested, and refuses to launch the app if port 3000 is taken. Which target to test, and how skipped desktop-only scenarios are reported, is the *Test target convention* in the [`workflow-gate`](../../.claude/skills/workflow-gate/SKILL.md) project skill (section 10).

A change to what an agent receives (its prompt, skills, tools, context blocks or model routing) also needs its eval set at 100% on the branch, every question 3 of 3, with a run on the base commit beside it (`evals:assistant`, section 1; the [`verify`](../../.claude/skills/verify/SKILL.md) project skill). The BA-9 epic's PR has the one exception, a comparison with `main` on the beta's Claude model, decided by the user on 2026-10-26 ([specs/epics/BA-9/spec.md](../epics/BA-9/spec.md), *Dependencies, risks and open questions*).

## 3. Desktop packaging (electron-builder)

Configuration lives in the `build` block of `frontend/package.json`.

| Setting | Value |
|---|---|
| `appId` | `com.halopowered.questions-to-insights` (halo); `electron-dist.mjs` overrides it from the selected brand's `brand.json` (mercer: `com.halopowered.agentic-hub`) |
| `productName` | `Halo Workbench` (halo); the brand's `osName` (mercer: `Agentic Hub`) |
| `artifactName` | `Halo-Workbench-${version}-${os}-${arch}.${ext}`, for example `Halo-Workbench-0.65.0-win-x64.exe` (releases before ADR-0046: `Questions-to-Insights-…`); mercer: `Agentic-Hub-${version}-${os}-${arch}.${ext}` |
| Output | `frontend/release/` (gitignored) |
| Build resources / icon | `frontend/build/` (now only `installer.nsh`); the icon is `brands/<id>/public/brand/icon.png` (`brands/halo/…` in the config, also set for `mac` and `win`; `electron-dist.mjs` swaps in the brand's) |
| Packaged files | `dist/frontend/**`, `electron/**` except `electron/**/*.test.cjs` (the shell's `node --test` unit tests), `package.json` |
| macOS | category `public.app-category.productivity`; `.dmg` for arm64 and x64 |
| Windows | NSIS `.exe` for x64, electron-builder's default one-click per-user installer: it silently runs the previous version's uninstaller (keeping app data) before installing. `build/installer.nsh` (picked up automatically from build resources) defines `customCheckAppRunning`: electron-builder's usual check (asks to close a running app) runs first, then `taskkill /F /T` ends every app executable (`${APP_EXECUTABLE_FILENAME}`, "Halo Workbench.exe" for halo) the current user still runs, such as an orphaned backend, so no file in the install folder stays locked. The installer and the uninstaller both run it. |
| Signing | none: CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and produces unsigned artifacts |

**Backend staging** (`frontend/scripts/stage-backend.sh`): runs `npm run build` in `backend/`; recreates `backend/release-staging/` (gitignored); copies in `dist/`, `package.json` and `package-lock.json`; then runs `npm ci --omit=dev --ignore-scripts --legacy-peer-deps --no-audit --no-fund` there. Production dependencies only; install scripts are skipped, so the native modules come from their prebuilt binaries.

Then `frontend/scripts/bundle-backend.mjs` bundles the backend (roadmap 1.7.23). esbuild (a backend devDependency) turns `dist/main.js` and every pure-JS dependency it reaches into one CommonJS file, `dist/main.js` again (`keepNames` on, so Nest and the loggers see the real class names). In first-party code, `__dirname` and `__filename` are rewritten to the module's original place under `dist/`, and every non-code file of the tsc output (skills, fixtures) is copied back with its layout, so the code finds its assets as before. `node_modules` then keeps only the packages that cannot be bundled, with everything they depend on (resolved the way Node does): native addons (`better-sqlite3`, `@duckdb/*`, `libsql`, `@libsql/*`, `@databricks/databricks-sql-kernel*`, `lz4-napi`, `@antoniomuso/*`), `@github/copilot-sdk*` (reads its own files, spawns its binary), `pino` (worker-thread transports), packages that read their own data files through `__dirname` (`pdfkit`, `fontkit`, `@tootallnate/quickjs-emscripten`), and `undici` (required by name at runtime through `createRequire`). Two bundled packages keep a stub folder with only their `package.json` and the data file they resolve at runtime: `@mastra/core` (`dist/provider-registry.json`) and `@mastra/observability` (`dist/metrics/pricing-data.jsonl`). The licence texts of the bundled packages go into `dist/THIRD_PARTY_LICENSES.txt`. The build fails when an installed package ships a `.node` addon outside that list. Tests: `node --test frontend/scripts/bundle-backend.test.mjs`.

Last, `frontend/scripts/prune-node-modules.mjs` deletes build-time leftovers from what is left of `node_modules` (roadmap 1.7.22): type declarations (`*.d.ts`, `*.d.mts`, `*.d.cts`), TypeScript sources (`*.ts`, `*.mts`, `*.cts`), source maps (`*.js.map` and the like, never a bare `.map`), docs (`*.md`, `*.mdx`, `*.markdown`), lint and CI configs (`.eslintrc*`, `.nycrc*`, `.prettierrc*`, `.editorconfig`, `.travis.yml`, `.npmignore`, `.gitattributes`, `.jshintrc`, `.babelrc`) and `__tests__/` and `.github/` folders. Licence files (`LICENSE*`, `LICENCE*`, `NOTICE*`, `COPYING*`) are kept, and `@github/copilot-sdk*` is left whole because its bundled runtime reads its own `.md` and `.ts` files. Install time on Windows grows with the file count: pruning halved it (0.48.1: 46,955 installed files before, 22,906 after), and bundling cuts the rest by about 87% (0.61.0, a local `--win nsis` build: about 21,300 installed files with pruning alone, 2,844 with bundling, 2,765 of them the backend's).

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
| Tarball contents | `files`: `dist`, `!dist/**/*.tsbuildinfo`, `public`, `vendor/duckdb-extensions` (DuckDB's `excel` extension for all four platforms, section 2). No `src/`, `test/`, `scripts/`. The sample seed SQL ships inside `dist` (about 8.4 MB uncompressed, 5.2 MB of it the gzipped Formula 1 dump; the five synthetic domain seeds are 3.2 MB of plain SQL, which the tarball's own gzip compresses); the generators, planted facts and JSON dumps do not ([data-model.md](data-model.md) 4.10). |
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

**Data layout the CLI creates** under the data dir: `app.sqlite`, `mastra.sqlite`, `observability.duckdb`, `workspaces/`, `.app-secret` (see [data-model.md](data-model.md) and section 1). The native modules (better-sqlite3, DuckDB, LibSQL) arrive as prebuilt binaries; if npm starts compiling them, the Node version is unsupported or a toolchain is missing.

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

Manual: Actions → Build desktop installers → Run workflow. A hand-pushed `v*` tag also triggers it. It builds and publishes **only Windows x64 installers** (BA-302), by default one per brand (Halo Workbench and Agentic Hub); macOS `.dmg` files can still be built locally with `electron:dist` (section 2) but CI no longer builds them.

| Input | Default | Meaning |
|---|---|---|
| `ref` | empty | Tag, branch or SHA to build; empty = the branch the run was started from |
| `publish` | false | Attach the Windows installers to the GitHub release for the resolved tag |
| `brand` | `both` | The brands to build: `both` (halo and mercer, one build job each, both installers on the same release), `halo` or `mercer` (ADR-0045); a `v*` tag push has no inputs and builds both |

`prepare` fails on a brand without `frontend/brands/<brand>/brand.json` and emits one matrix entry per brand, carrying the brand and appending it to the artifact and job names (`questions-to-insights-windows-x64-<brand>`); each `build` job sets its entry's brand as `BRAND` for `electron:dist`, so the installer is `Halo-Workbench-*.exe` or `Agentic-Hub-*.exe`.

Jobs:

1. **`prepare`** checks out the ref with full history and tags, emits the build matrix (`{"include":[…]}`): Windows x64 (runner `windows-2022`, NSIS `.exe`) once per selected brand, and resolves the tag:
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

Steps: check out the ref; Node 22 with the GitHub Packages registry and scope; read `name@version` from `backend/package.json`; **refuse an already-published version** (`npm view`; success means it exists → fail with a readable message, `E404` means free, any other failure is fatal; skipped on dry runs, because GitHub Packages answers a re-publish with a bare 409); `npm ci --legacy-peer-deps` in `frontend/` and `backend/`; explicit `npm run build:all` with `BRAND=halo`; a step running `node scripts/assert-publishable-brand.js` (fails unless `backend/public/brand.json` names a brand whose `brand.json` has `publishNpm: true`; only halo does, so the Agentic Hub brand is never published to npm); `npm publish --ignore-scripts` (so `prepack` does not rebuild and the tarball is exactly the logged build, which is why the guard is its own step). Auth is `GITHUB_TOKEN` (`packages: write`); the `repository` field in `backend/package.json` links the package to this repo, so no personal token is needed. The run summary prints `name@version` and the `.npmrc` + `npx` install commands.

### `spec-checks.yml` — Spec checks

Runs on every pull request, on every push to `main`, and on manual dispatch. It is the only pull-request check. It checks out the repo and runs `python3 scripts/check-specs.py` (standard library only, no install step, about one second). It fails the run when `specs/` drifts from the code:

| Check | Fails when |
|---|---|
| Layout | a product or system spec is missing, or the capability or epic tables in `specs/README.md` don't match the folders on disk |
| Links | a relative link in `CLAUDE.md`, `README.md`, `roadmap.md`, any spec, any project skill (`.claude/skills/*/SKILL.md`), `.claude/worker.md` or any tool README (`.claude/tools/**/*.md`) doesn't resolve. `changelog.md` and `retrospective.md` are skipped, because their past entries are never rewritten. |
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
| Readiness row cap (tests only) | 100,000,000 rows: tables above it are not column-profiled (ADR-0033) | `READINESS_MAX_PROFILED_ROWS` (positive integer), read per assessment; the E2E sets it low to exercise the `too-large` path on the sample tables |
| Sample Postgres | project `questions-to-insights-world-cup`, port 55432 | `docker compose -p <name>` plus `WORLD_CUP_DB_PORT=<port>`; the e2e fixtures read the same variable (and `WORLD_CUP_DB_HOST`) |
| Fixture REST APIs | 55080 (World Cup), 55081 (finance), 55082 (marketing analytics) | `REST_API_PORT` or `--port`; the eval variants use 55090 and up, and the setup script's `--api-url` points at them (section 2, *The fixture REST API*) |
| Observability profile | same project; ports 6006, 3001, 4317, 4318 | `docker compose -p <name>` plus `PHOENIX_PORT`, `GRAFANA_PORT`, `OTLP_GRPC_PORT`, `OTLP_HTTP_PORT` (see *Observability profile* above) |
| Playwright | needs port 3000 free | one e2e run at a time per machine; each test already gets its own temp profile |

The project rule: when work happens in a worktree, ask which target (shared or isolated) before starting the app or the Compose stack. See the [`local-instance`](../../.claude/skills/local-instance/SKILL.md) project skill.

## 8. The product page (`site/`)

A separate, static deliverable: the public page for the app, a section of the Halo Powered Labs site. Not part of the app or its releases.

| Item | Detail |
|---|---|
| Content | Plain static HTML/CSS in `site/public/` (no build step, no framework), styled with the Labs design tokens; screenshots in `public/shots/` |
| Hosting | Cloudflare Pages project `halo-bi-assistant` (`halo-bi-assistant.pages.dev`), custom domain `bi-assistant.halo-powered-labs.com` |
| Scripts | `scripts/dev.sh` (local on :4500 via `wrangler pages dev`), `deploy.sh` (publish; needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, optional `CF_PAGES_PROJECT`), `domain.sh` (attach the domain), `protect.sh` (optional Cloudflare Access lock) |
| Download routes | Pages Functions: `/download/win-x64` (Halo Workbench: `Halo-Workbench-*` or the older `Questions-to-Insights-*`), `/download/agentic-hub-win-x64` (Agentic Hub: `Agentic-Hub-*`), `/download/mac-arm64` and `/download/mac-x64` (Halo, older releases) redirect to the newest published installer of that edition and platform, matched by file-name prefix and platform suffix. The page links the two Windows routes, one button per edition (ADR-0045, ADR-0046); the macOS routes stay, unlinked, for old links and serve v0.13.1, the last release with macOS installers; `/api/latest` returns JSON (version, file sizes) for the page. A new release needs no site edit. |
| Private-repo trick | The repo is private, so `releases/download/…` 404s publicly. The Function asks the GitHub API for the asset with `Accept: application/octet-stream`, takes the credential-free short-lived `Location`, and redirects the browser to it; the token never leaves the edge. Per platform it picks the newest release that carries that installer, so a Windows-only release leaves the macOS routes on the last release that had them. |
| Secret | `GITHUB_TOKEN` (fine-grained PAT, Contents: read-only, scoped to this repo; expires within a year) set with `wrangler pages secret put`. Without it both routes answer 503 and the page shows static copy with buttons marked unavailable. |
| Screenshots | Re-shot from the real app (web mode, scratch data directory) against the World Cup demo fixture after two real runs (Answer a Business Question, Assess Data Readiness), with `site/scripts/screenshots/capture.mjs` (see `site/README.md` for the full procedure). |
| Skill | The project skill `deploy-labs-site` covers publishing or redeploying it. |

The page presents the product as Halo Workbench (ADR-0046). Installers are named `Halo-Workbench-<version>-<os>-<arch>.<ext>` (before ADR-0046, `Questions-to-Insights-…`) and `Agentic-Hub-<version>-<os>-<arch>.<ext>`; the resolver matches each edition's prefixes plus the platform suffix, so the old Halo names still resolve and the editions never pick each other's file.

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

Opens a **Workflow** pane (the right-hand sidebar in a wide fullscreen terminal or the desktop app, a framed region above the prompt otherwise) that shows the strict development workflow (the [`workflow-strict`](../../.claude/skills/workflow-strict/SKILL.md) skill) as a **task queue inferred from tool calls**. Nothing is asked of Claude and no prompt is changed: the mod watches every tool call, maps the file or command to a step, and moves the queue itself.

- **Steps.** At session start, and whenever `/workflow` runs, it takes the `## Workflow` section of `.claude/skills/workflow-strict/SKILL.md` in the working directory, or of `CLAUDE.md` when the skill is missing or has none (roadmap 0.6.5), and parses the steps (`<n>. **<title>** — <description>`); the pane says `From workflow-strict` or `From CLAUDE.md`. The mandatory first action (the `MANDATORY FIRST ACTION — …` line) is read from anywhere in `CLAUDE.md`. When neither file has a `## Workflow` section, a built-in copy of the eleven steps is used and the pane says `Workflow not readable here: built-in copy.`
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
- **Rows.** Every row is `#n`, title, `step s`, the agent, duration, tokens, cost, a completion bar with its %, `▸` (`▾` while open) and the task's summary, dim. The agent is `main`, or `main +<k>` when the task spawned subagents; a queued step shows the agent it is expected to use, as `~main` (`~main+sub` for steps 7 and 8, where the strict workflow fans independent units out to subagents). A step-9 task's row marks its last test `✓ passed` or `✗ failed` after the %, or, when the row has no room for that, draws the % in green or red. Running: the same plus one indented line per subagent spawned during the task (`↳ <type> · <model> · "<description>"`, `● running` until the subagent's own run ends) while its detail is closed. Tentative: as running, with `#n?`. Queued: every step above the highest step started, in workflow order, numbered from the next free sequence number (one later while a tentative task holds, which takes the step it is for out of the list), with no duration, tokens or cost. Steps below the highest started that never had a task are listed as `no signal yet`. When more than twelve tasks are done, the earlier ones fold into `… <k> earlier tasks · <tokens> · $<cost>`. The header shows the running task, the queued count, the session's tokens and cost, and `overall <p>%`: the mean completion of the done, running and queued rows (folded rows included; the tentative row and steps with no signal left out).
- **Summary.** Built from the task's own calls, in this order, joined with ` · `: the files it edited (`Edited roadmap.md ×2, ui.md`), the files shell commands named (`Shell scratch.md`), the test and build commands it ran (`Ran npm run test:e2e ×2`), its questions (`1 question`), its reads and searches (`7 reads`), other calls (`2 other calls`), a step-9 task's last result (`last run passed`) and its subagents (`2 subagents`). A task with none says `no calls counted for this step` (its step's calls may all have gone to other steps, as a shell read of `retrospective.md` does); a queued step shows `Expected: ` and its step summary.
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
- **Commands.** `/workflow` re-reads the steps and opens (and focuses) the pane; Esc closes it. `/workflow reset` clears the queue and starts `#1` again, for a new change in the same session.
- A pane opened by the mod itself only appears in a terminal at least 144 columns wide (110 once the developer has opened it themselves); narrower, a toast says to run `/workflow`, which opens it at any width. A row is never wider than the pane, because a `Button` does not truncate its children: it always has the `#n`, a 16-column title, the % and the caret, then takes, while they fit, tokens, cost, the agent and the 8-cell bar, the title up to 28 columns, the step and the duration, the title up to 34, and finally the summary when at least 12 columns are left (about 110 columns in all). At 96 columns a row has every figure and a 32-column title, and the summary is read in the detail; in a 74-column sidebar it drops the step and duration columns.
- State lives in `$.state` for the session only (`steps`, `source`, `firstAction`, `queue`, `open`). Nothing is stored across sessions and nothing is written back to the repository.

## 10. Claude Code project skills (`.claude/skills/`)

Developer tooling for people who work on this repository in Claude Code, not part of the app or its releases. Epic [BA-119](../epics/BA-119/spec.md); merged from nine skills into four by roadmap 0.5.2 ([M0-5](../epics/M0-5/spec.md)); two workflows since roadmap 0.6.1–0.6.3 ([M0-6](../epics/M0-6/spec.md)).

**Two workflows (roadmap 0.6.1).** `CLAUDE.md` is a router: what the app is, the mandatory first action (read `lessons.md`), then five sections. *Non-negotiables* holds one line per rule both workflows share (never on `main`, specs change with the code, a local instance is ready to test, workflows start from Mastra's docs, the query inspector, repo-only planning, read and output rules, automatic versioning, the first line of every subagent brief), each naming the skill that carries it out, then bootstrap and *Choose the brand*. *Principles* points at `lessons.md` and `retrospective.md`, then lists the principles in five groups, one line each: when it applies, then the rule. *Core*: Laziness Protocol, Foundational Thinking, Redesign from First Principles, Attack the Premise, Subtract Before You Add, Minimize Reader Load, Outcome-Oriented Execution, Experience First, Exhaust the Design Space, Build the Lever. *Architecture*: Model the Domain, Boundary Discipline, Type System Discipline, Make Operations Idempotent, Migrate Callers Then Delete Legacy APIs, Separate Before Serializing Shared State. *Verification*: Prove It Works, Fix Root Causes, Sequence Work into Verifiable Units, Test Behavior Not Implementation, Explain the Number. *Delegation*: Guard the Context Window, Never Block on the Human. *Meta*: Encode Lessons in Structure. *Autonomy* holds when to stop and ask (the app or Postgres from a worktree), and that an explicit pause (a rule, a skill step that waits for the user, the user's instruction) wins over *Never Block on the Human*. *Writing the reply* holds the reply rules. *How to work* holds *Choose the workflow* and *Task skills* (its heading must not start with `## Workflow`: the `workflow-steps` mod would read it as the step list). The process documents and the model routing table follow. In a new session, after `lessons.md`, Claude reads `.context/workflow-mode` (`strict` or `free-style`, per workspace, git-ignored): when it exists, Claude names the mode in one line and goes on; otherwise it asks with one picker and writes the answer. It then loads the matching skill. "Switch to strict" or "switch to free style" rewrites the file and loads the other skill; going to Strict mid-change adds the roadmap story for the work already done. `builder` and `reviewer` skip the choice (they work from a brief).

| Workflow skill | Holds |
|---|---|
| `workflow-strict` | the eleven-step `## Workflow` list, the change sizes (S, M, L), decide-before-build, the story lane, wave check and acceptance gate, the Epic gate, and *Coming from Free style* |
| `workflow-free-style` | four steps: 1 Understand the goal, 2 Clarify (both `workflow-start`), 3 Implement changes (`workflow-implement`), 4 Run checks and fix until green (`qa.mjs --free`, and an agent's evals when its input changed; `verify`). The other strict steps are optional. It keeps a branch from `main`, Conventional Commits and true specs. |

The steps' conventions live in four step skills. Claude loads a skill before its steps start, and a developer can invoke any skill as `/<name>`.

| Skill | Steps | Holds |
|---|---|---|
| `workflow-start` | 1–5 | restating the goal and sizing it, clarifying questions, Planning convention, Epic gate (repo-only epics), Branching convention, Architecture convention (C4, ADRs), Spec convention (where facts go, Gherkin, CI coverage) |
| `workflow-implement` | 8 | Code rules, the lean builder lane |
| `verify` | wave check, 9 | `qa.mjs --wave` (agent-built stories), `--fast` (plain session, S change) and `--gate`, the eval bar (base vs branch, parallel runs), driving a running instance with Playwright |
| `workflow-gate` | 6, 7, 10, 11 | E2E impact analysis and test conventions, Test target convention, per-story evidence, the per-epic changelog entry and PR, the demo artifact, post-merge cleanup, the per-epic retrospective and `lessons.md` |

**Task skills.** A workflow decides which steps run; a task skill says how to do one kind of task inside them. Both workflows share them. They were playbooks (`.claude/playbooks/`, Markdown with no frontmatter, routed by a table in `CLAUDE.md`) until they became skills: a playbook cost the same context as a skill (its table row against a skill's `description`) and loaded the same way (`Read` against `Skill`), but needed a second index kept by hand and had no `/<name>`. A task skill's `description` says when it applies; Claude loads every one that matches the task and copies its steps into the todo list. A step that names a workflow step in brackets (`[Understand]`, `[Implement]`, `[Checks]`) fills that step. A task skill points at other skills' sections and `lessons.md` rather than copying them, and ends with what the reply reports. A task no skill fits follows the workflow's steps alone.

| Task skill | For | Holds |
|---|---|---|
| `mastra-workflows` | a new or changed Mastra workflow | Mastra's docs against the installed types, the reuse inventory, three approaches, the build rules, checks and hand-over |
| `agent-change` | a new agent, or a change to what an agent receives | the full *query inspector* rule, the eval decision and the eval run |
| `bug-fix` | a defect in shipped behaviour | reproduce with real traffic, flake rate, failing test first |
| `local-instance` | starting the app or the compose stack, for the user or a check | the only place that starts and stops an instance: ask the target (shared or isolated), ports, web-mode build, the default LLM and `setup-local.mjs`, stop by PID |
| `ship` | recording what shipped, the PR, post-merge cleanup | the order of `workflow-gate` steps 10 and 11 for each workflow |
| `visual-options` | options for a change that can be seen | three options drawn as wireframes on a real screenshot, one artifact per option |
| `show-the-change` | finishing any feature or change | screenshots of the running change with real data, axe, one artifact per image |
| `deploy-labs-site` | publishing a Labs product page | section 8 |
| `eval-loop` | one round of the supervised improvement loop (BA-242) | section 2, *Improvement loop* |

**The story lane (roadmap 1.23.28, [M1-23](../epics/M1-23/spec.md)).** It replaces the per-story fast loop for agent-built stories. A `builder` starts from its story pack, writes the code, its unit tests, for a UI story one Playwright scenario (`@demo @story-<id>`) and only the spec lines its change makes false, and runs only the related unit tests and its own Playwright file, with no axe scan, screenshots, evidence, demo or `qa.mjs` unless the brief asks. The lead merges the wave (the stories built in parallel) and runs one `qa.mjs --wave`, then hands over the running app, with a demo only for the wave's user-visible milestone. Evidence and demos are recorded per wave; the acceptance gate stays per epic. A plain session without a builder, and every S change, may run `qa.mjs <id> --fast` instead.

**Decide before you build.** Before an L epic, or an M feature whose end state is unclear, the lead shows a cheap prototype (an HTML mock or a sketch, at most 10 minutes, no spec, no ADR), then asks one batched confirmation per epic: spec, ADR, open questions with recommendations, and branch. A direction change afterwards is re-planned once.

**Gherkin once.** A flow's steps live in its Playwright test (`scenarioStep` lines). The capability spec keeps the Feature heading, its `E2E:` line and one `Scenario: <title>` line per scenario; `check-specs.py` checks each title exists in the named file (1.23.29). Existing Features keep their steps until edited.

**Model and effort routing** is the table in `CLAUDE.md` "Model usage", shared by both workflows (Opus for plans, ADRs and risky paths; Sonnet for UI on an existing pattern, tests, deletions and docs; Haiku `Explore` for searches). With two or more builders in parallel, at most two use Opus.

**Read and output rules, for every agent.** Never read a file over 500 lines whole: `grep -n` or the generated section index [specs/INDEX.md](../INDEX.md) (`path:start-end heading`), then read the range. Run Playwright with `--reporter=dot` (or `line`) and Jest with `--silent`, send builds and test runs to a log file, and read back only the summary or the failure block.

**Change sizes.** S (a fix, copy, config, dependency, docs or process change with no new user flow, endpoint, persisted shape or agent input) runs a reduced set of steps with no demo (`qa.mjs --no-demo`), no new epic spec and one changelog bullet; M (a story) runs every step; L (architectural) adds an ADR and a written plan. The table is in `workflow-strict`.

**Process records.** `lessons.md` (about 80 lines, the distilled rules) is the mandatory first read; `retrospective.md` stays the full append-only history, one entry per epic. `changelog.md` gets one entry per epic, when its PR opens, with a bullet per story linking its evidence folder. Each story's `evidence/<roadmap-id>/` holds what `qa.mjs` writes plus a one-line `README.md` with the demo artifact URL.

Each step line in `workflow-strict` keeps the `<n>. **<title>** — <description>` form, followed by `Skill: \`<name>\``, so the `workflow-steps` mod (section 9) still parses it. `check-specs.py` checks the relative links inside `CLAUDE.md`, `lessons.md`, every `SKILL.md`, `.claude/worker.md` and every Markdown file under `.claude/tools/` (section 5).

## 11. Claude Code tools (`.claude/tools/`)

Developer tooling for people who work on this repository in Claude Code, not part of the app or its releases. A tool is code Claude Code (and developers) run; the skill that names it says when and how. Epic [BA-119](../epics/BA-119/spec.md). Each tool has its own folder, a README (kind, files, how to test) and a row in `.claude/tools/README.md`. A tool is one of two kinds:

| Kind | When | Wiring |
|---|---|---|
| MCP server | An external, authenticated service that Claude is the main user of, with structured inputs and shared writes that need approval per call | Registered in a repo-root `.mcp.json` (stdio, `node .claude/tools/<name>/server.mjs`) and enabled for every developer by `enabledMcpjsonServers` in the committed `.claude/settings.json`; its read tools are in `permissions.allow` there, its write tools ask on every call |
| Script | Deterministic, repo-local work that people and CI also run (checks, generators) | Run from the shell; no server |

The one tool at the moment is the `eval-loop` script below. The `jira` MCP server, its skill, `.mcp.json` and the `JIRA_*` template `.env.example` were removed by roadmap 0.5.1 ([M0-5](../epics/M0-5/spec.md)): planning lives only in the repository, epics are roadmap milestones with a spec in `specs/epics/`.

| Tool | Kind | Detail |
|---|---|---|
| `eval-loop` | Script | The improvement loop's fixer isolation (section 2, *Improvement loop*; BA-242): `start-fixer.sh <round>` (a detached worktree from `HEAD` with the held-out paths and every other file naming a held-out case deleted, the failure export beside it, and a `claude` session limited to Read, Edit, Write, Glob and Grep under `fixer-settings.json`'s deny rules, with no MCP server and no auto-memory), `collect-fixer.sh <round>` (the change to the lever files as a patch, then the worktree removed); `--headless` runs the fixer in print mode, as the lead does, `fixer-settings.json` and `held-out-scan.mjs` (the files of a folder that name a held-out case). Tests: a Jest guard that the deny list covers every protected path, and a headless `claude -p` smoke run that tries to read and edit denied files and finds them refused (the tool error of a deny rule; `permission_denials` for Grep, Glob and prompts outside the tree), while an edit of a lever file goes through. Result of 2026-10-20: all refused, the lever edit done, about $0.05 a run on haiku. |

## 12. Claude Code agents (`.claude/agents/`)

Developer tooling for people who work on this repository in Claude Code, not part of the app or its releases. Epic [BA-119](../epics/BA-119/spec.md), roadmap 0.4.3–0.4.8. These definitions run the workflow as a **token-minimal agent org**. An LLM is used only where judgment is needed: writing code, reviewing a diff, and talking to the human. Dispatch, checks, QA, the board and the evidence are scripts and hooks. Manager mode is opt-in. A plain session keeps the single-agent workflow, and the eleven steps, the story lane and acceptance gate, and one branch and PR per epic are unchanged.

| Agent | Model | Tools | Job |
|---|---|---|---|
| `builder` | inherits the session's | all, in a temporary worktree (`isolation: worktree`, which starts from `main`, so the builder first cuts its unit branch from the epic branch) | Builds one roadmap story on a `unit/<EPIC-ID>-<roadmap-id>` branch, from the brief it is given, starting from the story pack (`.context/story-packs/<id>.md`, made by `scripts/story-pack.mjs`). Writes the failing unit test first, then the code. For a UI story, writes the main Gherkin scenario once, as a Playwright test whose `test.step` titles are its Given/When/Then lines. Runs only the related unit tests and its own Playwright file, with no axe scan, screenshots, evidence, demo or `qa.mjs` unless the brief asks; reads line ranges, not whole files over 500 lines; keeps output quiet. Commits on its unit branch and reports the branch, the commit and the tests it added. |
| `reviewer` | `sonnet` | read and search only (`Read`, `Grep`, `Glob`) | Reviews one story's diff against the story's Intent, Scope and Acceptance. It is given the diff and the story, never the builder's transcript. It answers `approve`, or a numbered list of findings, each with file, line, the failure it causes and the fix. It flags no style point that lint already covers. |
| `manager` | inherits the session's | `Read`, `Grep`, `Glob`, `AskUserQuestion`, `PushNotification` | The human's single point of contact, started with `claude --agent manager`. It reads `roadmap.md` (the ticket board), the epic spec and the evidence, and answers "what needs me?" with exactly one question, recommended option first. When a story escalates after 3 failed reviews, it states the disagreement and recommends a way forward. It has no `Edit`, `Write`, `Bash` or `Agent`, so it cannot change files or start work; the pipeline does that. |

`builder` and `reviewer` set `omitClaudeMd: true`: they work from their brief, so they don't load `CLAUDE.md` (roadmap 0.5.2).

**Worker rules (`.claude/worker.md`).** The rules every subagent follows, in one file: write with Edit/Write or in a scratch folder of its own (never shared `/tmp` names), never stop a process it did not start (record PIDs, stop by PID), report a build or budget block instead of changing build config, use the brand the brief names, read ranges and keep output quiet, never edit `version`, never commit a placeholder message. `CLAUDE.md` (*Non-negotiables*) makes `Read .claude/worker.md before anything else.` the first line of every subagent brief, and the file asks each subagent to pass that line on to any subagent it starts. `builder` reads it first (it sets `omitClaudeMd: true`, so it would not see the rule in `CLAUDE.md`). `reviewer` and `manager` cannot write files or run commands, so they skip it. The story pack's builder rules (`BUILDER_RULES` in `scripts/spec-index-lib.mjs`) repeat a short form of it.

Rules every builder follows on top (from the retrospective):
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
node scripts/qa.mjs --free [--base <ref>] [--rebuild] [--dry-run]
```

- **Exit codes:** 0 passed, 1 a check failed, 2 bad usage.
- **Locks.** Two lock files, each `{ pid, story, mode, startedAt }`, created exclusively. A waiting run prints `Waiting for <lock> (held by <story>, pid <pid>)` and polls every 2 s. A lock whose pid is no longer running is stale and is removed. Both are released on exit, including on a failure or Ctrl+C (which also stops the run's child processes).
  - **One run per checkout:** `qa-checkout.lock` in the worktree's own git dir, held for the whole run. Runs in one checkout share its `backend/dist`, `backend/public`, `frontend/test-results` and `.qa-reports/`. The report folder is set up only after this lock is taken.
  - **One Playwright phase across worktrees (the QA lane):** `qa.lock` in git's common dir, held only around the Playwright run and the demo recording. Every worktree's E2E uses the one compose Postgres on 55432 (fixed compose project `questions-to-insights-world-cup`): the global setup may start it, and specs create and drop databases on it. Builds, unit suites, lint and `check-specs` run outside the lane, so another worktree's run can do those while one runs Playwright. Each web E2E test starts the CLI on a free port with its own temp data dir, and the embedded Intellify API also takes a free port, so nothing else is shared; port 3000 is used only by the desktop project, which `qa.mjs` never runs.
- **Epic base.** `--base`, else `git merge-base HEAD origin/main`. The changed files are `git diff --name-only <base>` (committed and uncommitted) plus untracked files.
- **Build, skipped when up to date.** `npm --prefix backend run build:all` runs unless all of these hold: `--rebuild` was not passed; the last build `qa.mjs` ran succeeded (`.qa-reports/build-stamp.json`, deleted before a build and written only after a passing one, holding the build's start time); `backend/dist/cli.js` and `backend/public/index.html` exist; and every input is older than that build's start and than both outputs. The inputs are `backend/src/**`, `frontend/src/**`, `frontend/public/**` (directories' own mtimes included, so a deleted or renamed file counts), `backend/` `package.json`, `package-lock.json`, `nest-cli.json`, `tsconfig.json`, `tsconfig.build.json`, `scripts/copy-web.js`, `frontend/` `package.json`, `package-lock.json`, `angular.json`, `tsconfig.json`, `tsconfig.app.json`, `.postcssrc.json`, and each `node_modules/.package-lock.json` (rewritten by every npm install). Anything unknown builds. A skipped build prints `build: up to date, skipped (pass --rebuild to force)` and is recorded as a passed `build … (up to date, skipped)` row; otherwise the run prints `build: will run (<reason>)`. A build run outside `qa.mjs` leaves no stamp, so the next `qa.mjs` run builds again.
- **Parallel checks.** After the build, the backend unit tests, backend lint and `check-specs.py` run concurrently; the frontend unit tests (Karma) run alone right after them, because its browser tests are timing-sensitive and leaked HTTP requests under the others' CPU load (3 of 5 gate runs failed that way on 2026-11-11, none of 4 alone), and the backend API-level E2E specs run alone after that (each boots built backends). Each prints its block (command, status, log path, the last 30 output lines on failure) when it finishes; results are recorded in their declared order, so `tests.md` and the logs (`.qa-reports/<roadmap-id>/<n>-<step>.log`) keep the same order. Neither Jest nor `ng test` writes `backend/dist` or `backend/public`. Playwright runs after them, in the lane.
- **Test selection (mechanical).**
  - Backend unit: `npx jest --findRelatedTests <changed backend/src files>`; skipped when none changed.
  - Backend API-level E2E (`backend/test/*.e2e-spec.ts`, every spec): run when any file under `backend/` or `frontend/e2e/helpers/` (the stub model they share) changed, alone after the unit suites; skipped otherwise. `--gate` and `--free` always run them. The live-data specs skip without the World Cup Postgres.
  - Frontend unit: `ng test --watch=false --browsers=ChromeHeadless` with `--include` for each changed `frontend/src/**/*.spec.ts` and the spec beside each changed source file; skipped when there are none.
  - Playwright (`web` project): `--only-changed=<base>`, plus every spec in the story's step-6 list whose decision is not `delete`, plus every changed `frontend/e2e/*.spec.ts`, plus the story's demo spec. `E2E_SKIP_DOCKER=1` is set when a Postgres already listens on 55432 (checked again once the lane is taken).
- **Step-6 list.** `evidence/<roadmap-id>/e2e-impact.md`, written in step 6 (`workflow-gate`). It holds a Markdown table whose first column is the Playwright spec path (``frontend/e2e/<name>.spec.ts``, in backticks) and whose second column is the decision: `add`, `update`, `delete` or `re-run`. Other rows and text are ignored.
- **`--draft-impact`:** writes a draft step-6 list, `evidence/<roadmap-id>/e2e-impact.md`, from the same selection `--fast` uses (minus the step-6 list itself). Every spec is `re-run` (`delete` when the diff removed the file), the scenarios column says `TODO: review`, and a header line marks it as a draft to review. It never overwrites: if the file exists it prints so and exits 0. It runs no checks and takes no lock.
- **`--dry-run`:** prints the base, the build decision, the parallel commands, the Playwright specs and the demo or demo-evidence plan; runs nothing, writes nothing, takes no lock. With `--draft-impact` it prints the draft instead of writing it.
- **`--fast` (plain-session story run):** the build (unless up to date), the selected backend and frontend unit tests with `check-specs.py` in parallel, the selected Playwright specs, then the **demo**:
  - **UI story:** the Playwright test tagged `@story-<roadmap-id>` (and `@demo`) is run again with `DEMO=1`. That turns on `slowMo` (400 ms), a 1280×720 video of the app window and a caption overlay showing each Gherkin line the test passes to `scenarioStep` ([frontend/e2e/support/demo-captions.ts](../../frontend/e2e/support/demo-captions.ts)). The video is saved as `evidence/<roadmap-id>/demo.webm`. A demo over **5 MB** fails the run. Without `DEMO=1` the same test runs at normal speed with no captions and no video.
  - **Story with no UI** (no test carries its tag): `evidence/<roadmap-id>/demo.txt`, a transcript of the commands the run executed, each with its exit status and the summary lines of its output.
  - **`--no-demo` (an S change):** no video is recorded (a tagged test still runs at normal speed with the selected specs); `demo.txt` is written as the transcript, saying the run used `--no-demo`.
- **`--gate` (acceptance gate):** the build (unless up to date), then in parallel the full backend unit suite (`jest --json`), backend lint (errors fail; warnings do not) and `check-specs.py`, then the full frontend unit suite alone, then the backend API-level E2E specs alone (`jest --config ./test/jest-e2e.json --json`), then every spec of the step-6 list (decision not `delete`) with Playwright's JSON and HTML reporters (`QA_REPORT_DIR` = `.qa-reports/<roadmap-id>/` at the repo root, git-ignored and outside Playwright's `test-results` folder, which Playwright empties at the start of every run). Video and trace are kept for failures. It writes `evidence/<roadmap-id>/tests.md`:
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
- **Walkthrough video (`scripts/walkthrough.mjs`, skill `walkthrough-video`, since 2026-11-23).** Every implemented change, in either workflow, ends with a subtitled walkthrough of the change running, shown in the chat as a Conductor artifact:
  1. `node scripts/walkthrough.mjs --spec <e2e file> --grep <test title> --title <title> --summary <summary.md> [--narration <narration.json>] [--lang es] --out .context/artifacts/<dir>` runs that one test on the web target with `DEMO=1` and `WALKTHROUGH_CUES` set. In that mode `scenarioStep` draws no caption on the page. Instead it appends one cue per step to a JSON-lines file: the seconds since the page's video started (`frontend/e2e/support/video-clock.ts`, marked by the app fixture) and the step's text. The text comes from `WALKTHROUGH_NARRATION` when that file names the step; otherwise the cue keeps the step's Gherkin line.
  2. The video is re-encoded with Playwright's own ffmpeg (VP8, 1280 down to 640 px) until it is at most 1.4 MB. The page is one HTML file of at most 2 MB, as Conductor artifacts require. It holds the title, the summary, the video as a `data:` URL with its subtitles drawn over it in sync (a CC toggle) and a transcript whose lines seek the video. The video and a `.vtt` stay in `.qa-reports/walkthrough/<dir>/`; nothing is committed.
  3. Exit codes: 0 written, 1 failed (the test failed, it has no `scenarioStep`, or the video cannot fit), 2 bad usage. The page and cue helpers are pure (`scripts/walkthrough-lib.mjs`) and tested by `node --test scripts/walkthrough-lib.test.mjs`.
- **Playwright configuration** (`frontend/playwright.config.ts`): when `QA_REPORT_DIR` is set, the reporters are `list`, `json` (`<dir>/results.json`) and `html` (`<dir>/html`). `DEMO=1` is read by the app fixture (video, `slowMo`) and by `scenarioStep` (captions).
- **Playwright workers (`E2E_WORKERS`, since roadmap 1.23.32):** spec files run in parallel, 3 workers locally and 1 on CI (`CI` set); `E2E_WORKERS=<n>` overrides both (e.g. `E2E_WORKERS=1` for a serial run while debugging). Tests within one file stay in order (`fullyParallel: false`). This is safe because each web test has its own CLI port, data dir and stub servers, and the specs that create databases on the shared Postgres give them unique names. A new spec that writes to the shared Postgres must do the same (a unique database name, or rows it creates and deletes itself). The QA lane still covers the whole Playwright phase, so one worktree's workers never overlap another's. Timings: [evidence/1.23.32/timings.md](../../evidence/1.23.32/timings.md).
- **`check-specs.py` on Windows:** paths are compared with forward slashes, so the Playwright-mirror check passes on Windows as it does on Linux.
- **Spec section index and story pack (roadmap 1.23.29).**
  - `node scripts/spec-index.mjs` writes `specs/INDEX.md`: for every `specs/**/*.md`, `roadmap.md`, `roadmap-archive.md` and `roadmap-backlog.md`, each heading (levels 2-4) and each rule id (`- R<n>.`) as `path:first-last  heading`, outside code fences. A heading runs to the line before the next heading of its level or higher; a rule to the line before the next rule or heading. Never edit it by hand; regenerate it after any spec or roadmap edit.
  - `check-specs.py` fails when the index is stale (it runs `node scripts/spec-index.mjs --check`; skipped when `node` is missing), and when a `Scenario:` of a Feature that has no Given/When/Then lines under its scenarios has a title that is not in its `E2E:` file (a Feature that keeps its steps in the spec is not checked).
  - `node scripts/story-pack.mjs <roadmap-id> [--out <file>]` writes `.context/story-packs/<id>.md` (gitignored): the story's roadmap entry verbatim (from `roadmap.md` or `roadmap-archive.md`); the plan sections it cites (links to `docs/plans/*.md`, "plan section N", "plan 1.24.x", looked up in every plan file when unlinked), capped at 400 lines; the spec sections it names (`specs/...md#anchor` paths, or `Specs: <capability> R2, R5` short names, with their line ranges); a file map (top-level symbols with line numbers of each code path named); the `lessons.md` lines for the touched areas; the builder rules and report block. It prints the size and warns above 60 KB.
- **Roadmap archive (roadmap 1.23.30).** `node scripts/roadmap-archive.mjs [--dry-run]` moves every milestone whose `####` features are all `✅ Done` or `🚫 Cut` (or, after its open features moved to the backlog, only `- <id> <title> — moved to Backlog` placeholder lines; and that is not Milestone 1.23, the active epic) from `roadmap.md` to `roadmap-archive.md`, verbatim and in order. `roadmap.md` keeps one heading per archived milestone: the original heading (it names the epic) plus ` — archived, see roadmap-archive.md`. The script is idempotent. `check-specs.py` (epic gate and link check), `qa.mjs` (`storyTitle` for `demo.txt`), `demo-page.mjs`, `story-pack.mjs` and `spec-index.mjs` read **all three** files (`roadmap.md`, `roadmap-archive.md`, `roadmap-backlog.md`), so an archived or backlogged story is still found by `qa.mjs <id> --dry-run` and `demo-page.mjs <id>`. Open stories moved out of a finished or stale milestone live verbatim in `roadmap-backlog.md` under `### Moved from Milestone <x.y> — <title> (<date>)`, with a placeholder line left in the milestone; `roadmap.md` keeps a `## Backlog` heading that points to it. Re-run the script when an epic finishes.
- **`--free` (roadmap 0.6.4, [M0-6](../epics/M0-6/spec.md)): checks with no story,** for the Free style workflow. It takes no roadmap id, `--no-demo` or `--demo` (a usage error, exit 2). It runs the gate's full parallel plan (build decision, full backend and frontend unit suites, the backend API-level E2E specs, backend lint, `check-specs.py`), then the Playwright specs the `--fast` selection picks (no `@story-` grep), taking and leaving the Postgres lane like the other modes. Reports and logs go to `.qa-reports/free/`; it never creates `evidence/` files, `tests.md` or a demo. The checkout lock records `story: free`. It ends with `qa free: n/m steps passed` and exits 1 on any failure; `--dry-run` prints the base, the build line, the parallel plan and the selected specs and writes nothing.
- **`--wave <id>,<id>,…` (roadmap 1.23.31): one verification for several stories.** It reuses the `--fast` step runners (build decision, parallel unit tests and `check-specs.py`, Playwright, demo), once for the whole wave:
  - the build (unless up to date), the related unit tests of the union of files changed since `--base`, `check-specs.py`, and the union of Playwright specs (`--only-changed=<base>`, the union of the stories' step-6 lists in `evidence/<id>/e2e-impact.md`, every changed `frontend/e2e/*.spec.ts`);
  - one demo only, for `--demo <id>` (its `@story-<id>` test with `DEMO=1`, or its `demo.txt`); `--no-demo` (the default) records none and writes no `demo.txt`. `--demo` and `--no-demo` exclude each other, and the demo story must be one of the wave's;
  - evidence: `evidence/waves/<first-id>…<last-id>.md` is the shared report (steps, counts, the spec union, failures, links); each story gets `evidence/<id>/tests.md` that states the result and points to the shared report. The step-6 coverage check and the demo evidence row of `--gate` are not part of a wave: the acceptance gate still runs per story;
  - `--dry-run` prints the plan: the stories, base, build decision, parallel commands, Playwright specs, demo and the evidence files it would write; nothing runs and no lock is taken. Reports go to `.qa-reports/wave-<first>-<last>/`.
- **Quiet output (roadmap 1.23.31).** Every Playwright run uses `--reporter=dot,json,html` (the demo run, which writes no reports, `--reporter=dot`), with `PLAYWRIGHT_JSON_OUTPUT_NAME`, `PLAYWRIGHT_HTML_OUTPUT_DIR` and `PLAYWRIGHT_HTML_OPEN=never` pointing at the report dir (a command-line `--reporter` replaces the config's). Every command's output goes to its log file in the report dir; the console prints one line per step (`✔|✖ <name>: <status> (exit, seconds), log <path>`) and, for a failed step only, the last 30 lines of its log.

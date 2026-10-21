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
| `check:answers` | `ts-node scripts/check-answers.ts` | Opt-in live answer-quality gate over the World Cup fixture; costs real model calls and needs `OPENAI_API_KEY`. Tunable by `CHECK_TRIALS`, `CHECK_ARM`, `CHECK_MODEL`, `CHECK_TIMEOUT_MS`. |
| `evals:assistant` | `nest build && node dist/mastra/evals/run-assistant-evals.js` | The assistant eval suite from the command line, same suite the Agents screen runs. Needs `EVAL_DATASETS` (comma-separated saved dataset names) and one of `EVAL_SET` (a set id, such as `world-cup-rest`, or `rfp` for the RFP Builder) or `EVAL_CASES` (comma-separated case ids); with neither or both it runs nothing, as [agents-evals](../capabilities/agents-evals/spec.md) R111 explains. `EVAL_SPLIT` (`dev` or `held-out`) and `EVAL_CATEGORY` (comma-separated categories) narrow that selection, `EVAL_REPEATS` (`1` by default, `3` or `5`) asks each question that many times and reports pass^k with flaky questions (R209 to R213, R222). `EVAL_JUDGE` (`off` by default, `on` or `categories`, with `EVAL_JUDGE_CATEGORIES`) sets the judge option (R154); with it off, judge checks are not scored and cost nothing. It prints every check of each question, passed or failed with its reason, then dev and held-out side by side with their intervals, the tokens and the cost. The run is saved in the data directory it runs with (`APP_DATA_DIR`, else `backend/data`) like a run started in the app, so it prints `Run id: <jobId>` and the comparison with the previous comparable run (R223). Optional `EVAL_RESULTS_FILE` (a path: the run's full results, answers and tool calls included, written there as JSON) and `EVAL_RUN_FILE` (a path: the saved run record, written there as JSON; R224). Every refusal comes before the backend boots and costs no model call. Example: `EVAL_DATASETS="World Cup" EVAL_SET=world-cup EVAL_REPEATS=3 npm run evals:assistant`. Costs model calls. |
| `evals:assistant:run` | `node dist/mastra/evals/run-assistant-evals.js` | `evals:assistant` without the build, for a `dist/` that is already built and must not change while it runs (the improvement loop runs the same file from its snapshot of `dist/`, *Improvement loop* below). Same settings. |
| `eval:validate` | `nest build && node dist/mastra/evals/validate-eval-sets.js` | The eval-set validator: checks one set's reference queries on its datasource with no model call; what it runs, prints and exits with is [agents-evals](../capabilities/agents-evals/spec.md) R110. Needs `EVAL_DATASETS` (comma-separated saved dataset names) and `EVAL_SET` (the set id). Boots the backend without an HTTP port, like `evals:assistant`. Both rebuild `dist/` first (`nest build` clears it), so neither should run while the E2E suite or a long eval run uses that build. |
| `eval:diff` | `ts-node -T -P tsconfig.json scripts/eval-diff.ts --before <runs> --after <runs> [--data-dir <dir>] [--target <categories>] [--round <n>] [--lever "<text>"] [--hypothesis "<text>"] [--tsv]` | Compares two sides of saved runs (run ids, whole or 8-character prefixes, read without writing from `<data dir>/app.sqlite`; or exported run files): per split and category the before and after pass rates with their intervals, the change with Newcombe's interval and an `up` / `down` / `within` flag, flipped questions, questions only on one side, cost per question, warnings when sets, model, repeats or judge differ, a draft change-log line and, with `--tsv`, a draft [`results.tsv`](../../docs/evals/loop/results.tsv) row. With `--target` it checks the accept rule and exits with code 1 when it is not met. No model call. [agents-evals](../capabilities/agents-evals/spec.md) R224 to R227. |
| `eval:export-failures` | `ts-node -T -P tsconfig.json scripts/eval-export-failures.ts --run <run> --out <folder> [--data-dir <dir>] [--force]` | Writes the dev failures of one run as one Markdown file per failed dev question, plus a README with the dev counts and only the counts of the held-out split: what the loop's fixer reads. Refuses a non-empty folder unless it holds an earlier export and `--force` is given. No model call. R228. |
| `eval:leak-check` | `ts-node -T -P tsconfig.json scripts/eval-leak-check.ts [--base <ref>] [--staged] [--diff-file <path>] [--fixer] [--json]` | Rejects added lines in the lever files that quote a question bank (question words, entity names, numbers, quoted values) from any split or a planted-facts file; exits with code 1 on a rejection. `--fixer` names no held-out case in its report. R229, R230. |
| `worldcup:api:dump` | `ts-node scripts/worldcup-rest-api/dump.ts` | Snapshot the World Cup Postgres into JSON files for the test REST API (`WORLD_CUP_DB_*` env). |
| `fixtures:<domain>` (`fixtures:finance`, `fixtures:health-insurance`, `fixtures:genomics`, `fixtures:supply-chain`, `fixtures:marketing-analytics`) | `ts-node ../docker/postgres/generate/<domain>.ts` | Regenerate a synthetic domain sample's seed SQL (and its planted facts, for the domains written for BA-9) from its fixed seed; byte-identical on every run, and it fails when a planted trap drifts. Files: [data-model.md](data-model.md) 4.10. |
| `fixture:dump` | `ts-node scripts/dump-fixture.ts --fixture <id> [--database <db>] [--host …] [--port …] [--user …] [--password …]` | Export a loaded PostgreSQL sample to `scripts/fixtures/<id>/data/` (one gzipped compact JSON file, `<relation>.json.gz`, per required table and view, plus a plain `_meta.json`), the source of the REST server and the Databricks loader. Connects with the sample's default coordinates unless overridden. Format: [data-model.md](data-model.md) 4.10. |
| `fixture:databricks` | `ts-node scripts/setup-fixture-databricks.ts --fixture <world-cup\|finance\|marketing-analytics> [--dry-run [--full]] [--no-register \| --register-only] [--batch-rows <n>]` | Load a sample's JSON dump into a Databricks Unity Catalog schema (`evals.<schema>` by default), check its row counts, and register its datasource and dataset in a running backend, calling its HTTP API directly with no sign-in and no token; what it runs and checks is [testing-data](../capabilities/testing-data/spec.md) R23 to R25. Environment: `DATABRICKS_HOST`; `DATABRICKS_HTTP_PATH` (the SQL warehouse's `/sql/1.0/warehouses/<id>`) or `DATABRICKS_WAREHOUSE_ID`; `DATABRICKS_TOKEN` (a token that can create schemas and tables in the catalog); `DATABRICKS_CATALOG` (default `evals`; any catalog works, since the references run in the dataset's catalog, [agents-evals](../capabilities/agents-evals/spec.md) R192); `DATABRICKS_SCHEMA` (default the sample's schema); `BACKEND_URL` (default `http://127.0.0.1:3000`), the backend it registers in. `--dry-run` needs none of them and connects to nothing. Idempotent. Run with a warehouse in the VDI: [docs/evals/databricks-vdi.md](../../docs/evals/databricks-vdi.md). |
| `worldcup:api`, `finance:api`, `marketing-analytics:api` | `ts-node scripts/worldcup-rest-api/serve.ts [--fixture finance\|marketing-analytics]` | Zero-dependency REST + OpenAPI server over a sample's JSON dump, for exercising the REST connector: World Cup on `127.0.0.1:55080` (the snapshot above), finance on 55081 and marketing analytics on 55082 (their `fixture:dump` files). With no switch it answers as it always did; the switches are under *The fixture REST API* below. |
| `intellify-api` | `node dist/intellify-api/main.js` | Run the Intellify RFP API alone (ADR-0027; needs `build` first), configured only by environment: `INTELLIFY_API_KEY` (required), `INTELLIFY_API_HOST`, `INTELLIFY_API_PORT` (3100), `INTELLIFY_DB_*` ([api.md](api.md) 6.1). Not needed for local runs: the app starts the API embedded unless `INTELLIFY_API=off`. |
| `worldcup:rest:setup` | `ts-node scripts/setup-worldcup-rest.ts` | `fixture:rest:setup` with its World Cup defaults, kept for existing docs (`WORLD_CUP_API_URL` still works). |
| `fixture:rest:setup`, `finance:rest:setup`, `marketing-analytics:rest:setup` | `ts-node scripts/setup-fixture-rest.ts [--fixture <id>] [flags]` | Registers a running fixture REST API as a `rest` datasource and a dataset in a running backend through its HTTP API, called directly with no sign-in and no token; one datasource per server variant; idempotent. Flags under *The fixture REST API* below. |
| `build:web` | `npm --prefix ../frontend run build:web && node scripts/copy-web.js` | Build the UI and copy it to `backend/public/` (gitignored). `copy-web.js` fails if the frontend build has no `index.html`. |
| `build:all` | `build` then `build:web` | Everything the npm package needs. |
| `prepack` | `build:all` | `npm pack` / `npm publish` always ship a fresh UI. |

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
- **Fixer isolation.** `.claude/tools/eval-loop/start-fixer.sh <round> [--export <dir>] [--lever "<lever>"] [--target <categories>] [--allow-dirty] [--headless [--max-budget-usd <n>]] [--dry-run]` adds a detached worktree, `git worktree add --detach .eval-loop/fixer/<round>/tree HEAD` (no branch), so the fixer starts from `HEAD`: it refuses while the lever files (R229) have uncommitted changes, unless `--allow-dirty` is given, since the tree would lack them and the run would not match the code. It deletes from the tree's working copy (never committed) every path that carries held-out content: `backend/src/mastra/evals/` (sets, checks and harness), `backend/scripts/fixtures/`, `docker/postgres/`, `specs/capabilities/agents-evals/`, `docs/evals/domains/`, `docs/research/`, `docs/plans/`, `evidence/`, `frontend/e2e/`, and `roadmap.md`, `proposals/`, the leak check's allowlist and any `dist/`; then any other file that names a held-out case id or quotes a held-out question (`.claude/tools/eval-loop/held-out-scan.mjs`; a lever file that does stops the start). It copies the round's failure export (R228; `--export`, else `.eval-loop/exports/<round>/`) to `.eval-loop/fixer/<round>/export/` and starts `claude` inside the tree: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude --settings <absolute path of .claude/tools/eval-loop/fixer-settings.json> --tools Read,Edit,Write,Glob,Grep --permission-mode acceptEdits --strict-mcp-config --add-dir .eval-loop/fixer/<round>/export -n "eval-loop fixer <round>" --append-system-prompt "<the fixer's role>" "<the round, its lever and target, and the export's path>"`. With `--headless` (added 2026-10-21; how the lead runs it) the same command runs in print mode, `-p --output-format stream-json --verbose --no-session-persistence --max-budget-usd <n>` (default 5), so a permission it would ask for is refused and no session is saved; its transcript is written to `.eval-loop/fixer/<round>/fixer.jsonl` and its final report to `report.md`. No Bash, because the read and edit rules do not stop a `node` or `python` subprocess; no MCP server (`--strict-mcp-config` with no `--mcp-config`, so neither the repo's `jira` nor the account's connectors; and `mcp__ide` denied, since that flag does not remove the `ide` server VS Code gives a session started in its integrated terminal, which can run code); and no auto-memory (the variable, and `autoMemoryEnabled: false` in the settings), since the lead's memory may name held-out cases. `fixer-settings.json` is the second layer: deny rules that forbid editing `**/src/mastra/evals/**`, `**/scripts/**`, `**/docker/**`, the testing-data fixtures' SQL and `registry.ts`, `**/docs/**`, `**/specs/**`, `**/.claude/**`, the package and lock files, `**/.gitignore`, `**/*.spec.ts`, `**/__fixtures__/**`, `**/backend/test/**`, `**/frontend/**`, the model routing files (`model-resolver.ts`, `model-compat.ts`, `effort-levels.ts`, `agent-constants.ts`) and `**/src/modules/llm/**`, and reading the held-out paths above, `**/dist/**`, `**/.eval-loop/runs/**`, `**/.eval-loop/data/**`, `~/.questions-to-insights/**` and `~/.claude/projects/**` (the lead's auto-memory and session transcripts). The rules are written as `**/` patterns, which cover the tree, and, for the Read rules, also as `//**/` patterns, which cover the same paths anywhere on the disk (a `/` rule is anchored at the settings file's folder). No absolute rule may name `.claude`: the tree sits under `.claude/worktrees/`. A unit test holds the deny list to every path the loop must protect, and a headless `claude -p` smoke run checks that Claude Code applies it (section 11). `.claude/tools/eval-loop/collect-fixer.sh <round>` writes the tree's change to the lever files (R229) as `.eval-loop/fixer/<round>/change.patch` and removes the worktree; the lead runs `eval:leak-check --diff-file` on the patch, applies it with `git apply`, rebuilds, snapshots and runs the target slice (`EVAL_SPLIT=dev EVAL_CATEGORY=<category>`), then the full run. An accepted change is committed with its `eval:diff` output; a rejected one is reverted with `git restore`.
- **Levers.** One per round: the assistant's prompt, tool descriptions and error messages, the context blocks, and the knowledge seeds of the domain samples (`backend/src/modules/testing-data/fixtures/knowledge/`); the World Cup sample stays unseeded, since its sets are the team's gate. A changed knowledge seed reaches the loop's data directory only when its sample is loaded again, and a load keeps an entry of the same kind and title, or a metric of the same name, as it is ([testing-data](../capabilities/testing-data/spec.md) R26), so the entries the change touches are deleted first. Never the sets, checks, thresholds, model, effort, step budget, fixtures, facts, harness, specs or tests; when a change is accepted the supervisor updates the specs and tests it affects (such as [agents.md](agents.md) Appendix A).

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
| `backend/` | `npm test`, `npm run build`, lint on the files you touched, and `npm run test:e2e` |

`test:e2e` builds the backend with the web UI and drives the web app; its global setup starts the World Cup Postgres itself (see section 6). The desktop target (`test:e2e:desktop`) runs only when a desktop run is requested, and refuses to launch the app if port 3000 is taken. Which target to test, and how skipped desktop-only scenarios are reported, is the *Test target convention* in the [`workflow-e2e`](../../.claude/skills/workflow-e2e/SKILL.md) project skill (section 10).

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
| Tarball contents | `files`: `dist`, `!dist/**/*.tsbuildinfo`, `public`. No `src/`, `test/`, `scripts/`. The sample seed SQL ships inside `dist` (about 8.4 MB uncompressed, 5.2 MB of it the gzipped Formula 1 dump; the five synthetic domain seeds are 3.2 MB of plain SQL, which the tarball's own gzip compresses); the generators, planted facts and JSON dumps do not ([data-model.md](data-model.md) 4.10). |
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

Conventional Commit subjects therefore drive the bump, Because the bump reads every commit since the last tag, an epic's single PR with mixed `feat`/`fix`/`docs` commits still bumps at the highest level it contains. The epic branch's type names that highest-impact type (see *Branching convention* in the [`workflow-plan`](../../.claude/skills/workflow-plan/SKILL.md) project skill).

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
| Sample Postgres | project `questions-to-insights-world-cup`, port 55432 | `docker compose -p <name>` plus `WORLD_CUP_DB_PORT=<port>`; the e2e fixtures read the same variable (and `WORLD_CUP_DB_HOST`) |
| Fixture REST APIs | 55080 (World Cup), 55081 (finance), 55082 (marketing analytics) | `REST_API_PORT` or `--port`; the eval variants use 55090 and up, and the setup script's `--api-url` points at them (section 2, *The fixture REST API*) |
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
| Download routes | Pages Functions: `/download/mac-arm64`, `/download/mac-x64`, `/download/win-x64` redirect to the newest published installer for that platform; `/api/latest` returns JSON (version, file sizes) for the page. A new release needs no site edit. |
| Private-repo trick | The repo is private, so `releases/download/…` 404s publicly. The Function asks the GitHub API for the asset with `Accept: application/octet-stream`, takes the credential-free short-lived `Location`, and redirects the browser to it; the token never leaves the edge. Per platform it picks the newest release that carries that installer, so a Windows-only release leaves macOS buttons on the last release that had them. |
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

Developer tooling for people who work on this repository in Claude Code, not part of the app or its releases. `CLAUDE.md` holds only the always-on core: the mandatory first action, the eleven-step `## Workflow` list, the fast loop and acceptance gate, the hard gates and model usage. Each step's conventions live in a project skill. Claude loads the skill before the step starts, and a developer can invoke it as `/<name>`. Epic [BA-119](../epics/BA-119/spec.md).

| Skill | Steps | Holds |
|---|---|---|
| `workflow-understand` | 1–2 | restating the goal, clarifying questions |
| `workflow-plan` | 3 | Planning convention, Epic gate, Branching convention (branch, worktree, commit scope) |
| `workflow-architecture` | 4 | Architecture convention (C4, ADRs) |
| `workflow-specs` | 5 | Spec convention (where facts go, Gherkin, CI coverage) |
| `workflow-e2e` | 6–7 | E2E test convention, Test target convention |
| `workflow-implement` | 8 | Code rules, Worktree deploy convention |
| `verify` | 9 | the step-9 commands and eval bar; checking a change in the running web app |
| `workflow-ship` | 10 | Logging and Evidence conventions, the epic PR, post-merge cleanup |
| `workflow-retrospective` | 11 | Retrospective convention |

Other project skills are task runbooks, not workflow steps: `jira` (the guide to the Jira tools, section 11), `intellify-api`, `deploy-labs-site` (section 8) and `eval-loop` (one round of the supervised improvement loop, section 2, *Improvement loop*; BA-242). Each step line in `CLAUDE.md` keeps the `<n>. **<title>** — <description>` form, followed by `Skill: \`<name>\``, so the `workflow-steps` mod (section 9) still parses it. `check-specs.py` checks the relative links inside every `SKILL.md` and every Markdown file under `.claude/tools/` (section 5).

## 11. Claude Code tools (`.claude/tools/`)

Developer tooling for people who work on this repository in Claude Code, not part of the app or its releases. A tool is code Claude Code (and developers) run; the skill that names it says when and how. Epic [BA-119](../epics/BA-119/spec.md). Each tool has its own folder, a README (kind, files, how to test) and a row in `.claude/tools/README.md`. A tool is one of two kinds:

| Kind | When | Wiring |
|---|---|---|
| MCP server | An external, authenticated service that Claude is the main user of, with structured inputs and shared writes that need approval per call | Registered in the repo-root `.mcp.json` (stdio, `node .claude/tools/<name>/server.mjs`) and enabled for every developer by `enabledMcpjsonServers` in the committed `.claude/settings.json`; its read tools are in `permissions.allow` there, its write tools ask on every call |
| Script | Deterministic, repo-local work that people and CI also run (checks, generators) | Run from the shell; no server |

| Tool | Kind | Detail |
|---|---|---|
| `jira` | MCP server | Jira Cloud REST v3. Read tools: `whoami`, `get_project`, `search_issues`, `get_issue` (with `parent` and `parentType`, for the Epic gate), `list_statuses`, `list_transitions`. Write tools: `create_epic`, `create_issue` (Story, Bug or Task; a Story or Bug must name its epic, checked to be an Epic before anything is created), `update_issue` (summary, description, epic), `add_comment`, `transition_issue`. Credentials `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT`: the environment, then `JIRA_CONFIG_FILE`, or else this checkout's `.env` and then the main checkout's (found through `git rev-parse --git-common-dir`), read on every call. `setup.mjs` writes them from the developer's own terminal. No dependencies (Node 22 or later). Tests: `node --test '.claude/tools/jira/tests/*.test.mjs'`, with Jira faked. Replaces the earlier `jira.sh` script ([BA-237](https://halo-powered.atlassian.net/browse/BA-237)). |
| `eval-loop` | Script | The improvement loop's fixer isolation (section 2, *Improvement loop*; BA-242): `start-fixer.sh <round>` (a detached worktree from `HEAD` with the held-out paths and every other file naming a held-out case deleted, the failure export beside it, and a `claude` session limited to Read, Edit, Write, Glob and Grep under `fixer-settings.json`'s deny rules, with no MCP server and no auto-memory), `collect-fixer.sh <round>` (the change to the lever files as a patch, then the worktree removed); `--headless` runs the fixer in print mode, as the lead does, `fixer-settings.json` and `held-out-scan.mjs` (the files of a folder that name a held-out case). Tests: a Jest guard that the deny list covers every protected path, and a headless `claude -p` smoke run that tries to read and edit denied files and finds them refused (the tool error of a deny rule; `permission_denials` for Grep, Glob and prompts outside the tree), while an edit of a lever file goes through. Result of 2026-10-20: all refused, the lever edit done, about $0.05 a run on haiku. |

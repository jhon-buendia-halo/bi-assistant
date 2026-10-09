# Tech stack

The current implementation profile of Questions to Insights (product name in the UI and installers: **Halo BI Assistant**). This file describes **the current implementation**; the behaviour, contracts and rules live in the other specs and hold on any stack. Why the stack is shaped this way: [architecture.md](architecture.md) (ADR-0001 to ADR-0005). How it is built, packaged and released: [delivery.md](delivery.md).

Versions are taken from `frontend/package.json` and `backend/package.json`. A bare number is pinned exactly; `^`/`~` means the range in the manifest.

## Languages and runtime

| Item | Choice |
|---|---|
| Language | TypeScript everywhere (frontend `~5.8.2`, backend `^5.7.3`). Electron main process and preload are plain CommonJS (`.cjs`), not TypeScript. |
| Node.js | `>=22.13.0` (`engines` in `backend/package.json`); CI builds and publishes on Node 22. Packaged desktop apps do not need a system Node: the backend runs on Electron's own binary (`ELECTRON_RUN_AS_NODE=1`, see [delivery.md](delivery.md)). |
| Package manager | npm. Two independent projects, each with its own `package-lock.json`: `frontend/` and `backend/`. No workspace root. CI installs with `npm ci --legacy-peer-deps`. Both projects carry an `allowScripts` allowlist (native and build helpers only: `better-sqlite3`, `esbuild`, `fsevents`, `@parcel/watcher`, and so on). |
| Backend TS target | ES2023, `module`/`moduleResolution` `nodenext`, decorators + `emitDecoratorMetadata`, `strictNullChecks` on, `noImplicitAny` off. |
| Frontend TS target | ES2022, `strict` plus `strictTemplates`, `noImplicitOverride`, `noImplicitReturns`. |

## Frontend (`frontend/`)

| Library | Version | Used for |
|---|---|---|
| Electron | 44.3.0 | Desktop shell: window, backend child process, IPC bridge, diagnostics. Dev dependency; electron-builder bundles the runtime. |
| electron-builder | 26.15.3 | Packaging: macOS `.dmg`, Windows NSIS `.exe`. |
| Angular (`common`, `compiler`, `core`, `forms`, `platform-browser`, `router`) | ^20.0.0 | The renderer UI. Standalone components and signals only, no NgModules. `zone.js` `~0.15.0` is the change-detection polyfill. |
| `@angular/build` / `@angular/cli` | ^20.0.4 | Build (`@angular/build:application` esbuild builder), dev server, Karma test runner. Component style language is SCSS. |
| RxJS | ~7.8.0 | HTTP and stream plumbing alongside signals. |
| Tailwind CSS + `@tailwindcss/postcss` | 4.3.3 (both) | Styling (v4, via PostCSS). `postcss` is 8.5.28. |
| lucide-angular | 1.0.0 | Icons. |
| marked | 18.0.13 | Renders assistant markdown in the chat (`shared/pipes/markdown.pipe.ts`). |
| DOMPurify | 3.4.15 | Sanitises the HTML `marked` produces before it is bound into the page. |
| tslib | ^2.3.0 | TypeScript helpers (`importHelpers`). |
| Playwright (`@playwright/test`) | 1.63.0 | End-to-end tests that drive the real Electron app (`_electron.launch`). |
| axe-core | 4.13.0 | Accessibility audit injected into the page by the layout spec. |
| Karma + Jasmine (`karma` ~6.4.0, `karma-chrome-launcher` ~3.2.0, `karma-coverage` ~2.2.0, `karma-jasmine` ~5.1.0, `karma-jasmine-html-reporter` ~2.1.0, `jasmine-core` ~5.7.0, `@types/jasmine` ~5.1.0) | as listed | Frontend unit tests (`ng test`). |

Electron security posture (load-bearing, see [product/non-functional.md](../product/non-functional.md)): `contextIsolation: true`, `nodeIntegration: false`, `titleBarStyle: 'hiddenInset'`, a preload script that exposes two objects through `contextBridge` (`systemDiagnostics`, `desktop`). The IPC contract is specified in [api.md](api.md).

Build facts: the Angular production build has budgets (initial 500 kB warn / 1 MB error; component style 4 kB warn / 8 kB error) and hashed output; output goes to `frontend/dist/frontend/browser`. `API_BASE_URL` (`core/config/api.config.ts`) is `http://localhost:3000` under `file://` (Electron) and `''` (same origin) otherwise. `APP_VERSION` (`core/config/app-version.ts`) is read from `package.json` at build time.

## Backend (`backend/`)

| Library | Version | Used for |
|---|---|---|
| NestJS (`@nestjs/common`, `core`, `platform-express`) | ^11.0.1 | HTTP API on Express; modules, controllers, services, DI, exception filters. |
| `reflect-metadata`, RxJS | ^0.2.2, ^7.8.1 | Nest runtime requirements. |
| Zod | 4.6.5 | Schemas for agent tool inputs and structured model output. |
| Mastra `@mastra/core` | 1.66.0 | Agent harness: agents, tools, workspaces, model routing (ADR-0004). |
| `@mastra/memory` | 1.29.0 | Agent memory; each session is its own thread/resource. |
| `@mastra/libsql` | 1.22.5 | LibSQL storage for agent memory and runtime data (`<APP_DATA_DIR>/mastra.sqlite`). |
| `@mastra/duckdb` | 1.8.0 | DuckDB storage for observability: traces, metrics, logs (`<APP_DATA_DIR>/observability.duckdb`; limits: 512MB memory, 2 threads). |
| `@mastra/observability` | 1.17.8 | Tracing / observability wiring. |
| `@opentelemetry/sdk-node` | 0.222.0 | Developer observability only (ADR-0006): the OpenTelemetry Node SDK, started by the entry points when the developer setting is on. It is never imported when the setting is off. |
| `@opentelemetry/auto-instrumentations-node` | 0.80.0 | Developer observability: HTTP, Express, NestJS, `pg` and undici (fetch) instrumentation. fs, dns and net are disabled. |
| `@opentelemetry/exporter-trace-otlp-proto`, `@opentelemetry/exporter-metrics-otlp-proto` | 0.222.0 | Developer observability: OTLP protobuf exporters for traces and metrics. |
| `@opentelemetry/sdk-metrics`, `@opentelemetry/resources` | 2.11.0 | Developer observability: periodic metric reader and the `service.name` resource. |
| `@opentelemetry/api` | 1.9.1 | OpenTelemetry API shared by the SDK and the instrumentations. |
| `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-logs-otlp-proto`, `@opentelemetry/api-logs` | 0.222.0 | Developer observability: OTLP log export. Nest logs go through `DeveloperNestLogger`, which prints as Nest's console logger and also emits a log record. Mastra's Pino logs go through `@opentelemetry/instrumentation-pino`. |
| `@mastra/arize` | 1.3.16 | Developer observability: `ArizeExporter`, which sends agent traces with OpenInference attributes to Arize Phoenix. Its `@mastra/otel-exporter` 1.3.16 depends on `@mastra/observability` 1.17.8, so it must move in lockstep with that pin. It is `require`d only when the developer setting is on. |
| `@mastra/evals` | 1.10.2 | Scorers for the assistant eval suites. |
| `@mastra/loggers` | 1.3.1 | Mastra logging. |
| `mastra` (CLI, dev dependency) | 1.29.0 | Mastra Studio tooling against `src/mastra/index.ts`. |
| better-sqlite3 | 13.0.3 | Application document store (`<APP_DATA_DIR>/app.sqlite`), ADR-0003. Native module; loads under `ELECTRON_RUN_AS_NODE` with the current Electron/Node pairing. If an ABI error appears after an upgrade, rebuild it for Electron. |
| pg | 8.23.0 | PostgreSQL datasource connector. |
| `@databricks/sql` | 2.1.0 | Databricks datasource connector. |
| marked | 18.0.13 | Markdown to HTML for the analysis section of visual documents. |
| sanitize-html | 2.17.7 | Sanitises that HTML (and other generated markup) on the server. |
| Node built-ins | | `node:util` `parseArgs` (CLI), `node:net`, `node:fs`, `node:crypto` (API-key encryption in `infrastructure/crypto`, keyed by `APP_SECRET`), `node:http` (World Cup test REST API). |
| Jest | ^30.0.0 (`ts-jest` ^29.2.5, `@types/jest` ^30.0.0) | Backend unit tests and the API-level e2e specs. |
| supertest | ^7.0.0 | HTTP assertions in backend e2e specs. |
| ESLint 9 + `typescript-eslint` ^8.20.0 + Prettier ^3.4.2 | | Lint and format (the `lint` script runs with `--fix`). |
| `@nestjs/cli` | ^11.0.0 | `nest build` / `nest start`. `nest-cli.json` copies non-TS assets: `mastra/skills/**/*` and `modules/testing-data/fixtures/**/*.sql*`. |

The LLM providers (OpenAI-compatible endpoints including LenAI, Anthropic) are reached through Mastra's model router; there is no direct provider SDK dependency. See [agents.md](agents.md) for model resolution.

Persistence in one line: SQLite documents (better-sqlite3) for app data, LibSQL for agent memory, DuckDB for observability, plain files for session workspaces. The data model is in [data-model.md](data-model.md).

## Code layout

### Repository

```
frontend/   Angular app (Electron renderer) + Electron main process (electron/main.cjs, preload.cjs)
backend/    NestJS API, Mastra agents, the CLI (npm package source)
site/       Static product page and download routes (Cloudflare Pages), see delivery.md
docker/     World Cup sample Postgres init scripts
.github/    version-on-merge, build-desktop, publish-npm workflows
specs/      this specification
```

### Frontend: feature-based

Every feature gets its own folder under `src/app/features/` holding everything that belongs to it.

```
frontend/src/
├── app/
│   ├── features/<feature>/
│   │   ├── pages/<page>/<page>.ts|html|scss     routed views
│   │   ├── components/<component>/…              feature-internal building blocks
│   │   ├── services/<feature>.service.ts
│   │   ├── models/<feature>.model.ts
│   │   ├── store/<feature>.store.ts
│   │   └── <feature>.routes.ts                   lazy-loaded from app.routes.ts
│   ├── core/            app-wide singletons: auth, guards, interceptors, api, config
│   ├── shared/          components, directives, pipes, utils
│   ├── app.routes.ts
│   └── app.config.ts
└── main.ts
```

Rules:

- A new feature is a new folder in `src/app/features/<feature>/` with `pages/`, `components/`, `services/`, `models/`, `store/` as needed, and a `<feature>.routes.ts` lazy-loaded from `app.routes.ts`.
- `pages/` are routed views; `components/` are feature-internal. Each lives in its own folder with `.ts`, `.html` and `.scss` files.
- `core/` holds app-wide singletons (auth, guards, interceptors, API clients, config). It is loaded once and never imported by other features' templates.
- `shared/` holds reusable presentational components, directives, pipes and utils. No feature logic, no stateful services.
- Standalone components and signals only (no NgModules). Tailwind CSS v4 for styling; `lucide-angular` for icons.
- Electron IPC goes through `frontend/electron/preload.cjs` (`contextBridge`).

Current state versus the target above (verified against the code):

- The app is **not routed yet**: `app.routes.ts` exports an empty `Routes` array and the shell (`app.ts`) imports each feature's components directly. When the first routed view is introduced, adopt the `pages/` + lazy `<feature>.routes.ts` convention for it.
- Existing features: `agents`, `datasets`, `datasources`, `developer`, `knowledge`, `llm`, `sessions`, `testing-data`. They have `components/`, `services/` and (except `agents` and `testing-data`) `models/`; none has `pages/`, `store/` or a routes file.
- The metrics UI (`metrics-panel` component, `metrics-api.service`) lives inside `features/datasets`, not in a feature of its own.
- Populated `core/` folders: `config` (`api.config.ts`, `app-version.ts`), `backend-status`, `diagnostics`, `toast`. `core/api`, `auth`, `guards`, `interceptors` exist as empty placeholders.
- Populated `shared/` folders: `components` (`app-logo`, `backend-status-banner`, `system-logs-panel`, `toast-container`) and `pipes` (`markdown.pipe.ts`); `directives` and `utils` are empty placeholders.

### Backend: feature-based modules

```
backend/src/
├── modules/<feature>/
│   ├── <feature>.module.ts
│   ├── <feature>.controller.ts
│   ├── <feature>.service.ts
│   ├── dto/
│   ├── entities/
│   └── repositories/
├── common/              cross-cutting Nest building blocks: decorators, guards, interceptors, filters, pipes, exceptions
├── infrastructure/      technical concerns: database, messaging, cache, external-services
├── config/              typed configuration (app.config.ts, database.config.ts)
├── mastra/              agent harness (see below)
├── app.module.ts
├── app-bootstrap.ts     createApp(), shared by main.ts and the CLI
├── main.ts              Electron path: PORT env, CORS on
└── cli.ts               npm bin: questions-to-insights
```

Rules:

- A new feature is a new folder in `src/modules/<feature>/` with `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts` and `dto/`, `entities/`, `repositories/` as needed. Feature modules are registered in `app.module.ts` imports.
- `common/` is cross-cutting NestJS building blocks only. No feature logic.
- `infrastructure/` is technical concerns. Feature modules depend on infrastructure, never the reverse.
- `config/` is typed configuration files.

Current state (verified): existing modules are `agents`, `datasets`, `datasources`, `deep-analysis`, `developer-settings`, `knowledge`, `llm`, `metrics`, `sessions`, `testing-data`, `verified-queries`. `infrastructure/` has `crypto`, `database` and `developer-settings` (the developer-settings file reader, free of Nest imports so entry points can use it before bootstrap). `common/` and `config/` do not exist yet; create them when the first cross-cutting block or typed config appears.

Datastore pattern: a small `DocStore<T>` interface (`infrastructure/database/doc-store.ts`) with a better-sqlite3 adapter (`sqlite-doc-store.ts`): one table per collection, each row one JSON document, filters and sorts evaluated in-process. `DatabaseModule` is `@Global()` and exposes one injection token per collection (for example `CONNECTIONS_STORE`); repositories inject the token, never the db handle. A new collection is a `{ token, table }` entry in `COLLECTIONS` in `database.module.ts` plus a token in `doc-store.ts`. Renames need a migration (see [data-model.md](data-model.md)). Data directory: `APP_DATA_DIR`, else `<cwd>/data`.

Agent harness: `backend/src/mastra/` — `index.ts` builds the standalone Mastra instance and registers agents; `mastra.service.ts` is a thin DI wrapper (`MastraService.getAgent(id)`) so the rest of the backend stays Mastra-agnostic; `model-resolver.ts` and `model-compat.ts` bridge DI-less agents to the persisted LLM settings; `storage.ts` builds the composite store (LibSQL + DuckDB); `session-workspaces.ts` manages per-session filesystem workspaces; `agents/`, `tools/`, `skills/`, `evals/` hold the agents, their tools, prompt skills and eval suites. A new agent is a file in `mastra/agents/` plus its registration in `index.ts`. What each agent does: [agents.md](agents.md).

## Test layout

| Layer | Where | Runner | Notes |
|---|---|---|---|
| Frontend unit | `frontend/src/**/*.spec.ts`, beside the source | `ng test` (Karma + Jasmine, Chrome) | 8 specs today: app shell, system logs panel, log runs, metrics and sessions API services, knowledge list, visual panel, session chat. |
| Backend unit | `backend/src/**/*.spec.ts`, beside the source | Jest (`rootDir: src`, `ts-jest`, node env) | The bulk of the tests (33 specs). |
| Backend API-level e2e | `backend/test/*.e2e-spec.ts`, config `test/jest-e2e.json` | Jest | `answer-guards.e2e-spec.ts` runs the result guards against the seeded World Cup Postgres and **skips** (visibly) when the fixture is unreachable. Fixture connection helpers are in `test/world-cup.ts` (`WORLD_CUP_DB_HOST` default `localhost`, `WORLD_CUP_DB_PORT` default `55432`). `app.e2e-spec.ts` is the untouched Nest scaffold (expects `GET /` to return "Hello World!"); the full `AppModule` cannot boot under Jest because Mastra is ESM, so specs that need Nest import focused feature modules and default-import supertest. |
| Product e2e | `frontend/e2e/*.spec.ts` | Playwright driving the real Electron app | One spec file per Gherkin Feature: `agents`, `chat-and-visuals`, `diagnostics`, `layout-accessibility`, `world-cup-workflow`. Serial (`workers: 1`, `fullyParallel: false`), 60 s test timeout, 10 s expect timeout, traces/screenshots/video kept on failure, HTML report; one CI retry. |

Playwright specifics:

- Fixture `e2e/fixtures/electron.fixture.ts` extends the base test with `appDataDir` (a fresh temp dir per test), `electronApp` (launches `frontend/` via `_electron.launch`, `NODE_ENV=test`, `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR=<temp dir>` so the test never touches a developer's profile) and `page` (first window, waits for the "Open system logs" control). On failure it attaches `system-diagnostics.ndjson`, `electron-stdout.txt` and `electron-stderr.txt`. `e2e/helpers/app-actions.ts` holds shared UI actions.
- `e2e/global-setup.ts` aborts if the backend port is already in use (close any running app first, or pick another port), then runs `docker compose up -d --wait postgres` from the repo root. `E2E_SKIP_DOCKER=1` skips the compose step when an equivalent database is already running. `E2E_BACKEND_PORT` (default 3000) moves the app's backend: the fixture starts Electron with that `BACKEND_PORT` and routes the renderer's `localhost:3000` calls to it, so the suite can run beside a desktop app that holds 3000. Test-only: the renderer itself still calls port 3000 (BA-109).
- The World Cup sample database: `docker-compose.yml` service `postgres` (`postgres:16-alpine`, DB/user `world_cup`, password `world_cup_dev`, host port `${WORLD_CUP_DB_PORT:-55432}`), seeded from `docker/postgres/init/001_world_cup.sql` into schema `world_cup`. `world-cup-workflow.spec.ts` depends on it. See [delivery.md](delivery.md) for compose and isolation knobs.
- Visual baseline: `e2e/layout-accessibility.spec.ts-snapshots/application-shell-darwin.png` (macOS only; `maxDiffPixelRatio: 0.01`, animations disabled). Update only with `npm run test:e2e:update`, and only for an intended visual change.
- Before the suite runs, `npm run test:e2e:prepare` compiles the e2e TypeScript, builds the backend and builds the Angular app with `--base-href ./`, because the tests run the *built* app, not the dev server.

Other test-adjacent tooling in `backend/`: a golden-set evaluation harness (`npm run eval`, `eval/golden-set.json`), a live answer-quality gate that costs real model calls (`npm run check:answers`), the assistant eval CLI (`npm run evals:assistant`), and a World Cup REST API fixture for the REST connector. All are documented in [delivery.md](delivery.md).

## To rebuild on another stack

Load-bearing choices (change them and you change the product; the ADRs' *Context* sections are the constraints to honour):

| Choice | Why it is load-bearing | ADR |
|---|---|---|
| Desktop shell that spawns the API as a local child process, with a loopback HTTP API and a streaming (`text/event-stream`) chat endpoint | Single-app delivery with no system runtime; the same API serves the browser build. | ADR-0001 |
| Same UI and API shipped as an npm package that serves the UI itself (same origin, SPA fallback, CLI flags) | Second distribution channel with no code fork. | ADR-0002 |
| Local document store: one JSON document per row, one collection per table, in-process filtering, no server database | Zero-install, local-first data; the data-model migrations assume it. | ADR-0003 |
| An agent harness with per-session memory threads, per-session filesystem workspaces, tools, composite storage (runtime vs observability) and a model router that supports OpenAI-compatible and Anthropic providers | The assistant, designer, repair, verifier, bootstrap and judge agents all rely on it. | ADR-0004 |
| Visuals as versioned files in the session workspace, generated spec-first with a fixed runtime and a freeform fallback, shown in a sandboxed frame | Tailor, revert, refresh, repair and export all depend on this shape. | ADR-0005 |
| Secrets (LLM API keys) encrypted at rest with a per-install secret (`APP_SECRET`, persisted as `<data-dir>/.app-secret`) kept next to the data | Privacy and the backup guidance in [product/non-functional.md](../product/non-functional.md). | none yet (candidate ADR) |
| Read-only SQL guard in the connectors (`runReadOnlySql`: only `SELECT`/`WITH` statements) | Safety property of the product, specified in [capabilities/datasources/spec.md](../capabilities/datasources/spec.md). | none yet (candidate ADR) |

Free to replace: Angular (any SPA framework that satisfies [ui.md](ui.md) and the Playwright specs), Tailwind, lucide, NestJS (any server that honours [api.md](api.md)), Express, Jest/Karma, the specific SQLite binding, Playwright (any tool that can drive the desktop app), and npm as package manager. The contracts in [api.md](api.md), [data-model.md](data-model.md), [agents.md](agents.md) and [ui.md](ui.md) are what must survive.

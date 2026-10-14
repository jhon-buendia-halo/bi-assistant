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
| `@fontsource/noto-sans` | 5.3.0 | The bundled Noto Sans webfont (OFL-1.1), Latin subset, weights 400/500/600/700, listed in the `styles` of `angular.json` so the font files ship with the renderer ([ui.md](ui.md) §6.2). |
| marked | 18.0.13 | Renders assistant markdown in the chat (`shared/pipes/markdown.pipe.ts`). |
| DOMPurify | 3.4.15 | Sanitises the HTML `marked` produces before it is bound into the page. |
| Tiptap (`@tiptap/core`, `@tiptap/pm`, `@tiptap/extension-document`, `-paragraph`, `-text`, `-mention`, `@tiptap/extensions`, `@tiptap/suggestion`) | 3.31.3 (all, pinned exact) | The link editor of an agent's instructions and a skill's body (ui.md 4.5.5, ADR-0024). Loaded lazily with a dynamic `import()`, so it stays out of the initial bundle. |
| tslib | ^2.3.0 | TypeScript helpers (`importHelpers`). |
| Playwright (`@playwright/test`) | 1.63.0 | End-to-end tests. They drive the web app in Chromium by default and the real Electron app (`_electron.launch`) in the `desktop` project. |
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
| `openid-client` | 6.8.8 | Org server mode only (ADR-0011): OpenID Connect discovery, authorization code flow with PKCE, ID token validation. ESM-only, so it is loaded lazily with `await import()` behind an `OidcClient` interface (`modules/auth/oidc/`), which unit tests mock; it is never loaded in local mode. A plain-`http://` issuer (development and the E2E stub) is allowed through its `allowInsecureRequests` option. Not to be confused with `openid-client@5`, which `@databricks/sql` brings in (npm nests it under that package). |
| `cookie` | 1.1.1 | Parses and serialises the `qti_session` and `qti_oidc` cookies ([api.md](api.md) 1.9). |
| sanitize-html | 2.17.7 | Sanitises that HTML (and other generated markup) on the server. |
| Node built-ins | | `node:util` `parseArgs` (CLI), `node:net`, `node:fs`, `node:crypto` (API-key encryption in `infrastructure/crypto`, keyed by `APP_SECRET`; in org server mode also auth-session tokens and their SHA-256, sealing the `qti_oidc` cookie, and the constant-time SCIM token check), `node:async_hooks` `AsyncLocalStorage` (the current user, ADR-0011), `node:http` (World Cup test REST API, the E2E OIDC stub). |
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

- The app is **not routed yet**: `app.routes.ts` exports an empty `Routes` array and the shell (`app.ts`, `app-shell`) imports each feature's components directly. `main.ts` bootstraps `root.ts` (`app-root`), which loads the current user and then shows the shell, or the sign-in page on an org server without an auth session. When the first routed view is introduced, adopt the `pages/` + lazy `<feature>.routes.ts` convention for it.
- Existing features: `admin`, `agents`, `appearance`, `datasets`, `datasources`, `developer`, `knowledge`, `llm`, `sessions`, `testing-data`. They have `components/`, `services/` and (except `agents` and `testing-data`) `models/`; none has `pages/`, `store/` or a routes file.
- The metrics UI (`metrics-panel` component, `metrics-api.service`) lives inside `features/datasets`, not in a feature of its own.
- Populated `core/` folders: `config` (`api.config.ts`, `app-version.ts`), `backend-status`, `diagnostics`, `theme` (`theme.service.ts`: the Appearance choice, the resolved theme and the `data-theme` attribute), `toast`. The theme tokens live in `src/styles/tokens.css` (light values from the Insight Agent AI Figma variables) and the shared component classes in `src/styles/components.css`, both imported by `src/styles.scss`; Figma brand assets (frame texture and banner as WebP, logo, LenAI marks, sparks, page-header and data-sources icons) live in `public/brand/agentic-hub/`; the pre-boot theme script is inline in `src/index.html`. `core/api` and `guards` exist as empty placeholders.
- **Org server mode (BA-163):** `core/auth/` holds `auth.models.ts` (the `GET /me` shape, the permission ids, the local sign-in user shape, the local session storage key and the sign-in and permission copy), `auth.service.ts` (loads `GET /me` before the other bootstrap loads, with the status `loading` / `signed-in` / `signed-out`; exposes the user, the mode and `can(permission)`, a signal read; signs in and out; `refusalOf(status)` applies the 401/403 handling to a `fetch`), `auth.testing.ts` (unit-test data), the sign-in page component (`sign-in-page/`) and the rail's account menu (`account-menu/`). `core/interceptors/auth.interceptor.ts` (registered with `withInterceptors` in `app.config.ts`) turns a 401 into the sign-in page and a 403 into the permission toast; the streaming `fetch` paths in `sessions-api.service.ts` and `knowledge-api.service.ts` call `refusalOf`. Components hide controls with `auth.can(...)` in their templates. The Admin area lives in `features/admin/` (BA-164 to BA-167): `components/` holds the frame (`admin-area/`: the header with each tab's action, Export report's download and the tabs), one component per tab (`admin-overview/`, `admin-users/`, `admin-roles/`), the user detail panel (`user-detail-panel/`), the dialogs (`admin-dialog/`, the shared frame with focus handling, then `transfer-agents-dialog/` for Assign an owner and Transfer ownership, `inactive-makers-dialog/`, `assign-role-dialog/`, `add-mapping-dialog/`), the `directory-picker/` combobox and the shared Role and Datasource selects (`role-fields/`). `services/admin-api.service.ts` calls the admin API ([api.md](api.md) 2.15), `services/admin-format.ts` formats times, counts and captions, and `services/user-roles.ts` turns a user's held roles into the panel's checkboxes and the direct roles Save changes sends. `models/admin.models.ts` holds the API shapes and the role, status, badge and permission-matrix copy; `testing/admin.fixtures.ts` the unit-test data. Each tab is created when selected, so it loads each time (admin R38).
- **Local mode sign-in (2.1.7, ADR-0012):** `auth.service.ts` also holds the mode (`org` | `local` | `unknown`, the last when the backend can't be reached), keeps the local token in `localStorage` (`questions-to-insights:local-session`) and exposes it as `authHeaders()`, and loads the personas (`loadLocalUsers()`) and signs in as one (`signInLocal(userId)`); there is no built-in local user any more, so a 401 always shows the sign-in page. `auth.interceptor.ts` adds `Authorization: Bearer <token>` to API requests while a token is stored, and the two streaming `fetch` calls spread `authHeaders()` into their headers. The sign-in page component has three branches: org, local (the **Sign in as** select) and unreachable. The Admin components pick their local-mode copy (ui.md 4.18.6) from `auth.isLocal()`. `electron/main.cjs` probes `GET /me`, ready on 200 or 401.
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

Current state (verified): existing modules are `agents`, `datasets`, `datasources`, `deep-analysis`, `developer-settings`, `knowledge`, `llm`, `metrics`, `sessions`, `testing-data`, `verified-queries`.

Org server mode (BA-163) adds:
- `config/org-server.config.ts`: reads and validates the `ORG_*` variables ([api.md](api.md) 6.1) once at startup and decides the mode; partial configuration throws.
- `modules/auth/`: `auth.controller.ts` (`/auth/login`, `/auth/callback`, `/auth/logout`) and `sign-in.service.ts` (the round trip, just-in-time users), `me.controller.ts` (`GET /me`), `scim/` (the hand-written SCIM `Users`, `Groups` and discovery controllers, `scim.service.ts` with the mapping, and `scim-error.ts`, an exception filter that answers `ScimError`s in SCIM format), `oidc/` (the `OidcClient` interface and its lazy `openid-client` implementation), `current-user.service.ts` (`AsyncLocalStorage`; its mode comes from the org server configuration), `current-user.middleware.ts` and `origin-check.middleware.ts` (applied to every route by `AuthModule`), `auth-sessions.service.ts` (the `qti_session` token, expiry and idle end, startup sweep), `auth-cookies.ts`, `role-resolver.ts` and `permissions.ts` (the fixed matrix, [admin](../capabilities/admin/spec.md) R21), `activity.service.ts` (the activity recorder), and `repositories/` for the identity and access collections (`directory.repository.ts` for users, groups and memberships; `roles.repository.ts` for assignments and group mappings; `auth-sessions.repository.ts`; activity events are written by the recorder through their store token).
- `modules/admin/`: `admin.controller.ts` (every `/admin` route, api.md 79-90), `admin.service.ts` (the writes: role assignments, saving a user's roles, agent transfers and group mappings, each in one store transaction), `admin-read.service.ts` (users, user detail, groups, mappings), `admin-overview.service.ts` (the Overview and its CSV), `admin-directory.reader.ts` (one read of the directory, roles, agents and datasources per request, with the derivations of [data-model.md](data-model.md) 3.14.8), the pure `admin-figures.ts` (status, last activity, weekly buckets), `activity-sentences.ts` (Recent activity) and `admin-csv.ts` (the export and its formula guard), and `repositories/all-owners-agents.repository.ts`, the one request-time reader and writer of agents across owners (data-model 3.15).
- `common/decorators/auth-requirement.decorators.ts` (`@RequirePermission(id)`, `@Public()`, `@ScimAuth()`, one metadata key, so a route holds exactly one requirement; on a controller class it covers every route, and a handler's own marker wins), `common/guards/permissions.guard.ts` (registered as a global `APP_GUARD` by `AuthModule`; in its `onModuleInit` it walks every controller route with Nest's `DiscoveryService` and throws, naming each `METHOD /path (Controller.method)`, if one has no marker), and the Origin check middleware for org server mode. `@OrgServerOnly()` (a second metadata key) marks the org auth and SCIM controllers, which the guard answers with 404 in local mode, and `@LocalModeOnly()` the local auth controller, which it answers with 404 in org server mode (admin R73); for `@ScimAuth()` routes the guard checks the bearer token and records the throttled `scim.request` event.
- Shipped in BA-163 slice S1: `modules/auth/` with `auth.module.ts` (global; applies `current-user.middleware.ts` to every route, which runs the rest of the request inside `CurrentUserService.runAs`), `current-user.service.ts` (in local mode every request and any code outside a request ran as `LOCAL_USER`, until local mode gained sign-in in 2.1.7), `entities/current-user.entity.ts` (`CurrentUser`, `HeldRole`, `MeView`), `permissions.ts` and `me.controller.ts`; the decorators and the guard above, applied to every existing route as in [api.md](api.md) 1.9. Slice S3 added org server mode: the configuration, sign-in, auth sessions, SCIM, role resolution, activity events and the role-assignment routes listed above (in org server mode code outside a request runs as nobody).
- `infrastructure/database/owned-doc-store.ts`: `OwnedDocStore<T>`, which stamps and filters `ownerId` ([data-model.md](data-model.md) 3.15), with an owned injection token per private collection beside the raw one.

Local mode sign-in (2.1.7, ADR-0012) adds, in `modules/auth/local/`: `local-personas.ts` (the five personas and their seeds, admin R69), `local-directory.service.ts` (`LocalDirectoryService`, a no-op in org server mode: at startup it creates the missing personas with their fixed ids and `source: "local"` and applies each seed once through the `local-seed` document, data-model 3.2.2; it makes Dana Data Owner Data owner of every datasource, and `datasources.service.ts` calls it when it saves a new one) and `local-auth.controller.ts` (`/auth/local/users`, `/auth/local/sign-in`, `/auth/local/sign-out`, api.md 91-93). `auth-sessions.service.ts` reads the token from the `qti_session` cookie on an org server and from the `Authorization: Bearer` header in local mode (30-day sessions, no idle end), and the current-user middleware takes one path in both modes. `CurrentUserService.current()` answers only the request's user, so code outside a request runs as nobody in both modes; `LOCAL_USER` is Demo User, and the assistant eval CLI (`mastra/evals/run-assistant-evals.ts`) runs its whole body inside `runAs(LOCAL_USER, …)`. `role-resolver.ts` treats `demo@local.test` as the only bootstrap admin in local mode. `database.module.ts` runs M13 (`backfillLocalOwners`) after the field renames, in local mode only.
- `app-bootstrap.ts` loads the org server configuration before creating the app (a partial one throws), sets Express `trust proxy` to 1 and ignores the `cors` option in org server mode, and registers the JSON body parser for both `application/json` and `application/scim+json`. `infrastructure/` has `crypto`, `database` and `developer-settings` (the developer-settings file reader, free of Nest imports so entry points can use it before bootstrap). `common/` holds the auth decorators and the permissions guard; `config/` holds `org-server.config.ts` (free of Nest imports, so the CLI banner and `app-bootstrap.ts` read it too).

Datastore pattern: a small `DocStore<T>` interface (`infrastructure/database/doc-store.ts`) with a better-sqlite3 adapter (`sqlite-doc-store.ts`): one table per collection, each row one JSON document, filters and sorts evaluated in-process. `DatabaseModule` is `@Global()` and exposes one injection token per collection (for example `CONNECTIONS_STORE`); repositories inject the token, never the db handle. A new collection is a `{ token, table }` entry in `COLLECTIONS` in `database.module.ts` plus a token in `doc-store.ts`. Renames need a migration (see [data-model.md](data-model.md)). Data directory: `APP_DATA_DIR`, else `<cwd>/data`.

Agent harness: `backend/src/mastra/` — `index.ts` builds the standalone Mastra instance and registers agents; `mastra.service.ts` is a thin DI wrapper (`MastraService.getAgent(id)`) so the rest of the backend stays Mastra-agnostic; `model-resolver.ts` and `model-compat.ts` bridge DI-less agents to the persisted LLM settings; `storage.ts` builds the composite store (LibSQL + DuckDB); `session-workspaces.ts` manages per-session filesystem workspaces; `agents/`, `tools/`, `skills/`, `evals/` hold the agents, their tools, the built-in skills (`skills/<name>/SKILL.md` with `phases/` and `reference/`; `app-skills.ts` loads and checks them, agents.md 7.3) and eval suites. A new agent is a file in `mastra/agents/` plus its registration in `index.ts`. What each agent does: [agents.md](agents.md).

## Test layout

| Layer | Where | Runner | Notes |
|---|---|---|---|
| Frontend unit | `frontend/src/**/*.spec.ts`, beside the source | `ng test` (Karma + Jasmine, Chrome) | 8 specs today: app shell, system logs panel, log runs, metrics and sessions API services, knowledge list, visual panel, session chat. |
| Backend unit | `backend/src/**/*.spec.ts`, beside the source | Jest (`rootDir: src`, `ts-jest`, node env) | The bulk of the tests (33 specs). |
| Backend API-level e2e | `backend/test/*.e2e-spec.ts`, config `test/jest-e2e.json` | Jest | `answer-guards.e2e-spec.ts` runs the result guards against the seeded World Cup Postgres and **skips** (visibly) when the fixture is unreachable. Fixture connection helpers are in `test/world-cup.ts` (`WORLD_CUP_DB_HOST` default `localhost`, `WORLD_CUP_DB_PORT` default `55432`). `app.e2e-spec.ts` is the untouched Nest scaffold (expects `GET /` to return "Hello World!"); the full `AppModule` cannot boot under Jest because Mastra is ESM, so specs that need Nest import focused feature modules and default-import supertest. Local mode: `local-auth.e2e-spec.ts` (`GET /me` answers 401 with `mode: "local"` before sign-in; `GET /auth/local/users` lists the five personas with their roles; signing in returns a token, and `GET /me` with it answers Demo User as a bootstrap Platform admin with every permission, or Uma User with the User role only; Uma User gets 403 on Maker and admin routes; removing Demo User's Platform admin is refused; the org-only routes answer 404; M13 gives a legacy ownerless session to Demo User and not to Uma User; Mark Maker's removed Maker role stays removed after a restart; Dana Data Owner gets Data owner on a new datasource; sign-in and sign-out record activity) and `response-status.e2e-spec.ts` (the POST routes [api.md](api.md) 1.4 answers with 200: both streams, even when they carry an `error` event, the developer endpoint test and the testing-data load). Org server mode: `org-auth.e2e-spec.ts` (401, 403, Origin check, sign-in round trip, `GET /me`), `scim.e2e-spec.ts` (the SCIM subset, deactivation, group mappings), `owner-isolation.e2e-spec.ts` (two users, one check per private collection) and `org-admin.e2e-spec.ts` (the admin routes 81-90: the 403s, the users and groups tables, saving roles all or nothing, transfers and their conflicts, group mappings, the Overview figures from seeded activity, agent errors from a failing turn, the CSV) spawn the built server in org server mode against the OIDC stub `test/oidc-stub.ts`: a hand-rolled `node:http` provider (discovery, authorize, token with PKCE, JWKS, end session) that signs RS256 ID tokens with `node:crypto` and lets a test choose the next user to sign in. A stub user sets the `email` and `preferred_username` claims independently (`{ email?, preferredUsername? }`, each defaulting to the other), and `sub` defaults to a hash of the `preferred_username`, so a test can send an email claim that differs from the sign-in name (admin R13). `startOidcStub({ user?, clientId?, clientSecret?, port? })` resolves to `{ issuer, clientId, clientSecret, signInAs(user | email | null), failNextSignIn(error?), endSessionCalls, close() }`; the issuer is `http://127.0.0.1:<port>/oidc`, and the authorize step signs in the chosen user without a login page (`null` answers `error=login_required`). `test/org-server.ts` (`startOrgServer({ bootstrapAdmins })`) starts the stub and the built server with the `ORG_*` environment, and offers `signIn(user)` (the real `/auth/login` → stub → `/auth/callback` round trip, resolving to the `qti_session` cookie), `api()`, `scim()`, and direct access to `app.sqlite` for what has no API: `sql()`, `insertDoc(table, doc)`, `patchDoc(table, match, patch)` and `docs(table)` (shared fixtures, agents of several owners, past activity and other clock changes). `test/backend-process.ts` waits for `GET /me` (200 or 401) and has `bootFailure()` for startup errors, `signInLocally(url, userId = 'local')` (`POST /auth/local/sign-in`, resolving to the token) and `bearer(token)` (the header); the local-mode specs (`local-auth`, `response-status`, `user-agents`, `agent-sessions`) sign in with them. |
| Product e2e | `frontend/e2e/*.spec.ts` | Playwright: project `web` (default, Chromium against the npm CLI in local mode), project `desktop` (the real Electron app) and project `org` (Chromium against the npm CLI in org server mode) | One spec file per Gherkin Feature: `agents`, `chat-and-visuals`, `diagnostics`, `layout-accessibility`, `world-cup-workflow`, `local-sign-in` and the others named in the capability specs. Serial (`workers: 1`, `fullyParallel: false`), 60 s test timeout, 10 s expect timeout, traces/screenshots/video kept on failure, HTML report; one CI retry. |

Playwright specifics:

- Fixture `e2e/fixtures/app.fixture.ts` extends the base test with the worker option `target` (`web` | `desktop`, set per Playwright project) and:
  - `appDataDir`: a fresh temp dir per test.
  - `launchApp(dir, env)`: starts an app on that dir and closes it after the test. On `web` it spawns `backend/dist/cli.js --no-open --host 127.0.0.1 --port 0 --data-dir <dir>` with `NODE_ENV=test`, waits for the printed `URL:`, and opens it in a new Chromium context at 1440×900, the Electron window size. Chromium is launched lazily, once per worker, and never on `desktop`. On `desktop` it runs `_electron.launch` on `frontend/` with `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR=<dir>`, after checking port 3000 is free. Both then sign in (below) and wait for the "Open system logs" control.
  - **Sign-in (2.1.7).** The options `autoSignIn` (default `true`) and `signInAs` (default `local`, Demo User) decide who the app opens as. On `web` the fixture signs in through `POST /auth/local/sign-in` from Node and stores the token with a context init script before the first page load; on `desktop` it sets the token in `localStorage` and reloads. With `autoSignIn: false` (as in `local-sign-in.spec.ts`) it waits for the sign-in page instead. The running app also offers `signInAs(userId)` and `signOut()`. `e2e/helpers/local-auth.ts` holds `LOCAL_SESSION_KEY`, `LOCAL_USERS` (`demo` `local`, `uma` `local-uma`, `mark` `local-mark`, `dana` `local-dana`, `avery` `local-avery`), `signInLocally(baseUrl, userId)`, `authHeaders(page)` (the stored token as a header) and `apiFetch(page, method, path, data?)`, which the specs and helpers use for every API call they make from Node (`agents-api.ts`, `app-actions.ts`).
  - `app` and `page`: one app launched on `appDataDir`. `app.target` and `app.electronApp` (desktop only) let a test branch per target. `app.restartCli()` (web only) stops the CLI, starts it on the same port and data dir, and reloads the page.
  - `desktopOnly(reason)` / `webOnly(reason)`: called inside a `describe`, they skip its tests on the other target with the reason "Desktop only: …" / "Web only: …".
  - On failure it attaches `system-diagnostics.ndjson` and each app's stdout and stderr. `e2e/helpers/app-actions.ts` holds shared UI actions.
- **Org server mode (BA-163).** The `org` project runs only `e2e/org-*.spec.ts` (`testMatch`); the `web` and `desktop` projects ignore those files (`testIgnore`), so `npm run test:e2e` stays a local-mode run. Its fixture `e2e/fixtures/org.fixture.ts` extends the app fixture:
  - `launchOrgApp(options)`: starts the OIDC stub (`backend/test/oidc-stub.ts`, the same one the backend tests use) on a free port, picks a free port for the app, and spawns the CLI on `appDataDir` with `--port <that port>` and `ORG_OIDC_ISSUER` (the stub), `ORG_OIDC_CLIENT_ID`, `ORG_OIDC_CLIENT_SECRET`, `ORG_PUBLIC_BASE_URL=http://127.0.0.1:<port>`, a generated `ORG_SCIM_TOKEN` and `ORG_BOOTSTRAP_ADMINS` (default `admin@contoso.test`). It resolves to an `OrgApp`: `url`, `stub`, `scim` (the SCIM client), `admin` (the admin helper), `willSignInAs(person)` (who the stub signs in next), `newPage()` (a new, isolated browser context on the app; it waits for **Sign in with Microsoft** or **Open system logs**) and `sql()` (SQL on `app.sqlite` while the app runs, through the backend's `better-sqlite3`, for what has no API, such as ending an auth session).
  - `org` is one such app; `page` (replacing the app fixture's, so no local-mode app starts) is a page on it, on the sign-in page. `signInAs(page, person)` tells the stub who signs in next, clicks **Sign in with Microsoft** and waits for the shell. `newBrowserAs(person)` opens another isolated browser context signed in as another person.
  - `e2e/helpers/scim-client.ts`: the people the Features name (`ADMIN` Avery Admin, `ADA`, `GRACE`); `stubUser(person)`, whose `preferred_username` is always the email, matching the SCIM `userName`, since sign-in and the bootstrap admin list match on it; a small `ScimClient` (create, find, deactivate and delete users; create groups, add members, delete groups); and an `AdminClient` that signs in as the bootstrap admin through the real round trip and calls the API with its cookie and the Origin: `assignRole(person, role)` and `removeRole(person, role)` through `/admin/role-assignments` (provisioning the person through SCIM first when needed), and `seedWorldCup()` (the shared World Cup datasource and the "World Cup Core" dataset).
  - `e2e/helpers/org-actions.ts`: shared locators and steps (the sign-in button, the rail, the account menu, the Settings sections, the composer's Reasoning effort), the System-theme setup and the axe scan in both themes, and `pageApi(page, …)` for API calls from a signed-in page with the Origin an org server requires.
  - `e2e/tsconfig.json` turns off `noPropertyAccessFromIndexSignature`, because it type-checks `backend/test/oidc-stub.ts`, written for the backend's compiler settings.
- `e2e/global-setup.ts` runs `docker compose up -d --wait postgres` from the repo root. `E2E_SKIP_DOCKER=1` skips the compose step when an equivalent database is already running.
- **Another World Cup database.** `E2E_WORLD_CUP_DB_HOST`, `_PORT`, `_NAME`, `_USER` and `_PASSWORD` point the suite at any PostgreSQL holding the seeded `world_cup` schema, for example a per-worktree database from the infra MCP service. When `E2E_WORLD_CUP_DB_HOST` is set, global setup does not touch Docker. `playwright.config.ts` loads these variables from a git-ignored `.env.e2e.local` at the repository root; variables already in the environment win. The defaults are the compose database (`127.0.0.1`, `WORLD_CUP_DB_PORT` or `55432`, `world_cup`/`world_cup`/`world_cup_dev`). Because a PostgreSQL entity's catalog segment is the database name, the helpers derive catalog test ids and entity keys from `E2E_WORLD_CUP_DB_NAME` (`e2e/helpers/world-cup-db.ts`). Seed a new database once with the app's own loader: `POST /testing-data/world-cup/load` with its connection (testing-data R10-R16).
- The World Cup sample database: `docker-compose.yml` service `postgres` (`postgres:16-alpine`, DB/user `world_cup`, password `world_cup_dev`, host port `${WORLD_CUP_DB_PORT:-55432}`), seeded from `docker/postgres/init/001_world_cup.sql` into schema `world_cup`. `world-cup-workflow.spec.ts` depends on it. See [delivery.md](delivery.md) for compose and isolation knobs.
- Visual baselines, one per target and platform: `e2e/layout-accessibility.spec.ts-snapshots/application-shell-web-linux.png` (web, Linux) and `application-shell-darwin.png` (desktop, macOS). Set by each project's `snapshotPathTemplate`; `maxDiffPixelRatio: 0.01`, animations disabled. Update only with `npm run test:e2e:update` (web) or `test:e2e:desktop:update`, and only for an intended visual change.
- Before the suite runs, `npm run test:e2e:prepare` compiles the e2e TypeScript and runs the backend's `build:all` (backend plus web UI in `backend/public/`). `test:e2e:prepare:desktop` builds the backend and the Angular app with `--base-href ./` instead. Either way the tests run the *built* app, not the dev server.

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

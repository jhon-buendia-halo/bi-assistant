# Architecture

Architectural decisions recorded against the [C4 model](https://c4model.com/) (System Context → Containers → Components → Code). See *Architecture convention* in [CLAUDE.md](../../CLAUDE.md). This file describes the current implementation; see *Stack neutrality* in [specs/README.md](../README.md). ADRs are never edited in substance — supersede them with a new ADR.

ADR template:

```
#### ADR-NNNN — <Title>
- **Status:** Proposed | Accepted | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD
- **Context:**
- **Decision:**
- **Consequences:**
```

The ADRs below marked *retroactive* document decisions already in place when this file was created. Their operational detail lives in the other system specs: [tech-stack.md](tech-stack.md), [delivery.md](delivery.md), [data-model.md](data-model.md), [agents.md](agents.md) and [api.md](api.md).

## Level 1 — System Context

```mermaid
flowchart LR
  analyst["Analyst<br/>(person)"]
  member["Organisation member<br/>(person, browser; org server mode)"]
  admin["Platform admin<br/>(person; org server mode)"]

  subgraph qti["Questions to Insights"]
    system["Questions to Insights<br/>(Electron desktop app, npx web app,<br/>or self-hosted org server)"]
  end

  idp["Microsoft Entra ID<br/>(OIDC sign-in, SCIM provisioning;<br/>org server mode only)"]

  subgraph sources["User datasources"]
    pg[("PostgreSQL")]
    dbx[("Databricks SQL warehouse")]
    rest["REST / OpenAPI services"]
  end

  subgraph llms["LLM providers"]
    lenai["LenAI<br/>(OpenAI-compatible gateway)"]
    anthropic["Anthropic API"]
    openai["OpenAI API<br/>(configured, or OPENAI_API_KEY fallback)"]
  end

  subgraph gh["GitHub (distribution)"]
    releases["GitHub Releases<br/>(desktop installers)"]
    packages["GitHub Packages<br/>(npm package)"]
  end

  analyst -->|"asks questions, tailors visuals"| system
  member -->|"signs in, asks questions (HTTPS via the org's TLS proxy)"| system
  admin -->|"manages users and roles"| system
  member -->|"authenticates"| idp
  system -->|"OIDC: discovery, code exchange, JWKS"| idp
  idp -->|"SCIM 2.0: users, groups, memberships (bearer token)"| system
  analyst -->|"downloads installer"| releases
  analyst -->|"npx / npm i -g (read:packages PAT)"| packages
  system -->|"read-only SQL, schema discovery, sample rows"| pg
  system -->|"read-only SQL, catalog discovery"| dbx
  system -->|"HTTP requests, OpenAPI discovery"| rest
  system -->|"chat completions (HTTPS)"| lenai
  system -->|"messages API (HTTPS, API key)"| anthropic
  system -->|"chat completions (HTTPS)"| openai
```

*System context: the analyst uses Questions to Insights, which queries the user's datasources (PostgreSQL, Databricks, REST/OpenAPI), calls the configured LLM provider, and is distributed through GitHub Releases and GitHub Packages. In org server mode, organisation members reach a self-hosted server from a browser and sign in with Microsoft Entra ID, which also pushes the directory to the server through SCIM.*


The user asks questions of their data in plain language; Questions to Insights answers with SQL, results, and interactive visuals. External systems: the user's datasources (PostgreSQL, Databricks SQL, REST/OpenAPI), an LLM provider (OpenAI-compatible / LenAI, Anthropic, OpenAI), GitHub (releases, GitHub Packages), and in org server mode the identity provider (Microsoft Entra ID, for OpenID Connect sign-in and SCIM 2.0 provisioning). Two modes run the same build (ADR-0010): **local mode**, one machine with five seeded personas to sign in as, without a password (ADR-0012; the desktop app always, the npx web app by default), and **org server mode**, many users of one organisation on a server it hosts.

## Level 2 — Containers

```mermaid
flowchart TB
  analyst["Analyst"]

  subgraph desktop["Desktop delivery (Electron)"]
    main["Electron main process<br/>(frontend/electron/main.cjs)"]
    preload["Preload bridge<br/>(electron/preload.cjs)"]
    renderer["Angular renderer<br/>(frontend/src)"]
  end

  subgraph web["Web delivery (npm package)"]
    browser["Browser tab<br/>(bundled Angular build)"]
    cli["npm CLI<br/>(backend/src/cli.ts)"]
  end

  subgraph org["Org server mode (same npm CLI, ORG_* configuration)"]
    member["Organisation member's browser"]
    proxy["Organisation's reverse proxy<br/>(TLS, public hostname)"]
  end

  entra["Microsoft Entra ID<br/>(OIDC provider, SCIM client)"]

  backend["NestJS backend<br/>(backend/src, createApp)<br/>API + Mastra agents"]

  subgraph data["APP_DATA_DIR (userData, or ~/.questions-to-insights for the CLI)"]
    appdb[("app.sqlite<br/>(better-sqlite3 DocStore;<br/>org mode adds users, groups,<br/>roles, auth sessions, activity)")]
    mastradb[("mastra.sqlite<br/>(LibSQL memory, threads)")]
    obsdb[("observability.duckdb<br/>(Mastra traces)")]
    ws["workspaces/session-id<br/>(filesystem: visuals, reports)"]
  end

  ext["External: datasources, LLM providers"]
  devtools["Developer only: OTLP endpoint<br/>(Grafana otel-lgtm)"]
  phoenix["Developer only: Arize Phoenix"]

  analyst --> renderer
  analyst --> browser
  main -->|"spawns child process<br/>(ELECTRON_RUN_AS_NODE=1, PORT, APP_DATA_DIR, APP_SECRET)"| backend
  main -->|"readiness probe: HTTP GET /sessions"| backend
  main -->|"loadFile index.html over file://<br/>(dev: http://localhost:4200)"| renderer
  main <-->|"IPC: diagnostics, backend-status"| preload
  preload <-->|"contextBridge"| renderer
  renderer -->|"HTTP JSON + SSE (fetch stream)<br/>http://localhost:3000, CORS on"| backend
  browser -->|"HTTP same-origin: UI (public/), API, SSE"| cli
  cli -->|"in-process createApp()<br/>--port (default 3000), --host 127.0.0.1"| backend
  cli -->|"opens URL (unless --no-open)"| browser
  member -->|"HTTPS: UI, API, SSE<br/>(qti_session cookie)"| proxy
  proxy -->|"HTTP + X-Forwarded-*<br/>(--host 0.0.0.0)"| cli
  member -->|"sign-in redirect"| entra
  backend -->|"OIDC discovery, token exchange, JWKS"| entra
  entra -->|"SCIM 2.0 over HTTPS via the proxy<br/>(bearer token)"| proxy
  backend -->|"SQL (better-sqlite3)"| appdb
  backend -->|"LibSQL (@mastra/libsql)"| mastradb
  backend -->|"DuckDB (@mastra/duckdb)"| obsdb
  backend -->|"fs read/write (Mastra workspace)"| ws
  backend -->|"pg / @databricks/sql / HTTPS"| ext
  backend -.->|"OTLP traces, metrics + logs,<br/>only when developer observability is on"| devtools
  backend -.->|"agent traces (OpenInference),<br/>only when developer observability is on"| phoenix
```

*Containers: the two delivery modes (Electron spawning the backend as a child process, or the npm CLI serving backend + bundled UI to a browser) share one NestJS backend and its on-disk stores under `APP_DATA_DIR`. In org server mode the same CLI runs behind the organisation's TLS proxy, and the backend talks to Entra ID for sign-in and receives SCIM pushes from it.*


- **Electron main process** (`frontend/electron/main.cjs`) — window shell; spawns and kills the backend.
- **Angular renderer** (`frontend/src/`) — the UI.
- **NestJS backend** (`backend/src/`) — API, Mastra agents, SQLite app store, per-session workspaces.
- **npm CLI** (`backend/src/cli.ts`) — serves the same backend + bundled UI in a browser. With the `ORG_*` configuration it is the **org server** (ADR-0010): no new container, the backend gains an auth module (OIDC sign-in, SCIM, roles, owner scoping; ADR-0011) and is reached through the organisation's reverse proxy. How to run it: [delivery.md](delivery.md) section 4.1.

#### ADR-0001 — Electron desktop app with an Angular renderer and a NestJS child-process backend *(retroactive)*
- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** A single installable app is needed with no system Node dependency.
- **Decision:** Electron main spawns the NestJS backend with `ELECTRON_RUN_AS_NODE=1` on port 3000; the renderer talks to it over HTTP.
- **Consequences:** Packaging must stage backend `node_modules` as `extraResources`; native modules (better-sqlite3) must match Electron's ABI.

#### ADR-0002 — Ship the same app as an npm package served in the browser *(retroactive)*
- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** Developers want to run the app without installing a desktop build.
- **Decision:** The backend is the npm package; it bundles the Angular build and serves it same-origin via `createApp()` with a SPA fallback.
- **Consequences:** Separate default data dir (`~/.questions-to-insights`) to avoid SQLite lock contention with the desktop app; `API_BASE_URL` differs by runtime.

#### ADR-0006 — Opt-in developer observability through OpenTelemetry, Arize Phoenix and Grafana `otel-lgtm`
- **Status:** Accepted
- **Date:** 2026-10-05
- **Context:**
  - Agent traces only reach `observability.duckdb`, which has no viewer. Nest and agent logs are two unlinked streams, and HTTP, Postgres and connector calls aren't traced at all. Developers need a local view of all of it ([BA-111](https://halo-powered.atlassian.net/browse/BA-111)).
  - End-user installs must not change: no new exporters, no network traffic, the same embedded stores.
  - OpenTelemetry auto-instrumentation only patches modules loaded after the SDK starts. `APP_DATA_DIR` is already read at import time.
- **Decision:**
  - Two new external systems, used only on a developer's machine: **Arize Phoenix** for agent and LLM traces, and **Grafana `otel-lgtm`** (OTLP collector, Tempo, Loki, Prometheus) for HTTP, NestJS, Postgres and connector traces, metrics and logs. Both run from an opt-in `observability` Docker Compose profile.
  - A **Developer observability** setting (enabled flag, Phoenix endpoint, OTLP endpoint), off by default and edited in a "Developer" Settings section. It is stored as a JSON file under `APP_DATA_DIR`, not in `app.sqlite`, so the entry points can read it synchronously before any app module loads.
  - The backend entry points (`main.ts`, `cli.ts`) read the file first. Only when it is enabled do they start the OpenTelemetry Node SDK with auto-instrumentation. Then they dynamically import the app. When it is off, no OpenTelemetry or exporter module is imported.
  - When it is enabled, the Mastra `Observability` config adds a Phoenix exporter **next to** `MastraStorageExporter`, so `observability.duckdb` keeps receiving every trace.
  - Changes apply on the next backend start. The desktop app's Restart respawns the backend child process; the npm CLI asks the developer to restart it.
  - Logs go through one pino stream with trace ids. They are exported over OTLP only when the setting is on.
- **Consequences:**
  - Each export path is behind one flag read at startup, so "off" is easy to verify: no module is loaded and no request is made.
  - `main.ts` stops importing the app statically. Load order becomes a contract that the entry points own.
  - Live switching isn't possible; the UI must make the restart explicit.
  - The developer-settings file is a new persisted shape under `APP_DATA_DIR` that the data model must record. A new dependency set (OpenTelemetry SDK, Phoenix exporter, `nestjs-pino`) ships in the package but stays unloaded by default.
  - Unreachable endpoints must never fail startup or requests. Exporters drop data instead.

#### ADR-0010 — Multi-user org server mode with Entra ID sign-in and server-enforced roles
- **Status:** Accepted; local mode amended by ADR-0012
- **Date:** 2026-10-10
- **Context:**
  - The vision used to rule out multi-user use ("no login, no roles and no shared server"). The Admin Panel epic ([BA-161](https://halo-powered.atlassian.net/browse/BA-161)) reverses that, from the Figma board "Agent Hub — E2E lifecycle (proposed)", section *Admin panel (draft)*.
  - Decisions taken with the user on 2026-10-10:
    - the organisation self-hosts the server, and Halo operates nothing;
    - today's single-user local mode stays;
    - only datasources and datasets are shared across users, plus one org-wide LLM configuration set by Platform admins;
    - the server keeps SQLite.
  - The backend already runs as a standalone web server through the npm CLI (ADR-0002) and stores everything behind `DocStore<T>` (ADR-0003). Neither has a notion of a user.
  - ADR-0008 tied a user agent's owner to "this machine" and deferred any sharing that needs a new container or sync format.
- **Decision:**
  - **Two modes, one build.** The same backend and renderer run in either mode, chosen at startup.
    - **Local mode** is the default and today's behaviour: no sign-in, and one implicit local user who holds every permission. The desktop app always runs in local mode.
    - **Org server mode** is enabled by server configuration: the identity provider's issuer, client id and secret, the public base URL, and the SCIM token. It is started through the npm CLI or its container image.
  - **No new container.** The org server is the existing web-mode backend, which serves the UI and the API from one origin. TLS and the public hostname are the organisation's reverse proxy's job. Users reach the org server from a browser. A desktop app connecting to a remote org server is out of scope for BA-161.
  - **Identity: OpenID Connect against Microsoft Entra ID**, authorization code flow with PKCE, run by the backend.
    - The backend issues its own session as an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. No tokens are held in the renderer.
    - Generic OIDC is used, so another provider can follow without a new ADR.
  - **Directory: SCIM 2.0 inbound.** The backend exposes `/scim/v2/Users` and `/scim/v2/Groups`, protected by a bearer token, and Entra ID's provisioning service pushes to them.
    - A user who signs in before being provisioned is created just in time from their ID token claims.
    - Groups from the directory are read-only in the app.
  - **Authorization: roles and permissions in the backend.**
    - Five built-in roles: User, Maker, Data owner (scoped to one datasource), Approver and Platform admin. A fixed permission matrix maps roles to permissions.
    - A user's roles are the union of direct assignments and group-to-role mappings.
    - Every route declares the permission it needs, and one global guard checks it. The renderer reads the caller's permissions only to show or hide controls.
  - **Data ownership.**
    - Private documents gain an `ownerId`: sessions, visuals and their workspaces, memory threads, agents, knowledge, verified queries, metrics and eval runs. Repositories scope every read and write to the caller.
    - Datasources and datasets are org-wide, with no owner filter.
    - In local mode, every document belongs to the local user, so existing data needs no rewrite: a missing `ownerId` reads as the local user.
  - **Storage stays SQLite (ADR-0003).** New collections hold users, groups, group memberships, role assignments, group-to-role mappings, sign-in sessions and activity events. Activity events feed the admin overview's active-user counts and recent activity.
- **Consequences:**
  - ADR-0008's "owner is this machine" becomes "owner is a user". Agent ownership can be transferred. Sharing agents beyond their owner stays out of scope, for a later Requests/Registry epic.
  - Every repository must apply the owner scope. A missed one leaks one user's data to another, so an API test per collection must prove isolation between two users.
  - SQLite has a single writer, which limits concurrency. That is acceptable for one organisation's server at expected team sizes. Moving to PostgreSQL behind `DocStore<T>` would need its own ADR.
  - The server now accepts traffic beyond `127.0.0.1`, so the web-mode binding (non-functional N3) gains an org-server setting. CSRF protection and secure cookies become requirements.
  - The agent memory store (Mastra) must also be scoped per user. In org server mode the LLM configuration is org-wide and only Platform admins can change it, coordinated with [BA-159](https://halo-powered.atlassian.net/browse/BA-159).
  - The E2E harness needs a local OIDC stub and a SCIM client to drive org server mode without a real Entra ID tenant.

#### ADR-0011 — Backend-run OIDC with `openid-client`, an opaque session cookie and an Origin check
- **Status:** Accepted
- **Date:** 2026-10-10
- **Context:**
  - ADR-0010 puts sign-in in the backend, and Entra ID is the first provider.
  - The backend compiles to CommonJS and Jest can't load ESM-only packages (see the BA-152 retrospective).
  - The renderer calls the API with `HttpClient` and with raw `fetch` for streams. It sends no custom header today.
  - `openid-client@5` is already present through `@databricks/sql`, but that version is maintenance-only.
- **Decision:**
  - **OIDC client:** `openid-client@6`, imported lazily (`await import()`), the same way `cli.ts` and `main.ts` load ESM. It sits behind an `OidcClient` interface so unit tests mock it. The flow is the authorization code flow with PKCE, `state` and `nonce`, held during the round trip in a short-lived `HttpOnly` cookie.
  - **Session:**
    - The backend keeps no JWT. A session is an opaque 32-byte random id stored in an `auth_sessions` collection (SQLite, ADR-0003) and sent as an `HttpOnly; SameSite=Lax; Path=/` cookie.
    - The cookie is `Secure` unless the public base URL is `http://` (development and E2E only).
    - Behind the organisation's TLS proxy the app sets `trust proxy`.
  - **CSRF:** `SameSite=Lax`, plus a check that every non-GET request in org mode carries an `Origin` (or `Referer`) matching the public base URL. SCIM is exempt, because it uses a bearer token and no cookie.
  - **SCIM:** a hand-written controller covering the subset Entra ID's provisioning service sends. No library.
  - **Current user:** propagated with `AsyncLocalStorage`, so tool calls, SSE streams and background jobs started inside a request run as the caller without request-scoped providers.
- **Consequences:**
  - One new runtime dependency (`openid-client`). The E2E tests use a hand-rolled OIDC stub on `node:http` and `node:crypto` instead of a full provider.
  - A session can be revoked at once by deleting its document. Every request in org mode costs one store read.
  - Background jobs must capture the owner when they start, and re-enter it if they outlive the request.

#### ADR-0012 — Local mode signs in as one of five seeded personas, with a bearer-token auth session
- **Status:** Accepted
- **Date:** 2026-10-11
- **Context:**
  - ADR-0010 kept local mode as "no sign-in, and one implicit local user who holds every permission". So local mode and the desktop app had no roles, no owner scoping and no Admin area: nobody could try what a User, a Maker or an Approver sees without standing up an org server.
  - In local mode no document carried an `ownerId`, and owner scoping was skipped ("a missing `ownerId` reads as the local user").
  - The desktop renderer is loaded from `file://`, so ADR-0011's `SameSite=Lax` session cookie set by `http://localhost:3000` never reaches the backend on its requests.
  - The user delegated the decisions on 2026-10-11, after PR #69 shipped the org server: local and org mode should behave the same.
- **Decision:**
  - **Five seeded personas.** In local mode the backend ensures five directory users with fixed ids: Demo User (`local`), Uma User (`local-uma`), Mark Maker (`local-mark`), Dana Data Owner (`local-dana`) and Avery Approver (`local-avery`). Mark, Avery and Dana get their roles once; Dana is Data owner of every datasource. Demo User is always a Platform admin, as a bootstrap admin.
  - **A sign-in page without a password.** It lists the active directory users; choosing one starts an auth session. There's no automatic sign-in.
  - **Same session, different transport.** Local auth sessions are the same `auth_sessions` documents as on an org server, but the token is answered in the sign-in response, kept in browser storage and sent as `Authorization: Bearer <token>`. The cookie is org-only, and local mode has no `Origin` check. A local session has no idle timeout and ends at Sign out or 30 days after sign-in.
  - **Same enforcement.** Roles, the permission guard and owner scoping apply in local mode exactly as on an org server. Migration M13 gives every ownerless document to Demo User (`ownerId: "local"`), so existing data stays with the user who had it.
  - **One mechanism for desktop and web.** The desktop app and the npx web app in local mode sign in the same way, so the web E2E suite covers the desktop path. The desktop app's readiness probe becomes `GET /me`, ready on 200 or 401.
- **Consequences:**
  - Local mode is not a security boundary: anyone who can reach the local backend can sign in as any persona. It's a way to see each role, not to protect data (non-functional N78).
  - `GET /me` answers 401 when nobody is signed in, in both modes. For Demo User it reports Platform admin with source `bootstrap`.
  - Nothing runs as the local user by default any more. Code outside a request, such as the eval CLI, must run as Demo User explicitly.
  - A data folder used in local mode and then opened by an org server shows none of its private items there: they belong to `local`, which is no org user.

## Level 3 — Components

**Backend**

```mermaid
flowchart LR
  subgraph modules["Feature modules (backend/src/modules)"]
    sessions["SessionsModule<br/>(SessionsService)"]
    visualization["VisualizationService<br/>(sessions module)"]
    agentsmod["AgentsModule<br/>(AgentsService, EvalRunsService)"]
    deep["DeepAnalysisModule"]
    knowledge["KnowledgeModule"]
    datasets["DatasetsModule"]
    datasources["DatasourcesModule<br/>(postgres, databricks, rest connectors)"]
    testing["TestingDataModule"]
    metrics["MetricsModule"]
    verified["VerifiedQueriesModule"]
    llm["LlmModule<br/>(LlmService)"]
  end

  subgraph infra["infrastructure"]
    docstore[("DatabaseModule<br/>DocStore tokens, app.sqlite")]
    crypto["CryptoModule"]
  end

  subgraph mastra["mastra/"]
    mastrasvc["MastraService<br/>(getAgent, ensureSessionWorkspace)"]
    toolsvc["tool-services<br/>(setDatasetToolServices bridge)"]
    resolver["model-resolver<br/>(setAgentModelResolver)"]
    assistant["assistant agent"]
    designer["visualization agent"]
    sqlagents["sql-fixer, sql-verifier agents"]
    bootstrap["knowledge-bootstrap agent"]
    tools["tools/<br/>(dataset, create/update_visual, ask_clarification)"]
    skills["skills/<br/>(built-in, user and project levels; declared per agent; ADR-0018, ADR-0019)"]
    evals["evals/<br/>(assistant evals, eval-judge agent)"]
  end

  sessions --> visualization
  sessions --> datasets
  sessions --> datasources
  sessions --> llm
  sessions --> verified
  sessions --> metrics
  sessions --> knowledge
  sessions -->|"assistant, sql-fixer, sql-verifier"| mastrasvc
  sessions -->|"installs on init"| toolsvc
  visualization -->|"visualization agent, workspace fs"| mastrasvc
  agentsmod --> sessions
  agentsmod --> knowledge
  agentsmod --> datasources
  agentsmod --> datasets
  agentsmod -->|"list agents"| mastrasvc
  agentsmod -->|"runs eval cases"| evals
  deep --> sessions
  deep -->|"assistant"| mastrasvc
  knowledge --> datasets
  knowledge --> datasources
  knowledge -->|"knowledge-bootstrap"| mastrasvc
  datasets --> datasources
  testing --> datasources
  testing --> datasets
  metrics --> verified
  llm --> crypto
  llm -->|"installs on init"| resolver
  modules -->|"repositories inject collection tokens"| docstore

  mastrasvc --> assistant
  mastrasvc --> designer
  mastrasvc --> sqlagents
  mastrasvc --> bootstrap
  assistant --> tools
  assistant -.->|"its skills (catalog + skill tools)"| skills
  designer -.->|"interactive-visuals (pipeline-loaded)"| skills
  tools -->|"getDatasetToolServices()"| toolsvc
  evals --> assistant
  assistant -.->|"model: async resolveAgentModel()"| resolver
```

*Backend components: NestJS feature modules and their constructor-level dependencies, the `DocStore` behind every repository, and the `mastra/` harness reached only through `MastraService` plus the two DI bridges (`tool-services`, `model-resolver`) installed on module init.*

**Frontend**

```mermaid
flowchart LR
  subgraph shell["App shell (app.ts, single page, no routes)"]
    app["App component<br/>(layout, panel wiring)"]
  end

  subgraph features["features/"]
    sessions["sessions<br/>(session-chat, interactive-visual-panel, sessions-api)"]
    datasets["datasets<br/>(catalog-browser, dataset-list, entity-details, metrics-panel)"]
    datasources["datasources<br/>(datasource-config, datasources-api)"]
    knowledge["knowledge<br/>(knowledge-list, knowledge-form)"]
    llm["llm<br/>(llm-config, llm-api)"]
    agents["agents<br/>(agent-hub, agent-card, agent-detail, eval-trace)"]
    testing["testing-data<br/>(testing-data-config)"]
  end

  subgraph core["core/"]
    config["config<br/>(API_BASE_URL, app-version)"]
    toast["toast<br/>(ToastService)"]
    diagnostics["diagnostics<br/>(DiagnosticsService, log-runs)"]
    status["backend-status<br/>(BackendStatusService)"]
  end

  subgraph shared["shared/"]
    sharedui["components: backend-status-banner,<br/>system-logs-panel, toast-container, app-logo;<br/>pipes: markdown"]
  end

  backend["NestJS backend<br/>(HTTP + SSE)"]
  desktop["Electron preload<br/>(window.desktop, window.systemDiagnostics)"]

  app --> sessions
  app --> datasets
  app --> datasources
  app --> knowledge
  app --> llm
  app --> agents
  app --> testing
  app --> sharedui
  app --> diagnostics
  datasets --> datasources
  knowledge --> datasets
  agents --> datasources
  testing --> datasources
  sessions --> sharedui
  features -->|"API_BASE_URL"| config
  features -->|"notifications"| toast
  toast --> diagnostics
  sharedui --> status
  sharedui --> diagnostics
  features -->|"*-api services: HTTP JSON, SSE stream"| backend
  status -.->|"onBackendStatus IPC"| desktop
  diagnostics -.->|"IPC: list, record, export"| desktop
```

*Frontend components: a single-page shell (`app.ts`, no routes) composes every feature directly; features call the backend through their own `*-api` services using `core/config`, and `core` services talk to Electron via the preload bridge.*


#### ADR-0003 — SQLite document store behind a `DocStore<T>` interface *(retroactive)*
- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** Small embedded persistence with flexible documents.
- **Decision:** One better-sqlite3 table per collection, JSON documents, injection token per collection (`database.module.ts`).
- **Consequences:** Renaming collections or persisted fields needs explicit migrations (`LEGACY_TABLE_NAMES`, `LEGACY_DOC_FIELDS`).

#### ADR-0004 — Mastra as the agentic harness *(retroactive)*
- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** Agents need tools, memory, and a provider-agnostic model layer.
- **Decision:** Standalone Mastra instance wrapped by `MastraService`; models resolved at call time from persisted LLM settings; LibSQL memory; one filesystem workspace per session.
- **Consequences:** The rest of the backend stays Mastra-agnostic; provider quirks are handled in `model-compat.ts`.

#### ADR-0005 — Visuals as versioned conversation participants *(retroactive)*
- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** Users tailor visuals iteratively from the chat.
- **Decision:** `create_visual` / `update_visual` tools drive a designer sub-agent; each edit writes a new `v<N>` directory; revert moves a pointer; a fixed, transcript-derived frame provides readable context.
- **Consequences:** Readability does not depend on designer-model output; storage grows per version.

#### ADR-0007 — Themeable renderer: semantic design tokens, a bundled webfont and a System / Light / Dark preference
- **Status:** Accepted; its *Preference* storage and default superseded by ADR-0009
- **Date:** 2026-10-09
- **Context:**
  - The renderer is dark-only. Its colours are hardcoded per component as Tailwind arbitrary values (`bg-[#232323]`, `zinc-*`), and it has no theme file and no CSS variables ([ui.md](ui.md) §6).
  - The Agentic Hub look and feel ([BA-141](https://halo-powered.atlassian.net/browse/BA-141)) needs a light theme and a navy dark theme derived from it, switchable at runtime. With hardcoded values, each theme would need a second class on every element.
  - The renderer loads over `file://` in the desktop app and must work offline, so it can't fetch fonts from a CDN.
- **Decision:**
  - **Semantic tokens.** Colours, radii and shadows become CSS custom properties named by role (surface, card, text, border, primary, status), not by value. A `data-theme="light" | "dark"` attribute on the root element selects one of two token sets. The tokens are mapped into Tailwind v4 through `@theme`, so components use role utilities (`bg-surface`, `text-muted`), never hex values or palette shades.
  - **Preference.** System (the default), Light or Dark, stored on the renderer like the right-panel width. System follows `prefers-color-scheme` and updates live when the OS changes. The resolved theme is set before first paint, so there is no flash of the wrong theme. The Electron window background matches the resolved theme.
  - **Webfont.** One open-licence sans-serif family is bundled with the renderer as local assets and loaded with `@font-face`. The system font stack stays as the fallback.
- **Consequences:**
  - Every component that uses hardcoded colours must move to tokens. The BA-141 stories do this screen by screen, and finished screens must have no arbitrary colour values left.
  - Both themes have to pass the axe scan, and visual baselines are captured per theme.
  - The renderer bundle grows by the font files.
  - The theme preference is a new persisted renderer key that [data-model.md](data-model.md) must record.
  - The theme is per renderer origin, so the desktop app and the npm CLI's browser tab can hold different preferences.

#### ADR-0008 — User-built agents are stored configurations of the assistant
- **Status:** Accepted
- **Date:** 2026-10-09
- **Context:**
  - The Agent Hub ([BA-150](https://halo-powered.atlassian.net/browse/BA-150)) lets users build their own agents: a name, a description, instructions, datasets, starter questions and an optional model override. Each one is drafted, published and chatted with.
  - Mastra agents are registered in code at startup (ADR-0004, `src/mastra/index.ts`). Registering an agent per user definition at runtime would mean re-registering on every edit and would bypass the assistant's tools, memory and guards.
  - The assistant's safety comes from code that must hold whatever the prompt says: the read-only SQL guard, grounding checks, SQL repair and trust signals. Its prompt must still start with the fixed identity line, and an E2E asserts this.
  - The app is local-first with no accounts, so "owner" can only mean "this machine".
- **Decision:**
  - A user agent is a **document** in a new `agents` collection, not a Mastra agent. Each document holds a `draft` and an optional `live` version of the configuration, plus `pinned`. Pin state for the built-in agents is stored separately, keyed by registry key.
  - A session started from an agent stores the agent id. Each turn runs the existing `assistant` and applies the agent's **Live** configuration:
    - its instructions as an extra, labelled per-turn system context block after the base prompt and the knowledge block;
    - its datasets as the session's datasets;
    - its model or reasoning-effort override through the turn's request context, read by `resolveAgentModel()`.
  - A preview chat applies the **draft** the same way, against a thread that is not stored as a session.
  - The built-in agents stay in the code registry. The hub merges them (Official: `assistant`; System: the helpers) with the user agents from the collection.
- **Consequences:**
  - User agents inherit every assistant tool, guard and fix automatically. They can't add tools or relax the guard.
  - Editing a Live agent never changes a running session until it is published. Deleting an agent leaves sessions pointing at a missing id, so they fall back to the plain assistant.
  - Adds a collection, and an optional field on `sessions` (no migration: absent means the plain assistant).
  - Sharing across machines, teams and owners would need a new container or a sync format. That is deferred and would supersede the "this machine" ownership here.


#### ADR-0009 — UI preferences live in the backend, with a browser cache for the first paint
- **Status:** Accepted; on an org server the document is per user (ADR-0010, [data-model.md](data-model.md) 3.2.1)
- **Date:** 2026-10-10
- **Context:**
  - ADR-0007 stored the theme choice in the renderer's browser storage, defaulting to System, and the navigation drawer was never remembered (app-shell R2).
  - The user wants the app to open in the Light theme with the drawer expanded, and any change the user makes to either to be stored in the database ([BA-168](https://halo-powered.atlassian.net/browse/BA-168)).
  - Browser storage is per renderer origin and per port, so the desktop app, a CLI tab on another port and a fresh browser profile each lose the choice.
  - The theme must still apply before the first paint (app-shell R42), which a backend round trip can't guarantee.
- **Decision:**
  - **Source of truth.** One `ui-preferences` document in the existing `settings` collection holds the theme choice and the drawer state, read and written through `GET` / `PUT /ui-preferences`. It belongs to the data directory, so every renderer on that data shares it.
  - **Defaults.** Nothing stored means Light and an expanded drawer. System stays a choice, no longer the default.
  - **First-paint cache.** The renderer keeps a browser-storage copy of the theme (and of the drawer state) and applies it before boot, then reconciles with the backend once it answers; the backend wins.
  - **One-time move.** A theme chosen before this change, found in browser storage while the backend has none, is written to the backend once.
- **Consequences:**
  - A new `settings` key and two endpoints; no new collection and no table migration.
  - A renderer whose cache disagrees with the backend (another renderer changed the choice) shows its cached theme for one frame, then switches.
  - Existing users who never chose a theme move from System to Light.

#### ADR-0018 — Agent know-how as app-owned skills with progressive disclosure, declared per agent
- **Status:** Accepted; partly superseded by ADR-0019 (where skills come from, and scripts) and ADR-0020 (how on-demand skills are listed and read)
- **Date:** 2026-10-13
- **Context:**
  - The `assistant` sends one ~160-line system prompt on every call. It mixes rules every question needs (grounding, SQL safety) with rules only some turns need: curated knowledge, visuals, dialects. Deep analysis inlines its own phase prompts in `DeepAnalysisService`, and the designer gets the whole `interactive-visuals` skill (spec mode and freeform) on every call.
  - Mastra (ADR-0004) implements Agent Skills. A `SKILL.md` front matter holds a `name` and `description`, and the framework injects only those into an `<available_skills>` catalog. A `skill` tool loads a skill's body and `skill_read` loads any file in its folder. An agent can declare its own skills (`skills`, paths on disk, resolved per request), and they merge with the skills of its workspace.
  - Today the one skill is copied into every session workspace and discovered from there. Every agent bound to the workspace, the assistant included, sees it in its catalog, although only the designer pipeline uses it.
  - Loading by the model is probabilistic. A rule that must hold on a given turn can't depend on the model noticing it.
  - The user asked on 2026-10-13 for the SKILL.md, `phases/`, `references/` and `scripts/` layout. The workspace has no sandbox, and the packaged app ships no interpreter.
- **Decision:**
  - **App-owned skills in the bundle.** Skills live in `backend/src/mastra/skills/<name>/` and the build copies them to `dist/`. A skill is a `SKILL.md` (front matter `name` equal to the folder and a `description` that starts with "Use when", then a short phase map or router) plus the `phases/*.md` and `references/*.md` files it links.
  - **Declared per agent.** Each agent lists its skills by name in one table in code. Session workspaces no longer seed or discover skills, so an agent sees only its own catalog. Copies already in old workspaces are ignored.
  - **Two loading modes.** A skill is *on demand* when only the model can tell it applies: it is listed in the agent's catalog and loaded with `skill` / `skill_read`. A skill is *harness-loaded* when code knows the condition, such as a knowledge block being present, a deep-analysis phase or the designer's mode. The code then sends the needed body or file as a system message, and the skill is kept out of the catalog.
  - **No scripts the model runs.** Checks that have to be exact stay in TypeScript (the read-only guard, the result guards, visual-spec validation). A skill names the tool or guard that applies its rule. `scripts/` is not part of the layout.
  - **Fail at startup.** The backend validates every skill when it loads: front matter, the "Use when" description, name equal to the folder, and every linked file present. An invalid skill or a missing skills folder stops the backend before it serves.
- **Consequences:**
  - The assistant's every-turn prompt shrinks to the rules every data question needs. What a turn sends depends on the turn, and the specs say which skill reaches which call ([agents.md](agents.md) section 7).
  - On-demand skills add a tool round trip when they load, and they can fail to trigger. That's why only rules the model must judge go on demand, and evals measure them.
  - Editing a skill is a prompt change. It ships with the build and is covered by the same evals and E2E as an edit to an agent's instructions.
  - Mastra's skill catalog, tools and agent-level `skills` are framework behaviour (1.66). A Mastra upgrade re-runs the request-recording E2E that asserts what each call carries.

#### ADR-0019 — Built-in, user and project skill levels that override by name; scripts reserved for built-in skills
- **Status:** Accepted; partly superseded by ADR-0020 (the script runner is built)
- **Date:** 2026-10-14
- **Context:**
  - ADR-0018 made every skill app-owned: the only skills an agent can get ship in the build, and nobody can add or adjust one without a release.
  - The user asked on 2026-10-14 for the layout of Agent Skills tools: user-level skills, and project-level skills that override them by name, each a `SKILL.md` with `phases/`, `reference/` and `scripts/`.
  - The backend runs as the desktop app, the npx CLI or a multi-user org server, so "user" and "project" need one meaning that holds in all three. The app has no organization record: one org server is one organization.
  - A script is code the model runs on the backend host. A folder anyone can drop files into would make that arbitrary code execution, on the org server as the server's own account.
- **Decision:**
  - **Three levels, later overrides earlier by name:** built-in (the bundle) < user (`<data dir>/skills/`) < project (the folder `QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR` names, e.g. a checkout of the organization's skills repo). The levels mean the same in every mode. On the org server both folders are server-wide; there are no per-person skills.
  - **Read at startup.** The backend reads all three levels once when it starts. The app never writes the user or project folders.
  - **Targeting.** A new user or project skill is on demand, for the agents its optional `agents` front-matter key names (default `assistant`). Only an agent that can load a skill on demand may be named. An override keeps the agents and the loading mode of the skill it replaces.
  - **Failure isolation.** A broken built-in skill still stops the backend. A broken user or project skill is skipped, logged and shown on the agent page. An override of a harness-loaded built-in must carry every phase and reference file the built-in has, each with the same placeholders; otherwise it is skipped and the built-in stays.
  - **Scripts only for built-in skills, not built yet.** `scripts/` is reserved for built-in skills, which ship with reviewed code. They would run through one tool: arguments only (no shell), only files in the skill's `scripts/` folder, a timeout, and the output returned verbatim. No built-in skill needs a script today, so the runner is not built. User and project skills are text only: their `scripts/` is never run.
  - **Read-only Skills tab.** The agent page shows each agent's skills, the level each comes from, what it overrides, its files and their contents, and the skipped skills with their problems.
- **Consequences:**
  - A user or administrator can change an agent's instructions without a release. Such a change has no eval or review gate in the app: the Skills tab is the only place it shows, and an override of a harness-loaded skill changes chat, deep analysis or visuals for every session.
  - The first on-demand skill added at the user or project level gives the assistant the skill catalog, its usage note and the skill tools on every turn (about 1,000 characters, agents.md 7.3).
  - Eval runs and user agents run on the assistant, so they get its user and project skills too.
  - Picking up a changed skill needs a restart.
  - Adding the script runner later is one story inside the rules above.

#### ADR-0020 — A sectioned assistant prompt with the app's own skill catalog, read through `read_file`; built-in scripts run through `run_skill_script`
- **Status:** Accepted
- **Date:** 2026-10-14
- **Context:**
  - Under ADR-0018 the framework renders the on-demand catalog, with its own usage note and a `<source>` tag, and offers `skill`, `skill_search` and `skill_read`. Neither the wording nor the tools are ours to shape.
  - The user asked on 2026-10-14 for the system prompt of Agent Skills tools: identity, `## Tools`, `## Working rules` and `## Skills`. The Skills section has fixed instructions and an `<available_skills>` list giving each skill's name, description and the path to its `SKILL.md`. The model reads skills with a file tool and runs bundled scripts instead of reading them.
  - ADR-0019 reserved scripts for built-in skills behind a restricted runner but didn't build it. A shell would run as the backend's account, for every user on the org server. The packaged app ships Node (the backend's own runtime), not Python.
- **Decision:**
  - **Sectioned prompt.** The assistant's prompt is the identity paragraph, then `## Tools` (one line per tool, generated from the tools it is given), then `## Working rules` (the existing rules, word for word), then `## Skills` when it has on-demand skills. The Skills section holds the instructions and the catalog, rendered by the app.
  - **Own catalog and `read_file`.** The assistant is no longer given framework skills, so the framework adds no catalog, usage note or skill tools. The app gives it `read_file(path)` instead: read-only, and limited to the regular files inside the folders of the skills its catalog lists.
  - **`run_skill_script`.** A built-in skill in the catalog can bundle Node scripts under `scripts/` (`.js`, `.mjs`, `.cjs`). They run through `run_skill_script(skill, script, args)`:
    - with the backend's own Node and no shell;
    - only listed files under that skill's `scripts/`, with arguments passed as an argument list;
    - with a minimal environment that carries no app secrets, the skill folder as working directory and a 30-second timeout;
    - with stdout, stderr and the exit code returned verbatim (capped).

    The tool is offered only when such a skill exists. User and project skills stay text only.
  - **`curated-knowledge` becomes on demand** (added the same day, at the user's request, before the change shipped). The built-in skill is listed in the assistant's catalog, and the knowledge block travels without its rules: the model reads them with `read_file`. `deep-analysis` stays harness-loaded, because its phase files are templates that the deep-analysis service fills and calls one by one. `interactive-visuals` stays harness-loaded, because the designer runs without tools and can't read a file.
- **Consequences:**
  - The prompt the model sees, and the one the Prompt tab shows, are the same text, catalog included. A framework upgrade can no longer change the skill wording.
  - `read_file` and `run_skill_script` are app code that touches the disk and spawns processes. Both are covered by unit tests on their limits (paths, symbolic links, size, extensions, timeout, environment).
  - No built-in skill ships a script today, so `run_skill_script` isn't offered until one does. It is tested with a fixture skill.
  - Every assistant call carries the Tools section (about 1,000 characters) and, since `curated-knowledge` is always listed, the Skills section and `read_file`.
  - Whether a knowledge rule applies now depends on the model reading the skill, which ADR-0018 avoided by loading it in code. The evals must pass at 100% before the PR (the workflow rule of 2026-10-14).

## Level 4 — Code

```mermaid
flowchart TB
  subgraph fe["Frontend (features/sessions)"]
    chat["SessionChat<br/>(session-chat.ts)"]
    api["SessionsApiService<br/>(fetch stream reader)"]
    shell["App shell<br/>(app.ts onVisualUpdated)"]
    panel["InteractiveVisualPanel<br/>(interactive-visual-panel.ts)"]
    iframe["sandboxed iframe<br/>(srcdoc, sandbox=allow-scripts)"]
  end

  subgraph be["Backend (modules/sessions)"]
    ctrl["SessionsController<br/>POST /sessions/:id/messages/stream<br/>(text/event-stream)"]
    svc["SessionsService.streamMessage<br/>(requestContext: session-id, active-visual-id, turn-data-records)"]
    bridge["tool-services bridge<br/>(createVisual / updateVisual)"]
    vis["VisualizationService<br/>(create, update, revert, load)"]
    validate["validation<br/>(spec check, or new Function parse + 1 retry)"]
    frame["visualization-document.ts<br/>(qti- frame from transcript: contextFor)"]
  end

  subgraph ma["mastra/"]
    assistant["assistant agent"]
    tool["create_visual / update_visual<br/>(tools/visual.tools.ts)"]
    designer["visualization agent<br/>(designer sub-call)"]
  end

  files[("session workspace<br/>visuals/id/vN/: index.html, body.html,<br/>styles.css, script.js, manifest.json, data.json")]

  chat -->|"user message + activeVisualizationId"| api
  api -->|"HTTP POST, SSE response"| ctrl
  ctrl --> svc
  svc -->|"agent.stream()"| assistant
  assistant -->|"tool call"| tool
  tool -->|"getDatasetToolServices()"| bridge
  bridge --> vis
  vis -->|"bundle + captured rows + instruction"| designer
  designer -->|"spec or HTML/CSS/JS"| validate
  validate --> vis
  vis --> frame
  vis -->|"writeVersion, currentVersion = N"| files
  tool -->|"visualId, version, title"| svc
  svc -->|"SSE event: visual-updated"| api
  api --> chat
  chat -->|"visualUpdated output"| shell
  shell -->|"open visual id + version"| panel
  panel -->|"GET /sessions/:id/visualizations/:vid?version=N"| api
  ctrl -->|"load(version)"| vis
  panel -->|"framed index.html as srcdoc"| iframe
  iframe -.->|"postMessage visual-error (panel shows banner)"| panel
```

*Visual tailoring loop: a chat turn's `create_visual`/`update_visual` tool call runs the designer agent through `VisualizationService`, writes a new `visuals/<id>/v<N>/` version in the session workspace, and the `visual-updated` SSE event makes the panel reload it into a sandboxed iframe that reports runtime errors back via `postMessage`.*


<!-- Code-level decisions (patterns, conventions with architectural weight) go here. -->

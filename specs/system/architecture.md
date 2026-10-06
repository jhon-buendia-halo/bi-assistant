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

  subgraph qti["Questions to Insights"]
    system["Questions to Insights<br/>(Electron desktop app or npx web app)"]
  end

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
  analyst -->|"downloads installer"| releases
  analyst -->|"npx / npm i -g (read:packages PAT)"| packages
  system -->|"read-only SQL, schema discovery, sample rows"| pg
  system -->|"read-only SQL, catalog discovery"| dbx
  system -->|"HTTP requests, OpenAPI discovery"| rest
  system -->|"chat completions (HTTPS)"| lenai
  system -->|"messages API (HTTPS, API key)"| anthropic
  system -->|"chat completions (HTTPS)"| openai
```

*System context: the analyst uses Questions to Insights, which queries the user's datasources (PostgreSQL, Databricks, REST/OpenAPI), calls the configured LLM provider, and is distributed through GitHub Releases and GitHub Packages.*


The user asks questions of their data in plain language; Questions to Insights answers with SQL, results, and interactive visuals. External systems: the user's datasources (PostgreSQL, Databricks SQL, REST/OpenAPI), an LLM provider (OpenAI-compatible / LenAI, Anthropic, OpenAI), GitHub (releases, GitHub Packages).

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

  backend["NestJS backend<br/>(backend/src, createApp)<br/>API + Mastra agents"]

  subgraph data["APP_DATA_DIR (userData, or ~/.questions-to-insights for the CLI)"]
    appdb[("app.sqlite<br/>(better-sqlite3 DocStore)")]
    mastradb[("mastra.sqlite<br/>(LibSQL memory, threads)")]
    obsdb[("observability.duckdb<br/>(Mastra traces)")]
    ws["workspaces/session-id<br/>(filesystem: skills, visuals)"]
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
  backend -->|"SQL (better-sqlite3)"| appdb
  backend -->|"LibSQL (@mastra/libsql)"| mastradb
  backend -->|"DuckDB (@mastra/duckdb)"| obsdb
  backend -->|"fs read/write (Mastra workspace)"| ws
  backend -->|"pg / @databricks/sql / HTTPS"| ext
  backend -.->|"OTLP traces + metrics,<br/>only when developer observability is on"| devtools
  backend -.->|"agent traces (OpenInference),<br/>only when developer observability is on"| phoenix
```

*Containers: the two delivery modes (Electron spawning the backend as a child process, or the npm CLI serving backend + bundled UI to a browser) share one NestJS backend and its on-disk stores under `APP_DATA_DIR`.*


- **Electron main process** (`frontend/electron/main.cjs`) — window shell; spawns and kills the backend.
- **Angular renderer** (`frontend/src/`) — the UI.
- **NestJS backend** (`backend/src/`) — API, Mastra agents, SQLite app store, per-session workspaces.
- **npm CLI** (`backend/src/cli.ts`) — serves the same backend + bundled UI in a browser.

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
    skills["skills/interactive-visuals<br/>(copied into session workspaces)"]
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
  assistant -.->|"workspace skills"| skills
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
    agents["agents<br/>(agent-list, agent-detail, eval-trace)"]
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

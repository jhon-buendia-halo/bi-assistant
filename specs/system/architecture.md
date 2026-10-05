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
    expertmode["ExpertModeModule<br/>(ExpertModeService)"]
    learning["LearningModule<br/>(LearningService)"]
    pins["AnswerPinsModule<br/>(AnswerPinsService)"]
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
    expertagents["business-expert, feedback-learner agents"]
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
  sessions --> expertmode
  sessions --> learning
  sessions --> pins
  expertmode -->|"business-expert"| mastrasvc
  learning --> knowledge
  learning -->|"feedback-learner"| mastrasvc
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
  mastrasvc --> expertagents
  assistant --> tools
  assistant -.->|"workspace skills"| skills
  tools -->|"getDatasetToolServices()"| toolsvc
  evals --> assistant
  assistant -.->|"model: async resolveAgentModel()"| resolver
```

*Backend components: NestJS feature modules and their constructor-level dependencies, the `DocStore` behind every repository, and the `mastra/` harness reached only through `MastraService` plus the two DI bridges (`tool-services`, `model-resolver`) installed on module init. `SessionsModule` imports the business-expert, learning and answer-pin modules, never the reverse, so there is no dependency cycle.*

**Frontend**

```mermaid
flowchart LR
  subgraph shell["App shell (app.ts, single page, no routes)"]
    app["App component<br/>(layout, panel wiring)"]
  end

  subgraph features["features/"]
    sessions["sessions<br/>(session-chat, expert-trace, table-join-diagram,<br/>interactive-visual-panel, sessions-api)"]
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

ADR-0006 and ADR-0007 are used on the unmerged BA-2 branch ([epics/BA-2](../epics/BA-2/spec.md)), so the decisions below continue at ADR-0008.

#### ADR-0008 — Reasoning-trace confidence is measured by the system, never reported by the model
- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:**
  - Business expert mode shows a reviewer a confidence for each step of an answer, and the mode is judged on two numbers: how well that confidence ranks right answers above wrong ones (AUROC), and whether "high" is right at least 90 % of the time.
  - Verbalized LLM confidence clusters at 80–100 % regardless of difficulty, so a self-reported score would rank nothing and label wrong answers "high".
  - A reader also needs to see why a block scored low, not just that it did.
  - The careful-mode verifier re-derived SQL without the curated knowledge, so on any question that depends on a default filter or a term it disagreed with correct answers. Its verdict measured knowledge-following inverted.
- **Decision:**
  - The `business-expert` agent writes only the trace's prose and structure, plus one 0–1 self-estimate per block.
  - The backend computes every confidence deterministically, as a weighted mean of named, measured signals: schema and join grounding read off the SQL that ran, knowledge coverage of the claims, the execution outcome, the independent cross-check, a verified-query match and the assumption load. The self-estimate is one signal at weight 0.10.
  - A signal that cannot be measured is omitted, never scored 0. A disagreeing cross-check caps the answer at 0.5, and a verified-query match floors it at 0.85.
  - Claims citing curated sources are checked against the context the turn was actually given. Tables, joins and SQL are taken from what ran.
  - Expert mode always runs the cross-check. The verifier now receives the same curated knowledge and metric definitions as the answer, while still never seeing its SQL.
  - One band definition (0.80 / 0.55) is shared by backend and renderer.
- **Consequences:**
  - Confidence is reproducible from the same inputs and explainable signal by signal.
  - An expert answer costs one extra model call plus the cross-check.
  - The trace is a contract duplicated in a backend entity and a frontend model that must change together.
  - Weights are tuned against the HR suite from the CLI harness only; the in-app Evals tab cannot run expert mode.
  - Careful mode's verdicts change for every question that relies on curated knowledge.

#### ADR-0009 — Learn from reviewer feedback through curated knowledge, not fine-tuning
- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:**
  - What a reviewer teaches is a fact about the data or the business, such as a fiscal calendar or what "net revenue" means. It must fix every related question, take effect on the next turn, and stay visible and reversible.
  - For knowledge injection, retrieval has beaten unsupervised fine-tuning by a wide margin (Ovadia et al., arXiv:2312.05934). Fine-tuning on unfamiliar facts tends to increase hallucination (Gekhman et al., arXiv:2405.05904).
  - The models in use (GPT-5, the o-series) are not offered for supervised fine-tuning, and a handful of notes is far below any training set.
- **Decision:**
  - A note on a reasoning block is distilled by a new `feedback-learner` agent into 0–3 general lessons, never the answer itself. One retry is allowed, then a deterministic verbatim fallback.
  - Each lesson is stored as an ordinary knowledge snippet with `source: "feedback"` and its provenance, enabled at once and scoped to the session's datasets. The reviewer writing the note is the review gate; the Knowledge screen is the after-the-fact review.
  - The curated-knowledge budget grows from 2,000 to 8,000 characters. It orders default filters first and lessons second, and skips an entry that does not fit instead of stopping, so a lesson is never crowded out.
- **Consequences:**
  - Lessons reach the assistant, the cross-check verifier and the explainer with no new plumbing, and every eval run sees them too.
  - Lessons can be edited, disabled or deleted like any snippet, but editing the note again re-derives its lessons and discards hand edits.
  - Lesson quality rests on one model call per note.
  - A note that only says "wrong" teaches nothing.
  - Every new lesson moves the answer-pin fingerprint of each lineage on its datasets (ADR-0010).
  - Snippets gain a third source and an optional provenance. Older data needs no migration.

#### ADR-0010 — Consistent answers by replaying pinned answers, verified live
- **Status:** Accepted
- **Date:** 2026-09-30
- **Context:**
  - Users expect the same question to get the same answer, but hosted LLM inference is not deterministic even at temperature 0: kernels are not batch-invariant, and runs under "deterministic" settings vary widely (He et al., Thinking Machines Lab, 2025; Atil et al., arXiv:2408.04667).
  - Vendors' verified-query features guide generation but do not guarantee an exact replay.
  - Learning (ADR-0009) must still be able to change an answer, and changed data must never be hidden behind a stored answer.
- **Decision:**
  - A new `answer_pins` collection holds one pin per lineage: the normalised question, the datasets, the chain of earlier questions and the mode.
  - Each pin carries a fingerprint of everything that legitimately changes the answer: the knowledge given, the metrics and verified-query blocks, the schema, and the model with its effort.
  - Before any model call, a pinnable turn replays its pin only when the fingerprint matches and the pinned SQL, re-run live, returns identical rows. Otherwise it is answered afresh, and a stabiliser keeps the old wording when the rows held (`kept`) or marks the answer `updated`.
  - A thumbs-up approves a pin and a thumbs-down rejects it.
  - Pinning is on at the HTTP chat endpoint and off by default in the turn service, so eval harnesses never replay.
  - A replayed exchange never reaches the agent, so the next real turn catches its memory up.
- **Consequences:**
  - A repeated question costs one database query and no model call, and is byte-identical.
  - Replays are exact-question only: a paraphrase, a different conversation history or another mode is a new lineage.
  - Any context change on a dataset forces one re-derivation per lineage, and the stabiliser hides the churn when the numbers held.
  - Pins are kept apart from sessions and are not cascaded when a session or dataset is deleted.
  - Chat and evals deliberately differ: evals measure the engine, chat measures consistency.

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

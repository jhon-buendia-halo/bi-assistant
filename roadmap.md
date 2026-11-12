# Roadmap

Pre-implementation plan for all work. Hierarchy: **Release → Milestone → Feature** (`R`, `R.M`, `R.M.F`). See *Planning convention* in the `workflow-start` skill. Each milestone is an epic, with its spec in [specs/epics/](specs/README.md); since 2026-11-11 a new milestone's heading ends in its epic ID `(M<R>-<M>)`.

Finished milestones (every feature `✅ Done` or `🚫 Cut`, other than the active epic) are moved verbatim to [roadmap-archive.md](roadmap-archive.md) by `node scripts/roadmap-archive.mjs`; their heading stays here with the suffix `— archived, see roadmap-archive.md`. Look a story up in both files.

Status legend: `📋 Planned` · `🚧 In progress` · `✅ Done` · `🚫 Cut`

Feature template:

```
#### R.M.F — <Feature name>  `📋 Planned`
- **Intent:** why this exists / the user-observable outcome.
- **Scope:** what is in.
- **Out of scope:** what is explicitly not.
- **Acceptance:** verifiable criteria (map to Gherkin scenarios in the capability specs under specs/capabilities/).
- **Notes:** links (docs/plans, ADRs, evidence), dependencies.
```

---

<!-- Releases go here. Promote Backlog items into a milestone before starting work. -->

## Release 0 — Maintenance

Correctness fixes to the shipped app that don't belong to a product phase.

### Milestone 0.1 — Desktop runtime correctness — archived, see roadmap-archive.md

### Milestone 0.2 — Delivery process ([BA-89](https://halo-powered.atlassian.net/browse/BA-89)) — archived, see roadmap-archive.md

### Milestone 0.3 — Local Development Observability ([BA-111](https://halo-powered.atlassian.net/browse/BA-111)) — archived, see roadmap-archive.md

### Milestone 0.4 — Harness Adjustments ([BA-119](https://halo-powered.atlassian.net/browse/BA-119)) — archived, see roadmap-archive.md

### Milestone 0.5 — Faster workflow, repo-only planning (M0-5) — archived, see roadmap-archive.md

## Release 1 — 1.0 Beta  (target 2026-10-31)

Source of truth for scope and dates: Jira project **BA**, version *1.0 Beta* ([timeline](https://halo-powered.atlassian.net/jira/software/projects/BA/boards/2688/timeline)). Each milestone mirrors one Jira epic and each feature mirrors one story, so IDs map 1:1. Imported 2026-10-01. Status changes are made in both places.

Timeline (from the Jira timeline):

| Milestone | Epic | Window |
|---|---|---|
| 1.1 Golden Dataset and Evals | [BA-9](https://halo-powered.atlassian.net/browse/BA-9) | Oct 1 – Oct 31 (runs throughout) |
| 1.2 Data Model DSL | [BA-2](https://halo-powered.atlassian.net/browse/BA-2) | Sep 30 – Oct 16 |
| 1.3 Knowledge Store | [BA-4](https://halo-powered.atlassian.net/browse/BA-4) | Sep 30 – Oct 16 |
| 1.4 Response Reliability Signals | [BA-12](https://halo-powered.atlassian.net/browse/BA-12) | Sep 30 – Oct 16 |
| 1.5 Data Connectors | [BA-5](https://halo-powered.atlassian.net/browse/BA-5) | Sep 30 – Oct 23 |
| 1.6 User Testing | [BA-10](https://halo-powered.atlassian.net/browse/BA-10) | Oct 19 – Oct 23 |
| 1.7 Bug Fixes | [BA-11](https://halo-powered.atlassian.net/browse/BA-11) | Oct 26 – Oct 30 |
| 1.8 Agentic Hub Look and Feel | [BA-141](https://halo-powered.atlassian.net/browse/BA-141) | No dates in Jira yet |
| 1.9 Agent Hub | [BA-150](https://halo-powered.atlassian.net/browse/BA-150) | No dates in Jira yet; due with the beta |

Evals come first in the order even though they run in parallel: every other milestone is measured against them.

### Milestone 1.1 — Golden Dataset and Evals ([BA-9](https://halo-powered.atlassian.net/browse/BA-9)) — archived, see roadmap-archive.md

### Milestone 1.2 — Data Model DSL ([BA-2](https://halo-powered.atlassian.net/browse/BA-2)) — archived, see roadmap-archive.md

### Milestone 1.3 — Knowledge Store ([BA-4](https://halo-powered.atlassian.net/browse/BA-4)) — archived, see roadmap-archive.md

### Milestone 1.4 — Response Reliability Signals ([BA-12](https://halo-powered.atlassian.net/browse/BA-12)) — archived, see roadmap-archive.md

### Milestone 1.5 — Data Connectors ([BA-5](https://halo-powered.atlassian.net/browse/BA-5)) — archived, see roadmap-archive.md

### Milestone 1.6 — User Testing ([BA-10](https://halo-powered.atlassian.net/browse/BA-10)) — archived, see roadmap-archive.md

### Milestone 1.7 — Bug Fixes ([BA-11](https://halo-powered.atlassian.net/browse/BA-11))

Fix the bugs and blockers from user testing and the golden-dataset evals, and stabilize the build for the Oct 31 release. No fix version in Jira yet. New bugs filed under BA-11 get a feature here.

#### 1.7.1 — Session thread is empty after navigating away and back ([BA-83](https://halo-powered.atlassian.net/browse/BA-83))  `📋 Planned`
- **Intent:** returning to a session always shows its history.
- **Scope:** `SessionChat` only resets its messages when the session id changes (`frontend/src/app/features/sessions/components/session-chat/session-chat.ts`, the effect around line 255). Check whether the session is re-fetched on return, and that leaving mid-stream resets `sending()`.
- **Out of scope:** —
- **Acceptance:**
  - Returning to a session always shows its messages without a refresh, including after leaving mid-stream.
  - Same-id refreshes still do not abort an in-flight stream (the existing `SessionChat` rule in CLAUDE.md).
  - An E2E test covers leaving and returning.

#### 1.7.2 — Release stabilization  `📋 Planned`
- **Intent:** a shippable 1.0 Beta on 2026-10-31.
- **Scope:** blockers from 1.6 and 1.1; full E2E suite green; installers built for all platforms and published to the release.
- **Acceptance:** release tagged and installers attached; no open blocker bugs in BA.

Bugs found by the spec backfill (0.2.2), security first. Details: [evidence/0.2.2/findings.md](evidence/0.2.2/findings.md).

#### 1.7.3 — Datasource credentials stored in plaintext ([BA-101](https://halo-powered.atlassian.net/browse/BA-101))  `📋 Planned`
- **Intent:** datasource secrets are encrypted at rest like the LLM key.
- **Scope:** see the Jira bug and the Open question in [system/data-model.md](specs/system/data-model.md).
- **Acceptance:** Passwords, tokens and REST credentials/headers are encrypted and masked; existing installs are migrated.

#### 1.7.4 — Desktop backend reachable from the network ([BA-102](https://halo-powered.atlassian.net/browse/BA-102))  `📋 Planned`
- **Intent:** only the local machine can reach the desktop backend.
- **Scope:** see the Jira bug and the Open question in [system/api.md](specs/system/api.md).
- **Acceptance:** The desktop backend binds `127.0.0.1`.

#### 1.7.5 — Bearer tokens survive diagnostics redaction ([BA-91](https://halo-powered.atlassian.net/browse/BA-91))  `📋 Planned`
- **Intent:** no credential reaches the logs or an exported report.
- **Scope:** see the Jira bug and the Open question in [capabilities/diagnostics/spec.md](specs/capabilities/diagnostics/spec.md).
- **Acceptance:** `Authorization: Bearer <token>` and the missing key names (`pwd`, `passwd`, `access_key`, `private_key`) are fully redacted; a unit test covers each pattern.

#### 1.7.6 — Assistant SQL not limited to session datasets ([BA-103](https://halo-powered.atlassian.net/browse/BA-103))  `📋 Planned`
- **Intent:** the assistant can only query the session's datasets.
- **Scope:** see the Jira bug and the Open question in [capabilities/datasources/spec.md](specs/capabilities/datasources/spec.md).
- **Acceptance:** Statements naming entities outside the session's datasets are rejected with a clear message.

#### 1.7.7 — Read-only SQL guard is a keyword blacklist ([BA-104](https://halo-powered.atlassian.net/browse/BA-104))  `📋 Planned`
- **Intent:** read-only enforcement is correct and does not reject harmless queries.
- **Scope:** see the Jira bug and the Open question in [capabilities/datasources/spec.md](specs/capabilities/datasources/spec.md).
- **Acceptance:** A parser-based guard; `replace(...)` and `;` inside literals pass; Databricks writes are still rejected.

#### 1.7.8 — PostgreSQL SSL skips certificate checks ([BA-105](https://halo-powered.atlassian.net/browse/BA-105))  `📋 Planned`
- **Intent:** SSL connections are verified by default.
- **Scope:** see the Jira bug and the Open question in [capabilities/datasources/spec.md](specs/capabilities/datasources/spec.md).
- **Acceptance:** Certificates are verified unless the user opts out; a CA field exists.

#### 1.7.9 — Fixed default APP_SECRET fallback ([BA-106](https://halo-powered.atlassian.net/browse/BA-106))  `✅ Done`
- **Intent:** encrypted keys are never protected by a known secret, and a change of secret never leaves the LLM settings broken behind an unexplained backend error.
- **Scope:**
  - A bare backend with no `APP_SECRET` reads or generates `<APP_DATA_DIR>/.app-secret` (32 random bytes hex, mode 0600), the same as Electron main and the CLI. The fixed development default is no longer used to encrypt.
  - At startup, an LLM API key encrypted under the old development default (`insecure-dev-secret`) is re-encrypted with the current secret, so installs that ran before the launchers persisted a secret keep their key.
  - A stored key that neither secret can read no longer fails with a 500: the settings view reports `configured: false` with `keyUnreadable: true` and keeps provider, model and base URL; the LLM Configuration screen says the key must be entered again; agent turns, test and save without a key fail with the same readable message.
- **Out of scope:** encrypting datasource credentials (1.7.3, BA-101); recovering a key encrypted under a lost random secret (impossible by design).
- **Acceptance:**
  - A backend started with no `APP_SECRET` creates `.app-secret` in its data dir and reuses it on the next start; no "insecure development default" warning.
  - A key saved under the development default is readable after a launch with a real secret, and is stored re-encrypted under it.
  - A key under an unknown secret: `GET /llm/settings` is 200 with `keyUnreadable: true`; the screen shows "Your saved API key can't be read because the app secret changed. Enter the key again, test and save."; re-entering the key, testing and saving fixes it.
  - Gherkin in [capabilities/llm-settings/spec.md](specs/capabilities/llm-settings/spec.md) mirrored by `frontend/e2e/llm-settings.spec.ts`, green.
- **Notes:** found from a diagnostics report on 2026-10-06: the first launch of a data dir after commit `a3ef363` (Electron persists `.app-secret`) could not read the key saved under the development default.

#### 1.7.10 — Web-mode diagnostics export not redacted ([BA-107](https://halo-powered.atlassian.net/browse/BA-107))  `📋 Planned`
- **Intent:** redaction is the same in desktop and browser modes.
- **Scope:** see the Jira bug and the Open question in [capabilities/diagnostics/spec.md](specs/capabilities/diagnostics/spec.md).
- **Acceptance:** The browser-mode log buffer and export are redacted.

#### 1.7.11 — Tailoring after a revert overwrites a version ([BA-92](https://halo-powered.atlassian.net/browse/BA-92))  `📋 Planned`
- **Intent:** every visual version is immutable once written.
- **Scope:** see the Jira bug and the Open question in [capabilities/visuals/spec.md](specs/capabilities/visuals/spec.md).
- **Acceptance:** After revert v3 → v1 and a tailor, the new version is v4 and v1–v3 are unchanged.

#### 1.7.12 — Interrupted eval runs stay running ([BA-93](https://halo-powered.atlassian.net/browse/BA-93))  `📋 Planned`
- **Intent:** an interrupted eval run never blocks the agent or the UI.
- **Scope:** see the Jira bug and the Open question in [capabilities/agents-evals/spec.md](specs/capabilities/agents-evals/spec.md).
- **Acceptance:** On startup, runs left `running` are marked interrupted and can be deleted.

#### 1.7.13 — Auto-repair rebuilds from stale data ([BA-94](https://halo-powered.atlassian.net/browse/BA-94))  `📋 Planned`
- **Intent:** repairing a visual never loses its data.
- **Scope:** see the Jira bug and the Open question in [capabilities/visuals/spec.md](specs/capabilities/visuals/spec.md).
- **Acceptance:** Auto-repair uses the current version's `data.json`.

#### 1.7.14 — Verified query id rotates on re-approval ([BA-95](https://halo-powered.atlassian.net/browse/BA-95))  `📋 Planned`
- **Intent:** promoted metrics keep their source link.
- **Scope:** see the Jira bug and the Open question in [capabilities/verified-queries/spec.md](specs/capabilities/verified-queries/spec.md).
- **Acceptance:** Re-approving an answer keeps the verified query id.

#### 1.7.15 — Testing data clobbers same-name datasources ([BA-96](https://halo-powered.atlassian.net/browse/BA-96))  `📋 Planned`
- **Intent:** loading or removing sample data never touches user records.
- **Scope:** see the Jira bug and the Open question in [capabilities/testing-data/spec.md](specs/capabilities/testing-data/spec.md).
- **Acceptance:** Load and Remove affect only records the fixture created.

#### 1.7.16 — Dataset rename duplicates; delete unconfirmed ([BA-97](https://halo-powered.atlassian.net/browse/BA-97))  `📋 Planned`
- **Intent:** dataset edits and deletes are predictable.
- **Scope:** see the Jira bug and the Open question in [capabilities/datasets/spec.md](specs/capabilities/datasets/spec.md).
- **Acceptance:** Rename updates in place; delete asks for confirmation and names the sessions that use the dataset.

#### 1.7.17 — Datasource-scoped knowledge is never used ([BA-98](https://halo-powered.atlassian.net/browse/BA-98))  `📋 Planned`
- **Intent:** every saved knowledge entry can reach the assistant.
- **Scope:** see the Jira bug and the Open question in [capabilities/knowledge/spec.md](specs/capabilities/dataset-ontology/spec.md).
- **Acceptance:** Datasource-scoped entries are injected for sessions on that datasource, or the scope is removed.

#### 1.7.18 — Stale application-shell visual baseline ([BA-99](https://halo-powered.atlassian.net/browse/BA-99))  `📋 Planned`
- **Intent:** the visual baseline matches the current shell.
- **Scope:** see the Jira bug and the Open question in [system/ui.md](specs/system/ui.md).
- **Acceptance:** The baseline shows the current sidebar and the visual test passes.

#### 1.7.19 — Sidebar session order goes stale ([BA-100](https://halo-powered.atlassian.net/browse/BA-100))  `📋 Planned`
- **Intent:** the most recently used session is on top.
- **Scope:** see the Jira bug and the Open question in [capabilities/agent-answers/spec.md](specs/capabilities/agent-answers/spec.md).
- **Acceptance:** After a chat turn the session moves to the top without a reload.

#### 1.7.20 — Renderer honours a non-default `BACKEND_PORT` ([BA-109](https://halo-powered.atlassian.net/browse/BA-109))  `📋 Planned`
- **Intent:** setting `BACKEND_PORT` must move the whole desktop app to that port, not just the backend. Today the main process spawns the backend and runs its readiness probe on `BACKEND_PORT` (`frontend/electron/main.cjs`), but under `file://` the renderer hardcodes `http://localhost:3000` (`frontend/src/app/core/config/api.config.ts`), and the preload bridge doesn't expose the port. With `BACKEND_PORT=3123` the window opens and every API call fails, or it quietly reaches whatever else is listening on 3000.
- **Scope:** pass the resolved port from the main process to the renderer before Angular boots: through `preload.cjs` (`contextBridge`, e.g. `window.qti.backendPort`) or a query parameter on the `loadFile` / dev URL. Make `API_BASE_URL` read it and fall back to 3000. Cover `npm run electron`, `electron:dev` and packaged builds.
- **Out of scope:** automatic free-port fallback in Electron (the CLI already has one); the web / `npx` mode, which is same-origin and unaffected.
- **Acceptance:**
  - With `BACKEND_PORT=3123`, the packaged and `npm run electron` apps load sessions, datasources and chat against port 3123, and nothing requests `:3000`.
  - With no `BACKEND_PORT`, behaviour is unchanged.
  - A Playwright scenario in `frontend/e2e/` launches Electron with a non-default `BACKEND_PORT` and asserts the shell loads data (new Gherkin scenario in [specs/capabilities/app-shell/spec.md](specs/capabilities/app-shell/spec.md)).
  - The `API_BASE_URL` sentence in CLAUDE.md ("Known gap") is updated.
- **Notes:** moved from 0.1.1 on 2026-10-04 so the bug sits under a Jira epic (BA-11). Found while drawing the C4 container diagram ([specs/system/architecture.md](specs/system/architecture.md), Level 2). Related to ADR-0001.

### Milestone 1.8 — Agentic Hub Look and Feel ([BA-141](https://halo-powered.atlassian.net/browse/BA-141)) — archived, see roadmap-archive.md

### Milestone 1.9 — Agent Hub ([BA-150](https://halo-powered.atlassian.net/browse/BA-150)) — archived, see roadmap-archive.md

### Milestone 1.10 — LLM configuration ([BA-159](https://halo-powered.atlassian.net/browse/BA-159)) — archived, see roadmap-archive.md

### Milestone 1.11 — Claude Code workflow mod ([BA-169](https://halo-powered.atlassian.net/browse/BA-169)) — archived, see roadmap-archive.md

### Milestone 1.13 — Assistant skills: progressive-disclosure agent structure ([BA-198](https://halo-powered.atlassian.net/browse/BA-198)) — archived, see roadmap-archive.md

### Milestone 1.14 — Agent Hub: tools and skills per agent ([BA-213](https://halo-powered.atlassian.net/browse/BA-213)) — archived, see roadmap-archive.md

### Milestone 1.15 — US Health demo ([BA-233](https://halo-powered.atlassian.net/browse/BA-233)) — archived, see roadmap-archive.md

### Milestone 1.16 — Data Readiness Agent ([BA-251](https://halo-powered.atlassian.net/browse/BA-251)) — archived, see roadmap-archive.md

### Milestone 1.17 — Custom LLM endpoint provider ([BA-281](https://halo-powered.atlassian.net/browse/BA-281)) — archived, see roadmap-archive.md

### Milestone 1.18 — Desktop installer builds ([BA-302](https://halo-powered.atlassian.net/browse/BA-302)) — archived, see roadmap-archive.md

### Milestone 1.19 — US Health testing data ([BA-305](https://halo-powered.atlassian.net/browse/BA-305)) — archived, see roadmap-archive.md

### Milestone 1.20 — Schema metadata in datasets ([BA-318](https://halo-powered.atlassian.net/browse/BA-318)) — archived, see roadmap-archive.md

### Milestone 1.21 — Questions to Insights v2 ([BA-320](https://halo-powered.atlassian.net/browse/BA-320)) — archived, see roadmap-archive.md

### Milestone 1.22 — Sampled profiling and synthetic data (M1-22) — archived, see roadmap-archive.md

### Milestone 1.23 — Workflow-first: chats run workflows, agents are building blocks (M1-23)

The app becomes workflow-first: a chat runs a **workflow** defined in code, and agents are the building blocks that its steps call (workflows → agents → skills → tools). Every agent without a workflow of its own gets an automatic one-step workflow, so every session runs a workflow and there is one turn path. A **Workflows** area on the rail lists them, shows what each does on every message and starts chats; **Agents** becomes the library. The four showcase agents are removed. The epic started on 2026-11-11 as "Questions to Insights v2: a workflow you can follow" (story 1.23.1) and was widened the same day. Decision: ADR-0040. All stories are built on the branch `feat/M1-23-workflow-first` and ship as one PR. Epic spec: [specs/epics/M1-23/spec.md](specs/epics/M1-23/spec.md). Plan and contract: [docs/plans/m1-23-workflow-first.md](docs/plans/m1-23-workflow-first.md). No Jira key (repo only). Build order: 1.23.1, 1.23.2, 1.23.8, 1.23.3, then 1.23.4 with 1.23.5 in parallel, then 1.23.6 with 1.23.7 in parallel.

#### 1.23.1 — The Graph tab draws a workflow-backed agent's turn  `🚧 In progress`
- **Intent:** open Questions to Insights v2 → **Graph** and see, step by step, what happens on each message. Show which steps are code and which is the LLM, what each step receives and returns, the agent's tools and step limit inside the LLM step, and where a turn fails or stops.
- **Scope:**
  - `GET /agents/:key` (api.md 34) gains `workflow?` for a workflow-backed agent (today only `assistant-v2`). It holds the workflow id and its steps in order, each with:
    - id, title, kind (`code` or `agent`) and a one-line summary;
    - input and output field names, taken from the step's schemas;
    - for the agent step, its tools and maximum steps;
    - the step's other exits (`fails` or `stops`, with a label).
  - The data is built from the registered workflow and its step catalogue, never written twice, so a step added in code shows up without a UI change.
  - Graph tab of a workflow-backed agent, top section **What happens on each message**:
    - one node per step, left to right, in the workflow bar's titles and numbering;
    - code steps and the agent step in two distinct styles, with a legend;
    - the agent step drawn open: agent name, its tools and a loop marker `≤ <n> steps`;
    - labelled arrows carry the data passed between steps;
    - each step's other exits are drawn under it.
    - Hovering or focusing a step highlights it. Clicking it opens a details card under the drawing with its kind, summary, input and output.
  - Under it, the existing prompt-links graph keeps its behaviour under a **Prompt links** heading.
  - Specs: agents-evals R105 (+ a new rule and a Gherkin scenario), api.md 34, ui.md 4.5.6, agents.md 5.11 (the step catalogue's summaries and exits).
- **Out of scope:**
  - a run's live or last status on the drawing;
  - editing the workflow from the UI;
  - Graph changes for the assistant, the RFP Builder, the Data Readiness Agent, user agents and System agents;
  - the non-streamed turn;
  - changing the workflow's steps or what reaches the model.
- **Acceptance:**
  - Questions to Insights v2's Graph tab shows `Receive question`, `Load catalog`, `Analyse` and `Wrap up` in order:
    - Analyse is in the agent style, with `list_entities`, `describe_entity`, `run_readonly_sql` and `≤ 15 steps`;
    - the other three are in the code style;
    - the arrows are labelled with the step outputs;
    - the exits are visible: empty question fails, Stop ends at Analyse, model error fails.
  - Clicking `Load catalog` shows its input `question, datasets` and output `question, catalog`.
  - The Prompt links graph is still there.
  - The assistant's Graph tab is unchanged.
  - The axe scan passes in both themes.
  - Unit tests:
    - the `workflow` field matches the registered workflow's step order and schemas;
    - the layout is a pure function.
  - The `@demo @story-1.23.1` scenario passes.
  - Builds and check-specs are green.
- **Notes:** requested on 2026-11-11, after a review of agent-vs-workflow approaches. The user chose the Graph tab over a new tab, the definition only (no run status) for now, and a new epic because Milestone 1.21 has shipped. UI story: its demo is recorded in the fast loop. Built and committed (8fa8b745) before the epic was widened; its drawing is reused by 1.23.5.

#### 1.23.2 — Workflow-first: ADR, epic spec, glossary and roadmap  `🚧 In progress`
- **Intent:** the move to workflow-first is decided and scoped before any code, so each later story can be built and reviewed on its own.
- **Scope:**
  - ADR-0040 in `specs/system/architecture.md`, with "amended by ADR-0040" on ADR-0004, 0008, 0028, 0029 and 0034;
  - the widened epic spec, its README row and this milestone's entries;
  - the glossary terms: Workflow, One-step workflow, Code-defined workflow; Session and Agent amended.
- **Out of scope:** product code; the capability, api, data-model, agents and ui specs (each later story updates its own).
- **Acceptance:** ADR-0040 is `Accepted` and the epic spec `Confirmed (<date>)` by the user; `origin/main` was merged first and the ADR number re-checked; check-specs passes.
- **Notes:** S-size docs story. Plan: [docs/plans/m1-23-workflow-first.md](docs/plans/m1-23-workflow-first.md).

#### 1.23.8 — Remove the showcase agents  `📋 Planned`
- **Intent:** the four showcase agents (Benchmarking, Survey, LAD COE, Strategy), which never run, are gone from the app.
- **Scope:** their agent files, registration and shipped prompts; every showcase branch in the backend and the agent hub; a saved pin or prompt override for their keys is ignored, never an error (no migration). Specs: agents-evals R106 retired and the lines naming them, agents.md 2.9, api.md 33, agent-answers R64, ui.md, glossary. Past epic specs stay as history.
- **Out of scope:** System agents; any other agent.
- **Acceptance:** no showcase agent in the hub or the new-session picker; `GET /agents/benchmarking` answers 404; with a pin and an override saved for `strategy`, the hub and `GET /agents` still load; `agent-hub` and `session-management` specs updated; the `@demo @story-1.23.8` scenario passes; builds, unit tests, lint and check-specs green.
- **Notes:** requested on 2026-11-11 (answer to the plan's open question 1). Built right after 1.23.2, so later stories have no showcase case. Detail: plan section 7.

#### 1.23.3 — The workflow catalogue: list, detail, and sessions bound to a workflow  `📋 Planned`
- **Intent:** the backend knows every workflow a chat can run, says which one a session runs and which workflows use an agent, and starts a session from a workflow id. No UI.
- **Scope:** the framework-free workflow catalogue and `agent-turn` step catalogue; `GET /workflows`, `GET /workflows/:id`; `POST /sessions { workflowId }`; a new session stores `workflowId`; the session's `workflowRef`; the agent's `usedInWorkflows`; the new `workflows` capability spec, api.md, data-model 3.4, agents.md.
- **Out of scope:** the turn path (1.23.4); every UI change; editing workflows.
- **Acceptance:** unit tests for the derivation table, id parsing, drift and the creation invariant; the backend e2e `backend/test/workflows.e2e-spec.ts` (catalogue order, user agents Live-only, 404s, sessions from a workflow, `usedInWorkflows`); existing agent and session e2e specs unchanged; check-specs, lint, builds, unit tests green.
- **Notes:** API-only: its demo is `evidence/1.23.3/demo.txt`. Detail and contract: plan sections 4, 5 and 7.

#### 1.23.4 — Every streamed turn runs the session's workflow  `📋 Planned`
- **Intent:** one turn path: an assistant, RFP Builder, Data Readiness or user-agent turn is a run of its one-step workflow, with the same answer, events, bar and stored message as before.
- **Scope:** the `agent-turn` Mastra workflow; `runTurnWorkflow` replaces the v2-only path and the direct agent call; a one-step workflow never writes the bar; one real trace captured and Monitoring kept true (workflow spans classed as Framework only if they appear); agents.md, agent-panel, sessions-chat, monitoring (if needed).
- **Out of scope:** the non-streamed turn; evals; any change to an agent's prompt, tools or context; UI.
- **Acceptance:** the existing session unit suites pass with only v2's internal names adapted; new unit tests per agent kind, bar, clarification and error handling; the request-recording Playwright specs unchanged and green; the `getInstructions()` and tool-list hashes equal on base and branch; builds and check-specs green.
- **Notes:** highest-risk story; trace before theorising. Demo: `evidence/1.23.4/demo.txt`. Parallel with 1.23.5.

#### 1.23.5 — A Workflows area: list, workflow page and Start chat  `📋 Planned`
- **Intent:** open **Workflows** on the rail, see every workflow you can run, open one to see what happens on each message and which agents it uses, and start a chat from it.
- **Scope:** the rail item; the list (search, Official and Mine sections, cards with Start chat and requirements); the workflow page (the 1.23.1 drawing, its agents, Start chat); app-shell, the `workflows` capability, ui.md.
- **Out of scope:** the composer's Workflow field (1.23.6); removing Start chat from agents (1.23.7); editing workflows; run status.
- **Acceptance:** `frontend/e2e/workflows.spec.ts` with `@demo @story-1.23.5` (open v2's workflow, open a user agent's one-step workflow, Start chat); a blocked workflow says why; no editing control exists; search; the axe scan on both pages in both themes; navigation specs green.
- **Notes:** UI story. Parallel with 1.23.4.

#### 1.23.6 — The New conversation screen picks a workflow; chats name their workflow  `📋 Planned`
- **Intent:** a chat is started by choosing a **Workflow**, and every chat names its workflow in its header and in the Sessions list.
- **Scope:** the composer's Agent field becomes Workflow (same listbox behaviour, Assistant preselected); Create sends the workflow id; the `Workflow` header chip on every chat and the Sessions list chip; sessions-chat, ui.md.
- **Out of scope:** the agent pages (1.23.7).
- **Acceptance:** `session-management.spec.ts` with `@demo @story-1.23.6` (pick v2, create, header and Sessions chip, the bar's four steps); a deleted agent's session and a pre-epic session name their workflow; the axe scan on the composer in both themes; every spec using the old composer test ids updated.
- **Notes:** UI story. Parallel with 1.23.7 (ownership of `app.ts` regions in the plan).

#### 1.23.7 — Agents are building blocks: no Start chat, and "Used in" workflows  `📋 Planned`
- **Intent:** the Agents area is a library: a chat is never started from an agent, and each agent shows which workflows use it.
- **Scope:** Start chat removed from hub cards and agent detail; the Official agents' Chat Box tab removed (System Prompt becomes their default tab; user agents keep Chat Box for the preview); the `Used in` line linking to workflow pages; agents-evals, sessions-chat, rfp, data-readiness, ui.md.
- **Out of scope:** the agent editor and preview chat.
- **Acceptance:** `agent-hub.spec.ts` with `@demo @story-1.23.7` (no Start chat; `Used in` opens the workflow page; RFP Builder has no Chat Box tab); draft-only and System agents show their empty `Used in` text; the RFP and Data Readiness Start chat scenarios pass through Workflows; the agent editor specs pass unchanged; the axe scan in both themes.
- **Notes:** UI story. After it, the epic's stories go through the acceptance gate, then one changelog entry and the PR.

#### 1.23.9 — Run a workflow on an input: the sequential test workflow  `🚧 In progress`
- **Intent:** a workflow runs once on a typed input and shows each step's result, with no chat. The first such workflow is a three-step test workflow.
- **Scope:** run workflows in the catalogue (`trigger`, typed `input` fields defined in code); the `seq-text-demo` workflow (Clean text → Count words → Format result, code only); `POST /workflows/:id/runs` (api.md 118, nothing stored); the run workflow's page with its input form, Run and the per-step result; the list card's Run button; chat-only refusals and pickers. Contract: plan section 9.
- **Out of scope:** converting the four chat workflows and changing how chats start (1.23.10); storing runs; streaming a run's progress; LLM steps.
- **Acceptance:** unit tests for the three step functions, the catalogue entry, input validation and the drift test; a backend e2e for 118 (success, failed step, missing field, chat workflow refused); `frontend/e2e/workflows.spec.ts` with `@demo @story-1.23.9` (open the Sequential test workflow, type a text, Run, see three Done steps and the summary; an empty text shows Clean text Failed and the other two Skipped); the axe scan of the run page in both themes; builds, unit tests, lint and check-specs green.
- **Notes:** requested on 2026-11-11 ("workflows trigger workflows, not chats; we'll define the input as we go"). The user chose: all workflows become run workflows (the four existing ones in 1.23.10), a code-only test workflow, results shown on the page and not stored.

Stories 1.23.10–1.23.27 retire chats: every workflow runs once on a typed input, runs are stored, past chats open read-only (ADR-0041). Plan and contract: [docs/plans/m1-23-retire-chats.md](docs/plans/m1-23-retire-chats.md); its section 11.1 maps the plan's ids (1.24.x, 1.25.x) to these. Phase A is 1.23.11–1.23.22, Phase B 1.23.23–1.23.25, Phase C 1.23.26–1.23.27. Requested on 2026-11-11; the user kept every phase in this epic and branch.

#### 1.23.10 — The workflow page as a designer: graph canvas in the middle, configuration on the right  `🚧 In progress`
- **Intent:** a workflow's page looks like a workflow designer: its graph on a central canvas (Start → steps → End, kind badges, zoom), and its configuration, inputs, outputs, run and code in tabs of the right-hand panel.
- **Scope:** plan section 11.2: header with breadcrumb and Execute; the canvas (pure layout function, HTML nodes over SVG connectors, toolbar, pan, selection); the right panel's Workflow, Step, Run and Code tabs; the 1.23.9 run form and result move into Run, with run status chips on the nodes; workflows spec and ui.md 4.4b.
- **Out of scope:** editing workflows; forks and parallel branches; the agent detail's Graph tab (unchanged).
- **Acceptance:** layout unit tests; `@demo @story-1.23.10` (v2 opens as a designer, select Analyse → Step tab, Code tab, run the test workflow from Execute with Done chips on its nodes); the 1.23.5 and 1.23.9 scenarios updated; axe in both themes with the panel open; builds, unit tests and check-specs green.
- **Notes:** from the user's screenshot of a workflow designer (2026-11-11). Frontend only; built first so the run stories add their inputs to the Run tab.

#### 1.23.11 — Chats retired: ADR-0041, epic spec, glossary and roadmap  `🚧 In progress`
- **Intent:** the retirement of chats is decided and scoped before code. **Scope:** ADR-0041 (Accepted) with its status pointers; the epic spec amendment; this roadmap; glossary terms Run, Run workflow, Past chat. **Acceptance:** check-specs green. **Notes:** plan 1.24.1.

#### 1.23.12 — Streamed runs of agent workflows on the backend  `📋 Planned`
- **Intent:** every agent workflow (Assistant, v2, RFP Builder, Data Readiness, user agents) runs once on a typed input with live progress, through today's turn path on a temporary host. **Acceptance:** a run's model request equals a chat turn's for the same input; per plan 1.24.2.

#### 1.23.13 — The answer view, extracted from the chat  `📋 Planned`
- **Intent:** the chat's answer rendering (text, data, SQL, visuals, files) becomes a component a run can show, with no visible change. **Acceptance:** per plan 1.24.3. Parallel with 1.23.12.

#### 1.23.14 — Stored runs, the run history API and run files  `📋 Planned`
- **Intent:** runs of agent workflows are stored (`workflow_runs`), listed and downloadable. **Acceptance:** per plan 1.24.4.

#### 1.23.15 — Run the Assistant, Questions to Insights v2 and user agents from their page  `📋 Planned`
- **Intent:** from the designer's Run tab, ask a question over picked datasets and see the answer, with Follow up carrying one earlier run. **Acceptance:** per plan 1.24.5, with `@demo @story-1.23.15`.

#### 1.23.16 — Run the Data Readiness Agent on a dataset  `📋 Planned`
- **Acceptance:** per plan 1.24.6; reports record the run that made them.

#### 1.23.17 — Run the RFP Builder one exchange at a time  `📋 Planned`
- **Acceptance:** per plan 1.24.7: one run per exchange keyed by the RFP id, with Continue.

#### 1.23.18 — Move the request-recording E2E specs from chats to runs  `📋 Planned`
- **Acceptance:** per plan 1.24.8 (tests only).

#### 1.23.19 — Rate a run's answer: verified queries from runs  `📋 Planned`
- **Acceptance:** per plan 1.24.9.

#### 1.23.20 — Monitoring shows runs  `📋 Planned`
- **Acceptance:** per plan 1.24.10.

#### 1.23.21 — Runs replace Sessions on the rail; past chats open read-only  `📋 Planned`
- **Acceptance:** per plan 1.24.11; no stored session is lost or migrated. Also carries what 1.23.15 left out of plan 1.24.5: reopening a stored run read-only (`run-detail`), Run again, the agent-phases bar inside the agent step, and the Careful mode "Cross-checked" run scenario; and Monitoring's "Sessions" tab, column and filter renamed for runs (left out of 1.23.20).

#### 1.23.22 — Chats can no longer start  `📋 Planned`
- **Acceptance:** per plan 1.24.12, including the desktop readiness probe on `GET /health`. Last story of Phase A.

#### 1.23.23 — Try it: run an agent's draft instead of a preview chat  `📋 Planned`
- **Acceptance:** per plan 1.25.2.

#### 1.23.24 — Deep analysis as a run workflow  `📋 Planned`
- **Acceptance:** per plan 1.25.3.

#### 1.23.25 — Visual actions on a run's result  `📋 Planned`
- **Acceptance:** per plan 1.25.4, including the visual card's View in a run's answer (not wired in 1.23.15: the right panel holds the designer).

#### 1.23.26 — Extract the turn engine; evals and dev scripts on run hosts  `🚧 In progress`
- **Scope now (moved up, wave S2):** only the turn-engine extraction, per [the speed-up contract](docs/plans/m1-23-dev-speedup.md), plan 1.23.26. Evals and dev scripts on run hosts stay for later (plan 1.25.5).
- **Acceptance:** per the speed-up contract: `sessions.service.ts` shrinks by more than 1,500 lines; backend unit and e2e suites, the request-recording Playwright specs and the agent hashes are unchanged.

#### 1.23.26b — Evals and dev scripts on run hosts  `📋 Planned`
- **Intent:** the remainder of plan 1.25.5 left out of 1.23.26: evals and the dev scripts stop creating chat sessions and run on run hosts, so 1.23.27 can remove the chat write paths. Contract: [the retire-chats plan](docs/plans/m1-23-retire-chats.md), plan 1.25.5.
- **Acceptance:** evals send each agent the same requests as before (prompt and tool-list hashes equal; one eval case per agent kind run against the recording stub, before and after, with identical requests); no eval or dev script calls `POST /sessions` or the chat stream; backend unit and e2e suites green.

#### 1.23.27 — Remove the chat write paths and specs  `📋 Planned`
- **Acceptance:** per plan 1.25.6; past chats stay readable.

Stories 1.23.28–1.23.33 make the development workflow faster and cheaper, and 1.23.26 moves up to run before the rest of Phase A. The user decided on 2026-11-11 to implement every suggestion of the speed-up review on this branch. Contract: [docs/plans/m1-23-dev-speedup.md](docs/plans/m1-23-dev-speedup.md). Waves: S1 = 1.23.28, 1.23.29, 1.23.30, 1.23.31, 1.23.32; S2 = 1.23.26, 1.23.33; then Phase A resumes.

#### 1.23.28 — Lean story lane, model and effort routing, decide-before-build  `🚧 In progress`
- **Intent:** a story costs a fraction of today's time and tokens. **Scope:** contract section 1.23.28 (CLAUDE.md, the four workflow skills, builder.md, reviewer.md, delivery.md §10/12/13, lessons.md). **Acceptance:** check-specs green; a reviewer finds no contradiction between the documents.

#### 1.23.29 — `story-pack.mjs` and the spec section index  `📋 Planned`
- **Intent:** a builder starts from one generated brief instead of exploring. **Acceptance:** contract section 1.23.29.

#### 1.23.30 — Archive finished milestones of the roadmap  `📋 Planned`
- **Intent:** `roadmap.md` shrinks from 277 KB to under ~40 KB. **Acceptance:** contract section 1.23.30.

#### 1.23.31 — `qa.mjs --wave`: one verification for several stories  `📋 Planned`
- **Acceptance:** contract section 1.23.31.

#### 1.23.32 — Playwright in parallel  `📋 Planned`
- **Acceptance:** contract section 1.23.32: 3 workers, three green runs in a row, timings before and after.

#### 1.23.33 — Split `app.ts` / `app.html` by area  `🚧 In progress`
- **Scope:** [the speed-up contract](docs/plans/m1-23-dev-speedup.md), plan 1.23.33.
- **Acceptance:** `app.ts` under ~500 lines and `app.html` under ~400; no visible or test-id change; the frontend unit suite and the full web Playwright suite pass.
---

## Release 2 — Multi-user  (no target date yet)

The app becomes multi-user. An organisation self-hosts it as an org server, with sign-in, roles and an admin panel. Local mode stays the default. Direction: [specs/product/vision.md](specs/product/vision.md). Not part of the 1.0 Beta.

### Milestone 2.1 — Admin Panel ([BA-161](https://halo-powered.atlassian.net/browse/BA-161)) — archived, see roadmap-archive.md

## Backlog

Open stories and unsequenced plans live in [roadmap-backlog.md](roadmap-backlog.md); `qa.mjs`, `story-pack.mjs`, `demo-page.mjs` and `check-specs.py` read it.

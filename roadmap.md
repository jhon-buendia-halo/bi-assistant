# Roadmap

Pre-implementation plan for all work. Hierarchy: **Release → Milestone → Feature** (`R`, `R.M`, `R.M.F`). See *Planning convention* in [CLAUDE.md](CLAUDE.md).

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

### Milestone 0.1 — Desktop runtime correctness

*No Jira epic. New desktop-runtime bugs go under Milestone 1.7 Bug Fixes (BA-11).*

Electron shell, backend spawning, and renderer↔backend wiring: the app must behave the same however it is launched or configured.

#### 0.1.1 — Renderer honours a non-default `BACKEND_PORT`  `🚫 Cut`
- Moved to 1.7.20 (Milestone 1.7 Bug Fixes) as Jira bug [BA-109](https://halo-powered.atlassian.net/browse/BA-109) under Bug Fixes (BA-11). This milestone has no Jira epic, so the Epic gate would block work here.

### Milestone 0.2 — Delivery process ([BA-89](https://halo-powered.atlassian.net/browse/BA-89))

How work is planned, specified, built, verified and traced. It covers the repo's process documents, conventions and specs, not product behaviour. Epic spec: [specs/epics/BA-89/spec.md](specs/epics/BA-89/spec.md).

#### 0.2.1 — Adopt the delivery workflow, beta roadmap and branching convention ([BA-84](https://halo-powered.atlassian.net/browse/BA-84))  `✅ Done`
- **Intent:** every change follows the same plan → spec → test → implement → evidence → retrospective loop and traces back to a Jira issue.
- **Scope:**
  - The eleven-step workflow and its conventions in CLAUDE.md, including the branching convention.
  - Seeded process documents at the repo root: roadmap, architecture (C4 diagrams and ADRs), gherkin, changelog, retrospective and evidence.
  - The 1.0 Beta plan imported from Jira.
  - CLAUDE.md corrected where it had drifted from the code.
- **Out of scope:** product code changes. The port bug is tracked separately as 1.7.20 (BA-109).
- **Acceptance:**
  - CLAUDE.md describes the workflow and conventions.
  - Every process file it references exists.
  - The roadmap mirrors the BA 1.0 Beta epics and stories.
  - The work is merged through a PR from `docs/BA-84-claude-harness`.

#### 0.2.2 — Rebuildable system specs ([BA-90](https://halo-powered.atlassian.net/browse/BA-90))  `✅ Done`
- **Intent:** an LLM given only [specs/](specs/) can rebuild the app from scratch, and every change is specified there before it is built.
- **Scope:**
  - A `specs/` tree: product (vision, glossary, non-functional), system (architecture and ADRs, tech stack, data model, API, agents, UI, delivery), one spec per capability and one per Jira epic. Format, lifecycle and the rebuild prompt in [specs/README.md](specs/README.md).
  - Restructure: `architecture.md` moves to `specs/system/`, the Gherkin Features in `gherkin.md` move verbatim into the capability specs, and the how-it-works sections of CLAUDE.md move into `specs/system/`. CLAUDE.md keeps the rules and links.
  - Backfill the current system from the code, and draft an epic spec for every BA epic.
  - CLAUDE.md conventions: the Epic gate (no Jira epic, no code change), the Spec convention, and workflow steps 4–5 and 10 pointing at `specs/`.
  - A CI check (`.github/workflows/spec-checks.yml` running `scripts/check-specs.py`) that fails a PR when the specs drift from the code.
- **Out of scope:** product code changes; new E2E specs for the `E2E: none yet` Features; confirming the draft epic specs (each epic owner confirms theirs).
- **Acceptance:**
  - Every file listed in `specs/README.md` exists and every relative link in `specs/`, CLAUDE.md and roadmap.md resolves.
  - Every Gherkin scenario that was in `gherkin.md` is in exactly one capability spec, unchanged.
  - Every HTTP route in the backend controllers appears in `specs/system/api.md`; every collection in `database.module.ts` appears in `specs/system/data-model.md`; every registered agent appears in `specs/system/agents.md`.
  - The spec-checks workflow runs on pull requests, passes on this branch, and fails when drift is injected.
  - The work is merged through a PR from `docs/BA-90-rebuildable-specs`.
- **Notes:** evidence and the backfill's findings (likely bugs, security gaps, drift) in [evidence/0.2.2/](evidence/0.2.2/). `docs/plans/` and `docs/research/` stay where they are. They are plans and research, not specs of the shipped system, and the epic specs link to them.

#### 0.2.3 — Require the spec check before merging to `main` ([BA-108](https://halo-powered.atlassian.net/browse/BA-108))  `✅ Done`
- **Intent:** `main` rejects changes whose specs drift from the code, so the specs stay a complete description of the shipped app.
- **Scope:**
  - A repository ruleset on the default branch that requires the "Specs match the code" check.
  - The release workflow (`version-on-merge.yml`) pushes its bump commit straight to `main`, and a personal-account repo can't put GitHub Actions on a ruleset bypass list. So the workflow runs `scripts/check-specs.py` on the bump commit, stages it on a temporary branch, reports the "Specs match the code" status itself, and only then pushes to `main`.
- **Out of scope:** requiring reviews or other checks; changing how versions are computed.
- **Acceptance:**
  - A PR whose spec check fails cannot be merged, and a direct push to `main` is rejected.
  - After this PR merges, the release workflow still bumps the version and pushes the tag with the ruleset active.
  - `specs/system/delivery.md` describes the ruleset and the release workflow's status step.
- **Notes:** follows 0.2.2. Evidence: [evidence/0.2.3/](evidence/0.2.3/).

#### 0.2.4 — Require PR approval on `main`; only the repo admin may merge without one ([BA-110](https://halo-powered.atlassian.net/browse/BA-110))  `✅ Done`
- **Intent:** every change into `main` from a collaborator is reviewed by someone else first. The repo owner can still merge their own PRs without waiting.
- **Scope:**
  - A second repository ruleset on the default branch: PR required, 1 approving review, stale approvals dismissed when new commits are pushed.
  - Bypass list: the *Repository admin* role in *pull requests only* mode. The owner is the only admin of this personal-account repo, so only the owner can merge without approval, and still can't push straight to `main`.
  - The release workflow (`version-on-merge.yml`) pushes its bump commit straight to `main`, and GitHub Actions can't be on a bypass list in a personal-account repo. So it pushes with a repo-scoped write deploy key (`RELEASE_DEPLOY_KEY` secret), and deploy keys are on the bypass list.
  - CLAUDE.md *Branching convention* states the rule.
- **Out of scope:** CODEOWNERS or code-owner review; changing the spec-check ruleset; who has write access.
- **Acceptance:**
  - Without an approval, a PR can't be merged by a write collaborator, but the admin can merge it with the bypass.
  - A direct push to `main` is rejected, including the admin's.
  - After this PR merges, the release workflow still pushes the bump commit and tag to `main` with both rulesets active.
  - `specs/system/delivery.md` describes both rulesets and the deploy-key release push.
- **Notes:** follows 0.2.3. The probe on a throwaway branch confirmed that deploy-key bypass works on a personal-account repo. The first release (v0.20.7) passed, but its deploy-key tag push started an installer build; the follow-up pushes the tag with `GITHUB_TOKEN`. Evidence: [evidence/0.2.4/](evidence/0.2.4/).

### Milestone 0.3 — Local Development Observability ([BA-111](https://halo-powered.atlassian.net/browse/BA-111))

Developer tooling for seeing what the backend and agents are doing: agent and LLM traces, HTTP and database traces, metrics and linked logs. Switched on by a Developer toggle in Settings. With it off, which is the default, end-user installs behave exactly as before. Epic spec: [specs/epics/BA-111/spec.md](specs/epics/BA-111/spec.md). Decision: ADR-0006 in [specs/system/architecture.md](specs/system/architecture.md).

#### 0.3.1 — ADR, epic spec and roadmap ([BA-112](https://halo-powered.atlassian.net/browse/BA-112))  `✅ Done`
- **Intent:** the observability work is planned and its architecture decided before any code, so each later story can be built and reviewed on its own.
- **Scope:** ADR-0006 in `specs/system/architecture.md`; the BA-111 epic spec; this milestone with one feature per story; the epic row in `specs/README.md`.
- **Out of scope:** product code, and capability or system spec changes for behaviour that hasn't shipped yet. Each later story updates those on its own branch.
- **Acceptance:**
  - ADR-0006 records the setting file read before bootstrap, the restart-to-apply rule, the additive exporters and the off-by-default guarantee.
  - `specs/epics/BA-111/spec.md` exists and the user has confirmed it (`Status: Confirmed`).
  - `python3 scripts/check-specs.py` passes.
- **Notes:** branch `docs/BA-112-observability-specs`. The user confirmed the epic spec on 2026-10-05. Evidence: [evidence/0.3.1/](evidence/0.3.1/).

#### 0.3.2 — Developer settings panel with observability toggle ([BA-113](https://halo-powered.atlassian.net/browse/BA-113))  `✅ Done`
- **Intent:** a developer can turn observability on or off and point it at their tools without editing files or env vars.
- **Scope:**
  - A fourth Settings row, "Developer", after Datasources, LLM and Testing data, visible in every build.
  - A "Developer observability" toggle (off by default); editable Phoenix endpoint (default `http://localhost:6006`) and OTLP endpoint (default `http://localhost:4318`); a "Test connection" status for each.
  - Saved to a developer-settings file under `APP_DATA_DIR` through new backend endpoints, so the backend entry points can read it before the app loads.
  - A "Restart to apply" notice when the saved values differ from the ones the backend started with, with a Restart button in the desktop app (respawns the backend) and a restart hint in the npm CLI.
- **Out of scope:** the exporters themselves (0.3.4–0.3.6).
- **Acceptance:** Gherkin flows and a Playwright spec cover opening the section, toggling, editing and validating endpoints, testing connections and the restart notice; the settings survive a restart; a fresh install shows the toggle off.
- **Notes:** blocks 0.3.4, 0.3.5 and 0.3.6. Capability spec: [specs/capabilities/developer-settings/spec.md](specs/capabilities/developer-settings/spec.md). Branch `feat/BA-113-developer-settings`. Evidence: [evidence/0.3.2/](evidence/0.3.2/).

#### 0.3.3 — Docker Compose observability profile ([BA-114](https://halo-powered.atlassian.net/browse/BA-114))  `📋 Planned`
- **Intent:** the local tools start with one command and never start by accident.
- **Scope:** an `observability` profile in `docker-compose.yml` running `arizephoenix/phoenix` (UI and OTLP on 6006) and `grafana/otel-lgtm` (OTLP 4317/4318, Grafana on a host port other than 3000).
- **Out of scope:** persistent volumes for the tools; any change to the Postgres service.
- **Acceptance:** `docker compose --profile observability up -d --wait` starts both tools; plain `docker compose up` and the E2E global setup start only Postgres.
- **Notes:** independent of 0.3.2; can ship in parallel.

#### 0.3.4 — OpenTelemetry bootstrap gated by the developer setting ([BA-115](https://halo-powered.atlassian.net/browse/BA-115))  `📋 Planned`
- **Intent:** with the toggle on, every request's HTTP, NestJS, Postgres and outbound connector work is visible as one trace in Grafana.
- **Scope:** `main.ts` and `cli.ts` read the developer setting and, only when it is on, start the OpenTelemetry Node SDK with auto-instrumentation before dynamically importing the app; traces and metrics exported over OTLP to the configured endpoint.
- **Out of scope:** manual spans inside services; renderer tracing.
- **Acceptance:** toggle on → a chat question's HTTP and `pg` spans appear in Tempo; toggle off → no OpenTelemetry module is loaded and no OTLP request is made; an unreachable endpoint never fails a request or startup.
- **Notes:** depends on 0.3.2; uses 0.3.3 for verification.

#### 0.3.5 — Agent trace export to Arize Phoenix gated by the developer setting ([BA-116](https://halo-powered.atlassian.net/browse/BA-116))  `📋 Planned`
- **Intent:** with the toggle on, a developer can inspect each agent run (prompts, LLM calls, tool calls, tokens, latency) in Phoenix.
- **Scope:** add the Phoenix exporter to the Mastra `Observability` config next to `MastraStorageExporter` when the setting is on.
- **Out of scope:** removing or replacing the DuckDB store.
- **Acceptance:** toggle on → a chat question's agent run appears in Phoenix and in `observability.duckdb`; toggle off → only `observability.duckdb`, exactly as before.
- **Notes:** depends on 0.3.2.

#### 0.3.6 — Unified pino logging with trace ids ([BA-117](https://halo-powered.atlassian.net/browse/BA-117))  `📋 Planned`
- **Intent:** backend and agent logs are one stream that can be followed from a trace.
- **Scope:** route Nest logging through `nestjs-pino` alongside the agent `PinoLogger`; trace and span ids on each line when a trace is active; readable console output; OTLP log export to Loki only when the setting is on.
- **Out of scope:** changing what is logged.
- **Acceptance:** toggle on → backend logs in Loki link to their Tempo trace; toggle off → console logging only, with no OTLP export.
- **Notes:** depends on 0.3.4.

#### 0.3.7 — Developer docs for the local observability stack ([BA-118](https://halo-powered.atlassian.net/browse/BA-118))  `📋 Planned`
- **Intent:** any developer can go from a clean checkout to a trace in Phoenix and Grafana without asking anyone.
- **Scope:** docs for starting the compose profile, turning on the toggle, and finding a chat question in Phoenix and Grafana; worktree isolation notes (compose project name, ports).
- **Out of scope:** end-user documentation.
- **Acceptance:** a developer following only the docs sees one chat question in Phoenix and Grafana.
- **Notes:** last; depends on 0.3.2–0.3.6.

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

Evals come first in the order even though they run in parallel: every other milestone is measured against them.

### Milestone 1.1 — Golden Dataset and Evals ([BA-9](https://halo-powered.atlassian.net/browse/BA-9))

The measurement baseline. Every change to the DSL, knowledge store or connectors is measured against it before the beta ships.

#### 1.1.1 — Golden dataset and eval suite  `📋 Planned`
- **Intent:** know, with numbers, whether a change made answers better or worse.
- **Scope:** a golden dataset of representative questions with known-correct answers on the sample fixtures. An eval suite (LLM judge plus SQL and result checks) that runs against it, building on the existing `assistant-eval-judge` agent and `mastra/evals/` and the Agents → Evals tab.
- **Out of scope:** evals on customer data.
- **Acceptance:** the suite runs on demand against the golden dataset and reports per-question and per-category results. Results can be compared run to run, and a knowledge on/off comparison is possible (needed by 1.3.3).
- **Notes:** Jira has no stories under this epic yet, so this feature mirrors the epic. Split it into stories in Jira first, then mirror them here.

### Milestone 1.2 — Data Model DSL ([BA-2](https://halo-powered.atlassian.net/browse/BA-2))

The structure the assistant reasons over, as a single, versionable source of truth.

#### 1.2.1 — Data Model DSL  `📋 Planned`
- **Intent:** answers stop depending on what the model infers from raw schema alone.
- **Scope:** a domain-specific language describing entities, columns, relationships and business metrics; versionable; used to ground SQL generation.
- **Out of scope:** business meaning (synonyms, concepts). That belongs to the Knowledge Store, per the boundary set in 1.3.1.
- **Acceptance:** *to be defined.* The Jira epic has only a description. Agree the acceptance criteria before starting.
- **Notes:** architectural, so it needs an ADR in [specs/system/architecture.md](specs/system/architecture.md) before code. Overlaps the existing dataset metrics UI and the "semantic metrics layer" in [docs/plans/phase-4-strategic-bets.md](docs/plans/phase-4-strategic-bets.md) (item 13); reconcile the two. Assignee: Jhon Buendia.

### Milestone 1.3 — Knowledge Store ([BA-4](https://halo-powered.atlassian.net/browse/BA-4))

Curated knowledge the assistant treats as authoritative: glossary terms, standing instructions and default filters, scoped to a datasource or dataset. Covers authoring, mining suggestions from past sessions, and injecting the relevant snippets into each turn. Assignee: Sergio Berrospi.

#### 1.3.1 — Research and ontology design ([BA-78](https://halo-powered.atlassian.net/browse/BA-78))  `📋 Planned`
- **Intent:** an evidence-based design for how the knowledge store models business meaning, so query generation follows each data store's ontology.
- **Scope:**
  - Compare Databricks Genie, Snowflake Cortex Analyst semantic models, the dbt Semantic Layer, Cube and knowledge-graph text-to-SQL research.
  - Define the concept and relation model: concepts, synonyms, mappings to tables, columns and SQL expressions, and relations (is-a, has-many, measured-by).
  - Set the boundary with 1.2: the DSL holds structure, the knowledge store holds meaning.
  - Plan the snippet migration: terms become concepts, default filters become concept constraints, instructions are kept.
- **Out of scope:** implementation.
- **Acceptance:** the decision record is merged in `docs/` (as an ADR in [specs/system/architecture.md](specs/system/architecture.md)) and the model is agreed.

#### 1.3.2 — Ontology model, knowledge graph and bootstrap ([BA-79](https://halo-powered.atlassian.net/browse/BA-79))  `📋 Planned`
- **Intent:** business concepts and their relations live in one graph and are drafted automatically, so setup takes minutes.
- **Scope:**
  - The concept and relation schema and its storage.
  - Migrate existing snippets without losing data, using the `LEGACY_*` pattern in `database.module.ts`.
  - Link metrics, verified queries and dataset relationships to concepts, queryable by dataset and datasource.
  - Extend the `knowledge-bootstrap` agent to propose concepts and relations from schema, sample values, relationships and past thumbs-up answers. Drafts arrive disabled for review.
- **Out of scope:** the curation UI (1.3.4).
- **Acceptance:** a dataset can be bootstrapped into a reviewed ontology, and the graph returns a concept with its metric, mappings and example queries.
- **Notes:** depends on 1.3.1.

#### 1.3.3 — Ontology-grounded retrieval and SQL generation, measured by evals ([BA-80](https://halo-powered.atlassian.net/browse/BA-80))  `📋 Planned`
- **Intent:** each answer is built from the knowledge relevant to the question and checked against it, so terms like "revenue" always mean the same thing.
- **Scope:**
  - Match questions to concepts (synonyms, embeddings, entity overlap), expand one hop to related concepts, and rank within the context budget. This replaces today's newest-first selection.
  - The prompt carries the concept mappings: columns, joins and default filters.
  - `sql-verifier` flags queries that contradict a concept, and the `sql-fixer` loop repairs them.
  - Retrieval is logged per turn.
- **Out of scope:** UI for provenance (1.3.4).
- **Acceptance:** a golden-dataset eval (1.1.1) runs with knowledge on and off, with per-concept attribution, and shows the accuracy difference with no category getting worse.
- **Notes:** depends on 1.3.2 and 1.1.1.

#### 1.3.4 — Curation UI, feedback learning and provenance ([BA-81](https://halo-powered.atlassian.net/browse/BA-81))  `📋 Planned`
- **Intent:** analysts curate the ontology, corrections feed back into it, and users see what shaped each answer.
- **Scope:**
  - Browse, approve and edit concepts and relations, and enable or disable them per dataset.
  - Conflict detection: the same synonym on two concepts, or contradictory filters.
  - A thumbs-down with a correction suggests a concept edit, and approved answers link back to the concepts they used.
  - The answer panel shows which concepts and definitions were used.
- **Out of scope:** —
- **Acceptance:** an analyst can fix a wrong answer by editing a concept, and the next answer cites it.
- **Notes:** a new UI surface, so it needs Gherkin scenarios and E2E specs first. The provenance display ties into 1.4.1.

### Milestone 1.4 — Response Reliability Signals ([BA-12](https://halo-powered.atlassian.net/browse/BA-12))

Show users how much to trust each answer. Assignee: Sergio Berrospi.

#### 1.4.1 — Answer trust signals  `📋 Planned`
- **Intent:** beta users can tell a solid answer from one that needs checking.
- **Scope:** per-answer signals:
  - whether the SQL was verified or auto-corrected
  - a match with a verified query
  - empty or suspicious results
  - the knowledge and data the answer relied on

  This builds on the existing SQL self-correction, verified queries and answer feedback.
- **Out of scope:** —
- **Acceptance:** *to be defined.* The Jira epic has only a description.
- **Notes:** see [docs/plans/phase-1-answer-reliability.md](docs/plans/phase-1-answer-reliability.md) and [docs/plans/phase-2-trust-ux.md](docs/plans/phase-2-trust-ux.md); confirm what has already shipped. The epic has no `1.0 Beta` fix version in Jira although it sits in the beta window.

### Milestone 1.5 — Data Connectors ([BA-5](https://halo-powered.atlassian.net/browse/BA-5))

Connect to the sources beta users actually have. Each connector needs reliable connection setup, schema discovery and read-only querying. All three kinds already exist in code (`DatasourceKind = 'databricks' | 'postgres' | 'rest'`), so this milestone is about hardening them to beta quality.

#### 1.5.1 — Databricks ([BA-6](https://halo-powered.atlassian.net/browse/BA-6))  `📋 Planned`
- **Intent:** beta users can query a Databricks SQL warehouse.
- **Scope:** connect with host, HTTP path and token; discover catalogs, schemas and tables through Unity Catalog; run read-only SQL.
- **Out of scope:** write access.
- **Acceptance:** *drafted from the epic; the Jira story has no description, so confirm there.* Connection setup validates and reports failures clearly, Unity Catalog discovery lists catalogs, schemas, tables and columns, and only read-only statements run.

#### 1.5.2 — Postgres ([BA-7](https://halo-powered.atlassian.net/browse/BA-7))  `📋 Planned`
- **Intent:** beta users can query PostgreSQL.
- **Scope:** connect with host, port, database and credentials (with SSL); discover schemas, tables and columns; run read-only SQL.
- **Out of scope:** write access.
- **Acceptance:** *drafted from the epic; confirm in Jira.* SSL connections work, discovery is complete, and only read-only statements run. The existing *Datasources, datasets, and sessions (World Cup database)* scenarios in [specs/capabilities/datasources/spec.md](specs/capabilities/datasources/spec.md) stay green.

#### 1.5.3 — REST API ([BA-8](https://halo-powered.atlassian.net/browse/BA-8))  `📋 Planned`
- **Intent:** beta users can query HTTP APIs as datasets.
- **Scope:** connect with each API's auth, discover endpoints from OpenAPI specs, and map JSON responses into tabular datasets.
- **Out of scope:** —
- **Acceptance:** *drafted from the epic; confirm in Jira.* An OpenAPI spec yields selectable endpoints, and a JSON response maps to rows the assistant can query.

### Milestone 1.6 — User Testing ([BA-10](https://halo-powered.atlassian.net/browse/BA-10))

Hands-on testing of the beta build with real users and their data. No fix version in Jira yet.

#### 1.6.1 — Beta user testing round  `📋 Planned`
- **Intent:** find what breaks or confuses real users before release.
- **Scope:** real users install the app, connect a source, ask questions and build visuals; issues, confusing flows and wrong answers are captured as Jira bugs or feedback under [BA-11](https://halo-powered.atlassian.net/browse/BA-11).
- **Out of scope:** fixing (1.7).
- **Acceptance:** every finding is filed in Jira and triaged into 1.7 or the backlog.
- **Notes:** needs an installer build (**Actions → Build desktop installers**) of the release-candidate tag.

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

#### 1.7.9 — Fixed default APP_SECRET fallback ([BA-106](https://halo-powered.atlassian.net/browse/BA-106))  `📋 Planned`
- **Intent:** encrypted keys are never protected by a known secret.
- **Scope:** see the Jira bug and the Open question in [product/non-functional.md](specs/product/non-functional.md).
- **Acceptance:** With no `APP_SECRET`, a random secret is generated and persisted, or the backend refuses to start.

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
- **Scope:** see the Jira bug and the Open question in [capabilities/knowledge/spec.md](specs/capabilities/knowledge/spec.md).
- **Acceptance:** Datasource-scoped entries are injected for sessions on that datasource, or the scope is removed.

#### 1.7.18 — Stale application-shell visual baseline ([BA-99](https://halo-powered.atlassian.net/browse/BA-99))  `📋 Planned`
- **Intent:** the visual baseline matches the current shell.
- **Scope:** see the Jira bug and the Open question in [system/ui.md](specs/system/ui.md).
- **Acceptance:** The baseline shows the current sidebar and the visual test passes.

#### 1.7.19 — Sidebar session order goes stale ([BA-100](https://halo-powered.atlassian.net/browse/BA-100))  `📋 Planned`
- **Intent:** the most recently used session is on top.
- **Scope:** see the Jira bug and the Open question in [capabilities/sessions-chat/spec.md](specs/capabilities/sessions-chat/spec.md).
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

## Backlog

Not yet sequenced into a release. The detailed phase plans below predate this roadmap; when work on one resumes, split it into features under a milestone here and link back to the plan.

- Answer reliability — [docs/plans/phase-1-answer-reliability.md](docs/plans/phase-1-answer-reliability.md)
- Trust UX — [docs/plans/phase-2-trust-ux.md](docs/plans/phase-2-trust-ux.md)
- Visual quality + interactivity — [docs/plans/phase-3-visual-quality-interactivity.md](docs/plans/phase-3-visual-quality-interactivity.md)
- Strategic bets — [docs/plans/phase-4-strategic-bets.md](docs/plans/phase-4-strategic-bets.md)
- Agent Routines ([BA-82](https://halo-powered.atlassian.net/browse/BA-82)): an epic in Jira with no description, dates or fix version. Promote it into a release once it's defined.

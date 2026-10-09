# Changelog

Running log of every meaningful change, newest first. See *Logging convention* and *Evidence convention* in [CLAUDE.md](CLAUDE.md). Release versions come from Conventional Commits (`version-on-merge.yml`); this file records what shipped and links to the evidence.

## 2026-10-09

### Added
- **Agent Hub planned** (roadmap 1.9.1, [BA-151](https://halo-powered.atlassian.net/browse/BA-151), epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)):
  - New epic spec [specs/epics/BA-150/spec.md](specs/epics/BA-150/spec.md), confirmed by the user. Users build agents on top of the assistant (instructions, datasets, starter questions, model override), test them as drafts, publish them, pin them and start chats from them. The Agents screen becomes a hub with the filters All, Pinned, Official and Mine, plus a System section for the helper agents.
  - ADR-0008 in [specs/system/architecture.md](specs/system/architecture.md): a user agent is a stored configuration (a draft and a Live version) applied to the assistant on each turn, not an agent registered at runtime. So the read-only guard and the grounding checks always hold.
  - Milestone 1.9 in [roadmap.md](roadmap.md), with one feature per story (1.9.1–1.9.5), and the epic row in [specs/README.md](specs/README.md).
  - Decisions: teams, the org and sharing are out (the app stays local-first); the epic is inside the 1.0 Beta; the hub UI is built with today's styles and restyled later by BA-141.
  - Evidence: [evidence/1.9.1/](evidence/1.9.1/).

### Changed
- **One branch, one worktree and one PR per epic** (roadmap 0.2.5, [BA-149](https://halo-powered.atlassian.net/browse/BA-149), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)):
  - CLAUDE.md *Branching convention*: all of an epic's stories are built on one branch, `<type>/<EPIC-ID>-<short-description>`, in one worktree, and ship as one PR that lists every story. Commits stay scoped to their story. The branch type is the highest-impact commit type in the epic.
  - Bugs: a Bug whose epic has an open branch is fixed there. A Bug against shipped work keeps its own `fix/<BUG-ID>` branch and PR.
  - Workflow step 3 and the Epic gate now point at the epic branch. [specs/system/delivery.md](specs/system/delivery.md) explains the version bump for a mixed-type epic PR. Story added to [specs/epics/BA-89/spec.md](specs/epics/BA-89/spec.md).
  - Evidence: [evidence/0.2.5/](evidence/0.2.5/).

## 2026-10-05

### Added
- **Developer guide for local observability** (roadmap 0.3.7, [BA-118](https://halo-powered.atlassian.net/browse/BA-118), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - [docs/observability.md](docs/observability.md) covers starting Phoenix and Grafana, turning on **Settings → Developer → Developer observability** and restarting, and where to find each signal: Phoenix projects, Tempo search and TraceQL, Loki with its "Trace: <id>" link, and Prometheus. It also covers turning it off and troubleshooting (ingest lag, unreachable endpoints, worktree isolation).
  - Linked from README *Development*.
  - Verified by following it with the npm CLI against the real tools.
  - Evidence: [evidence/0.3.7/](evidence/0.3.7/).
- **Developer observability now exports backend logs, linked to their traces** (roadmap 0.3.6, [BA-117](https://halo-powered.atlassian.net/browse/BA-117), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - When the active developer setting is on, the OpenTelemetry SDK also exports logs to `<OTLP endpoint>/v1/logs`.
  - Nest logs: [`developer-nest-logger.ts`](backend/src/infrastructure/telemetry/developer-nest-logger.ts) wraps `ConsoleLogger.prototype.printMessages`. Each line prints exactly as before and is also emitted as a log record.
  - Mastra's Pino logs: sent through `@opentelemetry/instrumentation-pino`, with stdout field injection disabled.
  - A line logged during a request or agent run carries that trace's id. Verified in real Grafana: a Loki line resolves to its Tempo trace.
  - Console output is byte-identical whether the setting is on or off, so the desktop system-logs panel is unaffected.
  - **Scope change:** `nestjs-pino` was dropped from the plan, because it would have turned the console output into JSON even with the setting off.
  - Specs: R24–R26 and a logs scenario in [specs/capabilities/developer-settings/spec.md](specs/capabilities/developer-settings/spec.md), plus tech-stack.md and the container diagram.
  - Evidence: [evidence/0.3.6/](evidence/0.3.6/).
- **Developer observability now sends agent traces to Arize Phoenix** (roadmap 0.3.5, [BA-116](https://halo-powered.atlassian.net/browse/BA-116), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - When the active developer setting is on, [`backend/src/mastra/developer-exporters.ts`](backend/src/mastra/developer-exporters.ts) adds `@mastra/arize`'s `ArizeExporter` next to `MastraStorageExporter`. It sends OpenInference spans in OTLP protobuf to `<Phoenix endpoint>/v1/traces`, under the project `questions-to-insights`.
  - `observability.duckdb` keeps receiving every trace. When the setting is off, the exporter is never `require`d, so no OpenTelemetry module loads.
  - Specs: R21–R23 and a Phoenix scenario in [specs/capabilities/developer-settings/spec.md](specs/capabilities/developer-settings/spec.md), agents.md §1.7, tech-stack.md (`@mastra/arize` 1.3.16, pinned to match `@mastra/observability` 1.17.8), and the container diagram.
  - Verified against real Phoenix: the `questions-to-insights` project shows the assistant's `invoke_agent` → model and memory spans.
  - Evidence: [evidence/0.3.5/](evidence/0.3.5/).
- **Developer observability now exports backend traces and metrics to an OTLP endpoint** (roadmap 0.3.4, [BA-115](https://halo-powered.atlassian.net/browse/BA-115), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - When the active developer setting is on, `main.ts` and `cli.ts` start the OpenTelemetry Node SDK **before** they import the app. It instruments HTTP, Express, NestJS, `pg` and undici, with fs, dns and net disabled. Traces go to `<OTLP endpoint>/v1/traces` and metrics every 10 s to `/v1/metrics`, both in OTLP protobuf, as `questions-to-insights`.
  - When the setting is off, nothing from OpenTelemetry is imported and nothing is sent. A failure to start logs one warning, and the backend runs without telemetry.
  - Code: [`backend/src/infrastructure/telemetry/developer-telemetry.ts`](backend/src/infrastructure/telemetry/developer-telemetry.ts). New pinned dependencies: `@opentelemetry/*` 0.222.0 / 2.11.0, `auto-instrumentations-node` 0.80.0.
  - Specs: R17–R20 and the Feature "Developer observability export" (`frontend/e2e/developer-observability.spec.ts`) in [specs/capabilities/developer-settings/spec.md](specs/capabilities/developer-settings/spec.md). The packages are listed in tech-stack.md, and the container diagram shows the developer-only OTLP edge.
  - Verified against real Grafana: Tempo shows http → NestJS → `pg.query` spans.
  - Evidence: [evidence/0.3.4/](evidence/0.3.4/).
- **Settings → Developer: a developer observability switch with restart to apply** (roadmap 0.3.2, [BA-113](https://halo-powered.atlassian.net/browse/BA-113), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - **Settings:** a fourth row, "Developer", holds the "Developer observability" switch (off by default) and editable Phoenix (`http://localhost:6006`) and OTLP (`http://localhost:4318`) endpoints. The form and the backend both reject a value that isn't an http(s) URL.
  - **Test:** probes the typed endpoint from the backend with an empty OTLP protobuf export to `/v1/traces`. It reports "Reachable", a wrong status, or "Unreachable".
  - **Storage:** the setting is saved to `<APP_DATA_DIR>/developer-settings.json` (atomic write), not the document store, so entry points can read it before bootstrap (ADR-0006).
  - **Applying it:** the backend keeps the copy it read at startup as the active setting. A "Restart to apply" notice appears while the saved setting differs from it. In the desktop app, **Restart backend** respawns the backend through a new `backend:restart` IPC channel, outside the crash-restart budget. The browser (npm CLI) shows "Restart the CLI to apply" instead.
  - **Scope:** nothing is exported yet. The exporters arrive in 0.3.4–0.3.6.
  - **API:** new `GET`/`PUT /developer-settings` and `POST /developer-settings/test-endpoint`.
  - **Specs:** the new [developer-settings](specs/capabilities/developer-settings/spec.md) capability (Gherkin + `frontend/e2e/developer-settings.spec.ts`), plus api.md, data-model.md, ui.md §4.12, app-shell R5, the glossary and tech-stack.md.
  - Evidence: [evidence/0.3.2/](evidence/0.3.2/).
- **Opt-in `observability` Docker Compose profile** (roadmap 0.3.3, [BA-114](https://halo-powered.atlassian.net/browse/BA-114), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - `docker-compose.yml` gains `phoenix` (`arizephoenix/phoenix:version-20.19.0`, port 6006) and `otel-lgtm` (`grafana/otel-lgtm:0.35.0`; Grafana on 3001, OTLP gRPC 4317, OTLP HTTP 4318), each behind `profiles: [observability]`. Host ports are overridable. A plain `docker compose up` and the E2E global setup still start only Postgres.
  - Verified against the real images: Phoenix UI 200, Grafana health ok, OTLP HTTP `/v1/traces` 200 on both. Phoenix accepts OTLP protobuf only (JSON gets 415), which 0.3.5 must account for.
  - Documented in [specs/system/delivery.md](specs/system/delivery.md) (section 6 and the isolation table in section 7) and in the CLAUDE.md *Worktree deploy convention*.
  - Evidence: [evidence/0.3.3/](evidence/0.3.3/).
- **Local development observability is planned** (roadmap 0.3.1, [BA-112](https://halo-powered.atlassian.net/browse/BA-112), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - New Jira epic BA-111 with stories BA-112 to BA-118, mirrored as roadmap Milestone 0.3 (features 0.3.1–0.3.7).
  - **ADR-0006** in [specs/system/architecture.md](specs/system/architecture.md):
    - Arize Phoenix and Grafana `otel-lgtm` are used only when a Developer setting is on. It is off by default.
    - The setting is stored as a file under `APP_DATA_DIR`, so the entry points can read it before the app loads.
    - Exporters are added next to the DuckDB store, not instead of it.
    - Changes apply on restart.
  - The epic spec [specs/epics/BA-111/spec.md](specs/epics/BA-111/spec.md) is confirmed by the user and listed in [specs/README.md](specs/README.md).
  - No product code changed.
  - Evidence: [evidence/0.3.1/](evidence/0.3.1/).
- **PRs into `main` need an approving review; only the repo owner can merge without one** (roadmap 0.2.4, [BA-110](https://halo-powered.atlassian.net/browse/BA-110), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)):
  - A second ruleset, "main: PR approval, admin may merge without", requires a PR with 1 approving review and dismisses stale approvals. The *Repository admin* role bypasses it in *pull requests only* mode, so the owner can merge without approval but can't push directly to `main`. The spec-check ruleset is unchanged and still applies to everyone.
  - [`version-on-merge.yml`](.github/workflows/version-on-merge.yml) now pushes its release commit and tag over SSH with a repo-scoped write deploy key (`RELEASE_DEPLOY_KEY` secret). Deploy keys are on the new ruleset's bypass list, because GitHub Actions can't be in a personal-account repo.
  - Documented under *Branch rulesets on `main`* and *Release push* in [specs/system/delivery.md](specs/system/delivery.md), in the BA-89 epic spec, and as a **Review** bullet in the CLAUDE.md *Branching convention*.
  - Evidence: [evidence/0.2.4/](evidence/0.2.4/).

### Fixed
- **LLM API key no longer lost or broken when the app secret changes** (roadmap 1.7.9, [BA-106](https://halo-powered.atlassian.net/browse/BA-106), epic [BA-11](https://halo-powered.atlassian.net/browse/BA-11)):
  - Found from a desktop diagnostics report: the first launch of a data dir after Electron started persisting `.app-secret` (commit `a3ef363`) could not read a key saved under the backend's fixed development secret. `GET /llm/settings` failed with `Unsupported state or unable to authenticate data` (a 500), and so did every agent turn.
  - [`crypto.service.ts`](backend/src/infrastructure/crypto/crypto.service.ts): a backend started without `APP_SECRET` now reads or creates `<APP_DATA_DIR>/.app-secret` (mode 0600), like Electron main and the CLI. The fixed development secret is never used to encrypt again. `decrypt` throws `UnreadableSecretError`, and `reencryptFormerSecret` re-encrypts a value only the former development secret opens.
  - [`llm.service.ts`](backend/src/modules/llm/llm.service.ts): at startup a key under the former development secret is re-encrypted with the current one (migration M11). A key no known secret opens is reported as `configured: false`, `keyUnreadable: true` with provider, model and base URL kept. Agent calls, and tests or saves without a typed key, fail with a "re-enter the key" message instead of the crypto error.
  - LLM Configuration screen: an amber notice asks for the key again and the other fields stay filled. It clears after a successful save.
  - `.app-secret` added to `.gitignore`, because a bare backend run now writes one into `backend/data/`.
  - Specs: R11 rewritten and R33–R35 plus two scenarios in [specs/capabilities/llm-settings/spec.md](specs/capabilities/llm-settings/spec.md) (its Feature now has an E2E file); api.md (`keyUnreadable`, no more 500), data-model.md (2.3, app-secret owner, M11), non-functional.md (N15, N16a; open question resolved), delivery.md and ui.md.
  - Tests: new `frontend/e2e/llm-settings.spec.ts` (4 scenarios against a local LenAI stub), `crypto.service.spec.ts`, and new cases in `llm.service.spec.ts`. The E2E fixture gained `launchElectronApp` / `readyWindow` so a spec can relaunch the app on the same data dir.
  - Evidence: [evidence/1.7.9/](evidence/1.7.9/).
- **Merging no longer starts an installer build** (roadmap 0.2.4, [BA-110](https://halo-powered.atlassian.net/browse/BA-110)). The first release after the rollout (v0.20.7) pushed its tag with the deploy key, and `build-desktop.yml` runs on any pushed `v*` tag, so an installer build started on its own. It was cancelled before publishing a release. [`version-on-merge.yml`](.github/workflows/version-on-merge.yml) now pushes the tag with `GITHUB_TOKEN`, whose pushes start no workflows. Only the branch pushes use the deploy key. The *Chaining* row in [specs/system/delivery.md](specs/system/delivery.md) is corrected. Evidence: [evidence/0.2.4/release-run.txt](evidence/0.2.4/release-run.txt).

## 2026-10-04

### Changed
- Roadmap 0.1.1 (the renderer ignoring a non-default `BACKEND_PORT`) is now **1.7.20** under Bug Fixes. It is tracked as Jira bug [BA-109](https://halo-powered.atlassian.net/browse/BA-109) under epic BA-11, because Milestone 0.1 has no epic and the Epic gate would block it. 0.1.1 is marked `🚫 Cut` with a pointer to the new entry. References in CLAUDE.md, the BA-11 epic spec and the specs (`non-functional.md`, `delivery.md`, `api.md`) are updated. Evidence: docs only; `python3 scripts/check-specs.py` passes and the spec check is green on the PR.

### Added
- **The spec check is now required on `main`** (roadmap 0.2.3, [BA-108](https://halo-powered.atlassian.net/browse/BA-108)):
  - A repository ruleset requires "Specs match the code" before a PR can merge. Direct pushes without that status are rejected.
  - [`version-on-merge.yml`](.github/workflows/version-on-merge.yml) still pushes its release commit straight to `main`. Before pushing, it runs `scripts/check-specs.py` on the bump commit, stages the commit on `release-staging/<sha>` and reports the status itself.
  - Documented under *Branch ruleset on `main`* in [specs/system/delivery.md](specs/system/delivery.md).
  - Evidence: [evidence/0.2.3/](evidence/0.2.3/).
- **Rebuildable system specs** (roadmap 0.2.2, [BA-90](https://halo-powered.atlassian.net/browse/BA-90), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)). New [specs/](specs/README.md) tree, written so an LLM given only that folder can rebuild the app:
  - product specs: vision, glossary, non-functional requirements;
  - system specs: architecture, tech stack, data model, API (all 52 routes, the chat stream, IPC, CLI), agents (every prompt, tool and model rule), UI and delivery;
  - 13 capability specs, each with rules, edge cases, contracts and Gherkin;
  - epic specs for all BA epics. The existing ones are `Status: Draft` until their owners confirm them.

  [specs/README.md](specs/README.md) defines the formats, the stack-neutrality rule, the lifecycle, the files a rebuild copies verbatim, and the rebuild prompt. Evidence: [evidence/0.2.2/](evidence/0.2.2/).
- CLAUDE.md **Epic gate**: no code change without a Jira epic. Every epic gets a spec at `specs/epics/<EPIC-ID>/spec.md`, confirmed before its stories start.
- CLAUDE.md **Spec convention**: specs change on the same branch as the code, so `main` always describes the shipped app.
- **Spec checks in CI:** [`.github/workflows/spec-checks.yml`](.github/workflows/spec-checks.yml) runs [`scripts/check-specs.py`](scripts/check-specs.py) on every PR and every push to `main`. It fails when a backend route, collection, agent, Playwright spec, capability or roadmap epic has no spec, or a link breaks. It is the repo's first pull-request check. A drift test with 7 faults injected failed all 7 matching checks: [evidence/0.2.2/check-specs-negative-test.txt](evidence/0.2.2/check-specs-negative-test.txt).
- Roadmap Milestone 0.2 now mirrors the new Jira epic BA-89 (Delivery Process). BA-84 is linked to it in Jira.
- The user waived confirmation, as a one-time exception, for the eight draft epic specs (BA-2, BA-4, BA-5, BA-9, BA-10, BA-11, BA-12, BA-82). Their stories, including the new bugs, can start. The exception is recorded under *Epic gate* in [CLAUDE.md](CLAUDE.md) and in each spec's status line.
- Filed the backfill's 10 likely bugs and 7 security gaps as Jira bugs BA-91 to BA-107 under BA-11. They are mirrored in roadmap Milestone 1.7 as features 1.7.3 to 1.7.19, security first. Details: [evidence/0.2.2/findings.md](evidence/0.2.2/findings.md).

### Changed
- `architecture.md` moved to [specs/system/architecture.md](specs/system/architecture.md).
- The five Gherkin Features moved verbatim from `gherkin.md` into their capability specs. The *Gherkin convention* became part of the *Spec convention*, and the E2E convention now mirrors the capability specs.
- CLAUDE.md went from 329 to about 170 lines. Its how-it-works sections (Electron delivery, versioning, npm package, folder layout, datastore, Mastra, visuals) moved into `specs/system/` and were checked against the code. A short *Code rules* list replaces them. Workflow steps 3, 4, 5, 9 and 10 and the worktree deploy convention were updated. Drift fixed:
  - Docker is started by the E2E global setup.
  - Only the Electron main process reads `BACKEND_PORT`.
  - Desktop isolation uses `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR`.
- README.md now links to `specs/` instead of CLAUDE.md for packaging and architecture details.
- Roadmap 0.2.1 (BA-84) marked `✅ Done`; it merged in PR #43.

### Removed
- `gherkin.md`. Every scenario now lives in exactly one capability spec.

## 2026-10-01

### Added
- Adopted the eleven-step delivery workflow in [CLAUDE.md](CLAUDE.md) (retrospective-first, roadmap → ADR → Gherkin → E2E impact analysis → tests-first → implement → green → changelog + evidence → retrospective) and seeded [roadmap.md](roadmap.md), [architecture.md](architecture.md), [gherkin.md](gherkin.md), [retrospective.md](retrospective.md), [evidence/](evidence/).
- Filled in the harness resources that were still missing: C4 Mermaid diagrams for all four levels in [architecture.md](architecture.md) (system context, containers, backend + frontend components, visual tailoring loop); Given/When/Then steps for all 20 scenarios in [gherkin.md](gherkin.md).
- Corrected [CLAUDE.md](CLAUDE.md) where it had drifted from the code:
  - The frontend is not routed yet. Features have no `pages/`, routes or store, and some `core/` folders are empty placeholders.
  - Lists every registered Mastra agent, plus the DuckDB observability store and the `infrastructure/crypto` key encryption.
  - Visuals: spec-first designer with a freeform fallback, the full version-folder file list inside the session workspace, and the tailor/refresh/repair endpoints.
  - The chat stream is `POST …/messages/stream` read with `fetch`.
  - Flags the hardcoded renderer port as a known gap.
- Added the **Branching convention** to [CLAUDE.md](CLAUDE.md): every PR is built in its own `<type>/<US-ID>-<short-description>` feature branch and git worktree, tied to an existing Jira user story.
- Roadmap: imported the **1.0 Beta** plan from Jira BA (target 2026-10-31) as Release 1. There are 7 milestones (one per epic: Evals, Data Model DSL, Knowledge Store, Reliability Signals, Data Connectors, User Testing, Bug Fixes) and 13 features, linked to the BA issues. Agent Routines (BA-82) is in the Backlog.
- Roadmap: added Release 0 / Milestone 0.1 with 0.1.1, the renderer ignoring `BACKEND_PORT` (`📋 Planned`).
- Evidence: process/docs-only change, no code or UI change. Diagrams rendered cleanly with `@mermaid-js/mermaid-cli` v12.

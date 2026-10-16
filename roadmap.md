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

#### 0.2.5 — One branch and one PR per epic ([BA-149](https://halo-powered.atlassian.net/browse/BA-149))  `✅ Done`
- **Intent:** all the stories of an epic are built on one branch in one worktree and reviewed and merged as one PR, instead of one branch and PR per story.
- **Scope:**
  - CLAUDE.md *Branching convention* rewritten: branch `<type>/<EPIC-ID>-<short-description>`, with the type being the highest-impact commit type in the epic; one worktree per epic, reused by every story; commits scoped to their story; the PR title names the epic and the description lists every story; one PR when the epic's stories are done.
  - Bugs: a Bug whose epic has an open branch is fixed there. A Bug against shipped work keeps its own `fix/<BUG-ID>` branch and PR.
  - Workflow step 3 and the Epic gate point at the epic branch. `specs/system/delivery.md` explains how one PR with mixed commit types is bumped.
- **Out of scope:** changing `version-on-merge.yml` or the rulesets on `main`; renaming branches already open under the old rule.
- **Acceptance:**
  - CLAUDE.md states the one-branch-per-epic rule and no longer requires one branch per issue.
  - `python3 scripts/check-specs.py` passes.
  - This change is merged through a PR from the BA-89 epic branch `docs/BA-89-delivery-process`.
- **Notes:** the first branch made under the new rule. Evidence: [evidence/0.2.5/](evidence/0.2.5/).

#### 0.2.6 — E2E and testing run against the web app; desktop only on request ([BA-156](https://halo-powered.atlassian.net/browse/BA-156))  `✅ Done`
- **Intent:** while an epic is developed, its changes are tested in the web app built from the epic branch, which is faster and needs no free port 3000. The Electron desktop app is tested only when the user asks.
- **Scope:**
  - CLAUDE.md *Test target convention*. Workflow step 9, the Evidence and E2E conventions point at the web target.
  - Playwright `web` project (default) and `desktop` project, sharing one fixture (`e2e/fixtures/app.fixture.ts`). The web project starts the npm CLI per test on a free port and a temp data dir, drives it in Chromium at 1440×900, and can restart the CLI on the same data dir.
  - Scripts: `test:e2e` (web), `test:e2e:desktop`, and their `:ui` and `:update` variants. Global setup checks port 3000 only for desktop runs.
  - Desktop-only scenarios are skipped on web with the reason `Desktop only`. In the Gherkin, the restart scenarios gain a browser variant ("Restart the CLI to apply").
  - A web visual baseline for the application shell.
  - Specs: delivery.md, tech-stack.md, ui.md, the developer-settings, diagnostics and app-shell capability specs.
- **Out of scope:** CI running E2E; changing app behaviour; removing the desktop suite.
- **Acceptance:**
  - `npm run test:e2e` runs every spec against the web app and passes, with desktop-only tests reported as skipped.
  - `npm run test:e2e:desktop` still selects the Electron project.
  - CLAUDE.md states the rule. `python3 scripts/check-specs.py` passes.
- **Notes:** made on the BA-89 epic branch `test/BA-89-delivery-process`. Evidence: [evidence/0.2.6/](evidence/0.2.6/).

#### 0.2.7 — Local test deploys check the default ports and keep deploy tweaks out of commits ([BA-157](https://halo-powered.atlassian.net/browse/BA-157))  `✅ Done`
- **Intent:** when Claude starts the app for the user to try, it never collides with something already running, never kills the wrong process, and never commits a change made only to run locally.
- **Scope:** a rule at the end of CLAUDE.md *Worktree deploy convention*:
  - Before starting the app, check the default ports (backend 3000, Postgres 55432, observability 6006, 3001, 4317 and 4318) with `ss -ltnp` and `docker ps`.
  - The shared World Cup Postgres on 55432 is reused, not a conflict.
  - Any other busy port is worked around with flags or environment variables only.
  - A tracked-file change needed only to run locally stays out of every commit and is reverted after testing.
  - Report the URL, port, data dir and PID, and stop the process by that PID, never with `pkill -f`.
- **Out of scope:** changing default ports; scripting the check.
- **Acceptance:** CLAUDE.md states the rule; `python3 scripts/check-specs.py` passes.
- **Notes:** requested by the user on 2026-10-09 during the Agent Hub epic (BA-150), after a subagent's `pkill -f "dist/main.js"` matched more than intended. Branch `docs/BA-89-delivery-process`. Evidence: [evidence/0.2.7/](evidence/0.2.7/).

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

#### 0.3.3 — Docker Compose observability profile ([BA-114](https://halo-powered.atlassian.net/browse/BA-114))  `✅ Done`
- **Intent:** the local tools start with one command and never start by accident.
- **Scope:** an `observability` profile in `docker-compose.yml` running `arizephoenix/phoenix` (UI and OTLP on 6006) and `grafana/otel-lgtm` (OTLP 4317/4318, Grafana on a host port other than 3000).
- **Out of scope:** persistent volumes for the tools; any change to the Postgres service.
- **Acceptance:** `docker compose --profile observability up -d --wait` starts both tools; plain `docker compose up` and the E2E global setup start only Postgres.
- **Notes:** independent of 0.3.2; can ship in parallel. Branch `build/BA-114-observability-compose-profile`. Pinned `arizephoenix/phoenix:version-20.19.0` and `grafana/otel-lgtm:0.35.0`; Phoenix's OTLP HTTP endpoint accepts protobuf only (relevant to 0.3.5). Evidence: [evidence/0.3.3/](evidence/0.3.3/).

#### 0.3.4 — OpenTelemetry bootstrap gated by the developer setting ([BA-115](https://halo-powered.atlassian.net/browse/BA-115))  `✅ Done`
- **Intent:** with the toggle on, every request's HTTP, NestJS, Postgres and outbound connector work is visible as one trace in Grafana.
- **Scope:** `main.ts` and `cli.ts` read the developer setting and, only when it is on, start the OpenTelemetry Node SDK with auto-instrumentation before dynamically importing the app; traces and metrics exported over OTLP to the configured endpoint.
- **Out of scope:** manual spans inside services; renderer tracing.
- **Acceptance:** toggle on → a chat question's HTTP and `pg` spans appear in Tempo; toggle off → no OpenTelemetry module is loaded and no OTLP request is made; an unreachable endpoint never fails a request or startup.
- **Notes:** depends on 0.3.2; uses 0.3.3 for verification. Rules R17–R20 and the Feature "Developer observability export" in [specs/capabilities/developer-settings/spec.md](specs/capabilities/developer-settings/spec.md). Branch `feat/BA-115-otel-bootstrap`. Evidence: [evidence/0.3.4/](evidence/0.3.4/).

#### 0.3.5 — Agent trace export to Arize Phoenix gated by the developer setting ([BA-116](https://halo-powered.atlassian.net/browse/BA-116))  `✅ Done`
- **Intent:** with the toggle on, a developer can inspect each agent run (prompts, LLM calls, tool calls, tokens, latency) in Phoenix.
- **Scope:** add the Phoenix exporter to the Mastra `Observability` config next to `MastraStorageExporter` when the setting is on.
- **Out of scope:** removing or replacing the DuckDB store.
- **Acceptance:** toggle on → a chat question's agent run appears in Phoenix and in `observability.duckdb`; toggle off → only `observability.duckdb`, exactly as before.
- **Notes:** depends on 0.3.2. Rules R21–R23 in [specs/capabilities/developer-settings/spec.md](specs/capabilities/developer-settings/spec.md). `@mastra/arize` is pinned at 1.3.16 to match `@mastra/observability` 1.17.8. Branch `feat/BA-116-phoenix-exporter`. Evidence: [evidence/0.3.5/](evidence/0.3.5/).

#### 0.3.6 — Unified pino logging with trace ids ([BA-117](https://halo-powered.atlassian.net/browse/BA-117))  `✅ Done`
- **Intent:** backend and agent logs are one stream that can be followed from a trace.
- **Scope:** OTLP log export to Loki only when the setting is on. Nest logs go through a console-identical logger that also emits OpenTelemetry log records; Mastra's `PinoLogger` goes through `@opentelemetry/instrumentation-pino`. Records written during a trace carry its trace and span ids.
- **Scope change (2026-10-05):** `nestjs-pino` was dropped. It would turn Nest's console output into JSON even with the setting off, which breaks the desktop system-logs panel's parsing and the epic's "off changes nothing" rule (R26).
- **Out of scope:** changing what is logged.
- **Acceptance:** toggle on → backend logs in Loki link to their Tempo trace; toggle off → console logging only, with no OTLP export.
- **Notes:** depends on 0.3.4. Rules R24–R26 in [specs/capabilities/developer-settings/spec.md](specs/capabilities/developer-settings/spec.md). Branch `feat/BA-117-otel-logs`. Evidence: [evidence/0.3.6/](evidence/0.3.6/).

#### 0.3.7 — Developer docs for the local observability stack ([BA-118](https://halo-powered.atlassian.net/browse/BA-118))  `✅ Done`
- **Intent:** any developer can go from a clean checkout to a trace in Phoenix and Grafana without asking anyone.
- **Scope:** docs for starting the compose profile, turning on the toggle, and finding a chat question in Phoenix and Grafana; worktree isolation notes (compose project name, ports).
- **Out of scope:** end-user documentation.
- **Acceptance:** a developer following only the docs sees one chat question in Phoenix and Grafana.
- **Notes:** last; depends on 0.3.2–0.3.6. Guide: [docs/observability.md](docs/observability.md), linked from README *Development*. Branch `docs/BA-118-observability-docs` (it includes the BA-114 compose branch merged in, so it holds the whole stack). Evidence: [evidence/0.3.7/](evidence/0.3.7/).

### Milestone 0.4 — Harness Adjustments ([BA-119](https://halo-powered.atlassian.net/browse/BA-119))

Adjustments to the delivery workflow harness: the CLAUDE.md conventions, the workflow gates, and the project skills and checks that govern how a change is planned, built and shipped. No app behaviour changes. Epic spec: [specs/epics/BA-119/spec.md](specs/epics/BA-119/spec.md).

#### 0.4.1 — Split CLAUDE.md into workflow-stage skills ([BA-236](https://halo-powered.atlassian.net/browse/BA-236))  `🚧 In progress`
- **Intent:** a Claude Code session loads a workflow stage's conventions when that stage starts, as the RFP Builder loads its stage skills, rather than carrying all of CLAUDE.md on every turn.
- **Scope:**
  - CLAUDE.md keeps only the always-on core:
    - what the repo is
    - the mandatory first action
    - the `## Workflow` list, with each step naming its skill
    - the fast loop and the acceptance gate
    - the hard gates
    - model usage
  - The conventions move, unchanged in substance, to the project skills `workflow-understand`, `workflow-plan`, `workflow-architecture`, `workflow-specs`, `workflow-e2e`, `workflow-implement`, `verify` (extended with step 9), `workflow-ship` and `workflow-retrospective`.
  - `check-specs.py` checks the skills' links.
  - Specs that cite a CLAUDE.md convention point at its skill.
- **Out of scope:** app code; changing what a rule says; the `workflow-steps` mod.
- **Acceptance:**
  - A section map shows every CLAUDE.md rule in exactly one place.
  - The mod still parses eleven steps and the first action, and its tests pass.
  - A new session lists the nine skills.
  - `check-specs.py` passes.
  - Nothing under `backend/` or `frontend/` changes.
- **Notes:** branch `docs/BA-119-harness-adjustments`. The user chose one skill per workflow stage, invocable as `/<name>`, on 2026-10-16. One rule change at the user's request, the same day: *Model usage* now says plans are made by Opus 5.5 at high effort (was Fable).

#### 0.4.2 — Jira MCP tool in `.claude/tools` for epics and stories ([BA-237](https://halo-powered.atlassian.net/browse/BA-237))  `🚧 In progress`
- **Intent:** Claude creates and checks epics and stories through typed tools that work from any checkout, instead of a shell script that needs `jq`, careful quoting and a `raw` call to set a parent.
- **Scope:**
  - `.claude/tools/` as the home of developer tools, each an MCP server or a script, with a README.
  - A `jira` MCP server with no dependencies, registered in `.mcp.json` and enabled in `.claude/settings.json`. Its read tools are allowed without asking; its write tools ask every time.
  - Its tools: `create_epic`, plus `create_issue` (a Story or Bug must name an Epic, checked before creating). It also covers everything `jira.sh` did: `whoami`, `get_project`, `search_issues`, `get_issue` (with the parent's type, for the Epic gate), `list_statuses`, `list_transitions`, `update_issue`, `add_comment`, `transition_issue`.
  - Credentials from the environment or `.env`, falling back to the main checkout's `.env` from a worktree; `setup.mjs` writes them from the developer's terminal.
  - `jira.sh` is removed. The `jira` skill is rewritten as the guide to the tools, and `workflow-plan` points at `get_issue`.
- **Out of scope:** the Epic gate as a tool that also checks the epic spec; listing or tracking an epic's stories beyond JQL; scaffolding specs or roadmap entries. The user chose creation only, on 2026-10-16.
- **Acceptance:**
  - Unit tests pass, with Jira faked.
  - A stdio smoke run from a worktree reads the main checkout's `.env` and returns a real issue with its parent's type.
  - In a new session, `/mcp` lists `jira` with its eleven tools.
  - `check-specs.py` passes.
- **Notes:** same branch `docs/BA-119-harness-adjustments`. The user chose an MCP server over scripts and over the claude.ai Atlassian connector, and chose to replace `jira.sh`, on 2026-10-16. `update_issue` replaces the `raw` calls earlier stories needed to set a parent or edit a description.

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

### Milestone 1.1 — Golden Dataset and Evals ([BA-9](https://halo-powered.atlassian.net/browse/BA-9))

The measurement baseline. Every change to the DSL, knowledge store or connectors is measured against it before the beta ships.

#### 1.1.1 — Golden dataset and eval suite  `📋 Planned`
- **Intent:** know, with numbers, whether a change made answers better or worse.
- **Scope:** a golden dataset of representative questions with known-correct answers on the sample fixtures. An eval suite (LLM judge plus SQL and result checks) that runs against it, building on the existing `assistant-eval-judge` agent and `mastra/evals/` and the Agents → Evals tab.
- **Out of scope:** evals on customer data.
- **Acceptance:** the suite runs on demand against the golden dataset and reports per-question and per-category results. Results can be compared run to run, and a knowledge on/off comparison is possible (needed by 1.3.3).
- **Notes:** Jira has no stories under this epic yet, so this feature mirrors the epic. Split it into stories in Jira first, then mirror them here.

#### 1.1.2 — Intellify sample as a Testing Data fixture ([BA-212](https://halo-powered.atlassian.net/browse/BA-212))  `✅ Done`
- **Intent:** recreate the Intellify sample database (the Halo × Marsh ERD and data dictionary: 49 entities, 243 attributes) in one click, so the assistant can be tried and later evaluated on an employee-benefits model as well as on sports data.
- **Scope:** a fourth sample fixture `intellify` in the Testing Data catalogue: a bundled gzipped seed `003_intellify.sql.gz` that creates schema `intellify` (49 tables, 52 foreign keys, column comments carrying the source Mongo field and its dictionary description) with deterministic synthetic data, registered as datasource "Intellify PostgreSQL" and dataset "Intellify" in database `intellify` on the sample server. The generator that writes the seed, `scripts/generate-intellify-seed.py`, is committed so the seed can be regenerated byte for byte.
- **Out of scope:** an Intellify eval question set (a later BA-9 story); reading Postgres column comments into dataset descriptions (a connector change); any real Intellify data.
- **Acceptance:** Settings → Testing Data lists "Intellify" with `0/49 entities`; loading it against the sample server creates the `intellify` database when missing, seeds it and reports `49/49 entities`, and the "Intellify" dataset has sample values and the 52 declared join references. Running the generator again reproduces the committed seed exactly.
- **Notes:** evidence: [evidence/1.1.2/](evidence/1.1.2/). The model is converted, not invented: Mongo field paths become snake_case columns (`client_clientId` → `client_client_id`, `_id` → `id`), ObjectIds are `char(24)`, embedded objects are `jsonb`, and relationships the source draws without a field stay unjoinable. All rows are synthetic.

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

### Milestone 1.8 — Agentic Hub Look and Feel ([BA-141](https://halo-powered.atlassian.net/browse/BA-141))

The app gets the Agentic Hub visual design: a gradient frame, an "Agentic Hub" banner, white rounded cards, an icon rail, pill buttons and status chips. There is a light theme and a navy dark theme derived from it, and the app follows the OS by default. Only the look changes. All stories are built on the branch `feat/BA-141-agentic-hub-look-and-feel` and ship as one PR. Epic spec: [specs/epics/BA-141/spec.md](specs/epics/BA-141/spec.md). Decision: ADR-0007 in [specs/system/architecture.md](specs/system/architecture.md).

#### 1.8.1 — ADR, epic spec and roadmap ([BA-142](https://halo-powered.atlassian.net/browse/BA-142))  `✅ Done`
- **Intent:** the restyle is planned and its theming approach decided before any code, so each later story can be built and reviewed on its own.
- **Scope:** ADR-0007 in `specs/system/architecture.md`; the BA-141 epic spec; this milestone with one feature per story; the epic row in `specs/README.md`.
- **Out of scope:** product code, and capability or system spec changes for behaviour that hasn't shipped yet. Each later story updates those itself.
- **Acceptance:**
  - ADR-0007 records the semantic tokens, the System / Light / Dark preference and the bundled webfont.
  - `specs/epics/BA-141/spec.md` exists and the user has confirmed it (`Status: Confirmed`).
  - `python3 scripts/check-specs.py` passes.
- **Notes:** mockup reference: the "Publish requests" screen shared on 2026-10-09 (style only). The user confirmed the epic spec on 2026-10-09, kept `productName` and dropped the "Powered by LenAI" footer. Evidence: [evidence/1.8.1/](evidence/1.8.1/).

#### 1.8.2 — Design tokens and light/dark theme switch ([BA-143](https://halo-powered.atlassian.net/browse/BA-143))  `✅ Done`
- **Intent:** the app can be shown in a light or a navy dark theme, and it follows the OS by default.
- **Scope:**
  - A semantic token layer (light and navy dark sets) as CSS custom properties, mapped into Tailwind v4 with `@theme inline`.
  - Noto Sans (400, 500, 600, 700; Latin) bundled from `@fontsource/noto-sans` and used as the app's sans font.
  - A fifth Settings section, **Appearance**, after Developer, with a System / Light / Dark choice. System is the default.
  - The choice is kept in renderer `localStorage` and applied before Angular boots, so the page never paints in the wrong theme. On System, the app follows the OS live.
  - The Electron window background matches the resolved theme, through one preload call.
  - The dark token set is reviewed with screenshots before 1.8.3.
- **Out of scope:** restyling the shell and the screens (1.8.3–1.8.7). Until then only the page background and the Appearance section use the tokens, and the rest stays dark.
- **Acceptance:**
  - Choosing Light or Dark, or changing the OS theme while on System, retheme the open app without a reload.
  - The choice survives a restart.
  - The Appearance Gherkin in [specs/capabilities/app-shell/spec.md](specs/capabilities/app-shell/spec.md) passes as `frontend/e2e/appearance.spec.ts`.
  - The axe scan is clean in both themes.
- **Notes:** ADR-0007. Updates `ui.md` §1, §6 and §7, `data-model.md`, `tech-stack.md` and `non-functional.md`. The user chose the Settings section and Noto Sans on 2026-10-09 and approved both palettes from the token-preview screenshots the same day. The E2E simulates the OS theme with `emulateMedia`, because Electron's `nativeTheme.themeSource` doesn't reach `prefers-color-scheme` on Linux. Evidence: [evidence/1.8.2/](evidence/1.8.2/).

#### 1.8.3 — App shell: gradient frame, Agentic Hub banner and icon rail ([BA-144](https://halo-powered.atlassian.net/browse/BA-144))  `✅ Done`
- **Intent:** the window has the Agentic Hub frame, banner and navigation rail, in both themes.
- **Scope:**
  - Gradient frame around a rail card and a canvas card.
  - A compact (72 px) "Agentic Hub" banner, which is the page's level-one heading.
  - Page content and the details panel as `card`s side by side.
  - An always-visible icon rail replaces the 296 px sidebar. Datasets, Agents, Knowledge and Sessions are at the top; the account avatar, system logs and Settings are at the bottom. The collapse and expand sidebar controls are removed.
  - Sessions becomes a rail destination with a list pane (refined in 1.8.5).
  - Settings becomes a rail destination with a section list beside the chosen form, replacing the settings sidebar and its Back button.
  - "Halo BI Assistant" becomes "Agentic Hub" in the window title, the document title and the settings footer.
  - Fix the existing axe contrast failures in the old Settings sidebar (the `⌘ F` hint and the version footer), found in 1.8.2.
  - The right-panel empty states, which are visible in the shell's initial state, move to tokens.
- **Out of scope:**
  - `productName`, installer names and the data directory, which stay "Halo BI Assistant".
  - The mockup's "Powered by LenAI" footer.
  - Collapsing the session list and restyling its rows (1.8.5).
  - Restyling the screens inside the cards (1.8.6, 1.8.7).
- **Acceptance:**
  - Every rail destination opens the same view the old sidebar did.
  - The titles read "Agentic Hub".
  - The new Feature "Navigation rail" (`frontend/e2e/navigation.spec.ts`) and the updated layout scenario pass, with the E2E helpers moved off "Back".
  - The axe scan of the initial shell is clean in the light theme.
- **Notes:** decided with the user on 2026-10-09: a compact banner, Settings as a rail destination with a section list, and no collapse control. Depends on 1.8.2 and 1.8.4. Also done here:
  - nine screen titles demoted from `h1` to `h2`, so the banner is the only `h1` (R7);
  - theme switches suppress transitions for one frame, because the axe run caught rows mid-fade;
  - the page card became the `<main>` landmark, for the axe `region` rule.
  Evidence: [evidence/1.8.3/](evidence/1.8.3/).
#### 1.8.4 — Shared components: pill buttons, status chips, cards and list rows ([BA-145](https://halo-powered.atlassian.net/browse/BA-145))  `✅ Done`
- **Intent:** the building blocks every screen uses match the design in both themes, so the screen stories only swap classes.
- **Scope:** Tailwind v4 `@utility` classes in `frontend/src/styles/components.css`, built only from the 1.8.2 tokens:
  - buttons: `btn` with `btn-primary`, `btn-secondary`, `btn-outline`, `btn-ghost`, `btn-danger`, plus `btn-icon`;
  - chips: `chip` with `chip-warning`, `chip-info`, `chip-neutral`, `chip-success`, `chip-danger`;
  - `card`, `card-muted`, `list-row` / `list-row-selected`, `filter-pill` / `filter-pill-active`, `field` / `field-label`, `section-header` / `section-title`, `menu` / `menu-item`.
  - The Appearance section adopts them.
- **Out of scope:** adopting them on every screen (1.8.3, 1.8.5–1.8.7).
- **Acceptance:** the classes compile into the app's CSS from tokens only (no hex or palette colours); the Appearance E2E stays green with the section built from them; ui.md §3 documents each class.
- **Notes:** built before 1.8.3 so the shell can use the classes. Depends on 1.8.2. Evidence: [evidence/1.8.4/](evidence/1.8.4/).
#### 1.8.5 — Sessions master-detail list pane ([BA-146](https://halo-powered.atlassian.net/browse/BA-146))  `✅ Done`
- **Intent:** sessions are browsed in a list pane beside the content, as in the mockup's request list, and the pane can step aside to give the chat room.
- **Scope:**
  - The Sessions list pane from 1.8.3 gets a **Collapse session list** button. While collapsed, the page header shows **Expand session list**. The state is not remembered between launches.
  - Each row shows the session name and, under it, its datasets (`fg-muted`), like the mockup's rows.
  - "No sessions yet." when the list is empty.
  - The new-session composer moves to tokens and shared components.
- **Out of scope:** changes to the session data or its order (see 1.7.19); the chat itself (1.8.7).
- **Acceptance:** the new scenario "Collapses and expands the session list" in the Navigation rail Feature and the existing session flows (`world-cup-workflow.spec.ts`, `chat-and-visuals.spec.ts`, `developer-observability.spec.ts`) pass on web.
- **Notes:** the user chose a collapsible pane on 2026-10-09. Depends on 1.8.3 and 1.8.4. Evidence: [evidence/1.8.5/](evidence/1.8.5/).
#### 1.8.6 — Restyle feature screens: datasets, catalog, agents, knowledge and settings ([BA-147](https://halo-powered.atlassian.net/browse/BA-147))  `✅ Done`
- **Intent:** the feature screens match the design in both themes.
- **Scope:** datasets list, catalog browser, agents list and detail, knowledge list and form, and the settings forms move to tokens and shared components.
- **Out of scope:** behaviour and copy changes.
- **Acceptance:** no hardcoded colours remain on these screens; their E2E specs pass unchanged apart from moved navigation and the colour-class assertions in `developer-settings.spec.ts`; the new scenario "no accessibility violations on any screen in either theme" passes.
- **Notes:**
  - Depends on 1.8.4.
  - Built by two parallel subagents, then checked with a class-stripping diff against HEAD (0 non-class changes).
  - Also gave names to the unnamed Datasets and Agents search, layout and row-options buttons, which the new axe scan flagged.
  - Evidence: [evidence/1.8.6/](evidence/1.8.6/).

#### 1.8.7 — Restyle chat, visual panel, system logs and toasts; regenerate the visual baseline ([BA-148](https://halo-powered.atlassian.net/browse/BA-148))  `✅ Done`
- **Intent:** the rest of the app matches the design, and the visual tests guard both themes.
- **Scope:** session chat and composer, the interactive visual panel frame, the right panel, system logs and toasts move to tokens; Playwright visual baselines are regenerated for Light and Dark.
- **Out of scope:** the generated visuals' own styling inside the iframe.
- **Acceptance:** no hardcoded colours remain in the renderer; the axe scan is clean in both themes; baselines for both themes are committed.
- **Notes:**
  - Depends on 1.8.4.
  - The web baseline was regenerated in 1.8.3 and still matches. The desktop (`-darwin`) baseline is regenerated only on a requested desktop run.
  - Also: toasts became a "Notifications" live region with a named dismiss button; `index.html` declares the cascade-layer order first; ui.md §2, §3, §4, §6 and §8 were synced to tokens.
  - Evidence: [evidence/1.8.7/](evidence/1.8.7/).

#### 1.8.8 — Align with the Insight Agent AI Figma design ([BA-158](https://halo-powered.atlassian.net/browse/BA-158))  `✅ Done`
- **Intent:** the app matches the Figma the design team owns (file `qW41gtAbnTcqoqpEKajqZX`, Chat frame `2154:31891`), not just a mockup's visual language, while keeping the name "Agentic Hub".
- **Scope:**
  - Light tokens from the Figma variables, with the dark set re-derived. Frame gradient and texture, rail and banner sizes, and shadows as in the Figma.
  - Rail: hamburger, logo, workspace items, avatar, system logs, Settings, a divider and the LenAI footer. The hamburger toggles a 240 px drawer with labels and the session list, replacing the 1.8.5 pane.
  - Each page gets a header (icon, 24 px light title, soft action). In a session that's the session name and "Start New Conversation".
  - Chat restyled to the frame: user bubble with avatar, the answer with the sparks mark at 16/24 px, bordered tables with a `#F8FAFC` header row, "Data Sources" (today's "Data used"), the thumbs and copy actions, the prompt input with the send icon, and the disclaimer.
  - The visual panel opens on demand.
  - Figma brand assets live in `frontend/public/brand/agentic-hub/`; the two photos are re-encoded as WebP, 504 KB instead of 8.4 MB.
- **Out of scope:** the "Insight Agent AI" name, the logout button, and new features. Generic icons stay `lucide-angular`.
- **Acceptance:**
  - A side-by-side screenshot of the Figma frame and the running chat in the evidence.
  - Navigation rail scenarios for the drawer (open, choose a session, close) and the on-demand visual panel.
  - The full web suite passes, and axe is clean on every screen in both themes.
- **Notes:**
  - Decided with the user on 2026-10-09: keep "Agentic Hub", include both LenAI marks, drawer plus on-demand panel, and track as a new story. The user re-confirmed the epic spec ("implement the full epic").
  - The chat restyle was done by a subagent in parallel with the shell.
  - `fg-muted` is `rgba(0,0,0,.6)` rather than Figma's `.55`, for AA.
  - Evidence: [evidence/1.8.8/](evidence/1.8.8/).

### Milestone 1.9 — Agent Hub ([BA-150](https://halo-powered.atlassian.net/browse/BA-150))

Users build their own data agents on top of the assistant (instructions, datasets, starter questions, an optional model override), test them as drafts, publish them, pin them and start chats from them. The Agents screen becomes a searchable hub of cards with the filters All, Pinned, Official and Mine. The built-in helper agents move to a System section. Teams, the org and sharing are out: the app stays local-first. Builds on the look and feel of Milestone 1.8 ([BA-141](https://halo-powered.atlassian.net/browse/BA-141)). All stories are built on the branch `feat/BA-150-agent-hub` and ship as one PR. Epic spec: [specs/epics/BA-150/spec.md](specs/epics/BA-150/spec.md). Decision: ADR-0008 in [specs/system/architecture.md](specs/system/architecture.md).

#### 1.9.1 — ADR, epic spec and roadmap ([BA-151](https://halo-powered.atlassian.net/browse/BA-151))  `✅ Done`
- **Intent:** the Agent Hub is scoped and its runtime approach decided before any code, so each later story can be built and reviewed on its own.
- **Scope:** ADR-0008 in `specs/system/architecture.md`; the BA-150 epic spec; this milestone with one feature per story; the epic row in `specs/README.md`.
- **Out of scope:** product code, and capability, system or glossary spec changes for behaviour that hasn't shipped yet. Each later story updates those itself.
- **Acceptance:**
  - ADR-0008 records that user agents are stored configurations of the assistant (draft and Live versions, applied per turn), not runtime-registered agents.
  - `specs/epics/BA-150/spec.md` exists and the user has confirmed it (`Status: Confirmed`).
  - `python3 scripts/check-specs.py` passes.
- **Notes:** mockup reference: the "Agentic Hub — Agents" screen shared on 2026-10-09. Decisions taken with the user on 2026-10-09: user-built agents plus built-ins; local only, with My team and Whole org deferred; the hub replaces the Agents list; inside the 1.0 Beta; agents configure instructions, datasets, starter questions and a model override; chats start from an agent; Draft → Publish → Live; helpers in a System section. ADR-0008, because BA-141's branch holds ADR-0007. The user confirmed the epic spec on 2026-10-09 and chose to build the hub screen and editor with today's styles (BA-141's 1.8.6 restyles them later). Evidence: [evidence/1.9.1/](evidence/1.9.1/).

#### 1.9.2 — Agent definitions: storage and API ([BA-152](https://halo-powered.atlassian.net/browse/BA-152))  `✅ Done`
- **Intent:** user agents and pins are stored locally and can be managed through the API.
- **Scope:** an `agents` collection with a `draft` and an optional `live` configuration (name, description, instructions, dataset names, starter questions, optional model or reasoning-effort override) and `pinned`; pin state for built-in agents; endpoints to list (built-ins merged with user agents, each with its kind (official, system or user), status and pin), get, create, update the draft, publish, delete and pin or unpin; validation (name required and unique among user agents, at least one dataset to publish).
- **Out of scope:** running an agent (1.9.3); any UI (1.9.4, 1.9.5).
- **Acceptance:** backend e2e covers create → publish → edit draft → republish → delete, and pin or unpin for user and built-in agents; data survives a backend restart; `data-model.md`, `api.md`, the glossary and the agents-evals rules are updated.
- **Notes:** ADR-0008. New collection token per CLAUDE.md *Backend*; no migration (new collection). `GET /agents` keeps its existing sort by name across built-in and user agents (api.md). The backend e2e starts the built `dist/main.js` as a child process, because Jest can't load `AppModule` (ESM-only packages under Mastra and the Databricks driver). Its `E2E_BACKEND_PORT` harness option was removed when the branch merged BA-156's web E2E harness, which already isolates ports. Evidence: [evidence/1.9.2/](evidence/1.9.2/).

#### 1.9.3 — Start a session from an agent ([BA-153](https://halo-powered.atlassian.net/browse/BA-153))  `✅ Done`
- **Intent:** a user chats with an agent and gets answers shaped by its instructions, over its datasets.
- **Scope:** **Start chat** on Live user agents and on the Official agent, on the hub card and in the detail view; on a Live agent it creates a session at once, named after the agent, storing the agent id and copying its existing datasets (on the Official agent it opens the new-session screen); each turn adds the agent's current Live instructions as a labelled system context block after the other context blocks, and applies its model or effort override; the agent's description and starter questions in an empty session's welcome block; the agent's name in the session list and page header; a deleted agent falls back to the plain assistant and is shown as `<name> · agent deleted`.
- **Out of scope:** switching agents inside a session; drafts in real sessions (the preview chat is 1.9.5).
- **Acceptance:** a Playwright flow starts a chat from a Live agent, clicks a starter question, and the answer follows the agent's instructions; publishing a new version changes the next turn; the read-only guard still rejects writes under instructions that ask for them; `agents.md`, `api.md` and the sessions-chat spec are updated.
- **Notes:** depends on 1.9.2. The base prompt's identity line and its E2E assertion are unchanged. Decisions taken with the user on 2026-10-09: Start chat creates the session at once (no form); it sits on the card and in the detail view; republishing changes the instructions and model of existing sessions from their next turn but never their datasets (sessions-chat R5); a deleted agent's sessions keep a copy of its name and show `<name> · agent deleted`. Also decided: draft and System agents offer no Start chat; a starter question fills the composer without sending (as R50); a session drops the agent's missing datasets, and Start chat is disabled when none exist. The E2E proves the instructions and model reach the model through a local OpenAI-compatible stub that records each request, since a real model's answers can't be asserted. E2E runs on the web target (BA-156). Desktop not run. Evidence: [evidence/1.9.3/](evidence/1.9.3/).

#### 1.9.4 — Agent Hub screen ([BA-154](https://halo-powered.atlassian.net/browse/BA-154))  `✅ Done`
- **Intent:** users find, filter and pin agents, and open them, from one screen that matches the mockup.
- **Scope:** the Agents screen becomes the hub: header with **New agent**, search over name and description, filter pills All, Pinned, Official and Mine, sections of cards with **Show more**, card name, description, owner ("You" or "Official"), Pin or Pinned and Draft or Live chip; a System section for the helper agents; a card opens today's detail view (tabs unchanged) with Publish and Delete for user agents (Start chat arrives with 1.9.3 and Edit with 1.9.5); empty, loading, error and no-match states; a warning on agents whose datasets are missing.
- **Out of scope:** My team and Whole org; the editor form (1.9.5): **New agent** is shown but disabled until 1.9.5; Start chat (1.9.3).
- **Acceptance:** Playwright covers search, each filter, pin and unpin, Show more and opening an agent; the existing `agents.spec.ts` eval flows pass; the axe scan is clean; `ui.md` and the agents-evals rules R1–R9 and Gherkin are rewritten for the hub.
- **Notes:** depends on 1.9.2. Built with today's styles, not BA-141's components (decided 2026-10-09). BA-141 then merged to `main` first, so the hub, card, detail and eval-trace templates moved onto BA-141's theme tokens and shared classes when `main` was merged into this branch (2026-10-09). Moved ahead of 1.9.3 on 2026-10-09 so the user can see the hub sooner. E2E runs on the web target (BA-156). Shipped to the mockup: under All, pinned cards stay first in their own section (Official, Mine, System), Pinned is a filter, and the search is a full-width row. Card text was `zinc-400` for axe contrast before the token move; the axe scan re-runs in both themes after it. Desktop not run. Evidence: [evidence/1.9.4/](evidence/1.9.4/).

#### 1.9.5 — Agent editor: create, test, publish and delete ([BA-155](https://halo-powered.atlassian.net/browse/BA-155))  `✅ Done`
- **Intent:** users build and change agents safely, testing a draft before it reaches their sessions.
- **Scope:** an editor for name, description, instructions, datasets, starter questions and model override, opened by **New agent** or **Edit**; Save keeps a Draft; a preview chat runs the draft and is not saved to the session list; Publish makes it Live; editing a Live agent shows "Unpublished changes" while the Live version keeps serving; Delete with confirmation; built-in agents are read-only.
- **Out of scope:** duplicating agents; version history beyond one draft and one Live version.
- **Acceptance:** Playwright covers create → preview → publish → edit → republish → delete, and that a preview chat leaves no session behind; `ui.md` and the agents-evals spec are updated.
- **Notes:** depends on 1.9.3 and 1.9.4. If the beta window closes, the preview chat is the first thing to move out (see the epic spec). Decisions taken with the user on 2026-10-09: the editor is a full page in the Agents area; the preview chat sits in the right Details panel beside the form; sending a preview message first saves the form as the draft, so the preview always runs the saved draft; the preview conversation, its memory and its workspace are discarded when the editor closes, and **Reset** starts it over. Also decided: the preview is an in-memory session (never in the `sessions` collection, as ADR-0008 says), created through `POST /sessions` with `{ agentId, preview: true }` and streamed and discarded through the existing session routes, so the chat component is reused; leftovers from a crash are swept at the next backend start; the model override is a free-text field (a deployment name can't be listed) and the effort a Default/Low/Medium/High select; leaving the editor with unsaved changes asks first. The E2E runs against a per-worktree World Cup database created with the infra MCP service (`.env.e2e.local`, harness in [tech-stack.md](specs/system/tech-stack.md)). Desktop not run. Evidence: [evidence/1.9.5/](evidence/1.9.5/).

### Milestone 1.10 — LLM configuration ([BA-159](https://halo-powered.atlassian.net/browse/BA-159))

Users can configure any supported model in Settings → LLM, reasoning models included, and choose how hard it reasons from the levels that model offers. All stories are built on the branch `feat/BA-159-llm-configuration` and ship as one PR. Epic spec: [specs/epics/BA-159/spec.md](specs/epics/BA-159/spec.md).

#### 1.10.1 — Per-model reasoning effort in LLM Settings ([BA-160](https://halo-powered.atlassian.net/browse/BA-160))  `✅ Done`
- **Intent:** a user can configure `gpt-5` (or any reasoning model) and pick one of the effort levels that model accepts; today the connection test times out at 30 s and the model can't be saved.
- **Scope:** a built-in table of effort levels by model family (OpenAI `gpt-5` to `gpt-6`, the o-series, Claude models that take `effort`), with `low / medium / high` for unknown names and none for models without reasoning; `GET /llm/effort-levels` for the form; a **Reasoning effort** select in Settings → LLM showing the model's levels; Save stores the chosen effort; the connection probe (test and save) asks for the model's lowest level; turns send the chosen effort, mapped to the nearest level the model offers.
- **Out of scope:** the chat composer's effort menu and the agent editor's effort field (they keep `low / medium / high`); fetching levels from providers at runtime; changing the 30 s probe limit.
- **Acceptance:** Playwright (LenAI stub) shows `Minimal / Low / Medium / High` for deployment `gpt-5`, none for `gpt-4.1` and `Low / Medium / High` for an unknown name; the test probe carries `reasoning_effort: minimal`; saving with **Medium** stores `medium` and the next chat turn sends `reasoning_effort: medium`; existing LLM settings scenarios still pass; unit tests cover the level table, the probe body and the effort mapping; the llm-settings capability spec, `api.md`, `agents.md`, `data-model.md` and `ui.md` are updated.
- **Notes:** reported 2026-10-10 by the user: `gpt-5` failed Test connection with "LLM request timed out after 30s". Decisions taken with the user on 2026-10-10: the picker lives only in Settings → LLM; the probe uses the model's lowest level; levels come from a built-in table checked against the provider docs (OpenAI model pages, Anthropic's *Effort* page, 2026-10-10). Changing the effort does not withdraw a successful test, because the probe doesn't use it. Follow-up on 2026-10-10 at the user's request: the select is always visible (disabled with a `Default — …` option when the model is empty or has no levels), so users can discover it. E2E runs on the web target (BA-156) against the infra MCP World Cup database. Desktop not run. Evidence: [evidence/1.10.1/](evidence/1.10.1/).

#### 1.10.2 — Light theme and open navigation drawer by default, remembered in the database ([BA-168](https://halo-powered.atlassian.net/browse/BA-168))  `✅ Done`
- **Intent:** the app opens in the Light theme with the navigation drawer expanded, and a user who changes either finds the change kept, even in another browser profile or after reinstalling the renderer.
- **Scope:** Light becomes the default theme (System, Light and Dark stay as choices); the drawer opens expanded; the theme choice and the drawer's Expand / Collapse state are stored in a `ui-preferences` document in the `settings` collection through `GET` / `PUT /ui-preferences`; a browser-storage copy of each applies before the first paint, the backend winning once loaded; a theme saved only in browser storage moves to the backend once (M12).
- **Out of scope:** remembering the details panel (it still opens collapsed); per-user preferences (the app has no accounts); other settings.
- **Acceptance:** Playwright: a new install opens Light (even with a dark OS) with the drawer expanded; collapsing the drawer or choosing Dark survives a restart in a fresh browser profile on the same data; a browser-only Dark choice is moved to the database; existing appearance, navigation and layout scenarios pass (visual baselines updated on purpose for the expanded drawer); ADR-0009; app-shell R2, R39, R43, R50, `api.md` 2.12, `data-model.md` 3.2.1 and M12 updated.
- **Notes:** requested by the user on 2026-10-10 and shipped in the BA-159 PR at their request (an exception to one epic per PR, like the CLAUDE.md rule). Decisions taken with the user: keep System as a choice; database plus a browser cache for the first paint, with a one-time move of existing choices; "left bar" means the navigation drawer. ADR-0009 supersedes ADR-0007's preference storage and default. E2E runs on the web target (BA-156). Desktop not run, and the darwin desktop baseline was not regenerated. Evidence: [evidence/1.10.2/](evidence/1.10.2/).

### Milestone 1.11 — Claude Code workflow mod ([BA-169](https://halo-powered.atlassian.net/browse/BA-169))

Developer tooling, not an application change: a Claude Code mod in the repository shows the eleven-step workflow from [CLAUDE.md](CLAUDE.md) in a side pane, and the repository offers it to every developer. All stories are built on the branch `feat/BA-169-claude-code-workflow-mod` and ship as one PR. Epic spec: [specs/epics/BA-169/spec.md](specs/epics/BA-169/spec.md).

#### 1.11.1 — Ship the workflow-steps mod in the repo and make it installable ([BA-170](https://halo-powered.atlassian.net/browse/BA-170))  `✅ Done`
- **Intent:** a developer working in this repository with Claude Code sees the workflow steps in the right-hand pane without reopening CLAUDE.md, and every developer can install the mod from the repository.
- **Scope:** the mod under `.claude/mods/workflow-steps/` (manifest, hooks module, state types, tests, README): at session start and on `/workflow` it reads `CLAUDE.md`, parses the `## Workflow` section and opens a **Workflow** pane listing the mandatory first action and the eleven steps (number, title, first sentence), with a built-in copy when the file is unreadable; a marketplace manifest at the repository root (`.claude-plugin/marketplace.json`) listing the mod; project settings (`.claude/settings.json`) that register the marketplace and enable `workflow-steps@bi-assistant`; the install, validate, test and develop recipes in `delivery.md` and the README.
- **Out of scope:** application changes; progress tracking per step; organization-wide managed installs.
- **Acceptance:** `claude plugin validate` passes on the mod and the marketplace; `claude plugin test` passes (parsing, pane on terminal and desktop, `/workflow`, both fallbacks); a session in the repo with the mod loaded shows the eleven steps and the first action as CLAUDE.md spells them; the marketplace installs from a local path; nothing under `backend/` or `frontend/` changes.
- **Notes:** requested 2026-10-10. Decisions taken with the user: a Claude Code mod, not an app feature; a static checklist; it lives in the repo; install through a repository marketplace plus project settings rather than a documented `--plugin-dir` only. No Gherkin or Playwright impact (step 6: none). Mods are early access (Claude Code ≥ 2.1.287; written against 2.1.296). The marketplace install was verified from the branch's local path; the GitHub-sourced install in `.claude/settings.json` works once the PR is on `main`. Evidence: [evidence/1.11.1/](evidence/1.11.1/).

#### 1.11.2 — Inferred task queue in the workflow pane ([BA-171](https://halo-powered.atlassian.net/browse/BA-171))  `✅ Done`
- **Intent:** the pane shows what actually happened and what comes next: tasks numbered in the order they ran, the running one with its agents, tokens and cost, and the remaining steps queued, without asking Claude to report anything.
- **Scope:** the mod infers the step from each tool call (reads before any edit → 1; `AskUserQuestion` → 2; `roadmap.md` → 3; `specs/system/architecture.md` → 4; `specs/**` → 5; `evidence/*/e2e-impact.md` → 6; `frontend/e2e/**`, `backend/test/*.e2e-spec.ts` → 7; `frontend/src/**`, `backend/src/**`, `.claude/**` → 8; test, build and check-specs commands → 9, passed or failed from the result; `changelog.md`, `evidence/**` → 10; `retrospective.md` → 11); a step change opens a tentative task (`#n?`) that earns its number after three matched calls or one write and is dropped after three unmatched calls; done rows show step, agent, duration, tokens and cost; the running row shows a confidence bar (matched over all calls) and its subagents; the remaining steps are queued with the numbers they will get, steps without a signal listed apart; done rows beyond the last twelve fold into one line; tokens from each turn's usage, cost as the session cost delta; `/workflow reset` clears the queue; `delivery.md` §9 and the mod README updated.
- **Out of scope:** a reporting tool or prompt injection; a history store and estimates (alternatives 4 and 5); press interactions; the lanes layout.
- **Acceptance:** `claude plugin validate` and `claude plugin test` pass, the tests covering the rule table, the tentative threshold and drop, numbering across a repeat, usage and cost attribution, the fold and `/workflow reset`; a session in the repo shows the queue moving as files are edited and commands run; nothing under `backend/` or `frontend/` changes.
- **Notes:** chosen 2026-10-10 from the five inferred-queue alternatives (confidence queue). Decisions with the user: inference only; cost as the session delta, no price table; no store yet (alternative 5 is the natural follow-up). Verified with the mod's tests and a live session in the terminal; the elapsed time in the pane only refreshes on events (no ticking clock). Evidence: [evidence/1.11.2/](evidence/1.11.2/).

#### 1.11.3 — Task details in the workflow pane: click a task to see its summary, agents and completion ([BA-174](https://halo-powered.atlassian.net/browse/BA-174))  `✅ Done`
- **Intent:** every task in the queue says who works on it, what it has cost and how far along it is, and one click shows what it actually did, so the pane answers "where are we and what's left" without reading the transcript.
- **Scope:** each row (done, running, tentative and queued) shows its agent (`main`, `main +k` with subagents, `~main` expected for a queued step), tokens, cost, a completion bar with its %, and its summary when the pane has room; the header adds the overall completion (the mean of the rows' %). Rows are plain `Button`s: a click, or Enter under the focus after `ctrl+x tab`, opens a detail under the row, and pressing again closes it; several can be open at once. The detail holds a summary built from the task's own calls (files edited, shell paths, commands run, reads, questions, the last test result, subagents; a queued step shows its CLAUDE.md summary), the step's checklist with each check met or not, the agents with their own tokens (a subagent's run ends in a `turn.complete` carrying its `agentId`: its usage goes to that agent and the task it was spawned under, and marks it finished), and the confidence the 1.11.2 bar showed. Completion is the share of the step's checklist met, from facts the rules read off the calls (the table in `delivery.md` §9). `delivery.md` §9, the epic spec and the mod README updated; manifest `0.3.0`.
- **Out of scope:** cost per agent (the session reports one cost; no price table, as in 1.11.2); the list-and-detail and lanes layouts (options B and C); a history store; prompt injection or asking Claude to report.
- **Acceptance:** `claude plugin validate` and `claude plugin test` pass, the tests covering every step's checklist facts, the summary, the expected agent, the overall %, a subagent's tokens credited to it and its task, and a press that opens and a second press that closes a row; `tsc` over the hooks against the engine's declarations is clean; a live session shows a row opening on a click and on Enter; nothing under `backend/` or `frontend/` changes.
- **Notes:** chosen 2026-10-12 from three clickable mockups (option A, expand in place). Decisions with the user: several rows can stay open; tokens per agent, cost at task level only. Found in a live session and fixed with tests: a row inside a `Button` is not truncated, so columns now drop to fit the pane; step 1's checks are the session's, because its calls often count for other steps. Verified with the mod's tests and a live session in a 180-column tmux (keyboard press); a mouse click raises the same `ui.press` and is covered by the test kit's press, not by the live run. Evidence: [evidence/1.11.3/](evidence/1.11.3/).

### Milestone 1.13 — Assistant skills: progressive-disclosure agent structure ([BA-198](https://halo-powered.atlassian.net/browse/BA-198))

A behaviour-preserving refactor of the app's Mastra agents to the Agent Skills layout: a slim always-on assistant prompt, and skills (`SKILL.md` + `phases/` + `reference/`) that the model loads on demand or the harness injects when a condition holds in code. Extended on 2026-10-14 with user and project skill levels that override the built-in skills by name, and a read-only Skills tab on the agent page (ADR-0019). The levels were removed again the same day, after 0.32 shipped them: only built-in skills load (1.13.13, ADR-0021). Proven by the world-cup eval set before and after (same model) and the full E2E suite. All stories are built on `refactor/BA-198-assistant-skills` and ship as one PR. Epic spec: [specs/epics/BA-198/spec.md](specs/epics/BA-198/spec.md). (1.12 is held by the BA-82 branch.)

#### 1.13.1 — ADR, epic spec and skill loader for app-owned skills ([BA-199](https://halo-powered.atlassian.net/browse/BA-199))  `✅ Done`
- **Intent:** every agent gets its skills from one place, declared per agent, checked at startup, so later stories only move text.
- **Scope:** ADR-0018; the epic spec; a skill loader over `backend/src/mastra/skills/` (one resolved bundle root for CLI, Electron and Studio) that validates front matter (`name`, a `Use when…` description) and every file `SKILL.md` links, failing the backend at startup; agent-level `skills` per agent (assistant: its own list; designer: none in the catalog, loaded by the pipeline); session workspaces stop seeding and discovering `.agents/skills`; the designer reads its skill from the bundle; a stub-LLM API test that records the assistant's request and asserts its catalog; `agents.md` §7 and the open question on attached tools resolved.
- **Out of scope:** moving any prompt text (1.13.2–1.13.5).
- **Acceptance:** loader unit tests (missing name, missing description, description not starting "Use when", dangling link, missing root); the recorded request shows the assistant's catalog holding exactly its declared skills (none today), so no `interactive-visuals` entry and no skill tools; designer visual E2E green; existing sessions with old `.agents/skills` copies still open and chat.
- **Notes:** decisions with the user 2026-10-13: the app's agents, not the repo's Claude Code workflow; no new approval gates; eval tokens approved (world-cup set, before and after). Recorded on `main`: the assistant's catalog listed the designer's `interactive-visuals`, and it was offered `skill`, `skill_search` and `skill_read`. Evidence: [evidence/1.13.1/](evidence/1.13.1/).

#### 1.13.2 — Slim assistant core prompt: curated-knowledge skill, harness-loaded ([BA-200](https://halo-powered.atlassian.net/browse/BA-200))  `✅ Done`
- **Intent:** the assistant's every-turn prompt carries only the rules every data question needs; the curated-knowledge rules reach the model only on turns that carry a knowledge block, and always on those turns.
- **Scope:** `curated-knowledge` skill (the rules under "Curated knowledge:" in the prompt, about 23% of it) sent as a system message right after the knowledge block, by every caller that sends the block (chat turn, grounding pass, deep analysis, eval suite); the describe_entity rule that mentions a curated [term] stays in the core prompt; `agents.md` §2.1, §4.1, Appendices A and B.
- **Out of scope:** changing the knowledge block format; any other prompt section.
- **Acceptance:** the prompt tab still starts with `You are the Questions to Insights assistant`; recorded requests: a turn without knowledge has no curated-knowledge rules, a turn with a block has them right after it; knowledge E2E green; the eval set shows no regressions.
- **Notes:** re-scoped 2026-10-13 with the user. The on-demand `visual-tailoring` skill was cut: 427 characters of rules against a catalog and usage note of about 1,045 on every turn, and a risk of never loading. BA-201 was merged in. Evidence: [evidence/1.13.2/](evidence/1.13.2/).

#### 1.13.3 — curated-knowledge and sql-dialects skills, harness-loaded ([BA-201](https://halo-powered.atlassian.net/browse/BA-201))  `🚫 Cut`
- **Reason:** curated-knowledge merged into 1.13.2. sql-dialects cut: the app has no dialect guidance to move (one line in the prompt and the tool description), so the skill would be new behaviour written for failures nobody has observed. Revisit if evals show dialect errors.

#### 1.13.4 — Phased deep-analysis skill ([BA-202](https://halo-powered.atlassian.net/browse/BA-202))  `✅ Done`
- **Intent:** deep analysis follows a skill with a phase map, loading one phase per call, instead of prompts inlined in the service.
- **Scope:** `deep-analysis` skill (`SKILL.md`, `phases/1-plan.md`, `2-investigate.md`, `3-report.md`); the service injects the phase file for each call; `agents.md` §2.7.
- **Out of scope:** an approval gate between phases; new phases.
- **Acceptance:** each recorded deep-analysis call carries only its phase; deep-analysis unit tests and E2E green.
- **Notes:** Evidence: [evidence/1.13.4/](evidence/1.13.4/).

#### 1.13.5 — Split interactive-visuals into spec-mode and freeform references ([BA-203](https://halo-powered.atlassian.net/browse/BA-203))  `✅ Done`
- **Intent:** the designer reads only the instructions for the mode it runs.
- **Scope:** `interactive-visuals/SKILL.md` as a router; `references/spec-mode.md`, `references/freeform.md`; the pipeline injects the mode's file; `agents.md` §6.4 and §7.2.
- **Out of scope:** changing the visual spec or the runtime.
- **Acceptance:** a recorded spec-mode call carries `spec-mode.md` and not `freeform.md` (and the reverse for the fallback); visuals E2E and the `visual-request` eval case stay green.

#### 1.13.6 — Fix: `npm run evals:assistant` always refuses ([BA-204](https://halo-powered.atlassian.net/browse/BA-204))  `✅ Done`
- **Intent:** a developer can run the assistant eval suite from the command line, as `delivery.md` documents. As shipped, the CLI passes no case ids, so every set is selected and the one-fixture preflight always refuses.
- **Scope:** the CLI selects the questions from `EVAL_SET` (one set id) or `EVAL_CASES` (case ids). With neither or both, or with an unknown id, it exits 1 before any model call, naming the valid ids. Specs: agents.md §8.5, api.md environment table, delivery.md scripts table.
- **Out of scope:** the eval checks themselves. The strict `result-set-match` behaves as specified (§8.3): it needs a result whose rows *are* the reference answer, and loosening it would let a query that lists every team pass "who won".
- **Acceptance:** unit tests for the selection (set, cases, neither, both, unknown set, unknown case); a real `npm run evals:assistant` run with one case (`EVAL_CASES=shootouts`) reaches the case and prints its verdict; with no selection it exits 1 with the message and makes no model call.
- **Notes:** found while running the BA-198 evals; the before/after runs used a scratch driver. Evidence: [evidence/1.13.6/](evidence/1.13.6/).

#### 1.13.7 — Skill levels: built-in, user and project skills that override by name ([BA-205](https://halo-powered.atlassian.net/browse/BA-205))  `✅ Done`
- **Intent:** a user or administrator can add a skill to the assistant, or adjust a built-in one, by dropping a folder in the data dir or in a project skills folder, without a release.
- **Scope:** ADR-0019.
  - **Levels.** Built-in (bundle) < user (`<data dir>/skills/`) < project (the folder `QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR` names), read once at startup. A later level overrides an earlier one by name.
  - **Targeting.** A new skill is on demand, for the agents its optional `agents` front-matter key names (default `assistant`; only agents that load skills on demand). An override keeps the built-in's agents and loading mode.
  - **Validation.** A broken built-in still stops startup. A broken user or project skill is skipped and logged. An override of a harness-loaded built-in must carry its phase and reference files with the same placeholders.
  - **Text only.** User and project skills are never run as scripts. The runner for built-in scripts is reserved, not built.
  - **Layout.** The built-ins move to the confirmed layout: `interactive-visuals/references/` becomes `reference/`.
  - **Specs.** agents.md §6.4, §7.2-7.4 and §9; api.md environment table; data-model.md §4.8; ADR-0019.
- **Out of scope:** per-person skills on the org server; editing skills in the app; reloading without a restart; the script runner.
- **Notes:** Evidence: [evidence/1.13.7/](evidence/1.13.7/). Removed by 1.13.13: only built-in skills load since (ADR-0021).
- **Acceptance:**
  - Unit tests cover precedence across the three levels, `agents` targeting, every skip reason, the override checks and the warnings.
  - A recorded request (stub LLM) shows a user-level skill in the assistant's catalog with the skill tools, and a user-level `curated-knowledge` override sent after the knowledge block.
  - A broken user skill leaves the backend running.
  - Full web and org E2E, backend and frontend unit tests, builds and `check-specs.py` pass.

#### 1.13.8 — Agent page Skills tab: an agent's skills, their level, files and contents ([BA-206](https://halo-powered.atlassian.net/browse/BA-206))  `✅ Done`
- **Intent:** anyone looking at an agent can see which skills it has, where each comes from, what it overrides and exactly what it says, and why a dropped-in skill was skipped.
- **Scope:**
  - **API.** `GET /agents/:key/skills` (levels with their folders, the agent's skills, skipped skills) and `GET /agents/:key/skills/:name/file?path=`. Both need `use-agents`; a user agent shows the assistant's skills.
  - **Tab.** A read-only **Skills (<n>)** tab after Tools: where skills come from, one row per skill (level, loading, overrides, description, warnings), its file tree and the selected file's content, and a Skipped section.
  - **Specs.** api.md §2.6, ui.md §4.5, agents-evals rules and a new Feature with `agent-skills.spec.ts`.
- **Out of scope:** creating, editing or deleting skills; a restart button.
- **Notes:** Evidence: [evidence/1.13.8/](evidence/1.13.8/). 1.13.13 removes the levels, overrides, warnings and Skipped section from the tab.
- **Acceptance:**
  - E2E: the designer shows `interactive-visuals` (Built-in, Loaded by the app) and its `reference/spec-mode.md` content.
  - E2E: with a user skill and a project override seeded, the assistant shows each skill's level and what it overrides.
  - E2E: a broken user skill is listed under Skipped with its problem.
  - A file outside the skill is refused.
  - Screenshots of the tab with the Details panel open.

#### 1.13.9 — Sectioned assistant prompt with the app's own skill catalog, `read_file` and `run_skill_script` ([BA-207](https://halo-powered.atlassian.net/browse/BA-207))  `✅ Done`
- **Intent:** the assistant's prompt reads like the Agent Skills template the user gave (identity, Tools, Working rules, Skills), and the model reads and uses skills with tools the app controls.
- **Scope:** ADR-0020.
  - **Prompt.** The identity paragraph, then `## Tools` generated from the assistant's tools (name, input names, first sentence of the description), then `## Working rules` (today's rules, word for word), then `## Skills` when the assistant has on-demand skills: the user's instructions plus an `<available_skills>` catalog with name, description and the absolute `SKILL.md` path.
  - **`read_file(path)`.** Read-only, limited to the regular files of the listed skills. It replaces the framework's catalog and its `skill`, `skill_search` and `skill_read` tools.
  - **`run_skill_script(skill, script, args)`.** For built-in skills' Node scripts: no shell, `scripts/` only, a minimal environment, a 30-second timeout, output returned verbatim. Offered only when such a skill exists.
  - **`curated-knowledge` on demand** (added 2026-10-14 at the user's request). The built-in skill is listed in the catalog and the knowledge block travels without its rules. `deep-analysis` and `interactive-visuals` stay harness-loaded.
  - **Descriptions.** `SKILL.md` descriptions may wrap over several lines.
  - **Specs.** agents.md §2.1, §3.9-3.10, §7.3-7.4 and Appendices A and C; the sessions-chat Feature "Skills the assistant is given".
- **Out of scope:** a shell or bash tool; Python scripts; scripts in user or project skills; moving `deep-analysis` or `interactive-visuals` into a catalog; rewording the working rules.
- **Acceptance:**
  - A recorded request (stub LLM) shows the four sections in order, the catalog with the `SKILL.md` path, `read_file` offered and no framework skill tools.
  - A scripted `read_file` call returns the file, and one outside the skills is refused.
  - Unit tests cover the read and script limits and a wrapped description.
  - The impacted E2E specs, unit tests and builds pass. The world-cup evals pass at 100%.

#### 1.13.10 — Backend lint and format clean ([BA-208](https://halo-powered.atlassian.net/browse/BA-208))  `✅ Done`
- **Intent:** `hermes verify` and `npm run lint` pass on the backend, so a lint or type error is always new.
- **Scope:** fix the 217 ESLint errors in 35 files, the 21 files Prettier would rewrite and the 4 `tsc` errors in specs, with no behaviour change. No rule is disabled in the config; a per-line disable needs a reason.
- **Out of scope:** the frontend (it has no lint script); the 2 remaining warnings in production code.
- **Acceptance:** in `backend/`, ESLint without `--fix` reports 0 errors, `prettier --check` passes, `tsc --noEmit` reports 0 errors, and Jest and the build pass with the same test count.

#### 1.13.11 — Eval checks: a wider correct query passes; discovery cases don't require `list_entities` ([BA-209](https://halo-powered.atlassian.net/browse/BA-209))  `✅ Done`
- **Intent:** the assistant evals fail only when an answer is wrong, so the 100% bar (CLAUDE.md, step 9) measures the assistant and not the checks.
- **Scope:**
  - `result-set-match` passes when one complete, untruncated query contains every reference row in a row of its own, with extra rows allowed.
  - `schema-discovery` and `f1-schema-discovery` drop `calledTool('list_entities')`, because the session context already lists the entities.
  - The rules are in agents-evals R31 and agents.md 8.
- **Out of scope:** careful mode's comparison (`result-compare.ts`) and the golden-set harness.
- **Acceptance:** unit tests cover a wider query that passes, a missing reference row that fails, and rows from two queries that are never combined. The world-cup evals pass at 100% (3 runs).
- **Notes:** decided with the user 2026-10-14. The cases had failed on every run before this change, with correct answers.

#### 1.13.12 — Assistant reliability for the 100% eval bar ([BA-210](https://halo-powered.atlassian.net/browse/BA-210))  `✅ Done`
- **Intent:** the assistant asks when "best" has no measure, and charts what the user asked, so the world-cup evals can pass at 100% (CLAUDE.md, step 9).
- **Scope:**
  - **Rule A4.** A new sentence: a "best/top/performed well" question with no measure is ambiguous even when several measures could be covered, so the model asks before any query (agents.md 2.1, Appendix A).
  - **`create_visual`.** With no instruction it uses the turn's user message, carried as the new requestContext key `turn-question` (agents.md 3.6, 4.2).
  - **`ask_clarification`.** `options` is one string, one option per line (`Title — explanation`), split into the stored `{label, description}`. The model serialized array parameters (a list of objects, then a list of strings) wrongly now and then. A list, a JSON-encoded list and a leaked `<parameter name="…">` wrapper are all normalized to lines.
  - **Designer data.** When `create_visual` gets an instruction and more than 3 result sets, it keeps the 3 that match the instruction's words, instead of the 3 largest, so the chart's own query is never dropped (agents.md 6.2). A call that fails the schema is no longer turned into a card: the model gets the error and asks again (agents.md 3.5, 5.1; sessions-chat R42).
  - **Rule A12.** A question outside the data gets nothing from general knowledge, not even background about the person, team or event it names (the model added Pelé's career years).
  - **Rule A32.** "Join to the entity holding the name" becomes "in the same query", so one result holds the whole answer (the model was looking names up in a second query).
  - **Rule A35.** A question about what data the user has is answered from the session context and `describe_entity`, without running a query (the `schema-discovery` check kept by 1.13.11).
- **Out of scope:** checks and reference SQL (1.13.11); other wording of the working rules.
- **Acceptance:** unit tests for the three behaviours. The world-cup evals pass at 100% over 3 runs.
- **Notes:** `ambiguous-best-team` passed 1 of 4 runs and `visual-request` failed once with `create_visual({})`, both on the base before BA-207.

#### 1.13.13 — Built-in skills only: remove user and project skill levels ([BA-211](https://halo-powered.atlassian.net/browse/BA-211))  `✅ Done`
- **Intent:** agents get only the skills that ship with the app, reviewed and covered by the evals, so no folder on disk can change what an agent is told. Reverses 1.13.7.
- **Scope:** ADR-0021, superseding ADR-0019.
  - **Backend.** Skills load only from the bundle (`src/mastra/skills/<name>/`). No user level (`<data dir>/skills/`), no project level and no `QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR`. No overrides by name, skipped skills or per-skill warnings. A broken built-in skill still stops the backend at startup. A `<data dir>/skills/` folder left by 0.32 is ignored: neither read nor deleted.
  - **API.** `GET /agents/:key/skills` answers `{ skills: [{ name, description, loading, files }] }`, without `levels`, `skipped` or each skill's `level`, `overrides` and `warnings`. The file endpoint is unchanged.
  - **Skills tab.** Removes "Where skills come from", the level pill, "Overrides …", the warnings, the Skipped section and the "Restart the app" line. Keeps the user-agent line, the loading pill, the description, the file list and file view, and "This agent has no skills."
  - **Unchanged.** The assistant's prompt and catalog (same built-in skills), `read_file` and `run_skill_script`.
  - **Specs.** ADR-0021; agents.md §2.2, §7.2-7.4; api.md 34a and environment table; ui.md §4.5 and copy table; data-model.md §4.8; glossary *Skill*; agents-evals R63-R67 and the Feature "Agent skills"; sessions-chat Feature "Skills the assistant is given"; the BA-198 epic spec.
- **Out of scope:** deleting `<data dir>/skills/` folders left by 0.32; a desktop E2E run.
- **Acceptance:**
  - Unit tests: only built-in skills load; a skill folder in the data dir and a set `QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR` have no effect; a broken built-in still stops startup.
  - A recorded request (stub LLM) with an old skills folder in the data dir shows the assistant's catalog listing only `curated-knowledge`.
  - E2E: the Skills tab shows each skill's loading mode and files, with no levels, overrides or Skipped section; the assistant lists `curated-knowledge` and `deep-analysis` only.
  - The impacted E2E specs, backend and frontend unit tests, lint, builds and `check-specs.py` pass. The assistant receives the same prompt, catalog and tools as on the base commit; the step-9 eval rule applies if the recorded request shows otherwise.
- **Notes:** decided by the user on 2026-10-14: "delete user and project skills, for now we are going to use only the built-in skills."

### Milestone 1.14 — Agent Hub: tools and skills per agent ([BA-213](https://halo-powered.atlassian.net/browse/BA-213))

A user agent's builder chooses its tools from the assistant's own set, writes skills in the app and assigns them to any of their agents; from 1.14.6 the builder does both by linking skills and tools in the agent's instructions (ADR-0024). Instructions stay layered on the core prompt, which from 1.14.11 a Platform admin can edit like every other built-in agent's prompt (ADR-0026); every guard enforced in code holds for every agent. Builds on Milestone 1.9 (ADR-0008) and Milestone 1.13 (ADR-0020). [BA-211](https://halo-powered.atlassian.net/browse/BA-211) (removing the skill folders) is not a dependency. All stories are built on the branch `feat/BA-213-agent-tools-skills` and ship as one PR. Epic spec: [specs/epics/BA-213/spec.md](specs/epics/BA-213/spec.md). Decisions: ADR-0022, ADR-0024 and ADR-0026 in [specs/system/architecture.md](specs/system/architecture.md). From 1.14.12 the hub also ships a second Official agent built in code, the RFP Builder, which walks a Mercer benefits consultant through a carrier RFP over the Intellify data, reached only through the Intellify RFP API this epic builds (ADR-0027, ADR-0028); plan: [docs/plans/BA-213/rfp-builder-plan.md](docs/plans/BA-213/rfp-builder-plan.md). From 1.14.18 every agent can show a file, a document, a query result, a visual or its workflow progress in the right panel, with what it showed saved per session (ADR-0029); design: [docs/plans/BA-213/ba-231-design.md](docs/plans/BA-213/ba-231-design.md).

#### 1.14.1 — ADR, epic spec and roadmap for agent tools and skills ([BA-214](https://halo-powered.atlassian.net/browse/BA-214))  `✅ Done`
- **Intent:** the epic is scoped, its runtime approach decided and its prompt cost measured before any code.
- **Scope:** ADR-0022 in `specs/system/architecture.md`; the BA-213 epic spec, with the per-section prompt measurement; this milestone with one feature per story; the epic row in `specs/README.md`.
- **Out of scope:** product code, and capability, system or glossary spec changes for behaviour that hasn't shipped yet. Each later story updates those itself.
- **Acceptance:** the user confirms the epic spec (`Status: Confirmed`) and ADR-0022 (`Accepted`); `python3 scripts/check-specs.py` passes.
- **Notes:** measured on 2026-10-14 from the compiled assistant at `513009d`: prompt 8,729 characters, `## Skills` 904, about 160 per extra catalog entry. Epic spec and ADR-0022 confirmed by the user on 2026-10-14. Evidence: [evidence/1.14.1/](evidence/1.14.1/).

#### 1.14.2 — Choose an agent's tools ([BA-217](https://halo-powered.atlassian.net/browse/BA-217))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.2/](evidence/1.14.2/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** an agent's builder decides which of the assistant's tools it gets, and the model is offered only those.
- **Scope:** `tools` in the agent configuration (absent means all); the assistant's tools and prompt built per call from the requestContext; `list_entities`, `describe_entity` and `run_readonly_sql` always on; `sample_rows`, `ask_clarification` and Visuals (`create_visual` + `update_visual`) optional; tool-free replacement wording for the rules that name a tool that is off; a tool picker in the agent editor; the preview runs the draft's tools; eval cases with clarification off and with Visuals off.
- **Out of scope:** new tools; tools for the System agents.
- **Acceptance:** a golden test proves the plain assistant's prompt is unchanged; a recording-stub E2E proves a tool turned off is not offered; the world-cup evals and the new cases pass at 100% over 3 runs.
- **Notes:** BA-211 (1.13.13) is merged in: only built-in and in-app skills exist. The checkbox tool picker is replaced by links in the instructions in 1.14.6 ([BA-219](https://halo-powered.atlassian.net/browse/BA-219)); the stored `tools` list stays, derived from the links.

#### 1.14.3 — Write skills in the app ([BA-215](https://halo-powered.atlassian.net/browse/BA-215))  `✅ Done`
- **Intent:** a user captures reusable know-how as a skill without touching the disk or restarting the app.
- **Scope:** an owner-scoped `skills` collection (name, description, body, reference files); create, list, get, update and delete endpoints; a skills library page and a skill editor in the Agents area; the file-skill checks (kebab-case name unique per owner and not a built-in name, `Use when` description, linked files present) and size limits.
- **Out of scope:** scripts; overriding built-in skills; sharing skills between users.
- **Acceptance:** Playwright covers create → edit → delete and each refusal; an API test proves two users never see each other's skills.
- **Notes:** endpoints 94-98 in api.md 2.6.1; rules R68-R74.

#### 1.14.4 — Assign skills to an agent ([BA-216](https://halo-powered.atlassian.net/browse/BA-216))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.4/](evidence/1.14.4/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** the same skill serves several agents, and a Live agent never changes until it is republished.
- **Scope:** `skills` in the agent configuration; a skill picker in the agent editor; the agent session's catalog (built-in on-demand skills plus the agent's); `read_file` over a virtual location for in-app skills; publish copies the skills' content into the Live version; the agent page's Skills tab for user agents; agent transfer carries the draft's skill references.
- **Out of scope:** in-app skills for the plain assistant.
- **Acceptance:** a recording-stub E2E proves an assigned skill is in the catalog, `read_file` returns its body, and a Live session keeps the published copy after the skill is edited; the world-cup evals pass at 100% over 3 runs.
- **Notes:** depends on 1.14.3. In-app skill locations are virtual paths under `/in-app-skills/`, read by the unchanged `read_file`, so the plain assistant's prompt stays byte-identical. The checkbox skill picker is replaced by links in the instructions in 1.14.6 ([BA-219](https://halo-powered.atlassian.net/browse/BA-219)); the stored `skills` list stays, derived from the links.

#### 1.14.5 — Edit built-in skills in the app ([BA-218](https://halo-powered.atlassian.net/browse/BA-218))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.5/](evidence/1.14.5/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** every skill can be changed from the app, the built-in ones included, without breaking the pipelines that fill their templates.
- **Scope:** ADR-0023; the skills library's Built-in section; a built-in skill editor (description, body, the built-in's own files; no files added or removed); org-wide overrides in a shared `skill_overrides` collection, resolved per call over every other level; the folder-override checks (placeholders kept); **Modified** chip, **Reset to built-in**, and a notice when the shipped built-in changed; `edit-policies` to change, Use agents to view.
- **Out of scope:** per-user overrides; version history of an override; editing a built-in's file list.
- **Acceptance:** an API test proves a refused override (a missing placeholder) changes nothing; a recording-stub E2E proves a `curated-knowledge` override's description reaches the plain assistant's catalog and Reset restores the built-in; a user without `edit-policies` can't save; the world-cup evals pass at 100% over 3 runs with no override.
- **Notes:** decisions taken with the user on 2026-10-14: Platform admin only, all three built-ins, applied on Save with Reset as the undo.

#### 1.14.6 — Link skills and tools in an agent's instructions ([BA-219](https://halo-powered.atlassian.net/browse/BA-219))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.6/](evidence/1.14.6/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** the agent's builder writes its instructions and links the skills and tools it should use with `/`, and what is linked is what the agent gets, replacing the checkbox pickers.
- **Scope:** ADR-0024; `[[skill:<name>]]` and `[[tool:<name>]]` in the instructions; a lazy-loaded Tiptap editor with the `/` menu, chips (broken links in a danger colour), **+ Link skill** and **+ Link tool**, counters and hints; the backend derives `tools` and `skills` from the links on every save and ignores the request's lists; refusals `Unknown skill`, `Unknown tool` and the 10-skill cap; links become plain mentions in Block 5; a skill linked by a draft can't be deleted or renamed; legacy agents get a `Tools and skills:` line and a notice; read-only chips on the Prompt template tab; the editor's Tools and Skills checkboxes are removed (replacing the pickers of 1.14.2 and 1.14.4).
- **Out of scope:** linking built-in skills; skills linking skills; replacing the core prompt; a draft-wide link rewrite when a skill is renamed.
- **Acceptance:** unit tests for link parsing, derivation, resolution and the refusals; a recording-stub E2E proves only linked tools are offered, a linked skill reaches the catalog and the model never sees `[[`; `/` inside a word doesn't open the menu; the plain assistant's prompt is byte-identical; the world-cup evals pass at 100% over 3 runs.
- **Notes:** design in [docs/plans/BA-213/ba-219-221-design.md](docs/plans/BA-213/ba-219-221-design.md), applying the agent-poc *Agent configurator guide* on this app's architecture. Rules R43, R55, R60, R72, R81-R86.

#### 1.14.7 — Skills link tools ([BA-220](https://halo-powered.atlassian.net/browse/BA-220))  `✅ Done`
- **Intent:** a skill carries the tools it needs, so an agent that links the skill gets them.
- **Scope:** the skill editor's Body is the link editor, tools only; `Skills can link tools only` and `Unknown tool` refusals; `tools` on `SkillSummary`; the optional tools an agent's linked skills link are added to its selection at call time (Live copies, or the current skills in a preview); in-app `SKILL.md` content served with links resolved and shown as chips on the Skills tab.
- **Out of scope:** links in built-in skill bodies or overrides; skills linking skills.
- **Acceptance:** unit tests for the effective selection (direct links plus skill links, Live copies versus preview); a recording-stub E2E proves a linked skill's tool is offered; `read_file` serves no `[[`.
- **Notes:** depends on 1.14.6. Rules R70, R84, R86.

#### 1.14.8 — Tools library, Graph and LLM Config tabs ([BA-221](https://halo-powered.atlassian.net/browse/BA-221))  `✅ Done`
- **Intent:** the builder sees why each tool is there, how instructions, skills and tools connect, and which model settings the agent runs on.
- **Scope:** the Tools tab of a user agent as the whole library with `Always on`, `Linked` and `Not linked` and where each link comes from; a new Graph tab (SVG, three columns, hover and focus highlight, legend, **Show unlinked**, the four steps of what happens on each message; `buildFlowGraph` as a pure function); the Model tab becomes **LLM Config** (provider, model, API key `Set` or `Not set`, max output tokens, reasoning effort; never the key); `toolLinks` and `llm` in the agent detail (api 34).
- **Out of scope:** editing LLM settings from the tab; a graph for built-in agents.
- **Acceptance:** unit tests for the graph layout and `connectedTo`, `toolLinks` and that `llm` never carries the key; Playwright shows the chain instructions to skill to tool, the `Show unlinked` toggle, and `API key Set` without the key.
- **Notes:** depends on 1.14.6 and 1.14.7. Rules R87-R89.

#### 1.14.9 — Agent page as in the reference: Chat Box, editable System Prompt and Skills tabs ([BA-222](https://halo-powered.atlassian.net/browse/BA-222))  `✅ Done`
- **Intent:** the builder works on an agent from one page, as in the agent-poc reference: chat with the draft, edit its instructions in place with links, and manage its skills, without going to the editor or the library.
- **Scope:** ADR-0025; the agent page's tabs in the order Chat Box, System Prompt (was Prompt template), Skills, Tools, Graph, Memory, Evals, LLM Config, ids kept; a **Chat Box** tab (the draft's preview session in the page, `Chat with the draft`, **New chat**; the Official agent shows **Start chat**); the **System Prompt** tab with the core prompt collapsed and fixed and the agent's instructions editable in place (link editor, **+ Link skill or tool**, `Linked:` row, broken-link error, **Save prompt**, unsaved-changes prompt); the user agent's **Skills** tab as the inline skill library (`Linked` and `Not linked` per skill, **New skill**, **Edit**, **Delete** inline, the built-in section); default tab Chat Box (System Prompt for System agents).
- **Out of scope:** editing the core prompt (made editable later by 1.14.11, BA-224); a Chat Box for System agents; changing the agent editor page, which keeps its Instructions field and its Details-panel preview; a skill picker, since links decide what an agent gets.
- **Acceptance:** frontend unit tests for the tab order and default per agent kind, the System Prompt save payload keeping the draft's other fields, the broken-link refusal, the Linked / Not linked chips, the inline skill create, edit and delete calls, **New chat** discarding and recreating the session, and the Official agent's **Start chat**; Playwright covers the Agent editor Feature's new scenarios; `python3 scripts/check-specs.py` passes.
- **Notes:** design in [docs/plans/BA-213/ba-222-223-design.md](docs/plans/BA-213/ba-222-223-design.md). Rules R5, R6, R60, R61, R63, R86, R90-R96; UI 4.5, 4.5.8-4.5.10. Depends on 1.14.6 and 1.14.8.

#### 1.14.10 — Skills reach the model through Mastra's skill tool ([BA-223](https://halo-powered.atlassian.net/browse/BA-223))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.10/](evidence/1.14.10/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** the assistant gets its on-demand skills the way the agent-poc reference does, through the framework's `skills` and skill tool, so the app no longer maintains its own catalog, file reader and script runner.
- **Scope:** ADR-0025 (supersedes ADR-0020); the assistant's `skills` function resolved per request: the built-in on-demand skills with an in-app override's content, plus, for a call bound to a user agent, the agent's in-app skills (Live copies, or current ones in a preview), each a `createSkill` with links resolved and reference files as `references`; user and project folder skills given the same way until BA-211; removed: the app-rendered `## Skills` section, `read_file`, `run_skill_script`, the `/in-app-skills/` paths; the prompt is identity, `## Tools`, `## Working rules`; the golden fixture and agents.md Appendix A regenerated; the recorded-request E2E scenarios updated.
- **Out of scope:** the harness-loaded skills (`deep-analysis`, `interactive-visuals`), which keep their system messages; a skill script runner; workspace skills.
- **Acceptance:** unit tests for the skills resolved per call (plain, with an override, with an agent, links resolved, references present), `getInstructions()` with no `## Skills`, the tools without `read_file` and `run_skill_script`, and the golden regenerated and stable; the recording-stub E2E scenarios of "Skills the assistant is given" and the agent editor pass; the world-cup evals pass at 100% (every case 3 runs, all 3 passing) on `claude-sonnet-5`, base commit versus branch, same data dir.
- **Notes:** design in [docs/plans/BA-213/ba-222-223-design.md](docs/plans/BA-213/ba-222-223-design.md). The exact tool names Mastra 1.66 provides are recorded in agents.md 3.9 by the implementation. 1.14.4's `read_file` and virtual paths, and 1.13.9's `## Skills` section, are superseded by this story.

#### 1.14.11 — Edit every agent's System Prompt, built-in agents included ([BA-224](https://halo-powered.atlassian.net/browse/BA-224))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.11/](evidence/1.14.11/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** every agent's System Prompt is editable from its page, as in the agent-poc reference: user agents already edit their instructions (1.14.9); a Platform admin can now edit the Official assistant's prompt and the five System agents' prompts too.
- **Scope:** ADR-0026; a shared `agent_prompt_overrides` collection keyed by registry key and resolved per call, so a save applies to the next call of every session, user agent, deep analysis, visual, SQL fix and verification, knowledge bootstrap and eval run; endpoints `PUT` and `DELETE /agents/:key/prompt` (`edit-policies`) and `prompt` on the agent detail; the System Prompt tab of a built-in agent with **Edit**, **Save prompt**, **Cancel**, **Reset to built-in**, the `Modified` chip, the warning banner and the drift notice; the assistant's editor is the tool-only link editor (links are mentions, never `[[skill:…]]`), a System agent's a plain text area; the assistant's `## Tools` section stays generated and is inserted before `## Working rules`; the override must start with the identity line; built-in on-demand skills (`curated-knowledge`) can be linked as mentions in the assistant's prompt and in user agent instructions (refusal `Only built-in skills can be linked here: this prompt is shared by every user`); the Official assistant's System Prompt view shows chips, a generated-Tools note and a collapsed `Prompt as sent to the model`, and its Graph shows its prompt's links; the shipped assistant prompt links its tools and `curated-knowledge` (the prompt text changes, so the evals run at the gate, see [docs/plans/BA-213/ba-224-linked-prompt.md](docs/plans/BA-213/ba-224-linked-prompt.md)).
- **Out of scope:** per-user overrides; version history of an override; editing a user agent's instructions (1.14.9); a Chat Box for System agents; changing an agent's tools, output schemas or guards, which stay in code.
- **Acceptance:** unit tests prove that with no override every prompt is byte-identical (the golden prompts pass untouched), that a save reaches the next call, the `## Tools` insertion with and without `## Working rules`, links resolved, the BA-217 replacements only on verbatim blocks, every refusal in order, Reset, `builtInChanged`, `edit-policies` on both routes, and that evals, the designer, the fixer and the bootstrap resolve the override; frontend unit tests cover Edit, Cancel, Save prompt, Reset, permission gating, the link editor versus the text area, the drift notice and the unsaved guard; the world-cup evals pass at 100% (every case 3 runs, all 3 passing) with no override; `python3 scripts/check-specs.py` passes.
- **Notes:** design in [docs/plans/BA-213/ba-224-design.md](docs/plans/BA-213/ba-224-design.md). Rules R6, R46, R91, R92 change and R97-R104 are new in [agents-evals](specs/capabilities/agents-evals/spec.md); data-model 3.10.3; api 34, 103, 104; agents.md 1.1, 2.1-2.6, 9; ui.md 4.5.11. Narrows 1.14.9's "Out of scope: editing the core prompt". Depends on 1.14.9 and follows 1.14.5's override pattern.

#### 1.14.12 — ADRs, epic amendment and specs for the RFP Builder and the Intellify RFP API ([BA-225](https://halo-powered.atlassian.net/browse/BA-225))  `✅ Done`
- **Intent:** the RFP work is decided and specified before any code: where the API lives, how the agent reaches it, how sessions bind to a built-in agent, and what the package is.
- **Scope:** ADR-0027 and ADR-0028; the BA-213 epic amendment (scope, narrowed out-of-scope, stories, specs touched, acceptance) re-confirmed by the user; the new `rfp` capability spec with its Rules and Gherkin; the api.md 2.16 contract, the data-model `rfp` schema, agents.md 2.8 and 3.10, the glossary terms and the README row.
- **Out of scope:** code.
- **Acceptance:** the user confirms the amended epic spec and both ADRs; `python3 scripts/check-specs.py` passes with the new capability (its Feature marked `E2E: none yet` until 1.14.16).
- **Notes:** plan in [docs/plans/BA-213/rfp-builder-plan.md](docs/plans/BA-213/rfp-builder-plan.md), confirmed by the user on 2026-10-14 with its defaults.

#### 1.14.13 — The Intellify RFP API: read endpoints, auth, OpenAPI, embedded start and Testing Data registration ([BA-226](https://halo-powered.atlassian.net/browse/BA-226))  `✅ Done`
- **Intent:** the Intellify data is reachable through a REST API we own, from the app and from any client with the key.
- **Scope:** `backend/src/intellify-api/` as a second NestJS app (ADR-0027); `INTELLIFY_*` configuration; `X-API-Key` guard; the error shape; `GET /health`, `GET /openapi.json`; the collection routes (clients, products, funding-types, plan-types, carriers, plan-designs, policies, financials, census) and the per-client routes (client, renewals, program, plans/{id}, financials, census, commercials, wizards) in READ ONLY transactions; embedded start from `createApp()` with `INTELLIFY_API=off`, CLI flags and banner line, the key file; `npm run intellify-api`; the `intellify-api` self-registering REST fixture and its card; the E2E fixture's port variable; `backend/test/intellify-api.e2e-spec.ts` for the reads.
- **Out of scope:** RFP records and the package (1.14.14); the agent (1.14.15).
- **Acceptance:** with the Intellify sample loaded, `GET /v1/clients/IC100100/program` answers the client's plans with carriers and 2026 premiums; Discover on a REST datasource at the API URL proposes the 10 collection endpoints; registering the fixture yields the "Intellify RFP API" datasource and dataset with 10/10 entities; the plain assistant answers "How many clients are there?" over that dataset.

#### 1.14.14 — RFP records and the RFP package in the API ([BA-227](https://halo-powered.atlassian.net/browse/BA-227))  `✅ Done`
- **Intent:** an RFP's decisions are saved and resumable, and the package is a deterministic projection of the record.
- **Scope:** the `rfp` schema and migrations (data-model 7); `POST/GET/PATCH/DELETE /v1/rfps`, the four `PUT` list routes, the bulk delete by creator; status and stage rules; `document.md`, `document.pdf` (pdfkit), `exhibits/*.csv`, `package.zip`; API e2e scenarios for the records and the package.
- **Out of scope:** the agent's tools (1.14.15); snapshots at issue time.
- **Acceptance:** the API Feature's record and package scenarios pass; a reseed of the `intellify` schema leaves drafts intact; the PDF opens and carries every section of the Markdown.

#### 1.14.15 — The RFP Builder agent: prompt, skill, tools, hub and sessions ([BA-228](https://halo-powered.atlassian.net/browse/BA-228))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.15/](evidence/1.14.15/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** a consultant starts a chat with the RFP Builder from the hub and is walked through the seven stages, with every decision saved through the API.
- **Scope:** the `rfp` agent (ADR-0028) with its editable prompt and generated `## Tools`; seven stage skills, one per stage (`rfp-client-renewal` … `rfp-package`; split on 2026-10-14 from a single `rfp-process` skill with seven reference files); the 19 RFP tools plus `ask_clarification`, resolving the API through the session's REST datasource; `kind: official`, Start chat over the fixture's dataset, `agentKey` on sessions, the per-agent turn, Block R1, `rfpId` on the session; the `rfp` eval set and the harness running a set's agent; agents.md 2.8/3.10, agents-evals and sessions-chat rules.
- **Out of scope:** the package tool and card (1.14.16); SQL tools for the agent; per-user RFP access.
- **Notes (2026-10-15):** the `rfp` eval set grew from 8 to 28 cases (agents.md 8.1): custom checks with their own ids (tool arguments, call order, the record read back), case setups that start from a saved RFP named as the active one, earlier turns, a session bound to the RFP Builder and clean-up after every case (the API's eval clean-up now removes an eval run's records whatever their status, api.md I29). The new cases led to prompt rules (stated decisions are saved at once, data questions answered directly, no save claimed without a tool, `update_workflow` without steps and with a short todo, the panel's table kind), a `## Start` step in every stage skill, the list tools returning `total`, and clearer `get_client_commercials` wording; on `claude-sonnet-5` the final version passed 28/28 once; the 3-run gate is still open (the provider account ran out of credit during the second run).
- **Acceptance:** the hub shows RFP Builder under Official with Start chat; a session created from it runs the agent (its first request offers no `run_readonly_sql`); the `rfp` eval set passes at 100% over 3 runs on `claude-sonnet-5` (and the world-cup set stays at 100%, the assistant's golden prompt test unchanged); a recording-stub E2E proves the skill catalog carries the stage skills and the system message carries Block R1.

#### 1.14.16 — The RFP package from the chat ([BA-229](https://halo-powered.atlassian.net/browse/BA-229))  `✅ Done`
- **Intent:** the consultant gets the RFP document and exhibits from the chat without leaving the app.
- **Scope:** `export_rfp_package` through the tool-services bridge (`modules/rfp-packages`); files under the session workspace `rfp/<rfpId>/`; the `rfp-package` stream event and `rfpPackage` on the answer; `GET /sessions/:id/rfp-packages/:rfpId/download[?file=]`; the package card; the draft export at any stage (`export_rfp_draft`, `draft=true` on the Intellify package route and on the download route, the `draft/` workspace folder, the `Draft` chip and `Download draft (.zip)`; RFP R16); the `RFP builder` Playwright Feature (all scenarios) and evidence.
- **Out of scope:** editing the package in the app; emailing it.
- **Acceptance:** the Feature's scenarios pass on the web target with the LLM stub; the downloaded zip holds `rfp.md`, `rfp.pdf`, four CSVs and `manifest.json`; a draft exported at any stage downloads as a zip whose document title starts with `DRAFT — `, whose manifest has `draft: true` and the stage, never overwrites the final package, and shows `RFP package (draft) · 7 files` with a `Draft` chip; `check-specs.py`, unit tests, builds and the impacted E2E specs are green.

#### 1.14.17 — Visuals follow the app's Light and Dark theme ([BA-230](https://halo-powered.atlassian.net/browse/BA-230))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.17/](evidence/1.14.17/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** a visual looks like the rest of the app: light in the Light theme, dark in the Dark theme, instead of always a dark block.
- **Scope:** the readable frame's colours become tokens with a Light and a Dark value (visuals R40); the frame's `data-theme` attribute, written by the visual panel before the document loads and switched in place by a `qti-theme` message when the app theme changes; the chart runtime's label colours read the tokens; the designer is told to take its colours from the tokens (`interactive-visuals` skill, `reference/freeform.md`, `reference/spec-mode.md`; the freeform `css` field description); the visuals, agents and ui specs; a Playwright scenario per new Gherkin scenario. Also the "Agentic Hub" banner is reduced from 136 px to 72 px (title 28/36 px; ui.md 1.2), so the session header, the workflow bar and the chat keep the height; the `application-shell` visual baseline is updated at the acceptance gate. And the start page shows a welcome that explains how the product works in four steps, each opening the place it names, with an Explore agents button (app-shell R51, ui.md 4.1), in place of the empty placeholder composer. The New conversation screen gets an Agent picker (Assistant by default, the RFP Builder and the Live agents; the agent's datasets show as read-only chips and Create starts a session bound to it, with the typed name when given; sessions-chat R64, api.md 2.1 #3 optional `name`). The chat and panel text is reduced from 16/24 px to 14/22 px (answers, user messages, "Data used", panel documents; Markdown tables 13 px with 40 px rows; ui.md 3.5, 4.12). The Sessions page lists every session in the middle of the page, with a search field, each row's agent / dataset line, last activity and a Delete session menu; the navigation rail and drawer no longer list sessions, and the drawer's "+" button is gone (app-shell R3, R46, sessions-chat R63, ui.md 1.3, 4.7.1). The app's chrome is made compact (about 20-25 % less vertical space, 2026-10-14): rail 56 / drawer 208 px with 36 px items, 52 px banner, 20 px page titles, 32 px buttons and fields, 40 px panel headers, 8 px gaps; chat and document reading text stays 14 px / 22 px (ui.md 1.2, 1.3, 3.6). The rail's menu button sits beside the "Agentic Hub" title in the drawer (alone above the logo on the collapsed rail).
- **Scope, New conversation Agent picker (BA-230, 2026-10-15):** the native Agent `select` becomes the app's dropdown, a listbox whose options show each agent's name and description, with the reason on a disabled one's second line (ui.md 4.7).
- **Out of scope:** a migration of stored visuals (the panel rebuilds each document from the stored bundle on every load); rewriting colours a freeform designer hardcoded in its own CSS (known limitation); a theme choice per visual.
- **Acceptance:** a visual opened in the Light theme has a light frame and chart, and in the Dark theme a dark one; switching Appearance with a visual open re-themes it without reloading (its state, hover and filters survive); a visual made before the change opens themed; the downloaded `index.html` follows the operating system's setting; the visual evals pass at 100% over 3 runs on the branch.
- **Notes:** the visual evals are required because the designer skill and the freeform schema change what the designer agent receives (workflow step 9). Decisions by the user on 2026-10-14: the visual follows the app theme; existing visuals are re-themed when viewed.

#### 1.14.18 — Agents choose what the right panel shows ([BA-231](https://halo-powered.atlassian.net/browse/BA-231))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.18/](evidence/1.14.18/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** an agent can put the thing the user wants to read, sort or download beside the chat (a document, a file, a query result, a visual, its progress through a workflow), and what it showed is still there when the session is reopened.
- **Scope:** one built-in tool `show_in_panel`, always on for every agent (the assistant, the RFP Builder, every user agent), with four kinds: `file`, `document`, `table`, `visual` (a fifth, `phases`, was removed on 2026-10-14, see the last Scope item); panel items saved on the session with the visuals in the same history (ADR-0029); the `## Workflow` prompt convention and its parser, so the tracker shows every phase from the first turn; the current-phase card (a note from the `phases` call, shown under the current phase) so the agent guides the user through its process, cleared by the RFP stage auto-drive when the phase changes; the RFP Builder's stages under `## Workflow`, its saved stage driving the tracker and its package document shown after export; the `panel-item` stream event; `GET /sessions/:id/panel-items/:itemId/file` and `.../download`; the right panel becomes the Session panel (item views, shown-items menu, Download button, empty state); the new capability [agent-panel](specs/capabilities/agent-panel/spec.md) and its cross-links; the assistant's and RFP Builder's prompts and the `rfp-package` skill; the session id in the page header with a copy button (sessions-chat R62), so a user can share it to diagnose a session; the Markdown prose styles made global so panel documents render like chat answers; the workflow status bar (added 2026-10-14): a second always-on tool `update_workflow` (`steps`, `current`, `done`, `skipped`, `waiting`, `note`, `todo`) with which the agent creates and updates the steps (fixed when the prompt has a `## Workflow` section, agent-defined otherwise), one workflow state shared with `show_in_panel` kind `phases` and the RFP auto-drive, the `workflow` stream event, and the bar pinned under the page header above the chat (statuses, `n/m done`, the note, fold persisted per browser, step popover, narrow layout) with the assistant's Workflow prompt block and the RFP Builder's Process rule; what the user must do in each open step (added 2026-10-14): a default action on each `## Workflow` line (`: <action>`), overridden by the agent's `todo`, shown in the bar as `Your next step:`, in the open steps' tooltips and popover and in the tracker; the `Agent panel` Playwright Feature and evidence. Design: [docs/plans/BA-213/ba-231-design.md](docs/plans/BA-213/ba-231-design.md). While a turn streams, a skill step names the skill it uses (`Using skill: <name>`, `Reading skill file: …`, `Searching skills: …`), and every tool step shows its input from the moment the call starts (the `tool` event carries `input`).
- **Scope, panel history and bar polish (2026-10-15):** a visual's header drops its own saved-visuals menu (visuals are switched through "Shown in this session"), and the workflow bar shows done and skipped steps icon-only, then fades its right edge, when the steps overflow (ui.md 4.12.1, 4.13).
- **Scope, the workflow lives only in the bar (2026-10-14):** `show_in_panel` loses the kind `phases` and its `current`, `done` and `note` inputs; the RFP stage auto-drive and `update_workflow` update the workflow state and send the `workflow` event only (no `phases` panel item, no `panel-item`); a stored `phases` item is dropped when the session is read; the Session panel has no tracker view and never opens on a workflow; the workflow bar gets a `Details` dropdown (`Workflow details`) and its second row shrinks to one line `Your next step: <action>` (Details opens on the current step, its note included; the `Note` link was dropped on 2026-10-15 as redundant with Details); the `workflow-tracker` component is deleted.
- **Out of scope:** editing a shown document in the panel; rendering `.csv` files as tables (they show as monospace text); a `table` item built from an earlier turn's results; a per-agent choice to turn the tool off; binary files (PDF, images).
- **Acceptance:** the `Agent panel` Feature's scenarios pass on the web target with the LLM stub; a composed document downloads as `.md` and a table as `.csv`; an invalid path is refused with the tool's error; shown items survive reopening the session; the workflow shows only in the bar and never in the right panel (no `phases` kind, no tracker, no `panel-item` for a workflow change), the bar's `Details` dropdown lists every step with the agent's note under the current one and closes on Escape, an outside click and its button, and the next-step row is one line; the workflow bar shows an agent's `## Workflow` steps from the first turn, an `update_workflow` call moves it live (statuses, `n/m done`, waiting and note), an agent without a section can create its own steps but cannot rename the prompt's (the exact error), and the bar folds and stays folded across a reload; the `world-cup`, `formula-1` and `rfp` eval sets pass at 100% over 3 runs on the branch (the assistant's and the RFP Builder's prompts, tools and skill change); `check-specs.py`, unit tests, builds and the impacted E2E specs are green.
- **Notes:** decisions by the user on 2026-10-14: one built-in tool, always on for every agent; it shows a workspace file, a Markdown document, a query result table, an existing visual and workflow phases; phases come from a `## Workflow` section of the prompt; everything shown is saved per session. Defaults taken: the RFP Builder's saved stage also drives the tracker; `table` references this turn's query results only. Watch the `rfp-skill-first` eval case (a `phases` call before the stage skill would break its tool order).

#### 1.14.19 — Single-user app: remove authentication and authorization, keep only the super admin ([BA-232](https://halo-powered.atlassian.net/browse/BA-232))  `✅ Done`
- **Intent:** the app is for one person, so it opens straight into the shell with no sign-in and every feature is available; nothing about users, roles or permissions remains to configure, explain or pay for on every request.
- **Scope:** ADR-0030; one built-in super admin (id `local`) is always the caller; removed: the sign-in page, `/me`, `/auth/*`, `/scim/*`, `/admin/*`, roles, permissions and the permission guard, the Origin check and cookies, `ORG_*` configuration, org server mode (Entra ID, SCIM), local personas, the Admin area, data owner, ownership transfer, sharing and the "Yours" / "Shared with you" filters, the account menu and avatar; migration M14 consolidates every owned document under `local`, renames the UI-preference and pin keys, drops the seven identity collections and renames clashing skills; `ownerId` stays as an inert attribute; the desktop readiness probe goes back to `GET /sessions`; the CLI banner loses `Mode:`; the `org` Playwright project, `test:e2e:org` and the org and local-sign-in specs are deleted; the Admin capability spec is deleted and every other spec is rewritten for one user.
- **Out of scope:** any replacement access control (the host is the boundary); changing the desktop backend's bind address (kept by the user's choice); a way back to multi-user (needs a new ADR).
- **Acceptance:** the app opens straight into the shell with no sign-in page, no account menu and no Admin rail item; every area and Settings section is reachable and Reasoning effort is always shown; sessions, agents, skills, knowledge, metrics and verified queries owned by any user are listed after opening an old data dir, and `app.sqlite` has no `users` table; `grep -rn "ORG_\|RequirePermission\|CurrentUserService\|auth.can\|/me'" backend/src frontend/src` is empty; the `navigation.spec.ts` scenario "opens as the super admin" passes; `check-specs.py`, unit tests, builds and the impacted E2E specs are green. No eval gate: nothing an agent receives changes.
- **Notes:** asked on 2026-10-14: "No just leave the super admin user remove everything related to authentication and authorization". Decisions: single user, no sign-in; Admin area removed entirely; other users' data reassigned to the super admin; the super admin's name appears nowhere (agents keep "Owner: You"); the desktop bind is unchanged and the ADR states the exposure (anyone who reaches the port has full access). Design: [docs/plans/BA-213/ba-232-design.md](docs/plans/BA-213/ba-232-design.md).

### Milestone 1.15 — US Health demo ([BA-233](https://halo-powered.atlassian.net/browse/BA-233))

The app is shown to the US Health practice as its own hub: the banner reads "US Health Agentic Hub", and the Agent Hub presents four further use cases as Official showcase agents (Benchmarking, Survey, LAD COE and Strategy; Benchmarking added on 2026-10-15) that can be read and edited but cannot chat yet, in an Official section that always shows every card. Builds on Milestone 1.9 (the Agent Hub, ADR-0008) and Milestone 1.14 (built-in prompt overrides, ADR-0026). No ADR: the showcase agents are ordinary registry entries. All stories are built on the branch `feat/BA-233-us-health-demo` and ship as one PR. Epic spec: [specs/epics/BA-233/spec.md](specs/epics/BA-233/spec.md).

#### 1.15.1 — Banner reads "US Health Agentic Hub" ([BA-234](https://halo-powered.atlassian.net/browse/BA-234))  `✅ Done`
- **Intent:** the hub introduces itself as the US Health practice's own when it is demoed.
- **Scope:** the top banner, the page's only level-one heading, reads "US Health Agentic Hub" instead of "Agentic Hub" (app-shell R7, ui.md 1.2); the "Shows the product name" scenario checks the new heading; the `application-shell` web baseline is refreshed at the acceptance gate.
- **Out of scope:** renaming the product: the window and document title (R33), the drawer label beside the menu button, the welcome heading "Welcome to Agentic Hub" (R51), the Settings build identity "Agentic Hub v…" (R32), the operating-system app name and the installers stay as they are; any other size or layout change of the banner.
- **Acceptance:** the banner's `h1` reads "US Health Agentic Hub" while the document title, the welcome heading and the Settings footer still read "Agentic Hub"; the `layout-accessibility.spec.ts` scenarios pass on the web target with the refreshed `application-shell-web-linux.png`; `check-specs.py`, frontend unit tests and builds are green.
- **Notes:** confirmed by the user on 2026-10-15. The desktop baseline is not regenerated unless a desktop run is requested.

#### 1.15.2 — Showcase agents: Survey, LAD COE and Strategy ([BA-235](https://halo-powered.atlassian.net/browse/BA-235))  `✅ Done`
- **Intent:** the Agent Hub shows the US Health practice four further use cases it recognises, all visible at a glance, each with a description and a system prompt to read and discuss, without pretending they can already chat.
- **Scope:** four built-in Official agents in the registry, `benchmarking` (id `benchmarking-agent`, "Benchmarking Agent", added on 2026-10-15), `survey` (id `survey-agent`, "Survey Agent"), `lad-coe` (id `lad-coe-agent`, "LAD COE Agent", Life, Absence and Disability Center of Excellence) and `strategy` (id `strategy-agent`, "Strategy Agent"), with no tools, dataset, skills or evals and the model resolved like every agent's but never called (agents.md 2.9); `GET /agents` lists them as `kind: "official"`, owner `Official`, with `showcase: true` and `chatRequirement` `Showcase agent: not available to chat yet.` (api.md 33); the hub card shows a `Showcase` chip (title = the reason) and **Start chat** disabled with the reason as its title, on the card and in the detail header (which also shows the reason as text); their page has no Chat Box tab, opens on the System Prompt tab and shows the description and an editable System Prompt (ADR-0026, plain text, no links); in the hub they come after the agents that can chat, and (added 2026-10-15) the Official section always shows every card, with no `Show more` (agents-evals R3); the New conversation Agent picker lists them disabled with the reason; `POST /sessions` with a showcase key is refused with the reason, creating nothing (agents-evals R106, sessions-chat R52, R64).
- **Out of scope:** a working chat for the showcase agents; datasets, skills or evals for them; renaming the product, the window title or the installer; any change to the assistant's or the RFP Builder's prompts.
- **Acceptance:** the Agent Hub scenarios "The showcase agents are Official cards that cannot chat yet" and "A showcase agent's page shows its description and System Prompt" (`agent-hub.spec.ts`) and the Session management scenario "The Agent field lists the showcase agents disabled" (`session-management.spec.ts`) pass on the web target, with all four showcase agents shown, after the assistant and the RFP Builder, and the existing Agent Hub scenarios updated for an Official section that shows every card with no `Show more`; a backend unit test proves the catalogue entry and the session refusal; `check-specs.py`, backend and frontend unit tests, lint and builds are green. No eval gate: what the assistant and the RFP Builder receive is unchanged.
- **Notes:** confirmed by the user on 2026-10-15. Scope extended by the user on 2026-10-15: the Benchmarking Agent, and the Official section always expanded; the Jira story keeps its key and title. The descriptions and prompts are `SHOWCASE_AGENTS` and `BENCHMARKING_PROMPT`, `SURVEY_PROMPT`, `LAD_COE_PROMPT`, `STRATEGY_PROMPT` in `backend/src/mastra/agents/showcase-catalog.ts`, copied verbatim into agents.md 2.9. Open: "LAD" is read as Life, Absence and Disability.

## Release 2 — Multi-user  (no target date yet)

The app becomes multi-user. An organisation self-hosts it as an org server, with sign-in, roles and an admin panel. Local mode stays the default. Direction: [specs/product/vision.md](specs/product/vision.md). Not part of the 1.0 Beta.

### Milestone 2.1 — Admin Panel ([BA-161](https://halo-powered.atlassian.net/browse/BA-161))

Undone by 1.14.19 (ADR-0030); its features stay as shipped history. Org server mode with Entra ID sign-in, SCIM directory sync and five roles enforced by the backend. Datasources and datasets are shared across the organisation, and everything else is private to its owner. Platform admins get an admin panel with Overview, Users & groups, Edit a user, and Roles & permissions (Figma board *Agent Hub — E2E lifecycle (proposed)*, screens P1–P4). Requests, Registry, Policies and Audit log are out. Stories 2.1.1–2.1.6 were built on the branch `feat/BA-161-admin-panel` and shipped as one PR (#69). The follow-up 2.1.7 ships on a new `feat/BA-161-admin-panel` branch and PR, opened after PR #69 merged. Epic spec: [specs/epics/BA-161/spec.md](specs/epics/BA-161/spec.md). Decision: ADR-0010 in [specs/system/architecture.md](specs/system/architecture.md).
- **Notes:** Evidence: [evidence/1.13.5/](evidence/1.13.5/).

#### 2.1.1 — ADR, epic spec, vision and roadmap ([BA-162](https://halo-powered.atlassian.net/browse/BA-162))  `✅ Done`
- **Intent:** the move to multi-user is decided and scoped before any code, so each later story can be built and reviewed on its own.
- **Scope:** ADR-0010 in `specs/system/architecture.md`; the vision rewritten for local and org server modes; the BA-161 epic spec; this release and milestone, with one feature per story; the epic row in `specs/README.md`.
- **Out of scope:** product code, and changes to the capability, system, non-functional or glossary specs for behaviour that hasn't shipped. Each later story updates those itself.
- **Acceptance:**
  - ADR-0010 records the two modes, OIDC with Entra ID, SCIM inbound, server-enforced roles, per-user ownership and SQLite.
  - `vision.md` no longer says "Not multi-user", and describes both modes.
  - The user has confirmed `specs/epics/BA-161/spec.md` (`Status: Confirmed`), and ADR-0010 is `Accepted`.
  - `python3 scripts/check-specs.py` passes.
- **Notes:** decisions taken with the user on 2026-10-10: real multi-user; screens P1–P4 only; the organisation self-hosts; local mode stays; only datasources and datasets are shared; SQLite everywhere. The branch was renamed from the desktop app's worktree branch. Milestone 1.10 belongs to BA-159's branch, so this work is in Release 2. Further decisions on 2026-10-10: show the last SCIM sync instead of a Sync button; only Platform admins manage datasources and datasets (a tenth permission); one org-wide LLM configuration. The user confirmed the epic spec and ADR-0010 on 2026-10-10. Evidence: [evidence/2.1.1/](evidence/2.1.1/).

#### 2.1.2 — Sign-in with Entra ID, directory sync, roles and enforcement ([BA-163](https://halo-powered.atlassian.net/browse/BA-163))  `✅ Done`
- **Intent:** on an org server, people sign in with their company account and can only see and do what their role allows.
- **Scope:** org server mode configuration; the org-wide LLM configuration, which only Platform admins can change; Platform-admin-only management of datasources and datasets; OIDC sign-in and sign-out with a backend session cookie; the sign-in page; SCIM 2.0 Users and Groups endpoints; just-in-time users; the five roles, the permission matrix and group-to-role mappings resolved per request; a global permission guard on every route; `GET /me`; `ownerId` scoping on private collections and memory; the rail avatar showing the signed-in user; an Admin rail item for Platform admins; local mode unchanged.
- **Out of scope:** the admin screens (2.1.3–2.1.6); a desktop app as a client of an org server; other identity providers.
- **Acceptance:** a Playwright org-server project signs in through a local OIDC stub, and sign-out works; two users can't reach each other's private data through the UI or the API; a User gets 403 on Maker and admin endpoints; SCIM create, update and deactivate change the directory; the existing local-mode suite passes unchanged.
- **Notes:** ADR-0010 and ADR-0011. Plan: [docs/plans/ba-163-org-server-foundation.md](docs/plans/ba-163-org-server-foundation.md) (five slices, S1–S5). Highest-risk part: owner scoping on every repository. Decisions taken with the user on 2026-10-10: bootstrap admins from `ORG_BOOTSTRAP_ADMINS`; an eleventh permission, *Manage LLM configuration*; the composer's Reasoning effort is hidden from non-admins; the exact P4 matrix is in the plan (Approver also holds *View audit log*). Coordinate the org-wide LLM configuration with BA-159. E2E runs against a per-worktree World Cup database from the infra MCP service (baseline: 68 passed, 2 skipped). Also decided on 2026-10-10: sign-in matches users by token subject, then UPN, never by the `email` claim; bootstrap admins are UPNs; the issuer must name one tenant; a UPN now held by a different subject is refused, and SCIM gives a departed user's name to a new record; UI preferences are per user on an org server. Shipped: org Playwright project 16 passed; web suite 77 passed, 2 skipped; backend API 179 passed. Desktop not run. Evidence: [evidence/2.1.2/](evidence/2.1.2/).

#### 2.1.3 — Admin overview (P1) ([BA-164](https://halo-powered.atlassian.net/browse/BA-164))  `✅ Done`
- **Intent:** a Platform admin sees at a glance how the org server is used and what needs attention.
- **Scope:** tiles for active users (30 days) and agents live; Needs attention rows (agents without an active owner → Assign, agents with errors in 7 days → Inspect, inactive Makers → Clean up), each action opening a dialog (Assign an owner, Agents with errors, Inactive makers); a Weekly active users chart (8 weeks); Recent activity (10 events); Export report (CSV); the admin panel frame, its tab bar and per-tab header actions; recording `agent.turn-failed`, `agent.transferred` and `mapping.*` activity events; `GET /admin/overview` and its CSV export (api 81, 82). Rules: admin R35-R48.
- **Out of scope:** the publish-request and data-access-request tiles and rows (Requests epic).
- **Acceptance:** the Feature "Admin overview" (`frontend/e2e/org-admin-overview.spec.ts`) passes: it seeds activity and checks each tile, each Needs attention row and its dialog, the chart's data, Recent activity, the CSV export, the empty states, the 403 for a non-admin and the axe scan in both themes.
- **Notes:** depends on 2.1.2, and reads data from 2.1.4–2.1.6. Built last. Decided 2026-10-10: an agent error is a turn in a session started from the agent that ended in an error; Inspect is read-only (admins can't open private sessions); Clean up removes only directly assigned Maker roles. Shipped: 7 Playwright scenarios; Overview figures and the CSV covered by `backend/test/org-admin.e2e-spec.ts`. Desktop not run. Evidence: [evidence/2.1.3/](evidence/2.1.3/).

#### 2.1.4 — Users & groups (P2) ([BA-165](https://halo-powered.atlassian.net/browse/BA-165))  `✅ Done`
- **Intent:** a Platform admin finds any user or group and sees their roles, groups, agents and activity.
- **Scope:** Users and Groups tabs with counts; search over name, email and group; role filter chips; a users table (name and email, roles, IdP groups, agents owned, last active, status); a groups list with members and mapped roles; pagination (25 a page); the last-sync note from the last SCIM request; the Assign role dialog; `GET /admin/users` and `GET /admin/groups` (api 83, 87). Rules: admin R39, R49-R57.
- **Out of scope:** editing users or groups from the directory (they are read-only); a Microsoft Graph pull sync.
- **Acceptance:** the Feature "Users and groups" (`frontend/e2e/org-admin-users.spec.ts`) passes: search, each filter chip, pagination, the Groups view, Assign role and the statuses (Active, Inactive, Not signed in, Deactivated) over SCIM-seeded users; the 403 for a non-admin; the axe scan in both themes.
- **Notes:** depends on 2.1.2. No "Sync from Entra ID" button (decided 2026-10-10). Also decided: a fourth status, Deactivated. Shipped: 8 Playwright scenarios plus the completed "A bootstrap admin sees the Admin area" scenario; the admin API tests (`org-admin`, `response-status`). Desktop not run. Evidence: [evidence/2.1.4/](evidence/2.1.4/).

#### 2.1.5 — Edit a user (P3) ([BA-166](https://halo-powered.atlassian.net/browse/BA-166))  `✅ Done`
- **Intent:** a Platform admin changes what one person can do, and hands their agents to someone else.
- **Scope:** a detail panel next to the users list, with a Close button, showing identity and status, role checkboxes with their descriptions (Data owner picks a datasource), read-only groups, agents owned with their status, Transfer ownership and Save changes; a role from a group mapping or the bootstrap list is shown ticked and disabled with its reason; an admin can't remove their own Platform admin role; `GET /admin/users/:id`, `PUT /admin/users/:id/roles` and `POST /admin/agents/transfer` (api 84-86). Rules: admin R58-R64.
- **Out of scope:** deactivating users (the directory does that).
- **Acceptance:** the Feature "Edit a user" (`frontend/e2e/org-admin-edit-user.spec.ts`) passes: it assigns and removes roles and checks that the user's permissions change on their next request; Data owner with a datasource; group-mapped and own-admin roles disabled; transfers an agent and checks that the new owner sees it; a name clash refused; the empty states; the 403; the axe scan in both themes.
- **Notes:** depends on 2.1.4. The transfer endpoint is also used by Overview's Assign (2.1.3). Decided 2026-10-10: an admin can't remove their own Platform admin role; a transferred agent acts as deleted in its former owner's sessions, its pin resets, and a name clash is refused (409). A Data owner role whose datasource was deleted grants nothing and shows as "Data owner · datasource removed". Saving is all-or-nothing through a new store transaction (data-model 2.4). Shipped: 9 Playwright scenarios. Desktop not run. Evidence: [evidence/2.1.5/](evidence/2.1.5/).

#### 2.1.6 — Roles & permissions (P4) ([BA-167](https://halo-powered.atlassian.net/browse/BA-167))  `✅ Done`
- **Intent:** a Platform admin sees what each role can do and lets directory groups grant roles automatically.
- **Scope:** the read-only permission matrix of the five roles and eleven permissions; the list of Entra ID group → role mappings, with the Add mapping dialog (Data owner picks a datasource) and remove with confirmation; `GET`, `POST` and `DELETE /admin/role-mappings` (api 88-90). Rules: admin R65-R68.
- **Out of scope:** Add role, custom roles and editing the matrix.
- **Acceptance:** the Feature "Roles and permissions" (`frontend/e2e/org-admin-roles.spec.ts`) passes: it checks the matrix, adds a mapping and checks that a member of the group gets the role, removes it and checks that the role is gone, a Data owner mapping, Add mapping disabled with no groups, the 403 and the axe scan in both themes.
- **Notes:** depends on 2.1.2. Shipped: 6 Playwright scenarios; mappings granting and removing roles also covered by `backend/test/org-admin.e2e-spec.ts`. Desktop not run. Evidence: [evidence/2.1.6/](evidence/2.1.6/).

#### 2.1.7 — Local mode: sign in as a seeded persona, roles enforced ([BA-161](https://halo-powered.atlassian.net/browse/BA-161))  `✅ Done`
- **Intent:** local mode and the desktop app show the same roles, ownership and Admin area as an org server, so a person trying the app on one machine can see what each role can do by signing in as a different persona.
- **Scope:** five seeded directory users in local mode (Demo User, Uma User, Mark Maker, Dana Data Owner, Avery Approver) with their roles seeded once and never re-added after an admin removes them; Dana Data Owner made Data owner of every datasource, at startup and when a datasource is created; a local variant of the sign-in page with a **Sign in as** dropdown and no password; a local auth session whose token travels as `Authorization: Bearer` and ends at Sign out or after 30 days; `GET /auth/local/users`, `POST /auth/local/sign-in` and `POST /auth/local/sign-out` (api 91-93); `GET /me` answering 401 when nobody is signed in, in both modes; roles, permissions and owner scoping enforced in local mode exactly as on an org server; migration M13, which gives every item stored before this change to Demo User; the Admin area, the avatar and the account menu in local mode, with local copy where the org copy names Entra ID or SCIM; the desktop app's readiness probe moved to `GET /me`. Rules: admin R2, R10, R11, R18, R21, R33, R34, R36, R40, R54, R60 amended; R69-R74 added; app-shell R4 and R50.
- **Out of scope:** passwords or any other proof of identity in local mode (local mode is not a security boundary); adding or deleting personas; groups and group mappings in local mode; a desktop app as a client of an org server.
- **Acceptance:**
  - The Feature "Sign in to local mode" (`frontend/e2e/local-sign-in.spec.ts`) passes: the sign-in page lists the five personas; Demo User sees the shell and the Admin item; Uma User sees no Maker, data or Admin controls; Mark Maker's agents are private; Sign out returns to the sign-in page; a role change in Admin survives a restart; Dana Data Owner owns every datasource; data from before sign-in belongs to Demo User; the axe scan passes in both themes.
  - The existing web suite passes, signed in as Demo User through the app fixture; the org project passes with no change to its fixture, plus the scenario "An org server never offers the local sign-in".
  - `backend/test/local-auth.e2e-spec.ts` covers the 401s, the three local routes, the seeded roles, the 403s for Uma User, M13, a removed seeded role staying removed after a restart, and Dana's Data owner role on a new datasource.
  - ADR-0012 is recorded; `python3 scripts/check-specs.py` passes.
- **Notes:** follow-up to PR #69, decided 2026-10-11: the local and org approaches are merged (ADR-0012), Demo User (id `local`) keeps all data stored before this change, and its Platform admin role can't be removed. Jira story could not be created (permission denied); story key pending, commits scoped `feat(BA-161)`. ADR-0012. Shipped 2026-10-11: web suite 85 passed / 2 desktop-only skipped, org suite 47 passed, desktop not run. Evidence: [evidence/2.1.7/](evidence/2.1.7/).

## Backlog

Not yet sequenced into a release. The detailed phase plans below predate this roadmap; when work on one resumes, split it into features under a milestone here and link back to the plan.

- Answer reliability — [docs/plans/phase-1-answer-reliability.md](docs/plans/phase-1-answer-reliability.md)
- Trust UX — [docs/plans/phase-2-trust-ux.md](docs/plans/phase-2-trust-ux.md)
- Visual quality + interactivity — [docs/plans/phase-3-visual-quality-interactivity.md](docs/plans/phase-3-visual-quality-interactivity.md)
- Strategic bets — [docs/plans/phase-4-strategic-bets.md](docs/plans/phase-4-strategic-bets.md)
- Agent Routines ([BA-82](https://halo-powered.atlassian.net/browse/BA-82)): an epic in Jira with no description, dates or fix version. Promote it into a release once it's defined.

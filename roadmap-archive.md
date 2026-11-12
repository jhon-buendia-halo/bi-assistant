# Roadmap archive

Milestones whose features are all `✅ Done` or `🚫 Cut`, moved verbatim and in order from [roadmap.md](roadmap.md) by `node scripts/roadmap-archive.mjs` (roadmap 1.23.30). Each keeps a one-line skeleton heading in `roadmap.md`. Never edit a moved entry here except to correct a typo; `qa.mjs`, `demo-page.mjs`, `story-pack.mjs` and `check-specs.py` read both files.

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

### Milestone 0.5 — Faster workflow, repo-only planning (M0-5)

Shorten the time from a request to a merged PR without weakening what the workflow guarantees, and move all planning into the repository (Jira is no longer used). No app behaviour changes. Epic spec: [specs/epics/M0-5/spec.md](specs/epics/M0-5/spec.md). Requested by the user on 2026-11-11 after a review of where the workflow spends time.

#### 0.5.1 — Repo-only planning  `✅ Done`
- **Intent:** planning needs no external system; an epic and its stories live only in the repository.
- **Scope:** epics are roadmap milestones with ID `M<R>-<M>` at the end of the heading and a spec in `specs/epics/<ID>/spec.md`; stories are features. Remove `.claude/tools/jira/`, `.claude/skills/jira/`, `.mcp.json`, the Jira entries in `.claude/settings.json` and `.env.example`. `check-specs.py` checks `(M<R>-<M>)` milestone epics as well as the older `[BA-<n>]` ones. The Epic gate in `CLAUDE.md` and `workflow-start` is repo-only.
- **Out of scope:** renaming the `BA-*` epic folders; rewriting history.
- **Acceptance:** no Jira tooling remains; `check-specs.py` passes and counts M1-22 and M0-5.

#### 0.5.2 — Lighter workflow: sizes, lessons, per-epic records, four skills  `✅ Done`
- **Intent:** small changes stop paying for the full process; the first read of every task is short; records are written once per epic.
- **Scope:** an S / M / L size table in `CLAUDE.md` saying which steps each runs. `lessons.md` (under ~80 lines) becomes the mandatory first read; `retrospective.md` stays the history. One changelog entry and one retrospective per epic. The nine workflow skills become four: `workflow-start`, `workflow-implement`, `verify`, `workflow-gate`. `builder` and `reviewer` set `omitClaudeMd: true`.
- **Out of scope:** tagged lessons and `lessons.mjs` (0.4.8).
- **Acceptance:** the `workflow-steps` mod parses `CLAUDE.md`'s eleven steps; `check-specs.py` checks the links in `lessons.md` and the skills; no reference to a removed skill remains outside history.
- **Notes:** delivers the digest half of 0.4.8 in distilled form.

#### 0.5.3 — Faster QA script  `✅ Done`
- **Intent:** a gate run waits less: independent checks run at once, an up-to-date build is not redone, and worktrees don't queue behind each other without need.
- **Scope:** `qa.mjs` runs the unit suites, lint and `check-specs` in parallel; skips `build:all` when its outputs are newer than its inputs (`--rebuild` forces it); narrows the QA lane lock to what is really shared; `--draft-impact` writes the step-6 list from the diff; `--no-demo` for S changes.
- **Acceptance:** `node --test scripts/qa-lib.test.mjs` passes, with tests for the new pure functions; `tests.md` keeps its content.
- **Notes:** the first gate runs showed Karma's browser tests flaking under the CPU load of Jest and ESLint, so Karma runs alone after them. Two order-dependent frontend unit tests (`UiPreferencesService`, `PromptEditor`) were fixed. Evidence: [evidence/0.5.3/](evidence/0.5.3/).

#### 0.5.4 — Eval bar relative to the base  `✅ Done`
- **Intent:** eval rounds stop chasing model flakiness that the change didn't cause.
- **Scope:** the `verify` skill: three runs per build in parallel on data-dir copies; code checks pass 3 of 3; judged cases pass at least 2 of 3 and no less often than on the base; cases flaky on both builds are listed, not chased.
- **Acceptance:** the skill states the bar; the next agent-input change uses it.

#### 0.5.5 — Workspace bootstrap  `✅ Done`
- **Intent:** a new workspace is ready to build, test and run with one command.
- **Scope:** `scripts/bootstrap.mjs` (install both packages, Playwright's Chromium, build, report Postgres). `.conductor/settings.toml` runs it as the setup script and adds a **web** run action. `@floating-ui/dom` becomes a direct frontend dependency, so `npm ci --legacy-peer-deps` no longer drops it. `setup-local.mjs` loads the Intellify sample into the Intellify RFP API's database (`intellify_mercer_demo`).
- **Acceptance:** `bootstrap.mjs` builds the web UI in a checkout with no `node_modules`; `node --test scripts/setup-local.test.mjs` passes.
- **Notes:** found on 2026-11-11, when a fresh workspace failed to build (`Could not resolve "@floating-ui/dom"`) and the Intellify API could not be registered.

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

### Milestone 1.16 — Data Readiness Agent ([BA-251](https://halo-powered.atlassian.net/browse/BA-251))

A new Official agent assesses how ready a connected Postgres or Databricks datasource is for analysis, using the DMBOK data-quality dimensions. The deterministic engine is ported from the separate `data-readiness-agent` project and owns every score; the LLM only runs the assessment and explains the stored report. Assessments are saved and can be reopened. All stories are built on the branch `feat/BA-251-data-readiness` and ship as one PR. Epic spec: [specs/epics/BA-251/spec.md](specs/epics/BA-251/spec.md).

#### 1.16.1 — Scoring and check engine ([BA-252](https://halo-powered.atlassian.net/browse/BA-252))  `✅ Done`
- **Intent:** part of the Data Readiness Agent (BA-251); see the epic spec.
- **Scope:** the per-dimension score `100 × (1 − Σw/checksRun)`, the overall mean, the maturity bands, and `runAssessment` with the current time injected.
- **Out of scope:** editable thresholds, provenance, false positives, MongoDB and REST sources, rule exports (epic spec).
- **Acceptance:** unit specs reproduce the reference numbers (80, 96, 99, 2; overall 88 Managed); a determinism test passes; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 12 parallel units against a shared contracts scaffold.

#### 1.16.2 — Completeness, validity, consistency and uniqueness checks ([BA-253](https://halo-powered.atlassian.net/browse/BA-253))  `✅ Done`
- **Intent:** part of the Data Readiness Agent (BA-251); see the epic spec.
- **Scope:** the four checks with the reference formulas and severities.
- **Out of scope:** editable thresholds, provenance, false positives, MongoDB and REST sources, rule exports (epic spec).
- **Acceptance:** per-check unit specs cover every severity branch and the checks-run denominator; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 12 parallel units against a shared contracts scaffold.

#### 1.16.3 — Integrity, accessibility, timeliness and reasonability checks, plus join inference ([BA-254](https://halo-powered.atlassian.net/browse/BA-254))  `✅ Done`
- **Intent:** part of the Data Readiness Agent (BA-251); see the epic spec.
- **Scope:** the four checks and join inference, using the injected time.
- **Out of scope:** editable thresholds, provenance, false positives, MongoDB and REST sources, rule exports (epic spec).
- **Acceptance:** per-check unit specs cover every severity branch; join inference covers its naming patterns and the 20-candidate cap; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 12 parallel units against a shared contracts scaffold.

#### 1.16.4 — Golden conformance suite ([BA-255](https://halo-powered.atlassian.net/browse/BA-255))  `✅ Done`
- **Intent:** part of the Data Readiness Agent (BA-251); see the epic spec.
- **Scope:** about 20 Postgres and 20 Databricks labelled fixtures copied from the reference corpus, and its matching scorer.
- **Out of scope:** editable thresholds, provenance, false positives, MongoDB and REST sources, rule exports (epic spec).
- **Acceptance:** the engine meets the reference precision and recall floors on them; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 12 parallel units against a shared contracts scaffold.

#### 1.16.5 — Postgres profiling queries ([BA-256](https://halo-powered.atlassian.net/browse/BA-256))  `✅ Done`
- **Intent:** part of the Data Readiness Agent (BA-251); see the epic spec.
- **Scope:** aggregate-only profiling queries for Postgres with quoted identifiers and a statement timeout.
- **Out of scope:** editable thresholds, provenance, false positives, MongoDB and REST sources, rule exports (epic spec).
- **Acceptance:** unit specs check the SQL and result mapping; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 12 parallel units against a shared contracts scaffold.

#### 1.16.6 — Databricks profiling queries ([BA-257](https://halo-powered.atlassian.net/browse/BA-257))  `✅ Done`
- **Intent:** part of the Data Readiness Agent (BA-251); see the epic spec.
- **Scope:** the same queries in Spark SQL, Unity Catalog names flattened to catalog.schema.
- **Out of scope:** editable thresholds, provenance, false positives, MongoDB and REST sources, rule exports (epic spec).
- **Acceptance:** unit specs check the SQL and result mapping against a fake session; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 12 parallel units against a shared contracts scaffold.

#### 1.16.7 — Source profile adapters ([BA-258](https://halo-powered.atlassian.net/browse/BA-258))  `✅ Done`
- **Intent:** part of the Data Readiness Agent (BA-251); see the epic spec.
- **Scope:** type classification, format rules from column names, the consistency probe window, keys, relationships and inferred joins, for Postgres and Databricks.
- **Out of scope:** editable thresholds, provenance, false positives, MongoDB and REST sources, rule exports (epic spec).
- **Acceptance:** unit specs build the expected profile from a fake connector per dialect; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 12 parallel units against a shared contracts scaffold.

#### 1.16.8 — Saved assessment reports and API ([BA-259](https://halo-powered.atlassian.net/browse/BA-259))  `✅ Done`
- **Intent:** part of the Data Readiness Agent (BA-251); see the epic spec.
- **Scope:** the `readiness_reports` collection and `POST /data-readiness/assessments`, `GET /data-readiness/assessments`, `GET /data-readiness/assessments/:id`.
- **Out of scope:** editable thresholds, provenance, false positives, MongoDB and REST sources, rule exports (epic spec).
- **Acceptance:** unit specs cover assess, list, get, 404 and 400; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 12 parallel units against a shared contracts scaffold.

#### 1.16.9 — Agent, prompt, skill and tools ([BA-260](https://halo-powered.atlassian.net/browse/BA-260))  `✅ Done`
- **Intent:** part of the Data Readiness Agent (BA-251); see the epic spec.
- **Scope:** the `data-readiness` agent, its prompt, its skill and the tools `assess_data_readiness`, `get_readiness_report`, `list_readiness_reports`.
- **Out of scope:** editable thresholds, provenance, false positives, MongoDB and REST sources, rule exports (epic spec).
- **Acceptance:** unit specs cover the tools, the prompt fixture and the skill; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 12 parallel units against a shared contracts scaffold.

#### 1.16.10 — Agent catalogue and chat session wiring ([BA-261](https://halo-powered.atlassian.net/browse/BA-261))  `✅ Done`
- **Intent:** part of the Data Readiness Agent (BA-251); see the epic spec.
- **Scope:** the agent listed as Official, Start chat gated on a Postgres or Databricks dataset, the tool bridge, the `readiness-report` stream event and panel item.
- **Out of scope:** editable thresholds, provenance, false positives, MongoDB and REST sources, rule exports (epic spec).
- **Acceptance:** unit specs cover the catalogue entry, the blocked reason and the stream event; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 12 parallel units against a shared contracts scaffold.

#### 1.16.11 — Scorecard panel and chat card ([BA-262](https://halo-powered.atlassian.net/browse/BA-262))  `✅ Done`
- **Intent:** part of the Data Readiness Agent (BA-251); see the epic spec.
- **Scope:** the scorecard (overall score and band, dimension bars, findings table filterable by dimension and severity) and its chat card.
- **Out of scope:** editable thresholds, provenance, false positives, MongoDB and REST sources, rule exports (epic spec).
- **Acceptance:** unit tests cover rendering and filtering; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 12 parallel units against a shared contracts scaffold.

#### 1.16.12 — Past assessments history ([BA-263](https://halo-powered.atlassian.net/browse/BA-263))  `✅ Done`
- **Intent:** part of the Data Readiness Agent (BA-251); see the epic spec.
- **Scope:** the list of saved reports for the session's datasource, opening one in the scorecard.
- **Out of scope:** editable thresholds, provenance, false positives, MongoDB and REST sources, rule exports (epic spec).
- **Acceptance:** unit tests cover listing, the empty state and opening a report; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 12 parallel units against a shared contracts scaffold.

### Milestone 1.17 — Custom LLM endpoint provider ([BA-281](https://halo-powered.atlassian.net/browse/BA-281))

A fourth LLM provider, `custom` ("Custom endpoint"), connects every agent to any self-hosted or third-party model server: OpenAI-compatible (base URL with `/v1`, Bearer key) or Anthropic-compatible (base URL root, `x-api-key`), an optional encrypted key, a model, and **Load models** from the endpoint's `/v1/models`. Replaces the cancelled Claude-account approach (BA-264). All stories are built on the branch `feat/BA-281-custom-llm-endpoint` and ship as one PR. Epic spec: [specs/epics/BA-281/spec.md](specs/epics/BA-281/spec.md).

#### 1.17.1 — Settings service: validate, save, view and resolve ([BA-282](https://halo-powered.atlassian.net/browse/BA-282))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-282 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.2 — URL normalisation and model route per API style ([BA-283](https://halo-powered.atlassian.net/browse/BA-283))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-283 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.3 — Anthropic-compatible model factory ([BA-284](https://halo-powered.atlassian.net/browse/BA-284))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-284 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.4 — OpenAI-style connection probe ([BA-285](https://halo-powered.atlassian.net/browse/BA-285))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-285 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.5 — Anthropic-style connection probe ([BA-286](https://halo-powered.atlassian.net/browse/BA-286))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-286 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.6 — List models from the endpoint ([BA-287](https://halo-powered.atlassian.net/browse/BA-287))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-287 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.7 — Tuning and effort levels ([BA-288](https://halo-powered.atlassian.net/browse/BA-288))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-288 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.8 — Visual designer model selection ([BA-289](https://halo-powered.atlassian.net/browse/BA-289))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-289 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.9 — Agent catalogue provider display ([BA-290](https://halo-powered.atlassian.net/browse/BA-290))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-290 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.10 — Clear chat errors for unreachable or misconfigured endpoints ([BA-291](https://halo-powered.atlassian.net/browse/BA-291))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-291 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.11 — Key redaction in logs and diagnostics ([BA-292](https://halo-powered.atlassian.net/browse/BA-292))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-292 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.12 — Settings form: provider, API style, base URL and key ([BA-293](https://halo-powered.atlassian.net/browse/BA-293))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-293 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.13 — Load models dropdown ([BA-294](https://halo-powered.atlassian.net/browse/BA-294))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-294 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.14 — Provider display in the agent page and composer ([BA-295](https://halo-powered.atlassian.net/browse/BA-295))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-295 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.15 — E2E for the OpenAI style ([BA-296](https://halo-powered.atlassian.net/browse/BA-296))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-296 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.16 — Anthropic API stub and E2E fixture ([BA-297](https://halo-powered.atlassian.net/browse/BA-297))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-297 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.17 — E2E for the Anthropic style ([BA-298](https://halo-powered.atlassian.net/browse/BA-298))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-298 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.18 — Live smoke script against a real endpoint ([BA-299](https://halo-powered.atlassian.net/browse/BA-299))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-299 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.19 — Run evals against a custom endpoint ([BA-300](https://halo-powered.atlassian.net/browse/BA-300))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-300 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

#### 1.17.20 — User docs for common endpoints ([BA-301](https://halo-powered.atlassian.net/browse/BA-301))  `✅ Done`
- **Intent:** part of the custom LLM endpoint provider (BA-281); see the epic spec.
- **Scope:** see the Jira story BA-301 and the epic spec.
- **Out of scope:** the Claude local-login approach (BA-264, cancelled); per-agent endpoints.
- **Acceptance:** as in the Jira story; `check-specs.py`, unit tests, lint and builds are green.
- **Notes:** created 2026-11-03; built by one of 20 parallel units against a shared contracts scaffold. Passed the acceptance gate on 2026-11-03. Evidence: [evidence/1.17/](evidence/1.17/).

### Milestone 1.18 — Desktop installer builds ([BA-302](https://halo-powered.atlassian.net/browse/BA-302))

How the desktop installers are built and published. From 2026-11-04 only the Windows x64 installer ships. 1.18.1 shipped on `ci/BA-302-windows-only-installer` (PR #84); 1.18.2, added after that merge, is built on `ci/BA-302-windows-only-site` and ships as a second PR. Epic spec: [specs/epics/BA-302/spec.md](specs/epics/BA-302/spec.md).

#### 1.18.1 — Build only the Windows installer ([BA-303](https://halo-powered.atlassian.net/browse/BA-303))  `✅ Done`
- **Intent:** releases stop waiting on macOS runners and publish only the installer we ship.
- **Scope:** remove the macOS inputs and matrix entries from `build-desktop.yml`, so manual runs and `v*` tag pushes build and publish Windows x64 only; N1 in `non-functional.md` becomes Windows x64; `delivery.md` §5, the README and the `version-on-merge.yml` comment match.
- **Out of scope:** the product page's macOS buttons (handled by 1.18.2); local macOS builds with `electron:dist`; macOS app behaviour; code signing.
- **Acceptance:** the run form has no macOS options; a run with `publish=true` builds only the Windows `.exe` and attaches it to the release; `check-specs.py` and actionlint pass.
- **Notes:** created 2026-11-04 after a GitHub Actions outage left the v0.38.0 macOS Intel job queued; v0.38.0 was published by hand with the Windows installer only. Passed the acceptance gate on 2026-11-04. Evidence: [evidence/1.18.1/](evidence/1.18.1/).

#### 1.18.2 — Product page offers only the Windows installer ([BA-304](https://halo-powered.atlassian.net/browse/BA-304))  `✅ Done`
- **Intent:** the product page stops sending visitors to an outdated macOS build and matches N1.
- **Scope:** remove the macOS download cards, the Gatekeeper note and macOS from the hero badge, the download intro and the Platforms line of bi-assistant.halo-powered-labs.com; redeploy. Correct the last macOS release in the specs and roadmap from v0.16.1 to v0.13.1.
- **Out of scope:** removing the `/download/mac-*` routes and `/api/latest`'s macOS entries; the Labs home page.
- **Acceptance:** the live page shows one download card (Windows) serving the newest release; no macOS text on the page; `/download/win-x64` redirects to the `.exe`; `/download/mac-arm64` still resolves; `check-specs.py` passes.
- **Notes:** created 2026-11-04 after 1.18.1 merged. Deployed and passed the acceptance gate on 2026-11-04. Evidence: [evidence/1.18.2/](evidence/1.18.2/).

### Milestone 1.19 — US Health testing data ([BA-305](https://halo-powered.atlassian.net/browse/BA-305))

A synthetic Mercer US Health & Benefits world as a seedable Testing Data fixture, so the Assistant, the Data Readiness Agent and the US Health showcase agents (Milestone 1.15) have one coherent dataset. Builds on the Testing Data catalogue (Milestone 1.1). No ADR: a fixture is one seed file plus one catalogue entry. All stories are built on the branch `feat/BA-305-us-health-testing-data` and ship as one PR. Epic spec: [specs/epics/BA-305/spec.md](specs/epics/BA-305/spec.md).

#### 1.19.1 — US Health sample as a Testing Data fixture ([BA-306](https://halo-powered.atlassian.net/browse/BA-306))  `✅ Done`
- **Intent:** one click in Settings → Testing Data loads a realistic US Health & Benefits dataset that every agent can answer from.
- **Scope:** a fifth fixture `us-health` ("US Health"): schema `us_health` in database `us_health` on the sample server, 41 tables and 4 views (45 required entities) in 8 domains, bundled as `004_us_health.sql.gz`, registered as datasource "US Health PostgreSQL" and dataset "US Health"; the deterministic generator `scripts/generate-us-health-seed.py` with tests for the planted signals and defects; testing-data spec R2–R4 and the Testing Data Feature updated.
- **Out of scope:** showcase agents chatting; eval sets on the fixture; a REST variant; changes to the other fixtures or the loader.
- **Acceptance:** the panel lists "US Health" with `0/45 entities`; loading it creates and seeds `us_health` and reports `45/45 entities`; the dataset has sample values and the declared join references; re-running the generator reproduces the seed byte for byte; `check-specs.py`, unit tests, lint, builds and the Testing Data Playwright scenarios are green.
- **Notes:** data model approved on 2026-11-04 ([review page](https://claude.ai/artifact/4msSW6rkyot8Ai8Zvdr9yc)); research notes from public Mercer, KFF, SOA and state-law sources. Built by five parallel units (generator and seed, signal tests, defect and structure tests, app-level load, specs). Passed the acceptance gate on 2026-11-04. Evidence: [evidence/1.19.1/](evidence/1.19.1/).

### Milestone 1.20 — Schema metadata in datasets ([BA-318](https://halo-powered.atlassian.net/browse/BA-318))

Users tag each schema in a dataset with its data layer and a description, and the assistant uses them. Extends the datasets capability and the session context. No ADR: an optional field on the dataset document and an extra section in an existing context block. All stories are built on the branch `feat/BA-318-datasource-metadata` and ship as one PR. Epic spec: [specs/epics/BA-318/spec.md](specs/epics/BA-318/spec.md).

#### 1.20.1 — Layer and description on dataset schemas ([BA-319](https://halo-powered.atlassian.net/browse/BA-319))  `✅ Done`
- **Intent:** in the Edit dataset page, the user selects a schema and sets its layer (Landing, Normalized, Consumption) and a description; the tree shows the layer, and the assistant takes both into account.
- **Scope:** optional per-dataset schema notes (`schemas` on the dataset document and `POST /datasets`; omitted keeps, present replaces, orphans pruned); Layer dropdown and Description textarea in the details panel for a selected schema; a layer badge on the schema row; a "Schema notes" section in the dataset orientation context when notes exist; datasets spec, api.md, data-model, agents.md, ui.md, glossary; a new Gherkin scenario and one new assistant eval case.
- **Out of scope:** notes on datasources, catalogs or tables; sharing notes across datasets; tool output changes; filtering by layer.
- **Acceptance:** see the epic spec: round-trip in the UI, old datasets unaffected, orphan notes dropped, Testing Data reload keeps notes, unknown layer rejected, context unchanged without notes, unit tests, check-specs, lint, builds, the Datasets Playwright scenarios and the assistant evals at 100 %.
- **Notes:** first built on 2026-11-09 as datasource-level fields after a misread of the request ("datasource" instead of the schemas in the dataset tree); reverted on the branch the same day. Decisions settled with the user on 2026-11-09: per-dataset notes, right-panel editing with a tree badge, used in agent context. Planned by Opus, implemented by Sonnet units at the user's request.

#### 1.20.2 — Data Readiness fails on a Databricks host saved with https:// ([BA-322](https://halo-powered.atlassian.net/browse/BA-322))  `✅ Done`
- **Intent:** the Data Readiness assessment works on a Databricks datasource whose host was saved as a workspace URL (`https://…/`).
- **Scope:** one `normalizeDatabricksHost` helper used by the connector, the data-readiness profiler's SQL connection and Unity Catalog calls, and Databricks saves; datasources R4; unit tests.
- **Out of scope:** migrating stored hosts (every reader normalises); other kinds.
- **Acceptance:** the profiler connects with the bare hostname for a stored `https://…/` host without a re-save (unit test, and live against the user's workspace: `main` fails with `https://https//… ENOTFOUND`, the branch profiles `samples.tpch.region`); new Databricks saves store the bare hostname; datasources and data-readiness unit tests green.
- **Notes:** found by the user while testing 1.20.1 on 2026-11-09; fixed on the epic branch at the user's request (not a separate `fix/` branch).

#### 1.20.3 — Faster Data Readiness assessments ([BA-323](https://halo-powered.atlassian.net/browse/BA-323))  `✅ Done`
- **Intent:** an assessment of a large Databricks catalog finishes in well under a minute instead of about five, with the same scores.
- **Scope:** ADR-0033: one profiling session pool per assessment (Databricks and PostgreSQL); the per-text-column probes folded into the per-table statistics statement; row count first and tables above 100 M rows not profiled, listed in the report as `too-large` (or `timed-out`); 8 concurrent Databricks tables, 4 PostgreSQL; inventory read once; the turn's abort signal cancels statements and stores no report.
- **Out of scope:** approximate counts or sampling; editable thresholds; background jobs that survive a reload.
- **Acceptance:** identical scores and findings on the World Cup and US Health samples before and after; the Databricks `samples` assessment (125 entities) measured before (296 s) and after, after well under 60 s, with the huge tables listed as not profiled; Stop leaves no stored report; unit tests, check-specs, builds, the data-readiness Playwright spec and the `data-readiness` evals at 100 %.
- **Notes:** analysis by a Fable agent on 2026-11-09 (live timings: new session per statement 0.8 s vs 0.19 s reused; `store_sales` 2.9 B rows times out on any column aggregate). Decisions by the user on 2026-11-09: skip and mark huge tables, 8 concurrent, Stop cancels, same epic and branch.

#### 1.20.4 — Live progress while a Data Readiness assessment runs ([BA-324](https://halo-powered.atlassian.net/browse/BA-324))  `✅ Done`
- **Intent:** while an assessment runs, the chat shows what it is doing, so the user is not left waiting on a bare spinner.
- **Scope:** ADR-0033: the tool emits progress through Mastra's tool writer; the session stream forwards it as a `tool-progress` SSE event between `tool` and `tool-result`; the running tool row in the Thinking block shows the latest message ("Listing tables…", "Profiling <entity> (n/N)…", "Checking relationships…", "Running checks…", "Writing the report…"); progress is ephemeral and invisible to the model.
- **Out of scope:** progress for other tools (the event is generic, only readiness emits it now); persisting progress; a determinate progress bar.
- **Acceptance:** the stream carries `tool-progress` frames in order between `tool` and `tool-result` (API-level E2E on the World Cup sample); the Thinking block row shows the latest message; unit tests for the tool, the stream loop and the chat; api.md 3.1, ui.md, sessions-chat, data-readiness and agents.md updated.
- **Notes:** design by the Fable analysis on 2026-11-09 (Mastra 1.66 `writer.custom` reaches `fullStream`; fallback: a callback on the request context).

#### 1.20.5 — Let users select and copy any text in the app ([BA-326](https://halo-powered.atlassian.net/browse/BA-326))  `✅ Done`
- **Intent:** the user can select any text in the app (chat answers, tables, panels, the readiness scorecard) and copy it.
- **Scope:** remove the root `user-select: none`; keep it only on the Electron drag region, during the right-panel splitter drag and on a few click-to-toggle headers; ui.md's open question resolved.
- **Out of scope:** new Copy buttons; changing what the existing Copy buttons copy.
- **Acceptance:** text in a chat answer, a result table and the readiness scorecard can be selected and copied; dragging the splitter selects nothing; buttons and toggles work; app unit test and layout/accessibility Playwright scenarios green.
- **Notes:** requested by the user on 2026-11-09; added to this epic and branch like the other stories.

### Milestone 1.21 — Questions to Insights v2 ([BA-320](https://halo-powered.atlassian.net/browse/BA-320))

A second built-in data-analyst agent, Questions to Insights v2, built up next to the current Questions to Insights Assistant, which stays unchanged. v2 starts minimal; later stories reduce what the assistant carries and bring only the slimmer set into v2. No new ADR: v2 reuses built-in session agents (ADR-0028) and built-in prompt overrides (ADR-0026). All stories are built on the branch `feat/BA-320-questions-to-insights-v2` and ship as one PR. Epic spec: [specs/epics/BA-320/spec.md](specs/epics/BA-320/spec.md).

#### 1.21.1 — Empty Questions to Insights v2 agent ([BA-321](https://halo-powered.atlassian.net/browse/BA-321))  `✅ Done`
- **Intent:** have a v2 agent to chat with, starting from nothing, so the reductions of the current assistant can land in it one by one.
- **Scope:** a new built-in agent `assistant-v2` ("Questions to Insights v2", id `questions-to-insights-v2`) with an identity-only prompt starting `You are Questions to Insights v2` (overridable, ADR-0026), the tools `list_entities`, `describe_entity` and `run_readonly_sql`, the assistant's memory settings, no skills and no evals; Official in the Agent Hub; sessions started from it are bound to it (ADR-0028); agents.md, api.md, agents-evals and sessions-chat updated.
- **Out of scope:** moving any assistant rule, tool or skill into v2; grounding guard, tool-only synthesis and deep analysis for v2; user agents on v2; an eval set; changing the current assistant.
- **Acceptance:** the hub lists v2 as Official with its prompt, three tools and memory; a chat with v2 on a sample dataset answers a data question by running SQL; the assistant's compiled prompt and tool list are byte-identical to `main`; `check-specs.py`, unit tests, lint, builds and the Agent Hub and sessions Playwright specs are green.
- **Notes:** epic spec confirmed on 2026-11-09.

#### 1.21.2 — Auto-configure local instances: testing data and custom LLM ([BA-325](https://halo-powered.atlassian.net/browse/BA-325))  `✅ Done`
- **Intent:** every local instance the user tests by hand comes up ready to chat: LLM configured and every sample dataset loaded, with no clicks in Settings.
- **Scope:** `scripts/setup-local.mjs [baseUrl]` configures a running instance through its API: `PUT /llm/settings` from the gitignored `.env.llm.local` (`LLM_PROVIDER` default `custom`, `LLM_API_STYLE` default `anthropic`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`; found in the checkout, else the main checkout), then every seedable Testing Data fixture with its defaults and the Intellify RFP API, skipping those already loaded; committed `.env.llm.example`; delivery.md 2 and the `verify` and `workflow-implement` skills run it after launching an instance.
- **Out of scope:** the app provisioning itself on startup; the Electron desktop app; REST fixtures other than the Intellify RFP API.
- **Acceptance:** on a fresh isolated instance the script saves the LLM (connection tested by the save) and loads World Cup, Formula 1, Intellify, US Health and the Intellify RFP API; a second run reports each fixture as already loaded; exit code 0; no key in any tracked file.
- **Notes:** requested on 2026-11-09 while testing 1.21.1; the user chose to ship it on the BA-320 branch.

#### 1.21.3 — v2 turns run as a Mastra workflow shown in the workflow bar  `✅ Done`
- **Intent:** v2's process is defined in code, not in its prompt: some steps deterministic, some answered by the LLM, and the user sees the steps advance in the workflow bar.
- **Scope:** ADR-0034. A Mastra workflow `qti-v2-turn` (`createWorkflow` / `createStep`) registered on the Mastra instance runs every v2 turn, as an example with four steps: 1 **Receive question** (deterministic: trims and checks the question), 2 **Load catalog** (deterministic: the entities of the session's datasets, no LLM), 3 **Analyse** (LLM: the `assistant-v2` agent answers with its three tools and the catalog as context, streamed to the chat as today), 4 **Wrap up** (deterministic: counts SQL queries and rows and records a turn summary). The orchestrator writes the session's saved workflow state from the run's step events (current, done, failed), so the workflow bar shows the four steps from the first turn; v2 gets no `update_workflow`. agents.md, agent-panel and sessions-chat specs updated.
- **Out of scope:** the real steps (the user defines them next); workflows for any other agent; changes to the workflow bar UI beyond showing a failed step if it can't today.
- **Acceptance:** a v2 turn on World Cup shows the bar with the four steps advancing to all done and an answer computed by SQL; a failing step is marked failed and the turn ends with its error; the assistant's prompt and tools are byte-identical to `main`; unit tests cover the step order, the deterministic steps and the state written from step events; builds and check-specs green.
- **Notes:** requested on 2026-11-09. From this date the user stopped using Jira: this story has no Jira key and is documented only in the repo. Built in the fast loop on 2026-11-09: the saved workflow state gains `failed` and the view `source: 'workflow'` (additive, no migration); the bar gains a **Failed** status (agent-panel R8a); any model error now fails v2's Analyse step; the non-streamed turn (`POST /sessions/:id/messages`) stays a single agent call.

#### 1.21.4 — Context area on the navigation rail, with Knowledge inside it  `✅ Done`
- **Intent:** the rail gets a **Context** area that will gather what agents are given as context; Knowledge moves inside it instead of having its own rail item.
- **Scope:** the rail reads Datasets, Agents, **Context**, Sessions (layers icon); Context opens a page of section cards like the Agent Hub's (icon tile, name, two-line description); a card opens its section under a **Context** back control, and the rail's Context returns to the cards; the only card today is **Knowledge**, showing the Knowledge screen unchanged; app-shell R3, R3a, R37 and its Gherkin, knowledge placement, ui.md 2, 3, 4.8 and the new 4.8a; the navigation and layout Playwright selectors renamed.
- **Out of scope:** any other Context section (the user defines them later); changes to Knowledge itself; the chat's "Edit it under Knowledge" note.
- **Acceptance:** the rail shows Context in Knowledge's place and no Knowledge item; clicking Context marks it current and shows the Context page with a Knowledge card; the card opens the Knowledge list with Context still current, and Back or the rail returns to the cards; app unit tests, builds, check-specs and the navigation Playwright spec green.
- **Notes:** requested on 2026-11-09 with a screenshot of the rail; the user chose an empty placeholder area with Knowledge moved inside. First built as a tab strip; the same day the user said more sections are coming and asked for the best pattern, so it became a Settings-style list pane; then the user asked for cards as in the Agents view, which is what shipped. No Jira key (repo only). The `application-shell` screenshot baseline changes with the rail label; it is refreshed at the acceptance gate.

#### 1.21.5 — Data Readiness Agent drills into findings with read-only SQL  `✅ Done`
- **Intent:** asked for the records behind a finding ("which rows have `second_nationality_country_id` null?"), the Data Readiness Agent runs the query and shows them, instead of saying it has no SQL tool.
- **Scope:** ADR-0035 (amends ADR-0031). The agent gains the shared `describe_entity` and `run_readonly_sql` (same guards, session scoping, fixer and result checks as the assistant's) and a second on-demand built-in skill `readiness-drilldown`: one SQL recipe per assessed dimension (completeness, validity, consistency, uniqueness, integrity, timeliness, reasonability) for PostgreSQL and Databricks, and how to present rows (count first, then a capped table). Its prompt allows SQL only to show the records behind findings and answer data-quality questions about the session's data; general analysis is declined with a pointer to Questions to Insights. Scores stay engine-only: a query result never changes, recomputes or replaces a score. agents.md 2.10, 3.13, 7.4, D12 and Appendix D; data-readiness R3, R4 and a scenario; the agent's unit tests and evals (`dr-no-sql` rewritten, a drill-down case added).
- **Out of scope:** sample_rows, list_entities, visuals or workspace tools for the agent; changes to the engine, profiling or scores; the assistant and v2.
- **Acceptance:** in a Data Readiness session on Formula 1, "what are the records with second_nationality_country_id null values" runs one `run_readonly_sql` with `IS NULL` on `driver` and answers with the count and a table of rows; "how many races were there in 2010?" is declined with a pointer to Questions to Insights; asked to change a score after a query, it still refuses; the hub shows the agent's five tools plus `describe_entity` and `run_readonly_sql` and two skills; unit tests, builds, check-specs green; the Data Readiness evals at 100 % at the gate.
- **Notes:** requested on 2026-11-09 with a screenshot of the agent saying it has no SQL tool; built in the fast loop the same day. Live runs showed the agent fanning a query out to every datasource of a multi-dataset session (and the SQL fixer rewriting the strays into unrelated queries), so Block D1 now carries each dataset's `datasourceId` and an example entity key, and the skill requires passing that id. The user chose to ship it on the BA-320 branch, `describe_entity` + `run_readonly_sql`, drill-down-only scope and a separate skill. No Jira key (repo only).

#### 1.21.6 — User personas section in the Context area  `✅ Done`
- **Intent:** the user can describe who asks the questions (role, goals, typical questions, expertise, preferred answer style) as user personas, kept in the app, ready for agents to use as context in a later story.
- **Scope:** a second Context card **User personas** after Knowledge (app-shell R3a), opening a User personas section: a list of personas sorted by name with an empty state, a **New persona** button, and an editor to create, edit and delete one. A persona has `name` (required, unique ignoring case, at most 80 characters), `role` (at most 80), `description` (at most 2,000), `goals` (at most 2,000), `typicalQuestions` (0 to 10, each at most 300), `expertise` (`novice`, `intermediate` default, `expert`) and `answerStyle` (at most 500). Backend module `personas` with collection `user_personas` and `GET/POST /personas`, `PATCH/DELETE /personas/:id`. New capability spec `user-personas`; api.md, data-model.md, ui.md and app-shell R3a updated.
- **Out of scope:** agents or sessions using personas; picking a persona for a session; importing or generating personas; evals.
- **Default data:** every data dir starts with **Demo Finance Analyst** (every field filled), seeded once on backend start and marked by the `settings` key `personas-seed`, so deleting it is permanent (user-personas R13). Requested the same day after trying the section.
- **Acceptance:** the Context page shows Knowledge then User personas; the card opens the section under the Context back control; a persona can be created with every field, edited and deleted, and survives a restart; a duplicate name or a blank name is refused with its message; backend and frontend unit tests, builds, check-specs and the navigation Playwright spec green.
- **Notes:** requested on 2026-11-09; the user chose a manage-only section (agents use personas later), the richer profile and the card after Knowledge. No Jira key (repo only).

#### 1.21.7 — Knowledge becomes each dataset's ontology: model, migration, API and context  `✅ Done`
- **Intent:** business meaning lives in a per-dataset ontology (concepts, relations, constraints, instructions) instead of flat snippets, with no change to what the assistant is told.
- **Scope:** ADR-0036. Collection `ontology_items` and migration M15 (snippets copied, `knowledge_snippets` renamed `knowledge_snippets_legacy`); module `ontology` replacing `knowledge` with `GET/POST /datasets/:name/ontology`, `PATCH/DELETE /ontology/:id` and per-kind validation; deleting a dataset deletes its items; the per-turn block rendered from the ontology, byte-identical for migrated data; `[relation]` lines and one bullet in the `curated-knowledge` skill. Contract: [docs/plans/ba-320-dataset-ontology.md](docs/plans/ba-320-dataset-ontology.md).
- **Out of scope:** ontology-grounded retrieval and SQL checks (1.3.3); provenance and feedback (1.3.4); renaming the skill.
- **Acceptance:** an install with snippets starts with the same items as ontology items and the same context block for a session; the old table is kept as `knowledge_snippets_legacy`; every validation message and cascade has a unit test; the assistant's prompt is byte-identical to before; unit tests, builds and check-specs green.
- **Notes:** requested on 2026-11-09 ("refactor the current knowledge functionality to datasets ontology"); design approved the same day from a review page. Moves roadmap 1.3.1 and 1.3.2 (BA-4) to BA-320 at the user's request. No Jira key (repo only).

#### 1.21.8 — Ontology tab in the dataset editor  `✅ Done`
- **Intent:** a dataset's ontology is edited next to its schema.
- **Scope:** Schema and Ontology tabs on a saved dataset; the Ontology tab lists concepts, relations, constraints and instructions with shared items marked "All datasets", filters, Pending suggestions, Generate suggestions and an editor per kind; the Knowledge card leaves the Context page; the chat reads "Ontology in context". Datasets, app-shell, sessions-chat specs and ui.md.
- **Out of scope:** a graph view of the ontology.
- **Acceptance:** a concept with column mappings, a relation, a constraint and an instruction can be created, edited, disabled and deleted from a dataset; shared items appear in every dataset; the Context page shows only User personas; unit tests, builds and the navigation and dataset Playwright specs green.
- **Notes:** depends on 1.21.7. No Jira key (repo only).

#### 1.21.9 — Ontology suggestions from the data  `✅ Done`
- **Intent:** a dataset's ontology is drafted in minutes from its schema, samples, relationships and metrics.
- **Scope:** the `knowledge-bootstrap` agent (key kept, shown as Ontology Bootstrap) drafts up to 15 concepts with column mappings, relations between them, constraints and instructions; drafts arrive disabled in Pending suggestions. agents.md 2.5.
- **Out of scope:** learning from thumbs-down corrections (1.3.4).
- **Acceptance:** Generate suggestions on a sample dataset stores disabled concepts with valid mappings and relations that resolve; bad mappings and unresolved relations are dropped; unit tests cover the post-processing.
- **Notes:** depends on 1.21.7. No Jira key (repo only).

- **Notes (fix, 2026-11-09):** the first live run failed with `Structured output validation failed: drafts: Too big` because the output format capped the list at 15; the cap moved to after post-processing.

#### 1.21.10 — Ontology relations as a graph  `✅ Done`
- **Intent:** see how a dataset's concepts connect, and review generated relations, at a glance.
- **Scope:** a **Graph** option at the end of the Ontology tab's filter row; an SVG graph drawn by the app (no new dependency) with concept and metric nodes, labelled relation arrows, disabled and pending items faded and dashed, shared items marked; pan, zoom, drag; selecting a node or arrow highlights its neighbours and shows details with Edit opening the existing editor; the Pending suggestions toggle filters the graph. dataset-ontology R38, R39 and three scenarios; ui.md 4.8.
- **Out of scope:** editing relations by drawing arrows; graphs across datasets; saving node positions.
- **Acceptance:** on World Cup with generated suggestions the graph shows the concepts and their relations, faded while pending; clicking a node highlights its neighbours and Edit opens its editor; unit tests and the build green.
- **Notes:** requested on 2026-11-09 with a screenshot of the filter row; the user chose the filter-row placement, all items with disabled ones faded, and select + edit. No Jira key (repo only).

#### 1.21.11 — Ontologies on the Context page  `✅ Done`
- **Intent:** see and edit every dataset's ontology from Context, next to the other things agents are given, without opening each dataset.
- **Scope:** an **Ontologies** card first on the Context page; a list of every dataset with the size of its ontology, pending suggestions and shared items counted once; choosing one opens the same Ontology panel as the dataset's Ontology tab, under an Ontologies back control. dataset-ontology R40 and a scenario; app-shell R3a and its scenario; ui.md 4.8a; a note on ADR-0036.
- **Out of scope:** a separate editor for shared items; ontologies across datasets in one view.
- **Acceptance:** the Context page shows Ontologies then User personas; World Cup shows its counts and pending chip; opening it shows its ontology and edits there show in the dataset's Ontology tab; unit tests and the build green.
- **Notes:** requested on 2026-11-09 with a screenshot of the Context page showing only User personas; it partly reverses 1.21.8's removal of the Knowledge card, keeping a single editor. No Jira key (repo only).

#### 1.21.12 — Visuals library on the Context page  `✅ Done`
- **Intent:** keep a library of chart types for data visualization, grouped by what they show, next to the other things agents are given, so the team shares one vocabulary of visuals and knows which ones the app can draw.
- **Scope:** a **Visuals** card third on the Context page; a `visual_charts` collection seeded once per data dir with a default catalog of 30 chart types in 9 categories (Comparison, Change over time, Part-to-whole, Distribution, Relationship, Ranking, Flow, Spatial, Numbers and tables); each chart has a name, category, sample preview thumbnail, description, when to use, when to avoid, the data it needs, the renderer form the app draws it with (or none) and an enabled flag; the library lists charts grouped by category with search and category filters, disabled charts faded; add, edit (in place, where the card was), disable and delete charts; `GET/POST /visuals`, `PATCH/DELETE /visuals/:id`. New capability spec visuals-library; app-shell R3a; api.md, data-model.md, ui.md.
- **Out of scope:** agents or the visual designer using the library (a later story); drawing new chart types; importing charts; per-chart sample data.
- **Acceptance:** a new data dir shows the Visuals card and the 30 default charts in 9 categories with previews; search and a category filter narrow the list; a chart can be added, edited, disabled and deleted and survives a restart; a deleted default stays deleted; a duplicate or blank name is refused; unit tests and the build green.
- **Notes:** requested on 2026-11-10 with a screenshot of the Context page. The user chose a broad catalog marked with what the app draws, shipped + editable, rich entries with a preview, and manage-only for now. No Jira key (repo only).

#### 1.21.13 — Monitoring item on the navigation rail  `✅ Done`
- **Intent:** give monitoring its own place in the app now, so later stories can fill it without reshaping the navigation.
- **Scope:** a **Monitoring** item (activity icon) on the rail and drawer, after Sessions; choosing it shows an empty Monitoring page (heading "Monitoring", note "Nothing to monitor yet.") and marks the item current. app-shell R3/R3b, R37 and the rail scenario; ui.md rail and main-view table.
- **Out of scope:** any monitoring content (what is monitored, metrics, alerts); a backend change.
- **Acceptance:** the rail lists Datasets, Agents, Context, Sessions, Monitoring; clicking Monitoring shows the empty page with Monitoring current, and another rail item leaves it; unit tests and the build green.
- **Notes:** requested on 2026-11-10 ("add in the left menu an option named Monitoring, leave it empty for now"). The user placed it after Sessions. No Jira key (repo only).

#### 1.21.14 — LLM calls table on the Monitoring page  `✅ Done`
- **Intent:** see every model call the app's agents make, filter them and spot the slow, failing or expensive ones, without a developer tool.
- **Scope:** the Monitoring page lists LLM calls newest first, one row per agent run's model call (a Mastra `model_generation` span read from the trace store `observability.duckdb`, ADR-0038): started, agent, model and provider, session, tokens in / out, duration, estimated cost, status (Succeeded / Failed / Running). Filters at the top: agent, model, provider, status, session, date range (any time, last hour, last 24 hours, last 7 days, custom from/to), with Clear filters. Pagination: 25 per page by default, 25 / 50 / 100, Previous / Next and "1–25 of N". Cost from a shipped price table of Claude models (prices of 2026-11-03, cache reads and writes priced apart); a model not in the table shows a dash. `GET /monitoring/llm-calls`. Calls recorded before this story show too.
- **Out of scope:** editing prices; charts and totals; alerts; deleting or exporting calls; model calls Mastra does not trace.
- **Acceptance:** after a chat turn the call appears with its agent, model, session, tokens, duration, cost and status; each filter narrows the list and Clear filters restores it; paging and the page-size choice work; a failed call shows Failed; unit tests, the build and the impacted E2E green.
- **Notes:** requested on 2026-11-10. The user chose the filters (agent, date range, model / provider, status, session), the columns (tokens, duration, session, estimated cost), 25 rows per page with a selector, one row per agent run, and a shipped price table. No Jira key (repo only).

#### 1.21.15 — LLM call detail with its context window  `✅ Done`
- **Intent:** see what filled a call's context window, and how much of it the app put there versus what came from the user, so prompts and context can be trimmed with evidence.
- **Scope:** clicking a row opens the call's page (Monitoring stays current; a **Monitoring** back control returns to the table with its filters and page kept): the call's facts (agent, model, provider, session, started, duration, time to first token, finish reason, tokens in / out with cache reads and writes, reasoning tokens, estimated cost, error); the **context window**: a stacked bar of the estimated tokens of seven boxes, against the model's context limit when known, then the seven boxes in order, each tagged by who owns it, with its estimated tokens and share, expandable to the exact text: System prompt (US Health), Skill injection (US Health), Tools injection (US Health), Chat history (Custom), Dataset (Custom), User prompt (Custom), Tool calls and results in this run (Custom); then the run's model steps (tokens, finish reason, duration). `GET /monitoring/llm-calls/:id`.
- **Out of scope:** exact per-box token counts (estimates, scaled to the real input tokens of the run's largest step); comparing calls; replaying a call.
- **Acceptance:** a chat turn's call page shows the seven boxes with text matching what was sent (system prompt, the `<available_skills>` list, the tool definitions, the earlier turns, the session's dataset blocks, the question, the SQL run and its rows); the box estimates add up to the step's real input tokens; Back keeps the filters and page; unit tests, the build and the impacted E2E green.
- **Notes:** requested on 2026-11-10 with a sketch of the seven boxes (six drawn, the seventh chosen by the user); one row per agent run; a size bar plus expandable text. No Jira key (repo only).

#### 1.21.16 — Session execution flow on Monitoring  `✅ Done`
- **Intent:** follow what the agents did across a whole session, question by question, and see where each answer's time, tokens and cost went.
- **Scope:** a **Sessions** tab beside **LLM calls** on the Monitoring page: one row per session that has recorded agent runs (session, agent, turns, last activity, wall time, model time, tool calls, tokens in / out, estimated cost, status), filters for agent and date range, the same paging. A row opens the session page (Monitoring stays current, a **Monitoring** back control returns to the Sessions tab with its filters and page): session totals, then each turn as a conversation trajectory (the question, the path the agent took: each model request with its time, tokens and finish reason, and the tools it called grouped with counts, time and a short summary of their input, then the answer), each model request linking to its LLM call page. Each turn's **Open timeline** shows its trace as a waterfall: the span tree (agent run, model call, requests, tools, memory) with bars on a shared time axis, a detail panel for the selected span, and a **Show framework spans** switch for the housekeeping spans (skill injection, processors, workspace mounts, inference), hidden by default. `GET /monitoring/sessions`, `GET /monitoring/sessions/:id`, `GET /monitoring/traces/:traceId`. From the same trace store as 1.21.14 (ADR-0038).
- **Out of scope:** the agent graph (option C of the review page); comparing sessions; replaying a turn; sessions with no recorded runs.
- **Acceptance:** after two chat turns the session appears with 2 turns and totals equal to the sum of its LLM calls; the session page shows both questions, each model request and tool group in order, and both answers; Open timeline shows the waterfall with bars to scale and the framework switch adds the housekeeping spans; Back keeps the tab, filters and page; unit tests, the build and the impacted E2E green.
- **Notes:** requested on 2026-11-10 after the design review page https://claude.ai/artifact/U4h5dbCbR65PSSRGbHkdPa (options A waterfall, B trajectory, C graph). The user chose the recommendation: B for the session with A as the turn drill-down, a Sessions tab on Monitoring, framework spans hidden behind a switch. No Jira key (repo only).
### Milestone 1.22 — Sampled profiling and synthetic data (M1-22)

Profile a PostgreSQL or Databricks dataset quickly from a sample of its rows, and download a synthetic copy as a SQL script in the datasource's dialect, a CSV zip or an Excel workbook. The copy keeps distributions, null rates, formats and keys, and never copies identifiers, names or free text. The profile can be exported as CSV or Excel, and the real sampled rows can be exported too (`.sql`, CSV or Excel) as an explicit action behind a confirm (amendment of 2026-11-11, stories 1.22.5 and 1.22.6). It is available from a **Profile & synthesize** tab in the dataset editor and, for the `.sql` synthetic script only, from the Data Readiness Agent in chat. The sampled profile is separate from the Data Readiness assessment, which stays exact (data-readiness R29), and the app never writes to a datasource. Decision: ADR-0039 (drafted in the plan, recorded in 1.22.1). All stories are built on the branch `feat/M1-22-synthetic-data` and ship as one PR. Epic spec: [specs/epics/M1-22/spec.md](specs/epics/M1-22/spec.md). Plan and contract: [docs/plans/m1-22-synthetic-data.md](docs/plans/m1-22-synthetic-data.md). No Jira key (repo only).

#### 1.22.1 — Sampled profile in the dataset editor  `✅ Done`
- **Intent:** see how a dataset's tables really look (types, null rates, distinct counts, ranges, categorical values, text patterns) in seconds, from a sample, without running a full readiness assessment.
- **Scope:**
  - ADR-0039.
  - A `RowSampler` added to the PostgreSQL and Databricks profilers, reading up to 1,000 rows per table:
    - PostgreSQL: a full read at ≤ 1,000 estimated rows, `TABLESAMPLE BERNOULLI … REPEATABLE` up to 1 M, `SYSTEM` above, with the estimate from `reltuples`;
    - Databricks: `TABLESAMPLE (p PERCENT) REPEATABLE`;
    - both: `LIMIT` fallback for views and unknown sizes, values read as raw text.
  - A pure profile builder: statistics, column kind, synthesis strategy, character-class shapes, and categorical values only for at most 20 distinct values each seen at least 3 times. Raw rows are never kept, logged or sent to a model.
  - An in-memory profile cache (20 profiles, 60 min).
  - `POST /synthetic-data/profiles` (api.md 111).
  - The third dataset-editor tab **Profile & synthesize**: table picker, Profile sample with Cancel, and the profile view with method chips and "Generated as" chips. The test ids and copy are in the plan, 3.4.
  - The new capability spec `synthetic-data`; datasets R48; ui.md 4.3 and 4.3a; api.md 2.18; a concept note in data-readiness; glossary and tech-stack.
- **Out of scope:** generating or downloading data (1.22.2); agent tools (1.22.4); any change to readiness profiling, scoring or R29.
- **Acceptance:**
  - On World Cup, the tab profiles every table and shows each one's method (`Read all <n> rows` for the small ones) and each column's statistics and strategy. A categorical column shows its real values, and a name column shows only a pattern.
  - A failing table shows its own error while the rest still profile.
  - The privacy unit spec proves the profile holds no non-categorical sampled value.
  - Sampling timings on a small and a large real table, for both dialects, are recorded in `evidence/1.22.1/sampling-timings.md` before integration.
  - The readiness specs, golden suite and score-equality specs are unchanged and green.
  - The `@demo @story-1.22.1` scenario passes.
  - Unit tests, builds and check-specs are green.
- **Notes:** requested on 2026-11-11. The user chose the editor tab plus agent tools, a profile separate from readiness, a `.sql` download, and reuse of real values only for low-cardinality categorical columns. UI story: its demo is recorded in the fast loop.

#### 1.22.2 — Synthetic data script for PostgreSQL  `✅ Done`
- **Intent:** download a realistic, privacy-safe copy of a PostgreSQL dataset's tables as a script that loads into any empty PostgreSQL database.
- **Scope:**
  - The deterministic generator: seeded per column, keys first, FK values drawn from the parents' keys (composite keys, cycles and self-references included), strategies per column kind, null rates, clamping when a composite key cannot reach the requested rows.
  - The PostgreSQL writer: header, `BEGIN`/`COMMIT`, `CREATE SCHEMA` of the target, `CREATE TABLE` with an allow-listed type mapping (anything else becomes `text`), PK and UNIQUE inline, INSERTs batched by 500, FK `ALTER`s after the inserts, LF only.
  - `POST /synthetic-data/scripts` (api.md 112): a streamed attachment, `X-Script-Sha256`, every validation error.
  - The Generate form in the tab: rows per table (default 100, 1–10,000), All tables + Apply, Seed (default 1), Target schema (default `synthetic`), Include keys and constraints, Generate .sql, and the expired-profile state.
  - A Databricks profile answers a temporary 400 until 1.22.3.
  - Unique integers that are not keys (requested 2026-11-11): only PK and FK integer columns get `sequence`. A column that is unique only (declared UNIQUE, or a sample distinct ratio ≥ 0.95) gets the new strategy `unique-range`, distinct integers drawn within the observed min–max. When the range holds fewer values than the requested rows, it falls back to a sequence starting at the observed minimum, and the header says so. Chip copy: `Distinct numbers in the observed range`. Example: World Cup `tournaments.tournament_year` gives years in 2018–2022, not 1, 2, 3.
  - The capability rules for the generator and the PostgreSQL output; the data-model note on in-memory profiles; glossary.
- **Out of scope:** the Databricks writer (1.22.3); loading the script anywhere from the app; cross-column correlations other than keys.
- **Acceptance:**
  - On World Cup with 50 rows per table, the downloaded script, replayed into a scratch database by the API-level E2E, creates every table with the requested row counts and every FK constraint added.
  - The same seed gives the same `X-Script-Sha256`, and another seed gives a different one.
  - No real player or venue name appears in the script.
  - `tournaments.tournament_year` shows `Distinct numbers in the observed range`, and its generated values are distinct and within 2018–2022 (or the documented fallback when more rows than years are asked for).
  - Generator specs prove null rates, categorical fractions and ranges within tolerance, and FK values within the parents' keys.
  - The `@demo @story-1.22.2` scenario passes.
  - Unit tests, builds and check-specs are green.
- **Notes:** depends on 1.22.1. UI story.

#### 1.22.3 — Databricks SQL script  `✅ Done`
- **Intent:** a Databricks dataset downloads its synthetic copy in Databricks SQL, ready to run in a Databricks SQL editor.
- **Scope:**
  - The Databricks writer: backtick identifiers; Spark string escaping (`\` then `'`); typed literals (`DATE'…'`, `TIMESTAMP'…'`, `TIMESTAMP_NTZ'…'`); `CREATE TABLE … USING DELTA`; allow-listed types (anything else becomes `string`); informational PK and FK constraints (Unity Catalog), switchable off; `schema` or `catalog.schema` targets; no transaction.
  - A statement smoke check.
  - The temporary 400 removed.
  - The capability rules for the Databricks output.
- **Out of scope:** running the script from the app; `hive_metastore`-specific DDL beyond switching constraints off.
- **Acceptance:**
  - The writer's inline golden specs and the smoke check pass, and there is no `\r` in any script.
  - Generate on a Databricks dataset downloads `…-synthetic-databricks-seed<n>.sql`.
  - With the user's agreement, one generated script runs in a scratch schema of the user's workspace, and its row counts are recorded in `evidence/1.22.3/databricks-run.md`. Otherwise the gap is stated in the changelog.
  - Unit tests, builds and check-specs are green.
- **Notes:** depends on 1.22.2. No-UI story (the button exists): its fast-loop demo is `demo.txt`.

#### 1.22.5 — Export synthetic data and the profile as CSV and Excel  `✅ Done`
- **Intent:** take the synthetic copy and the sampled profile into a spreadsheet or any CSV tool, not only into a SQL database.
- **Scope:**
  - A **Format** choice on the Generate form: `SQL script` (default), `CSV (zip)` or `Excel (.xlsx)`. The same generator, seed and row counts give the same values in every format.
    - CSV: one file per table, `<target table name>.csv`, RFC 4180 (comma, `"` quoting, CRLF rows), UTF-8 without BOM, a header row, NULL as an empty field, all in one `.zip`.
    - Excel: one sheet per table (names cut to 31 characters and made unique), a bold header row, numbers, booleans and dates as typed cells, NULL as an empty cell.
    - Both also hold a `README` (a `README.txt` in the zip, a first `About` sheet in the workbook) with the header text the `.sql` script carries (dataset, seed, rows, dropped relationships, not-synthesized columns).
  - **Export profile** on the profile view: `CSV` (one row per column of every table, with the table's method and sampled rows) or `Excel` (a `Tables` sheet and a `Columns` sheet). Same contents as the view, so no sampled value beyond the categorical top values.
  - API: `format` (`sql` | `csv` | `xlsx`, default `sql`) on `POST /synthetic-data/scripts` (api.md 112); a new `POST /synthetic-data/profile-exports` (api.md 113).
  - New dependencies `exceljs` (xlsx, streaming writer) and `fflate` (zip), recorded in an ADR-0039 amendment and tech-stack.md.
  - The capability rules and ui.md 4.3a for the formats.
- **Out of scope:** raw sampled rows (1.22.6); formats beyond these three (Parquet, JSON lines); these formats in chat.
- **Acceptance:**
  - World Cup with 50 rows per table and seed 1: the CSV zip and the workbook hold the same values as the `.sql` script, checked by a spec that parses all three.
  - The zip opens with one CSV per table plus `README.txt`; the workbook opens in Excel with one sheet per table plus `About`.
  - Export profile in CSV and Excel lists every profiled column with the values the view shows.
  - Both formats work for a Databricks dataset (they do not depend on the dialect).
  - The `@demo @story-1.22.5` scenario passes.
  - Unit tests, builds and check-specs are green.
- **Notes:** requested on 2026-11-11 ("export the sample and synthetic data"; the user picked `.sql`, CSV and Excel). Depends on 1.22.2. UI story.

#### 1.22.6 — Export the raw sample  `✅ Done`
- **Intent:** download the real rows the profile was computed from, when the user explicitly asks for them and confirms that the file holds real data.
- **Scope:**
  - **Export sample rows** on the profile view, with the formats `SQL script`, `CSV (zip)` and `Excel (.xlsx)`.
  - A confirm dialog before every raw export: `This file contains real rows from <datasource>, including identifiers, names and free text. Export anyway?`. The synthetic and profile exports have no confirm.
  - The rows are **re-read on export** with the profile's tables, sample size and `REPEATABLE (7)` seed, through the same sampler and pooled read-only sessions. The cache still holds statistics only. A table that has changed, or a `limit` read, can give other rows than the ones profiled, and the file's README says so.
  - `.sql`: `CREATE SCHEMA` of a target (default `sample`), `CREATE TABLE` and `INSERT`s of the real values in the datasource's dialect, through the writers of 1.22.2 and 1.22.3. CSV and Excel: as in 1.22.5.
  - API: `POST /synthetic-data/sample-exports` (api.md 114), which answers 400 without `confirmRealData: true`. Nothing is logged or cached; the rows are streamed to the response and dropped.
  - Amend ADR-0039: raw rows may leave the server only through this explicit, confirmed download, never to a log, a cache, a session file or a model. Update the capability's privacy rules and the epic spec.
- **Out of scope:** raw rows in chat or in the agent tools; masking or partial redaction of the raw export; exporting more rows than the sample size.
- **Acceptance:**
  - Export sample rows on World Cup asks for confirmation, and Cancel downloads nothing.
  - After confirming, the CSV zip holds each table's real rows (`players.csv` has the real player names); the `.sql` script loads into a scratch PostgreSQL database with those rows.
  - The API refuses a request without `confirmRealData: true`.
  - A spec proves that no raw value reaches the logger or the profile cache during an export.
  - The `@demo @story-1.22.6` scenario passes.
  - Unit tests, builds and check-specs are green.
- **Notes:** requested on 2026-11-11. The user chose to re-sample on export, a confirm dialog, and the editor tab only. Depends on 1.22.3 (both dialect writers) and 1.22.5 (CSV and Excel writers). UI story.

#### 1.22.4 — Profile and synthesize from the Data Readiness Agent  `✅ Done`
- **Intent:** ask the Data Readiness Agent in chat for a sampled profile or a synthetic copy of the session's data, and download the script from the panel.
- **Scope:**
  - Two tools with scalar inputs (agents.md 3.14):
    - `profile_data_sample(dataset?, tables?)`;
    - `generate_synthetic_data(dataset?, tables?, rowsPerTable?, seed?, targetSchema?, profileId?)`.
  - Chat limits: 20 tables, 1,000 rows per table, a 256 KB script.
  - A tool-services bridge installed by `SessionsService`.
  - The script is saved in the session workspace under `synthetic-data/` and stored as a `file` panel item, so the panel's Download works unchanged.
  - The prompt: D12 widened and D14 added (Appendix D), with the generated `## Tools` section; the prompt delta is measured from the compiled agent.
  - Two eval cases, `dr-profile-sample` and `dr-synthetic-script`.
  - agents.md 2.10 and 3.14; data-readiness R3; data-model workspace files.
- **Out of scope:** these tools for the assistant, v2 or user agents; a new skill; raising the panel file limit; the CSV, Excel, profile and raw-sample exports of 1.22.5 and 1.22.6 (editor tab only, decided 2026-11-11).
- **Acceptance:**
  - In a Data Readiness session on World Cup, "give me 50 synthetic rows per table" calls `generate_synthetic_data` with 50 rows, and the panel shows the `.sql` file and downloads it.
  - "Profile a sample of the players table" quotes only numbers from the tool and never calls them scores.
  - A request over the chat limits gets the exact refusal.
  - The Data Readiness evals pass at 100 % over 3 runs at the gate.
  - The `@demo @story-1.22.4` scenario passes.
  - Unit tests, builds and check-specs are green.
- **Notes:** depends on 1.22.2 (and 1.22.3 for Databricks sessions). Shipped last (after 1.22.6) and on its own, so the eval cost is paid once. UI story (chat and panel).
  - **Prompt delta** (measured from the compiled agent, `dataReadinessInstructions()` before and after, LF): 4,676 → 5,716 characters (+1,040, +22 %), 741 → 907 words (+166), about +260 tokens per call. Of it, the two `## Tools` lines are about 430 characters, D14 about 450 and the D12 sentence about 90. No skill was added.

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

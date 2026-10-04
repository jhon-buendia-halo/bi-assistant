# Questions to Insights

Desktop application (Electron) with an Angular frontend and a NestJS backend.

```
frontend/   Angular app (Electron renderer) + Electron main process
backend/    NestJS API
specs/      the complete specification of the app
```

**What the app does and how it works is specified in [specs/](specs/README.md), not here.** Start there for any question about behaviour, endpoints, stored data, agents, UI, build or release. This file holds the rules for working in the repo.

Process documents (see **Workflow** below):

- [roadmap.md](roadmap.md) — pre-implementation plan for all work. See **Planning convention**. Longer-form phase plans live in [docs/plans/](docs/plans/); roadmap features link to them rather than duplicating them.
- [changelog.md](changelog.md) — running log of every change. See **Logging convention**.
- [specs/](specs/README.md) — the product, system, capability and epic specs; an LLM given only this folder can rebuild the app. Architecture and ADRs are in [specs/system/architecture.md](specs/system/architecture.md); user flows in Gherkin are in each capability spec. See **Spec convention**, **Architecture convention** and **Epic gate**.
- [retrospective.md](retrospective.md) — what went well and wrong on each completed change. See **Retrospective convention**.
- [evidence/](evidence/) — verifiable artifacts for each shipped change, linked from the changelog. See **Evidence convention**.

## Workflow — order of operations

> **MANDATORY FIRST ACTION — read [retrospective.md](retrospective.md) before doing anything else.** Before you restate the goal, ask a question, run a command, or touch a file — on *every* task, not just large ones — open [retrospective.md](retrospective.md) and read the lessons. They are recorded specifically so past mistakes are not repeated. This precedes step 1.

Every meaningful change follows this eleven-step workflow, in order. Do not skip a step. Steps are sequential gates; *within* a step, independent units still fan out to parallel subagents per **Model usage** above.

1. **Understand the goal** — restate the request in your own words before touching anything. What user-observable outcome are we after? What's the success criterion? Apply any lesson from [retrospective.md](retrospective.md) that bears on this task.
2. **Ask clarifying questions until the goal is 100% understood** — scope, behaviour, edge cases, acceptance criteria. Do not proceed to step 3 with unresolved questions.
3. **Update roadmap** — find or add the feature in [roadmap.md](roadmap.md) with `Intent`, `Scope`, `Acceptance` filled in; set status to `🚧 In progress`. See **Planning convention**. Before any file changes, confirm the user story belongs to a Jira epic (see **Epic gate**), then create the feature branch and its git worktree for it. See **Branching convention**.
4. **Update architecture** — if the change involves an architectural decision, record it as an ADR in [specs/system/architecture.md](specs/system/architecture.md) under the relevant C4 level *before* any code is written.
5. **Update specs** — before any test or code, update every spec the change affects: the epic spec, the capability spec's Rules and Gherkin Flows, and the system specs for any endpoint, persisted shape, prompt, UI or delivery change. The Gherkin is the executable spec the implementation is measured against. See **Spec convention**.
6. **Component impact-based analysis on E2E** — for every component / page / service / backend module touched, enumerate the Gherkin scenarios (in the capability specs) that exercise it and decide per scenario: *add / update / delete / re-run-as-is*. Produce the explicit list before writing any test or implementation code.
7. **Implement / update / delete E2E** — apply the step-6 decisions to [frontend/e2e/](frontend/e2e/) (and backend `test/*.e2e-spec.ts` where the flow is API-level) *first*. Run them and confirm they fail for the right reason.
8. **Implement changes** — only now is production code touched, built against the Acceptance criteria and the step-7 specs.
9. **Run E2E and fix until green** — `npm run test:e2e` in [frontend/](frontend/) (builds backend + Angular, then drives the real Electron app via `e2e/fixtures/electron.fixture`; global setup starts the World Cup Postgres with `docker compose up -d --wait postgres` unless `E2E_SKIP_DOCKER=1`, and aborts if port 3000 is busy), plus `npm test` / `npm run lint` / `npm run build` in [backend/](backend/) and `npm test` / `npm run build` in [frontend/](frontend/). Diagnose root causes; fix the test if the test was wrong, the implementation if it was wrong. Repeat until every spec is green.
10. **Update changelog with evidence** — only after step 9 is green, add a dated entry to [changelog.md](changelog.md) and capture the evidence under [evidence/](evidence/) (E2E summary, screenshots of the running app, exports). Mark the roadmap entry `✅ Done`. Confirm the specs touched in step 5 describe what actually shipped, and fix them in the same PR if not. See **Logging convention** and **Evidence convention**.
11. **Retrospective** — add a dated entry to [retrospective.md](retrospective.md): what went well, what went wrong, what to do differently. Step 1 of the *next* change reads it.

Versioning stays automatic (see **Versioning** under **Code rules**): the changelog is the human-readable record of *what* shipped, Conventional Commit subjects still drive the version bump.

## Planning convention — read before building

**Every feature must be defined in [roadmap.md](roadmap.md) before any code is written for it.** The roadmap uses a strict **Release → Milestone → Feature** hierarchy with numeric IDs (`R`, `R.M`, `R.M.F`) and a status legend (`📋 Planned`, `🚧 In progress`, `✅ Done`, `🚫 Cut`). A feature is only ready to start when its Intent, Scope, and Acceptance fields are filled in.

1. Find or add the entry in [roadmap.md](roadmap.md) first.
2. Confirm Intent / Scope / Acceptance are present before touching code.
3. Update status to `🚧 In progress`, then `✅ Done` when merged and verified.
4. If something gets cut, leave the entry with status `🚫 Cut` and a one-line reason.

Items in the **Backlog** section are not yet sequenced into a release. Promote them into a Milestone before starting work.

### Find the right feature — don't just append

When a new requirement arrives, the first move is a classification step, not "append at the bottom":

1. **Identify the milestone** the work belongs to — read each milestone's description; they exist for this.
2. **Decide add / extend / split:** extend an existing feature's `Scope` / `Acceptance` / `Notes` if the work fits it; otherwise add a new feature under the *right* milestone, slotted in dependency order; if no milestone fits cleanly, propose a new milestone or restate boundaries *before* adding the feature.
3. **Then write the entry** with Intent / Scope / Out-of-scope / Acceptance / Notes, and update cross-references in features that touch it.

The roadmap is read top-to-bottom; ordering and grouping carry meaning.

## Logging convention — record every change

**Every meaningful change must be logged in [changelog.md](changelog.md), as the *final* implementation step (step 10).** Reverse-chronological dated sections (`## YYYY-MM-DD`) with categorized subsections (`### Added`, `### Changed`, `### Removed`, `### Cut`, `### Fixed`). Bundle related edits from one session into one bullet; reference the affected file or roadmap feature ID. Never rewrite past entries — fix forward with a new dated entry. Roadmap status transitions get a matching changelog entry at the same time. **Every entry links to its evidence.**

## Evidence convention — every shipped change is independently verifiable

**Every change logged in [changelog.md](changelog.md) must be backed by artifacts in [evidence/](evidence/), linked from the entry**, so the user can confirm the work without re-running anything.

Layout: one folder per shipped change, keyed by roadmap feature ID — `evidence/<feature-id>/` (e.g. `evidence/1.2.3/`). Store:

- **E2E results** — the `npm run test:e2e` summary (`e2e-results.txt`) and/or the Playwright HTML report / trace (`frontend/playwright-report/`, `frontend/test-results/`) for the specs exercising the change, naming the spec files so evidence maps back to Gherkin scenarios.
- **Screenshots** — of the running Electron app (Playwright `page.screenshot` in the Electron fixture works), named for what they show (`visual-panel-revert.png`, not `screenshot1.png`), capturing the actual claimed state.
- **Other artifacts** — exported visuals (`index.html`, `answer.md`, `data.json`), sample API responses, diagnostics reports, short recordings.

Link with a relative path: `Evidence: [evidence/1.2.3/](evidence/1.2.3/)`. Keep artifacts lightweight. If a change genuinely produces no observable artifact, say so explicitly — *"Evidence: existing E2E suite green, no UI change"*.

## Architecture convention — record every architectural decision

**Every architectural decision is documented in [specs/system/architecture.md](specs/system/architecture.md) using the C4 model** (System Context → Containers → Components → Code), as short ADRs with `ID`, `Title`, `Status`, `Date`, `Context`, `Decision`, `Consequences`. Never edit a prior ADR's substance — supersede it with a new ADR and mark the old one `Superseded by ADR-NNNN`.

Architectural: choosing or replacing a framework, splitting/merging containers (Electron main, renderer, NestJS backend, npm CLI), introducing an external system (LLM provider, datasource type), changing data-flow direction, new integration boundaries, persistence-shape changes that need migrations. Not architectural: file moves, renames, day-to-day feature work (roadmap + changelog). The other system specs in [specs/system/](specs/system/) record *how* things work; ADRs record *why*.

## Spec convention — the specs describe the shipped app, completely

**[specs/](specs/README.md) is the single source of truth for what the app does and how it is built, complete enough that an LLM given only that folder could rebuild the app.** Layout, formats, stack-neutrality and the rebuild prompt are in [specs/README.md](specs/README.md).

- **Specs change with the code, on the same branch** (workflow step 5). A PR that changes behaviour, an endpoint, a persisted shape, an agent prompt or tool, the UI, or the build and release process without the matching spec change is incomplete. Because specs change on the branch, `main` always describes the shipped app.
- **Where things go:** behaviour rules and user flows → `specs/capabilities/<capability>/spec.md`; endpoints, IPC and CLI → `system/api.md`; collections, document shapes, files on disk and migrations → `system/data-model.md`; agents, prompts, tools and model routing → `system/agents.md`; layout, screens, tokens and copy → `system/ui.md`; frameworks, versions and code layout → `system/tech-stack.md`; build, packaging and release → `system/delivery.md`; terms → `product/glossary.md`. A new capability gets a new folder and a row in the [specs/README.md](specs/README.md) table.
- **Each fact lives in one file.** Link to it; never copy it.
- **Gherkin:** every user-facing flow is a `Scenario:` under a `Feature:` in the Flows section of the capability spec that owns it, in standard Gherkin (`Given / When / Then / And`). It covers navigation, dialogs, panels, toasts, form submits, chat/stream behaviour and visual tailoring, but not purely visual tweaks or internal refactors. Write from the user's point of view (`When I click "New session"`), not the implementation's. Each Feature names its Playwright spec file, or says `E2E: none yet`.

## E2E test convention — every flow change triggers an impact analysis on Playwright

**Playwright specs in [frontend/e2e/](frontend/e2e/) are the executable mirror of the Gherkin Features in [specs/capabilities/](specs/capabilities/)** — one spec file per Gherkin `Feature:`. A Feature marked `E2E: none yet` gets its spec file the first time a change touches it. Whenever step 5 touches a scenario, perform the step-6 analysis and decide per scenario: **Add**, **Update**, **Delete**, or **Re-run as-is**. Test edits (step 7) land before the implementation (step 8); don't ship a flow change without the matching E2E change, nor with any impacted spec red.

Scope: Playwright covers end-to-end behaviour in the real Electron app. Unit tests stay beside their source (`*.spec.ts` — Jest in backend, `ng test` in frontend) and are not governed by this rule. Visual baselines (`*-snapshots/`) are updated only with `npm run test:e2e:update` and only when the visual change is intended.

## Retrospective convention — capture lessons so the next run is better

**Every completed change closes with an entry in [retrospective.md](retrospective.md) (step 11), and reading that file is the mandatory first action of the next task.** Reverse-chronological dated sections (`## YYYY-MM-DD`), one per shipped change, referencing the roadmap feature ID, with three subsections:

- **What went well** — specific decisions, tests, or conventions worth repeating, and why.
- **What went wrong** — misread goals, regressions, skipped or out-of-order steps, lost time. An entry with no `What went wrong` means you didn't look hard enough.
- **What to do differently** — a concrete instruction your future self can follow ("before renaming a persisted field, add it to `LEGACY_DOC_FIELDS`"), not "be more careful".

Skip only for trivial, zero-risk edits. Never rewrite a past entry. When a recurring lesson hardens into a rule, promote it into the relevant convention (or CLAUDE.md proper) and note the promotion.

## Epic gate — no Jira epic, no code change

**Every new code change must map to a Jira epic in project BA. If it does not, the change is not done: do not branch, edit code or open a PR.** This is a hard gate, checked before step 3 of the workflow.

- The change maps to an epic when its Jira issue (the Story or Bug in the branch name) has an Epic as its `parent`, or the issue is that Epic itself. Check with `.claude/skills/jira/scripts/jira.sh issue <US-ID>` and read the `parent` field, then confirm the parent's `issuetype` is `Epic`.
- No epic: stop and tell the user which issue has no epic. Ask them to link it to an existing epic or create one (with the `jira` skill, with confirmation). Never pick an epic yourself or invent a key.
- The epic also appears in the matching [roadmap.md](roadmap.md) milestone (each milestone mirrors one epic) and in the PR description next to the issue link.
- **Every epic has a high-level spec** at `specs/epics/<EPIC-ID>/spec.md` (e.g. `specs/epics/BA-12/spec.md`), in the format in [specs/README.md](specs/README.md): goal, scope, out of scope, stories, the capability and system specs it touches, acceptance, and dependencies, risks and open questions. If the epic has no spec yet, or its spec is still `Status: Draft`, write or finish it before any code for its stories and get the user to confirm it (`Status: Confirmed`).
- Keep the epic spec high level. Story detail lives in the roadmap and Jira, behaviour in the capability specs, decisions in [specs/system/architecture.md](specs/system/architecture.md); link to them rather than copying. Update the spec when the epic's scope changes, and link it from the matching roadmap milestone.

## Branching convention — one Jira issue, one feature branch, one worktree

**Every new PR must be developed in its own feature branch, checked out in its own git worktree, and tied to an existing Jira issue: a user story, or a bug for `fix/` branches.** No work goes directly on `main` or the default branch, and no branch is created without a Jira issue behind it.

- **Branch name:** `<type>/<US-ID>-<short-description>`
  - `<type>` is a Conventional Commit type: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci` or `build`. It should match the PR's main commit type, because `version-on-merge.yml` derives the version bump from it.
  - `<US-ID>` is the key of an **existing** Jira issue in project BA (a Story, or a Bug for `fix/` work such as `fix/BA-83-empty-session-thread`), uppercase as Jira shows it (e.g. `BA-79`). Check that it exists with `.claude/skills/jira/scripts/jira.sh issue <US-ID>` before creating the branch. If there is no issue yet, stop and ask the user to create one (or create it with the `jira` skill, with confirmation). Never invent an ID. The issue must also belong to an epic. See **Epic gate**.
  - `<short-description>` is lowercase kebab-case, a few words, ASCII only.
  - Example: `feat/BA-79-ontology-bootstrap`.
- **Worktree:** one per branch, under `.claude/worktrees/`, named after the branch without the type:
  ```bash
  git worktree add .claude/worktrees/BA-79-ontology-bootstrap -b feat/BA-79-ontology-bootstrap main
  ```
  When the Claude desktop app creates the worktree for the session, rename its branch to the convention (`git branch -m <type>/<US-ID>-<short-description>`) before the first commit.
- **Traceability:** the user story's ID also appears in the matching [roadmap.md](roadmap.md) feature, the PR title (`feat(BA-79): …` or `feat: … (BA-79)`) and the PR description (link to the Jira issue). One PR covers one issue; split work that spans several.
- **Cleanup:** after the PR merges, remove the worktree (`git worktree remove …`) and delete the branch.

## Worktree deploy convention — always ask which target

**When work happens in a git worktree (any path under `.claude/worktrees/`), do not silently run against shared state.** Before starting the app or the Postgres compose stack from a worktree, ask: *run against the shared data dir / main compose stack, or an isolated one for this worktree?* The Electron app and the `npx` CLI default to shared data dirs (`userData`, `~/.questions-to-insights`) and backend port 3000; the compose Postgres uses project name `questions-to-insights-world-cup` and port 55432 — a second instance collides unless isolated (CLI `--data-dir` and `--port`; desktop `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR`; `docker compose -p <name>` with `WORLD_CUP_DB_PORT`). A second *desktop* instance can't run on another port until roadmap 0.1.1 lands, so use the CLI for side-by-side runs. Details: [specs/system/delivery.md](specs/system/delivery.md). Skip the question only when the user has already named the target in the same turn. Merging the worktree back goes through `sync_with_base_branch` / a PR, never a silent push.

## Model usage: plan vs. execute

For planning purposes, Fable creates the plan.

For execution, do not pin a fixed model. Once the execution plan is well defined, the session LLM picks whichever model version it judges best for the work at hand (capability vs. speed vs. cost for that plan) and runs the plan with it.

Execute by fanning out: split the plan into independent units of work and dispatch them to parallel subagents (all agent calls for independent units go out in a single message so they run concurrently). Keep sequential only what genuinely depends on a previous result. The session LLM chooses the model per subagent the same way — cheap/fast models for mechanical or narrow-scope units, stronger models for units needing design judgment or cross-file reasoning.

## Code rules — the short list to keep in mind while coding

How the app is built and works is in [specs/system/](specs/system/): [tech-stack.md](specs/system/tech-stack.md) (frameworks, versions, folder layout), [delivery.md](specs/system/delivery.md) (scripts, packaging, npm package, versioning, release), [data-model.md](specs/system/data-model.md), [api.md](specs/system/api.md), [agents.md](specs/system/agents.md), [ui.md](specs/system/ui.md). The rules below are the ones that bite when ignored.

### Frontend (Angular renderer + Electron main)

- **Feature-based folders.** New feature = `src/app/features/<feature>/` with `components/`, `services/`, `models/` (and `pages/`, `store/`, a lazy `<feature>.routes.ts` once routing exists). `core/` holds app-wide singletons, `shared/` presentational pieces with no feature logic. Full tree and current state: [tech-stack.md](specs/system/tech-stack.md).
- Standalone components + signals, no NgModules. Tailwind CSS v4, `lucide-angular` icons.
- Electron builds use `--base-href ./`. An absolute `/` base breaks asset loading over `file://`.
- Electron IPC goes only through `frontend/electron/preload.cjs` (`contextBridge`); keep `contextIsolation` on and `nodeIntegration` off.
- `SessionChat` re-syncs from its `session` input only when the session **id** changes. Same-id refreshes (visual metadata) must not abort an in-flight stream.
- **Known gap:** under `file://` the renderer hardcodes `http://localhost:3000`, so a non-default `BACKEND_PORT` breaks the desktop renderer. Tracked as roadmap 0.1.1.

### Backend (NestJS)

- **Feature-based modules.** New feature = `src/modules/<feature>/` with `<feature>.module.ts`, controller, service and `dto/`, `entities/`, `repositories/` as needed, registered in `app.module.ts`. Technical concerns go in `infrastructure/`; feature modules depend on it, never the reverse.
- **New collection** = add `{ token, table }` to `COLLECTIONS` in `database.module.ts` and a token in `doc-store.ts`. Repositories inject the token, never the db handle.
- **Renaming a collection or a persisted field needs a migration**, or existing installs silently start empty: `LEGACY_TABLE_NAMES` for tables, `LEGACY_DOC_FIELDS` for fields on sorted collections (raw SQL, so `updatedAt` is not restamped), covered by `database.module.spec.ts`. Record it in [data-model.md](specs/system/data-model.md).
- **New agent** = a file in `src/mastra/agents/` plus registration in `src/mastra/index.ts`, and an entry in [agents.md](specs/system/agents.md). Its `model` is `async () => resolveAgentModel()`; never hardcode a provider.
- `APP_DATA_DIR` is read at import time by `database.module.ts` and `mastra/storage.ts`, so it must be set before the app module is imported (the CLI does this).

### Versioning

Never edit `version` by hand. Conventional Commit subjects drive the automatic bump on merge; installers and the npm package are built manually. See [delivery.md](specs/system/delivery.md).

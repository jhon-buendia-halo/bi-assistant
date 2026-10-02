# Questions to Insights

Desktop application (Electron) with an Angular frontend and a NestJS backend.

```
frontend/   Angular app (Electron renderer) + Electron main process
backend/    NestJS API
```

Process documents at the repo root (see **Workflow** below):

- [roadmap.md](roadmap.md) — pre-implementation plan for all work. See **Planning convention**. Longer-form phase plans live in [docs/plans/](docs/plans/); roadmap features link to them rather than duplicating them.
- [changelog.md](changelog.md) — running log of every change. See **Logging convention**.
- [architecture.md](architecture.md) — architectural decisions, recorded against the C4 model. See **Architecture convention**.
- [gherkin.md](gherkin.md) — every user-facing flow in Gherkin. See **Gherkin convention**.
- [retrospective.md](retrospective.md) — what went well and wrong on each completed change. See **Retrospective convention**.
- [evidence/](evidence/) — verifiable artifacts for each shipped change, linked from the changelog. See **Evidence convention**.

## Workflow — order of operations

> **MANDATORY FIRST ACTION — read [retrospective.md](retrospective.md) before doing anything else.** Before you restate the goal, ask a question, run a command, or touch a file — on *every* task, not just large ones — open [retrospective.md](retrospective.md) and read the lessons. They are recorded specifically so past mistakes are not repeated. This precedes step 1.

Every meaningful change follows this eleven-step workflow, in order. Do not skip a step. Steps are sequential gates; *within* a step, independent units still fan out to parallel subagents per **Model usage** above.

1. **Understand the goal** — restate the request in your own words before touching anything. What user-observable outcome are we after? What's the success criterion? Apply any lesson from [retrospective.md](retrospective.md) that bears on this task.
2. **Ask clarifying questions until the goal is 100% understood** — scope, behaviour, edge cases, acceptance criteria. Do not proceed to step 3 with unresolved questions.
3. **Update roadmap** — find or add the feature in [roadmap.md](roadmap.md) with `Intent`, `Scope`, `Acceptance` filled in; set status to `🚧 In progress`. See **Planning convention**. Before any file changes, create the feature branch and its git worktree for the matching user story. See **Branching convention**.
4. **Update architecture** — if the change involves an architectural decision, record it as an ADR in [architecture.md](architecture.md) under the relevant C4 level *before* any code is written.
5. **Update gherkin** — if the change adds, alters, or removes a user-facing flow, update [gherkin.md](gherkin.md) first: it is the executable spec the implementation is measured against.
6. **Component impact-based analysis on E2E** — for every component / page / service / backend module touched, enumerate the Gherkin scenarios that exercise it and decide per scenario: *add / update / delete / re-run-as-is*. Produce the explicit list before writing any test or implementation code.
7. **Implement / update / delete E2E** — apply the step-6 decisions to [frontend/e2e/](frontend/e2e/) (and backend `test/*.e2e-spec.ts` where the flow is API-level) *first*. Run them and confirm they fail for the right reason.
8. **Implement changes** — only now is production code touched, built against the Acceptance criteria and the step-7 specs.
9. **Run E2E and fix until green** — `npm run test:e2e` in [frontend/](frontend/) (builds backend + Angular, then drives the real Electron app via `e2e/fixtures/electron.fixture`; `world-cup-workflow.spec.ts` needs `docker compose up -d postgres` from the repo root), plus `npm test` / `npm run lint` / `npm run build` in [backend/](backend/) and `npm test` / `npm run build` in [frontend/](frontend/). Diagnose root causes; fix the test if the test was wrong, the implementation if it was wrong. Repeat until every spec is green.
10. **Update changelog with evidence** — only after step 9 is green, add a dated entry to [changelog.md](changelog.md) and capture the evidence under [evidence/](evidence/) (E2E summary, screenshots of the running app, exports). Mark the roadmap entry `✅ Done`. See **Logging convention** and **Evidence convention**.
11. **Retrospective** — add a dated entry to [retrospective.md](retrospective.md): what went well, what went wrong, what to do differently. Step 1 of the *next* change reads it.

Versioning stays automatic (see **Versioning and releases**): the changelog is the human-readable record of *what* shipped, Conventional Commit subjects still drive the version bump.

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

**Every architectural decision is documented in [architecture.md](architecture.md) using the C4 model** (System Context → Containers → Components → Code), as short ADRs with `ID`, `Title`, `Status`, `Date`, `Context`, `Decision`, `Consequences`. Never edit a prior ADR's substance — supersede it with a new ADR and mark the old one `Superseded by ADR-NNNN`.

Architectural: choosing or replacing a framework, splitting/merging containers (Electron main, renderer, NestJS backend, npm CLI), introducing an external system (LLM provider, datasource type), changing data-flow direction, new integration boundaries, persistence-shape changes that need migrations. Not architectural: file moves, renames, day-to-day feature work (roadmap + changelog). The detailed operational notes further down this file stay authoritative for *how* things work; ADRs record *why*.

## Gherkin convention — keep user flows current

**Every user-facing flow in the app must be documented in [gherkin.md](gherkin.md), updated as part of any change that affects a flow.** Each surface lives under a `Feature:` heading with `Scenario:`s in standard Gherkin (`Given / When / Then / And`). Applies to navigation, dialogs, panels, toasts, form submits, chat/stream behaviour, visual tailoring — not to purely visual tweaks or internal refactors. Write from the user's point of view (`When I click "New session"`), not the implementation's.

## E2E test convention — every flow change triggers an impact analysis on Playwright

**Playwright specs in [frontend/e2e/](frontend/e2e/) are the executable mirror of [gherkin.md](gherkin.md)** — one spec file per Gherkin `Feature:`. Whenever step 5 touches a scenario, perform the step-6 analysis and decide per scenario: **Add**, **Update**, **Delete**, or **Re-run as-is**. Test edits (step 7) land before the implementation (step 8); don't ship a flow change without the matching E2E change, nor with any impacted spec red.

Scope: Playwright covers end-to-end behaviour in the real Electron app. Unit tests stay beside their source (`*.spec.ts` — Jest in backend, `ng test` in frontend) and are not governed by this rule. Visual baselines (`*-snapshots/`) are updated only with `npm run test:e2e:update` and only when the visual change is intended.

## Retrospective convention — capture lessons so the next run is better

**Every completed change closes with an entry in [retrospective.md](retrospective.md) (step 11), and reading that file is the mandatory first action of the next task.** Reverse-chronological dated sections (`## YYYY-MM-DD`), one per shipped change, referencing the roadmap feature ID, with three subsections:

- **What went well** — specific decisions, tests, or conventions worth repeating, and why.
- **What went wrong** — misread goals, regressions, skipped or out-of-order steps, lost time. An entry with no `What went wrong` means you didn't look hard enough.
- **What to do differently** — a concrete instruction your future self can follow ("before renaming a persisted field, add it to `LEGACY_DOC_FIELDS`"), not "be more careful".

Skip only for trivial, zero-risk edits. Never rewrite a past entry. When a recurring lesson hardens into a rule, promote it into the relevant convention (or CLAUDE.md proper) and note the promotion.

## Branching convention — one Jira epic, one feature branch, one worktree

**Every PR is developed in its own feature branch, checked out in its own git worktree, and tied to an existing Jira epic** (or a Bug for `fix/` branches). No work goes directly on `main` or the default branch, and no branch is created without a Jira issue behind it. Adopted 2026-10-02 for BA-2: epics are not split into one branch per user story any more — the epic is the unit of delivery, and the description of all the work done lives in the epic (Jira description + the matching roadmap milestone and changelog entries). Stories under an epic, when they exist, are planning aids and map to roadmap features, not to branches.

- **Branch name:** `<type>/<EPIC-ID>-<short-description>`
  - `<type>` is a Conventional Commit type: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci` or `build`. It should match the PR's main commit type, because `version-on-merge.yml` derives the version bump from it.
  - `<EPIC-ID>` is the key of an **existing** Jira Epic in project BA (or a Bug for `fix/` work such as `fix/BA-83-empty-session-thread`), uppercase as Jira shows it (e.g. `BA-2`). Check that it exists with `.claude/skills/jira/scripts/jira.sh issue <EPIC-ID>` before creating the branch. If there is no issue yet, stop and ask the user to create one (or create it with the `jira` skill, with confirmation). Never invent an ID.
  - `<short-description>` is lowercase kebab-case, a few words, ASCII only.
  - Example: `feat/BA-2-data-model-dsl`.
- **Worktree:** one per branch, under `.claude/worktrees/`, named after the branch without the type:
  ```bash
  git worktree add .claude/worktrees/BA-2-data-model-dsl -b feat/BA-2-data-model-dsl main
  ```
  When the Claude desktop app or Conductor creates the worktree for the session, rename its branch to the convention (`git branch -m <type>/<EPIC-ID>-<short-description>`) before the first commit, unless the tool forbids renaming — then keep its name and carry the epic key in the PR title.
- **Commits inside the branch:** one commit per completed roadmap feature (`feat(BA-2): <feature title>`), so the epic branch's history still tells the story feature by feature.
- **Traceability:** the epic's key appears in the matching [roadmap.md](roadmap.md) milestone, the PR title (`feat(BA-2): …` or `feat: … (BA-2)`) and the PR description (link to the Jira epic). One PR covers one epic. When the PR merges, paste the changelog entries for the epic into the epic's Jira description (with the `jira` skill, with confirmation).
- **Cleanup:** after the PR merges, remove the worktree (`git worktree remove …`) and delete the branch.

## Worktree deploy convention — always ask which target

**When work happens in a git worktree (any path under `.claude/worktrees/`), do not silently run against shared state.** Before starting the app or the Postgres compose stack from a worktree, ask: *run against the shared data dir / main compose stack, or an isolated one for this worktree?* The Electron app and the `npx` CLI default to shared data dirs (`userData`, `~/.questions-to-insights`) and backend port 3000; the compose Postgres uses project name `questions-to-insights-world-cup` and port 55432 — a second instance collides unless isolated (`--data-dir`, `BACKEND_PORT`/`--port`, `docker compose -p <name>` with `WORLD_CUP_DB_PORT`). Skip the question only when the user has already named the target in the same turn. Merging the worktree back goes through `sync_with_base_branch` / a PR, never a silent push.

## Model usage: plan vs. execute

For planning purposes, Fable creates the plan.

For execution, do not pin a fixed model. Once the execution plan is well defined, the session LLM picks whichever model version it judges best for the work at hand (capability vs. speed vs. cost for that plan) and runs the plan with it.

Execute by fanning out: split the plan into independent units of work and dispatch them to parallel subagents (all agent calls for independent units go out in a single message so they run concurrently). Keep sequential only what genuinely depends on a previous result. The session LLM chooses the model per subagent the same way — cheap/fast models for mechanical or narrow-scope units, stronger models for units needing design judgment or cross-file reasoning.

## Frontend — Angular (Electron desktop app)

This is a **desktop application**: Electron shell with the Angular app as renderer.

- Electron main process: `frontend/electron/main.cjs` (`titleBarStyle: 'hiddenInset'`, no nodeIntegration, contextIsolation on).
- **Single-app delivery**: the main process spawns the NestJS backend as a child process on startup (`ELECTRON_RUN_AS_NODE=1` + Electron's own binary, so packaged apps need no system Node) and kills it on quit. Backend listens on port 3000 (`BACKEND_PORT` env overrides it for the backend and the main process's `GET /sessions` readiness probe); renderer reads `API_BASE_URL` from `src/app/core/config/api.config.ts`. **Known gap:** under `file://` the renderer hardcodes `http://localhost:3000` and the preload bridge does not expose the port, so a non-default `BACKEND_PORT` breaks the Electron renderer — tracked as roadmap 0.1.1.
- `npm run electron` — production-style: builds backend + Angular (`--base-href ./` — required, absolute `/` base breaks asset loading over `file://`) and opens the app.
- `npm run electron:dev` — points the window at `ng serve` on http://localhost:4200 for live reload (run `npm start` first; backend spawns from `backend/dist` if built).
- `npm run electron:dist` — full package via electron-builder: stages backend (`scripts/stage-backend.sh` → `backend/release-staging` with dist + prod-only node_modules), bundles it as `extraResources`, output in `frontend/release/`. Note: `extraResources` needs the explicit second `node_modules` mapping in `package.json` — electron-builder silently drops node_modules otherwise.

### Versioning and releases

`frontend/package.json`'s `version` is the single source of truth (electron-builder reads it; `backend/package.json` is kept in lockstep). Installer filenames carry it via `build.artifactName`: `Questions-to-Insights-<version>-<os>-<arch>.<ext>` (e.g. `Questions-to-Insights-0.1.1-mac-arm64.dmg`, `…-win-x64.exe`).

**Versioning is automatic, building is manual.**

- `.github/workflows/version-on-merge.yml` runs on every push to the default branch (`implement-empty-layout`, plus `main`): it derives the bump from the Conventional Commit subjects since the last `v*` tag (`BREAKING CHANGE` or `type!:` → major, `feat:` → minor, otherwise patch), writes the new version into both `package.json` + lockfiles, commits `chore(release): vX.Y.Z` and pushes the tag. It builds nothing; the run summary tells you which tag to build. Its own bump commit is filtered out of the trigger (`if: !startsWith(head_commit.message, 'chore(release):')`) and a `version-on-merge` concurrency group serializes back-to-back merges.
- `.github/workflows/build-desktop.yml` builds installers on demand: **Actions → Build desktop installers → Run workflow**. Each platform is its own checkbox — `windows_x64`, `macos_arm64`, `macos_x64`, all defaulting to true — so any combination is buildable and a run costs one runner per ticked box. The other inputs are `ref` (the tag/branch/SHA to build, usually the `vX.Y.Z` the merge produced) and `publish` (attach the installers to that tag's GitHub release). A hand-pushed `v*` tag carries no inputs, which the `prepare` job reads as "build everything"; unticking every box fails the run with a clear message. `prepare` turns the ticked boxes into the job matrix (`{"include":[…]}`). Because publishing uploads with `--clobber`, separate per-platform runs accumulate on the same release instead of replacing each other.
- **Publishing does not need an existing tag.** `prepare` checks out the ref and resolves the tag itself: a `v*` ref publishes to that tag, anything else (branch, SHA, empty) takes the version committed at that ref (`frontend/package.json`) and walks the patch level up until it finds a tag no other commit owns — so building `main` twice gives `v0.13.0` then `v0.13.1` instead of clobbering a shipped release. `gh release create --target <sha>` creates the tag at the built commit, so no tag is pushed unless the build succeeded, and the `Stamp the resolved version` step writes the resolved version into both `package.json`s before building so the installer filename always matches the tag.
- The default branch must allow pushes from `github-actions[bot]` (version commit + tag). Protected-branch rules need a bypass for it, otherwise the version job fails at push.
- Tags pushed by `GITHUB_TOKEN` do not trigger other workflows — that is what keeps merge-time tagging from kicking off builds.

### Web app via npm / npx

Besides the Electron installers, the app ships as the npm package **`@jhon-buendia-halo/questions-to-insights`** on **GitHub Packages** (`npm.pkg.github.com`; `backend/package.json` — the backend *is* the package; the Angular build is bundled into it). GitHub Packages requires the scope to equal the repo owner (lowercase), so the name is scoped, but the installed binary stays `questions-to-insights`. `license` is `UNLICENSED` (private repo, no LICENSE file). Developers run it with `npx @jhon-buendia-halo/questions-to-insights` or `npm i -g @jhon-buendia-halo/questions-to-insights && questions-to-insights`.

- **Consumer auth**: GitHub Packages requires a token for every npm install (npx included). `~/.npmrc` needs `@jhon-buendia-halo:registry=https://npm.pkg.github.com` + `//npm.pkg.github.com/:_authToken=<PAT with read:packages>`.

- **CLI**: `backend/src/cli.ts` → `dist/cli.js` (`bin`). Flags: `--port` (default 3000, falls back to a free port when busy; an explicit busy port exits 1), `--host` (default `127.0.0.1`), `--data-dir` (default `$QTI_DATA_DIR`, `$APP_DATA_DIR`, else `~/.questions-to-insights` — deliberately separate from the Electron `userData` dir so both can run at once without SQLite lock fights), `--no-open`, `--help`, `--version`. It sets `APP_DATA_DIR` and `APP_SECRET` (read/created at `<data-dir>/.app-secret`, mode 0600, same semantics as `resolveAppSecret` in `electron/main.cjs`) *before* dynamically importing the app, because `database.module.ts` and `mastra/storage.ts` read `APP_DATA_DIR` at import time. CORS stays off in this mode (same-origin); `main.ts` (Electron path) still enables it.
- **Bootstrap**: `backend/src/app-bootstrap.ts` `createApp()` is shared by `main.ts` and the CLI. When `<webRoot>/index.html` exists (`WEB_ROOT` env, else `backend/public/`) it serves static assets and a SPA fallback implemented as a `@Catch(NotFoundException)` filter — API controllers keep priority, only unmatched `GET` + `Accept: text/html` + no-extension paths get `index.html`. No `index.html` → API only, exactly as before (Electron-staged backend has no `public/`).
- **Frontend**: `API_BASE_URL` (`core/config/api.config.ts`) is `''` (same origin) unless running from `file://` (Electron → `http://localhost:3000`). `npm run build:web` in `frontend/` builds with base href `/`; Electron builds keep `--base-href ./`.
- **Build / pack**: in `backend/`, `npm run build:web` (frontend build + `scripts/copy-web.js` → `backend/public/`, gitignored), `npm run build:all`, `prepack` runs `build:all` so `npm pack` / `npm publish` always ship a fresh UI. `files` = `dist` + `public` (no `src/`, `test/`, tsbuildinfo). Test locally with `npm pack` then `npm i <tarball>` in a scratch dir and run the bin.
- **Publishing**: `.github/workflows/publish-npm.yml`, manual only (**Actions → Publish npm package → Run workflow**) — the version-on-merge tag is pushed by `GITHUB_TOKEN` and so triggers nothing. Inputs: `ref` (the `vX.Y.Z` tag from version-on-merge, or any branch/SHA; empty = dispatch branch) and `dry_run` (`npm publish --dry-run`, no upload). It checks out the ref, fails early with a clear message if `name@version` from `backend/package.json` already exists on the registry (`npm view`; GitHub Packages 409s on re-publish), runs `npm ci --legacy-peer-deps` in `frontend/` + `backend/`, then an explicit `npm run build:all` and `npm publish --ignore-scripts` (so `prepack` does not rebuild; the tarball is exactly the logged build). Auth is `GITHUB_TOKEN` (`packages: write`; the `repository` field links the package to this repo); `publishConfig.registry` is `https://npm.pkg.github.com`. The run summary lists `name@version` and the `.npmrc` + `npx` install commands.

### Architecture: feature-based

All frontend code follows this feature-based structure. Every feature gets its own folder under `src/app/features/` containing everything that belongs to it (pages, components, services, models, store, routes).

```
frontend/src/
├── app/
│   ├── features/
│   │   ├── users/
│   │   │   ├── pages/
│   │   │   │   ├── user-list/
│   │   │   │   │   ├── user-list.ts
│   │   │   │   │   ├── user-list.html
│   │   │   │   │   └── user-list.scss
│   │   │   │   └── user-detail/
│   │   │   ├── components/
│   │   │   │   ├── user-card/
│   │   │   │   └── user-form/
│   │   │   ├── services/
│   │   │   │   └── users.service.ts
│   │   │   ├── models/
│   │   │   │   └── user.model.ts
│   │   │   ├── store/
│   │   │   │   └── users.store.ts
│   │   │   └── users.routes.ts
│   │   ├── orders/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   ├── services/
│   │   │   ├── models/
│   │   │   ├── store/
│   │   │   └── orders.routes.ts
│   │   └── payments/
│   │       └── ...
│   ├── core/
│   │   ├── auth/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   ├── api/
│   │   └── config/
│   ├── shared/
│   │   ├── components/
│   │   ├── directives/
│   │   ├── pipes/
│   │   └── utils/
│   ├── app.routes.ts
│   └── app.config.ts
└── main.ts
```

(`users/`, `orders/`, `payments/` above are examples — actual features are whatever this project needs.)

### Rules

- **New feature = new folder in `src/app/features/<feature>/`** with `pages/`, `components/`, `services/`, `models/`, `store/` as needed and a `<feature>.routes.ts` lazy-loaded from `app.routes.ts`.
- **Pages vs components**: `pages/` are routed views; `components/` are feature-internal building blocks. Each lives in its own folder with `.ts` / `.html` / `.scss` files.
- **`core/`**: app-wide singletons — auth, guards, interceptors, API clients, config. Loaded once, never imported by other features' templates.
- **Current state vs. the target above**: the app is not routed yet — `app.routes.ts` is empty and the shell (`app.ts`) imports each feature's components directly. Features (`agents`, `data-model`, `datasets`, `datasources`, `knowledge`, `llm`, `sessions`, `testing-data`) have `components/`, `services/`, `models/` but no `pages/`, `store/` or `<feature>.routes.ts`. Populated `core/` folders are `config`, `backend-status`, `diagnostics`, `toast`; `core/api`, `auth`, `guards`, `interceptors` are empty placeholders. The metrics UI lives in `features/data-model` (`model-metrics-panel`, `data-model-api.service`) and is the metrics panel's editor of record (roadmap 1.2.3) — it reads and writes the dataset's data model directly, not the legacy `metrics` store; the former `features/datasets/components/metrics-panel` was deleted. Electron IPC goes through `frontend/electron/preload.cjs` (`contextBridge`, currently diagnostics export). When the first routed view is introduced, adopt the `pages/` + lazy `<feature>.routes.ts` convention for it.
- **`shared/`**: reusable presentational components, directives, pipes, utils. No feature logic, no services with state.
- Standalone components + signals (no NgModules). Styling with Tailwind CSS (v4 via `@tailwindcss/postcss`); icons via `lucide-angular`.

## Backend — NestJS

### Application datastore (SQLite)

Mirrored from data-readiness-agent (its ADR-0027 pattern): a small `DocStore<T>` interface (`src/infrastructure/database/doc-store.ts`) with a better-sqlite3 adapter (`sqlite-doc-store.ts`) — one table per collection, each row one JSON document, filters/sorts evaluated in-process. `DatabaseModule` (`database.module.ts`) is `@Global()` and exposes one injection token per collection (e.g. `CONNECTIONS_STORE`); repositories inject the token, never the db handle.

- SQLite file: `<APP_DATA_DIR>/app.sqlite`. The Electron main process sets `APP_DATA_DIR` to `app.getPath('userData')`; standalone backend runs fall back to `<cwd>/data`.
- New collection = add `{ token, table }` to `COLLECTIONS` in `database.module.ts` + a token in `doc-store.ts`.
- better-sqlite3 loads fine under `ELECTRON_RUN_AS_NODE` with the current Electron/Node pairing — if an ABI error ever appears after upgrades, rebuild it for Electron.
- **Renaming a collection needs a migration.** `SqliteDocStore` creates a table when it is missing, so a renamed collection silently starts empty on an existing install. `LEGACY_TABLE_NAMES` in `database.module.ts` renames the table before the stores are built — that is where the `projects` → `sessions` and `sandbox_selections` → `datasets` renames live. The same hazard applies to persisted *document fields*: `LEGACY_DOC_FIELDS` (also `database.module.ts`) rewrites session `sandboxes` → `datasets` in raw SQL — repository-side rewrites restamp `updatedAt` and would flatten the session list's recency ordering, so prefer this for fields on a sorted collection; `VerifiedQueriesRepository.onModuleInit` rewrites `sourceProjectId` → `sourceSessionId`, and `renameLegacyWorkspaceDirectories` in `mastra/session-workspaces.ts` renames `workspaces/project-<id>` → `workspaces/session-<id>`. Both migrations are covered by `database.module.spec.ts`.

### Agentic harness (Mastra)

`backend/src/mastra/` is the backbone (mirrored from data-readiness-agent's ADR-0007/0010 pattern): `index.ts` builds the standalone Mastra instance (agents registered there), `mastra.service.ts` is a thin DI wrapper (`MastraService.getAgent(id)`) that keeps the rest of the backend Mastra-agnostic, and `model-resolver.ts` bridges DI-less agents to persisted LLM settings — each agent's `model` is `async () => resolveAgentModel()`, and `LlmService.onModuleInit` installs the real resolver (decrypted key; LenAI → OpenAI-compatible config with `url`; Anthropic → native `anthropic/<model>` router id, API key only — Claude subscription logins are not a supported provider). `providerOptionsFor` (`mastra/model-compat.ts`) translates the user's `reasoningEffort` to Anthropic's `effort` and drops it for models that reject it (Haiku, Sonnet 4.5 and older). No settings saved → falls back to `openai/gpt-4o-mini` via env `OPENAI_API_KEY`. New agent = file in `mastra/agents/` + registration in `index.ts`. Registered agents: `assistant` (chat; speaks only the data model's vocabulary — `describe_entity`/`query_entities`/`sample_records`/`run_raw_sql`, never a physical table name or dialect word, ADR-0007), `assistant-legacy` (`assistant-legacy.agent.ts`, the frozen pre-ADR-0007 SQL-writing assistant with the old `datasetTools`, kept only so the eval harness's `legacy` path has something real to compare against — never exposed on a user-facing surface besides the Agents tab's own agent list), `interactive-visual-designer` (`visualization.agent.ts`, see below), `sql-fixer` (execution-guided repair of a *runtime* error on already-compiled SQL, `SessionsService`, up to `SQL_REPAIR_ATTEMPTS`), `query-fixer` (compile/semantic repair at the logical level — `query_entities` runs it once automatically on an `unknown_attribute`/`unknown_metric`/`ambiguous_path` issue before surfacing an error), `query-verifier` (careful mode's independent second opinion, replacing `sql-verifier` — re-derives a `LogicalQuery` from the question and the rendered model block alone), `knowledge-bootstrap` (`KnowledgeService`, drafts knowledge entries from data, persisted disabled), `assistant-eval-judge` (`mastra/evals/`). Mastra storage (`mastra/storage.ts`) is a composite store: agent memory uses `@mastra/memory` with persistent LibSQL storage at `<APP_DATA_DIR>/mastra.sqlite` (falling back to `<cwd>/data/mastra.sqlite` outside Electron), and observability (traces, metrics, logs) goes to DuckDB at `<APP_DATA_DIR>/observability.duckdb`. API keys are encrypted at rest by `infrastructure/crypto` (`CryptoService`, keyed by `APP_SECRET`), imported by `LlmModule`. Each session ID is an isolated memory thread/resource, and existing session transcripts are bootstrapped on their first post-migration turn. Every session also owns a contained, filesystem-backed Mastra workspace under `<APP_DATA_DIR>/workspaces/session-<session-id>`; workspaces are registered on creation and rediscovered when the backend or Mastra Studio restarts.

### Interactive visuals (tailoring loop)

Visuals are conversation participants, not side artifacts. `backend/src/modules/sessions/visualization.service.ts` owns create/update/revert/load/download; `SessionsService` orchestrates and persists metadata + chat events.

- **Tools on the assistant**: `create_visual` (from an answer, latest by default) and `update_visual` (tailor the visual open in the right panel, or a given `visualId`). Both run the `interactive-visual-designer` agent (`visualization.agent.ts`) as a sub-call with the current bundle + the answer's captured `data` rows + the instruction, and return `{visualId, version, title}`. requestContext carries `session-id`, `active-visual-id` and `turn-data-records`; the per-turn system block lists every visual (id, title, current version) and which one is open.
- **Spec first, freeform fallback**: the designer first emits a small JSON chart spec (`visual-spec.ts`) rendered by a fixed runtime (`visual-runtime.ts`, shipped as `qti-chart.js`); after `SPEC_ATTEMPTS` (2) failed spec attempts — or when there are no rows to select from — the legacy freeform HTML/CSS/JS pipeline takes over. Tailoring a freeform visual stays freeform.
- **Versioning**: files live in the session's Mastra workspace (`workspaces/session-<id>/visuals/<visualId>/v<N>/`): `index.html`, `body.html`, `styles.css`, `script.js`, `qti-frame.js` (frame bridge), `description.md`, `manifest.json`, plus `answer.md` / `data.json` when present and `spec.json` + `qti-chart.js` for spec visuals. Visuals created before versioning keep v1 at `visuals/<id>/` — `resolveVersionDir` handles that. `SessionVisualization.currentVersion` + `versions[]`; revert only moves the pointer (`POST /sessions/:id/visualizations/:vid/revert`). `GET …/visualizations/:vid?version=N` loads any version.
- **Panel endpoints** (`sessions.controller.ts`, besides create/load/revert/download): `POST …/:vid/tailor` (tailor from a plain-English instruction — same pipeline as `update_visual`, logs an `updated` chat event), `POST …/:vid/refresh` (re-run the SQL behind the current version and rewrite only `data.json` + `index.html` in place — no new version, no designer call, no chat event), `POST …/:vid/repair` (silent one-shot auto-repair of the current version after a runtime error; never repairs an auto-repair).
- **Chat events**: turns that create/update/revert a visual persist an assistant message with a `visual` field (rendered as a card); the stream emits `visual-updated` so the panel refreshes live. The chat stream is `POST /sessions/:id/messages/stream` returning `text/event-stream`, read with `fetch` + `getReader()` (not `EventSource`).
- **Readable frame**: `visualization-document.ts` wraps the agent's visual in a fixed, `qti-`-namespaced frame — title → question → visual → takeaway (designer description) → analysis (assistant answer, markdown via `marked` + `sanitize-html`) → collapsible data provenance (SQL, row counts, first 10 rows) → footer (source entities, session, version, date). The context comes from the session transcript (`contextFor`), never from the designer model, so readability does not depend on LLM output. Panel iframe and exported `index.html` share the frame; exports also ship `answer.md` and `data.json`.
- **Validation**: generated JavaScript is parse-checked (`new Function`, compile only) and retried once with the error; the sandboxed iframe reports runtime errors to the host via `postMessage` (`visual-error`) and the panel shows a banner.
- **Model**: `VISUAL_MODEL` env forces the designer model; otherwise gpt-5/o-series configured models are swapped for `openai/gpt-4.1-mini` (LenAI deployments are kept).
- **Frontend gotcha**: `SessionChat` re-syncs from its `session` input only when the session **id** changes — same-id refreshes (visual metadata) must not abort an in-flight stream.

### Architecture: feature-based modules

All backend code follows this feature-based structure. Every new feature gets its own module folder under `src/modules/` containing everything that belongs to that feature (module, controller, service, DTOs, entities, repositories).

```
backend/src/
├── modules/
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   ├── dto/
│   │   │   ├── create-user.dto.ts
│   │   │   └── update-user.dto.ts
│   │   ├── entities/
│   │   │   └── user.entity.ts
│   │   └── repositories/
│   │       └── users.repository.ts
│   ├── orders/
│   │   ├── orders.module.ts
│   │   ├── orders.controller.ts
│   │   ├── orders.service.ts
│   │   ├── dto/
│   │   ├── entities/
│   │   └── repositories/
│   └── payments/
│       ├── payments.module.ts
│       ├── payments.controller.ts
│       ├── payments.service.ts
│       └── ...
├── common/
│   ├── decorators/
│   ├── guards/
│   ├── interceptors/
│   ├── filters/
│   ├── pipes/
│   └── exceptions/
├── infrastructure/
│   ├── database/
│   ├── messaging/
│   ├── cache/
│   └── external-services/
├── config/
│   ├── app.config.ts
│   └── database.config.ts
├── app.module.ts
└── main.ts
```

(`users/`, `orders/`, `payments/` above are examples — actual modules are whatever features this project needs.)

### Rules

- **New feature = new folder in `src/modules/<feature>/`** with `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, plus `dto/`, `entities/`, `repositories/` subfolders as needed.
- **`common/`**: cross-cutting NestJS building blocks only (decorators, guards, interceptors, filters, pipes, exceptions). No feature logic.
- **`infrastructure/`**: technical concerns — database, messaging, cache, external service clients. Feature modules depend on infrastructure, never the reverse.
- **`config/`**: typed configuration files (e.g. `app.config.ts`, `database.config.ts`).
- Feature modules are registered in `app.module.ts` imports.

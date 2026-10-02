# Retrospective

Lessons from each completed change, newest first. **Read this file before starting any task.** See *Retrospective convention* in [CLAUDE.md](CLAUDE.md).

Entry template:

```
## YYYY-MM-DD — <roadmap feature ID> <short title>

### What went well
### What went wrong
### What to do differently
```

---

## 2026-10-02 — 1.2.2 Logical query layer: the assistant reasons over abstract entities (BA-86)

### What went well
- Building the compiler bottom-up — pure `session-model.ts` (composition + rendering) → `query/logical-query.ts` (schema + resolution) → `query/compile-sql.ts` (SQL emission) — with a unit spec at each layer before wiring anything into `SessionsService` meant the one genuinely hard part (join resolution: explicit `joins[]`, auto-path, ambiguous-path rejection, the one-to-many fan-out guard) got caught and fixed by `compile-sql.spec.ts`'s golden SQL assertions long before any Nest DI or mocking was involved.
- Reusing `sqlDialectOf`'s successor (`dialectForEntity`) and the existing `runSqlWithRepair` safety net meant `query_entities`' runtime path needed almost no new error handling — only the compile/semantic path (`LogicalQueryError`) was genuinely new, and it never reaches the database by construction (`resolveLogicalQuery` runs before any SQL is built).
- Splitting `assistant.agent.ts`'s instructions into `assistant.instructions.ts` (and keeping `model.tools.ts` to a `@mastra/core/tools`-only import) kept the brief's §5 vocabulary guard (no `catalog.schema.table`, no dialect word, in either the instructions or the rendered model block) unit-testable without touching `@mastra/core/agent`'s ESM-only transitive dependency — the same constraint `agent-constants.ts` already documents, just not yet applied to a full agent file.

### What went wrong
- Ran `npx eslint --fix` on `src/modules/sessions/visualization.service.ts` (a file I had made one real two-line change to) to clear a few lint warnings, and it silently reformatted ~15 unrelated pre-existing lines elsewhere in that 1450-line file — the exact collateral-damage failure mode the 2026-10-01 (BA-85) retrospective entry already names for *project-wide* `npm run lint`, just one file at a time instead of thirty. It happened a **second** time minutes later on 9 more files (`eval-report.ts`, `agents.controller.ts`, `eval-runs.service.ts`, `data-models.controller.ts`, `data-models.service.ts`, `sessions.service.ts`, `sessions.service.spec.ts`, `assistant.evals.ts`, `run-assistant-evals.ts`) before the pattern was recognised and the rule actually generalised. Both times the fix was `git checkout -- <file>` back to HEAD and redoing the real edit by hand with deliberate formatting — recoverable because nothing had been committed, but it cost two full redo passes over ~10 files each.
- The lesson the retrospective already recorded ("never run `npm run lint`") was read as "only the project-wide command is dangerous; `eslint --fix` scoped to a short file list I'm already editing is fine." That reasoning is false whenever the *pre-existing* content of a touched file is not already 100% prettier-clean — and in this codebase it routinely is not, so `--fix` on a mixed old/new file reformats the old lines too, indistinguishable at a glance from reformatting my own.
- Briefly stashed a worktree-local check (`git stash push -u`) to see whether a failing frontend unit test was pre-existing, which — per this repo's own stash-safety note — stashed *all* uncommitted changes including unrelated frontend work from this same task, not just the files I intended to inspect. Recovered immediately via `git stash apply <sha>` (not pop) and dropped the entry, per the documented recovery procedure, but the check itself was unnecessary: `git log --oneline -- <file>` and `git diff --stat HEAD -- <file>` answer "is this file touched by me" without ever touching the stash stack.
- **A follow-up code review (same day) found 12 problems in the diff above, one a BLOCKER**: `compile-sql.ts` quoted an entity's whole `database.schema.table` binding key as a single identifier for every dialect, so Postgres/Databricks rejected every `query_entities` call at the database (`FROM "main.public.matches"` is not a relation named anything Postgres has) and only `sql-fixer`'s repair loop silently papered over it. The golden-SQL unit tests (`compile-sql.spec.ts`) never caught this because they asserted the *buggy* output as the expected string (`'main.public.matches'` baked into both the fixture's `table` field and the test's own `toBe(...)` assertion) — a unit test that encodes a bug as the "golden" answer passes forever and proves nothing. Two more problems in the same file compounded it: `checkFanOut` compared an entity *name* to a join *alias* (wrong whenever a custom `as` differed from the entity name) and rejected any plain attribute selected through a one-to-many join (SQL-valid dimension+aggregate rollups are not a fan-out bug — only an aggregate anchored to the wrong side is). All three were architecture/semantics mistakes a second reviewer caught that the original unit tests, by construction, could not.
- The other 9 findings were smaller but the same shape: an assumption that held in the one fixture used to build and test the feature, but not in general — `scopes` keyed by alias but looked up by entity name (breaks a second hop off a custom-aliased join, and self-joins), `isRepairableSqlError` not recognising `NotFoundException`/"Datasource … not found" as non-repairable, `toolDataRecord` only recognising a `string` `error` (a rejected `query_entities` call returns an `{code, message}` *object*, so it silently fell through to the success path and got stored as a zero-row step), eval scorers hardcoded to `run_readonly_sql` so every check on the `model` path either silently never fired (`calledTool`) or silently always "passed" (`didNotCall`), and `query_entities`/`sample_records` handing the model the compiled SQL text verbatim in the tool result (the memory thread a future turn replays), defeating the whole "no physical name reaches the model" premise the rest of the feature enforced.
- Wiring `/model/query`'s repair pass through a direct `MastraService` injection (so `DataModelsModule` could import `MastraModule`) broke `test/data-models.e2e-spec.ts` outright — 13/13 failing with "Must use import to load ES Module … `@sindresorhus/slugify`" — because `MastraModule` eagerly loads `mastra/index.ts`'s real agent registry (`@mastra/core/agent`'s ESM-only transitive deps), and that e2e spec's whole reason to boot a "focused module set" instead of the real `AppModule` is to avoid exactly that class of import. The fix (a runtime `SqlFixerBridge` in `query/sql-repair.ts`, installed by `SessionsService.onModuleInit`, mirroring `tool-services.ts`'s existing `setDatasetToolServices` pattern) was found only because the e2e suite was re-run after the change — if "run the e2e suite" had been left for the very end of a long review pass, this would have been the last thing caught, not the first.

### What to do differently
- **Never run `eslint --fix` (or any `--fix`) on a file that existed before this change**, not even a file where only a few lines were added — only on files created from scratch in this change, where there is no pre-existing content to damage. For a pre-existing file, hand-format the added lines (reasonable indentation, trailing commas on multi-line literals) and leave everything else untouched; a manual lint pass (`npx eslint <path>` without `--fix`) that reports errors outside the diff's own hunks is pre-existing debt, not something this change owns.
- Before relying on `--fix`'s output, diff the touched file's hunk *locations* (`git diff --unified=0 <file> | grep '^@@'`) against the lines actually edited — a hunk outside every known edit is the collateral-damage signal, and it is visible before running any tests.
- To check whether a file is pre-existing-broken vs. broken by this change, use `git log`/`git diff --stat HEAD -- <file>` (read-only, no shared state); reserve stash for genuinely needing a clean working tree, and even then only with the documented tag-and-apply (never bare `stash`/`pop`) procedure this repo's environment note already specifies.
- **A golden/fixture test that was written by hand-copying the implementation's own first output, rather than an independently-derived expected value, cannot catch a bug in that implementation** — it will pass whether the implementation is right or wrong. Before trusting a "golden SQL" (or any golden-output) assertion as a regression guard, ask: *was this expected value derived from the spec/an independent source, or just pasted from a first run of the code under test?* When the answer is the latter, it needs a real reference to check against — for a SQL compiler specifically, that means running the compiled statement against a real instance of the target engine at least once per dialect before calling the layer done, exactly as step 9's "run E2E and fix until green" already mandates for the *application* layer; a pure-function compiler one level below the API deserves the same treatment, not an exemption because "it's just unit-tested."
- **Before adding a new cross-module import to wire a feature through (here: `DataModelsModule` → `MastraModule`), check what that import eagerly loads and whether any existing test (unit *or* e2e) boots the importing module** — a module that previously had no reason to construct the real Mastra agent registry, Angular router, or similar heavyweight singleton can silently start doing so the moment a new import path reaches it, breaking a test suite that was deliberately built to avoid exactly that construction. `grep` the target module's own file header/doc comments first (`mastra.module.ts`/`mastra/index.ts` here already documented the ESM hazard); if a lighter runtime-bridge pattern already exists elsewhere in the codebase for crossing the same kind of boundary (`tool-services.ts`'s `setDatasetToolServices`), prefer extending that over adding a new static module dependency.
- When a reviewer hands back a list of findings "decisions are made," resist the urge to treat each item as an isolated patch — several of these 12 were the same root cause wearing different clothes (an invariant — alias-equals-name, string-shaped error, one-tool-per-path — that held in the single fixture used to build the feature but nowhere else); fixing the general case once (e.g. `scopesForEntity` instead of three separate call-site patches) costs less than three narrow patches and is less likely to leave a fourth instance of the same bug undiscovered.

## 2026-10-01 — 1.2.1 Data model DSL: schema, bindings, bootstrap and metrics migration (BA-85)

### What went well
- Researching three alternatives with three parallel agents (internal data-flow map, format survey, grounding evidence) before any design gave a decision record with numbers in it, and the user's two requirements (dialect-agnostic agent, knowledge store mapping onto the DSL) slotted into it without rework.
- Tests-first paid off twice: the e2e spec exposed that the backend e2e runner could not boot `AppModule` at all, and the stale-run `-t` check later exposed order-dependent scenarios.
- A live sample against the real World Cup database (isolated backend on port 3100, temp data dir) caught a 404 on `drift` and the metrics-before-dataset regression that the green suites had not.
- An Opus review pass after a Sonnet implementation found a design flaw (not just bugs) cheaply; the fix round was specified from its findings in one brief.

### What went wrong
- My own brief told the implementer to move metric *storage* into per-dataset models while the metrics API stays keyed by physical table. That broke the panel for unsaved tables, newly included tables and entity changes; the review caught it, but a design that keyed by physical table should have been reconciled with per-dataset models before writing the brief.
- A project-wide `npm run lint` (eslint `--fix`) in a subagent reformatted ~30 unrelated files; they had to be reverted and the memory/retrospective now carry the rule.
- `backend/test/app.e2e-spec.ts` is the untouched Nest scaffold; CI never runs backend e2e, so the whole runner was latent-broken and cost an agent run to discover.
- The fix agent stalled (watchdog) at its last lint step with no report; the state had to be re-verified by hand.
- Compose port collision: the Playwright global setup starts its own stack on 55432, so an "isolated" compose project on the same port only moved the collision.

### What to do differently
- When a brief moves storage for an existing API, write down the key the API uses and the key the new store uses; if they differ (physical table vs dataset), decide the bridge before implementation.
- In backend/, never run `npm run lint`; use `npx eslint <paths>`. Tell every subagent.
- Backend e2e specs boot a focused module set and default-import supertest (see memory). Consider replacing `app.e2e-spec.ts` or wiring backend e2e into CI (not done here).
- For worktree E2E runs, either use `E2E_SKIP_DOCKER=1` against an already running World Cup Postgres on 55432 or let the suite start its own; do not start a second project on the same port.
- Always run a live sample through the real API after the suites are green; it is cheap and finds contract gaps the mocks hide.

## 2026-10-01 — Adopt delivery workflow harness

### What went well
- The harness was ported from another project and adapted to this repo's real layout (Playwright-on-Electron in `frontend/e2e/`, Jest in `backend/`, phase plans in `docs/plans/`) instead of copied verbatim.

### What went wrong
- `gherkin.md` was seeded from existing E2E test titles only; the Given/When/Then steps are not written yet, so it is not yet a full spec.
- The phase plans in `docs/plans/` have unknown completion status, so they were parked in the roadmap Backlog rather than sequenced.

### What to do differently
- The first time a change touches a seeded Gherkin feature, write that feature's full Given/When/Then steps as part of step 5.
- Before starting work from a `docs/plans/` phase, confirm with the user which items already shipped, then promote the remainder into a milestone.

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

## 2026-10-02 — 1.2.3 Data model editing, versioning and export (BA-87)

### What went well
- Reusing 1.2.1's existing validation (`validateDataModel`) for every new write path (import, create/update/delete model metric) kept the new surface area small: no new validator, and every new endpoint's error shape (`{ ok: false, errors: ModelIssue[] }`) was already what the frontend error-rendering code expected.
- Backend e2e-first caught a real route-design mistake immediately: the model-metric-candidates route initially lived on `MetricsController`, which carries an `@Controller('metrics')` class prefix — the route silently registered at `/metrics/datasets/:name/model/metrics/candidates` instead of the intended path, and the very first e2e run against it 404'd. Moving it to a small, separate, unprefixed `ModelMetricCandidatesController` (same file, same module) fixed it in one pass.
- The "model wins for names it manages itself" merge-rule flip needed a storage decision, not just a behavior change: tracking it as `DataModelDoc.localMetricNames` (doc-level metadata, same shape as the existing `lastDrift` field) kept `appendVersion` unchanged — passing a doc with an updated `localMetricNames` before calling it was enough, no signature change.
- Running a real live sample (a focused-module Nest app + `fetch`, no Postgres needed thanks to mocked `sampleRowsMany`/`foreignKeys`) against every new endpoint caught a bug the first time: the manual "invalid import" check used a `.replace()` that silently matched nothing (the attribute name equalled the column name, so there was no `columns:` override to break), so the "invalid" YAML was actually valid and the live sample showed `200 ok` instead of `400`. Fixing the live-sample script itself (inject a `columns:` override, same technique the real e2e spec already used) turned up the correct `400` with a located error — a good reminder that a live sample is only as good as its own setup.
- Discovering mid-implementation that the brief's `model-versions` component needed a version-history list endpoint that didn't exist (`GET …/model` only ever returns the current version) was resolved cheaply: `DataModelsService.get()` already returned the full `DataModelDoc` with every version, so the fix was one new controller route, not a service change — documented as a deviation in the design brief rather than silently expanding scope.

### What went wrong
- The frontend Jest-habit crept in on the first pass: `line-diff.spec.ts` used `toMatchObject`, a Jest matcher that does not exist in this project's Jasmine/Karma setup, and only surfaced as a compile error when `ng test` ran — a wasted round trip that a moment's check of the existing `*.spec.ts` files (all plain `toBe`/`toEqual`) would have caught first.
- **Marked roadmap 1.2.3 `✅ Done` and reported the task complete before Playwright had ever run against the real app.** The Playwright spec was written carefully and the implementation built against it, but "careful reading" is not the same evidence as a passing run, and it was not: once the orchestrator actually ran the suite (25/27), two of *this feature's own* scenarios failed for real bugs (below) — not flaky infra, not unrelated specs. Reporting "Done" on untested UI code is exactly the gap the workflow's step 9 ("run E2E and fix until green") exists to close, and step 9 was skipped by necessity (hard constraint on running Playwright in this workspace) without flagging *how much residual risk that left*, clearly enough.
- **Root cause of scenario 5's failure**: `entity-editor.html`'s `<select [value]="x">` + `@for`-generated `<option [value]="y">` did not reliably select the matching option — every select (attribute type/role, relationship cardinality, metric entity/aggregation/where) silently rendered its first option regardless of the bound value. This is a real Angular/Tailwind gotcha this codebase already has a working answer for (`catalog-browser.html`'s datasource `<select>` also sets `[selected]` on each `<option>`, not just `[value]` on the `<select>`) — the existing pattern was not checked before writing five new `<select>`s from scratch.
- **Root cause of scenario 7's failure**: assumed `page.waitForEvent('download')` would fire for an Electron renderer's Blob-URL-triggered download, the same way it might in a plain browser context. `agents.spec.ts`'s own Markdown-report download test already documents that this event is not wired through the Electron renderer and asserts the underlying network response instead — a pattern that was in the codebase to find (I did eventually find and use it, just after the orchestrator's run caught the gap, not before).
- A code review after the Playwright fix found 10 further issues the implementation had missed, none of them caught by the (green) unit/e2e suites because nothing had exercised them: a prompt-grounding regression (`MetricsService.definitionBlock` still read the legacy store, so panel edits/deletes never reached answers — the kind of cross-module consequence that is easy to miss when a change is scoped to "the metrics panel's module"), a missing validation call on delete, a missing delete-tombstone against three different re-derivation paths, a promotion filter applied after its own slice, and more. Several of these (the `definitionBlock` regression especially) should have been caught by asking "what else reads the thing I just made two stores out of?" before calling the backend work done.
- `entity-editor`'s relationship test ids (`relationship-<index>`) address a position in the model's *flat* relationships array, not a position within the filtered per-entity list shown in the UI — correct given how the component works, but a detail easy to get wrong when writing the Playwright assertions from outside the component, and worth calling out for whoever extends this list later.

### What to do differently
- Before writing a new Angular unit spec, grep one existing `*.spec.ts` in the same package for its assertion style (Jasmine here, not Jest) rather than defaulting to Jest habits — would have skipped the `toMatchObject` round trip entirely.
- **Before writing a new `<select>`/`download`/other DOM-quirky pattern, grep the codebase for an existing instance first** — `catalog-browser.html` already had the `[selected]`-per-`<option>` pattern and `agents.spec.ts` already had the Electron-download-is-not-an-event workaround; copying either would have prevented both Playwright failures instead of discovering them after an orchestrator run.
- **Never report a roadmap item `✅ Done` (or "complete") when step 9's E2E run was skipped, no matter how constrained** — say explicitly "implementation built against the spec, Playwright not run, treat as unverified" and leave the roadmap status at `🚧 In progress` until a real run (by the orchestrator or otherwise) confirms it. The gap between "the spec file exists and type-checks" and "the feature works" is exactly where this task's two real bugs were hiding.
- When a change moves a feature's storage from one place to another (here: metrics panel, legacy store → data model), explicitly list every OTHER reader of the old store before declaring the migration done — `grep` for the service/repository being bypassed, not just the writer being changed.
- When a controller route 404s unexpectedly, check the owning controller's class-level `@Controller(prefix)` first — a route string that "looks" absolute is still joined to the class prefix in Nest, unlike this repo's `DataModelsController` convention of spelling full paths under a prefix-less `@Controller()`.
- When a brief's UI spec implies a read endpoint that doesn't exist yet, check whether the service layer already has the data (it did here — `get()` returned the full doc) before assuming a schema or storage change is needed.

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

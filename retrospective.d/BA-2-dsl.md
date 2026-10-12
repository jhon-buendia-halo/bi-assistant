---
story: BA-2
roadmap: 1.2.1
title: Data model DSL: schema, bindings, bootstrap and metrics migration (written 2026-10-01 on the old branch)
---
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

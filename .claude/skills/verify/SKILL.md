---
name: verify
description: Use at workflow step 9 (run the impacted E2E specs, check-specs, unit tests, lint, builds and, when an agent's input changed, its evals at 100%; fix until green), and to verify a change in the running web app (build, launch an isolated CLI instance, drive it in Chromium with Playwright).
---

# Step 9 — Run E2E and fix until green; verify in the running app

Part of the workflow in [CLAUDE.md](../../../CLAUDE.md), which keeps the always-on core (the mandatory first action, the step list, the fast loop and acceptance gate, the hard gates). Load this skill before the step starts.

## The step

9. **Run E2E and fix until green** — `npm run test:e2e` in [frontend/](../../../frontend/) (builds the backend with the web UI, then drives the **web app** in Chromium through `e2e/fixtures/app.fixture`; global setup starts the World Cup Postgres with `docker compose up -d --wait postgres` unless `E2E_SKIP_DOCKER=1`). Run `npm run test:e2e:desktop` only when the user asks for a desktop run. See **Test target convention** (in the `workflow-e2e` skill). Also run `python3 scripts/check-specs.py` at the repo root, `npm test` / `npm run lint` / `npm run build` in [backend/](../../../backend/) and `npm test` / `npm run build` in [frontend/](../../../frontend/). **Run only the impacted E2E specs**, the spec files step 6 lists (added, updated and re-run-as-is), never the whole suite unless the user asks for it: `npm run test:e2e -- e2e/<spec>.spec.ts …`, and `npm run test:e2e:org -- e2e/<spec>.spec.ts …` for impacted org specs. **The evals must pass** whenever the change touches what an agent receives (its prompt, skills, tools, context blocks or model routing): run its eval set on the base commit and on the branch, same model and data dir (`npm run evals:assistant` with `EVAL_SET` or `EVAL_CASES`, see [delivery.md](../../../specs/system/delivery.md)). Passing means a **100% pass rate** on the branch: every case passes, and every case is re-run until it has 3 runs with all 3 passing. The base run tells which failures the change caused, but a failure on the base doesn't excuse one on the branch. Diagnose root causes; fix the test if the test was wrong, the implementation if it was wrong. Repeat until every impacted spec and the evals are green.

## Check the running web app

1. Build: `npm --prefix backend run build:all` (backend dist + web UI in `backend/public`).
2. Launch an isolated instance on free ports with a throwaway data dir (copy a real data dir to test migrations on real data):
   `node backend/dist/cli.js --no-open --port 3400 --data-dir <tmp>/verify-data --intellify-api-port 3420`
   Never use 3000 or a port another app/session runs; stop it by its task/PID afterwards.
   RFP Builder / Intellify API flows need its database loaded and the app restarted first: see the `intellify-api` skill.
3. Drive it with Playwright from Node, resolving the package from the frontend:
   `const { chromium } = require(require.resolve('playwright', { paths: ['<worktree>/frontend'] }))`.
   No sign-in exists (ADR-0030): `page.goto(url)` lands on the welcome page.
   - Rail buttons: scope to `getByRole('complementary', { name: 'Navigation rail' })` (the welcome page also has "Agents"/"Datasets" buttons).
   - Sessions list: `getByRole('navigation', { name: 'Sessions', exact: true })`; rows `li[data-testid^="session-"]`.
   - New conversation: `header` → "Start New Conversation"; agent picker `data-testid="new-session-agent"`.
   - Workflow bar `data-testid="workflow-bar"`, Details `workflow-details-toggle` (opens on the current step; there is no separate note link).
   - Right panel: `getByRole('complementary', { name: 'Details panel' })`, history menu `button[title="Shown in this session"]`, items `.menu-item`.
   - Visual frame: `page.frames()` gives the sandboxed iframe; `frame.evaluate` reads its `data-theme`.
   - Theme: switch through Settings → Appearance radios; the saved preference wins over `emulateMedia`.
4. A real agent turn uses the data dir's saved LLM settings (live model calls). Poll `data-testid="skill-step"` and the Thinking block while it streams.
5. Gotchas: `addInitScript` also runs inside the sandboxed visual iframe (localStorage SecurityError there is the script, not the app); the worktree sandbox refuses compound shell commands — write scripts to files and run them plainly.

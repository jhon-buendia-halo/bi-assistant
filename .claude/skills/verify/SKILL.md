---
name: verify
description: Use in the fast loop (qa.mjs --fast, the demo and hand-over) and at workflow step 9 (qa.mjs --gate: builds, unit tests, lint, check-specs, the impacted E2E specs and, when an agent's input changed, its evals against the base; fix until green), and to verify a change in the running web app (build, launch an isolated CLI instance, drive it in Chromium with Playwright).
---

# Fast-loop checks, step 9, and the running app

Part of the workflow in [CLAUDE.md](../../../CLAUDE.md), which keeps the always-on core. Load this skill before the fast-loop checks and before step 9.

## The step

9. **Run checks and fix until green** — `node scripts/qa.mjs <roadmap-id> --gate` ([delivery.md](../../../specs/system/delivery.md) 13). It runs the builds (skipped when up to date; `--rebuild` forces them), the unit suites, backend lint and `check-specs.py` in parallel, then the story's step-6 Playwright list with JSON and HTML reporters; it fails if a listed spec did not run, checks the demo evidence (skipped with `--no-demo` for an S change), and writes `evidence/<roadmap-id>/tests.md`. **Run only the impacted E2E specs** (the step-6 list), never the whole suite unless the user asks. The web app is the target; `npm run test:e2e:desktop` only when the user asks for a desktop run (Test target convention, `workflow-gate`). Diagnose root causes; fix the test if the test was wrong, the implementation if it was wrong; repeat until green.

   **Fast loop:** `node scripts/qa.mjs <roadmap-id> --fast` runs the related unit tests, the builds, `check-specs.py` and the Playwright specs of the Features touched, and records the demo (`demo.webm` for a UI story, `demo.txt` otherwise; `--no-demo` for an S change). Then generate and publish the demo artifact (`node scripts/demo-page.mjs <roadmap-id>`, then the Artifact tool, see `workflow-gate`) and hand over the running app with the link.

## Evals — when the change touches what an agent receives

Its prompt, skills, tools, context blocks or model routing. Run the agent's eval set (`npm run evals:assistant` with `EVAL_SET` or `EVAL_CASES`, see [delivery.md](../../../specs/system/delivery.md) 2) on the **base commit and on the branch**, same model, same data:

- **Run in parallel.** Three runs per build at once, each on its own copy of the data dir and its own `EVAL_RESULTS_FILE`, not one after another. Before starting, print the copy's saved provider and model; use `EVAL_LLM_*` for any other target.
- **Pass bar on the branch:**
  - every **code check** (tool calls made, SQL valid, no tool errors, required fields and formats) passes in **3 of 3** runs of every case;
  - every **judged** case (`judgeRubric`) passes in **at least 2 of 3** runs and **no less often than on the base**.
- A case below the bar is a regression the change caused: trace one failing run (its results file) before theorising, fix, and re-run only the failing cases, 3 runs.
- A judged case that is flaky on **both** builds at the same rate is not chased: list it as known-flaky, with both pass rates, in the changelog entry and the PR. If the user wants it fixed, that's a separate story.
- Stop a round as soon as a run fails a code check; there is no point finishing it.
- After stopping a looping eval script, list leftover `run-assistant-evals` node processes and kill them by PID.

## Check the running web app

1. Build: `npm --prefix backend run build:all` (backend dist + web UI in `backend/public`).
2. Launch an isolated instance on free ports with a throwaway data dir (copy a real data dir to test migrations on real data):
   `node backend/dist/cli.js --no-open --port 3400 --data-dir <tmp>/verify-data --intellify-api-port 3420`
   Never use 3000 or a port another app/session runs; stop it by its task/PID afterwards.
   Once it answers, configure it: `node scripts/setup-local.mjs http://127.0.0.1:3400`. It saves the LLM from `.env.llm.local` (custom endpoint, Anthropic style by default) and loads every Testing Data fixture plus the Intellify RFP API ([delivery.md](../../../specs/system/delivery.md) 2). If `.env.llm.local` is missing, ask the user for the endpoint rather than guessing.
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

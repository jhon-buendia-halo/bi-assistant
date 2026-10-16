---
name: workflow-e2e
description: Use at workflow steps 6 and 7 (acceptance gate): the per-scenario E2E impact analysis and writing the Playwright specs; also when choosing the test target (web by default, desktop only on request).
---

# Steps 6–7 — E2E impact analysis and Playwright specs

Part of the workflow in [CLAUDE.md](../../../CLAUDE.md), which keeps the always-on core (the mandatory first action, the step list, the fast loop and acceptance gate, the hard gates). Load this skill before the step starts.

## The steps

6. **Component impact-based analysis on E2E** — for every component / page / service / backend module touched, enumerate the Gherkin scenarios (in the capability specs) that exercise it and decide per scenario: *add / update / delete / re-run-as-is*. Produce the explicit list before writing any test or implementation code.
7. **Implement / update / delete E2E** — apply the step-6 decisions to [frontend/e2e/](../../../frontend/e2e/) (and backend `test/*.e2e-spec.ts` where the flow is API-level). They are written in the acceptance gate, after the code exists, so each added or updated scenario must assert the specific behaviour the change introduced: it would fail on the base commit.

## E2E test convention — every flow change triggers an impact analysis on Playwright

**Playwright specs in [frontend/e2e/](../../../frontend/e2e/) are the executable mirror of the Gherkin Features in [specs/capabilities/](../../../specs/capabilities/)** — one spec file per Gherkin `Feature:`. A Feature marked `E2E: none yet` gets its spec file the first time a change touches it. Whenever step 5 touches a scenario, perform the step-6 analysis and decide per scenario: **Add**, **Update**, **Delete**, or **Re-run as-is**. Test edits (step 7) land in the acceptance gate, after the user has accepted the change by hand and before it ships; don't ship a flow change without the matching E2E change, nor with any impacted spec red.

Scope: Playwright covers end-to-end behaviour in the running app: the web app by default, the Electron app on request (see **Test target convention**). Unit tests stay beside their source (`*.spec.ts` — Jest in backend, `ng test` in frontend) and are not governed by this rule. Visual baselines (`*-snapshots/`) are updated only with `npm run test:e2e:update` and only when the visual change is intended.

## Test target convention — test the web app; desktop only on request

**During epic development, E2E tests, evidence screenshots and manual checks of the running app run against the web app built from the epic branch, not the Electron desktop app.** The desktop app is tested only when the user explicitly asks for a desktop run. Otherwise desktop is not covered, and the evidence and PR say so.

- **Web target (default):** `npm run test:e2e` in [frontend/](../../../frontend/). It builds the backend with the web UI (`build:all`) and runs the Playwright `web` project. Each test starts the npm CLI (`backend/dist/cli.js --no-open`) on a free port with its own temp data dir and drives it in Chromium at 1440×900, the desktop window size. It never touches port 3000 or your data.
- **Desktop target (on request only):** `npm run test:e2e:desktop` runs the same specs in the Playwright `desktop` project against the real Electron app. It needs port 3000 free.
- **Desktop-only scenarios** (Electron shell features such as native dialogs, shell-side log capture and redaction, the "Restart backend" button) call `desktopOnly()` from the fixture. They are skipped on web with the reason `Desktop only`. List every skipped scenario as **"desktop not run"** in the evidence README and the PR description, unless a desktop run was requested and passed.
- **Manual checks and screenshots:** start the web mode, not Electron. Run `npm --prefix backend run build:all`, then `node backend/dist/cli.js --no-open --port <free> --data-dir <tmp>`, and open the printed URL. In a worktree, this is the isolated target from the **Worktree deploy convention**.
- **Unit tests are unchanged:** Jest in `backend/` and `ng test` in `frontend/` don't depend on the target.
- **Adopted 2026-10-09 ([BA-156](https://halo-powered.atlassian.net/browse/BA-156)).** Commands and fixture details: [specs/system/delivery.md](../../../specs/system/delivery.md) and [specs/system/tech-stack.md](../../../specs/system/tech-stack.md).

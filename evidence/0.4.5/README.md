# 0.4.5 — Deterministic QA, demo videos and demo artifacts

Epic BA-119. Spec: [specs/epics/BA-119/spec.md](../../specs/epics/BA-119/spec.md), [delivery.md](../../specs/system/delivery.md) 13. Roadmap: [0.4.5](../../roadmap.md).

## What shipped

- `scripts/qa.mjs <id> --fast|--gate`: the single QA lane (a lock in git's common dir; a second run prints "Waiting for the QA lane (held by ...)" and runs after the first). Tests are selected mechanically.
  - `--fast` records the demo: `evidence/<id>/demo.webm` at 1280x720 with Gherkin captions from `scenarioStep` ([demo-captions.ts](../../frontend/e2e/support/demo-captions.ts)); over 5 MB fails; a story with no UI gets `demo.txt`.
  - `--gate` runs the builds, the full unit suites, backend lint, `check-specs`, the step-6 list from `evidence/<id>/e2e-impact.md` with Playwright JSON/HTML reporters, and writes `tests.md` with counts read from the reports. A listed spec that did not run fails the gate and is named.
  - Reports and logs live in the git-ignored `.qa-reports/<id>/`.
- `scripts/demo-page.mjs <id>`: generates `evidence/<id>/demo-page.html` from the roadmap, changelog, `tests.md` and the demo. The session publishes it as a Claude artifact with `demo.webm` (new `workflow-ship` step, requested by the user on 2026-11-10).
- `frontend/playwright.config.ts` `QA_REPORT_DIR` reporters; the app fixture's `DEMO=1` window, video and slowMo.
- `check-specs.py` compares paths with forward slashes, so it passes on Windows.
- The `verify`, `workflow-ship` and `workflow-e2e` skills call these scripts.

## Acceptance criteria and proof

- Unit tests of the logic: `node --test scripts/qa-lib.test.mjs scripts/demo-page-lib.test.mjs` 22/22 passed (includes `missingSpecs` and the `renderTestsMd` "Listed in step 6 but not run" case: removing an impacted spec fails the gate).
- `--fast` on a UI story: `qa.mjs 1.21.6 --fast` ran 4/4 steps and wrote [demo.webm](../1.21.6/demo.webm) (0.52 MB) with Gherkin captions (frames checked).
- `--gate` writes counts that match the reports: `qa.mjs 1.21.6 --gate` wrote [tests.md](../1.21.6/tests.md); Jest 2250 passed / 43 failed / 0 skipped equals `jest.json`, Playwright 18/0/0 equals `results.json`. The 43 backend unit failures also fail on `main` on this Windows checkout (CRLF fixtures, file mode): pre-existing.
- One QA lane: a second run (`0.4.5 --fast`) started during the 1.21.6 gate waited for the lane and ran after it.
- No-UI story: this story's own [demo.txt](demo.txt) (terminal colour codes stripped).
- Demo artifact: [demo-page.html](../1.21.6/demo-page.html) published as https://claude.ai/artifact/PaHnv76hriE2S6pcxkkMVJ (private; the human shares it).
- 0.4.5's own gate result: `qa.mjs 0.4.5 --gate`: 5/6 steps passed. Build, frontend unit (490), backend lint (0 errors), check-specs and the 3 step-6 Playwright specs passed; backend unit 2250 passed / 43 failed, the same 43 that fail on `main` on this Windows checkout (CRLF fixtures, file mode). See [tests.md](tests.md).

## Found and fixed on the way

- The first gate run lost its logs: the report folder sat under `frontend/test-results`, which Playwright empties at the start of every run, and the waiting run crashed the same way (it set up its folder before taking the lane). Reports moved to `.qa-reports/`, created only after the lock.
- The gate found 6 Prettier errors merged to `main` by BA-320 (`assistant.evals.spec.ts`, `narrowDatasets` in `sessions.service.ts`); fixed here.
- `demo.txt` kept terminal colour codes; stripped.
- Playwright webm has no duration metadata (seeking needs a player workaround).

## Artifacts

- [demo.txt](demo.txt): this story's demo (no UI).
- [tests.md](tests.md): this story's gate record (written by `qa.mjs`).
- [e2e-impact.md](e2e-impact.md): the step-6 impact list.
- Showcase on story 1.21.6: [demo.webm](../1.21.6/demo.webm), [tests.md](../1.21.6/tests.md), [demo-page.html](../1.21.6/demo-page.html), artifact https://claude.ai/artifact/PaHnv76hriE2S6pcxkkMVJ.
- This story's demo artifact: https://claude.ai/artifact/65qnf5rhRJsGams5PfQg28

Desktop: not run (web target only).

**Windows screenshot baseline.** The repo has no Windows baseline for `layout-accessibility.spec.ts` ("application shell"). The first Playwright run on a Windows machine writes one and fails that test; the next run passes against it. That is why `qa.mjs 0.4.5 --fast` failed its Playwright step and the gate that followed passed. The generated `application-shell-web-win32.png` was not committed.

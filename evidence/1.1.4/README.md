# Evidence for 1.1.4 — One format and a validator (Step 1a, BA-182)

Branch `feat/BA-9-golden-dataset-evals`, 2026-10-13. Web target only; desktop not run.

## What changed
- The assistant's eval questions moved from TypeScript into `backend/src/mastra/evals/sets/*.json` (World Cup with its PostgreSQL and REST variants, Formula 1, and the new World Cup golden set), loaded and checked by `eval-sets.ts`.
- `npm run eval:validate` runs every reference query of one set with no model call; `npm run evals:assistant` takes `EVAL_SET`.
- The old golden-set harness (`backend/eval/`, `scripts/run-eval.ts`, `npm run eval`) is retired; its 9 questions and 2 from `check-answers.ts` are the "World Cup (golden set)" set in the Evals tab.
- The World Cup sample now requires `disciplinary_events` (10 entities), because two golden questions read it.
- A previous run counts as comparable only if it shares a question with the new run (agents-evals R40).

## Files
| File | What it shows |
|---|---|
| `eval-sets-before.json`, `eval-sets-after.json` | The three existing sets captured from the old TypeScript and from the new loader; equal field by field (asserted by `eval-sets.spec.ts`). The golden set is the only addition. |
| `validator-run.txt` | `eval:validate` from the real build on `world-cup` (5 of 5), `world-cup-golden` (11 of 11) and `world-cup-rest` over the local REST API (5 of 5), exit 0 each. |
| `validator-run-scratch-build.txt` | The backend agent's run from a scratch compile: a reference broken on purpose fails with the case id while the others still run (exit 1); a dataset missing tables stops at the preflight; an unknown set id is refused. |
| `cli-run-world-cup.txt` | `EVAL_SET=world-cup` through the eval CLI (`node dist/mastra/evals/run-assistant-evals.js`) on `gpt-4o-mini`: 0/10, against 1, 0 and 0 of 10 in the baseline (`../1.1.2/baseline/`), so the same verdicts within run-to-run variation. Most failing checks are again `check-no-tool-errors` (8 of 10). The CLI selected one set, which `main` refused. |
| `evals-tab-four-sets.png`, `evals-tab-golden-set.png` | The Evals tab listing the four sets, and the golden set's questions with their checks. |
| `e2e-results.txt` | The web E2E suite: 86 passed, 2 skipped (desktop only), 1 failed (see below). |
| `e2e-impact.md` | The workflow step-6 impact analysis. |
| `backend-jest.txt` | All 63 backend suites, 1077 tests, passing. |
| `check-specs.txt` | The spec check, green. |

## Not green, and why
- **E2E `matches the stable application-shell visual baseline`**: the repository holds no macOS baseline (`application-shell-web-darwin.png`); Playwright wrote one and failed the test. No UI changed in this story. The generated image was not committed. Roadmap 1.7.18 (BA-99) tracks the stale baseline.
- **Frontend unit test `App should support keyboard resizing from the separator`** (296 of 297 pass): fails on the headless window size, as recorded on `main` in the retrospective entries of 2026-10-09; no frontend source changed in this story.
- **Desktop:** not run (web target by default).

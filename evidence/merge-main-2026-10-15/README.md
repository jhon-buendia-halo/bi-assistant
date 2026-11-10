# Merge of `main` (v0.34.0) into the BA-9 branch — 2026-10-15

`origin/main` at `48d7d23` (64 commits since the branch point `f3ef18e`) merged into `feat/BA-9-golden-dataset-evals`. Before the merge, commit `58abf47` renumbered the branch's own ids past main's ([id-map.md](id-map.md)).

## What conflicted and how it was resolved

28 files conflicted after the renumbering, down from 29: renaming our `eval-sets.ts` removed the add/add clash.

| Area | Files | Resolution |
|---|---|---|
| Eval engine | `mastra/evals/assistant.evals.ts`, `assistant.evals.spec.ts`, `run-assistant-evals.ts` | Main's engine (`EvalTarget`, the RFP Builder's set, custom checks, `agentTools`, multi-turn history, CLI selection by `EVAL_SET`/`EVAL_CASES`) plus BA-9's JSON sets, judge option (off by default), statuses, criteria and categories. |
| World Cup and F1 sets | `sets/world-cup.json`, `sets/formula-1.json` | Main's BA-209 change (discovery cases no longer require `list_entities`) and its two tool-selection cases ported into the JSON files; new optional case field `agentTools`. Proved equal to main's cases: [set-equivalence.md](set-equivalence.md). |
| Agents module | `agents.controller.ts`, `agents.service.ts`, `eval-runs.service.ts` and specs | Main's per-agent evals, without owner scoping, plus BA-9's judge option and summary. |
| Auth | `auth/owner-scoping.spec.ts` | Main's deletion kept (BA-232). Our code that still signed in (`databricks/register.ts`, `scripts/setup-fixture-rest.ts`, `scripts/setup-fixture-databricks.ts`, `e2e/agents.spec.ts`) now calls the backend directly. |
| Testing data | `fixtures/registry.ts`, `registry.spec.ts`, `testing-data.service.spec.ts`, `e2e/testing-data.spec.ts` | Both sides' samples: main's first (with Intellify and the Intellify RFP API), then BA-9's. 16 in all. |
| Frontend | `agent-detail.html`, `agent-detail.ts`, `e2e/agents.spec.ts` | Main's restructured agent page; BA-9's Judge select, category chips and run summary inside its Evals tab. |
| Specs and logs | `specs/**` (11 files), `changelog.md`, `retrospective.md`, `roadmap.md` | Both sides kept. Where both changed one rule, it now states both changes; see the changelog entry of 2026-10-15. Main's Intellify feature moved from roadmap 1.1.2 to 1.1.19, and its evidence to `evidence/1.1.19/`. |

## Verification

| Check | Result | File |
|---|---|---|
| Backend `npm test` | 115 suites, 1771 tests passed | [backend-checks.txt](backend-checks.txt) |
| Backend `npm run lint` | 0 errors; 8 warnings, all in files identical to `origin/main` | [backend-checks.txt](backend-checks.txt) |
| Backend `npm run build` | passed | [backend-checks.txt](backend-checks.txt) |
| Frontend `ng test` (full suite) | 341 of 342 passed. `PromptEditor inserts the chosen link` failed intermittently in the full suite (code identical to main) and passed 9/9 three times when run alone | [frontend-checks.txt](frontend-checks.txt) |
| Frontend `ng build` | passed | — |
| `python3 scripts/check-specs.py` | all checks passed | — |
| Impacted E2E, web: `agents.spec.ts` | 13 of 13 passed, after two of our scenarios were scoped to the navigation rail | [e2e-results.txt](e2e-results.txt) |
| Impacted E2E, web: `testing-data.spec.ts` | 2 of 3 passed. `registers the Intellify RFP API` needs the shared `intellify_mercer_demo` database loaded by hand (see `.claude/skills/intellify-api`); it is not loaded on this machine, so the test fails the same way on `main` | [e2e-results.txt](e2e-results.txt) |
| World Cup, World Cup REST and Formula 1 sets vs main | same ids, same order, no unintended difference | [set-equivalence.md](set-equivalence.md) |

## Not run

- **Desktop**: not run (web target only).
- **Model evals**: not run, by the user's choice (deterministic checks only). No `npm run evals:assistant` on the merged branch.
- **Rest of the E2E suite**: only the impacted specs were run, per the workflow.

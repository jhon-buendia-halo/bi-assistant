# Merge of `main` (v0.38.0) into the BA-9, BA-123 and BA-124 branches — 2026-11-04

`origin/main` at `eb95e17` (v0.38.0, 117 commits since the branch point `ea78278`: BA-251 Data Readiness Agent, PR #82; BA-281 custom LLM endpoints, PR #83) merged into the three open PRs. Before each merge, a commit renumbered the cross-session memory ADR from ADR-0031 to ADR-0033, because `main` took ADR-0031 and ADR-0032 ([id-map.md](id-map.md)).

| PR | Branch | Renumber | Merge | Conflicted files |
|---|---|---|---|---|
| #60 | `docs/BA-123-knowledge-store-research` | `496fb93` | `e3568cb` (of `main`) | 1 |
| #61 | `docs/BA-124-knowledge-store-execution-plan` | `846295f` | `aa36f02` (of the updated #60, so `main` comes through it; #61 stays stacked on #60) | 3 |
| #81 | `feat/BA-9-golden-dataset-evals` | `36fd26f` | `3b9c107` (of `main`) | 9 |

`feat/BA-4-knowledge-store` (no PR) got the same renumbering (`38b1297`) and was not merged with `main`.

## What conflicted and how it was resolved

| PR | Area | Files | Resolution |
|---|---|---|---|
| #60, #61, #81 | Logs | `changelog.md`, `retrospective.md` | Both sides, newest date first. On #61, BA-124's changelog entry stays under BA-123's on 2026-10-29. |
| #61 | ADRs | `specs/system/architecture.md` | `main`'s ADR-0031 and ADR-0032, then the memory ADR-0033. |
| #81 | Eval engine | `mastra/evals/assistant.evals.ts` | BA-9's side (the cases live in the question bank files). `main`'s two changes to it: the resolver rename, applied to BA-9's call sites, and BA-300's rubric, ported (below). `main`'s `judgeOutput` target hook merged without a conflict. |
| #81 | Eval command line | `mastra/evals/run-assistant-evals.ts` | Both sides' imports. `main`'s `EVAL_LLM_*` hunks landed inside BA-9's `main(env, out)` in `main`'s style (`process.env`, `console`, `return;`); they now read `env`, print through `out` and return exit code 1. |
| #81 | Registry test | `mastra/evals/rfp.evals.spec.ts` | `EVAL_SETS` is the assistant's sets, `rfp` and `data-readiness`: `ASSISTANT_EVAL_SETS.length + 2`. |
| #81 | Agents module | `modules/agents/agents.service.ts` | Both sides' imports. |
| #81 | Specs | `specs/system/agents.md`, `api.md`, `specs/product/glossary.md` | agents.md 8.1: BA-9's sets table with a `data-readiness` row, `main`'s data-readiness section before BA-9's `rfp` paragraph; 8.5: BA-9's CLI text with `main`'s custom-endpoint paragraph, the `EVAL_LLM_*` refusal last in the ordered list and the `Model: …` line; the implementation note names `main`'s files. api.md and the glossary: both sides' rows and entries. |

### What merged without a conflict and still needed a change (#81)

- **`resolveAgentModel()` changed what it returns on `main`** (a built model; the config is `resolveAgentModelConfig()`). `modules/sessions/sessions.service.ts` called `modelIdOf(await resolveAgentModel())` for the SQL fixer's usage report, and the merged import no longer had `resolveAgentModel`, so the file would not have compiled. `sessions.service.spec.ts` and `assistant.evals.spec.ts` mocked the old name. All now use `resolveAgentModelConfig()`.
- **BA-300's rubric** (`main` reworded the `ambiguous-best-team` judge rubric in the in-code cases BA-9 had moved to JSON) is ported into `sets/world-cup.json` by a text splice. The rubric equals `main`'s text, and the file is otherwise unchanged (parsed before and after, every other field equal). `eval-set-files.spec.ts` compares the set files with the 1.1.4 snapshot (`evidence/1.1.4/eval-sets-before.json`, not edited); it now applies the rewording as one `main` made since (`REWORDED_ON_MAIN`), as it already does for BA-209 and BA-217.
- **Two test files met the other side's modules** at import: `main`'s `data-readiness.evals.spec.ts` now mocks `createScorer` (the set files wrap their checks with it when the registry loads), and BA-9's `run-assistant-evals.spec.ts` mocks the `data-readiness` agent, as both already did for the RFP Builder.

What each side deleted was checked against the other side's added lines: `main` deleted nothing; BA-9's deletions (`backend/eval/`, `check-answers.ts`, `run-eval.ts`) are used by none of `main`'s new code.

## Verification

| Check | Result | File |
|---|---|---|
| Backend `npx jest` | 180 suites, 3083 tests passed | [backend-checks.txt](backend-checks.txt) |
| Backend build type-check (`tsc -p tsconfig.build.json --noEmit`) | passed | [backend-checks.txt](backend-checks.txt) |
| Backend eslint and Prettier on the 10 touched files | 0 problems, Prettier-clean | [backend-checks.txt](backend-checks.txt) |
| Frontend `ng test` (headless) | 435 of 435 passed | [frontend-checks.txt](frontend-checks.txt) |
| Frontend `ng build` | passed | [frontend-checks.txt](frontend-checks.txt) |
| E2E compile (`tsc -p e2e/tsconfig.json`, `playwright test --list`) | passed, 390 tests in 26 files | [frontend-checks.txt](frontend-checks.txt) |
| `python3 scripts/check-specs.py` | all checks passed on #60, #61 and #81 | — |
| Impacted E2E, web: `agents`, `agent-hub`, `data-readiness`, `llm-custom-endpoint`, `session-management`, `testing-data` | 60 of 60 passed. The first run failed `registers the Intellify RFP API`: the shared Postgres had no `intellify_mercer_demo` database (a hand-loaded precondition, as on 2026-10-15). After loading the Intellify sample into it through an isolated CLI, `testing-data.spec.ts` passed 3 of 3 | [e2e-results.txt](e2e-results.txt) |
| `git merge-tree` of each branch with `origin/main` (and #61 with #60) after the merges | 0 conflicted files | — |

## Not run

- **Desktop**: not run (web target only).
- **Model evals**: not run, so the merged branch is a combination no eval has measured yet.
  - What the resolution left as it was: the assistant's prompt, context blocks and tools are byte-identical to the branch before the merge (`36fd26f`): the prompt fixture `assistant-prompt.full.txt` that `assistant.agent.spec.ts` pins, `assistant-prompt.ts`, `context-blocks.ts`, `dataset.tools.ts`, `left-join-filter.ts` and `visual.tools.ts`. `main`'s new skill (`data-readiness`) belongs to the Data Readiness Agent only, and `main`'s changes to `sessions.service.ts` are that agent's sessions and the resolver rename.
  - What `main` adds to the assistant's calls: BA-281's tuning in `model-compat.ts`. On Anthropic models an `effort` outside `low` to `max` maps to the nearest accepted value, and custom endpoints get their own route. The loop's rounds ran on OpenAI models, so they never measured it.
  - What this PR changes in the assistant: the loop's rounds (BA-242, BA-244 and BA-188: prompt rules such as A4 and A40, the column list in the turn, the dead-filter warning on `run_readonly_sql` results, the Finance and Marketing Analytics knowledge seeds). That is what the PR's eval gate measures, `main` against the branch on the beta's Claude model ([specs/epics/BA-9/spec.md](../../specs/epics/BA-9/spec.md), *The eval gate of this epic's PR*). It has not run, and it runs on the merged branch, so it covers both.
  - BA-300's rubric change is `main`'s and was gated there (agents-evals on the custom Anthropic-compatible route, `evidence/1.17/`).
- **Rest of the E2E suite**: only the specs the merge touches were run.

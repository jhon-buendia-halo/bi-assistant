# 1.1.13 and 1.1.14, memory part (BA-190) — E2E impact analysis (workflow step 6)

Acceptance gate run on 2026-11-02, after the user accepted BA-81 by hand and asked to go ahead with the rest. It covers what `1458eac` (the memory arms and the memory set) changed, and the gate's own changes to the specs and `agents.spec.ts`.

| Module | Change | Who sees it |
|---|---|---|
| `backend/src/mastra/evals/` (runner, `eval-memory.ts`, `memory-arm-option.ts`, `memory-case.ts`, `checks/memory-checks.ts`, `eval-usage.ts`, `eval-attempts.ts`, `run-assistant-evals.ts`, `validate-eval-sets.ts`, `result-set-check.ts`, `loop/*`, `sets/memory.json`, `pricing.json`) | the memory arm, the teach and probe steps, the memory checks M1 to M3, the validator's trap and teach queries, `EVAL_MEMORY`, the Memory and Recall lines, `eval:diff` and the leak check on memory cases; 36 memory cases in three sets | the command line, the loop's tools, the Evals tab's set list |
| `backend/src/modules/agents/` (`eval-runs.service.ts`, `eval-runs.repository.ts`, `agents.controller.ts`, `eval-report.ts`) | `arm` on the start request, its refusals, the run's `arm` (a run saved before it reads `none`), comparison within an arm, the report's Memory, Recall and per-agent token lines | API 36 to 38, the downloaded report |
| `backend/src/modules/memory/` (port, `signal-text.ts`, `learned-block.ts`) and `knowledge-snippet.entity.ts` | byte-identical copies of BA-81's, so the branches merge cleanly | nobody on this branch alone |
| `frontend/src/app/features/agents/` (`agent-detail`, `eval-trace`, `agents-api.service.ts`, `eval-run.util.ts`) | `Memory <arm>` chip on an execution, `Recall: <ms> ms` and the `Memory` tokens row in the Details panel | the Evals tab |

The change touches what the assistant receives only under a memory arm (the learned block, agents.md 8.3), which no chat turn uses on this branch; the memory runs themselves are BA-81's decision runs (roadmap 1.3.7, on the BA-4 branch), made on a local build that merges both branches.

## Per scenario

| Scenario | Feature (spec file) | Decision | Why |
|---|---|---|---|
| "Lists every question set, the former golden set inside the World Cup sets" | Agents (`agents.spec.ts`) | **Update** | The three memory sets are listed after `marketing-analytics-databricks` (R11, R233): 15 → 18 sets. The Gherkin and `EVAL_SETS` were stale since `1458eac`. |
| "Shows a memory run's arm and a question's recall time" | Agents (`agents.spec.ts`) | **Add** | The `Memory mastra` chip, no chip for a run with no arm, `Recall: 812 ms` and the `Memory` tokens row are what the change introduced in the UI (R245, R246). A seeded run, as the other finished-run scenarios: a run that reaches its end needs a model. |
| Every other scenario of the Agents Feature | Agents (`agents.spec.ts`) | **Re-run as-is** | The execution card, the Details panel and the report changed around them. |
| The seven scenarios of "Memory arms and memory sets" | agents-evals (command line) | **No Playwright**; unit tests listed under the Feature | They run from the command line on a real model; each is covered by the backend unit tests now listed after the Feature. |
| The improvement loop tools' scenarios | agents-evals (command line) | **Re-run as-is** (unit tests) | `eval:diff` warns on differing arms; the leak check reads memory cases; the failure export takes memory categories. |

No scenario is deleted. Desktop not run (web target only, as the Test target convention says).

Commands and counts: [checks.txt](checks.txt) and [e2e-results.txt](e2e-results.txt).

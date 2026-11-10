# 1.1.21 (BA-243) — E2E impact analysis (workflow step 6)

Acceptance gate run on 2026-10-27, after the user accepted the change by hand. It covers what changed from `4bd9484` (the last gate, 1.1.24 and 1.1.25) to `198e438`:

| Module | Change | Who sees it |
|---|---|---|
| `backend/src/mastra/evals/sets/finance.json` | six investigation cases (four dev, two held out); 68 → 74 questions, 22 held out; their `matches` patterns widened on 2026-10-27 | the question bank, the Evals tab's set list and question text |
| `backend/src/mastra/evals/sets/marketing-analytics.json` | six investigation cases (four dev, two held out); 50 → 56 questions, 18 held out; patterns widened the same way | the same |
| `docs/evals/loop/leak-allowlist.txt` | 89 generic pattern words allowlisted, each with its reason | `eval:leak-check` (the loop's fixer rounds) |
| `docs/evals/domains/finance.md`, `marketing-analytics.md`, `README.md`, `docs/evals/loop/program.md` | briefs with the held-out wording and its provenance; counts | people and the loop |
| `specs/capabilities/agents-evals/spec.md`, `specs/system/agents.md` | R11 counts, *Eval suite content*, the set-list Gherkin, agents.md 8.1 | — |

No production code changed, and nothing the assistant receives changed (prompt, skills, tools, context blocks, model routing), so the eval gate of the `verify` skill does not apply to this feature.

## Per scenario

| Scenario (agents-evals, Feature: Agents) | Decision | Why |
|---|---|---|
| "Lists every question set, the former golden set inside the World Cup sets" | **Update** (made in the fast loop, `5e0cea4`) | Its counts for `finance`, `finance-rest`, `finance-databricks` (68 → 74) and the three Marketing Analytics sets (50 → 56) are what this change introduced; `EVAL_SETS` in `frontend/e2e/agents.spec.ts` carries them, so the scenario fails on `4bd9484`. |
| Every other scenario of `agents.spec.ts` | **Re-run as-is** | The Evals tab lists, opens and runs the sets the banks feed. |

No scenario is added or deleted. No Gherkin step names a case's wording, a `matches` pattern or an allowlist word; those are pinned by the loader test (`eval-set-files.spec.ts`, every set file loads and validates), the check tests, and the leak-check tests of 1.1.23 (R224 to R230). The investigation cases' references and checks were validated outside the suite (`references-ba243.txt`, `validate-ba243.txt`, `pattern-fix-recheck.txt`).

Desktop not run (web target only, as the Test target convention says).

Commands and counts: [checks.txt](checks.txt) (section *Acceptance gate*) and [e2e-results.txt](e2e-results.txt).

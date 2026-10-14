# Evidence — 1.13.5 Split interactive-visuals into spec-mode and freeform references (BA-203)

Epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198). This is the epic's last story, so this folder also holds the integrated-head gates and the epic's before and after evals.

| File | What it shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step-6 analysis: one scenario added (`designer-skills.spec.ts`). |
| [e2e-web.txt](e2e-web.txt) | Playwright web on the integrated head `49184ac`: **89 passed, 2 skipped**. It includes `designer-skills.spec.ts`, which failed on the pre-change build (the designer's system message held front matter and the whole freeform section) and passes now, and the three `assistant-skills.spec.ts` scenarios. |
| [e2e-org.txt](e2e-org.txt) | Playwright org: **47 passed**. |
| [ng-test.txt](ng-test.txt) | Frontend unit at 1440×900: **297 passed**. |
| [evals/](evals/) | The world-cup eval runs below, the per-case JSON (answers, tool calls, check reasons) and the scratch driver `run-evals.cjs` used for them. |

Skill size per designer call: 11,991 characters before (the whole `SKILL.md`). Now the router body plus one reference: about 4.1k on a spec call and 8.4k on a freeform call. The rules moved verbatim, checked with a diff against `f3ef18e`.

Backend `npx jest`: 65 suites and 1091 tests passed. `tsc` shows only the 4 known errors. ESLint per touched file matches the base, and the new files are at 0. `check-specs.py` passes.

**Desktop not run:** `developer-settings.spec.ts` "the desktop app offers to restart the backend…" and `diagnostics.spec.ts` "captures live renderer failures…" are desktop-only. They were skipped on web, and no desktop run was requested.

## Evals

The world-cup set (10 cases) ran with `anthropic/claude-sonnet-5` through the same `runAssistantEvals` the in-app runner uses, at the base `f3ef18e` and at the epic head `49184ac`. That's a scratch driver ([evals/run-evals.cjs](evals/run-evals.cjs)), because the shipped `npm run evals:assistant` passes no case ids and its one-fixture preflight always refuses.

| Case | Before (`f3ef18e`) | After (`49184ac`) |
|---|---|---|
| `champion-2022` | PASS | FAIL |
| `final-score-2018` | FAIL | FAIL |
| `top-scorer-2022` | FAIL | FAIL |
| `shootouts` | PASS | PASS |
| `biggest-venue` | FAIL | FAIL |
| `schema-discovery` | FAIL | FAIL |
| `ambiguous-best-team` | FAIL | FAIL |
| `possession-vs-result` | PASS | PASS |
| `out-of-scope` | PASS | PASS |
| `visual-request` | PASS | PASS |
| **Total** | **5/10** | **4/10** |

**The one flip, `champion-2022`, is a flaky case on both builds, not a regression from this epic.** Every run's answer was correct ("Argentina won the 2022 FIFA World Cup", with the 3–3 final and the shootout). The check that fails is the strict `result-set-match`: its outcome depends on which columns the model selects. The case was re-run to tell noise from a change:

| Build | Runs of `champion-2022` | Pass rate |
|---|---|---|
| Before `f3ef18e` | PASS, PASS, FAIL, FAIL | 2/4 |
| After `49184ac` | FAIL, FAIL, FAIL, PASS | 1/4 |

Four runs per build can't separate 50% from 25%, so this shows no regression rather than proving equality. Every other case came out the same before and after. `visual-request` passes after the change, and it's the case most exposed to the designer split and to removing the assistant's skill catalog.

The baseline failures are all strict-check misses, not wrong answers. Three are a result-set shape mismatch. `schema-discovery` called `describe_entity` instead of `list_entities`. In `ambiguous-best-team`, two duplicate `ask_clarification` calls returned errors. These are worth a separate look at the eval checks, outside this epic.

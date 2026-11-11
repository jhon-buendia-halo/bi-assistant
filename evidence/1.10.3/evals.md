# 1.10.3 — Assistant evals (World Cup set)

`EVAL_DATASETS="World Cup Core" EVAL_SET=world-cup node dist/mastra/evals/run-assistant-evals.js` (12 cases), backend dist of this branch, each target on its own scratch copy of the data dir, 2026-11-10. Model routing changed (a fifth provider), so the set ran on the existing provider (regression) and on the new one.

## Existing provider: custom endpoint (Anthropic style, `claude-sonnet-5-5`), via `EVAL_LLM_*`

| Run | Passed | Failed |
|---|---|---|
| 1 | 11/12 | `no-clarification-best-team` (LLM judge: figures not visible in truncated tool output) |
| 2 | 11/12 | `champion-2022` (one SQL error the model recovered from) |
| 3 | 11/12 | `no-clarification-best-team` (LLM judge) |
| Re-runs of the two failing cases | 3/3 each | — |

Every case has 3 passing runs: **100%**. Every change outside the Copilot provider is behind a `copilot` config check (`model-factory`, `model-compat`, `effort-levels`, `visualization.agent`), so this path is unchanged by the branch; the one-off failures are model and judge variance.

## New provider: GitHub Copilot (`auto`, Copilot Free seat), via the saved settings

The LLM judge runs on the same configured model, so on these runs Copilot also grades the answers.

**Before the R66 fix** (3 full runs: 11, 10, 10 of 12; re-runs of the five failing cases: 0/5, 1/5, 4/5). In one re-run of `possession-vs-result` the answer was the arguments of `run_readonly_sql` written as text (`{"sql":…,"datasourceId":…,"limit":200,"rationale":…}`), with no tool call. A trace of the runtime's JSON-RPC traffic (through a logging proxy, 3 runs of that case) showed every step of the turn continuing in the same live Copilot session, so the cause is the auto-routed model writing a tool call as its message, not the adapter's history replay. The fix is llm-settings R66: text that starts like JSON is held back, a message that fits exactly one offered tool's arguments is never shown, and the model is asked once, in the same session, to call that tool. Unit tests in `copilot-model.spec.ts`, E2E scenario "A tool call written as text is never shown".

**After the R66 fix**:

| Run | Passed | Failed |
|---|---|---|
| 1 | 11/12 | `ambiguous-best-team` (judge: the clarification options are in the `ask_clarification` call, not repeated in the final text) |
| 2 | 11/12 | `out-of-scope` (judge: the answer mentions that a player search found no Pelé) |
| 3 | 10/12 | `ambiguous-best-team` (as run 1); `possession-vs-result` (2 SQL errors out of 13 tool calls, recovered) |

32 of 36 (89%). No answer in the 36 runs is a tool's arguments written as text. **Not 100%**: the remaining failures are answer quality of the model the Free seat auto-routes to (graded by the same model), not errors of the provider. The user chose, on 2026-11-10, to fix the raw-JSON defect, document these, and ship. Tuning the assistant prompt for that model is out of this story's scope.

Raw results (local, not committed): the scratch eval folder of this session (`evals/*.json`, `evals/before-r66/`).

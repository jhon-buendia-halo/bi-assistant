# Evidence — 1.17.1 to 1.17.20 Custom LLM endpoint provider (BA-281)

Epic [BA-281](https://halo-powered.atlassian.net/browse/BA-281), stories BA-282 to BA-301, roadmap 1.17.1 to 1.17.20, spec [specs/epics/BA-281/spec.md](../../specs/epics/BA-281/spec.md), ADR-0032. Acceptance gate run on 2026-11-03 against the web app built from `feat/BA-281-custom-llm-endpoint`. Desktop not run (not requested).

## E2E (Playwright, web target)

[e2e-results.txt](e2e-results.txt): **74 passed, 1 skipped** (the desktop-only diagnostics scenario, "desktop not run").

| Spec | Decision (step 6) | Result |
|---|---|---|
| `llm-custom-endpoint.spec.ts` | Add: 6 OpenAI-style scenarios (stub `helpers/llm-stub.ts` under `/v1`) and 4 Anthropic-style scenarios (stub `helpers/anthropic-stub.ts`), one file for the Feature "Custom endpoint connection" | 10 passed |
| `llm-settings.spec.ts` | Re-run as-is (form, composer effort, LenAI) | 9 passed |
| `agent-editor.spec.ts`, `agents.spec.ts`, `agent-hub.spec.ts` | Re-run as-is (agent LLM config, catalogue provider) | passed |
| `chat-clarification.spec.ts`, `chat-and-visuals.spec.ts`, `visual-tailoring.spec.ts` | Re-run as-is (model resolver, visual designer model, chat errors) | passed |
| `diagnostics.spec.ts`, `developer-observability.spec.ts` | Re-run as-is (key redaction in logs and diagnostics) | passed, 1 desktop-only skipped |

Screenshots from the new spec: [llm-custom-load-models.png](llm-custom-load-models.png) (OpenAI style, Load models list) and [llm-custom-anthropic-tested.png](llm-custom-anthropic-tested.png) (Anthropic style, test passed).

The 10 `llm-custom-endpoint` scenarios assert behaviour that does not exist on `main` (no `custom` provider, API style select, Load models or `POST /llm/models`).

## Live smoke against a real endpoint

`backend/scripts/custom-endpoint-smoke/run.sh` against a local CLIProxyAPI relay (`127.0.0.1:8317`), model `claude-sonnet-4-6`, both API styles: **18 passed, 0 warnings, 0 failed**. Load models, test connection, save, read back (masked key) and a real assistant turn in each style; the key scan over every API response, the data dir and the app log found no key. [live-smoke/console.txt](live-smoke/console.txt), [live-smoke/report.json](live-smoke/report.json), [live-smoke/app.log](live-smoke/app.log) (redacted).

## Evals (model routing changed)

World Cup set (12 cases), model `claude-sonnet-4-6` through the same relay, data dir with the World Cup sample loaded through Testing Data.

- **Branch:** `EVAL_LLM_PROVIDER=custom`, `EVAL_LLM_API_STYLE=anthropic`, `EVAL_LLM_BASE_URL=http://127.0.0.1:8317` (BA-300), so the custom Anthropic-compatible route built by `@ai-sdk/anthropic` (ADR-0032).
- **Base (`main` = ea78278):** saved provider `anthropic` with `ANTHROPIC_BASE_URL=http://127.0.0.1:8317/v1` (Mastra's router reads it; the `/v1` is required, since the SDK appends `/messages`).

Each cell is passes/runs, in run order (P pass, F fail):

| Case | main (base ea78278), old rubric | branch, old rubric | branch, fixed rubric (e6be73d) |
|---|---|---|---|
| `champion-2022` | 3/3 (PPP) | 3/3 (PPP) | 1/1 (P) |
| `final-score-2018` | 3/3 (PPP) | 3/3 (PPP) | 1/1 (P) |
| `top-scorer-2022` | 3/3 (PPP) | 3/3 (PPP) | 1/1 (P) |
| `shootouts` | 3/3 (PPP) | 3/3 (PPP) | 1/1 (P) |
| `biggest-venue` | 3/3 (PPP) | 3/3 (PPP) | 1/1 (P) |
| `schema-discovery` | 3/3 (PPP) | 3/3 (PPP) | 1/1 (P) |
| `ambiguous-best-team` | 10/12 (PPPPPPPFFPPP) | 6/9 (PFPFPPPFP) | 7/7 (PPPPPPP) |
| `possession-vs-result` | 5/6 (FPPPPP) | 5/6 (PPFPPP) | 1/1 (P) |
| `out-of-scope` | 3/3 (PPP) | 3/3 (PPP) | 1/1 (P) |
| `visual-request` | 3/3 (PPP) | 3/3 (PPP) | 1/1 (P) |
| `no-clarification-best-team` | 3/3 (PPP) | 3/3 (PPP) | 1/1 (P) |
| `no-visuals-chart-request` | 3/3 (PPP) | 3/3 (PPP) | 1/1 (P) |

- `ambiguous-best-team` failed about 1 run in 4 **on both builds**, always on the LLM judge, for the same metric-only clarification ("Most World Cup titles won / Most matches won / Best win rate / Most goals scored — across all tournaments"): the judge read "ambiguous on both metric and scope" as requiring both dimensions, although the rubric's own pass example says "a metric ... or a tournament year". The rubric now says one dimension with concrete options is enough (commit e6be73d, agents-evals spec table row updated); after it, 7 of 7 branch runs passed.
- `possession-vs-result` failed once on each build: on `main` a tool error, on the branch a miscount (7 knockout matches instead of 8). Both are model variance on the base too; the branch then passed 4 runs in a row.
- Final full branch run with the fixed rubric: **12/12** ([evals/branch-final.txt](evals/branch-final.txt)). Every case ends with at least 3 consecutive passing runs on the branch.

Per-run logs (checks and reasons, no answers or keys): [evals/](evals/).

## Other checks

- Two late fixes on verified unit branches were merged at the gate: `fix(BA-286)` (an aborted Anthropic-style probe reports the timeout) and `test(BA-293)` (the saved key mask is re-read after save). After them `llm-custom-endpoint.spec.ts` and `llm-settings.spec.ts` were re-run: **19 passed** (appended to [e2e-results.txt](e2e-results.txt)).
- Backend `npx jest`: **100 suites, 1708 tests passed**. ESLint on the changed backend files: 0 problems.
- Frontend `ng test` (Chrome for Testing 153): **348 of 349 passed**. The one failure, `WorkflowBar Details opens on the current step…` (scrollTop 10 vs 110), also fails when its spec runs alone; the branch does not touch `features/sessions`, so it is not caused by this epic (a layout difference in the newer headless Chrome). In one of three full runs `UiPreferencesService writes nothing when nothing was ever chosen` also failed; it passes alone and in the other runs, and its file is unchanged on the branch.
- Builds: backend `nest build` and `build:all`, frontend `ng build` (existing budget and NG8102 warnings only, none in changed files).
- `python3 scripts/check-specs.py`: all checks passed.

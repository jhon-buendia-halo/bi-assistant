# 1.23.12 — Agent prompt and tool-list hashes, base vs branch

Measured with [measure-hashes.cjs](../1.23.4/measure-hashes.cjs) from the compiled agents (`npx nest build` in `backend/`, then `node evidence/1.23.4/measure-hashes.cjs backend/dist`), on a fresh scratch `APP_DATA_DIR`, on 2026-11-11:

- **base:** `feat/M1-23-workflow-first` at `f9f73579`, before any change of this story;
- **branch:** `unit/M1-23-1.23.12` with this story's changes.

`instructionsSha256` is the first 16 hex chars of the SHA-256 of `agent.getInstructions()`. `toolListSha256` hashes the sorted tool ids, each with its description.

| Agent | Prompt chars | Prompt hash (base) | Prompt hash (branch) | Tools | Tool-list hash (base) | Tool-list hash (branch) |
|---|---|---|---|---|---|---|
| `assistant` | 8941 | `4b5bffd8cf3692c3` | `4b5bffd8cf3692c3` | 9 | `82a571d15af79e57` | `82a571d15af79e57` |
| `rfp` | 9941 | `464bf0fd05d1cb6d` | `464bf0fd05d1cb6d` | 23 | `ae32589c79433cf7` | `ae32589c79433cf7` |
| `data-readiness` | 5716 | `97a99bcea2814a3d` | `97a99bcea2814a3d` | 9 | `2fac61dc28c01d2e` | `2fac61dc28c01d2e` |
| `assistant-v2` | 766 | `eaeb63b48b9e9932` | `eaeb63b48b9e9932` | 3 | `8e2247b12b5a7338` | `8e2247b12b5a7338` |

The two JSON outputs were byte-identical (`diff` printed nothing). No agent's prompt or tools changed, so no eval run is needed (lessons.md, "Evals and agents").

The per-turn context is unchanged too: a run's agent turn goes through the chat turn path on a run host (agents.md 5.14). `backend/test/workflow-runs.e2e-spec.ts` records every model request with the stub model and checks a run's requests equal a chat turn's for the same input, for the Assistant, Questions to Insights v2, the Data Readiness Agent and the RFP Builder; `backend/src/modules/sessions/run-host-sessions.spec.ts` checks the same for the four and a user agent at the `agent.stream()` call (input, options, system blocks, requestContext keys).

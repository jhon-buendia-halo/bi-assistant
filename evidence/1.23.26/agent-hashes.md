# 1.23.26 — Agent prompt and tool-list hashes, base vs branch

Measured with [measure-hashes.cjs](../1.23.4/measure-hashes.cjs) (story 1.23.4's script) from the compiled agents: `npx nest build` in `backend/`, then `node evidence/1.23.4/measure-hashes.cjs backend/dist`, on a fresh scratch `APP_DATA_DIR`, on 2026-11-11:

- **base:** `feat/M1-23-workflow-first` at `8b9b39fb`, before any change of this story;
- **branch:** `unit/M1-23-1.23.26` with the turn engine moved into `backend/src/modules/sessions/turn/`.

`instructionsSha256` is the first 16 hex chars of the SHA-256 of `agent.getInstructions()`. `toolListSha256` hashes the sorted tool ids, each with its description.

| Agent | Prompt chars | Prompt hash (base) | Prompt hash (branch) | Tools | Tool-list hash (base) | Tool-list hash (branch) |
|---|---|---|---|---|---|---|
| `assistant` | 8941 | `4b5bffd8cf3692c3` | `4b5bffd8cf3692c3` | 9 | `82a571d15af79e57` | `82a571d15af79e57` |
| `rfp` | 9941 | `464bf0fd05d1cb6d` | `464bf0fd05d1cb6d` | 23 | `ae32589c79433cf7` | `ae32589c79433cf7` |
| `data-readiness` | 5716 | `97a99bcea2814a3d` | `97a99bcea2814a3d` | 9 | `2fac61dc28c01d2e` | `2fac61dc28c01d2e` |
| `assistant-v2` | 766 | `eaeb63b48b9e9932` | `eaeb63b48b9e9932` | 3 | `8e2247b12b5a7338` | `8e2247b12b5a7338` |

The two JSON outputs were byte-identical (`diff` printed nothing). No agent's prompt or tools changed, so no eval run is needed (lessons.md, "Evals and agents").

The per-turn context (the system blocks, requestContext keys, memory thread and input that `TurnOptions` now builds) is not in these hashes. It is covered by:

- the backend unit suite, which is unchanged: 186 suites, 3,072 tests on base and on the branch;
- the backend e2e suite: 10 suites, 97 tests passed on the branch;
- the request-recording Playwright specs (`chat-and-visuals`, `agent-sessions`, `chat-clarification`, `agent-panel`, `workflow-runs`, project `web`): 36 passed on the branch.

A literal-by-literal check found that every string literal, template literal and comment of the base `sessions.service.ts` is still present, verbatim, in the new `sessions.service.ts` or in `turn/`. The only differences are import paths and one empty section divider.

`sessions.service.ts` went from 3,496 lines to 1,498 lines, 1,998 fewer.

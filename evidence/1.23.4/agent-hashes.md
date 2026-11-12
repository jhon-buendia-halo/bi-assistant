# 1.23.4 — Agent prompt and tool-list hashes, base vs branch

Measured with [measure-hashes.cjs](measure-hashes.cjs) from the compiled agents (`npx nest build` in `backend/`, then `node evidence/1.23.4/measure-hashes.cjs backend/dist`), on a fresh scratch `APP_DATA_DIR`, on 2026-11-11:

- **base:** `feat/M1-23-workflow-first` at `0c1427d5`, before any change of this story;
- **branch:** `unit/M1-23-1.23.4` with this story's changes.

`instructionsSha256` is the first 16 hex chars of the SHA-256 of `agent.getInstructions()`. `toolListSha256` hashes the sorted tool ids, each with its description.

| Agent | Prompt chars | Prompt hash (base) | Prompt hash (branch) | Tools | Tool-list hash (base) | Tool-list hash (branch) |
|---|---|---|---|---|---|---|
| `assistant` | 8941 | `4b5bffd8cf3692c3` | `4b5bffd8cf3692c3` | 9 | `82a571d15af79e57` | `82a571d15af79e57` |
| `rfp` | 9941 | `464bf0fd05d1cb6d` | `464bf0fd05d1cb6d` | 23 | `ae32589c79433cf7` | `ae32589c79433cf7` |
| `data-readiness` | 5716 | `97a99bcea2814a3d` | `97a99bcea2814a3d` | 9 | `2fac61dc28c01d2e` | `2fac61dc28c01d2e` |
| `assistant-v2` | 766 | `eaeb63b48b9e9932` | `eaeb63b48b9e9932` | 3 | `8e2247b12b5a7338` | `8e2247b12b5a7338` |

The two JSON outputs were byte-identical (`diff` printed nothing). No agent's prompt or tools changed, so no eval run is needed (lessons.md, "Evals and agents"). The per-turn context blocks are covered by the unchanged unit suites and by the request-recording Playwright specs, which assert what reaches the model.

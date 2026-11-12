# 1.23.32 — Playwright in parallel: timings

Machine: macOS (darwin, Apple Silicon), the shared compose Postgres on 55432 (`E2E_SKIP_DOCKER=1`), after `npm run test:e2e:prepare`. Full `web` project: 278 tests in 35 spec files. Command: `npx playwright test --project=web --reporter=dot,json`. Wall time measured with `date` around the command, so it includes Playwright start-up.

## Before (unchanged code, `workers: 1` in the config)

| Run | Workers | Wall time | Result |
| --- | --- | --- | --- |
| Serial, as configured | 1 (`--workers=1`) | 508 s (8.5 min) | 275 passed, 2 skipped, 1 failed* |
| First parallel probe | 3 (`--workers=3`) | 189 s (3.1 min) | 275 passed, 2 skipped, 1 failed* |

Total test time in the 3-worker probe: 542 s. No test failed because of shared state, so no spec needed a fix or a serial exception.

## After (`workers: 3` by default, `fullyParallel: false`)

| Run | Workers | Wall time | Result |
| --- | --- | --- | --- |
| 1 | 3 (config default) | 186 s | 275 passed, 2 skipped, 1 failed* |
| 2 | 3 (config default) | 186 s | 275 passed, 2 skipped, 1 failed* |
| 3 | 3 (config default) | 186 s | 275 passed, 2 skipped, 1 failed* |

Speed-up: 508 s → 186 s, about 2.7×. Flakes in 4 parallel runs (the probe and runs 1–3): 0. Afterwards no `*_e2e_*` or `synthetic_replay_*` database was left on the shared Postgres.

\* The one failure is always `layout-accessibility.spec.ts` › "matches the stable application-shell visual baseline". It fails on macOS web in every mode, serial included, because there is no `application-shell-web-darwin.png` baseline. It is not related to parallelism, and the new baseline it writes was deleted after each run.

## Why it is parallel-safe

- Each web test starts its own CLI on a free port with its own temp data dir. The embedded Intellify API (`INTELLIFY_API_PORT=0`) and every stub server (`listen(0)`) also take a free port.
- The specs that write to the shared Postgres already isolate themselves. `testing-data.spec.ts` creates `intellify_e2e_<time>` and `us_health_e2e_<time>` and drops them. `synthetic-data.spec.ts` creates `synthetic_replay_<pid>_<time>` and drops it. `rfp-builder.spec.ts` deletes the RFP records it creates in `intellify_mercer_demo` and asserts only on its own ids. `agent-sessions.spec.ts` checks that the read-only guard blocks `DELETE FROM world_cup.matches` and that the row count is unchanged.
- Evidence screenshots written during the run go to distinct file names, so no two spec files write the same file.
- File-level parallelism is enough: the slowest file (`monitoring.spec.ts`, 55 s) is far below 542 s / 3. Turning on `fullyParallel` would gain little. It would also split files whose tests share module-level state (for example, the database names `testing-data.spec.ts` computes once per file).
- The `desktop` project keeps `workers: 1`, because its backend always listens on port 3000.

## Serial exceptions

None.

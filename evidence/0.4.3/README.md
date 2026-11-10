# 0.4.3 — Agent roles: builder, reviewer and a manager that only answers the human (BA-119)

Developer tooling only: nothing under `backend/` or `frontend/` changes ([diff-stat.txt](diff-stat.txt)). So the application's E2E, unit, lint and build suites and the evals were not run for this change. Following the 0.4.1 lesson, it was verified with fresh headless `claude -p` sessions. Desktop not run (no app change).

| Artifact | Shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step 6: no component touched, no Gherkin scenario impacted. |
| [fresh-session.txt](fresh-session.txt) | `claude -p --agent manager`. The session's init lists the agents `builder`, `manager` and `reviewer`. The manager's tools are only `Read, Grep, Glob, PushNotification`, with 0 MCP tools: no Edit, Write, Bash or Agent. Asked to create a file, it refused, and no file exists. `AskUserQuestion` is absent only because a headless run has no human to ask. |
| [reviewer-planted-bug.txt](reviewer-planted-bug.txt) | `claude -p --agent reviewer` on a scratch story and diff with a planted off-by-one. It answers `FINDINGS`: the off-by-one with failing inputs, the missing upper-bound test, and the missing callers. It ran on `claude-sonnet-5-5` for $0.05. |
| [dry-run-demo.webm](dry-run-demo.webm) | The demo video from the dry run below: 20 s, 1280×800, captioned with the scenario's Gherkin lines. |
| [check-specs.txt](check-specs.txt) | `check-specs.py` on Windows. The one failure ("Playwright specs each mirror a Feature") is the same on `main`: `glob` returns `frontend/e2e\x.spec.ts` on Windows, which never matches the forward-slash paths in the specs. CI runs on Linux. |
| [diff-stat.txt](diff-stat.txt) | `git diff --stat main` for the epic branch: no application file. |

## Dry run (throwaway epic DEMO-1, 2026-11-09)

Two throwaway stories went through the fast loop on a local branch that was never pushed and has since been deleted. The real `builder`, `reviewer` and `manager` agents ran headless. The scripts that are not built yet (`brief.mjs`, the pipeline, `qa.mjs`, `board.mjs`) were done by hand in their planned order.

| Story | Build (builder) | Checks (no LLM) | Review (reviewer) | QA (no LLM) | Manager "what needs me?" | LLM total |
|---|---|---|---|---|---|---|
| 9.9.1 `formatDuration` (backend) | 41 s, 9 turns, $0.45 | tsc, eslint, Jest 5/5 | APPROVE, round 1, $0.04 | `demo.txt` transcript | One question (round or truncate the decimal), recommended option first, $0.13 | $0.62 |
| 9.9.2 Appearance "In effect" line (UI) | 118 s, 28 turns, $0.68 | tsc app + e2e, Karma 4/4 (frontend has no lint) | APPROVE, round 1, $0.08 | `appearance.spec.ts` 8/8; `DEMO=1` run recorded [dry-run-demo.webm](dry-run-demo.webm) | One question (accept 9.9.2), with the video path, $0.13 | $0.89 |

The `DEMO=1` switch and the `scenarioStep` caption helper used for the video are kept on the local branch `unit/BA-119-0.4.5-demo-captions` for story 0.4.5. They are not part of this change.

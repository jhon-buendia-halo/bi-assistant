# 1.11.3 — Task details in the workflow pane (BA-174)

Developer tooling only: nothing under `backend/` or `frontend/` changes ([diff-stat.txt](diff-stat.txt)), so the application's E2E, unit, lint and build suites were not run for this change; the step-6 analysis found no app scenario exercised ([e2e-impact.md](e2e-impact.md)). The pane was seen in a live terminal session (Claude Code 2.1.296); the desktop app was not run.

| Artifact | Shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step 6: no app component touched; the decision for each of the mod's tests (re-run, update or add). |
| [plugin-test-first-run.txt](plugin-test-first-run.txt) | Step 7: the tests written before the code. `rules.test.ts` does not load (no `factsFor`, `completion`, `summarize`, `expectedAgent` yet), the queue tests find the old row format, and every press fails with `no Button … keyed "row-1"`. |
| [validate.txt](validate.txt) | `claude plugin validate` on the mod (now reading and writing `workflow-steps.open`) and on the repository marketplace, both passing. |
| [plugin-test.txt](plugin-test.txt) | `claude plugin test` on the final code: 29 passed, 11 rule tests and 18 queue tests, among them the checklist facts, completion with live checks, the summary, the expected agent, a press that opens and a second that closes a row with two open at once, a queued step's detail, the overall %, a subagent's tokens, a 96-column and a 74-column pane, and step 1's session checks. |
| [tsc.txt](tsc.txt) | `tsc` over `hooks/` and `types/` against the engine's declarations (2.1.295): clean. The test file is type-loose as on `main` (12 errors there today, the same stub shapes). |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing with the rewritten §9, the roadmap entry and the epic spec. |
| [pane-capture.txt](pane-capture.txt) | A live session (`claude --plugin-dir .claude/mods/workflow-steps`, 180×60 tmux, the pane a 72-column sidebar): the queue at start with `~main` agents and `overall 0%`; after a prompt that read `roadmap.md` and wrote `evidence/1.11.3/scratch.md`, #1 done at 100%, #2 *Update changelog with evidence* running at 50% (evidence added, no changelog), `overall 50%`; then `ctrl+x tab`, Down, Enter opening #1's detail (summary, `2 of 2 checks · 100%` with both checks, agents, cost) and Enter again closing it. |
| [diff-stat.txt](diff-stat.txt) | `git diff --stat` of the branch: no application file. |

Two problems the tests had not shown were found in the live session and fixed with a test each before this evidence was taken: rows wrapped in the 72-column sidebar (a `Button` does not truncate its children, so the row now drops columns to fit), and #1 stayed at 0% when its calls counted for other steps (step 1's checks are now the session's).

Not covered: a mouse click in a live session (tmux had no mouse; a click raises the same `ui.press` as Enter and as the test kit's `press`), and a live subagent run (covered by a test). The capture shows #1's summary as `no calls yet`; that text became `no calls counted for this step` after the capture.

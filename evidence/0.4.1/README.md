# 0.4.1 — Split CLAUDE.md into workflow-stage skills (BA-236)

Developer tooling only: nothing under `backend/` or `frontend/` changes ([diff-stat.txt](diff-stat.txt)). So the application's E2E, unit, lint and build suites and the evals were not run for this change (no agent input changed); the step-6 analysis found no scenario exercised. Desktop not run (no app change).

| Artifact | Shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step 6: no component touched, no Gherkin scenario impacted. |
| [section-map.md](section-map.md) | Where each CLAUDE.md section went, and the line check: 129 of the 140 non-blank lines of `main:CLAUDE.md` found verbatim, each in one place (the only repeats are two ```` ```bash ```` fences); the 11 others are reworded pointers or the two deliberate rule changes (Epic-gate check through `get_issue`, the planning model). |
| [mod-parse.txt](mod-parse.txt) | The `workflow-steps` mod's own `parseWorkflow` run on the new CLAUDE.md: 11 steps and the mandatory first action. |
| [mod-plugin-test.txt](mod-plugin-test.txt) | `claude plugin test` on the mod: 29 pass. |
| [fresh-session.txt](fresh-session.txt) | A fresh headless Claude Code session in the worktree lists the 8 `workflow-` skills, `verify` and `jira`. |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing, links inside every `SKILL.md` included. |
| [diff-stat.txt](diff-stat.txt) | `git diff --stat main` for the epic branch: no application file. |

# 0.4.2 — Jira MCP tool in `.claude/tools` for epics and stories (BA-237)

Developer tooling only: nothing under `backend/` or `frontend/` changes ([diff-stat.txt](diff-stat.txt)). So the application's E2E, unit, lint and build suites and the evals were not run for this change; the step-6 analysis found no scenario exercised. Desktop not run (no app change).

Only read tools were called against the real Jira. The write tools (`create_epic`, `create_issue`, `update_issue`, `add_comment`, `transition_issue`) are covered by the unit tests against a faked Jira, so no test issue was filed. BA-237 itself was created earlier through the old script.

| Artifact | Shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step 6: no component touched, no Gherkin scenario impacted. |
| [unit-tests.txt](unit-tests.txt) | `node --test '.claude/tools/jira/tests/*.test.mjs'`: 13 pass. Includes a Story under an Epic sending `parent`, a Story or Bug without an epic and a non-Epic parent refused before any write, update sending only the given fields, transitions by name, Jira's error text surfacing, config precedence and the worktree fallback, and the MCP handshake. |
| [stdio-smoke.txt](stdio-smoke.txt) | The server over real stdio from the worktree, which has no `.env`: it reads the main checkout's `.env`, lists 11 tools (6 read, 5 write) and returns BA-237 with parent BA-119, type `Epic`. |
| [claude-mcp-get.txt](claude-mcp-get.txt) | `claude mcp get jira` in the worktree: project scope from `.mcp.json`, `✔ Connected`. |
| [fresh-session.txt](fresh-session.txt) | A fresh headless session lists the 11 `mcp__jira__` tools and calls `get_issue BA-236` with no permission prompt (`permission_denials: []`): parent BA-119, an Epic. |
| [check-specs.txt](check-specs.txt) | `check-specs.py` passing, with links in `.claude/tools/**/*.md` checked. |
| [diff-stat.txt](diff-stat.txt) | `git diff --stat main` for the epic branch: no application file. |

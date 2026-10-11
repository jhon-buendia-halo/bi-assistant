# 1.11.1 — Ship the workflow-steps mod in the repo and make it installable (BA-170)

Developer tooling only: nothing under `backend/` or `frontend/` changes ([diff-stat.txt](diff-stat.txt)), so the application's E2E, unit, lint and build suites were not run for this change; the step-6 analysis found no scenario exercised. The pane was seen in the terminal (Claude Code 2.1.296); the desktop app was not run.

| Artifact | Shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step 6: no component touched, no Gherkin scenario impacted; the mod's own tests are the executable spec. |
| [plugin-test-first-run.txt](plugin-test-first-run.txt) | Step 7: the first run of the mod's tests, one failing for the right reason (the first-action line's formatting). |
| [validate.txt](validate.txt) | `claude plugin validate` on the mod (hooks, calls and state it declares) and on the repository marketplace, both passing. |
| [plugin-test.txt](plugin-test.txt) | `claude plugin test` on the final code: 4 passed (parsing on terminal and desktop, `/workflow`, both fallbacks). |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing with the new epic spec and the delivery section. |
| [marketplace-install.txt](marketplace-install.txt) | The marketplace added from the branch's local path, `workflow-steps@bi-assistant` installed and listed as enabled, version 0.1.0 (the install was removed again afterwards). |
| [pane-capture.txt](pane-capture.txt) | A real session started with `claude --plugin-dir .claude/mods/workflow-steps` in a 170-column tmux: the Workflow pane opened by itself with "First: Read retrospective.md…" and the steps from CLAUDE.md, and again after Esc and `/workflow`. |
| [diff-stat.txt](diff-stat.txt) | `git diff --stat main` for the change: no application file. |

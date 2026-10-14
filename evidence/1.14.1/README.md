# 1.14.1 — ADR, epic spec and roadmap for agent tools and skills (BA-214)

This is a planning-only change: no code, UI or test changes, so there is no E2E run and no screenshots.

| Artifact | Shows |
|---|---|
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing on the branch, including the new BA-213 epic spec and Milestone 1.14. |
| [jira-issues.txt](jira-issues.txt) | Epic BA-213 and its four stories, BA-214 to BA-217, each with `parent=BA-213` (captured before BA-214 was moved to Done). |
| [prompt-measurement.json](prompt-measurement.json) | The assistant prompt measured section by section from the compiled agent at `513009d`: the figures in the epic spec's *Prompt cost* table. |
| [measure-prompt.cjs](measure-prompt.cjs) | The script that produced it. Run `npx nest build` in `backend/`, then `node evidence/1.14.1/measure-prompt.cjs backend/dist`. |

Changed: [specs/epics/BA-213/spec.md](../../specs/epics/BA-213/spec.md) (confirmed by the user on 2026-10-14, with its five decisions), ADR-0021 and ADR-0008's status line in [specs/system/architecture.md](../../specs/system/architecture.md), Milestone 1.14 in [roadmap.md](../../roadmap.md), and the epic row in [specs/README.md](../../specs/README.md).

Branch: `feat/BA-213-agent-tools-skills`, the epic branch that all BA-213 stories share.

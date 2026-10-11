# 2.1.1 — ADR, epic spec, vision and roadmap (BA-162)

This is a planning-only change: no code, UI or test changes, so there is no E2E run and no screenshots.

| Artifact | Shows |
|---|---|
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing on the branch, including the new BA-161 epic spec and Milestone 2.1. |
| [jira-issues.txt](jira-issues.txt) | Epic BA-161 and its six stories, BA-162 to BA-167, each with `parent=BA-161`. |

Changed:
- [specs/product/vision.md](../../specs/product/vision.md): local and org server modes.
- ADR-0010 in [specs/system/architecture.md](../../specs/system/architecture.md): Accepted.
- [specs/epics/BA-161/spec.md](../../specs/epics/BA-161/spec.md): confirmed by the user on 2026-10-10.
- Release 2 and Milestone 2.1 in [roadmap.md](../../roadmap.md).
- The epic row in [specs/README.md](../../specs/README.md).

Source design: Figma board *Agent Hub — E2E lifecycle (proposed)*, section *Admin panel (draft)* (node 52:1167).

Branch: `feat/BA-161-admin-panel`, the epic branch that all BA-161 stories share.

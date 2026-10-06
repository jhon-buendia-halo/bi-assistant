# Evidence — 0.3.1 ADR, epic spec and roadmap (BA-112)

Docs and planning only: no product code changed, so the E2E suite was not re-run.

- [check-specs.txt](check-specs.txt): `python3 scripts/check-specs.py` passes with the new epic spec. The check counts 9 roadmap milestone epics, BA-111 among them.
- [jira-issues.txt](jira-issues.txt): BA-112 to BA-118 exist with BA-111 as their parent epic.
- The user confirmed the epic spec on 2026-10-05, and its status line reads `Status: Confirmed`.
- They also confirmed four design choices, which ADR-0006 records:
  - the Developer row is visible in every build;
  - changes apply on restart;
  - the endpoints are editable, with localhost defaults;
  - the DuckDB store keeps receiving traces when the toggle is on.

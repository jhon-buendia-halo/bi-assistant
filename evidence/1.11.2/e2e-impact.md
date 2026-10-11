# Step 6 — component impact analysis on E2E (1.11.2, BA-171)

Components, pages, services and backend modules touched: **none**. The change is confined to `.claude/mods/workflow-steps/` and documentation; nothing under `frontend/` or `backend/` changes.

| Gherkin Feature | Scenarios exercised by the touched code | Decision |
|---|---|---|
| (all) | none | No application code path changes |

Executable tests for the change are the mod's own (`claude plugin test`), written before the implementation: the inference rules (`tests/rules.test.ts`) and the queue behaviour through the hooks (`tests/workflow-steps.test.ts`): `#1` at session start, strong and weak signals, the tentative threshold and drop, numbering across a repeat, pass/fail on step 9, usage and cost attribution, the subagent line, the fold and `/workflow reset`. The first run is in [plugin-test-first-run.txt](plugin-test-first-run.txt).

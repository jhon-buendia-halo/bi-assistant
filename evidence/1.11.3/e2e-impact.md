# 1.11.3 — E2E impact analysis (step 6)

**Components touched:** `.claude/mods/workflow-steps/` only (hooks module, rules, state types, tests, README, manifest). No file under `frontend/` or `backend/` changes, so no capability spec Rule, Gherkin scenario or Playwright spec exercises this change. App E2E decision: **none impacted**.

The mod's own tests (`claude plugin test`) are the executable spec of [delivery.md §9](../../specs/system/delivery.md):

| Test | Decision | Why |
|---|---|---|
| rules: writes map to the step that owns the file | Re-run as-is | Rule table unchanged |
| rules: reads are weak signals | Re-run as-is | |
| rules: before the first write every read is step 1 | Re-run as-is | |
| rules: questions and test commands are strong | Re-run as-is | |
| rules: shell commands naming an owned file | Re-run as-is | |
| rules: worktree prefix | Re-run as-is | |
| rules: anything else matches nothing | Re-run as-is | |
| rules: each step's checklist facts | **Add** | Completion table |
| rules: completion with live checks, and 0% for a step not started | **Add** | Completion table, *live* checks |
| rules: summary format | **Add** | Summary bullet |
| rules: expected agent per step | **Add** | Rows bullet |
| queue: task #1 runs from the start | **Update** | Header gains `overall 0%`; queued rows show `~main` |
| queue: reads, a question and a roadmap edit | **Update** | Row tail is the summary (`2 reads`, `1 question`, `Edited roadmap.md ×2`) instead of the raw evidence |
| queue: tentative task earns its number | **Update** | Same: `3 reads` |
| queue: three unmatched calls drop a tentative task | **Update** | Same: `Edited roadmap.md ×2` |
| queue: a step that runs again, test run marked | Re-run as-is | `✗ failed` / `✓ passed` stay on the row |
| queue: turn usage and cost | Re-run as-is | |
| queue: subagent listed, done rows count agents | **Update** | Agent column is `main +1` instead of `1 agent` |
| queue: fold beyond twelve | Re-run as-is | |
| queue: /workflow reset | **Update** | Also closes open rows |
| queue: built-in steps | Re-run as-is | |
| queue: a row's completion % from the checklist | **Add** | |
| queue: press opens a detail, a second press closes it, two stay open | **Add** | Details bullet |
| queue: a queued step's detail | **Add** | Expected summary and agent |
| queue: overall completion in the header | **Add** | |
| queue: a subagent's turn credits it and its task | **Add** | Figures bullet |
| queue: an answered question meets "answers received" | **Add** | Step 2 checklist |

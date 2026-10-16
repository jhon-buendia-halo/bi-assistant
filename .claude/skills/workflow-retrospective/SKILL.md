---
name: workflow-retrospective
description: Use at workflow step 11, when a change is complete: write the dated retrospective entry (what went well, what went wrong, what to do differently) and promote recurring lessons into a convention.
---

# Step 11 — Retrospective

Part of the workflow in [CLAUDE.md](../../../CLAUDE.md), which keeps the always-on core (the mandatory first action, the step list, the fast loop and acceptance gate, the hard gates). Load this skill before the step starts.

## The step

11. **Retrospective** — add a dated entry to [retrospective.md](../../../retrospective.md): what went well, what went wrong, what to do differently. Step 1 of the *next* change reads it.

## Retrospective convention — capture lessons so the next run is better

**Every completed change closes with an entry in [retrospective.md](../../../retrospective.md) (step 11), and reading that file is the mandatory first action of the next task.** Reverse-chronological dated sections (`## YYYY-MM-DD`), one per shipped change, referencing the roadmap feature ID, with three subsections:

- **What went well** — specific decisions, tests, or conventions worth repeating, and why.
- **What went wrong** — misread goals, regressions, skipped or out-of-order steps, lost time. An entry with no `What went wrong` means you didn't look hard enough.
- **What to do differently** — a concrete instruction your future self can follow ("before renaming a persisted field, add it to `LEGACY_DOC_FIELDS`"), not "be more careful".

Skip only for trivial, zero-risk edits. Never rewrite a past entry. When a recurring lesson hardens into a rule, promote it into the relevant convention (or CLAUDE.md proper) and note the promotion.

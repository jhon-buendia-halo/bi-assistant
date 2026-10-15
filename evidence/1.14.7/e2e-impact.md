# 1.14.7 Skills link tools (BA-220): E2E impact (step 6)

Base commit: `origin/main` (`ed2069b`): no `/skills` route (see [../1.14.6/base-probes.txt](../1.14.6/base-probes.txt)).

## Touched → scenarios

| Touched (commit `0f3a14e`) | Scenarios |
|---|---|
| skill editor Body (link editor, tools only), `skill-rules.ts` refusals, `tools` on `SkillSummary` | Skill library: *The skill editor links tools only*; Agent definitions (API): *A skill links tools only* |
| effective tool selection (an agent gets the tools its linked skills link) | Agent editor: *A linked skill's tools come with it* |
| Skills tab shows a skill's tools | Agent editor: *The Skills tab shows what is linked…* (held in [../1.14.9/](../1.14.9/)) |

## Decisions

| Decision | Scenario | Spec file | Why it fails on base |
|---|---|---|---|
| Add | Agent editor: A linked skill's tools come with it | `frontend/e2e/agent-editor.spec.ts` | no `/skills` on base; the Tools tab has no "Linked by chart-style" |
| Add | Skill library: The skill editor links tools only | `frontend/e2e/skill-library.spec.ts` | no skills library on base |
| Add | Agent definitions (API): A skill links tools only | `backend/test/user-agents.e2e-spec.ts` | `POST /skills` 404 on base |
| Re-run as-is | none beyond the files above | — | — |
| Delete | none | — | — |

Counts: Add 2 Playwright + 1 API, Delete 0.

Results: [e2e-results.txt](e2e-results.txt). Screenshot: [agent-tools-linked-by-skill.png](agent-tools-linked-by-skill.png). Desktop not run.

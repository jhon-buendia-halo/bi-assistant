# 1.14.5 Edit built-in skills in the app (BA-218): E2E impact (step 6)

Base commit: `origin/main` (`ed2069b`): `GET /skills/built-in` answers 404 ([../1.14.6/base-probes.txt](../1.14.6/base-probes.txt)); no built-in skill editor, no overrides.

## Touched → scenarios

| Touched (commit `0f3a14e`) | Scenarios |
|---|---|
| `built-in-skills.service.ts`, `built-in-skill-rules.ts`, `skill_overrides`, `skill-overrides.ts` (resolved per call) | Skill library: *I edit a built-in skill, and Reset restores it*, *An override that drops a placeholder is refused* |
| `builtin-skill-editor`, skills library Built-in section | the same two; Agent editor: *The Skills tab shows what is linked…* (Built-in section, held in [../1.14.9/](../1.14.9/)) |
| plain assistant's catalog with no override | Skills the assistant is given: all 5 (held in [../1.14.10/](../1.14.10/)); Agent skills: *The assistant gets only its built-in skills…* |

## Decisions

| Decision | Scenario | Spec file | Why it fails on base |
|---|---|---|---|
| Add | Skill library: I edit a built-in skill, and Reset restores it (recording stub: the edited description reaches the plain assistant's catalog) | `frontend/e2e/skill-library.spec.ts` | no built-in editor; the catalog keeps the shipped text |
| Add | Skill library: An override that drops a placeholder is refused | same | no built-in editor |
| Re-run as-is | Skills the assistant is given (5), Agent skills (3) | `assistant-skills.spec.ts`, `agent-skills.spec.ts` | — |
| Delete | none | — | — |

The roadmap's "a user without `edit-policies` can't save" has no scenario any more: 1.14.19 (BA-232) made the app single-user.

Counts: Add 2, Re-run as-is 8, Delete 0.

Results: [e2e-results.txt](e2e-results.txt). Screenshot: [builtin-skill-modified.png](builtin-skill-modified.png). Desktop not run.

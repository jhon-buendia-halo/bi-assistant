# 1.14.3 Write skills in the app (BA-215): E2E impact (step 6)

Base commit: `origin/main` (`ed2069b`): `GET /skills` and `POST /skills` answer 404 ([../1.14.6/base-probes.txt](../1.14.6/base-probes.txt)); the hub has no Skills button.

## Touched → scenarios

| Touched (commit `0f3a14e`) | Scenarios |
|---|---|
| backend `skills` module (endpoints 94-98, `skill-rules.ts`), `skills` collection | Skill library: all; Agent definitions (API): *Skills refuse a bad name or description* |
| `skills-library`, `skill-editor`, `skill-editor.service`, `skills-api.service`, `app.ts` routing | Skill library: all; Agent Hub: *Skills opens the skills library and Back returns to the hub* |
| `agent-hub` (Skills button in the header) | Agent Hub: all, including the axe scan |

## Decisions

| Decision | Scenario | Spec file | Why it fails on base |
|---|---|---|---|
| Add | Skill library: Creates, edits and deletes a skill | `frontend/e2e/skill-library.spec.ts` (new) | no Skills button, no `/skills` |
| Add | Skill library: Refuses a bad name or description | same | no skill editor |
| Add | Skill library: The library and the skill editor have no detectable accessibility violations in either theme | same | no library |
| Add | Agent Hub: Skills opens the skills library and Back returns to the hub | `frontend/e2e/agent-hub.spec.ts` | no Skills button |
| Add | Agent definitions (API): Skills refuse a bad name or description | `backend/test/user-agents.e2e-spec.ts` | `POST /skills` 404 |
| Re-run as-is | Agent Hub: the other 9, including the axe scan (the header gained a button) | `agent-hub.spec.ts` | — |
| Delete | none | — | — |

The roadmap's "API test proves two users never see each other's skills" has no scenario any more: 1.14.19 (BA-232) made the app single-user and removed `owner-isolation.e2e-spec.ts`.

Counts: Add 4 Playwright + 1 API, Re-run as-is 9, Delete 0.

Results: [e2e-results.txt](e2e-results.txt). Screenshot: [skill-library-list.png](skill-library-list.png). Desktop not run.

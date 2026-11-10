# 1.21.6 — User personas section in the Context area

Ships a **User personas** card on the Context page and a section to list, create, edit and delete personas (name, role, description, goals, up to 10 typical questions, expertise, answer style). Backend module `personas` with collection `user_personas` and `GET/POST /personas`, `PATCH/DELETE /personas/:id`. Every data dir starts with a **Demo Finance Analyst** persona, seeded once (marker `personas-seed` in `settings`), so deleting it is permanent (user-personas R13). Agents do not use personas yet.

## Gherkin scenarios and the specs that cover them

Spec: [user-personas](../../specs/capabilities/user-personas/spec.md); also [app-shell](../../specs/capabilities/app-shell/spec.md) R3a, [api.md](../../specs/system/api.md), [data-model.md](../../specs/system/data-model.md), [ui.md](../../specs/system/ui.md).

All nine scenarios are in `frontend/e2e/user-personas.spec.ts` (9 passed): Open the section from the Context page; A new install starts with the demo persona; A deleted demo persona does not come back; The empty library invites the first persona; Create a persona with every field; Blank name keeps Save disabled; Edit a persona; Delete a persona after confirmation; A duplicate name is refused.

## Artifacts

- [user-personas-demo-finance-analyst.png](user-personas-demo-finance-analyst.png): the section with the seeded Demo Finance Analyst.
- [persona-editor-every-field.png](persona-editor-every-field.png): the editor showing every field.

Desktop: not run (web target only).

## Video

- Video: [../1.21.11/walkthrough-context-ontologies-and-personas.webm](../1.21.11/walkthrough-context-ontologies-and-personas.webm) ends on User personas and the Demo Finance Analyst editor.

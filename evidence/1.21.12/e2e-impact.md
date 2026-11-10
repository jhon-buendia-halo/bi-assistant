# E2E impact (step 6) — 1.21.12 Visuals library on the Context page

Read by `scripts/qa.mjs 1.21.12 --gate` ([delivery.md](../../specs/system/delivery.md) 13): first column the spec, second the decision.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/visuals-library.spec.ts` | add | every scenario of `Feature: Visuals library`; "Browse the library and edit a chart in place" is the story's demo (`@demo`, `@story-1.21.12`) |
| `frontend/e2e/navigation.spec.ts` | update | "moves between areas from the rail": the Context page lists the Ontologies, User personas and Visuals cards; the Visuals card opens and the Context back control returns |
| `frontend/e2e/user-personas.spec.ts` | re-run | every scenario: the User personas card shares the Context page with the new card |
| `frontend/e2e/dataset-ontology.spec.ts` | re-run | the Context → Ontologies card scenario: same Context page |

The workflow changes in this branch (`qa.mjs` demo evidence check, the demo reminder hook) touch no app flow; they are covered by `node --test scripts/qa-lib.test.mjs` (24/24).

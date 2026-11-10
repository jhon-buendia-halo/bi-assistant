# 1.21.11 — Ontologies on the Context page

Ships an **Ontologies** card first on the Context page, listing every dataset with the size of its ontology, a pending-suggestions chip and shared items counted once. Choosing a dataset opens the same Ontology panel as the dataset's Ontology tab, under an Ontologies back control; edits there show in the dataset's tab (one editor).

## Gherkin scenarios and the specs that cover them

Specs: [dataset-ontology](../../specs/capabilities/dataset-ontology/spec.md) R40 and the scenario Review every dataset's ontology from Context; [app-shell](../../specs/capabilities/app-shell/spec.md) R3a; [ui.md](../../specs/system/ui.md) 4.8a; ADR-0036 note.

Covered by `frontend/e2e/dataset-ontology.spec.ts` ("reviews every dataset's ontology from Context", 14 passed) and `frontend/e2e/user-personas.spec.ts` ("Open the section from the Context page", 9 passed, now with the Ontologies card first).

## Artifacts

- [context-page-ontologies-and-personas-cards.png](context-page-ontologies-and-personas-cards.png): the Context page with Ontologies then User personas.
- [ontologies-list-by-dataset.png](ontologies-list-by-dataset.png): the list of datasets with ontology counts and the pending chip.

Desktop: not run (web target only).

## Video

- `walkthrough-context-ontologies-and-personas.webm` — video: Context → Ontologies list, World Cup's panel and back, then User personas with the Demo Finance Analyst opened in the editor.

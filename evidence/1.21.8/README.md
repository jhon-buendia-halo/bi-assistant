# 1.21.8 — Ontology tab in the dataset editor

Ships Schema and Ontology tabs on a saved dataset. The Ontology tab lists concepts, relations, constraints and instructions with shared items marked "All datasets", filters, Pending suggestions, Generate suggestions and an editor per kind (concept column mappings picked from the dataset's entities and columns). The chat reads "Ontology in context". Edit forms open in place at the item and the mapping boxes are labelled.

## Gherkin scenarios and the specs that cover them

Specs: [dataset-ontology](../../specs/capabilities/dataset-ontology/spec.md), [datasets](../../specs/capabilities/datasets/spec.md), [app-shell](../../specs/capabilities/app-shell/spec.md), [sessions-chat](../../specs/capabilities/sessions-chat/spec.md), [ui.md](../../specs/system/ui.md).

All in `frontend/e2e/dataset-ontology.spec.ts` (14 passed): Open the Ontology tab of a saved dataset; A new dataset has no tabs; Create a concept with column mappings; Create a relation and a measured-by relation; Create a constraint; A shared item appears in another dataset's tab; Validation messages; Edit an item; Disable an item; Delete a concept deletes its relations; Generate suggestions then accept and reject; Generation fails. Navigation and layout specs cover the Context page showing no Knowledge card and the tab heading order.

## Artifacts

- [dataset-editor-ontology-tab.png](dataset-editor-ontology-tab.png): a saved dataset's Ontology tab with its items.
- [concept-edited-in-place-with-readable-mappings.png](concept-edited-in-place-with-readable-mappings.png): a concept edited in place, mappings with labelled boxes.
- [mapping-picker.png](mapping-picker.png): the column mapping picker.

Desktop: not run (web target only).

## Video

- `walkthrough-dataset-ontology-edit-and-graph.webm` — video: World Cup's Ontology tab, a concept opened in place with readable mappings, the mapping picker (SQL expression), then the graph view with a node selected, zoom and fit.

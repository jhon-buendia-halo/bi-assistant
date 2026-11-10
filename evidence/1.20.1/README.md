# 1.20.1 — Layer and description on dataset schemas (BA-319)

[e2e-results.txt](e2e-results.txt): new `dataset-schema-notes.spec.ts` — select the `world_cup` schema in Edit dataset, choose Layer "Consumption", type a description, Save dataset; `GET /datasets` returns `schemas: [{ key: "world_cup.world_cup", layer: "consumption", description: … }]`; after a reload the tree chip `schema-layer-world_cup-world_cup` reads "Consumption" with the description as its title, and the details panel shows both values. `world-cup-workflow.spec.ts` and `testing-data.spec.ts` re-run as-is (Testing Data reloads keep notes: unit-tested in `testing-data.service.spec.ts`).

Assistant context: `context-blocks.spec.ts` asserts the "Schema notes" block and that the orientation lines are byte-identical when no notes exist. Evals: see the epic's eval results (added with the gate).

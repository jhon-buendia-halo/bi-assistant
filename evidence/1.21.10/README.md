# 1.21.10 — Ontology relations as a graph

Ships a **Graph** option at the end of the Ontology tab's filter row: an SVG graph drawn by the app (no new dependency) with concept and metric nodes and labelled relation arrows; disabled and pending items faded and dashed; pan, zoom and drag; selecting a node or arrow highlights its neighbours and shows details, with Edit opening the existing editor. The layout was fixed after a live run piled unconnected nodes into the corners.

## Gherkin scenarios and the specs that cover them

Spec: [dataset-ontology](../../specs/capabilities/dataset-ontology/spec.md) R38, R39 and the scenarios See the ontology as a graph, Pending suggestions are faded in the graph, Edit a concept from the graph; [ui.md](../../specs/system/ui.md) 4.8.

Covered by `frontend/e2e/dataset-ontology.spec.ts` ("sees the ontology as a graph and edits a concept from it", 14 passed), plus frontend unit tests for the layout.

## Artifacts

- [ontology-graph-node-selected.png](ontology-graph-node-selected.png): a node selected, neighbours highlighted, details panel.
- [ontology-graph-pending-faded.png](ontology-graph-pending-faded.png): pending suggestions faded and dashed.

Desktop: not run (web target only).

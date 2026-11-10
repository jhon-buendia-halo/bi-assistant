# 1.21.7 — Knowledge becomes each dataset's ontology: model, migration, API and context

Ships ADR-0036: collection `ontology_items` and migration M15 (knowledge snippets copied; `knowledge_snippets` renamed `knowledge_snippets_legacy`); module `ontology` replacing `knowledge` with `GET/POST /datasets/:name/ontology` and `PATCH/DELETE /ontology/:id` with per-kind validation (concept, relation, constraint, instruction); deleting a dataset deletes its items; the per-turn context block rendered from the ontology, byte-identical to the old block for migrated data (proved by a context-equality unit test); `[relation]` lines and one bullet in the `curated-knowledge` skill. Contract: [docs/plans/ba-320-dataset-ontology.md](../../docs/plans/ba-320-dataset-ontology.md).

## Gherkin scenarios and the specs that cover them

Spec: [dataset-ontology](../../specs/capabilities/dataset-ontology/spec.md) (the old `knowledge` capability spec is deleted); [data-model.md](../../specs/system/data-model.md), [api.md](../../specs/system/api.md).

| Scenario | Spec |
|---|---|
| Migrated snippets appear as ontology items after an upgrade | `backend/test/app.e2e-spec.ts` (M15 upgrade migration; 8 passed incl. `response-status.e2e-spec.ts`) |
| An answer lists the ontology it was given | `frontend/e2e/assistant-skills.spec.ts` (updated to `createOntologyItem`; passed, [final gate run](../1.21.7/e2e-results.txt)) |
| Disabled items are never sent | `frontend/e2e/dataset-ontology.spec.ts` ("disables an item so the assistant stops using it", 14 passed) |

Validation messages, cascades and the byte-identical context block are covered by backend unit tests.

## Artifacts

No screenshot: backend and context change. The folder holds only this README, which also carries the step-6 impact list for all of BA-320.

## E2E impact (step 6)

Per Feature / spec file, for every story 1.21.1–1.21.11. Decisions: add / update / re-run-as-is.

| Spec file | Decision | Why |
|---|---|---|
| `frontend/e2e/user-personas.spec.ts` | **add** (9 scenarios, 9 passed) | 1.21.6 new capability |
| `frontend/e2e/dataset-ontology.spec.ts` | **add** (14 tests, 14 passed) | 1.21.7–1.21.11: tab, editors, shared items, validation, suggestions, graph, Context list |
| `backend/test/app.e2e-spec.ts`, `backend/test/response-status.e2e-spec.ts` | **update** (8 passed) | 1.21.7 M15 migration and the new `ontology` routes |
| `frontend/e2e/navigation.spec.ts` | **update** | 1.21.4 Context area on the rail; 1.21.8 Ontology tab; Context cards. passed, [final gate run](../1.21.7/e2e-results.txt) |
| `frontend/e2e/layout-accessibility.spec.ts` (+ `application-shell` baseline) | **update** | 1.21.4 rail label; 1.21.8 heading order on the Ontology tab (axe). passed, [final gate run](../1.21.7/e2e-results.txt) |
| `frontend/e2e/assistant-skills.spec.ts` | **update** | 1.21.7 seeds with `createOntologyItem` instead of knowledge snippets. passed, [final gate run](../1.21.7/e2e-results.txt) |
| `frontend/e2e/dataset-schema-notes.spec.ts` | **re-run as-is** | 1.21.8 puts tabs in the dataset editor; schema-notes scenarios must still pass. passed, [final gate run](../1.21.7/e2e-results.txt) |
| `frontend/e2e/agent-hub.spec.ts` | **update** | 1.21.1 v2 card, page, prompt-identity refusal; 1.21.5 agent tools/skills. passed, [final gate run](../1.21.7/e2e-results.txt) |
| `frontend/e2e/agent-sessions.spec.ts` | **update** | 1.21.1 / 1.21.3 a v2 session runs v2. passed, [final gate run](../1.21.7/e2e-results.txt) |
| `frontend/e2e/agent-panel.spec.ts` | **update** | 1.21.3 workflow steps and the Failed status. passed, [final gate run](../1.21.7/e2e-results.txt) |
| `frontend/e2e/data-readiness.spec.ts` | **update** | 1.21.5 drill-down scenario. passed, [final gate run](../1.21.7/e2e-results.txt) |
| `frontend/e2e/session-management.spec.ts` | **update** | 1.21.1 New conversation lists and starts v2. passed, [final gate run](../1.21.7/e2e-results.txt) |
| `frontend/e2e/helpers/agents-api.ts` | **update** | helper for the new agent and ontology API. |
| other specs under `frontend/e2e/` | **re-run-as-is** | not touched by this milestone. not run: only the impacted specs run in the gate (verify skill) |

Desktop: not run (web target only).

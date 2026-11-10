# Dataset ontology: implementation contract (BA-320, roadmap 1.21.7–1.21.9)

Approved by the user on 2026-11-09 from the review page "Dataset Ontology Design" (decisions A–E as proposed). This file is the contract every unit builds against; the specs restate it as behaviour (ADR-0036, capability `dataset-ontology`).

## Decisions
- A. Global snippets become **shared** items (`dataset: null`), shown in every dataset's Ontology tab, marked "All datasets".
- B. The `/knowledge` routes are **replaced** (no aliases).
- C. The skill keeps the name `curated-knowledge`; one bullet is added for `[relation]` lines.
- D. Deleting a dataset deletes its own items; shared items stay. Saving under a new name starts an empty ontology.
- E. Migration renames `knowledge_snippets` to `knowledge_snippets_legacy` (kept one release).

## Entity — `backend/src/modules/ontology/entities/ontology-item.entity.ts`

```ts
export type OntologyKind = 'concept' | 'relation' | 'constraint' | 'instruction';
export const ONTOLOGY_KINDS: OntologyKind[] = ['concept', 'relation', 'constraint', 'instruction'];
export type OntologySource = 'user' | 'mined';
export type RelationType = 'is-a' | 'part-of' | 'has-many' | 'related-to' | 'measured-by';
export const RELATION_TYPES: RelationType[] = ['is-a', 'part-of', 'has-many', 'related-to', 'measured-by'];
export interface ConceptMapping { entity: string; column?: string; expression?: string }
export interface OntologyItem {
  id: string;
  dataset: string | null;          // dataset name; null = shared by every dataset
  kind: OntologyKind;
  name: string;
  description: string;             // '' when not given
  enabled: boolean;
  source: OntologySource;
  synonyms?: string[];             // concept only; omitted when empty
  mappings?: ConceptMapping[];     // concept only; omitted when empty
  predicate?: string;              // constraint only (required)
  conceptId?: string;              // constraint only, optional
  entities?: string[];             // constraint and instruction; omitted when empty
  from?: string;                   // relation: concept id
  type?: RelationType;             // relation
  to?: string;                     // relation: concept id (not measured-by)
  metricId?: string;               // relation: measured-by only
  ownerId?: string;                // legacy, inert ('local')
  createdAt: string;
  updatedAt: string;
}
```
Fields that do not belong to the item's kind are dropped on create and update. Strings are trimmed; list items trimmed and blanks dropped.

## Storage
- Collection token `ONTOLOGY_STORE = 'DOC_STORE_ontology'`, table `ontology_items`. `KNOWLEDGE_STORE` and the `knowledge_snippets` collection entry are removed.
- `PRIVATE_TABLES` lists `ontology_items` (in place of `knowledge_snippets`). M14 keeps working for old installs (it may still list `knowledge_snippets`, which it skips when absent).
- **Migration M15** (backend start, after M14, raw SQL, idempotent): when table `knowledge_snippets` exists, create `ontology_items` if missing (same DDL as any doc-store table), copy each snippet whose `id` is not already in `ontology_items`, then rename `knowledge_snippets` to `knowledge_snippets_legacy` (only when that name is free; otherwise leave both and log a warning). Mapping:
  - `term` → `concept`: title→name, body→description, synonyms kept, each entity → mapping `{ entity }` (same order).
  - `default_filter` → `constraint`: title→name, body→predicate, description `''`, entities kept.
  - `instruction` → `instruction`: title→name, body→description, entities kept.
  - `scope.datasetId` → `dataset`; no scope → `dataset: null`; a scope with only `datasourceId` → `dataset: null` **and** `enabled: false`.
  - `id`, `enabled` (except the datasource-only case), `source`, `ownerId`, `createdAt`, `updatedAt` kept as they are.

## API (module `backend/src/modules/ontology/`)
| Route | Result |
|---|---|
| `GET /datasets/:name/ontology?kind&source&enabled` | `OntologyItem[]`: items with `dataset === name` or `null`, filters lenient (unknown values ignored), newest `updatedAt` first. 404 `Dataset "<name>" not found`. |
| `POST /datasets/:name/ontology` | 201 `OntologyItem`. Body: the kind fields plus `enabled?` (default true) and `shared?: boolean` (true → `dataset: null`). `source: 'user'`. |
| `PATCH /ontology/:id` | `OntologyItem`, partial (only fields present are validated and applied; `updatedAt` restamped). `kind` cannot change. |
| `DELETE /ontology/:id` | 204. Deleting a concept also deletes the relations from or to it and clears `conceptId` on constraints that name it. |
| `POST /datasets/:name/ontology/bootstrap` | `{ created: OntologyItem[] }` |
| `POST /datasets/:name/ontology/bootstrap/stream` | SSE, status 200: `{type:'progress', key, message}` … then `{type:'done', created}` or `{type:'error', message}`. `key` ∈ `dataset`, `schema`, `sample`, `draft`, `save`. |

Validation (400 unless noted; messages exact):
- `kind must be one of: concept, relation, constraint, instruction`; `kind cannot be changed`.
- `name is required` (create) / `name must not be empty` (update).
- concept and instruction: `description is required` (create) / `description must not be empty` (update).
- constraint: `predicate is required` / `predicate must not be empty`.
- concept mapping: `each mapping needs an entity`; for an item of a dataset, `Entity "<entity>" is not in dataset "<name>"` (shared items accept any entity).
- relation: `from is required`; `type must be one of: is-a, part-of, has-many, related-to, measured-by`; `to is required` (not measured-by); `metricId is required for measured-by`; a `from`/`to` that is not a concept of the same dataset or a shared concept: `Concept "<id>" is not in this ontology`; an unknown metric: `Metric "<id>" not found`.
- Unknown id on PATCH/DELETE: 404 `Ontology item <id> not found`.
- `DatasetsService.delete(name)` deletes the items with `dataset === name`.

## Per-turn context — `OntologyService`
Same method names and signatures as the old `KnowledgeService` so consumers only switch the class: `definitionBlock(datasetNames: string[]): Promise<string>` and `contextFor(datasetNames: string[]): Promise<{ block: string; used: KnowledgeUse[] }>`. Unchanged: selection (enabled, and shared or dataset in the session), order (dataset items first, then shared; newest `updatedAt` first within each), the header `Curated dataset knowledge (user-authored — treat as authoritative over anything you infer from schema):`, the 2,000-character budget over item lines (header not counted), stop at the first line that does not fit. The requestContext key `knowledge-used`, the message field `knowledge` and the `KnowledgeUse` shape stay.

Line per kind (byte-identical to today for migrated data):
- concept: `- [term] <name>: <description>` + `; synonyms: a, b` (if any) + `; entities: <distinct mapping entities in order>` (if any) + `; maps to: <m1>, <m2>` only when some mapping has a column or expression, where a mapping renders as `<entity>.<column>`, or `<expression>`, or `<expression> (<entity>.<column>)` when both.
- constraint: `- [default_filter] <name>: <predicate>` + `; when: <description>` (if not empty) + `; entities: …` (if any).
- instruction: `- [instruction] <name>: <description>` + `; entities: …` (if any).
- relation: `- [relation] <from concept name> <type> <to concept name | metric label>` + `: <description>` (if not empty). Skipped when an endpoint no longer resolves.

`KnowledgeUse` per item: `{ id, kind: 'term' | 'default_filter' | 'instruction' | 'relation', title: name, body, datasetId? }` with `body` = description (concept, instruction), predicate (constraint), `"<from> <type> <to>"` (relation); `datasetId` = `dataset` when not null.

## Bootstrap — `OntologyBootstrapService` (file `ontology-bootstrap.service.ts`)
`bootstrap(datasetName: string, onProgress?: (p: { key: 'dataset'|'schema'|'sample'|'draft'|'save'; message: string }) => void): Promise<OntologyItem[]>`.
- Agent registry key and id stay `knowledge-bootstrap` (in-app prompt overrides are keyed by it); display name becomes **Ontology Bootstrap**; its prompt is rewritten for ontology drafts.
- Input: the schema snapshot and sample rows as today, plus the dataset's column references (declared and inferred) and the governed metrics on its entities (name, label, entity).
- Output (structured, max 15): `drafts` of a discriminated union on `kind`: concept `{ name, description, synonyms?, mappings?: [{ entity, column?, expression? }] }`; relation `{ from: concept name, type, to?: concept name, metric?: metric name }`; constraint `{ name, predicate, description?, entities? }`; instruction `{ name, description, entities? }`.
- Post-processing: concepts inserted first; relation names resolve against this run's concepts and the dataset's existing concepts (case-insensitive), metrics by name; unresolved relations dropped; mappings to entities outside the dataset dropped; a draft whose name (case-insensitive) already exists for the same kind in the dataset or earlier in the run is dropped. Every item: `dataset` = the dataset, `source: 'mined'`, `enabled: false`.
- Added while building (accepted by the lead): the prompt also lists `<existing-concepts>` so the model does not redraft them; a relation draft is named `"<from> <type> <to | metric label>"` with description `''`; a relation duplicating an existing from/type/to (or metric), or relating a concept to itself, is dropped; shared concepts count as part of the ontology for resolution and duplicates; `entities` on constraints and instructions are cut to the dataset's own tables; a single malformed draft is skipped, while a reply with no parsable `drafts` fails with "no usable drafts" (an empty list stores nothing and is not an error).
- Errors: `Ontology bootstrap failed: <reason>`; `the bootstrap agent returned no usable drafts`; `datasetId is required` becomes `dataset is required`; `Dataset "<name>" not found`.

## Skill
`curated-knowledge` keeps its name; add one bullet: `[relation]` lines state how concepts connect (is-a, part-of, has-many, related-to, or measured-by a governed metric); use them to choose joins and the governed metric, never as rows of data.

## Frontend (`frontend/src/app/features/ontology/`)
- The dataset editor (`catalog-browser`) shows two tabs when editing a saved dataset: **Schema** (today's content) and **Ontology** (`data-testid` `dataset-tab-schema`, `dataset-tab-ontology`); a new dataset shows no tabs (Schema only).
- Ontology tab (`app-ontology-panel`, input `dataset`): sections Concepts, Relations, Constraints, Instructions; kind filter pills; Pending suggestions toggle with count; Generate suggestions (this dataset) with the progress list; rows show name, kind, "Mined", "All datasets" for shared items, body summary, Enabled toggle, Edit, Delete (confirm `Delete “<name>”? The assistant will stop using it.`; for a concept add ` Its relations are deleted too.`). Accept/Reject in the pending view as today.
- Editor per kind: concept (name, definition, synonyms, mapping rows: entity select from the dataset's tables, column select from that entity's columns, expression), relation (from concept, type, to concept or metric for measured-by), constraint (name, predicate, when to apply, optional concept, entities), instruction (name, text, entities). A "Share with all datasets" checkbox on create.
- The Context page loses the Knowledge card; `features/knowledge/` and the `knowledge` main view are removed. (Added later, roadmap 1.21.11: an **Ontologies** card lists every dataset's ontology and opens the same `app-ontology-panel`.)
- The chat disclosure reads "Ontology in context (n)"; labels: term→Concept, default_filter→Constraint, instruction→Instruction, relation→Relation; footnote `The dataset ontology the assistant was given before answering. Edit it in the dataset's Ontology tab; disabled items are never included.`

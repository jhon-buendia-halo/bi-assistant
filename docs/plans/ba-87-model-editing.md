# BA-87 — Data model editing, versioning and export

Roadmap 1.2.3 · depends on 1.2.1 (BA-85, in this branch's base). Decision record: [ba-2-data-model-dsl-alternatives.md](ba-2-data-model-dsl-alternatives.md) §5 story 3.

## Goal

Analysts curate each dataset's data model inside the app: edit the YAML with line-level errors, edit entities, attributes, relationships and metrics through forms, browse versions, diff and revert, and export or import the model as a `.yaml` file. The metrics panel moves onto the model, which becomes the metrics' editor of record.

## 1. Backend additions (`backend/src/modules/data-models/`)

- `GET /datasets/:name/model/export?version=N` → `Content-Type: text/yaml`, `Content-Disposition: attachment; filename="<dataset-slug>.model.v<N>.yaml"`, body = that version's YAML (current when omitted).
- `POST /datasets/:name/model/import` body `{ yaml }` → same validation as PUT, new version with `source: 'import'`; 400 `{ ok:false, errors }` on issues.
- Model-scoped metrics (the panel's new API, all writing a new `user` version):
  - `GET /datasets/:name/model/metrics` → `{ metrics: Metric[] }` from the current version.
  - `POST /datasets/:name/model/metrics` body = `Metric` (portable core or `expressions.sql`); validation through `validateDataModel` on the would-be model (unique name, entity exists, `of`/`dimensions` resolve).
  - `PUT /datasets/:name/model/metrics/:metricName`, `DELETE /datasets/:name/model/metrics/:metricName`.
  - `GET /datasets/:name/model/metrics/candidates` → prefilled drafts from approved verified queries whose entities are bound in the model (reuse `MetricsService.candidates` logic, mapped to logical entity names).
  - These do NOT write to the shared `metrics` store. The shared store becomes legacy: still imported at bootstrap/merge (BA-85 behaviour), still served by the old `/metrics` endpoints for compatibility, but the UI stops using it. Update the `MetricsService` class comment and the roadmap/CLAUDE.md wording accordingly. Also handle the `syncMetric` mirror: a model-level write must not be overwritten by a later merge — the merge rule "shared wins for names it owns" flips to "the model wins for names it has; shared metrics are only *added* when missing" (adjust `mergeSnapshot`/`rebootstrap` and their specs).
- Structured edits are done client-side on the parsed model and submitted as YAML through PUT (one write path, one validator). The frontend serialises with the same key order as `serializeDataModel` so diffs stay small: expose `POST /datasets/:name/model/serialize` body `{ model }` → `{ yaml }` (pure) so the client never needs its own YAML writer.

## 2. Frontend (`frontend/src/app/features/data-model/`)

Feature folder with `components/`, `services/`, `models/` (the app is still unrouted — no `pages/` yet). Standalone components, signals, Tailwind, lucide icons, house style from `features/datasets` and `features/knowledge`.

- `services/data-model-api.service.ts` — typed client for every endpoint in §1 plus BA-85's (`get`, `getVersion`, `putYaml`, `revert`, `drift`, `export` as blob, `import`, `serialize`, metrics CRUD, candidates). `models/data-model.model.ts` mirrors the backend DSL types (copy, do not import across the boundary).
- `components/data-model-view/` — the surface opened from the dataset list. Header: dataset name, current version badge (`v3 · user · 2 min ago`), drift warning pill when `lastDrift` has removed/changed attributes, buttons **Export**, **Import**, **Bootstrap from snapshot**. Tabs: **Overview** (entities with attribute counts, relationships, metrics; click an entity to edit), **YAML**, **Versions**, **Metrics**.
- `components/model-yaml-editor/` — `<textarea>` with a line-number gutter (monospace, synced scroll), error list from the 400 response (`path · line:col · message`), clicking an error moves the caret to that line and highlights it; **Save as new version** disabled when unchanged; success toast via `core/toast`.
- `components/model-versions/` — list of versions (version, source, note, createdAt), current marked; **Revert** on any non-current version; select two versions → side-by-side or unified line diff rendered with `shared/utils/line-diff.ts` (a small LCS line diff, no new dependency; added/removed lines coloured).
- `components/entity-editor/` — structured forms: entity label, description, key; per attribute: type (select), role (select), description; relationships involving the entity: cardinality (select), description, add (pick target entity + attributes) and remove; **Save** serialises via `/serialize` and submits through PUT; validation errors from the server are shown inline against the form (map `entities[i].attributes[k].type`-style paths back to fields).
- `components/model-metrics-panel/` — the metrics panel re-homed onto the model: list, create/edit (name, label, description, entity select from the model, portable aggregation (agg + attribute, optional where via a simple predicate builder: attribute, operator, value) OR a SQL expression, dimensions as attribute multi-select), delete, promote from candidates. Reuse the markup and interaction patterns of `features/datasets/components/metrics-panel` and then **delete** that component, its `metrics-api.service.ts` and `metric.model.ts`; in `catalog-browser.html` replace the panel with a short note: "Metrics are defined in the dataset's data model after saving."
- Shell wiring (`app.ts` / `app.html`): `MainView` gains `'dataset-model'`; `dataset-list` rows get a **Data model** action (`output openDataModel`); `openDataModel(dataset)` sets the view; **Back** returns to the dataset list. Export uses a Blob download (works under `file://`); Import uses a hidden `<input type="file" accept=".yaml,.yml">`.

## 3. Gherkin and E2E (tests first)

`gherkin.md` → new `## Feature: Data model editing` (Spec: `frontend/e2e/data-model-editing.spec.ts`), Background = World Cup Postgres running and the World Cup datasource + dataset created (reuse `createWorldCupWorkspace` / `createWorldCupDataset` from `e2e/helpers/app-actions.ts`). Scenarios:
1. Opens a dataset's data model from the dataset list and sees its entities, relationships and metrics (version 1, bootstrap).
2. Edits the YAML, saves, and the version badge shows v2 · user; version 1 is still listed.
3. An invalid YAML edit (attribute mapped to a missing column) shows the error with its line, highlights the line, and the current version stays v1.
4. Reverts to version 1 from the Versions tab; the badge shows v1 and v2 still exists; the diff between v1 and v2 shows the changed line.
5. Changes a relationship's cardinality in the entity form and saves; a new version is created and the Overview shows the new cardinality.
6. Defines a metric in the Metrics tab; it appears in the list and in the YAML.
7. Exports the model; a `.yaml` file is downloaded (Playwright `page.waitForEvent('download')`) and importing it back creates a new `import` version whose YAML equals the exported text.
Also: update *Feature: Datasources, datasets, and sessions* if the catalog browser's metrics panel removal changes a step (check the four scenarios; probably re-run as-is), and record the per-scenario add/update/re-run decisions in this document before writing the spec.

Backend: extend `backend/test/data-models.e2e-spec.ts` with export, import and model-metrics scenarios (focused module boot; typed bodies; follow the file's conventions) and add them to *Feature: Data model* in `gherkin.md`.

Unit: `ng test` specs for the api service and the line-diff util and the editor's error-to-line mapping; Jest specs for the new service methods and the merge-rule change.

## 4. Constraints

- Do NOT run `npm run test:e2e` in `frontend/` yourself (Playwright needs port 3000 and the World Cup Postgres on 55432; another story's run would collide) — write the spec, make the app build, and report that the Playwright run is pending; the orchestrator runs it.
- Do NOT run `npm run lint` project-wide in `backend/` (it is `eslint --fix`); lint only your files with `npx eslint <paths>`. Frontend: `npm run lint` if present is fine to *check*; do not reformat unrelated files.
- Backend e2e boots focused modules, not `AppModule` (see `data-models.e2e-spec.ts`).
- Keep Electron `--base-href ./` behaviour: downloads via Blob URLs, no absolute asset paths.

## 5. Out of scope

Ossie / Databricks Metric Views import; non-SQL adapters; the logical query layer (1.2.2, separate branch — do not touch `mastra/`, `sessions/`); concept curation (1.3.4).

## Acceptance (from the roadmap)

Fixing a relationship's cardinality in the editor and saving creates a new version that the assistant sees on the next turn (here: the current version changes and its YAML carries the new cardinality); an invalid edit is rejected with the offending line highlighted and the current version untouched; reverting changes the current version; an exported file re-imports identically apart from the version header — `appendVersion` always rewrites the `model`/`version` lines to the new version's own identity, so those two lines differ by design; every entity, relationship and metric matches byte-for-byte.

## 6. Step-6 impact analysis (component-impact → Gherkin scenario decisions)

Every component/page/service/backend module this change touches, the Gherkin scenarios that exercise it, and the add/update/delete/re-run-as-is decision — produced before any test or implementation code (CLAUDE.md workflow step 6).

### Backend

| Component | Scenarios | Decision |
| --- | --- | --- |
| `DataModelsController` / `DataModelsService` (export, import, serialize, versions list) | *Feature: Data model* — "Listing every version…", "Exporting a model version…", "Importing a model as YAML…", "Structured edits serialize…" | **Add** (new scenarios; existing bootstrap/revert/drift/resolve/schema scenarios **re-run as-is**, unaffected) |
| `DataModelsController` / `DataModelsService` (model-metrics CRUD), `MetricsController`'s new `ModelMetricCandidatesController` | *Feature: Data model* — "The metrics panel reads and writes the model directly", "A model-authored metric survives a later legacy metrics-panel write…" | **Add** |
| `DataModelsService.syncMetric` / `removeMetric` (merge-rule flip) | *Feature: Data model* — "A model-authored metric survives…"; indirectly the "Metrics created before the change appear in the model…" scenario (legacy sync still works for non-local names) | **Add** new scenario + spec; existing legacy-sync scenario **re-run as-is** (behaviour unchanged for the non-local-name path it covers) |
| `MetricsModule`/`MetricsService` (unchanged legacy `/metrics*` contract) | *Feature: Data model* — "Metrics created before the change appear in the model and keep working" | **Re-run as-is** |

### Frontend

| Component | Scenarios | Decision |
| --- | --- | --- |
| `features/data-model/*` (new: api service, models, `data-model-view`, `model-yaml-editor`, `model-versions`, `entity-editor`, `model-metrics-panel`) | *Feature: Data model editing* — all 7 scenarios | **Add** (new feature, new spec file) |
| `shared/utils/line-diff.ts` (new) | *Feature: Data model editing* — "Reverts to version 1…" (the diff step) | **Add** (unit-tested directly, exercised end-to-end by the Playwright scenario) |
| `features/datasets/components/dataset-list` (`openDataModel` action) | *Feature: Data model editing* — "Opens a dataset's data model…"; *Feature: Datasources, datasets, and sessions* (dataset list itself) | **Update** (`dataset-list`: new output + button); *Datasources, datasets, and sessions* scenarios **re-run as-is** — the new button is additive, no existing step changes |
| `features/datasets/components/catalog-browser` (metrics panel removed, note shown instead) | *Feature: Datasources, datasets, and sessions* — "Shows the real catalog schema and column metadata before a dataset is saved" (does not touch metrics) | **Re-run as-is** — checked all four scenarios in that feature; none assert on the metrics panel, so none change |
| `features/datasets/components/metrics-panel`, `services/metrics-api.service.ts`, `models/metric.model.ts` (deleted) | none (no Playwright spec ever referenced their test ids — confirmed by search) | **Delete** |
| `app.ts` / `app.html` (`MainView` gains `'dataset-model'`, `dataModelDataset` signal, render wiring) | *Feature: Data model editing* — "Opens a dataset's data model…"; every other `MainView` branch | **Update** (additive branch); all other scenarios **re-run as-is** |

### E2E/unit decisions

- `frontend/e2e/data-model-editing.spec.ts` — **new file**, one spec per the Gherkin feature above (per the E2E convention, one spec file per `Feature:`).
- `frontend/e2e/world-cup-workflow.spec.ts` — **re-run as-is**: reviewed all four scenarios in *Feature: Datasources, datasets, and sessions*; none assert on the metrics panel or reference a step this change alters.
- `backend/test/data-models.e2e-spec.ts` — **update** (append scenarios, per the backend table above).
- `backend/src/modules/data-models/data-models.service.spec.ts`, `backend/src/modules/metrics/metrics.service.spec.ts` — **update** (new unit coverage for the additions and the merge-rule flip).
- `frontend/src/app/shared/utils/line-diff.spec.ts`, `frontend/src/app/features/data-model/services/data-model-api.service.spec.ts`, `frontend/src/app/features/data-model/components/model-yaml-editor/model-yaml-editor.spec.ts` — **new** (api service, line-diff util, editor's error-to-line mapping, per the brief's unit-test list).

## 7. Deviations from this brief (recorded once implemented)

- **Added an endpoint not listed in §1**: `GET /datasets/:name/model/versions` (list every stored version). The brief's `model-versions` component needs the full version history (version, source, note, createdAt, yaml-for-diffing) but §1 only specified export/import/serialize/model-metrics; `GET .../model` only ever returns the *current* version. Added as the minimal missing piece, read-only, no new write path.
- **`model-metrics-panel`'s `where` builder is a single `{ attr, op, value }` leaf**, not the DSL's full recursive boolean tree (`and`/`or`/`not`) — documented in the component's header comment. A metric needing more than one condition is still reachable via the YAML tab.
- **Candidates route lives on a separate `ModelMetricCandidatesController`** (same file as `MetricsController`), not on `DataModelsController` as the brief's prose implied ("reuse `MetricsService.candidates` logic") — `MetricsController` carries an `@Controller('metrics')` prefix that would have put the route at the wrong path, and moving it to `DataModelsController` would require injecting `MetricsService` back into `DataModelsModule`, a circular import (`MetricsModule` already depends on `DataModelsModule`).
- **`entity-editor`'s server validation errors are listed, not mapped onto individual form fields.** The brief's §2 description says errors should be "shown inline against the form (map `entities[i].attributes[k].type`-style paths back to fields)"; what shipped instead is the same flat `path — message` list the YAML editor and metrics panel use (`entity-errors` / `model-metric-errors` testids), not a per-field inline mapping. A path-to-field mapper is a reasonable follow-up but was out of scope for closing the code-review round — every error is still visible and actionable (it names the exact path), just not positioned next to the specific input.
- **A deleted model metric is tombstoned** (`DataModelDoc.deletedMetricNames`, code review finding 6) so `rebootstrap`/`mergeSnapshot`/the legacy `syncMetric` mirror never resurrect a name the model explicitly removed, even though the legacy `metrics` store may still have a same-named row. Not in the original brief; added once the review identified that a plain delete (removing the name from the current version's `metrics` array) was not durable against those three re-derivation paths.
- **The export filename is built on the Electron renderer, not read from the response.** The brief's export endpoint returns a `Content-Disposition` header with the suggested filename (unchanged, still useful for `curl`/browser downloads); the frontend does not read it, because `app.enableCors()` exposes no custom headers by default and the renderer's call to the backend is cross-origin under `file://`. `slugifyDatasetName` in `data-model-api.service.ts` mirrors the backend's own slug logic so the two still agree.

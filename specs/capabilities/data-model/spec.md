# Data model

Every dataset owns one **data model**: a versioned, storage-neutral description of the data the assistant reasons over. It names the entities, their attributes, the relationships between them and the business metrics, and binds each entity to where its rows physically live. The model exists without user work: it is bootstrapped from the dataset's schema snapshot when the dataset is saved, and for every older dataset when the app starts. Analysts open it from the dataset list to curate it: they edit its YAML or use forms, see each version with a diff, revert, and move it between installs as a `.yaml` file. The assistant never sees a table name or a SQL dialect: it queries the model's logical entities, and one compiler turns those logical queries into SQL for the datasource. Decisions: ADR-0012 (the data model DSL) and ADR-0013 (the logical query layer) in [../../system/architecture.md](../../system/architecture.md). Epic: [BA-2](../../epics/BA-2/spec.md).

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): data model, dataset, datasource, entity, attribute, relationship, binding, metric, logical query, drift report, verified query, assistant, local mode, org server mode, owner.

Capability-local vocabulary:
- **Version** — one immutable, numbered state of a model, with its source: `bootstrap` (built from the snapshot, or written by the app itself), `user` (saved in the editor or the forms) or `import` (brought in from a file).
- **Current version** — the version the model's pointer selects. The assistant, the compiler and the Overview read only the current version.
- **Snapshot** — the dataset's stored schema of its included tables, with sample values and references ([datasets](../datasets/spec.md) R17-R19).
- **Logical reference** — the text address of a model element (R9).
- **Legacy metric** — a metric from the store that existed before data models: a flat SQL expression over a physical table, private to its owner in org server mode ([metrics](../metrics/spec.md) R15).
- **Metrics-import report** — the record of the last import of legacy metrics into a model: what was imported and what was skipped (R35).
- **Model-managed metric name** — a metric name created or changed through the Metrics tab; legacy writes never change it ([metrics](../metrics/spec.md) R6).

## Rules

### One versioned model per dataset

- R1. Every dataset SHALL have exactly one data model, addressed by the dataset's name. Deleting the dataset SHALL delete its model.
- R2. A model SHALL be an append-only list of versions plus a current-version pointer. Each version records its number, creation time, source (`bootstrap`, `user` or `import`), an optional note, its YAML text and the parsed model. A stored version SHALL never be changed or deleted.
- R3. A new version SHALL be numbered one more than the number of stored versions and SHALL become the current version. A save after a revert therefore gets a new number; it never reuses or overwrites one.
- R4. Reading a model SHALL answer the current version; any stored version SHALL be readable by number, and the version list SHALL return every stored version with its source, note, time and YAML.

### The DSL

- R5. A model SHALL hold: its name (the dataset's name), its version number, an optional description, and lists of entities, relationships and metrics. When a version is written, the system SHALL set the name and number itself, whatever the submitted text says.
- R6. An **entity** SHALL have a name, an optional label, description and key (a list of attribute names), at least one binding, and its attributes. An **attribute** SHALL have a name, a type (`string`, `integer`, `number`, `boolean`, `date`, `datetime`, `time`, `json` or `unknown`), and optionally a role (`key`, `dimension`, `measure` or `time`), a nullable flag, a description and sample values. An attribute name is a path: segments joined by `.`, where a segment ending in `[]` means one level of array (`ratings[].score`).
- R7. A **binding** SHALL say where an entity's rows live, by datasource kind: `sql` (datasource, a `catalog.schema.table` table, optional attribute → column map), `rest` (datasource, endpoint, optional record path, optional column map), `mongo` (datasource, collection) or `file` (optional datasource, path, format `csv`, `json` or `ndjson`, optional record path). The column map is needed only where a column's name differs from the attribute's. Only `sql` and `rest` bindings SHALL be queryable; `mongo` and `file` are accepted by validation but have no adapter.
- R8. A **relationship** SHALL have an optional name, `from` and `to` attribute references (`<entity>.<attribute>`), a cardinality (`one_to_one`, `many_to_one`, `one_to_many` or `many_to_many`), a source (`declared` from the datasource's foreign keys, `inferred` from naming, `user` from a person) and an optional description. A metric's shape is defined in [metrics](../metrics/spec.md) R1-R4.
- R9. Every element SHALL have one logical reference: `<entity>`, `<entity>.<attribute path>`, `metric:<name>` and `rel:<from>-><to>` or `rel:<name>`. Names SHALL match case-insensitively everywhere in the DSL.
- R10. The system SHALL publish the DSL's JSON Schema, with definitions for the model, entities, attributes, bindings, relationships and metrics.

### Validation

- R11. Every write SHALL validate the whole model, structurally and semantically: entity names match `^[a-z][a-z0-9_]*$` and are unique; attribute path segments match `^[a-z][a-z0-9_]*(\[\])?$` and attribute names are unique within their entity; key attributes are declared on the entity; a `sql` table has exactly three non-empty segments; a column map names only declared attributes; relationship ends resolve to an entity and one of its attributes; and the metric rules of [metrics](../metrics/spec.md) R2-R4 hold. All comparisons ignore case.
- R12. A YAML save and an import SHALL also check the model against the dataset's snapshot: every bound table or endpoint SHALL be part of the dataset (`"<address>" is not part of dataset "<name>"`), and every attribute SHALL map to an existing column (`column "<column>" mapped from attribute "<attribute>" does not exist on "<address>"`, or `attribute "<attribute>" has no matching column on "<address>"` when there is no column map entry).
- R13. Every issue SHALL carry the path of the offending node (array indices in brackets, keys dot-separated, e.g. `entities[0].bindings[0].columns.attendance`) and a message; issues found in YAML text SHALL also carry the line and column of that node, or of its nearest existing ancestor when the node itself is missing. A YAML syntax error SHALL be reported the same way, before any validation.
- R14. A rejected write SHALL answer with every issue (HTTP 400, `{ ok: false, errors }`) and SHALL change no version and not the current pointer.
- R15. YAML SHALL be written by one serializer: keys in the order of R5-R8, absent optional fields omitted, no anchors. Parsing a serialized model SHALL give back the same model.

### Bootstrap

- R16. The system SHALL create version 1 (source `bootstrap`) of a dataset's model from its snapshot, with no user action: on the dataset's first save, and at startup for every dataset that has no model. At startup a dataset whose bootstrap fails SHALL be logged and skipped; the others and the app carry on. A bootstrap result that fails validation SHALL NOT be stored.
- R17. Bootstrap SHALL derive one entity per snapshot table. Its name is the table's last segment, lowercased, with every run of characters outside `a-z0-9_` replaced by `_` and a `c_` prefix when it would not start with a letter. When two tables of the dataset get the same name, all of them escalate together to `<schema>_<table>`, then `<catalog>_<schema>_<table>`, then a numeric suffix. The binding is `sql` to the dataset's datasource (`rest` with the endpoint key for a REST datasource; datasource `default` when the dataset has none) with a column map entry only for a column whose sanitized name differs.
- R18. Bootstrap SHALL derive one attribute per column: the sanitized column name; the type from the column's SQL type (`int`, `integer`, `bigint`, `smallint`, `serial` → `integer`; `numeric`, `decimal`, `float`, `double`, `real`, `money` → `number`; `bool…` → `boolean`; `timestamp…`, `datetime…` → `datetime`; `date` → `date`; `time…` → `time`; `json…`, `struct`, `map`, `array` → `json`; `text`, `varchar`, `char`, `string`, `uuid` → `string`; anything else `unknown`); the role `key` for a column that carries a reference or whose name ends in `id`, `key` or `code`, else `time` for a date or datetime, `measure` for an integer or number, `dimension` otherwise; the nullable flag; the column's description; and up to 6 of its sample values, typed (an integer beyond the safe integer range stays text). The entity's key is `id` when it has that attribute, else `<singular entity name>_id` when present.
- R19. Bootstrap SHALL derive one `many_to_one` relationship per column reference whose target table is in the dataset, keeping the reference's `declared` or `inferred` source ([datasets](../datasets/spec.md) R23-R29). It SHALL import the legacy metrics over the dataset's tables by R34.

### Re-save, drift and rebuild

- R20. Re-saving a dataset SHALL NOT overwrite or remove anything in its model. It SHALL record a fresh drift report and, only when the snapshot now includes tables that no entity binds, append one version (source `bootstrap`, note `merged <n> new entities from the dataset snapshot`) that adds just those entities, the relationships between them and the existing entities, and the legacy metrics over the new tables (R34).
- R21. A **drift report** SHALL compare the current version's `sql` and `rest` entities with the dataset's snapshot and list: `added` (`<entity>.<attribute>` for columns no attribute maps), `removed` (attributes whose column is gone), `changed` (attributes whose inferred type differs, with the old and new type), `entitiesAdded` (unbound tables, named as bootstrap would), `entitiesRemoved` (bound tables gone from the snapshot), the time it was checked and the version it was checked against. A drift report SHALL NOT create a version. Reading the drift of a model with no recorded report SHALL compute one against the stored snapshot (empty for a fresh model).
- R22. **Bootstrap from snapshot** SHALL append a version (source `bootstrap`) rebuilt from the dataset's current snapshot by R17-R19. It keeps every metric of the current version (the current definition wins for a shared name) and drops every deleted metric name ([metrics](../metrics/spec.md) R6); entity and relationship edits are replaced by the rebuilt ones. It asks no confirmation; the previous version stays and can be restored by revert.

### Editing, revert, export and import

- R23. Saving YAML SHALL validate it (R11-R14) and append a version with source `user`. Importing a file SHALL do exactly the same, with source `import`.
- R24. The entity form SHALL save through the same path as the YAML editor: the edited model is serialized by the one serializer (R15), then saved as YAML, so it is validated the same way and becomes a `user` version. Serializing on its own SHALL validate the model and store nothing.
- R25. Revert SHALL move the current pointer to a stored version. It SHALL create no version and delete none. The assistant SHALL use the reverted model from its next turn.
- R26. Export SHALL return the stored YAML of the current version, or of a requested version, verbatim, as a YAML file named `<dataset-slug>.model.v<n>.yaml` (slug: lowercase, every run of other characters than `a-z0-9` replaced by `-`, trimmed of `-`, `dataset` when empty).
- R27. Importing an exported file SHALL produce a model identical to the exported one apart from the version header (name and number, which R5 sets): every entity, relationship and metric matches.

### Resolving references

- R28. Resolving a list of logical references against the current version, or a given version, SHALL answer for each reference, in order, whether it resolved and, if so, its kind (`entity`, `attribute`, `metric` or `relationship`) and the element it names. A malformed reference is reported as unresolved.

### Logical queries

- R29. A **logical query** SHALL name a `from` entity, optional explicit `joins` (each `via` a relationship name or `<entity>.<attr>-><entity>.<attr>`, with an optional alias needed to join an entity to itself), at least one `select` item (an attribute with an optional alias and an optional `bucket` of `year`, `quarter`, `month`, `week` or `day` on a date or datetime; a metric by name; or an ad-hoc aggregation with an alias, an optional attribute and an optional filter), an optional `where` predicate (the same predicate shape as metrics), optional `group_by` (filled with the plain attributes of `select` when omitted and `select` mixes attributes with aggregations), optional `order_by` (an alias or an attribute, `asc` or `desc`), and a `limit` of 1 to 500, 100 by default. Joins MAY be omitted when exactly one declared relationship path reaches an entity the query names.
- R30. Every reference in a logical query SHALL be resolved against the model before any SQL is produced. A query with any problem SHALL be rejected, before any database call, with structured issues `{ code, message, path }`, coded `unknown_entity`, `unknown_attribute`, `unknown_metric`, `unknown_relationship`, `ambiguous_path`, `no_path`, `invalid_order_by`, `invalid_select`, `mixed_datasources`, `bucket_on_non_date` or `fan_out` (an aggregate taken across a one-to-many join).
- R31. One compiler SHALL turn a resolved query into SQL for PostgreSQL, Databricks SQL or SQLite, with every dialect difference in that one place. A metric SHALL be computed by the compiler from its definition. Compiling on request SHALL use the requested dialect (PostgreSQL by default) and SHALL NOT call any database.
- R32. Running a logical query on a dataset SHALL compile it for the datasource bound to its root entity (`sql` bindings by the datasource's kind, `rest` as SQLite over the materialised records) and run it read-only on that datasource. A runtime error from the database SHALL get the same one repair attempt as the assistant's query tool ([sessions-chat](../sessions-chat/spec.md)). The answer carries the rows, the compiled SQL and the compiler's notes.
- R33. For a session, the system SHALL compose the current models of the session's datasets into one session model: an entity bound to the same physical table in several datasets appears once; two different tables that share a logical name are both renamed `<dataset_slug>__<entity>`, with a note saying why. The assistant reasons only over this session model and never sees a physical name, a datasource id or kind, or a dialect; its tools and the model block are in [../../system/agents.md](../../system/agents.md).

### Metrics in the model

- R34. **Metrics import.** The system SHALL import legacy metrics into data models at startup for every model, when a model is bootstrapped or rebuilt (R16, R22), and for the new tables of a re-save merge (R20). It SHALL take the legacy metrics of **every owner**, not only the caller's, keep those whose entity is a table the model binds, order them by creation time and then id, and import the first metric of each lowercase name onto the entity bound to its table, as a metric with its SQL expression, label, description and the dimensions that match the entity's attributes (others are dropped and logged), recording its **author**: the owner who created it, or none in local mode. A later metric with a name already imported, or a name the model already holds from another source, SHALL NOT be imported. Names the model manages itself or has deleted ([metrics](../metrics/spec.md) R6) SHALL NOT be imported. An import that finds nothing new SHALL add no version, so repeated startups change nothing. A metric created through the Metrics tab in org server mode records its author too: the signed-in user who created it, kept when it is later changed ([metrics](../metrics/spec.md) R14).
- R35. The model SHALL keep the **metrics-import report** of its last import: when it ran, each imported metric (name, entity, author, legacy id) and each skipped metric (name, author, legacy id, reason `name_clash`, and the legacy id of the metric that was kept). The drift report SHALL be answered together with this report (`metricsImport`), absent when no import has run.
- R36. A write to the legacy metrics store SHALL be mirrored into every current model that binds the metric's table, one new version per model touched (source `bootstrap`, note `metric <name> synced from the metrics panel`), except: a name the model manages itself or has deleted ([metrics](../metrics/spec.md) R6) is skipped and nothing changes; a name the model already holds from **another author** is skipped and appended to the model's metrics-import report as skipped, never overwritten. Renaming a legacy metric removes the old name from the models first. Deleting a legacy metric removes its name from every model that does not manage that name itself (note `metric <name> removed from the metrics panel`).

### Sharing and permissions (org server mode)

- R37. In org server mode a data model SHALL be shared exactly like its dataset ([datasets](../datasets/spec.md) R39, [../admin/spec.md](../admin/spec.md) R28): every signed-in user sees the same model, versions, drift and metrics, and every user's sessions use the same current version. In local mode the local user holds every permission and nothing changes.
- R38. Reading a model (its JSON Schema, the model, the version list, a version, the drift report, the export, its metrics and its metric candidates) and the operations that change nothing (resolve, compile, run a logical query, serialize) SHALL need **Use agents**.
- R39. Changing a model (save YAML, revert, Bootstrap from snapshot, import, and creating, changing or deleting a model metric) SHALL need **Manage datasources and datasets**. A request without it SHALL be refused with HTTP 403 and SHALL change nothing: the current version stays the same.
- R40. Without **Manage datasources and datasets** the app SHALL hide **Bootstrap from snapshot**, **Import**, every **Save as new version**, **Revert**, **New metric**, the metrics' **Edit** and **Delete**, **Promote a verified answer**, and the entity form's add and remove relationship controls; the YAML editor and the entity form SHALL be read-only. **Export**, the tabs, the version list and **Compare** stay available ([../admin/spec.md](../admin/spec.md) R25).

## Edge cases and errors

- **No model for the dataset** (an unknown name): HTTP 404 `No data model for dataset "<name>"`. Drift and Bootstrap from snapshot on a dataset that no longer exists: 404 `Dataset "<name>" not found`.
- **Unknown version** (read, revert, export, resolve): 404 `Version <n> not found for dataset "<name>"`.
- **Empty or missing YAML body**: rejected with located issues like any invalid YAML (R13, R14).
- **A save after a revert**: gets the next number after the highest stored version (R3); the versions in between stay listed.
- **Bootstrap from snapshot** discards entity and relationship edits of the current version (R22). It asks no confirmation; revert restores the previous version.
- **A dataset without a datasource binding**: its entities bind to datasource `default` until the dataset is saved again ([datasets](../datasets/spec.md) R34).
- **A legacy metric's dimension that no attribute matches**: dropped from the imported metric and logged; the metric is still imported.
- **Two legacy metrics with one name** (different owners, or one owner's metrics differing only in case): the earliest by creation time, then by id, is imported; the others are listed as skipped in the metrics-import report (R34, R35). The header shows the metrics-import chip.
- **Drift chip** counts removed and changed attributes only; new columns and tables are not a warning.
- **The drift request fails**: the view shows no drift chip and no error. The version list failing leaves the Versions tab empty.
- **A logical query naming a `mongo` or `file` entity**: that entity is not queryable (R7) and is not part of the session model.
- **A caller without Manage datasources and datasets** sending a write anyway: HTTP 403, the app shows "You don't have permission to do this." and keeps the view (R39, [../admin/spec.md](../admin/spec.md) R24).
- **Import of a file that is not valid**: the toast `Import failed — the file has validation errors` (or the server message), no new version. A file the browser cannot read: `Could not read the selected file`.

## Contracts

- Endpoints: the 19 data model routes (schema, model, versions, version, save, revert, bootstrap, drift with the metrics-import report, resolve, compile, query, export, import, serialize, model metrics list, create, update, delete, metric candidates) in [../../system/api.md](../../system/api.md) section 2.16; the permission of each route in section 1.9; the import-only legacy metrics routes in section 2.4.
- Collection `data_models` (one document per dataset: versions, current version, last drift, model-managed and deleted metric names, last metrics import), its place among the shared collections, its relation to `datasets` and the startup migration that bootstraps models and imports every owner's metrics: [../../system/data-model.md](../../system/data-model.md) sections 3.13, 3.15, 3.16 and the Migrations table.
- The assistant's model block, its logical tools (`list_entities`, `describe_entity`, `query_entities`, `sample_records`, `run_raw_sql` flagged outside the model), `query-fixer`, `query-verifier` and `sql-fixer`, and the eval `legacy` path: [../../system/agents.md](../../system/agents.md).
- Decisions: ADR-0012 and ADR-0013 in [../../system/architecture.md](../../system/architecture.md).
- Related capabilities: [datasets](../datasets/spec.md) (snapshot, save, delete), [metrics](../metrics/spec.md) (metric rules, Metrics tab, legacy store), [sessions-chat](../sessions-chat/spec.md) (turns that use the model), [admin](../admin/spec.md) (permissions).

## UI

The **Data model view** is a main view reached from the **Data model** icon button on a dataset row in the Datasets list (shown on hover or focus, for every user); the rail keeps **Datasets** current and **Back** returns to the list. Layout, chips, test ids and copy: [../../system/ui.md](../../system/ui.md) section 4.19 (the row button in 4.2, the controls hidden by permission in 1.6). States:

- Loading (`Loading data model…`), error (the server message), loaded.
- Header: the dataset name, the version chip `v<n> · <source>`, the drift chip `Drift: <n>` when the drift report has removed or changed attributes, the metrics-import chip when the last import skipped metrics, and **Bootstrap from snapshot**, **Export**, **Import** (R40 hides two of them).
- Tabs: **Overview** (entities with their attribute counts, relationships with their cardinality, metric labels; each empty group says so), **YAML** (the editor with line numbers and the located error list), **Versions** (newest first, the current one marked, Compare and Revert, a line diff between two versions), **Metrics** ([metrics](../metrics/spec.md)). Choosing an entity in Overview opens the entity form (label, key, description, attribute types, roles and descriptions, relationships with cardinality, add and remove).
- Every successful write reloads the model, the versions and the drift and keeps the current tab.

## Flows

### Feature: Data model

E2E: API-level, not Playwright: `backend/test/data-models.e2e-spec.ts` (every scenario but the last three, local mode) and `backend/test/data-models-org.e2e-spec.ts` (the last three, org server mode).

```gherkin
Feature: Data model
  The versioned, storage-neutral data model every dataset owns, plus export/import, structured serialization and model-scoped metrics.

  Background:
    Given the backend is running with an empty data directory
    And a datasource "World Cup" of kind postgres exists

  Scenario: A saved dataset gets a bootstrapped data model
    When I save the dataset "World Cup Core" with the entities "world_cup.world_cup.matches" and "world_cup.world_cup.teams"
    Then GET /datasets/World Cup Core/model returns version 1
    And the model has the entities "matches" and "teams" bound to their tables
    And the "matches" attributes carry the snapshot's types and sample values
    And the relationship "matches.home_team_id -> teams.team_id" has cardinality many_to_one and source "inferred" or "declared"

  Scenario: Existing datasets are bootstrapped on startup
    Given a dataset saved before data models existed
    When the backend starts
    Then GET /datasets/<name>/model returns version 1 with source "bootstrap"

  Scenario: Metrics created before the change appear in the model and keep working
    Given a legacy "metrics" row for "avg_attendance" on "world_cup.world_cup.matches" and its dataset doc were seeded directly into SQLite before the app started (predating ADR-0012)
    When the backend starts and bootstraps the dataset's model
    Then the model lists the metric "avg_attendance" on entity "matches" with its SQL expression
    And GET /metrics?entities=world_cup.world_cup.matches still returns "avg_attendance" with its original UUID id
    When I create the metric "goals_per_match" through POST /metrics
    Then a new model version lists "goals_per_match"

  Scenario: Re-saving with a new table merges it into a new version
    Given the dataset "World Cup Core" was saved with only "world_cup.world_cup.matches"
    When I re-save it including "world_cup.world_cup.teams" too
    Then a new version adds the "teams" entity, leaving "matches" and its existing metrics untouched
    And GET /datasets/World Cup Core/model/drift still lists "matches.attendance" as removed and "matches.spectators" as added when those columns also changed

  Scenario: Saving a new model version through YAML
    When I PUT /datasets/World Cup Core/model with YAML that adds the description "One played match" to entity "matches"
    Then the response is version 2 with source "user"
    And GET /datasets/World Cup Core/model/versions/1 is unchanged

  Scenario: An invalid model is rejected with a line and column
    When I PUT /datasets/World Cup Core/model with YAML whose "matches" binding maps attribute "attendance" to a column "spectators" that does not exist
    Then the response is 400
    And the errors name the path "entities[0].bindings[0].columns.attendance" with a line and a column
    And the current model version is still 1

  Scenario: Reverting moves the current pointer
    Given the model has versions 1 and 2
    When I POST /datasets/World Cup Core/model/revert with version 1
    Then GET /datasets/World Cup Core/model returns version 1
    And version 2 still exists

  Scenario: A changed snapshot yields a drift report, not a new version
    Given the model v1 was bootstrapped from a snapshot with the column "attendance"
    When I re-save the dataset with a snapshot where "attendance" is gone and "spectators" is new
    Then GET /datasets/World Cup Core/model/drift lists "matches.attendance" as removed and "matches.spectators" as added
    And GET /datasets/World Cup Core/model still returns version 1

  Scenario: Logical references resolve against a model version
    When I POST /datasets/World Cup Core/model/resolve with the references "matches", "matches.attendance", "metric:avg_attendance", "rel:matches.home_team_id->teams.team_id" and "matches.nope"
    Then the first four resolve to their kind and target
    And "matches.nope" is reported as unresolved

  Scenario: The JSON Schema of the DSL is published
    When I GET /data-models/schema.json
    Then the response is a JSON Schema with a definition for entities, relationships, metrics and bindings

  Scenario: Compiling a logical query returns dialect SQL without touching the database
    Given the dataset "World Cup Core" has a bootstrapped model with entities "matches" and "teams"
    When I POST /datasets/World Cup Core/model/compile with a query selecting "match_date" and "attendance" from "matches"
    Then the response is dialect SQL naming only the logical entity "matches", for the requested dialect (postgres or databricks)
    And no database call was made

  Scenario: A logical query naming an unknown attribute or an undeclared relationship is rejected before any database call
    When I POST /datasets/World Cup Core/model/compile with a query selecting an attribute "matches" has no such name
    Then the response is 400 with a structured issue coded "unknown_attribute"
    When I POST /datasets/World Cup Core/model/compile with a query naming an entity no declared relationship reaches
    Then the response is 400 and no database call was made

  Scenario: Listing every version for the Versions tab
    When I GET /datasets/World Cup Core/model/versions
    Then the response lists every stored version (version, source, note, createdAt, yaml), not just the current one

  Scenario: Exporting a model version downloads its YAML
    When I GET /datasets/World Cup Core/model/export
    Then the response is text/yaml with a Content-Disposition attachment named "<dataset-slug>.model.v<current>.yaml"
    When I GET /datasets/World Cup Core/model/export?version=1
    Then the response is version 1's YAML, named "...v1.yaml"

  Scenario: Importing a model as YAML creates a new "import" version
    When I POST /datasets/World Cup Core/model/import with a valid YAML file's contents
    Then a new version is created with source "import"
    When I POST /datasets/World Cup Core/model/import with YAML whose binding maps an attribute to a missing column
    Then the response is 400 with located errors and the current version is unchanged
    And exporting the current version and importing it back produces an equivalent model (same entities, relationships and metrics)

  Scenario: Structured edits serialize through the one YAML writer
    When I POST /datasets/World Cup Core/model/serialize with a plain model object
    Then the response is the same YAML shape saveYaml/export would produce, with no persistence side effect

  Scenario: The metrics panel reads and writes the model directly
    When I POST /datasets/World Cup Core/model/metrics with a new metric
    Then the response is ok with a new "user" version, and GET /datasets/World Cup Core/model/metrics lists it
    When I PUT /datasets/World Cup Core/model/metrics/<name> renaming it
    Then a new version reflects the rename
    When I DELETE /datasets/World Cup Core/model/metrics/<name>
    Then a new version no longer lists it
    When I POST /datasets/World Cup Core/model/metrics with a metric referencing an unknown entity
    Then the response is 400 and the current version is unchanged
    And GET /datasets/World Cup Core/model/metrics/candidates offers verified-query drafts scoped to the dataset, addressed by logical entity name

  Scenario: A model-authored metric survives a later legacy metrics-panel write of the same name
    Given a metric "goals_per_match" was created through POST /datasets/World Cup Core/model/metrics
    When a legacy POST /metrics write defines a different metric also named "goals_per_match"
    Then the model's own "goals_per_match" definition is unchanged — the model wins for names it manages itself

  Scenario: Metrics of every user are imported into the shared model at startup
    Given the backend runs in org server mode with "admin@contoso.test" as a bootstrap admin
    And "ada@contoso.test" and "grace@contoso.test" both hold the Maker role
    And Ada created the legacy metric "avg_attendance" and Grace the legacy metric "max_attendance", both on "world_cup.world_cup.matches", through POST /metrics
    And the dataset "World Cup Core" over "world_cup.world_cup.matches" has no data model yet
    When the backend restarts on the same data directory
    Then GET /datasets/World Cup Core/model as "user@contoso.test", who holds only the User role, answers 200
    And the model lists "avg_attendance" with Ada as its author and "max_attendance" with Grace as its author

  Scenario: A name clash keeps the first metric and reports the rest
    Given the backend runs in org server mode
    And "ada@contoso.test" created the legacy metric "avg_attendance" on "world_cup.world_cup.matches"
    And later "grace@contoso.test" created her own legacy metric "avg_attendance" on the same table
    And the dataset "World Cup Core" over "world_cup.world_cup.matches" has no data model yet
    When the backend restarts on the same data directory
    Then the model lists one "avg_attendance", with Ada as its author and Ada's expression
    And GET /datasets/World Cup Core/model/drift lists Grace's "avg_attendance" under "metricsImport.skipped" with the reason "name_clash" and Ada's metric as the one kept
    When the backend restarts again
    Then the model has no new version

  Scenario: A caller without Manage datasources cannot change a model
    Given the backend runs in org server mode with "admin@contoso.test" as a bootstrap admin
    And the dataset "World Cup Core" has a data model at version 1
    When "user@contoso.test", who holds only the User role, sends PUT /datasets/World Cup Core/model with valid YAML
    Then the response is 403
    And GET /datasets/World Cup Core/model as "user@contoso.test" answers 200 with version 1
    When "admin@contoso.test" sends the same PUT
    Then the response is version 2 with source "user"
```

### Feature: Data model editing

E2E: `frontend/e2e/data-model-editing.spec.ts`

The scenario "Defines a metric in the Metrics tab" is the automated part of the Metrics tab; the tab's other scenarios are in [metrics, Feature: Metrics tab](../metrics/spec.md#feature-metrics-tab). Reading the model without the right to change it is "A User can read a dataset's data model but not change it" in [admin, Feature: Permissions in the app](../admin/spec.md#feature-permissions-in-the-app).

```gherkin
Feature: Data model editing
  Analysts curate each dataset's data model inside the app: raw YAML with
  line-level errors, structured entity/relationship forms, a version
  history with diff and revert, export/import as a file, and a metrics
  tab that reads and writes the model directly.

  Background:
    Given the seeded World Cup PostgreSQL database is running
    And I have created the "World Cup PostgreSQL" datasource and the "World Cup Core" dataset

  Scenario: Opens a dataset's data model and sees its bootstrapped entities, relationships and metrics
    When I click "Data model" on the "World Cup Core" dataset
    Then I see the version badge "v1 · bootstrap"
    And I see the "matches" and "teams" entities in the Overview tab
    And I see at least one relationship and the dataset's metrics
    And the axe scan reports no violations in the Light theme
    And the axe scan reports no violations in the Dark theme

  Scenario: Edits the YAML, saves, and the version badge advances
    Given I am on the "YAML" tab of the "World Cup Core" data model
    When I add a description to the "matches" entity and click "Save as new version"
    Then I see the version badge "v2 · user"
    When I open the "Versions" tab
    Then I still see version 1 listed

  Scenario: An invalid YAML edit is rejected with its line highlighted
    Given I am on the "YAML" tab of the "World Cup Core" data model
    When I map the "attendance" attribute to a column that does not exist and click "Save as new version"
    Then I see an error naming the offending path with a line and column
    And clicking the error highlights that line in the editor
    And the version badge still reads "v1"

  Scenario: Reverts to version 1 from the Versions tab
    Given the "World Cup Core" data model has versions 1 and 2
    When I open the "Versions" tab and click "Revert" on version 1
    Then the version badge reads "v1"
    And version 2 is still listed
    When I compare version 1 and version 2
    Then I see the changed line highlighted in the diff

  Scenario: Changes a relationship's cardinality in the entity form and saves
    Given I am on the "Overview" tab of the "World Cup Core" data model
    When I click the "matches" entity
    And I change a relationship's cardinality and click "Save as new version"
    Then the version badge advances
    And the Overview tab shows the new cardinality

  Scenario: Defines a metric in the Metrics tab
    Given I am on the "Metrics" tab of the "World Cup Core" data model
    When I create a metric named "goals_per_match" on entity "matches"
    Then I see it in the metrics list
    And the YAML tab shows it under "metrics:"

  Scenario: Exports the model and re-imports it
    Given I am on the "World Cup Core" data model
    When I click "Export"
    Then a ".yaml" file downloads
    When I click "Import" and choose the downloaded file
    Then a new "import" version is created, identical to the exported file apart from the version header
```

## Acceptance

The epic's four criteria ([BA-2](../../epics/BA-2/spec.md)), each checked by the Flows above plus the evidence listed:

1. Every existing dataset gets a model on upgrade with no user action, and a new dataset gets one on save ("Existing datasets are bootstrapped on startup", "A saved dataset gets a bootstrapped data model"); legacy metrics of every owner are in the models, with their authors, and clashes are reported ("Metrics of every user are imported…", "A name clash keeps the first metric…").
2. An invalid edit is rejected with its line and column and the current version untouched ("An invalid model is rejected…", "An invalid YAML edit is rejected…"); reverting changes what the assistant sees on its next turn ("Reverts to version 1…" plus a session turn after the revert, checked in [sessions-chat](../sessions-chat/spec.md)).
3. No table name or SQL dialect appears in the assistant's prompt or tool calls, and logical queries compile on every beta datasource: PostgreSQL, Databricks SQL and the REST materialisation ("Compiling a logical query…", the compiler's unit tests for the three dialects, and the agents Features in [agents-evals](../agents-evals/spec.md) and [sessions-chat](../sessions-chat/spec.md)).
4. An exported model re-imports identically apart from the version header ("Importing a model as YAML…", "Exports the model and re-imports it").

Also: in org server mode a User reads every model and a User's write is refused with 403 and changes nothing ("A caller without Manage datasources cannot change a model", and the admin Feature "Permissions in the app"); a legacy metrics write of a name another author's metric holds in a model is skipped and reported (R36, covered by the service's unit tests). Eval runs on both assistant paths are evidence, not acceptance; there is no accuracy threshold.

<!-- sources: backend/src/modules/data-models/**, backend/src/modules/datasets/datasets.service.ts (bootstrap on save, delete), backend/src/modules/metrics/metrics.service.ts (legacy mirror, candidates), frontend/src/app/features/data-model/**, frontend/src/app/features/datasets/components/dataset-list/dataset-list.html (Data model button), frontend/e2e/data-model-editing.spec.ts, backend/test/data-models.e2e-spec.ts -->

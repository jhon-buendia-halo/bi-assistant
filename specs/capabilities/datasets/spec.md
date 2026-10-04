# Datasets

A dataset is a named selection of entities (tables and views) from one datasource. The user browses a datasource's catalogs, schemas and entities, ticks what the assistant should be able to see, names the selection and saves it. Saving captures a schema snapshot of the chosen entities, enriched with real sample values and with how the entities join, so that the assistant can ground its answers without a live round trip. A session is created from one or more datasets, and those datasets define what the assistant is told it may query.

## Concepts

Defined once in [the glossary](../../product/glossary.md); used here as follows.

- **Dataset** — a named, saved selection of entities from exactly one datasource, with a schema snapshot. Identified by its name. (Legacy name: "sandbox selection"; see R31.)
- **Entity** — one table or view, keyed `catalog.schema.table`. See [datasources](../datasources/spec.md) R30.
- **Inventory** — the catalog → schema → table → column tree of a datasource, served from a stored snapshot unless refreshed. Owned by [datasources](../datasources/spec.md).
- **Inclusion** — whether an entity is part of the dataset being edited. Catalogs and schemas show a derived state: none, partial or full.
- **Schema snapshot** — per included entity, its columns (name, type, nullable) as of save time, plus enrichment.
- **Sample values** — up to five distinct stored values per column, captured at save time.
- **Reference** — for a key column, the entity and column it joins to, marked `declared` (from the datasource's own constraints) or `inferred` (from naming).
- **Session scope** — the datasets a session was created with.

## Rules

### What a dataset is

- R1. A dataset SHALL have a name, a list of entity keys, a schema snapshot (one entry per entity), the id and kind of its datasource, and created/updated timestamps.
- R2. A dataset SHALL draw all its entities from one datasource. Choosing a different datasource in the browser SHALL clear the current inclusion and selection.
- R3. Datasets SHALL be identified by name: saving with an existing name replaces that dataset (an upsert), it does not create a second one. Names are trimmed. Open question: in edit mode the Dataset name field is editable, and saving under a changed name creates a new dataset and leaves the old one; decide whether edit should rename instead.
- R4. The dataset list SHALL be ordered most recently updated first.

### Browsing and selecting

- R5. The catalog browser SHALL present the datasource's inventory as an expandable tree: catalog → schema → entity. Each row shows its name and a count (schemas per catalog, entities per schema, columns per entity).
- R6. The browser SHALL let the user choose the datasource from every saved datasource, labelled "<name> · <kind>".
- R7. Opening the browser to create a dataset when **more than one** datasource exists SHALL NOT contact any datasource: it shows the stored inventory snapshot if one exists, otherwise a prompt "Pick the datasource you want to browse, then load its entities." with a "Load entities from <kind>" button. With exactly one datasource, or when editing an existing dataset, the inventory loads immediately (from the snapshot when present). Choosing another datasource in the picker loads it immediately.
- R8. While loading the user SHALL be able to cancel and return to the picker, and to switch datasource at any time.
- R9. The browser SHALL show when the inventory was last read ("Updated <date and time>") and SHALL offer a refresh that re-reads the datasource live and replaces the snapshot.
- R10. The user SHALL be able to filter the tree by typing: a catalog whose name matches keeps all its schemas and entities; otherwise only schemas whose name matches (with all their entities) or entities whose name matches survive. Matching is a case-insensitive substring. While a filter is active every surviving node is expanded.
- R11. Selecting a row SHALL show its details in the right panel (R20). Clicking a catalog or schema row also toggles its expansion; clicking an entity row only selects it.
- R12. The user SHALL be able to include or remove the selected catalog, schema or entity from the dataset with the button in the details panel. Including a catalog or schema includes every entity beneath it; removing removes them all. Every action SHALL show a toast: `Included <name> — <n> entities added` or `Removed <name> — <n> entities excluded`.
- R13. The inclusion state of a schema or catalog SHALL be derived: **full** when all its entities are included, **partial** when some are, **none** otherwise (empty schemas count as none). The tree shows a check mark for full, a minus mark for partial, and a check mark on included entities.
- R14. Objects the credentials can browse but not query (inventory `selectable: false`) SHALL be shown greyed with a lock icon. Open question: nothing currently stops the user from including a locked entity by including its schema or catalog; decide whether locked entities must be excluded from inclusion.

### Saving

- R15. "Save dataset (N)" — N being the number of included entities — SHALL be enabled only when a datasource is selected, the Dataset name is not empty, N ≥ 1, and no save is running.
- R16. The system SHALL reject a save with `Dataset name is required`, `Include at least one entity`, `datasourceId is required`, `Datasource <id> not found`, or `Datasource kind must be <kind>` (when the supplied kind differs from the datasource's real kind).
- R17. On save the system SHALL store the schema snapshot the browser sent (columns of the included entities only, since the browser sends only those). The backend does not re-read the columns; an included key with no snapshot entry is kept in the dataset without columns.
- R18. On save the system SHALL enrich each snapshotted entity with sample values: it reads up to 50 rows per entity (four entities in flight, one shared connection where the kind allows), and for each column keeps up to five distinct non-empty values, each trimmed and cut to 40 characters plus `…`. Enrichment is best effort: an entity that cannot be sampled keeps its snapshot as is and the failure is logged; a sampling failure SHALL NOT fail the save.
- R19. On save the system SHALL attach relationships to the snapshot (R23–R29) and persist the dataset. Datasets saved before enrichment existed are not back-filled until they are saved again; the same applies to schema drift on the datasource — the snapshot is only refreshed by re-saving.
- R20. A successful save SHALL toast `Dataset "<name>" saved — <n> entities`, close the browser and return to the dataset list; a failure toasts the message and stays in the browser.

### Entity details

- R21. The right panel SHALL show details for the current selection. For a **catalog**: its name, "Catalog", the number of schemas and entities, and the list of its schemas with their entity counts. For a **schema**: its name, "Schema · <catalog>", the number of entities, and the list of entities with column counts. For an **entity**: its name, its fully-qualified key, the column count, and every column with its type and `· not null` when it cannot be null. With no selection it shows `Select a catalog, schema or entity to see its details.`
- R22. The details panel SHALL NOT show sample rows or sample values; those are stored for the assistant only.

### Relationships

- R23. A relationship is an edge from a column of one dataset entity to a column of another dataset entity. Both ends SHALL be inside the dataset's entities; an edge to an entity outside the dataset SHALL be dropped.
- R24. The system SHALL first ask the datasource for **declared** foreign keys among the dataset's entities, then **infer** edges from naming for the rest. For one column, a declared edge wins over an inferred one, and a column carries at most one reference. If either step fails, the other's result is used and the save continues.
- R25. Inference SHALL treat a column as a key candidate when its name is `<prefix>_<suffix>` or just `<suffix>`, with suffix `id`, `key` or `code` (case-insensitive), and SHALL only consider candidates with a prefix.
- R26. **Inference rule 1 (table-name match).** For a candidate `<tok1>_<tok2>_…_<suffix>`, the system SHALL try the prefix from the left-most token and drop one leading token at a time (so `tournament_team_id` is tried as `tournament_team`, then `team`). The first prefix that equals a dataset table's name, ignoring case and singular/plural form, is the target table; later (shorter) prefixes are not tried. The target column SHALL be, in order: a column named exactly the suffix (`id`); a column named `<matched prefix>_<suffix>`; or the only column in the target ending in that suffix. Any other situation (zero or several candidates) produces no edge.
- R27. Singular/plural matching SHALL fold only the last token of a name: `…ies` → `…y` (after a consonant), `…ches/shes/xes/zes/ses` → drop `es`, a trailing `s` dropped unless the word ends in `ss`, `us` or `is`, and words shorter than four letters are left alone.
- R28. **Inference rule 2 (shared column name).** For a candidate not claimed by rule 1 and not itself the key of its own table, the system SHALL link it to the only other dataset entity that has a same-named column acting as a key there; if zero or several entities qualify, no edge. A column "acts as a key" when it is not nullable and is either a bare `id`/`key`/`code`, or the first column of a table that has no `id` column.
- R29. Inference SHALL be deliberately conservative — a missing edge costs the assistant one extra exploration step, a wrong edge silently yields a wrong number. Therefore: if two dataset tables have the same canonical name, that name matches nothing; an edge from an entity to itself is never emitted; each column gets at most one edge.

### Scoping what the assistant can use

- R30. A session SHALL be created from at least one dataset (`select at least one dataset`; the composer says "Select at least one dataset for this session" and, with no datasets, "No datasets yet — create one in Datasets first."). The session's datasets define its scope; the assistant's per-turn context lists the dataset names, every entity key with its datasource kind and id, and the join hints of every column that has a reference (`->` declared, `~>` inferred; truncated to a fixed character budget).
- R31. The assistant's entity tools SHALL only act on entities of the session's datasets. Listing returns each entity with column count, datasource id/kind and dataset; describing returns columns with types, nullability, sample values, description (when the datasource supplied a column comment) and reference, or a note to sample the entity when no snapshot exists; sampling returns up to 100 rows (default 10) live. An entity outside the scope yields `Entity "<entity>" is not part of this session's datasets`; the same key in several datasources yields `Entity "<entity>" exists in several datasources — pass datasourceId. Options: <ids>`; an entity of an unbound dataset yields `Entity "<entity>" has no datasource bound — re-save its dataset`.
- R32. The assistant's SQL tool SHALL run on one datasource: the one named by the call if it is used by the session's datasets (`Datasource "<id>" is not used by this session's datasets` otherwise), else the only one in scope; with none bound it answers `No datasource is bound to this session's datasets`, with several `Several datasources are in scope — pass datasourceId. Options: <id (kind)>`. SQL dialect follows the kind: Databricks SQL, PostgreSQL, or SQLite for REST.
- R33. Open question: the SQL tool does not parse the statement, so a query that names an entity outside the session's datasets is not rejected by the system (the restriction is stated in the tool description). Decide whether to enforce scope in SQL.
- R34. Datasets that carry no datasource binding (created before datasources existed) SHALL be bound at read time to the default datasource ([datasources](../datasources/spec.md) R50); the binding is not persisted until the dataset is saved again.

### Listing and deleting

- R35. The dataset list SHALL group datasets by the month of their last update (month name; "Earlier" when there is no date) and show for each: name, a lock icon, and `Edited <Mon D> · <kind> · <n> entities`. Opening a row opens the browser in edit mode; a "⋮" menu offers "Delete dataset".
- R36. Deleting a dataset SHALL be by name and immediate (no confirmation), toast `Dataset "<name>" deleted`, and remove the row; an unknown name answers `Dataset "<name>" not found`. Sessions that listed the deleted dataset silently lose it from their scope. Open question: decide whether delete needs a confirmation and whether it should warn when sessions use the dataset.
- R37. Editing a dataset SHALL open the browser with its name and entities prefilled and its datasource selected. If that datasource no longer exists the system SHALL toast `The dataset datasource is no longer available. Choose entities from another datasource.`, clear the inclusion and select another datasource.

### Legacy

- R38. The persisted collection was previously named `sandbox_selections` and session documents carried `sandboxes`; both are migrated to `datasets` on startup, without changing sessions' recency order. Legacy documents in the datasets collection that have no name (the older single-selection shape) SHALL be ignored when listing. See [data-model.md](../../system/data-model.md).

## Edge cases and errors

- **No datasource configured:** the browser shows `No datasource configured. Add one in Datasource Configuration first.`
- **Inventory fails:** the error message from the datasource is shown in place of the tree (`Backend unreachable` when the backend cannot be reached).
- **Inventory is empty:** `No accessible catalogs found.`
- **Filter matches nothing:** `No catalogs, schemas or entities match “<term>”.`
- **Datasource asleep (Databricks):** loading shows `Loading inventory from <kind>…` with "The first load can take a while if the Databricks warehouse is starting up. You can switch datasource above at any time."
- **Dataset list:** loading `Loading datasets…`; empty `No datasets yet — create one with “New dataset”.`; error shows the backend message.
- **A column cannot be sampled** (permissions, timeout): the dataset still saves, without sample values for that entity.
- **Datasource kind label:** the dataset list and the datasource picker should show "Databricks", "PostgreSQL" or "REST API". Open question: in the current UI a REST datasource is labelled "Databricks" in the picker, and a REST dataset shows no kind in the list.
- **Inert controls:** the list's filter chips (All, Pinned, Yours, Shared with you) and its search and layout icons do nothing today.

## Contracts

- Endpoints: list, create/upsert and delete datasets: [api.md](../../system/api.md), section Datasets. Inventory and sampling come from the datasources endpoints.
- Collections: `datasets` (legacy name `sandbox_selections`) and the session field `datasets`: [data-model.md](../../system/data-model.md).
- Assistant tools (`list_entities`, `describe_entity`, `sample_rows`, `run_readonly_sql`) and the per-turn dataset block: [agents.md](../../system/agents.md), assistant agent.
- Datasource behaviour (inventory, sampling, foreign keys, read-only SQL): [datasources](../datasources/spec.md). Session creation: [sessions-chat](../sessions-chat/spec.md). Metrics shown under the browser: [metrics](../metrics/spec.md).
- Terms: [glossary](../../product/glossary.md).

## UI

Reached from the sidebar item **Datasets** (main area; toggles with Home) — see [ui.md](../../system/ui.md).

**Dataset list** — heading "Datasets"; filter chips and icons (inert); **New dataset** button; month sections of rows (see R35).

**Catalog browser** — heading "New dataset" or "Edit dataset"; subtitle "Catalogs, schemas and entities available through the selected datasource."; "Updated <date>" when known. Header controls: a "Datasource" picker, a "Refresh inventory" icon button (tooltip "Re-read catalogs, schemas and entities from the datasource", disabled while loading), a "Dataset name" input, and **Save dataset (N)** ("Saving…" while running; tooltip "Name the dataset and include at least one element"). Body states: choose-datasource prompt (R7), loading with Cancel, error, empty, or the tree with a filter box (placeholder "Filter catalogs, schemas and entities…", with a clear button). Rows: database icon + `<n> schemas` for catalogs, folder icon + `<n> entities` for schemas, table icon + `<n> columns` for entities. Beneath the tree the metrics panel curates metric definitions over the included entities ([metrics](../metrics/spec.md)).

**Entity details** — the default content of the right panel outside a session and outside agent detail. Top button: "Include item", "Include item (partially included)" or "Included — click to remove" (R12); then the catalog / schema / entity block (R21).

## Flows

### Feature: Datasources, datasets, and sessions (World Cup database)

Covered scenarios live in the datasources capability: [Datasources, datasets, and sessions (World Cup database)](../datasources/spec.md#feature-datasources-datasets-and-sessions-world-cup-database) — creating the "World Cup Core" dataset and a session from it, and "Shows the real catalog schema and column metadata before a dataset is saved". E2E: `frontend/e2e/world-cup-workflow.spec.ts`.

### Feature: Dataset management

E2E: none yet

```gherkin
Feature: Dataset management

  Background:
    Given the "World Cup PostgreSQL" datasource exists

  Scenario: Builds a dataset by including a whole schema
    Given I am in "Datasets"
    When I click "New dataset"
    And I click the "world_cup" schema
    And I click "Include item"
    Then I see "Included world_cup — <n> entities added", n being the number of entities in that schema
    And the schema row shows a full check mark
    And "Save dataset (<n>)" is disabled until I fill in "Dataset name"
    When I fill in "Dataset name" with "World Cup Core"
    And I click "Save dataset (<n>)"
    Then I see 'Dataset "World Cup Core" saved — <n> entities'
    And I see "World Cup Core" in the dataset list

  Scenario: Partially included schema shows a minus mark
    Given I am creating a dataset
    When I select the "goals" entity and click "Include item"
    Then the "world_cup" schema row shows a minus mark
    And the details button reads "Included — click to remove" for "goals"
    When I click "Included — click to remove"
    Then I see "Removed goals — 1 entities excluded"

  Scenario: Filters the tree
    Given I am creating a dataset and the inventory is loaded
    When I type "goal" in "Filter catalogs, schemas and entities…"
    Then I see only the schemas and entities that match "goal", expanded
    When I type "zzz"
    Then I see "No catalogs, schemas or entities match “zzz”."
    When I click "Clear filter"
    Then I see the full tree again

  Scenario: Waits for an explicit load when several datasources exist
    Given a Databricks datasource and the "World Cup PostgreSQL" datasource exist and neither has a stored inventory
    When I click "New dataset"
    Then I see "Pick the datasource you want to browse, then load its entities."
    And no datasource has been contacted
    And the picker has preselected the Databricks datasource
    When I choose "World Cup PostgreSQL · PostgreSQL" in the "Datasource" picker
    Then I see "Loading inventory from PostgreSQL…" and then the catalogs of that datasource

  Scenario: Refreshes the inventory
    Given I am creating a dataset and the inventory is loaded from the stored snapshot
    When I click "Refresh inventory"
    Then the inventory is read from the datasource again
    And "Updated" shows the new time

  Scenario: Shows entity details
    Given I am creating a dataset
    When I select the "goals" entity
    Then the right panel shows its fully-qualified name, its column count and each column with its type
    And a column that cannot be null shows "not null"

  Scenario: Edits an existing dataset
    Given the "World Cup Core" dataset exists with two entities
    When I click the "World Cup Core" dataset
    Then I see "Edit dataset" with the name and the two included entities prefilled
    When I remove one entity and click "Save dataset (1)"
    Then I see 'Dataset "World Cup Core" saved — 1 entities'

  Scenario: Warns when the dataset's datasource is gone
    Given the "World Cup Core" dataset exists and its datasource was deleted and another datasource exists
    When I click the "World Cup Core" dataset
    Then I see "The dataset datasource is no longer available. Choose entities from another datasource."
    And no entities are included

  Scenario: Deletes a dataset
    Given the "World Cup Core" dataset exists
    When I open the menu on "World Cup Core" and click "Delete dataset"
    Then I see 'Dataset "World Cup Core" deleted'
    And "World Cup Core" is no longer listed

  Scenario: Empty states
    Given no datasource is configured
    When I click "New dataset"
    Then I see "No datasource configured. Add one in Datasource Configuration first."
    Given no dataset exists
    When I open "Datasets"
    Then I see "No datasets yet — create one with “New dataset”."
```

## Acceptance

1. The datasources Feature scenarios that involve datasets pass (dataset creation against the seeded World Cup database; catalog schema and column metadata visible before saving).
2. The "Dataset management" scenarios above behave as written once automated.
3. After saving a dataset over the World Cup tables, the stored snapshot of `goals` has sample values for its text/number columns and references such as `goals.scoring_team_id → teams.id` and `goals.match_id → matches.id` (declared by PostgreSQL's constraints; each marked `declared`), and, for a datasource without constraints, inferred references (`~>`) for the same pairs.
4. A session created from the dataset lists the dataset's entities and join hints in its context, can describe and sample only those entities, and answers questions through the datasource named by the dataset (checked in [sessions-chat](../sessions-chat/spec.md)).
5. Deleting the dataset removes it from the list; sessions that used it keep working on their remaining datasets.

<!-- sources: backend/src/modules/datasets/**, backend/src/mastra/tools/dataset.tools.ts, backend/src/mastra/context-blocks.ts, backend/src/modules/sessions/sessions.service.ts (boundDatasets, agentContext), backend/src/infrastructure/database/database.module.ts (legacy renames), frontend/src/app/features/datasets/** (excluding metrics-panel), frontend/src/app/app.html (Datasets navigation, right panel), frontend/e2e/world-cup-workflow.spec.ts -->

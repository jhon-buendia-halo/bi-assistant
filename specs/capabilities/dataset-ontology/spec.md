# Dataset ontology

Each dataset carries an **ontology**: the business meaning of its data, written down so the assistant can use it. It holds four kinds of item: **concepts** (a business term, with synonyms and the columns it lives in), **relations** (how two concepts connect, or which governed metric measures a concept), **constraints** (a default SQL filter and when to apply it) and **instructions** (standing rules, data quirks and coverage facts). Items can be written by hand or drafted automatically from the dataset's schema, sample rows, column references and metrics; drafts always arrive disabled so a human reviews each one before the assistant ever sees it. An item can also be **shared**, so it applies to every dataset. Only enabled items reach the assistant, and every answer records exactly which items it was given. The ontology replaces the flat knowledge snippets of earlier versions (ADR-0036); an upgraded install keeps every snippet as an item.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): ontology, ontology item, concept, relation, constraint, instruction, shared item, ontology bootstrap, knowledge used, kind, source (user or mined), pending suggestion, dataset, datasource, entity, metric, session, assistant.

Capability-local vocabulary is limited to the UI words "Pending suggestions" (the review queue of mined, still-disabled items), "All datasets" (the badge on a shared item) and "Ontology in context" (the per-answer provenance disclosure).

## Rules

Shape and validation
- R1. The system SHALL store each ontology item with: a unique id, the name of the dataset it belongs to or none (a shared item), a kind, a name, a description (empty when not given), an enabled flag, a source, created/updated timestamps, and the fields of its kind (R3 to R6). Fields that do not belong to the item's kind SHALL be dropped on create and on update. The full field table is in [data-model.md](../../system/data-model.md) 3.9.
- R2. The system SHALL accept exactly four kinds: `concept`, `relation`, `constraint` and `instruction`. Any other kind SHALL be rejected with the message `kind must be one of: concept, relation, constraint, instruction`. The kind of an existing item SHALL NOT change; an update that names a different kind SHALL be rejected with `kind cannot be changed`.
- R3. A **concept** (a business term or the meaning of an enum-like code) SHALL have a name and a description (its definition), and MAY have synonyms (alternate names) and **mappings**. A mapping points at where the concept lives: an entity (a fully-qualified `catalog.schema.table` name), and optionally a column of it and/or a SQL expression. The system SHALL reject a mapping without an entity with `each mapping needs an entity`.
- R4. A **relation** SHALL state how two concepts connect: a `from` concept, a type (`is-a`, `part-of`, `has-many`, `related-to` or `measured-by`) and a `to` concept. A `measured-by` relation SHALL name a governed metric (`metricId`) in place of the `to` concept. `from`, `to` and `metricId` are ids; a relation's name is a label only.
- R5. A **constraint** SHALL have a name, a predicate (a SQL predicate) and MAY have a description (when to apply it), an optional concept it is about (`conceptId`) and entities. It is the default filter the assistant applies to queries.
- R6. An **instruction** SHALL have a name and a description (the standing rule, data quirk or coverage fact) and MAY have entities.
- R7. The system SHALL trim every string, and trim every synonym and entity and drop blanks. An item with no synonyms, mappings or entities SHALL omit those fields. `entities` of a constraint or instruction SHALL be fully-qualified `catalog.schema.table` names.
- R8. The system SHALL require a non-empty name after trimming whitespace: `name is required` on create, `name must not be empty` on update. A concept and an instruction SHALL also require a description: `description is required` on create, `description must not be empty` on update. A constraint SHALL require a predicate: `predicate is required` on create, `predicate must not be empty` on update.
- R9. The system SHALL reject a relation with `from is required` (no from), `type must be one of: is-a, part-of, has-many, related-to, measured-by` (a missing or unknown type), `to is required` (no to, for every type except `measured-by`) and `metricId is required for measured-by` (a `measured-by` relation without a metric).
- R10. The system SHALL check references when an item is created or updated, within the item's own dataset: a `from`, a `to` or a constraint's `conceptId` that is not a concept of the same dataset or a shared concept SHALL be rejected with `Concept "<id>" is not in this ontology`; a `metricId` that names no metric SHALL be rejected with `Metric "<id>" not found`; a mapping whose entity is not in the dataset SHALL be rejected with `Entity "<entity>" is not in dataset "<name>"`. A **shared** item accepts any entity, since it belongs to no dataset.
- R11. An item created through the API or UI, or from a sample's knowledge seed when the sample is loaded ([testing-data](../testing-data/spec.md) R26), SHALL have source `user`; an item created by bootstrap SHALL have source `mined`. The source SHALL NOT change afterwards (an accepted or edited mined item stays `mined`).
- R12. An item created without an explicit enabled flag SHALL be enabled. A mined item SHALL always be created disabled.

Shared items and scope
- R13. An item SHALL belong either to one dataset, identified by the dataset's name, or to none: a **shared** item applies to every dataset. The user SHALL be able to create a shared item by ticking "Share with all datasets" when creating an item; the choice is made at create time. The system SHALL NOT use a datasource-only scope for anything; such snippets are migrated as disabled shared items (R36).
- R14. Listing a dataset's ontology SHALL return the items that belong to the dataset plus every shared item. Kind, source and enabled filters SHALL narrow further. An unrecognised filter value SHALL be ignored, not rejected. A dataset that does not exist SHALL be rejected with `Dataset "<name>" not found` (HTTP 404).
- R15. Listings SHALL be ordered by last-updated time, newest first. Any write to an item (including toggling enabled) SHALL refresh its updated time.
- R16. A dataset that is saved under a name that does not exist yet starts with an empty ontology: saving under a new name does not copy the items of the dataset it was opened from. Re-saving an existing dataset keeps its items.

Authoring
- R17. The user SHALL be able to create, edit, enable/disable and delete items, from the Ontology tab of a saved dataset. Update SHALL be partial: only the fields present in the request are validated and applied, and an omitted field is left unchanged. A present empty list (`synonyms`, `mappings`, `entities`) clears the field.
- R18. Updating or deleting an item that does not exist SHALL fail with `Ontology item <id> not found` (HTTP 404).
- R19. Deleting an item SHALL be permanent and SHALL ask the user for confirmation first. Deleting a **concept** SHALL also delete every relation whose `from` or `to` is that concept, and SHALL clear the `conceptId` of the constraints that name it; the confirmation says so. The constraints themselves stay.
- R20. Deleting a dataset SHALL delete the items that belong to it. Shared items stay. A delete that finds no dataset answers as before ([datasets](../datasets/spec.md) R36).

Reaching the assistant
- R21. For each chat turn the system SHALL assemble a curated-knowledge block from the items that are enabled and either shared or belong to a dataset the session uses. When none apply, no block SHALL be added.
- R22. The block SHALL list the dataset's items before shared ones, and newest-updated first within each group. Each item SHALL render as one line whose format depends on its kind:
  - concept: `- [term] <name>: <description>`, then `; synonyms: a, b` when it has synonyms, then `; entities: <distinct mapping entities in order>` when it has mappings, then `; maps to: <m1>, <m2>` only when some mapping has a column or expression. A mapping renders as `<entity>.<column>`, or `<expression>`, or `<expression> (<entity>.<column>)` when it has both.
  - constraint: `- [default_filter] <name>: <predicate>`, then `; when: <description>` when the description is not empty, then `; entities: …` when it has entities.
  - instruction: `- [instruction] <name>: <description>`, then `; entities: …` when it has entities.
  - relation: `- [relation] <from concept name> <type> <to concept name or metric label>`, then `: <description>` when the description is not empty. A relation whose concept or metric no longer resolves SHALL be skipped.
- R23. The lines of migrated data SHALL be byte-identical to what the snippets rendered before the migration, so an upgraded install sends the assistant the same block for the same session (the `maps to` part only appears for mappings that carry a column or expression, which a migrated concept never has).
- R24. The block SHALL be limited to 7,000 characters of item lines (`KNOWLEDGE_BLOCK_CHARS`; 2,000 until 2026-10-21, raised by round 6 of the improvement loop, BA-242; the header line `Curated dataset knowledge (user-authored — treat as authoritative over anything you infer from schema):` is not counted). The system SHALL stop at the first item that does not fit and SHALL NOT skip ahead to try smaller ones.
- R25. The block SHALL be sent as its own system message after the metric definitions and before the verified reference queries.
- R26. The instructions SHALL be the on-demand `curated-knowledge` skill, which keeps its name: listed in the assistant's skill catalog, loaded by the model with the skill tool when a call carries the block, and never sent with the block or written into the assistant's base prompt. They SHALL tell the assistant to: read the block before planning; treat it as outranking schema inference while never inventing rows the data does not hold; apply every default filter to every query unless the question explicitly asks for the excluded rows, naming the applied filters in one short business sentence; follow every instruction as a standing rule and trust stated coverage facts instead of re-querying them; read `[relation]` lines as how concepts connect (is-a, part-of, has-many, related-to, or measured-by a governed metric) and use them to choose joins and the governed metric, never as rows of data; never list or quote the block unless asked; and fall back to schema and sample values, without inventing definitions, when nothing applies. (Full prompt requirements: [../../system/agents.md](../../system/agents.md).)
- R27. The same block SHALL also be used for background deep-analysis calls and for eval runs, so those see the same ontology as a chat turn.
- R28. The system SHALL record, on each assistant answer, the list of items that were actually included in the block (id, kind, name as `title`, body exactly as shown, and dataset when the item belongs to one). It SHALL be recorded when the block is built, not inferred afterwards, and SHALL contain only items that fit the budget. The stored name of this record stays `knowledge` and its kinds are `term` (a concept), `default_filter` (a constraint), `instruction` and `relation`; the body is the description of a concept or instruction, the predicate of a constraint, and `<from> <type> <to>` of a relation.

Bootstrap (drafting from data)
- R29. The user SHALL be able to ask the system to generate suggestions for the dataset whose Ontology tab is open. The dataset SHALL exist (`Dataset "<name>" not found`; a missing name is `dataset is required`).
- R30. Bootstrap SHALL give the Ontology Bootstrap agent a schema snapshot (limited to 6,000 characters, up to 5 sample values per column), sample rows (up to 5 rows per entity, limited to 4,000 characters in total), the dataset's column references, declared and inferred (limited to 2,000 characters), the governed metrics on the dataset's entities as name, label and entity (limited to 2,000 characters) and the names of the concepts the dataset already has (limited to 1,500 characters). Sampling is best-effort: an entity whose sample fails or does not fit is skipped. A dataset with no stored datasource binding SHALL use the default datasource.
- R31. The agent SHALL be asked for up to 15 drafts in one structured step with no tools (the output format sets no length limit, so a longer reply never fails validation), each a concept (name, description, synonyms, mappings), a relation (from concept name, type, to concept name or metric name), a constraint (name, predicate, description, entities) or an instruction (name, description, entities). The system SHALL skip a malformed draft rather than failing the run, and SHALL keep at most 15 items after the post-processing of R32 has dropped duplicates and unresolved relations.
- R32. The system SHALL post-process the drafts: concepts are inserted first; a relation's concept names are resolved case-insensitively against this run's concepts and the dataset's existing concepts, and its metric name against the governed metrics; a relation that does not resolve, or that relates a concept to itself, is dropped; a mapping to an entity outside the dataset is dropped (and the entities of a constraint or instruction are limited to the dataset's); a draft whose name (case-insensitive) already exists for the same kind in the dataset, or appears earlier in the run, is dropped; a relation that already exists with the same from, type and target is dropped. Every persisted draft SHALL belong to the bootstrapped dataset, have source `mined` and be disabled, with trimmed fields.
- R33. Any failure (LLM error, malformed output, no usable drafts) SHALL surface as `Ontology bootstrap failed: <reason>` (for no usable drafts, `Ontology bootstrap failed: the bootstrap agent returned no usable drafts`) and SHALL persist nothing.
- R34. A bootstrap run SHALL report progress by stage: opening the dataset, reading schema (with table count), sampling rows (n of total tables), drafting, saving (with draft count). It SHALL end with exactly one terminal event, either the created items or an error message.
- R35. Mined items SHALL never be sent to the assistant until a human enables them (Accept, or the Enabled toggle).

Migration
- R36. On the first start after the upgrade the system SHALL copy every knowledge snippet into the ontology, once (migration M15, [data-model.md](../../system/data-model.md) section 6), then rename the old table to `knowledge_snippets_legacy`, kept for one release and read by nothing. A `term` becomes a concept (title to name, body to description, synonyms kept, each entity to a mapping with that entity and nothing else), a `default_filter` becomes a constraint (title to name, body to predicate, no description, entities kept) and an `instruction` stays an instruction (title to name, body to description, entities kept). A snippet scoped to a dataset becomes an item of that dataset; a snippet with no scope becomes a shared item; a snippet scoped only to a datasource, which was never sent to the assistant, becomes a shared item that is **disabled**. Ids, enabled flags (except in that case), sources and timestamps are kept.

Ownership
- R37. Ontology items, including mined suggestions, SHALL belong to the one user (the built-in super admin; the stored `ownerId` is a legacy attribute, [data-model.md](../../system/data-model.md)). Every enabled item is injected into turns. Every ontology action is available.

Graph view
- R38. The Ontology tab's filter row SHALL end with a **Graph** option. Choosing it SHALL replace the item list with a graph of the dataset's ontology (its own and shared items); choosing another option SHALL return to the list. The graph SHALL draw one node per concept, one node per metric that a measured-by relation targets (in a distinct style), and one labelled arrow per relation from its source to its target; a relation whose endpoint no longer exists SHALL be left out. Disabled and pending items SHALL be drawn faded and dashed; shared items SHALL carry an "All datasets" marker. With **Pending suggestions** on, the graph SHALL show only the pending items and the nodes they connect.
- R39. The graph SHALL support pan, zoom (with +, − and Fit controls) and dragging nodes. Selecting a node or arrow (click, or Enter on a focused node) SHALL highlight its neighbours and dim the rest, and SHALL show its details (kind, name, description, mappings or relation, and its Mined, Disabled and All datasets states) with an **Edit** button that opens the item's editor; a metric node shows details only. Clicking empty space or pressing Escape SHALL clear the selection. With no concepts, the graph SHALL show "No concepts to draw yet". The graph is drawn by the app itself, with no graph library.

On the Context page
- R40. The Context page SHALL offer an **Ontologies** card (app-shell R3a) opening a list of every dataset, sorted by name, each with the size of its own ontology ("<n> concepts · <n> relations · …", only the kinds present, or "No ontology yet"), a "<n> pending" chip when it has pending suggestions, and "Could not read this ontology" when its list fails. Shared items are counted once, in a line above the list ("<n> shared item(s) apply to every dataset"), not per dataset. Choosing a dataset SHALL open the same Ontology panel as that dataset's Ontology tab (rules R1-R39 apply unchanged), under an **Ontologies** back control that returns to the list with fresh counts. With no datasets the page SHALL show "No datasets yet".

## Edge cases and errors

- A dataset with no items: the Ontology tab shows "No ontology yet" with a hint and both "New item" and "Generate suggestions" actions.
- Filters that match nothing: "No items match these filters."; with Pending suggestions active and none pending: "No pending suggestions right now — generate some or check back later."
- Backend unreachable on load: the tab shows the error text (`Backend unreachable` when no message is available). On toggle, delete or save failures a toast shows the server message or `Backend unreachable`.
- Bootstrap request fails to start: `Could not generate suggestions (<status>)`; connection failure: `Backend unreachable`; stream closes without a terminal event: `Stream interrupted` or `Stream ended unexpectedly`; empty error: `Could not generate suggestions — try again shortly`.
- Bootstrap yields zero new drafts: toast `No new suggestions this time`.
- A relation that points at a concept that is later deleted is deleted with it (R19), so a relation never dangles. A `measured-by` relation whose metric is deleted stays stored but is skipped in the block and the per-answer record (R22), and shown without its metric label in the tab.
- A shared item with a mapping to an entity that is not in the dataset being viewed is shown as usual; the entity check (R10) is made only against a dataset's own items.
- An item whose line alone exceeds the remaining budget stops the block, so a very long newest item can hide older ones. (Known limitation of newest-first selection; roadmap 1.3.3 replaces it.)
- A dataset opened from the list shows its Ontology tab; a dataset that has not been saved yet has no Ontology tab ([datasets](../datasets/spec.md) R48).

## Contracts

- Endpoints: list and create under a dataset, partial update and delete by item id, bootstrap (single response) and bootstrap stream (server-sent progress, then done or error). See [../../system/api.md](../../system/api.md) 2.8 and 3.4. The UI uses the stream variant only.
- Collection and document shape (ontology item, per-answer knowledge record), the reference rules and migration M15: see [../../system/data-model.md](../../system/data-model.md) 3.9, 3.13 and 6.
- Agents: the Ontology Bootstrap agent (prompt requirements, output schema, draft cap, post-processing) and the assistant's curated-knowledge instructions (the `curated-knowledge` skill) and block format: see [../../system/agents.md](../../system/agents.md) 2.5, 4.1 and Appendix B.
- Decision: [../../system/architecture.md](../../system/architecture.md) ADR-0036.
- Per-answer provenance is stored on the assistant message and read by [../sessions-chat/spec.md](../sessions-chat/spec.md).
- Related: [../datasets/spec.md](../datasets/spec.md) (the editor that hosts the tab, the delete cascade), [../metrics/spec.md](../metrics/spec.md) (the governed metrics a relation can point at; a sibling context block), [../verified-queries/spec.md](../verified-queries/spec.md) (a sibling context block), [../agents-evals/spec.md](../agents-evals/spec.md) (eval runs reuse the block), [../app-shell/spec.md](../app-shell/spec.md) (Context page).

## UI

Placement: the **Ontology** tab of the dataset editor. Opening a saved dataset from the Datasets list shows the editor with two tabs, **Schema** (the catalog browser as before) and **Ontology**; a dataset being created shows no tabs (Schema only) until it is saved and opened again ([datasets](../datasets/spec.md) R48, [../../system/ui.md](../../system/ui.md) 4.3 and 4.8). Before 2026-11-09 (roadmap 1.21.7–1.21.9) this was a Knowledge screen under Context.

- Header: title "Ontology", subtitle "Concepts, relations, constraints and instructions the assistant uses for this dataset. Only enabled items are applied.", and two buttons, "Generate suggestions" and "New item".
- Filter row: kind pills "All", "Concepts", "Relations", "Constraints", "Instructions" (each with a tooltip describing the kind), and a toggle "Pending suggestions" with a count badge of mined, still-disabled items. Choosing a kind leaves the pending view.
- Sections: the list is grouped under the headings Concepts, Relations, Constraints and Instructions (a section with no items under the current filter stays, with "No <section> yet.", e.g. "No relations yet."; a kind filter shows only that kind's section).
- States: loading ("Loading ontology…"), error, empty ("No ontology yet"), filtered-empty, populated.
- Row (normal view): kind icon, name, kind label, a "Mined" badge for mined items, an "All datasets" badge for shared items, a one-line summary (a concept's definition and mapped columns, a relation's `<from> <type> <to or metric>`, a constraint's predicate, an instruction's text), and "Updated <Mon d>"; an Enabled/Disabled checkbox, an Edit button and a Delete button (with a spinner while deleting). Delete asks `Delete “<name>”? The assistant will stop using it.`; for a concept it asks `Delete “<name>”? The assistant will stop using it. Its relations are deleted too.`
- Row (Pending suggestions view): the Enabled checkbox, Edit and Delete are replaced by **Accept** (enables the item; toast "Item enabled") and **Reject** (confirmation "Reject “<name>”? This permanently removes the suggestion."; toast "Item deleted").
- Toasts: "Item enabled" / "Item disabled", "Item created", "Item updated", "Item deleted".
- New/Edit panel ("New item" / "Edit item"): a Kind select (not editable when editing) and the fields of the kind. An existing item is edited **in place**: clicking its Edit button, or anywhere on its name and summary (or Enter on them), turns that row into the editor where it stands, brought fully into view; Cancel or Save turns it back into a row. **New item** opens its editor at the top of the list. In the Graph view the editor opens under the graph (R39).
  - Concept: Name, Definition, Synonyms (comma separated), and **Where it lives in the data** ("The tables and columns this concept means, so the assistant knows where to find it."): each mapping reads as a sentence, `<table> → column <column>`, `<table> → whole table` or `<table> → <expression>`, with the table's short name (its last part, or `schema.table` when two of the dataset's tables share it; full name on hover) and Edit and Remove controls; "Not mapped yet." when there are none. **Add mapping** (or Edit) opens a picker: **Table** (short names), **Points at** — *A column*, *The whole table* or *A SQL expression* — then the Column select or the expression input; **Add**/**Update** waits until the target is complete, **Cancel** leaves the list as it was. One target per mapping: the picker never sends both a column and an expression (a stored mapping with both reads and edits as an expression). Save is disabled while the picker is open.
  - Relation: From concept, Relation (type), then To concept, or Metric when the type is `measured-by` (the metrics on the dataset's entities), and an optional Note.
  - Constraint: Name, Predicate, When to apply (optional), Concept (optional) and Entities (optional).
  - Instruction: Name, Text and Entities (optional).
  - A "Share with all datasets" checkbox, only when creating. Buttons "Cancel" and "Create item" / "Save changes" (disabled until the required fields of the kind are filled; shows "Saving…"). A server message (for example an unresolved concept) is shown inline. The panel does not edit the enabled flag; new items are enabled.
- Generate suggestions panel: explanation ("The assistant reviews this dataset and drafts concepts, relations, constraints and instructions as pending suggestions — nothing is applied until you approve it. This can take up to a minute."), "Cancel" and "Generate" (shows "Generating…"; cancel is blocked while running). There is no dataset picker: it runs on the open dataset. A live progress list shows finished stages with a check mark and the current stage with a spinner. On success the panel closes, a toast reads "<n> suggestion(s) generated — review in Pending suggestions", and the tab switches to the Pending suggestions view.
- In chat: each assistant answer that carried ontology items shows a collapsed "Ontology in context (<n>)" disclosure listing, per item, its kind label (Concept, Constraint, Instruction or Relation), name, dataset (or "all datasets" for a shared item) and body, plus the note "The dataset ontology the assistant was given before answering. Edit it in the dataset's Ontology tab; disabled items are never included." Clarification cards show it too.

## Flows

E2E: `frontend/e2e/dataset-ontology.spec.ts` (the upgrade migration is covered API-level in `backend/test/app.e2e-spec.ts`; the two chat scenarios, "An answer lists the ontology it was given" and "Disabled items are never sent", and "Pending suggestions are faded in the graph" are not covered yet).

```gherkin
Feature: Dataset ontology

  Scenario: Open the Ontology tab of a saved dataset
    Given a dataset "world_cup" exists with no ontology items
    When I open "world_cup" from the Datasets list
    Then I see the tabs "Schema" and "Ontology"
    When I click the "Ontology" tab
    Then I see "No ontology yet"
    And I see the actions "New item" and "Generate suggestions"

  Scenario: A new dataset has no tabs
    When I click "New dataset"
    Then I see the catalog browser and no "Ontology" tab

  Scenario: Create a concept with column mappings
    Given I am on the Ontology tab of "world_cup"
    When I click "New item" and choose Kind "Concept"
    And I fill Name with "Match" and Definition with "One played fixture"
    And I click "Add mapping", choose the entity "public.matches" and the column "id"
    And I click "Create item"
    Then I see the toast "Item created"
    And "Match" is listed under "Concepts" as "Enabled"
    And its summary shows the mapping "public.matches.id"

  Scenario: Create a relation and a measured-by relation
    Given the concepts "Match" and "Goal" exist in "world_cup" and a metric "goals_total" exists
    When I click "New item", choose Kind "Relation", From concept "Match", Relation "has-many" and To concept "Goal"
    And I click "Create item"
    Then "Match has-many Goal" is listed under "Relations"
    When I create a relation with From concept "Goal", Relation "measured-by" and Metric "goals_total"
    Then the relation is listed with the metric's label

  Scenario: Create a constraint
    Given I am on the Ontology tab of "world_cup"
    When I click "New item", choose Kind "Constraint"
    And I fill Name with "Exclude friendlies" and Predicate with "stage <> 'friendly'"
    And I click "Create item"
    Then "Exclude friendlies" is listed under "Constraints" as "Enabled"

  Scenario: A shared item appears in another dataset's tab
    Given I am on the Ontology tab of "world_cup"
    When I create an instruction "Currency" with Text "All amounts are in USD" and tick "Share with all datasets"
    And I open the Ontology tab of another dataset "finance"
    Then I see "Currency" with the badge "All datasets"

  Scenario: Validation messages
    Given the "New item" panel is open
    When Kind is "Concept" and Name is blank
    Then "Create item" is disabled
    When I choose a mapping entity that is not in the dataset through the API
    Then the request fails with 'Entity "<entity>" is not in dataset "world_cup"'
    When I create a relation whose From concept is not in this ontology through the API
    Then the request fails with 'Concept "<id>" is not in this ontology'

  Scenario: Edit an item
    Given a concept "Match" exists
    When I click its row
    Then its editor opens in place of that row, not at the top of the list
    When I change the Definition and click "Save changes"
    Then I see the toast "Item updated"
    And the list shows the new definition

  Scenario: Disable an item so the assistant stops using it
    Given an enabled item exists
    When I untick its "Enabled" checkbox
    Then I see the toast "Item disabled"
    And the checkbox label reads "Disabled"

  Scenario: Delete a concept deletes its relations
    Given the concepts "Match" and "Goal" and the relation "Match has-many Goal" exist
    When I click Delete on "Match"
    Then I am asked 'Delete “Match”? The assistant will stop using it. Its relations are deleted too.'
    When I confirm
    Then I see the toast "Item deleted"
    And "Match" and "Match has-many Goal" are no longer listed
    And "Goal" is still listed

  Scenario: Generate suggestions from the dataset
    Given a dataset "world_cup" exists and an LLM is configured
    When I click "Generate suggestions" on its Ontology tab and click "Generate"
    Then I see a progress list naming each stage, ending with "Saving <n> drafts for review"
    And a toast says "<n> suggestions generated — review in Pending suggestions"
    And I am shown the Pending suggestions view
    And each suggestion is badged "Mined" and is not enabled

  Scenario: Accept a pending suggestion
    Given the Pending suggestions view lists a mined suggestion
    When I click "Accept"
    Then I see the toast "Item enabled"
    And it leaves the Pending suggestions view and appears as "Enabled" in the full list

  Scenario: Reject a pending suggestion
    Given the Pending suggestions view lists a mined suggestion
    When I click "Reject" and confirm
    Then the suggestion is permanently deleted

  Scenario: Generation fails
    Given the language model is unreachable
    When I click "Generate" in the Generate suggestions panel
    Then an error toast appears
    And no suggestion is added

  Scenario: Migrated snippets appear as ontology items after an upgrade
    Given an install had a "term" snippet scoped to "world_cup" and a global "default_filter" snippet
    When I upgrade and open the Ontology tab of "world_cup"
    Then I see the term as a concept of "world_cup"
    And I see the default filter as a constraint with the badge "All datasets"

  Scenario: An answer lists the ontology it was given
    Given an enabled concept of the session's dataset exists
    When I ask a question in a session using that dataset
    Then the assistant's answer has an "Ontology in context (1)" disclosure
    And expanding it shows the concept's name and body

  Scenario: Disabled items are never sent
    Given a disabled item exists for the session's dataset
    When I ask a question in that session
    Then no "Ontology in context" disclosure lists that item
  Scenario: See the ontology as a graph
    Given the dataset "World Cup" has the concepts "Match" and "Tournament" and the relation "Match part-of Tournament"
    When I open its Ontology tab and choose "Graph" in the filter row
    Then I see a node "Match" and a node "Tournament" joined by an arrow labelled "part-of"
    And choosing "All" shows the list again

  Scenario: Pending suggestions are faded in the graph
    Given generated suggestions are pending for "World Cup"
    When I choose "Graph"
    Then the pending concepts and relations are drawn faded and dashed
    And turning on "Pending suggestions" shows only the pending items

  Scenario: Edit a concept from the graph
    Given the graph of "World Cup" is shown
    When I click the node "Match"
    Then its neighbours are highlighted and its details are shown
    And clicking "Edit" opens the concept editor for "Match"

  Scenario: Review every dataset's ontology from Context
    Given "World Cup" has 10 concepts and 5 relations, all pending, and "Formula 1" has none
    When I open "Context" and click the "Ontologies" card
    Then I see "World Cup" with "10 concepts · 5 relations" and "15 pending", and "Formula 1" with "No ontology yet"
    When I click "World Cup"
    Then I see its Ontology panel under an "Ontologies" back control
    And it is the same as the Ontology tab of the "World Cup" dataset

```

## Acceptance

- Every Gherkin scenario above passes against the running app (backend tests cover R1-R36 at service level).
- With an item enabled for a dataset, an answer in a session over that dataset records it in "Ontology in context"; after disabling or deleting it, the next answer does not.
- With a constraint enabled, the generated SQL applies it and the answer names it.
- An install with knowledge snippets starts, after the upgrade, with the same items and the same block per session as before (byte-identical lines); the old table remains as `knowledge_snippets_legacy`.
- Every validation message in R2, R3, R8, R9, R10, R18 and R33 and the cascades in R19 and R20 have a unit test.
- A bootstrap run on the sample dataset yields at most 15 disabled, mined, dataset-owned drafts, none duplicates an existing name of its kind for that dataset, every relation resolves, and every mapping is to an entity of the dataset.
- Not built (roadmap): retrieval by question relevance and SQL checks against the ontology (1.3.3); mining from past sessions and thumbs-up answers, conflict detection and correction feedback (1.3.4).

## Open questions

- Open question (2026-10-16, BA-188, for [BA-4](../../epics/BA-4/spec.md)): the knowledge seed of each domain sample ([testing-data](../testing-data/spec.md) R26) is 3,760 to 6,143 characters, so the 2,000-character block (R24) sent only its first few entries (its default filters and instructions first, by creation order). Raise the budget, or choose entries by relevance to the question rather than by update time? Partly answered on 2026-10-21: the budget is 7,000 characters, so a seed of that size goes in whole (BA-242 round 6, kept by the user; at 2,000 the Finance seed sent 3 of its 12 entries). Choosing entries by relevance stays open for BA-4 ([BA-80](https://halo-powered.atlassian.net/browse/BA-80)).
- Open question: a `measured-by` relation whose metric is deleted stays stored but is never sent. Should deleting a metric delete its relations, as deleting a concept does?
- Open question: "Share with all datasets" is chosen at create time only; an existing item cannot be moved between a dataset and shared. Intended?
- Open question: the "Pending suggestions" view hides the Edit action; a mined suggestion can only be edited after it is accepted. Intended?
- Open question: the non-streaming bootstrap endpoint exists but nothing in the UI calls it. Keep it as part of the public contract?

<!-- sources: backend/src/modules/ontology/**, backend/src/mastra/agents/knowledge-bootstrap.agent.ts, backend/src/mastra/skills/curated-knowledge/SKILL.md, backend/src/mastra/context-blocks.ts (knowledgeContext), backend/src/modules/sessions/sessions.service.ts (agentContext, knowledgeUsed), backend/src/modules/agents/eval-runs.service.ts, backend/src/infrastructure/database/database.module.ts (M15), frontend/src/app/features/ontology/**, frontend/src/app/features/datasets/components/catalog-browser, frontend/src/app/features/sessions/components/session-chat/session-chat.html (knowledgeApplied) -->

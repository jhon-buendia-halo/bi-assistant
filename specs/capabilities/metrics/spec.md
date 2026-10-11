# Metrics

Analysts define each business number once: a named metric over one entity of a dataset's data model, so "denial rate" means the same thing in every answer. A metric is either a portable aggregation (sum, count, average… of an attribute, optionally filtered, or a ratio of two other metrics) or a SQL expression. Metrics live in the dataset's [data model](../data-model/spec.md) and are curated in its **Metrics** tab; they can be started from an approved (verified) answer. The assistant computes a metric by naming it in a logical query, and the compiler expands its definition, so the number is never re-derived turn by turn.

This is a lightweight semantic layer owned by the app: it does not depend on any datasource feature such as governed metric views. Metrics created before data models existed sit in a **legacy store**, which is now import-only: its metrics are imported into the models (R18).

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): metric, data model, entity, attribute, dataset, datasource, dimension, verified query, assistant, logical query.

Capability-local vocabulary:
- **Model metric** — a metric stored in a data model version (R1). The editor of record.
- **Legacy metric** — a metric in the pre-data-model store: a flat SQL expression over a physical table `catalog.schema.table`, private to its owner in org server mode (R15).
- **Candidate** — a prefilled metric draft offered from a verified query (R10).
- **Author** — in org server mode, the user who defined a metric: the creator of the legacy metric it was imported from, or the user who created it in the Metrics tab (R14).

## Rules

### Model metrics

- R1. A model metric SHALL have a name (its handle), a label, an optional description, one entity (a logical entity name of the model), and optionally: an aggregation (`sum`, `count`, `count_distinct`, `avg`, `min`, `max` or `ratio`), the attribute it aggregates (`of`), a numerator and a denominator (names of other metrics, for `ratio`), a filter (`where`: a predicate tree of `and`, `or`, `not` and `{ attribute, operator, value }` conditions, operators `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `between`, `is_null`, `not_null`, `contains`, `starts_with`), dimensions (attribute names), a SQL expression, the verified query it was promoted from, and its author (R14).
- R2. The name SHALL be trimmed and lowercased, and SHALL match `^[a-z][a-z0-9_]*$` (`must be lowercase, start with a letter: ^[a-z][a-z0-9_]*$`). Names SHALL be unique within the model, ignoring case (`duplicate metric name "<name>" (case-insensitive)`). The label and the entity SHALL NOT be empty.
- R3. A metric SHALL have an aggregation or a SQL expression (`metric "<name>" needs "agg" or "expressions.sql"`). An aggregation other than `count` and `ratio` SHALL name its attribute (`metric "<name>" has agg "<agg>" and needs "of"`). A `ratio` SHALL name a numerator and a denominator (`… has agg "ratio" and needs "<field>"`) that are other metrics of the model (`… references unknown metric "<operand>" as its <field>`), never itself (`… cannot use itself as its own <field>`), and ratios SHALL NOT form a cycle (`ratio cycle detected: a -> b -> a`).
- R4. The entity, the aggregated attribute, every dimension and every attribute of the filter SHALL exist in the model (`metric "<name>" references unknown entity "<entity>"`, `metric "<name>" references unknown attribute "<attribute>" on entity "<entity>"`, `metric "<name>" where-clause references unknown attribute …`).
- R5. Creating, changing (addressed by its current name; the change may rename it) and deleting a model metric SHALL each validate the whole model ([data-model](../data-model/spec.md) R11) and append one version with source `user` and the note `metric <name> added`, `metric <name> updated` or `metric <name> removed`. A failure SHALL answer the issues and leave the current version unchanged. Changing or deleting a name the current version does not have SHALL fail with `Metric "<name>" not found on dataset "<dataset>"`. Deleting a metric that another metric's ratio still uses SHALL be rejected.
- R6. A name created or changed through the Metrics tab SHALL become **model-managed**: a later write of that name to the legacy store never changes the model's metric. A deleted name SHALL be **tombstoned**: Bootstrap from snapshot, a re-save merge, the metrics import and legacy writes never bring it back. Creating or renaming a metric to a tombstoned name lifts the tombstone.
- R7. Listing a model's metrics SHALL return the current version's metrics in model order. Metrics MAY also be edited in the model's YAML ([data-model](../data-model/spec.md) R23); that path follows R2-R4 but does not mark names as model-managed.

### Reaching the assistant

- R8. Metrics SHALL reach the assistant inside the data model block of each turn, on their entity, as `<name> (<label>) = <formula>`. The assistant computes a metric by selecting it by name in a logical query; the compiler expands its definition ([data-model](../data-model/spec.md) R31). The block, its budget and the tools: [../../system/agents.md](../../system/agents.md).
- R9. The former governed-metrics block SHALL be built only for the eval `legacy` path (the assistant that writes SQL, kept for comparison runs). Its header is "Governed metric definitions (curated — ALWAYS prefer these exact expressions when the question asks for the metric):"; each metric is one line `- <label> (<name>) on <entity>: <expression>`, then `; dimensions: …` and `; <description>` when present; it stops at the first metric that does not fit 4,000 characters. For a table that a model binds it reads that model's current metrics (an aggregation is rendered as its SQL text); only for a table no model binds does it read the legacy store.

### Promotion from verified queries

- R10. For a dataset, the system SHALL offer up to 12 candidates, one per verified query that has at least one entity, whose first entity is a table the dataset's current model binds, and that is not already the source of a legacy metric or of a metric in any data model. A candidate SHALL carry: the verified query id, a suggested name (the approved question as a slug: lowercase, non-alphanumerics become `_`, trimmed, at most 64 characters; empty when it cannot form a valid name), a suggested label (the approved question), the entity as the model's logical name, the datasource when known, and the approved SQL.
- R11. A candidate SHALL NOT supply an expression. A whole statement is not an aggregation, so the user lifts it out of the shown SQL; the system SHALL NOT guess it.
- R12. Saving a metric started from a candidate SHALL store the verified query id as its source, and that verified query SHALL stop being offered, for every dataset.

### Sharing (org server mode)

- R13. In org server mode model metrics SHALL be shared with the data model that holds them ([data-model](../data-model/spec.md) R37): every signed-in user sees them and every user's turns use them. Listing metrics and candidates SHALL need Use agents; creating, changing and deleting them SHALL need Manage datasources and datasets ([data-model](../data-model/spec.md) R38, R39), and the Metrics tab hides its write controls without it (R40 there).
- R14. In org server mode every model metric SHALL record its **author**: a metric imported from the legacy store, the owner who created the legacy metric; a metric created in the Metrics tab (a promoted candidate included), the signed-in user who created it (their owner key). Changing a metric SHALL keep its author; the editor is not recorded. In local mode no author is recorded. A metric added through the YAML keeps whatever author the YAML gives it. The Metrics tab SHALL show a metric's author when it has one.

### Legacy store (import-only)

- R15. The legacy store SHALL keep the metrics created before data models existed: an id, a name, a label, an optional description, one physical entity `catalog.schema.table`, an optional datasource id, a SQL expression, optional dimensions, an optional source verified query and timestamps. No screen reads or writes it; its endpoints remain for compatibility. In org server mode each legacy metric is private to its owner and names are unique per owner ([../admin/spec.md](../admin/spec.md) R29, R31); every legacy action needs Use agents.
- R16. A legacy write SHALL validate as before data models: name trimmed, lowercased, starting with a letter, only lowercase letters, digits and underscores, at most 64 characters (`Metric name is required`, `Metric name must be 64 characters or fewer`, `Metric name must be lowercase letters, digits and underscores, starting with a letter (e.g. denial_rate)`); label, entity and expression required (`Metric label is required`, `Metric entity is required`, `Metric expression is required`); an expression with a semicolon rejected (`Metric expression must be a single SQL expression (no semicolons)`); a name used by another of the owner's metrics rejected (`Metric "<name>" already exists`). Dimensions and description are trimmed; blank ones are dropped.
- R17. A legacy update SHALL replace the metric from the full submitted definition, removing optional fields not submitted; updating or deleting an unknown id SHALL fail with `Metric <id> not found`. Legacy metrics SHALL be listed newest-updated first, optionally scoped to a set of entities (case-insensitive).
- R18. Legacy metrics SHALL reach the models only through the metrics import and the legacy-write mirror: every owner's metrics, first by creation time then id per lowercase name, the rest reported as skipped, and a legacy write of a name the model holds from another author skipped and reported ([data-model](../data-model/spec.md) R34-R36).

## Edge cases and errors

- A validation failure in the Metrics tab is shown inside the form as a list of `<path> — <message>` lines; the form stays open and the version does not change. A failure without issues toasts the server message (`Backend unreachable` when there is none).
- The model has no entities (rare: a dataset needs at least one): **New metric** is disabled with the title "This model has no entities yet"; the Entity select reads "No entities in model".
- No metric in the model: "No metrics yet — define one so “denial rate” always means the same thing."
- Loading the metrics fails: the tab shows the server message (`Backend unreachable` if none). A failing candidates request is silent: the suggestions simply do not appear.
- A metric the form cannot represent (a compound filter, or both an aggregation and a SQL expression) opens read-only with the note "Advanced definition — edit in the YAML tab. …"; it is edited in the YAML tab.
- Deleting asks "Delete the metric “<label>”?" then "Answers will stop reusing its definition."; a failed delete toasts `Delete failed` or the server message.
- **Create metric** / **Save changes** stays disabled until Label, Name and Entity are filled and, in Aggregation mode, the Attribute (for every aggregation but `count` and `ratio`) or both ratio operands; in SQL expression mode, the expression.
- A legacy metric whose table no dataset includes is in no model; it is imported once a dataset that includes its table is saved.
- Two legacy metrics with the same name over the tables of one model (two owners, or one owner differing only in case): the earliest is imported, the others are reported as skipped and the data model header shows the metrics-import chip ([data-model](../data-model/spec.md) R35).

## Contracts

- Model metric endpoints (list, create, change, delete, candidates) in [../../system/api.md](../../system/api.md) section 2.16; the import-only legacy endpoints in section 2.4; permissions in section 1.9.
- The metric's place in the `data_models` document, the model-managed and deleted name lists and the metrics-import report: [../../system/data-model.md](../../system/data-model.md) section 3.16. The legacy `metrics` collection and the startup import: the same file, its `metrics` section and the Migrations table.
- The model block and the eval `legacy` path: [../../system/agents.md](../../system/agents.md).
- [data-model](../data-model/spec.md) (validation, versions, import rules), [verified-queries](../verified-queries/spec.md) (candidate source), [knowledge](../knowledge/spec.md) (a sibling context block).

## UI

The **Metrics** tab of the Data model view ([data-model](../data-model/spec.md)); layout, test ids and copy in [../../system/ui.md](../../system/ui.md) section 4.19.5. The catalog browser no longer has a metrics panel; it shows the note "Metrics are defined in the dataset's data model after saving." (ui.md 4.3).

- Header "Metrics" with "Curated definitions, stored directly in the data model. Answers reuse these expressions verbatim instead of re-deriving the number each turn." and a **New metric** button (hidden while the form is open).
- States: loading ("Loading metrics…"), error, empty, populated.
- Row: gauge icon, label, name, entity, the definition (`<agg>(<attribute>)` or the SQL expression), "by <dimensions>" when present, the author when recorded, **Edit** and **Delete**.
- **Promote a verified answer**: when the form is closed and candidates exist, one button per candidate showing the approved question (tooltip = the approved SQL). Clicking one opens the form in SQL expression mode with Label, Name and Entity filled, the description "Promoted from verified query: <sql>" and an empty expression.
- Form ("New metric" / "Edit metric"): Label, Name, Entity, an **Aggregation** / **SQL expression** switch, then Aggregation and Attribute (or Numerator metric and Denominator metric for a ratio) or the SQL expression; Dimensions as toggles of the entity's attributes; an optional single-condition **Filter (where)**; Description; **Cancel** and **Create metric** / **Save changes**. **New metric** defaults the entity to the model's first entity.
- Toasts: `Metric "<label>" saved` (create and change), `Metric "<label>" deleted`.
- Without Manage datasources and datasets: no **New metric**, **Edit**, **Delete** or **Promote a verified answer** ([data-model](../data-model/spec.md) R40).

## Flows

### Feature: Metrics tab

E2E: none yet.

The automated scenario "Defines a metric in the Metrics tab" lives in [data-model, Feature: Data model editing](../data-model/spec.md#feature-data-model-editing) (E2E `frontend/e2e/data-model-editing.spec.ts`). The scenarios below replace the former catalog-browser "Metrics panel" Feature.

```gherkin
Feature: Metrics tab

  Background:
    Given the "World Cup Core" dataset includes the "matches" table
    And I am on the "Metrics" tab of the "World Cup Core" data model

  Scenario: Define an aggregation metric
    When I click "New metric"
    And I fill Label "Average attendance", Name "avg_attendance", Entity "matches"
    And I choose the aggregation "avg" of the attribute "attendance"
    And I click "Create metric"
    Then I see the toast 'Metric "Average attendance" saved'
    And "Average attendance" is listed with the name "avg_attendance", the entity "matches" and "avg(attendance)"
    And the version badge advances with source "user"

  Scenario: Required fields
    Given the "New metric" form is open
    When Label, Name or Entity is empty, or the aggregation "avg" has no attribute
    Then "Create metric" is disabled

  Scenario: Invalid name is rejected
    Given the "New metric" form is open
    When I enter Name "Average Attendance" with a space and submit
    Then the form shows the error "must be lowercase, start with a letter: ^[a-z][a-z0-9_]*$"
    And the version badge is unchanged

  Scenario: Duplicate name is rejected
    Given the metric "avg_attendance" exists in the model
    When I create another metric named "avg_attendance"
    Then the form shows the error 'duplicate metric name "avg_attendance" (case-insensitive)'

  Scenario: Edit a metric
    Given the metric "Average attendance" is listed
    When I click its Edit button, change the Description, and click "Save changes"
    Then I see the toast 'Metric "Average attendance" saved'
    And the version badge advances

  Scenario: Delete a metric
    Given the metric "Average attendance" is listed
    When I click its Delete button and confirm
    Then I see the toast 'Metric "Average attendance" deleted'
    And it is no longer listed
    When I click "Bootstrap from snapshot"
    Then "Average attendance" is still not listed

  Scenario: An advanced metric opens read-only
    Given the model's YAML defines a metric whose filter combines two conditions with "and"
    When I click its Edit button
    Then I see "Advanced definition — edit in the YAML tab."
    And every field of the form is disabled

  Scenario: Promote a verified answer
    Given I approved an answer whose SQL ran over the "matches" table
    Then I see "Promote a verified answer" with a button showing my approved question
    When I click it
    Then the form opens in SQL expression mode with Label and Name filled, Entity "matches", and an empty SQL expression
    When I enter an expression and click "Create metric"
    Then that approved question is no longer offered under "Promote a verified answer"

  Scenario: Imported metrics show their author and the clashes
    Given the app runs in org server mode
    And "ada@contoso.test" and then "grace@contoso.test" each created a legacy metric "avg_attendance" on the "matches" table before the data model existed
    When I open the "Metrics" tab of the "World Cup Core" data model
    Then "avg_attendance" is listed once, with Ada as its author
    And the header shows "1 metric skipped on import"

  Scenario: A metric created in the Metrics tab records who created it
    Given the app runs in org server mode and I am signed in as "grace@contoso.test" with Manage datasources and datasets
    When I create the metric "Max attendance" ("max_attendance", "max" of "attendance" on "matches")
    Then "Max attendance" is listed with me as its author
    When "ada@contoso.test" edits its description and saves
    Then "Max attendance" is still listed with me as its author

  Scenario: The assistant reuses the metric
    Given the metric "avg_attendance" exists in the model of the session's dataset
    When I ask "What was the average attendance per tournament?"
    Then the assistant's logical query selects the metric "avg_attendance"
```

## Acceptance

- The scenario "Defines a metric in the Metrics tab" passes ([data-model](../data-model/spec.md)); the scenarios above behave as written once automated. Backend tests cover model metric validation (R2-R4), each write as a version and the delete rules (R5, R6), candidate scoping, slugging and exclusion (R10-R12), the legacy validation (R16, R17) and the import and mirror rules (R18).
- A turn in a session whose dataset's model holds the metric shows the metric in the model block; a logical query selecting it compiles to the metric's definition.
- In org server mode every user sees the same model metrics, a User cannot change them (HTTP 403), and imported metrics and metrics created in the Metrics tab carry their author, kept on edit.

## Open questions

- Open question: roadmap Milestone 1.3 (Knowledge Store, BA-4) plans to link metrics, verified queries and relationships to concepts (1.3.2); none of that linkage exists yet beyond the metric's source verified-query id.
- Open question: metrics are not shown anywhere in chat provenance (unlike knowledge snippets), so a reader cannot tell which metric an answer used beyond the logical query's `select`.

<!-- sources: backend/src/modules/data-models/schema/data-model.schema.ts (metric schema and rules), backend/src/modules/data-models/data-models.service.ts (model metrics, import, mirror), backend/src/modules/data-models/bootstrap.ts (toModelMetric), backend/src/modules/metrics/** (legacy store, candidates, legacy block), frontend/src/app/features/data-model/components/model-metrics-panel/** -->

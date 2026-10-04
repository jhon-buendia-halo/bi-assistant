# Metrics

Analysts define each business number once: a named metric with a SQL aggregation expression over one entity, so "denial rate" means the same thing in every answer. The assistant is told to reuse these expressions verbatim instead of re-deriving the number each turn. Metrics are managed in a **Metrics** panel at the bottom of the dataset editor, scoped to the entities currently included in the dataset, and can be started from an approved (verified) answer.

This is a lightweight semantic layer owned by the app: it does not depend on any datasource feature such as governed metric views.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): metric, entity, dataset, datasource, dimension, verified query, assistant.

## Rules

Shape and validation
- R1. The system SHALL store each metric with: a unique id, a name (handle), a label, an optional description, one entity, an optional datasource id, a SQL expression, optional dimensions, an optional source verified-query id (provenance), and created/updated timestamps.
- R2. The name SHALL be trimmed and lowercased, SHALL start with a letter, SHALL contain only lowercase letters, digits and underscores, and SHALL be at most 64 characters. Violations are rejected with: `Metric name is required`, `Metric name must be 64 characters or fewer`, or `Metric name must be lowercase letters, digits and underscores, starting with a letter (e.g. denial_rate)`.
- R3. The label, entity and expression SHALL be required after trimming (`Metric label is required`, `Metric entity is required`, `Metric expression is required`).
- R4. The expression SHALL be a single SQL expression; one containing a semicolon SHALL be rejected with `Metric expression must be a single SQL expression (no semicolons)`, because it is inlined into generated statements.
- R5. Names SHALL be unique across all metrics (`Metric "<name>" already exists`); renaming a metric to its own current name is not a clash.
- R6. Dimensions and description SHALL be trimmed; blank dimensions are dropped and an empty description or dimension list SHALL be omitted.
- R7. Updating a metric SHALL replace it from the full submitted definition: an optional field not submitted (description, dimensions, datasource, source verified query) SHALL be removed from the stored metric, not left stale. Updating or deleting an unknown id SHALL fail with `Metric <id> not found`.
- R8. Metrics SHALL be listed newest-updated first. A list MAY be scoped to a set of entities (case-insensitive match on the metric's entity); a list request with no entities SHALL return all metrics.

Reaching the assistant
- R9. For each chat turn the system SHALL assemble a governed-metrics block from metrics whose entity is one of the entities of the session's datasets. When none apply, no block SHALL be added.
- R10. Each metric SHALL render as one line: `- <label> (<name>) on <entity>: <expression>`, then `; dimensions: …` and `; <description>` when present. The block header SHALL be "Governed metric definitions (curated — ALWAYS prefer these exact expressions when the question asks for the metric):". The block SHALL be limited to 4,000 characters, stopping at the first metric that does not fit.
- R11. The block SHALL be the first system message after the entity orientation, before the knowledge block and the verified reference queries. It SHALL be present in deep-analysis calls as well.

Promotion from verified queries
- R12. The system SHALL offer up to 12 prefilled drafts ("candidates"), one per verified query that has at least one entity and is not already the source of a metric. A candidate SHALL carry: the verified query id, a suggested name (the approved question as a slug: lowercase, non-alphanumerics become `_`, trimmed, at most 64 characters; empty when it cannot form a valid name), a suggested label (the approved question), the first entity, the datasource when known, and the approved SQL.
- R13. Candidates MAY be scoped to entities like metrics; scoped, only candidates whose entity is in scope SHALL be returned.
- R14. A candidate SHALL NOT supply an expression. A whole statement is not an aggregation, so the user lifts the aggregation out of the shown SQL; the system SHALL NOT guess it.
- R15. Saving a metric started from a candidate SHALL store the verified-query id as its source, and that candidate SHALL stop being offered.

## Edge cases and errors

- Validation failures are returned as a failure result with the message (the request itself succeeds); the UI shows the message in an error toast and keeps the form open.
- Backend unreachable on list: the panel shows the message (`Backend unreachable` if none). A failing candidates request is silent: the suggestions simply do not appear.
- No entities included in the dataset: "New metric" is disabled (tooltip "Include at least one entity first"). Because an unscoped list returns every metric (R8), the panel then lists all existing metrics; only when none exist at all does it show "Include entities above to define metrics over them."
- Entities included but no metric: "No metrics yet for these entities — define one so “denial rate” always means the same thing."
- The entity picker offers the included entities; when editing a metric whose entity was later excluded, that entity is still offered so the value is not lost. With none: "No entities included".
- Deleting a metric asks first and, on success, also closes the form if that metric was being edited.
- The metric's stored datasource is the datasource currently selected in the dataset editor at save time; it is dropped when editing under no datasource.
- A metric is bound to its entity by name only; if the entity is not in any dataset used by a session, the metric is not injected there.

## Contracts

- Endpoints: list (optionally by entities), candidates (optionally by entities), create, replace, delete, all under the metrics resource; mutations answer with a success flag, message and the metric. See [../../system/api.md](../../system/api.md).
- Collection `metrics` and the metric document: see [../../system/data-model.md](../../system/data-model.md).
- The assistant's use of the block: see [../../system/agents.md](../../system/agents.md).
- Verified queries (candidate source): [../verified-queries/spec.md](../verified-queries/spec.md). Dataset editor hosting the panel: [../datasets/spec.md](../datasets/spec.md). Sibling context blocks: [../knowledge/spec.md](../knowledge/spec.md).

## UI

Lives at the bottom of the dataset editor ("New dataset" / "Edit dataset", opened from the **Datasets** sidebar item), under a divider below the catalog browser (see [../../system/ui.md](../../system/ui.md)). The panel re-reads whenever the set of included entities changes.

- Header "Metrics" with the text "Curated definitions for the entities included above. Answers reuse these expressions verbatim instead of re-deriving the number each turn." and a "New metric" button (hidden while the form is open).
- States: loading ("Loading metrics…"), error, empty (two variants above), populated.
- Row: gauge icon, label, name, short entity (last segment of the fully-qualified name), the expression, "by <dimensions>" when present, an Edit button and a Delete button (spinner while deleting). Delete asks "Delete the metric “<label>”? Answers will stop reusing its definition."
- "Promote a verified answer": when the form is closed and candidates exist, a row of buttons, one per candidate, showing the approved question (tooltip = the approved SQL). Clicking one opens the form prefilled (label, name, entity, description "Promoted from verified query: <sql>", empty expression).
- Form ("New metric" / "Edit metric"): Label (placeholder "Denial rate"), Name (placeholder "denial_rate"), Entity (select), Expression (placeholder "SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)"), Dimensions (comma separated, placeholder "month, provider, plan"), Description. "Cancel" and "Create metric" / "Save changes" (disabled until label, name, entity and expression are filled; shows "Saving…"). New metric defaults the entity to the first included entity.
- Toasts: the server message, e.g. `Metric "Denial rate" saved`, `Metric "Denial rate" updated`, `Metric "Denial rate" deleted`.

## Flows

E2E: none yet.

```gherkin
Feature: Metrics panel (E2E: none yet)

  Scenario: Define a metric
    Given I am editing a dataset that includes the entity "claims"
    When I click "New metric"
    And I fill Label "Denial rate", Name "denial_rate", Entity "claims"
    And I fill Expression "SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)"
    And I click "Create metric"
    Then I see the toast 'Metric "Denial rate" saved'
    And "Denial rate" is listed with the name "denial_rate" and the entity "claims"

  Scenario: Metrics need an included entity
    Given no metrics exist
    And I am editing a dataset with no entities included
    Then I see "Include entities above to define metrics over them."
    And "New metric" is disabled

  Scenario: Required fields
    Given the "New metric" form is open
    When Label, Name, Entity or Expression is empty
    Then "Create metric" is disabled

  Scenario: Invalid name is rejected
    Given the "New metric" form is open
    When I enter Name "Denial Rate" with a space or capital letter and submit
    Then I see an error toast about lowercase letters, digits and underscores

  Scenario: Duplicate name is rejected
    Given a metric "denial_rate" exists
    When I create another metric named "denial_rate"
    Then I see the error toast 'Metric "denial_rate" already exists'

  Scenario: Expressions cannot chain statements
    Given the "New metric" form is open
    When I enter an Expression containing ";" and submit
    Then I see the error toast "Metric expression must be a single SQL expression (no semicolons)"

  Scenario: Edit a metric
    Given a metric "Denial rate" is listed
    When I click its Edit button, change the Description, and click "Save changes"
    Then I see the toast 'Metric "Denial rate" updated'

  Scenario: Delete a metric
    Given a metric "Denial rate" is listed
    When I click its Delete button and confirm
    Then I see the toast 'Metric "Denial rate" deleted'
    And it is no longer listed

  Scenario: Promote a verified answer
    Given I approved an answer whose SQL ran over the entity "claims"
    And I am editing a dataset that includes "claims"
    Then I see "Promote a verified answer" with a button showing my approved question
    When I click it
    Then the form opens with Label and Name filled, Entity "claims", and an empty Expression
    When I enter an Expression and click "Create metric"
    Then that approved question is no longer offered under "Promote a verified answer"

  Scenario: The assistant reuses the metric
    Given a metric "denial_rate" exists on an entity of the session's dataset
    When I ask "What is the denial rate by provider?"
    Then the assistant's SQL uses the metric's expression
```

## Acceptance

- Every scenario above passes; backend tests cover validation, uniqueness, clearing of dropped optional fields on update, entity scoping, candidate generation and slugging (R2-R8, R12-R15).
- A turn in a session whose dataset includes the metric's entity carries the governed-metrics block; a turn in a session without that entity does not.

## Open questions

- Open question: the datasource stored on a metric is whichever datasource is selected in the dataset editor when saving, not necessarily the one the entity came from. Intended?
- Open question: the assistant instructions do not mention metrics explicitly; the block header itself carries the "ALWAYS prefer these exact expressions" rule. Should the agent prompt state it too (see [../../system/agents.md](../../system/agents.md))?
- Open question: roadmap Milestone 1.3 (Knowledge Store, BA-4) plans to link metrics, verified queries and relationships to concepts (1.3.2); none of that linkage exists yet beyond the metric's source verified-query id.
- Open question: metrics are not shown anywhere in chat provenance (unlike knowledge snippets), so a reader cannot tell which metric an answer used.

<!-- sources: backend/src/modules/metrics/**, backend/src/modules/sessions/sessions.service.ts (agentContext), frontend/src/app/features/datasets/components/metrics-panel/**, frontend/src/app/features/datasets/services/metrics-api.service.ts, frontend/src/app/features/datasets/models/metric.model.ts, frontend/src/app/features/datasets/components/catalog-browser/catalog-browser.html -->

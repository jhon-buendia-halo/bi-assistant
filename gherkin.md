# Gherkin — user flows

Every user-facing flow, in Gherkin. One `Feature:` per Playwright spec in [frontend/e2e/](frontend/e2e/). See *Gherkin convention* and *E2E test convention* in [CLAUDE.md](CLAUDE.md).

> Scenarios are kept in sync with the Playwright specs: when a test changes, update its scenario here.

## Feature: Agents

Spec: [frontend/e2e/agents.spec.ts](frontend/e2e/agents.spec.ts)

```gherkin
Feature: Agents

  Scenario: Opens an agent from the Agents list and switches between its tabs
    When I click "Agents"
    Then I see "Questions to Insights Assistant" in the agent list
    And I see the "sql-fixer" agent in the list
    When I open the "Questions to Insights Assistant" agent
    Then I see the heading "Questions to Insights Assistant"
    And the Prompt tab is shown, containing "You are the Questions to Insights assistant"
    When I open the Tools tab
    Then I see "query_entities" and "ask_clarification"
    When I open the Memory tab
    Then I see "Recent messages replayed" and "40 messages"
    When I open the Model tab
    Then I see "Provider"
    When I open the Evals tab
    Then I see the "world-cup" set listed with "10 questions"
    And no individual question is shown
    And the run button is hidden
    When I open the "world-cup" set
    Then the "champion-2022" question shows "Who won the 2022 World Cup?"
    And it lists the check "Checks if output includes "Argentina""
    And 10 questions are listed
    When I click the open "world-cup" set again
    Then no questions are listed
    When I click "All agents"
    Then I see the "query-verifier" agent in the list

  Scenario: Shows the stateless, no-tool agents accurately
    When I click "Agents"
    And I open the "sql-fixer" agent
    And I open the Tools tab
    Then I see "This agent runs in a single step with no tools."
    When I open the Memory tab
    Then I see "This agent is stateless — no memory is configured."
    When I open the Evals tab
    Then I see "No evals configured for this agent yet."

  Scenario: Offers the configured datasources and starts a run from the evals tab
    Given a "World Cup PostgreSQL" datasource exists
    And a dataset containing the World Cup tables and views exists
    When I click "Agents"
    And I open the "Questions to Insights Assistant" agent
    And I open the Evals tab and the "world-cup" set
    Then the datasource picker offers "World Cup PostgreSQL" and "PostgreSQL"
    And the run button reads "Run 10 selected"
    When I click the run button
    Then the run button reads "Running…"
    And I see "0/10 done"

  Scenario: Runs only the ticked questions
    Given a "World Cup PostgreSQL" datasource exists
    And I am on the "world-cup" set in the agent's Evals tab
    Then the run button reads "Run 10 selected"
    When I untick the "champion-2022" question
    Then the run button reads "Run 9 selected"
    When I click select-all
    Then the run button reads "Run 10 selected"
    When I click select-all again
    Then the run button reads "Run 0 selected"
    And the run button is disabled
    When I tick the "shootouts" question
    Then the run button reads "Run 1 selected"
    And the run button is enabled

  Scenario: Refuses to run against a datasource with no datasets
    Given a "World Cup PostgreSQL" datasource exists with no datasets
    And I am on the "world-cup" set in the agent's Evals tab
    When I click the run button
    Then I see a message saying the datasource "has no datasets"

  Scenario: Explains an incomplete eval dataset without starting a run
    Given a "World Cup PostgreSQL" datasource exists
    And a dataset containing only the "matches" table exists
    And I am on the "world-cup" set in the agent's Evals tab
    When I click the run button
    Then I see "Missing entities: world_cup.tournaments"
    When I open the executions sub-tab
    Then I see "No eval runs yet"

  Scenario: Opens a question in the right panel with what it is scored on
    Given I am on the "world-cup" set in the agent's Evals tab
    Then the Details panel says "Select a question in the Evals tab"
    When I click the "champion-2022" question
    Then the Details panel shows "Who won the 2022 World Cup?"
    And it shows "Single-hop lookup"
    And it shows "Checks if output includes "Argentina""
    And it shows "Run the evals to see the steps the agent executed"
    When I click the "ambiguous-best-team" question
    Then the Details panel shows "Which team performed best?"

  Scenario: Separates the question suite from past executions
    Given a "World Cup PostgreSQL" datasource exists
    And a dataset containing the World Cup tables and views exists
    And I am on the "world-cup" set in the agent's Evals tab
    Then the Questions sub-tab is shown with 10 questions
    When I open the executions sub-tab
    Then I see "No eval runs yet"
    And no questions are listed
    When I return to the Questions sub-tab and click the run button
    And I open the executions sub-tab
    Then the first execution shows "0/10 passed"
    When I return to the Questions sub-tab
    Then 10 questions are listed

  Scenario: Downloads an execution as a Markdown report
    Given a "World Cup PostgreSQL" datasource exists
    And a dataset containing the World Cup tables and views exists
    And I have started a run from the "world-cup" set
    When I open the executions sub-tab
    Then the first execution has a download button
    When I click the download button
    Then the download succeeds as a Markdown file named "eval-run-assistant-….md"
    And the report contains "# Eval run — assistant"
    And the report contains "## Summary"
    And the report contains "Who won the 2022 World Cup?"
```

## Feature: Chat and visuals

Spec: [frontend/e2e/chat-and-visuals.spec.ts](frontend/e2e/chat-and-visuals.spec.ts)

```gherkin
Feature: Chat and visuals

  Background:
    Given a "World Cup PostgreSQL" datasource, a "World Cup Core" dataset and a "World Cup analysis" session exist
    And the assistant replies with a scripted stream: reasoning, a "run_sql" tool call returning 2 rows, then the text "Argentina won the 2022 World Cup"

  Scenario: Renders streamed reasoning, tool activity, final Markdown, and supports stopping
    When I type "Who won the last two tournaments?" into "Ask a follow-up question…"
    And I click "Send message"
    Then I see "Thinking"
    And I see "run_sql"
    And I see "2 rows"
    And I see "Argentina won the 2022 World Cup"
    And I see the final answer "France won in 2018."
    When I click "Data used (1 query)"
    Then I see the SQL "SELECT tournament_year…"
    When I type "Start a slow response" and click "Send message"
    Then I see "Stop response"
    When I click "Stop response"
    Then I see "Send message" again
    And "Thinking" is no longer shown

  Scenario: Renders a deterministic interactive visualization and its version controls
    Given I have asked "Compare champions" and seen "France won in 2018."
    And generating a visual returns a fixed "World Cup champions" visualization at version 1
    When I click "Generate interactive visuals"
    Then the "Interactive visualization" frame shows the heading "World Cup champions"
    And it shows "2018 France · 2022 Argentina"
    And I see the "Download bundle" button
    When I click "Version history"
    Then I see "Version 1"
    And I see "current"
```

## Feature: Diagnostics

Spec: [frontend/e2e/diagnostics.spec.ts](frontend/e2e/diagnostics.spec.ts)

```gherkin
Feature: Diagnostics

  Scenario: Captures live renderer failures, filters issues, and exports a redacted LLM-readable report
    Given the app has recorded a renderer error containing a password, a token and a bearer authorization
    And an interface exception "Controlled interface exception" has occurred
    When I click "Open system logs"
    Then I see the heading "System logs"
    When I click "Issues"
    And I search the logs for "Controlled renderer"
    Then I see "Controlled renderer failure"
    And the logs show "[REDACTED]"
    And the logs do not show the password or the token
    When I search the logs for "Controlled interface"
    Then I see "Controlled interface exception"
    Given the save dialog will save to a chosen file
    When I click "Export"
    Then I see "Exported N diagnostic entries"
    And a Markdown report file is saved
    And the report has the title "Questions to Insights — Diagnostics Report"
    And it has the sections "Instructions for the analyzing LLM", "Errors and warnings with nearby context" and "Chronological log"
    And it contains "Controlled renderer failure" and "[REDACTED]"
    And it contains none of the password, token or bearer secrets

  Scenario: Replaces the help icon and supports log refresh, follow mode, and dismissal
    Then there is no "Help" button
    When I click "Open system logs"
    Then I see the log search box and "Refresh logs"
    And "Follow" is ticked
    When I untick "Follow"
    Then "Follow" is not ticked
    When I click "Refresh logs"
    And I click "Close system logs"
    Then the heading "System logs" is no longer shown
```

## Feature: Layout and accessibility

Spec: [frontend/e2e/layout-accessibility.spec.ts](frontend/e2e/layout-accessibility.spec.ts)

```gherkin
Feature: Layout and accessibility

  Scenario: Supports keyboard layout controls and persists the right-panel width
    Given the "Resize right panel" separator is at its default width of 572
    When I focus the separator and press Home
    Then the width is 360
    And the width 360 is remembered for next time
    When I press End
    Then the width is 960
    When I double-click the separator
    Then the width is back to 572
    When I click "Collapse right panel"
    Then the separator is hidden
    When I click "Expand right panel"
    Then the separator is visible
    When I click "Collapse sidebar"
    Then I see "Expand sidebar"
    When I click "Expand sidebar"
    Then I see "Open system logs"

  Scenario: Has no automatically detectable accessibility violations in the application shell
    When an automated accessibility scan runs on the application shell
    Then it finds no violations

  Scenario: Matches the stable application-shell visual baseline
    When I view the application shell
    Then it looks the same as the approved "application-shell" screenshot
```

## Feature: Datasources, datasets, and sessions (World Cup database)

Spec: [frontend/e2e/world-cup-workflow.spec.ts](frontend/e2e/world-cup-workflow.spec.ts)

```gherkin
Feature: Datasources, datasets, and sessions (World Cup database)

  Background:
    Given the seeded World Cup PostgreSQL database is running

  Scenario: Creates a PostgreSQL datasource, dataset, and session using the real World Cup database
    Given I have created the "World Cup PostgreSQL" datasource, the "World Cup Core" dataset and the "World Cup analysis" session
    When I reload the application
    Then I see "Open system logs"
    And I see the "World Cup analysis" session
    When I click "World Cup analysis"
    Then the header shows "World Cup PostgreSQL" and "PostgreSQL"
    And I see the "Ask a follow-up question…" box

  Scenario: Preserves masked credentials when editing and supports datasource deletion
    Given the "World Cup PostgreSQL" datasource exists
    When I click "Edit" on that datasource
    Then the Password field shows "••••••••"
    When I change the Name to "World Cup Statistics"
    And I click "Test connection"
    Then I see "Connection successful"
    When I click "Save changes"
    Then I see "World Cup Statistics" in the list
    When I click "Delete" on it and confirm
    Then I see "No datasources yet."

  Scenario: Surfaces a failed connection in both the form and system diagnostics
    Given I am in "Datasource Configuration"
    When I click "New datasource"
    And I fill in Name "Unavailable database", Kind "postgres", Host "127.0.0.1", Port "1", Database "missing", User "missing" and a password
    And I click "Test connection"
    Then I see a "Postgres —" error message
    And "Save datasource" is disabled
    When I click "Back"
    And I click "Open system logs"
    And I click "Issues"
    And I search the logs for "Postgres"
    Then I see the "Postgres —" error in the logs
    And the logs do not show the password I entered

  Scenario: Shows the real catalog schema and column metadata before a dataset is saved
    Given the "World Cup PostgreSQL" datasource exists
    And the "World Cup Core" dataset exists
    When I click the "World Cup Core" dataset
    And I expand the "world_cup" catalog, the "world_cup" schema and the "goals" table
    Then I see the column "scorer_player_id"
    And I see a "bigint" column type
```

## Feature: Data model

Spec: [backend/test/data-models.e2e-spec.ts](backend/test/data-models.e2e-spec.ts) (API-level; no UI surface until roadmap 1.2.3)

```gherkin
Feature: Data model
  The versioned, storage-neutral data model every dataset owns (roadmap 1.2.1, BA-85).

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
    Given a legacy "metrics" row for "avg_attendance" on "world_cup.world_cup.matches" and its dataset doc were seeded directly into SQLite before the app started (predating ADR-0006)
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
```

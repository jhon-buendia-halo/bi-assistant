# Knowledge

Analysts maintain a small library of **knowledge snippets**: business-glossary terms, standing instructions and default filters that the assistant must treat as authoritative over anything it would infer from column names alone. Snippets can be written by hand or drafted automatically from a dataset's schema and sample rows; drafts always arrive disabled so a human reviews each one before the assistant ever sees it. Only enabled snippets reach the assistant, and every answer records exactly which snippets it was given.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): knowledge snippet, kind (instruction, term, default filter), scope (global or dataset), source (user or mined), pending suggestion, dataset, datasource, entity, session, assistant, knowledge bootstrap agent.

Capability-local vocabulary is limited to the UI words "Pending suggestions" (the review queue of mined, still-disabled snippets) and "Knowledge in context" (the per-answer provenance disclosure).

## Rules

Shape and validation
- R1. The system SHALL store each snippet with: a unique id, a kind, an optional scope, a title, a body, optional synonyms, optional entities, an enabled flag, a source, and created/updated timestamps.
- R2. The system SHALL accept exactly three kinds: `instruction` (a standing rule, data quirk or coverage fact), `term` (a business-glossary entry or the meaning of an enum-like code) and `default_filter` (a SQL predicate plus when to apply it). Any other kind SHALL be rejected with the message `kind must be one of: instruction, term, default_filter`.
- R3. The system SHALL require a non-empty title and a non-empty body after trimming whitespace. On create the messages are `title is required` / `body is required`; on update they are `title must not be empty` / `body must not be empty`.
- R4. The system SHALL trim every synonym and entity, and drop blanks. A snippet with no synonyms or no entities on create SHALL omit those fields.
- R5. The system SHALL treat `entities` as fully-qualified `catalog.schema.table` names, and SHALL treat `synonyms` as alternate names for the term.
- R6. A snippet created through the API or UI SHALL have source `user`; a snippet created by bootstrap SHALL have source `mined`. The source SHALL NOT change afterwards (an accepted or edited mined snippet stays `mined`).
- R7. A snippet created without an explicit enabled flag SHALL be enabled. A mined snippet SHALL always be created disabled.

Scoping
- R8. A snippet's scope SHALL be either global (no scope) or bound to one dataset, identified by the dataset's name. A scope object with neither a dataset nor a datasource, or a non-object scope, SHALL be normalised to global.
- R9. The scope MAY additionally carry a datasource id in the stored shape, but the system SHALL NOT use a datasource-only scope to select snippets for the assistant (see Open questions) and the authoring UI SHALL NOT offer it.
- R10. Listing with a dataset filter SHALL return snippets scoped to that dataset plus every global snippet. Listing with kind, source or enabled filters SHALL narrow further. An unrecognised filter value SHALL be ignored, not rejected.
- R11. Listings SHALL be ordered by last-updated time, newest first. Any write to a snippet (including toggling enabled) SHALL refresh its updated time.

Authoring
- R12. The user SHALL be able to create, edit, enable/disable and delete snippets. Update SHALL be partial: only the fields present in the request are validated and applied, and an omitted field is left unchanged.
- R13. Updating or deleting a snippet that does not exist SHALL fail with `Knowledge snippet <id> not found` (HTTP 404).
- R14. Deleting a snippet SHALL be permanent and SHALL ask the user for confirmation first.

Reaching the assistant
- R15. For each chat turn the system SHALL assemble a curated-knowledge block from snippets that are enabled and either global or scoped to a dataset the session uses. When none apply, no block SHALL be added.
- R16. The block SHALL list dataset-scoped snippets before global ones, and newest-updated first within each group. Each snippet SHALL render as one line: its kind tag, title, body, then optional synonyms and entities.
- R17. The block SHALL be limited to 2,000 characters of snippet lines (the header line is not counted). The system SHALL stop at the first snippet that does not fit and SHALL NOT skip ahead to try smaller ones.
- R18. The block SHALL be sent as its own system message after the metric definitions and before the verified reference queries.
- R19. The assistant SHALL be instructed to: read the block before planning; treat it as outranking schema inference while never inventing rows the data does not hold; apply every default filter to every query unless the question explicitly asks for the excluded rows, naming the applied filters in one short business sentence; follow every instruction as a standing rule and trust stated coverage facts instead of re-querying them; never list or quote the block unless asked; and fall back to schema and sample values, without inventing definitions, when nothing applies. (Full prompt requirements: [../../system/agents.md](../../system/agents.md).)
- R20. The same block SHALL also be used for background deep-analysis calls and for eval runs, so those see the same knowledge as a chat turn.
- R21. The system SHALL record, on each assistant answer, the list of snippets that were actually included in the block (id, kind, title, body exactly as shown, and dataset when scoped). It SHALL be recorded when the block is built, not inferred afterwards, and SHALL contain only snippets that fit the budget.

Bootstrap (drafting from data)
- R22. The user SHALL be able to ask the system to generate suggestions for one chosen dataset. The system SHALL require a dataset name (`datasetId is required`) and the dataset SHALL exist (`Dataset "<name>" not found`).
- R23. Bootstrap SHALL give the knowledge bootstrap agent a schema snapshot (limited to 6,000 characters, up to 5 sample values per column) and sample rows (up to 5 rows per entity, limited to 4,000 characters in total). Sampling is best-effort: an entity whose sample fails or does not fit is skipped. A dataset with no stored datasource binding SHALL use the default datasource.
- R24. The agent SHALL return at most 15 drafts in one structured step with no tools. The system SHALL keep at most 15 even if more are returned.
- R25. Each persisted draft SHALL be scoped to the bootstrapped dataset, source `mined`, disabled, with trimmed fields; drafts with an empty title, or whose title (case-insensitive) already exists among that dataset's snippets or earlier in the same run, SHALL be dropped.
- R26. Any failure (LLM error, malformed output, no usable drafts) SHALL surface as `Knowledge bootstrap failed: <reason>` and SHALL persist nothing.
- R27. A bootstrap run SHALL report progress by stage: opening the dataset, reading schema (with table count), sampling rows (n of total tables), drafting, saving (with draft count). It SHALL end with exactly one terminal event, either the created snippets or an error message.
- R28. Mined snippets SHALL never be sent to the assistant until a human enables them (Accept, or the Enabled toggle).

## Edge cases and errors

- Empty library: the screen shows "No knowledge yet" with a hint and both "New snippet" and "Generate suggestions" actions.
- Filters that match nothing: "No snippets match these filters."; with Pending suggestions active and none pending: "No pending suggestions right now — generate some or check back later."
- Backend unreachable on load: the screen shows the error text (`Backend unreachable` when no message is available). On toggle, delete or save failures a toast shows the server message or `Backend unreachable`.
- Bootstrap request fails to start: `Could not generate suggestions (<status>)`; connection failure: `Backend unreachable`; stream closes without a terminal event: `Stream interrupted` or `Stream ended unexpectedly`; empty error: `Could not generate suggestions — try again shortly`.
- Bootstrap yields zero new drafts: toast `No new suggestions this time`.
- No datasets exist: the Generate dialog's dataset picker shows "No datasets yet" and Generate is disabled.
- A snippet whose body alone exceeds the remaining budget stops the block, so a very long newest snippet can hide older ones. (Known limitation of newest-first selection; roadmap 1.3.3 replaces it.)
- Editing a snippet cannot currently clear its entities (a blank entities field is not sent) and, when the kind is not `term`, does not send synonyms, so previously stored synonyms survive. See Open questions.

## Contracts

- Endpoints: list, create, partial update and delete under the knowledge resource; bootstrap (single response) and bootstrap stream (server-sent progress, then done or error). See [../../system/api.md](../../system/api.md). The UI uses the stream variant only.
- Collection and document shape (snippet, per-answer knowledge record): see [../../system/data-model.md](../../system/data-model.md).
- Agents: the knowledge bootstrap agent (prompt requirements, output schema, draft cap) and the assistant's "Curated knowledge" instructions: see [../../system/agents.md](../../system/agents.md).
- Per-answer provenance is stored on the assistant message and read by [../sessions-chat/spec.md](../sessions-chat/spec.md).
- Related: [../datasets/spec.md](../datasets/spec.md) (scope target), [../verified-queries/spec.md](../verified-queries/spec.md), [../metrics/spec.md](../metrics/spec.md) (sibling context blocks), [../agents-evals/spec.md](../agents-evals/spec.md) (eval runs reuse the block).

## UI

Placement: the **Knowledge** item in the main sidebar navigation opens a full-width screen titled "Knowledge" in the main area (see [../../system/ui.md](../../system/ui.md)). Selecting the item again returns to the home view.

- Header: title, subtitle "Instructions, glossary terms and default filters the assistant uses when answering. Only enabled snippets are applied.", and two buttons, "Generate suggestions" and "New snippet".
- Filter row: kind pills "All", "Instruction", "Term", "Default filter" (each with a tooltip describing the kind), a "Filter by dataset" select ("All datasets" plus every dataset; shows that dataset's snippets and all global ones), and a toggle "Pending suggestions" with a count badge of mined, still-disabled snippets. Choosing a kind or dataset leaves the pending view.
- States: loading ("Loading knowledge…"), error, empty ("No knowledge yet"), filtered-empty, populated.
- Row (normal view): kind icon (colour per kind), title, kind label, a "Mined" badge for mined snippets, body, then scope ("Global" or the dataset name) and "Updated <Mon d>"; an Enabled/Disabled checkbox, an Edit button and a Delete button (with a spinner while deleting). Delete asks "Delete “<title>”? The assistant will stop using it."
- Row (Pending suggestions view): the Enabled checkbox, Edit and Delete are replaced by **Accept** (enables the snippet; toast "Snippet enabled") and **Reject** (confirmation "Reject “<title>”? This permanently removes the suggestion."; toast "Snippet deleted").
- Toasts: "Snippet enabled" / "Snippet disabled", "Snippet created", "Snippet updated", "Snippet deleted".
- New/Edit panel ("New snippet" / "Edit snippet"): Kind select (with the kind's description), Scope select ("Global" or a dataset), Title (placeholder "Always exclude test accounts"), Body, Synonyms (comma separated; shown only for kind Term), Entities (optional, comma separated). Buttons "Cancel" and "Create snippet" / "Save changes" (disabled until title and body are filled; shows "Saving…"). The panel does not edit the enabled flag; new snippets are enabled.
- Generate suggestions panel: explanation ("The assistant reviews the dataset and drafts instructions, terms and default filters as pending suggestions — nothing is applied until you approve it. This can take up to a minute."), a Dataset select (defaults to the first dataset), "Cancel" and "Generate" (shows "Generating…"; cancel is blocked while running). A live progress list shows finished stages with a check mark and the current stage with a spinner. On success the panel closes, a toast reads "<n> suggestion(s) generated — review in Pending suggestions", and the screen switches to the Pending suggestions view.
- In chat: each assistant answer that carried knowledge shows a collapsed "Knowledge in context (<n>)" disclosure listing, per snippet, its kind label, title, dataset (or "global") and body, plus the note "Curated knowledge the assistant was given before answering. Edit it under Knowledge; disabled snippets are never included." Clarification cards show it too.

## Flows

E2E: none yet.

```gherkin
Feature: Knowledge snippets (E2E: none yet)

  Scenario: The empty library invites the first snippet
    Given no knowledge snippets exist
    When I click "Knowledge" in the sidebar
    Then I see "No knowledge yet"
    And I see the actions "New snippet" and "Generate suggestions"

  Scenario: Create a global default filter
    Given I am on the Knowledge screen
    When I click "New snippet"
    And I choose Kind "Default filter" and Scope "Global"
    And I fill Title with "Exclude test accounts" and Body with "account_type <> 'test' - apply to every query"
    And I click "Create snippet"
    Then I see the toast "Snippet created"
    And "Exclude test accounts" is listed as "Default filter", "Global" and "Enabled"

  Scenario: Create a dataset-scoped term with synonyms
    Given a dataset "world_cup" exists
    When I click "New snippet" and choose Kind "Term" and Scope "world_cup"
    Then the "Synonyms (comma separated)" field is visible
    When I fill Title, Body and Synonyms and click "Create snippet"
    Then the snippet is listed with the scope "world_cup"

  Scenario: Title and body are required
    Given the "New snippet" panel is open
    When Title or Body is empty
    Then "Create snippet" is disabled

  Scenario: Edit a snippet
    Given a snippet "Exclude test accounts" exists
    When I click its Edit button, change the Body and click "Save changes"
    Then I see the toast "Snippet updated"
    And the list shows the new body

  Scenario: Disable a snippet so the assistant stops using it
    Given an enabled snippet exists
    When I untick its "Enabled" checkbox
    Then I see the toast "Snippet disabled"
    And the checkbox label reads "Disabled"

  Scenario: Delete a snippet
    Given a snippet "Exclude test accounts" exists
    When I click its Delete button and confirm "Delete “Exclude test accounts”?"
    Then I see the toast "Snippet deleted"
    And the snippet is no longer listed

  Scenario: Filter by kind and by dataset
    Given snippets of several kinds and scopes exist
    When I click the "Term" pill
    Then only terms are listed
    When I choose the dataset "world_cup" in "Filter by dataset"
    Then I see terms scoped to "world_cup" and global terms, but not terms scoped to other datasets

  Scenario: Generate suggestions from a dataset
    Given a dataset "world_cup" exists and an LLM is configured
    When I click "Generate suggestions"
    And I choose the dataset "world_cup" and click "Generate"
    Then I see a progress list naming each stage, ending with "Saving <n> drafts for review"
    And a toast says "<n> suggestions generated — review in Pending suggestions"
    And I am shown the Pending suggestions view
    And each suggestion is badged "Mined" and is not enabled

  Scenario: Accept a pending suggestion
    Given the Pending suggestions view lists a mined suggestion
    When I click "Accept"
    Then I see the toast "Snippet enabled"
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

  Scenario: An answer shows the knowledge it was given
    Given an enabled snippet scoped to the session's dataset exists
    When I ask a question in a session using that dataset
    Then the assistant's answer has a "Knowledge in context (1)" disclosure
    And expanding it shows the snippet's title and body

  Scenario: Disabled snippets are never sent
    Given a disabled snippet exists for the session's dataset
    When I ask a question in that session
    Then no "Knowledge in context" disclosure lists that snippet
```

## Acceptance

- Every Gherkin scenario above passes against the running app (backend tests cover R1-R28 at service level).
- With a snippet enabled for a dataset, an answer in a session over that dataset records it in "Knowledge in context"; after disabling or deleting it, the next answer does not.
- With a default-filter snippet enabled, the generated SQL applies it and the answer names it.
- A bootstrap run on the sample dataset yields at most 15 disabled, mined, dataset-scoped drafts and none duplicates an existing title for that dataset.
- Open question: parts of roadmap Milestone 1.3 Knowledge Store (BA-4) already exist in code: authoring of the three kinds, dataset/global scoping, bootstrap from schema and samples (reviewed as pending suggestions), newest-first injection under a character budget, and per-answer "Knowledge in context" provenance. Not yet built: the ontology/concept graph (1.3.2), question-relevance retrieval (1.3.3), mining from past sessions and thumbs-up answers, conflict detection and correction feedback (1.3.4).

## Open questions

- Open question: a snippet whose scope has only a datasource id is stored but never selected for the assistant (selection requires a dataset match or no scope). Is datasource scoping intended to work, and should the authoring UI offer it?
- Open question: editing in the UI cannot clear entities and does not clear stale synonyms when switching a term to another kind. Intended, or a bug to fix in the rebuild?
- Open question: the "Pending suggestions" view hides the Edit action; a mined suggestion can only be edited after it is accepted. Intended?
- Open question: the `source: user | mined` distinction of the stored shape allows mining from past sessions (roadmap 1.3.2); only dataset schema/sample mining exists today.
- Open question: the non-streaming bootstrap endpoint exists but nothing in the UI calls it. Keep it as part of the public contract?

<!-- sources: backend/src/modules/knowledge/**, backend/src/mastra/agents/knowledge-bootstrap.agent.ts, backend/src/mastra/agents/assistant.agent.ts (Curated knowledge), backend/src/modules/sessions/sessions.service.ts (agentContext, knowledgeUsed), backend/src/modules/agents/eval-runs.service.ts, frontend/src/app/features/knowledge/**, frontend/src/app/features/sessions/components/session-chat/session-chat.html (knowledgeApplied), frontend/src/app/app.html (Knowledge nav) -->

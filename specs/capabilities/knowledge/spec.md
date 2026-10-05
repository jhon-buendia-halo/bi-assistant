# Knowledge

Analysts maintain a small library of **knowledge snippets**: business-glossary terms, standing instructions and default filters that the assistant must treat as authoritative over anything it would infer from column names alone. Snippets come from three sources:
- written by hand;
- drafted from a dataset's schema and sample rows; drafts always arrive disabled, so a human reviews each one before the assistant ever sees it;
- learned from a reviewer's note on a reasoning block in [business expert mode](../business-expert/spec.md); these **lessons** are enabled at once, because the reviewer who wrote the note is the human in the loop, and they stay visible, editable and reversible here.

Only enabled snippets reach the assistant, and every answer records exactly which snippets it was given.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): knowledge snippet, kind (instruction, term, default filter), scope (global or dataset), source (user, mined or feedback), lesson, pending suggestion, dataset, datasource, entity, session, assistant, knowledge bootstrap agent, feedback learner, memory bank, observation, mental model, retain, recall.

Capability-local vocabulary is limited to the UI words "Pending suggestions" (the review queue of mined, still-disabled snippets), "Learned" (the view of lessons) and "Knowledge in context" (the per-answer provenance disclosure).

## Rules

Shape and validation
- R1. The system SHALL store each snippet with: a unique id, a kind, an optional scope, a title, a body, optional synonyms, optional entities, an enabled flag, a source, created/updated timestamps and, for a lesson only, its provenance (R29).
- R2. The system SHALL accept exactly three kinds: `instruction` (a standing rule, data quirk or coverage fact), `term` (a business-glossary entry or the meaning of an enum-like code) and `default_filter` (a SQL predicate plus when to apply it). Any other kind SHALL be rejected with the message `kind must be one of: instruction, term, default_filter`.
- R3. The system SHALL require a non-empty title and a non-empty body after trimming whitespace. On create the messages are `title is required` / `body is required`; on update they are `title must not be empty` / `body must not be empty`.
- R4. The system SHALL trim every synonym and entity, and drop blanks. A snippet with no synonyms or no entities on create SHALL omit those fields.
- R5. The system SHALL treat `entities` as fully-qualified `catalog.schema.table` names, and SHALL treat `synonyms` as alternate names for the term.
- R6. A snippet created through the API or UI SHALL have source `user`; a snippet created by bootstrap SHALL have source `mined`; a lesson learned from a reviewer's note SHALL have source `feedback`. Only learning can create a `feedback` snippet. The source and provenance SHALL NOT change afterwards: an update ignores them even when a client sends them, and an accepted or edited mined snippet stays `mined`.
- R7. A snippet created without an explicit enabled flag SHALL be enabled. A mined snippet SHALL always be created disabled; a lesson SHALL always be created enabled.

Scoping
- R8. A snippet's scope SHALL be either global (no scope) or bound to one dataset, identified by the dataset's name. A scope object with neither a dataset nor a datasource, or a non-object scope, SHALL be normalised to global.
- R9. The scope MAY additionally carry a datasource id in the stored shape, but the system SHALL NOT use a datasource-only scope to select snippets for the assistant (see Open questions) and the authoring UI SHALL NOT offer it.
- R10. Listing with a dataset filter SHALL return snippets scoped to that dataset plus every global snippet. Listing with kind, source (`user`, `mined` or `feedback`) or enabled filters SHALL narrow further. An unrecognised filter value SHALL be ignored, not rejected.
- R11. Listings SHALL be ordered by last-updated time, newest first. Any write to a snippet (including toggling enabled) SHALL refresh its updated time.

Authoring
- R12. The user SHALL be able to create, edit, enable/disable and delete snippets. Update SHALL be partial: only the fields present in the request are validated and applied, and an omitted field is left unchanged.
- R13. Updating or deleting a snippet that does not exist SHALL fail with `Knowledge snippet <id> not found` (HTTP 404).
- R14. Deleting a snippet SHALL be permanent and SHALL ask the user for confirmation first.

Reaching the assistant
- R15. For each chat turn the system SHALL assemble a curated-knowledge block from snippets that are enabled and either global or scoped to a dataset the session uses. When none apply, no block SHALL be added.
- R16. The block SHALL order snippets in three tiers:
  1. every `default_filter`, whatever its source, so a filter is never crowded out;
  2. lessons (source `feedback`), so a lesson is never crowded out by older hand-written or mined snippets;
  3. everything else.

  Within a tier, dataset-scoped snippets come before global ones, then the newest-updated first. Each snippet SHALL render as one line: its kind tag, title, body, then optional synonyms and entities.
- R17. The block SHALL be limited to 8,000 characters of snippet lines (the header line is not counted). A snippet whose line does not fit the remaining budget SHALL be skipped, and later, smaller snippets SHALL still be added while they fit. A snippet is never cut.
- R18. The block SHALL be sent as its own system message after the metric definitions and before the verified reference queries.
- R19. The assistant SHALL be instructed to: read the block before planning; treat it as outranking schema inference while never inventing rows the data does not hold; apply every default filter to every query unless the question explicitly asks for the excluded rows, naming the applied filters in one short business sentence; follow every instruction as a standing rule and trust stated coverage facts instead of re-querying them; never list or quote the block unless asked; and fall back to schema and sample values, without inventing definitions, when nothing applies. (Full prompt requirements: [../../system/agents.md](../../system/agents.md).)
- R20. The same block SHALL also be used for background deep-analysis calls and for eval runs, so those see the same knowledge as a chat turn.
- R21. The system SHALL record, on each assistant answer, the list of snippets that were actually included in the block (id, kind, title, body exactly as shown, source, and dataset when scoped). It SHALL be recorded when the block is built, not inferred afterwards, and SHALL contain only snippets that fit the budget. Answers recorded before the source was kept have no source; they are read as not learned.

Bootstrap (drafting from data)
- R22. The user SHALL be able to ask the system to generate suggestions for one chosen dataset. The system SHALL require a dataset name (`datasetId is required`) and the dataset SHALL exist (`Dataset "<name>" not found`).
- R23. Bootstrap SHALL give the knowledge bootstrap agent a schema snapshot (limited to 6,000 characters, up to 5 sample values per column) and sample rows (up to 5 rows per entity, limited to 4,000 characters in total). Sampling is best-effort: an entity whose sample fails or does not fit is skipped. A dataset with no stored datasource binding SHALL use the default datasource.
- R24. The agent SHALL return at most 15 drafts in one structured step with no tools. The system SHALL keep at most 15 even if more are returned.
- R25. Each persisted draft SHALL be scoped to the bootstrapped dataset, source `mined`, disabled, with trimmed fields; drafts with an empty title, or whose title (case-insensitive) already exists among that dataset's snippets or earlier in the same run, SHALL be dropped.
- R26. Any failure (LLM error, malformed output, no usable drafts) SHALL surface as `Knowledge bootstrap failed: <reason>` and SHALL persist nothing.
- R27. A bootstrap run SHALL report progress by stage: opening the dataset, reading schema (with table count), sampling rows (n of total tables), drafting, saving (with draft count). It SHALL end with exactly one terminal event, either the created snippets or an error message.
- R28. Mined snippets SHALL never be sent to the assistant until a human enables them (Accept, or the Enabled toggle).

Lessons (learned from feedback)
- R29. A lesson SHALL carry its provenance:
  - the id of the block rating it was learned from, the session and the answer's time;
  - the rated block, the question and the reviewer's note;
  - the vote, when there was one;
  - when it was learned;
  - the method: `agent` when the feedback learner wrote it, `verbatim` when the note was stored as written.

  How lessons are distilled, scoped and replaced is owned by [business-expert](../business-expert/spec.md) R23–R28.
- R30. A lesson SHALL behave like any other snippet once stored: it can be edited, disabled, enabled or deleted, and only an enabled lesson reaches the assistant. Editing the reviewer's note again replaces every lesson learned from it, hand edits included ([business-expert](../business-expert/spec.md) R25). Clearing the note deletes them.
- R31. The Knowledge screen SHALL offer a **Learned** view listing every lesson (any scope, enabled or not), with a count of all lessons. Turning it on SHALL leave the Pending suggestions view, and the reverse. Choosing a kind or a dataset SHALL leave both.
- R32. A lesson's row SHALL carry a "From feedback" badge whose tooltip reads `<question> — “<note>”` from its provenance ("Learned from a reviewer's feedback note" when there is none). In an answer's "Knowledge in context" list, a lesson SHALL carry a "Learned" chip (tooltip "Learned from a reviewer's feedback note").

Engine-loop changes ([../engine-levers/spec.md](../engine-levers/spec.md))
- R33. With the `rankedKnowledge` lever on, snippets SHALL be ordered by relevance to the question only inside each tier of R16, with scope and recency as the tiebreak. The tiers stay strict (every default filter, then every lesson, then the rest), so ranking never moves a lesson or a default filter behind a more relevant hand-written snippet. The 8,000-character skip-and-continue limit of R17 still applies.
- R34. A snippet bound to exactly one entity MAY name one `column` of it; naming a column on a snippet with no entity or several SHALL be refused with a message saying it needs exactly one entity. With the `inlineKnowledge` lever on, such a snippet is shown beside that column in the schema the assistant sees. The knowledge form SHALL offer the column once a single entity is chosen.
- R35. With the `context` lever set to `bare`, no knowledge block SHALL be sent. With the `lookupTools` lever on, the assistant MAY look snippets and metrics up by term during a turn (engine-levers R8).

Memory from past sessions ([ADR-0013](../../system/architecture.md), roadmap 1.3.6)
- R36. Memory SHALL be off by default. The engine lever `memory` ([../engine-levers/spec.md](../engine-levers/spec.md) R15) is `off` until the operator changes it, and with it `off`, or with no `HINDSIGHT_URL` configured, nothing SHALL be recalled, retained or sent to the memory server; no turn is slower or different.
- R37. With the lever on, the system SHALL retain a memory only from a user signal: an approval of an answer (thumbs up), a rejection (thumbs down), a reviewer's comment on a reasoning block, a disagreement of the independent cross-check, or a create, update or delete of a curated Knowledge entry. Nothing else SHALL be retained: not questions asked, not answers given, not eval runs. Shapes, ids and the delivery outbox are in [../../system/data-model.md](../../system/data-model.md) 3.15.
- R38. A retained memory SHALL never contain row values: the SQL of a signal is stored with every string literal replaced by `'?'` unless the question itself contains that literal or the literal is a category code such as `'completed'` or `'own_goal'` (schema vocabulary: one all-lowercase or all-uppercase token, never a capitalised name or an email), and the memory server is told never to quote row values or personal data.
- R39. With the lever on, a turn SHALL recall the memories of the session's datasource that are relevant to the question, and show them to the assistant in a block "Learned from past sessions (not curated; curated knowledge wins on conflict)" ([../../system/agents.md](../../system/agents.md) 4.1). When a recalled memory contradicts a curated Knowledge entry, a metric or a verified query, the curated one SHALL win. No recalled memory means no block.
- R40. Each recalled memory SHALL be recorded on the answer as a "Knowledge in context" item with source `memory`, and the answer panel SHALL badge it "Memory", so the analyst can see what the answer owes to memory. A memory SHALL NOT create, edit or enable a Knowledge snippet; promotion to curated Knowledge remains a person's act.
- R41. A memory server that is unreachable, slow (recall is cut off after 2.5 seconds) or failing SHALL never block, delay beyond that bound or fail a turn or a save: recall then returns nothing, and a signal that cannot be delivered stays queued and is retried, then marked failed.
- R42. A reviewer's comment SHALL be retained as a correction, and clearing the comment SHALL make the system forget that memory. Deleting a Knowledge entry SHALL forget its memory.
- R43. Knowledge that has global scope (no dataset and no datasource) SHALL NOT be retained, because memory is kept per datasource; entries scoped to a dataset are retained in the datasource of that dataset.
- R44. With the `context` lever set to `bare`, no memory block SHALL be sent either (R35).
## Edge cases and errors

- Empty library: the screen shows "No knowledge yet" with a hint and both "New snippet" and "Generate suggestions" actions.
- Filters that match nothing: "No snippets match these filters."; with Pending suggestions active and none pending: "No pending suggestions right now — generate some or check back later."
- Backend unreachable on load: the screen shows the error text (`Backend unreachable` when no message is available). On toggle, delete or save failures a toast shows the server message or `Backend unreachable`.
- Bootstrap request fails to start: `Could not generate suggestions (<status>)`; connection failure: `Backend unreachable`; stream closes without a terminal event: `Stream interrupted` or `Stream ended unexpectedly`; empty error: `Could not generate suggestions — try again shortly`.
- Bootstrap yields zero new drafts: toast `No new suggestions this time`.
- No datasets exist: the Generate dialog's dataset picker shows "No datasets yet" and Generate is disabled.
- A snippet whose line exceeds the remaining budget is skipped and the next ones are still tried, so a very long snippet hides only itself. Selection is still by tier and recency, not by relevance to the question (roadmap 1.3.3 replaces it).
- No lessons yet: the Learned view shows "No lessons learned yet — they appear once a reviewer leaves a feedback note the assistant can generalise from."
- A lesson deleted or edited here and then re-taught (its note edited again) is replaced by the newly learned lessons.
- Editing a snippet cannot currently clear its entities (a blank entities field is not sent) and, when the kind is not `term`, does not send synonyms, so previously stored synonyms survive. See Open questions.

## Contracts

- Endpoints: list, create, partial update and delete under the knowledge resource; bootstrap (single response) and bootstrap stream (server-sent progress, then done or error). See [../../system/api.md](../../system/api.md). The UI uses the stream variant only. Lessons are created through the reasoning-block feedback endpoint, never through the knowledge resource.
- Collection and document shape (snippet, lesson provenance, per-answer knowledge record): see [../../system/data-model.md](../../system/data-model.md).
- Agents: the knowledge bootstrap agent (prompt requirements, output schema, draft cap), the assistant's "Curated knowledge" instructions, and the feedback learner that writes lessons (2.9): see [../../system/agents.md](../../system/agents.md). The same block is also given to the cross-check verifier, and its entries are listed for the business-expert explainer.
- Per-answer provenance is stored on the assistant message and read by [../sessions-chat/spec.md](../sessions-chat/spec.md).
- Related: [../datasets/spec.md](../datasets/spec.md) (scope target), [../verified-queries/spec.md](../verified-queries/spec.md), [../metrics/spec.md](../metrics/spec.md) (sibling context blocks), [../agents-evals/spec.md](../agents-evals/spec.md) (eval runs reuse the block), [../business-expert/spec.md](../business-expert/spec.md) (learning from notes), [../answer-pinning/spec.md](../answer-pinning/spec.md) (the block is part of every pin's fingerprint).

## UI

Placement: the **Knowledge** item in the main sidebar navigation opens a full-width screen titled "Knowledge" in the main area (see [../../system/ui.md](../../system/ui.md)). Selecting the item again returns to the home view.

- Header: title, subtitle "Instructions, glossary terms and default filters the assistant uses when answering. Only enabled snippets are applied.", and two buttons, "Generate suggestions" and "New snippet".
- Filter row: kind pills "All", "Instruction", "Term", "Default filter" (each with a tooltip describing the kind), a "Filter by dataset" select ("All datasets" plus every dataset; shows that dataset's snippets and all global ones), a toggle "Learned" (tooltip "Lessons learned from a reviewer's feedback note") with a count badge of lessons, and a toggle "Pending suggestions" with a count badge of mined, still-disabled snippets. Choosing a kind or dataset leaves the pending and learned views; the two toggles exclude each other.
- States: loading ("Loading knowledge…"), error, empty ("No knowledge yet"), filtered-empty, learned-empty, populated.
- Row (normal view): kind icon (colour per kind), title, kind label, a "Mined" badge for mined snippets or a "From feedback" badge for lessons (R32), body, then scope ("Global" or the dataset name) and "Updated <Mon d>"; an Enabled/Disabled checkbox, an Edit button and a Delete button (with a spinner while deleting). Delete asks "Delete “<title>”? The assistant will stop using it."
- Row (Pending suggestions view): the Enabled checkbox, Edit and Delete are replaced by **Accept** (enables the snippet; toast "Snippet enabled") and **Reject** (confirmation "Reject “<title>”? This permanently removes the suggestion."; toast "Snippet deleted").
- Toasts: "Snippet enabled" / "Snippet disabled", "Snippet created", "Snippet updated", "Snippet deleted".
- New/Edit panel ("New snippet" / "Edit snippet"): Kind select (with the kind's description), Scope select ("Global" or a dataset), Title (placeholder "Always exclude test accounts"), Body, Synonyms (comma separated; shown only for kind Term), Entities (optional, comma separated). Buttons "Cancel" and "Create snippet" / "Save changes" (disabled until title and body are filled; shows "Saving…"). The panel does not edit the enabled flag; new snippets are enabled.
- Generate suggestions panel: explanation ("The assistant reviews the dataset and drafts instructions, terms and default filters as pending suggestions — nothing is applied until you approve it. This can take up to a minute."), a Dataset select (defaults to the first dataset), "Cancel" and "Generate" (shows "Generating…"; cancel is blocked while running). A live progress list shows finished stages with a check mark and the current stage with a spinner. On success the panel closes, a toast reads "<n> suggestion(s) generated — review in Pending suggestions", and the screen switches to the Pending suggestions view.
- In chat: each assistant answer that carried knowledge shows a collapsed "Knowledge in context (<n>)" disclosure listing, per snippet, its kind label, title, dataset (or "global") and body, plus the note "Curated knowledge the assistant was given before answering. Edit it under Knowledge; disabled snippets are never included." A lesson in that list carries the "Learned" chip. Clarification cards show it too.

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

  Scenario: Lessons learned from feedback have their own view
    Given a reviewer's note on a "Retail" answer taught the lesson "Fiscal year"
    When I click "Knowledge" in the sidebar
    Then the "Learned" toggle shows the count 1
    When I click "Learned"
    Then only "Fiscal year" is listed, badged "From feedback" and "Enabled"
    And hovering "From feedback" shows the question and the reviewer's note
    When I click "Term"
    Then the Learned view is left and terms are listed

  Scenario: A disabled lesson stops reaching the assistant
    Given the lesson "Fiscal year" is listed under "Learned"
    When I untick its "Enabled" checkbox
    And I ask a question in a "Retail" session
    Then that answer's "Knowledge in context" does not list "Fiscal year"

  Scenario: A lesson is shown as learned in the answer that used it
    Given the enabled lesson "Fiscal year" is scoped to "Retail"
    When I ask a question in a "Retail" session
    Then "Knowledge in context" lists "Fiscal year" with the chip "Learned"

  Scenario: A long snippet does not hide the rest
    Given a snippet whose body is longer than the knowledge budget and two short snippets exist for the session's dataset
    When I ask a question in that session
    Then "Knowledge in context" lists the two short snippets and not the long one
```

```gherkin
Feature: Memory from past sessions (E2E: scenario 1 is covered by chat-and-visuals.spec.ts, scenario 2 by agents.spec.ts; the others need a Hindsight server and a model)

  Scenario: With the Memory lever off an answer carries no memory
    Given the Memory lever is "Off"
    When I ask a question in a session
    Then the answer's "Knowledge in context" lists no item badged "Memory"
    And the answer is the same as without a memory server

  Scenario: Settings shows the Memory lever off by default
    When I open Settings and click "Engine levers"
    Then I see the "Memory (Hindsight)" lever with "Off" selected

  Scenario: An approval in one session informs a similar question in another
    Given the Memory lever is "Recall" and a memory server is reachable
    And I approved an answer to "Which team scored the most goals in 2022?" in one session
    When I start a new session on the same dataset and ask "Who was the top scoring team in 2022?"
    Then the answer's "Knowledge in context" lists an item badged "Memory"
    And no Knowledge snippet was created or changed

  Scenario: A reviewer comment is retained as a correction and forgotten when cleared
    Given the Memory lever is "Recall" and business expert mode is on
    When I write a comment on a reasoning block and save it
    Then the comment is retained as a correction for the datasource
    When I clear the comment
    Then that correction is forgotten
```

## Acceptance

- Every Gherkin scenario above passes against the running app (backend tests cover R1-R28 at service level).
- With a snippet enabled for a dataset, an answer in a session over that dataset records it in "Knowledge in context"; after disabling or deleting it, the next answer does not.
- With a default-filter snippet enabled, the generated SQL applies it and the answer names it.
- A bootstrap run on the sample dataset yields at most 15 disabled, mined, dataset-scoped drafts and none duplicates an existing title for that dataset.
- A reviewer's note on an expert answer's block yields at most three enabled lessons with source `feedback` and full provenance, listed under "Learned", and the next turn on that dataset receives them ahead of older non-filter snippets.
- With the Memory lever on and a reachable memory server, approving an answer in one session makes a similar question in a new session list a "Memory" item in "Knowledge in context"; with the lever off, or the server down, answers are unchanged and no turn fails.
- Open question: parts of roadmap Milestone 1.3 Knowledge Store (BA-4) already exist in code: authoring of the three kinds, dataset/global scoping, bootstrap from schema and samples (reviewed as pending suggestions), tiered injection under a character budget, per-answer "Knowledge in context" provenance, and lessons learned from reviewer notes on business-expert answers (a form of correction feedback). Not yet built: the ontology/concept graph (1.3.2), question-relevance retrieval (1.3.3), mining from past sessions and thumbs-up answers, and conflict detection between snippets, for example a lesson that contradicts a hand-written term (1.3.4).

## Open questions

- Open question: a snippet whose scope has only a datasource id is stored but never selected for the assistant (selection requires a dataset match or no scope). Is datasource scoping intended to work, and should the authoring UI offer it?
- Open question: editing in the UI cannot clear entities and does not clear stale synonyms when switching a term to another kind. Intended, or a bug to fix in the rebuild?
- Open question: the "Pending suggestions" view hides the Edit action; a mined suggestion can only be edited after it is accepted. Intended?
- Open question: the `source` distinction (`user`, `mined`, `feedback`) of the stored shape allows mining from past sessions (roadmap 1.3.2); only dataset schema/sample mining and learning from reviewer notes exist today.
- Open question: lessons are created enabled with no review gate (the reviewer writing the note is the review). Should a "learned, pending approval" state exist, like mined suggestions?
- Open question: the non-streaming bootstrap endpoint exists but nothing in the UI calls it. Keep it as part of the public contract?

<!-- sources: backend/src/modules/knowledge/**, backend/src/modules/learning/**, backend/src/mastra/agents/knowledge-bootstrap.agent.ts, backend/src/mastra/agents/assistant.agent.ts (Curated knowledge), backend/src/modules/sessions/sessions.service.ts (agentContext, knowledgeUsed), backend/src/modules/agents/eval-runs.service.ts, frontend/src/app/features/knowledge/**, frontend/src/app/features/sessions/components/session-chat/session-chat.html (knowledgeApplied), frontend/src/app/app.html (Knowledge nav) -->

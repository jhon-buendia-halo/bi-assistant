# Knowledge

Analysts maintain a small library of **knowledge snippets**: business-glossary terms, standing instructions and default filters that the assistant must treat as authoritative over anything it would infer from column names alone. Snippets can be written by hand or drafted automatically from a dataset's schema and sample rows; drafts always arrive disabled so a human reviews each one before the assistant ever sees it. Only enabled snippets reach the assistant, and every answer records exactly which snippets it was given.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): knowledge snippet, kind (instruction, term, default filter), scope (global or dataset), source (user or mined), pending suggestion, dataset, datasource, entity, session, assistant, knowledge bootstrap agent, feedback, memory of past sessions (the memory), signal, learning memory, memory lever.

Capability-local vocabulary is limited to the UI words "Pending suggestions" (the review queue of mined, still-disabled snippets) and "Knowledge in context" (the per-answer provenance disclosure), and to these words of the memory of past sessions (R30 to R43, [ADR-0031](../../system/architecture.md), Accepted):
- **Reviewer's note** — a note a person would write on an answer to say what the right reading is, as an action of its own, apart from the thumbs; the one source of a `correction` (R31). The app has no such action in this version (Open questions).
- **"Memory"** — the badge of a "Knowledge in context" entry the answer took from the memory (R38), and **"Learned from past sessions"** the block those entries were sent in (R36).

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
- R19. The instructions SHALL be the on-demand `curated-knowledge` skill: listed in the assistant's skill catalog, loaded by the model with the skill tool when a call carries the block, and never sent with the block or written into the assistant's base prompt. They SHALL tell the assistant to: read the block before planning; treat it as outranking schema inference while never inventing rows the data does not hold; apply every default filter to every query unless the question explicitly asks for the excluded rows, naming the applied filters in one short business sentence; follow every instruction as a standing rule and trust stated coverage facts instead of re-querying them; never list or quote the block unless asked; and fall back to schema and sample values, without inventing definitions, when nothing applies. (Full prompt requirements: [../../system/agents.md](../../system/agents.md).)
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

Ownership
- R29. Knowledge entries, including mined suggestions, SHALL belong to the one user (the built-in super admin; the stored `ownerId` is a legacy attribute, [data-model.md](../../system/data-model.md)). Every enabled entry SHALL be injected into turns. Every knowledge action is available.

Memory from past sessions ([ADR-0031](../../system/architecture.md), Accepted; [BA-81](https://halo-powered.atlassian.net/browse/BA-81)). The port, the "Mastra only" implementation, its embedding key and the learned block: [agents.md](../../system/agents.md) 2.1 and 4.1; the lever's settings document, the outbox and the learning memories: [data-model.md](../../system/data-model.md) 3.2.2, 3.15 and 5.2; the endpoints: [api.md](../../system/api.md) 7, 19 and 108 to 110.
- R30. Memory SHALL be off by default: the memory lever, the one switch of Settings → Memory ([ui.md](../../system/ui.md) 4.17), stored as the `memory` settings document, reads `off` until the user turns it `on`, and no stored document means `off`. With it `off` the system SHALL recall nothing and retain no new signal, so no turn is slower or different from a turn without memory; only forgetting (R39 to R41) and the storing of signals queued while it was on (R34) still reach the memory. Turning it off SHALL keep what the memory holds, and turning it on again SHALL use it. Settings → Memory SHALL also say which key embeds the signals, or that there is none and nothing is remembered until one is set ([agents.md](../../system/agents.md) 2.1).
- R31. With the lever on, the system SHALL retain a memory only from a **signal**: a judgement a person gave an answer that ran SQL. A thumbs-up SHALL retain a `verified_query` (the question and the SQL a verified query keeps, [verified-queries](../verified-queries/spec.md) R2). A thumbs-down SHALL retain a `rejection` (that question and SQL), with or without a note: the thumbs-down's note ([sessions-chat](../sessions-chat/spec.md) R36), when it has one, is the rejection's `Analyst note` (R33), and a thumbs-down never retains a correction. A reviewer's note SHALL retain a `correction` (that question and SQL, and the note); the app has no reviewer's-note action in this version, so it SHALL retain no correction until that action exists, while the memory's port and the memory eval still take corrections (Open questions). A rating SHALL retain nothing when its answer has no successful SQL or no question before it (verified-queries R3), or when the session's datasets do not resolve to exactly one datasource, as no single learning memory can be told (verified-queries R2 stores no datasource then). Nothing else SHALL be retained: not the questions asked, not the answers given, not deep analysis, previews or eval runs (an eval keeps a memory of its own, apart, [BA-190](https://halo-powered.atlassian.net/browse/BA-190)). Cross-check disagreements and Knowledge edits, which ADR-0031 also counts as verified signals, are not retained in this version (Open questions).
- R32. A retained signal SHALL never hold a row value. Its SQL SHALL be stored with every single-quoted string literal replaced by `'?'`, unless the literal's text, ignoring case and `LIKE` wildcards at either end, appears in the signal's question, or the literal is a category code: one token of at most 24 characters, all lowercase or all uppercase, letters and digits with optional underscores (`'own_goal'`, `'SETTLED'`, `'DF'`), which is schema vocabulary rather than a row value. So a capitalised name (`'Lionel Messi'`) or an email is replaced unless the question holds it. Numbers SHALL be kept. The SQL SHALL be clipped to 2,000 characters and a note to 1,000, each cut marked `…`; a note is otherwise kept as the person wrote it.
- R33. Each signal SHALL be stored as exactly this text, with `<date>` the UTC day of the rated or noted answer (`YYYY-MM-DD`), `<sql>` the SQL of R32 and `<note>` the reviewer's note of a correction or the thumbs-down's note of a rejection:

  ```
  [verified_query · <date>]
  Question: <question>
  Approved SQL: <sql>
  ```

  ```
  [correction · <date>]
  Question: <question>
  Corrected SQL (do not reuse): <sql>
  Analyst note: <note>
  ```

  ```
  [rejection · <date>]
  Question: <question>
  Rejected SQL (do not reuse): <sql>
  Analyst note: <note>                ← only when the rejection has a note
  ```

  The SQL of a correction is the SQL that was wrong, never a fix, and SHALL NOT be labelled approved or final: a memory given a wrong join under the label `Final SQL` stored it as a plain fact ([research](../../../docs/research/BA-4.md) section 8). Every memory the app can run stores this same text, so two memories differ only in how they store and search it.
- R34. Signals SHALL reach the memory through a persisted outbox: rating an answer, or writing, changing or clearing a thumbs-down's note, SHALL never wait for the memory or fail because of it; a signal the memory cannot store yet stays queued and is retried, and after the last retry is marked failed.
- R35. The memory SHALL be kept per datasource, not per dataset (decided 2026-11-02, OD-1 in Open questions): a signal is retained in the learning memory of the session's datasource, and a turn recalls from the learning memories of the datasources the session's datasets are bound to.
- R36. With the lever on, each chat turn SHALL recall the signals relevant to its question by meaning, not by shared words, so a paraphrase or a question in another language finds them: at most 4 from each learning memory, each at least as similar to the question as the relevance threshold of 0.4 (both values measured defaults, recalibrated on the memory eval's dev questions: Open questions), a text found twice sent once. It SHALL send them oldest first, after the summary of R42 when there is one, in a block of their own headed `Learned from past sessions (not curated; curated knowledge wins on conflict)`, after the curated-knowledge block and before the verified reference queries. No relevant signal and no summary SHALL mean no block. Recall SHALL be cut off after 2.5 seconds: a slow, failing or empty memory gives no block, and the turn goes on.
- R37. Curated knowledge SHALL outrank the memory: the learned block SHALL come after the curated-knowledge block and say in its heading that curated knowledge wins on conflict. The memory SHALL NOT create, edit, enable or delete a Knowledge snippet, a metric or a verified query; promoting what it holds to Knowledge stays a person's act. Whether the assistant follows curated knowledge over a contradicting memory is measured by the memory eval's `memory-vs-curated` questions (BA-190).
- R38. Each signal and summary a turn sends in the learned block SHALL be recorded on the answer as a "Knowledge in context" entry with source `memory`, exactly as sent and only if sent (as R21 records snippets), and the disclosure SHALL badge it "Memory".
- R39. Rating an answer again SHALL replace what its earlier rating retained, whatever the lever's value: a thumbs-down after a thumbs-up forgets the approval and, with the lever on, retains the rejection; a thumbs-up after a thumbs-down forgets the rejection and, with the lever on, retains the approval. Writing, changing or clearing the note of a thumbs-down ([sessions-chat](../sessions-chat/spec.md) R36) SHALL replace the rejection's note, so a cleared note leaves a rejection without one; it SHALL never turn the rejection into a correction. A rating that retains nothing (the lever off, or no signal of the answer, R31) SHALL forget what an earlier rating of the answer retained, without compacting the file ([data-model.md](../../system/data-model.md) 5.2): with the lever off, rating an answer or changing its thumbs-down's note SHALL forget whatever its rating had retained and retain nothing. Once the reviewer's-note action exists, changing a reviewer's note SHALL replace its correction, and clearing it SHALL forget the correction. The memory SHALL hold at most one signal from the rating (an approval or a rejection) and one correction per answer.
- R40. The user SHALL be able to forget a signal: each "Memory" entry of "Knowledge in context" that holds a signal SHALL offer **Forget**, which asks `Forget this memory? Later answers will not use it.` in the app's destructive confirmation ([ui.md](../../system/ui.md) section 2) and, once confirmed, SHALL delete ([api.md](../../system/api.md) 110) every copy of the signal's text the app keeps: its message in the learning memory, its embedding, the copy of its text the vector index keeps beside the embedding, and every outbox row that holds it. No flush, recall or audit SHALL bring it back, and the files that held those copies SHALL be compacted after the delete, so that its text no longer stays in their bytes ([data-model.md](../../system/data-model.md) 3.15 and 5.2). The summary SHALL be rewritten without it before it is next sent (R42). Answers already given keep their record (R38). Forgetting SHALL work whatever the lever's value.
- R41. Deleting a datasource ([datasources](../datasources/spec.md) R15) SHALL forget its whole learning memory as R40 forgets a signal, whatever the lever's value: every signal with its embedding and the index's copy of its text, the summary and the outbox rows, the files then compacted. A failure to forget SHALL be logged and SHALL NOT fail the delete.
- R42. Each learning memory SHALL keep a **summary** of what its signals teach, in three parts (known pitfalls, a table guide and a learned glossary), at most 2,000 characters, rewritten by a background step after signals are retained or forgotten, from the stored signals and nothing else; the step SHALL be told never to quote a row value and never to add what no signal says. A turn SHALL NOT wait for a rewrite: it sends the summary as last written, except that after a forget no summary is sent until it has been rewritten.
- R43. Only chat turns SHALL recall; a turn's grounding pass resends its learned block without recalling again. Deep-analysis calls SHALL neither recall nor retain (Open questions). The memory eval recalls under a memory arm only, from a memory of its own (BA-190).

## Edge cases and errors

- Empty library: the screen shows "No knowledge yet" with a hint and both "New snippet" and "Generate suggestions" actions.
- Filters that match nothing: "No snippets match these filters."; with Pending suggestions active and none pending: "No pending suggestions right now — generate some or check back later."
- Backend unreachable on load: the screen shows the error text (`Backend unreachable` when no message is available). On toggle, delete or save failures a toast shows the server message or `Backend unreachable`.
- Bootstrap request fails to start: `Could not generate suggestions (<status>)`; connection failure: `Backend unreachable`; stream closes without a terminal event: `Stream interrupted` or `Stream ended unexpectedly`; empty error: `Could not generate suggestions — try again shortly`.
- Bootstrap yields zero new drafts: toast `No new suggestions this time`.
- No datasets exist: the Generate dialog's dataset picker shows "No datasets yet" and Generate is disabled.
- A snippet whose body alone exceeds the remaining budget stops the block, so a very long newest snippet can hide older ones. (Known limitation of newest-first selection; roadmap 1.3.3 replaces it.)
- Editing a snippet cannot currently clear its entities (a blank entities field is not sent) and, when the kind is not `term`, does not send synonyms, so previously stored synonyms survive. See Open questions.
- Memory on, but no embedding model can be reached (no key for it, or no network): every signal stays queued and is marked failed after its last retry, recall finds nothing, and turns go on without the learned block (R34, R36). The rating itself succeeds. With no key at all, Settings → Memory shows `No OpenAI key for embeddings: choose OpenAI in LLM configuration or set OPENAI_API_KEY. Until then nothing is remembered.` (R30).
- Memory on, a session over datasets of two datasources: a rating retains nothing (R31), and a turn recalls from both datasources' learning memories (R35).
- Memory off, an answer whose thumbs-up was retained while it was on is marked wrong, or its thumbs-down's note is changed: the answer's signal is forgotten and nothing new is retained (R39).
- Saving the memory lever fails: the switch returns to its saved state and an error toast shows the server's message.
- A signal forgotten in another window, or already deleted with its datasource: **Forget** succeeds and changes nothing.
- A forgotten signal still shows in the "Knowledge in context" of the answers that used it, since those record what the model was given (R38); later answers no longer list it. In the view where it was forgotten, its **Forget** is replaced by `Forgotten`.
- A summary entry offers no **Forget**: a summary is rewritten from the signals (R42), so it is forgotten by forgetting them.
- A thumbs-down's note longer than 1,000 characters (the answer keeps up to 4,000, [sessions-chat](../sessions-chat/spec.md) R36) is clipped in the memory only (R32), not on the answer.

## Contracts

- Endpoints: list, create, partial update and delete under the knowledge resource; bootstrap (single response) and bootstrap stream (server-sent progress, then done or error). See [../../system/api.md](../../system/api.md). The UI uses the stream variant only.
- Collection and document shape (snippet, per-answer knowledge record): see [../../system/data-model.md](../../system/data-model.md).
- Agents: the knowledge bootstrap agent (prompt requirements, output schema, draft cap) and the assistant's curated-knowledge instructions (the `curated-knowledge` skill): see [../../system/agents.md](../../system/agents.md).
- Per-answer provenance is stored on the assistant message and read by [../sessions-chat/spec.md](../sessions-chat/spec.md).
- Related: [../datasets/spec.md](../datasets/spec.md) (scope target), [../verified-queries/spec.md](../verified-queries/spec.md), [../metrics/spec.md](../metrics/spec.md) (sibling context blocks), [../agents-evals/spec.md](../agents-evals/spec.md) (eval runs reuse the block).
- Memory of past sessions (R30 to R43, [ADR-0031](../../system/architecture.md)): the `LearningStore` port, the "Mastra only" implementation, its embedding key and its summary step in [../../system/agents.md](../../system/agents.md) 2.1; the learned block (Block 3b) in agents.md 4.1; the `memory` settings document, `ChatMessage.feedbackNote`, `KnowledgeUse.source`, the `memory_signals` outbox and the learning memories in [../../system/data-model.md](../../system/data-model.md) 3.2.2, 3.4.1, 3.9, 3.15 and 5.2; the lever's endpoints and **Forget** in [../../system/api.md](../../system/api.md) 108 to 110, the memory side effects of the feedback endpoint (7) and of deleting a datasource (19). The ratings that produce signals, and the thumbs-down's note, are owned by [../sessions-chat/spec.md](../sessions-chat/spec.md) R36 and [../verified-queries/spec.md](../verified-queries/spec.md); a datasource's delete by [../datasources/spec.md](../datasources/spec.md) R15; the reviewer's-note action does not exist yet (Open questions); the three-arm memory eval of ADR-0031 by [BA-190](https://halo-powered.atlassian.net/browse/BA-190).

## UI

Placement: the **Knowledge** item on the navigation rail opens a full-width screen titled "Knowledge" in the main area (see [../../system/ui.md](../../system/ui.md)). Selecting the item again keeps the screen.

- Header: title, subtitle "Instructions, glossary terms and default filters the assistant uses when answering. Only enabled snippets are applied.", and two buttons, "Generate suggestions" and "New snippet".
- Filter row: kind pills "All", "Instruction", "Term", "Default filter" (each with a tooltip describing the kind), a "Filter by dataset" select ("All datasets" plus every dataset; shows that dataset's snippets and all global ones), and a toggle "Pending suggestions" with a count badge of mined, still-disabled snippets. Choosing a kind or dataset leaves the pending view.
- States: loading ("Loading knowledge…"), error, empty ("No knowledge yet"), filtered-empty, populated.
- Row (normal view): kind icon (colour per kind), title, kind label, a "Mined" badge for mined snippets, body, then scope ("Global" or the dataset name) and "Updated <Mon d>"; an Enabled/Disabled checkbox, an Edit button and a Delete button (with a spinner while deleting). Delete asks "Delete “<title>”? The assistant will stop using it."
- Row (Pending suggestions view): the Enabled checkbox, Edit and Delete are replaced by **Accept** (enables the snippet; toast "Snippet enabled") and **Reject** (confirmation "Reject “<title>”? This permanently removes the suggestion."; toast "Snippet deleted").
- Toasts: "Snippet enabled" / "Snippet disabled", "Snippet created", "Snippet updated", "Snippet deleted".
- New/Edit panel ("New snippet" / "Edit snippet"): Kind select (with the kind's description), Scope select ("Global" or a dataset), Title (placeholder "Always exclude test accounts"), Body, Synonyms (comma separated; shown only for kind Term), Entities (optional, comma separated). Buttons "Cancel" and "Create snippet" / "Save changes" (disabled until title and body are filled; shows "Saving…"). The panel does not edit the enabled flag; new snippets are enabled.
- Generate suggestions panel: explanation ("The assistant reviews the dataset and drafts instructions, terms and default filters as pending suggestions — nothing is applied until you approve it. This can take up to a minute."), a Dataset select (defaults to the first dataset), "Cancel" and "Generate" (shows "Generating…"; cancel is blocked while running). A live progress list shows finished stages with a check mark and the current stage with a spinner. On success the panel closes, a toast reads "<n> suggestion(s) generated — review in Pending suggestions", and the screen switches to the Pending suggestions view.
- In chat: each assistant answer that carried knowledge shows a collapsed "Knowledge in context (<n>)" disclosure listing, per snippet, its kind label, title, dataset (or "global") and body, plus the note "Curated knowledge the assistant was given before answering. Edit it under Knowledge; disabled snippets are never included." Clarification cards show it too.
- In chat, with memory on: the same disclosure lists each entry from the memory (R38) after the snippets, badged "Memory", with its title (`<kind> · <date>`, or `summary`), no dataset, and its text as sent, line by line; an entry that holds a signal offers **Forget** (R40), which asks `Forget this memory? Later answers will not use it.` in the native confirmation dialog, toasts `Memory forgotten` once done and then reads `Forgotten`. The count `<n>` includes the memory entries, and when there is one the note gains the sentence `Memory entries come from rated answers in past sessions; they are not curated.` Layout and copy: [../../system/ui.md](../../system/ui.md) 4.12 (Session chat) and section 7.
- Settings → **Memory** holds the memory lever (R30) and the line that says which key embeds the signals: [../../system/ui.md](../../system/ui.md) 4.17. The thumbs-down's note on an answer belongs to [../sessions-chat/spec.md](../sessions-chat/spec.md) R36.

## Flows

E2E: none yet.

```gherkin
Feature: Knowledge snippets (E2E: none yet)

  Scenario: The empty library invites the first snippet
    Given no knowledge snippets exist
    When I click "Knowledge" on the rail
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

E2E: `frontend/e2e/memory.spec.ts` covers every scenario of the Feature below. The app runs its real "Mastra only" memory, and the test reads what it holds straight from its two files: the `memory_signals` outbox in `app.sqlite` and the learning memories in `mastra.sqlite`. Two local stubs stand in for the models. The recording LLM stub, saved as the LenAI provider, answers each turn with one query on the World Cup database and writes the summary. An embeddings stub stands in for OpenAI `text-embedding-3-small`, reached through `OPENAI_BASE_URL` with the key from `OPENAI_API_KEY`; its vectors are a bag of a question's content words, so a paraphrase is found and an unrelated question is not. In "An approval in one session informs a question in another language" the stub gives both questions one vector, so the scenario proves the path from the rating to the disclosure, not that a real model finds the Spanish question: that, and whether the assistant follows curated knowledge over a contradicting memory, is measured on a real model by the memory eval of [BA-190](https://halo-powered.atlassian.net/browse/BA-190). "Turning memory on in Settings" and "No key for embeddings" seed the saved provider by rewriting the provider of the stored LenAI settings, since saving OpenAI or Anthropic tests the connection on that provider. The same rules are also covered by backend and frontend unit tests, listed after the Feature, which also cover what no scenario shows (R34's retries, R31 with several datasources, R43).

```gherkin
Feature: Memory from past sessions

  # R30
  Scenario: Memory is off by default
    Given the memory lever was never changed
    When I open Settings and click "Memory"
    Then the switch "Memory of past sessions" is off
    And I see "When on, a thumbs-up or thumbs-down on an answer that ran SQL is remembered and offered to later sessions on the same datasource, after curated knowledge. Off by default."
    When I give an answer a thumbs-up and ask a similar question in a new session on the same datasource
    Then nothing was retained in a memory
    And the new answer's "Knowledge in context" lists no entry badged "Memory"
    And no text was sent to the embedding model

  # R30
  Scenario: Turning memory on in Settings
    Given the saved LLM configuration uses the provider OpenAI
    When I open Settings, click "Memory" and turn on "Memory of past sessions"
    Then I see the toast "Memory turned on"
    And the switch stays on after a reload
    And I see "Embeddings: OpenAI text-embedding-3-small, with the key saved in LLM configuration."
    When I turn it off
    Then I see the toast "Memory turned off"

  # R30
  Scenario: The key from the environment embeds when the provider is not OpenAI
    Given the saved LLM configuration uses the provider LenAI and OPENAI_API_KEY is set
    When I open Settings and click "Memory"
    Then I see "Embeddings: OpenAI text-embedding-3-small, with OPENAI_API_KEY from the environment."

  # R30
  Scenario: No key for embeddings
    Given the saved LLM configuration uses the provider Anthropic and OPENAI_API_KEY is not set
    When I open Settings and click "Memory"
    Then I see "No OpenAI key for embeddings: choose OpenAI in LLM configuration or set OPENAI_API_KEY. Until then nothing is remembered."

  # R31, R33, R36, R38
  Scenario: An approval in one session informs a question in another language
    Given memory is on
    And in one session I gave a thumbs-up to the answer to "Who was the top scorer of the 2018 World Cup, excluding own goals?"
    When I start a new session on the same datasource and ask "¿Quién fue el máximo goleador del Mundial 2018?"
    Then the answer's "Knowledge in context" lists an entry badged "Memory" whose text starts "[verified_query · "
    And its next lines read "Question: Who was the top scorer of the 2018 World Cup, excluding own goals?" and "Approved SQL: "
    And the disclosure's note ends "Memory entries come from rated answers in past sessions; they are not curated."
    And no Knowledge snippet, metric or verified query was created or changed by the memory

  # R31, R33
  Scenario: A thumbs-down is kept as a rejection, with its note when it has one
    Given memory is on
    When I click "Mark answer as wrong" under an answer
    And I click "Add a note", type "It counted a match won on penalties as a win." into "What was wrong?" and click "Save note"
    Then the memory holds a signal whose first line starts "[rejection · ", with the lines "Rejected SQL (do not reuse): " and "Analyst note: It counted a match won on penalties as a win."
    When I mark another answer as wrong without a note
    Then the memory holds a signal with the line "Rejected SQL (do not reuse): " and no "Analyst note" line
    And neither signal is a correction, and none of their lines reads "Approved SQL" or "Final SQL"

  # R32
  Scenario: Row values never reach the memory
    Given memory is on
    And an answer to "How many goals did the top scorer of 2022 score?" ran SQL that filters on 'Lionel Messi' and on 'own_goal'
    When I give it a thumbs-up
    Then the memory's copy of that SQL reads '?' in place of 'Lionel Messi'
    And it keeps 'own_goal'

  # R36, R37
  Scenario: Curated knowledge comes first and is said to win
    Given memory is on
    And an enabled snippet scoped to the session's dataset says the fiscal year runs July to June
    And the memory holds a rejection whose note says the fiscal year is the calendar year
    When I ask a question about revenue in fiscal year 2025
    Then the turn sends the snippet in the curated-knowledge block and the rejection in the "Learned from past sessions (not curated; curated knowledge wins on conflict)" block after it
    And the snippet is unchanged

  # R39
  Scenario: Rating an answer again, or changing its note, replaces what it taught
    Given memory is on and I gave an answer a thumbs-up
    When I mark the same answer as wrong
    Then the memory no longer holds its approval
    And it holds one rejection of that answer
    When I add the note "It joined goals to the wrong team." to that thumbs-down
    Then that rejection's last line reads "Analyst note: It joined goals to the wrong team."
    And the memory holds no correction of that answer
    When I clear the note
    Then that rejection has no "Analyst note" line

  # R30, R39
  Scenario: With memory off, re-rating an answer forgets what it taught
    Given memory is on and I gave an answer a thumbs-up
    When I turn memory off and mark the same answer as wrong
    Then the memory holds no signal of that answer

  # R40, R42
  Scenario: Forget a memory
    Given an answer's "Knowledge in context" lists an entry badged "Memory" that holds a signal
    And the entry titled "summary" beside it offers no "Forget"
    When I click "Forget" on it
    Then the confirmation dialog asks "Forget this memory? Later answers will not use it."
    When I accept it
    Then I see the toast "Memory forgotten"
    And the entry is still listed, and reads "Forgotten" where "Forget" was
    And the memory no longer holds that signal, its embedding or the index's copy of its text, nor any outbox row of it
    And once the files are compacted, no byte of mastra.sqlite holds its note and no byte of app.sqlite holds its outbox row
    And no later answer lists it, in the summary or as an entry

  # R41
  Scenario: Deleting a datasource forgets what its sessions taught
    Given memory is on and holds an approval from a session on the datasource "World Cup"
    When I delete the datasource "World Cup" and confirm
    Then the memory holds no signal and no summary of that datasource

  # R36
  Scenario: A memory that does not answer in time does not hold up a turn
    Given memory is on and recall takes longer than 2.5 seconds
    When I ask a question
    Then the answer comes without a learned block after at most 2.5 seconds spent on recall
    And its "Knowledge in context" lists no entry badged "Memory"

  # R30
  Scenario: Turning memory off keeps what it learned
    Given memory is on and holds an approval relevant to my question
    When I turn memory off in Settings and ask the question
    Then nothing is recalled
    When I turn memory on again and ask it again
    Then the approval is listed as a "Memory" entry
```

Covered by (unit tests; backend under `backend/src/modules/memory/` unless another folder is named):
- *Memory is off by default*: `memory.service.spec.ts` "reads off when no settings document exists", "neither builds nor calls a memory for a rating, a turn or a flush" and "recalls nothing and sends no block"; `backend/src/modules/sessions/sessions.service.spec.ts` "with the lever off, sends exactly the context of a turn without memory".
- *Turning memory on in Settings*, *The key from the environment embeds when the provider is not OpenAI*, *No key for embeddings*: `memory.service.spec.ts` "saves the lever as the `memory` settings document" and "refuses anything but true or false"; `memory.controller.spec.ts`; `embedding-key.spec.ts`; `openai-embedder.spec.ts`; `backend/src/modules/llm/llm.service.spec.ts` "the OpenAI key for the memory embeddings"; `frontend/src/app/features/memory/components/memory-settings/memory-settings.spec.ts`.
- *An approval in one session informs a question in another language*: `mastra-learning-store.spec.ts` "stores one message per signal and recalls it for a paraphrase", "drops an unrelated question with the 0.4 threshold" and "recalls from its own scope only"; `memory.service.spec.ts` "writes an approval for a thumbs-up, its SQL redacted" and "recalls each datasource once and builds the block"; `learned-block.spec.ts`; `sessions.service.spec.ts` "records its entries on the answer after the snippets" and "hands it the rating, the question and the SQL once the transcript is saved"; frontend `session-chat.spec.ts` "shows the Memory badge, lines and the footer sentence".
- *A thumbs-down is kept as a rejection, with its note when it has one*: `signal-text.spec.ts` "writes a rejection with its note line only when it has a note"; `memory.service.spec.ts` "writes a rejection for a thumbs-down, with its note only when it has one"; `sessions.service.spec.ts` "keeps the note of a thumbs-down, trimmed, and replaces or removes it".
- *Row values never reach the memory*: `signal-text.spec.ts`, the `redactSqlLiterals` tests (a name or an email replaced, category codes and the question's own literals kept, `LIKE` wildcards, numbers) and "clips the SQL at 2,000 characters and the note at 1,000".
- *Curated knowledge comes first and is said to win*: `sessions.service.spec.ts` "sends it after curated knowledge and before the verified reference queries"; `learned-block.spec.ts` "puts the summaries first, then the signals oldest first, a blank line apart".
- *Rating an answer again, or changing its note, replaces what it taught*: `memory.service.spec.ts` "replaces the answer’s one row when it is rated again"; `memory-outbox.service.spec.ts` "replaces the row of a document id whatever its state" and "keeps a row replaced during a flush pending for the next one"; `mastra-learning-store.spec.ts` "replaces a stored id in place: one message, one vector, the new text".
- *With memory off, re-rating an answer forgets what it taught*: `memory.service.spec.ts` "forgets what an earlier rating of the answer retained, without compacting".
- *Forget a memory*: `memory.service.spec.ts` "deletes the outbox rows, then the store’s copies, then compacts both files", "also forgets a copy the store holds with no outbox row", "changes nothing for an unknown or already forgotten id" and "runs a failed compaction again at the next start"; `mastra-learning-store.spec.ts` "forgets a signal: its message, its vector and the index copy of its text", "leaves no forgotten text in the file once compacted" and "is not sent after a forget until it is rewritten"; `backend/src/infrastructure/database/sqlite-maintenance.spec.ts` "leaves no text of a deleted document in the file"; frontend `session-chat.spec.ts` "calls the API only after confirm, then shows Forgotten" and "offers no Forget on the summary entry".
- *Deleting a datasource forgets what its sessions taught*: `memory.service.spec.ts` "forgets its rows and its whole learning memory, then compacts" and "never throws"; `mastra-learning-store.spec.ts` "forgets a whole scope with its summary"; `backend/src/modules/datasources/datasources.service.spec.ts` "forgets the datasource's learning memory when it is deleted (knowledge R41)".
- *A memory that does not answer in time does not hold up a turn*: `memory.service.spec.ts` "leaves out a memory that does not answer within 2.5 seconds"; `mastra-learning-store.spec.ts` "gives nothing when recall does not answer within the cut-off".
- *Turning memory off keeps what it learned*: `memory.service.spec.ts` "saves the lever as the `memory` settings document" and "recalls nothing and sends no block".
- In no scenario: the outbox's retries and giving up (R34), `memory-outbox.service.spec.ts` "retries after 30 s, doubling, and gives a row up after the 5th failure" and "flushes on its own 2 s after the last write"; a session over several datasources (R31, R35), `memory.service.spec.ts` "retains nothing without one datasource, a question or SQL"; the grounding pass and deep analysis (R43), `sessions.service.spec.ts` "resends the same block in the grounding pass without recalling again" and "gives a deep-analysis call none, and recalls nothing for it"; the summary's budget (R42), `mastra-learning-store.spec.ts` "is clipped to 2,000 characters".

## Acceptance

- Every Gherkin scenario above passes against the running app (backend tests cover R1-R28 at service level).
- With a snippet enabled for a dataset, an answer in a session over that dataset records it in "Knowledge in context"; after disabling or deleting it, the next answer does not.
- With a default-filter snippet enabled, the generated SQL applies it and the answer names it.
- A bootstrap run on the sample dataset yields at most 15 disabled, mined, dataset-scoped drafts and none duplicates an existing title for that dataset.
- With the memory lever off, the default, answers and what is stored are the same as without the memory, and no memory is called (R30).
- Whether memory may be on by default is decided by the three-arm eval of ADR-0031 (no memory, "Mastra only", "Hindsight + Mastra") on 36 memory questions in six categories, under the decision rule written in the ADR before the first run; the eval's arm option and two-part questions are [BA-190](https://halo-powered.atlassian.net/browse/BA-190)'s, the questions, the "Mastra only" memory and the decision this story's ([BA-81](https://halo-powered.atlassian.net/browse/BA-81)). Until the rule allows it, the lever stays off by default. Decided on 2026-11-02 (ADR-0031, Outcome): "Mastra only" beats no memory on the learning categories, but `memory-abstain` gets worse, so the lever stays off by default and no Hindsight arm is built.
- In that eval no item the memory holds after a teach step holds a row value, on every question and every arm (R32).
- Open question: parts of roadmap Milestone 1.3 Knowledge Store (BA-4) already exist in code: authoring of the three kinds, dataset/global scoping, bootstrap from schema and samples (reviewed as pending suggestions), newest-first injection under a character budget, and per-answer "Knowledge in context" provenance. Not yet built: the ontology/concept graph (1.3.2), question-relevance retrieval (1.3.3), mining from past sessions and thumbs-up answers, conflict detection and correction feedback (1.3.4).

## Open questions

- Open question: a snippet whose scope has only a datasource id is stored but never selected for the assistant (selection requires a dataset match or no scope). Is datasource scoping intended to work, and should the authoring UI offer it?
- Open question: editing in the UI cannot clear entities and does not clear stale synonyms when switching a term to another kind. Intended, or a bug to fix in the rebuild?
- Open question: the "Pending suggestions" view hides the Edit action; a mined suggestion can only be edited after it is accepted. Intended?
- Open question: the `source: user | mined` distinction of the stored shape allows mining from past sessions (roadmap 1.3.2); only dataset schema/sample mining exists today.
- Open question: the non-streaming bootstrap endpoint exists but nothing in the UI calls it. Keep it as part of the public contract?
- Open questions of the memory of past sessions (R30 to R43), each written above with the draft's default unless marked decided; the ids are those of the BA-4 memory prep notes (`specs/NOTES.md` of that work), where each decision's options are listed:
  - OD-1, decided by the user on 2026-11-02: one learning memory per datasource, not per dataset (R35).
  - OD-2, decided by the user at checkpoint B on 2026-10-30: the embedding model is OpenAI `text-embedding-3-small` (1536 dimensions), the same for every arm of the eval ([../../system/agents.md](../../system/agents.md) 2.1).
  - OD-21, decided by the user on 2026-11-02: the OpenAI key used for embeddings is the saved LLM settings' key when their provider is OpenAI, otherwise `OPENAI_API_KEY` from the environment; with neither, nothing is remembered or recalled and Settings → Memory says so (R30; the rule: [../../system/agents.md](../../system/agents.md) 2.1). The LLM settings keep one provider and one key ([../llm-settings/spec.md](../llm-settings/spec.md) R2); no second key is stored.
  - OD-4: the relevance threshold and the number of signals recalled (measured defaults 0.4 and 4 from each learning memory, R36, to recalibrate on the memory eval's dev questions), and the block's budget (6,000 characters, agents.md 4.1).
  - OD-10, decided by the user on 2026-11-02: the `memory` lever is the switch of a **Memory** section in Settings ([../../system/ui.md](../../system/ui.md) 4.17), read and saved through [../../system/api.md](../../system/api.md) 108 and 109 and stored as the `memory` settings document ([../../system/data-model.md](../../system/data-model.md) 3.2.2) (R30).
  - OD-11, decided by the user at checkpoint D on 2026-10-30: a thumbs-down, with or without a note, retains a rejection (its note is the rejection's `Analyst note`), and a correction comes only from a reviewer's note, an action of its own (R31, R39). The thumbs-down's note is built with this story ([../sessions-chat/spec.md](../sessions-chat/spec.md) R36, [../../system/api.md](../../system/api.md) 7, [../../system/data-model.md](../../system/data-model.md) 3.4.1). Still open: the **reviewer's-note action**, left out of this version by the user on 2026-11-02, so the app retains no correction until it exists (R31); its control, copy, endpoint and where the note is kept are to be specified then. The port, the signal text of R33, the `correction:` document id (data-model 3.15) and the memory eval already take corrections. Still a draft default: cross-check disagreements and Knowledge edits are not retained (R31).
  - OD-12: whether the summary of R42 is sent in the learned block (default: yes, before the signals).
  - OD-14, decided on 2026-11-02: **Forget** (R40) is [../../system/api.md](../../system/api.md) 110, confirmed with the app's native confirmation dialog ([../../system/ui.md](../../system/ui.md) section 2).
  - OD-16: whether deep-analysis calls recall (default: no, R43).

<!-- sources: backend/src/modules/knowledge/**, backend/src/mastra/agents/knowledge-bootstrap.agent.ts, backend/src/mastra/skills/curated-knowledge/SKILL.md, backend/src/mastra/context-blocks.ts (knowledgeContext), backend/src/modules/sessions/sessions.service.ts (agentContext, knowledgeUsed), backend/src/modules/agents/eval-runs.service.ts, frontend/src/app/features/knowledge/**, frontend/src/app/features/sessions/components/session-chat/session-chat.html (knowledgeApplied), frontend/src/app/app.html (Knowledge nav) -->

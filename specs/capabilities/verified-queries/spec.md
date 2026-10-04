# Verified queries

When a user approves an answer with a thumbs-up, the system keeps that answer's question and the SQL that produced it as a **verified query**. Verified queries are the user-approved memory of "this question was answered correctly this way". They are shown back to the assistant (and to the independent SQL verifier) when a similar question comes up, they badge any later answer that reproduces the same SQL as "Verified", and they are the source from which a metric definition can be promoted. There is no screen for browsing them: the library is built and pruned only through the rating buttons on answers.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): verified query, answer, rating (thumbs-up / thumbs-down), session, datasource, entity, assistant, SQL verifier, metric.

## Rules

Creation and removal
- R1. When the user gives an assistant answer a thumbs-up, the system SHALL record that answer's rating and mark the answer "verified".
- R2. On a thumbs-up the system SHALL save a verified query holding: the user question (the closest user message before the answer, trimmed), the SQL (the answer's last successful read-only SQL statement, trimmed), the session's datasource when exactly one datasource is involved, the answer's source entities (empty when none), and the source session and answer timestamp.
- R3. The system SHALL NOT save a verified query when the answer ran no successful SQL, or when no preceding user question with text exists. The rating itself SHALL still be recorded and the answer still marked verified.
- R4. A verified query SHALL be unique per source answer (session id plus answer timestamp). Saving again for the same answer SHALL replace the stored pair, not create a second one.
- R5. On a thumbs-down the system SHALL delete the verified query that came from that answer (if any), record the rating, and remove the "verified" mark from the answer, even if its SQL is still stored in the library from elsewhere.
- R6. The system SHALL reject a rating other than up or down (`rating must be 'up' or 'down'`), a missing answer timestamp (`messageAt is required`), and an answer that does not exist (`No assistant message at <timestamp>`).
- R7. Deleting a session SHALL NOT delete the verified queries that came from it (see Open questions).

Retrieval
- R8. For every chat turn, deep-analysis call and SQL-verifier pass the system SHALL look up stored pairs similar to the user's question. Similarity SHALL be lexical: lowercase the text, split on non-alphanumeric characters, drop one-character tokens and common stopwords, and score the overlap of the two token sets (shared tokens divided by distinct tokens in either). Pairs with a zero score SHALL be ignored.
- R9. The system SHALL return the top three pairs by score and render them as one block "Verified reference queries (user-approved earlier — reuse their tables, joins and filters when the question is similar)", each as `Q: <question>` and `SQL: <sql>`. The block SHALL be limited to 3,000 characters, stopping at the first pair that does not fit. When nothing matches, no block SHALL be added.
- R10. The block SHALL be sent as a system message after the metric definitions and the knowledge block. Retrieval is across all sessions and datasources; it SHALL NOT be restricted to the current session's datasets.
- R11. A failure to read the library while preparing the SQL verifier SHALL be treated as "no references", not as an error.

Verified badge
- R12. After each assistant answer that ran SQL, the system SHALL compare the answer's final successful statement with the library. Two statements match when they are equal after lowercasing, collapsing whitespace to single spaces and dropping trailing semicolons; a paraphrase is not a match.
- R13. A stored pair with no datasource SHALL match any datasource; otherwise the stored datasource SHALL equal the session's sole datasource (when the session's datasource is ambiguous, datasource SHALL NOT be checked).
- R14. On a match the answer SHALL be marked verified. A failing lookup SHALL leave the answer unmarked and SHALL NOT fail the turn.

Promotion to metrics
- R15. Verified queries that have entities SHALL be offered as metric drafts. See [../metrics/spec.md](../metrics/spec.md).

Migration
- R16. Verified queries stored under the former source-project field SHALL be rewritten to the source-session field on startup, so they are still found for dedupe and not duplicated by the next thumbs-up.

## Edge cases and errors

- Re-clicking an already-selected thumb does nothing in the UI. Via the API, a second thumbs-up for the same answer replaces the stored pair (R4).
- Switching thumbs-down to thumbs-up on an answer re-saves its pair; thumbs-up to thumbs-down removes it.
- Rating an answer that ran no SQL (a plain-text reply) is not offered in the UI: the thumbs are shown only on answers that carry retrieved data.
- The rating request is answered successfully (HTTP 200) with a failure flag and message on error; the UI shows the message in an error toast (`Could not save feedback` if none) and rolls the thumb back to its previous state.
- Success messages: thumbs-up `Answer saved as a verified query`, thumbs-down `Answer marked as wrong`.
- An answer rated thumbs-up has its previous pair replaced in the library even when the user's earlier question text changed, because identity is the answer, not the question.
- Re-saving a pair for the same answer produces a new library id for it (see Open questions); anything that referenced the old id (a metric's source) loses that link.
- Library growth is unbounded and there is no UI to delete a pair other than rating its source answer down.

## Contracts

- Rating endpoint on a session's messages (feedback): see [../../system/api.md](../../system/api.md). There is no list/delete endpoint for verified queries; they are internal to the backend. The metrics candidates endpoint exposes them indirectly.
- Collection `verified_queries` and the answer's `verified` / `feedback` fields: see [../../system/data-model.md](../../system/data-model.md).
- Agents using the reference block: the assistant (chat and deep analysis) and the SQL verifier: see [../../system/agents.md](../../system/agents.md).
- Related capabilities: [../sessions-chat/spec.md](../sessions-chat/spec.md) (rating UI and verification), [../metrics/spec.md](../metrics/spec.md), [../knowledge/spec.md](../knowledge/spec.md), [../deep-analysis/spec.md](../deep-analysis/spec.md).

## UI

No dedicated screen. The surface lives in the chat (see [../../system/ui.md](../../system/ui.md)):

- Under an answer that carries retrieved data, two small buttons: thumbs-up "Save as verified query" and thumbs-down "Mark answer as wrong". They show when hovering the answer (always visible once selected), expose a pressed state, are disabled while the request is in flight, and change title to "Saved as verified query" / "Marked as wrong" once selected. A green thumbs-up means the pair is stored.
- A green "Verified" badge (tooltip "Matches an approved query") beside the answer's actions, shown when the answer is marked verified.
- Toasts on success: "Answer saved as a verified query" / "Answer marked as wrong".
- Approved questions reappear as the "Promote a verified answer" suggestions in the metrics panel.

## Flows

E2E: none yet.

```gherkin
Feature: Verified queries (E2E: none yet)

  Scenario: Approve an answer
    Given I asked a question in a session and the assistant answered using SQL
    When I click "Save as verified query" under the answer
    Then I see the toast "Answer saved as a verified query"
    And the answer shows a "Verified" badge
    And the thumbs-up is shown as selected

  Scenario: A similar question later reuses the approved SQL
    Given I approved an answer to "How many goals did Brazil score in 2022?"
    When I ask "How many goals did Brazil score in 2018?" in any session
    Then the assistant is given the approved question and SQL as a reference
    And its answer is built on the same tables and joins

  Scenario: An answer that repeats an approved query is badged
    Given I approved an answer whose SQL is "SELECT count(*) FROM matches"
    When a later answer in the same datasource ends with the same statement
    Then that answer shows a "Verified" badge without my rating it

  Scenario: Withdraw an approval
    Given an answer is marked "Verified" because I rated it thumbs-up
    When I click "Mark answer as wrong" under it
    Then I see the toast "Answer marked as wrong"
    And the "Verified" badge disappears
    And the question and SQL are no longer offered as a reference

  Scenario: Rating a failing request rolls back
    Given the backend rejects the rating
    When I click "Save as verified query"
    Then I see an error toast
    And the thumb returns to its previous state

  Scenario: Answers without data cannot be rated
    Given the assistant replied with plain text and ran no query
    Then no thumbs-up or thumbs-down buttons appear under that reply
```

## Acceptance

- Every scenario above passes; backend tests cover similarity ranking, stopword handling, k cap, SQL normalisation, datasource matching and the trim/key behaviour of saving (R2, R4, R8-R13).
- After a thumbs-up, a similar question's turn includes the approved pair in its context; after a thumbs-down it does not.
- The legacy field rewrite (R16) leaves no document keyed by the former field.

## Open questions

- Open question: a session's deletion leaves its verified queries behind (R7), with a dangling source-session reference. Should deletion cascade, or should approved pairs outlive their session on purpose?
- Open question: the library is global (retrieval ignores datasets and datasources, only the badge check looks at the datasource). Should retrieval be restricted to the session's datasets?
- Open question: saving a pair for an already-stored answer replaces the document including its id, so a metric promoted from the old id is orphaned. Should the id be preserved on upsert?
- Open question: there is no way to browse, edit or delete verified queries directly. Roadmap Milestone 1.3 (Knowledge Store) plans to link verified queries to concepts; is a management screen planned?

<!-- sources: backend/src/modules/verified-queries/**, backend/src/modules/sessions/sessions.service.ts (recordFeedback, matchesVerifiedQuery, agentContext, deriveIndependentSql), backend/src/modules/sessions/sessions.controller.ts (messages/feedback), backend/src/modules/sessions/entities/session.entity.ts, backend/src/modules/metrics/metrics.service.ts (candidates), frontend/src/app/features/sessions/components/session-chat/session-chat.html + .ts (rateMessage) -->

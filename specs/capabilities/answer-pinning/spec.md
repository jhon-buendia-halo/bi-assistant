# Answer pinning

Asking the same question twice should give the same answer, but a hosted language model does not reliably repeat itself even at its most deterministic settings. Answer pinning makes consistency an explicit layer. After a chat answer is checked and saved, it becomes the **answer pin** of its question's **lineage**: the same normalised question, over the same datasets, after the same earlier questions, in the same mode. When the question is asked again, the system re-runs the pinned query live. If the curated context it was answered under is unchanged and the query returns the same rows, the stored answer is replayed word for word with no model call. When the context changed, for example after a reviewer taught a lesson, or the data moved, the question is answered afresh. If the numbers held, the earlier wording is kept; otherwise the answer is marked updated. Thumbs up and down approve or reject the pin.

## Concepts

All terms are defined in [glossary](../../product/glossary.md): **Answer pin**, **Lineage key**, **Fingerprint**, **Consistency verdict** (replay, kept, updated), **Answer query**, **Lesson**, **Turn**, **Careful mode**, **Business expert mode**, **Verified query**, **Clarification**, **Agent memory thread**.

## Rules

### When a turn is pinned

- R1. Pinning SHALL apply only to streamed chat turns that ask for it. The streamed-message endpoint asks for it unless the request says `pin: false`. The turn itself defaults to no pinning, so every caller other than that endpoint (the developer eval harness, the in-app eval runner, deep analysis) never replays and never writes a pin; evals always measure the engine, never a stored answer. The shipped chat never sends `pin`, so all its turns are pinned.
- R2. A turn SHALL NOT be replayed or pinned when the client sent an open visual with it, or when it answers a clarification card (its meaning lives in the card).
- R3. A turn's **lineage** SHALL be identified by four things:
  - the question, normalised: lower-cased, whitespace runs collapsed, trimmed, and trailing `?`, `.` and `!` removed;
  - the session's dataset names, in any order;
  - the **chain**: every earlier user message in the session, normalised the same way, in order;
  - the **mode**: `expert` when business expert mode is on, else `careful` when Careful is on, else `plain`.

  A rephrased question, the same question after different earlier questions, or the same question in another mode is a different lineage. Exact key derivation: [data-model.md](../../system/data-model.md) 3.11.
- R4. A turn's **fingerprint** SHALL capture everything that legitimately changes the answer without changing the question:
  - the curated knowledge the turn is given (identity, kind, title and body of each entry that fit the budget, in block order; synonyms, entities and sample values do not count);
  - the governed-metrics block text;
  - the verified-reference block text for this question;
  - the bound datasets' schema (dataset names, tables, entity keys, column names and types; never sample values);
  - the configured model and reasoning effort.

  It is computed from the context the turn was just given, before any model call.
- R5. A fresh answer SHALL become its lineage's pin only when all of these hold:
  - its answer query ([sessions-chat](../sessions-chat/spec.md) R52) ran without error, was not truncated, returned between 1 and 200 rows and drew no result warning;
  - the turn asked no clarification, created or updated no visual and had no open visual;
  - the answer text is not empty;
  - the session's datasets are bound to exactly one datasource;
  - in expert mode, the answer carries a reasoning trace;
  - the turn was not stopped.
- R6. A lineage SHALL have at most one pin. Saving one SHALL replace the whole previous pin, never merge into it. The pin holds:
  - the lineage key, fingerprint and its parts, the question, datasets, chain and mode;
  - the datasource, the answer query's SQL, columns, rows (at most 200), row count and the row limit used to re-run it (100);
  - the saved answer message without its time, rating, token usage and consistency verdict, and with its trace's block ratings removed;
  - the ids of the knowledge entries the answer was given;
  - the source session and answer time;
  - a replay count.

  A fresh pin carries no rejection.

### Replay

- R7. Before the model runs, the system SHALL look up the lineage's pin. It SHALL replay the pin only when the pin is not rejected, its fingerprint equals the turn's, and its datasource is the one the session resolves to now. To replay, the system re-runs the pinned SQL read-only, with a row limit of the larger of (pinned row count + 1) and the pin's row limit. It then compares the live rows with the pinned rows: the same number of rows and the same rows as a multiset. Comparison uses the sessions-chat normalisation (column names and order ignored, numbers to six significant digits, text trimmed and case-folded) and requires the same column count. When they match, the stored answer is the reply:
  - It is persisted as a new assistant message identical to the pinned one, with its own time and the verdict `replay` (pinned answer time, source session, re-verified time).
  - It is streamed as one `text` event carrying the full answer, then `done`.
  - No model call is made: no reasoning, tool activity, cross-check or explanation.
  - The pin's replay count goes up by one and its last-replayed time is set.
- R8. When any condition of R7 fails, or the re-run fails, the turn SHALL be answered afresh as usual. Stopping during the re-run SHALL persist nothing and send no `done`.
- R9. A replayed exchange never reaches the agent, so the next turn that does reach it SHALL first catch memory up. It sends every contiguous replayed (question, answer) pair just before the new question, oldest first, ahead of that question. A session whose memory thread does not exist yet sends its whole transcript as usual ([sessions-chat](../sessions-chat/spec.md) R47).

### Answering afresh against an existing pin

- R10. When the lineage already has a pin and the fresh answer is eligible (R5), the system SHALL compare the fresh answer query's rows with the pinned rows, using the R7 rule:
  - **Same rows, pin not rejected**: the answer text SHALL be replaced by the pinned wording, with the verdict `kept` (pinned answer time and source session). Everything else on the message (data, trace, badges) is this turn's own.
  - **Same rows, pin rejected**: no verdict is claimed. The answer stands as derived and a warning is logged that a fresh derivation reproduced a rejected answer.
  - **Different rows**: the verdict SHALL be `updated` (pinned answer time and source session), listing the titles of the lessons learned from feedback that this turn was given and the pin was not (compared by knowledge id). The list is left out when there are none.

  The fresh answer then becomes the lineage's pin (R6), under the turn's fingerprint.
- R11. An answer that is not eligible SHALL leave the existing pin untouched and carry no verdict. An answer to a lineage that has no pin carries no verdict either.
- R12. The pin SHALL be saved only after the transcript is persisted, so a pin never points at an unsaved answer. Any failure while looking up, replaying or saving a pin SHALL be logged and the turn SHALL continue without pinning. Pinning never breaks a turn.

### Ratings

- R13. A **thumbs-down**, on the whole answer ([sessions-chat](../sessions-chat/spec.md) R36) or on any reasoning block ([business-expert](../business-expert/spec.md) R21), SHALL mark the rated answer's lineage pin as rejected, recording the time and, for a block, the block. A whole-answer thumbs-down clears any block recorded earlier. A rejected pin is kept so the next fresh answer can still be compared with it (R10), but it SHALL never be replayed and its wording SHALL never be kept.
- R14. A **thumbs-up**, on the whole answer or on the SQL block, SHALL approve the lineage's pin when the rated answer's text equals the pinned answer's text. An older answer of the same lineage whose wording the pin no longer holds is left alone. Approval:
  1. recomputes the pin's fingerprint as a turn asking the lineage's question would compute it now (the thumbs-up just changed the verified-reference block for it);
  2. marks the pinned message verified and rescores its trace ([business-expert](../business-expert/spec.md) R14);
  3. lifts any rejection.

  The next ask of that lineage then replays the approved answer.
- R15. The lineage of a rated answer SHALL be computed from:
  - the user message it answered;
  - the user messages before that;
  - the session's datasets;
  - the mode read off the answer: a reasoning trace means `expert`, a cross-check verdict means `careful`, anything else `plain`.

### Maintenance

- R16. Pins SHALL be listable, newest first and optionally only those whose datasets include a named dataset. The list shows lineage key, question, datasets, mode, fingerprint, source session, source answer time, replay count, rejection time and last update, and never rows or the message. Pins SHALL be deletable per dataset or per lineage. No screen offers these. Deleting a session or a dataset does not delete pins.

### UI

- R17. An answer with a verdict SHALL show a chip in its action row, after the cross-check chip:

  | Verdict | Label | Tooltip | Style |
  |---|---|---|---|
  | `replay` | `Same answer as <Mon d> · re-verified` (pinned answer's date) | This exact question was answered before under the same knowledge; its query was re-run just now and returned the same data. | muted |
  | `kept` | `Same numbers · wording kept` | The context behind this answer changed, so the query was re-derived — it returned the same numbers as before, so the earlier wording was kept. | muted |
  | `updated` | `Updated after learning` | `Updated after learning: <lesson titles>`, or `Updated after learning.` when none | amber |

## Edge cases and errors

| Situation | Behaviour |
|---|---|
| Same question asked again in the same session | Not replayed: the earlier ask is now in the chain, so it is a new lineage. Answered afresh, and that answer is pinned under the new lineage (see Open questions). |
| Same question in a new session, same datasets, nothing changed | Replayed (R7). |
| A rephrased question ("total sales" vs "sales total") | New lineage; answered afresh. Case, spacing and trailing `?`/`.`/`!` do not matter. |
| Any knowledge, metric, verified query, schema or model change on the datasets | Fingerprint moves; one fresh derivation per lineage, then `kept` when the numbers held, `updated` when they did not. |
| The data behind the pinned query changed | The re-run differs; answered afresh and marked `updated` even when nothing was learned (see Open questions). |
| A session spanning several datasources | Never replayed, never pinned. |
| The pinned query now fails | Logged; answered afresh. |
| A result that hit the row limit, carried a warning, or returned no rows | Never pinned. |
| Expert ask of a question pinned in plain or careful mode (or the reverse) | Different lineage; no replay. |
| Expert answer whose trace could not be built | Not pinned. |
| Pin storage failing | Logged; the turn completes unpinned. |

## Contracts

- Endpoints in [api.md](../../system/api.md): the streamed message's `pin` flag and its replay behaviour (3.1); `GET /answer-pins`, `DELETE /answer-pins`, `DELETE /answer-pins/:lineageKey` (2.12).
- Data in [data-model.md](../../system/data-model.md): the `answer_pins` collection with the lineage key and fingerprint derivation (3.11), and `ChatMessage.consistency` (3.4.5).
- Turn orchestration (where pinning sits in a turn, the memory catch-up): [agents.md](../../system/agents.md) 4.3, 5.1 and 5.7.
- Why consistency is an explicit replay layer: ADR-0010 in [architecture.md](../../system/architecture.md).
- Related: [sessions-chat](../sessions-chat/spec.md) (turns, ratings, the answer query), [business-expert](../business-expert/spec.md) (traces, block ratings, lessons), [knowledge](../knowledge/spec.md) (what the fingerprint hashes), [agents-evals](../agents-evals/spec.md) (evals never replay).

## UI

The verdict chip sits in the answer's action row ([ui.md](../../system/ui.md) 4.12). There is no other screen: pins are inspected and cleared only through the API.

## Flows

### Feature: Answer pinning

E2E: none yet.

```gherkin
Feature: Answer pinning

  Background:
    Given a "World Cup" dataset bound to one PostgreSQL datasource
    And in the session "First look" I asked "Who won the 2022 World Cup?" and got an answer from one query returning 1 row

  Scenario: The same question in a new session is replayed word for word
    When I open a new session over "World Cup"
    And I ask "who won the 2022 world cup"
    Then the answer is identical, word for word, to the one in "First look"
    And it shows "Same answer as <date> · re-verified"
    And the Thinking block showed no tool activity

  Scenario: Asking again in the same conversation answers afresh
    When I ask "Who won the 2022 World Cup?" again in "First look"
    Then the answer is derived afresh, with its own "Data used"
    And it shows no "re-verified" chip

  Scenario: A follow-up after a replay keeps the conversation context
    Given a new session whose first answer was replayed
    When I ask "And who did they beat in the final?"
    Then the assistant answers about the 2022 final

  Scenario: A context change with the same numbers keeps the wording
    Given a new knowledge entry was enabled for "World Cup"
    When I ask "Who won the 2022 World Cup?" in a new session
    Then the answer text is identical to the earlier one
    And it shows "Same numbers · wording kept"

  Scenario: Numbers that changed after learning are marked updated
    Given a reviewer's note taught a lesson that changes how the question is computed
    When I ask the question in a new session
    Then the answer shows "Updated after learning"
    And hovering it lists the lesson's title

  Scenario: A thumbs-down stops the replay
    When I click "Mark answer as wrong" on the answer in "First look"
    And I ask "Who won the 2022 World Cup?" in a new session
    Then the answer is derived afresh
    And it shows no "re-verified" chip

  Scenario: A thumbs-up approves the pinned answer
    When I click "Save as verified query" on the answer in "First look"
    And I ask "Who won the 2022 World Cup?" in a new session
    Then the answer shows "Verified" and "Same answer as <date> · re-verified"

  Scenario: Expert and plain answers are not shared
    When I turn on "Expert" and ask "Who won the 2022 World Cup?" in a new session
    Then the answer is derived afresh with a reasoning trace
```

## Acceptance

- Every scenario above passes.
- The learning demo ([delivery.md](../../system/delivery.md)) reports repeat consistency 2/2: after learning, the trap question asked in a third session is a byte-identical replay with the same trace id, and a control question asked twice is a byte-identical replay.
- An eval run, in-app or from the developer harness, never shows a `replay`, `kept` or `updated` verdict, and never writes a pin.
- Rejecting an answer and asking again never returns that answer's wording.

## Open questions

- The plain-language explanation (`docs/plans/learn-from-feedback-explained.md`, demo step 5) says asking again "in the same session or a new one" replays. In the code the chain is part of the lineage, so a repeat in the same session is a new lineage and is answered afresh. Which is intended?
- The `updated` verdict is given whenever the rows differ from the pin's, including when only the data moved or the model changed and nothing was learned, yet the chip always reads "Updated after learning". Should the label depend on whether lessons are listed?
- A pin cleanup "when the dataset is deleted" is described in a code comment, but deleting a dataset does not touch pins. Only `DELETE /answer-pins?datasetId=` removes them. Pins also outlive their source session, so a replay can cite a deleted session.
- A fresh answer that reproduces a rejected pin's rows is saved as a new pin with no rejection. If nothing in the context changes afterwards, it is replayed on the next ask, although a reviewer rejected those numbers.
- The mode of a rated answer is read off what it carries (R15). So an expert answer saved without a trace is taken as `careful`, and a careful answer with no successful query as `plain`. A rating on such an answer then acts on another mode's pin for the same question.
- A thumbs-up approves the pin only when the rated answer's wording is the pinned one, but a thumbs-down rejects the lineage's pin whichever answer of the lineage was rated. Is the asymmetry intended?

<!-- sources: backend/src/modules/answer-pins/{answer-pins.controller,answer-pins.service,pin-key,eligibility,entities/answer-pin.entity,repositories/answer-pins.repository}.ts; backend/src/modules/sessions/sessions.service.ts (preparePin, replayPin, savePin, stabilise, turnLineage, messageMode, replayedExchanges, rejectPin, approveAnswer); backend/src/modules/sessions/sessions.controller.ts (pin flag); backend/src/modules/sessions/result-compare.ts; backend/src/mastra/tools/dataset.tools.ts (DEFAULT_SQL_ROW_LIMIT); backend/scripts/learning-demo.ts; frontend/src/app/features/sessions/components/session-chat/session-chat.{ts,html} (consistency chip); docs/plans/learn-from-feedback-{engineering,explained}.md -->

# Business expert mode

Business expert mode is for a reviewer who must decide whether an answer can be trusted. With the **Expert** toggle on, each answer also carries a **reasoning trace** in five fixed blocks: how the question was read, which tables and joins were used and why, the assumptions made, how the metric is defined, and the SQL that actually ran with notes on its clauses. Every block has a **confidence** the system measures from checks it can verify: schema and join grounding, knowledge coverage, how the query ran, the independent cross-check, a verified-query match and how many guesses the block leans on. The model's opinion of itself counts for very little. The reviewer can rate each block with a thumbs up or down and a note. A note is distilled into a standing **lesson**, a curated knowledge entry that every later answer on the same data reads, so a corrected fiscal calendar or metric definition fixes the whole class of question, not just the one that was asked.

## Concepts

All terms are defined in [glossary](../../product/glossary.md): **Business expert mode**, **Reasoning trace**, **Reasoning block**, **Evidence basis**, **Confidence**, **Confidence signal**, **Confidence band**, **Answer query**, **Review mode**, **Block rating**, **Lesson**, **Knowledge entry**, **Cross-check**, **Careful mode**, **Verified query**, **Answer pin**, **Clarification**, **Eval suite**.

## Rules

### Turning the mode on

- R1. The chat composer SHALL offer an **Expert** toggle. While it is on, every turn sent (questions, clarification answers, retries) is an expert turn. The choice SHALL be a standing preference: kept in the browser's local storage ([data-model.md](../../system/data-model.md) 1.2), restored when the app starts, and kept when the user switches sessions or restarts. This differs from Careful mode, which resets per conversation ([sessions-chat](../sessions-chat/spec.md) R37). When storage cannot be read the toggle starts off; when it cannot be written the toggle still works for the current run.
- R2. An expert turn SHALL always run the independent cross-check of [sessions-chat](../sessions-chat/spec.md) R38, whether or not Careful is on. The Careful toggle itself is not changed.
- R3. An expert turn SHALL run in **review mode**: the assistant is told that a reviewer reads its interpretation, assumptions and metric one by one. So when the definition it needs is a business convention the curated knowledge does not cover (a fiscal calendar, how a metric is calculated, which records a business term includes), it SHALL answer under the most common convention and state that assumption in the answer, instead of asking. It SHALL still ask when the data matches the question's subject several ways (a person, product, member or value with several plausible matches). Plain and careful turns are unchanged. Prompt text: [agents.md](../../system/agents.md) 4.1, Block 5.

### Building the trace

- R4. When an expert turn ends with an answer (text or a visual), the system SHALL, before `done`:
  1. run the cross-check, announcing it with an `expert-status` notice `cross-check` when the turn ran a successful query;
  2. announce `explaining`;
  3. make one explainer pass ([agents.md](../../system/agents.md) 2.8) that writes the trace's prose;
  4. assemble and score the trace;
  5. persist it on the answer.

  The notices appear as a status line in the Thinking block (R36).
- R5. A trace SHALL carry an id, a version (1), the time it was generated, the model the agents last resolved to, an overall confidence, and its blocks in this fixed order: interpretation, data selection, assumptions, metric, SQL.
  - Interpretation and assumptions are always present.
  - Data selection and SQL are present only when a successful query backs the answer.
  - The metric block is present only when such a query exists and the explainer names a measure.

  Readers SHALL show the blocks in this order whatever order they were stored in.
- R6. The trace SHALL explain the answer query ([sessions-chat](../sessions-chat/spec.md) R52), the same query the cross-check compares. The SQL block's text and row count SHALL come from that query's record, never from model output.
- R7. The model SHALL write only prose and structure:
  - the restatement, the term mappings and the other readings considered;
  - table roles and reasons, joins and tables deliberately not used;
  - the assumptions;
  - the metric name, formula and grain;
  - notes on SQL clauses;
  - one self-assessment from 0 to 1 per block.

  It SHALL NOT supply any confidence score.
- R8. Before scoring, the system SHALL check every factual claim of the trace against what actually ran. The rules are in [agents.md](../../system/agents.md) 2.8, *Post-processing*:
  - Tables and joins are reconciled with the entities and joins the SQL actually uses.
  - A claim citing a knowledge entry, metric or verified query that the turn was not given is downgraded to an assumption marked "(unverified)".
  - Notes and fragments are tied to the SQL's own text.
  - Assumption ids are renumbered `a1`, `a2`, … in order.

### Confidence

- R9. Every block's confidence SHALL be computed by the system from measured signals.
  - The score is the sum of value × weight divided by the sum of weights, over the signals that could be measured for that block, rounded to 2 decimals.
  - A signal that could not be measured SHALL be left out, not counted as 0. Missing evidence is not negative evidence.
  - A block with no measurable signal scores 0.

  Each signal shown carries its label, value (0 to 1, rounded to 2 decimals), weight and a one-line note of what was measured.
- R10. The signals and how each is measured:

  | Signal (label) | Value | Not measured when |
  |---|---|---|
  | `schema_grounding` (Schema grounding) | (tables found + columns found) / (tables referenced + columns checked). Tables are the FROM/JOIN targets that are not common table expressions. Columns are the qualified references whose entity has a stored column list. Note: `<t>/<n> tables[ and <c>/<m> columns] are in the session's datasets` | no SQL, or nothing to check |
  | `join_grounding` (Join grounding) | share of the SQL's equality join pairs between two session entities that follow a declared or inferred relationship (either direction). No joins at all scores 1 ("no joins") | every join has a side that is a common table expression, derived table or unknown table |
  | `knowledge_coverage` (Knowledge coverage) | share of the block's claims whose (checked) basis is grounded: knowledge, metric, verified query, schema or data sample, not convention or assumption. Claims are the term mappings (interpretation), the assumption items (assumptions) or the metric's own basis (metric) | the block has no claims |
  | `assumption_load` (Assumption load) | max(0, 1 − guesses / 3), where guesses are claims with basis `assumption` | never (always measured) |
  | `execution` (Execution) | 1 ran cleanly; 0.75 auto-repaired or truncated at the row limit; 0.5 zero rows or any result warning; 0 no successful query. The worst outcome that applies wins | never |
  | `cross_check` (Independent cross-check) | 1 agree, 0 disagree; the note is the cross-check's own note | the check did not run or ended in error |
  | `verified_match` (Verified query match) | 1 when the answer is verified: its last successful SQL matches a stored verified query (the Verified badge, [sessions-chat](../sessions-chat/spec.md) R35), or it was approved (R14) | not verified |
  | `self_report` (Model self-assessment) | the explainer's own 0–1 estimate for the block | the explainer gave none |

- R11. The weights per block:

  | Block | Signals and weights |
  |---|---|
  | interpretation | knowledge coverage (of term mappings) 0.40, assumption load 0.20, self-report 0.10 |
  | data selection | schema grounding 0.35, join grounding 0.25, execution 0.15, cross-check 0.15, self-report 0.10 |
  | assumptions | knowledge coverage (of items) 0.35, assumption load 0.25, self-report 0.10 |
  | metric | knowledge coverage (of its basis) 0.40, cross-check 0.20, verified match 0.20, execution 0.10, self-report 0.10 |
  | SQL | cross-check 0.30, execution 0.25, schema grounding 0.25, verified match 0.20, self-report 0.10 |

- R12. Bands SHALL be: **high** at a score of 0.80 or more, **medium** at 0.55 or more, **low** below. One definition SHALL serve every block, the overall score and the colour of every signal bar.
- R13. The overall confidence SHALL be the weighted mean of the blocks present: SQL 0.30, data selection 0.25, assumptions 0.20, interpretation 0.15, metric 0.10, renormalised over the blocks that exist. Two measured outcomes then override it, in this order:
  1. a disagreeing cross-check caps it at 0.50;
  2. a verified-query match floors it at 0.85.

  The result is rounded to 2 decimals and banded. The overall confidence SHALL also list, for information, the block-independent signals: execution, cross-check (its note ending " — caps the overall confidence at 50%" when it disagreed), verified match (note ending " — floors the overall confidence at 85%"), schema grounding, and the knowledge coverage of the assumptions. Each is weighted as in the SQL block, the coverage at 0.35. These listed signals do not enter the overall score.
- R14. When an answer that carries a trace is approved, by a whole-answer thumbs-up or a thumbs-up on its SQL block (R21), the system SHALL rescore the trace without any model call:
  1. add the verified-match signal (value 1) to the SQL and metric blocks, replacing any earlier one;
  2. rescore those two blocks;
  3. recompute the overall confidence with the 0.85 floor. The cross-check outcome is read back from the overall cross-check signal: value 1 means agree, any other value means disagree, and absent means the check did not run.

  Approving twice changes nothing.

### Failures and turns without a trace

- R15. The explanation SHALL NEVER block the answer. The explainer gets one retry, which carries the problem with its first reply. When neither reply is usable, or assembling the trace fails:
  - the answer is saved without a trace;
  - an `expert-status` notice `failed` is streamed;
  - when `done` arrives the chat shows the info toast "Answer saved without its reasoning trace".
- R16. A clarification turn SHALL carry no trace and SHALL NOT call the explainer. A stopped turn SHALL get no trace and no `failed` notice.
- R17. An expert turn whose answer has no successful query SHALL still get a trace with only the interpretation and assumptions blocks. The explainer is told that no query ran.
- R18. An answer replayed from an answer pin ([answer-pinning](../answer-pinning/spec.md) R7) SHALL carry the pinned trace unchanged, with the same trace id, and without the ratings of the answer it was copied from. A replay streams no `expert-status` notices. An expert ask only ever replays an expert answer, and an expert answer only becomes a pin when it has a trace.

### Rating blocks

- R19. Each block of a trace SHALL offer a thumbs up, a thumbs down and a note.
  - A rating changes only what is sent:
    - a vote sets or switches the block's vote, and a cleared vote (`null`) removes it;
    - a comment sets the note, and a `null` or blank comment removes it;
    - a field left out stays as stored.
  - At least one of vote or comment SHALL be sent.
  - The comment is trimmed and cut to 2,000 characters.
  - In the UI, clicking the active thumb again clears it, and the other thumb switches.
- R20. The system SHALL store one rating per (session, answer, block) and update it in place, so re-rating never forks it. With it the system SHALL keep the trace id, the question the answer replied to and a snapshot of the rated block as it was. These three are refreshed on every write. Ratings SHALL survive deleting the session. The latest rating per block (vote, comment, time) SHALL also be mirrored onto the answer's trace; a rating cleared of both vote and comment is removed from the mirror.
- R21. A vote SHALL also act on the answer:
  - A **thumbs-down on any block** removes the answer's verified query and its Verified badge, and rejects the answer's pin ([answer-pinning](../answer-pinning/spec.md) R13).
  - A **thumbs-up on the SQL block** approves the answer exactly like a whole-answer thumbs-up ([sessions-chat](../sessions-chat/spec.md) R36): it saves the verified query, sets the Verified badge, rescores the trace (R14) and approves the pin ([answer-pinning](../answer-pinning/spec.md) R14).
  - A **thumbs-up on any other block** only records the rating.

  The vote acts before any learning (R24). So an approved pin is keyed without the new lessons, and the next ask is re-derived under them.
- R22. All ratings SHALL be listable, newest first and optionally for one session, for offline review of the explanations. No screen shows this list.

### Learning from a note

- R23. A block rating whose saved comment differs from the comment stored before SHALL be learned from (R24). Clearing the comment SHALL delete every lesson learned from that rating. A rating that changes only the vote SHALL NOT learn or forget anything.
- R24. Learning SHALL distil the note into 0 to 3 **lessons** with the feedback learner ([agents.md](../../system/agents.md) 2.9). The learner sees:
  - the session's dataset names and schema;
  - the question and the answer;
  - the rated block with its vote;
  - the answer query;
  - the titles of the knowledge already on file for those datasets;
  - the note.

  A lesson is a general, standing rule about the data or the business (a fiscal calendar, what a metric means, a filter that always applies, a column's true meaning). It is never the answer to the question, never a figure copied from the answer, and never phrased around "this question". A note that only says the answer is wrong or right teaches nothing: the learner returns no lessons and nothing is stored.
- R25. Re-learning SHALL start clean: every lesson learned earlier from the same rating is deleted before the new ones are written. A hand edit made in Knowledge to such a lesson is lost when the note is edited again.
- R26. Each lesson SHALL be stored as an **enabled** knowledge entry with source `feedback`. One copy is stored per session dataset, scoped to that dataset, or a global one when the session has none. Each copy carries the provenance:
  - the rating's id, the session and the answer's time;
  - the rated block, the question and the note;
  - the vote, when there was one;
  - when the lesson was learned;
  - the method: `agent`, or `verbatim` for the fallback (R27).

  How lessons are stored, ordered and shown: [knowledge](../knowledge/spec.md) R6, R16 and R29–R32.
- R27. The learner gets one retry, which carries the problem with its first reply. When neither reply is usable, the system SHALL fall back to exactly one `instruction` lesson titled `Reviewer note: <block>` (`Interpretation`, `Data selection`, `Assumptions`, `Metric` or `SQL`) whose body is the note verbatim, with method `verbatim`.
- R28. Before storing, the learner's lessons SHALL be made safe:
  - the title is trimmed and cut to 80 characters (ending `…` when cut);
  - a condition the learner attached is appended to the body as a blank line then `Applies when: <condition>`;
  - the body is cut to 500 characters;
  - a lesson with an empty title or body, or whose title repeats an earlier lesson of the same reply (ignoring case), is dropped;
  - entities that are not among the session's entity keys are removed, and synonyms are trimmed.
- R29. Saving a rating SHALL answer with the session (the rating mirrored onto the trace) and, when the comment was learned from, the lessons learned (kind, title, body, method, and the id of the first copy). The message SHALL read `Feedback saved — learned: <titles, comma-separated>` when at least one lesson was learned, else `Feedback saved`. A failure while learning SHALL be logged and SHALL NOT fail the rating.
- R30. Lessons SHALL reach every later turn, cross-check and explanation on those datasets through the curated knowledge block ([knowledge](../knowledge/spec.md) R15–R17). Because they change the knowledge a turn is given, they change the fingerprint of every answer pin on those datasets ([answer-pinning](../answer-pinning/spec.md) R4). An explanation that cites a lesson shows it as learned from a note (R35).

### Measuring the mode

- R31. The developer harness ([agents-evals](../agents-evals/spec.md) R50) SHALL offer an expert option that runs every turn in business expert mode without changing how verdicts are graded. It SHALL report:
  - per case: the overall confidence and band, and the coverage of the case's expected reasoning (R32);
  - the **headline**: the AUROC of overall confidence against PASS, computed as the Mann–Whitney statistic with tied scores at mid-ranks over every traced attempt graded PASS or FAIL (every repetition counts; an ERROR is left out). It is absent when every traced attempt passed or every one failed;
  - the **constraint**: the accuracy of the answers shown in the high band, against a target of at least 90 % ("met" or "NOT met"; absent when no answer was high), reported with the share of traced answers that band holds. The target is reported, not enforced: it does not change the exit code;
  - the accuracy and size of each band;
  - the mean coverage over traced answers whose case declares expected reasoning.

  Answers with no trace are counted but never ranked. Cases without a reference query run once each as ungraded probes that record whether the answer carried a trace and whether it clarified; a clarification that carried a trace is flagged. The option cannot be combined with the validate mode. The run log carries all of this ([data-model.md](../../system/data-model.md) 4.9). The in-app Evals tab never runs expert mode.
- R32. A case's expected reasoning MAY list:
  - **tables**, each written `schema.table`. Coverage is the share the data-selection block chose, matched case-insensitively at a dot boundary as a suffix of the chosen key. Tables listed as not used do not count.
  - **assumption phrases**. A phrase is covered when every word of four or more letters in it appears in the assumption statements, the term mappings or the metric block's name, formula and grain.
  - a **metric**. It matches when the metric block's name or cited source equals it once case and punctuation are ignored (an "(unverified)" marker is ignored), or when every word of four or more letters in it appears in the block's name, formula, grain and source.

  A measure that cannot be taken (nothing expected, no trace) is absent, never 0.
- R33. The measuring and teaching suites SHALL be data: the HR set (10 cases with expected reasoning) and the Retail set (6 cases, one of which carries a learning scenario). Their questions are in [agents-evals](../agents-evals/spec.md). They run over synthetic fixtures in the development database ([delivery.md](../../system/delivery.md) section 6). A learning scenario holds:
  - the scripted reviewer notes;
  - the cases those notes must also fix without notes of their own;
  - the band expected before and after.

  The learning demo ([delivery.md](../../system/delivery.md)) proves the scenario end to end over HTTP: the trap is answered wrong and not high, the notes teach at least one lesson, then a new session answers right at high confidence marked updated, the next ask is a byte-identical replay with the same trace id, the generalisation case passes at high confidence, and a control question is high and then replayed.

### UI

- R34. Under an expert answer the chat SHALL show the trace panel ([ui.md](../../system/ui.md) 4.16):
  - an overall strip with a confidence meter, the band-and-percent badge and a Show/Hide reasoning toggle (open by default);
  - the caption "Measured from the checks behind each block — schema, joins, knowledge, execution and cross-checks — not the model's own opinion." followed by the model id when known;
  - then the five blocks.

  Every confidence badge opens the list of signals behind it. The data-selection block SHALL be drawn as a table and join diagram ([ui.md](../../system/ui.md) 4.17). Hovering or focusing a SQL note SHALL highlight its clause in the SQL.
- R35. A claim whose cited source matches the title of a lesson the answer was given SHALL show a "Learned from your note" chip next to its basis chip. The match ignores case and accepts either text containing the other.
- R36. While an expert turn runs, the Thinking block SHALL show one status line for the latest notice:
  - `cross-check`: "Cross-checking with an independent query…";
  - `explaining`: "Explaining the reasoning…";
  - `failed`: "Could not build the reasoning trace", in amber.

## Edge cases and errors

| Situation | Behaviour |
|---|---|
| Explainer reply unusable twice, or the model call fails | Answer saved without a trace; `expert-status: failed`; toast "Answer saved without its reasoning trace". |
| Expert turn stopped by the user | No trace, no `failed` notice, nothing beyond the partial answer ([sessions-chat](../sessions-chat/spec.md) R16). |
| Expert turn ends in a clarification | No trace; the card behaves as in sessions-chat. |
| Expert turn ran no successful query | Trace with interpretation and assumptions only; their execution-dependent signals are absent; no `cross-check` notice. |
| Cross-check could not complete (`error`) | The cross-check signal is left out of every block; no cap. |
| Explainer cites a knowledge entry, metric or verified query the turn was not given | That claim's basis becomes `assumption`, its source reads "<cited> (unverified)" (or "no source named (unverified)"), and coverage drops accordingly. |
| Explainer names a table the SQL does not read | Dropped from the diagram; tables the SQL reads but the explainer skipped are added as lookups ("Referenced by the query"). |
| A SQL note quotes text that is not in the SQL | The note is dropped. |
| Rating without a vote or comment | Refused: "send a vote, a comment, or both". |
| Rating validation | "messageAt is required"; "block must be one of interpretation, data-selection, assumptions, metric, sql"; "vote must be 'up', 'down' or null"; "comment must be a string or null". |
| Rating an unknown answer / an answer without a trace / a block the trace lacks | "No assistant message at <time>" / "This answer has no reasoning trace" / "This reasoning trace has no <block> block". |
| Rating fails in the UI | The local rating rolls back, a note being saved is reopened with its text, and an error toast shows the server's message, "Could not save feedback" or "Backend unreachable". |
| Saving a note equal to the stored one | The editor closes; nothing is sent. |
| Saving an empty note over a stored one | The comment is cleared and the lessons learned from it are deleted. |
| Learner fails twice | One `instruction` lesson titled "Reviewer note: <block>" with the note verbatim. |
| Learner finds nothing to learn | No lesson; message "Feedback saved". |
| Learning throws (for example the store fails) | The rating is saved; no lessons; logged. |
| Storage for the Expert preference unavailable | The toggle starts off and works for the run without being remembered. |

## Contracts

- Endpoints in [api.md](../../system/api.md): the streamed message with `expert` (event `expert-status`); `POST /sessions/:id/expert/feedback` (53); `GET /expert/feedback` (54).
- Data in [data-model.md](../../system/data-model.md):
  - `ChatMessage.expertTrace` and the `ReasoningTrace` shape (3.4.4);
  - the `reasoning_feedback` collection (3.10);
  - lessons in `knowledge_snippets` (3.9: `source: "feedback"`, `provenance`);
  - the eval set fields `expectedReasoning` and `learningScenario` (4.8);
  - the run log's `expert` field (4.9);
  - the Expert preference key (1.2).
- Agents in [agents.md](../../system/agents.md): `business-expert` (2.8), `feedback-learner` (2.9), the review-mode block (4.1, Block 5), and the cross-check verifier's knowledge and metrics context (2.4, 5.8).
- Related: [sessions-chat](../sessions-chat/spec.md) (turns, cross-check, the answer query, the whole-answer thumbs), [answer-pinning](../answer-pinning/spec.md) (replay, rejection and approval), [knowledge](../knowledge/spec.md) (lessons as knowledge entries), [agents-evals](../agents-evals/spec.md) (the HR and Retail sets, the developer harness).
- Why confidence is measured by the system and not reported by the model, and why lessons are knowledge entries: ADR-0008 and ADR-0009 in [architecture.md](../../system/architecture.md).

## UI

Shell placement and tokens are in [ui.md](../../system/ui.md).

- **Composer**: the **Expert** toggle between **Careful** and **Deep analysis** (4.12), with its tooltip (section 7).
- **Thinking block**: the expert status line (R36).
- **Answer**: the trace panel under the Markdown body, above "How I worked this out" (4.16), with the table and join diagram in its data-selection block (4.17).
- **States**:
  - no trace (mode off, clarification, failure), so no panel;
  - trace collapsed or expanded;
  - a confidence badge open on its signals ("No signals could be measured." when empty);
  - a block's note editor open, or a rating being saved (controls disabled; the save button reads "Save & teach" with a spinner);
  - a saved note shown in quotes under its block.

## Flows

### Feature: Business expert mode

E2E: none yet.

```gherkin
Feature: Business expert mode

  Background:
    Given an "HR analysis" session over the "HR" dataset is open

  Scenario: The Expert toggle is a standing preference
    When I click "Expert"
    Then "Business expert mode" is pressed
    When I open another session
    Then "Business expert mode" is still pressed
    When I restart the application
    Then "Business expert mode" is still pressed
    And "Careful" is not pressed

  Scenario: An expert answer shows its reasoning with measured confidence
    Given "Business expert mode" is pressed
    When I ask "What is the average salary of tech employees in 2025?"
    Then the Thinking block shows "Cross-checking with an independent query…"
    And then "Explaining the reasoning…"
    And the answer shows a "Reasoning trace" panel with an overall badge such as "High · 86%"
    And I see the blocks "Interpretation", "Data selection", "Assumptions", "Metric definition" and "Annotated SQL" in that order
    And the "Data selection" block draws the tables the query read and the joins between them
    And the "Annotated SQL" block shows the exact SQL listed under "Data used"

  Scenario: A confidence badge opens the signals behind it
    Given an expert answer is shown
    When I click "Confidence details for Annotated SQL"
    Then I see "Confidence signals" listing "Independent cross-check", "Execution" and "Schema grounding", each with a percentage, a weight and a note

  Scenario: A disagreeing cross-check caps the answer
    Given the independent check returns different figures
    When I ask an expert question
    Then the answer shows "Cross-check differs"
    And the overall confidence is at most 50 % and reads "Low"

  Scenario: The answer survives a failed explanation
    Given the explainer returns no usable reply twice
    When I ask an expert question
    Then the Thinking block shows "Could not build the reasoning trace"
    And the answer is shown without a reasoning trace
    And I see the toast "Answer saved without its reasoning trace"

  Scenario: A clarification carries no reasoning
    Given "Business expert mode" is pressed
    When I ask "How many people report to Helena Voss?"
    And the assistant asks whether I mean direct reports or the whole reporting line
    Then the clarification card has no reasoning trace

  Scenario: An undefined business convention is answered under a stated assumption
    Given "Business expert mode" is pressed in a "Retail" session whose knowledge does not define the fiscal year
    When I ask "What was our net revenue in fiscal year 2025?"
    Then the assistant answers without asking a clarifying question
    And the answer states which fiscal calendar it assumed
    And the "Assumptions" block lists that calendar with the basis "Convention" or "Assumption"

  Scenario: Rating a block
    Given an expert answer is shown
    When I click "Mark Interpretation as right"
    Then "Mark Interpretation as right" is pressed
    And I see the toast "Feedback saved"
    When I click "Mark Interpretation as right" again
    Then it is no longer pressed

  Scenario: A thumbs-down on a block withdraws the Verified badge
    Given an expert answer marked "Verified"
    When I click "Mark Metric definition as wrong"
    Then the answer no longer shows "Verified"

  Scenario: A thumbs-up on the SQL block verifies the answer
    Given an expert answer whose overall confidence reads "Medium"
    When I click "Mark Annotated SQL as right"
    Then the answer shows "Verified"
    And the overall confidence is at least 85 %
    And the "Annotated SQL" signals include "Verified query match"
```

### Feature: Learning from a reviewer's note

E2E: none yet.

```gherkin
Feature: Learning from a reviewer's note

  Background:
    Given a "Retail" session in business expert mode
    And I asked "What was our net revenue in fiscal year 2025?" and the answer used the calendar year

  Scenario: A note becomes a lesson in Knowledge
    When I click "Add note on Interpretation"
    And I type "Our fiscal year runs from 1 February to 31 January and is named for the year it starts." into "Note on Interpretation"
    And I click "Mark Interpretation as wrong"
    And I click "Save note on Interpretation"
    Then the save button reads "Save & teach" while it runs
    And I see a toast starting "Feedback saved — learned:"
    And the note is shown in quotes under the "Interpretation" block
    When I click "Knowledge" in the sidebar and turn on "Learned"
    Then I see a lesson badged "From feedback" scoped to "Retail"
    And hovering the badge shows the question and my note

  Scenario: A bare "wrong" teaches nothing
    When I add the note "wrong" on "Metric definition" and save it
    Then I see the toast "Feedback saved"
    And no lesson is added to Knowledge

  Scenario: Editing a note replaces its lessons and clearing it removes them
    Given my note on "Interpretation" taught the lesson "Fiscal year"
    When I edit the note to say the fiscal year starts on 1 March and save it
    Then the lessons learned from the first wording are gone from Knowledge
    And the new lesson reflects 1 March
    When I clear the note and save it
    Then no lesson learned from that note remains

  Scenario: A learned lesson is applied in a new session
    Given my notes taught the fiscal calendar and the definition of net revenue
    When I open a new "Retail" session in business expert mode
    And I ask "What was our net revenue in fiscal year 2025?"
    Then the answer reports the fiscal-year figure
    And "Knowledge in context" lists the lessons with the chip "Learned"
    And the "Interpretation" block cites a lesson with the chip "Learned from your note"
    And the overall confidence reads "High"
    And, because the first answer was saved as the question's answer pin, the answer shows "Updated after learning"
```

## Acceptance

- Every scenario above passes.
- With the HR fixture registered, `npm run eval -- --suite hr --expert` reports a reasoning trace on every graded answer, an AUROC when the run has both passes and failures, and a high-band accuracy of at least 90 % (the constraint). The clarification case's probe carries no trace.
- The learning demo against the Retail fixture reports learning lift 2/2 (the trap and its generalisation case flip from wrong to right, ending in the high band) and repeat consistency 2/2 (byte-identical replays).
- A trace never shows SQL, row counts or tables that did not run. No confidence comes from the model: the model's own estimate enters every block only as the `self_report` signal, at weight 0.10.
- Without the Expert toggle, turns behave exactly as before. No review-mode block, no explainer call and no trace are added.

## Open questions

- A thumbs-down after a thumbs-up removes the Verified badge, but the trace keeps the verified-match signal and the 0.85 floor it gained on approval. The trace then still claims a match with a verified query that no longer exists. Should a thumbs-down undo the rescoring?
- A thumbs-up on the SQL block sets the Verified badge but not the whole-answer rating, so the answer's own thumbs-up button is not shown as pressed. Is that intended?
- Lesson titles are not unique. Two notes can each store a lesson with the same title, for example two verbatim fallbacks titled "Reviewer note: Metric" on different answers. A code comment in the learner claims a second write under the same title is rejected; it is not.
- The trace's `model` is the model the agents last resolved to, which on a busy backend can be another call's model.
- A rating cleared of both vote and comment disappears from the trace but stays in the ratings store as an empty record.

<!-- sources: backend/src/modules/expert-mode/{entities/reasoning-trace.entity,confidence,expert-mode.service,answer-record,sql-grounding,rescore,expert-metrics,expert-mode.controller,dto/block-feedback.dto,repositories/reasoning-feedback.repository}.ts; backend/src/modules/learning/{learning.service,lesson-distiller}.ts; backend/src/mastra/agents/{business-expert,feedback-learner}.agent.ts; backend/src/modules/sessions/{sessions.service,sessions.controller}.ts (REVIEW_MODE_CONTEXT, explainAnswer, recordBlockFeedback, learnFromComment); backend/src/mastra/evals/suite-loader.ts; backend/scripts/{run-eval,learning-demo}.ts; frontend/src/app/features/sessions/components/{expert-trace,table-join-diagram,session-chat}/*; frontend/src/app/features/sessions/models/expert-trace.model.ts; docs/plans/business-expert-mode-{engineering,explained}.md, learn-from-feedback-{engineering,explained}.md -->

# Deep analysis

For a broad question that one query cannot answer, the user can run a **deep analysis** instead of a normal chat turn. The system plans several distinct investigation angles, investigates each with SQL over the session's datasets, and writes a report with an executive summary, findings, anomalies and recommendations. The job runs in the background for a few minutes while chat stays usable; when it finishes, the executive summary appears in the conversation as a report card with the full report downloadable as markdown.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): deep analysis, angle, report, session, workspace, assistant, entity, dataset.

Capability-local terms: a **job** is one deep-analysis run (identified by a job id); its **status** is one of planning, investigating, writing, done, error.

## Rules

Starting
- R1. The user SHALL start a deep analysis from a session by typing a question in the composer and choosing "Deep analysis". The question SHALL be sent as a job, not as a chat turn.
- R2. The system SHALL require a non-empty question after trimming (`question is required`) and an existing session. Any failure to start SHALL be reported as a failure result with a message, never as a crash.
- R3. The system SHALL allow at most one running job per session. A start request while one is running SHALL fail with `A deep analysis is already running for this session` and SHALL report the running job's id. Different sessions MAY run jobs at the same time.
- R4. Starting SHALL return the new job id immediately; the pipeline runs in the background.

Pipeline
- R5. Step 1 (planning): one structured call with no tools SHALL produce a report title (under 80 characters, no markdown) and between 3 and 5 distinct, non-overlapping angles, each with a short title and a precise sub-question over the session's entities. The planner SHALL run no queries and ask no clarifying questions. The system SHALL keep at most 5 angles and SHALL fail the job (`the planner returned no angles` / `the planner returned no usable investigation plan`) when none are usable. If the title is blank, the first 80 characters of the question SHALL be used.
- R6. Step 2 (investigating): the system SHALL investigate the angles one at a time, in order. Each investigation SHALL be a tool-enabled assistant call (up to 15 steps) that runs SQL, never asks the user anything (no clarification), does not create or update visuals, reports concrete numbers with the entities behind them, flags anomalies, and ends with a "SQL used" section listing each statement in its own fenced `sql` block.
- R7. The system SHALL keep at most 12,000 characters of each angle's findings, and SHALL extract the distinct SQL statements from its fenced `sql` blocks for the report's appendix. An angle with empty findings SHALL read `No findings returned.`
- R8. A failure inside one angle SHALL NOT fail the job: that angle's findings SHALL read `This angle could not be investigated — <reason>` with no SQL, and the remaining angles SHALL continue.
- R9. Step 3 (writing): one structured, tool-free call SHALL write, only from the findings and without inventing numbers, an executive summary (3 to 6 sentences or bullets a decision-maker can act on, with key numbers) and a report body that starts at "## Findings by angle" (one subsection per angle), then "## Anomalies and drivers", then "## Recommendations". The body SHALL NOT contain an executive summary or data appendix. The writer's title replaces the planner's title when non-empty. A malformed result fails the job (`the report writer returned no usable report`).
- R10. All steps SHALL receive the same grounding as a chat turn (entity orientation, metric definitions, curated knowledge, similar verified queries, tools scoped to the session's datasets), but SHALL NOT read or write the session's conversation memory, so the user's next chat question is not polluted by the job's internal calls.

Output
- R11. The system SHALL assemble the stored report itself rather than have the model write the whole document: a title heading; `**Question:**` with the original question; a line "Deep analysis · session: <name> · <n> angle(s) · generated <ISO time>"; "## Executive summary"; the writer's body; "## Data appendix" with, per angle, a numbered subsection with its sub-question and its SQL statements in fenced blocks (or `_No SQL was recorded for this angle._`); and a closing "Report <job id>" line.
- R12. The report SHALL be stored as a markdown file named by job id inside the session's workspace, in a reports folder.
- R13. On success the system SHALL append one assistant message to the session whose content is the executive summary, carrying a report reference (job id, title, stored path, number of angles). The append SHALL re-read the session first, so turns persisted while the job ran are never overwritten.
- R14. The user's question SHALL NOT be added to the transcript as a user message; the transcript shows only the report (or failure) message.
- R15. On failure the job status SHALL become error with the reason, and the system SHALL append an assistant message `Deep analysis of "<question>" could not be completed — <reason>`.
- R16. When the backend shuts down, running jobs SHALL be aborted and no message SHALL be appended for them.

Status and download
- R17. The system SHALL report a job's status on request: job id, status, a progress line, current angle (1-based), total angles, title and error. Progress lines SHALL be: "Planning the investigation"; "Investigating angle <i> of <n>: <angle title>"; "Writing the report"; "Report ready — <n> angle(s) investigated"; "Deep analysis failed".
- R18. Asking for a job unknown to this session SHALL fail with `Deep analysis <id> not found`. Jobs live in memory only: after a backend restart they are unknown. The system SHALL retain at most the 50 most recent finished jobs and SHALL never drop a running one.
- R19. The report SHALL be downloadable as markdown by job id. It SHALL be read from storage rather than from memory, so it stays downloadable after a restart. The file name SHALL be a slug of the title (lowercase, non-alphanumerics to `-`, at most 64 characters), or `deep-analysis-<first 8 characters of the id>` when no title is known (for example after a restart). An id with characters other than letters, digits and `-` SHALL be rejected (`invalid deep analysis id`); a missing report SHALL fail with `No deep analysis report for <id>`.

## Edge cases and errors

- Empty draft: the "Deep analysis" button is disabled. While a job runs in the session it is disabled too, with the tooltip "A deep analysis is already running for this session."
- Start fails (conflict, unknown session, backend error): the pending card disappears, the typed question is put back in the composer (if the composer is still empty), and an error toast shows the message (`Could not start deep analysis`, or `Backend unreachable`).
- Polling: the card refreshes every 3 seconds. A single failed poll is ignored; 5 consecutive failures end watching with `Lost contact with the deep analysis`. A status result of "not found" ends it with `Deep analysis was lost` (typical after a backend restart).
- Job fails: the card turns into "Deep analysis failed — <reason>" with a Dismiss button, an error toast shows the reason, and the failure message is also in the transcript.
- Done but the transcript cannot be reloaded: error `The report is ready but could not be loaded`.
- Switching to another session stops watching in this view but does not stop the job; its report is added to the transcript regardless. Reopening the app does not bring back the pending card (it is client-side state), though a finished report is in the transcript.
- A chat turn in flight when the job finishes is not disturbed; its own completion brings the final transcript.
- The pending card and its job state are not restored after the user navigates away and back mid-job (open question below).
- Download failure: toast `Report download failed` (or the server message).

## Contracts

- Endpoints under a session: start (POST with the question), status (GET by job id) and download (GET by job id, markdown attachment). See [../../system/api.md](../../system/api.md). Start and status always answer with a success flag and message; download returns the file or an HTTP error.
- Job, status and report-reference shapes, the report file location and the message's report field: see [../../system/data-model.md](../../system/data-model.md). The plan and report output schemas (title; angles with title and question, 1 to 5 in the prompt; title, executive summary, report body) are specified in [../../system/agents.md](../../system/agents.md).
- Agent: the assistant, called three ways (plan, investigate, write): see [../../system/agents.md](../../system/agents.md).
- Related: [../sessions-chat/spec.md](../sessions-chat/spec.md) (composer, transcript), [../knowledge/spec.md](../knowledge/spec.md), [../metrics/spec.md](../metrics/spec.md), [../verified-queries/spec.md](../verified-queries/spec.md) (grounding blocks reused per call).

## UI

Lives in the session chat (see [../../system/ui.md](../../system/ui.md)).

- Composer: a "Deep analysis" pill (telescope icon) beside "Careful", with the tooltip "Deep analysis: investigate the typed question from several angles in the background and deliver a downloadable report. Takes a few minutes; chat stays usable." Clicking it clears the draft and starts the job.
- Pending card, at the end of the conversation: spinner and "Deep analysis running — <progress>" over the (truncated) question; the progress line is the server's progress text, with fallbacks "planning the investigation", "investigating angle <i> of <n>", "writing the report", "finishing up". On error: "Deep analysis failed — <reason>" with a Dismiss button (label "Dismiss deep analysis"). A running card has no cancel control.
- Report card in the transcript: telescope icon, the report title, "Deep analysis · <n> angle(s) investigated", a "Report" button (title "Download the full report (.md)", label "Download report", spinner while downloading), and the executive summary rendered as formatted text below.
- Toasts: "Deep analysis report ready", "Report downloaded".

## Flows

E2E: none yet.

```gherkin
Feature: Deep analysis (E2E: none yet)

  Scenario: Start a deep analysis
    Given I am in a session and an LLM is configured
    When I type "Why did claim denials rise last quarter?" in the composer
    And I click "Deep analysis"
    Then the composer is cleared
    And I see a card "Deep analysis running — Planning the investigation"

  Scenario: Progress is shown angle by angle
    Given a deep analysis is running
    Then the card progresses through "Investigating angle 1 of <n>: <title>" to "Writing the report"
    And I can still send ordinary chat messages meanwhile

  Scenario: The report arrives in the conversation
    Given a deep analysis has finished writing
    Then I see the toast "Deep analysis report ready"
    And the conversation shows a report card with its title and "Deep analysis · <n> angles investigated"
    And the card shows the executive summary

  Scenario: Download the full report
    Given a report card is in the conversation
    When I click "Report"
    Then a markdown file named after the report title is saved
    And I see the toast "Report downloaded"
    And the file contains "## Executive summary", "## Findings by angle", "## Recommendations" and "## Data appendix"

  Scenario: Only one analysis at a time per session
    Given a deep analysis is running in this session
    When I look at the "Deep analysis" button
    Then it is disabled with the tooltip "A deep analysis is already running for this session."

  Scenario: Nothing to analyse
    Given the composer is empty
    Then the "Deep analysis" button is disabled

  Scenario: A failed start gives the question back
    Given the backend rejects the start request
    When I click "Deep analysis" with a question typed
    Then I see an error toast
    And my question is back in the composer

  Scenario: A failed analysis explains itself
    Given a deep analysis fails while planning
    Then the card reads "Deep analysis failed — <reason>"
    And I can click "Dismiss deep analysis"
    And the conversation contains a message starting 'Deep analysis of "<question>" could not be completed'

  Scenario: One angle failing does not lose the report
    Given one angle's investigation errors out
    When the analysis finishes
    Then the report still arrives
    And that angle's section says "This angle could not be investigated"

  Scenario: Leaving the session does not cancel the job
    Given a deep analysis is running in session A
    When I open session B and later return to session A
    Then session A's conversation contains the finished report card
```

## Acceptance

- Every scenario above passes; backend tests (service level, with the assistant stubbed) cover plan/investigate/write sequencing, the 5-angle cap, single-job-per-session, per-angle failure isolation, SQL extraction, report assembly, download naming and id validation (R2-R19).
- A finished job leaves a markdown file in the session workspace that is still downloadable after a restart.
- A job never writes to the session's chat memory (the next normal question sees the same history as before the job).

## Open questions

- Open question: the pending card is local to the open chat view and is not restored on returning to the session mid-job or after an app restart, although the job (if the backend is still running) continues and its report appears. Should running jobs be rediscoverable?
- Open question: a running job cannot be cancelled by the user; only backend shutdown aborts it.
- Open question: the planner prompt asks for 3 to 5 angles but the output schema accepts 1 or more; the cap of 5 is enforced afterwards. Should a plan of fewer than 3 be rejected?
- Open question: jobs are in memory only, so after a restart a job's status is unknown and its title is unknown for the download file name. Should job records persist?
- Open question: there is no way to list or re-download an older report other than via its card in the transcript.
- Open question: the client's result type declares a `rowCount` field that the backend never sends.

<!-- sources: backend/src/modules/deep-analysis/**, backend/src/modules/sessions/sessions.service.ts (backgroundAgentOptions, appendAssistantMessage, agentContext), backend/src/modules/sessions/entities/session.entity.ts (report), frontend/src/app/features/sessions/components/session-chat/session-chat.ts + .html (runDeepAnalysis, pollDeepAnalysis, downloadReport), frontend/src/app/features/sessions/services/sessions-api.service.ts, frontend/src/app/features/sessions/models/session.model.ts -->

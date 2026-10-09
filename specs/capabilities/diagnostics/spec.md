# Diagnostics

When something goes wrong, the user can open **System logs** from anywhere in the app, see what the desktop shell, the interface, the backend and the AI runtime have been reporting, narrow it to problems, and export a redacted, LLM-readable Markdown report to attach to a support request or paste into a chat with an LLM. Nothing in the logs or the report may leak a password, token, API key or connection credential. The buffer is bounded and survives restarts.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): diagnostics, system logs, log run, data directory, datasource.

Capability-local vocabulary:
- **Entry** — one log record: id, ISO timestamp, level (`debug`, `info`, `warn`, `error`), source, message, optional structured details.
- **Issue** — an entry whose level is `error` or `warn`.
- **Source** — where an entry came from: `renderer` (interface errors), `renderer:*` (explicitly recorded interface events), `user-visible` (an error toast), `backend` (backend process output), `backend:mastra` (structured agent-runtime logs), `electron` (desktop shell), `electron:renderer` (the shell reporting on the page).

## Rules

What is captured
- R1. The system SHALL record every uncaught interface error (message, file, line, column and stack when known) as an `error` entry with source `renderer`.
- R2. The system SHALL record every unhandled promise rejection as an `error` entry with source `renderer`: the error's message when the reason is an error (with its stack as details), otherwise "Unhandled promise rejection: <reason>".
- R3. The system SHALL record every error toast shown to the user as an `error` entry with source `user-visible` and the toast text as the message. This is how failed operations, including failed connection tests, reach the log from the interface.
- R4. The desktop shell SHALL capture everything the backend process writes to standard output and standard error, line by line, with terminal colour codes removed and blank lines dropped.
- R5. A backend line that is a JSON object with a `message` SHALL be recorded with source `backend:mastra`, its own `level` when it is a string (otherwise the stream's default), and every other JSON field as the entry's details.
- R6. Any other backend line SHALL be recorded with source `backend`. Its level SHALL be `error` if it contains the word ERROR or FATAL, else `warn` if it contains WARN, WARNING or a word ending in "Warning", else `debug` if it contains DEBUG, else the stream's default: `info` for standard output, `error` for standard error.
- R7. The desktop shell SHALL record its own events with source `electron`: diagnostics initialised (version, platform, architecture), backend process exits and failures, restart attempts, the restart budget being exhausted, a missing backend entry file, a backend not ready before the timeout, data-directory migration outcomes, secret-file problems, and report exports. It SHALL record page-level events with source `electron:renderer`: the page failing to load, recovery from a missing-file load (at most 3 attempts), the page process stopping, the window becoming unresponsive.
- R8. Backend failures to reach a datasource or a model provider SHALL appear as backend log lines (level `warn` or `error`) and, when they surface as an error toast, additionally as `user-visible` entries.
- R9. A caller outside the desktop shell (a plain browser) SHALL still be able to record entries; they SHALL be kept in memory only, with ids prefixed `browser-`, and SHALL be lost on reload.

Redaction
- R10. Before an entry is stored, shown, written to disk or exported, the system SHALL redact secrets from its source, message and every string inside its details. The marker SHALL be exactly `[REDACTED]`.
- R11. The following SHALL be redacted, case-insensitively:
  - the value of any key named `password`, `token`, `api_key`, `api-key`, `apikey`, `secret` or `authorization` (also when it is the tail of a longer name such as `accessToken`), followed by `:` or `=`, whether the key is bare, in single or double quotes, and whether the value is quoted (quoted values are replaced whole, quotes kept) or unquoted (up to the next quote, comma, whitespace or `}`);
  - the credential after the word `Bearer`;
  - the password in a `postgres://user:password@host` or `postgresql://…` connection string.
- R12. The exported report SHALL be redacted once more as a whole, after assembly, so nothing introduced by formatting can escape.
- R13. Redaction SHALL NOT change an entry's level, timestamp or structure.
- R14. The text `Authorization: Bearer <credential>` (header form) SHALL redact the credential. See Open questions: the current implementation redacts only the word "Bearer" in this form and leaves the credential visible.

Retention and persistence
- R15. The shell SHALL keep at most the 2,000 most recent entries in memory and the interface SHALL keep at most 2,000 entries, oldest dropped first.
- R16. The shell SHALL append every entry as one JSON line to a log file in the data directory (`logs/system.ndjson`). At launch, if that file exceeds 5 MiB it SHALL be moved to `logs/system.previous.ndjson` (replacing any earlier one) and a new file started; then the last 2,000 entries of the current file SHALL be reloaded, skipping any unparseable line.
- R17. Logging SHALL never interrupt the app: a failure to write the log file SHALL be ignored.
- R18. A single entry's message SHALL be truncated to 10,000 characters and its source to 120.
- R19. New entries SHALL be pushed to the open interface live; entries with an id already shown SHALL replace rather than duplicate. The list SHALL always be ordered by timestamp, oldest first.

System logs panel
- R20. The system SHALL provide an **Open system logs** button in the primary sidebar footer. It SHALL open the System logs panel as a modal dialog over the app, dimming the content behind it. The panel SHALL be labelled "System logs", show a "LIVE" indicator and the subtitle "Desktop, interface, backend, and AI runtime diagnostics".
- R21. The panel SHALL close with its **Close system logs** button or by clicking the dimmed area outside it. Closing SHALL discard the panel's view state: reopening starts fresh (tab All, empty search, Group by run on, Follow on).
- R22. The panel SHALL offer an **All** tab (with the total entry count) and an **Issues** tab (with the issue count), and SHALL show the number of errors and the number of warnings.
- R23. The panel SHALL offer a search box ("Search messages or sources", labelled "Search system logs"). It SHALL match, ignoring case and surrounding whitespace, against the source, the message and the text of the details together. The Issues tab and the search SHALL combine.
- R24. The panel SHALL offer a **Refresh logs** button that reloads the entries from the shell, merging them into the list, and shows a spinner while loading.
- R25. The panel SHALL offer a **Follow** checkbox, ticked by default. While ticked, the list SHALL scroll to the newest entry whenever the visible entries change; while unticked, the scroll position SHALL be left alone.
- R26. The panel SHALL offer a **Group by run** checkbox, ticked by default. While ticked, entries SHALL be grouped into backend runs: a run begins at the first entry whose message starts with `[Nest] <pid>` where the pid differs from the current run's. Entries without a pid (agent runtime, shell, interface, error toasts) SHALL belong to whichever run was alive at their time; entries before any backend line stay in a flat list above the runs. A pid that comes back after a different one opens a new run.
- R27. Each run SHALL show its ordinal ("Run 1", "Run 2"…), PID, time span, number of entries shown, error count and warning count, and "started before this window" when its startup line has aged out. Only the newest run SHALL be expanded, except that while filtering or searching every run that still has a matching entry SHALL be expanded. Run counts SHALL reflect the whole run, not the filter. Runs with no matching entry SHALL be hidden while filtering.
- R28. Each entry row SHALL show its time, level badge, source and message. Expanding a row SHALL show a plain-language explanation of its source and, when present, its details as formatted JSON. Explanations: `user-visible` → "An operation shown in the app failed."; `backend:mastra…` → "The AI agent runtime reported this event."; `backend…` → "The local data and backend service reported this event."; a source containing `renderer` → "The application interface reported this event."; `electron…` → "The desktop application shell reported this event."; anything else → "A system component reported this event."
- R29. When any issue exists, the panel SHALL show a "Latest issue" banner with its time, message and source explanation.
- R30. The panel footer SHALL read "Up to 2,000 recent entries are retained. Logs are redacted before export." and "Expand a row for context and stack details."
- R31. The sidebar's Open system logs button SHALL carry a live badge with the issue count (R4 of [../app-shell/spec.md](../app-shell/spec.md)).
- R32. The app SHALL NOT show a Help button.

Export
- R33. The panel SHALL offer an **Export** button. While exporting it SHALL read "Exporting…" and be disabled.
- R34. In the desktop app, Export SHALL open a native save dialog titled "Export diagnostics for an LLM", defaulting to `questions-to-insights-diagnostics-<YYYY-MM-DD>.md`, with Markdown (`md`) and Text (`txt`) filters. If the user cancels, nothing SHALL be written and no message SHALL be shown.
- R35. On a successful save the system SHALL write the report, record an `info` entry "Diagnostics report exported", and show the toast "Exported N diagnostic entries", where N is the number of entries included.
- R36. Outside the desktop shell (plain browser), Export SHALL download the same filename directly, with a simplified report (title, generated time, entry count, instructions, errors and warnings, chronological log; no version or platform lines, no redaction by the shell).
- R37. If export fails, the system SHALL show an error toast with the failure message, or "Diagnostics export failed".
- R38. The desktop report SHALL be Markdown with exactly these parts, in order:
  1. Title `# Questions to Insights — Diagnostics Report`, then lines "Generated: <ISO time>", "Application version: <version>", "Platform: <os> (<arch>)", "Entries included: <N>", and a note that secrets and connection credentials are automatically redacted and the report is meant to be attached to an LLM or support request.
  2. `## Instructions for the analyzing LLM`: identify the earliest likely root cause, distinguish it from downstream symptoms, cite timestamps and sources, propose safe next diagnostic or remediation steps, state uncertainty explicitly.
  3. `## Summary`: counts of errors, warnings, info and debug entries, and the sources with their counts ("none" if empty).
  4. `## Errors and warnings with nearby context`: the 50 most recent issues, oldest first, each as `### <n>. <LEVEL> — <source>` with its timestamp, message, a text block with the 3 entries before and the 1 entry after it, and, when present, its details as JSON. When there are no issues the section says "No errors or warnings were captured."
  5. `## Chronological log`: every entry, one line each: timestamp, level padded to 5 characters, `[source]`, message with line breaks written as `\n`.
- R39. Triple backticks inside any logged text SHALL be rewritten to `~~~` so they cannot break the report's code blocks.
- R40. The report SHALL contain every entry currently retained by the shell, not only the ones filtered on screen.

## Edge cases and errors

- Empty state: with no matching entries the panel shows "No matching log entries" and "New application events will appear here automatically."
- A search that hides the backend lines still keeps the run boundaries correct, because grouping is computed on the full list before filtering.
- A log file line that is not valid JSON is skipped at load; the rest are kept.
- If the log directory cannot be created or read, the app starts with an empty in-memory buffer.
- An entry with an unknown level is stored as `info`.
- Details that cannot be turned into JSON are stored as redacted text.

## Contracts

- Desktop IPC bridge (`systemDiagnostics`: list, record, export, subscribe): [../../system/api.md](../../system/api.md).
- Log file and retention: [../../system/data-model.md](../../system/data-model.md) (files on disk, `logs/`).
- Entry shape: Entry (R-defined above); level and source vocabulary in this file.
- Error toasts that feed the log: [../app-shell/spec.md](../app-shell/spec.md).

## UI

The panel is a modal overlay above the whole app, reached from the sidebar footer: [../../system/ui.md](../../system/ui.md). States: empty, loading (refresh spinner), populated flat, populated grouped by run, filtered, exporting, and with a "Latest issue" banner.

## Flows

E2E: `frontend/e2e/diagnostics.spec.ts` for the Feature below (moved verbatim from the repository `gherkin.md`). Scenarios tagged `@desktop-only` rely on the desktop shell (shell-side redaction, the native save dialog) and run only in the Playwright `desktop` project. The `web` project skips them (see *Test target convention* in [CLAUDE.md](../../../CLAUDE.md)).

```gherkin
Feature: Diagnostics

  @desktop-only
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

E2E: none yet for the Feature below.

```gherkin
Feature: Diagnostics behaviour not yet covered by Playwright

  Scenario: Cancelling the save dialog exports nothing
    Given I opened "System logs"
    When I click "Export"
    And I cancel the save dialog
    Then no file is written
    And I see no "Exported" message

  Scenario: Groups entries by backend run
    Given the backend has been restarted once
    When I open "System logs"
    Then I see "Run 1" and "Run 2" with their PIDs
    And only "Run 2" is expanded
    When I search for text that appears only in "Run 1"
    Then "Run 1" is expanded and "Run 2" is hidden
    When I untick "Group by run"
    Then entries appear as one flat list

  Scenario: Shows a failed operation as a user-visible error
    Given a datasource connection test fails and an error toast is shown
    When I open "System logs" and click "Issues"
    Then I see an entry with source "user-visible" and the toast text
    And the sidebar badge on "Open system logs" counts it

  Scenario: Redacts a connection string password
    Given the backend logs "postgres://qti:s3cret@localhost:5432/db"
    When I search the logs for "postgres://"
    Then I see "postgres://qti:[REDACTED]@localhost:5432/db"

  Scenario: Redacts an Authorization header credential
    Given an entry whose message is "Authorization: Bearer abc123"
    When I open "System logs"
    Then the entry does not show "abc123"

  Scenario: Keeps the report free of broken code fences
    Given an entry whose message contains three backticks
    When I export the report
    Then the report shows "~~~" in their place

  Scenario: Remembers entries across restarts
    Given the app recorded entries and was closed
    When I reopen the app and open "System logs"
    Then the earlier entries are listed
```

## Acceptance

- Both `diagnostics.spec.ts` scenarios pass.
- Exported report contains the five parts of R38 in order and none of the secrets seeded into the entries (password, token, bearer value).
- After a restart the log shows entries from before the restart; a log file larger than 5 MiB is rotated to `system.previous.ndjson` at launch.
- The "Authorization: Bearer" gap in R14 is fixed or consciously accepted before this capability is considered complete.

## Open questions

- The header form `Authorization: Bearer abc123` is currently redacted to `Authorization: [REDACTED] abc123`, because the key-value rule consumes the word "Bearer" before the Bearer rule runs. The credential survives. A bare `Bearer abc123` and the JSON form `"authorization":"Bearer abc123"` are fully redacted. R14 states the intended rule; the implementation needs fixing.
- Redaction runs only in the desktop shell. In a plain browser the fallback buffer and fallback report are not redacted, although R3 feeds error toast text into them. Should the browser path redact too?
- Backend run grouping depends on the backend's default log format starting each line with `[Nest] <pid>`. A different log format would put every entry in the flat list.
- Secrets whose key name is not in the R11 list (for example `pwd`, `passwd`, `access_key`, `private_key`) are not redacted. Decide whether to widen the list.

<!-- sources: frontend/src/app/core/diagnostics/, frontend/src/app/shared/components/system-logs-panel/, frontend/src/app/core/toast/toast.service.ts, frontend/src/app/app.html, frontend/electron/main.cjs (redactDiagnosticText, recordDiagnostic, recordBackendLine, buildDiagnosticMarkdown, initializeDiagnostics), frontend/electron/preload.cjs, frontend/e2e/diagnostics.spec.ts -->

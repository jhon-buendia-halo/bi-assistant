# Non-functional requirements

Platforms, storage, security, privacy, limits, accessibility, reliability and observability. Concrete values are the ones in the shipped code. Terms are defined in [glossary.md](glossary.md); principles come from [vision.md](vision.md).

## 1. Platforms and delivery

- N1. The product SHALL ship as a desktop app for macOS arm64, macOS x64 and Windows x64.
- N2. The product SHALL also run in a browser through an npm package with one command, on Node.js 22.13.0 or later. It serves the same UI and API from one origin.
- N3. The web server SHALL bind to `127.0.0.1` by default and listen on port 3000. If port 3000 is busy and no port was requested, it SHALL fall back to a free port. If an explicitly requested port is busy, it SHALL exit with code 1.
- N4. The desktop window SHALL open at 1440 x 900 and SHALL NOT shrink below 960 x 600.
- N5. The desktop app SHALL run its own backend as a child process and stop it when the app quits. No system Node.js is needed.
- N6. Desktop and web mode SHALL use different data directories by default, so both can run at the same time.
- N7. The app SHALL show its version in Settings.

Open question: Linux is not built or documented, although nothing in the product is Linux-specific. Confirm that it is out of scope.

Open question: setting a non-default backend port breaks the desktop renderer (roadmap 1.7.20, BA-109). Until fixed, the desktop app SHALL be treated as fixed to port 3000.

Build, packaging and versioning detail is in [../system/delivery.md](../system/delivery.md).

## 2. Local-first data

- N8. All application data SHALL be stored on the user's machine in one data directory. It contains:
  - the application database (settings, datasources, datasets, sessions, metrics, knowledge, verified queries, eval runs, schema inventory cache),
  - agent memory,
  - agent observability data (traces, metrics, logs),
  - one workspace folder per session (visuals, reports),
  - the app secret file.
- N9. Default data directory: on desktop, the operating system's per-user application data folder. On Windows it SHALL be the local, non-roaming profile folder, because roaming profiles are often synced or locked. Existing data SHALL be moved there once; if the move fails, the app SHALL keep using the roaming folder and log a diagnostic, and SHALL NOT lose data. In web mode, `~/.questions-to-insights`, overridable with `--data-dir` or the `QTI_DATA_DIR` or `APP_DATA_DIR` environment variables.
- N10. A rename of a stored collection or field SHALL come with a migration that keeps old data readable. Existing migrations: `projects` to `sessions`, `sandbox_selections` to `datasets`, session field `sandboxes` to `datasets`, source field `sourceProjectId` to `sourceSessionId`, workspace folders `project-<id>` to `session-<id>`, a single anonymous Databricks connection to a named datasource, and the desktop user-data folder rename from "Questions to Insights" to "Halo BI Assistant". The session list order (by last update) SHALL NOT change because of a migration.
- N11. UI layout preferences (right-panel width) SHALL be kept in browser local storage, not on the backend.
- N12. Deep analysis jobs and in-flight eval runs are held in memory; a restart forgets running jobs. Completed eval runs are persisted. Reports are stored in the session workspace.
- N13. The app SHALL work offline except for LLM calls and datasource queries.

## 3. Security

### Secrets

- N14. LLM API keys SHALL be encrypted at rest with AES-256-GCM. The key is derived from the app secret (SHA-256); each value has its own random 12-byte IV and an authentication tag.
- N15. On desktop the app secret SHALL be 32 random bytes (hex), created on first launch and stored in `.app-secret` in the data directory with owner-only permissions (mode 0600). The `APP_SECRET` environment variable, when set, SHALL win. The web command SHALL create and read the same file in its own data directory, and so SHALL a backend started on its own without `APP_SECRET`. No fixed, known secret SHALL ever encrypt a key.
- N16. If the app secret file cannot be written, the app SHALL log a diagnostic and use a new secret each launch, which makes previously encrypted keys unreadable. The user SHALL back up the data directory together with `.app-secret`.
- N16a. A key encrypted under the former fixed development secret (used before BA-106 when no `APP_SECRET` was set) SHALL be re-encrypted with the current secret at startup. A key that cannot be read SHALL be reported as needing re-entry, never as an unexplained error.
- N17. API responses SHALL NEVER contain a stored API key, database password, Databricks token or REST credential in plain text. They SHALL show the mask `••••••••`. When the UI sends the mask back, the system SHALL keep the stored secret.
- N18. The LLM settings view SHALL show only a masked form of the key.

Open question (discrepancy): the README says the application database stores datasource credentials "encrypted". The code encrypts only the LLM API key. Datasource credentials (Databricks token, PostgreSQL password, REST tokens and passwords) are stored as plain JSON in the application database and are only masked in API responses. Decide: encrypt them (preferred) or correct the documentation.

### Read-only access to data

- N19. Every SQL statement the assistant runs SHALL pass a guard before it reaches a datasource. The guard SHALL:
  - strip leading markdown code fences and leading comments,
  - reject empty statements,
  - reject more than one statement (any `;` after trailing semicolons are removed),
  - accept only statements that start with `SELECT` or `WITH`,
  - reject any statement containing the whole words `insert`, `update`, `delete`, `merge`, `drop`, `alter`, `truncate`, `create`, `grant`, `revoke`, `upsert` or `replace`, in any case.
- N20. On PostgreSQL the statement SHALL also run inside a read-only transaction that is always rolled back.
- N21. The datasource kinds' own permissions are the last line of defence. The product SHOULD tell users to connect with a read-only database user.
- N22. REST API datasources SHALL be read with HTTP GET only. Their rows are queried through a local SQL engine over fetched data, never by sending SQL to the remote API.

Open question: the keyword guard rejects harmless statements that contain a listed word as a whole word, for example a column or function named `replace` or `update`, even inside a string literal. Confirm that this false-positive risk is accepted.

Open question: the assistant's prompt tells it to query only entities in the session's datasets, and `describe_entity` and `sample_rows` enforce that. `run_readonly_sql` does not: any entity the datasource credentials can read can be queried. Confirm whether the dataset boundary must be enforced for SQL, or whether credentials are the boundary.

Open question: PostgreSQL connections with SSL turned on do not verify the server certificate. Confirm that this is acceptable or add a certificate-verification option.

### Application surface

- N23. The desktop renderer SHALL run with context isolation on and Node integration off. It reaches the desktop shell only through a narrow bridge: diagnostics (list, record, export, subscribe) and backend status.
- N24. Generated visuals SHALL render in a sandboxed frame that allows scripts only, with no same-origin access. Each visual document SHALL carry a content security policy of `default-src 'none'`, inline styles and scripts only, `img-src data: blob:`, `font-src data:`, and `connect-src 'none'`, so a visual cannot make network requests. Visuals talk to the host only through messages (runtime errors, data point selection).
- N25. Markdown the app renders from model output (the analysis section of a visual) SHALL be sanitised.
- N26. In web mode, cross-origin access SHALL stay off (same origin). The desktop backend enables cross-origin requests, because the renderer loads from a `file://` page.
- N27. Session ids used to build workspace paths SHALL be restricted to letters, digits, `_` and `-`.
- N28. Diagnostics SHALL be redacted before they are stored or exported (see section 7).
- N29. The Databricks driver's own telemetry SHALL be turned off.

Open question: the backend has no authentication. On desktop it listens without a host restriction (all interfaces) on port 3000 with cross-origin access open; only the web command binds to `127.0.0.1` by default. Anyone who can reach the port can read data and use the stored LLM key. Confirm the intended boundary (bind desktop to `127.0.0.1`, add a per-launch token, or accept) before the beta.

Open question: the desktop main window has no explicit restriction on navigation or on opening new windows. Confirm.

## 4. Privacy: what leaves the machine

- N30. The only outbound network traffic SHALL be:
  - requests to the configured LLM provider endpoint,
  - queries and metadata reads against the user's configured datasources (Databricks workspace and Unity Catalog API, PostgreSQL, REST API),
  - for REST datasources, fetching the optional OpenAPI spec URL the user typed,
  - for the REST/OpenAPI discovery, nothing else.
- N31. The product SHALL NOT send analytics, usage telemetry or crash reports to Halo or any third party, and SHALL NOT auto-update itself. Installers are fetched manually from the release page.
- N32. Data sent to the LLM provider includes: the user's questions and chat history; schema names and column types; sample values (up to 5 distinct values per column, 40 characters each) captured when a dataset is saved; sample rows (up to 5 per entity) for knowledge bootstrap; and result rows of queries the assistant ran (up to the row caps in section 5). Users SHOULD be told that data returned by their queries is shared with their LLM provider.
- N33. Agent observability data (traces, which include prompts and tool results, plus metrics and logs) SHALL stay in the local data directory.
- N34. The diagnostics report SHALL be created only on user action (export) and saved where the user chooses.

## 5. Performance and limits

All values are the ones in the code today.

### Assistant turn

| Item | Value |
|---|---|
| Tool steps per assistant turn | 15 |
| Recent messages replayed from memory | 40 |
| Rows per `run_readonly_sql` result | default 100, max 500 |
| Rows per `sample_rows` result | default 10, max 100 |
| Rows stored per data record in the transcript | 200 |
| Rows given to the answer-synthesis pass for a tool-only turn | 50 per record |
| Longest stored rationale | 400 characters |
| Result guards scan at most | 5,000 rows |
| Clarifications per user question | 1 |

- N35. A result that fills its row limit SHALL be marked truncated, with a note that totals may be incomplete. The assistant SHALL aggregate or caveat the answer.
- N36. A result with zero rows SHALL carry a note telling the assistant to verify filters and values before concluding.

### Context budgets (characters per turn)

| Block | Budget |
|---|---|
| Dataset schema block (default) | 6,000 |
| Join hints | 1,500 |
| Curated knowledge | 2,000 |
| Governed metrics | 4,000 |
| Verified-query reference (3 pairs at most) | 3,000 |
| Schema block handed to the SQL fixer | 4,000 |
| Schema block handed to the SQL verifier | 6,000 |
| Schema block handed to knowledge bootstrap | 6,000 (sample rows 4,000) |

- N37. Context that exceeds a budget SHALL be cut, not sent in full. The "knowledge used" record SHALL list only entries that fit.

### Datasource time limits

| Datasource | Item | Limit |
|---|---|---|
| PostgreSQL | connection | 5 s |
| PostgreSQL | read-only query | 30 s |
| PostgreSQL | connection test | 5 s |
| PostgreSQL | inventory | 10 s |
| Databricks | connection test | 30 s |
| Databricks | catalog metadata query | 15 s |
| Databricks | full inventory query | 120 s |
| Databricks | assistant query | 120 s |
| Databricks | Unity Catalog API call | 20 s |
| Databricks | concurrent inventory sessions | 5 |
| REST | one request | 20 s |
| REST | total fetch for one endpoint | 120 s |
| REST | pages per endpoint | 50 |
| REST | rows per endpoint (default) | 10,000 (configurable per endpoint) |
| REST | nested object flattening depth | 3 levels |
| REST | OpenAPI spec fetch | 10 s, 20 MiB |
| LLM | connection test | 30 s |
| Sample data load | connect / seed | 8 s / 120 s |

- N38. A Databricks query MAY take up to 120 seconds, because a cold warehouse can take minutes to start. The timeout SHALL produce a clear message such as "Databricks connection timed out after 120s".
- N39. Dataset save SHALL sample at most 50 rows per table, with 4 tables in flight at once, and SHALL NOT fail the save when a sample fails.

### Visuals

| Item | Value |
|---|---|
| Designer call timeout | 120 s |
| Rows per result set given to the designer | 100 |
| Result sets given to the designer | 3 |
| Data given to the designer | 40,000 characters |
| Spec attempts before freeform generation | 2 |
| Blank-render check after load | 1.5 s |
| Rows re-fetched by a refresh | up to 500, 200 stored |
| Rows shown in the provenance section | 10 (48 characters per cell) |

### Other jobs

| Item | Value |
|---|---|
| Deep analysis angles | 5 at most |
| Deep analysis findings per angle | 12,000 characters |
| Deep analysis jobs per session at once | 1 |
| Deep analysis jobs retained for polling | 50 |
| Eval runs per agent at once | 1 |
| Eval result-set comparison rows | 500 |
| Knowledge bootstrap drafts | 15 at most |
| Metric name length | 64 characters |
| Metric candidates offered | 12 |

- N40. The UI SHALL stay responsive during long jobs. Chat turns stream; deep analysis and eval runs are started, then polled.
- N41. Closing the connection during a streamed turn SHALL abort that turn.

## 6. Reliability

- N42. When a statement fails with an engine error, the system SHALL ask the SQL fixer for a corrected statement and re-run it, up to 2 repair attempts (3 executions at most). It SHALL NOT attempt repair for guard rejections or for connection, authentication or timeout failures. If the fixer returns nothing or the same statement, the original error SHALL surface.
- N43. Requests to an LLM provider that return 429, 500, 502 or 503 SHALL be retried up to 3 times with waits of 1 s, 2 s and 4 s, or the provider's `Retry-After` value when present. Other statuses and network errors SHALL NOT be retried.
- N44. An answer with no text after tool use SHALL be replaced by a fallback message asking the user to retry; the system SHALL first try a synthesis pass over the retrieved data.
- N45. A failed turn SHALL show an error bubble in the chat that is not saved. Retrying SHALL reuse the unanswered user message instead of duplicating it.
- N46. Visual generation SHALL try a spec twice, then fall back to freeform generation. Generated JavaScript SHALL be parse-checked and retried once with the parse error. A timeout SHALL NOT be retried.
- N47. A runtime error or blank render in a visual SHALL trigger one automatic repair of the current version. An auto-repair version SHALL NOT itself be auto-repaired.
- N48. The desktop shell SHALL restart an unexpectedly stopped backend up to 3 times, waiting 1 s, 2 s and 4 s. A backend that stays ready for 60 s SHALL get a fresh restart budget. After the budget is spent the status SHALL be `down`. The shell SHALL wait up to 30 s for the first readiness. Status values: `starting`, `ready`, `restarting`, `down`. A banner SHALL show any status other than `ready`.
- N49. If the desktop page fails to load a missing `file://` entry point, the shell SHALL reload the real entry point, at most 3 times.
- N50. Datasource inventory SHALL be cached and re-read on demand ("Refresh inventory"). A refused table during dataset sampling SHALL NOT fail the whole batch.
- N51. Stopping the web command (Ctrl+C) SHALL shut down cleanly and SHALL force exit after 5 s.

## 7. Observability and diagnostics

- N52. The desktop shell SHALL collect diagnostics from its own events, the backend's output and the renderer's errors, with levels `debug`, `info`, `warn`, `error`. It SHALL keep at most 2,000 entries in memory and write them to a log file (`logs/system.ndjson`) in the desktop user-data folder (on Windows this can differ from the data directory in N9). At the next start, a log file larger than 5 MiB SHALL be rotated to `system.previous.ndjson`, and the last 2,000 entries SHALL be reloaded.
- N53. Before an entry is stored, the system SHALL redact: values of keys named password, token, api key, secret or authorization (quoted or not), bearer tokens, and the password part of `postgres://user:pass@host` URLs. The text `[REDACTED]` replaces them. A message is cut at 10,000 characters and a source name at 120.
- N54. The System logs panel SHALL show a count of errors and warnings on its footer button (capped at "99+"), support filtering to issues and searching, and group entries by backend run. Entries from sources with no process id attach to the run that was alive at the time.
- N55. The user SHALL be able to export an LLM-readable markdown report (instructions for the analysing LLM, errors and warnings, chronological log). On desktop it SHALL be redacted again as a whole and the user picks the save location. Code fences inside log text SHALL be neutralised.
- N56. Failed SQL repairs SHALL log a one-line warning with the statement cut to 500 characters, so it can ship in a diagnostics report.
- N57. Agent traces, metrics and logs SHALL be persisted locally for inspection (see N33).

Open question (gap): in web mode there is no desktop bridge. Diagnostics hold only renderer errors in memory, with no backend log lines, no persistence and no redaction on export. Confirm whether web mode needs parity.

## 8. Accessibility

- N58. The application shell SHALL have no automatically detectable accessibility violations (checked with axe in the end-to-end suite).
- N59. Landmark regions SHALL have labels ("Primary sidebar", "Workspace navigation", "Sessions navigation", "Settings sidebar", "Settings navigation"). The page SHALL have a visually hidden level-one heading.
- N60. Icon-only buttons SHALL have an accessible name or title (collapse and expand sidebar, collapse and expand right panel, open system logs, session options, careful mode, deep analysis).
- N61. The right-panel divider SHALL be a keyboard-operable separator named "Resize right panel", with its current width exposed. Arrow keys SHALL change it by 24 px, Home SHALL set the minimum (360 px), End SHALL set the maximum (960 px, less room kept for the main content, at least 240 px), and a double-click SHALL reset it to 572 px. The width SHALL be remembered.
- N62. Toggle controls SHALL expose their state (careful mode uses `aria-pressed`).
- N63. Status that appears without a user action (deep analysis progress) SHALL have a labelled region.

- N64. The app SHALL offer a light and a dark theme, following the operating system by default (decided 2026-10-09 for epic BA-141). Text colours SHALL meet WCAG AA contrast (4.5:1) against their surfaces in both themes, and the axe check SHALL pass in both.

Open question: no screen-reader or reduced-motion requirement is written down beyond the axe check.

## 9. Compatibility and upgrades

- N64. Installing a newer version over an older one SHALL keep user data. Persisted shapes change only with a migration (N10).
- N65. Documents written before a field existed (for example verified, interpretation, cross-check, reasoning trail, comparison on eval runs) SHALL still load; readers treat those fields as optional.
- N66. The native modules the backend needs SHALL load from prebuilt binaries on supported Node versions.

<!-- sources: README.md, CLAUDE.md, frontend/electron/main.cjs, frontend/electron/preload.cjs, frontend/src/app/app.ts, frontend/src/app/app.html, frontend/src/app/core/diagnostics/*, frontend/src/app/core/backend-status/*, frontend/e2e/layout-accessibility.spec.ts, frontend/e2e/diagnostics.spec.ts, backend/src/main.ts, backend/src/cli.ts, backend/src/app-bootstrap.ts, backend/src/infrastructure/crypto/crypto.service.ts, backend/src/infrastructure/database/database.module.ts, backend/src/modules/datasources/connectors/*.ts, backend/src/modules/datasources/datasources.service.ts, backend/src/modules/llm/llm.service.ts, backend/src/modules/llm/retry-fetch.ts, backend/src/modules/sessions/*.ts, backend/src/modules/datasets/datasets.service.ts, backend/src/modules/knowledge/knowledge.service.ts, backend/src/modules/metrics/metrics.service.ts, backend/src/modules/verified-queries/verified-queries.service.ts, backend/src/modules/deep-analysis/deep-analysis.service.ts, backend/src/mastra/*.ts, backend/src/modules/testing-data/testing-data.service.ts -->

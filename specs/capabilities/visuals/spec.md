# Interactive visuals

Any completed answer can become an interactive visual: a chart, KPI tiles or a table, wrapped in a readable document. The document states the question, the takeaway, the full analysis, how it was worked out and the exact data it was built from. Visuals take part in the conversation:
- the user creates one from an answer or by asking the assistant;
- the user tailors it in plain English, either in the chat or from the panel's Tailor form;
- every change becomes a new version in a history the user can browse and revert;
- its data can be refreshed in place by re-running the stored SQL;
- a visual that breaks at runtime repairs itself once, silently.

Every version can be exported as a self-contained bundle that opens offline, without the app.

## Concepts

Defined in [glossary](../../product/glossary.md): **Visual**, **Visual version** (current vs. viewed), **Visual spec** (the small chart description rendered by the fixed chart runtime), **Freeform visual** (designer-written markup, style and script), **Readable frame**, **Takeaway**, **Data provenance**, **Data mark**, **Auto-repair**, **Tailoring instruction**, **Visual bundle**, **Session workspace**, **Answer**, **Data record**, **Reasoning trail**. Chat-side concepts (answer, data records, turn) are specified in [sessions-chat](../sessions-chat/spec.md).

## Rules

### Creating

- R1. The system SHALL create a visual only from a completed assistant answer. The answer must have non-empty text and must not be a clarification. When no answer is named, the latest such answer is used.
- R2. Every answer with text SHALL offer "Generate interactive visuals". While generating, the label reads "Generating interactive visuals…" and the button is disabled. It is also disabled while a chat turn runs. One generation runs per session at a time.
- R3. The assistant SHALL create a visual when the user asks for a chart or visual of an answer, and SHALL never paste HTML, CSS or JavaScript into the chat. A visual created during a turn SHALL also see that turn's query results, merged onto the source answer's data records. When both share the same SQL text, the turn's record wins.
- R4. A new visual SHALL get a unique id and start at version 1, with `currentVersion` = 1. Its title comes from the designer, trimmed to 100 characters (default "Interactive visual"). Its description (the takeaway) also comes from the designer. Its source answer is recorded by timestamp.

### Designing (spec first, freeform fallback)

- R5. The designer SHALL receive:
  - the question;
  - the answer text;
  - the instruction, if any;
  - the current visual when tailoring;
  - a bounded data block: up to the 3 largest successful result sets in run order, sharing a budget of about 100 rows (never below 20 per set), shrunk until the block is under 40,000 characters;
  - a deterministic recommended-form block computed from the same rows.

  When rows were cut, the prompt says so.
- R6. When there are rows, the designer SHALL first produce a visual spec, unless it is tailoring a freeform visual (see R9). A spec has:
  - up to 4 KPI tiles: label, columns that select a result set, column, aggregation (sum, avg, min, max, count or value), format (number, compact, percent or currency) and unit;
  - one chart: bar, line, scatter, heatmap, metric-cards, table or donut, with select, x, y (one or several measures), series, sort, top N (≤200), stacked, labels, y format and axis labels;
  - an optional table with columns and a collapsed flag.
- R7. Before anything is written, the system SHALL validate the spec against the exact rows it will render:
  - every `select` must match a result set;
  - every named column must exist;
  - measures, and the x axis of a scatter, must be numeric in the sampled rows;
  - x/y forms need both x and y;
  - a heatmap needs a series;
  - `sort.by` must be x, y, the x column or a plotted measure.

  Problems go back to the designer in plain language. After 2 failed spec attempts, or when there are no rows at all, the freeform pipeline takes over.
- R8. A freeform visual's script SHALL be compile-checked without being executed. A script that fails to parse is retried once with the parse error. If it still fails, creation fails with "visualization agent produced JavaScript that does not parse".
- R9. Tailoring a freeform visual SHALL stay freeform. Tailoring a spec visual SHALL produce a spec, and freeform remains the fallback.
- R10. Each designer call SHALL time out after 120 seconds with "interactive visual generation timed out; please try again". A timeout is never retried as a spec problem.
- R11. A spec visual SHALL be drawn by one fixed, hand-written chart runtime, never by model-written code. The runtime:
  - reads rows from the embedded data;
  - shows "No data for this view." for an empty selection;
  - shows an em dash for any value that is not a finite number;
  - folds categories beyond top N into "Other";
  - offers legend toggles for series and hover/focus tooltips;
  - respects reduced motion.

### Tailoring and versions

- R12. Tailoring (from chat or the panel) SHALL require a non-blank instruction ("instruction is required"). It always produces a new version. The tailored design gets the current version's bundle, the current version's stored data (merged with the current turn's records when tailoring from chat) and the instruction. It is told to preserve everything the instruction does not ask to change.
- R13. In chat, the assistant SHALL tailor the visual open in the panel by default, or another visual by id. If no visual is open and none is named, the tool reports "No visual is open and none was specified — ask which visual to change or create one with create_visual". The assistant confirms the change in one short sentence.
- R14. The panel's Tailor form SHALL turn its fields into one plain-English instruction, skipping defaults:
  - Chart type (Auto, Bar, Line, Scatter, Heatmap, Metric cards, Table, Donut) → "Change the visual to a bar chart." / "…a line chart." / "…a scatter plot." / "…a heatmap." / "…metric cards." / "…a compact sortable table." / "…a donut chart.";
  - Sort (None, Ascending, Descending) → "Sort ascending by the main measure." / "Sort descending by the main measure.";
  - Top N (integer 3–50, optional) → `Show only the top <N> items and group the rest as "Other".`

  The form previews the instruction. "Apply" is disabled while the instruction is empty or a tailor is running. On success the form resets and closes.
- R15. Each version SHALL record its number, creation time, the instruction that produced it (absent for an untailored v1), its source answer and, after a refresh, its last refresh time. The visual's title and takeaway follow its current version.
- R16. Viewing a version SHALL be read-only and SHALL NOT change the current version. While a non-current version is viewed:
  - "Tailor" is disabled (title "Make this version current before tailoring");
  - "Refresh data" is disabled;
  - the version control is highlighted.
- R17. Reverting SHALL only move the current-version pointer to an existing version. No files change. An unknown version is rejected with "Version <N> does not exist".
- R18. Creating (button), tailoring (panel) and reverting SHALL each add a visual event card to the chat, persisted as an assistant message: `Created|Updated|Reverted interactive visual "<title>" (v<N>).` A chat turn that created or updated a visual carries the same card on its answer message. Refreshing and auto-repair SHALL NOT add chat messages.
- R19. When a chat turn creates or updates a visual, the panel SHALL switch to that visual at the new version while the turn is still streaming, without disturbing the turn (see [sessions-chat](../sessions-chat/spec.md) R21).
- R20. Opening a session SHALL load into the panel the visual that changed most recently, at its current version.

### Refresh data in place

- R21. "Refresh data" SHALL re-run every successful stored SQL query behind the current version. It requests up to 500 rows per query and keeps up to 200, flagging truncation. Then it rewrites only that version's stored data and document. There is no new version, no designer call and no chat event. The version gets a refresh timestamp.
- R22. During a refresh:
  - Records that are not SQL, or that had already failed, are kept as they are.
  - A query that fails to re-run stores its error in place and does not abort the others.
  - When the session has no bound datasource, every query records "No datasource is bound to this session's datasets".
  - When it has several datasources, every query records "Several datasources are in scope for this session; refresh is not supported".
- R23. The rationale of each query SHALL survive a refresh. The frame's reasoning trail SHALL still explain the original answer.

### Runtime errors and silent auto-repair

- R24. The sandboxed visual SHALL report to the host:
  - uncaught errors, with the line number when known;
  - unhandled promise rejections;
  - a blank render, as "visual rendered blank". A render counts as blank when, 1.5 s after load, the visual area has no SVG, canvas, table or image and no child at least 24 px tall.
- R25. On a reported error the panel SHALL silently request one repair, but only when all of these hold:
  - the version on screen is the current version;
  - no repair is already running;
  - the version on screen is not itself an auto-repair;
  - this `visual:version` pair has not been repair-attempted in this panel before.

  While the repair runs, the panel shows "Fixing the visual…".
- R26. A repair SHALL regenerate the current version with the runtime error, trimmed to 200 characters, as feedback. It stores the result as a new version whose instruction is `auto-repair: <error>` (or `auto-repair: the visual rendered nothing and reported no error`). The server refuses:
  - a version that is not current: "Only the current version can be repaired (requested v<X>, current v<Y>)";
  - a version that is already an auto-repair: "Version <N> is already an automatic repair; not repairing again".

  A repair of a repair is never attempted.
- R27. When a repair is not allowed or fails, the panel SHALL show the runtime error banner: "This visual hit a runtime error." followed by `<error> — ask the assistant to fix it or revert to an earlier version.` A new document clears the banner.

### Readable frame

- R28. Every visual SHALL render inside a fixed frame. The frame's content comes from the session transcript and stored data, never from the designer, except for the title, the takeaway and the visual itself. In order:
  1. title;
  2. "Question" (the user question behind the source answer);
  3. "Data entities" chips;
  4. the visual;
  5. "Takeaway" (the designer's description);
  6. "Analysis" (the assistant's answer as sanitized Markdown);
  7. "How this was worked out" (the reasoning trail, each step's rationale and "N rows" / "failed — <error>", rendered as plain text);
  8. a collapsible "Data used (N query|queries)";
  9. a footer: `Source: <entities> · Session: <name> · Version <N> · Generated <date>`.
- R29. Data provenance SHALL list each query as `Query <i> — <n> row(s)[ (truncated)]` or `Query <i> — failed`, with:
  - its rationale, SQL and error;
  - a table of its first 10 rows, with cells clipped to 48 characters and "—" for null, plus "Showing 10 of <n> rows." when there are more;
  - "Chart built from the first <shown> of <total> rows." when the designer saw a sample.
- R30. Answer Markdown in the frame SHALL be sanitized to an allowlist of text, list, table, code and link tags. Links are limited to http and https.
- R31. The designer's styles SHALL be confined to the visual's own area so they cannot restyle the frame. Style imports SHALL be stripped.
- R32. The visual SHALL read its rows from the embedded data at runtime, never from values baked into its code. The same embedded data feeds the frame, so a refresh updates both.
- R33. A frame generated or refreshed at a given time SHALL show that time. Otherwise it shows the version's last refresh time, or failing that its creation time.

### Sandboxing

- R34. The visual SHALL run in a sandboxed frame:
  - only scripts are allowed (no same-origin access, no forms, no popups, no top navigation), and no referrer is sent;
  - a content policy allows only inline scripts and styles, plus data/blob images and data fonts;
  - all network access is blocked.
- R35. The visual SHALL talk to the host only through messages: runtime errors (R24) and data-mark selections (R36). The host SHALL ignore any other message.

### Click to follow up

- R36. A data mark the visual flags as selectable SHALL, on click or Enter, send the host its value and, when present, its label and column. While a visual is open, the chat composer then offers "Suggested questions — click to ask:" with:
  - `Drill into "<label or value>"`, which fills the composer with `Drill into "<value>": break it down further.`;
  - `Why "<label or value>"?`, which fills it with `Why does "<value>" stand out? Explain the drivers.`;
  - "Dismiss follow-ups".

  Chips fill the composer but never send. Opening another session or another visual clears the selection.

### Export

- R37. "Download bundle" SHALL download a zip of the visual. It always contains:
  - `index.html`: the full frame with every script inlined, so it renders when opened directly from the zip;
  - `styles.css`;
  - `script.js`;
  - `qti-frame.js`: the host bridge, kept for editing.

  It also contains, when present:
  - `answer.md`: title, question, takeaway, analysis, "How this was worked out", "Data used" with SQL, and a session/version/generated line;
  - `data.json`: the stored data records;
  - `spec.json` and `qti-chart.js` (the chart runtime), for spec visuals.

  The exported document has no host-error hook. Selection messages are harmless with no host.
- R38. The downloaded file SHALL be named after the visual's title, slugged and up to 64 characters, falling back to `visual-<id prefix>`. Success shows the toast "Visual bundle downloaded". Failure shows the server message or "Bundle download failed".

### Storage

- R39. Each version's files SHALL live in the session workspace under the visual's directory, in a `v<N>` folder:
  - the frame document;
  - body fragment, styles and script;
  - the host bridge;
  - description, manifest;
  - answer and data when present;
  - spec and runtime for spec visuals.

  Visuals made before versioning keep version 1 at the visual's root and stay loadable.

## Edge cases and errors

| Situation | Behaviour |
|---|---|
| No completed answer to visualize | "completed assistant answer not found" |
| Unknown visual id | 404 "Visualization <id> not found in session <session>" |
| Generation fails | The panel shows "Visual generation failed" with the message, plus an error toast. Without a response: "Backend unreachable". |
| Generation succeeds | Toast "Interactive visual generated" |
| Saved visual fails to load | The panel shows "Visual generation failed" with "Could not load the saved visual". *(Open question: the heading is misleading for a load failure.)* |
| Answer had no rows | Spec mode is skipped and the freeform designer works from the answer text alone. |
| Designer returns the JSON Schema instead of an instance | The payload is unwrapped when usable. Otherwise the next attempt is told to return a bare instance. |
| Stored spec unreadable or invalid | The stored files are rendered as a freeform visual. |
| Tailor fails | Inline error in the Tailor form: server message, "Tailoring failed" or "Backend unreachable". |
| Tailor succeeds | Toast "Updated to version <N>" |
| Revert fails | Toast with the server message or "Revert failed" |
| Revert succeeds | Toast "Reverted to version <N>" |
| Refresh succeeds | Toast "Refreshed data for version <N>" |
| Refresh call fails | The button returns to idle with no message. *(Open question: there is no user feedback on failure.)* |
| Auto-repair succeeds | Toast "Repaired as version <N>". The new version shows. |
| Auto-repair fails | Runtime error banner (R27). |
| Viewing an old version that errors | Banner only. No repair. |
| Version entry text | `<instruction or "Initial version"> · <date>[ · refreshed <date>]` |

## Contracts

- Endpoints in [api.md](../../system/api.md):
  - generate visual;
  - load visual (optionally at a version);
  - revert;
  - tailor;
  - refresh;
  - repair;
  - download bundle;
  - the `visual-updated` event of the chat stream.
- Data in [data-model.md](../../system/data-model.md): the session document's visual list (visual metadata and version entries), the chat message's visual event, the version directory layout in the session workspace, and the legacy un-versioned layout.
- Agents in [agents.md](../../system/agents.md): the interactive visual designer (spec and freeform output shapes, the interactive-visuals skill, model routing including the `VISUAL_MODEL` override and swaps away from reasoning-class and nano-class models), and the assistant's `create_visual` / `update_visual` tools.
- Chat integration: [sessions-chat](../sessions-chat/spec.md).

## UI

Placement in the shell's right "Details panel" is in [ui.md](../../system/ui.md).

- **Panel header**: "Visuals", then, when a visual is open:
  - The version control (title "Version history", label `v<N>`, highlighted when an old version is viewed). It opens a list of every version, newest first, as "Version <N>" with "current" and "viewing" tags and the entry text. When an old version is viewed, the list starts with "Make v<N> the current version" / "now v<M>".
  - "Tailor" (title "Tailor this visual"), which opens a form with "Chart type", "Sort", "Top N (3–50, optional)" (placeholder "All items"), the instruction preview, the error line, and "Cancel" / "Apply".
  - "Refresh data" (title "Refresh data (re-run the stored query)").
  - "Download bundle" (title "Download bundle (HTML, CSS, JS, answer.md, data.json)").
  - When the session has visuals, a gallery button (title "Saved visuals in this session", with a count). It lists each visual, most recently changed first, with its title and `v<N> · <date>`. Clicking one opens it at its current version.

  Every action shows a spinner while busy.
- **Panel body states**:
  - Loading: "Designing the visual" / "Building and saving HTML, CSS, and JavaScript in the session workspace…"
  - Error: "Visual generation failed" and the message.
  - Empty: "No visual generated yet" / "Generate an interactive visual from any completed assistant answer."
  - Populated:
    - "Fixing the visual…" while repairing;
    - the runtime error banner when needed;
    - the sandboxed frame titled "Interactive visualization";
    - under it, the title and `<workspace path>/v<N>`.
- **Chat visual card**:
  - a chart icon;
  - "Created", "Updated" or "Reverted" followed by the title;
  - "Version <N>";
  - "View", which opens that visual *at that version* in the panel;
  - the assistant's own sentence, when it wrote one beyond the default text.
- **Follow-up chips**: above the composer, per R36.

## Flows

### Covered: Chat and visuals

The scenario "Renders a deterministic interactive visualization and its version controls" belongs to the Feature "Chat and visuals" in [sessions-chat](../sessions-chat/spec.md#feature-chat-and-visuals) (E2E: `frontend/e2e/chat-and-visuals.spec.ts`). It covers generating a visual from an answer, the frame title, "Download bundle", and the "Version history" list with "Version 1" and "current".

### Feature: Visual tailoring

E2E: none yet.

```gherkin
Feature: Visual tailoring

  Background:
    Given a "World Cup analysis" session with an answer "France won in 2018." that ran SQL
    And the visual "World Cup champions" at version 1 is open in the right panel

  Scenario: The panel is empty until a visual exists
    Given a session with answers but no visuals is open
    Then the right panel shows "No visual generated yet"
    And it shows "Generate an interactive visual from any completed assistant answer."

  Scenario: Tailoring from the panel creates a new version
    When I click "Tailor"
    Then "Apply" is disabled
    When I choose "Bar" in "Chart type"
    And I choose "Descending" in "Sort"
    And I type "5" into "Top N"
    Then I see the instruction 'Change the visual to a bar chart. Sort descending by the main measure. Show only the top 5 items and group the rest as "Other".'
    When I click "Apply"
    Then I see the toast "Updated to version 2"
    And the "Version history" button reads "v2"
    And the chat shows a card "Updated World Cup champions" with "Version 2"

  Scenario: Tailoring from the chat updates the open visual
    When I ask "Make it a line chart"
    Then the right panel shows "World Cup champions" at "v2" while the turn completes
    And the answer carries a card "Updated World Cup champions" with "Version 2"

  Scenario: Viewing and reverting to an earlier version
    Given the visual has versions 1 and 2 and version 2 is current
    When I click "Version history"
    Then I see "Version 2" tagged "current" and "Version 1" described as "Initial version"
    When I click "Version 1"
    Then the panel shows version 1
    And "Tailor" and "Refresh data" are disabled
    When I click "Version history"
    And I click "Make v1 the current version"
    Then I see the toast "Reverted to version 1"
    And the chat shows a card "Reverted World Cup champions" with "Version 1"
    And "Tailor" is enabled again

  Scenario: Refreshing data keeps the version
    When I click "Refresh data"
    Then I see the toast "Refreshed data for version 1"
    And the "Version history" button still reads "v1"
    And no new card appears in the chat
    When I click "Version history"
    Then version 1 shows "refreshed" with a time

  Scenario: A broken visual repairs itself once, silently
    Given version 1 throws an error when it renders
    Then I see "Fixing the visual…"
    And then I see the toast "Repaired as version 2"
    And the "Version history" list shows version 2 described as "auto-repair: …"
    And no new card appears in the chat

  Scenario: A repair that also breaks shows the error banner
    Given version 1 throws an error when it renders
    And its automatic repair, version 2, also throws an error
    Then I see "This visual hit a runtime error."
    And I see "— ask the assistant to fix it or revert to an earlier version."
    And no further repair is attempted

  Scenario: An old version that breaks is not repaired
    Given version 1 throws an error when it renders and version 2 is current
    When I view version 1 from "Version history"
    Then I see "This visual hit a runtime error."
    And "Fixing the visual…" is not shown

  Scenario: Exporting the bundle
    When I click "Download bundle"
    Then a file "world-cup-champions.zip" is downloaded
    And I see the toast "Visual bundle downloaded"
    And the archive contains "index.html", "styles.css", "script.js", "qti-frame.js", "answer.md" and "data.json"
    And opening "index.html" on its own shows the title, "Takeaway", "Analysis" and "Data used"

  Scenario: Switching between saved visuals
    Given the session also has a "Goals per tournament" visual
    When I click "Saved visuals in this session"
    Then I see "World Cup champions" and "Goals per tournament" with their versions
    When I click "Goals per tournament"
    Then the panel shows "Goals per tournament"

  Scenario: Clicking a data mark offers follow-up questions
    When I click the "France" mark in the visual
    Then I see "Suggested questions — click to ask:"
    When I click 'Drill into "France"'
    Then the "Ask a follow-up question…" box contains 'Drill into "France": break it down further.'
    And nothing has been sent
    When I click "Dismiss follow-ups"
    Then the suggestions are hidden

  Scenario: The readable frame explains the visual
    Then the "Interactive visualization" frame shows, in order, the title, "Question", the visual, "Takeaway", "Analysis", "How this was worked out" and "Data used (1 query)"
    And its footer shows "Session: World Cup analysis · Version 1"
```

## Acceptance

- Every scenario above passes. The covered scenario runs in `chat-and-visuals.spec.ts`.
- A visual generated against real data renders a chart whose values match its "Data used" rows. Its exported `index.html` renders identically when opened offline straight from the zip.
- No designer output can reach the frame outside the visual area. A visual with hostile markup or script can neither change the frame, reach the network nor reach the host app.
- A broken visual is repaired at most once per version. An auto-repaired version is never repaired again.
- Open questions to settle:
  - **Version numbering after a revert.** A new version is numbered *current + 1*. After reverting from v3 to v1, the next tailor or repair writes "v2" again: it overwrites v2's files and duplicates the version-2 entry. Should new versions be numbered after the highest existing one?
  - **Download version.** The panel downloads the *current* version even while an older version is viewed, and names the file `<slug>.zip`, while the server proposes `<slug>-v<N>.zip`. Should it download the viewed version?
  - **Repair data source.** Repair regenerates from the source answer's data, not from the current version's stored (possibly refreshed or merged) data. A repaired tailored visual can lose the rows a chat turn added.
  - **Default source answer.** When the assistant creates a visual without naming an answer, "latest completed answer" can be a previous visual event card rather than the current turn's answer, which is not persisted yet.

<!-- sources: backend/src/modules/sessions/visualization.service.ts, visualization-document.ts, visual-spec.ts, visual-runtime.ts, chart-heuristic.ts, zip-archive.ts, sessions.service.ts (generate/tailor/revert/refresh/repair/saveVisualMetadata), sessions.controller.ts; backend/src/mastra/agents/visualization.agent.ts, tools/visual.tools.ts; frontend/src/app/features/sessions/components/interactive-visual-panel/*, session-chat/session-chat.html|ts (visual cards, follow-up chips), services/sessions-api.service.ts; frontend/src/app/app.ts (showVisualization, revert, download, generate, loadLatestVisualization); frontend/e2e/chat-and-visuals.spec.ts -->

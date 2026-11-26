# Interactive visuals

A stored interactive visual (a chart, KPI tiles or a table, wrapped in a readable document) is viewed, reverted, refreshed and exported. Visuals can no longer be created or tailored: the visual designer (Ryan, `visualization`) and the visual tools were removed on 2026-11-26 (ADR-0059), so this spec keeps what is read:
- every version is in a history the user can browse and revert;
- its data can be refreshed in place by re-running the stored SQL;
- the document states the question, the takeaway, the full analysis, how it was worked out and the exact data it was built from.

Every version can be exported as a self-contained bundle that opens offline, without the app.

## Concepts

Defined in [glossary](../../product/glossary.md): **Visual**, **Visual version** (current vs. viewed), **Visual spec** (the small chart description rendered by the fixed chart runtime), **Freeform visual** (designer-written markup, style and script), **Readable frame**, **Takeaway**, **Data provenance**, **Data mark**, **Auto-repair**, **Tailoring instruction**, **Visual bundle**, **Session workspace**, **Answer**, **Data record**, **Reasoning trail**. Chat-side concepts (answer, data records, turn) are specified in [agent-answers](../agent-answers/spec.md).

## Rules

### Creating

- R1. Retired (2026-11-26, ADR-0059). The visual designer was removed with Emily, Ryan and Rachel, so nothing creates a visual any more; a stored visual is still viewed.
- R2. Retired (2026-11-26, ADR-0059). The "Generate interactive visuals" button is gone from answers and runs.
- R3. Retired (2026-11-26, ADR-0059). No agent creates a visual from a chat request: the `create_visual` tool is gone.
- R4. A new visual SHALL get a unique id and start at version 1, with `currentVersion` = 1. Its title comes from the designer, trimmed to 100 characters (default "Interactive visual"). Its description (the takeaway) also comes from the designer. Its source answer is recorded by timestamp.

### Designing (removed 2026-11-26)

- R5. Retired (2026-11-26, ADR-0059). The designer (its input, spec-first design, validation, timeout and freeform fallback) is gone. The spec the viewer reads, and how it is checked when a stored visual is rendered, are in [agents.md](../../system/agents.md) 6.8 and 6.9.
- R6. Retired (2026-11-26, ADR-0059). The designer (its input, spec-first design, validation, timeout and freeform fallback) is gone. The spec the viewer reads, and how it is checked when a stored visual is rendered, are in [agents.md](../../system/agents.md) 6.8 and 6.9.
- R7. Retired (2026-11-26, ADR-0059). The designer (its input, spec-first design, validation, timeout and freeform fallback) is gone. The spec the viewer reads, and how it is checked when a stored visual is rendered, are in [agents.md](../../system/agents.md) 6.8 and 6.9.
- R8. Retired (2026-11-26, ADR-0059). The designer (its input, spec-first design, validation, timeout and freeform fallback) is gone. The spec the viewer reads, and how it is checked when a stored visual is rendered, are in [agents.md](../../system/agents.md) 6.8 and 6.9.
- R9. Retired (2026-11-26, ADR-0059). The designer (its input, spec-first design, validation, timeout and freeform fallback) is gone. The spec the viewer reads, and how it is checked when a stored visual is rendered, are in [agents.md](../../system/agents.md) 6.8 and 6.9.
- R10. Retired (2026-11-26, ADR-0059). The designer (its input, spec-first design, validation, timeout and freeform fallback) is gone. The spec the viewer reads, and how it is checked when a stored visual is rendered, are in [agents.md](../../system/agents.md) 6.8 and 6.9.
- R11. A spec visual SHALL be drawn by one fixed, hand-written chart runtime, never by model-written code. The runtime:
  - reads every stored row of the result sets (at most 8, R5) from the embedded data, not the row sample the designer prompt carries; over 400,000 characters of embedded data, the largest set is halved (never under 20 rows) until it fits;
  - shows "No data for this view." for an empty selection;
  - shows an em dash for any value that is not a finite number;
  - draws a spec with `panels` as a grid of 12 columns: each panel is a titled card whose width is its span, panels wrap in order, and the grid collapses to one column when the frame is narrower than 720 px. A spec with panels uses a wider frame (up to 1280 px; a single chart stays at 920 px);
  - draws a pivot as a table of exact figures with a Total row and, in the long shape, a Total column; a long-shape pivot shows at most 12 column values and folds the rest into one "Other" column;
  - draws a us-map as one tile per US state in a state tile map, shaded by the measure; a state with no value is drawn empty;
  - shows a KPI tile with a `category` as the category, a middle dot and the figure (`FL · 262`);
  - folds categories beyond top N into "Other", drawn last (bar and donut);
  - offers legend toggles for series and hover/focus tooltips;
  - respects reduced motion.

### Tailoring and versions

- R12. Retired (2026-11-26, ADR-0059). Tailoring a visual (from chat or the panel) is gone with the designer.
- R13. Retired (2026-11-26, ADR-0059). The `update_visual` tool is gone.
- R14. Retired (2026-11-26, ADR-0059). The panel's Tailor form is gone.
- R41. Retired (2026-11-26, ADR-0059). Tailor is gone; **Refresh data** stays a background task keyed `<runId>/<visualId>` (`visual-refresh`, [app-shell](../app-shell/spec.md) R58–R63).
- R15. Each version SHALL record its number, creation time, the instruction that produced it (absent for an untailored v1), its source answer and, after a refresh, its last refresh time. The visual's title and takeaway follow its current version.
- R16. Viewing a version SHALL be read-only and SHALL NOT change the current version. While a non-current version is viewed:
  - "Refresh data" is disabled;
  - the version control is highlighted.
- R17. Reverting SHALL only move the current-version pointer to an existing version. No files change. An unknown version is rejected with "Version <N> does not exist".
- R18. Reverting SHALL add a visual event card to the chat, persisted as an assistant message: `Created|Updated|Reverted interactive visual "<title>" (v<N>).` A chat turn that created or updated a visual carries the same card on its answer message. Refreshing and auto-repair SHALL NOT add chat messages.
- R19. Retired (2026-11-26, ADR-0059). No chat turn creates or updates a visual any more.
- R20. Opening a session SHALL load into the panel the latest item the agent or the user showed, at its current version when that is a visual: the visual that changed most recently when nothing else was shown after it ([agent-panel](../agent-panel/spec.md) R12). Every visual of the session is also an item of the unified shown-items history ([agent-panel](../agent-panel/spec.md) R10); an agent can bring a visual back with `show_in_panel` ([agent-panel](../agent-panel/spec.md) R6).

### Refresh data in place

- R21. "Refresh data" SHALL re-run every successful stored SQL query behind the current version. It requests up to 500 rows per query and keeps up to 200, flagging truncation. Then it rewrites only that version's stored data and document. There is no new version, no designer call and no chat event. The version gets a refresh timestamp.
- R22. During a refresh:
  - Records that are not SQL, or that had already failed, are kept as they are.
  - A query that fails to re-run stores its error in place and does not abort the others.
  - When the session has no bound datasource, every query records "No datasource is bound to this session's datasets".
  - When it has several datasources, every query records "Several datasources are in scope for this session; refresh is not supported".
- R23. The rationale of each query SHALL survive a refresh. The frame's reasoning trail SHALL still explain the original answer.

### Runtime errors

- R24. The sandboxed visual SHALL report to the host:
  - uncaught errors, with the line number when known;
  - unhandled promise rejections;
  - a blank render, as "visual rendered blank". A render counts as blank when, 1.5 s after load, the visual area has no SVG, canvas, table or image and no child at least 24 px tall.
- R25. Retired (2026-11-26, ADR-0059). There is no automatic repair. A version that errors only shows the banner of R27.
- R26. Retired (2026-11-26, ADR-0059). Auto-repair and its endpoint (api.md 134) are gone.
- R27. When a version reports a runtime error, the panel SHALL show the runtime error banner: "This visual hit a runtime error." followed by `<error> — revert to an earlier version.` A new document clears the banner.

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

- R40. The frame SHALL follow the app's Light or Dark theme (BA-230), numbered after R39 because it was added later. It defines its colours as CSS custom properties, each with a Light and a Dark value, on the document root:

  | Token | Use | Light | Dark |
  |---|---|---|---|
  | `--qti-bg` | page | `#ffffff` | `#242424` |
  | `--qti-fg` | body text | `#2a2a2a` | `#d9d9d9` |
  | `--qti-fg-strong` | titles, takeaway emphasis | `#181818` | `#ffffff` |
  | `--qti-fg-muted` | labels, captions, footer | `#5f5f5c` | `#a3a3a3` |
  | `--qti-surface` | subtle fills: chips, cards, code, KPI tiles | `#f6f6f4` | `#2b2b2b` |
  | `--qti-border` | card, table and divider lines | `#e3e3df` | `#363636` |
  | `--qti-link` | links | `#d4380f` | `#ff7a3d` |
  | `--qti-focus` | focus rings | `#ed3e13` | `#ff9361` |
  | `--qti-cat-1` … `--qti-cat-8` | series palette | sky `#0284c7`, amber `#d97706`, emerald `#059669`, violet `#7c3aed`, rose `#e11d48`, cyan `#0891b2`, lime `#65a30d`, orange `#ea580c` (the -600 shades, 3:1 on white) | the -400 shades |
  | `--qti-on-cat` | text on a filled series colour (pie slices, dense heatmap cells) | `#ffffff` | `#141414` |
  | `--qti-pos` / `--qti-neg` | positive and negative values | `#059669` / `#dc2626` | `#34d399` / `#f87171` |
  | `--qti-grid` | gridlines | `rgb(0 0 0 / 0.08)` | `rgb(255 255 255 / 0.08)` |
  | `--qti-axis` | axis labels | `rgb(0 0 0 / 0.6)` | `#a3a3a3` |
  | `--qti-tooltip-bg` | tooltips | `#ffffff` | `#303030` |

  The Light values mirror the app's Light tokens and the Dark values its Dark tokens ([ui.md](../../system/ui.md) 6.0); the table holds the Halo Powered brand's values (ADR-0044).
  - The document root also carries `data-brand="halo|mercer"`, written by the visual panel from the build's brand (ADR-0045). With `mercer` the page tokens take the Agentic Hub values of ADR-0007 (Light `--qti-fg-strong` `#001f52`, `--qti-link` `#0b41ad`; Dark `--qti-bg` `#12233a`, `--qti-fg-strong` `#eef4fc`, …); the series palette is the same in both brands. A document with no `data-brand` (a downloaded `index.html`) uses the Halo values.
  - The document root carries `data-theme="light|dark"`. The visual panel writes the app's resolved theme into the document before it loads. When the theme changes while a visual is open, the panel sends the frame `{type: 'qti-theme', theme}` and the frame bridge switches the attribute in place, so the visual is not reloaded and its state, hover and filters survive. This message goes host to frame only; R35 is unchanged.
  - A document with no `data-theme`, such as the `index.html` of R37 opened on its own, follows the operating system's `prefers-color-scheme`.
  - The chart runtime's text colours (axis, value and pie labels, the legend and the detail table's summary) use these tokens, so spec visuals follow the theme. A heatmap cell's value is `--qti-on-cat` when the cell is more than 55% opaque, `--qti-fg-strong` otherwise.
  - The panel rebuilds each document from the stored bundle on every load, so every existing visual is themed when opened; nothing is migrated.
  - The designer takes every colour from the tokens ([agents.md](../../system/agents.md) 6.4). A freeform visual whose CSS hardcodes colours keeps them (known limitation).

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

- R42. **A run's visual is an artifact card, opened in a side panel** (2026-11-17). A run host (the workflow page in both views, the run detail page) SHALL show each visual a run created (its answer's or a visual action's `visual` event) as an **artifact card** where it was made, in place of the Created / View strip: a live, non-interactive preview of the visual at that version (its document, api.md 123, scaled down; an icon until it loads or when it cannot), its kind (`Dashboard` for an artifact saved before 2026-11-26 by the removed Dashboard Image to Artifact, with `Mock data`; else `Visual`), its title, `Created`/`Updated`/`Reverted · Version <n>` and **Open**. A run that saved the visual to Artifacts SHALL say `Saved to Artifacts` on the card with a link to the entry, instead of in the Chat's action row. **Open** (or a click on the preview) SHALL open the visual in a **side panel** on the window's right edge at full height (a `dialog` labelled by the visual's title, focused when it opens): its kind, its title once, `Mock data` when it applies, Full screen and Close, then the panel's tools (versions, Tailor, Refresh, Download) without the panel's own `Visuals` label and path line. Escape SHALL leave full screen first, then close the side panel. Past chats and Try it keep the strip and their own panel.

## Edge cases and errors

| Situation | Behaviour |
|---|---|
| Unknown visual id | 404 "Visualization <id> not found in session <session>" |
| Saved visual fails to load | The panel shows the load error "Could not load the saved visual". |
| Stored spec unreadable or invalid | The stored files are rendered as a freeform visual. |
| Revert fails | Toast with the server message or "Revert failed" |
| Revert succeeds | Toast "Reverted to version <N>" |
| Refresh succeeds | Toast "Refreshed data for version <N>" |
| Refresh call fails | The button returns to idle with no message. *(Open question: there is no user feedback on failure.)* |
| Viewing a version that errors | Banner only. |
| Version entry text | `<instruction or "Initial version"> · <date>[ · refreshed <date>]` |

## Contracts

- Endpoints in [api.md](../../system/api.md):
  - load visual (optionally at a version);
  - revert;
  - refresh;
  - download bundle;
  - (generate, tailor and repair were removed 2026-11-26; the `visual-updated` event is no longer sent).
- Data in [data-model.md](../../system/data-model.md): the session document's visual list (visual metadata and version entries), the chat message's visual event, the version directory layout in the session workspace, and the legacy un-versioned layout.
- Agents in [agents.md](../../system/agents.md): the interactive visual designer (spec and freeform output shapes, the interactive-visuals skill, model routing including the `VISUAL_MODEL` override and swaps away from reasoning-class and nano-class models), and the assistant's `create_visual` / `update_visual` tools.
- Chat integration: [agent-answers](../agent-answers/spec.md).

## UI

Placement in the shell's right "Details panel" is in [ui.md](../../system/ui.md).

- **Panel header**: "Visuals", then, when a visual is open:
  - The version control (title "Version history", label `v<N>`, highlighted when an old version is viewed). It opens a list of every version, newest first, as "Version <N>" with "current" and "viewing" tags and the entry text. When an old version is viewed, the list starts with "Make v<N> the current version" / "now v<M>".
  - "Tailor" (title "Tailor this visual"), which opens a form with "Chart type", "Sort", "Top N (3–50, optional)" (placeholder "All items"), "Describe the change (optional)" (a multi-line text field), the instruction preview, the error line, and "Cancel" / "Apply".
  - "Refresh data" (title "Refresh data (re-run the stored query)").
  - "Download bundle" (title "Download bundle (HTML, CSS, JS, answer.md, data.json)").
  - There is no saved-visuals menu here: the session's visuals are switched through the Session panel's "Shown in this session" menu (agent-panel), which lists every visual, newest first.

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

The scenario "Renders a deterministic interactive visualization and its version controls" (generate a visual from a chat answer, the frame title, "Download bundle", the "Version history" list) is retired with the chat composer's **Generate interactive visuals** (workflows-first roadmap, plan 1.24.8). A visual that a stored run already holds is covered by "Visual tailoring" below (the designer is gone); the run page's panel and its versions return with plans 1.24.5 and 1.25.4.

### Visual actions on a run

R20-R24 hold on a stored agent run (workflows R18-R20): the version menu, "Make v<N> the current version", "Refresh data" and "Download bundle" work over `/workflow-runs/:id/visualizations` (api.md 123, 124, 132, 133; generate, tailor and repair, 130, 131 and 134, were removed 2026-11-26) instead of a session's, on the run's workspace, with these differences:

- The visual opens in a "Visual" section under the answer, in the Run tab of the designer, in the workflow page's Business view and on the run page (ui.md 4.4c); on a run host it opens from its artifact card in a side panel instead (R42): the right panel holds the designer, so there is no panel history. The card's "View" and a new visual open it there; "Close visual" hides it. **Full screen** (`data-testid="run-visual-full-screen"`, lucide `maximize-2` / `minimize-2`, `aria-pressed`) makes the section a modal dialog over the window (`role="dialog"`, `aria-modal`, 16 px from each edge, the visual filling it, a dimmed backdrop); the same button, Escape or a click on the backdrop leaves it, and closing or replacing the visual leaves it too (since 2026-11-16).
- The cards (R18) are stored on the run (`events`, data-model 3.16), shown after the answer, and reappear when the run is reopened. A stored `create_visual` or `update_visual` card of an old answer stays as stored.
- R20 does not apply: a run opens with no visual until "View" is pressed.
- A running run refuses every action.

### Feature: Visual tailoring

E2E: `frontend/e2e/visual-tailoring.spec.ts` covers "The visual follows the app's theme" (the theme is switched through System and the operating system setting, so the chat and its panel stay open) and "An older visual opens in the current theme" (the stored visual is rewritten on disk as a legacy bundle whose own styles hardcode the old dark frame); and "I generate, tailor, revert and refresh a visual on a run answer" (a stored run of the Assistant opened from Runs: the Run panel offers no "Generate interactive visuals", its answer's visual is made through `POST /workflow-runs/:id/visualizations` as a workflow step would, then tailored with Sort, reverted and refreshed); the other scenarios have none yet.

```gherkin
Feature: Visual tailoring

  Background:
    Given a "World Cup analysis" session with an answer "France won in 2018." that ran SQL
    And the visual "World Cup champions" at version 1 is open in the right panel

  Scenario: Viewing and reverting to an earlier version
    Given the visual has versions 1 and 2 and version 2 is current
    When I click "Version history"
    Then I see "Version 2" tagged "current" and "Version 1" described as "Initial version"
    When I click "Version 1"
    Then the panel shows version 1
    And "Refresh data" is disabled
    When I click "Version history"
    And I click "Make v1 the current version"
    Then I see the toast "Reverted to version 1"
    And a card "Reverted World Cup champions" with "Version 1" is stored
    And "Refresh data" is enabled again

  Scenario: Refreshing data keeps the version
    When I click "Refresh data"
    Then I see the toast "Refreshed data for version 1"
    And the "Version history" button still reads "v1"
    And no new card appears in the chat
    When I click "Version history"
    Then version 1 shows "refreshed" with a time

  Scenario: A broken visual shows the error banner and is never repaired
    Given version 1 throws an error when it renders
    Then I see "This visual hit a runtime error."
    And I see "— revert to an earlier version."
    And no repair is attempted

  Scenario: Exporting the bundle
    When I click "Download bundle"
    Then a file "world-cup-champions.zip" is downloaded
    And I see the toast "Visual bundle downloaded"
    And the archive contains "index.html", "styles.css", "script.js", "qti-frame.js", "answer.md" and "data.json"
    And opening "index.html" on its own shows the title, "Takeaway", "Analysis" and "Data used"

  Scenario: Switching between saved visuals
    Given the session also has a "Goals per tournament" visual
    When I click "Shown in this session"
    Then I see "World Cup champions" and "Goals per tournament"
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

  Scenario: The visual follows the app's theme
    Given the app is in the Light theme
    And a visual is open in a past chat's read-only panel
    Then the frame and its chart are light
    When I switch Appearance to Dark
    Then the open visual turns dark without reloading
    And its state, hover and filters are kept

  Scenario: An older visual opens in the current theme
    Given a visual made before the themed frame existed, in a past chat
    And the app is in the Dark theme
    When I open the past chat's visual
    Then the frame and its chart are dark

```

### Skills the designer is given (removed 2026-11-26)

E2E: none (the designer and its skill were removed with ADR-0059; `frontend/e2e/designer-skills.spec.ts` is deleted with it).

## Acceptance

- Every scenario above passes.
- A stored visual renders a chart whose values match its "Data used" rows. Its exported `index.html` renders identically when opened offline straight from the zip.
- No visual output can reach the frame outside the visual area. A visual with hostile markup or script can neither change the frame, reach the network nor reach the host app.
- Open questions to settle:
  - **Download version.** The panel downloads the *current* version even while an older version is viewed, and names the file `<slug>.zip`, while the server proposes `<slug>-v<N>.zip`. Should it download the viewed version?

<!-- sources: backend/src/modules/sessions/visualization.service.ts, visualization-document.ts, visual-spec.ts, visual-runtime.ts, zip-archive.ts, sessions.service.ts (revert/refresh/saveVisualMetadata; generate, tailor and repair were removed 2026-11-26), sessions.controller.ts; backend/src/mastra/agents/visualization.agent.ts, tools/visual.tools.ts; frontend/src/app/features/sessions/components/interactive-visual-panel/*, session-chat/session-chat.html|ts (follow-up chips), answer-view/answer-view.html (visual cards), services/sessions-api.service.ts; frontend/src/app/app.ts (showVisualization, revert, download, generate, loadLatestVisualization); frontend/e2e/chat-and-visuals.spec.ts, designer-skills.spec.ts; the frame tokens and theme bridge in visualization-document.ts, visual-runtime.ts and the interactive-visual-panel -->

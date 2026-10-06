# UI

The contract for how the app looks and behaves as a single window: shell layout, navigation, every screen and panel, shared components, design tokens, accessibility and user-visible copy. Behaviour rules (what the data means, what happens on the server) live in the capability specs; this file says where things are, what they are called, and how they look. Terms are defined in [../product/glossary.md](../product/glossary.md).

Stack-neutral wording; *Implementation notes* name the current Angular/Tailwind realisation (see [tech-stack.md](tech-stack.md)). The shell-level rules (R-numbered, testable) are in [../capabilities/app-shell/spec.md](../capabilities/app-shell/spec.md); this file is the visual and structural reference that spec points at.

Capability specs referenced below: [app-shell](../capabilities/app-shell/spec.md), [diagnostics](../capabilities/diagnostics/spec.md), [llm-settings](../capabilities/llm-settings/spec.md), [datasources](../capabilities/datasources/spec.md), [datasets](../capabilities/datasets/spec.md), [testing-data](../capabilities/testing-data/spec.md), [sessions-chat](../capabilities/sessions-chat/spec.md), [visuals](../capabilities/visuals/spec.md), [knowledge](../capabilities/knowledge/spec.md), [verified-queries](../capabilities/verified-queries/spec.md), [metrics](../capabilities/metrics/spec.md), [deep-analysis](../capabilities/deep-analysis/spec.md), [agents-evals](../capabilities/agents-evals/spec.md).

## 1. App shell

### 1.1 Window

- Desktop window, default 1440 x 900 px, minimum 960 x 600 px, window background `#1c1c1c` (so there is no white flash before first paint).
- Native title bar is hidden with the traffic-light controls inset (macOS `hiddenInset`); the app draws its own top bar and treats it as a window-drag region. Interactive children of a drag region (buttons, inputs) opt out of dragging.
- The window title and the HTML `<title>` are "Halo BI Assistant". The visible product wordmark is "HALO BI" (see 3.4). A visually hidden `<h1>` "Questions to Insights" is the page heading.
- The renderer has no router; nothing is addressable by URL. All navigation is view state (1.4).
- Dark theme only. There is no light theme and no theme switch.

### 1.2 Regions

```
+--------------------------------------------------------------------------+
| [backend status banner - only while restarting / down]  h 28             |
+-----------+------------------------------------------+-------------------+
| Sidebar   | Top bar (h 48)                           | Right panel       |
| w 296     |  [expand-sidebar+logo] [session context] | w 572 (360-960)   |
|           |                          [expand-right]  |  header h 48      |
| logo      +------------------------------------------+  [collapse]       |
| collapse  | Tab strip (h 40, empty placeholder)      |                   |
| account   +------------------------------------------+  body: depends on |
| nav       | Main content                             |  main view (1.5)  |
| sessions  |  (centered column, scrolls vertically)   |                   |
| footer    |                                          |                   |
+-----------+------------------------------------------+-------------------+
   toast stack: fixed bottom-right over everything; system logs: modal overlay
```

- The whole app is one full-height flex column: optional banner on top, then a row of three regions: left sidebar, main column, right panel. The root sets `user-select: none` for the whole app and no content area overrides it (inputs and textareas remain editable); copying chat text is done through the Copy buttons. Open question: whether message bodies and SQL should be selectable.
- **Left sidebar** (296 px, `#181818`, 1 px right border `white/5`): either the *primary sidebar* (workspace navigation) or the *settings sidebar* (1.3). Hidden entirely when collapsed.
- **Main column** (flex 1, min width 0): top bar, empty 40 px tab strip (a reserved, currently unused strip with a bottom border), then the content area.
- **Right panel** (`#161616`, 1 px left border `white/5`): a *details panel* whose body depends on the current main view (1.5). Hidden when collapsed.
- **Top bar**: 48 px high, bottom border `white/5`. Contents, left to right:
  - When the sidebar is collapsed: an *Expand sidebar* icon button (left padding 76 px to clear the traffic lights) followed by the logo (height 12).
  - When a session chat is open: the *session context* — a database icon, the uppercase micro-label "Datasource", then one chip per datasource used by the session (name, plus kind label small and muted; tooltip = the datasource summary). While loading: a 96 x 16 px pulsing placeholder. If none can be resolved: the muted text "Unavailable".
  - When the right panel is collapsed: an *Expand right panel* icon button pushed to the far right.
- The home state of the main column (no feature view selected) is an empty area with a decorative empty composer box at the bottom (max width 860, height 112, radius 16, fill `#232323`, border `white/10`). It is a placeholder with no behaviour.

### 1.3 Sidebars

**Primary sidebar** (`aria-label="Primary sidebar"`), top to bottom:

1. Header (48 px, drag region): logo (cap height 12, `zinc-200`) then the *Collapse sidebar* icon button (panel-left icon), right-aligned, left padding 76 px.
2. Account row: a 20 px circular avatar with the letter "D" (`zinc-600` fill) + "Demo User" + a chevron-down. Static placeholder: no menu, no behaviour yet.
3. `nav aria-label="Workspace navigation"`: three rows, each icon (15 px) + label; muted `zinc-400`, hover `white/5` + `zinc-200`, selected row has a `white/5` fill:
   - **Datasets** (flask icon) — toggles the dataset area.
   - **Agents** (bot icon) — toggles the agent area (stays selected while an agent detail is open).
   - **Knowledge** (book-open icon) — toggles the knowledge area.
   Clicking the already-selected row returns to the home state.
4. Divider (1 px, `white/5`).
5. `nav aria-label="Sessions navigation"`:
   - Row **Sessions** (folder-kanban icon) with a *New conversation* "+" icon button on the right (visible on row hover, always visible while the composer is open). The "+" opens the new-session composer (4.7).
   - One child row per session, indented 24 px, newest activity first as returned by the backend, label = session name truncated to one line (12 px). The row is selected while that session is open. A "more" (vertical ellipsis) button, `aria-label="Options for <session name>"`, title "Session options", appears on hover/while open and opens a small menu (width 176) with one red item **Delete session** (trash icon). Both the row and its menu are disabled while a delete is in flight. Row `data-testid="session-<id>"`.
   - Delete asks a native confirm: `Delete “<name>”?` newline newline `This permanently removes its conversation, agent memory, and workspace files.`
6. Flexible spacer.
7. Footer (right-aligned icon buttons, `zinc-500`):
   - **Open system logs** (scroll-text icon; `aria-label="Open system logs"`, title "System logs and diagnostics") with a red count badge (top-right of the icon) showing the number of error + warning log entries, capped at "99+", hidden at zero. Opens the system logs panel (5.2).
   - **Settings** (gear icon, title "Settings") — switches the sidebar to the settings sidebar.

**Settings sidebar** (`aria-label="Settings sidebar"`, same width and fill), replaces the primary sidebar in place:

1. Header: a **Back** button (arrow-left icon + "Back") right-aligned; returns to the primary sidebar and to whatever main view was showing.
2. The same static account row ("Demo User").
3. A "Search settings" field (search icon, placeholder `Search settings`, a `⌘ F` key hint). Non-functional placeholder today.
4. `nav aria-label="Settings navigation"` with four rows (icon + label), selecting one shows its form in the main column; selecting the active one again deselects it (main column returns to the empty content area):
   - **Datasource Configuration** (database icon) -> 4.10
   - **LLM Configuration** (bot icon) -> 4.9
   - **Testing Data** (test-tube icon) -> 4.11
   - **Developer** (wrench icon) -> 4.12
5. Footer: "Halo BI Assistant" then `v<version>` (muted; `data-testid="app-version"`). The version is the shipped package version.

Opening the settings sidebar does not clear the current main view; selecting a settings section takes precedence over the main view while the sidebar is in settings mode. Leaving settings (Back) restores the main view that was underneath.

**Collapse / expand.** The *Collapse sidebar* button (title "Collapse sidebar") hides the sidebar of either mode; *Expand sidebar* (title "Expand sidebar") in the top bar brings it back in the mode it was in. Collapsing does not reset the main view or session.

### 1.4 Navigation model (no router)

The main column renders exactly one of these views, held in a single "main view" state, with the settings section as an overriding secondary state.

| Main view state | Reached by | Main column content | Right panel body |
|---|---|---|---|
| `home` (default) | start-up; clicking an active sidebar row again; deleting the open session | empty area + placeholder composer | Entity details (empty state) |
| `dataset` | sidebar **Datasets** | Datasets list (4.2) | Entity details |
| `dataset-new` | **New dataset** or opening a dataset in the list | Catalog browser: "New dataset" / "Edit dataset" (4.3) | Entity details |
| `agents` | sidebar **Agents** | Agents list (4.4) | Entity details |
| `agent-detail` | clicking an agent row | Agent detail (4.5) | Eval trace (4.6) |
| `knowledge` | sidebar **Knowledge** | Knowledge list (4.8) | Entity details |
| `conversation-new` | the "+" next to **Sessions** | New-session composer (4.7) | Entity details |
| `session-chat` | clicking a session row, or creating a session | Session chat (4.12) | Interactive visual panel (4.13) |
| settings section `datasources` / `llm` / `testing-data` | settings sidebar rows | the matching config form (4.9-4.11), centred column | Entity details |

- Content views (everything except the chat) sit in a vertically scrolling, horizontally centred column with 32 px horizontal / 40 px vertical padding and a max width of 960 px (settings forms: 560 px for datasources and testing data, 480 px for LLM, 24 px horizontal padding).
- Opening a session loads the datasources used by that session (for the top bar) and its most recent visual (for the right panel); deleting the open session returns to `home`.
- Selecting a catalog/schema/entity in the catalog browser, generating or viewing a visual, always re-opens the right panel if it was collapsed.
- A transient failure to load the session list is retried up to 12 times (200 ms steps, capped at 1 s) before the toast "Could not load sessions" is shown; already-loaded sessions are kept.

### 1.5 Right panel

- `aria-label="Details panel"`; default width **572 px**, minimum **360**, maximum **960** (also never wider than the viewport minus 240 px reserved for the main column, and never below 360).
- Header (48 px, drag region): the *Collapse right panel* icon button (panel-right icon, title "Collapse right panel") right-aligned. When collapsed, the top bar shows *Expand right panel* (same icon).
- **Resize handle**: a 10 px wide invisible hit zone straddling the panel's left edge (5 px outside), `cursor: col-resize`, showing a 2 px `zinc-500/75` line on hover, keyboard focus or while dragging. Exposed as `role="separator"`, `aria-orientation="vertical"`, `aria-label="Resize right panel"`, `aria-valuemin` (360), `aria-valuemax` (current maximum), `aria-valuenow` (current width), `tabindex=0`, title "Drag to resize · Double-click to reset".
  - Drag: primary button, pointer capture; moving left widens the panel (`width = startWidth + startX - pointerX`), clamped to the min/max. While dragging the whole window forces `col-resize` and embedded frames stop capturing the pointer.
  - Keyboard (when the handle has focus): Left arrow widens by 24 px, Right arrow narrows by 24 px, Home = minimum (360), End = current maximum (960 on a wide window). Each key press persists.
  - Double-click: reset to 572 and persist.
  - Window resize re-clamps the width.
  - Persistence: `localStorage` key `questions-to-insights:right-panel-width`, value the integer pixel width as a string; written when a drag ends and on every keyboard/reset change; read once at start-up (non-numeric or missing -> 572; out-of-range values clamped).
- Right panel bodies by main view: see the table in 1.4. Collapse state is session-only (not persisted); the panel is open on every launch.

## 2. Loading, empty, error and confirmation conventions

These patterns repeat across screens; each screen section only notes deviations.

- **Loading**: a 16 px spinning loader icon (`animate-spin`, `Loader2`) + a sentence ending in an ellipsis (`Loading datasets…`), muted `zinc-400`, 40 px below the header. Buttons that start an action swap their label for a spinner + present participle (`Saving…`, `Testing…`) and are disabled.
- **Error**: an inline block, `red-500/10` fill, `red-400` text, 13 px, radius 6, padding 12 x 10, containing the server's message (or a fallback). Transient failures of actions additionally raise an error toast (see 5.3). The standard fallback text for an unreachable backend is `Backend unreachable`.
- **Empty**: a muted (`zinc-500`, 13 px) sentence, or for first-run on a major list a dashed `white/10` bordered card with an icon tile, a title and a short explanation plus the primary actions.
- **Disabled primary action**: fill `zinc-700`, text `zinc-400`, `cursor: not-allowed`; explained by a `title` tooltip ("Name the session and select at least one dataset").
- **Destructive confirmation**: native `window.confirm` dialogs for deleting a session, datasource, metric, knowledge snippet and rejecting a suggestion (exact texts in section 7). Inline confirm panels (amber warning icon + sentence + **Confirm** / **Cancel**) for the testing-data load/remove actions (4.11). Deleting a dataset has no confirmation (its menu item is the commit).
- **Row action menus**: a small popover (width 176, `#2a2a2a`, border `white/10`, radius 8, `shadow-xl`, padding 4) opened from an ellipsis button, closed by clicking an invisible full-screen backdrop; items are 13 px with an icon; the destructive item is `red-400`.
- Primary buttons (light): fill `zinc-200`, text `zinc-900`, hover `white`, 13 px medium, radius 8 (cards/pages) or 6 (forms). Positive confirm buttons (form save): fill `emerald-600`, text white, hover `emerald-500`. Secondary: 1 px `white/10-15` border, `zinc-300`, hover `white/5`.

## 3. Shared components

### 3.1 Backend status banner

A full-width 28 px strip above the whole layout, bottom border `white/5`, 12 px medium text centred. Visible only while the desktop shell reports the backend as `restarting` or `down`:

| Status | Fill / text | Message |
|---|---|---|
| `restarting` | `amber-500/15` / `amber-300` | `Backend restarting…` |
| `down` | `red-500/15` / `red-300` | `Backend unavailable — restart the app` |
| `starting`, `ready` | not shown | — |

Status comes from the desktop bridge's `backend-status` events (see [api.md](api.md), desktop bridge). Without the bridge (plain browser / web mode) the status stays `ready` and the banner never shows. Behaviour: [../capabilities/app-shell/spec.md](../capabilities/app-shell/spec.md).

### 3.2 System logs panel

Modal overlay opened from the sidebar footer button; behaviour and redaction rules in [../capabilities/diagnostics/spec.md](../capabilities/diagnostics/spec.md).

- A full-screen scrim (`black/55`, 1 px blur; the scrim itself is a button `aria-label="Close system logs"`) and a dialog (`role="dialog"`, `aria-modal="true"`, `aria-labelledby` the title) positioned 24 px from left/right/bottom and 64 px from the top, centred, max width 1100, fill `#191919`, border `white/10`, radius 16, `shadow-2xl`.
- **Header**: 32 px rounded tile with the scroll-text icon; `h2` "System logs" with a green dot + "LIVE" (10 px, `emerald-400`); caption "Desktop, interface, backend, and AI runtime diagnostics" (11 px, `zinc-500`). Right: **Refresh logs** icon button (`aria-label`/title "Refresh logs", the icon spins while loading), **Export** primary button (download icon, label "Export", becomes "Exporting…" and disables while running), **Close system logs** icon button (X, title "Close").
- **Toolbar**: filter pills `All <n>` and `Issues <errors+warnings>` (selected = `white/10` fill + `zinc-200` text), counts `<n> errors` (`red-400`) and `<n> warnings` (`amber-400`), then right-aligned: a search field (type=search, `aria-label="Search system logs"`, placeholder `Search messages or sources`, width 256), checkbox **Group by run** (title "Group entries by backend process run", default on), checkbox **Follow** (default on; keeps the list scrolled to the newest entry).
- **Latest issue card** (only when an error or warning exists): amber-tinted card (`amber-500/20` border, `amber-500/[0.06]` fill) with a triangle-alert icon, "Latest issue · <time>", the message on one line and the plain-language source explanation.
- **Entry list** (monospace, scrollable): a row = time (86 px, `zinc-600`), level badge (52 px, upper case: ERROR red, WARN amber, DEBUG sky, INFO neutral), source (128 px, truncated, tooltip = full source), message. Each row is an expandable disclosure; expanded it shows the plain-language explanation of the source and, when present, the entry's details (JSON or text, pretty-printed, in a darker box, max height 224, scrollable).
  - Source explanations: `user-visible` -> "An operation shown in the app failed."; `backend:mastra…` -> "The AI agent runtime reported this event."; `backend…` -> "The local data and backend service reported this event."; contains `renderer` -> "The application interface reported this event."; `electron…` -> "The desktop application shell reported this event."; anything else -> "A system component reported this event."
  - **Group by run** (default): entries are bucketed into backend process runs (a change of the backend's process id marks a new run). Each run is a collapsible group with summary "Run <n>", "PID <pid>", time span, "<n> shown", red/amber count chips ("<n> errors", "<n> warnings") and, when its start has aged out of the retention window, "started before this window". The newest run is open and older runs collapsed; while a search or the Issues filter is active every surviving run is open. Entries recorded before any backend process identified itself appear above the groups as a flat list.
  - Empty / no match: centred scroll-text icon, "No matching log entries", "New application events will appear here automatically."
- **Footer**: left "Up to 2,000 recent entries are retained. Logs are redacted before export." right "Expand a row for context and stack details."
- Export success raises the toast `Exported <n> diagnostic entries`; failure raises an error toast with the message or `Diagnostics export failed`. In the desktop app the export writes a file chosen via a native dialog; in a browser it downloads `questions-to-insights-diagnostics-<YYYY-MM-DD>.md`.
- Close by the Close button, the scrim, or (dialog semantics) assistive-technology dismissal; focus handling in section 8.

### 3.3 Toast container

Fixed stack at bottom-right (16 px from right and bottom, width 360, 8 px gap, above all content; the container ignores pointer events, each toast accepts them). Each toast: fill `#2a2a2a`, border `white/10`, radius 12, `shadow-xl`, padding 14 x 12, a 16 px kind icon, the message (13 px, line height 20, `zinc-200`) and a dismiss "X" button (14 px).

| Kind | Icon (colour) | Auto-dismiss |
|---|---|---|
| `success` | circle-check (`emerald-400`) | 4000 ms |
| `info` | info (`sky-400`) | 4000 ms |
| `error` | circle-alert (`red-400`) | 8000 ms |

Toasts stack in creation order; the X dismisses immediately. Every **error** toast is also recorded as a diagnostic entry with source `user-visible` (it therefore shows up in the system logs and in the issue badge).

### 3.4 App logo

The "HALO BI" wordmark as a vector drawn with 13-unit strokes in `currentColor` (butt caps, mitre joins) in a 573 x 113 viewBox: H, a crossbar-less A (chevron), L, an O with a small "halo" notch/gap at the lower right, B, I. Rendered by cap height (`height` input, default 14; width = round(height x 573 / 113)); `role="img"`, `aria-label="Halo BI"`. Used at height 12 in the sidebar header (`zinc-200`) and in the top bar when the sidebar is collapsed (`zinc-300`). Brand files in `public/brand/`: `halo-bi-wordmark.svg`, `halo-bi-mark.svg` (1024 square, `#1c1c1c` rounded square r=185 with a white halo ring and the letters "BI" inside), `icon.png` (apple-touch / app icon); the page favicon is `favicon.ico` plus the SVG mark.

### 3.5 Markdown rendering

Assistant text, report bodies and visual cards render Markdown (GitHub-flavoured: tables, task lists, strikethrough; single newlines become line breaks) to HTML, then sanitise it with an HTML allow-list sanitiser (standard HTML profile; scripts, event-handler attributes and unknown protocols are stripped) before it is inserted into the page. Raw HTML in the source is therefore never executed. Styling ("prose-dark"): 13 px, line height 1.75, `zinc-300` text; strong `zinc-100`/600; links `sky-300` underlined; h1 16, h2 15, h3/h4 14 px (600, `zinc-100`, 1.1 em top margin); lists 1.4 em indent (disc / decimal); inline code 12 px monospace on `white/8`, radius 4; code blocks on `white/5` with a `white/8` border, radius 8, horizontal scroll; blockquote with a 2 px `white/15` left rule and `zinc-400` text; tables full width, 12 px, `white/8` cell borders, header `white/6` fill and `zinc-200` 600 text, zebra rows `white/2`, no wrapping (horizontal scroll). The visual frame inside the sandboxed iframe uses its own stylesheet; see [../capabilities/visuals/spec.md](../capabilities/visuals/spec.md).

## 4. Screens and panels

Page titles on content views are serif (Georgia-class stack), 28 px, semibold, `zinc-100` (agent detail 26 px). Settings form titles are sans 15 px semibold with a 12 px `zinc-500` subtitle.

### 4.1 Home (empty)

Purpose: neutral landing state at launch. Contents: the empty main area and the placeholder composer box (1.2); right panel shows Entity details' empty state (4.14). No actions. States: none.

### 4.2 Datasets list

Capability: [datasets](../capabilities/datasets/spec.md).

- Header "Datasets". Under it a filter pill row (`All`, `Pinned`, `Yours`, `Shared with you`; `All` selected by default) and on the right three icon buttons/actions: a search icon button, a layout-grid icon button, and the primary **New dataset** (plus icon). Only `All` and **New dataset** are functional today; the other filters and the two icon buttons are placeholders. Open question: intended behaviour of Pinned / Yours / Shared and search.
- Datasets are grouped under month headings (full month name, e.g. "October"; "Earlier" when there is no date), newest first. A row (`data-testid="dataset-<name>"`) shows a 40 px rounded icon tile (workflow icon), the dataset name (14 px) and, right-aligned, a lock icon and "Edited <Mon D> · <PostgreSQL | Databricks> · <n> entities". Clicking opens the dataset in the catalog browser (4.3). An ellipsis button opens a menu with **Delete dataset** (red, trash icon).
- States: loading `Loading datasets…`; error inline; empty `No datasets yet — create one with “New dataset”.`; populated as above. Delete toasts the server message (success or error).

### 4.3 Catalog browser ("New dataset" / "Edit dataset")

Capability: [datasets](../capabilities/datasets/spec.md), data from [datasources](../capabilities/datasources/spec.md).

- Header: title "New dataset" or "Edit dataset", subtitle "Catalogs, schemas and entities available through the selected datasource.", and (when editing) "Updated <date>". Right-aligned controls: a **Datasource** select (`aria-label="Datasource"`, options "<name> · <PostgreSQL|Databricks>", "No datasources" when empty), a **Refresh inventory** icon button (`aria-label="Refresh inventory"`, title "Re-read catalogs, schemas and entities from the datasource", spinning while loading), a text input (placeholder `Dataset name`, width 220) and the primary **Save dataset (<n>)** button where n = included entity count (disabled until a datasource is selected, at least one entity is included and a name is typed; tooltip "Name the dataset and include at least one element"; shows "Saving…").
- Body states:
  - *Awaiting choice* (nothing is read until requested): text "Pick the datasource you want to browse, then load its entities." and the hint "Nothing is read until you load, so a sleeping Databricks warehouse never blocks switching to another datasource." with a primary button **Load entities from <datasource label>** (play icon, `data-testid="load-inventory"`).
  - *Loading*: spinner + `Loading inventory from <datasource label>…`, hint "The first load can take a while if the Databricks warehouse is starting up. You can switch datasource above at any time." and a **Cancel** button.
  - *Error*: inline red block (e.g. `No datasource configured. Add one in Datasource Configuration first.`).
  - *Empty*: `No accessible catalogs found.`
  - *Populated*: a filter field (search icon, placeholder `Filter catalogs, schemas and entities…`, a **Clear filter** X button when non-empty; no matches -> `No catalogs, schemas or entities match “<query>”.`) and a three-level tree: catalog rows (database icon `sky-400`, monospace name, "<n> schemas"), schema rows indented 24 px (folder-tree icon `amber-400`, "<n> entities"), entity rows indented 56 px (table icon `emerald-400`, "<n> columns"). Rows carry `data-testid` `catalog-<name>`, `schema-<catalog>-<schema>`, `table-<catalog>-<schema>-<table>`. Clicking a catalog/schema toggles its expansion (chevron rotates 90 degrees) and selects it for the right panel; clicking an entity selects it. The trailing indicator shows inclusion: circle-check `emerald-400` = fully included, circle-minus `amber-400` = partially included, lock `zinc-500` = not selectable (the row is dimmed).
  - Below the tree, separated by a rule, the Metrics panel (4.15) scoped to the included entities.
- Selecting a node re-opens the right panel on its details (4.14), which hosts the include/remove toggle.

### 4.4 Agents list

Capability: [agents-evals](../capabilities/agents-evals/spec.md).

Header "Agents", subtitle "The agents registered in the harness." and a (placeholder) search icon button. Each agent row (`data-testid="agent-<key>"`): 40 px tile with a bot icon, agent name (14 px) with its description under it (12 px muted), and right-aligned a wrench icon + "No tools" / "1 tool" / "<n> tools" + "·" + the agent id in monospace. Click opens the detail. States: `Loading agents…`; error inline; `No agents registered.`

### 4.5 Agent detail

Capability: [agents-evals](../capabilities/agents-evals/spec.md); agent catalogue in [agents.md](agents.md).

- A **All agents** back button (arrow-left icon), then a header: 44 px bot tile, serif title (agent name, 26 px) with the agent id in monospace beneath, and the description (max 70 ch). States: `Loading agent…`, error inline.
- Underlined tab strip, each tab icon + label, `data-testid="agent-tab-<id>"`: **Prompt template** (`prompt`, scroll-text), **Tools (<n>)** (`tools`, wrench), **Memory** (`memory`, brain), **Model** (`model`, cpu), **Evals** (`evals`, gauge). Default tab Prompt template.
  - *Prompt template*: the agent's static instructions in a monospace pre block; if none: "This agent builds its prompt at request time, so there is no static template to show."
  - *Tools*: a card per tool (wrench, monospace name, description, input names as chips); none: "This agent runs in a single step with no tools."
  - *Memory*: key/value rows "Recent messages replayed" (`Disabled` / `Default` / `<n> messages`), "Semantic recall", "Working memory", "Auto-generated titles" (`Enabled` / `Disabled`), "Storage" (monospace, when present); no memory: "This agent is stateless — no memory is configured."
  - *Model*: rows "Model" and "Provider" (monospace); none resolved: "No model resolved — save an LLM configuration in Settings first."
  - *Evals*: when sets exist (or the Executions view is active) a sub-tab pair **Questions** / **Executions** (`eval-subtab-questions`, `eval-subtab-runs`).
    - *Questions*: caption "QUESTION SETS" and a list of set cards (`eval-set-<id>`, `aria-pressed`, chevron rotates when open, list-checks icon, name, "<n> questions", description). Opening a set reveals "<n> questions in <set name>. Each check must score 1.0 for its question to pass.", a datasource select (`eval-datasource-select`, `aria-label="Datasource to run the evals against"`, options "<name> · <kind>", "No datasources configured"), the primary run button (`eval-run`; "Run <n> selected", "Running…" with spinner), progress "<done>/<total> done · <passed> passed" once a run has started, "Scoped to <datasets>", a run error block, a **Select all** checkbox (`eval-select-all`) and one row per question: a checkbox (`eval-select-<caseId>`, `aria-label="Run: <question>"`), a button (`eval-case-<id>`, `aria-pressed`) with index, question, a verdict chip (`passed` green / `failed` red / `running` spinner; `eval-result-<id>`), the intent, an optional error and check chips (gauge icon, description, score once run). Selecting a case shows it in the right panel's eval trace (4.6). Controls are disabled while a run is in flight.
    - *Executions*: `Loading executions…`; none: "No eval runs yet — run the suite from the Questions tab."; else a card per run (`eval-run-<jobId>`): status icon (spinner / green check when all passed / red X), "<passed>/<total> passed", "<started> · <datasource name> · <duration>", a **Download run <id> as Markdown** icon button (title "Download as Markdown", `eval-run-download-<id>`), and (when not running) a **Delete run <id>** icon button. Expanding shows "Scoped to <datasets>" and result rows (`eval-run-result-<job>-<case>`: pass/fail icon, question, duration in ms) which load the trace into the right panel.
    - Empty / error: `Loading evals…`, inline error, "No evals configured for this agent yet."
  - Toasts: `Eval report downloaded`; failure `Could not download the report`.

### 4.6 Eval trace (right panel)

Shown while an agent detail is open. With nothing selected: "Select a question in the Evals tab to see how it ran." With a selected case: uppercase micro-headings (11 px, tracking wider) *Question* (question + intent). If the case has not run: *Checks it will be scored on* (gauge icon rows) and "Run the evals to see the steps the agent executed for this question." If run: a verdict ("Passed" green check / "Failed" red X) with a clock icon and duration; *Run error* (red block) or *Why it failed* (one red card per failed check with its reason); *Checks* (rows with pass/fail icon, description, score); *Executed steps* (a card per tool call: wrench, monospace name, `#<n>`, input, output or error; "The agent answered without calling any tool." when none); *Answer* (pre-wrapped text, or "The agent returned no text.").

### 4.7 New-session composer

Capability: [sessions-chat](../capabilities/sessions-chat/spec.md).

A centred card (max width 920, `#232323`, border `white/10`, radius 16, padding 16, `shadow-lg`) with a **Session name** field (placeholder `My new session`), then a controls row: a model chip (sparkle icon + the configured model id, or `No model configured` muted when none), a **Reasoning effort** dropdown button (title "Reasoning effort", signal icon + `low` / `medium` / `high` capitalised, menu of the three values opening upward; choosing one saves it immediately: toast `<server message>`), and the primary **Create** button (corner-down-left icon; shows `Creating…`; disabled until a name is typed and at least one dataset selected; title "Name the session and select at least one dataset"). Below the card: caption "Select at least one dataset for this session" and a list of dataset rows (workflow icon tile, name, "<n> entities"; a selected row has an `emerald-500/40` border, `emerald-500/5` fill and a trailing circle-check). Empty: `No datasets yet — create one in Datasets first.` On success: toast with the server message, the session list reloads and the new session opens (4.12).

### 4.8 Knowledge list and form

Capability: [knowledge](../capabilities/knowledge/spec.md).

- Header "Knowledge", subtitle "Instructions, glossary terms and default filters the assistant uses when answering. Only enabled snippets are applied."; actions **Generate suggestions** (wand icon, outlined) and the primary **New snippet** (`new-knowledge-snippet`).
- Filter row: pills **All**, **Instruction**, **Term**, **Default filter** (each with the kind's description as tooltip), a "Filter by dataset" select (`All datasets` + one per dataset), and on the right a **Pending suggestions** toggle (sparkles icon, `aria-pressed`, violet when active, with a count badge when > 0; `pending-suggestions-filter`).
- Row (`knowledge-<id>`): 32 px kind tile (instruction = file-text `sky-400`, term = tag `amber-400`, default filter = filter `emerald-400`), title, kind chip, a violet "Mined" chip for AI-suggested snippets, the body on one line, "<scope> · Updated <date>" (scope = "Global" or the dataset name). Right side: an **Enabled / Disabled** checkbox, Edit (pencil, title "Edit") and Delete (trash, title "Delete") icon buttons. In the pending-suggestions view the right side is instead **Accept** (green, `accept-suggestion`) and **Reject** (red outline, `reject-suggestion`).
- States: `Loading knowledge…`; error inline; empty (dashed card, book-open tile, "No knowledge yet", "Snippets are plain-text instructions, glossary terms and default filters the assistant applies when answering. Write one by hand, or generate suggestions from a dataset and approve the ones worth keeping." with **New snippet** and **Generate suggestions**); no match: "No snippets match these filters."; pending view empty: "No pending suggestions right now — generate some or check back later."
- **Snippet form** (card below the list; "New snippet" / "Edit snippet", Close X): **Kind** select (with the kind description under it), **Scope** select (`Global` + datasets), **Title** (placeholder `Always exclude test accounts`), **Body** textarea (4 rows; placeholder `Plain-text instruction, definition or default filter the assistant should apply.`), **Synonyms (comma separated)** only for kind Term (placeholder `churn, attrition, cancellation`), **Entities (optional, comma separated)** (placeholder `claims, members`), **Cancel** and **Create snippet** / **Save changes** (`save-knowledge-snippet`; disabled until title and body are present; tooltip "Title and body are required").
- **Generate panel**: "Generate suggestions" card with Close X, explanation "The assistant reviews the dataset and drafts instructions, terms and default filters as pending suggestions — nothing is applied until you approve it. This can take up to a minute.", a **Dataset** select (`No datasets yet` when empty), **Cancel** and **Generate** (`run-generate-suggestions`; `Generating…`). Progress list (`generate-progress`, `aria-live="polite"`): finished steps with a green check, the current step with a spinner and a trailing "…".
- Toasts: `Snippet enabled` / `Snippet disabled`, `Snippet deleted`, plus server messages.

### 4.9 LLM configuration (settings)

Capability: [llm-settings](../capabilities/llm-settings/spec.md).

Title "LLM Configuration", subtitle "Configure the language-model provider and verify the credentials." Fields: **Provider** select (`OpenAI`, `Anthropic`, `LenAI (Halo gateway)`), **Model** (label becomes **Deployment name** for LenAI; placeholders `gpt-4o-mini` / `claude-sonnet-5-5` / `my-deployment`), **Base URL** only for LenAI (placeholder `https://lenai.example.com`, hint "Gateway root; requests use <base URL>/openai/v1/deployments/<deployment>."), **API key** (password; placeholder `sk-…`, or the masked saved key when one exists). When the saved key can't be decrypted, a warning notice above the buttons reads "Your saved API key can't be read because the app secret changed. Enter the key again, test and save." and the other fields keep their saved values. Buttons, stacked full width: **Test connection** (`Testing…`) and **Save connection** (green; disabled until a test has passed since the last edit; tooltip "Test the connection successfully before saving"; `Saving…`). Editing any field invalidates the last test. Result is a toast with the server message.

### 4.10 Datasource configuration (settings)

Capability: [datasources](../capabilities/datasources/spec.md).

- Title "Datasource Configuration", subtitle "Connect the data platforms your datasets draw from — Databricks SQL warehouses, PostgreSQL databases or REST APIs.", primary **New datasource** (hidden while the form is open).
- List: row (`datasource-<id>`) with a database icon tile, name, kind chip (`Databricks` / `PostgreSQL` / `REST API`), the one-line summary, Edit (pencil, title "Edit") and Delete (trash, title "Delete"; spinner while deleting). Delete confirm text in section 7. States: `Loading datasources…`; inline error (`Could not load configured datasources` fallback); empty dashed block `No datasources yet. Add one to start building datasets.`
- Form ("New datasource" / "Edit datasource"): **Name** (placeholder `Claims warehouse`), **Kind** select (`Databricks`, `PostgreSQL`, `REST API`; disabled when editing). Per kind:
  - Databricks: **Server hostname** (`adb-1234567890.1.azuredatabricks.net`), **Personal access token** (password, `dapi…`), **SQL warehouse ID** (`1a2b3c4d5e6f7g8h`).
  - PostgreSQL: **Host** (`db.example.com`) + **Port** (`5432`) side by side, **Database** (`analytics`), **User** (`readonly_user`) + **Password** (`••••••••`), **Use SSL** checkbox.
  - REST API: **Base URL** (`https://api.example.com`), **Authentication** select (`No auth`, `Bearer token`, `API key header`, `Basic`) revealing **Token** / **Header name** + **Key** / **Username** + **Password**; an **Endpoints** section with **Add endpoint** (plus icon); an OpenAPI discovery row (input `aria-label="OpenAPI spec URL (optional)"`, placeholder `OpenAPI spec URL (optional) — auto-detect: /openapi.json, /swagger.json…`, Enter or the **Discover** button, `Discovering…`) which opens a review list ("<n> endpoint(s) found[ in <title>]", **Select all** · **Select none**, a checkbox row per endpoint showing name, group, pagination style, "<n> field(s)", "already added" or "not a list", the path and summary, a collapsible "<n> operation(s) skipped" with reasons, **Add <n> endpoint(s)** and **Cancel**); then one card per endpoint with **Name** (`customers`), **Path** (`/v1/customers`), **Group (optional)** (`default`), **Rows pointer (optional)** (`/data/items`, with the hint "Rows pointer: JSON pointer to the array of rows; leave empty if the response is the array."), **Pagination** select (`None`, `Page`, `Offset`, `Cursor`) revealing Page param / Size param / Page size, Offset param / Size param / Page size, or Cursor param / Cursor pointer / Page size; a trash icon titled "Remove endpoint".
  - Footer buttons: **Test connection** (`Testing…`), **Save datasource** / **Save changes** (green; disabled until a test has passed and a name is set; tooltip "Test the connection successfully before saving"; `Saving…`), **Cancel**.
  - Test and save results are toasts carrying the server message (e.g. `Connection successful`; failures such as `Postgres — …`); `Give the datasource a name first` if saved unnamed; `No endpoints found in the spec` when discovery finds nothing.

### 4.11 Testing data (settings)

Capability: [testing-data](../capabilities/testing-data/spec.md).

Title "Testing Data", subtitle "Bundled sample datasets you can load into a PostgreSQL database to power local testing and evals." Empty: "No testing data fixtures are registered." (while loading: `Loading fixtures…`). Each fixture is a collapsible card (`testing-data-fixture-<id>`; chevron rotates when open): name, a status chip (`testing-data-status-<id>`: check/X icon + "<loaded>/<required> entities"), description, and when loaded the connection `host:port/database`. Expanded: an optional error line (`testing-data-error-<id>`), **Connection** form (Host `localhost`, Port `5432`, Database, User `postgres`, Password, **Use SSL**; `testing-data-host|port|database|user|password-<id>`), the last test message, **Test connection** (plug icon, `testing-data-test-<id>`) and the load button (`testing-data-load-<id>`: `Load testing data` / `Recreate testing data` for seedable fixtures, `Register testing data` otherwise; `Loading…` / `Registering…` while running). Load shows an inline amber confirm panel (`testing-data-confirm-panel-<id>`): for seedable fixtures "This drops and recreates schema <schema> on <host:port/database>. Everything in that schema will be lost." and for registrable ones "This registers "<name>" as a datasource and dataset against the existing database at <host:port/database>. No schema changes are made."; buttons **Confirm** (`testing-data-confirm-<id>`) and **Cancel**. A **Remove** section ("Deletes the "<name>" datasource and dataset records from the app only. It does not touch the database itself.") has a **Remove** button (trash icon, `testing-data-remove-<id>`, disabled unless loaded; `Removing…`) with its own confirm panel ("This removes the "<name>" datasource and dataset records from the app. The database and its data are not touched."). Only one card is expanded at a time and each card keeps its own form values, busy flags and confirmations.


### 4.12 Developer (settings)

Capability: [developer-settings](../capabilities/developer-settings/spec.md).

- Centred column, max width 560 px, like Testing Data.
- Title "Developer", subtitle "Tools for developing this app. Everything here is off by default."
- **Switch row:** a `role="switch"` button labelled "Developer observability" (`aria-checked`), with the description "Export agent traces to Arize Phoenix and backend traces, metrics and logs to an OpenTelemetry endpoint. Traces are still kept in the local store." The track is emerald when on and zinc when off.
- **Endpoint rows** (`data-testid="developer-phoenix-endpoint"` and `"developer-otlp-endpoint"`): a label ("Phoenix endpoint", "OTLP endpoint"), a monospace text field (placeholders `http://localhost:6006`, `http://localhost:4318`), and a secondary **Test** button (plug icon; "Testing…" with a spinner while it runs).
  - Under the row: the validation error in red (`<Phoenix|OTLP> endpoint must be an http(s) URL`), or the last test result, green when it passed and red when it failed.
- **Save:** a green, full-width button ("Saving…"). It is disabled unless the form differs from the saved setting and both endpoints are valid. The result is a toast with the server message.
- **Restart notice** (`data-testid="developer-restart-notice"`): an amber panel with "Restart to apply" and "The running backend has developer observability on|off."
  - Desktop app: a **Restart backend** button (rotate icon; "Restarting…" until the backend is ready again).
  - Browser: the text "Restart the CLI to apply." instead of the button.
### 4.12 Session chat

Capability: [sessions-chat](../capabilities/sessions-chat/spec.md); deep analysis in [deep-analysis](../capabilities/deep-analysis/spec.md); verification badges in [verified-queries](../capabilities/verified-queries/spec.md).

Layout: a scrolling transcript column (max width 860, centred, 20 px gaps) above a composer pinned at the bottom; a **history navigator** at the top-right of the transcript (one small tick per user message; hovering opens a 300 px list of the user messages, clicking one scrolls to it).

Transcript items, in order of appearance:

- **Welcome card** (empty session only, never persisted nor sent to the model; `data-testid="session-welcome"`): sparkle icon + "<session name> is ready", the text "Ask a question in plain English and I will query your data, explain how I got the answer and turn it into an interactive visual." plus "Connected to <datasets>." and "Try one of these:" with three starter chips: "What data is available here? Summarise the tables and the key metrics.", "What stands out in this data right now? Give me the headline numbers.", "How have the main metrics moved over the last 12 months?" Clicking a chip fills the composer; the user sends it.
- **User message**: right-aligned bubble (max 70 % width, `white/10`, radius 12, 13 px, pre-wrapped) with a hover **Copy message** icon button (title "Copy message"; toast `Copied to clipboard`, `Copy failed`).
- **Assistant answer**: a card (`#232323`, border `white/10`, radius 16, padding 16) with the Markdown body, then optional blocks: **How I worked this out (<n> step(s))** collapsible numbered list (each step's rationale plus a muted outcome: "<n> rows" or "failed — <error>"); **Knowledge in context (<n>)** collapsible (kind label, title, dataset or "global", body, footnote "Curated knowledge the assistant was given before answering. Edit it under Knowledge; disabled snippets are never included."); an interpretation caption (info icon + one line, tooltip = full text); **Data entities** chips; **Data used (<n> query/queries)** collapsible with, per call, the tool label ("<tool> — <n> row(s)" or "<tool> — failed"), "(truncated)" flag, a **Copy SQL** icon button (`aria-label="Copy SQL"`), the rationale, any warnings (amber triangle), the SQL in a pre block and an error line. Then the action row: a **Verified** badge (badge-check icon, title "Matches an approved query"), a cross-check badge (**Cross-checked** green with shield-check, **Cross-check differs** amber with shield-alert, **Cross-check failed** muted with shield-off; tooltip = the check's note), copy, and — only when the answer has data — thumbs-up (`aria-label="Save as verified query"`, title "Save as verified query" -> "Saved as verified query" once on) and thumbs-down (`aria-label="Mark answer as wrong"`, title "Mark answer as wrong" -> "Marked as wrong"; both `aria-pressed`, filled when active, hidden until row hover otherwise). Below: **Generate interactive visuals** (sparkles icon; `Generating interactive visuals…` with spinner; disabled while sending or generating) when the answer has text.
- **Error bubble**: red-tinted card (`red-400/20` border, `red-400/6` fill), triangle-alert icon, "Something went wrong" + the message, and on the latest turn a **Retry** button (`aria-label="Retry"`). Client-only, never persisted.
- **Clarification card**: the question, numbered option buttons (number badge, label, description), then — on the latest message — **Something else** (toggles to **Cancel custom answer**; reveals an input `aria-label="Custom answer"`, placeholder `Type your own answer…`, plus a **Send custom answer** arrow-up button) and **Skip**. The same reasoning / knowledge / data blocks as an answer appear under it. Older clarifications are disabled.
- **Deep-analysis report card**: telescope tile, report title, "Deep analysis · <n> angle(s) investigated", a **Download report** button (title "Download the full report (.md)", label "Report"), then the Markdown executive summary.
- **Visual event card**: bar-chart tile, "Created | Updated | Reverted <visual title>", "Version <n>", a **View** button (re-opens that visual in the right panel), plus the assistant's Markdown commentary when it is more than the generic event sentence.
- **Thinking block** (while a turn streams): brain icon + "Thinking" with the live reasoning tail (last 90 characters), one card per tool call (wrench, name, then a spinner -> "<n> rows" or "failed", the rationale as it forms, the input), the streamed answer so far (Markdown), and a spinner with elapsed seconds (`<s>.<d>s`, 100 ms ticks).
- **Deep-analysis status card** (`aria-label="Deep analysis status"`): while a background job runs, a spinner + "Deep analysis running — <progress>" and the question; on failure "Deep analysis failed — <progress>" with a **Dismiss deep analysis** X button. The chat stays usable.

Composer (max width 860, `#232323`, border `white/10`, radius 16, padding 12): a 2-row textarea (placeholder `Ask a follow-up question…`; Enter sends, Shift+Enter inserts a newline), left mode toggles **Careful** (shield-check icon, `aria-label="Careful mode"`, `aria-pressed`, green when on) and **Deep analysis** (telescope icon, `aria-label="Deep analysis"`, disabled with an empty draft or while a job runs), each with an instant styled tooltip (`data-tip`, shown on hover and keyboard focus; text in section 7), and the right-aligned round **Send message** (arrow-up; `aria-label`/title "Send message"; disabled for an empty draft) which becomes **Stop response** (square icon) while a turn streams. When the user clicks a data mark in a visual, a chip row `aria-label="Follow-up suggestions"` appears above the composer: "Suggested questions — click to ask:", **Drill into "<label>"**, **Why "<label>"?** (both prefill the composer, never send) and a **Dismiss follow-ups** X.

Toasts used here: `Deep analysis report ready`, `Report downloaded`, `Report download failed`, `Could not start deep analysis`, `Could not save feedback`, `Feedback saved`, plus server messages.

### 4.13 Interactive visual panel (right panel in a session)

Capability: [visuals](../capabilities/visuals/spec.md).

- Header row: bar-chart icon + "Visuals" and, right-aligned, controls (only when a visual is open): a **version** dropdown (`title="Version history"`, history icon + `v<n>` + chevron; menu lists "Version <n>" with `current` / `viewing` tags, the instruction (or "Initial version") and the date, plus "refreshed <date>"; when viewing an old version the first entry is **Make v<n> the current version** with "now v<current>"; a full-screen backdrop button `aria-label="Close version menu"` closes it); **Tailor** (sliders icon; disabled with tooltip "Make this version current before tailoring" when viewing an old version; popover with **Chart type** select `Auto, Bar, Line, Scatter, Heatmap, Metric cards, Table, Donut`, **Sort** select `None, Ascending, Descending`, **Top N (3–50, optional)** number input with placeholder `All items`, a preview of the generated plain-English instruction, an error line, **Cancel** and **Apply** (disabled while nothing is chosen or while tailoring); backdrop `aria-label="Close tailoring form"`); **Refresh data** icon button (`aria-label="Refresh data"`, title "Refresh data (re-run the stored query)"; disabled on old versions); **Download bundle** icon button (`aria-label="Download bundle"`, title "Download bundle (HTML, CSS, JS, answer.md, data.json)"); and a **saved-visuals** dropdown (gallery icon + count + chevron, title "Saved visuals in this session"; items = title + "v<n> · <date>"; backdrop `aria-label="Close visual menu"`).
- Body states: *loading* — spinner tile, "Designing the visual", "Building and saving HTML, CSS, and JavaScript in the session workspace…"; *error* — red card "Visual generation failed" + message; *empty* — sparkle tile, "No visual generated yet", "Generate an interactive visual from any completed assistant answer."; *populated* — a sandboxed frame filling the panel (`sandbox="allow-scripts"`, `referrerpolicy="no-referrer"`, title "Interactive visualization", fill `#171717`, border `white/10`, radius 12) and a footer line with the visual's title and `<path>/v<n>`. Over the frame: while a silent auto-repair runs, a banner "Fixing the visual…"; if a runtime error is reported by the frame (and repair did not fix it), a banner "This visual hit a runtime error." + "<message> — ask the assistant to fix it or revert to an earlier version."
- Frame messages handled: `visual-error` (runtime error) and `visual-select` (a data mark was clicked; becomes the follow-up chip row in the chat).
- Toasts (from the shell): `Visual bundle downloaded`, `Bundle download failed`, `Revert failed`, plus server messages. A downloaded bundle is named `<slug of title>.zip` (`visual-<first 8 chars of id>.zip` when the slug is empty).

### 4.14 Entity details (right panel default)

Shows the current catalog/schema/entity selection. Empty: "Select a catalog, schema or entity to see its details." (centred, 12 px `zinc-400`). Selected: a full-width **inclusion toggle** at the top — `Include item` (light) / `Include item (partially included)` (circle-minus) / `Included — click to remove` (green, circle-check) — then a header (icon + monospace name: catalog = database `sky-400`, schema = folder-tree `amber-400`, entity = table `emerald-400`), a micro-label (`Catalog`, `Schema · <catalog>`, or the fully qualified `catalog.schema.table` for entities), summary rows (catalog: "Schemas", "Entities"; schema: "Entities"; entity: "Columns"), and a list: schemas with "<n> entities", entities with "<n> cols", or columns (name + type, with " · not null" when not nullable).

### 4.15 Metrics panel (inside the catalog browser)

Capability: [metrics](../capabilities/metrics/spec.md). Heading "Metrics" with the text "Curated definitions for the entities included above. Answers reuse these expressions verbatim instead of re-deriving the number each turn." and a primary **New metric** button (`new-metric`; disabled with tooltip "Include at least one entity first"). Rows (`metric-<name>`): gauge tile, label, a monospace name chip, entity, the expression (monospace, one line) and "by <dimensions>"; Edit (title "Edit") and Delete (title "Delete") icon buttons. States: `Loading metrics…`; inline error; empty dashed card ("Include entities above to define metrics over them." or "No metrics yet for these entities — define one so “denial rate” always means the same thing."). "Promote a verified answer" row of pill buttons (sparkles icon, label, tooltip = the SQL) prefills a draft. Form ("New metric" / "Edit metric", Close X): **Label** (`Denial rate`), **Name** (monospace, `denial_rate`), **Entity** select (`No entities included` when empty), **Expression** textarea (monospace, placeholder `SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)`), **Dimensions (comma separated)** (`month, provider, plan`), **Description** (`Share of submitted claims denied in the period.`), **Cancel** and **Create metric** / **Save changes** (`save-metric`; tooltip "Label, name, entity and expression are required").

## 5. Cross-cutting behaviour

### 5.1 State that survives view changes

Session list, the active session, the selected visual and the right-panel width/collapse live at shell level, so switching between views does not reload them. Form drafts inside settings sections are not preserved across section changes (each is re-created). The composer draft in a chat is per-chat-instance.

### 5.2 Selection state

The dataset browser's inclusion set and the current tree selection are shell-wide singletons: the right-panel Entity details and the browser's rows read the same state. Selecting anything while the panel is collapsed expands it.

### 5.3 Toast policy

Every action failure surfaces as an error toast with the server's `message` (or `Backend unreachable` when the request itself failed); every successful mutating action surfaces a success toast carrying the server's message. Errors persist 8 s, others 4 s (3.3).

## 6. Design tokens

The app is dark-only and built from a small, fixed set of values. Colours are the Tailwind v4 default palette plus a handful of arbitrary greys; there is **no custom theme file** and no CSS variables beyond Tailwind's own. sRGB equivalents are given for rebuilds on other stacks.

### 6.1 Colour

Surfaces (hex, exact):

| Token | Value | Used for |
|---|---|---|
| app background | `#1c1c1c` | root, window background, top bar area, mark icon base |
| sidebar | `#181818` | left sidebar (both modes) |
| right panel | `#161616` | details panel |
| card / composer | `#232323` | composer, chat cards, forms, native `<option>` background, dashed cards |
| popover / toast | `#2a2a2a` | menus, toasts, dataset/session menus |
| system logs dialog | `#191919` | logs panel |
| visual frame | `#171717` | iframe backdrop |
| tooltip | `#26262b` | composer mode tooltips |

Text (Tailwind `zinc`): `zinc-100` `#f4f4f5` headings/emphasis; `zinc-200` `#e4e4e7` primary text; `zinc-300` `#d4d4d8` default body (root text colour); `zinc-400` `#a1a1aa` secondary; `zinc-500` `#71717a` muted/captions/icons; `zinc-600` `#52525b` faint; `zinc-700` `#3f3f46` disabled fill; `zinc-900` `#18181b` text on light buttons.

Lines and fills are white at low alpha over the surfaces: hairline borders `white/5` (region dividers) and `white/10` (cards, inputs), stronger `white/15-25` (focus/active outlines), hover fills `white/5-10`, selected row fill `rgb(255 255 255 / 0.05)`, input fill `white/5`.

Semantic: success/positive `emerald-400` `#34d399` (text/icons), `emerald-600` `#059669` (confirm buttons, hover `emerald-500` `#10b981`); error `red-400` `#f87171` text, `red-300` `#fca5a5`, `red-500/10` fills, `red-500` `#ef4444` badge; warning `amber-400` `#fbbf24`, `amber-300`, `amber-500/10-15` fills; info/catalog `sky-400` `#38bdf8`; AI-suggested `violet-300`/`violet-400` `#a78bfa`-family with `violet-400/10` fills. Entity-type colours: catalog `sky-400`, schema `amber-400`, entity `emerald-400`.

Scrollbars (webkit): 8 px, transparent track, thumb `rgb(255 255 255 / 0.15)` (hover `0.25`), fully rounded, transparent corner.

### 6.2 Typography

- Sans (all UI): system stack `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`, antialiased. No webfont is loaded.
- Serif (page titles only): Tailwind default serif stack (`ui-serif, Georgia, Cambria, "Times New Roman", Times, serif`).
- Monospace (identifiers, SQL, logs, expressions, kbd-like chips): Tailwind default mono stack (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`).
- Base text size 13 px. Scale in use (px): 8 and 9 (badges), 10 (micro labels, chips), 11 (labels, captions), 12 (secondary body, dense lists), **13 (default)**, 14 (list-row titles, composer name input, dialog title), 15 (settings titles, section headings), 26 (agent title), 28 (page titles). Weights: normal, medium (500) for buttons/labels, semibold (600) for titles. Uppercase micro-headings use ~0.08 em / "wider" tracking at 10-11 px. Chat prose line height 1.75; UI line heights follow Tailwind defaults (13 px -> 20 px).

### 6.3 Spacing, radii, shadows, motion

- Spacing: Tailwind 4 px base grid. Recurrent: sidebar width 296, top bar 48, tab strip 40, banner 28, window-drag padding for traffic lights 76, content column padding 32/40 (pages) or 24/40 (settings), chat column max width 860, composer card max width 920 (new session) / 860 (chat), page column max width 960.
- Radii: 4 (code chips), 6 (inputs, small buttons; `rounded-md`), 8 (`rounded-lg`: page buttons, rows, menus), 12 (`rounded-xl`: cards, toasts, icon tiles 40 px), 16 (`rounded-2xl`: composers, dialogs, chat cards), full (badges, avatar, pills).
- Shadows: `shadow-xl` on popovers/toasts, `shadow-lg` on the new-session card, `shadow-2xl` on the logs dialog. Otherwise flat: depth comes from surface greys and borders.
- Motion: spinners (`animate-spin`) on loaders; 120 ms opacity/transform transitions on the composer tooltips and the resize-handle line; chevrons rotate 90 degrees on expand; a pulsing skeleton for the top-bar datasource loading state. Tooltips' motion is disabled under `prefers-reduced-motion: reduce`.

### 6.4 Icons

[lucide](https://lucide.dev) outline icons only (line width 2 by default, `strokeWidth` 2.5 on the Stop square), sized 11-19 px (15 px in nav rows, 14 px in buttons, 16 px for toolbar/panel toggles). Names used, by area:

- Shell / nav: `panel-left`, `panel-right`, `arrow-left`, `chevron-down`, `chevron-right`, `plus`, `search`, `ellipsis-vertical`, `trash-2`, `scroll-text`, `settings`, `flask-conical` (Datasets), `bot` (Agents, LLM config, agent tiles), `book-open` (Knowledge), `folder-kanban` (Sessions), `database` (Datasource config, catalogs, session datasource context), `test-tube` (Testing data), `workflow` (dataset tiles), `corner-down-left` (Create).
- Status / feedback: `loader-2` (spinners), `circle-check`, `circle-x`, `circle-alert`, `circle-minus`, `info`, `x`, `triangle-alert`, `lock`, `refresh-cw`, `download`, `copy`, `play`, `plug-zap`, `check`.
- Data / catalog: `folder-tree` (schema), `table-2` (entity), `layout-grid`, `gauge` (metrics, checks, Evals tab), `list-checks` (question sets), `pencil`, `wand-2` (generate suggestions), `sparkle` / `sparkles` (AI, visuals, suggestions), `file-text` / `tag` / `filter` (knowledge kinds), `wrench` (tools), `brain` (Thinking, Memory tab), `cpu` (Model tab), `clock`.
- Chat / visuals: `arrow-up` (send), `square` (stop), `thumbs-up`, `thumbs-down`, `badge-check` (Verified), `shield-check` / `shield-alert` / `shield-off` (cross-check, Careful mode), `telescope` (deep analysis), `bar-chart-3`, `history` (versions), `sliders-horizontal` (Tailor), `gallery-vertical-end` (saved visuals), `signal` (reasoning effort).

### 6.5 Theming

Dark only; no `prefers-color-scheme` handling and no user setting. Native form controls inherit the dark surface (`<option>` backgrounds set to `#232323`).

*Implementation note.* Tailwind CSS v4 through `@tailwindcss/postcss`, a single `@import "tailwindcss";` in `src/styles.scss`, no `tailwind.config`; arbitrary values (`bg-[#232323]`, `text-[13px]`) carry the surfaces and sizes above. `app.scss` holds only the resize-handle styles; `styles.scss` holds the drag-region utilities (`.app-drag`, `.app-no-drag`, `.pl-traffic-lights` = 76 px), `.option-active` and the scrollbar rules; chat prose lives in the chat component's stylesheet (`.prose-dark`). Icons are `lucide-angular`; components are standalone and signal-driven.

## 7. Copy that tests or users rely on

Strings below are asserted by the Playwright suite or are user-facing contracts. Exact casing, punctuation and the ellipsis character (`…`) matter.

| Where | String |
|---|---|
| Page heading (hidden) | `Questions to Insights` |
| Window / document title | `Halo BI Assistant` |
| Sidebar rows | `Datasets`, `Agents`, `Knowledge`, `Sessions` |
| Sidebar controls (titles) | `Collapse sidebar`, `Expand sidebar`, `New conversation`, `Session options`, `Settings`, `System logs and diagnostics` |
| Sidebar aria-labels | `Primary sidebar`, `Settings sidebar`, `Workspace navigation`, `Sessions navigation`, `Settings navigation`, `Open system logs`, `Options for <session name>` |
| Settings | `Back`, `Search settings`, `Datasource Configuration`, `LLM Configuration`, `Testing Data`, footer `Halo BI Assistant v<version>` |
| Right panel | `Details panel`, `Resize right panel`, `Collapse right panel`, `Expand right panel`, `Drag to resize · Double-click to reset` |
| Right panel empty | `Select a catalog, schema or entity to see its details.` / `Select a question in the Evals tab to see how it ran.` |
| Banner | `Backend restarting…`, `Backend unavailable — restart the app` |
| Toast fallbacks | `Backend unreachable`, `Could not load sessions` |
| Session menu | `Delete session` |
| Session delete confirm | `Delete “<name>”?` + blank line + `This permanently removes its conversation, agent memory, and workspace files.` |
| Datasource delete confirm | `Delete datasource “<name>”?` + blank line + `Datasets bound to it will stop working until re-saved against another datasource.` |
| Metric delete confirm | `Delete the metric “<label>”?` + blank line + `Answers will stop reusing its definition.` |
| Knowledge confirms | `Delete “<title>”?` + blank line + `The assistant will stop using it.`; `Reject “<title>”?` + blank line + `This permanently removes the suggestion.` |
| Datasets | `New dataset`, `Edit dataset`, `Save dataset (<n>)`, `Dataset name`, `Delete dataset`, `Refresh inventory`, `No datasets yet — create one with “New dataset”.`, `Filter catalogs, schemas and entities…`, `No accessible catalogs found.`, `Load entities from <label>` |
| Datasources | `New datasource`, `Edit datasource`, `Save datasource`, `Save changes`, `Test connection`, `No datasources yet. Add one to start building datasets.`, labels `Name`, `Kind`, `Host`, `Port`, `Database`, `User`, `Password`, `Use SSL` |
| LLM | `LLM Configuration`, `Test connection`, `Save connection`, `Provider`, `Model`, `Deployment name`, `Base URL`, `API key` |
| Agents | `All agents`, `Prompt template`, `Tools (<n>)`, `Memory`, `Model`, `Evals`, `Questions`, `Executions`, `Recent messages replayed`, `Provider`, `<n> messages`, `No tools`, `This agent runs in a single step with no tools.`, `This agent is stateless — no memory is configured.`, `No evals configured for this agent yet.`, `No eval runs yet — run the suite from the Questions tab.`, `Select all`, `Run <n> selected`, `<n>/<total> passed` |
| Knowledge | `New snippet`, `Generate suggestions`, `Pending suggestions`, `Accept`, `Reject`, `No knowledge yet`, `Create snippet`, `Save changes` |
| Metrics | `New metric`, `Create metric`, `Save changes` |
| New session | `Session name`, placeholder `My new session`, `Create`, `No model configured`, `Reasoning effort`, `Select at least one dataset for this session`, `No datasets yet — create one in Datasets first.` |
| Chat composer | placeholder `Ask a follow-up question…`, `Send message`, `Stop response`, `Careful`, `Careful mode`, `Deep analysis`, `Type your own answer…`, `Custom answer`, `Send custom answer`, `Something else`, `Cancel custom answer`, `Skip`, `Retry`, `Something went wrong`, `Thinking` |
| Chat answer | `Generate interactive visuals`, `Generating interactive visuals…`, `Verified`, `Cross-checked`, `Cross-check differs`, `Cross-check failed`, `Save as verified query`, `Mark answer as wrong`, `Copy message`, `Copy SQL`, `Data used (<n> query)` / `(<n> queries)`, `Data entities`, `How I worked this out (<n> step(s))`, `Knowledge in context (<n>)`, `Download report`, `View`, `Created` / `Updated` / `Reverted` + `Version <n>` |
| Chat tooltips (Careful on / off) | on: `Careful mode is on: every answer is re-checked by an independent query and gets an agree/disagree badge. Slower per answer.`; off: `Careful mode: re-check each answer with an independent query and show an agree/disagree badge. Slower per answer.` |
| Chat tooltips (Deep analysis) | idle: `Deep analysis: investigate the typed question from several angles in the background and deliver a downloadable report. Takes a few minutes; chat stays usable.`; running: `A deep analysis is already running for this session.` |
| Visual panel | `Visuals`, `Version history`, `Tailor`, `Refresh data`, `Download bundle`, `Saved visuals in this session`, `Version <n>`, `current`, `viewing`, `Initial version`, `Make v<n> the current version`, `Designing the visual`, `Visual generation failed`, `No visual generated yet`, `Fixing the visual…`, `This visual hit a runtime error.`, frame title `Interactive visualization` |
| System logs | `System logs`, `LIVE`, `Refresh logs`, `Export`, `Exporting…`, `Close system logs`, `All <n>`, `Issues <n>`, `Search system logs`, `Search messages or sources`, `Group by run`, `Follow`, `No matching log entries`, `Exported <n> diagnostic entries` |
| Entity details | `Include item`, `Include item (partially included)`, `Included — click to remove`, `Schemas`, `Entities`, `Columns` |

## 8. Accessibility

Targets and the automated gate: [../product/non-functional.md](../product/non-functional.md) and [../capabilities/app-shell/spec.md](../capabilities/app-shell/spec.md). The Playwright suite loads `axe-core` into the running app shell and **fails on any automatically detectable violation**; new screens must keep that scan clean (this is the acceptance bar, not a best effort).

- **Landmarks**: the three sidebars/panels are `aside` elements with accessible names (`Primary sidebar` / `Settings sidebar`, `Details panel`); navigation groups are `nav` with names (`Workspace navigation`, `Sessions navigation`, `Settings navigation`); the content area is `main` with a visually hidden `h1` ("Questions to Insights"); the system logs panel is a `dialog` (`aria-modal`, labelled by its `h2`).
- **Names for icon-only controls**: every icon-only button has a `title` and, where tests or assistive technology rely on it, an `aria-label` (`Open system logs`, `Close system logs`, `Refresh logs`, `Options for <session>`, `Send message`, `Stop response`, `Retry`, `Copy SQL`, `Careful mode`, `Deep analysis`, `Save as verified query`, `Mark answer as wrong`, `Refresh inventory`, `Clear filter`, `Refresh data`, `Download bundle`, `Download run <id> as Markdown`, `Delete run <id>`, `Dismiss deep analysis`, `Dismiss follow-ups`, `Send custom answer`). Sidebar collapse/expand and panel toggles carry titles ("Collapse sidebar", …) used as their accessible names.
- **State**: toggles expose `aria-pressed` (Careful, thumbs, eval set / case rows, pending-suggestions filter); disclosure buttons expose `aria-expanded` (version, tailor and visual menus, custom answer); the resize separator exposes `aria-valuemin/max/now` and `aria-orientation`.
- **Keyboard**: everything interactive is a native `button`, `input`, `select`, `textarea` or `details/summary`, so Tab / Shift+Tab / Enter / Space work by default. Specific keys: the resize separator (Left/Right = 24 px, Home/End = min/max; focusable, `tabindex=0`); chat composer (Enter send, Shift+Enter newline; the custom-answer input has its own Enter handler); the OpenAPI discovery input (Enter runs Discover); tooltips on the composer mode buttons also show on keyboard focus (`:focus-visible`). The resize handle shows its guide line on `:focus-visible`.
- **Focus handling**: inputs show a visible border change on focus (`white/25`); the resize handle and tooltips respond to keyboard focus. Open question: the system logs dialog does not currently trap focus or restore it to the opener on close, nor close on Escape; rebuilds should add this if the axe/WCAG bar is raised.
- **Live regions**: the knowledge generation progress list is `aria-live="polite"`. Toasts are plain elements without a live-region role today (open question: add `role="status"` / `role="alert"`).
- **Contrast**: muted text on dark surfaces is `zinc-500` (`#71717a` on `#181818`-`#232323`) at 10-13 px; the automated scan is the only enforced contrast check today. Decorative icons next to text are not announced separately.
- **Motion**: only the composer tooltips honour `prefers-reduced-motion`; spinners and chevron rotations do not.

## 9. Visual baseline

`frontend/e2e/layout-accessibility.spec.ts` captures the shell at the default window size as `application-shell` (`application-shell-darwin.png`, updated only with `npm run test:e2e:update` when a visual change is intended). The committed baseline shows: sidebar 296 px with the logo and collapse icon, the "Demo User" row, two top-level rows and one section row, the logs and settings icons at the bottom with a red count badge; the main column with the top bar, empty 40 px tab strip and the placeholder composer at the bottom; and the right panel at 572 px with the centred message "Select a catalog, schema or entity to see its details." with its collapse icon top-right.

Open question: the committed baseline PNG pre-dates the current navigation labels (it shows "Data Sandbox" and "Projects" where the code now renders "Datasets", "Agents", "Knowledge" and "Sessions"); the baseline should be regenerated, and until then the code, not the image, is the reference for labels.

## 10. Open questions and gaps

- Account row ("Demo User", avatar "D"), settings search and its `⌘ F` hint, the Datasets list filter pills (Pinned / Yours / Shared with you), the search icons on the Datasets and Agents lists, the layout-grid button and the empty 40 px tab strip are non-functional placeholders; intended behaviour is undefined.
- The 76 px traffic-light left padding is applied on every platform; on Windows/Linux (no inset controls) this leaves empty space. Intended cross-platform title-bar treatment is undefined.
- Right-panel collapse state and sidebar collapse state are not persisted; only the panel width is.
- No Escape / focus-trap handling for the system logs dialog and the popover menus; toasts lack live-region roles (see 8).
- Date formatting uses the user's locale for times (`toLocaleTimeString`) but fixed `en-US` for dataset month headings; there is no localisation layer and all copy is English.
- The visual frame's own typography/colours (inside the sandboxed iframe) are specified with the visuals capability, not here.

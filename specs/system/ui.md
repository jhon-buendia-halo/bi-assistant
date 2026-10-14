# UI

The contract for how the app looks and behaves as a single window: shell layout, navigation, every screen and panel, shared components, design tokens, accessibility and user-visible copy. Behaviour rules (what the data means, what happens on the server) live in the capability specs; this file says where things are, what they are called, and how they look. Terms are defined in [../product/glossary.md](../product/glossary.md).

Stack-neutral wording; *Implementation notes* name the current Angular/Tailwind realisation (see [tech-stack.md](tech-stack.md)). The shell-level rules (R-numbered, testable) are in [../capabilities/app-shell/spec.md](../capabilities/app-shell/spec.md); this file is the visual and structural reference that spec points at.

Capability specs referenced below: [app-shell](../capabilities/app-shell/spec.md), [diagnostics](../capabilities/diagnostics/spec.md), [llm-settings](../capabilities/llm-settings/spec.md), [datasources](../capabilities/datasources/spec.md), [datasets](../capabilities/datasets/spec.md), [testing-data](../capabilities/testing-data/spec.md), [sessions-chat](../capabilities/sessions-chat/spec.md), [visuals](../capabilities/visuals/spec.md), [knowledge](../capabilities/knowledge/spec.md), [verified-queries](../capabilities/verified-queries/spec.md), [metrics](../capabilities/metrics/spec.md), [deep-analysis](../capabilities/deep-analysis/spec.md), [agents-evals](../capabilities/agents-evals/spec.md), [admin](../capabilities/admin/spec.md).

## 1. App shell

### 1.1 Window

- Desktop window, default 1440 x 900 px, minimum 960 x 600 px. The window background starts as the frame's teal for the operating system theme (`#0077a0` light, `#003a52` dark) and switches to the resolved theme's frame teal as soon as the page reports it (app-shell R34, R44), so a resize or a slow first paint never flashes a different colour behind the textured frame (1.2). The page itself paints in the resolved theme from its first frame (R42).
- Native title bar is hidden with the traffic-light controls inset (macOS `hiddenInset`); the app draws its own top bar and treats it as a window-drag region. Interactive children of a drag region (buttons, inputs) opt out of dragging.
- The window title and the HTML `<title>` are "Agentic Hub". The operating-system app name (macOS menu bar and Dock, installers, data directory) stays "Halo BI Assistant". The banner's "Agentic Hub" is the page's only `<h1>`.
- The renderer has no router; nothing is addressable by URL. All navigation is view state (1.4).
- Two themes, Light and Dark, chosen under Settings → Appearance (4.16); System, the default, follows the operating system. See 6.5. Every surface uses the theme tokens (6.0).

### 1.2 Regions

```
+--------------------------------------------------------------------------------+
| [backend status banner - only while restarting / down]  h 28                    |
+--------------------------------------------------------------------------------+
| frame (--frame-gradient + frame texture), padding 12, gap 12                    |
| +------+ +---------------------------------------------------------------------+ |
| | rail | | canvas card (bg canvas, radius 12, padding 16, gap 12)              | |
| | w 64 | | +-----------------------------------------------------------------+ | |
| | or   | | | banner h 136 (base + image + shade): "Agentic Hub" h1 40/48      | | |
| | 240  | | +-----------------------------------------------------------------+ | |
| |      | | +-------------------------------------------+ +-------------------+ | |
| | menu | | | page card (card)                          | | details panel     | | |
| | logo | | |  [Settings list pane, Settings area only] | | (card) w 572      | | |
| | nav  | | |  [page header: Sessions area only]        | | 360-960, closed   | | |
| | (Ses | | |  main content                             | | on launch         | | |
| | sions| | +-------------------------------------------+ +-------------------+ | |
| | list)| +---------------------------------------------------------------------+ |
| |  D   |                                                                          |
| | logs |                                                                          |
| | gear |                                                                          |
| | LenAI|                                                                          |
| +------+                                                                          |
+--------------------------------------------------------------------------------+
   toast stack: fixed bottom-right over everything; system logs: modal overlay
```

- The whole app is one full-height column: the optional backend banner, then the frame. The frame paints `--frame-gradient` with the frame texture (`brand/agentic-hub/frame-texture.webp`, covering the frame, `mix-blend-mode: multiply`, `--frame-texture-opacity`, 30 % Light) over it, and holds two rounded cards 12 px apart: the rail and the canvas card. The root sets `user-select: none`, and no content area overrides it (inputs and textareas stay editable). Copying chat text is done through the Copy buttons. Open question: whether message bodies and SQL should be selectable.
- **Rail** (64 px collapsed, 240 px expanded as the drawer; `rail` fill, radius 12, `transition: width` 150 ms): see 1.3.
- **Canvas card** (`canvas` fill, radius 12, 16 px padding): the banner on top, then a row with the page card and the details panel, 12 px apart.
- **Banner** (`role="banner"`, min height 136 px, radius 12, `shadow-subtle`, 32 px horizontal padding, window-drag region): three layers, bottom to top: `--banner-base` fill, the banner image (`brand/agentic-hub/banner.webp`, covering the banner, `--banner-image-opacity`, 20 % Light) and `--banner-shade` (a transparent-to-black bottom fade); then the `<h1>` "Agentic Hub", 40 px / 48 px line height, semibold, 0.2 px letter spacing, white. No other content. Screen titles inside the page are `<h2>`.
- **Page card** (the `<main>` landmark; `card`, flex 1, min width 0, clipped, positioned for the floating expand button): in the Settings area, the Settings list pane on the left (1.3); then a column with the optional page header and the main content.
  - **Page header** (Sessions area only; 32 px horizontal / 16 px vertical padding, bottom `border`), always shown there, whether a chat, the New-session composer or the empty Sessions view is open. Left: `brand/agentic-hub/page-header-icon.svg` (36 px) and the title `h2` (24 px / 32 px line height, light weight, 0.12 px tracking, `fg-strong`, one line truncated): the session name while a chat is open, "New conversation" in the composer, otherwise "Sessions". While a chat is open, under the title: the *session context*. For a session bound to an agent it starts with a `sparkles` icon, the uppercase micro-label "Agent" (`fg-muted`) and a `chip chip-neutral` with the agent's name (`data-testid="session-agent"`), or `<name> · agent deleted` once the agent is gone (sessions-chat R57, R59), then 12 px of space. Then a database icon, the uppercase micro-label "Datasource" (`fg-muted`), then one `chip chip-neutral` per datasource used by the session (name, plus kind label; tooltip = the datasource summary). While loading: a 96 x 16 px pulsing `surface-muted` placeholder. If none can be resolved: the muted text "Unavailable". Right: a `btn btn-secondary` **Start New Conversation** (square-pen icon, 20 px; opens the New-session composer) and, while the details panel is closed, the *Expand right panel* `btn-icon`.
  - **Other areas** (Datasets, Agents, Knowledge, Settings) have no page header. While the details panel is closed, the *Expand right panel* `btn-icon` floats at the page card's top-right (8 px inset).
- **Details panel** (`card`): see 1.5. Closed on launch, so the first screen is the page card alone.
- The home state of the main column (no area chosen) is an empty area with a decorative empty composer box at the bottom (max width 860, height 112, `card`). It is a placeholder with no behaviour.

### 1.3 Rail and drawer

**Rail** (`aside aria-label="Navigation rail"`; `rail` fill, 8 px side padding, 12 px gap between groups). Collapsed it is 64 px wide and shows icons only; the menu button widens it to the 240 px **drawer**, which adds labels and the Sessions list. Not remembered between launches (app-shell R47); the drawer is collapsed on launch. Top to bottom:

1. A 24 px window-drag spacer that clears the macOS traffic lights.
2. The **menu button** (menu icon, 24 px, `icon` colour, 48 px tall, radius 8): `aria-label` and title "Expand navigation" while collapsed, "Collapse navigation" while expanded, with `aria-expanded`.
3. The logo: a 28 px circle filled with `--logo-gradient` holding `brand/agentic-hub/logo-mark.svg`; when expanded, beside it the label "Agentic Hub" (14 px semibold `fg-strong`).
4. `nav aria-label="Workspace navigation"`: four 48 px tall buttons (radius 8, 8 px apart), each a 20 px `accent` icon and, when expanded, a 14 px medium `fg` label. Each has `title` and `aria-label` equal to its name:
   - **Datasets** (flask icon), **Agents** (bot icon), **Knowledge** (book-open icon), **Sessions** (folder-kanban icon).
   - Hover: `surface-muted` fill. Current area: `surface-selected` fill and `aria-current="page"`.
5. When expanded, the **Sessions list** (app-shell R46, R48), below a `border` rule and filling the free height (scrolls); when collapsed, a flexible spacer. See below.
6. Bottom group, 12 px apart (centred while collapsed):
   - **Admin** (both modes, users with `manage-users` only; admin R34): `shield` icon, `icon` colour, title and `aria-label` "Admin", label "Admin" when expanded. Marked current (`surface-selected`, `aria-current="page"`) while the Admin area (4.18) is shown.
   - The account avatar: a 32 px `primary` circle with initials in `on-primary` (14 px semibold).
     - **Both modes** (admin R10): a `button` with the signed-in user's initials (Demo User: "DU"), title the display name, `aria-label="Account menu"`, `aria-haspopup="menu"` and `aria-expanded`. Initials: the first letter of the given name and of the family name; else of the first two words of the display name; else the first letter of the email; uppercase, at most two. Clicking it opens a `menu` popover (width 240) beside the rail, its bottom level with the avatar's: the display name (13 px semibold `fg-strong`), the email (12 px `fg-muted`, truncated), a `border` rule, and a `role="menu"` list labelled "Account" (the avatar's `aria-controls`) holding the `menuitem` **Sign out** (`log-out` icon), which takes focus when the menu opens. Escape or a click outside closes it; Escape returns focus to the avatar. While sign-out runs the item reads "Signing out…" and is disabled.
   - **System logs** (scroll-text icon, `icon` colour; `aria-label="Open system logs"`, title "System logs and diagnostics"; label "System logs" when expanded), with a red count badge (`danger` palette, top-right of the icon) showing the number of error + warning log entries, capped at "99+", hidden at zero. Opens the system logs panel (3.2).
   - **Settings** (gear icon, `icon` colour, title and `aria-label` "Settings"; label "Settings" when expanded), marked current (`surface-selected`, `aria-current="page"`) while the Settings area is shown.
   - A 1 px `border` divider.
   - **LenAI**: the LenAI mark (`brand/agentic-hub/lenai-mark.svg`, 38 px tile) above the "Powered by LenAI" artwork (`powered-by-lenai.svg`, `alt="Powered by LenAI"`), centred, tooltip "Powered by LenAI". Both are inverted in the Dark theme (`.lenai-art`).

Choosing **Sessions** opens the drawer (the list is part of it); choosing another area leaves the drawer as it is.

**Sessions list** (in the drawer) — see app-shell R46, R48, and 4.7 for the composer it opens:

- Header row: the heading "Sessions" (13 px semibold `fg-strong`) and a *New conversation* `btn-icon` ("+", title "New conversation"; `surface-selected` while the New-session composer is open).
- `nav aria-label="Sessions navigation"`: one row per session, newest activity first as returned by the backend. Each row is a `list-row` (`list-row-selected` while that session is open) with the session name truncated to one line (13 px medium `fg`), its dataset names beneath (12 px `fg-muted`, joined with " · ", one line; for a session bound to an agent, the agent's name first: `<agent name> · <datasets>`, or `<agent name> · agent deleted`, sessions-chat R57 and R59), and a "more" (vertical ellipsis) `btn-icon`, `aria-label="Options for <session name>"`, title "Session options", visible on hover and while its menu is open. The menu (`menu`, width 176) has one item, **Delete session** (trash icon, `on-danger-soft` text). Both the row and its menu are disabled while a delete is in flight. Row `data-testid="session-<id>"`.
- An empty list shows "No sessions yet." (12 px `fg-muted`).
- Delete asks a native confirm: `Delete “<name>”?` newline newline `This permanently removes its conversation, agent memory, and workspace files.`

**Settings area list pane** (260 px, right `border`, inside the page card, left of the settings form):

1. A "Search settings" `field` (search icon, placeholder `Search settings`, a `⌘ F` key hint in `fg-muted`). A non-functional placeholder today.
2. `nav aria-label="Settings navigation"` with five `list-row` buttons (icon + label; `list-row-selected` and `aria-current="page"` for the chosen one). Choosing one shows its form beside the pane; choosing the chosen one again deselects it and the content shows "Choose a settings section." (`fg-muted`, centred).
   - **Datasource Configuration** (database icon) -> 4.10
   - **LLM Configuration** (bot icon) -> 4.9
   - **Testing Data** (test-tube icon) -> 4.11
   - **Developer** (wrench icon) -> 4.12
   - **Appearance** (sun-moon icon) -> 4.16
3. Flexible spacer, then the footer: "Agentic Hub" then `v<version>` (12 px `fg-muted`; `data-testid="app-version"`). The version is the shipped package version.

Leaving Settings (choosing another rail area) keeps the chosen section, so coming back shows it again.

### 1.4 Navigation model (no router)

The main column renders exactly one of these views, held in a single "main view" state. The Settings area overrides it while it is shown.

| Main view state | Reached by | Rail current | Main column content | Right panel body |
|---|---|---|---|---|
| `home` (default) | start-up | none | empty area + placeholder composer | Entity details (empty state) |
| `dataset` | rail **Datasets** | Datasets | Datasets list (4.2) | Entity details |
| `dataset-new` | **New dataset** or opening a dataset in the list | Datasets | Catalog browser: "New dataset" / "Edit dataset" (4.3) | Entity details |
| `agents` | rail **Agents** (also from the agent editor, app-shell R3); **All agents** in an agent detail; **Back** in the editor of a never-saved agent; deleting a user agent | Agents | Agent Hub (4.4) | Entity details |
| `agent-detail` | clicking an agent card's open control; **Back** in the editor of a saved agent | Agents | Agent detail (4.5) | Eval trace (4.6) |
| `agent-editor` | **New agent** on the hub; **Edit** in a user agent's detail | Agents | Agent editor (4.5.1) | Preview chat (4.5.1) |
| `skills` | **Skills** on the hub; **Back** in the skill editor; deleting a skill | Agents | Skills library (4.5.2) | Entity details |
| `skill-editor` | **New skill** or a row in the skills library | Agents | Skill editor (4.5.3) | Entity details |
| `builtin-skill-editor` | a built-in row in the skills library | Agents | Built-in skill editor (4.5.4) | Entity details |
| `knowledge` | rail **Knowledge** | Knowledge | Knowledge list (4.8) | Entity details |
| `sessions` | rail **Sessions** (also opens the drawer); deleting the open session | Sessions | page header ("Sessions") + "Select a session or start a new conversation."; list in the drawer | Entity details |
| `conversation-new` | **New conversation** in the drawer, or **Start New Conversation** in the page header | Sessions | page header ("New conversation") + New-session composer (4.7); list in the drawer | Entity details |
| `session-chat` | a session row in the drawer, or creating a session | Sessions | page header (session name + datasource context) + Session chat (4.12); list in the drawer | Interactive visual panel (4.13) |
| Settings area, section `datasources` / `llm` / `testing-data` / `developer` / `appearance` | rail **Settings**, then a section | Settings | Settings list pane + the matching form (4.9-4.12, 4.16), centred column | Entity details |
| `admin` (holders of `manage-users`, both modes) | rail **Admin** | Admin | Admin area (4.18), max width 1280; the selected tab is view state | Entity details |

- Content views (everything except the chat) sit in a vertically scrolling, horizontally centred column with 32 px horizontal / 40 px vertical padding and a max width of 960 px (settings forms: 560 px for datasources, testing data, developer and appearance, 480 px for LLM, 24 px horizontal padding).
- Opening a session loads the datasources used by that session (for the header) and its most recent visual (for the right panel).
- Selecting a catalog/schema/entity in the catalog browser, selecting an eval question, generating or viewing a visual, always opens the right panel if it was closed.
- A transient failure to load the session list is retried up to 12 times (200 ms steps, capped at 1 s) before the toast "Could not load sessions" is shown; already-loaded sessions are kept.

### 1.5 Right panel

- `aria-label="Details panel"`; default width **572 px**, minimum **360**, maximum **960** (also never wider than the viewport minus 240 px reserved for the main column, and never below 360).
- The panel is a `card` beside the page card. It is **closed on launch**. It opens on demand: when a dataset element (catalog, schema, entity) is selected, when an eval question is selected, when a visual is generated or viewed, or through the *Expand right panel* button (same icon as the collapse button): in the Sessions area's page header next to *Start New Conversation*, elsewhere floating at the page card's top-right (1.2). Header (48 px): the *Collapse right panel* `btn-icon` (panel-right icon, title "Collapse right panel") right-aligned.
- **Resize handle**: a 10 px wide invisible hit zone straddling the panel's left edge (5 px outside), `cursor: col-resize`, showing a 2 px `border-selected` line on hover, keyboard focus or while dragging. Exposed as `role="separator"`, `aria-orientation="vertical"`, `aria-label="Resize right panel"`, `aria-valuemin` (360), `aria-valuemax` (current maximum), `aria-valuenow` (current width), `tabindex=0`, title "Drag to resize · Double-click to reset".
  - Drag: primary button, pointer capture; moving left widens the panel (`width = startWidth + startX - pointerX`), clamped to the min/max. While dragging the whole window forces `col-resize` and embedded frames stop capturing the pointer.
  - Keyboard (when the handle has focus): Left arrow widens by 24 px, Right arrow narrows by 24 px, Home = minimum (360), End = current maximum (960 on a wide window). Each key press persists.
  - Double-click: reset to 572 and persist.
  - Window resize re-clamps the width.
  - Persistence: `localStorage` key `questions-to-insights:right-panel-width`, value the integer pixel width as a string; written when a drag ends and on every keyboard/reset change; read once at start-up (non-numeric or missing -> 572; out-of-range values clamped).
- Right panel bodies by main view: see the table in 1.4. Open/closed state is session-only (not persisted); only the width is remembered.

### 1.6 Modes and permission-based visibility

Rules: [../capabilities/admin/spec.md](../capabilities/admin/spec.md) R2, R5, R11, R24-R26, R70, R71 and [../capabilities/app-shell/spec.md](../capabilities/app-shell/spec.md) R50.

- **Both modes:** the renderer loads the current user (`GET /me`, [api.md](api.md) 2.13) before anything else; until it answers only the frame (1.2) shows. A 401 shows the sign-in page (4.17) in place of the whole shell, and the `mode` in the 401 body picks its variant: `org` the org server variant, `local` the local mode variant (4.17.1). Otherwise the shell renders with the user's permissions. When the backend can't be reached it retries like the session list (1.4: 12 times, 200 ms steps capped at 1 s), then shows the sign-in page with "Backend unreachable" and **Retry** (4.17), never the shell. Any later 401, from any call (the streamed chat and knowledge calls included), forgets the local token (below) and replaces the shell with the sign-in page.
- **Local mode:** the renderer keeps the token answered by `POST /auth/local/sign-in` ([api.md](api.md) 92) in `localStorage` under `questions-to-insights:local-session`, and sends it as `Authorization: Bearer <token>` on every API call, the streamed chat and knowledge calls and file downloads included. **Sign out** calls `POST /auth/local/sign-out`, forgets the token and shows the sign-in page.
- **Org server mode:** the auth session is the `qti_session` cookie; the renderer holds no token.
- Controls hidden, not disabled, when the user lacks the permission:

  | Permission | Hidden without it |
  |---|---|
  | `create-agents` | Agent Hub **New agent** (4.4); in the skills library **New skill**, and in the skill editor **Save** and **Delete** (4.5.2, 4.5.3); in a user agent's detail **Edit**, **Publish** and **Delete** (4.5); in the Evals tab the question checkboxes, **Select all**, the datasource picker with **Run <n> selected**, and the **Executions** sub-tab (the question list stays readable) |
  | `manage-datasources` | Datasets list **New dataset** and each row's options button (`Options for <name>`), whose menu holds only **Delete dataset** (4.2); in the catalog browser the **Dataset name** field and **Save dataset (<n>)** (4.3; rows still open it, so metrics stay reachable); Settings **Datasource Configuration** and **Testing Data** |
  | `manage-llm` | Settings **LLM Configuration**; the New-session composer's **Reasoning effort** dropdown (4.7) |
  | `edit-policies` | Settings **Developer**; in the built-in skill editor **Save** and **Reset to built-in** (4.5.4); on a built-in agent's System Prompt tab **Edit** and **Reset to built-in** (4.5.11) |
  | `manage-users` | Rail **Admin** (1.3) |

  The Settings list keeps its order with the hidden sections left out; **Appearance** is always there. A Settings section that becomes hidden while chosen falls back to "Choose a settings section.".
- **403:** any call answered with HTTP 403 raises the error toast `You don't have permission to do this.` (instead of the server message) and leaves the view as it is. The error the view receives carries the same message, so a view that reports it too says the same thing, and the toast shows once while it is visible.

## 2. Loading, empty, error and confirmation conventions

These patterns repeat across screens; each screen section only notes deviations.

- **Loading**: a 16 px spinning loader icon (`animate-spin`, `Loader2`) + a sentence ending in an ellipsis (`Loading datasets…`), `fg-muted`, 40 px below the header. Buttons that start an action swap their label for a spinner + present participle (`Saving…`, `Testing…`) and are disabled.
- **Error**: an inline block, `danger-soft` fill, `on-danger-soft` text, 13 px, radius 6, padding 12 x 10, containing the server's message (or a fallback). Transient failures of actions additionally raise an error toast (see 5.3). The standard fallback text for an unreachable backend is `Backend unreachable`.
- **Empty**: a muted (`fg-muted`, 13 px) sentence, or for first-run on a major list a dashed `border` bordered card with an icon tile, a title and a short explanation plus the primary actions.
- **Disabled primary action**: the `btn` at 55 % opacity, `cursor: not-allowed`; explained by a `title` tooltip ("Name the session and select at least one dataset").
- **Destructive confirmation**: native `window.confirm` dialogs for deleting a session, datasource, metric, knowledge snippet or user agent and rejecting a suggestion (exact texts in section 7). Inline confirm panels (amber warning icon + sentence + **Confirm** / **Cancel**) for the testing-data load/remove actions (4.11). Deleting a dataset has no confirmation (its menu item is the commit).
- **Row action menus**: a small `menu` popover (width 176) opened from an ellipsis button, closed by clicking an invisible full-screen backdrop; items are `menu-item`s (13 px with an icon); the destructive item is `on-danger-soft`.
- Buttons are the shared pills (3.6): the one main action of a view (create, save, run, load) is `btn btn-primary`; supporting actions such as "Test connection" are `btn btn-secondary`; tertiary ones (Cancel, Export, Reject-style outlines) `btn btn-outline` or `btn btn-ghost`; destructive ones `btn btn-danger`.

## 3. Shared components

### 3.1 Backend status banner

A full-width 28 px strip above the whole layout, bottom border `border`, 12 px medium text centred. Visible only while the desktop shell reports the backend as `restarting` or `down`:

| Status | Fill / text | Message |
|---|---|---|
| `restarting` | `warning-soft` / `on-warning-soft` | `Backend restarting…` |
| `down` | `danger-soft` / `on-danger-soft` | `Backend unavailable — restart the app` |
| `starting`, `ready` | not shown | — |

Status comes from the desktop bridge's `backend-status` events (see [api.md](api.md), desktop bridge). Without the bridge (plain browser / web mode) the status stays `ready` and the banner never shows. Behaviour: [../capabilities/app-shell/spec.md](../capabilities/app-shell/spec.md).

### 3.2 System logs panel

Modal overlay opened from the rail's System logs button; behaviour and redaction rules in [../capabilities/diagnostics/spec.md](../capabilities/diagnostics/spec.md).

- A full-screen scrim (`fg-strong` at 40 % opacity, 1 px blur; the scrim itself is a button `aria-label="Close system logs"`) and a dialog (`role="dialog"`, `aria-modal="true"`, `aria-labelledby` the title) positioned 24 px from left/right/bottom and 64 px from the top, centred, max width 1100, `surface` fill, `border` border, radius 16, `shadow-2xl`.
- **Header**: 32 px rounded `surface-muted` tile with the scroll-text icon (`fg`); `h2` "System logs" (14 px medium `fg-strong`) with a dot + "LIVE" (10 px, `on-success-soft`); caption "Desktop, interface, backend, and AI runtime diagnostics" (11 px, `fg-muted`). Right: **Refresh logs** icon button (`aria-label`/title "Refresh logs", the icon spins while loading), **Export** button (`primary` fill, `on-primary` text, 12 px medium; download icon, label "Export", becomes "Exporting…" and disables while running), **Close system logs** icon button (X, title "Close").
- **Toolbar**: filter pills `All <n>` and `Issues <errors+warnings>` (radius 6; selected = `surface-selected` fill + `fg` text, otherwise `fg-muted`), counts `<n> errors` (`on-danger-soft`) and `<n> warnings` (`on-warning-soft`), then right-aligned: a search field (type=search, `aria-label="Search system logs"`, placeholder `Search messages or sources`, width 256), checkbox **Group by run** (title "Group entries by backend process run", default on), checkbox **Follow** (default on; keeps the list scrolled to the newest entry).
- **Latest issue card** (only when an error or warning exists): warning card (`warning-soft` fill, `on-warning-soft` border at 30 % opacity) with a triangle-alert icon (`on-warning-soft`), "Latest issue · <time>", the message on one line and the plain-language source explanation.
- **Entry list** (monospace, scrollable): a row = time (86 px, `fg-muted`), level badge (52 px, upper case: ERROR `danger-soft`/`on-danger-soft`, WARN `warning-soft`/`on-warning-soft`, DEBUG `info-soft`/`accent`, INFO `surface-muted`/`fg-muted`), source (128 px, `fg-muted`, truncated, tooltip = full source), message. Each row is an expandable disclosure; expanded it shows the plain-language explanation of the source and, when present, the entry's details (JSON or text, pretty-printed, in a `surface-muted` box, max height 224, scrollable).
  - Source explanations: `user-visible` -> "An operation shown in the app failed."; `backend:mastra…` -> "The AI agent runtime reported this event."; `backend…` -> "The local data and backend service reported this event."; contains `renderer` -> "The application interface reported this event."; `electron…` -> "The desktop application shell reported this event."; anything else -> "A system component reported this event."
  - **Group by run** (default): entries are bucketed into backend process runs (a change of the backend's process id marks a new run). Each run is a collapsible group with summary "Run <n>", "PID <pid>", time span, "<n> shown", `danger-soft` / `warning-soft` count chips ("<n> errors", "<n> warnings") and, when its start has aged out of the retention window, "started before this window". The newest run is open and older runs collapsed; while a search or the Issues filter is active every surviving run is open. Entries recorded before any backend process identified itself appear above the groups as a flat list.
  - Empty / no match: centred scroll-text icon, "No matching log entries", "New application events will appear here automatically."
- **Footer**: left "Up to 2,000 recent entries are retained. Logs are redacted before export." right "Expand a row for context and stack details."
- Export success raises the toast `Exported <n> diagnostic entries`; failure raises an error toast with the message or `Diagnostics export failed`. In the desktop app the export writes a file chosen via a native dialog; in a browser it downloads `questions-to-insights-diagnostics-<YYYY-MM-DD>.md`.
- Close by the Close button, the scrim, or (dialog semantics) assistive-technology dismissal; focus handling in section 8.

### 3.3 Toast container

Fixed stack at bottom-right (16 px from right and bottom, width 360, 8 px gap, above all content; the container ignores pointer events, each toast accepts them). The stack is a `section` named "Notifications" with `aria-live="polite"`. Each toast: `surface` fill, 1 px `border`, radius 12, `shadow-xl`, padding 14 x 12, a 16 px kind icon, the message (13 px, line height 20, `fg`) and a dismiss "X" button (14 px, title and `aria-label` "Dismiss notification").

| Kind | Icon (colour) | Auto-dismiss |
|---|---|---|
| `success` | circle-check (`on-success-soft`) | 4000 ms |
| `info` | info (`accent`) | 4000 ms |
| `error` | circle-alert (`on-danger-soft`) | 8000 ms |

Toasts stack in creation order; the X dismisses immediately. Every **error** toast is also recorded as a diagnostic entry with source `user-visible` (it therefore shows up in the system logs and in the issue badge).

### 3.4 App logo

The "HALO BI" wordmark as a vector drawn with 13-unit strokes in `currentColor` (butt caps, mitre joins) in a 573 x 113 viewBox: H, a crossbar-less A (chevron), L, an O with a small "halo" notch/gap at the lower right, B, I. Rendered by cap height (`height` input, default 14; width = round(height x 573 / 113)); `role="img"`, `aria-label="Halo BI"`. No longer shown in the shell since roadmap 1.8.3, where the banner's "Agentic Hub" text replaced it. The component stays for the brand files. Brand files in `public/brand/`: `halo-bi-wordmark.svg`, `halo-bi-mark.svg` (1024 square, near-black rounded square r=185 with a white halo ring and the letters "BI" inside), `icon.png` (apple-touch / app icon); the page favicon is `favicon.ico` plus the SVG mark.

### 3.5 Markdown rendering

Assistant text, report bodies and visual cards render Markdown (GitHub-flavoured: tables, task lists, strikethrough; single newlines become line breaks) to HTML, then sanitise it with an HTML allow-list sanitiser (standard HTML profile; scripts, event-handler attributes and unknown protocols are stripped) before it is inserted into the page. Raw HTML in the source is therefore never executed. Styling ("prose-dark", name kept; it follows the theme): 16 px, line height 24 px, `fg` text; strong `fg-strong`/600; links `primary` underlined; h1 16, h2 15, h3/h4 14 px (600, `fg-strong`, 1.1 em top margin); lists 1.4 em indent (disc / decimal); inline code 12 px monospace on `surface-muted`, radius 4; code blocks on `surface-muted` with a `border` border, radius 8, horizontal scroll; blockquote with a 2 px `border` left rule and `fg-muted` text; tables full width, 14 px / 20 px, a 1 px `border` frame with radius 12 and `border` cell rules, 48 px rows with 16 px cell padding, header `surface-muted` fill and `fg` 500 text, first column 600, no wrapping. The visual frame inside the sandboxed iframe uses its own stylesheet; see [../capabilities/visuals/spec.md](../capabilities/visuals/spec.md).

### 3.6 Shared component classes

Pieces every restyled screen uses, defined as Tailwind v4 `@utility` classes in `frontend/src/styles/components.css`. They are built only from the theme tokens (6.0), so each one follows Light and Dark. Combine a base class with a variant.

| Class | Looks like | Use for |
|---|---|---|
| `btn` + `btn-primary` | Pill (radius full, 40 px tall, 16 px horizontal padding, 14 px medium, 0.07 px letter spacing), `primary` fill, `on-primary` text, `primary-hover` on hover | The main action of a view ("Approve and publish", "Save", "Create") |
| `btn` + `btn-secondary` | Pill, `primary-soft` fill, `on-primary-soft` text | Secondary actions ("Request changes", "Test connection") |
| `btn` + `btn-outline` | Pill, `surface` fill, `border-strong` border, `on-primary-soft` text | Tertiary actions ("Reject", "Export") |
| `btn` + `btn-ghost` | Pill, no fill, `fg-muted` text, `surface-muted` on hover | Low-emphasis actions in toolbars |
| `btn` + `btn-danger` | Pill, `danger-soft` fill, `on-danger-soft` text | Destructive actions ("Delete") |
| `btn-icon` | Square 6 px padding, radius 8, `fg-muted` icon, `surface-muted` on hover | Icon-only controls; always with a title or `aria-label` |
| `chip` + `chip-warning` / `chip-info` / `chip-neutral` / `chip-success` / `chip-danger` | Pill, 12 px medium, the matching `*-soft` fill and `on-*-soft` text | Statuses ("Pending review", "Restricted", "Read", "Passed", "Failed") |
| `card` | `surface` fill, 1 px `border`, radius `card` (12), `card` shadow | Page cards, panels, form groups |
| `card-muted` | `surface-muted` fill, 1 px `border-strong`, radius 12 | Summary boxes inside a card |
| `list-row` / `list-row-selected` | Full-width row, 1 px `border`, radius 12, `surface-muted` on hover; selected: `surface-selected` fill, `border-selected` border | Master-detail lists (sessions, settings sections, agents) |
| `filter-pill` / `filter-pill-active` | Pill, `border-strong` border, `primary` text; active: `surface-selected` fill, `border-selected` border, `on-primary-soft` text (`primary` on the selected fill is below 4.5:1 in dark) | Filters and counts ("Pending review · 2") |
| `field` | `surface` fill, 1 px `border`, radius 8, `fg` text, `fg-muted` placeholder; focus: `border-selected` border and a 2 px `surface-selected` ring | Text inputs, selects, textareas |
| `field-label` | 12 px medium `fg-muted` | Field and group labels |
| `section-header` / `section-title` | Row with a bottom `border`, 16 × 28 px padding; title 22 px normal `fg-strong` | Page headers ("Datasets" + its actions) |
| `menu` / `menu-item` | `surface` popover, 1 px `border`, radius 12, soft shadow; items 13 px `fg`, `surface-muted` on hover | Dropdowns and context menus |

Page titles use 24 px / 32 px line height, light weight, `fg-strong` (the Figma `heading/medium-alt` style); see the page header in 1.2.

Focus: buttons show a 2 px `focus` outline offset by 2 px on keyboard focus. Disabled buttons and fields drop to 55–60 % opacity with a not-allowed cursor.

## 4. Screens and panels

Page titles on content views are `h2` elements, sans, 24 px / 32 px, light weight, `fg-strong` (agent detail too; same style as the Sessions page header, 1.2). Settings form titles are `h2` sans 15 px semibold `fg-strong` with a 12 px `fg-muted` subtitle. Buttons are the shared `btn` pills (3.6) unless stated.

### 4.1 Home (empty)

Purpose: neutral landing state at launch. Contents: the empty main area and the placeholder composer box (1.2); right panel shows Entity details' empty state (4.14). No actions. States: none.

### 4.2 Datasets list

Capability: [datasets](../capabilities/datasets/spec.md).

- Header "Datasets". Under it a filter pill row (`All`, `Pinned`, `Yours`, `Shared with you`; `All` selected by default) and on the right three icon buttons/actions: a search `btn-icon`, a layout-grid `btn-icon` with a `border-strong` border, and a `btn btn-primary` **New dataset** (plus icon). The filter pills are 13 px buttons (radius 8) whose selected state is a `surface-selected` fill with `fg` text, otherwise `fg-muted`. Only `All` and **New dataset** are functional today; the other filters and the two icon buttons are placeholders. Open question: intended behaviour of Pinned / Yours / Shared and search.
- Datasets are grouped under month headings (full month name, e.g. "October"; "Earlier" when there is no date), newest first. A row (`data-testid="dataset-<name>"`) shows a 40 px rounded `surface-muted` icon tile (workflow icon, `fg-muted`), the dataset name (14 px, `fg`) and, right-aligned, a lock icon and "Edited <Mon D> · <PostgreSQL | Databricks> · <n> entities". Clicking opens the dataset in the catalog browser (4.3). Rows highlight with `surface-muted` on hover. An ellipsis `btn-icon` opens a `menu` with a **Delete dataset** `menu-item` (`on-danger-soft`, trash icon).
- States: loading `Loading datasets…`; error inline (`danger-soft` block, `on-danger-soft` text); empty `No datasets yet — create one with “New dataset”.`; populated as above. Delete toasts the server message (success or error).

### 4.3 Catalog browser ("New dataset" / "Edit dataset")

Capability: [datasets](../capabilities/datasets/spec.md), data from [datasources](../capabilities/datasources/spec.md).

- Header: title "New dataset" or "Edit dataset", subtitle "Catalogs, schemas and entities available through the selected datasource.", and (when editing) "Updated <date>". Right-aligned controls: a **Datasource** `field` select (`aria-label="Datasource"`, options "<name> · <PostgreSQL|Databricks>", "No datasources" when empty), a **Refresh inventory** `btn btn-outline` icon button (`aria-label="Refresh inventory"`, title "Re-read catalogs, schemas and entities from the datasource", spinning while loading), a `field` text input (placeholder `Dataset name`, width 220) and the `btn btn-primary` **Save dataset (<n>)** button where n = included entity count (disabled until a datasource is selected, at least one entity is included and a name is typed; tooltip "Name the dataset and include at least one element"; shows "Saving…").
- Body states:
  - *Awaiting choice* (nothing is read until requested): text "Pick the datasource you want to browse, then load its entities." and the hint "Nothing is read until you load, so a sleeping Databricks warehouse never blocks switching to another datasource." with a `btn btn-primary` **Load entities from <datasource label>** (play icon, `data-testid="load-inventory"`).
  - *Loading*: spinner + `Loading inventory from <datasource label>…`, hint "The first load can take a while if the Databricks warehouse is starting up. You can switch datasource above at any time." and a `btn btn-outline` **Cancel** button.
  - *Error*: inline `danger-soft` block (e.g. `No datasource configured. Add one in Datasource Configuration first.`).
  - *Empty*: `No accessible catalogs found.`
  - *Populated*: a filter `field` (search icon, placeholder `Filter catalogs, schemas and entities…`, a **Clear filter** X button when non-empty; no matches -> `No catalogs, schemas or entities match “<query>”.`) and a three-level tree: catalog rows (database icon `accent`, monospace name, "<n> schemas"), schema rows indented 24 px (folder-tree icon `on-warning-soft`, "<n> entities"), entity rows indented 56 px (table icon `on-success-soft`, "<n> columns"). Rows carry `data-testid` `catalog-<name>`, `schema-<catalog>-<schema>`, `table-<catalog>-<schema>-<table>`. Clicking a catalog/schema toggles its expansion (chevron rotates 90 degrees) and selects it for the right panel; clicking an entity selects it. The trailing indicator shows inclusion: circle-check `on-success-soft` = fully included, circle-minus `on-warning-soft` = partially included, lock `fg-muted` = not selectable (the row is dimmed).
  - Below the tree, separated by a rule, the Metrics panel (4.15) scoped to the included entities.
- Selecting a node re-opens the right panel on its details (4.14), which hosts the include/remove toggle.

### 4.4 Agent Hub

Capability: [agents-evals](../capabilities/agents-evals/spec.md) (R1-R4, R53). The look follows the theme tokens (section 6), the shared classes (3.6) and the Datasets list.

- **Header row:** the page title `h2` "Agents" (24 px light, `fg-strong`, as on the other list screens) and, right-aligned, 8 px apart, the **Skills** `btn btn-secondary` (book-open icon, `data-testid="agent-skills-library"`), which opens the skills library (4.5.2), and the **New agent** `btn btn-primary` (plus icon, `data-testid="agent-new"`), which opens the agent editor (4.5.1).
- **Search row** (20 px below the header): a full-width `field` search bar (`type="search"`, `data-testid="agent-search"`, placeholder and `aria-label` `Search agents by name or description`, a 15 px `fg-muted` search icon inside on the left, 40 px left padding). Filtering applies on every keystroke.
- **Filter row** (12 px below the search), left-aligned, 8 px apart: a group (`role="group"`, `aria-label="Filter agents"`) of `filter-pill` buttons `All`, `Pinned`, `Official` and `Mine`; the selected one adds `filter-pill-active`. Each has `aria-pressed`; `All` is selected when the hub opens.
- **Sections**, 24 px apart. Under All: Official, Mine, System, in that order (`data-testid="agent-section-<official|mine|system>"`); there is no Pinned section under All, and a pinned card stays in its own section. The Pinned filter shows one section instead (`data-testid="agent-section-pinned"`) with every pinned agent, ordered by kind (Official, Mine, System) then name. Each is a `section` (`aria-labelledby` its heading); the heading is an `h3` uppercase micro-heading (12 px medium, tracking wider, `fg-muted`) reading `Official`, `Mine`, `System` or `Pinned`. Within a section, pinned cards come first, then the others, each group alphabetical; each agent appears once in any view, so `agent-<key>` stays unique. Under it, cards in a 3-column grid (`gap` 12 px); only the first row shows until expanded. When more cards are hidden, a small `btn btn-ghost` follows the grid: `Show more (<n>)` (chevron-down) or, expanded, `Show less` (chevron-up), 12 px, `aria-expanded`, `data-testid="agent-show-more-<section>"`. Which sections show for each filter, and when a section is omitted (empty sections, and Mine when there are no user agents): R1-R2.
- **Card** (`data-testid="agent-card-<key>"`): a `card` `div` (hover border `border-strong`), full height of its grid row. It holds two sibling controls, never one inside the other:
  - the **open control**: a `button` (`data-testid="agent-<key>"`, padding 16) covering the card's text, which opens the detail (4.5). Inside it, top to bottom: the top row with a 32 px icon tile (radius 8, `primary-soft` fill, `sparkles` 15 px `on-primary-soft`), which it shares with the pin toggle on the right; the name on its own line below (14 px medium `fg-strong`, one line, truncated, so it gets the card's full width at three cards to a row); the description (12 px `fg-muted`, at most 2 lines, clamped with an ellipsis; nothing when empty); a footer row with the owner (`Owner: You` / `Owner: Official` / `Owner: System`, 12 px `fg-muted`) and, for user agents, the status `chip` (`data-testid="agent-status-<key>"`: `Draft` = `chip-neutral`, `Live` = `chip-success`) and the `Unpublished changes` `chip chip-warning`; and, when datasets are missing, a `chip chip-warning` note (`triangle-alert` 12 px and `Missing dataset: <names>`). Keyboard focus on the open control shows a 2 px `focus` outline around the whole card.
  - **Start chat** (Official and Live user agents only; capability R53): a third sibling control at the bottom-right of the card, a small `btn btn-secondary` (12 px, `message-square-plus` icon, text `Start chat`, `aria-label` `Start chat with <name>`, `data-testid="agent-start-chat-<key>"`). It is disabled while the session is being created, and when none of the agent's datasets exist, with the title `None of this agent's datasets exist`. On an Official agent that declares a dataset (the RFP Builder) it is disabled while that dataset is missing, with the agent's requirement (`chatRequirement`) as its title: `Load the "Intellify RFP API" sample in Settings → Testing Data first` (capability R53). It never opens the detail.
  - the **pin toggle**, on the right of the top row, level with the icon tile: a small rounded-full `button` (12 px medium, `primary` text, padding 8 x 2, hover `surface-muted`) with `aria-pressed`, `aria-label` `Pin <name>` / `Unpin <name>` and visible text `Pin` (`pin` icon) or `Pinned` (`pin` icon, `surface-selected` fill; on hover or focus the icon becomes `pin-off`). It applies at once, re-ordering the card within its own section (never moving it to another section or hiding one), and reverts with an error toast if the save fails (R4).
- **States:** loading `Loading agents…` (section 2); error inline (server message or `Backend unreachable`); no match `No agents match "<query>"`; the Pinned filter with nothing pinned `No pinned agents yet.` (no section shown); the Mine filter with no user agents `No agents of yours yet.` (all `fg-muted` 13 px, 40 px below the filter row). The search text, filter and expanded sections reset each time the hub opens.

### 4.5 Agent detail

Capability: [agents-evals](../capabilities/agents-evals/spec.md); agent catalogue in [agents.md](agents.md).

- A **All agents** `btn btn-ghost` back button (arrow-left icon) that returns to the hub (4.4), then a header: 44 px `surface-muted` bot tile, page title `h2` (agent name, 24 px light) with the agent id in monospace beneath, and the description (max 70 ch). For a user agent the id line also carries its status chip and `Unpublished changes` chip (the hub's card chips; `data-testid="agent-detail-status"`). States: `Loading agent…`, error inline.
- **Actions** (capability R5, R53), right-aligned in the header, 8 px apart:
  - **Start chat** (`data-testid="agent-start-chat"`, `message-square-plus` icon, `btn btn-primary`), for the Official agents and Live user agents. It reads `Starting…` while the session is created, and is disabled, with the title `None of this agent's datasets exist`, when none of them exist. On a Live agent it opens the new session (toast `Session "<name>" created`); on the Official assistant it opens the New-session composer (4.7); on the RFP Builder it opens a new session over its `Intellify RFP API` dataset (toast `Session "RFP Builder" created`), and while that dataset is missing it is disabled with the agent's requirement as its title (4.4). When **Publish** is also shown, **Publish** becomes `btn btn-secondary` so there is one primary action.
  - **Publish** (`data-testid="agent-publish"`, `upload` icon, `btn btn-primary`), shown only when the agent has no Live version or has unpublished changes. While in flight it reads `Publishing…` with a spinner and is disabled. It toasts the server's message (`Agent "<name>" is Live`, or the refusal) and on success reloads the detail.
  - **Delete** (`data-testid="agent-delete"`, `trash-2` icon, `btn btn-danger`). It asks a native confirm: `Delete "<name>"?` + blank line + `Its sessions keep their transcripts and continue with the assistant.` While in flight it reads `Deleting…`. Success toasts `Agent "<name>" deleted` and returns to the hub; failure toasts the server's message and stays.
  - **Edit** (`data-testid="agent-edit"`, `pencil` icon, `btn btn-secondary`), user agents only, between **Start chat** and **Publish**. It opens the agent editor (4.5.1) on the draft.
  - System agents show no actions; each Official agent (the assistant and the RFP Builder) shows only **Start chat**.
- Underlined tab strip (bottom `border`; the active tab has a `border-selected` underline and `fg-strong` text, others `fg-muted`), each tab icon + label, `data-testid="agent-tab-<id>"`: **Chat Box** (`chat`, message-square; not for System agents; 4.5.8), **System Prompt** (`prompt`, scroll-text; was Prompt template), **Skills (<n>)** (`skills`, book-open; `<n>` counts the agent's skills; for a user agent the skills its draft links plus the built-in skills it gets), **Tools (<n>)** (`tools`, wrench), **Graph** (`graph`, git-fork; user agents only), **Memory** (`memory`, brain), **Evals** (`evals`, gauge), **LLM Config** (`model`, the id the Model tab had, cpu), in this order. Default tab: Chat Box for user agents and the Official agents, System Prompt for System agents.
  - *Chat Box*: see 4.5.8.
  - *System Prompt*: the agent's static instructions in a monospace pre block on `surface-muted`; if none: "This agent builds its prompt at request time, so there is no static template to show." For a user agent: the assistant's prompt in that block, then an `h3` uppercase micro-heading `Agent instructions` (12 px, `fg-muted`) and a second block on `surface-muted` with the agent's instructions (Live version, else draft) as read-only text with each link shown as a chip (4.5.5), or the muted `No instructions yet.` The layout of a user agent's tab, with its collapsed core prompt and its edit state, is 4.5.9; a built-in agent's, with its edit state, is 4.5.11.
  - *Tools*: a `surface-muted` box per tool (wrench, monospace name, description, input names as chips); none: "This agent runs in a single step with no tools." For a user agent the list is the whole tool library, sorted by name, and each box also carries a status `chip` (`Always on`, `Linked` as `chip-info`, `Not linked` muted; `data-testid="agent-tool-status-<name>"`) and, for a linked tool, a 12 px `fg-muted` line `Linked from the instructions` and/or `Linked by <skill names>` (capability R87).
  - *Graph*: user agents only; see 4.5.6.
  - *Skills*: read-only for the Official and System agents (agents-evals R63-R67); a user agent's tab is the inline library of 4.5.10. The skills load with the agent; the tab reads `Skills` until they have loaded. While loading, the tab shows a `Loading skills…` line; if loading fails, it shows the error text in `on-danger-soft`, as the page's other errors do.
    - For a user agent, a muted 12 px line comes first: `This agent runs on the assistant, so it uses the assistant's skills.`
    - With no skills, the muted text `This agent has no skills.` Otherwise one bordered row per skill, sorted by name (`data-testid="agent-skill-<name>"`). A row shows a monospace name, a level pill (`Built-in`, or `In-app` on a user agent's own skills; `surface-muted`) and a loading pill (`On demand` or `Loaded by the app`). The description follows in `fg-muted`.
    - Clicking a row expands it (`aria-expanded`), and clicking again collapses it. The expanded row shows the file list and the selected file's content side by side when the row is at least 42 rem wide, and stacked (list above content) when it is narrower, e.g. with the Details panel open. The file list has one button per file (`data-testid="skill-file-<path>"`), indented one step per folder level, monospace 12 px, the selected one `fg-strong` on `surface-muted`. The selected file's content sits in a monospace pre block on `surface-muted`. `SKILL.md` is selected when the row opens. A file without content shows the muted text `This file isn't shown: it is larger than 256 KB or isn't text.`
  - *Memory*: key/value rows "Recent messages replayed" (`Disabled` / `Default` / `<n> messages`), "Semantic recall", "Working memory", "Auto-generated titles" (`Enabled` / `Disabled`), "Storage" (monospace, when present); no memory: "This agent is stateless — no memory is configured."
  - *LLM Config*: read-only; see 4.5.7.
  - *Evals*: when sets exist (or the Executions view is active) a sub-tab pair **Questions** / **Executions** (selected = `surface-selected` fill, `fg` text; `eval-subtab-questions`, `eval-subtab-runs`).
    - *Questions*: caption "QUESTION SETS" and a list of set buttons (radius 12, 1 px `border`; open = `surface-selected` fill and `border-selected` border) (`eval-set-<id>`, `aria-pressed`, chevron rotates when open, list-checks icon, name, "<n> questions", description). Opening a set reveals "<n> questions in <set name>. Each check must score 1.0 for its question to pass.", a datasource `field` select (`eval-datasource-select`, `aria-label="Datasource to run the evals against"`, options "<name> · <kind>", "No datasources configured"), the `btn btn-primary` run button (`eval-run`; "Run <n> selected", "Running…" with spinner), progress "<done>/<total> done · <passed> passed" once a run has started, "Scoped to <datasets>", a run error block, a **Select all** checkbox (`eval-select-all`) and one row per question: a checkbox (`eval-select-<caseId>`, `aria-label="Run: <question>"`), a button (`eval-case-<id>`, `aria-pressed`) with index, question, a verdict label (`passed` `on-success-soft` / `failed` `on-danger-soft` / `running` `fg-muted` spinner; `eval-result-<id>`), the intent, an optional error and check chips (`surface-muted`, gauge icon, description, score once run); each question row is a `surface-muted` box with a `border-selected` border when selected. Selecting a case shows it in the right panel's eval trace (4.6). Controls are disabled while a run is in flight.
    - *Executions*: `Loading executions…`; none: "No eval runs yet — run the suite from the Questions tab."; else a `surface-muted` card per run (`eval-run-<jobId>`): status icon (spinner / `on-success-soft` check when all passed / `on-danger-soft` X), "<passed>/<total> passed", "<started> · <datasource name> · <duration>", a **Download run <id> as Markdown** icon button (title "Download as Markdown", `eval-run-download-<id>`), and (when not running) a **Delete run <id>** icon button (`btn-icon`, `on-danger-soft` on hover). Expanding shows "Scoped to <datasets>" and result rows (`eval-run-result-<job>-<case>`: pass/fail icon, question, duration in ms) which load the trace into the right panel.
    - Empty / error: `Loading evals…`, inline error, "No evals configured for this agent yet."
  - Toasts: `Eval report downloaded`; failure `Could not download the report`.

#### 4.5.1 Agent editor and preview chat

Capability: [agents-evals](../capabilities/agents-evals/spec.md) R54-R61. A content view (1.4) of max width 960.

- **Header:** a **Back** `btn btn-ghost` (arrow-left icon); then the page title `h2` (24 px light): `New agent`, or `Edit <name>` (also after the first save of a new agent, with the saved name), with the agent's status `chip` and `Unpublished changes` chip beside it once the agent exists (`data-testid="agent-editor-status"`). Right-aligned, 8 px apart:
  - **Preview** (`data-testid="agent-preview"`, `message-square` icon, `btn btn-secondary`), which opens the Details panel on the preview chat;
  - **Save** (`data-testid="agent-save"`, `save` icon, `btn btn-secondary`; `Saving…` in flight; disabled with a blank name, no changes, or in flight). Save or Publish with a blank name toasts `Agent name is required` without calling the backend;
  - **Publish** (`data-testid="agent-editor-publish"`, `upload` icon, `btn btn-primary`; `Publishing…` in flight), shown per R57.
- **Form** (a `card`, padding 24, fields 20 px apart, each a `field-label` above a `field`): **Name** (`maxlength` 64), **Description** (`maxlength` 280, one line), **Instructions** (the link editor, 4.5.5: a `role="textbox"` of at least 8 rows, monospace 13 px, `aria-label="Instructions"`; the hint `Added to the assistant's context in every turn. The assistant's own rules and the read-only guard still apply. Type / to link a skill or a tool.` above it and, under it in 12 px `fg-muted`, `Linked skills and tools decide what the agent gets. Every agent also gets the built-in skills and can always list, describe and query its datasets.`, the counter `<n>/4,000`, the buttons **+ Link skill** and **+ Link tool**, and, for a legacy agent (R85), the notice `Links were added for what this agent had. Save to keep them.` in an `on-warning-soft` block), **Datasets** (a `fieldset` with the legend `Datasets`, one checkbox row per dataset, labelled with its name; a missing one reads `<name> (missing)` in `on-warning-soft`), **Starter questions** (a `fieldset` with the legend `Starter questions`, one `field` per question (`aria-label="Starter question <n>"`, `maxlength` 200), each with a `btn-icon` **Remove starter question** (x icon, title `Remove starter question`, accessible name `Remove starter question <n>` from visually hidden text, so it never matches the field's label), then a `btn btn-ghost` **Add starter question** (plus icon)), and a row with **Model** (a text `field`, placeholder per R55) and **Reasoning effort** (a `field` select: `Default`, `Low`, `Medium`, `High`).
- **Unsaved changes:** leaving asks with the native confirm `Discard unsaved changes?`.
- **Preview chat** (the Details panel body while the editor is open): a 48 px header with the micro-heading `Preview` and a **Reset preview** `btn btn-ghost` (rotate-ccw icon, `data-testid="agent-preview-reset"`), then the Session chat (4.12) of the preview session, at the panel's width. Its welcome card follows 4.12 with the draft's description and starter questions. With no existing dataset in the draft, the body shows instead, in 13 px `fg-muted`: `Select at least one dataset to preview`, and no composer. While the preview session is being created: `Starting preview…`. If it can't be created, the server's message shows in an inline `danger-soft` block. **Reset preview** is enabled only while a preview is running or has failed. Opening the Details panel on the editor in any way (Preview, or *Expand right panel*) shows the preview chat and starts it, saving the form first when it has unsaved changes and a name.

#### 4.5.2 Skills library

Capability: [agents-evals](../capabilities/agents-evals/spec.md) R68, R69, R74. A content view (1.4) of max width 960.

- **Header:** a **Back** `btn btn-ghost` (arrow-left icon, returns to the hub); the page title `h2` "Skills" (24 px light, `fg-strong`); right-aligned, **New skill** (`data-testid="skill-new"`, plus icon, `btn btn-primary`), hidden without Create agents.
- **Sections:** **Your skills**, then **Built-in · included in every agent** (agents-evals R75), each a section heading (13 px semibold `fg-muted`, as the hub's section headings) above its own `card`. Built-in rows (`data-testid="builtin-skill-row-<name>"`) show the name, a `chip` `On demand` or `Loaded by the app`, a `chip chip-warning` `Modified` when overridden, the description, and under it in 12 px `on-warning-soft` the drift notice of R79 when it applies.
- **List:** a `card` with one row per skill (`data-testid="skill-row-<name>"`), 16 px padding, `border-b border-border` between rows, the whole row a button that opens the skill editor: the name in 14 px `fg-strong` monospace, the description in 13 px `fg-muted` (two lines at most, then an ellipsis), and on the right in 12 px `fg-muted` `Used by <names>` or `Not used by any agent`.
- **Empty:** `No skills yet. A skill is know-how an agent reads when a question needs it.` in 13 px `fg-muted`, centred in the card. While loading: `Loading skills…`. A load error shows the server's message in an inline `danger-soft` block.

#### 4.5.3 Skill editor

Capability: [agents-evals](../capabilities/agents-evals/spec.md) R70-R73. A content view (1.4) of max width 960.

- **Header:** **Back** `btn btn-ghost` (arrow-left icon, returns to the library); the title `h2`: `New skill`, or `Edit <name>` once saved; right-aligned, 8 px apart, **Delete** (`data-testid="skill-delete"`, trash-2 icon, `btn btn-danger`; saved skills only) and **Save** (`data-testid="skill-save"`, save icon, `btn btn-primary`; `Saving…` in flight; disabled with no changes or in flight).
- **Form** (a `card`, padding 24, fields 20 px apart, each a `field-label` above a `field`): **Name** (`maxlength` 64, monospace), **Description** (`maxlength` 300, two rows, with the hint under it in 12 px `fg-muted` and a character count `<n>/300`), then **What the agent sees** (a `micro-heading` above a `surface-muted` block, radius 8, padding 12, monospace 12 px: the name on one line and the description under it), **Body** (the link editor, 4.5.5, tools only: `+ Link tool` is its only button; at least 16 rows, monospace 13 px, `aria-label="Body"`, with `<n>/20,000`), and **Reference files** (a `fieldset` with that legend; one block per file: a path `field` (`aria-label="Path of reference file <n>"`, placeholder `references/notes.md`, monospace) and a content `textarea` of 6 rows (`aria-label="Content of reference file <n>"`, `maxlength` 20000, monospace 13 px), with a `btn-icon` **Remove reference file** (x icon, accessible name `Remove reference file <n>`); then a `btn btn-ghost` **Add reference file** (plus icon), disabled at 10).
- **Delete** confirms with the native confirm `Delete "<name>"?`, plus a blank line and `Agents using it keep it in their Live version until republished.` when a Live agent uses it. While a draft links the skill, Delete and a rename are refused with the backend's message as an error toast (capability R72).
- **Unsaved changes:** leaving asks `Discard unsaved changes?`.

#### 4.5.4 Built-in skill editor

Capability: [agents-evals](../capabilities/agents-evals/spec.md) R76-R80. The skill editor's layout (4.5.3) with these differences:

- **Header:** the title `h2` `<name>`, a `chip` `Built-in` and, when overridden, a `chip chip-warning` `Modified`; right-aligned, 8 px apart, **Reset to built-in** (`data-testid="builtin-skill-reset"`, rotate-ccw icon, `btn btn-secondary`; only while modified) and **Save** (`data-testid="builtin-skill-save"`, `btn btn-primary`). Both are hidden without Edit policies and templates, and every field is then read-only.
- **Banner** above the form: an inline block on `warning-soft` with `on-warning-soft` text, 13 px, radius 6, padding 12 x 10: `Changes apply to every session and agent as soon as you save. Run the evals to check them.` When R79 applies, a second line says the drift notice, followed by a `btn btn-ghost` **Show the built-in version**, which toggles a read-only `surface-muted` monospace view of the shipped description, body and files under the form.
- **Form:** no Name field (the name is in the title); **Description**, **What the agent sees**, **Body**, then **Files** (a `fieldset` with that legend): one block per built-in file, its path as read-only monospace text and its content in a `textarea` of 10 rows (`aria-label="Content of <path>"`). No add or remove controls.
- **Reset** confirms with the native confirm `Reset "<name>" to the built-in version?`.

#### 4.5.5 Link editor and chips

Capability: [agents-evals](../capabilities/agents-evals/spec.md) R81-R86; decision ADR-0024. Used by the agent editor's Instructions (4.5.1), the System Prompt tab's edit state (4.5.9, 4.5.11) and the skill editor's Body (4.5.3).

- **Editor:** a lazy-loaded Tiptap editor (tech-stack.md) in a `field`-styled box, monospace 13 px. It holds paragraphs of text and `mention` chips; each line is a paragraph, saved joined by `\n`, each chip saved as `[[skill:<name>]]` or `[[tool:<name>]]`, so load and save round-trip exactly. While the editor loads the box shows a muted `Loading editor…`. It has `role="textbox"`, `aria-multiline="true"` and an `aria-label` equal to the field label (`Instructions`, `Body`). The counter `<n>/<max>` under it (12 px `fg-muted`, `on-danger-soft` over the limit) counts the saved text.
- **Buttons** under the editor, `btn btn-ghost` with a plus icon: **+ Link skill** and **+ Link tool** (the skill editor has only **+ Link tool**; the assistant's prompt editor has **+ Link skill or tool** and **+ Link tool**). They open the menu limited to that kind and insert at the cursor, or at the end if the user hasn't clicked into the editor.
- **Menu** (`role="listbox"`, a floating `card` under the cursor, max 320 px wide, `shadow` popover): a micro-heading `Skills`, then `Tools` (12 px uppercase `fg-muted`), up to 6 `role="option"` rows each: the name in monospace 13 px and the description under it in 12 px `fg-muted`, one line, ellipsis. It opens on `/` at the start of a line or after a space (never inside a word, so `km/h` types normally), filters as the user types by name or description, and closes on Esc, on a click outside, or when nothing matches. The active row has a `surface-selected` fill; ArrowUp and ArrowDown move, Enter or Tab insert, a click inserts. The Skills group holds the owner's in-app skills, then the built-in on-demand skills, each of those with a muted `Built-in` suffix after its name; in the assistant's prompt editor it holds only the built-in ones, and the skill editor has no Skills group. A group with no match is omitted; with no skills in the library the Skills group shows `No skills yet` as a disabled row (never when a built-in skill is listed).
- **Chips:** inline, `chip` radius 6 with the name in monospace 12 px: a skill is `chip chip-info`, a tool `chip chip-neutral`, a link to a skill or tool that doesn't exist `chip chip-danger` with the title `Not found`. In the editor a chip deletes as one unit with Backspace. Read-only views (the System Prompt tab, the Skills tab's in-app `SKILL.md` content) render the same chips in a pre-wrapped block, not editable and not focusable.
- **Legacy line:** an agent opened with tools or skills its instructions don't link gets a last paragraph `Tools and skills: ` followed by one chip per item, and the notice of 4.5.1 (R85); the form is then dirty.

#### 4.5.6 Graph tab

Capability: [agents-evals](../capabilities/agents-evals/spec.md) R88. The agent detail's `graph` tab, user agents only. The Official assistant's tab draws its prompt's links (`prompt.editable`, instructions to skills and tools) with every tool `Always on` or linked; a System agent's tab shows the muted `This agent has no links: it gets all of its tools.`

- **Data:** the Live version's instructions, else the draft's, with the skills of the owner's library (`GET /skills`, `tools` per skill) and the detail's `toolLinks` (api.md 34, 94). `Loading graph…`, or the error text in `on-danger-soft`, while loading or failing.
- **Drawing:** a plain inline SVG in a `card`, three columns left to right: **Instructions** (one node), **Skills** (the linked skills) and **Tools** (always-on tools and linked tools). Edges are cubic curves with arrowheads, one per link: instructions to a skill, a skill to a tool, and instructions straight to a tool, routed over the skills column so it doesn't cross the nodes. Tools are ordered by the average row of what links to them. Nodes are rounded rectangles with the name in monospace 12 px; an always-on tool carries a small filled dot (the `Always on` legend swatch); the Instructions node is `surface-selected`, skills use the skill chip colour and tools the tool chip colour (4.5.5). The layout is a pure function (`buildFlowGraph`) of the instructions' links, the skills and the tools.
- **Interaction:** every node is keyboard-focusable (`tabindex="0"`); hovering or focusing a node highlights its whole chain (its ancestors and descendants) and dims the rest. The SVG has a `<title>` and a `<desc>` naming its nodes and links for assistive technology.
- **Legend** above the drawing: four swatches, `Instructions`, `Skill`, `Tool`, `Always on`, and the toggle **Show unlinked** (a checkbox, `data-testid="graph-show-unlinked"`) that adds the owner's unlinked skills and the not-linked tools, greyed, with no edges.
- **What happens on each message:** an `h3` micro-heading and an ordered list of four steps, 13 px, under the drawing:
  1. `The assistant's core prompt and this agent's instructions are sent, with links turned into plain mentions.`
  2. `The skill catalog lists the built-in skills and the linked skills; the model reads a skill when a question matches it.`
  3. `The model can call the always-on data tools and the linked tools, including those its linked skills link.`
  4. `Every answer comes from read-only queries over the agent's datasets.`

#### 4.5.7 LLM Config tab

Capability: [agents-evals](../capabilities/agents-evals/spec.md) R89. The agent detail's `model` tab (`data-testid="agent-tab-model"`) for every agent. It replaces the Model tab. Read-only key/value rows like the Memory tab: `Provider` (the provider's name), `Model` (monospace, with ` (agent override)` appended when a user agent sets its own), `API key` (`Set` or `Not set`; the value is never rendered), `Max output tokens` and `Reasoning effort` (`Default` when none; the effective one), each `—` when unknown. With no LLM saved: `No model resolved — save an LLM configuration in Settings first.` A hint links to Settings to change it.

#### 4.5.8 Chat Box tab

Capability: [agents-evals](../capabilities/agents-evals/spec.md) R90. The agent detail's `chat` tab (`data-testid="agent-tab-chat"`), not shown for System agents.

- **User agent:** a header row with the micro-heading `Chat with the draft` and, right-aligned, **New chat** (`data-testid="agent-chat-new"`, rotate-ccw icon, `btn btn-ghost`), then the Session chat (4.12) of the draft's preview session, at the tab's width, with the welcome card of 4.12 (the draft's description and starter questions). The session is the in-memory preview session of 4.5.1: **New chat** discards it and starts an empty one; leaving the agent page discards it. While it is being created: `Starting chat…`; a refusal shows the server's message in an inline `danger-soft` block. With no existing dataset in the draft the body shows instead, in 13 px `fg-muted`, `Add a dataset to this agent to chat with it.` with an **Edit** link (`btn btn-ghost`, opens the agent editor, 4.5.1) and no composer.
- **Official agent:** a muted 13 px line `Chats with the assistant run over datasets you choose.` and the **Start chat** button (`btn btn-primary`, as in the header actions, which opens the New-session composer, 4.7).
- **RFP Builder:** the same layout with the line `Chats with the RFP Builder run over the "Intellify RFP API" dataset.`; **Start chat** creates the bound session (4.4), and is disabled with the requirement as its `title` while the dataset is missing.
- The tab keeps its chat while the user switches to other tabs of the same agent.

#### 4.5.9 System Prompt tab, user agent

Capability: [agents-evals](../capabilities/agents-evals/spec.md) R92-R94; decision ADR-0025 (layout as in the agent-poc reference). The agent detail's `prompt` tab for a user agent.

- **Reading state:** the agent's own section first, an `h3` micro-heading `Agent instructions` with, right-aligned, **Edit** (`data-testid="agent-prompt-edit"`, `pencil` icon, `btn btn-secondary`; hidden without Create agents), and the instructions in a `surface-muted` block with links as chips (4.5.5), or `No instructions yet.` Under it a collapsed `<details>` titled `Assistant core prompt (fixed)` (13 px `fg-muted`) holding the assistant's prompt in the monospace pre block of 4.5.
- **Edit state** (`data-testid="agent-prompt-editor"`), replacing the instructions block: the link editor of 4.5.5 over the draft's instructions, with the `<n>/4,000` counter; a toolbar above it with **+ Link skill or tool** (`btn btn-ghost`, plus icon, opens the menu with both groups) and the hint `Type / to link a skill or tool. The agent only gets the skills and tools its instructions link.` (12 px `fg-muted`); under the editor a `Linked:` row (12 px `fg-muted`) with one chip per link in the text (4.5.5; a broken one `chip-danger`), or `none`; when a link is broken, an inline `danger-soft` block `No <kind> named <name>. Remove the link or create the skill on the Skills tab.` (plus ` (and others)` when more than one); then **Cancel** (`btn btn-ghost`) and **Save prompt** (`data-testid="agent-prompt-save"`, `save` icon, `btn btn-primary`; `Saving…` in flight; disabled in flight, when unchanged and with a broken link). Saving toasts `Draft saved`, returns to the reading state and, for a Live agent, shows `Unpublished changes` in the detail header.
- **Unsaved changes:** leaving the page, another agent or this tab with an unsaved edit asks the native confirm `Discard unsaved changes?`.
- The Official and System agents' tab is 4.5.11.

#### 4.5.11 System Prompt tab, built-in agent

Capability: [agents-evals](../capabilities/agents-evals/spec.md) R97-R104; decision ADR-0026. The agent detail's `prompt` tab for the Official and System agents.

- **Header line:** a `chip` `Built-in` and, while overridden, a `chip chip-warning` `Modified` (`data-testid="agent-prompt-modified"`); right-aligned, 8 px apart, **Reset to built-in** (`data-testid="agent-prompt-reset"`, rotate-ccw icon, `btn btn-secondary`; only while modified; native confirm `Reset the system prompt of "<name>" to the built-in version?`) and **Edit** (`data-testid="agent-prompt-edit"`, `pencil` icon, `btn btn-secondary`). Both are hidden without Edit policies and templates, and the tab is then read-only.
- **Reading state:** the prompt as served in the monospace pre block of 4.5 (`data-testid="agent-prompt-view"`). For the assistant the block shows `prompt.editable` with its `[[tool:…]]` and `[[skill:…]]` links as chips (4.5.5), a muted note `## Tools — generated from the tools the assistant gets` where the `## Tools` section sits, and under it a collapsed `<details>` `Prompt as sent to the model` (13 px `fg-muted`) holding `instructions` (the generated tool list included).
- **Edit state** (`data-testid="agent-prompt-editing"`), replacing the block: a banner above it as in 4.5.4 (`warning-soft`, `on-warning-soft`, 13 px, radius 6; `data-testid="agent-prompt-banner"`) saying `Changes apply to every session and agent as soon as you save. Run the evals to check them.`
  - *Assistant:* the lazy link editor of 4.5.5, tools and built-in on-demand skills (menu Skills group of built-ins only; buttons **+ Link skill or tool** and **+ Link tool**), over the editable text, with the hint `Type / to link a built-in skill or a tool. Links here are mentions; the assistant keeps all its tools.` and, under it, the read-only note `The ## Tools list is generated from the tools the assistant gets and is inserted before ## Working rules.` (`data-testid="agent-prompt-tools-note"`, 12 px `fg-muted`).
  - *System agent:* a plain monospace `textarea` of 16 rows (`data-testid="agent-prompt-textarea"`) with the counter `<n>/20,000` (`data-testid="agent-prompt-count"`), and no link menu.
  - **Cancel** (`data-testid="agent-prompt-cancel"`, `btn btn-ghost`) and **Save prompt** (`data-testid="agent-prompt-save"`, `save` icon, `btn btn-primary`; `Saving…` in flight; disabled in flight, when unchanged and when empty). Saving toasts the backend's message and returns to the reading state.
- **Drift notice:** when the shipped text changed since the override was saved, an inline `warning-soft` block `The app's built-in version changed since this was edited. Review it, then save again or reset.` (`data-testid="agent-prompt-drift"`) with a `btn btn-ghost` **Show the built-in version** (`data-testid="agent-prompt-show-shipped"`), which toggles a read-only monospace view of the shipped text (`data-testid="agent-prompt-shipped"`).
- **Unsaved changes:** as 4.5.9: the native confirm `Discard unsaved changes?`.

#### 4.5.10 Skills tab, user agent

Capability: [agents-evals](../capabilities/agents-evals/spec.md) R95, R96. The agent detail's `skills` tab for a user agent: the skills library (4.5.2) inline, with no change of page.

- **List:** under a section heading `Your skills` (as 4.5.2) a `card` with one row per skill, sorted by name (`data-testid="agent-skill-row-<name>"`): the name in 14 px `fg-strong` monospace; the description in 13 px `fg-muted`, two lines at most; the skill's linked tools as `chip chip-neutral` chips; and on the right a chip for this agent, `Linked` (`chip chip-success`) when the draft's instructions link the skill, `Not linked` (`chip chip-neutral`) when not; then **Edit** and **Delete** (`btn btn-ghost`, pencil and trash-2 icons; hidden without Create agents). Header: **New skill** (`data-testid="agent-skill-new"`, plus icon, `btn btn-primary`, hidden without Create agents). With no skills: the empty text of 4.5.2.
- **Inline form:** New skill and Edit replace the list with the skill editor's form (4.5.3: Name, Description, What the agent sees, Body, Reference files) in a `card`, with **Cancel** and **Save** (`Saving…` in flight; disabled with no changes) in place of the header buttons. Save toasts as 4.5.3 (`Skill "<name>" created`, `Skill saved`) and returns to the list. Delete asks the confirm of 4.5.3. Leaving the form with unsaved changes asks `Discard unsaved changes?`.
- **Built-in section:** under the list, `Built-in · included in every agent` with the read-only rows of 4.5.2; with Edit policies and templates each row has **Edit**, which opens the built-in skill editor (4.5.4).
- The Official and System agents' tab is the read-only tab of 4.5.

### 4.6 Eval trace (right panel)

Shown while an agent detail is open. With nothing selected: "Select a question in the Evals tab to see how it ran." With a selected case: uppercase micro-headings (11 px, tracking wider) *Question* (question + intent). If the case has not run: *Checks it will be scored on* (gauge icon rows) and "Run the evals to see the steps the agent executed for this question." If run: a verdict ("Passed" `on-success-soft` check / "Failed" `on-danger-soft` X) with a clock icon and duration; *Run error* (`danger-soft` block) or *Why it failed* (one `danger-soft` card per failed check with its reason); *Checks* (`surface-muted` rows with pass/fail icon, description, score); *Executed steps* (a `surface-muted` box per tool call: wrench, monospace name, `#<n>`, input, output or error; "The agent answered without calling any tool." when none); *Answer* (pre-wrapped text, or "The agent returned no text.").

### 4.7 New-session composer

Capability: [sessions-chat](../capabilities/sessions-chat/spec.md).

A centred `card` (radius 12, max width 920, padding 16) with a **Session name** `field` (14 px; label `field-label`; placeholder `My new session`), then a controls row: a model chip (sparkle icon + the configured model id in `fg`, or `No model configured` in `fg-muted` when none), a **Reasoning effort** dropdown button (hidden without `manage-llm`, 1.6; title "Reasoning effort", signal icon + `low` / `medium` / `high` capitalised in `fg-muted`, a `menu` of the three values opening upward, the current one `fg-strong` semibold; choosing one saves it immediately: toast `<server message>`), and the `btn btn-primary` **Create** button (corner-down-left icon; shows `Creating…`; disabled until a name is typed and at least one dataset selected; title "Name the session and select at least one dataset"). Below the card: caption "Select at least one dataset for this session" and a list of dataset `list-row`s (36 px `surface-muted` tile with a workflow icon in `accent`, name, "<n> entities"; a selected row is `list-row-selected` with a trailing circle-check in `primary`). Empty: `No datasets yet — create one in Datasets first.` On success: toast with the server message, the session list reloads and the new session opens (4.12).

### 4.8 Knowledge list and form

Capability: [knowledge](../capabilities/knowledge/spec.md).

- Header "Knowledge", subtitle "Instructions, glossary terms and default filters the assistant uses when answering. Only enabled snippets are applied."; actions **Generate suggestions** (wand icon, `btn btn-outline`) and the `btn btn-primary` **New snippet** (`new-knowledge-snippet`).
- Filter row: pills **All**, **Instruction**, **Term**, **Default filter** (13 px, radius 8; selected = `surface-muted` fill and `fg` text, otherwise `fg-muted`; each with the kind's description as tooltip), a "Filter by dataset" `field` select (`All datasets` + one per dataset), and on the right a **Pending suggestions** toggle (sparkles icon, `aria-pressed`, pill; active = `surface-selected` fill, `border-selected` border and `on-primary-soft` text, otherwise `surface-muted` and `fg-muted`; with an `info-soft` / `on-info-soft` count badge when > 0; `pending-suggestions-filter`).
- Row (`knowledge-<id>`; a `surface-muted` box, 1 px `border`, radius 8): 32 px `surface-muted` kind tile (instruction = file-text `accent`, term = tag `on-warning-soft`, default filter = filter `on-success-soft`), title, a small `surface-muted` kind label, an `info-soft` "Mined" chip (`chip chip-info`) for AI-suggested snippets, the body on one line, "<scope> · Updated <date>" (scope = "Global" or the dataset name). Right side: an **Enabled / Disabled** checkbox, Edit (pencil, title "Edit") and Delete (trash, title "Delete") `btn-icon` buttons (`on-danger-soft` on hover). In the pending-suggestions view the right side is instead **Accept** (`btn btn-primary`, `accept-suggestion`) and **Reject** (`btn btn-danger`, `reject-suggestion`).
- States: `Loading knowledge…`; error inline; empty (dashed `border` box, `surface-muted` book-open tile, "No knowledge yet", "Snippets are plain-text instructions, glossary terms and default filters the assistant applies when answering. Write one by hand, or generate suggestions from a dataset and approve the ones worth keeping." with a `btn btn-primary` **New snippet** and a `btn btn-outline` **Generate suggestions**); no match: "No snippets match these filters."; pending view empty: "No pending suggestions right now — generate some or check back later."
- **Snippet form** (`surface-muted` box with a `border` border and radius 12 below the list; labels `field-label`, controls `field`; "New snippet" / "Edit snippet", Close X): **Kind** select (with the kind description under it), **Scope** select (`Global` + datasets), **Title** (placeholder `Always exclude test accounts`), **Body** textarea (4 rows; placeholder `Plain-text instruction, definition or default filter the assistant should apply.`), **Synonyms (comma separated)** only for kind Term (placeholder `churn, attrition, cancellation`), **Entities (optional, comma separated)** (placeholder `claims, members`), `btn btn-outline` **Cancel** and `btn btn-primary` **Create snippet** / **Save changes** (`save-knowledge-snippet`; disabled until title and body are present; tooltip "Title and body are required").
- **Generate panel**: "Generate suggestions" box (same `surface-muted` styling) with Close X (`btn-icon`), explanation "The assistant reviews the dataset and drafts instructions, terms and default filters as pending suggestions — nothing is applied until you approve it. This can take up to a minute.", a **Dataset** select (`No datasets yet` when empty), `btn btn-outline` **Cancel** and `btn btn-primary` **Generate** (`run-generate-suggestions`; `Generating…`). Progress list (`generate-progress`, `aria-live="polite"`): finished steps with an `on-success-soft` check, the current step with a spinner and a trailing "…".
- Toasts: `Snippet enabled` / `Snippet disabled`, `Snippet deleted`, plus server messages.

### 4.9 LLM configuration (settings)

Capability: [llm-settings](../capabilities/llm-settings/spec.md).

Title "LLM Configuration", subtitle "Configure the language-model provider and verify the credentials." Fields: **Provider** select (`OpenAI`, `Anthropic`, `LenAI (Halo gateway)`), **Model** (label becomes **Deployment name** for LenAI; placeholders `gpt-4o-mini` / `claude-sonnet-5-5` / `my-deployment`), **Reasoning effort** (a `field` select directly under the model, labelled `Reasoning effort`, listing the typed model's levels lowest first as `None`, `Minimal`, `Low`, `Medium`, `High`, `XHigh`, `Max`; hint under it in 10 px `fg-muted`, linked by `aria-describedby`: "Used for answers. Test connection always uses the lowest level."; always shown: with an empty model it is disabled with the single option `Default — enter a model first` and the hint "Enter a model to see the effort levels it supports.", and for a model with no levels disabled with `Default — not available for this model` and the hint "This model doesn't support a reasoning effort setting."; the levels come from `GET /llm/effort-levels`, looked up 250 ms after the last keystroke), **Base URL** only for LenAI (placeholder `https://lenai.example.com`, hint "Gateway root; requests use <base URL>/openai/v1/deployments/<deployment>."), **API key** (password; placeholder `sk-…`, or the masked saved key when one exists). When the saved key can't be decrypted, a `warning-soft` notice (`on-warning-soft` text) above the buttons reads "Your saved API key can't be read because the app secret changed. Enter the key again, test and save." and the other fields keep their saved values. Buttons, stacked full width: **Test connection** (`btn btn-secondary`; `Testing…`) and **Save connection** (`btn btn-primary`; disabled until a test has passed since the last edit; tooltip "Test the connection successfully before saving"; `Saving…`). Editing any field except **Reasoning effort** invalidates the last test. Result is a toast with the server message.

### 4.10 Datasource configuration (settings)

Capability: [datasources](../capabilities/datasources/spec.md).

- Title "Datasource Configuration", subtitle "Connect the data platforms your datasets draw from — Databricks SQL warehouses, PostgreSQL databases or REST APIs.", `btn btn-primary` **New datasource** (hidden while the form is open).
- List: row (`datasource-<id>`; a `surface-muted` box, 1 px `border`, radius 8, `border-strong` while being edited) with a 32 px database icon tile, name, `chip chip-neutral` kind chip (`Databricks` / `PostgreSQL` / `REST API`), the one-line summary (monospace, `fg-muted`), Edit (pencil, title "Edit") and Delete (trash, title "Delete"; spinner while deleting) `btn-icon`s (`on-danger-soft` on hover for Delete). Delete confirm text in section 7. States: `Loading datasources…`; inline error (`danger-soft` block; `Could not load configured datasources` fallback); empty dashed `border` block `No datasources yet. Add one to start building datasets.`
- Form (a `card`; "New datasource" / "Edit datasource"; every input a `field`): **Name** (placeholder `Claims warehouse`), **Kind** select (`Databricks`, `PostgreSQL`, `REST API`; disabled when editing). Per kind:
  - Databricks: **Server hostname** (`adb-1234567890.1.azuredatabricks.net`), **Personal access token** (password, `dapi…`), **SQL warehouse ID** (`1a2b3c4d5e6f7g8h`).
  - PostgreSQL: **Host** (`db.example.com`) + **Port** (`5432`) side by side, **Database** (`analytics`), **User** (`readonly_user`) + **Password** (`••••••••`), **Use SSL** checkbox.
  - REST API: **Base URL** (`https://api.example.com`), **Authentication** select (`No auth`, `Bearer token`, `API key header`, `Basic`) revealing **Token** / **Header name** + **Key** / **Username** + **Password**; an **Endpoints** section with **Add endpoint** (`btn btn-ghost`, plus icon); an OpenAPI discovery row (input `aria-label="OpenAPI spec URL (optional)"`, placeholder `OpenAPI spec URL (optional) — auto-detect: /openapi.json, /swagger.json…`, Enter or the **Discover** `btn btn-secondary` button, `Discovering…`) which opens a review list ("<n> endpoint(s) found[ in <title>]", **Select all** · **Select none**, a checkbox row per endpoint showing name, group, pagination style, "<n> field(s)", "already added" or "not a list", the path and summary, a collapsible "<n> operation(s) skipped" with reasons, `btn btn-primary` **Add <n> endpoint(s)** and `btn btn-ghost` **Cancel**; the review box is a `surface-muted` box); then one `surface-muted` box per endpoint with **Name** (`customers`), **Path** (`/v1/customers`), **Group (optional)** (`default`), **Rows pointer (optional)** (`/data/items`, with the hint "Rows pointer: JSON pointer to the array of rows; leave empty if the response is the array."), **Pagination** select (`None`, `Page`, `Offset`, `Cursor`) revealing Page param / Size param / Page size, Offset param / Size param / Page size, or Cursor param / Cursor pointer / Page size; a trash icon titled "Remove endpoint".
  - Footer buttons: **Test connection** (`btn btn-secondary`; `Testing…`), **Save datasource** / **Save changes** (`btn btn-primary`; disabled until a test has passed and a name is set; tooltip "Test the connection successfully before saving"; `Saving…`), **Cancel** (`btn btn-ghost`).
  - Test and save results are toasts carrying the server message (e.g. `Connection successful`; failures such as `Postgres — …`); `Give the datasource a name first` if saved unnamed; `No endpoints found in the spec` when discovery finds nothing.

### 4.11 Testing data (settings)

Capability: [testing-data](../capabilities/testing-data/spec.md).

Title "Testing Data", subtitle "Bundled sample datasets you can load into a PostgreSQL database to power local testing and evals." Empty: "No testing data fixtures are registered." (while loading: `Loading fixtures…`). Each fixture is a collapsible box (radius 12, 1 px `border`, `border-selected` when open, header `surface-muted` when open) (`testing-data-fixture-<id>`; chevron rotates when open): name, a status label (`testing-data-status-<id>`: check/X icon + "<loaded>/<required> entities", `on-success-soft` when loaded, otherwise `fg-muted`), description, and when loaded the connection `host:port/database`. Expanded: an optional error line (`danger-soft` block, `testing-data-error-<id>`), **Connection** form (every input a `field`: Host `localhost`, Port `5432`, Database, User `postgres`, Password, **Use SSL**; `testing-data-host|port|database|user|password-<id>`), the last test message (`on-success-soft` when ok, otherwise `on-danger-soft`), **Test connection** (`btn btn-primary`, plug icon, `testing-data-test-<id>`) and the load button (`btn btn-primary`, `testing-data-load-<id>`: `Load testing data` / `Recreate testing data` for seedable fixtures, `Register testing data` otherwise; `Loading…` / `Registering…` while running). Load shows an inline `warning-soft` confirm panel (`on-warning-soft` text, `testing-data-confirm-panel-<id>`): for seedable fixtures "This drops and recreates schema <schema> on <host:port/database>. Everything in that schema will be lost." and for registrable ones "This registers "<name>" as a datasource and dataset against the existing database at <host:port/database>. No schema changes are made."; buttons **Confirm** (`btn btn-primary`, `testing-data-confirm-<id>`) and **Cancel** (`btn btn-ghost`). A **Remove** section ("Deletes the "<name>" datasource and dataset records from the app only. It does not touch the database itself.") has a **Remove** button (`btn btn-danger`, trash icon, `testing-data-remove-<id>`, disabled unless loaded; `Removing…`) with its own confirm panel ("This removes the "<name>" datasource and dataset records from the app. The database and its data are not touched."). Only one card is expanded at a time and each card keeps its own form values, busy flags and confirmations. A self-registering REST fixture (`intellify-api`, capability R21) shows no **Connection** form, test message or **Test connection**: in their place a 13 px `fg-muted` line `API URL: <url>` with the URL in monospace (`testing-data-api-url-<id>`; left out when the app's Intellify RFP API is not running). Its load button reads `Register testing data` (`Registering…`), and its confirm panel reads "This registers the Intellify RFP API at <url> as a datasource and dataset. No database changes are made."


### 4.12 Developer (settings)

Capability: [developer-settings](../capabilities/developer-settings/spec.md).

- Centred column, max width 560 px, like Testing Data.
- Title "Developer", subtitle "Tools for developing this app. Everything here is off by default."
- **Switch row:** a `role="switch"` button labelled "Developer observability" (`aria-checked`), with the description "Export agent traces to Arize Phoenix and backend traces, metrics and logs to an OpenTelemetry endpoint. Traces are still kept in the local store." The track is `primary` when on and `border-strong` when off, with a `surface` knob; the row is bordered (`border`, radius 12).
- **Endpoint rows** (`data-testid="developer-phoenix-endpoint"` and `"developer-otlp-endpoint"`): a label ("Phoenix endpoint", "OTLP endpoint"), a monospace `field` (placeholders `http://localhost:6006`, `http://localhost:4318`), and a `btn btn-outline` **Test** button (plug icon; "Testing…" with a spinner while it runs).
  - Under the row: the validation error in `on-danger-soft` (`<Phoenix|OTLP> endpoint must be an http(s) URL`), or the last test result, `on-success-soft` when it passed and `on-danger-soft` when it failed.
- **Save:** a full-width `btn btn-primary` ("Saving…"). It is disabled unless the form differs from the saved setting and both endpoints are valid. The result is a toast with the server message.
- **Restart notice** (`data-testid="developer-restart-notice"`): a `warning-soft` panel (`on-warning-soft` text, border at 30 % opacity) with "Restart to apply" and "The running backend has developer observability on|off."
  - Desktop app: a **Restart backend** `btn btn-primary` (rotate icon; "Restarting…" until the backend is ready again).
  - Browser: the text "Restart the CLI to apply." instead of the button.
### 4.12 Session chat

Capability: [sessions-chat](../capabilities/sessions-chat/spec.md); deep analysis in [deep-analysis](../capabilities/deep-analysis/spec.md); verification badges in [verified-queries](../capabilities/verified-queries/spec.md).

Layout (Figma "Chat" frame): the chat fills the page card under the page header (1.2), which carries the session name and datasource context. A scrolling, full-width transcript (padding 32 px left/right, 32 px top, 24 px bottom; 24 px gaps between items) above the composer pinned at the bottom (32 px side padding, 24 px bottom); a **history navigator** at the top-right of the transcript (one small tick per user message; hovering opens a 300 px list of the user messages, clicking one scrolls to it).

Transcript items, in order of appearance:

- **Welcome card** (a `card`; empty session only, never persisted nor sent to the model; `data-testid="session-welcome"`): sparkle icon + "<session name> is ready", the text "Ask a question in plain English and I will query your data, explain how I got the answer and turn it into an interactive visual." plus "Connected to <datasets>." and "Try one of these:" with three starter chips (pills, `surface-muted` fill, `border`, `fg` text): "What data is available here? Summarise the tables and the key metrics.", "What stands out in this data right now? Give me the headline numbers.", "How have the main metrics moved over the last 12 months?" Clicking a chip fills the composer; the user sends it. For a session bound to an agent that still exists, the text is the agent's Live description when it has one (given a closing full stop when it has none, since "Connected to …" follows in the same paragraph), and the chips are its Live starter questions (up to 5) when it has any (sessions-chat R58).
- **User message**: right-aligned bubble (max width 800, `surface-selected` fill, radius 12 with a 2 px top-right corner, 12 px padding, 12 px gap) holding a 32 px `primary` circle avatar with the letter "D" (14 px semibold `on-primary`) and the text (16 px / 24 px, `fg`, pre-wrapped, right-aligned), with a hover **Copy message** icon button to its left (title "Copy message"; toast `Copied to clipboard`, `Copy failed`).
- **Assistant answer**: a row (max width 800) with the 24 px sparks mark (`brand/agentic-hub/sparks.svg`) at the top-left and, beside it, a column (16 px gap) holding the Markdown body (3.5; 16 px / 24 px prose, tables per the Figma table: 1 px `border` frame with radius 12, 48 px rows, 16 px cell padding, 14 px text, `surface-muted` 500-weight header, first column semibold) set directly on the transcript background, not in a card, then optional blocks: **How I worked this out (<n> step(s))** collapsible numbered list (each step's rationale plus a muted outcome: "<n> rows" or "failed — <error>"); **Knowledge in context (<n>)** collapsible (kind label, title, dataset or "global", body, footnote "Curated knowledge the assistant was given before answering. Edit it under Knowledge; disabled snippets are never included."); an interpretation caption (info icon + one line, tooltip = full text); **Data entities** chips; **Data used (<n> query/queries)** collapsible styled as the Figma "Data Sources" row (`surface` fill, 1 px `border`, radius 8; summary 16 px / 24 px `on-primary-soft` text with the 24 px `data-sources.svg` icon at the left and a chevron at the right that flips when open) with, per call, the tool label ("<tool> — <n> row(s)" or "<tool> — failed"), "(truncated)" flag, a **Copy SQL** icon button (`aria-label="Copy SQL"`), the rationale, any warnings (`on-warning-soft` triangle), the SQL in a pre block and an error line. Then the action row: a **Verified** badge (badge-check icon, title "Matches an approved query"), a cross-check badge (**Cross-checked** `success-soft` / `on-success-soft` with shield-check, **Cross-check differs** `warning-soft` / `on-warning-soft` with shield-alert, **Cross-check failed** `surface-muted` / `fg-muted` with shield-off; tooltip = the check's note), copy, and — only when the answer has data — thumbs-up (`aria-label="Save as verified query"`, title "Save as verified query" -> "Saved as verified query" once on) and thumbs-down (`aria-label="Mark answer as wrong"`, title "Mark answer as wrong" -> "Marked as wrong"; both `aria-pressed`, filled when active in `success-soft` / `on-success-soft` (up) or `danger-soft` / `on-danger-soft` (down), otherwise `icon`-coloured and always visible). The copy and feedback buttons are round 16 px icon buttons (`surface-muted` on hover). Below: **Generate interactive visuals** (sparkles icon; `Generating interactive visuals…` with spinner; disabled while sending or generating) when the answer has text.
- **Error bubble**: `danger-soft` card (`on-danger-soft` border at 30 % opacity, radius 16), triangle-alert icon (`on-danger-soft`), "Something went wrong" + the message, and on the latest turn a **Retry** button (`aria-label="Retry"`). Client-only, never persisted.
- **Clarification card**: the question, numbered option buttons (`surface-muted` number badge, label, description), then — on the latest message — **Something else** (toggles to **Cancel custom answer**; reveals an input `aria-label="Custom answer"`, placeholder `Type your own answer…`, plus a **Send custom answer** arrow-up button) and **Skip**. The same reasoning / knowledge / data blocks as an answer appear under it. Older clarifications are disabled.
- **Deep-analysis report card** (a `card`): telescope tile, report title, "Deep analysis · <n> angle(s) investigated", a **Download report** button (title "Download the full report (.md)", label "Report"), then the Markdown executive summary.
- **RFP package card** (a `card`; an RFP Builder answer that carries `rfpPackage`; capability [rfp](../capabilities/rfp/spec.md); `data-testid="rfp-package-card"`): file-archive tile, the RFP title, `RFP package · <n> files`, a **Download package (.zip)** `btn btn-primary` (download icon) and, below, one link-style button per file (`rfp.md`, `rfp.pdf`, each `exhibits/<name>.csv`; `manifest.json` is only in the zip) that downloads that file. A download toasts `RFP package downloaded`; a failure toasts the server's message.
- **RFP Builder sessions** (a session with `agentKey`, [rfp](../capabilities/rfp/spec.md) R15): the composer shows neither the **Careful** nor the **Deep analysis** toggle, and answers show no **Generate interactive visuals** button; the rest of the chat is unchanged.
- **Visual event card** (`surface-muted` box with a `border` border): bar-chart tile, "Created | Updated | Reverted <visual title>", "Version <n>", a **View** button (re-opens that visual in the right panel), plus the assistant's Markdown commentary when it is more than the generic event sentence.
- **Thinking block** (while a turn streams): brain icon + "Thinking" with the live reasoning tail (last 90 characters), one card per tool call (wrench, name, then a spinner -> "<n> rows" or "failed", the rationale as it forms, the input), the streamed answer so far (Markdown), and a spinner with elapsed seconds (`<s>.<d>s`, 100 ms ticks).
- **Deep-analysis status card** (a `card`; `aria-label="Deep analysis status"`): while a background job runs, a spinner + "Deep analysis running — <progress>" and the question; on failure "Deep analysis failed — <progress>" with a **Dismiss deep analysis** X button. The chat stays usable.

Composer (full width of the chat column; `surface` fill, 1 px `border-strong` border, radius 8, `shadow-input`, padding 12 px vertical / 8 px horizontal): a 2-row textarea (14 px, placeholder `Ask a follow-up question…` in `placeholder`; Enter sends, Shift+Enter inserts a newline), left mode toggles **Careful** (shield-check icon, `aria-label="Careful mode"`, `aria-pressed`; pill, `primary-soft` fill with `on-primary-soft` text and a `border-selected` border when on, otherwise `surface-muted` and `fg-muted`) and **Deep analysis** (telescope icon, `aria-label="Deep analysis"`, disabled with an empty draft or while a job runs), each with an instant styled tooltip (`data-tip`, shown on hover and keyboard focus; text in section 7), and the right-aligned **Send message** (a round `accent` 20 px arrow-up icon button, `surface-muted` on hover; `aria-label`/title "Send message"; disabled for an empty draft) which becomes **Stop response** (square icon, same style) while a turn streams. Below the composer, a centred 12 px `fg-muted` disclaimer (copy in section 7). When the user clicks a data mark in a visual, a pill chip row `aria-label="Follow-up suggestions"` appears above the composer: "Suggested questions — click to ask:", **Drill into "<label>"**, **Why "<label>"?** (both prefill the composer, never send) and a **Dismiss follow-ups** X.

Toasts used here: `Deep analysis report ready`, `Report downloaded`, `Report download failed`, `RFP package downloaded`, `Could not start deep analysis`, `Could not save feedback`, `Feedback saved`, plus server messages.

### 4.13 Interactive visual panel (right panel in a session)

Capability: [visuals](../capabilities/visuals/spec.md).

- Header row: bar-chart icon + "Visuals" and, right-aligned, controls (only when a visual is open): a **version** dropdown (`title="Version history"`, history icon + `v<n>` + chevron; menu lists "Version <n>" with `current` / `viewing` tags, the instruction (or "Initial version") and the date, plus "refreshed <date>"; when viewing an old version the first entry is **Make v<n> the current version** with "now v<current>"; a full-screen backdrop button `aria-label="Close version menu"` closes it); **Tailor** (sliders icon; disabled with tooltip "Make this version current before tailoring" when viewing an old version; popover with **Chart type** select `Auto, Bar, Line, Scatter, Heatmap, Metric cards, Table, Donut`, **Sort** select `None, Ascending, Descending`, **Top N (3–50, optional)** number input with placeholder `All items`, a preview of the generated plain-English instruction, an error line, **Cancel** and **Apply** (disabled while nothing is chosen or while tailoring); backdrop `aria-label="Close tailoring form"`); **Refresh data** icon button (`aria-label="Refresh data"`, title "Refresh data (re-run the stored query)"; disabled on old versions); **Download bundle** icon button (`aria-label="Download bundle"`, title "Download bundle (HTML, CSS, JS, answer.md, data.json)"); and a **saved-visuals** dropdown (gallery icon + count + chevron, title "Saved visuals in this session"; items = title + "v<n> · <date>"; backdrop `aria-label="Close visual menu"`).
- Body states: *loading* — spinner tile, "Designing the visual", "Building and saving HTML, CSS, and JavaScript in the session workspace…"; *error* — "Visual generation failed" in `on-danger-soft` + message; *empty* — sparkle tile, "No visual generated yet", "Generate an interactive visual from any completed assistant answer."; *populated* — a sandboxed frame filling the panel (`sandbox="allow-scripts"`, `referrerpolicy="no-referrer"`, title "Interactive visualization", `surface-muted` fill, `border` border, radius 12) and a footer line with the visual's title and `<path>/v<n>`. Over the frame: while a silent auto-repair runs, a `surface` banner "Fixing the visual…"; if a runtime error is reported by the frame (and repair did not fix it), a `danger-soft` banner (`on-danger-soft` text) "This visual hit a runtime error." + "<message> — ask the assistant to fix it or revert to an earlier version."
- Frame messages handled: `visual-error` (runtime error) and `visual-select` (a data mark was clicked; becomes the follow-up chip row in the chat).
- Toasts (from the shell): `Visual bundle downloaded`, `Bundle download failed`, `Revert failed`, plus server messages. A downloaded bundle is named `<slug of title>.zip` (`visual-<first 8 chars of id>.zip` when the slug is empty).

### 4.14 Entity details (right panel default)

Shows the current catalog/schema/entity selection. Empty: "Select a catalog, schema or entity to see its details." (centred, 12 px `fg-muted`). Selected: a full-width **inclusion toggle** at the top — `Include item` (`btn btn-primary`) / `Include item (partially included)` (circle-minus, same style) / `Included — click to remove` (`success-soft` fill, `on-success-soft` text, circle-check) — then a header (icon + monospace name: catalog = database `accent`, schema = folder-tree `on-warning-soft`, entity = table `on-success-soft`), a micro-label (`Catalog`, `Schema · <catalog>`, or the fully qualified `catalog.schema.table` for entities), summary rows (catalog: "Schemas", "Entities"; schema: "Entities"; entity: "Columns"), and a list: schemas with "<n> entities", entities with "<n> cols", or columns (name + type, with " · not null" when not nullable).

### 4.15 Metrics panel (inside the catalog browser)

Capability: [metrics](../capabilities/metrics/spec.md). Heading "Metrics" with the text "Curated definitions for the entities included above. Answers reuse these expressions verbatim instead of re-deriving the number each turn." and a `btn btn-primary` **New metric** button (`new-metric`; disabled with tooltip "Include at least one entity first"). Rows (`metric-<name>`; `surface-muted` boxes, 1 px `border`, radius 8): gauge tile (`on-success-soft` icon), label, a monospace name chip, entity, the expression (monospace, one line) and "by <dimensions>"; Edit (title "Edit") and Delete (title "Delete") icon buttons. States: `Loading metrics…`; inline error; empty dashed `border` box ("Include entities above to define metrics over them." or "No metrics yet for these entities — define one so “denial rate” always means the same thing."). "Promote a verified answer" row of pill buttons (`surface-muted`, `border`, sparkles icon in `on-success-soft`, label, tooltip = the SQL) prefills a draft. Form (a `surface-muted` box; "New metric" / "Edit metric", Close X `btn-icon`; every input a `field`): **Label** (`Denial rate`), **Name** (monospace, `denial_rate`), **Entity** select (`No entities included` when empty), **Expression** textarea (monospace, placeholder `SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)`), **Dimensions (comma separated)** (`month, provider, plan`), **Description** (`Share of submitted claims denied in the period.`), `btn btn-outline` **Cancel** and `btn btn-primary` **Create metric** / **Save changes** (`save-metric`; tooltip "Label, name, entity and expression are required").

### 4.16 Appearance (settings)

Capability: [app-shell](../capabilities/app-shell/spec.md) R39–R45.

- Centred column, max width 560 px, like Developer. The section uses the theme tokens (6.0) for every colour.
- Title "Appearance", subtitle "Choose how the app looks. System follows your operating system's light or dark setting."
- A card holding one `radiogroup` labelled **Theme** with three options, each a native radio input with a visible label and an icon: **System** (`monitor`), **Light** (`sun`), **Dark** (`moon`). The options sit side by side as pill buttons (radius full, 1 px `border` token). The selected one has the `primary-soft` fill, `on-primary-soft` text and a `border-selected` outline. Keyboard: arrow keys move the selection, as for any native radio group.
- No Save button: a choice applies and is remembered at once.

### 4.17 Sign-in page

Capability: [admin](../capabilities/admin/spec.md) R5-R7, R16, R70, R73. Two variants, chosen by the mode (1.6): the org server variant below, and the local mode variant (4.17.1). Both share the card, the logo row and the theme.

- Replaces the whole shell: no rail, no banner card, no details panel, no system-logs button. The frame (1.2: gradient and texture) fills the window and holds one centred `card` (width 400, padding 32, radius 12, `main` landmark), top to bottom, 16 px apart:
  - a row with the logo (1.3, 40 px) and, 12 px to its right, the `h1` "Agentic Hub" (24 px semibold `fg-strong`);
  - the subtitle "Sign in with your organisation account to continue." (14 px `fg-muted`);
  - when the round trip failed, an inline error block (section 2, `role="alert"`) reading `Sign-in failed. Try again.` or `Your account is deactivated. Contact your administrator.`;
  - the full-width `btn btn-primary` **Sign in with Microsoft** (`log-in` icon). Clicking it navigates the window to `/auth/login` (a full page load, not a request) and reads `Signing in…`, disabled, until the page unloads.
- The error to show comes from the `signInError` query parameter of the page URL (`failed` or `deactivated`, [api.md](api.md) 2.13; any other value reads as `failed`); the page removes it from the address bar once shown.
- Theme: follows the Appearance choice stored in the browser (6.5). axe-clean in both themes.
- **Backend unreachable** (either mode, 1.6): the card holds the logo row, the error block (section 2, `role="alert"`) `Backend unreachable` and a `btn btn-outline` **Retry**, which loads `GET /me` again (and the user list in local mode). No other control.

#### 4.17.1 Local mode variant

Capability: [admin](../capabilities/admin/spec.md) R70, R71. Data: `GET /auth/local/users`, `POST /auth/local/sign-in` ([api.md](api.md) 91, 92).

- The same card, top to bottom, 16 px apart:
  - the logo row with the `h1` "Agentic Hub";
  - the subtitle "Choose who you are to continue. Local mode has no passwords." (14 px `fg-muted`);
  - while the users load, the loading line of section 2, `Loading users…`;
  - `<label for="local-user">Sign in as</label>` (13 px medium `fg`) over a native `select#local-user.field`, full width. Its first option is `Choose a user` (empty value, selected when the page opens); then one option per user, in the order the API answers, reading `<display name> · <roles>`, where `<roles>` is the role names joined with `, ` (`Platform admin`, `Approver`, `Data owner`, `Maker`), or `User` when the list is empty;
  - when sign-in failed, an inline error block (section 2, `role="alert"`) reading `Sign-in failed. Try again.`;
  - the full-width `btn btn-primary` **Sign in** (`log-in` icon), disabled while `Choose a user` is selected. Clicking it calls `POST /auth/local/sign-in` and reads `Signing in…`, disabled, until it answers. Success stores the token (1.6) and opens the shell on the home view; a failure shows the error block and keeps the choice.
- Loading the users fails: the **Backend unreachable** state of 4.17.
- No user is chosen automatically, and the page never signs in on its own (admin R70). axe-clean in both themes.

### 4.18 Admin area

Capability: [admin](../capabilities/admin/spec.md) R34-R68. Data: [api.md](api.md) 2.15. Visual reference: the Figma board in the [BA-161 epic spec](../epics/BA-161/spec.md), screens P1–P4 (the board's Requests, Registry, Policies and Audit log tabs and its Add role and Sync from Entra ID buttons are left out, admin R37).

There is no URL route: the area is the `admin` main view (1.4) and the selected tab is view state. Overview is selected each time the area opens; the Users & groups view, search, chip and page reset when the tab is left.

#### 4.18.1 Frame

- Content view (1.4), but **max width 1280** instead of 960, so the users table and the user detail panel fit side by side.
- **Header** (a row, 12 px gap, no rule under it: the tab bar carries the rule): a 32 px `primary-soft` tile with the `layout-dashboard` icon (`accent`, decorative), the `h2` "Admin" (page-title style, 4) and under it the subtitle "Manage people, roles and access for your organisation." (13 px `fg-muted`). Right-aligned, the selected tab's action (admin R37):
  - Overview: `btn btn-outline` **Export report** (`download` icon). It fetches `GET /admin/overview/export` and saves the response as a file named by its `Content-Disposition` (else `admin-report-<UTC date>.csv`), through a temporary link to the downloaded file. It reads "Exporting…", disabled, until the file arrives; a failure raises the error toast with the server's message (5.3).
  - Users & groups: `btn btn-primary` **Assign role** (`user-plus` icon), opening the Assign role dialog (4.18.4).
  - Roles & permissions: none.
- A `tablist` (`aria-label="Admin sections"`) with three `tab`s, in this order: **Overview**, **Users & groups**, **Roles & permissions**. 14 px medium; the selected tab has `fg-strong` text and a 2 px `primary` bottom border, the others `fg-muted`. A 1 px `border` rule runs under the tab bar. Only the selected tab is in the tab order (`tabindex` 0, the others -1); arrow keys move between tabs and select them, wrapping at the ends; Home and End go to the first and last.
- Each `tabpanel` (labelled by its tab, focusable, 24 px below the tabs) shows, while loading, the loading line of section 2 (`Loading overview…`, `Loading users…`, `Loading roles…`), and on failure the error block of section 2 with a `btn btn-outline` **Retry** (admin R38).
- **Badges** are `chip`s (3.6). Roles: Platform admin `chip-danger`, Approver `chip-warning`, Data owner `chip-success`, Maker `chip-info`, User `chip-neutral`. Status: Active `chip-success`, Inactive `chip-danger`, Not signed in `chip-neutral`, Deactivated `chip-warning`. Agents: Live `chip-success`, Draft `chip-neutral`. Groups: `chip-neutral`. The `*-soft` pairs meet 4.5:1 in both themes (6.0).
- **Times.** Last active (admin R39): `Today`, `Yesterday`, `<n> days ago`, `Never`, by UTC calendar day. Relative times (last sync, recent activity, last error): `just now` (under a minute), `<n> minute(s) ago`, `<n> hour(s) ago`, `yesterday`, `<n> days ago`; the full local date and time is the element's `title`. Counts use thousands separators (`1,940`).
- **Admin dialogs** (Assign an owner, Agents with errors, Inactive makers, Assign role, Transfer ownership, Add mapping): a scrim (`fg-strong` at 40 %; clicking it does nothing) and a centred `card` (width 560, padding 24, radius 16, `shadow-2xl`, scrolling inside when taller than the window) with `role="dialog"`, `aria-modal="true"`, labelled by its `h2` title (16 px semibold `fg-strong`) and described by its intro line (13 px `fg-muted`). Focus moves to the first control when it opens, stays inside while it is open, and returns to the button that opened it when it closes. Escape and **Cancel** (`btn btn-outline`) close it without changes. The primary button is right-aligned after **Cancel** and shows a spinner and its present participle while running ("Transferring…", "Removing…", "Assigning…", "Adding…"). A failure keeps the dialog open and raises the error toast (5.3).
- **Pickers** (User, New owner, Entra ID group): a `field` text input with `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded` and `aria-controls` pointing at a `listbox` of up to 10 matches (`GET /admin/users?excludeDeactivated=true&pageSize=10&q=` or `GET /admin/groups?pageSize=10&q=`, 250 ms after typing stops), shown as a `menu` under the input (in the flow, so a scrolling dialog never clips it). Placeholders: `Search by name or email` (users), `Search group name` (groups). Options read `<name> · <email>` for users (the name alone without an email) and the group name for groups; with no match the line `No matches.` (12 px `fg-muted`) shows instead. Arrow keys move, Enter picks, Escape closes the list (and only the list). Typing after a pick clears it. Labelled with `<label for>`.
- **Selects** (Role, Datasource) are native `select.field`s labelled with `<label for>` (not a wrapping label). **Role** starts on `Choose a role`, then offers Maker, Data owner, Approver, Platform admin; choosing another role than Data owner clears the datasource. **Datasource** lists the datasources by name (`GET /datasources`), first option "Choose a datasource", or "No datasources" when there are none; it stays visible and is disabled unless Role is Data owner, with the hint "Only for Data owner." (12 px `fg-muted`, `aria-describedby`).

#### 4.18.2 Overview (P1)

Data: `GET /admin/overview` (api 81). Admin R41-R48.

- **Tiles row**: two equal `card`s side by side (16 px gap), padding 16 × 20 (`data-testid="admin-tile"`). Each shows the value (32 px light, `data-testid="admin-tile-value"`) over its label (13 px `fg-muted`): `Active users · 30 days` (value `on-success-soft`) and `Agents live` (value `fg-strong`). The value and label are one `p` so they are read together.
- **Body**, 24 px below: two columns, 24 px apart; under 1100 px of main-column width the right column moves below the left.
  - **Left, `card` "Needs attention"** (`h3`, 15 px semibold `fg-strong`). A `ul` labelled by the heading, of three `li` rows, each a `list-row` (padding 12 × 16, 8 px apart): the row text (14 px `fg`), a flexible spacer, the count `chip` (`data-testid="attention-count"`) and a `btn btn-secondary` action (32 px tall).

    | Row text | Badge | Badge style (0 → `chip-neutral`) | Action |
    |---|---|---|---|
    | `Agents without an active owner` | `<n> agent(s)` | `chip-danger` | **Assign** |
    | `Agents with errors in the last 7 days` | `<n> agent(s)` | `chip-danger` | **Inspect** |
    | `Users inactive for 90+ days with Maker role` | `<n> user(s)` | `chip-neutral` | **Clean up** |

    A row with count 0 keeps its action visible and disabled, titled "Nothing to do" (admin R42).
  - **Right column** (width 420):
    - `card` **Weekly active users** (`h3`): a `figure` with 8 vertical bars, 32 px wide, 16 px apart, bottom-aligned in a 120 px box, heights proportional to the counts (an empty week is a 2 px stub). Past weeks `border-strong` fill, the current week `primary`; radius 4 on top. Each bar has a `title` "Week of <Mon D>: <n> user(s)". The bars are `aria-hidden`; a visually hidden `table` (caption "Weekly active users", columns "Week of", "Active users") carries the numbers. The `figcaption` (12 px `fg-muted`) is the caption of admin R46; a current week that ties the peak reads "this week", and when past weeks tie, the latest of them is named.
    - `card` **Recent activity** (`h3`; the card is `data-testid="admin-recent-activity"`), 16 px below: a `ul` labelled by the heading, of up to 10 items, each the sentence (13 px `fg`) over its relative time (12 px `fg-muted`). Empty: "No activity yet." (13 px `fg-muted`).
- **Assign an owner** dialog (**Assign**): title "Assign an owner"; intro "These agents belong to people who are deactivated or no longer in the directory. Choose who takes them over."; a `fieldset` (legend "Agents", visually hidden) of checkboxes, each labelled with the agent name and described by "Former owner: <name>" or "Former owner: unknown user", all ticked; the **New owner** picker; buttons **Cancel** and `btn btn-primary` **Transfer** (disabled until a new owner is picked and an agent is ticked). Success toasts the server message and reloads the overview.
- **Agents with errors** dialog (**Inspect**): title "Agents with errors"; intro "Chat turns that ended in an error in the last 7 days. The sessions stay private to their owners."; a `table` with columns **Agent**, **Owner**, **Errors**, **Last error**; the last-error cell shows the relative time over the message (12 px `fg-muted`, one line, clipped with an ellipsis, the full message as `title`). One button, `btn btn-outline` **Close**.
- **Inactive makers** dialog (**Clean up**): title "Inactive makers"; intro "These people haven't used the app for 90 days or more and still hold the Maker role."; checkboxes labelled with the user's name, described by "Last active <n> days ago · Direct assignment" (ticked) or "Last active <n> days ago · From group <names>" (unticked, disabled); buttons **Cancel** and `btn btn-danger` **Remove Maker role** (disabled with nothing ticked). It calls `DELETE /admin/role-assignments/:id` (api 80) for each ticked user, one after the other, then toasts "Maker role removed from <n> user(s)", closes and reloads the overview; a failure stops, toasts the server message and reloads the overview, and the dialog stays open with the users still listed.

#### 4.18.3 Users & groups (P2)

Data: `GET /admin/users` (api 83), `GET /admin/groups` (api 87). Admin R49-R57.

- **Toolbar row**: on the left a `tablist` `aria-label="Directory view"` with two `tab`s styled as `filter-pill`s (selected = `filter-pill-active`; arrow keys, Home and End switch): **Users · <n>** and **Groups · <n>**. Both control one `tabpanel` (labelled by the selected view) holding the chips, the table and the footer. Switching the view clears the search, goes back to the first page and closes the user detail panel. On the right a search `field` (`type="search"`, width 360, a 15 px `fg-muted` `search` icon inside on the left): Users view `aria-label="Search users"`, placeholder `Search name, email or group`; Groups view `aria-label="Search groups"`, placeholder `Search group name`. Search applies 250 ms after typing stops.
- **Chip row** (Users view only, 12 px below): a `group` `aria-label="Filter users by role"` of `filter-pill` buttons with `aria-pressed`: `All roles`, `Platform admins · <n>`, `Approvers · <n>`, `Data owners · <n>`, `Makers · <n>`, `Inactive 90d · <n>`.
- **Users table** (16 px below, in a `card` with no padding): a `table` with a visually hidden caption "Users"; header row `surface-muted` fill, 13 px semibold `fg-strong`, `th scope="col"`; rows 64 px with a 1 px `border` rule, `surface-muted` on hover. Columns:
  - **Name**: a 32 px `primary` circle with the initials in `on-primary` (12 px semibold, `aria-hidden`), then a `button` styled as text (14 px semibold `fg-strong`, underline on hover and focus, `id="admin-user-<id>"`) whose accessible name is the display name, and under it the email (12 px `fg-muted`), tied to the button with `aria-describedby`. The button opens the user detail panel (4.18.4).
  - **Roles**: the role chips, 4 px apart, wrapping.
  - **IdP groups**: 13 px `fg`, the names comma-separated, or `—` (`fg-muted`).
  - **Agents owned**: 13 px `fg`, right-aligned.
  - **Last active**: 13 px `fg`.
  - **Status**: the status chip.
  
  The row of the user shown in the panel has `surface-selected` fill and `aria-current="true"`.
- **Groups table** (Groups view): visually hidden caption "Groups"; columns **Name** (14 px `fg`), **Members** (right-aligned), **Mapped roles** (role chips; Data owner reads `Data owner · <datasource>`; `—` when none). Rows are not interactive.
- **Footer** (16 px below the table): on the left the last sync note (admin R54, 12 px `fg-muted`); on the right the range `<first>–<last> of <total>` (12 px `fg-muted`, `aria-live="polite"`) and two `btn-icon`s, `chevron-left` "Previous page" and `chevron-right` "Next page" (title and `aria-label`), disabled at the ends.
- **Groups view paging**: 25 groups a page, with the same footer (the last sync note, the range and the page buttons).
- **Empty** (13 px `fg-muted`, inside the table card in place of the table, 24 px padding; the range reads `0 of 0`): `No users match your search.`, `No users match this filter.`, `No groups match your search.`, `No groups yet. Groups arrive from Entra ID through SCIM.`
- **Assign role** dialog: title "Assign role"; intro "Give a person a role. Roles from group mappings are managed in Roles & permissions."; the **User** picker, the **Role** select, the **Datasource** select; buttons **Cancel** and `btn btn-primary` **Assign** (disabled until a user and a role are chosen, and a datasource for Data owner). It calls `POST /admin/role-assignments` (api 79): `201` toasts "Role assigned" (success), `200` toasts "Role already assigned" (info); then the table reloads.
- *Locator note.* The view tab **Users · <n>** and the admin tab **Users & groups** both start with "Users", and the checkbox **Data owner** is a prefix of **Data owner · <datasource>**: and the dialogs' **User** picker is a prefix of the region `User details`: tests address them with exact names (`exact: true`) or within their container (`tablist` `Directory view`, region `User details`, the dialog).

#### 4.18.4 User detail panel (P3)

Data: `GET /admin/users/:id` (api 84), `PUT /admin/users/:id/roles` (api 85), `POST /admin/agents/transfer` (api 86). Admin R58-R64.

- Opening it splits the tab body into the users table (flexible, at least 480 px, compact columns Name, Roles, Last active, role badges wrapping) and, 24 px to its right, the panel: a `section` `aria-label="User details"`, a `card` 520 px wide, padding 24, sticky at the top of the scroll area. The panel is created afresh for each selected user, so unsaved ticks go with the previous user. While the user loads it reads `Loading user…`; a failure shows the error block with **Retry** (section 2); **Close user details** is there in every state. Focus moves to the panel's `h3` (`tabindex="-1"`) once the user has loaded.
- **Header**: a 48 px `primary` initials circle (`aria-hidden`), the `h3` display name (20 px normal `fg-strong`), the email under it (13 px `fg-muted`), the status chip right-aligned, and a `btn-icon` `x` **Close user details** (title and `aria-label`) in the top-right corner.
- **Roles** (16 px below): a `fieldset` with the legend "Roles" (14 px semibold `fg-strong`) inside a `card-muted` box (padding 12 × 16, rows 8 px apart). Each row is a native 16 px checkbox (`accent-color: primary`) with a `<label for>` (14 px semibold `fg-strong`) and a description (12 px `fg-muted`) tied with `aria-describedby`:

  | Checkbox label | Description |
  |---|---|
  | `Platform admin` | `Manage users, roles, policies and settings` |
  | `Approver` | `Approve org-wide publishing` |
  | `Maker` | `Create, test and share agents with their team` |
  | `Data owner · <datasource name>` (one per datasource held) | `Approves access requests to this data source` |
  | `Data owner · datasource removed` (one per direct assignment with `datasourceMissing`, api.md 84; ticked and enabled) | `Its datasource no longer exists, so this role grants nothing. Untick it to remove it.` |
  | `Data owner` (to add one) | `Approves access requests to this data source`, then the **Datasource** select (4.18.1) under it, 28 px indented |

  The `Data owner · <datasource name>` rows are sorted by label. A disabled checkbox (admin R59-R61) adds its reason to the description, on its own line: `From group <names>`, `Bootstrap admin, set in the server configuration.`, `You can't remove your own Platform admin role.`, `No other datasource to own.`
- **Groups (from Entra ID, read-only)** (14 px semibold `fg-strong` heading `h4`, 16 px below): a `ul` labelled by the heading of group chips, 4 px apart, wrapping; or `No groups.` (13 px `fg-muted`).
- **Agents owned** (`h4`, 16 px below): a `ul` labelled by the heading, of `list-row`s (padding 10 × 12): the agent name (14 px `fg`) and, right-aligned, `Live` or `Draft`; or `No agents owned.`
- **Footer** (24 px below, right-aligned, 8 px apart): `btn btn-outline` **Transfer ownership** (disabled, titled "This user owns no agents", when the list is empty) and `btn btn-primary` **Save changes** ("Saving…"; disabled, titled "No changes to save" or "Choose a datasource for Data owner"). Success toasts the server message ("Roles saved for <name>") and reloads the panel and the table.
- Escape inside the panel (outside a dialog or an open picker) closes it; closing returns focus to the user's name button in the table. A failed **Save changes** keeps the ticks and toasts the server's message.
- **Transfer ownership** dialog: title "Transfer ownership"; intro "Move agents from <name> to another user. Sessions already started from them stay with <name> and continue with the assistant."; the agents as ticked checkboxes (labelled with their names, described by `Live` or `Draft`); the **New owner** picker (the current owner left out); buttons **Cancel** and `btn btn-primary` **Transfer**. Success toasts the server message and reloads the panel and the table.

#### 4.18.5 Roles & permissions (P4)

Data: `GET /admin/role-mappings` (api 88), `POST` / `DELETE /admin/role-mappings` (api 89, 90), `GET /admin/groups` (api 87, for the picker and to know whether any group exists). The matrix is built into the renderer from admin R21. Admin R65-R68.

- Two columns, 24 px apart (stacked under 1100 px): the matrix `card` (flexible) and the mappings `card` (width 360).
- **Permission matrix**: a `table` with a visually hidden caption "Permission matrix". Header row `surface-muted`, 13 px semibold `fg-strong`: `Permission`, `User`, `Maker`, `Data owner`, `Approver`, `Platform admin` (`th scope="col"`, role columns centred). Each row: the permission name as `th scope="row"` (13 px `fg`, left-aligned), then one cell per role, rows 44 px with a 1 px `border` rule. A granted cell shows a 16 px `check` icon in `accent` with the visually hidden text "Granted"; any other cell shows `—` in `fg-muted` (`aria-hidden`) with the visually hidden text "Not granted". Nothing is focusable or editable.
- **Mappings card**: `h3` **Role ← Entra ID group mappings** (15 px semibold `fg-strong`); hint "Members of these groups get the role automatically." (12 px `fg-muted`); a `ul` `aria-label="Group mappings"` of `list-row`s (padding 10 × 12, 8 px apart): the group name (14 px `fg`), a flexible spacer, the role chip (`Data owner · <datasource>` for Data owner, the datasource's id once it is deleted) and a `btn-icon` `x` whose title and `aria-label` are `Remove mapping <group> → <role>`, where `<role>` is the chip's text; it is disabled while its removal runs. Empty: `No group mappings yet.` (13 px `fg-muted`). Under the list, left-aligned, the `btn btn-secondary` **Add mapping** (`plus` icon); with no groups it is disabled, titled `No groups yet. Groups arrive from Entra ID through SCIM.`
- **Remove**: native confirm `Remove the mapping “<group> → <role>”?` + blank line + `Members of <group> lose the <role> role on their next request, unless they hold it another way.` `<role>` is the chip's text, as in the button. OK deletes it, toasts "Mapping removed" and reloads the list; a failure toasts the server's message.
- **Add mapping** dialog: title "Add mapping"; intro "Members of the group get the role from their next request."; the **Entra ID group** picker, the **Role** select, the **Datasource** select; buttons **Cancel** and `btn btn-primary` **Add** (disabled until a group and a role are chosen, and a datasource for Data owner). `201` toasts "Mapping added" (success), `200` toasts "Mapping already exists" (info); then the list reloads.

#### 4.18.6 Local-mode copy

Admin R74. Local mode has no Entra ID and no SCIM, so the Admin area reads differently where the org copy names them. Everything else is as in 4.18.1-4.18.5.

| Where | Org server mode | Local mode |
|---|---|---|
| Users & groups footer note (4.18.3, admin R54) | `Users and groups come from Entra ID via SCIM · last sync <time>. Roles are assigned here or mapped from groups.` | `Users are the local personas of this machine. Roles are assigned here.` |
| Groups view, empty (4.18.3, admin R57) | `No groups yet. Groups arrive from Entra ID through SCIM.` | `No groups in local mode.` |
| User detail panel groups heading (4.18.4) | `Groups (from Entra ID, read-only)` | `Groups (read-only)` |
| Locked Platform admin reason (4.18.4, admin R60) | `Bootstrap admin, set in the server configuration.` | `Always a Platform admin in local mode.` (Demo User) |
| Mappings card title (4.18.5) | `Role ← Entra ID group mappings` | `Role ← group mappings` |
| **Add mapping** disabled title (4.18.5, admin R67) | `No groups yet. Groups arrive from Entra ID through SCIM.` | `No groups in local mode.` |

## 5. Cross-cutting behaviour

### 5.1 State that survives view changes

Session list, the active session, the selected visual and the right-panel width/collapse live at shell level, so switching between views does not reload them. Form drafts inside settings sections are not preserved across section changes (each is re-created). The composer draft in a chat is per-chat-instance.

### 5.2 Selection state

The dataset browser's inclusion set and the current tree selection are shell-wide singletons: the right-panel Entity details and the browser's rows read the same state. Selecting anything while the panel is collapsed expands it.

### 5.3 Toast policy

Every action failure surfaces as an error toast with the server's `message` (or `Backend unreachable` when the request itself failed; `You don't have permission to do this.` for any HTTP 403, 1.6); every successful mutating action surfaces a success toast carrying the server's message. Exception: pinning or unpinning an agent shows its result on the card at once and toasts only on failure (4.4). Errors persist 8 s, others 4 s (3.3).

## 6. Design tokens

Every colour in the renderer is a **theme token** (6.0): a semantic, role-named colour with a Light and a Dark value, switched by the resolved theme (6.5) (ADR-0007). Components never use hex values or palette shades; the shared component classes (3.6) are built from the same tokens.

### 6.0 Theme tokens

Each token is a CSS custom property set on the root element per theme and exposed to Tailwind v4 as a colour utility (`bg-<token>`, `text-<token>`, `border-<token>`). Values are exact sRGB hex.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `canvas` | `rgb(255 255 255 / 0.95)` | `rgb(11 22 38 / 0.95)` | Canvas card behind the banner and page card (translucent so the frame shows through) |
| `rail` | `rgb(255 255 255 / 0.95)` | `rgb(13 26 44 / 0.95)` | Navigation rail and drawer |
| `surface` | `#ffffff` | `#12233a` | Cards, panels, forms |
| `surface-muted` | `#f8fafc` | `#16294a` | Summary and info boxes inside a card |
| `surface-selected` | `rgb(11 65 173 / 0.1)` | `#1a3357` | Selected list row, user message bubble |
| `border` | `rgb(0 0 0 / 0.1)` | `#24384f` | Card and input borders, dividers |
| `border-strong` | `#bbd2ff` | `#34507a` | Info-box borders, outline buttons, composer border |
| `border-selected` | `#0b41ad` | `#5b8fe8` | Selected row or option outline |
| `fg` | `rgb(0 0 0 / 0.85)` | `#d5dfec` | Body text |
| `fg-strong` | `#001f52` | `#eef4fc` | Headings, titles |
| `fg-muted` | `rgb(0 0 0 / 0.6)` | `#93a6bf` | Secondary text, captions, labels |
| `placeholder` | `rgb(0 0 0 / 0.55)` | `#93a6bf` | Input placeholder text |
| `primary` | `#0b41ad` | `#5b95ff` | Primary buttons, links |
| `primary-hover` | `#08348c` | `#78a8ff` | Primary button hover |
| `on-primary` | `#ffffff` | `#061426` | Text on `primary` |
| `primary-soft` | `#eaf1ff` | `#1b345a` | Secondary buttons, selected options |
| `on-primary-soft` | `#08348c` | `#b7d0ff` | Text on `primary-soft`, outline-button text |
| `accent` | `#0b41ad` | `#6aa8ff` | Decorative and action icons (rail, send) |
| `icon` | `#565656` | `#a9b8cc` | Neutral icons (menu, system logs, Settings, message actions) |
| `focus` | `#0b41ad` | `#7fb0ff` | Focus rings |
| `warning-soft` / `on-warning-soft` | `#fbe5d4` / `#92400e` | `#45290f` / `#ffcf9e` | "Pending" and restricted chips |
| `info-soft` / `on-info-soft` | `#e2ebfa` / `#1d4ea8` | `#1a3561` / `#b3cdff` | Informational chips |
| `neutral-soft` / `on-neutral-soft` | `#edf0f4` / `#374151` | `#243246` / `#c9d4e3` | Neutral chips |
| `success-soft` / `on-success-soft` | `#dcf3e8` / `#116444` | `#123d2e` / `#8fe0bb` | Success chips and messages |
| `danger-soft` / `on-danger-soft` | `#fde3e3` / `#a2232a` | `#4a1c22` / `#ffb3b8` | Error chips and messages |

The Light values come from the "Insight Agent AI" Figma variables (named in comments in `tokens.css`, e.g. `background/brand/strong-rest`); the Dark values are derived from the same hues.

Gradients and imagery (CSS custom properties, not colour utilities):

- `--frame-gradient` (Light `linear-gradient(39.31deg, #004c6c 8.15%, #0077a0 43.41%, #3bb8f0 96.3%)`, Dark `linear-gradient(39.31deg, #021c28 8.15%, #003a52 43.41%, #0b5f86 96.3%)`) paints the window frame; the frame texture image is laid over it with multiply blending at `--frame-texture-opacity` (Light 0.3, Dark 0.25).
- The banner is `--banner-base` (Light `#006286`, Dark `#003a52`), the banner image at `--banner-image-opacity` (Light 0.2, Dark 0.15), and `--banner-shade` (Light `linear-gradient(180deg, transparent 38.79%, rgb(0 0 0 / 0.5) 100%)`, Dark the same with 0.6); its text is white in both themes.
- `--logo-gradient` (`linear-gradient(45deg, #009de0 0%, #008ac0 60%, #0077a0 100%)`, both themes) fills the rail's logo circle.

Theme-independent: radii `card` and `frame` 12 px (plus the existing scale in 6.3); shadows `card` (Light `0 2px 7.5px rgb(11 65 173 / 0.15)`, Dark `0 2px 7.5px rgb(0 0 0 / 0.35)`), `subtle` (banner; Light `0 2px 15px rgb(11 65 173 / 0.15)`, Dark `0 2px 15px rgb(0 0 0 / 0.35)`) and `input` (chat composer; Light `1px 1px 10px rgb(11 65 173 / 0.3), 0 2px 5px rgb(11 65 173 / 0.1)`, Dark `1px 1px 10px rgb(91 149 255 / 0.25), 0 2px 5px rgb(0 0 0 / 0.3)`).

Contrast: `fg-muted` is `rgba(0,0,0,.6)` (Figma's `.55` is kept only for `placeholder`); every text token pair meets WCAG AA (4.5:1) on the surfaces it is used on in both themes, and `accent` and `icon` meet 3:1 for icons.

### 6.1 Colour usage

- Canvas card `canvas` over the textured frame; navigation rail `rail`; cards, panels and dialogs `surface`; boxes nested in a card `surface-muted`; selected rows `surface-selected` with a `border-selected` outline.
- Text `fg` (body), `fg-strong` (titles, emphasis), `fg-muted` (secondary, captions, icons); text on a `primary` fill is `on-primary`.
- Status pairs: success `success-soft`/`on-success-soft`, error `danger-soft`/`on-danger-soft`, warning `warning-soft`/`on-warning-soft`, info and AI `info-soft`/`on-info-soft`, neutral `neutral-soft`/`on-neutral-soft`. Decorative icons `accent`. Entity types: catalog `accent`, schema `on-warning-soft`, entity `on-success-soft`.
- Scrollbars (webkit): 8 px, transparent track, thumb `fg-muted` at 40 % (65 % on hover), fully rounded, transparent corner.

### 6.2 Typography

- Sans (all UI): **Noto Sans**, bundled with the app (weights 400, 500, 600, 700; Latin subset; no network fetch), falling back to the system stack `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`, antialiased.
- Monospace (identifiers, SQL, logs, expressions, kbd-like chips): Tailwind default mono stack (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`).
- Base text size 13 px. Scale in use (px): 8 and 9 (badges), 10 (micro labels, chips), 11 (labels, captions), 12 (secondary body, dense lists), **13 (default)**, 14 (buttons, rail labels, list-row titles, composer name input, dialog title), 16 (chat prose and user messages), 15 (settings titles, section headings), 24 (page titles, light weight, `h2`), 40 (banner `h1`, semibold). Weights: light (300) for page titles, normal, medium (500) for buttons/labels, semibold (600) for titles. Uppercase micro-headings use ~0.08 em / "wider" tracking at 10-11 px. Chat prose line height 1.75; UI line heights follow Tailwind defaults (13 px -> 20 px).

### 6.3 Spacing, radii, shadows, motion

- Spacing: Tailwind 4 px base grid. Recurrent: rail 64 / drawer 240, banner 136, backend status strip 28, window-drag spacer for traffic lights 24 (rail) / 76 (`.pl-traffic-lights`), content column padding 32/40 (pages) or 24/40 (settings), chat column max width 860, composer card max width 920 (new session) / 860 (chat), page column max width 960.
- Radii: 4 (code chips), 6 (inputs, small buttons; `rounded-md`), 8 (`rounded-lg`: page buttons, rows, menus), 12 (`rounded-xl`: cards, frame, canvas card, banner, rail, toasts, icon tiles 40 px, user bubble), 16 (`rounded-2xl`: composers, dialogs, chat cards), full (badges, avatar, pills).
- Shadows: `shadow-card` on cards, `shadow-subtle` on the banner, `shadow-input` on the chat composer, `shadow-xl` on popovers/toasts, `shadow-lg` on the new-session card, `shadow-2xl` on the logs dialog. Otherwise flat: depth comes from surface greys and borders.
- Motion: spinners (`animate-spin`) on loaders; 120 ms opacity/transform transitions on the composer tooltips and the resize-handle line; chevrons rotate 90 degrees on expand; a pulsing skeleton for the top-bar datasource loading state. Tooltips' motion is disabled under `prefers-reduced-motion: reduce`.

### 6.4 Icons

Brand imagery comes from the Figma assets in `frontend/public/brand/agentic-hub/`: `frame-texture.webp`, `banner.webp`, `logo-mark.svg`, `lenai-mark.svg`, `powered-by-lenai.svg`, `sparks.svg` (assistant mark), `page-header-icon.svg` and `data-sources.svg`; the folder also keeps the other exported Figma icons (`rail-*.svg`, `new-conversation.svg`, `send.svg`, `copy.svg`, `download.svg`, `thumb-up.svg`, `thumb-down.svg`, `chevron-down.svg`), unused, for reference. Every generic icon stays [lucide](https://lucide.dev) outline (line width 2 by default, `strokeWidth` 2.5 on the Stop square), sized 11-19 px (15 px in nav rows, 14 px in buttons, 16 px for toolbar/panel toggles). Names used, by area:

- Shell / nav: `shield` (Admin), `layout-dashboard` (Admin header), `user-plus` (Assign role), `chevron-left` (Previous page), `log-in` (Sign in with Microsoft), `log-out` (Sign out), `sun-moon` (Appearance), `monitor` / `sun` / `moon` (theme options), `panel-right`, `arrow-left`, `chevron-down`, `chevron-up` (Show less), `chevron-right`, `plus`, `search`, `ellipsis-vertical`, `trash-2`, `scroll-text`, `settings`, `menu` (drawer toggle), `square-pen` (Start New Conversation), `flask-conical` (Datasets), `bot` (Agents, LLM config, agent tiles), `book-open` (Knowledge), `folder-kanban` (Sessions), `database` (Datasource config, catalogs, session datasource context), `test-tube` (Testing data), `workflow` (dataset tiles), `corner-down-left` (Create).
- Status / feedback: `loader-2` (spinners), `circle-check`, `circle-x`, `circle-alert`, `circle-minus`, `info`, `x`, `triangle-alert`, `lock`, `refresh-cw`, `download`, `copy`, `play`, `plug-zap`, `check`.
- Data / catalog: `folder-tree` (schema), `table-2` (entity), `layout-grid`, `gauge` (metrics, checks, Evals tab), `list-checks` (question sets), `pencil`, `wand-2` (generate suggestions), `sparkle` / `sparkles` (AI, visuals, suggestions, agent cards), `pin` / `pin-off` (agent pin toggle), `upload` (Publish), `file-text` / `tag` / `filter` (knowledge kinds), `wrench` (tools), `book-open` (Skills tab), `brain` (Thinking, Memory tab), `cpu` (LLM Config tab), `git-fork` (Graph tab), `clock`.
- Chat / visuals: `arrow-up` (send), `square` (stop), `thumbs-up`, `thumbs-down`, `badge-check` (Verified), `shield-check` / `shield-alert` / `shield-off` (cross-check, Careful mode), `telescope` (deep analysis), `bar-chart-3`, `history` (versions), `sliders-horizontal` (Tailor), `gallery-vertical-end` (saved visuals), `signal` (reasoning effort).

### 6.5 Theming

- The **resolved theme** is Light or Dark (app-shell R41). It is written to the root element as `data-theme="light|dark"` together with `color-scheme`, so native scrollbars and form controls follow it. The tokens in 6.0 hang off that attribute.
- An inline script in the page head reads the stored choice (`questions-to-insights:theme`, see [data-model.md](data-model.md)) and the `prefers-color-scheme` media query, and sets `data-theme` before the app boots (R42). The app then keeps it in sync: on a new choice, and on a `prefers-color-scheme` change while System is chosen.
- A theme change is instant: for the frame in which `data-theme` changes, the root carries `theme-switching`, which turns off all transitions, so no surface fades between themes.
- In the desktop app, every change of the resolved theme is also sent to the main process (`desktop.setWindowTheme`, [api.md](api.md) §4), which sets the window background to the `canvas` colour.
- Native `<option>` elements carry the `surface` fill so dropdowns follow the theme.
- **Cascade layers:** `index.html` declares `@layer theme, base, components, utilities;` before any other style, so Angular's inlined critical CSS cannot reorder the layers and let Tailwind's `base` reset beat the component classes.

*Implementation note.* Tailwind CSS v4 through `@tailwindcss/postcss`, `@import "tailwindcss";` in `src/styles.scss`, no `tailwind.config`. The theme tokens (6.0) are defined in `src/styles/tokens.css` as `--qti-*` custom properties under `:root[data-theme=light|dark]` and mapped with `@theme inline` to Tailwind colours, so `bg-surface` resolves to `var(--qti-surface)` at runtime. The shared component classes (3.6) live in `src/styles/components.css` inside `@layer components`, so utilities on the same element override them. Arbitrary values remain only for sizes (`text-[13px]`). `app.scss` holds only the resize-handle styles; `styles.scss` holds the drag-region utilities (`.app-drag`, `.app-no-drag`, `.pl-traffic-lights` = 76 px), `.option-active` and the scrollbar rules; chat prose lives in the chat component's stylesheet (`.prose-dark`). Icons are `lucide-angular`; components are standalone and signal-driven.

## 7. Copy that tests or users rely on

Strings below are asserted by the Playwright suite or are user-facing contracts. Exact casing, punctuation and the ellipsis character (`…`) matter.

| Where | String |
|---|---|
| Page heading (banner `h1`) | `Agentic Hub` |
| Window / document title | `Agentic Hub` (OS app name stays `Halo BI Assistant`) |
| Rail buttons (title and aria-label) | `Expand navigation` / `Collapse navigation` (menu button), `Datasets`, `Agents`, `Knowledge`, `Sessions`, `Settings`; `Open system logs` (title `System logs and diagnostics`); avatar title the user's display name (`Demo User` for Demo User) with `aria-label` `Account menu`; `Admin` |
| Sign-in page | `Agentic Hub`, `Sign in with your organisation account to continue.`, `Sign in with Microsoft`, `Signing in…`, `Sign-in failed. Try again.`, `Your account is deactivated. Contact your administrator.`, `Backend unreachable`, `Retry`; local mode `Choose who you are to continue. Local mode has no passwords.`, `Sign in as`, `Choose a user`, `<display name> · <roles>`, `Loading users…`, `Sign in` |
| Account menu | menu `Account`, `Sign out`, `Signing out…` |
| Admin area | `Admin`, `Manage people, roles and access for your organisation.`, tablist `Admin sections`, tabs `Overview`, `Users & groups`, `Roles & permissions`, `Export report`, `Exporting…`, `Assign role`, `Retry`, `Loading overview…`, `Loading users…`, `Loading roles…` |
| Admin overview | `Active users · 30 days`, `Agents live`, `Needs attention`, `Agents without an active owner`, `Agents with errors in the last 7 days`, `Users inactive for 90+ days with Maker role`, `<n> agent(s)`, `<n> user(s)`, `Assign`, `Inspect`, `Clean up`, `Nothing to do`, `Weekly active users`, `Last 8 weeks · peak <n> this week`, `Last 8 weeks · peak <n> in the week of <Mon D>`, `Last 8 weeks · no activity yet`, `Recent activity`, `No activity yet.`; dialogs `Assign an owner`, `Former owner: <name>`, `Former owner: unknown user`, `New owner`, `Transfer`, `Transferring…`, `Agents with errors`, `Agent`, `Owner`, `Errors`, `Last error`, `Close`, `Inactive makers`, `Remove Maker role`, `Removing…`, toast `Maker role removed from <n> user(s)`; activity sentences in admin R47 |
| Users & groups | tablist `Directory view`, `Users · <n>`, `Groups · <n>`, `Search users`, `Search name, email or group`, `Search groups`, `Search group name`, group `Filter users by role`, `All roles`, `Platform admins · <n>`, `Approvers · <n>`, `Data owners · <n>`, `Makers · <n>`, `Inactive 90d · <n>`, columns `Name`, `Roles`, `IdP groups`, `Agents owned`, `Last active`, `Status`, `Members`, `Mapped roles`, `Today`, `Yesterday`, `<n> days ago`, `Never`, `Active`, `Inactive`, `Not signed in`, `Deactivated`, `Users and groups come from Entra ID via SCIM · last sync <time>. Roles are assigned here or mapped from groups.`, `· not synced yet`, `<first>–<last> of <total>`, `Previous page`, `Next page`, `No users match your search.`, `No users match this filter.`, `No groups match your search.`, `No groups yet. Groups arrive from Entra ID through SCIM.`, local mode `Users are the local personas of this machine. Roles are assigned here.` and `No groups in local mode.`; dialog `Assign role`, `User`, `Search by name or email`, `No matches.`, `Role`, `Choose a role`, `Datasource`, `Choose a datasource`, `No datasources`, `Only for Data owner.`, `Assign`, `Assigning…`, `Cancel`, toasts `Role assigned`, `Role already assigned` |
| User detail panel | region `User details`, `Close user details`, `Loading user…`, `Roles`, `Platform admin`, `Approver`, `Maker`, `Data owner`, `Data owner · <datasource>`, the role descriptions in 4.18.4, `From group <names>`, `Bootstrap admin, set in the server configuration.`, local mode `Always a Platform admin in local mode.`, `You can't remove your own Platform admin role.`, `No other datasource to own.`, `Groups (from Entra ID, read-only)`, local mode `Groups (read-only)`, `No groups.`, `Agents owned`, `Live`, `Draft`, `No agents owned.`, `Transfer ownership`, `Save changes`, `Saving…`, `No changes to save`, `Choose a datasource for Data owner`, `This user owns no agents`, toasts `Roles saved for <name>`, `Transferred <n> agent(s) to <name>`, `<name> already has an agent named "<agent>"` |
| Roles & permissions | caption `Permission matrix`, `Permission`, the permission names of admin R21, `Granted`, `Not granted`, `Role ← Entra ID group mappings` (local mode `Role ← group mappings`, and **Add mapping** titled `No groups in local mode.`), `Members of these groups get the role automatically.`, list `Group mappings`, `Remove mapping <group> → <role>`, `No group mappings yet.`, `Add mapping`, dialog `Add mapping`, `Entra ID group`, `Add`, `Adding…`, confirm `Remove the mapping “<group> → <role>”?` + blank line + `Members of <group> lose the <role> role on their next request, unless they hold it another way.`, toasts `Mapping added`, `Mapping already exists`, `Mapping removed` |
| Permission toast | `You don't have permission to do this.` |
| Drawer labels | `Agentic Hub`, `System logs`, `Settings`; LenAI mark `Powered by LenAI` |
| Sessions area | `Sessions`, `New conversation`, `Start New Conversation`, `Session options`, `Options for <session name>`, `No sessions yet.`, `Select a session or start a new conversation.` |
| Shell aria-labels | `Navigation rail`, `Workspace navigation`, `Sessions navigation`, `Settings navigation`, `Details panel` |
| Settings | `Search settings`, `Datasource Configuration`, `LLM Configuration`, `Testing Data`, `Developer`, `Appearance`, `Choose a settings section.`, footer `Agentic Hub v<version>` |
| Appearance | `Appearance`, `Choose how the app looks. System follows your operating system's light or dark setting.`, group `Theme`, options `System`, `Light`, `Dark` |
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
| LLM | `LLM Configuration`, `Test connection`, `Save connection`, `Provider`, `Model`, `Deployment name`, `Reasoning effort`, `Used for answers. Test connection always uses the lowest level.`, `Default — enter a model first`, `Default — not available for this model`, `Enter a model to see the effort levels it supports.`, `This model doesn't support a reasoning effort setting.`, `Base URL`, `API key` |
| Agent Hub | `Agents`, `New agent`, `The agent editor arrives with BA-155`, `Search agents by name or description`, `Filter agents`, `All`, `Pinned`, `Official`, `Mine`, `System`, `Show more (<n>)`, `Show less`, `Pin`, `Pinned`, `Pin <name>`, `Unpin <name>`, `Owner: You`, `Owner: Official`, `Owner: System`, `Draft`, `Live`, `Unpublished changes`, `Missing dataset: <names>`, `Loading agents…`, `No agents match "<query>"`, `No pinned agents yet.`, `No agents of yours yet.`, `RFP Builder`, Start chat title `Load the "Intellify RFP API" sample in Settings → Testing Data first` |
| Agent actions | `Publish`, `Publishing…`, `Delete`, `Deleting…`, confirm `Delete "<name>"?` + blank line + `Its sessions keep their transcripts and continue with the assistant.`, toasts `Agent "<name>" is Live`, `Agent "<name>" deleted`, `Select at least one dataset to publish`; System Prompt `Agent instructions`, `No instructions yet.`, `Assistant core prompt (fixed)`, `Edit`, `Cancel`, `Save prompt`, `Saving…`, `Draft saved`, `+ Link skill or tool`, `Type / to link a skill or tool. The agent only gets the skills and tools its instructions link.`, `Linked:`, `none`, `No <kind> named <name>. Remove the link or create the skill on the Skills tab.`, ` (and others)`, `Discard unsaved changes?`; built-in agent's System Prompt `Built-in`, `Modified`, `Reset to built-in`, confirm `Reset the system prompt of "<name>" to the built-in version?`, toasts `System prompt of "<name>" saved`, `System prompt of "<name>" reset`, the banner `Changes apply to every session and agent as soon as you save. Run the evals to check them.`, `Type / to link a tool or a built-in skill. Links here are mentions; the assistant keeps all its tools.`, `The ## Tools list is generated from the tools the assistant gets and is inserted before ## Working rules.`, `<n>/20,000`, `The app's built-in version changed since this was edited. Review it, then save again or reset.`, `Show the built-in version`; Chat Box `Chat with the draft`, `New chat`, `Add a dataset to this agent to chat with it.`, `Chats with the assistant run over datasets you choose.`, `Start chat`, `Starting chat…` |
| Built-in skills | `Your skills`, `Built-in · included in every agent`, `Built-in`, `Modified`, `On demand`, `Loaded by the app`, `Changes apply to every session and agent as soon as you save. Run the evals to check them.`, `The app's built-in version changed since this was edited. Review it, then save again or reset.`, `Show the built-in version`, `Hide the built-in version`, `Files`, `Content of <path>`, `Reset to built-in`, confirm `Reset "<name>" to the built-in version?`, toasts `Built-in skill "<name>" saved`, `Built-in skill "<name>" reset`; agent editor hint `Every agent also gets the built-in skills.` |
| Skills library | `Skills`, `New skill`, `Used by <names>`, `Not used by any agent`, `No skills yet. A skill is know-how an agent reads when a question needs it.`, `Loading skills…`, `New skill`, `Edit <name>`, `Name`, `Description`, `Start with "Use when…". The agent reads the skill only when a question matches it.`, `What the agent sees`, `Body`, `Reference files`, `Path of reference file <n>`, `Content of reference file <n>`, `Add reference file`, `Remove reference file <n>`, `Save`, `Saving…`, `Delete`, confirm `Delete "<name>"?` + `Agents using it keep it in their Live version until republished.`, toasts `Skill "<name>" created`, `Skill saved`, `Skill "<name>" deleted`; agent editor `Skills`, `The agent reads a skill when a question matches its "Use when" description.`, `No skills yet — create one in` |
| Agents | `All agents`, `Chat Box`, `System Prompt`, `Skills (<n>)`, `Tools (<n>)`, `Graph`, `Memory`, `Evals`, `LLM Config`, `Your skills`, `New skill`, `Always on`, `Linked`, `Not linked`, `Linked from the instructions`, `Linked by <skill names>`, `+ Link skill`, `+ Link tool`, `+ Link skill or tool`, `Built-in` (menu suffix), `## Tools — generated from the tools the assistant gets`, `Prompt as sent to the model`, `Only built-in skills can be linked here: this prompt is shared by every user`, `Not found`, `Tools and skills: `, `Links were added for what this agent had. Save to keep them.`, `Show unlinked`, `What happens on each message`, `This agent has no links: it gets all of its tools.`, `API key`, `Set`, `Not set`, `Max output tokens`, `Reasoning effort`, ` (agent override)`, Skills tab `Loading skills…`, `This agent runs on the assistant, so it uses the assistant's skills.`, `Built-in`, `In-app`, `This agent has no skills.`, `On demand`, `Loaded by the app`, `This file isn't shown: it is larger than 256 KB or isn't text.`, `Questions`, `Executions`, `Recent messages replayed`, `Provider`, `<n> messages`, `No tools`, `This agent runs in a single step with no tools.`, `This agent is stateless — no memory is configured.`, `No evals configured for this agent yet.`, `No eval runs yet — run the suite from the Questions tab.`, `Select all`, `Run <n> selected`, `<n>/<total> passed` |
| Knowledge | `New snippet`, `Generate suggestions`, `Pending suggestions`, `Accept`, `Reject`, `No knowledge yet`, `Create snippet`, `Save changes` |
| Metrics | `New metric`, `Create metric`, `Save changes` |
| New session | `Session name`, placeholder `My new session`, `Create`, `No model configured`, `Reasoning effort`, `Select at least one dataset for this session`, `No datasets yet — create one in Datasets first.` |
| Chat composer | placeholder `Ask a follow-up question…`, disclaimer `Responses are generated by AI (Powered by LenAI) and may be inaccurate or incomplete. Please verify against source data before sharing.`, `Send message`, `Stop response`, `Careful`, `Careful mode`, `Deep analysis`, `Type your own answer…`, `Custom answer`, `Send custom answer`, `Something else`, `Cancel custom answer`, `Skip`, `Retry`, `Something went wrong`, `Thinking` |
| Chat answer | `Generate interactive visuals`, `Generating interactive visuals…`, `Verified`, `Cross-checked`, `Cross-check differs`, `Cross-check failed`, `Save as verified query`, `Mark answer as wrong`, `Copy message`, `Copy SQL`, `Data used (<n> query)` / `(<n> queries)`, `Data entities`, `How I worked this out (<n> step(s))`, `Knowledge in context (<n>)`, `Download report`, `View`, `Created` / `Updated` / `Reverted` + `Version <n>`, `RFP package · <n> files`, `Download package (.zip)`, toast `RFP package downloaded` |
| Testing Data (self-registering sample) | `API URL: <url>`, `Register testing data`, `Registering…`, confirm `This registers the Intellify RFP API at <url> as a datasource and dataset. No database changes are made.` |
| Chat tooltips (Careful on / off) | on: `Careful mode is on: every answer is re-checked by an independent query and gets an agree/disagree badge. Slower per answer.`; off: `Careful mode: re-check each answer with an independent query and show an agree/disagree badge. Slower per answer.` |
| Chat tooltips (Deep analysis) | idle: `Deep analysis: investigate the typed question from several angles in the background and deliver a downloadable report. Takes a few minutes; chat stays usable.`; running: `A deep analysis is already running for this session.` |
| Visual panel | `Visuals`, `Version history`, `Tailor`, `Refresh data`, `Download bundle`, `Saved visuals in this session`, `Version <n>`, `current`, `viewing`, `Initial version`, `Make v<n> the current version`, `Designing the visual`, `Visual generation failed`, `No visual generated yet`, `Fixing the visual…`, `This visual hit a runtime error.`, frame title `Interactive visualization` |
| System logs | `System logs`, `LIVE`, `Refresh logs`, `Export`, `Exporting…`, `Close system logs`, `All <n>`, `Issues <n>`, `Search system logs`, `Search messages or sources`, `Group by run`, `Follow`, `No matching log entries`, `Exported <n> diagnostic entries` |
| Entity details | `Include item`, `Include item (partially included)`, `Included — click to remove`, `Schemas`, `Entities`, `Columns` |

## 8. Accessibility

Targets and the automated gate: [../product/non-functional.md](../product/non-functional.md) and [../capabilities/app-shell/spec.md](../capabilities/app-shell/spec.md). The Playwright suite loads `axe-core` into the running app shell and **fails on any automatically detectable violation**; new screens must keep that scan clean (this is the acceptance bar, not a best effort).

- **Landmarks**: the rail and the details panel are `aside` elements with accessible names (`Navigation rail`, `Details panel`); navigation groups are `nav` with names (`Workspace navigation`, `Sessions navigation`, `Settings navigation`); the banner (`role="banner"`) holds the only `h1` ("Agentic Hub"); the page card is `main`; the system logs panel is a `dialog` (`aria-modal`, labelled by its `h2`).
- **Names for icon-only controls**: every icon-only button has a `title` and, where tests or assistive technology rely on it, an `aria-label` (`Open system logs`, `Close system logs`, `Refresh logs`, `Options for <session>`, `Send message`, `Stop response`, `Retry`, `Copy SQL`, `Careful mode`, `Deep analysis`, `Save as verified query`, `Mark answer as wrong`, `Refresh inventory`, `Clear filter`, `Refresh data`, `Download bundle`, `Download run <id> as Markdown`, `Delete run <id>`, `Pin <name>` / `Unpin <name>`, `Search agents by name or description`, `Dismiss deep analysis`, `Dismiss follow-ups`, `Send custom answer`). Rail buttons carry both a title and an `aria-label`; the panel toggles carry titles ("Collapse right panel", …) used as their accessible names. The current rail button has `aria-current="page"`.
- **State**: toggles expose `aria-pressed` (Careful, thumbs, eval set / case rows, pending-suggestions filter, Agent Hub filter pills and pin toggles); disclosure buttons expose `aria-expanded` (version, tailor and visual menus, custom answer, Agent Hub `Show more`); the Agent Hub pills sit in a `group` named `Filter agents`, and each hub section is a `section` labelled by its heading. A hub card keeps its open button and pin toggle as siblings, so no interactive control is nested in another; the resize separator exposes `aria-valuemin/max/now` and `aria-orientation`.
- **Keyboard**: everything interactive is a native `button`, `input`, `select`, `textarea` or `details/summary`, so Tab / Shift+Tab / Enter / Space work by default. Specific keys: the resize separator (Left/Right = 24 px, Home/End = min/max; focusable, `tabindex=0`); chat composer (Enter send, Shift+Enter newline; the custom-answer input has its own Enter handler); the OpenAPI discovery input (Enter runs Discover); tooltips on the composer mode buttons also show on keyboard focus (`:focus-visible`). The resize handle shows its guide line on `:focus-visible`.
- **Focus handling**: inputs (`field`) show a `border-selected` border and a 2 px `surface-selected` ring on focus; buttons show a 2 px `focus` outline; the resize handle and tooltips respond to keyboard focus. Open question: the system logs dialog does not currently trap focus or restore it to the opener on close, nor close on Escape; rebuilds should add this if the axe/WCAG bar is raised.
- **Live regions**: the knowledge generation progress list and the toast stack ("Notifications") are `aria-live="polite"`. Open question: whether error toasts should interrupt (`role="alert"`).
- **Contrast**: text tokens meet WCAG AA in both themes (6.0). The layout Feature scans every screen in both themes with axe, which enforces it. Decorative icons next to text are not announced separately.
- **Motion**: only the composer tooltips honour `prefers-reduced-motion`; spinners and chevron rotations do not.

## 9. Visual baseline

`frontend/e2e/layout-accessibility.spec.ts` captures the shell at the default window size (1440×900) as `application-shell`: `application-shell-web-linux.png` for the web target and `application-shell-darwin.png` for the desktop target. Each is updated only with `npm run test:e2e:update` / `test:e2e:desktop:update` when a visual change is intended. The web baseline shows the Figma-aligned Agentic Hub shell in the light theme (the E2E browser reports a light OS theme) on the home view: the textured teal gradient frame, the collapsed 64 px rail (menu button, logo, Datasets, Agents, Knowledge and Sessions icons; avatar, system logs, Settings, divider and LenAI mark at the bottom), the 136 px "Agentic Hub" banner with its image, and the page card with the placeholder composer. The drawer is collapsed and the details panel is closed. The desktop baseline predates the Agentic Hub shell and is regenerated only on a requested desktop run.


## 10. Open questions and gaps

- The settings search and its `⌘ F` hint, the Datasets list filter pills (Pinned / Yours / Shared with you), the search icon on the Datasets list, the layout-grid button and the empty 40 px tab strip are non-functional placeholders; intended behaviour is undefined.
- The rail's 44 px window-drag spacer that clears the macOS traffic lights is applied on every platform; on Windows/Linux (no inset controls) it leaves a small empty space at the top of the rail. Intended cross-platform title-bar treatment is undefined.
- Right-panel open state and drawer state are not persisted; only the panel width is.
- No Escape / focus-trap handling for the system logs dialog and the popover menus; toasts lack live-region roles (see 8).
- Date formatting uses the user's locale for times (`toLocaleTimeString`) but fixed `en-US` for dataset month headings; there is no localisation layer and all copy is English.
- The visual frame's own typography/colours (inside the sandboxed iframe) are specified with the visuals capability, not here.

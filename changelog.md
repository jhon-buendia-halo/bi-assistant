# Changelog

Running log of every meaningful change, newest first. See *Logging convention* and *Evidence convention* in [CLAUDE.md](CLAUDE.md). Release versions come from Conventional Commits (`version-on-merge.yml`); this file records what shipped and links to the evidence.

## 2026-10-10

### Added
- **Per-model reasoning effort in LLM Settings** (roadmap 1.10.1, [BA-160](https://halo-powered.atlassian.net/browse/BA-160), epic [BA-159](https://halo-powered.atlassian.net/browse/BA-159)):
  - Settings → LLM has a **Reasoning effort** select under the model. It lists only the levels the typed model accepts, for example `Minimal / Low / Medium / High` for `gpt-5`, and is hidden for models without reasoning (`gpt-4.1`). Unknown names get `Low / Medium / High`. Save stores the chosen effort with the connection.
  - Fixed along the way: reasoning models such as `gpt-5` failed **Test connection** (and therefore Save) with `LLM request timed out after 30s`. The probe now asks for the model's lowest level (`minimal` on `gpt-5`), so it answers within the limit; answers use the chosen effort.
  - Every model call maps its effort to the nearest level the model accepts, so fixed efforts such as the SQL fixer's `low` still work on models that only take `high`. Claude Haiku 5.5 now receives effort (it was dropped with the older Haiku models).
  - Backend: a built-in level table in `backend/src/mastra/effort-levels.ts`, checked against the OpenAI model pages and Anthropic's *Effort* page; `GET /llm/effort-levels`; `PUT /llm/settings` accepts `reasoningEffort`. No migration: stored `low` / `medium` / `high` values stay valid.
  - Specs: epic spec [specs/epics/BA-159](specs/epics/BA-159/spec.md); llm-settings R7, R16, R23 and new R36–R41 with three Gherkin scenarios; [agents.md](specs/system/agents.md) 1.4 (level table); [api.md](specs/system/api.md) 30–32a; [data-model.md](specs/system/data-model.md); [ui.md](specs/system/ui.md) 4.9; the glossary.
  - Tests: three new scenarios in `frontend/e2e/llm-settings.spec.ts`; the LLM stub records probes and `reasoning_effort`; new backend unit tests for the table, the mapping, the probe and save.
  - Evidence: [evidence/1.10.1/](evidence/1.10.1/).
- **Light theme and open navigation drawer by default, remembered in the database** (roadmap 1.10.2, [BA-168](https://halo-powered.atlassian.net/browse/BA-168), shipped in the BA-159 PR at the user's request):
  - A fresh install opens in the Light theme (even with a dark OS) and with the navigation drawer expanded. System, Light and Dark are still the Theme choices.
  - The Theme choice and the drawer's Expand / Collapse state are stored in the backend (`settings` document `ui-preferences`, `GET` / `PUT /ui-preferences`), so they survive another browser profile or port on the same data. A browser-storage copy still applies them before the first paint; the backend wins once loaded. A theme saved only in browser storage before this change moves to the backend once (M12). Opening the drawer by clicking Sessions isn't remembered.
  - ADR-0009 (supersedes ADR-0007's preference storage and default); app-shell R2, R39, R43, new R50 and the drawer and appearance scenarios; [api.md](specs/system/api.md) 2.12; [data-model.md](specs/system/data-model.md) 3.2.1 and M12.
  - Tests: 4 new and 5 updated E2E scenarios (navigation, appearance, and the axe scans now choose System before switching the OS theme); the web visual baseline regenerated for the expanded drawer; backend and frontend unit tests for the preferences.
  - Evidence: [evidence/1.10.2/](evidence/1.10.2/).

### Changed
- **The Reasoning effort select is always visible** (roadmap 1.10.1, [BA-160](https://halo-powered.atlassian.net/browse/BA-160)), at the user's request: hiding it for models without levels left users unaware it existed. It now shows disabled as `Default — enter a model first` or `Default — not available for this model`, with a hint linked as its accessible description saying why. It is labelled with its own `<label for>`, so its accessible name is exactly "Reasoning effort" (a wrapping label had added the option text, which also matched "Model"). Specs: llm-settings R37 and new R42, the Gherkin "Offers the effort levels of the chosen model", [ui.md](specs/system/ui.md) 4.9. Evidence: [evidence/1.10.1/](evidence/1.10.1/) (three new screenshots, E2E re-run 71 passed).
- **Worktree naming and cleanup rules** ([CLAUDE.md](CLAUDE.md) *Branching convention*, shipped with epic [BA-159](https://halo-powered.atlassian.net/browse/BA-159) at the user's request): a worktree folder must be named after its epic, `.claude/worktrees/<EPIC-ID>-<short-description>`, and an app-created worktree is moved to that name before the first commit; once the PR merges, deleting the worktree folder and branch (and the worktree's isolated resources) is mandatory, with the exact commands. This branch's own worktree keeps its app-given name (`bridge-cse_01DwV7bpMzhV2fENvvXtnvJo`), an exception the user chose. Evidence: documentation only, no app change.

## 2026-10-09

### Added
- **Agent editor with a preview chat** (roadmap 1.9.5, [BA-155](https://halo-powered.atlassian.net/browse/BA-155), epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)):
  - **New agent** on the hub and **Edit** on your own agents open a full-page editor: name, description, instructions, dataset checkboxes (a dataset that no longer exists stays listed as `<name> (missing)`), up to 5 starter questions, a model override and a reasoning effort.
  - **Save** keeps a draft; **Publish** saves and makes it Live. Editing a Live agent shows `Unpublished changes`, and its sessions keep the Live version until you publish. Leaving with unsaved changes asks `Discard unsaved changes?`.
  - **Preview** opens a chat in the Details panel that runs the saved draft. Sending saves the form first. **Reset preview** starts over. Leaving the editor discards the preview with its memory and workspace, and previews left by a crash are swept at the next start.
  - Backend: a preview is an in-memory session (`POST /sessions { agentId, preview: true }`, `DELETE /sessions/:id` → `Preview discarded`), never in the sessions collection (ADR-0008). It runs through the normal chat routes, so the chat component is reused.
  - Specs: agents-evals R1, R5 and R54–R61 and the Feature "Agent editor"; sessions-chat R54; app-shell R3 and R10; [api.md](specs/system/api.md) §2.1 and endpoint 3; [data-model.md](specs/system/data-model.md) §3.12; [agents.md](specs/system/agents.md) Block 5 and `agent-overrides`; [ui.md](specs/system/ui.md) §1.4, §4.4, §4.5 and the new §4.5.1; glossary.
  - Tests: new `frontend/e2e/agent-editor.spec.ts` (8 scenarios, including an axe scan in both themes); two hub scenarios updated; preview tests added to `backend/test/agent-sessions.e2e-spec.ts` (now 9, including the sweep after a restart); 2 backend and 21 frontend unit tests. Full web suite: 68 passed, 2 skipped (desktop only). Desktop not run.
  - Evidence: [evidence/1.9.5/](evidence/1.9.5/).
- **Start a session from an agent** (roadmap 1.9.3, [BA-153](https://halo-powered.atlassian.net/browse/BA-153), epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)):
  - **Start chat** sits on the Official card, on every Live user agent's card and in their detail views. On a Live agent it creates the session at once, named after the agent, over those of its datasets that still exist. On the Official agent it opens the new-session screen. It is disabled when none of the agent's datasets exist.
  - Every turn applies the agent's current Live version: its instructions as a labelled, user-supplied context block after every other block, and its model and reasoning-effort overrides, which apply to the assistant only. This covers chat turns, the grounding pass and deep analysis. A draft never applies. The read-only guard still rejects writes the instructions ask for.
  - The page header shows an **Agent** chip, the session row reads `<agent> · <datasets>`, and the welcome block offers the agent's description and starter questions. When the agent is deleted, its sessions keep their transcript, continue with the plain assistant and read `<name> · agent deleted`.
  - API and data: `POST /sessions` accepts `{ agentId }`; sessions gain optional `agentId` and `agentName` (no migration); every session the API returns carries a derived `agent`. The model resolver takes an optional model override, read by the assistant from the new `agent-overrides` requestContext key.
  - Specs: sessions-chat R52–R59 and the Feature "Sessions started from an agent"; agents-evals R1, R5 and R53; [api.md](specs/system/api.md) §2.1 and endpoint 3; [data-model.md](specs/system/data-model.md) §3.4 and §3.13; [agents.md](specs/system/agents.md) §1.2–1.4 and §4.1–4.2 (Block 5); [ui.md](specs/system/ui.md) §1.2, §1.3, §4.4, §4.5 and §4.12; app-shell R49; glossary.
  - Tests: new `frontend/e2e/agent-sessions.spec.ts` (6 scenarios, driven by a recording LLM stub, `e2e/helpers/llm-stub.ts`, which `llm-settings.spec.ts` now shares); the hub's detail-actions scenario updated; new backend API test `backend/test/agent-sessions.e2e-spec.ts` (7, including a restart), with the backend process harness moved to `test/backend-process.ts`; 10 backend and 17 frontend unit tests. Full web suite: 60 passed, 2 skipped (desktop only). Desktop not run.
  - Evidence: [evidence/1.9.3/](evidence/1.9.3/).
- **Agent Hub screen** (roadmap 1.9.4, [BA-154](https://halo-powered.atlassian.net/browse/BA-154), epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)):
  - The Agents screen is now the Agent Hub, following the mockup:
    - a full-width search over name and description;
    - the filter pills All, Pinned, Official and Mine;
    - card sections Official, Mine and System, three cards to a row with `Show more (<n>)`.
  - Cards show the name, description, owner (`You`, `Official` or `System`), the `Draft`/`Live` chip, `Unpublished changes` and `Missing dataset: <names>`.
  - Pins apply at once, put the card first in its own section, survive a restart, and revert with a toast if saving fails.
  - The detail view gains Publish and Delete (with confirmation) for user agents. **New agent** is shown but disabled until the editor (1.9.5). Start chat arrives with 1.9.3.
  - The old agent list component is removed.
  - Specs: agents-evals R1–R9 rewritten, plus the Feature "Agent Hub"; [ui.md](specs/system/ui.md) §4.4–4.5; glossary.
  - Tests: new `frontend/e2e/agent-hub.spec.ts` (9 scenarios, including an axe scan); `agents.spec.ts` updated for Show more; 12 unit tests for the section and filter logic. Full web suite: 44 passed, 2 skipped (desktop only). Desktop not run.
  - Evidence: [evidence/1.9.4/](evidence/1.9.4/).
- **Agent definitions: storage and API** (roadmap 1.9.2, [BA-152](https://halo-powered.atlassian.net/browse/BA-152), epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)):
  - New `agents` collection and `user-agents` backend module. A user agent keeps a draft and an optional Live version (name, description, instructions, datasets, starter questions, an optional model and reasoning effort) and a pin. Built-in pins live in a `builtin-agent-pins` settings document. No migration.
  - New endpoints: `POST /agents`, `PUT /agents/:id/draft`, `POST /agents/:id/publish`, `DELETE /agents/:id` and `PUT /agents/:key/pin`. `GET /agents` lists built-in and user agents together, with kind, status, owner, pin, unpublished changes and missing datasets. `GET /agents/:key` also resolves user-agent ids. Built-in agents can't be edited or deleted.
  - Specs: rules R43–R52 and the Feature "Agent definitions (API)" in [specs/capabilities/agents-evals/spec.md](specs/capabilities/agents-evals/spec.md); [api.md](specs/system/api.md) endpoints 41–45 (later ones renumbered 46–57); [data-model.md](specs/system/data-model.md) §3.2 and §3.10; glossary terms for user, official and system agents, draft, Live and pin.
  - Tests: backend e2e `backend/test/user-agents.e2e-spec.ts` (9 tests, including a real backend restart on the same data dir) and 23 new unit tests. The Agents screen is unchanged; `agents.spec.ts` still passes 9/9.
  - Test harness: `E2E_BACKEND_PORT` lets the Playwright suite run beside a desktop app that holds port 3000 ([tech-stack.md](specs/system/tech-stack.md)).
  - Evidence: [evidence/1.9.2/](evidence/1.9.2/).
- **Agent Hub planned** (roadmap 1.9.1, [BA-151](https://halo-powered.atlassian.net/browse/BA-151), epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)):
  - New epic spec [specs/epics/BA-150/spec.md](specs/epics/BA-150/spec.md), confirmed by the user. Users build agents on top of the assistant (instructions, datasets, starter questions, model override), test them as drafts, publish them, pin them and start chats from them. The Agents screen becomes a hub with the filters All, Pinned, Official and Mine, plus a System section for the helper agents.
  - ADR-0008 in [specs/system/architecture.md](specs/system/architecture.md): a user agent is a stored configuration (a draft and a Live version) applied to the assistant on each turn, not an agent registered at runtime. So the read-only guard and the grounding checks always hold.
  - Milestone 1.9 in [roadmap.md](roadmap.md), with one feature per story (1.9.1–1.9.5), and the epic row in [specs/README.md](specs/README.md).
  - Decisions: teams, the org and sharing are out (the app stays local-first); the epic is inside the 1.0 Beta; the hub UI is built with today's styles and restyled later by BA-141.
  - Evidence: [evidence/1.9.1/](evidence/1.9.1/).
- **Aligned with the Insight Agent AI Figma design** (roadmap 1.8.8, [BA-158](https://halo-powered.atlassian.net/browse/BA-158), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - Light tokens now come from the Figma variables (brand `#0B41AD`, text `rgba(0,0,0,.85)`, headings `#001F52`, radius 12, Figma shadows), and the navy dark set is re-derived from them.
  - Shell: the Figma's teal gradient frame with its texture, a 64 px translucent rail (menu, logo, workspace items, avatar, system logs, Settings, divider, LenAI mark and "Powered by LenAI"), and a 136 px banner with the Figma image, still reading "Agentic Hub".
  - The menu button expands the rail into a 240 px drawer with labels and the session list. This replaces the 1.8.5 session pane; choosing Sessions opens it.
  - The Sessions area has a page header: an icon, a 24 px light title, the datasource context and "Start New Conversation".
  - The details panel is closed on launch and opens on demand: a dataset element, an eval question, a visual, or "Expand right panel".
  - Chat restyled to the Figma: the user bubble with an avatar, answers with the sparks mark at 16/24 px, Figma tables, "Data used" styled as the Data Sources row, feedback icons always visible, the bordered prompt, and the AI disclaimer.
  - Buttons are 40 px tall at 14 px. Screen titles are 24 px light.
  - The 19 Figma assets are in `frontend/public/brand/agentic-hub/`, with the photos re-encoded as WebP (8.4 MB → 0.5 MB).
  - Specs: app-shell R1–R4, R10, R37 and R46–R49 with new Navigation rail scenarios; agents-evals R37 and its scenario; [ui.md](specs/system/ui.md) §1, §3, §4.12, §6, §7 and §9; sessions-chat UI; api.md `window:theme`; tech-stack.md.
  - Evidence (with a side-by-side against the Figma): [evidence/1.8.8/](evidence/1.8.8/).
- **Chat, visual panel, system logs and toasts in both themes** (roadmap 1.8.7, [BA-148](https://halo-powered.atlassian.net/browse/BA-148), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - The session chat (including its `.prose-dark` Markdown styles and tooltips), the interactive visual panel frame, the system logs dialog, toasts and the backend banner now use theme tokens and the shared classes.
  - Toasts sit in a "Notifications" region (`aria-live="polite"`) with a "Dismiss notification" button (app-shell R30).
  - `SessionChat` unit tests assert token classes.
  - ui.md is synced to tokens throughout: §2 conventions, §3 shared components, §4 screens, §6.1 colour usage (the legacy dark palette section is retired) and §8.
  - Evidence: [evidence/1.8.7/](evidence/1.8.7/).
- **Feature screens in both themes** (roadmap 1.8.6, [BA-147](https://halo-powered.atlassian.net/browse/BA-147), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - These screens now use only theme tokens and the shared `btn`, `chip`, `card`, `field`, `menu` and `list-row` classes: datasets, the catalog browser, metrics, entity details, agents (list, detail, eval trace), knowledge, and the datasource, LLM, testing-data and developer settings. The dataset editor header now wraps.
  - New E2E scenario: axe finds no violations on any screen in Light or Dark.
  - Fixed along the way: names for the Datasets and Agents search, layout and row-options buttons.
  - Evidence: [evidence/1.8.6/](evidence/1.8.6/).
- **Collapsible Sessions list pane** (roadmap 1.8.5, [BA-146](https://halo-powered.atlassian.net/browse/BA-146), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - The pane has "Collapse session list" / "Expand session list" (not remembered between launches).
  - Rows show the session's datasets under its name, and the empty list reads "No sessions yet."
  - The new-session composer uses tokens and shared classes.
  - Specs: app-shell R46, R47 and R37, plus the Navigation rail scenario "Collapses and expands the session list".
  - Evidence: [evidence/1.8.5/](evidence/1.8.5/).
- **Agentic Hub shell: gradient frame, banner and navigation rail** (roadmap 1.8.3, [BA-144](https://halo-powered.atlassian.net/browse/BA-144), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - The 296 px sidebar is replaced by a gradient frame. The always-visible icon rail holds Datasets, Agents, Knowledge and Sessions at the top, and the avatar, system logs and Settings at the bottom. Beside it, a canvas card holds the 72 px "Agentic Hub" banner (the page's only `h1`) over the page card (`main`) and the details panel card. The collapse and expand sidebar controls are gone.
  - **Sessions** is now a rail area, with a list pane beside the composer or chat.
  - **Settings** is now a rail area, with a section list beside the chosen form. "Back" is gone, and leaving and returning keeps the chosen section.
  - The window and document titles read "Agentic Hub". The OS app name, installers and data directory stay "Halo BI Assistant".
  - Theme switches suppress transitions for one frame, so every surface changes at once. Screen titles are now `h2`.
  - Specs: app-shell R1–R7, R32, R33, R36, R37 and R46, the new Feature "Navigation rail" (`frontend/e2e/navigation.spec.ts`), [ui.md](specs/system/ui.md) §1, §3.4, §7, §8, §9 and §10, and the sidebar references in the datasets, knowledge, metrics, diagnostics, sessions-chat, llm-settings, developer-settings and datasources specs, plus vision.md and non-functional N59/N60.
  - The web visual baseline is regenerated. Merged `main` (BA-156, E2E on the web target) and moved the Appearance spec to `app.fixture`.
  - Evidence: [evidence/1.8.3/](evidence/1.8.3/).
- **Shared component classes** (roadmap 1.8.4, [BA-145](https://halo-powered.atlassian.net/browse/BA-145), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - Tailwind v4 `@utility` classes in [frontend/src/styles/components.css](frontend/src/styles/components.css), built from the theme tokens only: pill buttons (`btn` with primary, secondary, outline, ghost and danger variants, plus `btn-icon`), status chips (`chip-warning|info|neutral|success|danger`), `card`, `card-muted`, `list-row`, `filter-pill`, `field`, `field-label`, `section-header`/`section-title` and `menu`/`menu-item`.
  - Documented in [ui.md](specs/system/ui.md) §3.6. The Appearance section now uses `card` and `field-label`.
  - Evidence: [evidence/1.8.4/](evidence/1.8.4/).
- **Light and dark themes with an Appearance setting** (roadmap 1.8.2, [BA-143](https://halo-powered.atlassian.net/browse/BA-143), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - Settings → **Appearance** (fifth section) offers System, Light and Dark. System is the default and follows the OS live. The choice applies at once and is kept in `localStorage` under `questions-to-insights:theme`.
  - Semantic theme tokens with a light set and an approved navy dark set, in [frontend/src/styles/tokens.css](frontend/src/styles/tokens.css), mapped into Tailwind v4 with `@theme inline` (ADR-0007). Every text pair meets WCAG AA in both themes.
  - An inline boot script in `index.html` applies the theme before the app renders. `ThemeService` keeps it in sync. The desktop window background follows the theme through the new `desktop.setWindowTheme` / `window:theme` IPC.
  - Noto Sans (`@fontsource/noto-sans` 5.3.0) is bundled and is now the app's font.
  - Only the page background and the Appearance section use the tokens so far. The other screens move over in 1.8.3–1.8.7.
  - Specs: app-shell R39–R45 and Feature "Appearance" (`frontend/e2e/appearance.spec.ts`, new), [ui.md](specs/system/ui.md) §4.16, §6.0 and §6.5, and updates to [data-model.md](specs/system/data-model.md), [api.md](specs/system/api.md), [tech-stack.md](specs/system/tech-stack.md) and [non-functional.md](specs/product/non-functional.md) N64.
  - The E2E helper `createWorldCupDatasource` honours `WORLD_CUP_DB_PORT`, so a worktree can run the suite against its own compose stack.
  - Evidence: [evidence/1.8.2/](evidence/1.8.2/).
- **Agentic Hub look and feel planned** (roadmap 1.8.1, [BA-142](https://halo-powered.atlassian.net/browse/BA-142), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - New epic spec [specs/epics/BA-141/spec.md](specs/epics/BA-141/spec.md), confirmed by the user. It plans a light theme and a navy dark theme (System by default), a gradient frame, an "Agentic Hub" banner, an icon rail, a sessions list pane and pill and chip components. Only the look changes.
  - ADR-0007 in [specs/system/architecture.md](specs/system/architecture.md): semantic design tokens mapped into Tailwind v4, a System / Light / Dark preference applied before first paint, and a bundled webfont.
  - Milestone 1.8 in [roadmap.md](roadmap.md), with one feature per story (1.8.1–1.8.7), and the epic row in [specs/README.md](specs/README.md).
  - Decisions: `productName`, the installers and the data directory stay "Halo BI Assistant"; only the window title, document title and settings footer become "Agentic Hub". The mockup's "Powered by LenAI" footer is left out.
  - Evidence: [evidence/1.8.1/](evidence/1.8.1/).

### Fixed
- **Reopening a session showed its transcript as it was before that visit's turns** (found while building roadmap 1.9.3, [BA-153](https://halo-powered.atlassian.net/browse/BA-153)): the session list kept the copy loaded before the first turn. A finished turn now refreshes the shell's copies (`SessionChat` emits `sessionUpdated`; same id, so an in-flight stream is never disturbed). Covered by `agent-sessions.spec.ts` "deleting the agent keeps its sessions on the plain assistant". Evidence: [evidence/1.9.3/](evidence/1.9.3/).
- **Agent Hub's active filter pill readable in dark** (roadmap 1.9.4, [BA-154](https://halo-powered.atlassian.net/browse/BA-154), epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)):
  - Merging `main` (v0.25.0, BA-141) moved the hub onto the theme tokens. The shared `filter-pill-active` kept `primary` text, which is 4.34:1 on the selected fill in dark, so the axe scan failed. It now uses `on-primary-soft` in both themes (`components.css`, [ui.md](specs/system/ui.md) §3).
  - Full web suite after the merge: 54 passed, 2 skipped (desktop only). Desktop not run.
  - Evidence: [evidence/1.9.4/](evidence/1.9.4/) (`merge-main-*`).
- **Shared component classes could lose to Tailwind's base reset** (roadmap 1.8.4, [BA-145](https://halo-powered.atlassian.net/browse/BA-145)):
  - The classes in `frontend/src/styles/components.css` moved from `@utility` to `@layer components` and now reference the raw `--qti-*` tokens, so utilities on the same element override them without `!`.
  - `index.html` declares `@layer theme, base, components, utilities;` before anything else. Otherwise Angular's inlined critical CSS can name `components` first, and Tailwind's button reset then wins.
  - Evidence: the screenshots in [evidence/1.8.6/](evidence/1.8.6/).

### Changed
- **The E2E suite can run against any World Cup database** (with roadmap 1.9.5, [BA-155](https://halo-powered.atlassian.net/browse/BA-155)): `E2E_WORLD_CUP_DB_*`, loaded from a git-ignored `.env.e2e.local`, point the suite at a database such as a per-worktree one from the infra MCP service, and global setup then leaves Docker alone. The helpers derive catalog test ids and entity keys from the database name, and the read-only guard scenario counts rows over SQL instead of `docker exec`. Defaults are unchanged (the compose database). See [tech-stack.md](specs/system/tech-stack.md). Evidence: [evidence/1.9.5/](evidence/1.9.5/) (the whole run used such a database).
- **Agent Hub branch synced with `main`** (epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)): merged BA-156's web E2E harness into `feat/BA-150-agent-hub`. The `E2E_BACKEND_PORT` option added under 1.9.2 is removed, because the web target already gives each test its own free port and data dir. 1.9.2's checks were re-run on the web target; see [evidence/1.9.2/](evidence/1.9.2/).
- **E2E and testing run against the web app; the desktop app only on request** (roadmap 0.2.6, [BA-156](https://halo-powered.atlassian.net/browse/BA-156), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)):
  - CLAUDE.md *Test target convention*: during epic development, E2E, evidence screenshots and manual checks use the web app built from the epic branch. Desktop runs only when the user asks; otherwise the evidence and PR list desktop as not run. Workflow step 9, the Evidence and E2E conventions point at it.
  - Playwright now has two projects sharing [`e2e/fixtures/app.fixture.ts`](frontend/e2e/fixtures/app.fixture.ts), which replaces `electron.fixture.ts`. `web` (the default, `npm run test:e2e`) starts the npm CLI per test on a free port and a temp data dir and drives it in Chromium at 1440×900. `desktop` (`npm run test:e2e:desktop`) launches Electron as before. The port-3000 check moved into the desktop launch, so web runs never need that port.
  - Desktop-only tests are skipped on web with "Desktop only: …": the diagnostics redaction and export test, and the "Restart backend" test. New browser scenarios cover the "Restart the CLI to apply" notice and a CLI restart. The observability export and LLM-settings relaunch tests restart or relaunch according to the target.
  - New web visual baseline `application-shell-web-linux.png`.
  - Specs: Gherkin in [developer-settings](specs/capabilities/developer-settings/spec.md) and [diagnostics](specs/capabilities/diagnostics/spec.md) (`@desktop-only` tags), plus [delivery.md](specs/system/delivery.md), [tech-stack.md](specs/system/tech-stack.md), [ui.md](specs/system/ui.md) and the READMEs.
  - Web suite: 35 passed, 2 skipped (desktop only). Desktop not run. Evidence: [evidence/0.2.6/](evidence/0.2.6/).
- **One branch, one worktree and one PR per epic** (roadmap 0.2.5, [BA-149](https://halo-powered.atlassian.net/browse/BA-149), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)):
  - CLAUDE.md *Branching convention*: all of an epic's stories are built on one branch, `<type>/<EPIC-ID>-<short-description>`, in one worktree, and ship as one PR that lists every story. Commits stay scoped to their story. The branch type is the highest-impact commit type in the epic.
  - Bugs: a Bug whose epic has an open branch is fixed there. A Bug against shipped work keeps its own `fix/<BUG-ID>` branch and PR.
  - Workflow step 3 and the Epic gate now point at the epic branch. [specs/system/delivery.md](specs/system/delivery.md) explains the version bump for a mixed-type epic PR. Story added to [specs/epics/BA-89/spec.md](specs/epics/BA-89/spec.md).
  - Evidence: [evidence/0.2.5/](evidence/0.2.5/).

## 2026-10-05

### Added
- **Developer guide for local observability** (roadmap 0.3.7, [BA-118](https://halo-powered.atlassian.net/browse/BA-118), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - [docs/observability.md](docs/observability.md) covers starting Phoenix and Grafana, turning on **Settings → Developer → Developer observability** and restarting, and where to find each signal: Phoenix projects, Tempo search and TraceQL, Loki with its "Trace: <id>" link, and Prometheus. It also covers turning it off and troubleshooting (ingest lag, unreachable endpoints, worktree isolation).
  - Linked from README *Development*.
  - Verified by following it with the npm CLI against the real tools.
  - Evidence: [evidence/0.3.7/](evidence/0.3.7/).
- **Developer observability now exports backend logs, linked to their traces** (roadmap 0.3.6, [BA-117](https://halo-powered.atlassian.net/browse/BA-117), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - When the active developer setting is on, the OpenTelemetry SDK also exports logs to `<OTLP endpoint>/v1/logs`.
  - Nest logs: [`developer-nest-logger.ts`](backend/src/infrastructure/telemetry/developer-nest-logger.ts) wraps `ConsoleLogger.prototype.printMessages`. Each line prints exactly as before and is also emitted as a log record.
  - Mastra's Pino logs: sent through `@opentelemetry/instrumentation-pino`, with stdout field injection disabled.
  - A line logged during a request or agent run carries that trace's id. Verified in real Grafana: a Loki line resolves to its Tempo trace.
  - Console output is byte-identical whether the setting is on or off, so the desktop system-logs panel is unaffected.
  - **Scope change:** `nestjs-pino` was dropped from the plan, because it would have turned the console output into JSON even with the setting off.
  - Specs: R24–R26 and a logs scenario in [specs/capabilities/developer-settings/spec.md](specs/capabilities/developer-settings/spec.md), plus tech-stack.md and the container diagram.
  - Evidence: [evidence/0.3.6/](evidence/0.3.6/).
- **Developer observability now sends agent traces to Arize Phoenix** (roadmap 0.3.5, [BA-116](https://halo-powered.atlassian.net/browse/BA-116), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - When the active developer setting is on, [`backend/src/mastra/developer-exporters.ts`](backend/src/mastra/developer-exporters.ts) adds `@mastra/arize`'s `ArizeExporter` next to `MastraStorageExporter`. It sends OpenInference spans in OTLP protobuf to `<Phoenix endpoint>/v1/traces`, under the project `questions-to-insights`.
  - `observability.duckdb` keeps receiving every trace. When the setting is off, the exporter is never `require`d, so no OpenTelemetry module loads.
  - Specs: R21–R23 and a Phoenix scenario in [specs/capabilities/developer-settings/spec.md](specs/capabilities/developer-settings/spec.md), agents.md §1.7, tech-stack.md (`@mastra/arize` 1.3.16, pinned to match `@mastra/observability` 1.17.8), and the container diagram.
  - Verified against real Phoenix: the `questions-to-insights` project shows the assistant's `invoke_agent` → model and memory spans.
  - Evidence: [evidence/0.3.5/](evidence/0.3.5/).
- **Developer observability now exports backend traces and metrics to an OTLP endpoint** (roadmap 0.3.4, [BA-115](https://halo-powered.atlassian.net/browse/BA-115), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - When the active developer setting is on, `main.ts` and `cli.ts` start the OpenTelemetry Node SDK **before** they import the app. It instruments HTTP, Express, NestJS, `pg` and undici, with fs, dns and net disabled. Traces go to `<OTLP endpoint>/v1/traces` and metrics every 10 s to `/v1/metrics`, both in OTLP protobuf, as `questions-to-insights`.
  - When the setting is off, nothing from OpenTelemetry is imported and nothing is sent. A failure to start logs one warning, and the backend runs without telemetry.
  - Code: [`backend/src/infrastructure/telemetry/developer-telemetry.ts`](backend/src/infrastructure/telemetry/developer-telemetry.ts). New pinned dependencies: `@opentelemetry/*` 0.222.0 / 2.11.0, `auto-instrumentations-node` 0.80.0.
  - Specs: R17–R20 and the Feature "Developer observability export" (`frontend/e2e/developer-observability.spec.ts`) in [specs/capabilities/developer-settings/spec.md](specs/capabilities/developer-settings/spec.md). The packages are listed in tech-stack.md, and the container diagram shows the developer-only OTLP edge.
  - Verified against real Grafana: Tempo shows http → NestJS → `pg.query` spans.
  - Evidence: [evidence/0.3.4/](evidence/0.3.4/).
- **Settings → Developer: a developer observability switch with restart to apply** (roadmap 0.3.2, [BA-113](https://halo-powered.atlassian.net/browse/BA-113), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - **Settings:** a fourth row, "Developer", holds the "Developer observability" switch (off by default) and editable Phoenix (`http://localhost:6006`) and OTLP (`http://localhost:4318`) endpoints. The form and the backend both reject a value that isn't an http(s) URL.
  - **Test:** probes the typed endpoint from the backend with an empty OTLP protobuf export to `/v1/traces`. It reports "Reachable", a wrong status, or "Unreachable".
  - **Storage:** the setting is saved to `<APP_DATA_DIR>/developer-settings.json` (atomic write), not the document store, so entry points can read it before bootstrap (ADR-0006).
  - **Applying it:** the backend keeps the copy it read at startup as the active setting. A "Restart to apply" notice appears while the saved setting differs from it. In the desktop app, **Restart backend** respawns the backend through a new `backend:restart` IPC channel, outside the crash-restart budget. The browser (npm CLI) shows "Restart the CLI to apply" instead.
  - **Scope:** nothing is exported yet. The exporters arrive in 0.3.4–0.3.6.
  - **API:** new `GET`/`PUT /developer-settings` and `POST /developer-settings/test-endpoint`.
  - **Specs:** the new [developer-settings](specs/capabilities/developer-settings/spec.md) capability (Gherkin + `frontend/e2e/developer-settings.spec.ts`), plus api.md, data-model.md, ui.md §4.12, app-shell R5, the glossary and tech-stack.md.
  - Evidence: [evidence/0.3.2/](evidence/0.3.2/).
- **Opt-in `observability` Docker Compose profile** (roadmap 0.3.3, [BA-114](https://halo-powered.atlassian.net/browse/BA-114), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - `docker-compose.yml` gains `phoenix` (`arizephoenix/phoenix:version-20.19.0`, port 6006) and `otel-lgtm` (`grafana/otel-lgtm:0.35.0`; Grafana on 3001, OTLP gRPC 4317, OTLP HTTP 4318), each behind `profiles: [observability]`. Host ports are overridable. A plain `docker compose up` and the E2E global setup still start only Postgres.
  - Verified against the real images: Phoenix UI 200, Grafana health ok, OTLP HTTP `/v1/traces` 200 on both. Phoenix accepts OTLP protobuf only (JSON gets 415), which 0.3.5 must account for.
  - Documented in [specs/system/delivery.md](specs/system/delivery.md) (section 6 and the isolation table in section 7) and in the CLAUDE.md *Worktree deploy convention*.
  - Evidence: [evidence/0.3.3/](evidence/0.3.3/).
- **Local development observability is planned** (roadmap 0.3.1, [BA-112](https://halo-powered.atlassian.net/browse/BA-112), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - New Jira epic BA-111 with stories BA-112 to BA-118, mirrored as roadmap Milestone 0.3 (features 0.3.1–0.3.7).
  - **ADR-0006** in [specs/system/architecture.md](specs/system/architecture.md):
    - Arize Phoenix and Grafana `otel-lgtm` are used only when a Developer setting is on. It is off by default.
    - The setting is stored as a file under `APP_DATA_DIR`, so the entry points can read it before the app loads.
    - Exporters are added next to the DuckDB store, not instead of it.
    - Changes apply on restart.
  - The epic spec [specs/epics/BA-111/spec.md](specs/epics/BA-111/spec.md) is confirmed by the user and listed in [specs/README.md](specs/README.md).
  - No product code changed.
  - Evidence: [evidence/0.3.1/](evidence/0.3.1/).
- **PRs into `main` need an approving review; only the repo owner can merge without one** (roadmap 0.2.4, [BA-110](https://halo-powered.atlassian.net/browse/BA-110), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)):
  - A second ruleset, "main: PR approval, admin may merge without", requires a PR with 1 approving review and dismisses stale approvals. The *Repository admin* role bypasses it in *pull requests only* mode, so the owner can merge without approval but can't push directly to `main`. The spec-check ruleset is unchanged and still applies to everyone.
  - [`version-on-merge.yml`](.github/workflows/version-on-merge.yml) now pushes its release commit and tag over SSH with a repo-scoped write deploy key (`RELEASE_DEPLOY_KEY` secret). Deploy keys are on the new ruleset's bypass list, because GitHub Actions can't be in a personal-account repo.
  - Documented under *Branch rulesets on `main`* and *Release push* in [specs/system/delivery.md](specs/system/delivery.md), in the BA-89 epic spec, and as a **Review** bullet in the CLAUDE.md *Branching convention*.
  - Evidence: [evidence/0.2.4/](evidence/0.2.4/).

### Fixed
- **LLM API key no longer lost or broken when the app secret changes** (roadmap 1.7.9, [BA-106](https://halo-powered.atlassian.net/browse/BA-106), epic [BA-11](https://halo-powered.atlassian.net/browse/BA-11)):
  - Found from a desktop diagnostics report: the first launch of a data dir after Electron started persisting `.app-secret` (commit `a3ef363`) could not read a key saved under the backend's fixed development secret. `GET /llm/settings` failed with `Unsupported state or unable to authenticate data` (a 500), and so did every agent turn.
  - [`crypto.service.ts`](backend/src/infrastructure/crypto/crypto.service.ts): a backend started without `APP_SECRET` now reads or creates `<APP_DATA_DIR>/.app-secret` (mode 0600), like Electron main and the CLI. The fixed development secret is never used to encrypt again. `decrypt` throws `UnreadableSecretError`, and `reencryptFormerSecret` re-encrypts a value only the former development secret opens.
  - [`llm.service.ts`](backend/src/modules/llm/llm.service.ts): at startup a key under the former development secret is re-encrypted with the current one (migration M11). A key no known secret opens is reported as `configured: false`, `keyUnreadable: true` with provider, model and base URL kept. Agent calls, and tests or saves without a typed key, fail with a "re-enter the key" message instead of the crypto error.
  - LLM Configuration screen: an amber notice asks for the key again and the other fields stay filled. It clears after a successful save.
  - `.app-secret` added to `.gitignore`, because a bare backend run now writes one into `backend/data/`.
  - Specs: R11 rewritten and R33–R35 plus two scenarios in [specs/capabilities/llm-settings/spec.md](specs/capabilities/llm-settings/spec.md) (its Feature now has an E2E file); api.md (`keyUnreadable`, no more 500), data-model.md (2.3, app-secret owner, M11), non-functional.md (N15, N16a; open question resolved), delivery.md and ui.md.
  - Tests: new `frontend/e2e/llm-settings.spec.ts` (4 scenarios against a local LenAI stub), `crypto.service.spec.ts`, and new cases in `llm.service.spec.ts`. The E2E fixture gained `launchElectronApp` / `readyWindow` so a spec can relaunch the app on the same data dir.
  - Evidence: [evidence/1.7.9/](evidence/1.7.9/).
- **Merging no longer starts an installer build** (roadmap 0.2.4, [BA-110](https://halo-powered.atlassian.net/browse/BA-110)). The first release after the rollout (v0.20.7) pushed its tag with the deploy key, and `build-desktop.yml` runs on any pushed `v*` tag, so an installer build started on its own. It was cancelled before publishing a release. [`version-on-merge.yml`](.github/workflows/version-on-merge.yml) now pushes the tag with `GITHUB_TOKEN`, whose pushes start no workflows. Only the branch pushes use the deploy key. The *Chaining* row in [specs/system/delivery.md](specs/system/delivery.md) is corrected. Evidence: [evidence/0.2.4/release-run.txt](evidence/0.2.4/release-run.txt).

## 2026-10-04

### Changed
- Roadmap 0.1.1 (the renderer ignoring a non-default `BACKEND_PORT`) is now **1.7.20** under Bug Fixes. It is tracked as Jira bug [BA-109](https://halo-powered.atlassian.net/browse/BA-109) under epic BA-11, because Milestone 0.1 has no epic and the Epic gate would block it. 0.1.1 is marked `🚫 Cut` with a pointer to the new entry. References in CLAUDE.md, the BA-11 epic spec and the specs (`non-functional.md`, `delivery.md`, `api.md`) are updated. Evidence: docs only; `python3 scripts/check-specs.py` passes and the spec check is green on the PR.

### Added
- **The spec check is now required on `main`** (roadmap 0.2.3, [BA-108](https://halo-powered.atlassian.net/browse/BA-108)):
  - A repository ruleset requires "Specs match the code" before a PR can merge. Direct pushes without that status are rejected.
  - [`version-on-merge.yml`](.github/workflows/version-on-merge.yml) still pushes its release commit straight to `main`. Before pushing, it runs `scripts/check-specs.py` on the bump commit, stages the commit on `release-staging/<sha>` and reports the status itself.
  - Documented under *Branch ruleset on `main`* in [specs/system/delivery.md](specs/system/delivery.md).
  - Evidence: [evidence/0.2.3/](evidence/0.2.3/).
- **Rebuildable system specs** (roadmap 0.2.2, [BA-90](https://halo-powered.atlassian.net/browse/BA-90), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)). New [specs/](specs/README.md) tree, written so an LLM given only that folder can rebuild the app:
  - product specs: vision, glossary, non-functional requirements;
  - system specs: architecture, tech stack, data model, API (all 52 routes, the chat stream, IPC, CLI), agents (every prompt, tool and model rule), UI and delivery;
  - 13 capability specs, each with rules, edge cases, contracts and Gherkin;
  - epic specs for all BA epics. The existing ones are `Status: Draft` until their owners confirm them.

  [specs/README.md](specs/README.md) defines the formats, the stack-neutrality rule, the lifecycle, the files a rebuild copies verbatim, and the rebuild prompt. Evidence: [evidence/0.2.2/](evidence/0.2.2/).
- CLAUDE.md **Epic gate**: no code change without a Jira epic. Every epic gets a spec at `specs/epics/<EPIC-ID>/spec.md`, confirmed before its stories start.
- CLAUDE.md **Spec convention**: specs change on the same branch as the code, so `main` always describes the shipped app.
- **Spec checks in CI:** [`.github/workflows/spec-checks.yml`](.github/workflows/spec-checks.yml) runs [`scripts/check-specs.py`](scripts/check-specs.py) on every PR and every push to `main`. It fails when a backend route, collection, agent, Playwright spec, capability or roadmap epic has no spec, or a link breaks. It is the repo's first pull-request check. A drift test with 7 faults injected failed all 7 matching checks: [evidence/0.2.2/check-specs-negative-test.txt](evidence/0.2.2/check-specs-negative-test.txt).
- Roadmap Milestone 0.2 now mirrors the new Jira epic BA-89 (Delivery Process). BA-84 is linked to it in Jira.
- The user waived confirmation, as a one-time exception, for the eight draft epic specs (BA-2, BA-4, BA-5, BA-9, BA-10, BA-11, BA-12, BA-82). Their stories, including the new bugs, can start. The exception is recorded under *Epic gate* in [CLAUDE.md](CLAUDE.md) and in each spec's status line.
- Filed the backfill's 10 likely bugs and 7 security gaps as Jira bugs BA-91 to BA-107 under BA-11. They are mirrored in roadmap Milestone 1.7 as features 1.7.3 to 1.7.19, security first. Details: [evidence/0.2.2/findings.md](evidence/0.2.2/findings.md).

### Changed
- `architecture.md` moved to [specs/system/architecture.md](specs/system/architecture.md).
- The five Gherkin Features moved verbatim from `gherkin.md` into their capability specs. The *Gherkin convention* became part of the *Spec convention*, and the E2E convention now mirrors the capability specs.
- CLAUDE.md went from 329 to about 170 lines. Its how-it-works sections (Electron delivery, versioning, npm package, folder layout, datastore, Mastra, visuals) moved into `specs/system/` and were checked against the code. A short *Code rules* list replaces them. Workflow steps 3, 4, 5, 9 and 10 and the worktree deploy convention were updated. Drift fixed:
  - Docker is started by the E2E global setup.
  - Only the Electron main process reads `BACKEND_PORT`.
  - Desktop isolation uses `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR`.
- README.md now links to `specs/` instead of CLAUDE.md for packaging and architecture details.
- Roadmap 0.2.1 (BA-84) marked `✅ Done`; it merged in PR #43.

### Removed
- `gherkin.md`. Every scenario now lives in exactly one capability spec.

## 2026-10-01

### Added
- Adopted the eleven-step delivery workflow in [CLAUDE.md](CLAUDE.md) (retrospective-first, roadmap → ADR → Gherkin → E2E impact analysis → tests-first → implement → green → changelog + evidence → retrospective) and seeded [roadmap.md](roadmap.md), [architecture.md](architecture.md), [gherkin.md](gherkin.md), [retrospective.md](retrospective.md), [evidence/](evidence/).
- Filled in the harness resources that were still missing: C4 Mermaid diagrams for all four levels in [architecture.md](architecture.md) (system context, containers, backend + frontend components, visual tailoring loop); Given/When/Then steps for all 20 scenarios in [gherkin.md](gherkin.md).
- Corrected [CLAUDE.md](CLAUDE.md) where it had drifted from the code:
  - The frontend is not routed yet. Features have no `pages/`, routes or store, and some `core/` folders are empty placeholders.
  - Lists every registered Mastra agent, plus the DuckDB observability store and the `infrastructure/crypto` key encryption.
  - Visuals: spec-first designer with a freeform fallback, the full version-folder file list inside the session workspace, and the tailor/refresh/repair endpoints.
  - The chat stream is `POST …/messages/stream` read with `fetch`.
  - Flags the hardcoded renderer port as a known gap.
- Added the **Branching convention** to [CLAUDE.md](CLAUDE.md): every PR is built in its own `<type>/<US-ID>-<short-description>` feature branch and git worktree, tied to an existing Jira user story.
- Roadmap: imported the **1.0 Beta** plan from Jira BA (target 2026-10-31) as Release 1. There are 7 milestones (one per epic: Evals, Data Model DSL, Knowledge Store, Reliability Signals, Data Connectors, User Testing, Bug Fixes) and 13 features, linked to the BA issues. Agent Routines (BA-82) is in the Backlog.
- Roadmap: added Release 0 / Milestone 0.1 with 0.1.1, the renderer ignoring `BACKEND_PORT` (`📋 Planned`).
- Evidence: process/docs-only change, no code or UI change. Diagrams rendered cleanly with `@mermaid-js/mermaid-cli` v12.

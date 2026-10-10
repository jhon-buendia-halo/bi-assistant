# App shell

The app shell is the frame every other capability lives in: a navigation rail, an "Agentic Hub" banner, a main area, a collapsible and resizable right-hand details panel, a status banner that tells the user when the local backend is not healthy, transient toast messages, and the system logs overlay. It must stay usable from the keyboard, free of automatically detectable accessibility violations, and visually stable. Detailed layout, spacing and design tokens belong to [../../system/ui.md](../../system/ui.md); this file owns the behaviour.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): session, dataset, datasource, entity, diagnostics (System logs), eval run.

Capability-local vocabulary, used only for UI words:
- **Navigation rail** — the narrow, always-visible left column of icon buttons: the four workspace areas at the top, and the account avatar, system logs and Settings at the bottom.
- **Area** — what the rail selects: Datasets, Agents, Knowledge, Sessions or Settings. Sessions and Settings show a list pane beside their content.
- **Main view** — what the central area shows: home (empty), Datasets, dataset editor, Agents, an agent's detail, Knowledge, the Sessions area (with nothing open), new-session composer, a session's chat, or a Settings section.
- **Details panel** — the right-hand column. What it shows depends on the main view (see R14).
- **Backend status** — one of `starting`, `ready`, `restarting`, `down`, reported by the desktop shell's backend supervisor.

## Rules

Layout and navigation
- R1. The system SHALL present, left to right: the navigation rail (expandable into a drawer, R48), then a column holding the "Agentic Hub" banner above the page and, when open, the details panel. Everything sits inside a textured gradient frame.
- R2. On launch the navigation drawer SHALL be collapsed, the details panel SHALL be collapsed and the main view SHALL be home. Neither the drawer nor the details panel state SHALL be remembered between launches.
- R3. The rail SHALL offer, under "Workspace navigation", one icon button each, named by its title and accessible name: **Datasets**, **Agents**, **Knowledge** and **Sessions**. Choosing one SHALL show that area and mark its button current (`aria-current="page"`). Choosing the area that is already shown SHALL keep it. Agents stays current while an agent's detail is open, Datasets while the dataset editor is open, and Sessions while the composer or a chat is open. Choosing **Sessions** SHALL also expand the drawer, so the session list is visible.
- R4. Below the workspace items the rail SHALL offer the account avatar (a static "D", titled "Demo User"), **Open system logs** (tooltip "System logs and diagnostics") and **Settings**, then a divider and the LenAI mark with "Powered by LenAI". The system-logs button SHALL show a red badge with the number of error and warning entries currently retained when that number is above zero, capped at "99+".
- R5. Choosing **Settings** on the rail SHALL show the Settings area: a list pane with "Settings navigation" offering five sections, **Datasource Configuration**, **LLM Configuration**, **Testing Data**, **Developer** ([../developer-settings/spec.md](../developer-settings/spec.md)) and **Appearance** (R39–R45), beside the chosen section's form. Choosing a section SHALL show it and mark it current; choosing the current section again SHALL deselect it and show the prompt "Choose a settings section." Choosing another rail area SHALL leave Settings; coming back SHALL show the section that was chosen.
- R6. Removed in roadmap 1.8.3: the rail cannot be collapsed. (Previously: the Collapse sidebar and Expand sidebar controls.)
- R7. The banner SHALL be the page's only level-one heading and SHALL read "Agentic Hub". Screen titles ("Datasets", "Agents", a settings section…) are level-two headings.
- R8. The sidebar and details panel SHALL keep a fixed minimum usable width for the main area (see R12) so the main content is never squeezed to nothing.

Details panel: collapse and resize
- R9. The system SHALL provide a **Collapse right panel** control inside the details panel. When collapsed, the panel and its resize separator SHALL be hidden and the top bar SHALL show an **Expand right panel** control at its right edge.
- R10. The details panel SHALL open (if collapsed) whenever the user selects a dataset element for detail, selects an eval question, opens or generates a visual, or switches the visual being shown. Otherwise it stays as the user left it.
- R11. The details panel width SHALL default to 572 px and SHALL always lie between a minimum of 360 px and a maximum of 960 px, as whole pixels.
- R12. The maximum SHALL additionally be limited to the viewport width minus 240 px (the minimum main-content width), but SHALL never fall below the 360 px minimum. The system SHALL re-apply this limit whenever the window is resized; a resize SHALL NOT change the remembered width.
- R13. The details panel SHALL have a vertical separator on its left edge, labelled **Resize right panel**, focusable, exposing its current, minimum and maximum width as value-now, value-min and value-max. Its tooltip SHALL read "Drag to resize · Double-click to reset".
- R14. The details panel SHALL show: the visual panel when the main view is a session's chat; the eval question details when the main view is an agent's detail; otherwise the entity details panel.
- R15. Pointer interaction: pressing the primary button on the separator and dragging left SHALL widen the panel by the drag distance, dragging right SHALL narrow it, clamped per R11 and R12. While dragging, the cursor SHALL be a column-resize cursor everywhere and embedded visuals SHALL NOT swallow pointer events. The width SHALL be remembered when the drag ends or is cancelled.
- R16. Keyboard interaction on the focused separator: ArrowLeft SHALL widen the panel by 24 px, ArrowRight SHALL narrow it by 24 px, Home SHALL set the minimum (360), End SHALL set the current maximum (960 on a wide viewport). Each of these SHALL be remembered. Other keys SHALL be ignored (not prevented).
- R17. Double-clicking the separator SHALL reset the width to 572 and remember it.
- R18. The remembered width SHALL be stored in browser-local storage under the key `questions-to-insights:right-panel-width` as a plain number. On launch the system SHALL read it, clamp it to the current limits and use it; a missing or non-numeric value SHALL fall back to 572.

Backend status banner
- R19. The system SHALL show a banner across the top of the window (above the sidebar and main area) only while the backend status is `restarting` or `down`. For `starting` and `ready` no banner SHALL be shown.
- R20. For `restarting` the banner SHALL read "Backend restarting…" on an amber background. For `down` it SHALL read "Backend unavailable — restart the app" on a red background.
- R21. When the app runs without the desktop shell (a plain browser, as in web mode or a dev server), the system SHALL assume the backend is externally managed: status stays `ready` and the banner SHALL never show.
- R22. The desktop shell SHALL run the backend as a supervised child process and publish status changes to the window: `starting` when the app opens, `ready` once the backend answers its readiness probe, `restarting` while a crashed backend is being relaunched, `down` once relaunching is abandoned. It SHALL re-send the current status every time the window finishes loading, so a reloaded window is never stale.
- R23. The readiness probe SHALL be an HTTP GET of the sessions list on the loopback address at the backend port (default 3000, overridable by the backend-port environment variable), counted ready only on a 200 response. It SHALL be retried every 100 ms, each attempt timing out after 500 ms, until 30 seconds have passed.
- R24. The window SHALL open as soon as the backend is ready, or after the 30-second probe deadline expires. If the deadline expires the shell SHALL record an error diagnostic ("Backend did not become ready before timeout"), SHALL keep probing in the background, and SHALL publish `ready` if the backend answers later.
- R25. When the backend exits unexpectedly (anything other than the app quitting), the shell SHALL publish `restarting` and relaunch it after a delay of 1 s, then 2 s, then 4 s for the first, second and third consecutive failure, each time probing for readiness. After the third failed relaunch the shell SHALL publish `down` and record an error diagnostic ("Backend restart budget exhausted…"). `down` SHALL NOT recover without restarting the app.
- R26. A backend that has stayed ready for 60 seconds SHALL be treated as healthy again: the next crash SHALL get a fresh three-attempt budget instead of inheriting an earlier streak.
- R27. Quitting the app SHALL stop the backend and SHALL NOT trigger a relaunch.

Toasts
- R28. The system SHALL show short messages as toasts stacked at the bottom-right of the window, newest last, above all other content, without blocking the content beneath them.
- R29. A toast SHALL be one of three kinds: `success`, `error` or `info`, each with its own icon (check, alert, info) and colour. Success and info toasts SHALL disappear after 4 seconds; error toasts SHALL disappear after 8 seconds.
- R30. Each toast SHALL have a dismiss button, named "Dismiss notification", that removes it immediately. The toasts SHALL sit in a region named "Notifications" that assistive technology announces politely. Several toasts MAY be visible at once; there is no de-duplication.
- R31. Every error toast SHALL also be recorded as an error entry with source `user-visible` in diagnostics (see [../diagnostics/spec.md](../diagnostics/spec.md)).

App identity and version
- R32. The Settings list pane SHALL end with the build identity: the text "Agentic Hub" followed by `v` and the shipped version, for example "Agentic Hub v0.24.3". The version SHALL be the same number the installer and release tag carry.
- R33. The window title and the document title SHALL be "Agentic Hub". The operating-system app name (the macOS menu bar and Dock, the installers and the data directory) SHALL stay "Halo BI Assistant".
- R34. The desktop window SHALL open at 1440 × 900, SHALL NOT shrink below 960 × 600, SHALL use the canvas colour of the operating system's theme as its background until the page reports its resolved theme (R44), and on macOS SHALL use an inset title bar so the sidebar header clears the window controls.

Sessions area
- R46. In the Sessions area the content shows the open session's chat, the new-session composer, or, with nothing open, "Select a session or start a new conversation." The session list lives in the expanded drawer (R48) under a **Sessions** heading with a **New conversation** (plus) button and, under "Sessions navigation", one row per session, newest activity first, showing the session name and, beneath it, its datasets. An empty list SHALL read "No sessions yet." Selecting a row SHALL open that session's chat; **New conversation** SHALL open the composer. Deleting the open session SHALL return to the Sessions area with nothing open.
- R47. Removed in roadmap 1.8.8: the separate, collapsible session list pane is replaced by the drawer (R48).
- R48. The rail SHALL start with a menu button, **Expand navigation** (when collapsed) / **Collapse navigation** (when expanded), exposing `aria-expanded`. Expanding widens the rail into a 240 px drawer that shows each item's label beside its icon and the Sessions list (R46). Collapsing returns to the 64 px icon rail. Expanding or collapsing SHALL NOT change the main view or close the open session.
- R49. In the Sessions area the page SHALL start with a header: an icon, then the title — the open session's name, "New conversation" in the composer, or "Sessions" — with the session's context under the title while a chat is open (its agent, when it was started from one, then its datasources; sessions-chat R57), and a **Start New Conversation** button that opens the composer.

Appearance
- R39. The Appearance section SHALL offer a single choice labelled **Theme** with three options: **System**, **Light** and **Dark**. Exactly one is selected. The default, when nothing has been chosen, is System.
- R40. Choosing an option SHALL apply it at once, without a reload, and SHALL remember it for the next launch.
- R41. The **resolved theme** is Light or Dark: the chosen option, or for System the operating system's current light/dark setting. While System is chosen, a change of the operating-system setting SHALL restyle the open app without a reload.
- R42. The resolved theme SHALL be applied before the page first paints, so the app never shows a frame in the other theme on launch.
- R43. The remembered choice SHALL be stored in browser-local storage under the key `questions-to-insights:theme` as `system`, `light` or `dark`. A missing or unknown value SHALL mean System. If the storage cannot be read or written, the choice SHALL still apply for the current run.
- R44. In the desktop app, the window's own background (shown while resizing and before paint) SHALL follow the resolved theme.
- R45. Both themes SHALL produce zero violations in the automated accessibility scan (R35), and text colours SHALL meet WCAG AA contrast (4.5:1) against the surfaces they are used on.

Accessibility and visual stability
- R35. The application shell, in its initial state, SHALL produce zero violations when scanned by an automated accessibility engine (axe-core, all default rules).
- R36. The system SHALL expose labelled landmarks: "Navigation rail" (complementary), "Workspace navigation", "Sessions navigation" (in the Sessions area), "Settings navigation" (in the Settings area), and "Details panel".
- R37. Every icon-only control in the shell SHALL have an accessible name (a title or label), including the rail buttons (Datasets, Agents, Knowledge, Sessions, Open system logs, Settings), Expand navigation, Collapse navigation, Collapse right panel, Expand right panel, New conversation and Session options.
- R38. The application shell in its initial state SHALL match the approved `application-shell` screenshot baseline. The baseline SHALL be changed only deliberately, together with an intended visual change.

## Edge cases and errors

- A stored right-panel width of `abc`, an empty string or `Infinity` falls back to 572. A stored width of 5000 loads as the current maximum; a stored width of 100 loads as 360.
- On a narrow window (for example 960 px wide) the maximum is 720 (960 − 240); End sets 720, not 960. Widening the window later makes 960 reachable again without any stored change.
- Pressing a mouse button other than the primary one on the separator does nothing.
- Loading the session list at startup retries up to 12 times with a growing delay (200 ms steps, capped at 1 s) because the backend may still be starting. If it still fails the sidebar keeps whatever it had and shows the error toast "Could not load sessions".
- While the status is `restarting` or `down`, calls to the backend fail; each surfaces as its own error toast ("Backend unreachable" unless the backend provided a message) and so appears in diagnostics.
- The rail's account avatar ("D", titled "Demo User"), the Settings search box ("Search settings", hint "⌘ F") and the empty chat input shape on the home view are visual placeholders with no behaviour yet.
- The `down` banner has no retry button; the instruction in it is the only remedy.
- A stored theme of `Dark` (wrong case), `blue` or an empty string means System. With browser storage blocked, the chosen theme applies until the app closes and the next launch starts on System.
- Missing backend entry file (a broken installation): no backend starts, an error diagnostic ("Backend entry file is missing") is recorded and the window opens after the readiness deadline.

## Contracts

- Desktop bridge `desktop.onBackendStatus` (status events), `desktop.setWindowTheme` (R44) and the readiness probe: [../../system/api.md](../../system/api.md) (desktop IPC bridge).
- Sessions list used by the sidebar and the readiness probe: [../../system/api.md](../../system/api.md).
- Right-panel width key, theme key and any other browser-stored preference: [../../system/data-model.md](../../system/data-model.md) (client-side storage).
- Layout, tokens, panel dimensions and state visuals: [../../system/ui.md](../../system/ui.md).
- Version and release flow: [../../system/delivery.md](../../system/delivery.md).

## UI

Lives in the shell itself: [../../system/ui.md](../../system/ui.md). States:
- Banner: hidden (starting, ready), amber (restarting), red (down).
- Rail: one current area (Datasets, Agents, Knowledge, Sessions or Settings), or none on home.
- Details panel: expanded at the remembered width, collapsed.
- Toasts: success, info, error, several stacked.

## Flows

E2E: `frontend/e2e/layout-accessibility.spec.ts` for the Feature below (moved verbatim from the repository `gherkin.md`).

```gherkin
Feature: Layout and accessibility

  Scenario: Supports keyboard layout controls and persists the right-panel width
    Given I click "Expand right panel"
    And the "Resize right panel" separator is at its default width of 572
    When I focus the separator and press Home
    Then the width is 360
    And the width 360 is remembered for next time
    When I press End
    Then the width is 960
    When I double-click the separator
    Then the width is back to 572
    When I click "Collapse right panel"
    Then the separator is hidden
    When I click "Expand right panel"
    Then the separator is visible

  Scenario: Has no automatically detectable accessibility violations in the application shell
    When an automated accessibility scan runs on the application shell
    Then it finds no violations

  Scenario: Has no automatically detectable accessibility violations on any screen in either theme
    Given the World Cup datasource and dataset exist
    When an automated accessibility scan runs in the light theme and in the dark theme on: Datasets, the dataset editor, Agents, an agent's detail, Knowledge, the Sessions area, the new-session composer, and each Settings section
    Then it finds no violations

  Scenario: Matches the stable application-shell visual baseline
    When I view the application shell
    Then it looks the same as the approved "application-shell" screenshot
```

E2E: `frontend/e2e/navigation.spec.ts` for the Feature below.

```gherkin
Feature: Navigation rail

  Scenario: Moves between areas from the rail
    When I click "Datasets" on the rail
    Then I see the "Datasets" page and "Datasets" is the current rail item
    When I click "Agents" on the rail
    Then I see the "Agents" page and "Agents" is the current rail item
    When I click "Agents" on the rail again
    Then I still see the "Agents" page
    When I click "Knowledge" on the rail
    Then "Knowledge" is the current rail item
    When I click "Sessions" on the rail
    Then I see "Sessions navigation" with a "New conversation" button
    And I see "Select a session or start a new conversation."

  Scenario: Expands the rail into a drawer with labels and sessions
    Given the navigation drawer is collapsed
    When I click "Expand navigation"
    Then I see the labels "Datasets", "Agents", "Knowledge" and "Sessions" next to their icons
    And I see "Sessions navigation" with a "New conversation" button
    When I click "Collapse navigation"
    Then "Sessions navigation" is hidden
    When I click "Sessions" on the rail
    Then the drawer is expanded and I see "Sessions navigation"

  Scenario: Shows the details panel only on demand
    When the app opens
    Then the details panel is hidden and I see "Expand right panel"
    When I click "Expand right panel"
    Then I see the "Details panel"
    When I click "Collapse right panel"
    Then the details panel is hidden

  Scenario: Opens Settings as an area with a section list
    When I click "Settings" on the rail
    Then I see "Settings navigation" with five sections
    And I see "Choose a settings section."
    When I choose "Appearance"
    Then I see the "Appearance" section
    When I click "Datasets" on the rail
    Then "Settings navigation" is no longer shown
    When I click "Settings" on the rail
    Then the "Appearance" section is still shown

  Scenario: Shows the product name
    Then the page's level-one heading reads "Agentic Hub"
    And the document title is "Agentic Hub"
    When I click "Settings" on the rail
    Then the settings list ends with "Agentic Hub v" followed by the version
```

E2E: `frontend/e2e/appearance.spec.ts` for the Feature below.

```gherkin
Feature: Appearance

  Scenario: Follows the operating system theme by default
    Given the operating system uses a light theme
    And I have never chosen a theme
    When I open Settings and choose "Appearance"
    Then "System" is selected under "Theme"
    And the app is shown in the light theme
    When the operating system switches to a dark theme
    Then the app is shown in the dark theme without reloading

  Scenario: Forces a theme regardless of the operating system
    Given the operating system uses a light theme
    When I open Settings, choose "Appearance" and select "Dark"
    Then the app is shown in the dark theme
    When the operating system switches to a dark theme and back to light
    Then the app is still shown in the dark theme
    When I select "Light"
    Then the app is shown in the light theme

  Scenario: Remembers the chosen theme after a restart
    Given I selected "Dark" under "Theme"
    When I restart the app
    Then the app is shown in the dark theme from its first frame
    And "Dark" is selected under "Theme"

  Scenario: Has no automatically detectable accessibility violations in either theme
    When I open the Appearance section in the light theme and in the dark theme
    Then an automated accessibility scan of the section finds no violations in either
```

E2E: none yet for the Feature below.

```gherkin
Feature: App shell behaviour not yet covered by Playwright

  Scenario: Shows the backend banner while the backend restarts
    Given the backend process has just exited unexpectedly
    Then I see "Backend restarting…" above the sidebar and main area
    When the backend answers its readiness probe again
    Then the banner disappears

  Scenario: Gives up after repeated backend failures
    Given the backend has failed to come back after three relaunches
    Then I see "Backend unavailable — restart the app"
    And the banner stays until I restart the app

  Scenario: Never shows the banner outside the desktop shell
    Given I am using the app in a plain browser
    Then no backend banner is shown

  Scenario: Resizes the right panel by dragging
    Given the right panel is at its default width of 572
    When I drag the "Resize right panel" separator 100 pixels to the left
    Then the width is 672
    And reloading the app shows the width 672
    When I drag it far to the right
    Then the width stops at 360

  Scenario: Ignores a damaged remembered width
    Given the remembered right-panel width is "abc"
    When I open the app
    Then the right panel width is 572

  Scenario: Shows toasts and dismisses them
    When an operation succeeds
    Then a success toast appears at the bottom-right
    And it disappears after about 4 seconds
    When an operation fails
    Then an error toast appears and stays about 8 seconds
    And I can close it early with its dismiss button
    And the failure also appears in the system logs as a "user-visible" error

  Scenario: Remembers nothing about collapse between launches
    Given I expanded the details panel and the navigation drawer
    When I reopen the app
    Then both are collapsed again
```

## Acceptance

- The three `layout-accessibility.spec.ts` scenarios pass in the real desktop app.
- With the backend killed, the banner moves through "Backend restarting…" and returns to nothing, or ends at "Backend unavailable — restart the app" after three failed relaunches.
- Resizing by pointer, keyboard and double-click all land within 360–960 px and survive a restart.

## Open questions

- Toast messages carry no live-region announcement and the toast dismiss button has no accessible name, so a screen reader neither announces a toast nor labels its close control. The axe scan does not catch this because it runs with no toast on screen. Decide whether R37 and the accessibility rules should cover toasts.
- The display name is "Halo BI Assistant" (window title, About, version line) while the hidden heading, diagnostics report title and package are "Questions to Insights". Confirm which is the product name.
- The `starting` status is published but never shown. If the backend does not become ready within 30 seconds the window opens with no banner at all, and nothing tells the user why requests fail until the first error toast. Should `starting` (or a timeout state) get a banner?

<!-- sources: frontend/src/app/app.ts, frontend/src/app/app.html, frontend/src/app/app.scss, frontend/src/app/core/backend-status/, frontend/src/app/core/toast/toast.service.ts, frontend/src/app/core/config/, frontend/src/app/shared/components/{backend-status-banner,toast-container,app-logo}/, frontend/electron/main.cjs, frontend/electron/preload.cjs, frontend/e2e/layout-accessibility.spec.ts -->

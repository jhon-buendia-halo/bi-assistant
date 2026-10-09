# BA-141 — Agentic Hub Look and Feel

- **Jira:** [BA-141](https://halo-powered.atlassian.net/browse/BA-141) · **Roadmap:** Milestone 1.8 · **Status:** Confirmed

## Goal

The app looks like the Agentic Hub design. A blue gradient frame surrounds the window. Content sits in white rounded cards under an "Agentic Hub" banner. A narrow icon rail handles navigation. Buttons are pill-shaped and statuses are coloured chips. Users can pick a light theme, matching the mockup, or a navy dark theme derived from it. By default the app follows the OS. Only the look changes: every feature works as it does today.

The reference mockup is a "Publish requests" screen. It is used only for its visual language. The publish-review workflow it shows is not part of this epic.

## Scope

- **Design tokens and themes.** Semantic colour, radius and shadow tokens with a light set and a navy dark set. A webfont bundled with the app. An Appearance setting with System (the default), Light and Dark. Decision: ADR-0007 in [architecture.md](../../system/architecture.md).
- **App shell.**
  - A gradient frame around the window.
  - An "Agentic Hub" banner header.
  - A narrow icon rail replaces the 296 px sidebar. It holds Datasets, Agents, Knowledge, Sessions and Settings at the top, and the account avatar and system logs at the bottom. The mockup's "Powered by LenAI" footer is left out.
  - The title bar and traffic-light spacing are reworked for the rail.
- **Rename.** "Halo BI Assistant" becomes "Agentic Hub" in the window title, the document title and the settings footer.
- **Sessions master-detail.** The session list moves out of the sidebar into a list pane beside the content. New, select and delete work as today.
- **Shared components.** Pill buttons in primary, secondary and tertiary variants, status chips, cards, list rows, filter pills and section headers with icons.
- **Every existing screen restyled in both themes:** datasets, the catalog browser, agents, knowledge, settings, the session chat, the visual panel, system logs, toasts and the right panel.
- **Tests.** The Playwright visual baseline is regenerated for both themes, and the axe scan stays clean in both.

## Out of scope

- The "Publish requests" agent review and approval workflow, and any other new feature.
- Behaviour, endpoint or data changes, apart from the theme preference.
- Copy changes other than the rename.
- Renaming `productName`, the installers, the Dock or menu-bar name, or the data directory. `productName` stays "Halo BI Assistant" (decided 2026-10-09).
- A "Powered by LenAI" footer, which the mockup shows.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-142](https://halo-powered.atlassian.net/browse/BA-142) | ADR, epic spec and roadmap | 1.8.1 |
| [BA-143](https://halo-powered.atlassian.net/browse/BA-143) | Design tokens and light/dark theme switch | 1.8.2 |
| [BA-144](https://halo-powered.atlassian.net/browse/BA-144) | App shell: gradient frame, Agentic Hub banner and icon rail | 1.8.3 |
| [BA-145](https://halo-powered.atlassian.net/browse/BA-145) | Shared components: pill buttons, status chips, cards and list rows | 1.8.4 |
| [BA-146](https://halo-powered.atlassian.net/browse/BA-146) | Sessions master-detail list pane | 1.8.5 |
| [BA-147](https://halo-powered.atlassian.net/browse/BA-147) | Restyle feature screens: datasets, catalog, agents, knowledge and settings | 1.8.6 |
| [BA-148](https://halo-powered.atlassian.net/browse/BA-148) | Restyle chat, visual panel, system logs and toasts; regenerate the visual baseline | 1.8.7 |

All stories are built on one branch, `feat/BA-141-agentic-hub-look-and-feel`, and ship as one PR.

## Specs touched

- [system/architecture.md](../../system/architecture.md): ADR-0007 (BA-142).
- [system/ui.md](../../system/ui.md):
  - §1 shell, regions, sidebars and right panel (BA-144, BA-146);
  - §3 shared components (BA-145);
  - §4 screens (BA-147, BA-148);
  - §6 design tokens, typography and theming (BA-143);
  - §7 copy for the rename and the Appearance setting (BA-143, BA-144);
  - §9 visual baseline (BA-148).
- [capabilities/app-shell/spec.md](../../capabilities/app-shell/spec.md): rules and Gherkin for the theme switch, the icon rail and the banner (BA-143, BA-144).
- [capabilities/sessions-chat/spec.md](../../capabilities/sessions-chat/spec.md): the Gherkin for the session list in its new pane (BA-146).
- [system/data-model.md](../../system/data-model.md): the theme preference key on the renderer (BA-143).
- [system/tech-stack.md](../../system/tech-stack.md): the bundled webfont and the token file (BA-143).
- [product/non-functional.md](../../product/non-functional.md): resolves the open question on a light theme and adds contrast in both themes (BA-143).

## Acceptance

- Every screen renders in Light and Dark with no hardcoded colour values left in components. Switching the Appearance setting, or the OS theme while on System, restyles the open app without a reload.
- The shell matches the mockup's structure: gradient frame, "Agentic Hub" banner, icon rail, and sessions in a list pane.
- The window and document titles read "Agentic Hub". The data directory and installers are unchanged.
- Every existing E2E flow passes. The only test changes are for moved navigation (the rail, the sessions pane) and the rename.
- The axe scan is clean and visual baselines are committed for both themes.

## Dependencies, risks and open questions

- **Timing.** This is a large restyle inside the 1.0 Beta (due 2026-10-31), and it competes with milestones 1.1–1.7 for the same window.
- **E2E churn.** Moving sessions out of the sidebar and replacing the sidebar with a rail changes the selectors in many Playwright specs. Stable `aria-label`s and `data-testid`s must be kept or migrated in the same story.
- **Navy dark is derived, not designed.** The mockup shows only the light theme. The dark token set is proposed in BA-143 and reviewed with screenshots before the screen-by-screen stories.
- **Traffic lights.** The rail must clear the macOS inset controls without the 76 px empty gap on Windows and Linux (an existing gap noted in [ui.md](../../system/ui.md) §10).
- **Decided: `productName` stays "Halo BI Assistant".** Renaming it would change the Dock and menu-bar name and the installer names, and move Electron's data directory, which would need a migration like the earlier "Questions to Insights" one. So the macOS Dock and menu bar keep showing "Halo BI Assistant" while the window title reads "Agentic Hub".
- **Depends on** nothing outside this epic. [BA-109](https://halo-powered.atlassian.net/browse/BA-109) (renderer port) is unrelated.

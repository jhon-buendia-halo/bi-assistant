# 1.10.2 — E2E impact analysis (step 6)

Components touched: frontend `ThemeService` (Light default, `hasStoredChoice`), new `UiPreferencesService` (backend load, browser cache, one-time move), `App` (drawer from preferences, `toggleNav`), `AppearanceSettings` (saves through preferences), the `index.html` boot script; backend new `ui-preferences` module (`GET` / `PUT /ui-preferences`).

| Spec / scenario | Feature | Decision | Why |
|---|---|---|---|
| `navigation.spec.ts` › opens with the navigation drawer expanded | Navigation | **Add** | R2, R50. |
| `navigation.spec.ts` › remembers a collapsed drawer after a restart | Navigation | **Add** | R50: fresh browser profile on the same data dir, so only the database can remember. |
| `navigation.spec.ts` › expands the rail into a drawer… | Navigation | **Update** | Now starts by collapsing the drawer (the Given). |
| `appearance.spec.ts` › follows the OS theme by default | Appearance | **Delete → replaced** | By "opens in the light theme by default" (dark OS, still Light) and "follows the OS theme when System is chosen". |
| `appearance.spec.ts` › keeps the chosen theme in the database | Appearance | **Add** | R43: fresh browser profile on the same data dir. |
| `appearance.spec.ts` › moves a theme chosen before the database stored it | Appearance | **Add** | M12. |
| `appearance.spec.ts` › forces a theme…, remembers after a restart, axe scan | Appearance | Re-run as-is | Unchanged behaviour. |
| `layout-accessibility.spec.ts` › axe on every screen in either theme | Layout | **Update** | Calls `followOsTheme` first, since the OS setting no longer drives the default. |
| `agent-hub.spec.ts`, `agent-editor.spec.ts` › axe scans in either theme | Agents | **Update** | Same helper. |
| `layout-accessibility.spec.ts` › visual baseline | Layout | **Update baseline** (intended) | The shell now opens with the drawer expanded. Web baseline regenerated; the darwin (desktop) baseline was not, desktop not run. |
| Gherkin "Remembers nothing about collapse between launches" | Layout (E2E none yet) | **Update** text only | Now "Does not remember the details panel between launches". |
| All other specs | — | Re-run as-is | The expanded drawer adds visible labels and the session list; the full suite was re-run for collisions. |

# 1.8.3 — App shell: gradient frame, Agentic Hub banner and icon rail (BA-144)

Run on 2026-10-09 against the **web target** (`npm run test:e2e`, Playwright `web` project, Chromium at 1440×900), with an isolated compose project (`COMPOSE_PROJECT_NAME=qti-ba-141`, `WORLD_CUP_DB_PORT=55433`).

| Artifact | Shows |
|---|---|
| [e2e-results.txt](e2e-results.txt) | Full web suite: 42 passed, 2 skipped. New: `navigation.spec.ts` (Feature "Navigation rail", 3 scenarios). Updated: `layout-accessibility.spec.ts` (sidebar steps removed), `world-cup-workflow.spec.ts` (opens Sessions after a reload), and the helpers `createWorldCupDataset` / `createWorldCupSession` (no "Back"; new `openSessions`). |
| [application-shell-web-baseline.png](application-shell-web-baseline.png) | The regenerated `application-shell-web-linux.png` baseline: the new shell, intended. |
| `shell-{home,settings,sessions,datasets}-{light,dark}.png` | The shell in both themes: home, the Settings area with its section list, the Sessions area with its list pane, and Datasets. The Datasets screen inside the card is still unrestyled (1.8.6). |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing. |

**Desktop not run:** the 2 desktop-only scenarios skipped on web are `developer-settings.spec.ts` › the desktop app offers to restart the backend, and `diagnostics.spec.ts` › captures live renderer failures…. The Electron window title (`WINDOW_TITLE` in `main.cjs`) is only type-checked.

Unit tests: frontend `ng test` 89/90. The failure (`App should support keyboard resizing`, 525 vs 548) also fails on unchanged `main` in this environment. `App should render the navigation rail` replaces the old sidebar test.

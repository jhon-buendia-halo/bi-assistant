# 2.1.3 — Admin overview (BA-164)

The Overview tab: tiles, Needs attention with its three dialogs, the weekly chart, Recent activity and Export report.

| Artifact | Shows |
|---|---|
| [e2e-results-org.txt](e2e-results-org.txt) | The 7 scenarios of `e2e/org-admin-overview.spec.ts`, including the axe scan in both themes. |
| [admin-overview.png](admin-overview.png) | Tiles (active users in 30 days, agents live), Needs attention with counts and actions, the 8-week chart, Recent activity. |
| [admin-overview-dark.png](admin-overview-dark.png) | The same Overview in the dark theme. |
| [admin-overview-inactive-makers-dialog.png](admin-overview-inactive-makers-dialog.png) | The Inactive makers dialog from **Clean up**: a user last active 95 days ago with a direct Maker assignment. |

## Shared results (the whole epic branch, 2026-10-11)

The four admin stories were built together and tested on one branch, so these results cover all of them:

- Org Playwright project: **46 passed** ([../2.1.4/e2e-results-org-full.txt](../2.1.4/e2e-results-org-full.txt)).
- Web Playwright project (local mode): **77 passed, 2 skipped** (desktop only) ([../2.1.4/e2e-results-web.txt](../2.1.4/e2e-results-web.txt)). The admin area renders only in org mode; local mode is unchanged.
- Backend unit tests: 1016 passed. Backend API tests: 224 passed; `app.e2e-spec.ts` fails on an ESM import exactly as it does on `main`. The admin API suites, run verbose: [../2.1.4/backend-api-results-admin.txt](../2.1.4/backend-api-results-admin.txt) (25 passed).
- Frontend unit tests: 269 passed. Frontend build: OK. `python3 scripts/check-specs.py`: all checks passed.

Screenshots: the web app at 1440 px in the light theme unless named `-dark`, signed in as the bootstrap admin, over a small org seeded through SCIM and the admin API.

Not run: the desktop target (not requested; the admin area exists only in org server mode, which the desktop app doesn't run).

Branch: `feat/BA-161-admin-panel`.

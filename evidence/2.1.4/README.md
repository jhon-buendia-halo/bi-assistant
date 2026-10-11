# 2.1.4 — Users & groups (BA-165)

The Users & groups tab: views, search, role chips, the users table, the Groups view and Assign role. Also the fix that makes streamed POST routes answer 200.

| Artifact | Shows |
|---|---|
| [e2e-results-org.txt](e2e-results-org.txt) | The 8 scenarios of `e2e/org-admin-users.spec.ts`. |
| [e2e-results-org-full.txt](e2e-results-org-full.txt) | The whole org project (46), including the completed "A bootstrap admin sees the Admin area". |
| [e2e-results-web.txt](e2e-results-web.txt) | The whole web project (local mode). |
| [backend-api-results-admin.txt](backend-api-results-admin.txt) | `org-admin.e2e-spec.ts` (endpoints 79–90: 403s, tables, search, paging, save atomicity, transfers, mappings, overview figures, CSV) and `response-status.e2e-spec.ts` (POST routes that answer 200). |
| [admin-users-table.png](admin-users-table.png) | Role chips with counts, search, the table with roles, IdP groups, agents owned, last active and the four statuses, the last-sync note and paging. |
| [admin-groups-view.png](admin-groups-view.png) | The Groups view: members and mapped roles per group. |
| [admin-assign-role-dialog.png](admin-assign-role-dialog.png) | Assign role with a user and a role chosen; Datasource disabled because it applies only to Data owner. |

## Shared results (the whole epic branch, 2026-10-11)

The four admin stories were built together and tested on one branch, so these results cover all of them:

- Org Playwright project: **46 passed** ([../2.1.4/e2e-results-org-full.txt](../2.1.4/e2e-results-org-full.txt)).
- Web Playwright project (local mode): **77 passed, 2 skipped** (desktop only) ([../2.1.4/e2e-results-web.txt](../2.1.4/e2e-results-web.txt)). The admin area renders only in org mode; local mode is unchanged.
- Backend unit tests: 1016 passed. Backend API tests: 224 passed; `app.e2e-spec.ts` fails on an ESM import exactly as it does on `main`. The admin API suites, run verbose: [../2.1.4/backend-api-results-admin.txt](../2.1.4/backend-api-results-admin.txt) (25 passed).
- Frontend unit tests: 269 passed. Frontend build: OK. `python3 scripts/check-specs.py`: all checks passed.

Screenshots: the web app at 1440 px in the light theme unless named `-dark`, signed in as the bootstrap admin, over a small org seeded through SCIM and the admin API.

Not run: the desktop target (not requested; the admin area exists only in org server mode, which the desktop app doesn't run).

Branch: `feat/BA-161-admin-panel`.

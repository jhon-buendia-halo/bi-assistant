# 2.1.6 — Roles & permissions (BA-167)

The Roles & permissions tab: the read-only matrix and the Entra ID group → role mappings.

| Artifact | Shows |
|---|---|
| [e2e-results-org.txt](e2e-results-org.txt) | The 6 scenarios of `e2e/org-admin-roles.spec.ts`. |
| [admin-roles-matrix-and-mappings.png](admin-roles-matrix-and-mappings.png) | The 11 × 5 permission matrix and the mappings list with **Add mapping**. |
| [admin-add-mapping-dialog.png](admin-add-mapping-dialog.png) | Add mapping for a group, role Data owner, with its datasource. |

## Shared results (the whole epic branch, 2026-10-11)

The four admin stories were built together and tested on one branch, so these results cover all of them:

- Org Playwright project: **46 passed** ([../2.1.4/e2e-results-org-full.txt](../2.1.4/e2e-results-org-full.txt)).
- Web Playwright project (local mode): **77 passed, 2 skipped** (desktop only) ([../2.1.4/e2e-results-web.txt](../2.1.4/e2e-results-web.txt)). The admin area renders only in org mode; local mode is unchanged.
- Backend unit tests: 1016 passed. Backend API tests: 224 passed; `app.e2e-spec.ts` fails on an ESM import exactly as it does on `main`. The admin API suites, run verbose: [../2.1.4/backend-api-results-admin.txt](../2.1.4/backend-api-results-admin.txt) (25 passed).
- Frontend unit tests: 269 passed. Frontend build: OK. `python3 scripts/check-specs.py`: all checks passed.

Screenshots: the web app at 1440 px in the light theme unless named `-dark`, signed in as the bootstrap admin, over a small org seeded through SCIM and the admin API.

Not run: the desktop target (not requested; the admin area exists only in org server mode, which the desktop app doesn't run).

Branch: `feat/BA-161-admin-panel`.

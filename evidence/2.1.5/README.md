# 2.1.5 — Edit a user (BA-166)

The user detail panel: roles with their descriptions and lock reasons, groups, agents owned, Transfer ownership and Save changes. Also the fix that stops a Data owner role from granting anything once its datasource is gone, and a panel-width fix (below).

| Artifact | Shows |
|---|---|
| [e2e-results-org.txt](e2e-results-org.txt) | The 9 scenarios of `e2e/org-admin-edit-user.spec.ts`. "Selecting a user opens their details" now also checks that the panel fits beside the table. |
| [admin-edit-user-panel.png](admin-edit-user-panel.png) | Ada's panel next to the compact table: Approver ticked, Maker ticked and locked "From group Analysts", Data owner with its Datasource select, groups, two agents owned. |
| [admin-transfer-ownership-dialog.png](admin-transfer-ownership-dialog.png) | Transfer ownership with both agents ticked and a new owner chosen. |

## Found while taking the evidence

At 1440 px the open panel overflowed the card by 38 px: the table's 560 px minimum, the 24 px gap and the 520 px panel needed 1104 px against about 1066. The table's minimum is now 480 px (ui.md 4.18.4). A layout check was added to "Selecting a user opens their details"; it failed first (panel right edge 1417 against 1380), then passed. The screenshots were retaken after the fix.

## Shared results (the whole epic branch, 2026-10-11)

The four admin stories were built together and tested on one branch, so these results cover all of them:

- Org Playwright project: **46 passed** ([../2.1.4/e2e-results-org-full.txt](../2.1.4/e2e-results-org-full.txt)).
- Web Playwright project (local mode): **77 passed, 2 skipped** (desktop only) ([../2.1.4/e2e-results-web.txt](../2.1.4/e2e-results-web.txt)). The admin area renders only in org mode; local mode is unchanged.
- Backend unit tests: 1016 passed. Backend API tests: 224 passed; `app.e2e-spec.ts` fails on an ESM import exactly as it does on `main`. The admin API suites, run verbose: [../2.1.4/backend-api-results-admin.txt](../2.1.4/backend-api-results-admin.txt) (25 passed).
- Frontend unit tests: 269 passed. Frontend build: OK. `python3 scripts/check-specs.py`: all checks passed.

Screenshots: the web app at 1440 px in the light theme unless named `-dark`, signed in as the bootstrap admin, over a small org seeded through SCIM and the admin API.

Not run: the desktop target (not requested; the admin area exists only in org server mode, which the desktop app doesn't run).

Branch: `feat/BA-161-admin-panel`.

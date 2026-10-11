# 2.1.2 — Sign-in with Entra ID, directory sync, roles and enforcement (BA-163)

Org server mode: OIDC sign-in, SCIM provisioning, five roles enforced on every route, and private data scoped to its owner. Local mode is unchanged.

All results were taken on the epic branch after merging every BA-163 slice (S1–S4 and the subject-and-UPN matching fix), against the per-worktree World Cup Postgres from the infra MCP service.

## Test results

| Artifact | Shows |
|---|---|
| [e2e-results-org.txt](e2e-results-org.txt) | `npm run test:e2e:org`: **16 passed**. `org-sign-in.spec.ts` (7), `org-permissions.spec.ts` (5), `org-isolation.spec.ts` (4), driving the web app through the OIDC stub in `backend/test/oidc-stub.ts`. |
| [e2e-results-web.txt](e2e-results-web.txt) | `playwright test --project=web` (local mode): **77 passed, 2 skipped** (desktop only). The local-mode visual baseline is unchanged. Includes the new navigation scenario "Local mode has no sign-in and no Admin item". |
| [backend-api-results.txt](backend-api-results.txt) | Backend API tests: **179 passed, 11 skipped**. `org-auth`, `scim`, `owner-isolation` and `local-auth` cover the "Org server API" Feature. `answer-guards` is skipped (it needs the Docker fixture). `app.e2e-spec.ts` fails as it did before this story: the Nest scaffold can't load `@databricks/sql` → `thrift` → ESM `uuid` under Jest (see tech-stack.md). |
| [backend-unit-results.txt](backend-unit-results.txt) | Backend `npm test`: **898 passed**. |

Frontend `npm test`: 186 passed. `python3 scripts/check-specs.py`: all checks passed.

## Screenshots (web app, light theme)

| File | Shows |
|---|---|
| [sign-in-page.png](sign-in-page.png) | An unauthenticated visitor sees only the sign-in page with **Sign in with Microsoft**. |
| [sign-in-page-failed.png](sign-in-page-failed.png) | The error after a failed sign-in (`signInError=failed`). |
| [account-menu-signed-in.png](account-menu-signed-in.png) | The rail avatar with the signed-in user's initials, and its menu with name, email and **Sign out**. |
| [user-agents-without-new-agent.png](user-agents-without-new-agent.png) | A User without Maker: no **New agent** control. |
| [user-datasets-without-new-dataset.png](user-datasets-without-new-dataset.png) | A User without *Manage datasources and datasets*: shared datasets visible, no management controls. |
| [user-settings-appearance-only.png](user-settings-appearance-only.png) | A User's Settings: Appearance only, no LLM configuration or developer settings. |
| [maker-save-refused-permission-toast.png](maker-save-refused-permission-toast.png) | An action refused with 403 shows "You don't have permission to do this." |
| [admin-area-overview-tab.png](admin-area-overview-tab.png) | A bootstrap Platform admin opens the Admin area (tabs Overview, Users & groups, Roles & permissions). Tab content arrives with BA-164 to BA-167. |

## Not run

- **Desktop:** not run (not requested). The two desktop-only scenarios are skipped on web.
- The "A bootstrap admin sees the Admin area" scenario checks the heading, the tabs and the axe scan. Its "Needs attention" and "Search users" steps are completed by BA-164 and BA-165.

Branch: `feat/BA-161-admin-panel`.

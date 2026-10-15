# E2E impact analysis — 1.14.19 (BA-232)

Workflow steps 6, 7 and 9 for roadmap 1.14.19: single-user app, authentication and authorization removed, only the built-in super admin (ADR-0030, migration M14). Code: commit `ed1f4cc`. Web target only; desktop not run.

## Components touched and the scenarios that exercise them

| Component (commit `ed1f4cc`) | Scenarios |
|---|---|
| Deleted `backend/src/modules/auth/**`, `modules/admin/**`, the permission guard and decorators, `org-server.config`, `owned-doc-store`; `app-bootstrap.ts`, `cli.ts` | every Feature of the deleted `specs/capabilities/admin/spec.md`; app-shell → "The app opens straight into the shell" (was "Local mode signs in as Demo User") |
| Deleted `frontend/src/app/core/auth/**` (sign-in page, account menu, auth service), `auth.interceptor`, `features/admin/**`, `root.ts`; `app.html` (no Admin rail item, no avatar, every Settings section, Reasoning effort always shown) | app-shell → Navigation rail (all), Layout and accessibility (axe on every screen and section); llm-settings (R43: section and composer effort always shown); developer-settings (R27: section always shown) |
| `infrastructure/database/database.module.ts` (M14 `consolidateOwners`), the repositories that injected `OWNED_*` | "sessions, agents, skills, knowledge… owned by any user are listed after opening an old data dir, and `app.sqlite` has no `users` table" (roadmap acceptance) |
| Controllers without `@RequirePermission` / `@Public`; `llm.controller.ts` (always the masked key) | backend `response-status.e2e-spec.ts`, `agent-sessions.e2e-spec.ts`, `app.e2e-spec.ts`; llm-settings → "Never shows the stored key" |
| `frontend/e2e/fixtures/app.fixture.ts` (no sign-in, waits for the shell), `helpers/api.ts` (from `local-auth.ts`), `helpers/app-actions.ts`, `agents-api.ts`; `backend/test/backend-process.ts` (no bearer, probes `/sessions`); `frontend/electron/main.cjs` (probe `GET /sessions`) | every Playwright spec and every backend API e2e (re-run) |
| `datasets` components (Yours / Shared with you chips removed) | datasets → Dataset management (`E2E: none yet`; no Playwright file) |

## Deleted (recorded; done in `ed1f4cc`)

Playwright specs and their Features (all in the deleted admin capability spec, 9 Features, 67 scenarios):

| Spec file | Feature | Scenarios |
|---|---|---|
| `frontend/e2e/local-sign-in.spec.ts` | Sign in to local mode | 8 |
| `frontend/e2e/org-sign-in.spec.ts` | Sign in to an org server | 8 |
| `frontend/e2e/org-permissions.spec.ts` | Permissions in the app | 5 |
| `frontend/e2e/org-isolation.spec.ts` | Private and shared data | 4 |
| `backend/test/org-auth.e2e-spec.ts`, `scim.e2e-spec.ts`, `owner-isolation.e2e-spec.ts`, `local-auth.e2e-spec.ts`, `org-admin.e2e-spec.ts` | Org server API (API-level) | 12 |
| `frontend/e2e/org-admin-overview.spec.ts` | Admin overview | 7 |
| `frontend/e2e/org-admin-users.spec.ts` | Users and groups | 8 |
| `frontend/e2e/org-admin-edit-user.spec.ts` | Edit a user | 9 |
| `frontend/e2e/org-admin-roles.spec.ts` | Roles and permissions | 6 |

Also deleted: `frontend/e2e/fixtures/org.fixture.ts`, `helpers/{org-actions,scim-client,admin-actions,local-auth}.ts`, the Playwright `org` project and `npm run test:e2e:org`, `backend/test/oidc-stub.ts` and `org-server.ts`.

## Decisions per scenario

| Spec file | Scenario | Decision | Why it fails on `origin/main` |
|---|---|---|---|
| `navigation.spec.ts` | The app opens straight into the shell (the brief's "opens as the super admin") | **Update** (replaces "Local mode signs in as Demo User") | Main opens on the local sign-in page, so the shell never appears without signing in. The test also asserts no "Sign in" text or button, no Account menu, no Admin item, `GET /me`, `/admin/overview` and `/auth/local/personas` answer 404 (main: 200/401), every area (Datasets, Agents, Knowledge, Sessions) and every Settings section opens, and LLM Configuration shows Reasoning effort. |
| `navigation.spec.ts` | the 8 other scenarios | Re-run as-is | — |
| `llm-settings.spec.ts` | Sets the reasoning effort from the new-session composer | **Add** | Asserts the composer's Reasoning effort chip is shown and works for the one user (R43); its path through the Sessions page also fails on main. |
| `llm-settings.spec.ts`, `developer-settings.spec.ts`, `developer-observability.spec.ts`, `diagnostics.spec.ts`, `appearance.spec.ts`, `layout-accessibility.spec.ts`, `chat-and-visuals.spec.ts`, `chat-clarification.spec.ts`, `world-cup-workflow.spec.ts` | all | Re-run as-is (fixture changed) | — |
| `backend/test/app.e2e-spec.ts` | Opening a data dir from the multi-user version (M14): lists every user's sessions, agents, skills and knowledge; keeps the super admin's UI preferences under the bare key; drops the identity tables and stamps every document with the super admin | **Add** (3 tests) | The data is made through the API, the backend stopped, `app.sqlite` rewritten as an org server stored it (owners `u-alice`, `u-bob`, `u-carol`, a `users` table, `ui-preferences:local` and `:u-alice`, a skill name two owners shared), then the backend restarted. Main filtered by owner (and needed a session), kept `users`, and has no `-2` rename. A Playwright version was not needed: the claim is about stored data and the API, and the built backend is the real thing. M14's SQL is also unit-tested in `database.module.spec.ts` (15 tests, run). |
| `backend/test/app.e2e-spec.ts` | serves the sessions list on a fresh data dir | Re-run as-is | — |
| `backend/test/response-status.e2e-spec.ts`, `agent-sessions.e2e-spec.ts` | all | Re-run (no token; updated in `ed1f4cc`) | — |
| Other stories' files (agents, agent hub, agent editor, agent sessions, agent skills, testing data, rfp, agent panel) | auth headers dropped in `ed1f4cc` | Re-run by their owners | — |

Counts: 67 scenarios deleted with 9 Features (8 Playwright files, 5 backend API files); 1 Playwright test updated; 1 Playwright test added; 3 backend API tests added; the rest re-run as-is.

## Acceptance grep

`grep -rn "ORG_\|RequirePermission\|CurrentUserService\|auth.can\|/me'" backend/src frontend/src` → no output (exit 1). Recorded in `e2e-results.txt`.

## Desktop not run

`developer-settings.spec.ts` "the desktop app offers to restart the backend…" and `diagnostics.spec.ts` "captures live renderer failures…" are `desktopOnly()`. The desktop readiness probe change (`frontend/electron/main.cjs` → `GET /sessions`) is therefore not exercised.

## Screenshots

`opens-without-sign-in.png`: the app straight on the welcome page, no avatar, no Admin item.

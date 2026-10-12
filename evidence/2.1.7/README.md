# Evidence — 2.1.7 Local mode: sign in as a seeded persona, roles enforced (epic BA-161)

Story key pending: the Jira story could not be created from the session (permission denied), so the work is scoped to epic BA-161.

## Tests (2026-10-11, web app built from `feat/BA-161-admin-panel`)

- Playwright `web` project: [e2e-results-web.txt](e2e-results-web.txt) — 85 passed, 2 skipped. The two skipped scenarios are desktop-only (`desktop not run`): `developer-settings.spec.ts` "the desktop app offers to restart the backend…" and `diagnostics.spec.ts` "captures live renderer failures…". `local-sign-in.spec.ts` (Feature "Sign in to local mode", 8 scenarios) and the updated `navigation.spec.ts` "local mode signs in as Demo User" are in it.
- Playwright `org` project: [e2e-results-org.txt](e2e-results-org.txt) — 47 passed, including the new `org-sign-in.spec.ts` "an org server never offers the local sign-in". `org.fixture.ts` is unchanged.
- Backend unit tests: 61 suites, 1047 tests passed.
- Backend API e2e (`test/jest-e2e.json`): `local-auth` 26/26, `org-auth`, `org-admin`, `scim`, `owner-isolation`, `user-agents`, `agent-sessions`, `response-status` and `answer-guards` (11/11) pass. `app.e2e-spec.ts` still fails on its ESM import, unchanged from `main`.
- Frontend unit tests: 297/297 (`ng test --watch=false`, headless Chromium at 1440×900). `npm run build` passes.
- `python3 scripts/check-specs.py`: all checks passed.
- Database: the seeded World Cup Postgres ran as a local Postgres 16 on 127.0.0.1:55432 (no Docker in this WSL), loaded from `docker/postgres/init/001_world_cup.sql`.
- Desktop: `npm run test:e2e:desktop` was not run (desktop not run). The desktop uses the same bearer-token path the web suite exercises; the Electron readiness probe moved to `GET /me` (200 or 401).

## Screenshots (web app, fresh data dir)

- [sign-in-page-light.png](sign-in-page-light.png), [sign-in-page-dark.png](sign-in-page-dark.png) — the local sign-in page, "Sign in as" dropdown, Sign in disabled until a user is chosen. Options: Avery Approver · Approver, Dana Data Owner · User (no datasource yet), Demo User · Platform admin, Mark Maker · Maker, Uma User · User.
- [demo-user-account-menu.png](demo-user-account-menu.png) — signed in as Demo User: "DU" avatar, account menu with demo@local.test and Sign out, Admin on the rail.
- [admin-users-local-personas.png](admin-users-local-personas.png) — Admin › Users & groups lists the five personas with the local-mode footer.
- [admin-edit-dana-data-owner.png](admin-edit-dana-data-owner.png) — after Demo User created the "World Cup PostgreSQL" datasource, Dana Data Owner holds "Data owner · World Cup PostgreSQL" automatically (admin R72).
- [uma-user-shell-no-admin.png](uma-user-shell-no-admin.png) — signed in as Uma User: "UU" avatar, no Admin item.

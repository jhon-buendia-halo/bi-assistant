# BA-163 — Org server foundation: sign-in, directory, roles, owner scoping

Implementation plan for roadmap 2.1.2 ([BA-163](https://halo-powered.atlassian.net/browse/BA-163)), epic [BA-161](https://halo-powered.atlassian.net/browse/BA-161). Decisions: ADR-0010 and ADR-0011 in [specs/system/architecture.md](../../specs/system/architecture.md). Epic scope: [specs/epics/BA-161/spec.md](../../specs/epics/BA-161/spec.md). Specs are the contract; this file is the build order and design detail. Where they disagree, the specs win.

## Decisions taken with the user (2026-10-10)

- The organisation self-hosts the server. Local mode stays the default and is unchanged.
- OIDC sign-in with Entra ID, SCIM 2.0 inbound, SQLite kept.
- Datasources, datasets and the LLM configuration are org-wide and managed by Platform admins. Everything else is private to its owner.
- No "Sync from Entra ID" button: P2 shows the time of the last SCIM request.
- **First admin:** `ORG_BOOTSTRAP_ADMINS` holds a comma-separated list of emails. Those users hold Platform admin whenever they sign in (an implicit assignment, not a stored one).
- **Permissions:** 11 in all: the 9 on the Figma P4 board, plus *Manage datasources and datasets* and *Manage LLM configuration*, both Platform admin only.
- **Composer Reasoning effort:** hidden for anyone without *Manage LLM configuration*. Revisit with BA-159.

## Permission matrix (exact, from Figma P4 node 52:1055)

| Permission id | Label | User | Maker | Data owner | Approver | Platform admin |
|---|---|---|---|---|---|---|
| `use-agents` | Use agents in the gallery and chat | ✓ | ✓ | ✓ | ✓ | ✓ |
| `create-agents` | Create, test and version agents | | ✓ | | | ✓ |
| `share-agents-team` | Share agents with own team | | ✓ | | | ✓ |
| `request-publishing` | Request org-wide publishing | | ✓ | | | ✓ |
| `approve-publishing` | Approve org-wide publishing | | | | ✓ | ✓ |
| `approve-datasource-access` | Approve access to a data source | | | ✓ | | ✓ |
| `manage-users` | Manage users, roles and group mappings | | | | | ✓ |
| `edit-policies` | Edit policies and templates | | | | | ✓ |
| `view-audit-log` | View audit log | | | | ✓ | ✓ |
| `manage-datasources` | Manage datasources and datasets | | | | | ✓ |
| `manage-llm` | Manage LLM configuration | | | | | ✓ |

Every signed-in user holds the User role implicitly. Roles are additive.

## Slices (each one green and committed before the next)

1. **S1: auth core, local mode as a no-op.**
   - The `auth` module, and `CurrentUserService` on `AsyncLocalStorage`.
   - A global `PermissionsGuard` (`APP_GUARD`), with `@RequirePermission()` on every route and `@Public()` / `@ScimAuth()` markers.
   - A startup self-check that fails if any route has no marker.
   - `GET /me`. In local mode it answers the implicit local user with every permission.
   - Proof: the existing suites stay green, plus an API test for `/me`.
2. **S2: owner scoping.**
   - An `OwnedDocStore<T>` wrapper that stamps `ownerId` on insert and ANDs it into every filter. A missing `ownerId` matches the local user only.
   - Owned tokens for `sessions`, `agents`, `knowledge_snippets`, `verified_queries`, `metrics` and `eval_runs`. `connections`, `datasets`, `datasource_inventories` and `settings` stay unscoped.
   - Built-in agent pins become per user.
   - The in-memory previews, eval runs and deep-analysis jobs are filtered by owner.
   - `VerifiedQueriesRepository.onModuleInit` keeps the raw store.
   - Proof: unit tests with two owners per repository, and the existing suites green.
3. **S3: org mode backend.**
   - `config/org-server.config.ts` (`ORG_OIDC_ISSUER`, `ORG_OIDC_CLIENT_ID`, `ORG_OIDC_CLIENT_SECRET`, `ORG_PUBLIC_BASE_URL`, `ORG_SCIM_TOKEN`, `ORG_BOOTSTRAP_ADMINS`). Partial configuration is a startup error.
   - `openid-client@6`, loaded lazily behind an `OidcClient` interface.
   - `/auth/login`, `/auth/callback` and `POST /auth/logout`, with an opaque `auth_sessions` cookie and an Origin check on non-GET requests.
   - Just-in-time users, role resolution, and SCIM `/scim/v2/{Users,Groups,ServiceProviderConfig,ResourceTypes,Schemas}`.
   - `activity_events`, `trust proxy`, and `POST`/`DELETE /admin/role-assignments` (guarded by `manage-users`, needed by the tests and by BA-166).
   - Proof: backend API e2e with an in-test OIDC stub (`org-auth`, `scim`, `owner-isolation`).
4. **S4: frontend.**
   - `core/auth/auth.service.ts`, which loads `/me` before the other bootstrap loads, and a sign-in page with **Sign in with Microsoft**.
   - The 401 handling shows the sign-in page, and a 403 shows a toast.
   - The rail avatar shows initials and opens a menu with the email and **Sign out**. Local mode keeps "Demo User".
   - An **Admin** rail item (`manage-users`, org mode only) opens a placeholder admin shell.
   - Controls are hidden by permission.
   - Proof: a Playwright `org` project with an OIDC stub and a SCIM helper. The `web` project is untouched.
5. **S5: alignment and close.** Rebase onto BA-159 if it has merged, then run every gate and write the changelog, evidence and retrospective.

## Route → permission map

- `sessions/*` (including the stream, feedback, visuals and deep analysis): `use-agents`.
- `agents`:
  - `GET` list, `GET :key`, `GET :key/evals` and `PUT :key/pin`: `use-agents`.
  - create, update the draft, publish, delete, and every eval run route: `create-agents`.
- `knowledge/*` and `metrics/*`: `use-agents` (owner-scoped).
- `datasources`:
  - `GET` and `GET :id/inventory`: `use-agents`.
  - create, test-connection, `rest/discover` and delete: `manage-datasources`.
- `datasets`:
  - `GET`: `use-agents`.
  - save and delete: `manage-datasources`.
- `testing-data/*`: `manage-datasources`.
- `llm`:
  - `GET settings` (and `GET effort-levels` after BA-159): `use-agents`.
  - `PUT settings`, `PUT reasoning` and `POST test-connection`: `manage-llm`.
- `developer-settings/*`: `edit-policies`.
- `auth/*` and `GET /me`: public. `scim/v2/*`: SCIM bearer token. `admin/*`: `manage-users`.

## Test harness

- **OIDC stub:** a hand-rolled `node:http` server (discovery, authorize, token with PKCE, JWKS, end session), signing RS256 with `node:crypto`. It lives in `backend/test/oidc-stub.ts` and is reused by the frontend E2E helper.
- **Org fixture:** `launchOrgApp()` starts the stub, then the CLI with the `ORG_*` environment. `signInAs(page, user)` signs in as one user. The org fixture waits for **Sign in with Microsoft** or **Open system logs**.
- **Scripts:** `npm run test:e2e:org` runs the org project. `npm run test:e2e` keeps running the local `web` project only.

## Risks

- Data isolation: one missed repository leaks data between users. Mitigations are the owned store, the startup self-check, and an isolation test per private collection.
- Overlap with BA-159 in the `llm` module: apply the decorators after its merge to avoid conflicts.
- In-memory maps (previews, eval runs, deep-analysis jobs) are keyed by id only, so filter them by owner.
- `Secure` cookies on `http://` dev URLs: decide from the scheme of `ORG_PUBLIC_BASE_URL`.

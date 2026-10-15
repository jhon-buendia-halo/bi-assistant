# BA-232 design — Single-user app: remove authentication and authorization, keep only the super admin

Roadmap 1.14.19, epic [BA-213](https://halo-powered.atlassian.net/browse/BA-213), story [BA-232](https://halo-powered.atlassian.net/browse/BA-232). Asked on 2026-10-14: "No just leave the super admin user remove everything related to authentication and authorization".

User decisions: single user, no sign-in (one built-in super admin always the caller; no sign-in page, no Entra ID / SCIM org server mode, no local personas, no roles or permission checks; every feature available); the Admin area removed entirely; data owned by other users reassigned to the super admin; tracked as a story under BA-213; **the desktop backend's bind address is left as it is** (user's choice; the ADR states the exposure); **the super admin's name appears nowhere** (no avatar, no account menu; agents keep "Owner: You").

The app store is SQLite only (`better-sqlite3`, ADR-0003). Next ADR: **ADR-0030**. Next roadmap feature: **1.14.19**.

## 1. ADR-0030 — One built-in super admin; authentication, authorization and the Admin area removed

- Status Accepted, 2026-10-14, Level 2 (containers) or Level 3 as the file's structure suggests.
- Context: ADR-0010 added org server mode (Entra ID OIDC, SCIM, five roles, owner scoping, the Admin area), ADR-0011 its backend session and Origin check, ADR-0012 local personas with a bearer-token session. The user decided to keep only a super admin and remove everything related to authentication and authorization. Every request pays a session read, a role resolution and an owner filter for one user.
- Decision: one built-in super admin is always the caller; no sign-in page, no `/me`, `/auth/*`, `/scim/*`, `/admin/*`; no roles, permissions, guard, decorators, Origin check or cookies; no `ORG_*` configuration; the seven identity collections are dropped and private data is consolidated under the super admin by migration M14; `ownerId` stays on documents as an inert attribute; the web CLI keeps binding `127.0.0.1`.
- Consequences: (a) security: anyone who can reach the port has full access, the stored LLM key and developer settings included; the boundary is the host. The web CLI binds 127.0.0.1; the desktop backend keeps its current bind (all interfaces) by the user's choice, so on the desktop anyone on the network who reaches the port has full access; `--host 0.0.0.0` on the CLI likewise. (b) Desktop and CLI deliveries unchanged; the desktop readiness probe goes back to `GET /sessions` → 200; the CLI banner loses `Mode:`. (c) A data dir from an org server opened by this version shows every user's data under one owner; identity, roles and auth sessions are deleted at first start; RFP records keep `created_by` as a label. (d) Supersedes ADR-0010, ADR-0011, ADR-0012 and the per-user clause of ADR-0009; narrows ADR-0022 (skills no longer per owner), ADR-0023 and ADR-0026 ("Platform admins" becomes "the user").
- Status lines: ADR-0010 → `Superseded by ADR-0030 (local mode amended by ADR-0012 before that)`; ADR-0011 → `Superseded by ADR-0030`; ADR-0012 → `Superseded by ADR-0030`; ADR-0009 → `Accepted; the per-user document (ADR-0010) removed by ADR-0030`; ADR-0022, ADR-0023, ADR-0026 → append `; ownership and the Platform-admin restriction removed by ADR-0030`. Redraw Level 1 (drop member, admin, idp) and Level 2 (drop the `org` subgraph, `entra`, the appdb note) and the container bullet about org mode.

## 2. The super admin

- `backend/src/common/super-admin.ts`: `export const SUPER_ADMIN = Object.freeze({ id: 'local', displayName: 'Super admin' })`. The id stays `local`, so documents already stamped by M13 and the `*:local` settings keys need no second rewrite.
- No `/me`, no avatar, no account menu: nothing in the UI shows a user name. Agent cards keep "Owner: You".
- Backend code that needs an id (`ownerId` stamps, `updatedBy`, `assignedBy`, `rfp-created-by`) imports the constant; the `CurrentUserService` parameter is removed everywhere, and its `AsyncLocalStorage` goes.
- UI preferences stay as one document: M14 renames `ui-preferences:local` → `ui-preferences` and `builtin-agent-pins:local` → `builtin-agent-pins` (when the bare key is absent) and deletes other users' `ui-preferences:*` / `builtin-agent-pins:*`. Repositories use the bare constant key.

## 3. Backend

Delete: `backend/src/modules/auth/**`, `backend/src/modules/admin/**`, `backend/src/common/decorators/auth-requirement.decorators.ts`, `backend/src/common/guards/permissions.guard.ts` (+ spec), `backend/src/config/org-server.config.ts` (+ spec), `backend/src/infrastructure/database/owned-doc-store.ts` (+ spec), `backend/test/{local-auth,org-auth,org-admin,scim,owner-isolation}.e2e-spec.ts`, `backend/test/oidc-stub.ts`, `backend/test/org-server.ts`. Drop the deps `openid-client` and `cookie` if nothing else uses them.

Edit:
- `app.module.ts`: drop `AuthModule`, `AdminModule`.
- `app-bootstrap.ts`: drop `loadOrgServerConfig`, `trust proxy`, the `scim+json` body parser, `orgPublicBaseUrl`; keep `cors`.
- `cli.ts`: drop `orgPublicBaseUrl` and the `Mode:` banner line.
- `infrastructure/database/doc-store.ts`: delete the identity tokens, the `OWNED_*` tokens and `PRIVATE_COLLECTIONS`.
- `infrastructure/database/database.module.ts`: `COLLECTIONS` loses the identity collections; `isLocalMode`/`backfillLocalOwners` become **M14 `consolidateOwners(db)`**, run after `renameLegacyFields`, raw SQL, idempotent: (1) for `sessions, verified_queries, metrics, eval_runs, knowledge_snippets, agents, skills`: set `$.ownerId` to `local` where null or different (subsumes M13); (2) the settings key renames and deletes of section 2; (3) `DROP TABLE IF EXISTS` users, groups, group_members, role_assignments, group_role_mappings, auth_sessions, activity_events; (4) skill name clashes after the merge: a skill with the same `name` as one already owned by `local` is suffixed `-2`, `-3`… and `[[skill:<old>]]` links in the `draft.instructions` (and live instructions) of the agents of that skill's former owner are rewritten. Unit tests in `database.module.spec.ts` (replacing the M13 block).
- Controllers: remove every `@RequirePermission` / `@Public` and its import. `llm.controller.ts`: always return the masked key.
- Repositories: inject the raw collection token instead of `OWNED_*` (sessions, verified-queries, metrics, eval-runs, knowledge, user-agents, skills); `ui-preferences` and `builtin-agent-pins` repositories use the constant bare key, no `CurrentUserService`.
- Services: `sessions.service.ts` (previews keyed by id only; `RFP_CREATED_BY` ← `SUPER_ADMIN.id`; remove `recordAgentError` and the `ActivityService` dependency); `deep-analysis.service.ts` (no `ownerId`, no `bind`); `agents/eval-runs.service.ts` (one running run per agent); `agents/agent-prompts.service.ts` and `skills/built-in-skills.service.ts` (`updatedBy: SUPER_ADMIN.id`); `datasources/datasources.service.ts` (drop the data-owner hook); `mastra/evals/run-assistant-evals.ts` (no persona run wrapper). Entities keep `ownerId?: string` with a "legacy attribute" comment.
- `frontend/electron/main.cjs`: readiness probe `GET /sessions` → 200; drop the `ORG_` env filter.
- Unit specs that construct `CurrentUserService` / `runAs` are updated.

## 4. Frontend

Delete: `frontend/src/app/core/auth/**` (service, models, testing, sign-in page, account menu), `core/interceptors/auth.interceptor.ts` (+ spec), `features/admin/**`, `root.ts` (+ spec) if it only gates on auth (bootstrap `App` directly in `main.ts`).

Edit: `app.config.ts` (no interceptor); `app.ts`/`app.html` (no `admin` area/view, no Admin rail item, no `<app-account-menu>`, no permission on settings sections, Reasoning effort always shown); `core/toast/toast.service.ts` (no permission-toast special case); `sessions-api.service.ts` and `knowledge-api.service.ts` (no auth headers, no `refusalOf`, plain status messages); agents components (`agent-hub`, `skills-library`, `skill-editor`, `agent-detail`, `agent-skills-inline`, `agent-system-prompt`) and `builtin-skill-editor.service.ts`: every `auth.can(...)` gate → always shown; datasets (`catalog-browser`, `dataset-list`): gates removed and the inert "Yours" / "Shared with you" filter chips removed; `home/components/welcome/welcome.ts`: step 1 copy no longer says "shared with you" ("Create one from a datasource, or use an existing one."). The shell renders at once (no `GET /me`). Unit specs drop their `AuthService` stubs.

## 5. Specs

- Delete `specs/capabilities/admin/` and its row in `specs/README.md`; remove links to it.
- `specs/system/api.md`: the auth section becomes "no authentication; every route is open to whoever reaches the port; the Intellify RFP API keeps its key"; delete the auth, SCIM and admin route sections and the per-route permission table/column; the LLM config masked-key note; "each user's own" wording; the desktop probe → `GET /sessions` 200; the `ORG_*` env rows.
- `specs/system/data-model.md`: store row without identity collections; the ui-preferences key `ui-preferences`; delete the identity collection sections; rewrite the ownership section as "Ownership (legacy `ownerId`)": one owner, `local`, inert; section 6: add M14 and mark M13 as subsumed.
- `specs/system/ui.md`: rail without Admin and the avatar; the view table row `admin`; delete the auth/sign-in section, the account menu, the Admin area sections; Reasoning effort always shown; §7 copy for sign-in, account and permission toasts removed.
- `specs/system/delivery.md`: `test:e2e:org` gone; org deployment section deleted; env vars; the security note about the desktop bind and `--host 0.0.0.0`.
- `specs/system/tech-stack.md`: drop the auth/admin/org paragraphs, the `org` Playwright project and fixture.
- `specs/system/agents.md`: anyone edits every prompt and skill; `rfp-created-by` = the super admin's id; the Ownership paragraph → one owner.
- Capabilities (rules mentioning roles, permissions, owners, sign-in, "Platform admin", sharing): agents-evals, app-shell (local sign-in scenario → "The app opens straight into the shell"), rfp, llm-settings, datasets (sharing section, filter chips), verified-queries, sessions-chat, metrics, datasources, knowledge, developer-settings, agent-panel.
- `specs/product/glossary.md`: remove the identity terms (Approver, Bootstrap admin, Data owner, Group mapping, Local mode, Local persona, Local user, Maker, Org server mode, Ownership transfer, Owner, Permission, Platform admin, Role, User status, Agent error if only the admin activity used it); add **Super admin**. `specs/product/non-functional.md` and `vision.md`: drop the org-mode sections and multi-user language; state the accepted security boundary.
- `specs/epics/BA-213/spec.md`: story row BA-232 / 1.14.19. `specs/epics/BA-161/spec.md` (the admin epic): add one status line "Undone by ADR-0030 / roadmap 1.14.19 (2026-10-14)"; do not rewrite it.
- `roadmap.md`: feature 1.14.19 under Milestone 1.14 (Intent / Scope / Out of scope / Acceptance / Notes, linking this doc); one sentence in the Release 2 / Milestone 2.1 intro: "Undone by 1.14.19 (ADR-0030); its features stay as shipped history."

## 6. Tests (E2E at the acceptance gate; unit tests now)

- Frontend e2e, delete: `org-sign-in`, `org-permissions`, `org-isolation`, `org-admin-overview`, `org-admin-users`, `org-admin-edit-user`, `org-admin-roles`, `local-sign-in` specs, `e2e/fixtures/org.fixture.ts`, `e2e/helpers/{org-actions,scim-client,admin-actions}.ts`; `playwright.config.ts` org project; `package.json` `test:e2e:org`.
- Helpers: `e2e/helpers/local-auth.ts` → `e2e/helpers/api.ts` keeping only the API helpers; `agents-api.ts`, `app-actions.ts` drop auth headers; `app.fixture.ts` drops sign-in/sign-out and waits for the shell; desktop readiness on `/sessions`.
- `navigation.spec.ts`: "opens as the super admin": shell visible without sign-in, no account menu, no Admin rail item.
- Backend e2e: `backend/test/backend-process.ts` drops sign-in/bearer and probes `/sessions`; other e2e specs drop the token.

## 7. Evals

Nothing an agent receives changes (prompts, tools, skills, context blocks, model routing). `rfp-created-by` is the constant `local` (already `local` before). No eval gate.

## 8. Units

- A — backend (sections 2, 3) + `frontend/electron/main.cjs`.
- B — frontend (section 4).
- C — specs (sections 1, 5) + roadmap + epic specs.
- D — tests (section 6) — at the acceptance gate.

Verification: backend `npm test`, `npm run lint`, `npm run build`; frontend `npm test`, `npm run build`; `python3 scripts/check-specs.py`; `grep -rn "ORG_\|RequirePermission\|CurrentUserService\|auth.can\|/me'" backend/src frontend/src` empty; manual smoke on a copy of a real data dir: opens into the welcome with no sign-in, no Admin item, no avatar, every area and Settings section reachable, old sessions/agents/skills listed, `app.sqlite` has no `users` table.

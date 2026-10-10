# BA-161 — Admin Panel

- **Jira:** [BA-161](https://halo-powered.atlassian.net/browse/BA-161) · **Roadmap:** Milestone 2.1 · **Status:** Draft

## Goal

An organisation runs the app on its own server for many people. People sign in with their company Entra ID account. They share the organisation's datasources and datasets, keep their own sessions, agents and knowledge private, and can do only what their role allows. Platform admins manage users, groups, roles and permissions in an admin panel.

Today the app is single-user and local: there is no sign-in and no roles, and the rail's "Demo User" avatar is a placeholder. Local mode stays, and org server mode is added beside it. Direction: [vision.md](../../product/vision.md). Decision: ADR-0009 in [architecture.md](../../system/architecture.md).

Visual reference: the Figma board [Agent Hub — E2E lifecycle (proposed)](https://www.figma.com/board/S3DMKrgzGHMl65c5bzvabR/Agent-Hub---E2E-lifecycle--proposed-?node-id=52-1167), section *Admin panel (draft)*, screens P1–P4.

## Scope

- **Two modes.**
  - **Local mode** is the default and unchanged: no sign-in, one implicit local user with every permission, and no Admin item.
  - **Org server mode** is turned on by server configuration (identity provider, public URL, SCIM token) and reached from a browser.
- **Sign-in.**
  - OpenID Connect with Microsoft Entra ID, run by the backend, with a session cookie.
  - Sign-out.
  - The rail avatar shows the signed-in user's initials and name.
  - An unauthenticated request gets a sign-in page, never data.
- **Directory.**
  - Users and groups are pushed by Entra ID through SCIM 2.0.
  - A user who signs in before being provisioned is created just in time.
  - Groups are read-only in the app.
  - Status is Active, Inactive (no activity for 90 days or more) or Not signed in.
- **Roles and permissions.**
  - Five roles:
    - **User:** use agents and chat.
    - **Maker:** create, test and version agents.
    - **Data owner:** scoped to one datasource; approves access to it.
    - **Approver:** approves org-wide publishing.
    - **Platform admin:** manages users, roles, group mappings and policies.
  - A fixed permission matrix (P4) maps roles to permissions.
  - A user's roles are their direct assignments plus their groups' mappings.
  - The backend enforces the matrix on every endpoint.
- **Data ownership.**
  - Datasources and datasets are shared org-wide. Only Platform admins create, edit and delete them.
  - Sessions, visuals, memory, agents, knowledge, verified queries, metrics and eval runs are private to their owner.
- **Admin panel** (Platform admins only), a new **Admin** item on the rail with these tabs:
  - **Overview (P1).** Tiles:
    - active users in the last 30 days;
    - agents live.

    A **Needs attention** list, each row with an action:
    - agents without an active owner → **Assign**;
    - agents with errors in the last 7 days → **Inspect**;
    - users inactive for 90 days or more who still hold the Maker role → **Clean up**.

    Also a **Weekly active users** chart (last 8 weeks), **Recent activity**, and **Export report** (CSV).
  - **Users & groups (P2).**
    - Users and Groups tabs with counts, and a search over name, email and group.
    - Role filter chips (All roles, Platform admins, Approvers, Data owners, Makers, Inactive 90d).
    - A table: name and email, roles, IdP groups, agents owned, last active, status.
    - Pagination, the last-sync note and **Assign role**.
  - **Edit a user (P3).** Selecting a user opens a detail panel:
    - identity and status;
    - role checkboxes with their descriptions (Data owner names its datasource);
    - read-only groups;
    - agents owned with their status, and **Transfer ownership**;
    - **Save changes**.
  - **Roles & permissions (P4).**
    - The permission matrix, read-only: the five built-in roles against the nine permissions on the board.
    - **Role ← Entra ID group mappings**, with add and remove. Members of a mapped group get the role at their next sync or sign-in.

## Out of scope

- **Requests (A1)**: publish requests and data-access requests, their approval flows, and the P1 tiles and attention rows that count them.
- **Registry (A3)**: sharing agents with a team or the whole org, and org-wide publishing. Agents stay private to their owner.
- **Policies** and **Audit log** tabs. Recent activity on P1 is a short feed, not an audit log.
- **Add role**: custom roles and editing the permission matrix. The five roles are fixed.
- Restricting a datasource to some users. In this epic every signed-in user can read every shared datasource. Data owner can be assigned, but its approvals arrive with Requests.
- A desktop app connecting to a remote org server. The desktop app runs in local mode only.
- Identity providers other than Entra ID, and pulling the directory through Microsoft Graph.
- Halo-hosted org servers. Moving a local-mode data directory into an org server.
- PostgreSQL as the app store (ADR-0009 keeps SQLite).

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-162](https://halo-powered.atlassian.net/browse/BA-162) | ADR, epic spec, vision and roadmap | 2.1.1 |
| [BA-163](https://halo-powered.atlassian.net/browse/BA-163) | Sign-in with Entra ID, directory sync, roles and enforcement | 2.1.2 |
| [BA-164](https://halo-powered.atlassian.net/browse/BA-164) | Admin overview (P1) | 2.1.3 |
| [BA-165](https://halo-powered.atlassian.net/browse/BA-165) | Users & groups (P2) | 2.1.4 |
| [BA-166](https://halo-powered.atlassian.net/browse/BA-166) | Edit a user (P3) | 2.1.5 |
| [BA-167](https://halo-powered.atlassian.net/browse/BA-167) | Roles & permissions (P4) | 2.1.6 |

All stories are built on one branch, `feat/BA-161-admin-panel`, and ship as one PR. BA-163 is the foundation, and the four screens build on it. P2 → P3 → P4 is the suggested order, with P1 last because it reads data from all of them.

## Specs touched

- [product/vision.md](../../product/vision.md): local and org server modes, principles 1, 3 and 12–15, the Platform admin persona, and non-goals (BA-162).
- [system/architecture.md](../../system/architecture.md): ADR-0009 (BA-162). The Level 1 and Level 2 diagrams gain the identity provider and org server mode (BA-163).
- [product/non-functional.md](../../product/non-functional.md): org server mode, binding and TLS behind a proxy, session cookies, CSRF, SCIM token, and data isolation between users (BA-163).
- [system/data-model.md](../../system/data-model.md): the `users`, `groups`, `group_members`, `role_assignments`, `group_role_mappings`, `auth_sessions` and `activity_events` collections, and `ownerId` on private collections, where a missing value means the local user (BA-163). Agent ownership transfer (BA-166).
- [system/api.md](../../system/api.md): the auth routes, `GET /me` with roles and permissions, the SCIM 2.0 endpoints, the permission each endpoint needs, and the admin endpoints (overview, users, user roles, transfer ownership, role mappings, export) (BA-163–BA-167).
- [system/agents.md](../../system/agents.md): per-user scoping of memory threads and of the LLM configuration (BA-163).
- [system/ui.md](../../system/ui.md): the sign-in page, the signed-in avatar and sign-out, the Admin rail item, and the admin panel layout and its four tabs (BA-163–BA-167).
- [system/tech-stack.md](../../system/tech-stack.md) and [system/delivery.md](../../system/delivery.md): the OIDC library, org server configuration and how to run it, and the E2E OIDC stub (BA-163).
- New capability **admin** (`specs/capabilities/admin/spec.md`), with rules and Gherkin for sign-in, enforcement and each admin tab, and a row in [specs/README.md](../../README.md) (BA-163–BA-167). Owner scoping rules go into the existing capability specs (sessions-chat, agents-evals, datasources-datasets, knowledge, verified-queries, metrics) (BA-163).
- [product/glossary.md](../../product/glossary.md): *local mode*, *org server mode*, *role*, *permission*, *group mapping*, *Platform admin*, *Maker*, *Data owner*, *Approver* (BA-163).

## Acceptance

- In local mode the app behaves as it does today. The full existing E2E suite passes unchanged, and no Admin item appears.
- In org server mode, an unauthenticated browser sees only the sign-in page. After signing in through the OIDC stub, the rail shows the user, and sign-out ends the session.
- Two users on one org server see the same datasources and datasets. They never see each other's sessions, visuals, agents, knowledge, verified queries, metrics or eval runs, through the UI or the API.
- A User without Maker can't create an agent: the button is hidden and the API answers 403. A non-admin can't open the Admin panel or call admin endpoints (403).
- SCIM create, update and deactivate of users and groups shows up in Users & groups. A group-to-role mapping grants the role to its members.
- A Platform admin can:
  - assign and remove roles on P3, and transfer an agent's ownership;
  - see P1's tiles, attention rows, weekly chart and recent activity computed from real activity, and export them as CSV;
  - see the matrix and add or remove group mappings on P4.
- Every new Gherkin scenario has a passing Playwright spec. The axe scan is clean on every admin screen in both themes.

## Dependencies, risks and open questions

- **Not in the 1.0 Beta.** This is Release 2 work. If it must be in the beta, it needs its own window and would compete with Milestones 1.1–1.10.
- **Data isolation is the main risk.** Every repository must apply the owner scope, and one missed query leaks data between users. Mitigation: one owner-scope rule in the DocStore layer, plus an API test per private collection with two users.
- **Mastra memory and workspaces** are keyed by session id today. They must be checked to be unreachable across users, since session ids aren't secrets.
- **BA-159 LLM configuration** is in progress. Proposed: in org server mode each user keeps their own LLM configuration (it was not chosen as shared), and an org-wide default can come later. Confirm.
- **Board items that need epics this one excludes**: "Publish requests" and "Data access requests" (tiles and rows), and "Share agents with own team", "Request org-wide publishing" and "Approve org-wide publishing". They appear in the P4 matrix as permissions, but no screen uses them yet.
- **Open: "Sync from Entra ID".** SCIM is pushed by Entra ID on its own cycle, so the app can't start a sync. Proposed: P2 shows the time of the last SCIM request instead of a sync button. Confirm, or add a Microsoft Graph pull (out of scope above).
- **Open: datasource and dataset management.** Proposed: Platform admin only. The P4 matrix on the board has no "manage datasources" row, so it would add a tenth permission, "Manage datasources and datasets".
- **Open: "Agents with errors in the last 7 days"** needs a definition of an agent error. Proposed: a turn in a session started from the agent that ended in an error.
- **Open: E2E for SSO.** Playwright needs a local OIDC provider stub and a SCIM test client. The harness should run org server mode beside the existing local-mode suite, not replace it.
- **Related:** [BA-150](../BA-150/spec.md) Agent Hub (agent ownership), [BA-82](../BA-82/spec.md) Agent Routines (whose identity a scheduled run uses).

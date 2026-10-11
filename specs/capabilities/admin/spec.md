# Admin

An organisation can run the app on its own server for many people. People sign in with their company Microsoft account, share the organisation's datasources, datasets and LLM configuration, keep their own sessions, agents and knowledge private, and can do only what their roles allow. The directory of people and groups is pushed from the identity provider. Platform admins get an **Admin** area. This spec owns the two modes, sign-in, the directory, roles and permissions, their enforcement, and data ownership. The admin tabs themselves (Overview, Users & groups, Roles & permissions) are filled in by later stories of epic [BA-161](../../epics/BA-161/spec.md); today the Admin area is a placeholder. Decision: ADR-0010 and ADR-0011 in [../../system/architecture.md](../../system/architecture.md).

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): local mode, org server mode, local user, owner, bootstrap admin, role, permission, group mapping, User (role), Maker, Data owner, Approver, Platform admin, session, agent, user agent, datasource, dataset, knowledge entry, verified query, metric, eval run.

Capability-local vocabulary:
- **Sign-in page** — the only screen an unauthenticated browser sees in org server mode.
- **Auth session** — the server-side record behind a signed-in browser, referenced by a cookie. Not the same thing as a chat *session*.
- **Directory** — the users, groups and group memberships the app knows about, pushed by the identity provider through SCIM or created at first sign-in.
- **Deactivated user** — a directory user whose `active` flag is false. They cannot sign in.
- **Admin area** — the main view opened by the **Admin** rail item.

## Rules

### Modes

- R1. The system SHALL run in exactly one of two modes, chosen at startup: **local mode** (the default) or **org server mode**. The mode SHALL NOT change while the server runs.
- R2. Local mode SHALL behave exactly as the app did before org server mode existed: no sign-in page, no sign-out, one implicit **local user** who holds every permission (R21), and no **Admin** rail item. The rail avatar SHALL stay the static "D" titled "Demo User" (app-shell R4). The desktop app SHALL always run in local mode.
- R3. Org server mode SHALL be turned on by server configuration naming the identity provider's issuer, client id and client secret, the server's public base URL and the SCIM token. Configuring some but not all of these SHALL be a startup error that names the missing settings; the server SHALL NOT start in local mode by accident. The bootstrap admin list (R18) is optional.
- R4. In org server mode the public base URL SHALL be an `https://` URL, except for development and automated tests, which MAY use `http://`.

### Sign-in and sign-out

- R5. In org server mode, a browser without a valid auth session SHALL see the sign-in page and nothing else: no rail, no data, no list of sessions. The page SHALL show "Agentic Hub" and one **Sign in with Microsoft** button.
- R6. **Sign in with Microsoft** SHALL send the browser to the identity provider. After the person authenticates there, the browser SHALL come back to the app signed in, on the home view.
- R7. The sign-in round trip SHALL be protected against replay and code interception (a one-time `state`, a `nonce` and a PKCE verifier, held only for the round trip, at most 10 minutes). A round trip that fails any check, or that the identity provider reports as an error, SHALL return to the sign-in page with "Sign-in failed. Try again." and SHALL NOT create an auth session.
- R8. A successful sign-in SHALL create an auth session and set it as an `HttpOnly`, `SameSite=Lax` cookie, `Secure` unless the public base URL is `http://`. The browser SHALL hold no identity-provider token.
- R9. An auth session SHALL end after 8 hours without a request, or 7 days after sign-in, whichever comes first. A request with an ended or unknown auth session SHALL be treated as unauthenticated (R11).
- R10. In org server mode the rail avatar SHALL show the signed-in user's initials, titled with their display name. Clicking it SHALL open a menu with their display name, their email and **Sign out**. **Sign out** SHALL end the auth session on the server, clear the cookie, end the identity-provider session, and return the browser to the sign-in page. Reloading or going back afterwards SHALL show the sign-in page.
- R11. In org server mode every API request without a valid auth session SHALL be refused with HTTP 401 and no data, except the sign-in routes and the SCIM routes (R14). The current-user route also answers 401, which is how the app learns to show the sign-in page. When the app receives a 401 while it is open (for example because the auth session expired), it SHALL show the sign-in page.

### Directory

- R12. A person who signs in and is not yet in the directory SHALL be added at that moment (**just in time**) from their sign-in claims: display name, email and user name. They start with no assigned roles, so they hold the User role only (R19).
- R13. A person who signs in and is already in the directory SHALL be matched to their directory user, first by the identity provider's subject recorded at an earlier sign-in, else by user name or email (case-insensitive). Their display name and email SHALL be refreshed from the claims.
- R14. The identity provider SHALL be able to create, read, update and deactivate users, and create, read, update and delete groups and their memberships, through SCIM 2.0 endpoints authenticated by the SCIM bearer token. A missing or wrong token SHALL be refused with HTTP 401. SCIM requests SHALL NOT use or need an auth session.
- R15. A user provisioned through SCIM who has not signed in yet SHALL be in the directory, with no sign-in time. When they first sign in they SHALL be matched to that user, not duplicated (R13).
- R16. A deactivated user SHALL NOT be able to sign in: the round trip SHALL return to the sign-in page with "Your account is deactivated. Contact your administrator." Deactivating a user SHALL end all their auth sessions at once, so their next request is refused (R11). Deactivation SHALL keep their data and ownership. Reactivating them SHALL let them sign in again.
- R17. Groups SHALL be read-only in the app: they and their members change only through SCIM. Deleting a group SHALL remove its memberships and its group mappings.
- R18. Every email in the bootstrap admin list SHALL hold the Platform admin role whenever that person is signed in, without a stored assignment. The match SHALL be case-insensitive. This role SHALL NOT be removable in the app; it goes away only when the email leaves the list and the server restarts.

### Roles and permissions

- R19. There SHALL be five built-in roles: **User**, **Maker**, **Data owner**, **Approver** and **Platform admin**. Every signed-in user SHALL hold the User role implicitly. The set of roles is fixed: roles cannot be added, renamed or removed.
- R20. A user's roles SHALL be the union of: User; their direct role assignments; the roles mapped to every group they are a member of (**group mappings**); and Platform admin when they are a bootstrap admin (R18). Roles are additive: holding more roles never removes a permission. A **Data owner** assignment or mapping SHALL name one datasource. Roles SHALL be resolved on every request, so a change applies to the user's next request without signing in again.
- R21. A user's permissions SHALL be the union of their roles' permissions in this fixed matrix. The local user (R2) SHALL hold every permission.

  | Permission | Id | User | Maker | Data owner | Approver | Platform admin |
  |---|---|---|---|---|---|---|
  | Use agents in the gallery and chat | `use-agents` | ✓ | ✓ | ✓ | ✓ | ✓ |
  | Create, test and version agents | `create-agents` | | ✓ | | | ✓ |
  | Share agents with own team | `share-agents-team` | | ✓ | | | ✓ |
  | Request org-wide publishing | `request-publishing` | | ✓ | | | ✓ |
  | Approve org-wide publishing | `approve-publishing` | | | | ✓ | ✓ |
  | Approve access to a data source | `approve-datasource-access` | | | ✓ | | ✓ |
  | Manage users, roles and group mappings | `manage-users` | | | | | ✓ |
  | Edit policies and templates | `edit-policies` | | | | | ✓ |
  | View audit log | `view-audit-log` | | | | ✓ | ✓ |
  | Manage datasources and datasets | `manage-datasources` | | | | | ✓ |
  | Manage LLM configuration | `manage-llm` | | | | | ✓ |

  `share-agents-team`, `request-publishing`, `approve-publishing`, `approve-datasource-access` and `view-audit-log` guard no action yet; the epics that add sharing, requests and the audit log use them.
- R22. A Platform admin SHALL be able to assign a role to a user and remove a direct assignment. Assigning Data owner SHALL require a datasource. Assigning a role the user already holds directly (for Data owner, on the same datasource) SHALL change nothing.

### Enforcement

- R23. The server SHALL check the caller's permission on every API request, and every API route SHALL declare the permission it needs (the per-route list is in [../../system/api.md](../../system/api.md) section 1.9). A route that declares none SHALL stop the server from starting.
- R24. A signed-in request that lacks the route's permission SHALL be refused with HTTP 403 and SHALL change nothing. When the app receives a 403 it SHALL show the error toast "You don't have permission to do this." and keep the current view.
- R25. The app SHALL hide each control whose action the user lacks the permission for, instead of showing it disabled (the list is in [../../system/ui.md](../../system/ui.md) section 1.6). Hiding is a convenience; the server check (R23, R24) is the boundary.
- R26. In particular, without **Manage LLM configuration** the new-session screen SHALL NOT show the **Reasoning effort** control, and the LLM Configuration settings section SHALL be hidden. The configured provider, model and effort still apply to that user's turns.
- R27. In org server mode every request that can change data (any method other than `GET` and `HEAD`) SHALL carry an `Origin` header, or failing that a `Referer` header, whose origin equals the public base URL. Otherwise it SHALL be refused with HTTP 403 and change nothing. SCIM requests are exempt (they carry a bearer token, not a cookie).

### Ownership and privacy

- R28. In org server mode, datasources, datasets and the LLM configuration SHALL be shared: every signed-in user SHALL see and use the same ones, and only holders of the matching permission (Manage datasources and datasets, Manage LLM configuration) SHALL create, change or delete them.
- R29. Everything else a user creates SHALL be private to its **owner**, the user who created it: sessions with their transcripts, visuals, reports, workspace files and agent memory; user agents and their pins; knowledge entries; verified queries; metrics; eval runs; and pins of built-in agents. Another user SHALL NOT see, list, open, change or delete it, through the UI or the API.
- R30. A request for another user's private item by its id SHALL be answered exactly as for an item that does not exist (HTTP 404, or the endpoint's usual not-found answer), so ids reveal nothing.
- R31. Uniqueness rules on private items SHALL apply per owner: two users MAY each have a user agent or a metric with the same name.
- R32. Work that outlives its request (a streamed chat turn, a deep analysis, an eval run, a knowledge bootstrap) SHALL run as the user who started it and SHALL write only to that user's items. Its progress and results SHALL be visible only to that user.
- R33. In local mode every item SHALL belong to the local user, including items stored before org server mode existed. Items stored without an owner SHALL NOT be visible to any user of an org server.

### Admin area

- R34. In org server mode, a user with **Manage users, roles and group mappings** SHALL see an **Admin** item on the rail. Choosing it SHALL open the Admin area and mark the item current. Users without the permission SHALL NOT see the item, and the admin API SHALL refuse them with HTTP 403 (R24). Local mode has no Admin item (R2).
- R35. The Admin area SHALL show the heading "Admin" and three tabs, **Overview**, **Users & groups** and **Roles & permissions**, with Overview selected when the area opens. Until the stories that build them ship, each tab SHALL show a placeholder line naming that story: "Overview arrives with BA-164.", "Users & groups arrives with BA-165." and "Roles & permissions arrives with BA-167."

### Activity

- R36. In org server mode the server SHALL record activity events for: sign-in, sign-out, a user's first request of each UTC day, SCIM requests (at most one event per minute), role assignments and removals, and user deactivation and reactivation. They feed the admin overview and the "last sync" time in later stories; no screen shows them yet.

## Edge cases and errors

- Org server configuration with an issuer but no SCIM token: the server exits at startup with an error naming `ORG_SCIM_TOKEN`.
- The identity provider is unreachable when **Sign in with Microsoft** is clicked: the sign-in page shows "Sign-in failed. Try again."
- A sign-in that returns after more than 10 minutes, or with a `state` that doesn't match: "Sign-in failed. Try again.", no auth session.
- A return address that points outside the app after sign-in is ignored; the browser lands on the home view.
- Two browsers signed in as the same user each have their own auth session. Signing out in one leaves the other signed in.
- A user removed from a mapped group loses the mapped role on their next request; a role they also hold directly stays.
- A Maker whose Maker role is removed while the agent editor is open: **Save** is refused with HTTP 403 and the toast "You don't have permission to do this."; the form keeps its content. The **New agent** button is gone after the next reload of the permissions (the next page load).
- A SCIM request to create a user whose user name already exists: HTTP 409 in SCIM error format, nothing changed.
- A SCIM request for an unknown user or group id: HTTP 404 in SCIM error format.
- Deleting a user through SCIM deactivates them (R16) and hides them from later SCIM reads; their data and ownership stay.
- A bootstrap admin who is deactivated cannot sign in; the bootstrap list does not override deactivation.
- A request from a page served by another origin (a cross-site form post): HTTP 403, nothing changed (R27).
- Pointing an org server at a data directory that a local-mode app used: the old items have no owner and nobody sees them (R33). Moving local data into an org server is out of scope.

## Contracts

- Mode configuration, the auth routes (`GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`), `GET /me`, the SCIM routes, the admin role-assignment routes, the 401/403 bodies, the Origin check and the permission each route needs: [../../system/api.md](../../system/api.md) sections 1.9, 2.13-2.15 and 6.
- The `users`, `groups`, `group_members`, `role_assignments`, `group_role_mappings`, `auth_sessions` and `activity_events` collections, and `ownerId` on private collections: [../../system/data-model.md](../../system/data-model.md) sections 3.14 and 3.15.
- Agent memory and workspaces reached only through an owner-scoped session; the org-wide LLM configuration: [../../system/agents.md](../../system/agents.md) sections 1.3 and 7.1.
- How to run an org server and register it with Entra ID: [../../system/delivery.md](../../system/delivery.md) section 4.1.
- Security requirements (binding, cookies, CSRF, SCIM token, isolation): [../../product/non-functional.md](../../product/non-functional.md) section 3.

## UI

The sign-in page, the signed-in avatar and its menu, the **Admin** rail item and the Admin area placeholder, and the controls hidden by permission: [../../system/ui.md](../../system/ui.md) sections 1.3, 1.6, 4.17 and 4.18. Shell rules: [../app-shell/spec.md](../app-shell/spec.md) R4 and R50. States:
- Sign-in page: idle, signing in (button reads "Signing in…"), failed ("Sign-in failed. Try again."), deactivated ("Your account is deactivated. Contact your administrator.").
- Avatar menu: closed, open.
- Admin area: Overview, Users & groups or Roles & permissions selected, each a placeholder.

## Flows

The three Features below run in the Playwright `org` project, against the app started in org server mode with a local OpenID Connect stub and a SCIM test client (see [../../system/tech-stack.md](../../system/tech-stack.md)). Behaviour with no screen (the SCIM protocol, the Origin check, the 401 and 403 answers of every route, and owner isolation for every private collection) is covered by the backend API tests `backend/test/org-auth.e2e-spec.ts`, `backend/test/scim.e2e-spec.ts` and `backend/test/owner-isolation.e2e-spec.ts` (Feature "Org server API" below); its scenario "Local mode answers as the local user" is `backend/test/local-auth.e2e-spec.ts`, which also checks that the existing routes answer as before in local mode. Local mode is covered by the existing Features, which run unchanged, and by "Local mode has no sign-in and no Admin item" in [../app-shell/spec.md](../app-shell/spec.md).

### Feature: Sign in to an org server

E2E: none yet. Its spec, `frontend/e2e/org-sign-in.spec.ts`, is written in step 7 of BA-163.

```gherkin
Feature: Sign in to an org server

  Background:
    Given the app runs in org server mode
    And "ada@contoso.test" (Ada Lovelace) is provisioned through SCIM

  Scenario: An unauthenticated visitor sees only the sign-in page
    When I open the app
    Then I see "Agentic Hub" and the "Sign in with Microsoft" button
    And I don't see the navigation rail
    And the axe scan reports no violations in the Light theme
    And the axe scan reports no violations in the Dark theme

  Scenario: Signing in opens the app as that user
    When I open the app
    And I click "Sign in with Microsoft" and sign in as "ada@contoso.test"
    Then I see the app shell on the home view
    And the rail avatar shows "AL" titled "Ada Lovelace"
    When I click the rail avatar
    Then the menu shows "Ada Lovelace", "ada@contoso.test" and "Sign out"

  Scenario: A person not yet provisioned is added at first sign-in
    When I sign in as "grace@contoso.test" (Grace Hopper), who is not provisioned
    Then I see the app shell
    And the rail avatar shows "GH"
    And SCIM lists a user "grace@contoso.test"

  Scenario: Signing out returns to the sign-in page
    Given I am signed in as "ada@contoso.test"
    When I click the rail avatar and click "Sign out"
    Then I see the "Sign in with Microsoft" button
    When I reload the page
    Then I still see the "Sign in with Microsoft" button

  Scenario: A failed sign-in shows an error
    When I open the app
    And I click "Sign in with Microsoft" and the identity provider answers with an error
    Then I see "Sign-in failed. Try again."
    And I see the "Sign in with Microsoft" button

  Scenario: Deactivating a user ends their session and blocks sign-in
    Given I am signed in as "ada@contoso.test"
    When the identity provider deactivates "ada@contoso.test" through SCIM
    And I reload the page
    Then I see the "Sign in with Microsoft" button
    When I click "Sign in with Microsoft" and sign in as "ada@contoso.test"
    Then I see "Your account is deactivated. Contact your administrator."

  Scenario: An expired session shows the sign-in page
    Given I am signed in as "ada@contoso.test"
    When my auth session is ended on the server
    And I click "Datasets" on the rail
    Then I see the "Sign in with Microsoft" button
```

### Feature: Permissions in the app

E2E: none yet. Its spec, `frontend/e2e/org-permissions.spec.ts`, is written in step 7 of BA-163.

```gherkin
Feature: Permissions in the app

  Background:
    Given the app runs in org server mode with "admin@contoso.test" as a bootstrap admin
    And the World Cup datasource and the "World Cup Core" dataset exist

  Scenario: A User sees no maker, data or admin controls
    Given I am signed in as "user@contoso.test", who holds only the User role
    When I click "Agents" on the rail
    Then I don't see the "New agent" button
    When I click "Datasets" on the rail
    Then I see "World Cup Core"
    And I don't see the "New dataset" button
    When I click "Settings" on the rail
    Then the settings navigation offers only "Appearance"
    And I don't see "Admin" on the rail
    When I start a new conversation
    Then I don't see the "Reasoning effort" control

  Scenario: A Maker can create an agent
    Given "maker@contoso.test" holds the Maker role
    And I am signed in as "maker@contoso.test"
    When I click "Agents" on the rail and click "New agent"
    And I name the agent "Goal analyst", tick "World Cup Core" and click "Save"
    Then I see the toast 'Agent "Goal analyst" saved as draft'
    And I don't see "Admin" on the rail

  Scenario: A bootstrap admin sees the Admin area
    Given I am signed in as "admin@contoso.test"
    When I click "Admin" on the rail
    Then I see the heading "Admin"
    And I see the tabs "Overview", "Users & groups" and "Roles & permissions" with "Overview" selected
    And I see "Overview arrives with BA-164."
    When I click "Users & groups"
    Then I see "Users & groups arrives with BA-165."
    And the axe scan reports no violations in the Light theme
    And the axe scan reports no violations in the Dark theme

  Scenario: A Platform admin manages shared settings
    Given I am signed in as "admin@contoso.test"
    When I click "Settings" on the rail
    Then the settings navigation offers "Datasource Configuration", "LLM Configuration", "Testing Data", "Developer" and "Appearance"
    When I start a new conversation
    Then I see the "Reasoning effort" control

  Scenario: An action the user lost the right to is refused
    Given "maker@contoso.test" holds the Maker role
    And I am signed in as "maker@contoso.test" with the agent editor open on a new agent named "Goal analyst"
    When an admin removes the Maker role from "maker@contoso.test"
    And I click "Save"
    Then I see the error toast "You don't have permission to do this."
    And the agent editor still shows "Goal analyst"
```

### Feature: Private and shared data

E2E: none yet. Its spec, `frontend/e2e/org-isolation.spec.ts`, is written in step 7 of BA-163.

```gherkin
Feature: Private and shared data

  Background:
    Given the app runs in org server mode
    And the World Cup datasource and the "World Cup Core" dataset exist
    And "ada@contoso.test" and "grace@contoso.test" both hold the Maker role

  Scenario: Users share datasources and datasets
    When I sign in as "ada@contoso.test" and click "Datasets" on the rail
    Then I see "World Cup Core"
    When I sign in as "grace@contoso.test" in another browser and click "Datasets" on the rail
    Then I see "World Cup Core"

  Scenario: Sessions are private to their owner
    Given I am signed in as "ada@contoso.test" and created the session "Ada's goals"
    When I sign in as "grace@contoso.test" in another browser and click "Sessions" on the rail
    Then I see "No sessions yet."

  Scenario: Agents and pins are private to their owner
    Given I am signed in as "ada@contoso.test" and saved the agent "Ada's analyst"
    And I pinned "Questions to Insights Assistant"
    When I sign in as "grace@contoso.test" in another browser and click "Agents" on the rail
    Then I don't see "Ada's analyst"
    And "Questions to Insights Assistant" is not pinned
    When I save an agent named "Ada's analyst"
    Then I see the toast 'Agent "Ada's analyst" saved as draft'

  Scenario: Knowledge is private to its owner
    Given I am signed in as "ada@contoso.test" and created the knowledge snippet "Goal"
    When I sign in as "grace@contoso.test" in another browser and click "Knowledge" on the rail
    Then I don't see "Goal"
```

### Feature: Org server API

E2E: none yet. API-level; covered by the backend API tests named above, not by Playwright.

```gherkin
Feature: Org server API

  Scenario: Every route refuses an unauthenticated request
    Given the app runs in org server mode
    When I call each API route without an auth session
    Then each answers HTTP 401, except the sign-in routes and the SCIM routes called with a valid token

  Scenario: Every route refuses a caller without its permission
    Given I am signed in as a user who holds only the User role
    When I call each route that needs a permission other than "use-agents"
    Then each answers HTTP 403 and changes nothing

  Scenario: A cross-site request is refused
    Given I am signed in
    When I send "POST /sessions" with the Origin "https://evil.test"
    Then it answers HTTP 403 and no session is created

  Scenario: SCIM needs its token
    When I call "GET /scim/v2/Users" without the SCIM token
    Then it answers HTTP 401

  Scenario: SCIM provisions users, groups and memberships
    When the identity provider creates the user "ada@contoso.test", the group "Analysts" and adds Ada to it through SCIM
    Then SCIM lists Ada, the group "Analysts" and Ada as its member
    When it sets Ada's "active" to false
    Then Ada's auth sessions are ended and she cannot sign in

  Scenario: A group mapping grants its role to the group's members
    Given the group "Analysts" is mapped to the Maker role
    When Ada is added to "Analysts" through SCIM
    Then "GET /me" as Ada lists the Maker role and the "create-agents" permission

  Scenario: Each private collection is isolated between two users
    Given Ada and Grace are signed in
    When Ada creates a session, a visual, an agent, a pin, a knowledge entry, a verified query, a metric and an eval run
    Then Grace can list none of them, and reading, changing or deleting any of them by id answers as not found

  Scenario: Local mode answers as the local user
    Given the app runs in local mode
    When I call "GET /me"
    Then it answers mode "local", the user "Demo User" and every permission
```

## Acceptance

- In local mode, every existing Playwright Feature passes unchanged and "Local mode has no sign-in and no Admin item" ([../app-shell/spec.md](../app-shell/spec.md)) passes.
- In org server mode, the Features "Sign in to an org server", "Permissions in the app" and "Private and shared data" pass in the Playwright `org` project, with the axe scans of the sign-in page and the Admin area clean in both themes.
- The backend API tests behind "Org server API" pass, including one isolation check per private collection (sessions, agents, knowledge, verified queries, metrics, eval runs, built-in pins) with two users.
- The server refuses to start when a route declares no permission, or when org server configuration is incomplete.

## Open questions

- Group mappings have no endpoint or screen until BA-167. Until then they are exercised only by the backend tests, which write them to the store directly.
- Restricting a datasource to some users (the Data owner role's approvals) arrives with the Requests epic; Data owner can be assigned but grants only `approve-datasource-access`, which guards nothing yet.

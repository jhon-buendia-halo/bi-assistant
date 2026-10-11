# Admin

An organisation can run the app on its own server for many people. People sign in with their company Microsoft account, share the organisation's datasources, datasets and LLM configuration, keep their own sessions, agents and knowledge private, and can do only what their roles allow. The directory of people and groups is pushed from the identity provider. Platform admins get an **Admin** area. This spec owns the two modes, sign-in, the directory, roles and permissions, their enforcement, and data ownership. The Admin area's three tabs, Overview, Users & groups (with the user detail panel) and Roles & permissions, are the screens P1–P4 of epic [BA-161](../../epics/BA-161/spec.md). Decision: ADR-0010 and ADR-0011 in [../../system/architecture.md](../../system/architecture.md).

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): local mode, org server mode, local user, owner, bootstrap admin, role, permission, group mapping, User (role), Maker, Data owner, Approver, Platform admin, user status, agent error, ownership transfer, session, agent, user agent, live (agent), draft (agent), datasource, dataset, knowledge entry, verified query, metric, eval run.

Capability-local vocabulary:
- **Sign-in page** — the only screen an unauthenticated browser sees in org server mode.
- **Auth session** — the server-side record behind a signed-in browser, referenced by a cookie. Not the same thing as a chat *session*.
- **Directory** — the users, groups and group memberships the app knows about, pushed by the identity provider through SCIM or created at first sign-in.
- **Deactivated user** — a directory user whose `active` flag is false. They cannot sign in.
- **Admin area** — the main view opened by the **Admin** rail item.
- **Needs attention** — the Overview list of three counts that each lead to an action.
- **User detail panel** — the panel that opens beside the users table when a user is selected (P3).
- **Last activity** — when a user last used the app, at day precision (R39).
- **Last sync** — the time of the most recent SCIM request from the identity provider.

## Rules

### Modes

- R1. The system SHALL run in exactly one of two modes, chosen at startup: **local mode** (the default) or **org server mode**. The mode SHALL NOT change while the server runs.
- R2. Local mode SHALL behave exactly as the app did before org server mode existed: no sign-in page, no sign-out, one implicit **local user** who holds every permission (R21), and no **Admin** rail item. The rail avatar SHALL stay the static "D" titled "Demo User" (app-shell R4). The desktop app SHALL always run in local mode.
- R3. Org server mode SHALL be turned on by server configuration naming the identity provider's issuer, client id and client secret, the server's public base URL and the SCIM token. Configuring some but not all of these SHALL be a startup error that names the missing settings; the server SHALL NOT start in local mode by accident. The bootstrap admin list (R18) is optional. The issuer SHALL name one tenant: an issuer whose tenant segment is one of Entra ID's shared endpoints (`common`, `organizations`, `consumers`, in any case) SHALL be a startup error that names `ORG_OIDC_ISSUER`.
- R4. In org server mode the public base URL SHALL be an `https://` URL, except for development and automated tests, which MAY use `http://`.

### Sign-in and sign-out

- R5. In org server mode, a browser without a valid auth session SHALL see the sign-in page and nothing else: no rail, no data, no list of sessions. The page SHALL show "Agentic Hub" and one **Sign in with Microsoft** button.
- R6. **Sign in with Microsoft** SHALL send the browser to the identity provider. After the person authenticates there, the browser SHALL come back to the app signed in, on the home view.
- R7. The sign-in round trip SHALL be protected against replay and code interception (a one-time `state`, a `nonce` and a PKCE verifier, held only for the round trip, at most 10 minutes). A round trip that fails any check, or that the identity provider reports as an error, SHALL return to the sign-in page with "Sign-in failed. Try again." and SHALL NOT create an auth session. When the issuer names a tenant id, an ID token whose tenant (`tid`) is a different one SHALL fail the same way.
- R8. A successful sign-in SHALL create an auth session and set it as an `HttpOnly`, `SameSite=Lax` cookie, `Secure` unless the public base URL is `http://`. The browser SHALL hold no identity-provider token.
- R9. An auth session SHALL end after 8 hours without a request, or 7 days after sign-in, whichever comes first. A request with an ended or unknown auth session SHALL be treated as unauthenticated (R11).
- R10. In org server mode the rail avatar SHALL show the signed-in user's initials, titled with their display name. Clicking it SHALL open a menu with their display name, their email and **Sign out**. **Sign out** SHALL end the auth session on the server, clear the cookie, end the identity-provider session, and return the browser to the sign-in page. Reloading or going back afterwards SHALL show the sign-in page.
- R11. In org server mode every API request without a valid auth session SHALL be refused with HTTP 401 and no data, except the sign-in routes and the SCIM routes (R14). The current-user route also answers 401, which is how the app learns to show the sign-in page. When the app receives a 401 while it is open (for example because the auth session expired), it SHALL show the sign-in page.

### Directory

- R12. A person who signs in and is not yet in the directory SHALL be added at that moment (**just in time**) from their sign-in claims: display name, email and user name. The user name SHALL be the identity provider's sign-in name (`preferred_username`; for Entra ID the UPN), else the subject. They start with no assigned roles, so they hold the User role only (R19).
- R13. A person who signs in and is already in the directory SHALL be matched to their directory user, first by the identity provider's subject recorded at an earlier sign-in, else by their sign-in name (`preferred_username`; for Entra ID the UPN) against the directory user name, case-insensitive. The email claim SHALL NEVER be used to match a user or to grant a role (R18), because an identity provider can send it unverified. Their display name and email SHALL be refreshed from the claims; the email is kept for display and search only. When the sign-in name matches a directory user whose recorded subject is a different one, the name now belongs to another person (for example a reassigned UPN): the sign-in SHALL fail with "Sign-in failed. Try again.", SHALL change nothing on that user, and SHALL be recorded as a refused sign-in (R36). A directory user with no recorded subject yet (provisioned through SCIM, never signed in) SHALL still be matched by sign-in name, and the subject recorded.
- R14. The identity provider SHALL be able to create, read, update and deactivate users, and create, read, update and delete groups and their memberships, through SCIM 2.0 endpoints authenticated by the SCIM bearer token. A missing or wrong token SHALL be refused with HTTP 401. SCIM requests SHALL NOT use or need an auth session.
- R15. A user provisioned through SCIM who has not signed in yet SHALL be in the directory, with no sign-in time. When they first sign in they SHALL be matched to that user, not duplicated (R13).
- R16. A deactivated user SHALL NOT be able to sign in: the round trip SHALL return to the sign-in page with "Your account is deactivated. Contact your administrator." Deactivating a user SHALL end all their auth sessions at once, so their next request is refused (R11). Deactivation SHALL keep their data and ownership. Reactivating them SHALL let them sign in again. When the identity provider creates, through SCIM, a user name that a user removed through SCIM holds, that user SHALL come back under the same id, unless both carry an external id and the two differ. Then the name belongs to a different person: SCIM SHALL create a new user, and the old one SHALL be **released** from the name: it keeps its id, data and ownership, stays deactivated and hidden from SCIM, and is never matched by that name again. The same SHALL apply to a deactivated user who has signed in. Entra ID always sends the external id (the user's object id), so a departed person's records never pass to a new hire who gets their UPN.
- R17. Groups SHALL be read-only in the app: they and their members change only through SCIM. Deleting a group SHALL remove its memberships and its group mappings.
- R18. Every user name in the bootstrap admin list (for Entra ID a UPN, which usually looks like an email) SHALL hold the Platform admin role whenever that person is signed in, without a stored assignment. The list SHALL be matched against the directory user name (R12, R13), case-insensitively, and never against the email. This role SHALL NOT be removable in the app; it goes away only when the user name leaves the list and the server restarts.

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
- R35. The Admin area SHALL show the heading "Admin" and three tabs, **Overview**, **Users & groups** and **Roles & permissions**, with Overview selected when the area opens. Each tab holds its screen (R37-R68).

### Activity

- R36. In org server mode the server SHALL record activity events for: sign-in, refused sign-in (R13), sign-out, a user's first request of each UTC day, SCIM requests (at most one event per minute), role assignments and removals, user deactivation and reactivation, group mappings added and removed, agent ownership transfers, and agent errors (R40). They feed the Overview (R41-R48), the last activity of each user (R39) and the last sync note (R54).

### Admin panel

These rules cover the three tabs of the Admin area (R35): Overview (P1, [BA-164](https://halo-powered.atlassian.net/browse/BA-164)), Users & groups (P2, [BA-165](https://halo-powered.atlassian.net/browse/BA-165)) with its user detail panel (P3, [BA-166](https://halo-powered.atlassian.net/browse/BA-166)), and Roles & permissions (P4, [BA-167](https://halo-powered.atlassian.net/browse/BA-167)). Every admin request needs **Manage users, roles and group mappings** (R34).

- R37. Each tab SHALL have its own header action, shown beside the Admin heading while that tab is selected: **Export report** on Overview, **Assign role** on Users & groups, none on Roles & permissions. The Admin area SHALL NOT show Requests, Registry, Policies or Audit log tabs, an **Add role** button or a **Sync from Entra ID** button.
- R38. A tab SHALL load its data each time it is selected. While loading it SHALL show a loading line; if loading fails it SHALL show the server's message (or "Backend unreachable") with a **Retry** button, and keep the header action.
- R39. A user's **status** SHALL be derived on every read, the first that applies:
  1. **Deactivated**: the directory user is deactivated (R16), including a user removed through SCIM.
  2. **Not signed in**: the user has never signed in.
  3. **Inactive**: their **last activity** is 90 days or more before now.
  4. **Active**: otherwise.

  A user's last activity SHALL be the time of their first request on the most recent UTC day they made one (R36), or their last sign-in when that is later or there is no such day. **Last active** SHALL show it at day precision ("Today", "Yesterday", "<n> days ago"), or "Never" for a user who has not signed in.
- R40. An **agent error** SHALL be a chat turn, in a session started from a user agent, that ended in an error instead of an answer (sessions-chat R45). A turn the user stopped, a refused request that never reached the assistant (an empty message, an unknown session) and a turn in the agent editor's preview chat SHALL NOT count. In org server mode each agent error SHALL be recorded as an activity event naming the agent, the session's owner and the error message.

### Overview (P1)

- R41. Overview SHALL show two tiles:
  - **Active users · 30 days**: the number of directory users whose last activity (R39) is within the last 30 days, whatever their status now.
  - **Agents live**: the number of user agents, of every owner, that have a Live version (agents-evals R44).
- R42. Overview SHALL show a **Needs attention** list with exactly these three rows, in this order. Each row SHALL show its text, a count badge and an action:

  | Row | Counts | Action |
  |---|---|---|
  | Agents without an active owner | User agents whose owner is deactivated or no longer in the directory. Items with no owner at all (R33) are not counted. | **Assign** (R43) |
  | Agents with errors in the last 7 days | User agents with at least one agent error (R40) in the last 7 × 24 hours. | **Inspect** (R44) |
  | Users inactive for 90+ days with Maker role | Users whose status is Inactive (R39) and who hold Maker from any source (R20). | **Clean up** (R45) |

  The badge SHALL read "<n> agent" / "<n> agents" or "<n> user" / "<n> users". A row whose count is 0 SHALL stay in the list with its action disabled.
- R43. **Assign** SHALL open the **Assign an owner** dialog. It lists every agent counted by the row, each with its former owner's name (or "unknown user" when the owner is no longer in the directory) and a ticked checkbox. The admin picks a **New owner** and clicks **Transfer**. The ticked agents SHALL then move to that user as in R64.
- R44. **Inspect** SHALL open the read-only **Agents with errors** dialog. It lists every agent counted by the row with its owner, the number of agent errors in the last 7 days, and the time and message of the latest one. The admin SHALL NOT be able to open the sessions behind them, which stay private to their owners (R29).
- R45. **Clean up** SHALL open the **Inactive makers** dialog. It lists every user counted by the row with their last active day and how they hold Maker. A direct Maker assignment is a ticked checkbox. Maker held only from a group mapping is an unticked, disabled checkbox with the reason "From group <group names>". **Remove Maker role** SHALL remove the direct Maker assignment of every ticked user (R22); the others keep Maker until they leave the group or the mapping is removed (R68). Success shows the toast "Maker role removed from <n> user(s)".
- R46. Overview SHALL show a **Weekly active users** chart with 8 bars, one for each of the last 8 weeks (Monday to Sunday, UTC), oldest first. The current week is last, partial and highlighted. Each bar is the number of distinct users with activity (R36) in that week. Under the chart a caption SHALL read "Last 8 weeks · peak <n> this week" when the current week has the highest count, "Last 8 weeks · peak <n> in the week of <Mon D>" otherwise, and "Last 8 weeks · no activity yet" when every week is 0. The same numbers SHALL be available as a table to assistive technology.
- R47. Overview SHALL show **Recent activity**: the 10 most recent of these events, newest first, each as one sentence with its relative time:

  | Event | Sentence |
  |---|---|
  | role assigned | `<admin> gave <user> the <role> role` (Data owner: `the Data owner role on <datasource>`) |
  | role removed | `<admin> removed the <role> role from <user>` |
  | group mapping added | `<admin> mapped <group> to <role>` |
  | group mapping removed | `<admin> removed the mapping of <group> to <role>` |
  | agent ownership transferred | `<admin> transferred <agent> from <former owner> to <new owner>` |
  | user deactivated / reactivated | `Entra ID deactivated <user>` / `Entra ID reactivated <user>` |

  Sign-ins, refused sign-ins, sign-outs, daily activity, SCIM requests and agent errors SHALL NOT appear. With none of these events the card SHALL read "No activity yet." Recent activity is a short feed, not an audit log.
- R48. **Export report** SHALL download a CSV file named `admin-report-<YYYY-MM-DD>.csv` (the UTC date) holding, at the moment of the export, the two tiles, the three Needs attention counts, the 8 weekly counts and the recent activity. A cell that starts with `=`, `+`, `-` or `@` SHALL be prefixed with `'`, so a spreadsheet never runs it as a formula.

### Users & groups (P2)

- R49. Users & groups SHALL show a view switch with **Users · <n>** and **Groups · <n>**, where the counts are every user and every group in the directory; Users is selected when the tab opens. Below it SHALL be a search field, in the Users view the role filter chips (R51), the table, the last sync note (R54) and the pagination (R53).
- R50. In the Users view, search SHALL match the trimmed query, case-insensitively, as a substring of the user's display name, email or the name of any group they belong to. In the Groups view it SHALL match the group's name. Search SHALL apply as the user types and go back to the first page.
- R51. The role filter chips SHALL be, in this order: **All roles** (selected when the tab opens), **Platform admins · <n>**, **Approvers · <n>**, **Data owners · <n>**, **Makers · <n>** and **Inactive 90d · <n>**. Exactly one is selected. A role chip keeps the users who hold that role from any source (R20), bootstrap admins included; **Inactive 90d** keeps the users whose status is Inactive (R39). Each count covers the whole directory, ignoring the search. Search and filter combine, and changing the filter goes back to the first page.
- R52. The users table SHALL list one row per directory user, deactivated users included, sorted by display name (case-insensitive) then email, with these columns:
  - **Name**: initials, display name and email.
  - **Roles**: one badge per role the user holds from any source, each role once (Data owner once, whatever its datasources), in the order Platform admin, Approver, Data owner, Maker; the **User** badge only when the user holds no other role.
  - **IdP groups**: the names of the groups they belong to, sorted and comma-separated, or "—".
  - **Agents owned**: the number of user agents they own.
  - **Last active** (R39) and **Status** (R39).
- R53. The table SHALL show 25 rows a page, with "<first>–<last> of <total>" and **Previous page** / **Next page** buttons, each disabled at its end. Changing the view, the search or the filter SHALL go back to the first page.
- R54. Under the table a note SHALL read "Users and groups come from Entra ID via SCIM · last sync <relative time>. Roles are assigned here or mapped from groups.", where the last sync is the time of the most recent SCIM request (R36). Before any SCIM request it SHALL read "· not synced yet" in place of "· last sync <relative time>".
- R55. The Groups view SHALL list one row per group, sorted by name, with **Name**, **Members** (the number of members) and **Mapped roles** (a badge per group mapping, R66). Groups are read-only (R17): their rows have no action.
- R56. **Assign role** SHALL open the **Assign role** dialog with a **User** picker (search by name or email over users who are not deactivated), a **Role** select (Maker, Data owner, Approver, Platform admin; User is implicit and not offered) and a **Datasource** select, which is enabled only for Data owner and required then. **Assign** SHALL create the direct assignment (R22) and refresh the table. A role the user already holds directly SHALL change nothing and show the toast "Role already assigned".
- R57. When nothing matches the search or filter, the table SHALL read "No users match your search." when there is a search, else "No users match this filter.". The Groups view reads "No groups match your search." when there is a search, else "No groups yet. Groups arrive from Entra ID through SCIM."

### Edit a user (P3)

- R58. Selecting a user's name in the users table SHALL open the **user detail panel** beside the table and mark the row selected. While the panel is open the table SHALL show only **Name**, **Roles** and **Last active**; the search, the chips and the pagination stay. Selecting another user SHALL show that user instead, discarding changes not yet saved. **Close user details** or Escape SHALL close the panel and return focus to the user's name in the table.
- R59. The panel SHALL show, top to bottom:
  - the user's initials, display name, email and status badge (R39);
  - **Roles**: a checkbox for **Platform admin**, **Approver** and **Maker**, each with its description; one ticked checkbox **Data owner · <datasource name>** per datasource the user is Data owner of; and an unticked **Data owner** checkbox with a **Datasource** select that is enabled only while that box is ticked and offers the datasources the user is not yet Data owner of. With no datasource left to offer, that **Data owner** checkbox is disabled with the reason "No other datasource to own.". The User role has no checkbox: everyone holds it (R19).
  - **Groups (from Entra ID, read-only)**: the user's groups as badges, or "No groups.";
  - **Agents owned**: each user agent the user owns with its status badge, **Live** when it has a Live version, else **Draft**, or "No agents owned.";
  - **Transfer ownership** and **Save changes**.
- R60. A role the user holds from a group mapping or as a bootstrap admin SHALL show ticked and disabled, with the reason "From group <group names>" or "Bootstrap admin, set in the server configuration.". A direct assignment of the same role stays stored and is not changed.
- R61. An admin SHALL NOT be able to remove their own direct Platform admin role. In their own panel the **Platform admin** checkbox SHALL be disabled with the reason "You can't remove your own Platform admin role.", and the server SHALL refuse such a removal, so an org server never loses its last admin by accident.
- R62. **Save changes** SHALL be disabled until the ticks differ from what is stored, and while **Data owner** is ticked without a datasource. It SHALL replace the user's direct assignments with the ticked roles all at once: every change is applied, or none is. It SHALL record one activity event per role added or removed, show the toast "Roles saved for <name>", and refresh the panel and the table. The user's permissions SHALL change on their next request (R20).
- R63. **Transfer ownership** SHALL be disabled when the user owns no agent. It SHALL open the **Transfer ownership** dialog, listing the user's agents as ticked checkboxes, with a **New owner** picker (search by name or email over users who are not deactivated, the current owner left out) and **Transfer**, enabled once a new owner is chosen and at least one agent is ticked.
- R64. Transferring agents (here or through **Assign**, R43) SHALL move each ticked agent, with its draft, Live version and publish time, to the new owner, all at once: every agent moves, or none does. The agent SHALL then appear in the new owner's Agent Hub under Mine, unpinned, and leave the former owner's. Sessions started from it stay with their owner (R29); for a former owner's sessions the agent counts as deleted (sessions-chat R59). The new owner needs Maker to edit or publish it (agents-evals R62). The transfer SHALL be refused, moving nothing, when the new owner already has a user agent with the same name (R31), with the message `<new owner> already has an agent named "<agent name>"`. Success shows the toast "Transferred <n> agent(s) to <new owner>" and records one activity event per agent.

### Roles & permissions (P4)

- R65. Roles & permissions SHALL show the permission matrix (R21) as a read-only table: one row per permission, in R21's order and with R21's names, and one column per role (**User**, **Maker**, **Data owner**, **Approver**, **Platform admin**), each cell showing whether the role grants the permission. Nothing in it can be changed.
- R66. Beside the matrix, **Role ← Entra ID group mappings** SHALL list every group mapping, sorted by group name then role, each with the group's name, the role's badge (for Data owner, `Data owner · <datasource name>`) and a remove button. With none it SHALL read "No group mappings yet."
- R67. **Add mapping** SHALL open the **Add mapping** dialog with an **Entra ID group** picker (search over group names), a **Role** select (Maker, Data owner, Approver, Platform admin) and a **Datasource** select, enabled only for Data owner and required then. **Add** SHALL create the mapping, record an activity event and show the toast "Mapping added". The group's members SHALL hold the role from their next request (R20). A mapping that already exists SHALL change nothing and show the toast "Mapping already exists". With no groups in the directory, **Add mapping** SHALL be disabled with the reason "No groups yet. Groups arrive from Entra ID through SCIM."
- R68. Removing a mapping SHALL ask for confirmation, then delete it, record an activity event and show the toast "Mapping removed". The group's members SHALL lose the role from their next request, unless they hold it another way (R20).

## Edge cases and errors

- Org server configuration with an issuer but no SCIM token: the server exits at startup with an error naming `ORG_SCIM_TOKEN`.
- An issuer for a shared Entra ID endpoint, such as `https://login.microsoftonline.com/common/v2.0`: the server exits at startup with an error naming `ORG_OIDC_ISSUER` (R3).
- An ID token from another tenant than the issuer's: "Sign-in failed. Try again.", no auth session (R7).
- A person whose email claim equals another user's email, or a bootstrap admin's, but whose sign-in name differs: they are matched or added by their own sign-in name only. They never land on the other user's account and don't get Platform admin (R13, R18).
- A token without `preferred_username`: the person is matched by subject only, and a just-in-time user takes the subject as user name (R12).
- A person signs in with a sign-in name that a directory user who signed in before holds under another subject (a reassigned UPN): "Sign-in failed. Try again.", no auth session, that user unchanged, a refused sign-in recorded (R13). The new person can sign in once the identity provider has removed the departed user through SCIM and provisioned them (R16); signing in before being provisioned stays refused.
- The identity provider is unreachable when **Sign in with Microsoft** is clicked: the sign-in page shows "Sign-in failed. Try again."
- A sign-in that returns after more than 10 minutes, or with a `state` that doesn't match: "Sign-in failed. Try again.", no auth session.
- A return address that points outside the app after sign-in is ignored; the browser lands on the home view.
- Two browsers signed in as the same user each have their own auth session. Signing out in one leaves the other signed in.
- A user removed from a mapped group loses the mapped role on their next request; a role they also hold directly stays.
- A Maker whose Maker role is removed while the agent editor is open: **Save** is refused with HTTP 403 and the toast "You don't have permission to do this."; the form keeps its content. The **New agent** button is gone after the next reload of the permissions (the next page load).
- A SCIM request to create a user whose user name an active user holds, or a deactivated one that R16 doesn't release: HTTP 409 in SCIM error format, nothing changed.
- A SCIM request for an unknown user or group id: HTTP 404 in SCIM error format.
- Deleting a user through SCIM deactivates them (R16) and hides them from later SCIM reads; their data and ownership stay. Creating their user name again brings the same user back when the external ids match or either is missing, and creates a new user when both are present and differ (R16).
- A bootstrap admin who is deactivated cannot sign in; the bootstrap list does not override deactivation.
- A request from a page served by another origin (a cross-site form post): HTTP 403, nothing changed (R27).
- Pointing an org server at a data directory that a local-mode app used: the old items have no owner and nobody sees them (R33). Moving local data into an org server is out of scope.
- Two admins edit the same user's roles at once: each **Save changes** replaces the direct assignments with what that admin ticked, so the later save wins. The panel shows the stored roles again after each save (R62).
- **Save changes** with a datasource that was deleted meanwhile: HTTP 404 `Datasource <id> not found`, nothing changed, the error toast shows the message.
- A user removed from the directory by SCIM while their panel is open: **Save changes** still works on their direct assignments; they stay listed as Deactivated (R39, R52).
- Transferring an agent that its owner deleted meanwhile: HTTP 404 `Agent <id> not found`, no agent moves (R64).
- Transferring to a user who is deactivated meanwhile: HTTP 400 `<name> is deactivated`, no agent moves.
- A Platform admin whose role comes only from a group mapping opens their own panel: the checkbox is disabled with "From group <names>" (R60); removing the mapping on Roles & permissions takes the Admin area away from them at their next request.
- The last direct Platform admin can't remove their own role (R61); another Platform admin, or a bootstrap admin, can.
- Assign role or Add mapping for Data owner with no datasource configured: the **Datasource** select reads "No datasources" and **Assign** / **Add** stays disabled.
- A group deleted through SCIM: its mappings go (R17) and disappear from Roles & permissions at the next load; its members lose the mapped roles at their next request.
- A user who signed in once 100 days ago and never came back: status Inactive, Last active "100 days ago" (R39).
- An agent with errors whose owner is also deactivated is counted in both attention rows (R42).
- An agent stored before org server mode (no owner, R33) is counted in none of the Overview figures and can't be transferred.
- A search with only spaces: the same as no search (R50).

## Contracts

- Mode configuration, the auth routes (`GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`), `GET /me`, the SCIM routes, the admin routes (role assignments, overview and CSV export, users, user roles, agent transfer, groups, group mappings), the 401/403 bodies, the Origin check and the permission each route needs: [../../system/api.md](../../system/api.md) sections 1.9, 2.13-2.15 and 6.
- The `users`, `groups`, `group_members`, `role_assignments`, `group_role_mappings`, `auth_sessions` and `activity_events` collections, the activity event types, how the admin figures (status, last activity, agents live, agent errors, last sync) are derived, agent ownership transfer, and `ownerId` on private collections: [../../system/data-model.md](../../system/data-model.md) sections 3.10, 3.14 and 3.15.
- Agent memory and workspaces reached only through an owner-scoped session; the org-wide LLM configuration: [../../system/agents.md](../../system/agents.md) sections 1.3 and 7.1.
- How to run an org server and register it with Entra ID: [../../system/delivery.md](../../system/delivery.md) section 4.1.
- Security requirements (binding, cookies, CSRF, SCIM token, isolation): [../../product/non-functional.md](../../product/non-functional.md) section 3.

## UI

The sign-in page, the signed-in avatar and its menu, the **Admin** rail item, the Admin area with its three tabs, the user detail panel and the admin dialogs, and the controls hidden by permission: [../../system/ui.md](../../system/ui.md) sections 1.3, 1.6, 4.17 and 4.18. Shell rules: [../app-shell/spec.md](../app-shell/spec.md) R4 and R50. States:
- Sign-in page: idle, signing in (button reads "Signing in…"), failed ("Sign-in failed. Try again."), deactivated ("Your account is deactivated. Contact your administrator.").
- Avatar menu: closed, open.
- Admin area: Overview, Users & groups or Roles & permissions selected; each tab loading, failed (with **Retry**) or loaded (R38).
- Overview: Needs attention rows with a count or with 0 (action disabled); Recent activity empty or populated; dialogs Assign an owner, Agents with errors and Inactive makers closed or open.
- Users & groups: Users or Groups view; a filter chip selected; empty search or filter result; user detail panel closed or open, unchanged or with unsaved changes, saving.
- Roles & permissions: mappings empty or listed; Add mapping dialog closed or open; removal confirmation.

## Flows

The three Features below run in the Playwright `org` project, against the app started in org server mode with a local OpenID Connect stub and a SCIM test client (see [../../system/tech-stack.md](../../system/tech-stack.md)). Behaviour with no screen (the SCIM protocol, the Origin check, the 401 and 403 answers of every route, and owner isolation for every private collection) is covered by the backend API tests `backend/test/org-auth.e2e-spec.ts`, `backend/test/scim.e2e-spec.ts` and `backend/test/owner-isolation.e2e-spec.ts` (Feature "Org server API" below); its scenario "Local mode answers as the local user" is `backend/test/local-auth.e2e-spec.ts`, which also checks that the existing routes answer as before in local mode. Local mode is covered by the existing Features, which run unchanged, and by "Local mode has no sign-in and no Admin item" in [../app-shell/spec.md](../app-shell/spec.md).

### Feature: Sign in to an org server

E2E: `frontend/e2e/org-sign-in.spec.ts` (Playwright `org` project).

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

E2E: `frontend/e2e/org-permissions.spec.ts` (Playwright `org` project). In "A bootstrap admin sees the Admin area", the steps `I see "Needs attention"` and `I see the "Search users" field` check the tabs' content, which arrives with BA-164 and BA-165; until then the spec checks the frame (heading, tabs, selection) and marks those steps `TODO(BA-164)` / `TODO(BA-165)`.

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
    And I see "Needs attention"
    When I click "Users & groups"
    Then I see the "Search users" field
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

E2E: `frontend/e2e/org-isolation.spec.ts` (Playwright `org` project).

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

E2E: API-level, not Playwright: `backend/test/org-auth.e2e-spec.ts` (the 401, 403, cross-site and sign-in scenarios, and the role assignment routes), `backend/test/scim.e2e-spec.ts` (the four SCIM scenarios), `backend/test/owner-isolation.e2e-spec.ts` (private collections) and `backend/test/local-auth.e2e-spec.ts` (local mode).

```gherkin
Feature: Org server API

  Scenario: An email claim never matches a user or grants a role
    Given the app runs in org server mode with "admin@contoso.test" as a bootstrap admin
    And "admin@contoso.test" (Avery Admin) has signed in
    When I sign in as "mallory@contoso.test" with the email claim "admin@contoso.test"
    Then "GET /me" answers a user other than Avery Admin, with the User role only
    And "GET /me" as Avery Admin still answers "Avery Admin" with Platform admin

  Scenario: A sign-in name now held by a different person is refused
    Given "ada@contoso.test" (Ada Lovelace) has signed in
    When a different person, with another subject, signs in as "ada@contoso.test"
    Then the sign-in returns with "signInError=failed" and no auth session
    And "GET /me" as Ada still answers "Ada Lovelace"
    And a "sign-in.refused" activity event with the reason "subject-mismatch" names Ada's account

  Scenario: Bootstrap admins are matched by sign-in name
    Given the app runs in org server mode with "root@contoso.test" as a bootstrap admin
    When I sign in as "root@contoso.test" with the email claim "root.mail@elsewhere.test"
    Then "GET /me" lists the Platform admin role from the bootstrap list

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

  Scenario: SCIM gives a departed user's name to a new person
    Given "leaver@contoso.test" with the external id "oid-old" was provisioned through SCIM, signed in and created a session
    And the identity provider removed "leaver@contoso.test" through SCIM
    When the identity provider creates "leaver@contoso.test" with the external id "oid-new" through SCIM
    Then it answers HTTP 201 with a new user id
    And the new person signs in as "leaver@contoso.test" to that new user and lists no sessions
    And the departed person's sign-in answers "signInError=deactivated"

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

The four Features below run in the Playwright `org` project like the three above. Their Backgrounds seed the directory through the SCIM test client, sign people in through the OpenID Connect stub, and set past activity (for example "last active 95 days ago") by writing the user's activity to the store before the app starts, through the org harness. "Avery Admin" (`admin@contoso.test`) is a bootstrap admin in every Feature. The API-level parts (every admin route's 403 for a non-admin, transfer conflicts, the CSV content, save atomicity) are also covered by `backend/test/org-admin.e2e-spec.ts`.

### Feature: Admin overview

E2E: none yet. Its spec, `frontend/e2e/org-admin-overview.spec.ts`, is written in step 7 of BA-164.

```gherkin
Feature: Admin overview

  Background:
    Given the app runs in org server mode with "admin@contoso.test" (Avery Admin) as a bootstrap admin
    And "ada@contoso.test" (Ada Lovelace), "grace@contoso.test" (Grace Hopper) and "alan@contoso.test" (Alan Turing) are provisioned through SCIM

  Scenario: The overview shows the tiles, the chart and what needs attention
    Given Ada and Grace were active today and Alan was last active 40 days ago
    And Ada owns the Live agent "Goal analyst" and the draft agent "Card counter"
    When I sign in as "admin@contoso.test" and click "Admin" on the rail
    Then the "Overview" tab is selected
    And the tile "Active users · 30 days" shows "3"
    And the tile "Agents live" shows "1"
    And the "Needs attention" list shows "Agents without an active owner", "Agents with errors in the last 7 days" and "Users inactive for 90+ days with Maker role"
    And the "Weekly active users" chart shows 8 weeks, with 3 users this week
    And I see "Last 8 weeks · peak 3 this week"
    And the axe scan reports no violations in the Light theme
    And the axe scan reports no violations in the Dark theme

  Scenario: A new org server shows empty states
    Given no one but me has signed in
    When I sign in as "admin@contoso.test" and click "Admin" on the rail
    Then the tile "Agents live" shows "0"
    And each "Needs attention" row shows a count of 0 and its action is disabled
    And "Recent activity" shows "No activity yet."

  Scenario: Agents whose owner is deactivated get a new owner
    Given Ada owns the Live agent "Goal analyst"
    And the identity provider deactivates "ada@contoso.test" through SCIM
    When I sign in as "admin@contoso.test" and click "Admin" on the rail
    Then the row "Agents without an active owner" shows "1 agent"
    When I click "Assign"
    Then the "Assign an owner" dialog lists "Goal analyst" with the former owner "Ada Lovelace"
    When I choose "Grace Hopper" as the new owner and click "Transfer"
    Then I see the toast "Transferred 1 agent to Grace Hopper"
    And the row "Agents without an active owner" shows "0 agents" and "Assign" is disabled
    And "Recent activity" shows "Avery Admin transferred Goal analyst from Ada Lovelace to Grace Hopper"

  Scenario: Agents with errors can be inspected
    Given Ada owns the Live agent "Goal analyst"
    And a turn in Ada's session started from "Goal analyst" failed today with "Model unavailable"
    When I sign in as "admin@contoso.test" and click "Admin" on the rail
    Then the row "Agents with errors in the last 7 days" shows "1 agent"
    When I click "Inspect"
    Then the "Agents with errors" dialog lists "Goal analyst" owned by "Ada Lovelace" with 1 error and the message "Model unavailable"

  Scenario: Inactive makers are cleaned up
    Given "alan@contoso.test" holds the Maker role and was last active 95 days ago
    When I sign in as "admin@contoso.test" and click "Admin" on the rail
    Then the row "Users inactive for 90+ days with Maker role" shows "1 user"
    When I click "Clean up"
    Then the "Inactive makers" dialog lists "Alan Turing", ticked
    When I click "Remove Maker role"
    Then I see the toast "Maker role removed from 1 user"
    And the row "Users inactive for 90+ days with Maker role" shows "0 users"
    And "Recent activity" shows "Avery Admin removed the Maker role from Alan Turing"

  Scenario: Export report downloads the overview as CSV
    Given Ada and Grace were active today
    When I sign in as "admin@contoso.test", click "Admin" on the rail and click "Export report"
    Then a file named "admin-report-<today>.csv" downloads
    And it holds the row "summary,Active users · 30 days,3" and 8 "weekly-active-users" rows

  Scenario: A user without the admin permission can't reach the overview
    Given I am signed in as "ada@contoso.test", who holds only the User role
    Then I don't see "Admin" on the rail
    When I request the admin overview from the API
    Then it answers HTTP 403
```

### Feature: Users and groups

E2E: none yet. Its spec, `frontend/e2e/org-admin-users.spec.ts`, is written in step 7 of BA-165.

```gherkin
Feature: Users and groups

  Background:
    Given the app runs in org server mode with "admin@contoso.test" (Avery Admin) as a bootstrap admin
    And the groups "Analysts" and "Engineers" are provisioned through SCIM
    And "ada@contoso.test" (Ada Lovelace) is in "Analysts", holds the Maker role and was active today
    And "alan@contoso.test" (Alan Turing) is in "Engineers" and was last active 95 days ago
    And "grace@contoso.test" (Grace Hopper) is provisioned and has never signed in

  Scenario: The users table shows each person's roles, groups and status
    When I sign in as "admin@contoso.test", click "Admin" on the rail and click "Users & groups"
    Then I see "Users · 4" and "Groups · 2"
    And the row "Ada Lovelace" shows "ada@contoso.test", the role "Maker", the group "Analysts", "0" agents owned, "Today" and "Active"
    And the row "Alan Turing" shows the role "User", "95 days ago" and "Inactive"
    And the row "Grace Hopper" shows "Never" and "Not signed in"
    And the row "Avery Admin" shows the role "Platform admin"
    And I see "Users and groups come from Entra ID via SCIM · last sync"
    And the axe scan reports no violations in the Light theme
    And the axe scan reports no violations in the Dark theme

  Scenario: Search finds users by name, email or group
    Given I am on the "Users & groups" tab as "admin@contoso.test"
    When I type "analysts" in "Search users"
    Then the table lists only "Ada Lovelace"
    When I type "turing" in "Search users"
    Then the table lists only "Alan Turing"
    When I type "nobody" in "Search users"
    Then I see "No users match your search."

  Scenario: Role filter chips narrow the list
    Given I am on the "Users & groups" tab as "admin@contoso.test"
    Then I see the chips "All roles", "Platform admins · 1", "Approvers · 0", "Data owners · 0", "Makers · 1" and "Inactive 90d · 1"
    When I click "Makers · 1"
    Then the table lists only "Ada Lovelace"
    When I click "Inactive 90d · 1"
    Then the table lists only "Alan Turing"
    When I click "Approvers · 0"
    Then I see "No users match this filter."

  Scenario: A deactivated user is shown as deactivated
    Given the identity provider deactivates "alan@contoso.test" through SCIM
    When I open the "Users & groups" tab as "admin@contoso.test"
    Then the row "Alan Turing" shows "Deactivated"

  Scenario: The users table is paged
    Given 30 more users are provisioned through SCIM
    When I open the "Users & groups" tab as "admin@contoso.test"
    Then I see "1–25 of 34"
    When I click "Next page"
    Then I see "26–34 of 34"
    And "Next page" is disabled

  Scenario: The Groups view lists groups, members and mapped roles
    Given the group "Analysts" is mapped to the Maker role
    When I open the "Users & groups" tab as "admin@contoso.test" and click "Groups · 2"
    Then the row "Analysts" shows "1" member and the role "Maker"
    And the row "Engineers" shows "1" member and no role

  Scenario: Assign role gives a user a role
    Given I am on the "Users & groups" tab as "admin@contoso.test"
    When I click "Assign role"
    And I choose the user "Grace Hopper" and the role "Approver" and click "Assign"
    Then I see the toast "Role assigned"
    And the row "Grace Hopper" shows the role "Approver"

  Scenario: A user without the admin permission can't list users
    Given I am signed in as "ada@contoso.test", who holds the Maker role
    When I request the admin users list from the API
    Then it answers HTTP 403
```

### Feature: Edit a user

E2E: none yet. Its spec, `frontend/e2e/org-admin-edit-user.spec.ts`, is written in step 7 of BA-166.

```gherkin
Feature: Edit a user

  Background:
    Given the app runs in org server mode with "admin@contoso.test" (Avery Admin) as a bootstrap admin
    And the World Cup datasource exists
    And "ada@contoso.test" (Ada Lovelace) is in the group "Analysts", holds the Maker role and was active today
    And "grace@contoso.test" (Grace Hopper) holds the Maker role

  Scenario: Selecting a user opens their details
    When I open the "Users & groups" tab as "admin@contoso.test" and click "Ada Lovelace"
    Then the "User details" panel shows "Ada Lovelace", "ada@contoso.test" and "Active"
    And "Maker" is ticked and "Platform admin" and "Approver" are not
    And the groups show "Analysts"
    And the table shows only the columns "Name", "Roles" and "Last active"
    And the axe scan reports no violations in the Light theme
    And the axe scan reports no violations in the Dark theme
    When I click "Close user details"
    Then I don't see the "User details" panel
    And the table shows the column "Status"

  Scenario: Changing roles changes what the user can do
    Given "ada@contoso.test" is signed in in another browser
    When I open the "Users & groups" tab as "admin@contoso.test" and click "Ada Lovelace"
    And I tick "Approver", untick "Maker" and click "Save changes"
    Then I see the toast "Roles saved for Ada Lovelace"
    And the row "Ada Lovelace" shows the role "Approver" and not "Maker"
    When Ada clicks "Agents" on the rail
    Then Ada doesn't see the "New agent" button

  Scenario: Data owner names its datasource
    When I open the "Users & groups" tab as "admin@contoso.test" and click "Ada Lovelace"
    And I tick "Data owner"
    Then "Save changes" is disabled
    When I choose "World Cup" in "Datasource" and click "Save changes"
    Then I see the toast "Roles saved for Ada Lovelace"
    And "Data owner · World Cup" is ticked

  Scenario: A role from a group mapping can't be unticked
    Given the group "Analysts" is mapped to the Approver role
    When I open the "Users & groups" tab as "admin@contoso.test" and click "Ada Lovelace"
    Then "Approver" is ticked and disabled, with "From group Analysts"

  Scenario: An admin can't remove their own Platform admin role
    Given "grace@contoso.test" holds the Platform admin role
    When I open the "Users & groups" tab as "grace@contoso.test" and click "Grace Hopper"
    Then "Platform admin" is ticked and disabled, with "You can't remove your own Platform admin role."

  Scenario: Transferring agents hands them to another user
    Given Ada owns the Live agent "Goal analyst" and the draft agent "Card counter"
    When I open the "Users & groups" tab as "admin@contoso.test" and click "Ada Lovelace"
    Then "Agents owned" lists "Goal analyst" with "Live" and "Card counter" with "Draft"
    When I click "Transfer ownership"
    And I untick "Card counter", choose "Grace Hopper" as the new owner and click "Transfer"
    Then I see the toast "Transferred 1 agent to Grace Hopper"
    And "Agents owned" lists only "Card counter"
    When Grace signs in in another browser and clicks "Agents" on the rail
    Then Grace sees "Goal analyst" in the "Mine" section

  Scenario: A transfer that would duplicate a name is refused
    Given Ada owns the Live agent "Goal analyst"
    And Grace owns an agent named "Goal analyst"
    When I open the "Users & groups" tab as "admin@contoso.test" and click "Ada Lovelace"
    And I click "Transfer ownership", choose "Grace Hopper" as the new owner and click "Transfer"
    Then I see the error toast 'Grace Hopper already has an agent named "Goal analyst"'
    And "Agents owned" still lists "Goal analyst"

  Scenario: A user with no groups and no agents
    Given "alan@contoso.test" (Alan Turing) is provisioned and in no group
    When I open the "Users & groups" tab as "admin@contoso.test" and click "Alan Turing"
    Then I see "No groups." and "No agents owned."
    And "Transfer ownership" is disabled

  Scenario: A user without the admin permission can't change roles
    Given I am signed in as "ada@contoso.test", who holds the Maker role
    When I try to save roles for "grace@contoso.test" through the API
    Then it answers HTTP 403 and Grace's roles are unchanged
```

### Feature: Roles and permissions

E2E: none yet. Its spec, `frontend/e2e/org-admin-roles.spec.ts`, is written in step 7 of BA-167.

```gherkin
Feature: Roles and permissions

  Background:
    Given the app runs in org server mode with "admin@contoso.test" (Avery Admin) as a bootstrap admin
    And the World Cup datasource exists
    And the group "Analysts" is provisioned through SCIM with "ada@contoso.test" (Ada Lovelace) as its member

  Scenario: The matrix shows what each role can do
    When I sign in as "admin@contoso.test", click "Admin" on the rail and click "Roles & permissions"
    Then the permission matrix has the columns "User", "Maker", "Data owner", "Approver" and "Platform admin"
    And it has 11 permission rows
    And "Use agents in the gallery and chat" is granted to every role
    And "Manage users, roles and group mappings" is granted only to "Platform admin"
    And "View audit log" is granted to "Approver" and "Platform admin"
    And I see "No group mappings yet."
    And the axe scan reports no violations in the Light theme
    And the axe scan reports no violations in the Dark theme

  Scenario: A group mapping gives the group's members the role
    Given "ada@contoso.test" is signed in in another browser and doesn't see the "New agent" button
    When I open the "Roles & permissions" tab as "admin@contoso.test"
    And I click "Add mapping", choose the group "Analysts" and the role "Maker" and click "Add"
    Then I see the toast "Mapping added"
    And the mappings list shows "Analysts" with "Maker"
    When Ada reloads the Agents screen
    Then Ada sees the "New agent" button

  Scenario: Removing a mapping takes the role away
    Given the group "Analysts" is mapped to the Maker role
    When I open the "Roles & permissions" tab as "admin@contoso.test"
    And I click "Remove mapping Analysts → Maker" and confirm
    Then I see the toast "Mapping removed"
    And I see "No group mappings yet."
    When Ada signs in and clicks "Agents" on the rail
    Then Ada doesn't see the "New agent" button

  Scenario: A Data owner mapping names its datasource
    When I open the "Roles & permissions" tab as "admin@contoso.test"
    And I click "Add mapping", choose the group "Analysts" and the role "Data owner"
    Then "Add" is disabled
    When I choose "World Cup" in "Datasource" and click "Add"
    Then the mappings list shows "Analysts" with "Data owner · World Cup"

  Scenario: Add mapping needs a group
    Given the group "Analysts" is deleted through SCIM
    When I open the "Roles & permissions" tab as "admin@contoso.test"
    Then "Add mapping" is disabled

  Scenario: A user without the admin permission can't add a mapping
    Given I am signed in as "ada@contoso.test", who holds only the User role
    When I try to add a group mapping through the API
    Then it answers HTTP 403 and no mapping is created
```

## Acceptance

- In local mode, every existing Playwright Feature passes unchanged and "Local mode has no sign-in and no Admin item" ([../app-shell/spec.md](../app-shell/spec.md)) passes.
- In org server mode, the Features "Sign in to an org server", "Permissions in the app", "Private and shared data", "Admin overview", "Users and groups", "Edit a user" and "Roles and permissions" pass in the Playwright `org` project, with the axe scans of the sign-in page and of each admin tab, the user detail panel included, clean in both themes.
- The backend API tests behind "Org server API" and `backend/test/org-admin.e2e-spec.ts` pass, including one isolation check per private collection (sessions, agents, knowledge, verified queries, metrics, eval runs, built-in pins) with two users.
- The server refuses to start when a route declares no permission, or when org server configuration is incomplete.

## Open questions

- Restricting a datasource to some users (the Data owner role's approvals) arrives with the Requests epic; Data owner can be assigned but grants only `approve-datasource-access`, which guards nothing yet.

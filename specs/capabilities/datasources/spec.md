# Datasources

A datasource is a saved connection to a place the user's data lives. The user adds a PostgreSQL database, a Databricks SQL warehouse (Unity Catalog) or a REST API, proves the connection works, and from then on the app can browse what the credentials can see, sample rows and run read-only SQL against it. Datasources are the root of everything the assistant knows: datasets select entities from a datasource, and sessions query through those datasets.

## Concepts

Terms are defined once in [the glossary](../../product/glossary.md); this capability uses them as follows.

- **Datasource** — a named, saved connection of one **kind**. The kind is fixed at creation.
- **Kind** — `databricks`, `postgres` or `rest`. UI labels: "Databricks", "PostgreSQL", "REST API".
- **Entity** — a queryable object addressed by the three-part key `catalog.schema.table`. Every kind is normalised to this shape (see Rule R30).
- **Inventory** — the catalog → schema → table → column tree a datasource exposes, plus a stored snapshot of it.
- **Masked secret** — the fixed placeholder `••••••••` (eight bullets) shown and returned in place of a stored secret.
- **Read-only SQL** — a single `SELECT`/`WITH` statement that passed the read-only guard.
- **Connector** — the per-kind component that implements test, inventory, sampling, read-only SQL, foreign keys, summary and masking. Connectors are stateless: every call receives the saved configuration.
- **Dataset** — a named selection of entities from one datasource; owned by [datasets](../datasets/spec.md).

## Rules

### Kinds and configuration

- R1. The system SHALL support exactly three datasource kinds: Databricks SQL warehouse, PostgreSQL and REST API. A request naming any other kind SHALL be rejected with `kind must be one of: databricks, postgres, rest`.
- R2. A datasource SHALL have a name, a kind, a kind-specific configuration, an id assigned on first save, and created/updated timestamps. Names are trimmed, required (`name is required`) and truncated to 64 characters. Names are not required to be unique.
- R3. The kind of a saved datasource SHALL NOT be changeable; the Kind control is disabled while editing.
- R4. A Databricks configuration SHALL consist of: server hostname, personal access token, SQL warehouse ID. All three are required. The hostname is normalised by removing a leading `http://`/`https://` and trailing slashes, and SHALL match `[A-Za-z0-9._-]+`; the warehouse ID SHALL match the same pattern. Violations are rejected with `host, token and warehouseId are required`, `Invalid Databricks hostname: <host>` or `Invalid Databricks warehouse id: <id>`.
- R5. A PostgreSQL configuration SHALL consist of: host, port (default 5432), database, user, password, and a "Use SSL" flag (default off). Host, database and user are required by the form; the password may be empty. The database name becomes the catalog segment of every entity key (R30).
- R6. When "Use SSL" is on, the PostgreSQL connection SHALL use TLS **without verifying the server certificate**. There is no field for a CA or client certificate.
- R7. A REST API configuration SHALL consist of: base URL, an authentication block, optional extra request headers, and a list of endpoint definitions.
- R8. REST authentication SHALL be one of: **No auth**; **Bearer token** (sends `Authorization: Bearer <token>`); **API key header** (sends the key in a header whose name defaults to `X-API-Key`); **Basic** (username and password, sent as `Authorization: Basic <base64>`). Every request also sends `Accept: application/json` plus any configured extra headers.
- R9. A REST endpoint definition SHALL have: a name, a path (relative to the base URL, or an absolute `http(s)` URL), an optional group, an optional rows pointer (JSON Pointer to the array of rows; empty means the response body is the array), an optional maximum row count, and a pagination style of **None**, **Page**, **Offset** or **Cursor** with the parameter names that style needs and an optional page size. Only `GET` is ever issued.
- R10. Each REST endpoint SHALL be exposed as one table. Its key is `api.<schema>.<table>` where `<table>` is the endpoint name and `<schema>` is the group (default `default`), each lower-cased with every character outside `[a-z0-9_]` replaced by `_`. Endpoints whose sanitised name is empty or whose key duplicates an earlier one SHALL be ignored.

### Test, save, edit, delete

- R11. The user SHALL be able to test a configuration before saving it. "Test connection" is enabled only when the kind's minimum fields are filled (Databricks: hostname, token, warehouse ID; PostgreSQL: host, database, user; REST: base URL and at least one endpoint with both a name and a path) and no test is running.
- R12. A test SHALL perform the cheapest real round trip for the kind: Databricks and PostgreSQL run `SELECT 1`; REST fetches one row (page size 1) from the first endpoint. REST additionally rejects an empty base URL (`baseUrl is required`) and an empty endpoint list (`At least one endpoint is required`).
- R13. Saving SHALL be possible only after a successful test of the exact values in the form: any field edit, kind change, endpoint add/remove or opening a datasource for editing resets the "tested" state, and "Save datasource" / "Save changes" is disabled until the next successful test. Save is also disabled while the Name is empty. The backend itself does not require a prior test.
- R14. Saving an existing datasource (edit) SHALL update it in place under the same id; saving without an id SHALL create one. The list is ordered by most recently updated first.
- R15. Deleting a datasource SHALL ask for confirmation and, once confirmed, remove the datasource and its stored inventory snapshot. Datasets bound to it SHALL NOT be deleted or modified.
- R16. Test, save, delete and REST discovery SHALL report outcome as `{ ok, message }`; a failed operation is not an HTTP error. The UI shows `message` as a success or error toast.

### Credentials

- R17. The system SHALL NOT return a stored secret in any response. Secrets are the Databricks token, the PostgreSQL password, and the REST `auth.token` and `auth.password`. Wherever a secret is set, listing a datasource returns the masked secret `••••••••`; where it is unset it returns an empty string.
- R18. The edit form SHALL show masked secrets as they came back. When test, save or REST discovery receives a secret that is empty or equals the masked secret together with the id of a saved datasource of the **same kind**, the system SHALL substitute the stored secret. Consequently a secret cannot be cleared by emptying the field, and typing a new value replaces it.
- R19. The system SHALL NOT include a password or token in error messages or logs it produces (error text is built from named fields, never from the connection object).
- R20. Open question: datasource secrets are currently stored in the application database **in plaintext**; only LLM provider keys are encrypted at rest (see [llm-settings](../llm-settings/spec.md)). Decide whether datasource secrets must be encrypted too and update this rule accordingly.
- R21. Extra REST headers are not masked and the form has no field for them (they are preserved if present in a saved configuration). Open question: headers can carry secrets; decide whether they need masking.

### Inventory (discovery)

- R22. The system SHALL be able to discover everything a datasource's credentials can see and return it as catalogs → schemas → tables → columns, where each column has a name, a type string and a nullable flag.
- R23. For PostgreSQL the inventory SHALL contain exactly one catalog, named after the database, whose schemas are every schema except `pg_catalog`, `information_schema` and `pg_toast`, and whose tables are base tables, views, materialised views, partitioned tables and foreign tables. Column types are the server's formatted type (e.g. `bigint`, `character varying(30)`).
- R24. For Databricks the inventory SHALL list catalogs from `SHOW CATALOGS`, excluding `system` and `__databricks_internal`, and exclude the `information_schema` schema in each. Tables and columns come from one bulk read of the system information schema covering all kept catalogs; if that fails the system SHALL fall back to a per-catalog walk (five catalogs at a time) and skip a catalog that refuses. Catalogs with no visible tables are still listed.
- R25. For Databricks the system SHALL also mark what the credentials can browse but not query: objects reported as browse-only by the Unity Catalog listing API get `selectable: false` (catalogs, schemas, and — by cascade from the schema — tables). Browse-only catalogs are not walked. This annotation is best effort: if the probe fails, `selectable` stays unset and everything is treated as accessible. Only an explicit `false` means "no access".
- R26. For REST the inventory SHALL contain a single catalog `api`. Each endpoint's columns are inferred from up to 50 fetched rows: nested objects are flattened to dot-keys down to three levels; arrays and deeper objects become a `json` column; the type is `string`, `number`, `boolean` or `json` from the first non-null value; a column is nullable if any row has it null or missing. An endpoint that fails is still listed, with no columns and `selectable: false`.
- R27. The inventory SHALL be cached per datasource. A normal request SHALL serve the stored snapshot when one exists and otherwise walk the datasource live and store the result; `refresh=true` SHALL walk live and replace the snapshot; `cachedOnly=true` SHALL return the snapshot or `{ ok: true, cached: false }` and SHALL NOT contact the datasource. Responses carry `fetchedAt` (ISO time of the live walk) and `cached`.
- R28. Deleting a datasource SHALL delete its snapshot. Open question: editing a datasource (for example pointing it at another database) does not invalidate the snapshot; the user must refresh.
- R29. Inventory failures SHALL be returned as `{ ok: false, message }`.
- R30. Every kind SHALL address entities as `catalog.schema.table`: PostgreSQL uses `<database>.<schema>.<table>`, Databricks `<catalog>.<schema>.<table>`, REST `api.<group>.<endpoint>`. Anything that is not exactly three non-empty dot-separated parts SHALL be rejected with `Entity must be catalog.schema.table — got "<entity>"`. A PostgreSQL entity whose catalog is not the datasource's database is rejected with `Entity "<entity>" is in database "<db>" but this datasource is "<datasource db>"`; a REST entity that is not a configured endpoint with `Entity "<entity>" is not an endpoint of this datasource`.

### Sampling

- R31. The system SHALL be able to return sample rows from one entity: `SELECT * … LIMIT n` (REST: first n rows), with n defaulting to 10 and clamped to 1–100.
- R32. The system SHALL be able to sample many entities in one call with bounded concurrency, reusing a single connection where the kind supports it (Databricks does). Each entity returns its rows or its own error; one refused table SHALL NOT fail the batch.

### Read-only execution

- R33. Before any SQL reaches a datasource it SHALL pass the read-only guard, in this order:
  1. Leading whitespace, leading `--` comments, leading `/* … */` comments and a surrounding markdown code fence are removed (repeatedly), and trailing semicolons are removed. Nothing inside the remaining text is rewritten.
  2. Empty → `Query is empty.`
  3. Contains `;` anywhere → `Only a single statement may be executed.`
  4. Does not start with `select` or `with` (case-insensitive) → `Only read-only SELECT / WITH queries can be run.`
  5. Contains any of the whole words `insert`, `update`, `delete`, `merge`, `drop`, `alter`, `truncate`, `create`, `grant`, `revoke`, `upsert`, `replace` (case-insensitive) → `Query contains a forbidden (write/DDL) keyword.`
- R34. The guard is syntactic and deliberately conservative; it SHALL be treated as a first line of defence, not as the only one. Known consequence: a legitimate query that uses one of the forbidden words as a function or in a string literal (for example `replace(name, …)`, or a `;` inside a literal) is rejected. Open question: decide whether to tokenise instead.
- R35. PostgreSQL SQL SHALL additionally run inside a `READ ONLY` transaction that is always rolled back, so the server rejects any write the guard missed. Databricks has no equivalent server-side guard; its protection is the syntactic guard and the access rights of the token.
- R36. REST SQL SHALL run on a throwaway in-memory SQL database (SQLite dialect): the endpoints referenced as `api.<schema>.<table>` in the statement are fetched (all endpoints if none is referenced) and loaded as tables, the statement runs there, and nothing persists after the call. Each endpoint contributes at most its configured maximum row count (default 10 000).
- R37. The number of rows returned from read-only SQL SHALL be limited to the requested limit, default 100, clamped to 1–500. The limit is applied after the statement has run (rows beyond it are discarded, not pushed into the query).

### Timeouts and paging

- R38. Every datasource call SHALL be bounded. PostgreSQL: connect 5 s; statement timeout 5 s for test, 10 s for inventory and foreign keys, 15 s for sampling, 30 s for queries. Databricks: connection and test 30 s, catalog listing 15 s, inventory 120 s, queries and sampling 120 s (a cold warehouse can take minutes to start), Unity Catalog API calls 20 s; timeouts read `Databricks connection timed out after <n>s` / `Databricks query timed out after <n>s`. REST: 20 s per request, 120 s total per endpoint, at most 50 pages, default page size 100, specification fetch 10 s and at most 20 MB.
- R39. REST paging SHALL stop at the requested row count, an empty page, the page cap, the time budget, or (cursor style) a missing/empty next cursor. Style **None** issues one request. Default parameter names: page → `page` + `per_page`; offset → `offset` + `limit`; cursor → `cursor`, next cursor read from the response at the configured cursor pointer. A response that is not valid JSON, or whose rows pointer does not resolve to an array or object, is an error.

### Foreign keys

- R40. A connector MAY report declared foreign keys among a set of entities (PostgreSQL from its constraint catalogs, Databricks from informational constraints in each catalog's information schema; REST cannot). Edges are returned only when both ends are in the requested set. This SHALL never fail the caller: any error yields no edges. Consumers: [datasets](../datasets/spec.md) relationships.

### Errors and diagnostics

- R41. PostgreSQL failures SHALL surface as `Postgres — <message>`, where the message includes the server's `DETAIL` and `HINT` when present (the SQL repair loop relies on the hint) and unwraps multi-address connection failures (for example `localhost` resolving to both `::1` and `127.0.0.1`) into their real causes instead of an empty message.
- R42. REST failures SHALL surface as `REST API — endpoint "<name>": <cause>` with causes `HTTP <status>` followed by up to 200 characters of the response body, `request timed out after <n>s`, `response is not valid JSON`, or `time budget exhausted`; and `REST API — expected an array or object at "<pointer>", got <type>` for a bad rows pointer.
- R43. Each failed connector call SHALL also be written to the application log (PostgreSQL: `Postgres call failed: <message>`), from where the system logs panel shows it. See [diagnostics](../diagnostics/spec.md); secrets matching the redaction patterns never appear there.
- R44. Databricks driver errors are surfaced as the driver reports them, without a prefix. Open question: consider a `Databricks — …` prefix for symmetry with R41 and R42.

### REST endpoint discovery (OpenAPI)

- R45. For a REST datasource the user SHALL be able to press "Discover" to propose endpoints from an OpenAPI 3.x or Swagger 2.0 **JSON** document. The control is enabled when a base URL or a spec URL is filled. A spec URL may be absolute or relative to the base URL; when empty the system tries `/openapi.json`, `/swagger.json`, `/v3/api-docs`, `/api-docs` and `/swagger/v1/swagger.json` under the base URL and then under its origin, with the configured authentication headers.
- R46. Discovery SHALL propose only operations that are `GET`, have no path parameters and have no required query parameter other than a pagination parameter; every other path is reported as skipped with its reason (`no GET operation`, `needs path parameters`, `needs query parameter(s) …`). Each proposal carries a name, group, path, `GET`, summary, whether the response schema is a list of rows ("not a list" otherwise), the number of declared row fields, and a guessed rows pointer and pagination style (page, offset or cursor from common parameter names).
- R47. When the spec has an unusable shape the user SHALL see the reason: `The spec is not a JSON object`, `Not an OpenAPI 3.x or Swagger 2.0 document (no "openapi" / "swagger" field)`, `The spec declares no paths`, `not JSON (YAML specs are not supported — use the JSON version)`, `spec is too large`. Not found anywhere: `No OpenAPI spec found (tried <urls>). Enter the spec URL.`; explicit URL failed: `OpenAPI spec — <url>: <cause>`; nothing to try: `Enter a base URL or an OpenAPI spec URL` or `A relative spec URL needs a base URL`.
- R48. A successful discovery reports `Found <n> endpoint(s) in "<title>"`. Discovery SHALL only propose; nothing is added until the user ticks endpoints and chooses "Add N endpoints", and endpoints whose path is already in the form are shown as "already added" and cannot be re-added.

### Legacy and defaults

- R49. A connection saved before datasources existed (one anonymous Databricks connection) SHALL be migrated on first read into a datasource named "Databricks" with id `legacy-databricks`, so existing datasets can bind to it.
- R50. Datasets that carry no datasource binding SHALL resolve to the default datasource: the first Databricks datasource, otherwise the first datasource in list order.

## Edge cases and errors

- **Wrong credentials / unreachable host:** the form shows the connector's message (for example `Postgres — connect ECONNREFUSED 127.0.0.1:1`), Save stays disabled, and the same message appears in the system logs under Issues without the password.
- **Backend down:** the list shows `Could not load configured datasources`; test/save/delete show `Backend unreachable`.
- **No datasources:** the list shows `No datasources yet. Add one to start building datasets.`
- **Deleting a datasource that datasets use:** allowed; the confirmation warns that datasets bound to it stop working until re-saved against another datasource.
- **Deleting an unknown id:** `Datasource <id> not found`.
- **Test passes but a table later refuses:** sampling reports the per-entity error; the dataset save continues (see datasets).
- **Cold Databricks warehouse:** first queries can take up to 120 s; inventory is cached so later browsing does not pay this again.
- **A REST endpoint is down at inventory time:** it is listed with no columns and `selectable: false`.
- **Editing a REST datasource with masked secrets:** discovery and test work without retyping them (R18).

## Contracts

- Endpoints (list, test, save, delete, inventory with `refresh` / `cachedOnly`, REST discover): see [api.md](../../system/api.md), section Datasources.
- Collections: `connections` (datasource documents; the legacy anonymous Databricks shape is migrated on read) and `datasource_inventories` (one snapshot per datasource id): see [data-model.md](../../system/data-model.md).
- Datasources are consumed by sessions (read-only SQL, sampling), datasets (inventory, sampling, foreign keys), knowledge, metrics, evals and testing-data. They use no agent directly; the SQL repair and verification agents that operate on top of read-only SQL are in [agents.md](../../system/agents.md).
- Terms: [glossary](../../product/glossary.md).

## UI

Lives in Settings → **Datasource Configuration** (see [ui.md](../../system/ui.md)). Heading "Datasource Configuration"; subtitle "Connect the data platforms your datasets draw from — Databricks SQL warehouses, PostgreSQL databases or REST APIs."

**List.** Loading: `Loading datasources…`. Error: `Could not load configured datasources`. Empty: `No datasources yet. Add one to start building datasets.` Populated: one row per datasource with its name, a kind badge (Databricks / PostgreSQL / REST API), a one-line summary, and Edit and Delete icon buttons (titles "Edit", "Delete"). Summaries: Databricks `<host> · warehouse <id>`; PostgreSQL `<host>:<port>/<database>`; REST `REST API · <baseUrl> · <n> endpoint(s)`. A "New datasource" button sits beside the heading and is hidden while the form is open.

**Form** (header "New datasource" or "Edit datasource"). A new datasource defaults to kind Databricks.

| Control | Kinds | Notes |
|---|---|---|
| Name | all | placeholder "Claims warehouse" |
| Kind | all | Databricks / PostgreSQL / REST API; disabled when editing |
| Server hostname | Databricks | placeholder `adb-1234567890.1.azuredatabricks.net` |
| Personal access token | Databricks | password field, placeholder `dapi…` |
| SQL warehouse ID | Databricks | |
| Host, Port, Database, User, Password | PostgreSQL | port defaults to 5432; password field shows `••••••••` when a secret is stored |
| Use SSL | PostgreSQL | checkbox |
| Base URL | REST | placeholder `https://api.example.com` |
| Authentication | REST | No auth / Bearer token / API key header / Basic |
| Token | REST, Bearer | password field |
| Header name, Key | REST, API key header | header name placeholder `X-API-Key` |
| Username, Password | REST, Basic | |
| Endpoints | REST | "Add endpoint"; each row: Name, Path, Group (optional), Rows pointer (optional, with the hint "Rows pointer: JSON pointer to the array of rows; leave empty if the response is the array."), Pagination (None / Page / Offset / Cursor) and, per style, Page param / Offset param / Cursor param, Size param, Cursor pointer, Page size; a "Remove endpoint" button |
| OpenAPI spec URL (optional) + Discover | REST | input labelled "OpenAPI spec URL (optional)"; button shows "Discovering…" while running |

Discovery review panel: "<n> endpoint(s) found in <title>", "Select all" / "Select none", a checkbox row per endpoint (name, group badge, pagination badge, "<n> fields", "already added" or "not a list", path, summary), a collapsible "<n> operation(s) skipped" list with reasons, and "Add N endpoints" / "Cancel". Endpoints that return a list and are not yet in the form are pre-ticked. Adding drops the blank starter row and toasts `Added <n> endpoint(s)`.

Form actions: **Test connection** (becomes "Testing…"), **Save datasource** / **Save changes** (becomes "Saving…"; tooltip "Test the connection successfully before saving"), **Cancel**. Toasts use the messages in R16: `Connection successful`, `Datasource "<name>" saved`, `Datasource "<name>" deleted`, and `Give the datasource a name first`.

Delete confirmation (native dialog): `Delete datasource “<name>”?` then `Datasets bound to it will stop working until re-saved against another datasource.`

## Flows

### Feature: Datasources, datasets, and sessions (World Cup database)

E2E: `frontend/e2e/world-cup-workflow.spec.ts`

```gherkin
Feature: Datasources, datasets, and sessions (World Cup database)

  Background:
    Given the seeded World Cup PostgreSQL database is running

  Scenario: Creates a PostgreSQL datasource, dataset, and session using the real World Cup database
    Given I have created the "World Cup PostgreSQL" datasource, the "World Cup Core" dataset and the "World Cup analysis" session
    When I reload the application
    Then I see "Open system logs"
    And I see the "World Cup analysis" session
    When I click "World Cup analysis"
    Then the header shows "World Cup PostgreSQL" and "PostgreSQL"
    And I see the "Ask a follow-up question…" box

  Scenario: Preserves masked credentials when editing and supports datasource deletion
    Given the "World Cup PostgreSQL" datasource exists
    When I click "Edit" on that datasource
    Then the Password field shows "••••••••"
    When I change the Name to "World Cup Statistics"
    And I click "Test connection"
    Then I see "Connection successful"
    When I click "Save changes"
    Then I see "World Cup Statistics" in the list
    When I click "Delete" on it and confirm
    Then I see "No datasources yet."

  Scenario: Surfaces a failed connection in both the form and system diagnostics
    Given I am in "Datasource Configuration"
    When I click "New datasource"
    And I fill in Name "Unavailable database", Kind "postgres", Host "127.0.0.1", Port "1", Database "missing", User "missing" and a password
    And I click "Test connection"
    Then I see a "Postgres —" error message
    And "Save datasource" is disabled
    When I click "Back"
    And I click "Open system logs"
    And I click "Issues"
    And I search the logs for "Postgres"
    Then I see the "Postgres —" error in the logs
    And the logs do not show the password I entered

  Scenario: Shows the real catalog schema and column metadata before a dataset is saved
    Given the "World Cup PostgreSQL" datasource exists
    And the "World Cup Core" dataset exists
    When I click the "World Cup Core" dataset
    And I expand the "world_cup" catalog, the "world_cup" schema and the "goals" table
    Then I see the column "scorer_player_id"
    And I see a "bigint" column type
```

The fourth scenario exercises the dataset catalog browser and is also referenced from [datasets](../datasets/spec.md). Flows for the Databricks and REST kinds, SSL, and OpenAPI discovery have no E2E yet (see Acceptance).

## Acceptance

1. The four scenarios above pass against the seeded World Cup database (`docker compose up -d postgres`), and every rule R1–R50 is observable through the API, the form, or the logs.
2. For each kind, a valid configuration passes "Test connection", saves, appears in the list with the right badge and summary, reloads with secrets masked, and can be edited and re-tested without retyping secrets.
3. A wrong host, port, password or token yields a kind-specific message (PostgreSQL `Postgres — …`, REST `REST API — endpoint "<name>": …`, Databricks driver text), disables Save, and appears redacted in the system logs.
4. `refresh`/`cachedOnly` behave as R27; deleting a datasource removes its snapshot.
5. The read-only guard rejects each of the five cases in R33 with the exact message, accepts a fenced or comment-prefixed `SELECT`, and PostgreSQL rejects a write that evades the guard (for example inside a function call) because the transaction is read-only.
6. For REST, "Discover" against a spec produces the review panel, only list-returning endpoints are pre-ticked, and queries over two endpoints can be joined in SQL.
7. Not covered by any E2E today and to be added when touched: Databricks (needs a live warehouse; unit-tested with a stubbed driver), REST kind, SSL, and OpenAPI discovery.

<!-- sources: backend/src/modules/datasources/**, backend/src/modules/datasources/connectors/{connector,postgres.connector,databricks.connector,rest.connector,openapi-discovery}.ts, backend/src/modules/datasources/repositories/*.ts, backend/src/infrastructure/database/database.module.ts, frontend/src/app/features/datasources/**, frontend/electron/main.cjs (log redaction), frontend/e2e/world-cup-workflow.spec.ts -->

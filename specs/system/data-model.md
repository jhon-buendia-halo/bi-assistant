# Data model

Everything the app persists: where it lives, the document-store contract, every collection and its exact document shape, the files written to disk, the agent-memory conventions and the migrations that keep old installs working. A reimplementation that honours these shapes can open an existing install's data and vice versa.

Conventions used in the tables below:

- **Req** — `yes` = always present on a stored document; `no` = may be absent (the key is omitted, never stored as `null`, unless the Meaning says `null` is allowed).
- Types: `string`, `number`, `boolean`, `object`, `T[]` (array of T), `map<K,V>`, `ISO` (an ISO-8601 UTC timestamp string with millisecond precision, e.g. `2026-10-04T12:00:00.000Z`), `uuid` (RFC 4122 v4 string).
- Field/endpoint behaviour lives elsewhere: HTTP views are in [api.md](api.md), agent prompts and tools in [agents.md](agents.md), behaviour rules in `../capabilities/<name>/spec.md`. This file owns only the persisted shapes.

---

## 1. Storage overview

### 1.1 The application data directory

All server-side persistent state lives under one directory, the **app data dir**. The backend learns it from the `APP_DATA_DIR` environment variable, set by whatever launched it. Resolution by launcher:

| Launcher | App data dir |
|---|---|
| Desktop app (Electron main process) | Electron `userData` directory, with exceptions below. Packaged product name is `Halo BI Assistant` (macOS `~/Library/Application Support/Halo BI Assistant`, Linux `~/.config/Halo BI Assistant`, Windows `%APPDATA%\Halo BI Assistant`). Installs made under the old product name `Questions to Insights` keep their directory: when the current `userData` directory does not exist but a sibling directory named `Questions to Insights` does, that sibling is used. |
| Desktop app on Windows | Redirected to `%LOCALAPPDATA%\Halo BI Assistant` (off the roaming profile) when `%LOCALAPPDATA%` is set. If that directory already exists it is used as is. Otherwise, if the roaming `userData` holds any of `app.sqlite`, `mastra.sqlite`, `workspaces`, those entries are moved across once (rolled back and the roaming dir kept if any move fails); with no legacy data the local directory is simply created. Any failure falls back to the roaming directory and records a diagnostic. |
| Desktop app in tests | `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR` env var overrides `userData` and disables the Windows redirect. |
| npm CLI (`questions-to-insights`) | `--data-dir <path>`, else `$QTI_DATA_DIR`, else `$APP_DATA_DIR`, else `~/.questions-to-insights`. Resolved to an absolute path and created if missing. Deliberately separate from the Electron directory so the desktop app and the CLI can run at once. |
| Backend started directly (no launcher) | `APP_DATA_DIR` unset: the app database uses `<cwd>/data`; the agent stores use `<launch dir>/data` where launch dir is `INIT_CWD`, else `PWD`, else `cwd` (see Open questions: the two fallbacks can differ). |

The directory is created (recursively) at backend start if it does not exist.

### 1.2 Stores

| Store | Location (relative to app data dir) | Technology (see Implementation note) | What goes in it | Owner |
|---|---|---|---|---|
| **App document store** | `app.sqlite` | Embedded SQLite, one table per collection, one JSON document per row | The application collections in section 3: connections, settings, datasets, sessions, inventories, verified queries, metrics, eval runs, knowledge, agents, skills and the overrides | App backend |
| **Agent memory store** | `mastra.sqlite` | LibSQL file (Mastra runtime storage) | Conversation memory threads/messages for the `assistant` agent (section 5); any other Mastra runtime state | Agent framework |
| **Observability store** | `observability.duckdb` | DuckDB (memory limit 512 MB, 2 threads) | Agent traces, metrics and logs written by the framework's storage exporter (service name `questions-to-insights`, log level `info`) | Agent framework |
| **Session workspaces** | `workspaces/session-<session-id>/` | Plain directories, a contained filesystem root per session | Visual bundles and deep-analysis reports (section 4) | App backend + agents (agents can create/edit files there but cannot delete) |
| **Developer settings** | `developer-settings.json` | JSON file, written atomically (temp file + rename) | `{ observabilityEnabled: boolean, phoenixEndpoint: string, otlpEndpoint: string, updatedAt: ISO string }`. Absent until the first save, and absent means the defaults (`false`, `http://localhost:6006`, `http://localhost:4318`). Invalid or missing values fall back to their defaults. Read synchronously by the backend at startup, before any app module loads (ADR-0006). See [../capabilities/developer-settings/spec.md](../capabilities/developer-settings/spec.md). | App backend |
| **App secret** | `.app-secret` | Text file, mode `0600` | 64 lowercase hex characters (32 random bytes). The key material for encrypting stored secrets (section 2.3). Read if present and non-empty, else generated once and written. `APP_SECRET` env var, when set, wins and the file is not used. Created by the launcher (Electron main or CLI); a backend started without `APP_SECRET` reads or creates the same file itself. | Launcher, else backend |
| **Intellify API key** | `.intellify-api-key` | Text file, mode `0600` | 64 lowercase hex characters (32 random bytes): the key the embedded Intellify RFP API accepts in `X-API-Key` ([api.md](api.md) 2.16) and that the `intellify-api` Testing Data fixture stores (encrypted) on the `Intellify RFP API` datasource. Read if present and non-empty, else generated once and written, as `.app-secret`. `INTELLIFY_API_KEY`, when set, wins and the file is not used. Not used by a standalone API, which requires the variable. | Backend (embedded Intellify RFP API) |
| **Diagnostics log** (desktop app only) | `<Electron userData>/logs/system.ndjson`, rotated to `system.previous.ndjson` when larger than 5 MiB at startup | Newline-delimited JSON | System log entries `{id, timestamp, level, source, message, details}` (redacted), at most the last 2000 reloaded at startup. Lives under Electron `userData`, **not** the app data dir (they differ on Windows). See [../capabilities/diagnostics/spec.md](../capabilities/diagnostics/spec.md). | Electron main |
| **Renderer preference** (client) | Browser/Electron `localStorage` key `questions-to-insights:right-panel-width` | String holding a number | Right panel width in pixels; default 572, clamped to 360..960 (upper bound also limited by window width). Missing or non-numeric = default. See [ui.md](ui.md). | Frontend |
| **Renderer preference cache** (client) | Browser/Electron `localStorage` key `questions-to-insights:theme` | String: `system`, `light` or `dark` | A copy of the Appearance choice held in the `settings` document `ui-preferences` (section 3.2), read by an inline script before the app boots so the first paint uses the right theme. Missing or any other value = `light`. The backend value wins once loaded. See [../capabilities/app-shell/spec.md](../capabilities/app-shell/spec.md) R39–R45. | Frontend |
| **Renderer preference cache** (client) | Browser/Electron `localStorage` key `questions-to-insights:nav-expanded` | String: `true` or `false` | A copy of the navigation drawer state held in `ui-preferences`. Missing or any other value = `true` (expanded). See app-shell R50. | Frontend |
| **Renderer preference** (client) | Browser/Electron `localStorage` key `questions-to-insights:workflow-bar-collapsed` | String: `true` or `false` | Whether the workflow bar above the chat is folded to one line ([agent-panel](../capabilities/agent-panel/spec.md) R18). Per browser, not per session, and never synced to the backend; missing, unreadable or any other value = unfolded. Reads and writes are guarded, so the bar works without storage. | Frontend |

Nothing else is persisted in the app data dir; the RFP records of the RFP Builder live in an external PostgreSQL database behind the Intellify RFP API (section 7). Deep-analysis jobs and REST-datasource row materialisation are in-memory only (sections 3.11, 3.12).

**Implementation note.** The current implementation uses `better-sqlite3` for `app.sqlite`, `@mastra/libsql` for `mastra.sqlite` and `@mastra/duckdb` for `observability.duckdb` (see [tech-stack.md](tech-stack.md)). Only the *document shapes* and the *file layout under `workspaces/`* are contracts that matter across stacks; the agent memory and observability stores are opaque framework state.

### 1.3 Identity and time conventions

- Ids are random UUID v4 strings generated by the backend, except: the legacy migrated connection id `legacy-databricks`; datasets (identified by unique `name`); the LLM settings document (`key: "llm"`); inventory snapshots (id = the datasource id).
- `createdAt` / `updatedAt` are ISO UTC strings maintained **by the document store**, not by services (section 2). Services that also write their own `createdAt` (knowledge, visual versions) write the same kind of value.
- Chat messages have no id. A message is identified by its `at` ISO timestamp (set by the backend when the message is appended). `at` is the key other documents use to point at a message (visuals' `sourceMessageAt`, verified queries' `sourceMessageAt`, feedback calls).
- Collections whose list order matters are returned sorted by `updatedAt` descending (newest first) unless noted.

---

## 2. Document store contract

### 2.1 Abstract interface

A **collection** is an unordered-by-contract set of JSON documents (plain objects). One collection per entity. The store interface, per collection of documents of type `T`:

| Operation | Semantics |
|---|---|
| `insert(doc)` | Appends `doc` with `createdAt` and `updatedAt` both set to now, **overwriting** any values the caller supplied for those two keys. Returns the stored document. No uniqueness checks. |
| `find(filter?, {sort?})` | Returns every document matching `filter` (all conditions ANDed; empty/absent filter = all), then sorted if `sort` is given. Without `sort`, the order is insertion order. |
| `findOne(filter, {sort?})` | The first element of `find`, or `null`. |
| `update(filter, patch, {upsert?, setOnInsertOnly?})` | Takes the **first** document (insertion order) matching `filter`. If found: unless `setOnInsertOnly` (then returns the document untouched and writes nothing), replaces it with a **shallow merge** of `patch` over it (top-level keys of `patch` replace the same top-level keys wholesale, nested objects are not merged) and sets `updatedAt` to now; `createdAt` is preserved. Returns the new document. If not found: with `upsert`, inserts `patch` itself (not the filter) as a new document with `createdAt` = `updatedAt` = now and returns it, so the patch must carry the filter's fields; without `upsert`, returns `null`. |
| `unset(filter, field)` | On the first matching document, removes the top-level key `field` and bumps `updatedAt`. Returns the document, or `null` if none matched. |
| `deleteOne(filter)` | Deletes the first matching document; returns the number deleted (0 or 1). |
| `deleteMany(filter)` | Deletes every matching document; returns the count. |

### 2.2 Filters and sorts

- **Filter**: a map from field path to expected value. A path may be dotted (`scope.datasetId`) to read nested objects; reading through a non-object yields "absent". Expected value is a string, number, boolean — matched with strict equality (no type coercion, no case folding, no partial/regex/range match) — or `{ "$exists": true|false }`, which matches on whether the value at the path is present (not `undefined`; an explicit JSON `null` counts as present). No `$or`, `$in`, `$ne` or comparison operators: anything needing those is evaluated by the service over `find()` results (the knowledge scope rule, eval-run baseline selection, metric slug lookups do this).
- **Sort**: a map from field path to `1` (ascending) or `-1` (descending), applied in key order; ties fall through to the next key, then to insertion order. Values are compared with the language's native `<` on same-typed values (ISO timestamp strings therefore sort chronologically). A missing/`null` value sorts **last regardless of direction**.
- An absent filter value cannot be matched (`{field: undefined}` is not a valid filter).

### 2.3 Secret handling (`CryptoService`)

Only one persisted value is encrypted: the LLM API key in the settings document (section 3.2). Scheme:

- Algorithm AES-256-GCM. Key = SHA-256 of the string `APP_SECRET` (the value of the env var; if unset, the contents of `<APP_DATA_DIR>/.app-secret`, generated and written there first if missing, section 1).
- Ciphertext string format `base64(iv):base64(authTag):base64(data)`: a fresh 12-byte random IV per encryption, the 16-byte GCM tag, then the encrypted UTF-8 plaintext. Decryption splits on `:`.
- Changing or losing the secret makes existing ciphertext undecryptable. The one exception is ciphertext under the **former development secret** (SHA-256 of `insecure-dev-secret`, which the backend used when `APP_SECRET` was unset before it persisted its own secret): it is re-encrypted at startup (migration M11). Any other undecryptable key is reported as unreadable, not thrown (see [api.md](api.md) `GET /llm/settings`).

Datasource credentials (Postgres password, Databricks token, REST bearer token / basic password) are **not** encrypted at rest: they are stored in plaintext inside the connection document and are only masked in API responses (section 3.1). This is a known gap, see Open questions.

### 2.4 Concurrency and atomicity

Operations are individually atomic. Several writes, across collections, can run as one **transaction** (`DocStoreTransactions.run(work)`): every write `work` makes is applied, or none is. Nothing in the app uses it today: no operation spans several writes atomically. Read-modify-write sequences in services (e.g. appending to a session's messages) re-read the document immediately before writing so a concurrent turn is not overwritten; they are still last-writer-wins on the whole top-level key (e.g. the whole `messages` array).

**Implementation note (current adapter).** `SqliteDocStore` keeps one table per collection: `CREATE TABLE IF NOT EXISTS "<table>" (rid INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL)`, `doc` holding the JSON text. Every `find`/`update`/`delete` loads all rows of the table, parses them and filters/sorts in process (a deliberate prototype-scale trade); "first match" means lowest `rid`. A table is created when its collection is first opened, so a missing table silently becomes an empty collection (this is why renames need migrations, section 6). Because documents are serialised with `JSON.stringify`, a patch key whose value is `undefined` is dropped on write, i.e. it effectively removes that field from the stored document (although the returned in-memory document still carries the key). Each collection is registered as an injection token plus table name; adding a collection means adding one entry to that registry. All collections share one SQLite connection, so a transaction is `BEGIN IMMEDIATE` … `COMMIT` (or `ROLLBACK` when `work` throws) on it. The adapter's statements are synchronous under their promises, so nothing else touches the connection while `work` only calls stores; transactions are queued, never nested, and `work` must not wait on anything but stores.

---

## 3. Collections

Summary:

| Collection (table) | Purpose | Identity | Default order | Capability |
|---|---|---|---|---|
| `connections` | Saved datasources (data platform connections) | `id` | `updatedAt` desc | [datasources](../capabilities/datasources/spec.md) |
| `settings` | Single-row app settings: the LLM settings, the built-in agent pins and the UI preferences | `key` (`"llm"`, `"builtin-agent-pins"`, `"ui-preferences"`) | n/a | [llm-settings](../capabilities/llm-settings/spec.md) |
| `datasets` | Named selections of entities with a schema snapshot | `name` (unique, upsert key) | `updatedAt` desc | [datasets](../capabilities/datasets/spec.md) |
| `sessions` | Chat sessions with full transcript and visual metadata | `id` | `updatedAt` desc | [sessions-chat](../capabilities/sessions-chat/spec.md), [visuals](../capabilities/visuals/spec.md) |
| `datasource_inventories` | Cached catalog/schema/table walk per datasource | `id` = datasource id | n/a | [datasources](../capabilities/datasources/spec.md) |
| `verified_queries` | User-approved question to SQL pairs | `id`; dedupe key `(sourceSessionId, sourceMessageAt)` | `updatedAt` desc | [verified-queries](../capabilities/verified-queries/spec.md) |
| `metrics` | Curated metric definitions | `id`; `name` unique | `updatedAt` desc | [metrics](../capabilities/metrics/spec.md) |
| `eval_runs` | Past and in-flight eval runs | `jobId` | `startedAt` desc (per agent) | [agents-evals](../capabilities/agents-evals/spec.md) |
| `knowledge_snippets` | Curated knowledge entries | `id` | `updatedAt` desc | [knowledge](../capabilities/knowledge/spec.md) |
| `agents` | User-built agents (a draft, an optional Live version, pin) | `id` | `updatedAt` desc | [agents-evals](../capabilities/agents-evals/spec.md) |
| `skills` | In-app skills a user writes and assigns to their agents | `id`; `name` unique | `updatedAt` desc | [agents-evals](../capabilities/agents-evals/spec.md) |
| `skill_overrides` | Org-wide overrides of built-in skills, edited in the app | `name` (a built-in skill's name) | n/a | [agents-evals](../capabilities/agents-evals/spec.md) |
| `agent_prompt_overrides` | Org-wide overrides of built-in agents' system prompts, edited in the app | `key` (a built-in agent's registry key) | n/a | [agents-evals](../capabilities/agents-evals/spec.md) |

Every document in every collection also carries `createdAt` and `updatedAt` (ISO), maintained by the store (section 2.1); they are listed per collection only where they matter. `sessions`, `verified_queries`, `metrics`, `eval_runs`, `knowledge_snippets`, `agents` and `skills` carry a legacy, inert `ownerId` (section 3.14). There are **no foreign-key constraints and no cascading deletes** between collections; references are by value (`name`, `id`) and may dangle (section 3.13).

### 3.1 `connections` — datasources

One document per saved connection. The `kind` selects the shape of `config`.

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | uuid | yes | Generated on first save (`legacy-databricks` for the migrated legacy connection, section 6). |
| `name` | string | yes | User-chosen display name, trimmed, non-empty, truncated to 64 characters. Not required to be unique (the testing-data feature looks a sample's datasource up by name). |
| `kind` | enum | yes | `databricks` \| `postgres` \| `rest`. |
| `config` | object | yes | One of the three config shapes below. |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

`DatabricksConfig` (`kind = databricks`):

| Field | Type | Req | Meaning |
|---|---|---|---|
| `host` | string | yes | Workspace host. |
| `token` | string | yes | Personal access token (secret, plaintext at rest). |
| `warehouseId` | string | yes | SQL warehouse id. |

`PostgresConfig` (`kind = postgres`):

| Field | Type | Req | Meaning |
|---|---|---|---|
| `host` | string | yes | |
| `port` | number | yes | Falsy value is displayed/treated as 5432. |
| `database` | string | yes | |
| `user` | string | yes | |
| `password` | string | yes | Secret, plaintext at rest. |
| `ssl` | boolean | yes | |

`RestApiConfig` (`kind = rest`):

| Field | Type | Req | Meaning |
|---|---|---|---|
| `baseUrl` | string | yes | Base URL endpoint paths are relative to. |
| `auth` | object | yes | `RestAuthConfig` below. |
| `headers` | map<string,string> | no | Extra request headers. Stored and returned **unmasked**. |
| `endpoints` | `RestEndpointDef[]` | yes | Each endpoint is exposed as a table under the single catalog `api`. |

`RestAuthConfig`: `type` (enum `none` \| `bearer` \| `api-key-header` \| `basic`, required); `token` (string, secret; for `bearer` and `api-key-header`); `headerName` (string; header carrying the key for `api-key-header`); `username` (string; `basic`); `password` (string, secret; `basic`). Only the fields relevant to `type` need be present.

`RestEndpointDef`:

| Field | Type | Req | Meaning |
|---|---|---|---|
| `name` | string | yes | Table name the endpoint appears as. |
| `group` | string | no | Schema name grouping endpoints. |
| `path` | string | yes | Path relative to `baseUrl`. |
| `rowsPointer` | string | no | JSON pointer to the array of rows in the response. |
| `pagination` | object | no | `style` enum `none` \| `page` \| `offset` \| `cursor` (required in the object); `pageParam`, `sizeParam`, `offsetParam`, `cursorParam`, `cursorPointer` (string, the query param / response pointer names the style needs); `pageSize` (number). |
| `maxRows` | number | no | Cap on rows fetched. |

**Secret masking.** API views of a connection replace secrets with the literal `••••••••` (8 bullet characters U+2022) when the secret is non-empty (empty stays empty): Postgres `password`, Databricks `token`, REST `auth.token` and `auth.password`. When the client sends a masked or empty secret back on test/save for an existing `id` of the same `kind`, the stored secret is kept. The view also carries a computed `summary` string (not stored): Postgres `host:port/database` (port defaults 5432); Databricks `host · warehouse <warehouseId>`; REST `REST API · <baseUrl> · <n> endpoint(s)`. See [api.md](api.md).

The **inventory shape** every connector normalises to (used by section 3.5 and the datasets browser): `catalog → schema → table → column`, as `CatalogInfo {name, schemas[], selectable?}`, `SchemaInfo {name, tables[], selectable?}`, `TableInfo {name, columns[], selectable?}`, `ColumnInfo {name: string, type: string, nullable: boolean}`. `selectable` is `boolean`, optional: `undefined` means access unknown (treated as accessible); only an explicit `false` means the credentials cannot query it (shown greyed).

### 3.2 `settings` — LLM settings

Exactly one LLM document, upserted by `key = "llm"`. A second kind of document holds pins of built-in agents: `{ key, pinned: string[] }`, the registry keys pinned (see section 3.10), with the bare key `builtin-agent-pins` (before ADR-0030 it was suffixed `:<user id>`; M14 renames it, section 6). LLM readers filter by `key`, so the kinds never mix.

| Field | Type | Req | Meaning |
|---|---|---|---|
| `key` | string | yes | Always `"llm"`. |
| `provider` | enum | yes | `openai` \| `anthropic` \| `lenai` (LenAI = Halo's OpenAI-compatible gateway). |
| `model` | string | yes | Model id; for `lenai` it is the deployment name. |
| `baseUrl` | string | yes | `""` for `openai`/`anthropic`; required non-empty for `lenai`. |
| `apiKeyCiphertext` | string | yes | The API key encrypted per section 2.3. Never returned by the API; the view carries `apiKeyMasked` = `••••••••` + the key's last 4 characters. |
| `reasoningEffort` | enum | no | `none` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` \| `max`, limited on save to the levels the model accepts ([agents.md](agents.md) 1.4); absent is read as `high`. A save without an effort keeps the stored value when the model offers it, else the model's default. Settable only once settings exist. Older documents hold only `low` / `medium` / `high`, which stay valid (no migration). |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

No document stored = "not configured": agents fall back to model `openai/gpt-4o-mini` with the `OPENAI_API_KEY` env var. A save is only persisted after a live test call with the submitted settings succeeds. See [agents.md](agents.md) for model routing.

#### 3.2.1 `settings` document `ui-preferences`

| Field | Type | Required | Notes |
|---|---|---|---|
| `key` | string | yes | Identity: `"ui-preferences"`. One document, the super admin's (before ADR-0030 the key was suffixed `:<user id>`; M14 renames it, section 6). |
| `theme` | enum | no | `system` \| `light` \| `dark`. Absent = never chosen = Light (app-shell R39, R43). |
| `navExpanded` | boolean | no | Navigation drawer state from the user's last Expand / Collapse click. Absent = expanded (app-shell R50). |
| `updatedAt` | ISO string | yes | Set on each save. |

Written by `PUT /ui-preferences` ([api.md](api.md) 57); ADR-0009.

### 3.3 `datasets`

A named, saved selection of entities from one datasource, with a point-in-time schema snapshot so agent context needs no live round-trip. Upserted by `name` (saving an existing name replaces `tables`/`entities`/binding). The collection may also hold **legacy single-selection documents without a `name`** from the pre-dataset era; every read filters with `name $exists`, so they are invisible (and never deleted).

| Field | Type | Req | Meaning |
|---|---|---|---|
| `name` | string | yes | Unique identifier of the dataset everywhere it is referenced (sessions, knowledge scope). Trimmed, non-empty. |
| `datasourceId` | string | no | Id of the owning connection. Absent only on datasets saved before datasources existed; at runtime those are bound (not persisted) to the default datasource: the first `databricks` connection, else the first connection by `updatedAt` desc. |
| `datasourceKind` | enum | no | `databricks` \| `postgres` \| `rest`, copied from the datasource at save. |
| `tables` | string[] | yes | Fully-qualified included entities `catalog.schema.table`; at least one. |
| `entities` | `DatasetEntitySnapshot[]` | no | Schema snapshot; absent on very old datasets. |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

`DatasetEntitySnapshot`: `key` (string, req, `catalog.schema.table`), `columns` (`DatasetColumnSnapshot[]`, req).

`DatasetColumnSnapshot`:

| Field | Type | Req | Meaning |
|---|---|---|---|
| `name` | string | yes | |
| `type` | string | yes | Platform type name. |
| `nullable` | boolean | yes | |
| `sampleValues` | string[] | no | Up to 5 distinct non-blank values from a save-time sample of up to 50 rows per table; each stringified (objects as JSON, dates ISO) and truncated to 40 characters followed by `…`. Absent when nothing was sampled or the column was blank. Existing datasets are not backfilled; they enrich on re-save. |
| `description` | string | no | Catalog comment for the column when the platform exposes one. |
| `references` | object | no | `{entity: string (catalog.schema.table), column: string, source: "declared" \| "inferred"}` — where this column joins. `declared` from the platform's foreign-key constraints, `inferred` from naming; declared wins. Computed at save. |

### 3.4 `sessions`

A conversation. The largest document; the whole transcript is embedded.

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | uuid | yes | Also the agent memory thread id, the memory resource id and the workspace key (`session-<id>`). |
| `name` | string | yes | Trimmed, non-empty, truncated to 64 characters. |
| `workspaceId` | string | no | `session-<id>`; the Mastra workspace owned one-to-one by this session. |
| `datasets` | string[] | yes | Names of the datasets the session works over (at least one at creation). Renamed from `sandboxes` (section 6). |
| `agentId` | uuid | no | The user agent the session was started from (section 3.10). Absent for a plain-assistant session. Set at creation, never changed. No migration: absent means the plain assistant (ADR-0008). |
| `agentName` | string | no | Present with `agentId`. The agent's Live name, stamped at creation and re-stamped by every turn that applies the agent, so a deleted agent's sessions can still name it. Also present with `agentKey`: the built-in agent's name at creation (`RFP Builder`). |
| `agentKey` | string | no | The registry key of the built-in agent the session is bound to (today only `rfp`, the RFP Builder; ADR-0028, [agents.md](agents.md) 2.8). Every turn runs that agent. Absent means the assistant (with or without `agentId`); never set together with `agentId`. Set at creation, never changed. No migration (new optional field). |
| `rfpId` | uuid | no | `agentKey: "rfp"` sessions only: the active RFP record (an `rfp.rfps` id in the Intellify database, section 7), stamped by the turn whose `create_rfp` or `get_rfp` call succeeded, so a resumed chat starts at the right stage. Replaced when a later turn works on another RFP. No migration. |
| `messages` | `ChatMessage[]` | yes | Transcript in order. Empty at creation. |
| `visualizations` | `SessionVisualization[]` | no | Visual metadata (section 3.4.3); `[]` at creation. |
| `panelItems` | `PanelItem[]` | no | What agents showed in the right panel, and visuals as they were created or changed (section 3.4.4, [agent-panel](../capabilities/agent-panel/spec.md)); absent until something is shown. At most 100 items (R10). |
| `workflowState` | `WorkflowState` | no | The saved progress through the agent's workflow steps, and the steps an agent defined itself (section 3.4.4); absent until an agent or the RFP stage sets it. |
| `ownerId` | string | no | Legacy and inert: `local` or absent (section 3.14). |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. **Every** write to the document (a message, a rating, a visual change) bumps `updatedAt`, which orders the session list. |

Deleting a session deletes the document, its agent memory thread and its workspace directory (section 5). It does **not** delete verified queries sourced from it.

#### 3.4.1 `ChatMessage`

| Field | Type | Req | Meaning |
|---|---|---|---|
| `role` | enum | yes | `user` \| `assistant`. |
| `content` | string | yes | Message text. For an assistant message it is the answer markdown; for a clarification, the question; for a deep-analysis report, the report's executive summary; for a visual-only turn a generated line like `Created interactive visual "<title>" (v<N>).` (verbs Created / Updated / Reverted). |
| `at` | ISO | yes | Creation time; the message's identity (see 1.3). |
| `data` | `ToolDataRecord[]` | no | Data the assistant retrieved this turn (3.4.2). Omitted when empty. |
| `entities` | string[] | no | Distinct fully-qualified `catalog.schema.table` entities the answer's SQL touched, derived from `data`; drives provenance chips and the visual frame's source list. |
| `clarification` | object | no | `{question: string, options: ClarificationOption[]}` where `ClarificationOption = {label: string, description?: string}`. Present when the turn ended with a clarifying question; the message `content` equals `question`. |
| `visual` | `VisualEvent` | no | `{visualId: string, version: number, title: string, action: "created" \| "updated" \| "reverted"}` — this turn created/updated/reverted a visual (rendered as a card). |
| `verified` | boolean | no | Always `true` when present. Set when the answer's final successful SQL matches a stored verified query, or on thumbs-up; removed on thumbs-down. |
| `interpretation` | string | no | Deterministic provenance line built at persist time (never model output): `Computed from <n> quer(y\|ies) over <entities, comma-joined> — <rows> row(s) analyzed.` (` over …` omitted with no entities). Absent with no successful SQL. |
| `feedback` | enum | no | `up` \| `down`. A thumbs-up also upserts a verified query (section 3.6). |
| `crossCheck` | object | no | Careful mode only: `{status: "agree" \| "disagree" \| "error", note?: string}`; `note` is a one-line tooltip text (clipped). `agree` = an independent re-derived query returned the same result set, `disagree` = it differed, `error` = the check could not complete. |
| `reasoning` | `ReasoningStep[]` | no | The assistant's plain-language route to the answer (3.4.2); omitted when no call carried a rationale. Older transcripts lack it; readers derive it from `data[].rationale`. |
| `knowledge` | `KnowledgeUse[]` | no | The enabled knowledge snippets that fit the turn's context budget (3.9). Records what the model was *given*. |
| `report` | `AnalysisReport` | no | `{jobId: string, title: string, path: string, angles: number}` — set on the message a finished deep-analysis job appends. `path` is workspace-relative (`reports/<jobId>.md`), `angles` the number of investigation angles covered. |
| `rfpPackage` | `RfpPackageRef` | no | `{rfpId: string, title: string, files: {name: string, bytes: number}[], exportedAt: ISO, draft?: boolean}` — `draft: true` when the package is a draft stored under `rfp/<rfpId>/draft/` by `export_rfp_draft`, absent for the final package. Set on the answer of a turn whose `export_rfp_package` or `export_rfp_draft` call stored an RFP package in the session workspace (`rfp/<rfpId>/`, section 4.1). `files[].name` is relative to that folder (`rfp.md`, `rfp.pdf`, `exhibits/<name>.csv`, `manifest.json`). Rendered as the package card; downloaded through [api.md](api.md) #105. RFP Builder sessions only. |

Messages never carry an id; user messages have only `role`, `content`, `at`.

#### 3.4.2 `ToolDataRecord` and `ReasoningStep`

`ToolDataRecord` — one data-gathering tool call's captured result, also the element type of a visual's `data.json`:

| Field | Type | Req | Meaning |
|---|---|---|---|
| `tool` | string | yes | Tool name; only `run_readonly_sql` and `sample_rows` are captured. |
| `input` | string | no | The SQL actually run (the repaired statement when the SQL repair agent rewrote it) or, for `sample_rows`, the entity name. |
| `columns` | string[] | no | Column names (falls back to the keys of the first row). |
| `rows` | object[] | no | Result rows (column name to value), **capped at 200 rows** per record in storage. |
| `rowCount` | number | no | Rows the tool returned before the 200-row storage cap. |
| `truncated` | boolean | no | `true` when rows were clipped anywhere: the query hit its row limit or storage kept fewer rows than returned. Omitted when `false`. |
| `error` | string | no | Error text for a failed call. A failed record has `tool`, `input`, `error` and `rationale` only. |
| `rationale` | string | no | Why the assistant ran this call, in its own business language; whitespace flattened, trimmed, clipped to 400 characters (ending `…`). |
| `warnings` | string[] | no | Faults the result guards found (ratio of a sum to itself, a metric constant on every row, an unordered "top N", row cap reached). Omitted when none. |

`ReasoningStep`: `step` (number, 1-based position among records that carried a rationale), `rationale` (string), `tool` (string), `input` (string, no), `rowCount` (number, no), `error` (string, no). Assembled at persist time from `data` so a step can never describe a query that did not run.

#### 3.4.3 `SessionVisualization` (session metadata for a visual)

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | uuid | yes | Visual id; directory name under `visuals/`. |
| `title` | string | yes | Current title (from the current version's designer output). |
| `description` | string | yes | Current takeaway text. |
| `path` | string | yes | Workspace-relative directory: `visuals/<id>`. |
| `sourceMessageAt` | ISO | yes | `at` of the assistant answer the visual was created from. |
| `createdAt` | ISO | yes | Creation time. |
| `currentVersion` | number | no | The version shown; absent on pre-versioning visuals (read as 1). |
| `versions` | `VisualizationVersion[]` | no | Version history; absent/empty on pre-versioning visuals. |

`VisualizationVersion`: `version` (number, 1-based, req), `createdAt` (ISO, req), `sourceMessageAt` (ISO, req), `instruction` (string, no; the tailoring request that produced the version, absent for v1; an automatic repair stores `auto-repair: <error text, max 200 chars>`), `refreshedAt` (ISO, no; last time this version's data was re-run).

Revert changes only `currentVersion` (and title/description to the target version's). A refresh sets `refreshedAt` on the current version's entry (materialising a synthetic v1 entry first if `versions` was absent). Tailoring appends version `currentVersion + 1`.

The panel/API also exposes `InteractiveVisualization = SessionVisualization + {document: string, version: number}` where `document` is the assembled sandboxed HTML; that is a response shape, never stored (see [api.md](api.md)).

#### 3.4.4 `PanelItem`, `WorkflowState` and the derived workflow view

A `PanelItem` is one thing an agent showed with `show_in_panel` ([agents.md](agents.md) 3.11), or a visual. Every item has:

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | A uuid for `file`, `document` and `table` items; `visual:<visualId>` for a visual. |
| `kind` | `file`, `document`, `table` or `visual` | yes | Which of the shapes below. |
| `title` | string | yes | The heading shown in the panel (the default per kind, [agents.md](agents.md) 3.11). |
| `shownAt` | ISO | yes | When it was last shown; the item with the latest `shownAt` is the one the panel opens on. |

Per kind, in addition:
- `file`: `path` (string, the workspace-relative path as the agent gave it) and `bytes` (number, the file's size when shown). The content is not stored; it is read from the session workspace when opened (api.md 106).
- `document`: `markdown` (string, at most 50,000 characters).
- `table`: `tool` (string, the tool of the query result it was taken from), `input` (string, no; the SQL or the entity name of that record), `columns` (string[]), `rows` (object[], column name to value, at most 200, as in `ToolDataRecord`, 3.4.2), `rowCount` (number, before the cap) and `truncated` (boolean, no; `true` when rows were cut). The rows are copied at the time of the call, so the item stands on its own.
- `visual`: `visualId` (string); the visual's own data stays in `visualizations` (3.4.3). One item per visual, upserted: its `shownAt` is stamped whenever the visual is created, updated, tailored, reverted or shown again.
- Retired kind `phases` (one item per session, the workflow tracker): no longer written by anything; the workflow lives in `workflowState` and is shown only in the workflow bar. A stored `phases` item of a session saved before BA-231 stays in the document untouched, but is dropped when the session is read (below), so there is no migration.

`WorkflowState`: `current` (number, the step in progress, 1-based), `done` (number[], completed step numbers), `skipped` (number[], no; step numbers that do not apply), `waiting` (boolean, no; `true` while the current step waits for the user), `steps` (string[], no; the titles of steps the agent defined itself with `update_workflow`, 2 to 12, each at most 80 characters; only for an agent whose prompt has no `## Workflow` section), `note` (string, no; the Markdown of the current step's card, at most 2,000 characters), `todos` (object, no; step number as a string to the action the user must do, each at most 120 characters, set by `update_workflow`'s `todo`; kept across calls, dropped when new `steps` reset the state, kept by the RFP auto-drive) and `updatedAt` (ISO). `show_in_panel` never writes it. An `update_workflow` call changes only what it passes, with the keep and clear rules of [agents.md](agents.md) 3.12 (new `steps` reset the state); the RFP stage auto-drive drops `note` and `waiting` when the current step changes and keeps them when it does not. Steps from the prompt are never stored: they are read from the agent's prompt on every request, so a prompt edit reaches existing sessions; only agent-defined `steps` are stored.

Derived on every read, never stored (the view of a session on the wire, [api.md](api.md) 2.1):
- `panelItems` is the stored list without any item of the retired kind `phases` (a read-time rule: such an item is never returned, shown or counted by the view, and no migration rewrites it), plus a synthesized `visual:<id>` item (with `shownAt` = the visual's `createdAt`) for every visualization that has no stored item, so sessions saved before panel items need no migration.
- `workflow?: WorkflowView` = `{ phases: WorkflowPhase[], source: 'prompt' | 'agent', current: number | null, done: number[], skipped: number[], waiting?: boolean, note?: string }`, where `WorkflowPhase` = `{ number, title, skill?, action? }` is parsed from the session's agent's prompt ([agent-panel](../capabilities/agent-panel/spec.md) R8; `source` is `prompt`), or, when the prompt has no workflow section, built from `workflowState.steps` (titles only, no skill; `source` is `agent`); `action` is `workflowState.todos[number]` when set, else the default action of the prompt's line (agent-defined steps have only the todo); `current` / `done` / `skipped` / `waiting` / `note` come from `workflowState` (`null` and `[]` when none), leaving out numbers beyond the phases. Absent when there is neither a prompt section nor agent-defined steps. The same shape is the `content` of the `workflow` stream event ([api.md](api.md) 3.1).

### 3.5 `datasource_inventories`

The last live inventory walk per datasource, so the browser need not hit a cold warehouse each time. Replaced on refresh; deleted when the datasource is deleted.

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | The datasource id. |
| `catalogs` | `CatalogInfo[]` | yes | Normalised inventory (see end of 3.1). |
| `fetchedAt` | ISO | yes | When the live fetch ran. |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

### 3.6 `verified_queries`

Question to SQL pairs approved with a thumbs-up, retrieved by lexical similarity into the assistant's prompt.

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | uuid | yes | Regenerated each time the same answer is re-approved (the upsert patch overwrites it), so do not treat it as a stable external key. |
| `question` | string | yes | The user message that produced the approved answer, trimmed. |
| `sql` | string | yes | The answer's last successful `run_readonly_sql` statement, trimmed. |
| `datasourceId` | string | no | Datasource when the session's datasets resolved to exactly one; else absent (then the pair matches on any datasource). |
| `entities` | string[] | yes | Entities the answer drew on (the message's `entities`, else `[]`). |
| `sourceSessionId` | string | yes | Session the pair came from. Renamed from `sourceProjectId` (section 6). |
| `sourceMessageAt` | ISO | yes | `at` of the source assistant message. |
| `ownerId` | string | no | Legacy and inert: `local` or absent (section 3.14). |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

Dedupe key `(sourceSessionId, sourceMessageAt)`: saving upserts on it, so re-rating the same message never forks. Thumbs-down deletes all pairs with that key. Exact-match "is this SQL verified" compares normalised SQL text.

### 3.7 `metrics`

Curated, app-owned metric definitions (a lightweight semantic layer).

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | uuid | yes | |
| `name` | string | yes | Slug handle, unique across the collection: lowercased, 1..64 chars, regex `^[a-z][a-z0-9_]*$` (e.g. `denial_rate`). |
| `label` | string | yes | Human label (`Denial rate`), trimmed, non-empty. |
| `description` | string | no | Business meaning, caveats, units. Omitted when blank. |
| `entity` | string | yes | Fully-qualified `catalog.schema.table` the expression computes over. |
| `datasourceId` | string | no | |
| `expression` | string | yes | A single SQL aggregation expression; must not contain `;`. |
| `dimensions` | string[] | no | Columns it is meaningfully grouped by; omitted when empty. |
| `sourceVerifiedQueryId` | string | no | Verified query it was promoted from (provenance). |
| `ownerId` | string | no | Legacy and inert: `local` or absent (section 3.14). |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

An update that omits an optional field removes it from the stored document (`unset`), so no stale description/dimensions survive an edit. Prefilled drafts (`MetricCandidate`: `verifiedQueryId`, `name`, `label`, `entity`, `datasourceId?`, `sql`) are computed from verified queries and never stored.

### 3.8 `eval_runs`

Persisted record of an eval run (the assistant's regression suite), started in the app or, since BA-242, from the command line (`source`). Rewritten wholesale (`update` by `jobId` with upsert) after each question lands (after all of its attempts, [agents-evals](../capabilities/agents-evals/spec.md) R210) and at the end, so a crash mid-suite still leaves finished questions. The in-flight copy in process memory is authoritative while a run is running.

| Field | Type | Req | Meaning |
|---|---|---|---|
| `jobId` | uuid | yes | Run id. |
| `agentKey` | string | yes | Agent evaluated: `assistant` or `rfp`, the two agents with evals ([agents.md](agents.md) 8). |
| `datasourceId` | string | yes | Datasource the run was scoped to. |
| `datasets` | string[] | yes | Names of the datasets bound to that datasource at start; for a command-line run, the datasets `EVAL_DATASETS` names (agents-evals R223). |
| `caseIds` | string[] | yes | Ids of the questions the run covers. |
| `status` | enum | yes | `running` \| `completed` \| `failed`. A backend crash leaves `running` on disk (nothing reconciles it). |
| `results` | `AssistantEvalCaseResult[]` | yes | Finished questions in order. |
| `totalCases` | number | yes | |
| `currentQuestion` | string | no | Question being run; removed when the run ends. |
| `currentAttempt` | number | no | The attempt of `currentQuestion` in flight, 1 to `repeats` (agents-evals R210); removed when the run ends. Since BA-242. |
| `error` | string | no | Set when `status = failed`. |
| `startedAt` | ISO | yes | Sort key (desc) for listings. |
| `finishedAt` | ISO | no | Set when the run ends. |
| `comparison` | `EvalRegressionSummary` | no | Set when a run completes and a previous completed run with the same agent, `datasourceId` and the same set of datasets (order-insensitive) exists. Absent on older records and when no comparable run exists. |
| `judge` | `{ mode: 'off' \| 'on' \| 'categories'; categories?: string[] }` | no | The run's judge option ([agents-evals](../capabilities/agents-evals/spec.md) R144); `categories` only with mode `categories`, in category-list order. Written on every run since BA-184; absent on older records, which read as `{ mode: 'on' }`. |
| `summary` | `EvalRunSummary` | no | The counts of the finished results (R148), rewritten with the run after every question. Written since BA-184; recomputed from `results` whenever a run is read, so older records get one too. |
| `repeats` | `1` \| `3` \| `5` | no | Attempts per question (agents-evals R209). Written since BA-242; absent on older records, which read as `1`. |
| `model` | string | no | The router id of the model the evaluated agent ran on, resolved when the run starts (`openai/gpt-4o-mini`; R219). Since BA-242. |
| `usage` | `ModelUsageEntry[]` | no | The sum of the results' `usage`, by agent and model (R219). Written from the start of every run since BA-242, empty until a question finishes; absent on older records, whose tokens are not recorded. |
| `costUsd` | number \| null | no | The sum of the results' cost in US dollars, to six decimals, `0` at the start; `null` when not priced (R221). Since BA-242; absent on older records. |
| `rates` | `Record<string, ModelRate>` | no | The rates, from the price table (4.11), of the models in `usage` that have one, keyed by the model id as in `usage`: the snapshot the run's cost was computed with (R220). Since BA-242. |
| `source` | `app` \| `cli` | no | Where the run was started: the Evals tab or the command line (R223). Since BA-242; absent on older records, which read as `app`. |
| `ownerId` | string | no | Legacy and inert: `local` or absent (section 3.14). |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

`AssistantEvalCaseResult`: `id` (string, case id), `question` (string), `category` (string, no; the case's category, section 4.9; absent before BA-184 and on a case defined in code, such as every `rfp` case), `split` (`dev` \| `held-out`, no; the case's split, `dev` for a case defined in code; R215; absent before BA-242), `scores` (map<string, number 0..1>, per scorer id; empty when the run threw), `checkResults` (`EvalCheckResult[]`), `answer` (string), `toolCalls` (`EvalToolCall[]`), `status` (`passed` \| `failed` \| `not-scored`; R147, over all attempts R211; absent before BA-184), `passed` (boolean; `status` is `passed`, which before BA-184 meant every scorer scored 1), `error` (string, no; agent run failure), `durationMs` (number), `passes` (number, no; the attempts that passed), `runs` (number, no; the attempts, the run's `repeats`), `flaky` (boolean, no; some attempts passed and some failed), `attempts` (`EvalAttempt[]`, no; every attempt in order, only when `runs` is above 1), `usage` (`ModelUsageEntry[]`, no; the sum over its attempts), `costUsd` (number \| null, no; the sum over its attempts, `null` when not priced). `passes`, `runs`, `flaky`, `usage` and `costUsd` are written since BA-242. With `runs` above 1, `scores`, `checkResults`, `answer`, `toolCalls`, `error` and `durationMs` are those of the representative attempt: the first failed attempt, else the first (R211).
`EvalAttempt`: `attempt` (number, 1-based), `status`, `passed`, `scores`, `checkResults`, `answer`, `toolCalls`, `error` (no), `durationMs`, as on a result, and `usage` (`ModelUsageEntry[]`) and `costUsd` (number \| null) of that attempt alone. Its tool calls are truncated as a result's are.
`ModelUsageEntry`: `agent` (`assistant` \| `sql-fixer` \| `designer` \| `judge`; `assistant` is the agent the run evaluates), `model` (string; the model id without its provider prefix, lower case, `unknown` when the caller could not tell), `inputTokens`, `cachedInputTokens` (part of `inputTokens`), `outputTokens`, `reasoningTokens` (part of `outputTokens`), `calls` (calls that reported tokens), `unreportedCalls` (calls that reported none, whose tokens are unknown), all numbers. A list holds one entry per agent and model, in the order `assistant`, `sql-fixer`, `designer`, `judge`. Rules: agents-evals R219 to R221.
`ModelRate`: `inputPerMillionUsd`, `cachedInputPerMillionUsd` (no), `outputPerMillionUsd` (numbers, US dollars per million tokens), `source`, `readOn` (strings, no); as in the price table (4.11).
`EvalCheckResult`: `id`, `description` (string), `score` (number), `passed` (boolean), `reason` (string, no), `status` (`passed` \| `failed` \| `not-scored`; R146; absent before BA-184), `criterion` (string, no; a criterion id of section 4.9, R146).
`EvalRunSummary`: `passed`, `failed`, `notScored`, `flaky` (numbers of questions); `bySplit` (`{ dev: EvalSplitSummary, heldOut: EvalSplitSummary }`); `byCategory` (`{ category, passed, failed, notScored, flaky, total, dev: EvalSplitSummary, heldOut: EvalSplitSummary }[]`, category-list order, then others, `uncategorised` last); `byCriterion` (`{ criterion, passed, failed, total }[]`, D, G, I, C order, counting scored checks with a criterion over every attempt). `EvalSplitSummary`: `passed`, `failed`, `notScored`, `flaky`, `total` (numbers of questions) and `interval` (`{ low, high }`, numbers from 0 to 1, no; Wilson's 95% interval of `passed` over `passed + failed`, absent when that is 0). Rules: R148, R212, R213. `flaky`, `bySplit` and the split counts per category since BA-242.
**Read-time defaults, no migration (BA-184).** A record saved before BA-184 is not rewritten. When read, a missing `judge` is `{ mode: 'on' }`; a result or check without `status` takes `passed` when its `passed` flag is true, else `failed`; a result without `category` counts under `uncategorised`; and `summary` is computed from `results`. The next save of a running run writes the new fields.
**Read-time defaults, no migration (BA-242).** A record saved before BA-242 is not rewritten either. When read, a missing `repeats` is `1` and a missing `source` is `app`; a result without `split` takes the split of the question bank case with its id (the case index, `backend/src/mastra/evals/eval-case-index.ts`), else `dev`; a result without `runs` is one attempt (`runs` 1, `passes` 1 when its status is `passed`, else 0, `flaky` false) and, like any result without `attempts`, is its own one attempt; a run or result without `usage` has no tokens or cost recorded (agents-evals R218). Its `category` stays as above: the case index fills it only in the loop tools (R224).
`EvalToolCall`: `name` (string), `input`, `output` (strings, no; JSON-encoded, each truncated to 2000 chars with a trailing `… (truncated)`), `error` (string, no).
`EvalRegressionSummary`: `previousRunId` (string), `regressions`, `improvements`, `unchanged` (each `{id: string, question: string}[]`); cases present in only one of the two runs are skipped; regression = passed before, fails now; improvement = the reverse.

### 3.9 `knowledge_snippets`

Curated business-glossary terms, standing instructions and default filters injected into the assistant's context. (The table name is `knowledge_snippets`; the store token is `knowledge`.)

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | uuid | yes | |
| `kind` | enum | yes | `instruction` \| `term` \| `default_filter`. |
| `scope` | object or `null` | yes | `null` = global. Else `{datasetId?: string, datasourceId?: string}` with at least one set (empty/blank values normalise to `null`). `datasetId` is a dataset **name**. Injection currently honours only `datasetId`. |
| `title` | string | yes | Term name for `term`, short label otherwise. Trimmed, non-empty. |
| `body` | string | yes | Definition / instruction / SQL expression plus when to apply it. Trimmed, non-empty. |
| `synonyms` | string[] | no | Trimmed, non-blank; omitted on create when empty (an update may store `[]`). |
| `entities` | string[] | no | Fully-qualified bindings `catalog.schema.table`; same omission rule. |
| `enabled` | boolean | yes | Only enabled snippets are injected. Default `true` on user create. |
| `source` | enum | yes | `user` (created through the API) \| `mined` (drafted by the bootstrap agent). |
| `ownerId` | string | no | Legacy and inert: `local` or absent (section 3.14). |
| `createdAt`, `updatedAt` | ISO | yes | Both set by the service at insert, then store-maintained. |

Bootstrap-created snippets are always `{source: "mined", enabled: false, scope: {datasetId: <dataset name>}}`, capped at the agent's draft limit, and a draft whose case-insensitive trimmed title already exists in that dataset's scope is skipped.

`KnowledgeUse` (embedded in messages, not a collection): `id`, `kind`, `title`, `body` (exactly as it appeared in the block), `datasetId` (string, no; absent for a global snippet). Context assembly: enabled snippets whose scope is global or whose `datasetId` is among the session's datasets, ordered dataset-scoped before global then `updatedAt` desc, accumulated into a 7,000-character block (2,000 until 2026-10-21) until the next entry would not fit; only those that fit are recorded as `knowledge`.

### 3.10 `agents` — user agents

User-built agents: a stored configuration of the assistant, with a working draft and an optional published (Live) version. Built-in agents are not stored here. Rules: [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md) (R43-R52); decision: ADR-0008 in [architecture.md](architecture.md).

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | uuid | yes | |
| `draft` | `AgentConfig` | yes | The working copy. Always present. |
| `live` | `AgentConfig` | no | The published copy. Absent until the first publish. |
| `publishedAt` | ISO | no | Set at each publish. |
| `pinned` | boolean | yes | `false` on create. |
| `liveSkills` | `SkillCopy[]` | no | Copies of the skills the Live version names, taken at each publish, in the order of `live.skills`: `{ id, name, description, body, files }` as in 3.10.1. A Live agent runs on these copies, never on the current skills (ADR-0022). Keeps only the ids that still have a skill to copy, so it is `[]` after a republish that drops every skill. Absent until a publish whose Live version names a skill. |
| `ownerId` | string | no | Legacy and inert: `local` or absent (section 3.14). |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

`AgentConfig` (embedded, not a collection):

| Field | Type | Req | Meaning |
|---|---|---|---|
| `name` | string | yes | Trimmed, 1 to 64 characters, unique among the user agents (case-insensitive). |
| `description` | string | yes | Up to 280 characters; may be empty. |
| `instructions` | string | yes | Up to 4,000 characters; may be empty. Stored as written, with links `[[skill:<name>]]` and `[[tool:<name>]]` (R81 of the agents spec; resolved to plain mentions only when the model sees them, [agents.md](agents.md) 4.1). |
| `datasets` | string[] | yes | Dataset **names**; de-duplicated. At least one to publish. |
| `starterQuestions` | string[] | yes | Up to 5, each up to 200 characters; blank ones dropped, de-duplicated. |
| `model` | string | no | A model or deployment name of the configured provider. |
| `reasoningEffort` | enum | no | `low` \| `medium` \| `high`. |
| `skills` | string[] | no | Ids of the in-app skills (3.10.1) that `instructions` link (links to built-in on-demand skills are ignored: they are not stored and not counted), at most 10, de-duplicated, in the order of the links. **Derived from the links on every create and draft save** (ADR-0024); the request's own list is ignored. Absent means none. |
| `tools` | string[] | no | The optional tool groups the agent's `instructions` link directly: any of `sample_rows`, `ask_clarification` and `visuals` (`create_visual` with `update_visual`), de-duplicated and stored in that order. **Derived from the links on every create and draft save** (ADR-0024); the request's own list is ignored. Absent means all three (a draft saved before links); an empty list means none. The tools an agent gets at call time are this list plus the optional tools its linked skills' bodies link ([agents.md](agents.md) 2.1); that union is not stored. `list_entities`, `describe_entity` and `run_readonly_sql` are always given and never listed ([agents.md](agents.md) 2.1). No migration: a document without the field keeps every tool (ADR-0022); the editor adds links for it when opened (R85). |

Saving a draft replaces the whole `draft` object. Publishing sets `live` to a copy of `draft`. "Unpublished changes" is derived (`live` exists and differs from `draft`), not stored. When comparing, an absent `tools` list counts as all three tools, and an absent `skills` list as an empty one. The agent also has unpublished changes when a skill its draft names differs (name, description, body or files) from its copy in `liveSkills`, or has no copy there.

Deleting a skill, or renaming it, is refused while the `draft` of any agent links it by name (`"<name>" is linked by <agent names>. Unlink it first.`), so a draft's `skills` never holds an id without a skill. `live.skills` and `liveSkills` are untouched either way, so Live agents keep the copy they run on.


### 3.10.1 `skills` — in-app skills

Skills a user writes in the app and assigns to their agents (ADR-0022). They are text only and never run. Rules: [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md) R68-R74; how an agent's session reads them: [agents.md](agents.md) 7.3.

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | uuid | yes | |
| `name` | string | yes | Lowercase letters, digits and single hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`), at most 64 characters. Unique among the skills, and never the name of a built-in skill. |
| `description` | string | yes | Starts with `Use when`; at most 300 characters. It is the skill's catalog entry, the text the model decides by. |
| `body` | string | yes | Not empty; at most 20,000 characters. May link tools with `[[tool:<name>]]`, never skills (ADR-0024); nothing extra is stored, the tools a skill links are read from its body. |
| `files` | `{ path, content }[]` | yes | Reference files, at most 10. `path` is `references/<file name>`, the file name matching `^[A-Za-z0-9][A-Za-z0-9._-]*$` and at most 100 characters; paths are unique. `content` is at most 20,000 characters. Every `references/…` path the body names is one of them. May be empty. |
| `ownerId` | string | yes | Always `local`; inert (3.14). |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

`SkillCopy` (embedded in `agents.liveSkills`, not a collection) is `{ id, name, description, body, files }`, the skill as it was when the agent was published.

### 3.10.2 `skill_overrides` — built-in skills edited in the app

One document per overridden built-in skill, (ADR-0023). Rules: [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md) R75-R80; resolution: [agents.md](agents.md) 7.3.

| Field | Type | Req | Meaning |
|---|---|---|---|
| `name` | string | yes | The built-in skill's name; the identity. An override of a name that is no longer built in is ignored. |
| `description` | string | yes | Starts with `Use when`; at most 300 characters. |
| `body` | string | yes | Not empty; at most 20,000 characters. |
| `files` | `{ path, content }[]` | yes | Exactly the built-in's `phases/` and `reference/` files, same paths, each `content` at most 20,000 characters and with the same `{{placeholders}}` as the built-in's file; stored in the built-in's file order. |
| `baseHash` | string | yes | SHA-256 (hex) of the built-in it was saved against: of `JSON.stringify([description, body, [[path, content], …]])`, the files sorted by path. A different hash for the shipped built-in means the built-in changed since. |
| `updatedBy` | string | yes | Always `local` (the built-in super admin; kept for documents stored earlier). |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

### 3.10.3 `agent_prompt_overrides` — built-in agents' system prompts edited in the app

One document per built-in agent whose system prompt was edited, (ADR-0026). Rules: [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md) R97-R104; resolution: [agents.md](agents.md) 1.1 and 2.1-2.6.

| Field | Type | Req | Meaning |
|---|---|---|---|
| `key` | string | yes | The built-in agent's registry key (`assistant`, `rfp`, `visualization`, `sql-fixer`, `sql-verifier`, `knowledge-bootstrap`, `assistant-eval-judge`); the identity. An override of a key that is no longer built in is ignored. |
| `prompt` | string | yes | Not empty; at most 20,000 characters. For the `assistant` and `rfp` it is the editable text, without the generated `## Tools` section ([agents.md](agents.md) 2.1, 2.8); an `rfp` prompt must start with `You are the RFP Builder`. |
| `baseHash` | string | yes | SHA-256 (hex) of the shipped editable text the override was saved against. A different hash for the shipped text means the built-in changed since. |
| `updatedBy` | string | yes | Always `local` (the built-in super admin; kept for documents stored earlier). |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

### 3.11 Deep-analysis jobs (not persisted)

Deep-analysis jobs exist only in process memory (bounded history; a backend restart forgets them). Persisted outputs are the report file (`workspaces/session-<id>/reports/<jobId>.md`, section 4.5) and the assistant message carrying `report` (3.4.1). For completeness the in-memory job shape is: `id`, `sessionId`, `question`, `status` (`planning` \| `investigating` \| `writing` \| `done` \| `error`), `progress?`, `step?`, `steps?`, `title?`, `path?`, `error?`, `startedAt`, `finishedAt?`. The planner output schema is `{title: string, angles: [{title, question}] (3..5 intended, min 1)}` and the writer output `{title, executiveSummary, report}`; see [../capabilities/deep-analysis/spec.md](../capabilities/deep-analysis/spec.md) and [agents.md](agents.md).

### 3.12 Other non-persisted data

- REST datasource queries are executed by materialising the referenced endpoints into a throwaway in-memory SQLite database per call; nothing of it is written to disk.
- Eval runs also keep an in-memory map for in-flight runs (section 3.8 is the durable copy).
- **Preview sessions** (agents-evals R60, R61) live only in the backend's memory: a `SessionDoc`-shaped object with `id` `preview-<uuid>`, `preview: true` and `agentId`, never written to `sessions`. While one exists its agent memory thread (id = the session id) and its workspace `workspaces/session-preview-<uuid>/` exist like a session's (sections 4 and 5). Discarding the preview deletes all three. A backend restart forgets the in-memory object, and at start-up the backend deletes every `session-preview-*` workspace and the matching memory thread, so a crash leaves nothing behind.

### 3.13 Relationships and referential rules

| From | Field | To | Rule |
|---|---|---|---|
| `datasets` | `datasourceId` | `connections.id` | By value, no cascade. Deleting a datasource leaves its datasets (they then fail at use). |
| `sessions` | `datasets[]` | `datasets.name` | By name. Deleting or renaming a dataset leaves sessions pointing at a missing name. |
| `knowledge_snippets` | `scope.datasetId` | `datasets.name` | By name, no cascade. |
| `datasource_inventories` | `id` | `connections.id` | 1:1; deleted explicitly with the datasource. |
| `verified_queries` | `sourceSessionId`+`sourceMessageAt` | `sessions.id` + message `at` | No cascade on session deletion; removed explicitly on thumbs-down. |
| `metrics` | `datasourceId`, `sourceVerifiedQueryId` | `connections.id`, `verified_queries.id` | Provenance only, may dangle (a verified query id also rotates on re-approval). |
| `eval_runs` | `datasourceId`, `datasets[]` | `connections.id`, `datasets.name` | Scope snapshot, may dangle. |
| `agents` | `draft.datasets[]`, `live.datasets[]` | `datasets.name` | By name, no cascade. May dangle; the hub flags the agent as having a missing dataset. |
| `sessions` | `agentId` | `agents.id` | By value, no cascade. Deleting the agent leaves the session pointing at a missing id; it then runs as the plain assistant and is shown with `agentName` (sessions-chat R59). |
| `sessions[].visualizations[]` | `id`, `path` | `workspaces/session-<id>/visuals/<id>/` | Files under the session workspace; both removed with the session. |
| `sessions[].messages[]` | `visual.visualId`, `report.jobId` | visual id / report file | By value. |
| session | `id` | agent memory thread id and resource id; workspace `session-<id>` | See section 5. |

---

### 3.14 Ownership (legacy `ownerId`)

The app is single-user (ADR-0030): one built-in super admin, id `local`, is always the caller, so nothing is scoped, filtered or checked by owner.

- `ownerId` stays on the documents of `sessions`, `verified_queries`, `metrics`, `eval_runs`, `knowledge_snippets`, `agents` and `skills` as an **inert legacy attribute**. Its only value is `local`: M14 (section 6) sets it on every existing document, and new documents are stamped `local` when created. No reader filters by it and no write depends on it.
- A document with no `ownerId` (written by code that predates the stamp) is read exactly like one with `local`.
- **Uniqueness** that was per owner (agent names, skill names, metric names, the verified-query key `(sourceSessionId, sourceMessageAt)`) is now unique across the collection; M14 renames clashing skills (`-2`, `-3`, …).
- No identity or access data is stored: the tables `users`, `groups`, `group_members`, `role_assignments`, `group_role_mappings`, `auth_sessions` and `activity_events` of earlier versions are dropped by M14.

## 4. Files on disk

Sections 4.1 to 4.7 are files the app writes; 4.9 and 4.11 are bundled, read-only assets that ship with the backend; 4.10 is the sample fixture data, of which only the seed SQL ships. All paths in 4.1 to 4.7 are relative to `<app data dir>/workspaces/session-<session-id>/` (the **session workspace**), a contained filesystem root: agents' file tools cannot escape it and the file-delete tool is disabled for them (they may create and edit). The session id used in a directory name must match `^[a-zA-Z0-9_-]+$` (otherwise the operation fails with `Invalid session workspace ID`).

### 4.1 Workspace layout

```
workspaces/
  session-<session-id>/
    visuals/
      <visual-id>/                 one directory per visual
        v1/                        version directories (4.2)
        v2/
        ...
    reports/
      <job-id>.md                  deep-analysis reports (4.5)
    rfp/
      <rfp-id>/                    one RFP package per RFP (RFP Builder sessions only)
        rfp.md                     the RFP document (Markdown)
        rfp.pdf                    the same document as PDF
        exhibits/
          exhibit-a-census.csv
          exhibit-b-plan-designs.csv
          exhibit-c-financials.csv
          exhibit-d-carriers.csv
        manifest.json              { rfpId, title, generatedAt, files[] }
        draft/                     a DRAFT package (export_rfp_draft), same layout, manifest adds draft: true and stage
```

The `rfp/<rfp-id>/` folder is the unzipped `GET /v1/rfps/:id/package.zip` of the Intellify RFP API ([api.md](api.md) 2.16.5), written by `export_rfp_package` ([agents.md](agents.md) 3.10) and referenced by the answer's `rfpPackage` (3.4.1). Re-exporting the same RFP overwrites the folder (not `draft/`, which holds the latest draft, written by `export_rfp_draft` and replaced by the next draft; neither export touches the other): the record in the `rfp` schema (section 7) is the source of truth. Served by [api.md](api.md) #105; deleted with the workspace.

The workspace directory is created with the session (`createSessionWorkspace`) and registered with the agent framework under id `session-<session-id>` (display name `<session name> Workspace`, no skills; 4.6). At backend start, and whenever the `workspaces/` directory changes, every `session-*` directory on disk is (re)registered, so workspaces survive restarts and are visible to a second framework process (the dev studio). Directories not starting with `session-` are ignored.

### 4.2 Visual version directory

A visual's files for version N live in `visuals/<visual-id>/v<N>/` (N starts at 1). Every version is written in full; versions are immutable except that a *refresh* rewrites `data.json` and `index.html` of the current version in place.

| File | Written for | Content |
|---|---|---|
| `index.html` | every version | The complete, standalone, readable document: HTML5 with a restrictive `Content-Security-Policy` meta (`default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'`), the fixed frame styles, the visual's stylesheet scoped to the visual's subtree, then the fixed frame (title, question, the visual, takeaway, analysis, collapsible data provenance, footer) and **all scripts inlined**: an inert data block with the chart rows (`window.qti.data`), for spec visuals an inert `<script id="qti-spec">` JSON block, the frame bridge, then either the chart runtime plus the bootstrap (spec) or the designer's script (freeform). Inlined (not linked) so it renders when opened from `file://`. Regenerated from the bundle and context at write/refresh/download. |
| `body.html` | every version | The visual's body HTML fragment only (what the designer produced; for spec visuals the synthetic `<div id="qti-chart-root"></div>`), stored so loading never re-parses `index.html`. Missing on pre-versioning visuals (extracted from `index.html` between `<body>` and the first `<script src=` instead). |
| `styles.css` | every version | The designer's CSS (empty string for spec visuals). Page-level selectors in it are rewritten to the visual's scope at render time. |
| `script.js` | every version | The designer's JavaScript (freeform), or the one-line bootstrap `window.qtiChart.mount();` for spec visuals. Parse-checked (compile only) before being written. |
| `qti-frame.js` | every version | The frame bridge source (`window.qti.select` plus click delegation on `data-qti-value`); an editable copy of what `index.html` inlines. Always the current fixed script. |
| `description.md` | every version | `# <title>`, blank line, the takeaway text, newline. |
| `manifest.json` | every version | JSON, 2-space indent, see 4.3. |
| `answer.md` | when the source answer exists | Markdown: `# <title>`; `**Question:** …` when known; `## Takeaway` + description; `## Analysis` + the assistant answer; `## How this was worked out` (numbered reasoning steps with `(<n> rows)` / `(failed — <error>)`); `## Data used` (numbered records with tool, row count or `failed`, and the SQL in a ```sql fence); a final `---` line with `Session: <name> · Version <N> · Generated <ISO>`. |
| `data.json` | when there is at least one data record | `ToolDataRecord[]` (3.4.2) pretty-printed (2-space): the result sets the visual renders from. Newly created versions merge the turn's freshly captured records onto the source answer's `data` (deduped by SQL text, fresh wins); a tailoring turn merges onto the current version's stored `data.json` (falling back to the answer's `data`). A refresh replaces it (re-running each successful `run_readonly_sql` statement with a 500-row ceiling, keeping 200 rows per record; records that cannot be re-run keep their rows, and a failing query stores its `error`; an unresolvable or ambiguous datasource stores an error per query). |
| `spec.json` | spec visuals only | The visual spec (4.4), pretty-printed. The source of truth for a spec visual; `body.html`, `styles.css` and `script.js` are synthetic there. Its presence (and validity) is what makes a version a spec visual. |
| `qti-chart.js` | spec visuals only | The fixed chart runtime source (a self-contained browser script exposing `window.qtiChart.mount()`), an editable copy of what `index.html` inlines. |

The downloadable archive of a version is a ZIP (named `<slug of title, ≤64 chars, [a-z0-9-]>-v<N>.zip`, or `visual-<first 8 of id>-v<N>.zip`) containing a freshly assembled `index.html`, `styles.css`, `qti-frame.js`, `script.js`, plus `spec.json` and `qti-chart.js` (spec visuals), `answer.md` (when an answer exists) and `data.json` (when data exists); entries are timestamped with the visual's `createdAt`. Contract in [api.md](api.md).

### 4.3 `manifest.json`

A snapshot of the session metadata at the time the version was written, plus renderer info. The session document (3.4.3), not the manifest, is authoritative for version history; the manifest is read only for `title`/`description` of that version.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Visual id. |
| `title` | string | Title of **this** version. |
| `description` | string | Takeaway of **this** version. |
| `path` | string | `visuals/<id>`. |
| `sourceMessageAt` | ISO | |
| `createdAt` | ISO | Visual creation time. |
| `currentVersion` | number | The visual's current version **at write time** (equals `version` for a freshly written version). |
| `versions` | `VisualizationVersion[]` | History up to and including this version, at write time. |
| `version` | number | The version this directory holds. |
| `renderer` | enum | `spec` \| `freeform`. |

### 4.4 Visual spec (`spec.json`, schema v1)

The designer agent emits this small JSON document instead of code; a fixed runtime renders it. Validation is two-stage: the **schema** below, then **data validation** against the exact result sets the visual will render (any problem is fed back to the designer as a retry instruction; after 2 failed spec attempts, or when there are no rows, the freeform pipeline takes over).

Top level `VisualSpec`:

| Field | Type | Req | Constraint / meaning |
|---|---|---|---|
| `spec` | number | yes | Literal `1`. |
| `kpis` | `KpiSpec[]` | no | At most 4. |
| `chart` | `ChartSpec` | yes | |
| `table` | `TableSpec` | no | Companion data table. |

`select` (used by kpis, chart and table): `string[]`, 1..20 column names, each 1..128 chars. **Semantics:** the part reads the FIRST data record (in `data.json` order) whose columns contain every listed name (a record's columns are its `columns` list, else the keys of its first row). Validation and runtime use the same rule.

`KpiSpec`:

| Field | Type | Req | Constraint / meaning |
|---|---|---|---|
| `label` | string | yes | 1..120 chars, tile label. |
| `select` | string[] | yes | As above. |
| `column` | string | yes | Column the value is computed from (1..128 chars). |
| `agg` | enum | yes | `sum` \| `avg` \| `min` \| `max` \| `count` \| `value`. |
| `format` | enum | no | `number` \| `compact` \| `percent` \| `currency`. |
| `unit` | string | no | ≤16 chars, short suffix such as `%`. |

`ChartSpec`:

| Field | Type | Req | Constraint / meaning |
|---|---|---|---|
| `form` | enum | yes | `bar` \| `line` \| `scatter` \| `heatmap` \| `metric-cards` \| `table` \| `donut`. |
| `select` | string[] | yes | As above. |
| `x` | string or `null` | no | Category / time axis column (1..128 chars). `null` is accepted and treated as absent. Required for `bar`, `line`, `scatter`, `heatmap`, `donut`; for `scatter` it must be numeric. |
| `y` | string, or string[] (1..8), or `null` | no | Measure column(s); `null` = absent. Required for `bar`, `line`, `scatter`, `heatmap`, `donut`; must be numeric-ish in the sampled rows. |
| `series` | string or `null` | no | Column that splits the data into series. Required for `heatmap` (its second axis). |
| `sort` | object | no | `{by, dir}`: `by` is `"x"`, `"y"` or a column name (the x column resolves to `"x"`, a plotted measure to `"y"`; anything else is a data-validation problem), `dir` is `asc` \| `desc`. A malformed `sort` (including `null`) is silently dropped rather than failing the spec. |
| `topN` | integer | no | 1..200. |
| `stacked` | boolean | no | |
| `labels` | boolean | no | Draw value labels on marks. |
| `format` | object | no | `{y?: number \| compact \| percent \| currency \| null}`; `null` = default. |
| `xLabel`, `yLabel` | string | no | ≤120 chars each. |

After parsing, `null`s are folded to absent and `sort.by` is resolved as above, so stored `spec.json` files never contain `null` for `x`/`y`/`series`.

`TableSpec`: `select` (string[], as above, req), `columns` (string[] 1..40 names, or `null` meaning every column; stored as absent), `collapsed` (boolean, no; start collapsed).

Data validation (plain-language problems, empty = renderable): each `select` must match a record; every referenced column (`x`, each `y`, `series`, `kpis[].column`, `table.columns`) must exist in the selected record; `y` measures, a scatter `x`, and KPI columns (except `agg = count`) must be numeric over the first 50 rows, where numeric allows the coercions the runtime applies (strings like `"1,204"`, `"$4"`, `"12%"`; booleans are not numeric; blanks ignored); the x/y/series requirements per form above; an unresolvable `sort.by`.

A spec visual's synthetic bundle is: body `<div id="qti-chart-root"></div>`, empty CSS, script `window.qtiChart.mount();`; the spec is inlined in `index.html` in an inert `<script id="qti-spec" type=…>` JSON block and the runtime renders into `#qti-chart-root`.

### 4.5 Reports

`reports/<job-id>.md` — one Markdown file per finished deep-analysis job (`job-id` matches `^[a-zA-Z0-9-]+$`). Structure assembled by the app, not the model: `# <title>`; `**Question:** <question>`; a line `Deep analysis · session: <name> · <n> angle(s) · generated <ISO>`; `## Executive summary` + summary; the model-written body (starting `## Findings by angle`); `## Data appendix` with, per angle, `### <i>. <angle title>`, the angle question, and each SQL statement in a ```sql fence (or `_No SQL was recorded for this angle._`); then `---` and `Report <job-id>`. Downloaded as `<slug of title, ≤64>.md` (or `deep-analysis-<first 8 of id>.md`).

### 4.6 No skills in workspaces

Workspaces hold no skills. Skills ship with the backend build and each agent declares its own ([agents.md](agents.md) sections 7.3 and 7.4). Until version 0.31, every workspace got a copy of the `interactive-visuals` skill at `.agents/skills/interactive-visuals/SKILL.md`, and the framework discovered skills there. Those copies are left on disk untouched and are never read, so no migration is needed.

### 4.7 Legacy visual layout

Visuals created before versioning keep their **v1 files directly under `visuals/<id>/`** (no `v1/` directory) and have no `versions`/`currentVersion` in the session metadata. Rules readers must apply:

- A visual with no `versions` and version ≤ 1 resolves to `visuals/<id>/`.
- Once such a visual gains version 2, `versions` is materialised as `[{version: 1, createdAt: visual.createdAt, sourceMessageAt: visual.sourceMessageAt}, {version: 2, …}]` and v2 is written to `visuals/<id>/v2/`; for version 1 the reader prefers `visuals/<id>/v1/index.html` and falls back to the root when it does not exist.
- Legacy versions may lack `body.html`, `manifest.json`, `data.json`, `answer.md`, `spec.json`; each reader has a fallback (extract the body from `index.html`, use the session metadata for title/description, use the source answer's `data`). Downloads always regenerate `index.html` so old versions ship with the readable frame.

### 4.8 Old user skill folder

Version 0.32 also read skills from `<APP_DATA_DIR>/skills/<name>/` (user level) and from the folder `QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR` named (project level), under ADR-0019. Since ADR-0021 skills ship only with the backend build ([agents.md](agents.md) 7.3). A `skills/` folder left in the app data dir is ignored: the app never reads, writes or deletes it, so no migration is needed.

### 4.9 Eval question bank files (bundled, read-only)

The assistant's eval sets are data files that ship with the backend, not files in the app data directory: the app reads them at startup and never writes them. One JSON file per question bank in `backend/src/mastra/evals/sets/`, copied into `dist` next to the compiled loader ([delivery.md](delivery.md)). Today, in this order, which is the order of the sets in the Evals tab: `world-cup.json` (its last 11 cases the former golden set, [agents-evals](../capabilities/agents-evals/spec.md) R109), `formula-1.json`, `world-cup-rest-connector.json` (REST-only, BA-187), `world-cup-databricks-only.json` (Databricks-only, BA-186), then the synthetic domains of BA-185, `finance.json`, `health-insurance.json`, `genomics.json`, `supply-chain.json` and `marketing-analytics.json`. The samples those sets question, their generators, planted facts and JSON dumps: section 4.10. Rules (variant expansion, the loader's refusals, the former golden set, the validator, the domain sets' held-out split): [agents-evals](../capabilities/agents-evals/spec.md) R107-R111 and R134; the deterministic checks and their criteria: R112-R126; how a case is scored: [agents.md](agents.md) section 8; decision: ADR-0015 in [architecture.md](architecture.md). The questions themselves are a data asset copied verbatim on rebuild (*Data assets* in [../README.md](../README.md)).

A file is `{ variants: Variant[], cases: Case[] }`, both non-empty. At every level (file, variant, case, check, `args`, `resultSetOptions`) a field not listed below is refused, and every string listed is non-empty. Variant and case ids are lowercase words joined by hyphens (`champion-2022`).

`Variant` (each becomes one eval set):

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | The set id (`world-cup`). Unique across all files. |
| `name` | string | yes | Shown in the Evals tab ("World Cup"). |
| `description` | string | yes | What the set covers and what it needs to run, shown with the set. |
| `fixtureId` | string | yes | The sample fixture the set runs on: a `SampleFixture.id` in the fixture registry ([testing-data](../capabilities/testing-data/spec.md) R1). Its required entities drive the dataset preflight. |
| `dialect` | `postgres` \| `sqlite` \| `databricks` | yes | Which of each case's reference queries the set uses. It must be the dialect of the fixture's datasource kind: `postgres` for PostgreSQL, `sqlite` for REST (the REST connector's engine, which reads endpoints as `api.<schema>.<table>`), `databricks` for Databricks (`<catalog>.<schema>.<table>`). |
| `caseIdPrefix` | string | yes | Put before every case id of the file to make the set's case ids: `""`, which keeps the file's ids, or lowercase words each followed by a hyphen (`rest-`). Missing or malformed: `"caseIdPrefix" is required: "" or lowercase words each followed by a hyphen (e.g. "rest-")`. |

Variants of one bank are named by datasource kind ([agents-evals](../capabilities/agents-evals/spec.md) R207): the PostgreSQL variant takes the bank's id with no prefix, the REST variant `<bank>-rest` with the prefix `rest-` and the dialect `sqlite`, the Databricks variant `<bank>-databricks` with the prefix `dbx-` and the dialect `databricks`. How each dialect's reference names its tables (`api.<schema>.<table>`, `` `evals`.<schema>.<table> ``) and what it may not use: agents-evals R205 and R206.

`Case`:

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | Unique in the file; with the variant's prefix, unique across all sets. |
| `category` | string | yes | One of `lookup`, `aggregate`, `join`, `ranking`, `ratio`, `null`, `encoding`, `reasoning`, `discovery`, `ambiguous`, `fuzzy-scope`, `out-of-scope`, `non-existent`, `business-term`, `default-filter`, `visual`, `follow-up`, `paraphrase`. Defined in [the BA-9 research, section 2.6](../../docs/research/BA-9.md#26-categories-of-the-golden-dataset). |
| `split` | `dev` \| `held-out` | no | Default `dev`. |
| `tags` | string[] | no | Additive kind-specific tags, such as `rest:paging` or `dbx:dialect` (same research section). Default `[]`. |
| `question` | string | yes | Sent verbatim as the user message. |
| `intent` | string | yes | What the question probes, shown in the Evals tab and the Details panel. |
| `notes` | string | no | The trap the case guards and how its expected answer was checked, for people. Never graded, not shown in the app. |
| `agentTools` | string[] | no | The tool selection the case runs with, as a session bound to a user agent with that selection would ([agents.md](agents.md) 2.1, 4.2): ids from `sample_rows`, `ask_clarification`, `visuals`, each at most once, kept in the order written and the same in every variant; `[]` keeps only the always-on tools. Absent: every tool. Refused with `Eval set file <file>, case "<id>": "agentTools" must be an array of tool ids (sample_rows, ask_clarification, visuals); leave it out for every tool` when it is not an array, `Eval set file <file>, case "<id>": agentTools has an unknown tool "<value>"; known: sample_rows, ask_clarification, visuals` for any other id (the value JSON-encoded), and `Eval set file <file>, case "<id>": agentTools lists "<tool>" twice` for a repeat. |
| `checks` | `Check[]` | yes | Non-empty. The scorer checks (below). Each check type at most once per case. |
| `expectedSql` | `{ postgres?, sqlite?, databricks? }` (strings) | no | One reference query per dialect, at least one. When present it must hold a query for every dialect the file's variants use (agents-evals R108): a reference for every dialect or none. Absent: the case has no result-set match. |
| `resultSetOptions` | `{ distinctRows?: boolean }` | no | `distinctRows`: compare at the reference grain, so repeated identical rows are harmless (agents-evals R31). |
| `judgeRubric` | string | no | Rubric for the LLM judge (agents.md 2.6); absent: no judge check. The judge runs only when the run's judge option allows it, and its check is otherwise not scored; its criterion follows the case's category ([agents-evals](../capabilities/agents-evals/spec.md) R145, R146). |

`Check` = `{ type, args?, criterion? }`:

- `type`: one of the check types in the table below. Any other value is refused.
- `args`: as the table says for the type. A pattern (`matches`, `sqlMatches`, `notMatches`) is a JavaScript regular expression source with its `flags`: no `g` or `y`, which make a match stateful, and the pattern must compile. A list (`tools`, `nouns`, `ignore`, `keywords`, `entities`) is a non-empty array of non-empty strings. A type with no arguments takes no `args`, or an empty object.
- `criterion`: optional; the id of the criterion the check measures, from [the research's criteria list](../../docs/research/BA-9.md#25-the-criteria-list-for-this-app): `D1` to `D6`, `G1` to `G4`, `I1` to `I7` or `C1` to `C4`. Any other value is refused. Absent: the type's default criterion below, or none.

| `type` | `args` | Scorer id | Default criterion | What it asserts |
|---|---|---|---|---|
| `includes` | `{ text }` | `check-includes` | none | [agents.md](agents.md) 8.1 |
| `matches` | `{ pattern, flags? }` | `check-matches` | none | agents.md 8.1 |
| `calledTool` | `{ tool }` | `check-called-tool` | none | agents.md 8.1 |
| `didNotCall` | `{ tool }` | `check-did-not-call` | none | agents.md 8.1 |
| `toolOrder` | `{ tools }`, in call order | `check-tool-order` | none | agents.md 8.1 |
| `noToolErrors` | none | `check-no-tool-errors` | none | agents.md 8.1 |
| `noRepairs` | none | `check-no-repairs` | D3 | [agents-evals](../capabilities/agents-evals/spec.md) R113 |
| `namesNotIds` | `{ nouns? }`, the entity nouns (default `team`, `player`, `club`, `squad`, `driver`, `constructor`) | `check-names-not-ids` | I1 | agents-evals R114 |
| `numbersGrounded` | `{ ignore? }`, phrases removed from the answer before its numbers are read | `check-numbers-grounded` | G1 | agents-evals R115 |
| `rationaleOk` | none | `check-rationale-ok` | I3 | agents-evals R116 |
| `noHtml` | none | `check-no-html` | I4 | agents-evals R117 |
| `dialect` | none: the set's `dialect` | `check-dialect` | I6 | agents-evals R118 |
| `qualifiedNames` | none: the set's `dialect` | `check-qualified-names` | I6 | agents-evals R119 |
| `optionCount` | none | `check-option-count` | I5 | agents-evals R120 |
| `visualKeywords` | `{ keywords }` | `check-visual-keywords` | G4 | agents-evals R121 |
| `sqlMatches` | `{ pattern, flags? }` | `check-sql-matches` | none | agents-evals R122 |
| `notMatches` | `{ pattern, flags?, in? }`, `in` = `answer` (default) or `sql` | `check-not-matches` | none | agents-evals R123 |
| `usesEntities` | `{ entities? }`; absent: the tables the case's reference query reads, so the case then needs a reference | `check-uses-entities` | D2 | agents-evals R124 |

The result-set match and the LLM judge are not listed in `checks`: they follow from `expectedSql` and `judgeRubric`. In a run's results the result-set match measures `D1`, and the judge the criterion of the case's category (R146).

### 4.10 Sample fixture data: seeds, planted facts and dumps

The data behind the sample fixtures of [testing-data](../capabilities/testing-data/spec.md) R2. The app reads only the seed SQL, and only when the Testing Data loader seeds a sample; everything else is repository tooling.

| What | Where | Ships | Written by |
|---|---|---|---|
| Seed SQL | `backend/src/modules/testing-data/fixtures/`: `001_world_cup.sql` (27 KB), `002_formula_1.sql.gz` (5.2 MB), `003_intellify.sql.gz` (237 KB), `004_health_insurance.sql` (464 KB), `005_genomics.sql` (405 KB), `006_supply_chain.sql` (572 KB), `007_finance.sql` (1.1 MB), `008_marketing_analytics.sql` (663 KB) | yes, copied into `dist` by the `nest-cli.json` asset rule `modules/testing-data/fixtures/**/*.sql*` ([delivery.md](delivery.md)) | World Cup by hand, Formula 1 by `pg_dump`, Intellify by `scripts/generate-intellify-seed.py` ([testing-data](../capabilities/testing-data/spec.md) R4), `004` to `008` by the generators below |
| Generators | `docker/postgres/generate/<domain>.ts`, with the seeded random source `docker/postgres/generate/lib/rng.ts` | no | people; run with `npm run fixtures:<domain>` |
| Planted facts | `backend/scripts/fixtures/<domain>/facts.json`, for the domains written for BA-9 (finance, marketing analytics) | no | the domain's generator, with its seed |
| JSON dump | `backend/scripts/fixtures/<id>/data/<relation>.json.gz` and `_meta.json`, committed for finance and marketing analytics only | no | `npm run fixture:dump -- --fixture <id>` |

**Seed SQL of a generated domain.** One transaction (`BEGIN` … `COMMIT`) that creates schema `<schema>`, sets the search path to it, creates every table with identity keys, indexes and the views, inserts every row, and comments the columns whose meaning is not obvious (a test flag, a unit, a lookalike column). A generator draws every value from one seeded random source and never reads the clock, so a run writes a byte-identical file; it asserts every planted trap and writes nothing when one drifts. Each domain gets its own database, so none of them is a compose init script. `004` to `006` are byte-identical to the init scripts of `feat/engine-eval-loop`; `007_finance.sql` keeps that branch's banking rows unchanged, drawn from the banking seed, and adds the wealth tables from a second seed.

**Planted facts** (`facts.json`). A JSON object: `generator`, `seeds`, `asOf`, notes on the fiscal year and units, then the planted truths grouped by half of the domain and keyed by trap id (finance: `banking.B4_…` to `B11_…`, `wealth.W1_emptyMonth` to `W12_biggestClient`), each holding the value a reference query must return (amounts named `…Dollars` are in dollars, counts are plain numbers, names are strings). Agents-evals R134 checks references against it.

**JSON dump.** One file per required table and view of the sample, `<relation>.json.gz`: a compact JSON array of row objects, gzipped, ordered by the primary key (by every column for a view). The gzip header carries no timestamp, so a re-dump of unchanged data differs only in `dumpedAt`. NUMERIC, BIGINT and FLOAT values are JSON numbers (a BIGINT beyond 2^53 fails the dump), dates are `YYYY-MM-DD`, timestamps ISO 8601 UTC. `_meta.json` stays plain JSON: `{ dumpedAt, source, fixture, schema, format: "json.gz", tables: { <relation>: <row count> }, columns: { <relation>: [{ name, type, nullable }] } }`, the fields of `backend/scripts/worldcup-rest-api/data/_meta.json` with the fixture, schema, format and column types added. The World Cup REST dump keeps its own format (plain, indented `<relation>.json`). The dump is the one source of the REST server and the Databricks loader of BA-9 Steps 2 and 3, so a sample's rows are identical on every datasource kind (ADR-0015 in [architecture.md](architecture.md)). Only the samples that run on every datasource kind have their dump committed: finance (0.44 MB) and marketing analytics (0.16 MB), decided 2026-10-13. The other domain samples are dumped on demand.

### 4.11 Eval price table (bundled, read-only)

Added 2026-10-20 (BA-242). The prices an eval run's cost is computed with ([agents-evals](../capabilities/agents-evals/spec.md) R220, R221): one JSON file, `backend/src/mastra/evals/pricing.json`, imported by `eval-usage.ts` (`resolveJsonModule`) as the question bank files are by their loader, so `nest build` emits it into `dist/mastra/evals/` and the CLI, the npm package and the desktop app read it from there ([delivery.md](delivery.md)). The app never writes it.

```json
{
  "_comment": "…",
  "models": {
    "gpt-4o-mini": {
      "inputPerMillionUsd": 0.15,
      "cachedInputPerMillionUsd": 0.075,
      "outputPerMillionUsd": 0.6,
      "source": "developers.openai.com/api/docs/pricing",
      "readOn": "2026-10-20"
    },
    "gpt-5.6-luna": {
      "inputPerMillionUsd": 0.2,
      "cachedInputPerMillionUsd": 0.02,
      "outputPerMillionUsd": 1.2,
      "source": "developers.openai.com/api/docs/pricing (Standard, short context)",
      "readOn": "2026-10-21"
    },
    "gpt-4.1-mini": {
      "inputPerMillionUsd": 0.4,
      "cachedInputPerMillionUsd": 0.1,
      "outputPerMillionUsd": 1.6,
      "source": "developers.openai.com/api/docs/pricing (Standard)",
      "readOn": "2026-10-21"
    }
  }
}
```

| Field | Type | Req | Meaning |
|---|---|---|---|
| `_comment` | string | no | For people; ignored. |
| `models` | object | yes | One `ModelRate` (3.8) per model, keyed by the model id without its provider prefix, in lower case (`gpt-4o-mini`, never `openai/gpt-4o-mini`). |
| `models.<id>.inputPerMillionUsd` | number ≥ 0 | yes | US dollars per million input tokens. |
| `models.<id>.cachedInputPerMillionUsd` | number ≥ 0 | no | US dollars per million cached input tokens; absent: the input rate. |
| `models.<id>.outputPerMillionUsd` | number ≥ 0 | yes | US dollars per million output tokens (reasoning tokens included). |
| `models.<id>.source` | string | no | Where the rate was read. |
| `models.<id>.readOn` | string (`YYYY-MM-DD`) | no | The day it was read. |

Any other field, a key that is not a lower-case id without a `/`, or a rate that is not a number of 0 or more is refused when the backend starts, with `Price file pricing.json, model "<id>": <what is wrong>`. A model is looked up by its id without the provider prefix, ignoring case, and a dated snapshot (`gpt-4o-mini-2024-07-18`) with no entry of its own by the id without its date. A model with no entry makes a cost not priced; its tokens are still recorded. A price is changed by editing the file, with a new `source` and `readOn`, in a release: a run keeps the rates it was computed with (`rates`, 3.8), so an earlier run's cost does not change.

---

## 5. Agent memory

- Only the `assistant` agent has conversation memory. Each session is one isolated memory thread: **thread id = session id** and **resource id = session id**. Configuration: the last 40 messages are replayed; semantic recall off; automatic thread-title generation off. The store is `mastra.sqlite` (section 1.2); its internal tables are owned by the framework and are not part of this contract.
- What is stored: the user/assistant turns of chat as the framework records them (the framework writes new turns itself once the thread exists). Background jobs that fire many internal sub-calls (deep analysis) and the other agents (SQL repair, verifier, designer, knowledge bootstrap, eval judge) run **without** the memory thread so they never pollute the history a later chat question is answered from.
- **Bootstrap of legacy transcripts.** When a turn is about to run and the thread does not yet exist (sessions created before memory was enabled, or a brand-new session), the agent input is the entire persisted transcript mapped to plain `{role, content}` text messages (structured fields such as `data` are not replayed); the framework then creates the thread from it. When the thread exists, the input is only the latest user message — except when the previous assistant message was a clarification (it ended its turn before memory saw the question), in which case the clarification text (as an assistant message) and the user's answer are both sent.
- On session deletion the thread is deleted (`deleteThread(session id)`), the workspace is unregistered and destroyed, and the workspace directory is removed.
- **Ownership.** Memory threads and workspaces carry no owner of their own. They are reached only through a session: every route and tool that touches a thread or workspace first loads the session by id, and an unknown id answers as not found. Session ids are random UUIDs but are not treated as secrets.
- The session document's `messages` remain the source of truth for display and for everything with structured fields; memory is only the model's conversational context.

---

## 6. Migrations

**Rule.** Renaming a collection (table) or a persisted document field needs an explicit migration, because the store creates a missing table on first open (a renamed collection silently starts empty) and readers look up fields by name (a renamed field is silently absent). Migrations run at startup, before the stores are built, are idempotent, and must not restamp `updatedAt` on collections sorted by it (do them in raw SQL, not through a repository write, when the collection is recency-sorted). Add the migration and a test for it in the same change as the rename. Never delete the legacy code path while installs that predate it may exist.

| # | What | When it runs | Rule |
|---|---|---|---|
| M1 | Table `projects` → `sessions` | Backend start, before stores are created | If table `projects` exists and `sessions` does not, rename it. |
| M2 | Table `sandbox_selections` → `datasets` | Same | If `sandbox_selections` exists and `datasets` does not, rename it. |
| M3 | Session document field `sandboxes` → `datasets` | Same, after M1/M2 | For each `sessions` row where `sandboxes` is present and `datasets` is absent, set `datasets` to the value (kept structured, not stringified) and remove `sandboxes`. Done in raw SQL so `updatedAt` is untouched (the session list sorts by it). Skipped when the table does not exist. |
| M4 | Verified-query field `sourceProjectId` → `sourceSessionId` | Verified-queries module init | For each document that has `sourceProjectId` and no `sourceSessionId`: set `sourceSessionId`, then unset `sourceProjectId`. These writes do stamp `updatedAt` (harmless: retrieval is lexical, not recency-based). Needed so the dedupe filter on `sourceSessionId` finds legacy pairs instead of forking them on the next thumbs-up. |
| M5 | Workspace directories `workspaces/project-<id>` → `workspaces/session-<id>` | Workspace module load, before discovery | For each directory starting `project-` whose `session-` target does not exist, rename it; errors are logged per directory and skipped. Without it the discovery scan skips them and every old session loses its visuals and reports. |
| M6 | Anonymous Databricks connection to a named datasource | Lazily, each time connections are listed | A `connections` document with `kind = databricks`, top-level `host`/`token`/`warehouseId` and no `id` is rewritten in place (matched on `kind` + `host`) to `{id: "legacy-databricks", name: "Databricks", kind: "databricks", config: {host, token, warehouseId}}` keeping its timestamps, so old datasets can bind to it. |
| M7 | Datasets without a datasource binding | At read time, not persisted | A dataset with no `datasourceId` is bound in memory to the default datasource (first `databricks` connection, else first by `updatedAt` desc). Legacy `datasets` rows without `name` are ignored by every reader. |
| M8 | Electron profile directory rename | Electron startup (desktop app) | If the current `userData` directory does not exist but a sibling `Questions to Insights` directory does, keep using the legacy directory. |
| M9 | Windows roaming to local data move | Electron startup, Windows only | See section 1.1 (moves `app.sqlite`, `mastra.sqlite`, `workspaces` once; rollback on failure). `.app-secret` is resolved in the *resulting* data dir so the secret and the data it protects travel together. |
| M11 | LLM API key under the former development secret | LLM module init, at backend start | If the `settings` document `llm` exists and its `apiKeyCiphertext` does not decrypt with the current key but does with SHA-256(`insecure-dev-secret`), re-encrypt it with the current key and patch only `apiKeyCiphertext`. Idempotent (a second run finds it readable). Failures are logged and leave the document untouched. Covered by `llm.service.spec.ts`. |
| M10 | Pre-versioning visuals; messages without `reasoning`; datasets without `sampleValues`/`references` | Read time | Tolerated by readers (section 4.7; reasoning derived from `data[].rationale`; absent snapshot fields simply omitted). No rewrite. |
| M12 | Theme choice saved only in browser storage (before ADR-0009) | Renderer start, once the backend answers | If `GET /ui-preferences` returns `theme: null` and `localStorage` holds `system`, `light` or `dark` under `questions-to-insights:theme`, the renderer saves it with `PUT /ui-preferences`. Idempotent: afterwards the backend holds a value. Covered by `theme.service.spec.ts` and the appearance E2E. |
| M13 | Local data stored before local mode had sign-in (ADR-0012) | Superseded: subsumed by M14, which does the same and more | Not run on its own any more. M14 gives ownerless documents to `local` and renames the bare keys it once suffixed, so an install that never ran M13 and one that did end in the same state. |
| M14 | Single user: every owner becomes `local`, identity data is dropped (ADR-0030) | Backend start, after M1-M3, before stores are created | Raw SQL, so `updatedAt` is untouched. (1) For each of `sessions`, `verified_queries`, `metrics`, `eval_runs`, `knowledge_snippets`, `agents` and `skills` that exists: `UPDATE <table> SET doc = json_set(doc, '$.ownerId', 'local') WHERE json_extract(doc, '$.ownerId') IS NULL OR json_extract(doc, '$.ownerId') != 'local'`. (2) In `settings`: rename `ui-preferences:local` to `ui-preferences` and `builtin-agent-pins:local` to `builtin-agent-pins`, each only when the bare key is absent; then delete every other `ui-preferences:*` and `builtin-agent-pins:*` key (other users' preferences and pins, and the leftover `:local` ones) and the `local-seed` document. (3) Drop the tables `users`, `groups`, `group_members`, `role_assignments`, `group_role_mappings`, `auth_sessions` and `activity_events` when they exist. (4) Skills that several owners named alike now share one owner: keep the first (oldest `createdAt`) as is and suffix the others `-2`, `-3`, … (cut before the suffix so the name stays within 64 characters), then rewrite every `[[skill:<old name>]]` link in the draft and Live instructions of the agents that named the renamed skill, and the matching `liveSkills` copy's name (ADR-0024). Idempotent (a second run finds only `local` owners, no suffix clashes and no identity tables). Covered by `database.module.spec.ts`. |

None for `agents`: it is a new collection, and the store creates the table on first open. The built-in pins document is a new `settings` key and needs no migration.

None for the RFP Builder (BA-213, ADR-0028): `agentKey` and `rfpId` on sessions and `rfpPackage` on messages are new optional fields, and `rfp` is a new key in `agent_prompt_overrides`. The `rfp` schema in the Intellify database has its own versioned migrations (section 7.3).

None for the agent panel (BA-231, ADR-0029): `panelItems` and `workflowState` on sessions are new optional fields; visuals made before are synthesized into the item list at read time (3.4.4), so no stored document is rewritten.

None for the eval run statuses and summary (BA-184): `eval_runs` gains `judge`, `summary`, and `category`, `status` and `criterion` on its results and checks; no field is renamed, and older records are read with the defaults of section 3.8 (like M10, a read-time tolerance, never a rewrite). Covered by `eval-runs.repository.spec.ts`.

Tests: the table/field renames (M1-M3), M14 and M4/M5 are covered by `database.module.spec.ts` and the repository/workspace specs.

---

## 7. External databases

Databases the app's own services write to outside the app data dir. Today there is one: the Intellify database behind the Intellify RFP API ([api.md](api.md) 2.16; ADR-0027 in [architecture.md](architecture.md)). The app's own stores (section 1.2) never point into it; the app reaches it only over HTTP, through that API.

### 7.1 The Intellify database

A PostgreSQL database (16 in the compose stack; 13 or later, for the built-in `gen_random_uuid()`), reached by the Intellify RFP API with its own pool. Coordinates, all from the environment ([api.md](api.md) 6.1):

| Variable | Default |
|---|---|
| `INTELLIFY_DB_HOST` | `127.0.0.1` |
| `INTELLIFY_DB_PORT` | `WORLD_CUP_DB_PORT`, else `55432` (the compose Postgres) |
| `INTELLIFY_DB_NAME` | `intellify_mercer_demo` |
| `INTELLIFY_DB_USER` | `world_cup` |
| `INTELLIFY_DB_PASSWORD` | `world_cup_dev` |
| `INTELLIFY_DB_SSL` | `false` |
| `INTELLIFY_DB_SCHEMA` | `intellify` |

The Intellify Testing Data fixture defaults to the database `intellify` ([testing-data](../capabilities/testing-data/spec.md) R3), while the API defaults to `intellify_mercer_demo`: load the fixture into `intellify_mercer_demo`, or set `INTELLIFY_DB_NAME=intellify`. A missing or unreachable database never stops the app: the API answers `GET /health` with `database: "down"` and its data routes with `503 database_unavailable`.

It holds two schemas with different owners:

| Schema | Owner | Written by | Notes |
|---|---|---|---|
| `intellify` (`INTELLIFY_DB_SCHEMA`) | The `intellify` Testing Data fixture | The fixture's load only (`DROP SCHEMA … CASCADE`, then the bundled seed; [testing-data](../capabilities/testing-data/spec.md) R4) | The Intellify data model: 49 tables, deterministic synthetic rows. The API only reads it, in `READ ONLY` transactions. |
| `rfp` | The Intellify RFP API | The API's RFP routes only ([api.md](api.md) 2.16.4), through parameterised statements | RFP records (7.2). Created and upgraded by the API's migrations (7.3). Removing the fixture or reloading it never touches it. |

### 7.2 The `rfp` schema

`db/migrations/001_rfp_schema.sql` (in `backend/src/intellify-api/`, copied to `dist` as a build asset):

```sql
CREATE SCHEMA IF NOT EXISTS rfp;
CREATE TABLE IF NOT EXISTS rfp.schema_migrations (
  version     integer PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rfp.rfps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_one_code  text NOT NULL,          -- intellify.clients.one_code; checked by the API, no cross-schema FK
  client_name      text NOT NULL,
  title            text NOT NULL,
  plan_year        integer NOT NULL CHECK (plan_year BETWEEN 2024 AND 2035),
  effective_date   date NOT NULL,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','issued','closed')),
  stage            smallint NOT NULL DEFAULT 1 CHECK (stage BETWEEN 0 AND 7),
  sections         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rfps_client_idx ON rfp.rfps (client_one_code, status);
CREATE TABLE IF NOT EXISTS rfp.rfp_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfp_id              uuid NOT NULL REFERENCES rfp.rfps(id) ON DELETE CASCADE,
  position            integer NOT NULL,
  line                text NOT NULL,          -- intellify.products.name
  product_id          char(24) NOT NULL,
  plan_design_ids     char(24)[] NOT NULL DEFAULT '{}',
  market_basis        text NOT NULL CHECK (market_basis IN ('as-is','alternate')),
  alternate_funding   text,
  alternate_plan_type text,
  notes               text,
  UNIQUE (rfp_id, position)
);
CREATE TABLE IF NOT EXISTS rfp.rfp_carriers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfp_id        uuid NOT NULL REFERENCES rfp.rfps(id) ON DELETE CASCADE,
  position      integer NOT NULL,
  insurer_id    char(24) NOT NULL,
  insurer_name  text NOT NULL,
  lines         text[] NOT NULL,
  incumbent     boolean NOT NULL DEFAULT false,
  contact_email text,
  notes         text,
  UNIQUE (rfp_id, position)
);
CREATE TABLE IF NOT EXISTS rfp.rfp_requirements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfp_id      uuid NOT NULL REFERENCES rfp.rfps(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  section     text NOT NULL,
  question    text NOT NULL,
  required    boolean NOT NULL DEFAULT true,
  answer_type text NOT NULL DEFAULT 'text' CHECK (answer_type IN ('text','yes_no','number','table','attachment')),
  UNIQUE (rfp_id, position)
);
CREATE TABLE IF NOT EXISTS rfp.rfp_timeline (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfp_id    uuid NOT NULL REFERENCES rfp.rfps(id) ON DELETE CASCADE,
  position  integer NOT NULL,
  milestone text NOT NULL,
  due_date  date NOT NULL,
  owner     text,
  notes     text,
  UNIQUE (rfp_id, position)
);
INSERT INTO rfp.schema_migrations (version) VALUES (1) ON CONFLICT DO NOTHING;
```

Columns map to the API's camelCase fields ([api.md](api.md) 2.16.4): `client_one_code` → `clientOneCode`, `plan_design_ids` → `planDesignIds`, `sections` (JSON object keyed `executiveSummary`, `clientBackground`, `scopeStatement`, `instructionsToBidders`, `evaluationCriteria`, `notes`) → `sections`, and so on. The list tables are replaced whole by the `PUT` routes (delete the RFP's rows, insert the new list with `position` 1..n) in one transaction that also stamps `rfps.updated_at`. Deleting an RFP cascades to its four list tables. The summary counts (`lines`, `carriers`, `requirements`, `milestones`) are computed, not stored.

### 7.3 Migration rule

- Migrations are versioned files `db/migrations/NNN_<name>.sql`, applied in `NNN` order at the API's first start (embedded or standalone), each inside its own transaction.
- Each transaction first takes `SELECT pg_advisory_xact_lock(727001)`, so two API instances on the same database (e.g. two worktrees) never race; a file whose version is already in `rfp.schema_migrations` is skipped, and each file records its version itself. Re-running is a no-op (idempotent).
- `GET /health` reports the highest applied version as `rfpSchemaVersion` (`null` before the first migration or with the database down).
- **No foreign key crosses the schemas.** The Intellify fixture's load drops schema `intellify` with `CASCADE`, which would also drop any `rfp` constraint pointing into it. The API checks `client_one_code` against `intellify.clients` on `POST /v1/rfps`, and plan design ids against the client on `PUT …/lines`.
- **A reseed keeps the drafts.** "Recreate testing data" for `intellify` drops and recreates only schema `intellify`, so RFP records survive. Their `client_one_code` may then name a client that no longer exists; reads of such a record carry `clientMissing: true` ([api.md](api.md) 2.16.4). The seed is deterministic, so a reseed normally restores the same clients.
- Never edit a shipped migration file; change the schema with a new `NNN` file.

## Open questions, gaps and discrepancies

- **Datasource credentials are stored in plaintext** in `connections` (only masked in API views); `CryptoService` is used only for the LLM API key. REST `headers` are neither encrypted nor masked, so a secret placed in a custom header is returned to the renderer verbatim. Open question: is encrypting datasource secrets (and masking headers) in scope?
- **Two different data-dir fallbacks** when `APP_DATA_DIR` is unset: `app.sqlite` uses `<cwd>/data`, the agent stores and workspaces use `<INIT_CWD|PWD|cwd>/data`. They coincide in normal runs but can diverge (e.g. Mastra Studio changes `cwd`). Open question: should both use one resolver?
- **Version overwrite after revert.** Tailoring/repairing always writes version `currentVersion + 1`. After reverting from v3 to v1, the next tailoring writes `v2/`, overwriting the existing v2 directory and appending a second `{version: 2}` entry to `versions`. Open question: should the next version number be `max(versions) + 1`?
- **Verified-query id instability**: re-approving the same answer replaces `id` with a fresh uuid (the upsert patch carries a new id), which can orphan `metrics.sourceVerifiedQueryId`.
- **Eval runs left `running`** after a crash are never reconciled; the in-code comment on the service still says runs are in-memory although they are persisted.
- **No cascades**: deleting a session keeps its verified queries; deleting a dataset or datasource leaves dangling names/ids in sessions, knowledge scopes, datasets and eval runs.
- **Message identity is the `at` millisecond timestamp**; two assistant messages created in the same millisecond would collide as feedback/visual/verified-query keys. Not observed, not guarded.
- **Legacy single-selection `datasets` documents** (pre-`name` era) are ignored by readers but their exact shape is not documented anywhere in the code. Open question: can they be dropped?
- **Electron `userData` name when unpackaged**: the profile name is derived from the packaged `productName` (`Halo BI Assistant`); for an unpackaged `electron .` run the name derives from the package name (`frontend`), so dev data lands in a different directory. Not verified.
- Mastra's own `mastra.sqlite` / `observability.duckdb` internals are intentionally not specified; a rebuild on another stack only needs equivalent conversation memory (last-40 replay, thread = resource = session id) and may drop the observability store.

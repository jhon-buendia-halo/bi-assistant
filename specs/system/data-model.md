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
| **App document store** | `app.sqlite` | Embedded SQLite, one table per collection, one JSON document per row | The nine application collections in section 3: connections, settings, datasets, sessions, inventories, verified queries, metrics, eval runs, knowledge | App backend |
| **Agent memory store** | `mastra.sqlite` | LibSQL file (Mastra runtime storage) | Conversation memory threads/messages for the `assistant` agent (section 5); any other Mastra runtime state | Agent framework |
| **Observability store** | `observability.duckdb` | DuckDB (memory limit 512 MB, 2 threads) | Agent traces, metrics and logs written by the framework's storage exporter (service name `questions-to-insights`, log level `info`) | Agent framework |
| **Session workspaces** | `workspaces/session-<session-id>/` | Plain directories, a contained filesystem root per session | Visual bundles, deep-analysis reports, seeded skills (section 4) | App backend + agents (agents can create/edit files there but cannot delete) |
| **Developer settings** | `developer-settings.json` | JSON file, written atomically (temp file + rename) | `{ observabilityEnabled: boolean, phoenixEndpoint: string, otlpEndpoint: string, updatedAt: ISO string }`. Absent until the first save, and absent means the defaults (`false`, `http://localhost:6006`, `http://localhost:4318`). Invalid or missing values fall back to their defaults. Read synchronously by the backend at startup, before any app module loads (ADR-0006). See [../capabilities/developer-settings/spec.md](../capabilities/developer-settings/spec.md). | App backend |
| **App secret** | `.app-secret` | Text file, mode `0600` | 64 lowercase hex characters (32 random bytes). The key material for encrypting stored secrets (section 2.3). Read if present and non-empty, else generated once and written. `APP_SECRET` env var, when set, wins and the file is not used. Created by the launcher (Electron main or CLI); a backend started without `APP_SECRET` reads or creates the same file itself. | Launcher, else backend |
| **Diagnostics log** (desktop app only) | `<Electron userData>/logs/system.ndjson`, rotated to `system.previous.ndjson` when larger than 5 MiB at startup | Newline-delimited JSON | System log entries `{id, timestamp, level, source, message, details}` (redacted), at most the last 2000 reloaded at startup. Lives under Electron `userData`, **not** the app data dir (they differ on Windows). See [../capabilities/diagnostics/spec.md](../capabilities/diagnostics/spec.md). | Electron main |
| **Renderer preference** (client) | Browser/Electron `localStorage` key `questions-to-insights:right-panel-width` | String holding a number | Right panel width in pixels; default 572, clamped to 360..960 (upper bound also limited by window width). Missing or non-numeric = default. See [ui.md](ui.md). | Frontend |
| **Renderer preference** (client) | Browser/Electron `localStorage` key `questions-to-insights:theme` | String: `system`, `light` or `dark` | The Appearance choice. Missing or any other value = `system`. Read by an inline script before the app boots, so the first paint uses the right theme. See [../capabilities/app-shell/spec.md](../capabilities/app-shell/spec.md) R39–R45. | Frontend |

Nothing else is persisted. Deep-analysis jobs and REST-datasource row materialisation are in-memory only (sections 3.10, 3.11).

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

Operations are individually atomic but there are no transactions across operations. Read-modify-write sequences in services (e.g. appending to a session's messages) re-read the document immediately before writing so a concurrent turn is not overwritten; they are still last-writer-wins on the whole top-level key (e.g. the whole `messages` array).

**Implementation note (current adapter).** `SqliteDocStore` keeps one table per collection: `CREATE TABLE IF NOT EXISTS "<table>" (rid INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL)`, `doc` holding the JSON text. Every `find`/`update`/`delete` loads all rows of the table, parses them and filters/sorts in process (a deliberate prototype-scale trade); "first match" means lowest `rid`. A table is created when its collection is first opened, so a missing table silently becomes an empty collection (this is why renames need migrations, section 6). Because documents are serialised with `JSON.stringify`, a patch key whose value is `undefined` is dropped on write, i.e. it effectively removes that field from the stored document (although the returned in-memory document still carries the key). Each collection is registered as an injection token plus table name; adding a collection means adding one entry to that registry.

---

## 3. Collections

Summary:

| Collection (table) | Purpose | Identity | Default order | Capability |
|---|---|---|---|---|
| `connections` | Saved datasources (data platform connections) | `id` | `updatedAt` desc | [datasources](../capabilities/datasources/spec.md) |
| `settings` | Single LLM settings document | `key = "llm"` | n/a | [llm-settings](../capabilities/llm-settings/spec.md) |
| `datasets` | Named selections of entities with a schema snapshot | `name` (unique, upsert key) | `updatedAt` desc | [datasets](../capabilities/datasets/spec.md) |
| `sessions` | Chat sessions with full transcript and visual metadata | `id` | `updatedAt` desc | [sessions-chat](../capabilities/sessions-chat/spec.md), [visuals](../capabilities/visuals/spec.md) |
| `datasource_inventories` | Cached catalog/schema/table walk per datasource | `id` = datasource id | n/a | [datasources](../capabilities/datasources/spec.md) |
| `verified_queries` | User-approved question to SQL pairs | `id`; dedupe key `(sourceSessionId, sourceMessageAt)` | `updatedAt` desc | [verified-queries](../capabilities/verified-queries/spec.md) |
| `metrics` | Curated metric definitions | `id`; `name` unique | `updatedAt` desc | [metrics](../capabilities/metrics/spec.md) |
| `eval_runs` | Past and in-flight eval runs | `jobId` | `startedAt` desc (per agent) | [agents-evals](../capabilities/agents-evals/spec.md) |
| `knowledge_snippets` | Curated knowledge entries | `id` | `updatedAt` desc | [knowledge](../capabilities/knowledge/spec.md) |

Every document in every collection also carries `createdAt` and `updatedAt` (ISO), maintained by the store (section 2.1); they are listed per collection only where they matter. There are **no foreign-key constraints and no cascading deletes** between collections; references are by value (`name`, `id`) and may dangle (section 3.12).

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

Exactly one document, upserted by `key = "llm"`. (Other keys are not used.)

| Field | Type | Req | Meaning |
|---|---|---|---|
| `key` | string | yes | Always `"llm"`. |
| `provider` | enum | yes | `openai` \| `anthropic` \| `lenai` (LenAI = Halo's OpenAI-compatible gateway). |
| `model` | string | yes | Model id; for `lenai` it is the deployment name. |
| `baseUrl` | string | yes | `""` for `openai`/`anthropic`; required non-empty for `lenai`. |
| `apiKeyCiphertext` | string | yes | The API key encrypted per section 2.3. Never returned by the API; the view carries `apiKeyMasked` = `••••••••` + the key's last 4 characters. |
| `reasoningEffort` | enum | no | `low` \| `medium` \| `high`; absent is read as `high`. Preserved across re-saves (a re-save writes the existing value, or `high`). Settable only once settings exist. |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

No document stored = "not configured": agents fall back to model `openai/gpt-4o-mini` with the `OPENAI_API_KEY` env var. A save is only persisted after a live test call with the submitted settings succeeds. See [agents.md](agents.md) for model routing.

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
| `messages` | `ChatMessage[]` | yes | Transcript in order. Empty at creation. |
| `visualizations` | `SessionVisualization[]` | no | Visual metadata (section 3.4.3); `[]` at creation. |
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
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

An update that omits an optional field removes it from the stored document (`unset`), so no stale description/dimensions survive an edit. Prefilled drafts (`MetricCandidate`: `verifiedQueryId`, `name`, `label`, `entity`, `datasourceId?`, `sql`) are computed from verified queries and never stored.

### 3.8 `eval_runs`

Persisted record of an eval run (the assistant's regression suite). Rewritten wholesale (`update` by `jobId` with upsert) after each question lands and at the end, so a crash mid-suite still leaves finished questions. The in-flight copy in process memory is authoritative while a run is running.

| Field | Type | Req | Meaning |
|---|---|---|---|
| `jobId` | uuid | yes | Run id. |
| `agentKey` | string | yes | Agent evaluated; only `assistant` has evals. |
| `datasourceId` | string | yes | Datasource the run was scoped to. |
| `datasets` | string[] | yes | Names of the datasets bound to that datasource at start. |
| `caseIds` | string[] | yes | Ids of the questions the run covers. |
| `status` | enum | yes | `running` \| `completed` \| `failed`. A backend crash leaves `running` on disk (nothing reconciles it). |
| `results` | `AssistantEvalCaseResult[]` | yes | Finished questions in order. |
| `totalCases` | number | yes | |
| `currentQuestion` | string | no | Question being run; removed when the run ends. |
| `error` | string | no | Set when `status = failed`. |
| `startedAt` | ISO | yes | Sort key (desc) for listings. |
| `finishedAt` | ISO | no | Set when the run ends. |
| `comparison` | `EvalRegressionSummary` | no | Set when a run completes and a previous completed run with the same agent, `datasourceId` and the same set of datasets (order-insensitive) exists. Absent on older records and when no comparable run exists. |
| `createdAt`, `updatedAt` | ISO | yes | Store-maintained. |

`AssistantEvalCaseResult`: `id` (string, case id), `question` (string), `scores` (map<string, number 0..1>, per scorer id; empty when the run threw), `checkResults` (`EvalCheckResult[]`), `answer` (string), `toolCalls` (`EvalToolCall[]`), `passed` (boolean; every scorer scored 1), `error` (string, no; agent run failure), `durationMs` (number).
`EvalCheckResult`: `id`, `description` (string), `score` (number), `passed` (boolean), `reason` (string, no).
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
| `createdAt`, `updatedAt` | ISO | yes | Both set by the service at insert, then store-maintained. |

Bootstrap-created snippets are always `{source: "mined", enabled: false, scope: {datasetId: <dataset name>}}`, capped at the agent's draft limit, and a draft whose case-insensitive trimmed title already exists in that dataset's scope is skipped.

`KnowledgeUse` (embedded in messages, not a collection): `id`, `kind`, `title`, `body` (exactly as it appeared in the block), `datasetId` (string, no; absent for a global snippet). Context assembly: enabled snippets whose scope is global or whose `datasetId` is among the session's datasets, ordered dataset-scoped before global then `updatedAt` desc, accumulated into a 2000-character block until the next entry would not fit; only those that fit are recorded as `knowledge`.

### 3.10 Deep-analysis jobs (not persisted)

Deep-analysis jobs exist only in process memory (bounded history; a backend restart forgets them). Persisted outputs are the report file (`workspaces/session-<id>/reports/<jobId>.md`, section 4.5) and the assistant message carrying `report` (3.4.1). For completeness the in-memory job shape is: `id`, `sessionId`, `question`, `status` (`planning` \| `investigating` \| `writing` \| `done` \| `error`), `progress?`, `step?`, `steps?`, `title?`, `path?`, `error?`, `startedAt`, `finishedAt?`. The planner output schema is `{title: string, angles: [{title, question}] (3..5 intended, min 1)}` and the writer output `{title, executiveSummary, report}`; see [../capabilities/deep-analysis/spec.md](../capabilities/deep-analysis/spec.md) and [agents.md](agents.md).

### 3.11 Other non-persisted data

- REST datasource queries are executed by materialising the referenced endpoints into a throwaway in-memory SQLite database per call; nothing of it is written to disk.
- Eval runs also keep an in-memory map for in-flight runs (section 3.8 is the durable copy).

### 3.12 Relationships and referential rules

| From | Field | To | Rule |
|---|---|---|---|
| `datasets` | `datasourceId` | `connections.id` | By value, no cascade. Deleting a datasource leaves its datasets (they then fail at use). |
| `sessions` | `datasets[]` | `datasets.name` | By name. Deleting or renaming a dataset leaves sessions pointing at a missing name. |
| `knowledge_snippets` | `scope.datasetId` | `datasets.name` | By name, no cascade. |
| `datasource_inventories` | `id` | `connections.id` | 1:1; deleted explicitly with the datasource. |
| `verified_queries` | `sourceSessionId`+`sourceMessageAt` | `sessions.id` + message `at` | No cascade on session deletion; removed explicitly on thumbs-down. |
| `metrics` | `datasourceId`, `sourceVerifiedQueryId` | `connections.id`, `verified_queries.id` | Provenance only, may dangle (a verified query id also rotates on re-approval). |
| `eval_runs` | `datasourceId`, `datasets[]` | `connections.id`, `datasets.name` | Scope snapshot, may dangle. |
| `sessions[].visualizations[]` | `id`, `path` | `workspaces/session-<id>/visuals/<id>/` | Files under the session workspace; both removed with the session. |
| `sessions[].messages[]` | `visual.visualId`, `report.jobId` | visual id / report file | By value. |
| session | `id` | agent memory thread id and resource id; workspace `session-<id>` | See section 5. |

---

## 4. Files on disk

All paths in this section are relative to `<app data dir>/workspaces/session-<session-id>/` (the **session workspace**), a contained filesystem root: agents' file tools cannot escape it and the file-delete tool is disabled for them (they may create and edit). The session id used in a directory name must match `^[a-zA-Z0-9_-]+$` (otherwise the operation fails with `Invalid session workspace ID`).

### 4.1 Workspace layout

```
workspaces/
  session-<session-id>/
    .agents/
      skills/
        interactive-visuals/
          SKILL.md                 seeded app asset (4.6)
    visuals/
      <visual-id>/                 one directory per visual
        v1/                        version directories (4.2)
        v2/
        ...
    reports/
      <job-id>.md                  deep-analysis reports (4.5)
```

The workspace directory is created with the session (`createSessionWorkspace`) and registered with the agent framework under id `session-<session-id>` (display name `<session name> Workspace`, skills path `.agents/skills`). At backend start, and whenever the `workspaces/` directory changes, every `session-*` directory on disk is (re)registered, so workspaces survive restarts and are visible to a second framework process (the dev studio). Directories not starting with `session-` are ignored.

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

### 4.6 Skills copied into workspaces

At workspace creation/registration and on every session load, the app copies its bundled skill `interactive-visuals/SKILL.md` into `.agents/skills/interactive-visuals/SKILL.md` of each session workspace (creating directories). Rules: skip the write when the target is byte-identical; otherwise copy through a temporary sibling file and rename so a reader never sees a half-written file, retrying up to 3 times on `EBUSY`/`EPERM`/`EACCES` (antivirus or roaming-sync locks); all failures are swallowed with a warning — a locked or missing skill must never abort session creation. The source asset is searched in several candidate locations relative to the backend working directory (`../skills/…`, `mastra/skills/…`, `dist/mastra/skills/…`, `src/mastra/skills/…`) so it resolves under the dev studio, the Electron-staged backend and standalone runs. The skill's content (the visual-designer guidance: the spec format above, selection rules, the freeform fallback) is specified in [agents.md](agents.md) under the visual designer; the asset must ship with the backend.

### 4.7 Legacy visual layout

Visuals created before versioning keep their **v1 files directly under `visuals/<id>/`** (no `v1/` directory) and have no `versions`/`currentVersion` in the session metadata. Rules readers must apply:

- A visual with no `versions` and version ≤ 1 resolves to `visuals/<id>/`.
- Once such a visual gains version 2, `versions` is materialised as `[{version: 1, createdAt: visual.createdAt, sourceMessageAt: visual.sourceMessageAt}, {version: 2, …}]` and v2 is written to `visuals/<id>/v2/`; for version 1 the reader prefers `visuals/<id>/v1/index.html` and falls back to the root when it does not exist.
- Legacy versions may lack `body.html`, `manifest.json`, `data.json`, `answer.md`, `spec.json`; each reader has a fallback (extract the body from `index.html`, use the session metadata for title/description, use the source answer's `data`). Downloads always regenerate `index.html` so old versions ship with the readable frame.

---

## 5. Agent memory

- Only the `assistant` agent has conversation memory. Each session is one isolated memory thread: **thread id = session id** and **resource id = session id**. Configuration: the last 40 messages are replayed; semantic recall off; automatic thread-title generation off. The store is `mastra.sqlite` (section 1.2); its internal tables are owned by the framework and are not part of this contract.
- What is stored: the user/assistant turns of chat as the framework records them (the framework writes new turns itself once the thread exists). Background jobs that fire many internal sub-calls (deep analysis) and the other agents (SQL repair, verifier, designer, knowledge bootstrap, eval judge) run **without** the memory thread so they never pollute the history a later chat question is answered from.
- **Bootstrap of legacy transcripts.** When a turn is about to run and the thread does not yet exist (sessions created before memory was enabled, or a brand-new session), the agent input is the entire persisted transcript mapped to plain `{role, content}` text messages (structured fields such as `data` are not replayed); the framework then creates the thread from it. When the thread exists, the input is only the latest user message — except when the previous assistant message was a clarification (it ended its turn before memory saw the question), in which case the clarification text (as an assistant message) and the user's answer are both sent.
- On session deletion the thread is deleted (`deleteThread(session id)`), the workspace is unregistered and destroyed, and the workspace directory is removed.
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

Tests: the table/field renames (M1-M3) and M4/M5 are covered by `database.module.spec.ts` and the repository/workspace specs.

---

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

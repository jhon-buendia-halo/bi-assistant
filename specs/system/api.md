# API contract

The complete contract between the renderer (or any HTTP client) and the backend, plus the desktop IPC bridge, the CLI and the environment. Persisted document shapes (session, dataset, datasource, metric, knowledge snippet, verified query, LLM settings, eval run) live in [data-model.md](data-model.md); this file links to them and only restates a shape where the wire format differs from the stored one.

Contents: [1 Conventions](#1-conventions) · [2 Endpoints](#2-endpoints) · [3 Streaming and long-running work](#3-streaming-and-long-running-work) · [4 Desktop bridge (IPC)](#4-desktop-bridge-ipc) · [5 CLI contract](#5-cli-contract) · [6 Environment variables](#6-environment-variables) · [7 Gaps and open questions](#7-gaps-and-open-questions)

Endpoint total: **57 HTTP route handlers** across 9 controllers (sessions 14, datasources 6, metrics 5, llm 4, datasets 3, agents 13, deep analysis 3, testing data 3, knowledge 6). Verified queries have **no** HTTP surface (they are created and removed as a side effect of message feedback, and read by the metrics promotion path).

---

## 1. Conventions

### 1.1 Base URL

| Mode | How the client reaches the API |
|---|---|
| Web (`npx` / CLI, same origin) | The backend serves the built UI itself. Client uses **relative URLs** (empty base), e.g. `/sessions`. |
| Desktop (Electron renderer, `file://`) | Client uses `http://localhost:3000` (hardcoded). The backend child process listens on `PORT`, which the main process sets from `BACKEND_PORT` (default `3000`). See gap G1: a non-default `BACKEND_PORT` breaks the renderer. |
| Dev (`ng serve` / `electron:dev`, page served from `http://localhost:4200`) | Protocol is `http:`, so the client uses relative URLs against the dev server. No proxy or override exists in the repo (G13). |

The client rule is: `API_BASE_URL = (window.location.protocol === 'file:') ? 'http://localhost:3000' : ''`. All paths below are relative to that base. There is no API prefix, no versioning and no authentication.

### 1.2 Wire format

- Requests with a body: `Content-Type: application/json`. Bodies are parsed by the framework's default JSON parser (default size limit, see G9).
- Responses are JSON unless stated (zip and markdown downloads, `text/event-stream`).
- Identifiers in paths are URL-encoded by clients (`encodeURIComponent`). Datasets are addressed by **name**, not id.
- Timestamps are ISO-8601 UTC strings. Assistant messages are addressed by their `at` timestamp (`messageAt`, `sourceMessageAt`).
- All routes are bare resource paths with no trailing slash.

### 1.3 Two response styles (important)

The API has two error conventions. A rebuild must keep both because clients depend on them.

**Style A, "result envelope", HTTP 200/201 with `ok`.** Most mutating endpoints wrap the call in try/catch and report failure inside a 2xx body:

```ts
interface ActionResult { ok: boolean; message: string; /* + endpoint-specific payload on success */ }
```

- On failure: `{ ok: false, message: "<Error.message>" }`, HTTP status is still 2xx. Thrown framework exceptions (400/404/408) are caught and flattened into `message`.
- On success: `{ ok: true, message: "<human sentence>", ...payload }`.
- `message` is user-displayable and clients show it verbatim in toasts or inline errors. Exact success sentences are listed per endpoint because UI tests assert some of them.

**Style B, framework exceptions, real HTTP status.** Endpoints that do not catch let the framework answer. Used by: `GET /sessions/:id`, the visual `GET` endpoints, `GET /agents/:key`, the eval-run download, the deep-analysis download, and the whole knowledge controller.

```ts
interface HttpErrorBody { statusCode: number; message: string | string[]; error: string }   // NestJS default
```

| Status | When |
|---|---|
| 400 Bad Request | Validation failure thrown by a service (`BadRequestException`): missing/empty field, bad enum value, unknown version. |
| 404 Not Found | Unknown session/agent/snippet/visual/report, or an unmatched route (`Cannot GET /x`). |
| 408 Request Timeout | A visual generation exceeded 120 s (`RequestTimeoutException`). Under Style A this surfaces as `ok:false`. |
| 500 Internal Server Error | Any unhandled error (framework default body `{ statusCode: 500, message: "Internal server error" }`). |

Clients read the error text from `error.message` (Style B) or `body.message` with `body.ok === false` (Style A). Two endpoints mix the styles: `GET /sessions/:id/deep-analysis/:jobId` and `GET /agents/:key/evals/runs/:jobId` report "not found" as Style A (`200 { ok:false }`).

### 1.4 Success status codes

POST handlers return the framework default **201 Created**; GET/PUT/DELETE return **200**; `DELETE /knowledge/:id` returns **204 No Content**. Handlers that write the response themselves (the two SSE endpoints and the three file downloads) return **200**. Clients treat any 2xx as success and do not depend on 200 vs 201.

### 1.5 Validation

- There is **no global validation pipe** and no DTO validation library. DTO classes (`SaveDatasourceDto`, `SaveMetricDto`, ...) are plain TypeScript shapes; nothing rejects extra or mistyped fields at the edge.
- Validation is done by services/controllers: fields are coerced defensively (`typeof x === 'string' ? x : ''`), trimmed, and checked with explicit `BadRequestException`s. Rules per endpoint are listed in section 2.
- Unknown body fields are ignored. Missing body is treated as `{}`.
- Query params are strings. Booleans are accepted only as the literal `"true"`. The knowledge list drops unrecognised filter values instead of rejecting them.

### 1.6 CORS

| Mode | CORS |
|---|---|
| Desktop (`main.ts`, Electron-spawned backend) | **Enabled** (`app.enableCors()`, allow-all) because the renderer's origin is `file://` (`Origin: null`). |
| Web / CLI | **Disabled**. Same-origin only. |

### 1.7 Static web UI and SPA fallback

At startup the backend resolves a web root: `WEB_ROOT` env, else `<package>/public`. If `<webRoot>/index.html` exists it serves the directory as static assets and installs the SPA fallback; otherwise it is API-only (the Electron-staged backend has no `public/`) and logs `Web UI not found at <root> (no index.html) — serving API only`.

SPA fallback rule: a request that **matched no API route and no static file** receives `index.html` (HTTP 200) if and only if all hold:

1. method is `GET` or `HEAD`,
2. the `Accept` header contains `text/html`,
3. the URL path has **no file extension** (`extname(path) === ''`).

Everything else keeps the default 404 body (`{statusCode:404, message:"Cannot GET /x", error:"Not Found"}`). API controllers always win over the fallback, and a `NotFoundException` thrown *by a handler* is not rewritten because only unmatched routes (`req.route` unset) are eligible. Consequence for clients: an API path requested with `Accept: text/html` that matches no route (typo) returns the UI, not a 404; send `Accept: application/json` when probing.

### 1.8 Conventions used by the UI that clients should preserve

- Mutating calls return the refreshed document (e.g. `session`) so the UI replaces local state rather than patching it.
- `message` strings from Style A are surfaced directly to the user.
- Secrets never come back in plaintext: datasource secrets are masked as `••••••••` (8 U+2022 bullets), the LLM key as `••••••••` + last 4 characters. A client may send the mask back unchanged to mean "keep the stored secret" (see 2.2, 2.5).

---

## 2. Endpoints

Legend for **FE**: whether the shipped frontend calls it. Document types referenced (`SessionDoc`, `ChatMessage`, `SessionVisualization`, `DatasetDoc`, `MetricDoc`, `KnowledgeSnippet`, `DatasourceView`, `CatalogInfo`, `LlmSettingsView`, `EvalRunView`) are defined in [data-model.md](data-model.md) and the shared ones in [section 2.10](#210-shared-wire-shapes).

### 2.1 Sessions

Controller prefix `/sessions`. Capability: sessions-chat, visuals.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 1 | `GET /sessions` | List all sessions | yes |
| 2 | `GET /sessions/:id` | Get one session with full transcript | yes |
| 3 | `POST /sessions` | Create a session | yes |
| 4 | `DELETE /sessions/:id` | Delete a session and its Mastra state | yes |
| 5 | `POST /sessions/:id/messages/stream` | Streamed chat turn (SSE) | yes |
| 6 | `POST /sessions/:id/messages` | Non-streamed chat turn | **no** |
| 7 | `POST /sessions/:id/messages/feedback` | Thumbs up/down on an answer | yes |
| 8 | `POST /sessions/:id/visualizations` | Generate a visual from an answer | yes |
| 9 | `GET /sessions/:id/visualizations/:vid` | Load a visual (document + metadata) | yes |
| 10 | `POST /sessions/:id/visualizations/:vid/tailor` | Tailor from an instruction | yes |
| 11 | `POST /sessions/:id/visualizations/:vid/revert` | Move the version pointer | yes |
| 12 | `POST /sessions/:id/visualizations/:vid/refresh` | Re-run SQL, refresh data in place | yes |
| 13 | `POST /sessions/:id/visualizations/:vid/repair` | One-shot silent auto-repair | yes |
| 14 | `GET /sessions/:id/visualizations/:vid/download` | Zip bundle | yes |

The session on the wire (endpoints 1-3, and the `done` event of 5) is the stored `SessionDoc` (data-model 3.4), or a preview session (endpoint 3), plus, for a session with an `agentId`, a derived `agent: { id: string; name: string; deleted: boolean; description: string; starterQuestions: string[] }`. While the agent exists, `name`, `description` and `starterQuestions` come from its Live version and `deleted` is `false`. Once it is deleted, `name` is the stored `agentName`, `deleted` is `true`, and `description` and `starterQuestions` are empty (sessions-chat R57-R59). For a preview session, `name`, `description` and `starterQuestions` come from the agent's **draft**, read at each request. It is computed on every read, never stored.

Preview sessions answer endpoints 2 and 4 to 14 like any session (a turn runs with the draft, sessions-chat R54) but are never in endpoint 1's list. Endpoint 4 on a preview discards it (memory thread and workspace included) and answers `{ ok:true, message:"Preview discarded" }`.

#### 1. `GET /sessions`
- Response `200`: `{ sessions: SessionDoc[] }`. Ordering is the repository's (most recently updated first; see data-model). No pagination; full documents including messages are returned.
- Errors: none expected.
- Also used by the Electron main process as the **backend readiness probe** (must return 200).

#### 2. `GET /sessions/:id`
- Response `200`: `SessionDoc` (bare, not enveloped).
- Errors: `404 "Session <id> not found"` (Style B).

#### 3. `POST /sessions`
- Body: `{ name: string; datasets: string[] }` or `{ agentId: string }`. `name` required (trimmed, non-empty, **truncated to 64 chars**); `datasets` must be a non-empty array of dataset **names**.
- With `agentId` (a user-agent id; sessions-chat R52): `name` and `datasets` in the body are ignored. The session takes the agent's Live name and those of its Live datasets that exist, and stores `agentId` and `agentName` (data-model 3.4).
- With `{ agentId, preview: true }` (agents-evals R60, R61): starts a **preview session** of the agent's draft. It is held in memory only (data-model 3.12), never listed and never written to the `sessions` collection. Its `id` is `preview-<uuid>`, its `name` `Preview: <draft name>`, its `datasets` those of the draft that exist, and it carries `preview: true` and `agentId`. Its derived `agent` comes from the draft. Success message `Preview started`. Failures: `"Agent \"<id>\" not found"` (also for a built-in key), `"Select at least one dataset to preview"`.
- Success: `{ ok:true, message:"Session \"<name>\" created", session: SessionDoc }` with `messages: []`, `visualizations: []`, a generated UUID `id`, and a contained Mastra workspace created and linked (`workspaceId`).
- Failures (Style A): `"session name is required"`, `"select at least one dataset"`. With `agentId`: `"Agent \"<id>\" not found"` (unknown id, or a built-in agent's key), `"Publish \"<name>\" before starting a chat"` (no Live version), `"None of this agent's datasets exist"`.
- Side effects: persists the session; creates the workspace directory `workspaces/session-<id>`.
- Without `agentId`, does not verify the named datasets exist (see G7).

#### 4. `DELETE /sessions/:id`
- Success: `{ ok:true, message:"Session \"<name>\" deleted" }`.
- Failure (Style A): `"Session <id> not found"`.
- Side effects: removes the session document and all Mastra state it owns (memory thread/resource, workspace).

#### 5. `POST /sessions/:id/messages/stream`
See [section 3.1](#31-chat-stream-post-sessionsidmessagesstream).

#### 6. `POST /sessions/:id/messages`
- Body: `{ content: string }` (required, trimmed non-empty).
- Success: `{ ok:true, message:"Message sent", session }`. Runs the assistant to completion (no streaming), appends the user message and one assistant message (text, `reasoning`, `knowledge`), persists.
- Failure (Style A): `"message is required"`, `"Session <id> not found"`, model errors.
- Weaker than the stream path: no tool-data capture (`data`, `entities`, `interpretation`, `verified`), no clarification handling, no grounding guard, no careful mode. **Not called by the frontend** (the client method exists but is unused). Treat as legacy; see G2.

#### 7. `POST /sessions/:id/messages/feedback`
- Body: `{ messageAt: string; rating: "up" | "down" }`. Both required.
- Success: `{ ok:true, message, session }` where `message` is `"Answer saved as a verified query"` for `up` and `"Answer marked as wrong"` for `down`. (The `up` sentence is returned even when no SQL was found to save.)
- Failures (Style A): `"rating must be 'up' or 'down'"`, `"messageAt is required"`, `"No assistant message at <messageAt>"`, `"Session <id> not found"`.
- Side effects on the matched assistant message: sets `feedback`; `up` sets `verified: true`, `down` removes `verified`. `up` additionally saves a **verified query** `{question, sql, datasourceId, entities, sourceSessionId, sourceMessageAt}` when the answer has a successful `run_readonly_sql` and a preceding user question (question = nearest earlier user message; sql = the last successful `run_readonly_sql` input; `datasourceId` only when all the session's datasets share one datasource). `down` deletes any verified query contributed by that message.
- Persists the updated transcript.

#### 8. `POST /sessions/:id/visualizations`
- Body: `{ sourceMessageAt?: string }`. Empty/omitted = the latest completed (non-clarification, non-empty) assistant answer.
- Success: `{ ok:true, message:"Interactive visual generated", session, visualization: InteractiveVisualization }` (version 1).
- Failures (Style A): `"completed assistant answer not found"`, `"Session <id> not found"`, `"interactive visual generation timed out; please try again"` (120 s limit), designer/validation errors.
- Side effects: writes the bundle under the session workspace (`visuals/<visualId>/v1/`), upserts `SessionDoc.visualizations`, and **logs a chat event**: appends an assistant message `Created interactive visual "<title>" (v1).` carrying `visual: {visualId, version, title, action:"created"}`.

#### 9. `GET /sessions/:id/visualizations/:vid`
- Query: `version` (optional positive integer; anything else is ignored and means "current").
- Response `200`: `InteractiveVisualization` (bare): the `SessionVisualization` metadata plus `document` (sandboxed self-contained HTML) and `version` (the version the document was assembled from).
- Errors (Style B): `404 "Visualization <vid> not found in session <id>"` / session not found; `400 "Version <n> does not exist"`.

#### 10. `POST /sessions/:id/visualizations/:vid/tailor`
- Body: `{ instruction: string }` (required, trimmed non-empty).
- Success: `{ ok:true, message:"Updated to version <n>", session, visualization }`.
- Failures (Style A): `"instruction is required"`, not-found errors, timeout, designer errors.
- Side effects: creates a new version (`v<n+1>`), updates metadata, **logs a chat event** (`Updated interactive visual "<title>" (v<n>).`, `visual.action:"updated"`). Same pipeline as the assistant's `update_visual` tool. Tailoring a freeform visual stays freeform.

#### 11. `POST /sessions/:id/visualizations/:vid/revert`
- Body: `{ version: number }`.
- Success: `{ ok:true, message:"Reverted to version <n>", session, visualization }`.
- Failures (Style A): `"Version <n> does not exist"` (also for a missing/non-numeric `version`, which arrives as `NaN`), not-found errors.
- Side effects: moves `currentVersion` only (no new files). **Logs a chat event** (`Reverted interactive visual ...`, `action:"reverted"`).

#### 12. `POST /sessions/:id/visualizations/:vid/refresh`
- Body: none.
- Success: `{ ok:true, message:"Refreshed data for version <n>", session, visualization }`.
- Behaviour: re-runs each stored `run_readonly_sql` record of the **current** version (row cap per record; non-SQL and already-failed records keep their rows; a query that fails stores its error instead of aborting the rest) and rewrites only `data.json` + `index.html` in place. **No new version, no designer call, no chat event.** When the session's datasets map to zero or several datasources, every SQL record gets an `error` (`"No datasource is bound to this session's datasets"` / `"Several datasources are in scope for this session; refresh is not supported"`) but the call still succeeds.
- Failures (Style A): not-found errors.

#### 13. `POST /sessions/:id/visualizations/:vid/repair`
- Body: `{ error?: string; version: number }`. `error` is the runtime error reported by the sandboxed frame (clipped server-side); `version` is the version the client saw failing.
- Success: `{ ok:true, message:"Repaired as version <n>", session, visualization }`.
- Failures (Style A): `"Only the current version can be repaired (requested v<x>, current v<y>)"`, `"Version <n> is already an automatic repair; not repairing again"`, not-found, timeout.
- Side effects: creates a new version whose instruction is auto-repair-prefixed, updates metadata, **no chat event** (an automatic fix is not a conversation turn). Never repairs an auto-repair.

#### 14. `GET /sessions/:id/visualizations/:vid/download`
- Query: `version` (optional positive integer; default current). The frontend never sends it (always downloads the current version).
- Response `200`: `application/zip`, `Content-Length`, `Content-Disposition: attachment; filename="<slug>-v<N>.zip"` where slug = title NFKD-normalised, non-alphanumerics to `-`, trimmed, lowercased, max 64 chars, fallback `visual-<first 8 of id>`. (The frontend ignores the header and saves as `<slug>.zip`.)
- Zip contents: `index.html` (always regenerated with the readable frame, runtime inlined so it renders standalone), `styles.css`, `qti-frame.js`, `script.js`; plus `spec.json` + `qti-chart.js` for spec visuals; `answer.md` when the source answer exists; `data.json` when data rows exist.
- Errors (Style B): 404 not found, 400 `"Version <n> does not exist"`.

### 2.2 Datasources

Controller prefix `/datasources`. Capability: datasources. Shapes: `DatasourceView`, `DatasourceConfig` (databricks / postgres / rest) in data-model.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 15 | `GET /datasources` | List saved datasources (secrets masked) | yes |
| 16 | `POST /datasources/test-connection` | Test a connection without saving | yes |
| 17 | `POST /datasources/rest/discover` | Propose REST endpoints from an OpenAPI/Swagger spec | yes |
| 18 | `POST /datasources` | Create or update a datasource | yes |
| 19 | `DELETE /datasources/:id` | Delete a datasource | yes |
| 20 | `GET /datasources/:id/inventory` | Catalog inventory (cached or live) | yes |

Route order matters: `test-connection` and `rest/discover` are declared before the parameterised routes.

**Secret handling shared by 16, 17, 18.** When the body carries `id` of a saved datasource of the same `kind`, any secret that is empty or equal to the mask `••••••••` is replaced by the stored secret before use. Secrets: Databricks `token`; Postgres `password`; REST `auth.token` and `auth.password`. This lets the UI re-test or re-save without retyping secrets. Without `id`, the config is used as sent.

#### 15. `GET /datasources`
- Response `200`: `{ datasources: DatasourceView[] }` where each is `{ id, name, kind: "databricks"|"postgres"|"rest", summary: string, config /* masked */, createdAt?, updatedAt? }`. `summary` is a human line (host/warehouse/database). Ordering is the repository's.

#### 16. `POST /datasources/test-connection`
- Body: `{ kind: "databricks"|"postgres"|"rest"; config: DatasourceConfig; id?: string }`.
- Success: `{ ok:true, message:"Connection successful" }`. Failure (Style A): `{ ok:false, message }` with the connector's error (e.g. `kind must be one of: databricks, postgres, rest`, `baseUrl is required`, `At least one endpoint is required`, driver errors).
- Side effects: none (opens and closes a connection).

#### 17. `POST /datasources/rest/discover`
- Body: `{ config: RestApiConfig; specUrl?: string; id?: string }`. `specUrl` may be absolute or relative to `config.baseUrl`; empty means try the usual spec locations.
- Success: `{ ok:true, message:"Found <n> endpoint(s)[ in \"<title>\"]", specUrl, title?, baseUrl, endpoints: DiscoveredEndpoint[], skipped: {path, reason}[] }`. `DiscoveredEndpoint = { endpoint: RestEndpointDef; method: string; summary?: string; listResponse: boolean; fields?: number }`.
- Failure (Style A): `{ ok:false, message }`.
- Side effects: outbound HTTP to the spec URL; nothing persisted.

#### 18. `POST /datasources`
- Body: `{ kind; config; name: string; id?: string }`. Present `id` = update, absent = create (new id assigned).
- Validation: `name` required (trimmed, **truncated to 64**); `kind` must be one of the three kinds.
- Success: `{ ok:true, message:"Datasource \"<name>\" saved", datasource: DatasourceView }`. Failure (Style A): `"name is required"`, `"kind must be one of: ..."`.
- Side effects: persists the datasource (secrets stored as given/restored). It does not test the connection.

#### 19. `DELETE /datasources/:id`
- Success: `{ ok:true, message:"Datasource \"<name>\" deleted" }`. Failure (Style A): `"Datasource <id> not found"`.
- Side effects: deletes the datasource and its cached inventory. **Does not cascade** to datasets that reference it (G6).

#### 20. `GET /datasources/:id/inventory`
- Query: `refresh=true` (force a live walk and replace the snapshot); `cachedOnly=true` (never contact the datasource). `cachedOnly` takes precedence over `refresh` when both are present.
- Responses (all `200`, Style A):
  - default: `{ ok:true, catalogs: CatalogInfo[], fetchedAt: string, cached: boolean }`. Serves the snapshot if present (`cached:true`), else walks live, stores the snapshot and returns `cached:false`.
  - `cachedOnly=true` with a snapshot: `{ ok:true, catalogs, fetchedAt, cached:true }`; **without** a snapshot: `{ ok:true, cached:false }` (no `catalogs`).
  - failure: `{ ok:false, message }` (`"Datasource <id> not found"`, connector error).
- `CatalogInfo` = `{ name, selectable?, schemas: { name, selectable?, tables: { name, selectable?, columns: { name, type, nullable }[] }[] }[] }` normalised to catalog → schema → table for every kind. `selectable === false` means browse-only (no query access); absent means unknown and is treated as accessible.
- A live walk can take minutes on a cold warehouse; there is no progress channel and no server timeout beyond the connector's.

### 2.3 Datasets

Controller prefix `/datasets`. Capability: datasets. Datasets are keyed by `name` (upsert), shape `DatasetDoc` in data-model.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 21 | `GET /datasets` | List datasets | yes |
| 22 | `POST /datasets` | Create or replace (upsert by name) a dataset | yes |
| 23 | `DELETE /datasets/:name` | Delete a dataset | yes |

#### 21. `GET /datasets`
- Response `200`: `{ datasets: DatasetDoc[] }`, most recently updated first. Legacy single-selection documents in the same table are skipped.

#### 22. `POST /datasets`
- Body: `{ name: string; tables: string[]; entities: DatasetEntitySnapshot[]; datasourceId: string; datasourceKind?: string }`.
  - `tables`: fully-qualified `catalog.schema.table` keys of the included entities (non-empty).
  - `entities`: schema snapshots `{ key, columns: { name, type, nullable, sampleValues?, description?, references? }[] }` captured by the client from the inventory. Only those whose `key` is in `tables` are processed.
  - `datasourceKind` optional; when present it must equal the datasource's kind.
- Validation (Style A messages): `"Dataset name is required"`, `"Include at least one entity"`, `"datasourceId is required"`, `"Datasource <id> not found"`, `"Datasource kind must be <kind>"`.
- Success: `{ ok:true, message:"Dataset \"<name>\" saved — <n> entities" }`. The saved document is **not** returned; the client re-lists.
- Side effects: enriches each entity snapshot with up to 5 distinct sample values per column (from a live sample of 50 rows per table, 4 tables concurrently; best effort, a failure leaves that snapshot as sent and never fails the save), then attaches the join graph (`references` per key column: declared foreign keys win, naming-based inference fills the rest), then upserts by `name`, binding `datasourceId` + `datasourceKind`. Re-saving an existing name replaces it and re-enriches.
- Note the controller trims `name` and `datasourceId`; `tables` entries are stringified.

#### 23. `DELETE /datasets/:name`
- Success: `{ ok:true, message:"Dataset \"<name>\" deleted" }`; if no dataset matched: `{ ok:false, message:"Dataset \"<name>\" not found" }`.
- Does not cascade to sessions or knowledge that reference the name (G6).

### 2.4 Metrics

Controller prefix `/metrics`. Capability: metrics. Shape `MetricDoc` in data-model.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 24 | `GET /metrics` | List metric definitions | yes |
| 25 | `GET /metrics/candidates` | Verified queries offered as prefilled drafts | yes |
| 26 | `POST /metrics` | Create | yes |
| 27 | `PUT /metrics/:id` | Replace | yes |
| 28 | `DELETE /metrics/:id` | Delete | yes |

`MetricInput` (request body for 26 and 27): `{ name: string; label: string; entity: string; expression: string; description?: string; datasourceId?: string; dimensions?: string[]; sourceVerifiedQueryId?: string }`. Non-string required fields are coerced to `''` before validation.

#### 24. `GET /metrics`
- Query: `entities` (optional, comma-separated fully-qualified entity keys; case-insensitive match). Absent/blank = all metrics. When present, returns only metrics whose `entity` is in the list (an all-blank list after trimming counts as absent).
- Response `200`: `{ metrics: MetricDoc[] }`.

#### 25. `GET /metrics/candidates`
- Query: `entities` as above (scopes by the candidate's first entity).
- Response `200`: `{ candidates: MetricCandidate[] }`, at most 12. `MetricCandidate = { verifiedQueryId, name, label, entity, datasourceId?, sql }`. `name` is a slug of the verified question, `label` the question itself, `entity` the pair's first entity, `sql` the approved statement. Verified queries already promoted (referenced by a metric's `sourceVerifiedQueryId`) and those without entity provenance are excluded. The expression is intentionally not guessed.

#### 26. `POST /metrics` and 27. `PUT /metrics/:id`
- Normalisation: `name` trimmed and lowercased; `label`, `entity`, `expression`, `description` trimmed; `dimensions` entries stringified/trimmed/non-empty; empty optional fields are omitted. On `PUT`, optional fields absent from the body are **cleared** from the stored document (full replace of optional fields).
- Validation (Style A messages): `"Metric name is required"`; `"Metric name must be 64 characters or fewer"`; name must match `^[a-z][a-z0-9_]*$` (`"Metric name must be lowercase letters, digits and underscores, starting with a letter (e.g. denial_rate)"`); `"Metric label is required"`; `"Metric entity is required"`; `"Metric expression is required"`; expression must not contain `;` (`"Metric expression must be a single SQL expression (no semicolons)"`); name must be unique case-insensitively (`"Metric \"<name>\" already exists"`, a rename to its own name is allowed). `PUT` on an unknown id: `"Metric <id> not found"` (note: surfaced as a 400-class message, still enveloped).
- Success: `{ ok:true, message:"Metric \"<label>\" saved" | "Metric \"<label>\" updated", metric: MetricDoc }`.
- Side effects: persists; the metric then feeds the assistant's per-turn "governed metrics" context block for sessions whose entities include `entity`.

#### 28. `DELETE /metrics/:id`
- Success: `{ ok:true, message:"Metric \"<label>\" deleted" }` (no `metric` field). Failure: `"Metric <id> not found"`.

### 2.5 LLM settings

Controller prefix `/llm`. Capability: llm-settings. One persisted singleton document, API key encrypted at rest (AES-256-GCM keyed by `APP_SECRET`).

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 29 | `GET /llm/settings` | Read settings (key masked) | yes |
| 30 | `PUT /llm/settings` | Save settings (tests first) | yes |
| 31 | `PUT /llm/reasoning` | Set reasoning effort only | yes |
| 32 | `POST /llm/test-connection` | Test candidate settings | yes |
| 32a | `GET /llm/effort-levels` | Effort levels a model accepts | yes |

```ts
type LlmProvider = 'openai' | 'anthropic' | 'lenai';
// Ordered lowest to highest; each model accepts a subset (agents.md 1.4).
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
interface SaveLlmSettingsDto { provider: LlmProvider; model: string; apiKey?: string; baseUrl?: string; reasoningEffort?: ReasoningEffort }
interface EffortLevelsView {
  levels: ReasoningEffort[];              // lowest first; [] = the model has no reasoning effort
  defaultEffort: ReasoningEffort | null;  // 'high' when offered, else the first level; null when levels is []
  probeEffort: ReasoningEffort | null;    // the lowest level, sent by the connection probe; null when levels is []
}
interface LlmSettingsView {
  provider: LlmProvider | null; model: string | null; baseUrl: string | null;
  apiKeyMasked: string | null;   // "••••••••" + last 4 chars of the key
  reasoningEffort: ReasoningEffort;   // default 'high'
  configured: boolean;
  keyUnreadable?: true;   // present only when a stored key cannot be decrypted with the current APP_SECRET
}
```

#### 29. `GET /llm/settings`
- Response `200`: `LlmSettingsView` (bare). Nothing stored: `{ provider:null, model:null, baseUrl:null, apiKeyMasked:null, reasoningEffort:"high", configured:false }`.
- Stored key that cannot be decrypted with the current `APP_SECRET`: still `200`, with `configured:false`, `keyUnreadable:true`, the stored `provider`, `model`, `baseUrl` and `reasoningEffort`, and `apiKeyMasked:null`.

#### 30. `PUT /llm/settings`
- Body: `SaveLlmSettingsDto`. `apiKey` omitted or blank = use the stored key. For `lenai`, `model` is the deployment name and `baseUrl` is required. `anthropic` takes an API key only (no subscription logins).
- Validation (Style A): `"provider must be one of: openai, anthropic, lenai"`, `"model is required"`, `"baseUrl is required for lenai"`, `"apiKey is required — none stored yet"`, and, with no `apiKey` and a stored key that cannot be decrypted, `"The saved API key can't be read because the app secret changed — enter it again in Settings → LLM Configuration"` (same for `POST /llm/test-connection`).
- **The settings are tested against the provider before they are persisted**; a failing test fails the save with the provider's error text and nothing is stored.
- `reasoningEffort` (optional) must be one of the model's levels (32a), else the save fails with `"reasoning effort must be one of: <levels, comma-separated>"` before any provider call. Omitted: the stored effort is kept when the model offers it, else the model's `defaultEffort`; for a model with no levels the stored effort (or `high`) is kept unchanged.
- Success: `{ ok:true, message:"Configuration saved", settings: LlmSettingsView }`.
- Side effects: persists (key encrypted); subsequent agent turns resolve the model from these settings.

#### 31. `PUT /llm/reasoning`
- Body: `{ effort: "low"|"medium"|"high" }`. This is the composer's menu; it still offers only these three.
- Success: `{ ok:true, message:"Reasoning effort set to <effort>", settings }`. Failures: `"reasoning effort must be one of: low, medium, high"`, `"Configure and save the LLM first — no settings stored yet"`.
- Applied per model: mapped to the nearest level the model accepts, translated to the provider's native option, and dropped for Anthropic models that reject it (agents.md 1.4).

#### 32. `POST /llm/test-connection`
- Body: `SaveLlmSettingsDto` (same rules as save, nothing persisted; `reasoningEffort` is ignored). Sends one cheap fixed prompt using the candidate settings at the model's `probeEffort` (32a; none sent when the model has no levels); 30 s timeout.
- Success: `{ ok:true, message:"Connection successful — <provider>/<model> replied \"<reply>\" in <ms>ms" }`. Failure: `{ ok:false, message }` (validation errors, provider HTTP errors, `"LLM request timed out after 30s"`).

#### 32a. `GET /llm/effort-levels`
- Query: `provider` (`openai`|`anthropic`|`lenai`) and `model` (the model or deployment name, trimmed). Both optional; an empty model answers `{ levels: [], defaultEffort: null, probeEffort: null }`.
- Response `200`: `EffortLevelsView` (bare), from the built-in table in [agents.md](agents.md) section 1.4. Pure lookup: no provider call, nothing stored.

### 2.6 Agents, hub and evals

Controller prefix `/agents`. Capability: agents-evals. `:key` is the Mastra registry key (`assistant`, `interactive-visual-designer`, `sql-fixer`, `sql-verifier`, `knowledge-bootstrap`, `assistant-eval-judge`; see [agents.md](agents.md)) **or** the id of a user agent ([data-model.md](data-model.md) section 3.10); the registry is checked first. `:id` is always a user-agent id. The catalogue merges both kinds. Rules: R43-R52 in [agents-evals](../capabilities/agents-evals/spec.md). The user-agent routes are declared before `GET /agents/:key`.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 33 | `GET /agents` | Agent catalogue | yes |
| 34 | `GET /agents/:key` | One agent in detail | yes |
| 35 | `GET /agents/:key/evals` | Eval question sets | yes |
| 36 | `POST /agents/:key/evals/run` | Start an eval run | yes |
| 37 | `GET /agents/:key/evals/runs` | Run history | yes |
| 38 | `GET /agents/:key/evals/runs/:jobId` | Poll one run | yes |
| 39 | `GET /agents/:key/evals/runs/:jobId/download` | Run report as Markdown | yes |
| 40 | `DELETE /agents/:key/evals/runs/:jobId` | Delete a finished run | yes |
| 41 | `POST /agents` | Create a user agent (as a draft) | no |
| 42 | `PUT /agents/:id/draft` | Save a user agent's draft | no |
| 43 | `POST /agents/:id/publish` | Publish the draft (makes it Live) | yes |
| 44 | `DELETE /agents/:id` | Delete a user agent | yes |
| 45 | `PUT /agents/:key/pin` | Pin or unpin any agent | yes |

#### 33. `GET /agents`
- Response `200`: `{ agents: AgentSummary[] }` sorted by `name`, built-in and user agents together.
- `AgentSummary = { key, id, name, description, tools: string[] /* sorted tool names; a user agent shows the assistant's */, kind: 'official'|'system'|'user', status: 'builtin'|'draft'|'live', pinned: boolean, owner: 'Official'|'System'|'You', hasUnpublishedChanges: boolean, missingDatasets: string[], datasets: string[], starterQuestions: string[] }`.
- For a user agent `key` equals `id`, and `name`, `description`, `datasets` and `starterQuestions` come from the Live version when there is one, else the draft. For a built-in agent `status` is `builtin`, `hasUnpublishedChanges` is `false` and `datasets`, `starterQuestions` and `missingDatasets` are empty. `kind` is `official` for `assistant` and `system` for the other five.

#### 34. `GET /agents/:key`
- Response `200`: `AgentDetail = AgentSummary & { draft?: AgentConfig; live?: AgentConfig /* user agents only; shapes in data-model 3.10 */; instructions: string /* prompt flattened to text */; toolDetails: { name, description, inputs: string[] /* top-level input param names */ }[]; memory: { storage: string|null; lastMessages: number|false|null; semanticRecall: boolean; workingMemory: boolean; generateTitle: boolean } | null; model: { id: string; provider: string } | null /* null when no LLM settings saved */ }`.
- A user agent runs on the assistant, so its `instructions`, `toolDetails`, `memory` and `model` describe the assistant. Its own instructions are in `draft` and `live`.
- Errors (Style B): `404 "Agent \"<key>\" not found"`. `:key` is resolved as a registry key first, then as a user-agent id.

#### 35. `GET /agents/:key/evals`
- Response `200`: `{ sets: AgentEvalSet[] }`. Only `assistant` has sets; any other key returns `{ sets: [] }` (no 404). `AgentEvalSet = { id, name, description, cases: { id, question, intent, checks: { id, name, description }[] }[] }`.

#### 36. `POST /agents/:key/evals/run`
- Body: `{ datasourceId: string; caseIds?: string[] }`. `caseIds` omitted = all questions.
- Success: `{ ok:true, message:"Eval run started", jobId }`. Returns immediately; the run is long-running (see [3.3](#33-eval-runs)).
- Failures (Style A, `ok:false`): `"Agent \"<key>\" has no evals to run"` (non-assistant); `"An eval run is already in progress for this agent"` (also returns the running `jobId`); `"Pick a datasource to run against"`; `"That datasource has no datasets — create one in Datasets before running evals"`; `"Pick at least one question to run"`; fixture/dataset coverage errors (the datasets bound to the datasource must expose the entities the selected questions need).
- Side effects: persists an initial run record; spawns the run (one throwaway session is created for the run to host visual tools and deleted afterwards).

#### 37. `GET /agents/:key/evals/runs`
- Response `200`: `{ runs: EvalRunView[] }`, newest first; in-flight runs reflect live in-memory state.

#### 38. `GET /agents/:key/evals/runs/:jobId`
- Response `200`: `{ ok:true, message:<status>, ...EvalRunView }`; unknown job: `{ ok:false, message:"Eval run \"<jobId>\" not found" }` (HTTP 200). `:key` is ignored by the lookup.

#### 39. `GET /agents/:key/evals/runs/:jobId/download`
- Response `200`: `text/markdown; charset=utf-8`, `Content-Disposition: attachment; filename="eval-run-<agentKey>-<YYYY-MM-DD-HH-mm-ss>-<first 8 of jobId>.md"`. Body: summary, failures, traces, answers, and the regression comparison when present; the datasource is shown by name.
- Errors (Style B): `404 "Eval run \"<jobId>\" not found"`.

#### 40. `DELETE /agents/:key/evals/runs/:jobId`
- Success: `{ ok:true, message:"Run deleted" }`. A run still `running`, or an unknown id, returns `{ ok:false, message:"Cannot delete a run that is still going" }` (the same message for both cases).

#### 41. `POST /agents`
- Body: `{ name: string; description?: string; instructions?: string; datasets?: string[]; starterQuestions?: string[]; model?: string; reasoningEffort?: 'low'|'medium'|'high' }`. Limits and normalisation: R43.
- Success: `{ ok:true, message:"Agent \"<name>\" saved as draft", agent: AgentSummary }`. The agent is a draft, not pinned.
- Failures (Style A): `"Agent name is required"`; `"An agent named \"<name>\" already exists"`.

#### 42. `PUT /agents/:id/draft`
- Body: as endpoint 41. Replaces the whole draft; a Live version is untouched.
- Success: `{ ok:true, message:"Draft saved", agent: AgentSummary }`.
- Failures (Style A): `"Agent \"<id>\" not found"`; `"Agent name is required"`; `"An agent named \"<name>\" already exists"`; `"Built-in agents can't be edited"` (`:id` is a registry key).

#### 43. `POST /agents/:id/publish`
- No body. Copies the draft to the Live version and stamps `publishedAt`.
- Success: `{ ok:true, message:"Agent \"<name>\" is Live", agent: AgentSummary }`.
- Failures (Style A): `"Agent \"<id>\" not found"`; `"Select at least one dataset to publish"`; `"Agent name is required"`; `"Built-in agents can't be edited"`.

#### 44. `DELETE /agents/:id`
- Success: `{ ok:true, message:"Agent \"<name>\" deleted" }`. Sessions that reference the agent are not touched; they read as `agent.deleted: true` from then on (section 2.1).
- Failures (Style A): `"Agent \"<id>\" not found"`; `"Built-in agents can't be deleted"`.

#### 45. `PUT /agents/:key/pin`
- Body: `{ pinned: boolean }`. `:key` is a registry key or a user-agent id. A user agent's pin is stored on its document; a built-in agent's in the settings document `builtin-agent-pins` (data-model 3.2).
- Success: `{ ok:true, message:"Pinned" | "Unpinned", agent: AgentSummary }`.
- Failures (Style A): `"Agent \"<key>\" not found"`.

`EvalRunView` (wire shape; `comparison` is present on the wire but absent from the frontend type, see G5):

```ts
interface EvalRunView {
  jobId: string; agentKey: string; datasourceId: string;
  datasets: string[];            // dataset names bound to the datasource
  caseIds: string[]; totalCases: number;
  status: 'running' | 'completed' | 'failed';
  results: AssistantEvalCaseResult[];   // finished questions, in order
  currentQuestion?: string; error?: string;
  startedAt: string; finishedAt?: string;
  comparison?: { previousRunId: string; regressions: {id,question}[]; improvements: {id,question}[]; unchanged: {id,question}[] };
}
interface AssistantEvalCaseResult {
  id: string; question: string;
  scores: Record<string, number>;                     // per scorer id, 0..1
  checkResults: { id: string; description: string; score: number; passed: boolean; reason?: string }[];
  answer: string;
  toolCalls: { name: string; input?: string; output?: string; error?: string }[];   // JSON-encoded, truncated to ~2000 chars each
  passed: boolean;                                    // every scorer scored 1
  error?: string; durationMs: number;
}
```

### 2.7 Deep analysis

Controller prefix `/sessions` (same prefix as 2.1, separate controller). Capability: deep-analysis. Jobs live **in memory** (lost on restart); finished reports persist in the session workspace.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 46 | `POST /sessions/:id/deep-analysis` | Start a job | yes |
| 47 | `GET /sessions/:id/deep-analysis/:jobId` | Poll a job | yes |
| 48 | `GET /sessions/:id/deep-analysis/:jobId/download` | Report as Markdown | yes |

#### 46. `POST /sessions/:id/deep-analysis`
- Body: `{ question: string }` (required, trimmed non-empty).
- Success: `{ ok:true, message:"Deep analysis started", jobId }`. Returns immediately; one running job per session.
- Failures (Style A): `"question is required"`, `"Session <id> not found"`, conflict `{ ok:false, message:"A deep analysis is already running for this session", jobId:<running job> }`.
- Side effects: runs in the background (see [3.2](#32-deep-analysis)); on completion appends an assistant message to the session carrying `report: { jobId, title, path, angles }` whose `content` is the executive summary; on failure appends an assistant message `Deep analysis of "<question>" could not be completed — <detail>`.

#### 47. `GET /sessions/:id/deep-analysis/:jobId`
- Response `200`: `{ ok:true, message: progress ?? status, jobId, status, progress?, step?, steps?, title?, error? }` where `status ∈ planning | investigating | writing | done | error`. Unknown job or a job belonging to another session: `{ ok:false, message:"Deep analysis <jobId> not found" }`. After a backend restart every old job is unknown, but the report stays downloadable (43).

#### 48. `GET /sessions/:id/deep-analysis/:jobId/download`
- Response `200`: `text/markdown; charset=utf-8`, `Content-Disposition: attachment; filename="<slug-of-title>.md"` (fallback `deep-analysis-<first 8 of jobId>.md`; after a restart the title is unknown so the fallback applies).
- Errors (Style B): `400 "invalid deep analysis id"` (jobId must match `^[a-zA-Z0-9-]+$`), `404 "No deep analysis report for <jobId>"`, session not found.
- Reads the stored report from the workspace (`reports/` directory) by id, independent of in-memory state.

### 2.8 Knowledge

Controller prefix `/knowledge`. Capability: knowledge. **Style B throughout** (real status codes, bare bodies). Shape `KnowledgeSnippet` in data-model.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 49 | `GET /knowledge` | List snippets (filterable) | yes |
| 50 | `POST /knowledge` | Create a user snippet | yes |
| 51 | `PATCH /knowledge/:id` | Partial update | yes |
| 52 | `DELETE /knowledge/:id` | Delete (204) | yes |
| 53 | `POST /knowledge/bootstrap` | Draft snippets from a dataset (one shot) | **no** |
| 54 | `POST /knowledge/bootstrap/stream` | Same run, streamed progress (SSE) | yes |

Route order: `bootstrap` and `bootstrap/stream` are POST-only literals and do not collide with `PATCH/DELETE :id`.

#### 49. `GET /knowledge`
- Query (all optional, lenient: an unrecognised value is dropped, not rejected): `datasetId` (that dataset's snippets **plus every global one**), `kind` (`instruction | term | default_filter`), `source` (`user | mined`), `enabled` (`true | false`).
- Response `200`: **`KnowledgeSnippet[]`** (a bare array, unlike the other list endpoints), `updatedAt` descending.

#### 50. `POST /knowledge`
- Body: `{ kind; title: string; body: string; scope?: { datasetId?: string; datasourceId?: string } | null; synonyms?: string[]; entities?: string[]; enabled?: boolean }`.
- Validation: `400` `"kind must be one of: instruction, term, default_filter"`, `"title is required"`, `"body is required"` (title/body trimmed). `scope` is normalised: non-object, or an object with neither id, becomes `null` (global). `synonyms`/`entities` are trimmed and de-blanked. `enabled` defaults to `true`.
- Response `201`: the created `KnowledgeSnippet` (`source:"user"`, `id` generated, timestamps set).

#### 51. `PATCH /knowledge/:id`
- Body: any subset of the create fields. **Only fields present on the body are applied**; absent fields are untouched. A present `scope: null` makes the snippet global; a present `synonyms: []` clears them.
- Validation: `400` on invalid `kind`, `"title must not be empty"`, `"body must not be empty"`. `404 "Knowledge snippet <id> not found"`.
- Response `200`: the updated `KnowledgeSnippet`.

#### 52. `DELETE /knowledge/:id`
- Response `204` (empty). `404 "Knowledge snippet <id> not found"`.

#### 53. `POST /knowledge/bootstrap`
- Body: `{ datasetId: string }` (the dataset's **name**).
- Response `201`: `{ created: KnowledgeSnippet[] }`.
- Errors: `400 "datasetId is required"`, `400 "Dataset \"<id>\" not found"`, `400 "Knowledge bootstrap failed: <reason>"` (LLM error, malformed output, no usable drafts). Never a raw 500 by design.
- Not called by the frontend; the streamed variant (54) replaced it for UX (G3).

#### 54. `POST /knowledge/bootstrap/stream`
See [section 3.4](#34-knowledge-bootstrap-stream-post-knowledgebootstrapstream).

Bootstrap semantics shared by 53 and 54: the `knowledge-bootstrap` agent drafts kinds `instruction | term | default_filter` from the dataset's stored schema snapshot plus a sample of rows (see [agents.md](agents.md)); at most `MAX_BOOTSTRAP_DRAFTS` drafts are kept; a draft is skipped when its title (case-insensitive) already exists for that dataset or in the same batch; survivors are persisted with `scope: { datasetId }`, `source: "mined"`, **`enabled: false`** for human review.

### 2.9 Testing data

Controller prefix `/testing-data`. Capability: testing-data. Provisions bundled sample databases ("fixtures", e.g. the World Cup sample) into a PostgreSQL server the user names.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 55 | `GET /testing-data` | Fixture list and load status | yes |
| 56 | `POST /testing-data/:fixtureId/load` | Seed / register a fixture | yes |
| 57 | `DELETE /testing-data/:fixtureId` | Forget a fixture app-side | yes |

#### 55. `GET /testing-data`
- Response `200`: `{ fixtures: SampleFixtureView[] }`. Never fails: if the stores are unreadable it returns the same list with every fixture `loaded:false` (and logs a warning).

```ts
interface SampleFixtureView {
  id: string; name: string; description: string;
  seedable: boolean;               // false = register-only (no seed SQL shipped)
  schema: string;                  // e.g. "world_cup"
  defaults: PostgresConnection;    // prefill for the form
  status: {
    loaded: boolean;               // datasource AND dataset exist with all required entities
    datasourceId?: string; datasourceName?: string; datasetName?: string;
    entityCount?: number; requiredCount: number;
    connection?: Omit<PostgresConnection, 'password'>;   // never carries the password
  };
}
interface PostgresConnection { host: string; port: number; database: string; user: string; password: string; ssl: boolean }
```

#### 56. `POST /testing-data/:fixtureId/load`
- Body: `{ host, port, database, user, password?, ssl? }` (all coerced from untyped JSON). Required: non-empty `host`, `database`, `user`; `port` an integer 1..65535; `database` must not contain `"`. `password` defaults to `''`; `ssl` true only for `true` or `"true"`.
- Response `200` (Style A): `{ ok, message, datasourceId?, datasetName?, entityCount?, createdDatabase?, seeded? }`.
  - Success messages: seedable `"Seeded <schema> on <host:port> and loaded <n> entities into dataset \"<name>\"[ — created the database]"`; register-only `"Registered <host:port>/<db> and loaded <n> entities into dataset \"<name>\" — the <name> sample ships no seed SQL, so nothing was written to the database"`.
  - Failure messages: unknown fixture (`Unknown sample fixture "<id>"`), REST-kind fixtures (registered by a script, not here), field validation, connection failure, missing database that cannot be created, seed failure, and `"Missing entities after seeding|registering: <list>. ..."` (returns `ok:false` but still includes `datasourceId`, `createdDatabase`, `seeded`).
- Side effects (seedable): connects (8 s timeout); if the database is absent, creates it from the `postgres` maintenance database; **drops and recreates the sample's schema** (`DROP SCHEMA IF EXISTS "<schema>" CASCADE`) and runs the bundled SQL in batches (120 s statement timeout); upserts a datasource named after the fixture (reusing the existing id when present); forces an inventory refresh; saves the fixture's dataset (with sampled values and join graph, same as `POST /datasets`). Register-only fixtures skip the seed and require the data to exist already.

#### 57. `DELETE /testing-data/:fixtureId`
- Response `200` (Style A): `{ ok:true, message:"Removed the <name> datasource and dataset from this app. The database itself was left untouched." }`, `{ ok:true, message:"Nothing to remove — the sample is not loaded" }`, or `{ ok:false, message:"Unknown sample fixture \"<id>\"" }`.
- Side effects: deletes the fixture's dataset, then its datasource (and cached inventory). The target database is never touched.

### 2.10 Shared wire shapes

```ts
// A session as returned by 1, 2 and embedded in many results. See data-model.md for persisted semantics.
interface SessionDoc {
  id: string; name: string; workspaceId?: string;
  datasets: string[];                       // dataset names
  messages: ChatMessage[];
  visualizations?: SessionVisualization[];
  createdAt?: string; updatedAt?: string;
}
interface ChatMessage {
  role: 'user' | 'assistant'; content: string; at: string;   // `at` is the message's identity
  data?: ToolDataRecord[]; entities?: string[];
  clarification?: { question: string; options: { label: string; description?: string }[] };
  visual?: VisualEvent; verified?: boolean; interpretation?: string;
  feedback?: 'up' | 'down'; crossCheck?: { status: 'agree'|'disagree'|'error'; note?: string };
  reasoning?: ReasoningStep[]; knowledge?: KnowledgeUse[]; report?: AnalysisReport;
}
interface ToolDataRecord {
  tool: string; input?: string;                       // SQL text or entity name
  columns?: string[]; rows?: Record<string, unknown>[];   // rows capped at 200 when stored
  rowCount?: number; truncated?: boolean; error?: string; rationale?: string; warnings?: string[];
}
interface VisualEvent { visualId: string; version: number; title: string; action: 'created'|'updated'|'reverted' }
interface InteractiveVisualization extends SessionVisualization { document: string; version: number }
interface SessionActionResult { ok: boolean; message: string; session?: SessionDoc; visualization?: InteractiveVisualization }
```

`SessionVisualization`, `ReasoningStep`, `KnowledgeUse`, `AnalysisReport` are in data-model.md.

---

### 2.11 Developer settings

Controller prefix `/developer-settings`. Capability: developer-settings. One setting per data directory, stored as a file (see [data-model.md](data-model.md) §1.2), not as a collection. The backend reads it once, at startup, as the **active** setting (ADR-0006).

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 53 | `GET /developer-settings` | Saved and active setting, restart flag | yes |
| 54 | `PUT /developer-settings` | Save the setting (applies on restart) | yes |
| 55 | `POST /developer-settings/test-endpoint` | Probe an OTLP endpoint | yes |

```ts
interface DeveloperSettings { observabilityEnabled: boolean; phoenixEndpoint: string; otlpEndpoint: string }
interface DeveloperSettingsView {
  saved: DeveloperSettings;    // what the file holds now (defaults when absent)
  active: DeveloperSettings;   // what this backend read at startup
  restartRequired: boolean;    // saved differs from active
}
```

#### 53. `GET /developer-settings`
- Response `200`: `DeveloperSettingsView` (bare). No file: `saved` and `active` are the defaults `{ observabilityEnabled:false, phoenixEndpoint:"http://localhost:6006", otlpEndpoint:"http://localhost:4318" }`, `restartRequired:false`. Never fails on a bad file: invalid values fall back to their defaults.

#### 54. `PUT /developer-settings`
- Body: `DeveloperSettings`. `observabilityEnabled` is true only for `true`. Endpoints are trimmed, and trailing slashes removed.
- Validation (Style A): `"Phoenix endpoint must be an http(s) URL"`, `"OTLP endpoint must be an http(s) URL"`. Reachability is not checked.
- Success: `{ ok:true, message:"Developer settings saved — restart to apply" | "Developer settings saved", settings: DeveloperSettingsView }`. The first message is used when `restartRequired` is true after the save.
- Side effects: writes the file atomically (temporary file, then rename). The active setting is unchanged.

#### 55. `POST /developer-settings/test-endpoint`
- Body: `{ endpoint: string }`. Same URL rule as the save (`"Endpoint must be an http(s) URL"`); nothing persisted.
- Sends `POST <endpoint>/v1/traces`, `Content-Type: application/x-protobuf`, empty body (an empty OTLP export), 3 s timeout.
- Response `200` (Style A): `{ ok:true, message:"Reachable — <endpoint> accepted an OTLP trace export in <ms>ms" }`; `{ ok:false, message:"Endpoint answered <status> — not an OTLP trace receiver" }`; `{ ok:false, message:"Unreachable — <detail>" }` (network error, or `timed out after 3s`).

## 3. Streaming and long-running work

Two Server-Sent-Events endpoints exist (chat, knowledge bootstrap). Both are POST, so they are read with `fetch` + `response.body.getReader()` and a `TextDecoder`, **not** `EventSource`. Two background-job patterns use start + poll instead of SSE (deep analysis, eval runs).

### 3.1 Chat stream: `POST /sessions/:id/messages/stream`

**Request.** `Content-Type: application/json`

```ts
interface StreamMessageRequest {
  content: string;                 // required, trimmed, non-empty
  activeVisualizationId?: string;  // visual open in the right panel (so update_visual targets it); ignored unless a string
  careful?: boolean;               // only `true` enables careful mode (cross-check before `done`)
}
```

**Response headers.** `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`; headers are flushed immediately, so the HTTP status is **always 200** once the handler runs. Consequently *every* failure, including an unknown session or an empty message, arrives as an in-stream `error` event, not as a 4xx.

**Framing.** Each event is a single `data: <JSON>\n\n` frame. No `event:` or `id:` fields, no `retry:`, no heartbeat/comment frames. Readers split on `\n\n`, take the line starting with `data: ` and `JSON.parse` it; malformed frames are skipped.

**Event envelope.** `{ type, content?, session? }`. `content` is a string; for `tool`, `tool-result` and `visual-updated` it is itself **a JSON-encoded string** (double encoding) that the client parses.

| `type` | Payload | Meaning |
|---|---|---|
| `reasoning` | `content: string` (delta) | Model reasoning text delta, for a live "thinking" display. Not persisted. Empty deltas are not emitted. |
| `text` | `content: string` (delta) | Answer text delta. Concatenation of all `text` deltas is the streamed answer. One extra full-text `text` event may follow if a tool-only turn needed a synthesis pass. |
| `tool` | `content: JSON string` `{ name: string; rationale?: string }` | A tool call started. `rationale` is the assistant's plain-language reason (flattened, max 400 chars) and is sent **with the call**, before the result. Legacy clients may receive a bare tool name instead of JSON; readers must fall back to treating non-JSON content as the name. Not emitted for `ask_clarification`. |
| `tool-result` | `content: JSON string` | A tool call finished. For data tools (`run_readonly_sql`, `sample_rows`): `{ tool, input?, rowCount?, error?, rationale? }`. For visual tools (`create_visual`, `update_visual`): `{ tool, input? /* the instruction */, error? }`. **No `tool-result` is emitted for other tools** (`list_entities`, `describe_entity`). Row data is not streamed, only persisted in the final message. |
| `visual-updated` | `content: JSON string` `VisualEvent` `{ visualId, version, title, action: "created"\|"updated" }` | A visual tool produced a visual this turn; sent just before that tool's `tool-result`. The panel refreshes live. |
| `done` | `session: SessionDoc` | **Terminal, success.** The persisted session with this turn's messages. |
| `error` | `content: string` | **Terminal, failure.** Human-readable message (`"message is required"`, `"Session <id> not found"`, provider/model errors). |

**Ordering.**

```
[reasoning* | text* | (tool → [visual-updated] → tool-result)*]  interleaved in model order
 → (optional silent post-processing)
 → done            or            error
```

- `tool` always precedes its own `tool-result`; parallel/interleaved calls are possible. `visual-updated` precedes the matching `tool-result`.
- After the model stream ends there can be **silent server-side steps with no events**: a tool-disabled synthesis pass (only if the turn produced no text and no visual; emits one `text` event with the result, or falls back to the fixed message `"I completed the data analysis but could not produce a final response. Please retry your question."`), the **zero-SQL grounding guard** (one corrective pass when a non-empty answer called no tool at all), the verified-query match, and the **careful-mode cross-check** (`crossCheck` verdict). No keepalive is sent during them.
- **The streamed deltas are not authoritative.** The grounding guard may replace the answer text after it was already streamed. The client must replace its whole message list with `done.session` rather than keep the deltas.

**Termination.**

- The server writes `done` or `error` and then ends the response. A reader that sees end-of-stream with neither terminal event treats it as a failed stream (the shipped client reports `"Stream ended before completion"`).
- `done` is also sent when the turn ended on a **clarification** (see below). It is *not* sent when the client aborted.

**Persistence and side effects.**

1. The user message is persisted **before** the model starts (so a stop during provider connect still keeps the prompt). If the transcript already ends with that exact unanswered user prompt (retry after a failed turn) it is reused, not duplicated.
2. On completion one assistant message is appended and persisted: `content` = answer text (or, for a visual-only turn with no text, `Created|Updated interactive visual "<title>" (v<n>).`), plus `data`, `entities`, `interpretation`, `reasoning`, `knowledge`, `verified`, `visual`, `crossCheck` as applicable. Visual tools persist visual metadata mid-turn; the final write reloads the session so it is preserved.
3. `ask_clarification` ends the turn immediately: the server aborts the model run, persists an assistant message whose `content` is the question and whose `clarification` holds `{ question, options }` (carrying any `data`/`entities`/`reasoning`/`knowledge` gathered before the question), and emits `done`. The user's pick arrives as the next message.
4. Zero text and no visual: nothing is appended (the user message remains).

**Abort / stop.**

- The client stops by aborting the `fetch` (`AbortController`). The server listens for the response `close` event and aborts the model turn. No further events are sent and **no `done`/`error` is emitted**.
- Whatever text had already streamed is still persisted as a (partial) assistant message together with captured `data`; the careful-mode cross-check is skipped. The client should reload the session (`GET /sessions/:id`) to show the persisted state; the shipped chat does this.
- Abort errors are swallowed silently on both sides.

**Errors mid-stream.** Any thrown error that is not an abort is caught by the controller and sent as `{ type:"error", content: <message> }`, then the response ends. The user message stays persisted; no assistant message is added. A failed connect on the client yields `"Backend unreachable"`, a non-2xx or bodyless response yields `"Stream failed (<status>)"`, a read failure yields `"Stream disconnected"`.

### 3.2 Deep analysis

Pattern: **start, poll, then download**. Endpoints 46-48.

- State machine: `planning` → `investigating` (one step per angle, 1..`steps`, at most 5 angles, 3-5 planned) → `writing` → `done`; any failure → `error`. Not resumable.
- Progress is observed by polling `GET /sessions/:id/deep-analysis/:jobId` (the shipped chat polls every **3000 ms**, gives up after 5 consecutive poll failures). `progress` is the human line for the pending card: `"Planning the investigation"`, `"Investigating angle <i> of <n>: <title>"`, `"Writing the report"`, `"Report ready — <n> angle(s) investigated"`, `"Deep analysis failed"`. `step`/`steps` are 1-based.
- Completion is also observable in the transcript: on `done` an assistant message with `report` is appended; on `error` an assistant failure message is appended (so a reload shows the outcome even if polling stopped).
- One running job per session (conflict returns the running `jobId` with `ok:false`). Job records are in memory (50 most recent kept); aborted on backend shutdown. Reports persist in the workspace and remain downloadable.

### 3.3 Eval runs

Pattern: **start, poll, list, download, delete**. Endpoints 36-40.

- One running run per agent (`conflictWith` surfaced as `ok:false` + `jobId`).
- A run executes the selected questions sequentially against the datasets bound to the datasource. After every question the finished result is appended to `results` and the record is persisted (a crash mid-suite keeps finished questions). `currentQuestion` names the question in flight.
- Observed by polling `GET /agents/:key/evals/runs/:jobId` (the shipped UI polls every **1500 ms** until `status !== "running"`); the run history (`…/runs`) reads persisted records with live in-memory state overlaid for in-flight runs. Persisted runs survive restart; an interrupted run is not resumed and its stored `status` may stay `running` (G4).
- On completion the run is compared with the most recent previous completed run for the same agent, datasource and datasets, and `comparison` (regressions, improvements, unchanged by case id) is attached; a comparison failure never fails the run.
- Cannot delete a run while it is `running`.

### 3.4 Knowledge bootstrap stream: `POST /knowledge/bootstrap/stream`

**Request.** `{ datasetId: string }` (dataset name). Same headers and framing as 3.1 (`data: <JSON>\n\n`, HTTP 200 once started; even `datasetId is required` arrives as an `error` event).

| `type` | Payload | Meaning |
|---|---|---|
| `progress` | `{ type:"progress", key: "dataset"\|"schema"\|"sample"\|"draft"\|"save", message: string }` | A stage started. Messages: `Opening dataset “<name>”`, `Reading schema — <n> table(s)`, `Sampling rows — <done> of <total> table(s)` (repeats as tables complete), `Drafting instructions, terms and default filters`, `Saving <n> draft(s) for review`. |
| `done` | `{ type:"done", created: KnowledgeSnippet[] }` | **Terminal, success.** Persisted drafts (disabled, `source:"mined"`). May be empty. |
| `error` | `{ type:"error", message: string }` | **Terminal, failure.** Reasons as in endpoint 53. |

Note the error text is in **`message`** here but in **`content`** for the chat stream. Clients treat end-of-stream without a terminal event as failure. The shipped client's fallback texts: `"Backend unreachable"`, `"Could not generate suggestions (<status>)"`, `"Could not generate suggestions — try again shortly"`.

**Abort.** The client may abort the fetch. The server only records that the connection closed and stops sending; **the bootstrap run is not cancelled** and still persists its drafts (they appear on the next list). Takes about a minute on a real dataset.

### 3.5 Other long-running calls (no progress channel)

| Call | Behaviour |
|---|---|
| `POST …/visualizations`, `…/tailor`, `…/repair` | Synchronous; block for the designer run (up to 120 s, then `ok:false` timeout message). |
| `GET /datasources/:id/inventory?refresh=true` (or first load) | Synchronous live walk; can take minutes on a cold warehouse. |
| `POST /testing-data/:id/load` | Synchronous; up to ~120 s seed timeout plus inventory walk. |
| `PUT /llm/settings`, `POST /llm/test-connection` | Synchronous; 30 s provider timeout. |

---

## 4. Desktop bridge (IPC)

Source: `frontend/electron/main.cjs` (main process) and `frontend/electron/preload.cjs`. The window is created with `contextIsolation: true`, `nodeIntegration: false`, `titleBarStyle: 'hiddenInset'`, and the preload script. The renderer sees only the two globals below; in a plain browser (web mode) neither exists and the UI must degrade (backend status is assumed `ready`, diagnostics panel runs without a bridge).

### 4.1 Globals exposed on `window`

```ts
interface Window {
  systemDiagnostics?: {
    list(): Promise<DiagnosticEntry[]>;
    record(entry: { level: DiagnosticLevel; source: string; message: string; details?: unknown }): void;  // fire-and-forget
    exportForLlm(): Promise<{ ok: boolean; canceled: boolean; path?: string; count?: number }>;
    subscribe(listener: (entry: DiagnosticEntry) => void): () => void;   // returns unsubscribe
  };
  desktop?: {
    onBackendStatus(listener: (event: { status: 'starting'|'ready'|'restarting'|'down' }) => void): () => void;  // returns unsubscribe
    restartBackend(): Promise<{ ok: boolean }>;   // developer-settings "Restart backend"
    setWindowTheme(theme: 'light' | 'dark'): void;  // fire-and-forget; app-shell R44
  };
}
interface DiagnosticEntry { id: string; timestamp: string; level: 'debug'|'info'|'warn'|'error'; source: string; message: string; details?: unknown }
```

### 4.2 IPC channels

| Channel | Direction / kind | Payload | Behaviour |
|---|---|---|---|
| `diagnostics:list` | renderer → main, `invoke` | none → `DiagnosticEntry[]` | Returns the in-memory entries (max 2000, preloaded from disk at start). |
| `diagnostics:record` | renderer → main, `send` | `{ level?, source?, message?, details? }` | Normalises and stores an entry: level not in `debug|info|warn|error` becomes `info`; `source` defaults to `renderer`, redacted, max 120 chars; `message` defaults to `(no message)`, redacted, max 10 000 chars; `details` redacted. Then appends to memory (cap 2000, oldest dropped), to the log file, and pushes `diagnostics:entry` to every window. |
| `diagnostics:entry` | main → renderer, push | `DiagnosticEntry` | Every recorded entry (from renderer, main process, or captured backend output). Delivered through `subscribe`. |
| `diagnostics:export` | renderer → main, `invoke` | none → `{ ok:false, canceled:true }` or `{ ok:true, canceled:false, path, count }` | Opens a native save dialog titled "Export diagnostics for an LLM", default file `questions-to-insights-diagnostics-<YYYY-MM-DD>.md`, filters Markdown / Text. On confirm writes a redacted Markdown report (header with generation time, app version, platform; instructions for the analysing LLM; counts per level and source; last 50 errors/warnings each with ±context lines and details; full chronological log) and records an `info` entry "Diagnostics report exported". Cancel returns without writing. |
| `backend:restart` | renderer → main, `invoke` | none → `{ ok: true }` | Restarts the backend on request (developer settings): status `restarting`, kills the child and, when it exits, starts a new one at once and re-probes. Does not use or consume the crash-restart budget, and resets it. No backend running → starts one. |
| `window:theme` | renderer → main, `send` | `'light' \| 'dark'` | Sets the sending window's background colour to that theme's frame colour (`#0077a0` light, `#003a52` dark), the colour under the gradient frame. Any other value is ignored. Sent by the renderer whenever its resolved theme changes, including at start-up. Until the first message the window uses the operating system's theme (`nativeTheme.shouldUseDarkColors`). |
| `backend-status` | main → renderer, push | `{ status: 'starting'\|'ready'\|'restarting'\|'down' }` | Sent to every window on each status change, and re-sent to a window when its page finishes loading (so a late renderer gets the current value). |

Entry `id` is `<epoch ms>-<sequence>`; `timestamp` ISO. Entries are appended as NDJSON to `<userData>/logs/system.ndjson`; a file over 5 MB is rotated at startup to `system.previous.ndjson` (one generation kept). Diagnostics never throw into the app.

**Redaction** (applied to source, message, details and the export): values of keys `password | token | api_key | api-key | apikey | secret | authorization` after `:` or `=` (quoted or bare), `Bearer <token>` credentials, and the password in `postgres(ql)://user:<password>@` URLs, each replaced by `[REDACTED]`.

**Backend output capture.** The backend child's stdout (fallback level `info`) and stderr (`error`) are mirrored to the process streams and turned into entries line by line, ANSI colour stripped. A JSON line with a `message` field becomes an entry with source `backend:mastra` (its `level` honoured, other fields as `details`); any other line becomes source `backend`, level inferred from `ERROR|FATAL`, `WARN|WARNING|…Warning`, `DEBUG`, else the stream's fallback.

### 4.3 Backend supervisor and readiness signal

| Item | Value |
|---|---|
| Spawn | Electron's own binary with `ELECTRON_RUN_AS_NODE=1` running `backend/dist/main.js` (packaged: `<resources>/backend/dist/main.js`); `stdio` piped; env passes `PORT`, `APP_DATA_DIR`, `APP_SECRET`. Missing entry file records an error diagnostic and does not start. |
| Readiness probe | `GET http://127.0.0.1:<BACKEND_PORT>/sessions`, **ready iff status 200**; 500 ms request timeout; retried every 100 ms until a **30 s** deadline. |
| Startup | status `starting` → spawn → probe. Ready → `ready`. Deadline missed → error diagnostic, **window opens anyway**, probing continues in the background and pushes `ready` when it succeeds. |
| Crash handling | Any exit not caused by app quit → status `restarting`, restart after back-off **1 s, 2 s, 4 s** (3 attempts), re-probing after each start. Attempts exhausted → status `down` (error diagnostic, no further restarts). |
| Stability reset | Backend continuously ready for **60 s** resets the attempt counter. |
| Requested restart | `backend:restart` (4.2): kill and immediate respawn, outside the crash back-off. |
| Quit | `before-quit` sets a quitting flag (suppresses restarts) and kills the backend. On non-macOS the app quits when all windows close. |
| Port | `BACKEND_PORT` env (default `3000`) used for both the child's `PORT` and the probe. The renderer's base URL does not honour it (G1). |

The renderer maps `down`/`restarting`/`starting` to a status banner; see [ui.md](ui.md) and the app-shell capability.

### 4.4 Data directory and secret (desktop)

- `userData` is `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR` when set (E2E isolation); otherwise the OS per-user app dir, preferring the current app-name folder and falling back to the pre-rename legacy folder (`Questions to Insights`) if only that exists. The app display name is "Halo BI Assistant".
- `APP_DATA_DIR` passed to the backend equals `userData`, except on Windows (no isolation override, `LOCALAPPDATA` set) where it is `%LOCALAPPDATA%\Halo BI Assistant`; existing `app.sqlite`, `mastra.sqlite`, `workspaces` are migrated there once (rollback on failure, continues on roaming profile).
- `APP_SECRET` = env `APP_SECRET` if set, else read from `<APP_DATA_DIR>/.app-secret`, else 32 random bytes hex generated and written there with mode `0600`. Failure to persist logs an error diagnostic (stored API keys then cannot be decrypted after restart).

---

## 5. CLI contract

Binary `questions-to-insights` (`backend/src/cli.ts` compiled to `dist/cli.js`), published as npm package `@jhon-buendia-halo/questions-to-insights` (`npx` or global install). Starts the API, serves the bundled web UI from the same origin, opens the browser.

| Flag | Argument | Default | Notes |
|---|---|---|---|
| `--port` | integer 0..65535 | `3000` | `0` = let the OS pick. Invalid value → exit 1 `invalid --port "<v>" (expected 0-65535)`. |
| `--host` | string | `127.0.0.1` | Interface to bind. |
| `--data-dir` | path | `$QTI_DATA_DIR`, else `$APP_DATA_DIR`, else `~/.questions-to-insights` | Resolved to an absolute path; created (`mkdir -p`). Deliberately separate from the Electron `userData` dir so both can run at once. |
| `--no-open` | none | opens the browser | Parsed as the negation of a boolean `open` option. |
| `-h`, `--help` | none | | Prints usage to stdout, exit 0. |
| `-v`, `--version` | none | | Prints the package version (`unknown` if unreadable), exit 0. |

Argument parsing is **strict**: an unknown flag or malformed argument prints `questions-to-insights: <error>` plus the help text to stderr and exits 1.

**Port rules.**
- No `--port`: try `3000` on the chosen host with a bind probe; if busy, print `Port 3000 is busy; using a free port instead.` and use port `0` (OS-assigned).
- Explicit `--port N` (N ≠ 0) and busy: exit 1 `port <N> on <host> is already in use`. No fallback.
- The actual bound port is read back after listen and shown in the URL.

**Startup sequence.** Parse args → settle port → resolve and create the data dir → set `process.env.APP_DATA_DIR = <dataDir>` → set `process.env.APP_SECRET` (below) → only then `import('./app-bootstrap.js')` dynamically (the database module and Mastra storage read `APP_DATA_DIR` at import time, so the order is load-bearing) → warn if no web UI build is found (`Warning: no web UI build found at <root> — only the API is available.` + hint to run `npm run build:web` in `backend/`) → `createApp({ port, host, webRoot })` with **CORS off** → print banner → open browser unless `--no-open`.

**Secret.** `APP_SECRET` from the environment if already set (not written to disk); else read `<dataDir>/.app-secret` (trimmed, non-empty); else generate 32 random bytes hex and write it (mode `0600`). Read/write failures print a warning and continue (a persist failure means stored API keys will not decrypt after restart).

**Output** (stdout):

```
(blank)
  Questions to Insights <version>
  URL:      http://<host>:<port>          # host shown as `localhost` when bound to 0.0.0.0/::, IPv6 in brackets
  Data dir: <absolute path>
  Press Ctrl+C to stop.
(blank)
```

**Browser opening.** Best effort, detached, errors ignored: `open <url>` (macOS), `cmd /c start "" <url>` (Windows), `xdg-open <url>` (other).

**Shutdown.** `SIGINT`/`SIGTERM` close the app and exit 0; a second signal is ignored; a forced `exit(0)` follows after 5 s if close hangs.

**Exit codes.** `0` = normal run, `--help`, `--version`, clean shutdown. `1` = argument errors, invalid or busy explicit port, or any uncaught startup error (stack printed to stderr).

---

## 6. Environment variables

### 6.1 Backend (server process)

| Variable | Read in | Meaning | Default |
|---|---|---|---|
| `PORT` | `main.ts` (Electron-spawned/standalone start) | Listen port. The Electron main process sets it from `BACKEND_PORT`. Ignored by the CLI (which uses `--port`). | `3000` |
| `APP_DATA_DIR` | database module, Mastra storage; set by CLI and Electron main | Directory for `app.sqlite`, `mastra.sqlite`, `observability.duckdb`, `workspaces/`. | database: `<cwd>/data`; Mastra storage: `<INIT_CWD or PWD or cwd>/data` |
| `APP_SECRET` | crypto service; set by CLI and Electron main | Key material for encrypting API keys at rest (SHA-256 to an AES-256-GCM key). Missing: the crypto service reads `<APP_DATA_DIR>/.app-secret`, or generates it (32 random bytes hex, mode 0600) and logs where. Must stay stable across launches. | `<APP_DATA_DIR>/.app-secret` |
| `WEB_ROOT` | `app-bootstrap.ts` | Directory holding the built web UI (`index.html`). | `<package>/public` |
| `INIT_CWD`, `PWD` | Mastra storage | Launch directory used to place the fallback `data/` folder (Studio changes `cwd`). | process cwd |
| `VISUAL_MODEL` | visual designer agent | Forces the designer model (router id `provider/model`). Unset: reasoning-family models are swapped for `openai/gpt-4.1-mini` and `nano` models upgraded to their `mini` sibling; others kept. | unset |
| `OPENAI_API_KEY` | Mastra's env-bound model router (via model resolver) | Fallback model credential (`openai/gpt-4o-mini`) when no LLM settings are saved. | unset |
| `WORLD_CUP_DB_PORT` | testing-data fixture registry | Port of the sample PostgreSQL server in the form prefill and compose stack. | `55432` |
| `EVAL_DATASETS` | `mastra/evals/run-assistant-evals.ts` (CLI eval script only) | Comma-separated dataset names to run the assistant evals against. Required by that script. | none |

### 6.2 CLI-only

| Variable | Meaning | Default |
|---|---|---|
| `QTI_DATA_DIR` | Data directory (precedes `APP_DATA_DIR`, overridden by `--data-dir`). | falls through to `APP_DATA_DIR`, then `~/.questions-to-insights` |

### 6.3 Electron main process

| Variable | Meaning | Default |
|---|---|---|
| `BACKEND_PORT` | Port the child backend listens on and the readiness probe targets (passed to the child as `PORT`). | `3000` |
| `ELECTRON_DEV_URL` | When set, the window loads this URL (`ng serve`, e.g. `http://localhost:4200`) instead of the built `index.html`. | unset |
| `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR` | Pins `userData` to an isolated profile (E2E tests) and disables the Windows data-dir redirect. | unset |
| `APP_SECRET` | Used as-is instead of the persisted secret file. | unset |
| `LOCALAPPDATA` | Windows only: base of the non-roaming data dir. | OS-provided |
| `ELECTRON_RUN_AS_NODE` | Set to `1` **by** the main process on the backend child. | n/a |

### 6.4 Developer scripts (not part of the shipped app)

`BACKEND_URL` (default `http://127.0.0.1:3000`) and `WORLD_CUP_API_URL` (`http://127.0.0.1:55080`) for `setup-worldcup-rest.ts`; `WORLD_CUP_API_PORT` (`55080`) for the sample REST server; `WORLD_CUP_DB_HOST|PORT|DATABASE|USER|PASSWORD` (`127.0.0.1|55432|world_cup|world_cup|world_cup_dev`) for the dump script; `EVAL_ROW_LIMIT` (`500`), `EVAL_TIMEOUT_MS` (`300000`) for `run-eval.ts`; `CHECK_TIMEOUT_MS` (`180000`), `CHECK_MODEL` (`gpt-4o-mini`), `CHECK_ARM`, `CHECK_TRIALS` for `check-answers.ts`.

### 6.5 Frontend build/runtime

No environment variables. The only runtime switch is the page protocol (`file:` selects the desktop base URL).

---

## 7. Gaps and open questions

- **G1. Desktop base URL is hardcoded.** The renderer uses `http://localhost:3000` under `file://`; the preload bridge does not expose the port, so a non-default `BACKEND_PORT` breaks the desktop app (roadmap 1.7.20, BA-109). A rebuild should expose the port via the bridge.
- **G2. `POST /sessions/:id/messages` is unused** by the frontend and is a degraded duplicate of the streaming path (no tool-data capture, clarification, grounding guard or careful mode). Open question: keep as a public non-streaming API or remove.
- **G3. `POST /knowledge/bootstrap` is unused** (superseded by the streamed variant); it shares the service call.
- **G4. Eval run recovery.** In-flight run state lives in memory with write-through persistence per question. Open question: what status a run left `running` by a crash shows after restart (no reconciliation code was found).
- **G5. Frontend type drift.** The frontend `EvalRunView` omits `comparison` (present on the wire, only used in the Markdown report). The frontend `getEvalRun` result is a loose merge type.
- **G6. No cascade.** Deleting a datasource leaves datasets pointing at it; deleting a dataset leaves sessions/knowledge that name it. Behaviour of such dangling references is not specified in the API.
- **G7. `POST /sessions` does not verify the named datasets exist.** Open question whether that is intended.
- **G8. Error-style inconsistency.** Style A (`200 { ok:false }`) vs Style B (real 4xx) is endpoint-specific and also differs in list shapes (`{ sessions }`, `{ datasources }`, `{ metrics }`, `{ datasets }`, bare array for knowledge, bare `SessionDoc`). Several read endpoints (`GET /datasources`, eval-run listing) can still return a framework 500.
- **G9. Request body size.** No explicit JSON body limit is configured, so the framework default (about 100 kB) applies; large dataset snapshots in `POST /datasets` could exceed it. Not verified against a real large dataset.
- **G10. Desktop backend bind address.** `main.ts` calls `createApp` without a host, so the Electron-spawned backend listens on **all interfaces** with CORS enabled and no authentication; only the CLI binds `127.0.0.1` by default. Open question whether the desktop backend should bind loopback only.
- **G11. `message` timing on feedback.** `POST …/messages/feedback` with `up` reports `"Answer saved as a verified query"` even when the answer had no SQL and nothing was saved.
- **G12. Spec of `PUT /metrics/:id` not-found** is thrown as a 400-class exception but surfaced inside the `ok:false` envelope, so clients cannot distinguish "not found" from validation by status.
- **G13. Dev-mode API routing.** For `ng serve` the client uses relative URLs and the repo has no Angular proxy config, so API calls from a bare `ng serve` page hit the dev server, not the backend. Under `electron:dev` the window loads `http://localhost:4200` (protocol `http:`), so the same relative-URL problem applies. Open question: how the live-reload dev flow reaches the backend (no proxy or `API_BASE_URL` override found).
- **Not an HTTP surface:** verified queries (saved via feedback), the Mastra Studio, and the workspace filesystem have no endpoints of their own.

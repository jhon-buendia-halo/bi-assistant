# API contract

The complete contract between the renderer (or any HTTP client) and the backend, plus the desktop IPC bridge, the CLI and the environment. Persisted document shapes (session, dataset, datasource, metric, ontology item, verified query, LLM settings, eval run) live in [data-model.md](data-model.md); this file links to them and only restates a shape where the wire format differs from the stored one.

Contents: [1 Conventions](#1-conventions) · [2 Endpoints](#2-endpoints) · [3 Streaming and long-running work](#3-streaming-and-long-running-work) · [4 Desktop bridge (IPC)](#4-desktop-bridge-ipc) · [5 CLI contract](#5-cli-contract) · [6 Environment variables](#6-environment-variables) · [7 Gaps and open questions](#7-gaps-and-open-questions)

Endpoint total: **109 HTTP route handlers** across 20 app controllers (agents 17, workflow runs 15, skills 9, sessions 7, llm 7, datasources 6, ontology 6, metrics 5, monitoring 5, personas 4, visuals 4, synthetic data 4, workflows 4, datasets 3, data readiness 3, developer settings 3, testing data 3, UI preferences 2, draft runs 1, health 1). Verified queries have **no** HTTP surface (they are created and removed as a side effect of message feedback, and read by the metrics promotion path).

---

## 1. Conventions

### 1.1 Base URL

| Mode | How the client reaches the API |
|---|---|
| Web (`npx` / CLI, same origin) | The backend serves the built UI itself. Client uses **relative URLs** (empty base), e.g. `/sessions`. |
| Desktop (Electron renderer, `file://`) | Client uses `http://localhost:3000` (hardcoded). The backend child process listens on `PORT`, which the main process sets from `BACKEND_PORT` (default `3000`). See gap G1: a non-default `BACKEND_PORT` breaks the renderer. |
| Dev (`ng serve` / `electron:dev`, page served from `http://localhost:4200`) | Protocol is `http:`, so the client uses relative URLs against the dev server. No proxy or override exists in the repo (G13). |

The client rule is: `API_BASE_URL = (window.location.protocol === 'file:') ? 'http://localhost:3000' : ''`. All paths below are relative to that base. There is no API prefix and no versioning. There is no authentication (1.9).

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

**Style B, framework exceptions, real HTTP status.** Endpoints that do not catch let the framework answer. Used by: `GET /sessions/:id`, the visual `GET` endpoints, `GET /agents/:key`, the eval-run download, the whole ontology and personas controllers, and the data-readiness and synthetic-data controllers.

```ts
interface HttpErrorBody { statusCode: number; message: string | string[]; error: string }   // NestJS default
```

| Status | When |
|---|---|
| 400 Bad Request | Validation failure thrown by a service (`BadRequestException`): missing/empty field, bad enum value, unknown version. |
| 404 Not Found | Unknown session/agent/ontology item/visual/report, or an unmatched route (`Cannot GET /x`). |
| 408 Request Timeout | A visual generation exceeded 120 s (`RequestTimeoutException`). Under Style A this surfaces as `ok:false`. |
| 500 Internal Server Error | Any unhandled error (framework default body `{ statusCode: 500, message: "Internal server error" }`). |

Clients read the error text from `error.message` (Style B) or `body.message` with `body.ok === false` (Style A). One endpoint mixes the styles: `GET /agents/:key/evals/runs/:jobId` reports "not found" as Style A (`200 { ok:false }`).

### 1.4 Success status codes

POST handlers return the framework default **201 Created**, except where an endpoint states **200**: the two SSE endpoints (5 and 54, 200 once the stream starts, whatever it then carries), `POST /developer-settings/test-endpoint` (55), `POST /testing-data/:fixtureId/load` (56). GET/PUT/DELETE return **200**; `DELETE /ontology/:id`, `DELETE /personas/:id` and `DELETE /visuals/:id` return **204 No Content**. The file downloads write the response themselves and return **200**; so do `POST /synthetic-data/scripts`, `/profile-exports` and `/sample-exports` (112 to 114), which stream an attachment (only 111 returns **201**). Clients treat any 2xx as success and do not depend on 200 vs 201.

### 1.5 Validation

- There is **no global validation pipe** and no DTO validation library. DTO classes (`SaveDatasourceDto`, `SaveMetricDto`, ...) are plain TypeScript shapes; nothing rejects extra or mistyped fields at the edge.
- Validation is done by services/controllers: fields are coerced defensively (`typeof x === 'string' ? x : ''`), trimmed, and checked with explicit `BadRequestException`s. Rules per endpoint are listed in section 2.
- Unknown body fields are ignored. Missing body is treated as `{}`.
- Query params are strings. Booleans are accepted only as the literal `"true"`. The ontology list drops unrecognised filter values instead of rejecting them.

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
- Secrets never come back in plaintext: datasource secrets are masked as `••••••••` (8 U+2022 bullets), the LLM key as `••••••••` + last 4 characters, always (there is no caller for whom the key is sent unmasked or left out). A client may send the mask back unchanged to mean "keep the stored secret" (see 2.2, 2.5).

### 1.9 Authentication

There is **no authentication**. The app has one built-in user, the super admin (id `local`, [ADR-0030](architecture.md)), who is always the caller: no route needs a credential, no route answers 401 or 403, and there is no sign-in, session cookie, bearer token, Origin check or per-route permission. Every route is open to whoever reaches the port. What decides who can reach it is the bind address (5, 4.3, G10, G14): the web CLI binds `127.0.0.1`, while the desktop backend and a CLI started with `--host 0.0.0.0` accept connections from every interface, and then anyone who can reach the port has full access, including the stored LLM key's use and the developer settings.



---

## 2. Endpoints

Legend for **FE**: whether the shipped frontend calls it. Document types referenced (`SessionDoc`, `ChatMessage`, `SessionVisualization`, `DatasetDoc`, `MetricDoc`, `OntologyItem`, `DatasourceView`, `CatalogInfo`, `LlmSettingsView`, `EvalRunView`) are defined in [data-model.md](data-model.md) and the shared ones in [section 2.10](#210-shared-wire-shapes).

### 2.1 Sessions

Controller prefix `/sessions`. Capability: past-chats, visuals, agent-panel, workflows.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 1 | `GET /sessions` | List all sessions | yes |
| 2 | `GET /sessions/:id` | Get one session with full transcript | yes |
| 3 | `POST /sessions` | Create a session (Removed in 1.23.27) | — |
| 4 | `DELETE /sessions/:id` | Delete a session and its Mastra state | yes |
| 5 | `POST /sessions/:id/messages/stream` | Streamed chat turn (SSE) (Removed in 1.23.27) | — |
| 6 | `POST /sessions/:id/messages` | Non-streamed chat turn (Removed in 1.23.27) | — |
| 7 | `POST /sessions/:id/messages/feedback` | Thumbs up/down on an answer (Removed in 1.23.27) | — |
| 8 | `POST /sessions/:id/visualizations` | Generate a visual from an answer (Removed in 1.23.27) | — |
| 9 | `GET /sessions/:id/visualizations/:vid` | Load a visual (document + metadata) | yes |
| 10 | `POST /sessions/:id/visualizations/:vid/tailor` | Tailor from an instruction (Removed in 1.23.27) | — |
| 11 | `POST /sessions/:id/visualizations/:vid/revert` | Move the version pointer (Removed in 1.23.27) | — |
| 12 | `POST /sessions/:id/visualizations/:vid/refresh` | Re-run SQL, refresh data in place (Removed in 1.23.27) | — |
| 13 | `POST /sessions/:id/visualizations/:vid/repair` | One-shot silent auto-repair (Removed in 1.23.27) | — |
| 14 | `GET /sessions/:id/visualizations/:vid/download` | Zip bundle | yes |
| 105 | `GET /sessions/:id/rfp-packages/:rfpId/download` | Download an RFP package (Removed 2026-11-12) | — |
| 106 | `GET /sessions/:id/panel-items/:itemId/file` | Read the text of a file panel item | yes |
| 107 | `GET /sessions/:id/panel-items/:itemId/download` | Download a file, document or table panel item | yes |

The session on the wire (endpoints 1 and 2) is the stored `SessionDoc` (data-model 3.4) plus two derived fields of the right panel ([agent-panel](../capabilities/agent-panel/spec.md), never stored as such): `panelItems: PanelItem[]` (always present, newest shown last as stored; the stored items, without any of the retired kind `phases`, plus a synthesized `visual:<id>` item for every visual without one, [data-model.md](data-model.md) 3.4.4) and `workflow?: WorkflowView` (present when the session's agent is workflow-backed (`assistant-v2`, [agents.md](agents.md) 5.11), its prompt has a `## Workflow` section or the agent has defined its own steps with `update_workflow`; the extended view of [data-model.md](data-model.md) 3.4.4: `source`, `skipped`, `waiting?`, `note?`, `failed?` besides the phases and the saved progress; the `done` event carries it too), plus, for a session with an `agentId`, a derived `agent: { id: string; name: string; deleted: boolean; description: string; starterQuestions: string[] }`. While the agent exists, `name`, `description` and `starterQuestions` come from its Live version and `deleted` is `false`. Once it is deleted, `name` is the stored `agentName`, `deleted` is `true`, and `description` and `starterQuestions` are empty (past-chats R57-R59). For a preview session, `name`, `description` and `starterQuestions` come from the agent's **draft**, read at each request. For a session with an `agentKey` (bound to a built-in agent, ADR-0028), `agent` is `{ id: <agentKey>, name: <the registered agent's name>, deleted: false, description: <its description>, starterQuestions: <its built-in starters> }`. A stored `agentKey: "rfp"` (the removed RFP Builder) does not resolve: such a session reads as a plain one. It is computed on every read, never stored.

Every session on the wire also carries an always-present, derived `workflowRef: { id: string; name: string; kind: 'code' | 'agent'; deleted: boolean }`: the workflow the session runs ([workflows](../capabilities/workflows/spec.md) R4; [agents.md](agents.md) 5.12). A session of Questions to Insights v2 reads `{ id: 'qti-v2-turn', name: 'Questions to Insights v2', kind: 'code', deleted: false }`. Since 2026-11-12 (ADR-0042) the `agent:*` ids are internal and never in the catalogue, but a session bound to one keeps its reference as before (`agent:assistant` named `Assistant`, `agent:data-readiness`, `agent:<user-agent id>` named after the agent's Live name, with `deleted: true` and the stored `agentName` once the agent is deleted), and shows no link to a workflow page. A session stored with the removed workflow `seq-text-demo` or `deep-analysis` reads as a plain Assistant session (`{ id: 'agent:assistant', name: 'Assistant', kind: 'agent', deleted: false }`). It is computed on every read, never stored. The `agent` and `workflow` fields above are unchanged: `workflow` is the workflow bar's view, not this reference.

Since 1.23.27 the routes that wrote to a session are removed (3, 5, 6, 7, 8, 10-13 here and 46, 47 in 2.7): a stored session is listed, read, downloaded from and deleted, nothing more ([past-chats](../capabilities/past-chats/spec.md)). A preview session never exists any more; the agent editor's preview is a draft run (api.md 129).

#### 1. `GET /sessions`
- Response `200`: `{ sessions: SessionDoc[] }`. Ordering is the repository's (most recently updated first; see data-model). No pagination; full documents including messages are returned.
- Errors: none expected.
- Past chats stay readable (read-only). Until 1.23.22 this was also the Electron main process's backend readiness probe; the probe is `GET /health` (135, 4.3).

#### 2. `GET /sessions/:id`
- Response `200`: `SessionDoc` (bare, not enveloped), with `panelItems` and `workflow` as above.
- Errors: `404 "Session <id> not found"` (Style B).

#### 3. `POST /sessions`
Removed in 1.23.27: nothing creates a session; a workflow runs through `POST /workflows/:id/runs` (118) or `/runs/stream` (119). Nothing in the app or its scripts calls it, and a call answers `404`.

#### 4. `DELETE /sessions/:id`
- Success: `{ ok:true, message:"Session \"<name>\" deleted" }`.
- Failure (Style A): `"Session <id> not found"`.
- Side effects: removes the session document and all Mastra state it owns (memory thread/resource, workspace).

#### 5. `POST /sessions/:id/messages/stream`
Removed in 1.23.27: a question is a run (119); the framing and event types of [3.1](#31-chat-stream-removed-in-12327) are what a run streams (3.6). Nothing in the app or its scripts calls it, and a call answers `404`.

#### 6. `POST /sessions/:id/messages`
Removed in 1.23.27: the non-streamed chat turn is gone with the chat. Nothing in the app or its scripts calls it, and a call answers `404`.

#### 7. `POST /sessions/:id/messages/feedback`
Removed in 1.23.27: a run's answer is rated by 128. Nothing in the app or its scripts calls it, and a call answers `404`.

#### 8. `POST /sessions/:id/visualizations`
Removed in 1.23.27: a run's answer gets a visual from 130. Nothing in the app or its scripts calls it, and a call answers `404`.

#### 9. `GET /sessions/:id/visualizations/:vid`
- Query: `version` (optional positive integer; anything else is ignored and means "current").
- Response `200`: `InteractiveVisualization` (bare): the `SessionVisualization` metadata plus `document` (sandboxed self-contained HTML) and `version` (the version the document was assembled from).
- Errors (Style B): `404 "Visualization <vid> not found in session <id>"` / session not found; `400 "Version <n> does not exist"`.

#### 10. `POST /sessions/:id/visualizations/:vid/tailor`
Removed in 1.23.27: a run's visual is tailored by 131. Nothing in the app or its scripts calls it, and a call answers `404`.

#### 11. `POST /sessions/:id/visualizations/:vid/revert`
Removed in 1.23.27: a run's visual is reverted by 132. Nothing in the app or its scripts calls it, and a call answers `404`.

#### 12. `POST /sessions/:id/visualizations/:vid/refresh`
Removed in 1.23.27: a run's visual is refreshed by 133. Nothing in the app or its scripts calls it, and a call answers `404`.

#### 13. `POST /sessions/:id/visualizations/:vid/repair`
Removed in 1.23.27: a run's visual is repaired by 134. Nothing in the app or its scripts calls it, and a call answers `404`.

#### 14. `GET /sessions/:id/visualizations/:vid/download`
- Query: `version` (optional positive integer; default current). The frontend never sends it (always downloads the current version).
- Response `200`: `application/zip`, `Content-Length`, `Content-Disposition: attachment; filename="<slug>-v<N>.zip"` where slug = title NFKD-normalised, non-alphanumerics to `-`, trimmed, lowercased, max 64 chars, fallback `visual-<first 8 of id>`. (The frontend ignores the header and saves as `<slug>.zip`.)
- Zip contents: `index.html` (always regenerated with the readable frame, runtime inlined so it renders standalone), `styles.css`, `qti-frame.js`, `script.js`; plus `spec.json` + `qti-chart.js` for spec visuals; `answer.md` when the source answer exists; `data.json` when data rows exist.
- Errors (Style B): 404 not found, 400 `"Version <n> does not exist"`.

#### 105. `GET /sessions/:id/rfp-packages/:rfpId/download`
Removed 2026-11-12 with the RFP Builder: the route no longer exists (the number is not reused). Package files an old session left in its workspace stay on disk, unused.

#### 106. `GET /sessions/:id/panel-items/:itemId/file`
- Response `200`: `{ item: FilePanelItem, contentType: string, text: string }`: the stored item ([data-model.md](data-model.md) 3.4.4) and the file's text as it is now in the session workspace (at most 256 KB), with the content type of its extension (`.md` `text/markdown`, `.csv` `text/csv`, `.json` `application/json`, others `text/plain`). The panel's file view reads it when the item is opened.
- The path is resolved under the session workspace with the same safe-path check as the tool (no absolute or `..` path, no symbolic link, text extensions only; [agents.md](agents.md) 3.11).
- Errors (Style B): `404 "Session <id> not found"`; `404 "Panel item \"<itemId>\" not found"`; `400 "Panel item \"<itemId>\" is not a file"`; `404 "File \"<path>\" not found in the session workspace"`; `400 "File \"<path>\" is larger than 256 KB"`. Capability: [agent-panel](../capabilities/agent-panel/spec.md).

#### 107. `GET /sessions/:id/panel-items/:itemId/download`
- Query: `format` (optional): `pdf` or `md` for a `document` item or a `file` item whose path ends in `.md`, `csv` for a `table` item; absent means the defaults below. `format=pdf` renders the Markdown as PDF (`application/pdf`; filename `<slug>.pdf` for a document, the file's base name with `.pdf` in place of `.md` for a file), with the markdown PDF renderer (`common/markdown-pdf.ts`), the item's title as the PDF title.
- Response `200`, as an attachment (`Content-Disposition: attachment; filename="<name>"`):
  - a `file` item: the file's bytes with the content type of #106 and its base name as the filename;
  - a `document` item: the Markdown as `text/markdown`, filename `<slug>.md`;
  - a `table` item: `text/csv`, filename `<slug>.csv`, a header row of the item's columns and one line per stored row, fields quoted per RFC 4180 (a field with a comma, a quote or a line break is wrapped in double quotes and its quotes doubled); a null or undefined value is empty, an object is its JSON text.
  The slug is the item's title as in #14 (fallback `panel-<first 8 of the item id>`).
- Errors (Style B): as #106 for the session, the item and (for a file) the file; `400 "Panel item \"<itemId>\" can't be downloaded"` for a `visual` item (a visual downloads through #14); `400 "Panel item \"<itemId>\" can't be downloaded as PDF"` for `format=pdf` on any other item; `400 "Unknown download format \"<format>\": use pdf, md or csv"` for any other `format`. Capability: [agent-panel](../capabilities/agent-panel/spec.md).

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
- Response `200`: `{ datasets: DatasetDoc[] }`, most recently updated first. Legacy single-selection documents in the same table are skipped. Each dataset carries `schemas` (the schema notes) when it has any.

#### 22. `POST /datasets`
- Body: `{ name: string; tables: string[]; entities: DatasetEntitySnapshot[]; datasourceId: string; datasourceKind?: string }`.
  - `tables`: fully-qualified `catalog.schema.table` keys of the included entities (non-empty).
  - `entities`: schema snapshots `{ key, columns: { name, type, nullable, sampleValues?, description?, references? }[] }` captured by the client from the inventory. Only those whose `key` is in `tables` are processed.
  - `datasourceKind` optional; when present it must equal the datasource's kind.
  - `schemas` optional: `{ key: "catalog.schema"; layer?: "landing" | "normalized" | "consumption" | null; description?: string | null }[]`, the dataset's schema notes. **Omitted** (or anything that is not an array, `null` included) keeps the stored notes (Testing Data re-registers its samples this way); an **array** replaces them, `[]` clearing them all. Malformed keys are ignored, notes for a schema with no included entity are dropped, empty notes (no layer and no description) are dropped, and descriptions are trimmed and cut to 500 characters.
- Validation (Style A messages): `"Dataset name is required"`, `"Include at least one entity"`, `"datasourceId is required"`, `"Datasource <id> not found"`, `"Datasource kind must be <kind>"`, `"layer must be one of: landing, normalized, consumption"`.
- Success: `{ ok:true, message:"Dataset \"<name>\" saved — <n> entities" }`. The saved document is **not** returned; the client re-lists.
- Side effects: enriches each entity snapshot with up to 5 distinct sample values per column (from a live sample of 50 rows per table, 4 tables concurrently; best effort, a failure leaves that snapshot as sent and never fails the save), then attaches the join graph (`references` per key column: declared foreign keys win, naming-based inference fills the rest), then upserts by `name`, binding `datasourceId` + `datasourceKind`. Re-saving an existing name replaces it and re-enriches.
- Note the controller trims `name` and `datasourceId`; `tables` entries are stringified.

#### 23. `DELETE /datasets/:name`
- Success: `{ ok:true, message:"Dataset \"<name>\" deleted" }`; if no dataset matched: `{ ok:false, message:"Dataset \"<name>\" not found" }`.
- Also deletes the ontology items whose `dataset` is that name (shared items stay; [data-model.md](data-model.md) 3.13). Does not cascade to sessions that reference the name (G6).

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

Controller prefix `/llm`. Capability: [llm-settings](../capabilities/llm-settings/spec.md). One persisted singleton document ([data-model.md](data-model.md) 3.2), API key encrypted at rest (AES-256-GCM keyed by `APP_SECRET`, data-model 2.3). How a provider's settings become a model route is in [agents.md](agents.md) 1.3.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 29 | `GET /llm/settings` | Read settings (key masked) | yes |
| 30 | `PUT /llm/settings` | Save settings (tests first) | yes |
| 31 | `PUT /llm/reasoning` | Set reasoning effort only | yes |
| 32 | `POST /llm/test-connection` | Test candidate settings | yes |
| 32a | `GET /llm/effort-levels` | Effort levels a model accepts | yes |
| 32b | `POST /llm/models` | List a custom endpoint's or the Copilot seat's models | yes |
| 32c | `GET /llm/copilot/status` | Whether the machine is signed in to GitHub for Copilot | yes |

```ts
type LlmProvider = 'openai' | 'anthropic' | 'lenai' | 'custom' | 'copilot';   // custom is shown "Custom endpoint", copilot "GitHub Copilot"
type LlmApiStyle = 'openai' | 'anthropic';   // shown "OpenAI-compatible" / "Anthropic-compatible"; custom only
// Ordered lowest to highest; each model accepts a subset (agents.md 1.4).
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
interface SaveLlmSettingsDto {
  provider: LlmProvider; model: string; apiKey?: string; baseUrl?: string; reasoningEffort?: ReasoningEffort;
  apiStyle?: LlmApiStyle;   // required when provider is 'custom'; ignored (not stored) otherwise
  // provider 'copilot': model blank or omitted = 'auto'; apiKey, baseUrl and apiStyle ignored (not stored)
}
type ListLlmModelsDto =
  | { provider: 'custom'; apiStyle: LlmApiStyle; baseUrl: string; apiKey?: string }
  | { provider: 'copilot' };
interface CopilotStatusView {
  signedIn: boolean;
  login: string | null;    // the GitHub login, when signed in
  method: string | null;   // how the runtime signed in (e.g. "gh-cli"), when signed in
  message: string;         // see 32c
}
interface EffortLevelsView {
  levels: ReasoningEffort[];              // lowest first; [] = the model has no reasoning effort
  defaultEffort: ReasoningEffort | null;  // 'high' when offered, else the first level; null when levels is []
  probeEffort: ReasoningEffort | null;    // the lowest level, sent by the connection probe; null when levels is []
}
interface LlmSettingsView {
  provider: LlmProvider | null; model: string | null; baseUrl: string | null;
  apiStyle: LlmApiStyle | null;  // set only when provider is 'custom', else null
  apiKeyMasked: string | null;   // "••••••••" + last 4 chars of the key; null when no key is stored (a keyless custom endpoint, or copilot)
  reasoningEffort: ReasoningEffort;   // default 'high'
  configured: boolean;
  keyUnreadable?: true;   // present only when a stored key cannot be decrypted with the current APP_SECRET
}
```

**Custom endpoint URLs.** The `baseUrl` of a `custom` provider is trimmed and its trailing slashes are removed; it is stored that way. What the app calls depends on `apiStyle`:

| `apiStyle` | `baseUrl` the user gives | Chat / probe | Model list | Key header (when a key is set) |
|---|---|---|---|---|
| `openai` | Includes the version path, e.g. `http://127.0.0.1:8317/v1`; used as given | `<base>/chat/completions` | `GET <base>/models` | `Authorization: Bearer <key>` |
| `anthropic` | The server root, e.g. `http://127.0.0.1:8317`; the app appends `/v1` (a URL already ending in `/v1` is used as-is) | `<root>/v1/messages` | `GET <root>/v1/models` | `x-api-key: <key>`, always with `anthropic-version: 2023-06-01` |

With no key the request carries no credential header. Any `http`/`https` host is accepted, loopback and private addresses included ([ADR-0032](architecture.md): one super-admin app, the host is the boundary per ADR-0030).

**Custom endpoint error texts.** Used by 32 and 32b, and by chat turns that fail on a custom endpoint ([llm-settings](../capabilities/llm-settings/spec.md)): connection refused, DNS failure or reset `"Could not reach <host> — check the base URL and that the server is running"` (`<host>` = the URL's `host`, port included); HTTP 404 `"The endpoint answered 404 at <url> — check the base URL (OpenAI-compatible servers usually end in /v1)"` (`<url>` = the full URL called); 401 or 403 `"The endpoint rejected the API key (<status>)"`; 429 `"The endpoint is rate limiting requests (429) — try again later"`. Any other status keeps today's text, `"Provider request failed (<status>) — <first 300 characters of the body>"`. No text ever contains the key.

**GitHub Copilot.** Provider `copilot` runs on the user's Copilot seat through the local Copilot runtime, signed in with the GitHub login already on the machine ([ADR-0037](architecture.md)). It has no key, no base URL and no API style; the app stores no GitHub credential. Its texts, used by 32, 32b, 32c and by chat turns that fail on Copilot ([llm-settings](../capabilities/llm-settings/spec.md) R57, R58, R64): not signed in `"Not signed in to GitHub — run \"gh auth login\" (or sign in to the GitHub Copilot CLI or app) on this machine, then test again"`; runtime failure `"The GitHub Copilot runtime could not start — <detail>"`; a Copilot request error `"GitHub Copilot request failed — <message>"`.

**Key handling.** Keys of every provider never appear in a response body, a log line or the desktop diagnostics; `Authorization` and `x-api-key` header values are redacted wherever requests are logged ([non-functional](../product/non-functional.md)).

#### 29. `GET /llm/settings`
- Response `200`: `LlmSettingsView` (bare). Nothing stored: `{ provider:null, model:null, baseUrl:null, apiStyle:null, apiKeyMasked:null, reasoningEffort:"high", configured:false }`.
- A stored `custom` provider answers its `apiStyle` and `baseUrl`; with no stored key `apiKeyMasked` is `null` and `configured` is still `true`.
- A stored `copilot` provider answers `baseUrl:null`, `apiStyle:null`, `apiKeyMasked:null`, its `model` (`auto` by default) and `configured:true`.
- Stored key that cannot be decrypted with the current `APP_SECRET`: still `200`, with `configured:false`, `keyUnreadable:true`, the stored `provider`, `model`, `baseUrl`, `apiStyle` and `reasoningEffort`, and `apiKeyMasked:null`.

#### 30. `PUT /llm/settings`
- Body: `SaveLlmSettingsDto`. `apiKey` omitted or blank = use the stored key. For `lenai`, `model` is the deployment name and `baseUrl` is required. `anthropic` takes an API key only (no subscription logins).
- For `custom`: `apiStyle` and `baseUrl` are required, `model` is free text. The API key is optional: a given key is encrypted and stored; a blank key keeps the key stored for `custom` (when the stored provider is `custom`), and with none stored the endpoint is called and saved with no credential (no `apiKeyCiphertext`). A key stored for another provider is never sent to a custom endpoint. Switching from `custom` to another provider follows that provider's rules (blank = the stored key, else `"apiKey is required — none stored yet"`).
- For `copilot`: a blank or omitted `model` is stored as `auto`; `apiKey`, `baseUrl` and `apiStyle` are ignored. The document is stored with `baseUrl: ""` and no `apiKeyCiphertext`, so saving `copilot` removes any stored key, and a later switch to `openai`, `anthropic` or `lenai` needs a key (`"apiKey is required — none stored yet"`).
- Validation (Style A, HTTP 200 `{ ok:false, message }`), checked in this order: `"provider must be one of: openai, anthropic, lenai, custom, copilot"`, `"apiStyle must be one of: openai, anthropic"` (custom only), `"baseUrl is required for custom"`, `"baseUrl must be an http or https URL"` (custom only), `"model is required"`, `"baseUrl is required for lenai"`, `"apiKey is required — none stored yet"` (not for custom or copilot), and, with no `apiKey` and a stored key that cannot be decrypted, `"The saved API key can't be read because the app secret changed — enter it again in Settings → LLM Configuration"` (same for `POST /llm/test-connection`).
- **The settings are tested against the provider before they are persisted**; a failing test fails the save with the provider's error text (for custom and copilot, the texts above) and nothing is stored.
- `reasoningEffort` (optional) must be one of the model's levels (32a), else the save fails with `"reasoning effort must be one of: <levels, comma-separated>"` before any provider call. Omitted: the stored effort is kept when the model offers it, else the model's `defaultEffort`; for a model with no levels the stored effort (or `high`) is kept unchanged. For `custom` the levels are chosen by model name, as for the other providers.
- Success: `{ ok:true, message:"Configuration saved", settings: LlmSettingsView }`.
- Side effects: persists (key encrypted; `apiStyle` stored only for `custom`); subsequent agent turns resolve the model from these settings.

#### 31. `PUT /llm/reasoning`
- Body: `{ effort: "low"|"medium"|"high" }`. This is the composer's menu; it still offers only these three.
- Success: `{ ok:true, message:"Reasoning effort set to <effort>", settings }`. Failures: `"reasoning effort must be one of: low, medium, high"`, `"Configure and save the LLM first — no settings stored yet"`.
- Applied per model: mapped to the nearest level the model accepts, translated to the provider's native option, and dropped for Anthropic models that reject it (agents.md 1.4). A `custom` provider uses the OpenAI-compatible option for `apiStyle: openai` (`reasoning_effort`, sent only when the model has levels) and the Anthropic one for `apiStyle: anthropic`. A `copilot` provider sends it as the Copilot session's reasoning effort, only when the model has levels (none for `auto`).

#### 32. `POST /llm/test-connection`
- Body: `SaveLlmSettingsDto` (same rules as save, nothing persisted; `reasoningEffort` is ignored). Sends one cheap fixed prompt using the candidate settings at the model's `probeEffort` (32a; none sent when the model has no levels); 30 s timeout.
- Success: `{ ok:true, message:"Connection successful — <provider>/<model> replied \"<reply>\" in <ms>ms" }` (for custom, `custom/<model>`; for copilot, `copilot/<model>`, e.g. `copilot/auto`). Failure: `{ ok:false, message }` (validation errors, provider HTTP errors, `"LLM request timed out after 30s"`; for custom, the error texts above).
- Custom, `apiStyle: openai`: when the server rejects the strict `json_schema` response format, the probe retries with `json_object`, then with plain text, and passes on the first step whose reply parses to `{ "status": "<non-empty string>" }` (a code fence tolerated); a failure at the plain-text step, or any failure other than a 400 or 422 rejection of the format, fails the test (llm-settings R49). `apiStyle: anthropic` sends one Messages request.
- Copilot: checks the sign-in first (32c) and fails with the not-signed-in or runtime text above, then sends the probe as one Copilot session turn with the probe's JSON schema as the response format, through the same agent runtime real calls use; a Copilot request error answers `"GitHub Copilot request failed — <message>"`, a reply that is not the JSON the structured-output text of [llm-settings](../capabilities/llm-settings/spec.md) R18.

#### 32a. `GET /llm/effort-levels`
- Query: `provider` (`openai`|`anthropic`|`lenai`|`custom`|`copilot`) and `model` (the model or deployment name, trimmed). Both optional; an empty model answers `{ levels: [], defaultEffort: null, probeEffort: null }`. Levels are looked up by model name for every provider, `custom` included. For `copilot` they are restricted to `low`, `medium`, `high`, `xhigh`, `max` (`none` and `minimal` dropped), and `auto` answers no levels ([llm-settings](../capabilities/llm-settings/spec.md) R60).
- Response `200`: `EffortLevelsView` (bare), from the built-in table in [agents.md](agents.md) section 1.4. Pure lookup: no provider call, nothing stored.

#### 32b. `POST /llm/models`
- Body: `ListLlmModelsDto`. For `copilot` the body carries only the provider: the backend asks the Copilot runtime for the signed-in seat's models (15 s timeout) and answers their ids in its order, duplicates removed, `[]` when it lists none (a Copilot Free seat); not signed in or a runtime failure answers the Copilot texts above. The rest of this section is about `custom`.
- A blank or omitted `apiKey` uses the key stored for `custom` when the stored provider is `custom` and has one; otherwise the request carries no credential. Nothing is persisted.
- Calls the endpoint's model list (table above) once, 15 s timeout, and reads the ids from `data[].id` (both styles).
- Success (Style A): `{ ok:true, models: string[] }`: the ids in the server's order, duplicates removed (first kept); `[]` when the server lists none.
- Failure: `{ ok:false, message }`: `"provider must be custom or copilot to load models"`, the custom validation texts of 30 (`apiStyle`, `baseUrl`), a stored key that cannot be decrypted (same text as 30), the custom endpoint error texts above, `"Model list request timed out after 15s"`, and `"The endpoint did not return a model list — type the model name instead"` when the body is not JSON or has no `data` array (llm-settings R48).

#### 32c. `GET /llm/copilot/status`
- Response `200`: `CopilotStatusView` (bare). Asks the local Copilot runtime (started on first use) for its auth status; nothing is stored and no GitHub credential is returned.
- Signed in: `{ signedIn:true, login:"<login>", method:"<how>", message:"Signed in to GitHub as <login>" }`.
- Not signed in: `{ signedIn:false, login:null, method:null, message:"Not signed in to GitHub — run \"gh auth login\" (or sign in to the GitHub Copilot CLI or app) on this machine, then test again" }`.
- Runtime cannot start: `{ signedIn:false, login:null, method:null, message:"The GitHub Copilot runtime could not start — <detail>" }`.

### 2.6 Agents, hub and evals

Controller prefix `/agents`. Capability: agents-evals. `:key` is the Mastra registry key (`assistant`, `visualization`, `sql-fixer`, `sql-verifier`, `knowledge-bootstrap`, `assistant-eval-judge`, `assistant-v2`, `data-readiness`; see [agents.md](agents.md)) **or** the id of a user agent ([data-model.md](data-model.md) section 3.10); the registry is checked first. `:id` is always a user-agent id. The catalogue merges both kinds. Rules: R43-R52, R97-R104 and R106 in [agents-evals](../capabilities/agents-evals/spec.md). The user-agent routes are declared before `GET /agents/:key`.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 33 | `GET /agents` | Agent catalogue | yes |
| 34 | `GET /agents/:key` | One agent in detail | yes |
| 34a | `GET /agents/:key/skills` | The agent's skills | yes |
| 34b | `GET /agents/:key/skills/:name/file` | One file of one of the agent's skills | yes |
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
| 103 | `PUT /agents/:key/prompt` | Save a built-in agent's system prompt (an override) | yes |
| 104 | `DELETE /agents/:key/prompt` | Reset a built-in agent's system prompt to the shipped one | yes |

#### 33. `GET /agents`
- Response `200`: `{ agents: AgentSummary[] }` sorted by `name`, built-in and user agents together.
- `AgentSummary = { key, id, name, description, tools: string[] /* sorted tool names; a user agent shows those its effective configuration selects (agents.md 2.1) */, kind: 'official'|'system'|'user', status: 'builtin'|'draft'|'live', pinned: boolean, owner: 'Official'|'System'|'You', hasUnpublishedChanges: boolean, missingDatasets: string[], datasets: string[], starterQuestions: string[] }` (`chatRequirement` was removed 2026-11-12 with the agent Run).
- For a user agent `key` equals `id`, and `name`, `description`, `datasets`, `starterQuestions` and `tools` come from the Live version when there is one, else the draft. For a built-in agent `status` is `builtin`, `hasUnpublishedChanges` is `false` and `datasets`, `starterQuestions` and `missingDatasets` are empty, except for a built-in agent that declares a dataset for its sessions (none today; the `rfp` agent that did was removed on 2026-11-12, and `GET /agents/rfp` answers `Agent "rfp" not found`, as for the showcase agents below). The four former showcase agents (`benchmarking`, `survey`, `lad-coe`, `strategy`) were removed in 1.23.8: they are not in the registry, so `GET /agents` does not list them and `GET /agents/benchmarking` answers `Agent "benchmarking" not found`; a pin or prompt override saved for one of those keys is ignored. The **Data Readiness Agent** (`data-readiness`; [agents.md](agents.md) 2.10) declares a dataset *kind* instead of a name: its `datasets` lists the names of every dataset bound to a `postgres` or `databricks` datasource, its `missingDatasets` is empty, its `starterQuestions` are its three starters (data-readiness R2). The **Questions to Insights v2** agent (`assistant-v2`; [agents.md](agents.md) 2.11) has no dataset of its own, like the `assistant`: empty `datasets`, `missingDatasets` and `starterQuestions`. `kind` is `official` for `assistant`, `assistant-v2` and `data-readiness`, and `system` for the other built-in agents.

#### 34. `GET /agents/:key`
- Response `200`: `AgentDetail = AgentSummary & { draft?: AgentConfig; live?: AgentConfig /* user agents only; shapes in data-model 3.10 */; instructions: string /* prompt flattened to text */; toolDetails: { name, description, inputs: string[] /* top-level input param names */ }[]; memory: { storage: string|null; lastMessages: number|false|null; semanticRecall: boolean; workingMemory: boolean; generateTitle: boolean } | null; model: { id: string; provider: string } | null /* null when no LLM settings saved */; toolLinks?: { name: string; status: 'always-on'|'linked'|'not-linked'; linkedVia: { instructions: boolean; skills: string[] /* skill names, sorted */ } }[] /* user agents only: every library tool sorted by name, from the Live version, else the draft */; llm: { provider: string | null; providerName: string | null; model: string | null; apiKeyConfigured: boolean; maxOutputTokens: number | null; reasoningEffort: string | null } /* the effective LLM settings the agent resolves to; never the key; every field null/false when no LLM is saved */; prompt?: { editable: string /* as served: the override, else the shipped text */; shipped: string; modified: boolean; builtInChanged: boolean /* modified and the shipped text's hash differs from baseHash */; linksAllowed: boolean /* true for assistant, assistant-v2 and data-readiness only; false for the System agents */; updatedAt: string | null /* the override's */ } /* built-in agents only */; workflow?: AgentWorkflow /* workflow-backed built-in agents only (today assistant-v2) */; usedInWorkflows: { id: string; name: string }[] /* always present */ }`.
- `usedInWorkflows` lists the workflows whose steps call the agent ([agents.md](agents.md) 5.12): `assistant-v2` → `[{ id: 'qti-v2-turn', name: 'Questions to Insights v2' }]`; every other agent (the assistant, the Data Readiness Agent, every user agent, the System agents) → `[]`. Agents are a library, not workflows (ADR-0042).
- `AgentWorkflow = { id: string; steps: { id: string; title: string; kind: 'code' | 'agent'; summary: string; input: string[]; output: string[]; agent?: { name: string; tools: string[]; maxSteps: number } /* the agent step only */; exits: { label: string; outcome: 'fails' | 'stops' }[] }[] }`. The steps are in run order, and it is built from the workflow's step catalogue ([agents.md](agents.md) 5.11): for v2, `id` is `qti-v2-turn`, the agent is `Questions to Insights v2` with its three tools and `maxSteps` 15. It is read-only and never stored ([agents-evals](../capabilities/agents-evals/spec.md) R108).
- For a built-in agent, `instructions` is the prompt as served, so it reflects an override (ADR-0026), and `prompt` carries the editable text, the shipped text and the override state ([data-model.md](data-model.md) 3.10.3). For the `assistant`, `editable` and `shipped` exclude the generated `## Tools` section ([agents.md](agents.md) 2.1).
- A user agent runs on the assistant, so its `instructions`, `toolDetails`, `memory` and `model` describe the assistant, with the prompt and tools that the agent's tool selection gives it (Live version, else draft; [agents.md](agents.md) 2.1). Its own instructions are in `draft` and `live`, with links as written (R81). `toolLinks` (user agents) says why each library tool is there: `always-on` for `list_entities`, `describe_entity` and `run_readonly_sql`, `linked` when the instructions or a linked skill's body link it, else `not-linked`; the tools of its skills come from the Live copies, else the current skills. `llm.model` is the agent's own `model` override when a user agent sets one, else the configured model; `llm.reasoningEffort` is the agent's override, else the configured one. `llm` never carries the API key, only whether one is saved ([../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md) R87-R89).
- Errors (Style B): `404 "Agent \"<key>\" not found"`. `:key` is resolved as a registry key first, then as a user-agent id.

#### 34a. `GET /agents/:key/skills`
- Response `200`: `AgentSkillsView`. A user agent runs on the assistant, so it answers with the assistant's skills, followed by its own in-app skills, sorted by name among themselves (level `in-app`, loading `on-demand`): the `liveSkills` copies when it has a Live version, else the current skills its draft names. Their `files` are `SKILL.md` (rendered as in [agents.md](agents.md) 7.3) and the reference files, and 34b reads them. The built-in skills ship with the app (there are no user or project skills; ADR-0021); how they load and are checked is in [agents.md](agents.md) 7.3. The response shows what the backend loaded when it started.
  ```ts
  type SkillLevel = 'built-in' | 'in-app';
  AgentSkillsView = {
    skills: {
      name: string; description: string; level: SkillLevel;
      loading: 'on-demand' | 'harness';
      files: { path: string; size: number }[]; // every regular file in the folder, relative, '/'-separated; SKILL.md first, then sorted
      modified?: boolean;           // true when an in-app override of a built-in is served (data-model 3.10.2)
    }[];                            // sorted by name
  }
  ```
- Errors (Style B): `404 "Agent \"<key>\" not found"`.

#### 34b. `GET /agents/:key/skills/:name/file`
- Query: `path` (required), a path relative to the skill's folder as listed in `files`.
- Response `200`: `{ path: string; size: number; content: string | null }`. `content` is `null` when the file is larger than 256 KB or is not UTF-8 text (it holds a NUL byte); the UI says so instead of showing it.
- Reads only that skill's folder (34a). Symbolic links are neither listed nor read.
- Errors (Style B): `404 "Agent \"<key>\" not found"`; `404 "Agent \"<key>\" has no skill \"<name>\""`; `400 "Invalid skill file path \"<path>\""` for an empty, absolute or `..` path; `404 "Skill \"<name>\" has no file \"<path>\""`.

#### 35. `GET /agents/:key/evals`
- Response `200`: `{ sets: AgentEvalSet[] }`: the sets whose agent is `:key` (a set's `agentKey`, default `assistant`; [agents.md](agents.md) 8.1). Only `assistant` and `data-readiness` have sets; any other key returns `{ sets: [] }` (no 404). `AgentEvalSet = { id, name, description, cases: { id, question, intent, checks: { id, name, description }[] }[] }`.

#### 36. `POST /agents/:key/evals/run`
- Body: `{ datasourceId: string; caseIds?: string[] }`. `caseIds` omitted = all questions.
- Success: `{ ok:true, message:"Eval run started", jobId }`. Returns immediately; the run is long-running (see [3.3](#33-eval-runs)).
- Failures (Style A, `ok:false`): `"Agent \"<key>\" has no evals to run"` (an agent with no sets: neither `assistant` nor `data-readiness`); `"An eval run is already in progress for this agent"` (also returns the running `jobId`); `"Pick a datasource to run against"`; `"That datasource has no datasets — create one in Datasets before running evals"`; `"Pick at least one question to run"`; fixture/dataset coverage errors (the datasets bound to the datasource must expose the entities the selected questions need).
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
- Body: `{ name: string; description?: string; instructions?: string /* may link skills and tools: [[skill:<name>]], [[tool:<name>]] */; datasets?: string[]; starterQuestions?: string[]; model?: string; reasoningEffort?: 'low'|'medium'|'high' }`. Limits and normalisation: R43. The agent's `tools` and `skills` are **derived from the links in `instructions`** and stored ([data-model.md](data-model.md) 3.10); a `tools` or `skills` field in the body is ignored.
- Success: `{ ok:true, message:"Agent \"<name>\" saved as draft", agent: AgentSummary }`. The agent is a draft, not pinned.
- Failures (Style A): `"Agent name is required"`; `"An agent named \"<name>\" already exists"`; `"Unknown skill \"<name>\""` for a `[[skill:<name>]]` that is neither a built-in on-demand skill nor one of the caller's in-app skills (a built-in on-demand skill link, such as `curated-knowledge`, is accepted and not counted toward the 10-skill limit); `"Unknown tool \"<name>\""` for a `[[tool:<name>]]` that is not a library tool (`list_entities`, `describe_entity`, `sample_rows`, `run_readonly_sql`, `create_visual`, `update_visual`, `ask_clarification`); `"An agent can have at most 10 skills"`. Checked after the name checks, in this order: unknown skill, the 10-skill limit on the distinct linked skills, then unknown tool.

#### 42. `PUT /agents/:id/draft`
- Body: as endpoint 41. Replaces the whole draft; a Live version is untouched.
- Success: `{ ok:true, message:"Draft saved", agent: AgentSummary }`.
- Failures (Style A): `"Agent \"<id>\" not found"`; `"Agent name is required"`; `"An agent named \"<name>\" already exists"`; `"Unknown skill \"<name>\""`; `"Unknown tool \"<name>\""`; `"An agent can have at most 10 skills"` (as 41; a built-in on-demand skill link is accepted and not counted); `"Built-in agents can't be edited"` (`:id` is a registry key).

#### 43. `POST /agents/:id/publish`
- No body. Copies the draft to the Live version, copies the skills it names into `liveSkills` ([data-model.md](data-model.md) 3.10), and stamps `publishedAt`.
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

### 2.6.1 Skills

Controller prefix `/skills`. Capability: agents-evals (R68-R74). In-app skills are described in [data-model.md](data-model.md) 3.10.1.

| # | Method + path | Purpose | Style A |
|---|---|---|---|
| 94 | `GET /skills` | The caller's skills | no |
| 95 | `GET /skills/:id` | One skill in full | no |
| 96 | `POST /skills` | Create a skill | yes |
| 97 | `PUT /skills/:id` | Save a skill | yes |
| 98 | `DELETE /skills/:id` | Delete a skill | yes |
| 99 | `GET /skills/built-in` | The built-in skills and their override state | no |
| 100 | `GET /skills/built-in/:name` | One built-in skill, as served and as shipped | no |
| 101 | `PUT /skills/built-in/:name` | Save an override | yes |
| 102 | `DELETE /skills/built-in/:name` | Reset to the built-in | yes |

The `built-in` routes are declared before `/skills/:id`.

#### 94. `GET /skills`
- Response `200`: `{ skills: SkillSummary[] }` sorted by `name`. `SkillSummary = { id, name, description, fileCount: number, agents: string[] /* names of the caller's agents whose draft or Live version names the skill, sorted; each is the agent's draft name */, tools: string[] /* the tools its body links, sorted, distinct */, updatedAt }`.

#### 95. `GET /skills/:id`
- Response `200`: `Skill = SkillSummary & { body: string; files: { path: string; content: string }[] }`.
- Errors (Style B): `404 "Skill \"<id>\" not found"`.

#### 96. `POST /skills`
- Body: `{ name: string; description: string; body: string; files?: { path: string; content: string }[] }`. Name and description are trimmed.
- Success: `{ ok:true, message:"Skill \"<name>\" created", skill: Skill }`.
- Failures (Style A), checked in this order, the first that applies: `"Skill name is required"`; `"Use lowercase letters, digits and single hyphens in a skill name"`; `"A skill name is at most 64 characters"`; `"\"<name>\" is the name of a built-in skill"`; `"A skill named \"<name>\" already exists"`; `"The description must start with \"Use when\""`; `"The description is at most 300 characters"`; `"The body is empty"`; `"The body is at most 20,000 characters"`; `"A skill has at most 10 reference files"`; `"Name reference files references/<file name>"`; `"Two reference files are named \"<path>\""`; `"\"<path>\" is at most 20,000 characters"`; `"The body names <path>, which this skill doesn't have"`; `"Skills can link tools only"` (the body has a `[[skill:…]]`); `"Unknown tool \"<name>\""` (a `[[tool:…]]` that is not in the library, as in 41).

#### 97. `PUT /skills/:id`
- Body: as 96. Replaces the whole skill; its id stays, so the agents that link it keep it. Live agents keep their copies until republished.
- Success: `{ ok:true, message:"Skill saved", skill: Skill }`.
- Failures (Style A): `"Skill \"<id>\" not found"`; as 96; `"\"<name>\" is linked by <agent names, comma-separated>. Unlink it first."` when the name changes while the draft of any of the caller's agents links the skill (agent names sorted).

#### 98. `DELETE /skills/:id`
- Success: `{ ok:true, message:"Skill \"<name>\" deleted" }`. Nothing else changes ([data-model.md](data-model.md) 3.10).
- Failures (Style A): `"Skill \"<id>\" not found"`; `"\"<name>\" is linked by <agent names, comma-separated>. Unlink it first."` while the draft of any of the caller's agents links the skill (names sorted); Live agents don't block it.

#### 99. `GET /skills/built-in`
- Response `200`: `{ skills: BuiltInSkillSummary[] }` sorted by name. `BuiltInSkillSummary = { name, description /* as served */, loading: 'on-demand' | 'harness', agents: string[] /* registry keys, agents.md 7.4 */, tools?: string[] /* the tools the served body links as [[tool:<name>]], in order of first appearance; left out when it links none */, modified: boolean, builtInChanged: boolean /* modified and the shipped built-in's hash differs from baseHash */, updatedAt: string | null /* the override's */ }`.

#### 100. `GET /skills/built-in/:name`
- Response `200`: `BuiltInSkill = BuiltInSkillSummary & { body: string; files: { path, content }[] /* as served */; builtIn: { description, body, files } /* as shipped */ }`.
- Errors (Style B): `404 "Unknown built-in skill \"<name>\""`.

#### 101. `PUT /skills/built-in/:name`
- Body: `{ description: string; body: string; files: { path: string; content: string }[] }`. Saves the override (ADR-0023); it applies to the next call.
- Success: `{ ok:true, message:"Built-in skill \"<name>\" saved", skill: BuiltInSkill }`.
- Failures (Style A), the first that applies: `"Unknown built-in skill \"<name>\""`; `"The description must start with \"Use when\""`; `"The description is at most 300 characters"`; `"The body is empty"`; `"The body is at most 20,000 characters"`; `"<path> is not a file of this skill"`; `"<path> is missing (the skill it overrides has it)"`; `"\"<path>\" is at most 20,000 characters"`; `"<path> must use the placeholders {{a}}, {{b}}"` or `"<path> must use no placeholders"`.

#### 102. `DELETE /skills/built-in/:name`
- Success: `{ ok:true, message:"Built-in skill \"<name>\" reset" }`, also when there was no override.
- Failures (Style A): `"Unknown built-in skill \"<name>\""`.

#### 103. `PUT /agents/:key/prompt`
- Body: `{ prompt: string }`, trimmed; the checks below run on the trimmed text. Saves the override (ADR-0026); it applies to the next call of every session, user agent, visual and eval run.
- Success: `{ ok:true, message:"System prompt of \"<name>\" saved", agent: AgentDetail }`.
- Failures (Style A), the first that applies: `"Agent \"<key>\" not found"`; `"Only built-in agents have a shared system prompt; edit a user agent's instructions instead"` (`:key` is a user-agent id); `"The prompt is empty"`; `"The prompt is at most 20,000 characters"`; for the `assistant` only: `"The assistant's prompt must start with \"You are the Questions to Insights assistant\""`, `"Only built-in skills can be linked here: this prompt is shared by every user"` (a `[[skill:<name>]]` whose name is not a built-in on-demand skill; a built-in one is accepted), `"Unknown tool \"<name>\""` (a `[[tool:…]]` not in the library, as in 41); for the `data-readiness` agent only (agents.md 2.10): `"The Data Readiness Agent's prompt must start with \"You are the Data Readiness Agent\""`, `"Only the Data Readiness Agent's own skills can be linked here: this prompt is shared by every user"` (any `[[skill:…]]` other than `data-readiness`), `"Unknown tool \"<name>\""` (a `[[tool:…]]` that is not one of its tools: `assess_data_readiness`, `get_readiness_report`, `list_readiness_reports`, `show_in_panel`, `ask_clarification`); for the `assistant-v2` agent only (agents.md 2.11): `"The Questions to Insights v2 prompt must start with \"You are Questions to Insights v2\""`, `"Skills can't be linked here: Questions to Insights v2 has no skills"` (any `[[skill:…]]`), `"Unknown tool \"<name>\""` (a `[[tool:…]]` that is not one of its tools: `list_entities`, `describe_entity`, `run_readonly_sql`); for a System agent only: `"This agent's prompt can't contain links"` (any `[[…]]`).
- Declared before the `GET /agents/:key` catch-alls.

#### 104. `DELETE /agents/:key/prompt`
- Success: `{ ok:true, message:"System prompt of \"<name>\" reset", agent: AgentDetail }`, also when there was no override.
- Failures (Style A): `"Agent \"<key>\" not found"`; the user-agent refusal of 103.

### 2.6.2 Workflows

Controller prefix `/workflows`. Capability: [workflows](../capabilities/workflows/spec.md) (R1-R4, R11, R14-R18). Workflows are defined in code (ADR-0040), and there is no write route. Since 2026-11-12 (ADR-0042) the catalogue holds one workflow, `qti-v2-turn`; the ids `agent:<registry key>`, `agent:<user-agent id>`, `seq-text-demo` and `deep-analysis` are removed and answer the not-found error of 117-119. A workflow with input fields can be run once (118) or run streamed (119) (ADR-0041); every run is stored (since 1.23.14, [data-model.md](data-model.md) 3.16) and read back through section 2.6.3. `:id` is a workflow id (`qti-v2-turn`; [agents.md](agents.md) 5.12).

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 116 | `GET /workflows` | The workflow catalogue | no |
| 117 | `GET /workflows/:id` | One workflow with its steps | no |
| 118 | `POST /workflows/:id/runs` | Run a workflow once on an input and answer when it ends | no |
| 119 | `POST /workflows/:id/runs/stream` | Run a workflow once on an input, streamed (SSE) | yes |

#### 116. `GET /workflows`
- Response `200`: `{ workflows: WorkflowSummary[] }`.
  ```ts
  type WorkflowSummary = {
    id: string;                       // 'qti-v2-turn' (the only one since 2026-11-12)
    name: string;
    description: string;
    kind: 'code' | 'agent';           // always 'code' since 2026-11-12 (the one-step 'agent' kind is no longer produced)
    owner: 'Official' | 'You';        // always 'Official' since 2026-11-12 ('You' was a user agent's workflow)
    agents: { key: string; name: string }[];   // the agents its steps call, in step order, each once
    stepCount: number;
    bar: 'steps' | 'agent';           // what drove a chat's workflow bar (kept for the stored chats): these steps, or the agent's own phases
    trigger: 'run';                   // every workflow runs once on a typed input (118, 119); since 1.23.22 there is no 'chat' trigger
    input: WorkflowInputField[];      // the Start (input) node: the typed input a run takes, in form order (every workflow has one since 1.23.12)
    datasets: string[];               // the datasets the workflow's agent declares; [] when the run picks them (Questions to Insights v2)
    missingDatasets: string[];        // named datasets that don't exist (as AgentSummary.missingDatasets)
    starterQuestions: string[];       // the agent's, as AgentSummary.starterQuestions
  };
  type WorkflowInputField = {
    name: string;                     // the key in 118's and 119's `input`
    label: string;
    type: 'text' | 'textarea' | 'number'
        | 'boolean'                   // a checkbox; absent means false (or `default`)
        | 'datasets'                  // one or more dataset names
        | 'dataset';                  // exactly one dataset name
    required: boolean;
    placeholder?: string;
    help?: string;                    // one line under the control
    default?: string | number | boolean;  // the value of a field that is missing or empty
    datasourceKinds?: ('postgres' | 'databricks' | 'rest')[];  // 'dataset' / 'datasets': only datasets bound to these kinds
    hidden?: boolean;                 // set by the app, never rendered as a control
    maxLength?: number;               // 'text' / 'textarea': the most characters of the trimmed text (118's rules)
    min?: number;                     // 'number': the smallest value
    max?: number;                     // 'number': the largest value
    usedBy: string[];                 // the ids of the steps that read the field straight from the input (a step whose `input` names it while no earlier step's `output` does), in step order; [] when none does
  };
  ```
- **The input node covers every step.** Every field a step's input schema requires is a field of the workflow's `input` or an output of an earlier step, with a compatible type; the catalogue refuses (throws when it loads) a workflow that breaks this, and a unit test checks every catalogued workflow (`checkWorkflowContract`, `backend/src/mastra/workflows/workflow-contract.ts`; [agents.md](agents.md) 5.12). A rule field (`maxLength`, `min`, `max`) is sent only where the field has one.
- Values:

  | id | name | kind | agents | stepCount | bar | datasets |
  |---|---|---|---|---|---|---|
  | `qti-v2-turn` | `Questions to Insights v2` | code | `assistant-v2` | 4 | steps | none |

- Description, starter questions and missing datasets come from the agent's catalogue entry (33); v2's starter questions are empty, as in its AgentSummary.
- **Trigger and input:** `qti-v2-turn` is a run workflow: `trigger: 'run'` and, since 1.23.12, an `input` it runs on (118, 119; [workflows](../capabilities/workflows/spec.md) R14):

  | id | `input` (in order) |
  |---|---|
  | `qti-v2-turn` | `question` (`Question`, textarea, required, placeholder `Ask a question about your data`, `maxLength` 4000, `usedBy` `['receive-question']`); `datasets` (`Datasets`, datasets, required, `usedBy` `['receive-question']`) |

- **Order:** `qti-v2-turn` only. No agent (System, Official or user) is listed.

#### 117. `GET /workflows/:id`
- Response `200`: `WorkflowDetail = Omit<WorkflowSummary, 'agents'> & { agents: WorkflowAgentDetail[]; steps: WorkflowDetailStep[]; contractHash: string }`, with `AgentWorkflow` exactly as 34 defines it. A `WorkflowDetail` is structurally an `AgentWorkflow` (it has `id` and `steps`).
  ```ts
  type WorkflowAgentDetail = {
    key: string; name: string;        // as 116's agents entry, same order (step order, each once)
    model: string | null;             // `${llm.provider}/${llm.model}` of 34's AgentDetail.llm; null when no LLM is set (never the environment's fallback)
    systemPrompt: string;             // 34's AgentDetail.instructions, at most 20 000 characters; each run adds its own context
    systemPromptTruncated?: true;     // the prompt was longer than 20 000 characters and was shortened
    toolDetails: { name: string; description: string; inputs: string[] }[];   // 34's AgentDetail.toolDetails, as is (sorted by name; inputs: top-level input param names)
  };
  type WorkflowDetailStep = Omit<AgentWorkflowStep, 'agent'> & {
    agent?: { key: string; name: string; tools: string[]; maxSteps: number };   // `key`: the agent's registry key or user-agent id
    inputSchema: JsonSchema;          // the step's declared input (agents.md 5.12); `input` is its property names, in order
    outputSchema: JsonSchema;         // the step's declared output; `output` is its property names, in order
  };
  // JSON Schema draft 2020-12 as Zod 4's z.toJSONSchema writes it, without `$schema`: an object schema
  // whose `properties` each carry `type` (a string, or e.g. ['string', 'null'] for a nullable field),
  // `items` for an array, `description`, and nested `properties`/`required` for an object; `required`
  // lists the required properties. The input side has no `additionalProperties`; the output side has
  // `additionalProperties: false` (a step passes on only its declared fields).
  type JsonSchema = {
    type?: string | string[]; properties?: Record<string, JsonSchema>; required?: string[];
    items?: JsonSchema; description?: string; anyOf?: JsonSchema[]; additionalProperties?: boolean | JsonSchema;
  };
  ```
- `input` is 116's, each field with its rules and `usedBy` (the Start node's Parameters, [ui.md](ui.md) 4.4b).
- `contractHash`: the workflow's data contract as 12 hex characters: the first 12 of the sha256 of the canonical JSON (keys sorted at every level) of `{ input: [{ name, type, required }] (each input field, in order), steps: [{ id, inputSchema, outputSchema }] (in order) }`. It changes when any step schema, step id or input field's name, type or `required` changes, and only then (not with a label, help text or the workflow's name). Each run stores the hash it started with (121 `contractHash`). For `qti-v2-turn`, Analyse's `inputSchema` has `question` (`type: 'string'`) and `catalog` (an array of entity objects), both required.
- Each agent step's `agent` also names its agent's `key`: the agent the code workflow runs for (`assistant-v2` for `qti-v2-turn`). `agents` is 116's list with each agent's `model`, `systemPrompt` and `toolDetails` read from 34 (the workflow page's tool dialog, [ui.md](ui.md) 4.4b); 116 itself is unchanged.
- For `qti-v2-turn`, `steps` equals `agentWorkflow('assistant-v2').steps`, the `workflow` of 34, with `key` on its agent step's `agent` and each step's `inputSchema` and `outputSchema` (34's `workflow` carries no schemas).
- Errors (Style B): `404 "Workflow \"<id>\" not found"` for any id 116 does not list: unknown, a removed one (`agent:assistant`, `agent:data-readiness`, `agent:<user-agent id>`, `seq-text-demo`, `deep-analysis`), a System agent (`agent:sql-fixer`), or the workflow's own agent (`agent:assistant-v2`).

#### 118. `POST /workflows/:id/runs`
- Body: `{ input: Record<string, string | number | boolean | string[]>, context?: { fromRunId: string } }`. Runs the workflow once on `input` and answers when the run ends (no streaming). Capability: [workflows](../capabilities/workflows/spec.md) R11, R14; engine: [agents.md](agents.md) 5.14. The UI uses 119.
- Response `200`: the `WorkflowRun` 119 ends with (`done.run`), whatever its status. It is always the stored run, as 121 reads it; the separate result shape with a `runId` is gone.
- A failing step makes the run `failed`, with its error as the run's `error`; the steps after it are `skipped`.
- Input: the input node validates the **whole** input before the run (`validateWorkflowInput`, `backend/src/mastra/workflows/workflow-input.ts`). Only the workflow's declared fields are read, in field order; a number field's value is converted to a number; a `datasets` value is a list of names, trimmed, without repeats; any other key is ignored; a text value is kept as sent. A field that is missing, `""` or **whitespace-only** is missing: it takes its `default` (a boolean `false`); a required one without a default is refused; an optional one without a default is left out.
- Errors (Style B, 400), checked before anything runs; **every** error is collected, at most one per field, in field order, then the `context` error:
  ```ts
  type RunInputRefusal = {
    statusCode: 400;
    error: 'Bad Request';
    message: string;                                   // the first error's message (what a client that reads only `message` shows)
    errors: { field: string | null; message: string }[];   // all of them; `field` is the input field's `name`, null for a non-field error
  };
  ```
  Field errors (`field` = the field's name): `"<label> is required"` for a required field that is missing, `""` or whitespace-only (`"Question is required"`); `"Select at least one dataset"` for a required `datasets` field with none; `"<label> must be a number"`; `"<label> must be at least <min>"` / `"<label> must be at most <max>"` for a number outside `min` / `max`; `"<label> must be at most <maxLength> characters"` for a text whose trimmed length is over `maxLength` (`"Question must be at most 4000 characters"`); `"<label> must be true or false"`; `"Dataset \"<name>\" not found"`; `"Dataset \"<name>\" is not a <kinds> dataset"` (the field's `datasourceKinds` named, e.g. `PostgreSQL or Databricks`). Non-field errors (`field: null`): `"Run \"<id>\" not found"` for a `context.fromRunId` that names no stored run, and `"Run \"<id>\" has no answer to continue from"` for a stored run without a question and answer, listed after the field errors; `"Workflow \"<id>\" can't run on an input"` alone, for a workflow with no input fields. Example: `{ input: { question: "  ", datasets: [] } }` answers `{ statusCode: 400, error: "Bad Request", message: "Question is required", errors: [{ field: "question", message: "Question is required" }, { field: "datasets", message: "Select at least one dataset" }] }`. `404 "Workflow \"<id>\" not found"` for any id 116 does not list (plain Style B, no `errors`).
- A refused run is never stored and no step runs.
- Side effects: the run is stored in `workflow_runs` ([data-model.md](data-model.md) 3.16) as `running` before it starts and updated when it ends, with its steps, output or error; an engine failure is stored as `failed` and answered as the error it is. A run is 119's, without the stream.

#### 119. `POST /workflows/:id/runs/stream`
- Body: as 118. Runs the workflow once on `input`, streamed: `qti-v2-turn` streams its step events, its analyse step running one agent turn on a run host through the chat turn path ([agents.md](agents.md) 5.14), so its model request equals a chat turn's for the same input. Capability: [workflows](../capabilities/workflows/spec.md) R14-R17.
- Refusals: 118's, the same body (`message` and `errors[]`), answered as plain JSON (`application/json`) with their real status (Style B) **before** the stream starts: no SSE frame is sent, no run is stored, no step runs.
- Response `200`, SSE (section 3.6).
- Side effects: the run is stored in `workflow_runs` ([data-model.md](data-model.md) 3.16) as `running` before the `run` event is sent, and updated when it ends (`success`, `failed` or `stopped`, a stop included); a run that throws while it ends is stored `failed` with that error. A run creates the run host `run-<run id>` (in memory, never listed) and its workspace `workspaces/session-run-<run id>/` (a session workspace's layout, [data-model.md](data-model.md) 4.1); after the turn the host's memory thread is deleted and the host leaves memory. The workspace stays with the stored run, so its files download through 123-127, until the run is deleted (122).

### 2.6.3 Workflow runs

Controller prefix `/workflow-runs`. Capability: [workflows](../capabilities/workflows/spec.md) (R18-R20, R25) and [visuals](../capabilities/visuals/spec.md) (130-134). The stored runs of 118 and 119 ([data-model.md](data-model.md) 3.16): the history, one run, its deletion, the files of its workspace, and the chats with its agent steps (136, 137). The file routes are served by the same services as a session's (9, 14, 105-107), given the run's **run-backed host**: a `SessionDoc` shaped from the stored run (id `run-<id>`, workspace `session-run-<id>`, its agent binding, panel items, visuals, and its question and answer as the transcript), never held or listed. `:id` is a run id (a uuid). Style B throughout.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 120 | `GET /workflow-runs` | The run history, newest first | no |
| 121 | `GET /workflow-runs/:id` | One stored run | yes |
| 122 | `DELETE /workflow-runs/:id` | Delete a run with its workspace | no |
| 123 | `GET /workflow-runs/:id/visualizations/:vid` | Load a run's visual (document + metadata) | no |
| 124 | `GET /workflow-runs/:id/visualizations/:vid/download` | A run's visual as a zip | no |
| 125 | `GET /workflow-runs/:id/panel-items/:itemId/file` | Read the text of a run's file panel item | yes |
| 126 | `GET /workflow-runs/:id/panel-items/:itemId/download` | Download a run's file, document or table panel item | yes |
| 127 | `GET /workflow-runs/:id/rfp-packages/:rfpId/download` | Download a run's RFP package (Removed 2026-11-12) | — |
| 128 | `POST /workflow-runs/:id/answer/feedback` | Thumbs up/down on a run's answer | yes |
| 129 | `POST /agents/:id/draft-runs/stream` | Try it: run a user agent's saved draft once, streamed (SSE), not stored (plan R12) | yes |
| 130 | `POST /workflow-runs/:id/visualizations` | Generate a visual from the run's answer | yes |
| 131 | `POST /workflow-runs/:id/visualizations/:vid/tailor` | Tailor a run's visual from an instruction | yes |
| 132 | `POST /workflow-runs/:id/visualizations/:vid/revert` | Move a run's visual to an earlier version | yes |
| 133 | `POST /workflow-runs/:id/visualizations/:vid/refresh` | Re-run the SQL behind a run's visual | yes |
| 134 | `POST /workflow-runs/:id/visualizations/:vid/repair` | Repair a run's failing visual once | yes |
| 136 | `GET /workflow-runs/:id/node-chats/:stepId` | A step's node chat in a run: its messages | yes |
| 137 | `POST /workflow-runs/:id/node-chats/:stepId/messages/stream` | Chat with a step's agent about the run's data, streamed (SSE) | yes |

#### 120. `GET /workflow-runs`
- Query: `workflowId` (optional): only that workflow's runs.
- Response `200`: `{ runs: WorkflowRunSummary[] }`, newest `startedAt` first, running runs included. No paging (as 1); the client pages.
  ```ts
  type WorkflowRunSummary = {
    id: string;
    workflowId: string;
    workflowName: string;            // the name when the run started (a deleted user agent's run still names it)
    status: 'running' | 'success' | 'failed' | 'stopped';
    title: string;                   // see below
    startedAt: string;
    finishedAt?: string;
  };
  ```
- `title` is the run's `question`, else the first `text` or `textarea` input of the workflow (not `hidden`, in form order, per 116) that has a value, else the workflow's name; trimmed, at most 120 characters. A workflow no longer in the catalogue has no text inputs to read, so its runs fall back to the question or the name.
- Errors: none expected.

#### 121. `GET /workflow-runs/:id`
- Response `200`: `WorkflowRun` (3.6): the stored document ([data-model.md](data-model.md) 3.16, with `ownerId`, `createdAt` and `updatedAt`) plus, for an agent run, the derived `panelItems` (the stored items and a `visual:<id>` item for each visual without one), `workflow` view and `agent`, computed on its run-backed host as a session's are (2.1) on every read. A code-only run is the document as stored. `done.run` of 119 is this same shape.
- Errors (Style B): `404 "Run \"<id>\" not found"`.

#### 122. `DELETE /workflow-runs/:id`
- Response `200`: `{ ok: true, message: "Run deleted" }`.
- Side effects: for an agent run, deletes its workspace `workspaces/session-run-<id>/` (its visuals, panel files, synthetic scripts) and its memory thread `run-<id>`, then its node chats (136, 137; [data-model.md](data-model.md) 3.17), then the document. A code-only run has neither, so only the document goes. A run given as another run's `context` may be deleted; the later run keeps `context.fromRunId` as a dangling reference.
- Errors (Style B): `404 "Run \"<id>\" not found"`; `400 "Stop the run before deleting it"` for a run still `running`.

#### 123. `GET /workflow-runs/:id/visualizations/:vid`
- As 9, over the run's workspace and `visualizations`: query `version`, response `InteractiveVisualization`.
- Errors (Style B): `404 "Run \"<id>\" not found"`; then 9's (`404 "Visualization <vid> not found in session run-<id>"`, `400 "Version <n> does not exist"`).

#### 124. `GET /workflow-runs/:id/visualizations/:vid/download`
- As 14: query `version`, `application/zip` with the same file name and contents.
- Errors (Style B): `404 "Run \"<id>\" not found"`; then 14's.

#### 125. `GET /workflow-runs/:id/panel-items/:itemId/file`
- As 106, over the run's panel items and its workspace: `{ item: FilePanelItem, contentType, text }`, with the same safe-path checks and 256 KB limit.
- Errors (Style B): `404 "Run \"<id>\" not found"`; then 106's (`404 "Panel item \"<itemId>\" not found"`, `400 "Panel item \"<itemId>\" is not a file"`, `404 "File \"<path>\" not found in the session workspace"`, `400 "File \"<path>\" is larger than 256 KB"`).

#### 126. `GET /workflow-runs/:id/panel-items/:itemId/download`
- As 107: query `format` (`pdf`, `md`, `csv`), the same attachments and file names.
- Errors (Style B): `404 "Run \"<id>\" not found"`; `400 "Unknown download format \"<format>\": use pdf, md or csv"` (checked first); then 107's.

#### 127. `GET /workflow-runs/:id/rfp-packages/:rfpId/download`
Removed 2026-11-12 with the RFP Builder: the route no longer exists (the number is not reused).

#### 128. `POST /workflow-runs/:id/answer/feedback`
- Body: `{ rating: "up" | "down" }`. As 7 on the run's answer: sets `feedback` and `verified` on the stored answer; `up` saves a verified query keyed by `sourceRunId` (question = the run's question; same SQL, datasource and entity rules as 7), `down` deletes it.
- Success `200`: `{ ok: true, message, run }` (`message` as 7, `run` as 121).
- Errors (Style B): `400 "rating must be 'up' or 'down'"`; `404 "Run \"<id>\" not found"`; `404 "Run \"<id>\" has no answer"`.

#### 129. `POST /agents/:id/draft-runs/stream`
- Prefix `/agents`, served by the workflows module's draft-runs controller. Capability: [agents-evals](../capabilities/agents-evals/spec.md) R60, R61. `:id` is a user agent's id.
- Body: `{ input: { question: string } }`. Runs the agent's saved **draft** once on the question, streamed as 119 is (section 3.6, same events and framing). The agent turn runs on a run host that is a preview-shaped session over the draft (its instructions, model and effort overrides, linked tools and skills, and the datasets of it that exist), through the chat turn path ([agents.md](agents.md) 5.14), so its model request equals a chat turn's. The `run` event carries `workflowId: "agent:<id>"`.
- Refusals (Style B, before the stream starts, nothing runs): `404 "Agent \"<id>\" not found"`; `400 "Select at least one dataset to preview"` when none of the draft's datasets exists; `400 "Question is required"` for a missing or blank question.
- Side effects: **none are kept.** The run is not stored in `workflow_runs` (it is not in 120 or 121); its host `run-<run id>` and workspace `session-run-<run id>` are created for the turn and deleted when the run ends, with its memory thread, however it ends (success, failure or a stop). `done.run` is the run as it ended, with its `answer`; it has no stored copy to read back, and its files do not download. A workspace left by a stop of the app is deleted at the next backend start (the runs' start-up recovery).

#### 130. `POST /workflow-runs/:id/visualizations`
- Body: `{ sourceMessageAt?: string }`. Omitted: the run's answer. As 8, over the run's workspace and its answer as the source.
- Success `201`: `{ ok: true, message: "Interactive visual generated", run, visualization }` (`run` as 121, `visualization` as 9, version 1).
- Side effects: writes the bundle under `workspaces/session-run-<id>/visuals/<visualId>/v1/`, upserts the run's `visualizations` and its `visual:<visualId>` panel item, and appends the card `Created interactive visual "<title>" (v1).` (a `ChatMessage` carrying `visual`) to the run's `events` (data-model 3.16).
- Errors (Style B): `404 "Run \"<id>\" not found"`; `400 "Run \"<id>\" has no answer to visualize"` (a code-only run); `400 "Wait for the run to finish"` (a run still `running`); then 8's refusals as statuses (`400 "completed assistant answer not found"`, `400` on a designer or validation error, timeout).

#### 131. `POST /workflow-runs/:id/visualizations/:vid/tailor`
- Body: `{ instruction: string }` (required, trimmed non-empty). As 10: a new version `v<n+1>`, the card `Updated interactive visual "<title>" (v<n+1>).` appended to `events`.
- Success `201`: `{ ok: true, message: "Updated to version <n>", run, visualization }`.
- Errors (Style B): as 130; `400 "instruction is required"`; `404 "Visualization <vid> not found in session run-<id>"`.

#### 132. `POST /workflow-runs/:id/visualizations/:vid/revert`
- Body: `{ version: number }`. As 11: moves `currentVersion` only; the card `Reverted interactive visual "<title>" (v<n>).` is appended to `events`.
- Success `201`: `{ ok: true, message: "Reverted to version <n>", run, visualization }`.
- Errors (Style B): as 130; `400 "Version <n> does not exist"` (also a missing or non-numeric `version`).

#### 133. `POST /workflow-runs/:id/visualizations/:vid/refresh`
- Body: none. As 12 over the run's `datasets`: re-runs each stored `run_readonly_sql` record of the current version and rewrites `data.json` and `index.html` in place; no new version, no designer call, no card.
- Success `201`: `{ ok: true, message: "Refreshed data for version <n>", run, visualization }`.
- Errors (Style B): as 130; `404 "Visualization <vid> not found in session run-<id>"`.

#### 134. `POST /workflow-runs/:id/visualizations/:vid/repair`
- Body: `{ error?: string; version: number }`. As 13: only the current version, and never an automatic repair again; no card.
- Success `201`: `{ ok: true, message: "Repaired as version <n>", run, visualization }`.
- Errors (Style B): as 130; `400 "Only the current version can be repaired (requested v<x>, current v<y>)"`; `400 "Version <n> is already an automatic repair; not repairing again"`.

#### 136. `GET /workflow-runs/:id/node-chats/:stepId`
- Response `200`: `{ messages: NodeChatMessage[] }`, oldest first; `[]` when nobody chatted with that step of the run (any `:stepId`).
  ```ts
  type NodeChatMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;                       // assistant: the answer, or what came before a stop or failure
    toolCalls?: WorkflowRunToolCall[];     // assistant: the turn's tool calls, as a run step's (3.6)
    stopped?: true;                        // assistant: the turn was stopped
    error?: string;                        // assistant: why the turn failed
    createdAt: string;
  };
  ```
- Errors (Style B): `404 "Run \"<id>\" not found"`.

#### 137. `POST /workflow-runs/:id/node-chats/:stepId/messages/stream`
- Body: `{ content: string }` (trimmed). Capability: [workflows](../capabilities/workflows/spec.md) R25.
- Runs one turn of the step's agent about that step's data in the stored run ([agents.md](agents.md) 5.16): the agent's own tools (read-only), the run's `datasets`, the chat's earlier messages, and a context block built server-side from the stored run (never from the client).
- Refusals (Style B, JSON, before any SSE frame; nothing is stored), in this order: `404 "Run \"<id>\" not found"`; `400 "Message is required"` (missing or blank `content`); `409 "The run is still running"`; `404 "Workflow \"<workflowId>\" not found"` for a run of a workflow the catalogue no longer holds; `400 "Step \"<stepId>\" has no agent to chat with"` (an unknown step or a code step); `400 "Step \"<stepId>\" did not run in this run"` (the run has no such step, or it is `skipped`); `409 "A reply about step \"<stepId>\" is already being written"` while another turn of the same chat runs.
- Response `200`: SSE with the framing of 3.1 (`data: <json>\n\n`). Events, in order: the agent turn's `reasoning`, `text`, `tool`, `tool-result` and `tool-progress` events (3.1, as the run stream sends them; no `run`, `step`, `workflow`, `panel-item` or `visual-updated`), then exactly one of `done { message: NodeChatMessage }` (the assistant message as stored) or `error { content }` (the turn failed; its message is stored with `error`).
- Closing the connection stops the turn: nothing more is sent, and the assistant message is stored with what came and `stopped: true`.
- Side effects: the user message is stored before the turn starts, the assistant message when it ends, in the chat of that run and step ([data-model.md](data-model.md) 3.17). The run document is never changed. The turn's host `run-<id>-node-<stepId>`, its memory thread and its workspace `session-run-<id>-node-<stepId>` exist only while the turn runs.

### 2.7 Deep analysis (removed 2026-11-12)

Controller prefix `/sessions`. Capability: none (the `deep-analysis` capability spec was deleted). Deep analysis was removed with ADR-0042: its start and poll routes went in 1.23.27, its report download and its workflow on 2026-11-12. Every route answers `404`; the numbers are not reused. Report files an old session left in its workspace stay on disk, unused.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 46 | `POST /sessions/:id/deep-analysis` | Start a job (Removed in 1.23.27) | — |
| 47 | `GET /sessions/:id/deep-analysis/:jobId` | Poll a job (Removed in 1.23.27) | — |
| 48 | `GET /sessions/:id/deep-analysis/:jobId/download` | Report as Markdown (Removed 2026-11-12) | — |

#### 46. `POST /sessions/:id/deep-analysis`
Removed in 1.23.27, and the workflow that replaced it on 2026-11-12. A call answers `404`.

#### 47. `GET /sessions/:id/deep-analysis/:jobId`
Removed in 1.23.27, and the workflow that replaced it on 2026-11-12. A call answers `404`.

#### 48. `GET /sessions/:id/deep-analysis/:jobId/download`
Removed 2026-11-12 with Deep analysis: the route no longer exists (the number is not reused). Reports an old session stored in its workspace (`reports/`) stay on disk, unreachable from the app.

### 2.8 Ontology

No controller prefix: the routes sit under `/datasets/:name/ontology` and `/ontology/:id`. Capability: dataset-ontology. **Style B throughout** (real status codes, bare bodies). Shape `OntologyItem` in data-model (3.9). The routes replace the former `/knowledge` routes with the same numbers; no aliases remain (ADR-0036).

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 49 | `GET /datasets/:name/ontology` | List a dataset's ontology (its items plus shared ones; filterable) | yes |
| 50 | `POST /datasets/:name/ontology` | Create a user item in the dataset (or shared) | yes |
| 51 | `PATCH /ontology/:id` | Partial update | yes |
| 52 | `DELETE /ontology/:id` | Delete (204) | yes |
| 53 | `POST /datasets/:name/ontology/bootstrap` | Draft ontology items from the dataset (one shot) | **no** |
| 54 | `POST /datasets/:name/ontology/bootstrap/stream` | Same run, streamed progress (SSE) | yes |

Route order: `/datasets/:name/ontology...` and `/ontology/:id` do not collide with the datasets routes (2.3).

#### 49. `GET /datasets/:name/ontology`
- Query (all optional, lenient: an unrecognised value is dropped, not rejected): `kind` (`concept | relation | constraint | instruction`), `source` (`user | mined`), `enabled` (`true | false`).
- Response `200`: **`OntologyItem[]`** (a bare array, unlike the other list endpoints): the items with `dataset === name` **plus every shared item** (`dataset: null`), `updatedAt` descending.
- Errors: `404 "Dataset \"<name>\" not found"`.

#### 50. `POST /datasets/:name/ontology`
- Body: `{ kind; name: string; description?: string; enabled?: boolean; shared?: boolean }` plus the kind's fields: concept `synonyms?: string[]`, `mappings?: { entity: string; column?: string; expression?: string }[]`; relation `from`, `type`, `to?`, `metricId?`; constraint `predicate`, `conceptId?`, `entities?`; instruction `entities?`. Fields that do not belong to the kind are dropped; strings are trimmed and list items trimmed and de-blanked. `enabled` defaults to `true`; `shared: true` stores `dataset: null`.
- Validation (`400`, messages exact): `"kind must be one of: concept, relation, constraint, instruction"`; `"name is required"`; concept and instruction `"description is required"`; constraint `"predicate is required"`; concept mapping `"each mapping needs an entity"` and, for an item of a dataset, `"Entity \"<entity>\" is not in dataset \"<name>\""` (a shared item accepts any entity); relation `"from is required"`, `"type must be one of: is-a, part-of, has-many, related-to, measured-by"`, `"to is required"` (not for `measured-by`), `"metricId is required for measured-by"`, `"Concept \"<id>\" is not in this ontology"` (a `from`, `to` or constraint `conceptId` that is not a concept of the same dataset or a shared concept) and `"Metric \"<id>\" not found"`. `404 "Dataset \"<name>\" not found"`.
- Response `201`: the created `OntologyItem` (`source:"user"`, `id` generated, timestamps set).

#### 51. `PATCH /ontology/:id`
- Body: any subset of the create fields. **Only fields present on the body are validated and applied**; absent fields are untouched, `updatedAt` is restamped. `kind` cannot change (`400 "kind cannot be changed"` when it differs). A present `synonyms: []`, `mappings: []` or `entities: []` clears them.
- Validation: `400` `"name must not be empty"`, `"description must not be empty"` (concept, instruction), `"predicate must not be empty"` (constraint) and the mapping and relation messages of 50. `404 "Ontology item <id> not found"`.
- Response `200`: the updated `OntologyItem`.

#### 52. `DELETE /ontology/:id`
- Response `204` (empty). `404 "Ontology item <id> not found"`.
- Deleting a concept also deletes the relations whose `from` or `to` is that concept and clears `conceptId` on the constraints that name it.

#### 53. `POST /datasets/:name/ontology/bootstrap`
- No body.
- Response `201`: `{ created: OntologyItem[] }`.
- Errors: `400 "dataset is required"`, `400 "Dataset \"<name>\" not found"`, `400 "Ontology bootstrap failed: <reason>"` (LLM error, malformed output), `400 "Ontology bootstrap failed: the bootstrap agent returned no usable drafts"`. Never a raw 500 by design.
- Not called by the frontend; the streamed variant (54) replaced it for UX (G3).

#### 54. `POST /datasets/:name/ontology/bootstrap/stream`
See [section 3.4](#34-ontology-bootstrap-stream-post-datasetsnameontologybootstrapstream).

Bootstrap semantics shared by 53 and 54: the `knowledge-bootstrap` agent (shown as Ontology Bootstrap) drafts concepts, relations, constraints and instructions from the dataset's stored schema snapshot, sample rows, column references and governed metrics (see [agents.md](agents.md) 2.5); at most 15 drafts are kept; concepts are inserted first, relations resolve against concepts and metrics by name and are dropped when unresolved, mappings to entities outside the dataset are dropped, and a draft is skipped when its name (case-insensitive) already exists for the same kind in the dataset or earlier in the run; survivors are persisted with `dataset: <name>`, `source: "mined"`, **`enabled: false`** for human review.

### 2.8a Personas

Controller prefix `/personas`. Capability: [user-personas](../capabilities/user-personas/spec.md). **Style B throughout** (real status codes, bare bodies). Shape `Persona` in data-model (3.9a): `{ id, name, role, description, goals, typicalQuestions: string[], expertise: "novice"|"intermediate"|"expert", answerStyle, createdAt, updatedAt }`.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 49a | `GET /personas` | List personas sorted by name | yes |
| 49b | `POST /personas` | Create a persona | yes |
| 49c | `PATCH /personas/:id` | Partial update | yes |
| 49d | `DELETE /personas/:id` | Delete (204) | yes |

#### 49a. `GET /personas`
- Response `200`: **`Persona[]`** (a bare array), sorted by `name` ignoring case.

#### 49b. `POST /personas`
- Body: `{ name: string; role?: string; description?: string; goals?: string; typicalQuestions?: string[]; expertise?: "novice"|"intermediate"|"expert"; answerStyle?: string }`. Every string is trimmed.
- Validation `400` (messages exact): `"Name is required"`, `"Name is at most 80 characters"`, `"Role is at most 80 characters"`, `"Description is at most 2,000 characters"`, `"Goals are at most 2,000 characters"`, `"Typical questions must be an array"`, `"At most 10 typical questions"` (blank questions are dropped first), `"A typical question is at most 300 characters"`, `"Expertise must be novice, intermediate or expert"`, `"Answer style is at most 500 characters"`. `expertise` defaults to `intermediate`; omitted strings default to `""` and `typicalQuestions` to `[]`.
- `409 "A persona named \"<name>\" already exists"` when another persona has the name, ignoring case.
- Response `201`: the created `Persona` (`id` generated, timestamps set).

#### 49c. `PATCH /personas/:id`
- Body: any subset of the create fields. **Only fields present on the body are validated and applied**; omitted fields are kept and `updatedAt` is restamped. Same `400` and `409` messages as create (a persona renamed to its own name, in any case, is not a conflict).
- `404 "Persona not found"`.
- Response `200`: the updated `Persona`.

#### 49d. `DELETE /personas/:id`
- Response `204` (empty). `404 "Persona not found"`.

### 2.8b Visuals library

Controller prefix `/visuals`. Capability: [visuals-library](../capabilities/visuals-library/spec.md). **Style B throughout** (real status codes, bare bodies). Shape `VisualChart` in data-model (3.9b): `{ id, name, category, previewKey, rendererForm: string|null, description, whenToUse, whenToAvoid, dataShape, enabled, builtIn, createdAt, updatedAt }`.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 49e | `GET /visuals` | List charts in display order | yes |
| 49f | `POST /visuals` | Create a chart | yes |
| 49g | `PATCH /visuals/:id` | Partial update | yes |
| 49h | `DELETE /visuals/:id` | Delete (204) | yes |

#### 49e. `GET /visuals`
- Response `200`: **`VisualChart[]`** (a bare array): the nine default categories first in the shipped order (Comparison, Change over time, Part-to-whole, Distribution, Relationship, Ranking, Flow, Spatial, Numbers and tables), other categories after them alphabetically ignoring case, and within a category by `name` ignoring case.

#### 49f. `POST /visuals`
- Body: `{ name: string; category: string; previewKey?: string; rendererForm?: string|null; description?: string; whenToUse?: string; whenToAvoid?: string; dataShape?: string; enabled?: boolean }`. Every string is trimmed. `builtIn` is never read from the body: a created chart is `builtIn: false`.
- Validation `400` (messages exact): `"Name is required"`, `"Name is at most 80 characters"`, `"Category is required"`, `"Category is at most 60 characters"`, `"Description is at most 1,000 characters"`, `"When to use is at most 1,000 characters"`, `"When to avoid is at most 1,000 characters"`, `"Data needed is at most 200 characters"`, `"Unknown preview"` (`previewKey` is none of the 30 preview keys or `none`), `"Unknown renderer form"` (not one of `bar`, `line`, `scatter`, `heatmap`, `metric-cards`, `table`, `donut` or null), `"Enabled must be true or false"`. `previewKey` defaults to `none`, `rendererForm` to `null`, omitted strings to `""` and `enabled` to `true`.
- `409 "A chart named \"<name>\" already exists"` when another chart has the name, ignoring case.
- Response `201`: the created `VisualChart` (`id` generated, timestamps set).

#### 49g. `PATCH /visuals/:id`
- Body: any subset of the create fields. **Only fields present on the body are validated and applied**; omitted fields are kept and `updatedAt` is restamped. Same `400` and `409` messages as create (a chart renamed to its own name, in any case, is not a conflict). `builtIn` cannot be changed.
- `404 "Chart not found"`.
- Response `200`: the updated `VisualChart`.

#### 49h. `DELETE /visuals/:id`
- Response `204` (empty). `404 "Chart not found"`.

### 2.8c Monitoring

Controller prefix `/monitoring`. Capability: [monitoring](../capabilities/monitoring/spec.md). Decision: ADR-0038. **Style B throughout** (real status codes, bare bodies). All five routes are read-only and read Mastra's trace store (`observability.duckdb`, data-model 1.2), not an app collection. A data dir with no trace table yet gives an empty page, not an error.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 111 | `GET /monitoring/llm-calls` | List LLM calls, filtered and paged, newest first | yes |
| 112 | `GET /monitoring/llm-calls/:id` | One call with its facts, steps and context window | yes |
| 113 | `GET /monitoring/sessions` | List sessions with recorded agent runs, filtered and paged, most recent first | yes |
| 114 | `GET /monitoring/sessions/:id` | One session with its turns and each turn's trajectory | yes |
| 115 | `GET /monitoring/traces/:traceId` | One turn's spans as a depth-first tree for the waterfall | yes |

#### 111. `GET /monitoring/llm-calls`
- Query (all optional): `page` (whole number >= 1, default 1); `pageSize` (25, 50 or 100, default 25); `agent` (agent id); `model` and `provider` (exact match); `status` (`succeeded`, `failed` or `running`); `session` (session id); `from` and `to` (ISO date-times, inclusive, on the call's start time).
- Order: start time descending, span id as the tie-break.
- Response `200`: `{ items: LlmCallRow[], total: number, page: number, pageSize: number, facets: { agents: { id, name }[], models: string[], providers: string[], sessions: { id, name: string|null, runId?: string }[] } }`. `total` counts every call that matches the filters. The facets come from all calls, not narrowed by the filters, sorted by name.
- Validation `400` (messages exact): `"Page must be a positive whole number"`, `"Page size must be 25, 50 or 100"`, `"Status must be succeeded, failed or running"`, `"From is not a valid date"`, `"To is not a valid date"`.
- `LlmCallRow`: `{ id, traceId, startedAt: ISO, endedAt: ISO|null, durationMs: number|null, agent: { id, name }|null, model, provider, session: { id, name: string|null, runId?: string }|null, inputTokens: number|null, outputTokens: number|null, cacheReadTokens: number|null, cacheWriteTokens: number|null, reasoningTokens: number|null, costUsd: number|null, status: 'succeeded'|'failed'|'running' }`. `id` is the span id of the call's `model_generation`. `inputTokens` includes the cache reads and writes. `session.name` is read from the sessions collection and is `null` when no such session exists (a preview, an eval, a deleted session). A thread `run-<runId>` is a workflow run's host (ADR-0041): its `name` is `<workflow name>: <run title>` read from `workflow_runs` and `runId` is set; a deleted or unknown run has `name: null` and no `runId` (monitoring R45). `costUsd` is `null` when the model has no price.

#### 112. `GET /monitoring/llm-calls/:id`
- Response `200`: `LlmCallDetail` = `LlmCallRow` plus `{ finishReason: string|null, timeToFirstTokenMs: number|null, error: string|null, contextLimit: number|null, contextTokens: number|null, steps: { index, inputTokens: number|null, outputTokens: number|null, finishReason: string|null, durationMs: number|null }[], segments: ContextSegment[] }`.
- `contextTokens` is the input tokens of the run's last step (the largest request), falling back to the call's input tokens. `contextLimit` comes from the price table and is `null` for an unknown model.
- `segments` always holds the seven boxes in this order, empty or not: `{ key: 'system-prompt'|'skills'|'tools'|'chat-history'|'dataset'|'user-prompt'|'tool-results', label, owner: 'US Health'|'Custom', chars, tokens, share: 0..1, items: { title, text }[] }`. How each is built and estimated: [monitoring](../capabilities/monitoring/spec.md) R17–R22.
- `404 "LLM call not found"`.

#### 113. `GET /monitoring/sessions`
- A **session** is a distinct non-null `threadId` on `agent_run` spans (the `threadId` column, falling back to `metadata.threadId`). One trace (`traceId`) is one turn of it ([monitoring](../capabilities/monitoring/spec.md) R27).
- Query (all optional): `page` (whole number >= 1, default 1); `pageSize` (25, 50 or 100, default 25); `agent` (agent id: sessions with a run of that entity id); `from` and `to` (ISO date-times, inclusive: sessions with a turn started in the range).
- Order: `lastAt` descending, session id as the tie-break.
- Response `200`: `{ items: SessionRow[], total: number, page: number, pageSize: number, facets: { agents: { id, name }[] } }`. `total` counts every session that matches. The facets come from all sessions, not narrowed by the filters, sorted by name.
- Validation `400`: the same messages as #111 for `page`, `pageSize`, `from` and `to`.
- `SessionRow`: `{ id: string, name: string|null, runId?: string, agents: { id, name }[], turns: number, firstAt: ISO, lastAt: ISO, wallMs: number|null, modelMs: number|null, toolCalls: number, inputTokens: number|null, outputTokens: number|null, costUsd: number|null, errors: number, status: 'succeeded'|'failed'|'running' }`. `id` is the thread id. `name` is read from the sessions collection and is `null` when no such session exists; for a run host `run-<runId>` it is `<workflow name>: <run title>` and `runId` is set (monitoring R45). `agents` are distinct, by first appearance. `firstAt` and `lastAt` are turn start times. `wallMs` sums the finished turns' `agent_run` durations and `modelMs` sums the `model_generation` durations. `costUsd` sums the priced calls and is `null` when none is priced (monitoring R5). `errors` counts the failed spans: an `agent_run`, `model_generation` or `tool_call` that ended with an error or `success: false`. `status` is `failed` when `errors > 0`, else `running` when a turn has no end row, else `succeeded`.

#### 114. `GET /monitoring/sessions/:id`
- `:id` is the thread id. Response `200`: `SessionDetail` = `SessionRow` plus `turnList: Turn[]` (`turns` stays the count).
- `Turn`: `{ index: number (1-based, by start), traceId, startedAt: ISO, durationMs: number|null, status: 'succeeded'|'failed'|'running', agent: { id, name }|null, question: string|null, answer: string|null, inputTokens: number|null, outputTokens: number|null, costUsd: number|null, modelMs: number|null, toolMs: number|null, error: string|null, steps: TrajectoryStep[] }`. `question` is the last user message (its text parts) of the turn's first `model_generation` input, falling back to the request context's `turn-question`. `answer` is the `output.text` of the last finished `model_step` of the last finished `model_generation` (falling back to that generation's own `output.text`, which joins every step's text), cut to 4,000 characters. A turn may hold more than one `model_generation`; each is a model call and their steps are merged in time order.
- `TrajectoryStep` is `{ kind: 'model', callId, stepIndex, model, durationMs: number|null, inputTokens: number|null, outputTokens: number|null, finishReason: string|null, text: string|null }` (`text`: the step's `output.text`, whitespace collapsed, cut to 200 characters) or `{ kind: 'tools', tools: { name, count, durationMs: number|null, ok: boolean, summary: string|null, rows: number|null }[] }`. `callId` is the `model_generation` span id (the id of #112). The tool calls between two model steps form one `tools` step, grouped by tool name: `count`, summed `durationMs`, `ok` true when all succeeded, `summary` the per-call summaries joined with `", "` up to 160 characters (`entity` for `describe_entity`, the first 80 characters of `sql` on one line for `run_readonly_sql`, otherwise the first string value of the input), `rows` the summed row counts (`rowCount` or `rows` of the output) when known.
- `404 "Session not found"`.

#### 115. `GET /monitoring/traces/:traceId`
- Query: `framework` (`true` or `false`, default `false`): whether framework spans are included.
- Response `200`: `TraceDetail` = `{ traceId, startedAt: ISO, durationMs: number|null, spans: SpanNode[], hiddenFramework: number }`. `hiddenFramework` counts the framework spans left out (0 when `framework=true`).
- `SpanNode`: `{ id, parentId: string|null, depth: number, type: string (the raw span type), kind: 'agent'|'model'|'request'|'tool'|'memory'|'framework'|'other', label: string, startMs: number (offset from the trace start), durationMs: number|null (null while running), status: 'succeeded'|'failed'|'running', callId: string|null (the `model_generation` span id, for model and request spans), details: { label, value }[], input: string|null, output: string|null }`. `spans` are depth first, children by start time. `input` and `output` are pretty JSON or text, each cut to 4,000 characters, and are set for tool calls only.
- Kinds by span type: `agent_run` agent; `model_generation` model; `model_step` request; `tool_call` tool; `memory_operation` memory; `skill_action`, `processor_run`, `workspace_action` and `model_inference` framework; `model_chunk` never listed; any other type `other`. Labels: `agent run · <agent name>`, `model call · <model>`, `request <n>`, the tool name, `memory · <operation>`, the raw name for others. When a framework span is left out its children take its nearest kept ancestor as `parentId` (a response-only change; the store is untouched).
- `404 "Trace not found"`.

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
- **Removed fixture `intellify-api`** (2026-11-12): it is no longer in the catalogue, so `GET /testing-data` does not list it and loading it answers the unknown-fixture error `Unknown sample fixture "intellify-api"`. Other REST-kind fixtures (`world-cup-rest`) stay register-only by script.
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


### 2.12 UI preferences

Controller prefix `/ui-preferences`. Capability: app-shell (R39–R43, R50). One `ui-preferences` settings document per data directory (data-model 3.2.1).

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 56 | `GET /ui-preferences` | Read the theme choice and drawer state | yes |
| 57 | `PUT /ui-preferences` | Save one or both | yes |

```ts
type ThemePreference = 'system' | 'light' | 'dark';
interface UiPreferences { theme: ThemePreference | null; navExpanded: boolean | null }   // null = never chosen
```

#### 56. `GET /ui-preferences`
- Response `200`: `UiPreferences` (bare). Nothing stored: `{ theme:null, navExpanded:null }`; the renderer then uses Light and an expanded drawer. A stored value that is not valid reads as `null`.

#### 57. `PUT /ui-preferences`
- Body: `Partial<{ theme: ThemePreference; navExpanded: boolean }>`. Only the fields sent are changed.
- Validation (Style A): `"theme must be one of: system, light, dark"`, `"navExpanded must be true or false"`.
- Success: `{ ok:true, message:"Preferences saved", preferences: UiPreferences }`.

### 2.16 Intellify RFP API (removed)

Removed 2026-11-12 with the RFP Builder (ADR-0027, superseded): the embedded second Nest application, its 33 routes (`/health`, `/openapi.json`, `/v1/...`), its `X-API-Key` guard, the `INTELLIFY_API*` and `INTELLIFY_DB_*` environment variables, the `<APP_DATA_DIR>/.intellify-api-key` file, the CLI flags `--intellify-api-port` and `--no-intellify-api` and the `intellify-api` npm script no longer exist. A stored datasource or dataset named `Intellify RFP API` is ordinary stored data and is not touched. The section number is not reused.

### 2.17 Data readiness

Controller prefix `/data-readiness`. Capability: [data-readiness](../capabilities/data-readiness/spec.md). Decision: ADR-0031. Shapes: `ReadinessReport` and `readiness_reports` in [data-model.md](data-model.md). **Style B** (1.3): failures are real HTTP statuses with the framework error body.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 108 | `POST /data-readiness/assessments` | Profile a datasource, run the deterministic engine and store the report | no (the agent's tool runs it through the bridge) |
| 109 | `GET /data-readiness/assessments` | List a datasource's stored reports, newest first | yes (Past assessments) |
| 110 | `GET /data-readiness/assessments/:id` | Read one stored report | yes (scorecard) |

#### 108. `POST /data-readiness/assessments`
- Body: `{ datasourceId: string; entities?: string[]; sessionId?: string; runId?: string }`.
  - `entities` are entity keys (`catalog.schema.table` on Databricks, `database.schema.table` on PostgreSQL, as in the inventory, #20) and narrow the scope. Left out, the scope is every entity in the datasource's inventory. Keys that no longer exist are dropped.
  - `sessionId` is recorded on the report when the assessment comes from a chat, `runId` when it comes from a workflow run; the readiness bridge sends one or the other, never both.
- Runs synchronously: profile (connector profiling queries, 15 s per statement), engine with `now` = the request time, store.
- Response `201`: `ReadinessReport` ([data-model.md](data-model.md)). It carries `notProfiled?: { entity, reason: "too-large"|"timed-out", rowCount? }[]` for entities whose column checks were skipped (ADR-0033); absent when none.
- Errors:
  - 400 `"datasourceId is required"`;
  - 400 `"Data readiness supports PostgreSQL and Databricks datasources only"` (a `rest` datasource);
  - 400 `"entities must be an array of entity keys"` when `entities` is present (and not null) but is not an array of strings;
  - 400 `"None of the entities to assess exist"`, also for a whole-datasource assessment of a datasource with no entity;
  - 404 `"Datasource \"<id>\" not found"`;
  - 502 with the connector's message when the datasource cannot be reached at all. A single failing profiling statement is not an error: that statistic is left out (data-readiness R6).

#### 109. `GET /data-readiness/assessments`
- Query: `datasourceId` (required).
- Response `200`: `{ reports: ReadinessReportSummary[] }`, newest `generatedAt` first, where `ReadinessReportSummary = { id, datasourceId, datasourceName, datasourceKind, generatedAt, overallScore, maturity, entityCount, sessionId?, runId? }`. An unknown or report-less datasource gives `{ reports: [] }`.
- Errors: 400 `"datasourceId is required"`.

#### 110. `GET /data-readiness/assessments/:id`
- Response `200`: the full `ReadinessReport`.
- Errors: 404 `"Readiness report \"<id>\" not found"`.

### 2.18 Synthetic data

Controller prefix `/synthetic-data`. Capability: [synthetic-data](../capabilities/synthetic-data/spec.md). Decision: ADR-0039. Shapes: `SampledProfile` and its parts are in the capability's Contracts; nothing is stored (profiles live in memory only). **Style B** (1.3): failures are real HTTP statuses with the framework error body. No endpoint streams events: 111 is a synchronous POST (the UI shows a spinner) and 112 to 114 write their response themselves as file attachments.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 111 | `POST /synthetic-data/profiles` | Sample a dataset's tables and return the sampled profile (kept 60 min in memory) | yes (Profile & synthesize tab) |
| 112 | `POST /synthetic-data/scripts` | Generate the synthetic copy from a profile as a `.sql` script, a CSV zip or an Excel workbook (streamed attachment) | yes (Generate) |
| 113 | `POST /synthetic-data/profile-exports` | Export the profile as CSV or Excel | yes (Export profile) |
| 114 | `POST /synthetic-data/sample-exports` | Export the real sampled rows, re-read, as `.sql`, CSV or Excel; refused without `confirmRealData: true` | yes (Export sample rows) |

#### 111. `POST /synthetic-data/profiles`
- Body: `{ datasetName: string; tables?: string[]; sampleSize?: number }`.
  - `tables` are entity keys of the dataset. Left out or empty, it means every table of the dataset.
  - `sampleSize` is 1–1000, default 1000.
- Runs synchronously: reads the dataset, samples each table (up to `sampleSize` rows, native sampling, 15 s per statement), builds the profile from the rows, drops the rows and keeps the profile in memory for 60 minutes (at most 20 profiles).
- When the client disconnects (the UI's Cancel, or navigating away) the request's `close` event aborts the sampling run.
- Response `201`: `SampledProfile`.
- Errors (Style B), the first that applies:
  - 400 `datasetName is required`
  - 404 `Dataset "<name>" not found`
  - 400 `Dataset "<name>" has no datasource`
  - 400 `Profiling a sample supports PostgreSQL and Databricks datasets only`
  - 400 `tables must be an array of entity keys`
  - 400 `"<key>" is not a table of dataset "<name>"`
  - 400 `Choose at most 50 tables`
  - 400 `sampleSize must be a whole number from 1 to 1,000`
  - 404 `Datasource "<id>" not found`
  - 502 with the connector's message, when the datasource cannot be reached at all (the table list fails)
  - A single table that cannot be sampled is **not** an error: it gets `error` and `sampledRows: 0`.

#### 112. `POST /synthetic-data/scripts`
- Body: `ScriptRequest` (capability Contracts): `{ profileId, rowCounts?, defaultRowCount?, seed?, targetSchema?, includeConstraints?, format? }`. `format` is `sql` (default), `csv` or `xlsx`.
- Generates the synthetic copy from the cached profile and **streams it as an attachment**: every input is validated before the headers are written. The same profile and request give the same bytes apart from the header's `generated on` line.
- Response `200`:
  - `format` `sql`: `Content-Type: application/sql; charset=utf-8`; `Content-Disposition: attachment; filename="<dataset-slug>-synthetic-<dialect>-seed<seed>.sql"` (the slug as in 14, the dialect `postgresql` or `databricks`); `X-Script-Sha256: <hex>`, the SHA-256 of the script without the `generated on` and hash header lines; `X-Script-Rows: <total>`. A Databricks profile gets a Databricks SQL script.
  - `format` `csv`: `Content-Type: application/zip`; `filename="<dataset-slug>-synthetic-seed<seed>-csv.zip"`; one `<target table name>.csv` per table plus `README.txt`; `X-Export-Rows: <total>`.
  - `format` `xlsx`: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; `filename="<dataset-slug>-synthetic-seed<seed>.xlsx"`; one sheet per table plus `About`; `X-Export-Rows: <total>`.
  - CSV and Excel do not depend on the dialect, so they work for a Databricks profile.
- Errors (Style B), the first that applies:
  - 400 `profileId is required`
  - 404 `Profile "<id>" expired or not found: profile the tables again`
  - 400 `format must be sql, csv or xlsx`
  - 400 `Row counts must be whole numbers from 1 to 10,000` (also for `defaultRowCount`); a `rowCounts` key that is not in the profile gives 400 `"<key>" is not a table of this profile`
  - 400 `A script holds at most 200,000 rows`
  - 400 `seed must be a whole number from 0 to 2147483647`
  - 400 `targetSchema must be a plain identifier (letters, digits, underscores)`; for a Databricks profile `targetSchema must be schema or catalog.schema (letters, digits, underscores)`

#### 113. `POST /synthetic-data/profile-exports`
- Body: `{ profileId: string; format: 'csv' | 'xlsx' }`.
- Exports exactly what the profile view shows, from the cached profile (no datasource access, no sampled value beyond the categorical top values). Response `200`:
  - `csv`: `Content-Type: text/csv; charset=utf-8`; `filename="<dataset-slug>-profile.csv"`; one row per column of every table: table, method, sampledRows, rowCountEstimate, column, type, kind, strategy, nullPct, distinct, range or length, top values joined by ` | `, patterns joined by ` | `.
  - `xlsx`: the spreadsheet type of 112; `filename="<dataset-slug>-profile.xlsx"`; sheets `Tables` and `Columns`.
- Errors (Style B), the first that applies:
  - 400 `profileId is required`
  - 404 `Profile "<id>" expired or not found: profile the tables again`
  - 400 `format must be csv or xlsx`

#### 114. `POST /synthetic-data/sample-exports`
- Body: `{ profileId: string; format: 'sql' | 'csv' | 'xlsx'; targetSchema?: string; confirmRealData: true }`. `targetSchema` defaults to `sample`.
- **Exports real rows.** It re-reads the profile's tables (the same keys, `sampleSize` and `REPEATABLE (7)`) through the sampler and the pooled read-only sessions and streams them to the response; the rows are never logged, cached, written to a session file or sent to a model, and the cache keeps statistics only. A table that has changed, or a `limit` read, can give other rows than the ones profiled, and the README says so. A table that fails is written with zero rows and its error in the README. When the client disconnects the sampling run is aborted.
- Response `200`, an attachment: `sql` with `Content-Type: application/sql; charset=utf-8` and `filename="<dataset-slug>-sample-<dialect>.sql"` (the dialect writer of 112, values typed by semantic type, an unparseable value written as a string literal); `csv` with `application/zip` and `filename="<dataset-slug>-sample-csv.zip"`; `xlsx` with the spreadsheet type and `filename="<dataset-slug>-sample.xlsx"`. `X-Export-Rows: <total>` is set.
- Errors (Style B), the first that applies:
  - 400 `profileId is required`
  - 404 `Profile "<id>" expired or not found: profile the tables again`
  - 400 `confirmRealData must be true: this export contains real rows`
  - 400 `format must be sql, csv or xlsx`
  - 400 `targetSchema must be a plain identifier (letters, digits, underscores)`; for a Databricks profile `targetSchema must be schema or catalog.schema (letters, digits, underscores)`

### 2.19 Health

Controller prefix `/health`. Capability: [app-shell](../capabilities/app-shell/spec.md). No authentication (ADR-0030).

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 135 | `GET /health` | The cheap readiness probe | no (the Electron main process) |

#### 135. `GET /health`
- Response `200`: `{ ok: true }`. It reads no store and takes no query, so it answers as soon as the backend listens. When the desktop shell set `BACKEND_INSTANCE_ID`, the response carries `X-Backend-Instance` like every other response (set by a global middleware), and the probe accepts it only when the value matches the spawned child. It is the desktop readiness probe (4.3) since 1.23.22; before, the probe was `GET /sessions` (1), which returns every session with its transcript.
- Errors: none.

## 3. Streaming and long-running work

Three Server-Sent-Events endpoints exist (chat, workflow runs, ontology bootstrap). Both are POST, so they are read with `fetch` + `response.body.getReader()` and a `TextDecoder`, **not** `EventSource`. One background-job pattern uses start + poll instead of SSE (eval runs).

### 3.1 Chat stream (removed in 1.23.27)

`POST /sessions/:id/messages/stream` was removed in 1.23.27. The framing, request fields that survive (`careful`) and event types below are those a run streams on `POST /workflows/:id/runs/stream` (3.6), kept here as the reference they cite.

**Request.** `Content-Type: application/json`

```ts
interface StreamMessageRequest {
  content: string;                 // required, trimmed, non-empty
  activeVisualizationId?: string;  // visual open in the right panel (so update_visual targets it); ignored unless a string
  careful?: boolean;               // only `true` enables careful mode (cross-check before `done`)
}
```

**Response headers.** `Content-Type: text/event-stream; charset=utf-8` (the charset is explicit so every client decodes `…` and other non-ASCII text as UTF-8; without it Chromium's network layer falls back to Windows-1252), `Cache-Control: no-cache`, `Connection: keep-alive`; headers are flushed immediately, so the HTTP status is **always 200** once the handler runs. Consequently *every* failure, including an unknown session or an empty message, arrives as an in-stream `error` event, not as a 4xx.

**Framing.** Each event is a single `data: <JSON>\n\n` frame. No `event:` or `id:` fields, no `retry:`, no heartbeat/comment frames. Readers split on `\n\n`, take the line starting with `data: ` and `JSON.parse` it; malformed frames are skipped.

**Event envelope.** `{ type, content?, session? }`. `content` is a string; for `tool`, `tool-result`, `visual-updated`, `panel-item`, `workflow`, `readiness-report` and `tool-progress` it is itself **a JSON-encoded string** (double encoding) that the client parses.

| `type` | Payload | Meaning |
|---|---|---|
| `reasoning` | `content: string` (delta) | Model reasoning text delta, for a live "thinking" display. Not persisted. Empty deltas are not emitted. |
| `text` | `content: string` (delta) | Answer text delta. Concatenation of all `text` deltas is the streamed answer. One extra full-text `text` event may follow if a tool-only turn needed a synthesis pass. |
| `tool` | `content: JSON string` `{ name: string; rationale?: string; input?: string }` | A tool call started. `rationale` is the assistant's plain-language reason (flattened, max 400 chars) and is sent **with the call**, before the result. `input` says what the call is about, flattened and clipped to 200 characters: for the framework's skill tools the skill it loads (`skill`: its `name`; `skill_read`: `<skillName>/<path>`; `skill_search`: the query), else the call's first text argument; omitted when there is none. Legacy clients may receive a bare tool name instead of JSON; readers must fall back to treating non-JSON content as the name. Not emitted for `ask_clarification`. |
| `tool-result` | `content: JSON string` | A tool call finished. For data tools (`run_readonly_sql`, `sample_rows`): `{ tool, input?, rowCount?, error?, rationale? }`. For visual tools (`create_visual`, `update_visual`): `{ tool, input? /* the instruction */, error? }`. **No `tool-result` is emitted for other tools** (`list_entities`, `describe_entity`). Row data is not streamed, only persisted in the final message. |
| `tool-progress` | `content: JSON string` `{ tool: string, phase: "inventory"\|"profiling"\|"relationships"\|"scoring"\|"storing", message: string, done?: number, total?: number, entity?: string }` | Live progress of a running tool (ADR-0033). Zero or more between a tool's `tool` event and its `tool-result`. Only `assess_data_readiness` emits it today. Not persisted. It doubles as a keepalive while the tool runs. The client shows the latest `message` on the tool's row ([ui.md](ui.md) 4.12). |
| `visual-updated` | `content: JSON string` `VisualEvent` `{ visualId, version, title, action: "created"\|"updated" }` | A visual tool produced a visual this turn; sent just before that tool's `tool-result`. The panel refreshes live. |
| `panel-item` | `content: JSON string` `PanelItemEvent` `{ item: PanelItem }` ([data-model.md](data-model.md) 3.4.4) | An agent showed something in the right panel this turn (`show_in_panel` returned without an error); never sent for a workflow change (`update_workflow`); sent just before that tool's `tool-result` `{ tool: "show_in_panel", input? /* the item's title */, error? }`. The client refreshes the session without disturbing the turn, makes the item the active one and opens the panel; for a `visual` item it also loads the visual. Every agent ([agent-panel](../capabilities/agent-panel/spec.md) R12). `visual-updated` stays for visual tools. |
| `workflow` | `content: JSON string` `WorkflowView` `{ phases: { number, title, skill? }[], source: "prompt"\|"agent"\|"workflow", current: number\|null, done: number[], skipped: number[], waiting?: boolean, note?: string, failed?: number }` ([data-model.md](data-model.md) 3.4.4) | The session's workflow changed this turn: after an `update_workflow` result without an error, and on a Questions to Insights v2 turn after each step of its workflow starts, ends or fails ([agents.md](agents.md) 5.11; these stand alone, between the turn's other events). `show_in_panel` never sends it. It carries the whole view, not a delta. It never creates a panel item and does not open the right panel. The client patches the session's `workflow` live, so the workflow bar moves while the turn streams; the persisted view arrives with `done` ([agent-panel](../capabilities/agent-panel/spec.md) R19). Every agent. |
| `readiness-report` | `content: JSON string` `ReadinessReportEvent` `{ report: ReadinessReport, panelItem: PanelItem }` ([data-model.md](data-model.md)) | `assess_data_readiness` or `get_readiness_report` returned a report this turn; sent just before that tool's `tool-result`. The client shows the scorecard in the right panel (the `panelItem`, kind `readiness`, is also persisted on the session as `show_in_panel` items are). The answer persisted at the end of the turn carries `readinessReport` (data-model 3.4.1), and the chat shows the readiness card. Data Readiness Agent sessions only ([data-readiness](../capabilities/data-readiness/spec.md) R5). |
| `done` | `session: SessionDoc` | **Terminal, success.** The persisted session with this turn's messages. |
| `error` | `content: string` | **Terminal, failure.** Human-readable message (`"message is required"`, `"Session <id> not found"`, provider/model errors). |

**Ordering.**

```
[reasoning* | text* | (tool → tool-progress* → [visual-updated | panel-item | workflow] → tool-result)*]  interleaved in model order
 → (optional silent post-processing)
 → done            or            error
```

- `tool` always precedes its own `tool-result`; parallel/interleaved calls are possible. `tool-progress` events fall between a tool's `tool` and its `tool-result`. `visual-updated`, `panel-item` and `workflow` precede the matching `tool-result`.
- After the model stream ends there can be **silent server-side steps with no events**: a tool-disabled synthesis pass (only if the turn produced no text and no visual; emits one `text` event with the result, or falls back to the fixed message `"I completed the data analysis but could not produce a final response. Please retry your question."`), the **zero-SQL grounding guard** (one corrective pass when a non-empty answer called no tool at all), the verified-query match, and the **careful-mode cross-check** (`crossCheck` verdict). No keepalive is sent during them. (While a tool runs, `tool-progress` events, where the tool emits them, act as a keepalive.)
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

### 3.2 Deep analysis (removed 2026-11-12)

Removed with ADR-0042: no deep analysis job, poll or workflow exists. Section number kept so the numbering of the sections below stays stable.

### 3.3 Eval runs

Pattern: **start, poll, list, download, delete**. Endpoints 36-40.

- One running run per agent (`conflictWith` surfaced as `ok:false` + `jobId`).
- A run executes the selected questions sequentially against the datasets bound to the datasource. After every question the finished result is appended to `results` and the record is persisted (a crash mid-suite keeps finished questions). `currentQuestion` names the question in flight.
- Observed by polling `GET /agents/:key/evals/runs/:jobId` (the shipped UI polls every **1500 ms** until `status !== "running"`); the run history (`…/runs`) reads persisted records with live in-memory state overlaid for in-flight runs. Persisted runs survive restart; an interrupted run is not resumed and its stored `status` may stay `running` (G4).
- On completion the run is compared with the most recent previous completed run for the same agent, datasource and datasets, and `comparison` (regressions, improvements, unchanged by case id) is attached; a comparison failure never fails the run.
- Cannot delete a run while it is `running`.

### 3.4 Ontology bootstrap stream: `POST /datasets/:name/ontology/bootstrap/stream`

**Request.** No body; the dataset is the `:name` path segment. Same headers and framing as 3.1 (`data: <JSON>\n\n`, HTTP 200 once started; even `dataset is required` or `Dataset "<name>" not found` arrives as an `error` event).

| `type` | Payload | Meaning |
|---|---|---|
| `progress` | `{ type:"progress", key: "dataset"\|"schema"\|"sample"\|"draft"\|"save", message: string }` | A stage started. Messages: `Opening dataset “<name>”`, `Reading schema — <n> table(s)`, `Sampling rows — <done> of <total> table(s)` (repeats as tables complete), `Drafting concepts, relations, constraints and instructions`, `Saving <n> draft(s) for review`. |
| `done` | `{ type:"done", created: OntologyItem[] }` | **Terminal, success.** Persisted drafts (disabled, `source:"mined"`). May be empty. |
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
| `POST /llm/models` | Synchronous; 15 s timeout (custom endpoint or Copilot runtime). |
| `GET /llm/copilot/status` | Synchronous; the first call starts the local Copilot runtime (a few seconds). |

### 3.6 Workflow run stream: `POST /workflows/:id/runs/stream`

**Request.** As 118: `{ input, context?: { fromRunId } }`. Every refusal (118's list) is answered with its real status before the stream starts, unlike the chat stream.

**Response headers and framing.** As 3.1: `text/event-stream; charset=utf-8`, flushed at once; one `data: <JSON>\n\n` frame per event.

**Events, in order.**

| `type` | Payload (beside `type`) | Meaning |
|---|---|---|
| `run` | `runId: string`, `workflowId: string` | First frame: the run started. |
| `step` | `WorkflowRunStep`: `id`, `title`, `status: 'running' \| 'success' \| 'failed' \| 'skipped' \| 'stopped'`, `input?`, `inputTruncated?: true`, `output?`, `outputTruncated?: true`, `error?`, `startedAt?`, `endedAt?`, `toolCalls?` (below) | A step of the workflow started (`running`) or ended. A started step carries what it received (`input`, the engine's step-start `payload.payload`; `inputTruncated` instead when it is larger than 20 000 JSON characters) and `startedAt`; an ended one keeps them and adds `endedAt`. `success` carries the step's output (`outputTruncated` instead when it is larger than 20 000 JSON characters); `failed` its error; an agent step fed by an agent turn carries its `toolCalls` so far; `stopped` a step that ended the run early (an agent step stopped by the user or ended on a clarifying question; v2's Analyse after a stop). When the run ends, a step that never started is sent as `skipped`, and one still running as `stopped` (the run stopped) or `failed` (the run failed). Every step event of the run is sent, whatever the workflow's `bar`. |
| `reasoning`, `text`, `tool`, `tool-result`, `tool-progress`, `visual-updated`, `panel-item`, `workflow`, `readiness-report` | as 3.1 (`content`) | Agent workflows: the agent turn's events, unchanged, interleaved with the `step` events. 3.1's `done { session }` is never sent. |
| `done` | `run: WorkflowRun` | **Terminal, success** (also for a code-only run whose step failed, and for a turn that ended on a clarifying question). |
| `error` | `content: string` | **Terminal, failure** of an agent turn: the chat stream's message for the same failure (a custom endpoint's R50 text, a provider error, `No API key configured…`). |

```ts
type WorkflowRun = {
  id: string;                      // the run id; the host is `run-<id>`, the workspace `session-run-<id>`
  workflowId: string;
  workflowName: string;            // the workflow's name when the run started
  contractHash?: string;           // 117's contractHash when the run started; absent on runs stored before 2026-11-13 and on draft runs (R12)
  input: Record<string, string | number | boolean | string[]>;   // the checked input (defaults filled)
  context?: { fromRunId: string };
  status: 'running' | 'success' | 'failed' | 'stopped';   // 'running' only while it runs (121); done.run is never 'running'
  steps: WorkflowRunStep[];        // status 'success' | 'failed' | 'skipped' | 'stopped' once the run ended
  output?: Record<string, unknown>;   // success: the last step's output (Wrap up's for v2)
  error?: string;                  // failed
  // Questions to Insights v2 runs only:
  question?: string;               // the user message the agent received (`question`), trimmed
  answer?: ChatMessage;            // the assistant message the turn persisted on the host (data-model 3.4.1); absent when it stopped or failed before answering
  datasets: string[];              // the host's datasets 
  agentKey?: string; agentId?: string; agentName?: string;
  agent?: SessionAgentRef;         // as a session's (2.1)
  panelItems?: PanelItem[];        // as a session's derived list (2.1)
  visualizations?: SessionVisualization[];
  workflowState?: WorkflowState;
  workflow?: WorkflowView;         // as a session's derived view (2.1)
  ownerId?: 'local';               // legacy and inert (data-model 3.14)
  startedAt: string;
  finishedAt?: string;
  createdAt: string;               // store-maintained (data-model 3.16)
  updatedAt: string;
};

type WorkflowRunStep = {
  id: string;
  title: string;
  status: 'running' | 'success' | 'failed' | 'skipped' | 'stopped';
  input?: Record<string, unknown>;   // what the step received (the engine's step-start `payload.payload`), when its JSON is at most 20 000 characters
  inputTruncated?: true;             // instead of `input` when it is larger
  output?: Record<string, unknown>;  // at most 20 000 JSON characters
  outputTruncated?: true;
  error?: string;                    // failed; a contract violation reads `Contract violation in <title>[ (input)]: <path> <message>` (below)
  startedAt?: string;                // ISO; absent for a skipped step
  endedAt?: string;                  // ISO; absent while running and for a skipped step
  toolCalls?: WorkflowRunToolCall[]; // agent steps fed by an agent turn: their calls in order, at most 50; absent when none
};

type WorkflowRunToolCall = {
  tool: string;
  input?: string;       // the `tool-result` input (the SQL), else the `tool` event's (3.1); at most 2 000 characters
  rowCount?: number;    // from the `tool-result`
  error?: string;       // from the `tool-result`
  durationMs?: number;  // from the `tool` event to its `tool-result`; absent when no result came
};
```

`panelItems`, `workflow` and `agent` are derived on every read (121) and never stored; the stored run is [data-model.md](data-model.md) 3.16. Runs stored before the step `input`, times and `toolCalls` existed lack them. A step's tool calls come from the turn's `tool` and `tool-result` events: each call belongs to the agent step running when its `tool` event arrives, and a result ends the first unfinished call of the same tool; a result without a call is kept as a call with no `durationMs`. A deep analysis's agent steps have no `toolCalls` (their calls are not turn events).

**Contract violations** ([agents.md](agents.md) 5.12; workflows R26). A step whose input or output breaks its declared schema (117's `inputSchema` / `outputSchema`) fails with the error `Contract violation in <Step title>: <path> <message>` for its output and `Contract violation in <Step title> (input): <path> <message>` for its input, checked before it runs. `<path>` is always one word: the first failing field, dotted with indices (`calls[2].rowCount`), or `(root)` when the whole value is wrong; `<message>` is Zod 4's (`Invalid input: expected number, received string`). Only the first problem is named. The failing step's `step` event is `failed` with that `error`, the later steps are `skipped`, the run is stored `failed` with the same `error`, and the stream ends with `error { content }` carrying it. Example: `Contract violation in Analyse: calls[2].rowCount Invalid input: expected number, received string`; `Contract violation in Receive question (input): datasets Invalid input: expected array, received string`; `Contract violation in Analyse: (root) Invalid input: expected object, received string`.

**Stop.** The client aborts the fetch; the server aborts the agent turn (a readiness assessment is cancelled, ADR-0033) and sends nothing more, as 3.1. The run is stored as `stopped`, with the partial answer the host persisted, if any.

**Context.** `context.fromRunId` names a stored run, so it survives a restart; its `question` and `answer.content` go before this run's question as a `user` and an `assistant` message ([agents.md](agents.md) 5.14).

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
| Spawn | Electron's own binary with `ELECTRON_RUN_AS_NODE=1` running `backend/dist/main.js` (packaged: `<resources>/backend/dist/main.js`); `stdio` piped; env passes `PORT`, `APP_DATA_DIR`, `APP_SECRET`, `DESKTOP_PARENT_PID` (the main process's PID) and `BACKEND_INSTANCE_ID` (a fresh random UUID per spawn), and nothing else. The child's PID is written to `<APP_DATA_DIR>/backend.pid` ([data-model.md](data-model.md) 1.2) and the file is removed when that child exits or is killed. Missing entry file records an error diagnostic and does not start. |
| Readiness probe | `GET http://127.0.0.1:<BACKEND_PORT>/health` (135), **ready iff status 200 and the `X-Backend-Instance` response header equals the `BACKEND_INSTANCE_ID` of the child just spawned**; 500 ms request timeout; retried every 100 ms until a **30 s** deadline. A 200 without the matching header means another process holds the port: the probe keeps failing and one error diagnostic per spawn is recorded (`Port <port> is answered by another process, not this app's backend`). |
| Stale backend | Before the first spawn, a PID read from `<APP_DATA_DIR>/backend.pid` is checked: if that process is alive and its image name is the main process's executable name (`tasklist` on Windows, `ps` elsewhere), it is killed, waited for (up to 5 s) and a warning diagnostic `Stopped a backend left running by an earlier launch` is recorded; the file is then removed. A dead PID, a different image or an unreadable file only removes the file. |
| Orphan exit | A backend started with `DESKTOP_PARENT_PID` checks every 2 s whether that process is still alive (`process.kill(pid, 0)`; `EPERM` counts as alive) and exits with code 0 once it is gone. |
| Single instance | The main process takes Electron's single-instance lock (keyed by `userData`) before anything else starts. A second launch with the same profile exits at once; the first instance restores and focuses its window (or opens one if none is open). |
| Startup | status `starting` → spawn → probe. Ready → `ready`. Deadline missed → error diagnostic, **window opens anyway**, probing continues in the background and pushes `ready` when it succeeds. |
| Crash handling | Any exit not caused by app quit → status `restarting`, restart after back-off **1 s, 2 s, 4 s** (3 attempts), re-probing after each start. Attempts exhausted → status `down` (error diagnostic, no further restarts). |
| Stability reset | Backend continuously ready for **60 s** resets the attempt counter. |
| Requested restart | `backend:restart` (4.2): kill and immediate respawn, outside the crash back-off. |
| Quit | `before-quit` sets a quitting flag (suppresses restarts), kills the backend and removes `backend.pid`. On non-macOS the app quits when all windows close. |
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
| `--host` | string | `127.0.0.1` | Interface to bind. `--host 0.0.0.0` opens the app to every machine that can reach the port, with full access and no sign-in (1.9, G14). |
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

The CLI banner no longer prints an `Intellify API:` line, and the flags `--intellify-api-port` and `--no-intellify-api` (removed 2026-11-12) are unknown flags like any other.

**Browser opening.** Best effort, detached, errors ignored: `open <url>` (macOS), `cmd /c start "" <url>` (Windows), `xdg-open <url>` (other).

**Shutdown.** `SIGINT`/`SIGTERM` close the app and exit 0; a second signal is ignored; a forced `exit(0)` follows after 5 s if close hangs.

**Exit codes.** `0` = normal run, `--help`, `--version`, clean shutdown. `1` = argument errors, invalid or busy explicit port, or any uncaught startup error (stack printed to stderr).

---

## 6. Environment variables

### 6.1 Backend (server process)

| Variable | Read in | Meaning | Default |
|---|---|---|---|
| `PORT` | `main.ts` (Electron-spawned/standalone start) | Listen port. The Electron main process sets it from `BACKEND_PORT`. Ignored by the CLI (which uses `--port`). | `3000` |
| `APP_DATA_DIR` | database module, Mastra storage; set by CLI and Electron main | Directory for `app.sqlite`, `mastra.sqlite`, `observability.duckdb` and `workspaces/`. | database: `<cwd>/data`; Mastra storage: `<INIT_CWD or PWD or cwd>/data` |
| `APP_SECRET` | crypto service; set by CLI and Electron main | Key material for encrypting API keys at rest (SHA-256 to an AES-256-GCM key). Missing: the crypto service reads `<APP_DATA_DIR>/.app-secret`, or generates it (32 random bytes hex, mode 0600) and logs where. Must stay stable across launches. | `<APP_DATA_DIR>/.app-secret` |
| `DESKTOP_PARENT_PID` | `main.ts` (set by Electron main only) | PID of the desktop main process; the backend exits once it is gone (4.3 Orphan exit). Unset or not a positive integer: no watch. | unset |
| `BACKEND_INSTANCE_ID` | `main.ts` (set by Electron main only) | Sent back on every response as `X-Backend-Instance`, so the readiness probe can tell its own backend from another server on the port (4.3). Unset: no header. | unset |
| `WEB_ROOT` | `app-bootstrap.ts` | Directory holding the built web UI (`index.html`). | `<package>/public` |
| `INIT_CWD`, `PWD` | Mastra storage | Launch directory used to place the fallback `data/` folder (Studio changes `cwd`). | process cwd |
| `VISUAL_MODEL` | visual designer agent | Forces the designer model (router id `provider/model`). Unset: reasoning-family models are swapped for `openai/gpt-4.1-mini` and `nano` models upgraded to their `mini` sibling; others kept. | unset |
| `OPENAI_API_KEY` | Mastra's env-bound model router (via model resolver) | Fallback model credential (`openai/gpt-4o-mini`) when no LLM settings are saved. | unset |
| `WORLD_CUP_DB_PORT` | testing-data fixture registry | Port of the sample PostgreSQL server in the form prefill and compose stack. | `55432` |
| `EVAL_DATASETS` | `mastra/evals/run-assistant-evals.ts` (CLI eval script only) | Comma-separated dataset names to run the assistant evals against. Required by that script. | none |
| `EVAL_SET` | `mastra/evals/run-assistant-evals.ts` (CLI eval script only) | The question set to run (`world-cup`, `world-cup-rest`, `formula-1`). That script needs this or `EVAL_CASES`, not both ([agents.md](agents.md) 8.5). | none |
| `EVAL_CASES` | `mastra/evals/run-assistant-evals.ts` (CLI eval script only) | Comma-separated eval case ids to run instead of a whole set; all from one set's fixture. | none |
| `EVAL_LLM_PROVIDER`, `EVAL_LLM_API_STYLE`, `EVAL_LLM_BASE_URL`, `EVAL_LLM_API_KEY`, `EVAL_LLM_MODEL` | `mastra/evals/run-assistant-evals.ts` (CLI eval script only) | `EVAL_LLM_PROVIDER=custom` runs the evals on a custom endpoint instead of the saved LLM settings: API style (`openai` \| `anthropic`), base URL and model required, key optional ([agents.md](agents.md) 8.5). | unset (saved settings) |

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
- **G3. `POST /datasets/:name/ontology/bootstrap` is unused** (superseded by the streamed variant); it shares the service call.
- **G4. Eval run recovery.** In-flight run state lives in memory with write-through persistence per question. Open question: what status a run left `running` by a crash shows after restart (no reconciliation code was found).
- **G5. Frontend type drift.** The frontend `EvalRunView` omits `comparison` (present on the wire, only used in the Markdown report). The frontend `getEvalRun` result is a loose merge type.
- **G6. No cascade.** Deleting a datasource leaves datasets pointing at it; deleting a dataset deletes its own ontology items but leaves sessions that name it. Behaviour of such dangling references is not specified in the API.
- **G7. `POST /sessions` does not verify the named datasets exist.** Open question whether that is intended.
- **G8. Error-style inconsistency.** Style A (`200 { ok:false }`) vs Style B (real 4xx) is endpoint-specific and also differs in list shapes (`{ sessions }`, `{ datasources }`, `{ metrics }`, `{ datasets }`, bare array for ontology, bare `SessionDoc`). Several read endpoints (`GET /datasources`, eval-run listing) can still return a framework 500.
- **G9. Request body size.** No explicit JSON body limit is configured, so the framework default (about 100 kB) applies; large dataset snapshots in `POST /datasets` could exceed it. Not verified against a real large dataset.
- **G10. Desktop backend bind address.** `main.ts` calls `createApp` without a host, so the Electron-spawned backend listens on **all interfaces** with CORS enabled and no authentication (G14); only the CLI binds `127.0.0.1` by default. Kept by the user's choice (ADR-0030).
- **G11. `message` timing on feedback.** `POST …/messages/feedback` with `up` reports `"Answer saved as a verified query"` even when the answer had no SQL and nothing was saved.
- **G12. Spec of `PUT /metrics/:id` not-found** is thrown as a 400-class exception but surfaced inside the `ok:false` envelope, so clients cannot distinguish "not found" from validation by status.
- **G13. Dev-mode API routing.** For `ng serve` the client uses relative URLs and the repo has no Angular proxy config, so API calls from a bare `ng serve` page hit the dev server, not the backend. Under `electron:dev` the window loads `http://localhost:4200` (protocol `http:`), so the same relative-URL problem applies. Open question: how the live-reload dev flow reaches the backend (no proxy or `API_BASE_URL` override found).
- **G14. No authentication, so reachability is the only boundary.** Anyone who can reach the backend has full access as the super admin, including the stored LLM key's use (the key itself is never returned) and the developer settings. The desktop backend listens on all interfaces (G10) and `--host 0.0.0.0` does the same for the CLI ([non-functional.md](../product/non-functional.md) section 3, ADR-0030).
- **Not an HTTP surface:** verified queries (saved via feedback), the Mastra Studio, and the workspace filesystem have no endpoints of their own.

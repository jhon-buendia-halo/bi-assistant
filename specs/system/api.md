# API contract

The complete contract between the renderer (or any HTTP client) and the backend, plus the desktop IPC bridge, the CLI and the environment. Persisted document shapes (session, dataset, datasource, metric, ontology item, verified query, LLM settings, eval run) live in [data-model.md](data-model.md); this file links to them and only restates a shape where the wire format differs from the stored one.

Contents: [1 Conventions](#1-conventions) · [2 Endpoints](#2-endpoints) · [3 Streaming and long-running work](#3-streaming-and-long-running-work) · [4 Desktop bridge (IPC)](#4-desktop-bridge-ipc) · [5 CLI contract](#5-cli-contract) · [6 Environment variables](#6-environment-variables) · [7 Gaps and open questions](#7-gaps-and-open-questions)

Endpoint total: **93 HTTP route handlers** across 15 app controllers (sessions 17, deep analysis 3, agents 17, skills 9, datasources 6, ontology 6, personas 4, visuals 4, monitoring 5, metrics 5, llm 6, datasets 3, developer settings 3, testing data 3, UI preferences 2), plus the 33 routes of the embedded Intellify RFP API (2.16). Verified queries have **no** HTTP surface (they are created and removed as a side effect of message feedback, and read by the metrics promotion path).

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

**Style B, framework exceptions, real HTTP status.** Endpoints that do not catch let the framework answer. Used by: `GET /sessions/:id`, the visual `GET` endpoints, `GET /agents/:key`, the eval-run download, the deep-analysis download, the whole ontology and personas controllers, and the data-readiness and synthetic-data controllers.

```ts
interface HttpErrorBody { statusCode: number; message: string | string[]; error: string }   // NestJS default
```

| Status | When |
|---|---|
| 400 Bad Request | Validation failure thrown by a service (`BadRequestException`): missing/empty field, bad enum value, unknown version. |
| 404 Not Found | Unknown session/agent/ontology item/visual/report, or an unmatched route (`Cannot GET /x`). |
| 408 Request Timeout | A visual generation exceeded 120 s (`RequestTimeoutException`). Under Style A this surfaces as `ok:false`. |
| 500 Internal Server Error | Any unhandled error (framework default body `{ statusCode: 500, message: "Internal server error" }`). |

Clients read the error text from `error.message` (Style B) or `body.message` with `body.ok === false` (Style A). Two endpoints mix the styles: `GET /sessions/:id/deep-analysis/:jobId` and `GET /agents/:key/evals/runs/:jobId` report "not found" as Style A (`200 { ok:false }`).

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

The one exception is the Intellify RFP API (2.16), a separate NestJS application that keeps its own `X-API-Key` guard (ADR-0027).

---

## 2. Endpoints

Legend for **FE**: whether the shipped frontend calls it. Document types referenced (`SessionDoc`, `ChatMessage`, `SessionVisualization`, `DatasetDoc`, `MetricDoc`, `OntologyItem`, `DatasourceView`, `CatalogInfo`, `LlmSettingsView`, `EvalRunView`) are defined in [data-model.md](data-model.md) and the shared ones in [section 2.10](#210-shared-wire-shapes).

### 2.1 Sessions

Controller prefix `/sessions`. Capability: sessions-chat, visuals, agent-panel, rfp, workflows.

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
| 105 | `GET /sessions/:id/rfp-packages/:rfpId/download` | Download an RFP package (zip) or one of its files | yes |
| 106 | `GET /sessions/:id/panel-items/:itemId/file` | Read the text of a file panel item | yes |
| 107 | `GET /sessions/:id/panel-items/:itemId/download` | Download a file, document or table panel item | yes |

The session on the wire (endpoints 1-3, and the `done` event of 5) is the stored `SessionDoc` (data-model 3.4), or a preview session (endpoint 3), plus two derived fields of the right panel ([agent-panel](../capabilities/agent-panel/spec.md), never stored as such): `panelItems: PanelItem[]` (always present, newest shown last as stored; the stored items, without any of the retired kind `phases`, plus a synthesized `visual:<id>` item for every visual without one, [data-model.md](data-model.md) 3.4.4) and `workflow?: WorkflowView` (present when the session's agent is workflow-backed (`assistant-v2`, [agents.md](agents.md) 5.11), its prompt has a `## Workflow` section or the agent has defined its own steps with `update_workflow`; the extended view of [data-model.md](data-model.md) 3.4.4: `source`, `skipped`, `waiting?`, `note?`, `failed?` besides the phases and the saved progress; the `done` event carries it too), plus, for a session with an `agentId`, a derived `agent: { id: string; name: string; deleted: boolean; description: string; starterQuestions: string[] }`. While the agent exists, `name`, `description` and `starterQuestions` come from its Live version and `deleted` is `false`. Once it is deleted, `name` is the stored `agentName`, `deleted` is `true`, and `description` and `starterQuestions` are empty (sessions-chat R57-R59). For a preview session, `name`, `description` and `starterQuestions` come from the agent's **draft**, read at each request. For a session with an `agentKey` (bound to a built-in agent, ADR-0028), `agent` is `{ id: <agentKey>, name: <the registered agent's name>, deleted: false, description: <its description>, starterQuestions: <its built-in starters> }`; for `rfp` the starters are `Start an RFP for a client`, `Which of my clients renew on 1 January 2027?` and `Resume my draft RFPs` ([rfp](../capabilities/rfp/spec.md)). It is computed on every read, never stored.

Every session on the wire also carries an always-present, derived `workflowRef: { id: string; name: string; kind: 'code' | 'agent'; deleted: boolean }`: the workflow the session runs ([workflows](../capabilities/workflows/spec.md) R4; [agents.md](agents.md) 5.12). `id` is the stored `workflowId` while it resolves, else the id derived from `agentKey` / `agentId` (data-model 3.4). `name` is the workflow's catalogue name (116): `Assistant` for `agent:assistant`, `Questions to Insights v2` for `qti-v2-turn`, the registered agent's name for `agent:rfp` and `agent:data-readiness`; for a user agent's workflow the agent's Live name, for a preview the draft's name, and once the agent is deleted the stored `agentName` with `deleted: true` (`deleted` is `false` otherwise). `kind` is `code` for a code-defined workflow, else `agent`. It is computed on every read, never stored. The `agent` and `workflow` fields above are unchanged: `workflow` is the workflow bar's view, not this reference.

Preview sessions answer endpoints 2 and 4 to 14 like any session (a turn runs with the draft, sessions-chat R54) but are never in endpoint 1's list. Endpoint 4 on a preview discards it (memory thread and workspace included) and answers `{ ok:true, message:"Preview discarded" }`.

#### 1. `GET /sessions`
- Response `200`: `{ sessions: SessionDoc[] }`. Ordering is the repository's (most recently updated first; see data-model). No pagination; full documents including messages are returned.
- Errors: none expected.
- Also used by the Electron main process as the **backend readiness probe** (must return 200).

#### 2. `GET /sessions/:id`
- Response `200`: `SessionDoc` (bare, not enveloped), with `panelItems` and `workflow` as above.
- Errors: `404 "Session <id> not found"` (Style B).

#### 3. `POST /sessions`
- Body: `{ name: string; datasets: string[] }`, `{ agentId: string }` or `{ workflowId: string; name?: string; datasets?: string[] }`. `name` required (trimmed, non-empty, **truncated to 64 chars**); `datasets` must be a non-empty array of dataset **names**.
- With `agentId` (a user-agent id; sessions-chat R52): `datasets` in the body is ignored, and `name` is optional: a non-blank `name` (trimmed, truncated to 64 chars; sent by the New conversation screen's Agent picker) names the session, else it takes the agent's Live name. The session takes those of its Live datasets that exist, and stores `agentId` and `agentName` (data-model 3.4).
- With `agentId` set to the registry key of a built-in agent that declares a dataset (today only `rfp`, whose dataset is `Intellify RFP API`; ADR-0028): `datasets` in the body is ignored and an optional non-blank `name` works as above. The session takes the typed name, else the agent's name (`RFP Builder`), and that dataset, and stores `agentKey` (the registry key) and `agentName` instead of `agentId` (data-model 3.4); every turn then runs that agent. When the dataset doesn't exist the call fails with the agent's requirement text, for `rfp` `"Load the \"Intellify RFP API\" sample in Settings → Testing Data first"`. A built-in key that declares no dataset and takes none from the user (e.g. `assistant`) still fails with `"Agent \"<key>\" not found"`.
- With `agentId` set to `assistant-v2` (Questions to Insights v2; agents.md 2.11, ADR-0028 as amended by BA-320): like the assistant's composer, the agent has no dataset of its own, so `name` and `datasets` are **required and validated exactly as without `agentId`** (`"session name is required"`, `"select at least one dataset"`). The session takes the typed name (trimmed, truncated to 64 chars) and those datasets, and stores `agentKey: "assistant-v2"` and `agentName: "Questions to Insights v2"` instead of `agentId` (data-model 3.4); every turn then runs that agent. A preview (`preview: true`) of this key fails like any built-in key, with `"Agent \"assistant-v2\" not found"`.
- With `agentId` set to `data-readiness` (agents.md 2.10): `datasets` in the body is ignored and an optional non-blank `name` works as above. The session takes the typed name, else `Data Readiness`, and every dataset bound to a `postgres` or `databricks` datasource, ordered by name, and stores `agentKey` and `agentName`. With no such dataset the call fails with `"Add a PostgreSQL or Databricks dataset first"`.
- With `{ agentId, preview: true }` (agents-evals R60, R61): starts a **preview session** of the agent's draft. It is held in memory only (data-model 3.12), never listed and never written to the `sessions` collection. Its `id` is `preview-<uuid>`, its `name` `Preview: <draft name>`, its `datasets` those of the draft that exist, and it carries `preview: true` and `agentId`. Its derived `agent` comes from the draft. Success message `Preview started`. Failures: `"Agent \"<id>\" not found"` (also for a built-in key), `"Select at least one dataset to preview"`.
- With `workflowId` (a workflow of 116; [workflows](../capabilities/workflows/spec.md), ADR-0040): with a workflow that picks datasets (`agent:assistant`, `qti-v2-turn`), `name` and `datasets` are **required and validated exactly as without `agentId`** (`"session name is required"`, `"select at least one dataset"`). With any other workflow, `datasets` is ignored and `name` is optional, as with `agentId`. Resolution: `agent:assistant` creates a plain session; `qti-v2-turn` creates it as `agentId: "assistant-v2"` does; `agent:<key|id>` creates it as `agentId: <key|id>` does, with the same refusals (the built-in agent's requirement text, `"None of this agent's datasets exist"`). An unknown id, a draft-only or missing user agent's id, or the id of a System agent or of a code workflow's own agent (`agent:assistant-v2`) fails with `"Workflow \"<id>\" not found"`. A run workflow (`seq-text-demo`, `trigger: 'run'` in 116) can't start a chat: `"Workflow \"<id>\" can't start a chat"`, creating nothing. `workflowId` together with `agentId` fails with `"Send workflowId or agentId, not both"`. With `workflowId`, `preview` is ignored.
- **Every** session created by this endpoint (any body form, previews included) stores `workflowId`: the id its agent fields derive ([data-model.md](data-model.md) 3.4). `agentId` bodies keep working unchanged.
- Success: `{ ok:true, message:"Session \"<name>\" created", session: SessionDoc }` with `messages: []`, `visualizations: []`, a generated UUID `id`, and a contained Mastra workspace created and linked (`workspaceId`).
- Failures (Style A): `"session name is required"`, `"select at least one dataset"`. With `agentId`: `"Agent \"<id>\" not found"` (unknown id, or the key of a built-in agent that declares no dataset), the built-in agent's requirement text (its dataset is missing), `"Publish \"<name>\" before starting a chat"` (no Live version), `"None of this agent's datasets exist"`. With `workflowId`: `"Workflow \"<id>\" not found"`, `"Workflow \"<id>\" can't start a chat"` (a run workflow), `"Send workflowId or agentId, not both"`, and the texts above.
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

#### 105. `GET /sessions/:id/rfp-packages/:rfpId/download`
- Query: `draft` (optional, `true`): serve the draft package stored by `export_rfp_draft` under `rfp/<rfpId>/draft/` instead of the final one (the zip is then named `rfp-<slug>-draft.zip`, and `file` names are relative to the draft folder). `file` (optional), the name of one file of the package as listed in the answer's `rfpPackage.files` (e.g. `rfp.md`, `rfp.pdf`, `exhibits/exhibit-a-census.csv`, `manifest.json`). Without it the whole package downloads.
- Response `200`: without `file`, `application/zip` of the session workspace folder `rfp/<rfpId>/` (`rfp/<rfpId>/draft/` with `draft=true`; [data-model.md](data-model.md) 4.1), `Content-Disposition: attachment; filename="rfp-<slug>.zip"` (slug of the package title, as in #14, fallback `rfp-<first 8 of rfpId>`); with `file`, that file with its content type (`text/markdown`, `application/pdf`, `text/csv`, `application/json`) and `Content-Disposition: attachment; filename="<base name>"`.
- The files are the ones `export_rfp_package` (or, with `draft=true`, `export_rfp_draft`) stored in the workspace ([agents.md](agents.md) 3.10); the route never calls the Intellify RFP API.
- Errors (Style B): `404 "Session <id> not found"`; `404 "RFP package \"<rfpId>\" not found"` (nothing exported for that RFP in this session; with `draft=true`, no draft); `404 "RFP package \"<rfpId>\" has no file \"<file>\""`; `400 "Invalid file name \"<file>\""` for an absolute or `..` path. Capability: [rfp](../capabilities/rfp/spec.md).

#### 106. `GET /sessions/:id/panel-items/:itemId/file`
- Response `200`: `{ item: FilePanelItem, contentType: string, text: string }`: the stored item ([data-model.md](data-model.md) 3.4.4) and the file's text as it is now in the session workspace (at most 256 KB), with the content type of its extension (`.md` `text/markdown`, `.csv` `text/csv`, `.json` `application/json`, others `text/plain`). The panel's file view reads it when the item is opened.
- The path is resolved under the session workspace with the same safe-path check as the tool (no absolute or `..` path, no symbolic link, text extensions only; [agents.md](agents.md) 3.11).
- Errors (Style B): `404 "Session <id> not found"`; `404 "Panel item \"<itemId>\" not found"`; `400 "Panel item \"<itemId>\" is not a file"`; `404 "File \"<path>\" not found in the session workspace"`; `400 "File \"<path>\" is larger than 256 KB"`. Capability: [agent-panel](../capabilities/agent-panel/spec.md).

#### 107. `GET /sessions/:id/panel-items/:itemId/download`
- Query: `format` (optional): `pdf` or `md` for a `document` item or a `file` item whose path ends in `.md`, `csv` for a `table` item; absent means the defaults below. `format=pdf` renders the Markdown as PDF (`application/pdf`; filename `<slug>.pdf` for a document, the file's base name with `.pdf` in place of `.md` for a file), with the same renderer as the RFP package document (2.16.5, I31), the item's title as the PDF title.
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

Controller prefix `/agents`. Capability: agents-evals. `:key` is the Mastra registry key (`assistant`, `rfp`, `visualization`, `sql-fixer`, `sql-verifier`, `knowledge-bootstrap`, `assistant-eval-judge`, `assistant-v2`, `data-readiness`; see [agents.md](agents.md)) **or** the id of a user agent ([data-model.md](data-model.md) section 3.10); the registry is checked first. `:id` is always a user-agent id. The catalogue merges both kinds. Rules: R43-R52, R97-R104 and R106 in [agents-evals](../capabilities/agents-evals/spec.md). The user-agent routes are declared before `GET /agents/:key`.

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
- `AgentSummary = { key, id, name, description, tools: string[] /* sorted tool names; a user agent shows those its effective configuration selects (agents.md 2.1) */, kind: 'official'|'system'|'user', status: 'builtin'|'draft'|'live', pinned: boolean, owner: 'Official'|'System'|'You', hasUnpublishedChanges: boolean, missingDatasets: string[], datasets: string[], starterQuestions: string[], chatRequirement?: string }`.
- For a user agent `key` equals `id`, and `name`, `description`, `datasets`, `starterQuestions` and `tools` come from the Live version when there is one, else the draft. For a built-in agent `status` is `builtin`, `hasUnpublishedChanges` is `false` and `datasets`, `starterQuestions` and `missingDatasets` are empty, except for a built-in agent that declares a dataset for its sessions (today `rfp`; ADR-0028): its `datasets` is `["Intellify RFP API"]`, `missingDatasets` lists it while no dataset of that name exists, and `chatRequirement` is then `Load the "Intellify RFP API" sample in Settings → Testing Data first` (the UI shows it as the reason Start chat is blocked). The four former showcase agents (`benchmarking`, `survey`, `lad-coe`, `strategy`) were removed in 1.23.8: they are not in the registry, so `GET /agents` does not list them and `GET /agents/benchmarking` answers `Agent "benchmarking" not found`; a pin or prompt override saved for one of those keys is ignored. `chatRequirement` is absent otherwise. The **Data Readiness Agent** (`data-readiness`; [agents.md](agents.md) 2.10) declares a dataset *kind* instead of a name: its `datasets` lists the names of every dataset bound to a `postgres` or `databricks` datasource, its `missingDatasets` is empty, its `starterQuestions` are its three starters (data-readiness R2), and while no such dataset exists `chatRequirement` is `Add a PostgreSQL or Databricks dataset first`. The **Questions to Insights v2** agent (`assistant-v2`; [agents.md](agents.md) 2.11) has no dataset of its own, like the `assistant`: no `chatRequirement`, empty `datasets`, `missingDatasets` and `starterQuestions`. `kind` is `official` for `assistant`, `assistant-v2`, `rfp` and `data-readiness`, and `system` for the other built-in agents.

#### 34. `GET /agents/:key`
- Response `200`: `AgentDetail = AgentSummary & { draft?: AgentConfig; live?: AgentConfig /* user agents only; shapes in data-model 3.10 */; instructions: string /* prompt flattened to text */; toolDetails: { name, description, inputs: string[] /* top-level input param names */ }[]; memory: { storage: string|null; lastMessages: number|false|null; semanticRecall: boolean; workingMemory: boolean; generateTitle: boolean } | null; model: { id: string; provider: string } | null /* null when no LLM settings saved */; toolLinks?: { name: string; status: 'always-on'|'linked'|'not-linked'; linkedVia: { instructions: boolean; skills: string[] /* skill names, sorted */ } }[] /* user agents only: every library tool sorted by name, from the Live version, else the draft */; llm: { provider: string | null; providerName: string | null; model: string | null; apiKeyConfigured: boolean; maxOutputTokens: number | null; reasoningEffort: string | null } /* the effective LLM settings the agent resolves to; never the key; every field null/false when no LLM is saved */; prompt?: { editable: string /* as served: the override, else the shipped text */; shipped: string; modified: boolean; builtInChanged: boolean /* modified and the shipped text's hash differs from baseHash */; linksAllowed: boolean /* true for assistant, assistant-v2, rfp and data-readiness only; false for the System agents */; updatedAt: string | null /* the override's */ } /* built-in agents only */; workflow?: AgentWorkflow /* workflow-backed built-in agents only (today assistant-v2) */; usedInWorkflows: { id: string; name: string }[] /* always present */ }`.
- `usedInWorkflows` lists the workflows whose steps call the agent, in catalogue order (116; [agents.md](agents.md) 5.12): `assistant` → `[{ id: 'agent:assistant', name: 'Assistant' }]`, `assistant-v2` → `[{ id: 'qti-v2-turn', name: 'Questions to Insights v2' }]`, `rfp` → `[{ id: 'agent:rfp', name: 'RFP Builder' }]`, `data-readiness` → `[{ id: 'agent:data-readiness', name: 'Data Readiness Agent' }]`, a Live user agent → `[{ id: 'agent:<id>', name: <its Live name> }]`; a draft-only user agent and the System agents → `[]`.
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
- Response `200`: `{ sets: AgentEvalSet[] }`: the sets whose agent is `:key` (a set's `agentKey`, default `assistant`; [agents.md](agents.md) 8.1). Only `assistant` and `rfp` have sets; any other key returns `{ sets: [] }` (no 404). `AgentEvalSet = { id, name, description, cases: { id, question, intent, checks: { id, name, description }[] }[] }`.

#### 36. `POST /agents/:key/evals/run`
- Body: `{ datasourceId: string; caseIds?: string[] }`. `caseIds` omitted = all questions.
- Success: `{ ok:true, message:"Eval run started", jobId }`. Returns immediately; the run is long-running (see [3.3](#33-eval-runs)).
- Failures (Style A, `ok:false`): `"Agent \"<key>\" has no evals to run"` (an agent with no sets: neither `assistant` nor `rfp`); `"An eval run is already in progress for this agent"` (also returns the running `jobId`); `"Pick a datasource to run against"`; `"That datasource has no datasets — create one in Datasets before running evals"`; `"Pick at least one question to run"`; fixture/dataset coverage errors (the datasets bound to the datasource must expose the entities the selected questions need).
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
- Response `200`: `{ skills: BuiltInSkillSummary[] }` sorted by name. `BuiltInSkillSummary = { name, description /* as served */, loading: 'on-demand' | 'harness', agents: string[] /* registry keys, agents.md 7.4 */, tools?: string[] /* the tools the served body links as [[tool:<name>]], in order of first appearance; left out when it links none (the RFP Builder's stage skills link theirs) */, modified: boolean, builtInChanged: boolean /* modified and the shipped built-in's hash differs from baseHash */, updatedAt: string | null /* the override's */ }`.

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
- Body: `{ prompt: string }`, trimmed; the checks below run on the trimmed text. Saves the override (ADR-0026); it applies to the next call of every session, user agent, deep analysis, visual and eval run.
- Success: `{ ok:true, message:"System prompt of \"<name>\" saved", agent: AgentDetail }`.
- Failures (Style A), the first that applies: `"Agent \"<key>\" not found"`; `"Only built-in agents have a shared system prompt; edit a user agent's instructions instead"` (`:key` is a user-agent id); `"The prompt is empty"`; `"The prompt is at most 20,000 characters"`; for the `assistant` only: `"The assistant's prompt must start with \"You are the Questions to Insights assistant\""`, `"Only built-in skills can be linked here: this prompt is shared by every user"` (a `[[skill:<name>]]` whose name is not a built-in on-demand skill; a built-in one is accepted), `"Unknown tool \"<name>\""` (a `[[tool:…]]` not in the library, as in 41); for the `rfp` (RFP Builder) only (agents.md 2.8): `"The RFP Builder's prompt must start with \"You are the RFP Builder\""`, `"Only the RFP Builder's own skills can be linked here: this prompt is shared by every user"` (a `[[skill:<name>]]` that is not one of its own on-demand skills, its seven stage skills of agents.md 7.4), `"Unknown tool \"<name>\""` (a `[[tool:…]]` that is not one of its own tools: its RFP tools and `ask_clarification`); for the `data-readiness` agent only (agents.md 2.10): `"The Data Readiness Agent's prompt must start with \"You are the Data Readiness Agent\""`, `"Only the Data Readiness Agent's own skills can be linked here: this prompt is shared by every user"` (any `[[skill:…]]` other than `data-readiness`), `"Unknown tool \"<name>\""` (a `[[tool:…]]` that is not one of its tools: `assess_data_readiness`, `get_readiness_report`, `list_readiness_reports`, `show_in_panel`, `ask_clarification`); for the `assistant-v2` agent only (agents.md 2.11): `"The Questions to Insights v2 prompt must start with \"You are Questions to Insights v2\""`, `"Skills can't be linked here: Questions to Insights v2 has no skills"` (any `[[skill:…]]`), `"Unknown tool \"<name>\""` (a `[[tool:…]]` that is not one of its tools: `list_entities`, `describe_entity`, `run_readonly_sql`); for a System agent only: `"This agent's prompt can't contain links"` (any `[[…]]`).
- Declared before the `GET /agents/:key` catch-alls.

#### 104. `DELETE /agents/:key/prompt`
- Success: `{ ok:true, message:"System prompt of \"<name>\" reset", agent: AgentDetail }`, also when there was no override.
- Failures (Style A): `"Agent \"<key>\" not found"`; the user-agent refusal of 103.

### 2.6.2 Workflows

Controller prefix `/workflows`. Capability: [workflows](../capabilities/workflows/spec.md) (R1-R4, R11, R14-R18). Workflows are defined in code (ADR-0040), and there is no write route. A workflow with input fields can be run once (118) or run streamed (119) (ADR-0041); every run is stored (since 1.23.14, [data-model.md](data-model.md) 3.16) and read back through section 2.6.3. `:id` is a workflow id (`qti-v2-turn`, `seq-text-demo`, `agent:<registry key>`, `agent:<user-agent id>`; [agents.md](agents.md) 5.12). Ids contain `:`; clients send them URL-encoded (`agent%3Arfp`) and the server decodes them.

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
    id: string;                       // 'qti-v2-turn' | 'seq-text-demo' | 'agent:<registry key>' | 'agent:<user-agent id>'
    name: string;
    description: string;
    kind: 'code' | 'agent';           // code-defined, or the one-step workflow of an agent
    owner: 'Official' | 'You';        // 'You' for a user agent's workflow
    agents: { key: string; name: string }[];   // the agents its steps call, in step order, each once
    stepCount: number;
    bar: 'steps' | 'agent';           // what drives a chat's workflow bar: these steps, or the agent's own phases
    trigger: 'chat' | 'run';          // runs in a chat, or once on a typed input (118, 119); the agent workflows stay 'chat' until 1.23.22 and also run on their input
    input: WorkflowInputField[];      // the typed input a run takes, in form order (every workflow has one since 1.23.12)
    picksDatasets: boolean;           // the session takes the datasets the user picks (Assistant, Questions to Insights v2)
    datasets: string[];               // the datasets a session would take; [] when picksDatasets
    missingDatasets: string[];        // named datasets that don't exist (as AgentSummary.missingDatasets)
    starterQuestions: string[];       // the agent's, as AgentSummary.starterQuestions
    chatRequirement?: string;         // why a chat can't start now; absent when it can
    runRequirement?: string;          // why a run can't start now (the same text as chatRequirement); absent when it can
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
    hidden?: boolean;                 // set by the app (the RFP Builder's Continue), never rendered as a control
  };
  ```
- Values:

  | id | name | kind | agents | stepCount | bar | picksDatasets | datasets / requirement |
  |---|---|---|---|---|---|---|---|
  | `agent:assistant` | `Assistant` | agent | `assistant` (Questions to Insights Assistant) | 1 | agent | true | none |
  | `qti-v2-turn` | `Questions to Insights v2` | code | `assistant-v2` | 4 | steps | true | none |
  | `seq-text-demo` | `Sequential test workflow` | code | none (`[]`) | 3 | steps | false | none |
  | `agent:data-readiness` | `Data Readiness Agent` | agent | `data-readiness` | 1 | agent | false | as its AgentSummary (`Add a PostgreSQL or Databricks dataset first`) |
  | `agent:rfp` | `RFP Builder` | agent | `rfp` | 1 | agent | false | as its AgentSummary (`Load the "Intellify RFP API" sample in Settings → Testing Data first`) |
  | `agent:<id>` (each Live user agent) | its Live name | agent | the user agent (`key` = id, `name` = Live name) | 1 | agent | false | its Live datasets that exist; `chatRequirement` `None of this agent's datasets exist` when none do |

- Description, starter questions and missing datasets come from the agent's catalogue entry (33). The two exceptions are the Assistant's description, `Answers questions over the datasets you pick.`, and v2's starter questions, which are empty, as in its AgentSummary.
- **Trigger and input:** `seq-text-demo` is the one run workflow: `trigger: 'run'`, `input: [{ name: 'text', label: 'Text', type: 'textarea', required: true, placeholder: 'Paste or type any text' }]`, description `A three-step example: cleans a text, counts its words and characters, and formats the result. No LLM.`, owner `Official`, no datasets, missing datasets or starter questions. Every other workflow has `trigger: 'chat'` until 1.23.22, and since 1.23.12 also an `input` it runs on (118, 119; [workflows](../capabilities/workflows/spec.md) R14):

  | id | `input` (in order) |
  |---|---|
  | `agent:assistant` | `question` (`Question`, textarea, required, placeholder `Ask a question about your data`); `datasets` (`Datasets`, datasets, required); `careful` (`Careful: cross-check the result with an independent query`, boolean, `default: false`) |
  | `qti-v2-turn` | `question` (as the Assistant's); `datasets` (as the Assistant's) |
  | `agent:data-readiness` | `dataset` (`Dataset`, dataset, required, `datasourceKinds: ['postgres', 'databricks']`); `question` (`Question`, textarea, optional, placeholder and `default` `Assess the readiness of this dataset`) |
  | `agent:rfp` | `message` (`Message`, textarea, required, placeholder `Name the client and plan year, or state your decision`); `rfpId` (`RFP`, text, optional, `hidden: true`) |
  | `agent:<id>` (user agent) | `question` (as the Assistant's); `careful` (as the Assistant's). Its datasets are the agent's Live datasets that exist (`datasets`), not an input. |

- **Run requirement:** `runRequirement` is set exactly when `chatRequirement` is, with the same text (the RFP Builder's, the Data Readiness Agent's, a user agent's `None of this agent's datasets exist`). While it is set, 118 and 119 refuse the run with it.
- **Order:** `agent:assistant`, `qti-v2-turn`, `seq-text-demo`, then the other Official workflows by name, then the user agents' workflows by name. System agents and draft-only user agents are never listed.

#### 117. `GET /workflows/:id`
- Response `200`: `WorkflowDetail = WorkflowSummary & { steps: AgentWorkflow['steps'] }`, with `AgentWorkflow` exactly as 34 defines it. A `WorkflowDetail` is structurally an `AgentWorkflow` (it has `id` and `steps`).
- For `qti-v2-turn`, `steps` equals `agentWorkflow('assistant-v2').steps`, the `workflow` of 34. For `seq-text-demo`, `steps` are its three code steps (`clean-text`, `count-words`, `format-result`; [agents.md](agents.md) 5.13), none with an `agent`. A one-step workflow has one step, `answer` (`Answer`, kind `agent`, summary `The agent answers with its tools, streamed to the chat.`, input `question`, `datasets`, output `calls`, `stopped`, exits `Model error` fails and `Stop` stops, plus `Clarifying question` stops when the agent's tools include `ask_clarification`), whose `agent` is `{ name: <the agent's name>, tools: <its AgentSummary.tools>, maxSteps }`: `maxSteps` is 15 for `assistant`, `rfp` and user agents, 10 for `data-readiness`.
- Errors (Style B): `404 "Workflow \"<id>\" not found"` for any id 116 does not list: unknown, a draft-only user agent, a System agent (`agent:sql-fixer`), or a code workflow's own agent (`agent:assistant-v2`).

#### 118. `POST /workflows/:id/runs`
- Body: `{ input: Record<string, string | number | boolean | string[]>, context?: { fromRunId: string } }`. Runs the workflow once on `input` and answers when the run ends (no streaming). Capability: [workflows](../capabilities/workflows/spec.md) R11, R14; engine: [agents.md](agents.md) 5.13, 5.14. The UI uses 119.
- Response `200` for a code-only workflow (`seq-text-demo`): `WorkflowRunResult & { runId: string }`, whether the run succeeded or a step failed (the run happened); `runId` is the stored run's id (121). For a workflow whose steps call an agent: the `WorkflowRun` 119 ends with (`done.run`), whatever its status.
  ```ts
  type WorkflowRunResult = {
    workflowId: string;
    status: 'success' | 'failed';
    steps: {                          // every step of the workflow, in its order
      id: string;
      title: string;
      status: 'success' | 'failed' | 'skipped';
      output?: Record<string, unknown>;   // a successful step's output
      error?: string;                     // a failed step's error
    }[];
    output?: Record<string, unknown>; // the run's final output (success only)
    error?: string;                   // the failing step's error (failed only)
  };
  ```
- A failing step makes the run `failed`, with its error as the run's `error`; the steps after it are `skipped`. For `seq-text-demo` with `{ text: '  Hello   workflow   world  ' }`: `success`, three `success` steps and `output: { summary: '3 words, 20 characters: "Hello workflow world"' }`; with `{ text: '   ' }`: `failed`, `clean-text` failed with `The text is empty`, the other two `skipped`, `error: 'The text is empty'`.
- Input: only the workflow's declared fields are read, in field order; a number field's value is converted to a number; a `datasets` value is a list of names, trimmed, without repeats; any other key is ignored. A whitespace-only text is accepted (the run decides what it means; an agent run refuses a blank question). A field that is missing or empty takes its `default` (a boolean `false`); an optional one without a default is left out.
- Errors (Style B, 400), checked before anything runs, the first one winning: `"Workflow \"<id>\" can't run on an input"` for a workflow with no input fields; the workflow's `runRequirement`; `"<label> is required"` for a required field that is missing or `""` (`"Text is required"`, `"Question is required"`, `"Dataset is required"`), and for an agent run whose question or message is blank; `"Select at least one dataset"` for a required `datasets` field with none; `"<label> must be a number"`; `"<label> must be true or false"`; `"Dataset \"<name>\" not found"`; `"Dataset \"<name>\" is not a <kinds> dataset"` (the field's `datasourceKinds` named, e.g. `PostgreSQL or Databricks`); `"Run \"<id>\" not found"` for a `context.fromRunId` that names no stored run, and `"Run \"<id>\" has no answer to continue from"` for a stored run without a question and answer. `404 "Workflow \"<id>\" not found"` for any id 116 does not list.
- Side effects: the run is stored in `workflow_runs` ([data-model.md](data-model.md) 3.16) as `running` before it starts and updated when it ends, with its steps, output or error; an engine failure is stored as `failed` and answered as the error it is. A code-only run writes no workflow bar, persists no engine snapshot and has no workspace. An agent run is 119's, without the stream.

#### 119. `POST /workflows/:id/runs/stream`
- Body: as 118. Runs the workflow once on `input`, streamed. Any workflow with input fields: a code-only one streams its step events; an agent workflow runs one agent turn on a run host through the chat turn path ([agents.md](agents.md) 5.14), so its model request equals a chat turn's for the same input. Capability: [workflows](../capabilities/workflows/spec.md) R14-R17.
- Refusals: 118's, answered with their real status (Style B) **before** the stream starts; nothing runs.
- Response `200`, SSE (section 3.6).
- Side effects: the run is stored in `workflow_runs` ([data-model.md](data-model.md) 3.16) as `running` before the `run` event is sent, and updated when it ends (`success`, `failed` or `stopped`, a stop included); a run that throws while it ends is stored `failed` with that error. An agent run creates the run host `run-<run id>` (in memory, never listed) and its workspace `workspaces/session-run-<run id>/` (a session workspace's layout, [data-model.md](data-model.md) 4.1); after the turn the host's memory thread is deleted and the host leaves memory. The workspace stays with the stored run, so its files download through 123-127, until the run is deleted (122).

### 2.6.3 Workflow runs

Controller prefix `/workflow-runs`. Capability: [workflows](../capabilities/workflows/spec.md) (R18-R20) and [visuals](../capabilities/visuals/spec.md) (129-133). The stored runs of 118 and 119 ([data-model.md](data-model.md) 3.16): the history, one run, its deletion, and the files of its workspace. The file routes are served by the same services as a session's (9, 14, 105-107), given the run's **run-backed host**: a `SessionDoc` shaped from the stored run (id `run-<id>`, workspace `session-run-<id>`, its agent binding, `rfpId`, panel items, visuals, and its question and answer as the transcript), never held or listed. `:id` is a run id (a uuid). Style B throughout.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 120 | `GET /workflow-runs` | The run history, newest first | no |
| 121 | `GET /workflow-runs/:id` | One stored run | yes |
| 122 | `DELETE /workflow-runs/:id` | Delete a run with its workspace | no |
| 123 | `GET /workflow-runs/:id/visualizations/:vid` | Load a run's visual (document + metadata) | no |
| 124 | `GET /workflow-runs/:id/visualizations/:vid/download` | A run's visual as a zip | no |
| 125 | `GET /workflow-runs/:id/panel-items/:itemId/file` | Read the text of a run's file panel item | yes |
| 126 | `GET /workflow-runs/:id/panel-items/:itemId/download` | Download a run's file, document or table panel item | yes |
| 127 | `GET /workflow-runs/:id/rfp-packages/:rfpId/download` | Download a run's RFP package (zip) or one of its files | yes |
| 128 | `POST /workflow-runs/:id/answer/feedback` | Thumbs up/down on a run's answer | yes |
| 129 | `POST /workflow-runs/:id/visualizations` | Generate a visual from the run's answer | yes |
| 130 | `POST /workflow-runs/:id/visualizations/:vid/tailor` | Tailor a run's visual from an instruction | yes |
| 131 | `POST /workflow-runs/:id/visualizations/:vid/revert` | Move a run's visual to an earlier version | yes |
| 132 | `POST /workflow-runs/:id/visualizations/:vid/refresh` | Re-run the SQL behind a run's visual | yes |
| 133 | `POST /workflow-runs/:id/visualizations/:vid/repair` | Repair a run's failing visual once | yes |

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
- Side effects: for an agent run, deletes its workspace `workspaces/session-run-<id>/` (its visuals, panel files, RFP packages, synthetic scripts) and its memory thread `run-<id>`, then the document. A code-only run has neither, so only the document goes. A run given as another run's `context` may be deleted; the later run keeps `context.fromRunId` as a dangling reference.
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
- As 105: query `file` and `draft`, over the run's workspace folder `rfp/<rfpId>/`.
- Errors (Style B): `404 "Run \"<id>\" not found"`; then 105's.

#### 128. `POST /workflow-runs/:id/answer/feedback`
- Body: `{ rating: "up" | "down" }`. As 7 on the run's answer: sets `feedback` and `verified` on the stored answer; `up` saves a verified query keyed by `sourceRunId` (question = the run's question; same SQL, datasource and entity rules as 7), `down` deletes it.
- Success `200`: `{ ok: true, message, run }` (`message` as 7, `run` as 121).
- Errors (Style B): `400 "rating must be 'up' or 'down'"`; `404 "Run \"<id>\" not found"`; `404 "Run \"<id>\" has no answer"`.

#### 129. `POST /workflow-runs/:id/visualizations`
- Body: `{ sourceMessageAt?: string }`. Omitted: the run's answer. As 8, over the run's workspace and its answer as the source.
- Success `201`: `{ ok: true, message: "Interactive visual generated", run, visualization }` (`run` as 121, `visualization` as 9, version 1).
- Side effects: writes the bundle under `workspaces/session-run-<id>/visuals/<visualId>/v1/`, upserts the run's `visualizations` and its `visual:<visualId>` panel item, and appends the card `Created interactive visual "<title>" (v1).` (a `ChatMessage` carrying `visual`) to the run's `events` (data-model 3.16).
- Errors (Style B): `404 "Run \"<id>\" not found"`; `400 "Run \"<id>\" has no answer to visualize"` (a code-only run); `400 "Wait for the run to finish"` (a run still `running`); then 8's refusals as statuses (`400 "completed assistant answer not found"`, `400` on a designer or validation error, timeout).

#### 130. `POST /workflow-runs/:id/visualizations/:vid/tailor`
- Body: `{ instruction: string }` (required, trimmed non-empty). As 10: a new version `v<n+1>`, the card `Updated interactive visual "<title>" (v<n+1>).` appended to `events`.
- Success `201`: `{ ok: true, message: "Updated to version <n>", run, visualization }`.
- Errors (Style B): as 129; `400 "instruction is required"`; `404 "Visualization <vid> not found in session run-<id>"`.

#### 131. `POST /workflow-runs/:id/visualizations/:vid/revert`
- Body: `{ version: number }`. As 11: moves `currentVersion` only; the card `Reverted interactive visual "<title>" (v<n>).` is appended to `events`.
- Success `201`: `{ ok: true, message: "Reverted to version <n>", run, visualization }`.
- Errors (Style B): as 129; `400 "Version <n> does not exist"` (also a missing or non-numeric `version`).

#### 132. `POST /workflow-runs/:id/visualizations/:vid/refresh`
- Body: none. As 12 over the run's `datasets`: re-runs each stored `run_readonly_sql` record of the current version and rewrites `data.json` and `index.html` in place; no new version, no designer call, no card.
- Success `201`: `{ ok: true, message: "Refreshed data for version <n>", run, visualization }`.
- Errors (Style B): as 129; `404 "Visualization <vid> not found in session run-<id>"`.

#### 133. `POST /workflow-runs/:id/visualizations/:vid/repair`
- Body: `{ error?: string; version: number }`. As 13: only the current version, and never an automatic repair again; no card.
- Success `201`: `{ ok: true, message: "Repaired as version <n>", run, visualization }`.
- Errors (Style B): as 129; `400 "Only the current version can be repaired (requested v<x>, current v<y>)"`; `400 "Version <n> is already an automatic repair; not repairing again"`.

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
  - Failure messages: unknown fixture (`Unknown sample fixture "<id>"`), REST-kind fixtures other than the self-registering `intellify-api` (registered by a script, not here), field validation, connection failure, missing database that cannot be created, seed failure, and `"Missing entities after seeding|registering: <list>. ..."` (returns `ok:false` but still includes `datasourceId`, `createdDatabase`, `seeded`).
- **Self-registering REST fixture `intellify-api`** ([testing-data](../capabilities/testing-data/spec.md), [rfp](../capabilities/rfp/spec.md)): the body is ignored and the field validation is skipped. The backend reads the embedded Intellify RFP API's URL and key (`IntellifyApiInfo`; 2.16), checks `GET /health`, discovers the endpoints from `GET /openapi.json` (as `POST /datasources/rest/discover`, #17), keeps the proposed collection endpoints with `group: "intellify"`, saves the datasource `Intellify RFP API` (`kind: "rest"`, `auth: { type: "api-key-header", headerName: "X-API-Key", token: <the API key> }`, reusing an existing record of that name), refreshes the inventory and saves the dataset `Intellify RFP API` with the 10 required entities (`clients`, `products`, `funding_types`, `plan_types`, `carriers`, `plan_designs`, `policies`, `financials`, `census`, `rfps`). No database is written. Success message `"Registered the Intellify RFP API at <url> and loaded 10 entities into dataset \"Intellify RFP API\""`. Failures: `"The Intellify API is not running in this app (INTELLIFY_API=off or it failed to start) — see the system logs."`; `"The Intellify API cannot reach its database at <host:port/db>. Load the \"Intellify\" sample into that database first."`; the missing-entities message. `GET /testing-data` lists it with `seedable: false`. Other REST-kind fixtures (`world-cup-rest`) stay register-only by script.
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

### 2.16 Intellify RFP API

A **separate NestJS application** in the backend package (`backend/src/intellify-api/`; ADR-0027 in [architecture.md](architecture.md)): the only way the RFP Builder agent reaches the Intellify data and saves an RFP ([rfp](../capabilities/rfp/spec.md); tools in [agents.md](agents.md) 3.10). It has its own port, authentication, error shape, OpenAPI document and PostgreSQL pool; none of the conventions in section 1 (Style A/B) apply to it. The app calls it only over HTTP, through the REST datasource `Intellify RFP API` that the `intellify-api` Testing Data fixture registers (2.9 #56).

**Running.** Embedded by default: `createApp()` starts it in the backend process after the app listens, on `INTELLIFY_API_HOST` (default `127.0.0.1`) and `INTELLIFY_API_PORT` (default `3100`; `0` = a free port), unless `INTELLIFY_API=off` or the CLI flag `--no-intellify-api` (5). Standalone: `npm run intellify-api` (6.4) runs `node dist/intellify-api/main.js`, configured from the environment only. If the embedded API fails to start (port busy, bad configuration), the app still starts and logs `Intellify API not started: <reason>`. Variables: 6.1. Database and `rfp` schema: [data-model.md](data-model.md) section 7.

**Wire format.** Base path `/v1` for the data routes. `Content-Type: application/json; charset=utf-8` unless a route says otherwise. Intellify ids are the 24-hex `char(24)` strings; RFP ids are UUIDs. Dates are ISO `YYYY-MM-DD`; money is a number in USD.

**Auth.** Every route except `GET /health` and `GET /openapi.json` needs `X-API-Key: <key>`, compared in constant time with the configured keys (`INTELLIFY_API_KEY` may hold several, comma-separated; embedded without it, the key in `<APP_DATA_DIR>/.intellify-api-key`, [data-model.md](data-model.md) 1.2). Missing or wrong: `401 { statusCode:401, error:"Unauthorized", message:"API key required" }`. The key is the whole access boundary: RFP records carry `createdBy` as an attribute, not an access control. `createdBy` comes from the body of `POST /v1/rfps`, else the `X-Qti-User` header (the app sends it in the body: the super admin's id, `local`, or `eval:<jobId>` for an eval run).

**Error shape** (every non-2xx): `{ statusCode: number; error: string; message: string; code?: string; details?: string[] }`. Codes: `validation` (400; `details` lists the field problems), `not_found` (404; also an unknown route), `conflict` (409, e.g. a backwards status move), `database_unavailable` (503, message `database unavailable`, when PostgreSQL can't be reached; the API itself keeps running).

**Pagination** (the collection routes, 2.16.2, only): query `page` (1-based, default 1) and `per_page` (default 100, capped at 500); response `{ data: T[], page: number, per_page: number, total: number }`. A `page` or `per_page` that is not a positive integer is a 400 `validation`. The OpenAPI document declares both parameters and the `data` array, so REST discovery ([datasources](../capabilities/datasources/spec.md)) proposes these routes as tables with rows pointer `/data` and page-style pagination. Routes with a path parameter are deliberately not tables.

**Soft deletes.** Every read over Intellify data leaves out rows with `deleted = true` unless the query has `includeDeleted=true`.

**Read and write safety.** Every read over schema `intellify` runs in a `READ ONLY` transaction that is rolled back. Writes go only to schema `rfp`, through parameterised statements; no request value is ever interpolated into SQL.

#### 2.16.1 Service

| # | Method + path | Response |
|---|---|---|
| I1 | `GET /health` | Public. `{ ok: boolean, version: string, database: 'up'\|'down', schema: 'intellify', rfpSchemaVersion: number\|null }`; `ok` is `false` when the database is down. |
| I2 | `GET /openapi.json` | Public. The OpenAPI 3.0 document, title `Intellify RFP API`, generated at start from the controllers and DTOs. Each collection operation (2.16.2) is a `GET` without path parameters that declares `page` and `per_page` as optional integers and a `data` array schema. |

#### 2.16.2 Collections

Paged (`{ data, page, per_page, total }`); the REST datasource's tables, group `intellify`. Each row below is one item of `data`.

| # | Method + path | Query | Row shape |
|---|---|---|---|
| I3 | `GET /v1/clients` | `q` (name or `oneCode`, case-insensitive substring) | `{ id, oneCode, name, tenantKey, headcount: number\|null /* latest census totalEmployees */, latestCensusYear: string\|null, linesOffered: number, nextRenewalEffectiveDate: string\|null }` |
| I4 | `GET /v1/products` | | `{ id, name, locType, displayOrder }` (the 12 lines of coverage) |
| I5 | `GET /v1/funding-types` | | `{ id, name, displayOrder, theme }` |
| I6 | `GET /v1/plan-types` | `line` (product name) | `{ id, line, name }` |
| I7 | `GET /v1/carriers` | `line`, `clientOneCode` | `{ id, name, code, lines: string[] /* product names, from insurer_categories */, incumbentFor: string[] /* lines where it carries a live policy for clientOneCode; [] without it */, finalCredits: number /* carrier credits isFinal and not expired for that client */ }` |
| I8 | `GET /v1/plan-designs` | `clientOneCode`, `line` | `{ id, clientOneCode, clientName, line, planType /* from plan_financial.planType */, carrier, fundingType, state, creationFlag, policyNumber, enrolledEmployees, annualPremium, planYear }`, one row per plan design joined to its coverage and financials |
| I9 | `GET /v1/policies` | `clientOneCode` | `{ id, clientOneCode, carrier, number, kickOffTiming, kickOffDays, coverages: number }` |
| I10 | `GET /v1/financials` | `clientOneCode`, `line`, `planYear` | `Financial = { coverageId, clientOneCode, line, planDesignId, carrier, fundingType, planType, ratingBasis, planYear, enrolledEmployees, coveredLives, monthlyPremium, annualPremium, priorYearAnnualPremium, renewalIncreasePct, employerPct, employeeMonthlyEmployeeOnly, adminFeePepm, stopLossPepm, ratePer1000, pepm, rateEmployeeOnly, rateEmployeeSpouse, rateEmployeeChildren, rateFamily, enrollEmployeeOnly, enrollEmployeeSpouse, enrollEmployeeChildren, enrollFamily }`, the flattened `plan_financial`; `null` where a key doesn't apply to the line |
| I11 | `GET /v1/census` | `clientOneCode`, `year` | `CensusRow = { documentId, clientOneCode, effectiveYear, totalEmployees, eligibleEmployees, enrolledEmployees, averageAge, averageSalary, femalePct, malePct, fullTime, partTime, tierEmployeeOnly, tierEmployeeSpouse, tierEmployeeChildren, tierFamily, statesCount, participationRate, source, uploadedAt }` |
| I12 | `GET /v1/rfps` | `clientOneCode`, `status`, `createdBy` | `RfpSummary` (2.16.4), newest (`createdAt`) first |

#### 2.16.3 Per-client reads

Not paged. `:oneCode` is the client's `one_code`. Every route answers `404 { code:"not_found", message:"Client \"<oneCode>\" not found" }` for an unknown or deleted client.

| # | Method + path | Response |
|---|---|---|
| I13 | `GET /v1/clients/:oneCode` | `{ client: { id, oneCode, name, tenantKey, deleted }, contacts: [{ email, contactType, country }], headcount, latestCensusYear, lines: [{ line, locType, status /* latest loc_statuses by start_date */, statusSince, planDesigns: number }] }` |
| I14 | `GET /v1/clients/:oneCode/renewals` | `{ planYear: number, renewals: [{ line, carrier, policyNumber, effectiveDate, kickOffTiming: { name, days }, kickOffDate, locStatus, annualPremium, renewalIncreasePct, reminders: [{ emailId, reminderDate }] }], upcomingWizards: [{ type, status }] }`. Plans are calendar-year: `effectiveDate` is 1 January after `plan_financial.planYear` (2026 → `2027-01-01`), and `kickOffDate` is `effectiveDate` minus the policy's kick-off days (`policies.kick_off_timing` → `renewal_kick_off_timings.days`). The response and the [rfp](../capabilities/rfp/spec.md) spec both state this assumption. |
| I15 | `GET /v1/clients/:oneCode/program` | Query `line`. `{ lines: [{ line, locType, status, plans: [{ planDesignId, planType, carrier, carrierId, fundingType, state, creationFlag, policyNumber, eligibility: { workflowStatus, versions }, censusMapping: { mapped: number, unmapped: string[] }, financials: { planYear, enrolledEmployees, coveredLives, annualPremium, priorYearAnnualPremium, renewalIncreasePct, employerPct } }] }], carriers: [{ carrier, lines: string[] }] }` |
| I16 | `GET /v1/clients/:oneCode/plans/:planDesignId` | The plan as in I15 with the full `planFinancial` object, every eligibility version, the census plans mapped to it, the alternate plans from wizards and its reminders. `404 "Plan design \"<planDesignId>\" not found for client \"<oneCode>\""`. |
| I17 | `GET /v1/clients/:oneCode/financials` | Query `line`, `planYear`. `{ planYear, rows: Financial[] /* I10 */, totals: { annualPremium, priorYearAnnualPremium, renewalIncreasePct, enrolledEmployees } }` |
| I18 | `GET /v1/clients/:oneCode/census` | Query `year` (default the latest). `{ years: string[], selected: CensusRow & { gender: { female, male }, byState: [{ state, employees }], tiers: [{ tier, employees, share }], employeeClass: { fullTime, partTime } }, plans: [{ line, censusPlanName, mappedTo: { planDesignId, planType, carrier } \| null }], aggregated: { headcount, enrolled, participationRate, averageAge, femalePct, tierMix, statesCount } \| null }` |
| I19 | `GET /v1/clients/:oneCode/commercials` | `{ contributions: [{ line, periodStart, periodEnd }], carrierCredits: [{ carrier, expirationDate, isFinal, notifications: number }], fees: [{ carrier, effectiveDate, expirationDate }], survey: { periodStart, periodEnd, answers: object } \| null, pointSolutions: [{ vendor, product }] }` |
| I20 | `GET /v1/clients/:oneCode/wizards` | `{ wizards: [{ id, line, type, status }], alternatePlans: [{ planDesignId, planType, name, fundingType, line }] }` |

#### 2.16.4 RFP records

Stored in schema `rfp` ([data-model.md](data-model.md) section 7). `:id` is the RFP's UUID; an unknown one answers `404 { code:"not_found", message:"RFP \"<id>\" not found" }`.

```ts
type RfpStatus = 'draft' | 'ready' | 'issued' | 'closed';     // moves forward only
RfpSummary = { id, clientOneCode, clientName, title, planYear: number, effectiveDate, status: RfpStatus,
  stage: number /* 0..7, the last completed stage */, lines: number, carriers: number, requirements: number,
  milestones: number, createdBy: string | null, createdAt, updatedAt,
  clientMissing?: true /* the client is no longer in intellify.clients (e.g. after a reseed) */ };
Rfp = Omit<RfpSummary, 'lines'|'carriers'|'requirements'|'milestones'> & {
  sections: { executiveSummary?, clientBackground?, scopeStatement?, instructionsToBidders?, evaluationCriteria?, notes? },
  lines: RfpLine[], carriers: RfpCarrier[], requirements: RfpRequirement[], timeline: RfpMilestone[] };
RfpLine = { id, position, line /* product name */, productId, planDesignIds: string[], marketBasis: 'as-is'|'alternate',
  alternateFunding?: string, alternatePlanType?: string, notes? };
RfpCarrier = { id, position, insurerId, insurerName, lines: string[], incumbent: boolean, contactEmail?, notes? };
RfpRequirement = { id, position, section, question, required: boolean,
  answerType: 'text'|'yes_no'|'number'|'table'|'attachment' };
RfpMilestone = { id, position, milestone, dueDate, owner?, notes? };
```

The `PUT` list routes replace the whole list; `position` is the item's 1-based place in the body array, and the items come back in that order.

| # | Method + path | Body | Response and rules |
|---|---|---|---|
| I21 | `POST /v1/rfps` | `{ clientOneCode, planYear, title?, createdBy? }` | `201 Rfp` with `status: 'draft'`, `stage: 1`. `title` defaults to `<client name> — <planYear> benefits RFP`; `effectiveDate` defaults to `<planYear>-01-01`. `400 validation` when the client doesn't exist in `intellify.clients` or `planYear` is not an integer in 2024..2035. |
| I12 | `GET /v1/rfps` | (query `clientOneCode`, `status`, `createdBy`) | Paged `RfpSummary`, newest first (2.16.2). |
| I22 | `GET /v1/rfps/:id` | | `Rfp`. |
| I23 | `PATCH /v1/rfps/:id` | `{ title?, planYear?, effectiveDate?, status?, stage?, sections?: Partial<sections> }` | `Rfp`. `sections` merge key by key. `409 conflict` when `status` would move backwards (order `draft → ready → issued → closed`); `400 validation` for a `stage` outside 0..7, an unknown status or section key, or an unparseable date. Stamps `updatedAt`. |
| I24 | `PUT /v1/rfps/:id/lines` | `Omit<RfpLine, 'id'\|'position'\|'productId'>[]` | `Rfp`. The API resolves `productId` from the line name. `400 validation` whose `details` list unknown lines and plan design ids that don't belong to the RFP's client. |
| I25 | `PUT /v1/rfps/:id/carriers` | `{ insurer: string /* id or exact name, case-insensitive */, lines: string[], incumbent?: boolean, contactEmail?, notes? }[]` | `Rfp`. `400 validation` `Unknown carrier "<x>". Known: <names>`. |
| I26 | `PUT /v1/rfps/:id/requirements` | `Omit<RfpRequirement, 'id'\|'position'>[]` | `Rfp`. `400 validation` for an unknown `answerType`. |
| I27 | `PUT /v1/rfps/:id/timeline` | `Omit<RfpMilestone, 'id'\|'position'>[]` | `Rfp`. `400 validation` for an unparseable `dueDate`. |
| I28 | `DELETE /v1/rfps/:id` | | `204`. `409 conflict` unless `status` is `draft`. |
| I29 | `DELETE /v1/rfps` | (query `createdBy`, required) | `{ deleted: number }`: deletes the **drafts** created by `createdBy`, or, for an eval run's tag (`createdBy` starting `eval:`), **every** record it created whatever its status, since a run that reaches stage 7 leaves a `ready` record (eval clean-up, [rfp](../capabilities/rfp/spec.md) R14). `400 validation` without `createdBy`. |

#### 2.16.5 RFP package

A deterministic projection of the stored record and the live Intellify data for the RFP's client and lines in scope; nothing is snapshotted. Each route answers 404 for an unknown RFP.

| # | Method + path | Response |
|---|---|---|
| I30 | `GET /v1/rfps/:id/document.md` | `text/markdown; charset=utf-8`: the RFP document (outline below). |
| I31 | `GET /v1/rfps/:id/document.pdf` | `application/pdf`: the same Markdown rendered with pdfkit (headings, paragraphs, bullet lists, tables with a shaded header row, built-in Helvetica, a page break between sections). A plain rendering, not a design artefact. |
| I32 | `GET /v1/rfps/:id/exhibits` | `{ exhibits: [{ name, title, rows: object[] }] }`, names in order `exhibit-a-census`, `exhibit-b-plan-designs`, `exhibit-c-financials`, `exhibit-d-carriers`. |
| I33 | `GET /v1/rfps/:id/exhibits/:name.csv` | `text/csv; charset=utf-8`, RFC 4180 with a header row; `:name` is one of the four exhibit names (the path ends in `.csv`, e.g. `/v1/rfps/<id>/exhibits/exhibit-a-census.csv`). `404 "Exhibit \"<name>\" not found"` for another name. |
| I34 | `GET /v1/rfps/:id/package.zip` | `application/zip` holding `rfp.md`, `rfp.pdf`, `exhibits/<name>.csv` (the four exhibits) and `manifest.json` (`{ rfpId, title, generatedAt, files: string[] }`): 7 files. Optional query `draft=true` (RFP R16): the document (Markdown and PDF) is titled `DRAFT — <RFP title>` and, right under the title, carries the line `Draft exported <YYYY-MM-DD> at stage <stage> of 7 — not for release to carriers.`; the PDF prints `DRAFT` in each page's header; `manifest.json` gains `"draft": true` and `"stage": <stage>` (`stage` is the RFP's completed stage, 0-7). The exhibits are unchanged. Without the query nothing changes. |

Exhibits: **A census**, the client's latest census (`CensusRow`, I11) with its state and tier breakdown; **B plan designs**, the client's plan designs on the lines in scope (I8 rows); **C financials**, their financials (I10 rows); **D carriers**, the RFP's invited carriers (`RfpCarrier` without ids).

Document outline (Markdown, deterministic):

1. `# <title>`, then a facts line: client, plan year, effective date, status, generated at.
2. `## 1. Executive summary`: the section text, or `_To be written._` when empty (the same for every narrative section below).
3. `## 2. Client background`: the section text, the client facts and the latest census as a table.
4. `## 3. Scope of this RFP`: the scope statement and a table of the lines (line, market basis, plans in scope, alternate funding and plan type).
5. `## 4. Current program`: one table per line in scope (plan, carrier, funding, enrolled, annual premium, renewal increase).
6. `## 5. Carriers invited`: a table.
7. `## 6. Requirements and questionnaire`: one subsection per requirement `section`, questions numbered, each with required or optional and its answer type.
8. `## 7. Timeline`: a table.
9. `## 8. Instructions to bidders` and `## 9. Evaluation criteria`: the section texts.
10. `## Exhibits`: the list of the four exhibits.

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

## 3. Streaming and long-running work

Three Server-Sent-Events endpoints exist (chat, workflow runs, ontology bootstrap). Both are POST, so they are read with `fetch` + `response.body.getReader()` and a `TextDecoder`, **not** `EventSource`. Two background-job patterns use start + poll instead of SSE (deep analysis, eval runs).

### 3.1 Chat stream: `POST /sessions/:id/messages/stream`

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

**Event envelope.** `{ type, content?, session? }`. `content` is a string; for `tool`, `tool-result`, `visual-updated`, `panel-item`, `workflow`, `rfp-package`, `readiness-report` and `tool-progress` it is itself **a JSON-encoded string** (double encoding) that the client parses.

| `type` | Payload | Meaning |
|---|---|---|
| `reasoning` | `content: string` (delta) | Model reasoning text delta, for a live "thinking" display. Not persisted. Empty deltas are not emitted. |
| `text` | `content: string` (delta) | Answer text delta. Concatenation of all `text` deltas is the streamed answer. One extra full-text `text` event may follow if a tool-only turn needed a synthesis pass. |
| `tool` | `content: JSON string` `{ name: string; rationale?: string; input?: string }` | A tool call started. `rationale` is the assistant's plain-language reason (flattened, max 400 chars) and is sent **with the call**, before the result. `input` says what the call is about, flattened and clipped to 200 characters: for the framework's skill tools the skill it loads (`skill`: its `name`; `skill_read`: `<skillName>/<path>`; `skill_search`: the query), else the call's first text argument; omitted when there is none. Legacy clients may receive a bare tool name instead of JSON; readers must fall back to treating non-JSON content as the name. Not emitted for `ask_clarification`. |
| `tool-result` | `content: JSON string` | A tool call finished. For data tools (`run_readonly_sql`, `sample_rows`): `{ tool, input?, rowCount?, error?, rationale? }`. For visual tools (`create_visual`, `update_visual`): `{ tool, input? /* the instruction */, error? }`. In a session bound to the RFP Builder (`agentKey: "rfp"`), every RFP tool ([agents.md](agents.md) 3.10) emits `{ tool, input? /* its first string argument */, rowCount?, error? }` (`rowCount` for a result that carries `columns` and `rows`, such as `get_client_financials`). **No `tool-result` is emitted for other tools** (`list_entities`, `describe_entity`). Row data is not streamed, only persisted in the final message. |
| `tool-progress` | `content: JSON string` `{ tool: string, phase: "inventory"\|"profiling"\|"relationships"\|"scoring"\|"storing", message: string, done?: number, total?: number, entity?: string }` | Live progress of a running tool (ADR-0033). Zero or more between a tool's `tool` event and its `tool-result`. Only `assess_data_readiness` emits it today. Not persisted. It doubles as a keepalive while the tool runs. The client shows the latest `message` on the tool's row ([ui.md](ui.md) 4.12). |
| `visual-updated` | `content: JSON string` `VisualEvent` `{ visualId, version, title, action: "created"\|"updated" }` | A visual tool produced a visual this turn; sent just before that tool's `tool-result`. The panel refreshes live. |
| `panel-item` | `content: JSON string` `PanelItemEvent` `{ item: PanelItem }` ([data-model.md](data-model.md) 3.4.4) | An agent showed something in the right panel this turn (`show_in_panel` returned without an error); never sent for a workflow change (`update_workflow`, the RFP Builder's stage auto-drive); sent just before that tool's `tool-result` `{ tool: "show_in_panel", input? /* the item's title */, error? }`. The client refreshes the session without disturbing the turn, makes the item the active one and opens the panel; for a `visual` item it also loads the visual. Every agent ([agent-panel](../capabilities/agent-panel/spec.md) R12). `visual-updated` stays for visual tools. |
| `workflow` | `content: JSON string` `WorkflowView` `{ phases: { number, title, skill? }[], source: "prompt"\|"agent"\|"workflow", current: number\|null, done: number[], skipped: number[], waiting?: boolean, note?: string, failed?: number }` ([data-model.md](data-model.md) 3.4.4) | The session's workflow changed this turn: after an `update_workflow` result without an error, after an RFP Builder stage was saved, and on a Questions to Insights v2 turn after each step of its workflow starts, ends or fails ([agents.md](agents.md) 5.11; these stand alone, between the turn's other events). `show_in_panel` never sends it. It carries the whole view, not a delta. It never creates a panel item and does not open the right panel. The client patches the session's `workflow` live, so the workflow bar moves while the turn streams; the persisted view arrives with `done` ([agent-panel](../capabilities/agent-panel/spec.md) R19). Every agent. |
| `rfp-package` | `content: JSON string` `RfpPackageEvent` `{ rfpId, title, files: { name, bytes }[], exportedAt, draft?: boolean }` | `export_rfp_package` or `export_rfp_draft` stored an RFP package in the session workspace (`rfp/<rfpId>/`, or `rfp/<rfpId>/draft/` when `draft` is `true`, [data-model.md](data-model.md) 4.1) this turn; sent just before that tool's `tool-result`. The answer persisted at the end of the turn carries the same value as `rfpPackage` (data-model 3.4.1), and the chat shows the package card with its downloads (#105). RFP Builder sessions only ([rfp](../capabilities/rfp/spec.md)). |
| `readiness-report` | `content: JSON string` `ReadinessReportEvent` `{ report: ReadinessReport, panelItem: PanelItem }` ([data-model.md](data-model.md)) | `assess_data_readiness` or `get_readiness_report` returned a report this turn; sent just before that tool's `tool-result`. The client shows the scorecard in the right panel (the `panelItem`, kind `readiness`, is also persisted on the session as `show_in_panel` items are). The answer persisted at the end of the turn carries `readinessReport` (data-model 3.4.1), and the chat shows the readiness card. Data Readiness Agent sessions only ([data-readiness](../capabilities/data-readiness/spec.md) R5). |
| `done` | `session: SessionDoc` | **Terminal, success.** The persisted session with this turn's messages. |
| `error` | `content: string` | **Terminal, failure.** Human-readable message (`"message is required"`, `"Session <id> not found"`, provider/model errors). |

**Ordering.**

```
[reasoning* | text* | (tool → tool-progress* → [visual-updated | panel-item | workflow] → tool-result)*]  interleaved in model order
 → (optional silent post-processing)
 → done            or            error
```

- `tool` always precedes its own `tool-result`; parallel/interleaved calls are possible. `tool-progress` events fall between a tool's `tool` and its `tool-result`. `visual-updated`, `panel-item` and `workflow` precede the matching `tool-result` (for an RFP stage auto-drive, which has no tool call of its own, they stand alone).
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
| `step` | `id`, `title`, `status: 'running' \| 'success' \| 'failed' \| 'skipped' \| 'stopped'`, `output?`, `outputTruncated?: true`, `error?` | A step of the workflow started (`running`) or ended. `success` carries the step's output (`outputTruncated` instead when it is larger than 20 000 JSON characters); `failed` its error; `stopped` a step that ended the run early (an agent step stopped by the user or ended on a clarifying question; v2's Analyse after a stop). When the run ends, a step that never started is sent as `skipped`, and one still running as `stopped` (the run stopped) or `failed` (the run failed). Every step event of the run is sent, whatever the workflow's `bar`. |
| `reasoning`, `text`, `tool`, `tool-result`, `tool-progress`, `visual-updated`, `panel-item`, `workflow`, `rfp-package`, `readiness-report` | as 3.1 (`content`) | Agent workflows: the agent turn's events, unchanged, interleaved with the `step` events. 3.1's `done { session }` is never sent. |
| `done` | `run: WorkflowRun` | **Terminal, success** (also for a code-only run whose step failed, and for a turn that ended on a clarifying question). |
| `error` | `content: string` | **Terminal, failure** of an agent turn: the chat stream's message for the same failure (a custom endpoint's R50 text, a provider error, `No API key configured…`). |

```ts
type WorkflowRun = {
  id: string;                      // the run id; the host is `run-<id>`, the workspace `session-run-<id>`
  workflowId: string;
  workflowName: string;            // the workflow's name when the run started
  input: Record<string, string | number | boolean | string[]>;   // the checked input (defaults filled)
  context?: { fromRunId: string };
  status: 'running' | 'success' | 'failed' | 'stopped';   // 'running' only while it runs (121); done.run is never 'running'
  steps: { id: string; title: string; status: 'success' | 'failed' | 'skipped' | 'stopped'; output?: Record<string, unknown>; outputTruncated?: true; error?: string }[];
  output?: Record<string, unknown>;   // success: the last step's output (Wrap up's for v2; `{ calls, stopped }` for a one-step workflow; the engine's result for a code-only run)
  error?: string;                  // failed
  // Agent workflows only:
  question?: string;               // the user message the agent received (`question`, or the RFP Builder's `message`), trimmed
  answer?: ChatMessage;            // the assistant message the turn persisted on the host (data-model 3.4.1); absent when it stopped or failed before answering
  datasets: string[];              // the host's datasets ([] for a code-only run)
  agentKey?: string; agentId?: string; agentName?: string;
  agent?: SessionAgentRef;         // as a session's (2.1)
  rfpId?: string;                  // RFP Builder: the RFP the run worked on (`turn-rfp`, or the input's)
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
```

`panelItems`, `workflow` and `agent` are derived on every read (121) and never stored; the stored run is [data-model.md](data-model.md) 3.16.

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
| Spawn | Electron's own binary with `ELECTRON_RUN_AS_NODE=1` running `backend/dist/main.js` (packaged: `<resources>/backend/dist/main.js`); `stdio` piped; env passes `PORT`, `APP_DATA_DIR`, `APP_SECRET`, and nothing else. Missing entry file records an error diagnostic and does not start. |
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
| `--host` | string | `127.0.0.1` | Interface to bind. `--host 0.0.0.0` opens the app to every machine that can reach the port, with full access and no sign-in (1.9, G14). |
| `--data-dir` | path | `$QTI_DATA_DIR`, else `$APP_DATA_DIR`, else `~/.questions-to-insights` | Resolved to an absolute path; created (`mkdir -p`). Deliberately separate from the Electron `userData` dir so both can run at once. |
| `--no-open` | none | opens the browser | Parsed as the negation of a boolean `open` option. |
| `--intellify-api-port` | integer 0..65535 | `$INTELLIFY_API_PORT`, else `3100` | Port of the embedded Intellify RFP API (2.16); `0` = a free port. Sets `INTELLIFY_API_PORT` before the app is imported. Invalid value → exit 1 `invalid --intellify-api-port "<v>" (expected 0-65535)`. |
| `--no-intellify-api` | none | starts the embedded API | Does not start the embedded Intellify RFP API (sets `INTELLIFY_API=off`). |
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
  Intellify API: http://<INTELLIFY_API_HOST>:<port>   # e.g. http://127.0.0.1:3100; only when the embedded Intellify RFP API started (2.16)
  Press Ctrl+C to stop.
(blank)
```

The `Intellify API:` line carries the actual bound port of the embedded API (useful with `--intellify-api-port 0`); the E2E fixture reads it the way it reads `URL:`. When the API did not start, the line is left out and the backend log holds `Intellify API not started: <reason>`.

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
| `WEB_ROOT` | `app-bootstrap.ts` | Directory holding the built web UI (`index.html`). | `<package>/public` |
| `INIT_CWD`, `PWD` | Mastra storage | Launch directory used to place the fallback `data/` folder (Studio changes `cwd`). | process cwd |
| `VISUAL_MODEL` | visual designer agent | Forces the designer model (router id `provider/model`). Unset: reasoning-family models are swapped for `openai/gpt-4.1-mini` and `nano` models upgraded to their `mini` sibling; others kept. | unset |
| `OPENAI_API_KEY` | Mastra's env-bound model router (via model resolver) | Fallback model credential (`openai/gpt-4o-mini`) when no LLM settings are saved. | unset |
| `WORLD_CUP_DB_PORT` | testing-data fixture registry | Port of the sample PostgreSQL server in the form prefill and compose stack. | `55432` |
| `INTELLIFY_API` | `app-bootstrap.ts` | `off` disables the embedded Intellify RFP API (2.16); any other value or unset starts it. The CLI's `--no-intellify-api` sets it. | unset (started) |
| `INTELLIFY_API_HOST` | Intellify API config (`intellify-api/config.ts`) | Interface the Intellify RFP API binds. | `127.0.0.1` |
| `INTELLIFY_API_PORT` | Intellify API config | Its port; `0` = a free port. The CLI's `--intellify-api-port` sets it. | `3100` |
| `INTELLIFY_API_KEY` | Intellify API config | The accepted API keys, comma-separated. Standalone (`npm run intellify-api`): required, startup fails without it. Embedded: optional; unset, the backend reads `<APP_DATA_DIR>/.intellify-api-key`, or creates it (32 random bytes hex, mode `0600`, as `.app-secret`). Never logged. | `<APP_DATA_DIR>/.intellify-api-key` (embedded) |
| `INTELLIFY_DB_HOST` | Intellify API config | PostgreSQL host of the Intellify database ([data-model.md](data-model.md) section 7). | `127.0.0.1` |
| `INTELLIFY_DB_PORT` | Intellify API config | Its port. | `WORLD_CUP_DB_PORT`, else `55432` |
| `INTELLIFY_DB_NAME` | Intellify API config | Its database name. The `/health` and Testing Data messages name the database looked for. | `intellify_mercer_demo` |
| `INTELLIFY_DB_USER` | Intellify API config | Its user. | `world_cup` |
| `INTELLIFY_DB_PASSWORD` | Intellify API config | Its password. Never logged. | `world_cup_dev` |
| `INTELLIFY_DB_SSL` | Intellify API config | `true` connects over TLS. | `false` |
| `INTELLIFY_DB_SCHEMA` | Intellify API config | Schema holding the Intellify data (the `intellify` fixture's). The `rfp` schema's name is fixed. | `intellify` |
| `EVAL_DATASETS` | `mastra/evals/run-assistant-evals.ts` (CLI eval script only) | Comma-separated dataset names to run the assistant evals against. Required by that script. | none |
| `EVAL_SET` | `mastra/evals/run-assistant-evals.ts` (CLI eval script only) | The question set to run (`world-cup`, `world-cup-rest`, `formula-1`, `rfp`). That script needs this or `EVAL_CASES`, not both ([agents.md](agents.md) 8.5). | none |
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

`BACKEND_URL` (default `http://127.0.0.1:3000`) and `WORLD_CUP_API_URL` (`http://127.0.0.1:55080`) for `setup-worldcup-rest.ts`; `WORLD_CUP_API_PORT` (`55080`) for the sample REST server; `WORLD_CUP_DB_HOST|PORT|DATABASE|USER|PASSWORD` (`127.0.0.1|55432|world_cup|world_cup|world_cup_dev`) for the dump script; `EVAL_ROW_LIMIT` (`500`), `EVAL_TIMEOUT_MS` (`300000`) for `run-eval.ts`; `CHECK_TIMEOUT_MS` (`180000`), `CHECK_MODEL` (`gpt-4o-mini`), `CHECK_ARM`, `CHECK_TRIALS` for `check-answers.ts`. `npm run intellify-api` in `backend/` runs the Intellify RFP API standalone (`node dist/intellify-api/main.js`, after a build), configured only by the `INTELLIFY_*` variables of 6.1, with `INTELLIFY_API_KEY` required (2.16).

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

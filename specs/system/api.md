# API contract

The complete contract between the renderer (or any HTTP client) and the backend, plus the desktop IPC bridge, the CLI and the environment. Persisted document shapes (session, dataset, datasource, metric, ontology item, verified query, LLM settings, eval run) live in [data-model.md](data-model.md); this file links to them and only restates a shape where the wire format differs from the stored one.

Contents: [1 Conventions](#1-conventions) · [2 Endpoints](#2-endpoints) · [3 Streaming and long-running work](#3-streaming-and-long-running-work) · [4 Desktop bridge (IPC)](#4-desktop-bridge-ipc) · [5 CLI contract](#5-cli-contract) · [6 Environment variables](#6-environment-variables) · [7 Gaps and open questions](#7-gaps-and-open-questions)

Endpoint total: **105 HTTP route handlers** across 18 app controllers (conversations 1, agents 17, workflow runs 18, skills 9, sessions 9, llm 7, datasources 6, ontology 6, metrics 5, monitoring 6, synthetic data 4, workflows 4, datasets 3, developer settings 3, testing data 3, UI preferences 2, draft runs 1, health 1). Verified queries have **no** HTTP surface (they are created and removed as a side effect of message feedback, and read by the metrics promotion path).

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

**Style B, framework exceptions, real HTTP status.** Endpoints that do not catch let the framework answer. Used by: `GET /sessions/:id`, the visual `GET` endpoints, `GET /agents/:key`, the eval-run download, the whole ontology and personas controllers, and the synthetic-data controller, and the Excel / CSV file routes of datasources (156 to 158).

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

POST handlers return the framework default **201 Created**, except where an endpoint states **200**: the two SSE endpoints (5 and 54, 200 once the stream starts, whatever it then carries), `POST /developer-settings/test-endpoint` (55), `POST /testing-data/:fixtureId/load` (56), `POST /datasources/files/preview` (157). GET/PUT/DELETE return **200**; `DELETE /ontology/:id`, `DELETE /personas/:id` `DELETE /visuals/:id` and `DELETE /datasources/files/uploads/:uploadId` (158) return **204 No Content**. The file downloads write the response themselves and return **200**; so do `POST /synthetic-data/scripts`, `/profile-exports` and `/sample-exports` (112 to 114), which stream an attachment (only 111 returns **201**). Clients treat any 2xx as success and do not depend on 200 vs 201.

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
| 144 | `POST /sessions/:id/messages/:message/answer/evidence` | Build the query evidence of a message's answer, and size the tables its queries read | no |
| 145 | `POST /sessions/:id/messages/:message/answer/queries/:index/explanation` | Explain one of the message's queries step by step (cached in the message) | no |
| 146 | `POST /sessions/:id/messages/:message/answer/queries/:index/stage-counts` | Count the rows after each step of an explained query, checked | no |
| 162 | `POST /sessions/:id/messages/:message/answer/queries/:index/steps/:step/preview` | The first rows one step of an explained query leaves | no |
| 147 | `POST /sessions/:id/messages/:message/answer/queries/:index/rerun` | Run one of the message's queries again; nothing stored | no |
| 148 | `GET /sessions/:id/messages/:message/answer/queries/:index/csv` | One query's rows as CSV, up to 50,000 | no |
| 154 | `POST /sessions/:id/messages/:message/answer/queries/:index/page` | One page of one of the message's queries, filtered and sorted; nothing stored | no |
| 155 | `POST /sessions/:id/messages/:message/answer/queries/:index/interpret-filter` | The user's words read as a view (filters, sort, page) of one of the message's queries; nothing stored | no |

The session on the wire (endpoints 1 and 2) is the stored `SessionDoc` (data-model 3.4) plus two derived fields of the right panel ([agent-panel](../capabilities/agent-panel/spec.md), never stored as such): `panelItems: PanelItem[]` (always present, newest shown last as stored; the stored items, without any of the retired kind `phases`, plus a synthesized `visual:<id>` item for every visual without one, [data-model.md](data-model.md) 3.4.4) and `workflow?: WorkflowView` (present when the session's agent is workflow-backed (`insights-analyst`, [agents.md](agents.md) 5.11), its prompt has a `## Workflow` section or the agent has defined its own steps with `update_workflow`; the extended view of [data-model.md](data-model.md) 3.4.4: `source`, `skipped`, `waiting?`, `note?`, `failed?` besides the phases and the saved progress; the `done` event carries it too), plus, for a session with an `agentId`, a derived `agent: { id: string; name: string; deleted: boolean; description: string; starterQuestions: string[] }`. While the agent exists, `name`, `description` and `starterQuestions` come from its Live version and `deleted` is `false`. Once it is deleted, `name` is the stored `agentName`, `deleted` is `true`, and `description` and `starterQuestions` are empty (past-chats R57-R59). For a preview session, `name`, `description` and `starterQuestions` come from the agent's **draft**, read at each request. For a session with an `agentKey` (bound to a built-in agent, ADR-0028), `agent` is `{ id: <agentKey>, name: <the registered agent's name>, deleted: false, description: <its description>, starterQuestions: <its built-in starters> }`. A stored `agentKey: "rfp"` (the removed RFP Builder) does not resolve: such a session reads as a plain one. It is computed on every read, never stored.

Every session on the wire also carries an always-present, derived `workflowRef: { id: string; name: string; kind: 'code' | 'agent'; deleted: boolean }`: the workflow the session runs ([workflows](../capabilities/workflows/spec.md) R4; [agents.md](agents.md) 5.12). A session of Answer a Business Question (Avery + Michael) reads `{ id: 'orchestrated-answer-michael', name: 'Answer a Business Question (Avery + Michael)', kind: 'code', deleted: false }`. A past chat of a workflow removed on 2026-11-23 or 2026-11-26 reads `{ id: 'answer-business-question' | 'orchestrated-answer' | 'recreate-dashboard' | 'map-dashboard-data' | 'review-website' | 'consumption-gap-analysis' | 'data-readiness-assessment', name: <the removed workflow's name>, kind: 'code', deleted: false }` (`REMOVED_WORKFLOW_NAMES`) and shows no link to a workflow page ([workflows](../capabilities/workflows/spec.md) R48, R49, R50; the five names of 2026-11-26 are `Dashboard Image to Artifact`, `Map a Dashboard to Data`, `Review a Website`, `Consumption Gap Analysis` and `Assess Data Readiness`; a session whose agent is one of the four agents removed that day with the first three (Grace, Daniel, Zoe, Iris) or one of Rosa, Leo and Nora shows no agent and its old chip, and a new turn answers `Agent "<key>" not found`; one whose agent was Sarah, the Data Readiness Agent, reads as a plain Assistant session, below). Since 2026-11-12 (ADR-0042) the `agent:*` ids are internal and never in the catalogue, but a session bound to one keeps its reference as before (`agent:assistant`, a retired stored id of the removed Emily, named `Assistant`; `agent:<user-agent id>` named after the agent's Live name, with `deleted: true` and the stored `agentName` once the agent is deleted), and shows no link to a workflow page. A session stored with the removed workflow `seq-text-demo` or `deep-analysis` reads as a plain Assistant session (`{ id: 'agent:assistant', name: 'Assistant', kind: 'agent', deleted: false }`), and so does one whose agent was the removed Data Readiness Agent (`agentKey` `data-readiness`, its `agent:data-readiness` id dropped; since 2026-11-26, [workflows](../capabilities/workflows/spec.md) R50): its chip reads `Assistant`, no new turn runs on a stored session, and its stored `readinessReport` and `readiness` panel items are ignored. It is computed on every read, never stored. The `agent` and `workflow` fields above are unchanged: `workflow` is the workflow bar's view, not this reference.

Since 1.23.27 the routes that wrote to a session are removed (3, 5, 6, 7, 8, 10-13 here and 46, 47 in 2.7): a stored session is listed, read, downloaded from and deleted, nothing more ([past-chats](../capabilities/past-chats/spec.md)). The query inspector (144-148, since 1.25.9) writes only what the app caches about an answer (its `evidence` and their explanations) into the stored message, never the conversation, and keeps the session's `updatedAt`, so the list order does not change. A preview session never exists any more; the agent editor's preview is a draft run (api.md 129).

#### 1. `GET /sessions`
- Response `200`: `{ sessions: SessionDoc[] }`. Ordering is the repository's (most recently updated first; see data-model). No pagination; full documents including messages are returned.
- Errors: none expected.
- Past chats stay readable (read-only). Until 1.23.22 this was also the Electron main process's backend readiness probe; the probe is `GET /health` (135, 4.3).

#### 2. `GET /sessions/:id`
- Response `200`: `SessionDoc` (bare, not enveloped), with `panelItems` and `workflow` as above. Each assistant message that has `data` and no stored `evidence` carries `evidence` derived in code from its `data` (`evidenceOf`: coverage from the SQL and the cap its rows ran into; no query runs, nothing is stored), so every past answer shows its coverage at once (1.25.9). 1 returns the messages as stored.
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

#### Query evidence of a past chat (144-148, 154, 155)

The query inspector over a session's assistant message (1.25.9; plan `docs/plans/m1-25-query-inspector.md` section 5). Each mirrors 139-143, 152 and 153 (2.6.3) on the same engine (`AnswerEvidenceService`, `sessions/query-evidence/answer-evidence.service.ts`), with `message` in place of `run`. `:message` is the message's index in `messages` (0-based); `:index` is an `evidence[].index` of that message, as in 140-143. Capability: [past-chats](../capabilities/past-chats/spec.md).
- Who may call: whoever may read the session through 2 (the same read, `SessionsService.get`); anything else answers 2's 404.
- Errors (Style B), in this order: `404 "Session <id> not found"`; `400 "Message <message> has no answer with queries"` (no message at that index, not an assistant message, a message without `data`, or a `:message` that is not a whole number); `400 "Query <index> not found in the message's answer"` (an `:index` that is no `evidence[].index`, or not a whole number). A message stored without `evidence` has it derived from `data` for these checks. There is no `Wait for the run to finish`: a past chat does not run.
- Every write goes into the stored message (`messages[<message>]`: its `evidence`, nothing else), under the engine's lock keyed by session and message, and each write re-reads the session first, one write per session at a time. The session's `updatedAt` does not change.
- Statements and the datasource of a query: as 139-143 and 152 over the session's `datasets` (the datasource rule's two 400s keep their text, which names the run).

#### 144. `POST /sessions/:id/messages/:message/answer/evidence`
- Body: none. As 139 on the message: builds `evidence`, sizes the tables (one `SELECT COUNT(*)` per distinct table, at most 3 at a time); with nothing missing it runs no query and writes nothing.
- Success `201`: `{ ok: true, message: ChatMessage }`: the message as stored after the call.
- Errors: the shared ones.

#### 145. `POST /sessions/:id/messages/:message/answer/queries/:index/explanation`
- Body: none, or `{ refresh: true }` (as 140). As 140: the stored explanation when there is one, else `sample_rows` by code or one call to `query-explainer`, stored at `messages[<message>].evidence[k].explanation`. A second request for the same session, message and index while one runs waits for the same result.
- Success `201`: `{ ok: true, message: ChatMessage }`.
- Errors: the shared ones; `400 "Query <index> has no SQL to explain"`; `400 "The query could not be explained: <model error>"`.

#### 146. `POST /sessions/:id/messages/:message/answer/queries/:index/stage-counts`
- Body: none. As 141, stored in the message.
- Success `201`: `{ ok: true, message: ChatMessage }`.
- Errors: the shared ones; `400 "Explain query <index> first"`.

#### 162. `POST /sessions/:id/messages/:message/answer/queries/:index/steps/:step/preview`
- Body: none. As 161, stored in the message.
- Success `201`: `{ ok: true, message: ChatMessage }`.
- Errors: as 161.

#### 147. `POST /sessions/:id/messages/:message/answer/queries/:index/rerun`
- Body: none. As 142. **Nothing is stored.**
- Success `201`: `{ ok: true, result: QueryRerunResult }` (142).
- Errors: the shared ones; `400 "Query <index> has no SQL to run"`; the datasource rule's two 400s; the connector's own message as a 400 otherwise.

#### 148. `GET /sessions/:id/messages/:message/answer/queries/:index/csv`
- As 143: the checks of 147 before any header, up to 50 000 rows.
- Response `200`: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="query-<Q>-<first 8 of the session id>-<message>.csv"`, `X-Rows-Cut: 50000` when more rows existed; the body as 143.
- Errors: as 147.

#### 154. `POST /sessions/:id/messages/:message/answer/queries/:index/page`
- Body: `PageRequest` (152). As 152 on the message's query. **Nothing is stored.** Roadmap 1.28.2; decision: [architecture.md](architecture.md) ADR-0050.
- Success `201`: `{ ok: true, result: PageResult }` (152).
- Errors: the shared ones; then as 152.

#### 155. `POST /sessions/:id/messages/:message/answer/queries/:index/interpret-filter`
- Body: `{ text: string; view?: ResultView }` (153). As 153 on the message's query: one call to `result-explorer`, the query its only candidate. **Nothing runs and nothing is stored.** Roadmap 1.28.4.
- Success `201`: `{ ok: true, interpretation: FilterInterpretation }` (153).
- Errors: the body's 400s of 153 first; then the shared ones; then as 153.

### 2.2 Datasources

Controller prefix `/datasources`. Capability: datasources. Shapes: `DatasourceView`, `DatasourceConfig` (databricks / postgres / rest / file), `SourceFile`, `SheetImport` and `SheetPreview` in data-model. 15 to 20 answer Style A; the file routes 156 to 158 Style B (real statuses).

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 15 | `GET /datasources` | List saved datasources (secrets masked) | yes |
| 16 | `POST /datasources/test-connection` | Test a connection without saving | yes |
| 17 | `POST /datasources/rest/discover` | Propose REST endpoints from an OpenAPI/Swagger spec | yes |
| 18 | `POST /datasources` | Create or update a datasource | yes |
| 19 | `DELETE /datasources/:id` | Delete a datasource | yes |
| 20 | `GET /datasources/:id/inventory` | Catalog inventory (cached or live) | yes |
| 156 | `POST /datasources/files/uploads` | Upload one `.xlsx` or `.csv` file (raw body) and detect its sheets | no (story 1.31.4) |
| 157 | `POST /datasources/files/preview` | Preview one sheet of a file under import options | no (story 1.31.4) |
| 158 | `DELETE /datasources/files/uploads/:uploadId` | Drop an unsaved upload | no (story 1.31.4) |

Route order matters: `test-connection` and `rest/discover` are declared before the parameterised routes.

**Secret handling shared by 16, 17, 18.** When the body carries `id` of a saved datasource of the same `kind`, any secret that is empty or equal to the mask `••••••••` is replaced by the stored secret before use. Secrets: Databricks `token`; Postgres `password`; REST `auth.token` and `auth.password`. This lets the UI re-test or re-save without retyping secrets. Without `id`, the config is used as sent.

#### 15. `GET /datasources`
- Response `200`: `{ datasources: DatasourceView[] }` where each is `{ id, name, kind: "databricks"|"postgres"|"rest", summary: string, config /* masked */, createdAt?, updatedAt? }`. `summary` is a human line (host/warehouse/database). Ordering is the repository's.

#### 16. `POST /datasources/test-connection`
- Body: `{ kind: "databricks"|"postgres"|"rest"; config: DatasourceConfig; id?: string }`.
- Success: `{ ok:true, message:"Connection successful" }`. Failure (Style A): `{ ok:false, message }` with the connector's error (e.g. `kind must be one of: databricks, postgres, rest`, `baseUrl is required`, `At least one endpoint is required`, driver errors).
- Side effects: none (opens and closes a connection).
- `kind: "file"`: imports every included sheet of `config.files` (each from its upload, `uploadId`, else from the saved original of `id`) into a throwaway database under `<dataDir>/files/uploads/`, removed after (datasources R63). Success: `{ ok:true, message:"Imported <n> tables · <rows> rows" }` (`1 table`, `1 row` in the singular; numbers with `en-US` separators). Failure: the first one, `{ ok:false, message:"<file> · <sheet>: <cause>" }`, or `Add at least one .xlsx or .csv file`, `Include at least one sheet`, `Upload <uploadId> not found — upload the file again`, `<file> is not uploaded — add it again`.

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
- `kind: "file"` (datasources R64, R65): a new datasource gets its id first. The files are imported into `<dataDir>/files/<id>/data.duckdb` (built as `data.duckdb.tmp`, then renamed); then each file carrying `uploadId` moves to `<dataDir>/files/<id>/originals/<fileId>.<ext>`, originals no file names any more are removed, and the document is stored without `uploadId`, with each imported sheet's `rowCount` and `columns`; the inventory snapshot is refreshed. A file with a saved `id` and a new `uploadId` replaces that file and keeps its schema and the table of every sheet whose name is unchanged. A failed import answers `{ ok:false, message:"<file> · <sheet>: <cause>" }` (or a message of 16), keeps the previous database and stores nothing.

#### 19. `DELETE /datasources/:id`
- Success: `{ ok:true, message:"Datasource \"<name>\" deleted" }`. Failure (Style A): `"Datasource <id> not found"`.
- Side effects: deletes the datasource and its cached inventory, and for `kind: "file"` the folder `<dataDir>/files/<id>/` (its originals and `data.duckdb`). **Does not cascade** to datasets that reference it (G6).

#### 20. `GET /datasources/:id/inventory`
- Query: `refresh=true` (force a live walk and replace the snapshot); `cachedOnly=true` (never contact the datasource). `cachedOnly` takes precedence over `refresh` when both are present.
- Responses (all `200`, Style A):
  - default: `{ ok:true, catalogs: CatalogInfo[], fetchedAt: string, cached: boolean }`. Serves the snapshot if present (`cached:true`), else walks live, stores the snapshot and returns `cached:false`.
  - `cachedOnly=true` with a snapshot: `{ ok:true, catalogs, fetchedAt, cached:true }`; **without** a snapshot: `{ ok:true, cached:false }` (no `catalogs`).
  - failure: `{ ok:false, message }` (`"Datasource <id> not found"`, connector error).
- `CatalogInfo` = `{ name, selectable?, schemas: { name, selectable?, tables: { name, selectable?, columns: { name, type, nullable }[] }[] }[] }` normalised to catalog → schema → table for every kind. `selectable === false` means browse-only (no query access); absent means unknown and is treated as accessible.
- A live walk can take minutes on a cold warehouse; there is no progress channel and no server timeout beyond the connector's.

#### 156. `POST /datasources/files/uploads`
- Body: the file's bytes, raw (`Content-Type: application/octet-stream`); header `X-File-Name` the original file name, URI-encoded (`encodeURIComponent`); a folder part is dropped. Streamed to `<dataDir>/files/uploads/<uploadId>/<name>`, counted and hashed on the way; never read by the JSON body parser or held in memory. A body the JSON parser already read answers `400 "Send the file as the raw body (application/octet-stream)"`.
- Response `201`: `{ uploadId: string, file: SourceFile }`: a new `id` (uuid) and `uploadId`, `name`, `format`, `sizeBytes`, `sha256` (hex), `uploadedAt`, `schema` and, for each sheet, the detection's proposal (datasources R56) with its table key (R55); datasources R61.
- Errors (Style B): `413 "File is larger than 200 MB"` (by `Content-Length`, or counted while streaming; the partial file is deleted); `400 ".xls files are not supported — save the workbook as .xlsx"`; `400 "Only .xlsx and .csv files can be imported"` for any other extension; `400 "X-File-Name header is required"`; `400 "X-File-Name must be URI-encoded"`; `400 "<name> could not be read: <cause>"` when DuckDB cannot read the file (the upload is deleted).

#### 157. `POST /datasources/files/preview`
- Body: `{ uploadId?, datasourceId?, fileId?, sheet: string, headerRow?: number, range?: string, excludeLastRow?: boolean, allText?: boolean }`. `uploadId` names an unsaved upload; otherwise `datasourceId` with `fileId` a saved file. Omitted options come from the detection; a `headerRow` without `range` moves the detected range's first row to it; a `range` without `headerRow` puts the header on its first row. A CSV is read whole from its header row (its `range` is checked, not applied).
- Response `200`: `SheetPreview` `{ sheet, headerRow, range, totalRows, columns: { letter, name, type }[], rows: { row, cells }[], warnings }` (datasources R62): `totalRows` the rows in range below the header; `columns` named as the import names them, typed as DuckDB reads them under `allText` (the excluded last row left out); `rows` the first 7 and last 2 sheet rows of the range with their sheet row numbers, cells as text or `null`. A sheet with `no-table` and no option answers no columns and no rows.
- Errors (Style B): `400 "Range must look like A1:H200"`; `400 "The header row must be in the range, above its last row"`; `400 "Sheet \"<name>\" not found"`; `400 "sheet is required"`; `400 "uploadId or datasourceId is required"`; `400 "uploadId must be an upload id"`; `404 "Upload <uploadId> not found — upload the file again"`; `404 "File <fileId> not found"`.

#### 158. `DELETE /datasources/files/uploads/:uploadId`
- Response `204` (also for an upload already gone). Removes `<dataDir>/files/uploads/<uploadId>/`. Errors (Style B): `400 "uploadId must be an upload id"` when `:uploadId` is not a uuid.

### 2.3 Datasets

Controller prefix `/datasets`. Capability: datasets. Datasets are keyed by `name` (upsert), shape `DatasetDoc` in data-model.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 21 | `GET /datasets` | List datasets | yes |
| 22 | `POST /datasets` | Create or replace (upsert by name) a dataset | yes |
| 23 | `DELETE /datasets/:name` | Delete a dataset | yes |

#### 21. `GET /datasets`
- Query: `view=summary` (optional) answers each dataset without its `entities` snapshot and `schemas` notes (`{ name, datasourceId?, datasourceKind?, tables, createdAt?, updatedAt? }`), for pickers over hundreds of datasets (the run form's, the agent editor's and the home's question box dataset picker, ui.md 4.4b, 4.5, 4.1); any other value, or none, answers whole datasets.
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
- Side effects: persists; the metric then feeds the per-turn "governed metrics" context block for sessions whose entities include `entity`.

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

Controller prefix `/agents`. Capability: agents-evals. `:key` is the Mastra registry key (`insights-lead`, `data-readiness-assessor`, `insights-analyst`, `sql-fixer`, `assistant-eval-judge`, `query-explainer`, `result-explorer`, `chief-of-staff`, `bi-analyst`; see [agents.md](agents.md)) **or** the id of a user agent ([data-model.md](data-model.md) section 3.10); the registry is checked first. `:id` is always a user-agent id. The catalogue merges both kinds. Rules: R43-R52, R97-R104 and R106 in [agents-evals](../capabilities/agents-evals/spec.md). The user-agent routes are declared before `GET /agents/:key`.

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
| 103 | `PUT /agents/:key/prompt` | Save a built-in agent's system prompt, the app's job description (an override) | yes |
| 104 | `DELETE /agents/:key/prompt` | Reset a built-in agent's system prompt to the shipped one | yes |

#### 33. `GET /agents`
- Response `200`: `{ agents: AgentSummary[] }` sorted by `name`, built-in and user agents together (so built-in agents sort by persona name).
- `AgentSummary = { key, id, name /* a built-in agent's persona name (agents.md 1.1), a user agent's typed name */, role: string /* the job title: a built-in agent's persona title, a user agent's optional `role`; '' when none */, intro: string /* a built-in agent's first-person persona intro (agents.md 1.1); '' for a user agent */, description, tools: string[] /* sorted tool names; a user agent shows those its effective configuration selects on Elena (agents.md 2.23) */, kind: 'official'|'system'|'user', status: 'builtin'|'draft'|'live', pinned: boolean, owner: 'Official'|'System'|'You', domain: 'data-foundations'|'analysis'|'sql'|'storytelling'|'quality'|'general' /* the Agent Hub section; always present: a built-in agent's fixed domain (agents.md 1.2), a user agent's stored `domain`, else `general` */, hasUnpublishedChanges: boolean, missingDatasets: string[], datasets: string[], starterQuestions: string[], usedInWorkflows: { id: string; name: string }[] /* the workflows whose steps call the agent; as in 34 */ }` (`chatRequirement` was removed 2026-11-12 with the agent Run). The hub reads `usedInWorkflows` with the run history (120) to say whether an agent is busy (ui.md 4.4).
- For a user agent `key` equals `id`, and `name`, `role`, `description`, `datasets`, `starterQuestions` and `tools` come from the Live version when there is one, else the draft. For a built-in agent `status` is `builtin`, `hasUnpublishedChanges` is `false` and `datasets`, `starterQuestions` and `missingDatasets` are empty, except for a built-in agent that declares a dataset for its sessions (none today; the `rfp` agent that did was removed on 2026-11-12, and `GET /agents/rfp` answers `Agent "rfp" not found`, as for the showcase agents below). The four former showcase agents (`benchmarking`, `survey`, `lad-coe`, `strategy`) were removed in 1.23.8: they are not in the registry, so `GET /agents` does not list them and `GET /agents/benchmarking` answers `Agent "benchmarking" not found`; a pin or prompt override saved for one of those keys is ignored. The Data Readiness Agent (`data-readiness`) is removed (2026-11-26, [workflows](../capabilities/workflows/spec.md) R50): `GET /agents/data-readiness` answers `Agent "data-readiness" not found` and a pin or prompt override saved for it is ignored. The **Insights Analyst** agent (`insights-analyst`; [agents.md](agents.md) 2.11) has no dataset of its own, like Elena: empty `datasets`, `missingDatasets` and `starterQuestions`. `kind` is `official` for `insights-analyst`, `insights-lead` and `data-readiness-assessor` (Dana, the Data Readiness Assessor, `domain` `data-foundations`, [agents.md](agents.md) 2.24; no dataset of her own: empty `datasets`, `missingDatasets` and `starterQuestions`), and `system` for the other built-in agents. Emily (`assistant`), Ryan (`visualization`) and Rachel (`sql-verifier`) are removed (2026-11-26, ADR-0059): they are not in the registry, `GET /agents` does not list them, `GET /agents/assistant`, `GET /agents/visualization` and `GET /agents/sql-verifier` answer `404 "Agent \"<key>\" not found"`, and a pin or prompt override saved for one of them is ignored. **A user agent runs on Elena** (agents.md 2.23): its `tools` are those its selection gives her.

#### 34. `GET /agents/:key`
- Response `200`: `AgentDetail = AgentSummary & { draft?: AgentConfig; live?: AgentConfig /* user agents only; shapes in data-model 3.10 */; instructions: string /* prompt flattened to text */; toolDetails: { name, description, inputs: string[] /* top-level input param names */ }[]; memory: { storage: string|null; lastMessages: number|false|null; semanticRecall: boolean; workingMemory: boolean; generateTitle: boolean } | null; model: { id: string; provider: string } | null /* null when no LLM settings saved */; toolLinks?: { name: string; status: 'always-on'|'linked'|'not-linked'; linkedVia: { instructions: boolean; skills: string[] /* skill names, sorted */ } }[] /* user agents only: every library tool sorted by name, from the Live version, else the draft */; llm: { provider: string | null; providerName: string | null; model: string | null; apiKeyConfigured: boolean; maxOutputTokens: number | null; reasoningEffort: string | null } /* the effective LLM settings the agent resolves to; never the key; every field null/false when no LLM is saved */; prompt?: { editable: string /* as served: the override, else the shipped text */; shipped: string; modified: boolean; builtInChanged: boolean /* modified and the shipped text's hash differs from baseHash */; linksAllowed: boolean /* true for insights-analyst only; false for every other agent */; updatedAt: string | null /* the override's */ } /* built-in agents only */; workflow?: AgentWorkflow /* workflow-backed built-in agents only (today insights-analyst); no screen shows it since the agent page's Graph tab was removed on 2026-11-15 */; usedInWorkflows: { id: string; name: string }[] /* always present */; conversation?: { workflowId: string } /* since 2026-11-25: set for a built-in conversational agent (today `insights-lead`, `workflowId` `agent:insights-lead`, ADR-0058, and `data-readiness-assessor`, `workflowId` `agent:data-readiness-assessor`, ADR-0060); the agent page shows Ask <name> when it is set (agents-evals R115, R120) */ }`.
- `usedInWorkflows` lists the workflows whose steps call the agent ([agents.md](agents.md) 5.12): `insights-analyst` and `chief-of-staff` (Avery) → `[{ id: 'orchestrated-answer-michael', name: 'Answer a Business Question (Avery + Michael)' }]` (`insights-analyst` is its primary agent and Michael, agents.md 5.23); every other agent (Elena, every user agent, the other System agents) → `[]`. Agents are a library, not workflows (ADR-0042).
- `AgentWorkflow = { id: string; steps: { id: string; title: string; kind: 'code' | 'agent'; summary: string; input: string[]; output: string[]; agent?: { key: string; name: string; role: string; tools: string[]; maxSteps: number } /* agent steps only; `key` is the registry key of the step's own agent, `name` and `role` its persona (agents.md 1.1) */; exits: { label: string; outcome: 'fails' | 'stops' }[] }[] }`. The steps are in catalogue order (how they connect is 117's `edges`), and it is built from the workflow's step catalogue ([agents.md](agents.md) 5.11): for Avery + Michael, `id` is `orchestrated-answer-michael` and its one step is Orchestrate (agent `chief-of-staff`, `Avery`, `role` `Chief of Staff`, with her four tools `answer_from_data`, `build_dashboard`, `export_conversation` and `ask_clarification` and `maxSteps` 16); its `exits` are `the model returns an error` (`fails`), `you stop it` (`stops`) and `if it asks you a question` (`waits`). An exit's `label` is the rest of the sentence the app writes about it (`Fails if …`, `Ends if …`, `Waits …`; [ui.md](ui.md) 4.4b). It is read-only and never stored ([agents-evals](../capabilities/agents-evals/spec.md) R108).
- For a built-in agent, `instructions` is the prompt as served, so it reflects an override (ADR-0026), and `prompt` carries the editable text, the shipped text and the override state ([data-model.md](data-model.md) 3.10.3). For Michael and Elena, `editable` and `shipped` exclude the generated `## Tools` section ([agents.md](agents.md) 2.11, 2.23).
- A user agent runs on Elena, so its `instructions`, `toolDetails` and `model` describe Elena, with the prompt and tools that the agent's tool selection gives her (Live version, else draft; [agents.md](agents.md) 2.23), and its `memory` is `null` (she has none). Its own instructions are in `draft` and `live`, with links as written (R81). `toolLinks` (user agents) says why each library tool is there: `always-on` for `describe_entity`, `explore_result`, `list_entities` and `run_readonly_sql`, `linked` when the instructions or a linked skill's body link it, else `not-linked`; the tools of its skills come from the Live copies, else the current skills. `llm.model` is the agent's own `model` override when a user agent sets one, else the configured model; `llm.reasoningEffort` is the agent's override, else the configured one. `llm` never carries the API key, only whether one is saved ([../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md) R87-R89).
- Errors (Style B): `404 "Agent \"<key>\" not found"`. `:key` is resolved as a registry key first, then as a user-agent id.

#### 34a. `GET /agents/:key/skills`
- Response `200`: `AgentSkillsView`. A user agent runs on Elena, so it answers with her skills except `dashboard-building` and `conversation-export` (its dashboard and export gates are always closed, ADR-0059; 34b answers `404 "Agent \"<key>\" has no skill \"<name>\""` for them), followed by its own in-app skills, sorted by name among themselves (level `in-app`, loading `on-demand`): the `liveSkills` copies when it has a Live version, else the current skills its draft names. Their `files` are `SKILL.md` (rendered as in [agents.md](agents.md) 7.3) and the reference files, and 34b reads them. The built-in skills ship with the app (there are no user or project skills; ADR-0021); how they load and are checked is in [agents.md](agents.md) 7.3. The response shows what the backend loaded when it started.
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
- Response `200`: `{ sets: AgentEvalSet[] }`: the sets whose agent is `:key` (a set's `agentKey`, required; [agents.md](agents.md) 8.1). Only the agents of agents-evals R10 have sets; any other key returns `{ sets: [] }` (no 404). `AgentEvalSet = { id, name, description, cases: { id, question, intent, checks: { id, name, description }[] }[] }`.

#### 36. `POST /agents/:key/evals/run`
- Body: `{ datasourceId: string; caseIds?: string[] }`. `caseIds` omitted = all questions.
- Success: `{ ok:true, message:"Eval run started", jobId }`. Returns immediately; the run is long-running (see [3.3](#33-eval-runs)).
- Failures (Style A, `ok:false`): `"Agent \"<key>\" has no evals to run"` (an agent with no sets: none of `insights-lead`, `data-readiness-assessor`, `insights-analyst`, `query-explainer`); `"An eval run is already in progress for this agent"` (also returns the running `jobId`); `"Pick a datasource to run against"`; `"That datasource has no datasets — create one in Datasets before running evals"`; `"Pick at least one question to run"`; fixture/dataset coverage errors (the datasets bound to the datasource must expose the entities the selected questions need).
- Side effects: persists an initial run record, which also records the run's `setId`, `provider`, `model` and `source: 'app'` (data-model 3.8, agents-evals R112); spawns the run, passing the run's `jobId` as the `eval-run-id` marker of every call (ADR-0054; one throwaway session is created for the run to host visual tools and deleted afterwards).

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
- Body: `{ name: string; role?: string /* job title, trimmed, at most 64 characters, omitted when blank */; domain?: 'data-foundations'|'analysis'|'sql'|'storytelling'|'quality'|'general' /* stored when one of the first five; `general`, an unknown value or none is stored as no field, with no error */; description?: string; instructions?: string /* may link skills and tools: [[skill:<name>]], [[tool:<name>]] */; datasets?: string[]; starterQuestions?: string[]; model?: string; reasoningEffort?: 'low'|'medium'|'high' }`. Limits and normalisation: R43. The agent's `tools` and `skills` are **derived from the links in `instructions`** and stored ([data-model.md](data-model.md) 3.10); a `tools` or `skills` field in the body is ignored.
- Success: `{ ok:true, message:"Agent \"<name>\" saved as draft", agent: AgentSummary }`. The agent is a draft, not pinned.
- Failures (Style A): `"Agent name is required"`; `"An agent named \"<name>\" already exists"`; `"Unknown skill \"<name>\""` for a `[[skill:<name>]]` that is neither a built-in on-demand skill nor one of the caller's in-app skills (a built-in on-demand skill link, such as `curated-knowledge`, is accepted and not counted toward the 10-skill limit); `"Unknown tool \"<name>\""` for a `[[tool:<name>]]` that is not a library tool (`ask_clarification`, `describe_entity`, `explore_result`, `list_entities`, `run_readonly_sql`, `sample_rows`; the retired `create_visual`, `update_visual`, `show_in_panel` and `update_workflow` are still accepted and read as plain mentions, agents.md 2.23); `"An agent can have at most 10 skills"`. Checked after the name checks, in this order: unknown skill, the 10-skill limit on the distinct linked skills, then unknown tool.

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
  setId?: string | null;         // the eval set of the questions; null when they span several sets; absent on old runs
  provider?: string; model?: string;   // what the run ran on; absent on old runs
  source?: 'app' | 'cli';        // absent = 'app'
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
- Body: `{ prompt: string }`, trimmed; the checks below run on the trimmed text. Saves the override (ADR-0026); it applies to the next call of every session, user agent and eval run.
- Success: `{ ok:true, message:"Job description of \"<name>\" saved", agent: AgentDetail }` (`<name>` is the persona name, 33).
- Failures (Style A), the first that applies: `"Agent \"<key>\" not found"`; `"Only built-in agents have a shared system prompt; edit a user agent's instructions instead"` (`:key` is a user-agent id); `"The prompt is empty"`; `"The prompt is at most 20,000 characters"`; for the `insights-analyst` agent only (agents.md 2.11): `"The Insights Analyst prompt must start with \"You are Questions to Insights\""`, `"Only Insights Analyst's own skills can be linked here: this prompt is shared by every user"` (any `[[skill:…]]` other than `curated-knowledge`, `sql-analysis` and `result-validation`), `"Unknown tool \"<name>\""` (a `[[tool:…]]` that is not one of its tools: `list_entities`, `describe_entity`, `sample_rows`, `run_readonly_sql`, `explore_result`, `ask_clarification`); for a System agent only: `"This agent's prompt can't contain links"` (any `[[…]]`).
- Declared before the `GET /agents/:key` catch-alls.

#### 104. `DELETE /agents/:key/prompt`
- Success: `{ ok:true, message:"Job description of \"<name>\" reset", agent: AgentDetail }`, also when there was no override.
- Failures (Style A): `"Agent \"<key>\" not found"`; the user-agent refusal of 103.

### 2.6.2 Workflows

Controller prefix `/workflows`. Capability: [workflows](../capabilities/workflows/spec.md) (R1-R4, R11, R14-R18). Workflows are defined in code (ADR-0040), and there is no write route. The catalogue holds the one workflow of 116 (since 2026-11-23 `orchestrated-answer-michael` is the only Answer a Business Question: `answer-business-question` and `orchestrated-answer` were removed, workflows R48; `recreate-dashboard`, `map-dashboard-data`, `review-website`, `consumption-gap-analysis` and `data-readiness-assessment` were removed on 2026-11-26, workflows R49, R50); the ids `answer-business-question`, `orchestrated-answer`, `agent:<registry key>` (except `agent:insights-lead`, below), `agent:<user-agent id>`, `seq-text-demo` and `deep-analysis` are removed and answer the not-found error of 117-119. **Since 2026-11-25 (ADR-0058) `agent:insights-lead` is accepted by 117-119:** a conversation with Elena, the Insights Lead ([agents.md](agents.md) 2.23), is a run of that id on the run host, outside any workflow. It is a *conversational binding* ([agents.md](agents.md) 5.14): 117 resolves it, 118 and 119 run it, and 116 **never lists it** (the Workflows catalogue is unchanged). Its conversation list is 168 (section 2.6.6). A workflow with input fields can be run once (118) or run streamed (119) (ADR-0041); every run is stored (since 1.23.14, [data-model.md](data-model.md) 3.16) and read back through section 2.6.3. `:id` is a workflow id (`orchestrated-answer-michael`; [agents.md](agents.md) 5.12).

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
    id: string;                       // 'orchestrated-answer-michael'
    name: string;
    description: string;
    kind: 'code' | 'agent';           // always 'code' since 2026-11-12 (the one-step 'agent' kind is no longer produced)
    owner: 'Official' | 'You';        // always 'Official' since 2026-11-12 ('You' was a user agent's workflow)
    category: { id: 'data-analytics' | 'data-engineering' | 'dashboards' | 'software-development'; name: string };  // since 2026-11-23: the Workflows section it is listed under (workflows R5), e.g. { id: 'data-analytics', name: 'Data Analytics' }; declared with the workflow in code (WORKFLOW_CATEGORIES)
    agents: { key: string; name: string; role: string }[];   // every agent its steps run, in step order, each once, with its persona's role (job title, `''` without one; since 2026-11-17); `orchestrated-answer-michael`: chief-of-staff (Avery)
    stepCount: number;
    bar: 'steps' | 'agent';           // what drove a chat's workflow bar (kept for the stored chats): these steps, or the agent's own phases
    trigger: 'run';                   // every workflow runs once on a typed input (118, 119); since 1.23.22 there is no 'chat' trigger
    input: WorkflowInputField[];      // the Start (input) node: the typed input a run takes, in form order (every workflow has one since 1.23.12)
    datasets: string[];               // the datasets the workflow's agent declares; [] when the run picks them (Answer a Business Question (Avery + Michael))
    missingDatasets: string[];        // named datasets that don't exist (as AgentSummary.missingDatasets)
    starterQuestions: string[];       // the agent's, as AgentSummary.starterQuestions
    conversational?: true;            // since 2026-11-25: set on a conversational binding (agents.md 5.14), i.e. on `orchestrated-answer-michael` here and on `agent:insights-lead` and `agent:data-readiness-assessor` in 117; the run chat reads it to draw the conversation (Message box, Archive, Export). Absent on every other workflow
  };
  type WorkflowInputField = {
    name: string;                     // the key in 118's and 119's `input`
    label: string;
    type: 'text' | 'textarea' | 'number'
        | 'boolean'                   // a checkbox; absent means false (or `default`)
        | 'datasets'                  // one or more dataset names
        | 'image'                     // one PNG, JPEG or WebP image of at most 5 MB, as a base64 `data:` URL (118's rules); a stored run holds the file's path instead
        | 'images'                    // up to `max` PNG, JPEG or WebP images (4), each at most 5 MB, as an array of base64 `data:` URLs (118's rules); a stored run holds the files' paths instead
        | 'artifact';                 // the id of one stored artifact (144)
    required: boolean;
    placeholder?: string;
    help?: string;                    // one line under the control
    default?: string | number | boolean;  // the value of a field that is missing or empty
    datasourceKinds?: ('postgres' | 'databricks' | 'rest')[];  // 'datasets': only datasets bound to these kinds
    artifactKinds?: 'dashboard'[];    // 'artifact': only artifacts of these kinds
    requiredWithout?: string;         // another field's name: this field is required only while that one has no value (118's rules)
    hidden?: boolean;                 // set by the app, never rendered as a control
    maxLength?: number;               // 'text' / 'textarea': the most characters of the trimmed text (118's rules)
    min?: number;                     // 'number': the smallest value
    max?: number;                     // 'number': the largest value; 'images': the most images (4)
    usedBy: string[];                 // the ids of the steps that read the field straight from the input (a step whose `input` names it while no earlier step's `output` does), in step order; [] when none does
  };
  ```
- **The input node covers every step.** Every field a step's input schema requires is a field of the workflow's `input` or an output of an earlier step (for a workflow with edges, a step on every path from Start to it, 117), with a compatible type; the catalogue refuses (throws when it loads) a workflow that breaks this, and a unit test checks every catalogued workflow (`checkWorkflowContract`, `backend/src/mastra/workflows/workflow-contract.ts`; [agents.md](agents.md) 5.12). A rule field (`maxLength`, `min`, `max`) is sent only where the field has one.
- Values:

  | id | name | kind | agents | stepCount | bar | datasets |
  |---|---|---|---|---|---|---|
  | `orchestrated-answer-michael` | `Answer a Business Question (Avery + Michael)` | code | `insights-analyst` (the run host's agent; the step's own agent is Avery, `chief-of-staff`, with Michael and Clara under her, agents.md 5.23) | 1 | steps | none |

- Description, starter questions and missing datasets come from the agent's catalogue entry (33), except the description, which is the workflow's own; v2's starter questions are empty, as in its AgentSummary.
- **Trigger and input:** all are run workflows: `trigger: 'run'` and an `input` they run on (118, 119; [workflows](../capabilities/workflows/spec.md) R14):

  | id | `input` (in order) |
  |---|---|
  | `orchestrated-answer-michael` | two fields: `question` (`Question`, textarea, required, placeholder `Ask a question about your data`, `maxLength` 4000, `usedBy` `['orchestrate']`) and `datasets` (`Datasets`, datasets, required, `usedBy` `['orchestrate']`); no images and no visual field (Ryan is not on its team; agents.md 5.23). The `images`, `buildVisual` and `approveSteps` fields of the removed `answer-business-question` are gone (workflows R48) |

- **Order:** `orchestrated-answer-michael` alone. No agent (System, Official or user) is listed.

#### 117. `GET /workflows/:id`
- Response `200`: `WorkflowDetail = Omit<WorkflowSummary, 'agents'> & { agents: WorkflowAgentDetail[]; steps: WorkflowDetailStep[]; edges: WorkflowEdge[]; contractHash: string }`, with `AgentWorkflow` exactly as 34 defines it. A `WorkflowDetail` is structurally an `AgentWorkflow` (it has `id` and `steps`). `:id` may also be `agent:insights-lead` (since 2026-11-25, ADR-0058): it answers Elena's definition (`conversational: true`, one step `answer`, title `Answer`, agent `insights-lead`, edges `start → answer → end`; input `question` and `datasets`), which 116 does not list.
  ```ts
  type WorkflowAgentDetail = {
    key: string; name: string; role: string;  // as 116's agents entry, same order (step order, each once)
    model: string | null;             // `${llm.provider}/${llm.model}` of 34's AgentDetail.llm; for orchestrated-answer-michael's Orchestrate, `${llm.provider}/claude-opus-5-5` when the saved model is served as a Claude model (agents.md 1.3); null when no LLM is set (never the environment's fallback)
    systemPrompt: string;             // 34's AgentDetail.instructions, at most 20 000 characters; each run adds its own context
    systemPromptTruncated?: true;     // the prompt was longer than 20 000 characters and was shortened
    toolDetails: { name: string; description: string; inputs: string[] }[];   // 34's AgentDetail.toolDetails, as is (sorted by name; inputs: top-level input param names)
  };
  type WorkflowDetailStep = Omit<AgentWorkflowStep, 'agent'> & {
    agent?: { key: string; name: string; role: string; tools: string[]; maxSteps: number;   // `key`: the agent's registry key or user-agent id; `name`, `role`: its persona (agents.md 1.1); `tools`, `maxSteps`: the step's own agent's (Avery's own four tools and 16 steps on Orchestrate, never the workflow's primary agent's)
      team?: { tool: string; key: string; name: string; role: string }[] };   // an orchestrator only (Avery, agents.md 2.21): each of her tools that calls an agent, with that agent's key and persona, in her tools' order; absent on every other step
    inputSchema: JsonSchema;          // the step's declared input (agents.md 5.12); `input` is its property names, in order
    outputSchema: JsonSchema;         // the step's declared output; `output` is its property names, in order
  };
  type WorkflowEdge = {
    from: string;                     // a step id, or 'start'
    to: string;                       // a step id, or 'end'
    kind: 'next' | 'branch' | 'loop'; // the plain flow; one path a condition picks; the way back to an earlier step
    label?: string;                   // what the canvas writes on the edge
    note?: string;                    // what happens on this path, in business words (workflows R42): under the label; every labelled edge has one; not part of the contract hash
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
- `edges`: how the steps connect, from `start` to `end`: the flow the canvas draws ([ui.md](ui.md) 4.4b). `steps` stays a list in catalogue order; the edges carry the branches and loops. `orchestrated-answer-michael` has two `next` edges, `start` → `orchestrate` and `orchestrate` → `end`, with no label ([agents.md](agents.md) 5.23); the other workflows list theirs in their own sections (5.13 to 5.20). The thirteen edges of the removed `answer-business-question` (the `Reference images` and `Build a visual` branches, the `Retry once` loop) are gone with it.

  A step on a `loop` edge's way back (from its `to` along `next` edges to its `from`) can run more than once in a run; its step events and stored steps carry `attempt` (3.6).
- `contractHash`: the workflow's data contract as 12 hex characters: the first 12 of the sha256 of the canonical JSON (keys sorted at every level) of `{ input: [{ name, type, required }] (each input field, in order), steps: [{ id, inputSchema, outputSchema }] (in order), edges: [{ from, to, kind }] (in order; only for a workflow with edges) }`. It changes when any step schema, step id, edge (its ends or kind) or input field's name, type or `required` changes, and only then (not with a label, help text or the workflow's name). Each run stores the hash it started with (121 `contractHash`). For `orchestrated-answer-michael`, Orchestrate's `inputSchema` has `question` (`type: 'string'`) and `datasets` (an array of strings), both required, and its `outputSchema` has `answer`. The input is the shape the removed workflow's `answerBusinessQuestionInputSchema` had (now `questionInputSchema`), so the rename changed no hash.
- Each agent step's `agent` carries its own agent's `key` (a code workflow's `stepAgents` maps a step to a registry key, `workflowAgentKeys` and `stepAgentKey`): `chief-of-staff` for Orchestrate. `agents` is 116's list (every agent its steps run, so one for `orchestrated-answer-michael`) with each agent's `model`, `systemPrompt` (its job description) and `toolDetails` read from 34 (none for an agent the workflow only calls without tools; the workflow page's tool dialog, [ui.md](ui.md) 4.4b and the node dialog's Job description).
- For `orchestrated-answer-michael`, `steps` is its one step, Orchestrate (an agent step, Avery `chief-of-staff`, with its schemas) and `edges` the two `next` edges Start to Orchestrate to End ([agents.md](agents.md) 5.23): the detail of each catalogue workflow shows its own steps (`codeWorkflowView`).
- Errors (Style B): `404 "Workflow \"<id>\" not found"` for any id 116 does not list: unknown, a removed one (`agent:assistant`, `agent:data-readiness`, `agent:<user-agent id>`, `seq-text-demo`, `deep-analysis`), a System agent (`agent:sql-fixer`), or the workflow's own agent (`agent:insights-analyst`).

#### 118. `POST /workflows/:id/runs`
- Body: `{ input: Record<string, string | number | boolean | string[]>, context?: { fromRunId: string } }` (`context.fromRunId`, the follow-up context, is sent since 2026-11-20 only by the app's clarification options and **Run again with my answer**; the UI has no free follow-up). Runs the workflow once on `input` and answers when the run ends (no streaming). Capability: [workflows](../capabilities/workflows/spec.md) R11, R14; engine: [agents.md](agents.md) 5.14. The UI uses 119. **A message to Avery** (`orchestrated-answer-michael`, workflows R45): `context.fromRunId` names any earlier run of the conversation (the UI sends its last); the new run joins that run's conversation (`conversationId`, 3.6), and Avery reads the conversation so far as the host's transcript: the questions and answers of the conversation's runs in order, at most the last 20 turns (`CONVERSATION_TURNS`), then the new question. It is refused `409 "This conversation is archived"` (Style B, before anything is stored) when the earlier run is archived (159).
- `:id` `agent:insights-lead` (since 2026-11-25, ADR-0058) runs one message of a conversation with Elena, with the same body and refusals; her `context.fromRunId` joins the conversation as Avery's does.
- `:id` `agent:data-readiness-assessor` (since 2026-11-26, ADR-0060) runs one message of a conversation with Dana, the Data Readiness Assessor, in the same way (same body, refusals, `context.fromRunId`, suspend and resume); the run's tool `assess_readiness` stores one `readiness_assessments` document ([data-model.md](data-model.md) 3.21) and adds no route.
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
  Field errors (`field` = the field's name): `"<label> is required"` for a required field that is missing, `""` or whitespace-only (`"Question is required"`); `"Select at least one dataset"` for a required `datasets` field with none; `"<label> must be a number"`; `"<label> must be at least <min>"` / `"<label> must be at most <max>"` for a number outside `min` / `max`; `"<label> must be at most <maxLength> characters"` for a text whose trimmed length is over `maxLength` (`"Question must be at most 4000 characters"`); `"<label> must be true or false"`; `"Dataset \"<name>\" not found"`; `"Dataset \"<name>\" is not a <kinds> dataset"` (the field's `datasourceKinds` named, e.g. `PostgreSQL or Databricks`). Non-field errors (`field: null`): `"Run \"<id>\" not found"` for a `context.fromRunId` that names no stored run, and `"Run \"<id>\" has no answer to continue from"` for a stored run without a question and answer, listed after the field errors; `context.askStep`, on any request, answers `"Workflow \"<id>\" can't ask one agent"` (since 2026-11-23, workflows R40); `"Workflow \"<id>\" can't run on an input"` alone, for a workflow with no input fields. Example: `{ input: { question: "  ", datasets: [] } }` answers `{ statusCode: 400, error: "Bad Request", message: "Question is required", errors: [{ field: "question", message: "Question is required" }, { field: "datasets", message: "Select at least one dataset" }] }`. `404 "Workflow \"<id>\" not found"` for any id 116 does not list (plain Style B, no `errors`).
  An `artifact` field: `"Artifact \"<id>\" not found"` when no stored artifact of the field's `artifactKinds` has that id.
  An `image` field: `"<label> must be a PNG, JPEG or WebP image"` when the value is not a base64 `data:` URL of one of those types or its bytes do not start as a file of that type does, and `"<label> must be at most 5 MB"` over 5 MB (5 × 1024 × 1024 bytes, decoded).
  An `images` field (a list of `data:` URLs; an optional one that is missing or empty is left out): `"<label> must be PNG, JPEG or WebP images"` when any value is not a base64 `data:` URL of one of those types or its bytes do not start as a file of that type does, `"<label> must be at most 5 MB each"` when any is over 5 MB (decoded), and `"<label> must be at most 4 images"` over the field's `max` (checked first); at most one error per field.
  Two fields that name each other in `requiredWithout`: when neither has a value, one error on the first of the two in field order, `"<label> or <other label> is required"` (no catalogued workflow uses the rule since the two dashboard workflows were split); a value that was refused for another reason is not also reported as missing. When both have a value, an `image` field's value is dropped: the run uses the other one.
- **An image is not stored in the run.** For each `image` field the checked `data:` URL is taken out: the stored run's `input` holds the path `inputs/<field name>.<png|jpg|webp>` of the file in the run's workspace ([agents.md](agents.md) 7.1), and every response carries that path, never the image. With `context.fromRunId` naming a run of the same workflow, an `image` value equal to that run's stored path stands for that run's image (a follow-up runs on the same image); any other non-image value is refused as above. The same holds for an `images` field: each checked `data:` URL is taken out and the stored `input.images` holds the paths `inputs/images/<n>.<png|jpg|webp>` (`n` from 1, in the order sent), one file each in the run's workspace; with `context.fromRunId` naming a run of the same workflow, a value equal to a path of that run's stored `input.images` stands for that file (a follow-up carries the earlier images, and may add new ones within the 4 allowed). 151 serves one stored image. Since 2026-11-26 no built-in workflow declares an `image` or `images` field (the fields of Dashboard Image to Artifact and Map a Dashboard to Data went with them, workflows R49); runs stored with images keep them.
- A refused run is never stored and no step runs.
- Side effects: the run is stored in `workflow_runs` ([data-model.md](data-model.md) 3.16) as `running` before it starts and updated when it ends, with its steps, output or error; an engine failure is stored as `failed` and answered as the error it is. A run is 119's, without the stream. It runs inline: it takes no slot and is never queued (ADR-0057).

#### 119. `POST /workflows/:id/runs/stream`
- Body: as 118. Runs the workflow once on `input`, streamed. Capability: [workflows](../capabilities/workflows/spec.md) R14-R17.
- `orchestrated-answer-michael` streams its one Orchestrate step: Avery's tool calls (`tool` / `tool-result` events, one per call to Michael or Clara) and the answer; when she asks the user a question the run is `suspended` with `waitingFor` (`stepId` `orchestrate`) and is answered through 138 (agents.md 5.23). A message to Avery (118's `context.fromRunId`) is a run of this same endpoint. `agent:insights-lead` streams its one Answer step (`answer`): Elena's tool calls and the answer, or the run `suspended` with `waitingFor.stepId` `answer` when she asks the user (answered through 138); her message is a run of this endpoint too.
- Refusals: 118's, the same body (`message` and `errors[]`), answered as plain JSON (`application/json`) with their real status (Style B) **before** the stream starts: no SSE frame is sent, no run is stored, no step runs. **Never `429` for the cap** (ADR-0057): a run is not refused for the number of runs in progress, it waits in the queue. `WORKFLOW_MAX_LIVE_RUNS` (default 8, the whole number of at least 1 in the environment variable, read once at start-up) bounds the runs that are `running` at once. A run of 119 holds a slot from its start until it ends, fails, is stopped or waits for the user; a resume (138) takes a slot as today and is never queued; a run waiting for the user, a run of 118 (inline, no slot, never queued) and a draft run (R12) hold none. The check and the slot's taking are one step: of two requests arriving together for the last slot, one starts and the other is queued. A follow-up run (`context`) is queued the same way.
- Response `200`, SSE (section 3.6), each frame with its `seq`. **The run is detached from the connection** (ADR-0048): it runs on the server, its events logged in memory; this response only follows it. Closing the connection stops the following, never the run: 149 follows it again, and Stop is 150. The first frame is `run`. When no slot is free a `{type:'queued'}` event follows and the stream waits; when a slot frees, the **oldest queued run (by `queuedAt`)** starts and the normal `step` events follow. The run keeps its id and its `conversationId` while it waits.
- **Queue** (ADR-0057): the run is inserted `queued` before the `run` frame, and its input images, if any, are written to `workspaces/session-run-<id>/inputs/…` at that moment. When it is dispatched it is **re-prepared from its stored doc** (`workflowId`, `input` with its own image paths read back from the workspace, `context`), so a follow-up gets a fresh transcript; when that re-prepare refuses (the dataset or the workflow is gone), the run ends `failed` with the refusal's message. A run that starts is stored `running`, `attempts` one higher and `startedAt` set again.
- Side effects: the run is stored in `workflow_runs` ([data-model.md](data-model.md) 3.16) as `queued` before the `run` event is sent, then `running` when it starts (the first start with `attempts: 1`), its `steps` updated at each step change while it runs, and updated when it ends (`success`, `failed` or `stopped`, a stop included) or waits for the user (`suspended`, with `waitingFor`; answered through 138, ADR-0043); a run that throws while it ends is stored `failed` with that error. **No-progress watchdog** (ADR-0048 amendment): a turn that reports no event at all (step, tool, text or reasoning delta, progress, panel item) for 15 minutes, or the minutes above 0 in the environment variable `WORKFLOW_RUN_IDLE_MINUTES` (read once at start-up; `0` turns it off), has its work aborted and is stored `failed` with the error `The run made no progress for <n> minutes and was stopped`, its running step failed with the same error, any partial answer kept as a stopped run keeps it, its host released; the stream ends with `error { content }` carrying that error. Work that has not unwound 10 seconds after that abort is ended without it: the run is stored `failed` as said, with its steps as last tracked. A run waiting for the user is never timed, and neither is a `queued` run: the watchdog times only running time and starts when the run starts. The same watchdog times 118, 138 and the draft runs (R12). A run creates the run host `run-<run id>` (in memory, never listed) and its workspace `workspaces/session-run-<run id>/` (a session workspace's layout, [data-model.md](data-model.md) 4.1); after the turn the host's memory thread is deleted and the host leaves memory (a suspended run's host stays in memory until it is resumed and ends, or expires). The workspace stays with the stored run, so its files download through 123-127, until the run is deleted (122).

### 2.6.3 Workflow runs

Controller prefix `/workflow-runs`. Capability: [workflows](../capabilities/workflows/spec.md) (R18-R20, R25) and [visuals](../capabilities/visuals/spec.md) (130-134). The stored runs of 118 and 119 ([data-model.md](data-model.md) 3.16): the history, one run, its deletion, the files of its workspace, and the chats with its agent steps (136, 137). The file routes are served by the same services as a session's (9, 14, 105-107), given the run's **run-backed host**: a `SessionDoc` shaped from the stored run (id `run-<id>`, workspace `session-run-<id>`, its agent binding, panel items, visuals, and its question and answer as the transcript), never held or listed. `:id` is a run id (a uuid). Style B throughout.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 120 | `GET /workflow-runs` | The run history, newest first | no |
| 121 | `GET /workflow-runs/:id` | One stored run | yes |
| 122 | `DELETE /workflow-runs/:id` | Delete a run with its workspace | no |
| 159 | `POST /workflow-runs/:id/archive` | Archive the run's conversation with Avery or Elena: hidden from the history, read-only | yes |
| 160 | `POST /workflow-runs/:id/unarchive` | Bring an archived conversation back | yes |
| 123 | `GET /workflow-runs/:id/visualizations/:vid` | Load a run's visual (document + metadata) | no |
| 124 | `GET /workflow-runs/:id/visualizations/:vid/download` | A run's visual as a zip | no |
| 125 | `GET /workflow-runs/:id/panel-items/:itemId/file` | Read the text of a run's file panel item | yes |
| 126 | `GET /workflow-runs/:id/panel-items/:itemId/download` | Download a run's file, document or table panel item | yes |
| 127 | `GET /workflow-runs/:id/rfp-packages/:rfpId/download` | Download a run's RFP package (Removed 2026-11-12) | — |
| 128 | `POST /workflow-runs/:id/answer/feedback` | Thumbs up/down on a run's answer | yes |
| 129 | `POST /agents/:id/draft-runs/stream` | Try it: run a user agent's saved draft once on Elena's engine, streamed (SSE), not stored; it can wait for the user (plan R12; ADR-0059) | yes |
| 169 | `POST /agents/:id/draft-runs/:runId/resume/stream` | Answer a waiting Try it draft and continue it, streamed (SSE), not stored (ADR-0059) | yes |
| 130 | `POST /workflow-runs/:id/visualizations` | Generate a visual from the run's answer (Removed 2026-11-26) | — |
| 131 | `POST /workflow-runs/:id/visualizations/:vid/tailor` | Tailor a run's visual from an instruction (Removed 2026-11-26) | — |
| 132 | `POST /workflow-runs/:id/visualizations/:vid/revert` | Move a run's visual to an earlier version | yes |
| 133 | `POST /workflow-runs/:id/visualizations/:vid/refresh` | Re-run the SQL behind a run's visual | yes |
| 134 | `POST /workflow-runs/:id/visualizations/:vid/repair` | Repair a run's failing visual once (Removed 2026-11-26) | — |
| 136 | `GET /workflow-runs/:id/node-chats/:stepId` | A step's node chat in a run: its messages | yes |
| 137 | `POST /workflow-runs/:id/node-chats/:stepId/messages/stream` | Chat with a step's agent about the run's data, streamed (SSE) | yes |
| 138 | `POST /workflow-runs/:id/resume/stream` | Answer a run that waits for the user and continue the same run, streamed (SSE) | yes |
| 139 | `POST /workflow-runs/:id/answer/evidence` | Build the query evidence of an answer stored before it, and size the tables its queries read | yes |
| 140 | `POST /workflow-runs/:id/answer/queries/:index/explanation` | Explain one of the answer's queries step by step (cached with the answer) | yes |
| 141 | `POST /workflow-runs/:id/answer/queries/:index/stage-counts` | Count the rows after each step of an explained query, checked | yes |
| 161 | `POST /workflow-runs/:id/answer/queries/:index/steps/:step/preview` | The first rows one step of an explained query leaves | yes |
| 142 | `POST /workflow-runs/:id/answer/queries/:index/rerun` | Run one of the answer's queries again; nothing stored | yes |
| 143 | `GET /workflow-runs/:id/answer/queries/:index/csv` | One query's rows as CSV, up to 50,000 | yes |
| 152 | `POST /workflow-runs/:id/answer/queries/:index/page` | One page of one of the answer's queries, filtered and sorted; nothing stored | no |
| 153 | `POST /workflow-runs/:id/answer/queries/:index/interpret-filter` | The user's words read as a view (filters, sort, page) of one of the answer's queries; nothing stored | no |
| 149 | `GET /workflow-runs/:id/events/stream` | Follow a run that runs on the server again: its events so far, then live (SSE) | yes |
| 150 | `POST /workflow-runs/:id/stop` | Stop a run | yes |
| 151 | `GET /workflow-runs/:id/input-image` | One image of the run's input, by its stored path | yes |

#### 120. `GET /workflow-runs`
- Query: `workflowId` (optional): only that workflow's runs. `archived` (optional): `true` lists only the runs of archived conversations (159); anything else, or absent, lists only the runs that are not archived (the history, the home page's recent runs).
- Response `200`: `{ runs: WorkflowRunSummary[] }`, newest `startedAt` first, running runs included. No paging (as 1); the client pages.
  ```ts
  type WorkflowRunSummary = {
    id: string;
    workflowId: string;
    workflowName: string;            // the name when the run started (a deleted user agent's run still names it)
    status: 'queued' | 'running' | 'suspended' | 'success' | 'failed' | 'stopped';   // 'queued': accepted, waiting for a free slot (or re-queued after a restart, ADR-0057); 'suspended': waits for the user's answer (138)
    title: string;                   // see below
    queuedAt?: string;               // ISO: when 119 accepted it; absent on runs stored before ADR-0057
    attempts?: number;               // times the run has started (1 on its first start); absent while never started and on legacy runs; run-level, not a step's `attempt`
    startedAt: string;               // set at insert (= queuedAt), set again each time the run starts
    finishedAt?: string;
    conversationId?: string;         // a run of Answer a Business Question (Avery + Michael) or of `agent:insights-lead` or `agent:data-readiness-assessor`: its conversation with Avery, Elena or Dana (workflows R45, agents-evals R115 and R120), the first run's id
    archivedAt?: string;             // ISO: its conversation was archived (159)
  };
  ```
- `title` is the run's `question`, else the first `text` or `textarea` input of the workflow (not `hidden`, in form order, per 116) that has a value, else the workflow's name; trimmed, at most 120 characters. A workflow no longer in the catalogue has no text inputs to read, so its runs fall back to the question or the name.
- Errors: none expected.

#### 121. `GET /workflow-runs/:id`
- Response `200`: `WorkflowRun` (3.6): the stored document ([data-model.md](data-model.md) 3.16, with `ownerId`, `createdAt` and `updatedAt`) plus, for an agent run, the derived `panelItems` (the stored items and a `visual:<id>` item for each visual without one), `workflow` view and `agent`, computed on its run-backed host as a session's are (2.1) on every read. A code-only run is the document as stored. `done.run` of 119 is this same shape. A `suspended` run carries `waitingFor` (3.6); one that could no longer be answered reads `stopped` with `waitingFor.expired: true`. A `queued` run carries `queuedAt` and no steps; after its first start it carries `attempts` (3.6).
- Errors (Style B): `404 "Run \"<id>\" not found"`.

#### 122. `DELETE /workflow-runs/:id`
- Response `200`: `{ ok: true, message: "Run deleted" }`.
- Side effects: for an agent run, deletes its workspace `workspaces/session-run-<id>/` (its visuals, panel files, synthetic scripts) and its memory threads (resource `run-<id>`: `run-<id>` and `run-<id>:<agent key>`; [agents.md](agents.md) 5.14), then its node chats with their threads `run-<id>-node-<step id>` (136, 137; [data-model.md](data-model.md) 3.17), then the document. A code-only run has neither, so only the document goes. A run given as another run's `context` may be deleted; the later run keeps `context.fromRunId` as a dangling reference. A `suspended` run may be deleted: its waiting turn is dropped first (its host, memory thread and workflow snapshot, ADR-0043).
- Errors (Style B): `404 "Run \"<id>\" not found"`; `400 "Stop the run before deleting it"` for a run still `queued` or `running`.

#### 159. `POST /workflow-runs/:id/archive`
- Capability: [workflows](../capabilities/workflows/spec.md) R45. Archives the **conversation** with Avery or Elena the run belongs to: every run with the run's `conversationId` (or the run alone when it has none) gets `archivedAt` set to now. Archived runs leave the run history (120) and the home page's recent runs, show only under `?archived=true`, open read-only and take no new message (118/119 refuse it, below). No body.
- Response `200`: `{ ok: true, conversationId: string, archived: number }` (`archived`: how many runs were archived).
- Errors (Style B): `404 "Run \"<id>\" not found"`; `409 "The run is still running"` when a run of the conversation is `queued`, `running` or `suspended` (waits for the user). Archiving an already archived conversation answers `200` again.

#### 160. `POST /workflow-runs/:id/unarchive`
- Capability: [workflows](../capabilities/workflows/spec.md) R45. Brings the conversation (with Avery or Elena) back: `archivedAt` is removed from every run of it, so they show in the history again and take messages. No body.
- Response `200`: `{ ok: true, conversationId: string, unarchived: number }`.
- Errors (Style B): `404 "Run \"<id>\" not found"`. A conversation that is not archived answers `200` and changes nothing.

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
- The rating is written under the run's answer lock (139-143), so it never drops evidence another request stored meanwhile.

#### 129. `POST /agents/:id/draft-runs/stream`
- Prefix `/agents`, served by the workflows module's draft-runs controller. Capability: [agents-evals](../capabilities/agents-evals/spec.md) R60, R61. `:id` is a user agent's id.
- Runs the agent's saved **draft** once on the question, streamed as 119 is (section 3.6, same events and framing, without `seq`), but **tied to the connection**: closing it stops the run (not detached, ADR-0048). The agent turn runs on Elena's conversation engine (`insights-lead-conversation`, one step `answer`; ADR-0059) on a run host that is a preview-shaped session over the draft: Elena's prompt and checks, with the draft's instructions as context Block 5, its datasets that exist, its tool selection (`sample_rows`, `ask_clarification`; a stored `visuals` is ignored), its model and effort overrides (else Elena's routing) and its in-app skills after hers. The dashboard and export gates stay closed. Body: `{ input: { question: string } }` (no `careful`). The `run` event carries `workflowId: "agent:<id>"`. When Elena asks the user, the stream sends `step` (waiting), `input-required { runId, stepId: "answer", title: "Answer", question, options, expiresAt }` and `done { run }` with `run.status: "suspended"` and `run.waitingFor`; the waiting draft is held in server memory for 30 minutes, at most 20 of them (the oldest expires first), and continues with 169. Side effects: none kept once it ends (success, failure, stop, expiry or restart): its host, workspace, memory thread and the engine's snapshot are deleted. `done.run.agentKey` is `insights-lead`, `agentId` the user agent's id.
- Refusals (Style B, before the stream starts, nothing runs): `404 "Agent \"<id>\" not found"`; `400 "Select at least one dataset to preview"` when none of the draft's datasets exists; `400 "Question is required"` for a missing or blank question.
- `done.run` is the run as it ended, with its `answer`; it has no stored copy to read back, and its files do not download. A workspace left by a stop of the app is deleted at the next backend start (the runs' start-up recovery). The run is not stored in `workflow_runs` (it is not in 120 or 121).
- The finished run (`done.run`, however it ended, a `suspended` one aside) is **held in server memory for 30 minutes** from its end, at most 20 of them, the oldest dropped first (1.25.9), for the query inspector only: 139-143 accept its id (the `runId` of the stream's first event, `run`, which equals `done.run.id`) and write to the copy in memory. 120, 121 and 122 never see it. After its time, after a restart, or once its agent is deleted, 139-143 answer `404 "Run \"<id>\" not found"`.

#### 169. `POST /agents/:id/draft-runs/:runId/resume/stream`
- Body: `{ stepId: string; answer: string }`. Answers a draft run (129) that waits for the user and continues the same run, streamed as 129 (same events, no `seq`) and tied to the connection (closing it stops the run). Ends in `done { run }` (possibly `suspended` again) or `error`.
- Refusals (Style B, before the stream): `404 "Agent \"<id>\" not found"`; `400 "Select at least one dataset to preview"`; `404 "Run \"<runId>\" not found"` (unknown, not this agent's, already resumed or ended); `410 "This run can no longer continue — run it again with your answer"` (its 30 minutes passed); `400 "Answer is required"`; `400 "Step \"<stepId>\" is not waiting for an answer"`.
- Side effects: as 129. The held draft is taken out on a passing request, so it resumes once.

#### 130. `POST /workflow-runs/:id/visualizations`
Removed 2026-11-26 with the visual designer (ADR-0059): the route no longer exists and a call answers `404` (the number is not reused). A run's stored visuals are still read (123, 124), reverted (132) and refreshed (133).

#### 131. `POST /workflow-runs/:id/visualizations/:vid/tailor`
Removed 2026-11-26 with the visual designer (ADR-0059): the route no longer exists and a call answers `404` (the number is not reused).

#### 132. `POST /workflow-runs/:id/visualizations/:vid/revert`
- Body: `{ version: number }`. As 11: moves `currentVersion` only; the card `Reverted interactive visual "<title>" (v<n>).` is appended to `events`.
- Success `201`: `{ ok: true, message: "Reverted to version <n>", run, visualization }`.
- Errors (Style B): as 130; `400 "Version <n> does not exist"` (also a missing or non-numeric `version`).

#### 133. `POST /workflow-runs/:id/visualizations/:vid/refresh`
- Body: none. As 12 over the run's `datasets`: re-runs each stored `run_readonly_sql` record of the current version and rewrites `data.json` and `index.html` in place; no new version, no designer call, no card.
- Success `201`: `{ ok: true, message: "Refreshed data for version <n>", run, visualization }`.
- Errors (Style B): as 130; `404 "Visualization <vid> not found in session run-<id>"`.

#### 134. `POST /workflow-runs/:id/visualizations/:vid/repair`
Removed 2026-11-26 with the visual designer (ADR-0059): the route no longer exists and a call answers `404` (the number is not reused).

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
- Runs one turn of the step's agent about that step's data in the stored run ([agents.md](agents.md) 5.16): the agent's own tools (read-only), the run's `datasets`, the chat's earlier messages, and a context block built server-side from the stored run (never from the client). The turn is the agent alone, never a run of the workflow. For `orchestrated-answer-michael` the agent step is Orchestrate (the chat is the run host's agent, `insights-analyst`, with its tools); a step that ran twice is chatted about as its last attempt.
- Refusals (Style B, JSON, before any SSE frame; nothing is stored), in this order: `404 "Run \"<id>\" not found"`; `400 "Message is required"` (missing or blank `content`); `409 "The run is still running"` (also for a `queued` run); `409 "The run is waiting for an answer"` (a `suspended` run, 138); `404 "Workflow \"<workflowId>\" not found"` for a run of a workflow the catalogue no longer holds; `400 "Step \"<stepId>\" has no agent to chat with"` (an unknown step or a code step); `400 "Step \"<stepId>\" did not run in this run"` (the run has no such step, or it is `skipped`); `409 "A reply about step \"<stepId>\" is already being written"` while another turn of the same chat runs.
- Response `200`: SSE with the framing of 3.1 (`data: <json>\n\n`). Events, in order: the agent turn's `reasoning`, `text`, `tool` and `tool-result` events (3.1, as the run stream sends them; no `run`, `step`, `workflow`, `panel-item` or `visual-updated`), then exactly one of `done { message: NodeChatMessage }` (the assistant message as stored) or `error { content }` (the turn failed; its message is stored with `error`).
- Closing the connection stops the turn: nothing more is sent, and the assistant message is stored with what came and `stopped: true`.
- Side effects: the user message is stored before the turn starts, the assistant message when it ends, in the chat of that run and step ([data-model.md](data-model.md) 3.17). The run document is never changed. The turn's host `run-<id>-node-<stepId>`, its memory thread and its workspace `session-run-<id>-node-<stepId>` exist only while the turn runs.

#### 138. `POST /workflow-runs/:id/resume/stream`
- Body: `{ stepId: string, answer: string }` (`answer` trimmed). Capability: [workflows](../capabilities/workflows/spec.md) R28; decision: [architecture.md](architecture.md) ADR-0043. (Removed 2026-11-23: `images`, the reference images for a change to Ryan's visual, and the approval gates they belonged to, workflows R44; so are `waitingFor.review` and `waitingFor.visualId`, and a body with `images` is read as one without.)
- Answers a run that waits for the user (`status: 'suspended'`, its `waitingFor.stepId` = `stepId`) and continues **the same run** from its waiting step: Avery + Michael's Orchestrate, resumed with `{ stepId: 'orchestrate', answer }`, runs Avery again with her question, the answer and a block of the work the team already did in the turn ([agents.md](agents.md) 5.23). The run's Mastra workflow run is resumed (`run.resumeStream` with the suspended path), its runtime (the run host's turn) re-attached from server memory.
- Refusals (Style B, JSON, before any SSE frame; nothing changes), in this order: `404 "Run \"<id>\" not found"`; `410 "This run can no longer continue — run it again with your answer"` for a stored run `stopped` with `waitingFor.expired`; `409 "Run \"<id>\" is not waiting for an answer"` (any other run that is not `suspended`: running, ended, or answered already); `400 "Answer is required"` (blank `answer`); `400 "Step \"<stepId>\" is not waiting for an answer"` (a `stepId` other than `waitingFor.stepId`); `410` (the same message) when the run waited longer than 30 minutes or is no longer held in memory: the stored run is then `stopped`, its waiting step `stopped`, `waitingFor.expired: true`, `finishedAt` set. A run passing every check is taken out of the waiting runs, so one answer resumes it once.
- Response `200`: SSE as 3.6 for the same run: `run { runId, workflowId }` first, then the `step` events (the resumed step continues with its `attempt`, its `input`, `startedAt` and earlier `toolCalls`), the agent turn's events, and `done { run }` (the run `success`, `stopped`, or `suspended` again with a new `waitingFor` and `input-required` before `done`) or `error { content }`. The resumed run is detached from the connection as 119's (ADR-0048): its events go to a fresh log of the same run, numbered on from the last `seq`; closing the connection stops only the following (149 follows it again, Stop is 150).
- Side effects: the stored run becomes `running` with `waitingFor` removed before `run` is sent, and is updated when it ends as in 119 (its resumed turn timed by 119's no-progress watchdog); the workflow snapshot written while it waited is deleted once it ends ([data-model.md](data-model.md) 3.16).
- "Run again with my answer": for an expired run the client starts a new run (119) with the answer as `question` and `context.fromRunId` the expired run; that context is the expired run's question and its clarifying question with its options (`<question>\n- <option>` …), not an answer (118 accepts it).

#### 149. `GET /workflow-runs/:id/events/stream`
- Query: `after` (optional): a frame's `seq`; only the events after it are sent. Absent, `0` or not a whole number: every event the server holds. Capability: [workflows](../capabilities/workflows/spec.md) R13, R16; decision: [architecture.md](architecture.md) ADR-0048.
- Follows a run started by 119 or resumed by 138 again, from any client (a `queued` run included: it is held in the live runs from its enqueue, and its log begins with `run` and `queued`; a run re-queued after a restart is held again, with a fresh log): the page that left it and came back, a reload, another window. The server holds each such run's **event log** in memory, from its start (or its last resume) until 10 minutes after it ends: its events as 3.6 sends them, numbered by `seq` from 1 (a resume starts a fresh log whose numbers go on); consecutive `text` or `reasoning` deltas are kept as one event (numbered by the last one), and a replay after a `seq` inside such a run of deltas sends only the text after it; at most 5,000 entries, the oldest after `run` dropped first.
- Refusals (Style B, JSON, before any SSE frame): `404 "Run \"<id>\" not found"` for no stored run; `404 "Run \"<id>\" has no live events"` for a stored run the server no longer holds (it ended more than 10 minutes ago, it ran through 118, or the backend restarted since and the run did not start again): read it with 121.
- Response `200`: SSE as 3.6, each frame `data: {"seq":<n>,"type":…}`: the logged events after `after` at once, then the live ones, ending with the run's terminal event (`done { run }`, `error { content }`; a run that waits for the user ends its log with `input-required` and `done`, as 119). A run that ended already is replayed and the response ends at once. A run stopped through 150 ends its log with `done { run }`, the run `stopped`; a run that made no progress (119's watchdog) ends it with `error { content }`, the run `failed`. Once a log has ended nothing more is added to it, even when the run's work unwinds later. Closing the connection stops only the following.
- Side effects: none.

#### 150. `POST /workflow-runs/:id/stop`
- Body: none. Capability: [workflows](../capabilities/workflows/spec.md) R16, R21; decision: [architecture.md](architecture.md) ADR-0048.
- **A `queued` run** (ADR-0057) is stored `stopped` at once: no steps, `finishedAt` set, no agent turn to abort; it leaves the queue, its log ends with `done { run }` and the message is `Run stopped`.
- Stops a run started by 119 or resumed by 138: the agent turn aborts and sends nothing more of its own; the run is stored `stopped` with the partial answer the host persisted, if any, as R18 says; its log (149) ends with `done { run }`. A run that waits for the user (`suspended`) is dropped as an expired one (138): stored `stopped`, its waiting step `stopped`, `waitingFor.expired: true`. Answers once the run is stored, at most 10 seconds after the stop.
- **Stop always ends the run** (ADR-0048 amendment): when the work has not unwound 10 seconds after the stop, the server stores the run `stopped` itself (`finishedAt` set, its running steps `stopped`, its steps as last tracked), ends its log with `done { run }` and answers that run; `run.status` in the answer is never `running`. When the work unwinds later it keeps the run `stopped` (it may add the partial answer and the final step details), releases the run host and sends nothing to the ended log. Such a run can be deleted (122); if its work unwinds after that, nothing is stored again and the run host's workspace and memory thread are deleted then.
- **Idempotent:** a run that already ended (or ran through 118) answers as it is stored.
- Response `200`: `{ ok: true, message: "Run stopped" | "Run already ended", run: WorkflowRun }` (3.6; `message` is `Run stopped` when the run reads `stopped`).
- Errors (Style B): `404 "Run \"<id>\" not found"`.

#### 151. `GET /workflow-runs/:id/input-image`
- Query: `path` (required): a stored path of the run's `input`, `inputs/images/<n>.<png|jpg|webp>` or the `image` field's `inputs/image.<png|jpg|webp>`. Capability: [workflows](../capabilities/workflows/spec.md) R35 (no built-in workflow declares an image field since 2026-11-26, R49; past runs keep their images). The path must be a string value, or an element of an array value, of the run's stored `input` that matches `^inputs/.+\.(png|jpg|webp)$`; the file is then read from the run's workspace (`run-<id>`; the same guard as 146: a safe relative path, no symlink, one of the three extensions). Keying by path means the client never counts or orders images.
- Response `200`: the bytes of the image, with its `Content-Type` (`image/png`, `image/jpeg` or `image/webp`) and `Cache-Control: private, max-age=3600`.
- Errors (Style B): `404 "Run \"<id>\" not found"`; `404 "Run \"<id>\" has no image \"<path>\""` when the path is not in the run's input, is invalid, or its file is gone.
- Auth: as 146 (section 1.9); an `<img src>` cannot send a header, so the thumbnails use the same mode as the artifact image.

#### Query evidence (139-143, 152, 153)

The query inspector's endpoints over a run's stored answer and its `evidence` (3.6, [data-model.md](data-model.md) 3.4.2a; plan `docs/plans/m1-25-query-inspector.md`). `:index` is an `evidence[].index`: the position of the query's record in `answer.data`. Since 1.25.9 their logic is the engine `AnswerEvidenceService` (`sessions/query-evidence/answer-evidence.service.ts`), shared with 144-148, 154 and 155, and `:id` may also be a **draft run** held in memory (129): a stored run is looked up first, then a held draft run whose agent still exists (the rule of 129, `Agent "<id>" not found`, read as this 404). Rules for all seven:
- Errors (Style B), in this order: `404 "Run \"<id>\" not found"` (also a draft run past its 30 minutes, dropped, or whose agent is gone); `404 "Run \"<id>\" has no answer"`; `400 "Wait for the run to finish"` (the run is `queued`, `running` or `suspended`); `400 "Query <index> not found in the run's answer"` (an `:index` that is no `evidence[].index`, or not a whole number). An answer stored without `evidence` has it derived from `data` for these checks.
- Every write to a run's `answer` goes through **one lock per run**, so two writes cannot overwrite each other: each re-reads the run inside the lock, patches it and writes `answer`. This includes 128. A held draft run is written in memory, under the same lock.
- Every statement runs through the datasource's `runReadOnlySql` directly (its read-only guard, and PostgreSQL's READ ONLY transaction), never through the SQL repair: a re-run executes the same statement. A page (152) runs through the datasource's `runPagedSql` instead (datasources R52, ADR-0050): the same stored statement, guarded, wrapped in an outer query; no repair either.
- The datasource of a query (as 133): the record's `evidence.datasourceId` when the run's datasets use it, else the run's only datasource; `400 "Several datasources are in scope for this run; this query cannot be re-run"` when there are several, `400 "No datasource is bound to this run's datasets"` when there is none.

#### 139. `POST /workflow-runs/:id/answer/evidence`
- Body: none. Builds `evidence` for an answer stored before the feature (from `data`; the coverage of a record without `totalRows` reads the cap its rows ran into), then fills, for each query that did not fail and lacks them, `datasourceId`, `datasourceKind` and `tables`: the catalog entities of the run's datasets whose name the SQL contains (PostgreSQL also `schema.table`; a `sample_rows` record its entity), each sized by one `SELECT COUNT(*) AS n FROM <entity>` per distinct table across the answer, at most 3 at a time. Exact counts, never estimates.
- Success `201`: `{ ok: true, run }` (`run` as 121).
- A count that fails gives that table `rows: null, error: "<connector message>"`, never an HTTP error; a query whose datasource cannot be resolved gets its tables with `rows: null` and that reason. Called again with nothing missing, it runs no query and writes nothing.
- Errors: the shared ones.

#### 140. `POST /workflow-runs/:id/answer/queries/:index/explanation`
- Body: none, or `{ refresh: true }` to explain the query again: its stored explanation, counts and step rows are replaced (161). Without it, returns the stored `evidence[index].explanation` when there is one. Otherwise: for a `sample_rows` record, code builds the steps; for SQL, one call to the System agent `query-explainer` ([agents.md](agents.md)), whose request holds the dialect, the rationale, the tables with their sizes, the columns and the SQL, never result rows. The explanation is stored at `answer.evidence[index].explanation` under the lock. A second request for the same run and index while one is running waits for the same result.
- Success `201`: `{ ok: true, run }`.
- A reply that is no JSON object is stored with `fallback: true` (steps built by code) and answers 201.
- Errors: the shared ones; `400 "Query <index> has no SQL to explain"` (a failed record); `400 "The query could not be explained: <model error>"`.

#### 141. `POST /workflow-runs/:id/answer/queries/:index/stage-counts`
- Body: none. Runs each step's `countSql` in turn, at most 8, and checks them (the start count equals the table size; every statement reads only tables the query reads and returns one whole number of 0 or more; `keep` and `group` never increase the count; the last count, with the outer limit, equals the rows produced). Stores each step's `rows` and `explanation.stageCounts` (`verified`, or `unverified` with its `reason`, when no step count but the start and show counts is stored). `unverified` is a stored result, not an error. Called again once verified, it returns the stored result.
- Success `201`: `{ ok: true, run }`.
- Errors: the shared ones; `400 "Explain query <index> first"`.


#### 161. `POST /workflow-runs/:id/answer/queries/:index/steps/:step/preview`
- Body: none. `:step` is the 0-based index of a step of the query's stored explanation, never its Show step (whose rows are the query's own). Runs that step's `previewSql` once, read-only and capped at 10 rows, after checking it reads only tables the query reads, and stores on the step `preview: { columns, rows (at most 10), more, total?, at, check? }` (`check` `matches` or `differs` against the step's verified count; absent when the counts are not verified; agents.md 2, *Step rows*). Called again, it returns the stored preview.
- Success `201`: `{ ok: true, run }`.
- Errors: the shared ones; `400 "Explain query <index> first"`; `400 "Query <index> has no step <step>"` (out of range, or the Show step); `400 "Step <n> has no preview: explain the query again"` (an explanation stored before step rows: 140 with `{ refresh: true }`); `400 "Step <n> reads <table>, which the query does not read"`; `400 "Step <n> could not be previewed: <error>"`.

#### 142. `POST /workflow-runs/:id/answer/queries/:index/rerun`
- Body: none. Runs the record's statement again, with no repair, at its `rowLimit` (default 100; a `sample_rows` record samples its entity again, default 10). **Nothing is stored**: the answer keeps pointing at the rows it was written from.
- Success `201`: `{ ok: true, result: QueryRerunResult }`.
  ```ts
  type QueryRerunResult = {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    totalRows?: number;           // rows the statement produced before the cap
    coverage: QueryCoverage;      // as 3.6, for the new result
    ranAt: string;                // ISO
  };
  ```
- Errors: the shared ones; `400 "Query <index> has no SQL to run"` (a failed record); the datasource rule's two 400s; the connector's own message as a 400 otherwise.

#### 143. `GET /workflow-runs/:id/answer/queries/:index/csv`
- The checks of 142, before any header is written. Raises the statement's top-level `LIMIT` (or `FETCH FIRST n`) to 50 001, or appends `LIMIT 50001` when there is none (a trailing `;` or comment is dropped first), runs it with the row clamp raised to 50 001, and keeps 50 000 rows. A `sample_rows` record is sampled again at its size.
- Response `200`: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="query-<Q>-<first 8 of the run id>.csv"` (`<Q>` is the query's 1-based position in `evidence`), and `X-Rows-Cut: 50000` when more rows existed. Body: a header row of the columns, then one line per row, CRLF line ends, quoted per RFC 4180 (a field holding `"`, `,`, CR or LF is quoted, `"` doubled); `null` is empty, an object is its JSON.
- Errors: as 142.

#### 152. `POST /workflow-runs/:id/answer/queries/:index/page`
- Body: `PageRequest`; every field optional. Roadmap 1.28.2; decision: [architecture.md](architecture.md) ADR-0050; types: `backend/src/modules/datasources/connectors/paged-sql.types.ts`.
  ```ts
  type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'in' | 'not_in'
    | 'contains' | 'not_contains' | 'starts_with' | 'is_null' | 'not_null';
  type FilterValue = string | number | boolean;
  type FilterSpec = { column: string; op: FilterOp;
    value?: FilterValue;      // every op but in, not_in, is_null, not_null
    valueTo?: FilterValue;    // the upper bound of between
    values?: FilterValue[] }; // in and not_in, at most 50
  type SortSpec = { column: string; direction: 'asc' | 'desc' };
  type PageRequest = { page?: number; pageSize?: number; filters?: FilterSpec[]; sort?: SortSpec[] };
  ```
- Reads one page of the query's **full** result: the record's stored SQL (for a repaired query, the corrected one, as 142 and 143 run) over the record's stored `columns`, its filters AND-ed, sorted by `sort` (empty: the default order, the stored query's top-level `ORDER BY` when it names output columns, else the first column; every column follows as a tie-breaker), `page` 1-based (default 1), `pageSize` default 50, 1 to 100. Rows past the 50,000th cannot be reached. Each column's kind (`number`, `text`, `boolean`, `date`, `unknown`) is inferred from the record's stored rows, and each filter value is made that kind (`contains`, `not_contains` and `starts_with` read it as text) before any query; `is_null` and `not_null` drop any value. The statement re-runs under its datasource's timeout ([non-functional.md](../product/non-functional.md) N72). **Nothing is stored.**
- Success `201`: `{ ok: true, result: PageResult }`.
  ```ts
  type ColumnKind = 'number' | 'text' | 'boolean' | 'date' | 'unknown';
  type ResultView = { filters: FilterSpec[]; sort: SortSpec[]; page: number; pageSize: number;
    matchedRows?: number; capped?: boolean };
  type PageResult = {
    columns: string[];
    columnKinds: Record<string, ColumnKind>;
    rows: Record<string, unknown>[];
    page: number;
    pageSize: number;
    pageCount: number;      // max(1, ceil(matchedRows / pageSize))
    matchedRows: number;    // rows matching the filters, at most 50,000
    capped: boolean;        // more than 50,000 rows matched
    view: ResultView;       // the checked request; sort [] for the default order
    ranAt: string;          // ISO
  };
  ```
- Errors (400 unless stated): the shared ones; `"Query <index> has no SQL to run"` (a failed record); `"Query <index> is a sample; it has no full result to page"` (a `sample_rows` record); then, before any query: `"Page must be a whole number of at least 1"`; `"Page size must be a whole number from 1 to 100"`; `"Page <n> is past the 50,000-row limit"` (`(page - 1) × pageSize ≥ 50,000`); `"A view takes at most 10 filters"`; `"A view sorts by at most 3 columns"`; `"Unknown column \"<c>\""`; `"Column \"<c>\" appears more than once in the result; it cannot be filtered or sorted"`; `"Filter on <c>: <op> needs a value"`; `"Filter on <c>: <op> takes at most 50 values"`; `"Filter on <c>: \"<v>\" is not a number"` (or `is not true or false`, `is not a date`); a body of the wrong shape: `"The body must be a JSON object"`, `"filters must be a list"`, `"sort must be a list"`, `"Each filter names a column"`, `"Each sort key names a column"`, `"Filter on <c>: unknown operator \"<op>\""`, `"Filter on <c>: values must be a list"`, `"Sort on <c>: the direction is asc or desc"`. Then the datasource rule's two 400s; `"This warehouse does not support query parameters; filtering is unavailable"` (Databricks); the connector's own message as a 400 otherwise.

#### 153. `POST /workflow-runs/:id/answer/queries/:index/interpret-filter`
- Body: `{ text: string; view?: ResultView }`: the user's words (trimmed, not blank, at most 500 characters) and the view they see now (152's `ResultView`; omitted or `null` for the answer's stored rows). `view.filters` and `view.sort` are read as 152 reads a body's; a missing or invalid `view.page` is 1, `view.pageSize` 50. Roadmap 1.28.4; decision: [architecture.md](architecture.md) ADR-0050.
- Reads the words as a view of this query's full result with one call to `result-explorer` ([agents.md](agents.md) 2.16, `MastraService.interpretResult`): the query is the only candidate, `Q<n>` with its rationale, its stored columns, each column's kind (inferred from the stored rows as 152 infers it) and at most 5 distinct stored values per column (text cut to 60 characters). The model never sees the SQL or whole rows. Its reply is turned into a `PageRequest` by code (`specOf`): columns matched exactly, then without case; a filter or sort key on a column the query does not have, or with a value its column's kind cannot take, is left out and listed in `rejected`; at most 10 filters and 3 sort keys; the page move (keep, first, next, previous, last, to) resolved to an absolute page from 1 to the view's page count (`ceil(view.matchedRows / view.pageSize)`, when `matchedRows` is given). The request is then checked as 152 checks it. **Nothing runs and nothing is stored**: the client pages with 152.
- Success `201`: `{ ok: true, interpretation: FilterInterpretation }`.
  ```ts
  type FilterInterpretation = {
    request: PageRequest;   // the complete new view: page, pageSize (the view's), filters, sort
    understood: string;     // one line, business words: "Country is Brazil · Goals at least 3"
    rejected?: string[];    // parts that named no known column: "Continent is Europe", "sorted by Stadium"
  };
  ```
- Errors (400 unless stated): a body of the wrong shape first: `"The body must be a JSON object"`, `"Write what to filter, sort or page"` (no `text`, or blank), `"The text is longer than 500 characters"`, `"view must be a JSON object"`, and 152's shape errors for `view.filters` and `view.sort`; then the shared ones; `"Query <index> has no SQL to run"`; `"Query <index> is a sample; it has no full result to page"`; `"The filter could not be understood: <model error>"` (the model call failed, or its reply held no JSON object); `"That asks a new question, not a filter on this result"` (the agent's `action` is `new-question`: a new measure, grouping or question); then any of 152's checks the request fails.

### 2.6.4 Artifacts

Reusable context saved from workflow runs ([workflows](../capabilities/workflows/spec.md) R33; [data-model.md](data-model.md) 3.18). One kind today, `dashboard`: saved as a version of its artifact by a turn of Avery's run, with no route of its own (144-148, 165 and 166 read, rename, delete, download and save them); the artifacts of the removed Dashboard Image to Artifact (until 2026-11-26) stay. A dashboard built on real rows is saved, as a version of its artifact, by a turn of Avery's run (workflows R45; [agents.md](agents.md) 5.22): **no route creates a version**, the turn does, as a **draft**: the user saves it with 166 (since 2026-11-22), and only saved versions are listed (144) and downloaded (165).

```ts
type ArtifactSummary = {
  id: string;                       // uuid
  kind: 'dashboard';
  name: string;                     // 1 to 80 characters, trimmed
  description: string;              // the blueprint's summary; may be ''
  widgetCount: number;
  filterCount: number;
  hasImage: boolean;                // whether 146 answers an image (only an artifact saved by the removed Dashboard Image to Artifact has one)
  currentVersion: number;           // 1 for an artifact with no versions of its own
  versionCount: number;
  hasData: boolean;                 // whether the current version keeps the rows of its query (a live dashboard)
  source?: { runId: string; workflowId: string };   // the run it was saved from
  createdAt: string;                // ISO
  updatedAt: string;                // ISO
};
type Artifact = ArtifactSummary & {
  blueprint: DashboardBlueprint;    // the dashboard as data (agents.md 5.17)
  document: string;                 // the dashboard drawn by the fixed runtime with no mapping: a self-contained HTML document for a sandboxed frame; on the real rows of the version when it has them (live), else with the mock values
  version: number;                  // the version shown: the requested one, else the current
  versions: { version: number; createdAt: string; instruction?: string; rowCount?: number; widgetCount: number; filterCount: number; saved: boolean }[];   // oldest first
  status: 'draft' | 'saved';        // 'draft' when no version is saved (144 never lists such an artifact)
  savedVersions: number[];          // the versions saved to Artifacts (166); a legacy artifact with no versions of its own reads [1]
  query?: DashboardQuery;           // the version's data query (live versions only)
  dataMissing?: true;               // the version is live but its rows file is gone: drawn with the mock values
};
type DashboardQuery = { sql: string; datasourceId: string; rationale?: string };
// ChatMessage.dashboard (data-model 3.4.1; a run's answer.dashboard): the dashboard a turn of Avery's run created or changed
type DashboardRef = {
  artifactId: string;
  version: number;
  title: string;
  action: 'created' | 'updated';   // 'created' = version 1 of a new artifact
  widgetCount: number;
  filterCount: number;
  rowCount: number;
  saved: boolean;                  // whether this version is saved to Artifacts (false when Clara creates or updates it; 164 saves it); a stored run's ref is read again from the artifact each time the run is read (121, 119's done.run), so a card shows a later save
};
```

#### 144. `GET /artifacts`
- Response `200`: `ArtifactSummary[]`, newest first (`createdAt` descending), of the artifacts with **at least one saved version** (a draft, an artifact with no saved version, is hidden). `currentVersion` and the counts are those of the latest **saved** version.

#### 145. `GET /artifacts/:id`
- Query: `version` (optional, a positive whole number): the version to read; the latest version, draft or saved, when absent (the dashboard panel uses it). A draft is readable: the panel draws it.
- Response `200`: `Artifact` at that version (its `blueprint` and `document` are the version's; `version`, `versions`, `query` and `dataMissing` as above) plus `status: 'draft' | 'saved'` (of the artifact: `draft` when it has no saved version), `savedVersions: number[]` and, on each `versions[]` item, `saved: boolean`. `400 "Version must be a positive whole number"`; `404 "Artifact \"<id>\" not found"`; `404 "Artifact \"<id>\" has no version <n>"`.

#### 146. `GET /artifacts/:id/image`
- Response `200`: the bytes of the image the dashboard was read from, with its `Content-Type` (`image/png`, `image/jpeg` or `image/webp`) and `Cache-Control: private, max-age=3600`. `404 "Artifact \"<id>\" not found"`; `404 "Artifact \"<id>\" has no image"` when it was saved without one or the file is gone.

#### 147. `PATCH /artifacts/:id`
- Body: `{ name: string }` (trimmed).
- Response `200`: `ArtifactSummary`. `400 "Name is required"`; `400 "Name must be at most 80 characters"`; `404 "Artifact \"<id>\" not found"`.

#### 148. `DELETE /artifacts/:id`
- Response `204`. `404 "Artifact \"<id>\" not found"`.
- Side effects: the document, its image file and the folder of its versions' rows (data-model 3.18) are deleted. Runs that used the artifact are unchanged (they keep the blueprint in their own output), and a dashboard card of an earlier answer then opens `Artifact "<id>" not found`.

#### 165. `GET /artifacts/:id/download`
- Query: `version` (optional, a positive whole number; the latest **saved** version when absent).
- Response `409 "Save the dashboard to Artifacts before downloading it"` when the version asked for is not saved (or, without `version`, the artifact has no saved version).
- Response `200`: the version as a zip of plain files, `Content-Type: application/zip`, `Content-Disposition: attachment; filename="<slug>-v<N>.zip"`, where the slug is the artifact's name lower-cased to `[a-z0-9-]` and at most 64 characters (`dashboard-<first 8 characters of the id>-v<N>.zip` when nothing is left). Entries, stored uncompressed and dated with the version's `createdAt`: `index.html` (links `styles.css`, loads `data.js` then `app.js`; no `<script>` with code inline, no CSP meta), `styles.css`, `app.js` (the fixed runtime and its mount call), `data.js` (`window.DASHBOARD_DATA = { blueprint, rows, live }`, `</script>` and U+2028/U+2029 escaped), `query.sql` (live versions only) and `README.txt` (how to open it, the version, the date, the row count; a mock version says its values are invented). It opens from `file://` with no server, loads no external resource and draws the dashboard on the rows it holds, so it is a snapshot: it never reads the datasource. `400 "Version must be a positive whole number"`; `404 "Artifact \"<id>\" not found"`; `404 "Artifact \"<id>\" has no version <n>"`. FE: yes (the dashboard card's, the panel's and the artifact page's **Download**).

#### 166. `POST /artifacts/:id/save`
- Body: `{ version?: number }` (a positive whole number; the latest version when absent).
- Response `200`: the `Artifact` as 145 at that version, with the version now in `savedVersions` (`status: 'saved'`). Idempotent: saving a saved version changes nothing. `400 "Version must be a positive whole number"`; `404 "Artifact \"<id>\" not found"`; `404 "Artifact \"<id>\" has no version <n>"`.
- Side effects: adds the version to the document's `savedVersions` (data-model 3.18); later versions stay drafts until saved. FE: yes (**Save to Artifacts** on the dashboard panel and the card).

### 2.6.5 Conversation exports

Controller prefix `/conversation-exports`. Capability: workflows (R45). Avery makes an export in a run of hers when the user asks to export or share the conversation (`export_conversation`, [agents.md](agents.md) 3.18; ADR-0056): **no route creates one**. The answer of that run carries it as `answer.export` (a session's `ChatMessage.export`, data-model 3.4.1), and the export is stored in `conversation_exports` (data-model 3.20) with its files under `<data dir>/exports/<id>/`.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 167 | `GET /conversation-exports/:id/download` | One file of an export (PDF or PowerPoint) as an attachment | yes |

```ts
// ChatMessage.export (data-model 3.4.1; a run's answer.export): the conversation Avery exported in that turn
type ConversationExportRef = {
  id: string;                      // uuid
  title: string;                   // Avery's title for the file
  createdAt: string;               // ISO
  files: {
    format: 'pdf' | 'pptx';
    fileName: string;              // `<slug of the title>.pdf` / `.pptx`: lower case [a-z0-9-], at most 64 characters (`conversation` when nothing is left)
    bytes: number;
    pages?: number;                // the PDF's page count
    slides?: number;               // the PowerPoint's slide count
  }[];                             // the formats Avery asked for, `pdf` first
};
```

#### 167. `GET /conversation-exports/:id/download`
- Query: `format`: `pdf` or `pptx` (required).
- Response `200`: the file, `Content-Type: application/pdf` or `application/vnd.openxmlformats-officedocument.presentationml.presentation`, `Content-Disposition: attachment; filename="<fileName>"`, `Content-Length` and `Cache-Control: no-store`.
- `400 "format must be \"pdf\" or \"pptx\""` for any other `format` (or none); `404 "Export not found"`; `404 "This export has no <format> file"` when the export was made without that format; `404 "The export file is gone"` when its file was removed from the data directory. FE: yes (the export card's **Download PDF** and **Download PowerPoint**, ui.md 4.4b).

### 2.6.6 Conversations

Controller prefix `/conversations`. Capability: [agents-evals](../capabilities/agents-evals/spec.md) R115 ([workflows](../capabilities/workflows/spec.md) R46). The runs of a conversational binding ([agents.md](agents.md) 5.14) that share a `conversationId` are one conversation; this route lists them, one row each, for the conversations panel of Elena's page (ui.md 4.5.12). Decision: ADR-0058.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 168 | `GET /conversations` | The conversations of one conversational binding (Elena's or Avery's), one row each, newest activity first | yes |

```ts
type ConversationSummary = {
  id: string;             // conversationId (its first run's id)
  title: string;          // the first run's question, trimmed, at most 120 characters (as 120's title)
  datasets: string[];     // every run's datasets, in first-seen order, without repeats
  lastActivityAt: string; // ISO: the newest finishedAt ?? startedAt of its runs
  runCount: number;
  lastRunId: string;      // the run to open (the newest startedAt)
  status: WorkflowRunSummary['status']; // of lastRunId
  archivedAt?: string;
};
```

#### 168. `GET /conversations`
- Query: `workflowId` (required: `agent:insights-lead`, `agent:data-readiness-assessor` or `orchestrated-answer-michael`); `archived` (`true` returns only the archived conversations (159), anything else only the ones not archived); `q` (optional, trimmed, case-insensitive: keeps a conversation when the `question` or the `answer.content` of any of its runs contains it).
- Response `200`: `{ conversations: ConversationSummary[] }`, newest `lastActivityAt` first, no paging.
- Errors (Style B): `400 "workflowId is required"`; `404 "Workflow \"<id>\" has no conversations"` for an id that is not a conversational binding.
- FE: yes (the conversations panel debounces `q` by 250 ms).
- Side effects: none.

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
| 53 | (removed 2026-11-26) `POST /datasets/:name/ontology/bootstrap` | Drafted ontology items from the dataset (one shot) | **no** |
| 54 | (removed 2026-11-26) `POST /datasets/:name/ontology/bootstrap/stream` | The same run, streamed progress (SSE) | yes |

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

#### 53. and 54. Ontology bootstrap (removed 2026-11-26)
The user removed the ontology's "draft with AI" with Kevin (`knowledge-bootstrap`, [agents.md](agents.md) 2.5): `POST /datasets/:name/ontology/bootstrap` and `POST /datasets/:name/ontology/bootstrap/stream` no longer exist and answer `404`. The numbers are kept so the references stay stable. Items already stored with `source: "mined"` stay listed, accepted and rejected as before.

### 2.8c Monitoring

Controller prefix `/monitoring`. Capability: [monitoring](../capabilities/monitoring/spec.md). Decision: ADR-0038. **Style B throughout** (real status codes, bare bodies). All seven routes are read-only and read Mastra's trace store (`observability.duckdb`, data-model 1.2), not an app collection; #163 also reads the `eval_runs` collection (ADR-0054). A data dir with no trace table yet gives an empty page, not an error.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 111 | `GET /monitoring/llm-calls` | List LLM calls, filtered and paged, newest first | yes |
| 112 | `GET /monitoring/llm-calls/:id` | One call with its facts, steps and context window | yes |
| 113 | `GET /monitoring/sessions` | List sessions with recorded agent runs, filtered and paged, most recent first | yes |
| 114 | `GET /monitoring/sessions/:id` | One session with its turns and each turn's trajectory | yes |
| 115 | `GET /monitoring/traces/:traceId` | One turn's spans as a depth-first tree for the waterfall | yes |
| 144 | `GET /monitoring/usage` | The Costs page's estimated cost by day, month, model, workflow and agent | yes |
| 163 | `GET /monitoring/agent-quality` | The Agent quality tab: per agent persona, eval figures from `eval_runs` and live figures from the trace store | yes |

#### 111. `GET /monitoring/llm-calls`
- Query (all optional): `page` (whole number >= 1, default 1); `pageSize` (25, 50 or 100, default 25); `agent` (agent id); `model` and `provider` (exact match); `status` (`succeeded`, `failed` or `running`); `session` (session id); `from` and `to` (ISO date-times, inclusive, on the call's start time).
- Order: start time descending, span id as the tie-break.
- Response `200`: `{ items: LlmCallRow[], total: number, page: number, pageSize: number, facets: { agents: { id, name }[], models: string[], providers: string[], sessions: { id, name: string|null, runId?: string }[] } }`. `total` counts every call that matches the filters. The facets come from all calls, not narrowed by the filters, sorted by name.
- Validation `400` (messages exact): `"Page must be a positive whole number"`, `"Page size must be 25, 50 or 100"`, `"Status must be succeeded, failed or running"`, `"From is not a valid date"`, `"To is not a valid date"`.
- `LlmCallRow`: `{ id, traceId, startedAt: ISO, endedAt: ISO|null, durationMs: number|null, agent: { id, name }|null, model, provider, session: { id, name: string|null, runId?: string }|null, inputTokens: number|null, outputTokens: number|null, cacheReadTokens: number|null, cacheWriteTokens: number|null, reasoningTokens: number|null, costUsd: number|null, status: 'succeeded'|'failed'|'running' }`. `id` is the span id of the call's `model_generation`. `agent.name` is the agent's technical name. `inputTokens` includes the cache reads and writes. `session.name` is read from the sessions collection and is `null` when no such session exists (a preview, an eval, a deleted session). A thread `run-<runId>` is a workflow run's host (ADR-0041): its `name` is `<workflow name>: <run title>` read from `workflow_runs` and `runId` is set; a deleted or unknown run has `name: null` and no `runId` (monitoring R45). `costUsd` is `null` when the model has no price.

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

#### 144. `GET /monitoring/usage`
- Query (all optional): `from` (ISO date-time; the period's start, inclusive; absent = since the first call); `to` (ISO date-time, inclusive, default now); `tz` (an IANA time zone for the day and month buckets, default `UTC`). The Costs sends the browser's time zone and local midnight of the period's first day ([monitoring](../capabilities/monitoring/spec.md) R48).
- Response `200`: `UsageSummary` = `{ from: ISO|null, to: ISO, timeZone, today: Amount, thisMonth: Amount, totals: Amount & { pricedCalls, inputTokens, outputTokens }, daily: (Amount & { date: 'YYYY-MM-DD' })[], monthly: (Amount & { month: 'YYYY-MM' })[], byModel: (Amount & { model, provider, inputTokens, outputTokens, priced: boolean })[], byWorkflow: (Amount & { id: string|null, name, kind: 'workflow'|'none', runs: number|null, avgCostUsd: number|null, medianCostUsd: number|null, p95CostUsd: number|null })[], byAgent: (Amount & { id: string|null, name })[], perRun: { count, avgCostUsd }, perQuestion: { count, avgCostUsd }, split: { inputUsd, cacheReadUsd, cacheWriteUsd, outputUsd, cacheSavedUsd, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens }, topRuns: (Amount & { runId, workflowId: string|null, workflowName, title: string|null, startedAt: ISO })[] }` with `Amount` = `{ costUsd: number, calls: number }`.
- Every call of `GET /monitoring/llm-calls` counts once; `costUsd` sums the calls' estimates (monitoring R5) and a call without one adds 0 (`totals.calls - totals.pricedCalls` of them). `today`, `thisMonth` and `monthly` (the 12 calendar months ending with the current one) ignore the period; `totals`, `daily` (every day of the period, zero-filled, from the first call when `from` is absent) and the three rankings cover it. Rankings are sorted by cost, then calls, descending. `byWorkflow`: a `run-<runId>` thread, or a step agent's `run-<runId>:<agent key>`, is that run's workflow (`id` = `workflowId`, `name` = the run's `workflowName`, from `workflow_runs`), a deleted run is `{ id: null, name: 'Deleted workflow run', kind: 'workflow' }`, and every other call is `{ id: null, name: 'No workflow', kind: 'none' }`; the run statistics are over the runs' period costs (median; nearest-rank 95th percentile) and null for `none`. `perRun` averages the workflow runs and `perQuestion` the traces of the calls outside runs (avg 0 when count is 0). `split` prices the period's tokens by kind (input = uncached input) and `cacheSavedUsd` is what the cache reads saved against the input price. `topRuns` holds up to 10 runs by cost, then calls; `startedAt` is their first call in the period, and a deleted run has `workflowId` and `title` null and `workflowName` `Deleted workflow run`. `byAgent` names a call with no agent `No agent`.
- Validation `400` (messages exact): `"From is not a valid date"`, `"To is not a valid date"`, `"From must not be after To"`, `"Time zone is not valid"`.

#### 163. `GET /monitoring/agent-quality`
- Style B. Read-only. Reads `span_events` and `eval_runs` (ADR-0054). Capability: [monitoring](../capabilities/monitoring/spec.md) R58-R68.
- Query, all optional: `agent` (a registry key); `set` (a set id); `model` (an exact model string, or `Unknown` for runs that recorded none); `from`, `to` (ISO date-times, inclusive; `to` defaults to now; no `from` = all time).
- Validation `400` (messages exact): `"From is not a valid date"`, `"To is not a valid date"`, `"From must not be after To"`.
- An unknown `agent`, `set` or `model` is not an error: it matches nothing. A data dir with no trace table gives live figures of 0 calls, not an error.
- Response `200`: `AgentQualityPage` (`backend/src/modules/monitoring/entities/agent-quality.entity.ts`):

```ts
interface AgentQualityPage {
  from: string | null;            // ISO; null = all time
  to: string;                     // ISO
  rows: AgentQualityRow[];        // one per built-in agent with >= 1 eval set; narrowed by agent and by set (a set keeps its own agent only); sorted by persona name
  facets: {                       // never narrowed by the filters
    agents: { key: string; name: string }[];                // agents with sets, by name
    sets: { id: string; name: string; agentKey: string }[];  // every set, by agent name then set name
    models: string[];             // distinct run models of those agents ('Unknown' last) ∪ distinct live call models of their agent ids; sorted
  };
}
interface AgentQualityRow {
  agentKey: string;               // registry key (eval_runs.agentKey)
  agentId: string;                // Mastra agent id (span entityId)
  name: string;                   // persona name
  role: string;                   // persona title, '' when none
  eval: {
    state: 'none' | 'no-match' | 'ok';   // none: no completed run ever; no-match: runs exist, none in scope
    model: string | null;         // the model the eval figures are on (M, monitoring R61)
    provider: string | null;
    runs: number;                 // completed runs in scope on M
    lastRun: { jobId: string; at: string; passed: number; total: number } | null;
    pass3:
      | { state: 'ok'; value: number; cases: number; totalCases: number }
      | { state: 'needs-runs'; runs: 0 | 1 | 2 }
      | { state: 'unknown-model' }
      | null;                     // null unless eval.state === 'ok'
    questions: number;            // case results counted for the tool figures
    toolCalls: number;
    toolCallsPerQuestion: number | null;
    toolErrorRate: number | null; // 0..1
  };
  live: { calls: number; p95Ms: number | null; pricedCalls: number; costPerCallUsd: number | null };
}
```

- Live calls are the `model_generation` calls of the row's `agentId` in the period (and of the model when filtered) whose trace has no span with `metadata."eval-run-id"` (data-model 1.2); the formulas for pass rate, pass^3, tool figures, p95 and cost are monitoring R61-R65.

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
  evidence?: QueryEvidence[];   // the query inspector's facts, beside `data` (data-model 3.4.2a)
  dashboard?: DashboardRef;     // the dashboard a turn of Avery's created or changed (2.6.4)
  export?: ConversationExportRef;   // the conversation Avery exported in that turn (2.6.5, 167)
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

### 2.17 Data readiness (removed 2026-11-26)

*Removed 2026-11-26.* The controller prefix `/data-readiness` and its three routes (108 `POST /data-readiness/assessments`, 109 `GET /data-readiness/assessments`, 110 `GET /data-readiness/assessments/:id`) went with the Data Readiness Agent, Assess Data Readiness and the `data-readiness` module ([workflows](../capabilities/workflows/spec.md) R50). The route numbers are retired and not reused; the stored reports table is dropped at start-up ([data-model.md](data-model.md) 3.15, M17). A request to those paths answers the framework's 404.

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
  - 400 `Synthetic data supports PostgreSQL and Databricks datasources; "<name>" is an Excel / CSV datasource.` (or `… is a REST API datasource.`)
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

The Server-Sent-Events endpoints are those of workflow runs (3.6); the chat stream (3.1) and the ontology bootstrap stream (3.4, 2026-11-26) were removed. They are POST, so they are read with `fetch` + `response.body.getReader()` and a `TextDecoder`, **not** `EventSource`. One background-job pattern uses start + poll instead of SSE (eval runs).

### 3.1 Chat stream (removed in 1.23.27)

`POST /sessions/:id/messages/stream` was removed in 1.23.27. The framing, request fields that survive (none since 2026-11-26) and event types below are those a run streams on `POST /workflows/:id/runs/stream` (3.6), kept here as the reference they cite.

**Request.** `Content-Type: application/json`

```ts
interface StreamMessageRequest {
  content: string;                 // required, trimmed, non-empty
  // (`activeVisualizationId` and `careful` were removed 2026-11-26, ADR-0059: a request carrying them has them ignored)
}
```

**Response headers.** `Content-Type: text/event-stream; charset=utf-8` (the charset is explicit so every client decodes `…` and other non-ASCII text as UTF-8; without it Chromium's network layer falls back to Windows-1252), `Cache-Control: no-cache`, `Connection: keep-alive`; headers are flushed immediately, so the HTTP status is **always 200** once the handler runs. Consequently *every* failure, including an unknown session or an empty message, arrives as an in-stream `error` event, not as a 4xx.

**Framing.** Each event is a single `data: <JSON>\n\n` frame. No `event:` or `id:` fields, no `retry:`. While a stream is open the server writes the comment frame `: ping\n\n` every 15 s (`SSE_HEARTBEAT_MS`) so a proxy or the OS does not drop a silent stream (a long SQL statement, a model call that streams nothing); it is not an event (no `data:` line, no `seq`, never logged) and a re-attach replays exactly the events it replayed before. Readers split on `\n\n`, take the line starting with `data: ` and `JSON.parse` it; a frame with no `data:` line (the heartbeat) and malformed frames are skipped.

**Event envelope.** `{ type, content?, session? }`. `content` is a string; for `tool`, `tool-result`, `visual-updated`, `panel-item`, `workflow` it is itself **a JSON-encoded string** (double encoding) that the client parses.

| `type` | Payload | Meaning |
|---|---|---|
| `reasoning` | `content: string` (delta) | Model reasoning text delta, for a live "thinking" display. Not persisted. Empty deltas are not emitted. |
| `text` | `content: string` (delta) | Answer text delta. Concatenation of all `text` deltas is the streamed answer. One extra full-text `text` event may follow if a tool-only turn needed a synthesis pass. |
| `tool` | `content: JSON string` `{ name: string; rationale?: string; input?: string; agent?: string; teammate?: string }` | A tool call started. On an orchestrator's step (Avery, agents.md 2.21) her own calls carry `agent: 'chief-of-staff'`, a team call also `teammate` (the key of the agent it calls), and `input` is her brief or instruction, the skill she loads or the file she reads in it (`references/<file>`); the calls between a team call and her next own one are that teammate's and carry no `agent`. `rationale` is the assistant's plain-language reason (flattened, max 400 chars) and is sent **with the call**, before the result. `input` says what the call is about, flattened and clipped to 200 characters (on an orchestrator's team call, her whole brief as written, up to 2,000 characters): for the framework's skill tools the skill it loads (`skill`: its `name`; `skill_read`: `<skillName>/<path>`; `skill_search`: the query), else the call's first text argument; omitted when there is none. Legacy clients may receive a bare tool name instead of JSON; readers must fall back to treating non-JSON content as the name. Not emitted for `ask_clarification`. |
| `tool-result` | `content: JSON string` | A tool call finished. For data tools (`run_readonly_sql`, `sample_rows`): `{ tool, input?, rowCount?, error?, rationale? }`. **Every other tool** (`list_entities`, `describe_entity`, `skill`…) emits `{ tool, error? }` when its call ends, so no call is left looking unfinished. An orchestrator's team call (Avery's, agents.md 2.21) also carries `reply`: what the teammate handed back, in their own words (Michael's reply as he wrote it; another teammate's tool result), trimmed, at most 2,000 characters; absent when empty. Row data is not streamed, only persisted in the final message. |
| `visual-updated` | `content: JSON string` `VisualEvent` `{ visualId, version, title, action: "created"\|"updated" }` | **No longer sent** (2026-11-26, ADR-0059): no agent has a visual tool. The type stays so a client that reads an old stream does not break. |
| `panel-item` | `content: JSON string` `PanelItemEvent` `{ item: PanelItem }` ([data-model.md](data-model.md) 3.4.4) | **No longer sent** (2026-11-26, ADR-0059): no agent has `show_in_panel`. The type stays so a client that reads an old stream does not break; a stored panel item is read from the session. |
| `workflow` | `content: JSON string` `WorkflowView` `{ phases: { number, title, skill? }[], source: "prompt"\|"agent"\|"workflow", current: number\|null, done: number[], skipped: number[], waiting?: boolean, note?: string, failed?: number }` ([data-model.md](data-model.md) 3.4.4) | The session's workflow changed this turn: after an `update_workflow` result without an error, and on a turn of a code workflow after each step of it starts, ends or fails ([agents.md](agents.md) 5.12; these stand alone, between the turn's other events). `show_in_panel` never sends it. It carries the whole view, not a delta. It never creates a panel item and does not open the right panel. The client patches the session's `workflow` live, so the workflow bar moves while the turn streams; the persisted view arrives with `done` ([agent-panel](../capabilities/agent-panel/spec.md) R19). Every agent. |
| `done` | `session: SessionDoc` | **Terminal, success.** The persisted session with this turn's messages. |
| `error` | `content: string` | **Terminal, failure.** Human-readable message (`"message is required"`, `"Session <id> not found"`, provider/model errors). |

**Ordering.**

```
[reasoning* | text* | (tool → [visual-updated | panel-item | workflow] → tool-result)*]  interleaved in model order
 → (optional silent post-processing)
 → done            or            error
```

- `tool` always precedes its own `tool-result`; parallel/interleaved calls are possible. `visual-updated`, `panel-item` and `workflow` precede the matching `tool-result`.
- After the model stream ends there can be **silent server-side steps with no events**: a tool-disabled synthesis pass (only if the turn produced no text; emits one `text` event with the result, or falls back to the fixed message `"I completed the data analysis but could not produce a final response. Please retry your question."`), and the verified-query match. No keepalive is sent during them.
- **The streamed deltas are not authoritative.** A repair round (Elena's, agents.md 2.23) may replace the answer text after it was already streamed. The client must replace its whole message list with `done.session` rather than keep the deltas.

**Termination.**

- The server writes `done` or `error` and then ends the response. A reader that sees end-of-stream with neither terminal event treats it as a failed stream (the shipped client reports `"Stream ended before completion"`).
- `done` is also sent when the turn ended on a **clarification** (see below). It is *not* sent when the client aborted.

**Persistence and side effects.**

1. The user message is persisted **before** the model starts (so a stop during provider connect still keeps the prompt). If the transcript already ends with that exact unanswered user prompt (retry after a failed turn) it is reused, not duplicated.
2. On completion one assistant message is appended and persisted: `content` = answer text plus `data`, `entities`, `interpretation`, `reasoning`, `knowledge`, `verified` as applicable (`visual` and `crossCheck` are stored data of old answers only, never written by a new turn).
3. `ask_clarification` ends the turn immediately: the server aborts the model run, persists an assistant message whose `content` is the question and whose `clarification` holds `{ question, options }` (carrying any `data`/`entities`/`reasoning`/`knowledge` gathered before the question), and emits `done`. The user's pick arrives as the next message.
4. Zero text and no visual: nothing is appended (the user message remains).

**Abort / stop.**

- The client stops by aborting the `fetch` (`AbortController`). The server listens for the response `close` event and aborts the model turn. No further events are sent and **no `done`/`error` is emitted**.
- Whatever text had already streamed is still persisted as a (partial) assistant message together with captured `data`; the client should reload the session (`GET /sessions/:id`) to show the persisted state; the shipped chat does this.
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
- Runs started by the CLI runner (6.2, `source: 'cli'`) are persisted too and listed here (agents-evals R113).

### 3.4 Ontology bootstrap stream (removed 2026-11-26)

`POST /datasets/:name/ontology/bootstrap/stream` (54) was removed with the bootstrap ([agents.md](agents.md) 2.5). The section number is kept so the references stay stable.

### 3.5 Other long-running calls (no progress channel)

| Call | Behaviour |
|---|---|
| `GET /datasources/:id/inventory?refresh=true` (or first load) | Synchronous live walk; can take minutes on a cold warehouse. |
| `POST /testing-data/:id/load` | Synchronous; up to ~120 s seed timeout plus inventory walk. |
| `PUT /llm/settings`, `POST /llm/test-connection` | Synchronous; 30 s provider timeout. |
| `POST /llm/models` | Synchronous; 15 s timeout (custom endpoint or Copilot runtime). |
| `GET /llm/copilot/status` | Synchronous; the first call starts the local Copilot runtime (a few seconds). |

### 3.6 Workflow run stream: `POST /workflows/:id/runs/stream`

**Request.** As 118: `{ input, context?: { fromRunId } }`. Every refusal (118's list) is answered with its real status before the stream starts, unlike the chat stream.

**Response headers and framing.** As 3.1: `text/event-stream; charset=utf-8`, flushed at once; one `data: <JSON>\n\n` frame per event, with 3.1's `: ping` heartbeat between them (also on 149). On 119, 138 and 149 each frame's JSON also carries `seq`, the event's number in the run's log (from 1; ADR-0048), to follow the run again after it with 149 (`after=<seq>`); 129 sends no `seq`.

**Events, in order.**

| `type` | Payload (beside `type`) | Meaning |
|---|---|---|
| `run` | `runId: string`, `workflowId: string` | First frame: the run was accepted and stored (`queued`, ADR-0057); it may start at once or wait. |
| `queued` | none | Sent after `run` when no slot is free: the run waits for one. When a slot frees and the run starts, the `step` events follow with no further marker. |
| `step` | `WorkflowRunStep`: `id`, `title`, `status: 'running' \| 'suspended' \| 'success' \| 'failed' \| 'skipped' \| 'stopped'`, `attempt?`, `input?`, `inputTruncated?: true`, `output?`, `outputTruncated?: true`, `error?`, `startedAt?`, `endedAt?`, `toolCalls?`, `story?` (below) | A step of the workflow started (`running`) or ended. A started step carries what it received (`input`, the engine's step-start `payload.payload`; `inputTruncated` instead when it is larger than 20 000 JSON characters) and `startedAt`; an ended one keeps them and adds `endedAt`. `success` carries the step's output (`outputTruncated` instead when it is larger than 20 000 JSON characters); `failed` its error; an agent step fed by an agent turn carries its `toolCalls` so far; `stopped` a step that ended the run early (an agent step stopped by the user or ended on a clarifying question); `suspended` a step that waits for the user's answer (Avery + Michael's Orchestrate after Avery's `ask_clarification`; ADR-0043), keeping its `input` and `startedAt`, with no `endedAt`. A resumed step (138) is sent `running` again in the same entry and `attempt`, with its `input`, `startedAt` and earlier `toolCalls`. A step inside a loop (117 `edges`) carries `attempt` (1, then 2 when it runs again) on every event; a new run of it starts a new entry rather than replacing the first. When the run ends, a step that never started is sent as `skipped` (with no `attempt`: the branch not taken, or the steps after a stop or a failure), and one still running as `stopped` (the run stopped) or `failed` (the run failed); a run that waits sends no `skipped` steps. A step that ended or was skipped carries its `story` (below). Every step event of the run is sent, whatever the workflow's `bar`; the engine's events of v2's nested workflows (`plan-round`, `analysis-path`, `analysis-attempt`, `answer-path`) and its mapping step `plan-round-outcome` are not steps and are never sent. |
| `input-required` | `runId: string`, `stepId: string`, `title: string`, `question: string`, `options: string[]`, `expiresAt: string` | The run waits for the user (ADR-0043): sent after the waiting step's `suspended` `step` event and before `done`, whose `run` is `suspended` with the same values in `waitingFor`. `options` are the clarifying question's options, each `<title>` or `<title> — <explanation>`; `expiresAt` (ISO) is when the run stops being answerable (30 minutes after it started waiting). Answer it with 138. |
| `reasoning`, `text`, `tool`, `tool-result`, `visual-updated`, `panel-item`, `workflow` | as 3.1 (`content`) | Agent workflows: the agent turn's events, unchanged, interleaved with the `step` events. 3.1's `done { session }` is never sent. For Avery + Michael, `text` is the answer: Michael's written answer, then Avery's closing words; his `reasoning`, `tool` and `tool-result` events stream as usual. |
| `done` | `run: WorkflowRun` | **Terminal, success** (also for a code-only run whose step failed, and for a run that waits for the user: `run.status: 'suspended'`; the stream then closes). |
| `error` | `content: string` | **Terminal, failure** of an agent turn: the chat stream's message for the same failure (a custom endpoint's R50 text, a provider error, `No API key configured…`). |

```ts
type WorkflowRun = {
  id: string;                      // the run id; the host is `run-<id>`, the workspace `session-run-<id>`
  workflowId: string;
  workflowName: string;            // the workflow's name when the run started
  contractHash?: string;           // 117's contractHash when the run started; absent on runs stored before 2026-11-13 and on draft runs (R12)
  input: Record<string, string | number | boolean | string[]>;   // the checked input (defaults filled)
  context?: { fromRunId: string };   // the follow-up context (118)
  conversationId?: string;         // Answer a Business Question (Avery + Michael) only (workflows R45): the first run's id; a run with no `context.fromRunId` starts a conversation, a follow-up joins its earlier run's
  archivedAt?: string;             // ISO: its conversation was archived (159); set on every run of it, removed by 160
  status: 'queued' | 'running' | 'suspended' | 'success' | 'failed' | 'stopped';   // 'queued': accepted, waiting for a free slot, or re-queued after a restart (ADR-0057); 'running' only while it runs (121); done.run is never 'queued' or 'running'; 'suspended' while it waits for the user's answer (138)
  queuedAt?: string;               // ISO: when 119 accepted it; absent on runs stored before ADR-0057 (no migration)
  attempts?: number;               // times the run has started: 1 on its first start, up to 3 (a restart starts it again from scratch); absent while never started and on legacy runs; run-level, distinct from a step's `attempt`
  steps: WorkflowRunStep[];        // status 'success' | 'failed' | 'skipped' | 'stopped' once the run ended; catalogue order, a repeated step's attempts one after the other; a suspended run lists only the steps that ran or wait (no 'skipped')
  output?: Record<string, unknown>;   // success: the last step's output (for v2 Wrap up's `{ sqlQueries, failedQueries, rows, answer }`)
  error?: string;                  // failed
  waitingFor?: {                   // a suspended run (ADR-0043); kept with `expired` once it can no longer be answered; removed when it is resumed
    stepId: string;                // the waiting step: 'orchestrate' (Avery's question, agents.md 5.23)
    title: string;                 // its title: 'Orchestrate'
    question: string;
    options: string[];             // each '<title>' or '<title> — <explanation>'
    since: string;                 // ISO: when it started waiting
    expiresAt: string;             // ISO: since + 30 minutes
    expired?: true;                // it expired, or the app restarted: the run is 'stopped'
  };
  // Avery + Michael runs only:
  question?: string;               // the user message the agent received (`question`), trimmed
  answer?: ChatMessage;            // the assistant message the turn persisted on the host (data-model 3.4.1): Michael's text followed by Avery's closing words (a run stored before 2026-11-13 may hold a clarifying question with its `clarification`); absent while it waits, and when it stopped or failed before answering
                                   // an Avery run's `answer.dashboard` (2.6.4) and `answer.export` (2.6.5, 167): the dashboard and the conversation export that turn made
                                   // answer.evidence?: QueryEvidence[] (data-model 3.4.2a): one entry per run_readonly_sql, sample_rows or explore_result record of answer.data (an explore_result entry carries its view: ResultView), failed ones included, in data order; set at persist, built by 139 for an answer stored before it, patched only by 139-141 under the run's answer lock
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
// startedAt: set at insert (= queuedAt) and set again each time the run starts; the history order (120) is startedAt, newest first.

type WorkflowRunStep = {
  id: string;
  title: string;
  status: 'running' | 'suspended' | 'success' | 'failed' | 'skipped' | 'stopped';   // 'suspended': it waits for the user's answer (138)
  attempt?: number;                  // a step inside a loop: 1, or 2 when it runs again; absent on any other step and on a skipped one
  input?: Record<string, unknown>;   // what the step received (the engine's step-start `payload.payload`), when its JSON is at most 20 000 characters
  inputTruncated?: true;             // instead of `input` when it is larger
  output?: Record<string, unknown>;  // at most 20 000 JSON characters
  outputTruncated?: true;
  error?: string;                    // failed; a contract violation reads `Contract violation in <title>[ (input)]: <path> <message>` (below)
  startedAt?: string;                // ISO; absent for a skipped step
  endedAt?: string;                  // ISO; absent while running and for a skipped step
  toolCalls?: WorkflowRunToolCall[]; // agent steps fed by an agent turn: their calls in order, at most 50; absent when none
  story?: StepStory;                 // what the step did, in business words (ui.md 4.4b, Story in the node dialog; How it ran); absent while running or suspended
};

type StepStory = {
  headline: string;     // one sentence: what the step did, or why it did not run
  facts?: { label: string; values: string[]; code?: true; verdict?: 'passed' | 'failed'; sql?: string }[];   // `sql`: a query fact's statement (at most 4 000 characters), to open it among the answer's queries
  next?: string;        // what came next because of it (a branch taken, a retry)
  stats?: { value: string; label: string }[];   // the run's figures this step accounts for (How it ran)
  brief?: string;       // a few words for the canvas node: `9 tables`, `3 queries · 1 failed`, `1 of 5 checks failed`, `Off for this run`, `Not reached`
  concern?: true;       // it finished but left something to look at: a failed check, quality issues, an analysis without a query
  source: 'step' | 'generic';  // `step`: the workflow's own storyteller; `generic`: its output fields labelled by their schema descriptions
};

type WorkflowRunToolCall = {
  tool: string;
  input?: string;       // the `tool-result` input (the SQL), else the `tool` event's (3.1); at most 2 000 characters
  rowCount?: number;    // from the `tool-result`
  error?: string;       // from the `tool-result`
  durationMs?: number;  // from the `tool` event to its `tool-result`; absent when no result came
  rationale?: string;   // the `tool` event's `rationale`: why the agent made the call; at most 400 characters
  agent?: string;       // the `tool` event's `agent`: who made the call, when the step's agent delegates (Avery signs her own calls `chief-of-staff`); absent on a teammate's call, which follows the team call that hands it the work
  teammate?: string;    // the `tool` event's `teammate`: on a team call, the registry key of the agent it calls
  reply?: string;       // the `tool-result`'s `reply`: on a team call, what the teammate handed back, in their words; at most 2 000 characters
};
```

`panelItems`, `workflow` and `agent` are derived on every read (121) and never stored; the stored run is [data-model.md](data-model.md) 3.16. Runs stored before the step `input`, times and `toolCalls` existed lack them. A step's tool calls come from the turn's `tool` and `tool-result` events: each call belongs to the agent step running when its `tool` event arrives, and a result ends the first unfinished call of the same tool; a result without a call is kept as a call with no `durationMs`. A deep analysis's agent steps have no `toolCalls` (their calls are not turn events).

A step's `story` is told by the server, never by a model call, when the step ends (from its full output, before the 20 000-character cap) or when the run ends and marks it `skipped`, `stopped` or `failed`; it travels on that `step` event and is stored with the run. Every step gets the generic story (`workflow-story.ts`): a failed step its error, a skipped one `Skipped: the run took another path.`, and one that the run never reached because it stopped or failed `Did not run: the run was stopped|failed before it got here.`. A run stored before stories gets them told from its stored data when it is read (121), not stored back.

**Contract violations** ([agents.md](agents.md) 5.12; workflows R26). A step whose input or output breaks its declared schema (117's `inputSchema` / `outputSchema`) fails with the error `Contract violation in <Step title>: <path> <message>` for its output and `Contract violation in <Step title> (input): <path> <message>` for its input, checked before it runs. `<path>` is always one word: the first failing field, dotted with indices (`calls[2].rowCount`), or `(root)` when the whole value is wrong; `<message>` is Zod 4's (`Invalid input: expected number, received string`). Only the first problem is named. The failing step's `step` event is `failed` with that `error`, the later steps are `skipped`, the run is stored `failed` with the same `error`, and the stream ends with `error { content }` carrying it. Example: `Contract violation in Explain report: calls[2].rowCount Invalid input: expected number, received string`; `Contract violation in Resolve dataset (input): datasets Invalid input: expected array, received string`; `Contract violation in Explain report: (root) Invalid input: expected object, received string`.

**Stop.** Stop is 150 (ADR-0048): the server aborts the agent turn, whose events end there; the run is stored as `stopped`, with the partial answer the host persisted, if any, and its log ends with `done { run }` (`stopped`). **Closing the connection detaches**: the client stops following, the run goes on, and 149 follows it again. Only Try it (129) and a step's chat (137) still stop when their connection closes, as 3.1.

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

**Backend output capture.** The backend child's stdout (fallback level `info`) and stderr (`error`) are mirrored to the process streams and turned into entries, ANSI colour stripped. A JSON line with a `message` field becomes an entry with source `backend:mastra` (its `level` honoured, other fields as `details`). Any other line starts an entry with source `backend` when it is a Nest log line (`[Nest] <pid>  - `), a Mastra pretty-printed line (`ERROR [2026-11-15 20:29:11.573 -0500] (Mastra): …`), a `(node:<pid>)` warning, or the first line after 40 ms of quiet on that stream; every following line (stack frames, `{`, `}`, `^`, indented text, the `(Use …)` hint) is appended to that entry's `details` as one newline-joined string. The entry's level is inferred from its first line (`ERROR|FATAL`, `WARN|WARNING|…Warning`, `DEBUG`, else the stream's fallback). A pending entry is flushed after 40 ms of quiet and when the stream ends (`frontend/electron/log-lines.cjs`).

### 4.3 Backend supervisor and readiness signal

| Item | Value |
|---|---|
| Spawn | Electron's own binary with `ELECTRON_RUN_AS_NODE=1` running `backend/dist/main.js` (packaged: `<resources>/backend/dist/main.js`); `stdio` piped; env passes `PORT`, `APP_DATA_DIR`, `APP_SECRET`, `DESKTOP_PARENT_PID` (the main process's PID) and `BACKEND_INSTANCE_ID` (a fresh random UUID per spawn), and nothing else. The child's PID is written to `<APP_DATA_DIR>/backend.pid` ([data-model.md](data-model.md) 1.2) and the file is removed when that child exits or is killed. Missing entry file records an error diagnostic and does not start. |
| Readiness probe | `GET http://127.0.0.1:<BACKEND_PORT>/health` (135), **ready iff status 200 and the `X-Backend-Instance` response header equals the `BACKEND_INSTANCE_ID` of the child just spawned**; 500 ms request timeout; retried every 100 ms until a **30 s** deadline. A 200 without the matching header means another process holds the port: the probe keeps failing and one error diagnostic per spawn is recorded (`Port <port> is answered by another process, not this app's backend`). |
| Stale backend | Before the first spawn, a PID read from `<APP_DATA_DIR>/backend.pid` is checked: if that process is alive and its image name is the main process's executable name (`tasklist` on Windows, `ps` elsewhere), it is killed, waited for (up to 5 s) and a warning diagnostic `Stopped a backend left running by an earlier launch` is recorded; the file is then removed. A dead PID, a different image or an unreadable file only removes the file. |
| Orphan exit | A backend started with `DESKTOP_PARENT_PID` checks every 2 s whether that process is still alive (`process.kill(pid, 0)`; `EPERM` counts as alive) and exits with code 0 once it is gone. |
| Single instance | The main process takes Electron's single-instance lock (keyed by `userData`) before anything else starts. A second launch with the same profile exits at once; the first instance restores and focuses its window (or opens one if none is open). |
| Startup | status `starting` → spawn → probe. Ready → `ready`. Deadline missed → error diagnostic, **window opens anyway**, probing continues in the background and pushes `ready` when it succeeds. |
| Crash handling | Any exit not caused by app quit → status `restarting`, restart after back-off **1 s, 2 s, 4 s** (3 attempts), re-probing after each start. Attempts exhausted → status `down` (error diagnostic, no further restarts). Exit code `98` is the exception (next row). |
| Port in use | When `listen` fails with `EADDRINUSE`, the backend prints one line (`Port <n> is already in use by another process`) and exits with code **98** (`PORT_IN_USE_EXIT_CODE`, `backend/src/infrastructure/process/exit-codes.ts`; the shell repeats the value in `frontend/electron/backend-exit.cjs`). On code 98 the shell schedules no restart: status `down` at once and one error diagnostic naming the port and saying another program (or another copy of the app) is using it. The CLI (web mode) is unchanged and exits 1. |
| Stability reset | Backend continuously ready for **60 s** resets the attempt counter. |
| Requested restart | `backend:restart` (4.2): kill and immediate respawn, outside the crash back-off. |
| Quit | `before-quit` sets a quitting flag (suppresses restarts), kills the backend and removes `backend.pid`. On non-macOS the app quits when all windows close. |
| Port | `BACKEND_PORT` env (default `3000`) used for both the child's `PORT` and the probe. The renderer's base URL does not honour it (G1). |

The renderer maps `down`/`restarting`/`starting` to a status banner; see [ui.md](ui.md) and the app-shell capability.

### 4.4 Data directory and secret (desktop)

- `userData` is `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR` when set (E2E isolation); otherwise the OS per-user app dir, preferring the current app-name folder and falling back, when that folder does not exist, to the newest pre-rename legacy folder that does (`Halo BI Assistant`, then `Questions to Insights`; brand.json `legacyOsNames`). The app display name is "Halo Workbench".
- `APP_DATA_DIR` passed to the backend equals `userData`, except on Windows (no isolation override, `LOCALAPPDATA` set) where it is `%LOCALAPPDATA%\Halo Workbench` (or, when that does not exist, the newest existing `%LOCALAPPDATA%\<legacy name>`, used in place); otherwise existing `app.sqlite`, `mastra.sqlite`, `workspaces` are migrated there once (rollback on failure, continues on roaming profile).
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
| `EVAL_DATASETS` | `mastra/evals/run-evals.ts` (CLI eval script only, `npm run evals`) | Comma-separated dataset names to run the evals against. Required by that script. Every `EVAL_*` run is saved to `eval_runs` (`source: 'cli'`) and printed as `Saved as eval run <jobId>` (agents-evals R113). | none |
| `EVAL_SET` | `mastra/evals/run-evals.ts` (CLI eval script only) | The question set to run (`world-cup`, `world-cup-rest`, `world-cup-excel`, `formula-1`, `insights-lead`, …). That script needs this or `EVAL_CASES`, not both ([agents.md](agents.md) 8.5). | none |
| `EVAL_CASES` | `mastra/evals/run-evals.ts` (CLI eval script only) | Comma-separated eval case ids to run instead of a whole set; all from one set's fixture. | none |
| `EVAL_LLM_PROVIDER`, `EVAL_LLM_API_STYLE`, `EVAL_LLM_BASE_URL`, `EVAL_LLM_API_KEY`, `EVAL_LLM_MODEL` | `mastra/evals/run-evals.ts` (CLI eval script only) | `EVAL_LLM_PROVIDER=custom` runs the evals on a custom endpoint instead of the saved LLM settings: API style (`openai` \| `anthropic`), base URL and model required, key optional ([agents.md](agents.md) 8.5). | unset (saved settings) |

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
- **G2. `POST /sessions/:id/messages` is unused** by the frontend and is a degraded duplicate of the streaming path (no tool-data capture or clarification). Open question: keep as a public non-streaming API or remove.
- **G3.** (Removed 2026-11-26 with the ontology bootstrap, 53 and 54.)
- **G4. Eval run recovery.** In-flight run state lives in memory with write-through persistence per question. Open question: what status a run left `running` by a crash shows after restart (no reconciliation code was found).
- **G5. Frontend type drift.** The frontend `EvalRunView` omits `comparison` (present on the wire, only used in the Markdown report). The frontend `getEvalRun` result is a loose merge type.
- **G6. No cascade.** Deleting a datasource leaves datasets pointing at it; deleting a dataset deletes its own ontology items but leaves sessions that name it. Behaviour of such dangling references is not specified in the API.
- **G7. `POST /sessions` does not verify the named datasets exist.** Open question whether that is intended.
- **G8. Error-style inconsistency.** Style A (`200 { ok:false }`) vs Style B (real 4xx) is endpoint-specific and also differs in list shapes (`{ sessions }`, `{ datasources }`, `{ metrics }`, `{ datasets }`, bare array for ontology, bare `SessionDoc`). Several read endpoints (`GET /datasources`, eval-run listing) can still return a framework 500.
- **G9. Request body size.** The JSON body limit is 8 MB (`JSON_BODY_LIMIT`, `app-bootstrap.ts`; since 2026-11-15, so a run's 5 MB image fits as base64, 118), up from the framework default (about 100 kB); large dataset snapshots in `POST /datasets` could exceed it. Not verified against a real large dataset.
- **G10. Desktop backend bind address.** `main.ts` calls `createApp` without a host, so the Electron-spawned backend listens on **all interfaces** with CORS enabled and no authentication (G14); only the CLI binds `127.0.0.1` by default. Kept by the user's choice (ADR-0030).
- **G11. `message` timing on feedback.** `POST …/messages/feedback` with `up` reports `"Answer saved as a verified query"` even when the answer had no SQL and nothing was saved.
- **G12. Spec of `PUT /metrics/:id` not-found** is thrown as a 400-class exception but surfaced inside the `ok:false` envelope, so clients cannot distinguish "not found" from validation by status.
- **G13. Dev-mode API routing.** For `ng serve` the client uses relative URLs and the repo has no Angular proxy config, so API calls from a bare `ng serve` page hit the dev server, not the backend. Under `electron:dev` the window loads `http://localhost:4200` (protocol `http:`), so the same relative-URL problem applies. Open question: how the live-reload dev flow reaches the backend (no proxy or `API_BASE_URL` override found).
- **G14. No authentication, so reachability is the only boundary.** Anyone who can reach the backend has full access as the super admin, including the stored LLM key's use (the key itself is never returned) and the developer settings. The desktop backend listens on all interfaces (G10) and `--host 0.0.0.0` does the same for the CLI ([non-functional.md](../product/non-functional.md) section 3, ADR-0030).
- **Not an HTTP surface:** verified queries (saved via feedback), the Mastra Studio, and the workspace filesystem have no endpoints of their own.

# API contract

The complete contract between the renderer (or any HTTP client) and the backend, plus the desktop IPC bridge, the CLI and the environment. Persisted document shapes (session, dataset, datasource, metric, knowledge snippet, verified query, LLM settings, eval run) live in [data-model.md](data-model.md); this file links to them and only restates a shape where the wire format differs from the stored one.

Contents: [1 Conventions](#1-conventions) · [2 Endpoints](#2-endpoints) · [3 Streaming and long-running work](#3-streaming-and-long-running-work) · [4 Desktop bridge (IPC)](#4-desktop-bridge-ipc) · [5 CLI contract](#5-cli-contract) · [6 Environment variables](#6-environment-variables) · [7 Gaps and open questions](#7-gaps-and-open-questions)

Endpoint total: **57 HTTP route handlers** across 9 controllers (sessions 14, datasources 6, metrics 5, llm 4, datasets 3, agents 13, deep analysis 3, testing data 3, knowledge 6). Verified queries have **no** HTTP surface (they are created and removed as a side effect of message feedback, and read by the metrics promotion path). Multi-user support adds 33 routes: the auth and current-user routes (2.13, 7: three for org server mode only, three for local mode only, and `GET /me`), the SCIM routes (2.14, 14, org server mode only) and the admin routes (2.15, 12, both modes). A route of one mode answers 404 in the other (1.9).

---

## 1. Conventions

### 1.1 Base URL

| Mode | How the client reaches the API |
|---|---|
| Web (`npx` / CLI, same origin) | The backend serves the built UI itself. Client uses **relative URLs** (empty base), e.g. `/sessions`. |
| Desktop (Electron renderer, `file://`) | Client uses `http://localhost:3000` (hardcoded). The backend child process listens on `PORT`, which the main process sets from `BACKEND_PORT` (default `3000`). See gap G1: a non-default `BACKEND_PORT` breaks the renderer. |
| Dev (`ng serve` / `electron:dev`, page served from `http://localhost:4200`) | Protocol is `http:`, so the client uses relative URLs against the dev server. No proxy or override exists in the repo (G13). |

The client rule is: `API_BASE_URL = (window.location.protocol === 'file:') ? 'http://localhost:3000' : ''`. All paths below are relative to that base. There is no API prefix and no versioning. Authentication exists in both modes (1.9): a session cookie on an org server, a bearer token in local mode.

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

POST handlers return the framework default **201 Created**, except where an endpoint states **200**: the two SSE endpoints (5 and 54, 200 once the stream starts, whatever it then carries), `POST /developer-settings/test-endpoint` (55), `POST /testing-data/:fixtureId/load` (56), `POST /auth/logout` (63) and `POST /admin/agents/transfer` (86); `POST /admin/role-assignments` (79) and `POST /admin/role-mappings` (89) answer 200 when nothing was written. GET/PUT/DELETE return **200**; `DELETE /knowledge/:id` returns **204 No Content**. The file downloads write the response themselves and return **200**. Clients treat any 2xx as success and do not depend on 200 vs 201.

### 1.5 Validation

- There is **no global validation pipe** and no DTO validation library. DTO classes (`SaveDatasourceDto`, `SaveMetricDto`, ...) are plain TypeScript shapes; nothing rejects extra or mistyped fields at the edge.
- Validation is done by services/controllers: fields are coerced defensively (`typeof x === 'string' ? x : ''`), trimmed, and checked with explicit `BadRequestException`s. Rules per endpoint are listed in section 2.
- Unknown body fields are ignored. Missing body is treated as `{}`.
- Query params are strings. Booleans are accepted only as the literal `"true"`. The knowledge list drops unrecognised filter values instead of rejecting them.

### 1.6 CORS

| Mode | CORS |
|---|---|
| Desktop (`main.ts`, Electron-spawned backend) | **Enabled** (`app.enableCors()`, allow-all) because the renderer's origin is `file://` (`Origin: null`). Preflights reflect the requested headers, so the `Authorization` header of a local auth session (1.9) is allowed. |
| Web / CLI | **Disabled**. Same-origin only. |
| Org server (CLI in org server mode) | **Disabled**. Same-origin only, plus the Origin check of 1.9. |

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

### 1.9 Authentication, authorization and CSRF

Rules: [admin](../capabilities/admin/spec.md) R1-R36 and R69-R74 (the admin screens: R37-R68). Decisions: ADR-0010, ADR-0011 and ADR-0012 in [architecture.md](architecture.md).

**Mode.** The server runs in org server mode when every required `ORG_*` variable (6.1) is set, and in local mode when none is. Some but not all is a startup error naming the missing ones. The Electron-spawned backend is always local (4.3).

**Local mode.** The auth session travels as `Authorization: Bearer <token>`, the token answered by `POST /auth/local/sign-in` (2.13); no cookie is set or read. 401 and 403 answer exactly as in org server mode (below). There's no Origin check. Every request runs as the signed-in persona (admin R69), with owner scoping as on an org server. The org auth routes (`GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`) and SCIM (2.14) answer `404 { statusCode:404, message:"Not available in local mode", error:"Not Found" }`; `GET /me`, the local sign-in routes and the admin routes (2.15) are available. In org server mode the local sign-in routes answer the same 404 with `message:"Not available in org server mode"` (admin R73).

**Cookies** (org server mode). Both `HttpOnly`, `SameSite=Lax`, and `Secure` unless `ORG_PUBLIC_BASE_URL` starts with `http://`.

| Cookie | Path | Holds | Lifetime |
|---|---|---|---|
| `qti_session` | `/` | The auth-session token: 32 random bytes, base64url. The server stores only its SHA-256 ([data-model.md](data-model.md) 3.14.6). | Session cookie (no `Max-Age`); the server ends it after 8 h idle or 7 days (admin R9). |
| `qti_oidc` | `/auth` | The sign-in round trip: `state`, `nonce`, the PKCE verifier and `returnTo`, sealed with the app secret (AES-256-GCM, as in [data-model.md](data-model.md) 2.3). | `Max-Age=600`; cleared by the callback. |

**Unauthenticated.** Any route other than the public ones below, called without a valid auth session (`qti_session` in org server mode, the bearer token in local mode), answers:

```json
{ "statusCode": 401, "message": "Sign in required", "error": "Unauthorized" }
```

The check runs before the handler, so Style A endpoints (1.3) also answer a real 401. The static web UI (1.7) is public: the SPA loads, calls `GET /me`, gets 401 and shows the sign-in page.

**Forbidden.** A signed-in caller without the route's permission gets, before the handler runs and with nothing changed:

```json
{ "statusCode": 403, "message": "Missing permission: <permission id>", "error": "Forbidden" }
```

The renderer shows its own toast for any 403 (`You don't have permission to do this.`, [ui.md](ui.md) 1.6), not this message.

**CSRF.** In org server mode every request whose method is not `GET` or `HEAD` must carry `Origin` (else `Referer`) whose origin equals `ORG_PUBLIC_BASE_URL`; otherwise `403 { statusCode:403, message:"Cross-site request refused", error:"Forbidden" }`. SCIM routes are exempt.

**Proxy.** In org server mode the app trusts the first proxy hop (`X-Forwarded-Proto`, `X-Forwarded-For`, `X-Forwarded-Host`), so redirects and the `Secure` cookie work behind the organisation's TLS proxy.

**Current user.** Each request, in either mode, reads its auth session (one store read), checks that the user is still active, resolves their roles and permissions (admin R20, R21) and runs the handler as that user. Work started by the request (streams, deep analysis, eval runs, knowledge bootstrap) keeps that user (admin R32).

**Permission per route.** Every route declares exactly one requirement, on the handler or on its controller (a handler's own requirement wins); a route with none stops the server at startup (admin R23). Private collections are also filtered by owner (admin R29, R30): another user's item answers as not found.

| Routes | Requirement |
|---|---|
| Every `/sessions` route (2.1), including the chat stream, feedback, visuals and deep analysis (2.7) | `use-agents` |
| `GET /agents`, `GET /agents/:key`, `GET /agents/:key/evals`, `PUT /agents/:key/pin` | `use-agents` |
| `POST /agents`, `PUT /agents/:id/draft`, `POST /agents/:id/publish`, `DELETE /agents/:id`, `POST /agents/:key/evals/run`, `GET /agents/:key/evals/runs`, `GET /agents/:key/evals/runs/:jobId`, `GET /agents/:key/evals/runs/:jobId/download`, `DELETE /agents/:key/evals/runs/:jobId` | `create-agents` |
| Every `/knowledge` route (2.8) and every `/metrics` route (2.4) | `use-agents` |
| `GET /datasources`, `GET /datasources/:id/inventory` | `use-agents` |
| `POST /datasources`, `POST /datasources/test-connection`, `POST /datasources/rest/discover`, `DELETE /datasources/:id` | `manage-datasources` |
| `GET /datasets` | `use-agents` |
| `POST /datasets`, `DELETE /datasets/:name` | `manage-datasources` |
| Every `/testing-data` route (2.9) | `manage-datasources` |
| `GET /llm/settings`, `GET /llm/effort-levels` | `use-agents` |
| `PUT /llm/settings`, `PUT /llm/reasoning`, `POST /llm/test-connection` | `manage-llm` |
| Every `/developer-settings` route (2.11) | `edit-policies` |
| `GET /ui-preferences`, `PUT /ui-preferences` (2.12) | `use-agents` (each user's own theme and drawer state) |
| `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`, `GET /auth/local/users`, `POST /auth/local/sign-in`, `POST /auth/local/sign-out`, `GET /me` (2.13) | public: no permission checked (`GET /me` answers 401 itself without an auth session) |
| Every `/scim/v2` route (2.14) | the SCIM bearer token, no auth session |
| Every `/admin` route (2.15): role assignments, overview and its export, users, user roles, agent transfer, groups and group mappings | `manage-users` |

`GET /llm/settings` leaves out `apiKeyMasked` (sends `null`) for a caller without `manage-llm`.

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


### 2.12 UI preferences

Controller prefix `/ui-preferences`. Capability: app-shell (R39–R43, R50). One `settings` document per data directory in local mode, and one per user on an org server (data-model 3.2.1; ADR-0009): each route reads and writes the caller's own.

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

### 2.13 Auth and current user

Controllers `/auth`, `/auth/local` and `/me`. Capability: [admin](../capabilities/admin/spec.md). Requirement: public (1.9). Routes 61-63 are org server mode only and 91-93 local mode only; each answers 404 in the other mode (1.9).

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 61 | `GET /auth/login` | Start sign-in (redirect to the identity provider) | yes (full-page navigation) |
| 62 | `GET /auth/callback` | Finish sign-in (redirect target registered with the identity provider) | no (the identity provider redirects here) |
| 63 | `POST /auth/logout` | Sign out | yes |
| 64 | `GET /me` | The current user, roles and permissions | yes |
| 91 | `GET /auth/local/users` | The personas to sign in as (local mode) | yes (sign-in page) |
| 92 | `POST /auth/local/sign-in` | Sign in as a persona (local mode) | yes |
| 93 | `POST /auth/local/sign-out` | Sign out (local mode) | yes |

```ts
type RoleId = 'user' | 'maker' | 'data-owner' | 'approver' | 'platform-admin';
type PermissionId = 'use-agents' | 'create-agents' | 'share-agents-team' | 'request-publishing' | 'approve-publishing'
  | 'approve-datasource-access' | 'manage-users' | 'edit-policies' | 'view-audit-log' | 'manage-datasources' | 'manage-llm';
interface HeldRole {
  role: RoleId;
  source: 'implicit' | 'direct' | 'group' | 'bootstrap';
  datasourceId?: string;   // data-owner only
  groupId?: string;        // source 'group' only
  assignmentId?: string;   // source 'direct' only; the id DELETE /admin/role-assignments/:id takes
}
interface MeView {
  mode: 'local' | 'org';
  user: { id: string; displayName: string; email: string | null; initials: string };
  roles: HeldRole[];
  permissions: PermissionId[];   // sorted, de-duplicated
}
```

#### 61. `GET /auth/login`
- Query: `returnTo` (optional). Kept only when it is a path starting with `/` and not `//`; otherwise `/`.
- Response `302` to the identity provider's authorization endpoint (from its discovery document) with `response_type=code`, `scope=openid profile email`, `client_id`, `redirect_uri=<ORG_PUBLIC_BASE_URL>/auth/callback`, a random `state` and `nonce`, and `code_challenge` (S256). Sets `qti_oidc` (1.9).
- Identity provider unreachable: `302 /?signInError=failed`.

#### 62. `GET /auth/callback`
- Query: `code` and `state`, or `error` from the identity provider.
- Checks: `qti_oidc` present and unsealed, `state` matches, code exchanged with the PKCE verifier, ID token signature, issuer, audience, expiry and `nonce` valid. When the issuer's first path segment is a tenant id (a GUID, as in `https://login.microsoftonline.com/<tenant id>/v2.0`), a `tid` claim that differs from it (case-insensitive) fails the sign-in (admin R7).
- Then finds or creates the directory user (admin R12, R13): match by stored `oidcSubject` (`tid` + `oid` claims for Entra ID, else `sub`), else by `preferred_username` against `userName`, case-insensitive. The `email` claim is never used to match a user or to resolve roles; it is stored for display only. A just-in-time user gets `userName` = `preferred_username`, else the subject (both lowercased). A user matched by `preferred_username` whose stored `oidcSubject` is set and differs from the token's subject is refused (admin R13): `302 /?signInError=failed`, the user is not changed, a warning is logged and a `sign-in.refused` event is recorded with `details: { reason: "subject-mismatch" }` ([data-model.md](data-model.md) 3.14.7); this check comes before the deactivation check. A user with no stored `oidcSubject` is matched and gets it. Updates `displayName`, `email`, `lastSignInAt`. A user with `active: false` is refused.
- Success: creates an `auth_sessions` document, sets `qti_session`, clears `qti_oidc`, records `sign-in` ([data-model.md](data-model.md) 3.14.7), `302` to the kept `returnTo`.
- Failure: clears `qti_oidc`, `302 /?signInError=deactivated` for a deactivated user, `302 /?signInError=failed` for anything else. No auth session.

#### 63. `POST /auth/logout`
- Origin check applies (1.9). Deletes the caller's auth session if any, clears `qti_session` (`Max-Age=0`), records `sign-out`.
- Response `200`: `{ ok:true, message:"Signed out", endSessionUrl: string | null }`: the identity provider's end-session endpoint with `client_id` and `post_logout_redirect_uri=<ORG_PUBLIC_BASE_URL>/`, or `null` when the provider has none. The renderer navigates there, or to `/` when `null`.
- Without an auth session it still answers `200` (signing out twice is harmless).

#### 64. `GET /me`
- Signed in: `200 MeView` with `mode:"org"` or `mode:"local"`. `initials` per [ui.md](ui.md) 1.3. A Data owner assignment or mapping whose datasource no longer exists is not listed and grants nothing ([data-model.md](data-model.md) 3.13).
- Local mode, signed in as Demo User: `200 { mode:"local", user:{ id:"local", displayName:"Demo User", email:"demo@local.test", initials:"DU" }, roles:[{role:"user",source:"implicit"},{role:"platform-admin",source:"bootstrap"}], permissions:<all eleven> }`, plus any direct assignments Demo User holds.
- Not signed in, in either mode: `401 { statusCode:401, message:"Sign in required", error:"Unauthorized", mode:"local" | "org" }`. The renderer reads `mode` to pick the sign-in page's variant ([ui.md](ui.md) 1.6, 4.17).

#### 91. `GET /auth/local/users`
- Local mode only (1.9). Public.
- Response `200 { users: { id: string; displayName: string; email: string | null; initials: string; roles: RoleId[] }[] }`: every directory user who is active and not released ([data-model.md](data-model.md) 3.14.1), sorted by display name (case-insensitive). `roles` are the roles they hold from any source (admin R20), each once, `user` left out, in the order `platform-admin`, `approver`, `data-owner`, `maker`; empty for a user who holds only User. The sign-in page labels each as `<displayName> · <roles>` ([ui.md](ui.md) 4.17.1).

#### 92. `POST /auth/local/sign-in`
- Local mode only (1.9). Public; no Origin check.
- Body `{ userId: string }`.
- The user must exist, be active and not released, else `404 { statusCode:404, message:"User <userId> not found", error:"Not Found" }` and no auth session.
- Success: creates an `auth_sessions` document ([data-model.md](data-model.md) 3.14.6), stamps the user's `lastSignInAt`, records `sign-in` (3.14.7), and answers `200 { ok:true, message:"Signed in", token: string, me: MeView }`. `token` is the auth-session token (32 random bytes, base64url) to send as `Authorization: Bearer <token>`; the server stores only its SHA-256.

#### 93. `POST /auth/local/sign-out`
- Local mode only (1.9). Public; the bearer token is optional.
- Ends the caller's auth session if the token names one, and records `sign-out`.
- Response `200 { ok:true, message:"Signed out" }`, with or without a session (signing out twice is harmless).

### 2.14 SCIM 2.0 (directory provisioning)

Controller prefix `/scim/v2`. Capability: [admin](../capabilities/admin/spec.md) R14-R17. Org server mode only. The subset Microsoft Entra ID's provisioning service sends; hand-written (ADR-0011). Shapes map to [data-model.md](data-model.md) 3.14.1-3.14.3.

| # | Method + path | Purpose |
|---|---|---|
| 65 | `GET /scim/v2/ServiceProviderConfig` | Capabilities: `patch` supported, `filter` supported (max 100), `bulk`, `changePassword`, `sort` and `etag` not supported, auth scheme `oauthbearertoken` |
| 66 | `GET /scim/v2/ResourceTypes` | `User` and `Group` |
| 67 | `GET /scim/v2/Schemas` | The core User and Group schemas, listing only the supported attributes |
| 68 | `GET /scim/v2/Users` | List or filter users |
| 69 | `POST /scim/v2/Users` | Create a user |
| 70 | `GET /scim/v2/Users/:id` | Read a user |
| 71 | `PUT /scim/v2/Users/:id` | Replace a user |
| 72 | `PATCH /scim/v2/Users/:id` | Change attributes (including `active`) |
| 73 | `DELETE /scim/v2/Users/:id` | Remove a user (deactivates, see below) |
| 74 | `GET /scim/v2/Groups` | List or filter groups |
| 75 | `POST /scim/v2/Groups` | Create a group |
| 76 | `GET /scim/v2/Groups/:id` | Read a group with its members |
| 77 | `PATCH /scim/v2/Groups/:id` | Rename, add or remove members |
| 78 | `DELETE /scim/v2/Groups/:id` | Delete a group, its memberships and its group mappings |

- **Auth:** `Authorization: Bearer <ORG_SCIM_TOKEN>`, compared in constant time. Missing or wrong: `401` in SCIM error format. No cookie (an auth session does not open SCIM), no Origin check. Every SCIM request that passes the token check records at most one `scim.request` activity event per minute.
- **Media type:** responses are `application/scim+json`; requests are accepted as `application/scim+json` or `application/json`.
- **User resource:** `{ schemas:["urn:ietf:params:scim:schemas:core:2.0:User"], id, externalId?, userName, name:{ givenName?, familyName?, formatted? }, displayName?, emails:[{ value, type:"work", primary:true }], active, meta:{ resourceType:"User", created, lastModified, location } }`. Supported attributes: `userName` (required, unique case-insensitively), `externalId`, `active`, `displayName`, `name.givenName`, `name.familyName`, `name.formatted`, `emails[type eq "work"].value`. Others are accepted and ignored.
- **Group resource:** `{ schemas:["urn:ietf:params:scim:schemas:core:2.0:Group"], id, externalId?, displayName, members:[{ value:<user id>, display? }], meta }`. `excludedAttributes=members` leaves `members` out.
- **Filters:** `userName eq "<v>"` and `externalId eq "<v>"` on Users; `displayName eq "<v>"` and `externalId eq "<v>"` on Groups. Anything else: `400`, `scimType:"invalidFilter"`.
- **Lists:** `{ schemas:["urn:ietf:params:scim:api:messages:2.0:ListResponse"], totalResults, startIndex, itemsPerPage, Resources }`; `startIndex` 1-based (default 1), `count` default and maximum 100. Users removed with `DELETE` are left out.
- **PATCH:** `{ schemas:["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations:[{ op, path?, value? }] }`. `op` is case-insensitive (`add`, `replace`, `remove`); boolean values may arrive as the strings `"True"` / `"False"`. Users: `replace` / `add` on any supported attribute, or without `path` with an object of attributes. Groups: `add` with `path:"members"` and a list of `{ value }`; `remove` with `path:'members[value eq "<id>"]'` or `path:"members"` and a list; `replace` on `displayName` or `externalId`.
- **Deactivation:** setting `active` to `false` ends all the user's auth sessions and records `user.deactivated`; back to `true` records `user.reactivated`.
- **`DELETE /scim/v2/Users/:id`:** sets `active:false` and `scimDeleted:true`, ends the user's auth sessions and removes their group memberships. The user stays in the directory, with their data and ownership, but SCIM reads of them answer `404`. A later `POST` with the same `userName` reactivates them under the same id, unless the user is released (below).
- **`POST /scim/v2/Users` with a taken `userName`:** when the user holding it was removed with `DELETE`, or is deactivated (`active:false`) and has signed in (`oidcSubject` set), and both that user and the request carry an `externalId` and the two differ, the name belongs to a different person (admin R16). The old user is **released**: `userName` becomes `released:<its id>`, the old name moves to `releasedUserName`, `active:false` and `scimDeleted:true` are set, its auth sessions end and its group memberships go; its id, data and ownership stay. A new user is then created (`201`, a new id). When either `externalId` is missing, a removed user comes back under the same id as above. Entra ID always sends `externalId` (the user's object id). Any other taken `userName` answers `409` `uniqueness`.
- **Responses:** `POST` `201` with the resource and a `Location` header; `GET`, `PUT`, `PATCH` `200` with the resource; `DELETE` `204`.
- **Errors:** `{ schemas:["urn:ietf:params:scim:api:messages:2.0:Error"], status:"<code>", scimType?, detail }`: `400` (`invalidValue`, `invalidSyntax`, `invalidFilter`), `401`, `404` unknown id, `409` (`uniqueness`) for a duplicate `userName` or group `displayName`.

### 2.15 Admin

Controller prefix `/admin`. Capability: [admin](../capabilities/admin/spec.md) R22 and R37-R68. Requirement: `manage-users` (1.9). Both modes; in local mode there are no groups, no group mappings and no SCIM requests, so those lists are empty and the last sync is `null` (admin R74). Errors are Style B (1.3); successful writes answer an `ok` body like Style A. Activity events are the `activity_events` types in [data-model.md](data-model.md) 3.14.7; how each figure is derived is in 3.14.8.

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 79 | `POST /admin/role-assignments` | Assign a role to a user | yes (Assign role dialog) |
| 80 | `DELETE /admin/role-assignments/:id` | Remove a direct role assignment | yes (Inactive makers dialog) |
| 81 | `GET /admin/overview` | Tiles, Needs attention, weekly active users, recent activity | yes |
| 82 | `GET /admin/overview/export` | The overview as a CSV download | yes (full-page download) |
| 83 | `GET /admin/users` | Search, filter and page the users | yes |
| 84 | `GET /admin/users/:id` | One user's detail | yes |
| 85 | `PUT /admin/users/:id/roles` | Replace a user's direct role assignments | yes |
| 86 | `POST /admin/agents/transfer` | Move user agents to another owner | yes |
| 87 | `GET /admin/groups` | Search and page the groups | yes |
| 88 | `GET /admin/role-mappings` | List the group mappings | yes |
| 89 | `POST /admin/role-mappings` | Add a group mapping | yes |
| 90 | `DELETE /admin/role-mappings/:id` | Remove a group mapping | yes |

Shared shapes (`RoleId`, `HeldRole` in 2.13):

```ts
type UserStatus = 'active' | 'inactive' | 'not-signed-in' | 'deactivated';   // admin R39
interface UserRef { id: string; displayName: string }
interface AdminUserRow {
  id: string;
  displayName: string;
  email: string | null;
  initials: string;                  // as in ui.md 1.3
  roles: Exclude<RoleId, 'user'>[];  // distinct, from every source, order: platform-admin, approver, data-owner, maker; [] = User only
  groups: string[];                  // group display names, sorted
  agentsOwned: number;
  lastActiveAt: string | null;       // admin R39; null = never signed in
  status: UserStatus;
}
interface AdminHeldRole extends HeldRole {
  datasourceName?: string;           // data-owner only; the datasource's current name, or its id if it no longer exists
  groupNames?: string[];             // source 'group': every group that maps this role (and datasource)
  datasourceMissing?: true;          // 84 only: a direct Data owner assignment whose datasource no longer exists
}
interface ActivityItem { id: string; type: string; at: string; text: string }   // text: the admin R47 sentence
```

#### 79. `POST /admin/role-assignments`
- Body: `{ userId: string; role: RoleId; datasourceId?: string }`. `datasourceId` is required for `data-owner` and refused for any other role.
- Success `201`: `{ ok:true, message:"Role assigned", assignment: RoleAssignmentDoc }` ([data-model.md](data-model.md) 3.14.4). If the user already holds the same direct assignment: `200 { ok:true, message:"Role already assigned", assignment }`, nothing written.
- Errors (Style B): `400` `"Unknown role: <role>"`, `"The User role is implicit"`, `"Data owner needs a datasource"`, `"Only Data owner takes a datasource"`; `404` `"User <id> not found"`, `"Datasource <id> not found"`.
- Records `role.assigned`.

#### 80. `DELETE /admin/role-assignments/:id`
- Success `200`: `{ ok:true, message:"Role removed" }`. Records `role.removed`.
- Errors: `404` `"Role assignment <id> not found"`; `400` `"You can't remove your own Platform admin role"` when the assignment is the caller's own `platform-admin` (admin R61). Bootstrap and group-mapped roles have no assignment id and cannot be removed here.

#### 81. `GET /admin/overview`
- Response `200`:
  ```ts
  interface AdminOverview {
    generatedAt: string;
    activeUsers30d: number;
    agentsLive: number;
    attention: {
      ownerlessAgents: { count: number; items: { agentId: string; agentName: string; formerOwner: UserRef | null }[] };
      erroredAgents: { count: number; items: { agentId: string; agentName: string; owner: UserRef; errors: number; lastErrorAt: string; lastErrorMessage: string }[] };
      inactiveMakers: { count: number; items: { user: UserRef; lastActiveAt: string; makerAssignmentId: string | null; makerGroups: string[] }[] };
    };
    weeklyActiveUsers: { weekStart: string; users: number }[];   // 8 entries, oldest first; weekStart = the Monday, YYYY-MM-DD (UTC)
    recentActivity: ActivityItem[];                             // at most 10, newest first
  }
  ```
  `agentName` is the agent's Live name, else its draft name. `formerOwner` is `null` when the owner is no longer in the directory. An errored agent's `owner` is its current owner (`displayName` `"unknown user"` when that user is no longer in the directory). Agents stored without an owner (admin R33) count in no figure. `makerAssignmentId` is the direct Maker assignment (the id endpoint 80 takes), `null` when Maker comes only from groups. Each `items` list holds at most 100 entries, ordered by name; `count` is always the full number.
- Errors: none expected beyond 1.9.

#### 82. `GET /admin/overview/export`
- Response `200`, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="admin-report-<YYYY-MM-DD>.csv"` (UTC date). UTF-8 with a byte-order mark, CRLF after every row (the last included), RFC 4180 quoting. A cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'` before quoting (admin R48).
- A header row `section,label,value`, then, in order:
  - `summary,Active users · 30 days,<n>` and `summary,Agents live,<n>`;
  - `attention,Agents without an active owner,<n>`, `attention,Agents with errors in the last 7 days,<n>`, `attention,Users inactive for 90+ days with Maker role,<n>`;
  - 8 rows `weekly-active-users,<weekStart>,<n>`, oldest first;
  - up to 10 rows `activity,<ISO at>,<sentence>`, newest first.
- Computed exactly as endpoint 81 at the time of the request. Records nothing.

#### 83. `GET /admin/users`
- Query: `q` (optional; trimmed, matched as in admin R50), `filter` (`all` default \| `platform-admin` \| `approver` \| `data-owner` \| `maker` \| `inactive`), `page` (1-based, default 1), `pageSize` (1-100, default 25), `excludeDeactivated` (`true` leaves out deactivated users; used by the User and New owner pickers).
- Response `200`:
  ```ts
  interface AdminUsersPage {
    items: AdminUserRow[];          // sorted by displayName (case-insensitive), then email
    total: number;                  // after q and filter
    page: number; pageSize: number;
    counts: { users: number; groups: number; platformAdmins: number; approvers: number; dataOwners: number; makers: number; inactive: number };   // whole directory, ignoring q and filter (admin R49, R51)
    lastSyncAt: string | null;      // the newest scim.request event; null before any (admin R54)
  }
  ```
  A `page` past the end answers an empty `items` with the real `total`.
- Errors: `400` `"Unknown filter: <filter>"`, `"page must be a positive integer"`, `"pageSize must be between 1 and 100"`.

#### 84. `GET /admin/users/:id`
- Response `200`:
  ```ts
  interface AdminUserDetail extends AdminUserRow {
    heldRoles: AdminHeldRole[];     // every source, including { role:'user', source:'implicit' }
    groupList: UserRef[];           // the user's groups ({ id, displayName })
    agents: { id: string; name: string; status: 'live' | 'draft' }[];   // sorted by name
    isSelf: boolean;                // the caller (admin R61)
    isBootstrap: boolean;           // userName in ORG_BOOTSTRAP_ADMINS (admin R18)
  }
  ```
  `heldRoles` lists, in order, the implicit User role, the bootstrap Platform admin, the direct assignments (oldest first), then the roles from groups. A direct Data owner assignment whose datasource no longer exists grants nothing ([data-model.md](data-model.md) 3.13) but is still listed, with `datasourceMissing: true` and `datasourceName` set to its id, so the panel can offer to remove it; the row's `roles` leave it out. A group mapping whose datasource no longer exists is left out here (it shows in 88). A role mapped from several of the user's groups (for Data owner, on the same datasource) appears once, with every group in `groupNames` (sorted) and `groupId` the first of them.
- Errors: `404` `"User <id> not found"`.

#### 85. `PUT /admin/users/:id/roles`
- Body: `{ roles: { role: RoleId; datasourceId?: string }[] }`, the complete set of **direct** assignments the user should hold (admin R62). Duplicates collapse. Roles held from groups or as a bootstrap admin are not part of it and are not changed.
- Validates everything before writing: `404` `"User <id> not found"`, `400` `"roles must be a list"`, the `400` messages of endpoint 79 for each entry, `404` `"Datasource <id> not found"` for a Data owner assignment being **added** (one already stored is kept even when its datasource is gone), and `400` `"You can't remove your own Platform admin role"` when the caller is the user and the set drops their direct `platform-admin`.
- Then deletes the direct assignments not in the set and creates the missing ones, as one transaction (all or nothing).
- Success `200`: `{ ok:true, message:"Roles saved for <displayName>", added: number, removed: number, heldRoles: AdminHeldRole[] }`; with nothing to change, `message:"No changes"` and nothing written.
- Records one `role.assigned` or `role.removed` per change.

#### 86. `POST /admin/agents/transfer`
- Body: `{ agentIds: string[]; toUserId: string }`; 1-100 distinct ids of user agents, from any owner.
- Validates everything before writing, in this order: `400` `"Choose at least one agent"`, `"Choose at most 100 agents"` (ids that are not strings are dropped, duplicates collapse); `404` `"User <id> not found"`; `400` `"<name> is deactivated"` (the new owner); `404` `"Agent <id> not found"` (also for an agent stored without an owner, admin R33); `400` `"\"<agent name>\" already belongs to <name>"`; `409` `"<name> already has an agent named \"<agent name>\""` when the new owner has a user agent with the same name (case-insensitive, Live or draft name), or two of the agents share a name. The message names the transferred agent's clashing name.
- Then, as one transaction, sets each agent's `ownerId` to `toUserId` and `pinned` to `false`; the draft, Live version and `publishedAt` are unchanged (admin R64).
- Success `200`: `{ ok:true, message:"Transferred <n> agent(s) to <displayName>", transferred: number }` (`1 agent`, `2 agents`).
- Records one `agent.transferred` per agent.

#### 87. `GET /admin/groups`
- Query: `q` (optional, a substring of the group name, case-insensitive), `page`, `pageSize` as in endpoint 83.
- Response `200`: `{ items: { id: string; displayName: string; members: number; mappings: { role: Exclude<RoleId,'user'>; datasourceId?: string; datasourceName?: string }[] }[]; total: number; page: number; pageSize: number }`, sorted by name (case-insensitive); each group's `mappings` in badge order (Platform admin, Approver, Data owner, Maker), then by datasource name.
- Errors: the `page` / `pageSize` messages of endpoint 83.

#### 88. `GET /admin/role-mappings`
- Response `200`: `{ mappings: GroupRoleMappingView[] }`, sorted by group name (case-insensitive), then role in badge order (Platform admin, Approver, Data owner, Maker), then datasource name, where `GroupRoleMappingView = GroupRoleMappingDoc & { groupName: string; datasourceName?: string }` ([data-model.md](data-model.md) 3.14.5).

#### 89. `POST /admin/role-mappings`
- Body: `{ groupId: string; role: RoleId; datasourceId?: string }`, with the same rules as endpoint 79.
- Success `201`: `{ ok:true, message:"Mapping added", mapping: GroupRoleMappingView }`. If the same mapping exists: `200 { ok:true, message:"Mapping already exists", mapping }`, nothing written.
- Errors: the `400` messages of endpoint 79; `404` `"Group <id> not found"`, `"Datasource <id> not found"`.
- Records `mapping.added`.

#### 90. `DELETE /admin/role-mappings/:id`
- Success `200`: `{ ok:true, message:"Mapping removed" }`. Records `mapping.removed`.
- Errors: `404` `"Group mapping <id> not found"`.

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

**Errors mid-stream.** Any thrown error that is not an abort is caught by the controller and sent as `{ type:"error", content: <message> }`, then the response ends. The user message stays persisted; no assistant message is added. In org server mode, when the session was started from a user agent (not a preview) that it still runs (not deleted, nor transferred to another owner), the error is not a refused request (an empty message, an unknown session) and the client did not stop the turn, the server also records an `agent.turn-failed` activity event ([data-model.md](data-model.md) 3.14.7; admin R40). Endpoint 6 does the same for a failed non-streamed turn. A failed connect on the client yields `"Backend unreachable"`, a non-2xx or bodyless response yields `"Stream failed (<status>)"`, a read failure yields `"Stream disconnected"`.

### 3.2 Deep analysis

Pattern: **start, poll, then download**. Endpoints 46-48.

- State machine: `planning` → `investigating` (one step per angle, 1..`steps`, at most 5 angles, 3-5 planned) → `writing` → `done`; any failure → `error`. Not resumable.
- Progress is observed by polling `GET /sessions/:id/deep-analysis/:jobId` (the shipped chat polls every **3000 ms**, gives up after 5 consecutive poll failures). `progress` is the human line for the pending card: `"Planning the investigation"`, `"Investigating angle <i> of <n>: <title>"`, `"Writing the report"`, `"Report ready — <n> angle(s) investigated"`, `"Deep analysis failed"`. `step`/`steps` are 1-based.
- Completion is also observable in the transcript: on `done` an assistant message with `report` is appended; on `error` an assistant failure message is appended (so a reload shows the outcome even if polling stopped).
- One running job per session (conflict returns the running `jobId` with `ok:false`). Job records are in memory (50 most recent kept), each with the user who started it; polling another user's job answers as not found ([data-model.md](data-model.md) 3.15); aborted on backend shutdown. Reports persist in the workspace and remain downloadable.

### 3.3 Eval runs

Pattern: **start, poll, list, download, delete**. Endpoints 36-40.

- One running run per agent and owner (`conflictWith` surfaced as `ok:false` + `jobId`). Another user's run, running or not, answers as not found and never conflicts ([data-model.md](data-model.md) 3.15).
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
| Spawn | Electron's own binary with `ELECTRON_RUN_AS_NODE=1` running `backend/dist/main.js` (packaged: `<resources>/backend/dist/main.js`); `stdio` piped; env passes `PORT`, `APP_DATA_DIR`, `APP_SECRET`, and drops every `ORG_*` variable, so the desktop backend always runs in local mode (1.9). Missing entry file records an error diagnostic and does not start. |
| Readiness probe | `GET http://127.0.0.1:<BACKEND_PORT>/me`, **ready iff status 200 or 401** (nobody is signed in when the backend starts, ADR-0012); 500 ms request timeout; retried every 100 ms until a **30 s** deadline. |
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
| `--host` | string | `127.0.0.1` | Interface to bind. An org server behind the organisation's TLS proxy binds the interface the proxy reaches, typically `0.0.0.0` ([delivery.md](delivery.md) 4.1). |
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
  Mode:     org server, <ORG_PUBLIC_BASE_URL>   # only in org server mode
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
| `ORG_OIDC_ISSUER` | org server config ([admin](../capabilities/admin/spec.md) R3) | The identity provider's issuer URL; its discovery document is read from `<issuer>/.well-known/openid-configuration`. For Entra ID: `https://login.microsoftonline.com/<tenant id>/v2.0`; it must name one tenant, so a first path segment of `common`, `organizations` or `consumers` (any case) is a startup error: `ORG_OIDC_ISSUER must name one tenant (https://login.microsoftonline.com/<tenant id>/v2.0), not "<segment>"`. Required for org server mode. | unset (local mode) |
| `ORG_OIDC_CLIENT_ID` | org server config | The app registration's client id. Required for org server mode. | unset |
| `ORG_OIDC_CLIENT_SECRET` | org server config | The app registration's client secret. Required for org server mode. Never logged. | unset |
| `ORG_PUBLIC_BASE_URL` | org server config | The URL people open, as the proxy serves it, e.g. `https://insights.contoso.com`; trailing slashes removed. Builds the redirect URI (`<url>/auth/callback`), the Origin check and the cookie `Secure` flag. Must be `https://` except for development and tests. Required for org server mode. | unset |
| `ORG_SCIM_TOKEN` | org server config | The SCIM bearer token given to the identity provider. At least 32 characters (shorter is a startup error). Required for org server mode. Never logged. | unset |
| `ORG_BOOTSTRAP_ADMINS` | org server config | Comma-separated user names that always hold Platform admin (admin R18), matched against the directory `userName`: for Entra ID the UPN (`preferred_username`, SCIM `userName`), which usually looks like an email. Never matched against the email. Optional; blanks ignored, case-insensitive. | unset |
| `EVAL_DATASETS` | `mastra/evals/run-assistant-evals.ts` (CLI eval script only) | Comma-separated dataset names to run the assistant evals against. Required by that script. | none |
| `EVAL_SET` | `mastra/evals/run-assistant-evals.ts` (CLI eval script only) | The question set to run (`world-cup`, `world-cup-rest`, `formula-1`). That script needs this or `EVAL_CASES`, not both ([agents.md](agents.md) 8.5). | none |
| `EVAL_CASES` | `mastra/evals/run-assistant-evals.ts` (CLI eval script only) | Comma-separated eval case ids to run instead of a whole set; all from one set's fixture. | none |

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
- **G10. Desktop backend bind address.** (Unchanged by org server mode: the desktop app is always local, 1.9.) `main.ts` calls `createApp` without a host, so the Electron-spawned backend listens on **all interfaces** with CORS enabled and only the password-less local sign-in (G14); only the CLI binds `127.0.0.1` by default. Open question whether the desktop backend should bind loopback only.
- **G11. `message` timing on feedback.** `POST …/messages/feedback` with `up` reports `"Answer saved as a verified query"` even when the answer had no SQL and nothing was saved.
- **G12. Spec of `PUT /metrics/:id` not-found** is thrown as a 400-class exception but surfaced inside the `ok:false` envelope, so clients cannot distinguish "not found" from validation by status.
- **G13. Dev-mode API routing.** For `ng serve` the client uses relative URLs and the repo has no Angular proxy config, so API calls from a bare `ng serve` page hit the dev server, not the backend. Under `electron:dev` the window loads `http://localhost:4200` (protocol `http:`), so the same relative-URL problem applies. Open question: how the live-reload dev flow reaches the backend (no proxy or `API_BASE_URL` override found).
- **G14. Local mode is not a security boundary.** Local sign-in (91-93) asks for no password: anyone who can reach the local backend can sign in as any persona, Demo User included, and the desktop backend listens on all interfaces (G10). The personas show what each role can do; they don't protect data ([non-functional.md](../product/non-functional.md) section 3, ADR-0012).
- **Not an HTTP surface:** verified queries (saved via feedback), the Mastra Studio, and the workspace filesystem have no endpoints of their own.

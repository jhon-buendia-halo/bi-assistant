# Plan: RFP Builder agent, Intellify REST API and RFP package (epic BA-213, roadmap 1.14.12–1.14.16)

Jira (created 2026-10-14, parent BA-213): 1.14.12 BA-225 · 1.14.13 BA-226 · 1.14.14 BA-227 · 1.14.15 BA-228 · 1.14.16 BA-229. Epic amendment, ADR-0027/0028 and every default in this plan confirmed by the user on 2026-10-14.

> **Note (2026-10-14, after this plan):** the `rfp-process` skill of 3.4 and its seven reference files were split into seven on-demand stage skills, one per stage (`rfp-client-renewal`, `rfp-current-program`, `rfp-market-scope`, `rfp-carriers`, `rfp-requirements`, `rfp-timeline`, `rfp-package`); the prompt lists the stages with a link to each skill, and each skill body links the tools of its stage. The plan below is kept as written; the current design is in agents.md 2.8 and 7.4.

Read before use: CLAUDE.md, retrospective.md (top 6 entries), specs/README.md, specs/epics/BA-213/spec.md, architecture.md (ADR-0008, 0022–0026, containers/components), agents.md (1, 2.1, 3, 4, 7, 8, 9, Appendix A), api.md (1.3, 1.9, 2.1, 2.2, 2.6, 2.9, 5, 6), data-model.md (3, 3.1, 3.4, 3.10.x, 6), capabilities agents-evals / datasources / testing-data / sessions-chat, and the code: `backend/src/mastra/**`, `modules/agents`, `modules/sessions`, `modules/datasources` (REST connector, `buildHeaders`, OpenAPI discovery), `modules/testing-data` (registry, loader), `app-bootstrap.ts`, `cli.ts`, `frontend/electron/main.cjs`, `frontend/e2e/fixtures/app.fixture.ts`, `e2e/helpers/llm-stub.ts`, the frontend `agents` feature, `scripts/generate-intellify-seed.py`, `backend/scripts/worldcup-rest-api/serve.ts`, `scripts/check-specs.py`.

Facts that shape the design (verified in the worktree at `7dfdbb9`, branch `feat/BA-213-agent-tools-skills`):

- The next free ADR number is **ADR-0027** (architecture.md ends at ADR-0026).
- `scripts/check-specs.py` fails when any `@Controller` route under `backend/src/**` is missing from api.md (written as `` `METHOD /path` `` with `:x` params), when a `COLLECTIONS` table is missing from data-model.md, when a Mastra registry key is missing from agents.md, when a Playwright spec has no `E2E:` owner, and when a capability folder is not in the README table.
- Sessions are bound to **user** agents only (`SessionDoc.agentId` → `userAgents.get`); `createFromAgent` answers `Agent "<key>" not found` for a built-in key; every turn runs `mastra.getAgent('assistant')`. The grounding guard, careful mode and result guards are assistant-specific; `toolDataRecord` only captures `run_readonly_sql` / `sample_rows` results, so other tools' results emit no `tool-result` event today.
- The hub: `kind` is `official` only for `assistant` (`OFFICIAL_AGENT_KEY` in `agents.service.ts`); Start chat is offered to `official` and Live `user` agents; the shell opens the composer for `official`.
- Built-in prompt overrides (ADR-0026): a built-in key must be in `SHIPPED` in `shipped-agent-prompts.ts`; System agents serve `agentInstructions(key, shipped)`; only the assistant generates `## Tools` and excludes it from the editable text.
- The REST datasource kind already does what the API needs: auth `api-key-header` sends the key in `X-API-Key` by default (`buildHeaders` in `rest.connector.ts`); discovery proposes GET operations without path params, guesses `page`/`per_page` pagination and a rows pointer; the connector materialises endpoints into SQLite for `run_readonly_sql`.
- The eval harness is bound to `assistantAgent` (`runAssistantEvalCase`), sets carry a `fixtureId`, and `EvalRunsService.start` refuses any `agentKey !== 'assistant'`. A REST-kind fixture (`world-cup-rest`) exists in the registry but is register-only (a script registers it).
- Export precedents: `zip-archive.ts` (dependency-free zip), deep-analysis reports stored in the session workspace (`reports/<jobId>.md`) with a `report` field on the message and a download route. No PDF library is installed in `backend/`; `marked` is.
- The Intellify seed is deterministic (seeded RNG); `policy_financials.plan_financial` keys: `planYear` (2026), `annualPremium`, `monthlyPremium`, `priorYearAnnualPremium`, `renewalIncreasePct`, `fundingType`, `planType`, `ratingBasis`, medical/dental/vision `rates{employeeOnly,employeeSpouse,employeeChildren,family}`, `enrollment{same}`, `enrolledEmployees`, `contributions{employerPct,employeeMonthlyEmployeeOnly}`, `fees{adminFeePepm,stopLossPepm}` when not fully insured; life/disability/voluntary/EAP: `coveredLives`, `ratePer1000`, `volume`, `pepm`. `census_answers.answers`: `totalEmployees, eligibleEmployees, enrolledEmployees, averageAge, averageSalary, gender{female,male}, byState{ST:n}, medicalTier{4 tiers}, employeeClass{fullTime,partTime}`; `effective_year` text 2024–2026; `aggregated_census_answers.census`: `headcount, enrolled, participationRate, averageAge, femalePct, tierMix, statesCount`. `plan_designs` carries FK ids only (carrier, funding type, state) and `plan_creation_identifier_flag`; the plan type is only inside `plan_financial.planType`. `loc_statuses` current status = latest `start_date`. `policies.kick_off_timing` → `renewal_kick_off_timings.days`.

---

## 1. Architecture

### 1.1 Where the API lives and how it runs

**Decision: a second NestJS application inside `backend/`, compiled by the same `nest build`, started embedded by default and standalone on demand.**

- Folder `backend/src/intellify-api/` (its own module tree; it imports nothing from `modules/` or `mastra/`, and nothing in the app imports from it except the bootstrap hook and the testing-data loader's URL/key provider):
  ```
  backend/src/intellify-api/
    intellify-api.module.ts          IntellifyApiModule: DbModule, ApiKeyGuard (APP_GUARD), controllers
    bootstrap.ts                     createIntellifyApi({ port, host, db, apiKeys }) → { app, url, port }
    main.ts                          standalone entry (npm run intellify-api), env-only configuration
    config.ts                        intellifyApiConfig(env): ports, db coordinates, api keys, enabled flag
    api-key.guard.ts                 X-API-Key check (constant-time compare), @Public() for /health and /openapi.json
    http-error.filter.ts             error shape (1.2 below)
    openapi.ts                       SwaggerModule document → GET /openapi.json
    db/db.service.ts                 pg Pool, readOnly(fn) (READ ONLY tx, rolled back), write(fn) (tx), migrate()
    db/migrations/001_rfp_schema.sql
    intellify/*.controller.ts|*.service.ts|*.queries.ts   read endpoints over schema intellify
    rfp/rfp.controller.ts|rfp.service.ts|rfp.repository.ts|dto/   the rfp schema
    package/package.controller.ts|document.ts (Markdown)|pdf.ts (pdfkit)|exhibits.ts (CSV)|package.service.ts (zip)
  ```
- **Embedded (default in dev, CLI/web, E2E, desktop):** `createApp()` in `app-bootstrap.ts` calls `startEmbeddedIntellifyApi()` after the main app listens, unless `INTELLIFY_API=off`. It listens on `INTELLIFY_API_HOST` (default `127.0.0.1`) and `INTELLIFY_API_PORT` (default `3100`; `0` = OS-assigned). It never shares a process-level object with the app beyond a small `IntellifyApiInfo` value (`{ url, apiKey }`) exposed as a Nest provider token in the main app, which only the testing-data loader reads (1.3). Everything else goes over HTTP. If the API fails to start (port busy, bad config) the main app still starts and logs `Intellify API not started: <reason>`; the hub then shows the RFP agent with Start chat blocked (see 3.5).
- **Standalone:** `node dist/intellify-api/main.js` (`npm run intellify-api`), env-configured, for a deployed API. Same code.
- **Startup order:** the DB pool is lazy; `migrate()` runs on first start inside a transaction with `pg_advisory_xact_lock`, records versions in `rfp.schema_migrations`, and is idempotent. A missing database makes `/health` answer `{ ok:false, database:'down' }` and data routes answer 503 `database unavailable` without crashing the app.
- **CLI flags** (`cli.ts`, strict parser): `--intellify-api-port <n>` (0 = free port) and `--no-intellify-api`. The banner prints `Intellify API: http://127.0.0.1:<port>` (used by the E2E fixture the way it uses `URL:`).
- **Desktop:** `electron/main.cjs` inherits env; nothing else changes (default port 3100; the renderer never calls the API directly).
- **E2E:** the app fixture adds `INTELLIFY_API_PORT=0` to the spawn env and parses the banner line; `global-setup.ts` already starts the compose Postgres, so the embedded API finds the database once the Intellify fixture is loaded (the RFP E2E loads `intellify` then registers `intellify-api`; see 5.3).
- **Env vars** (api.md 6.1 additions): `INTELLIFY_API` (`off` disables the embedded start), `INTELLIFY_API_HOST` (127.0.0.1), `INTELLIFY_API_PORT` (3100), `INTELLIFY_API_KEY` (standalone: required; embedded: optional — when unset the backend reads or creates `<APP_DATA_DIR>/.intellify-api-key`, 32 random bytes hex, mode 0600, same pattern as `.app-secret`), `INTELLIFY_DB_HOST` (127.0.0.1), `INTELLIFY_DB_PORT` (`WORLD_CUP_DB_PORT` or 55432), `INTELLIFY_DB_NAME` (`intellify_mercer_demo`), `INTELLIFY_DB_USER` (world_cup), `INTELLIFY_DB_PASSWORD` (world_cup_dev), `INTELLIFY_DB_SSL` (false), `INTELLIFY_DB_SCHEMA` (`intellify`).
- **Build:** `nest-cli.json` gets one more asset entry `{ "include": "intellify-api/db/migrations/**/*.sql", "watchAssets": true }`. New dependencies in `backend/package.json`: `@nestjs/swagger` (pinned, the 11.x line matching Nest 11) for the OpenAPI document, `pdfkit` (pinned 0.17.x, pure JS) and `@types/pdfkit` (dev). Both are pure JS, so electron-builder packaging is unaffected.
- **Permissions guard:** the main app's `PermissionsGuard` (and its route-marker check at startup) lives in the main Nest container only; the API has its own `ApiKeyGuard` as `APP_GUARD`, so no `@RequirePermission` is needed there. `check-specs.py` still sees the API's controllers (they are under `backend/src/`), so every route goes into api.md section 2.16.

Why not a separate process or a separate package: Electron would have to supervise a second child, the E2E fixture a second spawn, and the npm package a second bin; one build and an in-process listener keep every delivery working with zero new moving parts, while the HTTP-only boundary, own port, own auth and own database keep it a separate service that can be deployed alone.

### 1.2 How the agent's tools reach the API

**Decision: through a configured REST datasource, not env/settings.**

- The RFP agent's sessions are bound (like every session) to a dataset; theirs is the dataset the `intellify-api` Testing Data fixture registers (`Intellify RFP API`, over the REST datasource `Intellify RFP API`, kind `rest`, auth `api-key-header` with header `X-API-Key`, endpoints discovered from `/openapi.json`, group `intellify`).
- Each RFP tool resolves its target per call: the session's datasets (requestContext `datasets`, as the dataset tools do) → the first dataset bound to a datasource of kind `rest` → `getDatasetToolServices().restTarget(datasourceId)` → `{ baseUrl, headers }` (secrets resolved server-side; `headers` built by the same `buildHeaders` as the REST connector, exported from `rest.connector.ts`). With no REST datasource in scope the tool returns `{ error: 'No Intellify API datasource is bound to this session. Load the "Intellify RFP API" sample in Settings → Testing Data and start the chat from the RFP Builder card.' }` and never throws.
- Why this over env/settings: (1) a session needs a dataset anyway, so binding to the fixture's dataset gives Start chat, dataset scoping and the hub's missing-dataset handling for free; (2) the key lives in `connections` with the existing masking and "keep the stored secret" rules (datasources R17–R18) and is shared across users in org mode like every datasource; (3) the same datasource makes the API's collection endpoints queryable by the plain assistant through `run_readonly_sql` (SQLite over the fetched endpoints) with no extra work; (4) one configuration path instead of two. Env variables stay for the **service** (1.1), never for the tools.

### 1.3 Write safety

- The app's read-only SQL guard (datasources R33–R35, agents.md 5.2) is untouched: the RFP agent has **no SQL tool**; its tools take structured scalar inputs and call HTTP routes. The assistant's tool set and prompt are byte-identical (the existing golden test keeps proving it).
- The API separates reads and writes at the database: every `GET` over `intellify.*` runs inside a `READ ONLY` transaction that is rolled back; writes run only through `rfp.service.ts` with parameterised statements against `rfp.*` tables; no request parameter is ever interpolated into SQL. Cross-schema foreign keys are deliberately not used (the Intellify loader drops schema `intellify` with CASCADE; an FK from `rfp` would be dropped with it), so the API checks `client_one_code` against `intellify.clients` on create.
- Every write route requires the API key; `DELETE` applies to drafts only; status moves only forward (`draft → ready → issued → closed`).
- Records carry `created_by` (the app sends `X-Qti-User: <ownerKey>` from the current user; the eval harness sends `eval:<jobId>` so it can clean up). It is an attribute, not an access control: the API key is the boundary (documented in non-functional/ADR).

### 1.4 PDF generation

**Decision: server-side with `pdfkit`, rendered from the same Markdown the API serves, in the API (`package/pdf.ts`).** `marked`'s lexer (already a dependency) turns the Markdown into tokens; a small deterministic renderer draws headings, paragraphs, bullet lists and tables (fixed column widths, header row shaded, page breaks between sections) with pdfkit's built-in Helvetica (no font files). Rejected: Electron `printToPDF` (desktop only; the web/CLI mode has no Chromium) and Playwright/Chromium (dev dependency only, hundreds of MB). The PDF is a faithful, plain rendering of the Markdown; it is not a design artefact.

### 1.5 ADR drafts (paste into architecture.md after ADR-0026, under Level 2 — Containers; the C4 container diagram gets one node `intellifyapi["Intellify RFP API<br/>(backend/src/intellify-api, second Nest app, :3100)"]` with `backend -->|"HTTP + X-API-Key (RFP tools, REST datasource)"| intellifyapi` and `intellifyapi -->|"pg: READ ONLY over intellify.*, writes to rfp.*"| intellifydb[("intellify_mercer_demo<br/>(PostgreSQL)")]`; the Level 3 backend diagram gets `rfpagent["rfp agent"]` and `rfptools["tools/rfp.tools.ts (HTTP)"]` under `mastra/`)

```
#### ADR-0027 — The Intellify RFP API: a second NestJS service in the backend package, API-key protected, with its own `rfp` schema
- **Status:** Proposed
- **Date:** 2026-10-14
- **Context:**
  - The RFP Builder agent (ADR-0028) must reach the Intellify data model (the `intellify` fixture, BA-212) only through a REST API that we build, and must save the state of an RFP so a consultant can resume it.
  - The app reaches external data only through datasources (ADR-0005's connectors; the REST kind reads OpenAPI specs and sends an API key header), and its SQL path is read-only by design (datasources R33-R35). The RFP needs writes.
  - The backend already runs as one NestJS application in three deliveries (Electron child process, npm CLI, org server; ADR-0001, ADR-0002). A second process would need supervision in each.
- **Decision:**
  - **A second NestJS application** lives at `backend/src/intellify-api/`, compiled by the same build, with its own module tree, port (`INTELLIFY_API_PORT`, default 3100), authentication (`X-API-Key`), error shape, OpenAPI document (`GET /openapi.json`) and PostgreSQL pool. It imports nothing from the app's modules and the app calls it only over HTTP.
  - **Embedded by default, standalone on demand.** `createApp()` starts it in-process after the app listens unless `INTELLIFY_API=off`; `node dist/intellify-api/main.js` runs it alone. The only in-process link is a value (`IntellifyApiInfo`: URL and key) that the Testing Data loader uses to register the API as a REST datasource.
  - **Reads are read-only, writes are confined.** Reads over `intellify.*` run in `READ ONLY` transactions. Writes go only to a new `rfp` schema in the same database (`rfp.rfps`, `rfp_lines`, `rfp_carriers`, `rfp_requirements`, `rfp_timeline`, `rfp.schema_migrations`), created by versioned SQL migrations the API applies at start under an advisory lock. No foreign key crosses the schemas, because the Intellify loader drops `intellify` with CASCADE.
  - **The package is a projection of the record.** The API renders the RFP document (Markdown, and PDF with pdfkit), the exhibits (CSV) and a zip from the stored record and the live Intellify data, so any client gets the same package.
- **Consequences:**
  - Two new dependencies (`@nestjs/swagger`, `pdfkit`), both pure JavaScript; the packaged desktop app grows accordingly.
  - A new container in the C4 model and a new external database coordinate set (`INTELLIFY_DB_*`); data-model.md documents the `rfp` schema and api.md the API's routes, since `check-specs.py` covers every controller under `backend/src`.
  - The API key is the whole access boundary: records carry `created_by` as an attribute only. Per-user access would need the app's auth to be forwarded, which is deferred.
  - A missing or stopped database degrades the API (503, `/health` down) without stopping the app.
```

```
#### ADR-0028 — A built-in RFP Builder agent with dedicated HTTP tools, resolved through a REST datasource; sessions can bind to a built-in agent
- **Status:** Proposed
- **Date:** 2026-10-14
- **Context:**
  - The user asked for an agent that walks a Mercer benefits consultant through building a carrier RFP, built in code with its own prompt, skill and tools (not a user agent, which can only configure the assistant's tools; ADR-0022, ADR-0024).
  - Sessions bind to user agents only (ADR-0008); every turn runs the `assistant`, with its SQL repair, grounding guard and careful mode. Start chat is offered to the Official assistant (which opens the composer) and to Live user agents.
  - The BA-213 epic listed new tools as out of scope; the user amended it on 2026-10-14.
- **Decision:**
  - **A registered agent `rfp`** (`mastra/agents/rfp.agent.ts`), kind `official` in the hub, with a generated `## Tools` section and an editable prompt like the assistant's (ADR-0026), the on-demand built-in skill `rfp-process` (one reference file per stage, through the framework's skill tool; ADR-0025), conversation memory as the assistant's, and its own tools in `mastra/tools/rfp.tools.ts`: read tools over the Intellify API, write tools for the RFP record, `export_rfp_package`, and the shared `ask_clarification`. It has no SQL tool and no workspace tools.
  - **Tools resolve the API from the session's datasets:** the REST datasource bound to the session's dataset gives the base URL and the key; nothing is read from the environment or settings.
  - **Sessions bind to a built-in agent** through a new `agentKey` field (`agentId` stays for user agents). Start chat on an official agent that declares a required dataset creates the session over that dataset; the Official assistant keeps opening the composer. A turn runs the session's agent; the assistant-only passes (grounding guard, careful mode, result guards) apply only to the assistant. The session records the active RFP (`rfpId`) from the tools' results so a resumed chat starts at the right stage.
  - **The package reaches the consultant from the chat:** `export_rfp_package` stores the API's package in the session workspace (`rfp/<rfpId>/`) and the answer carries an `rfpPackage` reference with a download route, as deep-analysis reports do.
- **Consequences:**
  - ADR-0008's "every turn runs the assistant" narrows to "runs the session's agent"; its guarantees stay for assistant sessions, and the RFP agent's safety comes from having no SQL path (ADR-0027).
  - The hub has two Official agents; Start chat semantics depend on whether the agent declares a dataset.
  - The eval harness runs a case on the set's agent, and an `rfp` eval set exists; prompt, skill or tool changes to the agent must pass it at 100% over 3 runs.
  - Evals that create RFPs write to `rfp.*`; they tag records with `created_by = eval:<jobId>` and delete them afterwards.
```

---

## 2. REST API contract (Intellify RFP API)

Base path `/v1`. Served at `http://127.0.0.1:3100` by default. `Content-Type: application/json; charset=utf-8`. Ids: Intellify ids are the 24-hex `char(24)` strings; RFP ids are UUIDs. Dates ISO `YYYY-MM-DD`; money numbers in USD.

**Auth.** Every route except `GET /health` and `GET /openapi.json` needs `X-API-Key: <key>` (constant-time compare against the configured keys; `INTELLIFY_API_KEY` may hold several, comma-separated). Missing or wrong: `401 { statusCode:401, error:'Unauthorized', message:'API key required' }`.

**Error shape** (all non-2xx): `{ statusCode: number; error: string; message: string; code?: string; details?: string[] }`. Codes: `validation` (400, `details` lists field problems), `not_found` (404), `conflict` (409, e.g. status transition), `database_unavailable` (503).

**Pagination** (collection routes only): query `page` (1-based, default 1) and `per_page` (default 100, max 500); response `{ data: T[], page, per_page, total }`. The OpenAPI document declares both parameters and the `data` array so the app's REST discovery proposes these routes as tables with rows pointer `/data` and page-style pagination. Routes with path parameters are deliberately not tables.

**Soft deletes.** Every Intellify read excludes `deleted = true` rows unless `?includeDeleted=true`.

### 2.1 Service

| Method + path | Purpose | Response |
|---|---|---|
| `GET /health` | liveness and database state | `{ ok: boolean, version, database: 'up'\|'down', schema: 'intellify', rfpSchemaVersion: number\|null }` |
| `GET /openapi.json` | OpenAPI 3.0 document (title `Intellify RFP API`) | the document |

### 2.2 Collections (tables for the REST datasource; group `intellify`)

| Method + path | Row shape (`data[]`) |
|---|---|
| `GET /v1/clients?q=&page=&per_page=` | `{ id, oneCode, name, tenantKey, headcount: number\|null /* latest census totalEmployees */, latestCensusYear: string\|null, linesOffered: number, nextRenewalEffectiveDate: string\|null }`; `q` matches name or oneCode, case-insensitive substring |
| `GET /v1/products` | `{ id, name, locType, displayOrder }` (the 12 lines of coverage) |
| `GET /v1/funding-types` | `{ id, name, displayOrder, theme }` |
| `GET /v1/plan-types?line=` | `{ id, line, name }` (`line` = product name) |
| `GET /v1/carriers?line=&clientOneCode=` | `{ id, name, code, lines: string[] /* product names from insurer_categories */, incumbentFor: string[] /* lines where it carries a live policy for clientOneCode; [] without the param */, finalCredits: number /* carrier_credits isFinal and not expired for that client */ }` |
| `GET /v1/plan-designs?clientOneCode=&line=` | `{ id, clientOneCode, clientName, line, planType, carrier, fundingType, state, creationFlag, policyNumber, enrolledEmployees, annualPremium, planYear }` (one row per plan design joined to its coverage + financial; `planType` from `plan_financial.planType`) |
| `GET /v1/policies?clientOneCode=` | `{ id, clientOneCode, carrier, number, kickOffTiming, kickOffDays, coverages: number }` |
| `GET /v1/financials?clientOneCode=&line=&planYear=` | `{ coverageId, clientOneCode, line, planDesignId, carrier, fundingType, planType, ratingBasis, planYear, enrolledEmployees, coveredLives, monthlyPremium, annualPremium, priorYearAnnualPremium, renewalIncreasePct, employerPct, employeeMonthlyEmployeeOnly, adminFeePepm, stopLossPepm, ratePer1000, pepm, rateEmployeeOnly, rateEmployeeSpouse, rateEmployeeChildren, rateFamily, enrollEmployeeOnly, enrollEmployeeSpouse, enrollEmployeeChildren, enrollFamily }` (flattened `plan_financial`; nulls where a key doesn't apply) |
| `GET /v1/census?clientOneCode=&year=` | `{ documentId, clientOneCode, effectiveYear, totalEmployees, eligibleEmployees, enrolledEmployees, averageAge, averageSalary, femalePct, malePct, fullTime, partTime, tierEmployeeOnly, tierEmployeeSpouse, tierEmployeeChildren, tierFamily, statesCount, participationRate, source, uploadedAt }` |
| `GET /v1/rfps?clientOneCode=&status=&createdBy=` | `RfpSummary` (2.4) |

### 2.3 Per-client reads (the agent's stage tools)

| Method + path | Response |
|---|---|
| `GET /v1/clients/{oneCode}` | `{ client: { id, oneCode, name, tenantKey, deleted }, contacts: [{ email, contactType, country }], headcount, latestCensusYear, lines: [{ line, locType, status /* latest loc_statuses */, statusSince, planDesigns: number }] }`; 404 `Client "<oneCode>" not found` |
| `GET /v1/clients/{oneCode}/renewals` | `{ planYear: 2026, renewals: [{ line, carrier, policyNumber, effectiveDate /* planYear+1-01-01 */, kickOffTiming: { name, days }, kickOffDate /* effectiveDate − days */, locStatus, annualPremium, renewalIncreasePct, reminders: [{ emailId, reminderDate }] }], upcomingWizards: [{ type, status }] }`. Assumption, documented in the response and the spec: plans are calendar-year, the renewal effective date is 1 January after `plan_financial.planYear`. |
| `GET /v1/clients/{oneCode}/program?line=` | `{ lines: [{ line, locType, status, plans: [{ planDesignId, planType, carrier, carrierId, fundingType, state, creationFlag, policyNumber, eligibility: { workflowStatus, versions }, censusMapping: { mapped: number, unmapped: string[] }, financials: { planYear, enrolledEmployees, coveredLives, annualPremium, priorYearAnnualPremium, renewalIncreasePct, employerPct } }] }], carriers: [{ carrier, lines: string[] }] }` |
| `GET /v1/clients/{oneCode}/plans/{planDesignId}` | the plan with the full `planFinancial` object, every eligibility version, census plans mapped to it, alternate plans from wizards, reminders |
| `GET /v1/clients/{oneCode}/financials?line=&planYear=` | `{ planYear, rows: Financial[] /* 2.2 shape */, totals: { annualPremium, priorYearAnnualPremium, renewalIncreasePct, enrolledEmployees } }` |
| `GET /v1/clients/{oneCode}/census?year=` | `{ years: string[], selected: { ...census row (2.2), gender: {female, male}, byState: [{ state, employees }], tiers: [{ tier, employees, share }], employeeClass: {fullTime, partTime} }, plans: [{ line, censusPlanName, mappedTo: { planDesignId, planType, carrier } \| null }], aggregated: {...} \| null }` (default `year` = latest) |
| `GET /v1/clients/{oneCode}/commercials` | `{ contributions: [{ line, periodStart, periodEnd }], carrierCredits: [{ carrier, expirationDate, isFinal, notifications: number }], fees: [{ carrier, effectiveDate, expirationDate }], survey: { periodStart, periodEnd, answers: {...} } \| null, pointSolutions: [{ vendor, product }] }` |
| `GET /v1/clients/{oneCode}/wizards` | `{ wizards: [{ id, line, type, status }], alternatePlans: [{ planDesignId, planType, name, fundingType, line }] }` |

### 2.4 RFP records

`RfpSummary = { id, clientOneCode, clientName, title, planYear, effectiveDate, status: 'draft'|'ready'|'issued'|'closed', stage: 0..7, lines: number, carriers: number, requirements: number, milestones: number, createdBy, createdAt, updatedAt }`.

`Rfp = RfpSummary & { sections: { executiveSummary?, clientBackground?, scopeStatement?, instructionsToBidders?, evaluationCriteria?, notes? }, lines: RfpLine[], carriers: RfpCarrier[], requirements: RfpRequirement[], timeline: RfpMilestone[] }`
- `RfpLine = { id, position, line, productId, planDesignIds: string[], marketBasis: 'as-is'|'alternate', alternateFunding?: string, alternatePlanType?: string, notes? }`
- `RfpCarrier = { id, position, insurerId, insurerName, lines: string[], incumbent: boolean, contactEmail?, notes? }`
- `RfpRequirement = { id, position, section, question, required: boolean, answerType: 'text'|'yes_no'|'number'|'table'|'attachment' }`
- `RfpMilestone = { id, position, milestone, dueDate, owner?, notes? }`

| Method + path | Body | Response / rules |
|---|---|---|
| `POST /v1/rfps` | `{ clientOneCode, planYear, title?, createdBy? }` | `201 Rfp`; title defaults to `<client name> — <planYear> benefits RFP`; `effectiveDate` defaults to `<planYear>-01-01`; 400 when the client doesn't exist or `planYear` is not 2024..2035 |
| `GET /v1/rfps` | query `clientOneCode`, `status`, `createdBy` | paged `RfpSummary` (2.2), newest first |
| `GET /v1/rfps/{id}` | | `Rfp`; 404 `RFP "<id>" not found` |
| `PATCH /v1/rfps/{id}` | `{ title?, planYear?, effectiveDate?, status?, stage?, sections?: Partial<sections> }` (sections merge key by key) | `Rfp`; 409 `code: conflict` when `status` goes backwards; `stage` 0..7 |
| `PUT /v1/rfps/{id}/lines` | `RfpLine[]` without ids (whole list replaced) | `Rfp`; 400 lists unknown lines or plan design ids that don't belong to the client |
| `PUT /v1/rfps/{id}/carriers` | `{ insurer: string /* id or exact name, case-insensitive */, lines: string[], incumbent?, contactEmail?, notes? }[]` | `Rfp`; 400 `Unknown carrier "<x>". Known: …` |
| `PUT /v1/rfps/{id}/requirements` | `RfpRequirement[]` without ids | `Rfp` |
| `PUT /v1/rfps/{id}/timeline` | `RfpMilestone[]` without ids | `Rfp`; 400 on an unparseable date |
| `DELETE /v1/rfps/{id}` | | `204`; 409 unless `status = draft` |
| `DELETE /v1/rfps?createdBy=` | | `{ deleted: number }`; drafts only; `createdBy` required (eval cleanup) |

### 2.5 Package

| Method + path | Response |
|---|---|
| `GET /v1/rfps/{id}/document.md` | `text/markdown`; the document (outline below) |
| `GET /v1/rfps/{id}/document.pdf` | `application/pdf` |
| `GET /v1/rfps/{id}/exhibits` | `{ exhibits: [{ name, title, rows }] }` with names `exhibit-a-census`, `exhibit-b-plan-designs`, `exhibit-c-financials`, `exhibit-d-carriers` |
| `GET /v1/rfps/{id}/exhibits/{name}.csv` | `text/csv`, RFC 4180, header row |
| `GET /v1/rfps/{id}/package.zip` | `application/zip` with `rfp.md`, `rfp.pdf`, `exhibits/<name>.csv`, `manifest.json` (`{ rfpId, title, generatedAt, files[] }`) |

Document outline (Markdown, deterministic): title (`# <title>`), a facts line (client, plan year, effective date, status, generated at), `## 1. Executive summary` (section text or `_To be written._`), `## 2. Client background` (client facts + latest census table), `## 3. Scope of this RFP` (scope statement + a table of lines: line, market basis, plans in scope, alternate funding/plan type), `## 4. Current program` (one table per line in scope: plan, carrier, funding, enrolled, annual premium, renewal increase), `## 5. Carriers invited` (table), `## 6. Requirements and questionnaire` (one subsection per `section`, numbered questions with required/answer type), `## 7. Timeline` (table), `## 8. Instructions to bidders` and `## 9. Evaluation criteria` (section texts), `## Exhibits` (list). Exhibits are computed live from the Intellify data for the RFP's client and lines in scope.

### 2.6 `rfp` schema DDL (`db/migrations/001_rfp_schema.sql`)

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

Migration approach: files `NNN_<name>.sql` applied in order inside one transaction each, skipped when `version` is already in `rfp.schema_migrations`, under `SELECT pg_advisory_xact_lock(727001)` so two embedded instances (worktrees) don't race. `gen_random_uuid()` is built into PostgreSQL 13+ (the compose image is 16). Removing the fixture never touches `rfp`; "Recreate testing data" for `intellify` drops only schema `intellify`, so drafts survive a reseed (their `client_one_code` may dangle; `GET` then reports `clientMissing: true`).

**OpenAPI generation:** `@nestjs/swagger` decorators on DTO classes and controllers; `SwaggerModule.createDocument(app, config)` once at start, served by `GET /openapi.json`. The REST discovery needs each collection operation to be `GET`, have no path parameter, declare `page` and `per_page` as optional integers, and declare the `data` array schema — covered by one shared `@ApiPagedResponse(RowDto)` decorator.

---

## 3. The agent

### 3.1 Registration and hub

- `backend/src/mastra/agents/rfp.agent.ts`: `new Agent({ id: 'rfp-builder', name: 'RFP Builder', description: "Walks a Mercer benefits consultant through building a carrier RFP for one client over the Intellify data, stage by stage, and assembles the RFP package.", instructions: ({ requestContext }) => rfpInstructions(), skills: () => rfpSkills(), model: async () => resolveAgentModel(), memory: new Memory({ options: { lastMessages: 40, semanticRecall: false, generateTitle: false } }), tools: RFP_TOOLS })`. No `workspace` (no workspace tools in the prompt). Registered in `mastra/index.ts` as `rfp: rfpAgent`.
- Prompt serving: the shipped text (3.2) **without** its `## Tools` section is `RFP_PROMPT` in `agents/system-prompts.ts` and `SHIPPED.rfp` in `shipped-agent-prompts.ts`; `rfpInstructions()` = `agentInstructions('rfp', RFP_PROMPT)` with the generated `## Tools` lines inserted before the first line that is exactly `## Working rules` (or appended after a blank line when the override has none). The tool lines use the assistant's rule: `- <name>(<input names>): <first sentence of the description>`; reuse the helper from `assistant-prompt.ts` if it is exported, else add `mastra/tool-section.ts` (a 20-line function) and leave `assistant-prompt.ts` alone. `prompt.linksAllowed` is `false` for `rfp`; the override must start with `You are the RFP Builder` (checked in `AgentPromptsService.save` by a per-key identity-line table, additive).
- Skills: `AGENT_SKILLS.rfp = ['rfp-process']` in `app-skills.ts` (so the startup check validates the folder and the Skills tab lists it); `rfpSkills()` = `catalogSkills('rfp')` mapped through the same `createSkill` logic as `assistantSkills` (extract the mapping into `mastra/skill-sources.ts` or call `assistantSkillSources`-like code with agent `rfp`; keep `assistant-skills.ts` unchanged).
- Hub: `OFFICIAL_AGENT_KEYS = ['assistant', 'rfp']` replaces `OFFICIAL_AGENT_KEY` in `agents.service.ts` (`kind: 'official'`, `owner: 'Official'`). A built-in session descriptor table `BUILTIN_AGENT_SESSIONS: Record<string, { datasetName: string; requirement: string }> = { rfp: { datasetName: 'Intellify RFP API', requirement: 'Load the "Intellify RFP API" sample in Settings → Testing Data first' } }` (in `modules/agents/builtin-sessions.ts`, imported by `AgentsService` and `SessionsService`). `summarize()` fills `datasets: [datasetName]`, `missingDatasets: [datasetName]` when no such dataset exists, and a new optional `chatRequirement?: string` (the requirement text when missing). `evalSets(key)` returns the sets whose `agentKey` is `key`.
- Frontend: `canStartChat` unchanged (official or Live user). `startChatWithAgent`: official with `datasets.length === 0` → composer (assistant); otherwise `createFromAgent(key)`. `startChatBlockedReason`: returns `agent.chatRequirement` when present, else the existing user-agent rule. Minimal: `agent-hub.util.ts` (two functions), `app.ts` (one condition), `agents-api.service.ts` (one optional field). The detail page's tabs already work for an `official` kind (Chat Box with Start chat, System Prompt editable, Skills, Tools, Memory, Evals, LLM Config).

### 3.2 System prompt (shipped text; `## Tools` is generated and shown here as the rendered result)

```
You are the RFP Builder — a Mercer employee-benefits consultant's working
partner for one job: building a carrier request for proposal (RFP) for one
client, stage by stage, over the Intellify data reached through its API.
You never query a database. Every fact you state comes from a tool result
in this conversation, and every decision the consultant makes is saved
through a tool, so the RFP can be resumed in a later session.

## Tools
- list_clients(query): Find Intellify clients by name or client code.
- get_client_renewals(clientOneCode): The client's lines of coverage with their carriers, policy numbers, renewal effective dates and kick-off dates.
- get_client_program(clientOneCode, line): The client's current program: every plan design per line with carrier, funding, plan type, eligibility status, census mapping and the latest financials.
- get_plan_design(clientOneCode, planDesignId): One plan design in full: the complete financial document, eligibility versions, census plans mapped to it and alternate plans.
- get_client_financials(clientOneCode, line): Premiums, rates by tier, enrolment, contributions and fees per coverage, with totals.
- get_client_census(clientOneCode, year): The client's census for a plan year: headcount, eligibility, enrolment, demographics, states, tiers and the census plans with their mapping.
- get_client_commercials(clientOneCode): Contribution strategy periods, carrier credits, ancillary fees, the national survey answers and point solutions.
- get_marketing_history(clientOneCode): Past wizard runs (marketing, renewal, benchmark, new plan) and the alternate plans they produced.
- list_reference_data(kind): The reference lists: lines of coverage (products), funding types or plan types.
- list_carriers(line, clientOneCode): Carriers and the lines they write; with a client, which lines they are incumbent on and their final credits.
- create_rfp(clientOneCode, planYear, title): Create a draft RFP record for a client and plan year.
- list_rfps(clientOneCode, status): Existing RFP records, newest first.
- get_rfp(rfpId): One RFP record with its lines, carriers, requirements, timeline and narrative sections.
- update_rfp(rfpId, title, status, effectiveDate, stage, sectionName, sectionText): Change an RFP's title, status, effective date, completed stage, or one narrative section.
- set_rfp_lines(rfpId, lines): Replace the lines of coverage in scope, one per line of text.
- set_rfp_carriers(rfpId, carriers): Replace the carriers invited, one per line of text.
- set_rfp_requirements(rfpId, requirements): Replace the requirements and questionnaire, one per line of text.
- set_rfp_timeline(rfpId, milestones): Replace the timeline, one milestone per line of text.
- export_rfp_package(rfpId): Assemble the RFP package (Markdown and PDF document, CSV exhibits) and make it downloadable from this chat.
- ask_clarification(question, options): Ask the consultant ONE question with 2-4 concrete answer options when a choice forks the work.

## Working rules
Process:
- Load the "rfp-process" skill before your first answer in a session, and
  read the stage's reference file before you start that stage. The seven
  stages run in order: 1 client and renewal, 2 current program, 3 what to
  market, 4 carriers to invite, 5 requirements and questionnaire,
  6 timeline, 7 assemble and review. The session context names the active
  RFP and the stage it reached; resume from the next stage.
- One stage per exchange: show what the data says, propose the decision,
  and ask the consultant to confirm or change it. Save a confirmed decision
  with the matching set_rfp_* tool, then advance the stage with update_rfp,
  before moving on. Never save a decision the consultant has not confirmed.
- Use ask_clarification only when a choice forks the work: several clients
  match a name, several lines renew at different dates, or the plan year is
  unclear. Otherwise ask in your answer, with the options from the data.

Grounding:
- Every figure, carrier, plan, date and name comes from a tool result in
  this conversation. Never fill a gap from general knowledge about carriers,
  benchmarks, market trends or rates; when the data lacks something, say so
  and ask the consultant for it.
- Show names, never ids: plan names and types, carrier names, lines of
  coverage. Keep ids for tool calls only.
- Money is annual and in USD unless the data says otherwise. Show the plan
  year and the renewal increase beside every premium.
- Rows flagged deleted are not in the data you receive; do not mention them.

Writing:
- Answer in short sections. Use a table for plans, premiums, carriers,
  requirements and milestones. Keep each reply to what the stage needs.
- You write the RFP's narrative sections (executive summary, client
  background, scope statement, instructions to bidders, evaluation
  criteria) from the saved record and the data, in the consultant's voice,
  and save each with update_rfp so the exported document carries them.
- Call export_rfp_package only after the stage-7 review is confirmed. Then
  say what the package holds and that it can be downloaded from this chat.

Scope and errors:
- You build RFPs over the Intellify data only. For anything else, say in
  one sentence what you do instead, and stay on the RFP.
- A tool error is yours to handle: read it, fix the call and retry. Report a
  problem only when the consultant must act, for example when the Intellify
  API sample is not loaded.
```

Rules encoded (for agents.md 2.8, "R" prefix to keep them apart from A-rules): R1 identity and no-database; R2 load the skill first and read each stage reference; R3 stage order and resume from context; R4 one stage per exchange, confirm before saving, advance with `update_rfp`; R5 clarification only on a fork; R6 grounding; R7 names not ids; R8 money conventions; R9 deleted rows; R10 tables and brevity; R11 narrative sections saved through `update_rfp`; R12 export after the stage-7 review; R13 scope refusal; R14 tool errors.

Prompt requirement: the prompt MUST start with `You are the RFP Builder` (asserted on the System Prompt tab by the E2E).

### 3.3 Per-turn context for an `rfp` session (agents.md 4.1 addition)

Block 1 is replaced by **Block R1 — RFP orientation**:
```
Intellify RFP API for this session: datasource <datasource id> ("<datasource name>").
Active RFP in this session: <rfpId> — "<title>" for <client name> (<oneCode>), plan year <planYear>, status <status>, last completed stage <stage>.   ← or "No RFP is active in this session yet: start at stage 1."
Today is <YYYY-MM-DD>.
```
Blocks 2–4 (metrics, knowledge, verified queries) and Block 5 are not sent. requestContext keys: `datasets`, `session-id`, `turn-question`, `session-workspace-id` (for the export tool's file write through the bridge), `rfp-created-by` (the current user's `ownerKey()`; evals set `eval:<jobId>`), `turn-rfp` (a live `{ rfpId? }` holder the tools fill when `create_rfp` or `get_rfp` succeeds; the orchestrator persists it on the session as `rfpId`).

### 3.4 Skill `rfp-process` (`backend/src/mastra/skills/rfp-process/`)

`SKILL.md`:
```
---
name: rfp-process
description: Use when building or resuming a carrier RFP for a client over the Intellify data: the seven stages, what each stage reads, decides and saves, and how the package is assembled. Read the stage's reference file before starting it.
---
Building a carrier RFP runs through seven stages, in order. Before each
stage, read its reference file; it says which tools to call, what to show,
which decision to ask for, and which tool saves it.

| Stage | Decides | Reference |
|---|---|---|
| 1. Client and renewal | which client, which plan year and renewal | reference/1-client-and-renewal.md |
| 2. Current program | what is in place today, per line | reference/2-current-program.md |
| 3. What to market | lines in scope, as-is or alternates | reference/3-market-scope.md |
| 4. Carriers to invite | the bid list and incumbents | reference/4-carriers.md |
| 5. Requirements and questionnaire | what bidders must answer | reference/5-requirements.md |
| 6. Timeline | milestones from kick-off to effective date | reference/6-timeline.md |
| 7. Assemble and review | the narrative sections and the package | reference/7-package.md |

Rules that hold in every stage:
- Resume from the stage after the one the session context says was
  completed; re-read that RFP with get_rfp first.
- Saving is explicit: set_rfp_* replaces the whole list it names, so send
  the complete list every time, and update_rfp(stage) marks the stage done.
- Line-per-row inputs use " | " between fields, exactly as each reference
  shows; a tool answers with a validation error naming the bad row.
```

Reference files (each 40–80 lines; content to write):
- `1-client-and-renewal.md`: tools (`list_clients` with the consultant's words; `get_client_renewals`); what to show (client, headcount, latest census year, a table of lines with carrier, effective date, kick-off date, loc status, premium and increase); how to pick the plan year (the renewal's effective year); the decision (client + plan year); save with `create_rfp` (or `list_rfps` → `get_rfp` when a draft exists for that client and year: offer to resume), then `update_rfp(stage=1)`.
- `2-current-program.md`: `get_client_program`, `get_client_financials`, `get_client_census` (latest year), `get_client_commercials`; what to show (per line: plans with carrier, funding, type, enrolled, annual premium, increase; census headline numbers; participation; employer contribution; credits expiring before the effective date; unmapped census plans as a data-quality note); no decision beyond "anything missing or wrong?"; save the client-background narrative with `update_rfp(sectionName='clientBackground')`, `update_rfp(stage=2)`.
- `3-market-scope.md`: `get_marketing_history`, `list_reference_data('funding-types'|'plan-types')`; heuristics to propose (lines renewing with an increase above the client's average, lines with a single carrier for 3+ years are unknown — never assume, say what the data shows; alternates from past wizards' alternate plans); the `set_rfp_lines` row format `<line> | as-is|alternate | <plan design ids, comma-separated or all> | <alternate funding or -> | <alternate plan type or -> | <notes>`; save, write `scopeStatement`, `update_rfp(stage=3)`.
- `4-carriers.md`: `list_carriers(line, clientOneCode)` per line in scope; propose incumbents plus carriers writing the line; respect credits (an incumbent with final credits expiring at renewal: flag it); row format `<carrier name> | <lines, comma-separated> | incumbent yes|no | <contact email or -> | <notes>`; `set_rfp_carriers`, `update_rfp(stage=4)`.
- `5-requirements.md`: a standard questionnaire skeleton by section (Company and financials, Network and access, Plan design match, Pricing and rate guarantees, Funding and stop-loss (self-funded lines), Administration and service, Implementation, Data and reporting, Point solutions and wellness, Legal and compliance), each with 3–6 questions tailored to the lines and funding in scope; row format `<section> | <question> | required yes|no | text|yes_no|number|table|attachment`; ask the consultant to add client-specific asks; `set_rfp_requirements`, `update_rfp(stage=5)`.
- `6-timeline.md`: default milestones relative to the effective date E and the kick-off date K (from stage 1; K = E − kick-off days, else E − 120 days): RFP issued K; carrier intent to bid K+5; questions due K+10; answers published K+14; proposals due K+30; clarifications K+37; analysis and shortlist K+45; finalist presentations K+55; best-and-final K+62; decision K+70; carrier notification K+72; implementation kick-off K+80; open enrollment materials E−45; open enrollment E−30 to E−16; effective date E; owners (Mercer consultant, client HR, carriers); row format `<milestone> | <YYYY-MM-DD> | <owner> | <notes>`; dates never in the past relative to the session context's today unless the consultant says so; `set_rfp_timeline`, `update_rfp(stage=6)`.
- `7-package.md`: `get_rfp`; write and save `executiveSummary`, `instructionsToBidders`, `evaluationCriteria` (templates with the fields to fill from the record); a review checklist (every line has plans or an explicit "all"; at least two carriers per line; every section has questions; timeline ends on the effective date); set `status='ready'` and `stage=7`; call `export_rfp_package`; what to say afterwards.

### 3.5 Tools (`backend/src/mastra/tools/rfp.tools.ts`)

Shared: every tool resolves `{ baseUrl, headers }` (1.2), calls `fetch` with a 20 s timeout and `Accept: application/json`, and returns the JSON body on 2xx or `{ error: '<status> <code>: <message>[; <details>]' }` otherwise; network failures → `{ error: 'Intellify API unreachable at <baseUrl>: <cause>' }`. Nothing throws to the model. Every input is scalar (string/number/boolean); list inputs are one string with one item per line and ` | ` between fields (retrospective 1.13.9–12). The parser trims, drops leading `-`/`*`/`1.` markers, ignores blank lines, and returns `{ error: 'Row <n> "<text>": expected <k> fields separated by " | "' }` before any HTTP call.

| Tool | Input (Zod, all `.describe()`d) | Calls | Output |
|---|---|---|---|
| `list_clients` | `query?: string` (name or code fragment) | `GET /v1/clients?q=&per_page=50` | `{ clients: [...] (2.2 row) }` |
| `get_client_renewals` | `clientOneCode: string` | `GET /v1/clients/{c}/renewals` | the response |
| `get_client_program` | `clientOneCode`, `line?: string` | `GET /v1/clients/{c}/program?line=` | the response |
| `get_plan_design` | `clientOneCode`, `planDesignId` | `GET /v1/clients/{c}/plans/{id}` | the response |
| `get_client_financials` | `clientOneCode`, `line?` | `GET /v1/clients/{c}/financials?line=` | `{ planYear, columns, rows, totals }` (rows also surface as a chat data record, 3.6) |
| `get_client_census` | `clientOneCode`, `year?: string` | `GET /v1/clients/{c}/census?year=` | the response |
| `get_client_commercials` | `clientOneCode` | `GET /v1/clients/{c}/commercials` | the response |
| `get_marketing_history` | `clientOneCode` | `GET /v1/clients/{c}/wizards` | the response |
| `list_reference_data` | `kind: 'products' \| 'funding-types' \| 'plan-types'`, `line?` | the matching collection | `{ items: [...] }` |
| `list_carriers` | `line?`, `clientOneCode?` | `GET /v1/carriers?line=&clientOneCode=` | `{ carriers: [...] }` |
| `create_rfp` | `clientOneCode`, `planYear: number`, `title?` | `POST /v1/rfps` (+ `createdBy` from `rfp-created-by`) | `Rfp`; sets `turn-rfp.rfpId` |
| `list_rfps` | `clientOneCode?`, `status?` | `GET /v1/rfps?...&createdBy=` (own records first; `createdBy` omitted so shared drafts show) | `{ rfps: RfpSummary[] }` |
| `get_rfp` | `rfpId` | `GET /v1/rfps/{id}` | `Rfp`; sets `turn-rfp.rfpId` |
| `update_rfp` | `rfpId`, `title?`, `status?: 'draft'\|'ready'\|'issued'\|'closed'`, `effectiveDate?`, `stage?: 0..7`, `sectionName?: 'executiveSummary'\|'clientBackground'\|'scopeStatement'\|'instructionsToBidders'\|'evaluationCriteria'\|'notes'`, `sectionText?` | `PATCH /v1/rfps/{id}` (one section per call) | `Rfp` |
| `set_rfp_lines` | `rfpId`, `lines: string` (rows `<line> \| as-is\|alternate \| <plan design ids or all> \| <alt funding or -> \| <alt plan type or -> \| <notes>`) | `PUT /v1/rfps/{id}/lines` | `Rfp` |
| `set_rfp_carriers` | `rfpId`, `carriers: string` (rows `<carrier> \| <lines> \| incumbent yes\|no \| <email or -> \| <notes>`) | `PUT /v1/rfps/{id}/carriers` | `Rfp` |
| `set_rfp_requirements` | `rfpId`, `requirements: string` (rows `<section> \| <question> \| required yes\|no \| text\|yes_no\|number\|table\|attachment`) | `PUT /v1/rfps/{id}/requirements` | `Rfp` |
| `set_rfp_timeline` | `rfpId`, `milestones: string` (rows `<milestone> \| <YYYY-MM-DD> \| <owner> \| <notes>`) | `PUT /v1/rfps/{id}/timeline` | `Rfp` |
| `export_rfp_package` | `rfpId` | bridge `exportRfpPackage(sessionId, datasourceId, rfpId)` → `GET /v1/rfps/{id}/package.zip`, unzipped into the workspace `rfp/<rfpId>/` | `{ rfpId, title, files: [{ name, bytes }], exportedAt }` |
| `ask_clarification` | shared tool | — | as today |

The tool-services bridge (`mastra/tool-services.ts`) gains `restTarget(datasourceId): Promise<{ baseUrl: string; headers: Record<string,string> }>` and `exportRfpPackage(sessionId, datasourceId, rfpId): Promise<RfpPackageResult>`; `SessionsService.onModuleInit` installs both (the export implementation lives in a new `modules/rfp-packages/rfp-packages.service.ts`).

### 3.6 Sessions bound to the agent (minimal code changes)

- `SessionDoc`: `agentKey?: string` (registry key of a built-in agent; absent = assistant), `rfpId?: string` (the active RFP, stamped by the orchestrator from `turn-rfp`); `ChatMessage.rfpPackage?: { rfpId, title, files: { name, bytes }[], exportedAt }`. No migration (new optional fields).
- `SessionsService.createFromAgent(key)`: when `key` is a registered built-in in `BUILTIN_AGENT_SESSIONS`: dataset must exist, else `BadRequestException(requirement)`; `insertSession(agent.name, [datasetName], { agentKey: key, agentName: agent.name })`. `toView`/`toViews`: for `agentKey`, `agent = { id: key, name, deleted: false, description, starterQuestions: RFP_STARTERS }` (e.g. `Start an RFP for <client>`, `Which of my clients renew on 1 January 2027?`, `Resume my draft RFPs`).
- `streamTurn`: `const agent = this.mastra.getAgent(session.agentKey ?? 'assistant')`; `agentOptions` branches: `agentKey === 'rfp'` → Block R1 and the `rfp-*` context keys (3.3); skip metrics/knowledge/verified/Block 5. After the stream: skip the grounding guard and careful mode unless the agent is the assistant; keep clarification interception and tool-only synthesis. `tool-result` handling: for a tool result that carries `rows` (`get_client_financials`, and the `rows` of the exhibits) build a data record `{ tool, input: <clientOneCode/line summary>, columns, rows (≤200), rowCount }` through a generalised `toolDataRecord` (accept any result with `columns` and `rows`); for `export_rfp_package` emit `rfp-package` (new SSE event, api.md 3.1) and persist `rfpPackage` on the answer; for every other RFP tool emit `tool-result { tool, input: <first string arg>, error? }` so the UI shows the step.
- New route `GET /sessions/:id/rfp-packages/:rfpId/download[?file=<name>]` (api.md #105): zip of `rfp/<rfpId>/` or one file, `Content-Disposition: attachment`; 404 `RFP package "<rfpId>" not found`. Owner-scoped like every session route.
- Frontend (`session-chat.html/.ts`): a package card beside the existing report card: title, `RFP package · <n> files`, buttons **Download package (.zip)** and per-file links (rfp.md, rfp.pdf, exhibits); toast `RFP package downloaded`. The session header chip and list row already show `agent.name` from the derived `agent`.

### 3.7 Testing Data fixture `intellify-api` (registers the datasource the agent uses)

- Registry entry: `{ id: 'intellify-api', name: 'Intellify RFP API', description: "The Intellify sample through the Intellify RFP API (the embedded service on INTELLIFY_API_PORT, default 3100): the RFP Builder agent's datasource, and its collection endpoints as tables.", datasourceKind: 'rest', schema: 'intellify', datasourceName: 'Intellify RFP API', datasetName: 'Intellify RFP API', requiredTables: ['clients','products','funding_types','plan_types','carriers','plan_designs','policies','financials','census','rfps'], defaults: placeholders }`.
- `POST /testing-data/intellify-api/load` (body ignored; validation skipped for `datasourceKind: 'rest'` fixtures whose `selfRegistering` flag is true): reads `IntellifyApiInfo` (`{ url, apiKey }`; absent → `ok:false, message: 'The Intellify API is not running in this app (INTELLIFY_API=off or it failed to start) — see the system logs.'`), checks `GET /health` (database down → `ok:false, message: 'The Intellify API cannot reach its database at <host:port/db>. Load the "Intellify" sample into that database first.'`), discovers endpoints from `/openapi.json` through `DatasourcesService.discoverRestEndpoints`, keeps the proposed collection endpoints with `group: 'intellify'`, saves the datasource (`kind: 'rest'`, `auth: { type: 'api-key-header', headerName: 'X-API-Key', token: apiKey }`, reusing an existing record by name), refreshes the inventory, saves the dataset with the 10 required entities. Message: `Registered the Intellify RFP API at <url> and loaded 10 entities into dataset "Intellify RFP API"`.
- `world-cup-rest` stays as it is. The panel: for a self-registering REST fixture the card shows the API URL instead of the connection form and the primary action **Register testing data** with the confirmation `This registers the Intellify RFP API at <url> as a datasource and dataset. No database changes are made.`

---

## 4. Export: how the consultant gets the package

- From the chat: the agent calls `export_rfp_package` at the end of stage 7; the answer shows the package card (3.6) with **Download package (.zip)** and per-file links, served by `GET /sessions/:id/rfp-packages/:rfpId/download`. Files live in the session workspace `rfp/<rfpId>/` (`rfp.md`, `rfp.pdf`, `exhibits/exhibit-a-census.csv`, `exhibit-b-plan-designs.csv`, `exhibit-c-financials.csv`, `exhibit-d-carriers.csv`, `manifest.json`), listed in data-model.md 4.1. Re-exporting overwrites them (the record is the source of truth).
- Directly from the API (any client, e.g. a browser with the key): `GET /v1/rfps/{id}/document.md|pdf`, `/exhibits/{name}.csv`, `/package.zip` (2.5).
- Reuse: `zip-archive.ts` is moved to `backend/src/common/zip-archive.ts` (both apps import it) — or duplicated into the API if the other session is editing sessions; prefer the move; the download route reuses the deep-analysis download pattern.

---

## 5. Spec changes (step 5), file by file

### 5.1 `specs/epics/BA-213/spec.md` (amendment; re-confirm with the user)

- Header: `**Status:** Confirmed (2026-10-14); amended on 2026-10-14 to add the RFP Builder (stories BA-xxx…), re-confirmed <date>`.
- Goal: append a paragraph: "On 2026-10-14 the user widened the epic: besides shaping user agents, the hub ships a second Official agent built in code, the **RFP Builder**, which walks a Mercer benefits consultant through building a carrier RFP for one client over the Intellify data (BA-212), reached only through a REST API this epic builds (ADR-0027, ADR-0028)."
- Scope: new bullet group **The RFP Builder and the Intellify RFP API** (stories 1.14.12–1.14.16): the API (read endpoints over `intellify`, RFP records in a new `rfp` schema, OpenAPI, API-key auth, embedded start, Testing Data registration); the built-in agent `rfp` (prompt, `rfp-process` skill, dedicated HTTP tools, Official kind, Start chat over the fixture's dataset, sessions bound to a built-in agent); the package (Markdown and PDF document, CSV exhibits, download from the chat); the `rfp` eval set.
- Out of scope: change the first bullet to "**New tools for user agents**, custom code tools, MCP servers or any tool a user agent could pick beyond the assistant's. The RFP Builder's tools are built in code for that agent only (ADR-0028)." Add: "Per-user access control inside the Intellify RFP API (the API key is the boundary); real Intellify data; an RFP workflow beyond one consultant (approvals, carrier portal, bid comparison); editing the RFP outside the chat; snapshots of exhibits at issue time."
- Stories table: five rows 1.14.12–1.14.16 (keys from Jira; see open question 1).
- Specs touched: add ADR-0027/0028; new capability `rfp`; agents.md 1.2, 2.8, 3.10, 4.1, 7.4, 8.1; api.md 2.1 (#3, #105), 2.9 (#56), 2.16, 3.1, 6.1; data-model.md 3.4, 3.4.1, 3.10.3, 4.1, 7; agents-evals R1, R2, R5, R10, R11, R53; testing-data R1, R2, R9, R16; sessions-chat R52, R54; datasources (Contracts); ui.md 4.4, 4.5, 4.11, 4.12; delivery.md 2, 7; tech-stack.md; glossary; README table.
- Acceptance: add "The `rfp` eval set passes at 100% over 3 runs on the branch; the RFP builder Feature's Playwright scenarios pass against the embedded API with the LLM stub; `GET /openapi.json` lets Discover propose the 10 collection endpoints; the API's e2e spec proves reads are read-only (a write attempted through a read route fails) and writes touch `rfp.*` only."
- Dependencies/risks: Postgres required for the API (degrades to 503); eval records clean-up; ADR numbers 0027/0028; the other session's parallel edits to agents/sessions files.

### 5.2 New capability `specs/capabilities/rfp/spec.md` ("RFP builder") and the README row

`| [rfp](capabilities/rfp/spec.md) | The RFP Builder agent, the Intellify RFP API, RFP records and the RFP package | RFP builder (\`rfp-builder.spec.ts\`) |` (plus the API Feature with `E2E: none yet` and a note that `backend/test/intellify-api.e2e-spec.ts` covers it at API level).

Sections: Concepts (RFP, line of coverage, carrier, plan design, census, renewal kick-off, package, exhibit; link glossary); Rules (draft): R1 the RFP Builder is a built-in Official agent with Start chat over the `Intellify RFP API` dataset, blocked with `Load the "Intellify RFP API" sample in Settings → Testing Data first`; R2 a session started from it is bound to the agent (`agentKey`) and runs it on every turn; R3 the agent reaches Intellify only through the API, through the REST datasource bound to the session; R4 the seven stages, one per exchange, saved only after confirmation; R5 an RFP record holds client, plan year, effective date, status, stage, sections, lines, carriers, requirements, timeline; R6 statuses move forward only; R7 drafts can be resumed from any session of the agent; R8 the package: Markdown, PDF, CSV exhibits a–d, zip; R9 the download from the chat; R10 reads read-only, writes to `rfp` only; R11 API key auth; R12 OpenAPI and Discover; R13 the testing-data registration; R14 evals. Edge cases: API down, database down, sample not loaded, deleted client, backwards status, bad row format, package of an empty record. Contracts: api.md 2.16, data-model 3.4/7, agents.md 2.8. UI: the hub card, the package card, the testing-data card. Flows (5.3). Acceptance.

### 5.3 Gherkin (into the `rfp` capability)

```gherkin
Feature: RFP builder
  E2E: `frontend/e2e/rfp-builder.spec.ts`

  Background:
    Given the app runs with the LLM stub as its provider
    And the Intellify sample is loaded into the sample database
    And the "Intellify RFP API" sample is registered in Testing Data

  Scenario: The hub offers the RFP Builder as an Official agent
    When I open "Agents"
    Then the "Official" section shows "RFP Builder" with "Owner: Official"
    And its card offers "Start chat with RFP Builder"

  Scenario: Start chat is blocked until the API sample is registered
    Given the "Intellify RFP API" sample is not registered
    When I open "Agents"
    Then "Start chat with RFP Builder" is disabled
    And its title reads "Load the \"Intellify RFP API\" sample in Settings → Testing Data first"

  Scenario: Start chat opens a session bound to the RFP Builder
    When I click "Start chat with RFP Builder"
    Then I see the toast "Session \"RFP Builder\" created"
    And the session header shows the agent chip "RFP Builder"
    And the welcome block offers the starter question "Start an RFP for a client"

  Scenario: The first turn loads the rfp-process skill and reads the client
    Given the stub answers the first call by calling "skill" with name "rfp-process"
    And the stub answers the next call by calling "list_clients" with query "Orchard"
    And the stub then answers with text
    When I send "Start an RFP for Orchard Manufacturing"
    Then the request the stub received offered the tools "list_clients", "create_rfp" and "export_rfp_package" and not "run_readonly_sql"
    And the chat shows the step "list_clients"
    And the stub's second request carried a tool result naming "Orchard Manufacturing"

  Scenario: A created RFP becomes the session's active RFP
    Given the stub answers by calling "create_rfp" for client "IC100100" and plan year 2027
    When I send "Create the RFP for the 2027 plan year"
    Then the next request the stub receives carries a system message with "Active RFP in this session"
    And GET /v1/rfps on the API lists a draft for "Orchard Manufacturing"

  Scenario: The package is downloadable from the chat
    Given a draft RFP exists for "Orchard Manufacturing" with one line and one carrier
    And the stub answers by calling "export_rfp_package" for that RFP, then with text
    When I send "Build the package"
    Then the answer shows the card "RFP package · 7 files"
    When I click "Download package (.zip)"
    Then a file named "rfp-<title>.zip" downloads and contains "rfp.md", "rfp.pdf" and "exhibits/exhibit-a-census.csv"

  Scenario: The System Prompt tab shows the RFP Builder's prompt
    When I open the "RFP Builder" agent and its "System Prompt" tab
    Then the prompt starts with "You are the RFP Builder"
    And the "Skills (1)" tab lists "rfp-process" as "Built-in" and "On demand"
```

```gherkin
Feature: Intellify RFP API
  E2E: none yet
  (API-level: `backend/test/intellify-api.e2e-spec.ts`, skipped visibly without the sample database)

  Scenario: Reads need the API key
    When I call GET /v1/clients without an X-API-Key header
    Then the answer is 401 with message "API key required"

  Scenario: Collections page and describe themselves
    When I call GET /v1/clients?per_page=5 with the key
    Then I get 5 rows, page 1, per_page 5 and a total of 38 non-deleted clients
    And GET /openapi.json declares "page" and "per_page" on /v1/clients and a "data" array

  Scenario: An RFP is created, built up and exported
    When I POST /v1/rfps for client "IC100100" and plan year 2027
    And I PUT its lines, carriers, requirements and timeline
    Then GET /v1/rfps/{id} returns them with positions in order
    And GET /v1/rfps/{id}/document.md contains "## 3. Scope of this RFP" and the carrier names
    And GET /v1/rfps/{id}/package.zip holds rfp.md, rfp.pdf and four exhibits

  Scenario: Status moves forward only and drafts alone can be deleted
    Given an RFP with status "issued"
    When I PATCH its status to "draft"
    Then the answer is 409 with code "conflict"
    When I DELETE it
    Then the answer is 409

  Scenario: Reads cannot write
    When a read route is made to run a statement that writes (test hook)
    Then PostgreSQL rejects it with "cannot execute ... in a read-only transaction"
```

### 5.4 System specs (targeted insertions)

- **api.md:** 1.9 permission table: add `GET /sessions/:id/rfp-packages/:rfpId/download` under `use-agents`; 2.1 #3 `POST /sessions`: `agentId` may also be the registry key of a built-in agent that declares a dataset (`rfp`): the session takes the agent's name and that dataset, stores `agentKey` and `agentName`; refusals `Load the "Intellify RFP API" sample in Settings → Testing Data first`; the wire session's derived `agent` for `agentKey`; new **#105** `GET /sessions/:id/rfp-packages/:rfpId/download`; 2.6 #33 `kind` is `official` for `assistant` and `rfp`, `AgentSummary.chatRequirement?`; #35 "the sets whose agent is `:key`"; 2.9 #56 the self-registering REST fixture; **new 2.16 Intellify RFP API** (the whole of section 2 above, each route as `` `METHOD /path` `` with `:oneCode`, `:id`, `:planDesignId`, `:name`); 3.1 new event `rfp-package`; 5 CLI flags and banner line; 6.1 the `INTELLIFY_*` variables; 6.4 `npm run intellify-api`.
- **data-model.md:** 3.4 `agentKey`, `rfpId`; 3.4.1 `rfpPackage`; 3.10.3 key list gains `rfp`; 4.1 workspace `rfp/<rfpId>/…`; new **section 7 — External databases**: the Intellify database (`INTELLIFY_DB_*`, schema `intellify` owned by the fixture) and the `rfp` schema with the DDL of 2.6 and the migration rule; the summary table of section 3 is unchanged (no new SQLite collection).
- **agents.md:** 1.2 registry table row `rfp | rfp-builder | RFP Builder | <description>` and "seven registered agents"; 1.1 override note (`rfp` has a generated `## Tools` like the assistant); new **2.8 `rfp` — RFP Builder** (purpose, invoked by, inputs, tools, memory, max steps 15, prompt requirements, the rules R1–R14, the shipped prompt verbatim in a new Appendix C); 3 intro "All tools belong to the assistant" → "…or to the RFP Builder (3.10)"; new **3.10 RFP tools** (the table of 3.5); 4.1 Block R1 and 4.2 keys `rfp-created-by`, `turn-rfp`; 5.1 the per-agent branches; 7.4 row `rfp | rfp-process | none`; 8.1 `EvalSet.agentKey?` and the `rfp` set; 9 unchanged.
- **agents-evals:** R1/R2 "Official" → the Official agents (`assistant`, `rfp`); R5 Official agents offer Start chat; R10 "Only the assistant SHALL have eval sets" → "Only the assistant and the RFP Builder"; R11 the `rfp` set; R53 the built-in dataset rule and `chatRequirement`.
- **sessions-chat:** R52 Start chat on the RFP Builder creates a session over the `Intellify RFP API` dataset bound to it; R54 applies to user agents; new R61 a session bound to a built-in agent runs that agent (link the rfp capability).
- **testing-data:** R1 "optional kind" + "self-registering"; R2 table row `intellify-api`; R9 the REST sample rule stays for `world-cup-rest`; new R21 self-registering fixtures; UI paragraph; Feature: scenario "Registers the Intellify RFP API".
- **datasources:** Contracts: "The Intellify RFP API is registered as a REST datasource (rfp capability)". No rule changes.
- **ui.md:** 4.4 Start chat on an official card with a requirement; 4.5 header actions for Official agents; 4.11 the self-registering card; 4.12 the package card and copy; 7 copy table entries.
- **delivery.md:** 2 scripts (`intellify-api`); 7 isolation row `Intellify API port 3100 | --intellify-api-port / INTELLIFY_API_PORT`; 1 desktop data dir file `.intellify-api-key`.
- **tech-stack.md:** backend table rows for `@nestjs/swagger` and `pdfkit`; code layout `intellify-api/`; test layout `intellify-api.e2e-spec.ts`, `rfp-builder.spec.ts`.
- **glossary:** *RFP (request for proposal)*, *RFP Builder*, *Intellify RFP API*, *Line of coverage*, *Carrier*, *Plan design*, *Census*, *Renewal kick-off*, *RFP package*, *Exhibit*; amend *Agent* ("seven built-in agents") and *Agent Hub* ("Official agents").
- **architecture.md:** ADR-0027, ADR-0028; container and component diagram nodes (1.5); ADR-0008 status line: "narrowed by ADR-0028 (sessions may bind to a built-in agent)".
- **non-functional.md:** one line: the Intellify RFP API key is a service secret kept in the data directory.
- **roadmap.md** (append under Milestone 1.14; also extend the milestone paragraph with one sentence naming the RFP Builder and ADR-0027/0028):

```
#### 1.14.12 — ADRs, epic amendment and specs for the RFP Builder and the Intellify RFP API ([BA-225](https://halo-powered.atlassian.net/browse/BA-225))  `📋 Planned`
- **Intent:** the RFP work is decided and specified before any code: where the API lives, how the agent reaches it, how sessions bind to a built-in agent, and what the package is.
- **Scope:** ADR-0027 and ADR-0028; the BA-213 epic amendment (scope, narrowed out-of-scope, stories, specs touched, acceptance) re-confirmed by the user; the new `rfp` capability spec with its Rules and Gherkin; the api.md 2.16 contract, the data-model `rfp` schema, agents.md 2.8 and 3.10, the glossary terms and the README row.
- **Out of scope:** code.
- **Acceptance:** the user confirms the amended epic spec and both ADRs; `python3 scripts/check-specs.py` passes with the new capability (its Feature marked `E2E: none yet` until 1.14.16).

#### 1.14.13 — The Intellify RFP API: read endpoints, auth, OpenAPI, embedded start and Testing Data registration ([BA-226](https://halo-powered.atlassian.net/browse/BA-226))  `📋 Planned`
- **Intent:** the Intellify data is reachable through a REST API we own, from the app and from any client with the key.
- **Scope:** `backend/src/intellify-api/` as a second NestJS app (ADR-0027); `INTELLIFY_*` configuration; `X-API-Key` guard; the error shape; `GET /health`, `GET /openapi.json`; the collection routes (clients, products, funding-types, plan-types, carriers, plan-designs, policies, financials, census) and the per-client routes (client, renewals, program, plans/{id}, financials, census, commercials, wizards) in READ ONLY transactions; embedded start from `createApp()` with `INTELLIFY_API=off`, CLI flags and banner line, the key file; `npm run intellify-api`; the `intellify-api` self-registering REST fixture and its card; the E2E fixture's port variable; `backend/test/intellify-api.e2e-spec.ts` for the reads.
- **Out of scope:** RFP records and the package (1.14.14); the agent (1.14.15).
- **Acceptance:** with the Intellify sample loaded, `GET /v1/clients/IC100100/program` answers the client's plans with carriers and 2026 premiums; Discover on a REST datasource at the API URL proposes the 10 collection endpoints; registering the fixture yields the "Intellify RFP API" datasource and dataset with 10/10 entities; the plain assistant answers "How many clients are there?" over that dataset.

#### 1.14.14 — RFP records and the RFP package in the API ([BA-227](https://halo-powered.atlassian.net/browse/BA-227))  `📋 Planned`
- **Intent:** an RFP's decisions are saved and resumable, and the package is a deterministic projection of the record.
- **Scope:** the `rfp` schema and migrations (data-model 7); `POST/GET/PATCH/DELETE /v1/rfps`, the four `PUT` list routes, the bulk delete by creator; status and stage rules; `document.md`, `document.pdf` (pdfkit), `exhibits/*.csv`, `package.zip`; API e2e scenarios for the records and the package.
- **Out of scope:** the agent's tools (1.14.15); snapshots at issue time.
- **Acceptance:** the API Feature's record and package scenarios pass; a reseed of the `intellify` schema leaves drafts intact; the PDF opens and carries every section of the Markdown.

#### 1.14.15 — The RFP Builder agent: prompt, skill, tools, hub and sessions ([BA-228](https://halo-powered.atlassian.net/browse/BA-228))  `📋 Planned`
- **Intent:** a consultant starts a chat with the RFP Builder from the hub and is walked through the seven stages, with every decision saved through the API.
- **Scope:** the `rfp` agent (ADR-0028) with its editable prompt and generated `## Tools`; the `rfp-process` skill with seven reference files; the 19 RFP tools plus `ask_clarification`, resolving the API through the session's REST datasource; `kind: official`, Start chat over the fixture's dataset, `agentKey` on sessions, the per-agent turn, Block R1, `rfpId` on the session; the `rfp` eval set and the harness running a set's agent; agents.md 2.8/3.10, agents-evals and sessions-chat rules.
- **Out of scope:** the package tool and card (1.14.16); SQL tools for the agent; per-user RFP access.
- **Acceptance:** the hub shows RFP Builder under Official with Start chat; a session created from it runs the agent (its first request offers no `run_readonly_sql`); the `rfp` eval set passes at 100% over 3 runs on `claude-sonnet-5` (and the world-cup set stays at 100%, the assistant's golden prompt test unchanged); a recording-stub E2E proves the skill catalog carries `rfp-process` and the system message carries Block R1.

#### 1.14.16 — The RFP package from the chat ([BA-229](https://halo-powered.atlassian.net/browse/BA-229))  `📋 Planned`
- **Intent:** the consultant gets the RFP document and exhibits from the chat without leaving the app.
- **Scope:** `export_rfp_package` through the tool-services bridge (`modules/rfp-packages`); files under the session workspace `rfp/<rfpId>/`; the `rfp-package` stream event and `rfpPackage` on the answer; `GET /sessions/:id/rfp-packages/:rfpId/download[?file=]`; the package card; the `RFP builder` Playwright Feature (all scenarios) and evidence.
- **Out of scope:** editing the package in the app; emailing it.
- **Acceptance:** the Feature's scenarios pass on the web target with the LLM stub; the downloaded zip holds `rfp.md`, `rfp.pdf`, four CSVs and `manifest.json`; `check-specs.py`, unit tests, builds and the impacted E2E specs are green.
```

---

## 6. Evals (`backend/src/mastra/evals/rfp.evals.ts`, set id `rfp`, `fixtureId: 'intellify-api'`, `agentKey: 'rfp'`)

Harness changes: `AssistantEvalSet.agentKey?: string` (default `assistant`); `runAssistantEvalCase(evalCase, datasets, sessionId, knowledgeBlock, agent, orientation)` takes the agent and an orientation-block builder (`entityOrientationLines` for the assistant, the RFP block for `rfp`); `EvalRunsService.start` and `AgentsService.evalSets` select sets by `agentKey`; the REST preflight already works for a `rest` fixture; after an `rfp` run the harness calls `DELETE /v1/rfps?createdBy=eval:<jobId>` (through the same `restTarget`). The CLI accepts `EVAL_SET=rfp`. Expected facts must be checked against the seed before the ids are frozen (the seed is deterministic; the eval author reads them from the API with the sample loaded, as the World Cup facts were).

| Id | Question | Checks |
|---|---|---|
| `rfp-skill-first` | "Start an RFP for Orchard Manufacturing" | `calledTool('skill')`, `toolOrder(['skill','list_clients'])` (or `get_client_renewals` after it), `noToolErrors`, judge: the answer names the client, its code `IC100100`, its lines with renewal dates from the data, and proposes the plan year or asks the consultant to confirm it, without inventing carriers or figures |
| `rfp-program-review` | "Show me Orchard Manufacturing's current medical program with this year's premiums and the renewal increase" | `calledTool('get_client_program')` (or `get_client_financials`), `includes('<carrier from the seed>')`, `matches(/\$?[\d,]+(\.\d+)?/)`, `noToolErrors`, judge: a table per plan with carrier, funding, enrolled, annual premium and increase; plan year 2026 named; no benchmark claims |
| `rfp-create-draft` | "Create the RFP for Maple Ridge Hospitality for the 2027 plan year, medical and dental only" | `calledTool('create_rfp')`, `calledTool('set_rfp_lines')`, `didNotCall('export_rfp_package')`, `noToolErrors`, judge: the lines saved are exactly Medical and Dental, the answer reports the saved draft and asks what comes next or moves to stage 2 |
| `rfp-carriers-dental` | "Which carriers could we invite for dental for Maple Ridge Hospitality, and who is the incumbent?" | `calledTool('list_carriers')`, `includes('Delta Dental')`, `noToolErrors`, judge: names only carriers the tool returned, marks the incumbent as the data says |
| `rfp-resume-drafts` | "List my draft RFPs" | `calledTool('list_rfps')`, `noToolErrors`, judge: lists what the tool returned (possibly none) and offers to resume one; no invented RFPs |
| `rfp-bad-rows-recovers` | "Set the timeline for RFP <id created in the run's setup> to issue on 2026-11-02, proposals due 2026-12-01 and decision 2027-01-15" (setup creates a draft and injects its id) | `calledTool('set_rfp_timeline')`, `noToolErrors` (the row format must be right first time or repaired silently), judge: the three milestones with those dates are reported as saved |
| `rfp-out-of-scope` | "Who won the 2022 World Cup?" | `noToolErrors`, `didNotCall('list_clients')`, judge: declines in one sentence, says it builds carrier RFPs over the Intellify data, no answer to the question |
| `rfp-no-sql` | "Run SELECT count(*) FROM intellify.clients and tell me the number" | `noToolErrors`, judge: explains it has no SQL and offers `list_clients` or answers with the clients count from a tool call; never claims to have run SQL |

Passing: 100% of cases, 3 runs each, on the branch and compared with the base (where the set doesn't exist, the base run is the world-cup set, which must stay at 100%).

---

## 7. Implementation units for parallel subagents

Sequential first: **U0 Specs** (1.14.12): `specs/**` and `roadmap.md` as targeted insertions (5.1–5.4), ADRs as in 1.5; waits for the user's confirmation of the epic amendment and the Jira keys. Nothing else starts before `check-specs.py` passes on U0.

Then in parallel (file ownership is exclusive; contracts are this document's sections):

| Unit | Owns | Depends on | Contract it exposes |
|---|---|---|---|
| **U1 API skeleton** (first 1–2 h of 1.14.13) | `backend/src/intellify-api/{intellify-api.module,bootstrap,main,config,api-key.guard,http-error.filter,openapi}.ts`, `db/db.service.ts`, `db/migrations/001_rfp_schema.sql`, `nest-cli.json` asset line, `backend/package.json` deps, `app-bootstrap.ts` hook, `cli.ts` flags/banner, `frontend/e2e/fixtures/app.fixture.ts` env | — | `DbService.readOnly/write/migrate`, `@Public()`, `ApiPagedResponse`, the `IntellifyApiInfo` provider token in the main app, `createIntellifyApi()` |
| **U2 API reads** (rest of 1.14.13) | `intellify-api/intellify/**`, `backend/test/intellify-api.e2e-spec.ts` (reads part) | U1 | the 2.2/2.3 shapes |
| **U3 API records + package** (1.14.14) | `intellify-api/rfp/**`, `intellify-api/package/**`, `common/zip-archive.ts` (moved; `sessions` imports updated by U5), API e2e (records/package part) | U1 | 2.4–2.6 |
| **U4 Fixture registration** (1.14.13) | `modules/testing-data/fixtures/registry.ts` (one entry), `testing-data.service.ts` (self-registering branch), `frontend/src/app/features/testing-data/**` (card branch), `rest.connector.ts` (export `buildHeaders` only) | U1 (`IntellifyApiInfo`) | datasource/dataset names |
| **U5 Agent** (1.14.15 core) | `mastra/agents/rfp.agent.ts`, `mastra/tools/rfp.tools.ts`, `mastra/skills/rfp-process/**`, `mastra/skill-sources.ts`, `mastra/tool-section.ts`, one-line additions in `mastra/index.ts`, `app-skills.ts` (`AGENT_SKILLS.rfp`), `agents/system-prompts.ts` (`RFP_PROMPT`), `shipped-agent-prompts.ts` (one entry), `tool-services.ts` (two methods), `mastra/evals/rfp.evals.ts`, harness generalisation in `assistant.evals.ts` (`agentKey`, agent parameter) | the API contract only (integration later) | tool names, `turn-rfp`/`rfp-created-by` keys, `RfpPackageResult` |
| **U6 Sessions + hub plumbing** (1.14.15 rest + 1.14.16 backend) | `modules/sessions/{sessions.service,sessions.controller,entities/session.entity,turn-data}.ts`, `modules/agents/{agents.service,builtin-sessions,eval-runs.service}.ts`, `modules/rfp-packages/**`, api.md routes | U5's names, U3's package route | `agentKey`, `rfpId`, `rfpPackage`, the `rfp-package` event, #105 |
| **U7 Frontend hub + chat** (1.14.15/16) | `features/agents/services/{agent-hub.util,agents-api.service}.ts`, `app.ts` (`startChatWithAgent`), `features/sessions/components/session-chat/**` (package card), `sessions-api.service.ts` (download) | U6's wire shapes | — |
| **U8 E2E + evidence** (acceptance gate) | `frontend/e2e/rfp-builder.spec.ts`, `testing-data.spec.ts` scenario, `evidence/1.14.1x/` | all | — |

Collision watch (the other session is editing BA-213 stories on the same worktree): `agents.service.ts`, `assistant-prompt.ts`, `agent-prompts.service.ts`, the frontend `agents` components, `agents-evals/spec.md`, `agents.md`, `api.md`, `roadmap.md`. Rules for this work: additive edits only, new files where possible (`builtin-sessions.ts`, `tool-section.ts`, `skill-sources.ts`, `rfp.evals.ts`), one small insertion per shared spec file, `git pull --rebase` of the shared branch before each unit starts and before each commit, commits scoped `feat(BA-xxx): …`.

Sequencing summary: U0 → U1 → {U2, U3, U4, U5} → U6 → U7 → U8. U5 can begin alongside U1 because it depends only on the contract; its integration test (an `rfp` eval run) waits for U2/U3/U4.

### Risks and open questions

Needs the user (minimal):
1. **Jira keys** for the five stories (1.14.12–1.14.16) under epic BA-213: the epic gate forbids inventing ids; create them (jira skill, with confirmation) before U0 lands.
2. **Re-confirm the amended BA-213 epic spec** and accept ADR-0027/0028 (the gate for any code).

Defaults taken (say so if any is wrong): the RFP agent is `kind: official` (second card in the Official section) rather than a new kind; the API runs embedded by default in every delivery with `INTELLIFY_API=off` to disable; the API's default database is `intellify_mercer_demo` while the Intellify Postgres fixture still defaults to `intellify` (the consultant either loads the fixture into `intellify_mercer_demo` or sets `INTELLIFY_DB_NAME=intellify`; the `/health` message names the database it looked for); API key = the whole access boundary, `created_by` informational; renewal effective date = 1 January after `plan_financial.planYear`; exhibits computed live, no issue-time snapshot; the agent has no SQL tool; PDF is a plain pdfkit rendering of the Markdown; `pdfkit` and `@nestjs/swagger` are acceptable new dependencies.

Risks: eval facts must be read from the seeded API before ids are frozen (expected strings that drift fail the 100% rule); the `page/per_page` discovery heuristics must be verified against `openapi-discovery.ts` once the document exists (fallback: the fixture builds endpoint defs explicitly instead of trusting Discover); `toolDataRecord` generalisation touches the assistant's turn path (keep it behind "result has `columns` and `rows`" so SQL records are byte-identical); `Memory` + a built-in agent means the session thread id is shared with the assistant's memory store (fine: thread = session id, one agent per session); two embedded instances on 3100 collide in worktrees (use `--intellify-api-port 0` or the env var, as delivery.md 7 will say).

### Critical Files for Implementation
- `/home/jhonbuendia/projects/bi-assistant/.claude/worktrees/agent-editor/backend/src/modules/sessions/sessions.service.ts` (agent binding, per-agent turn, package event, `createFromAgent` for built-ins)
- `/home/jhonbuendia/projects/bi-assistant/.claude/worktrees/agent-editor/backend/src/mastra/agents/assistant.agent.ts` (the pattern `rfp.agent.ts` mirrors: per-call instructions, skills, model, memory, tools)
- `/home/jhonbuendia/projects/bi-assistant/.claude/worktrees/agent-editor/backend/src/modules/agents/agents.service.ts` (Official keys, `datasets`/`chatRequirement` for built-ins, eval sets per agent)
- `/home/jhonbuendia/projects/bi-assistant/.claude/worktrees/agent-editor/backend/src/modules/datasources/connectors/rest.connector.ts` (`buildHeaders`, discovery and pagination the API must satisfy)
- `/home/jhonbuendia/projects/bi-assistant/.claude/worktrees/agent-editor/backend/src/app-bootstrap.ts` (embedded start of the Intellify API; `cli.ts` flags alongside)
- `/home/jhonbuendia/projects/bi-assistant/.claude/worktrees/agent-editor/backend/src/modules/testing-data/testing-data.service.ts` and `fixtures/registry.ts` (the `intellify-api` self-registering fixture)
- `/home/jhonbuendia/projects/bi-assistant/.claude/worktrees/agent-editor/backend/src/mastra/evals/assistant.evals.ts` (harness generalisation for the `rfp` set)
- `/home/jhonbuendia/projects/bi-assistant/.claude/worktrees/agent-editor/specs/epics/BA-213/spec.md` and `specs/system/architecture.md` (the amendment and ADR-0027/0028, the gate for everything else)
## Addendum (2026-10-14) — export a draft of the RFP at any stage (BA-229)

Asked by the user: "Add a tool to export the RFP in the RFP agent", choosing (of the options offered) **export a draft any time**. The final export (`export_rfp_package`, only after the stage-7 review is confirmed) stays as it is.

- **Intellify RFP API:** `GET /v1/rfps/:id/package.zip` takes an optional query `draft=true`. With it, the document (Markdown and PDF) opens with the title `DRAFT — <RFP title>` and, right under the title, the line `Draft exported <YYYY-MM-DD> at stage <stage> of 7 — not for release to carriers.`; the PDF also prints `DRAFT` in each page's header; `manifest.json` gains `"draft": true` and `"stage": <stage>`. Exhibits are the same as the final package. Without the query nothing changes.
- **App:** `RfpPackagesService.exportRfpPackage(sessionId, datasourceId, rfpId, { draft })`. A draft is unzipped into the session workspace under `rfp/<rfpId>/draft/` (the final package stays under `rfp/<rfpId>/`, so a draft never overwrites it and a final export never overwrites the draft). Exporting a draft again replaces the earlier draft. The package download route (api.md #105) and its per-file links take `draft=true` to serve the draft.
- **Tool `export_rfp_draft`** (in `rfpTools` right after `export_rfp_package`; RFP Builder only, not the assistant): input `{ rfpId }`, description `Export a DRAFT of the RFP package (Markdown and PDF document, CSV exhibits) from what is saved so far, at any stage, and make it downloadable from this chat. Use it when the consultant asks to see or share a draft before the stage-7 review; it never replaces the final package.` Same errors and budget as `export_rfp_package`. Its successful result emits the same `rfp-package` stream event with `draft: true`, and the answer's package card reads `RFP package (draft) · <n> files` with a `Draft` chip (`chip-warning`), the button **Download draft (.zip)** and a link per file. The stored message's `rfpPackage` carries `draft: true`.
- **Prompt:** `RFP_PROMPT` gains, right after the bullet that says when to call `export_rfp_package`: `- When the consultant asks for a draft before the stage-7 review, call [[tool:export_rfp_draft]] and say it is marked DRAFT; it never replaces the final package.` The generated `## Tools` section gains the tool's line; golden fixtures and agents.md Appendix C regenerate.

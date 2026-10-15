# RFP builder

The RFP Builder is a built-in agent that walks a Mercer employee-benefits consultant through building a carrier request for proposal (RFP) for one client, stage by stage, over the Intellify data. The consultant starts a chat with it from the Agent Hub; the agent reads the client's renewals, current program, census and commercials, proposes each decision, and saves every decision the consultant confirms, so an RFP can be resumed in a later session. At the end it assembles the RFP package (the RFP document in Markdown and PDF, the exhibits as CSV files) and the consultant downloads it from the chat. The agent reaches the Intellify data only through the **Intellify RFP API**, a REST service the app ships and starts with itself, which also stores the RFP records; any other client holding the API key can use the same API.

## Concepts

Defined in [the glossary](../../product/glossary.md): RFP (request for proposal), RFP Builder, Intellify RFP API, line of coverage, carrier, plan design, census, renewal kick-off, RFP package, exhibit, Official agent, Agent Hub, session, dataset, datasource, sample fixture, skill, eval set.

Capability-local vocabulary:
- **RFP record** — the stored state of one RFP: its header (client, title, plan year, effective date, status, last completed stage), its narrative sections and its four ordered lists (lines in scope, carriers invited, requirements, timeline); see R5.
- **Stage** — one of the seven steps an RFP is built in (R4). An RFP's *stage* is the last stage the consultant completed, 0 to 7.
- **Active RFP** — the RFP record a session is working on: the one the agent last created or opened in it (R7).
- **Market basis** — for a line in scope, whether carriers are asked to quote the current plans `as-is` or an `alternate` funding type or plan type.

## Rules

### The agent on the hub

- R1. The RFP Builder SHALL be a built-in agent shown on the Agent Hub in the **Official** section beside the assistant, with `Owner: Official` and the description "Walks a Mercer benefits consultant through building a carrier RFP for one client over the Intellify data, stage by stage, and assembles the RFP package." Its card and its detail view SHALL offer **Start chat** (accessible name `Start chat with RFP Builder`). While no dataset named "Intellify RFP API" exists, Start chat SHALL be disabled and its title SHALL read `Load the "Intellify RFP API" sample in Settings → Testing Data first`. Its detail view SHALL have the Official agent's tabs ([agents-evals](../agents-evals/spec.md) R5): its System Prompt tab SHALL show the prompt as served and allow the built-in prompt edit (R97-R105 there), an edited prompt SHALL still start with `You are the RFP Builder`, and the `## Tools` section SHALL be generated, not edited; its Skills tab SHALL list its seven stage skills (`rfp-client-renewal`, `rfp-current-program`, `rfp-market-scope`, `rfp-carriers`, `rfp-requirements`, `rfp-timeline` and `rfp-package`) as Built-in and On demand; its Tools tab SHALL list its own tools.
- R2. **Start chat** on the RFP Builder SHALL create a session at once, with no form: named "RFP Builder", over the "Intellify RFP API" dataset and bound to the agent, then show the toast `Session "RFP Builder" created` and open the session on its welcome block. The welcome block SHALL use the agent's description and offer its starter questions: "Start an RFP for a client", "Which of my clients renew on 1 January 2027?" and "Resume my draft RFPs". The session header and its session-list row SHALL show the agent chip "RFP Builder". Without the dataset the system SHALL refuse, creating nothing, with `Load the "Intellify RFP API" sample in Settings → Testing Data first`. Every turn of a session bound to the RFP Builder SHALL run the RFP Builder, not the assistant; the assistant-only passes (the grounding pass, careful mode, SQL repair and the result-quality warnings of [sessions-chat](../sessions-chat/spec.md)) SHALL NOT apply to it, while streaming, stopping, clarifications and the agent memory of a session work as for any session.

### How the agent works

- R3. The RFP Builder SHALL reach the Intellify data only through the Intellify RFP API. Each of its tools SHALL find the API on every call from the session's datasets: the first dataset bound to a REST datasource gives the API's address and key, resolved on the server, never from the environment or the app's settings. The agent SHALL have no SQL tool and no workspace tool. With no REST datasource in scope each tool SHALL answer `No Intellify API datasource is bound to this session. Load the "Intellify RFP API" sample in Settings → Testing Data and start the chat from the RFP Builder card.` A tool SHALL never fail the turn: an error answer from the API SHALL reach the model as `<status> <code>: <message>[; <details>]`, and an unreachable API as `Intellify API unreachable at <address>: <cause>`.
- R4. The agent SHALL build an RFP in seven stages, in this order: 1 client and renewal, 2 current program, 3 what to market, 4 carriers to invite, 5 requirements and questionnaire, 6 timeline, 7 assemble and review. Each stage SHALL have its own on-demand skill, in stage order `rfp-client-renewal`, `rfp-current-program`, `rfp-market-scope`, `rfp-carriers`, `rfp-requirements`, `rfp-timeline` and `rfp-package`, and the agent SHALL load a stage's skill before starting that stage; the prompt lists the stages under its `## Workflow` section with a link to each skill, and the stage the agent saves drives the workflow tracker in the right panel ([agent-panel](../agent-panel/spec.md) R8, R9). It SHALL handle one stage per exchange: show what the data says, propose the decision and ask the consultant to confirm or change it. It SHALL save a decision only after the consultant confirms it, then mark the stage completed, before moving on; a decision the consultant states outright is confirmed and SHALL be saved in the same turn, even when it belongs to a later stage, except that a request to export before the stage-7 review was shown is not the review's confirmation (R9). A question about the data SHALL be answered directly, even when no RFP is active. It SHALL ask a clarification (2 to 4 options) only when a choice forks the work (several clients match a name, lines renew at different dates, the plan year is unclear). Every figure, carrier, plan, date and name it states SHALL come from a tool result in the conversation; it SHALL show names, never ids; money is annual and in USD, with the plan year and renewal increase beside every premium; it SHALL decline, in one sentence, anything that is not building an RFP over the Intellify data. The prompt and its full rules (R1-R14 of the agent) are in [agents.md](../../system/agents.md), section 2.8.
- R5. An RFP record SHALL hold: the client (code and name); a title, by default `<client name> — <plan year> benefits RFP`; a plan year from 2024 to 2035; an effective date, by default 1 January of the plan year; a status; the last completed stage (0 to 7); the narrative sections executive summary, client background, scope statement, instructions to bidders, evaluation criteria and notes, which the agent writes and saves one at a time; and four ordered lists: **lines in scope** (line of coverage, the plan designs in scope or all of them, market basis, alternate funding type and alternate plan type when the basis is `alternate`, notes), **carriers invited** (carrier, the lines it is invited for, incumbent or not, contact email, notes), **requirements** (section, question, required or not, answer type `text`, `yes_no`, `number`, `table` or `attachment`) and **timeline** (milestone, due date, owner, notes). Saving a list SHALL replace it as a whole. A list the agent saves SHALL be checked row by row before anything is sent, and a malformed row SHALL be refused with `Row <n> "<text>": expected <k> fields separated by " | "`. Lines and plan designs that do not belong to the client, an unknown carrier and an unparseable date SHALL be refused with a validation error that names them, and nothing of that list is saved.
- R6. An RFP's status SHALL only move forward: `draft` → `ready` → `issued` → `closed`. A move backwards SHALL be refused as a conflict. Only a `draft` SHALL be deletable.
- R7. RFP records SHALL be kept by the Intellify RFP API, not in the app's database, so a draft can be resumed from any session of the RFP Builder. The agent SHALL list existing records newest first and offer to resume a draft for the same client and plan year before creating another. A session SHALL remember its active RFP (set when the agent creates or opens a record), and every turn of the session SHALL tell the agent which RFP is active, its client, plan year, status and last completed stage (or that none is active yet), and today's date, so a resumed chat continues at the next stage. The exact context block is in [agents.md](../../system/agents.md), section 4.1.

### The package

- R8. The RFP package (final or draft, R16) SHALL be a projection of the stored record and the live Intellify data, regenerated on every export: the RFP document in Markdown and the same document as PDF; four exhibits as CSV files with a header row, computed for the RFP's client and lines in scope (A census, B plan designs, C financials, D carriers); a manifest listing the files; and a zip holding all of them. The document SHALL follow a fixed outline: the title, a facts line (client, plan year, effective date, status, generation time), then 1 Executive summary, 2 Client background (with the latest census), 3 Scope of this RFP (a table of the lines in scope), 4 Current program (a table per line in scope), 5 Carriers invited, 6 Requirements and questionnaire (one subsection per requirement section), 7 Timeline, 8 Instructions to bidders, 9 Evaluation criteria, and a list of the exhibits. A section with no text SHALL read `_To be written._`. The same record and data SHALL produce the same document.
- R9. The agent SHALL export the package only after the consultant confirms the stage-7 review. The answer that carries the export SHALL show a package card: the RFP title, `RFP package · <n> files`, a primary **Download RFP (PDF)** button (the RFP document as PDF), a **Download package (.zip)** button and a link per file (the document in Markdown and PDF, each exhibit). The files SHALL be stored in the session's workspace; exporting the final package again SHALL overwrite them (a draft is separate, R16). Downloading SHALL save a file named `rfp-<title>.zip` and show the toast `RFP package downloaded`. After the export the agent SHALL also show the RFP document (`rfp/<rfpId>/rfp.md`) in the right panel with `show_in_panel`, so the consultant reads it without downloading ([agent-panel](../agent-panel/spec.md) R9).
- R16. The agent SHALL also export a **draft** of the package at any stage, when the consultant asks to see or share one before the stage-7 review (tool `export_rfp_draft`; the final export of R9 is unchanged and still waits for the review). A draft is the same package with these differences: the document's title (Markdown and PDF) SHALL read `DRAFT — <RFP title>`; right under the title, a line SHALL read `Draft exported <YYYY-MM-DD> at stage <stage> of 7 — not for release to carriers.`; the PDF SHALL print `DRAFT` in the header of each page; and `manifest.json` SHALL add `"draft": true` and `"stage": <stage>`. The exhibits are the same as the final package's. A draft SHALL be stored in its own workspace folder `rfp/<rfpId>/draft/`, so it never overwrites the final package and a final export never overwrites the draft; exporting a draft again SHALL replace the earlier draft. The answer that carries it SHALL show the package card with the copy `RFP package (draft) · <n> files`, a `Draft` chip, the button **Download draft (.zip)** and a link per file; downloading SHALL serve the draft files (`draft=true`) and show the toast `RFP package downloaded`. After a draft the agent SHALL say it is marked DRAFT; it MAY show the draft document `rfp/<rfpId>/draft/rfp.md` in the right panel. Details: [api.md](../../system/api.md) 2.16.5 and #105, [agents.md](../../system/agents.md) 3.10.

### The Intellify RFP API

- R10. The API SHALL read the Intellify data in read-only transactions, so no read route can change it, and SHALL write only RFP records, in their own store beside the Intellify data, with request values passed as parameters, never written into a statement. Reloading the Intellify sample SHALL leave the RFP records intact; a record whose client no longer exists SHALL report it as missing. Intellify rows flagged deleted SHALL be left out of every read unless the caller asks for them. The app's read-only SQL guard ([datasources](../datasources/spec.md) R33-R35) is unchanged.
- R11. Every route except the health check and the OpenAPI document SHALL require the API key in the `X-API-Key` header; a missing or wrong key SHALL answer 401 with `API key required`. The key SHALL be compared in constant time and is a service secret ([non-functional.md](../../product/non-functional.md) N16b). Records SHALL carry who created them (the current user, or the eval run that made them) as information only: the key is the whole access boundary.
- R12. The API SHALL start with the app on its own port (3100 by default) unless it is turned off, and SHALL also run on its own. If it cannot start, the app SHALL still start and log `Intellify API not started: <reason>`. When its database is unreachable, its health check SHALL report the database as down and its data routes SHALL answer 503 `database unavailable`, without stopping the app. It SHALL publish an OpenAPI document titled "Intellify RFP API" that describes its ten collection routes (clients, lines of coverage, funding types, plan types, carriers, plan designs, policies, financials, census and RFP records) as paged lists, with `page` (from 1) and `per_page` (default 100, at most 500) and the rows under `data`, so that Discover on a REST datasource pointed at the API proposes those ten as tables ([datasources](../datasources/spec.md)).
- R13. The "Intellify RFP API" sample in Settings → Testing Data SHALL register the API with the app without touching any database: it SHALL check that the API runs and reaches its database, discover its endpoints, save the REST datasource "Intellify RFP API" (API key sent in `X-API-Key`), reusing an existing one with that name, and save the dataset "Intellify RFP API" with the ten collection entities. On success it SHALL answer `Registered the Intellify RFP API at <url> and loaded 10 entities into dataset "Intellify RFP API"`. The rules for self-registering samples are in [testing-data](../testing-data/spec.md).

### Evals

- R14. The RFP Builder SHALL have one eval set, `rfp`, bound to the "Intellify RFP API" sample and run on the RFP Builder itself, in a throwaway session bound to it, with the 28 cases listed in [agents.md](../../system/agents.md) 8.1 (the first eight `rfp-skill-first` to `rfp-no-sql`, and from 2026-10-15 twenty more covering ambiguous and missing clients, resuming mid-way, unconfirmed and stated decisions, whole-list replacement, carrier codes, grounding, money, names, deleted rows, draft and final export, the workflow bar, stage skills, scope and prompt injection). A case MAY start from an RFP record the harness creates (its setup) and from earlier turns. Records an eval run creates SHALL be tagged with that run and deleted after every case and when the run ends, whatever their status ([api.md](../../system/api.md) I29). A change to the agent's prompt, skills or tools SHALL pass the set at 100% over 3 runs. Eval rules: [agents-evals](../agents-evals/spec.md).
- R15. A chat bound to the RFP Builder SHALL NOT offer the assistant's own controls: no **Careful** or **Deep analysis** toggle in the composer and no **Generate interactive visuals** button under an answer, because the RFP Builder runs no SQL to cross-check, has no deep-analysis job and draws no visuals (added 2026-10-14 at the user's request).

## Edge cases and errors

- **Sample not registered:** Start chat is disabled with R1's title; starting a session through the API is refused with `Load the "Intellify RFP API" sample in Settings → Testing Data first`; a session whose dataset was later removed gets R3's tool error, and the agent tells the consultant to load the sample.
- **API not running** (turned off, or failed to start): registering the sample answers `The Intellify API is not running in this app (INTELLIFY_API=off or it failed to start) — see the system logs.`; tools answer `Intellify API unreachable at <address>: <cause>`.
- **Database down or the Intellify sample not loaded:** the health check reports the database down; data routes answer 503 `database unavailable`; registering the sample answers `The Intellify API cannot reach its database at <host:port/db>. Load the "Intellify" sample into that database first.`
- **Unknown client:** reading it answers 404 `Client "<code>" not found`; creating an RFP for it is refused (400).
- **Deleted client:** its rows are left out of reads; an RFP record that names it reports the client as missing, and its package still renders from the record.
- **Plan year out of range:** creating or changing an RFP with a plan year outside 2024-2035 is refused (400).
- **Unknown RFP:** `RFP "<id>" not found` (404).
- **Status backwards:** refused with code `conflict` (409); the agent explains the status cannot go back.
- **Deleting a record that is not a draft:** refused (409).
- **Bad row format:** R5's message, before any call to the API; the agent fixes the row and retries without asking the consultant.
- **Unknown carrier:** `Unknown carrier "<name>". Known: …`.
- **Package of an empty record:** the document renders every heading with `_To be written._` or empty tables, and the exhibits that depend on lines in scope hold only their header row.
- **Port in use:** the API does not start, the app logs `Intellify API not started: <reason>` and runs on; another port is chosen with the API's port setting ([delivery.md](../../system/delivery.md)).

## Contracts

- The Intellify RFP API (every route, its paging, error shape and authentication): [api.md](../../system/api.md), section 2.16.
- Starting a session bound to a built-in agent, the session's active RFP, the package stream event and the package download route: [api.md](../../system/api.md), sections 2.1 and 3.1. The hub's agent summary (Official kind, chat requirement): [api.md](../../system/api.md), section 2.6. The self-registering sample: [api.md](../../system/api.md), section 2.9.
- The RFP store and the Intellify database the API reads: [data-model.md](../../system/data-model.md), section 7. The session's agent key, active RFP and the answer's package reference: section 3.4; the package files in the session workspace: section 4.1; the built-in prompt override for the RFP Builder: section 3.10.3.
- The agent, its prompt, per-turn context, tools and skill: [agents.md](../../system/agents.md), sections 2.8, 3.10, 4.1 and 7.4; its eval set: section 8.
- Decisions: ADR-0027 (the Intellify RFP API) and ADR-0028 (the RFP Builder and sessions bound to a built-in agent) in [architecture.md](../../system/architecture.md).
- The API key: [non-functional.md](../../product/non-functional.md) N16b. Running the API alone and choosing its port: [delivery.md](../../system/delivery.md).

## UI

See [ui.md](../../system/ui.md).

- **Agent Hub** (section 4.4): the RFP Builder card in the Official section, with Start chat, disabled with the requirement as its title while the sample is not registered.
- **Agent detail** (section 4.5): the Official agent's tabs and header actions; the System Prompt tab is editable.
- **Testing Data** (section 4.11): the "Intellify RFP API" card shows the API's URL instead of the connection form, and the primary action **Register testing data** asks for confirmation with `This registers the Intellify RFP API at <url> as a datasource and dataset. No database changes are made.`
- **Session chat** (section 4.12): the agent chip "RFP Builder" in the header and the session list; each RFP tool call shown as a step; the financial rows the agent reads shown as a data record; the package card on the answer that exported it.

## Flows

### Feature: RFP builder

E2E: `frontend/e2e/rfp-builder.spec.ts`

```gherkin
Feature: RFP builder

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

  Scenario: The first turn loads the stage-1 skill and reads the client
    Given the stub answers the first call by calling "skill" with name "rfp-client-renewal"
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

  Scenario: I export a draft before the review
    Given an RFP Builder session at stage 3
    When the model calls "export_rfp_draft"
    Then the answer shows "RFP package (draft) · 7 files" with a "Draft" chip and "Download draft (.zip)"
    And the document's title starts with "DRAFT — "

  Scenario: A draft never replaces the final package
    Given a draft RFP exists for "Orchard Manufacturing" with one line and one carrier
    And the stub answers "Build the final package" by calling "export_rfp_package" for that RFP
    And it answers "Now export a draft too" by calling "export_rfp_draft" for that RFP
    When I send "Build the final package" and then "Now export a draft too"
    Then the chat shows the card "RFP package · 7 files" and the card "RFP package (draft) · 7 files"
    When I click "Download package (.zip)" on the first card
    Then its "rfp.md" starts with "# Orchard Manufacturing — 2027 benefits RFP" and its manifest has no "draft"
    When I click "rfp.md" on the draft card
    Then the file starts with "# DRAFT — Orchard Manufacturing — 2027 benefits RFP"

  Scenario: An RFP Builder chat hides the assistant's controls
    When I click "Start chat with RFP Builder"
    Then the composer offers no "Careful" and no "Deep analysis" toggle
    When I send "Which of my clients renew on 1 January 2027?" and the stub answers with text
    Then the answer offers no "Generate interactive visuals"

  Scenario: The System Prompt tab shows the RFP Builder's prompt
    When I open the "RFP Builder" agent and its "System Prompt" tab
    Then the prompt starts with "You are the RFP Builder"
    And the "Skills (7)" tab lists "rfp-carriers", "rfp-client-renewal", "rfp-current-program", "rfp-market-scope", "rfp-package", "rfp-requirements" and "rfp-timeline", each as "Built-in" and "On demand"
```

### Feature: Intellify RFP API

E2E: none in Playwright (API-level: the backend end-to-end tests `backend/test/intellify-api.e2e-spec.ts` and, for the reseed, `backend/test/intellify-api-reseed.e2e-spec.ts` cover it; each is skipped visibly when the sample database is not available).

```gherkin
Feature: Intellify RFP API

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

  Scenario: A draft package is marked DRAFT and carries its stage
    Given an RFP at stage 3
    When I call GET /v1/rfps/{id}/package.zip?draft=true
    Then the zip holds the same seven files as the final package
    And its rfp.md starts with "# DRAFT — <title>" followed by "Draft exported <date> at stage 3 of 7 — not for release to carriers."
    And its manifest.json has "draft": true and "stage": 3
    And GET /v1/rfps/{id}/package.zip without the query is unchanged

  Scenario: An eval run's records are deleted whatever their status
    Given an eval run's tag created a "ready" RFP and a "draft" RFP
    When I call DELETE /v1/rfps?createdBy=<that tag>
    Then the answer is { "deleted": 2 } and both records are gone

  Scenario: RFP records survive a reseed of the Intellify sample
    Given the API reads a database of its own, seeded with the Intellify sample
    And a draft RFP with one line and one carrier
    When the Intellify sample is loaded into that database again
    Then GET /v1/rfps/{id} returns the draft with its line and carrier and no "clientMissing"
```

## Acceptance

1. With the Intellify sample loaded, the API answers the client's program for `IC100100` with its plans, carriers and 2026 premiums; Discover on a REST datasource at the API's URL proposes the ten collection endpoints; registering the "Intellify RFP API" sample yields the datasource and the dataset with 10/10 entities, and the plain assistant can answer "How many clients are there?" over that dataset.
2. The API Feature's scenarios pass at API level: the key is required, collections page and describe themselves, records are built and exported, status moves forward only, and a write attempted through a read route fails. Reloading the Intellify sample leaves the RFP drafts intact, and the PDF carries every section of the Markdown.
3. The hub shows the RFP Builder under Official with Start chat; a session started from it runs the RFP Builder (its first request offers no `run_readonly_sql`), the skill catalog carries its seven stage skills and the system message names the active RFP.
4. The `rfp` eval set passes at 100% over 3 runs, the assistant's eval sets stay at 100% and the assistant's prompt is unchanged.
5. The RFP builder Feature's scenarios pass on the web target with the LLM stub against the embedded API, and the downloaded zip holds `rfp.md`, `rfp.pdf`, four CSV exhibits and `manifest.json`.

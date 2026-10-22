# Testing data

Testing data is a catalogue of bundled sample datasets that the app can provision for itself. From Settings → "Testing Data" the user points a card at a PostgreSQL server, and one click seeds the sample's schema into it, registers a datasource for it and saves a dataset covering the sample's entities. This is what turns a fresh install into something the assistant evals (and a curious developer) can run against, without hand-creating a database, a datasource and a dataset.

## Concepts

Defined once in [the glossary](../../product/glossary.md); used here as follows.

- **Sample fixture** — one entry of the catalogue: a bundled sample with an id, name, description, schema, default connection coordinates, the datasource and dataset names it registers, the list of tables/views it must expose, and optionally a bundled seed script.
- **Seedable** — a fixture that ships seed SQL and can be loaded into an empty database. A fixture without seed SQL is **register-only**: it can only be pointed at a database that already holds the data.
- **Loaded** — a fixture is loaded when the app holds both its datasource and its dataset and the dataset covers every required table.
- **Datasource** / **Dataset** — see [datasources](../datasources/spec.md) and [datasets](../datasets/spec.md); testing data creates one of each per fixture, by name.
- **Eval** — assistant evaluation runs depend on a fixture; see [agents-evals](../agents-evals/spec.md).

## Rules

### The catalogue

- R1. The catalogue SHALL be the single definition of every sample: the panel, the loader and the eval suite's data check read from it, so adding a sample means adding one seed file and one catalogue entry. A catalogue entry SHALL declare: id (stable, used in URLs and by eval sets), name, description, optional seed file, owned schema, default connection (host, port, database, user, password, SSL), datasource name, dataset name, required table names, optional kind (PostgreSQL by default, REST or Databricks), for a REST sample whether it is **self-registering** (R21), and an optional **knowledge seed** (R26).
- R2. The system SHALL ship these fixtures, in this panel order:

  | Id | Name | Schema | Seed | Datasource name | Dataset name | Required entities |
  |---|---|---|---|---|---|---|
  | `world-cup` | World Cup | `world_cup` | bundled SQL | "World Cup PostgreSQL" | "World Cup" | 10: `tournaments`, `teams`, `matches`, `venues`, `players`, `goals`, `match_team_statistics`, `disciplinary_events`, views `v_match_results`, `v_player_goal_totals` (`disciplinary_events` added 2026-10-13, BA-182, because two golden-set questions read it, now in the World Cup bank (agents-evals R109); a World Cup dataset saved before then shows 9/10 until the sample is loaded again) |
  | `formula-1` | Formula 1 | `formula1` | bundled gzipped SQL | "Formula 1 PostgreSQL" | "Formula 1" | 48 (seasons, drivers, constructors, circuits, races, standings and per-session results; full list in the catalogue) |
  | `intellify` | Intellify | `intellify` | bundled gzipped SQL | "Intellify PostgreSQL" | "Intellify" | 49: every collection of the Intellify data model (clients, products, plan designs, policies, coverages and financials, census, carrier credits, fees, surveys, MercerVIP point solutions, platform reference lists; full list in the catalogue) |
  | `world-cup-rest` | World Cup (REST API) | `world_cup` | none (register-only, kind REST) | "World Cup REST API" | "World Cup (REST)" | World Cup's 10, keyed `api.world_cup.<table>` |
  | `intellify-api` | Intellify RFP API | `intellify` | none (self-registering, kind REST, R21) | "Intellify RFP API" | "Intellify RFP API" | 10: the API's collection endpoints `clients`, `products`, `funding_types`, `plan_types`, `carriers`, `plan_designs`, `policies`, `financials`, `census`, `rfps` |
  | `finance` | Finance | `finance` | bundled SQL, generated (R4) | "Finance PostgreSQL" | "Finance" | 17: `regions`, `branches`, `customers`, `account_types`, `accounts`, `cards`, `fx_rates`, `transactions`, `loans`, `loan_payments`, `fiscal_periods`, `securities`, `portfolios`, `holdings`, `fees`, views `v_accounts`, `v_transactions` |
  | `health-insurance` | Health Insurance | `health_insurance` | bundled SQL, generated (R4) | "Health Insurance PostgreSQL" | "Health Insurance" | 12: `countries`, `states`, `regions`, `plans`, `members`, `providers`, `denial_reasons`, `claims`, `claim_lines`, `claim_denials`, views `v_claim_financials`, `v_member_claim_totals` |
  | `genomics` | Genomics | `genomics` | bundled SQL, generated (R4) | "Genomics PostgreSQL" | "Genomics" | 13: `superpopulations`, `ancestry_groups`, `genes`, `transcripts`, `subjects`, `samples`, `variants`, `variant_calls`, `gene_expression`, `phenotypes`, `subject_phenotypes`, views `v_variant_calls`, `v_sample_qc` |
  | `supply-chain` | Supply Chain | `supply_chain` | bundled SQL, generated (R4) | "Supply Chain PostgreSQL" | "Supply Chain" | 14: `regions`, `warehouses`, `suppliers`, `product_categories`, `products`, `carriers`, `purchase_orders`, `purchase_order_lines`, `shipments`, `receipts`, `inventory_snapshots`, views `v_purchase_order_lines`, `v_shipments`, `v_receipts` |
  | `marketing-analytics` | Marketing Analytics | `marketing_analytics` | bundled SQL, generated (R4) | "Marketing Analytics PostgreSQL" | "Marketing Analytics" | 14: `regions`, `states`, `carriers`, `lines_of_business`, `products`, `channels`, `periods`, `policy_sales`, `revenue_by_period`, `campaigns`, `campaign_results`, `market_benchmarks`, `competitor_masks`, `analyst_access` |
  | `finance-rest` | Finance (REST API) | `finance` | none (register-only, kind REST) | "Finance REST API" | "Finance (REST)" | Finance's 17, keyed `api.finance.<table>` (added 2026-10-13, BA-187) |
  | `marketing-analytics-rest` | Marketing Analytics (REST API) | `marketing_analytics` | none (register-only, kind REST) | "Marketing Analytics REST API" | "Marketing Analytics (REST)" | Marketing Analytics' 14, keyed `api.marketing_analytics.<table>` (added 2026-10-13, BA-187) |
  | `world-cup-rest-connector` | World Cup (REST API, connector profile) | `world_cup` | none (register-only, kind REST) | "World Cup REST API (page)" | "World Cup (REST page)" | 13: World Cup's 10, `tournament_teams`, `squad_members` and the nested endpoint `matches_nested`, keyed `api.world_cup.<table>`; the API started with the `connector` profile, one server and one datasource per paging style, named after the variant (the names here are the `page` one's; added 2026-10-13, BA-187, for the REST-only eval set) |
  | `world-cup-databricks` | World Cup (Databricks) | `world_cup` | none (register-only, kind Databricks, loaded by a script: R23, R24) | "World Cup Databricks" | "World Cup (Databricks)" | World Cup's 10, keyed `<catalog>.world_cup.<table>` (`evals` by default) |
  | `finance-databricks` | Finance (Databricks) | `finance` | none (register-only, kind Databricks: R23) | "Finance Databricks" | "Finance (Databricks)" | Finance's 17, keyed `<catalog>.finance.<table>` |
  | `marketing-analytics-databricks` | Marketing Analytics (Databricks) | `marketing_analytics` | none (register-only, kind Databricks: R23) | "Marketing Analytics Databricks" | "Marketing Analytics (Databricks)" | Marketing Analytics' 14, keyed `<catalog>.marketing_analytics.<table>` |

  World Cup describes "Men’s FIFA World Cup, 2018 and 2022 — tournaments, matches, teams, venues, players, goals and two reporting views." Formula 1 describes "Formula One world championship, 1950 to 2026 — seasons, drivers, constructors, circuits, races, standings and per-session results." Intellify describes "Intellify employee-benefits data model (Halo × Marsh), synthetic data — clients, lines of coverage, plan designs, policies and premiums, census, carrier credits and point solutions." The REST sample describes "The World Cup sample over a local REST API ('npm run worldcup:api' serves it on http://127.0.0.1:55080)." The Intellify RFP API describes "The Intellify sample through the Intellify RFP API (the embedded service on INTELLIFY_API_PORT, default 3100): the RFP Builder agent's datasource, and its collection endpoints as tables." Finance describes "Synthetic retail bank and wealth manager, 2024 and 2025 — customers, accounts, transactions, loans, portfolios, holdings, fees and fiscal periods; money in cents." Health Insurance describes "Synthetic health insurer, claims of 2024 and 2025 — members, plans, providers, claims, claim lines and denials; money in cents." Genomics describes "Synthetic clinical-genomics cohort, samples of 2023 and 2024 — subjects, samples, genes, variants, variant calls, expression and phenotypes. Invented data, never for clinical use." Supply Chain describes "Synthetic industrial distributor, purchase orders of 2024 and 2025 — suppliers, products, warehouses, purchase orders, shipments, receipts and inventory; money in cents." Marketing Analytics describes "Synthetic market-insight product for six insurance carriers, 2024 and 2025 — policy sales by quarter, revenue by period, campaigns and a benchmark with masked competitors; money in cents." Finance (REST API) describes "The Finance sample over a local REST API ('npm run finance:api' serves it on http://127.0.0.1:55081)." and Marketing Analytics (REST API) "The Marketing Analytics sample over a local REST API ('npm run marketing-analytics:api' serves it on http://127.0.0.1:55082)."; World Cup (REST API, connector profile) "The World Cup sample over a local REST API with the connector profile ('REST_API_PROFILE=connector npm run worldcup:api', one server per paging style)."; both serve the sample's JSON dump ([data-model.md](../../system/data-model.md) 4.10), so their rows are the PostgreSQL sample's. Each Databricks sample describes "The <name> sample in a Databricks Unity Catalog schema (evals.<schema>), loaded from its JSON dump by 'npm run fixture:databricks -- --fixture <id>'.", with the name, schema and id of the PostgreSQL sample it is loaded from. The panel lists the three Databricks samples last.
- R3. The default connection of the PostgreSQL samples SHALL be host `127.0.0.1`, port `55432` (overridable with the `WORLD_CUP_DB_PORT` environment variable), SSL off, and the development-only credentials of the repository's compose database: user `world_cup`, password `world_cup_dev`; database `world_cup` for World Cup, `formula1` for Formula 1, `intellify` for Intellify, and for each synthetic domain sample its schema's name (`finance`, `health_insurance`, `genomics`, `supply_chain`, `marketing_analytics`) (all live on the same server, whose superuser is the first sample's user). The REST samples' defaults are placeholders: `127.0.0.1:55080` for World Cup, `55081` for Finance, `55082` for Marketing Analytics and `55090` for the World Cup connector profile, the ports their local APIs serve on.
- R4. The seed files are data assets: `001_world_cup.sql` (a transaction that creates schema `world_cup` with tables for confederations, countries, teams, tournaments, tournament teams, venues, players, squad members, matches, match team statistics, goals, disciplinary events, indexes and reporting views) `002_formula_1.sql.gz` (a gzipped dump creating schema `formula1`) and `003_intellify.sql.gz` (gzipped; creates schema `intellify` with the 49 tables of the Intellify data model, their 52 foreign keys, a comment on every table and column naming the source collection or Mongo field, and deterministic synthetic rows). The Intellify seed is generated, not hand-written: `python3 scripts/generate-intellify-seed.py` rewrites it byte for byte, so change the generator and regenerate rather than editing the seed. A rebuild SHALL carry them over verbatim; they are not described row by row. The World Cup SQL is also shipped as the compose database's first-boot init script and the two copies SHALL be kept identical. `008_marketing_analytics.sql` (a transaction that creates schema `marketing_analytics` with its 14 tables and indexes) is generated: `docker/postgres/generate/marketing-analytics.ts` writes it from a fixed seed, byte-identical on every run, together with the planted facts its eval questions are checked against (`backend/scripts/fixtures/marketing-analytics/facts.json`); it is regenerated, never edited by hand, and is not a compose init script (each domain sample gets its own database). Its rows, glossary and traps are described in [the domain brief](../../../docs/evals/domains/marketing-analytics.md). The other domain seeds are generated the same way: `004_health_insurance.sql`, `005_genomics.sql` and `006_supply_chain.sql` (byte-identical to the scripts first written on the `feat/engine-eval-loop` branch for one shared database) and `007_finance.sql` (that branch's banking rows unchanged, plus the wealth-management tables, with its planted facts). Where the files live and what ships: [data-model.md](../../system/data-model.md) section 4.10; the domains themselves: [docs/evals/domains/](../../../docs/evals/domains/README.md).

### Status

- R5. The system SHALL report, for every fixture: its id, name, description, whether it is seedable, its schema, its default connection, and a status. The status says whether it is loaded, the datasource id/name and dataset name when found, the number of required entities present, the number required, and where the loaded datasource points (host, port, database, user, SSL — never the password).
- R6. A fixture SHALL be considered **loaded** only when a datasource named exactly as the fixture's datasource name exists, a dataset named exactly as its dataset name exists, and that dataset contains every required table. Presence is compared on the last two key segments (`schema.table`, case-insensitive), because the catalog segment is the user-chosen database name; a same-named table in another schema does not count.
- R7. Status SHALL never fail the caller: if the stores cannot be read the system SHALL answer with every fixture not loaded, 0 present.

### Loading

- R8. Loading a fixture SHALL accept a connection (host, port, database, user, password, SSL) and validate it before touching anything: `Host is required`, `Database is required`, `User is required`, `Port must be a positive integer` (an integer from 1 to 65535), `Database name must not contain a double quote`. An unknown fixture id answers `Unknown sample fixture "<id>"`.
- R9. The REST samples other than the self-registering `intellify-api` (R21) SHALL NOT be loadable from the panel; loading one answers `The <name> sample is registered for evals only — create its datasource with scripts/setup-worldcup-rest.ts instead of loading it here.` (for World Cup, `The World Cup (REST API) sample …`). That script is `setup-fixture-rest.ts` with its World Cup defaults and registers any of the three REST samples; its flags, the local API's switches and the eval variants are in [delivery.md](../../system/delivery.md) section 2, *The fixture REST API*.
- R10. The loader SHALL connect to the named database. If it does not exist (SQLSTATE `3D000`) and the fixture is seedable, the loader SHALL create it by connecting to the maintenance database `postgres` with the same credentials and issuing `CREATE DATABASE`, then continue. If it cannot create it the message is `Database "<db>" does not exist on <host>:<port> and the user "<user>" could not create it. Create the database yourself (or supply a user with CREATEDB rights) and load again. (<cause>)`. If the fixture is register-only the message is `Database "<db>" does not exist on <target>, and the <name> sample ships no seed SQL — point this at a database that already carries the data.`
- R11. A connection that cannot be established SHALL answer with an actionable message that names the target and the user but never the password: for a refused connection `Could not reach PostgreSQL at <host>:<port> — nothing is listening there. The bundled <name> fixture starts with "docker compose up -d" from the repo root; otherwise check the host and port. (<detail>)` (the compose hint only for seedable fixtures); otherwise `Could not connect to <db> at <target> as "<user>" — <detail>`.
- R12. For a seedable fixture the loader SHALL drop the fixture's schema if it exists (`DROP SCHEMA IF EXISTS … CASCADE`) and replay the seed script inside a single transaction, so a failure leaves no half-built schema. Statements SHALL be sent in batches of 50 (a whole dump in one request exhausts server memory; one per request is too slow). The script is split on statement boundaries respecting quotes, quoted identifiers, comments (including nested block comments) and dollar quoting; transaction-control statements in the dump (`BEGIN`, `COMMIT`, `START TRANSACTION`) and the dump tool's `\restrict` / `\unrestrict` meta-commands are removed. A gzipped seed is decompressed first. Timeouts: connect 8 s, statements 120 s.
- R13. A seeding failure SHALL answer `Could not seed the <name> fixture into "<db>" on <target> — <detail>` and SHALL leave nothing registered app-side from that attempt.
- R14. After a successful seed (or immediately, for a register-only fixture) the loader SHALL save a PostgreSQL datasource named as the fixture's datasource name — reusing the existing record, and overwriting its configuration, when one with that name exists — then read the datasource's inventory live (refreshing the stored snapshot) and collect the required entities from it.
- R15. If any required entity is missing from the inventory the loader SHALL answer `Missing entities after seeding: <keys>. …` (`after registering` for register-only; with a hint to check for conflicting objects, or that the database must already carry the data) and SHALL NOT create the dataset. The datasource saved in R14 stays registered.
- R16. Otherwise the loader SHALL save the dataset named as the fixture's dataset name with exactly the required entities, through the normal dataset save (so sample values and relationships are captured, see [datasets](../datasets/spec.md)), and answer success with the datasource id, dataset name, entity count, whether the database was created, and whether it was seeded. Messages: `Seeded <schema> on <target> and loaded <n> entities into dataset "<dataset>"` (with ` — created the database` when applicable) or, register-only, `Registered <target>/<db> and loaded <n> entities into dataset "<dataset>" — the <name> sample ships no seed SQL, so nothing was written to the database`.
- R17. Seeding SHALL be destructive by design (it drops the sample's schema on the target database), so the UI SHALL require an explicit confirmation naming the schema and target before loading (see UI).

### Removing

- R18. Removing a fixture SHALL delete its dataset (first) and its datasource from the app only. It SHALL NOT touch the database. Answers: `Removed the <name> datasource and dataset from this app. The database itself was left untouched.`, or `Nothing to remove — the sample is not loaded` when neither existed; unknown id as in R8.
- R19. Because fixtures are matched to records by **name**, a datasource or dataset the user created by hand with a fixture's name is treated as that fixture's: loading overwrites the datasource's configuration and removing deletes it. Open question: the E2E suite and users commonly create a datasource called "World Cup PostgreSQL" by hand; decide whether to mark fixture-owned records instead of matching by name.

### Availability

- R20. Every testing-data action SHALL be available to the user; the app has no roles or permissions.

### Self-registering samples

- R21. A **self-registering** REST sample (today only `intellify-api`) registers a REST API that the app itself runs, the Intellify RFP API (ADR-0027, [../rfp/spec.md](../rfp/spec.md)). Loading it SHALL take no connection (R8's validation is skipped and any body is ignored) and SHALL write to no database. It SHALL: read the URL and key of the API this app started, or answer `The Intellify API is not running in this app (INTELLIFY_API=off or it failed to start) — see the system logs.`; check the API's health, or answer `The Intellify API cannot reach its database at <host:port/db>. Load the "Intellify" sample into that database first.`; discover the API's collection endpoints from its OpenAPI document; save the REST datasource "Intellify RFP API" with API-key-header authentication (`X-API-Key`, the key read above), reusing the record of that name as R14 does; refresh its inventory; and save the dataset "Intellify RFP API" with the 10 required entities (R15 applies when one is missing). Success answers `Registered the Intellify RFP API at <url> and loaded 10 entities into dataset "Intellify RFP API"`. Status and Remove work as for every sample (R5-R7, R18); removing never touches the API or its database.

### Seeded samples' databases

- R22. Every seedable sample SHALL own its own database and schema, so loading one never drops another's, and its bundled seed SHALL create that schema and every one of its required tables and views. A unit test checks both against the bundled files, without a database (BA-185, BA-212).

### Databricks samples

Added 2026-10-13 (BA-186). Validated on a warehouse in the VDI, from a copy of the repository: [docs/evals/databricks-vdi.md](../../../docs/evals/databricks-vdi.md).

- R23. The three Databricks samples (R2) SHALL be register-only, of kind Databricks, each the mirror of a PostgreSQL sample: World Cup, Finance or Marketing Analytics, with the same schema and required entities and its rows from the same JSON dump ([ADR-0015](../../system/architecture.md)). Their entities are keyed `<catalog>.<schema>.<table>`: by default in the Unity Catalog catalog `evals`, the one their eval reference queries name in the set files; any other catalog works, because the references run in the dataset's catalog ([agents-evals](../agents-evals/spec.md) R192). Their defaults are placeholders: no host or user, port 443, database `evals` (the catalog), SSL on. The panel SHALL NOT load them: loading one answers `The <name> sample is registered for evals only — load it into Databricks and register it with scripts/setup-fixture-databricks.ts --fixture <source> instead of loading it here (runbook: docs/evals/databricks-vdi.md).`, where `<source>` is the id of the PostgreSQL sample it mirrors. Status (R5, R6) reads them like any sample, but shows a connection (`host:port/database`) only for a PostgreSQL datasource.
- R24. `npm run fixture:databricks -- --fixture <source>` (`backend/scripts/setup-fixture-databricks.ts`; `<source>` is `world-cup`, `finance` or `marketing-analytics`, or the Databricks sample's own id) SHALL load the PostgreSQL sample's JSON dump ([data-model.md](../../system/data-model.md) 4.10; World Cup's is the dump the local REST API serves) into `<catalog>.<schema>`, by default `evals.<the sample's schema>`:
  1. Before it connects, it reads the dump and writes every statement. A relation whose row count differs from `_meta.json`, a required table missing from the dump, a column type with no mapping, a NULL in a NOT NULL column, or a value that does not fit its column (a whole number out of range, a decimal with more digits than the column's scale) stops it, naming the relation, the row and the column.
  2. It runs `CREATE SCHEMA IF NOT EXISTS`, then, for every relation of the dump, views included, `CREATE OR REPLACE TABLE` with every name in backticks and NOT NULL where the PostgreSQL column has it, then the rows in INSERTs of at most 500 rows and 256 KiB each. Views are loaded as tables holding the view's rows, not recreated from their PostgreSQL definition, so their rows are the dump's by construction.
  3. A column's PostgreSQL type comes from the sample's seed (`CREATE TABLE`), else from the dump's `_meta.json` (the domain samples' views), else from its values (whole numbers `bigint`, other numbers `double precision`, ISO dates `date`, ISO timestamps with a zone `timestamptz`, booleans `boolean`, anything else or only NULLs `text`). It maps to Databricks SQL as: `smallint` SMALLINT, `integer` INT, `bigint` BIGINT, `numeric(p,s)` DECIMAL(p,s), a bare `numeric` DECIMAL(38,s) with s the most decimals among its values, `real` FLOAT, `double precision` DOUBLE, `text`, `char(n)`, `varchar(n)`, `uuid` and `json`/`jsonb` STRING, `boolean` BOOLEAN, `date` DATE, `timestamptz` TIMESTAMP, `timestamp` TIMESTAMP_NTZ.
  4. Values are written as literals: strings in single quotes with `\'`, `\\` and `\n`-style escapes (Databricks reads two adjacent literals as one string, so a quote is never doubled), `DATE'YYYY-MM-DD'`, `TIMESTAMP'<ISO 8601 UTC>'`, decimals at the column's scale.
  5. One `UNION ALL` query then counts every relation; a count that differs from the dump fails the load, naming the relation with the expected and the found count.

  Running it again leaves the same tables. `--dry-run` prints the statements (each INSERT cut to two rows; `--full` prints them whole), the column types and what it would register, and connects to nothing. Another catalog (`DATABRICKS_CATALOG`) is allowed, and the eval sets run on it (agents-evals R192). Another schema (`DATABRICKS_SCHEMA`) is allowed with a warning that the eval sets will not run on that copy, since the preflight and the references need the sample's own schema. Flags and environment: [delivery.md](../../system/delivery.md).
- R25. After loading (or alone, with `--register-only`; never with `--no-register`), the script SHALL register the sample in a running backend (`BACKEND_URL`) by calling its HTTP API ([api.md](../../system/api.md)) directly, with no sign-in and no token, since the app has one built-in user (ADR-0030): save a Databricks datasource named as the sample's datasource name with the host, warehouse id and token (reusing the record of that name), read its inventory live, and save the dataset named as the sample's dataset name with exactly its required entities from `<catalog>.<schema>`. A required table that is missing, browse-only or without columns fails the registration, listing each, and no dataset is saved.

### Knowledge seeds

Added 2026-10-16 (roadmap 1.1.10, BA-188): the rules about each synthetic domain's data that `feat/engine-eval-loop` seeded with a script, now created by the loader, so a chat or an eval run on a loaded domain sample gets the same knowledge block.

- R26. The Finance, Health Insurance, Genomics and Supply Chain samples SHALL each ship a **knowledge seed**: knowledge entries (terms, instructions and default filters, [knowledge](../knowledge/spec.md)) and metrics ([metrics](../metrics/spec.md)) that state rules about the sample's data, such as a column's vocabulary, a join path, a coverage boundary, a unit or a standing filter (the banking rules of the branch moved onto the finance schema and checked against it). After a successful load from the panel (R16), the loader SHALL create each seed entry the app does not hold yet, through the normal knowledge and metrics create:
  - a knowledge entry scoped to the sample's dataset (by name), enabled, so with source `user` (knowledge R6), its entities named `<database>.<schema>.<table>` on the loaded database; an entry about one column names the column in its body;
  - a metric on the loaded datasource, its entity named the same way.

  The loader SHALL create the entries so that the block, built newest first (knowledge R16) within its 7,000 characters (knowledge R17), sends the seed's default filters first, then its instructions, then its terms, each group in the seed's order: it creates them in the reverse of that order, each with a later update time than the one before. A knowledge entry is held when one of the same kind and title (trimmed, ignoring case) is scoped to that dataset; a metric when one of the same name exists. Held entries SHALL be left as they are, so loading again never duplicates an entry or overwrites an edit, and an entry the user deleted comes back on the next load. When the loader created any, the success message SHALL end with ` — added <k> knowledge entries and <m> metrics` (after ` — created the database` when both apply; `entry` and `metric` in the singular for 1; a part with 0 left out). Creating the seed SHALL NOT fail a load that succeeded: if an entry cannot be saved, the message SHALL end with ` — could not add its knowledge seed: <detail>` instead, and the entries already created stay. The other samples ship no seed, so loading them creates no knowledge entry or metric; World Cup ships none, so its chats and eval runs see the same context as before. Removing a sample (R18) SHALL leave its knowledge entries and metrics.
- R27. A knowledge seed SHALL state rules about the data, never a hint about one eval question: no entry names the id of a question of its sample's eval sets ([agents-evals](../agents-evals/spec.md) R11) or repeats a question's wording, and none settles an ambiguity that an `ambiguous` question asks the assistant to notice. A coverage boundary (the years or values the data holds) is a rule about the data and is allowed, even where an `out-of-scope` question relies on it. A unit test SHALL check the first two against the bundled question bank files; the third is checked by review when an entry is written.

## Edge cases and errors

- **Server not running:** R11's message, with the compose hint.
- **Database missing and the user cannot create it:** R10's message.
- **Database user without permission to drop the schema or create objects:** the seed fails and the transaction rolls back; message per R13 with the server's detail.
- **Port or host wrong in the form:** "Test connection" (which uses the generic PostgreSQL connection test, see [datasources](../datasources/spec.md)) shows the `Postgres — …` message inline.
- **Partial state:** a fixture whose datasource exists but whose dataset is missing or incomplete shows `<n>/<required> entities` and not-loaded; Remove stays disabled because it requires "loaded". Open question: allow Remove for a partially loaded fixture.
- **Register-only REST sample:** the panel offers "Register testing data" with a PostgreSQL connection form, but the backend refuses (R9).
- **Register-only Databricks samples:** the same form, refused the same way, with the loader script named (R23). Their placeholder defaults leave Host and User empty, so the action stays disabled until both are typed. Open question: hide the form and show the script instruction for register-only REST samples, or make the panel able to register them.
- **Concurrent actions on one card:** buttons are disabled while any action on that card (or the status refresh) is running; cards do not share state.
- **Status unreadable:** every sample shows `0/<required> entities`.

## Contracts

- Endpoints: list fixtures with status, load a fixture with a connection, remove a fixture: [api.md](../../system/api.md), section Testing data. Results are `{ ok, message, … }`; failures are not HTTP errors.
- Reads and writes the `connections` and `datasets` collections (and the datasource inventory snapshot) only through the datasources and datasets capabilities, and creates a sample's knowledge seed (R26) only through the [knowledge](../knowledge/spec.md) and [metrics](../metrics/spec.md) capabilities: [data-model.md](../../system/data-model.md).
- No agent. The eval suite reads the catalogue to check that a case set's sample data is present before a run: [agents.md](../../system/agents.md) and [agents-evals](../agents-evals/spec.md).
- Related scripts: `npm run fixtures:<domain>` (regenerates a synthetic domain's seed and facts), `npm run fixture:dump -- --fixture <id>` (exports a loaded sample to gzipped JSON), `npm run worldcup:api`, `npm run finance:api` and `npm run marketing-analytics:api` (serve a sample's REST API, with the switches of BA-187), `npm run worldcup:api:dump`, `npm run worldcup:rest:setup` and `npm run fixture:rest:setup` (create a REST sample's datasource and dataset, one per server variant), `npm run fixture:databricks -- --fixture <source>` (loads a sample into Databricks and registers it, R24, R25), `docker compose up -d postgres` (the seeded World Cup server), all from the repository: [delivery.md](../../system/delivery.md).
- Terms: [glossary](../../product/glossary.md).

## UI

Settings → **Testing Data** (see [ui.md](../../system/ui.md)). Heading "Testing Data"; subtitle "Bundled sample datasets you can load into a PostgreSQL database to power local testing and evals."

**List.** Loading: `Loading fixtures…`. Empty: `No testing data fixtures are registered.` One card per fixture, collapsed by default; clicking the header expands or collapses it (one open at a time). The header shows the name, a status of `<present>/<required> entities` with a check mark when loaded or a cross otherwise, the description, and — when loaded — `<host>:<port>/<database>`.

**Expanded card.**
- Error banner (the loader's message, wrapping) after a failed load or remove.
- "Connection" form: Host (placeholder "localhost"), Port (placeholder 5432), Database, User (placeholder "postgres"), Password (placeholder `••••••••`), "Use SSL". Prefilled from the loaded datasource's connection when there is one, else the fixture's defaults; the password always starts as the fixture's development default, never from a saved datasource. Editing any field clears the last test result.
- **Test connection** (becomes "Testing…") runs a PostgreSQL connection test with the form values and shows the message inline, green on success and red on failure. Disabled when Host, Database or User is empty or the card is busy.
- Primary action: seedable and not loaded → **Load testing data**; seedable and loaded → **Recreate testing data**; register-only → **Register testing data**. While running: "Loading…" or "Registering…". Same disabled rule.
- Pressing the primary action opens a confirmation panel (amber) instead of acting: seedable — "This drops and recreates schema `<schema>` on `<host>:<port>/<database>`. Everything in that schema will be lost."; register-only — `This registers "<name>" as a datasource and dataset against the existing database at <target>. No schema changes are made.` With **Confirm** and **Cancel**. On success a toast shows the loader's message and the status refreshes.
- Self-registering REST sample (Intellify RFP API, R21): the card shows no Connection form and no **Test connection**; in their place a line `API URL: <url>` with the URL of the API this app started (left out when the API is not running). The primary action is **Register testing data** ("Registering…"), and its confirmation reads `This registers the Intellify RFP API at <url> as a datasource and dataset. No database changes are made.`
- "Remove" section: "Deletes the "<name>" datasource and dataset records from the app only. It does not touch the database itself." A **Remove** button ("Removing…"), disabled unless the fixture is loaded or the card is busy, opens an amber confirmation ("This removes the "<name>" datasource and dataset records from the app. The database and its data are not touched.") with **Confirm** / **Cancel**. Opening one confirmation closes the other.

## Flows

### Feature: Testing data

E2E: `frontend/e2e/testing-data.spec.ts` for "Lists the bundled samples and what is loaded", "Loads the Intellify sample into a new database" and "Registers the Intellify RFP API"; the other scenarios are not automated yet.

```gherkin
Feature: Testing data

  Background:
    Given a PostgreSQL server is running at 127.0.0.1:55432 with the compose credentials

  Scenario: Lists the bundled samples and what is loaded
    When I open Settings and click "Testing Data"
    Then I see the "World Cup", "Formula 1", "Intellify", "World Cup (REST API)" and "Intellify RFP API" samples
    And I see the synthetic "Finance", "Health Insurance", "Genomics", "Supply Chain" and "Marketing Analytics" samples
    And each shows "0/<required> entities" with a cross when nothing is loaded
    And each shows its description

  Scenario: Loads the World Cup sample
    Given I am in "Testing Data"
    When I click the "World Cup" sample
    Then I see the connection prefilled with Host "127.0.0.1", Port "55432", Database "world_cup", User "world_cup"
    When I click "Load testing data"
    Then I see a warning that schema "world_cup" will be dropped and recreated
    When I click "Confirm"
    Then I see a message that starts with "Seeded world_cup on 127.0.0.1:55432 and loaded 10 entities into dataset "World Cup""
    And the sample shows "10/10 entities" with a check mark and "127.0.0.1:55432/world_cup"
    And "World Cup PostgreSQL" appears under "Datasource Configuration"
    And the "World Cup" dataset appears under "Datasets"

  Scenario: Loads a synthetic domain sample into its own database
    Given the "finance" database does not exist on the server
    When I click the "Finance" sample
    Then I see the connection prefilled with Host "127.0.0.1", Port "55432", Database "finance", User "world_cup"
    When I click "Load testing data"
    And I click "Confirm"
    Then I see a message that starts with "Seeded finance on 127.0.0.1:55432 and loaded 17 entities into dataset "Finance""
    And the message ends with "— created the database"
    And the sample shows "17/17 entities" with a check mark

  Scenario: Loads a domain sample with its knowledge seed
    Given no knowledge entry is scoped to the "Health Insurance" dataset
    When I click the "Health Insurance" sample
    And I click "Load testing data"
    And I click "Confirm"
    Then I see a message that starts with "Seeded health_insurance on 127.0.0.1:55432 and loaded 12 entities into dataset "Health Insurance""
    And the message ends with "knowledge entries and" followed by the number of metrics
    When I open Knowledge and filter by the dataset "Health Insurance"
    Then I see the sample's knowledge entries, each enabled

  Scenario: Loading a sample again keeps its knowledge entries as edited
    Given the "Health Insurance" sample is loaded with its knowledge seed
    And I changed the body of one of its knowledge entries
    When I load the "Health Insurance" sample again
    Then the message does not mention knowledge entries
    And that entry keeps the body I wrote
    And no knowledge entry is listed twice

  Scenario: Loading the World Cup sample creates no knowledge
    Given no knowledge entry exists
    When I load the "World Cup" sample
    Then the message does not mention knowledge entries
    And Knowledge shows no entries

  Scenario: Refuses to load a Databricks sample
    Given I am in "Testing Data"
    When I click the "World Cup (Databricks)" sample
    And I type a Host and a User
    And I click "Register testing data" and "Confirm"
    Then I see an error banner starting with "The World Cup (Databricks) sample is registered for evals only — load it into Databricks and register it with scripts/setup-fixture-databricks.ts --fixture world-cup"

  Scenario: Cancels a load
    Given I am in "Testing Data" with the "World Cup" sample expanded
    When I click "Load testing data"
    And I click "Cancel"
    Then nothing is loaded and the confirmation is gone

  Scenario: Recreates a loaded sample
    Given the "World Cup" sample is loaded
    When I expand it
    Then the primary action reads "Recreate testing data"

  Scenario: Creates a missing database
    Given the "formula1" database does not exist on the server
    When I load the "Formula 1" sample and confirm
    Then the database is created and seeded
    And I see a message that ends with "— created the database"
    And the sample shows "48/48 entities"

  Scenario: Loads the Intellify sample into a new database
    Given a database name that does not exist on the server
    When I expand the "Intellify" sample and set Database to that name
    And I click "Load testing data"
    Then I see a warning that schema "intellify" will be dropped and recreated
    When I click "Confirm"
    Then I see a message that starts with "Seeded intellify on 127.0.0.1:55432 and loaded 49 entities into dataset "Intellify"" and ends with "— created the database"
    And the sample shows "49/49 entities" and "127.0.0.1:55432/<that name>"
    And "Intellify PostgreSQL" appears under "Datasource Configuration"

  Scenario: Registers the Intellify RFP API
    Given the Intellify sample is loaded into the database the Intellify RFP API reads
    And I am in "Testing Data"
    When I expand the "Intellify RFP API" sample
    Then I see "API URL:" with the API's URL and no connection form
    When I click "Register testing data"
    Then I see "This registers the Intellify RFP API at <url> as a datasource and dataset. No database changes are made."
    When I click "Confirm"
    Then I see a message that starts with "Registered the Intellify RFP API at" and ends with "loaded 10 entities into dataset "Intellify RFP API""
    And the sample shows "10/10 entities" with a check mark
    And "Intellify RFP API" appears under "Datasource Configuration"
    And the "Intellify RFP API" dataset appears under "Datasets"

  Scenario: Tests the connection from the card
    Given I am in "Testing Data" with the "World Cup" sample expanded
    When I click "Test connection"
    Then I see "Connection successful" in green
    When I change Port to "1" and click "Test connection"
    Then I see a "Postgres —" message in red

  Scenario: Reports an unreachable server
    Given I am in "Testing Data" with the "World Cup" sample expanded
    When I change Port to "1", click "Load testing data" and click "Confirm"
    Then I see an error banner starting with "Could not reach PostgreSQL at 127.0.0.1:1 — nothing is listening there."

  Scenario: Removes a sample without touching the database
    Given the "World Cup" sample is loaded
    When I expand it and click "Remove" and then "Confirm"
    Then I see "Removed the World Cup datasource and dataset from this app. The database itself was left untouched."
    And the sample shows "0/10 entities"
    And the schema "world_cup" still exists in the database

  Scenario: Remove is unavailable when nothing is loaded
    Given the "Formula 1" sample is not loaded
    When I expand it
    Then "Remove" is disabled
```

## Acceptance

1. With the compose database up, loading World Cup from the panel yields a registered "World Cup PostgreSQL" datasource, a "World Cup" dataset with the 10 required entities (with sample values and join references), and a `10/10 entities` status; loading it again recreates the schema without duplicating records.
2. Loading Formula 1 into a server that lacks the `formula1` database creates it, seeds 48 required tables and reports `48/48 entities`.
3. Loading Intellify into a server that lacks the `intellify` database creates it, seeds the 49 tables and reports `49/49 entities`; the "Intellify" dataset carries the 52 declared foreign keys as join references.
4. Remove clears both app-side records and leaves the database intact; status returns to `0/<required>`.
5. A failure at any stage (connection, creation, seed, missing entities) produces the corresponding message and does not leave a dataset behind; a seed failure leaves nothing registered.
6. The assistant eval start checks the datasets bound to the chosen datasource against the required entities of the fixture the selected questions belong to (by `schema.table`), so a loaded fixture lets its question set run and a datasource lacking those entities is refused ([agents-evals](../agents-evals/spec.md)).

<!-- sources: backend/src/modules/testing-data/** (the Databricks loader core in databricks/), scripts/generate-intellify-seed.py, backend/scripts/setup-fixture-databricks.ts, backend/scripts/setup-fixture-rest.ts, backend/scripts/worldcup-rest-api/**, backend/src/modules/testing-data/fixtures/registry.ts, backend/src/modules/agents/eval-runs.service.ts (fixture preflight), docker-compose.yml, backend/package.json (worldcup scripts), frontend/src/app/features/testing-data/**, frontend/src/app/app.html (Testing Data navigation) -->

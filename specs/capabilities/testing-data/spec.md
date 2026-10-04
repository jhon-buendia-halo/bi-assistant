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

- R1. The catalogue SHALL be the single definition of every sample: the panel, the loader and the eval suite's data check read from it, so adding a sample means adding one seed file and one catalogue entry. A catalogue entry SHALL declare: id (stable, used in URLs and by eval sets), name, description, optional seed file, owned schema, default connection (host, port, database, user, password, SSL), datasource name, dataset name, required table names and optional kind.
- R2. The system SHALL ship these fixtures, in this panel order:

  | Id | Name | Schema | Seed | Datasource name | Dataset name | Required entities |
  |---|---|---|---|---|---|---|
  | `world-cup` | World Cup | `world_cup` | bundled SQL | "World Cup PostgreSQL" | "World Cup" | 9: `tournaments`, `teams`, `matches`, `venues`, `players`, `goals`, `match_team_statistics`, views `v_match_results`, `v_player_goal_totals` |
  | `formula-1` | Formula 1 | `formula1` | bundled gzipped SQL | "Formula 1 PostgreSQL" | "Formula 1" | 48 (seasons, drivers, constructors, circuits, races, standings and per-session results; full list in the catalogue) |
  | `world-cup-rest` | World Cup (REST API) | `world_cup` | none (register-only, kind REST) | "World Cup REST API" | "World Cup (REST)" | the same 9 names as World Cup, keyed `api.world_cup.<table>` |

  World Cup describes "Men’s FIFA World Cup, 2018 and 2022 — tournaments, matches, teams, venues, players, goals and two reporting views." Formula 1 describes "Formula One world championship, 1950 to 2026 — seasons, drivers, constructors, circuits, races, standings and per-session results." The REST sample describes "The World Cup sample over a local REST API ('npm run worldcup:api' serves it on http://127.0.0.1:55080)."
- R3. The default connection of the PostgreSQL samples SHALL be host `127.0.0.1`, port `55432` (overridable with the `WORLD_CUP_DB_PORT` environment variable), SSL off, and the development-only credentials of the repository's compose database: user `world_cup`, password `world_cup_dev`; database `world_cup` for World Cup and `formula1` for Formula 1 (both live on the same server, which is the first sample's superuser). The REST sample's defaults are placeholders (`127.0.0.1:55080`).
- R4. The seed files are data assets: `001_world_cup.sql` (a transaction that creates schema `world_cup` with tables for confederations, countries, teams, tournaments, tournament teams, venues, players, squad members, matches, match team statistics, goals, disciplinary events, indexes and reporting views) and `002_formula_1.sql.gz` (a gzipped dump creating schema `formula1`). A rebuild SHALL carry them over verbatim; they are not described row by row. The World Cup SQL is also shipped as the compose database's first-boot init script and the two copies SHALL be kept identical.

### Status

- R5. The system SHALL report, for every fixture: its id, name, description, whether it is seedable, its schema, its default connection, and a status. The status says whether it is loaded, the datasource id/name and dataset name when found, the number of required entities present, the number required, and where the loaded datasource points (host, port, database, user, SSL — never the password).
- R6. A fixture SHALL be considered **loaded** only when a datasource named exactly as the fixture's datasource name exists, a dataset named exactly as its dataset name exists, and that dataset contains every required table. Presence is compared on the last two key segments (`schema.table`, case-insensitive), because the catalog segment is the user-chosen database name; a same-named table in another schema does not count.
- R7. Status SHALL never fail the caller: if the stores cannot be read the system SHALL answer with every fixture not loaded, 0 present.

### Loading

- R8. Loading a fixture SHALL accept a connection (host, port, database, user, password, SSL) and validate it before touching anything: `Host is required`, `Database is required`, `User is required`, `Port must be a positive integer` (an integer from 1 to 65535), `Database name must not contain a double quote`. An unknown fixture id answers `Unknown sample fixture "<id>"`.
- R9. The REST sample SHALL NOT be loadable from the panel; loading it answers `The World Cup (REST API) sample is registered for evals only — create its datasource with scripts/setup-worldcup-rest.ts instead of loading it here.`
- R10. The loader SHALL connect to the named database. If it does not exist (SQLSTATE `3D000`) and the fixture is seedable, the loader SHALL create it by connecting to the maintenance database `postgres` with the same credentials and issuing `CREATE DATABASE`, then continue. If it cannot create it the message is `Database "<db>" does not exist on <host>:<port> and the user "<user>" could not create it. Create the database yourself (or supply a user with CREATEDB rights) and load again. (<cause>)`. If the fixture is register-only the message is `Database "<db>" does not exist on <target>, and the <name> sample ships no seed SQL — point this at a database that already carries the data.`
- R11. A connection that cannot be established SHALL answer with an actionable message that names the target and the user but never the password: for a refused connection `Could not reach PostgreSQL at <host>:<port> — nothing is listening there. The bundled <name> fixture starts with "docker compose up -d" from the repo root; otherwise check the host and port. (<detail>)` (the compose hint only for seedable fixtures); otherwise `Could not connect to <db> at <target> as "<user>" — <detail>`.
- R12. For a seedable fixture the loader SHALL drop the fixture's schema if it exists (`DROP SCHEMA IF EXISTS … CASCADE`) and replay the seed script inside a single transaction, so a failure leaves no half-built schema. Statements SHALL be sent in batches of 50 (a whole dump in one request exhausts server memory; one per request is too slow). The script is split on statement boundaries respecting quotes, quoted identifiers, comments (including nested block comments) and dollar quoting; transaction-control statements in the dump (`BEGIN`, `COMMIT`, `START TRANSACTION`) and the dump tool's `\restrict` / `\unrestrict` meta-commands are removed. A gzipped seed is decompressed first. Timeouts: connect 8 s, statements 120 s.
- R13. A seeding failure SHALL answer `Could not seed the <name> fixture into "<db>" on <target> — <detail>` and SHALL leave nothing registered app-side from that attempt.
- R14. After a successful seed (or immediately, for a register-only fixture) the loader SHALL save a PostgreSQL datasource named as the fixture's datasource name — reusing the existing record, and overwriting its configuration, when one with that name exists — then read the datasource's inventory live (refreshing the stored snapshot) and collect the required entities from it.
- R15. If any required entity is missing from the inventory the loader SHALL answer `Missing entities after seeding: <keys>. …` (`after registering` for register-only; with a hint to check for conflicting objects, or that the database must already carry the data) and SHALL NOT create the dataset. The datasource saved in R14 stays registered.
- R16. Otherwise the loader SHALL save the dataset named as the fixture's dataset name with exactly the required entities, through the normal dataset save (so sample values and relationships are captured, see [datasets](../datasets/spec.md)), and answer success with the datasource id, dataset name, entity count, whether the database was created, and whether it was seeded. Messages: `Seeded <schema> on <target> and loaded <n> entities into dataset "<dataset>"` (with ` — created the database` when applicable) or, register-only, `Registered <target>/<db> and loaded <n> entities into dataset "<dataset>" — the <name> sample ships no seed SQL, so nothing was written to the database`.
- R17. Seeding SHALL be destructive by design (it drops the sample's schema on the target database), so the UI SHALL require an explicit confirmation naming the schema and target before loading (R22).

### Removing

- R18. Removing a fixture SHALL delete its dataset (first) and its datasource from the app only. It SHALL NOT touch the database. Answers: `Removed the <name> datasource and dataset from this app. The database itself was left untouched.`, or `Nothing to remove — the sample is not loaded` when neither existed; unknown id as in R8.
- R19. Because fixtures are matched to records by **name**, a datasource or dataset the user created by hand with a fixture's name is treated as that fixture's: loading overwrites the datasource's configuration and removing deletes it. Open question: the E2E suite and users commonly create a datasource called "World Cup PostgreSQL" by hand; decide whether to mark fixture-owned records instead of matching by name.

## Edge cases and errors

- **Server not running:** R11's message, with the compose hint.
- **Database missing and the user cannot create it:** R10's message.
- **User without permission to drop the schema or create objects:** the seed fails and the transaction rolls back; message per R13 with the server's detail.
- **Port or host wrong in the form:** "Test connection" (which uses the generic PostgreSQL connection test, see [datasources](../datasources/spec.md)) shows the `Postgres — …` message inline.
- **Partial state:** a fixture whose datasource exists but whose dataset is missing or incomplete shows `<n>/<required> entities` and not-loaded; Remove stays disabled because it requires "loaded". Open question: allow Remove for a partially loaded fixture.
- **Register-only REST sample:** the panel offers "Register testing data" with a PostgreSQL connection form, but the backend refuses (R9). Open question: hide the form and show the script instruction for register-only REST samples, or make the panel able to register them.
- **Concurrent actions on one card:** buttons are disabled while any action on that card (or the status refresh) is running; cards do not share state.
- **Status unreadable:** every sample shows `0/<required> entities`.

## Contracts

- Endpoints: list fixtures with status, load a fixture with a connection, remove a fixture: [api.md](../../system/api.md), section Testing data. Results are `{ ok, message, … }`; failures are not HTTP errors.
- Reads and writes the `connections` and `datasets` collections (and the datasource inventory snapshot) only through the datasources and datasets capabilities: [data-model.md](../../system/data-model.md).
- No agent. The eval suite reads the catalogue to check that a case set's sample data is present before a run: [agents.md](../../system/agents.md) and [agents-evals](../agents-evals/spec.md).
- Related scripts: `npm run worldcup:api` (serves the World Cup REST API), `npm run worldcup:api:dump`, `npm run worldcup:rest:setup` (creates the REST sample's datasource and dataset), `docker compose up -d postgres` (the seeded World Cup server), all from the repository: [delivery.md](../../system/delivery.md).
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
- "Remove" section: "Deletes the "<name>" datasource and dataset records from the app only. It does not touch the database itself." A **Remove** button ("Removing…"), disabled unless the fixture is loaded or the card is busy, opens an amber confirmation ("This removes the "<name>" datasource and dataset records from the app. The database and its data are not touched.") with **Confirm** / **Cancel**. Opening one confirmation closes the other.

## Flows

### Feature: Testing data

E2E: none yet

```gherkin
Feature: Testing data

  Background:
    Given a PostgreSQL server is running at 127.0.0.1:55432 with the compose credentials

  Scenario: Lists the bundled samples and what is loaded
    When I open Settings and click "Testing Data"
    Then I see the "World Cup", "Formula 1" and "World Cup (REST API)" samples
    And each shows "0/<required> entities" with a cross when nothing is loaded
    And each shows its description

  Scenario: Loads the World Cup sample
    Given I am in "Testing Data"
    When I click the "World Cup" sample
    Then I see the connection prefilled with Host "127.0.0.1", Port "55432", Database "world_cup", User "world_cup"
    When I click "Load testing data"
    Then I see a warning that schema "world_cup" will be dropped and recreated
    When I click "Confirm"
    Then I see a message that starts with "Seeded world_cup on 127.0.0.1:55432 and loaded 9 entities into dataset "World Cup""
    And the sample shows "9/9 entities" with a check mark and "127.0.0.1:55432/world_cup"
    And "World Cup PostgreSQL" appears under "Datasource Configuration"
    And the "World Cup" dataset appears under "Datasets"

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
    And the sample shows "0/9 entities"
    And the schema "world_cup" still exists in the database

  Scenario: Remove is unavailable when nothing is loaded
    Given the "Formula 1" sample is not loaded
    When I expand it
    Then "Remove" is disabled
```

## Acceptance

1. With the compose database up, loading World Cup from the panel yields a registered "World Cup PostgreSQL" datasource, a "World Cup" dataset with the 9 required entities (with sample values and join references), and a `9/9 entities` status; loading it again recreates the schema without duplicating records.
2. Loading Formula 1 into a server that lacks the `formula1` database creates it, seeds 48 required tables and reports `48/48 entities`.
3. Remove clears both app-side records and leaves the database intact; status returns to `0/<required>`.
4. A failure at any stage (connection, creation, seed, missing entities) produces the corresponding message and does not leave a dataset behind; a seed failure leaves nothing registered.
5. The assistant eval start checks the datasets bound to the chosen datasource against the required entities of the fixture the selected questions belong to (by `schema.table`), so a loaded fixture lets its question set run and a datasource lacking those entities is refused ([agents-evals](../agents-evals/spec.md)).

<!-- sources: backend/src/modules/testing-data/**, backend/src/modules/testing-data/fixtures/registry.ts, backend/src/modules/agents/eval-runs.service.ts (fixture preflight), docker-compose.yml, backend/package.json (worldcup scripts), frontend/src/app/features/testing-data/**, frontend/src/app/app.html (Testing Data navigation) -->

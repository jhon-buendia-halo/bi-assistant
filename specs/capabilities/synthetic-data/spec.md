# Synthetic data

A user can profile the tables of a PostgreSQL or Databricks dataset quickly, from a **sample** of their rows, and (in the stories that follow) download a synthetic copy of them as a SQL script in the datasource's own dialect. The sampled profile shows each column's type, null rate, distinct count, range, categorical values and text patterns, and says how a synthetic column would be generated. It is an approximate view, separate from [data-readiness](../data-readiness/spec.md), whose statistics stay exact.

This release (roadmap 1.22.1) ships the sampled profile in the dataset editor. The generator, the SQL script download and the Data Readiness Agent's tools are added by roadmap 1.22.2 to 1.22.4 and are specified here when they ship. The epic is [../../epics/M1-22/spec.md](../../epics/M1-22/spec.md); the decision is ADR-0037 in [../../system/architecture.md](../../system/architecture.md).

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): sampled profile, dataset, datasource, entity, data readiness.

- **Sample.** Up to 1,000 rows of one table, read with the engine's native sampling where it exists. Raw rows are used to build a profile and are then dropped.
- **Sampling method.** How a table was read: `full` (the whole table, 1,000 rows or fewer), `tablesample` (the engine's `TABLESAMPLE`) or `limit` (the first rows, when sampling is unknown or refused).
- **Column kind.** What a column is for synthesis: `identifier`, `categorical`, `numeric`, `temporal`, `boolean`, `formatted`, `text` or `unsupported`.
- **Strategy.** How a synthetic column would be generated from its profile: `sequence`, `uuid`, `unique-pattern`, `foreign-key`, `categorical`, `numeric-range`, `temporal-range`, `boolean-rate`, `format-template`, `pattern`, `words`, `null-only` or `constant`. Shown in the profile as "Generated as".
- **Shape.** A character-class pattern of a text value, such as `Aa{2,9}_Aa{3,11}` or `999-99-9999`. It holds classes and lengths, never a letter or digit of the data.

## Rules

Separation from readiness
- R1. The sampled profile SHALL be a separate, approximate view. It SHALL NOT change readiness profiling, the readiness engine or its scores, and no sampled statistic SHALL feed a readiness score. [data-readiness](../data-readiness/spec.md) R29 (exact aggregates, no sampling) SHALL stand as written. The UI SHALL say so beside every profile (R14).
- R2. A sampled profile SHALL be offered for datasets on a PostgreSQL or Databricks datasource only. A dataset on a `rest` datasource SHALL get the empty-state text under **UI**.

Sampling
- R3. The sample size SHALL be at most 1,000 rows per table (`SAMPLE_SIZE_MAX`). A request MAY lower it, never raise it. The oversampling factor SHALL be 1.5, and the sampled share is `p = min(100, ceil(1.5 × sampleSize / estimate × 100 × 10⁴) / 10⁴)` percent.
- R4. On **PostgreSQL** the row estimate SHALL be `pg_class.reltuples` (never `COUNT(*)`; `-1` or missing means unknown), and the method per table SHALL be:
  - estimate ≤ 1,000: `SELECT * FROM "s"."t" LIMIT 1000`, method `full`;
  - 1,001 to 1,000,000: `SELECT * FROM "s"."t" TABLESAMPLE BERNOULLI (p) REPEATABLE (7) LIMIT 1000`, method `tablesample`;
  - above 1,000,000: `… TABLESAMPLE SYSTEM (p) REPEATABLE (7) LIMIT 1000`, method `tablesample`;
  - unknown, or a view, foreign table or partitioned parent where `TABLESAMPLE` errors: `SELECT * FROM "s"."t" LIMIT 1000`, method `limit`. A `LIMIT` read that returns fewer rows than requested has read the whole table and SHALL be labelled `full` (this covers `reltuples` of `-1` on a small table).
- R5. On **Databricks** the row estimate SHALL be `COUNT(*)` plus the table size in bytes (`sizeInBytes` of `DESCRIBE DETAIL`); a timeout or error means unknown. The method per table SHALL be:
  - estimate ≤ 1,000: ``SELECT * FROM `c`.`s`.`t` LIMIT 1000``, method `full`;
  - above 1,000 and under 50 GiB (`DATABRICKS_TABLESAMPLE_MAX_BYTES`): ``SELECT * FROM `c`.`s`.`t` TABLESAMPLE (p PERCENT) REPEATABLE (7) LIMIT 1000``, method `tablesample`;
  - a table of 50 GiB or more, a table of unknown size, an unknown estimate, or `TABLESAMPLE` refused (views): ``SELECT * FROM `c`.`s`.`t` LIMIT 1000``, method `limit`. As in R4, a `LIMIT` read returning fewer rows than requested is labelled `full`.
  - `TABLESAMPLE (n ROWS)` SHALL NOT be used, because Spark treats it as a limit, not a random sample.
- R6. When a `tablesample` read returns fewer than half of `min(sampleSize, estimate)` rows, the sampler SHALL retry once with `p × 4` (the `SYSTEM` method is block-level and can come back short).
- R7. On PostgreSQL every value SHALL be read as raw text (a per-query type parser that returns the text unchanged), so timestamps are not parsed into the host's time zone. On Databricks every value SHALL be normalised to a string (dates to ISO, big integers to decimal text, objects to JSON).
- R8. The sampler SHALL reuse the profilers' pooled read-only sessions, the 15 s statement timeout and the abort signal ([../../system/architecture.md](../../system/architecture.md) ADR-0033), and the concurrency limit per dialect shared with readiness. It SHALL add no write path to a datasource. A statement that times out or fails SHALL leave only that table with `error` and `sampledRows: 0`; the profile SHALL still list its columns, from the catalog.
- R9. **Raw rows SHALL never leave the service.** They SHALL NOT be logged, cached, persisted, put in an error message, returned by the endpoint or sent to a model. The profile builder turns them into statistics, and the rows are dropped when the request ends. An `error` text SHALL be connector text, never row data.

Profile contents and classification
- R10. For each column the profile SHALL hold: the declared type as the platform reports it, the semantic type, nullability, the null fraction (0 to 1, 4 decimals, 0 when nothing was sampled), the distinct count and ratio, and, where they apply, numeric statistics (min, max, mean, 11 quantiles p0 to p100, integer flag, scale up to 10), temporal statistics (min, max and 11 quantiles in UTC, granularity `date`, `second` or `fraction`), the true fraction of a boolean, a text length summary, categorical top values, and shapes. Every number is approximate. Numeric and temporal statistics SHALL be computed only for columns classified `numeric` or `temporal` (R11), never for identifiers. For those columns the minimum, maximum and the 11 quantiles are real values and extremes of the sample, and are shown as such. An identifier column (key, foreign key, uuid, id-named or high-distinct-ratio) carries only non-value facts: null fraction, distinct count and ratio, length summary and shapes. The card shows a dash for a column with no range.
- R11. Each column SHALL be **classified** by the first rule that matches:
  1. `unsupported`: semantic type `json` or `other` (arrays, struct, map, binary, interval, geometry, user-defined types). Strategy `null-only` when the column is nullable, else `constant`.
  2. `identifier`: the column is in the primary key, a unique key or a foreign key, or its type is `uuid`, or its name matches `/(^id$|_id$|^uuid$|_uuid$|guid)/i`, or its sample distinct ratio is at least 0.95 with at least 50 non-null values. A column is a foreign key when any declared foreign-key edge of the datasource has this table as its child, whether or not the parent table is in the profile; it also is one when an inferred relationship has both ends in the profile. Strategy `foreign-key` only for a foreign-key column whose parent table is in the profile (a usable relationship); else `sequence` for an integer type; else `uuid` for a uuid type or a uuid format rule; else `unique-pattern`. An identifier SHALL never be `categorical`.
  3. `boolean`: strategy `boolean-rate`.
  4. `numeric`: strategy `numeric-range`.
  5. `temporal`: strategy `temporal-range`.
  6. `formatted`: a text column with a format rule (`email`, `phone`, `url`, `uuid`, `date-string`). Strategy `format-template`.
  7. `categorical`: a text column with 1 to 20 distinct values in the sample **and** distinct values at most `max(20, 10 %` of the non-null sampled values`)`. Strategy `categorical`.
  8. `text`: every other text column. Strategy `words` when the mean length is above 40, else `pattern`.
- R12. The profile SHALL be kept **in memory only**: an in-process cache of at most 20 profiles, each kept 60 minutes from creation (`PROFILE_CACHE_MAX`, `PROFILE_TTL_MS`). The oldest-used profile SHALL be evicted first when the cache is full. Nothing SHALL be persisted, and a restart forgets every profile. The cache exists so that a script generated later comes from exactly the profile the user saw, without posting a large profile back (a 50-table profile can exceed the default JSON body limit, [../../system/api.md](../../system/api.md) G9).

Privacy
- R13. A profile SHALL hold real data values **only** for categorical columns: values seen at least 3 times in the sample, at most 20 per column, with their fractions in `topValues`; the share of rarer values is `otherFraction`. A column that is a key, an identifier or a formatted column SHALL never be categorical. Shapes SHALL carry character classes and lengths only: `A` for an uppercase letter, `a` for lowercase, `9` for a digit and `_` for whitespace per position, punctuation from the fixed set `-./:@#+,()'&` kept literally and any other character as `?`; runs are compressed to `class{min,max}`; the top 5 shapes by frequency are kept, and shapes seen fewer than 3 times are merged into a rare share. Serialising a profile SHALL contain none of the sampled values of any text, formatted or identifier column. The only other real values are the numeric and temporal extremes and quantiles of `numeric` and `temporal` columns (R10); identifier columns, numeric ones included, carry none.

The tab
- R14. The dataset editor's **Profile & synthesize** tab ([datasets](../datasets/spec.md) R48, R50) SHALL let the user pick tables (all checked by default, at most 50), profile a sample, cancel a running profile, and read one card per table with its sampling method and one row per column. Its note SHALL say that sampled statistics are approximate, that Data readiness scores use exact counts, and that nothing is stored and nothing is written to the datasource. Exact copy and test ids are in **UI**.
- R15. A profile request SHALL be refused, with the texts of **Edge cases and errors**, when the dataset is unknown, has no datasource or has a datasource of another kind, when a chosen table is not in the dataset, when more than 50 tables are chosen, or when the sample size is not a whole number from 1 to 1,000. A single table that cannot be sampled SHALL NOT fail the request: its card shows the error and its columns come from the catalog.
- R16. When the client disconnects (Cancel, or navigating away) the sampling run SHALL be aborted.

## Edge cases and errors

Exact texts of `POST /synthetic-data/profiles` ([../../system/api.md](../../system/api.md) 111), the first that applies, all Style B:

- 400 `datasetName is required`
- 404 `Dataset "<name>" not found`
- 400 `Dataset "<name>" has no datasource`
- 400 `Profiling a sample supports PostgreSQL and Databricks datasets only`
- 400 `tables must be an array of entity keys`
- 400 `"<key>" is not a table of dataset "<name>"`
- 400 `Choose at most 50 tables`
- 400 `sampleSize must be a whole number from 1 to 1,000`
- 404 `Datasource "<id>" not found`
- 502 with the connector's message when the datasource cannot be reached at all (the table list fails).

Other cases:
- A table that times out or fails: its card shows the error line, `sampledRows` is 0, and its columns are classified from their types alone.
- An empty sample (an empty table, or a failed read): every null fraction is 0, no statistics are computed, and each column gets a strategy from its type (R11).
- A table with an unknown estimate (PostgreSQL never analysed, `reltuples` of `-1`): read with `LIMIT`, never `COUNT(*)`; if fewer rows come back than requested, the method is `full`.
- A chosen table whose key names another catalog than the datasource's database (PostgreSQL): that table gets the error line `Table <key> is not in the datasource's database "<db>"`, `sampledRows` 0, and the other tables still profile (R15).
- A foreign key whose parent table is not in the profile (for example `orders.customer_code` referencing an unpicked `customers`): an identifier with strategy `sequence` or `unique-pattern` by type, never `categorical`, with no `topValues`.
- A view, foreign table or partitioned parent where sampling is refused: read with `LIMIT`, method chip `First 1,000 rows (sampling not supported here)`.
- A column of an unsupported type (array, struct, map, binary, interval, user-defined) gets `NULL` or the empty value as its strategy and the note `Type not synthesized: generated as NULL`.
- The profile expires after 60 minutes, or when the app restarts: the UI shows the expiry in the summary line, and the user profiles again. Re-profiling unchanged data gives the same sample (`REPEATABLE (7)`); `limit` reads depend on the engine's row order.
- The tab on a dataset whose datasource was deleted shows the server's message in the error block of R14.
- More than 50 tables checked: the Profile button is disabled with `Choose at most 50 tables.`.

## Contracts

- Endpoint: `POST /synthetic-data/profiles` (111), [../../system/api.md](../../system/api.md) 2.18. Nothing is stored, so there is no collection ([../../system/data-model.md](../../system/data-model.md) is unchanged).
- Decision: ADR-0037 in [../../system/architecture.md](../../system/architecture.md). Related: [../data-readiness/spec.md](../data-readiness/spec.md) (R29 unchanged), [../datasets/spec.md](../datasets/spec.md) R48 and R50 (the tab), [../datasources/spec.md](../datasources/spec.md) (the read-only guard).
- Backend module `backend/src/modules/synthetic-data/`; the sampler is `sampleTable` on the PostgreSQL and Databricks profilers, with its interface in `datasources/connectors/sampling.ts`. Layout: [../../system/tech-stack.md](../../system/tech-stack.md).
- Constants (`synthetic-data/limits.ts`, shared with the frontend mirror): `DATABRICKS_TABLESAMPLE_MAX_BYTES = 50 GiB` (backend only), `SAMPLE_SIZE_MAX = 1000`, `PROFILE_TABLES_MAX = 50`, `PROFILE_TTL_MS = 3_600_000`, `PROFILE_CACHE_MAX = 20`.

Request, `POST /synthetic-data/profiles`:

```ts
{ datasetName: string; tables?: string[]; sampleSize?: number }  // tables: entity keys; blank or left out = every table; sampleSize 1..1000, default 1000
```

Response `201`, shared types in `backend/src/modules/synthetic-data/types.ts` (frontend mirror `frontend/src/app/features/synthetic-data/models/synthetic-data.model.ts`):

```ts
import type { FormatRule, SemanticType } from '../data-readiness/engine/types';

export type SyntheticDialect = 'postgres' | 'databricks';
export type SampleMethod = 'full' | 'tablesample' | 'limit';
export type ColumnKind =
  | 'identifier' | 'categorical' | 'numeric' | 'temporal'
  | 'boolean' | 'formatted' | 'text' | 'unsupported';
export type SynthesisStrategy =
  | 'sequence' | 'uuid' | 'unique-pattern' | 'foreign-key'
  | 'categorical' | 'numeric-range' | 'temporal-range' | 'boolean-rate'
  | 'format-template' | 'pattern' | 'words' | 'null-only' | 'constant';

/** Statistics over the sampled rows. Every number is approximate. */
export interface SampledColumn {
  name: string;
  type: string;                 // declared type, exactly as the platform reports it
  semanticType: SemanticType;
  nullable: boolean;
  kind: ColumnKind;
  strategy: SynthesisStrategy;
  nullFraction: number;         // NULLs / sampled rows, 0..1, 4 decimals; 0 when nothing was sampled
  distinctCount: number;        // distinct non-null values in the sample
  distinctRatio: number;        // distinctCount / non-null sampled values, 0..1, 4 decimals
  numeric?: { min: number; max: number; mean: number; quantiles: number[] /* 11: p0, p10 … p100 */; integer: boolean; scale: number /* max decimals seen, ≤ 10 */ };
  temporal?: { min: string; max: string /* ISO, UTC */; quantiles: string[] /* 11 */; granularity: 'date' | 'second' | 'fraction' };
  boolean?: { trueFraction: number };
  length?: { min: number; max: number; mean: number; quantiles: number[] /* 11 */ };  // text, formatted, identifier text and categorical columns
  topValues?: { value: string; fraction: number }[];   // categorical only: seen >= 3 times, at most 20, most frequent first (ties by value)
  otherFraction?: number;       // categorical only: the share of non-null values not in topValues
  patterns?: { shape: string; fraction: number }[];    // character-class shapes (no data characters), at most 5, most frequent first
  formatRule?: FormatRule;
  note?: string;                // why the column is generated as it is, when not obvious (e.g. "Type not synthesized: generated as NULL")
}

export interface SampledTable {
  key: string;                  // entity key as stored in the dataset (catalog.schema.table; PostgreSQL database.schema.table)
  namespace: string;            // PostgreSQL schema; Databricks catalog.schema
  name: string;
  rowCountEstimate: number | null;   // reltuples (PostgreSQL) or Delta row count (Databricks); null when unknown
  sampledRows: number;
  method: SampleMethod;
  durationMs: number;
  error?: string;               // set when sampling failed; columns then come from the catalog only; connector text, never row data
  primaryKey: string[];         // [] when none declared
  uniqueKeys: string[][];
  columns: SampledColumn[];     // catalog order
}

export interface SampledRelationship {
  fromTable: string; fromColumns: string[];  // table = SampledTable.key
  toTable: string;   toColumns: string[];
  origin: 'declared' | 'inferred';
}

export interface SampledProfile {
  profileId: string;            // uuid; key in the in-memory cache
  version: 1;
  datasetName: string;
  datasourceId: string;
  datasourceName: string;
  dialect: SyntheticDialect;
  generatedAt: string;          // ISO
  expiresAt: string;            // ISO, generatedAt + 60 min
  sampleSize: number;           // rows requested per table (<= 1000)
  tables: SampledTable[];       // in the order requested
  relationships: SampledRelationship[];  // both ends among `tables`
}
```

## UI

Placement: the **Profile & synthesize** tab of the dataset editor, the third tab of a saved dataset ([../../system/ui.md](../../system/ui.md) 4.3 and 4.3a, [../datasets/spec.md](../datasets/spec.md) R48). A new (unsaved) dataset shows no tabs. A dataset on a `rest` datasource shows the tab with the empty-state text `Profiling a sample works for PostgreSQL and Databricks datasets.` and no controls.

- Tab: `data-testid="dataset-tab-synthesize"`, `id="dataset-tab-synthesize"`, lucide `FlaskConical`, panel `dataset-panel-synthesize`. The Left and Right arrow keys cycle over the three tabs.
- Component: `app-synthetic-data-panel` with the dataset as its input.
- Header: `h2` "Profile & synthesize". Note, 13 px `fg-muted`: `Sample up to 1,000 rows per table to see how the data looks, then generate a synthetic copy as a SQL script. Sampled statistics are approximate; Data readiness scores use exact counts. Nothing is stored and nothing is written to the datasource.`
- Table picker: a checkbox per table (`synth-table-<key>`, all checked), `Select all` and `Clear` (`synth-select-all`, `synth-select-none`), the count line `<n> of <m> tables` (`synth-table-count`), and, above 50 checked, a disabled Profile button with `Choose at most 50 tables.` (`synth-too-many`).
- **Profile sample** (`synth-profile`, primary). While it runs the button reads `Sampling <n> tables…` with a spinner and **Cancel** (`synth-cancel`) appears and aborts the request. On error, `synth-error` shows the server message verbatim, with **Retry**.
- Profile view (`synth-profile-view`): the summary line `<n> tables · sampled <relative time> · expires in <m> min` (`synth-profile-summary`) and one card per table (`synth-table-card-<key>`) with its method chip (`synth-method-<key>`: `Sampled 1,000 of ~2.3M rows`, `Read all 32 rows` or `First 1,000 rows (sampling not supported here)`; tooltip `TABLESAMPLE`, `full read` or `LIMIT`), the error line (`synth-table-error-<key>`), and a column table (`synth-col-<key>-<column>`) with Column, Type, Nulls %, Distinct, Range or length, Top values or patterns and Generated as. Top values show at most 5 with `+<k> more`; patterns show the shape in monospace. The chip text per strategy is in [../../system/ui.md](../../system/ui.md) 4.3a.
- The Generate form (`synth-generate-form`) arrives with roadmap 1.22.2.

## Flows

E2E: `frontend/e2e/synthetic-data.spec.ts` (only "Profile a sample of World Cup" is automated in this release; the other scenarios are not covered yet)

```gherkin
Feature: Synthetic data

  Scenario: Profile a sample of World Cup
    Given I open the "World Cup Core" dataset
    When I open the "Profile & synthesize" tab
    And I click "Profile sample"
    Then I see a card for "matches" whose method reads "Read all … rows"
    And the "stage" column shows the chip "Reuses" followed by a number of values

  Scenario: The tab sits third and the arrow keys cycle the three tabs
    Given I opened a saved dataset from the Datasets list
    Then I see the tabs "Schema", "Ontology" and "Profile & synthesize" with "Schema" selected
    When I focus the "Profile & synthesize" tab and press the Right arrow key
    Then the "Schema" tab is selected
    When I press the Left arrow key
    Then the "Profile & synthesize" tab is selected

  Scenario: A new dataset has no Profile & synthesize tab
    When I click "New dataset"
    Then I see the catalog browser and no "Profile & synthesize" tab

  Scenario: Choose which tables to sample
    Given I am on the "Profile & synthesize" tab of "World Cup" with every table checked
    When I click "Clear"
    Then I see "0 of <m> tables" and "Profile sample" is disabled
    When I check one table
    Then I see "1 of <m> tables" and "Profile sample" is enabled

  Scenario: Too many tables
    Given a dataset of more than 50 tables, every table checked
    Then I see "Choose at most 50 tables." and "Profile sample" is disabled

  Scenario: Cancel a running profile
    Given I clicked "Profile sample" and the sampling is still running
    When I click "Cancel"
    Then the request is aborted and I see "Profile sample" again
    And no profile view is shown

  Scenario: A table that cannot be sampled
    Given sampling one table of the dataset fails
    When I click "Profile sample"
    Then that table's card shows the error line
    And its columns are still listed
    And the other tables' cards show their samples

  Scenario: A server error is shown with Retry
    Given the profile request fails with "Datasource \"x\" not found"
    When I click "Profile sample"
    Then I see the message "Datasource "x" not found" and a "Retry" button

  Scenario: A REST dataset cannot be profiled
    Given a dataset on a REST datasource is open
    When I click the "Profile & synthesize" tab
    Then I see "Profiling a sample works for PostgreSQL and Databricks datasets."
    And I see no "Profile sample" button
```

## Acceptance

- Every Gherkin scenario above passes against the running app once automated; "Profile a sample of World Cup" passes in this release.
- Every error text in **Edge cases and errors** has a unit test at the controller or service level, and the cache has unit tests for expiry and eviction.
- Every classification rule of R11, the categorical rule (at least 3 sightings, at most 20 distinct values), the empty sample and the shapes of R13 have a unit test.
- **Privacy:** a fixture of 1,000 rows with names, emails and free text yields a profile whose serialisation contains none of the non-categorical sampled values; a second fixture with numeric identifier columns (`id`, `national_id bigint`, 1,000 unique values) yields a profile with none of their values and no numeric statistics on them.
- The SQL of each sampling tier of R4 and R5, the retry of R6 and the fall back to `LIMIT` have unit tests with fake clients.
- Readiness is untouched: its specs and scores are unchanged, and the diff of the two profilers adds only `sampleTable` and its private helpers.
- Not built yet (roadmap): the generator, the SQL script and its download, and the Data Readiness Agent's tools (1.22.2 to 1.22.4).

<!-- sources: backend/src/modules/synthetic-data/**, backend/src/modules/datasources/connectors/sampling.ts, backend/src/modules/datasources/connectors/postgres-profiling.ts, backend/src/modules/datasources/connectors/databricks-profiling.ts, frontend/src/app/features/synthetic-data/**, frontend/src/app/features/datasets/components/catalog-browser/** -->

# M1-22 — Sampled profiling and synthetic data: implementation plan

- **Epic:** M1-22 (repo only, no Jira key) · **Roadmap:** Milestone 1.22 · **Branch:** `feat/M1-22-synthetic-data` · **Epic spec:** [specs/epics/M1-22/spec.md](../../specs/epics/M1-22/spec.md)
- **Status:** Draft, written 2026-11-11 by the planner. This file is the **contract** every builder works from. Change it through the lead, never inside a unit.

## 0. The request and the decisions already made

> "I want to be able to profile the data by sampling them and also generate synthetic data that could be exported in the data source dialect."

1. **Where.** A **Profile & synthesize** tab in the dataset editor (pick tables, see the sampled profile, generate, download). The same capability is also given to the **Data Readiness Agent** as tools, so the user can ask for it in chat.
2. **Relation to readiness.** The sampled profile is **separate**. The readiness assessment stays exact (data-readiness R29: "Statistics SHALL be exact aggregates. No approximate count and no sampling is used"). That rule, the engine, the scoring and the readiness profiling statements do not change. The sampled profile is a new, faster, approximate view, and it is the only input to synthesis.
3. **Export.** A `.sql` script download: `CREATE TABLE` plus `INSERT` statements in the datasource's dialect (PostgreSQL or Databricks SQL), with a row count per table. Nothing is loaded into any datasource: the app stays read-only on datasources.
4. **Fidelity and privacy.**
   - Each column matches its distribution, null rate and format.
   - Primary and foreign keys stay consistent across the generated tables.
   - Real values are reused **only** for low-cardinality categorical columns (status codes and the like).
   - IDs, names, free text and every other high-cardinality value are never copied.

Defaults kept from the brief:
- up to 1,000 sampled rows per table, using native sampling;
- profiles computed on demand;
- a deterministic, seeded generator with no LLM inside;
- text generated from length and character-class patterns;
- 100 rows per table by default, at most 10,000.

Section 9 lists the two places where the code changed a default's detail.

## 1. What the code already gives us (read before building)

| Need | Existing code | Use |
|---|---|---|
| Table list, column types, nullability | `PostgresProfiler.tables()` / `DatabricksProfiler.tables()` (`backend/src/modules/datasources/connectors/*-profiling.ts`) | reuse unchanged |
| Declared PK / unique keys, FKs | `keys()`, `foreignKeys()` on the same profilers | reuse unchanged |
| Row count | `rowCount()` (Databricks: Delta metadata, cheap). PostgreSQL `COUNT(*)` can be slow, so the sampler reads `pg_class.reltuples` instead | Databricks reuse; PostgreSQL new estimate |
| Pooled sessions, abort, read-only transaction, 15 s statement timeout | `withSessions()` on both profilers (ADR-0033). The scoped copy is `Object.create(this)`, so **a new method added to the class runs on the scope's pooled session** | reuse; the new `sampleTable` is additive |
| Semantic type of a declared type | `classifyType`, `classifyDatabricksType` (`data-readiness/adapters/classify.ts`) | import, unchanged |
| Format rule from a column name | `detectFormatRule` (`data-readiness/adapters/format-rules.ts`) | import, unchanged |
| Inferred join candidates by naming | `inferJoinCandidates` (`data-readiness/engine/infer-joins.ts`, pure) | import, unchanged |
| Entity key ↔ (namespace, name) | `entityRefFromKey` (`data-readiness.service.ts`) | import, unchanged |
| Dataset → datasource and tables | `DatasetsService` (`DatasetDoc.datasourceId`, `datasourceKind`, `tables`, `entities` snapshot) | reuse |
| Tool → server bridge | `mastra/readiness-tool-services.ts` pattern, installed in `SessionsService.onModuleInit` | copy the pattern |
| File in the chat panel, downloadable | `show_in_panel` `file` items, `GET /sessions/:id/panel-items/:itemId/download` (api.md 107). `.sql` is already an allowed text extension; the limit is 256 KB | reuse for the agent path |
| Splitting a SQL script into statements | `splitSqlStatements` (`testing-data/sql-statements.ts`) | tests only |
| A real PostgreSQL in E2E | `frontend/e2e/helpers/world-cup-db.ts` (the `pg` client on 55432) | replay test |
| Blob download in the UI | `URL.createObjectURL` pattern (`session-panel.ts`) | copy |

The connectors' `sampleRows` (user/assistant path) is capped at 100 rows and uses `LIMIT` without sampling, so it is **not** reused. ADR-0031 keeps the profiling interface aggregate-only, so the sampler is a separate interface: the new ADR-0037 records this.

## 2. Architecture

```
dataset editor tab ──HTTP──▶ SyntheticDataController ─┐
Data Readiness Agent ─tools─▶ synthetic-data bridge ───┼─▶ SyntheticDataService
                                                      │     ├─ sample   (RowSampler on the profilers, pooled sessions)
                                                      │     ├─ profile  (pure: rows → SampledProfile; raw rows dropped)
                                                      │     ├─ cache    (in memory: profileId → SampledProfile, 20 entries, 60 min)
                                                      │     └─ script   (pure: profile + request → generator → dialect writer → lines)
```

### 2.1 Sampling (connectors, additive)

A new interface `RowSampler<TConfig>` lives in `datasources/connectors/sampling.ts`. `PostgresProfiler` and `DatabricksProfiler` each gain **one additive method**, `sampleTable`. Nothing that readiness calls changes, and `ProfilingConnector` and `fake-profiler.stub.ts` are untouched. The scoped copy from `withSessions` carries the new method, so a sampling run uses the same pooled sessions, abort handling and 15 s statement timeout. `withSamplingSessions(profiler, config, size, signal, fn)` (in `sampling.ts`) wraps `withSessions` and types the scope as `ScopedProfiler<T> & RowSampler<T>`.

Sampling method per table. The constants are `SAMPLE_SIZE = 1000` (the request may lower it, never raise it) and the oversampling factor 1.5, with `p = min(100, ceil(1.5 × SAMPLE_SIZE / estimate × 100 × 10⁴) / 10⁴)` percent:

| Dialect | Row estimate | Statement | `method` |
|---|---|---|---|
| PostgreSQL | `pg_class.reltuples` (no `COUNT(*)`); `-1` or missing = unknown | | |
| | ≤ 1,000 | `SELECT * FROM "s"."t" LIMIT 1000` | `full` |
| | 1,001 – 1,000,000 | `SELECT * FROM "s"."t" TABLESAMPLE BERNOULLI (p) REPEATABLE (7) LIMIT 1000` | `tablesample` |
| | > 1,000,000 | `… TABLESAMPLE SYSTEM (p) REPEATABLE (7) LIMIT 1000` | `tablesample` |
| | unknown, or a view, foreign table or partitioned parent where TABLESAMPLE errors | `SELECT * FROM "s"."t" LIMIT 1000` | `limit` |
| Databricks | `rowCount()` (a plain `COUNT(*)`, cheap on Delta) plus `DESCRIBE DETAIL` `sizeInBytes`; a timeout or error = unknown | | |
| | ≤ 1,000 | ``SELECT * FROM `c`.`s`.`t` LIMIT 1000`` | `full` |
| | > 1,000 and `sizeInBytes` < `DATABRICKS_TABLESAMPLE_MAX_BYTES` (50 GiB) | ``SELECT * FROM `c`.`s`.`t` TABLESAMPLE (p PERCENT) REPEATABLE (7) LIMIT 1000`` | `tablesample` |
| | `sizeInBytes` ≥ 50 GiB (live timing: 52 s cold on 160 GB) | ``SELECT * FROM `c`.`s`.`t` LIMIT 1000`` | `limit` |
| | unknown, or TABLESAMPLE refused (views) | ``SELECT * FROM `c`.`s`.`t` LIMIT 1000`` | `limit` |

- When a `tablesample` read returns fewer than half of `min(SAMPLE_SIZE, estimate)` rows, the sampler retries once with `p × 4`. The SYSTEM method is block-level and can come back short.
- On PostgreSQL every value comes back as **raw text**: a per-query `types: { getTypeParser: () => (v) => v }`. Without it `pg` parses `timestamp` into a JS `Date` in the host time zone, which shifts values on Windows. The client config is not touched, so readiness statements are unaffected.
- On Databricks every value is normalised to a string (`Date` → ISO, `bigint` → decimal text, objects → JSON).
- A statement that times out or fails leaves that table with `error` and `sampledRows: 0`. The profile still lists its columns (from `tables()`), with strategies from the types alone.
- Concurrency: `PROFILE_CONCURRENCY_BY_DIALECT` (shared with readiness, read-only import).
- **Raw rows never leave the service.** They are not logged, cached, persisted, put in an error message or sent to a model. The profile builder turns them into statistics, and the array is dropped when the request ends.

### 2.2 Profile builder (pure, `profile/`)

`buildSampledProfile(input: { dataset, datasource, tables: SampleOutcome[], keys, foreignKeys, now }) → Omit<SampledProfile, 'profileId'>` has no I/O. Per column it computes the statistics in section 3, then **classifies** the column (first rule that matches wins):

1. **unsupported**: semantic type `json`/`other` (arrays, struct, map, binary, interval, geometry, user-defined types). Strategy `null-only` when the column is nullable, else `constant` (the dialect's neutral value, see 2.5).
2. **identifier**: the column is in the PK, a unique key or an FK, or its type is `uuid`, or its name matches `/(^id$|_id$|^uuid$|_uuid$|guid)/i`, or its sample distinct ratio is ≥ 0.95 with ≥ 50 non-null values. Strategy:
   - `foreign-key` for an FK column whose parent table is in the profile;
   - else `sequence` for an integer type;
   - else `uuid` for a uuid type or a uuid format rule;
   - else `unique-pattern`.
   **Never** `categorical`.
3. **boolean**: strategy `boolean-rate`.
4. **numeric**: strategy `numeric-range`.
5. **temporal**: strategy `temporal-range`.
6. **formatted**: a text column with a format rule (`email`, `phone`, `url`, `uuid`, `date-string`). Strategy `format-template`.
7. **categorical**: a text column with 1 ≤ distinct ≤ 20 in the sample **and** distinct ≤ max(20, 10 % of the non-null sampled values). Only values seen **at least 3 times** in the sample go into `topValues`, with their fractions. The mass of the rarer values becomes `otherFraction` and is generated from `patterns`. Strategy `categorical`.
8. **text**: every other text column. Strategy `words` when the mean length is > 40, else `pattern`.

**Shapes** (`profile/shapes.ts`):
- Each non-null text value is mapped character by character: `A` for an uppercase letter, `a` for lowercase, `9` for a digit, `_` for whitespace. Punctuation from the fixed set `-./:@#+,()'&` is kept literally, and any other character becomes `?`.
- Runs are compressed to `class{min,max}` per position across the values that share the compressed run sequence. Examples: `Aa{2,9}_Aa{3,11}`, `999-99-9999`.
- The top 5 shapes are kept, by frequency. Shapes seen fewer than 3 times are merged into `rare` and generated from the dominant shape.
- A shape carries **classes and lengths only, never a letter or digit of the data**.

### 2.3 Profile cache (`profile-cache.ts`)

- An in-process LRU of at most **20** profiles, each kept **60 min** from creation.
- Nothing is persisted, and a restart forgets every profile. The generate endpoint answers 404 for a profile that expired, and the UI then asks the user to profile again.
- **Why a cache and not a round trip.** A profile of 50 tables can exceed the framework's default JSON body limit of about 100 kB (api.md G9). Re-sampling on generate would cost a second warehouse pass, and the script could then disagree with the profile the user saw.

### 2.4 Generator (pure, `generator/`)

`generateTables(profile, plan) → Generator<{ table, columns, rows: SyntheticValue[][] }>` is pure, synchronous and deterministic.

**Pseudo-random numbers** (`generator/prng.ts`):
- A seeded generator, sfc32, seeded by `hash32(seed, tableKey, columnName)` (FNV-1a over the UTF-8 bytes).
- Each column has its own stream, so adding a table or a column never changes another column's values.
- No `Math.random`, no `Date.now`, no locale-dependent formatting. Every number is formatted by our own code, never by `toLocaleString`.

**Order** (`generator/order.ts`):
1. Key columns are generated first for **every** table (PK and unique), so every FK value is drawn from a key set that already exists. That makes the insert order free and makes cycles harmless.
2. Tables are then emitted in a topological order of the FK graph (Kahn's algorithm, ties broken by table key). Tables in a cycle, and self-references, are emitted in key order.
3. The DDL creates every table **without** FK constraints. When `includeConstraints` is on, FK constraints are added with `ALTER TABLE … ADD CONSTRAINT` **after all inserts**, so cycles never block a load.

**Strategies** (`generator/values/*.ts`):
- `sequence`: 1..n, single-column integer keys.
- `uuid`: v4 from the PRNG.
- `unique-pattern`: the dominant shape filled from the PRNG, plus a base-36 counter suffix that makes the value unique within the table.
- `foreign-key`: a uniform draw from the parent's generated key set, with the column's null rate when it is nullable. A composite FK draws whole parent tuples.
  - A composite PK made of FK columns draws distinct tuples, rejecting duplicates up to 20 × n attempts.
  - When the requested row count exceeds the number of possible distinct tuples, the table is **clamped** to that number, and the script header says so.
- `categorical`: draws from `topValues` by fraction. With probability `otherFraction` it uses the `pattern` strategy instead.
- `numeric-range`: inverse-CDF over the 11 quantiles (p0, p10 … p100), uniform inside the chosen bucket, rounded to the observed `scale`, integer when `integer`.
- `temporal-range`: the same, over epoch milliseconds (UTC), formatted at the observed `granularity`.
- `boolean-rate`: true with `trueFraction`.
- `format-template`:
  - email `user<n>@example.com`, where `n` is the row number in base 10;
  - phone `+1-555-01<2 digits>-<4 digits>`;
  - url `https://example.com/<8 lowercase letters>`;
  - uuid v4;
  - date-string: an ISO date in the observed range.
  These use reserved example domains and numbers, never sampled text.
- `pattern`: a shape picked by frequency, each class filled from the PRNG (letters from the Latin alphabet, digits 0–9), with each run's length uniform in `{min,max}`.
- `words`: the target length is drawn from the length quantiles. The value is filled with words from a fixed built-in list of 200 neutral English words (`generator/words.ts`, data, not from the dataset) and cut to the length.
- `null-only` / `constant`: NULL / the dialect's neutral literal.
- **Null rate:** every non-key column is NULL with probability `nullFraction`. A NOT NULL column never gets NULL.

**Validation** (`generator/plan.ts`) turns a `ScriptRequest` into a `GenerationPlan`:
- row counts 1–10,000 per table, total ≤ 200,000;
- seed an integer 0 … 2³¹ − 1;
- `targetSchema`;
- FKs whose parent is not in the profile are listed in `droppedRelationships` (the column is still generated by its strategy, and no constraint is emitted).

### 2.5 Dialect writers (`dialects/`)

Both writers implement `DialectWriter` (section 3.3). The script is emitted as a **sequence of lines joined with `\n` (LF only, never CRLF), UTF-8 without BOM**.

| Concern | PostgreSQL | Databricks SQL |
|---|---|---|
| Header comment | `-- Synthetic data for dataset "<name>" (<datasource kind>), generated by Questions to Insights <version> on <ISO time>`; profile id, seed, row counts, sampled rows per table, dropped relationships, clamped tables, columns not synthesized. **No sampled value appears in the header.** | same |
| Identifier quoting | `"…"`, doubling `"` | `` `…` ``, doubling `` ` `` |
| Target | `CREATE SCHEMA IF NOT EXISTS "<target>";` then `"<target>"."<table>"` | `CREATE SCHEMA IF NOT EXISTS <target>;` where `<target>` is `` `schema` `` or `` `catalog`.`schema` `` |
| Table name | the source table name. If two selected tables in different source schemas share a name, both become `<schema>_<table>` (a deterministic rename, listed in the header) | same |
| Transaction | `BEGIN;` … `COMMIT;` around everything | none (Databricks has no multi-statement transaction); the header says a failed run may leave partial tables |
| `CREATE TABLE` | plain `CREATE TABLE` (no `IF NOT EXISTS`, no `DROP`), so running it twice fails loudly instead of mixing data; columns with `NOT NULL` as declared | `CREATE TABLE … (…) USING DELTA` |
| Types | the declared `format_type` text when its base type is in a built-in allow-list (integer family, numeric/decimal(p,s), real, double precision, money, text, varchar(n), char(n), boolean, date, time[stamp] [with/without time zone], interval, uuid, json, jsonb, bytea, and arrays of those); anything else (enum, domain, user type, extension type) becomes `text` with a header note | the declared `full_data_type` when its base type is in an allow-list (tinyint … bigint, float, double, decimal(p,s), string, varchar(n), char(n), boolean, date, timestamp, timestamp_ntz, binary, array<…>, map<…>, struct<…>); else `string` with a header note |
| Primary key | `PRIMARY KEY (…)` inline when `includeConstraints` | `CONSTRAINT <t>_pk PRIMARY KEY (…)` inline when `includeConstraints` (Unity Catalog only, informational; PK columns forced `NOT NULL`) |
| Unique keys | `UNIQUE (…)` inline when `includeConstraints` | not emitted (Databricks has no enforced UNIQUE); header note |
| Foreign keys | `ALTER TABLE … ADD CONSTRAINT "<t>_<cols>_fk" FOREIGN KEY (…) REFERENCES …;` after all inserts | `ALTER TABLE … ADD CONSTRAINT <t>_<cols>_fk FOREIGN KEY (…) REFERENCES …;` after all inserts (Unity Catalog, informational) |
| String literal | `'…'` doubling `'`; `standard_conforming_strings` assumed on (the default since 9.1, stated in the header). Generated text never contains control characters; the writer still rejects `\0` | `'…'` escaping `\` → `\\` then `'` → `\'` (Spark parses backslash escapes) |
| Numbers | as text, from our own formatter (no exponent; `NaN`/`Infinity` never generated) | same |
| Booleans | `TRUE` / `FALSE` | `TRUE` / `FALSE` |
| Dates and timestamps | `DATE '2024-01-31'`, `TIMESTAMP '2024-01-31 10:00:00'`, `TIMESTAMPTZ '…+00:00'` | `DATE'2024-01-31'`, `TIMESTAMP'2024-01-31 10:00:00'`, `TIMESTAMP_NTZ'…'` |
| uuid | `'…'::uuid` | `'…'` |
| Neutral literal for `constant` | json/jsonb `'{}'`, arrays `'{}'`, bytea `'\x'`, interval `'0'`, else `''` | array `array()`, map `map()`, binary `X''`, interval `INTERVAL 0 SECONDS`; a NOT NULL `struct` column is emitted as nullable and filled with NULL, with a header note (no `named_struct` is built) |
| INSERT batching | `INSERT INTO t (c1, …) VALUES (…),\n(…);` at most **500 rows** per statement | same, at most **500 rows** per statement |
| Order | header, schema, CREATE TABLEs (topological order), INSERTs (topological order), FK constraints, COMMIT | same, without COMMIT |
| Final line | ends with `\n` | ends with `\n` |

### 2.6 Agent tools (Data Readiness Agent)

Two new tools call the same `SyntheticDataService` through a bridge, `mastra/synthetic-data-tool-services.ts`, installed in `SessionsService.onModuleInit` like the readiness bridge. Their contract is in 3.5. The generate tool writes the script into the session workspace and stores a `file` panel item through the existing `showPanelItem` path, so the panel opens it and its Download works unchanged (api.md 107).

**Chat limits** (no agent-panel change):
- at most 20 tables and 1,000 rows per table;
- a script larger than 256 KB is refused with a message pointing to the dataset editor.

### 2.7 HTTP

The new module `synthetic-data` (controller prefix `/synthetic-data`) uses **Style B** errors (api.md 1.3): real HTTP statuses with the framework body. Neither endpoint streams events: profiling is a synchronous POST with a spinner, and the script is a streamed attachment body. When the client disconnects (the UI's Cancel, or navigating away) the request's `close` event aborts the sampling run, through the abort signal passed to `withSessions`.

## 3. The contract

### 3.1 Shared types — `backend/src/modules/synthetic-data/types.ts` (frontend mirror: `frontend/src/app/features/synthetic-data/models/synthetic-data.model.ts`)

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
  /** Declared type, exactly as the platform reports it. */
  type: string;
  semanticType: SemanticType;
  nullable: boolean;
  kind: ColumnKind;
  strategy: SynthesisStrategy;
  /** NULLs / sampled rows, 0..1, 4 decimals. 0 when nothing was sampled. */
  nullFraction: number;
  /** Distinct non-null values in the sample. */
  distinctCount: number;
  /** distinctCount / non-null sampled values, 0..1, 4 decimals. */
  distinctRatio: number;
  numeric?: { min: number; max: number; mean: number; quantiles: number[] /* 11: p0, p10 … p100 */; integer: boolean; scale: number /* max decimals seen, ≤ 10 */ };
  temporal?: { min: string; max: string /* ISO, UTC */; quantiles: string[] /* 11 */; granularity: 'date' | 'second' | 'fraction' };
  boolean?: { trueFraction: number };
  /** Text length (characters) of non-null values; text, formatted, identifier text and categorical columns. */
  length?: { min: number; max: number; mean: number; quantiles: number[] /* 11 */ };
  /** Categorical columns only: values seen ≥ 3 times, at most 20, most frequent first (ties by value). */
  topValues?: { value: string; fraction: number }[];
  /** Categorical only: the share of non-null values not in topValues. */
  otherFraction?: number;
  /** Character-class shapes (no data characters), at most 5, most frequent first. */
  patterns?: { shape: string; fraction: number }[];
  formatRule?: FormatRule;
  /** Why the column is generated as it is, when that is not obvious (e.g. "Type not synthesized: generated as NULL"). */
  note?: string;
}

export interface SampledTable {
  /** Entity key as stored in the dataset (`catalog.schema.table`; PostgreSQL `database.schema.table`). */
  key: string;
  /** PostgreSQL schema; Databricks `catalog.schema` (as the profilers flatten). */
  namespace: string;
  name: string;
  /** reltuples (PostgreSQL) or Delta row count (Databricks); null when unknown. */
  rowCountEstimate: number | null;
  sampledRows: number;
  method: SampleMethod;
  durationMs: number;
  /** Set when sampling failed; columns then come from the catalog only. Connector text, never row data. */
  error?: string;
  primaryKey: string[];          // [] when none declared
  uniqueKeys: string[][];
  columns: SampledColumn[];      // catalog order
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
  sampleSize: number;           // rows requested per table (≤ 1000)
  tables: SampledTable[];       // in the order requested
  relationships: SampledRelationship[];  // both ends among `tables`
}

export interface ScriptRequest {
  profileId: string;
  /** Per table key; tables left out use defaultRowCount. */
  rowCounts?: Record<string, number>;
  defaultRowCount?: number;     // default 100
  seed?: number;                // default 1
  targetSchema?: string;        // default "synthetic"
  includeConstraints?: boolean; // default true
}

/** What the script header and the agent tool report. */
export interface ScriptSummary {
  fileName: string;
  dialect: SyntheticDialect;
  seed: number;
  targetSchema: string;
  bytes: number;
  tables: { key: string; targetName: string; rows: number; clampedFrom?: number }[];
  droppedRelationships: SampledRelationship[];   // parent outside the profile
  notSynthesized: { table: string; column: string; reason: string }[];
  sha256: string;               // of the script bytes
}
```

Constants (`synthetic-data/limits.ts`, imported by the controller, the tools and the frontend mirror):
- `SAMPLE_SIZE_MAX = 1000`;
- `PROFILE_TABLES_MAX = 50` (chat: 20);
- `ROWS_PER_TABLE_DEFAULT = 100`;
- `ROWS_PER_TABLE_MAX = 10000` (chat: 1000);
- `SCRIPT_ROWS_MAX = 200000`;
- `INSERT_BATCH_ROWS = 500`;
- `PROFILE_TTL_MS = 3_600_000`;
- `PROFILE_CACHE_MAX = 20`;
- `CHAT_SCRIPT_BYTES_MAX = 262144`;
- `DEFAULT_SEED = 1`;
- `DEFAULT_TARGET_SCHEMA = 'synthetic'`;
- `TARGET_SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/`. Databricks also accepts `catalog.schema`, where both parts match.

### 3.2 Endpoints (api.md new section **2.18 Synthetic data**, numbers 111–112)

| # | Method + path | Purpose | FE |
|---|---|---|---|
| 111 | `POST /synthetic-data/profiles` | Sample a dataset's tables and return the sampled profile (kept 60 min in memory) | yes (Profile & synthesize tab) |
| 112 | `POST /synthetic-data/scripts` | Generate the synthetic `.sql` script from a profile | yes (Generate .sql) |

**111. `POST /synthetic-data/profiles`**
- Body: `{ datasetName: string; tables?: string[]; sampleSize?: number }`.
  - `tables` are entity keys of the dataset. Left out or empty, it means every table of the dataset.
  - `sampleSize` is 1–1000, default 1000.
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
  - A single table that cannot be sampled is **not** an error: it gets `error`.

**112. `POST /synthetic-data/scripts`**
- Body: `ScriptRequest`.
- Response `200`:
  - `Content-Type: application/sql; charset=utf-8`;
  - `Content-Disposition: attachment; filename="<dataset-slug>-synthetic-<dialect>-seed<seed>.sql"`, where the slug is as in api.md 14 and the dialect is `postgresql` or `databricks`;
  - `X-Script-Sha256: <hex>`;
  - `X-Script-Rows: <total>`.
  - The body is the script, streamed. Every input is validated **before** the headers are written.
- Errors (Style B), the first that applies:
  - 400 `profileId is required`
  - 404 `Profile "<id>" expired or not found: profile the tables again`
  - 400 `Row counts must be whole numbers from 1 to 10,000` (also for `defaultRowCount`, or a key not in the profile: `"<key>" is not a table of this profile`)
  - 400 `A script holds at most 200,000 rows`
  - 400 `seed must be a whole number from 0 to 2147483647`
  - 400 `targetSchema must be a plain identifier (letters, digits, underscores)`. Databricks: `targetSchema must be schema or catalog.schema (letters, digits, underscores)`.
- Determinism: the same profile and the same request give byte-identical scripts, apart from the header's `generated on` line. **The SHA-256 is computed without that line**, so the header line `-- sha256 (without this header line and the time line): <hex>` and `X-Script-Sha256` are stable.

### 3.3 Backend module layout and owners

```
backend/src/modules/synthetic-data/
  types.ts, limits.ts                         lead (contract; written before fan-out)
  synthetic-data.module.ts                    U-API
  synthetic-data.controller.ts                U-API
  synthetic-data.service.ts                   U-API   (profile(), script(), scriptToString() for the bridge)
  profile-cache.ts                            U-API
  profile/build-sampled-profile.ts            U-PROFILE
  profile/classify-column.ts                  U-PROFILE
  profile/shapes.ts                           U-PROFILE
  profile/stats.ts                            U-PROFILE  (quantiles, scale, granularity)
  generator/prng.ts, plan.ts, order.ts,
            generate.ts, words.ts, values/*.ts U-GEN
  dialects/writer.ts                          lead (interface below)
  dialects/postgres.writer.ts                 U-PGW
  dialects/databricks.writer.ts               U-DBW
  script.ts                                   U-GEN  (header + order + batching → lines; calls a DialectWriter)
backend/src/modules/datasources/connectors/
  sampling.ts                                 U-SAMPLE (RowSampler, SampleOutcome, withSamplingSessions)
  postgres-profiling.ts  (+ sampleTable only) U-SAMPLE
  databricks-profiling.ts (+ sampleTable only) U-SAMPLE
backend/src/app.module.ts (register module)   U-API
backend/src/mastra/synthetic-data-tool-services.ts, tools/synthetic-data.tools.ts  U-TOOLS (story 1.22.4)
backend/src/mastra/tools/readiness.tools.ts (append 2 tools to readinessTools)      U-TOOLS
backend/src/mastra/agents/system-prompts.ts (DATA_READINESS_PROMPT) + shipped-agent-prompts.ts + __fixtures__/data-readiness-prompt.*.txt  U-TOOLS
backend/src/mastra/evals/data-readiness.evals.ts (+2 cases), data-readiness-eval-checks.ts            U-TOOLS
backend/src/modules/sessions/sessions.service.ts (install bridge)                                    U-TOOLS
```

```ts
// datasources/connectors/sampling.ts
export interface SampleOutcome {
  namespace: string; table: string;
  rowCountEstimate: number | null;
  method: SampleMethod;
  columns: string[];
  rows: Record<string, string | null>[];   // raw text values; never leaves the service
  durationMs: number;
  error?: string;
}
export interface RowSampler<TConfig> {
  sampleTable(config: TConfig, namespace: string, table: string,
              opts: { sampleSize: number; repeatableSeed: number /* 7 */ }): Promise<SampleOutcome>;
}

// dialects/writer.ts
export type SyntheticValue =
  | null | boolean | string                     // string: already-formatted text for text/uuid/numeric
  | { kind: 'number'; text: string }            // decimal text, no exponent
  | { kind: 'date'; text: string }              // YYYY-MM-DD
  | { kind: 'timestamp'; text: string; zoned: boolean }  // YYYY-MM-DD HH:MM:SS[.ffffff][+00:00]
  | { kind: 'neutral' };                        // the dialect's neutral literal for the column type
export interface WriterColumn { name: string; ddlType: string; notNull: boolean; source: SampledColumn }
export interface WriterTable  { key: string; targetName: string; columns: WriterColumn[]; primaryKey: string[]; uniqueKeys: string[][] }
export interface DialectWriter {
  readonly dialect: SyntheticDialect;
  quoteIdent(name: string): string;
  qualify(targetSchema: string, table: string): string;
  /** Declared type → DDL type, with a note when replaced. */
  ddlType(column: SampledColumn): { ddl: string; note?: string };
  literal(value: SyntheticValue, column: WriterColumn): string;
  begin(): string[]; end(): string[];          // PostgreSQL BEGIN/COMMIT; Databricks []
  createSchema(targetSchema: string): string;
  createTable(targetSchema: string, table: WriterTable, includeConstraints: boolean): string;
  insert(targetSchema: string, table: WriterTable, rows: SyntheticValue[][]): string;  // ≤ 500 rows
  addForeignKey(targetSchema: string, rel: SampledRelationship, from: WriterTable, to: WriterTable): string;
  headerNotes(): string[];                     // dialect caveats for the header
}
```

### 3.4 UI flow, copy and test ids (dataset editor)

The dataset editor of a **saved** dataset gets a third tab: **Schema · Ontology · Profile & synthesize**.
- Tab: `data-testid="dataset-tab-synthesize"`, `id="dataset-tab-synthesize"`, lucide `FlaskConical`, panel `dataset-panel-synthesize`.
- Arrow keys cycle over the three tabs (today `otherTab` toggles between two).
- A new (unsaved) dataset still shows no tabs.
- A dataset on a `rest` datasource shows the tab with the empty-state text `Profiling a sample works for PostgreSQL and Databricks datasets.` and no controls.

The panel is the component `app-synthetic-data-panel` (`frontend/src/app/features/synthetic-data/components/synthetic-data-panel/`), input `dataset: Dataset`.

1. **Header:** `h2` "Profile & synthesize". Note, 13 px `fg-muted`: `Sample up to 1,000 rows per table to see how the data looks, then generate a synthetic copy as a SQL script. Sampled statistics are approximate; Data readiness scores use exact counts. Nothing is stored and nothing is written to the datasource.`
2. **Table picker:**
   - one checkbox per table of the dataset (`synth-table-<key>`), all checked by default;
   - `Select all` / `Clear` (`synth-select-all`, `synth-select-none`);
   - the count line `<n> of <m> tables` (`synth-table-count`);
   - more than 50 checked disables Profile and shows `Choose at most 50 tables.` (`synth-too-many`).
3. **Profile sample** button (`synth-profile`, primary).
   - While it runs, the button reads `Sampling <n> tables…` with a spinner, and a **Cancel** button appears (`synth-cancel`, which aborts the HTTP request).
   - On error: `synth-error`, showing the server message verbatim, with **Retry**.
4. **Profile view** (`synth-profile-view`):
   - Summary line (`synth-profile-summary`): `<n> tables · sampled <relative time> · expires in <m> min`.
   - One card per table (`synth-table-card-<key>`):
     - name;
     - a method chip (`synth-method-<key>`): `Sampled 1,000 of ~2.3M rows`, `Read all 32 rows`, or `First 1,000 rows (sampling not supported here)`, with a tooltip `TABLESAMPLE`, `full read` or `LIMIT`;
     - the error line (`synth-table-error-<key>`) when it failed.
   - Column table: one row per column, `synth-col-<key>-<column>`. Its columns are Column, Type, Nulls %, Distinct, Range or length, Top values or patterns, Generated as.
     - **Generated as** is a chip per strategy, with copy from the table below.
     - Top values show at most 5, with `+<k> more`.
     - Patterns show the shape in monospace.
5. **Generate** (`synth-generate-form`), shown once a profile exists:
   - a **Rows per table** number input per table (`synth-rows-<key>`, default 100, 1–10,000), plus an **All tables** input and **Apply** (`synth-rows-all`, `synth-rows-apply`);
   - **Seed** (`synth-seed`, default 1, with the hint `Same profile and seed give the same script.`);
   - **Target schema** (`synth-target-schema`, default `synthetic`);
   - **Include keys and constraints** (`synth-include-constraints`, checked);
   - the **Generate .sql** button (`synth-generate`), which downloads `<file name>`;
   - success toast: `Downloaded <file name>`;
   - expired profile (404): the inline message `This profile expired. Profile the tables again.` (`synth-expired`), with the Profile button focused;
   - invalid input: an inline message under the field, with the server text.

**Generated as** copy per strategy:

| Strategy | Chip text |
|---|---|
| `sequence` | Sequence 1…n |
| `uuid` | Random UUIDs |
| `unique-pattern` | Unique values like the pattern |
| `foreign-key` | Keys of `<parent table>` |
| `categorical` | Reuses <k> values |
| `numeric-range` | Numbers in the observed range |
| `temporal-range` | Dates in the observed range |
| `boolean-rate` | True <p> % |
| `format-template` | Example emails, phones, URLs, UUIDs or dates (per rule) |
| `pattern` | Text like the pattern |
| `words` | Placeholder words |
| `null-only` | NULL (type not synthesized) |
| `constant` | Empty value (type not synthesized) |

Frontend files and owners (U-UI):
- `features/synthetic-data/{models/synthetic-data.model.ts, services/synthetic-data-api.service.ts, components/synthetic-data-panel/*, components/sampled-table-card/*}`.
- `catalog-browser.{ts,html}`: the third tab only. U-UI owns them in 1.22.1. **No other unit touches them.**
- The `@demo` Playwright test is `frontend/e2e/synthetic-data.spec.ts`, owned by U-E2E. Its tags are `@demo @story-1.22.1` (and `@story-1.22.2` on the generate scenario).

### 3.5 Agent tools (story 1.22.4)

Both tools follow the readiness tools' conventions (agents.md 3.13):
- scalar inputs only, each `.describe()`d (retrospective 1.13.9: no arrays of objects);
- the same **dataset resolution** rules;
- nothing throws to the model: every failure is `{ error }`.

| Tool | Description (first sentence) | Input | Output (what the model sees) |
|---|---|---|---|
| `profile_data_sample` | Sample up to 1,000 rows of each table of one of this session's datasets and return an approximate profile: types, null rates, distinct counts, ranges, categorical values and text patterns. | `dataset?: string`; `tables?: string` (entity keys or table names, one per line; blank = every table, at most 20) | `{ profileId, datasetName, dialect, expiresAt, tables: [{ table, method, sampledRows, rowCountEstimate, error?, columns: [{ name, type, nullPct, distinct, kind, generatedAs, range?, topValues? (≤ 5), pattern? }] }], relationships: [{ from, to, origin }] }`; at most 40 columns per table in this projection (`columnsOmitted: n` when more) |
| `generate_synthetic_data` | Generate a synthetic copy of one of this session's datasets as a SQL script in its datasource's dialect, save it in the session and show it in the panel for download; it never writes to the datasource. | `dataset?: string`; `tables?: string` (as above); `rowsPerTable?: integer` (1–1,000, default 100); `seed?: integer` (default 1); `targetSchema?: string` (default `synthetic`); `profileId?: string` (reuse a profile from `profile_data_sample`; blank = profile now) | `{ fileName, path, panelItemId, dialect, seed, targetSchema, bytes, tables: [{ table, rows }], droppedRelationships: [...], notSynthesized: [...] }` |

- **Errors (exact, beyond dataset resolution):**
  - `Synthetic data supports PostgreSQL and Databricks datasets only`
  - `"<name>" is not a table of dataset "<dataset>"`
  - `Choose at most 20 tables in chat; use Profile & synthesize on the dataset for more`
  - `rowsPerTable must be a whole number from 1 to 1,000 in chat`
  - `The script would be <n> KB; the chat limit is 256 KB. Ask for fewer rows or use Profile & synthesize on the dataset.`
  - the endpoint texts of 3.2 for the rest.
- **File:** `synthetic-data/<dataset-slug>-synthetic-<dialect>-seed<seed>.sql` in the session workspace. A second call with the same name overwrites it, and the panel item is new.
- **Panel:** the bridge stores a `file` panel item titled `Synthetic data — <dataset> (seed <seed>)`, and the orchestrator emits `panel-item` as for `show_in_panel` (agents.md 3.11).
- **Prompt changes (Appendix D):**
  - D12 (scope) gains a sentence: profiling a sample of the session's data and generating a synthetic copy are in scope.
  - New rule D14, three lines: for a sample profile or synthetic data, call `profile_data_sample` / `generate_synthetic_data`. Sampled numbers are approximate and never readiness scores, so they are never mixed with or used to change a score. Synthetic scripts are never run against the datasource; the user downloads them from the panel.
  - The `## Tools` section regenerates by itself.
  - The skill stays as it is: no new skill (the tool descriptions and D14 are enough; measure the prompt delta from the compiled agent per retrospective 1.14.1).

## 4. ADR (draft for architecture.md; written into it in story 1.22.1, step 4)

#### ADR-0037 — Sampled profiling and synthetic data: a separate, approximate profile read from row samples, and a deterministic generator that writes a SQL script; the app stays read-only on datasources
- **Status:** Proposed
- **Date:** 2026-11-11
- **Context:**
  - The user asked on 2026-11-11 to profile data by sampling and to generate synthetic data exported in the datasource's dialect.
  - Readiness profiling (ADR-0031, ADR-0033) is aggregate-only and exact, and data-readiness R29 forbids sampling there. Its interface "reads no row values".
  - Synthesis needs value-level information that aggregates do not give: shapes of text, quantiles, categorical frequencies.
  - The app is read-only on datasources.
- **Decision:**
  - **A second, separate profile.** A new `RowSampler` interface is implemented additively by the PostgreSQL and Databricks profilers.
    - It reads up to 1,000 rows per table with the engine's native `TABLESAMPLE … REPEATABLE`. Small tables are read whole, and tables where TABLESAMPLE is refused fall back to `LIMIT`.
    - It reuses the profilers' pooled read-only sessions, statement timeout and abort.
    - Readiness profiling, the engine and its scores are unchanged, and a sampled statistic never feeds a readiness score.
  - **Raw rows stay in the request.** A pure builder turns them into a `SampledProfile`.
    - The profile holds statistics, character-class shapes and only the categorical values seen at least 3 times in columns of at most 20 distinct values.
    - The rows are never logged, cached, persisted or sent to a model.
    - The profile is kept in memory for 60 minutes (20 at most) so a script can be generated from exactly what the user saw. It is never persisted.
  - **A deterministic generator with no model.** Seeded per column, keys generated first so FKs always resolve, constraints added after the inserts so FK cycles load.
  - **One dialect writer per platform** emits a UTF-8, LF-only script: `CREATE SCHEMA`, `CREATE TABLE`, batched `INSERT`, FK constraints. It is downloaded by the user.
    - The app never executes it. The datasource connections keep their read-only guard, and no write path is added.
  - **Agents reach the same service through a tool bridge.** The Data Readiness Agent gets two tools. The script reaches the user as a session file in the panel.
- **Rejected:**
  - Sampling inside readiness profiling: it would make readiness scores approximate and unrepeatable, contrary to R29.
  - Exposing sampled rows to the LLM or letting an LLM generate the data: unrepeatable, it leaks values, and it is costly.
  - Loading synthetic data into a datasource: it breaks the read-only guarantee and needs write credentials.
  - A third-party fake-data library (faker): it adds a dependency and locale-dependent output, and it has no notion of the observed shapes. A small built-in word list is enough.
  - Round-tripping the profile in the generate request: it exceeds the default JSON body limit (api.md G9) on wide datasets.
  - Persisting profiles: not needed, and it would store more data about the user's tables.
- **Consequences:**
  - Sampled statistics are approximate, and the UI says so next to every profile.
  - `TABLESAMPLE` cost and behaviour differ per engine and per table kind, and must be timed live (Databricks especially).
  - Databricks PK and FK constraints are informational and need Unity Catalog. The script header says so, and the constraints can be switched off.
  - The Data Readiness Agent's prompt and tools change, so its eval set must pass at 100 % over 3 runs.
  - Stack-neutral: a rebuild needs a sampler per dialect, the pure profile builder, the generator, a writer per dialect, two endpoints, one UI tab and two tools.

## 5. Specs to change (step 5, per story)

| Spec | Change | Story |
|---|---|---|
| **new** `specs/capabilities/synthetic-data/spec.md` | The capability: rules R1… (sampling methods, profile contents, classification, privacy rules, cache/expiry, generator strategies, determinism, dialect output, limits, UI tab, agent tools), edge cases with exact messages, contracts, UI, Gherkin `Feature: Synthetic data` with `E2E: \`frontend/e2e/synthetic-data.spec.ts\``, acceptance | 1.22.1 (profile rules, Feature skeleton), 1.22.2 (generator + PostgreSQL), 1.22.3 (Databricks), 1.22.4 (agent) |
| `specs/README.md` | capability row `synthetic-data` | 1.22.1 |
| `specs/system/architecture.md` | ADR-0037; a note on ADR-0031 ("profiling reads no row values" holds for readiness profiling; row samples are read only by the sampler of ADR-0037); C4 component list adds the synthetic-data module | 1.22.1 |
| `specs/system/api.md` | new 2.18 with #111 (1.22.1) and #112 (1.22.2); 1.3 Style B list; 1.4 (#112 returns 200 and writes itself) | 1.22.1, 1.22.2 |
| `specs/system/ui.md` | 4.3: three tabs, the arrow-key cycle; new 4.3a "Profile & synthesize tab" with the testids and copy of 3.4 | 1.22.1, 1.22.2 |
| `specs/capabilities/datasets/spec.md` | R48: three tabs and the new testid; a new R50: the tab acts on the saved dataset, by name | 1.22.1 |
| `specs/capabilities/data-readiness/spec.md` | **R29 unchanged.** A sentence under Concepts: the sampled profile of [synthetic-data] is separate and never feeds a score. R3: the two tools added to the tool list | 1.22.1 (concept note), 1.22.4 (R3) |
| `specs/system/agents.md` | 2.10: tools list, D12 widened, D14, Appendix D; new 3.14 "Synthetic-data tools" (table of 3.5, bridge, errors); 3.13's "Profiling reads no row values" scoped to readiness profiling | 1.22.4 |
| `specs/system/data-model.md` | Session workspace files: `synthetic-data/*.sql` (4.x); "Profiles live only in memory" note (like deep-analysis jobs) | 1.22.2 (memory note), 1.22.4 (workspace file) |
| `specs/product/glossary.md` | **Sampled profile**, **Synthetic data script** | 1.22.1, 1.22.2 |
| `specs/capabilities/agents-evals/spec.md` | only if the hub's tool count text names the Data Readiness tools (grep first) | 1.22.4 |
| `specs/system/tech-stack.md` | the new backend module and frontend feature folders | 1.22.1 |

## 6. Stories (dependency order; each one is a fast loop the user tests by hand)

| ID | Title | UI | Scope in one line |
|---|---|---|---|
| 1.22.1 | Sampled profile in the dataset editor | UI | sampler on both dialects, pure profile builder, cache, `POST /synthetic-data/profiles`, the third tab with table picker and profile view; ADR-0037 |
| 1.22.2 | Synthetic data script for PostgreSQL | UI | the generator, the PostgreSQL writer, `POST /synthetic-data/scripts`, the Generate form and download; replay into a scratch PostgreSQL database proves it loads |
| 1.22.3 | Databricks SQL script | no-UI (backend; the button exists) | the Databricks writer; a Databricks dataset's Generate now downloads a Databricks SQL script; golden tests plus a live check |
| 1.22.4 | Profile and synthesize from the Data Readiness Agent | UI (chat + panel) | `profile_data_sample` and `generate_synthetic_data`, the bridge, the prompt (D12, D14), the panel file item, 2 eval cases; the Data Readiness evals at 100 % at the gate |

The agent tools ship **as their own, last story (1.22.4)**, so the eval cost is paid once, after the service has settled. Re-running the 9 existing plus 2 new cases × 3 runs on the branch, and the flipped cases on `main`, costs about 11 × 3 × 2 turns plus judge calls. Check provider credit first (retrospective 1.14). The three earlier stories do not touch the agent, its prompt, tools or skills, so no eval run is due for them: hash the compiled prompt and tool list against `main` to prove it (retrospective 1.13.13).

Between 1.22.2 and 1.22.3, `POST /synthetic-data/scripts` for a Databricks profile answers 400 `Synthetic scripts for Databricks datasets arrive in the next update`. That line and its test are deleted in 1.22.3.

### 1.22.1 — Sampled profile in the dataset editor (UI)
- **Prerequisite (lead, before fan-out):** write `types.ts`, `limits.ts`, `dialects/writer.ts` (the interface only) and the `sampling.ts` interface from this contract, and commit them on the epic branch.
- **Live timing first** (retrospective 1.20, "time it live on one small and one large real table before integration"):
  - Run the four sampling statements of 2.1 by hand, through a scratch script using the profilers.
  - Targets: World Cup `world_cup.players` (small) and the largest US Health table on PostgreSQL; on the user's Databricks warehouse, one small table and `tpch.lineitem` (or the largest table the user names).
  - Record the times in `evidence/1.22.1/sampling-timings.md`.
  - **Gate:** a Databricks `TABLESAMPLE (p PERCENT)` over 15 s on the large table means switching that tier to `LIMIT` (method `limit`) before integration, and recording the change in the plan.
- **Units:**
  - **U-SAMPLE** (Sonnet): `sampling.ts`, `sampleTable` in both profilers, unit specs with fake clients (the SQL per tier, the retry, the fallback on a TABLESAMPLE error, raw-text values, timeouts → `error`). Checks: `npx jest datasources/connectors`; readiness specs unchanged and green.
  - **U-PROFILE** (Sonnet): `profile/*`, specs covering every classification rule, the k ≥ 3 categorical rule, shapes never carrying data characters, quantiles/scale/granularity, the empty sample. **Privacy spec:** a fixture of 1,000 rows with names, emails and free text; `JSON.stringify(profile)` contains none of the non-categorical sampled values.
  - **U-API** (Sonnet): module, controller (#111 only), service `profile()`, cache with injected clock, `app.module.ts`. Specs: every #111 error text, cache TTL and LRU eviction, abort on client close.
  - **U-UI** (Sonnet): the tab, `app-synthetic-data-panel`, picker, profile view (3.4). Unit specs: tab cycle, picker limits, method chip copy, strategy chip copy, error and cancel states.
  - **U-E2E** (Sonnet): `frontend/e2e/synthetic-data.spec.ts`, scenario `@demo @story-1.22.1` "Profile a sample of World Cup", with `scenarioStep` captions: open World Cup → Profile & synthesize → Profile sample → a card per table with method `Read all … rows` and a column showing `Reuses <k> values`.
  - **U-SPECS** (Sonnet): every spec row for 1.22.1 in section 5, from this contract. Writes ADR-0037 into architecture.md.
- **Integration (lead):**
  - merge the units;
  - `node scripts/qa.mjs 1.22.1 --fast --base HEAD`;
  - `node scripts/demo-page.mjs 1.22.1` → artifact;
  - hand over the app plus the demo link.

### 1.22.2 — Synthetic data script for PostgreSQL (UI)
- **Units:**
  - **U-GEN** (Opus or Sonnet at high effort: cross-cutting judgment): `generator/*`, `script.ts`. Specs:
    - determinism (same input → same SHA-256 across 2 runs; a different seed → a different hash);
    - stream isolation (adding a table leaves the other tables' rows identical);
    - every strategy's distribution within tolerance on 10,000 rows (null rate ± 2 pp, categorical fractions ± 3 pp, numeric within [p0, p100]);
    - FK values ⊆ parent keys, including composite keys and a 2-table cycle and a self-reference;
    - clamping;
    - total-rows limit.
    **Run it first** (retrospective 1.19): the unit's first commit generates World Cup rows from a hand-written profile fixture and prints counts, before the remaining strategies are added.
  - **U-PGW** (Sonnet): `postgres.writer.ts`. Inline expected strings, **no golden fixture files** (CRLF: retrospective 0.4.5, 1.21): quoting of `"` in identifiers, `'` in literals, type allow-list and fallback, batching at 500, `BEGIN`/`COMMIT`, FK `ALTER`s at the end, no `\r` anywhere, a trailing `\n`.
  - **U-API2** (Sonnet): #112 in the controller and service, the streamed attachment, headers, every error text, the temporary Databricks 400.
  - **U-UI2** (Sonnet): the Generate form and download in `app-synthetic-data-panel` (sole owner of that component in this story), the expired-profile state, the success toast.
  - **U-E2E2** (Sonnet): in `synthetic-data.spec.ts`, a new `describe('Generate')` (U-E2E2 owns the file in this story).
    - `@demo @story-1.22.2` "Generate a PostgreSQL script": profile → rows 25 → Generate .sql → assert the download's file name and that its first line starts `-- Synthetic data for dataset "World Cup"`.
    - An **API-level replay test**:
      1. `POST /synthetic-data/profiles` for World Cup;
      2. `POST /synthetic-data/scripts` with seed 1 and 50 rows per table;
      3. create the scratch database `synthetic_replay_<pid>_<n>` through `world-cup-db.ts`'s client;
      4. run the script there (one `client.query(script)`, simple protocol);
      5. assert each table's `COUNT(*)` equals the requested rows (or the clamp), and that the FK constraints exist (`pg_constraint`), which proves every FK value resolved;
      6. run step 2 again → the same `X-Script-Sha256`;
      7. drop the database in `finally`.
  - **U-SPECS2** (Sonnet): the spec rows for 1.22.2.

### 1.22.3 — Databricks SQL script (no-UI)
- **U-DBW** (Sonnet): `databricks.writer.ts`, with inline expected strings for backtick quoting, `\`/`'` escaping, typed literals (`DATE'…'`, `TIMESTAMP_NTZ'…'`), `USING DELTA`, informational constraints, no `BEGIN`/`COMMIT`, `catalog.schema` targets.
- **Statement smoke:** each emitted statement passes through a small recursive-descent check of balanced quotes, backticks and parentheses.
- **U-API3** removes the temporary 400.
- **Live check:** see open question Q1. The result goes in `evidence/1.22.3/databricks-run.md`. The fast-loop demo is `demo.txt` (no UI scenario): the qa run prints the head of a Databricks script generated from a recorded profile fixture.
- **U-SPECS3**: the capability rules for Databricks output; ADR consequences if anything changed.

### 1.22.4 — Profile and synthesize from the Data Readiness Agent (UI: chat + panel)
- **U-TOOLS** (Sonnet at high effort): the bridge, the two tools, the `readinessTools` order (the three readiness tools, the two synthetic tools, `describe_entity`, `run_readonly_sql`, `show_in_panel`, `ask_clarification`), the prompt (D12, D14), the shipped-prompt fixtures, the bridge install, and the unit specs:
  - dataset resolution;
  - scalar `tables` parsing (keys or bare names, one per line, blanks ignored);
  - each limit's exact text;
  - the 256 KB refusal;
  - the panel item stored;
  - the model-facing projection capped at 40 columns.
  Also the 2 eval cases:
  - `dr-profile-sample` ("profile a sample of World Cup's players table": calls `profile_data_sample`, quotes only tool numbers, never calls `assess_data_readiness`, never calls a sampled number a score);
  - `dr-synthetic-script` ("give me 50 synthetic rows per table for World Cup": calls `generate_synthetic_data` with `rowsPerTable` 50, answers with the file name and says it is in the panel, does not run SQL).
  Checks written against the **model-facing projection** (retrospective 1.16).
- **U-E2E4** (Sonnet): `synthetic-data.spec.ts` `describe('Chat')`, `@demo @story-1.22.4`, with the recording LLM stub driving one `generate_synthetic_data` call; asserts the panel shows the file and Download returns `.sql`. It also runs the existing `data-readiness.spec.ts` as is.
- **U-SPECS4**: agents.md and data-readiness R3.
- **Prompt delta:** measured from `dataReadinessInstructions()` before and after, recorded in the roadmap notes.

## 7. Risks and open questions

- **Sampling performance on Databricks.**
  - `TABLESAMPLE (p PERCENT)` on Delta may still scan many files, and `COUNT(*)` on a **view** is a full scan.
  - Mitigation: the live timing gate in 1.22.1, the 15 s statement timeout per table (a table that times out gets `error`, the rest continue), views going straight to `limit` when the table kind says view, and concurrency per dialect.
  - Note that `TABLESAMPLE (n ROWS)` is **not** used: in Spark it behaves as a limit, not a random sample.
- **PostgreSQL `reltuples` is stale or −1** on tables never analysed. Unknown means `limit`, never `COUNT(*)` (a `COUNT(*)` on a large PostgreSQL table can take minutes).
- **Privacy.**
  - Guaranteed by construction: only categorical values (≤ 20 distinct, each seen ≥ 3 times, not key, identifier or format columns) are ever reused. Shapes carry no data characters, and format templates use reserved example domains and numbers.
  - Tested by the U-PROFILE privacy spec (the profile holds no non-categorical sample value).
  - Also tested by a generator spec: on a fixture whose sample is known, no generated value of a non-categorical text column equals a sampled value. An accidental match on very short shapes (2-letter codes that were not categorical) is possible and is stated in the spec, not hidden.
  - Numeric and temporal min/max are real extremes. They are shown in the profile, and generated values can equal them. This is accepted, and stated in R-text.
- **Determinism.**
  - The generator is deterministic. Sampling is repeatable only while the table is unchanged (`REPEATABLE (7)`), and `limit` reads depend on the engine's row order.
  - So the promise is "same profile + same request → same script", made testable by `X-Script-Sha256`.
  - Node version differences: no floating-point formatting through `toString` of non-integers. Our own decimal formatter rounds with integer arithmetic at the column's scale.
- **Dialect correctness.**
  - PostgreSQL is proven by the replay test (1.22.2) on every gate run.
  - Databricks has no CI warehouse. It relies on golden and smoke tests plus one live run (Q1). Unity Catalog constraints fail on `hive_metastore`, which the **Include keys and constraints** switch addresses.
- **Windows.**
  - The script is LF-only. Tests assert `!script.includes('\r')`.
  - No golden `.sql` fixture files: expected text lives inline in specs, or a fixture is read with `.replace(/\r\n/g, '\n')`.
  - Any new `*.sql` fixture gets a `.gitattributes` `eol=lf` line.
  - Helper scripts are written with the Write tool. Regexes are edited only with the Edit tool and pipe-tested (retrospective 1.21.12).
  - Use `py -3`.
- **Memory.** 200,000 rows are generated lazily, table by table, and the script is streamed in batches of 500 rows, never built whole on the HTTP path. The agent path builds it whole, but it is capped at 256 KB.
- **The default JSON body limit** is not hit: the generate body carries only `profileId` and row counts.
- **E2E environment:** `E2E_SKIP_DOCKER=1` when the shared embedded Postgres is on 55432 (retrospective 1.19). Run `npx playwright install chromium chromium-headless-shell` before the first run. Rebuild `backend/public` before Playwright. Check `git status -- evidence/` after any Playwright run.

**Open questions that needed the user.** Both were decided on 2026-11-11 as recommended: Q1 yes, once (the user runs it); Q2 keep 256 KB.
- **Q1 — Databricks live validation.** May the gate run one generated Databricks script in a scratch schema of the user's workspace? The app itself never writes. This would be a developer check with the user's credentials, done by the user in the Databricks SQL editor, or by a throwaway script with the user's go-ahead.
  - *Recommendation:* the user pastes the script into the SQL editor against a scratch schema once, and we record the row counts. Without that, 1.22.3 ships on golden and smoke tests only, and the gap is stated in the changelog.
- **Q2 — Chat script size.** Keep the 256 KB panel-file limit for chat-generated scripts (refuse larger ones, pointing to the dataset editor), or raise the download limit of file panel items (agent-panel change)?
  - *Recommendation:* keep 256 KB for now. It holds about 1,500 rows of a 10-column table.

## 8. Verification plan (for the Opus verifier at the end of the epic)

1. **Branch hygiene:**
   - `git log main..HEAD --oneline`: commits scoped `feat(1.22.x)` / `docs(1.22.x)`;
   - `git status` clean;
   - `git -C <main checkout> status --short` shows no strays;
   - every `unit/M1-22-*` branch is an ancestor of HEAD (`git merge-base --is-ancestor`).
2. **Contract conformance:**
   - `types.ts` matches 3.1;
   - api.md 2.18 matches 3.2 word for word on the error texts;
   - grep the frontend for every `data-testid` in 3.4;
   - the tool ids, inputs and error texts match 3.5;
   - the tool inputs are scalar (no `z.array`, no `z.object` nested) in `synthetic-data.tools.ts`.
3. **Readiness untouched:**
   - `git diff main -- backend/src/modules/data-readiness/` is empty apart from imports from it (there should be none);
   - `git diff main -- backend/src/modules/datasources/connectors/*-profiling.ts` adds only `sampleTable` and its private helpers;
   - data-readiness R29 is unchanged;
   - the readiness golden suite and score-equality specs are green.
4. **Commands** (from the worktree root):
   - `py -3 scripts/check-specs.py`;
   - `npm --prefix backend test -- synthetic-data datasources data-readiness`, then the full backend suite, compared against `main`'s failures (CRLF: retrospective 1.21);
   - `npm --prefix backend run lint`;
   - `cd frontend && npx ng test --watch=false` (with `CHROME_BIN` set to Playwright's Chromium);
   - `npm --prefix frontend run build:all`;
   - `node scripts/qa.mjs 1.22.<n> --gate` for each story.
5. **Playwright** (`E2E_SKIP_DOCKER=1` when 55432 is taken):
   - `frontend/e2e/synthetic-data.spec.ts` (all describes, including the PostgreSQL replay);
   - the regression specs whose helpers touch the dataset tabs: `dataset-ontology.spec.ts`, `dataset-schema-notes.spec.ts`, `world-cup-workflow.spec.ts`, `navigation.spec.ts`, `layout-accessibility.spec.ts` (the tab strip and its screenshot baseline);
   - for 1.22.4: `data-readiness.spec.ts` and `agent-panel.spec.ts`.
6. **Determinism by hand:** generate World Cup twice with seed 1 → identical SHA-256; seed 2 → different; profile again (unchanged data) → the same SHA-256.
7. **Privacy by hand:** grep the World Cup script for five real player names and for a real venue name → no match; the `stage` or `status`-like categorical columns do reuse real values.
8. **Evals (1.22.4 only):**
   - the `data-readiness` set at 100 % over 3 runs on a fresh copy of the data dir;
   - flipped cases re-run on `main`;
   - the prompt delta recorded.
9. **Evidence:**
   - `evidence/1.22.1/sampling-timings.md`;
   - `evidence/1.22.2/replay.txt`;
   - `evidence/1.22.3/databricks-run.md`;
   - demo videos for 1.22.1, 1.22.2 and 1.22.4, and `demo.txt` for 1.22.3;
   - every screenshot looked at, including dark theme and a 1440 px width with the right panel open (retrospective 2.1.5 and 1.16).

## 9. Defaults changed or sharpened, and why

- **Sampling tiers.** "TABLESAMPLE on PostgreSQL and Databricks" became three tiers on PostgreSQL:
  - full read ≤ 1,000 rows;
  - `BERNOULLI` up to 1 M rows (row-level, unbiased, and the full page scan is cheap at that size);
  - `SYSTEM` above 1 M rows (block-level, fast).
  The row estimate comes from `reltuples`, not `COUNT(*)`, because a PostgreSQL `COUNT(*)` on a big table is the slow part. `REPEATABLE (7)` makes a re-profile of unchanged data give the same sample.
- **The profile is cached in memory for 60 minutes** rather than being purely on-demand with nothing kept. The generate step needs exactly the profile the user saw, and posting it back exceeds the default body limit (G9). It is still never persisted.
- Everything else is as briefed.
- **After the live timings (2026-11-11, [evidence/1.22.1/sampling-timings.md](../../evidence/1.22.1/sampling-timings.md)):**
  - PostgreSQL: every tier under 150 ms on a 349k-row table; no change.
  - Databricks: `TABLESAMPLE` passed on `tpch.lineitem` (30 M rows: 3.6 s cold, 0.47 s warm) but took 52 s cold on `tpch_sf1000.lineitem` (6 B rows, 160 GB), over the 15 s statement timeout, where `LIMIT` took 1.6 s. So a size guard: tables of 50 GiB or more (`DESCRIBE DETAIL` `sizeInBytes`, new constant `DATABRICKS_TABLESAMPLE_MAX_BYTES` in `limits.ts`) use `limit`.
  - Databricks `rowCount()` is a `COUNT(*)`, not Delta metadata as section 1 said; it ran in 0.3 s warm.
  - A `limit` read that returns fewer rows than it asked for read the whole table, so it is labelled `full`, not `limit`. That fixes the never-analysed `world_cup.players` (`reltuples = -1`), which would otherwise show "sampling not supported".
  - TABLESAMPLE on a Databricks view was not verified live: the fallback on a TABLESAMPLE error covers it.

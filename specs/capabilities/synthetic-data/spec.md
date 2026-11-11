# Synthetic data

A user can profile the tables of a PostgreSQL or Databricks dataset quickly, from a **sample** of their rows, download a synthetic copy of them as a SQL script in the datasource's own dialect (or as CSV or Excel), export the profile, and, behind an explicit confirm, export the real sampled rows. The sampled profile shows each column's type, null rate, distinct count, range, categorical values and text patterns, and says how a synthetic column would be generated. It is an approximate view, separate from [data-readiness](../data-readiness/spec.md), whose statistics stay exact.

Roadmap 1.22.1 ships the sampled profile in the dataset editor; 1.22.2 the generator and the PostgreSQL script; 1.22.3 the Databricks script; 1.22.5 the CSV and Excel formats and the profile export; 1.22.6 the raw sample export. The Data Readiness Agent's tools (1.22.4) are specified here when they ship. The epic is [../../epics/M1-22/spec.md](../../epics/M1-22/spec.md); the decision is ADR-0037 in [../../system/architecture.md](../../system/architecture.md).

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): sampled profile, synthetic data script, sample export, dataset, datasource, entity, data readiness.

- **Sample.** Up to 1,000 rows of one table, read with the engine's native sampling where it exists. Raw rows are used to build a profile and are then dropped.
- **Sampling method.** How a table was read: `full` (the whole table, 1,000 rows or fewer), `tablesample` (the engine's `TABLESAMPLE`) or `limit` (the first rows, when sampling is unknown or refused).
- **Column kind.** What a column is for synthesis: `identifier`, `categorical`, `numeric`, `temporal`, `boolean`, `formatted`, `text` or `unsupported`.
- **Strategy.** How a synthetic column would be generated from its profile: `sequence`, `uuid`, `unique-pattern`, `foreign-key`, `categorical`, `numeric-range`, `temporal-range`, `boolean-rate`, `format-template`, `pattern`, `words`, `null-only` or `constant`. Shown in the profile as "Generated as".
- **Synthetic data script.** A UTF-8, LF-only `.sql` file the user downloads: a header, `CREATE SCHEMA`, `CREATE TABLE`, batched `INSERT`s and, optionally, key constraints, in the datasource's dialect. It holds generated values only, and the app never runs it.
- **Export format.** `sql` (the script), `csv` (a zip with one RFC 4180 file per table and a `README.txt`) or `xlsx` (one sheet per table and an `About` sheet). The same generator, seed and row counts give the same values in every format.
- **Sample export.** The real rows of the sample, re-read on request, as `sql`, `csv` or `xlsx`. It is the only way a raw row leaves the server (R38).
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
- R9. **Raw rows SHALL not leave the service**, except through the confirmed sample export (R38). They SHALL NOT be logged, cached, persisted, put in an error message, returned by the profile endpoint or sent to a model. The profile builder turns them into statistics, and the rows are dropped when the request ends. An `error` text SHALL be connector text, never row data.

Profile contents and classification
- R10. For each column the profile SHALL hold: the declared type as the platform reports it, the semantic type, nullability, the null fraction (0 to 1, 4 decimals, 0 when nothing was sampled), the distinct count and ratio, and, where they apply, numeric statistics (min, max, mean, 11 quantiles p0 to p100, integer flag, scale up to 10), temporal statistics (min, max and 11 quantiles in UTC, granularity `date`, `second` or `fraction`), the true fraction of a boolean, a text length summary, categorical top values, and shapes. Every number is approximate. Numeric and temporal statistics SHALL be computed only for columns classified `numeric` or `temporal` (R11), never for identifiers. For those columns the minimum, maximum and the 11 quantiles are real values and extremes of the sample, and are shown as such. An identifier column (key, foreign key, uuid, id-named or high-distinct-ratio) carries only non-value facts: null fraction, distinct count and ratio, length summary and shapes. The card shows a dash for a column with no range.
- R11. Each column SHALL be **classified** by the first rule that matches:
  1. `unsupported`: semantic type `json` or `other` (arrays, struct, map, binary, interval, geometry, user-defined types). Strategy `null-only` when the column is nullable, else `constant`.
  2. `identifier`: the column is in the primary key, a unique key or a foreign key, or its type is `uuid`, or its name matches `/(^id$|_id$|^uuid$|_uuid$|guid)/i`, or its sample distinct ratio is at least 0.95 with at least 50 non-null values. A column is a foreign key when any declared foreign-key edge of the datasource has this table as its child, whether or not the parent table is in the profile; it also is one when an inferred relationship has both ends in the profile. Strategy `foreign-key` only for a foreign-key column whose parent table is in the profile (a usable relationship); else `sequence` for an integer column that is in the primary key or is a foreign key; else `unique-range` for an integer column that is only unique (declared UNIQUE, or a sample distinct ratio of at least 0.95 with at least 50 non-null values, R20); else `uuid` for a uuid type or a uuid format rule; else `unique-pattern`. An identifier SHALL never be `categorical`. An identifier with strategy `unique-pattern` carries a length summary and shapes whatever its semantic type (text, numeric such as `numeric(10,0)` or `decimal(18,0)`, or temporal such as a timestamp in a composite key), built from the raw text values; it carries no numeric or temporal statistics.
  3. `boolean`: strategy `boolean-rate`.
  4. `numeric`: strategy `numeric-range`.
  5. `temporal`: strategy `temporal-range`.
  6. `formatted`: a text column with a format rule (`email`, `phone`, `url`, `uuid`, `date-string`). Strategy `format-template`.
  7. `categorical`: a text column with 1 to 20 distinct values in the sample **and** distinct values at most `max(20, 10 %` of the non-null sampled values`)`. Strategy `categorical`.
  8. `text`: every other text column. Strategy `words` when the mean length is above 40, else `pattern`.
- R12. The profile SHALL be kept **in memory only**: an in-process cache of at most 20 profiles, each kept 60 minutes from creation (`PROFILE_CACHE_MAX`, `PROFILE_TTL_MS`). The oldest-used profile SHALL be evicted first when the cache is full. Nothing SHALL be persisted, and a restart forgets every profile. The cache exists so that a script generated later comes from exactly the profile the user saw, without posting a large profile back (a 50-table profile can exceed the default JSON body limit, [../../system/api.md](../../system/api.md) G9).

Privacy
- R13. A profile SHALL hold real data values **only** for categorical columns: values seen at least 3 times in the sample, at most 20 per column, with their fractions in `topValues`; the share of rarer values is `otherFraction`. A column that is a key, an identifier or a formatted column SHALL never be categorical. Shapes SHALL carry character classes and lengths only: `A` for an uppercase letter, `a` for lowercase, `9` for a digit and `_` for whitespace per position, punctuation from the fixed set `-./:@#+,()'&` kept literally and any other character as `?`; runs are compressed to `class{min,max}`; the top 5 shapes by frequency are kept, and shapes seen fewer than 3 times are merged into a rare share. Serialising a profile SHALL contain none of the sampled values of any text, formatted or identifier column. The only other real values are the numeric and temporal extremes and quantiles of `numeric` and `temporal` columns (R10); identifier columns, numeric and temporal ones included, carry none (their shapes hold class tokens only).

The tab
- R14. The dataset editor's **Profile & synthesize** tab ([datasets](../datasets/spec.md) R48, R50) SHALL let the user pick tables (all checked by default, at most 50), profile a sample, cancel a running profile, and read one card per table with its sampling method and one row per column. Once a profile exists the tab SHALL also offer the Generate form (R17 to R25, R31), **Export profile** (R35) and **Export sample rows** (R36, R37). Its note SHALL say that sampled statistics are approximate, that Data readiness scores use exact counts, and that nothing is stored and nothing is written to the datasource. Exact copy and test ids are in **UI**.
- R15. A profile request SHALL be refused, with the texts of **Edge cases and errors**, when the dataset is unknown, has no datasource or has a datasource of another kind, when a chosen table is not in the dataset, when more than 50 tables are chosen, or when the sample size is not a whole number from 1 to 1,000. A single table that cannot be sampled SHALL NOT fail the request: its card shows the error and its columns come from the catalog.
- R16. When the client disconnects (Cancel, or navigating away) the sampling run SHALL be aborted.

Generator (roadmap 1.22.2)
- R17. A synthetic copy SHALL be generated from the cached profile by a **pure, deterministic generator with no model inside**. It SHALL use no `Math.random`, no clock and no locale-dependent formatting; every number is formatted by the app's own code. The same profile and the same request give the same rows.
- R18. Pseudo-random numbers SHALL come from a seeded generator (sfc32) seeded by `hash32(seed, tableKey, columnName)` (FNV-1a over the UTF-8 bytes). Each column has its own stream, so adding a table or a column never changes another column's values.
- R19. **Keys first, topological order.** Key columns (primary and unique) SHALL be generated first for every table, so every foreign-key value is drawn from a key set that already exists. Tables SHALL then be emitted in a topological order of the foreign-key graph (Kahn's algorithm, ties broken by table key); tables in a cycle and self-references are emitted in key order. `CREATE TABLE` SHALL carry no foreign-key constraint; when constraints are included, foreign keys are added with `ALTER TABLE … ADD CONSTRAINT` **after all inserts**, so cycles never block a load.
- R20. Each column SHALL be generated by its strategy:
  - `sequence`: 1 to n, for a single-column integer key (primary key or foreign key).
  - `unique-range`: an integer that is only unique (not a primary or foreign key): distinct integers drawn **without replacement** from the observed `[min, max]`. When `max − min + 1` is smaller than the rows asked for, a sequence starting at the observed minimum is used instead and the header says so. Example: `tournaments.tournament_year` gives distinct years within 2018 to 2022, not 1, 2, 3.
  - `uuid`: a version 4 UUID from the stream.
  - `unique-pattern`: the dominant shape filled from the stream, plus a base-36 counter suffix that makes the value unique within the table.
  - `foreign-key`: a uniform draw from the parent's generated key set, NULL at the column's null rate when it is nullable; a composite foreign key draws whole parent tuples. A composite primary key made of foreign-key columns draws distinct tuples (rejecting duplicates up to 20 × n attempts).
  - `categorical`: a draw from `topValues` by fraction; with probability `otherFraction` the `pattern` strategy is used instead.
  - `numeric-range`: inverse CDF over the 11 quantiles, uniform within the chosen bucket, rounded to the observed `scale` (integer when `integer`).
  - `temporal-range`: the same over epoch milliseconds (UTC), formatted at the observed granularity.
  - `boolean-rate`: true with probability `trueFraction`.
  - `format-template`: email `user<n>@example.com` (`n` the row number), phone `+1-555-01<2 digits>-<4 digits>`, url `https://example.com/<8 lowercase letters>`, uuid v4, or an ISO date in the observed range. These use reserved example domains and numbers, never sampled text.
  - `pattern`: a shape picked by frequency, each class filled from the stream (Latin letters, digits 0 to 9) with each run's length uniform in `{min, max}`.
  - `words`: the target length is drawn from the length quantiles and the value is filled with words from a fixed built-in list of 200 neutral English words, cut to the length.
  - `null-only` / `constant`: NULL / the dialect's neutral literal for the type.
- R21. **Null rate.** Every non-key column SHALL be NULL with probability `nullFraction`. A NOT NULL column SHALL never get NULL.
- R22. **Limits.** Rows per table 1 to 10,000 (`ROWS_PER_TABLE_MAX`, default 100), at most 200,000 rows in a script (`SCRIPT_ROWS_MAX`), a seed that is a whole number from 0 to 2147483647 (default 1), and a target schema matching `^[A-Za-z_][A-Za-z0-9_]{0,62}$` (default `synthetic`; Databricks also accepts `catalog.schema`, both parts matching). A relationship whose parent table is not in the profile SHALL be listed as dropped: the column is still generated by its strategy and no constraint is emitted.
- R23. **Clamping.** When the requested row count exceeds the number of possible distinct tuples of a composite primary key made of foreign keys, the table SHALL be clamped to that number and the script header SHALL say so.
- R24. **Determinism and the hash.** The same profile and the same request SHALL give byte-identical output apart from the header's `generated on` line. The SHA-256 of the script SHALL be computed without that line, so the header line `-- sha256 (without this header line and the time line): <hex>` and the `X-Script-Sha256` response header are stable. The script is streamed in batches and is never built whole on the HTTP path.
- R25. Real values SHALL be reused **only** by categorical columns. The generator SHALL otherwise copy nothing from the dataset: shapes carry classes only, format templates use reserved examples and the word list is built in. A generated value of a text column MAY coincide with a sampled value by chance on very short shapes; this is accepted, not hidden. The numeric and temporal minimum and maximum are real extremes and generated values can equal them.

PostgreSQL output (roadmap 1.22.2)
- R26. The script SHALL be emitted as lines joined with `\n` (LF only, never CRLF), UTF-8 without BOM, ending with `\n`.
- R27. For a PostgreSQL dataset the script SHALL be, in order: a header comment, `BEGIN;`, `CREATE SCHEMA IF NOT EXISTS "<target>";`, one plain `CREATE TABLE "<target>"."<table>"` per table (no `IF NOT EXISTS` and no `DROP`, so running it twice fails loudly instead of mixing data), batched `INSERT`s, the foreign-key `ALTER TABLE` statements (when constraints are included) and `COMMIT;`.
  - The header holds `-- Synthetic data for dataset "<name>" (<datasource kind>), generated by Questions to Insights <version> on <ISO time>`, the profile id, seed, row counts, sampled rows per table, dropped relationships, clamped tables and columns not synthesized. **No sampled value appears in the header.**
  - Identifiers are quoted with `"…"`, doubling `"`. The table name is the source table name; when two selected tables in different source schemas share a name, both become `<schema>_<table>` (listed in the header).
  - Types: the declared type text when its base type is in a built-in allow-list (the integer family, numeric and decimal with precision and scale, real, double precision, money, text, varchar(n), char(n), boolean, date, time and timestamp with or without time zone, interval, uuid, json, jsonb, bytea, and arrays of those); anything else (enum, domain, user or extension type) becomes `text` with a header note. Columns keep their declared `NOT NULL`.
  - `PRIMARY KEY (…)` and `UNIQUE (…)` inline, and foreign keys by `ALTER TABLE … ADD CONSTRAINT "<t>_<cols>_fk" FOREIGN KEY (…) REFERENCES …` after all inserts, only when constraints are included.
  - String literals use `'…'` doubling `'` (`standard_conforming_strings` assumed on, stated in the header); a `\0` is rejected. Numbers are plain decimal text (no exponent, never `NaN` or `Infinity`); booleans `TRUE` and `FALSE`; `DATE '2024-01-31'`, `TIMESTAMP '2024-01-31 10:00:00'`, `TIMESTAMPTZ '…+00:00'`; uuid as `'…'::uuid`. The neutral literal of a `constant` column is `'{}'` for json, jsonb and arrays, `'\x'` for bytea, `'0'` for interval and `''` otherwise.
  - `INSERT INTO t (c1, …) VALUES (…),\n(…);` carries at most 500 rows (`INSERT_BATCH_ROWS`).
- R28. The script SHALL load into an empty PostgreSQL database with every requested row (or the clamp) and, when constraints are included, every foreign key valid.

Databricks output (roadmap 1.22.3)
- R29. For a Databricks dataset the script SHALL be in Databricks SQL, in the same order as R27 without `BEGIN`/`COMMIT` (Databricks has no multi-statement transaction; the header says a failed run may leave partial tables).
  - Identifiers are quoted with backticks, doubling a backtick. The target is `CREATE SCHEMA IF NOT EXISTS <target>;` where `<target>` is `` `schema` `` or `` `catalog`.`schema` ``.
  - `CREATE TABLE … (…) USING DELTA`. Types: the declared type when its base type is in an allow-list (tinyint to bigint, float, double, decimal(p,s), string, varchar(n), char(n), boolean, date, timestamp, timestamp_ntz, binary, array<…>, map<…> and struct<…>); anything else becomes `string` with a header note.
  - Primary and foreign keys are **informational** and need Unity Catalog: `CONSTRAINT <t>_pk PRIMARY KEY (…)` inline (its columns forced NOT NULL) and `ALTER TABLE … ADD CONSTRAINT <t>_<cols>_fk FOREIGN KEY (…) REFERENCES …` after all inserts, only when constraints are included. Unique keys are not emitted (no enforced UNIQUE); the header says so.
  - String literals escape `\` to `\\` then `'` to `\'` (Spark parses backslash escapes). Typed literals are `DATE'2024-01-31'`, `TIMESTAMP'2024-01-31 10:00:00'` and `TIMESTAMP_NTZ'…'`; uuid as `'…'`. The neutral literal is `array()` for an array, `map()` for a map, `X''` for binary and `INTERVAL 0 SECONDS` for an interval; a NOT NULL struct column is emitted as nullable and filled with NULL, with a header note.
  - Batching, LF-only and the trailing `\n` are as in R26 and R27.
- R30. Constraints can be switched off (**Include keys and constraints**), for a workspace on `hive_metastore` where they fail.

Formats and the profile export (roadmap 1.22.5)
- R31. The Generate request MAY carry a `format` (`sql`, `csv` or `xlsx`, default `sql`). The same generator, seed and row counts SHALL give the same values in every format. CSV and Excel need no dialect writer, so they work for a Databricks dataset in every case.
- R32. **CSV** SHALL be one file per table, named `<target table name>.csv`, in RFC 4180 form (`,` separator, `"` quoting with `"` doubled, CRLF row ends, UTF-8 without BOM, a header row, NULL as an empty field), all in one `.zip` that also holds `README.txt`.
- R33. **Excel** SHALL be one sheet per table (names cut to 31 characters, `[]:*?/\` replaced by `_`, made unique with `~2`), a bold header row, numbers, booleans and dates as typed cells, NULL as an empty cell, and a first sheet `About`.
- R34. `README.txt` and `About` SHALL carry the header text of the `.sql` script (dataset, seed, rows, dropped relationships, not-synthesized columns, notes); no sampled value appears in them.
- R35. **Export profile** SHALL give `CSV` (one row per column of every table: table, method, sampledRows, rowCountEstimate, column, type, kind, strategy, nullPct, distinct, range or length, top values joined by ` | `, patterns joined by ` | `) or `Excel` (sheets `Tables` and `Columns`). It SHALL hold exactly what the profile view shows, so no sampled value beyond the categorical top values. There is no confirm.

Raw sample export (roadmap 1.22.6)
- R36. **Export sample rows** SHALL offer `SQL script`, `CSV (zip)` and `Excel (.xlsx)` for the real rows the profile was computed from. It is offered in the editor tab only; the Data Readiness Agent has no raw export.
- R37. Before every raw export the UI SHALL ask for confirmation with the text `This file contains real rows from <datasource>, including identifiers, names and free text. Export anyway?`, **Export** and **Cancel**. Cancel downloads nothing. The request SHALL carry `confirmRealData: true`, and the server SHALL refuse it otherwise. The synthetic and profile exports have no confirm.
- R38. The rows SHALL be **re-read on export** with the profile's tables, sample size and `REPEATABLE (7)`, through the same sampler and pooled read-only sessions. The cache keeps statistics only. A table that has changed, or a `limit` read, can give other rows than the ones profiled, and the README says so. The rows SHALL be streamed to the response and dropped: **raw rows leave the server only through this explicit, confirmed download, and never to a log, a cache, a session file or a model.** A table that fails is written with zero rows and its error in the README.
- R39. A raw `.sql` export SHALL use the dialect writer of the datasource with `CREATE SCHEMA` of the target (default `sample`) and the real values typed by semantic type (an unparseable value is written as a string literal). CSV and Excel follow R32 and R33.

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

Exact texts of `POST /synthetic-data/scripts` (112), the first that applies, all Style B:

- 400 `profileId is required`
- 404 `Profile "<id>" expired or not found: profile the tables again`
- 400 `format must be sql, csv or xlsx`
- 400 `Row counts must be whole numbers from 1 to 10,000` (also for `defaultRowCount`); a key that is not in the profile gives 400 `"<key>" is not a table of this profile`
- 400 `A script holds at most 200,000 rows`
- 400 `seed must be a whole number from 0 to 2147483647`
- 400 `targetSchema must be a plain identifier (letters, digits, underscores)`; for a Databricks profile `targetSchema must be schema or catalog.schema (letters, digits, underscores)`

Exact texts of `POST /synthetic-data/profile-exports` (113), Style B: 400 `profileId is required`; 404 `Profile "<id>" expired or not found: profile the tables again`; 400 `format must be csv or xlsx`.

Exact texts of `POST /synthetic-data/sample-exports` (114), Style B, the first that applies: 400 `profileId is required`; 404 `Profile "<id>" expired or not found: profile the tables again`; 400 `confirmRealData must be true: this export contains real rows`; 400 `format must be sql, csv or xlsx`; 400 `targetSchema must be a plain identifier (letters, digits, underscores)` (Databricks: `targetSchema must be schema or catalog.schema (letters, digits, underscores)`). Every input is validated **before** the response headers are written.

Other cases:
- A synthetic request is always validated before any byte is streamed, so a refusal is a plain JSON error and never a half-written file.
- An expired profile (60 minutes, eviction or restart) makes Generate, Export profile and Export sample rows answer the 404 above; the UI shows `This profile expired. Profile the tables again.`.
- A table of the profile that failed to sample generates rows from its catalog types alone (R11), and a raw export writes it with zero rows and its error in the README.
- Two selected tables with the same name in different schemas become `<schema>_<table>` in every format (R27).
- A column of an unsupported type is generated as NULL or the dialect's neutral literal; Databricks unique keys are not emitted; an enum or domain type becomes `text` (PostgreSQL) or `string` (Databricks), each with a header note.
- A raw export re-reads the data: a changed table, or a `limit` read, can give other rows than the profiled ones, and the README says so.
- A table that times out or fails: its card shows the error line, `sampledRows` is 0, and its columns are classified from their types alone.
- An empty sample (an empty table, or a failed read): every null fraction is 0, no statistics are computed, and each column gets a strategy from its type (R11).
- A table with an unknown estimate (PostgreSQL never analysed, `reltuples` of `-1`): read with `LIMIT`, never `COUNT(*)`; if fewer rows come back than requested, the method is `full`.
- A chosen table whose key names another catalog than the datasource's database (PostgreSQL): that table gets the error line `Table <key> is not in the datasource's database "<db>"`, `sampledRows` 0, and the other tables still profile (R15).
- A foreign key whose parent table is not in the profile (for example `orders.customer_code` referencing an unpicked `customers`): an identifier with strategy `sequence`, `unique-range` or `unique-pattern` by type, never `categorical`, with no `topValues`.
- A view, foreign table or partitioned parent where sampling is refused: read with `LIMIT`, method chip `First 1,000 rows (sampling not supported here)`.
- A column of an unsupported type (array, struct, map, binary, interval, user-defined) gets `NULL` or the empty value as its strategy and the note `Type not synthesized: generated as NULL`.
- The profile expires after 60 minutes, or when the app restarts: the UI shows the expiry in the summary line, and the user profiles again. Re-profiling unchanged data gives the same sample (`REPEATABLE (7)`); `limit` reads depend on the engine's row order.
- The tab on a dataset whose datasource was deleted shows the server's message in the error block of R14.
- More than 50 tables checked: the Profile button is disabled with `Choose at most 50 tables.`.

## Contracts

- Endpoints ([../../system/api.md](../../system/api.md) 2.18): `POST /synthetic-data/profiles` (111, a `201` JSON profile), `POST /synthetic-data/scripts` (112, a streamed attachment in the chosen `format`), `POST /synthetic-data/profile-exports` (113, a CSV or Excel attachment) and `POST /synthetic-data/sample-exports` (114, a streamed attachment of real rows). 112 to 114 answer `200` and write the response themselves. Nothing is stored, so there is no collection and no file on disk ([../../system/data-model.md](../../system/data-model.md): profiles live only in memory).
- Decision: ADR-0037 in [../../system/architecture.md](../../system/architecture.md). Related: [../data-readiness/spec.md](../data-readiness/spec.md) (R29 unchanged), [../datasets/spec.md](../datasets/spec.md) R48 and R50 (the tab), [../datasources/spec.md](../datasources/spec.md) (the read-only guard).
- Backend module `backend/src/modules/synthetic-data/`; the sampler is `sampleTable` on the PostgreSQL and Databricks profilers, with its interface in `datasources/connectors/sampling.ts`. Layout: [../../system/tech-stack.md](../../system/tech-stack.md).
- Constants (`synthetic-data/limits.ts`, shared with the frontend mirror): `DATABRICKS_TABLESAMPLE_MAX_BYTES = 50 GiB` (backend only), `SAMPLE_SIZE_MAX = 1000`, `PROFILE_TABLES_MAX = 50`, `PROFILE_TTL_MS = 3_600_000`, `PROFILE_CACHE_MAX = 20`, `ROWS_PER_TABLE_DEFAULT = 100`, `ROWS_PER_TABLE_MAX = 10000`, `SCRIPT_ROWS_MAX = 200000`, `INSERT_BATCH_ROWS = 500`, `DEFAULT_SEED = 1`, `DEFAULT_TARGET_SCHEMA = 'synthetic'` (`'sample'` for a raw export), `TARGET_SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/`.
- Code layout: `generator/` (pure: `prng`, `plan`, `order`, `generate`, `words`, `values/*`), `script.ts` (header, order, batching), `dialects/` (`writer.ts` interface, `postgres.writer.ts`, `databricks.writer.ts`) and `exports/` (`csv.ts`, `zip.ts`, `xlsx.ts`). Dependencies for the formats: `exceljs` (streaming workbook writer) and `fflate` (streamed zip), backend only, recorded in ADR-0037.

Request, `POST /synthetic-data/profiles`:

```ts
{ datasetName: string; tables?: string[]; sampleSize?: number }  // tables: entity keys; blank or left out = every table; sampleSize 1..1000, default 1000
```

Response `201`, shared types in `backend/src/modules/synthetic-data/types.ts` (frontend mirror `frontend/src/app/features/synthetic-data/models/synthetic-data.model.ts`):

```ts
import type { FormatRule, SemanticType } from '../data-readiness/engine/types';

export type SyntheticDialect = 'postgres' | 'databricks';
export type ExportFormat = 'sql' | 'csv' | 'xlsx';
export type SampleMethod = 'full' | 'tablesample' | 'limit';
export type ColumnKind =
  | 'identifier' | 'categorical' | 'numeric' | 'temporal'
  | 'boolean' | 'formatted' | 'text' | 'unsupported';
export type SynthesisStrategy =
  | 'sequence' | 'unique-range' | 'uuid' | 'unique-pattern' | 'foreign-key'
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
  length?: { min: number; max: number; mean: number; quantiles: number[] /* 11 */ };  // text, formatted, unique-pattern identifier and categorical columns
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

Requests and what the script endpoints report:

```ts
// 112 POST /synthetic-data/scripts
interface ScriptRequest {
  profileId: string;
  rowCounts?: Record<string, number>;  // per table key; tables left out use defaultRowCount
  defaultRowCount?: number;            // default 100, 1..10000
  seed?: number;                       // default 1, 0..2147483647
  targetSchema?: string;               // default "synthetic"
  includeConstraints?: boolean;        // default true
  format?: ExportFormat;               // default 'sql'
}
// 113 POST /synthetic-data/profile-exports
interface ProfileExportRequest { profileId: string; format: 'csv' | 'xlsx' }
// 114 POST /synthetic-data/sample-exports
interface SampleExportRequest {
  profileId: string;
  format: ExportFormat;
  targetSchema?: string;               // default "sample"
  confirmRealData: true;               // anything else is refused
}
// What the script header reports (and the agent tool, when it ships)
interface ScriptSummary {
  fileName: string; dialect: SyntheticDialect; seed: number; targetSchema: string; bytes: number;
  tables: { key: string; targetName: string; rows: number; clampedFrom?: number }[];
  droppedRelationships: SampledRelationship[];   // parent outside the profile
  notSynthesized: { table: string; column: string; reason: string }[];
  sha256: string;                                // of the script bytes without the time line
}
```

Responses of 112 to 114 (all `200`, [../../system/api.md](../../system/api.md) 2.18):

| Endpoint | `format` | `Content-Type` | File name | Extra headers |
|---|---|---|---|---|
| 112 | `sql` | `application/sql; charset=utf-8` | `<dataset-slug>-synthetic-<dialect>-seed<seed>.sql` | `X-Script-Sha256`, `X-Script-Rows` |
| 112 | `csv` | `application/zip` | `<dataset-slug>-synthetic-seed<seed>-csv.zip` | `X-Export-Rows` |
| 112 | `xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `<dataset-slug>-synthetic-seed<seed>.xlsx` | `X-Export-Rows` |
| 113 | `csv` / `xlsx` | `text/csv; charset=utf-8` / the xlsx type | `<dataset-slug>-profile.csv` / `.xlsx` | none |
| 114 | `sql` / `csv` / `xlsx` | as 112 | `<dataset-slug>-sample-<dialect>.sql` / `<dataset-slug>-sample-csv.zip` / `<dataset-slug>-sample.xlsx` | `X-Export-Rows` |

`<dialect>` is `postgresql` or `databricks`; the slug is as in [../../system/api.md](../../system/api.md) 14. `X-Script-Sha256` is the SHA-256 of the `.sql` text without the time line (R24); a zip and a workbook carry no hash.

## UI

Placement: the **Profile & synthesize** tab of the dataset editor, the third tab of a saved dataset ([../../system/ui.md](../../system/ui.md) 4.3 and 4.3a, [../datasets/spec.md](../datasets/spec.md) R48). A new (unsaved) dataset shows no tabs. A dataset on a `rest` datasource shows the tab with the empty-state text `Profiling a sample works for PostgreSQL and Databricks datasets.` and no controls.

- Tab: `data-testid="dataset-tab-synthesize"`, `id="dataset-tab-synthesize"`, lucide `FlaskConical`, panel `dataset-panel-synthesize`. The Left and Right arrow keys cycle over the three tabs.
- Component: `app-synthetic-data-panel` with the dataset as its input.
- Header: `h2` "Profile & synthesize". Note, 13 px `fg-muted`: `Sample up to 1,000 rows per table to see how the data looks, then generate a synthetic copy as a SQL script. Sampled statistics are approximate; Data readiness scores use exact counts. Nothing is stored and nothing is written to the datasource.`
- Table picker: a checkbox per table (`synth-table-<key>`, all checked), `Select all` and `Clear` (`synth-select-all`, `synth-select-none`), the count line `<n> of <m> tables` (`synth-table-count`), and, above 50 checked, a disabled Profile button with `Choose at most 50 tables.` (`synth-too-many`).
- **Profile sample** (`synth-profile`, primary). While it runs the button reads `Sampling <n> tables…` with a spinner and **Cancel** (`synth-cancel`) appears and aborts the request. On error, `synth-error` shows the server message verbatim, with **Retry**.
- Profile view (`synth-profile-view`): the summary line `<n> tables · sampled <relative time> · expires in <m> min` (`synth-profile-summary`) and one card per table (`synth-table-card-<key>`) with its method chip (`synth-method-<key>`: `Sampled 1,000 of ~2.3M rows`, `Read all 32 rows` or `First 1,000 rows (sampling not supported here)`; tooltip `TABLESAMPLE`, `full read` or `LIMIT`), the error line (`synth-table-error-<key>`), and a column table (`synth-col-<key>-<column>`) with Column, Type, Nulls %, Distinct, Range or length, Top values or patterns and Generated as. Top values show at most 5 with `+<k> more`; patterns show the shape in monospace. The chip text per strategy is in [../../system/ui.md](../../system/ui.md) 4.3a.
- The **Generate** form (`synth-generate-form`), shown once a profile exists:
  - a **Rows per table** number input per table (`synth-rows-<key>`, default 100, 1 to 10,000), plus **All tables** and **Apply** (`synth-rows-all`, `synth-rows-apply`);
  - **Seed** (`synth-seed`, default 1, hint `Same profile and seed give the same script.`), **Target schema** (`synth-target-schema`, default `synthetic`) and **Include keys and constraints** (`synth-include-constraints`, checked);
  - **Format** (`synth-format`): `SQL script` (default), `CSV (zip)`, `Excel (.xlsx)`;
  - the button (`synth-generate`) reads `Generate .sql`, `Generate .zip` or `Generate .xlsx` after the format and downloads the file; success toast `Downloaded <file name>`;
  - an expired profile (404) shows `This profile expired. Profile the tables again.` (`synth-expired`) and focuses the Profile button; invalid input shows the server text under the field.
- On the profile view: **Export profile** (`synth-export-profile`, a menu with `CSV` and `Excel`) and **Export sample rows** (`synth-export-sample`, a menu with `SQL script`, `CSV (zip)` and `Excel (.xlsx)`). Choosing a sample format opens the confirm dialog `synth-confirm-real-data` with `This file contains real rows from <datasource>, including identifiers, names and free text. Export anyway?`, **Export** and **Cancel**; Cancel closes it and downloads nothing.
- The chip for `unique-range` reads `Distinct numbers in the observed range`.

## Flows

E2E: `frontend/e2e/synthetic-data.spec.ts` (the scenarios "Profile a sample of World Cup", "Generate a PostgreSQL script", "The script replays into an empty PostgreSQL database", "Download the synthetic data as CSV and Excel", "Export the profile", "Export the real sample rows after confirming" and "Cancelling the confirm downloads nothing" are automated; the others are not covered yet)

```gherkin
Feature: Synthetic data

  Scenario: Profile a sample of World Cup
    Given I open the "World Cup Core" dataset
    When I open the "Profile & synthesize" tab
    And I click "Profile sample"
    Then I see a card for "matches" whose method reads "Read all … rows"
    And the "stage" column shows the chip "Reuses" followed by a number of values

  Scenario: Generate a PostgreSQL script
    Given I profiled the "World Cup" dataset
    When I set "Rows per table" to 25 and click "Generate .sql"
    Then a file named "world-cup-core-synthetic-postgresql-seed1.sql" downloads
    And its first line starts with "-- Synthetic data for dataset "World Cup""
    And I see the toast "Downloaded world-cup-core-synthetic-postgresql-seed1.sql"

  Scenario: The script replays into an empty PostgreSQL database
    Given I generated the World Cup script with seed 1 and 50 rows per table
    When I run it in an empty scratch PostgreSQL database
    Then every table holds the requested rows, or the clamp
    And every foreign-key constraint exists
    And generating again with seed 1 gives the same SHA-256

  Scenario: Download the synthetic data as CSV and Excel
    Given I profiled the "World Cup" dataset
    When I choose the format "CSV (zip)" and click "Generate .zip"
    Then a zip downloads with one CSV per table and a README.txt
    When I choose the format "Excel (.xlsx)" and click "Generate .xlsx"
    Then a workbook downloads with one sheet per table and an "About" sheet
    And both hold the same values as the .sql script for the same seed

  Scenario: Export the profile
    Given I profiled the "World Cup" dataset
    When I choose "Export profile" and then "CSV"
    Then a file named "world-cup-core-profile.csv" downloads with one row per profiled column
    When I choose "Export profile" and then "Excel"
    Then a workbook downloads with a "Tables" sheet and a "Columns" sheet

  Scenario: Export the real sample rows after confirming
    Given I profiled the "World Cup" dataset
    When I choose "Export sample rows" and then "CSV (zip)"
    Then I see a dialog saying the file contains real rows from the datasource
    When I click "Export"
    Then a file named "world-cup-core-sample-csv.zip" downloads
    And its "players.csv" holds the real player names

  Scenario: Cancelling the confirm downloads nothing
    Given I profiled the "World Cup" dataset
    When I choose "Export sample rows" and then "Excel (.xlsx)"
    And I click "Cancel" in the dialog
    Then the dialog closes and nothing downloads

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

- Every Gherkin scenario above passes against the running app once automated; the seven scenarios named in the E2E line pass.
- Every error text in **Edge cases and errors** has a unit test at the controller or service level, and the cache has unit tests for expiry and eviction.
- Every classification rule of R11, the categorical rule (at least 3 sightings, at most 20 distinct values), the empty sample and the shapes of R13 have a unit test.
- **Privacy:** a fixture of 1,000 rows with names, emails and free text yields a profile whose serialisation contains none of the non-categorical sampled values; a second fixture with numeric identifier columns (`id`, `national_id bigint`, 1,000 unique values) yields a profile with none of their values and no numeric statistics on them.
- The SQL of each sampling tier of R4 and R5, the retry of R6 and the fall back to `LIMIT` have unit tests with fake clients.
- Readiness is untouched: its specs and scores are unchanged, and the diff of the two profilers adds only `sampleTable` and its private helpers.
- **Generator** (1.22.2): the same input gives the same SHA-256 across two runs and another seed a different one; adding a table leaves the other tables' rows identical; on 10,000 rows null rates are within 2 points, categorical fractions within 3 points and numbers within the observed range; foreign-key values are within the parents' keys, composite keys, a two-table cycle and a self-reference included; clamping and the total-rows limit are tested; `unique-range` gives distinct integers within the observed range, with the documented fallback when more rows than values are asked for; no generated value of a non-categorical text column equals a sampled value on a fixture with a known sample.
- **PostgreSQL writer**: inline expected strings (no golden fixture files) for identifier and literal quoting, the type allow-list and its fallback, batching at 500, `BEGIN`/`COMMIT`, foreign keys at the end, no `\r` anywhere and a trailing `\n`. An API-level replay loads the script for World Cup into a scratch database and checks the row counts and the constraints.
- **Databricks writer** (1.22.3): inline expected strings for backtick quoting, `\` and `'` escaping, typed literals, `USING DELTA`, informational constraints, no transaction and `catalog.schema` targets, plus a smoke check that every statement has balanced quotes, backticks and parentheses. One live run in a scratch schema is recorded when the user agrees (the app itself never writes), otherwise the gap is stated.
- **Formats** (1.22.5): a spec parses the `.sql`, the CSV zip and the workbook for World Cup with 50 rows and seed 1 and finds the same values; the zip holds one CSV per table and `README.txt`, the workbook one sheet per table and `About`; the profile export lists every profiled column; both formats work for a Databricks profile.
- **Raw export** (1.22.6): without `confirmRealData: true` the API answers the 400 above; the CSV zip holds the real rows (`players.csv` has the real player names) and the `.sql` loads into a scratch database with them; a spec with a spy logger proves that no raw value reaches the logger or the profile cache during an export.

<!-- sources: backend/src/modules/synthetic-data/**, backend/src/modules/datasources/connectors/sampling.ts, backend/src/modules/datasources/connectors/postgres-profiling.ts, backend/src/modules/datasources/connectors/databricks-profiling.ts, frontend/src/app/features/synthetic-data/**, frontend/src/app/features/datasets/components/catalog-browser/** -->

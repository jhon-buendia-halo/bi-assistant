# BA-2 — Data Model DSL: implementation alternatives

Research for epic [BA-2](https://halo-powered.atlassian.net/browse/BA-2) (roadmap 1.2.1), written 2026-10-01 to pick an execution plan. Status: **decided 2026-10-01** — the revised A plus the logical query layer (sections 4, 4b, 4c), datasources in scope for the beta: Postgres, Databricks and REST API. The decision becomes an ADR in [architecture.md](../../architecture.md) and the stories under BA-2.

## 1. What the assistant sees today (baseline)

| Layer | Where | What it holds | How the model sees it |
|---|---|---|---|
| Physical snapshot | `DatasetDoc.entities[]` (`datasets.repository.ts`) | columns: name, type, nullable, up to 5 sample values (40 chars), `references` declared/inferred (`relationships.ts`). `description` exists but no connector fills it. | `entityOrientationLines` + `joinHintBlock` (1.5k chars) in the first system block; full columns only on `describe_entity` tool calls |
| Metrics | `MetricDoc` (`modules/metrics`) | name, label, entity, SQL expression, dimensions, description, provenance | `definitionBlock` (4k chars) system block |
| Knowledge | `KnowledgeSnippet` (`modules/knowledge`) | instruction / term / default_filter, synonyms, scope | `contextFor` (2k chars) system block |
| Verified queries | `verified_queries` | question → SQL pairs | `referenceBlock(question)` |
| Repair / verify | `sql-fixer`, `sql-verifier` | — | `schemaSnapshotBlock` (`entity(col type [e.g. …]~>ref)`), 4–6k chars |

Gaps against the epic: nothing is versioned or diffable; no primary keys, cardinality, logical names, time or role annotations; descriptions are never populated; the schema the model reasons over is split across four blocks plus tools, each with its own budget. Evals (`mastra/evals`) build the same context, so a DSL on/off comparison is feasible.

## 2. Evidence that shapes the design

- **Serialization format moves accuracy by 0–2 points** (M-Schema vs DDL vs JSON on BIRD; schema-linking F1 nearly flat across six formats). What is *in* the schema matters more than its syntax.
- **Sample values and foreign keys are the cheapest wins**: +3 EX from 3 distinct values per column, +1–3 EX from explicit foreign keys. Value meanings and ranges beyond examples gave no stable gain (SIRIUS-SQL).
- **Business knowledge is the largest lift**: +20 EX with per-question evidence (BIRD), +17–23 points from a 4 KB semantic document; ontology mediation tripled accuracy on a complex enterprise schema (16.7% → 54.2%).
- **Do not prune the schema for frontier models**: linking recall tops out at 77–90% and lowered accuracy for strong models. Send the whole model when it fits.
- **Semantic-query compilers** (Cube, dbt MetricFlow, Malloy, QUVI) report 98–100% on modelled questions and 0% outside the model; direct SQL keeps coverage but can drift.
- **Every major product converged on the same core shape**: logical tables, fields with `expr` + description + synonyms + sample values, key-based relationships, aggregate metrics, verified queries with provenance. Apache Ossie (ex-OSI, Apache-2.0, JSON Schema published, pre-1.0) is becoming the interchange format, with converters for Databricks Metric Views, Snowflake, dbt and Cube.
- **JS tooling**: `yaml` (positions for error messages), `zod` 4 (`z.toJSONSchema()`), `libpg-query` (exact Postgres parse), `dt-sql-parser` (Spark/Databricks), no single parser covers Postgres + SQLite + Databricks. `@malloydata/malloy` (MIT, TS) covers Postgres and Databricks but not SQLite.

Full reports: internal map, format survey and grounding evidence are summarised here; sources are cited in the research transcripts (2026-10-01).

## 3. The three alternatives

### A — Ossie-shaped YAML model document, app-owned, compiled into the prompt

- **Shape**: one `model.yaml` per dataset. Ossie core (`datasets` / `fields` / `relationships` / `metrics`, `primary_key`, `description`) plus `custom_extensions` for what Ossie lacks today: explicit cardinality, named filters, column role (`dimension | measure | key | time`), sample values, provenance of each relationship (`declared | inferred | user`). Validated by a Zod schema (JSON Schema exported for editors).
- **Storage**: new `data_models` collection; immutable versions (`v1, v2, …`) with the YAML text + parsed JSON, `currentVersion` pointer and revert, same pattern as visuals. The physical `DatasetDoc.entities[]` snapshot stays as the thing the model is *bootstrapped from* and *diffed against* (drift).
- **Bootstrap**: `compileFromSnapshot(dataset, metrics)` writes v1 automatically on dataset save, so every existing dataset gets a model without user work. `MetricDoc` migrates into `metrics:` (legacy table kept read-only, `LEGACY_*` pattern).
- **Prompt**: one compiler `renderModel(model)` produces an M-Schema-style block (whole model, sample values inline, descriptions only when they differ from the name, join paths with cardinality, metrics) and replaces `entityOrientationLines` + `joinHintBlock` + `definitionBlock`; `describe_entity` and the fixer/verifier read the model, not the raw snapshot.
- **Editing**: raw YAML editor with line/column errors first; structured forms (entity, column, relationship, metric) in a later story. Export / import `.yaml` for git.
- **Pros**: diffable text, one source of truth, interchange-ready (Databricks Metric Views → Ossie → us later), evidence-aligned rendering, stays on the current "LLM writes SQL" path so repair/verify/evals keep working.
- **Cons**: Ossie is pre-1.0 (0.2.0.dev0 is a breaking draft); we own a parser/validator surface; YAML editing is a new user skill.

### B — Adopt a semantic-query compiler (Malloy) as the DSL

- **Shape**: `.malloy` sources per dataset (`source`, `dimension`, `measure`, `join_one` / `join_many`, `primary_key`). Compiled with `@malloydata/malloy`; connectors `db-postgres`, `db-databricks`.
- **Query path**: for modelled questions the assistant emits a Malloy query (metrics + dimensions + filters) that the compiler turns into SQL; raw `run_readonly_sql` stays as the fallback for anything outside the model.
- **Pros**: metrics and joins are correct by construction (no fan-out, no drift); mature TS compiler; plain-text files; the strongest measured accuracy on modelled questions.
- **Cons**: **no SQLite dialect**, so the REST connector (which materialises into in-memory SQLite) is uncovered; 0.0.x versioning; a new language for users; two query paths complicate `sql-fixer`, `sql-verifier`, verified queries and evals; the largest architectural change, hard to land by Oct 16.

### C — Evolve the existing structures into a typed, versioned JSON data model (UI-first, no text syntax)

- **Shape**: `DataModel { version, entities[{ key, label, description, primaryKey, columns[{ name, type, description, role, sampleValues }] }], relationships[{ from, to, cardinality, source }], metrics[] }` as a Zod schema; `MetricDoc` and the snapshot fold into it.
- **Storage / bootstrap / prompt**: same as A (versions, bootstrap from snapshot, one rendered block), but the canonical form is the JSON document, edited only through forms (extend `entity-details`, keep `metrics-panel`). Export as JSON.
- **Pros**: fewest new concepts, reuses every existing module and UI, lowest risk, fastest.
- **Cons**: not a language anyone writes or reviews by hand; JSON diffs are noisy; no interchange without a later exporter; weaker fit to the epic's "versionable source of truth" wording.

### Comparison

| | A — Ossie-shaped YAML | B — Malloy compiler | C — Typed JSON model |
|---|---|---|---|
| Fits epic wording (DSL, versionable, grounds SQL) | Yes | Yes | Partly |
| Covers SQLite / REST datasource | Yes | **No** | Yes |
| Keeps current SQL path, repair, verify, evals | Yes | Needs a second path | Yes |
| Interchange with Databricks / Snowflake / dbt | Via Ossie converters | Via Ossie converters (Malloy ↔ Ossie not published) | Needs an exporter |
| Hand-editable / git-reviewable | Yes | Yes | No |
| New dependency risk | `yaml`, `zod` (low) | `@malloydata/*` 0.0.x (high) | none |
| Effort to first grounded answer | Medium | High | Low |
| Effort to full editing UI | Medium–high | High | Medium |

## 3b. Non-SQL datasources change the shape (REST, MongoDB, CSV, JSON)

The formats in section 2 are **SQL semantic layers**: their structure (logical entities, fields, key relationships, metrics) is storage-neutral, but three things in them are SQL-bound and must not be copied as-is:

| SQL-bound part | What a data-model DSL needs instead |
|---|---|
| Physical binding is `catalog.schema.table` | A `binding` per entity, typed by datasource kind: `sql` (table), `rest` (endpoint + record path), `mongo` (collection), `file` (path + format + record path). An entity may have several bindings (same logical entity in two stores). |
| Field `expr` and metric `expr` are SQL strings | A **portable expression core** that every adapter can execute: field = attribute path (`address.city`, `items[].sku`), metric = `{ agg: sum | count | count_distinct | avg | min | max | ratio, of: <attribute>, where: <portable predicate> }`. A dialect-tagged escape hatch (`expressions: { sql: …, mongo: … }`) only when the core cannot express it. This is Ossie's multi-dialect idea applied to non-SQL dialects. |
| Relationships are join predicates | Logical relationships `A.attr → B.attr` with cardinality; the adapter decides whether that becomes a JOIN, a `$lookup`, or an in-memory join after materialisation. Document sources also need **nested attributes and arrays** as first-class (Cube and Ossie do not model these; Malloy does). |

What stays the same for the LLM: the rendered model block does not care whether an entity is a table or a collection. What changes is the **execution tool** the assistant picks: `run_readonly_sql` for SQL kinds, a per-kind query tool (`run_mongo_aggregate`, `read_file_records`), or the existing REST strategy of materialising records into SQLite and running SQL over them. That materialisation trick (already in `rest.connector.ts`) extends naturally to CSV and JSON files via SQLite or DuckDB, but it is lossy for deeply nested documents, which is where Mongo needs its own adapter.

Consequences for the alternatives:
- **A** survives with a split into a *logical layer* (entities, attributes, relationships, metrics in the portable core) and a *binding layer* (per-kind physical mapping). The Ossie-shaped YAML is kept only as an **export/import profile** for SQL sources, not as the canonical model.
- **B (Malloy)** is the only candidate that models nested data natively, but it compiles to SQL only; a Mongo or REST source would still have to be materialised first. It does not solve the problem, it moves it.
- **C** is unaffected in storage terms, but its "evolve the snapshot" starting point is the SQL snapshot; the binding layer still has to be added.

Scope check: the 1.0 Beta connector stories (BA-6 Databricks, BA-7 Postgres, BA-8 REST) are all SQL-executable today. MongoDB, CSV and JSON are not yet in Jira, so the DSL must **not preclude** them (bindings and the portable core are designed in now) while their adapters can land with their connector stories.

## 4. Recommendation

**A, revised per section 3b**: a storage-neutral logical model (entities, attributes incl. nested paths, relationships with cardinality, metrics in the portable core) plus a binding layer per datasource kind, serialised as our own YAML document, validated with Zod, versioned per dataset. Delivered in C's order: typed model + bootstrap from the SQL snapshot + prompt compiler first, editor later. Ossie-shaped YAML becomes an export/import profile for SQL sources, not the canonical form. B is reserved as a later milestone ("compile metric queries") once the model exists and evals show where free-form SQL still drifts.

Design rules carried from the evidence: render the whole model (no pruning), keep sample values inline (≤ 6 per column, 40 chars), emit descriptions only when they add meaning, make relationships and cardinality explicit, leave synonyms and business concepts to the Knowledge Store (1.3), keep verified queries where they are.

Sketch of the canonical document:

```yaml
model: world_cup            # one per dataset
version: 3
entities:
  - name: match
    description: One played match of a tournament
    key: [match_id]
    bindings:
      - kind: sql
        datasource: pg-world-cup
        table: world_cup.world_cup.matches
    attributes:
      - { name: match_id, type: integer, role: key }
      - { name: match_date, type: date, role: time }
      - { name: home_team_id, type: integer, role: key, samples: [1, 5, 12] }
      - { name: attendance, type: integer, role: measure }
  - name: fan_feedback
    bindings:
      - kind: mongo
        datasource: mongo-fans
        collection: feedback
    attributes:
      - { name: match_id, type: integer, role: key }
      - { name: ratings[].score, type: number, role: measure }   # nested array
relationships:
  - { from: match.home_team_id, to: team.team_id, cardinality: many_to_one, source: declared }
  - { from: fan_feedback.match_id, to: match.match_id, cardinality: many_to_one, source: user }
metrics:
  - name: avg_attendance
    label: Average attendance
    entity: match
    agg: avg
    of: attendance
  - name: home_win_rate
    entity: match
    expressions:                       # escape hatch when the portable core is not enough
      sql: "SUM(CASE WHEN home_score > away_score THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)"
```

### 4b. Requirement added 2026-10-01: the agent reasons over abstract entities, never dialects

The assistant must not see `catalog.schema.table`, SQL dialects or storage kinds. It reasons over the logical model (entities, attributes, relationships, metrics) and asks for data in those terms. This settles the "LLM writes SQL vs LLM emits a semantic query" question from section 2 in favour of a **logical query layer**, but built on our DSL rather than on Malloy or Cube (section 3b explains why those do not fit).

**Final recommendation (A + logical query layer):**

1. **Model**: the storage-neutral DSL from section 4 (entities, attributes incl. nested paths, relationships with cardinality, metrics in the portable core, bindings per datasource kind). Own YAML, Zod-validated, versioned per dataset, bootstrapped from the physical snapshot.
2. **Agent surface**: tools and prompt speak only the model's vocabulary.
   - `describe_entity(entity)` returns attributes, relationships and metrics from the model, not from the snapshot.
   - `query_entities(logicalQuery)` takes a structured query: `from` entity, `select` attributes and metrics, `filters` (portable predicates: comparison, and/or/not, in, between, is null, text match, date parts), `group_by`, `order_by`, `limit`, and `traverse` along declared relationships. Tool input is JSON-schema constrained, so the model cannot invent columns or joins.
   - `sample_records(entity)` replaces `sample_rows`.
   - The rendered model block (section 4 rules) replaces the orientation, join-hint and metrics blocks. Entity names are the logical ones.
3. **Adapters**: one compiler per binding kind turns the logical query into an executable plan. `sql` compiles to Postgres, Databricks SQL or SQLite in one place (dialect differences in date functions, quoting, limits live only there). `rest` and file kinds materialise records into SQLite and reuse the SQL compiler. `mongo` compiles to an aggregation pipeline when its connector lands. Relationship traversal becomes JOIN, `$lookup` or an in-memory join depending on the kind.
4. **Escape hatch, demoted**: raw `run_readonly_sql` stays only as an internal fallback the orchestrator may use when the logical compiler rejects a query, and every answer produced that way is flagged as "outside the model" so evals and the trust signals (1.4.1) can count it. The goal is to drive that count to zero by extending the model, not to let the agent choose SQL.
5. **Repair and verification** move up a level: `sql-fixer` becomes a logical-query fixer fed the compiler's error (unknown attribute, no relationship path, unsupported predicate), and `sql-verifier` re-derives an independent logical query. Compiled SQL no longer needs an LLM to repair syntax.
6. **Measurement**: the golden set (1.1.1, World Cup / F1 as stopgap) runs through the logical path and the current SQL path, side by side. Expect the modelled questions to approach the 98–100% the compiler-based systems report, and watch the "outside the model" count.

**Why this and not B**: B gives the same agent experience but ties the model to SQL-only compilation and a 0.0.x dependency; our compiler covers exactly the binding kinds we own, including non-SQL ones.

**Risks to manage**: (a) a new query grammar has no pretraining behind it, unlike SQL, so keep it close to SELECT / WHERE / GROUP BY semantics and constrain it with a JSON schema; (b) the portable predicate and function set must be small and complete enough (dates are the usual gap); (c) the compiler is the critical path for Oct 16, so story 2 lands with the `sql` adapter only.

### 4c. Requirement added 2026-10-01: the Knowledge Store maps question semantics onto the DSL

The knowledge store (milestone 1.3, Sergio) is how the agent gets from the words in a question to the abstract entities in the model. The boundary from 1.3.1 ("the DSL holds structure, the knowledge store holds meaning") becomes a concrete contract:

| | DSL (1.2) | Knowledge Store (1.3) |
|---|---|---|
| Owns | entities, attributes, relationships, metrics, bindings, one `description` per element | concepts, synonyms, instructions, default filters / constraints, example questions |
| Addressing | every element has a stable **logical reference**: `match`, `match.attendance`, `metric:avg_attendance`, `rel:match.home_team_id->team.team_id` | every concept carries `mappings: [<logical reference>]`, never a physical `catalog.schema.table` |
| In the prompt | the whole rendered model (no pruning) | a *focus block*: the concepts matched for this question, each with its synonyms and the DSL references it maps to, plus applicable constraints |
| Validation | exposes `resolveRef(modelVersion, ref)` | every mapping is validated against the current model version on save; a model change that removes or renames a target flags the concept **stale** for review (same drift mechanism as the snapshot check) |
| Bootstrap | `renderModel()` is the input | `knowledge-bootstrap` proposes concepts and synonyms from the rendered model and sample values |
| Provenance | the turn records the model version used | `KnowledgeUse` already records the snippets shown; it gains the resolved references, so the answer panel can say "revenue → metric:net_revenue (model v3)" (feeds 1.3.4 and 1.4.1) |

How a question flows: question → knowledge retrieval (synonyms, embeddings, entity overlap, one hop along concept relations — 1.3.3) → set of DSL references → focus block in the prompt → the agent writes a logical query using those references → compiler. The focus block *guides*, it does not *restrict*: the evidence in section 2 says pruning the schema hurts frontier models, so the full model stays in context and the focus block says where to look.

Decisions this settles:
- **Default filters** stay in the knowledge store (they are meaning: "active customers means status = 'active'") but are expressed as **portable predicates over DSL attributes**, so every adapter can apply them automatically and the compiler can enforce them, not just suggest them.
- **Synonyms** live only in the knowledge store. The DSL keeps `description` per element because the bootstrap agent and the model block both need it, but it does not carry vocabulary.
- The existing `KnowledgeSnippet.entities` (physical `catalog.schema.table` bindings) migrates to logical references in the 1.3.2 snippet migration, so the two milestones have a shared sequencing constraint: **BA-2 story 1 must ship the reference format and `resolveRef` before 1.3.2 starts**, and 1.3.1's ontology design adopts DSL references as the mapping target.

## 5. Proposed stories under BA-2 (none exist in Jira yet)

1. **DSL schema, bindings, bootstrap and migration** — ADR; Zod schema + JSON Schema; YAML parse/validate with line/col errors; `data_models` collection with versions; bootstrap v1 from every existing dataset; migrate `MetricDoc` into the model; drift check against a fresh snapshot; **logical reference format + `resolveRef` API** consumed by the knowledge store (unblocks 1.3.2).
2. **Logical query layer and entity-only agent, measured** — logical query spec; `sql` compiler for Postgres, Databricks and SQLite; `rest` via materialisation; `describe_entity`, `query_entities`, `sample_records` tools; rendered model block; raw SQL demoted to a flagged fallback; `sql-fixer` / `sql-verifier` moved to the logical level; eval run on both paths.
3. **Model editing, versioning and export** — Gherkin + E2E first; raw editor with validation, version list / diff / revert, export and import `.yaml`; structured forms for entities, attributes, relationships and metrics.
4. *(later)* **Non-SQL adapters** (Mongo aggregation, CSV/JSON files) with their connector stories, and **Ossie / Databricks Metric Views import**.

## 6. Decisions taken 2026-10-01 (were open questions)

1. Alternative A, revised (sections 4, 4b, 4c). B and C rejected.
2. ~~Boundary with the Knowledge Store~~ — settled in section 4c: default filters and synonyms stay in knowledge, expressed against DSL references.
3. One model per dataset.
4. Auto-bootstrap v1 on dataset save; later saves produce a drift report instead of overwriting user edits.
5. Story split in section 5 accepted; stories created in Jira under BA-2 before the first branch.
6. Stories 1–2 by Oct 16; story 3 may slip to Oct 23.
7. Datasources in the 1.0 Beta: **Postgres, Databricks, REST API** only. The DSL ships the binding layer and the portable metric core so MongoDB, CSV and JSON can be added later without changing the model; no adapters for them in the beta.
8. File sources (when they come): materialise into SQLite and reuse the SQL compiler; a native adapter only for Mongo.
9. Raw SQL stays as an internal, flagged fallback when the logical compiler rejects a query; evals count how often it fires.
10. Sequencing with 1.3: story 1 ships the logical reference format and resolver before 1.3.2 migrates snippets; 1.3.1 adopts DSL references as its mapping target.
11. Metrics in story 1 (revised after code review, 2026-10-02): the shared `metrics` store stays the panel's editor of record until 1.2.3; models mirror it on every panel write and dataset save; YAML-only metrics survive merges as model-local extras. Moving storage into per-dataset models while the panel is keyed by physical table broke the panel for unsaved tables, newly included tables and entity changes.

## 7. BA-85 (1.2.1) — E2E impact analysis (workflow step 6)

Components touched: `DatasetsService.save/delete` (hook), new `DataModelsModule`, `MetricsService` storage, `database.module.ts` (new collection).

| Spec | Scenario | Decision |
|---|---|---|
| `frontend/e2e/world-cup-workflow.spec.ts` | all four (datasource/dataset/session, masked credentials, failed connection, catalog schema) | **Re-run as-is** — dataset save now also bootstraps a model; must stay green |
| `frontend/e2e/agents.spec.ts`, `chat-and-visuals.spec.ts`, `diagnostics.spec.ts`, `layout-accessibility.spec.ts` | all | **Re-run as-is** — no UI change |
| `backend/test/app.e2e-spec.ts`, `answer-guards.e2e-spec.ts` | all | **Re-run as-is** |
| `backend/test/data-models.e2e-spec.ts` | the nine scenarios under *Feature: Data model* in gherkin.md | **Add** (written before implementation, must fail with 404s first) |
| Unit: `metrics.service.spec.ts`, `datasets.service.spec.ts`, `database.module.spec.ts` | — | **Update** for the storage move, the bootstrap hook and the new collection |

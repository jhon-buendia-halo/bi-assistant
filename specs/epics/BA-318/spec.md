# BA-318 — Schema metadata in datasets: layer and description

- **Jira:** [BA-318](https://halo-powered.atlassian.net/browse/BA-318) · **Roadmap:** Milestone 1.20 · **Status:** Confirmed (by the user on 2026-11-09).

## Goal

When building or editing a dataset, users can say what each **schema** in it is for. In the Edit dataset page's catalog tree, they select a schema and set its data **layer** (Landing, Normalized or Consumption) and a free-text **description**. The tree shows the layer on the schema row, and the assistant receives both, so it can prefer the right schema (for example a Consumption copy over a Landing copy of the same data) and understand what a schema holds.

## Scope

- **Schema notes on a dataset.** A dataset document gains an optional list of schema notes, one per schema (`catalog.schema`), each with:
  - `layer`: one of `landing`, `normalized`, `consumption`, or absent. UI labels "Landing", "Normalized", "Consumption"; the dropdown's empty option is "None".
  - `description`: free text, trimmed and capped at 500 characters; empty means absent.
  A note with neither field is not stored. Notes are **per dataset**: the same schema can carry different notes in two datasets.
- **Saving.** Notes are saved with the dataset by **Save dataset**, through `POST /datasets` (`schemas` in the body). A body with `schemas` replaces the stored notes; the backend keeps only notes for schemas that still have an included entity and rejects an unknown layer with `layer must be one of: landing, normalized, consumption`. A body **without** `schemas` keeps the stored notes: Testing Data re-registers its sample datasets this way, so a reload does not wipe them.
- **Editing UI (Edit dataset / New dataset page).**
  - Selecting a schema row in the catalog tree shows, in the right-hand details panel, a **Layer** dropdown and a **Description** textarea (placeholder "What this schema holds and what it is used for", max 500) above the schema's existing details. Changes are kept in the page until **Save dataset**.
  - The schema row in the tree shows a layer badge after its entity count when a layer is set, with the description as the badge's (or row's) tooltip.
  - Opening a dataset restores its notes; a new dataset and a datasource switch start with none.
- **Assistant context.** When at least one schema in a session's datasets has a note, the dataset orientation block the agents receive (`entityOrientationLines`, used by sessions and the assistant evals) gains a "Schema notes" section listing each noted schema with its layer and description, and one line of guidance: prefer the Consumption layer for analysis when the same data exists in several layers, unless the user asks otherwise. With no notes, the block is byte-identical to today.
- **Existing data:** datasets saved before this change have no notes. No migration.

## Out of scope

- Layer or description on datasources, catalogs or entities (tables).
- (Bug BA-322 is in scope by the user's choice on 2026-11-09: found while testing this epic, fixed on the same branch.) (A first cut on datasources was built and reverted on this branch on 2026-11-09 after the requirement was clarified.)
- Sharing notes across datasets, or storing them on the datasource.
- Changing tools (`list_entities`, `describe_entity`) or the SQL verifier and knowledge-bootstrap schema blocks.
- Filtering or grouping the tree by layer; custom layers.
- Setting notes on the Testing Data samples.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-319](https://halo-powered.atlassian.net/browse/BA-319) | Layer and description on dataset schemas, used by the assistant | 1.20.1 |
| [BA-322](https://halo-powered.atlassian.net/browse/BA-322) (Bug) | Data Readiness fails on a Databricks host saved with `https://` | 1.20.2 |

## Specs touched

- [capabilities/datasets](../../capabilities/datasets/spec.md): schema notes rules (values, limits, per-dataset scope, replace vs keep-on-omit, orphan pruning), the details panel and tree row in the UI section, a new Gherkin scenario.
- [system/api.md](../../system/api.md): `POST /datasets` body `schemas`, the new failure message, and the dataset shape returned by `GET /datasets`.
- [system/data-model.md](../../system/data-model.md): the dataset document's `schemas` field.
- [system/agents.md](../../system/agents.md): the "Schema notes" section of the dataset orientation context.
- [system/ui.md](../../system/ui.md): the Edit dataset tree row and details panel.
- [product/glossary.md](../../product/glossary.md): "Schema layer" and "Schema note".

No ADR: an optional field on an existing document and an extra section in an existing context block, with no new collection, container or data flow.

## Acceptance

- In Edit dataset, selecting the `tpch` schema, choosing Layer "Consumption" and typing a description, then **Save dataset**: the tree row shows a "Consumption" badge, and after a reload and reopening the dataset the details panel shows both values.
- A dataset saved before this change opens normally with no badges and Layer "None".
- Excluding every entity of a noted schema and saving drops that schema's note.
- Loading a Testing Data sample again keeps notes the user set on its dataset.
- `POST /datasets` with an unknown layer fails with `layer must be one of: landing, normalized, consumption`.
- A session over a dataset with schema notes sends the "Schema notes" section in its context; a dataset without notes produces the same context as before (unit-tested, byte for byte).
- Backend and frontend unit tests, `python3 scripts/check-specs.py`, lint, builds and the Datasets Playwright scenarios (including the new one) pass on the web target.
- **Eval gate:** the assistant's input changes, so the assistant eval set runs at 100 %, plus one new case whose dataset has two copies of the same table in Landing and Consumption schemas and whose expected SQL reads the Consumption one.

## Dependencies, risks and open questions

- **Depends on** the datasets capability (catalog browser, inclusion, save) and the session context assembly in `SessionsService.agentContext`.
- **Risk:** the eval round costs LLM credit; check the provider has credit before the gate (retrospective, 2026-10).
- **Risk:** prompt growth. One line per noted schema, descriptions capped at 500 characters; datasets rarely have more than a few dozen schemas.
- **Open question:** none at drafting time. Per-dataset scope, right-panel editing with a tree badge, use in agent context, and removing the datasource-level fields were settled with the user on 2026-11-09.

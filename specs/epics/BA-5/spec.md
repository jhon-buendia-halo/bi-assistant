# BA-5 — Data Connectors

- **Jira:** [BA-5](https://halo-powered.atlassian.net/browse/BA-5) · **Roadmap:** Milestone 1.5 · **Status:** Draft (to be confirmed by the user)

## Goal
Beta users can connect to the sources they actually have. Each connector gives reliable connection setup, schema discovery and read-only querying.

## Scope
- **Databricks:** SQL warehouse via host, HTTP path and token; catalog, schema and table discovery through Unity Catalog; read-only SQL.
- **Postgres:** host, port, database and credentials with SSL; schema, table and column discovery; read-only SQL.
- **REST API:** per-API auth, endpoint discovery from OpenAPI specs, JSON responses mapped into tabular datasets.

## Out of scope
- Write access to any source.
- Other source kinds (MongoDB, CSV, JSON files: see the Data Model DSL backlog in [BA-2](../BA-2/spec.md)).

## Stories
| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-6](https://halo-powered.atlassian.net/browse/BA-6) | Databricks | 1.5.1 |
| [BA-7](https://halo-powered.atlassian.net/browse/BA-7) | Postgres | 1.5.2 |
| [BA-8](https://halo-powered.atlassian.net/browse/BA-8) | Rest API | 1.5.3 |

## Specs touched
- Capabilities: [datasources](../../capabilities/datasources/spec.md) (connection config, test, discovery, read-only guard per kind), [datasets](../../capabilities/datasets/spec.md) (catalog browsing per kind), [testing-data](../../capabilities/testing-data/spec.md) (sample fixtures per kind).
- System: [api](../../system/api.md) (datasource endpoints), [data-model](../../system/data-model.md) (connection documents, secrets at rest), [ui](../../system/ui.md) (datasource form states).

## Acceptance
Jira stories have no description; the roadmap drafts these from the epic. To be agreed per story, starting from:
- Connection setup validates and reports failures clearly in the form and in diagnostics.
- Discovery lists catalogs, schemas, tables and columns (Databricks), schemas, tables and columns (Postgres), endpoints from an OpenAPI spec (REST).
- Only read-only statements run.
- The existing World Cup datasource scenarios stay green.

## Dependencies, risks and open questions
- **Already built:** `backend/src/modules/datasources/connectors` has `databricks`, `postgres` and `rest` connectors plus OpenAPI discovery, each with unit tests. The epic is about hardening to beta quality: what is the gap per connector? Known hint: the Postgres connector sets `ssl: { rejectUnauthorized: false }` when SSL is on, so certificate verification and SSL modes need a decision.
- All three stories have no description; the beta definition of "reliable" is not written down.
- Real-source verification needs a Databricks workspace and a REST API with auth; availability for CI is unknown.

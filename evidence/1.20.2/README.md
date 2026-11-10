# 1.20.2 — Data Readiness fails on a Databricks host saved with https:// (BA-322)

Live check on 2026-11-09 against the user's Databricks workspace, using the datasource exactly as stored (host `https://dbc-65138206-d21f.cloud.databricks.com/`, not re-saved), calling the data-readiness profiler directly (`columnStats` on `samples.tpch.region`):

| Build | Result |
|---|---|
| `main` | `profiler FAILED: request to https://https//dbc-65138206-d21f.cloud.databricks.com:443/sql/1.0/warehouses/544d7a7b84d857ed failed, reason: getaddrinfo ENOTFOUND https` |
| branch (aa82847) | `profiler OK: {"totalRows":5,"nullCounts":{},"distinctCounts":{"r_regionkey":5},"minValues":{"r_regionkey":"0"},"maxValues":{"r_regionkey":"4"}}` |

Unit tests: `connectors/databricks-host.spec.ts` (5 host variants), `databricks-profiling.spec.ts` ("connects with the bare hostname when the stored host has https:// and a trailing slash" — fails without the fix, checked), `datasources.service.spec.ts` (a Databricks save stores the bare hostname). datasources + data-readiness suites 379/379 at the time of the fix.

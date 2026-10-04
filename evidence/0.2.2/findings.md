# 0.2.2 — Findings from the spec backfill

Backfilling `specs/` from the code (BA-90) turned up bugs, security gaps and drift. Each one is recorded as an *Open question* in the spec named. Specs describe the code **as it is**: none of these were fixed. Each bug and security gap is filed as a Jira bug under [BA-11](https://halo-powered.atlassian.net/browse/BA-11) Bug Fixes and mirrored in roadmap Milestone 1.7. The drift items need decisions, not bug fixes.

## Likely bugs

| # | Jira | Finding | Spec |
|---|---|---|---|
| 1 | [BA-91](https://halo-powered.atlassian.net/browse/BA-91) | **Redaction leak:** `Authorization: Bearer abc123` is redacted to `Authorization: [REDACTED] abc123`. The key-value rule consumes "Bearer" before the bearer rule runs, so the token survives in logs and exports. | [diagnostics](../../specs/capabilities/diagnostics/spec.md) |
| 2 | [BA-92](https://halo-powered.atlassian.net/browse/BA-92) | **Visual version collision after revert:** a new version is `currentVersion + 1`. Revert v3 → v1, then tailor or repair, and v2's files are overwritten and `versions[]` gets a duplicate entry. | [visuals](../../specs/capabilities/visuals/spec.md), [data-model](../../specs/system/data-model.md) |
| 3 | [BA-93](https://halo-powered.atlassian.net/browse/BA-93) | **Interrupted eval runs stay `running` forever.** Nothing reconciles them after a backend stop, and the UI hides their delete button. | [agents-evals](../../specs/capabilities/agents-evals/spec.md) |
| 4 | [BA-94](https://halo-powered.atlassian.net/browse/BA-94) | **Auto-repair can drop data:** it rebuilds from the source answer's rows, not the current version's (refreshed) data. | [visuals](../../specs/capabilities/visuals/spec.md) |
| 5 | [BA-95](https://halo-powered.atlassian.net/browse/BA-95) | **Verified-query ids rotate** on re-approval, orphaning `metrics.sourceVerifiedQueryId`. | [verified-queries](../../specs/capabilities/verified-queries/spec.md) |
| 6 | [BA-96](https://halo-powered.atlassian.net/browse/BA-96) | **Testing data overwrites by name:** a hand-made "World Cup PostgreSQL" datasource is replaced by Load and deleted by Remove. | [testing-data](../../specs/capabilities/testing-data/spec.md) |
| 7 | [BA-97](https://halo-powered.atlassian.net/browse/BA-97) | **Editing a dataset under a new name creates a second dataset**; deleting one has no confirmation and silently drops it from sessions. | [datasets](../../specs/capabilities/datasets/spec.md) |
| 8 | [BA-98](https://halo-powered.atlassian.net/browse/BA-98) | **Datasource-only knowledge entries are stored but never reach the assistant.** | [knowledge](../../specs/capabilities/knowledge/spec.md) |
| 9 | [BA-99](https://halo-powered.atlassian.net/browse/BA-99) | **Stale visual baseline:** `application-shell-darwin.png` still shows "Data Sandbox" and "Projects". | [ui](../../specs/system/ui.md) |
| 10 | [BA-100](https://halo-powered.atlassian.net/browse/BA-100) | **Sidebar session order goes stale** after a chat turn (fetched only at startup and on create). | [sessions-chat](../../specs/capabilities/sessions-chat/spec.md) |

## Security gaps

| # | Jira | Finding | Spec |
|---|---|---|---|
| S1 | [BA-101](https://halo-powered.atlassian.net/browse/BA-101) | **Datasource secrets are stored in plaintext** (Postgres password, Databricks token, REST credentials); only the LLM key is encrypted. The README claims otherwise. REST headers are neither encrypted nor masked. | [data-model](../../specs/system/data-model.md), [datasources](../../specs/capabilities/datasources/spec.md) |
| S2 | [BA-102](https://halo-powered.atlassian.net/browse/BA-102) | **The desktop backend binds all interfaces with CORS on and no auth.** Anyone who can reach port 3000 can read data and use the stored LLM key. Only the CLI defaults to `127.0.0.1`. | [api](../../specs/system/api.md), [non-functional](../../specs/product/non-functional.md) |
| S3 | [BA-103](https://halo-powered.atlassian.net/browse/BA-103) | **SQL is not scoped to the session's datasets:** `run_readonly_sql` does not check the entities a statement names. | [datasources](../../specs/capabilities/datasources/spec.md) |
| S4 | [BA-104](https://halo-powered.atlassian.net/browse/BA-104) | **The read-only guard is a keyword blacklist.** Databricks relies on it alone; it also rejects harmless queries (`replace(...)`, `;` in literals). | [datasources](../../specs/capabilities/datasources/spec.md) |
| S5 | [BA-105](https://halo-powered.atlassian.net/browse/BA-105) | **PostgreSQL SSL skips certificate verification** (`rejectUnauthorized: false`). | [datasources](../../specs/capabilities/datasources/spec.md) |
| S6 | [BA-106](https://halo-powered.atlassian.net/browse/BA-106) | **Fixed default `APP_SECRET`** when none is set (a warning only). | [non-functional](../../specs/product/non-functional.md) |
| S7 | [BA-107](https://halo-powered.atlassian.net/browse/BA-107) | **Web-mode diagnostics export is not redacted.** | [diagnostics](../../specs/capabilities/diagnostics/spec.md) |

## Drift and decisions needed

- **Roadmap vs code:** much of BA-5 (all three connectors), BA-12 (reliability signals) and BA-4 (basic knowledge store) already exists, and the `docs/plans/` phases look shipped. The epic specs (`Status: Draft`) flag what is genuinely new.
- **BA-2:** its stories were deleted and the work sits on the unmerged `origin/ba-2-epic-kickoff` branch.
- **Product name:** "Halo BI Assistant" (window, installer) vs "Questions to Insights" (package, report title, heading).
- **API error styles:** most endpoints return `200 {ok:false}`; some use real 4xx. Two unused endpoints (`POST /sessions/:id/messages`, `POST /knowledge/bootstrap`).
- **`backend/test/app.e2e-spec.ts`** is the stale Nest scaffold.
- **Agent id:** the visual designer is registered as `visualization` (CLAUDE.md said `interactive-visual-designer`).

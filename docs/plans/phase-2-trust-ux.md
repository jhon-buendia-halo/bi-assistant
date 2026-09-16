# Phase 2 execution plan — Trust UX

From `docs/research/competitive-research-and-improvement-plan.md` §3 Phase 2 (items 5-8). Two workstreams. Contract between them is fixed here; keep it exact.

## Shared contract (types on `ChatMessage` / `ToolDataRecord`)

`backend/src/modules/projects/entities/project.entity.ts` (mirror in `frontend/.../models/project.model.ts`):

```ts
interface ToolDataRecord {
  // existing fields unchanged, plus:
  /** True when rows were clipped anywhere: query hit its row limit, or storage kept fewer rows than the tool returned. */
  truncated?: boolean;
}

interface ChatMessage {
  // existing fields unchanged, plus:
  /** Answer's final SQL matches a stored verified query (or was promoted via thumbs-up). */
  verified?: boolean;
  /** Deterministic one-line provenance summary, built server-side. */
  interpretation?: string;
}
```

## Workstream A — Backend

### Item 5: "How was this computed" data

- Build `interpretation` deterministically at persist time in `streamMessage` (and `sendMessage`) when `data` has successful SQL records. Format (single line):
  `Computed from <k> quer<y|ies> over <entity, entity, …> — <sum of rowCount> rows analyzed.`
  Use `sourceEntities(data)`; omit when no SQL ran. No LLM call — provenance text must not depend on model output (same principle as the visual frame).
- No new endpoint: field rides on the persisted message.

### Item 6: Verified-answer badge

- At persist time, compare the answer's last successful `run_readonly_sql` SQL against stored verified queries (`VerifiedQueriesService`): normalize (lowercase, collapse whitespace, strip trailing `;`) and exact-match. Match → `verified: true`.
- Thumbs-up feedback (`recordFeedback` from Phase 1) also sets `verified: true` on the message; thumbs-down clears it.
- Add `VerifiedQueriesService.isVerifiedSql(sql, datasourceId?)` for the persist-time check (keep normalization in one exported helper, unit-tested).

### Item 7: Clarifications — keep work, widen usage

Full mid-turn suspend/resume of the SSE stream is out of scope (deliberate). Instead:

- **Persist collected data on the clarification message**: in `streamMessage`, when a clarification ends the turn, attach the already-collected `data` records and derived `entities` to the clarification message (fields exist on `ChatMessage`) so partial work is visible and not lost.
- **Prompt changes** (`assistant.agent.ts` + `clarification.tool.ts` description): clarification is also allowed mid-analysis when a filter value, member/entity name, or timeframe is genuinely ambiguous against the real data (e.g. several plausible matching values found via sample values) — still at most ONE per user question; options must quote actual data values when the ambiguity is about values. After the user answers, continue the analysis without re-asking.
- Keep the abort behavior otherwise (cards render, answer arrives as next message).

### Item 8: Truncation markers

- `toolDataRecord()` (projects.service.ts): set `truncated: true` when `rowCount > rows.length` stored (STORED_ROWS_CAP) — this already implies clipping.
- Bridge `runReadOnlySql` result: when the connector returns exactly `limit` rows, append to the tool result a `note: 'row limit <limit> reached — results may be incomplete; aggregate or narrow the query for exact totals'` so the model sees it. Set `truncated` on the record in that case too (rowCount === limit).
- Assistant instructions: one line — when a result hit the row limit, either re-aggregate or state the possible truncation in the answer.
- Visuals: `visualizationData` (visualization.service.ts) caps rows at 100/40k chars — return alongside the capped rows a `truncatedFrom?: number` (original row count) and thread it into (a) the designer prompt (`<data>` block header: "showing first N of M rows") and (b) the visual frame's data-provenance section in `visualization-document.ts` ("chart built from the first N of M rows"). The frame text is deterministic, not from the designer model.

### Tests
Extend `projects.service.spec.ts`: interpretation line built, verified flag set on SQL match, clarification message carries data, truncated flags on both paths. `verified-queries.service.spec.ts`: `isVerifiedSql` normalization. Visualization: truncatedFrom propagation (mock designer).

## Workstream B — Frontend

Files: `project-chat.html/.ts/.scss`, `models/project.model.ts` (mirror contract fields only).

### Item 5 UI
- On assistant messages with `interpretation`: render the line above the existing "Data entities" / "Data used" expandables, styled as a subtle single-line caption (e.g. zinc-500, small), prefixed "Interpreted as:" — actually render exactly the server text, prefix `How:` no — use a small info icon + the server-provided text verbatim. Keep it one line, truncate with ellipsis + title tooltip.
- Inside the existing "Data used" expandable, per record: keep SQL display; add a small copy-SQL button (same idiom as the message Copy button).

### Item 6 UI
- `verified` messages: small emerald check-badge chip ("Verified") next to the timestamp/actions row, tooltip "Matches an approved query". Also flip it live after a successful thumbs-up (project refresh already returns the updated message).

### Item 8 UI
- In "Data used" records where `truncated`: after the row count, append "(truncated)" in amber-ish muted text with tooltip "Row cap reached — counts may be incomplete".

### Constraints
- Same stream-safety rule as Phase 1: never abort an in-flight stream on same-id project refresh; patch local message state the same way feedback does.
- Standalone components + signals, Tailwind v4, lucide icons (`badge-check`, `info`, `copy`). Match existing chat idioms exactly.
- Build + existing specs must pass; add a spec only where a pure helper warrants it.

## Verification (both)
`npm run build` + tests in backend and frontend. No commits — leave in working tree. No AI attribution anywhere.

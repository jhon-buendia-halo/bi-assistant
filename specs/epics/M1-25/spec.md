# M1-25 — Query inspector: every figure links to its query

- **Roadmap:** Milestone 1.25 · **Status:** Confirmed (2026-11-15, the user: "vamos con la C", after three wireframed proposals, then four picked decisions: figures linked in code, the steps explained by a model when a query is opened, exact step counts on demand, the Run panel of Answer a Business Question first.)

## Goal

A user of Answer a Business Question could not tell how the agent built its queries, and distrusted an answer after seeing a `LIMIT 100`. After this epic:

- Each figure in an answer links to the query that produced it.
- Each query is explained step by step in business words, with a coverage label that says how much of the data its result stands for, and any `LIMIT` or row cap explained in plain words.
- The full result is one click away.

The pattern is built once in the shared layer, so every agent that answers from data gets it by using the dataset tools (the rule in `CLAUDE.md`, *Non-negotiables*, detailed in the `agent-change` playbook).

## Scope

- **Evidence beside the data.** Each data-gathering tool call of an answer gets a `QueryEvidence` entry, kept in `ChatMessage.evidence` beside `data`: its coverage (`whole-table`, `top-n`, `sample`, `partial`), the rows the statement produced before the tool's row cap, the tool's cap, its datasource and, filled later, the size of each table it reads and its explanation. No model input changes.
- **Figure chips.** The answer view matches each number and date in the answer text against the cells of the answer's query results, in code, and shows a chip (`Q1`, `Q2`) after each match.
- **Coverage line and query rows** under the answer, replacing `How I worked this out` and `Data used` in a host that shows the inspector.
- **The query inspector.** A sheet with the tabs Step by step, Result and SQL, and Download all rows (CSV), Re-run and Copy SQL.
- **The System agent `query-explainer`** (Hannah): one model call, no tools, when a query is first opened; its steps are stored with the run.
- **Step counts on demand**, shown only when they pass the checks (the first equals the table's size counted in code, the last equals the rows the query produced).
- **Endpoints 139 to 143** on a stored run's answer.
- **Hosts:** the Run panel of Answer a Business Question and, for a stored run of it, the run detail page of the Runs area (added 2026-11-15, when a past run opened there; since PR #108 a finished run opens on its workflow page, and this page shows a run still running or a legacy run).

Plan and contract: [docs/plans/m1-25-query-inspector.md](../../../docs/plans/m1-25-query-inspector.md).

## Out of scope

- Other hosts of the answer view: a user agent's Try it, past chats, the Data Readiness Agent. They keep `How I worked this out` and `Data used` until a later story connects them.
- Any change to an agent's prompt, tools or tool descriptions, and to the Answer a Business Question workflow's steps.
- Citations written by a model. A figure the model derived that is in no result cell gets no chip.
- Live narration of a running step (proposal B of 2026-11-15).
- Evals for `query-explainer`.

## Stories

| Story | What | Wave |
|---|---|---|
| 1.25.1 | Backend evidence layer: row totals, coverage, table sizes, re-run and CSV | 1 |
| 1.25.2 | Answer view: figure chips, coverage line and query rows | 1 |
| 1.25.3 | The query explainer and the step counts | 2 |
| 1.25.4 | The inspector and its Run panel host | 2 |
| 1.25.5 | The run detail page hosts the inspector | 3 |

## Specs touched

- `specs/capabilities/agent-answers/spec.md`: the query inspector's rules; R32 and R33.
- `specs/capabilities/workflows/spec.md`: R13 and a rule for the inspector on the workflow page.
- `specs/capabilities/datasources/spec.md`: the `Data used` line.
- `specs/system/api.md`: endpoints 139 to 143 and `answer.evidence`.
- `specs/system/data-model.md`: `ChatMessage.evidence` and `QueryEvidence`.
- `specs/system/agents.md`: `query-explainer`, the side channel of the dataset tools, and the persist step.
- `specs/system/ui.md`: 4.4b and 4.12.

## Acceptance

- An answer of Answer a Business Question whose figures come from its queries shows a chip after each of them, and a click opens the inspector on that query.
- A query with `ORDER BY … LIMIT 100` that returned 100 rows reads `Top 100 after ranking`, and its last step says that only the list is shortened. A query cut at the tool's cap reads `Partial result`. A `LIMIT` with no sort reads `Sample`.
- The request each agent's model receives is byte-identical on base and branch (no `totalRows` in a tool result; the prompt and tool-list hashes are equal).
- Step counts are shown only when verified; otherwise the inspector says they could not be verified.
- Re-run never changes the stored answer.
- A host that does not turn the inspector on renders an answer exactly as before.

## Dependencies, risks and open questions

- **Risk: a false link.** A common number (`100`) can match a cell by chance. Mitigations: whole numbers under 10 are skipped, dates are consumed whole, and a match needs the shown precision.
- **Risk: slow counts.** `COUNT(*)` on a very large table can hit the datasource timeout. The size then reads as unknown and the step counts cannot be verified.
- **Risk: the tool call id is missing** inside a workflow step's agent stream. The facts are then keyed by the SQL text.
- **Open:** connecting the other hosts, and whether the live block of a running step should use the same query rows (proposal B).

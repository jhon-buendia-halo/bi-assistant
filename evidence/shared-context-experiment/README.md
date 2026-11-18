# Experiment: shared run context (approach B) vs the current Answer a business question

**Question.** Instead of handing every agent of `answer-business-question` the
large context in its prompt (the catalog's columns, the queries' rows, image
notes), publish it once per run to a board and give each agent a short index
plus two read tools (`list_run_context`, `read_run_context`), so it reads only
what it needs. Is that cheaper, faster or better?

**What was built** (experiment only; see [agents.md](../../specs/system/agents.md) 3.16, 5.11, 8.1):

- `answer-business-question-shared`: the same graph plus a **Publish run
  context** step after Load catalog; registered in Mastra, not in the
  catalogue, no UI.
- Shared-mode Plan and Write answer (`planWithSharedContext`,
  `writeAnswerWithSharedContext`) and Analyse blocks; the baseline's requests
  are pinned unchanged by unit tests.
- Eval set `insights-analyst-shared-context`: the 11 `insights-analyst` cases,
  same checks and judge (the judge reads the full catalog in both variants).
- `scripts/llm-meter-proxy.mjs` (one proxy per variant in front of
  CLIProxyAPI, logging each call's tokens, cache tokens, caller and duration)
  and `scripts/compare-shared-context.mjs` (the report).

Design brief: [design-brief.md](design-brief.md). Driver: [run-experiment.sh](run-experiment.sh).

## Method

- Model `claude-sonnet-5-5` through CLIProxyAPI (Anthropic style), on fresh
  copies of one seed data dir ("World Cup" dataset, PostgreSQL on 55432).
- Per round both variants run **at the same time** (same endpoint load), 3 rounds each.
- "Cost" weighs each call at Anthropic's relative prices: input 1, cache write
  1.25, cache read 0.1, output 5. Almost all input went through the prompt cache.
- Tokens exclude the eval judge ("sin juez") unless said otherwise.

## v1 — the build as first designed

[Report](v1/report.md) · raw data per round in `v1/<variant>/round-<n>/`.

| | baseline | shared (B) | change |
| --- | --- | --- | --- |
| Pass rate | 33/33 | 30/33 | −3 |
| Cost per case (cache-weighted) | 28,404 | 39,604 | **+39 %** |
| Input tokens per case | 37,223 | 62,115 | +67 % |
| Output tokens per case | 2,525 | 3,123 | +24 % |
| LLM calls per case | 4.9 | 8.2 | +66 % |
| Mean / median case latency | 46.7 s / 28.2 s | 79.8 s / 46.1 s | +71 % / +64 % |
| Board reads per case | — | 9.3 (4.2k chars) | |

Why it lost: every read is one more model round trip, and each round trip
re-sends the whole prompt (instructions, tools, conversation). The context B
avoids inlining is small on this dataset (9 tables): the index plus the reads
cost more than the inline block. Two of the three failures were empty answers:
Write answer kept reading the board until it ran out of tool steps (it re-read
the same queries and read catalog entries outside its index). The third was a
judged fact without a query behind it.

Fixes after v1 (an independent review found the same risks): the loop's last
step runs without tools (`prepareStep`), Plan and Write answer get 8 steps,
running out of steps is a cut reply (retried, then a failure, never an empty
answer), Analyse gets 3 extra steps for the reads, a wrong board key is a miss
(`found: false`), not a tool error, and the proxy logs aborted calls.

## v2 — after the fixes: not measured

Two attempts at the three confirmation rounds did not finish on a healthy
endpoint. Other eval runs shared CLIProxyAPI at the same time, and single
calls of **both** variants hung for 30–86 minutes, or were aborted at the
model-call deadline. The partial first round is kept in
[v2-incomplete/](v2-incomplete/) only as a record. Its failures are timeouts,
not answers, and it supports no comparison. The fixes are covered by unit
tests (`answer-business-question.agents.spec.ts`, `run-context.tools.spec.ts`,
`insights-analyst-workflow-target.spec.ts`, `scripts/*.test.mjs`).

To measure v2, run `run-experiment.sh 1 3` with `OUT_DIR=…/runs-v2` when no
other eval runs on the endpoint. Then run
`node scripts/compare-shared-context.mjs --baseline runs-v2/baseline --shared runs-v2/shared --out <report>`.

## Conclusion (from v1)

On this dataset B costs more on every axis, and the fixes cannot change the
main reason. They remove the empty answers, but each board read is still a
model round trip that re-sends the prompt.

B can only win when the inline context is much larger than what an agent
actually reads, for example a catalog of hundreds of columns of which a
question uses a few, or many large query results. A cheaper variant of the
same idea is to keep the context inline but select it in code: send only the
entities the plan names, instead of letting the model fetch them. It saves the
tokens without adding round trips.

Approach A (Mastra workflow state, no prompt change) is not affected by this
result. It removes the copying of data between steps and makes the context
survive a resume, at no cost in model calls.

# Experiment: a shared run context for Answer a business question

**Date:** 2026-11-17/18. **Status:** concluded, not adopted. **Code:** not merged. It lives on branch
`jhon-buendia-halo/global-state-workflow-review`, commit `9fed4439`.

## Question

Today every agent of the `answer-business-question` workflow gets the large context in its prompt: Plan
and Analyse get the catalog with its columns, Write answer gets every query with its rows, and the image
notes go to all three. The alternative (approach B) publishes that context once per run to a shared board,
a kind of per-workflow "chat" or global state. Each agent then gets a short index of the board plus two
read tools (`list_run_context`, `read_run_context`) and reads only the entries it needs.

The experiment asks whether B is cheaper, faster or better than the current approach.

## Other systems that use this idea

The idea is common. Three patterns appear across frameworks:

| Pattern | Examples | How it works |
| --- | --- | --- |
| **Shared transcript** | AutoGen group chat, OpenAI Agents SDK and Mastra supervisor handoffs (by default) | Every agent reads the whole thread. |
| **Typed shared state, each agent reads its keys** | Mastra workflow state (`stateSchema`/`setState`), LangGraph `State` with reducers, Google ADK `session.state` with `output_key` and `{key}` templating, CrewAI `Task.context` | Code decides which keys each step receives. |
| **Board read on demand** | MetaGPT's message pool, the blackboard LLM-MAS papers (e.g. arXiv 2510.01285, 2507.01701), Anthropic's "pass lightweight references" guidance | Agents fetch what they need. |

Approach B is the third pattern, with the agents doing the reading.

## What was built

- A second workflow, `answer-business-question-shared`. It is the same graph with one added code step,
  *Publish run context*, after Load catalog.
- The board, keyed by entry:
  - `catalog/<entity>`: the columns of one entity;
  - `image-notes`: the notes on the reference images;
  - `queries/<n>`: a query with at most 50 rows;
  - `earlier-queries`: the queries of the earlier attempt, on a retry.
- Plan and Write answer ran in a short tool loop. Analyse got the two tools beside its own.
- The current workflow's requests stayed byte-identical; unit tests pinned this.
- An eval set holding the 11 `insights-analyst` cases, with the same checks and the same judge. The judge
  read the full catalog in both variants.
- A metering proxy in front of the LLM endpoint, run once per variant. For each call it logged the tokens,
  the cache tokens, which agent made the call and how long it took.

## Method

- Model `claude-sonnet-5-5` through the local CLIProxyAPI (Anthropic style).
- Each run used a fresh copy of one seed data dir: the "World Cup" dataset, 9 tables in PostgreSQL.
- 3 rounds per variant. In each round both variants ran **at the same time**, so they shared the endpoint
  load. That makes 33 cases per variant.
- **Cost** weighs each call at Anthropic's relative prices: input 1, cache write 1.25, cache read 0.1,
  output 5. Almost all input went through the prompt cache: 2.4 M tokens read from cache, 1.2 M written to
  cache and about 1 k uncached.
- The figures below are for the workflow's own calls; they exclude the eval judge.

## Results

| Per case | Current | Shared board (B) | Change |
| --- | --- | --- | --- |
| Cases passed | **33/33** | **30/33** | −3 |
| Cost (cache-weighted units) | 28,404 | 39,604 | **+39 %** |
| Input tokens | 37,223 | 62,115 | +67 % |
| Output tokens | 2,525 | 3,123 | +24 % |
| Model calls | 4.9 | 8.2 | +66 % |
| Mean case latency | 46.7 s | 79.8 s | +71 % |
| Median case latency | 28.2 s | 46.1 s | +64 % |
| Board reads | — | 9.3 (4.2 k chars) | |

Per agent (per case):

| Agent | Calls, current → B | Input tokens, current → B | Cost, current → B |
| --- | --- | --- | --- |
| Plan | 1.00 → 2.06 | 2,436 → 7,575 | 2,018 → 6,144 |
| Analyse | 3.00 → 3.85 | 32,197 → 44,783 | 19,748 → 22,915 |
| Write answer | 0.91 → 2.09 | 2,541 → 9,417 | 6,542 → 9,856 |

Where the reads went, over 33 cases:

| Agent | Board entries read | Reads |
| --- | --- | --- |
| Plan | catalog | 119 |
| Analyse | catalog | 89 |
| Analyse | earlier queries | 3 |
| Write answer | queries | 93 |
| Write answer | catalog | 3 (entries outside its index) |

Cases that failed under B:
- `ranking-ties-busiest-stadium` passed 1 of 3.
- `coverage-group-stage-wins` passed 2 of 3.
- Every other case passed 3 of 3 in both variants.

## Why B lost

1. **Every read is another round trip, and every round trip re-sends the prompt.** The instructions, the
   tools and the conversation go to the model again with each tool step. Prompt caching makes the repeat
   cheap, but not free: cache reads cost 0.1 and new tool results are written to cache at 1.25.
2. **The context B avoids is small on this dataset.** With 9 tables, the inline catalog costs less than
   the index plus the reads. The agents read most of what they would have received anyway: Plan read about
   3.6 catalog entries per case.
3. **The tool loop can fail in ways the single call cannot.** Two of the three failures were empty answers:
   Write answer kept reading, re-reading the same queries and asking for catalog entries outside its index,
   until it ran out of tool steps. The third failure was a figure the judge found no query behind.

After the measured rounds, those failure modes were fixed in code:
- the loop's last step runs without tools;
- running out of steps counts as a cut reply, which is retried and then fails the step;
- there are more steps for the reads;
- an unknown key is a lookup miss, not a tool error.

The fixes were not measured, because two confirmation runs failed for reasons outside the experiment: the
shared endpoint was overloaded by other eval runs, and later single calls hung. The fixes can only remove
the empty answers. They do not change the cost of the extra round trips.

## Conclusion

- **Do not adopt agent-pulled shared context (B) for this workflow.** It costs more on every axis and
  answers slightly worse.
- B pays off only when the inline context is much larger than what an agent reads, for example a catalog
  of hundreds of columns of which a question uses a few. Even then, a cheaper way to get the saving is to
  select the context **in code**: send only the entities the plan names, with no extra round trips.
- **Typed workflow state (Mastra `stateSchema`/`setState`, approach A) is still worth doing.** It replaces
  the copying of the question, catalog and image notes through every step's data, and it keeps the context
  across a suspend and resume. It adds no model calls.

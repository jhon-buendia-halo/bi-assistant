# BA-217 backend: proposed spec wording changes

Notes from the backend work on BA-217 (roadmap 1.14.2). Each item says where the spec text is incomplete or out of step with what was built. Nothing here changes behaviour that the spec already pins down.

## 1. agents.md 2.1: line breaks for the `sample_rows` replacements

The spec gives the replacement words, "step 1 of the method reads `(list_entities, describe_entity)`; A5 reads `(via describe_entity)`; A19 reads `run_readonly_sql takes a rationale`", but no line breaks, even though it says "Each replacement is sent with the line breaks shown". The build keeps each existing break:

```
1. Map the question to concrete entities and columns (list_entities,
   describe_entity).
```
```
then the options must quote the actual values you found (via
describe_entity), not invented ones. When only the scope is fuzzy —
```
```
- run_readonly_sql takes a rationale. Write it in the
  first person for a business reader: ...
```

Proposed: add to the `sample_rows` bullet, "The existing line breaks are kept: only the words around `sample_rows` are removed (A5's two lines become `…you found (via` / `describe_entity), not invented ones. …`)."

## 2. agents-evals spec: the World Cup question table is missing the two new cases

agents.md 8.1 says "The question list is in agents-evals", but the table in `specs/capabilities/agents-evals/spec.md` (around the `ambiguous-best-team` and `visual-request` rows) still has 10 World Cup rows. Proposed rows:

| `no-clarification-best-team` | Which team performed best? | run with the tools `sample_rows` and `visuals` (no `ask_clarification`); called `run_readonly_sql`; did not call `ask_clarification`; no tool errors; judge: the answer names the measure it took as "best" and gives figures for it |
| `no-visuals-chart-request` | Show me a chart of goals scored per World Cup tournament. | run with the tools `sample_rows` and `ask_clarification` (no `visuals`); called `run_readonly_sql`; did not call `create_visual`; no tool errors; judge: the answer says it can't draw a visual here and gives the goals per tournament (23 in 2018, 24 in 2022) |

Any line there that counts the World Cup set (10) also needs to say 12.

## 3. The no-visuals judge rubric states the fixture's totals

Following the `possession-vs-result` pattern, the `no-visuals-chart-request` rubric names the true answer: the fixture's knockout matches have **23 goals in 2018 and 24 in 2022**, shootout penalties not counted. I worked these figures out from `backend/src/modules/testing-data/fixtures/001_world_cup.sql`, from both `matches.home_goals + away_goals` and the `goals` rows, and the two agree. They have not been run against a live database. Proposed: add "(23 in 2018, 24 in 2022)" to the agents.md 8.1 *Tool selection* bullet so the rubric's fact is in the spec.

## 4. data-model 3.10: how "unpublished changes" compares `tools`

The build compares tool selections with an absent list read as all three tools. A Live version saved before BA-217 (no `tools`) and a draft saved with all three ticked therefore show **no** unpublished changes. Proposed addition after "…not stored.": "When comparing, an absent `tools` list counts as all three tools."

## 5. agents.md 4.1 Block 1 / 8.5: what "left out" covers

- Without `visuals`, the build leaves out the blank separator line, the `Interactive visuals in this session…` heading, the visual lines (or `(none yet)`) and the open-visual line. Block 1 then ends with the dataset half: the hint line, then the join hints when there are any.
- 8.5 says the eval harness sends "only Block 1's dataset half (no visuals lines) plus Block 3". With `agentTools` the dataset half uses the selection's hint variant. Proposed: "…plus Block 3; a case with `agentTools` gets that selection's Block 1 variant (2.1)."
- The eval harness's tool-only synthesis pass (5.5) now gets the case's requestContext, as production turns already do.

## 6. ADR-0021 consequence: tools passed as a function are not in the Mastra tool registry

In @mastra/core 1.66, `Agent` copies only an object-valued `tools` into the Mastra instance's tool registry (`__registerMastra` → `mastra.addTool`). Once `tools` is a function, the assistant's tools are resolved on each call and are no longer listed there. No app code reads that registry. Mastra's own dev studio would no longer list them as standalone tools. Proposed: one line under ADR-0021 *Consequences*.

## 7. Frontend E2E that will go red (not changed here)

`frontend/e2e/agents.spec.ts` asserts `10 questions` and `toHaveCount(10)` for the World Cup set (lines ~70, 84, 241, 257) and `0/10 passed` (~line 252). The set now has 12. Those assertions need 12 and `0/12 passed` in the step-6/7 E2E update.

## 8. Not in the contract, possibly worth adding

`GET /agents/:key/evals` (`AgentEvalCase`) does not expose `agentTools`, so the Evals tab can't show that a case runs with fewer tools. The case's `intent` text says so instead. Add it only if the UI should show the selection.

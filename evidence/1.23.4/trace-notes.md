# 1.23.4 — Trace notes: what a turn looks like in the trace store and in Monitoring

**Question.** Every streamed turn now runs a Mastra workflow. Does the turn's trace gain `workflow_run` / `workflow_step` spans that change what Monitoring shows (turn counts, the agent column, the waterfall)? If so, monitoring R39 would classify them as Framework spans.

**Answer: no.** The workflow run is traced in a trace of its own, with no thread id and no `agent_run`. Monitoring reads sessions and turns from `agent_run` spans ([monitoring](../../specs/capabilities/monitoring/spec.md) R1, R30–R40), so it never sees the workflow trace. The turn's own trace is unchanged. Monitoring R39 is not changed.

## How it was measured

- A backend built from each tree (`npx nest build`), started with `node backend/dist/cli.js --port <free> --host 127.0.0.1 --data-dir <scratch> --no-open --intellify-api-port <free>`. Never 3000, 3100 or 3400; its own data dir; stopped by its PID.
- The model was the recording stub of the Playwright helpers, `frontend/e2e/helpers/llm-stub.ts`, bundled with esbuild and saved as the LenAI provider (`PUT /llm/settings`). No real key.
- Three turns: a plain session (assistant, `agent:assistant`), a v2 session (`agentId: 'assistant-v2'`, `qti-v2-turn`) and an RFP Builder session (after `POST /testing-data/intellify-api/load`, `agent:rfp`).
- Then Monitoring's own endpoints: `GET /monitoring/sessions`, `GET /monitoring/sessions/:id` and `GET /monitoring/traces/:traceId` (with and without `framework=true`). Last, with the app stopped, every span in `observability.duckdb` (`span_events`), grouped by trace.
- Base: `feat/M1-23-workflow-first` at `0c1427d5`. Branch: `unit/M1-23-1.23.4`.

## Raw trace store

Base, the v2 turn (already a workflow run before this story):

```
trace 0981… (thread -)
  workflow_run  | workflow run: 'qti-v2-turn'
    workflow_step | workflow step: 'receive-question'
    workflow_step | workflow step: 'load-catalog'
    workflow_step | workflow step: 'analyse'
    workflow_step | workflow step: 'wrap-up'
trace 1f9c… (thread 2886…)
  agent_run | agent run: 'questions-to-insights-v2'
    memory_operation | memory: recall
    model_generation | llm: 'stub-deployment'
      model_step | step: 0
        model_inference | inference: 0
    memory_operation | memory: save
```

Base, the assistant and RFP turns have only their `agent_run` trace (plus, for the assistant, the grounding pass's own thread-less `agent_run` trace, as always).

Branch, every assistant and RFP turn adds one trace like this, and nothing else changes:

```
trace 6eb9… (thread -)
  workflow_run  | workflow run: 'agent-turn'
    workflow_step | workflow step: 'answer'
trace 75fe… (thread 538c…)
  agent_run | agent run: 'assistant'
    skill_action | skill:resolve
    memory_operation | memory: recall
    model_generation | llm: 'stub-deployment'
      model_step | step: 0
        skill_action | skill:inject
        workspace_action | workspace:mount:instructions
        model_inference | inference: 0
    memory_operation | memory: save
```

The agent is called from the session code, not with the step's tracing context, so its `agent_run` is the root of its own trace, as it was before the story and as v2's always was.

## What Monitoring shows

| | Base | Branch |
|---|---|---|
| `GET /monitoring/sessions` | 3 sessions, 1 turn each; agents `assistant`, `questions-to-insights-v2`, `rfp-builder` | the same |
| Turn of each session | 1 turn, `succeeded`, the agent above, the question and the stub's answer | the same |
| Waterfall, default | `agent_run` › memory recall, model call › request 1, memory save | the same span types and depths |
| Hidden framework spans | assistant 4, v2 1, RFP 3 | the same |
| `workflow_run` / `workflow_step` rows | none | none |

One difference that is not the story's: in the branch's RFP waterfall, the model call is listed before the memory recall. Both started in the same millisecond, and the waterfall orders children by start time (R38), so a tie can fall either way on any run.

## Conclusion

- Turn counts, the agent column, the LLM-calls list and the waterfall read as before, so no span type is reclassified and monitoring R39 stays as it is.
- The thread-less `agent-turn` traces stay in the trace store. They are small (two spans per turn) and, like v2's `qti-v2-turn` traces since ADR-0034, no Monitoring query reads them.
- If a later change runs the agent inside the step's tracing context, the `agent_run` would move under `workflow_run`. Then Monitoring's turn query and R39 would need the change this story planned for.

The scripts and the full JSON captures stayed in the builder's scratch folder (`.qa-reports/b1234/`, git-ignored): `trace.mjs` (the probe), `spans.cjs` (the trace-store dump) and `compare-sse.cjs`.

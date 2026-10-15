# 1.14.8 Tools library, Graph and LLM Config tabs (BA-221): E2E impact (step 6)

Base commit: `origin/main` (`ed2069b`): `GET /agents/:key` has no `toolLinks` and no `llm` ([../1.14.6/base-probes.txt](../1.14.6/base-probes.txt)); the page has a Model tab, no Graph tab.

## Touched → scenarios

| Touched (commit `0f3a14e`) | Scenarios |
|---|---|
| `agent-tool-links` (Tools tab of a user agent) | Agent editor: *Only linked tools are offered* (held in [../1.14.2/](../1.14.2/)), *A linked skill's tools come with it* (held in [../1.14.7/](../1.14.7/)) |
| `agent-graph`, `flow-graph.ts` | Agent editor: *The Graph tab shows the chain…*; Built-in agent prompts: the RFP Builder Graph scenario (held in [../1.14.11/](../1.14.11/)) |
| `agent-llm-config` (Model tab → LLM Config), `llm` on the detail | Agent editor: *The LLM Config tab…*; Agents: *Opens an agent … tabs* |
| `agents.service` (`toolLinks`, `llm`) | Agent definitions (API): *The detail of an agent shows its links and its LLM settings* |

## Decisions

| Decision | Scenario | Spec file | Why it fails on base |
|---|---|---|---|
| Add | Agent editor: The Graph tab shows the chain from instructions to skill to tool | `frontend/e2e/agent-editor.spec.ts` | no Graph tab, no `/skills` |
| Add | Agent editor: The LLM Config tab shows whether the key is set and never the key | `agent-editor.spec.ts` | base's Model tab has no `API key` row (`llm-API key` test id) |
| Add | Agent definitions (API): The detail of an agent shows its links and its LLM settings | `backend/test/user-agents.e2e-spec.ts` | no `toolLinks`/`llm` on base |
| Update (already on the branch) | Agents: Opens an agent from the Agents list and switches between its tabs (saves LLM settings so LLM Config has a model; Tools tab rows read through visible text) | `frontend/e2e/agents.spec.ts` | base has a `pre` prompt as the default tab |
| Re-run as-is | Agents: the other 8 | `agents.spec.ts` | — |
| Delete | none | — | — |

Counts: Add 2 Playwright + 1 API, Update 1 (already on the branch), Re-run as-is 8, Delete 0.

Results: [e2e-results.txt](e2e-results.txt). Screenshots: [agent-graph-chain.png](agent-graph-chain.png), [agent-llm-config-key-set.png](agent-llm-config-key-set.png). Desktop not run.

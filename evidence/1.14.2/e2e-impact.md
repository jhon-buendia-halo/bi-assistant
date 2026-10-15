# 1.14.2 Choose an agent's tools (BA-217): E2E impact (step 6)

Base commit: `origin/main` (`ed2069b`). "Fails on base" was checked against a build of `origin/main` with the probes in [../1.14.6/base-probes.txt](../1.14.6/base-probes.txt): on base an agent whose instructions link `[[tool:sample_rows]]` is still offered every tool (`ask_clarification`, `create_visual`, `update_visual`, `read_file` …), and there is no `/skills` route.

## Touched → scenarios

| Touched (commit `aaad084`, then 1.14.6 links) | Scenarios |
|---|---|
| `mastra/agent-tools.ts`, `assistant-prompt.ts` (tool-free wording), `assistant.agent.ts` (tools and prompt per call), `sessions.service.ts` | Agent editor: *Only linked tools are offered to the model*; Sessions started from an agent: *The agent's tool selection and skills apply to every turn* and the 6 others; Skills the assistant is given: *The assistant is offered only its own skills*; Chat answers: `chat-clarification.spec.ts` (2); Chat and visuals (2); `world-cup-workflow.spec.ts` |
| `user-agents` (`tools` on the draft), `agents.service` (tools on the detail) | Agent definitions (API): *A user agent's detail reports the assistant's tools…*, *Tools and skills are derived from the links* |
| agent editor (Tools fieldset, later replaced by links in 1.14.6) | Agent editor, all scenarios |
| evals (two cases with tools off) | Agents: *Opens an agent … tabs*, *Runs only the ticked questions*, *Separates the question suite…*, *Offers the configured datasources…* (12 questions) |

## Decisions

| Decision | Scenario | Spec file | Why it fails on base |
|---|---|---|---|
| Add | Agent editor: Only linked tools are offered to the model (shared with 1.14.6, which made the selection a link, and 1.14.8, whose Tools tab it checks) | `frontend/e2e/agent-editor.spec.ts` | base has no `+ Link tool` button, offers `ask_clarification`/`create_visual`/`update_visual` to every agent, and has no "You can't ask the user a question back" wording |
| Add | Sessions started from an agent: The agent's tool selection and skills apply to every turn (shared with 1.14.4 and 1.14.10) | `frontend/e2e/agent-sessions.spec.ts` | base has no `/skills` route (the Given fails) and offers every tool |
| Update (already on the branch) | Agent definitions (API): A user agent's detail reports the assistant's tools … (an agent with no links gets only the always-on tools) | `backend/test/user-agents.e2e-spec.ts` | base reports all 8 assistant tools for the agent |
| Update (already on the branch) | Agents: 4 scenarios that count the world-cup set ("12 questions", "Run 12 selected", "0/12 done", "0/12 passed") | `frontend/e2e/agents.spec.ts` | base has 10 cases |
| Re-run as-is | Agent editor: the 8 scenarios that existed on base | `agent-editor.spec.ts` | — |
| Re-run as-is | Sessions started from an agent: the other 6 | `agent-sessions.spec.ts` | — |
| Re-run as-is | Plain assistant (gets every tool, prompt byte-identical): Chat answers 2, Chat and visuals 2, World Cup workflow | `chat-clarification.spec.ts`, `chat-and-visuals.spec.ts`, `world-cup-workflow.spec.ts` | — |
| Delete | none. The checkbox Tools fieldset was replaced by links (1.14.6) before any E2E was written for it, so no scenario tests the checkboxes. | — | — |

Counts: Add 2, Update 2 (already on the branch), Re-run as-is 18 (8 + 6 + 5 + the other 5 Agents scenarios), Delete 0.

Results: [e2e-results.txt](e2e-results.txt). Screenshot: [agent-tools-tab-linked.png](agent-tools-tab-linked.png) (Tools tab: `sample_rows` Linked, the visuals Not linked). Desktop not run (no `desktopOnly()` scenario here).

# 1.14.11 Edit every agent's System Prompt, built-in agents included (BA-224): E2E impact (step 6)

Base commit: `origin/main` (`ed2069b`): `PUT` and `DELETE /agents/assistant/prompt` answer 404 ([../1.14.6/base-probes.txt](../1.14.6/base-probes.txt)); the shipped prompt has no links; there is no System Prompt tab with Edit or Reset and no RFP Builder.

## Touched → scenarios

| Touched (commits `4ecb643`, `807a796`) | Scenarios |
|---|---|
| `agent-prompts.service.ts`, `agents.controller.ts` (routes 103-104, `prompt` on the detail), `agent_prompt_overrides`, `system-prompts.ts`, `shipped-agent-prompts.ts` | Built-in agent prompts: all 7 |
| `assistant-prompt.ts` (the shipped prompt links its tools and skill; mentions reach the model) | Built-in agent prompts: *The shipped assistant prompt shows its tools and skill as chips…*; Skills the assistant is given: *The assistant is offered only its own skills* (`## Tools` before `## Working rules`); Chat answers, Chat and visuals, World Cup workflow |
| `agent-system-prompt` (built-in part), `prompt-editor` (tool-only and text-area modes) | Built-in agent prompts: all 7; Agents: *Opens an agent … tabs* (`agent-prompt-view`), *Shows the stateless, no-tool agents accurately* |
| agent detail Graph for an Official agent | Built-in agent prompts: the RFP Builder Graph scenario |

## Decisions

| Decision | Scenario | Spec file | Why it fails on base |
|---|---|---|---|
| Add | I edit the assistant's prompt, and Reset restores it | `frontend/e2e/builtin-agent-prompts.spec.ts` (new) | no Edit / Reset; route 404 |
| Add | A System agent's prompt is edited in a text area, with no link menu | same | no Edit on base |
| Add | A skill link in the assistant's prompt is refused | same | no Edit on base |
| Add | The shipped assistant prompt shows its tools and skill as chips and the model reads plain mentions | same | base prompt has no links, so no chips and no `Call the "ask_clarification" tool only when` |
| Add | A built-in skill link in the assistant's prompt is accepted | same | no Edit on base |
| Add | The shipped RFP Builder prompt shows its tools and skill as chips and in the Graph tab (the RFP Builder is 1.14.15's; the scenario sits in this Feature) | same | no RFP Builder on base |
| Add | The RFP Builder's prompt links only its own tools and skill | same | no RFP Builder on base |
| Re-run as-is | Agents: Opens an agent … tabs; Shows the stateless, no-tool agents accurately | `agents.spec.ts` | — |
| Re-run as-is | Skills the assistant is given: The assistant is offered only its own skills (golden prompt with no override) | `assistant-skills.spec.ts` | — |
| Re-run as-is | Chat answers 2, Chat and visuals 2, World Cup workflow (the shipped prompt text changed: mentions instead of bare names) | `chat-clarification.spec.ts`, `chat-and-visuals.spec.ts`, `world-cup-workflow.spec.ts` | — |
| Delete | none | — | — |

Permission gating (`edit-policies`) has no scenario: 1.14.19 (BA-232) made the app single-user.

Counts: Add 7 (new spec file), Re-run as-is 8, Delete 0.

Results: [e2e-results.txt](e2e-results.txt). Screenshots: [assistant-system-prompt-modified.png](assistant-system-prompt-modified.png), [assistant-system-prompt-chips.png](assistant-system-prompt-chips.png). Desktop not run.

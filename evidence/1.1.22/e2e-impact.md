# 1.1.22 (BA-244) — E2E impact analysis (workflow step 6)

What the story changed, from round 9's baseline (`0e36211`) to round 13 (`3f6ebba`):

| Module | Change | Who sees it |
|---|---|---|
| `backend/src/mastra/tools/dataset.tools.ts` | `run_readonly_sql`: one more sentence in its description; a note on a grouped result of several rows (round 10); a warning when a LEFT JOIN filter removes no row (round 12) | the model, in the tool's description and result; the Steps panel shows the tool result as it shows any other |
| `backend/src/mastra/tools/left-join-filter.ts` (new) | the check behind the round 12 warning | the model |
| `backend/src/mastra/agents/assistant-prompt.ts` | working rule A41, a masked identity stays masked (round 11) | the model; the agent editor shows the shipped prompt |
| `backend/src/mastra/evals/checks/option-count.ts` | reads clarification options as the tool takes them (round 13) | eval results |
| `backend/src/mastra/evals/pricing.json` | gpt-6-luna priced | eval cost |

No Gherkin step names the text of a tool description, a tool result's note or warning, a prompt rule or a check's verdict: each is pinned by unit tests (`dataset.tools.spec.ts`, `left-join-filter.spec.ts`, `assistant.agent.spec.ts` with the prompt fixture, `option-count.spec.ts`, `eval-usage.spec.ts`). So no scenario is added, updated or deleted.

## Re-run as-is

The specs that drive `run_readonly_sql`, the shipped prompt or a clarification through the recording stub, and the Agents spec of the Evals tab:

| Spec | Why |
|---|---|
| `agent-sessions.spec.ts` | a failing `run_readonly_sql` in the Steps panel; where the knowledge block sits among the system messages |
| `agent-panel.spec.ts` | `run_readonly_sql` results, with `note`, in the side panel |
| `assistant-skills.spec.ts` | the prompt's `## Tools` and `## Working rules` sections, the `run_readonly_sql` line |
| `builtin-agent-prompts.spec.ts` | the shipped assistant prompt in the agent editor, with its tools as chips |
| `chat-clarification.spec.ts` | a clarification with its options, and one sent with none |
| `chat-and-visuals.spec.ts`, `designer-skills.spec.ts`, `visual-tailoring.spec.ts` | chat turns that call `run_readonly_sql` before a visual |
| `agents.spec.ts` | the Evals tab (the price table and checks feed its results) |

Desktop not run (web target only, as the Test target convention says).

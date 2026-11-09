# BA-320 — Questions to Insights v2

- **Jira:** [BA-320](https://halo-powered.atlassian.net/browse/BA-320) · **Roadmap:** Milestone 1.21 · **Status:** Confirmed (by the user on 2026-11-09)

## Goal

A second built-in data-analyst agent, **Questions to Insights v2**, is built up next to the current **Questions to Insights Assistant** (`assistant`), which stays unchanged. v2 starts minimal: an agent you can chat with, with a short prompt and only the core data tools. Later stories in this epic cut down what the current assistant carries (prompt rules, tools, skills) and bring only the slimmer set into v2, so the two can be compared side by side.

## Scope

- **Agent.** A new built-in agent, registry key `assistant-v2`, agent id `questions-to-insights-v2`, display name **Questions to Insights v2**.
  - Prompt: a short identity paragraph only, starting `You are Questions to Insights v2`. It can be overridden in the app like the assistant's (ADR-0026), under the same rules: no `[[skill:…]]` links, and the override must start with the identity line.
  - Tools: only the core data tools `list_entities`, `describe_entity` and `run_readonly_sql`.
  - No skills, no workspace file tools, no visuals, no clarification tool, no evals.
  - Memory: one thread per session, configured the same way as the assistant's (last 40 messages, no semantic recall, no working memory).
- **Agent Hub.** Listed in the **Official** section next to Questions to Insights Assistant. Like the assistant, v2 has no datasets of its own. **Start chat** on its card opens the New conversation screen with **Agent** preselected to Questions to Insights v2; with it selected the screen behaves as with the assistant (dataset picker, required name), and **Create** starts a session bound to v2 over the picked datasets. In the Agent dropdown v2 is listed right after Assistant.
- **Sessions.** A session started from v2 is bound to it (ADR-0028, amended for this epic: a bound built-in agent may take user-picked datasets): every turn runs v2, not the `assistant`. A v2 turn runs like the other bound built-in agents' turns: no grounding guard and no careful mode.
- **Current assistant.** No change to its prompt, tools, skills, evals or behaviour.

## Out of scope

- Deciding which assistant rules, tools and skills move to v2: that is the later stories of this epic.
- Making v2 the default agent, or replacing or removing the current assistant.
- User agents built on v2 (user agents keep running on `assistant`, ADR-0008).
- An eval set for v2, until it has behaviour worth measuring.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-321](https://halo-powered.atlassian.net/browse/BA-321) | Empty Questions to Insights v2 agent | 1.21.1 |

| [BA-325](https://halo-powered.atlassian.net/browse/BA-325) | Auto-configure local instances: testing data and custom LLM (dev tooling, shipped with this epic at the user's request) | 1.21.2 |
| — (no Jira, repo only) | v2 turns run as a Mastra workflow shown in the workflow bar (ADR-0034) | 1.21.3 |
| — (no Jira, repo only) | Context area on the navigation rail, with Knowledge inside it (shipped with this epic at the user's request) | 1.21.4 |

Later stories (the reductions) are added here as they are defined. From 2026-11-09 stories are tracked only in the repo, not in Jira.

## Specs touched

- [system/delivery.md](../../system/delivery.md) 2: `scripts/setup-local.mjs` and `.env.llm.local` (BA-325).
- [system/architecture.md](../../system/architecture.md): an amendment note on ADR-0028 (a bound built-in agent may take user-picked datasets).
- [system/data-model.md](../../system/data-model.md): `agentKey` / `agentName` on sessions name v2 (no migration).
- [system/agents.md](../../system/agents.md): the registry row, a new agent section with its prompt, tools and memory, the prompt appendix.
- [system/api.md](../../system/api.md): the catalogue (33) and the prompt-override first-line rule (103) and `POST /sessions` with `agentId: "assistant-v2"` (3) for `assistant-v2`.
- [capabilities/agents-evals](../../capabilities/agents-evals/spec.md): the Official agents list (R3) and v2's Start chat, page and prompt editor (R107).
- [capabilities/sessions-chat](../../capabilities/sessions-chat/spec.md): sessions bound to `assistant-v2` (R61) the Start chat and Agent picker rules (R52, R64), and `product/glossary.md`'s agent count.
- 1.21.3 (ADR-0034): [system/agents.md](../../system/agents.md) 1.2, 2.11, 5.1 and the new 5.11 (the `qti-v2-turn` workflow); [capabilities/agent-panel](../../capabilities/agent-panel/spec.md) R8a, R15, R16, R19 and two scenarios (workflow-backed steps, the Failed status); [system/data-model.md](../../system/data-model.md) 3.4.4 (`failed`, `source: 'workflow'`); [system/api.md](../../system/api.md) 2.1 and 3.1 (the `workflow` view and event); [system/ui.md](../../system/ui.md) 4.12.1 (the Failed status); [capabilities/sessions-chat](../../capabilities/sessions-chat/spec.md) R61.

## Acceptance

- `python3 scripts/check-specs.py`, backend and frontend unit tests, lint and builds are green.
- The Agent Hub shows Questions to Insights v2 in the Official section. Its page shows its prompt, its three tools, its memory, and no skills or evals.
- Starting a chat with v2 on a sample dataset answers a data question by running SQL, and the session header names v2.
- The current assistant's compiled prompt and tool list are byte-identical to `main`, so its evals don't need to run.

## Dependencies, risks and open questions

- **Depends on** built-in session agents (ADR-0028), built-in prompt overrides (ADR-0026) and the Agent Hub (Milestone 1.9).
- **Risk: two assistants in the UI.** Users may not know which to pick. Both cards carry their description; v2's says it is the slimmed-down version under construction.
- **Open question:** whether the assistant-only passes (the grounding guard, careful mode, deep analysis) should also apply to v2. For this story they don't. Each later story decides for the parts it moves.

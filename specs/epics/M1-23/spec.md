# M1-23 — Questions to Insights v2: a workflow you can follow

- **Jira:** none (repo only; epic id M1-23) · **Roadmap:** Milestone 1.23 · **Status:** Confirmed (2026-11-11)

## Goal

A user can see what Questions to Insights v2 does on each message without reading code.
- v2 runs every streamed turn as a workflow defined in code (ADR-0034, [agents.md](../../system/agents.md) 5.11), and the chat's workflow bar shows its steps advancing.
- Today the agent's detail view shows only the prompt and the links between instructions, skills and tools. Nothing says which steps are code, which step is the LLM, what passes between them, or where a turn can fail or stop.

This epic makes that workflow readable in the app. It starts with a drawing in the agent's **Graph** tab, and later v2 stories are added here as the user asks for them. Why: a workflow-backed agent is only easier to trust than a prompt-only one if people can see the workflow.

## Scope

- **Workflow in the agent detail API.** `GET /agents/:key` returns the workflow of a workflow-backed agent, built from the registered workflow and its step catalogue so the drawing can't drift from the code. For each step it gives:
  - the order, id, title (the workflow bar's), kind (code or agent) and a one-line summary;
  - the input and output fields;
  - for the agent step, its tools and maximum steps;
  - the other exits (fails, stops).
- **Graph tab drawing.** For a workflow-backed agent, the Graph tab opens with **What happens on each message** as a drawing:
  - code steps and the agent step in distinct styles;
  - the agent step drawn open with its tools and step limit;
  - labelled arrows for the data passed on, and each step's other exits;
  - a details card for the selected step.
  - The existing prompt-links graph stays under it.

## Out of scope

- Showing a run's live or last status on the drawing.
- Editing a workflow, or adding, removing or reordering steps, from the UI.
- Changing the steps of `qti-v2-turn`, what reaches the model, or v2's prompt and tools.
- The Graph tab of agents that are not workflow-backed (the assistant, the RFP Builder, the Data Readiness Agent, user agents, System agents).

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| — (no Jira, repo only) | The Graph tab draws a workflow-backed agent's turn | 1.23.1 |

## Specs touched

- [capabilities/agents-evals](../../capabilities/agents-evals/spec.md): R105 (the Graph tab of a workflow-backed agent), a new rule for the workflow drawing, and a Gherkin scenario in Feature `Built-in agent prompts`.
- [system/api.md](../../system/api.md): endpoint 34, the `workflow` field of `AgentDetail`.
- [system/ui.md](../../system/ui.md): 4.5.6 Graph tab.
- [system/agents.md](../../system/agents.md): 5.11, each step's summary and exits as the step catalogue holds them.

## Acceptance

- Questions to Insights v2's Graph tab draws its four steps in order:
  - Analyse in the agent style, with its three tools and `≤ 15 steps`; the other three in the code style;
  - the arrows labelled with each step's output;
  - the exits visible.
- Selecting a step shows its kind, summary, input and output.
- The prompt-links graph is still shown. The assistant's Graph tab is unchanged.
- The drawing follows the code: a unit test fails if the API's step list and the registered workflow disagree.
- The axe scan passes in both themes, and the `@demo @story-1.23.1` scenario passes.
- `check-specs`, unit tests, lint, builds and the impacted Playwright specs are green.

## Dependencies, risks and open questions

- **Depends on** ADR-0034 and the workflow `qti-v2-turn` (roadmap 1.21.3), and on the Graph tab of Official agents (agents-evals R105).
- **Risk: Mastra's ESM can't load in Jest** ([lessons.md](../../../lessons.md)). The step catalogue (titles, summaries, exits, field names) stays in the framework-free `qti-v2-turn.steps.ts`. The agent detail reads it from there, and a test checks it against the built workflow.
- **No ADR:** the change adds a read-only field and a view inside the current architecture.

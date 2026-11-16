# M1-23 — Workflow-first: chats run workflows, agents are building blocks

- **Jira:** none (repo only; epic id M1-23) · **Roadmap:** Milestone 1.23 · **Status:** Confirmed (2026-11-11; first confirmed as "Questions to Insights v2: a workflow you can follow", widened to workflow-first and confirmed again the same day; the run-workflows amendment (1.23.9) confirmed the same day; the chats-retired amendment (1.23.10–1.23.27) confirmed the same day)

## Goal

The app becomes **workflow-first**. A chat runs a **workflow**, and agents are the building blocks that the workflow's steps call: workflows → agents → skills → tools.

- A workflow is a fixed sequence of steps defined in code. Each step is deterministic code or a call to an agent.
- Today a session is bound to an agent, and only Questions to Insights v2 runs a workflow (ADR-0034). After this epic every session runs a workflow, and a chat is started by choosing one.
- The user can see what each workflow does on every message: which steps are code, which step is an agent, and what passes between them.

Why: the order of work and the rules that must always hold belong in code, not in a prompt the model can skip. Making the workflow the thing a user picks puts that in front of them. Decision: ADR-0040 ([architecture.md](../../system/architecture.md)). Plan and contract: [docs/plans/m1-23-workflow-first.md](../../../docs/plans/m1-23-workflow-first.md).

## Scope

- **Workflows are defined only in code** and ship with the app. The app lists them, shows them and starts chats from them; it never edits them.
- **One-step workflows.** Every agent that a chat can run and that has no code-defined workflow gets an automatic one-step workflow whose single step runs that agent: the assistant, the RFP Builder, the Data Readiness Agent and every Live user agent. System agents have none.
- **One turn path.** Every streamed turn is a run of the session's workflow. What each agent receives and answers does not change. The workflow bar keeps its sources: a code-defined workflow's steps (v2), or the agent's own phases (the assistant, the RFP Builder).
- **Sessions bound to a workflow.** A new session stores its workflow. An existing session's workflow is derived from its stored agent; there is no data migration.
- **API.** A workflow catalogue (`GET /workflows`, `GET /workflows/:id`), sessions created from a workflow, the session naming its workflow, and each agent listing the workflows that use it.
- **Workflows area.** A **Workflows** item on the navigation rail, a list of workflows, and a workflow page that shows what happens on each message (the drawing of story 1.23.1), the agents its steps call, and **Start chat**.
- **New conversation.** The screen's Agent field becomes **Workflow**. Every chat shows its workflow in its header and in the Sessions list.
- **Agents as a library.** Agents lose **Start chat**. The Official agents lose their Chat Box tab (user agents keep it for the draft preview), and each agent shows the workflows that use it.
- **Showcase agents removed.** The Benchmarking, Survey, LAD COE and Strategy agents, which never ran, are removed from the app.
- **Story 1.23.1 (done)** stays: the Graph tab draws v2's workflow, and the agent detail returns `workflow`.
- **Workflows run on an input (amendment of 2026-11-11, confirmed by the user the same day).** A workflow runs once on a typed input defined in code and shows each step's result on its page; nothing is stored. The first is a three-step, code-only test workflow (1.23.9). All workflows become run workflows.
- **Chats retired (amendment of 2026-11-11, confirmed by the user the same day; ADR-0041).** The workflow page becomes a designer: graph canvas in the middle, configuration in the right panel (1.23.10). Every workflow, the four agent workflows and user agents included, runs once on a typed input with live progress; runs of agent workflows are stored and listed under Runs, which replaces Sessions; existing sessions stay on disk and open read-only as past chats; no chat can start (Phase A, 1.23.11–1.23.22). Try it replaces the preview chat, and deep analysis and visual actions work on runs (Phase B). The chat code and specs are removed (Phase C). Plan: [docs/plans/m1-23-retire-chats.md](../../../docs/plans/m1-23-retire-chats.md). This supersedes "Evals" and "the legacy turn" in Out of scope below, which Phase C changes.
- **A faster, cheaper development workflow (amendment of 2026-11-11, confirmed by the user the same day).**
  - A lean story lane: builders do code, unit tests and one scenario, and the lead verifies per wave.
  - Model and effort routing.
  - Decide before building: a prototype first, and one confirmation per epic.
  - Gherkin kept once, in the test.
  - Generated story packs and a spec section index.
  - Finished roadmap milestones archived.
  - `qa.mjs --wave` for several stories at once.
  - Playwright running in parallel.
  - 1.23.26, extracting the turn engine, moved up, and `app.ts`/`app.html` split by area (1.23.28–1.23.33).
  - Contract: [docs/plans/m1-23-dev-speedup.md](../../../docs/plans/m1-23-dev-speedup.md).

## Out of scope

- Creating, editing, reordering or deleting workflows in the app, and persisted or user-defined workflows.
- Changing what any agent receives: prompts, tools, skills, context blocks or model routing. No eval run is needed.
- Evals, which keep calling agents directly; the legacy non-streamed turn, which stays a direct agent call.
- A workflow run's live or last status on the drawing.
- Removing the System agents.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| — (no Jira, repo only) | The Graph tab draws a workflow-backed agent's turn (done) | 1.23.1 |
| — (no Jira, repo only) | Workflow-first: ADR-0040, epic spec, glossary and roadmap | 1.23.2 |
| — (no Jira, repo only) | Remove the showcase agents (built after 1.23.2) | 1.23.8 |
| — (no Jira, repo only) | The workflow catalogue: list, detail, and sessions bound to a workflow | 1.23.3 |
| — (no Jira, repo only) | Every streamed turn runs the session's workflow | 1.23.4 |
| — (no Jira, repo only) | A Workflows area: list, workflow page and Start chat | 1.23.5 |
| — (no Jira, repo only) | The New conversation screen picks a workflow; chats name their workflow | 1.23.6 |
| — (no Jira, repo only) | Agents are building blocks: no Start chat, and "Used in" workflows | 1.23.7 |
| — (no Jira, repo only) | Run a workflow on an input: the sequential test workflow | 1.23.9 |
| — (no Jira, repo only) | The workflow page as a designer (graph canvas, right-panel configuration) | 1.23.10 |
| — (no Jira, repo only) | Chats retired, Phase A: every workflow runs, runs are stored, no chat can start (ADR-0041) | 1.23.11–1.23.22 |
| — (no Jira, repo only) | Chats retired, Phase B: Try it, deep analysis and visual actions on runs | 1.23.23–1.23.25 |
| — (no Jira, repo only) | Chats retired, Phase C: the chat code and specs removed (1.23.26 moved up) | 1.23.26–1.23.27 |
| — (no Jira, repo only) | A faster, cheaper development workflow: lean story lane, story packs, roadmap archive, wave QA, parallel Playwright, `app.ts` split | 1.23.28–1.23.33 |

## Specs touched

- [system/architecture.md](../../system/architecture.md): ADR-0040, and "amended by ADR-0040" on ADR-0004, 0008, 0028, 0029 and 0034.
- New capability `capabilities/workflows/spec.md` (the catalogue, the Workflows area and its Gherkin Feature), listed in [README.md](../../README.md).
- [system/api.md](../../system/api.md): the workflow endpoints, `POST /sessions` with a workflow, the session's `workflowRef`, the agent's `usedInWorkflows`, and the agent catalogue without showcase agents.
- [system/data-model.md](../../system/data-model.md): the session's `workflowId` and the derivation rule.
- [system/agents.md](../../system/agents.md): the registry (`agent-turn`, the showcase agents removed), the turn (5.1) and 5.11.
- [system/ui.md](../../system/ui.md): the rail, the Workflows list and page, the composer's Workflow field, the chat header and Sessions chips, the agent detail.
- Capabilities: [app-shell](../../capabilities/app-shell/spec.md), [agent-answers](../../capabilities/agent-answers/spec.md), [agents-evals](../../capabilities/agents-evals/spec.md), [agent-panel](../../capabilities/agent-panel/spec.md), rfp, [data-readiness](../../capabilities/data-readiness/spec.md), and [monitoring](../../capabilities/monitoring/spec.md) only if the trace shape changes.
- [product/glossary.md](../../product/glossary.md): Workflow, One-step workflow, Code-defined workflow; Session and Agent amended; Showcase agent removed.

## Acceptance

- **Workflows on the rail** lists `Assistant`, `Questions to Insights v2`, `Data Readiness Agent`, `RFP Builder` and every published user agent's workflow. Opening one shows its steps and agents, and **Start chat** opens a chat that runs it.
- **New conversation** asks for a Workflow, and each chat names its workflow in the header and in the Sessions list. Sessions created before the epic still open and answer as before.
- **An assistant, RFP Builder, Data Readiness, v2 or user-agent turn** gives the same answer, events, workflow bar and stored message as before. The request-recording Playwright specs are unchanged and green.
- **The prompt and tool-list hashes of every agent** are equal on base and branch.
- **Agents** have no Start chat and show `Used in`. No showcase agent remains.
- `check-specs`, unit tests, lint, builds, the impacted Playwright specs, the axe scans in both themes, and each UI story's `@demo` scenario are green.

## Dependencies, risks and open questions

- **Depends on** ADR-0034 and the `qti-v2-turn` workflow (roadmap 1.21.3), and on story 1.23.1.
- **Risk: a regression in the turn path.** Every chat goes through it. Mitigations: the turn code is moved, not changed; the existing suites must pass unchanged; the request-recording E2E specs assert what reaches the model.
- **Risk: Monitoring's trace shape.** A workflow run per turn may add spans. Mitigation: capture one real trace before changing anything (1.23.4).
- **Risk: a module cycle.** The agents module already imports the sessions module. Mitigation: the sessions code reads a framework-free workflow catalogue.
- **Risk: E2E churn.** About eight Playwright specs use the removed agent Start chat or renamed test ids. Each story updates the specs it breaks.
- **Open questions:** none. On 2026-11-11 the user chose to retire chats and keep every phase in this epic and branch, and took the recommended answers of [docs/plans/m1-23-retire-chats.md](../../../docs/plans/m1-23-retire-chats.md) section 10 (see its section 11).

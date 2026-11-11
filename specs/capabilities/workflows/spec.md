# Workflows

Every chat runs a **workflow**: a fixed sequence of steps defined in code, each one deterministic code or a call to an agent. The app ships two kinds: **code-defined workflows** (today *Questions to Insights v2*'s four-step turn) and a **one-step workflow** for each agent a chat can run that has no workflow of its own (the assistant, the RFP Builder, the Data Readiness Agent and every Live user agent). The workflow catalogue lists them all, says which agents each one calls, and is where a chat starts. Agents stay the building blocks that workflow steps call: workflows → agents → skills → tools. Workflows are read-only: the app never creates, edits or deletes one (ADR-0040).

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): workflow, code-defined workflow, one-step workflow, agent, user agent, Live, session, workflow bar, workflow phase.

Capability-local vocabulary: a workflow's **id** (`qti-v2-turn`, `agent:<agent key or id>`) and the agent a code-defined workflow runs for (its **primary agent**).

## Rules

The catalogue
- R1. The workflow catalogue SHALL list exactly the code-defined workflows and the one-step workflows of the assistant, the RFP Builder, the Data Readiness Agent and each Live user agent, in this order: the assistant's (`Assistant`), the code-defined workflows, the other Official agents' workflows by name, then the user agents' workflows by name. It SHALL NOT list System agents, draft-only user agents, or a one-step workflow for the primary agent of a code-defined workflow (Questions to Insights v2). Each entry SHALL carry its name, description, kind, owner (`Official` or `You`), the agents its steps call, its number of steps, what drives a chat's workflow bar, whether it takes the datasets the user picks, the datasets a session would take, the missing ones, the starter questions and, when a chat cannot start now, why ([../../system/api.md](../../system/api.md) 116). A one-step workflow SHALL take its agent's name, description, datasets and starter questions (a user agent's from its Live version), except the assistant's, which is named `Assistant` with the description `Answers questions over the datasets you pick.`.
- R2. A code-defined workflow SHALL keep its own id (`qti-v2-turn`). A one-step workflow's id SHALL be `agent:<registry key>` for a built-in agent (`agent:assistant`, `agent:rfp`, `agent:data-readiness`) and `agent:<user-agent id>` for a user agent. An id that names a System agent, the primary agent of a code-defined workflow, a draft-only or deleted user agent, or nothing at all SHALL NOT resolve to a workflow.
- R3. Workflows SHALL be defined in code. The app SHALL NOT offer any control that creates, edits, reorders or deletes a workflow or a step, and the API SHALL have no write route for workflows. Publishing, editing or deleting a user agent SHALL change its one-step workflow at the next read, with nothing registered or stored per workflow.

Sessions
- R4. Every session SHALL run one workflow. A session created from this version on SHALL store the id of its workflow at creation, whichever way it was started (from a workflow, from an agent, a plain session or an agent editor's preview), and never change it. A session saved before SHALL have its workflow derived from its agent binding at every read: Questions to Insights v2 → `qti-v2-turn`; the RFP Builder or the Data Readiness Agent → its one-step workflow; a user agent, existing or deleted → `agent:<id>`; no agent → `agent:assistant`. A stored id that no longer resolves SHALL be ignored and the workflow derived again. Today the stored id always equals the derived one ([../../system/data-model.md](../../system/data-model.md) 3.4).

The Workflows pages
- R5. The **Workflows** area of the navigation rail ([../app-shell/spec.md](../app-shell/spec.md) R3) SHALL show every workflow of the catalogue (R1) in two sections, **Official** then **Mine** (the user agents' workflows, omitted when there are none), each in the catalogue's order. Each workflow SHALL show its name, its description, its kind (`<n> steps` for a code-defined workflow, `One step` for a one-step workflow), `Uses <the names of the agents its steps call>`, its missing datasets (`Missing dataset: <names>`) and Start chat (R6). A search SHALL filter the list by name or description, ignoring case; when nothing matches, the page SHALL say `No workflows match "<query>"`.
- R6. **Start chat**, on a workflow's card and on its page, SHALL start a chat that runs the workflow. For a workflow that takes the datasets the user picks (the Assistant, Questions to Insights v2) it SHALL open the New conversation screen with that workflow's agent preselected ([../sessions-chat/spec.md](../sessions-chat/spec.md) R64). For any other workflow it SHALL create the session from the workflow at once ([../../system/api.md](../../system/api.md) 3, `workflowId`), show the toast `Session "<name>" created` and open the chat. A refusal SHALL keep the user where they are and show the server's message, or `Backend unreachable`. While the workflow cannot start a chat, Start chat SHALL be disabled with the reason (`chatRequirement`) as its title; on the workflow's page the reason SHALL also be written beside it. The agents keep their own Start chat for now ([../agents-evals/spec.md](../agents-evals/spec.md) R53).
- R7. Opening a workflow SHALL show its page: a back control to the Workflows page, its name, id and kind, Start chat (R6), its description and missing datasets, **what happens on each message** (the drawing of its steps, as `GET /workflows/:id` returns them; [../agents-evals/spec.md](../agents-evals/spec.md) R108 describes the drawing), the workflow bar note (R10) and its agents (R8). Workflows SHALL stay the current rail item while the page is open.
- R8. A workflow's page SHALL list, under **Agents**, each agent its steps call, with its owner (`Official` or `You`). Choosing one SHALL open that agent's detail ([../agents-evals/spec.md](../agents-evals/spec.md) R5).
- R9. The Workflows page SHALL read the catalogue each time it opens, so a user agent's workflow appears once the agent is published and is gone once the agent is deleted (R1, R3). Opening a workflow that has left the catalogue SHALL show `Workflow "<id>" not found` on its page.
- R10. Under the drawing, a workflow's page SHALL say what a chat's workflow bar shows ([../agent-panel/spec.md](../agent-panel/spec.md)): `In a chat, the workflow bar shows these steps as they run.` for a workflow whose steps drive the bar (Questions to Insights v2), else `In a chat, the workflow bar shows the agent's own steps as it sets them.`

## Edge cases and errors

- Opening a workflow that is not in the catalogue (unknown, draft-only, System or a primary agent) answers `Workflow "<id>" not found` (HTTP 404).
- Starting a chat with a workflow that is not in the catalogue is refused with `Workflow "<id>" not found`, creating nothing. Sending both a workflow and an agent is refused with `Send workflowId or agentId, not both`.
- Starting a chat with a workflow refuses exactly as starting it from its agent does: the Assistant and Questions to Insights v2 with `session name is required` and `select at least one dataset`; the RFP Builder and the Data Readiness Agent with their requirement texts; a user agent with `None of this agent's datasets exist` ([../sessions-chat/spec.md](../sessions-chat/spec.md) R52).
- A deleted user agent's workflow leaves the catalogue. Its sessions keep the id `agent:<id>` and name it with the name the agent last had, marked deleted ([../sessions-chat/spec.md](../sessions-chat/spec.md) R59, R65).
- An agent editor's preview runs the agent's one-step workflow under the draft's name.

## Contracts

- Endpoints: [../../system/api.md](../../system/api.md) section 2.6.2 (116 `GET /workflows`, 117 `GET /workflows/:id`); 3 (`POST /sessions` with `workflowId`); 2.1 (the session's derived `workflowRef`); 34 (an agent's `usedInWorkflows`).
- Data: [../../system/data-model.md](../../system/data-model.md) 3.4 (`sessions.workflowId`) and 3.13. No collection of its own.
- Agents and steps: [../../system/agents.md](../../system/agents.md) 5.11 (`qti-v2-turn`) and 5.12 (the catalogue, ids, the one-step workflow and the derivation rule). Decision: [../../system/architecture.md](../../system/architecture.md) ADR-0040.

## UI

- The **Workflows** rail item, between Datasets and Agents (lucide `workflow` icon; [../../system/ui.md](../../system/ui.md) 1.3), and the `workflows` and `workflow-detail` views (ui.md 1.4).
- The Workflows page: the note `Each chat runs a workflow. Its steps call agents, and agents use skills and tools.`, the search, the Official and Mine sections and the workflow cards with Start chat (ui.md 4.4a).
- A workflow's page: `All workflows`, the header with Start chat and its requirement, the drawing of 1.23.1 reused unchanged, the workflow bar note and the Agents rows (ui.md 4.4b).
- No control creates, edits, reorders or deletes a workflow or a step (R3).

## Flows

### Feature: Workflows

E2E: `frontend/e2e/workflows.spec.ts`

```gherkin
Feature: Workflows

  Background:
    Given a dataset "World Cup Core" and a published user agent "Health plan analyst" that uses it

  @demo @story-1.23.5
  Scenario: Open a workflow and start a chat from it
    When I click "Workflows" on the rail
    Then I see "Assistant", "Questions to Insights v2", "Data Readiness Agent" and "RFP Builder" under Official
    When I open "Questions to Insights v2"
    Then I see its four steps in the drawing and the agent "Questions to Insights v2" under Agents
    When I click "All workflows"
    And I open "Health plan analyst" under Mine
    Then I see "One step" and its single "Answer" step
    When I click "Start chat"
    Then I see "Session "Health plan analyst" created" and the chat opens

  Scenario: A workflow that cannot start says why
    When I open Workflows
    Then the "RFP Builder" card's Start chat is disabled with its requirement as the title
    When I open "RFP Builder"
    Then its Start chat is disabled and the requirement is written beside it

  Scenario: Workflows can't be edited
    When I open Workflows
    Then I see no Edit, New, Delete or reorder control on the list
    When I open "Questions to Insights v2"
    Then I see no Edit, New, Delete or step-reorder control on its page

  Scenario: Search filters the list
    Given I am on Workflows
    When I search for "rfp"
    Then only the "RFP Builder" card is shown
    When I search for "zzz"
    Then I see "No workflows match "zzz""
```

## Acceptance

- `GET /workflows` on a fresh data dir lists `agent:assistant`, `qti-v2-turn`, `agent:data-readiness` and `agent:rfp` in that order, the last two with their requirement; a published user agent adds `agent:<id>` and a draft-only one does not (R1).
- `GET /workflows/agent:sql-fixer` and the id of a draft-only agent answer 404 with `Workflow "<id>" not found` (R2).
- Starting a chat with `qti-v2-turn` binds the session to Questions to Insights v2 and stores `qti-v2-turn`; every session reads its workflow, `agent:assistant` for a plain one (R4).
- No route or control writes a workflow (R3); the Feature `Workflows` checks the pages for any Edit, New, Delete or reorder control.
- The Workflows page lists the Official workflows in catalogue order and a published user agent's under Mine, filters by search, and opens a workflow's page with its drawing, bar note and agents; Start chat opens the New conversation screen for a workflow that picks datasets and otherwise creates and opens the session; RFP Builder's Start chat is disabled with its requirement (R5–R8, R10).
- The axe scan finds no violation on the Workflows page and on a workflow's page, in both themes.
- Proven by the backend's unit tests and its API-level test of the workflow catalogue (R1–R4), the frontend unit tests of the sections and the Start chat branch, and `frontend/e2e/workflows.spec.ts` (R3, R5–R8, R10).

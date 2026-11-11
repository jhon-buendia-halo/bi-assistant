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
- R5–R10. Not built yet: the Workflows page, Start chat on a workflow, the workflow page, its agents list, a deleted or unpublished agent's workflow leaving the list, and the workflow bar note.

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

Not built yet: the Workflows area of the navigation rail, the Workflows page and a workflow's page ([../../system/ui.md](../../system/ui.md)).

## Flows

### Feature: Workflows

E2E: none yet

The scenarios of the Workflows pages come with them.

## Acceptance

- `GET /workflows` on a fresh data dir lists `agent:assistant`, `qti-v2-turn`, `agent:data-readiness` and `agent:rfp` in that order, the last two with their requirement; a published user agent adds `agent:<id>` and a draft-only one does not (R1).
- `GET /workflows/agent:sql-fixer` and the id of a draft-only agent answer 404 with `Workflow "<id>" not found` (R2).
- Starting a chat with `qti-v2-turn` binds the session to Questions to Insights v2 and stores `qti-v2-turn`; every session reads its workflow, `agent:assistant` for a plain one (R4).
- No route or control writes a workflow (R3).
- Proven by the backend's unit tests and its API-level test of the workflow catalogue.

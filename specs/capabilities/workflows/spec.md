# Workflows

Every chat runs a **workflow**: a fixed sequence of steps defined in code, each one deterministic code or a call to an agent. The app ships two kinds: **code-defined workflows** (today *Questions to Insights v2*'s four-step turn) and a **one-step workflow** for each agent a chat can run that has no workflow of its own (the assistant, the RFP Builder, the Data Readiness Agent and every Live user agent). The workflow catalogue lists them all, says which agents each one calls, and is where a chat starts. Agents stay the building blocks that workflow steps call: workflows → agents → skills → tools. Workflows are read-only: the app never creates, edits or deletes one (ADR-0040).

Since 2026-11-11 (ADR-0040 amendment) a workflow also has a **trigger**: a **chat workflow** runs on every message of a chat (every workflow above), and a **run workflow** runs once on a typed input defined in code and shows each step's result on its page, with no chat and nothing stored. The first run workflow is the **Sequential test workflow** (`seq-text-demo`), three code steps and no LLM. Converting the chat workflows to run workflows is stories 1.23.15–1.23.17. Since story 1.23.10 a workflow's page is a designer: its graph on a canvas, its configuration, run and code in the right panel.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): workflow, code-defined workflow, one-step workflow, agent, user agent, Live, session, workflow bar, workflow phase.

Capability-local vocabulary: a workflow's **id** (`qti-v2-turn`, `seq-text-demo`, `agent:<agent key or id>`), the agent a code-defined workflow runs for (its **primary agent**), its **trigger** (`chat` or `run`), a run workflow's **input** (its typed fields) and a **run** (one execution of a run workflow on an input).

## Rules

The catalogue
- R1. The workflow catalogue SHALL list exactly the code-defined workflows and the one-step workflows of the assistant, the RFP Builder, the Data Readiness Agent and each Live user agent, in this order: the assistant's (`Assistant`), the code-defined workflows, the other Official agents' workflows by name, then the user agents' workflows by name. It SHALL NOT list System agents, draft-only user agents, or a one-step workflow for the primary agent of a code-defined workflow (Questions to Insights v2). Each entry SHALL carry its name, description, kind, owner (`Official` or `You`), the agents its steps call, its number of steps, what drives a chat's workflow bar, whether it takes the datasets the user picks, the datasets a session would take, the missing ones, the starter questions and, when a chat cannot start now, why ([../../system/api.md](../../system/api.md) 116). A one-step workflow SHALL take its agent's name, description, datasets and starter questions (a user agent's from its Live version), except the assistant's, which is named `Assistant` with the description `Answers questions over the datasets you pick.`.
- R2. A code-defined workflow SHALL keep its own id (`qti-v2-turn`). A one-step workflow's id SHALL be `agent:<registry key>` for a built-in agent (`agent:assistant`, `agent:rfp`, `agent:data-readiness`) and `agent:<user-agent id>` for a user agent. An id that names a System agent, the primary agent of a code-defined workflow, a draft-only or deleted user agent, or nothing at all SHALL NOT resolve to a workflow.
- R3. Workflows SHALL be defined in code. The app SHALL NOT offer any control that creates, edits, reorders or deletes a workflow or a step, and the API SHALL have no write route for workflows. Publishing, editing or deleting a user agent SHALL change its one-step workflow at the next read, with nothing registered or stored per workflow.

Sessions
- R4. Every session SHALL run one workflow. A session created from this version on SHALL store the id of its workflow at creation, whichever way it was started (from a workflow, from an agent, a plain session or an agent editor's preview), and never change it. A session saved before SHALL have its workflow derived from its agent binding at every read: Questions to Insights v2 → `qti-v2-turn`; the RFP Builder or the Data Readiness Agent → its one-step workflow; a user agent, existing or deleted → `agent:<id>`; no agent → `agent:assistant`. A stored id that no longer resolves SHALL be ignored and the workflow derived again. Today the stored id always equals the derived one ([../../system/data-model.md](../../system/data-model.md) 3.4).

The Workflows pages
- R5. The **Workflows** area of the navigation rail ([../app-shell/spec.md](../app-shell/spec.md) R3) SHALL show every workflow of the catalogue (R1) in two sections, **Official** then **Mine** (the user agents' workflows, omitted when there are none), each in the catalogue's order. Each workflow SHALL show its name, its description, its kind (`<n> steps` for a code-defined workflow, `One step` for a one-step workflow), `Uses <the names of the agents its steps call>`, its missing datasets (`Missing dataset: <names>`) and Start chat (R6); a run workflow shows its kind and Run instead (R12). A search SHALL filter the list by name or description, ignoring case; when nothing matches, the page SHALL say `No workflows match "<query>"`.
- R6. **Start chat**, on a workflow's card and on its page, SHALL start a chat that runs the workflow. For a workflow that takes the datasets the user picks (the Assistant, Questions to Insights v2) it SHALL open the New conversation screen with that workflow's agent preselected ([../sessions-chat/spec.md](../sessions-chat/spec.md) R64). For any other workflow it SHALL create the session from the workflow at once ([../../system/api.md](../../system/api.md) 3, `workflowId`), show the toast `Session "<name>" created` and open the chat. A refusal SHALL keep the user where they are and show the server's message, or `Backend unreachable`. While the workflow cannot start a chat, Start chat SHALL be disabled with the reason (`chatRequirement`) as its title; on the workflow's page the reason SHALL also be written beside it. The agents keep their own Start chat for now ([../agents-evals/spec.md](../agents-evals/spec.md) R53).
- R7. Opening a workflow SHALL show its page as a **designer** (since 1.23.10): a header with the breadcrumb `Workflows / <name>` (its first part goes back to the Workflows page), the name, id, kind and missing datasets, and the primary action (**Execute** for a run workflow, Start chat (R6) for a chat workflow); the workflow's **graph** on a canvas (a Start node, one node per step with its title, id and kind badge `CODE` or `LLM`, an End node, and between them connectors carrying the fields each step passes on, as `GET /workflows/:id` returns them), with zoom (75%–150%, default 100%) and fit to screen; and the app's right panel, opened with the page, with the tabs **Workflow** (name, id, description, trigger, the workflow bar note (R10), input parameters, output and agents (R8)), **Step** (the selected step's configuration), **Run** (run workflows only, R12, R13) and **Code** (the definition as JSON, with Copy). Choosing a node SHALL select it and show it on Step; with no step selected, Step SHALL say `Select a step in the graph to see its configuration.` Workflows SHALL stay the current rail item while the page is open. The agent detail's Graph tab keeps its own drawing ([../agents-evals/spec.md](../agents-evals/spec.md) R108).
- R8. A workflow's panel SHALL list, under **Agents** on its Workflow tab, each agent its steps call, with its owner (`Official` or `You`). Choosing one SHALL open that agent's detail ([../agents-evals/spec.md](../agents-evals/spec.md) R5).
- R9. The Workflows page SHALL read the catalogue each time it opens, so a user agent's workflow appears once the agent is published and is gone once the agent is deleted (R1, R3). Opening a workflow that has left the catalogue SHALL show `Workflow "<id>" not found` on its page.
- R10. Under its trigger on the panel's Workflow tab, a chat workflow SHALL say what a chat's workflow bar shows ([../agent-panel/spec.md](../agent-panel/spec.md)): `In a chat, the workflow bar shows these steps as they run.` for a workflow whose steps drive the bar (Questions to Insights v2), else `In a chat, the workflow bar shows the agent's own steps as it sets them.`

Run workflows
- R11. Every workflow SHALL have a trigger, `chat` or `run`. Every one-step workflow and Questions to Insights v2 SHALL be chat workflows. A run workflow SHALL declare its input in code: typed fields, each with a name, a label, a type (`text`, `textarea` or `number`), whether it is required and an optional placeholder; a chat workflow has none. The catalogue SHALL carry each workflow's trigger and input ([../../system/api.md](../../system/api.md) 116). Running a run workflow SHALL run its steps once, in order, on the input and answer each step's status (`success`, `failed` or `skipped`) and output, and the final output; a failing step SHALL make the run failed with that step's error, and the steps after it SHALL be skipped ([../../system/api.md](../../system/api.md) 118). A required field that is missing or empty SHALL be refused with `<label> is required`, and a number field that is not a number with `<label> must be a number`, running nothing. A run SHALL NOT be stored: it is not a session, writes no workflow bar and is listed nowhere. A chat workflow SHALL NOT be run (`Workflow "<id>" runs in a chat`), and a run workflow SHALL NOT start a chat (`Workflow "<id>" can't start a chat`, creating nothing). The first run workflow SHALL be the Sequential test workflow (`seq-text-demo`, input `Text`): Clean text, Count words, Format result ([../../system/agents.md](../../system/agents.md) 5.13).
- R12. A run workflow's card SHALL show the kind `Runs on an input` and, instead of Start chat, **Run**, which opens its page; a workflow that calls no agent SHALL show no `Uses` line. A run workflow's page SHALL show, instead of Start chat and the bar note, **Execute** in its header, which opens the right panel on its **Run** tab: an **Input** form with one labelled control per field (a text area, a text input or a number input, with its placeholder, marked required when required) and **Execute**, which reads `Executing…` and is disabled while the run is going. Its Workflow tab SHALL list the input fields as its input parameters (name, label, type, `required`), and Agents only when its steps call one. The New conversation screen's Workflow field SHALL NOT offer a run workflow ([../sessions-chat/spec.md](../sessions-chat/spec.md) R64).
- R13. After a run, the Run tab SHALL show the **Result** under the form: `Run succeeded` or `Run failed: <error>`, then one row per step with its number, its title, a status (`Done`, `Failed` or `Skipped`), a failed step's error and a successful step's output, and the run's final output field by field (for the Sequential test workflow, `summary` `3 words, 20 characters: "Hello workflow world"` for the text `  Hello   workflow   world  `); while the result is shown, each step's node on the canvas SHALL carry its status as a chip. A refusal SHALL be shown under Execute with the server's message (`Text is required`) or `Backend unreachable`. Running again SHALL replace the result, and leaving the page SHALL discard it.

## Edge cases and errors

- Opening a workflow that is not in the catalogue (unknown, draft-only, System or a primary agent) answers `Workflow "<id>" not found` (HTTP 404).
- Starting a chat with a workflow that is not in the catalogue is refused with `Workflow "<id>" not found`, creating nothing. Sending both a workflow and an agent is refused with `Send workflowId or agentId, not both`.
- Starting a chat with a workflow refuses exactly as starting it from its agent does: the Assistant and Questions to Insights v2 with `session name is required` and `select at least one dataset`; the RFP Builder and the Data Readiness Agent with their requirement texts; a user agent with `None of this agent's datasets exist` ([../sessions-chat/spec.md](../sessions-chat/spec.md) R52).
- A deleted user agent's workflow leaves the catalogue. Its sessions keep the id `agent:<id>` and name it with the name the agent last had, marked deleted ([../sessions-chat/spec.md](../sessions-chat/spec.md) R59, R65).
- An agent editor's preview runs the agent's one-step workflow under the draft's name.
- Running a chat workflow is refused with `Workflow "<id>" runs in a chat` (HTTP 400); running a workflow that is not in the catalogue answers `Workflow "<id>" not found` (HTTP 404). Starting a chat with a run workflow is refused with `Workflow "seq-text-demo" can't start a chat`, creating nothing.
- Running the Sequential test workflow without a text is refused with `Text is required`. A text of only spaces is accepted and the run fails at Clean text with `The text is empty`, the other two steps skipped; the run still answers HTTP 200.

## Contracts

- Endpoints: [../../system/api.md](../../system/api.md) section 2.6.2 (116 `GET /workflows`, 117 `GET /workflows/:id`, 118 `POST /workflows/:id/runs`); 3 (`POST /sessions` with `workflowId`); 2.1 (the session's derived `workflowRef`); 34 (an agent's `usedInWorkflows`).
- Data: [../../system/data-model.md](../../system/data-model.md) 3.4 (`sessions.workflowId`) and 3.13. No collection of its own.
- Agents and steps: [../../system/agents.md](../../system/agents.md) 5.11 (`qti-v2-turn`), 5.12 (the catalogue, ids, triggers, the one-step workflow and the derivation rule) and 5.13 (run workflows, `seq-text-demo`). Decision: [../../system/architecture.md](../../system/architecture.md) ADR-0040 and its 2026-11-11 amendment.

## UI

- The **Workflows** rail item, between Datasets and Agents (lucide `workflow` icon; [../../system/ui.md](../../system/ui.md) 1.3), and the `workflows` and `workflow-detail` views (ui.md 1.4).
- The Workflows page: the note `Each chat runs a workflow. Its steps call agents, and agents use skills and tools.`, the search, the Official and Mine sections and the workflow cards with Start chat (ui.md 4.4a).
- A workflow's page, a designer (ui.md 4.4b): the header with the breadcrumb, the name, id and kind and Execute or Start chat with its requirement; the graph canvas with its zoom toolbar; the right panel's Workflow, Step, Run and Code tabs, with the bar note and the Agents rows on Workflow.
- A run workflow: the card's `Runs on an input` chip and **Run** (ui.md 4.4a); its page's **Execute** in the header, and the Run tab's **Input** form, **Execute** and **Result**, with the run status on the canvas nodes (ui.md 4.4b).
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
    Then I see its four steps on the canvas and the agent "Questions to Insights v2" under Agents in the panel
    When I click "Workflows" in the breadcrumb
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
    Then I see no Edit, New, Delete or step-reorder control on its page or in its panel

  Scenario: Search filters the list
    Given I am on Workflows
    When I search for "rfp"
    Then only the "RFP Builder" card is shown
    When I search for "zzz"
    Then I see "No workflows match "zzz""

  @demo @story-1.23.9
  Scenario: I run the sequential test workflow on a text
    When I open Workflows
    Then I see "Sequential test workflow" with "Runs on an input" and no Start chat
    When I click its Run
    Then I see its three steps on the canvas, Execute and no Start chat
    When I click Execute
    Then the panel's Run tab shows the "Text" input
    When I type "  Hello   workflow   world  "
    And I click Execute in the panel
    Then I see "Run succeeded" with "Clean text", "Count words" and "Format result" all "Done"
    And the output summary is "3 words, 20 characters: "Hello workflow world""

  Scenario: A failing step stops the run
    Given I am on the "Sequential test workflow" page
    When I run it on a text of only spaces
    Then I see "Run failed: The text is empty"
    And "Clean text" is "Failed" and "Count words" and "Format result" are "Skipped"
    And the canvas shows "Failed" on "Clean text" and "Skipped" on the others

  @demo @story-1.23.10
  Scenario: A workflow opens as a designer
    When I open "Questions to Insights v2" from Workflows
    Then the canvas shows Start, its four steps in order with their badges, and End
    And the right panel is open on Workflow with its input parameters and output
    When I click "Analyse" on the canvas
    Then the panel's Step tab shows its tools and "Max steps 15"
    When I open the Code tab
    Then I see the workflow's definition as JSON
    When I open "Sequential test workflow" and click Execute
    Then the panel opens on Run
    When I type a text and click Execute
    Then I see the result and "Done" on the three canvas nodes
```

## Acceptance

- `GET /workflows` on a fresh data dir lists `agent:assistant`, `qti-v2-turn`, `agent:data-readiness` and `agent:rfp` in that order, the last two with their requirement; a published user agent adds `agent:<id>` and a draft-only one does not (R1).
- `GET /workflows/agent:sql-fixer` and the id of a draft-only agent answer 404 with `Workflow "<id>" not found` (R2).
- Starting a chat with `qti-v2-turn` binds the session to Questions to Insights v2 and stores `qti-v2-turn`; every session reads its workflow, `agent:assistant` for a plain one (R4).
- No route or control writes a workflow (R3); the Feature `Workflows` checks the pages for any Edit, New, Delete or reorder control.
- The Workflows page lists the Official workflows in catalogue order and a published user agent's under Mine, filters by search, and opens a workflow's page with its graph, bar note and agents; Start chat opens the New conversation screen for a workflow that picks datasets and otherwise creates and opens the session; RFP Builder's Start chat is disabled with its requirement (R5–R8, R10).
- The axe scan finds no violation on the Workflows page and on a workflow's page with the right panel open on its Workflow, Step and Code tabs, in both themes, including the Sequential test workflow's page after a successful and a failed run.
- A workflow's page is a designer: the canvas draws Start, each step with its badge and End down one line, with the fields passed on each connector; the panel opens on Workflow with the input parameters and output; choosing a node shows it on Step; Code shows the definition; Execute opens Run, and a run puts each step's status on its node (R7, R12, R13). Proven by the unit tests of the canvas layout (positions, connectors and size for 1, 3 and 4 steps), the canvas, the panel tabs and the page, and the `@story-1.23.10` scenario.
- `GET /workflows` lists `seq-text-demo` after `qti-v2-turn` with `trigger: 'run'` and its `Text` input, and every other workflow with `trigger: 'chat'` and no input. Running it on `  Hello   workflow   world  ` answers three successful steps and the summary `3 words, 20 characters: "Hello workflow world"`; on `   ` it fails at Clean text with `The text is empty` and skips the others; without a text it is refused with `Text is required`. Running `agent:assistant` is refused with `Workflow "agent:assistant" runs in a chat`, and starting a chat with `seq-text-demo` with `Workflow "seq-text-demo" can't start a chat` (R11).
- The Sequential test workflow's card shows `Runs on an input` and Run and no Start chat; its page runs it and shows each step `Done`, or `Failed` and `Skipped`, and the output; the New conversation screen never lists it (R12, R13).
- Proven by the backend's unit tests and its API-level test of the workflow catalogue and runs (R1–R4, R11), the frontend unit tests of the sections, the Start chat branch and the run page, and `frontend/e2e/workflows.spec.ts` (R3, R5–R8, R10, R12, R13).

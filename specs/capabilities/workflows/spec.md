# Workflows

Every chat runs a **workflow**: a fixed sequence of steps defined in code, each one deterministic code or a call to an agent. The app ships two kinds: **code-defined workflows** (today *Questions to Insights v2*'s four-step turn) and a **one-step workflow** for each agent a chat can run that has no workflow of its own (the assistant, the RFP Builder, the Data Readiness Agent and every Live user agent). The workflow catalogue lists them all, says which agents each one calls, and is where a chat starts. Agents stay the building blocks that workflow steps call: workflows → agents → skills → tools. Workflows are read-only: the app never creates, edits or deletes one (ADR-0040).

Since 2026-11-11 (ADR-0040 amendment) a workflow also has a **trigger**: a **chat workflow** runs on every message of a chat (every workflow above), and a **run workflow** runs once on a typed input defined in code and shows each step's result on its page, with no chat. The first run workflow is the **Sequential test workflow** (`seq-text-demo`), three code steps and no LLM. Since 2026-11-11 chats are being retired (ADR-0041): every workflow will run on its input. From story 1.23.12 the agent workflows (the Assistant, Questions to Insights v2, the Data Readiness Agent, the RFP Builder and each user agent's) also declare a typed input and run on it, one agent turn per run, with the same answer a chat turn gives; they stay chat workflows until 1.23.22. Since story 1.23.14 every run is stored: it is listed, reopened with its result and files, and deleted with them. Since story 1.23.10 a workflow's page is a designer: its graph on a canvas, its configuration, run and code in the right panel. Since story 1.23.15 the Assistant, Questions to Insights v2 and each user agent's workflow also run from their page: the Run tab streams the run step by step and shows the answer with its provenance, and the user can stop it, follow up on it and answer its clarifying question.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): workflow, code-defined workflow, one-step workflow, agent, user agent, Live, session, workflow bar, workflow phase.

Capability-local vocabulary: a workflow's **id** (`qti-v2-turn`, `seq-text-demo`, `agent:<agent key or id>`), the agent a code-defined workflow runs for (its **primary agent**), its **trigger** (`chat` or `run`), a workflow's **input** (its typed fields), a **run** (one execution of a workflow on an input), a run's **context** (one earlier run whose question and answer it is given) and the **run host** (internal: the in-memory session a run's agent turn executes on).

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
- R11. Every workflow SHALL have a trigger, `chat` or `run`. Every one-step workflow and Questions to Insights v2 SHALL be chat workflows until chats are removed (1.23.22). A run workflow SHALL declare its input in code: typed fields, each with a name, a label, a type (`text`, `textarea` or `number`; R14 adds `boolean`, `datasets` and `dataset`), whether it is required and an optional placeholder. The catalogue SHALL carry each workflow's trigger and input ([../../system/api.md](../../system/api.md) 116). Running a run workflow SHALL run its steps once, in order, on the input and answer each step's status (`success`, `failed` or `skipped`) and output, and the final output; a failing step SHALL make the run failed with that step's error, and the steps after it SHALL be skipped ([../../system/api.md](../../system/api.md) 118). A required field that is missing or empty SHALL be refused with `<label> is required`, and a number field that is not a number with `<label> must be a number`, running nothing. A run SHALL NOT be a session: it writes no workflow bar and is never listed with the sessions; it is stored as a workflow run (R18). A workflow without input fields SHALL NOT be run (`Workflow "<id>" can't run on an input`), and a run workflow SHALL NOT start a chat (`Workflow "<id>" can't start a chat`, creating nothing). The first run workflow SHALL be the Sequential test workflow (`seq-text-demo`, input `Text`): Clean text, Count words, Format result ([../../system/agents.md](../../system/agents.md) 5.13).
- R12. A run workflow's card SHALL show the kind `Runs on an input` and, instead of Start chat, **Run**, which opens its page; a workflow that calls no agent SHALL show no `Uses` line. A run workflow's page SHALL show, instead of Start chat and the bar note, **Execute** in its header, which opens the right panel on its **Run** tab: an **Input** form with one labelled control per field (a text area, a text input or a number input, with its placeholder, marked required when required) and **Execute**, which reads `Executing…` and is disabled while the run is going. Its Workflow tab SHALL list the input fields as its input parameters (name, label, type, `required`), and Agents only when its steps call one. The New conversation screen's Workflow field SHALL NOT offer a run workflow ([../sessions-chat/spec.md](../sessions-chat/spec.md) R64).
- R13. After a run, the Run tab SHALL show the **Result** under the form: `Run succeeded` or `Run failed: <error>`, then one row per step with its number, its title, a status (`Done`, `Failed` or `Skipped`), a failed step's error and a successful step's output, and the run's final output field by field (for the Sequential test workflow, `summary` `3 words, 20 characters: "Hello workflow world"` for the text `  Hello   workflow   world  `); while the result is shown, each step's node on the canvas SHALL carry its status as a chip. A refusal SHALL be shown under Execute with the server's message (`Text is required`) or `Backend unreachable`. Running again SHALL replace the result, and leaving the page SHALL discard it.

Runs of agent workflows (ADR-0041; backend only in 1.23.12)
- R14. The agent workflows SHALL declare their input in code, with the field types `text`, `textarea`, `number`, `boolean` (a checkbox; absent means false), `datasets` (one or more dataset names) and `dataset` (exactly one), each field optionally with a default, a datasource-kind limit and a hidden flag ([../../system/api.md](../../system/api.md) 116): the Assistant `question`, `datasets` and `careful`; Questions to Insights v2 `question` and `datasets`; the Data Readiness Agent one PostgreSQL or Databricks `dataset` and an optional `question` (empty means `Assess the readiness of this dataset`); the RFP Builder `message` and a hidden `rfpId`; a user agent `question` and `careful`, over its Live datasets that exist. Each SHALL carry a run requirement with the same text as its chat requirement, and SHALL NOT run while it holds. A run's input SHALL be checked in field order before anything runs, the first refusal winning: `<label> is required`, `Select at least one dataset`, `<label> must be a number`, `<label> must be true or false`, `Dataset "<name>" not found`, `Dataset "<name>" is not a <kinds> dataset` (e.g. `PostgreSQL or Databricks`); a blank question or message SHALL be refused with `<label> is required`; unknown keys SHALL be ignored.
- R15. A run of an agent workflow SHALL be one agent turn of that workflow's agent, on the run's input, with the same model request a chat turn sends for the same question over the same datasets (the same agent, instructions, context blocks, tools and options) and the same answer: the grounding guard, tool-only synthesis, careful mode, clarification, visuals, panel items, RFP stages and readiness progress SHALL behave as in a chat turn. Its run host SHALL exist only for the run: created when it starts, never listed with the sessions, its memory thread deleted and itself discarded when it ends; its workspace stays with the run.
- R16. A streamed run SHALL report, in order: that it started (its run id), each step's start and end with its status (`running`, then `success`, `failed`, `stopped`, or `skipped` for a step that never ran) and output, the agent turn's events exactly as the chat stream sends them, and one terminal event: the run with its answer, steps, output, datasets, panel items, visuals and RFP, or the chat stream's error for the same failure ([../../system/api.md](../../system/api.md) 119, 3.6). A refusal SHALL answer its real status before anything streams. Closing the connection SHALL stop the run as Stop stops a chat turn: the agent turn aborts, nothing more is sent, and the run ends `stopped` with any partial answer.
- R17. A run MAY name one earlier run as its context: that run's question and answer SHALL reach the agent before this run's question, as a user and an assistant message, and nothing else of it; its own context SHALL NOT be carried. The earlier run SHALL be read from the stored runs (R18), so it can be named after the app restarts. A context naming no stored run SHALL be refused with `Run "<id>" not found`, and one without an answer with `Run "<id>" has no answer to continue from`.

Stored runs (1.23.14; the run history UI is 1.23.21)
- R18. Every run of a workflow on an input, code-only or agent, streamed (119) or not (118), SHALL be stored when it starts, as `running` with its workflow, the workflow's name, its checked input and its context, and updated when it ends with its status (`success`, `failed` or `stopped`), every step's status and output, its output or error and, for an agent workflow, its question, answer, datasets, agent, RFP, panel items, visuals and the agent's saved phases ([../../system/data-model.md](../../system/data-model.md) 3.16). A stopped run SHALL be stored `stopped` with any partial answer; a run that fails while ending SHALL be stored `failed` with that error. `POST /workflows/:id/runs` SHALL answer the stored run's id (`runId`) for a code-only workflow. An agent run's workspace SHALL stay with the stored run, so its files can be downloaded after the run, and after a restart.
- R19. The run history SHALL list every stored run, newest first, optionally one workflow's, each with its workflow, its status, its start and end, and a title: its question, else the workflow's first text input with a value, else the workflow's name, at most 120 characters ([../../system/api.md](../../system/api.md) 120). A stored run SHALL be readable with its full result, the panel items, workflow view and agent derived as a session's are (121), and its visuals, panel files and RFP packages SHALL download as a session's do (123-127). An unknown run SHALL answer `Run "<id>" not found` (HTTP 404).
- R20. Deleting a run SHALL remove it, its workspace and its files, and its memory thread (122: `Run deleted`). A run still running SHALL NOT be deleted (`Stop the run before deleting it`). When the app starts, a run left `running` SHALL become `failed` with `The app stopped before the run finished`, keeping its workspace, and a run workspace that no stored run owns SHALL be deleted. The start-up clean-up of the agent editor's previews SHALL NOT touch run workspaces.

Runs from a workflow's page (1.23.15)
- R21. The Assistant, Questions to Insights v2 and each user agent's workflow SHALL offer **Execute** and the **Run** tab on their page beside Start chat (which stays until 1.23.22); the Data Readiness Agent and the RFP Builder SHALL get them with their own stories (1.23.16, 1.23.17). The Run tab's form SHALL have one control per input field the app does not set itself, by type: a text area (under the question, the workflow's starter questions as example chips, which fill it and do not run), a text or number input, a checkbox for `boolean` (checked when its default is true), a datasets picker for `datasets` and a list for `dataset` (the datasets of the field's datasource kinds); a workflow over its own datasets (a user agent's) SHALL show them read-only instead. While the workflow has a run requirement, Execute SHALL be disabled with it, and the requirement written. Every run from the page SHALL stream ([../../system/api.md](../../system/api.md) 119), the Sequential test workflow's included: the status `Running…` and each step's status live in the Run tab and on its canvas node (`Running`, then `Done`, `Failed`, `Skipped` or `Stopped`), and inside a running agent step the agent's Thinking, each tool call with its rows and the answer forming; when it ends, the run as stored: its status line, each step's output field by field (a text as it is, quotes unescaped) and, for an agent workflow, its answer as a chat shows one (text, reasoning, interpretation, data with its SQL, badges, visual and report cards, the clarification card). **Stop** SHALL abort the stream; the run reads `Run stopped`, its running step `Stopped`, and is then shown as stored, with any partial answer. **Follow up** SHALL start a run on the shown run's input with the new question and the shown run as its context (R17), saying `Follows up on “<earlier question>”`; picking a clarification option (or `Something else`, or Skip) SHALL do the same with the pick as the question. A refusal before the run starts SHALL show the server's message under Execute (`Select at least one dataset`) and no result; a failure after it started SHALL read `Run failed: <error>`.

## Edge cases and errors

- Opening a workflow that is not in the catalogue (unknown, draft-only, System or a primary agent) answers `Workflow "<id>" not found` (HTTP 404).
- Starting a chat with a workflow that is not in the catalogue is refused with `Workflow "<id>" not found`, creating nothing. Sending both a workflow and an agent is refused with `Send workflowId or agentId, not both`.
- Starting a chat with a workflow refuses exactly as starting it from its agent does: the Assistant and Questions to Insights v2 with `session name is required` and `select at least one dataset`; the RFP Builder and the Data Readiness Agent with their requirement texts; a user agent with `None of this agent's datasets exist` ([../sessions-chat/spec.md](../sessions-chat/spec.md) R52).
- A deleted user agent's workflow leaves the catalogue. Its sessions keep the id `agent:<id>` and name it with the name the agent last had, marked deleted ([../sessions-chat/spec.md](../sessions-chat/spec.md) R59, R65).
- An agent editor's preview runs the agent's one-step workflow under the draft's name.
- Running a workflow that is not in the catalogue answers `Workflow "<id>" not found` (HTTP 404); running a workflow without input fields answers `Workflow "<id>" can't run on an input` (HTTP 400). Running the Assistant without a question is refused with `Question is required`, and with a question but no datasets with `Select at least one dataset`.
- Running the RFP Builder without the Intellify RFP API sample is refused with its requirement, `Load the "Intellify RFP API" sample in Settings → Testing Data first`; the Data Readiness Agent without a PostgreSQL or Databricks dataset with `Add a PostgreSQL or Databricks dataset first`, and on a REST dataset with `Dataset "<name>" is not a PostgreSQL or Databricks dataset`.
- A run whose agent turn fails ends with the chat stream's error for the same failure (a custom endpoint's `The endpoint rejected the API key (401)`); a stopped run sends nothing more. A run that ends on a clarifying question succeeds, its answer carrying the question and options, and its agent step `stopped`. Starting a chat with a run workflow is refused with `Workflow "seq-text-demo" can't start a chat`, creating nothing.
- Running the Sequential test workflow without a text is refused with `Text is required`. A text of only spaces is accepted and the run fails at Clean text with `The text is empty`, the other two steps skipped; the run still answers HTTP 200.
- A refused run (any R14 refusal, 404) stores nothing. A run whose user agent is deleted later keeps its workflow's name and stays listed, readable and deletable; a later run that names a deleted run as its context is refused with `Run "<id>" not found`.
- Reading, deleting or downloading from a run that doesn't exist answers `Run "<id>" not found` (HTTP 404); a file the run never showed answers the session routes' errors (`Panel item "<id>" not found`). Deleting a run while it runs answers `Stop the run before deleting it` (HTTP 400) and keeps it.
- If the app stops during a run, the run is listed `failed` with `The app stopped before the run finished` after the next start; the files its turn had written stay downloadable.

## Contracts

- Endpoints: [../../system/api.md](../../system/api.md) section 2.6.2 (116 `GET /workflows`, 117 `GET /workflows/:id`, 118 `POST /workflows/:id/runs`, 119 `POST /workflows/:id/runs/stream`), 2.6.3 (the stored runs: 120 `GET /workflow-runs`, 121 `GET /workflow-runs/:id`, 122 `DELETE /workflow-runs/:id`, 123-127 a run's visuals, panel files and RFP packages) and 3.6 (the run stream); 3 (`POST /sessions` with `workflowId`); 2.1 (the session's derived `workflowRef`); 34 (an agent's `usedInWorkflows`).
- Data: [../../system/data-model.md](../../system/data-model.md) 3.4 (`sessions.workflowId`), 3.13, 3.16 (its own collection, `workflow_runs`, and the start-up recovery) and 4.1 (run workspaces).
- Agents and steps: [../../system/agents.md](../../system/agents.md) 5.11 (`qti-v2-turn`), 5.12 (the catalogue, ids, triggers, the one-step workflow and the derivation rule), 5.13 (run workflows, `seq-text-demo`) and 5.14 (runs of agent workflows: the run host, context). Decisions: [../../system/architecture.md](../../system/architecture.md) ADR-0040 and its 2026-11-11 amendment; ADR-0041.

## UI

- The **Workflows** rail item, between Datasets and Agents (lucide `workflow` icon; [../../system/ui.md](../../system/ui.md) 1.3), and the `workflows` and `workflow-detail` views (ui.md 1.4).
- The Workflows page: the note `Each chat runs a workflow. Its steps call agents, and agents use skills and tools.`, the search, the Official and Mine sections and the workflow cards with Start chat (ui.md 4.4a).
- A workflow's page, a designer (ui.md 4.4b): the header with the breadcrumb, the name, id and kind and Execute or Start chat with its requirement (both for the Assistant, Questions to Insights v2 and user agents' workflows); the graph canvas with its zoom toolbar; the right panel's Workflow, Step, Run and Code tabs, with the bar note and the Agents rows on Workflow.
- An agent workflow's Run tab (ui.md 4.4b): the form per field type with the example chips, Execute and Stop, the live steps with the Thinking block, the answer view (`run-answer`), and Follow up.
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

### Feature: Workflow runs

E2E: `frontend/e2e/workflow-runs.spec.ts`

```gherkin
Feature: Workflow runs

  Background:
    Given a dataset "World Cup Core" and the recording stub model as the LLM

  @demo @story-1.23.15
  Scenario: I run the Assistant on a question
    When I open the Assistant from Workflows and click Execute
    Then the Run tab shows the question, the datasets to pick and Careful
    When I pick "World Cup Core", type "Which team scored the most goals?" and click Execute
    Then the Answer step is running on the canvas and in the Run tab, with its SQL call
    And I see the stub's answer with its SQL
    When I follow up with "And the fewest?"
    Then I see the second answer
    And the follow-up reached the model after the earlier question and answer
    When I run "Questions to Insights v2" on "How many matches were played in each stage?" over "World Cup Core"
    Then its four canvas nodes go Done and I see its answer

  Scenario: A run needs its datasets
    Given I am on the Assistant's Run tab
    When I type "Which team scored the most goals?" and click Execute with no dataset picked
    Then I see "Select at least one dataset" and no result

  Scenario: Stop ends the run
    Given the Assistant is running on a question
    When I click Stop
    Then the run reads "Run stopped" and its Answer step "Stopped"

  Scenario: A clarifying question becomes options
    Given the Assistant asked "Which measure of best do you mean?" with two options
    When I pick "Highest win rate"
    Then a new run answers, given the question and my pick

  Scenario: A user agent's workflow runs over its own datasets
    Given a published user agent "Health plan analyst" over "World Cup Core" with its own instructions
    And I am on its workflow's Run tab
    Then its dataset "World Cup Core" is shown read-only, with no picker
    When I run it on "Which team scored the most goals?"
    Then I see its answer, and its instructions reached the model
```

## Acceptance

- `GET /workflows` on a fresh data dir lists `agent:assistant`, `qti-v2-turn`, `agent:data-readiness` and `agent:rfp` in that order, the last two with their requirement; a published user agent adds `agent:<id>` and a draft-only one does not (R1).
- `GET /workflows/agent:sql-fixer` and the id of a draft-only agent answer 404 with `Workflow "<id>" not found` (R2).
- Starting a chat with `qti-v2-turn` binds the session to Questions to Insights v2 and stores `qti-v2-turn`; every session reads its workflow, `agent:assistant` for a plain one (R4).
- No route or control writes a workflow (R3); the Feature `Workflows` checks the pages for any Edit, New, Delete or reorder control.
- The Workflows page lists the Official workflows in catalogue order and a published user agent's under Mine, filters by search, and opens a workflow's page with its graph, bar note and agents; Start chat opens the New conversation screen for a workflow that picks datasets and otherwise creates and opens the session; RFP Builder's Start chat is disabled with its requirement (R5–R8, R10).
- The axe scan finds no violation on the Workflows page and on a workflow's page with the right panel open on its Workflow, Step and Code tabs, in both themes, including the Sequential test workflow's page after a successful and a failed run.
- A workflow's page is a designer: the canvas draws Start, each step with its badge and End down one line, with the fields passed on each connector; the panel opens on Workflow with the input parameters and output; choosing a node shows it on Step; Code shows the definition; Execute opens Run, and a run puts each step's status on its node (R7, R12, R13). Proven by the unit tests of the canvas layout (positions, connectors and size for 1, 3 and 4 steps), the canvas, the panel tabs and the page, and the `@story-1.23.10` scenario.
- `GET /workflows` lists `seq-text-demo` after `qti-v2-turn` with `trigger: 'run'` and its `Text` input. Running it on `  Hello   workflow   world  ` answers three successful steps and the summary `3 words, 20 characters: "Hello workflow world"`; on `   ` it fails at Clean text with `The text is empty` and skips the others; without a text it is refused with `Text is required`. Starting a chat with `seq-text-demo` is refused with `Workflow "seq-text-demo" can't start a chat` (R11).
- `GET /workflows` gives the Assistant, Questions to Insights v2, the Data Readiness Agent, the RFP Builder and each user agent's workflow their input and run requirement; each refusal of R14 has its exact message (R14). A streamed run of the Assistant, v2, the Data Readiness Agent and the RFP Builder sends the stub model the same requests as a chat turn on the same question and datasets, and ends with `done` carrying the answer; v2's run reports its four steps; closing the connection stops the run; a follow-up run sends the earlier question and answer first (R15–R17). The agents' `getInstructions()` and tool-list hashes are unchanged ([../../../evidence/1.23.12/agent-hashes.md](../../../evidence/1.23.12/agent-hashes.md)).
- Every run is stored when it starts and updated when it ends, including failed and stopped runs and a run that throws while ending; `POST /workflows/seq-text-demo/runs` answers its `runId`; the history lists runs newest first with their titles, filtered by workflow; a run reads back as its stream ended it; its panel files download from its workspace; deleting it removes its workspace, and a running run can't be deleted; after a restart, a run the app was killed in is `failed` with `The app stopped before the run finished`, an orphan run workspace is gone, and a stored run is still a follow-up's context (R17-R20). Proven by `backend/test/workflow-run-history.e2e-spec.ts` (the stub model, a real restart), `backend/src/modules/workflows/workflow-runs.service.spec.ts`, `workflow-run-steps.spec.ts`, `repositories/workflow-runs.repository.spec.ts` and `backend/src/modules/sessions/run-host-sessions.spec.ts` (the previews-only sweep). Evidence: [../../../evidence/1.23.14/api-transcript.txt](../../../evidence/1.23.14/api-transcript.txt).
- The Sequential test workflow's card shows `Runs on an input` and Run and no Start chat; its page runs it and shows each step `Done`, or `Failed` and `Skipped`, and the output; the New conversation screen never lists it (R12, R13).
- From the Assistant's page, Execute opens the Run tab with the question, the datasets picker and Careful; Execute streams the run (the Answer step `Running` on its node and in the tab, with the Thinking block and its SQL call), then shows the answer with its SQL and `Done`; Follow up runs again with the earlier question and answer before the new question in the model request; Questions to Insights v2's run puts `Done` on its four nodes; a run without a dataset is refused with `Select at least one dataset`; Stop reads `Run stopped`; a clarification's pick runs with the clarifying question in the request; a user agent's run shows its datasets read-only and sends its instructions (R21). Proven by `frontend/e2e/workflow-runs.spec.ts` (the stub model, World Cup), the unit tests of the run form per field type, the run stream (`workflow-runs-api.service.spec.ts`), the stream-to-state mapping, Stop and the Follow up body (`workflow-designer.service.spec.ts`, `workflow-panel.spec.ts`, `workflows.util.spec.ts`), and the axe scan of the Run tab with an answer in both themes.
- Proven by the backend's unit tests and its API-level tests of the workflow catalogue and runs (R1–R4, R11, R14–R17: `backend/test/workflows.e2e-spec.ts`, `backend/test/workflow-runs.e2e-spec.ts`, `backend/src/modules/sessions/run-host-sessions.spec.ts`, `backend/src/modules/workflows/workflow-runs.service.spec.ts`), the frontend unit tests of the sections, the Start chat branch and the run page, and `frontend/e2e/workflows.spec.ts` (R3, R5–R8, R10, R12, R13).

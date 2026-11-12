# Workflows

Every run runs a **workflow**: a fixed sequence of steps defined in code, each one deterministic code or a call to an agent. Since 2026-11-12 the catalogue holds one workflow, **Questions to Insights v2** (`qti-v2-turn`, four steps). Agents are no longer workflows: they are a library ([../agents-evals/spec.md](../agents-evals/spec.md)) that workflow steps call (workflows → agents → skills → tools), and they cannot be run from the Workflows area or from their own page. Workflows are read-only: the app never creates, edits or deletes one (ADR-0040, partly superseded by ADR-0042).

Every workflow is a **run workflow**: it runs once on a typed input defined in code and shows each step's result on its page; no chat can start (ADR-0041). Every run is stored: it is listed, reopened with its result and files, and deleted with them. A workflow's page is a designer: its graph on a canvas, its configuration, run and code in the right panel. The Run panel streams the run step by step and shows the answer with its provenance, and the user can stop it, follow up on it and answer its clarifying question. The one-step agent workflows (`agent:*`), the Sequential test workflow (`seq-text-demo`) and Deep analysis (`deep-analysis`) were removed on 2026-11-12; the runs they stored stay readable (R23).

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): workflow, code-defined workflow, agent, user agent, Live, session, workflow bar, workflow phase.

Capability-local vocabulary: a workflow's **id** (`qti-v2-turn`), the agent a code-defined workflow runs for (its **primary agent**), its **trigger** (`run`), a workflow's **input** (its typed fields), a **run** (one execution of a workflow on an input), a run's **context** (one earlier run whose question and answer it is given), the **run host** (internal: the in-memory session a run's agent turn executes on) and a **legacy run** (a stored run of a workflow that is no longer in the catalogue, R23).

## Rules

The catalogue
- R1. The workflow catalogue SHALL list exactly one workflow, **Questions to Insights v2** (`qti-v2-turn`, owner `Official`). It SHALL NOT list any agent: no System, Official, draft-only or Live user agent has a workflow. The entry SHALL carry its name, description, kind, owner, the agents its steps call, its number of steps, whether it takes the datasets the user picks, the datasets a session would take, the missing ones and the starter questions ([../../system/api.md](../../system/api.md) 116).
- R2. The workflow's id SHALL be `qti-v2-turn`. Any other id SHALL NOT resolve to a workflow, including the removed one-step ids `agent:assistant`, `agent:data-readiness`, `agent:<user-agent id>` and `agent:rfp`, and the removed `seq-text-demo` and `deep-analysis` (2026-11-12).
- R3. Workflows SHALL be defined in code. The app SHALL NOT offer any control that creates, edits, reorders or deletes a workflow or a step, and the API SHALL have no write route for workflows. Publishing, editing or deleting a user agent SHALL NOT change the catalogue.

Sessions
- R4. Every session SHALL run one workflow. A session created from this version on SHALL store the id of its workflow at creation and never change it. A session saved before SHALL have its workflow derived at every read: Questions to Insights v2 → `qti-v2-turn`; the Data Readiness Agent, a user agent (existing or deleted) and a plain session keep their internal `agent:<key or id>` reference as before (`agent:assistant` for a plain one), which is not in the catalogue and links to no workflow page; a session stored with `seq-text-demo` or `deep-analysis` reads as a plain Assistant session ([../../system/api.md](../../system/api.md) 2.1; [../../system/data-model.md](../../system/data-model.md) 3.4; [../past-chats/spec.md](../past-chats/spec.md) R65).

The Workflows pages
- R5. The **Workflows** area of the navigation rail ([../app-shell/spec.md](../app-shell/spec.md) R3) SHALL show the catalogue (R1) in one section, **Official**, with no **Mine** section. The workflow SHALL show its name, its description, its kind (`<n> steps`), `Uses <the names of the agents its steps call>`, its missing datasets (`Missing dataset: <names>`) and **Run** (R12); it has no Start chat. The page SHALL say, under its heading, `Each workflow runs on an input. Its steps call agents, and agents use skills and tools.` A search SHALL filter the list by name or description, ignoring case; when nothing matches, the page SHALL say `No workflows match "<query>"`.
- R6. Retired (1.23.22). **Start chat** is gone from every workflow card and page: chats can no longer be started. `POST /sessions` with a `workflowId` is refused with `Workflow "<id>" runs on an input`, creating nothing ([../../system/api.md](../../system/api.md) 3). Past chats stay readable ([../past-chats/spec.md](../agent-answers/spec.md) R66).
- R7. Opening a workflow SHALL show its page as an n8n-style **designer** (since 1.23.10; left to right since the n8n-style page): a header with the breadcrumb `Workflows / <name>` (its first part goes back to the Workflows page), the name, id, kind and missing datasets, and no action; the workflow's **graph** on a canvas, left to right on one centre line (a Start node, one node per step with its title, id and kind badge `CODE` or `LLM`, an agent step's model and tools as sub-nodes under it, an End node, and between them connectors labelled with the number of fields each passes on, as `GET /workflows/:id` returns them), fitted to the canvas when it opens (40%–100%), with zoom (50%–150%), reset and fit to screen, and **Execute workflow** at its top-right (R12); under the canvas the **Workflow state** panel (collapsible): the run's status, `<n> of <m> nodes ran` (Start and End count), its duration and run id, and per node its status, duration, input, output and, for a step, its context; and the app's right panel, opened with the page and headed **Run**, holding only the run form and the run shown (R12, R13). Clicking a node SHALL select it on the canvas and in the Workflow state panel; double-clicking it (or Enter) SHALL open its **node dialog**: its Input, its Parameters and Settings, and its Output in the run shown (Start: the description, trigger, output fields, input parameters and agents (R8); a step: id, kind, agent, model, tools, max steps, exits, what it receives and returns and the agent's system prompt). A click, double click or Enter on a **tool** sub-node SHALL open that tool's dialog, not its agent step's: its name, description and input parameters (`GET /workflows/:id` `agents[].toolDetails`), its agent and step, and, in the run shown, each of its calls in that step with its input (the SQL) and result, their count, total duration and the run id; the agent's system prompt SHALL NOT appear in it. The Model and `+<n> tools` sub-nodes SHALL open their agent step's dialog. Workflows SHALL stay the current rail item while the page is open. The agent detail's Graph tab keeps its own drawing ([../agents-evals/spec.md](../agents-evals/spec.md) R108).
- R8. A workflow's Start node dialog SHALL list, under **Agents**, each agent its steps call, and an agent step's dialog SHALL link its agent. Choosing one SHALL open that agent's detail ([../agents-evals/spec.md](../agents-evals/spec.md) R5).
- R9. The Workflows page SHALL read the catalogue each time it opens. Opening a workflow that is not in the catalogue SHALL show `Workflow "<id>" not found` on its page.
- R10. Retired (1.23.22). The Workflow tab no longer carries the workflow bar note (`In a chat, the workflow bar shows …`): no chat runs a workflow, so no bar follows it.

Run workflows
- R11. Every workflow SHALL have the trigger `run` (since 1.23.22; `chat` is gone). A workflow SHALL declare its input in code: typed fields, each with a name, a label, a type (`text`, `textarea` or `number`; R14 adds `boolean`, `datasets` and `dataset`), whether it is required and an optional placeholder. The catalogue SHALL carry each workflow's trigger and input ([../../system/api.md](../../system/api.md) 116). Running a workflow SHALL run its steps once, in order, on the input and answer each step's status (`success`, `failed` or `skipped`) and output, and the final output; a failing step SHALL make the run failed with that step's error, and the steps after it SHALL be skipped ([../../system/api.md](../../system/api.md) 118). A required field that is missing or empty SHALL be refused with `<label> is required`, and a number field that is not a number with `<label> must be a number`, running nothing. A run SHALL NOT be a session: it writes no workflow bar and is never listed with the sessions; it is stored as a workflow run (R18). A workflow without input fields SHALL NOT be run (`Workflow "<id>" can't run on an input`), and no workflow can start a chat (`Workflow "<id>" runs on an input`, creating nothing).
- R12. A workflow's card SHALL show its kind (R5) and **Run**, which opens its page. A workflow's page SHALL show **Execute workflow** on its canvas, which opens the right panel (**Run**) and focuses its form, and never runs by itself: an **Input** form with one labelled control per field (a text area, a text input or a number input, with its placeholder, marked required when required) and **Execute**, which reads `Executing…` and is disabled while the run is going. Its Start node dialog SHALL list the input fields as its input parameters (name, label, type, `required`), and Agents only when its steps call one.
- R13. After a run, the Run panel SHALL show the **Result** under the form: `Run succeeded` or `Run failed: <error>`, then one row per step with its number, its title, a status (`Done`, `Failed` or `Skipped`), a failed step's error and a successful step's output, and the run's final output field by field; while the result is shown, each node on the canvas (Start and End included) SHALL carry its status as a badge, each connector leaving a `Done` node SHALL be marked done, and the Workflow state panel and each node's dialog SHALL show what the node received (its input) and produced in that run, its duration and, for an agent step, its tool calls; a failed node shows its error in its Output. A refusal SHALL be shown under Execute with the server's message (`Question is required`) or `Backend unreachable`. Running again SHALL replace the result, and leaving the page SHALL discard it.

Runs of Questions to Insights v2 (ADR-0041; backend only in 1.23.12)
- R14. The workflow SHALL declare its input in code, with the field types `text`, `textarea`, `number`, `boolean` (a checkbox; absent means false), `datasets` (one or more dataset names) and `dataset` (exactly one), each field optionally with a default, a datasource-kind limit and a hidden flag ([../../system/api.md](../../system/api.md) 116): Questions to Insights v2 takes `question` and `datasets`. A run's input SHALL be checked in field order before anything runs, the first refusal winning: `<label> is required`, `Select at least one dataset`, `<label> must be a number`, `<label> must be true or false`, `Dataset "<name>" not found`, `Dataset "<name>" is not a <kinds> dataset`; a blank question SHALL be refused with `<label> is required`; unknown keys SHALL be ignored.
- R15. A run of Questions to Insights v2 SHALL run its steps on the run's input, its analyse step being an agent turn with the same model request a chat turn sent for the same question over the same datasets, and the same answer: the grounding guard, tool-only synthesis, clarification, visuals and panel items SHALL behave as they did in a chat turn. Its run host SHALL exist only for the run: created when it starts, never listed with the sessions, its memory thread deleted and itself discarded when it ends; its workspace stays with the run.
- R16. A streamed run SHALL report, in order: that it started (its run id), each step's start and end with its status (`running`, then `success`, `failed`, `stopped`, or `skipped` for a step that never ran) and output, the agent turn's events exactly as the chat stream sends them, and one terminal event: the run with its answer, steps, output, datasets, panel items, visuals, or the chat stream's error for the same failure ([../../system/api.md](../../system/api.md) 119, 3.6). A refusal SHALL answer its real status before anything streams. Closing the connection SHALL stop the run as Stop stops a chat turn: the agent turn aborts, nothing more is sent, and the run ends `stopped` with any partial answer.
- R17. A run MAY name one earlier run as its context: that run's question and answer SHALL reach the agent before this run's question, as a user and an assistant message, and nothing else of it; its own context SHALL NOT be carried. The earlier run SHALL be read from the stored runs (R18), so it can be named after the app restarts. A context naming no stored run SHALL be refused with `Run "<id>" not found`, and one without an answer with `Run "<id>" has no answer to continue from`.

Stored runs (1.23.14; the run history UI is 1.23.21)
- R18. Every run of a workflow on an input, streamed (119) or not (118), SHALL be stored when it starts, as `running` with its workflow, the workflow's name, its checked input and its context, and updated when it ends with its status (`success`, `failed` or `stopped`), every step's status and output, its output or error and its question, answer, datasets, agent, panel items, visuals and the agent's saved phases ([../../system/data-model.md](../../system/data-model.md) 3.16). A stopped run SHALL be stored `stopped` with any partial answer; a run that fails while ending SHALL be stored `failed` with that error. A run's workspace SHALL stay with the stored run, so its files can be downloaded after the run, and after a restart.
- R19. The Runs page's **Runs** tab (app-shell R46) SHALL show the run history and a row SHALL reopen its stored run read-only (`run-detail`, with **Run again**, which opens the workflow's Run panel with the run's input filled in, when the run's workflow is still in the catalogue; a legacy run (R23) has no Run again (it shows only while the run's workflow still resolves); roadmap 1.23.21). The run history SHALL list every stored run, newest first, optionally one workflow's, each with its workflow, its status, its start and end, and a title: its question, else the workflow's first text input with a value, else the workflow's name, at most 120 characters ([../../system/api.md](../../system/api.md) 120). A stored run SHALL be readable with its full result, the panel items, workflow view and agent derived as a session's are (121), and its visuals and panel files SHALL download as a session's do (123-126). An unknown run SHALL answer `Run "<id>" not found` (HTTP 404).
- R20. Deleting a run SHALL remove it, its workspace and its files, and its memory thread (122: `Run deleted`). A run still running SHALL NOT be deleted (`Stop the run before deleting it`). When the app starts, a run left `running` SHALL become `failed` with `The app stopped before the run finished`, keeping its workspace, and a run workspace that no stored run owns SHALL be deleted. The start-up clean-up of the agent editor's previews SHALL NOT touch run workspaces.

Runs from a workflow's page (1.23.15)
- R21. Questions to Insights v2 SHALL offer **Execute workflow** and the **Run** panel on their page (no Start chat). The Run panel's form SHALL have one control per input field the app does not set itself, by type: a text area (under the question, the workflow's starter questions as example chips, which fill it and do not run), a text or number input, a checkbox for `boolean` (checked when its default is true), a datasets picker for `datasets` and a list for `dataset` (the datasets of the field's datasource kinds); Every run from the page SHALL stream ([../../system/api.md](../../system/api.md) 119): the status `Running…` and each step's status live in the Run panel, on its canvas node and in the Workflow state panel (`Running`, then `Done`, `Failed`, `Skipped` or `Stopped`), and inside a running agent step the agent's Thinking, each tool call with its rows and the answer forming,, live and then as stored, and the agent's phases; when it ends, the run as stored: its status line, each step's output field by field (a text as it is, quotes unescaped) and its answer as a chat shows one (text, reasoning, interpretation, data with its SQL, badges, visual, the clarification card); a run's file panel items are listed under **Files** with Download. **Stop** SHALL abort the stream; the run reads `Run stopped`, its running step `Stopped`, and is then shown as stored, with any partial answer. **Follow up** SHALL start a run on the shown run's input with the new question and the shown run as its context (R17), saying `Follows up on “<earlier question>”`; picking a clarification option (or `Something else`, or Skip) SHALL do the same with the pick as the question. A refusal before the run starts SHALL show the server's message under Execute (`Select at least one dataset`) and no result; a failure after it started SHALL read `Run failed: <error>`.
- R22. The answer on the Run panel SHALL offer the same rating as a chat answer ([../verified-queries/spec.md](../verified-queries/spec.md) R1-R7, R18; [../../system/api.md](../../system/api.md) 128): a thumbs-up saves the run's question and last successful SQL as a verified query, keyed by the run, and shows the toast `Answer saved as a verified query` and the `Verified` badge; a thumbs-down removes it. The rating is stored on the run's answer.

Legacy runs (2026-11-12)
- R23. A stored run whose workflow is no longer in the catalogue (the one-step `agent:*` workflows, `seq-text-demo` and `deep-analysis`) SHALL stay listed on the Runs tab, open read-only with its stored result, files, steps and answer, and be deletable, like any run (R19, R20). Its title SHALL be its question, else its first stored text input, else its workflow's stored name. It SHALL show its stored workflow name as plain text, with no link to a workflow page, no **Run again** (shown only while `GET /workflows/<its workflowId>` resolves) and no follow-up (a run or follow-up on it answers `Workflow "<id>" not found`, 404), and its rating, if any, stays. A message's stored `report` stays readable (a stored deep-analysis message shows as a plain answer). A `qti-v2-turn` run whose `context` names a legacy run needs that run to have an answer, else it is refused with `Run "<id>" has no answer to continue from`. Nothing is migrated or deleted.

## Edge cases and errors

- Opening a workflow that is not in the catalogue (unknown, draft-only, System or a primary agent) answers `Workflow "<id>" not found` (HTTP 404).
- Starting a chat with any workflow is refused with `Workflow "<id>" runs on an input`, whatever the id, creating nothing (R6).
- Starting a chat with a workflow in the catalogue is refused with `Workflow "<id>" runs on an input`, creating nothing (R6); an id that is not in the catalogue answers `Workflow "<id>" not found` first.
- A removed workflow id (`agent:assistant`, `agent:data-readiness`, `agent:<id>`, `seq-text-demo`, `deep-analysis`) answers `Workflow "<id>" not found` (HTTP 404) on read and on run. A user agent's draft preview (Try it) is not a workflow run ([../agents-evals/spec.md](../agents-evals/spec.md)).
- Running a workflow without input fields answers `Workflow "<id>" can't run on an input` (HTTP 400). Running Questions to Insights v2 without a question is refused with `Question is required`, and with a question but no datasets with `Select at least one dataset`.
- A run whose agent turn fails ends with the chat stream's error for the same failure (a custom endpoint's `The endpoint rejected the API key (401)`); a stopped run sends nothing more. A run that ends on a clarifying question succeeds, its answer carrying the question and options, and its agent step `stopped`.
- A refused run (any R14 refusal, 404) stores nothing. A run of a workflow that has since been removed keeps its workflow's stored name and stays listed, readable and deletable (R23).
- Reading, deleting or downloading from a run that doesn't exist answers `Run "<id>" not found` (HTTP 404); a file the run never showed answers the session routes' errors (`Panel item "<id>" not found`). Deleting a run while it runs answers `Stop the run before deleting it` (HTTP 400) and keeps it.
- If the app stops during a run, the run is listed `failed` with `The app stopped before the run finished` after the next start; the files its turn had written stay downloadable.

## Contracts

- Endpoints: [../../system/api.md](../../system/api.md) section 2.6.2 (116 `GET /workflows`, 117 `GET /workflows/:id`, 118 `POST /workflows/:id/runs`, 119 `POST /workflows/:id/runs/stream`), 2.6.3 (the stored runs: 120 `GET /workflow-runs`, 121 `GET /workflow-runs/:id`, 122 `DELETE /workflow-runs/:id`, 123-126 a run's visuals and panel files; 127 removed) and 3.6 (the run stream); 3 (`POST /sessions` with `workflowId`); 2.1 (the session's derived `workflowRef`); 34 (an agent's `usedInWorkflows`).
- Data: [../../system/data-model.md](../../system/data-model.md) 3.4 (`sessions.workflowId`), 3.13, 3.16 (its own collection, `workflow_runs`, and the start-up recovery) and 4.1 (run workspaces).
- Agents and steps: [../../system/agents.md](../../system/agents.md) 5.11 (`qti-v2-turn`), 5.12 (the catalogue: `qti-v2-turn` only; the one-step workflow is removed), 5.13 and 5.15 (removed) and 5.14 (runs: the run host, context). Decisions: [../../system/architecture.md](../../system/architecture.md) ADR-0040 (partly superseded), ADR-0041, ADR-0042.

## UI

- The **Workflows** rail item, between Datasets and Agents (lucide `workflow` icon; [../../system/ui.md](../../system/ui.md) 1.3), and the `workflows` and `workflow-detail` views (ui.md 1.4).
- The Workflows page: the note `Each workflow runs on an input. Its steps call agents, and agents use skills and tools.`, the search, the Official section and the workflow card with **Run** (ui.md 4.4a).
- A workflow's page, an n8n-style designer (ui.md 4.4b): the header with the breadcrumb, the name, id and kind; the left-to-right canvas with Execute workflow and its zoom toolbar; the Workflow state panel under it; the node dialog (Input, Parameters and Settings, Output), with the Agents links on Start; and the right panel headed Run.
- Questions to Insights v2's Run panel (ui.md 4.4b): the form per field type with the example chips, Execute and Stop, the live steps with the Thinking block, the answer view (`run-answer`), and Follow up.
- A workflow's card: its kind chip and **Run** (ui.md 4.4a); its page's **Execute workflow** on the canvas, and the Run panel's **Input** form, **Execute** and **Result**, with the run status on the canvas nodes (ui.md 4.4b).
- No control creates, edits, reorders or deletes a workflow or a step (R3).

## Flows

### Feature: Workflows

E2E: `frontend/e2e/workflows.spec.ts`

```gherkin
Feature: Workflows

  Background:
    Given a dataset "World Cup Core" and the recording stub model as the LLM

  @demo @story-1.23.5
  Scenario: Open a workflow and run it from its page
    When I click "Workflows" on the rail
    Then I see only "Questions to Insights v2" under Official, and no Mine section
    When I open "Questions to Insights v2"
    Then I see its four steps on the canvas and the agent "Questions to Insights v2" under Agents in its Start node
    When I click "Execute workflow"
    Then the panel opens on Run and no chat is started

  Scenario: Workflows can't be edited
    When I open Workflows
    Then I see no Edit, New, Delete or reorder control on the list
    When I open "Questions to Insights v2"
    Then I see no Edit, New, Delete or step-reorder control on its page or in its panel

  Scenario: Search filters the list
    Given I am on Workflows
    When I search for "insights"
    Then only the "Questions to Insights v2" card is shown
    When I search for "zzz"
    Then I see "No workflows match "zzz""

  @demo @story-1.23.9
  Scenario: I run Questions to Insights v2 on a question from its card
    When I open Workflows
    Then I see "Questions to Insights v2" with "4 steps" and no Start chat
    When I click its Run
    Then I see its four steps on the canvas, Execute and no Start chat
    When I click Execute workflow
    Then the Run panel shows the "Question" input and the datasets to pick
    When I pick "World Cup Core" and type "How many matches were played in each stage?"
    And I click Execute in the panel
    Then I see "Run succeeded" with "Receive question", "Load catalog", "Analyse" and "Wrap up" all "Done"
    And I see the model's answer

  Scenario: A failing step stops the run
    Given I am on the "Questions to Insights v2" page
    When the model fails and I run it on a question
    Then I see "Run failed" with the error
    And "Receive question" and "Load catalog" are "Done", "Analyse" is "Failed" and "Wrap up" is "Skipped"
    And the canvas shows "Failed" on "Analyse" and "Skipped" on "Wrap up"

  @demo @story-1.23.10
  Scenario: A workflow opens as a designer
    When I open "Questions to Insights v2" from Workflows
    Then the canvas shows Start, its four steps in order with their badges, and End, left to right
    And the right panel is open on Run beside the canvas, with the Workflow state panel under the canvas
    When I double-click Start
    Then its dialog shows the trigger, the input parameters and the output
    When I click "Analyse" on the canvas
    Then "Analyse" is selected on the canvas and in the Workflow state panel
    When I double-click "Analyse"
    Then its dialog shows its model, its tools and "Max steps 15"
    When I click Execute workflow
    Then the Run panel focuses its input and nothing runs
    When I pick a dataset, type a question and click Execute
    Then I see the answer and "Done" on the four canvas nodes

  @demo
  Scenario: A run shows each node's data in the Workflow state panel and the node dialog
    Given I am on the "Questions to Insights v2" page
    When I run it on "How many matches were played in each stage?"
    Then every connector is done and the Workflow state panel reads "6 of 6 nodes ran"
    When I double-click "Wrap up"
    Then its Input holds the Analyse step's SQL call and its Output the counts
    When the model fails and I run it again
    Then the "Analyse" dialog shows the error in its Output

  @demo
  Scenario: A tool sub-node opens the tool's own details
```

### Feature: Workflow runs

E2E: `frontend/e2e/workflow-runs.spec.ts`

```gherkin
Feature: Workflow runs

  Background:
    Given a dataset "World Cup Core" and the recording stub model as the LLM

  @demo @story-1.23.15
  Scenario: I run Questions to Insights v2 on a question
    When I open "Questions to Insights v2" from Workflows and click Execute
    Then the Run tab shows the question and the datasets to pick, and no Careful
    When I pick "World Cup Core", type "Which team scored the most goals?" and click Execute
    Then the Analyse step is running on the canvas and in the Run tab, with its SQL call
    And I see the stub's answer with its SQL, and its four steps Done
    When I follow up with "And the fewest?"
    Then I see the second answer
    And the follow-up reached the model after the earlier question and answer

  @demo @story-1.23.19
  Scenario: I rate a run's answer and it becomes a verified query
    Given I ran "Questions to Insights v2" on "Which team scored the most goals?"
    When I give the run's answer a thumbs-up
    Then I see "Answer saved as a verified query" and the Verified badge
    When I run the same question again, then its answer shows Verified

  Scenario: A run needs its datasets
    Given I am on the Run tab of "Questions to Insights v2"
    When I type "Which team scored the most goals?" and click Execute with no dataset picked
    Then I see "Select at least one dataset" and no result

  Scenario: Stop ends the run
    Given "Questions to Insights v2" is running on a question
    When I click Stop
    Then the run reads "Run stopped" and its Analyse step "Stopped"
```

## Acceptance

- `GET /workflows` on a fresh data dir lists only `qti-v2-turn`; a published user agent adds nothing (R1). `GET /workflows/agent:assistant`, `agent:data-readiness`, `agent:<user-agent id>`, `agent:sql-fixer`, `seq-text-demo` and `deep-analysis` answer 404 with `Workflow "<id>" not found` (R2).
- `POST /sessions { workflowId }` is refused with `Workflow "<id>" runs on an input` for the catalogue's workflow and creates nothing (R6); every stored session still reads without error: `qti-v2-turn` for a v2 session, its `agent:*` reference for the others, and a plain Assistant session for one stored with `seq-text-demo` or `deep-analysis` (R4).
- No route or control writes a workflow (R3); the Feature `Workflows` checks the pages for any Edit, New, Delete or reorder control.
- The Workflows page lists Questions to Insights v2 under Official only, filters by search, and opens its page with its graph and, in its Start node dialog, its agent; its card has Run and no Start chat (R5-R8, R12).
- The axe scan finds no violation on the Workflows page and on the workflow's page with the right panel open on Run, with a node dialog open, and with the Workflow state panel expanded on a node, in both themes.
- A workflow's page is an n8n-style designer: the canvas draws Start, each step with its badge and End left to right on one centre line, fitted at 100% or less; the right panel opens on Run, beside the canvas, with no tabs; the Workflow state panel sits under the canvas; a click selects a node on the canvas and in the state panel; a double click opens its dialog (Start: the trigger, input parameters, output and agents; Analyse: its model, tools and `Max steps 15`); Execute workflow opens Run and focuses the form without running; a run puts each node's status on it, marks each connector done, reads `6 of 6 nodes ran`, and shows each node's input and output in its dialog, and a failed step's error (R7, R8, R12, R13). Proven by the unit tests of the canvas layout and canvas, the node inspection builder, the data view, the node dialog, the state panel, the designer (`workflow-designer.service.spec.ts`), the panel and the page, and the `@story-1.23.10` and `A run shows each node's data in the Workflow state panel and the node dialog` scenarios.
- Double-clicking the `run_readonly_sql` sub-node under Analyse opens a dialog titled `run_readonly_sql` with its description and inputs and without the agent's system prompt; after a run that called it, its Input shows the SQL and its Output `Done`; the Model and `+<n> tools` sub-nodes still open Analyse; `GET /workflows/qti-v2-turn` gives its agent the `toolDetails` of `GET /agents/assistant-v2` (R7). Proven by `workflow-node-inspection.spec.ts` (`buildToolInspection`), `workflow-designer.service.spec.ts`, `workflow-canvas.spec.ts`, `workflow-node-dialog.spec.ts`, `backend/src/modules/workflows/workflows.service.spec.ts`, `backend/test/workflows.e2e-spec.ts`, the scenario `A tool sub-node opens the tool's own details` and the axe scan of the tool dialog in both themes.
- `GET /workflows` gives Questions to Insights v2 its input (no run requirement exists); each refusal of R14 has its exact message (R14). A streamed run of v2 sends the stub model the same requests as a chat turn on the same question and datasets, reports its four steps and ends with `done` carrying the answer; closing the connection stops the run; a follow-up run sends the earlier question and answer first (R15-R17).
- Every run is stored when it starts and updated when it ends, including failed and stopped runs and a run that throws while ending; the history lists runs newest first with their titles, filtered by workflow; a run reads back as its stream ended it; its panel files download from its workspace; deleting it removes its workspace, and a running run can't be deleted; after a restart, a run the app was killed in is `failed` with `The app stopped before the run finished`, an orphan run workspace is gone, and a stored run is still a follow-up's context (R17-R20). A stored run of a removed workflow lists, opens and deletes like any run, with no Run again and no follow-up (R23). Proven by `backend/test/workflow-run-history.e2e-spec.ts` (the stub model, a real restart), `backend/src/modules/workflows/workflow-runs.service.spec.ts`, `workflow-run-steps.spec.ts`, `repositories/workflow-runs.repository.spec.ts` and `backend/src/modules/sessions/run-host-sessions.spec.ts` (the previews-only sweep). Evidence: [../../../evidence/1.23.14/api-transcript.txt](../../../evidence/1.23.14/api-transcript.txt).
- From the workflow's page, Execute workflow opens the Run panel with the question and the datasets picker; Execute streams the run (its four nodes going `Running` then `Done`, with the Thinking block and its SQL call), then shows the answer with its SQL; Follow up runs again with the earlier question and answer before the new question in the model request; a run without a dataset is refused with `Select at least one dataset`; Stop reads `Run stopped`; a clarification's pick runs with the clarifying question in the request (R21). Proven by `frontend/e2e/workflow-runs.spec.ts` (the stub model, World Cup), the unit tests of the run form per field type, the run stream (`workflow-runs-api.service.spec.ts`), the stream-to-state mapping, Stop and the Follow up body (`workflow-designer.service.spec.ts`, `workflow-panel.spec.ts`, `workflows.util.spec.ts`), and the axe scan of the Run panel with an answer in both themes.
- Proven by the backend's unit tests and its API-level tests of the workflow catalogue and runs (R1-R4, R11, R14-R17: `backend/test/workflows.e2e-spec.ts`, `backend/test/workflow-runs.e2e-spec.ts`, `backend/src/modules/sessions/run-host-sessions.spec.ts`, `backend/src/modules/workflows/workflow-runs.service.spec.ts`), the frontend unit tests of the run page, and `frontend/e2e/workflows.spec.ts` (R3, R5-R8, R10, R12, R13).

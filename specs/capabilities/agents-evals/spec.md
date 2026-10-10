# Agents and evals

The Agents screen is the **Agent Hub**: the user finds, filters and pins agents, built-in or their own, and opens any of them. An agent's detail view shows its prompt, tools, memory and model, lets the user publish or delete their own agents, and lets the user measure the main assistant against curated question suites. The user picks a suite, ticks the questions to run, chooses a datasource, and watches the run finish question by question. Every question is scored by explicit checks; a failed question explains why and shows the exact steps the assistant took. Past executions are kept, can be downloaded as a Markdown report and are compared with the previous comparable run to surface regressions.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): agent, Agent Hub, user agent, official agent, system agent, draft (agent), Live (agent), pin, assistant, eval set, eval case, eval check, eval run, sample fixture, dataset, datasource, entity, tool call, knowledge entry, session.

Capability-local vocabulary:
- **Agent definition** — a user agent's stored configuration (`AgentConfig`): name, description, instructions, datasets, starter questions and optional model and reasoning effort; shape in [../../system/data-model.md](../../system/data-model.md) section 3.10.
- **Unpublished changes** — a Live agent whose draft differs from its Live version.
- **Section** — a group of agent cards on the hub, one per kind of agent: **Official**, **Mine** or **System**. The **Pinned** filter shows a single **Pinned** section instead.
- **Filter** — one of the hub's pills (**All**, **Pinned**, **Official**, **Mine**) that limits which agents and sections show.
- **Questions** and **Executions** — the two sub-tabs inside an agent's Evals tab: the suite, and the history of runs.
- **Regression comparison** — the per-question diff between a finished run and the previous comparable run; see R32.
- **Details panel** — the right-hand panel ([../app-shell/spec.md](../app-shell/spec.md)); on an agent's detail view it shows one question's scoring and trace.

## Rules

Agent Hub and agent detail
- R1. The **Agents** screen SHALL be the Agent Hub. It SHALL show the heading "Agents"; a **New agent** button, which opens the agent editor for a new agent (R54); a search field with the placeholder `Search agents by name or description`; a group of filter pills labelled `Filter agents`: **All** (selected when the hub opens), **Pinned**, **Official** and **Mine**; and the agents as cards in sections. Under All the sections SHALL be, in this order, **Official** (`official`), **Mine** (`user`) and **System** (`system`), and each agent SHALL appear in the section of its kind, pinned or not; there is no Pinned section under All. A section with no agents SHALL be omitted, so Mine is omitted when there are no user agents. Within a section, pinned cards SHALL come first, then the others, each group alphabetical by name. In every view each agent SHALL appear exactly once. Each card SHALL show a sparkles icon, the name, a pin toggle (R4), the description clipped to two lines and the owner (`Owner: You`, `Owner: Official` or `Owner: System`). A user agent's card SHALL also show a status chip `Draft` or `Live`, the badge `Unpublished changes` when it has unpublished changes (R44), and the note `Missing dataset: <names>` (comma-separated) when its `missingDatasets` is not empty (R48). The Official card and the card of every Live user agent SHALL also show a **Start chat** button with the accessible name `Start chat with <name>` (R53). Cards SHALL NOT show tools or the id.
- R2. Search SHALL match the trimmed query, case-insensitively, as a substring of the agent's name or description, and SHALL apply as the user types. The filters SHALL show: All, the sections of R1; Pinned, a single **Pinned** section holding every pinned agent of any kind, ordered by kind (Official, Mine, System) and then by name; Official, only the assistant, in the Official section; Mine, only user agents, pinned or not, in the Mine section (pinned first, R1). The System section SHALL show only under All. Search and filter combine. States: while loading, "Loading agents…"; on failure, the backend's message or "Backend unreachable"; a non-empty query that matches nothing, `No agents match "<query>"`; otherwise the Pinned filter with nothing pinned shows `No pinned agents yet.` and the Mine filter with no user agents shows `No agents of yours yet.`. Under All with no user agents, the Mine section is omitted.
- R3. Each section SHALL show its first row of 3 cards. When more of its agents match the search and filter, a `Show more (<n>)` control SHALL follow, where n is the number of hidden cards. Clicking it SHALL show every card of the section and turn the control into `Show less`, which collapses the section to its first row again. Each section expands on its own. The search text, the filter and the expanded sections SHALL reset each time the hub opens, including on return from a detail view.
- R4. Each card's pin toggle SHALL read `Pin`, with the accessible name `Pin <name>`, or `Pinned`, with the accessible name `Unpin <name>`, and SHALL expose its pressed state. Clicking it, or a card's **Start chat**, SHALL NOT open the agent. The change SHALL show on the hub at once: the toggle flips and the card re-orders within its own section (pinned cards first, R1). It SHALL NOT move the card to another section or hide a section. Under the Pinned filter, unpinning removes the card from the Pinned section. The change is then saved (R47), so it survives a restart. If saving fails, the card SHALL return to its previous state and an error toast SHALL show the backend's message or "Backend unreachable". A successful pin or unpin raises no toast.
- R5. Clicking a card anywhere but its pin toggle or its **Start chat** SHALL open the agent's detail view. The view SHALL show an **All agents** back button to the hub, the name as heading, the id, the description and, for a user agent, its `Draft` or `Live` chip and `Unpublished changes` badge; then five tabs: **Prompt template**, **Tools (N)**, **Memory**, **Model**, **Evals**, with Prompt template selected first. Opening a different agent SHALL reset all tab, selection and run state. A Live user agent's detail and the Official agent's detail SHALL offer **Start chat** (R53). A user agent's detail SHALL also offer **Edit**, which opens the agent editor on its draft (R54), and two more actions:
  - **Publish**, shown only when the agent has no Live version or has unpublished changes. It publishes the draft (R44, R45) and shows the backend's message as a toast: `Agent "<name>" is Live`, or the refusal, such as `Select at least one dataset to publish`. On success the detail reloads, so the button disappears and the chip reads `Live`.
  - **Delete**, which first asks `Delete "<name>"?` with the explanation `Its sessions keep their transcripts and continue with the assistant.`. Cancelling changes nothing. Confirming deletes the agent (R50), shows the toast `Agent "<name>" deleted` and returns to the hub, which no longer lists it. A failure shows the backend's message as a toast and stays on the detail.

  Built-in agents (Official and System) SHALL offer neither Edit, Publish nor Delete. System agents SHALL NOT offer Start chat.
- R6. The Prompt template tab SHALL show the agent's instructions as plain text. If the agent builds its prompt at request time and has no static text, it SHALL say "This agent builds its prompt at request time, so there is no static template to show." For a user agent the tab SHALL show the assistant's prompt, then, under the label `Agent instructions`, the agent's own instructions (Live version, else draft), or `No instructions yet.` when they are empty. The Tools tab SHALL list each tool alphabetically with its name, description and the names of its input parameters. An agent with no tools SHALL show "This agent runs in a single step with no tools." A user agent lists the assistant's tools (R49).
- R7. The Memory tab SHALL show, for an agent with memory: "Recent messages replayed" (`<N> messages`, "Disabled" or "Default"), "Semantic recall", "Working memory" and "Auto-generated titles" (each "Enabled" or "Disabled"), and "Storage" when known. An agent with no memory SHALL show "This agent is stateless — no memory is configured." For the assistant: 40 messages replayed, semantic recall off, titles off. The Model tab SHALL show the model identifier and provider the agent currently resolves to; with none resolved it SHALL say "No model resolved — save an LLM configuration in Settings first." (see [../llm-settings/spec.md](../llm-settings/spec.md)). For a user agent both tabs describe the assistant (R49).
- R8. Requesting an agent that does not exist SHALL fail with `Agent "<key>" not found` (HTTP 404), shown in the detail view.
- R9. The system SHALL tolerate an agent whose prompt, tools, memory or model cannot be read: that facet is simply empty, the rest still loads.

Question sets
- R10. Only the assistant SHALL have eval sets. Every other agent's Evals tab SHALL show "No evals configured for this agent yet."
- R11. The system SHALL provide three sets, each bound to one sample fixture and containing 10 questions: `world-cup` ("World Cup", PostgreSQL), `world-cup-rest` ("World Cup (REST API)", the same questions against the REST sample, case ids prefixed `rest-`) and `formula-1` ("Formula 1", PostgreSQL, 1950 to 2026). The question lists are in *Eval suite content* below. Case ids SHALL be unique across all sets.
- R12. Each set SHALL carry a name, a description of what it covers and what it needs to run, and its cases. Each case SHALL carry an id, the question, an intent (what it probes) and its checks (id, name and description).
- R13. The Evals tab SHALL open on the list of sets, each showing its name, "<N> questions" and its description, with no question shown and no run button. Clicking a set SHALL open it (revealing its questions, the datasource picker and the run button) and tick all of its questions; clicking the open set again SHALL close it and clear the ticks. Sets SHALL be unselectable while a run is starting or running.
- R14. An open set SHALL show "<N> questions in <set name>. Each check must score 1.0 for its question to pass.", then the datasource picker, the run button, a **Select all** checkbox and the numbered question list.
- R15. Each question row SHALL show a tick box (labelled "Run: <question>"), the number, the question text, its intent and a chip per check showing the check's description. Clicking the row (not the tick box) SHALL select it for the Details panel and highlight it.
- R16. Select all SHALL tick every question of the open set when not all are ticked, and untick every question when all are ticked. Ticks, Select all and sets SHALL be disabled while a run is starting or running.

Starting a run
- R17. The datasource picker SHALL list every configured datasource as "<name> · <kind label>" (for example "World Cup PostgreSQL · PostgreSQL"), defaulting to the first. With none it SHALL show "No datasources configured" and the run button SHALL be disabled.
- R18. The run button SHALL read "Run <N> selected" with N the number of ticked questions, and SHALL be disabled when N is 0, no datasource exists, or a run is starting or running. While starting or running it SHALL read "Running…" with a spinner.
- R19. Starting a run SHALL send the chosen datasource and the ids of the ticked questions. The system SHALL validate, in this order, and refuse without starting (the message appears in a red box under the run controls, and no run is recorded):
  1. the agent has evals, else `Agent "<key>" has no evals to run`;
  2. no run is already going for this agent, else `An eval run is already in progress for this agent`;
  3. a datasource was chosen, else `Pick a datasource to run against`;
  4. the datasource has at least one dataset, else `That datasource has no datasets — create one in Datasets before running evals`;
  5. at least one known question was ticked, else `Pick at least one question to run`;
  6. all ticked questions belong to one sample, else `The selected questions span several samples (<ids>) — run one sample at a time.`; a set whose sample is not in the fixture registry fails with `Unknown sample fixture "<id>" — …`;
  7. the datasets bound to the datasource cover the sample (R20).
- R20. The dataset preflight SHALL require that: the datasets belong to exactly one datasource of the sample's kind (PostgreSQL or REST API), and together contain every required entity of the sample (matched on the last two name parts, schema and table, case-insensitively, so a same-named table in another schema does not count). On failure the message SHALL read "These evals require the bundled <sample name> sample: <description> Select its <PostgreSQL|REST API> datasource and save a dataset containing the <schema> tables and views. Setup: <setup hint>." followed by "Selected datasets: <names>. Missing entities: <entity list>." or "The selected datasets must belong to one <kind> datasource." No model tokens SHALL be spent when preflight fails.
- R21. All datasets bound to the chosen datasource SHALL be in scope for the run; the run record and the UI SHALL show "Scoped to <dataset names>".
- R22. A successful start SHALL record a run with status `running`, the question ids, and the total, and answer with the run's job id.

Running and progress
- R23. A run SHALL execute the questions one at a time, in set order, never in parallel, against the datasets in scope.
- R24. Each question SHALL run the assistant exactly as a chat turn would: scoped to the datasets, with the same orientation block (entities and join hints), the same curated knowledge block ([../knowledge/spec.md](../knowledge/spec.md)) and the same 15-step budget, in a throwaway session so that visual tools work. The throwaway session SHALL be deleted when the run ends, success or failure.
- R25. The system SHALL record each question's result as soon as it finishes and SHALL persist the run after every question, so a crash mid-suite keeps the finished questions.
- R26. While running, the UI SHALL poll the run every 1.5 seconds and show "<finished>/<questions in the open set> done · <passed> passed", mark the current question "running", and mark finished questions "passed" or "failed" with each check's score beside its chip. A failed question SHALL also show its run error, if any.
- R27. A run SHALL end `completed` when every ticked question has a result (including failed ones), or `failed` with an error message if the run itself broke. Either way it SHALL get a finish time.
- R28. At most one run SHALL be active per agent. Leaving the agent view SHALL stop the UI polling, not the run.

Scoring
- R29. A question SHALL pass only if it has at least one check and every check scores exactly 1. A question whose run threw an error SHALL fail with no check results and the error text. Per-check results SHALL carry the check's id, description, score, verdict and, on failure, a reason in plain words, for example `expected "Argentina" in the answer — answer was "…"` or `expected "run_readonly_sql" to be called 1×, it was called 0×`.
- R30. The system SHALL offer these kinds of check, combined per question:
  - answer text includes or matches a value;
  - a named tool was or was not called, or tools were called in a given order;
  - no tool call returned an error;
  - **result-set match** (id `result-set-match`, "Result set matches expectedSql (primary correctness signal)"), for questions with a reference query;
  - **LLM judge** (id `llm-judge`, "LLM judge: <rubric>"), for questions whose quality a text match is too brittle to judge.
- R31. The result-set match SHALL run the reference query read-only on the datasource (at most 500 rows; a truncated reference fails the check) and compare it with every successful, complete, untruncated `run_readonly_sql` result the assistant produced. It SHALL pass if any single result matches all reference facts. Comparison SHALL ignore column names, column order and row order, normalise numbers to six significant digits and text to trimmed, case-folded form, and tolerate extra columns in the assistant's result but not missing ones; results from different queries SHALL NOT be combined and extra rows SHALL NOT be ignored. A question can ask for distinct facts only, in which case repeated identical rows are harmless. With no successful query the check fails: "the agent ran no successful run_readonly_sql to compare".
- R32. The LLM judge SHALL be given the question, the rubric, the ordered tool calls (name, input, output, error) and the final answer, and SHALL return a pass or fail with a one- or two-sentence reason. It SHALL run on the same configured model as the assistant, one step, no tools. A judge that errors or returns unparseable output SHALL score 0 with a reason beginning `judge error:` rather than aborting the run. It SHALL pass only when the rubric is clearly satisfied.
- R33. Tool inputs and outputs recorded in a trace SHALL be truncated to 2,000 characters each, marked "… (truncated)". If a tool-only turn produced no prose, the reported answer SHALL be synthesised from what the tools returned.

Executions, details and report
- R34. The **Executions** sub-tab SHALL list past and in-flight runs of the agent, newest first, loaded when the sub-tab opens ("Loading executions…"; empty: "No eval runs yet — run the suite from the Questions tab."). The sub-tabs SHALL be shown whenever the agent has sets (or the Executions tab is open).
- R35. Each execution SHALL show a status icon (spinner while running, green check when all questions passed, red cross otherwise), "<passed>/<total> passed", the start time, the datasource name and the duration ("—" until finished; milliseconds under a second, else whole seconds). Expanding it SHALL show "Scoped to <datasets>" and one row per finished question with its verdict and duration; clicking a row SHALL open that question's result in the Details panel.
- R36. Each execution SHALL offer a download button (**Download as Markdown**) and, once it is no longer running, a delete button. Deleting a run that is still going SHALL be refused ("Cannot delete a run that is still going"); deleting a finished one SHALL remove it permanently ("Run deleted"). Download success SHALL show the toast "Eval report downloaded"; failure "Could not download the report" (or the backend's message).
- R37. The Details panel SHALL show, for the selected question: the question and its intent. When it has not been run: "Checks it will be scored on" (the check descriptions) and "Run the evals to see the steps the agent executed for this question." When it has a result: the verdict (Passed or Failed) and duration; "Run error" or "Why it failed" (each failed check with its reason); every check with its score; "Executed steps" (each tool call in order, numbered, with its input and output or error, or "The agent answered without calling any tool."); and the final "Answer" (or "The agent returned no text."). Selecting a question SHALL open the Details panel if it is closed (app-shell R10). With nothing selected it SHALL say "Select a question in the Evals tab to see how it ran." Selection SHALL clear when the agent changes or the view closes, and SHALL follow the newest result while a run is in progress.
- R38. The Markdown report of a run SHALL contain, in order: `# Eval run — <agent key>`; "**<passed>/<total> questions passed**"; a list of started, finished, duration, status, datasource name, datasets and run id; a "Run error" quote when the run failed; `## Summary` (a table of number, question, result, duration); `## Compared to previous run` (R40) when there is a comparison; `## Failures at a glance` when anything failed (each failed question with its failed-check reasons or run error); and `## Questions`, one section per finished question with result, id, duration, a checks table (check, score, why), `#### Executed steps` (each tool call with input and output or error in fenced blocks) and `#### Answer`. Fences inside payloads SHALL be neutralised. The server SHALL name the file `eval-run-<agent>-<start date and time>-<8-character run id>.md` and send it as a Markdown attachment.
- R39. Downloading a run that does not exist SHALL fail with `Eval run "<id>" not found` (HTTP 404); polling one SHALL answer with ok false and the same message.

Regression comparison
- R40. When a run completes, the system SHALL compare its per-question verdicts with the most recent earlier completed run of the same agent, same datasource and same set of datasets (order ignored), matching by question id. It SHALL record the previous run's id and three lists, each of id and question: **regressions** (passed before, failing now), **improvements** (failed before, passing now) and **unchanged**. Questions present in only one of the two runs SHALL be skipped. With no comparable earlier run no comparison SHALL be recorded; runs saved before this feature have none. A failure while comparing SHALL NOT fail the run.
- R41. The report SHALL show the comparison as `## Compared to previous run` with "Compared to run `<previous id>`."; "No change from the previous run." when there are neither regressions nor improvements; otherwise "**Regressions** (passed before, now failing):" and/or "**Improvements** (failed before, now passing):", each item as `<id> — <question>`.

Other entry points
- R42. The same suite SHALL also be runnable without the UI from the command line against named datasets (progress per question, a final "<passed>/<total> questions passed" line, exit code 0 only when all pass), using the same preflight, scoring, throwaway session and knowledge block.

### Eval suite content

World Cup set (`world-cup`; the REST set repeats these ten with ids `rest-<id>`, differing only in the reference queries, written for the REST sample's dialect):

| id | Question | What must hold |
|---|---|---|
| `champion-2022` | Who won the 2022 World Cup? | answer includes "Argentina"; ran SQL; no tool errors; result-set match |
| `final-score-2018` | What was the score of the 2018 World Cup final? | matches 4-2 (any dash or colon); includes "France"; ran SQL; no tool errors; result-set match |
| `top-scorer-2022` | Who scored the most goals in the 2022 World Cup, and how many? | includes "Messi"; contains 4; ran SQL; no tool errors; result-set match |
| `shootouts` | Which knockout matches went to a penalty shootout, and who advanced? | includes "Croatia"; mentions Argentina; ran SQL; no tool errors; result-set match |
| `biggest-venue` | Which stadium hosted the best-attended match, and what was the attendance? | includes "Lusail"; matches 88,966 (any separator); ran SQL; no tool errors; result-set match on distinct facts |
| `schema-discovery` | What data do I have available to analyse? | called `list_entities`; includes "matches"; did not call `run_readonly_sql`; no tool errors |
| `ambiguous-best-team` | Which team performed best? | called `ask_clarification`; no SQL; no tool errors; judge: the answer is itself a clarifying question with 2 to 4 concrete options grounded in the data and states no figures as the answer |
| `possession-vs-result` | In the 2022 knockout rounds, did the team with more possession usually win? | ran SQL; mentions possession or %; no tool errors; judge: concludes no, backed by counts consistent with 2 won and 6 lost of 8 |
| `out-of-scope` | How many goals did Pelé score in the 1970 World Cup? | no tool errors; judge: says it cannot answer for 1970, states the data covers 2018 and/or 2022, invents no figure |
| `visual-request` | Chart the goals scored by each team in the 2022 knockout stage. | tools called in order `run_readonly_sql` then `create_visual`; called `create_visual`; no tool errors; judge: a visual tool succeeded and plausibly charts goals per team for the 2022 knockouts |

Formula 1 set (`formula-1`), ids all prefixed `f1-`:

| id | Question | What must hold |
|---|---|---|
| `f1-champion-2023` | Who won the 2023 Formula 1 drivers' championship, and how many points did they finish on? | includes "Verstappen"; contains 575; ran SQL; no tool errors; result-set match |
| `f1-british-gp-2023` | At which circuit was the 2023 British Grand Prix held, and how many laps did the race run to? | includes "Silverstone"; contains 52; ran SQL; no tool errors; result-set match |
| `f1-most-race-wins` | Which driver has won the most Grands Prix in Formula 1 history, and how many did they win? | includes "Hamilton"; contains 106; ran SQL; no tool errors; result-set match |
| `f1-most-titles-tie` | Which drivers have won the most Formula 1 drivers' championships, and how many each? | includes "Schumacher"; mentions Hamilton; ran SQL; no tool errors; result-set match |
| `f1-monaco-2024-podium` | Who finished on the podium at the 2024 Monaco Grand Prix? | includes "Leclerc"; mentions Piastri; ran SQL; no tool errors; result-set match |
| `f1-schema-discovery` | What Formula 1 data do I have available to analyse? | called `list_entities`; includes "driver"; no SQL; no tool errors |
| `f1-ambiguous-dominant-driver` | Which driver was the most dominant? | called `ask_clarification`; no SQL; no tool errors; judge as for `ambiguous-best-team`, over race wins, championships, poles, points, and a season or era |
| `f1-pole-to-win-2023` | In the 2023 season, did the driver who started on pole usually go on to win the race? | ran SQL; mentions pole or grid; no tool errors; judge: concludes yes, backed by counts consistent with 14 of 22 |
| `f1-out-of-scope-motogp` | Who won the 2023 MotoGP world championship? | no tool errors; judge: says it cannot answer, states the data is Formula 1 only (1950 to 2026), names no MotoGP champion |
| `f1-visual-request` | Chart the total points scored by each constructor in the 2023 season. | tools in order `run_readonly_sql` then `create_visual`; called `create_visual`; no tool errors; judge: a visual tool succeeded and plausibly charts constructor points for 2023 |

User agents (definitions)
- R43. A user agent SHALL be a stored configuration of the assistant with: a `name` (required, trimmed, at most 64 characters, unique among user agents ignoring case), a `description` (at most 280), `instructions` (at most 4,000), `datasets` (dataset names, de-duplicated), `starterQuestions` (at most 5, each at most 200; blanks dropped, de-duplicated) and an optional `model` (a model or deployment name of the configured provider) and optional `reasoningEffort`. Over-long text SHALL be clipped to the limit.
- R44. Every user agent SHALL have a **draft**. Publishing SHALL copy the draft to the **Live** version and record when. The status SHALL be `live` when a Live version exists, else `draft`. An agent has **unpublished changes** when it is Live and its draft differs from its Live version. Saving a draft SHALL NOT change the Live version.
- R45. Publishing SHALL require a name and at least one dataset, else `Select at least one dataset to publish`. Creating a draft SHALL require only a name, else `Agent name is required`. A name already used by another user agent SHALL be refused with `An agent named "<name>" already exists`.
- R46. Built-in agents SHALL NOT be created, edited, published or deleted through these operations: `Built-in agents can't be edited` and `Built-in agents can't be deleted`.
- R47. Any agent, built-in or user-built, SHALL be pinnable and unpinnable. A user agent's pin SHALL be stored with it and a built-in agent's pin in the app settings, so pins survive a restart.
- R48. The agent catalogue SHALL list built-in and user agents together. Each entry SHALL carry its kind (`official` for the assistant, `system` for the five helpers, `user`), status (`builtin`, `draft` or `live`), pinned flag, owner (`Official`, `System` or `You`), whether it has unpublished changes, its datasets and starter questions, and `missingDatasets`: the dataset names in its effective configuration (Live version, else draft) that no longer exist.
- R49. Requesting one agent SHALL resolve the key as a built-in agent first, then as a user-agent id. A user agent's detail SHALL report the assistant's tools, memory and resolved model, because it runs on the assistant, together with its draft and its Live version.
- R50. Deleting a user agent SHALL remove only its definition. Sessions that reference it SHALL keep their transcript (their behaviour is in [../sessions-chat/spec.md](../sessions-chat/spec.md)).
- R51. Saving a draft, publishing, deleting or pinning an agent that does not exist SHALL fail with `Agent "<id>" not found` (an `ok: false` answer); requesting the detail of one SHALL fail with HTTP 404 as in R8.
- R52. User agents SHALL persist across restarts of the backend.
- R53. **Start chat** SHALL be offered for the Official agent and for Live user agents, on the hub card and in the detail view, and never for draft-only or System agents. On a Live user agent it SHALL create and open a session bound to the agent; on the Official agent it SHALL open the new-session screen. How such a session is created and runs is in [../sessions-chat/spec.md](../sessions-chat/spec.md) (R52-R59). When none of a Live agent's datasets exist, **Start chat** SHALL be disabled with the title `None of this agent's datasets exist`. While the session is being created the button SHALL be disabled; a refusal SHALL show the backend's message, or "Backend unreachable", as an error toast.

### Agent editor

- R54. **New agent** on the hub and **Edit** in a user agent's detail SHALL open the **agent editor**, a full page in the Agents area. New agent opens it empty with the title `New agent`; Edit opens it on the agent's draft with the title `Edit <name>`. Built-in agents SHALL have no editor (R46).
- R55. The editor SHALL hold these fields, which enforce the R43 limits as the user types:
  - **Name** (required, at most 64 characters);
  - **Description** (at most 280);
  - **Instructions** (multi-line, at most 4,000), with the hint `Added to the assistant's context in every turn. The assistant's own rules and the read-only guard still apply.`;
  - **Datasets**: one checkbox per existing dataset, by name. A dataset in the draft that no longer exists SHALL stay listed, ticked, as `<name> (missing)`, so the user can untick it. With no datasets at all: `No datasets yet — create one in Datasets first.`;
  - **Starter questions**: up to 5 single-line fields of at most 200 characters, each with a **Remove starter question** button, and **Add starter question**, disabled at 5;
  - **Model**: free text, a model or deployment name of the configured provider, with the placeholder `Default (<configured model>)`, or `Default` when no LLM is configured;
  - **Reasoning effort**: `Default`, `Low`, `Medium` or `High`.
- R56. **Save** SHALL store the form as the draft, creating the agent on its first save (R45), and show the backend's message as a toast (`Agent "<name>" saved as draft`, then `Draft saved`). A refusal (`Agent name is required`, `An agent named "<name>" already exists`) SHALL show as an error toast and change nothing. Save SHALL be disabled while the name is blank, while nothing changed since the last save, or while a save is in flight.
- R57. **Publish** SHALL first save the form when it has changes (R56; a refusal stops it), then publish the draft (R44, R45) and show `Agent "<name>" is Live` or the refusal, such as `Select at least one dataset to publish`. It SHALL be shown while the agent is new, has no Live version, has unpublished changes, or the form has changes.
- R58. The editor's header SHALL show the agent's `Draft` or `Live` chip and, when it applies, `Unpublished changes`, updated after every save and publish. Editing a Live agent SHALL change only its draft: its sessions keep the Live version until the draft is published (R44; sessions-chat R54).
- R59. **Back** SHALL return to the agent's detail view, or to the hub for an agent that was never saved. Leaving the editor in any way (Back, the rail, the drawer) with unsaved changes SHALL first ask `Discard unsaved changes?`. Cancelling SHALL keep the editor open with its changes.
- R60. **Preview** SHALL open the **preview chat** in the right Details panel, beside the form (app-shell R10). While the editor is open, the Details panel SHALL always hold the preview chat, however it is opened. The preview SHALL behave like a session started from the agent (sessions-chat R54, R55, R58), titled `Preview`, except that it runs the saved **draft**:
  - sending a preview message SHALL first save the form when it has changes (R56; a refusal stops the send), so the preview always runs what Save stored;
  - each preview turn SHALL use the draft's current instructions, model and effort overrides, and those of its datasets that exist;
  - with no existing dataset in the draft, the panel SHALL say `Select at least one dataset to preview` and the composer SHALL be disabled.
- R61. A preview conversation SHALL NOT be listed with the sessions or stored in the sessions collection. **Reset preview** SHALL discard it and start an empty one. Leaving the editor, or closing the Details panel, SHALL discard it together with its agent memory and workspace files. Preview conversations left behind when the app stopped SHALL be discarded at the next backend start.

## Edge cases and errors

- Pinning while the backend is unreachable: the card moves, then moves back, and the error toast reads "Backend unreachable".
- A search typed under the Pinned or Mine filter that matches nothing shows `No agents match "<query>"`, not the filter's empty message.
- Pinning an agent under All keeps it in its own section and moves it to the front of that section; unpinning puts it back in alphabetical order after the pinned cards.
- Deleting an agent that another window or the API already deleted shows the toast `Agent "<id>" not found` (R51) and stays on the detail; **All agents** returns to a hub without it.
- Publishing a Live agent with no unpublished changes is not offered (no **Publish** button).
- A Live agent with unpublished changes offers **Start chat**; the session uses the Live version, never the draft (sessions-chat R54).

- Starting with zero ticked questions is blocked in the UI (button disabled); a direct request with an explicit empty list is refused with "Pick at least one question to run" and SHALL NOT be read as "run everything". A request with no list at all selects every question of every set (and so fails R19.6 when the sets span several samples).
- A run started while another is active for the agent is refused with the conflict message; the UI shows it under the run controls.
- A dataset-less datasource: "has no datasets" message, no run recorded, Executions stays empty ("No eval runs yet").
- A dataset containing only part of the sample: "Missing entities: …" listing every required entity not found, no run recorded.
- Starting needs the sample's own datasource kind: the REST set against a PostgreSQL datasource fails with "The selected datasets must belong to one REST API datasource."
- Backend unreachable while starting or polling: the run box shows "Backend unreachable" and the UI state becomes failed or idle; the run, if it started, continues on the backend and later appears under Executions.
- A failed individual question (model error, tool crash) records a run error on that question and the run continues with the next.
- If the backend stops while a run is going, the run was persisted after its last finished question and stays marked `running` in history (see Open questions).
- A question present in an old run but no longer in the suite (the suite changed) is not clickable from the Executions list (no details to open).

## Contracts

- Agent definition endpoints `POST /agents`, `PUT /agents/:id/draft`, `POST /agents/:id/publish`, `DELETE /agents/:id`, `PUT /agents/:key/pin`, and the merged `GET /agents` / `GET /agents/:key`: [../../system/api.md](../../system/api.md) section 2.6.
- The `agents` collection (user agents) and the built-in pins document: [../../system/data-model.md](../../system/data-model.md) sections 3.10 and 3.2; decision ADR-0008 in [../../system/architecture.md](../../system/architecture.md).
- Endpoints `GET /agents`, `GET /agents/:key`, `GET /agents/:key/evals`, `POST /agents/:key/evals/run`, `GET /agents/:key/evals/runs`, `GET|DELETE /agents/:key/evals/runs/:jobId`, `GET /agents/:key/evals/runs/:jobId/download`: [../../system/api.md](../../system/api.md).
- Eval run documents (run, per-question result, check result, tool call, regression summary): [../../system/data-model.md](../../system/data-model.md).
- The six agents, the assistant's tools and memory settings, and the judge's prompt: [../../system/agents.md](../../system/agents.md).
- Sample fixtures and their required entities: [../testing-data/spec.md](../testing-data/spec.md).
- Terms: [../../product/glossary.md](../../product/glossary.md).

## UI

Main view "Agents" (the Agent Hub) and an agent's detail view, with the Details panel on the right ([../../system/ui.md](../../system/ui.md) sections 4.4 and 4.5, [../app-shell/spec.md](../app-shell/spec.md)). Agent Hub: loading, error, populated (Official, Mine and System sections, pinned cards first, Show more), the Pinned filter's single Pinned section, no match, empty Pinned filter, empty Mine filter. Hub cards and agent detail also carry **Start chat** (R53); a user agent's detail carries **Edit**. Agent editor (R54-R61): new and edit titles, the form, saving, publishing, the unsaved-changes confirmation, and the preview chat in the Details panel (empty, no-dataset, running, reset). Agent detail: loading, error, five tabs, and for user agents the Publish and Delete actions and the delete confirmation. Evals tab: loading ("Loading evals…"), error, no evals, set list, open set (idle, starting/running, finished), Executions (loading, empty, populated, expanded).

## Flows

E2E: `frontend/e2e/agents.spec.ts` for the Feature below (first moved from the repository `gherkin.md`; the System steps now open "Show more", R3).

```gherkin
Feature: Agents

  Scenario: Opens an agent from the Agents list and switches between its tabs
    When I click "Agents"
    Then I see "Questions to Insights Assistant" in the Official section
    When I click "Show more" in the System section
    Then I see the "sql-fixer" agent in the System section
    When I open the "Questions to Insights Assistant" agent
    Then I see the heading "Questions to Insights Assistant"
    And the Prompt tab is shown, containing "You are the Questions to Insights assistant"
    When I open the Tools tab
    Then I see "run_readonly_sql" and "ask_clarification"
    When I open the Memory tab
    Then I see "Recent messages replayed" and "40 messages"
    When I open the Model tab
    Then I see "Provider"
    When I open the Evals tab
    Then I see the "world-cup" set listed with "10 questions"
    And no individual question is shown
    And the run button is hidden
    When I open the "world-cup" set
    Then the "champion-2022" question shows "Who won the 2022 World Cup?"
    And it lists the check "Checks if output includes "Argentina""
    And 10 questions are listed
    When I click the open "world-cup" set again
    Then no questions are listed
    When I click "All agents"
    And I click "Show more" in the System section
    Then I see the "sql-verifier" agent in the System section

  Scenario: Shows the stateless, no-tool agents accurately
    When I click "Agents"
    And I click "Show more" in the System section
    And I open the "sql-fixer" agent
    And I open the Tools tab
    Then I see "This agent runs in a single step with no tools."
    When I open the Memory tab
    Then I see "This agent is stateless — no memory is configured."
    When I open the Evals tab
    Then I see "No evals configured for this agent yet."

  Scenario: Offers the configured datasources and starts a run from the evals tab
    Given a "World Cup PostgreSQL" datasource exists
    And a dataset containing the World Cup tables and views exists
    When I click "Agents"
    And I open the "Questions to Insights Assistant" agent
    And I open the Evals tab and the "world-cup" set
    Then the datasource picker offers "World Cup PostgreSQL" and "PostgreSQL"
    And the run button reads "Run 10 selected"
    When I click the run button
    Then the run button reads "Running…"
    And I see "0/10 done"

  Scenario: Runs only the ticked questions
    Given a "World Cup PostgreSQL" datasource exists
    And I am on the "world-cup" set in the agent's Evals tab
    Then the run button reads "Run 10 selected"
    When I untick the "champion-2022" question
    Then the run button reads "Run 9 selected"
    When I click select-all
    Then the run button reads "Run 10 selected"
    When I click select-all again
    Then the run button reads "Run 0 selected"
    And the run button is disabled
    When I tick the "shootouts" question
    Then the run button reads "Run 1 selected"
    And the run button is enabled

  Scenario: Refuses to run against a datasource with no datasets
    Given a "World Cup PostgreSQL" datasource exists with no datasets
    And I am on the "world-cup" set in the agent's Evals tab
    When I click the run button
    Then I see a message saying the datasource "has no datasets"

  Scenario: Explains an incomplete eval dataset without starting a run
    Given a "World Cup PostgreSQL" datasource exists
    And a dataset containing only the "matches" table exists
    And I am on the "world-cup" set in the agent's Evals tab
    When I click the run button
    Then I see "Missing entities: world_cup.tournaments"
    When I open the executions sub-tab
    Then I see "No eval runs yet"

  Scenario: Opens a question in the right panel with what it is scored on
    Given I am on the "world-cup" set in the agent's Evals tab
    And the Details panel is closed
    When I click the "champion-2022" question
    Then the Details panel opens and shows "Who won the 2022 World Cup?"
    And it shows "Single-hop lookup"
    And it shows "Checks if output includes "Argentina""
    And it shows "Run the evals to see the steps the agent executed"
    When I click the "ambiguous-best-team" question
    Then the Details panel shows "Which team performed best?"

  Scenario: Separates the question suite from past executions
    Given a "World Cup PostgreSQL" datasource exists
    And a dataset containing the World Cup tables and views exists
    And I am on the "world-cup" set in the agent's Evals tab
    Then the Questions sub-tab is shown with 10 questions
    When I open the executions sub-tab
    Then I see "No eval runs yet"
    And no questions are listed
    When I return to the Questions sub-tab and click the run button
    And I open the executions sub-tab
    Then the first execution shows "0/10 passed"
    When I return to the Questions sub-tab
    Then 10 questions are listed

  Scenario: Downloads an execution as a Markdown report
    Given a "World Cup PostgreSQL" datasource exists
    And a dataset containing the World Cup tables and views exists
    And I have started a run from the "world-cup" set
    When I open the executions sub-tab
    Then the first execution has a download button
    When I click the download button
    Then the download succeeds as a Markdown file named "eval-run-assistant-….md"
    And the report contains "# Eval run — assistant"
    And the report contains "## Summary"
    And the report contains "Who won the 2022 World Cup?"
```

E2E: `frontend/e2e/agent-hub.spec.ts`

The Background's dataset and user agents are seeded through the backend API before the hub opens. "The app restarts" restarts the backend on the same data directory (on the web target, the CLI).

```gherkin
Feature: Agent Hub

  Background:
    Given a "World Cup Core" dataset exists
    And a Live user agent "Health plan analyst", described as "Answers questions about the 2026 health plan", over "World Cup Core"
    And a draft user agent "Claims triage", described as "Sorts incoming claims by urgency", with no datasets

  Scenario: Shows the built-in agents and mine in sections
    When I click "Agents"
    Then I see the sections "Official", "Mine" and "System", in that order, and no "Pinned" section
    And the "New agent" button is enabled
    And the Official section shows "Questions to Insights Assistant" with "Owner: Official"
    And the Mine section shows "Health plan analyst" with "Owner: You" and the chip "Live"
    And the Mine section shows "Claims triage" with the chip "Draft"
    And the System section shows 3 cards and "Show more (2)"
    When I click "Show more (2)"
    Then the System section shows 5 cards, including "SQL Verifier"
    When I click "Show less"
    Then the System section shows 3 cards

  Scenario: Search narrows the agents by name or description
    When I click "Agents"
    And I type "urgency" into "Search agents by name or description"
    Then I see "Claims triage" and not "Health plan analyst"
    When I type "HEALTH PLAN" into "Search agents by name or description"
    Then I see "Health plan analyst" and not "Claims triage"
    When I type "nothing here" into "Search agents by name or description"
    Then I see 'No agents match "nothing here"'

  Scenario: Filters limit the hub to one kind of agent
    When I click "Agents"
    And I click the "Mine" filter
    Then I see only "Claims triage" and "Health plan analyst"
    When I click the "Official" filter
    Then I see only "Questions to Insights Assistant"
    When I click the "Pinned" filter
    Then I see "No pinned agents yet."
    When I click the "All" filter
    Then I see the System section again

  Scenario: Pinned agents come first in their own section and survive a restart
    When I click "Agents"
    And I click "Pin Health plan analyst"
    And I click "Pin Questions to Insights Assistant"
    Then the Official section shows "Questions to Insights Assistant" first, reading "Pinned"
    And the Mine section shows "Health plan analyst" first, reading "Pinned"
    And there is no "Pinned" section
    When I click the "Pinned" filter
    Then the Pinned section shows "Questions to Insights Assistant" and "Health plan analyst"
    When the app restarts
    And I click "Agents"
    And I click the "Pinned" filter
    Then the Pinned section still shows "Questions to Insights Assistant" and "Health plan analyst"
    When I click "Unpin Health plan analyst"
    Then the Pinned section shows only "Questions to Insights Assistant"
    When I click the "All" filter
    Then the Mine section shows "Health plan analyst" reading "Pin"

  Scenario: Flags an agent whose dataset no longer exists
    Given the draft of "Claims triage" uses the dataset "Gone"
    When I click "Agents"
    Then the "Claims triage" card shows "Missing dataset: Gone"
    And the "Health plan analyst" card shows no missing-dataset note

  Scenario: A card opens the agent's detail view with its actions
    When I click "Agents"
    And I open "Claims triage"
    Then I see the heading "Claims triage"
    And I see the buttons "Edit", "Publish" and "Delete" and no "Start chat" button
    When I click "All agents"
    And I open "Health plan analyst"
    Then I see the buttons "Start chat", "Edit" and "Delete" and no "Publish" button
    When I click "All agents"
    And I open "Questions to Insights Assistant"
    Then I see the button "Start chat" and none of "Edit", "Publish" or "Delete"

  Scenario: Publishing a draft makes it Live
    When I click "Agents"
    And I open "Claims triage" and click "Publish"
    Then I see the toast "Select at least one dataset to publish"
    Given the draft of "Claims triage" uses the dataset "World Cup Core"
    When I click "All agents"
    And I open "Claims triage" and click "Publish"
    Then I see the toast 'Agent "Claims triage" is Live'
    And the "Publish" button is gone
    When I click "All agents"
    Then the Mine section shows "Claims triage" with the chip "Live"

  Scenario: Deleting an agent asks first
    When I click "Agents"
    And I open "Claims triage" and click "Delete"
    Then I am asked 'Delete "Claims triage"?'
    When I cancel
    Then I still see the heading "Claims triage"
    When I click "Delete" and confirm
    Then I see the toast 'Agent "Claims triage" deleted'
    And I am back on the Agent Hub, which no longer lists "Claims triage"

  Scenario: The hub has no detectable accessibility violations in either theme
    When I click "Agents"
    And I click "Show more (2)"
    Then the axe scan reports no violations in the Light theme
    And the axe scan reports no violations in the Dark theme
```

E2E: none yet for the Feature below.

```gherkin
Feature: Agents and evals behaviour not yet covered by Playwright

  Scenario: Shows a finished question's verdict, checks and executed steps
    Given a run has finished
    When I click the "champion-2022" question
    Then the Details panel shows "Passed" or "Failed" with the duration
    And lists every check with its score
    And lists the executed steps in order, for example "run_readonly_sql"
    And shows the final "Answer"

  Scenario: Explains why a question failed
    Given a run finished with a failed question
    When I click that question
    Then I see "Why it failed" with each failed check and its reason

  Scenario: Does not start a second run for the same agent
    Given a run is in progress
    When another run is requested for the same agent
    Then I see "An eval run is already in progress for this agent"

  Scenario: Deletes a finished execution
    Given a finished execution exists
    When I click its delete button
    Then it disappears from the Executions list
    And a running execution has no delete button

  Scenario: Compares a run with the previous comparable run
    Given two completed runs of the same suite on the same datasource and datasets
    And a question passed in the first and failed in the second
    When I download the second run's report
    Then it has the section "Compared to previous run"
    And lists that question under "Regressions (passed before, now failing)"

  Scenario: Runs the Formula 1 set against its own datasource
    Given a Formula 1 PostgreSQL datasource with a dataset containing the formula1 tables and views
    When I open the "formula-1" set and click the run button
    Then the run starts and shows "0/10 done"

  Scenario: Refuses a REST set on a PostgreSQL datasource
    Given only a PostgreSQL datasource with the World Cup dataset exists
    When I open the "world-cup-rest" set and click the run button
    Then I see "The selected datasets must belong to one REST API datasource."

  Scenario: Shows the model an agent resolves to
    Given an LLM configuration is saved
    When I open an agent's Model tab
    Then I see its model identifier and provider

  Scenario: Reports an unknown agent
    When I open an agent that no longer exists
    Then I see 'Agent "<key>" not found'
```

### Feature: Agent editor

E2E: `frontend/e2e/agent-editor.spec.ts`

The model is the recording LLM stub described under the Feature "Sessions started from an agent" in [../sessions-chat/spec.md](../sessions-chat/spec.md).

```gherkin
Feature: Agent editor

  Background:
    Given a "World Cup Core" dataset exists
    And the model is the recording stub

  Scenario: Creates an agent, previews it, publishes it and deletes it
    When I click "Agents"
    And I click "New agent"
    Then I see the heading "New agent"
    And "Save" is disabled
    When I type "Cup historian" into "Name"
    And I type "Always name the tournament year." into "Instructions"
    And I tick "World Cup Core"
    And I add the starter question "Who won in 2014?"
    And I click "Save"
    Then I see the toast 'Agent "Cup historian" saved as draft'
    And the editor shows the chip "Draft"
    When I click "Preview"
    Then the Details panel shows "Preview" and the starter question "Who won in 2014?"
    When I send "Who won in 2014?" in the preview
    Then I see the stub's answer in the preview
    And the model received "Always name the tournament year." as the agent's instructions
    And "Cup historian" is not listed in "Sessions navigation"
    When I click "Publish"
    Then I see the toast 'Agent "Cup historian" is Live'
    And the editor shows the chip "Live"
    When I click "Back"
    Then I see the agent's detail view with the heading "Cup historian"
    When I click "Delete" and confirm
    Then I am back on the Agent Hub, which no longer lists "Cup historian"

  Scenario: Editing a Live agent keeps its sessions on the Live version until republished
    Given a Live user agent "Cup historian" over "World Cup Core" with the instructions "Answer in one sentence."
    And I started a chat with "Cup historian"
    When I open "Cup historian" from "Agents" and click "Edit"
    Then I see the heading "Edit Cup historian"
    When I replace the instructions with "Talk like a pirate."
    And I click "Save"
    Then the editor shows the chips "Live" and "Unpublished changes"
    When I open the "Cup historian" session and send "Who won in 2014?"
    Then the model received "Answer in one sentence." and not "Talk like a pirate."
    When I open "Cup historian" from "Agents", click "Edit" and click "Publish"
    Then the editor shows "Live" without "Unpublished changes"
    When I open the "Cup historian" session and send "And in 2010?"
    Then the model received "Talk like a pirate."

  Scenario: Sending in the preview saves the form first
    Given a draft user agent "Cup historian" over "World Cup Core" with the instructions "Answer in one sentence."
    When I open "Cup historian" from "Agents" and click "Edit"
    And I click "Preview"
    And I replace the instructions with "Talk like a pirate."
    And I send "Who won in 2014?" in the preview
    Then I see the toast "Draft saved"
    And the model received "Talk like a pirate."

  Scenario: Reset and leaving the editor discard the preview
    Given a draft user agent "Cup historian" over "World Cup Core"
    When I open "Cup historian" from "Agents" and click "Edit"
    And I click "Preview" and send "Who won in 2014?" in the preview
    And I click "Reset preview"
    Then the preview shows no messages
    When I send "And in 2010?" in the preview
    And I click "Back"
    Then the preview's memory and workspace are gone
    And no session was created

  Scenario: Preview needs a dataset, and names must be unique
    Given a Live user agent "Health plan analyst" over "World Cup Core"
    When I click "Agents" and click "New agent"
    And I type "Cup historian" into "Name"
    And I click "Preview"
    Then the preview says "Select at least one dataset to preview"
    When I replace the name with "Health plan analyst"
    And I click "Save"
    Then I see the toast 'An agent named "Health plan analyst" already exists'

  Scenario: Leaving with unsaved changes asks first
    When I click "Agents" and click "New agent"
    And I type "Cup historian" into "Name"
    And I click "Back" and dismiss the confirmation "Discard unsaved changes?"
    Then I still see the heading "New agent"
    When I click "Back" and confirm
    Then I am back on the Agent Hub, which does not list "Cup historian"

  Scenario: A dataset that no longer exists stays visible in the editor
    Given a draft user agent "Cup historian" over "World Cup Core" and "Gone"
    When I open "Cup historian" from "Agents" and click "Edit"
    Then "World Cup Core" and "Gone (missing)" are ticked
    When I untick "Gone (missing)" and click "Save"
    Then the "Cup historian" card no longer shows a missing-dataset note

  Scenario: The editor has no detectable accessibility violations in either theme
    When I click "Agents" and click "New agent"
    And I click "Preview"
    Then the axe scan reports no violations in the Light theme
    And the axe scan reports no violations in the Dark theme
```

E2E: none yet

The Feature below is API-level. It is covered by the backend e2e `backend/test/user-agents.e2e-spec.ts`, not by Playwright.

```gherkin
Feature: Agent definitions (API)

  Scenario: Creating an agent stores a draft
    When I create an agent named "Health plan analyst" with instructions and the "World Cup Core" dataset
    Then the agent is listed as "Draft", owner "You", not pinned

  Scenario: Publishing makes the draft Live
    Given a draft agent "Health plan analyst" with one dataset
    When I publish it
    Then it is listed as "Live" and its Live version equals the draft

  Scenario: Editing a Live agent keeps serving the Live version
    Given a Live agent "Health plan analyst"
    When I change its draft instructions
    Then the agent shows "Unpublished changes" and its Live version is unchanged
    When I publish it again
    Then the Live version carries the new instructions

  Scenario: Names must be unique and publishing needs a dataset
    Given a user agent named "Health plan analyst" exists
    When I create another agent named "health plan analyst"
    Then I see 'An agent named "health plan analyst" already exists'
    When I publish a draft with no datasets
    Then I see "Select at least one dataset to publish"

  Scenario: Pins apply to user and built-in agents and survive a restart
    When I pin the assistant and a user agent
    And the backend restarts
    Then both are still pinned

  Scenario: Built-in agents are read-only
    When I edit, publish or delete "sql-fixer"
    Then I see "Built-in agents can't be edited" or "Built-in agents can't be deleted"

  Scenario: Deleting an agent
    When I delete "Health plan analyst"
    Then it is no longer listed
```

## Acceptance

- The nine `agents.spec.ts` scenarios pass, the nine `agent-hub.spec.ts` scenarios pass, and the eight `agent-editor.spec.ts` scenarios pass, with the axe scans of the hub and the editor clean in both themes.
- Running the `world-cup` set against the bundled sample with a working model finishes, records one result per ticked question, and every question's Details panel shows its checks and executed steps.
- A second completed run on the same datasource and datasets produces a Markdown report with a "Compared to previous run" section; a run on a different datasource or dataset set does not.
- Starting against a datasource with no datasets, or with datasets missing required entities, never spends model tokens and never leaves a run in history.
- The report downloaded from the Executions list opens as readable Markdown and contains the title, summary, per-question checks, executed steps and answers.

## Open questions

- A run interrupted by a backend stop stays `running` forever: nothing finalises it and the UI hides its delete button.
- The progress line shows "<finished>/<all questions in the open set> done", not the number of ticked questions. With 3 of 10 ticked it reads "0/10 done" although only 3 will run. The gherkin scenario for a full run is consistent with either; confirm the intended denominator.
- The comparison is recorded and appears in the Markdown report only; the Executions list and the Details panel do not show regressions or improvements. Confirm whether the UI should.
- The browser saves the report as `eval-run-<agent>-<8-char id>.md` (no date) while the server's attachment name includes the date and time. The gherkin file pattern "eval-run-assistant-…" matches both.
- A code comment says runs are in-memory and forgotten on restart; in fact they are persisted and survive restarts (R25). The spec follows the behaviour.
- A failed (not just partial) run or a partial pass is drawn with the same red cross in Executions.

<!-- sources: backend/src/modules/agents/{agents.controller,agents.service,eval-runs.service,eval-regression,eval-report}.ts, backend/src/modules/agents/repositories/eval-runs.repository.ts, backend/src/mastra/evals/{assistant.evals,assistant-eval-datasets,result-set-check,run-assistant-evals}.ts, backend/src/mastra/agents/eval-judge.agent.ts, backend/src/modules/sessions/result-compare.ts, backend/src/modules/testing-data/fixtures/registry.ts, frontend/src/app/features/agents/, frontend/e2e/agents.spec.ts, frontend/e2e/agent-hub.spec.ts -->

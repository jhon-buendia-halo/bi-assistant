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
- R1. The **Agents** screen SHALL be the Agent Hub. It SHALL show the heading "Agents"; a **New agent** button, which opens the agent editor for a new agent (R54); a search field with the placeholder `Search agents by name or description`; a group of filter pills labelled `Filter agents`: **All** (selected when the hub opens), **Pinned**, **Official** and **Mine**; and the agents as cards in sections. Under All the sections SHALL be, in this order, **Official** (`official`), **Mine** (`user`) and **System** (`system`), and each agent SHALL appear in the section of its kind, pinned or not; there is no Pinned section under All. A section with no agents SHALL be omitted, so Mine is omitted when there are no user agents. Within a section, pinned cards SHALL come first, then the others, each group alphabetical by name. In every view each agent SHALL appear exactly once. Each card SHALL show a sparkles icon, the name, a pin toggle (R4), the description clipped to two lines and the owner (`Owner: You`, `Owner: Official` or `Owner: System`). A user agent's card SHALL also show a status chip `Draft` or `Live`, the badge `Unpublished changes` when it has unpublished changes (R44), and the note `Missing dataset: <names>` (comma-separated) when its `missingDatasets` is not empty (R48). The card of each Official agent (the assistant and the RFP Builder, `rfp`) and the card of every Live user agent SHALL also show a **Start chat** button with the accessible name `Start chat with <name>` (R53). Cards SHALL NOT show tools or the id.
- R2. Search SHALL match the trimmed query, case-insensitively, as a substring of the agent's name or description, and SHALL apply as the user types. The filters SHALL show: All, the sections of R1; Pinned, a single **Pinned** section holding every pinned agent of any kind, ordered by kind (Official, Mine, System) and then by name; Official, only the Official agents (the assistant and the RFP Builder), in the Official section; Mine, only user agents, pinned or not, in the Mine section (pinned first, R1). The System section SHALL show only under All. Search and filter combine. States: while loading, "Loading agents…"; on failure, the backend's message or "Backend unreachable"; a non-empty query that matches nothing, `No agents match "<query>"`; otherwise the Pinned filter with nothing pinned shows `No pinned agents yet.` and the Mine filter with no user agents shows `No agents of yours yet.`. Under All with no user agents, the Mine section is omitted.
- R3. Each section SHALL show its first row of 3 cards. When more of its agents match the search and filter, a `Show more (<n>)` control SHALL follow, where n is the number of hidden cards. Clicking it SHALL show every card of the section and turn the control into `Show less`, which collapses the section to its first row again. Each section expands on its own. The search text, the filter and the expanded sections SHALL reset each time the hub opens, including on return from a detail view.
- R4. Each card's pin toggle SHALL read `Pin`, with the accessible name `Pin <name>`, or `Pinned`, with the accessible name `Unpin <name>`, and SHALL expose its pressed state. Clicking it, or a card's **Start chat**, SHALL NOT open the agent. The change SHALL show on the hub at once: the toggle flips and the card re-orders within its own section (pinned cards first, R1). It SHALL NOT move the card to another section or hide a section. Under the Pinned filter, unpinning removes the card from the Pinned section. The change is then saved (R47), so it survives a restart. If saving fails, the card SHALL return to its previous state and an error toast SHALL show the backend's message or "Backend unreachable". A successful pin or unpin raises no toast.
- R5. Clicking a card anywhere but its pin toggle or its **Start chat** SHALL open the agent's detail view. The view SHALL show an **All agents** back button to the hub, the name as heading, the id, the description and, for a user agent, its `Draft` or `Live` chip and `Unpublished changes` badge; then these tabs, in this order: **Chat Box** (not for System agents), **System Prompt**, **Skills (N)**, **Tools (N)**, **Graph** (user agents only), **Memory**, **Evals** and **LLM Config**. The first tab shown is Chat Box for a user agent and for an Official agent, and System Prompt for a System agent (R90, R91). Opening a different agent SHALL reset all tab, selection and run state. A Live user agent's detail and each Official agent's detail SHALL offer **Start chat** (R53). A user agent's detail SHALL also offer **Edit**, which opens the agent editor on its draft (R54), and two more actions:
  - **Publish**, shown only when the agent has no Live version or has unpublished changes. It publishes the draft (R44, R45) and shows the backend's message as a toast: `Agent "<name>" is Live`, or the refusal, such as `Select at least one dataset to publish`. On success the detail reloads, so the button disappears and the chip reads `Live`.
  - **Delete**, which first asks `Delete "<name>"?` with the explanation `Its sessions keep their transcripts and continue with the assistant.`. Cancelling changes nothing. Confirming deletes the agent (R50), shows the toast `Agent "<name>" deleted` and returns to the hub, which no longer lists it. A failure shows the backend's message as a toast and stays on the detail.

  Built-in agents (Official and System) SHALL offer neither Edit, Publish nor Delete. System agents SHALL NOT offer Start chat.
- R6. The System Prompt tab SHALL show the agent's instructions as plain text. For a built-in agent it SHALL show the prompt as served, an override included, and offer the edit of R97-R105. If the agent builds its prompt at request time and has no static text, it SHALL say "This agent builds its prompt at request time, so there is no static template to show." For a user agent the tab SHALL show the assistant's prompt, then, under the label `Agent instructions`, the agent's own instructions (Live version, else draft) with each link shown as a read-only chip (R86), or `No instructions yet.` when they are empty; the user agent's owner can edit them in place (R92-R94). The Tools tab SHALL list each tool alphabetically with its name, description and the names of its input parameters; for a user agent it SHALL be the tool library of R87. An agent with no tools SHALL show "This agent runs in a single step with no tools." A user agent lists the assistant's tools (R49).
- R7. The Memory tab SHALL show, for an agent with memory: "Recent messages replayed" (`<N> messages`, "Disabled" or "Default"), "Semantic recall", "Working memory" and "Auto-generated titles" (each "Enabled" or "Disabled"), and "Storage" when known. An agent with no memory SHALL show "This agent is stateless — no memory is configured." For the assistant: 40 messages replayed, semantic recall off, titles off. The **LLM Config** tab SHALL show the agent's LLM settings (R89); with none resolved it SHALL say "No model resolved — save an LLM configuration in Settings first." (see [../llm-settings/spec.md](../llm-settings/spec.md)). For a user agent the Memory tab describes the assistant (R49).
- R8. Requesting an agent that does not exist SHALL fail with `Agent "<key>" not found` (HTTP 404), shown in the detail view.
- R9. The system SHALL tolerate an agent whose prompt, tools, memory or model cannot be read: that facet is simply empty, the rest still loads.

Question sets
- R10. Only the assistant and the RFP Builder (`rfp`) SHALL have eval sets; each set names the agent it runs on, and an agent's Evals tab lists only its own sets. Every other agent's Evals tab SHALL show "No evals configured for this agent yet."
- R11. The system SHALL provide four sets, each bound to one sample fixture: for the assistant, `world-cup` ("World Cup", PostgreSQL, 12 questions), `world-cup-rest` ("World Cup (REST API)", the same 12 questions against the REST sample, case ids prefixed `rest-`) and `formula-1` ("Formula 1", PostgreSQL, 1950 to 2026, 10 questions); for the RFP Builder, `rfp` ("RFP Builder", the `intellify-api` REST sample, 8 questions, listed in [agents.md](../../system/agents.md) 8.1). The RFP records an `rfp` run creates SHALL be deleted when the run ends. The question lists are in *Eval suite content* below. Case ids SHALL be unique across all sets.
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
- R28. At most one run SHALL be active per agent for each user (two users MAY each run the same agent's evals at once; R62). Leaving the agent view SHALL stop the UI polling, not the run.

Scoring
- R29. A question SHALL pass only if it has at least one check and every check scores exactly 1. A question whose run threw an error SHALL fail with no check results and the error text. Per-check results SHALL carry the check's id, description, score, verdict and, on failure, a reason in plain words, for example `expected "Argentina" in the answer — answer was "…"` or `expected "run_readonly_sql" to be called 1×, it was called 0×`.
- R30. The system SHALL offer these kinds of check, combined per question:
  - answer text includes or matches a value;
  - a named tool was or was not called, or tools were called in a given order;
  - no tool call returned an error;
  - **result-set match** (id `result-set-match`, "Result set matches expectedSql (primary correctness signal)"), for questions with a reference query;
  - **LLM judge** (id `llm-judge`, "LLM judge: <rubric>"), for questions whose quality a text match is too brittle to judge.
- R31. The result-set match SHALL run the reference query read-only on the datasource (at most 500 rows; a truncated reference fails the check) and compare it with every successful, complete, untruncated `run_readonly_sql` result the assistant produced. It SHALL pass if any single result contains every reference row, each in a row of its own. Comparison SHALL ignore column names, column order and row order, normalise numbers to six significant digits and text to trimmed, case-folded form, and tolerate extra columns and extra rows in the assistant's result but not missing values; results from different queries SHALL NOT be combined. A question can ask for distinct facts only, in which case several reference rows may be found in the same row. The answer-text checks, not this one, judge whether the answer states the right fact. With no successful query the check fails: "the agent ran no successful run_readonly_sql to compare".
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
| `schema-discovery` | What data do I have available to analyse? | includes "matches"; did not call `run_readonly_sql`; no tool errors |
| `ambiguous-best-team` | Which team performed best? | called `ask_clarification`; no SQL; no tool errors; judge: the answer is itself a clarifying question with 2 to 4 concrete options grounded in the data and states no figures as the answer |
| `possession-vs-result` | In the 2022 knockout rounds, did the team with more possession usually win? | ran SQL; mentions possession or %; no tool errors; judge: concludes no, backed by counts consistent with 2 won and 6 lost of 8 |
| `out-of-scope` | How many goals did Pelé score in the 1970 World Cup? | no tool errors; judge: says it cannot answer for 1970, states the data covers 2018 and/or 2022, invents no figure |
| `visual-request` | Chart the goals scored by each team in the 2022 knockout stage. | tools called in order `run_readonly_sql` then `create_visual`; called `create_visual`; no tool errors; judge: a visual tool succeeded and plausibly charts goals per team for the 2022 knockouts |
| `no-clarification-best-team` | Which team performed best? | run with the tools `sample_rows` and `visuals` (no `ask_clarification`); called `run_readonly_sql`; did not call `ask_clarification`; no tool errors; judge: the answer names the measure it took as "best" and gives figures for it |
| `no-visuals-chart-request` | Show me a chart of goals scored per World Cup tournament. | run with the tools `sample_rows` and `ask_clarification` (no `visuals`); called `run_readonly_sql`; did not call `create_visual`; no tool errors; judge: the answer says it can't draw a visual here and gives the goals per tournament (23 in 2018, 24 in 2022) |

Formula 1 set (`formula-1`), ids all prefixed `f1-`:

| id | Question | What must hold |
|---|---|---|
| `f1-champion-2023` | Who won the 2023 Formula 1 drivers' championship, and how many points did they finish on? | includes "Verstappen"; contains 575; ran SQL; no tool errors; result-set match |
| `f1-british-gp-2023` | At which circuit was the 2023 British Grand Prix held, and how many laps did the race run to? | includes "Silverstone"; contains 52; ran SQL; no tool errors; result-set match |
| `f1-most-race-wins` | Which driver has won the most Grands Prix in Formula 1 history, and how many did they win? | includes "Hamilton"; contains 106; ran SQL; no tool errors; result-set match |
| `f1-most-titles-tie` | Which drivers have won the most Formula 1 drivers' championships, and how many each? | includes "Schumacher"; mentions Hamilton; ran SQL; no tool errors; result-set match |
| `f1-monaco-2024-podium` | Who finished on the podium at the 2024 Monaco Grand Prix? | includes "Leclerc"; mentions Piastri; ran SQL; no tool errors; result-set match |
| `f1-schema-discovery` | What Formula 1 data do I have available to analyse? | includes "driver"; no SQL; no tool errors |
| `f1-ambiguous-dominant-driver` | Which driver was the most dominant? | called `ask_clarification`; no SQL; no tool errors; judge as for `ambiguous-best-team`, over race wins, championships, poles, points, and a season or era |
| `f1-pole-to-win-2023` | In the 2023 season, did the driver who started on pole usually go on to win the race? | ran SQL; mentions pole or grid; no tool errors; judge: concludes yes, backed by counts consistent with 14 of 22 |
| `f1-out-of-scope-motogp` | Who won the 2023 MotoGP world championship? | no tool errors; judge: says it cannot answer, states the data is Formula 1 only (1950 to 2026), names no MotoGP champion |
| `f1-visual-request` | Chart the total points scored by each constructor in the 2023 season. | tools in order `run_readonly_sql` then `create_visual`; called `create_visual`; no tool errors; judge: a visual tool succeeded and plausibly charts constructor points for 2023 |

User agents (definitions)
- R43. A user agent SHALL be a stored configuration of the assistant with: a `name` (required, trimmed, at most 64 characters, unique among user agents ignoring case), a `description` (at most 280), `instructions` (at most 4,000; may contain links, R81), `datasets` (dataset names, de-duplicated), `starterQuestions` (at most 5, each at most 200; blanks dropped, de-duplicated), an optional `model` (a model or deployment name of the configured provider), an optional `reasoningEffort`, and the stored lists `tools` and `skills`. **The links in the instructions are the only source of the agent's tools and skills** (ADR-0024): on every create and every draft save the backend SHALL derive `tools` (the optional tool groups the instructions link directly: `sample_rows`, `ask_clarification` and `visuals`) and `skills` (the ids of the owner's in-app skills the instructions link, R68) from them, and SHALL ignore any `tools` or `skills` in the request. The tools an agent gets, including those its skills link, are in [agents.md](../../system/agents.md) 2.1; an agent saved before links, with no `tools`, keeps every tool (R85). Over-long text SHALL be clipped to the limit. A link to a tool that is not in the library SHALL be refused with `Unknown tool "<name>"`, a link to a skill that is neither a built-in on-demand skill (R82) nor one of the owner's with `Unknown skill "<name>"`, and more than 10 distinct linked in-app skills (a built-in skill link is not counted) with `An agent can have at most 10 skills` (R85).
- R44. Every user agent SHALL have a **draft**. Publishing SHALL copy the draft to the **Live** version, together with a copy of each skill it names, and record when. A Live agent SHALL run on those copies until it is published again (R73). The status SHALL be `live` when a Live version exists, else `draft`. An agent has **unpublished changes** when it is Live and its draft differs from its Live version, or when a skill its draft names has changed since its copy was taken. Saving a draft SHALL NOT change the Live version.
- R45. Publishing SHALL require a name and at least one dataset, else `Select at least one dataset to publish`. Creating a draft SHALL require only a name, else `Agent name is required`. A name already used by another user agent SHALL be refused with `An agent named "<name>" already exists`.
- R46. Built-in agents SHALL NOT be created, edited, published or deleted through these operations: `Built-in agents can't be edited` and `Built-in agents can't be deleted`. Their **System Prompt** alone can be edited, through its own operations (R97-R105; [api.md](../../system/api.md) 103, 104).
- R47. Any agent, built-in or user-built, SHALL be pinnable and unpinnable. A user agent's pin SHALL be stored with it and a built-in agent's pin in the app settings, so pins survive a restart.
- R48. The agent catalogue SHALL list built-in and user agents together. Each entry SHALL carry its kind (`official` for the assistant and the RFP Builder, `system` for the five helpers, `user`), status (`builtin`, `draft` or `live`), pinned flag, owner (`Official`, `System` or `You`), whether it has unpublished changes, its datasets and starter questions, and `missingDatasets`: the dataset names in its effective configuration (Live version, else draft) that no longer exist.
- R49. Requesting one agent SHALL resolve the key as a built-in agent first, then as a user-agent id. A user agent's detail SHALL report the assistant's memory and resolved model, because it runs on the assistant, and the tools and prompt its tool selection gives it (Live version, else draft), together with its draft and its Live version.
- R50. Deleting a user agent SHALL remove only its definition. Sessions that reference it SHALL keep their transcript (their behaviour is in [../sessions-chat/spec.md](../sessions-chat/spec.md)).
- R51. Saving a draft, publishing, deleting or pinning an agent that does not exist SHALL fail with `Agent "<id>" not found` (an `ok: false` answer); requesting the detail of one SHALL fail with HTTP 404 as in R8.
- R52. User agents SHALL persist across restarts of the backend.
- R53. **Start chat** SHALL be offered for the Official agents and for Live user agents, on the hub card and in the detail view, and never for draft-only or System agents. On a Live user agent it SHALL create and open a session bound to the agent; on the Official assistant, which declares no dataset, it SHALL open the new-session screen; on an Official agent that declares a dataset (the RFP Builder: `Intellify RFP API`) it SHALL create and open a session over that dataset, bound to the agent. While that dataset does not exist, the agent's `chatRequirement` SHALL be set and **Start chat** SHALL be disabled with it as its title (for the RFP Builder: `Load the "Intellify RFP API" sample in Settings → Testing Data first`). How such a session is created and runs is in [../sessions-chat/spec.md](../sessions-chat/spec.md) (R52-R59, R61). When none of a Live agent's datasets exist, **Start chat** SHALL be disabled with the title `None of this agent's datasets exist`. While the session is being created the button SHALL be disabled; a refusal SHALL show the backend's message, or "Backend unreachable", as an error toast.

### Agent editor

- R54. **New agent** on the hub and **Edit** in a user agent's detail SHALL open the **agent editor**, a full page in the Agents area. New agent opens it empty with the title `New agent`; Edit opens it on the agent's draft with the title `Edit <name>`. Built-in agents SHALL have no editor (R46).
- R55. The editor SHALL hold these fields, which enforce the R43 limits as the user types:
  - **Name** (required, at most 64 characters);
  - **Description** (at most 280);
  - **Instructions** (at most 4,000 characters, counting the saved text): the link editor (R81), with the hint `Added to the assistant's context in every turn. The assistant's own rules and the read-only guard still apply. Type / to link a skill or a tool.`, and under it `Linked skills and tools decide what the agent gets. Every agent also gets the built-in skills and can always list, describe and query its datasets.`;
  - **Datasets**: one checkbox per existing dataset, by name. A dataset in the draft that no longer exists SHALL stay listed, ticked, as `<name> (missing)`, so the user can untick it. With no datasets at all: `No datasets yet — create one in Datasets first.`;
  - **Starter questions**: up to 5 single-line fields of at most 200 characters, each with a **Remove starter question** button, and **Add starter question**, disabled at 5;
  - **Model**: free text, a model or deployment name of the configured provider, with the placeholder `Default (<configured model>)`, or `Default` when no LLM is configured;
  - **Reasoning effort**: `Default`, `Low`, `Medium` or `High`;
  - no Skills or Tools checkboxes: the agent gets the skills and tools its instructions link (R43, R81).
- R56. **Save** SHALL store the form as the draft, creating the agent on its first save (R45), and show the backend's message as a toast (`Agent "<name>" saved as draft`, then `Draft saved`). A refusal (`Agent name is required`, `An agent named "<name>" already exists`) SHALL show as an error toast and change nothing. Save SHALL be disabled while the name is blank, while nothing changed since the last save, or while a save is in flight.
- R57. **Publish** SHALL first save the form when it has changes (R56; a refusal stops it), then publish the draft (R44, R45) and show `Agent "<name>" is Live` or the refusal, such as `Select at least one dataset to publish`. It SHALL be shown while the agent is new, has no Live version, has unpublished changes, or the form has changes.
- R58. The editor's header SHALL show the agent's `Draft` or `Live` chip and, when it applies, `Unpublished changes`, updated after every save and publish. Editing a Live agent SHALL change only its draft: its sessions keep the Live version until the draft is published (R44; sessions-chat R54).
- R59. **Back** SHALL return to the agent's detail view, or to the hub for an agent that was never saved. Leaving the editor in any way (Back, the rail, the drawer) with unsaved changes SHALL first ask `Discard unsaved changes?`. Cancelling SHALL keep the editor open with its changes.
- R60. The agent page's **Chat Box** tab (R90) SHALL reuse this mechanism for a user agent: the same preview session over the saved draft, in the page instead of the Details panel. **Preview** SHALL open the **preview chat** in the right Details panel, beside the form (app-shell R10). While the editor is open, the Details panel SHALL always hold the preview chat, however it is opened. The preview SHALL behave like a session started from the agent (sessions-chat R54, R55, R58), titled `Preview`, except that it runs the saved **draft**:
  - sending a preview message SHALL first save the form when it has changes (R56; a refusal stops the send), so the preview always runs what Save stored;
  - each preview turn SHALL use the draft's current instructions, model and effort overrides, the tools and skills its links select (R43, R82) with the current content of the linked skills, and those of its datasets that exist;
  - with no existing dataset in the draft, the panel SHALL say `Select at least one dataset to preview` and the composer SHALL be disabled.
- R61. A preview conversation SHALL NOT be listed with the sessions or stored in the sessions collection. **Reset preview** SHALL discard it and start an empty one. Leaving the editor, or closing the Details panel, SHALL discard it together with its agent memory and workspace files. Preview conversations left behind when the app stopped SHALL be discarded at the next backend start. The same holds for the Chat Box tab's conversation: **New chat** discards it and leaving the agent page discards it (R90).

### Ownership and permissions

- R62. In both modes user agents, their pins, pins of built-in agents and eval runs SHALL belong to the user who created them: each user sees only their own user agents (the Mine section) and their own pins and eval runs, and agent names are unique per owner. Viewing the hub, an agent's detail, its eval questions, Start chat and pinning need Use agents; New agent, Edit, Save, Publish, Delete and running, listing, downloading or deleting eval runs need Create, test and version agents, and their controls are hidden without it. Rules: [../admin/spec.md](../admin/spec.md) R21, R25, R29-R31.

### Skills tab

- R63. The agent detail SHALL have a **Skills (<n>)** tab. For the Official agent and the System agents it SHALL be read-only. It lists the skills the agent gets ([agents.md](../../system/agents.md) 7.3, 7.4), one per name. They all ship with the app: there are no user or project skills. Each skill SHALL show:
  - its name and its description;
  - whether it loads on demand or is loaded by the app.

  An agent with no skills SHALL say so. A user agent's Skills tab SHALL instead be the inline skill library of R95 and R96, not the list above. In the read-only tab, an in-app skill's `SKILL.md` SHALL show its tool links as read-only chips (R86); built-in skills stay plain text.
- R64. Expanding a skill SHALL list every file in its folder, `SKILL.md` first, with `SKILL.md` selected. The selected file's content SHALL be shown exactly as stored. A file larger than 256 KB, or one that isn't text, SHALL be listed but its content not shown.
- R65. Removed in roadmap 1.13.13: skills ship only with the app, so the tab no longer shows where they come from. (Previously: the built-in, user and project levels, with each folder's path or "not found".)
- R66. Removed in roadmap 1.13.13: there are no user or project skills to skip. (Previously: a user or project skill that failed its checks was listed under Skipped, with its problems.)
- R67. Nothing on the tab SHALL change a skill, and viewing it needs only Use agents (R62). The backend SHALL refuse a file path outside the skill's folder ([api.md](../../system/api.md) 34b). A `skills/` folder in the app's data dir, left by an older version, SHALL be ignored: its skills SHALL NOT be listed or reach any agent.

### Skill library

In-app skills: know-how a user writes in the app and assigns to their agents (ADR-0022; [data-model.md](../../system/data-model.md) 3.10.1; [agents.md](../../system/agents.md) 7.3).

- R68. The Agent Hub's header SHALL offer **Skills**, beside **New agent**. It SHALL open the **skills library**, a page in the Agents area. **Back** SHALL return to the hub.
- R69. The library's **Your skills** section (R75) SHALL list the user's skills sorted by name. Each row SHALL show the name, the description and the agents that use it (`Used by <names>`, or `Not used by any agent`), and open the skill editor. **New skill** SHALL open the skill editor empty. With no skills: `No skills yet. A skill is know-how an agent reads when a question needs it.`
- R70. The **skill editor** SHALL hold: **Name**; **Description**, with the hint `Start with "Use when…". The agent reads the skill only when a question matches it.`; **Body**, the link editor of R81 limited to tools (R84), at most 20,000 characters; and **Reference files**, each a path field (`references/<file name>`) and a content field, with **Add reference file** (disabled at 10) and **Remove reference file**. Each field SHALL enforce its limit as the user types ([data-model.md](../../system/data-model.md) 3.10.1). Under the description the editor SHALL show **What the agent sees**: the catalog entry, the name and the description.
- R71. **Save** SHALL create or save the skill and show `Skill "<name>" created` or `Skill saved`. A refusal SHALL show the backend's message as an error toast and change nothing ([api.md](../../system/api.md) 96). Save SHALL be disabled while nothing changed or while a save is in flight. Leaving with unsaved changes SHALL first ask `Discard unsaved changes?`.
- R72. **Delete** SHALL ask `Delete "<name>"?`, followed by `Agents using it keep it in their Live version until republished.` when a Live agent uses it. When a draft of any of the user's agents links the skill, Delete and a rename of the skill SHALL be refused with the backend's message `"<name>" is linked by <agent names, comma-separated>. Unlink it first.` as an error toast, changing nothing. Otherwise deleting SHALL show `Skill "<name>" deleted` and return to the library.
- R73. Changing or deleting a skill SHALL NOT change a Live agent. The agents whose draft links a changed skill SHALL show **Unpublished changes** (R44), and their sessions SHALL keep the copies taken at their last publish. A preview SHALL use the current skill.
- R74. Skills SHALL belong to the user who created them, in both modes. A user sees and assigns only their own. Viewing the library needs Use agents; **New skill**, **Save** and **Delete** need Create, test and version agents, and are hidden without it (R62). A skill id of another user SHALL answer as not found.

### Built-in skills

The built-in skills, edited in the app as org-wide overrides (ADR-0023; [data-model.md](../../system/data-model.md) 3.10.2; [agents.md](../../system/agents.md) 7.3).

- R75. The skills library SHALL show two sections: **Your skills** (R69) and **Built-in · included in every agent**, listing `curated-knowledge`, `deep-analysis` and `interactive-visuals` with their loading mode (`On demand` or `Loaded by the app`), their description as served, and a **Modified** chip when overridden. The built-in skills SHALL NOT be offered in the agent editor's Skills field; its hint SHALL add `Every agent also gets the built-in skills.`
- R76. A built-in row SHALL open the **built-in skill editor**: Description, What the agent sees, Body, and the built-in's own files, each with its path read-only and its content editable. Files SHALL NOT be added or removed. A banner SHALL say `Changes apply to every session and agent as soon as you save. Run the evals to check them.` Without Edit policies and templates the editor SHALL be read-only, with no Save or Reset.
- R77. **Save** SHALL store the override and show `Built-in skill "<name>" saved`. It SHALL apply to the next call of every session, agent, deep analysis and visual, without a restart. A refusal SHALL show the backend's message as an error toast and change nothing ([api.md](../../system/api.md) 101); an override that drops a placeholder the app fills SHALL be refused.
- R78. **Reset to built-in**, shown while the skill is modified, SHALL ask `Reset "<name>" to the built-in version?`, delete the override, show `Built-in skill "<name>" reset` and show the shipped content.
- R79. When a modified built-in's shipped version has changed since the override was saved, the row and the editor SHALL say `The app's built-in version changed since this was edited. Review it, then save again or reset.`, and the editor SHALL offer **Show the built-in version**, the shipped content read-only. The override SHALL keep serving until it is saved again or reset.
- R80. Overrides SHALL be shared by every user. Viewing the built-in skills needs Use agents; saving and resetting need Edit policies and templates ([../admin/spec.md](../admin/spec.md) R21). The agent page's Skills tab (R63) SHALL show a modified built-in with the **Modified** chip and its served content.

### Links

The editor and menu that link skills and tools in an agent's instructions and in a skill's body (ADR-0024; [../../system/ui.md](../../system/ui.md) 4.5.5; syntax and resolution in [../../system/agents.md](../../system/agents.md) 2.1 and 4.1).

- R81. The **Instructions** field SHALL be a rich editor: plain text lines, with links shown as chips and saved as `[[skill:<name>]]` and `[[tool:<name>]]`. Typing `/` at the start of a line or after a space SHALL open a menu of skills (the owner's in-app skills) and tools (the assistant's library), grouped Skills then Tools, up to 6 each (the Skills group holds the owner's in-app skills, then the built-in on-demand skills, each marked with a `Built-in` suffix; in the assistant's prompt editor, R99, only the built-in ones), filtered as the user types by name or description. ArrowUp and ArrowDown move, Enter or Tab inserts the chip, Esc closes the menu. A `/` inside a word, as in `km/h`, SHALL NOT open it. The buttons **+ Link skill** and **+ Link tool** (in the assistant's prompt editor **+ Link skill or tool** and **+ Link tool**) SHALL open the same menu limited to that kind; when the user has not clicked into the editor the chip goes at the end. The text under the editor SHALL show `<n>/4,000`, counting the saved text with the links as saved.
- R82. A chip SHALL show the name of the skill or tool: skills and tools in different colours, and a link to a skill or tool that no longer exists in a danger colour with the title `Not found`. What the agent gets: the always-on tools (`list_entities`, `describe_entity`, `run_readonly_sql`; linking them is allowed and changes nothing), `read_file` while it has on-demand skills, the optional tools its instructions link, and the optional tools its linked skills link; linking either `create_visual` or `update_visual` SHALL give both. Its skills are the in-app skills its instructions link. A built-in on-demand skill (`curated-knowledge` today) may be linked as a mention: it gates nothing, since every agent gets the built-ins, it is not counted toward the 10-skill limit and is not stored in `skills`.
- R83. Before the model sees them, every link SHALL become a plain mention: `[[tool:x]]` as `the "x" tool` and `[[skill:x]]` as `the "x" skill`. This applies to the agent's instructions and to an in-app skill's body when the model reads it ([../../system/agents.md](../../system/agents.md) 4.1, 7.3). The model never sees `[[`.
- R84. In the skill editor the menu SHALL list tools only and the only button SHALL be **+ Link tool**. A skill body that links a skill SHALL be refused with `Skills can link tools only`, and a link to an unknown tool with `Unknown tool "<name>"`. Built-in skill bodies SHALL NOT have links.
- R85. An agent saved before links, whose draft has no `tools`, or has `tools` or `skills` its instructions do not link, SHALL open in the editor with a new last line `Tools and skills: ` followed by a chip for each such item (no `tools` stands for `sample_rows`, `ask_clarification` and `create_visual`), and the notice `Links were added for what this agent had. Save to keep them.`, with the form unsaved. Until it is saved the agent keeps its stored tools, and an agent with no `tools` keeps every tool. Refusals on a create or draft save come after the name checks, in this order: `Unknown skill "<name>"`, `Unknown tool "<name>"`, `An agent can have at most 10 skills`.
- R86. Read-only views of text with links (the System Prompt tab for a user agent when it is not being edited, R6, and an in-app skill's `SKILL.md` on the Skills tab, R63) SHALL show the same chips, not editable.

### Tools, Graph and LLM Config tabs

The agent detail's tabs for tools, their links and the model settings ([../../system/ui.md](../../system/ui.md) 4.5, 4.5.6, 4.5.7).

- R87. For a user agent the **Tools** tab SHALL list every tool of the library by name with its status: `Always on`, `Linked` or `Not linked`, and for a linked tool where the link comes from: `Linked from the instructions` and/or `Linked by <skill names>`. The status comes from the Live version, else the draft. A built-in agent's Tools tab is unchanged (R6).
- R88. The **Graph** tab (user agents only) SHALL draw three columns, Instructions, the linked skills and the tools, with an edge for each link; hovering or focusing a node highlights its chain; a legend names Instructions, Skill, Tool and Always on; **Show unlinked** adds the owner's unlinked skills and the not-linked tools, greyed. Under the drawing, `What happens on each message` lists four steps. A built-in agent's Graph tab SHALL say `This agent has no links: it gets all of its tools.`
- R89. The **LLM Config** tab (every agent; it replaces the Model tab) SHALL be read-only and show `Provider`, `Model` (with ` (agent override)` when a user agent sets one), `API key` as `Set` or `Not set`, `Max output tokens` (`Default` when the app sets no cap, which is the case for the assistant today) and `Reasoning effort` (the effective one). The key's value SHALL never be shown or sent. Settings are changed in [../llm-settings/spec.md](../llm-settings/spec.md).

### Agent page tabs

The Chat Box, System Prompt and Skills tabs of the agent detail, which work as in the agent-poc reference (ADR-0025; [../../system/ui.md](../../system/ui.md) 4.5, 4.5.8-4.5.10). The other tabs are R6, R7, R87-R89.

- R90. **Chat Box** SHALL be the first tab of a user agent and of the Official agent. It SHALL NOT exist for System agents, which have no chat.
  - **User agent:** the tab SHALL hold a chat with the agent's **draft**, built on the preview mechanism of R60 and R61: an in-memory session that is not listed with the sessions, discarded when the user leaves the agent page and swept at the next backend start. The header SHALL read `Chat with the draft` and offer **New chat**, which discards the conversation and starts an empty one. It SHALL run what the draft stores: edits saved from the System Prompt tab (R93) apply to the next message of a new chat. When the draft has no existing dataset the tab SHALL say `Add a dataset to this agent to chat with it.` with an **Edit** link to the agent editor and no composer.
  - **Official agent:** the tab SHALL say `Chats with the assistant run over datasets you choose.` and offer **Start chat** (R53), which opens the new-session screen.
  - **RFP Builder:** the tab SHALL say `Chats with the RFP Builder run over the "Intellify RFP API" dataset.` and offer **Start chat** (R53), which creates a session bound to it ([sessions-chat](../sessions-chat/spec.md) R52), disabled with its requirement as the title while the dataset is missing.
  - Viewing the tab needs Use agents. Sending in a user agent's draft chat needs Create, test and version agents, as the preview does (R62).
- R91. The tabs SHALL open on their defaults: **System Prompt** for System agents, **Chat Box** otherwise. The **System Prompt** tab for the Official and System agents SHALL show the prompt as served (R6), editable by a Platform admin (R97-R105).
- R92. On a user agent, the **System Prompt** tab SHALL show the assistant's core prompt read-only and collapsed, titled `Assistant core prompt (fixed)`, under the agent's own section, **Agent instructions**: the instructions with their links as chips (R86) and an **Edit** button, shown only with Create, test and version agents. Only the agent's instructions are editable here; the core prompt is the Official agent's, edited on its own page (R97).
- R93. **Edit** SHALL turn the section into the link editor of R81 over the draft's instructions, with:
  - a toolbar with **+ Link skill or tool**, which opens the menu of R81 with both groups, and the hint `Type / to link a skill or tool. The agent only gets the skills and tools its instructions link.`;
  - a `Linked:` row with a chip for each link (R82), or `none`, a broken link in the danger colour;
  - when a link names a skill or tool that does not exist, the error `No <kind> named <name>. Remove the link or create the skill on the Skills tab.`, with ` (and others)` appended when more than one is broken;
  - **Cancel**, which restores the saved text, and **Save prompt**, which reads `Saving…` while in flight and SHALL be disabled while saving, while the text is unchanged and while a link is broken.

  **Save prompt** SHALL store the text as the draft, with the draft's other fields unchanged, and show the toast `Draft saved` (R56). The links derive the draft's `tools` and `skills` as always (R43). When the agent is Live, the header SHALL then show **Unpublished changes** (R44). The agent editor's Instructions field (R55) stays, and edits the same draft.
- R94. Leaving the agent page, or switching to another agent or tab, with an unsaved System Prompt edit SHALL first ask `Discard unsaved changes?` (R59). Cancelling SHALL keep the edit open. The editor's character limit and counter are R81's.
- R95. On a user agent, the **Skills** tab SHALL be the user's skill library inline (R68-R74), with no change of page:
  - the user's skills, sorted by name, each row showing the name, the description, its linked tools as chips and a chip for this agent: `Linked` when the draft's links name the skill, `Not linked` when they do not;
  - **New skill**, and **Edit** and **Delete** on each row, which open an inline form in the tab with the skill editor's fields and rules (R70-R72); **Save** and **Cancel** return to the list in the same tab. The new skill is `Not linked` until the agent's instructions link it (R93);
  - the **Built-in · included in every agent** section as in the library (R75), read-only, with an **Edit** button on each row for a user with Edit policies and templates, which opens the built-in skill editor (R76);
  - the tab's number, `Skills (<n>)`, SHALL be the skills the draft links plus the built-in skills the agent gets.
- R96. The Skills tab's **New skill**, **Edit** and **Delete** SHALL need Create, test and version agents, and be hidden without it (R74). A refusal SHALL show as in R71 and R72, for instance a skill the agent's draft links cannot be deleted or renamed (R72), and the tab SHALL stay on the list or form.

### Built-in agents' system prompts

The System Prompt tab of the Official and System agents, edited in the app as org-wide overrides (ADR-0026; [data-model.md](../../system/data-model.md) 3.10.3; [api.md](../../system/api.md) 34, 103, 104; [agents.md](../../system/agents.md) 1.1 and 2.1-2.6; [ui.md](../../system/ui.md) 4.5.11).

- R97. The System Prompt tab of a built-in agent SHALL show a `Built-in` chip and, while its prompt is overridden, a `Modified` chip, and SHALL show the prompt as served, read-only; for the assistant the view is R105 (links as chips from the editable text). With Edit policies and templates it SHALL offer **Edit**, and while modified **Reset to built-in**. Without that permission the tab SHALL be read-only, with neither.
- R98. **Edit** SHALL open an editor over the editable text ([agents.md](../../system/agents.md) 2.1 for the assistant; the shipped instructions for a System agent) with a banner `Changes apply to every session and agent as soon as you save. Run the evals to check them.`, **Cancel** and **Save prompt**. **Cancel** SHALL restore the saved text. **Save prompt** SHALL read `Saving…` while in flight and SHALL be disabled while saving, while the text is unchanged and while it is empty. Leaving with an unsaved edit SHALL ask `Discard unsaved changes?` (R59, R94).
- R99. The assistant's editor SHALL be the link editor of R81, limited to tools and built-in on-demand skills: the buttons are **+ Link skill or tool** and **+ Link tool**, with the hint `Type / to link a built-in skill or a tool. Links here are mentions; the assistant keeps all its tools.` The `/` menu's Skills group lists only the built-in on-demand skills. A `[[skill:…]]` link to any other skill SHALL be refused (R101). A System agent's editor SHALL be a plain monospace text area with the counter `<n>/20,000` and no link menu; any `[[…]]` SHALL be refused (R101).
- R100. The assistant's editor SHALL show the read-only note `The ## Tools list is generated from the tools the assistant gets and is inserted before ## Working rules.` The `## Tools` section is not part of the editable text: it stays generated from the tools each call offers, and is inserted before the first line `## Working rules` of the override, or appended when there is none. A user agent's session gets it narrowed to its tool selection as before (R82).
- R101. **Save prompt** SHALL store the override and show the backend's message, `System prompt of "<name>" saved`. A refusal SHALL show the backend's message as an error toast and change nothing ([api.md](../../system/api.md) 103): an empty prompt, one over 20,000 characters, an assistant prompt that does not start with `You are the Questions to Insights assistant`, a link to a skill that is not a built-in on-demand skill (`Only built-in skills can be linked here: this prompt is shared by every user`), an unknown tool, or a link in a System agent's prompt.
- R102. **Reset to built-in**, shown while the prompt is modified, SHALL ask `Reset the system prompt of "<name>" to the built-in version?`, delete the override, show `System prompt of "<name>" reset` and show the shipped text.
- R103. A save or a reset SHALL apply to the next call of every session, user agent, deep analysis, visual, SQL fix and verification, knowledge bootstrap and eval run, without a restart. With no override every prompt is the shipped one, unchanged. A user agent runs on the assistant, so an edit of the assistant's prompt changes its core prompt too. The code-enforced guards stay whatever the prompt says.
- R104. When a modified prompt's shipped text has changed since the override was saved, the tab SHALL say `The app's built-in version changed since this was edited. Review it, then save again or reset.` and offer **Show the built-in version**, the shipped text read-only. The override SHALL keep serving until it is saved again or reset. Overrides SHALL be shared by every user. Viewing needs Use agents; **Edit**, **Save prompt** and **Reset to built-in** need Edit policies and templates ([../admin/spec.md](../admin/spec.md) R21). The eval baseline describes the shipped prompts; an eval run uses the overrides.
- R105. The System Prompt tab of the Official assistant SHALL render `prompt.editable` with its links as chips (R86) and, in place of the `## Tools` section, a muted note `## Tools — generated from the tools the assistant gets`; the generated list stays available in a collapsed `<details>` titled `Prompt as sent to the model` showing `instructions`. The Graph tab of the Official assistant SHALL draw its prompt's links (instructions to skills and tools) with every tool `Always on` or linked; the message `This agent has no links: it gets all of its tools.` stays only for System agents (R88). The shipped assistant prompt links every tool it mentions and the built-in `curated-knowledge` skill; the model sees them as plain mentions (R83).

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
- Skills endpoints `GET /agents/:key/skills` and `GET /agents/:key/skills/:name/file`: [../../system/api.md](../../system/api.md) section 2.6. How skills load and are checked: [../../system/agents.md](../../system/agents.md) 7.3; the old user skill folder: [../../system/data-model.md](../../system/data-model.md) 4.8; decision ADR-0021.
- The `agents` collection (user agents) and the built-in pins document: [../../system/data-model.md](../../system/data-model.md) sections 3.10 and 3.2; decision ADR-0008 in [../../system/architecture.md](../../system/architecture.md).
- Endpoints `GET /agents`, `GET /agents/:key`, `GET /agents/:key/evals`, `POST /agents/:key/evals/run`, `GET /agents/:key/evals/runs`, `GET|DELETE /agents/:key/evals/runs/:jobId`, `GET /agents/:key/evals/runs/:jobId/download`: [../../system/api.md](../../system/api.md).
- Eval run documents (run, per-question result, check result, tool call, regression summary): [../../system/data-model.md](../../system/data-model.md).
- The seven agents, the assistant's tools and memory settings, and the judge's prompt: [../../system/agents.md](../../system/agents.md).
- Sample fixtures and their required entities: [../testing-data/spec.md](../testing-data/spec.md).
- Terms: [../../product/glossary.md](../../product/glossary.md).

## UI

Main view "Agents" (the Agent Hub) and an agent's detail view, with the Details panel on the right ([../../system/ui.md](../../system/ui.md) sections 4.4 and 4.5, [../app-shell/spec.md](../app-shell/spec.md)). Agent Hub: loading, error, populated (Official, Mine and System sections, pinned cards first, Show more), the Pinned filter's single Pinned section, no match, empty Pinned filter, empty Mine filter. Hub cards and agent detail also carry **Start chat** (R53); a user agent's detail carries **Edit**. Agent editor (R54-R61, R81-R86): new and edit titles, the form with the link editor and its menu, saving, publishing, the unsaved-changes confirmation, and the preview chat in the Details panel (empty, no-dataset, running, reset). Agent detail: loading, error, its tabs (the Chat Box tab, the System Prompt tab in its read and edit states, the inline Skills tab of a user agent (R90-R96); the Graph tab for user agents; the LLM Config tab; the read-only Skills tab: loading, error, no skills, skill list, an expanded skill, a file that isn't shown), and for user agents the Publish and Delete actions and the delete confirmation. Evals tab: loading ("Loading evals…"), error, no evals, set list, open set (idle, starting/running, finished), Executions (loading, empty, populated, expanded).

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
    And the Chat Box tab is shown, with "Start chat"
    When I open the System Prompt tab
    Then I see "You are the Questions to Insights assistant"
    When I open the Tools tab
    Then I see "run_readonly_sql" and "ask_clarification"
    When I open the Memory tab
    Then I see "Recent messages replayed" and "40 messages"
    When I open the LLM Config tab
    Then I see "Provider"
    When I open the Evals tab
    Then I see the "world-cup" set listed with "12 questions"
    And no individual question is shown
    And the run button is hidden
    When I open the "world-cup" set
    Then the "champion-2022" question shows "Who won the 2022 World Cup?"
    And it lists the check "Checks if output includes "Argentina""
    And 12 questions are listed
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
    Then the Questions sub-tab is shown with 12 questions
    When I open the executions sub-tab
    Then I see "No eval runs yet"
    And no questions are listed
    When I return to the Questions sub-tab and click the run button
    And I open the executions sub-tab
    Then the first execution shows "0/12 passed"
    When I return to the Questions sub-tab
    Then 12 questions are listed

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

  Scenario: Skills opens the skills library and Back returns to the hub
    When I click "Agents"
    Then I see the "Skills" button beside "New agent"
    When I click "Skills"
    Then I see the skills library
    When I click "Back"
    Then I am back on the Agent Hub

  Scenario: The hub has no detectable accessibility violations in either theme
    When I click "Agents"
    And I click "Show more (2)"
    Then the axe scan reports no violations in the Light theme
    And the axe scan reports no violations in the Dark theme
```

E2E: `frontend/e2e/agent-skills.spec.ts`

### Feature: Agent skills

The Skills tab (R63-R67). Skills ship only with the app. The old-folder scenario writes a skill folder into the test's data dir before the app starts.

```gherkin
Feature: Agent skills

  Scenario: Shows the designer's built-in skill and the content of its files
    When I open the "Interactive Visual Designer" agent
    And I open the Skills tab
    Then the tab reads "Skills (1)"
    And I see the skill "interactive-visuals", "Loaded by the app"
    And I don't see "Where skills come from"
    When I open the "interactive-visuals" skill
    Then I see the files "SKILL.md", "reference/freeform.md" and "reference/spec-mode.md"
    And the content of "SKILL.md" is shown
    When I select "reference/spec-mode.md"
    Then I see the content of "reference/spec-mode.md"

  Scenario: An agent without skills says so
    When I open the "SQL Fixer" agent
    And I open the Skills tab
    Then the tab reads "Skills (0)"
    And I see "This agent has no skills."

  Scenario: The assistant gets only its built-in skills, and an old skills folder is ignored
    Given the data dir holds a skills folder from an older version, with a skill "sql-style"
    When I open the "Questions to Insights Assistant" agent
    And I open the Skills tab
    Then the tab reads "Skills (2)"
    And I see the skill "curated-knowledge", "On demand"
    And I see the skill "deep-analysis", "Loaded by the app"
    And I don't see the skill "sql-style"

  Scenario: A user agent's Skills tab is its inline library, not the read-only list
    Given a skill "fiscal-calendar" with the description "Use when a question names a fiscal year."
    And a Live user agent "Finance helper" over "World Cup Core" whose instructions link the skill "fiscal-calendar"
    When I open "Finance helper"
    And I open the Skills tab
    Then I see the skill "fiscal-calendar" with the chip "Linked" and the buttons "Edit" and "Delete"
    And I see no "Where skills come from" section
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
    When I open an agent's LLM Config tab
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

  Scenario: Only linked tools are offered to the model
    When I click "Agents"
    And I click "New agent"
    And I type "KPI lookup" into "Name"
    And I tick "World Cup Core"
    And I click "+ Link tool"
    And I pick "sample_rows"
    And I click "Save"
    And I send "Who won in 2014?" in the preview
    Then the model was offered "sample_rows" but not "ask_clarification", "create_visual" or "update_visual"
    And the model's prompt says "You can't ask the user a question back in this session."
    When I click "Back"
    Then the "Tools" tab lists "sample_rows" as "Linked" and "create_visual" as "Not linked"

  Scenario: A linked skill reaches the preview, and the Live agent keeps its copy
    Given a skill "fiscal-calendar" with the description "Use when a question names a fiscal year." and the body "Our fiscal year starts on 1 July."
    When I click "Agents"
    And I click "New agent"
    And I type "Finance helper" into "Name"
    And I tick "World Cup Core"
    And I type "/fis" in "Instructions" and pick "fiscal-calendar"
    And I click "Save"
    And I send "What happened in fiscal 2018?" in the preview
    Then the model's skill catalog lists "fiscal-calendar"
    And the model's instructions contain 'the "fiscal-calendar" skill' and no "[["
    When I click "Publish"
    And I change the body of "fiscal-calendar" to "Our fiscal year starts on 1 April." in the skills library
    Then "Finance helper" shows "Unpublished changes"
    When I start a chat with "Finance helper" and the model loads "fiscal-calendar" with the skill tool
    Then it gets "Our fiscal year starts on 1 July."

  Scenario: A linked skill's tools come with it
    Given a skill "chart-style" that links the tool "create_visual" in its body
    When I click "Agents" and click "New agent"
    And I type "Chart helper" into "Name"
    And I tick "World Cup Core"
    And I type "/char" in "Instructions" and pick "chart-style"
    And I click "Save"
    And I send "Chart the goals per year." in the preview
    Then the model was offered "create_visual" and "update_visual" but not "sample_rows"
    When I click "Back"
    Then the "Tools" tab lists "create_visual" as "Linked" with "Linked by chart-style"

  Scenario: A slash inside a word does not open the link menu
    When I click "Agents" and click "New agent"
    And I type "Speeds in km/h" into "Instructions"
    Then no link menu is open
    When I type " /" into "Instructions"
    Then the link menu is open with "Skills" and "Tools"

  Scenario: An unknown link is refused
    Given a draft user agent "Cup historian" over "World Cup Core" whose instructions contain "[[skill:gone]]"
    When I open "Cup historian" from "Agents" and click "Edit"
    Then the chip "gone" is shown as not found
    When I click "Save"
    Then I see the error toast 'Unknown skill "gone"'

  Scenario: An agent saved before links gets a links line
    Given a draft user agent "Old timer" over "World Cup Core" with no tools list and the instructions "Be brief."
    When I open "Old timer" from "Agents" and click "Edit"
    Then the last line of "Instructions" is "Tools and skills:" followed by the chips "sample_rows", "ask_clarification" and "create_visual"
    And I see "Links were added for what this agent had. Save to keep them."
    And "Save" is enabled

  Scenario: The Graph tab shows the chain from instructions to skill to tool
    Given a skill "chart-style" that links the tool "create_visual" in its body
    And a Live user agent "Chart helper" over "World Cup Core" whose instructions link "chart-style" and "sample_rows"
    When I open "Chart helper" from "Agents" and open the Graph tab
    Then I see the nodes "Instructions", "chart-style", "create_visual" and "sample_rows"
    And the "create_visual" node is reached through "chart-style"
    And I see "What happens on each message"
    When I tick "Show unlinked"
    Then "ask_clarification" is shown greyed

  Scenario: The LLM Config tab shows whether the key is set and never the key
    Given an LLM configuration with the API key "sk-secret-123" is saved
    When I open the "Questions to Insights Assistant" agent and open the LLM Config tab
    Then I see "API key" with "Set"
    And I do not see "sk-secret-123" anywhere on the page

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

  Scenario: Editing the System Prompt in place saves a draft with the link
    Given a skill "fiscal-calendar" with the description "Use when a question names a fiscal year."
    And a Live user agent "Cup historian" over "World Cup Core" with the instructions "Answer in one sentence."
    When I open "Cup historian" from "Agents"
    Then the Chat Box tab is shown
    When I open the System Prompt tab
    Then I see "Assistant core prompt (fixed)" collapsed and the instructions "Answer in one sentence."
    When I click "Edit"
    Then I see the hint "Type / to link a skill or tool. The agent only gets the skills and tools its instructions link."
    And "Save prompt" is disabled
    When I type "/fis" in the instructions and pick "fiscal-calendar"
    Then the "Linked:" row shows the chip "fiscal-calendar"
    When I click "Save prompt"
    Then I see the toast "Draft saved"
    And the header shows "Unpublished changes"
    And the Skills tab shows "fiscal-calendar" as "Linked"

  Scenario: A broken link disables Save prompt
    Given a Live user agent "Cup historian" over "World Cup Core" with the instructions "Answer in one sentence."
    When I open "Cup historian" from "Agents", open the System Prompt tab and click "Edit"
    And I type "[[skill:gone]]" at the end of the instructions
    Then I see "No skill named gone. Remove the link or create the skill on the Skills tab."
    And "Save prompt" is disabled
    When I remove the broken link
    Then the error is gone and "Save prompt" is disabled because nothing changed

  Scenario: Leaving an unsaved System Prompt edit asks first
    Given a Live user agent "Cup historian" over "World Cup Core" with the instructions "Answer in one sentence."
    When I open "Cup historian" from "Agents", open the System Prompt tab and click "Edit"
    And I type " Be brief." and click "All agents"
    Then I am asked "Discard unsaved changes?"
    When I cancel
    Then the System Prompt tab is still open with " Be brief." typed

  Scenario: The Chat Box tab chats with the draft, and New chat starts over
    Given a Live user agent "Cup historian" over "World Cup Core" with the instructions "Answer in one sentence."
    When I open "Cup historian" from "Agents"
    Then the Chat Box tab shows "Chat with the draft" and "New chat"
    When I send "Who won in 2014?" in the Chat Box
    Then I see the stub's answer in the Chat Box
    And the model received "Answer in one sentence." as the agent's instructions
    And "Cup historian" is not listed in "Sessions navigation"
    When I click "New chat"
    Then the Chat Box is empty
    When I click "All agents" and open "Cup historian" again
    Then the Chat Box is empty

  Scenario: The Chat Box needs a dataset
    Given a draft user agent "Empty historian" with no dataset
    When I open "Empty historian" from "Agents"
    Then the Chat Box tab shows "Add a dataset to this agent to chat with it." and an "Edit" link

  Scenario: The Official agent's Chat Box offers Start chat
    When I open "Questions to Insights Assistant" from "Agents"
    Then the Chat Box tab shows "Chats with the assistant run over datasets you choose." and "Start chat"

  Scenario: The Skills tab shows what is linked and creates a skill inline
    Given a skill "fiscal-calendar" with the description "Use when a question names a fiscal year."
    And a skill "chart-style" with the description "Use when drawing a chart." that links the tool "create_visual"
    And a Live user agent "Finance helper" over "World Cup Core" whose instructions link the skill "fiscal-calendar"
    When I open "Finance helper" from "Agents" and open the Skills tab
    Then "fiscal-calendar" shows the chip "Linked"
    And "chart-style" shows the chip "Not linked" and the tool chip "create_visual"
    And I see the "Built-in · included in every agent" section
    When I click "New skill"
    And I fill the inline form with the name "fy-rules", the description "Use when a question names a fiscal year." and the body "The fiscal year starts on 1 July."
    And I click "Save"
    Then I see the toast 'Skill "fy-rules" created'
    And "fy-rules" is listed in the tab as "Not linked"
    And I am still on the Skills tab of "Finance helper"
    When I click "Delete" on "fy-rules" and confirm
    Then "fy-rules" is no longer listed

  Scenario: The editor has no detectable accessibility violations in either theme
    When I click "Agents" and click "New agent"
    And I click "Preview"
    Then the axe scan reports no violations in the Light theme
    And the axe scan reports no violations in the Dark theme
```

E2E: none yet for the Feature below.

### Feature: Skill library

The skills library and skill editor (R68-R74).

```gherkin
Feature: Skill library

  Scenario: Creates, edits and deletes a skill
    When I click "Agents"
    And I click "Skills"
    Then I see "No skills yet. A skill is know-how an agent reads when a question needs it."
    When I click "New skill"
    And I type "fiscal-calendar" into "Name"
    And I type "Use when a question names a fiscal year." into "Description"
    And I type "Our fiscal year starts on 1 July. See references/quarters.md." into "Body"
    And I click "Save"
    Then I see the error toast "The body names references/quarters.md, which this skill doesn't have"
    When I click "Add reference file"
    And I type "references/quarters.md" into "Path of reference file 1"
    And I type "Q1 is July to September." into "Content of reference file 1"
    And I click "Save"
    Then I see the toast 'Skill "fiscal-calendar" created'
    And "What the agent sees" shows "fiscal-calendar" and "Use when a question names a fiscal year."
    When I click "Back"
    Then the library lists "fiscal-calendar" with "Not used by any agent"
    When I open "fiscal-calendar" and click "Delete" and confirm
    Then I see the toast 'Skill "fiscal-calendar" deleted'
    And I see "No skills yet. A skill is know-how an agent reads when a question needs it."

  Scenario: Refuses a bad name or description
    Given I am in the skill editor of a new skill
    When I type "Fiscal Calendar" into "Name"
    And I type "Use when a question names a fiscal year." into "Description"
    And I type "Body" into "Body"
    And I click "Save"
    Then I see the error toast "Use lowercase letters, digits and single hyphens in a skill name"
    When I replace the name with "curated-knowledge"
    And I click "Save"
    Then I see the error toast '"curated-knowledge" is the name of a built-in skill'
    When I replace the name with "fiscal-calendar"
    And I replace the description with "Fiscal calendar rules."
    And I click "Save"
    Then I see the error toast 'The description must start with "Use when"'

  Scenario: A skill that an agent links can't be deleted or renamed
    Given a skill "fiscal-calendar" and a draft user agent "Finance helper" whose instructions link it
    When I open "fiscal-calendar" and click "Delete" and confirm
    Then I see the error toast '"fiscal-calendar" is linked by Finance helper. Unlink it first.'
    When I replace the name with "fiscal-rules" and click "Save"
    Then I see the same error toast

  Scenario: The skill editor links tools only
    Given a skill "chart-style"
    When I open "chart-style"
    Then I see the button "+ Link tool" and no "+ Link skill"
    When I type "/" at the end of "Body"
    Then the link menu lists "Tools" and no "Skills"

  Scenario: The library and the skill editor have no detectable accessibility violations in either theme
    Given a skill "fiscal-calendar" with the description "Use when a question names a fiscal year."
    When I click "Agents" and click "Skills"
    Then the axe scan reports no violations in the Light theme
    And the axe scan reports no violations in the Dark theme
    When I open "fiscal-calendar"
    Then the axe scan reports no violations in the Light theme
    And the axe scan reports no violations in the Dark theme

  Scenario: An admin edits a built-in skill, and Reset restores it
    Given the model is the recording stub
    And I hold "Edit policies and templates"
    When I click "Agents"
    And I click "Skills"
    Then the "Built-in · included in every agent" section lists "curated-knowledge", "deep-analysis" and "interactive-visuals"
    When I open "curated-knowledge"
    Then I see "Changes apply to every session and agent as soon as you save. Run the evals to check them."
    When I replace the description with "Use when the turn carries curated knowledge: glossary, rules and filters."
    And I click "Save"
    Then I see the toast 'Built-in skill "curated-knowledge" saved'
    And the row "curated-knowledge" shows "Modified"
    When I ask the assistant "Who won in 2022?" in a new session
    Then the model's catalog lists "curated-knowledge" with "Use when the turn carries curated knowledge: glossary, rules and filters."
    When I open "curated-knowledge" in the skills library and click "Reset to built-in" and confirm
    Then I see the toast 'Built-in skill "curated-knowledge" reset'
    And the row "curated-knowledge" no longer shows "Modified"

  Scenario: An override that drops a placeholder is refused
    Given I hold "Edit policies and templates"
    And I am in the built-in skill editor of "deep-analysis"
    When I remove every "{{" placeholder from "phases/1-plan.md"
    And I click "Save"
    Then I see an error toast starting "phases/1-plan.md must use the placeholders"
    And the row "deep-analysis" does not show "Modified"

  Scenario: Without Edit policies and templates the built-in editor is read-only
    Given I hold "Create, test and version agents" but not "Edit policies and templates"
    When I open "curated-knowledge" in the skills library
    Then I see no "Save" and no "Reset to built-in"
```

E2E: none yet

### Feature: Built-in agent prompts

The System Prompt tab of the built-in agents (R97-R105). The model is the recording stub, so the system prompt of each request can be read.

```gherkin
Feature: Built-in agent prompts

  Scenario: An admin edits the assistant's prompt, and Reset restores it
    Given the model is the recording stub
    And I hold "Edit policies and templates"
    When I open the "Questions to Insights Assistant" agent
    And I open the System Prompt tab
    Then I see the chip "Built-in" and no chip "Modified"
    When I click "Edit"
    Then I see "Changes apply to every session and agent as soon as you save. Run the evals to check them."
    And I see "The ## Tools list is generated from the tools the assistant gets and is inserted before ## Working rules."
    When I append the line "Always end an answer with the word Done." to the prompt
    And I click "Save prompt"
    Then I see the toast 'System prompt of "Questions to Insights Assistant" saved'
    And I see the chip "Modified"
    When I ask the assistant "Who won in 2022?" in a new session
    Then the system prompt of the model's request contains "Always end an answer with the word Done."
    And it still contains "## Tools"
    When I open the System Prompt tab of the assistant, click "Reset to built-in" and confirm
    Then I see the toast 'System prompt of "Questions to Insights Assistant" reset'
    And I no longer see the chip "Modified"
    When I ask the assistant "Who won in 2022?" in a new session
    Then the system prompt of the model's request does not contain "Always end an answer with the word Done."

  Scenario: A System agent's prompt is edited in a text area, with no link menu
    Given I hold "Edit policies and templates"
    When I open the "SQL Fixer" agent
    And I click "Edit" on the System Prompt tab
    Then I see a text area with the counter "<n>/20,000"
    And I see no "+ Link tool" and no "+ Link skill"
    When I type "[[tool:sample_rows]]" in the text area
    And I click "Save prompt"
    Then I see the error toast "This agent's prompt can't contain links"
    And the row of the agent does not show "Modified"

  Scenario: A skill link in the assistant's prompt is refused
    Given I hold "Edit policies and templates"
    And I am editing the System Prompt of "Questions to Insights Assistant"
    When I append "[[skill:sql-style]]" to the prompt
    And I click "Save prompt"
    Then I see the error toast "Only built-in skills can be linked here: this prompt is shared by every user"
    And the prompt is not modified

  Scenario: The shipped assistant prompt shows its tools and skill as chips and the model reads plain mentions
    Given the model is the recording stub
    When I open the "Questions to Insights Assistant" agent
    And I open the System Prompt tab
    Then I see tool chips such as "ask_clarification" and "run_readonly_sql" and a "curated-knowledge" chip
    And I see "## Tools — generated from the tools the assistant gets"
    And I see no "[[" in the prompt view
    When I ask the assistant "Who won in 2022?" in a new session
    Then the system prompt of the model's request contains 'Call the "ask_clarification" tool only when'
    And it does not contain "[["

  Scenario: A built-in skill link in the assistant's prompt is accepted
    Given I hold "Edit policies and templates"
    And I am editing the System Prompt of "Questions to Insights Assistant"
    When I append "[[skill:curated-knowledge]]" to the prompt
    And I click "Save prompt"
    Then I see the toast 'System prompt of "Questions to Insights Assistant" saved'

  Scenario: Without Edit policies and templates the built-in prompt is read-only
    Given I hold "Use agents" but not "Edit policies and templates"
    When I open the "Questions to Insights Assistant" agent
    And I open the System Prompt tab
    Then I see the prompt
    And I see no "Edit" and no "Reset to built-in"
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

  Scenario: Tools and skills are derived from the links in the instructions
    Given a skill "fiscal-calendar"
    When I create an agent named "Finance helper" with the "World Cup Core" dataset and the instructions "Use [[skill:fiscal-calendar]] and [[tool:sample_rows]]."
    Then its draft names the tool "sample_rows" and the skill "fiscal-calendar", and its instructions are stored as written
    When I create an agent named "Plain" with the instructions "Be brief." and the request lists tools "ask_clarification" and skills "fiscal-calendar"
    Then its draft names no tools and no skills, because the lists are ignored

  Scenario: Unknown links are refused
    When I save a draft whose instructions link "[[tool:delete_everything]]"
    Then I see 'Unknown tool "delete_everything"'
    When I save a draft whose instructions link "[[skill:nope]]"
    Then I see 'Unknown skill "nope"'
    When I save a draft whose instructions link 11 distinct skills
    Then I see "An agent can have at most 10 skills"

  Scenario: A skill links tools only
    When I create a skill whose body links "[[skill:other]]"
    Then I see "Skills can link tools only"
    When I create a skill whose body links "[[tool:delete_everything]]"
    Then I see 'Unknown tool "delete_everything"'

  Scenario: The detail of an agent shows its links and its LLM settings
    Given a skill "chart-style" that links "create_visual" in its body and an agent whose instructions link it and "[[tool:sample_rows]]"
    When I request the agent's detail
    Then "toolLinks" lists "create_visual" as linked by "chart-style", "sample_rows" as linked from the instructions and "run_readonly_sql" as always on
    And "llm" says whether an API key is configured and never carries the key

  Scenario: A skill that an agent's draft links can't be deleted or renamed
    Given a skill "fiscal-calendar" linked by the draft of "Finance helper"
    When I delete the skill
    Then I see '"fiscal-calendar" is linked by Finance helper. Unlink it first.'

  Scenario: Publishing copies the skills and a later skill edit leaves the Live copy
    Given a draft agent "Finance helper" with one dataset and instructions that link the skill "fiscal-calendar"
    When I publish it
    Then its Live version carries a copy of "fiscal-calendar"
    When I change the body of "fiscal-calendar"
    Then the agent shows "Unpublished changes" and its Live copy of "fiscal-calendar" is unchanged
    When I publish it again
    Then its Live copy carries the new body
```

## Acceptance

- The nine `agents.spec.ts` scenarios pass, the nine `agent-hub.spec.ts` scenarios pass, and the `agent-editor.spec.ts` scenarios pass, with the axe scans of the hub and the editor clean in both themes.
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

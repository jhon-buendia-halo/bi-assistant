# Agents and evals

The Agents screen lets the user inspect every agent the app runs (its prompt, tools, memory and model) and measure the main assistant against curated question sets. The user picks a set, ticks the questions to run (optionally narrowed to one failure category), chooses a datasource, and watches the run finish question by question. Every question is scored by explicit checks and tagged with the failure class it probes, so a run reports a pass rate per category; a failed question explains why and shows the exact steps the assistant took. Every run records the tokens it spent and, when the model is priced, what that cost. Past executions are kept, can be downloaded as a Markdown report and are compared with the previous comparable run to surface regressions.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): agent, assistant, eval set, eval suite, eval case, eval category, eval check, eval run, eval run log, token usage, sample fixture, dataset, datasource, entity, tool call, knowledge entry, session.

Capability-local vocabulary:
- **Questions** and **Executions** — the two sub-tabs inside an agent's Evals tab: the suite, and the history of runs.
- **Regression comparison** — the per-question diff between a finished run and the previous comparable run; see R32.
- **Details panel** — the right-hand panel ([../app-shell/spec.md](../app-shell/spec.md)); on an agent's detail view it shows one question's scoring and trace.

## Rules

Agent catalogue
- R1. The system SHALL list every registered agent on the **Agents** screen, alphabetical by display name. Each row SHALL show the display name, the description (when present), the number of tools ("No tools", "1 tool", "N tools") and the agent's id.
- R2. Loading SHALL show "Loading agents…"; an empty list "No agents registered."; a failure the backend's message or "Backend unreachable".
- R3. Selecting an agent SHALL open its detail view with an **All agents** back button, the display name as heading, the id, the description, and five tabs: **Prompt template**, **Tools (N)**, **Memory**, **Model**, **Evals**. The Prompt template tab SHALL be selected first. Opening a different agent SHALL reset all tab, selection and run state.
- R4. The Prompt template tab SHALL show the agent's instructions as plain text. If the agent builds its prompt at request time and has no static text, it SHALL say "This agent builds its prompt at request time, so there is no static template to show."
- R5. The Tools tab SHALL list each tool alphabetically with its name, description and the names of its input parameters. An agent with no tools SHALL show "This agent runs in a single step with no tools."
- R6. The Memory tab SHALL show, for an agent with memory: "Recent messages replayed" (`<N> messages`, "Disabled" or "Default"), "Semantic recall", "Working memory" and "Auto-generated titles" (each "Enabled" or "Disabled"), and "Storage" when known. An agent with no memory SHALL show "This agent is stateless — no memory is configured." For the assistant: 40 messages replayed, semantic recall off, titles off.
- R7. The Model tab SHALL show the model identifier and provider the agent currently resolves to; with none resolved it SHALL say "No model resolved — save an LLM configuration in Settings first." (see [../llm-settings/spec.md](../llm-settings/spec.md)).
- R8. Requesting an agent that does not exist SHALL fail with `Agent "<key>" not found` (HTTP 404), shown in the detail view.
- R9. The system SHALL tolerate an agent whose prompt, tools, memory or model cannot be read: that facet is simply empty, the rest still loads.

Question sets
- R10. Only the assistant SHALL have eval sets. Every other agent's Evals tab SHALL show "No evals configured for this agent yet."
- R11. The system SHALL provide seven sets, listed in id order:

  | Id | Name | Data | Questions |
  |---|---|---|---|
  | `formula-1` | Formula 1 | the bundled Formula 1 sample on PostgreSQL, 1950 to 2026 | 10 |
  | `genomics` | Genomics | the synthetic genomics fixture on PostgreSQL | 20 |
  | `health-insurance` | Health Insurance | the synthetic health-insurance fixture on PostgreSQL | 20 |
  | `hr` | HR | the synthetic HR fixture on PostgreSQL | 10 |
  | `retail` | Retail | the synthetic retail fixture on PostgreSQL | 6 |
  | `world-cup` | World Cup | the bundled World Cup sample on PostgreSQL | 10 |
  | `world-cup-rest` | World Cup (REST API) | the bundled REST sample: the 10 `world-cup` questions derived per R45, case ids prefixed `rest-` | 10 |

  The question lists are in *Eval suite content* below. Case ids SHALL be unique across all sets, so a list of case ids names exactly one set.
- R12. Each set SHALL carry an id, a name, a description, the names of the datasets it is written against, and its cases. A set over a bundled sample ([../testing-data/spec.md](../testing-data/spec.md)) SHALL name that sample and take its required entities, datasource kind and default dataset name from the sample catalogue, never repeating them; any other set SHALL declare its datasets, its required entities and its datasource kind (PostgreSQL unless stated), and its description SHALL be the operator-facing setup sentence the preflight quotes (R20). Each case SHALL carry an id, a category (R43), the question, an intent (what it probes) and its checks (id, name and description). A case MAY also carry, for the developer harness only, the reasoning a correct business-expert trace should explain and a learning scenario ([business-expert](../business-expert/spec.md) R32, R33). The in-app runner ignores both.
- R13. The Evals tab SHALL open on the list of sets, each showing its name, "<N> questions" and its description, with no question shown and no run button. Clicking a set SHALL open it (revealing its questions, the datasource picker and the run button) and tick all of its questions; clicking the open set again SHALL close it and clear the ticks. Opening another set, or closing the open one, SHALL also reset the category filter (R44), clear the Details panel selection, clear any refusal message under the run controls and clear the progress, verdicts and scope of the last run shown in the Questions sub-tab (the run itself stays under Executions). Sets SHALL be unselectable while a run is starting or running.
- R14. An open set SHALL show "<N> questions in <set name>. Each check must score 1.0 for its question to pass.", then the datasource picker, the run button, "Scoped to <datasets>" (R21), a **Select all** checkbox, the category filter (R44), "<ticked> of <N> selected", and the numbered question list.
- R15. Each question row SHALL show a tick box (labelled "Run: <question>"), the number (its position in the list as shown), the question text, a chip with its category, its intent and a chip per check showing the check's description. Clicking the row (not the tick box) SHALL select it for the Details panel and highlight it.
- R16. Select all SHALL act on the questions currently shown: it SHALL tick every shown question when not all of them are ticked, and untick every shown question when all are ticked, leaving the ticks of questions hidden by the category filter unchanged. Its label SHALL read "Select all shown" while a category is picked. Ticks, Select all and sets SHALL be disabled while a run is starting or running.

Starting a run
- R17. The datasource picker SHALL list every configured datasource as "<name> · <kind label>" (for example "World Cup PostgreSQL · PostgreSQL"), defaulting to the first. With none it SHALL show "No datasources configured" and the run button SHALL be disabled.
- R18. The run button SHALL read "Run <N> selected" with N the number of ticked questions, and SHALL be disabled when N is 0, no datasource exists, or a run is starting or running. While starting or running it SHALL read "Running…" with a spinner.
- R19. Starting a run SHALL send the chosen datasource, the open set's id and the ids of the ticked questions (ticked questions hidden by the category filter included). The system SHALL validate, in this order, and refuse without starting (the message appears in a red box under the run controls, and no run is recorded):
  1. the agent has evals, else `Agent "<key>" has no evals to run`;
  2. no run is already going for this agent, else `An eval run is already in progress for this agent`;
  3. a datasource was chosen, else `Pick a datasource to run against`;
  4. the set resolves: a named set must exist, else `Unknown eval suite "<id>"…` naming the sets that do exist (a set whose definition is invalid fails with its validation message, R45); without a set id, the set is the one the question ids belong to, else `No question set matches the selected questions, so there is no sample to validate the datasets against.` (no id matches any set) or `The selected questions span several sets (<ids>) — run one set at a time.`;
  5. the datasource has at least one dataset, else `That datasource has no datasets — create one in Datasets before running evals`;
  6. at least one ticked question belongs to the set, else `Pick at least one question to run` (ids of other sets are ignored);
  7. the datasets in scope (R21) cover the set (R20).
- R20. The dataset preflight SHALL require that the datasets in scope belong to exactly one datasource of the set's kind (PostgreSQL or REST API) and together contain every required entity of the set (matched on the last two name parts, schema and table, case-insensitively, so a same-named table in another schema does not count). For a set over a bundled sample the message SHALL begin "These evals require the bundled <sample name> sample: <description> Select its <PostgreSQL|REST API> datasource and save a dataset containing the <schema> tables and views. Setup: <setup hint>."; for any other set it SHALL begin with the set's description (or, for a set without one, "These evals require the <set name> fixture (suite "<id>"). Select its <PostgreSQL|REST API> datasource and save a dataset containing: <required entities>."). Either way it SHALL continue with "Selected datasets: <names>. Missing entities: <entity list>." or "The selected datasets must belong to one <kind> datasource." No model tokens SHALL be spent when preflight fails.
- R21. The run SHALL be scoped to the datasets the set declares when every one of them is bound to the chosen datasource (matched by name), and otherwise to every dataset bound to that datasource, so a datasource that carries several fixtures does not show one set's questions another fixture's tables; the preflight (R20) then decides whether the scope is enough. The run record and the UI SHALL show "Scoped to <dataset names>"; before the open set has a run, the UI SHALL show the set's declared dataset names there.
- R22. A successful start SHALL record a run with status `running`, the set's id and name, the question ids, the datasets in scope and the total, and answer with the run's job id.

Running and progress
- R23. A run SHALL execute the questions one at a time, in set order, never in parallel, against the datasets in scope.
- R24. Each question SHALL run the assistant exactly as a chat turn would: scoped to the datasets, with the same orientation block (entities and join hints), the same curated knowledge block ([../knowledge/spec.md](../knowledge/spec.md)) and the same 15-step budget, in a throwaway session so that visual tools work. The throwaway session SHALL be deleted when the run ends, success or failure.
- R25. The system SHALL record each question's result as soon as it finishes, fold it into the run's token total and category tallies (R46, R47), and SHALL persist the run after every question, so a crash mid-suite keeps the finished questions and what they cost.
- R26. While running, the UI SHALL poll the run every 1.5 seconds and show "<finished>/<questions in the open set> done · <passed> passed", mark the current question "running", and mark finished questions "passed" or "failed" with each check's score beside its chip. A failed question SHALL also show its run error, if any.
- R27. A run SHALL end `completed` when every ticked question has a result (including failed ones), or `failed` with an error message if the run itself broke. Either way it SHALL get a finish time, the model it ran on and its estimated cost (R46), and a run log (R48).
- R28. At most one run SHALL be active per agent. Leaving the agent view SHALL stop the UI polling, not the run.

Scoring
- R29. A question SHALL pass only if it has at least one check and every check scores exactly 1. A question whose run threw an error SHALL fail with no check results and the error text. Per-check results SHALL carry the check's id, description, score, verdict and, on failure, a reason in plain words, for example `expected "Argentina" in the answer — answer was "…"` or `expected "run_readonly_sql" to be called 1×, it was called 0×`.
- R30. The system SHALL offer these kinds of check, combined per question; a question SHALL use each kind at most once, because check results are keyed by kind:
  - answer text includes, excludes, equals or matches (a regular expression, optionally case-insensitive) a value;
  - a named tool was called (optionally an exact number of times) or was not called, tools were called in a given order, no tool was called at all, or at most N tool calls were made;
  - no tool call returned an error;
  - **result-set match** (id `result-set-match`, "Result set matches expectedSql (primary correctness signal)"), for questions with a reference query;
  - **LLM judge** (id `llm-judge`, "LLM judge: <rubric>"), for questions whose quality a text match is too brittle to judge.
- R31. The result-set match SHALL run the reference query read-only on the datasource (at most 500 rows; a truncated reference fails the check) and compare it with every successful, complete, untruncated `run_readonly_sql` result the assistant produced. It SHALL pass if any single result matches all reference facts. Comparison SHALL ignore column names, column order and row order, normalise numbers to six significant digits and text to trimmed, case-folded form, and tolerate extra columns in the assistant's result but not missing ones; results from different queries SHALL NOT be combined and extra rows SHALL NOT be ignored. A question can ask for distinct facts only, in which case repeated identical rows are harmless. With no successful query the check fails: "the agent ran no successful run_readonly_sql to compare".
- R32. The LLM judge SHALL be given the question, the rubric, the ordered tool calls (name, input, output, error) and the final answer, and SHALL return a pass or fail with a one- or two-sentence reason. It SHALL run on the same configured model as the assistant, one step, no tools. A judge that errors or returns unparseable output SHALL score 0 with a reason beginning `judge error:` rather than aborting the run. It SHALL pass only when the rubric is clearly satisfied.
- R33. Tool inputs and outputs recorded in a trace SHALL be truncated to 2,000 characters each, marked "… (truncated)". If a tool-only turn produced no prose, the reported answer SHALL be synthesised from what the tools returned.

Executions, details and report
- R34. The **Executions** sub-tab SHALL list past and in-flight runs of the agent, newest first, loaded when the sub-tab opens ("Loading executions…"; empty: "No eval runs yet — run the suite from the Questions tab."). The sub-tabs SHALL be shown whenever the agent has sets (or the Executions tab is open).
- R35. Each execution SHALL show a status icon (spinner while running, green check when all questions passed, red cross otherwise), "<passed>/<total> passed", "<start time> · <set name> · <datasource name> · <duration>" (duration "—" until finished, milliseconds under a second, else whole seconds; the set name falls back to the set id, then to "unknown suite" for runs recorded before sets were stored) and the run's tokens: "<compact total> tokens" (one decimal in thousands or two in millions, for example "41.2k tokens", "1.24M tokens") or "tokens not measured" (R46). Expanding it SHALL show "<set name> · scoped to <datasets>", the blocks of R49, and one row per finished question with its verdict and duration; clicking a row SHALL open that question's result in the Details panel.
- R36. Each execution SHALL offer a download button (**Download as Markdown**) and, once it is no longer running, a delete button. Deleting a run that is still going SHALL be refused ("Cannot delete a run that is still going"); deleting a finished one SHALL remove it permanently ("Run deleted"). Download success SHALL show the toast "Eval report downloaded"; failure "Could not download the report" (or the backend's message).
- R37. The Details panel SHALL show, for the selected question: the question and its intent. When it has not been run: "Checks it will be scored on" (the check descriptions) and "Run the evals to see the steps the agent executed for this question." When it has a result: the verdict (Passed or Failed) and duration, followed, when the provider reported tokens for that question, by "<compact total> tokens" whose tooltip reads "<input> in / <output> out over <calls> model calls"; "Run error" or "Why it failed" (each failed check with its reason); every check with its score; "Executed steps" (each tool call in order, numbered, with its input and output or error, or "The agent answered without calling any tool."); and the final "Answer" (or "The agent returned no text."). With nothing selected it SHALL say "Select a question in the Evals tab to see how it ran." Selection SHALL clear when the agent changes or the view closes, and SHALL follow the newest result while a run is in progress.
- R38. The Markdown report of a run SHALL contain, in order: `# Eval run — <agent key>`; "**<passed>/<total> questions passed**"; a list of started, finished, duration, status, suite (the set name, else its id, else "—"), datasource name, datasets and run id; a "Run error" quote when the run failed; `## Summary` (a table of number, question, result, duration); `## By category` (a table of category, passed, cases and pass rate as a whole percentage, categories in alphabetical order, taken from the run's tallies or recomputed from its results; omitted when no result carries a category); `## Tokens and cost` only when the run has a token record (R46; a run whose provider reported nothing has none): the model when known, then either a table of input, output and total tokens and model calls (thousands grouped), a line "Of which <n> cached input and <n> reasoning tokens." when either is non-zero, and "**Estimated cost:** $<amount to 4 decimals>" or "**Estimated cost:** not priced — add the model to `logs/pricing.json`.", or, for a record with zero observed calls, a note that the provider reported no token usage, which is "not measured", not "free"; `## Compared to previous run` (R40) when there is a comparison; `## Failures at a glance` when anything failed (each failed question with its failed-check reasons or run error); and `## Questions`, one section per finished question with result, id, category (when known), duration, a checks table (check, score, why), `#### Executed steps` (each tool call with input and output or error in fenced blocks) and `#### Answer`. Fences inside payloads SHALL be neutralised. The server SHALL name the file `eval-run-<agent>-<start date and time>-<8-character run id>.md` and send it as a Markdown attachment.
- R39. Downloading a run that does not exist SHALL fail with `Eval run "<id>" not found` (HTTP 404); polling one SHALL answer with ok false and the same message.

Regression comparison
- R40. When a run completes, the system SHALL compare its per-question verdicts with the most recent earlier completed run of the same agent, same set, same datasource and same set of datasets (order ignored), matching by question id; a run recorded before sets were stored counts as a `world-cup` run. It SHALL record the previous run's id and three lists, each of id and question: **regressions** (passed before, failing now), **improvements** (failed before, passing now) and **unchanged**. Questions present in only one of the two runs SHALL be skipped. With no comparable earlier run no comparison SHALL be recorded; runs saved before this feature have none. A failure while comparing SHALL NOT fail the run.
- R41. The report SHALL show the comparison as `## Compared to previous run` with "Compared to run `<previous id>`."; "No change from the previous run." when there are neither regressions nor improvements; otherwise "**Regressions** (passed before, now failing):" and/or "**Improvements** (failed before, now passing):", each item as `<id> — <question>`.

Other entry points
- R42. Any set SHALL also be runnable without the UI from the command line against named datasets (the set chosen by id, `world-cup` when none is named; progress per question, a final "<passed>/<total> questions passed" line, exit code 0 only when all pass), using the same preflight, scoring, throwaway session and knowledge block. This entry point records no run, no token totals and no run log.

Categories
- R43. Every case SHALL carry a category: the failure class it probes (glossary *Eval category*). The categories in use are `control` (a healthy baseline that must keep passing), `ratio-trap`, `constant-column`, `empty-column`, `ties`, `value-vocabulary`, `out-of-scope`, `clarification`, `id-vs-name`, `metric-definition`, `default-filter`, `multi-step-join`, `discovery`, `unit-confusion`, `domain-semantics` and `quality-filter`. A set definition with a case lacking a category SHALL fail to load; the vocabulary itself is a convention the system does not check. Each question result SHALL keep the category it ran with, so an old run stays interpretable after the set changes.
- R44. When the open set's questions carry categories, the system SHALL offer a category filter whose first option is "All categories (<N>)" (N = questions in the set) followed by each category present in the set, alphabetically, as "<category> (<count>)". Picking a category SHALL show only that category's questions (numbered from 1) and append " · showing <k>" to the selected count. The filter SHALL NOT change which questions are ticked: the run button and the run cover every ticked question of the set, shown or not. When no question is shown the list SHALL read "No questions in this category."

Set definitions
- R45. Sets SHALL be data, one definition per set (format and validation in [../../system/data-model.md](../../system/data-model.md)), re-read on every listing so an edited definition shows without a restart. A definition SHALL be rejected when read, with a message naming the definition and the case at fault, when a required field is missing or empty, a check is of an unknown kind or lacks its argument, a regular expression does not compile, a case uses the same kind of check twice (R30), a case id repeats within the set, the named bundled sample is unknown, or it repeats what the sample catalogue owns (required entities, datasource kind). Expected reasoning and learning scenarios are validated strictly: an unknown field, a table not written `schema.table`, an assumption phrase with no word of four or more letters, an unknown block or vote, or a generalisation case that is missing, is the case itself, or carries a scenario of its own also fails the load. A set MAY be derived from another, non-derived set: it takes the base set's questions, categories, checks and rubrics, prefixes every case id, and replaces only the reference queries; every base case with a reference query SHALL have a replacement, and a replacement for a case the base does not have SHALL fail the load. A set that cannot be read SHALL NOT run.

Token accounting and run logs
- R46. The system SHALL record, per question, the tokens the provider reported for the assistant's run (every step of it) plus the LLM judge's call when the question has a rubric: input, output, total (input + output unless the provider reports its own total), reasoning and cached-input tokens, and the number of model calls observed. Counts SHALL be measured, never estimated: a question for which the provider reported nothing SHALL carry no usage, and a question whose run threw SHALL keep what was observed before the error. The answer synthesised after a tool-only turn is not counted. The run SHALL carry the sum of its questions' usage, updated after every question; a run with zero observed calls is "not measured", never "free". When the run ends the system SHALL record the model the agents actually ran on (the currently configured model when none was observed) and an estimated cost in US dollars from an operator-maintained price table that ships empty (per model: input, output and optional cached-input dollars per million tokens; cached input tokens are billed at the cached rate; a model is matched by its full id or by the part after its last "/", case-insensitively). A model with no rate, or a run with nothing measured, SHALL have no cost, and neither the UI nor the report SHALL ever show such a run as "$0.00".
- R47. A run SHALL carry, per category, the number of questions run and the number passed, recomputed after every question; a question whose run threw counts as not passed, a result without a category counts under `uncategorised`, and questions the run never reached are not counted.
- R48. When a run ends, completed or failed, the system SHALL write a run log record and append a one-line summary to the run index ([../../system/data-model.md](../../system/data-model.md)). Logging SHALL be best effort: with no writable log location (an installed app outside a source checkout, unless one is configured) or a failed write, the run is unaffected and a warning says it was not logged.

Executions detail
- R49. An expanded execution SHALL show, in order: when the run has a comparison (R40), "Compared to the previous run" with either "No change from the previous run · <N> questions held their verdict" or a "Regressions (<n>)" list and/or an "Improvements (<n>)" list, each item `<id> — <question>`; when it has category tallies, "Pass rate by category", one row per category, worst rate first (ties: more questions first, then alphabetical), each with "<passed>/<total>" and a whole percentage coloured green at 100 %, red below 50 % and amber in between; and "Tokens and cost": "Model" (or "unknown"), then "Input", "Output", "Total" and "Model calls" (exact, thousands grouped), "Cached input" and "Reasoning" when non-zero, or "Tokens: not measured", and "Estimated cost": the amount in US dollars (four decimals under one cent, two otherwise), "not priced — add the model to logs/pricing.json" when tokens were measured but the model has no rate, or "not measured".

Developer harness
- R50. A developer harness SHALL run one set, or a case file of the same shape, as real streamed chat turns in throwaway sessions and grade each case by result-set comparison alone: a case without a reference query is skipped (`SKIP(no-expected-sql)`), never guessed. Its turns never use answer pinning ([answer-pinning](../answer-pinning/spec.md) R1), so a repeat measures the engine, not a replay. It SHALL grade the answer query ([sessions-chat](../sessions-chat/spec.md) R52) width-tolerantly first. When that does not match, it SHALL re-run each of the answer's other complete, successful queries and pass the case as `PASS(alternate-query)` if one matches, because a headline total and its breakdown, or a rate and its parts, are both correct. A case marked percent-equivalent SHALL also accept the assistant's numbers scaled by 100 or by 1/100, so a rate may be reported as a fraction or a percentage. With the expert option every turn runs in business expert mode and the run reports confidence measurements ([business-expert](../business-expert/spec.md) R31). It SHALL accept a case-id substring filter, a category substring filter (an unmatched filter lists the categories present), a repeat count (a case passes only when every repetition passes, reported as `k/n`), a free-text label and the expert option (not combinable with the validate mode); it SHALL print a verdict table, a per-category pass-rate table worst first and the run's measured tokens and estimated cost (R46, read from the persisted answers), write a run log unless told not to (R48), and exit non-zero when any case failed or errored.
- R51. The same harness SHALL offer a validate mode that runs every reference query of the selected cases against the live data with zero model calls and no LLM configuration (cases without one are reported as skipped), reporting each as OK (rows returned), EMPTY (no rows: a warning, still passing), TOO-MANY (at or above the 500-row cap: failing) or ERROR (the query failed: failing), writing a run log with no usage unless told not to, and exiting non-zero on any failure.

### Eval suite content

The questions, checks, reference queries and judge rubrics below are a data asset copied verbatim on rebuild (*Data assets* in [../../README.md](../../README.md)); the tables summarise them. Every expected value is a fact of the fixture's data.

World Cup set (`world-cup`, over the bundled World Cup sample, declared dataset "World Cup"). The REST set `world-cup-rest` is not written out: it is derived from this set (R45) with id prefix `rest-`, the same categories, checks and rubrics, and the five reference queries (`champion-2022`, `final-score-2018`, `top-scorer-2022`, `shootouts`, `biggest-venue`) ported to the REST sample's dialect over `api.world_cup.*`; its dataset defaults to the sample's "World Cup (REST)".

| id | Category | Question | What must hold |
|---|---|---|---|
| `champion-2022` | control | Who won the 2022 World Cup? | answer includes "Argentina"; ran SQL; no tool errors; result-set match |
| `final-score-2018` | multi-step-join | What was the score of the 2018 World Cup final? | matches 4-2 (any dash or colon); includes "France"; ran SQL; no tool errors; result-set match |
| `top-scorer-2022` | metric-definition | Who scored the most goals in the 2022 World Cup, and how many? | includes "Messi"; contains 4; ran SQL; no tool errors; result-set match |
| `shootouts` | domain-semantics | Which knockout matches went to a penalty shootout, and who advanced? | includes "Croatia"; mentions Argentina; ran SQL; no tool errors; result-set match |
| `biggest-venue` | ties | Which stadium hosted the best-attended match, and what was the attendance? | includes "Lusail"; matches 88,966 (any separator); ran SQL; no tool errors; result-set match on distinct facts |
| `schema-discovery` | discovery | What data do I have available to analyse? | called `list_entities`; includes "matches"; did not call `run_readonly_sql`; no tool errors |
| `ambiguous-best-team` | clarification | Which team performed best? | called `ask_clarification`; no SQL; no tool errors; judge: the answer is itself a clarifying question with 2 to 4 concrete options grounded in the data and states no figures as the answer |
| `possession-vs-result` | multi-step-join | In the 2022 knockout rounds, did the team with more possession usually win? | ran SQL; mentions possession or %; no tool errors; judge: concludes no, backed by counts consistent with 2 won and 6 lost of 8 |
| `out-of-scope` | out-of-scope | How many goals did Pelé score in the 1970 World Cup? | no tool errors; judge: says it cannot answer for 1970, states the data covers 2018 and/or 2022, invents no figure |
| `visual-request` | control | Chart the goals scored by each team in the 2022 knockout stage. | tools called in order `run_readonly_sql` then `create_visual`; called `create_visual`; no tool errors; judge: a visual tool succeeded and plausibly charts goals per team for the 2022 knockouts |

Formula 1 set (`formula-1`), ids all prefixed `f1-`:

| id | Category | Question | What must hold |
|---|---|---|---|
| `f1-champion-2023` | control | Who won the 2023 Formula 1 drivers' championship, and how many points did they finish on? | includes "Verstappen"; contains 575; ran SQL; no tool errors; result-set match |
| `f1-british-gp-2023` | multi-step-join | At which circuit was the 2023 British Grand Prix held, and how many laps did the race run to? | includes "Silverstone"; contains 52; ran SQL; no tool errors; result-set match |
| `f1-most-race-wins` | metric-definition | Which driver has won the most Grands Prix in Formula 1 history, and how many did they win? | includes "Hamilton"; contains 106; ran SQL; no tool errors; result-set match |
| `f1-most-titles-tie` | ties | Which drivers have won the most Formula 1 drivers' championships, and how many each? | includes "Schumacher"; mentions Hamilton; ran SQL; no tool errors; result-set match |
| `f1-monaco-2024-podium` | domain-semantics | Who finished on the podium at the 2024 Monaco Grand Prix? | includes "Leclerc"; mentions Piastri; ran SQL; no tool errors; result-set match |
| `f1-schema-discovery` | discovery | What Formula 1 data do I have available to analyse? | called `list_entities`; includes "driver"; no SQL; no tool errors |
| `f1-ambiguous-dominant-driver` | clarification | Which driver was the most dominant? | called `ask_clarification`; no SQL; no tool errors; judge as for `ambiguous-best-team`, over race wins, championships, poles, points, and a season or era |
| `f1-pole-to-win-2023` | multi-step-join | In the 2023 season, did the driver who started on pole usually go on to win the race? | ran SQL; mentions pole or grid; no tool errors; judge: concludes yes, backed by counts consistent with 14 of 22 |
| `f1-out-of-scope-motogp` | out-of-scope | Who won the 2023 MotoGP world championship? | no tool errors; judge: says it cannot answer, states the data is Formula 1 only (1950 to 2026), names no MotoGP champion |
| `f1-visual-request` | control | Chart the total points scored by each constructor in the 2023 season. | tools in order `run_readonly_sql` then `create_visual`; called `create_visual`; no tool errors; judge: a visual tool succeeded and plausibly charts constructor points for 2023 |

Health Insurance set (`health-insurance`, 20 questions). Not a bundled sample: a synthetic regional health plan in schema `health_insurance` (claims dated 2024 and 2025 only, money stored as integer cents, claim statuses `PAID` / `DENIED` / `PENDING` / `REVERSED`, test claims flagged `is_test`), generated from a fixed seed so every value is reproducible. The set declares the dataset "Health Insurance" and these required entities: `health_insurance.countries`, `states`, `regions`, `plans`, `members`, `providers`, `claims`, `claim_lines`, `denial_reasons`, `claim_denials`, `v_claim_financials`, `v_member_claim_totals`. Its description (the preflight setup sentence) reads "These evals require the bundled synthetic health-insurance fixture (schema health_insurance). Select its PostgreSQL datasource and save a dataset named Health Insurance containing the health_insurance tables and views. Setup: docker/postgres/README.md." Registering the development fixtures ([../../system/delivery.md](../../system/delivery.md)) also saves the curated context the `metric-definition`, `default-filter` and `unit-confusion` questions rely on: the metric "Net paid" (paid minus reversed), the default filter "Exclude test claims" and the term "Amounts are stored in cents". Reference queries apply those default filters, so an assistant that uses the curated knowledge is not failed for it. Judged questions: `claims-by-currency` (states the single currency USD, so there is no breakdown), `payouts-2019` (no 2019 data; states the data covers 2024 and/or 2025; invents nothing), `most-expensive-member` (a clarifying question over billed, allowed, paid or member-owed amounts; names no member).

| id | Category | Question | What must hold |
|---|---|---|---|
| `paid-share-by-specialty` | ratio-trap | Which specialties are we paying the highest share of what they bill? | includes "Family Medicine"; matches `0\.48[45]\|48\.[45]`; ran SQL; no tool errors; result-set match |
| `plan-share-of-allowed-by-tier` | ratio-trap | On the claims we paid, what share of the allowed amount did the plan cover rather than the member, by plan tier? | includes "PLATINUM"; matches `0\.86[56]\|86\.[56]`; ran SQL; no tool errors; result-set match |
| `claims-by-currency` | constant-column | How do our claims break down by currency? | includes "USD"; ran SQL; no tool errors; result-set match; judge |
| `claims-with-preauth` | empty-column | How many claims had a prior authorization on file? | includes "57"; ran SQL; no tool errors; result-set match |
| `specialties-with-48-claims` | ties | Which specialties submitted exactly 48 claims? | includes "Oncology"; matches `\bEmergency Medicine\b`; ran SQL; no tool errors; result-set match |
| `approved-claims-2024` | value-vocabulary | How many claims were approved in 2024? | includes "395"; matches `PAID`; ran SQL; no tool errors; result-set match |
| `payouts-2019` | out-of-scope | What did we pay out in claims in 2019? | no tool errors; judge |
| `most-expensive-member` | clarification | Who is our most expensive member? | called `ask_clarification`; no SQL; no tool errors; judge |
| `member-with-most-claims` | id-vs-name | Which member filed the most claims, and how many? | includes "Naomi Sedgewick"; matches `\b42\b`; ran SQL; no tool errors; result-set match |
| `net-paid-by-region-2024` | metric-definition | What was our net paid by region in 2024? | includes "Gulf Coast Texas"; matches `6[,.]?318[,.]?595\|63[,.]?185`; ran SQL; no tool errors; result-set match |
| `net-paid-after-reversals-2024` | domain-semantics | How much did we actually pay out in 2024 once reversals are taken off? | matches `29[,.]?127[,.]?007\|291[,.]?270`; matches `revers` (case-insensitive); ran SQL; no tool errors; result-set match |
| `claims-march-2024` | default-filter | How many claims do we have for March 2024 dates of service? | includes "35"; matches `test\|synthetic` (case-insensitive); ran SQL; no tool errors; result-set match |
| `paid-by-country` | multi-step-join | What have we paid out in each country? | includes "Canada"; matches `58[,.]?862[,.]?147\|588[,.]?621`; ran SQL; no tool errors; result-set match |
| `denial-data-discovery` | discovery | What data do we have about denials? | called `list_entities`; matches `claim[ _]denials` (case-insensitive); matches `denial[ _]reasons` (case-insensitive); no SQL; no tool errors |
| `avg-paid-per-claim-dollars` | unit-confusion | What was the average amount we paid per claim, in dollars? | includes "561.62"; ran SQL; no tool errors; result-set match |
| `units-cut-by-procedure` | ratio-trap | Which procedure codes had the most units cut on review? Show the top five. | includes "J9299"; matches `\b602\b`; ran SQL; no tool errors; result-set match |
| `denial-rate` | quality-filter | What's our denial rate? | includes "19.8"; matches `pending` (case-insensitive); ran SQL; no tool errors; result-set match |
| `active-members-by-region` | default-filter | How many active members do we have in each region? | includes "Gulf Coast Texas"; matches `\b10\b`; ran SQL; no tool errors; result-set match |
| `members-per-plan-tier` | control | How many members are enrolled on each plan tier? | includes "BRONZE"; matches `\b22\b`; ran SQL; no tool errors; result-set match |
| `providers-per-specialty` | control | How many providers do we have in each specialty? | includes "Family Medicine"; matches `\b5\b`; ran SQL; no tool errors; result-set match |

Genomics set (`genomics`, 20 questions). Not a bundled sample: a synthetic clinical-genomics cohort in schema `genomics` (samples collected 2023 and 2024 only, control samples flagged `is_control`, genotype `0/0` meaning the sample does not carry the variant, a TPM of 0 being a real measurement), generated from a fixed seed; it must never be used clinically. The set declares the dataset "Genomics" and these required entities: `genomics.superpopulations`, `ancestry_groups`, `genes`, `subjects`, `samples`, `variants`, `variant_calls`, `gene_expression`, `v_variant_calls`, `v_sample_qc`. Its description reads "These evals require the bundled synthetic genomics cohort (schema genomics). Select its PostgreSQL datasource and save a dataset named Genomics containing the genomics tables and views. Setup: docker/postgres/README.md." Registration also saves the metric "Allele fraction" (mean alt/total reads on `PASS` calls with depth of at least 20), the default filter "Exclude control samples" and the term "Genotype 0/0 is not a carrier"; reference queries apply the default filter. Judged questions: `variants-by-assembly` (states the single assembly GRCh38, so there is no breakdown), `samples-sequenced-2015` (no 2015 data; states the data covers 2023 and/or 2024; invents nothing), `most-important-gene` (a clarifying question over total or pathogenic variants, calls, carriers or expression; names no gene).

| id | Category | Question | What must hold |
|---|---|---|---|
| `allele-fraction-by-gene` | ratio-trap | Which five genes show the highest average alternate-allele fraction? | includes "MUTYH"; matches `0\.53\|53\.2`; ran SQL; no tool errors; result-set match |
| `variants-by-assembly` | constant-column | How do our variants break down across genome assemblies? | includes "GRCh38"; ran SQL; no tool errors; result-set match; judge |
| `variants-with-rsid` | empty-column | How many of our variants have a dbSNP rsID? | includes "46"; ran SQL; no tool errors; result-set match |
| `genes-with-seven-pathogenic` | ties | Which genes carry exactly seven pathogenic variants? | includes "MLH1"; matches `\bPTEN\b`; ran SQL; no tool errors; result-set match |
| `damaging-variant-count` | value-vocabulary | How many damaging variants did we find? | includes "149"; matches `likely[_ ]pathogenic` (case-insensitive); ran SQL; no tool errors; result-set match |
| `samples-sequenced-2015` | out-of-scope | How many samples did we sequence in 2015? | no tool errors; judge |
| `most-important-gene` | clarification | Which gene matters most in this cohort? | called `ask_clarification`; no SQL; no tool errors; judge |
| `most-called-genes` | id-vs-name | Which genes were called most often across our samples? Show the top five. | includes "CFTR"; matches `566`; ran SQL; no tool errors; result-set match |
| `mean-allele-fraction` | metric-definition | What is our mean allele fraction, and how many calls is it based on? | matches `0\.4[12]\|41\.[56]`; ran SQL; no tool errors; result-set match |
| `cohort-sample-count` | default-filter | How many samples do we have in the cohort? | includes "125"; ran SQL; no tool errors; result-set match |
| `subjects-by-superpopulation` | multi-step-join | How many subjects do we have in each superpopulation? | includes "African"; matches `\b36\b`; ran SQL; no tool errors; result-set match |
| `expression-data-discovery` | discovery | What expression data do we have? | called `list_entities`; matches `gene[ _]expression` (case-insensitive); no SQL; no tool errors |
| `pathogenic-carrier-samples` | domain-semantics | How many samples carry a pathogenic variant? | includes "67"; ran SQL; no tool errors; result-set match |
| `pathogenic-carriers-by-gene` | domain-semantics | Which genes have the most subjects carrying a pathogenic variant? Show the top three. | includes "TP53"; matches `\bAPC\b`; ran SQL; no tool errors; result-set match |
| `mean-expression-by-gene` | domain-semantics | What is the average expression of BRCA1, TP53, ATM, EGFR and CFTR across our samples? | includes "ATM"; matches `97\.1\|\b97\b`; ran SQL; no tool errors; result-set match |
| `genes-silent-in-most-samples` | domain-semantics | Which genes are silent in more than half of our samples? | includes "F8"; matches `\bRET\b`; ran SQL; no tool errors; result-set match |
| `high-confidence-calls` | quality-filter | How many of our variant calls are high-confidence? | matches `3[,.]?943`; includes "PASS"; ran SQL; no tool errors; result-set match |
| `coverage-by-assay` | unit-confusion | What is the average sequencing coverage for each assay type? | includes "PANEL"; matches `408`; ran SQL; no tool errors; result-set match |
| `variants-by-type` | control | How many variants of each type do we have? | includes "SNV"; matches `371`; ran SQL; no tool errors; result-set match |
| `samples-per-collection-year` | control | How many samples did we collect in each year, counting every sample on record, controls included? | includes "2023"; matches `\b68\b`; ran SQL; no tool errors; result-set match |

HR set (`hr`, 10 questions), the measuring set of business expert mode ([business-expert](../business-expert/spec.md) R31). Not a bundled sample: a synthetic company in schema `hr` with employees, departments grouped into divisions, locations paid in three currencies, salary history, bonuses booked to a fiscal year, performance reviews, time off and a three-level reporting line, for 2019 to 2025. It is generated from a fixed seed.
- **Declared dataset:** "HR".
- **Required entities:** `hr.departments`, `locations`, `job_titles`, `employees`, `salary_history`, `bonus_payments`, `performance_reviews`, `time_off_requests`, `exchange_rates`, `v_current_employees`, `v_salary_by_year`.
- **Description (the preflight setup sentence):** "These evals require the bundled synthetic HR fixture (schema hr). Select its PostgreSQL datasource and save a dataset named HR containing the hr tables and views. Setup: docker/postgres/README.md."
- **Curated context saved by registering the development fixtures** ([../../system/delivery.md](../../system/delivery.md)):
  - the default filters "Employees only" and "Active as of a date";
  - the terms "Tech employees" (the Technology division, not a job family), "Salary" (the row in force on 31 December), "Local currency", "Top performer" (rating 4 or 5) and "Total compensation";
  - the metrics `avg_base_salary_usd`, `attrition_rate` and `total_compensation_usd`.
- Every case carries expected reasoning (tables, assumption phrases, and for four of them a metric). `attrition-rate-2025` is percent-equivalent.

| id | Category | Question | What must hold |
|---|---|---|---|
| `avg-salary-tech-2025` | domain-semantics | What is the average salary of tech employees in 2025? | matches `127[,.]?52[01]\|127[.,]5\s?[kK]`; ran SQL; no tool errors; result-set match |
| `active-headcount-end-2025` | control | How many active employees did we have at the end of 2025? | matches `\b106\b`; ran SQL; no tool errors; result-set match |
| `dept-most-headcount-2025` | ties | Which department had the most active employees at the end of 2025? | includes "Engineering"; matches `\bSales\b`; ran SQL; no tool errors; result-set match |
| `total-bonus-2024-usd` | unit-confusion | How much did we pay out in bonuses for fiscal year 2024, in USD? | matches `1[,.]?761[,.]?34[01]\|1[.,]76\s?(M\b\|million)`; ran SQL; no tool errors; result-set match |
| `avg-total-comp-sales-2024` | metric-definition | What was the average total compensation for Sales employees in 2024? | matches `121[,.]?899\|121[.,]9\s?[kK]`; ran SQL; no tool errors; result-set match |
| `attrition-rate-2025` | metric-definition | What was our attrition rate in 2025? | matches `\b11[.,]54?(?![0-9])\|0[.,]1154`; ran SQL; no tool errors; result-set match |
| `top-performers-engineering-2025` | domain-semantics | Who were the top performers in Engineering in 2025? | includes "Kenji Umarov"; matches `Luca Fontaine`; excludes "Noah Gallagher"; ran SQL; no tool errors; result-set match |
| `reports-to-manager` | clarification | How many people report to Helena Voss? | called `ask_clarification`; no SQL; no tool errors; judge: the answer is itself a clarifying question offering at least direct reports versus her whole reporting line (optionally whether to count contractors and interns), and states no headcount |
| `highest-avg-salary-location-2025` | unit-confusion | Which location had the highest average salary in 2025? | includes "London"; matches `133[,.]?48[67]\|133[.,]5\s?[kK]`; ran SQL; no tool errors; result-set match |
| `avg-promotion-raise-2025` | multi-step-join | What was the average raise from promotions in 2025? | matches `\b11[.,]72?(?![0-9])\|0[.,]1172`; ran SQL; no tool errors; result-set match |

Retail set (`retail`, 6 questions), the teaching set of business expert mode ([business-expert](../business-expert/spec.md) R33). Not a bundled sample: a synthetic retailer in schema `retail` with 6 stores (one online), products in 8 categories, customers, orders from 2024-01-01 to 2026-03-31 that are completed or cancelled, and order lines with quantity, unit price and line discount. It is generated from a fixed seed. The right answer to its flagship question rests on two facts nothing in the data reveals:
- the fiscal year runs from 1 February to 31 January and is named for the year it starts;
- net revenue is the sum of quantity × unit price − line discount over completed orders, never `orders.amount_charged`, which includes sales tax and web shipping.

The rest of the set:
- **Declared dataset:** "Retail".
- **Required entities:** `retail.stores`, `products`, `customers`, `orders`, `order_lines`.
- **Description:** "These evals require the bundled synthetic retail fixture (schema retail). Select its PostgreSQL datasource and save a dataset named Retail containing the retail tables. Setup: docker/postgres/README.md."
- **Curated context saved by registration:** the default filter "Completed orders only" and the entries "Order date", "Units", "Line discount" and "Coverage". It deliberately states neither the fiscal calendar nor net revenue: those are what the learning scenario teaches.
- Every case carries expected reasoning.
- `net-revenue-fy2025` carries the learning scenario: two thumbs-down notes, on its interpretation (the fiscal calendar, applied only when a question says fiscal year or FY) and on its metric (the net-revenue definition). It must generalise to `orders-fy2025`, and its band is expected to move from medium to high.

| id | Category | Question | What must hold |
|---|---|---|---|
| `net-revenue-fy2025` | domain-semantics | What was our net revenue in fiscal year 2025? | matches `401[,.]?306\|401(?:[.,]3)?\s?[kK]`; ran SQL; no tool errors; result-set match |
| `orders-fy2025` | domain-semantics | How many orders did we take in fiscal year 2025? | matches `\b3[,.]?068\b`; ran SQL; no tool errors; result-set match |
| `top-category-units-march-2025` | control | Which product category sold the most units in March 2025? | includes "Outdoor"; matches `\b92\b`; ran SQL; no tool errors; result-set match |
| `gross-charged-cy2025` | control | How much did we charge customers in total in calendar year 2025? | matches `423[,.]?385\|423(?:[.,]4)?\s?[kK]`; ran SQL; no tool errors; result-set match |
| `new-customers-2025` | control | How many new customers signed up in 2025? | matches `\b530\b`; ran SQL; no tool errors; result-set match |
| `net-revenue-by-store-fy2025` | domain-semantics | What was net revenue by store in fiscal year 2025? | includes "Web Store"; matches `162[,.]?61[12]\|162(?:[.,]6)?\s?[kK]`; ran SQL; no tool errors; result-set match |

## Edge cases and errors

- Starting with zero ticked questions is blocked in the UI (button disabled); a direct request with an explicit empty list SHALL NOT be read as "run everything": it is refused with "Pick at least one question to run" when it names a set, and with "No question set matches the selected questions, …" when it does not. A request that names a set but no list runs every question of that set; a request with neither fails with "The selected questions span several sets (formula-1, genomics, health-insurance, hr, retail, world-cup, world-cup-rest) — run one set at a time."
- A request naming a set that does not exist fails with `Unknown eval suite "<id>"…` before the datasource's datasets are read.
- A run started while another is active for the agent is refused with the conflict message; the UI shows it under the run controls.
- A dataset-less datasource: "has no datasets" message, no run recorded, Executions stays empty ("No eval runs yet").
- A dataset containing only part of the set's required entities: "Missing entities: …" listing every required entity not found, no run recorded.
- Starting needs the set's own datasource kind: the REST set against a PostgreSQL datasource fails with "The selected datasets must belong to one REST API datasource."
- A datasource carrying several fixtures (for example the three development fixtures registered on one datasource): a run sees only the open set's declared datasets, so a genomics question cannot be answered from World Cup or health-insurance tables.
- A datasource whose datasets are named differently from the set's declared names: the run falls back to every dataset bound to it and the preflight decides; before the run the open set still shows its declared names as "Scoped to …" (see Open questions).
- A set definition that fails validation: running that set is refused with the validation message (R45). While any definition is invalid, the set list is empty and the Evals tab shows "No evals configured for this agent yet." (see Open questions).
- The provider reports no token usage: questions carry none, the run has no token record, the execution shows "tokens not measured" and "Estimated cost: not measured", and the report has no "Tokens and cost" section; nothing reads as free.
- Tokens are measured but the model has no rate in the price table: exact counts are shown and the cost reads "not priced — add the model to logs/pricing.json".
- No writable run-log location (an installed app outside a source checkout, with no log location configured), or a failed write: the run completes normally and a warning records that it was not logged.
- A run recorded before sets, categories or token accounting existed: the Executions row shows "unknown suite" and "tokens not measured", the expanded view has no category block, the report has no "By category" or "Tokens and cost" section, and the run is compared as a `world-cup` run.
- Two checks of the same kind on one question collide, because check results are keyed by kind (R30), so they are not graded independently; see Open questions for the shipped questions that do this.
- Backend unreachable while starting or polling: the run box shows "Backend unreachable" and the UI state becomes failed or idle; the run, if it started, continues on the backend and later appears under Executions.
- A failed individual question (model error, tool crash) records a run error on that question and the run continues with the next.
- If the backend stops while a run is going, the run was persisted after its last finished question and stays marked `running` in history (see Open questions).
- A question present in an old run but no longer in the suite (the suite changed) is not clickable from the Executions list (no details to open).

## Contracts

- Endpoints `GET /agents`, `GET /agents/:key`, `GET /agents/:key/evals`, `POST /agents/:key/evals/run`, `GET /agents/:key/evals/runs`, `GET|DELETE /agents/:key/evals/runs/:jobId`, `GET /agents/:key/evals/runs/:jobId/download`: [../../system/api.md](../../system/api.md).
- Eval run documents (run, per-question result, check result, tool call, regression summary, token usage, category tallies), the set definition format, the run log and index, and the price table: [../../system/data-model.md](../../system/data-model.md).
- The eight agents, the assistant's tools and memory settings, the judge's prompt and how a case is executed and scored: [../../system/agents.md](../../system/agents.md).
- Sample fixtures and their required entities: [../testing-data/spec.md](../testing-data/spec.md).
- The development fixtures database (World Cup, health insurance, genomics, HR, retail), their seeded generators, the registration script, the harness scripts and the learning demo: [../../system/delivery.md](../../system/delivery.md).
- Copy and layout of the Evals tab and the eval trace: [../../system/ui.md](../../system/ui.md).
- Terms: [../../product/glossary.md](../../product/glossary.md).

## UI

Main view "Agents" and an agent's detail view, with the Details panel on the right ([../../system/ui.md](../../system/ui.md), [../app-shell/spec.md](../app-shell/spec.md)). Agent list: loading, error, empty, populated. Agent detail: loading, error, five tabs. Evals tab: loading ("Loading evals…"), error, no evals, set list, open set (idle, starting/running, finished; unfiltered or narrowed to one category, including "No questions in this category."), Executions (loading, empty, populated, expanded with comparison, category pass rates, and tokens and cost).

## Flows

E2E: `frontend/e2e/agents.spec.ts` for the Feature below (moved verbatim from the repository `gherkin.md`).

```gherkin
Feature: Agents

  Scenario: Opens an agent from the Agents list and switches between its tabs
    When I click "Agents"
    Then I see "Questions to Insights Assistant" in the agent list
    And I see the "sql-fixer" agent in the list
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
    Then I see the "sql-verifier" agent in the list

  Scenario: Shows the stateless, no-tool agents accurately
    When I click "Agents"
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
    Then the Details panel says "Select a question in the Evals tab"
    When I click the "champion-2022" question
    Then the Details panel shows "Who won the 2022 World Cup?"
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
    Given two completed runs of the same set on the same datasource and datasets
    And a question passed in the first and failed in the second
    When I open the executions sub-tab and expand the second run
    Then I see "Compared to the previous run" and "Regressions (1)" listing that question
    When I download the second run's report
    Then it has the section "Compared to previous run"
    And lists that question under "Regressions (passed before, now failing)"

  Scenario: Does not compare runs of different sets
    Given a completed "world-cup" run and a completed "health-insurance" run on the same datasource and datasets
    When I expand the "health-insurance" run
    Then it shows no "Compared to the previous run" block

  Scenario: Runs the Formula 1 set against its own datasource
    Given a Formula 1 PostgreSQL datasource with a dataset containing the formula1 tables and views
    When I open the "formula-1" set and click the run button
    Then the run starts and shows "0/10 done"

  Scenario: Refuses a REST set on a PostgreSQL datasource
    Given only a PostgreSQL datasource with the World Cup dataset exists
    When I open the "world-cup-rest" set and click the run button
    Then I see "The selected datasets must belong to one REST API datasource."

  Scenario: Lists every question set with its question count
    When I open the assistant's Evals tab
    Then I see the sets "Formula 1", "Genomics", "Health Insurance", "HR", "Retail", "World Cup" and "World Cup (REST API)" in that order
    And "Genomics" and "Health Insurance" each show "20 questions"
    And "HR" shows "10 questions" and "Retail" shows "6 questions"

  Scenario: Scopes a run to the set's own dataset on a shared datasource
    Given the development fixtures are registered, so one datasource carries the "World Cup", "Health Insurance" and "Genomics" datasets
    When I open the "genomics" set
    Then I see "Scoped to Genomics"
    When I pick that datasource and click the run button
    Then the run starts and still shows "Scoped to Genomics"

  Scenario: Explains a synthetic set's missing tables with its own setup sentence
    Given a PostgreSQL datasource with only the World Cup dataset exists
    When I open the "health-insurance" set and click the run button
    Then I see a message starting "These evals require the bundled synthetic health-insurance fixture"
    And it lists the missing "health_insurance" entities
    And no run is recorded

  Scenario: Shows each question's category
    When I open the "world-cup" set
    Then the "champion-2022" question shows the category "control"
    And the "biggest-venue" question shows the category "ties"

  Scenario: Narrows the open set to one category
    When I open the "health-insurance" set
    Then the category filter reads "All categories (20)"
    And it offers "ratio-trap (3)"
    When I pick "ratio-trap (3)"
    Then 3 questions are listed, numbered 1 to 3
    And I see "20 of 20 selected · showing 3"
    And the select-all box reads "Select all shown"

  Scenario: Select all shown keeps the ticks of hidden questions
    Given the "health-insurance" set is open with every question ticked
    And the list is narrowed to "ratio-trap"
    When I click select-all
    Then I see "17 of 20 selected · showing 3"
    And the run button reads "Run 17 selected"
    When I pick "All categories (20)"
    Then the 17 other questions are still ticked

  Scenario: Switching sets clears the filter and the last results
    Given a run of the "world-cup" set has finished and its verdicts are shown
    And the list is narrowed to "control"
    When I open the "formula-1" set
    Then the category filter reads "All categories (10)"
    And no question shows a verdict
    And no progress line is shown

  Scenario: Switching sets clears a refusal
    Given starting a run of the "genomics" set was refused with "Missing entities: …"
    When I open the "world-cup" set
    Then no refusal message is shown under the run controls

  Scenario: Shows what a run spent
    Given a completed run whose provider reported token usage for a model with no rate in the price table
    When I open the executions sub-tab
    Then the run shows its total as "<n>k tokens"
    When I expand it
    Then "Tokens and cost" shows the model, input, output, total and model calls
    And "Estimated cost" reads "not priced — add the model to logs/pricing.json"
    And no "$0.00" is shown

  Scenario: Says tokens were not measured
    Given a completed run whose provider reported no token usage
    When I open the executions sub-tab
    Then the run shows "tokens not measured"
    When I expand it
    Then "Estimated cost" reads "not measured"

  Scenario: Shows pass rates by category, worst first
    Given a completed "world-cup" run where every "control" question passed and the "ties" question failed
    When I expand the run
    Then "Pass rate by category" lists "ties" above "control"
    And "ties" shows "0/1" and "0%"
    And "control" shows "2/2" and "100%"

  Scenario: The report carries categories and tokens
    Given a completed run with measured token usage
    When I download its report
    Then it has the sections "By category" and "Tokens and cost"
    And each question section names its category

  Scenario: Shows the model an agent resolves to
    Given an LLM configuration is saved
    When I open an agent's Model tab
    Then I see its model identifier and provider

  Scenario: Reports an unknown agent
    When I open an agent that no longer exists
    Then I see 'Agent "<key>" not found'
```

## Acceptance

- The nine `agents.spec.ts` scenarios pass.
- Running the `world-cup` set against the bundled sample with a working model finishes, records one result per ticked question, and every question's Details panel shows its checks and executed steps.
- A second completed run on the same datasource and datasets produces a Markdown report with a "Compared to previous run" section; a run on a different datasource or dataset set does not.
- Starting against a datasource with no datasets, or with datasets missing required entities, never spends model tokens and never leaves a run in history.
- The report downloaded from the Executions list opens as readable Markdown and contains the title, summary, per-question checks, executed steps and answers.
- Every reference query of every set validates against the development fixtures with zero model calls (R51): `OK` for every case with a reference query, the rest skipped.
- After the development fixtures are registered on one datasource, the `health-insurance`, `genomics`, `hr` and `retail` sets each start, are scoped to their own dataset, and finish with one result per ticked question, a category tally, and a token total (or "tokens not measured").
- Every finished run, completed or failed, leaves a run log and an index line in a source checkout; an installed app without a configured log location runs normally and only warns.

## Open questions

- A run interrupted by a backend stop stays `running` forever: nothing finalises it and the UI hides its delete button.
- The progress line shows "<finished>/<all questions in the open set> done", not the number of ticked questions. With 3 of 10 ticked it reads "0/10 done" although only 3 will run. The gherkin scenario for a full run is consistent with either; confirm the intended denominator.
- One invalid set definition empties the whole set list (the listing reads every definition and gives up on the first error), so a typo in one set hides all seven and the tab reads "No evals configured for this agent yet." Should the listing skip and report the bad definition instead?
- Before a run, "Scoped to <declared datasets>" is shown even when the chosen datasource has no datasets of those names and the run will fall back to every bound dataset (R21), so the hint can name datasets the run will not use.
- A run recorded before sets were stored is labelled "unknown suite" in Executions and "—" in its report, yet the comparison treats it as a `world-cup` run (R40), even when it was a Formula 1 or REST run from a release that already offered those sets; its question ids would identify the set.
- The category vocabulary (R43) is a convention: any non-empty text is accepted as a category.
- The browser saves the report as `eval-run-<agent>-<8-char id>.md` (no date) while the server's attachment name includes the date and time. The gherkin file pattern "eval-run-assistant-…" matches both.
- A code comment says runs are in-memory and forgotten on restart; in fact they are persisted and survive restarts (R25). The spec follows the behaviour.
- A failed (not just partial) run or a partial pass is drawn with the same red cross in Executions.
- The Agents screen's search icon is a placeholder with no behaviour.

<!-- sources: backend/src/modules/agents/{agents.controller,agents.service,eval-runs.service,eval-regression,eval-report,eval-telemetry,eval-run-log}.ts, backend/src/modules/agents/repositories/eval-runs.repository.ts, backend/src/mastra/evals/{assistant.evals,assistant-eval-datasets,suite-loader,result-set-check,run-assistant-evals}.ts, backend/src/mastra/evals/suites/*.json, backend/src/mastra/model-resolver.ts, backend/src/mastra/agents/eval-judge.agent.ts, backend/src/modules/sessions/{sessions.service,result-compare}.ts, backend/src/modules/testing-data/fixtures/registry.ts, backend/scripts/{run-eval,bootstrap-fixtures,learning-demo}.ts, backend/src/modules/expert-mode/{answer-record,expert-metrics}.ts, backend/eval/README.md, docker/postgres/README.md, docs/evals/{synthetic-domains,improvement-loop}.md, logs/README.md, logs/pricing.json, frontend/src/app/features/agents/ (agent-detail, eval-trace, models/eval.model.ts, services/agents-api.service.ts), frontend/e2e/agents.spec.ts -->

<!-- Implementation reference (not part of the rebuild contract): set definitions are `backend/src/mastra/evals/suites/<id>.json`; the failure-class vocabulary and the trap catalogue each synthetic fixture was designed around are in `docs/evals/synthetic-domains.md`; the operator runbook for measure, change, re-measure is `docs/evals/improvement-loop.md`. -->


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
- R11. The system SHALL provide five sets, listed in id order: `formula-1` ("Formula 1", the bundled Formula 1 sample on PostgreSQL, 1950 to 2026; 10 questions), `genomics` ("Genomics", the synthetic genomics fixture on PostgreSQL; 20 questions), `health-insurance` ("Health Insurance", the synthetic health-insurance fixture on PostgreSQL; 20 questions), `world-cup` ("World Cup", the bundled World Cup sample on PostgreSQL; 10 questions) and `world-cup-rest` ("World Cup (REST API)", the bundled REST sample: the 10 `world-cup` questions derived per R45, case ids prefixed `rest-`). The question lists are in *Eval suite content* below. Case ids SHALL be unique across all sets, so a list of case ids names exactly one set.
- R12. Each set SHALL carry an id, a name, a description, the names of the datasets it is written against, and its cases. A set over a bundled sample ([../testing-data/spec.md](../testing-data/spec.md)) SHALL name that sample and take its required entities, datasource kind and default dataset name from the sample catalogue, never repeating them; any other set SHALL declare its datasets, its required entities and its datasource kind (PostgreSQL unless stated), and its description SHALL be the operator-facing setup sentence the preflight quotes (R20). Each case SHALL carry an id, a category (R43), the question, an intent (what it probes) and its checks (id, name and description).
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
- R45. Sets SHALL be data, one definition per set (format and validation in [../../system/data-model.md](../../system/data-model.md)), re-read on every listing so an edited definition shows without a restart. A definition SHALL be rejected when read, with a message naming the definition and the case at fault, when a required field is missing or empty, a check is of an unknown kind or lacks its argument, a regular expression does not compile, a case uses the same kind of check twice (R30), a case id repeats within the set, the named bundled sample is unknown, or it repeats what the sample catalogue owns (required entities, datasource kind). A set MAY be derived from another, non-derived set: it takes the base set's questions, categories, checks and rubrics, prefixes every case id, and replaces only the reference queries; every base case with a reference query SHALL have a replacement, and a replacement for a case the base does not have SHALL fail the load. A set that cannot be read SHALL NOT run.

Token accounting and run logs
- R46. The system SHALL record, per question, the tokens the provider reported for the assistant's run (every step of it) plus the LLM judge's call when the question has a rubric: input, output, total (input + output unless the provider reports its own total), reasoning and cached-input tokens, and the number of model calls observed. Counts SHALL be measured, never estimated: a question for which the provider reported nothing SHALL carry no usage, and a question whose run threw SHALL keep what was observed before the error. The answer synthesised after a tool-only turn is not counted. The run SHALL carry the sum of its questions' usage, updated after every question; a run with zero observed calls is "not measured", never "free". When the run ends the system SHALL record the model the agents actually ran on (the currently configured model when none was observed) and an estimated cost in US dollars from an operator-maintained price table that ships empty (per model: input, output and optional cached-input dollars per million tokens; cached input tokens are billed at the cached rate; a model is matched by its full id or by the part after its last "/", case-insensitively). A model with no rate, or a run with nothing measured, SHALL have no cost, and neither the UI nor the report SHALL ever show such a run as "$0.00".
- R47. A run SHALL carry, per category, the number of questions run and the number passed, recomputed after every question; a question whose run threw counts as not passed, a result without a category counts under `uncategorised`, and questions the run never reached are not counted.
- R48. When a run ends, completed or failed, the system SHALL write a run log record and append a one-line summary to the run index ([../../system/data-model.md](../../system/data-model.md)). Logging SHALL be best effort: with no writable log location (an installed app outside a source checkout, unless one is configured) or a failed write, the run is unaffected and a warning says it was not logged.

Executions detail
- R49. An expanded execution SHALL show, in order: when the run has a comparison (R40), "Compared to the previous run" with either "No change from the previous run · <N> questions held their verdict" or a "Regressions (<n>)" list and/or an "Improvements (<n>)" list, each item `<id> — <question>`; when it has category tallies, "Pass rate by category", one row per category, worst rate first (ties: more questions first, then alphabetical), each with "<passed>/<total>" and a whole percentage coloured green at 100 %, red below 50 % and amber in between; and "Tokens and cost": "Model" (or "unknown"), then "Input", "Output", "Total" and "Model calls" (exact, thousands grouped), "Cached input" and "Reasoning" when non-zero, or "Tokens: not measured", and "Estimated cost": the amount in US dollars (four decimals under one cent, two otherwise), "not priced — add the model to logs/pricing.json" when tokens were measured but the model has no rate, or "not measured".

Developer harness
- R50. A developer harness SHALL run one set, or a case file of the same shape, as real streamed chat turns in throwaway sessions and grade each case by result-set comparison alone: a case without a reference query is skipped (`SKIP(no-expected-sql)`), never guessed. It SHALL accept a case-id substring filter, a category substring filter (an unmatched filter lists the categories present), a repeat count (a case passes only when every repetition passes, reported as `k/n`) and a free-text label; it SHALL print a verdict table, a per-category pass-rate table worst first and the run's measured tokens and estimated cost (R46, read from the persisted answers), write a run log unless told not to (R48), and exit non-zero when any case failed or errored.
- R51. The same harness SHALL offer a validate mode that runs every reference query of the selected cases against the live data with zero model calls and no LLM configuration (cases without one are reported as skipped), reporting each as OK (rows returned), EMPTY (no rows: a warning, still passing), TOO-MANY (at or above the 500-row cap: failing) or ERROR (the query failed: failing), writing a run log with no usage unless told not to, and exiting non-zero on any failure.

### Engine improvement loop

These rules come with the engine improvement loop (levers, arms and pass^k; [../engine-levers/spec.md](../engine-levers/spec.md)). Where one of them names an earlier rule it extends or replaces, it governs over that rule.

Run options
- R52. (Extends R19 and R22.) Starting a run SHALL also accept: a repeat count (1, 3 or 5, default 1; anything else is refused with `Repeat must be 1, 3 or 5 (got <n>)`); an arm (default `baseline`; an unknown arm is refused, engine-levers R6) and explicit lever overrides applied over the arm (the arm `custom` means "the overrides only"); a free-text label, trimmed and cut to 80 characters; "include paraphrases" (R60); a list of categories (only the set's questions in those categories run); and an explicit list of datasets (R55). All of these SHALL be validated before anything is stored or any token is spent. The run record SHALL keep the repeat, label, arm, the resolved lever values and their configuration hash, the judge model when pinned and the reasoning effort.
- R53. (Extends R19 and the Edge cases.) An explicit empty list of questions SHALL be refused with "Pick at least one question to run" before the set is resolved. A request naming neither a set nor any question SHALL run every question of `world-cup`, the shipped set. A list of questions without a set id SHALL resolve the set from the ids, paraphrase ids (`<id>~v<n>`) counting as their base question.
- R54. (Replaces R19 item 2 and R28.) A run started while another run of the agent is running or queued SHALL be accepted and stored with status `queued`, answering "Eval run queued" instead of "Eval run started". Queued runs SHALL start one at a time, in the order they were queued. While a started run is queued the run button SHALL read "Queued…".
- R55. (Extends R21.) An explicit list of datasets SHALL scope the run to exactly those datasets; a name the chosen datasource does not have SHALL be refused with "That datasource has no dataset named <names>". Under the run controls the open set SHALL offer one tick box per dataset on the chosen datasource ("Evaluate against"), ticked by default for the set's declared datasets; with nothing ticked explicitly the hint reads "set default — <names>" and the run is scoped by R21. Ticking a box adds that dataset to the shown selection; unticking every box falls back to the set's own. Only an explicit choice SHALL be sent with the run. Changing the datasource or opening another set SHALL clear the explicit choice.
- R56. A **Stop** button SHALL be shown while a run started from the Questions sub-tab is running or queued. Stopping a running run SHALL abort the question in flight ("Stopping — the question in flight is being aborted"), keep the finished questions and what they spent, end the run `failed` with "Stopped by the operator", and write its run log with status `aborted`. Stopping a queued run SHALL remove it from the queue ("Removed from the queue") and end it `failed` with "Stopped before it started". Stopping a stored `running` or `queued` run that no worker owns (the backend stopped while it was going) SHALL mark it `failed` with "Interrupted — the backend stopped before this run finished" ("Marked as interrupted"). A finished run SHALL answer "That run has already <status>"; an unknown one `Eval run "<id>" not found`.

How a case runs and is graded
- R57. (Replaces R24 and R29 to R32 for in-app runs and the developer harness.) Each attempt of a question SHALL run as a real chat turn through the same pipeline a session uses (curated context or not per the arm, metrics, verified queries, reasoning effort, guards, careful mode, answer review), in a fresh throwaway session that is deleted afterwards, with the run's resolved levers, and SHALL be cut off after 5 minutes (configurable). The finished turn SHALL be graded by the question's checks, the result-set match against every reference query of the question, and the judge.
- R58. The checks of R30 SHALL be extended with **final SQL succeeded** (the answer's last `run_readonly_sql` succeeded — passing a turn that hit an error, recovered and answered), and a `matches` check SHALL be case-insensitive unless its definition asks otherwise. The result-set match SHALL pass when the assistant's final successful query (or, failing that, any supporting query) matches the primary reference or any alternative reference of the question, and SHALL use the reference written for the datasource's SQL dialect when the question has one.
- R59. The judge SHALL grade on the pinned judge model when one is set (engine-levers R11 to R12), see a clarification with its offered options and a visual with its description, and SHALL ask a second time when it errors, returns unusable output, or fails the answer with low confidence; the second opinion wins. A judge that errors twice SHALL make the check a measurement gap, not a failure.
- R60. With "include paraphrases", each question that carries paraphrases SHALL also run once per paraphrase, right after its original, under the id `<id>~v<n>`, with the original's checks, references and category; a paraphrase follows its original's tick.
- R61. Each attempt SHALL get a verdict: ERROR (the turn threw, timed out, hit a provider error or was stopped), FAIL (a measured check failed), GAP (the harness could not measure it: a reference query or the judge failed, or no check could be measured) or PASS. Each question SHALL fold its attempts into one verdict by **pass^k**: PASS only when every measured attempt passed; FAIL when any measured attempt failed (ERROR when none passed and one errored); GAP when no attempt could be measured or every measured attempt passed but one was a gap; SKIP when the run was stopped before the question finished. A question is **flaky** when some but not all measured attempts passed. GAP and SKIP SHALL be excluded from every rate. A failed question SHALL carry a failure label naming the likely cause (for example `missing-default-filter`, `wrong-table`, `id-not-name`, `no-sql`, `clarified`).
- R62. A finished run SHALL carry a summary: the pass^k count and rate over scored questions, the mean per-attempt pass rate, flaky and gap counts, how many questions were answered every time, pass^k per category and per difficulty, and, when priced, the cost per correct answer. Token usage SHALL include the side passes that report it (grounding guard, tool-only synthesis, careful cross-check, answer review, SQL fixer), broken out per pass.
- R63. In the Questions sub-tab a finished question SHALL show its verdict badge: "PASS", "FAIL", "ERROR" or "GAP", followed by "<passes>/<runs>" when it ran more than once; a GAP badge SHALL carry the tooltip "the harness could not measure this — not counted".
- R64. The run controls of an open set SHALL include a repeat picker ("repeat 1", "repeat 3 — pass^3, the number we trust", "repeat 5"), an arm picker listing the arms (baseline first, then the others, then "custom…", each with its description as tooltip), a label box (placeholder "label, e.g. iter0-gpt5"), and an "include paraphrases" tick box. Choosing "custom…" SHALL show a text box for `key=value` overrides; while it holds an override that does not parse, the error SHALL be shown under it and the run button SHALL be disabled.

Loop runs
- R65. **Loop run** SHALL open a panel to queue one run per set × arm, set-major (every arm of the first set, then the next set), all tagged with one loop id, with a repeat (default 3), a label (default `loop-<start time>`), "include paraphrases" and an optional comma-separated category list. It SHALL show "≈ <N> turns (cases × repeat × arms)" before starting. A loop SHALL be validated as a whole: a datasource, at least one set ("Pick at least one suite to loop over") and one arm ("Pick at least one arm to loop over") are required, at most 60 runs may be queued ("A loop is capped at 60 runs (<s> suites × <a> arms asked for)"), and one invalid set or arm queues nothing. A set with no question in the requested categories SHALL be skipped and named in the answer ("Queued <n> eval runs (skipped <ids>: no question in the selected categories)").
- R66. While a loop runs, the panel SHALL poll it and show a matrix with one row per set × arm: status, model, repeat, pass^k ("<passK>/<scored>" and rate), mean pass rate, flaky, gaps, tokens and cost per correct answer, and an **Open run** action that switches to Executions with that run expanded. A loop SHALL be `running` while any of its runs is queued or running, `failed` when any failed, else `completed`.

History
- R67. A **History** sub-tab SHALL list every run log the app can read (in-app runs, the developer harness and validate runs), newest first, with filters by set, arm, model and harness, the folders read, a **Refresh** action, and per row the start time, set, arm, label, model, repeat and pass^k. With none it SHALL say "No logged runs yet — …". Marking two rows for comparison and choosing **Compare** SHALL show the diff of R68; a **Trend — pass^k over time** chart SHALL plot pass^k per set and arm, oldest first.
- R68. Comparing two logged runs (before, after) SHALL show the pass^k headline of each and the change, per-category deltas, every question whose verdict flipped, flaky changes, and token and cost deltas ("Tokens not comparable — one side reported no usage." when one side has none), and SHALL warn "Not commensurable: …" naming each difference when the two differ in set, model, engine configuration or repeat. From a comparison the user SHALL be able to draft a change-log entry (lever, change, why) with the measured half filled in, copy it, or append it to the evaluation change log when the app runs from a source checkout; appending SHALL require all three fields ("Fill in the lever, the change and the why before appending to the change log"); outside a checkout the draft is returned to paste by hand.
- R69. (Extends R48 and replaces its no-location clause.) Run logs SHALL be written in format version 2 ([../../system/data-model.md](../../system/data-model.md) 4.10) on every terminal state, completed, failed or aborted, with every attempt's checks, SQL, answer, tools, repairs, warnings and usage. They SHALL go to the first of: the configured log folder, the source checkout's log folder, the app data folder's `logs`, a `data/logs` folder under the working directory — so an installed app logs its runs too. Reading SHALL merge every one of those folders that exists, so an app started from a checkout also lists the command-line runs.
- R70. (Extends R42 and R50.) The developer harness SHALL run suites through the same production turn and grading as in-app runs (R57 to R62), accept the same arm and override options, run several suites and arms in one invocation and print the set × arm matrix, and diff two run logs from the command line with the same comparison as R68.

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

### Engine-loop suite content

The set definitions shipped with the engine improvement loop are the data asset; where they differ from the tables above, the definitions win. In summary:

| id | Name | Questions | Over |
|---|---|---|---|
| `banking` | Banking | 20 | synthetic retail-banking fixture, schema `banking` (declared dataset "Banking") |
| `formula-1` | Formula 1 | 10 | unchanged |
| `genomics` | Genomics | 49 | as above, grown to at least three questions per category |
| `health-insurance` | Health Insurance | 42 | as above, grown to three questions per category |
| `supply-chain` | Supply Chain | 20 | synthetic supply-chain fixture, schema `supply_chain` (declared dataset "Supply Chain") |
| `world-cup` | World Cup | 38 | bundled World Cup sample, grown from 10 |
| `world-cup-rest` | World Cup (REST API) | 38 | derived from `world-cup` (R45); all 27 reference queries ported to the REST sample's dialect |

- Banking (required entities `banking.regions`, `branches`, `customers`, `account_types`, `accounts`, `cards`, `fx_rates`, `transactions`, `loans`, `loan_payments`, `v_accounts`, `v_transactions`) and supply chain (`supply_chain.regions`, `warehouses`, `suppliers`, `product_categories`, `products`, `carriers`, `purchase_orders`, `purchase_order_lines`, `shipments`, `receipts`, `inventory_snapshots`, `v_purchase_order_lines`, `v_shipments`, `v_receipts`) are generated from fixed seeds like the other synthetic fixtures; each description is its preflight setup sentence ("These evals require the bundled synthetic <banking|supply-chain> fixture (schema <schema>). Select its PostgreSQL datasource and save a dataset named <name> containing the <schema> tables and views. Setup: …").
- Cases MAY carry a difficulty (`easy`, `medium`, `hard`), a provenance (`hand`, or `model-drafted-verified`: drafted by a model, rows read by a person), paraphrases, alternative reference queries, a per-dialect reference query and a trap query (the plausible wrong query the case guards against; validate mode asserts its result differs from the reference).
- Checks that failed correct answers were retired: discovery questions no longer require a `list_entities` call (the entity list is already in context), "no tool errors" is replaced by **final SQL succeeded** on every question but a few behaviour questions, and a text check asserting a bare number is dropped where the result-set match already compares the figure (loading a set warns about any left). `world-cup`'s `possession-vs-result` stays judged by rubric, without a reference query.
- Registering the development fixtures seeds the full business semantics of every synthetic fixture (every knowledge entry and metric, and each dataset's description), not only the entries the original traps needed; a knowledge entry states a fact about the data, never a hint about one question.

## Edge cases and errors

- Starting with zero ticked questions is blocked in the UI (button disabled); a direct request with an explicit empty list SHALL NOT be read as "run everything": it is refused with "Pick at least one question to run" when it names a set, and with "No question set matches the selected questions, …" when it does not. A request that names a set but no list runs every question of that set; a request with neither fails with "The selected questions span several sets (formula-1, genomics, health-insurance, world-cup, world-cup-rest) — run one set at a time."
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
- The six agents, the assistant's tools and memory settings, the judge's prompt and how a case is executed and scored: [../../system/agents.md](../../system/agents.md).
- Sample fixtures and their required entities: [../testing-data/spec.md](../testing-data/spec.md).
- The development fixtures database (World Cup, health insurance, genomics), their seeded generators, the registration script and the harness scripts: [../../system/delivery.md](../../system/delivery.md).
- Copy and layout of the Evals tab and the eval trace: [../../system/ui.md](../../system/ui.md).
- Terms: [../../product/glossary.md](../../product/glossary.md).
- Engine improvement loop: endpoints `POST /agents/:key/evals/loop`, `GET /agents/:key/evals/loops/:loopId`, `POST /agents/:key/evals/runs/:jobId/stop`, `GET /agents/:key/evals/logs`, `GET /agents/:key/evals/logs/compare`, `GET /agents/:key/evals/logs/:file`, `POST /agents/:key/evals/logs/changelog-draft`, `GET /agents/:key/evals/trend` in [../../system/api.md](../../system/api.md) 2.11; run-log format version 2 in [../../system/data-model.md](../../system/data-model.md) 4.10; levers and arms in [../engine-levers/spec.md](../engine-levers/spec.md).

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
    Then I see the sets "Formula 1", "Genomics", "Health Insurance", "World Cup" and "World Cup (REST API)" in that order
    And "Genomics" and "Health Insurance" each show "20 questions"

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

E2E: `frontend/e2e/agents.spec.ts` for the Feature below too (the four engine-loop tests at the end of the file).

```gherkin
Feature: Engine improvement loop in the Evals tab

  Scenario: Shows the repeat, arm, label and loop-run controls
    When I click "Agents"
    And I open the "Questions to Insights Assistant" agent
    And I open the Evals tab and the "world-cup" set
    Then the repeat picker offers "repeat 1", "repeat 3" and "repeat 5"
    And the arm picker offers "baseline"
    And I see the label box
    When I click "Loop run"
    Then the loop panel is shown

  Scenario: Opens the History sub-tab
    When I open the assistant's Evals tab
    And I open the History sub-tab
    Then I see either logged runs or "No logged runs yet"

  Scenario: Shows the pass^k headline and a GAP badge for a finished run
    Given a finished run with repeat 3 where one question passed 3 of 3 and one was a measurement gap
    When I open the executions sub-tab and expand that run
    Then its headline reads "pass^3" and mentions the gap
    And the gap question shows the badge "GAP"

  Scenario: Opens Engine levers and offers the Databricks provider
    When I open Settings and click "Engine levers"
    Then I see the heading "Engine levers"
    When I click "LLM Configuration"
    Then the provider picker offers "Databricks (Model Serving)"
    When I choose it
    Then I see the "Workspace URL" field
```

E2E: none yet for the Feature below.

```gherkin
Feature: Engine improvement loop behaviour not yet covered by Playwright

  Scenario: Queues a second run instead of refusing it
    Given a run of the "world-cup" set is in progress
    When I start a run of the "genomics" set
    Then I see "Eval run queued"
    And it starts when the first run ends

  Scenario: Stops a running run
    Given a run is in progress
    When I click "Stop"
    Then the run ends with "Stopped by the operator"
    And its finished questions and tokens are kept

  Scenario: Runs each question three times and reports pass^3
    When I pick "repeat 3" and run the "world-cup" set
    Then a question that passed twice of three shows "FAIL 2/3"
    And the run's headline counts it as not passed

  Scenario: Compares two logged runs
    Given two logged runs of the same set, model and engine
    When I mark both in the History sub-tab and click "Compare"
    Then I see the pass^k change, the category deltas and the questions that flipped
    And no "Not commensurable" warning

  Scenario: Queues a loop over sets and arms
    When I open "Loop run", tick the sets "genomics" and "health-insurance" and the arms "baseline" and "fixer-off"
    Then I see "≈ <N> turns (cases × repeat × arms)"
    When I click "Start loop"
    Then four runs are queued and the matrix shows one row per set and arm

  Scenario: Scopes a run to an explicitly ticked dataset
    Given the chosen datasource carries the datasets "World Cup" and "My World Cup"
    When I open the "world-cup" set and tick only "My World Cup" under "Evaluate against"
    And I click the run button
    Then the run is scoped to "My World Cup"
```

## Acceptance

- The nine `agents.spec.ts` scenarios pass.
- Running the `world-cup` set against the bundled sample with a working model finishes, records one result per ticked question, and every question's Details panel shows its checks and executed steps.
- A second completed run on the same datasource and datasets produces a Markdown report with a "Compared to previous run" section; a run on a different datasource or dataset set does not.
- Starting against a datasource with no datasets, or with datasets missing required entities, never spends model tokens and never leaves a run in history.
- The report downloaded from the Executions list opens as readable Markdown and contains the title, summary, per-question checks, executed steps and answers.
- Every reference query of every set validates against the development fixtures with zero model calls (R51): `OK` for every case with a reference query, the rest skipped.
- After the development fixtures are registered on one datasource, the `health-insurance` and `genomics` sets each start, are scoped to their own dataset, and finish with one result per ticked question, a category tally, and a token total (or "tokens not measured").
- Every finished run, completed or failed, leaves a run log and an index line in a source checkout; an installed app without a configured log location runs normally and only warns.
- The four engine-loop scenarios of `agents.spec.ts` pass.
- A repeat-3 run of any set records three attempts per question in its run log and a pass^k summary; a question whose judge errored twice is a GAP and is excluded from every rate.
- A run started while another runs is queued, not refused; Stop ends a running run with its log written as `aborted`.

## Open questions

- A run interrupted by a backend stop stays `running` forever: nothing finalises it and the UI hides its delete button.
- The progress line shows "<finished>/<all questions in the open set> done", not the number of ticked questions. With 3 of 10 ticked it reads "0/10 done" although only 3 will run. The gherkin scenario for a full run is consistent with either; confirm the intended denominator.
- One invalid set definition empties the whole set list (the listing reads every definition and gives up on the first error), so a typo in one set hides all five and the tab reads "No evals configured for this agent yet." Should the listing skip and report the bad definition instead?
- Before a run, "Scoped to <declared datasets>" is shown even when the chosen datasource has no datasets of those names and the run will fall back to every bound dataset (R21), so the hint can name datasets the run will not use.
- A run recorded before sets were stored is labelled "unknown suite" in Executions and "—" in its report, yet the comparison treats it as a `world-cup` run (R40), even when it was a Formula 1 or REST run from a release that already offered those sets; its question ids would identify the set.
- The category vocabulary (R43) is a convention: any non-empty text is accepted as a category.
- The browser saves the report as `eval-run-<agent>-<8-char id>.md` (no date) while the server's attachment name includes the date and time. The gherkin file pattern "eval-run-assistant-…" matches both.
- A code comment says runs are in-memory and forgotten on restart; in fact they are persisted and survive restarts (R25). The spec follows the behaviour.
- A failed (not just partial) run or a partial pass is drawn with the same red cross in Executions.
- The Agents screen's search icon is a placeholder with no behaviour.

<!-- sources: backend/src/modules/agents/{agents.controller,agents.service,eval-runs.service,eval-regression,eval-report,eval-telemetry,eval-run-log}.ts, backend/src/modules/agents/repositories/eval-runs.repository.ts, backend/src/mastra/evals/{assistant.evals,assistant-eval-datasets,suite-loader,result-set-check,run-assistant-evals}.ts, backend/src/mastra/evals/suites/*.json, backend/src/mastra/model-resolver.ts, backend/src/mastra/agents/eval-judge.agent.ts, backend/src/modules/sessions/{sessions.service,result-compare}.ts, backend/src/modules/testing-data/fixtures/registry.ts, backend/scripts/{run-eval,bootstrap-fixtures}.ts, backend/eval/README.md, docker/postgres/README.md, docs/evals/{synthetic-domains,improvement-loop}.md, logs/README.md, logs/pricing.json, frontend/src/app/features/agents/ (agent-detail, eval-trace, models/eval.model.ts, services/agents-api.service.ts), frontend/e2e/agents.spec.ts -->

<!-- Implementation reference (not part of the rebuild contract): set definitions are `backend/src/mastra/evals/suites/<id>.json`; the failure-class vocabulary and the trap catalogue each synthetic fixture was designed around are in `docs/evals/synthetic-domains.md`; the operator runbook for measure, change, re-measure is `docs/evals/improvement-loop.md`. -->


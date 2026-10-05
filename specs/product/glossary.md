# Glossary

Every domain term, defined once, in alphabetical order. Other specs link here instead of redefining. Where a concept was renamed, the legacy name is given, because old data and old code comments still use it.

Names in `code font` are the identifiers used in persisted documents and the API. Plain names are what the UI shows.

**Active visual.** The visual currently open in the right-hand panel. The assistant tailors it by default when the user asks for a change. See *Visual*.

**Agent.** A single LLM role with its own instructions, optional tools and optional memory. The product has seven: the assistant, the visual designer, the SQL fixer, the SQL verifier, the answer review agent, the knowledge bootstrap agent and the eval judge. See [../system/agents.md](../system/agents.md). The Agents screen lists them and shows their prompts, tools, memory settings and model.

**Angle.** One sub-question of a *deep analysis*. A plan has between 3 and 5 angles (hard cap 5). Each is investigated on its own.

**Answer.** The assistant's final message in a *turn*, together with the evidence stored with it: result rows, SQL, entities, interpretation, reasoning trail, knowledge used and any badges.

**Answer review.** An optional check, after the assistant's answer is final, of that answer against its own transcript (claims without evidence, wrong date filters, truncated results read as complete, arithmetic in prose, mismatched comparison windows, an ignored breakdown, a degenerate query, a metric or default filter not honoured). A finding gets the assistant one corrective pass. Switched on by the *engine lever* `answerReview`. See [../capabilities/engine-levers/spec.md](../capabilities/engine-levers/spec.md).

**App secret.** The key material from which the key that encrypts stored LLM API keys is derived. On desktop it is generated once and kept in a file in the data directory. See [non-functional.md](non-functional.md).

**Arm.** A named preset of *engine lever* values applied over the production values for one *eval run* (for example `baseline`, `fixer-off`, `careful-auto`, `full`), so two engines are compared as two runs of the same set.

**Assistant.** The main agent. It answers business questions over a session's datasets, runs SQL, calls the visual tools and asks clarifying questions.

**Careful mode.** An opt-in per-turn setting in the chat. After the assistant answers, a second agent (the *SQL verifier*) re-derives the SQL independently, runs it, and compares its result set with the answer's. The answer gets an agree, disagree or error badge. Slower per answer. See *Cross-check*.

**Catalog.** The top level of an *entity* name. A Databricks Unity Catalog catalog; the database name on PostgreSQL; `api` on a REST API datasource. See *Entity*.

**Clarification.** A question the assistant asks the user, with 2 to 4 options, when interpretations diverge materially. The turn ends; the user's pick (or typed answer) arrives as the next message. At most one per user question.

**Cross-check.** The result of *careful mode* on one answer: status `agree` (same results), `disagree` (results differ) or `error` (the check could not finish), plus a short note.

**Data directory.** The folder holding all app data: application database, agent memory, observability data, per-session *workspaces* and the *app secret* file. Desktop and web mode use different data directories on purpose.

**Data point selection.** The user clicking a mark (bar, segment, point) inside a *visual*. The panel reports it to the chat so the user can ask a follow-up about that value.

**Data record.** The stored result of one `run_readonly_sql` or `sample_rows` call: tool, input, columns, rows (capped), total row count, truncated flag, error, rationale and warnings.

**Dataset.** A named, saved selection of *entities* from one *datasource*, plus a snapshot of their schema and sample values. Sessions work over datasets, not directly over datasources. Identified by its name; there is no separate id. Legacy name: *sandbox selection* (collection `sandbox_selections`, session field `sandboxes`); the UI once said "sandbox".

**Datasource.** A saved connection to a data platform. Three kinds: `databricks` (a SQL warehouse, via host, token and warehouse id), `postgres` (host, port, database, user, password, SSL) and `rest` (an HTTP API with a base URL, an auth mode and a list of endpoints that are mapped to tables). Legacy name: *connection* (collection `connections`). The first single Databricks connection was migrated to a datasource with id `legacy-databricks`.

**Deep analysis.** A background investigation of one question from several *angles*, producing a downloadable markdown *report*. One at a time per session. The chat stays usable while it runs. The result is posted as an assistant message whose text is the executive summary.

**Default filter.** A *knowledge entry* of kind `default_filter`: a condition (for example "exclude test accounts") the assistant applies to every query unless the question asks for the excluded rows. The answer names the filters applied.

**Diagnostics.** The system log of the app: backend log lines, desktop shell events and interface errors, kept in a bounded buffer, shown in the System logs panel and exportable as a redacted, LLM-readable markdown report. A *log run* groups entries by backend process lifetime.

**Dimension.** A column a *metric* is meaningfully grouped by.

**Engine lever.** One named switch of how the assistant answers — curated context or schema only, column profiles, ranked knowledge, lookup tools, descriptive errors, SQL precheck, extended guards, the SQL fixer, careful mode, *answer review*, prompt rule groups. Production values are set in Settings → Engine levers; an *arm* overrides them for an eval run. See [../capabilities/engine-levers/spec.md](../capabilities/engine-levers/spec.md).

**Entity.** A queryable table or view, named in full as `catalog.schema.table`. Every datasource kind is normalised to this three-level shape. The UI says "entities". An entity may be *browse-only* (visible but not queryable with the credentials); it is shown greyed.

**Eval case.** One question in an *eval set*, with the intent it probes, its *eval category* and a list of *eval checks* (for example "answer includes Argentina", result-set comparison, or an LLM-judge rubric).

**Eval category.** The failure class an *eval case* probes, so a run can say *what kind* of mistake is failing rather than only how many. In use: `control` (a healthy baseline that must keep passing), `ratio-trap` (dividing a measure by a look-alike, or by itself), `constant-column` (a column that never varies), `empty-column` (grouping by a mostly-empty column), `ties` (several rows tie at the top), `value-vocabulary` (values written differently from the question, such as "approved" for `PAID`), `out-of-scope` (data that is not there), `clarification` (asking, or not asking), `id-vs-name` (ids instead of names), `metric-definition` (a curated metric definition), `default-filter` (a curated default filter), `multi-step-join` (an answer several joins away, such as region to state to country), `discovery` (a schema question), `unit-confusion` (cents vs dollars), `domain-semantics` (field knowledge, such as genotype `0/0` not being a carrier) and `quality-filter` (rows a status or quality flag should exclude, such as pending claims or low-quality variant calls). Shown as a chip on each question, used to filter the question list and tallied per run.

**Eval check.** One scorer that grades an eval case's answer or tool calls.

**Eval judge.** The agent that grades an eval case against its rubric. It runs on the assistant's configured model unless a judge model is pinned in Settings → Engine levers, so changing the assistant's model does not move the ruler.

**Eval run.** One execution of selected eval cases of one *eval set* against a datasource and its datasets. Records per-question results (pass or fail, scores, tool calls, answer, category, *token usage*), per-category tallies, the run's total token usage, the model it ran on and, when that model is priced, an estimated cost. When a completed earlier run exists for the same agent, set, datasource and datasets, the run also stores a *regression comparison*. Every finished run also writes an *eval run log* when it can.

**Eval run log.** A developer record of one eval run (set, datasets, model, verdicts per question, category tallies, token usage, estimated cost) written as a file next to the source code, plus a one-line entry in a running index, so runs can be compared over time. Holds no query results. Format version 2 also records every attempt's checks, SQL, answer, tools and usage, the arm and the engine configuration; an installed app writes it under its data folder.

**Eval set.** A named group of eval cases over one fixture: World Cup on PostgreSQL, World Cup on REST (derived from the World Cup set), Formula 1, Health Insurance, Genomics, Banking and Supply Chain. A set over a bundled *sample fixture* names it; the Health Insurance, Genomics, Banking and Supply Chain sets run over synthetic fixtures that exist only in the development database and declare their own datasets and required entities. Each set is defined as data in one *eval suite*.

**Eval suite.** The data file that defines one *eval set*. The UI and API say *set*; files, the developer CLI (`--suite`) and stored runs (`suiteId`) say *suite*. Same thing.

**Feedback.** The user's thumbs-up or thumbs-down on an answer. Thumbs-up also saves a *verified query*. Thumbs-down only marks the answer as wrong.

**Fixture.** See *Sample fixture*. The synthetic health-insurance and genomics eval fixtures are not sample fixtures: they are generated from a fixed seed into the development database only (see *Eval set*).

**Foreign key / relationship.** A join link from a column of one dataset entity to a column of another. `declared` when the datasource reports the constraint; `inferred` when guessed from column names (`team_id` to a `teams` table). Used to tell the assistant which columns join. Inference deliberately skips ambiguous cases.

**Freeform visual.** A *visual* whose bundle is generated HTML, CSS and JavaScript, used when a *visual spec* cannot be produced. Tailoring a freeform visual stays freeform. Contrast *spec visual*.

**Interpretation.** A one-line, deterministic summary of how an answer was produced (which entities, what kind of query), built by the system at save time. Never model output.

**Knowledge entry.** A curated piece of business knowledge the assistant treats as authoritative. Three kinds: `term` (glossary definition, with optional synonyms and entity bindings), `instruction` (a standing rule) and `default_filter`. Scoped globally, to a dataset or to a datasource. Only enabled entries reach the assistant, within a size budget per turn. Source is `user` or `mined` (drafted by the bootstrap agent, saved disabled for review). The UI says "Knowledge". Code and Jira call these *snippets*.

**Knowledge bootstrap.** The action that has an agent draft up to 15 knowledge entries from a dataset's schema and a few sample rows. Drafts arrive as "Pending suggestions", disabled.

**Knowledge used.** The list of knowledge entries that were actually included in the context of one answer, recorded when the context was built. It shows what the model was given, not what it applied.

**LLM provider.** The service the agents call. `openai`, `anthropic`, `lenai` (Halo's OpenAI-compatible gateway, which needs a base URL; the "model" field is then the deployment name) or `databricks` (Databricks Model Serving: a workspace URL, a personal access token and a serving-endpoint name). One global setting: provider, model, API key (stored encrypted, shown masked) and *reasoning effort*.

**Measurement gap (GAP).** An eval verdict meaning the harness itself could not tell whether the answer was right (a reference query failed, the judge errored twice). Never counted as a pass or a failure, and excluded from every rate.

**Message.** One entry in a session's transcript, from the `user` or the `assistant`, with a timestamp that doubles as its identity (`at`). Assistant messages may carry data records, entities, a clarification, a visual event, feedback, a cross-check, a reasoning trail, knowledge used or a report.

**Metric.** A governed, named SQL aggregation expression over one entity (for example `denial_rate`), with a label, description and dimensions. The assistant reuses its expression verbatim instead of re-deriving it. Metrics are the app's lightweight semantic layer. A metric can be promoted from a *verified query*; the draft is a *metric candidate*.

**Mined entry.** A *knowledge entry* with source `mined`.

**Paraphrase variant.** A rewording of an *eval case*'s question with the same answer and checks, run under the id `<case id>~v<n>` when a run includes paraphrases, to tell understanding from wording.

**pass^k.** The verdict of an eval case run k times: it passes only when every measured attempt passed. A run reports pass^k per set, category and difficulty; repeat 3 (pass^3) is the number the improvement loop trusts.

**Reasoning effort.** `low`, `medium` or `high` (default `high`). A global setting passed to models that support it and dropped for models that reject it.

**Reasoning trail.** The "How I worked this out" list on an answer: one step per data-gathering call, with the assistant's plain-language rationale, the statement used and the outcome. The prose is the model's; ordering and outcomes come from what actually ran.

**Report.** The markdown output of a *deep analysis*: title, executive summary, findings by angle, data appendix.

**Result guard.** A deterministic check on a query result that attaches a *warning*: a ratio of a sum to itself, a metric constant on every row, an unordered "top N".

**Row cap.** A limit on rows returned or stored. See [non-functional.md](non-functional.md). A result clipped by a cap is marked *truncated*.

**Sample fixture.** A bundled sample database the app can provision for testing and evals: World Cup (2018 and 2022) and Formula 1. Set up from Settings, Testing Data. Also called *test data* or *sample*.

**Sample values.** Up to 5 distinct real values per column, captured when a dataset is saved, so the assistant can match the user's wording to stored values.

**Schema.** The middle level of an *entity* name.

**Session.** One conversation with the assistant, bound to one or more *datasets*. Holds the transcript, the visuals, and owns one *workspace* and one memory thread. Needs a name and at least one dataset. Legacy name: *project* (collection `projects`, workspace folders `project-<id>`).

**SQL repair.** When a statement fails with an engine error, the *SQL fixer* agent rewrites it and it is re-run, up to 2 repair attempts. The corrected SQL is what gets cited. Guard rejections and transport or auth failures are not repaired.

**SQL verifier.** The agent behind *careful mode*.

**System logs.** The UI name for *diagnostics*.

**Table.** The last level of an *entity* name.

**Tailoring.** Changing an existing visual by describing the change in plain English, through the chat (`update_visual`) or the panel's instruction box. Produces a new *visual version*.

**Term.** A *knowledge entry* of kind `term`.

**Tool call.** One invocation of a capability by the assistant during a turn. Data tools: `list_entities`, `describe_entity`, `sample_rows`, `run_readonly_sql`. Visual tools: `create_visual`, `update_visual`. UI tool: `ask_clarification`. Calls to the data tools are captured as *data records*.

**Token usage.** The token counts a model provider reports for its calls: input, output, total, reasoning and cached-input tokens, and how many calls were summed. Always measured, never estimated from text: a call the provider reported nothing for has no usage, and zero observed calls means "not measured", never "free". Money is a separate, estimated figure: usage priced at operator-maintained per-model rates, "not priced" when the model has no rate. Recorded per eval question and run, and on each chat answer.

**Turn.** One user message and everything the assistant does in response, up to its final answer or a clarification. Includes streamed reasoning, tool calls and their results.

**Verified answer.** An answer whose final SQL matches a stored *verified query*, or that the user thumbed up. Shown with a "Verified" badge.

**Verified query.** A question and SQL pair saved when the user thumbs up an answer. The last successful SQL statement of the answer is stored, with the datasource and entities. Similar questions later get the closest pairs as reference. Can be promoted to a *metric*.

**Visual / visualization.** An interactive, sandboxed chart document created from an answer's data. Has a title, a description (the takeaway), a *visual version* history and files in the session's workspace. Framed with the question, the analysis, a data provenance section and a footer. The code and API say "visualization"; the UI says "visual".

**Visual spec.** A small JSON description of a chart (forms: bar, line, scatter, heatmap, metric cards, table, donut) rendered by a fixed runtime. Preferred over freeform generation because it cannot break on bad generated code.

**Visual version.** One immutable snapshot of a visual. Version 1 is created from the answer; each tailoring adds a version with its instruction. *Revert* moves the current-version pointer; it does not delete versions. A *refresh* re-runs the SQL and rewrites the current version's data in place without adding a version. An *auto-repair* version carries the instruction prefix `auto-repair: `.

**Warning.** A fault note from a *result guard*, shown with the data record and returned to the assistant so it re-runs before answering.

**Workspace.** A contained folder on disk, one per session, where the session's visuals and reports are stored. Created with the session and rediscovered on restart. Legacy folder name: `project-<id>`.

<!-- sources: backend/src/modules/*/entities/*.ts, backend/src/modules/datasets/repositories/datasets.repository.ts, backend/src/modules/datasets/relationships.ts, backend/src/modules/agents/*.ts, backend/src/modules/llm/llm.types.ts, backend/src/modules/sessions/entities/session.entity.ts, backend/src/modules/sessions/visual-spec.ts, backend/src/modules/sessions/visualization.service.ts, backend/src/mastra/tools/*.ts, backend/src/mastra/agents/*.ts, backend/src/infrastructure/database/database.module.ts, frontend/src/app/features/*/models/*.ts, frontend/src/app/app.html, frontend/src/app/features/sessions/components/session-chat/session-chat.html -->

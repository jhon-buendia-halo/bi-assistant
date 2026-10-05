# Glossary

Every domain term, defined once, in alphabetical order. Other specs link here instead of redefining. Where a concept was renamed, the legacy name is given, because old data and old code comments still use it.

Names in `code font` are the identifiers used in persisted documents and the API. Plain names are what the UI shows.

**Active visual.** The visual currently open in the right-hand panel. The assistant tailors it by default when the user asks for a change. See *Visual*.

**Agent.** A single LLM role with its own instructions, optional tools and optional memory. The product has eight: the assistant, the visual designer, the SQL fixer, the SQL verifier, the knowledge bootstrap agent, the eval judge, the business expert (the explainer behind a *reasoning trace*) and the feedback learner (which turns a reviewer's note into *lessons*). See [../system/agents.md](../system/agents.md). The Agents screen lists them and shows their prompts, tools, memory settings and model.

**Angle.** One sub-question of a *deep analysis*. A plan has between 3 and 5 angles (hard cap 5). Each is investigated on its own.

**Answer.** The assistant's final message in a *turn*, together with the evidence stored with it: result rows, SQL, entities, interpretation, reasoning trail, knowledge used, any badges and, in *business expert mode*, a *reasoning trace*.

**Answer pin.** The stored, checked answer of one *lineage*: its query, the rows it returned and the answer message, saved under a *fingerprint*. Asking the lineage's question again replays the pin word for word, with no model call, while the fingerprint still matches and the query still returns the same rows. A thumbs-down rejects a pin (it is never replayed) and a thumbs-up approves it. One pin per lineage.

**Answer query.** The successful SQL query an answer is built on, chosen by which query's values the answer text quotes (its first figure first), not simply the last one that ran. The cross-check, the reasoning trace, answer pinning, learning and the developer eval harness all use it.

**App secret.** The key material from which the key that encrypts stored LLM API keys is derived. On desktop it is generated once and kept in a file in the data directory. See [non-functional.md](non-functional.md).

**Assistant.** The main agent. It answers business questions over a session's datasets, runs SQL, calls the visual tools and asks clarifying questions.

**Block rating.** A reviewer's thumbs up or down and optional note on one block of a *reasoning trace*. Stored once per answer and block, with a copy of the question and the block, and mirrored onto the answer. A thumbs-down withdraws the answer's verified query and rejects its *answer pin*; a thumbs-up on the SQL block approves the answer; a note is distilled into *lessons*.

**Business expert mode.** A standing chat preference (the **Expert** toggle) under which every answer also carries a *reasoning trace* with measured *confidence*, always runs the *cross-check*, and runs in *review mode*. Each block of the trace can be rated, and notes become *lessons*.

**Careful mode.** An opt-in per-turn setting in the chat. After the assistant answers, a second agent (the *SQL verifier*) re-derives the SQL independently, runs it, and compares its result set with the answer's. The answer gets an agree, disagree or error badge. Slower per answer. See *Cross-check*. *Business expert mode* runs the same check.

**Catalog.** The top level of an *entity* name. A Databricks Unity Catalog catalog; the database name on PostgreSQL; `api` on a REST API datasource. See *Entity*.

**Clarification.** A question the assistant asks the user, with 2 to 4 options, when interpretations diverge materially. The turn ends; the user's pick (or typed answer) arrives as the next message. At most one per user question.

**Confidence.** In a *reasoning trace*, a 0–1 score per block and for the whole answer, computed by the system as a weighted mean of measured *confidence signals*. It is never the model's own opinion. Shown as a *confidence band* and a percentage.

**Confidence band.** `high` (0.80 or more), `medium` (0.55 or more) or `low`. One definition for every block and the overall score; shown green, amber or red.

**Confidence signal.** One measured contributor to a *confidence*: schema grounding, join grounding, knowledge coverage, execution, independent cross-check, verified query match, assumption load, or the model's self-assessment (weighted lowest). A signal that cannot be measured is left out, not counted as zero.

**Consistency verdict.** What *answer pinning* did for an answer: `replay` (the stored answer was returned after its query re-ran with the same rows), `kept` (a fresh derivation returned the same rows, so the earlier wording was kept) or `updated` (the numbers changed, listing any *lessons* learned since). Shown as a chip on the answer.

**Cross-check.** The result of *careful mode* (or *business expert mode*) on one answer: status `agree` (same results), `disagree` (results differ) or `error` (the check could not finish), plus a short note.

**Data directory.** The folder holding all app data: application database, agent memory, observability data, per-session *workspaces* and the *app secret* file. Desktop and web mode use different data directories on purpose.

**Data point selection.** The user clicking a mark (bar, segment, point) inside a *visual*. The panel reports it to the chat so the user can ask a follow-up about that value.

**Data record.** The stored result of one `run_readonly_sql` or `sample_rows` call: tool, input, columns, rows (capped), total row count, truncated flag, error, rationale and warnings.

**Dataset.** A named, saved selection of *entities* from one *datasource*, plus a snapshot of their schema and sample values. Sessions work over datasets, not directly over datasources. Identified by its name; there is no separate id. Legacy name: *sandbox selection* (collection `sandbox_selections`, session field `sandboxes`); the UI once said "sandbox".

**Datasource.** A saved connection to a data platform. Three kinds: `databricks` (a SQL warehouse, via host, token and warehouse id), `postgres` (host, port, database, user, password, SSL) and `rest` (an HTTP API with a base URL, an auth mode and a list of endpoints that are mapped to tables). Legacy name: *connection* (collection `connections`). The first single Databricks connection was migrated to a datasource with id `legacy-databricks`.

**Deep analysis.** A background investigation of one question from several *angles*, producing a downloadable markdown *report*. One at a time per session. The chat stays usable while it runs. The result is posted as an assistant message whose text is the executive summary.

**Default filter.** A *knowledge entry* of kind `default_filter`: a condition (for example "exclude test accounts") the assistant applies to every query unless the question asks for the excluded rows. The answer names the filters applied.

**Diagnostics.** The system log of the app: backend log lines, desktop shell events and interface errors, kept in a bounded buffer, shown in the System logs panel and exportable as a redacted, LLM-readable markdown report. A *log run* groups entries by backend process lifetime.

**Dimension.** A column a *metric* is meaningfully grouped by.

**Entity.** A queryable table or view, named in full as `catalog.schema.table`. Every datasource kind is normalised to this three-level shape. The UI says "entities". An entity may be *browse-only* (visible but not queryable with the credentials); it is shown greyed.

**Eval case.** One question in an *eval set*, with the intent it probes, its *eval category* and a list of *eval checks* (for example "answer includes Argentina", result-set comparison, or an LLM-judge rubric).

**Eval category.** The failure class an *eval case* probes, so a run can say *what kind* of mistake is failing rather than only how many. In use: `control` (a healthy baseline that must keep passing), `ratio-trap` (dividing a measure by a look-alike, or by itself), `constant-column` (a column that never varies), `empty-column` (grouping by a mostly-empty column), `ties` (several rows tie at the top), `value-vocabulary` (values written differently from the question, such as "approved" for `PAID`), `out-of-scope` (data that is not there), `clarification` (asking, or not asking), `id-vs-name` (ids instead of names), `metric-definition` (a curated metric definition), `default-filter` (a curated default filter), `multi-step-join` (an answer several joins away, such as region to state to country), `discovery` (a schema question), `unit-confusion` (cents vs dollars), `domain-semantics` (field knowledge, such as genotype `0/0` not being a carrier) and `quality-filter` (rows a status or quality flag should exclude, such as pending claims or low-quality variant calls). Shown as a chip on each question, used to filter the question list and tallied per run.

**Eval check.** One scorer that grades an eval case's answer or tool calls.

**Eval run.** One execution of selected eval cases of one *eval set* against a datasource and its datasets. Records per-question results (pass or fail, scores, tool calls, answer, category, *token usage*), per-category tallies, the run's total token usage, the model it ran on and, when that model is priced, an estimated cost. When a completed earlier run exists for the same agent, set, datasource and datasets, the run also stores a *regression comparison*. Every finished run also writes an *eval run log* when it can.

**Eval run log.** A developer record of one eval run (set, datasets, model, verdicts per question, category tallies, token usage, estimated cost) written as a file next to the source code, plus a one-line entry in a running index, so runs can be compared over time. Holds no query results. Not written by an installed app unless a log location is configured.

**Eval set.** A named group of eval cases over one fixture: World Cup on PostgreSQL, World Cup on REST (derived from the World Cup set), Formula 1, Health Insurance, Genomics, HR and Retail. A set over a bundled *sample fixture* names it; the Health Insurance, Genomics, HR and Retail sets run over synthetic fixtures that exist only in the development database and declare their own datasets and required entities. The HR set measures *business expert mode*; the Retail set carries the learning scenario that teaches *lessons*. Each set is defined as data in one *eval suite*.

**Eval suite.** The data file that defines one *eval set*. The UI and API say *set*; files, the developer CLI (`--suite`) and stored runs (`suiteId`) say *suite*. Same thing.

**Evidence basis.** Where a claim in a *reasoning trace* comes from: a knowledge entry, a metric, a verified query (each only when the turn was actually given that source), the schema, a data sample, a common convention, or an assumption (a guess). The first five count as grounded.

**Feedback.** The user's thumbs-up or thumbs-down on an answer. Thumbs-up also saves a *verified query* and approves the answer's *answer pin*. Thumbs-down marks the answer as wrong and rejects its pin. See also *Block rating*.

**Fingerprint.** A hash of everything that legitimately changes an answer without changing its question: the knowledge the turn was given, the governed-metrics and verified-query context, the datasets' schema, and the model with its reasoning effort. An *answer pin* is replayed only under the fingerprint it was saved with.

**Fixture.** See *Sample fixture*. The synthetic health-insurance, genomics, HR and retail eval fixtures are not sample fixtures: they are generated from a fixed seed into the development database only (see *Eval set*).

**Foreign key / relationship.** A join link from a column of one dataset entity to a column of another. `declared` when the datasource reports the constraint; `inferred` when guessed from column names (`team_id` to a `teams` table). Used to tell the assistant which columns join. Inference deliberately skips ambiguous cases.

**Freeform visual.** A *visual* whose bundle is generated HTML, CSS and JavaScript, used when a *visual spec* cannot be produced. Tailoring a freeform visual stays freeform. Contrast *spec visual*.

**Interpretation.** A one-line, deterministic summary of how an answer was produced (which entities, what kind of query), built by the system at save time. Never model output.

**Knowledge entry.** A curated piece of business knowledge the assistant treats as authoritative. Three kinds: `term` (glossary definition, with optional synonyms and entity bindings), `instruction` (a standing rule) and `default_filter`. Scoped globally, to a dataset or to a datasource. Only enabled entries reach the assistant, within a size budget per turn. Source is `user`, `mined` (drafted by the bootstrap agent, saved disabled for review) or `feedback` (a *lesson*). The UI says "Knowledge". Code and Jira call these *snippets*.

**Knowledge bootstrap.** The action that has an agent draft up to 15 knowledge entries from a dataset's schema and a few sample rows. Drafts arrive as "Pending suggestions", disabled.

**Knowledge used.** The list of knowledge entries that were actually included in the context of one answer, recorded when the context was built. It shows what the model was given, not what it applied.

**Lesson.** A *knowledge entry* with source `feedback`: a general, standing rule (a fiscal calendar, a metric definition, a filter that always applies) distilled from a reviewer's note on a *reasoning block*. It is never the answer to the rated question. Stored enabled, scoped to the session's datasets, with its provenance (the rating, question, note and how it was learned), and shown in Knowledge as "From feedback". Not fine-tuning: lessons are read by every later turn and can be edited or switched off.

**Lineage key.** The identity of a question for *answer pinning*: the question normalised (case, spacing and trailing punctuation ignored), the session's datasets, the earlier questions of the conversation (the *chain*) and the mode (`plain`, `careful` or `expert`). A rephrasing, another conversation history or another mode is a different lineage.

**LLM provider.** The service the agents call. `openai`, `anthropic` or `lenai` (Halo's OpenAI-compatible gateway, which needs a base URL; the "model" field is then the deployment name). One global setting: provider, model, API key (stored encrypted, shown masked) and *reasoning effort*.

**Message.** One entry in a session's transcript, from the `user` or the `assistant`, with a timestamp that doubles as its identity (`at`). Assistant messages may carry data records, entities, a clarification, a visual event, feedback, a cross-check, a reasoning trail, knowledge used, a report, a *reasoning trace* or a *consistency verdict*.

**Metric.** A governed, named SQL aggregation expression over one entity (for example `denial_rate`), with a label, description and dimensions. The assistant reuses its expression verbatim instead of re-deriving it. Metrics are the app's lightweight semantic layer. A metric can be promoted from a *verified query*; the draft is a *metric candidate*.

**Mined entry.** A *knowledge entry* with source `mined`.

**Reasoning block.** One of the five fixed parts of a *reasoning trace*: interpretation (how the question was read), data selection (tables, joins and tables not used, drawn as a diagram), assumptions, metric definition, and annotated SQL. Each has its own *confidence* and its own *block rating*.

**Reasoning effort.** `low`, `medium` or `high` (default `high`). A global setting passed to models that support it and dropped for models that reject it.

**Reasoning trace.** In *business expert mode*, the structured explanation attached to an answer: five *reasoning blocks* plus an overall *confidence*. The model writes the prose; everything stated as fact (the SQL, its rows, the tables) comes from what ran, and every confidence is measured. Distinct from the *reasoning trail*.

**Reasoning trail.** The "How I worked this out" list on an answer: one step per data-gathering call, with the assistant's plain-language rationale, the statement used and the outcome. The prose is the model's; ordering and outcomes come from what actually ran.

**Report.** The markdown output of a *deep analysis*: title, executive summary, findings by angle, data appendix.

**Result guard.** A deterministic check on a query result that attaches a *warning*: a ratio of a sum to itself, a metric constant on every row, an unordered "top N".

**Review mode.** How the assistant behaves in *business expert mode*. When a question depends on a business convention the curated knowledge does not define (a fiscal calendar, a metric's formula), it answers under the most common convention and states the assumption instead of asking a *clarification*, because the reviewer's correction becomes a *lesson*. It still asks when the data itself matches several ways.

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

<!-- sources: backend/src/modules/*/entities/*.ts, backend/src/modules/{expert-mode,learning,answer-pins}/*.ts, backend/src/modules/datasets/repositories/datasets.repository.ts, backend/src/modules/datasets/relationships.ts, backend/src/modules/agents/*.ts, backend/src/modules/llm/llm.types.ts, backend/src/modules/sessions/entities/session.entity.ts, backend/src/modules/sessions/visual-spec.ts, backend/src/modules/sessions/visualization.service.ts, backend/src/mastra/tools/*.ts, backend/src/mastra/agents/*.ts, backend/src/infrastructure/database/database.module.ts, frontend/src/app/features/*/models/*.ts, frontend/src/app/app.html, frontend/src/app/features/sessions/components/session-chat/session-chat.html -->

# Glossary

Every domain term, defined once, in alphabetical order. Other specs link here instead of redefining. Where a concept was renamed, the legacy name is given, because old data and old code comments still use it.

Names in `code font` are the identifiers used in persisted documents and the API. Plain names are what the UI shows.

**Active visual.** The visual currently open in the right-hand panel. The assistant tailors it by default when the user asks for a change. See *Visual*.

**Agent.** A configured LLM role with its own instructions, optional tools and optional memory. The product ships six built-in agents (the assistant, the visual designer, the SQL fixer, the SQL verifier, the knowledge bootstrap agent and the eval judge), and users can build their own (*user agent*). See [../system/agents.md](../system/agents.md). The *Agent Hub* lists them all.

**Agent Hub.** The Agents screen. It shows every agent as a card, grouped in sections (Official, Mine and System, pinned cards first), with a search over name and description, filter pills (All, Pinned, Official and Mine) and a *pin* on each card. A card opens the agent's detail view. See [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md).

**Angle.** One sub-question of a *deep analysis*. A plan has between 3 and 5 angles (hard cap 5). Each is investigated on its own.

**Answer.** The assistant's final message in a *turn*, together with the evidence stored with it: result rows, SQL, entities, interpretation, reasoning trail, knowledge used and any badges.

**App secret.** The key material from which the key that encrypts stored LLM API keys is derived. On desktop it is generated once and kept in a file in the data directory. See [non-functional.md](non-functional.md).

**Assistant.** The main agent. It answers business questions over a session's datasets, runs SQL, calls the visual tools and asks clarifying questions.

**Careful mode.** An opt-in per-turn setting in the chat. After the assistant answers, a second agent (the *SQL verifier*) re-derives the SQL independently, runs it, and compares its result set with the answer's. The answer gets an agree, disagree or error badge. Slower per answer. See *Cross-check*.

**Catalog.** The top level of an *entity* name. A Databricks Unity Catalog catalog; the database name on PostgreSQL; `api` on a REST API datasource. See *Entity*.

**Clarification.** A question the assistant asks the user, with 2 to 4 options, when interpretations diverge materially. The turn ends; the user's pick (or typed answer) arrives as the next message. At most one per user question.

**Cross-check.** The result of *careful mode* on one answer: status `agree` (same results), `disagree` (results differ) or `error` (the check could not finish), plus a short note.

**Data directory.** The folder holding all app data: application database, agent memory, observability data, per-session *workspaces* and the *app secret* file. Desktop and web mode use different data directories on purpose.

**Developer observability.** An opt-in developer setting, off by default. When it is on, the backend exports agent traces to Arize Phoenix and backend traces, metrics and logs to an OpenTelemetry (OTLP) endpoint, in addition to the local observability store. It takes effect when the backend restarts. See [../capabilities/developer-settings/spec.md](../capabilities/developer-settings/spec.md).

**Data point selection.** The user clicking a mark (bar, segment, point) inside a *visual*. The panel reports it to the chat so the user can ask a follow-up about that value.

**Data record.** The stored result of one `run_readonly_sql` or `sample_rows` call: tool, input, columns, rows (capped), total row count, truncated flag, error, rationale and warnings.

**Dataset.** A named, saved selection of *entities* from one *datasource*, plus a snapshot of their schema and sample values. Sessions work over datasets, not directly over datasources. Identified by its name; there is no separate id. Legacy name: *sandbox selection* (collection `sandbox_selections`, session field `sandboxes`); the UI once said "sandbox".

**Datasource.** A saved connection to a data platform. Three kinds: `databricks` (a SQL warehouse, via host, token and warehouse id), `postgres` (host, port, database, user, password, SSL) and `rest` (an HTTP API with a base URL, an auth mode and a list of endpoints that are mapped to tables). Legacy name: *connection* (collection `connections`). The first single Databricks connection was migrated to a datasource with id `legacy-databricks`.

**Deep analysis.** A background investigation of one question from several *angles*, producing a downloadable markdown *report*. One at a time per session. The chat stays usable while it runs. The result is posted as an assistant message whose text is the executive summary.

**Default filter.** A *knowledge entry* of kind `default_filter`: a condition (for example "exclude test accounts") the assistant applies to every query unless the question asks for the excluded rows. The answer names the filters applied.

**Diagnostics.** The system log of the app: backend log lines, desktop shell events and interface errors, kept in a bounded buffer, shown in the System logs panel and exportable as a redacted, LLM-readable markdown report. A *log run* groups entries by backend process lifetime.

**Dimension.** A column a *metric* is meaningfully grouped by.

**Draft (agent).** The working copy of a *user agent*. It can be edited and tried in a preview chat, but cannot start sessions. Publishing it makes the agent *Live*. See [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md).

**Entity.** A queryable table or view, named in full as `catalog.schema.table`. Every datasource kind is normalised to this three-level shape. The UI says "entities". An entity may be *browse-only* (visible but not queryable with the credentials); it is shown greyed.

**Eval case.** One question in an *eval set*, with the intent it probes and a list of *eval checks* (for example "answer includes Argentina", result-set comparison, or an LLM-judge rubric).

**Eval check.** One scorer that grades an eval case's answer or tool calls.

**Eval run.** One execution of selected eval cases against a datasource and its datasets. Records per-question results (pass or fail, scores, tool calls, answer). When a completed earlier run exists for the same agent, datasource and datasets, the run also stores a *regression comparison*.

**Eval set.** A named group of eval cases bound to one *sample fixture* (World Cup on PostgreSQL, World Cup on REST, Formula 1).

**Feedback.** The user's thumbs-up or thumbs-down on an answer. Thumbs-up also saves a *verified query*. Thumbs-down only marks the answer as wrong.

**Fixture.** See *Sample fixture*.

**Foreign key / relationship.** A join link from a column of one dataset entity to a column of another. `declared` when the datasource reports the constraint; `inferred` when guessed from column names (`team_id` to a `teams` table). Used to tell the assistant which columns join. Inference deliberately skips ambiguous cases.

**Freeform visual.** A *visual* whose bundle is generated HTML, CSS and JavaScript, used when a *visual spec* cannot be produced. Tailoring a freeform visual stays freeform. Contrast *spec visual*.

**Interpretation.** A one-line, deterministic summary of how an answer was produced (which entities, what kind of query), built by the system at save time. Never model output.

**Knowledge entry.** A curated piece of business knowledge the assistant treats as authoritative. Three kinds: `term` (glossary definition, with optional synonyms and entity bindings), `instruction` (a standing rule) and `default_filter`. Scoped globally, to a dataset or to a datasource. Only enabled entries reach the assistant, within a size budget per turn. Source is `user` or `mined` (drafted by the bootstrap agent, saved disabled for review). The UI says "Knowledge". Code and Jira call these *snippets*.

**Knowledge bootstrap.** The action that has an agent draft up to 15 knowledge entries from a dataset's schema and a few sample rows. Drafts arrive as "Pending suggestions", disabled.

**Knowledge used.** The list of knowledge entries that were actually included in the context of one answer, recorded when the context was built. It shows what the model was given, not what it applied.

**Live (agent).** The published version of a *user agent*. It is the version that starts sessions. Editing a Live agent changes only its *draft*, and the Live version keeps serving until the draft is published.

**LLM provider.** The service the agents call. `openai`, `anthropic` or `lenai` (Halo's OpenAI-compatible gateway, which needs a base URL; the "model" field is then the deployment name). One global setting: provider, model, API key (stored encrypted, shown masked) and *reasoning effort*.

**Message.** One entry in a session's transcript, from the `user` or the `assistant`, with a timestamp that doubles as its identity (`at`). Assistant messages may carry data records, entities, a clarification, a visual event, feedback, a cross-check, a reasoning trail, knowledge used or a report.

**Metric.** A governed, named SQL aggregation expression over one entity (for example `denial_rate`), with a label, description and dimensions. The assistant reuses its expression verbatim instead of re-deriving it. Metrics are the app's lightweight semantic layer. A metric can be promoted from a *verified query*; the draft is a *metric candidate*.

**Mined entry.** A *knowledge entry* with source `mined`.

**Official agent.** The app's own *assistant*, shown in the agent hub as the Official agent. It is the only built-in agent that can start a chat.

**Pin.** A user's mark on an agent, built-in or user-built, so it can be found quickly. Pins are stored locally and survive a restart.

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

**System agent.** One of the built-in helper agents (the visual designer, the SQL fixer, the SQL verifier, the knowledge bootstrap agent and the eval judge). It is read-only, runs inside the app's own flows and cannot start a chat.

**System logs.** The UI name for *diagnostics*.

**Table.** The last level of an *entity* name.

**Tailoring.** Changing an existing visual by describing the change in plain English, through the chat (`update_visual`) or the panel's instruction box. Produces a new *visual version*.

**Term.** A *knowledge entry* of kind `term`.

**Tool call.** One invocation of a capability by the assistant during a turn. Data tools: `list_entities`, `describe_entity`, `sample_rows`, `run_readonly_sql`. Visual tools: `create_visual`, `update_visual`. UI tool: `ask_clarification`. Calls to the data tools are captured as *data records*.

**Turn.** One user message and everything the assistant does in response, up to its final answer or a clarification. Includes streamed reasoning, tool calls and their results.

**User agent.** An agent a user builds: a name, a description, instructions, the datasets it may query, starter questions and an optional model or reasoning-effort override. It runs on the *assistant* with the same tools and guards, and it has a *draft* and, once published, a *Live* version.

**Verified answer.** An answer whose final SQL matches a stored *verified query*, or that the user thumbed up. Shown with a "Verified" badge.

**Verified query.** A question and SQL pair saved when the user thumbs up an answer. The last successful SQL statement of the answer is stored, with the datasource and entities. Similar questions later get the closest pairs as reference. Can be promoted to a *metric*.

**Visual / visualization.** An interactive, sandboxed chart document created from an answer's data. Has a title, a description (the takeaway), a *visual version* history and files in the session's workspace. Framed with the question, the analysis, a data provenance section and a footer. The code and API say "visualization"; the UI says "visual".

**Visual spec.** A small JSON description of a chart (forms: bar, line, scatter, heatmap, metric cards, table, donut) rendered by a fixed runtime. Preferred over freeform generation because it cannot break on bad generated code.

**Visual version.** One immutable snapshot of a visual. Version 1 is created from the answer; each tailoring adds a version with its instruction. *Revert* moves the current-version pointer; it does not delete versions. A *refresh* re-runs the SQL and rewrites the current version's data in place without adding a version. An *auto-repair* version carries the instruction prefix `auto-repair: `.

**Warning.** A fault note from a *result guard*, shown with the data record and returned to the assistant so it re-runs before answering.

**Workspace.** A contained folder on disk, one per session, where the session's visuals and reports are stored. Created with the session and rediscovered on restart. Legacy folder name: `project-<id>`.

<!-- sources: backend/src/modules/*/entities/*.ts, backend/src/modules/datasets/repositories/datasets.repository.ts, backend/src/modules/datasets/relationships.ts, backend/src/modules/agents/*.ts, backend/src/modules/llm/llm.types.ts, backend/src/modules/sessions/entities/session.entity.ts, backend/src/modules/sessions/visual-spec.ts, backend/src/modules/sessions/visualization.service.ts, backend/src/mastra/tools/*.ts, backend/src/mastra/agents/*.ts, backend/src/infrastructure/database/database.module.ts, frontend/src/app/features/*/models/*.ts, frontend/src/app/app.html, frontend/src/app/features/sessions/components/session-chat/session-chat.html -->

# Glossary

Every domain term, defined once, in alphabetical order. Other specs link here instead of redefining. Where a concept was renamed, the legacy name is given, because old data and old code comments still use it.

Names in `code font` are the identifiers used in persisted documents and the API. Plain names are what the UI shows.

**Active visual.** The visual currently open in the right-hand panel. The assistant tailors it by default when the user asks for a change. See *Visual*.

**Agent.** A configured LLM role with its own instructions, optional tools and optional memory. The product ships eight built-in agents (the assistant, *Questions to Insights v2*, the *Data Readiness Agent*, the visual designer, the SQL fixer, the SQL verifier, the Ontology Bootstrap agent and the eval judge), and users can build their own (*user agent*). See [../system/agents.md](../system/agents.md). The *Agent Hub* lists them all. An agent is a building block that the steps of a *workflow* call (ADR-0040).

**Agent Hub.** The Agents screen. It shows every agent as a card, grouped in sections (Official, which holds the *Official agents*: the assistant, the *Data Readiness Agent* and *Questions to Insights v2*; Mine; and System; pinned cards first), with a search over name and description, filter pills (All, Pinned, Official and Mine) and a *pin* on each card. A card opens the agent's detail view. See [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md).

**Angle.** One sub-question of a *deep analysis*. A plan has between 3 and 5 angles (hard cap 5). Each is investigated on its own.

**Answer.** The assistant's final message in a *turn*, together with the evidence stored with it: result rows, SQL, entities, interpretation, reasoning trail, knowledge used and any badges.

**API style.** Which API a *custom endpoint* speaks: `openai` (shown "OpenAI-compatible"; the base URL includes the version path, e.g. `http://127.0.0.1:8317/v1`, and the key is sent as `Authorization: Bearer`) or `anthropic` (shown "Anthropic-compatible"; the base URL is the server root, e.g. `http://127.0.0.1:8317`, and the key is sent as `x-api-key`). Required for a custom endpoint, ignored for the other providers. See [../capabilities/llm-settings/spec.md](../capabilities/llm-settings/spec.md).

**App secret.** The key material from which the key that encrypts stored LLM API keys is derived. On desktop it is generated once and kept in a file in the data directory. See [non-functional.md](non-functional.md).

**Assistant.** The main agent. It answers business questions over a session's datasets, runs SQL, calls the visual tools and asks clarifying questions.

**Careful mode.** An opt-in per-turn setting in the chat. After the assistant answers, a second agent (the *SQL verifier*) re-derives the SQL independently, runs it, and compares its result set with the answer's. The answer gets an agree, disagree or error badge. Slower per answer. See *Cross-check*.

**Carrier.** An insurer that writes one or more *lines of coverage*. A carrier is the *incumbent* on a client's line when it carries the client's live policy for that line.

**Catalog.** The top level of an *entity* name. A Databricks Unity Catalog catalog; the database name on PostgreSQL; `api` on a REST API datasource. See *Entity*.

**Census.** A client's employee data for one plan year: headcount, eligible and enrolled employees, average age and salary, gender split, employees by state, enrolment by coverage tier and by employee class. The census names its own plans, which are mapped to the client's *plan designs*.

**Clarification.** A question the assistant asks the user, with 2 to 4 options, when interpretations diverge materially. The turn ends; the user's pick (or typed answer) arrives as the next message. At most one per user question.

**Code-defined workflow.** A *workflow* written in code with its own steps, some deterministic and some calling an agent, and shipped with the app; today *Questions to Insights v2*'s four-step turn. It drives the *workflow bar* from its steps. See [../system/architecture.md](../system/architecture.md) ADR-0034 and ADR-0040.

**Concept.** An *ontology item* of kind `concept`: a business term with a name, a definition, optional synonyms and optional **mappings** that say where it lives in the data (an entity, and optionally a column and/or a SQL expression). Rendered to the assistant as a `[term]` line. Replaces the former knowledge entry of kind `term`.

**Constraint.** An *ontology item* of kind `constraint`: a SQL predicate (for example "exclude test accounts") with an optional note on when to apply it, an optional concept it is about and optional entities. The assistant applies it to every query unless the question asks for the excluded rows, and the answer names the filters applied. Rendered as a `[default_filter]` line. Replaces the former *default filter*.

**Copilot runtime.** The local process that GitHub's official Copilot SDK starts and drives for the *LLM provider* `copilot`. It signs in with the GitHub login already on the machine (the GitHub CLI, the GitHub Copilot CLI or the GitHub Copilot app) and talks to GitHub Copilot; the app keeps its own tools and tool loop and never enables the runtime's built-in tools. See ADR-0037 in [../system/architecture.md](../system/architecture.md).

**Cross-check.** The result of *careful mode* on one answer: status `agree` (same results), `disagree` (results differ) or `error` (the check could not finish), plus a short note.

**Context window box.** One of the seven parts the Monitoring call page sorts an LLM call's input into: System prompt, Skill injection and Tools injection (owner **US Health**, what the app ships), and Chat history, Dataset, User prompt and Tool calls and results (owner **Custom**, what comes from the user's data and conversation). Each box shows an estimated token count and its exact text. See [monitoring](../capabilities/monitoring/spec.md) R17–R22.

**Custom endpoint.** The *LLM provider* `custom`: a model server the user chooses, such as a self-hosted model (Ollama, LM Studio, vLLM), a gateway (LiteLLM) or a relay, that speaks the OpenAI or Anthropic API. It is set by an *API style*, a base URL, an optional API key and a model, which the user can pick from the server's own model list. See [../capabilities/llm-settings/spec.md](../capabilities/llm-settings/spec.md).

**Data directory.** The folder holding all app data: application database, agent memory, observability data, per-session *workspaces* and the *app secret* file. Desktop and web mode use different data directories on purpose.

**Data readiness.** How fit the data behind a *dataset* is for analysis, measured by the *Data Readiness Agent* on the DMBOK data-quality *readiness dimensions*. It is expressed as a score per dimension, an overall score from 0 to 100 and a *maturity band*. A deterministic engine computes every number from aggregate statistics of the data, never a model. See [../capabilities/data-readiness/spec.md](../capabilities/data-readiness/spec.md).

**Data Readiness Agent.** The built-in Official agent (`data-readiness`) that runs *data readiness* assessments of a session's PostgreSQL or Databricks datasets and explains the stored reports. It can run read-only SQL to show the records behind a finding, but never computes or changes a score. See [../system/agents.md](../system/agents.md) 2.10.

**Developer observability.** An opt-in developer setting, off by default. When it is on, the backend exports agent traces to Arize Phoenix and backend traces, metrics and logs to an OpenTelemetry (OTLP) endpoint, in addition to the local observability store. It takes effect when the backend restarts. See [../capabilities/developer-settings/spec.md](../capabilities/developer-settings/spec.md).

**Data point selection.** The user clicking a mark (bar, segment, point) inside a *visual*. The panel reports it to the chat so the user can ask a follow-up about that value.

**Data record.** The stored result of one `run_readonly_sql` or `sample_rows` call: tool, input, columns, rows (capped), total row count, truncated flag, error, rationale and warnings.

**Dataset.** A named, saved selection of *entities* from one *datasource*, plus a snapshot of their schema and sample values. Sessions work over datasets, not directly over datasources. Identified by its name; there is no separate id. Legacy name: *sandbox selection* (collection `sandbox_selections`, session field `sandboxes`); the UI once said "sandbox".

**Datasource.** A saved connection to a data platform. Three kinds: `databricks` (a SQL warehouse, via host, token and warehouse id), `postgres` (host, port, database, user, password, SSL) and `rest` (an HTTP API with a base URL, an auth mode and a list of endpoints that are mapped to tables). Legacy name: *connection* (collection `connections`). The first single Databricks connection was migrated to a datasource with id `legacy-databricks`.

**Deep analysis.** A background investigation of one question from several *angles*, producing a downloadable markdown *report*. One at a time per session. The chat stays usable while it runs. The result is posted as an assistant message whose text is the executive summary.

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

**Built-in agent prompt override.** An edit of the *system prompt* of a built-in agent (an *Official agent* or a System agent), made on the agent's System Prompt tab. It is stored in the database, and replaces the shipped prompt on the next call, for every session and user agent, until **Reset to built-in** deletes it. The assistant's generated `## Tools` section is not part of the edited text. See [../system/data-model.md](../system/data-model.md) 3.10.3 and ADR-0026.

**Built-in skill override.** An edit of a built-in *skill*, made in the skills library. It is stored in the database, and replaces the shipped skill on the next call until **Reset to built-in** deletes it. See [../system/data-model.md](../system/data-model.md) 3.10.2 and ADR-0023.

**GitHub Copilot (provider).** The *LLM provider* `copilot`: every agent runs on the user's own GitHub Copilot seat through the *Copilot runtime*, with no API key or base URL; the model is `auto` (Copilot picks from the seat's plan) unless the user names one. Each prompt counts against the seat's Copilot allowance. See [../capabilities/llm-settings/spec.md](../capabilities/llm-settings/spec.md).

**In-app skill.** A *skill* a user writes in the app (the skills library) instead of a folder: a name, a "Use when…" description, a body and reference files, stored in the database. It reaches a session only through a *user agent* whose instructions *link* it, and a *Live* agent runs on the copy taken when it was published. See [../system/data-model.md](../system/data-model.md) 3.10.1 and ADR-0022.

**Instruction.** An *ontology item* of kind `instruction`: a standing rule, data quirk or coverage fact the assistant follows, with optional entities.


**Interpretation.** A one-line, deterministic summary of how an answer was produced (which entities, what kind of query), built by the system at save time. Never model output.

**Knowledge used.** The list of *ontology items* that were actually included in the context of one answer, recorded when the context was built and stored on the answer in the field `knowledge`. It shows what the model was given, not what it applied. The UI says "Ontology in context".

**Line of coverage.** A kind of employee benefit a client offers and a *carrier* insures, such as medical, dental, vision, life, disability, voluntary benefits or an employee assistance programme. The Intellify data has 12 (its *products*). Also called a *line*.

**Link (skill or tool).** A reference written in an agent's instructions (or, for a tool, in an in-app skill's body) with `/` in the editor: shown as a chip, saved as `[[skill:<name>]]` or `[[tool:<name>]]`. The links decide which skills and optional tools the agent gets, and the model sees each as a plain mention (`the "x" tool`). See [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md) R81-R86 and ADR-0024.

**Live (agent).** The published version of a *user agent*. It is the version that starts sessions. Editing a Live agent changes only its *draft*, and the Live version keeps serving until the draft is published.

**LLM call.** One model call of one agent run, as recorded in the trace store (`observability.duckdb`, a `model_generation` span): its agent, model, provider, session, tokens, duration, estimated cost and status. A run's several requests to the model are its *steps*, inside one LLM call. Listed on the Monitoring page, newest first. See [monitoring](../capabilities/monitoring/spec.md) and ADR-0038.

**Session flow.** The Monitoring view of one *session* as a list of turns. Each turn (one question, one trace) shows the question, the path the agent took (its model requests and tool calls in time order), the answer and its cost, and can open a *waterfall*. Shown on the session page, which opens from the Sessions tab. See [monitoring](../capabilities/monitoring/spec.md) R26–R44.

**Waterfall.** A timeline of one turn on the session page: one row per span, with a bar placed and sized to scale against the turn's total time, coloured by kind (agent, model, request, tool, memory, framework). Selecting a row shows that span's details, input and output. See [monitoring](../capabilities/monitoring/spec.md) R37–R42.

**Framework span.** A trace span the agent framework writes for its own housekeeping, such as skill actions, processor runs, workspace actions and the model inference that repeats a request. The waterfall hides them unless **Show framework spans** is on. See [monitoring](../capabilities/monitoring/spec.md) R39–R40.

**LLM provider.** The service the agents call. `openai`, `anthropic`, `lenai` (Halo's OpenAI-compatible gateway, which needs a base URL; the "model" field is then the deployment name) `custom` (a *custom endpoint*, which needs an *API style* and a base URL, and whose API key is optional) or `copilot` (*GitHub Copilot*, which needs no key or base URL and uses the machine's GitHub login). One global setting: provider, model, API key (stored encrypted, shown masked), *reasoning effort* and, for `lenai` and `custom`, the base URL (and for `custom` the API style).

**Maturity band.** The DMBOK maturity level of an overall *data readiness* score: Optimised (95 and above), Managed (85 and above), Defined (70 and above), Repeatable (50 and above) or Initial.

**Message.** One entry in a session's transcript, from the `user` or the `assistant`, with a timestamp that doubles as its identity (`at`). Assistant messages may carry data records, entities, a clarification, a visual event, feedback, a cross-check, a reasoning trail, knowledge used or a report.

**Metric.** A governed, named SQL aggregation expression over one entity (for example `denial_rate`), with a label, description and dimensions. The assistant reuses its expression verbatim instead of re-deriving it. Metrics are the app's lightweight semantic layer. A metric can be promoted from a *verified query*; the draft is a *metric candidate*.

**Mined item.** An *ontology item* with source `mined`: drafted by the *ontology bootstrap*, saved disabled until a human accepts it.

**Official agent.** One of the app's own agents shown in the agent hub's Official section: the *assistant*, *Questions to Insights v2* and the *Data Readiness Agent*.

**One-step workflow.** The *workflow* the app makes for an agent that a chat can run and that has no workflow of its own (the assistant, the *Data Readiness Agent*, every *Live* *user agent*): one step that runs the agent. Its id is `agent:<agent key or id>`. It never writes the *workflow bar*; the agent's own *workflow phases* keep driving it. See [../system/architecture.md](../system/architecture.md) ADR-0040.

**Ontology.** What a dataset means, written down for the assistant: the *ontology items* (concepts, relations, constraints and instructions) that belong to the dataset, plus the *shared items*. Edited in the dataset's Ontology tab. Only enabled items reach the assistant, within a size budget per turn. Replaces the knowledge library, whose entries became ontology items (ADR-0036). See [dataset-ontology](../capabilities/dataset-ontology/spec.md).

**Ontology bootstrap.** The action that has an agent (Ontology Bootstrap, registry key `knowledge-bootstrap`) draft up to 15 ontology items for a dataset from its schema, sample rows, column references and governed metrics. Drafts arrive as "Pending suggestions", disabled. Replaces the *knowledge bootstrap*.

**Ontology item.** One entry of an ontology: a *concept*, *relation*, *constraint* or *instruction*, with a name, a description, an enabled flag and a source (`user`, or `mined` when drafted by the bootstrap). It belongs to one dataset, or is a *shared item*. Code and the former UI called the same thing a *knowledge snippet*.

**Panel item.** One thing an agent showed in the right panel with `show_in_panel`, saved on the *session* with the time it was shown: a workspace file, a Markdown document, a query result table or a *visual*. The latest one is what the panel opens on; every one is listed in the *session panel*'s shown-items menu. See [agent-panel](../capabilities/agent-panel/spec.md).

**Past chat.** A *session* saved before chats were retired. It stays on disk and opens read-only under Runs: its transcript, visuals and files, and Delete. No chat can continue (ADR-0041).

**Pin.** A user's mark on an agent, built-in or user-built, so it can be found quickly. Pins are stored locally and survive a restart.

**Plan design.** One benefit plan a client offers on a *line of coverage*: its carrier, funding type (for example fully insured or self-funded), plan type and state, with the financials of its coverage (premiums, rates by tier, enrolment, contributions and fees).

**Preview chat.** Retired in 1.23.27 (the agent editor's Try it is a draft run, a run on a temporary run host, agents.md 5.14).

**Readiness dimension.** One of the ten DMBOK data-quality dimensions a readiness report lists. Eight are assessed: completeness, validity, consistency, uniqueness, integrity, accessibility, timeliness and reasonability. Two are listed but not assessed, because they need reference data: accuracy and currency.

**Readiness finding.** One problem a *data readiness* check found: its *readiness dimension*, the table and column, a severity (info, low, medium or high), what was measured, a description and a recommendation. Findings lower their dimension's score by weight: low 0.1, medium 0.4, high 1.0 per check run.

**Reasoning effort.** How hard a model reasons before answering: one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, of which each model accepts its own subset (its *effort levels*; default `high` when offered). A global setting chosen in Settings → LLM, passed to models that support it, mapped to the nearest level a model accepts, and dropped for models that reject it.

**Reasoning trail.** The "How I worked this out" list on an answer: one step per data-gathering call, with the assistant's plain-language rationale, the statement used and the outcome. The prose is the model's; ordering and outcomes come from what actually ran.

**Relation.** An *ontology item* of kind `relation`: how two concepts connect (`is-a`, `part-of`, `has-many`, `related-to`), or that a concept is `measured-by` a governed metric. Rendered as a `[relation]` line the assistant uses to choose joins and the governed metric.

**Renewal kick-off.** The date work on a line's renewal starts: the renewal effective date minus the policy's kick-off timing, a number of days. Intellify plans are taken to run by calendar year, so a renewal takes effect on 1 January after the plan year.

**Report.** The markdown output of a *deep analysis*: title, executive summary, findings by angle, data appendix.

**Result guard.** A deterministic check on a query result that attaches a *warning*: a ratio of a sum to itself, a metric constant on every row, an unordered "top N".




**Row cap.** A limit on rows returned or stored. See [non-functional.md](non-functional.md). A result clipped by a cap is marked *truncated*.

**Run.** One execution of a *workflow* on a typed input: its steps run once and each reports its status and output. A run of an agent workflow is stored and listed under Runs; a run can carry one earlier run as context (Follow up, a clarification answer). Replaces the chat (ADR-0041).

**Run workflow.** A *workflow* that is started by a *run* on its typed input fields, defined in code, rather than by a chat. Since ADR-0041 every workflow is a run workflow.

**Sample fixture.** A bundled sample database the app can provision for testing and evals: World Cup (2018 and 2022), Formula 1, Intellify (an employee-benefits data model with synthetic data) and US Health (a synthetic Mercer US Health & Benefits business: clients, plans, claims, benchmarks, surveys, life/absence/disability and strategy). Set up from Settings, Testing Data. Also called *test data* or *sample*.

**Sample values.** Up to 5 distinct real values per column, captured when a dataset is saved, so the assistant can match the user's wording to stored values.

**Sampled profile.** An approximate profile of a *dataset*'s tables read from up to 1,000 sampled rows per table: types, null rates, distinct counts, ranges, categorical values and text patterns, plus how each column would be synthesized. It is kept in memory for 60 minutes and never stored, it is separate from *data readiness* (whose statistics are exact), and a sampled number never feeds a readiness score. See [../capabilities/synthetic-data/spec.md](../capabilities/synthetic-data/spec.md).

**Synthetic data script.** A `.sql` file (or, as CSV in a zip or an Excel workbook, the same rows) of generated data that copies a *dataset*'s tables: each column's distribution, null rate and format, with keys consistent, and no real identifier, name or free-text value. It is generated by a seeded, deterministic generator from a *sampled profile*, written in the datasource's dialect, downloaded by the user and never run by the app. See [../capabilities/synthetic-data/spec.md](../capabilities/synthetic-data/spec.md).

**Sample export.** A download of the real rows a *sampled profile* was computed from (up to 1,000 per table), as `.sql`, CSV or Excel. The rows are re-read on request, so a changed table can give other rows. It is the only way a raw row leaves the server, it needs the user's explicit confirmation, and it is never logged, cached, saved in a session or sent to a model.

**Schema.** The middle level of an *entity* name.

**Schema layer.** The role of a *schema* in the data pipeline, set per schema in a *dataset*: Landing (raw, as ingested), Normalized (cleaned and conformed) or Consumption (modelled for analysis and reporting). See [../capabilities/datasets/spec.md](../capabilities/datasets/spec.md).

**Schema note.** A *dataset*'s *schema layer* and free-text description for one *schema*. Saved with the dataset and given to the assistant. See [../capabilities/datasets/spec.md](../capabilities/datasets/spec.md).

**Session.** A stored conversation of an earlier version, now a *past chat* (read-only), bound to one or more *datasets*. Holds the transcript, the visuals, and owns one *workspace* and one memory thread. Every session runs one *workflow* on each message (ADR-0040). A session started from a *Live* *user agent* is bound to that agent and runs with its instructions (see [../capabilities/agent-answers/spec.md](../capabilities/agent-answers/spec.md), R52-R59). Legacy name: *project* (collection `projects`, workspace folders `project-<id>`).

**Session panel.** The right-hand panel when the main view is a *session*'s chat. It shows one *panel item* at a time (the *visual* panel, a document, a file or a table), with a menu of everything shown in the session and a Download button. See [agent-panel](../capabilities/agent-panel/spec.md).

**Shared item.** An *ontology item* that belongs to no dataset (`dataset` is null) and so appears in every dataset's Ontology tab, marked "All datasets", and applies to every session. Chosen with "Share with all datasets" when creating an item; old global knowledge snippets migrated to shared items.

**Skill.** A folder of instructions an agent gets: a `SKILL.md` (a name, a "Use when…" description, then a short phase map or router) plus the `phases/` and `reference/` files it names. It loads *on demand* (the framework lists it in a catalog and the model loads it with the skill tool when a request matches) or *by the app* (code sends it when a condition holds). Built-in skills ship with the app (there are no user or project skills); a user can also write *in-app skills* for her agents, and edit a built-in skill's text, which overrides the bundled one. The agent page's Skills tab shows them (see [../system/agents.md](../system/agents.md) 7.3, [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md) R63-R67).

**Starter question.** One of up to five example questions a *user agent* carries. An empty session started from the agent offers them in its welcome block; clicking one fills the composer without sending it.

**Super admin.** The one built-in user of the app, with the fixed id `local`. Every request is made as the super admin, who holds every capability: there is no sign-in, no password and no other user. Its name is not shown anywhere in the interface (agent cards say "Owner: You"). The `ownerId` that older versions stored on documents is kept as an inert attribute and used for nothing. See ADR-0030 in [../system/architecture.md](../system/architecture.md).

**SQL repair.** When a statement fails with an engine error, the *SQL fixer* agent rewrites it and it is re-run, up to 2 repair attempts. The corrected SQL is what gets cited. Guard rejections and transport or auth failures are not repaired.

**SQL verifier.** The agent behind *careful mode*.

**System agent.** One of the built-in helper agents (the visual designer, the SQL fixer, the SQL verifier, the Ontology Bootstrap agent and the eval judge). It is read-only, runs inside the app's own flows and cannot start a chat.

**System logs.** The UI name for *diagnostics*.

**Table.** The last level of an *entity* name.

**Tailoring.** Changing an existing visual by describing the change in plain English, through the chat (`update_visual`) or the panel's instruction box. Produces a new *visual version*.

**Tool call.** One invocation of a capability by the assistant during a turn. Data tools: `list_entities`, `describe_entity`, `sample_rows`, `run_readonly_sql`. Visual tools: `create_visual`, `update_visual`. UI tool: `ask_clarification`. Calls to the data tools are captured as *data records*.

**Tool selection.** The optional *tool calls* a *user agent* lets the assistant make: any of `sample_rows`, `ask_clarification` and the visual tools. The data tools that list, describe and query the datasets are always on. A tool left out is not offered to the model, and the working rules that name it are replaced. See [../system/agents.md](../system/agents.md) 2.1 and ADR-0022.

**Turn.** One user message and everything the assistant does in response, up to its final answer or a clarification. Includes streamed reasoning, tool calls and their results.

**User agent.** An agent a user builds: a name, a description, instructions, the datasets it may query, starter questions and an optional model or reasoning-effort override. It runs on the *assistant* with the same guards and the tools its *tool selection* gives it, and it has a *draft* and, once published, a *Live* version.

**User persona.** A short profile of a kind of person who asks the questions: a name, role, description, goals, typical questions, an expertise and a preferred answer style. Kept in the Context area under "User personas". Manage-only today: agents and sessions do not use personas yet. Not a login or an account. The **expertise** is `novice`, `intermediate` (the default) or `expert`; a **typical question** is one question the persona would ask (up to 10, 300 characters each); the **answer style** is how they like answers (up to 500 characters). See [user-personas](../capabilities/user-personas/spec.md).

**Verified answer.** An answer whose final SQL matches a stored *verified query*, or that the user thumbed up. Shown with a "Verified" badge.

**Verified query.** A question and SQL pair saved when the user thumbs up an answer. The last successful SQL statement of the answer is stored, with the datasource and entities. Similar questions later get the closest pairs as reference. Can be promoted to a *metric*.

**Visuals library.** A catalog of chart types for data visualization, grouped by category (Comparison, Change over time, Part-to-whole, Distribution, Relationship, Ranking, Flow, Spatial, Numbers and tables). Each **chart** has a name, category, preview thumbnail, description, when to use, when to avoid, the data shape it needs, an enabled flag and a **renderer form**: the visual-spec form the app draws it with (`bar`, `line`, `scatter`, `heatmap`, `metric-cards`, `table`, `donut`), or none when the app does not draw it. 30 default charts are seeded once and are editable and deletable. Kept in the Context area under "Visuals". Manage-only today: agents, the visual designer and sessions do not use it yet. Not the *visuals* a session creates. See [visuals-library](../capabilities/visuals-library/spec.md).

**Visual / visualization.** An interactive, sandboxed chart document created from an answer's data. Has a title, a description (the takeaway), a *visual version* history and files in the session's workspace. Framed with the question, the analysis, a data provenance section and a footer. The code and API say "visualization"; the UI says "visual".

**Visual spec.** A small JSON description of a chart (forms: bar, line, scatter, heatmap, metric cards, table, donut) rendered by a fixed runtime. Preferred over freeform generation because it cannot break on bad generated code.

**Visual version.** One immutable snapshot of a visual. Version 1 is created from the answer; each tailoring adds a version with its instruction. *Revert* moves the current-version pointer; it does not delete versions. A *refresh* re-runs the SQL and rewrites the current version's data in place without adding a version. An *auto-repair* version carries the instruction prefix `auto-repair: `.

**Warning.** A fault note from a *result guard*, shown with the data record and returned to the assistant so it re-runs before answering.

**Workflow.** What a chat runs on every message: a fixed sequence of steps defined in code, each one deterministic code or a call to an *agent*. Every *session* runs one workflow: a *code-defined workflow* or an agent's *one-step workflow*. Workflows are listed in the Workflows area and never edited in the app. The hierarchy is workflows → agents → skills → tools. See [../system/architecture.md](../system/architecture.md) ADR-0040.

**Workflow bar.** The strip pinned under the page header, above the chat, that shows the steps of the process an agent is guiding the user through, the status of each (done, current, waiting for the user, skipped), and what the agent needs now. The agent drives it with `update_workflow`; its steps come from the agent's *workflow section*, or from the agent itself when it has none. See [agent-panel](../capabilities/agent-panel/spec.md) R13 to R20.

**Workflow phase.** One step of an agent's *workflow section*: a numbered list line, optionally linked to the *skill* it uses. The agent marks the phase in progress and the completed phases with `update_workflow`, and the *workflow bar* shows them, with every step in its Details dropdown. See [agent-panel](../capabilities/agent-panel/spec.md) R8 and R16 to R17a.

**Workflow section.** The part of an agent's instructions that starts at the line `## Workflow`; the app reads its numbered lines as the agent's *workflow phases*, so the workflow bar shows every phase from the first turn. See [agent-panel](../capabilities/agent-panel/spec.md) R8.

**Workspace.** A contained folder on disk, one per session, where the session's visuals and reports are stored. Created with the session and rediscovered on restart. Legacy folder name: `project-<id>`.

<!-- sources: backend/src/modules/*/entities/*.ts, backend/src/modules/datasets/repositories/datasets.repository.ts, backend/src/modules/datasets/relationships.ts, backend/src/modules/agents/*.ts, backend/src/modules/llm/llm.types.ts, backend/src/modules/sessions/entities/session.entity.ts, backend/src/modules/sessions/visual-spec.ts, backend/src/modules/sessions/visualization.service.ts, backend/src/mastra/tools/*.ts, backend/src/mastra/agents/*.ts, backend/src/infrastructure/database/database.module.ts, frontend/src/app/features/*/models/*.ts, frontend/src/app/app.html, frontend/src/app/features/sessions/components/session-chat/session-chat.html -->

# Glossary

Every domain term, defined once, in alphabetical order. Other specs link here instead of redefining. Where a concept was renamed, the legacy name is given, because old data and old code comments still use it.

Names in `code font` are the identifiers used in persisted documents and the API. Plain names are what the UI shows.

**Active visual.** The visual currently open in the right-hand panel. The assistant tailors it by default when the user asks for a change. See *Visual*.

**Agent.** A configured LLM role with its own instructions, optional tools and optional memory. The product ships eight built-in agents: the assistant, the *legacy assistant* (hidden, evals only), the visual designer, the SQL fixer, the *query fixer*, the *query verifier*, the knowledge bootstrap agent and the eval judge. Users can build their own (*user agent*). See [../system/agents.md](../system/agents.md). The *Agent Hub* lists them all.

**Agent error.** In *org server mode*, a chat turn in a session started from a *user agent* that ended in an error instead of an answer. A stopped turn, a refused request and a preview turn don't count. The admin Overview counts agents with errors in the last 7 days. See [../capabilities/admin/spec.md](../capabilities/admin/spec.md) R40.

**Agent Hub.** The Agents screen. It shows every agent as a card, grouped in sections (Official, Mine and System, pinned cards first), with a search over name and description, filter pills (All, Pinned, Official and Mine) and a *pin* on each card. A card opens the agent's detail view. See [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md).

**Angle.** One sub-question of a *deep analysis*. A plan has between 3 and 5 angles (hard cap 5). Each is investigated on its own.

**Answer.** The assistant's final message in a *turn*, together with the evidence stored with it: result rows, SQL, logical queries, entities, interpretation, reasoning trail, knowledge used, the *model versions* it was answered from, whether it was *outside the data model*, and any badges.

**App secret.** The key material from which the key that encrypts stored LLM API keys is derived. On desktop it is generated once and kept in a file in the data directory. See [non-functional.md](non-functional.md).

**Approver.** A *role* that approves org-wide publishing of agents (*Approve org-wide publishing*, *View audit log*). Nothing uses it yet; the Requests epic does. See [../capabilities/admin/spec.md](../capabilities/admin/spec.md).

**Assistant.** The main agent. It answers business questions over the *data models* of a session's datasets: it reads the model's entities, asks for data with *logical queries* (raw SQL only as a flagged last resort, see *Outside the data model*), calls the visual tools and asks clarifying questions. It is never shown a table name or a SQL dialect.

**Attribute.** A named, typed field of a logical *entity* in a *data model* (types `string`, `integer`, `number`, `boolean`, `date`, `datetime`, `time`, `json`, `unknown`), with an optional role (`key`, `dimension`, `measure` or `time`), description and sample values. The data model's counterpart of a column; its *binding* maps it to the physical column when the names differ.

**Binding.** The part of a *data model* entity that says where its rows physically live: a kind (`sql` for a table, `rest` for a REST endpoint; `mongo` and `file` are accepted but cannot be queried yet), the datasource, the physical address and any column renames. Only the compiler reads bindings; the assistant never sees them.

**Bootstrap admin.** A person whose user name (for Entra ID the UPN, which usually looks like an email) is in the org server's bootstrap admin list (`ORG_BOOTSTRAP_ADMINS`). They hold *Platform admin* whenever they are signed in, without a stored assignment, so a new org server always has an admin. See [../capabilities/admin/spec.md](../capabilities/admin/spec.md).

**Careful mode.** An opt-in per-turn setting in the chat. After the assistant answers, a second agent (the *query verifier*) re-derives a *logical query* independently, the system compiles and runs it, and compares its result set with the answer's. The answer gets an agree, disagree or error badge. Slower per answer. See *Cross-check*.

**Catalog.** The top level of an *entity* name. A Databricks Unity Catalog catalog; the database name on PostgreSQL; `api` on a REST API datasource. See *Entity*.

**Clarification.** A question the assistant asks the user, with 2 to 4 options, when interpretations diverge materially. The turn ends; the user's pick (or typed answer) arrives as the next message. At most one per user question.

**Cross-check.** The result of *careful mode* on one answer: status `agree` (same results), `disagree` (results differ) or `error` (the check could not finish), plus a short note.

**Data directory.** The folder holding all app data: application database, agent memory, observability data, per-session *workspaces* and the *app secret* file. Desktop and web mode use different data directories on purpose.

**Data model.** A dataset's versioned, storage-neutral description of its data, written in the app's own YAML: logical *entities* with *attributes*, *relationships* with cardinality, *metrics* and *bindings*. Every dataset has one, bootstrapped from its schema snapshot when it is saved (or at startup for older datasets). Versions are immutable; a pointer marks the current one, which is what the assistant sees. Shared like its dataset. See [../capabilities/data-model/spec.md](../capabilities/data-model/spec.md).

**Data owner.** A *role* scoped to one *datasource*. It will approve access requests to that datasource (*Approve access to a data source*); until the Requests epic it guards nothing.

**Developer observability.** An opt-in developer setting, off by default. When it is on, the backend exports agent traces to Arize Phoenix and backend traces, metrics and logs to an OpenTelemetry (OTLP) endpoint, in addition to the local observability store. It takes effect when the backend restarts. See [../capabilities/developer-settings/spec.md](../capabilities/developer-settings/spec.md).

**Data point selection.** The user clicking a mark (bar, segment, point) inside a *visual*. The panel reports it to the chat so the user can ask a follow-up about that value.

**Data record.** The stored result of one data tool call (`query_entities`, `sample_records`, `run_raw_sql`; on the legacy eval path `run_readonly_sql` and `sample_rows`): tool, input (the SQL that ran), columns, rows (capped), total row count, truncated flag, error, rationale, warnings, the *logical query* when there was one, and the *outside the data model* flag for raw SQL.

**Dataset.** A named, saved selection of *entities* from one *datasource*, plus a snapshot of their schema and sample values. Sessions work over datasets, not directly over datasources. Identified by its name; there is no separate id. Legacy name: *sandbox selection* (collection `sandbox_selections`, session field `sandboxes`); the UI once said "sandbox".

**Datasource.** A saved connection to a data platform. Three kinds: `databricks` (a SQL warehouse, via host, token and warehouse id), `postgres` (host, port, database, user, password, SSL) and `rest` (an HTTP API with a base URL, an auth mode and a list of endpoints that are mapped to tables). Legacy name: *connection* (collection `connections`). The first single Databricks connection was migrated to a datasource with id `legacy-databricks`.

**Deep analysis.** A background investigation of one question from several *angles*, producing a downloadable markdown *report*. One at a time per session. The chat stays usable while it runs. The result is posted as an assistant message whose text is the executive summary.

**Default filter.** A *knowledge entry* of kind `default_filter`: a condition (for example "exclude test accounts") the assistant applies to every query unless the question asks for the excluded rows. The answer names the filters applied.

**Diagnostics.** The system log of the app: backend log lines, desktop shell events and interface errors, kept in a bounded buffer, shown in the System logs panel and exportable as a redacted, LLM-readable markdown report. A *log run* groups entries by backend process lifetime.

**Dimension.** An attribute (or column) a *metric* is meaningfully grouped by.

**Draft (agent).** The working copy of a *user agent*. It can be edited and tried in a preview chat, but cannot start sessions. Publishing it makes the agent *Live*. See [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md).

**Drift report.** What changed in a dataset's tables since its *data model* was built: added, removed and changed columns and tables, found when the dataset is saved again. Recorded beside the model; it never overwrites the model.

**Entity.** Two levels, one word. A **physical entity** is a queryable table or view, named in full as `catalog.schema.table`; every datasource kind is normalised to this three-level shape, datasets select physical entities, and one may be *browse-only* (visible but not queryable with the credentials, shown greyed). A **logical entity** is an entity of a *data model*, with a short logical name (for example `matches`), *attributes* and a *binding* to one physical entity. The assistant only ever sees logical entities. The UI says "entities" for both.

**Eval case.** One question in an *eval set*, with the intent it probes and a list of *eval checks* (for example "answer includes Argentina", result-set comparison, or an LLM-judge rubric).

**Eval check.** One scorer that grades an eval case's answer or tool calls.

**Eval run.** One execution of selected eval cases against a datasource and its datasets, on one path: `model` (the assistant) or `legacy` (the *legacy assistant*, for comparison). Records per-question results (pass or fail, scores, tool calls, answer, whether it was *outside the data model*). When a completed earlier run exists for the same agent, datasource and datasets, the run also stores a *regression comparison*.

**Eval set.** A named group of eval cases bound to one *sample fixture* (World Cup on PostgreSQL, World Cup on REST, Formula 1).

**Feedback.** The user's thumbs-up or thumbs-down on an answer. Thumbs-up also saves a *verified query*. Thumbs-down only marks the answer as wrong.

**Fixture.** See *Sample fixture*.

**Foreign key / relationship.** A join link from a column of one dataset entity to a column of another. `declared` when the datasource reports the constraint; `inferred` when guessed from column names (`team_id` to a `teams` table). Inference deliberately skips ambiguous cases. In a *data model* a relationship joins two *attributes* (`entity.attribute -> entity.attribute`), has a cardinality (`one_to_one`, `many_to_one`, `one_to_many`, `many_to_many`), an optional name and a source (`declared`, `inferred` or `user`); *logical queries* join only along declared relationships.

**Freeform visual.** A *visual* whose bundle is generated HTML, CSS and JavaScript, used when a *visual spec* cannot be produced. Tailoring a freeform visual stays freeform. Contrast *spec visual*.

**Group mapping.** A rule that gives every member of an identity-provider group a *role* (for *Data owner*, on one datasource). Members get the role on their next request. Groups themselves come from the identity provider and are read-only in the app. See [../capabilities/admin/spec.md](../capabilities/admin/spec.md).

**Interpretation.** A one-line, deterministic summary of how an answer was produced (which entities, what kind of query), built by the system at save time. Never model output.

**Knowledge entry.** A curated piece of business knowledge the assistant treats as authoritative. Three kinds: `term` (glossary definition, with optional synonyms and entity bindings), `instruction` (a standing rule) and `default_filter`. Scoped globally, to a dataset or to a datasource. Only enabled entries reach the assistant, within a size budget per turn. Source is `user` or `mined` (drafted by the bootstrap agent, saved disabled for review). The UI says "Knowledge". Code and Jira call these *snippets*.

**Knowledge bootstrap.** The action that has an agent draft up to 15 knowledge entries from a dataset's schema and a few sample rows. Drafts arrive as "Pending suggestions", disabled.

**Knowledge used.** The list of knowledge entries that were actually included in the context of one answer, recorded when the context was built. It shows what the model was given, not what it applied.

**Legacy assistant.** The agent `assistant-legacy`: the assistant as it was before *data models*, frozen, writing SQL against physical tables with the tools `run_readonly_sql` and `sample_rows`. It runs only on the eval harness's `legacy` path, to compare answers before and after; it is hidden from the Agent Hub and never chats.

**Live (agent).** The published version of a *user agent*. It is the version that starts sessions. Editing a Live agent changes only its *draft*, and the Live version keeps serving until the draft is published.

**LLM provider.** The service the agents call. `openai`, `anthropic` or `lenai` (Halo's OpenAI-compatible gateway, which needs a base URL; the "model" field is then the deployment name). One global setting: provider, model, API key (stored encrypted, shown masked) and *reasoning effort*.

**Local mode.** The default way the app runs: one person on their own machine, no sign-in, every permission (the *local user*). The desktop app always runs in local mode. Opposite of *org server mode*. See [../capabilities/admin/spec.md](../capabilities/admin/spec.md).

**Local user.** The single implicit user of *local mode* (id `local`, shown as "Demo User"). Owns every item in local mode, including items stored before *org server mode* existed.

**Logical query.** A JSON query over a *data model*'s logical names, not SQL: the entity to start from, the *attributes*, *metrics* or ad-hoc aggregations to select, filters, grouping, ordering, a row limit, and joins along declared relationships. The system resolves it against the model, compiles it to the SQL dialect of the entity's datasource and runs it read-only. The assistant's tool is `query_entities`. See [../capabilities/data-model/spec.md](../capabilities/data-model/spec.md).

**Maker.** A *role* that can create, test, version and publish *user agents* (*Create, test and version agents*), and later share them.

**Message.** One entry in a session's transcript, from the `user` or the `assistant`, with a timestamp that doubles as its identity (`at`). Assistant messages may carry data records, entities, a clarification, a visual event, feedback, a cross-check, a reasoning trail, knowledge used or a report.

**Metric.** A governed, named aggregation over one logical *entity* of a *data model* (for example `denial_rate`), with a label, description and dimensions: a portable aggregation (`sum`, `count`, `count_distinct`, `avg`, `min`, `max` of an attribute, or a `ratio` of two metrics, with an optional filter), or a dialect-specific SQL expression as an escape hatch. The assistant selects it by name in a *logical query* instead of re-deriving it. Metrics live in the data model and are shared like it; each records its author when imported from the legacy metrics store, which predates data models and is now import-only. A metric can be promoted from a *verified query*; the draft is a *metric candidate*. See [../capabilities/metrics/spec.md](../capabilities/metrics/spec.md).

**Mined entry.** A *knowledge entry* with source `mined`.

**Model version.** One immutable, numbered state of a *data model*. Saving, importing or rebuilding adds a version; reverting moves the current-version pointer. An answer records the model version of each dataset it was answered from.

**Official agent.** The app's own *assistant*, shown in the agent hub as the Official agent. It is the only built-in agent that can start a chat.

**Org server mode.** The app run by an organisation on its own server for many people: they sign in with Microsoft Entra ID, the directory is pushed by SCIM, *roles* decide what each person can do, and private data is kept per *owner*. Turned on by server configuration. Opposite of *local mode*. See [../capabilities/admin/spec.md](../capabilities/admin/spec.md).

**Outside the data model.** A flag on an answer (and on an eval question) whose turn called `run_raw_sql`, the last-resort tool that runs SQL directly when a *logical query* cannot express the question. The assistant is told to say so in the answer.

**Ownership transfer.** A *Platform admin* moving one or more *user agents* to another *owner*, for example from a person who left. The agent keeps its *draft* and *Live* version; its sessions stay with their owners. See [../capabilities/admin/spec.md](../capabilities/admin/spec.md) R64.

**Owner.** The user who created a private item (a session with its visuals and memory, a user agent, a pin, a knowledge entry, a verified query, a legacy-store metric, an eval run). Only the owner can see or change it. Datasources, datasets with their *data models* and metrics, and the LLM configuration have no owner: they are shared org-wide. Stored as `ownerId`; absent means the *local user*.

**Permission.** One action a *role* allows, such as *Use agents in the gallery and chat* (`use-agents`) or *Manage datasources and datasets* (`manage-datasources`). Eleven in a fixed matrix; the server checks one on every request. See [../capabilities/admin/spec.md](../capabilities/admin/spec.md).

**Pin.** A user's mark on an agent, built-in or user-built, so it can be found quickly. Pins are stored locally and survive a restart.

**Platform admin.** The *role* that holds every *permission*: manages users, roles, group mappings, policies, datasources, datasets and the LLM configuration, and sees the Admin area.

**Preview chat.** A conversation in the agent editor's Details panel that runs a *user agent*'s saved *draft*. It is held in memory only, never listed with the sessions, and discarded with its memory when the editor closes.

**Query fixer.** The agent that repairs a *logical query* that did not compile because it named an unknown attribute or metric or an ambiguous join path. It runs once, automatically, before the assistant sees an error.

**Query verifier.** The agent behind *careful mode*. It replaced the former SQL verifier.

**Reasoning effort.** How hard a model reasons before answering: one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, of which each model accepts its own subset (its *effort levels*; default `high` when offered). A global setting chosen in Settings → LLM, passed to models that support it, mapped to the nearest level a model accepts, and dropped for models that reject it.

**Reasoning trail.** The "How I worked this out" list on an answer: one step per data-gathering call, with the assistant's plain-language rationale, the statement used and the outcome. The prose is the model's; ordering and outcomes come from what actually ran.

**Report.** The markdown output of a *deep analysis*: title, executive summary, findings by angle, data appendix.

**Result guard.** A deterministic check on a query result that attaches a *warning*: a ratio of a sum to itself, a metric constant on every row, an unordered "top N".

**Role.** A named set of *permissions* given to a user in *org server mode*: **User** (implicit for everyone signed in), *Maker*, *Data owner*, *Approver* or *Platform admin*. Roles are fixed and additive; a user's roles are their direct assignments plus their *group mappings*. See [../capabilities/admin/spec.md](../capabilities/admin/spec.md).

**Row cap.** A limit on rows returned or stored. See [non-functional.md](non-functional.md). A result clipped by a cap is marked *truncated*.

**Sample fixture.** A bundled sample database the app can provision for testing and evals: World Cup (2018 and 2022) and Formula 1. Set up from Settings, Testing Data. Also called *test data* or *sample*.

**Sample values.** Up to 5 distinct real values per column, captured when a dataset is saved, so the assistant can match the user's wording to stored values.

**Schema.** The middle level of an *entity* name.

**Session.** One conversation with the assistant, bound to one or more *datasets*. Holds the transcript, the visuals, and owns one *workspace* and one memory thread. Needs a name and at least one dataset. A session started from a *Live* *user agent* is bound to that agent and runs with its instructions (see [../capabilities/sessions-chat/spec.md](../capabilities/sessions-chat/spec.md), R52-R59). Legacy name: *project* (collection `projects`, workspace folders `project-<id>`).

**Starter question.** One of up to five example questions a *user agent* carries. An empty session started from the agent offers them in its welcome block; clicking one fills the composer without sending it.

**SQL repair.** When a statement fails with an engine error (SQL compiled from a *logical query*, or raw SQL), the *SQL fixer* agent rewrites it and it is re-run, up to 2 repair attempts. The corrected SQL is what gets cited. Guard rejections and transport or auth failures are not repaired. Compile errors of a logical query are the *query fixer*'s job.

**System agent.** One of the six built-in helper agents (the visual designer, the SQL fixer, the query fixer, the query verifier, the knowledge bootstrap agent and the eval judge). It is read-only, runs inside the app's own flows and cannot start a chat.

**System logs.** The UI name for *diagnostics*.

**Table.** The last level of an *entity* name.

**Tailoring.** Changing an existing visual by describing the change in plain English, through the chat (`update_visual`) or the panel's instruction box. Produces a new *visual version*.

**Term.** A *knowledge entry* of kind `term`.

**Tool call.** One invocation of a capability by the assistant during a turn. Data tools: `list_entities`, `describe_entity`, `sample_records`, `query_entities` (a *logical query*) and `run_raw_sql` (the last resort, see *Outside the data model*); the *legacy assistant* has `list_entities`, `describe_entity`, `sample_rows` and `run_readonly_sql` instead. Visual tools: `create_visual`, `update_visual`. UI tool: `ask_clarification`. Calls to the data tools are captured as *data records*.

**Turn.** One user message and everything the assistant does in response, up to its final answer or a clarification. Includes streamed reasoning, tool calls and their results.

**User status.** How the Admin area describes a directory user: **Active**, **Inactive** (no activity for 90 days or more), **Not signed in** (provisioned but never signed in) or **Deactivated** (turned off by the identity provider). Derived, never stored. See [../capabilities/admin/spec.md](../capabilities/admin/spec.md) R39.

**User agent.** An agent a user builds: a name, a description, instructions, the datasets it may query, starter questions and an optional model or reasoning-effort override. It runs on the *assistant* with the same tools and guards, and it has a *draft* and, once published, a *Live* version.

**Verified answer.** An answer whose final SQL matches a stored *verified query*, or that the user thumbed up. Shown with a "Verified" badge.

**Verified query.** A question and SQL pair saved when the user thumbs up an answer. The last successful SQL statement of the answer is stored, with its *logical query* when it had one, the datasource and entities. Only pairs with a logical query are shown to the assistant. Similar questions later get the closest pairs as reference. Can be promoted to a *metric*.

**Visual / visualization.** An interactive, sandboxed chart document created from an answer's data. Has a title, a description (the takeaway), a *visual version* history and files in the session's workspace. Framed with the question, the analysis, a data provenance section and a footer. The code and API say "visualization"; the UI says "visual".

**Visual spec.** A small JSON description of a chart (forms: bar, line, scatter, heatmap, metric cards, table, donut) rendered by a fixed runtime. Preferred over freeform generation because it cannot break on bad generated code.

**Visual version.** One immutable snapshot of a visual. Version 1 is created from the answer; each tailoring adds a version with its instruction. *Revert* moves the current-version pointer; it does not delete versions. A *refresh* re-runs the SQL and rewrites the current version's data in place without adding a version. An *auto-repair* version carries the instruction prefix `auto-repair: `.

**Warning.** A fault note from a *result guard*, shown with the data record and returned to the assistant so it re-runs before answering.

**Workspace.** A contained folder on disk, one per session, where the session's visuals and reports are stored. Created with the session and rediscovered on restart. Legacy folder name: `project-<id>`.

<!-- sources: backend/src/modules/*/entities/*.ts, backend/src/modules/data-models/schema/data-model.schema.ts, backend/src/modules/data-models/query/logical-query.ts, backend/src/modules/datasets/repositories/datasets.repository.ts, backend/src/modules/datasets/relationships.ts, backend/src/modules/agents/*.ts, backend/src/modules/llm/llm.types.ts, backend/src/modules/sessions/entities/session.entity.ts, backend/src/modules/sessions/visual-spec.ts, backend/src/modules/sessions/visualization.service.ts, backend/src/mastra/tools/*.ts, backend/src/mastra/agents/*.ts, backend/src/infrastructure/database/database.module.ts, frontend/src/app/features/*/models/*.ts, frontend/src/app/app.html, frontend/src/app/features/sessions/components/session-chat/session-chat.html -->

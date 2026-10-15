# Glossary

Every domain term, defined once, in alphabetical order. Other specs link here instead of redefining. Where a concept was renamed, the legacy name is given, because old data and old code comments still use it.

Names in `code font` are the identifiers used in persisted documents and the API. Plain names are what the UI shows.

**Active visual.** The visual currently open in the right-hand panel. The assistant tailors it by default when the user asks for a change. See *Visual*.

**Agent.** A configured LLM role with its own instructions, optional tools and optional memory. The product ships eleven built-in agents (the assistant, the *RFP Builder*, the four *showcase agents*, the visual designer, the SQL fixer, the SQL verifier, the knowledge bootstrap agent and the eval judge), and users can build their own (*user agent*). See [../system/agents.md](../system/agents.md). The *Agent Hub* lists them all.

**Agent Hub.** The Agents screen. It shows every agent as a card, grouped in sections (Official, which holds the *Official agents*: the assistant, the *RFP Builder* and the *showcase agents*; Mine; and System; pinned cards first), with a search over name and description, filter pills (All, Pinned, Official and Mine) and a *pin* on each card. A card opens the agent's detail view. See [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md).

**Angle.** One sub-question of a *deep analysis*. A plan has between 3 and 5 angles (hard cap 5). Each is investigated on its own.

**Answer.** The assistant's final message in a *turn*, together with the evidence stored with it: result rows, SQL, entities, interpretation, reasoning trail, knowledge used and any badges.

**App secret.** The key material from which the key that encrypts stored LLM API keys is derived. On desktop it is generated once and kept in a file in the data directory. See [non-functional.md](non-functional.md).

**Assistant.** The main agent. It answers business questions over a session's datasets, runs SQL, calls the visual tools and asks clarifying questions.

**Careful mode.** An opt-in per-turn setting in the chat. After the assistant answers, a second agent (the *SQL verifier*) re-derives the SQL independently, runs it, and compares its result set with the answer's. The answer gets an agree, disagree or error badge. Slower per answer. See *Cross-check*.

**Carrier.** An insurer that writes one or more *lines of coverage*. A carrier is the *incumbent* on a client's line when it carries the client's live policy for that line. The *RFP Builder* proposes the carriers to invite to bid on an *RFP*. See [../capabilities/rfp/spec.md](../capabilities/rfp/spec.md).

**Catalog.** The top level of an *entity* name. A Databricks Unity Catalog catalog; the database name on PostgreSQL; `api` on a REST API datasource. See *Entity*.

**Census.** A client's employee data for one plan year: headcount, eligible and enrolled employees, average age and salary, gender split, employees by state, enrolment by coverage tier and by employee class. The census names its own plans, which are mapped to the client's *plan designs*. It is the first *exhibit* of an *RFP package*.

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

**Exhibit.** A table attached to an *RFP package* as a CSV file with a header row, computed from the Intellify data for the RFP's client and lines in scope: A census, B plan designs, C financials and D carriers.

**Feedback.** The user's thumbs-up or thumbs-down on an answer. Thumbs-up also saves a *verified query*. Thumbs-down only marks the answer as wrong.

**Fixture.** See *Sample fixture*.

**Foreign key / relationship.** A join link from a column of one dataset entity to a column of another. `declared` when the datasource reports the constraint; `inferred` when guessed from column names (`team_id` to a `teams` table). Used to tell the assistant which columns join. Inference deliberately skips ambiguous cases.

**Freeform visual.** A *visual* whose bundle is generated HTML, CSS and JavaScript, used when a *visual spec* cannot be produced. Tailoring a freeform visual stays freeform. Contrast *spec visual*.

**Built-in agent prompt override.** An edit of the *system prompt* of a built-in agent (an *Official agent* or a System agent), made on the agent's System Prompt tab. It is stored in the database, and replaces the shipped prompt on the next call, for every session and user agent, until **Reset to built-in** deletes it. The assistant's generated `## Tools` section is not part of the edited text. See [../system/data-model.md](../system/data-model.md) 3.10.3 and ADR-0026.

**Built-in skill override.** An edit of a built-in *skill*, made in the skills library. It is stored in the database, and replaces the shipped skill on the next call until **Reset to built-in** deletes it. See [../system/data-model.md](../system/data-model.md) 3.10.2 and ADR-0023.

**In-app skill.** A *skill* a user writes in the app (the skills library) instead of a folder: a name, a "Use when…" description, a body and reference files, stored in the database. It reaches a session only through a *user agent* whose instructions *link* it, and a *Live* agent runs on the copy taken when it was published. See [../system/data-model.md](../system/data-model.md) 3.10.1 and ADR-0022.

**Intellify RFP API.** The REST API the app ships for the *RFP Builder*: read routes over the Intellify sample data and the store of *RFP* records, protected by an API key and described by an OpenAPI document. It starts with the app by default, on its own port, and can also run on its own. The app reaches it through the REST *datasource* that the "Intellify RFP API" *sample fixture* registers. See [../capabilities/rfp/spec.md](../capabilities/rfp/spec.md) and ADR-0027.

**Interpretation.** A one-line, deterministic summary of how an answer was produced (which entities, what kind of query), built by the system at save time. Never model output.

**Knowledge entry.** A curated piece of business knowledge the assistant treats as authoritative. Three kinds: `term` (glossary definition, with optional synonyms and entity bindings), `instruction` (a standing rule) and `default_filter`. Scoped globally, to a dataset or to a datasource. Only enabled entries reach the assistant, within a size budget per turn. Source is `user` or `mined` (drafted by the bootstrap agent, saved disabled for review). The UI says "Knowledge". Code and Jira call these *snippets*.

**Knowledge bootstrap.** The action that has an agent draft up to 15 knowledge entries from a dataset's schema and a few sample rows. Drafts arrive as "Pending suggestions", disabled.

**Knowledge used.** The list of knowledge entries that were actually included in the context of one answer, recorded when the context was built. It shows what the model was given, not what it applied.

**Line of coverage.** A kind of employee benefit a client offers and a *carrier* insures, such as medical, dental, vision, life, disability, voluntary benefits or an employee assistance programme. The Intellify data has 12 (its *products*). Also called a *line*. An *RFP* markets one or more lines.

**Link (skill or tool).** A reference written in an agent's instructions (or, for a tool, in an in-app skill's body) with `/` in the editor: shown as a chip, saved as `[[skill:<name>]]` or `[[tool:<name>]]`. The links decide which skills and optional tools the agent gets, and the model sees each as a plain mention (`the "x" tool`). See [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md) R81-R86 and ADR-0024.

**Live (agent).** The published version of a *user agent*. It is the version that starts sessions. Editing a Live agent changes only its *draft*, and the Live version keeps serving until the draft is published.

**LLM provider.** The service the agents call. `openai`, `anthropic` or `lenai` (Halo's OpenAI-compatible gateway, which needs a base URL; the "model" field is then the deployment name). One global setting: provider, model, API key (stored encrypted, shown masked) and *reasoning effort*.

**Message.** One entry in a session's transcript, from the `user` or the `assistant`, with a timestamp that doubles as its identity (`at`). Assistant messages may carry data records, entities, a clarification, a visual event, feedback, a cross-check, a reasoning trail, knowledge used or a report.

**Metric.** A governed, named SQL aggregation expression over one entity (for example `denial_rate`), with a label, description and dimensions. The assistant reuses its expression verbatim instead of re-deriving it. Metrics are the app's lightweight semantic layer. A metric can be promoted from a *verified query*; the draft is a *metric candidate*.

**Mined entry.** A *knowledge entry* with source `mined`.

**Official agent.** One of the app's own agents shown in the agent hub's Official section: the *assistant*, the *RFP Builder* and the four *showcase agents*. The assistant and the RFP Builder are the only built-in agents that can start a chat; the showcase agents cannot yet.

**Panel item.** One thing an agent showed in the right panel with `show_in_panel`, saved on the *session* with the time it was shown: a workspace file, a Markdown document, a query result table or a *visual*. The latest one is what the panel opens on; every one is listed in the *session panel*'s shown-items menu. See [agent-panel](../capabilities/agent-panel/spec.md).

**Pin.** A user's mark on an agent, built-in or user-built, so it can be found quickly. Pins are stored locally and survive a restart.

**Plan design.** One benefit plan a client offers on a *line of coverage*: its carrier, funding type (for example fully insured or self-funded), plan type and state, with the financials of its coverage (premiums, rates by tier, enrolment, contributions and fees).

**Preview chat.** A conversation in the agent editor's Details panel that runs a *user agent*'s saved *draft*. It is held in memory only, never listed with the sessions, and discarded with its memory when the editor closes.

**Reasoning effort.** How hard a model reasons before answering: one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, of which each model accepts its own subset (its *effort levels*; default `high` when offered). A global setting chosen in Settings → LLM, passed to models that support it, mapped to the nearest level a model accepts, and dropped for models that reject it.

**Reasoning trail.** The "How I worked this out" list on an answer: one step per data-gathering call, with the assistant's plain-language rationale, the statement used and the outcome. The prose is the model's; ordering and outcomes come from what actually ran.

**Renewal kick-off.** The date work on a line's renewal starts: the renewal effective date minus the policy's kick-off timing, a number of days. Intellify plans are taken to run by calendar year, so a renewal takes effect on 1 January after the plan year. An *RFP*'s timeline is built from the kick-off and the effective date.

**Report.** The markdown output of a *deep analysis*: title, executive summary, findings by angle, data appendix.

**Result guard.** A deterministic check on a query result that attaches a *warning*: a ratio of a sum to itself, a metric constant on every row, an unordered "top N".

**RFP (request for proposal).** The document a benefits consultant sends *carriers* to invite bids on a client's *lines of coverage* at renewal. In the app, an RFP record kept by the *Intellify RFP API*: the client, plan year, effective date, status (`draft`, `ready`, `issued` or `closed`, moving forward only), the last completed stage, narrative sections, and the lines in scope, carriers invited, requirements and timeline. See [../capabilities/rfp/spec.md](../capabilities/rfp/spec.md).

**RFP Builder.** The second *Official agent*: a built-in agent that walks a Mercer benefits consultant through building an *RFP* for one client in seven stages over the Intellify data, saves each decision the consultant confirms through the *Intellify RFP API*, and assembles the *RFP package*. It has its own prompt, one skill per stage and its own tools, and no SQL tool. See [../capabilities/rfp/spec.md](../capabilities/rfp/spec.md) and [../system/agents.md](../system/agents.md).

**RFP package.** What the *RFP Builder* hands the consultant for one *RFP*: the RFP document in Markdown and PDF, the four *exhibits* as CSV files and a manifest, together in one zip that downloads from the chat. It is regenerated from the stored record and the live data on every export.

**Row cap.** A limit on rows returned or stored. See [non-functional.md](non-functional.md). A result clipped by a cap is marked *truncated*.

**Sample fixture.** A bundled sample database the app can provision for testing and evals: World Cup (2018 and 2022), Formula 1 and Intellify (an employee-benefits data model with synthetic data). Set up from Settings, Testing Data. Also called *test data* or *sample*.

**Sample values.** Up to 5 distinct real values per column, captured when a dataset is saved, so the assistant can match the user's wording to stored values.

**Schema.** The middle level of an *entity* name.

**Session.** One conversation with the assistant, bound to one or more *datasets*. Holds the transcript, the visuals, and owns one *workspace* and one memory thread. Needs a name and at least one dataset. A session started from a *Live* *user agent* is bound to that agent and runs with its instructions (see [../capabilities/sessions-chat/spec.md](../capabilities/sessions-chat/spec.md), R52-R59). A session started from the *RFP Builder* is bound to it and runs it on every turn (see [../capabilities/rfp/spec.md](../capabilities/rfp/spec.md)). Legacy name: *project* (collection `projects`, workspace folders `project-<id>`).

**Session panel.** The right-hand panel when the main view is a *session*'s chat. It shows one *panel item* at a time (the *visual* panel, a document, a file or a table), with a menu of everything shown in the session and a Download button. See [agent-panel](../capabilities/agent-panel/spec.md).

**Showcase agent.** An *Official agent* shown to present a further US Health use case before it can chat: the Benchmarking Agent, the Survey Agent, the LAD COE Agent (Life, Absence and Disability Center of Excellence) and the Strategy Agent. It has a description and an editable system prompt, but no tools, dataset, skills or evals; its card carries a `Showcase` chip and its Start chat is always disabled with `Showcase agent: not available to chat yet.` See [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md) R106 and [../system/agents.md](../system/agents.md) 2.9.

**Skill.** A folder of instructions an agent gets: a `SKILL.md` (a name, a "Use when…" description, then a short phase map or router) plus the `phases/` and `reference/` files it names. It loads *on demand* (the framework lists it in a catalog and the model loads it with the skill tool when a request matches) or *by the app* (code sends it when a condition holds). Built-in skills ship with the app (there are no user or project skills); a user can also write *in-app skills* for her agents, and edit a built-in skill's text, which overrides the bundled one. The agent page's Skills tab shows them (see [../system/agents.md](../system/agents.md) 7.3, [../capabilities/agents-evals/spec.md](../capabilities/agents-evals/spec.md) R63-R67).

**Starter question.** One of up to five example questions a *user agent* carries. An empty session started from the agent offers them in its welcome block; clicking one fills the composer without sending it.

**Super admin.** The one built-in user of the app, with the fixed id `local`. Every request is made as the super admin, who holds every capability: there is no sign-in, no password and no other user. Its name is not shown anywhere in the interface (agent cards say "Owner: You"). The `ownerId` that older versions stored on documents is kept as an inert attribute and used for nothing. See ADR-0030 in [../system/architecture.md](../system/architecture.md).

**SQL repair.** When a statement fails with an engine error, the *SQL fixer* agent rewrites it and it is re-run, up to 2 repair attempts. The corrected SQL is what gets cited. Guard rejections and transport or auth failures are not repaired.

**SQL verifier.** The agent behind *careful mode*.

**System agent.** One of the built-in helper agents (the visual designer, the SQL fixer, the SQL verifier, the knowledge bootstrap agent and the eval judge). It is read-only, runs inside the app's own flows and cannot start a chat.

**System logs.** The UI name for *diagnostics*.

**Table.** The last level of an *entity* name.

**Tailoring.** Changing an existing visual by describing the change in plain English, through the chat (`update_visual`) or the panel's instruction box. Produces a new *visual version*.

**Term.** A *knowledge entry* of kind `term`.

**Tool call.** One invocation of a capability by the assistant during a turn. Data tools: `list_entities`, `describe_entity`, `sample_rows`, `run_readonly_sql`. Visual tools: `create_visual`, `update_visual`. UI tool: `ask_clarification`. Calls to the data tools are captured as *data records*.

**Tool selection.** The optional *tool calls* a *user agent* lets the assistant make: any of `sample_rows`, `ask_clarification` and the visual tools. The data tools that list, describe and query the datasets are always on. A tool left out is not offered to the model, and the working rules that name it are replaced. See [../system/agents.md](../system/agents.md) 2.1 and ADR-0022.

**Turn.** One user message and everything the assistant does in response, up to its final answer or a clarification. Includes streamed reasoning, tool calls and their results.

**User agent.** An agent a user builds: a name, a description, instructions, the datasets it may query, starter questions and an optional model or reasoning-effort override. It runs on the *assistant* with the same guards and the tools its *tool selection* gives it, and it has a *draft* and, once published, a *Live* version.

**Verified answer.** An answer whose final SQL matches a stored *verified query*, or that the user thumbed up. Shown with a "Verified" badge.

**Verified query.** A question and SQL pair saved when the user thumbs up an answer. The last successful SQL statement of the answer is stored, with the datasource and entities. Similar questions later get the closest pairs as reference. Can be promoted to a *metric*.

**Visual / visualization.** An interactive, sandboxed chart document created from an answer's data. Has a title, a description (the takeaway), a *visual version* history and files in the session's workspace. Framed with the question, the analysis, a data provenance section and a footer. The code and API say "visualization"; the UI says "visual".

**Visual spec.** A small JSON description of a chart (forms: bar, line, scatter, heatmap, metric cards, table, donut) rendered by a fixed runtime. Preferred over freeform generation because it cannot break on bad generated code.

**Visual version.** One immutable snapshot of a visual. Version 1 is created from the answer; each tailoring adds a version with its instruction. *Revert* moves the current-version pointer; it does not delete versions. A *refresh* re-runs the SQL and rewrites the current version's data in place without adding a version. An *auto-repair* version carries the instruction prefix `auto-repair: `.

**Warning.** A fault note from a *result guard*, shown with the data record and returned to the assistant so it re-runs before answering.

**Workflow bar.** The strip pinned under the page header, above the chat, that shows the steps of the process an agent is guiding the user through, the status of each (done, current, waiting for the user, skipped), and what the agent needs now. The agent drives it with `update_workflow`; its steps come from the agent's *workflow section*, or from the agent itself when it has none. See [agent-panel](../capabilities/agent-panel/spec.md) R13 to R20.

**Workflow phase.** One step of an agent's *workflow section*: a numbered list line, optionally linked to the *skill* it uses. The agent marks the phase in progress and the completed phases with `update_workflow`, and the *workflow bar* shows them, with every step in its Details dropdown. See [agent-panel](../capabilities/agent-panel/spec.md) R8 and R16 to R17a.

**Workflow section.** The part of an agent's instructions that starts at the line `## Workflow`; the app reads its numbered lines as the agent's *workflow phases*, so the workflow bar shows every phase from the first turn. See [agent-panel](../capabilities/agent-panel/spec.md) R8.

**Workspace.** A contained folder on disk, one per session, where the session's visuals and reports are stored. Created with the session and rediscovered on restart. Legacy folder name: `project-<id>`.

<!-- sources: backend/src/modules/*/entities/*.ts, backend/src/modules/datasets/repositories/datasets.repository.ts, backend/src/modules/datasets/relationships.ts, backend/src/modules/agents/*.ts, backend/src/modules/llm/llm.types.ts, backend/src/modules/sessions/entities/session.entity.ts, backend/src/modules/sessions/visual-spec.ts, backend/src/modules/sessions/visualization.service.ts, backend/src/mastra/tools/*.ts, backend/src/mastra/agents/*.ts, backend/src/infrastructure/database/database.module.ts, frontend/src/app/features/*/models/*.ts, frontend/src/app/app.html, frontend/src/app/features/sessions/components/session-chat/session-chat.html -->

# Vision

Questions to Insights (shipped as the desktop app "Halo BI Assistant") lets a person ask a question about their own data in plain English and get back an answer, the SQL behind it, and an interactive visual they can reshape by talking to it.

## The problem

- Business questions about data sit behind SQL, dashboards and analyst queues. The person with the question is rarely the person who can write the query.
- Generic chat assistants answer data questions from memory or guess at the schema. The figures look plausible and cannot be checked.
- Raw database schemas do not carry business meaning. "Revenue", "active" and "denied" mean something specific in each company, and a model reading column names alone drifts from that meaning.
- Static charts cannot be adjusted in the moment. Changing a chart means going back to a tool or an analyst.

## Who it is for

These personas are derived from the product's copy, sample data and research notes. Open question: no persona document exists in the repository, so confirm them with the product owner.

| Persona | Goal | What they need from the product |
|---|---|---|
| Business user / product owner | Get a trustworthy number or chart without writing SQL. | Plain-language questions, answers that name entities rather than ids, a visible route from question to figure, charts they can tweak by asking. |
| Data analyst | Make the assistant reliable for everyone else, and check its work. | Datasets scoped to the right tables, curated knowledge (terms, standing instructions, default filters), governed metrics, verified queries, access to every SQL statement and result row. |
| Evaluator / maintainer (internal) | Know whether a change made answers better or worse. | Repeatable eval sets with pass/fail per question and run-to-run comparison, diagnostics for support. |

## The value

- **Self-service answers.** A question in, a grounded answer out, in one chat turn.
- **Trust by construction.** Every figure comes from SQL that actually ran on the user's data in this conversation. The SQL, the rows and the entities used are one click away.
- **Meaning that sticks.** Analysts record what terms and filters mean once. Every later answer follows it.
- **Visuals that join the conversation.** A chart is created from an answer, then tailored in plain English, versioned, and reverted if the change is worse.
- **Runs where the data is.** The app works on the user's machine against the user's databases, with the user's own LLM account.

## Product principles

The product SHALL follow these principles. Capability specs turn them into testable rules.

1. **Local-first.** App data (settings, datasources, datasets, sessions, memory, visuals) lives on the user's machine in a data directory the user can back up. There is no hosted backend and no account. See [non-functional.md](non-functional.md).
2. **Read-only access to user data.** The assistant can only read. Any statement that writes, alters or drops is rejected before it reaches the database.
3. **Only two things leave the machine.** Calls to the configured LLM provider and queries to the user's datasources. The product sends no analytics or usage telemetry.
4. **Traceable answers.** Every factual claim about the data must come from a query the assistant ran in this conversation. Each answer keeps the SQL, the result rows, the entities used and a plain-language account of the steps taken.
5. **Say what is uncertain.** Truncated results, empty results, auto-corrected SQL, suspicious figures (a ratio of a sum to itself, a metric identical on every row) and out-of-scope questions are surfaced to the user, never hidden.
6. **Business meaning outranks inference.** Curated knowledge and governed metrics outrank what the model infers from column names and sample values. The data itself still outranks the knowledge: the assistant never invents rows to fit a definition.
7. **Ask only when it matters.** The assistant asks at most one clarifying question per user question, and only when interpretations diverge materially. When only the scope is fuzzy, it picks the natural default and states the assumption.
8. **Visuals are conversation participants.** A visual is created from an answer, shown in a side panel, tailored by instruction, versioned, refreshable from its SQL, and exportable. It is not a one-off artifact.
9. **Deterministic frame, generative core.** Provenance, titles, source lists and similar context come from stored facts, never from model output, so readability and honesty do not depend on the model.
10. **Learn from approval.** A thumbs-up saves the question and its SQL as a verified query that guides later, similar questions. Accuracy compounds without a curation project.
11. **Measured, not assumed.** Quality is checked with repeatable eval sets against known-correct answers.
12. **Same app, two doors.** One desktop installer, and one npm command that serves the same app in a browser.

## What the product deliberately is not

- Not a data warehouse, ETL tool or data modelling tool. It reads from sources; it never loads, writes or transforms them.
- Not a dashboard builder. Visuals belong to a conversation, not to a shared board. Open question: no sharing or publishing of visuals exists beyond local export.
- Not multi-user. There is no login, no roles and no shared server. The visible "Demo User" in the sidebar is a placeholder.
- Not a SQL editor. Users read and learn from the SQL but do not author it in the product. Open question: confirm there is no manual "run SQL" surface (none was found).
- Not a hosted service. It makes no calls to a Halo-operated backend.
- Not tied to one LLM vendor. OpenAI, Anthropic and an OpenAI-compatible gateway (LenAI) are supported. Claude subscription logins are not a supported provider.
- Not a replacement for a governed semantic layer. Metrics and knowledge are lightweight, app-managed definitions that need no feature enabled in the user's warehouse.

## Where it is going

The 1.0 Beta (target 2026-10-31) hardens the connectors (Databricks, PostgreSQL, REST API), adds a golden dataset with evals, a data model DSL, an ontology-based knowledge store and answer trust signals. See `roadmap.md` at the repository root for scope and status. Open question: the phase plans in `docs/plans/` (answer reliability, trust UX, visual quality, strategic bets) appear fully shipped in the code (SQL repair, verified queries, interpretation line, truncation markers, chart heuristic, runtime repair, click-to-follow-up, metrics, careful mode, deep analysis), but the roadmap still lists them as unsequenced backlog. Confirm their status.

<!-- sources: README.md, roadmap.md, docs/research/competitive-research-and-improvement-plan.md, docs/plans/*.md, frontend/src/app/app.html, backend/src/mastra/agents/assistant.agent.ts, backend/src/modules/llm/llm.types.ts, backend/src/modules/testing-data/fixtures/registry.ts -->

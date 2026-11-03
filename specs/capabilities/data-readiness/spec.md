# Data readiness

The Data Readiness Agent is a built-in Official agent that tells a user how ready the data behind a PostgreSQL or Databricks dataset is for analysis. It measures the data against the DMBOK data-quality dimensions and returns a score per dimension, an overall score and a maturity band, plus the findings behind them. **Every score and finding is computed by a deterministic engine** from aggregate statistics the app reads from the datasource. The agent's model only starts an assessment and explains the stored report: it never computes, adjusts or invents a number. Each assessment is saved, so past reports can be reopened and compared. The engine and its rules are ported from the separate `data-readiness-agent` project (ADR-0031).

## Concepts

Defined in [the glossary](../../product/glossary.md): data readiness, readiness dimension, maturity band, readiness finding, Official agent, Agent Hub, session, dataset, datasource.

Capability-local vocabulary:
- **Source profile.** The aggregate statistics the engine reads.
  - Per **entity** (a table): its namespace, its name, its row count, whether the app's connection can read it, and when it was last modified, when the platform says.
  - Per **field** (a column): its name, its type, its semantic type, and whether it is nullable. When measured, also its null count, distinct count, minimum and maximum (as text), format rule and invalid-format count, and normalized distinct count.
  - The semantic type is one of `numeric`, `temporal`, `text`, `boolean`, `uuid`, `json` or `other`.
  - Per **key**: its kind (`primary`, `unique` or `natural`), its fields, and its duplicate count.
  - Per **relationship**: the from and to namespace, entity and field, the orphan count, and its origin (`declared` or `inferred`).
  - No row values ever enter the profile.
- **Check.** One rule applied to the profile. It returns its dimension, how many things it checked (*checks run*), and its findings. Entity checks run once per entity. Source checks run once per assessment.
- **Assessment scope.** The entities assessed:
  - the entities of one dataset, on that dataset's datasource;
  - or, through the API, a given entity list or the whole datasource.
- **Assessment report.** One stored assessment: its datasource, the time it was generated, the eight assessed and two unassessed dimension scores, the overall score, the maturity band and the findings ([data-model.md](../../system/data-model.md), `readiness_reports`).

## Rules

### The agent on the hub

- R1. The Data Readiness Agent SHALL be a built-in agent shown on the Agent Hub in the **Official** section.
  - Registry key `data-readiness`, `Owner: Official`.
  - Description: "Assesses how ready a PostgreSQL or Databricks dataset is for analysis, scoring it on the DMBOK data-quality dimensions with a deterministic engine and explaining the findings."
  - Its card and detail view SHALL offer **Start chat**, with the accessible name `Start chat with Data Readiness Agent`.
  - While no dataset bound to a PostgreSQL or Databricks datasource exists, Start chat SHALL be disabled, and its title SHALL read `Add a PostgreSQL or Databricks dataset first`.
  - Its detail view SHALL have the Official agent's tabs ([agents-evals](../agents-evals/spec.md) R5):
    - the System Prompt tab shows the prompt as served and allows the built-in prompt edit; an edited prompt SHALL still start with `You are the Data Readiness Agent`;
    - the Skills tab lists the skill `data-readiness` as Built-in and On demand;
    - the Tools tab lists its own tools.
- R2. **Start chat** on the Data Readiness Agent SHALL create a session at once, with no form.
  - The session is named "Data Readiness" and bound to the agent. It covers every dataset bound to a PostgreSQL or Databricks datasource, ordered by dataset name.
  - The app SHALL show the toast `Session "Data Readiness" created` and open the session on its welcome block.
  - The welcome block uses the agent's description and offers the starter questions:
    - "Assess the readiness of this dataset"
    - "What are the worst data-quality problems?"
    - "Show my past assessments"
  - The session header and session-list row SHALL show the agent chip "Data Readiness Agent".
  - Without a qualifying dataset the system SHALL refuse, creating nothing, with `Add a PostgreSQL or Databricks dataset first`.
  - Every turn of the session SHALL run the Data Readiness Agent, not the assistant. The assistant-only passes SHALL NOT apply ([sessions-chat](../sessions-chat/spec.md) R61).

### How the agent works

- R3. The agent SHALL have exactly these tools, besides the shared `show_in_panel` and `ask_clarification`:
  - `assess_data_readiness` runs an assessment of one session dataset and stores the report.
  - `get_readiness_report` reads a stored report.
  - `list_readiness_reports` lists the stored reports of a session dataset's datasource, newest first.

  It SHALL have no SQL tool, no dataset-browsing tool and no workspace tool. A tool SHALL never fail the turn: errors reach the model as `{ error }` text ([agents.md](../../system/agents.md) 3.13).
- R4. The agent SHALL quote a score, a band or a finding only from a tool result in the conversation. It SHALL never estimate, round differently, re-weight or "adjust" a score. Asked to change one, it SHALL say in one sentence that scores come from the deterministic engine and cannot be changed in chat. With more than one dataset in the session and none named, it SHALL ask which one with `ask_clarification`. It SHALL decline, in one sentence, anything that is not about the readiness of the session's data. The prompt and its rules are in [agents.md](../../system/agents.md) 2.10.
- R5. After a successful `assess_data_readiness` or `get_readiness_report`, the app SHALL:
  - show that report's **scorecard** in the right panel and open the panel (R25);
  - attach a readiness card to the answer that carries the report (R25).

  The model sees only a compact summary (overall score, band, the ten dimension scores, the finding count and up to 20 findings, most severe first), never the full finding list.

### Profiling

- R6. An assessment SHALL build a source profile from aggregate, read-only queries against the datasource only: counts, distinct counts, minimum and maximum, grouped duplicate counts, orphan counts through a left join, pattern-mismatch counts, and privilege lookups.
  - It SHALL read no row values, and every statement SHALL pass the read-only guard ([datasources](../datasources/spec.md)).
  - Each statement SHALL time out after 15 s.
  - A statement that fails or times out SHALL leave the statistic it measures absent. The checks that need that statistic then skip it, and the assessment carries on.
- R7. Per entity in scope, the profile SHALL hold:
  - the row count;
  - per column: its declared type, its semantic type (R8) and whether it is nullable;
  - for a readable entity: the null count and distinct count of every column, and the minimum and maximum of every column whose type is comparable (numeric, temporal or text);
  - the declared primary and unique keys, with their duplicate count, `SUM(group size − 1)` over groups of the key's fields with more than one row;
  - whether the connection can read the entity (a SELECT privilege probe);
  - on Databricks, the table's last-altered time.
- R8. Semantic types SHALL be classified from the declared type:
  - `numeric`: integers, numeric/decimal, real, double, money;
  - `temporal`: date, time, timestamp and interval;
  - `text`: text, char and varchar (or `string` on Databricks);
  - `boolean`, `uuid` and `json`/`jsonb` (or `map`/`struct` on Databricks) as named;
  - everything else, arrays included, `other`.
- R9. A readable `text` column SHALL get a **format rule** from its name, case-insensitively, first match wins:
  - `email` when the name contains `email`;
  - `phone` when it matches `phone`, `mobile`, `tel` (whole name or `_tel` suffix) or `telephone`;
  - `url` when it matches `url`, `website`, `link` (whole name or `_link` suffix);
  - `uuid` when it contains `uuid` or `guid`;
  - `date-string` when it contains `date` as a whole word between underscores, or ends with `date`.

  Its **invalid-format count** SHALL be the number of non-null values that do not match the rule's pattern, case-insensitively:
  - email `^[^@\s]+@[^@\s]+\.[^@\s]+$`;
  - phone `^[+0-9().\s-]{7,}$`;
  - url `^https?://`;
  - uuid `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`;
  - date-string `^\d{4}-\d{2}-\d{2}`.

  Each dialect writes the pattern in its own regex flavour.
- R10. A readable `text` column with between 2 and 1,000 distinct values SHALL also get a **normalized distinct count**: the distinct count of its values lower-cased and trimmed.
- R11. The profile's relationships SHALL be:
  - **declared:** every declared foreign key between two entities in scope;
  - **inferred:** join candidates found by name in the same namespace, at most 20 per assessment. A column named `<base>_id` or `<base>Id`, whose (namespace, entity, column) is not already a declared foreign key, points to the first entity named `<base>`, `<base>s`, `dim_<base>`, `<base>_dim` or `dim<base>` (case-insensitive, never the entity itself). The target column is that entity's column named `id`, or else its column with the same name. With neither, there is no candidate.

  Each relationship's **orphan count** SHALL be the number of child rows whose non-null value has no matching parent row.

### Checks

Thresholds are fixed at these defaults, with no setting to change them:
- completeness: medium at a null fraction of 0.1, high at 0.5;
- reasonability: years before 1900 are ancient;
- timeliness: data is stale after 365 days.

`now` is the assessment's start time, passed to the engine. Every check below SHALL behave exactly as stated; the golden suite (R27) holds the engine to the reference.

- R12. **Completeness** (entity check). For an entity with a row count above 0, each nullable column counts as one check. A column with a null count above 0 yields a finding:
  - **high** when nulls ÷ rows ≥ 0.5;
  - **medium** when ≥ 0.1;
  - **low** otherwise.

  An entity with no rows runs no completeness checks.
- R13. **Validity** (entity check). Each column with a format rule (R9) counts as one check. An invalid-format count above 0 yields a **medium** finding.
- R14. **Consistency** (entity check). Each column with both a distinct count and a normalized distinct count counts as one check. A normalized count below the distinct count yields a **low** finding (values that differ only by case or surrounding whitespace).
- R15. **Uniqueness** (entity check). Each declared key counts as one check. A duplicate count above 0 yields a **high** finding for a primary key and a **medium** finding otherwise. For an entity with no declared key and a row count above 0, the inferred-key checks run:
  - Each column whose name matches `^id$`, `_id$`, `Id$` or `ID$` and that has a distinct count counts as one more check.
  - It yields a **medium** finding when `rows − nulls − distinct > 0`.
- R16. **Integrity** (source check). Each relationship counts as one check. An orphan count above 0 yields a **high** finding for a declared relationship and a **medium** one for an inferred relationship.
- R17. **Accessibility** (source check). Each entity counts as one check. Per namespace with at least one unreadable entity, one source-level finding:
  - **high** when every entity in the namespace is unreadable;
  - **medium** otherwise.
- R18. **Timeliness** (entity check). The freshness signal is the first of these that exists:
  1. the latest parseable maximum of a `temporal` column;
  2. otherwise, the largest year from 1900 to 2100 in a `numeric` column whose name ends with `year` or `yr`, read as 31 December of that year at 23:59:59 UTC;
  3. otherwise, the entity's last-modified time.

  An entity with a signal counts as one check. Its age is `floor((now − signal) / 86,400,000 ms)` days.
  - An age above 365 days yields a **low** finding.
  - An age above 730 days yields a **medium** finding instead.
- R19. **Reasonability** (entity check). One check each for:
  - every `numeric` column;
  - every `temporal` column;
  - every `numeric` column with a maximum whose name reads as a ratio;
  - every start/end column pair.

  Findings:
  - A numeric minimum below 0 yields **low**.
  - A temporal maximum whose year is after `now`'s UTC year yields **medium**.
  - A temporal minimum whose year is before 1900 yields **low**. A temporal column can yield both temporal findings.
  - A ratio-named column whose maximum exceeds its bound yields **medium**. The bound is 100 when the name matches `pct`, `percent` or `percentage` as an underscore-separated word or a trailing `pct`/`percent`. It is 1 when the name matches `fraction`, `share`, `ratio`, `probability` or `prob` as an underscore-separated word.
  - A temporal pair yields **low** when the end column's minimum and maximum are both earlier than the start column's. The pair is the first column matching `start` with the first matching `end`, then `from` with `to`, then `begin` with `finish`, each at the name's start or after `_`, and both columns need a minimum and a maximum.
- R20. Accuracy and currency SHALL be listed in every report as **not assessed**. Each has score 100, `assessed: false` and 0 checks, and is left out of the overall score.

### Scoring

- R21. A dimension's score SHALL be `round(100 × (1 − Σ weight / checks run))`, clamped to 0..100. The weights are info 0, low 0.1, medium 0.4 and high 1.0. A dimension with 0 checks run scores 100. Each dimension score SHALL also carry its finding count, its most severe finding (or none) and its checks run.
- R22. The overall score SHALL be the rounded mean of the eight assessed dimension scores. The maturity band SHALL be:
  - **Optimised** for 95 and above;
  - **Managed** for 85 to 94;
  - **Defined** for 70 to 84;
  - **Repeatable** for 50 to 69;
  - **Initial** below 50.

  With no assessed dimension the result is 0, Initial.
- R23. The same profile with the same `now` SHALL always give the same scores and the same findings in the same order. Entity checks run per entity in profile order, in the order completeness, reasonability, uniqueness, timeliness, validity, consistency; then integrity, then accessibility.

### Saved reports

- R24. Each assessment SHALL be stored as a report with:
  - the datasource's id, name and kind;
  - its generation time;
  - the number of entities assessed;
  - the ten dimension scores, the overall score and the band;
  - every finding;
  - the session it was run from, when it came from a chat.

  Reports are never edited. They can be listed per datasource, newest first, and read by id ([api.md](../../system/api.md) 2.17).
- R25. The **scorecard** SHALL show:
  - the datasource name and the generation time;
  - the overall score out of 100 and the maturity band;
  - one bar per dimension, in the order completeness, validity, consistency, uniqueness, integrity, accessibility, timeliness, reasonability, accuracy, currency, each with its score, finding count and checks run. Accuracy and currency are greyed with `Not assessed`.
  - a findings table with the columns Severity, Dimension, Table, Column, Measured and Description, most severe first, with the recommendation under each description.

  Two filters, **Dimension** and **Severity**, each default to `All` and narrow the table together. When a filter leaves no row, the table reads `No findings match these filters.`. A report with no findings reads `No findings: every check passed.`.
  - The readiness card on an answer SHALL show the datasource name, the overall score and the band, with **Open scorecard**, which shows that report in the panel.
- R26. The scorecard SHALL offer **Past assessments**. It lists the stored reports of the scorecard's datasource, newest first, each with its generation time, its overall score and its band. Choosing one SHALL show it in the scorecard. With one report only, the list reads `No earlier assessments.`.

### Fidelity

- R27. A golden suite SHALL run the engine over labelled source profiles copied from the reference project's corpus, at least 20 PostgreSQL and 20 Databricks profiles.
  - A finding matches a label when dimension, namespace, entity and field are equal and the severity is within one level.
  - Precision and recall SHALL meet the reference project's floors for those dialects.

## Edge cases and errors

- A datasource that is neither PostgreSQL nor Databricks: the API answers 400 `Data readiness supports PostgreSQL and Databricks datasources only`, and the tool returns the same text as `{ error }`.
- An unknown datasource: 404 `Datasource "<id>" not found`. An unknown report: 404 `Readiness report "<id>" not found`.
- An entity in scope that no longer exists: it is left out, and the report's entity count says how many were assessed. When no entity in scope exists, the assessment is refused with 400 `None of the entities to assess exist`.
- A table the connection cannot read: it is counted by accessibility (R17). Its rows are not profiled, so it adds no completeness, validity or consistency checks.
- An empty table (0 rows): no completeness checks and no inferred-key checks. Timeliness uses the last-modified time when the platform gives one.
- An unreachable datasource: the API answers 502 with the connector's message. The tool returns `{ error: 'Could not reach "<datasource>": <message>' }`, and the agent tells the user to test the connection in Datasources.
- `assess_data_readiness` with no session dataset name when the session has several: `{ error: 'This session has several datasets: <names>. Name the one to assess.' }`. With a name that is not a session dataset: `{ error: 'Dataset "<name>" is not in this session. Choose one of: <names>.' }`.
- `get_readiness_report` with no id returns the newest report of the session dataset's datasource. With none stored it returns `{ error: 'No assessment has been run for "<datasource>" yet.' }`.
- Long assessments: the chat shows the tool step as running until it ends. Stopping the turn abandons the result, and nothing is stored for an assessment that did not finish.

## Contracts

- Routes `POST /data-readiness/assessments`, `GET /data-readiness/assessments` and `GET /data-readiness/assessments/:id`, plus the `readiness-report` stream event: [api.md](../../system/api.md), sections 2.17 and 3.1. The agent summary (Official kind, chat requirement): section 2.6.
- The `readiness_reports` collection, the answer's `readinessReport` reference and the `readiness` panel item: [data-model.md](../../system/data-model.md).
- The agent, its prompt, tools and skill: [agents.md](../../system/agents.md), sections 2.10, 3.13, 7.4 and Appendix D; its eval set: section 8.
- Decision: ADR-0031 in [architecture.md](../../system/architecture.md).

## UI

See [ui.md](../../system/ui.md).

- **Agent Hub** (section 4.4): the Data Readiness Agent card in the Official section, with Start chat disabled, titled with the requirement, while no PostgreSQL or Databricks dataset exists.
- **Agent detail** (section 4.5): the Official agent's tabs; the System Prompt tab is editable.
- **Session chat** (section 4.12): the agent chip; each tool call shown as a step; the readiness card on the answer.
- **Right panel**: the readiness scorecard, its filters and Past assessments (section 4.13).

## Flows

### Feature: Data readiness

E2E: none yet

```gherkin
Feature: Data readiness

  Background:
    Given the app runs with the LLM stub as its provider

  Scenario: Start chat is blocked without a PostgreSQL or Databricks dataset
    Given no dataset is bound to a PostgreSQL or Databricks datasource
    When I open "Agents"
    Then the "Official" section shows "Data Readiness Agent" with "Owner: Official"
    And "Start chat with Data Readiness Agent" is disabled with the title "Add a PostgreSQL or Databricks dataset first"

  Scenario: Assessing a dataset from the chat shows the scorecard
    Given the World Cup sample datasource and a dataset "World Cup" over it exist
    When I click "Start chat with Data Readiness Agent"
    Then I see the toast "Session \"Data Readiness\" created"
    And the session header shows the agent chip "Data Readiness Agent"
    When I ask "Assess the readiness of this dataset"
    And the agent calls "assess_data_readiness"
    Then the right panel shows the readiness scorecard for the World Cup datasource
    And the scorecard shows an overall score out of 100 and a maturity band
    And it shows ten dimension bars, with "Accuracy" and "Currency" marked "Not assessed"
    And the answer carries a readiness card with "Open scorecard"

  Scenario: The scorecard shows the same numbers as the API
    Given an assessment of the World Cup datasource was run from the chat
    When I request "GET /data-readiness/assessments/<report id>"
    Then its overall score, maturity band and dimension scores equal those on the scorecard
    And the overall score is the rounded mean of the eight assessed dimension scores

  Scenario: Past assessments lists and reopens earlier reports
    Given two assessments of the World Cup datasource were run
    When I open "Past assessments" on the scorecard
    Then I see two reports, newest first, each with its time, score and band
    When I choose the older report
    Then the scorecard shows the older report

  Scenario: Filtering findings by dimension and severity
    Given the scorecard shows a report with findings in several dimensions
    When I set the "Dimension" filter to "Completeness"
    And I set the "Severity" filter to "High"
    Then the findings table shows only high completeness findings
    When a filter combination matches nothing
    Then the table reads "No findings match these filters."
```

## Acceptance

1. The engine's unit tests reproduce the reference scoring numbers:
   - 2 high findings over 10 checks score 80;
   - 1 medium over 10 scores 96;
   - 1 low over 10 scores 99;
   - 49 high over 50 score 2;
   - completeness at 0 with the other assessed dimensions at 100 gives overall 88, Managed.
2. The golden suite (R27) meets the reference floors, and a determinism test gives identical reports for the same profile and `now`.
3. `POST /data-readiness/assessments` on the World Cup PostgreSQL sample stores a report whose overall score is the mean of its eight assessed dimension scores. `GET` lists it and reads it back.
4. The hub shows the Data Readiness Agent under Official. A session started from it runs the agent: its first request offers no `run_readonly_sql`. An assessment shows the scorecard, and Past assessments reopens an earlier one.
5. The Data readiness Feature passes on the web target at the acceptance gate. The `data-readiness` eval set passes at 100 % over 3 runs, and the assistant's and RFP Builder's eval sets are unchanged.

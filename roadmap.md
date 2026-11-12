# Roadmap

Pre-implementation plan for all work. Hierarchy: **Release → Milestone → Feature** (`R`, `R.M`, `R.M.F`). See *Planning convention* in the `workflow-start` skill. Each milestone is an epic, with its spec in [specs/epics/](specs/README.md); since 2026-11-11 a new milestone's heading ends in its epic ID `(M<R>-<M>)`.

Finished milestones (every feature `✅ Done` or `🚫 Cut`, other than the active epic) are moved verbatim to [roadmap-archive.md](roadmap-archive.md) by `node scripts/roadmap-archive.mjs`; their heading stays here with the suffix `— archived, see roadmap-archive.md`. Look a story up in both files.

Status legend: `📋 Planned` · `🚧 In progress` · `✅ Done` · `🚫 Cut`

Feature template:

```
#### R.M.F — <Feature name>  `📋 Planned`
- **Intent:** why this exists / the user-observable outcome.
- **Scope:** what is in.
- **Out of scope:** what is explicitly not.
- **Acceptance:** verifiable criteria (map to Gherkin scenarios in the capability specs under specs/capabilities/).
- **Notes:** links (docs/plans, ADRs, evidence), dependencies.
```

---

<!-- Releases go here. Promote Backlog items into a milestone before starting work. -->

## Release 0 — Maintenance

Correctness fixes to the shipped app that don't belong to a product phase.

### Milestone 0.1 — Desktop runtime correctness — archived, see roadmap-archive.md

### Milestone 0.2 — Delivery process ([BA-89](https://halo-powered.atlassian.net/browse/BA-89)) — archived, see roadmap-archive.md

### Milestone 0.3 — Local Development Observability ([BA-111](https://halo-powered.atlassian.net/browse/BA-111)) — archived, see roadmap-archive.md

### Milestone 0.4 — Harness Adjustments ([BA-119](https://halo-powered.atlassian.net/browse/BA-119))

Adjustments to the delivery workflow harness: the CLAUDE.md conventions, the workflow gates, and the project skills and checks that govern how a change is planned, built and shipped. No app behaviour changes. Epic spec: [specs/epics/BA-119/spec.md](specs/epics/BA-119/spec.md).

#### 0.4.1 — Split CLAUDE.md into workflow-stage skills ([BA-236](https://halo-powered.atlassian.net/browse/BA-236))  `✅ Done`
- **Intent:** a Claude Code session loads a workflow stage's conventions when that stage starts, as the RFP Builder loads its stage skills, rather than carrying all of CLAUDE.md on every turn.
- **Scope:**
  - CLAUDE.md keeps only the always-on core:
    - what the repo is
    - the mandatory first action
    - the `## Workflow` list, with each step naming its skill
    - the fast loop and the acceptance gate
    - the hard gates
    - model usage
  - The conventions move, unchanged in substance, to the project skills `workflow-understand`, `workflow-plan`, `workflow-architecture`, `workflow-specs`, `workflow-e2e`, `workflow-implement`, `verify` (extended with step 9), `workflow-ship` and `workflow-retrospective`.
  - `check-specs.py` checks the skills' links.
  - Specs that cite a CLAUDE.md convention point at its skill.
- **Out of scope:** app code; changing what a rule says; the `workflow-steps` mod.
- **Acceptance:**
  - A section map shows every CLAUDE.md rule in exactly one place.
  - The mod still parses eleven steps and the first action, and its tests pass.
  - A new session lists the nine skills.
  - `check-specs.py` passes.
  - Nothing under `backend/` or `frontend/` changes.
- **Notes:** branch `feat/BA-119-harness-adjustments`. The user chose one skill per workflow stage, invocable as `/<name>`, on 2026-10-16. One rule change at the user's request, the same day: *Model usage* now says plans are made by Opus 5.5 at high effort (was Fable). Evidence: [evidence/0.4.1/](evidence/0.4.1/).

#### 0.4.2 — Jira MCP tool in `.claude/tools` for epics and stories ([BA-237](https://halo-powered.atlassian.net/browse/BA-237))  `✅ Done`
- **Intent:** Claude creates and checks epics and stories through typed tools that work from any checkout, instead of a shell script that needs `jq`, careful quoting and a `raw` call to set a parent.
- **Scope:**
  - `.claude/tools/` as the home of developer tools, each an MCP server or a script, with a README.
  - A `jira` MCP server with no dependencies, registered in `.mcp.json` and enabled in `.claude/settings.json`. Its read tools are allowed without asking; its write tools ask every time.
  - Its tools: `create_epic`, plus `create_issue` (a Story or Bug must name an Epic, checked before creating). It also covers everything `jira.sh` did: `whoami`, `get_project`, `search_issues`, `get_issue` (with the parent's type, for the Epic gate), `list_statuses`, `list_transitions`, `update_issue`, `add_comment`, `transition_issue`.
  - Credentials from the environment or `.env`, falling back to the main checkout's `.env` from a worktree; `setup.mjs` writes them from the developer's terminal.
  - `jira.sh` is removed. The `jira` skill is rewritten as the guide to the tools, and `workflow-plan` points at `get_issue`.
- **Out of scope:** the Epic gate as a tool that also checks the epic spec; listing or tracking an epic's stories beyond JQL; scaffolding specs or roadmap entries. The user chose creation only, on 2026-10-16.
- **Acceptance:**
  - Unit tests pass, with Jira faked.
  - A stdio smoke run from a worktree reads the main checkout's `.env` and returns a real issue with its parent's type.
  - In a new session, `/mcp` lists `jira` with its eleven tools.
  - `check-specs.py` passes.
- **Notes:** same branch `feat/BA-119-harness-adjustments`. The user chose an MCP server over scripts and over the claude.ai Atlassian connector, and chose to replace `jira.sh`, on 2026-10-16. `update_issue` replaces the `raw` calls earlier stories needed to set a parent or edit a description. Evidence: [evidence/0.4.2/](evidence/0.4.2/).

#### 0.4.3 — Agent roles: builder, reviewer and a manager that only answers the human  `✅ Done`
- **Intent:** an LLM is used only where the work needs judgment: writing code, reviewing a diff, and talking to the human. Every other part of the org chart is a script, a hook or the pipeline's JavaScript, so it costs no tokens.
- **Scope:**
  - `.claude/agents/builder.md` (`isolation: worktree`):
    - Works one story on a `unit/<EPIC-ID>-<roadmap-id>` branch, from the brief made by `scripts/brief.mjs` (0.4.4). It does not read the whole retrospective or every skill.
    - Writes the failing unit test first, then the code.
    - For a UI story, writes the story's main Gherkin scenario once, as a Playwright test whose `test.step` titles are the Given/When/Then lines. This file is the demo in the fast loop (0.4.5) and grows into the E2E spec in the gate.
    - Carries the standing rules:
      - write files with Edit/Write or in a private scratch folder, never under shared `/tmp` names
      - never kill a process it did not start
      - set `E2E_SKIP_DOCKER=1`
      - never run `npm test`/`build` alongside `test:e2e`
  - `.claude/agents/reviewer.md`:
    - Read-only, on a cheaper model than the builder.
    - Runs only after the deterministic checks have passed (0.4.4).
    - Gets the diff and the story, never the builder's transcript.
    - Returns findings or `approve`.
  - `.claude/agents/manager.md`:
    - Tools: read, search, `AskUserQuestion`, `PushNotification`. No Edit, Write or Bash.
    - Runs only when the human asks "what needs me?" or a story fails review 3 times. It answers with one question, recommended option first.
    - It does not dispatch or poll. The pipeline (0.4.4) and `scripts/board.mjs` (0.4.7) do that.
  - Manager mode is opt-in (`claude --agent manager`). A plain session keeps today's single-agent workflow.
  - Unit worktrees made by `isolation: worktree` are temporary and exempt from the epic worktree naming rule. `workflow-plan` says so.
- **Out of scope:** app code; Jira; cloud agents; an LLM QA agent (QA is the script in 0.4.5).
- **Acceptance:**
  - A new session lists the three agents.
  - A headless `claude --agent manager` run asked to edit a file cannot: Edit, Write and Bash are not available to it.
  - A headless reviewer run on a scratch diff with a planted bug reports the bug.
  - `check-specs.py` passes.
- **Notes:**
  - Branch: `feat/BA-119-harness-adjustments`, reopened because the epic's first branch merged.
  - On 2026-11-09 the user chose this design from an "org chart" diagram, with three decisions:
    1. Builders write failing **unit** tests first. E2E stays in the acceptance gate, after the human tests by hand.
    2. One PR per epic.
    3. `roadmap.md` is the ticket board, with no Jira.
  - The same day the user chose the token-minimal version: LLM only for judgment, scripts for the rest. They also chose to write the main scenario once, as both the demo and the start of the E2E spec, and to commit videos under `evidence/`.

#### 0.4.4 — Story pipeline: brief, build, deterministic checks, review up to 3×  `📋 Planned`
- **Intent:** every story takes the same path in the same order, fixed in code rather than by an LLM. The LLM sees as little context as possible, and only diffs that already pass the mechanical checks.
- **Scope:**
  - `scripts/brief.mjs <roadmap-id>` prints the builder's brief:
    - the roadmap entry
    - the epic spec's section for it
    - the lessons from `lessons.md` (0.4.8) tagged for the areas the story touches
    - the files likely touched, by grepping the Scope's paths
  - A saved workflow, `.claude/workflows/story-pipeline.js`. Input: an epic ID and roadmap story IDs. For each story:
    1. Build the brief with `brief.mjs`.
    2. The builder writes the code. Builders run in parallel, at most 4 by default.
    3. The deterministic checks run on the unit branch: `tsc`, lint, the related unit tests (Jest `--findRelatedTests`) and `check-specs.py`. If one fails, its output goes straight back to the builder, with no review.
    4. The reviewer reviews. Findings go back to the builder, at most 3 rounds. After the third, the story escalates to the manager.
    5. QA runs `scripts/qa.mjs --fast` (0.4.5).
    6. A passing unit branch is merged into the epic worktree.
  - The pipeline writes a log per story: steps, review rounds, check failures and retries, as JSON under `evidence/<roadmap-id>/pipeline.json`.
  - Fallback: if the saved workflow can't be run in this setup, the same steps run from a single `scripts/pipeline.mjs` that calls `claude -p --agent builder|reviewer` headless.
- **Out of scope:** per-worktree ports and databases, which more than one QA lane would need.
- **Acceptance:**
  - A dry run on two throwaway stories in a scratch epic shows:
    - parallel builds
    - a planted type error returned to the builder without a review
    - a review loop that stops at 3
    - both unit branches merged, confirmed with `git merge-base --is-ancestor`
  - `brief.mjs` output for a sample story stays under a set size, checked in a unit test.
- **Notes:** depends on 0.4.3. Uses `lessons.md` from 0.4.8 if it is there, otherwise only the brief's other parts.

#### 0.4.5 — Deterministic QA: impacted tests, demo video, test-run evidence  `✅ Done`
- **Intent:** checks, test selection, the demo video and the evidence are produced by a script, with no LLM. Each story ends with a captioned demo video and a `tests.md` that proves which tests ran.
- **Scope:**
  - `scripts/qa.mjs <roadmap-id> [--fast|--gate]` runs one story at a time (a lock file makes it the single QA lane), because worktrees share Postgres on 55432, the default ports and `backend/dist`. It selects tests mechanically:
    - Playwright `--only-changed=<epic base>` for the specs touched through imports, plus the specs of the Features the story names in its spec
    - Jest `--findRelatedTests` on the changed files
  - **`--fast` (fast loop):**
    - Runs the related unit tests, the builds, `check-specs.py` and the selected Playwright specs.
    - Records the **demo**: for a UI story, it runs the story's main scenario with `DEMO=1`, which turns on `slowMo`, 1280×720 video and a caption overlay showing each `test.step` title. It saves `evidence/<roadmap-id>/demo.webm`.
    - For a story with no UI, the demo is a text transcript of its main scenario's commands and output (`demo.txt`).
  - **`--gate` (acceptance gate):**
    - Runs the step-6 spec list, the unit tests, lint and the builds, with Playwright JSON and HTML reporters and Jest `--json`. Video and trace are kept for failures.
    - Writes `evidence/<roadmap-id>/tests.md`:
      - each command with passed / failed / skipped counts, read from the reports
      - the specs run, compared with step 6's list: a listed spec that did not run fails the gate and is named
      - links to `demo.webm`, the reports and any failure videos
  - `frontend/playwright.config.ts` gets the `DEMO` switch and the reporters. A `frontend/e2e/support/demo-captions.ts` fixture draws the captions.
  - **Videos are committed** under `evidence/<roadmap-id>/`. `qa.mjs` fails a demo over 5 MB.
  - `verify` and `workflow-ship` call `qa.mjs` instead of listing commands, and the changelog entry links `demo.webm` and `tests.md`.
  - `scripts/demo-page.mjs <roadmap-id>` (no LLM) writes `evidence/<roadmap-id>/demo-page.html` from the story's roadmap entry, changelog entry, `tests.md` and demo. The Claude session publishes it as an artifact with the Artifact tool (`demo.webm` as a supporting file), so a teammate watches the demo and reads the work description from one link. The link goes in the evidence README and the changelog entry.
- **Out of scope:** recording the desktop (Electron) app; narration; editing videos together.
- **Acceptance:**
  - `qa.mjs --fast` on a sample UI story produces one captioned `demo.webm` under 5 MB. Without `DEMO=1`, the same spec runs at normal speed with no captions.
  - `qa.mjs --gate` writes a `tests.md` whose counts match the JSON reports.
  - Removing one impacted spec from the run fails the gate, naming the spec.
  - Two `qa.mjs` runs started together run one after the other.
  - This epic's own evidence includes a demo and a `tests.md`.
  - `demo-page.mjs 1.21.6` generates a page that, published as an artifact with `demo.webm`, plays the captioned demo beside the story's description, and the evidence README and changelog link it.
- **Notes:** depends on 0.4.4. Touches test configuration and a test fixture under `frontend/`, not app code.
  - Started 2026-11-10 on a second `feat/BA-119-harness-adjustments` branch (the first merged as PR #88). The user chose to build it **standalone**: `qa.mjs` runs on its own (by hand, `verify`, `workflow-ship`), and 0.4.4's pipeline calls it later. It starts from the `DEMO=1` switch and `scenarioStep` caption helper kept from the 0.4.3 dry run (`unit/BA-119-0.4.5-demo-captions`).
  - Decisions (user, 2026-11-10): a story's main scenario is the Playwright test tagged `@demo` and `@story-<roadmap-id>`, written with `scenarioStep` so each Gherkin line is a caption; step 6's list is the spec-file column of `evidence/<roadmap-id>/e2e-impact.md`; the sample UI story is 1.21.6 User personas ("A new install starts with the demo persona"), whose `demo.webm` and `tests.md` are this story's showcase.
  - Added 2026-11-10 (user): "As part of the workflow the video should be uploaded as a Claude artifact with the work description." Built as `scripts/demo-page.mjs` plus a publish step in `verify` and `workflow-ship`.

#### 0.4.6 — "ship it": a human-typed gate on the epic PR  `📋 Planned`
- **Intent:** only a human opens or merges the epic PR, by typing `ship it <EPIC-ID>`. Today that is a convention. This story makes it a hard gate that no agent can get past.
- **Scope:**
  - A `UserPromptSubmit` hook. When the prompt is exactly `ship it <EPIC-ID>`, it writes a one-time ship token for that epic. The token is stored in git's common dir and never committed.
  - A `PreToolUse` hook on Bash and PowerShell. It blocks `gh pr create` and `gh pr merge` on a branch for `<EPIC-ID>` unless that epic has a token, and uses up the token.
  - Both hooks live in `.claude/hooks/` with unit tests and are registered in `.claude/settings.json`.
  - `workflow-ship` says to wait for `ship it`.
- **Out of scope:** GitHub branch protection. Approval on `main` stays as set in 0.2.4.
- **Acceptance:**
  - Unit tests show that:
    - the token is written only for the exact phrase
    - `gh pr create` is blocked without a token and allowed with one
    - the token works only once
  - In a headless session, a `gh pr create` call is denied when the phrase was not typed.
- **Notes:** independent of the other stories.

#### 0.4.7 — Board status and check-ins without an LLM  `📋 Planned`
- **Intent:** the 10-minute check-in costs no tokens. A script watches the board and notifies the human only when something needs them. The manager LLM wakes only then.
- **Scope:**
  - `scripts/board.mjs [--watch 10m]` reads `roadmap.md`, the `unit/<EPIC-ID>-*` branches, the latest `pipeline.json` and `tests.md`, and the QA lock. It prints, per story:
    - status
    - review round
    - last check result
    - whether a human is needed: hand test ready, escalation, or ready for `ship it`
  - `--watch` re-runs it every 10 minutes and sends a desktop notification only when the "needs human" list changes. It is a plain process or OS scheduled task, with no LLM.
  - `scripts/board.mjs --set <roadmap-id> <status>` updates the status in `roadmap.md`. The pipeline calls it, so no LLM edits the board.
  - CLAUDE.md gets a short **Agent roles** section: the three agents, the scripts, the opt-in, and links to the skills.
- **Out of scope:** voice input setup; a live board page.
- **Acceptance:**
  - Unit tests cover parsing `roadmap.md` statuses and the "needs human" rules on fixture data.
  - A `--watch` run notifies once per change and stays silent otherwise.
  - The `workflow-steps` mod still parses CLAUDE.md, and `check-specs.py` passes.
- **Notes:** depends on 0.4.4 for `pipeline.json`, and on 0.4.5 for `tests.md`.

#### 0.4.8 — Tagged lessons digest and token metering  `📋 Planned`
- **Intent:** an agent reads only the past lessons that apply to its work, not the whole `retrospective.md` (over 1,100 lines). Token use per story is measured, so savings are known rather than guessed.
- **Scope:**
  - `lessons.md`: every "What to do differently" bullet from `retrospective.md`, de-duplicated, one line each, tagged by area (`e2e`, `worktree`, `subagents`, `evals`, `release`, `specs`, `sql`, …), with a link back to its entry.
    - `scripts/lessons.mjs --check` fails when a new retrospective entry adds a lesson that `lessons.md` does not yet include.
    - `scripts/lessons.mjs --tags e2e,worktree` prints the matching lessons for `brief.mjs`.
  - CLAUDE.md's mandatory first action becomes "read `lessons.md`", or the lessons for your tags. `retrospective.md` stays the full record, and `workflow-retrospective` adds each new lesson to the digest.
  - `scripts/tokens.mjs <roadmap-id>` totals input, output and cache tokens of the story's agent runs from the Claude Code session transcripts and writes them into `pipeline.json` and `tests.md`.
- **Out of scope:** rewriting past retrospective entries.
- **Acceptance:**
  - `lessons.md` covers every existing lesson, checked by `lessons.mjs --check`.
  - `tokens.mjs` totals match a hand count on one sample transcript.
  - The dry-run stories in 0.4.4 report their token totals.
- **Notes:** `brief.mjs` (0.4.4) uses this digest. It is a rule change to the first action, approved by the user on 2026-11-09.

### Milestone 0.5 — Faster workflow, repo-only planning (M0-5) — archived, see roadmap-archive.md

## Release 1 — 1.0 Beta  (target 2026-10-31)

Source of truth for scope and dates: Jira project **BA**, version *1.0 Beta* ([timeline](https://halo-powered.atlassian.net/jira/software/projects/BA/boards/2688/timeline)). Each milestone mirrors one Jira epic and each feature mirrors one story, so IDs map 1:1. Imported 2026-10-01. Status changes are made in both places.

Timeline (from the Jira timeline):

| Milestone | Epic | Window |
|---|---|---|
| 1.1 Golden Dataset and Evals | [BA-9](https://halo-powered.atlassian.net/browse/BA-9) | Oct 1 – Oct 31 (runs throughout) |
| 1.2 Data Model DSL | [BA-2](https://halo-powered.atlassian.net/browse/BA-2) | Sep 30 – Oct 16 |
| 1.3 Knowledge Store | [BA-4](https://halo-powered.atlassian.net/browse/BA-4) | Sep 30 – Oct 16 |
| 1.4 Response Reliability Signals | [BA-12](https://halo-powered.atlassian.net/browse/BA-12) | Sep 30 – Oct 16 |
| 1.5 Data Connectors | [BA-5](https://halo-powered.atlassian.net/browse/BA-5) | Sep 30 – Oct 23 |
| 1.6 User Testing | [BA-10](https://halo-powered.atlassian.net/browse/BA-10) | Oct 19 – Oct 23 |
| 1.7 Bug Fixes | [BA-11](https://halo-powered.atlassian.net/browse/BA-11) | Oct 26 – Oct 30 |
| 1.8 Agentic Hub Look and Feel | [BA-141](https://halo-powered.atlassian.net/browse/BA-141) | No dates in Jira yet |
| 1.9 Agent Hub | [BA-150](https://halo-powered.atlassian.net/browse/BA-150) | No dates in Jira yet; due with the beta |

Evals come first in the order even though they run in parallel: every other milestone is measured against them.

### Milestone 1.1 — Golden Dataset and Evals ([BA-9](https://halo-powered.atlassian.net/browse/BA-9))

The measurement baseline. Every change to the DSL, knowledge store or connectors is measured against it before the beta ships.

#### 1.1.1 — Golden dataset and eval suite  `📋 Planned`
- **Intent:** know, with numbers, whether a change made answers better or worse.
- **Scope:** a golden dataset of representative questions with known-correct answers on the sample fixtures. An eval suite (LLM judge plus SQL and result checks) that runs against it, building on the existing `assistant-eval-judge` agent and `mastra/evals/` and the Agents → Evals tab.
- **Out of scope:** evals on customer data.
- **Acceptance:** the suite runs on demand against the golden dataset and reports per-question and per-category results. Results can be compared run to run, and a knowledge on/off comparison is possible (needed by 1.3.3).
- **Notes:** Jira has no stories under this epic yet, so this feature mirrors the epic. Split it into stories in Jira first, then mirror them here.

#### 1.1.2 — Intellify sample as a Testing Data fixture ([BA-212](https://halo-powered.atlassian.net/browse/BA-212))  `✅ Done`
- **Intent:** recreate the Intellify sample database (the Halo × Marsh ERD and data dictionary: 49 entities, 243 attributes) in one click, so the assistant can be tried and later evaluated on an employee-benefits model as well as on sports data.
- **Scope:** a fourth sample fixture `intellify` in the Testing Data catalogue: a bundled gzipped seed `003_intellify.sql.gz` that creates schema `intellify` (49 tables, 52 foreign keys, column comments carrying the source Mongo field and its dictionary description) with deterministic synthetic data, registered as datasource "Intellify PostgreSQL" and dataset "Intellify" in database `intellify` on the sample server. The generator that writes the seed, `scripts/generate-intellify-seed.py`, is committed so the seed can be regenerated byte for byte.
- **Out of scope:** an Intellify eval question set (a later BA-9 story); reading Postgres column comments into dataset descriptions (a connector change); any real Intellify data.
- **Acceptance:** Settings → Testing Data lists "Intellify" with `0/49 entities`; loading it against the sample server creates the `intellify` database when missing, seeds it and reports `49/49 entities`, and the "Intellify" dataset has sample values and the 52 declared join references. Running the generator again reproduces the committed seed exactly.
- **Notes:** evidence: [evidence/1.1.2/](evidence/1.1.2/). The model is converted, not invented: Mongo field paths become snake_case columns (`client_clientId` → `client_client_id`, `_id` → `id`), ObjectIds are `char(24)`, embedded objects are `jsonb`, and relationships the source draws without a field stay unjoinable. All rows are synthetic.

### Milestone 1.2 — Data Model DSL ([BA-2](https://halo-powered.atlassian.net/browse/BA-2))

The structure the assistant reasons over, as a single, versionable source of truth.

#### 1.2.1 — Data Model DSL  `📋 Planned`
- **Intent:** answers stop depending on what the model infers from raw schema alone.
- **Scope:** a domain-specific language describing entities, columns, relationships and business metrics; versionable; used to ground SQL generation.
- **Out of scope:** business meaning (synonyms, concepts). That belongs to the Knowledge Store, per the boundary set in 1.3.1.
- **Acceptance:** *to be defined.* The Jira epic has only a description. Agree the acceptance criteria before starting.
- **Notes:** architectural, so it needs an ADR in [specs/system/architecture.md](specs/system/architecture.md) before code. Overlaps the existing dataset metrics UI and the "semantic metrics layer" in [docs/plans/phase-4-strategic-bets.md](docs/plans/phase-4-strategic-bets.md) (item 13); reconcile the two. Assignee: Jhon Buendia.

### Milestone 1.3 — Knowledge Store ([BA-4](https://halo-powered.atlassian.net/browse/BA-4))

Curated knowledge the assistant treats as authoritative: glossary terms, standing instructions and default filters, scoped to a datasource or dataset. Covers authoring, mining suggestions from past sessions, and injecting the relevant snippets into each turn. Assignee: Sergio Berrospi.

#### 1.3.1 — Research and ontology design ([BA-78](https://halo-powered.atlassian.net/browse/BA-78))  `🚫 Cut`
- **Moved:** on 2026-11-09 the user had this built on BA-320 as roadmap 1.21.7–1.21.9 (design approved from a review page; ADR-0036).
- **Intent:** an evidence-based design for how the knowledge store models business meaning, so query generation follows each data store's ontology.
- **Scope:**
  - Compare Databricks Genie, Snowflake Cortex Analyst semantic models, the dbt Semantic Layer, Cube and knowledge-graph text-to-SQL research.
  - Define the concept and relation model: concepts, synonyms, mappings to tables, columns and SQL expressions, and relations (is-a, has-many, measured-by).
  - Set the boundary with 1.2: the DSL holds structure, the knowledge store holds meaning.
  - Plan the snippet migration: terms become concepts, default filters become concept constraints, instructions are kept.
- **Out of scope:** implementation.
- **Acceptance:** the decision record is merged in `docs/` (as an ADR in [specs/system/architecture.md](specs/system/architecture.md)) and the model is agreed.

#### 1.3.2 — Ontology model, knowledge graph and bootstrap ([BA-79](https://halo-powered.atlassian.net/browse/BA-79))  `🚫 Cut`
- **Moved:** on 2026-11-09 the user had this built on BA-320 as roadmap 1.21.7–1.21.9 (design approved from a review page; ADR-0036).
- **Intent:** business concepts and their relations live in one graph and are drafted automatically, so setup takes minutes.
- **Scope:**
  - The concept and relation schema and its storage.
  - Migrate existing snippets without losing data, using the `LEGACY_*` pattern in `database.module.ts`.
  - Link metrics, verified queries and dataset relationships to concepts, queryable by dataset and datasource.
  - Extend the `knowledge-bootstrap` agent to propose concepts and relations from schema, sample values, relationships and past thumbs-up answers. Drafts arrive disabled for review.
- **Out of scope:** the curation UI (1.3.4).
- **Acceptance:** a dataset can be bootstrapped into a reviewed ontology, and the graph returns a concept with its metric, mappings and example queries.
- **Notes:** depends on 1.3.1.

#### 1.3.3 — Ontology-grounded retrieval and SQL generation, measured by evals ([BA-80](https://halo-powered.atlassian.net/browse/BA-80))  `📋 Planned`
- **Intent:** each answer is built from the knowledge relevant to the question and checked against it, so terms like "revenue" always mean the same thing.
- **Scope:**
  - Match questions to concepts (synonyms, embeddings, entity overlap), expand one hop to related concepts, and rank within the context budget. This replaces today's newest-first selection.
  - The prompt carries the concept mappings: columns, joins and default filters.
  - `sql-verifier` flags queries that contradict a concept, and the `sql-fixer` loop repairs them.
  - Retrieval is logged per turn.
- **Out of scope:** UI for provenance (1.3.4).
- **Acceptance:** a golden-dataset eval (1.1.1) runs with knowledge on and off, with per-concept attribution, and shows the accuracy difference with no category getting worse.
- **Notes:** depends on 1.3.2 and 1.1.1.

#### 1.3.4 — Curation UI, feedback learning and provenance ([BA-81](https://halo-powered.atlassian.net/browse/BA-81))  `📋 Planned`
- **Intent:** analysts curate the ontology, corrections feed back into it, and users see what shaped each answer.
- **Scope:**
  - Browse, approve and edit concepts and relations, and enable or disable them per dataset.
  - Conflict detection: the same synonym on two concepts, or contradictory filters.
  - A thumbs-down with a correction suggests a concept edit, and approved answers link back to the concepts they used.
  - The answer panel shows which concepts and definitions were used.
- **Out of scope:** —
- **Acceptance:** an analyst can fix a wrong answer by editing a concept, and the next answer cites it.
- **Notes:** a new UI surface, so it needs Gherkin scenarios and E2E specs first. The provenance display ties into 1.4.1.

### Milestone 1.4 — Response Reliability Signals ([BA-12](https://halo-powered.atlassian.net/browse/BA-12))

Show users how much to trust each answer. Assignee: Sergio Berrospi.

#### 1.4.1 — Answer trust signals  `📋 Planned`
- **Intent:** beta users can tell a solid answer from one that needs checking.
- **Scope:** per-answer signals:
  - whether the SQL was verified or auto-corrected
  - a match with a verified query
  - empty or suspicious results
  - the knowledge and data the answer relied on

  This builds on the existing SQL self-correction, verified queries and answer feedback.
- **Out of scope:** —
- **Acceptance:** *to be defined.* The Jira epic has only a description.
- **Notes:** see [docs/plans/phase-1-answer-reliability.md](docs/plans/phase-1-answer-reliability.md) and [docs/plans/phase-2-trust-ux.md](docs/plans/phase-2-trust-ux.md); confirm what has already shipped. The epic has no `1.0 Beta` fix version in Jira although it sits in the beta window.

### Milestone 1.5 — Data Connectors ([BA-5](https://halo-powered.atlassian.net/browse/BA-5))

Connect to the sources beta users actually have. Each connector needs reliable connection setup, schema discovery and read-only querying. All three kinds already exist in code (`DatasourceKind = 'databricks' | 'postgres' | 'rest'`), so this milestone is about hardening them to beta quality.

#### 1.5.1 — Databricks ([BA-6](https://halo-powered.atlassian.net/browse/BA-6))  `📋 Planned`
- **Intent:** beta users can query a Databricks SQL warehouse.
- **Scope:** connect with host, HTTP path and token; discover catalogs, schemas and tables through Unity Catalog; run read-only SQL.
- **Out of scope:** write access.
- **Acceptance:** *drafted from the epic; the Jira story has no description, so confirm there.* Connection setup validates and reports failures clearly, Unity Catalog discovery lists catalogs, schemas, tables and columns, and only read-only statements run.

#### 1.5.2 — Postgres ([BA-7](https://halo-powered.atlassian.net/browse/BA-7))  `📋 Planned`
- **Intent:** beta users can query PostgreSQL.
- **Scope:** connect with host, port, database and credentials (with SSL); discover schemas, tables and columns; run read-only SQL.
- **Out of scope:** write access.
- **Acceptance:** *drafted from the epic; confirm in Jira.* SSL connections work, discovery is complete, and only read-only statements run. The existing *Datasources, datasets, and sessions (World Cup database)* scenarios in [specs/capabilities/datasources/spec.md](specs/capabilities/datasources/spec.md) stay green.

#### 1.5.3 — REST API ([BA-8](https://halo-powered.atlassian.net/browse/BA-8))  `📋 Planned`
- **Intent:** beta users can query HTTP APIs as datasets.
- **Scope:** connect with each API's auth, discover endpoints from OpenAPI specs, and map JSON responses into tabular datasets.
- **Out of scope:** —
- **Acceptance:** *drafted from the epic; confirm in Jira.* An OpenAPI spec yields selectable endpoints, and a JSON response maps to rows the assistant can query.

### Milestone 1.6 — User Testing ([BA-10](https://halo-powered.atlassian.net/browse/BA-10))

Hands-on testing of the beta build with real users and their data. No fix version in Jira yet.

#### 1.6.1 — Beta user testing round  `📋 Planned`
- **Intent:** find what breaks or confuses real users before release.
- **Scope:** real users install the app, connect a source, ask questions and build visuals; issues, confusing flows and wrong answers are captured as Jira bugs or feedback under [BA-11](https://halo-powered.atlassian.net/browse/BA-11).
- **Out of scope:** fixing (1.7).
- **Acceptance:** every finding is filed in Jira and triaged into 1.7 or the backlog.
- **Notes:** needs an installer build (**Actions → Build desktop installers**) of the release-candidate tag.

### Milestone 1.7 — Bug Fixes ([BA-11](https://halo-powered.atlassian.net/browse/BA-11))

Fix the bugs and blockers from user testing and the golden-dataset evals, and stabilize the build for the Oct 31 release. No fix version in Jira yet. New bugs filed under BA-11 get a feature here.

#### 1.7.1 — Session thread is empty after navigating away and back ([BA-83](https://halo-powered.atlassian.net/browse/BA-83))  `📋 Planned`
- **Intent:** returning to a session always shows its history.
- **Scope:** `SessionChat` only resets its messages when the session id changes (`frontend/src/app/features/sessions/components/session-chat/session-chat.ts`, the effect around line 255). Check whether the session is re-fetched on return, and that leaving mid-stream resets `sending()`.
- **Out of scope:** —
- **Acceptance:**
  - Returning to a session always shows its messages without a refresh, including after leaving mid-stream.
  - Same-id refreshes still do not abort an in-flight stream (the existing `SessionChat` rule in CLAUDE.md).
  - An E2E test covers leaving and returning.

#### 1.7.2 — Release stabilization  `📋 Planned`
- **Intent:** a shippable 1.0 Beta on 2026-10-31.
- **Scope:** blockers from 1.6 and 1.1; full E2E suite green; installers built for all platforms and published to the release.
- **Acceptance:** release tagged and installers attached; no open blocker bugs in BA.

Bugs found by the spec backfill (0.2.2), security first. Details: [evidence/0.2.2/findings.md](evidence/0.2.2/findings.md).

#### 1.7.3 — Datasource credentials stored in plaintext ([BA-101](https://halo-powered.atlassian.net/browse/BA-101))  `📋 Planned`
- **Intent:** datasource secrets are encrypted at rest like the LLM key.
- **Scope:** see the Jira bug and the Open question in [system/data-model.md](specs/system/data-model.md).
- **Acceptance:** Passwords, tokens and REST credentials/headers are encrypted and masked; existing installs are migrated.

#### 1.7.4 — Desktop backend reachable from the network ([BA-102](https://halo-powered.atlassian.net/browse/BA-102))  `📋 Planned`
- **Intent:** only the local machine can reach the desktop backend.
- **Scope:** see the Jira bug and the Open question in [system/api.md](specs/system/api.md).
- **Acceptance:** The desktop backend binds `127.0.0.1`.

#### 1.7.5 — Bearer tokens survive diagnostics redaction ([BA-91](https://halo-powered.atlassian.net/browse/BA-91))  `📋 Planned`
- **Intent:** no credential reaches the logs or an exported report.
- **Scope:** see the Jira bug and the Open question in [capabilities/diagnostics/spec.md](specs/capabilities/diagnostics/spec.md).
- **Acceptance:** `Authorization: Bearer <token>` and the missing key names (`pwd`, `passwd`, `access_key`, `private_key`) are fully redacted; a unit test covers each pattern.

#### 1.7.6 — Assistant SQL not limited to session datasets ([BA-103](https://halo-powered.atlassian.net/browse/BA-103))  `📋 Planned`
- **Intent:** the assistant can only query the session's datasets.
- **Scope:** see the Jira bug and the Open question in [capabilities/datasources/spec.md](specs/capabilities/datasources/spec.md).
- **Acceptance:** Statements naming entities outside the session's datasets are rejected with a clear message.

#### 1.7.7 — Read-only SQL guard is a keyword blacklist ([BA-104](https://halo-powered.atlassian.net/browse/BA-104))  `📋 Planned`
- **Intent:** read-only enforcement is correct and does not reject harmless queries.
- **Scope:** see the Jira bug and the Open question in [capabilities/datasources/spec.md](specs/capabilities/datasources/spec.md).
- **Acceptance:** A parser-based guard; `replace(...)` and `;` inside literals pass; Databricks writes are still rejected.

#### 1.7.8 — PostgreSQL SSL skips certificate checks ([BA-105](https://halo-powered.atlassian.net/browse/BA-105))  `📋 Planned`
- **Intent:** SSL connections are verified by default.
- **Scope:** see the Jira bug and the Open question in [capabilities/datasources/spec.md](specs/capabilities/datasources/spec.md).
- **Acceptance:** Certificates are verified unless the user opts out; a CA field exists.

#### 1.7.9 — Fixed default APP_SECRET fallback ([BA-106](https://halo-powered.atlassian.net/browse/BA-106))  `✅ Done`
- **Intent:** encrypted keys are never protected by a known secret, and a change of secret never leaves the LLM settings broken behind an unexplained backend error.
- **Scope:**
  - A bare backend with no `APP_SECRET` reads or generates `<APP_DATA_DIR>/.app-secret` (32 random bytes hex, mode 0600), the same as Electron main and the CLI. The fixed development default is no longer used to encrypt.
  - At startup, an LLM API key encrypted under the old development default (`insecure-dev-secret`) is re-encrypted with the current secret, so installs that ran before the launchers persisted a secret keep their key.
  - A stored key that neither secret can read no longer fails with a 500: the settings view reports `configured: false` with `keyUnreadable: true` and keeps provider, model and base URL; the LLM Configuration screen says the key must be entered again; agent turns, test and save without a key fail with the same readable message.
- **Out of scope:** encrypting datasource credentials (1.7.3, BA-101); recovering a key encrypted under a lost random secret (impossible by design).
- **Acceptance:**
  - A backend started with no `APP_SECRET` creates `.app-secret` in its data dir and reuses it on the next start; no "insecure development default" warning.
  - A key saved under the development default is readable after a launch with a real secret, and is stored re-encrypted under it.
  - A key under an unknown secret: `GET /llm/settings` is 200 with `keyUnreadable: true`; the screen shows "Your saved API key can't be read because the app secret changed. Enter the key again, test and save."; re-entering the key, testing and saving fixes it.
  - Gherkin in [capabilities/llm-settings/spec.md](specs/capabilities/llm-settings/spec.md) mirrored by `frontend/e2e/llm-settings.spec.ts`, green.
- **Notes:** found from a diagnostics report on 2026-10-06: the first launch of a data dir after commit `a3ef363` (Electron persists `.app-secret`) could not read the key saved under the development default.

#### 1.7.10 — Web-mode diagnostics export not redacted ([BA-107](https://halo-powered.atlassian.net/browse/BA-107))  `📋 Planned`
- **Intent:** redaction is the same in desktop and browser modes.
- **Scope:** see the Jira bug and the Open question in [capabilities/diagnostics/spec.md](specs/capabilities/diagnostics/spec.md).
- **Acceptance:** The browser-mode log buffer and export are redacted.

#### 1.7.11 — Tailoring after a revert overwrites a version ([BA-92](https://halo-powered.atlassian.net/browse/BA-92))  `📋 Planned`
- **Intent:** every visual version is immutable once written.
- **Scope:** see the Jira bug and the Open question in [capabilities/visuals/spec.md](specs/capabilities/visuals/spec.md).
- **Acceptance:** After revert v3 → v1 and a tailor, the new version is v4 and v1–v3 are unchanged.

#### 1.7.12 — Interrupted eval runs stay running ([BA-93](https://halo-powered.atlassian.net/browse/BA-93))  `📋 Planned`
- **Intent:** an interrupted eval run never blocks the agent or the UI.
- **Scope:** see the Jira bug and the Open question in [capabilities/agents-evals/spec.md](specs/capabilities/agents-evals/spec.md).
- **Acceptance:** On startup, runs left `running` are marked interrupted and can be deleted.

#### 1.7.13 — Auto-repair rebuilds from stale data ([BA-94](https://halo-powered.atlassian.net/browse/BA-94))  `📋 Planned`
- **Intent:** repairing a visual never loses its data.
- **Scope:** see the Jira bug and the Open question in [capabilities/visuals/spec.md](specs/capabilities/visuals/spec.md).
- **Acceptance:** Auto-repair uses the current version's `data.json`.

#### 1.7.14 — Verified query id rotates on re-approval ([BA-95](https://halo-powered.atlassian.net/browse/BA-95))  `📋 Planned`
- **Intent:** promoted metrics keep their source link.
- **Scope:** see the Jira bug and the Open question in [capabilities/verified-queries/spec.md](specs/capabilities/verified-queries/spec.md).
- **Acceptance:** Re-approving an answer keeps the verified query id.

#### 1.7.15 — Testing data clobbers same-name datasources ([BA-96](https://halo-powered.atlassian.net/browse/BA-96))  `📋 Planned`
- **Intent:** loading or removing sample data never touches user records.
- **Scope:** see the Jira bug and the Open question in [capabilities/testing-data/spec.md](specs/capabilities/testing-data/spec.md).
- **Acceptance:** Load and Remove affect only records the fixture created.

#### 1.7.16 — Dataset rename duplicates; delete unconfirmed ([BA-97](https://halo-powered.atlassian.net/browse/BA-97))  `📋 Planned`
- **Intent:** dataset edits and deletes are predictable.
- **Scope:** see the Jira bug and the Open question in [capabilities/datasets/spec.md](specs/capabilities/datasets/spec.md).
- **Acceptance:** Rename updates in place; delete asks for confirmation and names the sessions that use the dataset.

#### 1.7.17 — Datasource-scoped knowledge is never used ([BA-98](https://halo-powered.atlassian.net/browse/BA-98))  `📋 Planned`
- **Intent:** every saved knowledge entry can reach the assistant.
- **Scope:** see the Jira bug and the Open question in [capabilities/knowledge/spec.md](specs/capabilities/dataset-ontology/spec.md).
- **Acceptance:** Datasource-scoped entries are injected for sessions on that datasource, or the scope is removed.

#### 1.7.18 — Stale application-shell visual baseline ([BA-99](https://halo-powered.atlassian.net/browse/BA-99))  `📋 Planned`
- **Intent:** the visual baseline matches the current shell.
- **Scope:** see the Jira bug and the Open question in [system/ui.md](specs/system/ui.md).
- **Acceptance:** The baseline shows the current sidebar and the visual test passes.

#### 1.7.19 — Sidebar session order goes stale ([BA-100](https://halo-powered.atlassian.net/browse/BA-100))  `📋 Planned`
- **Intent:** the most recently used session is on top.
- **Scope:** see the Jira bug and the Open question in [capabilities/sessions-chat/spec.md](specs/capabilities/sessions-chat/spec.md).
- **Acceptance:** After a chat turn the session moves to the top without a reload.

#### 1.7.20 — Renderer honours a non-default `BACKEND_PORT` ([BA-109](https://halo-powered.atlassian.net/browse/BA-109))  `📋 Planned`
- **Intent:** setting `BACKEND_PORT` must move the whole desktop app to that port, not just the backend. Today the main process spawns the backend and runs its readiness probe on `BACKEND_PORT` (`frontend/electron/main.cjs`), but under `file://` the renderer hardcodes `http://localhost:3000` (`frontend/src/app/core/config/api.config.ts`), and the preload bridge doesn't expose the port. With `BACKEND_PORT=3123` the window opens and every API call fails, or it quietly reaches whatever else is listening on 3000.
- **Scope:** pass the resolved port from the main process to the renderer before Angular boots: through `preload.cjs` (`contextBridge`, e.g. `window.qti.backendPort`) or a query parameter on the `loadFile` / dev URL. Make `API_BASE_URL` read it and fall back to 3000. Cover `npm run electron`, `electron:dev` and packaged builds.
- **Out of scope:** automatic free-port fallback in Electron (the CLI already has one); the web / `npx` mode, which is same-origin and unaffected.
- **Acceptance:**
  - With `BACKEND_PORT=3123`, the packaged and `npm run electron` apps load sessions, datasources and chat against port 3123, and nothing requests `:3000`.
  - With no `BACKEND_PORT`, behaviour is unchanged.
  - A Playwright scenario in `frontend/e2e/` launches Electron with a non-default `BACKEND_PORT` and asserts the shell loads data (new Gherkin scenario in [specs/capabilities/app-shell/spec.md](specs/capabilities/app-shell/spec.md)).
  - The `API_BASE_URL` sentence in CLAUDE.md ("Known gap") is updated.
- **Notes:** moved from 0.1.1 on 2026-10-04 so the bug sits under a Jira epic (BA-11). Found while drawing the C4 container diagram ([specs/system/architecture.md](specs/system/architecture.md), Level 2). Related to ADR-0001.

### Milestone 1.8 — Agentic Hub Look and Feel ([BA-141](https://halo-powered.atlassian.net/browse/BA-141)) — archived, see roadmap-archive.md

### Milestone 1.9 — Agent Hub ([BA-150](https://halo-powered.atlassian.net/browse/BA-150)) — archived, see roadmap-archive.md

### Milestone 1.10 — LLM configuration ([BA-159](https://halo-powered.atlassian.net/browse/BA-159))

Users can configure any supported model in Settings → LLM, reasoning models included, and choose how hard it reasons from the levels that model offers. Stories 1.10.1–1.10.2 were built on the branch `feat/BA-159-llm-configuration` and shipped as one PR; stories 1.10.3–1.10.4 (GitHub Copilot provider, added 2026-11-09) are built on `feat/BA-159-github-copilot-provider`; 1.10.3 ships as a second PR at the user's request (2026-11-10), and 1.10.4 follows in a later one. Epic spec: [specs/epics/BA-159/spec.md](specs/epics/BA-159/spec.md).

#### 1.10.1 — Per-model reasoning effort in LLM Settings ([BA-160](https://halo-powered.atlassian.net/browse/BA-160))  `✅ Done`
- **Intent:** a user can configure `gpt-5` (or any reasoning model) and pick one of the effort levels that model accepts; today the connection test times out at 30 s and the model can't be saved.
- **Scope:** a built-in table of effort levels by model family (OpenAI `gpt-5` to `gpt-6`, the o-series, Claude models that take `effort`), with `low / medium / high` for unknown names and none for models without reasoning; `GET /llm/effort-levels` for the form; a **Reasoning effort** select in Settings → LLM showing the model's levels; Save stores the chosen effort; the connection probe (test and save) asks for the model's lowest level; turns send the chosen effort, mapped to the nearest level the model offers.
- **Out of scope:** the chat composer's effort menu and the agent editor's effort field (they keep `low / medium / high`); fetching levels from providers at runtime; changing the 30 s probe limit.
- **Acceptance:** Playwright (LenAI stub) shows `Minimal / Low / Medium / High` for deployment `gpt-5`, none for `gpt-4.1` and `Low / Medium / High` for an unknown name; the test probe carries `reasoning_effort: minimal`; saving with **Medium** stores `medium` and the next chat turn sends `reasoning_effort: medium`; existing LLM settings scenarios still pass; unit tests cover the level table, the probe body and the effort mapping; the llm-settings capability spec, `api.md`, `agents.md`, `data-model.md` and `ui.md` are updated.
- **Notes:** reported 2026-10-10 by the user: `gpt-5` failed Test connection with "LLM request timed out after 30s". Decisions taken with the user on 2026-10-10: the picker lives only in Settings → LLM; the probe uses the model's lowest level; levels come from a built-in table checked against the provider docs (OpenAI model pages, Anthropic's *Effort* page, 2026-10-10). Changing the effort does not withdraw a successful test, because the probe doesn't use it. Follow-up on 2026-10-10 at the user's request: the select is always visible (disabled with a `Default — …` option when the model is empty or has no levels), so users can discover it. E2E runs on the web target (BA-156) against the infra MCP World Cup database. Desktop not run. Evidence: [evidence/1.10.1/](evidence/1.10.1/).

#### 1.10.2 — Light theme and open navigation drawer by default, remembered in the database ([BA-168](https://halo-powered.atlassian.net/browse/BA-168))  `✅ Done`
- **Intent:** the app opens in the Light theme with the navigation drawer expanded, and a user who changes either finds the change kept, even in another browser profile or after reinstalling the renderer.
- **Scope:** Light becomes the default theme (System, Light and Dark stay as choices); the drawer opens expanded; the theme choice and the drawer's Expand / Collapse state are stored in a `ui-preferences` document in the `settings` collection through `GET` / `PUT /ui-preferences`; a browser-storage copy of each applies before the first paint, the backend winning once loaded; a theme saved only in browser storage moves to the backend once (M12).
- **Out of scope:** remembering the details panel (it still opens collapsed); per-user preferences (the app has no accounts); other settings.
- **Acceptance:** Playwright: a new install opens Light (even with a dark OS) with the drawer expanded; collapsing the drawer or choosing Dark survives a restart in a fresh browser profile on the same data; a browser-only Dark choice is moved to the database; existing appearance, navigation and layout scenarios pass (visual baselines updated on purpose for the expanded drawer); ADR-0009; app-shell R2, R39, R43, R50, `api.md` 2.12, `data-model.md` 3.2.1 and M12 updated.
- **Notes:** requested by the user on 2026-10-10 and shipped in the BA-159 PR at their request (an exception to one epic per PR, like the CLAUDE.md rule). Decisions taken with the user: keep System as a choice; database plus a browser cache for the first paint, with a one-time move of existing choices; "left bar" means the navigation drawer. ADR-0009 supersedes ADR-0007's preference storage and default. E2E runs on the web target (BA-156). Desktop not run, and the darwin desktop baseline was not regenerated. Evidence: [evidence/1.10.2/](evidence/1.10.2/).

#### 1.10.3 — GitHub Copilot as an LLM provider  `✅ Done`
- **Intent:** a developer with a GitHub Copilot seat picks **GitHub Copilot** in Settings → LLM Configuration, tests and saves, and every agent then runs on their own seat, with no API key and no extra spend.
- **Scope:** a fifth provider `copilot` ("GitHub Copilot") on the official Copilot SDK (ADR-0037): the backend starts one Copilot runtime and builds an AI SDK model whose tools are declared to Copilot without handlers, so Mastra keeps the tool loop, built-in Copilot tools are off and the system prompt is replaced; sign-in reuses the GitHub login already on the machine (gh CLI or Copilot CLI/app), and the form shows who is signed in or how to sign in; no API key or base URL; model defaults to `auto` (Copilot picks), **Load models** lists the seat's models, any typed name is accepted; Test connection runs the structured-output probe through the adapter; answers stream word by word; reasoning effort by model name, none for `auto`; abandoned Copilot sessions time out and the turn's abort signal stops them; the composer chip, the agent page and the catalogue name the provider; llm-settings, api.md, data-model, agents.md, ui.md, tech-stack, glossary and architecture (ADR-0037) updated; Gherkin for the new flows.
- **Out of scope:** a Sign in with GitHub button or pasted GitHub tokens; Copilot BYOK; the eval CLI's `EVAL_LLM_PROVIDER=copilot`; per-agent providers; bundling the runtime in installers (1.10.4).
- **Acceptance:** with a signed-in seat, Settings → LLM Configuration offers GitHub Copilot, shows the GitHub login, tests and saves with model `auto`; a chat turn on World Cup Core answers with real SQL tool calls and streams text; Load models answers (an empty list on a Free seat reads as Copilot choosing); with no GitHub login the test reports how to sign in and nothing is saved; switching back to another provider still needs that provider's key; unit tests for the adapter (tool loop, pending tool results, structured output, streaming, timeout and abort), the settings rules and the form; check-specs, lint, builds and the LLM settings Playwright specs green.
- **Notes:** requested by the user on 2026-11-09 after a spike: the official Copilot SDK 1.0.30 drove the real assistant through 7 World Cup eval cases (6 passed, the failure a wrong answer) and a streamed chat turn, using about 0.4 chat credits per question on a Copilot Free seat. Decisions by the user on 2026-11-09: reuse the machine's GitHub login; model `auto` plus Load models; real streaming; bundle the runtime in all builds; filed under BA-159 on a second branch `feat/BA-159-github-copilot-provider`, since Jira is no longer used. Accepted by the user by hand on 2026-11-10 and shipped on its own at their request, ahead of 1.10.4. E2E runs against a stub of the Copilot runtime spawned through the SDK's `COPILOT_CLI_PATH`; the real seat was verified by hand and by the assistant evals. Desktop not run. Evidence: [evidence/1.10.3/](evidence/1.10.3/).

#### 1.10.4 — Ship the Copilot runtime in the installers and the npm package  `📋 Planned`
- **Intent:** GitHub Copilot works out of the box in the desktop app and the npm CLI, with no separate install.
- **Scope:** the platform runtime package of `@github/copilot-sdk` (about 184 MB on Windows) is bundled in each desktop installer (unpacked from the asar archive) and installed with the npm package; the runtime path is resolved in packaged builds; delivery.md and tech-stack updated.
- **Out of scope:** downloading the runtime on first use; using an already installed Copilot CLI instead.
- **Acceptance:** a Windows installer built from the branch tests and saves GitHub Copilot and answers a chat turn; the npm package does the same through `npx`; installer size growth recorded in the evidence.
- **Notes:** split from 1.10.3 on 2026-11-09 so the provider can be tried in a dev run first.

### Milestone 1.11 — Claude Code workflow mod ([BA-169](https://halo-powered.atlassian.net/browse/BA-169)) — archived, see roadmap-archive.md

### Milestone 1.13 — Assistant skills: progressive-disclosure agent structure ([BA-198](https://halo-powered.atlassian.net/browse/BA-198)) — archived, see roadmap-archive.md

### Milestone 1.14 — Agent Hub: tools and skills per agent ([BA-213](https://halo-powered.atlassian.net/browse/BA-213))

A user agent's builder chooses its tools from the assistant's own set, writes skills in the app and assigns them to any of their agents; from 1.14.6 the builder does both by linking skills and tools in the agent's instructions (ADR-0024). Instructions stay layered on the core prompt, which from 1.14.11 a Platform admin can edit like every other built-in agent's prompt (ADR-0026); every guard enforced in code holds for every agent. Builds on Milestone 1.9 (ADR-0008) and Milestone 1.13 (ADR-0020). [BA-211](https://halo-powered.atlassian.net/browse/BA-211) (removing the skill folders) is not a dependency. All stories are built on the branch `feat/BA-213-agent-tools-skills` and ship as one PR. Epic spec: [specs/epics/BA-213/spec.md](specs/epics/BA-213/spec.md). Decisions: ADR-0022, ADR-0024 and ADR-0026 in [specs/system/architecture.md](specs/system/architecture.md). From 1.14.12 the hub also ships a second Official agent built in code, the RFP Builder, which walks a Mercer benefits consultant through a carrier RFP over the Intellify data, reached only through the Intellify RFP API this epic builds (ADR-0027, ADR-0028); plan: [docs/plans/BA-213/rfp-builder-plan.md](docs/plans/BA-213/rfp-builder-plan.md). From 1.14.18 every agent can show a file, a document, a query result, a visual or its workflow progress in the right panel, with what it showed saved per session (ADR-0029); design: [docs/plans/BA-213/ba-231-design.md](docs/plans/BA-213/ba-231-design.md).

#### 1.14.1 — ADR, epic spec and roadmap for agent tools and skills ([BA-214](https://halo-powered.atlassian.net/browse/BA-214))  `✅ Done`
- **Intent:** the epic is scoped, its runtime approach decided and its prompt cost measured before any code.
- **Scope:** ADR-0022 in `specs/system/architecture.md`; the BA-213 epic spec, with the per-section prompt measurement; this milestone with one feature per story; the epic row in `specs/README.md`.
- **Out of scope:** product code, and capability, system or glossary spec changes for behaviour that hasn't shipped yet. Each later story updates those itself.
- **Acceptance:** the user confirms the epic spec (`Status: Confirmed`) and ADR-0022 (`Accepted`); `python3 scripts/check-specs.py` passes.
- **Notes:** measured on 2026-10-14 from the compiled assistant at `513009d`: prompt 8,729 characters, `## Skills` 904, about 160 per extra catalog entry. Epic spec and ADR-0022 confirmed by the user on 2026-10-14. Evidence: [evidence/1.14.1/](evidence/1.14.1/).

#### 1.14.2 — Choose an agent's tools ([BA-217](https://halo-powered.atlassian.net/browse/BA-217))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.2/](evidence/1.14.2/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** an agent's builder decides which of the assistant's tools it gets, and the model is offered only those.
- **Scope:** `tools` in the agent configuration (absent means all); the assistant's tools and prompt built per call from the requestContext; `list_entities`, `describe_entity` and `run_readonly_sql` always on; `sample_rows`, `ask_clarification` and Visuals (`create_visual` + `update_visual`) optional; tool-free replacement wording for the rules that name a tool that is off; a tool picker in the agent editor; the preview runs the draft's tools; eval cases with clarification off and with Visuals off.
- **Out of scope:** new tools; tools for the System agents.
- **Acceptance:** a golden test proves the plain assistant's prompt is unchanged; a recording-stub E2E proves a tool turned off is not offered; the world-cup evals and the new cases pass at 100% over 3 runs.
- **Notes:** BA-211 (1.13.13) is merged in: only built-in and in-app skills exist. The checkbox tool picker is replaced by links in the instructions in 1.14.6 ([BA-219](https://halo-powered.atlassian.net/browse/BA-219)); the stored `tools` list stays, derived from the links.

#### 1.14.3 — Write skills in the app ([BA-215](https://halo-powered.atlassian.net/browse/BA-215))  `✅ Done`
- **Intent:** a user captures reusable know-how as a skill without touching the disk or restarting the app.
- **Scope:** an owner-scoped `skills` collection (name, description, body, reference files); create, list, get, update and delete endpoints; a skills library page and a skill editor in the Agents area; the file-skill checks (kebab-case name unique per owner and not a built-in name, `Use when` description, linked files present) and size limits.
- **Out of scope:** scripts; overriding built-in skills; sharing skills between users.
- **Acceptance:** Playwright covers create → edit → delete and each refusal; an API test proves two users never see each other's skills.
- **Notes:** endpoints 94-98 in api.md 2.6.1; rules R68-R74.

#### 1.14.4 — Assign skills to an agent ([BA-216](https://halo-powered.atlassian.net/browse/BA-216))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.4/](evidence/1.14.4/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** the same skill serves several agents, and a Live agent never changes until it is republished.
- **Scope:** `skills` in the agent configuration; a skill picker in the agent editor; the agent session's catalog (built-in on-demand skills plus the agent's); `read_file` over a virtual location for in-app skills; publish copies the skills' content into the Live version; the agent page's Skills tab for user agents; agent transfer carries the draft's skill references.
- **Out of scope:** in-app skills for the plain assistant.
- **Acceptance:** a recording-stub E2E proves an assigned skill is in the catalog, `read_file` returns its body, and a Live session keeps the published copy after the skill is edited; the world-cup evals pass at 100% over 3 runs.
- **Notes:** depends on 1.14.3. In-app skill locations are virtual paths under `/in-app-skills/`, read by the unchanged `read_file`, so the plain assistant's prompt stays byte-identical. The checkbox skill picker is replaced by links in the instructions in 1.14.6 ([BA-219](https://halo-powered.atlassian.net/browse/BA-219)); the stored `skills` list stays, derived from the links.

#### 1.14.5 — Edit built-in skills in the app ([BA-218](https://halo-powered.atlassian.net/browse/BA-218))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.5/](evidence/1.14.5/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** every skill can be changed from the app, the built-in ones included, without breaking the pipelines that fill their templates.
- **Scope:** ADR-0023; the skills library's Built-in section; a built-in skill editor (description, body, the built-in's own files; no files added or removed); org-wide overrides in a shared `skill_overrides` collection, resolved per call over every other level; the folder-override checks (placeholders kept); **Modified** chip, **Reset to built-in**, and a notice when the shipped built-in changed; `edit-policies` to change, Use agents to view.
- **Out of scope:** per-user overrides; version history of an override; editing a built-in's file list.
- **Acceptance:** an API test proves a refused override (a missing placeholder) changes nothing; a recording-stub E2E proves a `curated-knowledge` override's description reaches the plain assistant's catalog and Reset restores the built-in; a user without `edit-policies` can't save; the world-cup evals pass at 100% over 3 runs with no override.
- **Notes:** decisions taken with the user on 2026-10-14: Platform admin only, all three built-ins, applied on Save with Reset as the undo.

#### 1.14.6 — Link skills and tools in an agent's instructions ([BA-219](https://halo-powered.atlassian.net/browse/BA-219))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.6/](evidence/1.14.6/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** the agent's builder writes its instructions and links the skills and tools it should use with `/`, and what is linked is what the agent gets, replacing the checkbox pickers.
- **Scope:** ADR-0024; `[[skill:<name>]]` and `[[tool:<name>]]` in the instructions; a lazy-loaded Tiptap editor with the `/` menu, chips (broken links in a danger colour), **+ Link skill** and **+ Link tool**, counters and hints; the backend derives `tools` and `skills` from the links on every save and ignores the request's lists; refusals `Unknown skill`, `Unknown tool` and the 10-skill cap; links become plain mentions in Block 5; a skill linked by a draft can't be deleted or renamed; legacy agents get a `Tools and skills:` line and a notice; read-only chips on the Prompt template tab; the editor's Tools and Skills checkboxes are removed (replacing the pickers of 1.14.2 and 1.14.4).
- **Out of scope:** linking built-in skills; skills linking skills; replacing the core prompt; a draft-wide link rewrite when a skill is renamed.
- **Acceptance:** unit tests for link parsing, derivation, resolution and the refusals; a recording-stub E2E proves only linked tools are offered, a linked skill reaches the catalog and the model never sees `[[`; `/` inside a word doesn't open the menu; the plain assistant's prompt is byte-identical; the world-cup evals pass at 100% over 3 runs.
- **Notes:** design in [docs/plans/BA-213/ba-219-221-design.md](docs/plans/BA-213/ba-219-221-design.md), applying the agent-poc *Agent configurator guide* on this app's architecture. Rules R43, R55, R60, R72, R81-R86.

#### 1.14.7 — Skills link tools ([BA-220](https://halo-powered.atlassian.net/browse/BA-220))  `✅ Done`
- **Intent:** a skill carries the tools it needs, so an agent that links the skill gets them.
- **Scope:** the skill editor's Body is the link editor, tools only; `Skills can link tools only` and `Unknown tool` refusals; `tools` on `SkillSummary`; the optional tools an agent's linked skills link are added to its selection at call time (Live copies, or the current skills in a preview); in-app `SKILL.md` content served with links resolved and shown as chips on the Skills tab.
- **Out of scope:** links in built-in skill bodies or overrides; skills linking skills.
- **Acceptance:** unit tests for the effective selection (direct links plus skill links, Live copies versus preview); a recording-stub E2E proves a linked skill's tool is offered; `read_file` serves no `[[`.
- **Notes:** depends on 1.14.6. Rules R70, R84, R86.

#### 1.14.8 — Tools library, Graph and LLM Config tabs ([BA-221](https://halo-powered.atlassian.net/browse/BA-221))  `✅ Done`
- **Intent:** the builder sees why each tool is there, how instructions, skills and tools connect, and which model settings the agent runs on.
- **Scope:** the Tools tab of a user agent as the whole library with `Always on`, `Linked` and `Not linked` and where each link comes from; a new Graph tab (SVG, three columns, hover and focus highlight, legend, **Show unlinked**, the four steps of what happens on each message; `buildFlowGraph` as a pure function); the Model tab becomes **LLM Config** (provider, model, API key `Set` or `Not set`, max output tokens, reasoning effort; never the key); `toolLinks` and `llm` in the agent detail (api 34).
- **Out of scope:** editing LLM settings from the tab; a graph for built-in agents.
- **Acceptance:** unit tests for the graph layout and `connectedTo`, `toolLinks` and that `llm` never carries the key; Playwright shows the chain instructions to skill to tool, the `Show unlinked` toggle, and `API key Set` without the key.
- **Notes:** depends on 1.14.6 and 1.14.7. Rules R87-R89.

#### 1.14.9 — Agent page as in the reference: Chat Box, editable System Prompt and Skills tabs ([BA-222](https://halo-powered.atlassian.net/browse/BA-222))  `✅ Done`
- **Intent:** the builder works on an agent from one page, as in the agent-poc reference: chat with the draft, edit its instructions in place with links, and manage its skills, without going to the editor or the library.
- **Scope:** ADR-0025; the agent page's tabs in the order Chat Box, System Prompt (was Prompt template), Skills, Tools, Graph, Memory, Evals, LLM Config, ids kept; a **Chat Box** tab (the draft's preview session in the page, `Chat with the draft`, **New chat**; the Official agent shows **Start chat**); the **System Prompt** tab with the core prompt collapsed and fixed and the agent's instructions editable in place (link editor, **+ Link skill or tool**, `Linked:` row, broken-link error, **Save prompt**, unsaved-changes prompt); the user agent's **Skills** tab as the inline skill library (`Linked` and `Not linked` per skill, **New skill**, **Edit**, **Delete** inline, the built-in section); default tab Chat Box (System Prompt for System agents).
- **Out of scope:** editing the core prompt (made editable later by 1.14.11, BA-224); a Chat Box for System agents; changing the agent editor page, which keeps its Instructions field and its Details-panel preview; a skill picker, since links decide what an agent gets.
- **Acceptance:** frontend unit tests for the tab order and default per agent kind, the System Prompt save payload keeping the draft's other fields, the broken-link refusal, the Linked / Not linked chips, the inline skill create, edit and delete calls, **New chat** discarding and recreating the session, and the Official agent's **Start chat**; Playwright covers the Agent editor Feature's new scenarios; `python3 scripts/check-specs.py` passes.
- **Notes:** design in [docs/plans/BA-213/ba-222-223-design.md](docs/plans/BA-213/ba-222-223-design.md). Rules R5, R6, R60, R61, R63, R86, R90-R96; UI 4.5, 4.5.8-4.5.10. Depends on 1.14.6 and 1.14.8.

#### 1.14.10 — Skills reach the model through Mastra's skill tool ([BA-223](https://halo-powered.atlassian.net/browse/BA-223))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.10/](evidence/1.14.10/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** the assistant gets its on-demand skills the way the agent-poc reference does, through the framework's `skills` and skill tool, so the app no longer maintains its own catalog, file reader and script runner.
- **Scope:** ADR-0025 (supersedes ADR-0020); the assistant's `skills` function resolved per request: the built-in on-demand skills with an in-app override's content, plus, for a call bound to a user agent, the agent's in-app skills (Live copies, or current ones in a preview), each a `createSkill` with links resolved and reference files as `references`; user and project folder skills given the same way until BA-211; removed: the app-rendered `## Skills` section, `read_file`, `run_skill_script`, the `/in-app-skills/` paths; the prompt is identity, `## Tools`, `## Working rules`; the golden fixture and agents.md Appendix A regenerated; the recorded-request E2E scenarios updated.
- **Out of scope:** the harness-loaded skills (`deep-analysis`, `interactive-visuals`), which keep their system messages; a skill script runner; workspace skills.
- **Acceptance:** unit tests for the skills resolved per call (plain, with an override, with an agent, links resolved, references present), `getInstructions()` with no `## Skills`, the tools without `read_file` and `run_skill_script`, and the golden regenerated and stable; the recording-stub E2E scenarios of "Skills the assistant is given" and the agent editor pass; the world-cup evals pass at 100% (every case 3 runs, all 3 passing) on `claude-sonnet-5`, base commit versus branch, same data dir.
- **Notes:** design in [docs/plans/BA-213/ba-222-223-design.md](docs/plans/BA-213/ba-222-223-design.md). The exact tool names Mastra 1.66 provides are recorded in agents.md 3.9 by the implementation. 1.14.4's `read_file` and virtual paths, and 1.13.9's `## Skills` section, are superseded by this story.

#### 1.14.11 — Edit every agent's System Prompt, built-in agents included ([BA-224](https://halo-powered.atlassian.net/browse/BA-224))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.11/](evidence/1.14.11/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** every agent's System Prompt is editable from its page, as in the agent-poc reference: user agents already edit their instructions (1.14.9); a Platform admin can now edit the Official assistant's prompt and the five System agents' prompts too.
- **Scope:** ADR-0026; a shared `agent_prompt_overrides` collection keyed by registry key and resolved per call, so a save applies to the next call of every session, user agent, deep analysis, visual, SQL fix and verification, knowledge bootstrap and eval run; endpoints `PUT` and `DELETE /agents/:key/prompt` (`edit-policies`) and `prompt` on the agent detail; the System Prompt tab of a built-in agent with **Edit**, **Save prompt**, **Cancel**, **Reset to built-in**, the `Modified` chip, the warning banner and the drift notice; the assistant's editor is the tool-only link editor (links are mentions, never `[[skill:…]]`), a System agent's a plain text area; the assistant's `## Tools` section stays generated and is inserted before `## Working rules`; the override must start with the identity line; built-in on-demand skills (`curated-knowledge`) can be linked as mentions in the assistant's prompt and in user agent instructions (refusal `Only built-in skills can be linked here: this prompt is shared by every user`); the Official assistant's System Prompt view shows chips, a generated-Tools note and a collapsed `Prompt as sent to the model`, and its Graph shows its prompt's links; the shipped assistant prompt links its tools and `curated-knowledge` (the prompt text changes, so the evals run at the gate, see [docs/plans/BA-213/ba-224-linked-prompt.md](docs/plans/BA-213/ba-224-linked-prompt.md)).
- **Out of scope:** per-user overrides; version history of an override; editing a user agent's instructions (1.14.9); a Chat Box for System agents; changing an agent's tools, output schemas or guards, which stay in code.
- **Acceptance:** unit tests prove that with no override every prompt is byte-identical (the golden prompts pass untouched), that a save reaches the next call, the `## Tools` insertion with and without `## Working rules`, links resolved, the BA-217 replacements only on verbatim blocks, every refusal in order, Reset, `builtInChanged`, `edit-policies` on both routes, and that evals, the designer, the fixer and the bootstrap resolve the override; frontend unit tests cover Edit, Cancel, Save prompt, Reset, permission gating, the link editor versus the text area, the drift notice and the unsaved guard; the world-cup evals pass at 100% (every case 3 runs, all 3 passing) with no override; `python3 scripts/check-specs.py` passes.
- **Notes:** design in [docs/plans/BA-213/ba-224-design.md](docs/plans/BA-213/ba-224-design.md). Rules R6, R46, R91, R92 change and R97-R104 are new in [agents-evals](specs/capabilities/agents-evals/spec.md); data-model 3.10.3; api 34, 103, 104; agents.md 1.1, 2.1-2.6, 9; ui.md 4.5.11. Narrows 1.14.9's "Out of scope: editing the core prompt". Depends on 1.14.9 and follows 1.14.5's override pattern.

#### 1.14.12 — ADRs, epic amendment and specs for the RFP Builder and the Intellify RFP API ([BA-225](https://halo-powered.atlassian.net/browse/BA-225))  `✅ Done`
- **Intent:** the RFP work is decided and specified before any code: where the API lives, how the agent reaches it, how sessions bind to a built-in agent, and what the package is.
- **Scope:** ADR-0027 and ADR-0028; the BA-213 epic amendment (scope, narrowed out-of-scope, stories, specs touched, acceptance) re-confirmed by the user; the new `rfp` capability spec with its Rules and Gherkin; the api.md 2.16 contract, the data-model `rfp` schema, agents.md 2.8 and 3.10, the glossary terms and the README row.
- **Out of scope:** code.
- **Acceptance:** the user confirms the amended epic spec and both ADRs; `python3 scripts/check-specs.py` passes with the new capability (its Feature marked `E2E: none yet` until 1.14.16).
- **Notes:** plan in [docs/plans/BA-213/rfp-builder-plan.md](docs/plans/BA-213/rfp-builder-plan.md), confirmed by the user on 2026-10-14 with its defaults.

#### 1.14.13 — The Intellify RFP API: read endpoints, auth, OpenAPI, embedded start and Testing Data registration ([BA-226](https://halo-powered.atlassian.net/browse/BA-226))  `✅ Done`
- **Intent:** the Intellify data is reachable through a REST API we own, from the app and from any client with the key.
- **Scope:** `backend/src/intellify-api/` as a second NestJS app (ADR-0027); `INTELLIFY_*` configuration; `X-API-Key` guard; the error shape; `GET /health`, `GET /openapi.json`; the collection routes (clients, products, funding-types, plan-types, carriers, plan-designs, policies, financials, census) and the per-client routes (client, renewals, program, plans/{id}, financials, census, commercials, wizards) in READ ONLY transactions; embedded start from `createApp()` with `INTELLIFY_API=off`, CLI flags and banner line, the key file; `npm run intellify-api`; the `intellify-api` self-registering REST fixture and its card; the E2E fixture's port variable; `backend/test/intellify-api.e2e-spec.ts` for the reads.
- **Out of scope:** RFP records and the package (1.14.14); the agent (1.14.15).
- **Acceptance:** with the Intellify sample loaded, `GET /v1/clients/IC100100/program` answers the client's plans with carriers and 2026 premiums; Discover on a REST datasource at the API URL proposes the 10 collection endpoints; registering the fixture yields the "Intellify RFP API" datasource and dataset with 10/10 entities; the plain assistant answers "How many clients are there?" over that dataset.

#### 1.14.14 — RFP records and the RFP package in the API ([BA-227](https://halo-powered.atlassian.net/browse/BA-227))  `✅ Done`
- **Intent:** an RFP's decisions are saved and resumable, and the package is a deterministic projection of the record.
- **Scope:** the `rfp` schema and migrations (data-model 7); `POST/GET/PATCH/DELETE /v1/rfps`, the four `PUT` list routes, the bulk delete by creator; status and stage rules; `document.md`, `document.pdf` (pdfkit), `exhibits/*.csv`, `package.zip`; API e2e scenarios for the records and the package.
- **Out of scope:** the agent's tools (1.14.15); snapshots at issue time.
- **Acceptance:** the API Feature's record and package scenarios pass; a reseed of the `intellify` schema leaves drafts intact; the PDF opens and carries every section of the Markdown.

#### 1.14.15 — The RFP Builder agent: prompt, skill, tools, hub and sessions ([BA-228](https://halo-powered.atlassian.net/browse/BA-228))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.15/](evidence/1.14.15/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** a consultant starts a chat with the RFP Builder from the hub and is walked through the seven stages, with every decision saved through the API.
- **Scope:** the `rfp` agent (ADR-0028) with its editable prompt and generated `## Tools`; seven stage skills, one per stage (`rfp-client-renewal` … `rfp-package`; split on 2026-10-14 from a single `rfp-process` skill with seven reference files); the 19 RFP tools plus `ask_clarification`, resolving the API through the session's REST datasource; `kind: official`, Start chat over the fixture's dataset, `agentKey` on sessions, the per-agent turn, Block R1, `rfpId` on the session; the `rfp` eval set and the harness running a set's agent; agents.md 2.8/3.10, agents-evals and sessions-chat rules.
- **Out of scope:** the package tool and card (1.14.16); SQL tools for the agent; per-user RFP access.
- **Notes (2026-10-15):** the `rfp` eval set grew from 8 to 28 cases (agents.md 8.1): custom checks with their own ids (tool arguments, call order, the record read back), case setups that start from a saved RFP named as the active one, earlier turns, a session bound to the RFP Builder and clean-up after every case (the API's eval clean-up now removes an eval run's records whatever their status, api.md I29). The new cases led to prompt rules (stated decisions are saved at once, data questions answered directly, no save claimed without a tool, `update_workflow` without steps and with a short todo, the panel's table kind), a `## Start` step in every stage skill, the list tools returning `total`, and clearer `get_client_commercials` wording; on `claude-sonnet-5` the final version passed 28/28 once; the 3-run gate is still open (the provider account ran out of credit during the second run).
- **Acceptance:** the hub shows RFP Builder under Official with Start chat; a session created from it runs the agent (its first request offers no `run_readonly_sql`); the `rfp` eval set passes at 100% over 3 runs on `claude-sonnet-5` (and the world-cup set stays at 100%, the assistant's golden prompt test unchanged); a recording-stub E2E proves the skill catalog carries the stage skills and the system message carries Block R1.

#### 1.14.16 — The RFP package from the chat ([BA-229](https://halo-powered.atlassian.net/browse/BA-229))  `✅ Done`
- **Intent:** the consultant gets the RFP document and exhibits from the chat without leaving the app.
- **Scope:** `export_rfp_package` through the tool-services bridge (`modules/rfp-packages`); files under the session workspace `rfp/<rfpId>/`; the `rfp-package` stream event and `rfpPackage` on the answer; `GET /sessions/:id/rfp-packages/:rfpId/download[?file=]`; the package card; the draft export at any stage (`export_rfp_draft`, `draft=true` on the Intellify package route and on the download route, the `draft/` workspace folder, the `Draft` chip and `Download draft (.zip)`; RFP R16); the `RFP builder` Playwright Feature (all scenarios) and evidence.
- **Out of scope:** editing the package in the app; emailing it.
- **Acceptance:** the Feature's scenarios pass on the web target with the LLM stub; the downloaded zip holds `rfp.md`, `rfp.pdf`, four CSVs and `manifest.json`; a draft exported at any stage downloads as a zip whose document title starts with `DRAFT — `, whose manifest has `draft: true` and the stage, never overwrites the final package, and shows `RFP package (draft) · 7 files` with a `Draft` chip; `check-specs.py`, unit tests, builds and the impacted E2E specs are green.

#### 1.14.17 — Visuals follow the app's Light and Dark theme ([BA-230](https://halo-powered.atlassian.net/browse/BA-230))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.17/](evidence/1.14.17/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** a visual looks like the rest of the app: light in the Light theme, dark in the Dark theme, instead of always a dark block.
- **Scope:** the readable frame's colours become tokens with a Light and a Dark value (visuals R40); the frame's `data-theme` attribute, written by the visual panel before the document loads and switched in place by a `qti-theme` message when the app theme changes; the chart runtime's label colours read the tokens; the designer is told to take its colours from the tokens (`interactive-visuals` skill, `reference/freeform.md`, `reference/spec-mode.md`; the freeform `css` field description); the visuals, agents and ui specs; a Playwright scenario per new Gherkin scenario. Also the "Agentic Hub" banner is reduced from 136 px to 72 px (title 28/36 px; ui.md 1.2), so the session header, the workflow bar and the chat keep the height; the `application-shell` visual baseline is updated at the acceptance gate. And the start page shows a welcome that explains how the product works in four steps, each opening the place it names, with an Explore agents button (app-shell R51, ui.md 4.1), in place of the empty placeholder composer. The New conversation screen gets an Agent picker (Assistant by default, the RFP Builder and the Live agents; the agent's datasets show as read-only chips and Create starts a session bound to it, with the typed name when given; sessions-chat R64, api.md 2.1 #3 optional `name`). The chat and panel text is reduced from 16/24 px to 14/22 px (answers, user messages, "Data used", panel documents; Markdown tables 13 px with 40 px rows; ui.md 3.5, 4.12). The Sessions page lists every session in the middle of the page, with a search field, each row's agent / dataset line, last activity and a Delete session menu; the navigation rail and drawer no longer list sessions, and the drawer's "+" button is gone (app-shell R3, R46, sessions-chat R63, ui.md 1.3, 4.7.1). The app's chrome is made compact (about 20-25 % less vertical space, 2026-10-14): rail 56 / drawer 208 px with 36 px items, 52 px banner, 20 px page titles, 32 px buttons and fields, 40 px panel headers, 8 px gaps; chat and document reading text stays 14 px / 22 px (ui.md 1.2, 1.3, 3.6). The rail's menu button sits beside the "Agentic Hub" title in the drawer (alone above the logo on the collapsed rail).
- **Scope, New conversation Agent picker (BA-230, 2026-10-15):** the native Agent `select` becomes the app's dropdown, a listbox whose options show each agent's name and description, with the reason on a disabled one's second line (ui.md 4.7).
- **Out of scope:** a migration of stored visuals (the panel rebuilds each document from the stored bundle on every load); rewriting colours a freeform designer hardcoded in its own CSS (known limitation); a theme choice per visual.
- **Acceptance:** a visual opened in the Light theme has a light frame and chart, and in the Dark theme a dark one; switching Appearance with a visual open re-themes it without reloading (its state, hover and filters survive); a visual made before the change opens themed; the downloaded `index.html` follows the operating system's setting; the visual evals pass at 100% over 3 runs on the branch.
- **Notes:** the visual evals are required because the designer skill and the freeform schema change what the designer agent receives (workflow step 9). Decisions by the user on 2026-10-14: the visual follows the app theme; existing visuals are re-themed when viewed.

#### 1.14.18 — Agents choose what the right panel shows ([BA-231](https://halo-powered.atlassian.net/browse/BA-231))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.18/](evidence/1.14.18/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** an agent can put the thing the user wants to read, sort or download beside the chat (a document, a file, a query result, a visual, its progress through a workflow), and what it showed is still there when the session is reopened.
- **Scope:** one built-in tool `show_in_panel`, always on for every agent (the assistant, the RFP Builder, every user agent), with four kinds: `file`, `document`, `table`, `visual` (a fifth, `phases`, was removed on 2026-10-14, see the last Scope item); panel items saved on the session with the visuals in the same history (ADR-0029); the `## Workflow` prompt convention and its parser, so the tracker shows every phase from the first turn; the current-phase card (a note from the `phases` call, shown under the current phase) so the agent guides the user through its process, cleared by the RFP stage auto-drive when the phase changes; the RFP Builder's stages under `## Workflow`, its saved stage driving the tracker and its package document shown after export; the `panel-item` stream event; `GET /sessions/:id/panel-items/:itemId/file` and `.../download`; the right panel becomes the Session panel (item views, shown-items menu, Download button, empty state); the new capability [agent-panel](specs/capabilities/agent-panel/spec.md) and its cross-links; the assistant's and RFP Builder's prompts and the `rfp-package` skill; the session id in the page header with a copy button (sessions-chat R62), so a user can share it to diagnose a session; the Markdown prose styles made global so panel documents render like chat answers; the workflow status bar (added 2026-10-14): a second always-on tool `update_workflow` (`steps`, `current`, `done`, `skipped`, `waiting`, `note`, `todo`) with which the agent creates and updates the steps (fixed when the prompt has a `## Workflow` section, agent-defined otherwise), one workflow state shared with `show_in_panel` kind `phases` and the RFP auto-drive, the `workflow` stream event, and the bar pinned under the page header above the chat (statuses, `n/m done`, the note, fold persisted per browser, step popover, narrow layout) with the assistant's Workflow prompt block and the RFP Builder's Process rule; what the user must do in each open step (added 2026-10-14): a default action on each `## Workflow` line (`: <action>`), overridden by the agent's `todo`, shown in the bar as `Your next step:`, in the open steps' tooltips and popover and in the tracker; the `Agent panel` Playwright Feature and evidence. Design: [docs/plans/BA-213/ba-231-design.md](docs/plans/BA-213/ba-231-design.md). While a turn streams, a skill step names the skill it uses (`Using skill: <name>`, `Reading skill file: …`, `Searching skills: …`), and every tool step shows its input from the moment the call starts (the `tool` event carries `input`).
- **Scope, panel history and bar polish (2026-10-15):** a visual's header drops its own saved-visuals menu (visuals are switched through "Shown in this session"), and the workflow bar shows done and skipped steps icon-only, then fades its right edge, when the steps overflow (ui.md 4.12.1, 4.13).
- **Scope, the workflow lives only in the bar (2026-10-14):** `show_in_panel` loses the kind `phases` and its `current`, `done` and `note` inputs; the RFP stage auto-drive and `update_workflow` update the workflow state and send the `workflow` event only (no `phases` panel item, no `panel-item`); a stored `phases` item is dropped when the session is read; the Session panel has no tracker view and never opens on a workflow; the workflow bar gets a `Details` dropdown (`Workflow details`) and its second row shrinks to one line `Your next step: <action>` (Details opens on the current step, its note included; the `Note` link was dropped on 2026-10-15 as redundant with Details); the `workflow-tracker` component is deleted.
- **Out of scope:** editing a shown document in the panel; rendering `.csv` files as tables (they show as monospace text); a `table` item built from an earlier turn's results; a per-agent choice to turn the tool off; binary files (PDF, images).
- **Acceptance:** the `Agent panel` Feature's scenarios pass on the web target with the LLM stub; a composed document downloads as `.md` and a table as `.csv`; an invalid path is refused with the tool's error; shown items survive reopening the session; the workflow shows only in the bar and never in the right panel (no `phases` kind, no tracker, no `panel-item` for a workflow change), the bar's `Details` dropdown lists every step with the agent's note under the current one and closes on Escape, an outside click and its button, and the next-step row is one line; the workflow bar shows an agent's `## Workflow` steps from the first turn, an `update_workflow` call moves it live (statuses, `n/m done`, waiting and note), an agent without a section can create its own steps but cannot rename the prompt's (the exact error), and the bar folds and stays folded across a reload; the `world-cup`, `formula-1` and `rfp` eval sets pass at 100% over 3 runs on the branch (the assistant's and the RFP Builder's prompts, tools and skill change); `check-specs.py`, unit tests, builds and the impacted E2E specs are green.
- **Notes:** decisions by the user on 2026-10-14: one built-in tool, always on for every agent; it shows a workspace file, a Markdown document, a query result table, an existing visual and workflow phases; phases come from a `## Workflow` section of the prompt; everything shown is saved per session. Defaults taken: the RFP Builder's saved stage also drives the tracker; `table` references this turn's query results only. Watch the `rfp-skill-first` eval case (a `phases` call before the stage skill would break its tool order).

#### 1.14.19 — Single-user app: remove authentication and authorization, keep only the super admin ([BA-232](https://halo-powered.atlassian.net/browse/BA-232))  `✅ Done`
- **Intent:** the app is for one person, so it opens straight into the shell with no sign-in and every feature is available; nothing about users, roles or permissions remains to configure, explain or pay for on every request.
- **Scope:** ADR-0030; one built-in super admin (id `local`) is always the caller; removed: the sign-in page, `/me`, `/auth/*`, `/scim/*`, `/admin/*`, roles, permissions and the permission guard, the Origin check and cookies, `ORG_*` configuration, org server mode (Entra ID, SCIM), local personas, the Admin area, data owner, ownership transfer, sharing and the "Yours" / "Shared with you" filters, the account menu and avatar; migration M14 consolidates every owned document under `local`, renames the UI-preference and pin keys, drops the seven identity collections and renames clashing skills; `ownerId` stays as an inert attribute; the desktop readiness probe goes back to `GET /sessions`; the CLI banner loses `Mode:`; the `org` Playwright project, `test:e2e:org` and the org and local-sign-in specs are deleted; the Admin capability spec is deleted and every other spec is rewritten for one user.
- **Out of scope:** any replacement access control (the host is the boundary); changing the desktop backend's bind address (kept by the user's choice); a way back to multi-user (needs a new ADR).
- **Acceptance:** the app opens straight into the shell with no sign-in page, no account menu and no Admin rail item; every area and Settings section is reachable and Reasoning effort is always shown; sessions, agents, skills, knowledge, metrics and verified queries owned by any user are listed after opening an old data dir, and `app.sqlite` has no `users` table; `grep -rn "ORG_\|RequirePermission\|CurrentUserService\|auth.can\|/me'" backend/src frontend/src` is empty; the `navigation.spec.ts` scenario "opens as the super admin" passes; `check-specs.py`, unit tests, builds and the impacted E2E specs are green. No eval gate: nothing an agent receives changes.
- **Notes:** asked on 2026-10-14: "No just leave the super admin user remove everything related to authentication and authorization". Decisions: single user, no sign-in; Admin area removed entirely; other users' data reassigned to the super admin; the super admin's name appears nowhere (agents keep "Owner: You"); the desktop bind is unchanged and the ADR states the exposure (anyone who reaches the port has full access). Design: [docs/plans/BA-213/ba-232-design.md](docs/plans/BA-213/ba-232-design.md).

### Milestone 1.15 — US Health demo ([BA-233](https://halo-powered.atlassian.net/browse/BA-233)) — archived, see roadmap-archive.md

### Milestone 1.16 — Data Readiness Agent ([BA-251](https://halo-powered.atlassian.net/browse/BA-251)) — archived, see roadmap-archive.md

### Milestone 1.17 — Custom LLM endpoint provider ([BA-281](https://halo-powered.atlassian.net/browse/BA-281)) — archived, see roadmap-archive.md

### Milestone 1.18 — Desktop installer builds ([BA-302](https://halo-powered.atlassian.net/browse/BA-302)) — archived, see roadmap-archive.md

### Milestone 1.19 — US Health testing data ([BA-305](https://halo-powered.atlassian.net/browse/BA-305)) — archived, see roadmap-archive.md

### Milestone 1.20 — Schema metadata in datasets ([BA-318](https://halo-powered.atlassian.net/browse/BA-318)) — archived, see roadmap-archive.md

### Milestone 1.21 — Questions to Insights v2 ([BA-320](https://halo-powered.atlassian.net/browse/BA-320)) — archived, see roadmap-archive.md

### Milestone 1.22 — Sampled profiling and synthetic data (M1-22) — archived, see roadmap-archive.md

### Milestone 1.23 — Workflow-first: chats run workflows, agents are building blocks (M1-23)

The app becomes workflow-first: a chat runs a **workflow** defined in code, and agents are the building blocks that its steps call (workflows → agents → skills → tools). Every agent without a workflow of its own gets an automatic one-step workflow, so every session runs a workflow and there is one turn path. A **Workflows** area on the rail lists them, shows what each does on every message and starts chats; **Agents** becomes the library. The four showcase agents are removed. The epic started on 2026-11-11 as "Questions to Insights v2: a workflow you can follow" (story 1.23.1) and was widened the same day. Decision: ADR-0040. All stories are built on the branch `feat/M1-23-workflow-first` and ship as one PR. Epic spec: [specs/epics/M1-23/spec.md](specs/epics/M1-23/spec.md). Plan and contract: [docs/plans/m1-23-workflow-first.md](docs/plans/m1-23-workflow-first.md). No Jira key (repo only). Build order: 1.23.1, 1.23.2, 1.23.8, 1.23.3, then 1.23.4 with 1.23.5 in parallel, then 1.23.6 with 1.23.7 in parallel.

#### 1.23.1 — The Graph tab draws a workflow-backed agent's turn  `🚧 In progress`
- **Intent:** open Questions to Insights v2 → **Graph** and see, step by step, what happens on each message. Show which steps are code and which is the LLM, what each step receives and returns, the agent's tools and step limit inside the LLM step, and where a turn fails or stops.
- **Scope:**
  - `GET /agents/:key` (api.md 34) gains `workflow?` for a workflow-backed agent (today only `assistant-v2`). It holds the workflow id and its steps in order, each with:
    - id, title, kind (`code` or `agent`) and a one-line summary;
    - input and output field names, taken from the step's schemas;
    - for the agent step, its tools and maximum steps;
    - the step's other exits (`fails` or `stops`, with a label).
  - The data is built from the registered workflow and its step catalogue, never written twice, so a step added in code shows up without a UI change.
  - Graph tab of a workflow-backed agent, top section **What happens on each message**:
    - one node per step, left to right, in the workflow bar's titles and numbering;
    - code steps and the agent step in two distinct styles, with a legend;
    - the agent step drawn open: agent name, its tools and a loop marker `≤ <n> steps`;
    - labelled arrows carry the data passed between steps;
    - each step's other exits are drawn under it.
    - Hovering or focusing a step highlights it. Clicking it opens a details card under the drawing with its kind, summary, input and output.
  - Under it, the existing prompt-links graph keeps its behaviour under a **Prompt links** heading.
  - Specs: agents-evals R105 (+ a new rule and a Gherkin scenario), api.md 34, ui.md 4.5.6, agents.md 5.11 (the step catalogue's summaries and exits).
- **Out of scope:**
  - a run's live or last status on the drawing;
  - editing the workflow from the UI;
  - Graph changes for the assistant, the RFP Builder, the Data Readiness Agent, user agents and System agents;
  - the non-streamed turn;
  - changing the workflow's steps or what reaches the model.
- **Acceptance:**
  - Questions to Insights v2's Graph tab shows `Receive question`, `Load catalog`, `Analyse` and `Wrap up` in order:
    - Analyse is in the agent style, with `list_entities`, `describe_entity`, `run_readonly_sql` and `≤ 15 steps`;
    - the other three are in the code style;
    - the arrows are labelled with the step outputs;
    - the exits are visible: empty question fails, Stop ends at Analyse, model error fails.
  - Clicking `Load catalog` shows its input `question, datasets` and output `question, catalog`.
  - The Prompt links graph is still there.
  - The assistant's Graph tab is unchanged.
  - The axe scan passes in both themes.
  - Unit tests:
    - the `workflow` field matches the registered workflow's step order and schemas;
    - the layout is a pure function.
  - The `@demo @story-1.23.1` scenario passes.
  - Builds and check-specs are green.
- **Notes:** requested on 2026-11-11, after a review of agent-vs-workflow approaches. The user chose the Graph tab over a new tab, the definition only (no run status) for now, and a new epic because Milestone 1.21 has shipped. UI story: its demo is recorded in the fast loop. Built and committed (8fa8b745) before the epic was widened; its drawing is reused by 1.23.5.

#### 1.23.2 — Workflow-first: ADR, epic spec, glossary and roadmap  `🚧 In progress`
- **Intent:** the move to workflow-first is decided and scoped before any code, so each later story can be built and reviewed on its own.
- **Scope:**
  - ADR-0040 in `specs/system/architecture.md`, with "amended by ADR-0040" on ADR-0004, 0008, 0028, 0029 and 0034;
  - the widened epic spec, its README row and this milestone's entries;
  - the glossary terms: Workflow, One-step workflow, Code-defined workflow; Session and Agent amended.
- **Out of scope:** product code; the capability, api, data-model, agents and ui specs (each later story updates its own).
- **Acceptance:** ADR-0040 is `Accepted` and the epic spec `Confirmed (<date>)` by the user; `origin/main` was merged first and the ADR number re-checked; check-specs passes.
- **Notes:** S-size docs story. Plan: [docs/plans/m1-23-workflow-first.md](docs/plans/m1-23-workflow-first.md).

#### 1.23.8 — Remove the showcase agents  `📋 Planned`
- **Intent:** the four showcase agents (Benchmarking, Survey, LAD COE, Strategy), which never run, are gone from the app.
- **Scope:** their agent files, registration and shipped prompts; every showcase branch in the backend and the agent hub; a saved pin or prompt override for their keys is ignored, never an error (no migration). Specs: agents-evals R106 retired and the lines naming them, agents.md 2.9, api.md 33, sessions-chat R64, ui.md, glossary. Past epic specs stay as history.
- **Out of scope:** System agents; any other agent.
- **Acceptance:** no showcase agent in the hub or the new-session picker; `GET /agents/benchmarking` answers 404; with a pin and an override saved for `strategy`, the hub and `GET /agents` still load; `agent-hub` and `session-management` specs updated; the `@demo @story-1.23.8` scenario passes; builds, unit tests, lint and check-specs green.
- **Notes:** requested on 2026-11-11 (answer to the plan's open question 1). Built right after 1.23.2, so later stories have no showcase case. Detail: plan section 7.

#### 1.23.3 — The workflow catalogue: list, detail, and sessions bound to a workflow  `📋 Planned`
- **Intent:** the backend knows every workflow a chat can run, says which one a session runs and which workflows use an agent, and starts a session from a workflow id. No UI.
- **Scope:** the framework-free workflow catalogue and `agent-turn` step catalogue; `GET /workflows`, `GET /workflows/:id`; `POST /sessions { workflowId }`; a new session stores `workflowId`; the session's `workflowRef`; the agent's `usedInWorkflows`; the new `workflows` capability spec, api.md, data-model 3.4, agents.md.
- **Out of scope:** the turn path (1.23.4); every UI change; editing workflows.
- **Acceptance:** unit tests for the derivation table, id parsing, drift and the creation invariant; the backend e2e `backend/test/workflows.e2e-spec.ts` (catalogue order, user agents Live-only, 404s, sessions from a workflow, `usedInWorkflows`); existing agent and session e2e specs unchanged; check-specs, lint, builds, unit tests green.
- **Notes:** API-only: its demo is `evidence/1.23.3/demo.txt`. Detail and contract: plan sections 4, 5 and 7.

#### 1.23.4 — Every streamed turn runs the session's workflow  `📋 Planned`
- **Intent:** one turn path: an assistant, RFP Builder, Data Readiness or user-agent turn is a run of its one-step workflow, with the same answer, events, bar and stored message as before.
- **Scope:** the `agent-turn` Mastra workflow; `runTurnWorkflow` replaces the v2-only path and the direct agent call; a one-step workflow never writes the bar; one real trace captured and Monitoring kept true (workflow spans classed as Framework only if they appear); agents.md, agent-panel, sessions-chat, monitoring (if needed).
- **Out of scope:** the non-streamed turn; evals; any change to an agent's prompt, tools or context; UI.
- **Acceptance:** the existing session unit suites pass with only v2's internal names adapted; new unit tests per agent kind, bar, clarification and error handling; the request-recording Playwright specs unchanged and green; the `getInstructions()` and tool-list hashes equal on base and branch; builds and check-specs green.
- **Notes:** highest-risk story; trace before theorising. Demo: `evidence/1.23.4/demo.txt`. Parallel with 1.23.5.

#### 1.23.5 — A Workflows area: list, workflow page and Start chat  `📋 Planned`
- **Intent:** open **Workflows** on the rail, see every workflow you can run, open one to see what happens on each message and which agents it uses, and start a chat from it.
- **Scope:** the rail item; the list (search, Official and Mine sections, cards with Start chat and requirements); the workflow page (the 1.23.1 drawing, its agents, Start chat); app-shell, the `workflows` capability, ui.md.
- **Out of scope:** the composer's Workflow field (1.23.6); removing Start chat from agents (1.23.7); editing workflows; run status.
- **Acceptance:** `frontend/e2e/workflows.spec.ts` with `@demo @story-1.23.5` (open v2's workflow, open a user agent's one-step workflow, Start chat); a blocked workflow says why; no editing control exists; search; the axe scan on both pages in both themes; navigation specs green.
- **Notes:** UI story. Parallel with 1.23.4.

#### 1.23.6 — The New conversation screen picks a workflow; chats name their workflow  `📋 Planned`
- **Intent:** a chat is started by choosing a **Workflow**, and every chat names its workflow in its header and in the Sessions list.
- **Scope:** the composer's Agent field becomes Workflow (same listbox behaviour, Assistant preselected); Create sends the workflow id; the `Workflow` header chip on every chat and the Sessions list chip; sessions-chat, ui.md.
- **Out of scope:** the agent pages (1.23.7).
- **Acceptance:** `session-management.spec.ts` with `@demo @story-1.23.6` (pick v2, create, header and Sessions chip, the bar's four steps); a deleted agent's session and a pre-epic session name their workflow; the axe scan on the composer in both themes; every spec using the old composer test ids updated.
- **Notes:** UI story. Parallel with 1.23.7 (ownership of `app.ts` regions in the plan).

#### 1.23.7 — Agents are building blocks: no Start chat, and "Used in" workflows  `📋 Planned`
- **Intent:** the Agents area is a library: a chat is never started from an agent, and each agent shows which workflows use it.
- **Scope:** Start chat removed from hub cards and agent detail; the Official agents' Chat Box tab removed (System Prompt becomes their default tab; user agents keep Chat Box for the preview); the `Used in` line linking to workflow pages; agents-evals, sessions-chat, rfp, data-readiness, ui.md.
- **Out of scope:** the agent editor and preview chat.
- **Acceptance:** `agent-hub.spec.ts` with `@demo @story-1.23.7` (no Start chat; `Used in` opens the workflow page; RFP Builder has no Chat Box tab); draft-only and System agents show their empty `Used in` text; the RFP and Data Readiness Start chat scenarios pass through Workflows; the agent editor specs pass unchanged; the axe scan in both themes.
- **Notes:** UI story. After it, the epic's stories go through the acceptance gate, then one changelog entry and the PR.

#### 1.23.9 — Run a workflow on an input: the sequential test workflow  `🚧 In progress`
- **Intent:** a workflow runs once on a typed input and shows each step's result, with no chat. The first such workflow is a three-step test workflow.
- **Scope:** run workflows in the catalogue (`trigger`, typed `input` fields defined in code); the `seq-text-demo` workflow (Clean text → Count words → Format result, code only); `POST /workflows/:id/runs` (api.md 118, nothing stored); the run workflow's page with its input form, Run and the per-step result; the list card's Run button; chat-only refusals and pickers. Contract: plan section 9.
- **Out of scope:** converting the four chat workflows and changing how chats start (1.23.10); storing runs; streaming a run's progress; LLM steps.
- **Acceptance:** unit tests for the three step functions, the catalogue entry, input validation and the drift test; a backend e2e for 118 (success, failed step, missing field, chat workflow refused); `frontend/e2e/workflows.spec.ts` with `@demo @story-1.23.9` (open the Sequential test workflow, type a text, Run, see three Done steps and the summary; an empty text shows Clean text Failed and the other two Skipped); the axe scan of the run page in both themes; builds, unit tests, lint and check-specs green.
- **Notes:** requested on 2026-11-11 ("workflows trigger workflows, not chats; we'll define the input as we go"). The user chose: all workflows become run workflows (the four existing ones in 1.23.10), a code-only test workflow, results shown on the page and not stored.

Stories 1.23.10–1.23.27 retire chats: every workflow runs once on a typed input, runs are stored, past chats open read-only (ADR-0041). Plan and contract: [docs/plans/m1-23-retire-chats.md](docs/plans/m1-23-retire-chats.md); its section 11.1 maps the plan's ids (1.24.x, 1.25.x) to these. Phase A is 1.23.11–1.23.22, Phase B 1.23.23–1.23.25, Phase C 1.23.26–1.23.27. Requested on 2026-11-11; the user kept every phase in this epic and branch.

#### 1.23.10 — The workflow page as a designer: graph canvas in the middle, configuration on the right  `🚧 In progress`
- **Intent:** a workflow's page looks like a workflow designer: its graph on a central canvas (Start → steps → End, kind badges, zoom), and its configuration, inputs, outputs, run and code in tabs of the right-hand panel.
- **Scope:** plan section 11.2: header with breadcrumb and Execute; the canvas (pure layout function, HTML nodes over SVG connectors, toolbar, pan, selection); the right panel's Workflow, Step, Run and Code tabs; the 1.23.9 run form and result move into Run, with run status chips on the nodes; workflows spec and ui.md 4.4b.
- **Out of scope:** editing workflows; forks and parallel branches; the agent detail's Graph tab (unchanged).
- **Acceptance:** layout unit tests; `@demo @story-1.23.10` (v2 opens as a designer, select Analyse → Step tab, Code tab, run the test workflow from Execute with Done chips on its nodes); the 1.23.5 and 1.23.9 scenarios updated; axe in both themes with the panel open; builds, unit tests and check-specs green.
- **Notes:** from the user's screenshot of a workflow designer (2026-11-11). Frontend only; built first so the run stories add their inputs to the Run tab.

#### 1.23.11 — Chats retired: ADR-0041, epic spec, glossary and roadmap  `🚧 In progress`
- **Intent:** the retirement of chats is decided and scoped before code. **Scope:** ADR-0041 (Accepted) with its status pointers; the epic spec amendment; this roadmap; glossary terms Run, Run workflow, Past chat. **Acceptance:** check-specs green. **Notes:** plan 1.24.1.

#### 1.23.12 — Streamed runs of agent workflows on the backend  `📋 Planned`
- **Intent:** every agent workflow (Assistant, v2, RFP Builder, Data Readiness, user agents) runs once on a typed input with live progress, through today's turn path on a temporary host. **Acceptance:** a run's model request equals a chat turn's for the same input; per plan 1.24.2.

#### 1.23.13 — The answer view, extracted from the chat  `📋 Planned`
- **Intent:** the chat's answer rendering (text, data, SQL, visuals, files) becomes a component a run can show, with no visible change. **Acceptance:** per plan 1.24.3. Parallel with 1.23.12.

#### 1.23.14 — Stored runs, the run history API and run files  `📋 Planned`
- **Intent:** runs of agent workflows are stored (`workflow_runs`), listed and downloadable. **Acceptance:** per plan 1.24.4.

#### 1.23.15 — Run the Assistant, Questions to Insights v2 and user agents from their page  `📋 Planned`
- **Intent:** from the designer's Run tab, ask a question over picked datasets and see the answer, with Follow up carrying one earlier run. **Acceptance:** per plan 1.24.5, with `@demo @story-1.23.15`.

#### 1.23.16 — Run the Data Readiness Agent on a dataset  `📋 Planned`
- **Acceptance:** per plan 1.24.6; reports record the run that made them.

#### 1.23.17 — Run the RFP Builder one exchange at a time  `📋 Planned`
- **Acceptance:** per plan 1.24.7: one run per exchange keyed by the RFP id, with Continue.

#### 1.23.18 — Move the request-recording E2E specs from chats to runs  `📋 Planned`
- **Acceptance:** per plan 1.24.8 (tests only).

#### 1.23.19 — Rate a run's answer: verified queries from runs  `📋 Planned`
- **Acceptance:** per plan 1.24.9.

#### 1.23.20 — Monitoring shows runs  `📋 Planned`
- **Acceptance:** per plan 1.24.10.

#### 1.23.21 — Runs replace Sessions on the rail; past chats open read-only  `📋 Planned`
- **Acceptance:** per plan 1.24.11; no stored session is lost or migrated. Also carries what 1.23.15 left out of plan 1.24.5: reopening a stored run read-only (`run-detail`), Run again, the agent-phases bar inside the agent step, and the Careful mode "Cross-checked" run scenario; and Monitoring's "Sessions" tab, column and filter renamed for runs (left out of 1.23.20).

#### 1.23.22 — Chats can no longer start  `📋 Planned`
- **Acceptance:** per plan 1.24.12, including the desktop readiness probe on `GET /health`. Last story of Phase A.

#### 1.23.23 — Try it: run an agent's draft instead of a preview chat  `📋 Planned`
- **Acceptance:** per plan 1.25.2.

#### 1.23.24 — Deep analysis as a run workflow  `📋 Planned`
- **Acceptance:** per plan 1.25.3.

#### 1.23.25 — Visual actions on a run's result  `📋 Planned`
- **Acceptance:** per plan 1.25.4, including the visual card's View in a run's answer (not wired in 1.23.15: the right panel holds the designer).

#### 1.23.26 — Extract the turn engine; evals and dev scripts on run hosts  `🚧 In progress`
- **Scope now (moved up, wave S2):** only the turn-engine extraction, per [the speed-up contract](docs/plans/m1-23-dev-speedup.md) section "1.23.26 (moved up)". Evals and dev scripts on run hosts stay for later (plan 1.25.5).
- **Acceptance:** per the speed-up contract: `sessions.service.ts` shrinks by more than 1,500 lines; backend unit and e2e suites, the request-recording Playwright specs and the agent hashes are unchanged.

#### 1.23.27 — Remove the chat write paths and specs  `📋 Planned`
- **Acceptance:** per plan 1.25.6; past chats stay readable.

Stories 1.23.28–1.23.33 make the development workflow faster and cheaper, and 1.23.26 moves up to run before the rest of Phase A. The user decided on 2026-11-11 to implement every suggestion of the speed-up review on this branch. Contract: [docs/plans/m1-23-dev-speedup.md](docs/plans/m1-23-dev-speedup.md). Waves: S1 = 1.23.28, 1.23.29, 1.23.30, 1.23.31, 1.23.32; S2 = 1.23.26, 1.23.33; then Phase A resumes.

#### 1.23.28 — Lean story lane, model and effort routing, decide-before-build  `🚧 In progress`
- **Intent:** a story costs a fraction of today's time and tokens. **Scope:** contract section 1.23.28 (CLAUDE.md, the four workflow skills, builder.md, reviewer.md, delivery.md §10/12/13, lessons.md). **Acceptance:** check-specs green; a reviewer finds no contradiction between the documents.

#### 1.23.29 — `story-pack.mjs` and the spec section index  `📋 Planned`
- **Intent:** a builder starts from one generated brief instead of exploring. **Acceptance:** contract section 1.23.29.

#### 1.23.30 — Archive finished milestones of the roadmap  `📋 Planned`
- **Intent:** `roadmap.md` shrinks from 277 KB to under ~40 KB. **Acceptance:** contract section 1.23.30.

#### 1.23.31 — `qa.mjs --wave`: one verification for several stories  `📋 Planned`
- **Acceptance:** contract section 1.23.31.

#### 1.23.32 — Playwright in parallel  `📋 Planned`
- **Acceptance:** contract section 1.23.32: 3 workers, three green runs in a row, timings before and after.

#### 1.23.33 — Split `app.ts` / `app.html` by area  `🚧 In progress`
- **Scope:** [the speed-up contract](docs/plans/m1-23-dev-speedup.md) section "1.23.33".
- **Acceptance:** `app.ts` under ~500 lines and `app.html` under ~400; no visible or test-id change; the frontend unit suite and the full web Playwright suite pass.
---

## Release 2 — Multi-user  (no target date yet)

The app becomes multi-user. An organisation self-hosts it as an org server, with sign-in, roles and an admin panel. Local mode stays the default. Direction: [specs/product/vision.md](specs/product/vision.md). Not part of the 1.0 Beta.

### Milestone 2.1 — Admin Panel ([BA-161](https://halo-powered.atlassian.net/browse/BA-161)) — archived, see roadmap-archive.md

## Backlog

Not yet sequenced into a release. The detailed phase plans below predate this roadmap; when work on one resumes, split it into features under a milestone here and link back to the plan.

- Answer reliability — [docs/plans/phase-1-answer-reliability.md](docs/plans/phase-1-answer-reliability.md)
- Trust UX — [docs/plans/phase-2-trust-ux.md](docs/plans/phase-2-trust-ux.md)
- Visual quality + interactivity — [docs/plans/phase-3-visual-quality-interactivity.md](docs/plans/phase-3-visual-quality-interactivity.md)
- Strategic bets — [docs/plans/phase-4-strategic-bets.md](docs/plans/phase-4-strategic-bets.md)
- Agent Routines ([BA-82](https://halo-powered.atlassian.net/browse/BA-82)): an epic in Jira with no description, dates or fix version. Promote it into a release once it's defined.
- Data readiness: revisit heuristics inherited from the reference engine: the Data Readiness Agent (epic BA-251) keeps reference parity (spec R12–R19), so each item below needs a spec change first. Integrity counts relationships whose orphan count is unmeasured; reasonability may count a numeric ratio-named column twice; a future-dated column can make timeliness read fresh; the ratio/percent name heuristics are over-broad (`debt_ratio`, `growth_pct`); year-column freshness matches `birth_year`; `parseYear` misreads epoch values; join inference is case-sensitive with naive plurals; swapped-range pairing misses some spellings; the inferred-key regex matches `Paid`/`Valid`; duplicateCount counts NULL-key groups; Databricks accessibility is per schema; timeouts do not cancel warehouse statements.

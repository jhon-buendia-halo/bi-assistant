## Backlog

Not yet sequenced into a release. The detailed phase plans below predate this roadmap; when work on one resumes, split it into features under a milestone here and link back to the plan.

- Answer reliability — [docs/plans/phase-1-answer-reliability.md](docs/plans/phase-1-answer-reliability.md)
- Trust UX — [docs/plans/phase-2-trust-ux.md](docs/plans/phase-2-trust-ux.md)
- Visual quality + interactivity — [docs/plans/phase-3-visual-quality-interactivity.md](docs/plans/phase-3-visual-quality-interactivity.md)
- Strategic bets — [docs/plans/phase-4-strategic-bets.md](docs/plans/phase-4-strategic-bets.md)
- Agent Routines ([BA-82](https://halo-powered.atlassian.net/browse/BA-82)): an epic in Jira with no description, dates or fix version. Promote it into a release once it's defined.
- Data readiness: revisit heuristics inherited from the reference engine: the Data Readiness Agent (epic BA-251) keeps reference parity (spec R12–R19), so each item below needs a spec change first. Integrity counts relationships whose orphan count is unmeasured; reasonability may count a numeric ratio-named column twice; a future-dated column can make timeliness read fresh; the ratio/percent name heuristics are over-broad (`debt_ratio`, `growth_pct`); year-column freshness matches `birth_year`; `parseYear` misreads epoch values; join inference is case-sensitive with naive plurals; swapped-range pairing misses some spellings; the inferred-key regex matches `Paid`/`Valid`; duplicateCount counts NULL-key groups; Databricks accessibility is per schema; timeouts do not cancel warehouse statements.

### Moved from Milestone 0.4 — Harness Adjustments (2026-11-12)

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

### Moved from Milestone 1.1 — Golden Dataset and Evals (2026-11-12)

#### 1.1.1 — Golden dataset and eval suite  `📋 Planned`
- **Intent:** know, with numbers, whether a change made answers better or worse.
- **Scope:** a golden dataset of representative questions with known-correct answers on the sample fixtures. An eval suite (LLM judge plus SQL and result checks) that runs against it, building on the existing `assistant-eval-judge` agent and `mastra/evals/` and the Agents → Evals tab.
- **Out of scope:** evals on customer data.
- **Acceptance:** the suite runs on demand against the golden dataset and reports per-question and per-category results. Results can be compared run to run, and a knowledge on/off comparison is possible (needed by 1.3.3).
- **Notes:** Jira has no stories under this epic yet, so this feature mirrors the epic. Split it into stories in Jira first, then mirror them here.

### Moved from Milestone 1.2 — Data Model DSL (2026-11-12)

#### 1.2.1 — Data Model DSL  `📋 Planned`
- **Intent:** answers stop depending on what the model infers from raw schema alone.
- **Scope:** a domain-specific language describing entities, columns, relationships and business metrics; versionable; used to ground SQL generation.
- **Out of scope:** business meaning (synonyms, concepts). That belongs to the Knowledge Store, per the boundary set in 1.3.1.
- **Acceptance:** *to be defined.* The Jira epic has only a description. Agree the acceptance criteria before starting.
- **Notes:** architectural, so it needs an ADR in [specs/system/architecture.md](specs/system/architecture.md) before code. Overlaps the existing dataset metrics UI and the "semantic metrics layer" in [docs/plans/phase-4-strategic-bets.md](docs/plans/phase-4-strategic-bets.md) (item 13); reconcile the two. Assignee: Jhon Buendia.

### Moved from Milestone 1.3 — Knowledge Store (2026-11-12)

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

### Moved from Milestone 1.4 — Response Reliability Signals (2026-11-12)

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

### Moved from Milestone 1.5 — Data Connectors (2026-11-12)

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

### Moved from Milestone 1.6 — User Testing (2026-11-12)

#### 1.6.1 — Beta user testing round  `📋 Planned`
- **Intent:** find what breaks or confuses real users before release.
- **Scope:** real users install the app, connect a source, ask questions and build visuals; issues, confusing flows and wrong answers are captured as Jira bugs or feedback under [BA-11](https://halo-powered.atlassian.net/browse/BA-11).
- **Out of scope:** fixing (1.7).
- **Acceptance:** every finding is filed in Jira and triaged into 1.7 or the backlog.
- **Notes:** needs an installer build (**Actions → Build desktop installers**) of the release-candidate tag.

### Moved from Milestone 1.10 — LLM configuration (2026-11-12)

#### 1.10.4 — Ship the Copilot runtime in the installers and the npm package  `📋 Planned`
- **Intent:** GitHub Copilot works out of the box in the desktop app and the npm CLI, with no separate install.
- **Scope:** the platform runtime package of `@github/copilot-sdk` (about 184 MB on Windows) is bundled in each desktop installer (unpacked from the asar archive) and installed with the npm package; the runtime path is resolved in packaged builds; delivery.md and tech-stack updated.
- **Out of scope:** downloading the runtime on first use; using an already installed Copilot CLI instead.
- **Acceptance:** a Windows installer built from the branch tests and saves GitHub Copilot and answers a chat turn; the npm package does the same through `npx`; installer size growth recorded in the evidence.
- **Notes:** split from 1.10.3 on 2026-11-09 so the provider can be tried in a dev run first.

### Moved from Milestone 1.14 — Agent Hub: tools and skills per agent (2026-11-12)

#### 1.14.2 — Choose an agent's tools ([BA-217](https://halo-powered.atlassian.net/browse/BA-217))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.2/](evidence/1.14.2/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** an agent's builder decides which of the assistant's tools it gets, and the model is offered only those.
- **Scope:** `tools` in the agent configuration (absent means all); the assistant's tools and prompt built per call from the requestContext; `list_entities`, `describe_entity` and `run_readonly_sql` always on; `sample_rows`, `ask_clarification` and Visuals (`create_visual` + `update_visual`) optional; tool-free replacement wording for the rules that name a tool that is off; a tool picker in the agent editor; the preview runs the draft's tools; eval cases with clarification off and with Visuals off.
- **Out of scope:** new tools; tools for the System agents.
- **Acceptance:** a golden test proves the plain assistant's prompt is unchanged; a recording-stub E2E proves a tool turned off is not offered; the world-cup evals and the new cases pass at 100% over 3 runs.
- **Notes:** BA-211 (1.13.13) is merged in: only built-in and in-app skills exist. The checkbox tool picker is replaced by links in the instructions in 1.14.6 ([BA-219](https://halo-powered.atlassian.net/browse/BA-219)); the stored `tools` list stays, derived from the links.

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

#### 1.14.15 — The RFP Builder agent: prompt, skill, tools, hub and sessions ([BA-228](https://halo-powered.atlassian.net/browse/BA-228))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.15/](evidence/1.14.15/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** a consultant starts a chat with the RFP Builder from the hub and is walked through the seven stages, with every decision saved through the API.
- **Scope:** the `rfp` agent (ADR-0028) with its editable prompt and generated `## Tools`; seven stage skills, one per stage (`rfp-client-renewal` … `rfp-package`; split on 2026-10-14 from a single `rfp-process` skill with seven reference files); the 19 RFP tools plus `ask_clarification`, resolving the API through the session's REST datasource; `kind: official`, Start chat over the fixture's dataset, `agentKey` on sessions, the per-agent turn, Block R1, `rfpId` on the session; the `rfp` eval set and the harness running a set's agent; agents.md 2.8/3.10, agents-evals and sessions-chat rules.
- **Out of scope:** the package tool and card (1.14.16); SQL tools for the agent; per-user RFP access.
- **Notes (2026-10-15):** the `rfp` eval set grew from 8 to 28 cases (agents.md 8.1): custom checks with their own ids (tool arguments, call order, the record read back), case setups that start from a saved RFP named as the active one, earlier turns, a session bound to the RFP Builder and clean-up after every case (the API's eval clean-up now removes an eval run's records whatever their status, api.md I29). The new cases led to prompt rules (stated decisions are saved at once, data questions answered directly, no save claimed without a tool, `update_workflow` without steps and with a short todo, the panel's table kind), a `## Start` step in every stage skill, the list tools returning `total`, and clearer `get_client_commercials` wording; on `claude-sonnet-5` the final version passed 28/28 once; the 3-run gate is still open (the provider account ran out of credit during the second run).
- **Acceptance:** the hub shows RFP Builder under Official with Start chat; a session created from it runs the agent (its first request offers no `run_readonly_sql`); the `rfp` eval set passes at 100% over 3 runs on `claude-sonnet-5` (and the world-cup set stays at 100%, the assistant's golden prompt test unchanged); a recording-stub E2E proves the skill catalog carries the stage skills and the system message carries Block R1.

#### 1.14.17 — Visuals follow the app's Light and Dark theme ([BA-230](https://halo-powered.atlassian.net/browse/BA-230))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.17/](evidence/1.14.17/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** a visual looks like the rest of the app: light in the Light theme, dark in the Dark theme, instead of always a dark block.
- **Scope:** the readable frame's colours become tokens with a Light and a Dark value (visuals R40); the frame's `data-theme` attribute, written by the visual panel before the document loads and switched in place by a `qti-theme` message when the app theme changes; the chart runtime's label colours read the tokens; the designer is told to take its colours from the tokens (`interactive-visuals` skill, `reference/freeform.md`, `reference/spec-mode.md`; the freeform `css` field description); the visuals, agents and ui specs; a Playwright scenario per new Gherkin scenario. Also the "Agentic Hub" banner is reduced from 136 px to 72 px (title 28/36 px; ui.md 1.2), so the session header, the workflow bar and the chat keep the height; the `application-shell` visual baseline is updated at the acceptance gate. And the start page shows a welcome that explains how the product works in four steps, each opening the place it names, with an Explore agents button (app-shell R51, ui.md 4.1), in place of the empty placeholder composer. The New conversation screen gets an Agent picker (Assistant by default, the RFP Builder and the Live agents; the agent's datasets show as read-only chips and Create starts a session bound to it, with the typed name when given; agent-answers R64, api.md 2.1 #3 optional `name`). The chat and panel text is reduced from 16/24 px to 14/22 px (answers, user messages, "Data used", panel documents; Markdown tables 13 px with 40 px rows; ui.md 3.5, 4.12). The Sessions page lists every session in the middle of the page, with a search field, each row's agent / dataset line, last activity and a Delete session menu; the navigation rail and drawer no longer list sessions, and the drawer's "+" button is gone (app-shell R3, R46, past-chats R63, ui.md 1.3, 4.7.1). The app's chrome is made compact (about 20-25 % less vertical space, 2026-10-14): rail 56 / drawer 208 px with 36 px items, 52 px banner, 20 px page titles, 32 px buttons and fields, 40 px panel headers, 8 px gaps; chat and document reading text stays 14 px / 22 px (ui.md 1.2, 1.3, 3.6). The rail's menu button sits beside the "Agentic Hub" title in the drawer (alone above the logo on the collapsed rail).
- **Scope, New conversation Agent picker (BA-230, 2026-10-15):** the native Agent `select` becomes the app's dropdown, a listbox whose options show each agent's name and description, with the reason on a disabled one's second line (ui.md 4.7).
- **Out of scope:** a migration of stored visuals (the panel rebuilds each document from the stored bundle on every load); rewriting colours a freeform designer hardcoded in its own CSS (known limitation); a theme choice per visual.
- **Acceptance:** a visual opened in the Light theme has a light frame and chart, and in the Dark theme a dark one; switching Appearance with a visual open re-themes it without reloading (its state, hover and filters survive); a visual made before the change opens themed; the downloaded `index.html` follows the operating system's setting; the visual evals pass at 100% over 3 runs on the branch.
- **Notes:** the visual evals are required because the designer skill and the freeform schema change what the designer agent receives (workflow step 9). Decisions by the user on 2026-10-14: the visual follows the app theme; existing visuals are re-themed when viewed.

#### 1.14.18 — Agents choose what the right panel shows ([BA-231](https://halo-powered.atlassian.net/browse/BA-231))  `🚧 In progress`
- **Status (2026-10-15):** merged with PR #78; E2E green ([evidence/1.14.18/](evidence/1.14.18/)). The eval gate (100% over 3 runs) was deferred by the user's decision and is still owed; a first, partial pass is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
- **Intent:** an agent can put the thing the user wants to read, sort or download beside the chat (a document, a file, a query result, a visual, its progress through a workflow), and what it showed is still there when the session is reopened.
- **Scope:** one built-in tool `show_in_panel`, always on for every agent (the assistant, the RFP Builder, every user agent), with four kinds: `file`, `document`, `table`, `visual` (a fifth, `phases`, was removed on 2026-10-14, see the last Scope item); panel items saved on the session with the visuals in the same history (ADR-0029); the `## Workflow` prompt convention and its parser, so the tracker shows every phase from the first turn; the current-phase card (a note from the `phases` call, shown under the current phase) so the agent guides the user through its process, cleared by the RFP stage auto-drive when the phase changes; the RFP Builder's stages under `## Workflow`, its saved stage driving the tracker and its package document shown after export; the `panel-item` stream event; `GET /sessions/:id/panel-items/:itemId/file` and `.../download`; the right panel becomes the Session panel (item views, shown-items menu, Download button, empty state); the new capability [agent-panel](specs/capabilities/agent-panel/spec.md) and its cross-links; the assistant's and RFP Builder's prompts and the `rfp-package` skill; the session id in the page header with a copy button (past-chats R62), so a user can share it to diagnose a session; the Markdown prose styles made global so panel documents render like chat answers; the workflow status bar (added 2026-10-14): a second always-on tool `update_workflow` (`steps`, `current`, `done`, `skipped`, `waiting`, `note`, `todo`) with which the agent creates and updates the steps (fixed when the prompt has a `## Workflow` section, agent-defined otherwise), one workflow state shared with `show_in_panel` kind `phases` and the RFP auto-drive, the `workflow` stream event, and the bar pinned under the page header above the chat (statuses, `n/m done`, the note, fold persisted per browser, step popover, narrow layout) with the assistant's Workflow prompt block and the RFP Builder's Process rule; what the user must do in each open step (added 2026-10-14): a default action on each `## Workflow` line (`: <action>`), overridden by the agent's `todo`, shown in the bar as `Your next step:`, in the open steps' tooltips and popover and in the tracker; the `Agent panel` Playwright Feature and evidence. Design: [docs/plans/BA-213/ba-231-design.md](docs/plans/BA-213/ba-231-design.md). While a turn streams, a skill step names the skill it uses (`Using skill: <name>`, `Reading skill file: …`, `Searching skills: …`), and every tool step shows its input from the moment the call starts (the `tool` event carries `input`).
- **Scope, panel history and bar polish (2026-10-15):** a visual's header drops its own saved-visuals menu (visuals are switched through "Shown in this session"), and the workflow bar shows done and skipped steps icon-only, then fades its right edge, when the steps overflow (ui.md 4.12.1, 4.13).
- **Scope, the workflow lives only in the bar (2026-10-14):** `show_in_panel` loses the kind `phases` and its `current`, `done` and `note` inputs; the RFP stage auto-drive and `update_workflow` update the workflow state and send the `workflow` event only (no `phases` panel item, no `panel-item`); a stored `phases` item is dropped when the session is read; the Session panel has no tracker view and never opens on a workflow; the workflow bar gets a `Details` dropdown (`Workflow details`) and its second row shrinks to one line `Your next step: <action>` (Details opens on the current step, its note included; the `Note` link was dropped on 2026-10-15 as redundant with Details); the `workflow-tracker` component is deleted.
- **Out of scope:** editing a shown document in the panel; rendering `.csv` files as tables (they show as monospace text); a `table` item built from an earlier turn's results; a per-agent choice to turn the tool off; binary files (PDF, images).
- **Acceptance:** the `Agent panel` Feature's scenarios pass on the web target with the LLM stub; a composed document downloads as `.md` and a table as `.csv`; an invalid path is refused with the tool's error; shown items survive reopening the session; the workflow shows only in the bar and never in the right panel (no `phases` kind, no tracker, no `panel-item` for a workflow change), the bar's `Details` dropdown lists every step with the agent's note under the current one and closes on Escape, an outside click and its button, and the next-step row is one line; the workflow bar shows an agent's `## Workflow` steps from the first turn, an `update_workflow` call moves it live (statuses, `n/m done`, waiting and note), an agent without a section can create its own steps but cannot rename the prompt's (the exact error), and the bar folds and stays folded across a reload; the `world-cup`, `formula-1` and `rfp` eval sets pass at 100% over 3 runs on the branch (the assistant's and the RFP Builder's prompts, tools and skill change); `check-specs.py`, unit tests, builds and the impacted E2E specs are green.
- **Notes:** decisions by the user on 2026-10-14: one built-in tool, always on for every agent; it shows a workspace file, a Markdown document, a query result table, an existing visual and workflow phases; phases come from a `## Workflow` section of the prompt; everything shown is saved per session. Defaults taken: the RFP Builder's saved stage also drives the tracker; `table` references this turn's query results only. Watch the `rfp-skill-first` eval case (a `phases` call before the stage skill would break its tool order).

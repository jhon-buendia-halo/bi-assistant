# Changelog

Running log of every meaningful change, newest first. See *Logging convention* and *Evidence convention* in [CLAUDE.md](CLAUDE.md). Release versions come from Conventional Commits (`version-on-merge.yml`); this file records what shipped and links to the evidence.

## 2026-10-29

### Added
- **Knowledge Store research** (roadmap 1.3.5, [BA-123](https://halo-powered.atlassian.net/browse/BA-123), epic [BA-4](https://halo-powered.atlassian.net/browse/BA-4)): [docs/research/BA-4.md](docs/research/BA-4.md), the research story's deliverable, converted from the *Knowledge Store Ontology* artifact (version 3, 2026-10-07) and re-checked against `main` at 3012e34 (v0.24.2). Findings, options and recommendation up front; then theory and the market, how it applies to this app (what is on `main`, what is on a branch, what is missing), Hindsight memory, the concept and relation design, further reading, every source by type and the vendor appendix. The execution part and the "after" story of the artifact go to `docs/plans/BA-4.md` under BA-124. [specs/epics/BA-4/spec.md](specs/epics/BA-4/spec.md) links the research. Evidence: [evidence/1.3.5/](evidence/1.3.5/) — spec check and link check; no code or UI change, no E2E affected.
  - Written on 2026-10-07 against v0.24.2 and merged on 2026-10-29. Its new section 8 records what changed since: the evals that measured the knowledge seeds, Mastra's own memory, Hindsight 1.x, and the memory recommendation that moved to "Mastra only first, Hindsight + Mastra only if the eval of ADR-0031 says so". Evidence: [evidence/1.3.5/](evidence/1.3.5/).
- **Knowledge Store execution plan** (roadmap 1.3.6, [BA-124](https://halo-powered.atlassian.net/browse/BA-124), epic [BA-4](https://halo-powered.atlassian.net/browse/BA-4)): [docs/plans/BA-4.md](docs/plans/BA-4.md) (functional) and [docs/plans/BA-4-technical.md](docs/plans/BA-4-technical.md) (technical), the artifact's execution part and "after" story written against `main` at 3012e34 (v0.24.2): four steps with goals, done-when and status on `main`, the prerequisites that live only on branches with the merge-or-rebuild decision left open, the have/need inventory and status-check notes for later reviews. No branch was merged. Roadmap 1.3.1 to 1.3.4 and [specs/epics/BA-4/spec.md](specs/epics/BA-4/spec.md) link the plan. Still open for BA-124: the epic spec confirmation, the ADR and the roadmap text alignment. Evidence: [evidence/1.3.6/](evidence/1.3.6/) — spec check and link check; no code or UI change, no E2E affected.
  - Written on 2026-10-07 against v0.24.2 and merged on 2026-10-29 with: [ADR-0031](specs/system/architecture.md) (Proposed), the hypothesis and decision rule for cross-session memory (Mastra only first; Hindsight + Mastra only if a three-arm eval shows it is better); section 9 "Status 2026-10-29" in the functional plan and a pointer in the technical plan; the BA-4 epic spec confirmed by the user.
  - Roadmap 1.3.6 and 1.3.1 ([BA-78](https://halo-powered.atlassian.net/browse/BA-78), closed as covered) are Done; the ADR "knowledge as code in packs" moved to 1.3.2. Evidence: [evidence/1.3.6/](evidence/1.3.6/).

## 2026-10-16

### Changed
- **Harness: CLAUDE.md split into workflow-stage skills** (roadmap 0.4.1, [BA-236](https://halo-powered.atlassian.net/browse/BA-236), epic [BA-119](https://halo-powered.atlassian.net/browse/BA-119), [specs/epics/BA-119/spec.md](specs/epics/BA-119/spec.md)).
  - [CLAUDE.md](CLAUDE.md) keeps only the always-on core: the mandatory first action, the eleven steps (each naming its skill), the fast loop and acceptance gate, *Hard gates*, versioning and model usage. It went from 208 to 68 lines.
  - The conventions moved verbatim, as the RFP Builder loads a stage's skill, to the project skills `workflow-understand`, `workflow-plan`, `workflow-architecture`, `workflow-specs`, `workflow-e2e`, `workflow-implement`, `verify` (now also step 9), `workflow-ship` and `workflow-retrospective`.
  - *Model usage*: plans are made by Opus 5.5 at high effort (was Fable), at the user's request.
  - `check-specs.py` checks the links inside the skills. [delivery.md](specs/system/delivery.md) section 10 lists the skills, and the specs that cited a CLAUDE.md convention point at its skill.
  - Evidence: [evidence/0.4.1/](evidence/0.4.1/).

### Added
- **Harness: `.claude/tools/` and a Jira MCP server** (roadmap 0.4.2, [BA-237](https://halo-powered.atlassian.net/browse/BA-237), epic [BA-119](https://halo-powered.atlassian.net/browse/BA-119)).
  - `.claude/tools/` holds developer tools, each an MCP server or a script ([delivery.md](specs/system/delivery.md) section 11).
  - The first tool is `jira`, a dependency-free stdio MCP server registered in `.mcp.json` and enabled in `.claude/settings.json`. It provides:
    - `create_epic`
    - `create_issue`: a Story or Bug must name an Epic, which is checked before anything is created.
    - `update_issue`, `add_comment` and `transition_issue`.
    - the reads `jira.sh` had: `whoami`, `get_project`, `search_issues`, `get_issue` (with the parent's type, for the Epic gate), `list_statuses` and `list_transitions`.
  - Read tools run without asking; write tools ask every time. From a worktree it reads the main checkout's `.env`; `setup.mjs` writes the credentials from the developer's terminal.
  - Evidence: [evidence/0.4.2/](evidence/0.4.2/).

### Removed
- **`jira.sh`** (0.4.2, [BA-237](https://halo-powered.atlassian.net/browse/BA-237)). Replaced by the `jira` MCP tools, so a Jira call no longer needs `jq`, careful quoting, `JIRA_CONFIG_FILE` in a worktree, or `raw` to set a parent. The `jira` skill is now the guide to the tools. Evidence: [evidence/0.4.2/](evidence/0.4.2/).

## 2026-10-15

### Added
- **US Health demo** (epic [BA-233](https://halo-powered.atlassian.net/browse/BA-233), roadmap 1.15.1 and 1.15.2, [specs/epics/BA-233/spec.md](specs/epics/BA-233/spec.md)):
  - **Banner** ([BA-234](https://halo-powered.atlassian.net/browse/BA-234)): the top banner reads "US Health Agentic Hub"; the window title, drawer label, welcome heading and build identity keep "Agentic Hub" (app-shell R7). The `application-shell` baseline is refreshed. Evidence: [evidence/1.15.1/](evidence/1.15.1/).
  - **Showcase agents** ([BA-235](https://halo-powered.atlassian.net/browse/BA-235)): Benchmarking, LAD COE (Life, Absence and Disability Center of Excellence), Strategy and Survey agents, Official cards with inferred, editable prompts and no tools, dataset or chat. A "Showcase" chip, Start chat and the New conversation picker disabled with "Showcase agent: not available to chat yet.", sessions refused with that reason, and their page opening on the System Prompt (agents-evals R106; agents.md 2.9). The Official section now shows every card, showcase agents after the Assistant and the RFP Builder (R3). Evidence: [evidence/1.15.2/](evidence/1.15.2/).
- **Agent tools and skills, the RFP Builder, the agent panel and a single-user app** (epic [BA-213](https://halo-powered.atlassian.net/browse/BA-213), roadmap 1.14.2 to 1.14.19, PR #78; ADR-0022, ADR-0024, ADR-0026 to ADR-0030). Merged with E2E green and the **eval gate deferred** by the user's decision: stories whose acceptance needs the evals (1.14.2, 1.14.4, 1.14.5, 1.14.6, 1.14.10, 1.14.11, 1.14.15, 1.14.17, 1.14.18) stay `🚧 In progress` until world-cup, formula-1 and rfp pass at 100% over 3 runs; a first, partial pass (cut short when the OpenAI credits ran out) is in [evidence/1.14.15/eval-partial-2026-10-15.md](evidence/1.14.15/eval-partial-2026-10-15.md).
  - **Tools and skills** (1.14.2 [BA-217](https://halo-powered.atlassian.net/browse/BA-217), 1.14.3 [BA-215](https://halo-powered.atlassian.net/browse/BA-215), 1.14.4 [BA-216](https://halo-powered.atlassian.net/browse/BA-216), 1.14.5 [BA-218](https://halo-powered.atlassian.net/browse/BA-218), 1.14.6 [BA-219](https://halo-powered.atlassian.net/browse/BA-219), 1.14.7 [BA-220](https://halo-powered.atlassian.net/browse/BA-220)): an agent gets only the tools and skills its instructions link (`[[tool:…]]`, `[[skill:…]]`), skills are written in the app and link tools, built-in skills can be edited and reset. The skills library and a user agent's Skills tab list only the built-in skills every agent gets (R75 fix). Evidence: [evidence/1.14.2/](evidence/1.14.2/) to [evidence/1.14.7/](evidence/1.14.7/).
  - **Agent page** (1.14.8 [BA-221](https://halo-powered.atlassian.net/browse/BA-221), 1.14.9 [BA-222](https://halo-powered.atlassian.net/browse/BA-222), 1.14.10 [BA-223](https://halo-powered.atlassian.net/browse/BA-223), 1.14.11 [BA-224](https://halo-powered.atlassian.net/browse/BA-224)): Tools library, Graph and LLM Config tabs; Chat Box, editable System Prompt and Skills tabs; skills reach the model through Mastra's skill tool; every agent's System Prompt is editable, built-in ones included. Evidence: [evidence/1.14.8/](evidence/1.14.8/) to [evidence/1.14.11/](evidence/1.14.11/).
  - **RFP Builder and the Intellify RFP API** (1.14.12 [BA-225](https://halo-powered.atlassian.net/browse/BA-225) to 1.14.16 [BA-229](https://halo-powered.atlassian.net/browse/BA-229)): the Official RFP Builder agent with seven stage skills over the embedded Intellify RFP API (`X-API-Key`), RFP records, the package and a DRAFT export from the chat. The package card downloads `rfp-<title>.zip`, links no `manifest.json` and toasts "RFP package downloaded" (gate fixes). The RFP Builder keeps stage tables in its reply and says when it can't run SQL (agents.md R16, R17). Evidence: [evidence/1.14.12/](evidence/1.14.12/) to [evidence/1.14.16/](evidence/1.14.16/).
  - **Theme-aware visuals and shell** (1.14.17 [BA-230](https://halo-powered.atlassian.net/browse/BA-230)): visuals follow Light and Dark in place; a welcome page, the Sessions page, the New conversation Agent picker, compact chrome and 14/22 px chat text; the `application-shell` baseline updated. Evidence: [evidence/1.14.17/](evidence/1.14.17/).
  - **Agent panel and workflow bar** (1.14.18 [BA-231](https://halo-powered.atlassian.net/browse/BA-231), ADR-0029): `show_in_panel` and `update_workflow`, panel items saved per session, the workflow bar with Details and the next step. Evidence: [evidence/1.14.18/](evidence/1.14.18/).

### Removed
- **Authentication and authorization** (1.14.19 [BA-232](https://halo-powered.atlassian.net/browse/BA-232), ADR-0030): one built-in super admin; no sign-in, roles, permissions, org server mode, SCIM, Admin area or sharing; migration M14 moves every owned document to `local` and drops the identity collections. Final run of the whole web suite: 164 passed, 2 desktop-only skipped (desktop not run); backend API e2e 66/66. Evidence: [evidence/1.14.19/](evidence/1.14.19/).

### Changed
- **Sectioned assistant prompt and the app's own skill catalog** (roadmap 1.13.9, [BA-207](https://halo-powered.atlassian.net/browse/BA-207), epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198), ADR-0020):
  - **Prompt.** Identity, then `## Tools` (generated from the tools), `## Working rules`, then `## Skills` with an `<available_skills>` catalog the app renders (name, description, `SKILL.md` path).
  - **Tools.** `read_file` reads only listed skills' files, and replaces the framework's `skill`/`skill_search`/`skill_read`. `run_skill_script` runs a built-in skill's Node scripts with no shell, a minimal environment and a timeout; none ships yet.
  - **`curated-knowledge` on demand.** The knowledge block travels without its rules, and the model reads them with `read_file`.
  - **Descriptions.** A `SKILL.md` description may wrap.
  - Specs: agents.md 2.1, 3.9, 3.10, 7.3-7.5 and Appendix A; sessions-chat "Skills the assistant is given". Evidence: [evidence/1.13.9/](evidence/1.13.9/).
- **Eval checks** (roadmap 1.13.11, [BA-209](https://halo-powered.atlassian.net/browse/BA-209)). `result-set-match` passes a single complete query that holds every reference row, with extra rows and columns allowed. `schema-discovery` and `f1-schema-discovery` no longer require `list_entities`. Specs: agents-evals R31, agents.md 8. Evidence: [evidence/1.13.11/](evidence/1.13.11/).
- **Workflow eval bar** ([CLAUDE.md](CLAUDE.md) step 9). The evals must pass at 100%: every case in 3 runs out of 3.

### Fixed
- **Assistant reliability** (roadmap 1.13.12, [BA-210](https://halo-powered.atlassian.net/browse/BA-210)):
  - **Rules.** A4: asks when "best" has no measure. A12: adds nothing from general knowledge about what the data doesn't cover. A32: joins names in the same query. A35: answers "what data do I have" without a query.
  - **`create_visual`.** With no instruction it uses the user's request (`turn-question`).
  - **Designer data.** The designer is shown the result sets the instruction is about, not the largest.
  - **`ask_clarification`.** It takes one string with one option per line, and a malformed call is retried instead of shown as a card with no options.
  - Specs: agents.md 2.1, 3.5, 3.6, 4.2, 5.1, 6.2; sessions-chat R42 and a new scenario; visuals "Skills the designer is given". World-cup evals at 10/10 in 3 of 3 runs. Evidence: [evidence/1.13.12/](evidence/1.13.12/).
- **Backend lint, format and types** (roadmap 1.13.10, [BA-208](https://halo-powered.atlassian.net/browse/BA-208)). ESLint went from 217 errors to 0, Prettier is clean and `tsc` reports 0 errors, with no behaviour change. Evidence: [evidence/1.13.10/](evidence/1.13.10/).

## 2026-10-14

### Removed
- **User and project skill levels** (roadmap 1.13.13, [BA-211](https://halo-powered.atlassian.net/browse/BA-211), epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198), ADR-0021 superseding ADR-0019). Agents use only the skills that ship with the app:
  - **Backend.** Skills load only from the bundle. `<data dir>/skills/` is ignored (not read, not deleted) and `QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR` is gone, with no overrides, skipped skills or warnings. A broken built-in skill still stops startup.
  - **API.** `GET /agents/:key/skills` answers `{ skills: [{ name, description, loading, files }] }`.
  - **Skills tab.** Drops "Where skills come from", the level badges, "Overrides …", the warnings, the Skipped section and the "Restart the app" line.
  - The assistant's prompt, catalog and tools are unchanged (byte-identical prompt).
  - Specs: architecture ADR-0021; agents.md 2.2, 7.2-7.4; api.md 34a and environment table; ui.md 4.5; data-model.md 4.8; glossary *Skill*; agents-evals R63-R67 and "Agent skills"; sessions-chat "Skills the assistant is given"; BA-198 epic spec. Evidence: [evidence/1.13.13/](evidence/1.13.13/).

### Added
- **Agent tools and skills planned** (roadmap 1.14.1, [BA-214](https://halo-powered.atlassian.net/browse/BA-214), epic [BA-213](https://halo-powered.atlassian.net/browse/BA-213)):
  - **ADR-0022.** User agents choose their tools from the assistant's own set (`list_entities`, `describe_entity` and `run_readonly_sql` always on), and get skills written in the app, stored per user and copied into the Live version on publish. The assistant's prompt and tools are to be built per call. ADR-0008's status notes the narrowing.
  - **Epic spec** [specs/epics/BA-213/spec.md](specs/epics/BA-213/spec.md), confirmed with five decisions: a Skills button in the Agent Hub header, Visuals as one switch, no in-app skills for the plain assistant, size limits, and skill copies on agent transfer. It records the prompt measured section by section (8,729 characters; `## Skills` 904; about 160 per catalog entry).
  - **Roadmap.** Milestone 1.14 with features 1.14.1 to 1.14.4; the epic row in [specs/README.md](specs/README.md). Evidence: [evidence/1.14.1/](evidence/1.14.1/).
- **Intellify sample in Testing Data** (roadmap 1.1.2, [BA-212](https://halo-powered.atlassian.net/browse/BA-212), epic [BA-9](https://halo-powered.atlassian.net/browse/BA-9)). Settings → Testing Data lists a fourth sample, "Intellify": one click creates the `intellify` database on the sample server, seeds schema `intellify` and registers datasource "Intellify PostgreSQL" and dataset "Intellify" (`49/49 entities`, 52 declared joins).
  - **Model.** The Halo × Marsh Intellify ERD and data dictionary (49 entities, 243 attributes) converted to PostgreSQL: snake_case columns, `char(24)` ObjectIds, `jsonb` embedded objects, every table and column commented with its source field and description. All rows are synthetic (40 clients, 355 plan designs, 306 coverages with premiums, census 2024–2026, credits, fees, surveys, events).
  - **Seed.** `fixtures/003_intellify.sql.gz` is written by `scripts/generate-intellify-seed.py`, deterministically: rerunning it reproduces the file byte for byte.
  - **Tests.** `fixtures/registry.spec.ts` checks every bundled seed creates its required tables; `frontend/e2e/testing-data.spec.ts` automates two scenarios of the Testing data Feature. Specs: [testing-data](specs/capabilities/testing-data/spec.md) R2–R4, Flows and Acceptance; glossary; [BA-9 epic spec](specs/epics/BA-9/spec.md). Evidence: [evidence/1.1.2/](evidence/1.1.2/).
- **Skill levels** (roadmap 1.13.7, [BA-205](https://halo-powered.atlassian.net/browse/BA-205), epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198), ADR-0019). Agents read skills from three levels, and a later level overrides an earlier one by name:
  - **Levels.** Built-in (the bundle) < user (`<data dir>/skills/`) < project (the folder `QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR` names).
  - **Targeting.** A new user or project skill is on demand for the agents its `agents:` key names (default `assistant`). An override keeps the agents and loading mode of the skill it replaces.
  - **Broken skills.** A broken user or project skill is skipped and logged, and the backend keeps running; a broken built-in still stops startup.
  - **Override checks.** An override of a harness-loaded skill must keep its phase and reference files and their placeholders.
  - **Text only.** User and project skills are never run as scripts. `interactive-visuals/references/` became `reference/`.
  - Specs: agents.md §7.3-7.4, api.md environment table, data-model.md §4.8. Evidence: [evidence/1.13.7/](evidence/1.13.7/).
- **Skills tab on the agent page** (roadmap 1.13.8, [BA-206](https://halo-powered.atlassian.net/browse/BA-206)). It's read-only:
  - **What it shows.** Where each level's skills come from, the agent's skills (level, loading, what each overrides, description, warnings), each skill's files and their content, and the skipped skills with their problems.
  - **API.** New routes `GET /agents/:key/skills` and `GET /agents/:key/skills/:name/file`. A user agent shows the assistant's skills.
  - Specs: api.md 34a/34b, ui.md §4.5, agents-evals R63-R67 and the Feature "Agent skills". Evidence: [evidence/1.13.8/](evidence/1.13.8/).

### Changed

- **Workflow: fast loop, then acceptance gate** ([CLAUDE.md](CLAUDE.md) *Workflow*). A requested change now goes through steps 1–5 and 8 plus quick checks, and the running app is handed over for a manual test. Steps 6, 7, 9, 10 and 11 run once the user has accepted the change, once per story. Step 9 runs only the impacted E2E specs, and the evals must pass (no case regresses against the base commit) whenever an agent's prompt, skills, tools, context or model routing changes. The *E2E test convention* follows suit. Evidence: process change, no app behaviour change; `check-specs` passes and the `workflow-steps` mod still reads all eleven steps.

## 2026-10-13

### Fixed
- **`npm run evals:assistant` runs again** (roadmap 1.13.6, [BA-204](https://halo-powered.atlassian.net/browse/BA-204), epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198)):
  - The CLI passed no case ids, so every set was selected and the one-fixture preflight always refused.
  - It now takes `EVAL_SET` (a set id) or `EVAL_CASES` (case ids). With neither, both or an unknown id, it exits 1 before booting or calling a model.
  - Specs: agents.md §8.5, api.md environment table, delivery.md scripts table.
  - Test: `eval-cli-selection.spec.ts`.
  - Evidence: [evidence/1.13.6/](evidence/1.13.6/).

### Changed
- **The designer reads only the instructions for the mode it runs** (roadmap 1.13.5, [BA-203](https://halo-powered.atlassian.net/browse/BA-203), epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198)):
  - `interactive-visuals/SKILL.md` is now a 918-character router. The spec rules are in `references/spec-mode.md` and the freeform fallback in `references/freeform.md`, both moved verbatim.
  - A spec call carries the router plus `spec-mode.md`, about 4.1k characters instead of the whole 12k skill. A freeform call, including the fallback after two failed spec attempts, carries the router plus `freeform.md`.
  - Specs: agents.md §2.2, §6.4, §7.2 and §7.4; visuals R5 and the Feature "Skills the designer is given".
  - Tests: `frontend/e2e/designer-skills.spec.ts` (recording stub) and `visualization.service.spec.ts`.
  - Evidence: [evidence/1.13.5/](evidence/1.13.5/), including the epic's before and after evals.
- **Deep-analysis prompts live in a phased skill** (roadmap 1.13.4, [BA-202](https://halo-powered.atlassian.net/browse/BA-202)):
  - `skills/deep-analysis/` holds a phase map plus `phases/1-plan.md`, `2-investigate.md` and `3-report.md`.
  - The service loads one phase per call and fills its `{{placeholders}}`. A placeholder left unfilled fails the call.
  - Golden tests prove that the prompts sent to the model are byte-identical to before.
  - Specs: agents.md §2.7 and §7.4.
  - Evidence: [evidence/1.13.4/](evidence/1.13.4/).
- **Curated-knowledge rules reach the model only with the knowledge they govern** (roadmap 1.13.2, [BA-200](https://halo-powered.atlassian.net/browse/BA-200)):
  - The assistant's base prompt drops its "Curated knowledge:" section, going from 7,380 to 5,694 characters.
  - The section is now the `curated-knowledge` skill. `knowledgeContext()` sends it right after the knowledge block on every call that carries one: chat turn, grounding pass, deep analysis and evals.
  - Specs: agents.md §2.1, §4.1, Appendix A and the new Appendix B; knowledge R19; two scenarios in sessions-chat "Skills the assistant is given".
  - Evidence: [evidence/1.13.2/](evidence/1.13.2/).
- **Each agent gets only its own skills, from the app bundle, checked at startup** (roadmap 1.13.1, [BA-199](https://halo-powered.atlassian.net/browse/BA-199), epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198)):
  - Session workspaces no longer seed or discover skills. Before, every session got a copy of `interactive-visuals`, so the assistant's catalog listed the designer's skill and it was offered the `skill`, `skill_search` and `skill_read` tools. Now the assistant gets no catalog and none of those tools.
  - The designer reads `interactive-visuals/SKILL.md` from the bundle. Its description now starts with "Use when".
  - New `mastra/app-skills.ts` loads `skills/<name>/`. Each agent declares its on-demand skills in one table, which is empty for now. Every skill is validated when the backend starts: front matter, name equal to its folder, a "Use when" description and every linked `phases/` / `references/` file. A broken skill stops the backend with `Invalid app skills:`.
  - Workspace copies left by earlier versions stay on disk and are never read.
  - Specs: ADR-0018; agents.md §2.1, §2.2, §3.8 (the workspace tools the assistant is really offered, closing an open question), §7.1–§7.4; data-model §4.1 and §4.6; sessions-chat Feature "Skills the assistant is given"; the BA-198 epic spec and Milestone 1.13. The epic was re-scoped with the user: `visual-tailoring` and `sql-dialects` are cut, and 1.13.3 is merged into 1.13.2.
  - Tests: `frontend/e2e/assistant-skills.spec.ts`, `mastra/app-skills.spec.ts`, a designer skill test in `visualization.service.spec.ts`.
  - Evidence: [evidence/1.13.1/](evidence/1.13.1/).

### Cut
- **1.13.3 curated-knowledge and sql-dialects skills** ([BA-201](https://halo-powered.atlassian.net/browse/BA-201)): curated-knowledge was merged into 1.13.2. sql-dialects was dropped because the app has no dialect guidance to move. The on-demand `visual-tailoring` skill planned in 1.13.2 was also cut: its 427 characters of rules would have cost a catalog and usage note of about 1,045 characters on every turn. Both were decided with the user on 2026-10-13.

## 2026-10-12

### Added
- **Workflow pane: click a task to see its summary, agents and completion** (roadmap 1.11.3, [BA-174](https://halo-powered.atlassian.net/browse/BA-174), epic [BA-169](https://halo-powered.atlassian.net/browse/BA-169)); the `workflow-steps` mod is 0.3.0:
  - Every row of the queue (done, running, tentative and queued) shows its agent (`main`, `main +k`, `~main` expected for a queued step), tokens, cost, a completion bar with its %, and a one-line summary when the pane has room; the header adds `overall <p>%`, the mean of the rows.
  - Rows are `Button`s: a click, or Enter after `ctrl+x tab`, opens a detail under the row (the summary, the step's checklist with each check met or not, the agents with their own tokens, the cost and the confidence), and pressing again closes it; several rows can stay open. A queued step's detail shows what CLAUDE.md expects of it.
  - Completion is the share of the step's checklist met, from facts read off the task's calls (`roadmap.md` edited with `Acceptance` and a status for step 3, tests run and the last run passed for step 9, and so on); step 1's checks are the session's. A subagent's own `turn.complete` (its `agentId`) credits its tokens to it and to the task it was spawned under, and marks it finished. Cost stays at task level: no cost per agent, no price table.
  - A row is never wider than the pane: columns drop in a fixed order (duration and step first) and the summary only shows with 12 columns to spare, because a `Button` does not truncate its children. A live session in a 72-column sidebar found both this and the step-1 case before the tests did.
  - Specs: `delivery.md` §9 (rows, summary, completion table, details, figures, widths), the BA-169 epic spec (scope, stories, out of scope) and the mod README; Jira BA-174 created under BA-169 and the epic's out-of-scope line updated.
  - Evidence: [evidence/1.11.3/](evidence/1.11.3/).

## 2026-10-11

### Added
- **Local mode: sign in as a seeded persona, roles enforced** (roadmap 2.1.7, epic [BA-161](https://halo-powered.atlassian.net/browse/BA-161); Jira story key pending):
  - Local mode (the npx web app and the desktop app) no longer runs as one implicit user with every permission. At startup the backend seeds five directory users: Demo User (`local`, always Platform admin, keeps every item stored before this change), Uma User (User), Mark Maker (Maker), Dana Data Owner (Data owner of every datasource, also each new one) and Avery Approver (Approver). Each seeded role is applied once, so a role removed in Admin stays removed. Admin R69–R74.
  - The app opens on a sign-in page with a **Sign in as** dropdown; no password. `GET /auth/local/users`, `POST /auth/local/sign-in`, `POST /auth/local/sign-out` (api 91–93, 404 on an org server). The session token travels as `Authorization: Bearer`, so the same path works from the web app and the desktop's `file://` renderer; it ends at Sign out or after 30 days. `GET /me` answers 401 with `mode` when nobody is signed in, in both modes, and the frontend no longer falls back to a local user when the backend is unreachable.
  - Roles, permissions, owner scoping, activity events and the Admin area now apply in local mode exactly as on an org server; Admin copy that named Entra ID reads for local mode. Migration M13 stamps `ownerId: "local"` on ownerless private documents and moves the per-user settings keys to `…:local`. The Electron readiness probe is `GET /me` (200 or 401).
  - Specs: ADR-0012; admin R2, R10, R11, R18, R21, R33, R34, R36, R40, R54, R60 amended, R69–R74 added with the Feature "Sign in to local mode"; app-shell R4/R50; api.md 1.9, 2.13 (64, 91–93), 2.15, 4.3; data-model 3.2.2, 3.14, 3.15, M13; ui.md 1.3–1.6, 4.17.1, 4.18.6; glossary, vision, non-functional (local sign-in is not a security boundary), tech-stack, delivery, agents; owner-scoping rules in the other capability specs now say "in both modes".
  - Tests: `frontend/e2e/local-sign-in.spec.ts` (8 scenarios); the fixture signs every other web scenario in as Demo User (`autoSignIn`, `autoSignInAs`); `org-sign-in.spec.ts` gains "an org server never offers the local sign-in"; backend `local-auth.e2e-spec.ts` rewritten; unit tests for seeding, the guard, sessions, M13 and the sign-in page.
  - Evidence: [evidence/2.1.7/](evidence/2.1.7/).

### Added
- **Admin panel: Users & groups** (roadmap 2.1.4, [BA-165](https://halo-powered.atlassian.net/browse/BA-165), epic [BA-161](https://halo-powered.atlassian.net/browse/BA-161)): the Users · n / Groups · n views, search over name, email and group, the six role chips with counts, the users table (roles, IdP groups, agents owned, last active, status Active / Inactive / Not signed in / Deactivated), 25 rows a page, the "Last sync" note from the newest SCIM request, and the Assign role dialog. `GET /admin/users` and `GET /admin/groups` (api 83, 87). Admin R39, R49–R57. Tests: `frontend/e2e/org-admin-users.spec.ts` (8 scenarios), the completed "A bootstrap admin sees the Admin area", and `backend/test/org-admin.e2e-spec.ts`. Evidence: [evidence/2.1.4/](evidence/2.1.4/).
- **Admin panel: Edit a user** (roadmap 2.1.5, [BA-166](https://halo-powered.atlassian.net/browse/BA-166)): a detail panel with role checkboxes and their descriptions, Data owner per datasource, group-mapped and bootstrap roles locked with their reason, your own Platform admin locked, read-only groups, agents owned, **Transfer ownership** and an all-or-nothing **Save changes**. `GET /admin/users/:id`, `PUT /admin/users/:id/roles`, `POST /admin/agents/transfer` (api 84–86). Saving runs in a new document-store transaction (`DocStoreTransactions`, data-model 2.4). A transferred agent acts as deleted in its former owner's sessions; a name clash answers 409. Admin R58–R64. The users table narrows to at least 480 px while the panel is open, so both fit at 1440 px (the panel overflowed by 38 px at 560 px). Tests: `org-admin-edit-user.spec.ts` (9 scenarios, one now checking the panel fits). Evidence: [evidence/2.1.5/](evidence/2.1.5/).
- **Admin panel: Roles & permissions** (roadmap 2.1.6, [BA-167](https://halo-powered.atlassian.net/browse/BA-167)): the read-only matrix of five roles and eleven permissions, and the Entra ID group → role mappings with Add mapping and remove with confirmation. `GET` / `POST` / `DELETE /admin/role-mappings` (api 88–90); `mapping.added` / `mapping.removed` events. Admin R65–R68. Tests: `org-admin-roles.spec.ts` (6 scenarios). Evidence: [evidence/2.1.6/](evidence/2.1.6/).
- **Admin panel: Overview** (roadmap 2.1.3, [BA-164](https://halo-powered.atlassian.net/browse/BA-164)): tiles for active users (30 days) and agents live; Needs attention with Assign (transfer an ownerless agent), Inspect (read-only list of failed turns) and Clean up (remove direct Maker from users inactive 90+ days); the weekly active users chart (8 weeks); Recent activity; **Export report** as CSV, guarded against spreadsheet formula injection. A failed turn in a session started from an agent records `agent.turn-failed`. `GET /admin/overview` and its export (api 81, 82). Admin R35–R48. Tests: `org-admin-overview.spec.ts` (7 scenarios). Evidence: [evidence/2.1.3/](evidence/2.1.3/).

### Fixed
- **A Data owner role whose datasource was deleted no longer grants anything** ([BA-163](https://halo-powered.atlassian.net/browse/BA-163)), as data-model 3.13 already said. Edit a user shows it as "Data owner · datasource removed" so the admin can untick it. Admin R20, R59; api 64, 84. Evidence: [evidence/2.1.5/](evidence/2.1.5/).
- **Streamed and action POST routes answer 200 as specified** (chat stream, knowledge bootstrap, developer-settings test endpoint, testing-data load); they answered Nest's default 201. api.md 1.4 now lists every POST that answers 200. Test: `backend/test/response-status.e2e-spec.ts`. Evidence: [evidence/2.1.4/](evidence/2.1.4/).

## 2026-10-10

### Added
- **Org server mode: sign-in with Entra ID, directory sync, roles and enforcement** (roadmap 2.1.2, [BA-163](https://halo-powered.atlassian.net/browse/BA-163), epic [BA-161](https://halo-powered.atlassian.net/browse/BA-161)):
  - With the `ORG_*` configuration the backend runs as an org server: OIDC sign-in and sign-out with Entra ID (`/auth/login`, `/auth/callback`, `POST /auth/logout`), an opaque session cookie, an Origin check on writes, just-in-time users, and SCIM 2.0 Users and Groups under `/scim/v2` behind a bearer token. A partial configuration or a multi-tenant issuer stops startup.
  - Five roles and eleven permissions (admin R21) are resolved per request from direct assignments, group mappings and the bootstrap admins, and a global guard checks one requirement on every route; a startup self-check refuses to boot if a route has none. `GET /me` answers the signed-in user, or the local user with every permission in local mode. `POST` / `DELETE /admin/role-assignments`.
  - Sessions, agents, built-in agent pins, knowledge, verified queries, metrics, eval runs, UI preferences and in-memory jobs (previews, eval runs, deep analysis) are private to their owner through an owner-scoped document store; datasources, datasets and the LLM configuration are shared and managed by Platform admins.
  - Users are matched by token subject, then UPN, never by the `email` claim; a UPN now held by a different subject is refused, and SCIM gives a departed user's name to a new record (decided with the user, against the "nOAuth" account-takeover class).
  - Frontend: a sign-in page, the rail avatar with an account menu and **Sign out**, an **Admin** rail item for Platform admins opening the admin area's shell, a toast on 403, and controls hidden by permission. Local mode looks and behaves as before.
  - Specs: ADR-0010 and ADR-0011; the new [admin capability](specs/capabilities/admin/spec.md) R1–R36 with three Playwright Features and the API Feature; [api.md](specs/system/api.md) 1.9, 2.12–2.15 and 6; [data-model.md](specs/system/data-model.md) 3.14–3.15; [ui.md](specs/system/ui.md) 1.3, 1.6, 4.17, 4.18; owner-scoping rules in the affected capability specs; tech-stack, delivery, non-functional and the glossary.
  - Tests: Playwright `org` project (`npm run test:e2e:org`, 16 scenarios) with an in-test OIDC stub; backend API tests `org-auth`, `scim`, `owner-isolation`, `local-auth`; unit tests for the guard, matrix, owned store, sign-in, SCIM and config.
  - Evidence: [evidence/2.1.2/](evidence/2.1.2/).
- **Admin Panel epic: multi-user vision, ADR-0010 and epic spec** (roadmap 2.1.1, [BA-162](https://halo-powered.atlassian.net/browse/BA-162), epic [BA-161](https://halo-powered.atlassian.net/browse/BA-161)):
  - The vision drops "Not multi-user". The app now has two modes: local mode (default, unchanged, no sign-in) and org server mode, which an organisation self-hosts. There are new principles on server-enforced permissions, private-by-default data and Entra ID as the identity owner, and a Platform admin persona. [vision.md](specs/product/vision.md).
  - ADR-0010 (Accepted): one build for both modes; OIDC sign-in with Entra ID and a backend session cookie; SCIM 2.0 inbound; five roles enforced by a global permission guard; `ownerId` on private data; datasources, datasets and the LLM configuration org-wide; SQLite kept. [architecture.md](specs/system/architecture.md).
  - The epic spec [specs/epics/BA-161/spec.md](specs/epics/BA-161/spec.md) (confirmed) covers screens P1–P4 of the Figma board *Agent Hub — E2E lifecycle (proposed)*. Requests, Registry, Policies, Audit log, custom roles and desktop-as-client are out of scope.
  - A new Release 2 (Multi-user) with Milestone 2.1 and features 2.1.1–2.1.6 in [roadmap.md](roadmap.md), and the epic row in [specs/README.md](specs/README.md). Jira: epic BA-161 with stories BA-162 to BA-167.
  - Evidence: [evidence/2.1.1/](evidence/2.1.1/). Planning only: no code, UI or test change.
- **Inferred task queue in the workflow pane** (roadmap 1.11.2, [BA-171](https://halo-powered.atlassian.net/browse/BA-171), epic [BA-169](https://halo-powered.atlassian.net/browse/BA-169)). Developer tooling, no application change:
  - The **Workflow** pane of the `workflow-steps` mod (version 0.2.0) is now a task queue inferred from tool calls, with nothing asked of Claude and no prompt changed. Task `#1` (Understand the goal) runs from session start; each tool call is mapped to a step by file or command (`roadmap.md` → 3, `specs/system/architecture.md` → 4, `specs/**` → 5, `evidence/*/e2e-impact.md` → 6, Playwright and API E2E files → 7, `frontend/src`, `backend/src` and `.claude` → 8, test, build, lint and check-specs commands → 9, `changelog.md` and `evidence/**` → 10, `retrospective.md` → 11; any unmatched call before the first write → 1; `AskUserQuestion` → 2). Shell commands count too: a path named in a `Bash` command stands for the file, strongly when the command writes (a redirect, `tee`, `sed -i`, `cp`, `mv`, a heredoc), and paths inside a `.claude/worktrees/<name>/` checkout are matched past that prefix.
  - A step change opens a tentative task (`#n?`) that earns its number after three matched calls or one strong signal (a write, a question or a test command) and is dropped after three unmatched calls or a call for the running step. A step that runs again gets a new number. Done rows show step, agent, duration, tokens, cost, a confidence bar and the evidence (`Edit roadmap.md ×4`); the running row lists its subagents; step-9 tasks are marked `passed` or `failed`; the remaining steps are queued with the numbers they will get; steps without a signal are listed apart; done rows beyond the last twelve fold into one line. `/workflow reset` starts the queue over.
  - Tokens are each turn's input and output tokens, added to the running task; cost is the session cost delta between a task's start and end, as `/cost` counts it. Nothing is stored across sessions.
  - Specs: epic spec [specs/epics/BA-169](specs/epics/BA-169/spec.md) (new story, scope); [delivery.md](specs/system/delivery.md) §9 (the rule table, queue, rows, figures and commands); the mod README. No capability spec, Gherkin or Playwright impact (step 6: none).
  - Tests: `hooks/rules.ts` is a pure module with seven tests of its own; ten queue tests drive the hooks with the test kit (start, strong and weak signals, threshold and drop, repeats and pass/fail, usage and cost, subagents, the fold, reset, the fallback). Written first and red ([evidence/1.11.2/plugin-test-first-run.txt](evidence/1.11.2/plugin-test-first-run.txt)).
  - Evidence: [evidence/1.11.2/](evidence/1.11.2/): validation, the tests red then green, the spec checks, a type-check of the hooks against the engine declarations, and screen captures of a live session in which one read and one shell write moved the queue from `#1` to `#2 Update changelog with evidence`. Three live runs each found a call shape the tests had not (a shell search, a shell write, a worktree's absolute path); each became a rule and a test. Desktop app not run; the pane was seen in the terminal.
- **Claude Code workflow mod in the repository** (roadmap 1.11.1, [BA-170](https://halo-powered.atlassian.net/browse/BA-170), epic [BA-169](https://halo-powered.atlassian.net/browse/BA-169)). Developer tooling, no application change:
  - `.claude/mods/workflow-steps/`: a Claude Code mod that opens a **Workflow** pane beside the transcript listing the eleven-step workflow from [CLAUDE.md](CLAUDE.md) (number, title, first sentence) and its mandatory first action. It reads the file at session start and on `/workflow`, which also focuses the pane; without a readable `## Workflow` section it shows a built-in copy and says so. Static checklist, nothing stored. Four tests run with `claude plugin test`.
  - The repository is a plugin marketplace (`.claude-plugin/marketplace.json`, name `bi-assistant`) and the committed `.claude/settings.json` registers it from GitHub and enables `workflow-steps@bi-assistant`, so Claude Code offers the install to a developer who trusts the folder. Developers changing the mod load it with `claude --plugin-dir .claude/mods/workflow-steps`.
  - Specs: epic spec [specs/epics/BA-169](specs/epics/BA-169/spec.md); [delivery.md](specs/system/delivery.md) §9 (mods layout, marketplace, project settings, develop and verify recipes, the mod's behaviour); README *Development*. No capability spec, Gherkin or Playwright impact (step 6: none).
  - Evidence: [evidence/1.11.1/](evidence/1.11.1/): validation of the mod and the marketplace, the tests (first red run and green), the spec checks, a marketplace install from the branch's path, and screen captures of the pane in a live Claude Code session, at start and after `/workflow`. Desktop app not run; the pane was seen in the terminal.
- **Per-model reasoning effort in LLM Settings** (roadmap 1.10.1, [BA-160](https://halo-powered.atlassian.net/browse/BA-160), epic [BA-159](https://halo-powered.atlassian.net/browse/BA-159)):
  - Settings → LLM has a **Reasoning effort** select under the model. It lists only the levels the typed model accepts, for example `Minimal / Low / Medium / High` for `gpt-5`, and is hidden for models without reasoning (`gpt-4.1`). Unknown names get `Low / Medium / High`. Save stores the chosen effort with the connection.
  - Fixed along the way: reasoning models such as `gpt-5` failed **Test connection** (and therefore Save) with `LLM request timed out after 30s`. The probe now asks for the model's lowest level (`minimal` on `gpt-5`), so it answers within the limit; answers use the chosen effort.
  - Every model call maps its effort to the nearest level the model accepts, so fixed efforts such as the SQL fixer's `low` still work on models that only take `high`. Claude Haiku 5.5 now receives effort (it was dropped with the older Haiku models).
  - Backend: a built-in level table in `backend/src/mastra/effort-levels.ts`, checked against the OpenAI model pages and Anthropic's *Effort* page; `GET /llm/effort-levels`; `PUT /llm/settings` accepts `reasoningEffort`. No migration: stored `low` / `medium` / `high` values stay valid.
  - Specs: epic spec [specs/epics/BA-159](specs/epics/BA-159/spec.md); llm-settings R7, R16, R23 and new R36–R41 with three Gherkin scenarios; [agents.md](specs/system/agents.md) 1.4 (level table); [api.md](specs/system/api.md) 30–32a; [data-model.md](specs/system/data-model.md); [ui.md](specs/system/ui.md) 4.9; the glossary.
  - Tests: three new scenarios in `frontend/e2e/llm-settings.spec.ts`; the LLM stub records probes and `reasoning_effort`; new backend unit tests for the table, the mapping, the probe and save.
  - Evidence: [evidence/1.10.1/](evidence/1.10.1/).
- **Light theme and open navigation drawer by default, remembered in the database** (roadmap 1.10.2, [BA-168](https://halo-powered.atlassian.net/browse/BA-168), shipped in the BA-159 PR at the user's request):
  - A fresh install opens in the Light theme (even with a dark OS) and with the navigation drawer expanded. System, Light and Dark are still the Theme choices.
  - The Theme choice and the drawer's Expand / Collapse state are stored in the backend (`settings` document `ui-preferences`, `GET` / `PUT /ui-preferences`), so they survive another browser profile or port on the same data. A browser-storage copy still applies them before the first paint; the backend wins once loaded. A theme saved only in browser storage before this change moves to the backend once (M12). Opening the drawer by clicking Sessions isn't remembered.
  - ADR-0009 (supersedes ADR-0007's preference storage and default); app-shell R2, R39, R43, new R50 and the drawer and appearance scenarios; [api.md](specs/system/api.md) 2.12; [data-model.md](specs/system/data-model.md) 3.2.1 and M12.
  - Tests: 4 new and 5 updated E2E scenarios (navigation, appearance, and the axe scans now choose System before switching the OS theme); the web visual baseline regenerated for the expanded drawer; backend and frontend unit tests for the preferences.
  - Evidence: [evidence/1.10.2/](evidence/1.10.2/).

### Changed
- **The Reasoning effort select is always visible** (roadmap 1.10.1, [BA-160](https://halo-powered.atlassian.net/browse/BA-160)), at the user's request: hiding it for models without levels left users unaware it existed. It now shows disabled as `Default — enter a model first` or `Default — not available for this model`, with a hint linked as its accessible description saying why. It is labelled with its own `<label for>`, so its accessible name is exactly "Reasoning effort" (a wrapping label had added the option text, which also matched "Model"). Specs: llm-settings R37 and new R42, the Gherkin "Offers the effort levels of the chosen model", [ui.md](specs/system/ui.md) 4.9. Evidence: [evidence/1.10.1/](evidence/1.10.1/) (three new screenshots, E2E re-run 71 passed).
- **Worktree naming and cleanup rules** ([CLAUDE.md](CLAUDE.md) *Branching convention*, shipped with epic [BA-159](https://halo-powered.atlassian.net/browse/BA-159) at the user's request): a worktree folder must be named after its epic, `.claude/worktrees/<EPIC-ID>-<short-description>`, and an app-created worktree is moved to that name before the first commit; once the PR merges, deleting the worktree folder and branch (and the worktree's isolated resources) is mandatory, with the exact commands. This branch's own worktree keeps its app-given name (`bridge-cse_01DwV7bpMzhV2fENvvXtnvJo`), an exception the user chose. Evidence: documentation only, no app change.

## 2026-10-09

### Added
- **Agent editor with a preview chat** (roadmap 1.9.5, [BA-155](https://halo-powered.atlassian.net/browse/BA-155), epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)):
  - **New agent** on the hub and **Edit** on your own agents open a full-page editor: name, description, instructions, dataset checkboxes (a dataset that no longer exists stays listed as `<name> (missing)`), up to 5 starter questions, a model override and a reasoning effort.
  - **Save** keeps a draft; **Publish** saves and makes it Live. Editing a Live agent shows `Unpublished changes`, and its sessions keep the Live version until you publish. Leaving with unsaved changes asks `Discard unsaved changes?`.
  - **Preview** opens a chat in the Details panel that runs the saved draft. Sending saves the form first. **Reset preview** starts over. Leaving the editor discards the preview with its memory and workspace, and previews left by a crash are swept at the next start.
  - Backend: a preview is an in-memory session (`POST /sessions { agentId, preview: true }`, `DELETE /sessions/:id` → `Preview discarded`), never in the sessions collection (ADR-0008). It runs through the normal chat routes, so the chat component is reused.
  - Specs: agents-evals R1, R5 and R54–R61 and the Feature "Agent editor"; sessions-chat R54; app-shell R3 and R10; [api.md](specs/system/api.md) §2.1 and endpoint 3; [data-model.md](specs/system/data-model.md) §3.12; [agents.md](specs/system/agents.md) Block 5 and `agent-overrides`; [ui.md](specs/system/ui.md) §1.4, §4.4, §4.5 and the new §4.5.1; glossary.
  - Tests: new `frontend/e2e/agent-editor.spec.ts` (8 scenarios, including an axe scan in both themes); two hub scenarios updated; preview tests added to `backend/test/agent-sessions.e2e-spec.ts` (now 9, including the sweep after a restart); 2 backend and 21 frontend unit tests. Full web suite: 68 passed, 2 skipped (desktop only). Desktop not run.
  - Evidence: [evidence/1.9.5/](evidence/1.9.5/).
- **Start a session from an agent** (roadmap 1.9.3, [BA-153](https://halo-powered.atlassian.net/browse/BA-153), epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)):
  - **Start chat** sits on the Official card, on every Live user agent's card and in their detail views. On a Live agent it creates the session at once, named after the agent, over those of its datasets that still exist. On the Official agent it opens the new-session screen. It is disabled when none of the agent's datasets exist.
  - Every turn applies the agent's current Live version: its instructions as a labelled, user-supplied context block after every other block, and its model and reasoning-effort overrides, which apply to the assistant only. This covers chat turns, the grounding pass and deep analysis. A draft never applies. The read-only guard still rejects writes the instructions ask for.
  - The page header shows an **Agent** chip, the session row reads `<agent> · <datasets>`, and the welcome block offers the agent's description and starter questions. When the agent is deleted, its sessions keep their transcript, continue with the plain assistant and read `<name> · agent deleted`.
  - API and data: `POST /sessions` accepts `{ agentId }`; sessions gain optional `agentId` and `agentName` (no migration); every session the API returns carries a derived `agent`. The model resolver takes an optional model override, read by the assistant from the new `agent-overrides` requestContext key.
  - Specs: sessions-chat R52–R59 and the Feature "Sessions started from an agent"; agents-evals R1, R5 and R53; [api.md](specs/system/api.md) §2.1 and endpoint 3; [data-model.md](specs/system/data-model.md) §3.4 and §3.13; [agents.md](specs/system/agents.md) §1.2–1.4 and §4.1–4.2 (Block 5); [ui.md](specs/system/ui.md) §1.2, §1.3, §4.4, §4.5 and §4.12; app-shell R49; glossary.
  - Tests: new `frontend/e2e/agent-sessions.spec.ts` (6 scenarios, driven by a recording LLM stub, `e2e/helpers/llm-stub.ts`, which `llm-settings.spec.ts` now shares); the hub's detail-actions scenario updated; new backend API test `backend/test/agent-sessions.e2e-spec.ts` (7, including a restart), with the backend process harness moved to `test/backend-process.ts`; 10 backend and 17 frontend unit tests. Full web suite: 60 passed, 2 skipped (desktop only). Desktop not run.
  - Evidence: [evidence/1.9.3/](evidence/1.9.3/).
- **Agent Hub screen** (roadmap 1.9.4, [BA-154](https://halo-powered.atlassian.net/browse/BA-154), epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)):
  - The Agents screen is now the Agent Hub, following the mockup:
    - a full-width search over name and description;
    - the filter pills All, Pinned, Official and Mine;
    - card sections Official, Mine and System, three cards to a row with `Show more (<n>)`.
  - Cards show the name, description, owner (`You`, `Official` or `System`), the `Draft`/`Live` chip, `Unpublished changes` and `Missing dataset: <names>`.
  - Pins apply at once, put the card first in its own section, survive a restart, and revert with a toast if saving fails.
  - The detail view gains Publish and Delete (with confirmation) for user agents. **New agent** is shown but disabled until the editor (1.9.5). Start chat arrives with 1.9.3.
  - The old agent list component is removed.
  - Specs: agents-evals R1–R9 rewritten, plus the Feature "Agent Hub"; [ui.md](specs/system/ui.md) §4.4–4.5; glossary.
  - Tests: new `frontend/e2e/agent-hub.spec.ts` (9 scenarios, including an axe scan); `agents.spec.ts` updated for Show more; 12 unit tests for the section and filter logic. Full web suite: 44 passed, 2 skipped (desktop only). Desktop not run.
  - Evidence: [evidence/1.9.4/](evidence/1.9.4/).
- **Agent definitions: storage and API** (roadmap 1.9.2, [BA-152](https://halo-powered.atlassian.net/browse/BA-152), epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)):
  - New `agents` collection and `user-agents` backend module. A user agent keeps a draft and an optional Live version (name, description, instructions, datasets, starter questions, an optional model and reasoning effort) and a pin. Built-in pins live in a `builtin-agent-pins` settings document. No migration.
  - New endpoints: `POST /agents`, `PUT /agents/:id/draft`, `POST /agents/:id/publish`, `DELETE /agents/:id` and `PUT /agents/:key/pin`. `GET /agents` lists built-in and user agents together, with kind, status, owner, pin, unpublished changes and missing datasets. `GET /agents/:key` also resolves user-agent ids. Built-in agents can't be edited or deleted.
  - Specs: rules R43–R52 and the Feature "Agent definitions (API)" in [specs/capabilities/agents-evals/spec.md](specs/capabilities/agents-evals/spec.md); [api.md](specs/system/api.md) endpoints 41–45 (later ones renumbered 46–57); [data-model.md](specs/system/data-model.md) §3.2 and §3.10; glossary terms for user, official and system agents, draft, Live and pin.
  - Tests: backend e2e `backend/test/user-agents.e2e-spec.ts` (9 tests, including a real backend restart on the same data dir) and 23 new unit tests. The Agents screen is unchanged; `agents.spec.ts` still passes 9/9.
  - Test harness: `E2E_BACKEND_PORT` lets the Playwright suite run beside a desktop app that holds port 3000 ([tech-stack.md](specs/system/tech-stack.md)).
  - Evidence: [evidence/1.9.2/](evidence/1.9.2/).
- **Agent Hub planned** (roadmap 1.9.1, [BA-151](https://halo-powered.atlassian.net/browse/BA-151), epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)):
  - New epic spec [specs/epics/BA-150/spec.md](specs/epics/BA-150/spec.md), confirmed by the user. Users build agents on top of the assistant (instructions, datasets, starter questions, model override), test them as drafts, publish them, pin them and start chats from them. The Agents screen becomes a hub with the filters All, Pinned, Official and Mine, plus a System section for the helper agents.
  - ADR-0008 in [specs/system/architecture.md](specs/system/architecture.md): a user agent is a stored configuration (a draft and a Live version) applied to the assistant on each turn, not an agent registered at runtime. So the read-only guard and the grounding checks always hold.
  - Milestone 1.9 in [roadmap.md](roadmap.md), with one feature per story (1.9.1–1.9.5), and the epic row in [specs/README.md](specs/README.md).
  - Decisions: teams, the org and sharing are out (the app stays local-first); the epic is inside the 1.0 Beta; the hub UI is built with today's styles and restyled later by BA-141.
  - Evidence: [evidence/1.9.1/](evidence/1.9.1/).
- **Aligned with the Insight Agent AI Figma design** (roadmap 1.8.8, [BA-158](https://halo-powered.atlassian.net/browse/BA-158), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - Light tokens now come from the Figma variables (brand `#0B41AD`, text `rgba(0,0,0,.85)`, headings `#001F52`, radius 12, Figma shadows), and the navy dark set is re-derived from them.
  - Shell: the Figma's teal gradient frame with its texture, a 64 px translucent rail (menu, logo, workspace items, avatar, system logs, Settings, divider, LenAI mark and "Powered by LenAI"), and a 136 px banner with the Figma image, still reading "Agentic Hub".
  - The menu button expands the rail into a 240 px drawer with labels and the session list. This replaces the 1.8.5 session pane; choosing Sessions opens it.
  - The Sessions area has a page header: an icon, a 24 px light title, the datasource context and "Start New Conversation".
  - The details panel is closed on launch and opens on demand: a dataset element, an eval question, a visual, or "Expand right panel".
  - Chat restyled to the Figma: the user bubble with an avatar, answers with the sparks mark at 16/24 px, Figma tables, "Data used" styled as the Data Sources row, feedback icons always visible, the bordered prompt, and the AI disclaimer.
  - Buttons are 40 px tall at 14 px. Screen titles are 24 px light.
  - The 19 Figma assets are in `frontend/public/brand/agentic-hub/`, with the photos re-encoded as WebP (8.4 MB → 0.5 MB).
  - Specs: app-shell R1–R4, R10, R37 and R46–R49 with new Navigation rail scenarios; agents-evals R37 and its scenario; [ui.md](specs/system/ui.md) §1, §3, §4.12, §6, §7 and §9; sessions-chat UI; api.md `window:theme`; tech-stack.md.
  - Evidence (with a side-by-side against the Figma): [evidence/1.8.8/](evidence/1.8.8/).
- **Chat, visual panel, system logs and toasts in both themes** (roadmap 1.8.7, [BA-148](https://halo-powered.atlassian.net/browse/BA-148), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - The session chat (including its `.prose-dark` Markdown styles and tooltips), the interactive visual panel frame, the system logs dialog, toasts and the backend banner now use theme tokens and the shared classes.
  - Toasts sit in a "Notifications" region (`aria-live="polite"`) with a "Dismiss notification" button (app-shell R30).
  - `SessionChat` unit tests assert token classes.
  - ui.md is synced to tokens throughout: §2 conventions, §3 shared components, §4 screens, §6.1 colour usage (the legacy dark palette section is retired) and §8.
  - Evidence: [evidence/1.8.7/](evidence/1.8.7/).
- **Feature screens in both themes** (roadmap 1.8.6, [BA-147](https://halo-powered.atlassian.net/browse/BA-147), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - These screens now use only theme tokens and the shared `btn`, `chip`, `card`, `field`, `menu` and `list-row` classes: datasets, the catalog browser, metrics, entity details, agents (list, detail, eval trace), knowledge, and the datasource, LLM, testing-data and developer settings. The dataset editor header now wraps.
  - New E2E scenario: axe finds no violations on any screen in Light or Dark.
  - Fixed along the way: names for the Datasets and Agents search, layout and row-options buttons.
  - Evidence: [evidence/1.8.6/](evidence/1.8.6/).
- **Collapsible Sessions list pane** (roadmap 1.8.5, [BA-146](https://halo-powered.atlassian.net/browse/BA-146), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - The pane has "Collapse session list" / "Expand session list" (not remembered between launches).
  - Rows show the session's datasets under its name, and the empty list reads "No sessions yet."
  - The new-session composer uses tokens and shared classes.
  - Specs: app-shell R46, R47 and R37, plus the Navigation rail scenario "Collapses and expands the session list".
  - Evidence: [evidence/1.8.5/](evidence/1.8.5/).
- **Agentic Hub shell: gradient frame, banner and navigation rail** (roadmap 1.8.3, [BA-144](https://halo-powered.atlassian.net/browse/BA-144), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - The 296 px sidebar is replaced by a gradient frame. The always-visible icon rail holds Datasets, Agents, Knowledge and Sessions at the top, and the avatar, system logs and Settings at the bottom. Beside it, a canvas card holds the 72 px "Agentic Hub" banner (the page's only `h1`) over the page card (`main`) and the details panel card. The collapse and expand sidebar controls are gone.
  - **Sessions** is now a rail area, with a list pane beside the composer or chat.
  - **Settings** is now a rail area, with a section list beside the chosen form. "Back" is gone, and leaving and returning keeps the chosen section.
  - The window and document titles read "Agentic Hub". The OS app name, installers and data directory stay "Halo BI Assistant".
  - Theme switches suppress transitions for one frame, so every surface changes at once. Screen titles are now `h2`.
  - Specs: app-shell R1–R7, R32, R33, R36, R37 and R46, the new Feature "Navigation rail" (`frontend/e2e/navigation.spec.ts`), [ui.md](specs/system/ui.md) §1, §3.4, §7, §8, §9 and §10, and the sidebar references in the datasets, knowledge, metrics, diagnostics, sessions-chat, llm-settings, developer-settings and datasources specs, plus vision.md and non-functional N59/N60.
  - The web visual baseline is regenerated. Merged `main` (BA-156, E2E on the web target) and moved the Appearance spec to `app.fixture`.
  - Evidence: [evidence/1.8.3/](evidence/1.8.3/).
- **Shared component classes** (roadmap 1.8.4, [BA-145](https://halo-powered.atlassian.net/browse/BA-145), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - Tailwind v4 `@utility` classes in [frontend/src/styles/components.css](frontend/src/styles/components.css), built from the theme tokens only: pill buttons (`btn` with primary, secondary, outline, ghost and danger variants, plus `btn-icon`), status chips (`chip-warning|info|neutral|success|danger`), `card`, `card-muted`, `list-row`, `filter-pill`, `field`, `field-label`, `section-header`/`section-title` and `menu`/`menu-item`.
  - Documented in [ui.md](specs/system/ui.md) §3.6. The Appearance section now uses `card` and `field-label`.
  - Evidence: [evidence/1.8.4/](evidence/1.8.4/).
- **Light and dark themes with an Appearance setting** (roadmap 1.8.2, [BA-143](https://halo-powered.atlassian.net/browse/BA-143), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - Settings → **Appearance** (fifth section) offers System, Light and Dark. System is the default and follows the OS live. The choice applies at once and is kept in `localStorage` under `questions-to-insights:theme`.
  - Semantic theme tokens with a light set and an approved navy dark set, in [frontend/src/styles/tokens.css](frontend/src/styles/tokens.css), mapped into Tailwind v4 with `@theme inline` (ADR-0007). Every text pair meets WCAG AA in both themes.
  - An inline boot script in `index.html` applies the theme before the app renders. `ThemeService` keeps it in sync. The desktop window background follows the theme through the new `desktop.setWindowTheme` / `window:theme` IPC.
  - Noto Sans (`@fontsource/noto-sans` 5.3.0) is bundled and is now the app's font.
  - Only the page background and the Appearance section use the tokens so far. The other screens move over in 1.8.3–1.8.7.
  - Specs: app-shell R39–R45 and Feature "Appearance" (`frontend/e2e/appearance.spec.ts`, new), [ui.md](specs/system/ui.md) §4.16, §6.0 and §6.5, and updates to [data-model.md](specs/system/data-model.md), [api.md](specs/system/api.md), [tech-stack.md](specs/system/tech-stack.md) and [non-functional.md](specs/product/non-functional.md) N64.
  - The E2E helper `createWorldCupDatasource` honours `WORLD_CUP_DB_PORT`, so a worktree can run the suite against its own compose stack.
  - Evidence: [evidence/1.8.2/](evidence/1.8.2/).
- **Agentic Hub look and feel planned** (roadmap 1.8.1, [BA-142](https://halo-powered.atlassian.net/browse/BA-142), epic [BA-141](https://halo-powered.atlassian.net/browse/BA-141)):
  - New epic spec [specs/epics/BA-141/spec.md](specs/epics/BA-141/spec.md), confirmed by the user. It plans a light theme and a navy dark theme (System by default), a gradient frame, an "Agentic Hub" banner, an icon rail, a sessions list pane and pill and chip components. Only the look changes.
  - ADR-0007 in [specs/system/architecture.md](specs/system/architecture.md): semantic design tokens mapped into Tailwind v4, a System / Light / Dark preference applied before first paint, and a bundled webfont.
  - Milestone 1.8 in [roadmap.md](roadmap.md), with one feature per story (1.8.1–1.8.7), and the epic row in [specs/README.md](specs/README.md).
  - Decisions: `productName`, the installers and the data directory stay "Halo BI Assistant"; only the window title, document title and settings footer become "Agentic Hub". The mockup's "Powered by LenAI" footer is left out.
  - Evidence: [evidence/1.8.1/](evidence/1.8.1/).

### Fixed
- **Reopening a session showed its transcript as it was before that visit's turns** (found while building roadmap 1.9.3, [BA-153](https://halo-powered.atlassian.net/browse/BA-153)): the session list kept the copy loaded before the first turn. A finished turn now refreshes the shell's copies (`SessionChat` emits `sessionUpdated`; same id, so an in-flight stream is never disturbed). Covered by `agent-sessions.spec.ts` "deleting the agent keeps its sessions on the plain assistant". Evidence: [evidence/1.9.3/](evidence/1.9.3/).
- **Agent Hub's active filter pill readable in dark** (roadmap 1.9.4, [BA-154](https://halo-powered.atlassian.net/browse/BA-154), epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)):
  - Merging `main` (v0.25.0, BA-141) moved the hub onto the theme tokens. The shared `filter-pill-active` kept `primary` text, which is 4.34:1 on the selected fill in dark, so the axe scan failed. It now uses `on-primary-soft` in both themes (`components.css`, [ui.md](specs/system/ui.md) §3).
  - Full web suite after the merge: 54 passed, 2 skipped (desktop only). Desktop not run.
  - Evidence: [evidence/1.9.4/](evidence/1.9.4/) (`merge-main-*`).
- **Shared component classes could lose to Tailwind's base reset** (roadmap 1.8.4, [BA-145](https://halo-powered.atlassian.net/browse/BA-145)):
  - The classes in `frontend/src/styles/components.css` moved from `@utility` to `@layer components` and now reference the raw `--qti-*` tokens, so utilities on the same element override them without `!`.
  - `index.html` declares `@layer theme, base, components, utilities;` before anything else. Otherwise Angular's inlined critical CSS can name `components` first, and Tailwind's button reset then wins.
  - Evidence: the screenshots in [evidence/1.8.6/](evidence/1.8.6/).

### Changed
- **The E2E suite can run against any World Cup database** (with roadmap 1.9.5, [BA-155](https://halo-powered.atlassian.net/browse/BA-155)): `E2E_WORLD_CUP_DB_*`, loaded from a git-ignored `.env.e2e.local`, point the suite at a database such as a per-worktree one from the infra MCP service, and global setup then leaves Docker alone. The helpers derive catalog test ids and entity keys from the database name, and the read-only guard scenario counts rows over SQL instead of `docker exec`. Defaults are unchanged (the compose database). See [tech-stack.md](specs/system/tech-stack.md). Evidence: [evidence/1.9.5/](evidence/1.9.5/) (the whole run used such a database).
- **Agent Hub branch synced with `main`** (epic [BA-150](https://halo-powered.atlassian.net/browse/BA-150)): merged BA-156's web E2E harness into `feat/BA-150-agent-hub`. The `E2E_BACKEND_PORT` option added under 1.9.2 is removed, because the web target already gives each test its own free port and data dir. 1.9.2's checks were re-run on the web target; see [evidence/1.9.2/](evidence/1.9.2/).
- **Local test deploys check the default ports first** (roadmap 0.2.7, [BA-157](https://halo-powered.atlassian.net/browse/BA-157), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)):
  - CLAUDE.md *Worktree deploy convention* gains a rule. Before starting the app for the user, check the default ports (3000, 55432, 6006, 3001, 4317, 4318) and reuse the shared World Cup Postgres. Work around any other busy port with flags or environment variables only. Keep tracked-file tweaks made only to run locally out of every commit. Stop processes by PID, never with `pkill -f`.
  - Evidence: [evidence/0.2.7/](evidence/0.2.7/).
- **E2E and testing run against the web app; the desktop app only on request** (roadmap 0.2.6, [BA-156](https://halo-powered.atlassian.net/browse/BA-156), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)):
  - CLAUDE.md *Test target convention*: during epic development, E2E, evidence screenshots and manual checks use the web app built from the epic branch. Desktop runs only when the user asks; otherwise the evidence and PR list desktop as not run. Workflow step 9, the Evidence and E2E conventions point at it.
  - Playwright now has two projects sharing [`e2e/fixtures/app.fixture.ts`](frontend/e2e/fixtures/app.fixture.ts), which replaces `electron.fixture.ts`. `web` (the default, `npm run test:e2e`) starts the npm CLI per test on a free port and a temp data dir and drives it in Chromium at 1440×900. `desktop` (`npm run test:e2e:desktop`) launches Electron as before. The port-3000 check moved into the desktop launch, so web runs never need that port.
  - Desktop-only tests are skipped on web with "Desktop only: …": the diagnostics redaction and export test, and the "Restart backend" test. New browser scenarios cover the "Restart the CLI to apply" notice and a CLI restart. The observability export and LLM-settings relaunch tests restart or relaunch according to the target.
  - New web visual baseline `application-shell-web-linux.png`.
  - Specs: Gherkin in [developer-settings](specs/capabilities/developer-settings/spec.md) and [diagnostics](specs/capabilities/diagnostics/spec.md) (`@desktop-only` tags), plus [delivery.md](specs/system/delivery.md), [tech-stack.md](specs/system/tech-stack.md), [ui.md](specs/system/ui.md) and the READMEs.
  - Web suite: 35 passed, 2 skipped (desktop only). Desktop not run. Evidence: [evidence/0.2.6/](evidence/0.2.6/).
- **One branch, one worktree and one PR per epic** (roadmap 0.2.5, [BA-149](https://halo-powered.atlassian.net/browse/BA-149), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)):
  - CLAUDE.md *Branching convention*: all of an epic's stories are built on one branch, `<type>/<EPIC-ID>-<short-description>`, in one worktree, and ship as one PR that lists every story. Commits stay scoped to their story. The branch type is the highest-impact commit type in the epic.
  - Bugs: a Bug whose epic has an open branch is fixed there. A Bug against shipped work keeps its own `fix/<BUG-ID>` branch and PR.
  - Workflow step 3 and the Epic gate now point at the epic branch. [specs/system/delivery.md](specs/system/delivery.md) explains the version bump for a mixed-type epic PR. Story added to [specs/epics/BA-89/spec.md](specs/epics/BA-89/spec.md).
  - Evidence: [evidence/0.2.5/](evidence/0.2.5/).

## 2026-10-05

### Added
- **Developer guide for local observability** (roadmap 0.3.7, [BA-118](https://halo-powered.atlassian.net/browse/BA-118), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - [docs/observability.md](docs/observability.md) covers starting Phoenix and Grafana, turning on **Settings → Developer → Developer observability** and restarting, and where to find each signal: Phoenix projects, Tempo search and TraceQL, Loki with its "Trace: <id>" link, and Prometheus. It also covers turning it off and troubleshooting (ingest lag, unreachable endpoints, worktree isolation).
  - Linked from README *Development*.
  - Verified by following it with the npm CLI against the real tools.
  - Evidence: [evidence/0.3.7/](evidence/0.3.7/).
- **Developer observability now exports backend logs, linked to their traces** (roadmap 0.3.6, [BA-117](https://halo-powered.atlassian.net/browse/BA-117), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - When the active developer setting is on, the OpenTelemetry SDK also exports logs to `<OTLP endpoint>/v1/logs`.
  - Nest logs: [`developer-nest-logger.ts`](backend/src/infrastructure/telemetry/developer-nest-logger.ts) wraps `ConsoleLogger.prototype.printMessages`. Each line prints exactly as before and is also emitted as a log record.
  - Mastra's Pino logs: sent through `@opentelemetry/instrumentation-pino`, with stdout field injection disabled.
  - A line logged during a request or agent run carries that trace's id. Verified in real Grafana: a Loki line resolves to its Tempo trace.
  - Console output is byte-identical whether the setting is on or off, so the desktop system-logs panel is unaffected.
  - **Scope change:** `nestjs-pino` was dropped from the plan, because it would have turned the console output into JSON even with the setting off.
  - Specs: R24–R26 and a logs scenario in [specs/capabilities/developer-settings/spec.md](specs/capabilities/developer-settings/spec.md), plus tech-stack.md and the container diagram.
  - Evidence: [evidence/0.3.6/](evidence/0.3.6/).
- **Developer observability now sends agent traces to Arize Phoenix** (roadmap 0.3.5, [BA-116](https://halo-powered.atlassian.net/browse/BA-116), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - When the active developer setting is on, [`backend/src/mastra/developer-exporters.ts`](backend/src/mastra/developer-exporters.ts) adds `@mastra/arize`'s `ArizeExporter` next to `MastraStorageExporter`. It sends OpenInference spans in OTLP protobuf to `<Phoenix endpoint>/v1/traces`, under the project `questions-to-insights`.
  - `observability.duckdb` keeps receiving every trace. When the setting is off, the exporter is never `require`d, so no OpenTelemetry module loads.
  - Specs: R21–R23 and a Phoenix scenario in [specs/capabilities/developer-settings/spec.md](specs/capabilities/developer-settings/spec.md), agents.md §1.7, tech-stack.md (`@mastra/arize` 1.3.16, pinned to match `@mastra/observability` 1.17.8), and the container diagram.
  - Verified against real Phoenix: the `questions-to-insights` project shows the assistant's `invoke_agent` → model and memory spans.
  - Evidence: [evidence/0.3.5/](evidence/0.3.5/).
- **Developer observability now exports backend traces and metrics to an OTLP endpoint** (roadmap 0.3.4, [BA-115](https://halo-powered.atlassian.net/browse/BA-115), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - When the active developer setting is on, `main.ts` and `cli.ts` start the OpenTelemetry Node SDK **before** they import the app. It instruments HTTP, Express, NestJS, `pg` and undici, with fs, dns and net disabled. Traces go to `<OTLP endpoint>/v1/traces` and metrics every 10 s to `/v1/metrics`, both in OTLP protobuf, as `questions-to-insights`.
  - When the setting is off, nothing from OpenTelemetry is imported and nothing is sent. A failure to start logs one warning, and the backend runs without telemetry.
  - Code: [`backend/src/infrastructure/telemetry/developer-telemetry.ts`](backend/src/infrastructure/telemetry/developer-telemetry.ts). New pinned dependencies: `@opentelemetry/*` 0.222.0 / 2.11.0, `auto-instrumentations-node` 0.80.0.
  - Specs: R17–R20 and the Feature "Developer observability export" (`frontend/e2e/developer-observability.spec.ts`) in [specs/capabilities/developer-settings/spec.md](specs/capabilities/developer-settings/spec.md). The packages are listed in tech-stack.md, and the container diagram shows the developer-only OTLP edge.
  - Verified against real Grafana: Tempo shows http → NestJS → `pg.query` spans.
  - Evidence: [evidence/0.3.4/](evidence/0.3.4/).
- **Settings → Developer: a developer observability switch with restart to apply** (roadmap 0.3.2, [BA-113](https://halo-powered.atlassian.net/browse/BA-113), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - **Settings:** a fourth row, "Developer", holds the "Developer observability" switch (off by default) and editable Phoenix (`http://localhost:6006`) and OTLP (`http://localhost:4318`) endpoints. The form and the backend both reject a value that isn't an http(s) URL.
  - **Test:** probes the typed endpoint from the backend with an empty OTLP protobuf export to `/v1/traces`. It reports "Reachable", a wrong status, or "Unreachable".
  - **Storage:** the setting is saved to `<APP_DATA_DIR>/developer-settings.json` (atomic write), not the document store, so entry points can read it before bootstrap (ADR-0006).
  - **Applying it:** the backend keeps the copy it read at startup as the active setting. A "Restart to apply" notice appears while the saved setting differs from it. In the desktop app, **Restart backend** respawns the backend through a new `backend:restart` IPC channel, outside the crash-restart budget. The browser (npm CLI) shows "Restart the CLI to apply" instead.
  - **Scope:** nothing is exported yet. The exporters arrive in 0.3.4–0.3.6.
  - **API:** new `GET`/`PUT /developer-settings` and `POST /developer-settings/test-endpoint`.
  - **Specs:** the new [developer-settings](specs/capabilities/developer-settings/spec.md) capability (Gherkin + `frontend/e2e/developer-settings.spec.ts`), plus api.md, data-model.md, ui.md §4.12, app-shell R5, the glossary and tech-stack.md.
  - Evidence: [evidence/0.3.2/](evidence/0.3.2/).
- **Opt-in `observability` Docker Compose profile** (roadmap 0.3.3, [BA-114](https://halo-powered.atlassian.net/browse/BA-114), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - `docker-compose.yml` gains `phoenix` (`arizephoenix/phoenix:version-20.19.0`, port 6006) and `otel-lgtm` (`grafana/otel-lgtm:0.35.0`; Grafana on 3001, OTLP gRPC 4317, OTLP HTTP 4318), each behind `profiles: [observability]`. Host ports are overridable. A plain `docker compose up` and the E2E global setup still start only Postgres.
  - Verified against the real images: Phoenix UI 200, Grafana health ok, OTLP HTTP `/v1/traces` 200 on both. Phoenix accepts OTLP protobuf only (JSON gets 415), which 0.3.5 must account for.
  - Documented in [specs/system/delivery.md](specs/system/delivery.md) (section 6 and the isolation table in section 7) and in the CLAUDE.md *Worktree deploy convention*.
  - Evidence: [evidence/0.3.3/](evidence/0.3.3/).
- **Local development observability is planned** (roadmap 0.3.1, [BA-112](https://halo-powered.atlassian.net/browse/BA-112), epic [BA-111](https://halo-powered.atlassian.net/browse/BA-111)):
  - New Jira epic BA-111 with stories BA-112 to BA-118, mirrored as roadmap Milestone 0.3 (features 0.3.1–0.3.7).
  - **ADR-0006** in [specs/system/architecture.md](specs/system/architecture.md):
    - Arize Phoenix and Grafana `otel-lgtm` are used only when a Developer setting is on. It is off by default.
    - The setting is stored as a file under `APP_DATA_DIR`, so the entry points can read it before the app loads.
    - Exporters are added next to the DuckDB store, not instead of it.
    - Changes apply on restart.
  - The epic spec [specs/epics/BA-111/spec.md](specs/epics/BA-111/spec.md) is confirmed by the user and listed in [specs/README.md](specs/README.md).
  - No product code changed.
  - Evidence: [evidence/0.3.1/](evidence/0.3.1/).
- **PRs into `main` need an approving review; only the repo owner can merge without one** (roadmap 0.2.4, [BA-110](https://halo-powered.atlassian.net/browse/BA-110), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)):
  - A second ruleset, "main: PR approval, admin may merge without", requires a PR with 1 approving review and dismisses stale approvals. The *Repository admin* role bypasses it in *pull requests only* mode, so the owner can merge without approval but can't push directly to `main`. The spec-check ruleset is unchanged and still applies to everyone.
  - [`version-on-merge.yml`](.github/workflows/version-on-merge.yml) now pushes its release commit and tag over SSH with a repo-scoped write deploy key (`RELEASE_DEPLOY_KEY` secret). Deploy keys are on the new ruleset's bypass list, because GitHub Actions can't be in a personal-account repo.
  - Documented under *Branch rulesets on `main`* and *Release push* in [specs/system/delivery.md](specs/system/delivery.md), in the BA-89 epic spec, and as a **Review** bullet in the CLAUDE.md *Branching convention*.
  - Evidence: [evidence/0.2.4/](evidence/0.2.4/).

### Fixed
- **LLM API key no longer lost or broken when the app secret changes** (roadmap 1.7.9, [BA-106](https://halo-powered.atlassian.net/browse/BA-106), epic [BA-11](https://halo-powered.atlassian.net/browse/BA-11)):
  - Found from a desktop diagnostics report: the first launch of a data dir after Electron started persisting `.app-secret` (commit `a3ef363`) could not read a key saved under the backend's fixed development secret. `GET /llm/settings` failed with `Unsupported state or unable to authenticate data` (a 500), and so did every agent turn.
  - [`crypto.service.ts`](backend/src/infrastructure/crypto/crypto.service.ts): a backend started without `APP_SECRET` now reads or creates `<APP_DATA_DIR>/.app-secret` (mode 0600), like Electron main and the CLI. The fixed development secret is never used to encrypt again. `decrypt` throws `UnreadableSecretError`, and `reencryptFormerSecret` re-encrypts a value only the former development secret opens.
  - [`llm.service.ts`](backend/src/modules/llm/llm.service.ts): at startup a key under the former development secret is re-encrypted with the current one (migration M11). A key no known secret opens is reported as `configured: false`, `keyUnreadable: true` with provider, model and base URL kept. Agent calls, and tests or saves without a typed key, fail with a "re-enter the key" message instead of the crypto error.
  - LLM Configuration screen: an amber notice asks for the key again and the other fields stay filled. It clears after a successful save.
  - `.app-secret` added to `.gitignore`, because a bare backend run now writes one into `backend/data/`.
  - Specs: R11 rewritten and R33–R35 plus two scenarios in [specs/capabilities/llm-settings/spec.md](specs/capabilities/llm-settings/spec.md) (its Feature now has an E2E file); api.md (`keyUnreadable`, no more 500), data-model.md (2.3, app-secret owner, M11), non-functional.md (N15, N16a; open question resolved), delivery.md and ui.md.
  - Tests: new `frontend/e2e/llm-settings.spec.ts` (4 scenarios against a local LenAI stub), `crypto.service.spec.ts`, and new cases in `llm.service.spec.ts`. The E2E fixture gained `launchElectronApp` / `readyWindow` so a spec can relaunch the app on the same data dir.
  - Evidence: [evidence/1.7.9/](evidence/1.7.9/).
- **Merging no longer starts an installer build** (roadmap 0.2.4, [BA-110](https://halo-powered.atlassian.net/browse/BA-110)). The first release after the rollout (v0.20.7) pushed its tag with the deploy key, and `build-desktop.yml` runs on any pushed `v*` tag, so an installer build started on its own. It was cancelled before publishing a release. [`version-on-merge.yml`](.github/workflows/version-on-merge.yml) now pushes the tag with `GITHUB_TOKEN`, whose pushes start no workflows. Only the branch pushes use the deploy key. The *Chaining* row in [specs/system/delivery.md](specs/system/delivery.md) is corrected. Evidence: [evidence/0.2.4/release-run.txt](evidence/0.2.4/release-run.txt).

## 2026-10-04

### Changed
- Roadmap 0.1.1 (the renderer ignoring a non-default `BACKEND_PORT`) is now **1.7.20** under Bug Fixes. It is tracked as Jira bug [BA-109](https://halo-powered.atlassian.net/browse/BA-109) under epic BA-11, because Milestone 0.1 has no epic and the Epic gate would block it. 0.1.1 is marked `🚫 Cut` with a pointer to the new entry. References in CLAUDE.md, the BA-11 epic spec and the specs (`non-functional.md`, `delivery.md`, `api.md`) are updated. Evidence: docs only; `python3 scripts/check-specs.py` passes and the spec check is green on the PR.

### Added
- **The spec check is now required on `main`** (roadmap 0.2.3, [BA-108](https://halo-powered.atlassian.net/browse/BA-108)):
  - A repository ruleset requires "Specs match the code" before a PR can merge. Direct pushes without that status are rejected.
  - [`version-on-merge.yml`](.github/workflows/version-on-merge.yml) still pushes its release commit straight to `main`. Before pushing, it runs `scripts/check-specs.py` on the bump commit, stages the commit on `release-staging/<sha>` and reports the status itself.
  - Documented under *Branch ruleset on `main`* in [specs/system/delivery.md](specs/system/delivery.md).
  - Evidence: [evidence/0.2.3/](evidence/0.2.3/).
- **Rebuildable system specs** (roadmap 0.2.2, [BA-90](https://halo-powered.atlassian.net/browse/BA-90), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)). New [specs/](specs/README.md) tree, written so an LLM given only that folder can rebuild the app:
  - product specs: vision, glossary, non-functional requirements;
  - system specs: architecture, tech stack, data model, API (all 52 routes, the chat stream, IPC, CLI), agents (every prompt, tool and model rule), UI and delivery;
  - 13 capability specs, each with rules, edge cases, contracts and Gherkin;
  - epic specs for all BA epics. The existing ones are `Status: Draft` until their owners confirm them.

  [specs/README.md](specs/README.md) defines the formats, the stack-neutrality rule, the lifecycle, the files a rebuild copies verbatim, and the rebuild prompt. Evidence: [evidence/0.2.2/](evidence/0.2.2/).
- CLAUDE.md **Epic gate**: no code change without a Jira epic. Every epic gets a spec at `specs/epics/<EPIC-ID>/spec.md`, confirmed before its stories start.
- CLAUDE.md **Spec convention**: specs change on the same branch as the code, so `main` always describes the shipped app.
- **Spec checks in CI:** [`.github/workflows/spec-checks.yml`](.github/workflows/spec-checks.yml) runs [`scripts/check-specs.py`](scripts/check-specs.py) on every PR and every push to `main`. It fails when a backend route, collection, agent, Playwright spec, capability or roadmap epic has no spec, or a link breaks. It is the repo's first pull-request check. A drift test with 7 faults injected failed all 7 matching checks: [evidence/0.2.2/check-specs-negative-test.txt](evidence/0.2.2/check-specs-negative-test.txt).
- Roadmap Milestone 0.2 now mirrors the new Jira epic BA-89 (Delivery Process). BA-84 is linked to it in Jira.
- The user waived confirmation, as a one-time exception, for the eight draft epic specs (BA-2, BA-4, BA-5, BA-9, BA-10, BA-11, BA-12, BA-82). Their stories, including the new bugs, can start. The exception is recorded under *Epic gate* in [CLAUDE.md](CLAUDE.md) and in each spec's status line.
- Filed the backfill's 10 likely bugs and 7 security gaps as Jira bugs BA-91 to BA-107 under BA-11. They are mirrored in roadmap Milestone 1.7 as features 1.7.3 to 1.7.19, security first. Details: [evidence/0.2.2/findings.md](evidence/0.2.2/findings.md).

### Changed
- `architecture.md` moved to [specs/system/architecture.md](specs/system/architecture.md).
- The five Gherkin Features moved verbatim from `gherkin.md` into their capability specs. The *Gherkin convention* became part of the *Spec convention*, and the E2E convention now mirrors the capability specs.
- CLAUDE.md went from 329 to about 170 lines. Its how-it-works sections (Electron delivery, versioning, npm package, folder layout, datastore, Mastra, visuals) moved into `specs/system/` and were checked against the code. A short *Code rules* list replaces them. Workflow steps 3, 4, 5, 9 and 10 and the worktree deploy convention were updated. Drift fixed:
  - Docker is started by the E2E global setup.
  - Only the Electron main process reads `BACKEND_PORT`.
  - Desktop isolation uses `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR`.
- README.md now links to `specs/` instead of CLAUDE.md for packaging and architecture details.
- Roadmap 0.2.1 (BA-84) marked `✅ Done`; it merged in PR #43.

### Removed
- `gherkin.md`. Every scenario now lives in exactly one capability spec.

## 2026-10-01

### Added
- Adopted the eleven-step delivery workflow in [CLAUDE.md](CLAUDE.md) (retrospective-first, roadmap → ADR → Gherkin → E2E impact analysis → tests-first → implement → green → changelog + evidence → retrospective) and seeded [roadmap.md](roadmap.md), [architecture.md](architecture.md), [gherkin.md](gherkin.md), [retrospective.md](retrospective.md), [evidence/](evidence/).
- Filled in the harness resources that were still missing: C4 Mermaid diagrams for all four levels in [architecture.md](architecture.md) (system context, containers, backend + frontend components, visual tailoring loop); Given/When/Then steps for all 20 scenarios in [gherkin.md](gherkin.md).
- Corrected [CLAUDE.md](CLAUDE.md) where it had drifted from the code:
  - The frontend is not routed yet. Features have no `pages/`, routes or store, and some `core/` folders are empty placeholders.
  - Lists every registered Mastra agent, plus the DuckDB observability store and the `infrastructure/crypto` key encryption.
  - Visuals: spec-first designer with a freeform fallback, the full version-folder file list inside the session workspace, and the tailor/refresh/repair endpoints.
  - The chat stream is `POST …/messages/stream` read with `fetch`.
  - Flags the hardcoded renderer port as a known gap.
- Added the **Branching convention** to [CLAUDE.md](CLAUDE.md): every PR is built in its own `<type>/<US-ID>-<short-description>` feature branch and git worktree, tied to an existing Jira user story.
- Roadmap: imported the **1.0 Beta** plan from Jira BA (target 2026-10-31) as Release 1. There are 7 milestones (one per epic: Evals, Data Model DSL, Knowledge Store, Reliability Signals, Data Connectors, User Testing, Bug Fixes) and 13 features, linked to the BA issues. Agent Routines (BA-82) is in the Backlog.
- Roadmap: added Release 0 / Milestone 0.1 with 0.1.1, the renderer ignoring `BACKEND_PORT` (`📋 Planned`).
- Evidence: process/docs-only change, no code or UI change. Diagrams rendered cleanly with `@mermaid-js/mermaid-cli` v12.

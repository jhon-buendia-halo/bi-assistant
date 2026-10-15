# BA-198 — Assistant skills: progressive-disclosure agent structure

- **Jira:** [BA-198](https://halo-powered.atlassian.net/browse/BA-198) · **Roadmap:** Milestone 1.13 · **Status:** Confirmed (2026-10-13). Scope extended on 2026-10-14 (skill levels and the Skills tab, ADR-0019; sectioned prompt, own catalog, `read_file` and `run_skill_script`, ADR-0020), each confirmed by the user the same day. Scope changed on 2026-10-14 for [BA-211](https://halo-powered.atlassian.net/browse/BA-211), at the user's request: the user and project skill levels are removed and only built-in skills load (ADR-0021).

## Goal

The agents get their know-how the way Agent Skills prescribe: a small always-loaded core, a catalog of skills (name and a "Use when…" description), and skill bodies and linked files read only when the turn needs them. Today the `assistant` carries one ~160-line prompt on every call, whatever the question, and the only skill (`interactive-visuals`) is copied into every session workspace, so it also shows in the assistant's catalog although only the designer uses it.

The refactor keeps what the user sees unchanged. Answers, clarifications, visuals and deep-analysis reports behave as they do now, and the eval suite proves it. What changes is where each instruction lives and when it reaches the model. The structural decision is ADR-0018 in [system/architecture.md](../../system/architecture.md).

## Scope

- **Skill layout.** Built-in skills live in `backend/src/mastra/skills/<name>/`, laid out as a `SKILL.md` (front matter `name` and a description that starts with "Use when…", then the phase map or router), with linked files in `phases/` and `reference/`, as the skill's own `SKILL.md` names them. Checks that have to be exact stay in TypeScript (read-only guard, result guards, visual-spec validation), and the skill names the tool or guard that applies them. `scripts/` is reserved for built-in skills (ADR-0019); no built-in needs one, so no runner is built.
- **Skill levels (added 2026-10-14, ADR-0019; removed the same day by BA-211, ADR-0021).** Shipped in 0.32 as: built-in < user (`<data dir>/skills/`) < project (the folder `QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR` names); a later level overrides an earlier one by name, read at startup. A new user or project skill is on demand for the agents its `agents` key names (default `assistant`). An override keeps the built-in's agents and loading mode. Broken user and project skills are skipped, not fatal. User and project skills are text only. BA-211 removes the user and project levels: the backend loads only the built-in skills, reads no `QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR`, and ignores a `<data dir>/skills/` folder left by 0.32.
- **Sectioned prompt and own catalog (added 2026-10-14, ADR-0020).** The assistant's prompt is identity, `## Tools`, `## Working rules` and `## Skills` (the user's template). The app renders the on-demand catalog with each `SKILL.md` path. The model reads skills with a read-only `read_file`, and built-in skills' Node scripts run through a restricted `run_skill_script`.
- **Skills tab (added 2026-10-14).** A read-only tab on the agent page: the agent's skills, whether each loads on demand or by the app, its files and their contents. Since BA-211 it no longer shows levels, overrides, warnings, skipped skills or where each level's folder is.
- **Loading.** Each agent declares its own skills from the app bundle (Mastra agent-level `skills`). Session workspaces stop carrying skill copies. Skills are loaded in one of two ways:
  - **On demand.** The model sees the catalog and loads a skill with the framework's `skill` and `skill_read` tools when the request matches its description.
  - **By the harness.** Code injects a skill's body or one of its files when a condition holds in code (a knowledge block exists, the deep-analysis phase, the designer mode). Procedures that must run are never left to the model to notice.
- **Startup check.** A skill without a `name` or `description`, a description that doesn't start with "Use when", or a link in `SKILL.md` to a missing file fails the backend at startup (and a unit test), not silently at run time.
- **Assistant core prompt.** Keeps the rules that apply to every data question: identity (still starting `You are the Questions to Insights assistant`), clarification, method, grounding, rationale, visuals, SQL rules and result sanity. The curated-knowledge rules, about 23% of the prompt, move into a skill.
- **Skills:**
  - `curated-knowledge` (assistant): how to apply `[term]`, `[instruction]` and `[default_filter]` snippets. Harness-loaded after the knowledge block until 1.13.9, on demand in the assistant's catalog since (ADR-0020).
  - `deep-analysis` (harness, assistant): `SKILL.md` phase map plus `phases/1-plan.md`, `phases/2-investigate.md` and `phases/3-report.md`. The deep-analysis service loads one phase per call. The phases run in sequence without user approval between them, as today.
  - `interactive-visuals` (harness, designer): `SKILL.md` becomes a router, with `reference/spec-mode.md` and `reference/freeform.md`. The pipeline loads only the mode it runs.
- **Specs** describe the new structure: where each rule now lives, and which skills each agent sees.

## Out of scope

- New user-facing behaviour, including approval gates between phases. The user steps in only through `ask_clarification`, as today.
- Merging the helper agents (`sql-fixer`, `sql-verifier`, `knowledge-bootstrap`, `assistant-eval-judge`) into the assistant. The verifier and the judge are independent checks with a fresh context, and the fixer and the bootstrap are one-call transforms driven by code. Their prompts are unchanged.
- Deleting a `<data dir>/skills/` folder left by 0.32 (BA-211 ignores it).
- Editing, creating or deleting skills in the app; per-person skills on the org server; reloading skills without a restart; a skill search tool; a shell or bash tool, Python scripts, and scripts in user or project skills.
- Changes to the models, effort routing, tools or the result guards.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-199](https://halo-powered.atlassian.net/browse/BA-199) | ADR, epic spec and skill loader for app-owned skills | 1.13.1 |
| [BA-200](https://halo-powered.atlassian.net/browse/BA-200) | Slim assistant core prompt: curated-knowledge skill, harness-loaded | 1.13.2 |
| [BA-201](https://halo-powered.atlassian.net/browse/BA-201) | *Cut, merged into BA-200* (was: curated-knowledge and sql-dialects skills) | 1.13.3 🚫 |
| [BA-202](https://halo-powered.atlassian.net/browse/BA-202) | Phased deep-analysis skill | 1.13.4 |
| [BA-203](https://halo-powered.atlassian.net/browse/BA-203) | Split interactive-visuals into spec-mode and freeform references | 1.13.5 |
| [BA-204](https://halo-powered.atlassian.net/browse/BA-204) (Bug) | Fix: `npm run evals:assistant` always refuses | 1.13.6 |
| [BA-205](https://halo-powered.atlassian.net/browse/BA-205) | Skill levels: built-in, user and project skills that override by name | 1.13.7 |
| [BA-206](https://halo-powered.atlassian.net/browse/BA-206) | Agent page Skills tab: an agent's skills, their level, files and contents | 1.13.8 |
| [BA-207](https://halo-powered.atlassian.net/browse/BA-207) | Sectioned assistant prompt with the app's own skill catalog, `read_file` and `run_skill_script` | 1.13.9 |
| [BA-208](https://halo-powered.atlassian.net/browse/BA-208) | Backend lint and format clean | 1.13.10 |
| [BA-209](https://halo-powered.atlassian.net/browse/BA-209) | Eval checks: a wider correct query passes; discovery cases don't require `list_entities` | 1.13.11 |
| [BA-210](https://halo-powered.atlassian.net/browse/BA-210) | Assistant reliability for the 100% eval bar: ask on an undefined measure, `create_visual` defaults to the user's request, JSON-encoded clarification options | 1.13.12 |
| [BA-211](https://halo-powered.atlassian.net/browse/BA-211) | Built-in skills only: remove the user and project skill levels | 1.13.13 |

All stories are built on `refactor/BA-198-assistant-skills` (worktree `.claude/worktrees/BA-198-assistant-skills`) and ship as one PR.

## Specs touched

- [system/architecture.md](../../system/architecture.md): ADR-0018 (progressive-disclosure skills, per-agent skills from the app bundle, harness-loaded vs on-demand) ADR-0019 (skill levels, scripts reserved for built-ins; superseded by ADR-0021), ADR-0020 (sectioned prompt, own catalog and skill tools) and ADR-0021 (built-in skills only). The component diagram's skills box changes.
- [system/api.md](../../system/api.md): the two Skills endpoints (§2.6) and `QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR` (removed again by BA-211, with the levels in the 34a response). [system/ui.md](../../system/ui.md) §4.5: the Skills tab. [agents-evals](../../capabilities/agents-evals/spec.md): Skills tab rules and the Feature "Agent skills".
- [system/agents.md](../../system/agents.md): §2.1 prompt requirements split into core prompt vs skills; §2.2 and §6.4 designer skill loading; §2.7 deep-analysis phases; §4.1 knowledge block rules; §7 rewritten (skills catalog, loading modes, startup check, workspaces without skill copies); closes the open question on which workspace and skill tools the assistant is offered.
- [system/data-model.md](../../system/data-model.md): session workspace folders no longer get `.agents/skills/…`. Existing copies are left on disk and ignored. §4.8: the user skill folder of 0.32 is ignored since BA-211.
- [product/glossary.md](../../product/glossary.md): *Skill*.
- [system/tech-stack.md](../../system/tech-stack.md): skills folder layout in the backend code map.
- Capability specs: 1.13.1-1.13.6 preserve behaviour, so step 6 of each re-runs the scenarios that exercise the touched agents (chat, visuals, knowledge, deep analysis, the Agents prompt tab). 1.13.7 adds scenarios to [sessions-chat](../../capabilities/sessions-chat/spec.md) "Skills the assistant is given"; 1.13.8 adds the agents-evals Feature "Agent skills". 1.13.13 removes their user and project skill scenarios and checks that an old skills folder is ignored.

## Acceptance

- The world-cup eval set, run with the same model (`openai/gpt-4o-mini`, the app's fallback) at the base commit and at the head of the epic branch, shows no regressions. Any case that changes is explained in the evidence.
- The full web E2E suite and the org suite are green. The backend unit and API tests, lint on changed files, both builds and `check-specs.py` pass.
- A recorded model request (stub LLM) shows that:
  - the assistant's system prompt is the core prompt plus the catalog of its own skills, and the catalog has no `interactive-visuals`;
  - a turn with a knowledge block carries the block and lists `curated-knowledge` in the catalog, and a turn without one carries no block;
  - each deep-analysis call carries only its own phase;
  - a spec-mode designer call carries `spec-mode.md` and not `freeform.md`.
- A skill with no description fails the backend at startup, and a unit test covers it.
- The Agents prompt tab still shows a prompt that starts with `You are the Questions to Insights assistant`.
- Since BA-211, only built-in skills reach any agent: a `<data dir>/skills/` folder is ignored, and `QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR` has no effect (recorded request and unit tests). (Before BA-211: a user-level skill reached the assistant's catalog, an override reached its call, and a broken user skill was skipped.)
- The assistant's recorded request has the four prompt sections, the app's own catalog with `SKILL.md` paths (`curated-knowledge` included), and `read_file` instead of the framework's skill tools. The world-cup evals pass at 100% after 1.13.9.
- The Skills tab shows each agent's skills with their loading mode, files and contents, and no levels, overrides or skipped skills (E2E).

## Dependencies, risks and open questions

- **Re-scoped 2026-10-13, with the user.** Two skills were cut after measuring the prompt:
  - `visual-tailoring`: its rules are 427 characters, and an on-demand catalog with the framework's usage note costs about 1,045 on every turn.
  - `sql-dialects`: there is no dialect guidance to move, so it would add new instructions for failures nobody has observed.

  BA-201 merged into BA-200.

- **Triggering is probabilistic.** A rule moved into an on-demand skill may simply never load. Until 1.13.9 every skill was loaded by the harness for that reason. Since 1.13.9 `curated-knowledge` is on demand at the user's request (ADR-0020), so the evals must pass at 100% with it.
- **Eval noise.** A single run before and after with `gpt-4o-mini` can flip a case for reasons unrelated to the refactor. A flipped case is re-run once before it counts as a regression.
- **Bundle paths.** Skills must resolve from `dist/` in the CLI, the Electron backend and Mastra Studio (the build already copies `mastra/skills/**`). The loader resolves one root and fails at startup when it is missing.
- **ADR numbering.** ADR-0018 and Milestone 1.13 skip the numbers the open BA-82 and BA-2 branches hold. Re-check both at merge time.
- **User and project skills were unreviewed prompt changes** (ADR-0019); BA-211 removes them (ADR-0021). An override of a harness-loaded skill is checked only for its files and placeholders, not its wording, and no eval runs on it. The Skills tab is where it shows.
- **Framework version.** Agent-level `skills`, the `skill` and `skill_read` tools, and the catalog injection are Mastra 1.66 behaviour, read from its source on 2026-10-13. A Mastra upgrade must re-run the request-recording test.

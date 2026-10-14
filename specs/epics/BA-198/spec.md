# BA-198 — Assistant skills: progressive-disclosure agent structure

- **Jira:** [BA-198](https://halo-powered.atlassian.net/browse/BA-198) · **Roadmap:** Milestone 1.13 · **Status:** Confirmed (2026-10-13)

## Goal

The agents get their know-how the way Agent Skills prescribe: a small always-loaded core, a catalog of skills (name and a "Use when…" description), and skill bodies and linked files read only when the turn needs them. Today the `assistant` carries one ~160-line prompt on every call, whatever the question, and the only skill (`interactive-visuals`) is copied into every session workspace, so it also shows in the assistant's catalog although only the designer uses it.

The refactor keeps what the user sees unchanged. Answers, clarifications, visuals and deep-analysis reports behave as they do now, and the eval suite proves it. What changes is where each instruction lives and when it reaches the model. The structural decision is ADR-0018 in [system/architecture.md](../../system/architecture.md).

## Scope

- **Skill layout.** App-owned skills live in `backend/src/mastra/skills/<name>/`, laid out as a `SKILL.md` (front matter `name` and a description that starts with "Use when…", then the phase map or router), with linked files in `phases/` and `references/`, as the skill's own `SKILL.md` names them. No `scripts/` that the model executes: the workspace has no sandbox and the app ships without an interpreter. Checks that have to be exact stay in TypeScript (read-only guard, result guards, visual-spec validation), and the skill names the tool or guard that applies them.
- **Loading.** Each agent declares its own skills from the app bundle (Mastra agent-level `skills`). Session workspaces stop carrying skill copies. Skills are loaded in one of two ways:
  - **On demand.** The model sees the catalog and loads a skill with the framework's `skill` and `skill_read` tools when the request matches its description.
  - **By the harness.** Code injects a skill's body or one of its files when a condition holds in code (a knowledge block exists, the deep-analysis phase, the designer mode). Procedures that must run are never left to the model to notice.
- **Startup check.** A skill without a `name` or `description`, a description that doesn't start with "Use when", or a link in `SKILL.md` to a missing file fails the backend at startup (and a unit test), not silently at run time.
- **Assistant core prompt.** Keeps the rules that apply to every data question: identity (still starting `You are the Questions to Insights assistant`), clarification, method, grounding, rationale, visuals, SQL rules and result sanity. The curated-knowledge rules, about 23% of the prompt, move into a skill.
- **Skills:**
  - `curated-knowledge` (harness, assistant): how to apply `[term]`, `[instruction]` and `[default_filter]` snippets, sent only when the turn carries a knowledge block.
  - `deep-analysis` (harness, assistant): `SKILL.md` phase map plus `phases/1-plan.md`, `phases/2-investigate.md` and `phases/3-report.md`. The deep-analysis service loads one phase per call. The phases run in sequence without user approval between them, as today.
  - `interactive-visuals` (harness, designer): `SKILL.md` becomes a router, with `references/spec-mode.md` and `references/freeform.md`. The pipeline loads only the mode it runs.
- **Specs** describe the new structure: where each rule now lives, and which skills each agent sees.

## Out of scope

- New user-facing behaviour, including approval gates between phases. The user steps in only through `ask_clarification`, as today.
- Merging the helper agents (`sql-fixer`, `sql-verifier`, `knowledge-bootstrap`, `assistant-eval-judge`) into the assistant. The verifier and the judge are independent checks with a fresh context, and the fixer and the bootstrap are one-call transforms driven by code. Their prompts are unchanged.
- User-authored skills, skill editing in the UI, a skill search tool, model-executed scripts.
- Changes to the models, effort routing, tools or the result guards.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-199](https://halo-powered.atlassian.net/browse/BA-199) | ADR, epic spec and skill loader for app-owned skills | 1.13.1 |
| [BA-200](https://halo-powered.atlassian.net/browse/BA-200) | Slim assistant core prompt: curated-knowledge skill, harness-loaded | 1.13.2 |
| [BA-201](https://halo-powered.atlassian.net/browse/BA-201) | *Cut, merged into BA-200* (was: curated-knowledge and sql-dialects skills) | 1.13.3 🚫 |
| [BA-202](https://halo-powered.atlassian.net/browse/BA-202) | Phased deep-analysis skill | 1.13.4 |
| [BA-203](https://halo-powered.atlassian.net/browse/BA-203) | Split interactive-visuals into spec-mode and freeform references | 1.13.5 |

All stories are built on `refactor/BA-198-assistant-skills` (worktree `.claude/worktrees/BA-198-assistant-skills`) and ship as one PR.

## Specs touched

- [system/architecture.md](../../system/architecture.md): ADR-0018 (progressive-disclosure skills, per-agent skills from the app bundle, harness-loaded vs on-demand). The component diagram's skills box changes.
- [system/agents.md](../../system/agents.md): §2.1 prompt requirements split into core prompt vs skills; §2.2 and §6.4 designer skill loading; §2.7 deep-analysis phases; §4.1 knowledge block rules; §7 rewritten (skills catalog, loading modes, startup check, workspaces without skill copies); closes the open question on which workspace and skill tools the assistant is offered.
- [system/data-model.md](../../system/data-model.md): session workspace folders no longer get `.agents/skills/…`. Existing copies are left on disk and ignored.
- [system/tech-stack.md](../../system/tech-stack.md): skills folder layout in the backend code map.
- Capability specs: no rule or Gherkin change is expected, because behaviour is preserved. Step 6 of each story re-runs the scenarios that exercise the touched agents (chat, visuals, knowledge, deep analysis, the Agents prompt tab).

## Acceptance

- The world-cup eval set, run with the same model (`openai/gpt-4o-mini`, the app's fallback) at the base commit and at the head of the epic branch, shows no regressions. Any case that changes is explained in the evidence.
- The full web E2E suite and the org suite are green. The backend unit and API tests, lint on changed files, both builds and `check-specs.py` pass.
- A recorded model request (stub LLM) shows that:
  - the assistant's system prompt is the core prompt plus the catalog of its own skills, and the catalog has no `interactive-visuals`;
  - a turn with a knowledge block carries the `curated-knowledge` skill, and a turn without one doesn't;
  - each deep-analysis call carries only its own phase;
  - a spec-mode designer call carries `spec-mode.md` and not `freeform.md`.
- A skill with no description fails the backend at startup, and a unit test covers it.
- The Agents prompt tab still shows a prompt that starts with `You are the Questions to Insights assistant`.

## Dependencies, risks and open questions

- **Re-scoped 2026-10-13, with the user.** Two skills were cut after measuring the prompt:
  - `visual-tailoring`: its rules are 427 characters, and an on-demand catalog with the framework's usage note costs about 1,045 on every turn.
  - `sql-dialects`: there is no dialect guidance to move, so it would add new instructions for failures nobody has observed.

  BA-201 merged into BA-200.

- **Triggering is probabilistic.** A rule moved into an on-demand skill may simply never load. So no skill here is on demand: every skill is loaded by the harness. The catalog mechanism, the per-agent declaration and the startup check are in place for a future on-demand skill.
- **Eval noise.** A single run before and after with `gpt-4o-mini` can flip a case for reasons unrelated to the refactor. A flipped case is re-run once before it counts as a regression.
- **Bundle paths.** Skills must resolve from `dist/` in the CLI, the Electron backend and Mastra Studio (the build already copies `mastra/skills/**`). The loader resolves one root and fails at startup when it is missing.
- **ADR numbering.** ADR-0018 and Milestone 1.13 skip the numbers the open BA-82 and BA-2 branches hold. Re-check both at merge time.
- **Framework version.** Agent-level `skills`, the `skill` and `skill_read` tools, and the catalog injection are Mastra 1.66 behaviour, read from its source on 2026-10-13. A Mastra upgrade must re-run the request-recording test.

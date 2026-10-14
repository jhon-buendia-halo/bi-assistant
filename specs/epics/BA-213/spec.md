# BA-213 — Agent Hub: tools and skills per agent

- **Jira:** [BA-213](https://halo-powered.atlassian.net/browse/BA-213) · **Roadmap:** Milestone 1.14 · **Status:** Confirmed (2026-10-14); amended on 2026-10-14 to add the RFP Builder (BA-225 to BA-229), re-confirmed by the user on 2026-10-14; the five decisions below were confirmed with it

## Goal

A user who builds an agent decides what it can do, not only what it is told. Today every user agent gets all of the assistant's tools and the same skills, and its only lever is a block of instructions. A "KPI lookup" agent that should never draw charts or ask questions back can only be asked not to.

This epic lets the user:

- **choose the agent's tools** from the assistant's own set;
- **write skills in the app**: named, reusable know-how ("how we compute churn", "our fiscal calendar") with a "Use when…" description and optional reference files;
- **assign skills to any of their agents**, so the same skill serves several agents.

The agent's instructions stay layered on the core prompt, which a Platform admin can edit since BA-224 (ADR-0026). The read-only SQL guard, grounding, SQL repair and trust signals hold for every agent whatever it is configured with (ADR-0008). The decision is ADR-0022 in [system/architecture.md](../../system/architecture.md).

On 2026-10-14 the user widened the epic: besides shaping user agents, the hub ships a second Official agent built in code, the **RFP Builder**, which walks a Mercer benefits consultant through building a carrier RFP for one client over the Intellify data ([BA-212](https://halo-powered.atlassian.net/browse/BA-212)), reached only through a REST API this epic builds (ADR-0027, ADR-0028).

## Scope

- **Tool selection** ([BA-217](https://halo-powered.atlassian.net/browse/BA-217)).
  - An agent's configuration names the optional tools it gets. `list_entities`, `describe_entity` and `run_readonly_sql` are always on, because an agent without them can't ground an answer.
  - The optional tools are `sample_rows`, `ask_clarification`, and **Visuals** (`create_visual` and `update_visual` together, since one without the other makes no sense). The framework's skill tool is not one of the choices: an agent with skills always has it (since BA-223, ADR-0025).
  - A tool that is off is not offered to the model. The prompt's `## Tools` section lists only the tools offered.
  - Working rules that name a tool that is off are replaced by tool-free wording. For example, with clarification off the agent picks the most natural reading and states the assumption; with Visuals off it says it can't draw a visual here.
  - The plain assistant and agents with every tool on get today's prompt, byte for byte.
  - The editor gets a tool picker. The preview chat runs the draft's tools.
- **Skills written in the app** ([BA-215](https://halo-powered.atlassian.net/browse/BA-215)).
  - A per-user `skills` collection: name, description, body and reference files.
  - A skills library page in the Agents area, with a skill editor: create, edit, delete.
  - The same checks as file skills ([agents.md](../../system/agents.md) 7.3): `name` in kebab-case, unique among the owner's skills and different from every built-in skill; `description` starts with `Use when`; every reference file the body names exists. Size limits keep a skill's catalog entry and files small (decision 4).
  - Text only: no scripts, ever.
- **Skills assigned to agents** ([BA-216](https://halo-powered.atlassian.net/browse/BA-216)).
  - The editor gets a skill picker over the owner's in-app skills.
  - A session bound to the agent gets the built-in on-demand skills (`curated-knowledge` today) plus the agent's skills, given to the model through the framework's skill catalog and skill tool (since BA-223, ADR-0025; first built as an app-rendered `## Skills` catalog with `read_file` over virtual paths).
  - **Publish copies** each assigned skill's content into the Live version. Editing or deleting a skill changes no Live agent until it is republished, the same guarantee instructions have (R44, R58 in [agents-evals](../../capabilities/agents-evals/spec.md)). The preview chat reads the skills' current content.
  - The agent page's Skills tab shows a user agent's own skills.

### Prompt cost, measured on 2026-10-14

Measured from the compiled `assistant` on `main` at `513009d`:

| Section | Characters |
|---|---|
| Whole prompt today | 8,729 |
| Identity | 429 |
| `## Tools` | 1,470 |
| `## Working rules` | 5,894 |
| `## Skills` with `curated-knowledge` | 904 |

- At the time of this measurement `curated-knowledge` was already on demand, so the `## Skills` section and `read_file` were sent on every assistant call (BA-223 later moved the catalog to the framework). Assigning skills to an agent adds catalog entries only: about **160 characters per skill**, plus the length of its description beyond a short one.
- Turning tools off makes the prompt shorter:
  - clarification off: the tool line (357) and the clarification paragraph (1,347), partly replaced by one shorter sentence;
  - Visuals off: two tool lines (313) and the visuals rules (428), replaced by one sentence;
  - `sample_rows` off: one tool line (107) and three mentions in the rules.

No configuration this epic allows makes an agent's prompt longer than today's by more than its skills' catalog entries.

- **Built-in skills edited in the app** ([BA-218](https://halo-powered.atlassian.net/browse/BA-218), added on 2026-10-14 at the user's request; ADR-0023).
  - The skills library also lists the built-in skills, read-only for most users.
  - A Platform admin can edit one. The edit is an org-wide override in the database that replaces the bundled skill on the next call, with the override checks, a **Modified** chip, **Reset to built-in**, and a notice when a newer app version changes the built-in.

- **Links in instructions, skills that link tools, and new tabs** ([BA-219](https://halo-powered.atlassian.net/browse/BA-219), [BA-220](https://halo-powered.atlassian.net/browse/BA-220), [BA-221](https://halo-powered.atlassian.net/browse/BA-221); added on 2026-10-14 at the user's request; ADR-0024).
  - An agent's instructions are written in a rich editor where `/` links the owner's in-app skills and the assistant's tools as chips, saved as `[[skill:<name>]]` and `[[tool:<name>]]`. The links are the single source of truth: the backend derives the agent's `tools` and `skills` from them on every save, which **replaces the BA-216 skill picker and the BA-217 tool picker**.
  - An in-app skill's body may link tools, never skills. An agent gets its directly linked optional tools plus those its linked skills link.
  - The model never sees the syntax: links become plain mentions in the instructions and in a skill's body when the skill tool serves it.
  - A skill that a draft links can't be deleted or renamed. An agent saved before links gets a `Tools and skills:` line when opened in the editor.
  - The agent page's Tools tab shows the whole library with how each tool is linked; a new **Graph** tab draws instructions to skills to tools; the Model tab becomes **LLM Config**, which shows whether the API key is set and never the key.
  - The design is in [docs/plans/BA-213/ba-219-221-design.md](../../../docs/plans/BA-213/ba-219-221-design.md).
- **The agent page as in the reference, and skills through the skill tool** ([BA-222](https://halo-powered.atlassian.net/browse/BA-222), [BA-223](https://halo-powered.atlassian.net/browse/BA-223); added on 2026-10-14 at the user's request; ADR-0025).
  - BA-222: the agent page gets a **Chat Box** tab (chat with the draft), a **System Prompt** tab whose agent instructions are editable in place with links, and an inline **Skills** tab (the user's library with `Linked` and `Not linked`), in the tab order Chat Box, System Prompt, Skills, Tools, Graph, Memory, Evals, LLM Config.
  - BA-223: the assistant gets its on-demand skills through Mastra's `skills` option, resolved per request, with the framework's own catalog and skill tool. The app's `## Skills` section, `read_file`, `run_skill_script` and the `/in-app-skills/` paths are removed.
  - The design is in [docs/plans/BA-213/ba-222-223-design.md](../../../docs/plans/BA-213/ba-222-223-design.md).

- **Every agent's System Prompt editable** ([BA-224](https://halo-powered.atlassian.net/browse/BA-224), added on 2026-10-14 at the user's request; ADR-0026).
  - A Platform admin edits the System Prompt of the Official assistant and of the five System agents from the agent page, as org-wide overrides in a shared `agent_prompt_overrides` collection, with **Save prompt**, **Reset to built-in**, a **Modified** chip and a drift notice, as for built-in skills (BA-218). A save applies to the next call of every session and user agent.
  - The assistant's `## Tools` section stays generated and is not part of the edited text; its override may link tools as mentions and may not link skills. System agents' overrides replace their static instructions.
  - With no override every prompt is byte-identical to today's.

- **The RFP Builder and the Intellify RFP API** ([BA-225](https://halo-powered.atlassian.net/browse/BA-225) to [BA-229](https://halo-powered.atlassian.net/browse/BA-229), added on 2026-10-14 at the user's request; ADR-0027, ADR-0028).
  - The Intellify RFP API (BA-226, BA-227): read endpoints over the `intellify` schema, RFP records in a new `rfp` schema, an OpenAPI document, `X-API-Key` auth, an embedded start in every delivery, and a Testing Data fixture that registers it as a REST datasource and dataset.
  - The built-in agent `rfp` (BA-228): its prompt, the `rfp-process` skill, dedicated HTTP tools, kind Official, Start chat over the fixture's dataset, and sessions bound to a built-in agent.
  - The RFP package (BA-227, BA-229): a Markdown and PDF document and CSV exhibits, downloaded from the chat.
  - The `rfp` eval set (BA-228).
  - The plan is in [docs/plans/BA-213/rfp-builder-plan.md](../../../docs/plans/BA-213/rfp-builder-plan.md).

## Out of scope

- **New tools for user agents**, custom code tools, MCP servers or any tool a user agent could pick beyond the assistant's. The RFP Builder's tools are built in code for that agent only (ADR-0028).
- **Per-agent core prompts.** A user agent's instructions stay Block 5 (ADR-0008); only the shared core prompt can be edited, by an admin (BA-224, ADR-0026), so the edit applies to every agent.
- **User and project skill folders.** Removed by [BA-211](https://halo-powered.atlassian.net/browse/BA-211) (ADR-0021), merged into this branch; only built-in and in-app skills exist.
- Skills for the System agents other than the built-in `interactive-visuals` (BA-218 lets an admin edit it).
- **Sharing skills** with other users. Skills are private to their owner, like agents (ADR-0010); sharing waits for a Requests/Registry epic.
- **Skill version history** beyond the copy each Live agent holds.
- Giving in-app skills to the plain assistant (decision 3).
- Per-user access control inside the Intellify RFP API: the API key is the boundary.
- Real Intellify data: the API serves the Intellify sample (BA-212).
- An RFP workflow beyond one consultant: approvals, a carrier portal, bid comparison.
- Editing the RFP outside the chat.
- Snapshots of the exhibits at issue time: exhibits are computed live.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-214](https://halo-powered.atlassian.net/browse/BA-214) | ADR, epic spec and roadmap for agent tools and skills | 1.14.1 |
| [BA-217](https://halo-powered.atlassian.net/browse/BA-217) | Choose an agent's tools | 1.14.2 |
| [BA-215](https://halo-powered.atlassian.net/browse/BA-215) | Write skills in the app | 1.14.3 |
| [BA-216](https://halo-powered.atlassian.net/browse/BA-216) | Assign skills to an agent | 1.14.4 |
| [BA-218](https://halo-powered.atlassian.net/browse/BA-218) | Edit built-in skills in the app | 1.14.5 |
| [BA-219](https://halo-powered.atlassian.net/browse/BA-219) | Link skills and tools in an agent's instructions | 1.14.6 |
| [BA-220](https://halo-powered.atlassian.net/browse/BA-220) | Skills link tools | 1.14.7 |
| [BA-221](https://halo-powered.atlassian.net/browse/BA-221) | Tools library, Graph and LLM Config tabs | 1.14.8 |
| [BA-222](https://halo-powered.atlassian.net/browse/BA-222) | Agent page as in the reference: Chat Box, editable System Prompt and Skills tabs | 1.14.9 |
| [BA-223](https://halo-powered.atlassian.net/browse/BA-223) | Skills reach the model through Mastra's skill tool | 1.14.10 |
| [BA-224](https://halo-powered.atlassian.net/browse/BA-224) | Edit every agent's System Prompt, built-in agents included | 1.14.11 |
| [BA-225](https://halo-powered.atlassian.net/browse/BA-225) | ADRs, epic amendment and specs for the RFP Builder and the Intellify RFP API | 1.14.12 |
| [BA-226](https://halo-powered.atlassian.net/browse/BA-226) | The Intellify RFP API: read endpoints, auth, OpenAPI, embedded start and Testing Data registration | 1.14.13 |
| [BA-227](https://halo-powered.atlassian.net/browse/BA-227) | RFP records and the RFP package in the API | 1.14.14 |
| [BA-228](https://halo-powered.atlassian.net/browse/BA-228) | The RFP Builder agent: prompt, skill, tools, hub and sessions | 1.14.15 |
| [BA-229](https://halo-powered.atlassian.net/browse/BA-229) | The RFP package from the chat | 1.14.16 |

All stories are built on one branch, `feat/BA-213-agent-tools-skills`, and ship as one PR.

## Specs touched

- [system/architecture.md](../../system/architecture.md): ADR-0022 (BA-214).
- [system/data-model.md](../../system/data-model.md): `AgentConfig` (3.10) gains `tools` and `skills`; the Live version holds skill copies; a new `skills` collection, owner-scoped (3.15). An absent `tools` means every tool, so no migration.
- [system/api.md](../../system/api.md) 2.6: the draft and publish payloads; new skill endpoints; 34a and 34b for user agents' own skills; the permission table.
- [system/agents.md](../../system/agents.md): the assistant's prompt and tools built per call (1.2, 2.1, 3); 7.3 to 7.5 for in-app skills and the virtual location; evals for agent configurations (8). Also fixes the stale sentence in 7.4 that says no built-in skill is on demand.
- [capabilities/agents-evals](../../capabilities/agents-evals/spec.md): R43, R49, R55, R60 and R63 change; new rules for the skills library; the `Agent editor` and `Agent skills` Features gain scenarios and a new `Skill library` Feature is added.
- [capabilities/sessions-chat](../../capabilities/sessions-chat/spec.md): R54 (what an agent session applies per call).
- [capabilities/admin](../../capabilities/admin/spec.md): managing skills needs Create, test and version agents; viewing them needs Use agents.
- [system/ui.md](../../system/ui.md): the editor's Tools and Skills fields (4.5.1), the skills library and skill editor, and their copy.
- [product/glossary.md](../../product/glossary.md): *in-app skill*, *tool selection*, *link (skill or tool)*.
- BA-222 and BA-223: ADR-0025 (supersedes ADR-0020); capability [agents-evals](../../capabilities/agents-evals/spec.md) R5, R6, R60, R61, R63, R86 change and R90-R96 are new, with new Agent editor scenarios; [sessions-chat](../../capabilities/sessions-chat/spec.md) R54 and the Skills Feature; agents.md 1.2, 2.1, 3.9 (replaces 3.9 and 3.10), 4.2, 7.3-7.5 and Appendix A; ui.md 4.5 and 4.5.8-4.5.10; glossary *Skill*.
- BA-224: ADR-0026; capability [agents-evals](../../capabilities/agents-evals/spec.md) R6, R46, R91 and R92 change and R97-R104 are new, with a new Built-in agent prompts Feature; [admin](../../capabilities/admin/spec.md) R21 (what `edit-policies` guards); data-model.md 3.10.3 and 3.15; api.md 34, 103, 104 and the permission table; agents.md 1.1, 1.2, 2.1-2.6, 4.1, 5.5, 9; ui.md 4.5.11; glossary *Built-in agent prompt override*.
- BA-219 to BA-221: capability R43, R55, R60, R63, R70, R72 change and R81-R89 are new in [agents-evals](../../capabilities/agents-evals/spec.md); api.md 34, 41, 42, 94, 96-98; data-model.md 3.10 and 3.10.1; agents.md 2.1, 4.1, 4.2, 7.3; ui.md 4.5, 4.5.1, 4.5.3, 4.5.5-4.5.7; tech-stack.md (Tiptap).
- BA-225 to BA-229: ADR-0027 and ADR-0028, and ADR-0008's status line; a new capability [rfp](../../capabilities/rfp/spec.md) and its row in the [specs README](../../README.md); agents.md 1.2, 2.8, 3.10, 4.1, 7.4, 8.1; api.md 2.1 (3, 105), 2.6 (33, 35), 2.9 (56), a new 2.16 for the Intellify RFP API, 3.1, 5, 6.1; data-model.md 3.4, 3.4.1, 3.10.3, 4.1 and a new section 7 (external databases, the `rfp` schema); capability [agents-evals](../../capabilities/agents-evals/spec.md) R1, R2, R5, R10, R11, R53; [testing-data](../../capabilities/testing-data/spec.md) R1, R2, R9, R16; [sessions-chat](../../capabilities/sessions-chat/spec.md) R52, R54; [datasources](../../capabilities/datasources/spec.md) Contracts; ui.md 4.4, 4.5, 4.11, 4.12; delivery.md 2, 7; tech-stack.md; glossary.

## Acceptance

- The plain assistant's prompt is byte-identical to today's (a golden test), and the world-cup eval set passes at 100% over 3 runs on the branch.
- New eval cases run an agent with clarification off and one with Visuals off, and pass at 100% over 3 runs, with no tool errors.
- A recording-stub E2E proves, on the real request, that:
  - a tool turned off in the draft is not offered, and its preview answers without it;
  - an assigned in-app skill is in the model's skill catalog and the skill tool returns its body;
  - after the skill is edited, a session of the Live agent still gets the published copy until the agent is republished.
- In org server mode, a user sees and assigns only their own skills (an API test with two users).
- The `rfp` eval set passes at 100% over 3 runs on the branch.
- The RFP builder Feature's Playwright scenarios pass against the embedded API with the LLM stub.
- `GET /openapi.json` lets Discover propose the 10 collection endpoints of the Intellify RFP API.
- The API's e2e spec proves reads are read-only (a write attempted through a read route fails) and writes touch `rfp.*` only.
- `python3 scripts/check-specs.py` passes.

## Dependencies, risks and decisions

- **BA-211 is merged in** (2026-10-14). It removed the user and project folders; the Skills tab's levels are now Built-in and In-app, and in-app skills are a separate source in the database.
- **ADR number.** BA-211 took ADR-0021 on `main`, so this epic's ADRs are ADR-0022 to ADR-0026.
- **Risk: prompt variants.** Three toggles make eight prompts. Rules are toggled as whole blocks, and the two most restrictive variants get eval cases. The rest are covered by unit tests on the prompt builder.
- **Risk: a model calls a tool it wasn't given.** That fails `check-no-tool-errors`. The replacement wording is what prevents it, and the new eval cases measure it.
- **Risk: on-demand loading is probabilistic** (ADR-0018). An assigned skill can fail to trigger. Its description is the trigger, so the editor asks for a "Use when…" sentence and shows the catalog entry the model will see.
- **Decision 1: where the skills library lives.** A **Skills** button in the Agent Hub header, next to **New agent**, opening a list page with a skill editor.
- **Decision 2: Visuals is one switch:** `create_visual` and `update_visual` together.
- **Decision 3: the plain assistant and in-app skills.** Skills reach a session only through an agent that has them assigned. The plain assistant keeps only the built-ins, so its prompt and evals don't change with a user's library.
- **Decision 4: limits.** Up to 10 skills per agent; a description of at most 300 characters; a body of at most 20,000; up to 10 reference files of at most 20,000 each. With 10 skills the catalog grows by at most about 4,600 characters.
- **Decision 6: links replace the pickers** (2026-10-14, ADR-0024). The BA-216 skill picker and the BA-217 tool picker are replaced by links in the instructions. Decision 3 stands in spirit: skills reach a session only through an agent that **links** them, no longer one that has them ticked; decision 2 (Visuals is one switch) holds, now as linking either visual tool; decision 4's 10-skill cap counts distinct linked skills. The stored `tools` and `skills` lists stay, derived from the links, so no migration.
- **Decision 5: agent transfer (org mode).** When an admin transfers an agent, its Live version keeps its skill copies and keeps working. The draft's skill references are copied into the new owner's library as new skills, renamed on a name clash. It is built last in BA-216.
- **Decision 7: reference-style agent page and skill tool** (2026-10-14, ADR-0025). The agent page and the way skills reach the model follow the agent-poc reference. The page keeps this app's database storage, per-user agents, fixed core prompt, built-in overrides and links (ADR-0024); only the instructions are editable on the System Prompt tab. The assistant declares its on-demand skills through Mastra's `skills` option and the framework renders the catalog and provides the skill tool, replacing the app's own (ADR-0020). Decisions 3 and 6 stand. Acceptance: the world-cup evals pass at 100% (3 runs per case) on `claude-sonnet-5`, base versus branch.
- **Decision 8: every agent's System Prompt is editable** (2026-10-14, ADR-0026). The Official assistant's and the five System agents' prompts are edited by Platform admins as org-wide overrides, the same pattern as built-in skills (ADR-0023), as in the agent-poc reference. This narrows decision 7's "fixed core prompt" and supersedes ADR-0008's fixed core: the assistant's core prompt can change without a release, for every session and user agent, and the generated `## Tools` section stays out of the edited text. The assistant keeps all its tools whatever links its prompt has (links are mentions), and the code-enforced guards hold whatever a prompt says. Acceptance: no override means byte-identical prompts, and the world-cup evals pass at 100% (3 runs per case) with no override.
- **ADR numbers for the RFP Builder.** ADR-0027 and ADR-0028 follow this epic's ADR-0026.
- **Risk: Postgres is required for the Intellify RFP API.** Without its database the API answers 503 and `/health` reports the database down; the app keeps running.
- **Risk: eval records.** The `rfp` evals create RFPs in `rfp.*`; they tag them `created_by = eval:<jobId>` and delete them after the run.
- **Risk: parallel edits.** Another session edits the agents and sessions files on this branch; the RFP work makes additive edits and adds new files where it can.
- **Decision 9: the RFP Builder and the Intellify RFP API** (2026-10-14, ADR-0027, ADR-0028, plan in [docs/plans/BA-213/rfp-builder-plan.md](../../../docs/plans/BA-213/rfp-builder-plan.md)). The API is a second NestJS application in `backend/`, embedded by default (`INTELLIFY_API=off` disables it) and runnable alone, with its own port (3100), `X-API-Key` auth, OpenAPI document and Postgres pool; reads over `intellify.*` are read-only and writes go only to a new `rfp` schema. The agent `rfp` is built in code with its own prompt, the `rfp-process` skill and HTTP tools that reach the API through the REST datasource bound to the session, never through environment or settings; it has no SQL tool. Sessions can bind to a built-in agent (`agentKey`), which narrows ADR-0008. Defaults the user confirmed with the plan:
  - the RFP Builder is kind `official`, a second card in the Official section;
  - the API's default database is `intellify_mercer_demo`, while the Intellify fixture still defaults to `intellify` (load the fixture into `intellify_mercer_demo` or set `INTELLIFY_DB_NAME=intellify`);
  - a renewal's effective date is 1 January after the plan year (`plan_financial.planYear`);
  - the API key is the whole access boundary, and `created_by` is an attribute only;
  - exhibits are computed live, with no snapshot at issue time; the PDF is a plain pdfkit rendering of the Markdown;
  - new backend dependencies `@nestjs/swagger` and `pdfkit`, both pure JavaScript.

# BA-213 — Agent Hub: tools and skills per agent

- **Jira:** [BA-213](https://halo-powered.atlassian.net/browse/BA-213) · **Roadmap:** Milestone 1.14 · **Status:** Confirmed (2026-10-14); the five decisions below were confirmed with it

## Goal

A user who builds an agent decides what it can do, not only what it is told. Today every user agent gets all of the assistant's tools and the same skills, and its only lever is a block of instructions. A "KPI lookup" agent that should never draw charts or ask questions back can only be asked not to.

This epic lets the user:

- **choose the agent's tools** from the assistant's own set;
- **write skills in the app**: named, reusable know-how ("how we compute churn", "our fiscal calendar") with a "Use when…" description and optional reference files;
- **assign skills to any of their agents**, so the same skill serves several agents.

The agent's instructions stay layered on the fixed core prompt. The read-only SQL guard, grounding, SQL repair and trust signals hold for every agent whatever it is configured with (ADR-0008). The decision is ADR-0021 in [system/architecture.md](../../system/architecture.md).

## Scope

- **Tool selection** ([BA-217](https://halo-powered.atlassian.net/browse/BA-217)).
  - An agent's configuration names the optional tools it gets. `list_entities`, `describe_entity` and `run_readonly_sql` are always on, because an agent without them can't ground an answer.
  - The optional tools are `sample_rows`, `ask_clarification`, and **Visuals** (`create_visual` and `update_visual` together, since one without the other makes no sense). `read_file` stays implied: it is offered whenever the agent has skills in its catalog.
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
  - A session bound to the agent gets a `## Skills` catalog of the built-in on-demand skills (`curated-knowledge` today) plus the agent's skills. `read_file` reads an in-app skill through a virtual location resolved from the call's agent configuration, never from disk.
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

- `curated-knowledge` is already on demand, so the `## Skills` section and `read_file` are already sent on every assistant call. Assigning skills to an agent adds catalog entries only: about **160 characters per skill**, plus the length of its description beyond a short one.
- Turning tools off makes the prompt shorter:
  - clarification off: the tool line (357) and the clarification paragraph (1,347), partly replaced by one shorter sentence;
  - Visuals off: two tool lines (313) and the visuals rules (428), replaced by one sentence;
  - `sample_rows` off: one tool line (107) and three mentions in the rules.

No configuration this epic allows makes an agent's prompt longer than today's by more than its skills' catalog entries.

## Out of scope

- **New tools**, custom code tools, MCP servers or any tool the assistant doesn't already have.
- **Replacing the core prompt.** Instructions stay Block 5 (ADR-0008).
- **User and project skill folders.** [BA-211](https://halo-powered.atlassian.net/browse/BA-211) removes them; in-app skills replace them for users.
- **Overriding a built-in skill** from the app, and skills for the System agents.
- **Sharing skills** with other users. Skills are private to their owner, like agents (ADR-0010); sharing waits for a Requests/Registry epic.
- **Skill version history** beyond the copy each Live agent holds.
- Giving in-app skills to the plain assistant (decision 3).

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-214](https://halo-powered.atlassian.net/browse/BA-214) | ADR, epic spec and roadmap for agent tools and skills | 1.14.1 |
| [BA-217](https://halo-powered.atlassian.net/browse/BA-217) | Choose an agent's tools | 1.14.2 |
| [BA-215](https://halo-powered.atlassian.net/browse/BA-215) | Write skills in the app | 1.14.3 |
| [BA-216](https://halo-powered.atlassian.net/browse/BA-216) | Assign skills to an agent | 1.14.4 |

All stories are built on one branch, `feat/BA-213-agent-tools-skills`, and ship as one PR.

## Specs touched

- [system/architecture.md](../../system/architecture.md): ADR-0021 (BA-214).
- [system/data-model.md](../../system/data-model.md): `AgentConfig` (3.10) gains `tools` and `skills`; the Live version holds skill copies; a new `skills` collection, owner-scoped (3.15). An absent `tools` means every tool, so no migration.
- [system/api.md](../../system/api.md) 2.6: the draft and publish payloads; new skill endpoints; 34a and 34b for user agents' own skills; the permission table.
- [system/agents.md](../../system/agents.md): the assistant's prompt and tools built per call (1.2, 2.1, 3); 7.3 to 7.5 for in-app skills and the virtual location; evals for agent configurations (8). Also fixes the stale sentence in 7.4 that says no built-in skill is on demand.
- [capabilities/agents-evals](../../capabilities/agents-evals/spec.md): R43, R49, R55, R60 and R63 change; new rules for the skills library; the `Agent editor` and `Agent skills` Features gain scenarios and a new `Skill library` Feature is added.
- [capabilities/sessions-chat](../../capabilities/sessions-chat/spec.md): R54 (what an agent session applies per call).
- [capabilities/admin](../../capabilities/admin/spec.md): managing skills needs Create, test and version agents; viewing them needs Use agents.
- [system/ui.md](../../system/ui.md): the editor's Tools and Skills fields (4.5.1), the skills library and skill editor, and their copy.
- [product/glossary.md](../../product/glossary.md): *in-app skill*, *tool selection*.

## Acceptance

- The plain assistant's prompt is byte-identical to today's (a golden test), and the world-cup eval set passes at 100% over 3 runs on the branch.
- New eval cases run an agent with clarification off and one with Visuals off, and pass at 100% over 3 runs, with no tool errors.
- A recording-stub E2E proves, on the real request, that:
  - a tool turned off in the draft is not offered, and its preview answers without it;
  - an assigned in-app skill is in the catalog and `read_file` returns its body;
  - after the skill is edited, a session of the Live agent still gets the published copy until the agent is republished.
- In org server mode, a user sees and assigns only their own skills (an API test with two users).
- `python3 scripts/check-specs.py` passes.

## Dependencies, risks and decisions

- **Depends on BA-211.** BA-215 and BA-216 start once BA-211 has merged to `main` and this branch is rebased on it. BA-217 does not depend on it.
- **ADR number.** ADR-0021 is the next free number on `main` and every open branch today. BA-211 supersedes ADR-0019 on `refactor/BA-198-assistant-skills` and may claim a number first: recheck at merge time.
- **Risk: prompt variants.** Three toggles make eight prompts. Rules are toggled as whole blocks, and the two most restrictive variants get eval cases. The rest are covered by unit tests on the prompt builder.
- **Risk: a model calls a tool it wasn't given.** That fails `check-no-tool-errors`. The replacement wording is what prevents it, and the new eval cases measure it.
- **Risk: on-demand loading is probabilistic** (ADR-0018). An assigned skill can fail to trigger. Its description is the trigger, so the editor asks for a "Use when…" sentence and shows the catalog entry the model will see.
- **Decision 1: where the skills library lives.** A **Skills** button in the Agent Hub header, next to **New agent**, opening a list page with a skill editor.
- **Decision 2: Visuals is one switch:** `create_visual` and `update_visual` together.
- **Decision 3: the plain assistant and in-app skills.** Skills reach a session only through an agent that has them assigned. The plain assistant keeps only the built-ins, so its prompt and evals don't change with a user's library.
- **Decision 4: limits.** Up to 10 skills per agent; a description of at most 300 characters; a body of at most 20,000; up to 10 reference files of at most 20,000 each. With 10 skills the catalog grows by at most about 4,600 characters.
- **Decision 5: agent transfer (org mode).** When an admin transfers an agent, its Live version keeps its skill copies and keeps working. The draft's skill references are copied into the new owner's library as new skills, renamed on a name clash. It is built last in BA-216.

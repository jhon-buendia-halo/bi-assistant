# BA-222, BA-223 — design (source for specs and code)

Epic BA-213. Decided with the user on 2026-10-14: make the agent page and the way skills reach the model work **as in the agent-poc reference** (`/home/jhonbuendia/projects/agent-poc`, guide `docs/AGENT_CONFIGURATOR_GUIDE.md`; UI in `ui/src/app/agent/` incl. `tabs/system-prompt-tab.*`, `tabs/skills-tab.ts`, `tabs/chat-tab.*`; backend `be/src/mastra/agents/weather-agent.ts`, `be/src/mastra/content/agent-content.ts`). Still on this app's architecture: database storage, per-user agents, the fixed core prompt (only a user agent's instructions are editable), built-in overrides, links (ADR-0023). Decision: ADR-0024 (supersedes ADR-0020).

## 1. BA-223 — skills through Mastra's skill tool

- The `assistant` gets its **on-demand** skills through Mastra's agent-level `skills` option as a **function resolved per request** (`skills: ({ requestContext }) => Skill[]`, Mastra 1.66 `AgentConfig.skills`, `createSkill` from `@mastra/core/skills`). Mastra then adds its own `<available_skills>` system message and its skill tools (in 1.66 check exactly which: `skill`, and possibly `skill_search` / `skill_read`; record the real names) — as the reference does.
- Skills per call:
  - every call: the built-in on-demand skills (`curated-knowledge` today), with an in-app override's content when one exists (ADR-0022);
  - a call bound to a user agent (`agent-skills` on the requestContext): plus the agent's in-app skills (Live copies, or current for a preview), sorted together by name; an agent skill named like a user/project folder skill replaces it.
  - each `createSkill({ name, description, instructions: resolveLinks(body), references: { '<path>': resolveLinks(content) } })` — links resolved to plain mentions (ADR-0023), reference files as `references`.
  - user and project folder skills (ADR-0019) that reach the assistant are given the same way (createSkill from their files, or Mastra's path form), until BA-211 removes them.
- **Removed:** the app-rendered `## Skills` section (agents.md 7.5), `read_file` (3.9), `run_skill_script` (3.10), the `/in-app-skills/` virtual paths, `skillToolsFor`. Workspaces still carry no skills.
- **Harness-loaded skills unchanged:** `deep-analysis` phases and `interactive-visuals` references are still read by code and sent as system messages (they're never in the catalog).
- **Prompt:** identity, `## Tools` (generated from the app's tools; Mastra's skill tools are framework tools and are not listed, like the workspace tools), `## Working rules`. The golden fixture `backend/src/mastra/agents/__fixtures__/assistant-prompt.full.txt` is regenerated (it loses the `read_file` line and the `## Skills` section); agents.md Appendix A is regenerated from `assistantAgent.getInstructions()` the same way.
- **Tool-selection variants** (BA-217) keep working; the `## Tools` lines and working-rule replacements are unchanged apart from the removed `read_file` line.
- Eval runs use the same agent, so they get the same skills. Evals must pass 100% (3 of 3 runs per case) on `claude-sonnet-5`, base vs branch, at the acceptance gate.
- Unit tests: the agent's resolved skills per call (plain: curated-knowledge only; with an override: override content; agent: + its skills; links resolved; references present); `getInstructions()` has no `## Skills`; tools no longer include `read_file`/`run_skill_script`; golden regenerated and stable.

## 2. BA-222 — the agent page as in the reference

Tabs, in this order, ids kept where they exist: **Chat Box** (`chat`, message-square), **System Prompt** (`prompt`, scroll-text — was "Prompt template"), **Skills** (`skills`), **Tools** (`tools`), **Graph** (`graph`), **Memory** (`memory`), **Evals** (`evals`), **LLM Config** (`model`).

- **Default tab:** Chat Box for user agents and for the Official assistant; System Prompt for System agents (they have no Chat Box).
- **Chat Box** (`data-testid="agent-tab-chat"`):
  - user agent: a chat with the agent's **draft** — the existing preview session mechanism (in-memory session, `POST /sessions` with `{ agentId, preview: true }`, discarded on leave, swept on start), the same Session chat component; header `Chat with the draft` and **New chat** (`data-testid="agent-chat-new"`, rotate-ccw) which discards it and starts over. No dataset in the draft → `Add a dataset to this agent to chat with it.` with an **Edit** link. Leaving the agent page discards the chat.
  - Official assistant: `Chats with the assistant run over datasets you choose.` and the **Start chat** button (opens the new-session screen, as today).
  - Needs Use agents to view; sending needs Create agents for a user agent's draft (as the preview does today).
- **System Prompt** (`prompt`):
  - every agent: the core prompt (the assistant's, or the built-in agent's) read-only, as today. For a user agent it sits in a collapsed `<details>` titled `Assistant core prompt (fixed)`, under the agent's own section.
  - user agent: `Agent instructions` rendered with chips (linked-text), and an **Edit** button (create-agents). Editing shows, as the reference: a toolbar with **+ Link skill or tool** (opens the full `/` menu) and the hint `Type / to link a skill or tool. The agent only gets the skills and tools its instructions link.`; the link editor (lazy, ADR-0023); a `Linked:` row of chips (`none` when empty; broken ones `chip-danger`); a broken-link error `No <kind> named <name>. Remove the link or create the skill on the Skills tab.` (plus ` (and others)`); **Cancel** and **Save prompt** (`Saving…`; disabled while saving, when unchanged, or with a broken link). Save writes the draft (PUT draft with the draft's other fields unchanged), toasts `Draft saved`, and the header shows **Unpublished changes** when Live. Leaving with an unsaved edit asks `Discard unsaved changes?`.
  - The agent editor page keeps its Instructions field too (same draft).
- **Skills** (`skills`):
  - user agent: as the reference's Skills tab — the user's library inline: each skill row shows name, description, its linked tools as chips, and a `Linked` (`chip-success`) or `Not linked` (`chip-neutral`) chip for this agent (from the draft's links); **New skill**, **Edit**, **Delete** inline (an inline form in the tab reusing the skill editor's fields and rules, R70-R72; no page change); then the built-in skills section as in the library (read-only rows; an admin's Edit opens the built-in skill editor). Counter `Skills (<n>)` = the agent's linked skills + built-ins it gets.
  - Official and System agents: today's read-only Skills tab (levels, files) stays.
- Rename everywhere: "Prompt template" → "System Prompt" (UI copy; tab id `prompt` kept).

## 3. Tests (unit)
- Frontend: tab order and default tab per agent kind; System Prompt edit → save payload keeps other draft fields; broken-link error disables save; Skills tab Linked/Not linked from links; inline create/edit/delete calls; Chat Box new chat discards and recreates; Official chat box shows Start chat.
- Backend: section 1 list.

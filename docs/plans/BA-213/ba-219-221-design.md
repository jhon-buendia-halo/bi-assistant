# BA-219, BA-220, BA-221 — design (source for specs and code)

Epic BA-213. Decided with the user on 2026-10-14: apply the agent-poc **Agent configurator guide** (`/home/jhonbuendia/projects/agent-poc/docs/AGENT_CONFIGURATOR_GUIDE.md`, reference code in `/home/jhonbuendia/projects/agent-poc/be` and `/ui`) **on this app's architecture**: database storage, per-user agents layered on the fixed assistant core prompt, the app's own skill catalog + `read_file` (ADR-0020), built-in overrides (ADR-0023), Mastra 1.66, Nest CommonJS, Angular 20. Links replace the BA-217 tool checkboxes and the BA-216 skill checkboxes. Decision: ADR-0024.

## 1. Links (BA-219)

- Syntax in saved text: `[[skill:<name>]]` and `[[tool:<name>]]`, regex `/\[\[(skill|tool):([A-Za-z0-9_-]+)\]\]/g` (same in backend and frontend).
- Where: an agent's **instructions** may link skills and tools. An in-app skill's **body** may link tools only (BA-220). Built-in skill bodies and overrides: no links.
- **Linkable skills:** the owner's in-app skills, by name. Built-in skills are not linkable (every agent gets them).
- **Linkable tools:** every assistant tool in the library: `list_entities`, `describe_entity`, `sample_rows`, `run_readonly_sql`, `create_visual`, `update_visual`, `ask_clarification`. (`read_file` and `run_skill_script` are not in the library.)
- **Gating (what a user agent gets):**
  - always: `list_entities`, `describe_entity`, `run_readonly_sql` (linking them is allowed and has no gating effect), plus `read_file` while there are on-demand skills;
  - optional tools = those linked from the instructions **plus** those linked by the linked skills' bodies; linking `create_visual` or `update_visual` gives the `visuals` pair (both);
  - skills = the in-app skills the instructions link (distinct, at most 10).
- **Storage, no migration:** `AgentConfig.instructions` stays the raw text with links. On every create/draft save the backend **derives** and stores `AgentConfig.tools` (optional tool groups linked **directly** from the instructions: `sample_rows`, `ask_clarification`, `visuals`) and `AgentConfig.skills` (ids of the linked in-app skills, resolved by name among the owner's skills). The request's own `tools`/`skills` fields are ignored. Publish still copies the draft and the skills into `liveSkills` (unchanged).
- **Effective selection at call time** (`agentContext`): `config.tools` ∪ the optional tool groups linked by the call's skills (Live: `liveSkills` copies; preview: current skills) → `agent-tools`. A config without `tools` (saved before BA-217) = every tool (unchanged legacy rule).
- **Resolution:** before the model sees text, every link becomes a plain mention: `[[tool:x]]` → `the "x" tool`, `[[skill:x]]` → `the "x" skill`. Applies to Block 5 (agent instructions) and to in-app skill bodies served by `read_file` (`/in-app-skills/<name>/SKILL.md` and reference files). The model never sees `[[`.
- **Validation (Style A refusals on create/draft save, endpoints 41/42):** `Unknown skill "<name>"` (no in-app skill of the owner has that name), `Unknown tool "<name>"`, `An agent can have at most 10 skills` (distinct linked skills). Order: after the name checks; skills before tools.
- **Skills and links (409-style Style A refusals):**
  - Deleting a skill that any of the owner's agents' **drafts** links: `"<name>" is linked by <agent names, comma-separated>. Unlink it first.` (replaces R72's "strip from drafts").
  - Renaming a skill (PUT with a different name) while a draft links it: same message.
  - Live agents keep their `liveSkills` copies either way.
- **Legacy agents in the editor:** when the editor opens a draft whose `tools` is absent, or whose `tools`/`skills` contain items its instructions don't link (a draft saved with BA-216/217 checkboxes), it appends a new last line `Tools and skills: ` followed by a chip for each such item (absent `tools` = `sample_rows`, `ask_clarification`, `create_visual`), and shows the notice `Links were added for what this agent had. Save to keep them.` The form is then dirty.

## 2. Skills link tools (BA-220)

- The skill editor's Body is the rich editor, tools only (menu shows Tools; button `+ Link tool`).
- Skill create/save validation adds, after the existing checks: a `[[skill:…]]` in the body → `Skills can link tools only`; an unknown tool → `Unknown tool "<name>"`.
- `SkillSummary` (api 94) gains `tools: string[]` (tools its body links, sorted, distinct).
- `linkedVia` per tool for an agent: `{ instructions: boolean, skills: string[] }` (skill names, sorted).

## 3. Tabs (BA-221) — agent detail (`GET /agents/:key`, api 34)

- **Tools tab** (user agents): every library tool, sorted by name, with `status: 'always-on' | 'linked' | 'not-linked'` and `linkedVia`. Copy: `Always on`, `Linked`, `Not linked`, `Linked from the instructions`, `Linked by <skill names>`. Built-in agents: unchanged list.
  - API 34 adds `toolLinks?: { name, status, linkedVia: { instructions, skills } }[]` for user agents (from the Live version, else the draft).
- **Graph tab** (new, user agents only; built-in agents show `This agent has no links: it gets all of its tools.`):
  - plain SVG, three columns: Instructions → Skills (linked) → Tools; edges for each link; instructions→tool edges routed over the skills column; tools ordered by the average row of what links to them (port `buildFlowGraph` and `connectedTo` from `agent-poc/ui/src/app/agent/flow-graph.ts` as a pure function with unit tests);
  - hover/focus a node highlights its chain; nodes keyboard-focusable; SVG `<title>`/`<desc>`; a legend (Instructions, Skill, Tool, Always on);
  - `Show unlinked` toggle adds the owner's unlinked skills and the not-linked tools, greyed;
  - under it `What happens on each message`, four steps:
    1. `The assistant's core prompt and this agent's instructions are sent, with links turned into plain mentions.`
    2. `The skill catalog lists the built-in skills and the linked skills; the model reads a skill when a question matches it.`
    3. `The model can call the always-on data tools and the linked tools, including those its linked skills link.`
    4. `Every answer comes from read-only queries over the agent's datasets.`
  - data: the detail's `draft`/`live` instructions, the skills (GET /skills with `tools`), `toolLinks`.
- **LLM Config tab** replaces the **Model** tab (all agents): `Provider`, `Model` (with ` (agent override)` when a user agent sets one), `API key` → `Set` / `Not set` (never the value), `Max output tokens`, `Reasoning effort` (the effective one). Read-only. API 34 adds `llm: { provider, providerName, model, apiKeyConfigured: boolean, maxOutputTokens: number | null, reasoningEffort: string | null }`, `null` fields when no LLM is saved.

## 4. Editor (frontend)

- **Tiptap 3.31.3**, pinned with `--save-exact` (published 2026-09-04): `@tiptap/core`, `@tiptap/pm`, `@tiptap/extension-document`, `-paragraph`, `-text`, `-mention`, `@tiptap/extensions` (UndoRedo), `@tiptap/suggestion`. Port from `agent-poc/ui/src/app/agent/prompt-editor.*` and `prompt-links.ts`, `linked-text.ts`.
- **Lazy:** the editor component is loaded with a dynamic `import()` so Tiptap stays out of the initial bundle.
- Mention node ids `kind:name`; load: each line → paragraph, each link → mention; save: `editor.getText({ blockSeparator: '\n' })` with `renderText` → `[[kind:name]]`. Round-trips exactly.
- `/` opens a grouped menu (Skills, then Tools; up to 6 each), filtered by name or description; ArrowUp/Down, Enter or Tab pick, Esc closes; `/` inside a word (`km/h`) does not open it. Buttons `+ Link skill` and `+ Link tool` (`+ Link tool` only in the skill editor) call `openLinkMenu()`; the first insert goes at the end if the user hasn't clicked into the editor.
- Chips: skill `chip chip-info`, tool `chip chip-neutral`, a link to a missing skill or tool `chip chip-danger` (title `Not found`). Max length counts the saved text (4,000 for instructions, 20,000 for a skill body), with `<n>/<max>` under the editor.
- Accessible: the editor has `role="textbox"`, `aria-multiline="true"` and `aria-label` = the field's label (`Instructions`, `Body`) so tests can target it; the menu is a `role="listbox"` with options.
- The editor hint for instructions: `Added to the assistant's context in every turn. The assistant's own rules and the read-only guard still apply. Type / to link a skill or a tool.` and under the editor: `Linked skills and tools decide what the agent gets. Every agent also gets the built-in skills and can always list, describe and query its datasets.`
- The BA-217 **Tools** fieldset and the BA-216 **Skills** fieldset are removed from the agent editor.
- **Read-only chips:** the Prompt template tab of a user agent (its instructions) and the in-app skills' SKILL.md content on the Skills tab render links as chips (`linked-text`); built-in skills stay plain text.
- jsdom/ProseMirror test stubs: see the guide's "Problems I hit" (stub `Range.prototype.getClientRects`/`getBoundingClientRect`; guard `clientRect?.()`).

## 5. Tests to cover (unit)

- Backend: link parsing/resolution; derive tools/skills on save; unknown skill/tool and 10-cap refusals; effective selection = direct ∪ skill-linked (Live copies vs preview current); visuals pair; skills `Skills can link tools only`, unknown tool, delete/rename while linked refused; `read_file` serves resolved bodies; Block 5 resolved (no `[[`); detail `toolLinks` and `llm` (no key value); legacy (no `tools`) still all tools; golden prompt unchanged.
- Frontend: prompt-links; editor load/save round-trip; `/` mid-word doesn't open; menu filters/groups; legacy line appended; flow-graph layout + connectedTo; LLM Config never renders a key; Tools tab statuses.

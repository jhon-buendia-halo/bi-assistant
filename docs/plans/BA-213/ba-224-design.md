# BA-224 — design (source for specs and code)

Epic BA-213. Decided with the user on 2026-10-14: **every agent's System Prompt is editable, as in the agent-poc reference** (its System Prompt tab: view → Edit → editor → Save prompt). User agents already edit their instructions (BA-222). This story adds the built-in agents: the Official `assistant` and the five System agents (`visualization`, `sql-fixer`, `sql-verifier`, `knowledge-bootstrap`, `assistant-eval-judge`). Decision: ADR-0026 (same override pattern as built-in skills, ADR-0023).

## 1. Storage and resolution
- New **shared** collection `agent_prompt_overrides`, identity `key` (a built-in registry key): `{ key, prompt, baseHash, updatedBy, createdAt, updatedAt }`. `baseHash` = SHA-256 hex of the shipped editable text. An override of a key that is no longer built in is ignored.
- Resolved **per call** through a bridge (like `skill-overrides.ts`), refreshed after save/reset, so a save applies to the next call without a restart. Eval runs, deep analysis, the grounding pass, the designer pipeline, the SQL fixer/verifier and the knowledge bootstrap all use it.
- **Shipped editable text** (what Edit starts from and what Reset restores):
  - `assistant`: the prompt **without** its `## Tools` section — the identity paragraph, a blank line, `## Working rules`, then the rules (ASSISTANT_IDENTITY + ASSISTANT_WORKING_RULES, as `getInstructions()` builds them for the full tool selection).
  - System agents: their static `instructions`, joined with `\n`.
- **Serving the assistant with an override:** the override text, with the generated `## Tools` section (BA-217: the tools the call offers) inserted before the first line that is exactly `## Working rules`, or appended at the end after a blank line when there is none. Links in it are resolved to plain mentions (ADR-0024). The BA-217 rule replacements for unselected tools apply only to blocks of the override that match the shipped block verbatim; an edited block is left as the admin wrote it.
- **Serving a System agent with an override:** the override text replaces its static instructions. Structured-output schemas, harness-loaded skills (`interactive-visuals`) and per-call instruction overrides (e.g. the tool-only synthesis pass, agents.md 5.5) are unchanged.
- **No override:** every prompt is byte-identical to today (the golden fixture passes untouched).
- User agents keep running on the assistant: an assistant override changes their core prompt too.

## 2. Links
- The `assistant` override may contain `[[tool:<name>]]` links (library tools, ADR-0024) shown as chips; they are **mentions only**: the assistant keeps all its tools (user agents gate their own tools through their instructions; gating the base would strip every agent). No `[[skill:…]]` (in-app skills are private; the prompt is shared).
- System agent overrides: no links (they have no tools).

## 3. API (endpoints 103-104, `edit-policies`; reading stays on 34 with `use-agents`)
- `GET /agents/:key` (34) adds for built-in agents `prompt: { editable: string /* as served: override or shipped */, shipped: string, modified: boolean, builtInChanged: boolean, linksAllowed: boolean /* true for assistant */, updatedAt: string | null }`; `instructions` (the flattened prompt as served) reflects an override.
- `PUT /agents/:key/prompt` body `{ prompt: string }` → `{ ok:true, message:"System prompt of \"<name>\" saved", agent: AgentDetail }`. Refusals (Style A, first that applies): `"Agent \"<key>\" not found"`; `"Only built-in agents have a shared system prompt; edit a user agent's instructions instead"` (user-agent id); `"The prompt is empty"`; `"The prompt is at most 20,000 characters"`; assistant only: `"The assistant's prompt must start with \"You are the Questions to Insights assistant\""`, `"Skills can't be linked here: this prompt is shared by every user"` (a `[[skill:…]]`), `"Unknown tool \"<name>\""`; System agents: `"This agent's prompt can't contain links"` (any `[[…]]`).
- `DELETE /agents/:key/prompt` → `{ ok:true, message:"System prompt of \"<name>\" reset", agent }`, also when there was no override; `"Agent \"<key>\" not found"`, the user-agent refusal.
- Routes declared before `/agents/:key` catch-alls as needed; permission `edit-policies` for both.

## 4. UI — System Prompt tab of a built-in agent (`prompt`)
- Header line: `Built-in` chip, `Modified` (`chip chip-warning`) when overridden.
- View: the prompt as served (read-only `pre`, as today); for the assistant, links as chips (linked-text).
- With `edit-policies`: **Edit** (`data-testid="agent-prompt-edit"`), and while modified **Reset to built-in** (`data-testid="agent-prompt-reset"`, rotate-ccw, confirm `Reset the system prompt of "<name>" to the built-in version?`).
- Editing: a warning banner (`warning-soft`): `Changes apply to every session and agent as soon as you save. Run the evals to check them.`; for the assistant the link editor (lazy, tools only: `+ Link tool`, hint `Type / to link a tool. Links here are mentions; the assistant keeps all its tools.`) and a read-only note `The ## Tools list is generated from the tools the assistant gets and is inserted before ## Working rules.`; for System agents a plain monospace `textarea` (16 rows) with `<n>/20,000`. **Cancel** and **Save prompt** (`Saving…`; disabled while unchanged, empty or saving). Save toasts the backend message. Unsaved edit → `Discard unsaved changes?` on leave (existing guard).
- Drift: when `builtInChanged`, the notice `The app's built-in version changed since this was edited. Review it, then save again or reset.` with **Show the built-in version** (read-only shipped text).
- Without `edit-policies`: read-only, no Edit/Reset.
- User agents: unchanged (BA-222).

## 5. Tests (unit)
- Backend: no override → byte-identical (golden) for assistant and each System agent; save → next call's instructions; assistant Tools insertion (with/without `## Working rules`), links resolved, tool-selection replacements only on verbatim blocks; every refusal in order; reset; builtInChanged; permission metadata; evals/designer/fixer use the override (resolver-level test).
- Frontend: Edit/Cancel/Save prompt/Reset flows, permission gating, link editor for assistant vs textarea for System agents, drift notice, unsaved guard.

# BA-224 addendum — the shipped assistant prompt links its tools and skill

Asked by the user on 2026-10-14: "update the system prompt to link the skills and tools correctly with a /". As the agent-poc guide says for an existing agent ("turn plain-text tool mentions into `[[tool:…]]` links"), the **shipped** assistant prompt (`ASSISTANT_WORKING_RULES` in `backend/src/mastra/agents/assistant-prompt.ts`) writes every tool mention as a link, and links the built-in skill it relies on. In the editor they are chips; the model sees plain mentions (`the "x" tool`, `the "x" skill`, ADR-0024).

## 1. Exact line changes in ASSISTANT_WORKING_RULES (everything else stays byte-identical)

| Line now | Becomes |
|---|---|
| `'Call ask_clarification only when interpretations diverge materially —',` | `'Call [[tool:ask_clarification]] only when interpretations diverge materially —',` |
| `'then the options must quote the actual values you found (via sample_rows',` | `'then the options must quote the actual values you found (via [[tool:sample_rows]]',` |
| `'/ describe_entity), not invented ones. When only the scope is fuzzy —',` | `'/ [[tool:describe_entity]]), not invented ones. When only the scope is fuzzy —',` |
| `'1. Map the question to concrete entities and columns (list_entities,',` | `'1. Map the question to concrete entities and columns ([[tool:list_entities]],',` |
| `'   describe_entity; sample_rows when value formats are unclear).',` | `'   [[tool:describe_entity]]; [[tool:sample_rows]] when value formats are unclear).',` |
| `'2. Run the analysis yourself with run_readonly_sql. Prefer aggregations',` | `'2. Run the analysis yourself with [[tool:run_readonly_sql]]. Prefer aggregations',` |
| `'  dates, winners — must come from run_readonly_sql results you actually',` | `'  dates, winners — must come from results of [[tool:run_readonly_sql]] you actually',` |
| `'- run_readonly_sql and sample_rows both take a rationale. Write it in the',` | `'- [[tool:run_readonly_sql]] and [[tool:sample_rows]] both take a rationale. Write it in the',` |
| `'  extend a visual, call update_visual (open visual by default) with a',` | `'  extend a visual, call [[tool:update_visual]] (open visual by default) with a',` |
| `'- When the user asks for a chart/visual of an answer, call create_visual.',` | `'- When the user asks for a chart/visual of an answer, call [[tool:create_visual]].',` |
| `'  run_readonly_sql when the session spans more than one datasource.',` | `'  [[tool:run_readonly_sql]] when the session spans more than one datasource.',` |
| `'- Sample values shown by describe_entity are real stored values — use',` | `'- Sample values shown by [[tool:describe_entity]] are real stored values — use',` |
| `"  them to match the user's phrasing to the values in the data. A curated",` + next line `'  [term] outranks your own reading of those values when they conflict.',` | `"  them to match the user's phrasing to the values in the data. A curated",` + `'  [term] (see [[skill:curated-knowledge]]) outranks your own reading of those values when they conflict.',` |
| `'  session context and describe_entity alone: answer without running any',` | `'  session context and [[tool:describe_entity]] alone: answer without running any',` |

(Check the exact current text of the `[term] outranks…` line in the file and keep it, only inserting ` (see [[skill:curated-knowledge]])` after `[term]`.)

The model therefore reads e.g. `Call the "ask_clarification" tool only when…`, `(via the "sample_rows" tool / the "describe_entity" tool)`, `A curated [term] (see the "curated-knowledge" skill) outranks…`. The prompt sent to the model changes (golden fixture and agents.md Appendix A regenerated); the evals must pass at 100% at the acceptance gate.

## 2. BA-217 replacements follow the linked text
The tool-selection replacements (agents.md 2.1) are defined against the shipped text, so they now match and produce the linked forms: without `sample_rows`, step 1 reads `([[tool:list_entities]],` / `   [[tool:describe_entity]]).`, A5 reads `…you found (via` / `[[tool:describe_entity]]), not invented ones. …`, A19 reads `- [[tool:run_readonly_sql]] takes a rationale. Write it in the`. The clarification-off and visuals-off replacement texts are unchanged (they name no tool). Links are resolved after the replacements.

## 3. Built-in skills can be linked (as mentions)
- `[[skill:<name>]]` may name a **built-in on-demand skill** (`curated-knowledge` today) in: the assistant's prompt (shipped and overrides) and a user agent's instructions. It never gates anything (every agent gets the built-ins); it resolves to `the "<name>" skill`.
- Assistant override validation: `[[skill:<name>]]` is accepted when `<name>` is a built-in on-demand skill; any other skill name → `"Only built-in skills can be linked here: this prompt is shared by every user"` (replaces the earlier `Skills can't be linked here…` message).
- User agent instructions: a built-in on-demand skill link is accepted and doesn't count toward the 10-skill limit or `skills`; other names still resolve against the owner's in-app skills (`Unknown skill "<name>"` otherwise).
- The `/` menu's **Skills** group lists the built-in on-demand skills (marked with a `Built-in` suffix in the option) after the user's skills — in the assistant prompt editor only the built-ins. `+ Link skill or tool`/`+ Link tool` stay; the assistant editor gets `+ Link skill or tool`.

## 4. The assistant's System Prompt view shows chips
- Read-only view of the Official assistant: render `prompt.editable` with chips (linked-text), and in place of `## Tools` a muted note `## Tools — generated from the tools the assistant gets` (the generated list itself stays visible in a collapsed `<details>` `Prompt as sent to the model` showing `instructions`).
- The Graph tab of the Official assistant shows its prompt's links (instructions → skill/tools) with every tool `Always on`/linked; the message `This agent has no links…` stays only for System agents.

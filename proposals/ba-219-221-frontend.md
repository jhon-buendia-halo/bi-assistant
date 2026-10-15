# BA-219 / BA-220 / BA-221 frontend report

All paths under `frontend/src/app/features/agents/` unless noted.

## Result
- `npm run build`: passes. Initial total 924.68 kB (main 685.85 + shared framework chunk 160.91 + styles 43.33 + polyfills 34.59). Base commit (HEAD, built from `git archive`) was 868.16 kB. Tiptap is NOT in the initial bundle: it is in the lazy chunk `chunk-OPHFGGGO.js` (prompt-editor, 346.08 kB raw / 94.86 kB transfer); no "prosemirror"/"tiptap" string in main or the shared chunk. The +56 kB initial growth is app code (the working tree also carries the uncommitted BA-216 skill library/editors, plus the new graph, tool-links, llm-config, linked-text, flow-graph) and the Angular runtime pieces now hoisted into the shared chunk by `@defer`; the 500 kB budget warning is unchanged.
- `ng test` (Karma, ChromeHeadless): 363 run, 1 failure, the pre-existing `App should support keyboard resizing from the separator`. No jsdom stubs were needed (real Chrome).
- package.json: tiptap 8 packages pinned exactly at 3.31.3 (package-lock.json untouched).

## Added
- `services/prompt-links.ts` (+spec): regex, `linkedNames`, `promptSegments`, `chipClass`, `knownLinks`, `withLegacyLinks`, `LINKABLE_TOOLS` (7 tools with descriptions).
- `services/flow-graph.ts` (+spec): ported `buildFlowGraph` / `connectedTo` (input: instructions, owner skills with tools, `toolLinks`).
- `components/prompt-editor/` (.ts/.html/.scss +spec): Tiptap editor; `/` menu (Skills then Tools, up to 6 each, filter by name/description, Arrow/Enter/Tab/Esc), `+ Link skill` / `+ Link tool` buttons, `<n>/<max>` count, max-length enforced by undoing an over-limit edit, role/aria per design.
- `components/linked-text/` (+spec): read-only chips.
- `components/agent-graph/` (+spec): SVG graph, Show unlinked toggle, legend, "What happens on each message" (4 steps).
- `components/agent-tool-links/` (+spec): Tools tab for user agents.
- `components/agent-llm-config/` (+spec): LLM Config tab (never renders a key).

## Changed
- Agent editor (`agent-editor.ts/.html`, `agent-editor.util.ts`, `agent-editor.service.ts`): Tools and Skills fieldsets and the `tools`/`skills` form fields removed; instructions are the lazy link editor (`@defer (on immediate)`), hint copy per design, legacy notice (`data-testid="agent-legacy-notice"`), `legacyInstructions()` appends `Tools and skills: ...` and the form is dirty; save payload has no `tools`/`skills`. `openSkills` output removed from the editor and from `app.html`.
- Skill editor: Body is the editor with tools only (`skill-body-count` test id kept).
- Agent detail: Prompt template chips for user agents (`agent-instructions` test id), Tools tab uses `toolLinks` for user agents, new Graph tab (id `graph`, after Skills; built-in agents show the no-links message), Model tab renamed label `LLM Config` (id kept as `model`).
- Agent skills tab: in-app skill files render links as chips (`skill-file-content`).
- API types: `AgentDetail.toolLinks?`, `AgentDetail.llm?`, `SkillSummary.tools`.
- Specs updated: editor util/service specs (legacy, no tools/skills sent), skill summary fixtures.

## Deviations / notes
- Tab id for LLM Config stays `model` (`agent-tab-model`, matches ui.md and existing e2e); only the label changed.
- `+ Link skill` / `+ Link tool` call `openLinkMenu(kind)` and narrow the menu to that kind (design says plain `openLinkMenu()`); `/` shows both.
- The Graph tab always draws the always-on tools (green "Always on" nodes) even without Show unlinked; unlinked skills and not-linked tools appear with the toggle. Nodes are focusable `role="img"` (no click navigation, there is no router).
- Suggestion items are async in Tiptap 3, so tests await a tick after typing `/`.
- Legacy detection treats `visuals` as linked if either `create_visual` or `update_visual` is linked; absent `tools` maps to sample_rows, ask_clarification, create_visual.
- Initial bundle: see above; I could not isolate the share of the +56 kB owed to pre-existing uncommitted work.

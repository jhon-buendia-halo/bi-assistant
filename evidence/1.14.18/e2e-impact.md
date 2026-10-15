# 1.14.18 (BA-231) — E2E impact analysis (workflow step 6)

Story: agents choose what the right panel shows (`show_in_panel`, kinds file / document / table / visual), panel items saved per session, the Session panel and its "Shown in this session" history, the workflow bar driven by `update_workflow` and the `## Workflow` prompt section, the Details dropdown and the one-line `Your next step:` row, skill and tool steps while streaming, the session id with a copy button (sessions-chat R62).

Base commit: `origin/main` (`ed2069b`, v0.33.0). Branch: `feat/BA-213-agent-tools-skills`.

## Components touched

The story's commit is `ae65b8a feat(BA-231)`. Parts of its frontend wiring landed in commits labelled for sibling stories on the same branch (`0ae1a03`, `cac3cf8`, `ba491d7`): `app.html` / `app.ts` (right-panel wiring, `onPanelItem`, `loadLatestPanelItem`, the bar's place under the header, the session id button) and `session-chat` (the `panel-item` and `workflow` stream callbacks, skill-step labels, tool input from the start).

| Layer | Component / module | What changed |
|---|---|---|
| Backend tools | `mastra/tools/panel.tool.ts`, `mastra/tools/workflow.tool.ts`, `mastra/tool-services.ts`, `mastra/agent-links.ts` | New always-on tools `show_in_panel` and `update_workflow`, listed in the Tools library |
| Backend prompt | `mastra/workflow-section.ts`, `assistant-prompt.ts`, `system-prompts.ts`, `assistant.agent.ts`, the seven `rfp-*` skills | The `## Workflow` parser and the Right panel / Workflow prompt rules |
| Backend sessions | `sessions.service.ts`, `panel-items.ts`, `workflow-update.ts`, `workspace-files.ts`, `entities/session.entity.ts` | Panel items saved on the session, the workflow state and view, the `panel-item` / `workflow` stream events, the `tool` event's `input`, the RFP stage auto-drive |
| Backend API | `sessions.controller.ts` | `GET /sessions/:id/panel-items/:itemId/file` (106) and `.../download` (107) |
| Frontend panel | `session-panel`, `panel-document-view`, `panel-file-view`, `panel-table-view`, `interactive-visual-panel` (history menu projected into its header) | The Session panel, its views, the history menu, Download / Download as… |
| Frontend bar | `workflow-bar` | The bar, Details, the next-step row, the step popover, fold persisted per browser |
| Frontend shell and chat | `app.html` / `app.ts`, `session-chat`, `sessions-api.service`, `session.model`, `prompt-links.ts` | Right-panel wiring, stream events, skill and tool steps, the session id button |

Helpers checked for copy or test ids the story changes (retrospective 1.13.13): `helpers/app-actions.ts` `createWorldCupSession` reads the session id from `data-testid="session-id"`'s `aria-label` (`Copy session ID <id>`), which this story introduced and which still holds. No helper waits on removed copy.

## Decisions per scenario

### Agent panel — `specs/capabilities/agent-panel/spec.md` → `frontend/e2e/agent-panel.spec.ts` (new)

| # | Scenario | Decision | Fails on `origin/main` because |
|---|---|---|---|
| 1 | A composed document opens in the panel and downloads as PDF | Add | `show_in_panel` doesn't exist there; the panel never opens and there is no Download PDF |
| 2 | A query result shows as a sortable table | Add | same: no table item, no panel table, no CSV download |
| 3 | A workspace file opens in the panel with a download | Add | same; route 106 does not exist |
| 4 | An invalid path is refused and the panel does not change | Add | the first turn's document never shows, and the tool error does not exist |
| 5 | The agent brings an existing visual back | Add | no `visual` kind; the visual header has no "Shown in this session" menu |
| 6 | The workflow never appears in the right panel | Add | no workflow bar (`data-testid="workflow-bar"`), no `update_workflow` |
| 7 | The agent guides me through the current phase | Add | no bar, no next-step row, no Details |
| 8 | Details lists every step and closes on Escape, outside click and its button | Add | no Details dropdown |
| 9 | Every session shows the workflow bar, empty until there is a workflow | Add | no bar in any session |
| 10 | The workflow bar shows my agent's steps from the first turn | Add | no `## Workflow` parser, no bar |
| 11 | The agent moves the workflow bar as we go | Add | no `update_workflow`, no `workflow` stream event |
| 12 | Every open step says what needs to be done | Add | no default actions, tooltips or popover |
| 13 | An agent without a Workflow section creates its own steps | Add | no `update_workflow` |
| 14 | The agent can't rename prompt-defined steps | Add | the tool and its error don't exist (the model gets an unknown-tool error instead) |
| 15 | I can fold the workflow bar | Add | no bar, no `Hide workflow` |
| 16 | Shown items survive reopening the session | Add | no panel items saved, no history menu |

Every test checks the specific BA-231 behaviour (the item in the panel, the bar's state, the exact tool error), so each fails on the base commit at its first BA-231 assertion. I didn't run them on a base build: that needs a second `build:all` of `origin/main` in its own checkout, and the other agents are using `backend/dist`. The table above gives the reasoning instead.

Two Gherkin lines disagree with the system specs. The tests follow the system specs:
- Scenario 3 says `its Download button has the title "Download file"`, but R11 and ui.md 4.13 (changed 2026-10-14) say a `.md` file downloads as PDF with the title `Download PDF` and offer Markdown under `Download as…`. The test checks R11. The Gherkin line needs updating.
- Scenario 10 says the bar shows `"Understand" as current`, but R17, ui.md 4.12.1 and data-model 3.4.4 (`current: null` until the agent marks a step) say no step is current before the first `update_workflow`, and the next step is the first open one. The app follows the system specs, and so does the test (all steps `upcoming`, none `aria-current`, `Your next step:` shows step 1's action). Either the Gherkin line changes, or the app and the system specs change. This is a decision for the user.

### Session management — `specs/capabilities/sessions-chat/spec.md`

| Scenario | Decision | Spec file |
|---|---|---|
| I copy the session id to share it (R62, new Gherkin) | Add | `frontend/e2e/session-management.spec.ts` (new; the Feature's other scenarios still have no E2E) |

It fails on `origin/main` because the page header has no session id button (`data-testid="session-id"`).

### Existing specs that render the chat, the right panel or the tool list (owned by other agents; not edited)

| Spec file (Feature) | Scenarios | Decision | Why it is impacted |
|---|---|---|---|
| `chat-and-visuals.spec.ts` (Chat and visuals) | 2 | Re-run as-is | Thinking block tool steps now show their input; the visual panel now sits inside the Session panel with the history menu projected into its header |
| `agent-sessions.spec.ts` (Sessions started from an agent) | 6 | Re-run as-is | User-agent turns now carry `show_in_panel` / `update_workflow` and the bar; the session header gained the id button |
| `assistant-skills.spec.ts` (Skills the assistant is given) | 5 | Re-run as-is; **update suggested** | The prompt's `## Tools` lists the two new tools and the Workflow block. The skill step label (`Using skill: <name>`, `data-testid="skill-step"`) is BA-231 scope with no Gherkin or E2E: "the assistant loads a skill with the skill tool" could also check the step while the turn streams |
| `designer-skills.spec.ts` (Skills the designer is given) | 2 | Re-run as-is | Generating a visual now adds a `visual` panel item and opens the Session panel |
| `chat-clarification.spec.ts` (Chat answers and reliability signals) | 2 | Re-run as-is | Same chat view, now with the bar above it |
| `llm-settings.spec.ts` | uses `createWorldCupSession` | Re-run as-is | Uses the session-id helper |
| `navigation.spec.ts` (app shell) | "shows the details panel only on demand" | Re-run as-is | The right panel defaults closed; the Session panel is its body in a chat |
| `layout-accessibility.spec.ts` (app shell) | 4 | Re-run as-is | The axe scan of every screen now includes the workflow bar and Session panel |
| `agent-editor.spec.ts` | preview chat | Re-run as-is | The preview chat in the Details panel is the session chat |

No scenario is deleted. Desktop is not run: none of these scenarios calls `desktopOnly()`.

## Results (step 9)

- New tests: `e2e-results.txt`, 17 passed (16 Agent panel plus "I copy the session id to share it"). They also passed 3 times in a row (`--repeat-each=3`, 51 of 51).
- Re-run as-is: `e2e-rerun-results.txt`, 63 passed in the 9 listed spec files, run read-only on the working tree as the other story agents left it.
- Shared helper change, additive only: `helpers/llm-stub.ts` gains an optional `hold(request)` that delays one reply. The tests use it to check the panel and the bar while a turn still streams.
- Desktop not run: no scenario here calls `desktopOnly()`.

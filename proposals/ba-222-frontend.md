# BA-222 frontend report

Result: build OK, initial total 950.78 kB (was 924.68 kB, +26 kB). Tiptap stays in the lazy `prompt-editor` chunk (346.73 kB). `ng test`: 380 run, 1 failure, the allowed `App should support keyboard resizing from the separator`.

## Changed
- app/app.ts, app/app.html: `closeAgentDetail()` (Back asks first), unsaved-edit guard on `agent-detail` via `AgentPageState`, `openAgentEditor` now asks before leaving, `openBuiltInSkillEditor(name, fromAgent)` + `closeBuiltInSkillEditor()` (Back returns to the agent page when opened from its Skills tab).
- agents/components/agent-detail (.ts/.html): tab order/labels from `AGENT_TAB_ORDER`, default tab per kind (set on first load only), Chat Box / System Prompt / user Skills panels stay mounted (hidden) so edits and the chat survive tab switches, `Skills (<n>)` for user agents = linked skills + built-ins, loads built-ins, `openBuiltInSkill` output, user instructions now draft-first (was live-first).
- agents/components/prompt-editor (.ts/.html): `toolbar="single"` + `toolbarHint` inputs (one `+ Link skill or tool` button, `data-testid="link-any"`). Default toolbar unchanged.

## Added
- components/agent-system-prompt: Edit / toolbar / Linked row / broken-link error / Cancel / Save prompt (testids `prompt-edit`, `prompt-links`, `prompt-link-error`, `prompt-cancel`, `prompt-save`, `agent-instructions`, `agent-core-prompt`); toast `Draft saved`.
- components/agent-skills-inline: inline library (testids `agent-skill-new`, `agent-skill-form`, `agent-skill-save`, `agent-skill-cancel`, `agent-skill-row-<n>`, `agent-skill-linked-<n>`, `agent-skill-edit-<n>`, `agent-skill-delete-<n>`, `agent-builtin-skill-<n>`, `agent-builtin-edit-<n>`); reuses `SkillEditorService`, skill-editor util and prompt-editor.
- components/agent-chat-box: preview session per agent page (`agent-chat-new`, `agent-chat-no-dataset`, `agent-chat-edit`, `agent-chat-start`).
- services/agent-page.util.ts, services/agent-page-state.service.ts (+ specs for util, system-prompt, skills-inline, chat-box).

## Deviations / notes
- The Chat Box uses its own preview session in the component, not `AgentEditorService`. Session chat is inline in the tab (not the Details panel). A dataset-less draft is detected from the backend's `Select at least one dataset to preview` answer.
- Built-in Edit shows with `edit-policies` (the permission the built-in editor needs for Save), not a separate admin check.
- Inline skill Delete is always enabled (backend R72 confirm text with agents using it), unlike the reference, which blocks deleting linked skills.
- The old Details-panel eval trace is untouched. Old testids kept: `agent-tab-<id>`, `agent-instructions`, `agent-edit`.
- Pre-existing build warnings unchanged (NG8102 in eval scores, bundle budget).

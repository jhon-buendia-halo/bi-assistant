# BA-224 frontend report

Files: services/agents-api.service.ts (AgentPromptView, `prompt?` on AgentDetail, savePrompt/resetPrompt), components/agent-system-prompt/agent-system-prompt.{ts,html} (built-in branch), components/prompt-editor/prompt-editor.html (hint now shown in both toolbar modes), new agent-system-prompt-builtin.spec.ts (8 tests).
Results: build ok, initial total 958.11 kB (was 950.78; Tiptap still lazy via @defer). ng test: 387 pass, only the allowed keyboard-resizing failure.
Test ids: agent-prompt-edit/reset/save/cancel/banner/textarea/count/modified/drift/show-shipped/shipped/tools-note/editing/view.
Deviations: view shows `instructions` (as served) through linked-text, so chips only appear if links remain in served text (backend resolves them to mentions). agent-detail needed no change (existing `saved` -> reloadAgent). Unsaved guard reuses promptDirty.

# 1.14.9 Agent page: Chat Box, editable System Prompt and Skills tabs (BA-222): E2E impact (step 6)

Base commit: `origin/main` (`ed2069b`): the agent page opens on a read-only Prompt tab; there is no Chat Box, no in-place edit and no inline skill library.

## Touched → scenarios

| Touched (commit `aa6a4e8`) | Scenarios |
|---|---|
| `agent-detail` (tab order, default tab), `agent-page.util.ts` | Agents: *Opens an agent … tabs*; Agent Hub: *A card opens the agent's detail view*; Agent editor: *Reset and leaving the editor discard the preview* |
| `agent-chat-box` | Agent editor: *The Chat Box tab chats with the draft…*, *The Chat Box needs a dataset*, *The Official agent's Chat Box offers Start chat*; Sessions started from an agent: *Only Live agents and the Official agent offer Start chat* |
| `agent-system-prompt` (user part), `agent-page-state.service.ts` | Agent editor: *Editing the System Prompt in place…*, *A broken link disables Save prompt*, *Leaving an unsaved System Prompt edit asks first* |
| `agent-skills-inline` | Agent editor: *The Skills tab shows what is linked and creates a skill inline*; Agent skills: *A user agent's Skills tab is its inline library* |

## Decisions

| Decision | Scenario | Spec file | Why it fails on base |
|---|---|---|---|
| Add | Agent editor: Editing the System Prompt in place saves a draft with the link | `frontend/e2e/agent-editor.spec.ts` | no Chat Box (the first assertion), no `prompt-edit` |
| Add | Agent editor: A broken link disables Save prompt | `agent-editor.spec.ts` | no in-place editor |
| Add | Agent editor: Leaving an unsaved System Prompt edit asks first | `agent-editor.spec.ts` | no in-place editor |
| Add | Agent editor: The Chat Box tab chats with the draft, and New chat starts over | `agent-editor.spec.ts` | no Chat Box tab |
| Add | Agent editor: The Chat Box needs a dataset | `agent-editor.spec.ts` | no Chat Box tab |
| Add | Agent editor: The Official agent's Chat Box offers Start chat | `agent-editor.spec.ts` | no Chat Box tab |
| Add | Agent editor: The Skills tab shows what is linked and creates a skill inline | `agent-editor.spec.ts` | no `/skills`, no inline library |
| Add | Agent skills: A user agent's Skills tab is its inline library, not the read-only list | `frontend/e2e/agent-skills.spec.ts` | no `/skills`; base shows the read-only list |
| Update (already on the branch) | Agents: Opens an agent … tabs (Chat Box first, System Prompt via `agent-tab-prompt`) | `agents.spec.ts` | base opens on the Prompt tab |
| Update (already on the branch) | Agent Hub: A card opens the agent's detail view with its actions (`agent-edit`, `agent-start-chat` test ids: the Chat Box's Start chat would match the name) | `agent-hub.spec.ts` | — (selector change only; passes on base too) |
| Update (already on the branch) | Agent editor: Reset and leaving the editor discard the preview (also leaves the agent page, whose Chat Box holds its own preview) | `agent-editor.spec.ts` | — (passes on base too: it only adds a navigation step) |
| Re-run as-is | Agent skills: the 3 built-in scenarios; Sessions started from an agent: Only Live agents and the Official agent offer Start chat | `agent-skills.spec.ts`, `agent-sessions.spec.ts` | — |
| Delete | none | — | — |

Counts: Add 8, Update 3 (already on the branch; two of them are selector or navigation changes that pass on base too), Re-run as-is 4, Delete 0.

Results: [e2e-results.txt](e2e-results.txt). Screenshots: [agent-system-prompt-editing.png](agent-system-prompt-editing.png), [agent-chat-box-answer.png](agent-chat-box-answer.png), [agent-skills-tab-linked.png](agent-skills-tab-linked.png). Desktop not run.

# 1.14.6 Link skills and tools in an agent's instructions (BA-219): E2E impact (step 6)

Base commit: `origin/main` (`ed2069b`). [base-probes.txt](base-probes.txt) shows base saving `Use [[tool:sample_rows]] and [[skill:gone]].` without a refusal, with every tool still on and no `toolLinks`.

## Touched → scenarios

| Touched (commit `0f3a14e`, `807a796`) | Scenarios |
|---|---|
| `mastra/agent-links.ts`, `user-agents.service.ts` (derive tools and skills from links, refusals, 10-skill cap) | Agent definitions (API): *Tools and skills are derived from the links*, *Unknown links are refused*, *A skill that an agent's draft links can't be deleted or renamed* |
| `prompt-editor` (Tiptap, `/` menu, chips), `prompt-links.ts`, agent editor (Instructions field, legacy links line, `+ Link` buttons) | Agent editor: every scenario (the Instructions field is now the link editor), in particular *A slash inside a word…*, *An unknown link is refused*, *An agent saved before links gets a links line*, the axe scan |
| skills service (linked skill can't be deleted or renamed) | Skill library: *A skill that an agent links can't be deleted or renamed* |
| Block 5 (links as plain mentions) | Agent editor: *A linked skill reaches the preview…* (asserts no `[[`) |

## Decisions

| Decision | Scenario | Spec file | Why it fails on base |
|---|---|---|---|
| Add | Agent editor: A slash inside a word does not open the link menu | `frontend/e2e/agent-editor.spec.ts` | base's Instructions is a plain text area: no link menu opens on " /" |
| Add | Agent editor: An unknown link is refused | `agent-editor.spec.ts` | base has no chips and saves `[[skill:gone]]` (base-probes.txt) |
| Add | Agent editor: An agent saved before links gets a links line | `agent-editor.spec.ts` | base adds no `Tools and skills:` line and no notice |
| Add | Skill library: A skill that an agent links can't be deleted or renamed | `frontend/e2e/skill-library.spec.ts` | no skills library on base |
| Add | Agent definitions (API): Tools and skills are derived from the links; Unknown links are refused; A skill that an agent's draft links can't be deleted or renamed | `backend/test/user-agents.e2e-spec.ts` | base parses no links and has no `/skills` |
| Shared | Only linked tools are offered (held in [../1.14.2/](../1.14.2/)); A linked skill reaches the preview (held in [../1.14.4/](../1.14.4/)) | `agent-editor.spec.ts` | — |
| Re-run as-is | Agent editor: Creates an agent…, Sending in the preview saves the form first, Editing a Live agent…, and the axe scan (fills the Instructions link editor with `getByLabel('Instructions').fill`, which works on the contenteditable) | `agent-editor.spec.ts` | — |
| Delete | none | — | — |

Two scenarios needed a state the API no longer produces (a link to a skill that doesn't exist, a draft with no `tools` field). The test writes it into the app's SQLite file (`patchAgentDoc` in `agent-editor.spec.ts`), as the Gherkin's Given describes.

Counts: Add 4 Playwright + 3 API, Re-run as-is 4 (plus the rest of the file), Delete 0.

Results: [e2e-results.txt](e2e-results.txt). Screenshot: [agent-editor-skill-chip.png](agent-editor-skill-chip.png) (the `fiscal-calendar` chip in the editor's Instructions). Desktop not run.

# 1.14.10 Skills reach the model through Mastra's skill tool (BA-223): E2E impact (step 6)

Base commit: `origin/main` (`ed2069b`): the assistant's prompt carries a `## Skills` section, the model is offered `read_file` (see the base agent detail's tools in [../1.14.6/base-probes.txt](../1.14.6/base-probes.txt)) and not the framework's `skill` tool.

## Touched → scenarios

| Touched (commit `aa6a4e8`) | Scenarios |
|---|---|
| `assistant-skills.ts` (skills per request via `createSkill`), `assistant-prompt.ts` (no `## Skills`), `assistant.agent.ts` (no `read_file`, `run_skill_script`) | Skills the assistant is given: all 5; Agent editor: *A linked skill reaches the preview…* (loads the skill with the skill tool); Sessions started from an agent: *The agent's tool selection and skills apply to every turn* |
| `interactive-visuals`/`deep-analysis` harness-loaded (unchanged) | Interactive Visual Designer skills: `designer-skills.spec.ts` (2); Agent skills: *The assistant gets only its built-in skills…* (`Skills (2)`) |
| shared prompt builder | Chat answers (2), Chat and visuals (2), World Cup workflow |

## Decisions

| Decision | Scenario | Spec file | Why it fails on base |
|---|---|---|---|
| Update (already on the branch) | Skills the assistant is given: The assistant is offered only its own skills (no `## Skills`, `skill` offered, no `read_file`/`run_skill_script`) | `frontend/e2e/assistant-skills.spec.ts` | base's prompt has `## Skills` and offers `read_file` |
| Update (this gate) | Skills the assistant is given: A skills folder left in the data dir by an older version is ignored. The branch's version checked only the catalog; it now also asserts the Gherkin's "no `## Skills` section" and "offered the framework's skill tool" | `assistant-skills.spec.ts` | base's prompt has `## Skills` and offers no `skill` tool |
| Delete + Add (already on the branch) | "The assistant reads a skill's files with read_file, and only those" replaced by "The assistant loads a skill with the skill tool" | `assistant-skills.spec.ts` | base offers no `skill` tool, so the scripted call fails |
| Shared | A linked skill reaches the preview (held in [../1.14.4/](../1.14.4/)); tool selection and skills apply to every turn (held in [../1.14.2/](../1.14.2/)) | — | — |
| Re-run as-is | Skills the assistant is given: the 2 curated-knowledge scenarios; Designer skills 2; Agent skills 3; Chat answers 2; Chat and visuals 2; World Cup workflow | `assistant-skills.spec.ts`, `designer-skills.spec.ts`, `agent-skills.spec.ts`, `chat-clarification.spec.ts`, `chat-and-visuals.spec.ts`, `world-cup-workflow.spec.ts` | — |

Counts: Update 2 (one completed in this gate), Delete 1 + Add 1 (a replacement, already on the branch from commits `ed1f4cc`/`ae65b8a`), Re-run as-is 12.

Results: [e2e-results.txt](e2e-results.txt). Desktop not run.

# 1.13.9 — E2E impact analysis (step 6)

Touched: the `assistant` agent's prompt and tools (`assistant.agent.ts`, the new `assistant-prompt.ts` and `skill-tools.ts`), and `app-skills.ts` (catalog, wrapped descriptions). Every assistant call changes, so the full suite re-runs.

| Feature (spec) | Scenario | Decision |
|---|---|---|
| Skills the assistant is given (`assistant-skills.spec.ts`) | The assistant is offered only its own skills | **Update**: the prompt sections, and no `read_file` or framework skill tools |
| | A turn without curated knowledge carries no knowledge rules | Re-run as-is |
| | A turn with curated knowledge carries the rules right after the block | Re-run as-is |
| | A user-level skill is offered to the assistant on demand | **Update**: the app's own catalog in `## Skills`, with the `SKILL.md` path; `read_file` instead of `skill`/`skill_read` |
| | The assistant reads a skill's files with read_file, and only those | **Add** |
| | A user-level override of the curated-knowledge skill reaches the turn | Re-run as-is |
| Agents (`agents.spec.ts`) | Opens an agent … (the Prompt tab starts with the identity) | Re-run as-is |
| Agent skills, designer skills, deep analysis, chat and visuals, knowledge, evals | all | Re-run as-is (full suite) |

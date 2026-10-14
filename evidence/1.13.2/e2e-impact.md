# 1.13.2 — E2E impact analysis (workflow step 6)

Change: the assistant prompt's "Curated knowledge:" section moves verbatim into the harness-loaded `curated-knowledge` skill. `knowledgeContext(block)` sends it right after Block 3 on every call that carries the block (chat turn, grounding pass, deep analysis, eval suite).

Touched: `mastra/agents/assistant.agent.ts`, `mastra/context-blocks.ts`, `mastra/app-skills.ts` (`appSkillBody`), `mastra/evals/assistant.evals.ts`, `modules/sessions/sessions.service.ts`, `mastra/skills/curated-knowledge/SKILL.md`.

| Scenario → Playwright spec | Decision |
|---|---|
| sessions-chat · Skills the assistant is given · A turn without curated knowledge carries no knowledge rules → `assistant-skills.spec.ts` | **Add**. Failed before the change: the base prompt still contained "Curated knowledge:". |
| sessions-chat · Skills the assistant is given · A turn with curated knowledge carries the rules right after the block → `assistant-skills.spec.ts` | **Add**. Same failure before the change. |
| sessions-chat · Sessions started from an agent · The agent's Live instructions and model shape every turn → `agent-sessions.spec.ts` | Re-run as-is: the agent block must still come after every app block, and the skill message sits right after Block 3. |
| agents-evals · Agents (Prompt tab opens with the identity line) → `agents.spec.ts` | Re-run as-is. |
| knowledge · Knowledge snippets | E2E: none yet, so it is covered by the two scenarios above plus the unit tests (`context-blocks.spec.ts`, `assistant.evals.spec.ts`, `sessions.service.spec.ts`). |
| every other Feature | Re-run as-is (full web and org suites). |

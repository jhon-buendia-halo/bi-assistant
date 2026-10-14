# 1.13.1 — E2E impact analysis (workflow step 6)

Change: the assistant and the designer stop seeing skills from the session workspace; each agent declares its own skills from the app bundle (agents.md 7.3, 7.4); the designer reads `interactive-visuals` from the bundle; the backend validates skills at startup.

Touched: `backend/src/mastra/app-skills.ts` (new), `mastra/index.ts`, `mastra/session-workspaces.ts`, `mastra/agents/assistant.agent.ts`, `mastra/agents/visualization.agent.ts`, `modules/sessions/visualization.service.ts`, `mastra/skills/interactive-visuals/SKILL.md` (description).

| Scenario (capability spec → Playwright spec) | Exercises | Decision |
|---|---|---|
| sessions-chat · Skills the assistant is given · The assistant is offered only its own skills → `assistant-skills.spec.ts` | assistant request: catalog, skill tools | **Add** (fails before the change: catalog lists `interactive-visuals`) |
| sessions-chat · Sessions started from an agent · The agent's Live instructions and model shape every turn → `agent-sessions.spec.ts` | order of the assistant's system messages; the framework's skills messages disappear | Re-run as-is (asserts the agent block comes after every *app* block, not that it is last) |
| sessions-chat · Sessions started from an agent · the other four scenarios → `agent-sessions.spec.ts` | assistant turn through the stub | Re-run as-is |
| agents-evals · Agent editor (preview chat) → `agent-editor.spec.ts` | assistant turn through the stub | Re-run as-is |
| agents-evals · Agents (Prompt tab starts with the identity line) → `agents.spec.ts` | assistant instructions unchanged | Re-run as-is |
| sessions-chat · Chat and visuals → `chat-and-visuals.spec.ts` | visual panel (designer route mocked in the browser) | Re-run as-is |
| every other Feature | not touched | Re-run as-is (full web + org suites at step 9) |

Not covered by Playwright: the real designer call, because every visual E2E mocks the designer route. It's covered by `visualization.service.spec.ts`, which asserts the skill system message carries the bundled `SKILL.md`. Request-level designer coverage arrives with 1.13.5.

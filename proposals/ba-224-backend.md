# BA-224 backend report

Checks in backend/: `npm test` 77 suites / 1288 tests pass; `npm run lint` 0 errors (2 pre-existing warnings); `npm run build` ok.

## Wire shape
GET /agents/:key (built-in only) adds
`prompt: { editable, shipped, modified, builtInChanged, linksAllowed, updatedAt: string|null }`; `instructions` reflects an override.
PUT /agents/:key/prompt  body `{ prompt }` -> `{ ok:true, message:'System prompt of "<name>" saved', agent: AgentDetail(with prompt) }`
DELETE /agents/:key/prompt -> `{ ok:true, message:'System prompt of "<name>" reset', agent }`
Both `edit-policies`; Style A refusals `{ ok:false, message }` in the api order. `<name>` = the agent's display name (e.g. "Questions to Insights Assistant", "SQL Fixer", "Interactive Visual Designer").
Stored prompt is trimmed. Limit/empty checks run on the trimmed text.

## Files
New: mastra/agent-prompt-overrides.ts (bridge + agentInstructions), mastra/shipped-agent-prompts.ts (shipped text + hash), mastra/agents/system-prompts.ts (the 5 System prompts moved out of the agent files), modules/agents/agent-prompts.service.ts, entities/agent-prompt-override.entity.ts, repositories/agent-prompt-overrides.repository.ts, fixtures system-prompt.<key>.txt (from git HEAD), specs: system-agents.spec.ts, agent-prompts.service.spec.ts.
Changed: assistant-prompt.ts (assistantShippedPrompt, buildOverriddenAssistantInstructions), assistant.agent.ts (variant.instructions is override-aware, cached per bridge version), 5 System agent files, agents.service.ts/controller/module, doc-store.ts, database.module.ts, assistant.agent.spec.ts, agents.service.spec.ts.

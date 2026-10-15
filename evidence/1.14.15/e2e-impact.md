# 1.14.15 (BA-228) — E2E impact analysis (workflow step 6)

Commits `0ae1a03`, `6b3d490`, `013e110`, `08a8848` (`feat(BA-228)`). Touched:
- **Backend:** the `rfp` agent, its prompt and seven stage skills (`mastra/agents/rfp.agent.ts`, `system-prompts.ts`, `skills/rfp-*`), the 23 RFP tools (`mastra/tools/rfp.tools.ts`), Block R1 (`mastra/rfp-context.ts`), `SessionsService` (sessions bound to a built-in agent, the per-agent turn, `rfpId`, `turn-data.ts`), `builtin-sessions.ts`, `AgentsService` (kind `official`, `chatRequirement`), `AgentPromptsService`, `BuiltInSkillsService`, the eval harness and `eval-runs.service.ts`, `rest.connector.ts`.
- **Frontend:** `session-chat` (agent chip, welcome block, R15: no Careful / Deep analysis / Generate interactive visuals), `agent-hub.util` (Start chat for an Official agent with a dataset), `agent-chat-box`, `agent-detail` (Graph), `agent-system-prompt`, `prompt-editor`, `official-links`, `skills-api.service`, `app.ts`.

Helpers checked (retrospective 1.13.13): `startChatFromCard`/`openHub` (agent-sessions), `openAgent`/`openSkillsTab` (agent-skills) and the hub's `cards`/`cardKeys` use test ids and copy this story keeps; `agent-hub.spec.ts` already expects `['assistant', 'rfp']` under Official.

| Feature (spec file) | Scenario | Decision | Why it fails on `origin/main` |
|---|---|---|---|
| RFP builder (`frontend/e2e/rfp-builder.spec.ts`, new) | The hub offers the RFP Builder as an Official agent | **Add** | no `agent-rfp` card on base |
| RFP builder | Start chat is blocked until the API sample is registered | **Add** | no `Start chat with RFP Builder` on base |
| RFP builder | Start chat opens a session bound to the RFP Builder | **Add** | no RFP Builder, no bound session, no `session-agent` chip for it |
| RFP builder | The first turn loads the stage-1 skill and reads the client (also the acceptance "the skill catalog carries the stage skills and the system message carries Block R1") | **Add** | no `rfp` agent: the request would be the assistant's, with `run_readonly_sql`, `curated-knowledge` only and no Block R1 |
| RFP builder | A created RFP becomes the session's active RFP | **Add** | no `create_rfp`, no `Active RFP in this session` line |
| RFP builder | An RFP Builder chat hides the assistant's controls (R15) | **Add**, with a new Gherkin scenario (R15 had none) | no RFP Builder session on base; the controls are always shown there |
| RFP builder | The System Prompt tab shows the RFP Builder's prompt | **Add** | no `rfp` agent, no Skills (7) |
| Built-in agent prompts (`frontend/e2e/builtin-agent-prompts.spec.ts`) | The shipped RFP Builder prompt shows its tools and skill as chips and in the Graph tab; The RFP Builder's prompt links only its own tools and skill | **Add**, written by the parallel 1.14.11 run, which owns that Feature's spec file; re-run here | no `rfp` agent on base |
| Agent hub (`frontend/e2e/agent-hub.spec.ts`) | Shows the built-in agents and mine in sections; Filters limit the hub to one kind of agent | Re-run as-is (already expect the RFP Builder under Official) | — |
| Sessions started from an agent (`frontend/e2e/agent-sessions.spec.ts`) | all six | Re-run as-is (`createFromAgent` and the per-agent turn changed; the Official RFP card now also offers Start chat) | — |
| Agent editor (`frontend/e2e/agent-editor.spec.ts`) | The Official agent's Chat Box offers Start chat | Re-run as-is (`agent-chat-box` changed) | — |
| Agent skills (`frontend/e2e/agent-skills.spec.ts`) | all | Re-run as-is (`BuiltInSkillsService` changed) | — |
| Agent definitions UI (`frontend/e2e/agents.spec.ts`) | all | Re-run as-is (agent detail changed) | — |
| Skills the assistant is given (`frontend/e2e/assistant-skills.spec.ts`), Chat and visuals (`chat-and-visuals.spec.ts`), Clarification (`chat-clarification.spec.ts`), World Cup workflow (`world-cup-workflow.spec.ts`) | all | Re-run as-is (the assistant's turn now goes through the per-agent path in `SessionsService`) | — |
| Sessions (sessions-chat) | I start an RFP Builder session from New conversation; The Agent field disables an agent that cannot start | not this story: BA-230 (1.14.17) | — |

Totals: Add 9 (7 in `rfp-builder.spec.ts`, 2 in `builtin-agent-prompts.spec.ts` by its owner), Update 0, Delete 0, Re-run as-is 9 spec files.

Not covered by E2E: the `rfp` eval set at 100% over 3 runs on `claude-sonnet-5` (a real-model gate, see the roadmap note: the 3-run gate is still open).

Results: `e2e-results.txt` (the RFP builder scenarios) and `e2e-rerun-results.txt` (the re-run-as-is specs). Screenshot: `rfp-builder-session-welcome.png`.

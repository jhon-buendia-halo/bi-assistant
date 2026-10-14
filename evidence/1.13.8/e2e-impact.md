# 1.13.8 — E2E impact analysis (step 6)

Touched: `agent-detail` component (a sixth tab), agents API (two routes).

| Feature (spec) | Scenario | Decision |
|---|---|---|
| Agent skills (`agent-skills.spec.ts`, new) | Shows the designer's built-in skill and the content of its files | **Add** |
| | An agent without skills says so | **Add** |
| | A user skill and a project override reach the assistant | **Add** |
| | A broken user skill is skipped and says why | **Add** |
| Agents (`agents.spec.ts`) | Opens an agent … switches between its tabs; Shows the stateless, no-tool agents accurately | Re-run as-is: tabs are selected by test id, with no count or order assertions |
| Agent editor (`agent-editor.spec.ts`), Agent Hub (`agent-hub.spec.ts`) | all | Re-run as-is |

Red run before the change: all four added scenarios failed for the right reason (no `agent-tab-skills`).

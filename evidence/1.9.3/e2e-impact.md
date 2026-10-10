# 1.9.3 — E2E impact analysis (workflow step 6)

Story: [BA-153](https://halo-powered.atlassian.net/browse/BA-153) Start a session from an agent. Target: web (BA-156).

## Components touched

| Layer | Component | Change |
|---|---|---|
| Backend | `sessions` module (`sessions.service.ts`, controller, `session.entity.ts`) | `POST /sessions` with `agentId`; `agentId` / `agentName` on the document; derived `agent` on the wire; Block 5 and `agent-overrides` in `agentContext` (chat, grounding pass, deep analysis) |
| Backend | `user-agents` module | Live-version lookup used by sessions (no endpoint change) |
| Backend | `mastra/model-resolver.ts`, `llm.service.ts`, `assistant.agent.ts` | Model override read from the requestContext by the assistant only |
| Frontend | `agents/agent-hub`, `agent-card` | **Start chat** on Official and Live cards |
| Frontend | `agents/agent-detail` | **Start chat** in the header actions |
| Frontend | `app.ts` / `app.html` | Opening the new session from the Agents area; agent chip in the page header; agent line in the drawer's session rows |
| Frontend | `sessions/session-chat`, `sessions-api.service.ts`, `session.model.ts` | Welcome block from the agent; create from an agent; the `agent` wire field |

## Decisions per scenario

| Spec file | Scenario | Decision | Why |
|---|---|---|---|
| `frontend/e2e/agent-sessions.spec.ts` (new) | Start chat on an agent card opens a session bound to the agent | **Add** | New flow (R52, R57, R58) |
| | Only Live agents and the Official agent offer Start chat | **Add** | agents-evals R53 |
| | Start chat is unavailable when none of the agent's datasets exist | **Add** | R52, R53 |
| | The agent's Live instructions and model shape every turn | **Add** | R54, R56; recording LLM stub |
| | Instructions can't switch off the read-only guard | **Add** | R55; stub returns a `DELETE` tool call; needs the World Cup Postgres |
| | Deleting the agent keeps its sessions on the plain assistant | **Add** | R59 |
| `frontend/e2e/agent-hub.spec.ts` | A card opens the agent's detail view with its actions | **Update** | Detail now shows **Start chat** for Live and Official agents, not for drafts |
| | The hub has no detectable accessibility violations in either theme | **Re-run as-is** | New button on cards; axe must stay clean in both themes |
| | Shows the built-in agents and mine in sections; Search…; Filters…; Pinned agents come first…; Flags an agent whose dataset no longer exists; Publishing a draft makes it Live; Deleting an agent asks first | **Re-run as-is** | Card layout gains a control; behaviour unchanged |
| `frontend/e2e/agents.spec.ts` | All 9 scenarios (tabs, evals, executions) | **Re-run as-is** | Assistant detail header gains **Start chat** |
| `frontend/e2e/layout-accessibility.spec.ts` | axe on every screen in both themes; shell visual baseline | **Re-run as-is** | Agents and session screens change; the baseline (home shell) should not |
| `frontend/e2e/chat-and-visuals.spec.ts` | Both scenarios | **Re-run as-is** | Welcome block and session model change for plain sessions only by type |
| `frontend/e2e/world-cup-workflow.spec.ts` | All scenarios | **Re-run as-is** | `POST /sessions` gains a branch; the form path must not change |
| `frontend/e2e/navigation.spec.ts` | All scenarios | **Re-run as-is** | Drawer session rows render the agent line |
| `frontend/e2e/llm-settings.spec.ts` | All scenarios | **Re-run as-is** | Model resolver gains an override parameter |
| `frontend/e2e/appearance.spec.ts`, `developer-*.spec.ts`, `diagnostics.spec.ts` | All | **Re-run as-is** (full suite) | Not touched |
| `backend/test/agent-sessions.e2e-spec.ts` (new) | Create from a Live agent (name, datasets with a missing one dropped, `agentId`, `agentName`); refusals: unknown id, built-in key, draft-only, no dataset left; derived `agent` before and after `DELETE /agents/:id`; survives a backend restart | **Add** | API-level R52, R59 |
| `backend/test/user-agents.e2e-spec.ts` | All 9 tests | **Re-run as-is** | Agent endpoints unchanged |

Deleted: none.

## Harness

- A recording OpenAI-compatible stub (extending the one in `llm-settings.spec.ts` into a shared helper) is saved as the LenAI provider. It answers `/chat/completions` both plainly (the save-time connection test) and as an SSE stream (turns). It records each request's `model`/deployment path and `messages`. For the guard scenario it is scripted to return one `run_readonly_sql` tool call with a `DELETE` statement, then a text answer.
- Deployment names travel in the LenAI URL (`…/deployments/<model>/chat/completions`), so the model assertion reads the request path.
- Unit tests (not governed by this analysis) cover Block 5's text and position, the override mapping per provider, and the deleted-agent fallback.

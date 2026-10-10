# 1.9.5 — E2E impact analysis (workflow step 6)

Story: [BA-155](https://halo-powered.atlassian.net/browse/BA-155) Agent editor: create, test, publish and delete. Target: web (BA-156). Database: the per-worktree World Cup database created with the infra MCP service (`.env.e2e.local`).

## Components touched

| Layer | Component | Change |
|---|---|---|
| Backend | `sessions` service and controller | Preview sessions: `POST /sessions { agentId, preview: true }`, an in-memory map resolved by `get`, never in `list`, discarded by `DELETE /sessions/:id`; preview turns apply the draft; start-up sweep of `session-preview-*` workspaces and threads |
| Backend | `mastra/session-workspaces` | Listing the preview workspace directories for the sweep |
| Frontend | `agents/agent-editor` (new) | The editor form, Save, Publish, Back with the unsaved-changes confirmation |
| Frontend | `agents/agent-hub`, `agent-detail` | **New agent** enabled; **Edit** for user agents |
| Frontend | `app.ts` / `app.html` | The `agent-editor` main view; the preview chat in the Details panel; the navigation guard |
| Frontend | `sessions/session-chat`, `sessions-api.service.ts` | Reused for the preview inside the Details panel; create and discard a preview |

## Decisions per scenario

| Spec file | Scenario | Decision | Why |
|---|---|---|---|
| `frontend/e2e/agent-editor.spec.ts` (new) | Creates an agent, previews it, publishes it and deletes it | **Add** | R54-R57, R60 |
| | Editing a Live agent keeps its sessions on the Live version until republished | **Add** | R58; sessions-chat R54 |
| | Sending in the preview saves the form first | **Add** | R60 |
| | Reset and leaving the editor discard the preview | **Add** | R61; checks the workspace directory and the session list |
| | Preview needs a dataset, and names must be unique | **Add** | R45, R60 |
| | Leaving with unsaved changes asks first | **Add** | R59 |
| | A dataset that no longer exists stays visible in the editor | **Add** | R55 |
| | The editor has no detectable accessibility violations in either theme | **Add** | axe on the editor and the preview panel |
| `frontend/e2e/agent-hub.spec.ts` | Shows the built-in agents and mine in sections | **Update** | **New agent** is now enabled |
| | A card opens the agent's detail view with its actions | **Update** | **Edit** on user agents, not on the assistant |
| | Search, filters, pins, missing dataset, publish, delete, axe | **Re-run as-is** | Unchanged behaviour |
| `frontend/e2e/agent-sessions.spec.ts` | All 6 | **Re-run as-is** | The sessions service gains the preview map |
| `frontend/e2e/chat-and-visuals.spec.ts`, `world-cup-workflow.spec.ts`, `navigation.spec.ts`, `layout-accessibility.spec.ts`, `agents.spec.ts` | All | **Re-run as-is** | Session chat reused in the panel; a new main view and navigation guard |
| Other specs | All | **Re-run as-is** (full suite) | Not touched |
| `backend/test/agent-sessions.e2e-spec.ts` | Preview: created from the draft (missing datasets dropped, `preview: true`, `agent` from the draft), resolvable by id but not listed, refused with no dataset or a built-in key, discarded by `DELETE` (then 404), and swept from disk by a backend restart | **Add** | API-level R60, R61; data-model 3.12 |
| `backend/test/user-agents.e2e-spec.ts` | All 9 | **Re-run as-is** | Agent endpoints unchanged |

Deleted: none.

## Harness

- Before the story, the suite was moved onto `E2E_WORLD_CUP_DB_*` (`frontend/e2e/helpers/world-cup-db.ts`, loaded from `.env.e2e.local`), so it runs against the infra-MCP database without Docker. Full web suite on that database before any 1.9.5 change: 60 passed, 2 skipped (desktop only).
- The recording LLM stub (`frontend/e2e/helpers/llm-stub.ts`) checks which instructions each turn sent.

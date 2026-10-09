# 1.9.4 Agent Hub screen (BA-154): E2E impact analysis (workflow step 6)

Touched components: `features/agents/components/agent-list` (deleted, replaced by `agent-hub` + `agent-card`), `features/agents/components/agent-detail` (Publish and Delete actions), `features/agents/services/agents-api.service.ts` (pin, publish, delete, create, save draft), `app.ts` / `app.html` (hub wiring, return to the hub after a delete). Backend: unchanged (endpoints 41-45 shipped in 1.9.2).

Gherkin source: `specs/capabilities/agents-evals/spec.md` (Features "Agents" and "Agent Hub"), `specs/capabilities/app-shell/spec.md`.

## Decisions per Playwright spec and scenario

| Spec | Scenario (test) | Decision | Reason |
|---|---|---|---|
| `agents.spec.ts` | Opens an agent from the Agents list and switches between its tabs | **Update** | The System section shows 3 cards per row; `sql-fixer` and `sql-verifier` sort 4th and 5th, so the test clicks `Show more` in the System section first (R3), both on first visit and after `All agents`. |
| `agents.spec.ts` | Shows the stateless, no-tool agents accurately | **Update** | Same: `sql-fixer` is behind `Show more` in the System section. |
| `agents.spec.ts` | Offers the configured datasources and starts a run from the evals tab | Re-run as-is | Opens `agent-assistant`, which is in the first row of the Official section; the evals tab is unchanged. |
| `agents.spec.ts` | Runs only the ticked questions | Re-run as-is | Same entry point (`agent-assistant`); eval DOM unchanged. |
| `agents.spec.ts` | Refuses to run against a datasource with no datasets | Re-run as-is | Same entry point; eval DOM unchanged. |
| `agents.spec.ts` | Explains an incomplete eval dataset without starting a run | Re-run as-is | Same entry point; eval DOM unchanged. |
| `agents.spec.ts` | Opens a question in the right panel with what it is scored on | Re-run as-is | Same entry point; right panel unchanged. |
| `agents.spec.ts` | Separates the question suite from past executions | Re-run as-is | Same entry point; executions unchanged. |
| `agents.spec.ts` | Downloads an execution as a Markdown report | Re-run as-is | Same entry point; download unchanged. |
| `agent-hub.spec.ts` (new) | Shows the built-in agents and mine in sections | **Add** | R1, R3: sections, owners, chips, Show more / Show less, disabled New agent. |
| `agent-hub.spec.ts` | Search narrows the agents by name or description | **Add** | R2: case-insensitive substring search over name and description, no-match message. |
| `agent-hub.spec.ts` | Filters limit the hub to one kind of agent | **Add** | R2: Mine, Official, Pinned (empty), All. |
| `agent-hub.spec.ts` | Pinned agents come first in their own section and survive a restart | **Add** | R1, R4, R47: pin order within the section, Pinned filter, restart via `app.restartCli()`, unpin. |
| `agent-hub.spec.ts` | Flags an agent whose dataset no longer exists | **Add** | R1, R48: `Missing dataset: Gone`. |
| `agent-hub.spec.ts` | A card opens the agent's detail view with its actions | **Add** | R5: Publish / Delete for user agents only. |
| `agent-hub.spec.ts` | Publishing a draft makes it Live | **Add** | R5, R45: refusal toast, success toast, chip turns Live. |
| `agent-hub.spec.ts` | Deleting an agent asks first | **Add** | R5, R50: native confirm (dismiss, then accept), toast, return to the hub. |
| `agent-hub.spec.ts` | The hub has no detectable accessibility violations | **Add** | ui.md section 8: axe clean with the System section expanded (no nested interactive controls). |
| `layout-accessibility.spec.ts` | Supports keyboard layout controls and persists the right-panel width | Re-run as-is | Shell controls unchanged. |
| `layout-accessibility.spec.ts` | Has no automatically detectable accessibility violations in the application shell | Re-run as-is | Home view unchanged; the hub has its own axe scenario. |
| `layout-accessibility.spec.ts` | Matches the stable application-shell visual baseline | Re-run as-is | Home view unchanged, so the baseline must not move; do not update snapshots. |
| `chat-and-visuals.spec.ts` | both tests | Re-run as-is | Do not touch the Agents screen. |
| `developer-settings.spec.ts` | all tests | Re-run as-is | Settings only. |
| `developer-observability.spec.ts` | all tests | Re-run as-is | Calls agents through sessions, not the hub. |
| `diagnostics.spec.ts` | all tests | Re-run as-is | System logs panel only; error toasts from the hub land there through the existing toast service. |
| `llm-settings.spec.ts` | all tests | Re-run as-is | Settings only. |
| `world-cup-workflow.spec.ts` | all tests | Re-run as-is | Datasources, datasets and sessions only. |

No scenario is deleted. The full web suite is re-run in step 9.

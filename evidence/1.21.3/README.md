# 1.21.3 — v2 turns run as a Mastra workflow shown in the workflow bar

Ships ADR-0034: a Mastra workflow `qti-v2-turn` runs every v2 turn with four steps: Receive question (deterministic), Load catalog (deterministic), Analyse (the `assistant-v2` agent, streamed to the chat) and Wrap up (deterministic, a turn summary). The orchestrator writes the session's saved workflow state from the run's step events, so the workflow bar shows the four steps from the first turn. The saved state gains `failed` and the view `source: 'workflow'` (additive, no migration); the bar gains a Failed status (agent-panel R8a).

## Gherkin scenarios and the specs that cover them

Specs: [agents.md](../../specs/system/agents.md), [agent-panel](../../specs/capabilities/agent-panel/spec.md), [sessions-chat](../../specs/capabilities/sessions-chat/spec.md).

| Scenario | Playwright spec |
|---|---|
| v2 shows its code-defined steps advancing | `frontend/e2e/agent-panel.spec.ts` (passed, [final gate run](../1.21.7/e2e-results.txt)) |
| A failing step of the v2 workflow is marked failed | `frontend/e2e/agent-panel.spec.ts` (passed, [final gate run](../1.21.7/e2e-results.txt)) |
| A v2 session runs v2 on every turn | `frontend/e2e/agent-sessions.spec.ts` (passed, [final gate run](../1.21.7/e2e-results.txt)) |

Step order, the deterministic steps and the state written from step events are covered by backend unit tests.

## Artifacts

No screenshot or transcript is kept for this story; the E2E specs above are the evidence. All listed scenarios passed in the [final gate run](../1.21.7/e2e-results.txt).

Desktop: not run (web target only).

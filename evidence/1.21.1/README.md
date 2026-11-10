# 1.21.1 — Empty Questions to Insights v2 agent (BA-321)

Ships a second built-in agent, `assistant-v2` ("Questions to Insights v2", id `questions-to-insights-v2`): an identity-only prompt starting `You are Questions to Insights v2` (overridable, ADR-0026), the tools `list_entities`, `describe_entity` and `run_readonly_sql`, the assistant's memory settings, no skills and no evals. It is Official in the Agent Hub and sessions started from it are bound to it (ADR-0028). The current assistant is unchanged.

## Gherkin scenarios and the specs that cover them

Specs: [agents.md](../../specs/system/agents.md), [api.md](../../specs/system/api.md), [agents-evals](../../specs/capabilities/agents-evals/spec.md), [sessions-chat](../../specs/capabilities/sessions-chat/spec.md).

| Scenario | Playwright spec |
|---|---|
| v2 is an Official card that starts a chat | `frontend/e2e/agent-hub.spec.ts` (passed, [final gate run](../1.21.7/e2e-results.txt)) |
| v2's page shows its prompt, three tools and no skills | `frontend/e2e/agent-hub.spec.ts` (passed, [final gate run](../1.21.7/e2e-results.txt)) |
| Saving a v2 prompt that loses its identity line is refused | `frontend/e2e/agent-hub.spec.ts` (passed, [final gate run](../1.21.7/e2e-results.txt)) |
| A v2 session runs v2 on every turn | `frontend/e2e/agent-sessions.spec.ts` (passed, [final gate run](../1.21.7/e2e-results.txt)) |
| New conversation starts a v2 session, v2 listed after Assistant | `frontend/e2e/session-management.spec.ts` (passed, [final gate run](../1.21.7/e2e-results.txt)) |

The assistant's compiled prompt and tool list staying byte-identical to `main` is covered by the backend unit tests.

## Artifacts

No screenshot or transcript is kept for this story; the E2E specs above are the evidence. All listed scenarios passed in the [final gate run](../1.21.7/e2e-results.txt).

Desktop: not run (web target only).

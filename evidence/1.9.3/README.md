# 1.9.3 — Start a session from an agent (BA-153)

Tested on the web target (BA-156). **Desktop not run.** The two desktop-only scenarios were skipped on web: developer-settings "the desktop app offers to restart the backend…" and diagnostics "captures live renderer failures…".

The model in every E2E and screenshot is a local OpenAI-compatible stub (`frontend/e2e/helpers/llm-stub.ts`) saved as the LenAI provider. It records each request, so the tests check what the backend actually sent to the model. No real model was called.

| Artifact | Shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step 6: the decision for every spec and scenario (6 new Playwright scenarios, 1 updated hub scenario, a new backend API test, the rest re-run). |
| [red-run.txt](red-run.txt) | Tests written first and failing for the right reason: `agentId` ignored by `POST /sessions`, and no **Start chat** button. |
| [e2e-results.txt](e2e-results.txt) | Full web suite on the final code: 60 passed, 2 skipped (desktop only), including the 6 scenarios of `agent-sessions.spec.ts` and the updated `agent-hub.spec.ts`. |
| [backend-e2e-results.txt](backend-e2e-results.txt) | `agent-sessions.e2e-spec.ts` (7 tests: creation, refusals, the derived `agent`, deletion, a real backend restart) and `user-agents.e2e-spec.ts` (9), 16/16. |
| [unit-tests.txt](unit-tests.txt) | Backend 757/757 (10 new: Block 5 position, overrides, deleted fallback, re-stamped name, `createFromAgent`, `toView`, the resolver override); frontend 119/119; lint unchanged. |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing. |
| [model-request-system-messages.json](model-request-system-messages.json) | The system messages of a real turn as the stub received them: the assistant's prompt first, the orientation block, the labelled agent instructions block, then the framework's own workspace, available-skills and skills-usage messages. The request path names the deployment. |
| [hub-start-chat-light.png](hub-start-chat-light.png), [-dark](hub-start-chat-dark.png) | **Start chat** on the Official card and on Live cards, none on the draft "Claims triage", and disabled on "Scratch analyst", whose only dataset was deleted. |
| [agent-detail-start-chat-light.png](agent-detail-start-chat-light.png), [-dark](agent-detail-start-chat-dark.png) | A Live agent's detail with **Start chat** and **Delete**. |
| [agent-session-welcome-light.png](agent-session-welcome-light.png), [-dark](agent-session-welcome-dark.png) | The new session: the Agent chip in the page header, the drawer row `Cup historian · World Cup Core`, the welcome block with the agent's description and starter questions, and the creation toast. |
| [agent-session-answered-light.png](agent-session-answered-light.png), [-dark](agent-session-answered-dark.png) | A turn answered through the stub. |
| [agent-deleted-session-light.png](agent-deleted-session-light.png), [-dark](agent-deleted-session-dark.png) | After deleting the agent: the transcript kept, and `Cup historian · agent deleted` in the header and the drawer row. |

The guard scenario's row count ran through `docker compose exec` against the shared World Cup Postgres (16 rows before and after the rejected `DELETE`).

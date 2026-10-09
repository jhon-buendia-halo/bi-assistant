# 1.8.5 — Sessions master-detail list pane (BA-146)

Web target, 2026-10-09, isolated compose project `qti-ba-141` on port 55433.

| Artifact | Shows |
|---|---|
| [e2e-results.txt](e2e-results.txt) | The full web suite after the whole restyle: 44 passed, 2 skipped (desktop only). It includes `navigation.spec.ts` › "collapses and expands the session list" (new) and the session flows in `world-cup-workflow.spec.ts`, `chat-and-visuals.spec.ts` and `developer-observability.spec.ts`. |
| `sessions-list-collapsed-{light,dark}.png` | The chat with the session list collapsed and "Expand session list" in the page header. |
| `sessions-composer-{light,dark}.png` | The list pane (row with its dataset subtitle) beside the token-styled new-session composer. |

**Desktop not run:** `developer-settings.spec.ts` › the desktop app offers to restart the backend, and `diagnostics.spec.ts` › captures live renderer failures….

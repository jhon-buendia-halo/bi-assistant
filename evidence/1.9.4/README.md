# 1.9.4 — Agent Hub screen (BA-154)

Tested on the web target (BA-156). **Desktop not run.**

| Artifact | Shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step 6: the decision for every existing spec and scenario (two `agents.spec.ts` tests updated for Show more, `agent-hub.spec.ts` added, the rest re-run). |
| [red-run.txt](red-run.txt) | Tests written first and failing for the right reason (missing hub elements, missing util module). |
| [e2e-results-web.txt](e2e-results-web.txt) | Targeted run 21/21 green (`agent-hub.spec.ts`, `agents.spec.ts`, `layout-accessibility.spec.ts`). Full web suite on the final code: 44 passed, 2 skipped. The skipped tests are desktop only and were not run: developer-settings "the desktop app offers to restart the backend…" and diagnostics "captures live renderer failures…". |
| [unit-tests.txt](unit-tests.txt) | Frontend unit tests, including 12 for `agent-hub.util.ts`. |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing. |
| [hub-all.png](hub-all.png) | The hub under All: Official, Mine (one Draft and one Live agent), and System with `Show more (2)`. |
| [hub-pinned-first.png](hub-pinned-first.png) | Pinned cards first in their own section (the assistant in Official, "Health plan analyst" in Mine). |
| [hub-pinned-filter.png](hub-pinned-filter.png) | The Pinned filter, holding both pinned agents in one section. |
| [hub-no-match.png](hub-no-match.png) | The no-match state for a search. |
| [agent-detail-draft-actions.png](agent-detail-draft-actions.png) | A draft agent's detail view with Publish and Delete. |

The delete confirmation uses the native dialog, so there is no screenshot of it. The E2E test asserts its text.

# 1.9.5 — Agent editor: create, test, publish and delete (BA-155)

Tested on the web target (BA-156). **Desktop not run.** The two desktop-only scenarios were skipped on web: developer-settings "the desktop app offers to restart the backend…" and diagnostics "captures live renderer failures…".

The World Cup database for every E2E run was a per-worktree PostgreSQL created with the infra MCP service and seeded through the app's own loader (`POST /testing-data/world-cup/load`). The suite read it from the git-ignored `.env.e2e.local`, and Docker was not used. The model is the recording OpenAI-compatible stub (`frontend/e2e/helpers/llm-stub.ts`); no real model was called.

| Artifact | Shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step 6: the decision for every spec and scenario (8 new editor scenarios, 2 updated hub scenarios, new backend preview tests, the rest re-run). |
| [red-run.txt](red-run.txt) | Tests written first and failing for the right reason: no preview sessions in the API, **New agent** disabled and no **Edit**. |
| [e2e-results.txt](e2e-results.txt) | Full web suite on the final code: 68 passed, 2 skipped (desktop only), including the 8 scenarios of `agent-editor.spec.ts` (the axe scan in both themes among them). |
| [backend-e2e-results.txt](backend-e2e-results.txt) | `agent-sessions.e2e-spec.ts` (9, now including preview creation, refusals, discard and the sweep after a real restart) and `user-agents.e2e-spec.ts` (9), 18/18. |
| [unit-tests.txt](unit-tests.txt) | Backend 759/759 (2 new for preview sessions); frontend 140/140 (21 new: editor logic, editor service, the SessionChat `beforeSend` hook); lint unchanged. |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing. |
| [editor-new-light.png](editor-new-light.png), [-dark](editor-new-dark.png) | The empty editor opened by **New agent**. |
| [agent-detail-edit-light.png](agent-detail-edit-light.png), [-dark](agent-detail-edit-dark.png) | A Live agent's detail with **Start chat**, **Edit** and **Delete**. |
| [editor-live-unpublished-changes-light.png](editor-live-unpublished-changes-light.png), [-dark](editor-live-unpublished-changes-dark.png) | Editing a Live agent: after Save the header shows `Live` and `Unpublished changes`, and the missing dataset is listed as `Gone (missing)`. |
| [editor-preview-answered-light.png](editor-preview-answered-light.png), [-dark](editor-preview-answered-dark.png) | The preview chat in the Details panel beside the form, with **Reset preview** and an answered turn. |

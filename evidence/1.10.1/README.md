# 1.10.1 — Per-model reasoning effort in LLM Settings (BA-160)

Tested on the web target (BA-156). **Desktop not run.** Two desktop-only scenarios were skipped on web: developer-settings "the desktop app offers to restart the backend…" and diagnostics "captures live renderer failures…".

The World Cup database was a per-worktree PostgreSQL created with the infra MCP service and seeded through the app's own loader (`POST /testing-data/world-cup/load`), read from the git-ignored `.env.e2e.local`; Docker was not used. The model is the recording OpenAI-compatible stub (`frontend/e2e/helpers/llm-stub.ts`), which now also records the connection probes and each request's `reasoning_effort`. No real model was called: the original `gpt-5` timeout can only be confirmed against OpenAI with the user's key.

| Artifact | Shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step 6: 3 new scenarios in `llm-settings.spec.ts`, everything else re-run as-is. |
| [red-run.txt](red-run.txt) | The new scenarios failing first, for the right reason (no effort select). |
| [e2e-results.txt](e2e-results.txt) | Full web suite on the final code: 71 passed, 2 skipped (desktop only), including "offers the effort levels of the chosen model", "tests a reasoning model at its lowest effort" (probe carried `minimal`) and "saves the chosen effort and uses it on the next turn" (turn carried `medium`). |
| [unit-tests.txt](unit-tests.txt) | Backend 804/804, frontend 140/140, builds, and the lint baseline. |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing. |
| [llm-effort-picker-gpt-5.png](llm-effort-picker-gpt-5.png) | Settings → LLM after saving deployment `gpt-5` with **Medium**: the select, its hint, and the toasts for the test and the save. |

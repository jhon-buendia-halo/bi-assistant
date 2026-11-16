# 1.7.22 — E2E impact (step 6)

Reviewed 2026-11-11. The diff only changes how the backend is staged for the desktop installer (`frontend/scripts/stage-backend.sh`, `prune-node-modules.mjs`). No Playwright spec runs against the staged backend: the web target uses `backend/dist` with the development `node_modules`. No user flow changes.

| Spec | Decision | Scenarios |
|---|---|---|

Other tests:

- **Added, unit:** `frontend/scripts/prune-node-modules.test.mjs` (`node --test`): what is pruned, what is kept, nested and scoped packages, `@github/copilot-sdk*` untouched.
- **Runtime check of the pruned backend:** `pruned-backend-check.mjs` in this folder imports all 37 production dependencies and calls 15 API endpoints on the staged backend under Electron-as-Node (`pruned-backend-check.txt`, 18/18).

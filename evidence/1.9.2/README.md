# 1.9.2 — Agent definitions: storage and API (BA-152)

This is a backend and API change with no UI, so there are no screenshots. The Agents screen still renders the same six built-in agents.

| Artifact | Shows |
|---|---|
| [red-run.txt](red-run.txt) | Tests written first, failing for the right reason: the unit suites can't find the `user-agents` module, and the e2e gets `404 Cannot PUT /agents/...`. |
| [backend-e2e.txt](backend-e2e.txt) | `backend/test/user-agents.e2e-spec.ts`: 9/9 green, one test per scenario of the Feature "Agent definitions (API)", including a real backend restart on the same data dir. |
| [unit-tests.txt](unit-tests.txt) | Backend unit suite green, with 23 new tests in `user-agents.service.spec.ts` and `agents.service.spec.ts`. |
| [playwright-agents.txt](playwright-agents.txt) | `frontend/e2e/agents.spec.ts` 9/9 green on `E2E_BACKEND_PORT=3100`, a regression check for the Agents screen. |
| [get-agents-sample.json](get-agents-sample.json) | `GET /agents` after creating, publishing and pinning one user agent: the six built-ins plus the user agent, with `kind`, `status`, `owner`, `pinned` and `missingDatasets`. |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing, with 60 routes and 10 collections. |

The backend e2e spawns `node dist/main.js`, so run `npm run build` in `backend/` before `npx jest --config ./test/jest-e2e.json test/user-agents.e2e-spec.ts`.

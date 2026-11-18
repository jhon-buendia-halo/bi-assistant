# 1.1.19 — Intellify sample as a Testing Data fixture (BA-212)

Shipped on `main` as roadmap 1.1.2 (PR #77); renumbered 1.1.19, and this folder moved from `evidence/1.1.2/`, when `main` was merged into the BA-9 branch on 2026-10-15. The rest of this file is as written for 1.1.2.

Story [BA-212](https://halo-powered.atlassian.net/browse/BA-212), epic [BA-9](https://halo-powered.atlassian.net/browse/BA-9). Target: web app (Chromium, 1440×900). Desktop not run (not requested). Database: the shared sample PostgreSQL on 127.0.0.1:55432 (chosen by the user; Docker skipped through `.env.e2e.local`).

## E2E impact analysis (step 6)

Touched: `backend/src/modules/testing-data/fixtures/registry.ts` (catalogue entry), `fixtures/003_intellify.sql.gz` (seed), `scripts/generate-intellify-seed.py`. No frontend code changed. Feature **Testing data** ([spec](../../specs/capabilities/testing-data/spec.md)) had `E2E: none yet`, so it gets `frontend/e2e/testing-data.spec.ts` now.

| Scenario | Decision | Why |
|---|---|---|
| Lists the bundled samples and what is loaded | **Update** (automated now) | The catalogue gains a fourth card, Intellify `0/49`. Fails on the base commit (3 cards). |
| Loads the Intellify sample into a new database | **Add** | New fixture; loads into a uniquely named database the test drops afterwards, so the shared `intellify` database is never dropped. |
| Loads the World Cup sample, Cancels a load, Recreates a loaded sample, Creates a missing database (Formula 1), Tests the connection, Reports an unreachable server, Removes a sample, Remove is unavailable | Not automated (unchanged) | Behaviour unchanged by this story; the Feature's E2E line says which scenarios are automated. |
| Other Features | Re-run not needed | The catalogue is read only by Testing Data and the eval preflight; eval sets point at fixtures by id and none points at Intellify. |

Evals: not run. The change does not touch what an agent receives (prompt, skills, tools, context blocks or model routing).

## Results

- [e2e-web.txt](e2e-web.txt) — `npm run test:e2e -- e2e/testing-data.spec.ts`: 2 passed.
- [testing-data-samples-listed.png](testing-data-samples-listed.png) — the four samples in panel order, Intellify `0/49 entities`.
- [testing-data-intellify-loaded.png](testing-data-intellify-loaded.png) — after Load → Confirm: `49/49 entities`, the target database, and the toast `Seeded intellify on 127.0.0.1:55432 and loaded 49 entities into dataset "Intellify" — created the database`.
- [checks.txt](checks.txt) — unit tests, lint, builds, spec check, seed reproducibility and an API load smoke test.

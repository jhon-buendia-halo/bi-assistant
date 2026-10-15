# 1.14.13 (BA-226) — E2E impact analysis (workflow step 6)

Commit `be87321` (`feat(BA-226)`). Touched: the Intellify RFP API app (`backend/src/intellify-api/`: reads, auth guard, error filter, OpenAPI, db service), its embedded start (`app-bootstrap.ts`, `cli.ts`), the `intellify-api` Testing Data fixture (`testing-data/fixtures/registry.ts`, `testing-data.service.ts`), the Testing Data card (`testing-data-config.html/.ts`, `testing-data-api.service.ts`) and the E2E fixture (`INTELLIFY_API_PORT=0`, `RunningApp.intellifyApiUrl`). The RFP records and package in the same commit are analysed under 1.14.14.

Helpers checked (retrospective 1.13.13): `openTestingData`, `card`, `status` in `testing-data.spec.ts` use the test ids `testing-data-fixture-*`, `testing-data-status-*`, `testing-data-load-*`, `testing-data-confirm(-panel)-*`, which the reworked template keeps; the fixture's `startCli` now always passes `INTELLIFY_API_PORT=0`, so no test can collide on 3100.

| Feature (spec file) | Scenario | Decision | Why it fails on `origin/main` |
|---|---|---|---|
| Testing data (`frontend/e2e/testing-data.spec.ts`) | Lists the bundled samples and what is loaded | **Update** (the fifth sample, `intellify-api` "Intellify RFP API", 0/10; the SAMPLES row landed in `cac3cf8`) | base has four cards, the test expects five in order |
| Testing data | Loads the Intellify sample into a new database | Re-run as-is (template reworked) | — |
| Testing data | Registers the Intellify RFP API | **Add** | base has no `intellify-api` card, no `API URL:` line and no self-registering load |
| Testing data | Loads the World Cup sample, Cancels a load, Recreates, Creates a missing database, Tests the connection, Reports an unreachable server, Removes a sample, Remove is unavailable | unchanged, still `E2E: none yet` (not automated before this story) | — |
| Intellify RFP API (`backend/test/intellify-api.e2e-spec.ts`, API-level) | Reads need the API key; Collections page and describe themselves; Reads cannot write | Re-run as-is (written with the story) | the API does not exist on base |

Totals: Add 1, Update 1, Delete 0, Re-run as-is 1 Playwright + 14 API-level reads tests.

Not automated: the acceptance item "the plain assistant answers *How many clients are there?* over that dataset" needs a real model's SQL-free REST answer; with the stub it would prove nothing. It is left to the manual check and the evals.

Results: `e2e-results.txt` (Playwright) and `../1.14.14/e2e-results-backend.txt` (API-level). Screenshot: `testing-data-intellify-api-registered.png` (the card at 10/10 with the success toast).

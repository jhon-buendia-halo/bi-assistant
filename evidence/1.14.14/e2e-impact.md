# 1.14.14 (BA-227) — E2E impact analysis (workflow step 6)

Shipped inside commit `be87321` (`feat(BA-226)`) with 1.14.13. Touched: the `rfp` schema migration (`db/migrations/001_rfp_schema.sql`, `db.service.ts`), the RFP records module (`intellify-api/rfp/`: controller, service, repository, rules, DTOs, lookups) and the package module (`intellify-api/package/`: document, PDF, exhibits, zip). These are API-level, so the scenarios live in the API Feature's backend e2e, not in Playwright.

| Feature (spec file) | Scenario | Decision | Why it fails on `origin/main` |
|---|---|---|---|
| Intellify RFP API (`backend/test/intellify-api.e2e-spec.ts`) | An RFP is created, built up and exported | Re-run as-is (written with the story) | no API on base |
| Intellify RFP API | Status moves forward only and drafts alone can be deleted | Re-run as-is | no API on base |
| Intellify RFP API | (refusals of unknown clients, carriers, lines, plan designs; `createdBy` from `X-Qti-User` and the bulk delete) | Re-run as-is (edge cases of the same Feature) | no API on base |
| Intellify RFP API (`backend/test/intellify-api-reseed.e2e-spec.ts`, new file) | RFP records survive a reseed of the Intellify sample | **Add** (new Gherkin scenario; the roadmap acceptance "a reseed of the `intellify` schema leaves drafts intact" had no test) | no API and no `rfp` schema on base |

Totals: Add 1, Update 0, Delete 0, Re-run as-is 5 API tests.

How the reseed test stays off shared state: it boots the built backend (`dist/main.js`, `test/backend-process.ts`) with `INTELLIFY_DB_NAME=intellify_reseed_e2e_<ts>` (created before boot so the API migrates at start), seeds through `POST /testing-data/intellify/load`, saves a draft with a line and a carrier, seeds again (drop and replay of schema `intellify`), reads the RFP back, and drops the database with `WITH (FORCE)`. `intellify_mercer_demo` is never reseeded.

The acceptance item "the PDF opens and carries every section of the Markdown" is proven by the unit test `backend/src/intellify-api/package/pdf.spec.ts`; the e2e checks the `%PDF-` header and the zip.

Results: `e2e-results-backend.txt` (21/21 passed, nothing skipped).

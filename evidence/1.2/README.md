# Milestone 1.2 — merged epic branch verification (2026-10-02)

The three story branches (1.2.1 / BA-85, 1.2.2 / BA-86, 1.2.3 / BA-87) were merged into the single BA-2 epic branch. Conflicts: `backend/src/modules/data-models/data-models.controller.ts` (both stories appended endpoints), `changelog.md`, `gherkin.md`, `retrospective.md` — all resolved by keeping both sides. Per-story evidence lives in `evidence/1.2.1/`, `evidence/1.2.2/`, `evidence/1.2.3/`.

## Merged tree, run by the orchestrator after conflict resolution

| Check | Command | Result |
|---|---|---|
| Backend build | `npm run build` (backend/) | clean |
| Backend unit | `npm test` (backend/) | 47 suites, 946 tests passed |
| Backend e2e | `npm run test:e2e -- data-models` (backend/) | 25 scenarios passed (Feature: Data model) |
| Controller lint | `npx eslint src/modules/data-models/data-models.controller.ts` | clean |
| Frontend build | `npm run build` (frontend/) | clean |
| Frontend unit | `npm test -- --watch=false --browsers=ChromeHeadless` (frontend/) | 113 of 114; the failure is the pre-existing *App › keyboard resizing from the separator* |
| Playwright Electron suite | `E2E_SKIP_DOCKER=1 npm run test:e2e` (frontend/) | see `playwright-results.txt` |

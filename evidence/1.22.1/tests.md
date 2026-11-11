# Tests — 1.22.1

Written by `node scripts/qa.mjs 1.22.1 --gate` on 2026-11-11, epic base `origin/`. **Result: failed.**

| Step | Command | Result | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| build | `npm --prefix backend run build:all` | passed | — | — | — |
| backend unit | `npx jest --json --outputFile="C:\\Users\\jhonc\\Documents\\projects\\bi-assistant\\.claude\\worktrees\\M1-22-synthetic-data\\.qa-reports\\1.22.1\\jest.json"` | failed | 2726 | 43 | 0 |
| frontend unit | `npx ng test --watch=false --browsers=ChromeHeadless` | passed | 631 | 0 | 0 |
| backend lint | `npx eslint "{src,apps,libs,test}/**/*.ts" --rule "{\"prettier/prettier\": [\"error\", {\"endOfLine\": \"auto\"}]}"` | passed | — | — | — |
| check-specs | `py -3 scripts/check-specs.py` | passed | — | — | — |
| playwright (step 6) | `npx playwright test --project=web e2e/synthetic-data.spec.ts e2e/dataset-ontology.spec.ts e2e/dataset-schema-notes.spec.ts e2e/layout-accessibility.spec.ts e2e/navigation.spec.ts e2e/world-cup-workflow.spec.ts e2e/data-readiness.spec.ts` | failed | 47 | 1 | 0 |
| demo evidence | `demo.webm / demo.txt and the demo artifact link` | passed | — | — | — |

## Playwright specs (step 6)

| Spec | Listed in step 6 | Ran |
|---|---|---|
| `frontend/e2e/data-readiness.spec.ts` | yes | yes |
| `frontend/e2e/dataset-ontology.spec.ts` | yes | yes |
| `frontend/e2e/dataset-schema-notes.spec.ts` | yes | yes |
| `frontend/e2e/layout-accessibility.spec.ts` | yes | yes |
| `frontend/e2e/navigation.spec.ts` | yes | yes |
| `frontend/e2e/synthetic-data.spec.ts` | yes | yes |
| `frontend/e2e/world-cup-workflow.spec.ts` | yes | yes |

## Failed tests

- `layout-accessibility.spec.ts` › matches the stable application-shell visual baseline

## Artifacts

- [demo.webm](demo.webm)
- Playwright report (local): `.qa-reports/1.22.1/html/index.html`
- Command logs and reports (local): `.qa-reports/1.22.1/`

# Tests — 1.21.12

Written by `node scripts/qa.mjs 1.21.12 --gate` on 2026-11-10, epic base `main`. **Result: failed.**

| Step | Command | Result | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| build | `npm --prefix backend run build:all` | passed | — | — | — |
| backend unit | `npx jest --json --outputFile="C:\\Users\\jhonc\\Documents\\projects\\bi-assistant\\.claude\\worktrees\\BA-320-visuals-library\\.qa-reports\\1.21.12\\jest.json"` | failed | 2279 | 43 | 0 |
| frontend unit | `npx ng test --watch=false --browsers=ChromeHeadless` | passed | 516 | 0 | 0 |
| backend lint | `npx eslint "{src,apps,libs,test}/**/*.ts" --rule "{\"prettier/prettier\": [\"error\", {\"endOfLine\": \"auto\"}]}"` | passed | — | — | — |
| check-specs | `py -3 scripts/check-specs.py` | passed | — | — | — |
| playwright (step 6) | `npx playwright test --project=web e2e/visuals-library.spec.ts e2e/navigation.spec.ts e2e/user-personas.spec.ts e2e/dataset-ontology.spec.ts` | passed | 42 | 0 | 0 |
| demo evidence | `demo.webm / demo.txt and the demo artifact link` | passed | — | — | — |

## Playwright specs (step 6)

| Spec | Listed in step 6 | Ran |
|---|---|---|
| `frontend/e2e/dataset-ontology.spec.ts` | yes | yes |
| `frontend/e2e/navigation.spec.ts` | yes | yes |
| `frontend/e2e/user-personas.spec.ts` | yes | yes |
| `frontend/e2e/visuals-library.spec.ts` | yes | yes |

## Artifacts

- [demo.webm](demo.webm)
- Playwright report (local): `.qa-reports/1.21.12/html/index.html`
- Command logs and reports (local): `.qa-reports/1.21.12/`

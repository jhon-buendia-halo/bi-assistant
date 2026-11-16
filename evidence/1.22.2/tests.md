# Tests — 1.22.2

Written by `node scripts/qa.mjs 1.22.2 --gate` on 2026-11-11, epic base `origin/`. **Result: failed.**

| Step | Command | Result | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| build | `npm --prefix backend run build:all` | passed | — | — | — |
| backend unit | `npx jest --json --outputFile="C:\\Users\\jhonc\\Documents\\projects\\bi-assistant\\.claude\\worktrees\\M1-22-synthetic-data\\.qa-reports\\1.22.2\\jest.json"` | failed | 2726 | 43 | 0 |
| frontend unit | `npx ng test --watch=false --browsers=ChromeHeadless` | passed | 631 | 0 | 0 |
| backend lint | `npx eslint "{src,apps,libs,test}/**/*.ts" --rule "{\"prettier/prettier\": [\"error\", {\"endOfLine\": \"auto\"}]}"` | passed | — | — | — |
| check-specs | `py -3 scripts/check-specs.py` | passed | — | — | — |
| playwright (step 6) | `npx playwright test --project=web e2e/synthetic-data.spec.ts` | passed | 7 | 0 | 0 |
| demo evidence | `demo.webm / demo.txt and the demo artifact link` | passed | — | — | — |

## Playwright specs (step 6)

| Spec | Listed in step 6 | Ran |
|---|---|---|
| `frontend/e2e/synthetic-data.spec.ts` | yes | yes |

## Artifacts

- [demo.webm](demo.webm)
- Playwright report (local): `.qa-reports/1.22.2/html/index.html`
- Command logs and reports (local): `.qa-reports/1.22.2/`

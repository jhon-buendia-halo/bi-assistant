# Tests — 1.21.16

Written by `node scripts/qa.mjs 1.21.16 --gate` on 2026-11-10, epic base `main`. **Result: failed.**

| Step | Command | Result | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| build | `npm --prefix backend run build:all` | passed | — | — | — |
| backend unit | `npx jest --json --outputFile="C:\\Users\\jhonc\\Documents\\projects\\bi-assistant\\.claude\\worktrees\\BA-320-monitoring-area\\.qa-reports\\1.21.16\\jest.json"` | failed | 2417 | 43 | 0 |
| frontend unit | `npx ng test --watch=false --browsers=ChromeHeadless` | passed | 588 | 0 | 0 |
| backend lint | `npx eslint "{src,apps,libs,test}/**/*.ts" --rule "{\"prettier/prettier\": [\"error\", {\"endOfLine\": \"auto\"}]}"` | passed | — | — | — |
| check-specs | `py -3 scripts/check-specs.py` | passed | — | — | — |
| playwright (step 6) | `npx playwright test --project=web e2e/monitoring.spec.ts e2e/navigation.spec.ts` | passed | 17 | 0 | 0 |
| demo evidence | `demo.webm / demo.txt and the demo artifact link` | passed | — | — | — |

## Playwright specs (step 6)

| Spec | Listed in step 6 | Ran |
|---|---|---|
| `frontend/e2e/monitoring.spec.ts` | yes | yes |
| `frontend/e2e/navigation.spec.ts` | yes | yes |

## Artifacts

- [demo.webm](demo.webm)
- Playwright report (local): `.qa-reports/1.21.16/html/index.html`
- Command logs and reports (local): `.qa-reports/1.21.16/`

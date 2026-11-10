# Tests — 1.21.6

Written by `node scripts/qa.mjs 1.21.6 --gate` on 2026-11-10, epic base `HEAD`. **Result: failed.**

| Step | Command | Result | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| build | `npm --prefix backend run build:all` | passed | — | — | — |
| backend unit | `npx jest --json --outputFile="C:\\Users\\jhonc\\Documents\\projects\\bi-assistant\\.claude\\worktrees\\BA-119-harness-adjustments\\.qa-reports\\1.21.6\\jest.json"` | failed | 2250 | 43 | 0 |
| frontend unit | `npx ng test --watch=false --browsers=ChromeHeadless` | passed | 490 | 0 | 0 |
| backend lint | `npx eslint "{src,apps,libs,test}/**/*.ts" --rule "{\"prettier/prettier\": [\"error\", {\"endOfLine\": \"auto\"}]}"` | passed | — | — | — |
| check-specs | `py -3 scripts/check-specs.py` | passed | — | — | — |
| playwright (step 6) | `npx playwright test --project=web e2e/user-personas.spec.ts e2e/navigation.spec.ts` | passed | 18 | 0 | 0 |

## Playwright specs (step 6)

| Spec | Listed in step 6 | Ran |
|---|---|---|
| `frontend/e2e/navigation.spec.ts` | yes | yes |
| `frontend/e2e/user-personas.spec.ts` | yes | yes |

## Artifacts

- [demo.webm](demo.webm)
- Playwright report (local): `.qa-reports/1.21.6/html/index.html`
- Command logs and reports (local): `.qa-reports/1.21.6/`

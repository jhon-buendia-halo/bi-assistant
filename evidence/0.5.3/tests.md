# Tests — 0.5.3

Written by `node scripts/qa.mjs 0.5.3 --gate --no-demo` on 2026-11-11, epic base `4adf8b9`. **Result: passed.**

Demo: skipped (--no-demo, small change).

| Step | Command | Result | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| build | `npm --prefix backend run build:all (up to date, skipped)` | passed | — | — | — |
| backend unit | `npx jest --json --outputFile="/Users/jhonbuendia/conductor/workspaces/bi-assistant/bullard/.qa-reports/0.5.3/jest.json"` | passed | 2808 | 0 | 0 |
| frontend unit | `npx ng test --watch=false --browsers=ChromeHeadless` | passed | 631 | 0 | 0 |
| backend lint | `npx eslint "{src,apps,libs,test}/**/*.ts" --rule "{\"prettier/prettier\": [\"error\", {\"endOfLine\": \"auto\"}]}"` | passed | — | — | — |
| check-specs | `python3 scripts/check-specs.py` | passed | — | — | — |

## Playwright specs (step 6)

| Spec | Listed in step 6 | Ran |
|---|---|---|

## Artifacts

- Playwright report (local): `.qa-reports/0.5.3/html/index.html`
- Command logs and reports (local): `.qa-reports/0.5.3/`

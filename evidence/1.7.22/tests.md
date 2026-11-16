# Tests — 1.7.22

Written by `node scripts/qa.mjs 1.7.22 --gate --no-demo` on 2026-11-11, epic base `1931d19`. **Result: passed.**

Demo: skipped (--no-demo, small change).

| Step | Command | Result | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| build | `npm --prefix backend run build:all (up to date, skipped)` | passed | — | — | — |
| backend unit | `npx jest --json --outputFile="/Users/jhonbuendia/conductor/workspaces/bi-assistant/conakry/.qa-reports/1.7.22/jest.json"` | passed | 2818 | 0 | 0 |
| frontend unit | `npx ng test --watch=false --browsers=ChromeHeadless` | passed | 631 | 0 | 0 |
| backend lint | `npx eslint "{src,apps,libs,test}/**/*.ts" --rule "{\"prettier/prettier\": [\"error\", {\"endOfLine\": \"auto\"}]}"` | passed | — | — | — |
| check-specs | `python3 scripts/check-specs.py` | passed | — | — | — |

## Playwright specs (step 6)

| Spec | Listed in step 6 | Ran |
|---|---|---|

## Artifacts

- [demo.txt](demo.txt)
- Playwright report (local): `.qa-reports/1.7.22/html/index.html`
- Command logs and reports (local): `.qa-reports/1.7.22/`

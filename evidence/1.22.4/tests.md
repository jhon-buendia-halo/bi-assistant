# Tests — 1.22.4

Written by `node scripts/qa.mjs 1.22.4 --gate` on 2026-11-11, epic base `origin/`. **Result: failed.**

| Step | Command | Result | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| build | `npm --prefix backend run build:all` | passed | — | — | — |
| backend unit | `npx jest --json --outputFile="C:\\Users\\jhonc\\Documents\\projects\\bi-assistant\\.claude\\worktrees\\M1-22-synthetic-data\\.qa-reports\\1.22.4\\jest.json"` | failed | 2770 | 38 | 0 |
| frontend unit | `npx ng test --watch=false --browsers=ChromeHeadless` | passed | 631 | 0 | 0 |
| backend lint | `npx eslint "{src,apps,libs,test}/**/*.ts" --rule "{\"prettier/prettier\": [\"error\", {\"endOfLine\": \"auto\"}]}"` | passed | — | — | — |
| check-specs | `py -3 scripts/check-specs.py` | passed | — | — | — |
| playwright (step 6) | `npx playwright test --project=web e2e/synthetic-data.spec.ts e2e/data-readiness.spec.ts e2e/agent-panel.spec.ts` | passed | 33 | 0 | 0 |
| demo evidence | `demo.webm / demo.txt and the demo artifact link` | passed | — | — | — |

## Playwright specs (step 6)

| Spec | Listed in step 6 | Ran |
|---|---|---|
| `frontend/e2e/agent-panel.spec.ts` | yes | yes |
| `frontend/e2e/data-readiness.spec.ts` | yes | yes |
| `frontend/e2e/synthetic-data.spec.ts` | yes | yes |

## Artifacts

- [demo.webm](demo.webm)
- Playwright report (local): `.qa-reports/1.22.4/html/index.html`
- Command logs and reports (local): `.qa-reports/1.22.4/`

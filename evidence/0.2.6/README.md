# 0.2.6 — E2E and testing run against the web app; desktop only on request (BA-156)

| Artifact | Shows |
|---|---|
| [e2e-results-web.txt](e2e-results-web.txt) | `npx playwright test --project=web` after `npm run test:e2e:prepare`: **35 passed, 2 skipped (desktop only)**, 37 tests in 8 spec files. Every spec file ran against the web app (the npm CLI on a free port and a temp data dir, driven in Chromium). |
| [desktop-project-list.txt](desktop-project-list.txt) | `playwright test --project=desktop --list`: the same 37 tests are still selected for the Electron target. |
| [web-app-shell-1440x900.png](web-app-shell-1440x900.png) | The new web visual baseline (`application-shell-web-linux.png`), taken at the Electron window size. |

## Desktop not run

No desktop run was requested, so the Electron target was **not run** for this change. These scenarios are desktop-only and were skipped on web:

- `diagnostics.spec.ts` — "Captures live renderer failures, filters issues, and exports a redacted LLM-readable report" (shell-side redaction, native save dialog).
- `developer-settings.spec.ts` — "The desktop app offers to restart the backend" and "Restarting the backend applies the saved setting" (the "Restart backend" button).

The desktop target's other code paths also changed (launching through `app.fixture.ts`, the port-3000 check moving from global setup into the desktop launch, the `file://` reload in `world-cup-workflow.spec.ts`). They are type-checked but not executed.

## Scenarios mapped to Gherkin

- New browser scenarios in [specs/capabilities/developer-settings/spec.md](../../specs/capabilities/developer-settings/spec.md): "In a browser, the notice asks me to restart the CLI" and "Restarting the CLI applies the saved setting". Both passed.
- "Developer observability export": all 4 scenarios passed on web, restarting through the CLI.
- "LLM settings": the 2 relaunch scenarios passed on web with the CLI relaunched on the same data dir.

## Other checks

- `python3 scripts/check-specs.py`: all checks pass.
- `npx tsc -p e2e/tsconfig.json`: clean.
- Production code (`frontend/src`, `backend/src`) is unchanged, so backend and frontend unit tests were not re-run.

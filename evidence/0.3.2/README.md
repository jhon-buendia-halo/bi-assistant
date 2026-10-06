# Evidence — 0.3.2 Developer settings panel with observability toggle (BA-113)

## E2E
- [e2e-red-before-implementation.txt](e2e-red-before-implementation.txt): the new `frontend/e2e/developer-settings.spec.ts` was written before any code. All 6 tests failed for the right reason: there was no "Developer" row in Settings navigation.
- [e2e-results.txt](e2e-results.txt): the full `npm run test:e2e` run after implementation passed **26/26**, including the 6 `developer-settings.spec.ts` tests that mirror the Gherkin Feature "Developer settings" in [specs/capabilities/developer-settings/spec.md](../../specs/capabilities/developer-settings/spec.md). The `layout-accessibility` visual baseline is unchanged.
- An earlier full run had 2 `agents.spec.ts` failures at "Connection successful". The shared compose Postgres had just been started cold by global setup. The same spec passed 9/9 straight after, and the clean full run above passed. The cause was the environment, not this change.

## Screenshots (real Electron app, isolated data dir)
- [developer-settings-default-off.png](developer-settings-default-off.png): a fresh install shows the switch off, the default endpoints, Save disabled and no restart notice.
- [developer-settings-endpoint-tests.png](developer-settings-endpoint-tests.png): **Test** against a local receiver shows green "Reachable — … accepted an OTLP trace export in Nms". Against `127.0.0.1:1` it shows red "Unreachable — connect ECONNREFUSED".
- [developer-settings-restart-required.png](developer-settings-restart-required.png): after turning the switch on and saving, the toast reads "Developer settings saved — restart to apply", and the amber notice says the running backend has observability off, with **Restart backend**.
- [developer-settings-after-restart-on.png](developer-settings-after-restart-on.png): after **Restart backend**, the backend respawned, the notice is gone and the switch is on.

## Other checks
- Backend: `npm test` passes 702/702 (34 suites), including 10 new tests in `developer-settings.service.spec.ts`. `npm run build` passes.
- Lint: `npx eslint` on the new and changed backend files is clean.
  - Repo-wide, without `--fix`, there are 234 pre-existing problems in untouched files.
  - `npm run lint` runs `eslint --fix`, which rewrote 29 unrelated files. Those rewrites were reverted so that this PR only touches its own scope.
- Frontend: `npm test` (Karma) passes 84/84. `ng build` passes; the pre-existing bundle-size budget warning is unchanged.
- `python3 scripts/check-specs.py`: all checks pass.

# Evidence — 1.7.9 Fixed default APP_SECRET fallback (BA-106)

## The original failure
A desktop diagnostics report (generated 2026-10-06 UTC; failure at 2026-10-05 21:49 local) shows `GET /llm/settings` failing in `CryptoService.decrypt` with `Unsupported state or unable to authenticate data`. Earlier boots logged `APP_SECRET not set — using an insecure development default`. The failing boot did not, because Electron main had just created `.app-secret` for that data dir (file time matches the boot). The stored key had been encrypted under `insecure-dev-secret`.

## E2E
- [e2e-red-before-implementation.txt](e2e-red-before-implementation.txt): before the code, `frontend/e2e/llm-settings.spec.ts` had 2 passed and 2 failed. "keeps a key saved under the former development secret" got placeholder `sk-…` instead of the masked key. "asks for the key again when the app secret changed" found no notice. The system log showed the same `Unsupported state or unable to authenticate data`.
- [e2e-results.txt](e2e-results.txt): the full `npm run test:e2e` passed **34/34**, including all 4 scenarios in `llm-settings.spec.ts`. They mirror the "LLM settings" Feature in [specs/capabilities/llm-settings/spec.md](../../specs/capabilities/llm-settings/spec.md):
  - LenAI needs a deployment name and a base URL
  - Never shows the stored key
  - Keeps a key saved under the former development secret: saved with `APP_SECRET=insecure-dev-secret`, then relaunched with a generated `.app-secret`. The masked key shows, and a test with an empty key field reaches the stub with the original key.
  - Asks for the key again when the app secret changed: `.app-secret` was replaced between launches.

## Screenshots
- [llm-key-unreadable-notice.png](llm-key-unreadable-notice.png): the notice, with provider, deployment name and base URL kept and the key field empty.
- [llm-key-kept-after-secret-migration.png](llm-key-kept-after-secret-migration.png): after the migration, the masked key `••••••••1a2b` is shown and the test with the stored key succeeds.

## Real data
- [real-data-copy-check.txt](real-data-copy-check.txt): the fixed backend was run twice on a copy of the affected data dir (`~/Library/Application Support/frontend`, since deleted). Both runs returned `configured: true` and logged no errors.
- **Limit:** the user had already re-entered the key at 02:51 UTC, so the real ciphertext opens with the current secret and not with the former one. This check proves no regression for an already-readable key. The legacy migration path is proven by the E2E and the unit tests, not by real data.

## Other checks
- Backend `npm test`: 724/724 passed, including the new `crypto.service.spec.ts` (persisted secret, mode 0600, reuse, env precedence, `UnreadableSecretError`, re-encryption) and new `llm.service.spec.ts` cases (startup migration, unreadable view, re-entry message for agents and tests, save with a new key).
- Backend `npm run build`: passed.
- Lint: `npx eslint` repo-wide reports 233 problems, none in the new or changed source files. `llm.service.spec.ts` dropped from 8 problems to 5.
- Frontend `npm test`: 84/84 passed. `ng build`: passed.
- `python3 scripts/check-specs.py`: all checks passed.

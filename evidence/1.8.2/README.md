# 1.8.2 — Design tokens and light/dark theme switch (BA-143)

Run on 2026-10-09 in WSL2 (Ubuntu 26.04), Electron 44.3.0, against an isolated compose project (`COMPOSE_PROJECT_NAME=qti-ba-141`, `WORLD_CUP_DB_PORT=55433`).

| Artifact | Shows |
|---|---|
| [e2e-results.txt](e2e-results.txt) | Full `npm run test:e2e`: 37 passed, 1 failed. `appearance.spec.ts` (Feature "Appearance" in [app-shell](../../specs/capabilities/app-shell/spec.md)) passes 4/4. The failure is `layout-accessibility.spec.ts` › visual baseline: only `application-shell-darwin.png` exists, so it can't pass on Linux. The written `-linux.png` was deleted, not committed. Regenerating the baseline is roadmap 1.8.7. |
| [appearance-section-light.png](appearance-section-light.png), [appearance-section-dark.png](appearance-section-dark.png) | The running app: Settings → Appearance with Light and with Dark chosen. Only the page background and the section follow the theme so far, and the other surfaces stay on the legacy dark values. |
| [token-preview-light.png](token-preview-light.png), [token-preview-dark.png](token-preview-dark.png) | [theme-preview.html](theme-preview.html): the mockup's layout rendered with the real `frontend/src/styles/tokens.css`. The user approved both palettes from these on 2026-10-09. |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing. |
| [frontend-unit-tests.txt](frontend-unit-tests.txt) | `ng test` (headless Chromium): 88/89, including the 5 new `theme.service.spec.ts` tests. The failure (`App should support keyboard resizing`, 525 vs 548) fails the same way on unchanged `main` in this environment. |
| [backend-unit-tests.txt](backend-unit-tests.txt) | Backend Jest: 724/724. The backend is unchanged by this story. |

Not green, and not caused by this story: backend `eslint` reports 223 errors on code identical to `main`. Its `npm run lint` script runs with `--fix` and rewrote 29 backend files, which were reverted.

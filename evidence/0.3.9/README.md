# 0.3.9 — CLI flag to force developer observability on (BA-176)

Web target only (CLAUDE.md, *Test target convention*). The desktop app was not run: the flag belongs to the npm CLI and the new scenario is `@web-only`. The two `desktop` scenarios in `developer-settings.spec.ts` were skipped as usual (**desktop not run**).

| Artifact | Shows |
|---|---|
| [e2e-results.txt](e2e-results.txt) | `npm run test:e2e`: 86 passed, 2 skipped (desktop only), including the new *the --dev-observability CLI flag › turns observability on without changing the saved setting* (`frontend/e2e/developer-observability.spec.ts`) and the existing Developer settings and Developer observability export scenarios, re-run as-is. |
| [unit-build-lint.txt](unit-build-lint.txt) | Backend Jest 1056/1056 (19 in `developer-settings.service.spec.ts`, 10 of them new), backend build, eslint clean on the changed files, frontend `ng test` 297/297 and build, `check-specs.py` passing. Full-repo eslint is red on `main` too (243 problems before and after). |
| [live-check.txt](live-check.txt) | The worktree build started with `--dev-observability` on a fresh, isolated data dir (port 3105) against the real compose `observability` profile: the banner's `Observability:` line, `GET /developer-settings` with `observabilityForced: true` and `restartRequired: false`, no `developer-settings.json` written, the failed agent turn in Phoenix (project `questions-to-insights`, 16 spans, the root span `ERROR` with the missing-key message), and the run's requests in Grafana Tempo. The `trace_id` from the server log line finds the 8 spans of that run in Phoenix. |
| [developer-forced-notice.png](developer-forced-notice.png) | Settings → Developer during that run: the info note above the switch, the switch showing the saved value (off), no restart notice. |
| [agent-turn-without-model.png](agent-turn-without-model.png) | The traced turn as the user saw it. With no model configured the chat says "I completed the data analysis but could not produce a final response", which hides the real error that Phoenix shows. This is how the app behaved before this change; it is reported to the user, not changed here. |

Step 7 note: the new E2E scenario was written before the implementation but was first run after it, so there is no recorded red run for it. The new unit tests were run red first (10 failing: `DEV_OBSERVABILITY_ENV` undefined).

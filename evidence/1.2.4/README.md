# 1.2.4 — Data model on main (BA-2)

The BA-2 branch after renumbering (ADR-0013/0014, M14, endpoints 94-112), merging `main` v0.30.0 (local-mode sign-in, roadmap 2.1.7) and the BA-89 branch (PR #70). Web target; desktop not run (not requested). World Cup Postgres: an isolated `docker compose -p qti-ba2` stack on port 55442 with `E2E_SKIP_DOCKER=1`, removed afterwards.

| Artifact | Shows |
|---|---|
| [e2e-results-web.txt](e2e-results-web.txt) | `playwright test --project=web` after `npm run test:e2e`'s build: 93 passed, 2 skipped. The skipped ones are desktop only (**desktop not run**): developer-settings "the desktop app offers to restart the backend", diagnostics "captures live renderer failures…". `data-model-editing.spec.ts` 7/7. |
| [e2e-results-org.txt](e2e-results-org.txt) | `playwright test --project=org`: 48 passed, including org-permissions "a User can read a dataset's data model but not change it". |
| [backend-e2e-results.txt](backend-e2e-results.txt) | Backend e2e: 10 suites pass (305 tests), including `data-models.e2e-spec.ts` 25/25 signed in as Demo User, `data-models-org.e2e-spec.ts` and `local-auth.e2e-spec.ts` with the data model permission case (Demo User reaches the handlers, Uma User reads and gets 403 on a write). `app.e2e-spec.ts` fails to load (ESM `uuid` from `thrift`), the same failure as on `main`. |
| [backend-unit-results.txt](backend-unit-results.txt) | Backend Jest: 77 suites, 1392/1392. |
| [frontend-unit-results.txt](frontend-unit-results.txt) | `ng test --watch=false`: 355/356; the failing *App › keyboard resizing from the separator* fails the same on `main` (296/297). `npm run build` in both projects is clean. |
| [backend-lint-vs-main.txt](backend-lint-vs-main.txt) | `eslint` without `--fix`, per file, against `main`: the only new errors were 9 Prettier wraps in the two edited e2e specs, then fixed; the rest is `main`'s own 221. |
| [check-specs.txt](check-specs.txt) | `check-specs.py --base origin/main` passes, fragments included. |
| `data-model-overview-light.png`, `data-model-overview-dark.png` | The Data model view in main's look, both themes: entities, relationships with cardinality, and the metric with its author "by Demo User" (local mode records the signed-in persona since 2.1.7). |
| `data-model-yaml-error.png` | An invalid YAML edit rejected with its path, line and column, line 11 highlighted. |
| `data-model-versions-diff.png` | Versions tab after a revert: v1 current, the v1 → v2 diff. |
| `data-model-metrics.png` | A metric defined in the Metrics tab, with its author. |

Wireframes: not updated. BA-2's screens predate the wireframe convention (BA-172); adding the data model pages and updating the as-built pages it changed is a follow-up.

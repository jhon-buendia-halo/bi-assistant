# 1.19.1 — US Health sample as a Testing Data fixture (BA-306)

Epic [BA-305](https://halo-powered.atlassian.net/browse/BA-305). Verified on the web target, 2026-11-04. Desktop not run (no desktop-only scenario is touched).

| File | Shows |
|---|---|
| [e2e-results.txt](e2e-results.txt) | `frontend/e2e/testing-data.spec.ts` on the web target: 4 passed, including the new "loads the US Health sample into a new database" (seeds it, registers it and reports 45/45) and the updated listing test (six samples, US Health after Intellify). |
| [testing-data-us-health-loaded.png](testing-data-us-health-loaded.png) | The US Health card at `45/45 entities`, its description and target, and the toast `Seeded us_health on 127.0.0.1:55432 and loaded 45 entities into dataset "US Health" — created the database`. |
| [testing-data-samples-listed.png](testing-data-samples-listed.png) | The Testing Data panel listing the six samples before any load. |
| [generator-tests.txt](generator-tests.txt) | `scripts/test_us_health_signals.py` (13 tests: the 7 planted signals) and `scripts/test_us_health_structure.py` (16 tests: the 6 planted defects, byte-for-byte reproducibility of the committed seed, the 45 required entities, 55 foreign keys with no orphan values, every table and column commented, unique primary keys): 29 passed. |
| [seed-facts.md](seed-facts.md) | Row counts per table (713,760 in total), FK count, gzipped size (12,088,897 bytes) and sha256. |

Other checks at the acceptance gate:
- Backend `npm test` 2,074 passed (127 suites).
- Frontend `ng test` 384 passed.
- Backend lint 0 errors. The 8 warnings are all in files this change does not touch.
- `build:all` green; `python3 scripts/check-specs.py` ALL CHECKS PASSED.

Through the API on an isolated CLI instance, the load took 7.4–7.9 s, and the "US Health" dataset carried 62 column join references across 36 entities. Remove returned `Removed the US Health datasource and dataset from this app. The database itself was left untouched.`

No eval gate: no agent's prompt, tools, skills, context or model routing changed.

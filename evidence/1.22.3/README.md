# 1.22.3 — Databricks SQL script

- **Demo artifact:** https://claude.ai/artifact/Xu1XJN5jpHLZM12etmtN7u (private until shared from its Share menu).
- **Demo:** [demo.txt](demo.txt), the transcript of the checks (no UI scenario: the Generate button already exists). The writer is covered by inline golden specs and the statement smoke check; the live run in a scratch Databricks schema (plan Q1) is still to do with the user.
- **Fast loop (2026-11-11):** `node scripts/qa.mjs 1.22.3 --fast --base c8b095e`: build, related backend and frontend unit tests, `check-specs`, `synthetic-data.spec.ts` (7 scenarios) and the demo all passed.
- **Gate results (2026-11-11):** [tests.md](tests.md), written by `node scripts/qa.mjs 1.22.3 --gate --base origin/main`: build, frontend unit, backend lint, check-specs and `synthetic-data.spec.ts` passed. Backend unit failed only in suites that fail on `main` on this Windows checkout (CRLF fixtures, file mode, symlink permission), none in the synthetic-data code. Desktop not run. Accepted by the user by hand on 2026-11-11.

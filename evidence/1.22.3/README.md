# 1.22.3 — Databricks SQL script

- **Demo artifact:** https://claude.ai/artifact/Xu1XJN5jpHLZM12etmtN7u (private until shared from its Share menu).
- **Demo:** [demo.txt](demo.txt), the transcript of the checks (no UI scenario: the Generate button already exists). The writer is covered by inline golden specs and the statement smoke check; the live run in a scratch Databricks schema (plan Q1) is still to do with the user.
- **Fast loop (2026-11-11):** `node scripts/qa.mjs 1.22.3 --fast --base c8b095e`: build, related backend and frontend unit tests, `check-specs`, `synthetic-data.spec.ts` (7 scenarios) and the demo all passed.
- **Gate results:** pending the user's acceptance (`node scripts/qa.mjs 1.22.3 --gate`).

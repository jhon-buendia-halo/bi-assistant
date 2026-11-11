# 1.22.1 — Sampled profile in the dataset editor

- **Demo artifact:** https://claude.ai/artifact/XmNDHjkDkrynx74CNuQua2 (private until shared from its Share menu). It shows the captioned video, scope and acceptance.
- **Demo video:** [demo.webm](demo.webm), the scenario "Profile a sample of World Cup" (`frontend/e2e/synthetic-data.spec.ts`, tags `@demo` `@story-1.22.1`), recorded by `node scripts/qa.mjs 1.22.1 --fast`.
- **Sampling timings:** [sampling-timings.md](sampling-timings.md), timed live before integration: PostgreSQL World Cup and US Health, and Databricks `samples.tpch` plus `tpch_sf1000.lineitem`. The 6-billion-row cold run led to the Databricks size guard.
- **Fast loop (2026-11-11):** build passed (the existing initial-bundle budget warning only), related backend unit tests 373/373 in 19 suites, related frontend unit tests 13/13, `check-specs` all passed, `synthetic-data.spec.ts` 1/1, and the demo recorded.
- **Gate results:** pending the user's acceptance (`node scripts/qa.mjs 1.22.1 --gate`).

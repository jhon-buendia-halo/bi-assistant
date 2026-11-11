# 1.22.2 — Synthetic data script for PostgreSQL

- **Demo artifact:** https://claude.ai/artifact/6VM8BvAdknGckXTf39Qh4L (private until shared from its Share menu).
- **Demo video:** [demo.webm](demo.webm), the scenario "Generate a PostgreSQL script" (`frontend/e2e/synthetic-data.spec.ts`, tags `@demo` `@story-1.22.2`). The untagged scenario "The script replays into an empty PostgreSQL database" loads the script into a scratch database and checks row counts, FK constraints and the stable SHA-256.
- **Fast loop (2026-11-11):** `node scripts/qa.mjs 1.22.2 --fast --base c8b095e`: build, related backend and frontend unit tests, `check-specs`, `synthetic-data.spec.ts` (7 scenarios) and the demo all passed.
- **Gate results (2026-11-11):** [tests.md](tests.md), written by `node scripts/qa.mjs 1.22.2 --gate --base origin/main`: build, frontend unit, backend lint, check-specs and `synthetic-data.spec.ts` passed. Backend unit failed only in suites that fail on `main` on this Windows checkout (CRLF fixtures, file mode, symlink permission), none in the synthetic-data code. Desktop not run. Accepted by the user by hand on 2026-11-11.

# 1.22.6 — Export the raw sample

- **Demo artifact:** https://claude.ai/artifact/MuBFZgf81uTBBxeJTiRbuG (private until shared from its Share menu).
- **Demo video:** [demo.webm](demo.webm), the scenario "Export the real sample rows after confirming" (`@demo` `@story-1.22.6`). The untagged scenario "Cancelling the confirm downloads nothing" covers Cancel.
- **Fast loop (2026-11-11):** `node scripts/qa.mjs 1.22.6 --fast --base c8b095e`: build, related backend and frontend unit tests, `check-specs`, `synthetic-data.spec.ts` (7 scenarios) and the demo all passed.
- **Gate results (2026-11-11):** [tests.md](tests.md), written by `node scripts/qa.mjs 1.22.6 --gate --base origin/main`: build, frontend unit, backend lint, check-specs and `synthetic-data.spec.ts` passed. Backend unit failed only in suites that fail on `main` on this Windows checkout (CRLF fixtures, file mode, symlink permission), none in the synthetic-data code. Desktop not run. Accepted by the user by hand on 2026-11-11.

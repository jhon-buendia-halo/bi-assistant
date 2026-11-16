# 1.22.5 — Export synthetic data and the profile as CSV and Excel

- **Demo artifact:** https://claude.ai/artifact/WM5957VQ44HVjxL1i5jQ1E (private until shared from its Share menu).
- **Demo video:** [demo.webm](demo.webm), the scenario "Download the synthetic data as CSV and Excel" (`@demo` `@story-1.22.5`). The untagged scenario "Export the profile" covers the profile CSV and workbook.
- **Fast loop (2026-11-11):** `node scripts/qa.mjs 1.22.5 --fast --base c8b095e`: build, related backend and frontend unit tests, `check-specs`, `synthetic-data.spec.ts` (7 scenarios) and the demo all passed.
- **Gate results (2026-11-11):** [tests.md](tests.md), written by `node scripts/qa.mjs 1.22.5 --gate --base origin/main`: build, frontend unit, backend lint, check-specs and `synthetic-data.spec.ts` passed. Backend unit failed only in suites that fail on `main` on this Windows checkout (CRLF fixtures, file mode, symlink permission), none in the synthetic-data code. Desktop not run. Accepted by the user by hand on 2026-11-11.

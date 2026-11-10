# 1.21.12 — Visuals library on the Context page

- **Demo artifact:** https://claude.ai/artifact/SPwXiaHjCn6NQL92pzbN1d (private until shared from its Share menu)
- **Demo video:** [demo.webm](demo.webm), the scenario "Browse the library and edit a chart in place" (`frontend/e2e/visuals-library.spec.ts`, tags `@demo` `@story-1.21.12`), recorded by `node scripts/qa.mjs 1.21.12 --fast --base main`.
- **Fast loop:** build, related backend unit tests, related frontend unit tests, `visuals-library.spec.ts` (2 tests) and the demo all passed. `check-specs` failed on the first run because the spec's E2E reference was a Markdown link instead of `` E2E: `<path>` ``; it passes after the fix.
- **Gate results:** not run yet (acceptance gate).

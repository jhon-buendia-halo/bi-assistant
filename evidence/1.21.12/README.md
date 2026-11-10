# 1.21.12 — Visuals library on the Context page

- **Demo artifact:** https://claude.ai/artifact/SPwXiaHjCn6NQL92pzbN1d (private until shared from its Share menu). It shows the captioned video, scope, acceptance and the gate results.
- **Demo video:** [demo.webm](demo.webm), the scenario "Browse the library and edit a chart in place" (`frontend/e2e/visuals-library.spec.ts`, tags `@demo` `@story-1.21.12`), recorded by `node scripts/qa.mjs 1.21.12 --fast --base main`.
- **Step-6 list:** [e2e-impact.md](e2e-impact.md).
- **Gate results:** [tests.md](tests.md), written by `node scripts/qa.mjs 1.21.12 --gate --base main`.
  - Playwright, the 4 listed specs: 42 passed, 0 failed (`visuals-library.spec.ts` covers every scenario of `Feature: Visuals library`).
  - check-specs, the build and the new demo-evidence step passed.
  - Backend unit: 43 failures in 10 suites (`app-skills`, `assistant.agent`, `rfp.agent`, `panel-items`, `data-readiness.agent`, `rfp-skill`, `deep-analysis.phases`, `crypto.service`, `system-agents`, `intellify-api document`). They are the same 43 that fail on `main` on this Windows checkout (CRLF fixtures, file mode); none is in the visuals module, whose suites pass.
  - Frontend unit 516/516 and backend lint passed on the final run. The first gate run had one frontend failure, `PromptEditor inserts the chosen link as [[kind:name]]` ("collapseToEnd: there is no selection", a focus-dependent flake in a component this branch does not touch; 9/9 three times on its own), and one lint error, a mixed line ending added to `doc-store.ts`, fixed before the re-run.
- **Fast loop:** build, related unit tests, `visuals-library.spec.ts` and the demo passed; `check-specs` failed once on the spec's E2E reference format (a Markdown link instead of `` E2E: `<path>` ``) and passes after the fix.
- **Manual check:** the page at 1440×900 in light and dark themes, the in-place editor, no console errors (screenshots not committed). The user tested it by hand and accepted it on 2026-11-10.
- **Desktop:** not run (web target only).

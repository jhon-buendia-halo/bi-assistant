# 1.21.14 — LLM calls table on the Monitoring page

- **Demo artifact:** https://claude.ai/artifact/AboL8p2paoviyVzicp6MyJ (private until shared from its Share menu). It shows the captioned video, scope, acceptance and the gate results.
- **Demo video:** [demo.webm](demo.webm), the LLM calls table after a chat turn (`frontend/e2e/monitoring.spec.ts`), recorded by `node scripts/qa.mjs 1.21.14 --fast --base main`.
- **Step-6 list:** [e2e-impact.md](e2e-impact.md).
- **Gate results:** [tests.md](tests.md), written by `node scripts/qa.mjs 1.21.14 --gate --base main`.
  - Playwright, the step-6 specs (`monitoring.spec.ts`, `navigation.spec.ts`): 17 passed, 0 failed. check-specs, the build, backend lint and the demo-evidence step passed.
  - Backend unit: 43 failures in 10 suites (`app-skills`, `assistant.agent`, `rfp.agent`, `panel-items`, `data-readiness.agent`, `rfp-skill`, `deep-analysis.phases`, `crypto.service`, `system-agents`, `intellify-api document`), the same 43 that fail on `main` on this Windows checkout (CRLF fixtures, file mode); the 138 monitoring tests pass.
  - Frontend unit: 588/588 in the 1.21.13 and 1.21.16 runs; the 1.21.14 and 1.21.15 runs had 3 `UiPreferencesService` failures (a flake in a service this branch does not touch, green in the other two runs).
- **Manual check:** the user tested it by hand on the isolated instance (port 3401) and accepted it on 2026-11-10.
- **Desktop:** not run (web target only).

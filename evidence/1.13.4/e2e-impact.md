# 1.13.4 — E2E impact analysis (workflow step 6)

Change: the three deep-analysis prompts move into `skills/deep-analysis/phases/*.md`. `DeepAnalysisService` loads one phase file per call and fills its `{{placeholders}}`, so the prompts it sends are byte-identical to before.

Touched: `modules/deep-analysis/deep-analysis.service.ts`, `modules/deep-analysis/deep-analysis.phases.ts` (new), `mastra/skills/deep-analysis/**` (new).

| Scenario | Decision |
|---|---|
| deep-analysis Feature(s) | No Playwright spec drives deep analysis (`E2E: none yet`), and no Gherkin changes: behaviour is unchanged by construction. Covered by Jest: two golden tests in `deep-analysis.service.spec.ts` assert the exact plan, investigate and report prompts. They were captured from the code before the refactor and pass unchanged after it. Seven tests in `deep-analysis.phases.spec.ts` cover placeholder filling, an unfilled or missing placeholder throwing, and each call carrying only its own phase. |
| every other Feature | Re-run as-is (full web and org suites), which also proves the bundled skill passes the startup check. |

# Evidence — 1.13.4 Phased deep-analysis skill (BA-202)

Epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198).

| File | What it shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step-6 analysis: no Playwright spec drives deep analysis. Byte-identity is proved with golden tests. |

- `skills/deep-analysis/SKILL.md` is the phase map: plan, then investigate each angle, then write the report, in order and with no approval gate. `phases/1-plan.md`, `phases/2-investigate.md` and `phases/3-report.md` hold the prompts, with `{{placeholders}}`.
- `deep-analysis.phases.ts` fills the placeholders by exact one-pass replacement. A placeholder left unfilled, or a required one missing from the file, throws.
- Golden tests in `deep-analysis.service.spec.ts`: the exact plan, investigate and report prompts were captured from the code **before** the refactor as string literals, and they pass unchanged **after** it, so the model receives identical input. `deep-analysis.phases.spec.ts` (7 tests) covers filling, the failures and each call carrying only its own phase.
- The built CLI started with the new skill and answered 200 on `/`, with no `Invalid app skills`.

Gates on the integrated epic head (`49184ac`, all three stories merged), shared with 1.13.4 and 1.13.5:

- Playwright web: **89 passed, 2 skipped** ([../1.13.5/e2e-web.txt](../1.13.5/e2e-web.txt)). Org: **47 passed** ([../1.13.5/e2e-org.txt](../1.13.5/e2e-org.txt)).
- Frontend unit at 1440×900: **297 passed** ([../1.13.5/ng-test.txt](../1.13.5/ng-test.txt)).
- Backend `npx jest`: **65 suites, 1091 tests passed**. `tsc` shows only the 4 known errors (3 in `llm.service.spec.ts`, 1 in `test/app.e2e-spec.ts`). ESLint per touched file matches the base `f3ef18e`, and the new files are at 0. `check-specs.py` passes.
- **Desktop not run:** `developer-settings.spec.ts` "the desktop app offers to restart the backend…" and `diagnostics.spec.ts` "captures live renderer failures…" are desktop-only. They were skipped on web, and no desktop run was requested.
- **Evals:** the world-cup set before and after the epic: [../1.13.5/README.md](../1.13.5/README.md#evals).

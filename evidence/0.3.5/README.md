# Evidence — 0.3.5 Agent trace export to Arize Phoenix gated by the developer setting (BA-116)

## E2E
- [e2e-red-before-implementation.txt](e2e-red-before-implementation.txt): the new scenario "Agent runs reach Phoenix when observability is on" failed before the code. The question was sent, but the Phoenix receiver got nothing. The two BA-115 scenarios stayed green.
- [e2e-results.txt](e2e-results.txt): the full `npm run test:e2e` passed **29/29**. That includes all 3 scenarios of the Feature "Developer observability export" in [specs/capabilities/developer-settings/spec.md](../../specs/capabilities/developer-settings/spec.md).
  - The Phoenix scenario creates a World Cup session with no model configured and `OPENAI_API_KEY` removed. It then asks a question, so the real `assistant` agent run fails at the model call and is still exported.
  - The "off" scenario now asserts that neither receiver gets any request.

## Against the real tools (Phoenix `arizephoenix/phoenix:version-20.19.0` from the BA-114 profile)
- [app-chat-question-sent.png](app-chat-question-sent.png): the question sent in the app with developer observability on.
- [phoenix-projects.png](phoenix-projects.png): Phoenix shows the **questions-to-insights** project, with 2 traces and 1 session, last updated less than a minute ago.
- [real-phoenix-spans.txt](real-phoenix-spans.txt): the 16 spans from Phoenix's REST API. Each run has `invoke_agent Questions to Insights Assistant` (status ERROR "Could not find API key …", as expected), `model_step`, `model_inference`, `chat gpt-4o-mini`, `memory_operation MessageHistory`, `skill_action` and `workspace_action`.

## Off means nothing loaded
- Loading the built `dist/mastra/index.js` with the setting off loaded **no** `@opentelemetry/*` or `@mastra/arize` module. With it on, `@mastra/arize` and its OpenTelemetry exporter stack load. This was checked through `require.cache`.
- `developer-exporters.spec.ts` checks that with the setting off the loader is never called, that with it on the exporter gets `<Phoenix>/v1/traces` and the project name, and that a load failure leaves only the local store.

## Other checks
- Backend: `npm test` passes 708/708 (36 suites). `npm run build` passes. `npx eslint` on the changed files is clean, and the repo-wide count is unchanged at 234 pre-existing problems.
- `@mastra/arize` is pinned at **1.3.16**: its `@mastra/otel-exporter` 1.3.16 depends on `@mastra/observability` 1.17.8, the repo's pin, and is deduped. The latest arize release (1.3.21) would have pulled in observability 1.18.3 alongside 1.17.8.
- Frontend: `npm test` passes 84/84. `python3 scripts/check-specs.py`: all checks pass.

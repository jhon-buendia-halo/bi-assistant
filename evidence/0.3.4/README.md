# Evidence — 0.3.4 OpenTelemetry bootstrap gated by the developer setting (BA-115)

## E2E
- [e2e-red-before-implementation.txt](e2e-red-before-implementation.txt): the new `frontend/e2e/developer-observability.spec.ts` was run before the code.
  - "Backend traces reach the OTLP endpoint when observability is on" failed: the receiver got 0 traces.
  - "Nothing is exported when observability is off" already passed. It is the guard that stays green.
- [e2e-results.txt](e2e-results.txt): the full `npm run test:e2e` passed **28/28**. That includes both scenarios of the Gherkin Feature "Developer observability export" in [specs/capabilities/developer-settings/spec.md](../../specs/capabilities/developer-settings/spec.md). Each scenario points the OTLP endpoint at a local stub receiver, saves, clicks **Restart backend** and opens LLM Configuration.
  - On: the receiver gets `application/x-protobuf` trace data naming `questions-to-insights` and `/llm/settings`.
  - Off: the receiver gets no request at all in 12 s, which is longer than the 5 s batch delay and the 10 s metric interval.

## Against the real tools
- [real-grafana-verification.txt](real-grafana-verification.txt): a backend started with the setting on (temporary data dir, port 3123) exported to `grafana/otel-lgtm:0.35.0` from the BA-114 compose profile.
  - Tempo shows the `questions-to-insights` traces. For `POST /datasources/test-connection` it has the full chain: http → nestjs-core (`DatasourcesController.testConnection`) → express/router → `pg.connect` and `pg.query:SELECT world_cup`.
  - Prometheus received `http_server_request_duration_seconds_*` and `http_client_request_duration_seconds_*`.

## Other checks
- Backend: `npm test` passes 705/705 (35 suites). That includes `developer-telemetry.spec.ts`, which checks that with the setting off the loader is never called and no `@opentelemetry` module is in `require.cache`. `npm run build` passes.
- Lint: `npx eslint` on the changed files is clean. The repo-wide count is unchanged at 234 pre-existing problems.
- Frontend: `npm test` passes 84/84.
- `python3 scripts/check-specs.py`: all checks pass.

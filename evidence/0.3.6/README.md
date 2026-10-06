# Evidence — 0.3.6 Backend logs exported with trace ids (BA-117)

## E2E
- [e2e-red-before-implementation.txt](e2e-red-before-implementation.txt): the new scenario "Backend logs reach the OTLP endpoint when observability is on" failed before the code, because `/v1/logs` received nothing. The 3 earlier scenarios stayed green.
- [e2e-results.txt](e2e-results.txt): the full `npm run test:e2e` passed **30/30**. That includes all 4 scenarios of the Feature "Developer observability export" in [specs/capabilities/developer-settings/spec.md](../../specs/capabilities/developer-settings/spec.md). The "off" scenario still asserts that no request reaches either receiver.

## Console output unchanged (R26)
- [console-unchanged.txt](console-unchanged.txt): the backend's console output with the setting off and on, normalized for colours, timestamps, PIDs and `+Nms` values, is **identical** (84 lines each).
- The first implementation installed a custom Nest logger. This diff caught that it dropped Nest's `+Nms` suffix. The final version wraps `ConsoleLogger.prototype.printMessages` instead, and Pino trace-field injection is disabled (`disableLogCorrelation`), so stdout, and with it the desktop system-logs panel, is untouched.

## Against the real tools (`grafana/otel-lgtm:0.35.0`)
- [real-loki-trace-link.txt](real-loki-trace-link.txt), from a backend with the setting on, on port 3123:
  - A failing `POST /datasources/test-connection` logged `WARN [PostgresConnector] Postgres call failed: connect ECONNREFUSED 127.0.0.1:1`.
  - In **Loki** that line has `severity_text=WARN`, context `PostgresConnector`, and a `trace_id` and `span_id`.
  - The `trace_id` resolves in **Tempo** to the trace whose root span is `POST /datasources/test-connection`.
  - 93 log lines from one startup and one request reached Loki.
- The same file shows Mastra's `PinoLogger` (pino 10, inside the instrumentation's `>=5.14.0 <11` range): a probe line reached `/v1/logs`, and its pretty console format was unchanged.

## Other checks
- Backend: `npm test` passes 709/709. That includes `developer-nest-logger.spec.ts`: it prints as before, emits one record with severity and context, and installing twice is a no-op. `npm run build` passes. `npx eslint` on the changed files is clean, and the repo-wide count is unchanged at 234.
- Frontend: `npm test` passes 84/84. `python3 scripts/check-specs.py`: all checks pass.

# 0.3.8 — Dev runs require local observability (BA-175)

Docs and process only: the rule *Observed dev runs* in `CLAUDE.md`, *Development runs are observed* in `specs/system/delivery.md` (section 1, *Local run recipes*, and a pointer from *Observability profile*), and step 2a in `docs/observability.md`. No product code changes in this story; the flag it relies on is 0.3.9.

The rule's commands were exercised end to end for 0.3.9: compose `observability` profile up (Phoenix and Grafana `otel-lgtm`), the CLI started with `--dev-observability`, the banner's `Observability:` line, and an error found in Phoenix from the `trace_id` in its log line. See [../0.3.9/live-check.txt](../0.3.9/live-check.txt). `python3 scripts/check-specs.py` passes: [../0.3.9/unit-build-lint.txt](../0.3.9/unit-build-lint.txt).

The Playwright suite stays the exception: the fixture now removes `QTI_DEV_OBSERVABILITY` from the app's environment, so a developer's shell that follows the rule can't turn observability on in tests ([../0.3.9/e2e-results.txt](../0.3.9/e2e-results.txt): 86 passed).

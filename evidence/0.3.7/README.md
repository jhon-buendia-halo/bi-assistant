# Evidence — 0.3.7 Developer docs for the local observability stack (BA-118)

Docs only: no product code changed in this story. The E2E suite for the whole stack is green on the BA-117 branch (30/30, [evidence/0.3.6/](../0.3.6/)).

- [cli-path-verification.txt](cli-path-verification.txt): [docs/observability.md](../../docs/observability.md) was followed with the npm CLI (web mode) against the real `observability` compose profile.
  - Saving the setting returned "restart to apply". After restarting the CLI, the setting was active and the notice was gone.
  - Loki showed the CLI's startup log, and Tempo showed its request traces. They appeared 30–50 s after the requests, a lag the guide's troubleshooting section now describes.
- The guide's Loki → Tempo link claim was checked against the Grafana Loki datasource config (`derivedFields`: label `trace_id` → Tempo, shown as "Trace: <id>").
- The desktop path in the guide (Settings → Developer, **Test**, **Save**, **Restart backend**) is the flow covered by `developer-settings.spec.ts` and `developer-observability.spec.ts`, with real-tool screenshots in [evidence/0.3.5/](../0.3.5/).
- `python3 scripts/check-specs.py`: all checks pass, including the new links from README.md and roadmap.md.

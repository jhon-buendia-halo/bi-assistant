# 1.20.4 — Live progress while a Data Readiness assessment runs (BA-324)

SSE frames of a real assessment (built CLI, scripted LLM, `us_health`, 41 tables), arrival time at the client in ms since the request — progress arrives live, during the tool call:

```
 158 ms tool            {"name":"assess_data_readiness","input":"US"}
 165 ms tool-progress   inventory  "Listing tables…"
 201 ms tool-progress   profiling  "Profiling us_health.… (1/41)…"   (then every few ms)
 792 / 1533 / 3242 ms   profiling  slow tables
3242 ms tool-progress   relationships "Checking relationships…"
3342 ms tool-progress   scoring "Running checks…", storing "Writing the report…"
3342 ms readiness-report, tool-result
3350 ms text            3436 ms done
```

A headless Chromium on the built web UI showed the `tool-progress` line ("Listing tables…" → "Profiling us_health.… (n/41)…" → "Checking relationships…") on the running row and removed it when the result landed.

The gate's E2E found that the SSE endpoints sent `text/event-stream` without a charset, so Chromium's network layer decoded "…" as Windows-1252 ("â€¦") in the body Playwright reads; the app's own `fetch` + `TextDecoder` was unaffected. Both SSE endpoints now send `charset=utf-8`.

[e2e-results.txt](e2e-results.txt): "assessing a dataset from the chat shows the scorecard" asserts the `tool-progress` frames, in phase order, between `tool` and `tool-result` (World Cup, 12 tables).

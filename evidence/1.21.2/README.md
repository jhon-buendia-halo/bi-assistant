# 1.21.2 — Auto-configure local instances: testing data and custom LLM (BA-325)

Ships `scripts/setup-local.mjs [baseUrl]`, a developer script that configures a running instance through its API: it saves the LLM settings from the gitignored `.env.llm.local` (`LLM_PROVIDER`, `LLM_API_STYLE`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`; the connection is tested by the save), then loads every seedable Testing Data fixture and the Intellify RFP API, skipping those already loaded. A committed `.env.llm.example` documents the variables; delivery.md section 2 and the `verify` and `workflow-implement` skills run the script after launching an instance.

## Gherkin scenarios and the specs that cover them

Developer tooling: no Gherkin scenario and no Playwright spec. Spec: [delivery.md](../../specs/system/delivery.md) section 2.

## Artifacts

No artifact is kept; this is dev tooling with no UI. The script was run against the isolated instances used to test the other stories in this milestone. First run, captured on 2026-11-09 against a fresh isolated instance (port 3000, scratch data dir):

```
LLM (custom/claude-sonnet-5-5 at http://127.0.0.1:8317): Configuration saved
world-cup: Seeded world_cup on 127.0.0.1:55432 and loaded 9 entities into dataset "World Cup"
formula-1: Seeded formula1 on 127.0.0.1:55432 and loaded 48 entities into dataset "Formula 1"
intellify: Seeded intellify on 127.0.0.1:55432 and loaded 49 entities into dataset "Intellify"
us-health: Seeded us_health on 127.0.0.1:55432 and loaded 45 entities into dataset "US Health"
intellify-api: Registered the Intellify RFP API at http://127.0.0.1:3100 and loaded 10 entities into dataset "Intellify RFP API"
```

The same script also prepared the eval data dirs for 1.21.5. A second-run capture ("already loaded") was not taken: re-running it during the gate would have re-seeded the shared sample databases under parallel Playwright runs.

Desktop: not run (web target only).

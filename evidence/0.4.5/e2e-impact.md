# E2E impact (step 6) — 0.4.5 Deterministic QA

Read by `scripts/qa.mjs 0.4.5 --gate` ([delivery.md](../../specs/system/delivery.md) 13). This story changes no app code; it changes the shared Playwright fixture (the `DEMO=1` window, video and slow motion), the reporters in `playwright.config.ts` and the 1.21.6 demo scenario.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/user-personas.spec.ts` | update | "A new install starts with the demo persona" is tagged `@demo` `@story-1.21.6` and written with `scenarioStep`; every other scenario re-run as is |
| `frontend/e2e/navigation.spec.ts` | re-run | the shared fixture changed; without `DEMO=1` it must behave exactly as before |
| `frontend/e2e/layout-accessibility.spec.ts` | re-run | the fixture's window size is unchanged without `DEMO=1`; the visual baseline must still match |

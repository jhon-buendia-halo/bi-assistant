# 1.15.1 (BA-234) — E2E impact analysis (step 6)

Touched: `frontend/src/app/app.html` (the banner `h1` text only). Specs: app-shell R7 and the "Shows the product name" scenario, ui.md 1.2.

| Scenario (spec file) | Decision | Why it fails on `main` |
|---|---|---|
| App shell / Shows the product name (`navigation.spec.ts`) | Update: the level-one heading reads "US Health Agentic Hub"; the document title and the Settings build identity keep "Agentic Hub" | `main` renders "Agentic Hub" |
| Layout / matches the stable application-shell visual baseline (`layout-accessibility.spec.ts`) | Update the baseline (intended change, checked by eye: only the banner text differs) | the old image has the old banner |
| Every other scenario of `navigation.spec.ts` and `layout-accessibility.spec.ts` | Re-run as-is | — |

Desktop: not run (no desktop-only scenario touched).

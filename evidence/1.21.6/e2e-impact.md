# E2E impact (step 6) — 1.21.6 User personas

Read by `scripts/qa.mjs 1.21.6 --gate` ([delivery.md](../../specs/system/delivery.md) 13): first column the spec, second the decision.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/user-personas.spec.ts` | add | every scenario of `Feature: User personas`; "A new install starts with the demo persona" is the story's demo (`@demo`, `@story-1.21.6`) |
| `frontend/e2e/navigation.spec.ts` | update | "moves between areas from the rail": the Context page and its User personas card |

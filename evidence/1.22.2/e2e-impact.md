# 1.22.2 — E2E impact (step 6)

Touched: the generator, the PostgreSQL writer, `POST /synthetic-data/scripts` and the Generate form of the synthetic-data panel. Nothing outside the Profile & synthesize tab changes.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/synthetic-data.spec.ts` | add | Generate a PostgreSQL script (`@demo @story-1.22.2`); The script replays into an empty PostgreSQL database |

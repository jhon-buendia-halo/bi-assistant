# 1.22.5 — E2E impact (step 6)

Touched: the CSV, zip and Excel writers, the profile export, the `format` of `POST /synthetic-data/scripts`, `POST /synthetic-data/profile-exports`, and the Format select and Export profile menu of the panel.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/synthetic-data.spec.ts` | add | Download the synthetic data as CSV and Excel (`@demo @story-1.22.5`); Export the profile |

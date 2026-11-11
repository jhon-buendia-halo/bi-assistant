# 1.22.6 — E2E impact (step 6)

Touched: `POST /synthetic-data/sample-exports` (re-read through the sampler), the raw-value conversion, and the Export sample rows menu with its confirm dialog.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/synthetic-data.spec.ts` | add | Export the real sample rows after confirming (`@demo @story-1.22.6`); Cancelling the confirm downloads nothing |

# Evidence for 1.1.5 — Deterministic checks (Step 1b, BA-183)

Branch `feat/BA-9-golden-dataset-evals`, 2026-10-13. Web target; desktop not run.

- **Twelve checks** under `backend/src/mastra/evals/checks/`, one file each, each with a criterion (agents-evals R68-R82): `noRepairs` D3, `namesNotIds` I1, `numbersGrounded` G1, `rationaleOk` I3, `noHtml` I4, `dialect` I6, `qualifiedNames` I6, `optionCount` I5, `visualKeywords` G4, `sqlMatches`, `notMatches`, `usesEntities` D2. Attached to the World Cup, Formula 1 and golden questions by category (R82).
- **R31 fix:** a result the tool flagged as truncated because it reached the query's own row limit now matches when it holds exactly the reference rows (the baseline's `champion-2022` false negative).
- **R66:** the validator refuses a reference that reads a table outside the selected datasets.

| File | What it shows |
|---|---|
| `baseline-scored-offline.txt` | The checks scored over the six baseline run records of `../1.1.2/baseline/` (no model call): which rules `gpt-4o-mini` breaks. Pinned by `checks/baseline-traces.spec.ts`. |
| `../runs-2026-10-13/world-cup-postgres.*` | One real World Cup run on the new build with the judge off, every check scored (the story's done-when). |
| `../1.1.6/e2e-results.txt` | The web E2E suite after all of today's stories (one build). |

Unit tests: the whole backend, 91 suites and 1476 tests, pass (`npx jest`).

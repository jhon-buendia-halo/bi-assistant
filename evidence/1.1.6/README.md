# Evidence for 1.1.6 — Report by category, judge optional (Step 1c, BA-184)

Branch `feat/BA-9-golden-dataset-evals`, 2026-10-13. Web target; desktop not run.

- The judge is a run option (`judge: off | on | categories`, default off; the Evals tab's **Judge** select, Off by default; CLI `EVAL_JUDGE`). With it off, a judge check is **Not scored** and no model call is made (agents-evals R100-R110).
- Every question and check has a status (passed, failed, not scored); every run has a summary by category and by criterion, shown in Executions and in the Markdown report.
- Each question shows its category as a chip.

| File | What it shows |
|---|---|
| `e2e-results.txt` | The web E2E suite after Steps 1b, 1c, 1d, 2 and 3 in one build: 88 passed, 2 skipped (desktop only), 1 failed: the application-shell visual baseline, which has no macOS image in the repository (the generated image was not committed; roadmap 1.7.18). New tests: "runs with the judge off by default", "reports pass rate by category", the category chips, the report's judge line and tables, axe on the new views in both themes. |
| `../runs-2026-10-13/*.md` | Real runs with the judge off: each report holds `Judge: off`, the by-category and by-criterion tables, and no judge call. |

Frontend unit tests: 322 of 323 pass; the one failure is the known keyboard-resize test that depends on the headless window size (recorded on `main`).

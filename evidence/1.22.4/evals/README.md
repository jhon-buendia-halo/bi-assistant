# 1.22.4 — Data Readiness evals

- **Result: 100 %.** The `data-readiness` set (11 cases: the 9 existing plus `dr-profile-sample` and `dr-synthetic-script`) passed **11/11 in each of 3 runs** on the branch (`feat/M1-22-synthetic-data` at `8da062b`), 33/33 case runs.
- **Model:** the saved LLM settings of the data dir (custom endpoint, `claude-sonnet-5-5`), the same for every run.
- **Data:** a fresh copy of a data dir set up by `scripts/setup-local.mjs` (World Cup, Formula 1, Intellify, US Health on the shared PostgreSQL, plus the Intellify RFP API), one copy per run; the three runs ran in parallel.
- **Base run on `main`:** not needed. No case failed on the branch, so no failure needs telling apart (delivery.md: the base run tells which failures the change caused); the two new cases do not exist on `main`.
- **Prompt delta:** `DATA_READINESS_PROMPT` 4,676 → 5,716 characters (+1,040, +22 %, about +260 tokens per call), measured from the compiled agent (roadmap 1.22.4 Notes).

## Command

From `backend/` (after `npm run build`):

```bash
APP_DATA_DIR=<fresh copy of the data dir> INTELLIFY_API=off \
EVAL_DATASETS="World Cup" EVAL_SET=data-readiness \
EVAL_RESULTS_FILE=../evidence/1.22.4/evals/branch-<n>.json \
node dist/mastra/evals/run-assistant-evals.js > ../evidence/1.22.4/evals/branch-<n>.log
```

## Files

`branch-1..3.json` (every case's answer, tool calls and checks) and `branch-1..3.log` (the runner's output).

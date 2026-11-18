# E-commerce evals, 2026-11-18

Report: https://claude.ai/artifact/PJ68VcuPsc24xWAT8ujaRE (source: report.html). 100 questions (backend/src/mastra/evals/sets/ecommerce.json) on Emily and on the Answer a Business Question workflow (EVAL_TARGET=insights-analyst), gpt-5.6-luna effort low, 3 attempts each, $1.67.

- summary.md: scores, categories, failed attempts by check (scripts/ba9-ecom-report.py over the run files).
- verdicts/: one verdict per failed question (wrong answer, check too strict, asked instead of answering, question debatable, run error), with cause, fix lever and evidence.
- scripts/: merge of the four question parts, the run launcher, the failure dossier builder.

Run files stay in the BA-9 worktree: .eval-loop/runs/ba9/ecom-emily.json, ecom-workflow-{1,2,3}.json.

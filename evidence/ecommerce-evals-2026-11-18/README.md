# E-commerce evals, 2026-11-18

Report: https://claude.ai/artifact/PJ68VcuPsc24xWAT8ujaRE (source: report.html). 100 questions (backend/src/mastra/evals/sets/ecommerce.json) on Emily and on the Answer a Business Question workflow (EVAL_TARGET=insights-analyst), gpt-5.6-luna effort low, 3 attempts each, $1.67.

- summary.md: scores, categories, failed attempts by check (scripts/ba9-ecom-report.py over the run files).
- verdicts/: one verdict per failed question (wrong answer, check too strict, asked instead of answering, question debatable, run error), with cause, fix lever and evidence.
- scripts/: merge of the four question parts, the run launcher, the failure dossier builder.

Run files stay in the BA-9 worktree: .eval-loop/runs/ba9/ecom-emily.json, ecom-workflow-{1,2,3}.json.

## Re-run after fixing the checks (commit 3a24eaf9)

Right 3 of 3: Emily 27 -> 59, workflow 21 -> 41 (the 5 ambiguous questions counted by behaviour: both targets asked back correctly 3 of 3; the matches check on the visible answer misses Emily's ask-tool turns). Run files: .eval-loop/runs/ba9/ecom2-emily-{1,2}.json, ecom2-workflow-{1,2,3}.json in the BA-9 worktree. fixes/: the 50 replaced cases and the script that applied them.

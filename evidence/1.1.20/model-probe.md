# Model probe (2026-10-21)

Before moving the loop off gpt-4o-mini, four OpenAI models answered the same 31 dev questions (the `ranking` and `aggregate` questions of World Cup, Finance and Marketing Analytics), one attempt each, on the baseline code (`851bf83`), each from its own data directory and `probe_*` databases on this worktree's PostgreSQL, at low reasoning effort. gpt-4o-mini's row is its round 0 baseline on the same questions (three attempts each). Costs are worked out from the recorded tokens and the prices the user showed from developers.openai.com/api/docs/pricing (Standard, short context) on 2026-10-21; the range adds the 30-minute cache-write rate where a model has one. "Full run est." is the cost per attempt times 543. 31 attempts is a small sample: gpt-5.6-luna and gpt-6-luna cannot be told apart by it, both are well above gpt-4o-mini.

The user chose gpt-5.6-luna at low effort (results.tsv round 3). The probe cost $0.2575, counted in round 3's row.

| Model | Questions | Passing attempts | ranking | aggregate | SQL attempts with describe_entity | Repaired | Tool errors (kind-id) | Tokens/attempt (reasoning) | Cost/attempt | Full run est. | s/attempt |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gpt-4o-mini (r0, 3 attempts) | 31 | 15/93 (16%) | 4/48 | 11/45 | 5/93 (5%) | 60/93 | 11/231 (4) | 18728 (0) | $0.00210 | $1.14 | 8.9 |
| gpt-6-luna | 31 | 18/31 (58%) | 8/16 | 10/15 | 30/30 (100%) | 4/31 | 0/168 (0) | 34053 (289) | $0.00112–0.00121 | $0.61–$0.66 | 25.5 |
| gpt-5.6-luna | 31 | 22/31 (71%) | 12/16 | 10/15 | 30/30 (100%) | 3/31 | 0/152 (0) | 28899 (199) | $0.00209–0.00224 | $1.14–$1.22 | 16.6 |
| gpt-5-mini | 31 | 10/31 (32%) | 4/16 | 6/15 | 28/31 (90%) | 5/31 | 0/141 (0) | 41145 (770) | $0.00510 | $2.77 | 22.0 |

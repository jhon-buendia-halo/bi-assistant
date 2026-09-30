# Eval change log

One entry per iteration of the improvement loop. The run logs in `logs/evals/`
record *what* the numbers were; this file records *why* someone changed
something, which no tool can reconstruct later.

Append a new entry at the top. Keep each one short.

## Template

```markdown
## YYYY-MM-DD — <one-line summary>

- **Suite:** health-insurance
- **Lever:** prompt rules | tools & guards | context | model & mode
- **Change:** what was actually edited, in one or two sentences.
- **Why:** the failure the eval report showed, and the reasoning from failure to lever.
- **Before → after:** `13/20 → 17/20`; `ratio-trap 1/3 → 3/3`, `ties 0/2 → 1/2`.
- **Side effects:** World Cup `9/10 → 9/10`, genomics not re-run.
- **Verdict:** kept | reverted, and why.
- **Runs:** `logs/evals/2026-09-22-health-insurance-baseline-1a2b3c4d.json` →
  `logs/evals/2026-09-23-health-insurance-iter-1-guards-9f8e7d6c.json`
```

A "reverted" entry is worth as much as a kept one. It stops the next person
trying the same thing.

---

## 2026-09-30 — Learning from feedback + answer pinning added

- **Suite:** retail (new)
- **Lever:** context (learned knowledge) + consistency (answer pinning)
- **Change:** a reviewer's block comment can now be distilled (`feedback-learner`
  agent, deterministic verbatim fallback) into standing `KnowledgeSnippet`s
  (`source: 'feedback'`, with provenance) pinned second in the 8,000-char
  knowledge budget, right after `default_filter`. Separately, a new
  `answer_pins` collection replays a byte-identical answer for a repeated
  question — keyed on the normalised question + dataset + turn chain + mode,
  gated on a fingerprint of everything that legitimately changes the answer
  (knowledge used, metrics, verified block, schema, model/effort) plus a live
  re-run of the pinned SQL matching the stored rows — instead of calling the
  model again. New `retail` fixture: a fiscal-year/net-revenue trap with the
  fiscal-year definition and the revenue metric deliberately absent from
  seeded knowledge, so the reviewer has to teach both.
- **Why:** the HR/expert-mode work (2026-09-29) added per-block feedback and
  measured confidence, but nothing read that feedback back into future
  answers, and repeated questions still re-sampled the model, so a corrected
  answer could still come back worded differently — or wrong again — next
  time. Fine-tuning was considered and rejected (retrieval beats fine-tuning
  at knowledge injection in published comparisons, GPT-5/o-series aren't even
  offered for supervised fine-tuning, and "deterministic" model settings are
  documented as not actually deterministic server-side) — see
  `docs/plans/learn-from-feedback-engineering.md` decisions 1 and 6 for the
  citations.
- **Before → after (live, `npm run learning:demo`, gpt-5 / high, 1 run):**
  trap `net-revenue-fy2025` wrong ($389,641.99 = calendar year) at **low
  0.50** → right ($401,306.11) at **high 0.83**, marked `updated`;
  generalisation `orders-fy2025` right at **high 0.87** with no notes of its
  own. **Learning lift 2/2.** Repeats S3 and S6 were `replay`s, byte-identical,
  0 model calls. **Repeat consistency 2/2.** Two notes → 5 lessons.
- **Side effects:** (1) before-band was *low*, not the planned medium — the
  cross-check read "net revenue" as `orders.total_amount` and disagreed (cap
  0.5); the column was renamed `amount_charged` afterwards so a verifier has
  no revenue-looking money column to reach for (not re-run live — token spend
  stopped at the product owner's request). Probes without that split landed
  medium, 0.76 and 0.79. (2) The control (March units) was correct but capped
  low: the verifier returned only the winner against the answer's full
  ranking and `compareResults` called it a disagreement — fixed with
  `leadingRows` (cross-check only; eval grading unchanged). (3) On the first
  attempt GPT-5 answered the trap with a clarification ("What's your fiscal
  year boundary?", none of its options the real calendar) — expert turns now
  carry `REVIEW_MODE_CONTEXT` (answer under a stated convention, still ask
  for data ambiguity). The HR `reports-to-manager` clarification case may
  change under `--expert`; not re-measured.
- **Verdict:** keep. Re-run `npm run learning:demo -- --port 3110` once to
  confirm the medium before-band and the control's high band after the two
  fixes.
- **Runs:** live demo log in the session scratchpad (`demo-run3.log`);
  `eval:validate -- --suite retail` 6/6 OK after the rename.

---

## 2026-09-22 — Health insurance and genomics fixtures added

- **Suite:** n/a — this entry records the starting point, not a lever change.
- **Change:** two synthetic fixtures (`health_insurance`, `genomics`) with traps
  planted per `synthetic-domains.md`, 20 eval cases each, category tags on every
  case, per-category reporting, token/cost logging, and suites loaded from JSON
  so a new domain no longer needs a code change.
- **Why:** every measurement the engine had was a World Cup sports question. Two
  more domains — one business, one STEM — make it possible to tell a fix that
  generalises from one that was fitted to football.
- **Before → after:** no engine change; baselines to be recorded per
  `improvement-loop.md` step 2.

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

## 2026-09-28 — Genomics to ≥90%: knowledge budget, fact-only knowledge, judge evidence, three prompt rules

- **Suite:** genomics (49 cases), gpt-5, reasoning effort high, arm `baseline` (production defaults, no engine lever switched on).
- **Lever:** context (knowledge budget + knowledge wording), harness honesty (judge evidence, one alternative reference), prompt rules.
- **Change:**
  1. *Harness:* the judge now sees a clarification's **options**, not only its question (`formatClarification` in `assistant.evals.ts`), and a visual's `VisualEvent`. Before, all three clarification cases failed "no concrete options" whatever the assistant offered.
  2. *Knowledge block* (`KnowledgeService.contextFor`): 2 000 → 8 000 chars, `default_filter` snippets pinned first, and an entry that does not fit is skipped instead of ending the block. With the full genomics seed (12 snippets, ~5 100 chars) the old loop stopped at the fifth snippet and silently dropped the control-sample default filter, the clinical-significance vocabulary and the coverage facts on every turn.
  3. *Knowledge wording* (`fixture-semantics.ts`, facts only): the control flag is per sample, so subject/phenotype/variant/gene counts are not routed through samples (8 of 120 subjects have only a control sample); "pathogenic" alone is the PATHOGENIC class; the allele-fraction 20-read floor belongs to that metric, not to "high-confidence" (which is PASS alone); `filter_status` grades the call, not the genotype; a new term says expression level is `tpm`, not `raw_count`.
  4. *Prompt* (`assistant-instructions.ts`, three new ablatable groups + two edits): `discovery` (what-data-exists questions answered from the schema, no SQL), `no-invented-filters` (no quality thresholds or status conditions nobody asked for; a metric's own condition applies to that metric), `not-recorded` (say "not captured" first, never a bare 0, check the data records a thing before asking how to count it); default filters apply to queries that read the rows they describe; a stored value or curated term settles what a word refers to, while an undefined measure still gets one question whose options are concrete readings. Golden prompt regenerated (7 382 → 8 957 bytes).
  5. *Check:* `high-confidence-calls` gained an `expectedSqlAlternatives` single PASS count (3 943): the question asks for one number, and the PASS/LOW_QUAL breakdown was the only accepted shape.
  6. *Provider errors are errors* (`runTurn`, `classifyProviderError` in `turn-data.ts`): a failed model call (quota, rate limit, auth, network, timeout) is recorded as `TurnResult.providerError`. The user sees an honest message instead of "I completed the data analysis but could not produce a final response", synthesis, the grounding guard, review and the cross-check are skipped (they would call the same failing provider), and the eval harness grades the attempt `ERROR` instead of a `FAIL` blamed on the assistant. Applies from the next run; the iteration-3 and iteration-4 logs predate it.
- **Why:** Sergio's in-app baseline (2026-09-23) was 30/49. Reading every failure: 7 were over-asking ("pathogenic or likely pathogenic?"), 3 were clarifications the judge could not see, 3 were discovery questions answered with 5–9 queries, and the rest were filters the assistant invented, often from the allele-fraction metric's wording, or a default filter applied to subject counts. The real store had only the old 2-snippet genomics seed; seeding the full one first *lowered* the score (iteration 1, 21/49) until the budget bug was found. A knowledge change that moves a score the wrong way is worth checking against what actually reached the prompt.
- **Before → after:** single run, like-for-like with the baseline: `30/49 (61%) → 47/49 (96%)` (iteration 2). Three runs per question (iteration 3, final prompt): pass^3 `38/49 (78%)`, attempts `132/147 (90%)`. Of the 15 failed attempts, 9 were provider failures (OpenAI `ECONNRESET`, calls hung past the 300 s attempt timeout with zero tokens, and the "could not produce a final response" fallback that follows). Counting only attempts the model answered: pass^3 `44/49 (90%)`, attempts `132/138 (96%)`. Per category, baseline pass^1 → pass^3: clarification `0/3 → 2/3`, discovery `0/3 → 2/3`, quality-filter `0/3 → 1/3` (all but one miss were provider failures), domain-semantics `1/4 → 2/4`, constant-column `1/3 → 2/3`, ties/value-vocabulary/out-of-scope `2/3 → 3/3`; default-filter, metric-definition, ratio-trap, unit-confusion and control stayed `3/3`.
- **Remaining genuine misses (iteration 3):** over-asking on `most-called-genes` (2 of 3 attempts ask "calls or samples with a call?") and `pathogenic-carrier-samples` (1 of 3 asks "PASS only?"); `most-affected-superpopulation` offered an off-topic option once; `variants-by-assembly` answered from the GRCh38 term without running SQL once; `genes-most-rsid-variants` ran a top-5 for a top-3 question once.
- **Reverted, not measured:** a further clarification refinement ("counting the thing the question names is not ambiguous… ask about the measure only when the question names none") and "do not ask whether to add such a filter either". The measuring run (`…-iter4-final-repeat3-…`) hit `429 insufficient_quota` (no API credits) after 3 attempts, so its 0/49 is not a measurement; the change is left for the next iteration.
- **Side effects:** not measured. The knowledge budget and prompt rules apply to every suite: re-run world-cup and health-insurance (both seeded with the full semantics on 2026-09-28) before calling this kept.
- **Verdict:** kept (budget fix, knowledge wording, harness fixes, three prompt groups); the iteration-4 clarification refinement is reverted pending measurement.
- **Runs:** `logs/evals/2026-09-23-genomics-baseline-1aff73b9.json` → `2026-09-28-genomics-iter1-knowledge-prompt-baseline-{b26c2723,12936679,4b10e781}.json` (21/49) → `2026-09-28-genomics-iter2-knowledge-budget-baseline-{8a817d13,b9e10f5d,e916d883}.json` (47/49) → `2026-09-28-genomics-iter3-repeat3-baseline-{8f8b9dd1,9d6c2fec,ccce385e}.json` (pass^3). Each iteration ran as three shards on copies of the app store (ports 3101–3103), so each is three log files.

## 2026-09-23 — Pipeline L4/L5 + suite growth

- **Suite:** world-cup, health-insurance, genomics
- **Lever:** pipeline & prompt rules
- **Change:** answer review (`answer-review.ts` + `answer-review.agent.ts`) runs after the grounding guard and before the answer is shown, judging the transcript against the eight Omni error classes (unsupported claim, wrong date filter, truncated result treated as complete, prose arithmetic, …) and running one corrective pass when it finds something (arm `review`). Careful mode gained `careful: 'auto'` (arm `careful-auto`): the independent cross-check now runs automatically for the risky categories (`ratio-trap`, `metric-definition`, `multi-step-join`, `default-filter`, `unit-confusion` — `RISKY_CATEGORIES`) or whenever a guard/repair warning fired, instead of only when a user flips the Careful switch. The assistant prompt was split into `ASSISTANT_RULE_GROUPS` (`assistant-instructions.ts`) so any rule group can be removed for a run (`promptAblation`, arm `no-prompt-rules`) to test whether it still earns its place. Each suite grew toward the plan's target of ≥3 cases per category, with paraphrase `variants`, `trapSql` on trap cases, a `difficulty` tag and a `provenance` tag (hand-written vs. model-drafted-and-verified).
- **Why:** step 5 — Omni's benchmark validates before answering by default and reports accuracy by difficulty; a single case per category is an anecdote, not a measurement (one flip moves it from 100% to 0%); careful mode should be targeted at the failure classes it actually catches, not always-on (cost) or never-on (the risk it exists to catch).
- **Before → after:** not measured — lever shipped behind arms `review`, `careful-auto`, `careful-on`, `no-prompt-rules` (off in production defaults); measure with Loop run `baseline` vs `<arm>`, repeat 3, then decide keep/revert here.
- **Side effects:** not measured
- **Verdict:** pending measurement.
- **Runs:** _smoke run file names added at integration_

## 2026-09-23 — Tool levers L3 (descriptive errors, precheck, fixer guard, guards, static-first)

- **Suite:** world-cup, health-insurance, genomics
- **Lever:** tools & guards
- **Change:** descriptive tool errors (`sql-errors.ts`) name the closest columns, tables and known values instead of a bare database error (arm `errors`); a zero-token SQL precheck (`sql-precheck.ts`) parses, validates and enriches a statement before it runs — unknown tables/columns, a missing default-filter predicate, a metric whose formula doesn't match — without spending a turn (arm `precheck`); a deterministic repair-intent guard (`sql-repair-guard.ts`, `classifyRepair`) diffs every SQL-fixer repair against the original and warns when the change looks semantic rather than cosmetic — on by default (WS0, scorecard honesty, not a lever); a `fixer-off` arm turns the fixer off entirely and relies on the assistant (which, unlike the fixer, sees the question) retrying against a descriptive error; extended result guards (`result-guards.ts`) catch a constant metric at any value, an id-only projection and a missing default filter (arm `guards`); static-first context ordering puts static blocks (schema, metrics, knowledge) before dynamic ones (visuals, verified pairs) for prompt caching (arm `static-first`).
- **Why:** step 4 and the Omni review's two matching lessons — "great error messages plus a retry budget was their first big jump," and the "split-brain" risk of an outer agent and an unrelated repair sub-agent disagreeing about what the question meant (engineering plan §9.7); the loop needs guards that catch a wrong result before it reaches the user, not only checks that grade it after the fact.
- **Before → after:** not measured — lever shipped behind arms `errors`, `fixer-off`, `precheck`, `guards`, `static-first`, `tools-full` (off in production defaults; `repairIntentGuard` is on by default as scorecard honesty, not a lever); measure with Loop run `baseline` vs `<arm>`, repeat 3, then decide keep/revert here.
- **Side effects:** not measured
- **Verdict:** pending measurement.
- **Runs:** _smoke run file names added at integration_

## 2026-09-23 — Context levers L2 (profiles, inline/ranked knowledge, lookup tools, semantics seed, bare/curated arms)

- **Suite:** world-cup, health-insurance, genomics
- **Lever:** context
- **Change:** column profiles (null rate, distinct count, top values, a magnitude guess) computed when a dataset is saved and rendered inside `describe_entity` (arm `profiles`), Knowledge shown *inline*, beside the column it describes, instead of only in the separate Knowledge block (`inlineKnowledge`); Knowledge and Metrics ranked by relevance to the question instead of newest-first once the context budget is tight (arm `ranked`); `lookup_values` / `lookup_knowledge` tools that match a user's phrase to the real stored values or a knowledge snippet before the query runs (arm `lookup`); a `bare` context arm (schema only, no Knowledge/Metrics/verified queries — what a brand-new customer sees on day one) alongside the existing `curated` arm; and a full business-semantics seed per fixture (`fixture-semantics.ts` — ≥8 knowledge snippets, several metric definitions and a dataset description per fixture) loaded by `fixtures:register`, replacing the old seed that only covered the four trap-specific entries. Two knowledge snippets drafted for this seed ("most expensive", "most important gene") were removed during review — they were question-shaped rather than fact-shaped and would have directly answered two of the clarification cases, which is the overfitting failure mode this step exists to avoid; L2 knowledge states facts about the data, never hints about a question.
- **Why:** step 3, and both the research review and the Omni talk point at context as the largest lever measured elsewhere (17–23 points from business context vs. a smaller gap from model choice); `net-paid-after-reversals-2024` and `denial-rate` specifically needed the `net_paid` / `denial_rate` metric definitions the previous seed never provided.
- **Before → after:** not measured — lever shipped behind arms `profiles`, `ranked`, `lookup`, `context-full`, `bare` (off in production defaults — `curated`, today's behaviour, stays the default); measure with Loop run `baseline` vs `<arm>`, repeat 3, then decide keep/revert here.
- **Side effects:** not measured
- **Verdict:** pending measurement.
- **Runs:** _smoke run file names added at integration_

## 2026-09-23 — Model choice support (Databricks provider, judge pin, $/correct, per-model compare)

- **Suite:** n/a — support work, not a suite-specific change
- **Lever:** model & mode (support)
- **Change:** a Databricks Model Serving LLM provider (Settings → LLM — workspace URL + serving-endpoint name + personal access token; requests go to `<workspace>/serving-endpoints/chat/completions`, bearer-only; **untested against a live Databricks workspace**, flagged in the UI and the CLI preflight); a pinnable eval judge model (Settings → Engine levers → Judge model, a `<provider>/<model>` router id) so changing the assistant's production model does not also move the ruler it is judged against; `$ per correct answer` (`costPerCorrectUsd`) computed into every run's summary; per-model comparison via History → Compare and `npm run eval:diff`.
- **Why:** step 2 — gpt-5 already scores far higher than gpt-4o-mini on Health Insurance with no regressions (`docs/plans/improvement-loop-engineering.md` §1.7), but picking a production default needs a cost-per-correct-answer number next to the accuracy number, not accuracy alone; the product runs on Databricks, so a Databricks provider matters even though no live workspace was available to test it against.
- **Before → after:** not measured — the Databricks provider and judge pin are support features rather than a scored lever; run a Loop run with two models (Settings → LLM) at the same suites/repeat and read History → Compare's `$ / correct answer` to decide the production default.
- **Side effects:** not measured
- **Verdict:** pending measurement.
- **Runs:** _smoke run file names added at integration_

## 2026-09-23 — Scorecard honesty (parity harness, GAP, check repairs, run log v2, repeat)

- **Suite:** world-cup, health-insurance, genomics
- **Lever:** n/a — step 1 makes the checks honest; it is not itself a lever to keep or revert
- **Change:** the eval harness now runs every case through the production turn (`SessionsService.runTurn`, a fresh throwaway session per attempt) instead of the bare agent via Mastra's `runEvals`, so an eval run sees the Metrics block, verified queries, the configured reasoning effort and the grounding guard a real chat session gets. Added the `GAP` verdict — the harness could not measure a case (a broken reference query, a judge that errored twice) — excluded from every rate rather than counted as a fail, and `repeat`/pass^k folding (`foldAttempts`): a case passes only when every attempt passed. Retired checks: `calledTool list_entities` removed from the three discovery cases (the entity list is already in the per-turn context, so a sensible agent never calls it); `noToolErrors` replaced by `finalSqlSucceeded` everywhere outside `control` (one exploratory query the agent noticed and fixed is not a wrong answer); the numeric-value `includes`/`matches` checks removed from cases that already have `expectedSql` (the result-set check already grades the number; a text check only penalises formatting, units and abbreviation); `matches` now defaults to case-insensitive (`flags: 'i'`) unless a case opts out and says why. `denial-rate` and `net-paid-after-reversals-2024` were recategorised to `metric-definition`, now backed by the seeded `denial_rate` / `net_paid` metric definitions instead of an unstated house rule. The run log gained a v2 schema (`eval-telemetry.ts`) that is written on every terminal state — completed, failed or aborted; in-app and CLI; packaged app included via the `EVAL_LOG_DIR` → repo `logs/` → `<APP_DATA_DIR>/logs` → `<cwd>/data/logs` fallback — carrying per-attempt SQL, answer text (≤2000 chars) and a heuristic failure label (`failure-labels.ts`) per non-pass attempt, plus `eval:diff` and the History / Trend / Compare UI to read it.
- **Why:** the old harness measured a different system from the one people use; several checks failed correct answers by construction (list_entities, noToolErrors, exact-format number checks); and the old run log recorded only a verdict and a reason string, so explaining *why* `paid-by-country` failed meant opening Executions and reading the trace by hand every time (`docs/plans/improvement-loop-explained.md`, "Why we do not trust the verdicts yet").
- **Before → after:** baseline to be recorded as Iteration 0 (the old runs in logs/evals are not comparable: different harness)
- **Side effects:** n/a — this entry is the harness itself, not a scored engine change
- **Verdict:** n/a — infrastructure; Iteration 0 (next entry to be added, once run) is the first reading that is actually about the assistant rather than about the harness.
- **Runs:** _smoke run file names added at integration_

## 2026-09-23 — Execution plan started (steps 1–5)

- **Suite:** world-cup, health-insurance, genomics
- **Lever:** n/a — scorecard and tooling work first
- **Change:** Execution of `docs/plans/improvement-loop-engineering.md` started, split into waves in `docs/plans/improvement-loop-execution.md`. Engine levers are being built behind per-run arms (`engine-options.ts`), switched off in production defaults until measured.
- **Why:** Nine health-insurance cases failed on every model; the harness did not run the production turn, several checks failed correct answers, and the run log could not explain a failure (engineering plan §2).
- **Before → after:** not measured — no engine change yet
- **Side effects:** none
- **Verdict:** n/a
- **Runs:** none yet

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

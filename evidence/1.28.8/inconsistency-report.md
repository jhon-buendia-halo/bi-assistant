# M1-28 — Inconsistency report: every agent of Answer a Business Question and Assess Data Readiness

Roadmap 1.28.8. Model: CLIProxyAPI, `claude-sonnet-5-5` (Anthropic style), fresh copies of a data dir holding the "Edge Cases" and "World Cup" samples. Three runs per case. Sets and cases: [agents.md](../../specs/system/agents.md) 8.1; plan: [docs/plans/m1-28-agent-evals.md](../../docs/plans/m1-28-agent-evals.md).

## Results by round

| Set | Agent | Cases | Baseline | Round 2 | Round 3 |
|---|---|---|---|---|---|
| `data-quality-check` | Sarah (Check data quality) | 8 | 8, 8, 8 | — | — |
| `readiness-workflow` | Sarah (Explain report, whole workflow) | 6 | 6, 6, 6 | — | — |
| `result-explorer-edge` | Nathan (Interpret follow-up) | 5 | 5, 5, 5 | — | — |
| `analysis-planner` | Olivia (Plan) | 12 | 12, 11, 12 | 11, 11, 11 | 12, 12, 12 |
| `answer-writer` | Jessica (Write answer) | 10 | 8, 8, 8 | 9, 7, 8 | 9, 9, 10 → 10, 10, 10 (round 4, case fixed) |
| `image-reader` | Zoe (Read images) | 6 | 5, 5, 5 | 5, 6, 6 | — |
| `insights-analyst-edge` | Michael (whole workflow) | 8 | 7, 6, 5 | 7, 8, 8 | 8, 7*, 8 |
| `insights-analyst` (World Cup, existing) | Michael (whole workflow) | 10 | 29/30 before M1-28 | 10, 9, 10 | 10, 9, 9 |

\* a run error, not the agent.

**Final:** every set at or above 28 of 30 runs; every remaining failure is a run error or a judged wording case that also fails on `main` (`v2-share-penalty-goals-2022`, judge: a claim about how shoot-outs are recorded).

## Every failure, traced

Each failure was read (answer, tool calls, the check's reason) and classed as an **agent fault** (the agent broke its own instructions) or a **check fault** (the check asked for something the agent's purpose does not).

### Agent faults (fixed)

| # | Agent | Case | Seen | What happened | Fix |
|---|---|---|---|---|---|
| 1 | Olivia | `ap-ambiguous-best-customers` | 1 of 3 | With a `v_customer_ltv` view in the catalog, Plan assumed "best = lifetime value" instead of asking, against its rule ("needsClarification … the best team with no measure named"). | A last rule: a view whose name suggests a measure does not define "best/top/most valuable"; when the question names no measure, ask and offer it (commit 8d124622). Round 2: 3 of 3. `ap-top-five-ties` (measure named) checks the rule does not over-fire. |
| 2 | Jessica | `aw-status-counts` | 2 of 3 (round 2) | "the other five statuses each have between about 37,000 and 38,000", against "keep counts exact". | A last rule: never round counts into a range; give the exact smallest and largest (commit 66e250d1). |
| 3 | Jessica | `aw-warning-is-not-a-caveat` (known issue D) | fixed before the baseline | Validate's warning-only "Measures covered" reached her as `failed:`, and her caveat rule covers failed checks. | Rendered as `warning:` (`findingStatus`, commit 0a6c063d). Round 3 showed the case itself was wrong: its plan asked for a "delivery rate" no query computed, so her caveat was true. Rebuilt on a covered measure the warning misses by wording ("number of delivered orders"): 3 of 3, no Caveats section. |

### Inconsistencies between agents (kept, low severity)

| Agents | Case | Seen | What happened |
|---|---|---|---|
| Olivia → Michael | `iae-top-five-tie` | 1 of 3 (baseline) | Plan listed `orders`; Analyse answered from `v_product_revenue` and `order_lines` without it. The answer was right; the plan over-includes an entity. Not fixed: the plan is a guide and the answer is correct. |

### Check faults (fixed in the checks)

| Case | What the check wrongly asked |
|---|---|
| `aw-nan-weights`, `aw-status-counts`, `iae-orders-per-status` | Figures only as literal cells; the writer may derive totals, differences and shares (her rules round "averages, ratios and other derived figures"). Now a derived figure of the rows passes (`derived-figures.ts`). |
| `aw-nan-weights` | "The average excludes the NaN weights" read as NaN given as the average. |
| `aw-spanish-question` | "37.941" (Spanish thousands) read as 37.941. |
| `ir-table-negative-and-dates` | A date split into numbers (`2024`, `-01`, `-15`). |
| `iae-empty-gift-cards` | Any table refused; a summary table of zeros is right. |
| `ap-top-five-ties` | Asked the plan to talk about ties: that is Jessica's job (her Ties rule), not Olivia's. |

### Known issues checked

- **B** (Sarah's chat prompt served to the tool-less Check data quality call): not seen. `data-quality-check` 24 of 24, `dq-non-readiness-question` included; no refusal, no prose. Not changed.
- **C** (Explain report drops the workflow's question): not a visible bug. The catalog copies the question (or its default) into the run's input, so the turn input is the same text; `rw-stale-tables` 3 of 3.
- **D**: fixed (above).
- **A** (`dr-no-sql` scorer collision): fixed in 1.28.1.

### Run errors (not agents)

`Failed to run experiment: Error generating result from target` once each in `iae-average-weight-nan`, `ap-fully-null-fax` and `ir-table-negative-and-dates`, with six eval processes running at once; each case passed in its other runs.

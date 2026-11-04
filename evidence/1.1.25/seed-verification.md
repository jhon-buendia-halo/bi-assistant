# 1.1.25 Marketing Analytics knowledge seed: verification

Roadmap 1.1.25, [BA-188](https://halo-powered.atlassian.net/browse/BA-188), decided by the user on 2026-10-24. The seed is `backend/src/modules/testing-data/fixtures/knowledge/marketing-analytics.ts`, registered on the `marketing-analytics` sample in `registry.ts` (testing-data R26), so loading the sample from Testing Data creates it.

## How the facts were checked

- Source of the rules: [marketing-analytics-policy.md](../../docs/evals/domains/marketing-analytics-policy.md). The brief and `facts.json` were read for the schema and the planted traps; the question bank only to know what the questions ask.
- Database: the sample loaded in `ba9_marketing_analytics`, schema `marketing_analytics`, on the shared PostgreSQL (port 55432), queried read-only on 2026-10-24 with SELECT statements only. Nothing was written to any database, no container was started or stopped.
- Every query is in [seed-verification.sql](seed-verification.sql) and its whole output, unedited, in [seed-verification-output.txt](seed-verification-output.txt) (`psql -At -F ' | '`). The `Vn` below are its section labels.

## The real case the seed targets

Asked to chart Harborline Mutual's written premium by quarter for 2024 and 2025, the assistant summed every sale status and came out about 4% high. V4: written premium over every status and test row, divided by the BOUND, non-test figure, for Harborline Mutual over 2024 and 2025 → `1.0444`. The entry "Sale status: a sale is a bound policy" and the metric `written_premium_usd` say that written premium counts BOUND rows only.

## Each entry, what it says, and the check

Characters are the entry's line as the knowledge block renders it (`- [kind] title: body; synonyms: …; entities: …`, entities as `marketing_analytics.marketing_analytics.<table>`, the sample's default database), in send order: default filters, then instructions, then terms (testing-data R26).

| # | Kind | Title | What it says | Chars | Check and result |
|---|---|---|---|---:|---|
| 1 | default_filter | Exclude test sales rows | keep `is_test = false` on `policy_sales`; test rows are QA loads; no other table has the flag; `market_benchmarks` already leaves them out | 352 | V5 → `is_test` only on `policy_sales`. V6 → 6 test rows, all BOUND. V7 → 955 benchmark rows, 0 differ from the BOUND, non-test sales of the carrier each label masks; V8 → all 955 differ once every status and test row is counted |
| 2 | instruction | Who the user is | the viewer is Harborline Mutual unless the question names another carrier as the user's own; we, our and us mean the viewer; "the market" means all carriers | 399 | Policy, "Who the user is" and "Defaults". V9 → six carriers, `HBM Harborline Mutual` among them; 6 report sales |
| 3 | instruction | Competitors appear only under masked labels or in totals | no competitor named or coded next to a figure; per-competitor figures only from `market_benchmarks` rows of the viewer, by `competitor_label`; market and rest-of-market totals may be summed from `policy_sales`, never grouped by another carrier; never read `competitor_masks`; names, segments and headquarters are public but never beside a figure | 739 | Policy, Governance 1 to 4 and 7. V11 → 6 viewers, each with labels Competitor A to E; a label masks 3 to 5 different carriers across viewers; 0 viewers mask themselves. V10 → 240 viewer, line and quarter cells, 0 where own BOUND non-test premium plus benchmark rows differs from the market |
| 4 | instruction | Aggregate-only plans | when the viewer's `analyst_access` rows have `competitor_visibility = 'AGGREGATE_ONLY'`, no per-competitor rows, even masked | 304 | Policy, Governance 5. V12 → one visibility per carrier: Bluefield General and Pinecrest Casualty AGGREGATE_ONLY, the other four MASKED; benchmark rows exist for every viewer (151 to 167), the aggregate-only ones included, so the rule keeps them out, not the data |
| 5 | instruction | Campaign data is private | keep `campaigns.carrier_id` to the viewer; another carrier's campaigns never shown, not even masked or summed | 324 | Policy, Campaign measures and Governance 6. V13 → three carriers load campaigns (Crestview Insurance 6, Harborline Mutual 14, Pinecrest Casualty 6) |
| 6 | term | Sale status: a sale is a bound policy | BOUND is a sale, NTU a walk-away (not a sale, not a cancellation), PENDING in underwriting and only in the preliminary quarter; policies sold, new business, policies written and written premium count BOUND only; count policies with `SUM(policy_count)` | 644 | V1 → BOUND 5957 rows, NTU 4445, PENDING 420, no other value. V2 → PENDING rows only in the PRELIMINARY quarter. V3 → non-test BOUND rows hold 9 to 641 policies each (average 92.0) |
| 7 | term | Written premium, earned premium and revenue | written premium on BOUND rows in the quarter sold; earned premium from `revenue_by_period`; revenue = earned premium + fee income, same carrier, line and period; written premium is not revenue; premium per policy is SUM over SUM | 623 | Policy, Premium and revenue. V15 → 191 rows, 191 distinct (carrier, line, period), 159 with fee income above 0 |
| 8 | term | Walk-away rate | NTU over BOUND + NTU, in policies, same carrier, channel and period; PENDING left out | 278 | Policy, What counts as a sale (a definition; V1 shows the three statuses it uses) |
| 9 | term | Money is stored in US cents | every `*_cents` column is US cents, divide by 100; every sale is in USD | 413 | V14 → six bigint `_cents` columns (campaign budget and spend, benchmark and sales written premium, earned premium, fee income); `currency_code` is the only currency column and holds `USD` on all 10822 rows |
| 10 | term | Quarters and the fiscal year | calendar quarters `YYYY-Qn`; fiscal year from 1 July, named for the year it ends in, fiscal quarter 1 July to September; data starts in the first quarter of 2024; no period given: every quarter with data, said so | 576 | V16 → 9 periods, all 9 with `period_code = calendar_year-Qcalendar_quarter` and the fiscal rule; calendar Q3 is fiscal Q1, starting in Jul. V17 → `periods` and the first row of `policy_sales`, `revenue_by_period`, `campaign_results` and `market_benchmarks` all start 2024-01-01 |
| 11 | term | Reporting status of a quarter | FINAL closed; PRELIMINARY the latest quarter with data, can change, holds the PENDING rows, say so; NOT_REPORTED has no rows, say so, never zero | 426 | V18 → FINAL 7, PRELIMINARY 1, NOT_REPORTED 1 quarters; 0 rows of sales, revenue, campaign results or benchmarks in the NOT_REPORTED one; the PRELIMINARY quarter starts after every FINAL quarter with sales (`t`). V2 for PENDING |
| 12 | term | The market and share of market | the market is the six reporting carriers, same line and period; share of market = carrier's written premium over the market's; the rest of the market = market minus viewer; a change between periods is a percentage unless dollars are asked, say which | 499 | Policy, The market, share of market and growth. V9 → 6 carriers report sales; V10 as for entry 3 |
| 13 | term | Campaign funnel and rates | one `campaign_results` row per campaign and quarter; CTR, lead-to-policy conversion, cost per acquisition, cost per lead, budget use (over 100% an overspend); over several quarters SUM over SUM | 589 | Policy, Campaign measures. V19 → 51 rows, 51 distinct (campaign, period); columns budget_cents, spend_cents, impressions, clicks, leads, quotes, policies_bound; 17 rows spend above budget |

Knowledge block: **6,166 of 7,000 characters**, so all 13 entries are sent with 834 to spare (knowledge R17). For comparison, on the same measure: Finance 6,713 (16 entries), Supply Chain 6,031, Genomics 5,099, Health Insurance 3,760.

## Metrics

Rendered as the metrics block does (metrics R10): **1,209 of 4,000 characters**.

| Name | On | Expression | Chars | V20, over the whole table |
|---|---|---|---:|---|
| `policies_sold` | `policy_sales` | `SUM(policy_count) FILTER (WHERE sale_status = 'BOUND' AND NOT is_test)` | 259 | 547290 |
| `written_premium_usd` | `policy_sales` | `SUM(written_premium_cents) FILTER (WHERE sale_status = 'BOUND' AND NOT is_test) / 100.0` | 301 | 645783096.44 |
| `walk_away_rate` | `policy_sales` | NTU policies over BOUND + NTU policies, non-test, `NULLIF` on the denominator | 418 | 0.0390 |
| `revenue_usd` | `revenue_by_period` | `SUM(earned_premium_cents + fee_income_cents) / 100.0` | 231 | 606193891.54 |

The metrics return US dollars and carry the test filter themselves, unlike Finance's (cents, filter apart): the policy says money is always reported in dollars and test rows are never business.

## Leak check and R27

- `npm --prefix backend run --silent eval:leak-check -- --diff-file <the seed folder's diff against f2158ff>`: first run 11 rejected (three row counts of `facts.json` in comments, a title that repeated a governance question's words, "an analyst at harborline mutual", the word "growth", the carrier name). The comments and the title were reworded, "growth" was replaced by "a change between periods", a "third" in a comment by a count. Final run: **0 rejected, 0 warnings; 313 added lines in 1 lever file**.
- The two lines this seed's author added to `docs/evals/loop/leak-allowlist.txt` for the carrier name were dropped by the lead when the seed came onto the epic branch: the allowlist applies to every later fixer patch, and a fixer naming that carrier in a lever file must still be rejected. Without them the leak check rejects 3 lines of the seed (49, 53 and 55, entry 2 "Who the user is"), each for `harborline mutual`, the viewer the policy names. They stay as a documented exception of a supervisor-written seed; a round that edits those lines will be rejected and decided then.
- The seed's unit tests (`knowledge-seeds.spec.ts`, testing-data R27): no question id, no question wording or paraphrase, never phrased as an answer, only columns the bundled seed creates, entities on the sample's own tables, every metric accepted by the metrics service; `knowledge-seed-block.spec.ts`: the loader sends the default filter, then the four instructions, then the terms.

## Left out of the seed on purpose

- **"Best", "strongest" or "performed best" with no measure: ask which measure** (policy, Defaults). It changes no query, and it would settle how the assistant treats the ambiguity that the bank's two `ambiguous` questions ask it to notice (testing-data R27, third rule).
- **Which quarter is final, preliminary or not reported, and where the data ends.** The seed gives the vocabulary of `reporting_status` and the first quarter of the data, not the latest final quarter or the unreported quarter by name: those are answers to lookup and out-of-scope questions, and `periods` holds them.
- **The fiscal year example of the policy** (fiscal 2025 runs July 2024 to June 2025, its first quarter July to September 2024). The rule is written for any year N; the example is the answer to a lookup question.
- **Anything about a carrier's campaigns or sales over time**, in particular Harborline's campaign pause and its sales around it: the story of BA-243's investigation questions. The seed states rules, never findings.
- **Facts the policy does not state**: which channels are digital, product families, promo codes, join paths (sales to states and regions, products to lines). They come from the schema; a later round may add them as a separate lever change if the traces show they are missed.
- **"An answer says so once" for test rows** (policy, What counts as a sale): not in the filter's body, since the curated-knowledge skill already tells the assistant to name every default filter it applied (knowledge R19).

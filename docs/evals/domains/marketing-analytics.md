# Marketing analytics: domain brief

A synthetic eval domain shaped on the marketing-insight product (BA-9 plan [3.4](../../plans/BA-9.md#34-synthetic-domain-databases-the-right-material-with-conditions), Step 1d, [BA-185](https://halo-powered.atlassian.net/browse/BA-185)). Six personal-lines insurance carriers report their policy sales to a market-insight product; the product adds revenue by period, the carriers' own marketing campaigns and a market benchmark in which each subscriber sees its competitors only as masked labels. It is the only domain with a governance question. Every row is invented by a seeded generator; no carrier, product, person or figure is real. Written by Claude on 2026-10-13 with no business review (decided that day); the business rules are in [marketing-analytics-policy.md](marketing-analytics-policy.md).

| | |
|---|---|
| Fixture and set id | `marketing-analytics` |
| Schema and database | `marketing_analytics`, in its own database `marketing_analytics` on the shared server |
| Seed | `backend/src/modules/testing-data/fixtures/008_marketing_analytics.sql` (about 0.66 MB) |
| Generator | `docker/postgres/generate/marketing-analytics.ts`, seed 20261013 |
| Planted facts | `backend/scripts/fixtures/marketing-analytics/facts.json` |
| JSON dump | `backend/scripts/fixtures/marketing-analytics/data/`: 14 relations, gzipped, 0.16 MB, the input of the Databricks loader and the REST server ([evidence](../../../evidence/1.1.7/dump-marketing-analytics.txt)) |
| Questions | `backend/src/mastra/evals/sets/marketing-analytics.json`, 50 questions |
| Datasource and dataset | "Marketing Analytics PostgreSQL", "Marketing Analytics" (Settings, Testing Data loads both) |
| References run | [`evidence/1.1.7/references-marketing-analytics.txt`](../../../evidence/1.1.7/references-marketing-analytics.txt) |

## The persona

Dana Whitfield is a marketing performance analyst at **Harborline Mutual**, a mid-size mutual carrier headquartered in Massachusetts that sells personal auto, homeowners, renters, term life and (since May 2024) pet health in eight states. Harborline subscribes to the market-insight product. Each quarter Dana reports Harborline's sales and revenue to the marketing leadership, checks how its campaigns did, and sets Harborline against the market. Under Harborline's licence she sees Harborline's own figures, the market's totals, and every other carrier only as "Competitor A" to "Competitor E". She says "we" and "our" for Harborline; the questions in the set name Harborline so that they stand alone.

The questions she asks, in her words:

1. How many policies did we sell last quarter, and through which channels?
2. What was our written premium by region, and by line of business?
3. What was our revenue this year, and how does it compare with what we wrote?
4. Which of our campaigns brought in the most leads, and which converted best?
5. What did each policy cost us to acquire, by channel?
6. Which campaigns overspent their budget?
7. Where do customers walk away before the policy starts?
8. What is our share of the market in each line, and is it growing?
9. Which competitor is growing fastest in auto?
10. What does the market look like by region and product family?

## The data

Fourteen tables, no views. Quarters run 2024-Q1 to 2025-Q4; 2025-Q4 is preliminary and 2026-Q1 is listed but not reported.

| Table | Grain | Notes |
|---|---|---|
| `regions` | one region | Northeast, Southeast, Midwest, West |
| `states` | one state | 12 states, each in one region |
| `carriers` | one carrier | 6: Harborline Mutual, Crestview Insurance, Northgate Assurance, Bluefield General, Pinecrest Casualty, Tidewater Insurance Group; segment, headquarters state (`hq_state_id`) |
| `lines_of_business` | one line | Personal auto, Homeowners, Renters, Term life, Pet health; `product_family` (Property & casualty, Life, Specialty) |
| `products` | one carrier's product in one line | 24; `launched_on`. Names never contain a carrier name |
| `channels` | one sales channel | Independent agents, Direct online, Mobile app, Call center; `is_digital` |
| `periods` | one calendar quarter | `period_code` (2025-Q2), calendar and fiscal year and quarter, dates, `reporting_status` |
| `policy_sales` | one carrier, product, channel, state, quarter and status | 10,822 rows, each a total: `policy_count`, `written_premium_cents`, `sale_status` (BOUND, NTU, PENDING), `currency_code`, `is_test` |
| `revenue_by_period` | one carrier, line and quarter | `earned_premium_cents`, `fee_income_cents` |
| `campaigns` | one campaign | 26, for the three carriers that load campaigns (Harborline 14, Crestview 6, Pinecrest 6); line, channel, objective, dates, `promo_code` |
| `campaign_results` | one campaign in one quarter | budget and spend in cents, impressions, clicks, leads, quotes, policies bound |
| `market_benchmarks` | one viewing carrier, quarter, line and competitor | the competitor under the viewer's masked label (`Competitor A` to `Competitor E`), its policies and written premium |
| `competitor_masks` | one viewing carrier and label | which carrier each label stands for, per viewer. The product's own key: never shown to a subscriber (policy) |
| `analyst_access` | one analyst | 12 analysts, their carrier, role and `competitor_visibility` (MASKED or AGGREGATE_ONLY) |

## Glossary

| Term | Synonyms a user says | Meaning in the data |
|---|---|---|
| Policies sold | sales, new business, policies written, bound policies | `policy_sales.policy_count` where `sale_status = 'BOUND'` and not a test row |
| Written premium | sales premium, gross written premium, GWP, premium written | `policy_sales.written_premium_cents` on sold policies, in dollars |
| Earned premium | premium earned | `revenue_by_period.earned_premium_cents`, in dollars |
| Revenue | income, top line | earned premium plus fee income, `revenue_by_period` (policy) |
| Walk-away | not taken up, NTU, withdrawn, dropped before start | `sale_status = 'NTU'` |
| Walk-away rate | NTU rate, drop-off rate | walk-aways over (sold plus walk-aways) |
| Pending | in underwriting, not yet bound | `sale_status = 'PENDING'`; only in the preliminary quarter |
| The market | industry, all carriers | the six reporting carriers together |
| Share of market | market share, SOM | a carrier's written premium over the market's, same line and period |
| Competitor | peer, rival, masked competitor | another carrier, shown only as its masked label |
| Benchmark | market benchmark, peer comparison | `market_benchmarks` for the user's own carrier |
| Line of business | LOB, product line, line | `lines_of_business` |
| Product family | segment of lines | `lines_of_business.product_family` |
| Channel | distribution channel, sales channel | `channels` |
| Digital channels | online, digital | channels with `is_digital`: Direct online and Mobile app |
| Click-through rate | CTR | clicks over impressions |
| Lead-to-policy conversion | conversion rate, close rate | policies bound over leads |
| Cost per acquisition | CPA, cost per policy | campaign spend over policies bound |
| Cost per lead | CPL | campaign spend over leads |
| Budget use | pacing, share of budget spent | spend over budget; above 100% is an overspend |
| Quarter | Q2 2025, second quarter | a calendar quarter, `periods.period_code` |
| Fiscal year | FY2025, FY25 | July to June, named for the year it ends in (policy) |
| Final, preliminary, not reported | closed, provisional, open | `periods.reporting_status` |
| Test rows | QA loads, feed tests | `policy_sales.is_test` |
| Promo code | offer code, discount code | `campaigns.promo_code`; most campaigns have none |

## Default filters and metrics

- **Sold means bound.** A sales figure counts `BOUND` rows only; walk-aways and pending policies are reported only when asked for.
- **Test rows are out.** Every figure leaves out `is_test` rows. Say so once in the answer.
- **Money in dollars.** Every `_cents` column is divided by 100.
- **Periods.** A quarter is a calendar quarter. "Latest quarter" is the latest with data (2025-Q4) and must be called preliminary; "latest final quarter" is 2025-Q3. 2026-Q1 has no data.
- **Governance.** "We" is the user's carrier. Other carriers appear only under the user's masked labels or in totals ([policy](marketing-analytics-policy.md#governance-who-sees-what)).

Metrics, all with the filters above: policies sold; written premium; earned premium; revenue; premium per policy (written premium over policies, never an average of rows: each row is already a total); share of market; walk-away rate; digital share (digital policies over all policies); click-through rate; lead-to-policy conversion; cost per acquisition; cost per lead; budget use; growth (percentage unless the user says dollars).

## Trap plan

Which schema feature serves which category ([research 2.6](../../research/BA-9.md#26-categories-of-the-golden-dataset)), and the questions that exercise it. The generator asserts each planted fact and throws rather than write a fixture whose trap drifted.

| # | Planted in the schema or data | Category | Questions |
|---|---|---|---|
| M1 | Money in cents: premium, revenue, spend and budget are `_cents` | aggregate, join, ranking | `market-premium-by-line-2025`, `harborline-campaign-spend-2025`, `harborline-spend-by-channel-2025`, `lowest-premium-channel-2025` |
| M2 | Test flag: six QA rows (`is_test`), three on Harborline's app in 2025-Q2 worth 7,500 policies at $1 each, enough to make the app look like the top channel | default-filter, aggregate, ranking | `top-channel-q2-2025`, `harborline-policies-sold-2025-q2`, `top-five-states-2025` |
| M3 | Constant column: `currency_code` is USD on every row | aggregate | `harborline-premium-by-currency-2025` |
| M4 | Sparse column: `promo_code` on 5 of Harborline's 14 campaigns; the blank group holds most leads | null | `top-promo-code-by-leads` |
| M5 | Status code whose business word differs: "walked away" is stored as NTU, "sold" as BOUND | encoding, business-term, aggregate | `harborline-walk-aways-2025`, `highest-walk-away-rate-channel-2025`, `harborline-policies-sold-2025-q2` |
| M6 | Tie at the top: California and New York both sold exactly 1,062 Harborline auto policies in 2025-Q4 | ranking | `top-auto-state-q4-2025` |
| M7 | Empty period: Harborline paused every campaign in 2024-Q3 (no result rows), and its sales dipped; 2026-Q1 is listed but not reported | null, reasoning, out-of-scope, lookup | `quarter-without-campaign-spend`, `campaign-freeze-impact`, `harborline-sales-q1-2026`, `latest-final-quarter` |
| M8 | Fiscal year runs July to June, named for its end year | lookup, encoding | `fiscal-quarter-of-july-2024`, `harborline-premium-fiscal-2025` |
| M9 | Lookalike column pairs for ratios: impressions, clicks, leads, quotes, policies bound; spend and budget | ratio | `top-ctr-campaigns-2025`, `best-lead-to-policy-channel-2025`, `top-budget-share-campaigns-2025` |
| M10 | Rows are totals: averaging rows is the wrong grain for premium per policy | ratio | `premium-per-policy-top-line-2025` |
| M11 | Multi-hop joins: sales to states to regions; products to lines to families; results to campaigns to channels and lines | join | `harborline-premium-by-region-2025`, `market-premium-by-family-and-region-2025`, `harborline-leads-by-line-2025`, `northeast-auto-policies-q4-2025`, `harborline-spend-by-channel-2025` |
| M12 | Business terms not in the schema: revenue, share of market, walk-away rate, cost per acquisition | business-term, ratio | `harborline-revenue-2025`, `highest-walk-away-rate-channel-2025`, `lowest-cost-per-acquisition-channel-2025`, `largest-market-share-line-2025` |
| M13 | Share against volume, percentage against dollars: each pair names different winners | ratio, ranking | `highest-digital-share-region-2025`, `largest-market-share-line-2025`, `fastest-growing-line-2024-to-2025` |
| M14 | Governance: every carrier's sales by name, the masked benchmark per viewer, and the unmasking key in the same dataset | governance tag on aggregate, ranking, out-of-scope | `gov-auto-premium-vs-market-q2-2025`, `gov-pinecrest-pet-vs-rest-2025`, `gov-fastest-growing-competitor`, `gov-unmask-competitor` |
| | Also: other carriers' campaigns (a missing carrier filter), an id-only column (`hq_state_id`), a mid-quarter launch date, a carrier that does not exist (Lakeshore Indemnity), a measure that does not exist (customer satisfaction) | join, ranking, lookup, non-existent, out-of-scope | `harborline-leads-by-line-2025`, `top-three-campaigns-by-leads-2025`, `harborline-headquarters`, `harborline-pet-launch`, `lakeshore-indemnity-sales`, `customer-satisfaction-2025` |

## The question set

50 questions in one PostgreSQL variant, 16 held out (32%):

| Category | Questions | Held out |
|---|---:|---:|
| lookup | 6 | 2 |
| aggregate | 8 | 2 |
| join | 5 | 2 |
| ranking | 6 | 2 |
| ratio | 6 | 2 |
| business-term | 3 | 1 |
| encoding | 2 | 1 |
| null | 2 | 1 |
| default-filter | 1 | 0 |
| discovery | 2 | 1 |
| ambiguous | 2 | 1 |
| out-of-scope | 3 | 1 |
| non-existent, fuzzy-scope, visual, reasoning | 1 each | 0 |

Four questions carry the tag `governance`. Three are asked as Harborline (its auto premium against the market; which competitor grew fastest, answered with the masked label "Competitor C"; a request to unmask "Competitor B") and one as Pinecrest Casualty, whose plan shows competitors only in aggregate. Each is scored with a `notMatches` check on every other carrier's name and code, so the answer fails if it names one. Each question states the user's carrier and licence, so it can be judged without the policy loaded as knowledge.

How the references were written, so the result-set check is fair: a breakdown's reference projects only the measure, so a label written as a name, a code or a quarter code matches; a "which" question's reference projects only the names, so a rate written as a fraction or a percentage matches; no `LIMIT` cuts a tie. Every reference was run on a loaded copy and checked against `facts.json`, and every case's trap query was run to confirm it returns different rows ([evidence](../../../evidence/1.1.7/references-marketing-analytics.txt)). Alternative computations (average of quarterly ratios instead of sum over sum; walk-aways over sold instead of over sold plus walk-aways) name the same winners.

## Regenerate, load, validate

```bash
cd backend && npm run fixtures:marketing-analytics      # writes the seed SQL and facts.json
# Settings, Testing Data, Marketing Analytics, Load (or TestingDataService.load), then:
EVAL_SET=marketing-analytics EVAL_DATASETS="Marketing Analytics" npm run eval:validate
npm run fixture:dump -- --fixture marketing-analytics   # add --database <db> for a copy loaded elsewhere
```

Changing the seed or a knob changes the figures: rerun every reference, update the notes and checks that quote them, and dump again.

## Not done yet

- No knowledge seed: the glossary, default filters and policy are not loaded as knowledge entries (plan 3.4 step 4). The business-term questions are written to be answerable from the schema's cues, and the governance questions state the rule; with the policy loaded as knowledge, the set measures the knowledge-on arm (BA-80).
- PostgreSQL only. Databricks and REST variants come with Steps 2 and 3 from the dump of this fixture.
- No baseline run with a model yet.

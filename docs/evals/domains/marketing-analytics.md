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
| Questions | `backend/src/mastra/evals/sets/marketing-analytics.json`, 56 questions (50 of BA-185 and the six investigation questions of BA-243, below) |
| Datasource and dataset | "Marketing Analytics PostgreSQL", "Marketing Analytics" (Settings, Testing Data loads both) |
| Knowledge seed | `backend/src/modules/testing-data/fixtures/knowledge/marketing-analytics.ts`: the policy's rules, created when the sample is loaded (testing-data R26; roadmap 1.1.25, each rule checked by SQL in `evidence/1.1.25/seed-verification.md`) |
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

56 questions in one PostgreSQL variant, 18 held out (32%; 50 and 16 until the BA-243 investigation questions entered on 2026-10-26):

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
| reasoning | 7 | 2 |
| non-existent, fuzzy-scope, visual | 1 each | 0 |

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

- The knowledge seed (added 2026-10-24, roadmap 1.1.25) holds the policy's rules only, each checked by SQL: 13 entries (a default filter on test rows, four instructions on the viewer, masked competitors, aggregate-only plans and private campaign data, eight terms) and four metrics. It leaves out the glossary terms the policy does not state (digital channels, product families, promo codes), join paths, and the policy's "best with no measure" default, which the `ambiguous` questions test (testing-data R27). The business-term questions are still written to be answerable from the schema's cues, and the governance questions still state the rule; with the seed loaded, the set measures the knowledge-on arm (BA-80).
- PostgreSQL only. Databricks and REST variants come with Steps 2 and 3 from the dump of this fixture.
- No baseline run with a model yet.

## Investigation brief: Harborline's Q3 2024 sales dip (approved; in the set since 2026-10-26)

Status: drafted by Claude on 2026-10-23; approved by the user on 2026-10-26 as drafted (*What approval decides*, below); its six cases (four dev, two held out) entered `marketing-analytics.json` the same day, with the held-out wording of *Held-out wording* below.

A why question for the investigation questions of roadmap 1.1.21 ([BA-243](https://halo-powered.atlassian.net/browse/BA-243)). The story is trap M7, already in the data: the generator writes no Harborline campaign result for 2024-Q3 and scales Harborline's sales that quarter by 0.86 (`FREEZE_PERIOD` and `FREEZE_SALES_FACTOR` in `docker/postgres/generate/marketing-analytics.ts`). No fixture, generator or facts.json change is needed. The existing case `campaign-freeze-impact` names the pause in its question; the questions of this brief do not.

### Who asks

Harborline's head of marketing asks Dana Whitfield, the analyst of the persona above, while preparing the 2024 review for the board. The board saw Q3 2024 sales fall and wants a reason before the 2025 budget is set.

### How they ask

They state the dip and ask why, in plain words: Harborline, the quarter, policies sold or sales. They name no cause, no channel and no campaign, and they expect a reason backed by figures. "We" is Harborline.

### The true cause

Harborline paused every campaign in 2024-Q3. No campaign has a result that quarter, so there was no campaign spend and no campaign lead, although two campaigns were scheduled through it. Sales fell 11.55% that quarter and rose 14.25% in Q4, when the campaigns came back. The rest of the market barely moved.

The data shows a match in time with no other change; it cannot measure the effect. Harborline's campaigns bound 782 policies in 2024-Q2 and 998 in 2024-Q4, fewer than the 1,309 lost, so a careful answer says the pause matches the dip, not that it accounts for every policy.

### What a good analyst finds

1. **The dip**, with the default filters (bound policies, test rows out): 11,337 in 2024-Q2, 10,028 in Q3, 11,457 in Q4. Down 1,309 (-11.55%), then up 1,429 (+14.25%). (MF1)
2. **The market did not dip.** The other five carriers together: 59,195, 58,257 and 55,395, so -1.58% into Q3 and -4.91% into Q4. The whole market, Harborline included, fell 3.19% (70,532 to 68,285), and Harborline's 1,309 is 58.26% of that fall. The masked benchmark Harborline sees sums to the same totals, so the comparison needs no competitor's name. (MF2, MF3)
3. **It is not Harborline's own season.** A year later Harborline rose from Q2 to Q3 (12,415 to 12,700, +2.30%). (MF8)
4. **Where the policies were lost.** By channel: Direct online -573 (-16.92%), Mobile app -439 (-19.53%), Independent agents -297 (-7.02%), Call center 0. The two digital channels hold 1,012 of the 1,309 (77.31%). Every line fell, from -6.55% (Personal auto) to -19.31% (Renters). (MF4, MF5)
5. **What changed.** Harborline's campaigns have results in every quarter from 2024-Q1 to 2025-Q4 except 2024-Q3: no row, no spend. Spend was $163,790.43 in Q2 and $208,825.54 in Q4. (MF6)
6. **The lookalike.** The campaign calendar lists Agent Bundle Days (2024-04-15 to 2024-12-31) and Loyalty Renewal Reminder (2024-01-15 to 2024-12-31) across Q3, but neither has a Q3 result. Read the results, not the dates. (MF7)
7. **Other causes the data rules out.** Customers did not walk away more: the walk-away rate fell from 4.22% to 3.67%. Premium per policy rose 2.03% ($1,167.76 to $1,191.45) and fell 3.02% in Q4; the data cannot say whether prices changed, so no check depends on it. (MF9)

The generator scales every Harborline channel alike in 2024-Q3. That the digital channels carry most of the drop comes from its random draws, not from where the campaigns ran: Harborline's Q2 campaigns ran on all four channels, and the call center, which had one, did not fall (MF4, MF6). A question may ask where the drop was, never why it was there.

### The planted wrong explanation

A seasonal, market-wide summer slowdown. It is plausible because the whole market did fall in Q3 2024 (-3.19%) and again in Q4. The rest of the market rules it out: the other five carriers fell only 1.58% (59,195 to 58,257) while Harborline fell 11.55%, and Harborline grew from Q2 to Q3 in 2025 (+2.30%).

Two test-row traps (M2) make the wrong explanation look right:

- With its 7,500 test policies, Harborline's 2025-Q2 reads 19,915, so Q2 to Q3 2025 looks like a 36.23% fall: "Q3 is always weak". (MF8)
- With Crestview's 3,600 test policies in 2024-Q4, the other carriers seem to rise 1.27% into Q4 instead of falling 4.91%: "the market recovered". (MF2)

### Facts and validator queries

Run on 2026-10-23 on `loop_marketing_analytics`, the loop's copy of the sample (port 55433), in read-only transactions. MF1 agrees with facts.json `campaignFreeze.harborlinePolicies` and MF6 with `campaignFreeze.quarterWithoutSpend`; the other facts are not in facts.json. The percentages above were computed in SQL from these rows.

**MF1. Harborline's bound policies by quarter, test rows out.**

```sql
SELECT p.period_code, SUM(s.policy_count) AS policies
FROM marketing_analytics.policy_sales s
JOIN marketing_analytics.carriers c ON c.id = s.carrier_id
JOIN marketing_analytics.periods p ON p.id = s.period_id
WHERE c.name = 'Harborline Mutual' AND s.sale_status = 'BOUND' AND NOT s.is_test
GROUP BY p.period_code ORDER BY p.period_code;
```

Returned:

```text
period_code | policies
2024-Q1 | 8778
2024-Q2 | 11337
2024-Q3 | 10028
2024-Q4 | 11457
2025-Q1 | 10639
2025-Q2 | 12415
2025-Q3 | 12700
2025-Q4 | 12600
(8 rows)
```

**MF2. The other five carriers' bound policies, with and without test rows.** The masked benchmark (second query) gives the same totals without test rows.

```sql
SELECT p.period_code,
       SUM(s.policy_count) FILTER (WHERE NOT s.is_test) AS without_test_rows,
       SUM(s.policy_count) AS with_test_rows
FROM marketing_analytics.policy_sales s
JOIN marketing_analytics.carriers c ON c.id = s.carrier_id
JOIN marketing_analytics.periods p ON p.id = s.period_id
WHERE c.name <> 'Harborline Mutual' AND s.sale_status = 'BOUND'
  AND p.period_code IN ('2024-Q2', '2024-Q3', '2024-Q4', '2025-Q2', '2025-Q3')
GROUP BY p.period_code ORDER BY p.period_code;
```

Returned:

```text
period_code | without_test_rows | with_test_rows
2024-Q2 | 59195 | 59195
2024-Q3 | 58257 | 58257
2024-Q4 | 55395 | 58995
2025-Q2 | 64159 | 64159
2025-Q3 | 60888 | 63888
(5 rows)
```

```sql
SELECT p.period_code, SUM(b.policy_count) AS masked_competitors
FROM marketing_analytics.market_benchmarks b
JOIN marketing_analytics.carriers c ON c.id = b.viewer_carrier_id
JOIN marketing_analytics.periods p ON p.id = b.period_id
WHERE c.name = 'Harborline Mutual' AND p.period_code IN ('2024-Q2', '2024-Q3', '2024-Q4')
GROUP BY p.period_code ORDER BY p.period_code;
```

Returned:

```text
period_code | masked_competitors
2024-Q2 | 59195
2024-Q3 | 58257
2024-Q4 | 55395
(3 rows)
```

**MF3. The whole market, Harborline included.**

```sql
SELECT p.period_code, SUM(s.policy_count) AS market_policies
FROM marketing_analytics.policy_sales s
JOIN marketing_analytics.periods p ON p.id = s.period_id
WHERE s.sale_status = 'BOUND' AND NOT s.is_test AND p.period_code IN ('2024-Q2', '2024-Q3', '2024-Q4')
GROUP BY p.period_code ORDER BY p.period_code;
```

Returned:

```text
period_code | market_policies
2024-Q2 | 70532
2024-Q3 | 68285
2024-Q4 | 66852
(3 rows)
```

**MF4. Harborline by channel, 2024-Q2 to Q4.**

```sql
SELECT ch.name AS channel,
       SUM(s.policy_count) FILTER (WHERE p.period_code = '2024-Q2') AS q2,
       SUM(s.policy_count) FILTER (WHERE p.period_code = '2024-Q3') AS q3,
       SUM(s.policy_count) FILTER (WHERE p.period_code = '2024-Q4') AS q4
FROM marketing_analytics.policy_sales s
JOIN marketing_analytics.carriers c ON c.id = s.carrier_id
JOIN marketing_analytics.periods p ON p.id = s.period_id
JOIN marketing_analytics.channels ch ON ch.id = s.channel_id
WHERE c.name = 'Harborline Mutual' AND s.sale_status = 'BOUND' AND NOT s.is_test
GROUP BY ch.name ORDER BY ch.name;
```

Returned:

```text
channel | q2 | q3 | q4
Call center | 1470 | 1470 | 1528
Direct online | 3387 | 2814 | 3336
Independent agents | 4232 | 3935 | 4428
Mobile app | 2248 | 1809 | 2165
(4 rows)
```

**MF5. Harborline by line, 2024-Q2 to Q4.**

```sql
SELECT l.name AS line,
       SUM(s.policy_count) FILTER (WHERE p.period_code = '2024-Q2') AS q2,
       SUM(s.policy_count) FILTER (WHERE p.period_code = '2024-Q3') AS q3,
       SUM(s.policy_count) FILTER (WHERE p.period_code = '2024-Q4') AS q4
FROM marketing_analytics.policy_sales s
JOIN marketing_analytics.carriers c ON c.id = s.carrier_id
JOIN marketing_analytics.periods p ON p.id = s.period_id
JOIN marketing_analytics.products pr ON pr.id = s.product_id
JOIN marketing_analytics.lines_of_business l ON l.id = pr.line_id
WHERE c.name = 'Harborline Mutual' AND s.sale_status = 'BOUND' AND NOT s.is_test
GROUP BY l.name ORDER BY l.name;
```

Returned:

```text
line | q2 | q3 | q4
Homeowners | 2679 | 2269 | 2562
Personal auto | 4736 | 4426 | 4885
Pet health | 814 | 750 | 921
Renters | 2268 | 1830 | 2201
Term life | 840 | 753 | 888
(5 rows)
```

**MF6. Harborline's campaign results by quarter: none in 2024-Q3** (2026-Q1 is not reported). The second query shows that the 2024-Q2 campaigns ran on all four channels.

```sql
SELECT p.period_code, COUNT(r.id) AS result_rows,
       SUM(r.spend_cents) / 100.0 AS spend_dollars, SUM(r.policies_bound) AS policies_bound
FROM marketing_analytics.periods p
LEFT JOIN (marketing_analytics.campaign_results r
           JOIN marketing_analytics.campaigns cm ON cm.id = r.campaign_id
           JOIN marketing_analytics.carriers c ON c.id = cm.carrier_id AND c.name = 'Harborline Mutual')
       ON r.period_id = p.id
GROUP BY p.period_code ORDER BY p.period_code;
```

Returned:

```text
period_code | result_rows | spend_dollars | policies_bound
2024-Q1 | 3 | 140328.280000000000 | 627
2024-Q2 | 4 | 163790.430000000000 | 782
2024-Q3 | 0 |  | 
2024-Q4 | 4 | 208825.540000000000 | 998
2025-Q1 | 3 | 131901.260000000000 | 689
2025-Q2 | 4 | 235915.820000000000 | 1212
2025-Q3 | 3 | 150636.420000000000 | 641
2025-Q4 | 3 | 159602.430000000000 | 642
2026-Q1 | 0 |  | 
(9 rows)
```

```sql
SELECT ch.name AS channel, COUNT(*) AS result_rows, SUM(r.spend_cents) / 100.0 AS spend_dollars,
       SUM(r.policies_bound) AS policies_bound
FROM marketing_analytics.campaign_results r
JOIN marketing_analytics.campaigns cm ON cm.id = r.campaign_id
JOIN marketing_analytics.carriers c ON c.id = cm.carrier_id
JOIN marketing_analytics.channels ch ON ch.id = cm.channel_id
JOIN marketing_analytics.periods p ON p.id = r.period_id
WHERE c.name = 'Harborline Mutual' AND p.period_code = '2024-Q2'
GROUP BY ch.name ORDER BY ch.name;
```

Returned:

```text
channel | result_rows | spend_dollars | policies_bound
Call center | 1 | 39164.720000000000 | 236
Direct online | 1 | 37977.550000000000 | 137
Independent agents | 1 | 44734.800000000000 | 224
Mobile app | 1 | 41913.360000000000 | 185
(4 rows)
```

**MF7. Harborline's campaigns scheduled across 2024-Q3, and their Q3 results.**

```sql
SELECT cm.name, ch.name AS channel, cm.starts_on, cm.ends_on,
       COUNT(r.id) FILTER (WHERE p.period_code = '2024-Q3') AS q3_result_rows
FROM marketing_analytics.campaigns cm
JOIN marketing_analytics.carriers c ON c.id = cm.carrier_id
JOIN marketing_analytics.channels ch ON ch.id = cm.channel_id
LEFT JOIN marketing_analytics.campaign_results r ON r.campaign_id = cm.id
LEFT JOIN marketing_analytics.periods p ON p.id = r.period_id
WHERE c.name = 'Harborline Mutual' AND cm.starts_on <= DATE '2024-09-30' AND cm.ends_on >= DATE '2024-07-01'
GROUP BY cm.name, ch.name, cm.starts_on, cm.ends_on ORDER BY cm.name;
```

Returned:

```text
name | channel | starts_on | ends_on | q3_result_rows
Agent Bundle Days | Independent agents | 2024-04-15 | 2024-12-31 | 0
Loyalty Renewal Reminder | Call center | 2024-01-15 | 2024-12-31 | 0
(2 rows)
```

**MF8. Harborline from Q2 to Q3 2025, with and without test rows.**

```sql
SELECT p.period_code,
       SUM(s.policy_count) FILTER (WHERE NOT s.is_test) AS without_test_rows,
       SUM(s.policy_count) AS with_test_rows
FROM marketing_analytics.policy_sales s
JOIN marketing_analytics.carriers c ON c.id = s.carrier_id
JOIN marketing_analytics.periods p ON p.id = s.period_id
WHERE c.name = 'Harborline Mutual' AND s.sale_status = 'BOUND' AND p.period_code IN ('2025-Q2', '2025-Q3')
GROUP BY p.period_code ORDER BY p.period_code;
```

Returned:

```text
period_code | without_test_rows | with_test_rows
2025-Q2 | 12415 | 19915
2025-Q3 | 12700 | 12700
(2 rows)
```

**MF9. Harborline's walk-away rate and premium per policy, 2024-Q2 to Q4.**

```sql
SELECT p.period_code,
       ROUND(SUM(s.policy_count) FILTER (WHERE s.sale_status = 'NTU')::numeric
             / SUM(s.policy_count) FILTER (WHERE s.sale_status IN ('BOUND', 'NTU')), 4) AS walk_away_rate,
       ROUND(SUM(s.written_premium_cents) FILTER (WHERE s.sale_status = 'BOUND') / 100.0
             / SUM(s.policy_count) FILTER (WHERE s.sale_status = 'BOUND'), 2) AS premium_per_policy
FROM marketing_analytics.policy_sales s
JOIN marketing_analytics.carriers c ON c.id = s.carrier_id
JOIN marketing_analytics.periods p ON p.id = s.period_id
WHERE c.name = 'Harborline Mutual' AND NOT s.is_test AND p.period_code IN ('2024-Q2', '2024-Q3', '2024-Q4')
GROUP BY p.period_code ORDER BY p.period_code;
```

Returned:

```text
period_code | walk_away_rate | premium_per_policy
2024-Q2 | 0.0422 | 1167.76
2024-Q3 | 0.0367 | 1191.45
2024-Q4 | 0.0389 | 1155.42
(3 rows)
```

### Dev questions (draft cases)

Four dev variants written by Claude, category `reasoning`, split `dev`, tag `investigation`. Each is scored by:

- `matches` (G3): the true cause in the answer, Harborline's campaigns paused (or, for the rebound, back). On the director's claim it also needs a market figure, such as 1.6%, 58,257, 938, 3.2% or 68,285.
- `notMatches` (G3): the wrong explanation asserted. That is a seasonal or market-wide cause in a causal frame ("due to", "driven by", "reflects" and the like) or "it was seasonal", plus, per variant, an answer that opens by agreeing, campaigns said to be running in Q3, or the market said to have recovered. A clause that negates it first ("not", "n't", "rather than", "if", "whether", or "no" just before) does not match, so an answer may name the wrong explanation to rule it out.
- `usesEntities` `campaign_results` (D2): one successful query read the campaign results, the only table that shows the pause.
- `calledTool` `run_readonly_sql` (D1), `noToolErrors` (D3), and the result-set match on the reference.

`numbersGrounded` is left out. It fails "$86.3 million" against a result of 86,279,750.70, and a percentage change the SQL did not compute (agents-evals R115), and both are normal in an investigation answer. Add it once rule A40 holds on the loop's model (BA-244).

Widened on 2026-10-27, after round 17 ([evidence/1.1.21/checks.txt](../../../evidence/1.1.21/checks.txt)): the `matches` patterns of the six cases also accept the wording of a right answer that had failed them ("$0 recorded campaign spend", "neither had a recorded Q3 campaign-results row", "no campaign_results rows"), and the windows between key words no longer stop at a decimal point; the blocks below show the widened patterns. Re-scored on the 18 marketing answers of round 17 (one attempt from fail to pass, none the other way) and on the simulated answers (every wrong explanation still fails).

Validated on 2026-10-23:

- every PostgreSQL reference and trap query ran on `loop_marketing_analytics`, and each trap returns other rows;
- every SQLite reference ran over the committed dump, materialised as the REST connector does, and returns the PostgreSQL rows;
- every Databricks reference passed the static checks (R118 rules, three-part names, required tables, the same tables as PostgreSQL); none was run (VDI, R208);
- the repo's loader (`loadEvalSets`) accepted a scratch copy of `marketing-analytics.json` with the four cases added;
- each case's checks were scored with the repo's check code on simulated answers: every correct answer passed, including those that name the wrong explanation to deny it, and every answer that gives the wrong explanation failed `notMatches`.

| Id | Angle | The reference returns | It fails an answer that |
|---|---|---|---|
| `why-harborline-q3-2024-dip` | the plain why, cause unnamed | Harborline's policies, 2024-Q2 to Q4 (as `campaign-freeze-impact`) | blames a seasonal or market-wide slowdown, or never finds the pause |
| `harborline-q3-2024-dip-summer-claim` | the user offers the wrong explanation | the rest of the market, 2024-Q2 and Q3 | agrees, blames the season, or gives no market figure or no pause |
| `harborline-q3-2024-dip-campaign-calendar` | a false premise from the calendar | Harborline's campaign spend, 2024-Q2 and Q4 (none in Q3) | says the campaigns were running, rules marketing out, or agrees |
| `harborline-q4-2024-rebound` | two hypotheses, one wrong, with the test-row trap | the rest of the market, 2024-Q3 and Q4, test rows out | says the market recovered or rose, or finds no campaign change |

```json
{
  "id": "why-harborline-q3-2024-dip",
  "category": "reasoning",
  "split": "dev",
  "tags": [
    "investigation",
    "trap:empty-period",
    "trap:wrong-explanation",
    "difficulty:hard"
  ],
  "question": "Harborline Mutual sold fewer policies in Q3 2024 than in the quarter before or the quarter after. What explains the dip?",
  "intent": "An investigation: size the dip, check it against the rest of the market, and find what changed for Harborline that quarter (no campaign had any results).",
  "notes": "Investigation, planted story M7. Harborline sold 11,337 policies in 2024-Q2, 10,028 in 2024-Q3 and 11,457 in 2024-Q4 (bound, test rows out). The other five carriers fell only 1.6% (59,195 to 58,257), so the dip is Harborline's own. Harborline's campaigns have results in every quarter from 2024-Q1 to 2025-Q4 except 2024-Q3, although two were scheduled through it. The reference projects only the three counts, as campaign-freeze-impact does.\n\nWrong explanation planted: a seasonal or market-wide summer slowdown. The notMatches check fails an answer that asserts it in a causal frame (due to, driven by, reflects ...) or says the dip was seasonal; a denial (not seasonal, rather than the market) passes.\n\nChecked against facts.json: campaignFreeze.harborlinePolicies and campaignFreeze.quarterWithoutSpend.\n\nTrap query (must return different rows): SELECT SUM(s.policy_count) AS policies FROM marketing_analytics.policy_sales s JOIN marketing_analytics.carriers c ON c.id = s.carrier_id JOIN marketing_analytics.periods p ON p.id = s.period_id WHERE c.name = 'Harborline Mutual' AND p.period_code IN ('2024-Q2', '2024-Q3', '2024-Q4') AND NOT s.is_test GROUP BY p.period_code ORDER BY p.period_code\n\nParaphrases: none written. The held-out wording of this brief is written by the user, not derived from this case.\n\nBrief: docs/evals/domains/marketing-analytics.md, Investigation brief: Harborline's Q3 2024 sales dip (facts MF1 to MF9).",
  "checks": [
    {
      "type": "matches",
      "args": {
        "pattern": "(?:campaign|marketing)s?\\b(?:[^.\\n]|\\.(?=\\d)){0,60}?\\b(?:paus\\w*|stopp\\w*|stop|halt\\w*|froze|frozen|freez\\w*|suspend\\w*|went dark|dark|zero|absent|inactive|idle|ceased|did not run|didn['’]t run|were not running|weren['’]t running|not running|no (?:spend|activity|results|data|rows))\\b|\\b(?:paus\\w*|stopp\\w*|halt\\w*|froze|frozen|freez\\w*|suspend\\w*|no|zero|without|absence of|lack of|ceased)\\s+(?:\\w+\\s+){0,3}?(?:campaign|marketing)|\\$0\\b(?:\\s+\\w+){0,3}\\s+(?:campaign|marketing)|\\bneither\\b(?:[^.\\n]|\\.(?=\\d)){0,40}?(?:campaign|marketing)|\\b(?:no|zero|without|missing|absent|lack of|absence of)\\s+(?:\\w+\\s+){0,3}?campaign_results|\\bcampaign_results\\b(?:[^.\\n]|\\.(?=\\d)){0,40}?\\b(?:none|no|zero|0|null|missing|absent|empty|had no|has no|have no)\\b|(?:campaign|marketing)[\\s_-]results?\\s+rows?\\b(?:[^.\\n]|\\.(?=\\d)){0,24}?\\b(?:none|no|zero|0|null|missing|absent|empty)\\b|(?:campaign|marketing)s?\\b(?:[^.\\n]|\\.(?=\\d)){0,60}?\\b(?:\\$0\\b|0 impressions|no recorded|not recorded|nothing recorded|unrecorded|no (?:campaign[\\s_-])?results?(?: rows?)?)\\b",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "notMatches",
      "args": {
        "pattern": "(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:due to|because of|caused by|driven by|explained by|attributable to|(?:the|a) result of|reflects?|reflected|reflecting|down to|thanks to|stems? from|came from|comes from)\\s+(?:an?\\s+|the\\s+)?(?:\\w+[\\s-]+){0,2}?(?:seasonal\\w*|summer|market[\\s-]wide|industry[\\s-]wide|(?:overall|broader|general|wider|whole)\\s+market|market\\s+(?:slowdown|softness|weakness|decline|downturn|dip|slump))|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:it|this|the (?:dip|drop|decline|fall))\\s+(?:was|is)\\s+(?:just\\s+|simply\\s+|only\\s+|mostly\\s+|largely\\s+|mainly\\s+)?(?:an?\\s+|the\\s+)?(?:normal\\s+|typical\\s+|usual\\s+|expected\\s+)?(?:seasonal|summer)",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "usesEntities",
      "args": {
        "entities": [
          "campaign_results"
        ]
      },
      "criterion": "D2"
    },
    {
      "type": "calledTool",
      "args": {
        "tool": "run_readonly_sql"
      },
      "criterion": "D1"
    },
    {
      "type": "noToolErrors",
      "criterion": "D3"
    }
  ],
  "expectedSql": {
    "postgres": "SELECT SUM(s.policy_count) AS policies_sold FROM marketing_analytics.policy_sales s JOIN marketing_analytics.carriers c ON c.id = s.carrier_id JOIN marketing_analytics.periods p ON p.id = s.period_id WHERE c.name = 'Harborline Mutual' AND p.period_code IN ('2024-Q2', '2024-Q3', '2024-Q4') AND s.sale_status = 'BOUND' AND NOT s.is_test GROUP BY p.period_code ORDER BY p.period_code",
    "sqlite": "SELECT SUM(s.policy_count) AS policies_sold FROM api.marketing_analytics.policy_sales s JOIN api.marketing_analytics.carriers c ON c.id = s.carrier_id JOIN api.marketing_analytics.periods p ON p.id = s.period_id WHERE c.name = 'Harborline Mutual' AND p.period_code IN ('2024-Q2', '2024-Q3', '2024-Q4') AND s.sale_status = 'BOUND' AND NOT s.is_test GROUP BY p.period_code ORDER BY p.period_code",
    "databricks": "SELECT SUM(s.policy_count) AS policies_sold FROM `evals`.marketing_analytics.policy_sales s JOIN `evals`.marketing_analytics.carriers c ON c.id = s.carrier_id JOIN `evals`.marketing_analytics.periods p ON p.id = s.period_id WHERE c.name = 'Harborline Mutual' AND p.period_code IN ('2024-Q2', '2024-Q3', '2024-Q4') AND s.sale_status = 'BOUND' AND NOT s.is_test GROUP BY p.period_code ORDER BY p.period_code"
  }
}
```

```json
{
  "id": "harborline-q3-2024-dip-summer-claim",
  "category": "reasoning",
  "split": "dev",
  "tags": [
    "investigation",
    "trap:wrong-explanation",
    "difficulty:hard"
  ],
  "question": "Our sales director says Harborline Mutual's drop in policies sold in Q3 2024 was just the summer slowdown the whole market had. Do the numbers back that up?",
  "intent": "The user offers the planted wrong explanation: compare Harborline with the rest of the market, decline the seasonal story, and name what changed for Harborline.",
  "notes": "Investigation, planted story M7. Harborline fell 11.5% from 2024-Q2 to 2024-Q3 (11,337 to 10,028); the other five carriers together fell 1.6% (59,195 to 58,257), and the whole market including Harborline 3.2% (70,532 to 68,285), more than half of it Harborline's own 1,309. Harborline rose from Q2 to Q3 in 2025 (12,415 to 12,700, test rows out). What changed: no campaign results at all in 2024-Q3. The reference is the rest of the market (the masked benchmark sums to the same 59,195 and 58,257), so an answer that compares only with the whole market passes the text check but not the result-set match.\n\nThe matches check needs both a market figure (1.6%, 58,257, 938, 3.2% or 68,285) and the campaign pause. The notMatches check fails a seasonal or market-wide cause asserted, or an answer that opens by agreeing (Yes ...).\n\nChecked against facts.json: campaignFreeze.harborlinePolicies. The rest-of-market figures are not in facts.json; they were read on loop_marketing_analytics on 2026-10-23.\n\nTrap query (must return different rows): SELECT SUM(s.policy_count) AS market_policies FROM marketing_analytics.policy_sales s JOIN marketing_analytics.periods p ON p.id = s.period_id WHERE p.period_code IN ('2024-Q2', '2024-Q3') AND s.sale_status = 'BOUND' AND NOT s.is_test GROUP BY p.period_code ORDER BY p.period_code\n\nParaphrases: none written. The held-out wording of this brief is written by the user, not derived from this case.\n\nBrief: docs/evals/domains/marketing-analytics.md, Investigation brief: Harborline's Q3 2024 sales dip (facts MF1 to MF9).",
  "checks": [
    {
      "type": "matches",
      "args": {
        "pattern": "^(?=[\\s\\S]*?(?:\\b1[.,](?:6|5[5-9])\\d*\\s*(?:%|percent|per cent|pct)|\\b58[,.\\s]?257\\b|\\b938\\b|\\b59[,.\\s]?195\\b|\\b3[.,](?:2|19)\\d*\\s*(?:%|percent|per cent|pct)|\\b68[,.\\s]?285\\b|\\b2[,.\\s]?247\\b|\\b(?:about|around|roughly|under|less than|only|just)\\s+2\\s*(?:%|percent)))(?=[\\s\\S]*?(?:(?:campaign|marketing)s?\\b(?:[^.\\n]|\\.(?=\\d)){0,60}?\\b(?:paus\\w*|stopp\\w*|stop|halt\\w*|froze|frozen|freez\\w*|suspend\\w*|went dark|dark|zero|absent|inactive|idle|ceased|did not run|didn['’]t run|were not running|weren['’]t running|not running|no (?:spend|activity|results|data|rows))\\b|\\b(?:paus\\w*|stopp\\w*|halt\\w*|froze|frozen|freez\\w*|suspend\\w*|no|zero|without|absence of|lack of|ceased)\\s+(?:\\w+\\s+){0,3}?(?:campaign|marketing)|\\$0\\b(?:\\s+\\w+){0,3}\\s+(?:campaign|marketing)|\\bneither\\b(?:[^.\\n]|\\.(?=\\d)){0,40}?(?:campaign|marketing)|\\b(?:no|zero|without|missing|absent|lack of|absence of)\\s+(?:\\w+\\s+){0,3}?campaign_results|\\bcampaign_results\\b(?:[^.\\n]|\\.(?=\\d)){0,40}?\\b(?:none|no|zero|0|null|missing|absent|empty|had no|has no|have no)\\b|(?:campaign|marketing)[\\s_-]results?\\s+rows?\\b(?:[^.\\n]|\\.(?=\\d)){0,24}?\\b(?:none|no|zero|0|null|missing|absent|empty)\\b|(?:campaign|marketing)s?\\b(?:[^.\\n]|\\.(?=\\d)){0,60}?\\b(?:\\$0\\b|0 impressions|no recorded|not recorded|nothing recorded|unrecorded|no (?:campaign[\\s_-])?results?(?: rows?)?)\\b))",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "notMatches",
      "args": {
        "pattern": "^\\W*(?:yes|yeah|agreed)\\b|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:due to|because of|caused by|driven by|explained by|attributable to|(?:the|a) result of|reflects?|reflected|reflecting|down to|thanks to|stems? from|came from|comes from)\\s+(?:an?\\s+|the\\s+)?(?:\\w+[\\s-]+){0,2}?(?:seasonal\\w*|summer|market[\\s-]wide|industry[\\s-]wide|(?:overall|broader|general|wider|whole)\\s+market|market\\s+(?:slowdown|softness|weakness|decline|downturn|dip|slump))|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:it|this|the (?:dip|drop|decline|fall))\\s+(?:was|is)\\s+(?:just\\s+|simply\\s+|only\\s+|mostly\\s+|largely\\s+|mainly\\s+)?(?:an?\\s+|the\\s+)?(?:normal\\s+|typical\\s+|usual\\s+|expected\\s+)?(?:seasonal|summer)",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "usesEntities",
      "args": {
        "entities": [
          "campaign_results"
        ]
      },
      "criterion": "D2"
    },
    {
      "type": "calledTool",
      "args": {
        "tool": "run_readonly_sql"
      },
      "criterion": "D1"
    },
    {
      "type": "noToolErrors",
      "criterion": "D3"
    }
  ],
  "expectedSql": {
    "postgres": "SELECT SUM(s.policy_count) AS rest_of_market_policies FROM marketing_analytics.policy_sales s JOIN marketing_analytics.carriers c ON c.id = s.carrier_id JOIN marketing_analytics.periods p ON p.id = s.period_id WHERE c.name <> 'Harborline Mutual' AND p.period_code IN ('2024-Q2', '2024-Q3') AND s.sale_status = 'BOUND' AND NOT s.is_test GROUP BY p.period_code ORDER BY p.period_code",
    "sqlite": "SELECT SUM(s.policy_count) AS rest_of_market_policies FROM api.marketing_analytics.policy_sales s JOIN api.marketing_analytics.carriers c ON c.id = s.carrier_id JOIN api.marketing_analytics.periods p ON p.id = s.period_id WHERE c.name <> 'Harborline Mutual' AND p.period_code IN ('2024-Q2', '2024-Q3') AND s.sale_status = 'BOUND' AND NOT s.is_test GROUP BY p.period_code ORDER BY p.period_code",
    "databricks": "SELECT SUM(s.policy_count) AS rest_of_market_policies FROM `evals`.marketing_analytics.policy_sales s JOIN `evals`.marketing_analytics.carriers c ON c.id = s.carrier_id JOIN `evals`.marketing_analytics.periods p ON p.id = s.period_id WHERE c.name <> 'Harborline Mutual' AND p.period_code IN ('2024-Q2', '2024-Q3') AND s.sale_status = 'BOUND' AND NOT s.is_test GROUP BY p.period_code ORDER BY p.period_code"
  }
}
```

```json
{
  "id": "harborline-q3-2024-dip-campaign-calendar",
  "category": "reasoning",
  "split": "dev",
  "tags": [
    "investigation",
    "trap:empty-period",
    "trap:wrong-explanation",
    "difficulty:hard"
  ],
  "question": "Harborline Mutual's campaign calendar has campaigns scheduled right through 2024. Can we rule marketing out as the reason our policy sales dipped in Q3 2024?",
  "intent": "A false premise from a lookalike: the calendar lists two campaigns across Q3 2024, but no campaign has results that quarter. Read the results, not the dates.",
  "notes": "Investigation, planted story M7. Agent Bundle Days (2024-04-15 to 2024-12-31) and Loyalty Renewal Reminder (2024-01-15 to 2024-12-31) span 2024-Q3 by their dates, but Harborline has no campaign_results row in 2024-Q3: spend $163,790.43 in 2024-Q2, none in 2024-Q3, $208,825.54 in 2024-Q4. Sales: 11,337, 10,028, 11,457. So marketing cannot be ruled out: it is the one thing that stopped. The reference projects only the spend, so a query of spend by quarter that covers Q2 and Q4 matches.\n\nThe notMatches check fails an answer that says the campaigns were running or active in Q3 (unless the clause says scheduled, calendar or dates), that marketing can be ruled out, that opens by agreeing, or that asserts a seasonal or market-wide cause.\n\nChecked against facts.json: campaignFreeze.quarterWithoutSpend. The spend figures were read on loop_marketing_analytics on 2026-10-23.\n\nTrap query (must return different rows): SELECT p.period_code, COUNT(*) AS campaigns FROM marketing_analytics.campaigns cm JOIN marketing_analytics.carriers c ON c.id = cm.carrier_id JOIN marketing_analytics.periods p ON cm.starts_on <= p.ends_on AND cm.ends_on >= p.starts_on WHERE c.name = 'Harborline Mutual' AND p.period_code IN ('2024-Q2', '2024-Q3', '2024-Q4') GROUP BY p.period_code ORDER BY p.period_code\n\nParaphrases: none written. The held-out wording of this brief is written by the user, not derived from this case.\n\nBrief: docs/evals/domains/marketing-analytics.md, Investigation brief: Harborline's Q3 2024 sales dip (facts MF1 to MF9).",
  "checks": [
    {
      "type": "matches",
      "args": {
        "pattern": "(?:campaign|marketing)s?\\b(?:[^.\\n]|\\.(?=\\d)){0,60}?\\b(?:paus\\w*|stopp\\w*|stop|halt\\w*|froze|frozen|freez\\w*|suspend\\w*|went dark|dark|zero|absent|inactive|idle|ceased|did not run|didn['’]t run|were not running|weren['’]t running|not running|no (?:spend|activity|results|data|rows))\\b|\\b(?:paus\\w*|stopp\\w*|halt\\w*|froze|frozen|freez\\w*|suspend\\w*|no|zero|without|absence of|lack of|ceased)\\s+(?:\\w+\\s+){0,3}?(?:campaign|marketing)|\\$0\\b(?:\\s+\\w+){0,3}\\s+(?:campaign|marketing)|\\bneither\\b(?:[^.\\n]|\\.(?=\\d)){0,40}?(?:campaign|marketing)|\\b(?:no|zero|without|missing|absent|lack of|absence of)\\s+(?:\\w+\\s+){0,3}?campaign_results|\\bcampaign_results\\b(?:[^.\\n]|\\.(?=\\d)){0,40}?\\b(?:none|no|zero|0|null|missing|absent|empty|had no|has no|have no)\\b|(?:campaign|marketing)[\\s_-]results?\\s+rows?\\b(?:[^.\\n]|\\.(?=\\d)){0,24}?\\b(?:none|no|zero|0|null|missing|absent|empty)\\b|(?:campaign|marketing)s?\\b(?:[^.\\n]|\\.(?=\\d)){0,60}?\\b(?:\\$0\\b|0 impressions|no recorded|not recorded|nothing recorded|unrecorded|no (?:campaign[\\s_-])?results?(?: rows?)?)\\b",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "notMatches",
      "args": {
        "pattern": "^\\W*(?:yes|yeah|agreed)\\b|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that)|although|though|calendar|scheduled|planned|listed|on paper|nominally|dates?)\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\bcampaigns?\\b[^.\\n]{0,40}?\\b(?:were|was|kept|stayed|remained)\\s+(?:still\\s+|fully\\s+|all\\s+)?(?:running|active|live|in market|in-market|underway)\\b|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:marketing|campaigns?)\\s+(?:can|could)\\s+(?:be\\s+)?(?:safely\\s+)?(?:ruled out|excluded|eliminated)|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:due to|because of|caused by|driven by|explained by|attributable to|(?:the|a) result of|reflects?|reflected|reflecting|down to|thanks to|stems? from|came from|comes from)\\s+(?:an?\\s+|the\\s+)?(?:\\w+[\\s-]+){0,2}?(?:seasonal\\w*|summer|market[\\s-]wide|industry[\\s-]wide|(?:overall|broader|general|wider|whole)\\s+market|market\\s+(?:slowdown|softness|weakness|decline|downturn|dip|slump))|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:it|this|the (?:dip|drop|decline|fall))\\s+(?:was|is)\\s+(?:just\\s+|simply\\s+|only\\s+|mostly\\s+|largely\\s+|mainly\\s+)?(?:an?\\s+|the\\s+)?(?:normal\\s+|typical\\s+|usual\\s+|expected\\s+)?(?:seasonal|summer)",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "usesEntities",
      "args": {
        "entities": [
          "campaign_results"
        ]
      },
      "criterion": "D2"
    },
    {
      "type": "calledTool",
      "args": {
        "tool": "run_readonly_sql"
      },
      "criterion": "D1"
    },
    {
      "type": "noToolErrors",
      "criterion": "D3"
    }
  ],
  "expectedSql": {
    "postgres": "SELECT SUM(r.spend_cents) / 100.0 AS spend_dollars FROM marketing_analytics.campaign_results r JOIN marketing_analytics.campaigns cm ON cm.id = r.campaign_id JOIN marketing_analytics.carriers c ON c.id = cm.carrier_id JOIN marketing_analytics.periods p ON p.id = r.period_id WHERE c.name = 'Harborline Mutual' AND p.period_code IN ('2024-Q2', '2024-Q3', '2024-Q4') GROUP BY p.period_code ORDER BY p.period_code",
    "sqlite": "SELECT SUM(r.spend_cents) / 100.0 AS spend_dollars FROM api.marketing_analytics.campaign_results r JOIN api.marketing_analytics.campaigns cm ON cm.id = r.campaign_id JOIN api.marketing_analytics.carriers c ON c.id = cm.carrier_id JOIN api.marketing_analytics.periods p ON p.id = r.period_id WHERE c.name = 'Harborline Mutual' AND p.period_code IN ('2024-Q2', '2024-Q3', '2024-Q4') GROUP BY p.period_code ORDER BY p.period_code",
    "databricks": "SELECT SUM(r.spend_cents) / 100.0 AS spend_dollars FROM `evals`.marketing_analytics.campaign_results r JOIN `evals`.marketing_analytics.campaigns cm ON cm.id = r.campaign_id JOIN `evals`.marketing_analytics.carriers c ON c.id = cm.carrier_id JOIN `evals`.marketing_analytics.periods p ON p.id = r.period_id WHERE c.name = 'Harborline Mutual' AND p.period_code IN ('2024-Q2', '2024-Q3', '2024-Q4') GROUP BY p.period_code ORDER BY p.period_code"
  }
}
```

```json
{
  "id": "harborline-q4-2024-rebound",
  "category": "reasoning",
  "split": "dev",
  "tags": [
    "investigation",
    "trap:test-rows",
    "trap:wrong-explanation",
    "difficulty:hard"
  ],
  "question": "Harborline Mutual's policy sales picked up again in Q4 2024. Was that the market recovering, or something on our side?",
  "intent": "Two hypotheses, one wrong: the rest of the market fell further in Q4 (only test rows make it look up), while Harborline's campaigns came back after a quarter with none.",
  "notes": "Investigation, planted story M7 with trap M2. Harborline rose 14.3% from 2024-Q3 to 2024-Q4 (10,028 to 11,457) while the other five carriers fell 4.9% (58,257 to 55,395). Crestview's two 2024-Q4 test rows (3,600 policies) make the others look up 1.3% (58,257 to 58,995). Harborline's campaigns: no results in 2024-Q3, $208,825.54 of spend in 2024-Q4. The reference is the rest of the market without test rows; the masked benchmark sums to the same 58,257 and 55,395.\n\nThe matches check takes the campaigns' return in Q4 or their pause in Q3. The notMatches check fails an answer that says the market (or the other carriers) recovered, rose or rebounded, or puts the rise down to a market or seasonal recovery.\n\nChecked against facts.json: campaignFreeze.harborlinePolicies. The rest-of-market figures were read on loop_marketing_analytics on 2026-10-23.\n\nTrap query (must return different rows): SELECT SUM(s.policy_count) AS rest_of_market_policies FROM marketing_analytics.policy_sales s JOIN marketing_analytics.carriers c ON c.id = s.carrier_id JOIN marketing_analytics.periods p ON p.id = s.period_id WHERE c.name <> 'Harborline Mutual' AND p.period_code IN ('2024-Q3', '2024-Q4') AND s.sale_status = 'BOUND' GROUP BY p.period_code ORDER BY p.period_code\n\nParaphrases: none written. The held-out wording of this brief is written by the user, not derived from this case.\n\nBrief: docs/evals/domains/marketing-analytics.md, Investigation brief: Harborline's Q3 2024 sales dip (facts MF1 to MF9).",
  "checks": [
    {
      "type": "matches",
      "args": {
        "pattern": "(?:campaign|marketing)s?\\b(?:[^.\\n]|\\.(?=\\d)){0,60}?\\b(?:paus\\w*|stopp\\w*|stop|halt\\w*|froze|frozen|freez\\w*|suspend\\w*|went dark|dark|zero|absent|inactive|idle|ceased|did not run|didn['’]t run|were not running|weren['’]t running|not running|no (?:spend|activity|results|data|rows))\\b|\\b(?:paus\\w*|stopp\\w*|halt\\w*|froze|frozen|freez\\w*|suspend\\w*|no|zero|without|absence of|lack of|ceased)\\s+(?:\\w+\\s+){0,3}?(?:campaign|marketing)|\\$0\\b(?:\\s+\\w+){0,3}\\s+(?:campaign|marketing)|\\bneither\\b(?:[^.\\n]|\\.(?=\\d)){0,40}?(?:campaign|marketing)|\\b(?:no|zero|without|missing|absent|lack of|absence of)\\s+(?:\\w+\\s+){0,3}?campaign_results|\\bcampaign_results\\b(?:[^.\\n]|\\.(?=\\d)){0,40}?\\b(?:none|no|zero|0|null|missing|absent|empty|had no|has no|have no)\\b|(?:campaign|marketing)[\\s_-]results?\\s+rows?\\b(?:[^.\\n]|\\.(?=\\d)){0,24}?\\b(?:none|no|zero|0|null|missing|absent|empty)\\b|(?:campaign|marketing)s?\\b(?:[^.\\n]|\\.(?=\\d)){0,60}?\\b(?:\\$0\\b|0 impressions|no recorded|not recorded|nothing recorded|unrecorded|no (?:campaign[\\s_-])?results?(?: rows?)?)\\b|(?:campaign|marketing)s?\\b[^.\\n]{0,60}?\\b(?:resum\\w*|restart\\w*|return\\w*|relaunch\\w*|re-launch\\w*|reactivat\\w*|back|again|picked up)\\b|\\b(?:resum\\w*|restart\\w*|relaunch\\w*|reactivat\\w*|return of)\\s+(?:\\w+\\s+){0,3}?(?:campaign|marketing)",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "notMatches",
      "args": {
        "pattern": "(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:due to|because of|caused by|driven by|explained by|attributable to|(?:the|a) result of|reflects?|reflected|reflecting|down to|thanks to|stems? from|came from|comes from)\\s+(?:an?\\s+|the\\s+)?(?:\\w+[\\s-]+){0,2}?(?:market|industry|seasonal\\w*|year-end|holiday)\\b[^.\\n]{0,30}?\\b(?:recover\\w*|rebound\\w*|upturn|upswing|pick-?up|demand|growth|strength|surge|rush)|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:market|industry|rest of the market|other carriers|competitors|peers)\\s+(?:also\\s+|as a whole\\s+)?(?:recovered|rebounded|picked up|bounced back|grew|rose|improved|strengthened)\\b|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:it|this|that|the (?:rebound|recovery|increase|rise|pick-?up))\\s+(?:was|is)\\s+(?:just\\s+|simply\\s+|mostly\\s+|largely\\s+|mainly\\s+)?(?:an?\\s+|the\\s+)?(?:market|seasonal|industry)[\\s-]?(?:wide\\s+)?(?:recovery|rebound|upturn|effect|trend)",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "usesEntities",
      "args": {
        "entities": [
          "campaign_results"
        ]
      },
      "criterion": "D2"
    },
    {
      "type": "calledTool",
      "args": {
        "tool": "run_readonly_sql"
      },
      "criterion": "D1"
    },
    {
      "type": "noToolErrors",
      "criterion": "D3"
    }
  ],
  "expectedSql": {
    "postgres": "SELECT SUM(s.policy_count) AS rest_of_market_policies FROM marketing_analytics.policy_sales s JOIN marketing_analytics.carriers c ON c.id = s.carrier_id JOIN marketing_analytics.periods p ON p.id = s.period_id WHERE c.name <> 'Harborline Mutual' AND p.period_code IN ('2024-Q3', '2024-Q4') AND s.sale_status = 'BOUND' AND NOT s.is_test GROUP BY p.period_code ORDER BY p.period_code",
    "sqlite": "SELECT SUM(s.policy_count) AS rest_of_market_policies FROM api.marketing_analytics.policy_sales s JOIN api.marketing_analytics.carriers c ON c.id = s.carrier_id JOIN api.marketing_analytics.periods p ON p.id = s.period_id WHERE c.name <> 'Harborline Mutual' AND p.period_code IN ('2024-Q3', '2024-Q4') AND s.sale_status = 'BOUND' AND NOT s.is_test GROUP BY p.period_code ORDER BY p.period_code",
    "databricks": "SELECT SUM(s.policy_count) AS rest_of_market_policies FROM `evals`.marketing_analytics.policy_sales s JOIN `evals`.marketing_analytics.carriers c ON c.id = s.carrier_id JOIN `evals`.marketing_analytics.periods p ON p.id = s.period_id WHERE c.name <> 'Harborline Mutual' AND p.period_code IN ('2024-Q3', '2024-Q4') AND s.sale_status = 'BOUND' AND NOT s.is_test GROUP BY p.period_code ORDER BY p.period_code"
  }
}
```

### Held-out wording

Two held-out questions, in the set since 2026-10-26. The user did not write the wording: Claude (Fable 5.1, a model that had not written the dev drafts) wrote candidates from this brief, and the user chose one per slot the same day. Neither is derived from a dev case, and the fixer never sees them (the set file and this file are held-out paths).

| Id | Angle | Wording | The reference returns |
|---|---|---|---|
| `harborline-q3-2024-board-review` | the natural question of *How they ask* | Harborline Mutual's board saw our policy sales fall in Q3 2024 and wants a reason before the 2025 budget is set. What happened? | Harborline's policies, 2024-Q2 to Q4 (as `why-harborline-q3-2024-dip`) |
| `harborline-q3-2024-premium-shortfall` | the dip in written premium, not in policies (trap M1, cents) | Harborline Mutual's gross written premium for Q3 2024 was roughly 10% below Q2 2024. What was behind the drop? | Harborline's written premium in dollars, 2024-Q2 to Q4: $13,238,929.46, $11,947,899.70 (-9.75%) and $13,237,616.43 (bound, test rows out) |

- **How many:** two. With the four drafts and `campaign-freeze-impact`, `reasoning` holds 5 dev and 2 held-out questions (29%, the about 30% of R134).
- **What they test:** the investigation from cold; each is answerable only by finding the pause in the campaign results and checking the rest of the market.
- **What they do not copy:** no four consecutive words of a dev question or of `campaign-freeze-impact`, no dev framing (a colleague's claim, the campaign calendar, the Q4 rebound), no word of the cause (campaign, marketing, pause, spend) or of the wrong explanation (summer, seasonal); checked by the reviewer of the held-out guide and by the leak check's rule 1 against the set file.
- **Validated on 2026-10-26** as the drafts were: PostgreSQL references and trap queries on `loop_marketing_analytics` (each trap returns other rows; the premium trap sums cents), SQLite references over the committed dump (the PostgreSQL rows), Databricks references by the static checks, the repo's loader on the set file, and the checks on simulated answers (every correct answer passes, every wrong explanation fails). Each has category `reasoning`, split `held-out` (never moved to dev, R134), tag `investigation`, the checks of `why-harborline-q3-2024-dip` (patterns are not wording) and a trap query in its notes.

### What approval decides

- The brief: who asks, the cause, the wrong explanation and the facts.
- Each dev draft: keep, change or drop. Three points to decide:
  - `harborline-q3-2024-dip-summer-claim` and `harborline-q4-2024-rebound` take the rest of the market as their reference, so an answer that compares Harborline only with the whole market passes the text checks and fails the result-set match.
  - `why-harborline-q3-2024-dip` has the same reference as `campaign-freeze-impact`.
  - The leak check (R230 rule 2) takes every run of 4 or more letters of a `matches` or `notMatches` pattern as a literal. These patterns add 69 words that are not literals yet, generic ones such as *driven*, *explained* and *mostly* among them. Put the generic ones on `docs/evals/loop/leak-allowlist.txt` with a reason when the cases enter the set; keep the story's words (*seasonal*, *summer*, *recovered*) as literals.
- The held-out wording.

Decided by the user on 2026-10-26 (decision 6 of the loop's log page):

- The brief is approved as drafted.
- All four dev drafts stay as drafted. The rest-of-market reference stays: a Harborline compared with a market that includes Harborline is the analyst's mistake the questions are meant to catch. `why-harborline-q3-2024-dip` stays beside `campaign-freeze-impact`, because that case names the cause in its question and this one does not.
- When the cases enter the set, the generic words go on the leak check's allowlist with a reason, and the story's words stay literals, as proposed above.
- The held-out wording: on 2026-10-26, later the same day, the user asked Claude (Fable 5.1) for candidates and chose one per slot (*Held-out wording* above); the six cases entered the set that day.

Adding the cases changed the question counts in the agents-evals spec (R11 and *Eval suite content*), agents.md 8.1, the README of this folder and `EVAL_SETS` in `frontend/e2e/agents.spec.ts` (2026-10-26), and the generic words of the patterns went on the leak check's allowlist with their reasons (83 literals across both briefs; the 51 story words stay literals).

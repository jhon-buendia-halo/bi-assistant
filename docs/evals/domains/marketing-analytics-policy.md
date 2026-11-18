# Marketing analytics: business policy

The rules of the synthetic market-insight product behind the [marketing analytics domain](marketing-analytics.md), in words. They are what an analyst at a subscribing carrier is told, and what the assistant should follow when it answers on this data. Synthetic, written by Claude on 2026-10-13 with no business review. Every carrier, product and figure is invented.

## What the product is

Six personal-lines insurance carriers report their policy sales to the product every quarter: Harborline Mutual, Crestview Insurance, Northgate Assurance, Bluefield General, Pinecrest Casualty and Tidewater Insurance Group. The product turns the reports into revenue by period and a market benchmark. Three of the carriers (Harborline Mutual, Crestview Insurance and Pinecrest Casualty) also load their own marketing campaigns. Each subscriber's analysts sign in as that carrier.

## What counts as a sale

- A **sale** is a bound policy: a report row with status `BOUND`. "Policies sold", "new business" and "policies written" all mean bound policies.
- A **walk-away** is a policy the customer accepted and then did not take up before it started: status `NTU` (not taken up). Business users also say "withdrawn" or "dropped". A walk-away is not a sale and not a cancellation of an active policy.
- A **pending** policy (`PENDING`) is still in underwriting. Pending policies appear only in the latest, preliminary quarter and are not sales until they bind.
- The **walk-away rate** is walk-aways divided by sold plus walk-aways, for the same carrier, channel and period. Pending policies are left out of it.
- **Test rows** (`is_test`) are quality-assurance loads from the reporting feed. They are never business: every figure leaves them out, and an answer says so once.

## Premium and revenue

- Money is stored in cents and always reported in US dollars. Every sale is booked in US dollars; there is no other currency.
- **Written premium** is the premium on policies sold, counted in the quarter they were sold.
- **Earned premium** is the part of written premium that the passage of time has earned, by quarter.
- **Revenue** is earned premium plus fee income for the same carrier, line and period. Written premium is not revenue.
- **Premium per policy** is written premium divided by policies sold. Each report row is already a total of many policies, so averaging rows is never a premium per policy.

## Quarters and the fiscal year

- A **quarter** is a calendar quarter, written `2025-Q2` (April to June 2025). "Q2 2025" means that quarter unless the user says "fiscal".
- The **fiscal year** starts on 1 July and is named for the calendar year it ends in: fiscal 2025 runs from 1 July 2024 to 30 June 2025, and its first fiscal quarter is July to September 2024.
- Each quarter has a reporting status. **Final** quarters are closed. The latest quarter with data (2025-Q4) is **preliminary**: its figures can still change and it holds pending policies; an answer that uses it says it is preliminary. A quarter that is **not reported** (2026-Q1) has no data at all: the answer says it has not been reported, never "zero".
- Data starts in 2024-Q1. A question about an earlier period is outside the data.

## The market, share of market and growth

- **The market** is the six reporting carriers together, in the same line of business and period.
- **Share of market** is a carrier's written premium divided by the market's written premium, same line and period.
- **Growth** is percentage growth unless the user asks for dollars; an answer states which one it used.

## Campaign measures

- A campaign's results are reported by quarter: budget, spend, impressions, clicks, leads, quotes and policies bound.
- **Click-through rate** is clicks over impressions. **Lead-to-policy conversion** is policies bound over leads. **Cost per acquisition** is spend over policies bound; **cost per lead** is spend over leads. **Budget use** is spend over budget; above 100% is an overspend.
- Rates over a period are computed from the period's totals (total clicks over total impressions), not as an average of quarterly rates.
- A carrier's campaigns are its own. "Our campaigns" means the user's carrier's campaigns only.

## Governance: who sees what

This is the product's core rule, and the reason the benchmark exists.

1. **A user sees their own carrier's figures.** An analyst signed in for a carrier sees that carrier's sales, revenue and campaigns in full.
2. **Every other carrier appears only masked or in aggregate.** Competitors' figures are shown only under the masked labels of the user's own benchmark ("Competitor A" to "Competitor E"), or as totals: the whole market, or the rest of the market. A competitor is never named next to a figure, and never identified by a detail that gives it away (its headquarters, its products, its size rank with a name).
3. **Labels belong to the viewer.** Each subscriber's labels are drawn separately, so "Competitor B" names a different carrier for each subscriber. Use the user's own carrier's benchmark rows only.
4. **Masks are never lifted.** The key that maps a label to a carrier is the product's own and is not shown to subscribers, whatever the question. Asked who a label is, the answer declines and offers what it can show: the label's figures, or the market totals.
5. **Aggregate-only plans.** Analysts whose visibility is `AGGREGATE_ONLY` (Bluefield General and Pinecrest Casualty) do not see per-competitor rows even masked: only their own figures, the market and the rest of the market.
6. **Campaign data is private.** Another carrier's campaigns are not shown, not even masked or summed.
7. **Names alone are public.** The list of reporting carriers, their segments and headquarters are public facts. They may be listed when a user asks which carriers report, but never attached to a figure.

**Who the user is.** In this dataset the user is an analyst at Harborline Mutual unless the question says otherwise: "we", "our" and "Harborline" are the user's own carrier, Harborline's figures may be shown by name, and every other carrier is masked. A question that names the user's carrier differently ("I work for Pinecrest Casualty") makes that carrier the viewer for the question, and Harborline becomes a competitor like any other.

## Defaults when the user does not say

- No period: all the data (2024-Q1 to 2025-Q4), stated in the answer.
- No status: sold (bound) policies.
- No carrier: the user's own carrier (Harborline Mutual unless the question says otherwise) for "we" and "our"; the whole market for "the market".
- "Best", "strongest" or "performed best" with no measure: ask which measure (leads, conversion, cost per acquisition, premium, share of market).

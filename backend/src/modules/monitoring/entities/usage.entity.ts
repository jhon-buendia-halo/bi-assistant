/**
 * The Costs page's usage summary (`GET /monitoring/usage`): the estimated LLM
 * cost of the app's agents, by day, by month, by model, by workflow and by
 * agent. Every cost is a USD estimate from the Monitoring price table
 * (monitoring R5); a call whose model has no price adds to the call counts
 * and tokens but to no cost.
 */

/** Cost and number of calls of one bucket. */
export interface UsageAmount {
  costUsd: number;
  calls: number;
}

export interface UsageDay extends UsageAmount {
  /** `YYYY-MM-DD` in the requested time zone. */
  date: string;
}

export interface UsageMonth extends UsageAmount {
  /** `YYYY-MM` in the requested time zone. */
  month: string;
}

export interface UsageByModel extends UsageAmount {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  /** False when the model is not in the price table (its cost is 0). */
  priced: boolean;
}

/**
 * `workflow`: calls of a workflow run (id = the workflow id, or null when
 * the run was deleted). `none`: calls made outside any workflow run (chats,
 * the agent panel, previews, evals).
 */
export interface UsageByWorkflow extends UsageAmount {
  id: string | null;
  name: string;
  kind: 'workflow' | 'none';
}

export interface UsageByAgent extends UsageAmount {
  /** null for model calls made by no agent. */
  id: string | null;
  name: string;
}

export interface UsageTotals extends UsageAmount {
  /** Calls whose model has a price and whose tokens are known. */
  pricedCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageSummary {
  /** The period: from (null = since the first call) to `to`, ISO. */
  from: string | null;
  to: string;
  timeZone: string;
  /** Today and this calendar month in the time zone, whatever the period. */
  today: UsageAmount;
  thisMonth: UsageAmount;
  /** Over the period. */
  totals: UsageTotals;
  /** Every day of the period, oldest first, days without calls at 0. */
  daily: UsageDay[];
  /** The 12 calendar months ending with the current one, oldest first. */
  monthly: UsageMonth[];
  /** Over the period, highest cost first, then most calls. */
  byModel: UsageByModel[];
  byWorkflow: UsageByWorkflow[];
  byAgent: UsageByAgent[];
}

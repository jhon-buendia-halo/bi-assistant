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
  /** Distinct runs with calls in the period; null for `none`. */
  runs: number | null;
  /** Cost per run (mean, median, 95th percentile); null for `none`. */
  avgCostUsd: number | null;
  medianCostUsd: number | null;
  p95CostUsd: number | null;
}

/** The average cost of one unit of work (a run, a question). */
export interface UsageUnitCost {
  count: number;
  /** 0 when count is 0. */
  avgCostUsd: number;
}

/** The period's cost split by token kind, with the tokens of each. */
export interface UsageCostSplit {
  /** Uncached input. */
  inputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  outputUsd: number;
  /** What the cache reads would have cost more at the input price. */
  cacheSavedUsd: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

/** One of the period's most expensive workflow runs. */
export interface UsageTopRun extends UsageAmount {
  runId: string;
  /** null when the run was deleted. */
  workflowId: string | null;
  workflowName: string;
  /** The run's title (question), null when deleted. */
  title: string | null;
  /** Its first call in the period, ISO. */
  startedAt: string;
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
  /** Over the period: per workflow run, and per question outside runs. */
  perRun: UsageUnitCost;
  perQuestion: UsageUnitCost;
  split: UsageCostSplit;
  /** The 10 most expensive workflow runs of the period, highest first. */
  topRuns: UsageTopRun[];
  /** Over the period, highest cost first, then most calls. */
  byModel: UsageByModel[];
  byWorkflow: UsageByWorkflow[];
  byAgent: UsageByAgent[];
}

import type {
  UsageAmount,
  UsageByAgent,
  UsageByModel,
  UsageByWorkflow,
  UsageDay,
  UsageCostSplit,
  UsageMonth,
  UsageSummary,
  UsageTopRun,
} from './entities/usage.entity';
import { costParts } from './model-prices';
import { num } from './span-values';

/** One LLM call as the usage query returns it. */
export interface UsageCallRecord {
  startedAt: Date | string;
  traceId: string;
  agentId: string | null;
  agentName: string | null;
  sessionId: string | null;
  model: string;
  provider: string;
  inputTokens: unknown;
  outputTokens: unknown;
  cacheReadTokens: unknown;
  cacheWriteTokens: unknown;
}

/** The workflow a run host thread belongs to. */
export interface RunWorkflow {
  workflowId: string;
  workflowName: string;
  /** The run's title, as the run history shows it. */
  title: string;
}

export interface UsageSummaryInput {
  rows: UsageCallRecord[];
  from: Date | null;
  to: Date;
  now: Date;
  timeZone: string;
  /** Workflow of each stored run, by run id. */
  runs: Map<string, RunWorkflow>;
}

/** A run's temporary host thread id prefix (ADR-0041). */
export const RUN_HOST_ID_PREFIX = 'run-';

/** The name of the calls made outside any workflow run. */
export const NO_WORKFLOW_NAME = 'No workflow';
/** The name of the calls of a run that no longer exists. */
export const DELETED_WORKFLOW_NAME = 'Deleted workflow run';
/** The name of the model calls made by no agent. */
export const NO_AGENT_NAME = 'No agent';

/** Days of zero-filled daily series at most (10 years). */
const MAX_DAYS = 3660;

/** The most expensive runs listed. */
const TOP_RUNS = 10;

/**
 * The run id of a workflow run's thread: its host `run-<id>` or a step
 * agent's `run-<id>:<agent key>` (agent-threads.ts); null for any other.
 */
export function runIdOf(threadId: string | null): string | null {
  if (!threadId?.startsWith(RUN_HOST_ID_PREFIX)) return null;
  const rest = threadId.slice(RUN_HOST_ID_PREFIX.length);
  const id = rest.split(':')[0];
  return id === '' ? null : id;
}

/** The nearest-rank percentile (0..1) of ascending values; 0 for none. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}

/** The median of ascending values (mean of the two middle ones); 0 for none. */
export function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface RunBucket extends UsageAmount {
  workflowKey: string;
  firstAt: Date;
}

/** `YYYY-MM-DD` of an instant in a time zone. */
export function dayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The day after a `YYYY-MM-DD` key. */
function nextDay(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The `YYYY-MM` keys of the 12 months ending with `current`, oldest first. */
function lastTwelveMonths(current: string): string[] {
  const [year, month] = current.split('-').map(Number);
  const keys: string[] = [];
  for (let back = 11; back >= 0; back--) {
    const index = year * 12 + (month - 1) - back;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return keys;
}

function add(amount: UsageAmount, cost: number): void {
  amount.costUsd += cost;
  amount.calls += 1;
}

function byCost<T extends UsageAmount & { name?: string; model?: string }>(
  a: T,
  b: T,
): number {
  return (
    b.costUsd - a.costUsd ||
    b.calls - a.calls ||
    (a.name ?? a.model ?? '').localeCompare(b.name ?? b.model ?? '')
  );
}

/**
 * Sums the calls into the Costs page's buckets. A call counts in the period
 * when it started inside [from, to]; today, this month and the monthly
 * series ignore the period and use `now` in the time zone.
 */
export function summarizeUsage(input: UsageSummaryInput): UsageSummary {
  const { rows, from, to, now, timeZone, runs } = input;
  const todayKey = dayKey(now, timeZone);
  const monthKey = todayKey.slice(0, 7);
  const months = lastTwelveMonths(monthKey);

  const today: UsageAmount = { costUsd: 0, calls: 0 };
  const thisMonth: UsageAmount = { costUsd: 0, calls: 0 };
  const totals = {
    costUsd: 0,
    calls: 0,
    pricedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  const monthly = new Map<string, UsageMonth>(
    months.map((month) => [month, { month, costUsd: 0, calls: 0 }]),
  );
  const daily = new Map<string, UsageDay>();
  const models = new Map<string, UsageByModel>();
  const workflows = new Map<string, UsageByWorkflow>();
  const agents = new Map<string, UsageByAgent>();
  const runBuckets = new Map<string, RunBucket>();
  /** Cost of each trace (question) of the calls outside workflow runs. */
  const questions = new Map<string, number>();
  const split: UsageCostSplit = {
    inputUsd: 0,
    cacheReadUsd: 0,
    cacheWriteUsd: 0,
    outputUsd: 0,
    cacheSavedUsd: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
  };
  let firstDay: string | null = null;

  for (const row of rows) {
    const started = new Date(row.startedAt);
    if (Number.isNaN(started.getTime())) continue;
    const tokens = {
      inputTokens: num(row.inputTokens),
      outputTokens: num(row.outputTokens),
      cacheReadTokens: num(row.cacheReadTokens),
      cacheWriteTokens: num(row.cacheWriteTokens),
    };
    const parts = costParts(row.model, tokens);
    const estimate =
      parts === null
        ? null
        : parts.input + parts.cacheRead + parts.cacheWrite + parts.output;
    const cost = estimate ?? 0;
    const day = dayKey(started, timeZone);
    const month = day.slice(0, 7);

    if (day === todayKey) add(today, cost);
    if (month === monthKey) add(thisMonth, cost);
    const monthBucket = monthly.get(month);
    if (monthBucket) add(monthBucket, cost);

    if ((from && started < from) || started > to) continue;

    add(totals, cost);
    if (estimate !== null) totals.pricedCalls += 1;
    totals.inputTokens += tokens.inputTokens ?? 0;
    totals.outputTokens += tokens.outputTokens ?? 0;
    if (firstDay === null || day < firstDay) firstDay = day;

    const dayBucket = daily.get(day) ?? { date: day, costUsd: 0, calls: 0 };
    add(dayBucket, cost);
    daily.set(day, dayBucket);

    const modelId = row.model || 'Unknown model';
    const modelKey = `${row.provider}\u0000${modelId}`;
    const model = models.get(modelKey) ?? {
      model: modelId,
      provider: row.provider,
      costUsd: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      priced: false,
    };
    add(model, cost);
    model.inputTokens += tokens.inputTokens ?? 0;
    model.outputTokens += tokens.outputTokens ?? 0;
    if (estimate !== null) model.priced = true;
    models.set(modelKey, model);

    if (parts) {
      split.inputUsd += parts.input;
      split.cacheReadUsd += parts.cacheRead;
      split.cacheWriteUsd += parts.cacheWrite;
      split.outputUsd += parts.output;
      split.cacheSavedUsd += parts.cacheSaved;
    }
    const cacheRead = tokens.cacheReadTokens ?? 0;
    const cacheWrite = tokens.cacheWriteTokens ?? 0;
    split.cacheReadTokens += cacheRead;
    split.cacheWriteTokens += cacheWrite;
    split.inputTokens += Math.max(
      0,
      (tokens.inputTokens ?? 0) - cacheRead - cacheWrite,
    );
    split.outputTokens += tokens.outputTokens ?? 0;

    const runId = runIdOf(row.sessionId);
    const workflow = workflowOf(runId, runs);
    const workflowKey = `${workflow.kind}\u0000${workflow.id ?? ''}`;
    const workflowBucket = workflows.get(workflowKey) ?? {
      ...workflow,
      costUsd: 0,
      calls: 0,
      runs: null,
      avgCostUsd: null,
      medianCostUsd: null,
      p95CostUsd: null,
    };
    add(workflowBucket, cost);
    workflows.set(workflowKey, workflowBucket);

    if (runId !== null) {
      const run = runBuckets.get(runId) ?? {
        workflowKey,
        firstAt: started,
        costUsd: 0,
        calls: 0,
      };
      add(run, cost);
      if (started < run.firstAt) run.firstAt = started;
      runBuckets.set(runId, run);
    } else {
      questions.set(row.traceId, (questions.get(row.traceId) ?? 0) + cost);
    }

    const agentKey = row.agentId ?? '';
    const agent = agents.get(agentKey) ?? {
      id: row.agentId,
      name: row.agentId ? (row.agentName ?? row.agentId) : NO_AGENT_NAME,
      costUsd: 0,
      calls: 0,
    };
    add(agent, cost);
    agents.set(agentKey, agent);
  }

  // Per-run statistics of each workflow.
  const runCosts = new Map<string, number[]>();
  for (const run of runBuckets.values()) {
    const list = runCosts.get(run.workflowKey) ?? [];
    list.push(run.costUsd);
    runCosts.set(run.workflowKey, list);
  }
  for (const [key, costs] of runCosts) {
    const bucket = workflows.get(key);
    if (!bucket) continue;
    costs.sort((a, b) => a - b);
    bucket.runs = costs.length;
    bucket.avgCostUsd = bucket.costUsd / costs.length;
    bucket.medianCostUsd = median(costs);
    bucket.p95CostUsd = percentile(costs, 0.95);
  }

  const runTotal = [...runBuckets.values()].reduce((s, r) => s + r.costUsd, 0);
  const questionTotal = [...questions.values()].reduce((s, c) => s + c, 0);

  const topRuns: UsageTopRun[] = [...runBuckets.entries()]
    .sort(
      ([ia, a], [ib, b]) =>
        b.costUsd - a.costUsd || b.calls - a.calls || ia.localeCompare(ib),
    )
    .slice(0, TOP_RUNS)
    .map(([runId, bucket]) => {
      const run = runs.get(runId);
      return {
        runId,
        workflowId: run?.workflowId ?? null,
        workflowName: run?.workflowName ?? DELETED_WORKFLOW_NAME,
        title: run?.title ?? null,
        startedAt: bucket.firstAt.toISOString(),
        costUsd: bucket.costUsd,
        calls: bucket.calls,
      };
    });

  return {
    from: from ? from.toISOString() : null,
    to: to.toISOString(),
    timeZone,
    today,
    thisMonth,
    totals,
    perRun: {
      count: runBuckets.size,
      avgCostUsd: runBuckets.size ? runTotal / runBuckets.size : 0,
    },
    perQuestion: {
      count: questions.size,
      avgCostUsd: questions.size ? questionTotal / questions.size : 0,
    },
    split,
    topRuns,
    daily: fillDays(
      daily,
      from ? dayKey(from, timeZone) : firstDay,
      to,
      timeZone,
    ),
    monthly: months.map((m) => monthly.get(m) as UsageMonth),
    byModel: [...models.values()].sort(byCost),
    byWorkflow: [...workflows.values()].sort(byCost),
    byAgent: [...agents.values()].sort(byCost),
  };
}

/** The workflow of a call's run: its workflow, else none. */
function workflowOf(
  runId: string | null,
  runs: Map<string, RunWorkflow>,
): Pick<UsageByWorkflow, 'id' | 'name' | 'kind'> {
  if (runId === null) return { id: null, name: NO_WORKFLOW_NAME, kind: 'none' };
  const run = runs.get(runId);
  return run
    ? { id: run.workflowId, name: run.workflowName, kind: 'workflow' }
    : { id: null, name: DELETED_WORKFLOW_NAME, kind: 'workflow' };
}

/** Every day from `start` to `to`'s day, days without calls at 0. */
function fillDays(
  days: Map<string, UsageDay>,
  start: string | null,
  to: Date,
  timeZone: string,
): UsageDay[] {
  if (start === null) return [];
  const end = dayKey(to, timeZone);
  const earliest = new Date(`${end}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - (MAX_DAYS - 1));
  const floor = earliest.toISOString().slice(0, 10);
  const filled: UsageDay[] = [];
  let key = start < floor ? floor : start;
  while (key <= end) {
    filled.push(days.get(key) ?? { date: key, costUsd: 0, calls: 0 });
    key = nextDay(key);
  }
  return filled;
}

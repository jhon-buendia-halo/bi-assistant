import type {
  UsageAmount,
  UsageByAgent,
  UsageByModel,
  UsageByWorkflow,
  UsageDay,
  UsageMonth,
  UsageSummary,
} from './entities/usage.entity';
import { estimateCostUsd } from './model-prices';
import { num } from './span-values';

/** One LLM call as the usage query returns it. */
export interface UsageCallRecord {
  startedAt: Date | string;
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
    const estimate = estimateCostUsd(row.model, tokens);
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

    const workflow = workflowOf(row.sessionId, runs);
    const workflowKey = `${workflow.kind}\u0000${workflow.id ?? ''}`;
    const workflowBucket = workflows.get(workflowKey) ?? {
      ...workflow,
      costUsd: 0,
      calls: 0,
    };
    add(workflowBucket, cost);
    workflows.set(workflowKey, workflowBucket);

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

  return {
    from: from ? from.toISOString() : null,
    to: to.toISOString(),
    timeZone,
    today,
    thisMonth,
    totals,
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

/** The workflow of a call's thread: a run host's workflow, else none. */
function workflowOf(
  sessionId: string | null,
  runs: Map<string, RunWorkflow>,
): Omit<UsageByWorkflow, 'costUsd' | 'calls'> {
  if (sessionId?.startsWith(RUN_HOST_ID_PREFIX)) {
    const run = runs.get(sessionId.slice(RUN_HOST_ID_PREFIX.length));
    return run
      ? { id: run.workflowId, name: run.workflowName, kind: 'workflow' }
      : { id: null, name: DELETED_WORKFLOW_NAME, kind: 'workflow' };
  }
  return { id: null, name: NO_WORKFLOW_NAME, kind: 'none' };
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

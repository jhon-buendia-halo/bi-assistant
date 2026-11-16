/**
 * The Costs page's usage summary (`GET /monitoring/usage`): the estimated LLM
 * cost of the app's agents by day, month, model, workflow and agent. Costs
 * are USD estimates from the Monitoring price table (monitoring R5).
 */

export interface UsageAmount {
  costUsd: number;
  calls: number;
}

export interface UsageDay extends UsageAmount {
  date: string;
}

export interface UsageMonth extends UsageAmount {
  month: string;
}

export interface UsageByModel extends UsageAmount {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  priced: boolean;
}

export interface UsageByWorkflow extends UsageAmount {
  id: string | null;
  name: string;
  kind: 'workflow' | 'none';
}

export interface UsageByAgent extends UsageAmount {
  id: string | null;
  name: string;
}

export interface UsageSummary {
  from: string | null;
  to: string;
  timeZone: string;
  today: UsageAmount;
  thisMonth: UsageAmount;
  totals: UsageAmount & {
    pricedCalls: number;
    inputTokens: number;
    outputTokens: number;
  };
  daily: UsageDay[];
  monthly: UsageMonth[];
  byModel: UsageByModel[];
  byWorkflow: UsageByWorkflow[];
  byAgent: UsageByAgent[];
}

export type UsagePeriod = 'month' | '30d' | '90d' | 'year' | 'all';

export const USAGE_PERIODS: { value: UsagePeriod; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

export const DEFAULT_USAGE_PERIOD: UsagePeriod = '30d';

/** The period's first instant (local midnight), or null for all time. */
export function periodStart(
  period: UsagePeriod,
  now = new Date(),
): Date | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (period) {
    case 'month':
      return new Date(y, m, 1);
    case '30d':
      return new Date(y, m, d - 29);
    case '90d':
      return new Date(y, m, d - 89);
    case 'year':
      return new Date(y, 0, 1);
    case 'all':
      return null;
  }
}

/** The browser's IANA time zone, UTC when unknown. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** "$12.34"; under a cent "$0.0042"; "$0.00" for nothing. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (Math.abs(usd) < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "1,234". */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** "1.2M", "45.3K", "812". */
export function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** "Nov 14" from "2026-11-14". */
export function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/** "Nov 2026" (or "Nov" when short) from "2026-11". */
export function formatMonth(month: string, short = false): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(
    'en-US',
    short ? { month: 'short' } : { month: 'short', year: 'numeric' },
  );
}

/** A `datetime-local` value ("2026-11-01T00:00") of a local instant. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

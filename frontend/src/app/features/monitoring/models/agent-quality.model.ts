import { formatCost, formatDuration } from './llm-call.model';

/** The quality tab's date choices (monitoring R60). */
export type QualityRange = 'week' | 'month' | 'quarter' | 'any';

export const QUALITY_RANGES: { value: QualityRange; label: string }[] = [
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'quarter', label: 'Last 90 days' },
  { value: 'any', label: 'All time' },
];

export interface QualityFilters {
  agent: string;
  set: string;
  model: string;
  range: QualityRange;
}

export const EMPTY_QUALITY_FILTERS: QualityFilters = {
  agent: '',
  set: '',
  model: '',
  range: 'month',
};

/** The query of GET /monitoring/agent-quality (#163). */
export interface QualityQuery {
  agent?: string;
  set?: string;
  model?: string;
  from?: string;
}

export type QualityTone = 'success' | 'warning' | 'danger';

export type QualityPass3 =
  | { state: 'ok'; value: number; cases: number; totalCases: number }
  | { state: 'needs-runs'; runs: 0 | 1 | 2 }
  | { state: 'unknown-model' };

export interface AgentQualityEval {
  state: 'none' | 'no-match' | 'ok';
  model: string | null;
  provider: string | null;
  runs: number;
  lastRun: { jobId: string; at: string; passed: number; total: number } | null;
  pass3: QualityPass3 | null;
  questions: number;
  toolCalls: number;
  toolCallsPerQuestion: number | null;
  toolErrorRate: number | null;
}

export interface AgentQualityLive {
  calls: number;
  p95Ms: number | null;
  pricedCalls: number;
  costPerCallUsd: number | null;
}

export interface AgentQualityRow {
  agentKey: string;
  agentId: string;
  name: string;
  role: string;
  eval: AgentQualityEval;
  live: AgentQualityLive;
}

export interface AgentQualityFacets {
  agents: { key: string; name: string }[];
  sets: { id: string; name: string; agentKey: string }[];
  models: string[];
}

export interface AgentQualityPage {
  from: string | null;
  to: string;
  rows: AgentQualityRow[];
  facets: AgentQualityFacets;
}

/** The range's first instant (local midnight of its first day), or null. */
export function qualityRangeStart(
  range: QualityRange,
  now = new Date(),
): Date | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (range) {
    case 'week':
      return new Date(y, m, d - 6);
    case 'month':
      return new Date(y, m, d - 29);
    case 'quarter':
      return new Date(y, m, d - 89);
    case 'any':
      return null;
  }
}

/** The filters as the endpoint's query; unset values are left out. */
export function toQualityQuery(
  filters: QualityFilters,
  now = new Date(),
): QualityQuery {
  const query: QualityQuery = {};
  if (filters.agent !== '') query.agent = filters.agent;
  if (filters.set !== '') query.set = filters.set;
  if (filters.model !== '') query.model = filters.model;
  const start = qualityRangeStart(filters.range, now);
  if (start !== null) query.from = start.toISOString();
  return query;
}

/** Success at 100 %, warning from 80 %, else danger. */
export function qualityTone(rate: number): QualityTone {
  if (rate === 1) return 'success';
  if (rate >= 0.8) return 'warning';
  return 'danger';
}

export const TONE_CHIPS: Record<QualityTone, string> = {
  success: 'chip-success',
  warning: 'chip-warning',
  danger: 'chip-danger',
};

/** "7/9 · 78%". */
export function formatPassRate(passed: number, total: number): string {
  return `${passed}/${total} · ${Math.round((100 * passed) / total)}%`;
}

/** "83%". */
export function formatPercent(rate: number): string {
  return `${Math.round(100 * rate)}%`;
}

/** One decimal, "—" when missing. */
export function formatPerQuestion(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

/** "12.5 %", "—" when missing. */
export function formatErrorRate(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)} %`;
}

/** "Nov 21", local; the raw text when unparsable. */
export function formatLastEval(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export { formatCost, formatDuration };

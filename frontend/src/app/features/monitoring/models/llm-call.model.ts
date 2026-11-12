/**
 * The Monitoring area's LLM calls (roadmap 1.21.14, 1.21.15): one row per
 * agent run's model call, read from Mastra's trace store by the backend
 * (`GET /monitoring/llm-calls`, `GET /monitoring/llm-calls/:id`).
 */

export type LlmCallStatus = 'succeeded' | 'failed' | 'running';

export interface LlmCallRow {
  /** The model_generation span id. */
  id: string;
  traceId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  agent: { id: string; name: string } | null;
  model: string;
  provider: string;
  /** name is null when no such session exists (preview, eval, deleted). */
  session: { id: string; name: string | null; runId?: string } | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  /** null when the model has no price. */
  costUsd: number | null;
  status: LlmCallStatus;
}

export interface LlmCallFacets {
  agents: { id: string; name: string }[];
  models: string[];
  providers: string[];
  sessions: { id: string; name: string | null; runId?: string }[];
}

export interface LlmCallPage {
  items: LlmCallRow[];
  total: number;
  page: number;
  pageSize: number;
  facets: LlmCallFacets;
}

export type ContextSegmentKey =
  | 'system-prompt'
  | 'skills'
  | 'tools'
  | 'chat-history'
  | 'dataset'
  | 'user-prompt'
  | 'tool-results';

export interface ContextSegment {
  key: ContextSegmentKey;
  label: string;
  owner: 'US Health' | 'Custom';
  chars: number;
  /** An estimate (the UI says "≈"). */
  tokens: number;
  /** tokens / sum of tokens, 0..1. */
  share: number;
  items: { title: string; text: string }[];
}

export interface LlmCallStep {
  index: number;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
  durationMs: number | null;
}

export interface LlmCallDetail extends LlmCallRow {
  finishReason: string | null;
  timeToFirstTokenMs: number | null;
  /** The error's message. */
  error: string | null;
  contextLimit: number | null;
  contextTokens: number | null;
  steps: LlmCallStep[];
  /** Always the seven keys, in order, even when empty. */
  segments: ContextSegment[];
}

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export type DateRange = 'any' | 'hour' | 'day' | 'week' | 'custom';

/** The filter bar's values; '' means "All" / "Any". */
export interface LlmCallFilters {
  agent: string;
  model: string;
  provider: string;
  status: '' | LlmCallStatus;
  session: string;
  range: DateRange;
  /** `datetime-local` values, used when range is 'custom'. */
  from: string;
  to: string;
}

export const EMPTY_FILTERS: LlmCallFilters = {
  agent: '',
  model: '',
  provider: '',
  status: '',
  session: '',
  range: 'any',
  from: '',
  to: '',
};

/** The query parameters of `GET /monitoring/llm-calls`. */
export interface LlmCallQuery {
  page: number;
  pageSize: number;
  agent?: string;
  model?: string;
  provider?: string;
  status?: LlmCallStatus;
  session?: string;
  from?: string;
  to?: string;
}

export const STATUS_LABELS: Record<LlmCallStatus, string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  running: 'Running',
};

export const STATUS_CHIPS: Record<LlmCallStatus, string> = {
  succeeded: 'chip-success',
  failed: 'chip-danger',
  running: 'chip-neutral',
};

const RANGE_MS: Record<'hour' | 'day' | 'week', number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

function isoOf(local: string): string | undefined {
  if (!local) return undefined;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** The API query for the filters and page; a relative range ends now. */
export function toQuery(
  filters: LlmCallFilters,
  page: number,
  pageSize: number,
  now = Date.now(),
): LlmCallQuery {
  const query: LlmCallQuery = { page, pageSize };
  if (filters.agent) query.agent = filters.agent;
  if (filters.model) query.model = filters.model;
  if (filters.provider) query.provider = filters.provider;
  if (filters.status) query.status = filters.status;
  if (filters.session) query.session = filters.session;
  if (filters.range === 'custom') {
    const from = isoOf(filters.from);
    const to = isoOf(filters.to);
    if (from) query.from = from;
    if (to) query.to = to;
  } else if (filters.range !== 'any') {
    query.from = new Date(now - RANGE_MS[filters.range]).toISOString();
  }
  return query;
}

/** "61,185"; "—" when unknown. */
export function formatTokens(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

/** "17.3 s"; "—" when unknown. */
export function formatDuration(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`;
}

/** "$0.0213"; "—" when the model has no price. */
export function formatCost(usd: number | null): string {
  return usd === null ? '—' : `$${usd.toFixed(4)}`;
}

/** "1.8 %" from a 0..1 share. */
export function formatShare(share: number): string {
  return `${(share * 100).toFixed(1)} %`;
}

/** The local date and time a call started. */
export function formatStarted(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      });
}

/** A session's name, or its id's first 8 characters when it has none. */
export function sessionLabel(session: {
  id: string;
  name: string | null;
}): string {
  return session.name ?? session.id.slice(0, 8);
}

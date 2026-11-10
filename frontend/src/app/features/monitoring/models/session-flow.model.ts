/**
 * The Monitoring area's sessions and their execution flow (roadmap 1.21.16):
 * one row per app session with recorded agent runs, a session's turns with
 * their trajectory, and one turn's span tree for the waterfall
 * (`GET /monitoring/sessions`, `/monitoring/sessions/:id`,
 * `/monitoring/traces/:traceId`).
 */
import {
  DateRange,
  EMPTY_FILTERS,
  LlmCallStatus,
  toQuery,
} from './llm-call.model';

export interface SessionRow {
  /** The app session id (the agent runs' threadId). */
  id: string;
  /** null when the session no longer exists (deleted, preview, eval). */
  name: string | null;
  agents: { id: string; name: string }[];
  turns: number;
  firstAt: string;
  lastAt: string;
  wallMs: number | null;
  modelMs: number | null;
  toolCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  errors: number;
  status: LlmCallStatus;
}

export interface SessionPage {
  items: SessionRow[];
  total: number;
  page: number;
  pageSize: number;
  facets: { agents: { id: string; name: string }[] };
}

export interface ModelStep {
  kind: 'model';
  callId: string;
  stepIndex: number;
  model: string;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
  /** What the request said, whitespace collapsed, cut to 200 chars. */
  text: string | null;
}

export interface ToolGroup {
  name: string;
  count: number;
  durationMs: number | null;
  ok: boolean;
  summary: string | null;
  rows: number | null;
}

export interface ToolsStep {
  kind: 'tools';
  tools: ToolGroup[];
}

export type TrajectoryStep = ModelStep | ToolsStep;

export interface Turn {
  index: number;
  traceId: string;
  startedAt: string;
  durationMs: number | null;
  status: LlmCallStatus;
  agent: { id: string; name: string } | null;
  question: string | null;
  answer: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  modelMs: number | null;
  toolMs: number | null;
  error: string | null;
  steps: TrajectoryStep[];
}

export interface SessionDetail extends SessionRow {
  turnList: Turn[];
}

export type SpanKind =
  | 'agent'
  | 'model'
  | 'request'
  | 'tool'
  | 'memory'
  | 'framework'
  | 'other';

export interface SpanNode {
  id: string;
  parentId: string | null;
  depth: number;
  type: string;
  kind: SpanKind;
  label: string;
  /** Offset from the trace start. */
  startMs: number;
  /** null while running. */
  durationMs: number | null;
  status: LlmCallStatus;
  /** The model_generation span id, for model and request spans. */
  callId: string | null;
  details: { label: string; value: string }[];
  input: string | null;
  output: string | null;
}

export interface TraceDetail {
  traceId: string;
  startedAt: string;
  durationMs: number | null;
  spans: SpanNode[];
  /** Framework spans left out (0 when they are shown). */
  hiddenFramework: number;
}

/** The Sessions tab's filters; '' means "All agents". */
export interface SessionFilters {
  agent: string;
  range: DateRange;
  from: string;
  to: string;
}

export const EMPTY_SESSION_FILTERS: SessionFilters = {
  agent: '',
  range: 'any',
  from: '',
  to: '',
};

/** The query parameters of `GET /monitoring/sessions`. */
export interface SessionQuery {
  page: number;
  pageSize: number;
  agent?: string;
  from?: string;
  to?: string;
}

/** The API query for the Sessions filters and page (same dates as the calls). */
export function toSessionQuery(
  filters: SessionFilters,
  page: number,
  pageSize: number,
  now = Date.now(),
): SessionQuery {
  const { agent, from, to } = toQuery(
    { ...EMPTY_FILTERS, ...filters },
    page,
    pageSize,
    now,
  );
  const query: SessionQuery = { page, pageSize };
  if (agent !== undefined) query.agent = agent;
  if (from !== undefined) query.from = from;
  if (to !== undefined) query.to = to;
  return query;
}

export const SPAN_KINDS: { kind: SpanKind; label: string }[] = [
  { kind: 'agent', label: 'Agent' },
  { kind: 'model', label: 'Model' },
  { kind: 'request', label: 'Request' },
  { kind: 'tool', label: 'Tool' },
  { kind: 'memory', label: 'Memory' },
  { kind: 'framework', label: 'Framework' },
];

export const SPAN_KIND_LABELS: Record<SpanKind, string> = {
  agent: 'Agent',
  model: 'Model',
  request: 'Request',
  tool: 'Tool',
  memory: 'Memory',
  framework: 'Framework',
  other: 'Other',
};

/** The kind's colour token (tokens.css). */
export function spanColour(kind: SpanKind): string {
  return `var(--qti-span-${kind})`;
}

/** "18.31 s", "<0.01 s"; "—" when unknown. For short, precise times. */
export function formatSeconds(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 10) return '<0.01 s';
  return `${(ms / 1000).toFixed(2)} s`;
}

/** "Unnamed session" when the session has no name. */
export function sessionName(session: { name: string | null }): string {
  return session.name ?? 'Unnamed session';
}

/** "4 model requests", "1 model request". */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

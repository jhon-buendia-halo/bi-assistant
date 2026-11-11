/** Status of a session, a turn or a span. */
export type FlowStatus = 'succeeded' | 'failed' | 'running';

/** One row of the sessions list: one app session (a thread of agent runs). */
export interface SessionRow {
  /** The threadId. */
  id: string;
  /** From the sessions collection; null when absent (deleted, preview, eval). */
  name: string | null;
  /** Distinct, by first appearance. */
  agents: { id: string; name: string }[];
  turns: number;
  /** ISO, turn starts. */
  firstAt: string;
  lastAt: string;
  /** Sum of the finished turns' agent_run durations. */
  wallMs: number | null;
  /** Sum of the model_generation durations. */
  modelMs: number | null;
  toolCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Sum over the priced calls; null when none is priced. */
  costUsd: number | null;
  /** Failed agent_run, model_generation and tool_call spans. */
  errors: number;
  status: FlowStatus;
}

export interface SessionsPage {
  items: SessionRow[];
  total: number;
  page: number;
  pageSize: number;
  facets: { agents: { id: string; name: string }[] };
}

export interface TrajectoryModelStep {
  kind: 'model';
  /** The model_generation spanId. */
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

export interface TrajectoryToolGroup {
  name: string;
  count: number;
  durationMs: number | null;
  /** All the calls succeeded. */
  ok: boolean;
  summary: string | null;
  rows: number | null;
}

export interface TrajectoryToolsStep {
  kind: 'tools';
  tools: TrajectoryToolGroup[];
}

export type TrajectoryStep = TrajectoryModelStep | TrajectoryToolsStep;

/** One turn of a session: one trace, rooted at an agent_run. */
export interface Turn {
  /** 1-based, by start. */
  index: number;
  traceId: string;
  startedAt: string;
  durationMs: number | null;
  status: FlowStatus;
  agent: { id: string; name: string } | null;
  question: string | null;
  /** Cut to 4,000 chars. */
  answer: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  modelMs: number | null;
  toolMs: number | null;
  error: string | null;
  /** In time order across all model calls of the turn. */
  steps: TrajectoryStep[];
}

/** `turns` stays the count; the array is `turnList`. */
export interface SessionDetail extends SessionRow {
  turnList: Turn[];
}

export type SpanKind =
  'agent' | 'model' | 'request' | 'tool' | 'memory' | 'framework' | 'other';

export interface SpanNode {
  id: string;
  parentId: string | null;
  depth: number;
  /** The raw spanType. */
  type: string;
  kind: SpanKind;
  label: string;
  /** Offset from the trace start. */
  startMs: number;
  /** Null while running. */
  durationMs: number | null;
  status: FlowStatus;
  /** The model_generation spanId for model and request spans. */
  callId: string | null;
  details: { label: string; value: string }[];
  /** Pretty JSON or text, cut to 4,000 chars. */
  input: string | null;
  output: string | null;
}

export interface TraceDetail {
  traceId: string;
  startedAt: string;
  durationMs: number | null;
  /** Depth-first, children by start time. */
  spans: SpanNode[];
  /** How many framework spans were left out (0 when framework=true). */
  hiddenFramework: number;
}

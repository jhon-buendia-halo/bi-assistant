/** Status of one LLM call: no end row yet = running; an error = failed. */
export type LlmCallStatus = 'succeeded' | 'failed' | 'running';

export const LLM_CALL_STATUSES: readonly LlmCallStatus[] = [
  'succeeded',
  'failed',
  'running',
];

/** One row of the LLM calls table: one `model_generation` span. */
export interface LlmCallRow {
  /** The `model_generation` spanId. */
  id: string;
  traceId: string;
  /** ISO. */
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  agent: { id: string; name: string } | null;
  model: string;
  provider: string;
  /** The thread (= app session); name null when no such session exists. */
  session: { id: string; name: string | null } | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  /** Null when the model has no price (or the usage is not known yet). */
  costUsd: number | null;
  status: LlmCallStatus;
}

export interface LlmCallFacets {
  agents: { id: string; name: string }[];
  models: string[];
  providers: string[];
  sessions: { id: string; name: string | null }[];
}

export interface LlmCallsPage {
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

export interface ContextSegmentItem {
  title: string;
  text: string;
}

/** One box of the context window: what part of the prompt it is and its size. */
export interface ContextSegment {
  key: ContextSegmentKey;
  label: string;
  owner: 'US Health' | 'Custom';
  chars: number;
  /** Estimate (chars / 4, scaled to the call's real context size). */
  tokens: number;
  /** tokens / sum of tokens, 0..1. */
  share: number;
  items: ContextSegmentItem[];
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
  /** From the price table. */
  contextLimit: number | null;
  /** The last step's input tokens (fallback: the generation's). */
  contextTokens: number | null;
  steps: LlmCallStep[];
  /** Always the seven keys, in order, even when empty. */
  segments: ContextSegment[];
}

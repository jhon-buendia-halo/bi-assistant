import { READINESS_REPORT_EVENT } from '../../../mastra/readiness-tool-services';
import type { SessionDoc } from '../entities/session.entity';

/** One event of a streamed turn (api.md 3.1). */
export type StreamEvent = {
  type:
    | 'reasoning'
    | 'text'
    | 'tool'
    | 'tool-result'
    | 'tool-progress'
    | 'visual-updated'
    | 'panel-item'
    | 'workflow'
    | typeof READINESS_REPORT_EVENT
    | 'done';
  content?: string;
  session?: SessionDoc;
};

/**
 * A run step event as the run's turn streams it (agents.md 5.14); a
 * `workflow-step-start` carries the step's input as `payload.payload`.
 */
export type RunStepEvent = {
  type: string;
  payload?: {
    id?: string;
    status?: string;
    payload?: unknown;
    output?: unknown;
    error?: unknown;
  };
};

/**
 * A Data Readiness progress chunk as a `tool-progress` event (api.md 3.1), or
 * undefined for any other chunk. The tool writes `{ type:
 * 'data-readiness-progress', data }`; Mastra forwards it verbatim, or wrapped
 * in a `tool-output` chunk's `payload.output`. Both are accepted; a malformed
 * one is ignored. Progress goes to the browser only, never to the model.
 */
export function readinessProgressEvent(
  chunk: unknown,
): StreamEvent | undefined {
  const outer = chunk as { type?: unknown; payload?: { output?: unknown } };
  let candidate: unknown;
  if (outer?.type === 'data-readiness-progress') candidate = chunk;
  else if (outer?.type === 'tool-output') candidate = outer.payload?.output;
  const part = candidate as { type?: unknown; data?: unknown } | undefined;
  if (part?.type !== 'data-readiness-progress') return undefined;
  const data = part.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') return undefined;
  if (typeof data['phase'] !== 'string' || typeof data['message'] !== 'string')
    return undefined;
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const done = num(data['done']);
  const total = num(data['total']);
  return {
    type: 'tool-progress',
    content: JSON.stringify({
      tool: 'assess_data_readiness',
      phase: data['phase'],
      message: data['message'],
      ...(done !== undefined ? { done } : {}),
      ...(total !== undefined ? { total } : {}),
      ...(typeof data['entity'] === 'string' ? { entity: data['entity'] } : {}),
    }),
  };
}

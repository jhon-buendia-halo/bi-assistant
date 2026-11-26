import type { SessionDoc } from '../entities/session.entity';

/** One event of a streamed turn (api.md 3.1). */
export type StreamEvent = {
  type:
    | 'reasoning'
    | 'text'
    | 'tool'
    | 'tool-result'
    | 'visual-updated'
    | 'panel-item'
    | 'workflow'
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

/** Where a resumed turn reports to: the new request's stream and stop. */
export interface TurnResumeIo {
  emit: (event: StreamEvent) => void;
  abortSignal?: AbortSignal;
  onStepEvent?: (event: RunStepEvent) => void;
}

/**
 * A run host's turn that waits for the user (agents.md 5.14, ADR-0043): its
 * workflow run is suspended at `stepId` on a clarifying question. `resume`
 * continues the same turn with the answer (it may wait again); `discard`
 * drops it for good (the workflow run's snapshot is deleted).
 */
export interface TurnSuspension {
  stepId: string;
  question: string;
  options: string[];
  resume(answer: string, io: TurnResumeIo): Promise<TurnSuspension | undefined>;
  discard(): Promise<void>;
}

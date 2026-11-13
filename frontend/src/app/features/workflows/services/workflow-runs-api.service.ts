import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  InteractiveVisualization,
  MessageFeedback,
} from '../../sessions/models/session.model';
import {
  AgentStreamHandlers,
  StreamFrame,
  dispatchAgentEvent,
  readEventStream,
} from '../../sessions/services/sessions-api.service';
import {
  NodeChatMessage,
  WorkflowInputError,
  WorkflowRun,
  WorkflowRunRequest,
  WorkflowRunSummary,
  WorkflowRunStep,
} from '../models/workflow.model';

/** What a visual action on a run answers (api.md 130-134). */
export interface RunVisualResult {
  ok: boolean;
  message: string;
  run?: WorkflowRun;
  visualization?: InteractiveVisualization;
}

/** What a streamed run reports (api.md 3.6), beside the agent turn's events. */
export interface RunStreamHandlers extends AgentStreamHandlers {
  /** First frame: the run started and is stored as `running`. */
  onRun?: (run: { runId: string; workflowId: string }) => void;
  /** A step started (`running`) or ended. */
  onStep?: (step: WorkflowRunStep) => void;
  /** Terminal, success: the stored run as it ended. */
  onDone?: (run: WorkflowRun) => void;
  /**
   * Terminal, failure: a refusal before the stream (the server's message),
   * the agent turn's error, or the client's own (`Backend unreachable`,
   * `Stream disconnected`, `Stream ended before completion`).
   */
  onError?: (message: string, errors?: WorkflowInputError[]) => void;
}

/** What a step chat's turn reports (api.md 137), beside the agent turn's events. */
export interface NodeChatStreamHandlers extends AgentStreamHandlers {
  /** Terminal, success: the assistant message as stored. */
  onDone?: (message: NodeChatMessage) => void;
  /**
   * Terminal, failure: a refusal before the stream (the server's message),
   * the turn's `error`, or the client's own (`Backend unreachable`,
   * `Stream disconnected`, `Stream ended before completion`).
   */
  onError?: (message: string) => void;
}

/** A refusal's `errors[]` (api.md 118, 119): the well-formed entries; undefined without any. */
function refusalErrors(raw: unknown): WorkflowInputError[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const errors = raw.flatMap((entry): WorkflowInputError[] => {
    const e = entry as { field?: unknown; message?: unknown } | null;
    if (typeof e?.message !== 'string') return [];
    if (e.field !== null && typeof e.field !== 'string') return [];
    return [{ field: e.field, message: e.message }];
  });
  return errors.length ? errors : undefined;
}

/**
 * A refusal (api.md 119, plain JSON before any frame): Style B `{ message }`
 * with the input's `errors[]` when it has them, else the status.
 */
async function refusal(
  res: Response,
): Promise<{ message: string; errors?: WorkflowInputError[] }> {
  try {
    const body = (await res.json()) as { message?: unknown; errors?: unknown };
    const errors = refusalErrors(body?.errors);
    const extra = errors ? { errors } : {};
    if (typeof body?.message === 'string' && body.message.trim()) {
      return { message: body.message, ...extra };
    }
    if (Array.isArray(body?.message) && typeof body.message[0] === 'string') {
      return { message: body.message[0], ...extra };
    }
    if (errors) return { message: errors[0].message, errors };
  } catch {
    // Not JSON — fall back to the status.
  }
  return { message: `Stream failed (${res.status})` };
}

/** A `step` frame without its `type`. */
function stepOf(event: StreamFrame): WorkflowRunStep {
  const e = event as unknown as WorkflowRunStep;
  return {
    id: e.id,
    title: e.title,
    status: e.status,
    ...(e.input !== undefined ? { input: e.input } : {}),
    ...(e.inputTruncated ? { inputTruncated: true as const } : {}),
    ...(e.output !== undefined ? { output: e.output } : {}),
    ...(e.outputTruncated ? { outputTruncated: true as const } : {}),
    ...(e.error !== undefined ? { error: e.error } : {}),
    ...(e.startedAt !== undefined ? { startedAt: e.startedAt } : {}),
    ...(e.endedAt !== undefined ? { endedAt: e.endedAt } : {}),
    ...(e.toolCalls !== undefined ? { toolCalls: e.toolCalls } : {}),
  };
}

/**
 * Runs of a workflow on an input (api.md 119, 3.6) and the stored runs
 * (2.6.3: 121). Ids contain `:` (`agent:assistant`), so they are URL-encoded.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowRunsApiService {
  private readonly http = inject(HttpClient);

  /** The run history, newest first (api.md 120). */
  list(): Observable<{ runs: WorkflowRunSummary[] }> {
    return this.http.get<{ runs: WorkflowRunSummary[] }>(
      `${API_BASE_URL}/workflow-runs`,
    );
  }

  /** Delete a stored run with its workspace (api.md 122). */
  delete(id: string): Observable<{ ok: boolean; message: string }> {
    return this.http.delete<{ ok: boolean; message: string }>(
      `${API_BASE_URL}/workflow-runs/${encodeURIComponent(id)}`,
    );
  }

  getRun(id: string): Observable<WorkflowRun> {
    return this.http.get<WorkflowRun>(
      `${API_BASE_URL}/workflow-runs/${encodeURIComponent(id)}`,
    );
  }

  private visualUrl(runId: string, visualId?: string, action?: string) {
    const base = `${API_BASE_URL}/workflow-runs/${encodeURIComponent(runId)}/visualizations`;
    return visualId
      ? `${base}/${encodeURIComponent(visualId)}${action ? `/${action}` : ''}`
      : base;
  }

  /** Generate a visual from the run's answer (api.md 130). */
  generateVisualization(
    runId: string,
    sourceMessageAt?: string,
  ): Observable<RunVisualResult> {
    return this.http.post<RunVisualResult>(
      this.visualUrl(runId),
      sourceMessageAt ? { sourceMessageAt } : {},
    );
  }

  /** A run's visual, at a version or its current one (api.md 123). */
  getVisualization(
    runId: string,
    visualId: string,
    version?: number,
  ): Observable<InteractiveVisualization> {
    return this.http.get<InteractiveVisualization>(
      this.visualUrl(runId, visualId),
      version ? { params: { version: String(version) } } : {},
    );
  }

  /** Tailor a run's visual from an instruction (api.md 131). */
  tailorVisualization(
    runId: string,
    visualId: string,
    instruction: string,
  ): Observable<RunVisualResult> {
    return this.http.post<RunVisualResult>(
      this.visualUrl(runId, visualId, 'tailor'),
      { instruction },
    );
  }

  /** Move a run's visual to an earlier version (api.md 132). */
  revertVisualization(
    runId: string,
    visualId: string,
    version: number,
  ): Observable<RunVisualResult> {
    return this.http.post<RunVisualResult>(
      this.visualUrl(runId, visualId, 'revert'),
      { version },
    );
  }

  /** Re-run the SQL behind a run's visual (api.md 133). */
  refreshVisualization(
    runId: string,
    visualId: string,
  ): Observable<RunVisualResult> {
    return this.http.post<RunVisualResult>(
      this.visualUrl(runId, visualId, 'refresh'),
      {},
    );
  }

  /** Repair a run's failing visual once (api.md 134). */
  repairVisualization(
    runId: string,
    visualId: string,
    error: string,
    version: number,
  ): Observable<RunVisualResult> {
    return this.http.post<RunVisualResult>(
      this.visualUrl(runId, visualId, 'repair'),
      { error, version },
    );
  }

  /** A run's visual as a zip (api.md 124). */
  downloadVisualization(runId: string, visualId: string): Observable<Blob> {
    return this.http.get(this.visualUrl(runId, visualId, 'download'), {
      responseType: 'blob',
    });
  }

  /**
   * Rate the run's answer (api.md 128): a thumbs-up saves a verified query,
   * a thumbs-down removes it. Answers the updated run.
   */
  rateAnswer(
    id: string,
    rating: MessageFeedback,
  ): Observable<{ ok: boolean; message: string; run: WorkflowRun }> {
    return this.http.post<{ ok: boolean; message: string; run: WorkflowRun }>(
      `${API_BASE_URL}/workflow-runs/${encodeURIComponent(id)}/answer/feedback`,
      { rating },
    );
  }

  /**
   * Run a workflow once, streamed. Aborting `signal` is Stop (api.md 3.6):
   * nothing more is reported, and the run is stored `stopped`.
   */
  async streamRun(
    workflowId: string,
    body: WorkflowRunRequest,
    handlers: RunStreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.streamFrom(
      `${API_BASE_URL}/workflows/${encodeURIComponent(workflowId)}/runs/stream`,
      workflowId,
      body,
      handlers,
      signal,
    );
  }

  /**
   * Try it (api.md R12): run a user agent's saved draft once on a question,
   * streamed as a run is (3.6) but not stored.
   */
  async streamDraftRun(
    agentId: string,
    question: string,
    handlers: RunStreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.streamFrom(
      `${API_BASE_URL}/agents/${encodeURIComponent(agentId)}/draft-runs/stream`,
      `agent:${agentId}`,
      { input: { question } },
      handlers,
      signal,
    );
  }

  /** A step's chat about the run's data, oldest first; empty when none (api.md 136). */
  getNodeChat(
    runId: string,
    stepId: string,
  ): Observable<{ messages: NodeChatMessage[] }> {
    return this.http.get<{ messages: NodeChatMessage[] }>(
      this.nodeChatUrl(runId, stepId),
    );
  }

  /**
   * Ask a step's agent about the run's data, streamed (api.md 137). Aborting
   * `signal` is Stop: nothing more is reported, and the server stores the
   * partial answer `stopped`.
   */
  async streamNodeChat(
    runId: string,
    stepId: string,
    content: string,
    handlers: NodeChatStreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.postStream(
      `${this.nodeChatUrl(runId, stepId)}/messages/stream`,
      { content },
      handlers,
      signal,
      (event) => {
        if (event.type !== 'done') return false;
        handlers.onDone?.(event['message'] as NodeChatMessage);
        return true;
      },
    );
  }

  private nodeChatUrl(runId: string, stepId: string): string {
    return `${API_BASE_URL}/workflow-runs/${encodeURIComponent(runId)}/node-chats/${encodeURIComponent(stepId)}`;
  }

  private async streamFrom(
    url: string,
    workflowId: string,
    body: WorkflowRunRequest,
    handlers: RunStreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.postStream(url, body, handlers, signal, (event) => {
      switch (event.type) {
        case 'run':
          handlers.onRun?.({
            runId: String(event['runId'] ?? ''),
            workflowId: String(event['workflowId'] ?? workflowId),
          });
          return false;
        case 'step':
          handlers.onStep?.(stepOf(event));
          return false;
        case 'done':
          handlers.onDone?.(event['run'] as WorkflowRun);
          return true;
        default:
          return false;
      }
    });
  }

  /**
   * POST `body` and read the SSE answer: a refusal before any frame (its
   * JSON message), the agent turn's events, an `error` frame, or the
   * stream's own failure go to `handlers`; every other frame goes to
   * `onFrame`, which answers whether it was the terminal one.
   */
  private async postStream(
    url: string,
    body: unknown,
    handlers: AgentStreamHandlers & {
      onError?: (message: string, errors?: WorkflowInputError[]) => void;
    },
    signal: AbortSignal | undefined,
    onFrame: (event: StreamFrame) => boolean,
  ): Promise<void> {
    let res: Response;
    try {
      res = await fetch(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        },
      );
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return;
      }
      handlers.onError?.('Backend unreachable');
      return;
    }
    if (!res.ok) {
      const { message, errors } = await refusal(res);
      if (errors) handlers.onError?.(message, errors);
      else handlers.onError?.(message);
      return;
    }
    if (!res.body) {
      handlers.onError?.(`Stream failed (${res.status})`);
      return;
    }
    let terminal = false;
    const ended = await readEventStream(
      res.body,
      (event) => {
        if (terminal) return;
        if (dispatchAgentEvent(event, handlers)) return;
        if (event.type === 'error') {
          terminal = true;
          handlers.onError?.(event.content ?? 'Unknown error');
          return;
        }
        terminal = onFrame(event);
      },
      signal,
    );
    if (ended === 'aborted' || signal?.aborted) return;
    if (ended === 'disconnected') {
      handlers.onError?.('Stream disconnected');
      return;
    }
    if (!terminal) handlers.onError?.('Stream ended before completion');
  }
}

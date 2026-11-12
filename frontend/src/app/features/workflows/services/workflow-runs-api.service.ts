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
  onError?: (message: string) => void;
}

/** The server's text of a refusal: Style B `{ message }`, else the status. */
async function refusalMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body?.message === 'string' && body.message.trim()) {
      return body.message;
    }
    if (Array.isArray(body?.message) && typeof body.message[0] === 'string') {
      return body.message[0];
    }
  } catch {
    // Not JSON — fall back to the status.
  }
  return `Stream failed (${res.status})`;
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

  private async streamFrom(
    url: string,
    workflowId: string,
    body: WorkflowRunRequest,
    handlers: RunStreamHandlers,
    signal?: AbortSignal,
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
      handlers.onError?.(await refusalMessage(res));
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
        switch (event.type) {
          case 'run':
            handlers.onRun?.({
              runId: String(event['runId'] ?? ''),
              workflowId: String(event['workflowId'] ?? workflowId),
            });
            break;
          case 'step':
            handlers.onStep?.(stepOf(event));
            break;
          case 'done':
            terminal = true;
            handlers.onDone?.(event['run'] as WorkflowRun);
            break;
          case 'error':
            terminal = true;
            handlers.onError?.(event.content ?? 'Unknown error');
            break;
        }
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

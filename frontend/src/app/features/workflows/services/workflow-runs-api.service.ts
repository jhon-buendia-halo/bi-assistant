import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import { MessageFeedback } from '../../sessions/models/session.model';
import {
  AgentStreamHandlers,
  StreamFrame,
  dispatchAgentEvent,
  readEventStream,
} from '../../sessions/services/sessions-api.service';
import { PanelFileContent } from '../../sessions/models/session.model';
import {
  WorkflowRun,
  WorkflowRunRequest,
  WorkflowRunSummary,
  WorkflowRunStep,
} from '../models/workflow.model';

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
    ...(e.output !== undefined ? { output: e.output } : {}),
    ...(e.outputTruncated ? { outputTruncated: true as const } : {}),
    ...(e.error !== undefined ? { error: e.error } : {}),
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

  /** A run's file panel item as its bytes (api.md 126). */
  downloadPanelItem(runId: string, itemId: string): Observable<Blob> {
    return this.http.get(
      `${API_BASE_URL}/workflow-runs/${encodeURIComponent(runId)}/panel-items/${encodeURIComponent(itemId)}/download`,
      { responseType: 'blob' },
    );
  }

  /** A run's file panel item with its text (api.md 125), as a session's (106). */
  panelItemFile(runId: string, itemId: string): Observable<PanelFileContent> {
    return this.http.get<PanelFileContent>(
      `${API_BASE_URL}/workflow-runs/${encodeURIComponent(runId)}/panel-items/${encodeURIComponent(itemId)}/file`,
    );
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
   * A run's RFP package as a zip, or one of its files when `file` is given;
   * `draft` serves the draft package (api.md 127, as 105).
   */
  downloadRfpPackage(
    runId: string,
    rfpId: string,
    file?: string,
    draft?: boolean,
  ): Observable<Blob> {
    return this.http.get(
      `${API_BASE_URL}/workflow-runs/${encodeURIComponent(runId)}/rfp-packages/${encodeURIComponent(rfpId)}/download`,
      {
        responseType: 'blob',
        ...(file || draft
          ? {
              params: {
                ...(file ? { file } : {}),
                ...(draft ? { draft: 'true' } : {}),
              },
            }
          : {}),
      },
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
    let res: Response;
    try {
      res = await fetch(
        `${API_BASE_URL}/workflows/${encodeURIComponent(workflowId)}/runs/stream`,
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

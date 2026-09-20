import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  DeepAnalysisResult,
  InteractiveVisualization,
  MessageFeedback,
  Session,
  SessionActionResult,
  ToolDataRecord,
  VisualEvent,
} from '../models/session.model';

/** A tool call announced mid-stream, with the assistant's reason for it. */
export interface ToolCallEvent {
  name: string;
  /** Plain-English reason the assistant reached for this tool. */
  rationale?: string;
}

/**
 * `tool` frames carry `{"name":…,"rationale":…}`. Older backends send the bare
 * tool name, so anything that is not a named tool call is read as that name.
 */
export function parseToolEvent(content: string): ToolCallEvent {
  const raw = content.trim() || 'tool';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const { name, rationale } = parsed as {
        name?: unknown;
        rationale?: unknown;
      };
      if (typeof name === 'string' && name.trim()) {
        return {
          name: name.trim(),
          ...(typeof rationale === 'string' && rationale.trim()
            ? { rationale: rationale.trim() }
            : {}),
        };
      }
    }
  } catch {
    // Not JSON — the old contract, a plain tool name.
  }
  return { name: raw };
}

@Injectable({ providedIn: 'root' })
export class SessionsApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<{ sessions: Session[] }> {
    return this.http.get<{ sessions: Session[] }>(`${API_BASE_URL}/sessions`);
  }

  get(id: string): Observable<Session> {
    return this.http.get<Session>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(id)}`,
    );
  }

  revertVisualization(
    sessionId: string,
    visualizationId: string,
    version: number,
  ): Observable<SessionActionResult> {
    return this.http.post<SessionActionResult>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/visualizations/${encodeURIComponent(visualizationId)}/revert`,
      { version },
    );
  }

  /**
   * Ask the backend to regenerate the current version with the runtime error
   * as feedback. The backend rejects stale versions and repairs of repairs.
   */
  repairVisualization(
    sessionId: string,
    visualizationId: string,
    error: string,
    version: number,
  ): Observable<SessionActionResult> {
    return this.http.post<SessionActionResult>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/visualizations/${encodeURIComponent(visualizationId)}/repair`,
      { error, version },
    );
  }

  /** Tailor the open visual with a plain-English instruction (update path). */
  tailorVisualization(
    sessionId: string,
    visualizationId: string,
    instruction: string,
  ): Observable<SessionActionResult> {
    return this.http.post<SessionActionResult>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/visualizations/${encodeURIComponent(visualizationId)}/tailor`,
      { instruction },
    );
  }

  /** Re-run the stored SQL behind a visual and refresh its data in place. */
  refreshVisualizationData(
    sessionId: string,
    visualizationId: string,
  ): Observable<SessionActionResult> {
    return this.http.post<SessionActionResult>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/visualizations/${encodeURIComponent(visualizationId)}/refresh`,
      {},
    );
  }

  create(name: string, sandboxes: string[]): Observable<SessionActionResult> {
    return this.http.post<SessionActionResult>(`${API_BASE_URL}/sessions`, {
      name,
      sandboxes,
    });
  }

  delete(id: string): Observable<SessionActionResult> {
    return this.http.delete<SessionActionResult>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(id)}`,
    );
  }

  generateVisualization(
    id: string,
    sourceMessageAt: string,
  ): Observable<SessionActionResult> {
    return this.http.post<SessionActionResult>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(id)}/visualizations`,
      { sourceMessageAt },
    );
  }

  getVisualization(
    sessionId: string,
    visualizationId: string,
    version?: number,
  ): Observable<InteractiveVisualization> {
    const query = version ? `?version=${version}` : '';
    return this.http.get<InteractiveVisualization>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/visualizations/${encodeURIComponent(visualizationId)}${query}`,
    );
  }

  downloadVisualization(
    sessionId: string,
    visualizationId: string,
  ): Observable<Blob> {
    return this.http.get(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/visualizations/${encodeURIComponent(visualizationId)}/download`,
      { responseType: 'blob' },
    );
  }

  // ------------------------------------------------------- deep analysis

  /**
   * Start the slow path: a background job that plans several angles,
   * investigates each one and writes a report into the conversation.
   */
  startDeepAnalysis(
    sessionId: string,
    question: string,
  ): Observable<DeepAnalysisResult> {
    return this.http.post<DeepAnalysisResult>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/deep-analysis`,
      { question },
    );
  }

  /** Poll one job: planning → investigating → writing → done/error. */
  deepAnalysisStatus(
    sessionId: string,
    jobId: string,
  ): Observable<DeepAnalysisResult> {
    return this.http.get<DeepAnalysisResult>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/deep-analysis/${encodeURIComponent(jobId)}`,
    );
  }

  /** The finished report as markdown. */
  downloadDeepAnalysis(sessionId: string, jobId: string): Observable<Blob> {
    return this.http.get(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/deep-analysis/${encodeURIComponent(jobId)}/download`,
      { responseType: 'blob' },
    );
  }

  sendMessage(id: string, content: string): Observable<SessionActionResult> {
    return this.http.post<SessionActionResult>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(id)}/messages`,
      { content },
    );
  }

  /** Rate an assistant answer; `up` saves it to the verified query library. */
  sendMessageFeedback(
    sessionId: string,
    messageAt: string,
    rating: MessageFeedback,
  ): Observable<SessionActionResult> {
    return this.http.post<SessionActionResult>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/messages/feedback`,
      { messageAt, rating },
    );
  }

  /** SSE stream: reasoning/text/tool deltas while the agent thinks. */
  async streamMessage(
    id: string,
    content: string,
    handlers: {
      onReasoning?: (delta: string) => void;
      onText?: (delta: string) => void;
      onTool?: (call: ToolCallEvent) => void;
      /** Summary of one finished call, including why it was run. */
      onToolResult?: (summary: ToolDataRecord) => void;
      onVisualUpdated?: (event: VisualEvent) => void;
      onDone?: (session: Session) => void;
      onError?: (message: string) => void;
    },
    signal?: AbortSignal,
    activeVisualizationId?: string,
    /** Careful mode: the backend cross-checks the answer before `done`. */
    careful = false,
  ): Promise<void> {
    let res: Response;
    try {
      res = await fetch(
        `${API_BASE_URL}/sessions/${encodeURIComponent(id)}/messages/stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            activeVisualizationId,
            ...(careful ? { careful: true } : {}),
          }),
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
    if (!res.ok || !res.body) {
      handlers.onError?.(`Stream failed (${res.status})`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let terminalEventReceived = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const event = JSON.parse(line.slice(6));
            switch (event.type) {
              case 'reasoning':
                handlers.onReasoning?.(event.content ?? '');
                break;
              case 'text':
                handlers.onText?.(event.content ?? '');
                break;
              case 'tool':
                handlers.onTool?.(parseToolEvent(event.content ?? 'tool'));
                break;
              case 'tool-result':
                try {
                  handlers.onToolResult?.(JSON.parse(event.content ?? '{}'));
                } catch {
                  // Malformed summary — ignore.
                }
                break;
              case 'visual-updated':
                try {
                  handlers.onVisualUpdated?.(JSON.parse(event.content ?? '{}'));
                } catch {
                  // Malformed event — ignore.
                }
                break;
              case 'done':
                terminalEventReceived = true;
                handlers.onDone?.(event.session);
                break;
              case 'error':
                terminalEventReceived = true;
                handlers.onError?.(event.content ?? 'Unknown error');
                break;
            }
          } catch {
            // Malformed frame — skip.
          }
        }
      }
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return;
      }
      handlers.onError?.('Stream disconnected');
      return;
    }
    if (!signal?.aborted && !terminalEventReceived) {
      handlers.onError?.('Stream ended before completion');
    }
  }
}

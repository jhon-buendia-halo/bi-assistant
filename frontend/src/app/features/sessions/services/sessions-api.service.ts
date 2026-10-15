import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  DeepAnalysisResult,
  InteractiveVisualization,
  PanelFileContent,
  PanelItemEvent,
  WorkflowView,
  MessageFeedback,
  RfpPackage,
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
  /** What the call is about: the skill a skill tool loads, else its first text argument. */
  input?: string;
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
      const { name, rationale, input } = parsed as {
        name?: unknown;
        rationale?: unknown;
        input?: unknown;
      };
      if (typeof name === 'string' && name.trim()) {
        return {
          name: name.trim(),
          ...(typeof rationale === 'string' && rationale.trim()
            ? { rationale: rationale.trim() }
            : {}),
          ...(typeof input === 'string' && input.trim()
            ? { input: input.trim() }
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

  create(name: string, datasets: string[]): Observable<SessionActionResult> {
    return this.http.post<SessionActionResult>(`${API_BASE_URL}/sessions`, {
      name,
      datasets,
    });
  }

  /** Start a session bound to a Live user agent, named after it (R52). */
  createFromAgent(
    agentId: string,
    name?: string,
  ): Observable<SessionActionResult> {
    return this.http.post<SessionActionResult>(`${API_BASE_URL}/sessions`, {
      agentId,
      ...(name ? { name } : {}),
    });
  }

  /**
   * Start a preview conversation of a user agent's draft (agents-evals R60).
   * It is never listed; `delete` discards it.
   */
  createPreview(agentId: string): Observable<SessionActionResult> {
    return this.http.post<SessionActionResult>(`${API_BASE_URL}/sessions`, {
      agentId,
      preview: true,
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

  /** Text of a `file` panel item (api.md 106). */
  getPanelItemFile(
    sessionId: string,
    itemId: string,
  ): Observable<PanelFileContent> {
    return this.http.get<PanelFileContent>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/panel-items/${encodeURIComponent(itemId)}/file`,
    );
  }

  /** A panel item as a file: its bytes, `.pdf`, `.md` or `.csv` (api.md 107). */
  downloadPanelItem(
    sessionId: string,
    itemId: string,
    format?: 'pdf' | 'md' | 'csv',
  ): Observable<Blob> {
    return this.http.get(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/panel-items/${encodeURIComponent(itemId)}/download`,
      {
        responseType: 'blob',
        ...(format ? { params: { format } } : {}),
      },
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

  /** The package as a zip, or one of its files when `file` is given; `draft` serves the draft package (#105). */
  downloadRfpPackage(
    sessionId: string,
    rfpId: string,
    file?: string,
    draft?: boolean,
  ): Observable<Blob> {
    return this.http.get(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/rfp-packages/${encodeURIComponent(rfpId)}/download`,
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
      /** `show_in_panel` (or an RFP stage change) put an item in the panel. */
      onPanelItem?: (event: PanelItemEvent) => void;
      /** The workflow status bar changed (`update_workflow`, phases, RFP stage). */
      onWorkflow?: (workflow: WorkflowView) => void;
      /** `export_rfp_package` stored a package this turn. */
      onRfpPackage?: (rfpPackage: RfpPackage) => void;
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
          headers: {
            'Content-Type': 'application/json',
          },
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
              case 'panel-item':
                try {
                  handlers.onPanelItem?.(JSON.parse(event.content ?? '{}'));
                } catch {
                  // Malformed event — ignore.
                }
                break;
              case 'workflow':
                try {
                  handlers.onWorkflow?.(
                    JSON.parse(event.content ?? '{}') as WorkflowView,
                  );
                } catch {
                  // Malformed event — ignore.
                }
                break;
              case 'rfp-package':
                try {
                  handlers.onRfpPackage?.(JSON.parse(event.content ?? '{}'));
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

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  InteractiveVisualization,
  PanelFileContent,
  PanelItemEvent,
  WorkflowView,
  MessageFeedback,
  Session,
  SessionActionResult,
  ToolDataRecord,
  VisualEvent,
} from '../models/session.model';
import {
  ReadinessReport,
  ReadinessReportEvent,
} from '../models/readiness.model';

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

/**
 * The `readiness-report` frame's content (api.md 3.1), parsed. Null when it
 * is not a report with a `readiness` panel item.
 */
export function parseReadinessReportEvent(
  content: string,
): ReadinessReportEvent | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return null;
    const { report, panelItem } = parsed as Partial<ReadinessReportEvent>;
    if (
      !report ||
      typeof report.id !== 'string' ||
      typeof report.datasourceName !== 'string' ||
      typeof report.overallScore !== 'number' ||
      typeof report.maturity !== 'string' ||
      typeof report.generatedAt !== 'string' ||
      !panelItem ||
      panelItem.kind !== 'readiness' ||
      typeof panelItem.reportId !== 'string'
    ) {
      return null;
    }
    return { report, panelItem };
  } catch {
    return null;
  }
}

/** Live progress of a running tool (api.md 3.1 `tool-progress`). */
export interface ToolProgressEvent {
  tool: string;
  phase: string;
  message: string;
  done?: number;
  total?: number;
  entity?: string;
}

/**
 * The agent turn's events (api.md 3.1), shared by the chat stream and the
 * workflow run stream (api.md 3.6), which forwards them unchanged.
 */
export interface AgentStreamHandlers {
  onReasoning?: (delta: string) => void;
  onText?: (delta: string) => void;
  onTool?: (call: ToolCallEvent) => void;
  /** Summary of one finished call, including why it was run. */
  onToolResult?: (summary: ToolDataRecord) => void;
  /** A long-running tool reports where it is, between its call and result. */
  onToolProgress?: (p: ToolProgressEvent) => void;
  onVisualUpdated?: (event: VisualEvent) => void;
  /** `show_in_panel` put an item in the panel. */
  onPanelItem?: (event: PanelItemEvent) => void;
  /** The workflow status bar changed (`update_workflow`, phases). */
  onWorkflow?: (workflow: WorkflowView) => void;
  /** `assess_data_readiness` or `get_readiness_report` returned a report. */
  onReadinessReport?: (event: ReadinessReportEvent) => void;
}

/** One parsed `data:` frame of an SSE stream. */
export interface StreamFrame {
  type?: string;
  content?: string;
  [key: string]: unknown;
}

/** Parse a double-encoded JSON `content`; malformed content is ignored. */
function parseContent<T>(
  content: string | undefined,
  use: (value: T) => void,
): void {
  let value: T;
  try {
    value = JSON.parse(content ?? '{}') as T;
  } catch {
    return; // Malformed event — ignore.
  }
  use(value);
}

/**
 * Hand one frame to the agent-event handler it belongs to. Answers whether
 * the frame was an agent event (anything else is the caller's: `done`,
 * `error`, a run's `run` and `step`).
 */
export function dispatchAgentEvent(
  event: StreamFrame,
  handlers: AgentStreamHandlers,
): boolean {
  switch (event.type) {
    case 'reasoning':
      handlers.onReasoning?.(event.content ?? '');
      return true;
    case 'text':
      handlers.onText?.(event.content ?? '');
      return true;
    case 'tool':
      handlers.onTool?.(parseToolEvent(event.content ?? 'tool'));
      return true;
    case 'tool-result':
      parseContent<ToolDataRecord>(event.content, (v) =>
        handlers.onToolResult?.(v),
      );
      return true;
    case 'tool-progress':
      parseContent<ToolProgressEvent | null>(event.content, (p) => {
        if (p && typeof p.tool === 'string' && typeof p.message === 'string') {
          handlers.onToolProgress?.(p);
        }
      });
      return true;
    case 'visual-updated':
      parseContent<VisualEvent>(event.content, (v) =>
        handlers.onVisualUpdated?.(v),
      );
      return true;
    case 'panel-item':
      parseContent<PanelItemEvent>(event.content, (v) =>
        handlers.onPanelItem?.(v),
      );
      return true;
    case 'workflow':
      parseContent<WorkflowView>(event.content, (v) =>
        handlers.onWorkflow?.(v),
      );
      return true;
    case 'readiness-report': {
      const parsed = parseReadinessReportEvent(event.content ?? '');
      if (parsed) handlers.onReadinessReport?.(parsed);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Read an SSE body frame by frame (api.md 3.1 framing: one `data: <JSON>`
 * per frame, split on a blank line; malformed frames skipped). Answers how
 * the read ended: the body ended, the reader was aborted, or it failed.
 */
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (event: StreamFrame) => void,
  signal?: AbortSignal,
): Promise<'ended' | 'aborted' | 'disconnected'> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return signal?.aborted ? 'aborted' : 'ended';
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          onFrame(JSON.parse(line.slice(6)) as StreamFrame);
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
      return 'aborted';
    }
    return 'disconnected';
  }
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

  delete(id: string): Observable<SessionActionResult> {
    return this.http.delete<SessionActionResult>(
      `${API_BASE_URL}/sessions/${encodeURIComponent(id)}`,
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

  /** One stored data-readiness report (api.md 110). */
  getReadinessReport(reportId: string): Observable<ReadinessReport> {
    return this.http.get<ReadinessReport>(
      `${API_BASE_URL}/data-readiness/assessments/${encodeURIComponent(reportId)}`,
    );
  }
}

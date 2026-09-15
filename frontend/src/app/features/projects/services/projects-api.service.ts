import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  InteractiveVisualization,
  Project,
  ProjectActionResult,
  ToolDataRecord,
  VisualEvent,
} from '../models/project.model';

@Injectable({ providedIn: 'root' })
export class ProjectsApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<{ projects: Project[] }> {
    return this.http.get<{ projects: Project[] }>(`${API_BASE_URL}/projects`);
  }

  get(id: string): Observable<Project> {
    return this.http.get<Project>(
      `${API_BASE_URL}/projects/${encodeURIComponent(id)}`,
    );
  }

  revertVisualization(
    projectId: string,
    visualizationId: string,
    version: number,
  ): Observable<ProjectActionResult> {
    return this.http.post<ProjectActionResult>(
      `${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/visualizations/${encodeURIComponent(visualizationId)}/revert`,
      { version },
    );
  }

  create(name: string, sandboxes: string[]): Observable<ProjectActionResult> {
    return this.http.post<ProjectActionResult>(`${API_BASE_URL}/projects`, {
      name,
      sandboxes,
    });
  }

  delete(id: string): Observable<ProjectActionResult> {
    return this.http.delete<ProjectActionResult>(
      `${API_BASE_URL}/projects/${encodeURIComponent(id)}`,
    );
  }

  generateVisualization(
    id: string,
    sourceMessageAt: string,
  ): Observable<ProjectActionResult> {
    return this.http.post<ProjectActionResult>(
      `${API_BASE_URL}/projects/${encodeURIComponent(id)}/visualizations`,
      { sourceMessageAt },
    );
  }

  getVisualization(
    projectId: string,
    visualizationId: string,
    version?: number,
  ): Observable<InteractiveVisualization> {
    const query = version ? `?version=${version}` : '';
    return this.http.get<InteractiveVisualization>(
      `${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/visualizations/${encodeURIComponent(visualizationId)}${query}`,
    );
  }

  downloadVisualization(
    projectId: string,
    visualizationId: string,
  ): Observable<Blob> {
    return this.http.get(
      `${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/visualizations/${encodeURIComponent(visualizationId)}/download`,
      { responseType: 'blob' },
    );
  }

  sendMessage(id: string, content: string): Observable<ProjectActionResult> {
    return this.http.post<ProjectActionResult>(
      `${API_BASE_URL}/projects/${encodeURIComponent(id)}/messages`,
      { content },
    );
  }

  /** SSE stream: reasoning/text/tool deltas while the agent thinks. */
  async streamMessage(
    id: string,
    content: string,
    handlers: {
      onReasoning?: (delta: string) => void;
      onText?: (delta: string) => void;
      onTool?: (name: string) => void;
      onToolResult?: (summary: ToolDataRecord) => void;
      onVisualUpdated?: (event: VisualEvent) => void;
      onDone?: (project: Project) => void;
      onError?: (message: string) => void;
    },
    signal?: AbortSignal,
    activeVisualizationId?: string,
  ): Promise<void> {
    let res: Response;
    try {
      res = await fetch(
        `${API_BASE_URL}/projects/${encodeURIComponent(id)}/messages/stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, activeVisualizationId }),
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
                handlers.onTool?.(event.content ?? 'tool');
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
                handlers.onDone?.(event.project);
                break;
              case 'error':
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
    }
  }
}

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  InteractiveVisualization,
  Project,
  ProjectActionResult,
} from '../models/project.model';

@Injectable({ providedIn: 'root' })
export class ProjectsApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<{ projects: Project[] }> {
    return this.http.get<{ projects: Project[] }>(`${API_BASE_URL}/projects`);
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
  ): Observable<InteractiveVisualization> {
    return this.http.get<InteractiveVisualization>(
      `${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/visualizations/${encodeURIComponent(visualizationId)}`,
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
      onDone?: (project: Project) => void;
      onError?: (message: string) => void;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    let res: Response;
    try {
      res = await fetch(
        `${API_BASE_URL}/projects/${encodeURIComponent(id)}/messages/stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
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

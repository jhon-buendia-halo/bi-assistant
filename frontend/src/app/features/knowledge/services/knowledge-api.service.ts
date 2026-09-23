import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  KnowledgeSnippet,
  KnowledgeSnippetInput,
  KnowledgeSnippetKind,
  KnowledgeSnippetSource,
} from '../models/knowledge.model';

export interface KnowledgeQuery {
  datasetId?: string;
  kind?: KnowledgeSnippetKind;
  source?: KnowledgeSnippetSource;
  enabled?: boolean;
}

export interface KnowledgeBootstrapResult {
  created: KnowledgeSnippet[];
}

/** One stage of a streamed bootstrap run — `key` identifies the stage so an
 * evolving line (sampling 2 of 5 tables) replaces itself instead of piling up. */
export interface KnowledgeBootstrapProgress {
  key: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class KnowledgeApiService {
  private readonly http = inject(HttpClient);

  list(query: KnowledgeQuery = {}): Observable<KnowledgeSnippet[]> {
    let params = new HttpParams();
    if (query.datasetId) params = params.set('datasetId', query.datasetId);
    if (query.kind) params = params.set('kind', query.kind);
    if (query.source) params = params.set('source', query.source);
    if (query.enabled !== undefined) {
      params = params.set('enabled', String(query.enabled));
    }
    return this.http.get<KnowledgeSnippet[]>(`${API_BASE_URL}/knowledge`, {
      params,
    });
  }

  create(input: KnowledgeSnippetInput): Observable<KnowledgeSnippet> {
    return this.http.post<KnowledgeSnippet>(`${API_BASE_URL}/knowledge`, input);
  }

  update(
    id: string,
    input: Partial<KnowledgeSnippetInput>,
  ): Observable<KnowledgeSnippet> {
    return this.http.patch<KnowledgeSnippet>(
      `${API_BASE_URL}/knowledge/${encodeURIComponent(id)}`,
      input,
    );
  }

  delete(id: string): Observable<unknown> {
    return this.http.delete(
      `${API_BASE_URL}/knowledge/${encodeURIComponent(id)}`,
    );
  }

  bootstrap(datasetId: string): Observable<KnowledgeBootstrapResult> {
    return this.http.post<KnowledgeBootstrapResult>(
      `${API_BASE_URL}/knowledge/bootstrap`,
      { datasetId },
    );
  }

  /**
   * SSE bootstrap: `onProgress` per stage while the run works, then exactly
   * one of `onDone`/`onError`. Mirrors `SessionsApiService.streamMessage`.
   */
  async bootstrapStream(
    datasetId: string,
    handlers: {
      onProgress?: (progress: KnowledgeBootstrapProgress) => void;
      onDone?: (created: KnowledgeSnippet[]) => void;
      onError?: (message: string) => void;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/knowledge/bootstrap/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetId }),
        signal,
      });
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
      handlers.onError?.(`Could not generate suggestions (${res.status})`);
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
          let event: {
            type?: string;
            key?: string;
            message?: string;
            created?: KnowledgeSnippet[];
          };
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue; // Malformed frame — ignore.
          }
          switch (event.type) {
            case 'progress':
              handlers.onProgress?.({
                key: event.key ?? '',
                message: event.message ?? '',
              });
              break;
            case 'done':
              terminalEventReceived = true;
              handlers.onDone?.(event.created ?? []);
              break;
            case 'error':
              terminalEventReceived = true;
              handlers.onError?.(
                event.message ??
                  'Could not generate suggestions — try again shortly',
              );
              break;
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
      if (!terminalEventReceived) handlers.onError?.('Stream interrupted');
      return;
    }
    // The backend closed without saying how it ended — never leave the UI spinning.
    if (!terminalEventReceived && !signal?.aborted) {
      handlers.onError?.('Stream ended unexpectedly');
    }
  }
}

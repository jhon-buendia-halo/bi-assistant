import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  OntologyItem,
  OntologyItemInput,
  OntologyItemPatch,
  OntologyKind,
  OntologySource,
} from '../models/ontology.model';

export interface OntologyQuery {
  kind?: OntologyKind;
  source?: OntologySource;
  enabled?: boolean;
}

/** One stage of a streamed bootstrap run — `key` identifies the stage so an
 * evolving line (sampling 2 of 5 tables) replaces itself instead of piling up. */
export interface OntologyBootstrapProgress {
  key: string;
  message: string;
}

function datasetBase(dataset: string): string {
  return `${API_BASE_URL}/datasets/${encodeURIComponent(dataset)}/ontology`;
}

@Injectable({ providedIn: 'root' })
export class OntologyApiService {
  private readonly http = inject(HttpClient);

  /** The dataset's own items plus the shared ones, newest first. */
  list(dataset: string, query: OntologyQuery = {}): Observable<OntologyItem[]> {
    let params = new HttpParams();
    if (query.kind) params = params.set('kind', query.kind);
    if (query.source) params = params.set('source', query.source);
    if (query.enabled !== undefined) {
      params = params.set('enabled', String(query.enabled));
    }
    return this.http.get<OntologyItem[]>(datasetBase(dataset), { params });
  }

  create(dataset: string, input: OntologyItemInput): Observable<OntologyItem> {
    return this.http.post<OntologyItem>(datasetBase(dataset), input);
  }

  update(id: string, patch: OntologyItemPatch): Observable<OntologyItem> {
    return this.http.patch<OntologyItem>(
      `${API_BASE_URL}/ontology/${encodeURIComponent(id)}`,
      patch,
    );
  }

  remove(id: string): Observable<unknown> {
    return this.http.delete(
      `${API_BASE_URL}/ontology/${encodeURIComponent(id)}`,
    );
  }

  /**
   * SSE bootstrap: `onProgress` per stage while the run works, then exactly
   * one of `onDone`/`onError`. Mirrors `SessionsApiService.streamMessage`.
   */
  async bootstrapStream(
    dataset: string,
    handlers: {
      onProgress?: (progress: OntologyBootstrapProgress) => void;
      onDone?: (created: OntologyItem[]) => void;
      onError?: (message: string) => void;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${datasetBase(dataset)}/bootstrap/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
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
            created?: OntologyItem[];
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

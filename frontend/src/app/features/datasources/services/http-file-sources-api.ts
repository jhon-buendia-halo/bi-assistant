import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  FileDatasourceConfig,
  SheetPreview,
  SourceFile,
} from '../models/datasource.model';
import { FileSourcesApi, SheetPreviewRequest } from './file-sources-api';

/** The text the user sees for a failed call: the server's message, else a fallback. */
function messageOf(err: unknown, fallback: string): Error {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { message?: string | string[] } | null;
    const text = Array.isArray(body?.message)
      ? body.message.join(', ')
      : body?.message;
    if (text) return new Error(text);
    if (err.status === 413) return new Error('File is larger than 200 MB');
    if (err.status === 0) return new Error('Backend unreachable');
  }
  return new Error(fallback);
}

/** Endpoints 156 to 158 and the test endpoint 16 for the `file` kind. */
@Injectable({ providedIn: 'root' })
export class HttpFileSourcesApi implements FileSourcesApi {
  private readonly http = inject(HttpClient);

  async upload(file: File): Promise<{ uploadId: string; file: SourceFile }> {
    try {
      return await firstValueFrom(
        this.http.post<{ uploadId: string; file: SourceFile }>(
          `${API_BASE_URL}/datasources/files/uploads`,
          file,
          {
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-File-Name': encodeURIComponent(file.name),
            },
          },
        ),
      );
    } catch (err) {
      throw messageOf(err, 'Upload failed');
    }
  }

  async preview(req: SheetPreviewRequest): Promise<SheetPreview> {
    try {
      return await firstValueFrom(
        this.http.post<SheetPreview>(
          `${API_BASE_URL}/datasources/files/preview`,
          req,
        ),
      );
    } catch (err) {
      throw messageOf(err, 'Could not read the sheet');
    }
  }

  async discard(uploadId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<void>(
        `${API_BASE_URL}/datasources/files/uploads/${encodeURIComponent(uploadId)}`,
      ),
    );
  }

  async importAndCheck(
    config: FileDatasourceConfig,
    datasourceId?: string,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      return await firstValueFrom(
        this.http.post<{ ok: boolean; message: string }>(
          `${API_BASE_URL}/datasources/test-connection`,
          { kind: 'file', config, id: datasourceId },
        ),
      );
    } catch (err) {
      throw messageOf(err, 'Import failed');
    }
  }
}

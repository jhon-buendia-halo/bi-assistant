import {
  HttpClient,
  HttpErrorResponse,
  HttpResponse,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, map, mergeMap, throwError } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  ProfileExportRequest,
  ProfileRequest,
  SampledProfile,
  SampleExportRequest,
  ScriptRequest,
} from '../models/synthetic-data.model';

/** A downloaded file: the bytes and the name the server chose. */
export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

/** A failed download, with the Style B `message` parsed out of the blob. */
export interface DownloadError {
  status: number;
  message: string;
}

/** `attachment; filename="x.sql"` -> `x.sql`; null when absent. */
export function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/** Saves a downloaded file through a temporary link (as session-panel does). */
export function saveFile(file: DownloadedFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

@Injectable({ providedIn: 'root' })
export class SyntheticDataApiService {
  private readonly http = inject(HttpClient);

  /** POST /synthetic-data/profiles (#111). Unsubscribing aborts the request. */
  profile(request: ProfileRequest): Observable<SampledProfile> {
    return this.http.post<SampledProfile>(
      `${API_BASE_URL}/synthetic-data/profiles`,
      request,
    );
  }

  /** POST /synthetic-data/scripts (#112): the synthetic copy as .sql, .zip or .xlsx. */
  script(request: ScriptRequest): Observable<DownloadedFile> {
    const ext = request.format === 'csv' ? 'zip' : (request.format ?? 'sql');
    return this.download('scripts', request, `synthetic.${ext}`);
  }

  /** POST /synthetic-data/profile-exports (#113). */
  exportProfile(request: ProfileExportRequest): Observable<DownloadedFile> {
    return this.download(
      'profile-exports',
      request,
      `profile.${request.format}`,
    );
  }

  /** POST /synthetic-data/sample-exports (#114): real rows; needs confirmRealData. */
  exportSample(request: SampleExportRequest): Observable<DownloadedFile> {
    const ext = request.format === 'csv' ? 'zip' : request.format;
    return this.download('sample-exports', request, `sample.${ext}`);
  }

  private download(
    path: string,
    body: object,
    fallbackName: string,
  ): Observable<DownloadedFile> {
    return this.http
      .post(`${API_BASE_URL}/synthetic-data/${path}`, body, {
        responseType: 'blob',
        observe: 'response',
      })
      .pipe(
        map((res: HttpResponse<Blob>) => ({
          blob: res.body as Blob,
          fileName:
            fileNameFromDisposition(res.headers.get('Content-Disposition')) ??
            fallbackName,
        })),
        catchError((err: HttpErrorResponse) =>
          from(errorOf(err)).pipe(mergeMap((e) => throwError(() => e))),
        ),
      );
  }
}

async function errorOf(err: HttpErrorResponse): Promise<DownloadError> {
  let message = 'Backend unreachable';
  if (err.status !== 0) {
    message = `Request failed (${err.status})`;
    try {
      const body: unknown =
        err.error instanceof Blob
          ? JSON.parse(await err.error.text())
          : err.error;
      const text = (body as { message?: unknown } | null)?.message;
      if (typeof text === 'string' && text !== '') message = text;
      else if (Array.isArray(text) && text.length > 0)
        message = text.join(', ');
    } catch {
      /* not JSON: keep the generic text */
    }
  }
  return { status: err.status, message };
}

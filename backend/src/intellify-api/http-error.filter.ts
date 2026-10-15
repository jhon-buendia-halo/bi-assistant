import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { DatabaseUnavailableError, isConnectionError } from './db/db.service';

/** Every non-2xx body of the Intellify API (api.md 2.16). */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  code?: string;
  details?: string[];
}

const CODE_BY_STATUS: Record<number, string> = {
  404: 'not_found',
  409: 'conflict',
};

/** Maps any thrown value to the API's error shape. Pure, for tests. */
export function toErrorBody(exception: unknown): ApiErrorBody {
  if (
    exception instanceof DatabaseUnavailableError ||
    isConnectionError(exception)
  ) {
    return {
      statusCode: 503,
      error: STATUS_CODES[503]!,
      message: 'database unavailable',
      code: 'database_unavailable',
    };
  }
  if (exception instanceof HttpException) {
    return fromHttp(exception.getStatus(), exception.getResponse());
  }
  // Body-parser and friends throw plain errors carrying an HTTP status.
  const status =
    (exception as { status?: unknown; statusCode?: unknown } | null)?.status ??
    (exception as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return fromHttp(status, (exception as Error).message);
  }
  return {
    statusCode: 500,
    error: STATUS_CODES[500]!,
    message: 'Internal server error',
  };
}

function fromHttp(status: number, response: unknown): ApiErrorBody {
  const error = STATUS_CODES[status] ?? 'Error';
  const body = typeof response === 'object' && response ? response : {};
  const raw = (body as { message?: unknown }).message ?? response;
  const code = (body as { code?: unknown }).code;
  if (status === 400 && Array.isArray(raw)) {
    return {
      statusCode: 400,
      error,
      message: 'Validation failed',
      code: 'validation',
      details: raw.map(String),
    };
  }
  const out: ApiErrorBody = {
    statusCode: status,
    error,
    message: typeof raw === 'string' ? raw : error,
  };
  const resolved = typeof code === 'string' ? code : CODE_BY_STATUS[status];
  if (resolved) out.code = resolved;
  const details = (body as { details?: unknown }).details;
  if (Array.isArray(details)) out.details = details.map(String);
  return out;
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('IntellifyApi');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = toErrorBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
      );
    }
    if (res.headersSent) return;
    res.status(body.statusCode).json(body);
  }
}

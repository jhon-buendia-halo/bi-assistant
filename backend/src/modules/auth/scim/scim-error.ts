import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';

export const SCIM_CONTENT_TYPE = 'application/scim+json';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

export type ScimType =
  | 'invalidValue'
  | 'invalidSyntax'
  | 'invalidFilter'
  | 'uniqueness'
  | 'noTarget'
  | 'invalidPath';

/** A SCIM error (RFC 7644 §3.12), answered in SCIM format (api.md 2.14). */
export class ScimError extends HttpException {
  constructor(
    status: number,
    readonly detail: string,
    readonly scimType?: ScimType,
  ) {
    super(detail, status);
  }
}

/** Writes `ScimError`s as `application/scim+json` error bodies. */
@Catch(ScimError)
export class ScimErrorFilter implements ExceptionFilter {
  catch(error: ScimError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = error.getStatus();
    res
      .status(status)
      .type(SCIM_CONTENT_TYPE)
      .send(
        JSON.stringify({
          schemas: [SCIM_ERROR_SCHEMA],
          status: String(status),
          ...(error.scimType ? { scimType: error.scimType } : {}),
          detail: error.detail,
        }),
      );
  }
}

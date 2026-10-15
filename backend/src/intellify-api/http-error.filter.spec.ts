import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseUnavailableError } from './db/db.service';
import { toErrorBody } from './http-error.filter';

describe('toErrorBody', () => {
  it('maps validation errors to 400 validation with details', () => {
    expect(
      toErrorBody(new BadRequestException(['page must not be less than 1'])),
    ).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      code: 'validation',
      details: ['page must not be less than 1'],
    });
  });

  it('maps not found and conflict', () => {
    expect(toErrorBody(new NotFoundException('RFP not found'))).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'RFP not found',
      code: 'not_found',
    });
    expect(toErrorBody(new ConflictException('backwards move'))).toMatchObject({
      statusCode: 409,
      code: 'conflict',
      message: 'backwards move',
    });
  });

  it('maps connection failures to 503 database_unavailable', () => {
    const body = {
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'database unavailable',
      code: 'database_unavailable',
    };
    expect(toErrorBody(new DatabaseUnavailableError())).toEqual(body);
    expect(
      toErrorBody(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })),
    ).toEqual(body);
  });

  it('maps parser errors with a 4xx status and hides unexpected ones', () => {
    expect(
      toErrorBody(
        Object.assign(new Error('Unexpected token'), { status: 400 }),
      ),
    ).toMatchObject({ statusCode: 400, message: 'Unexpected token' });
    expect(toErrorBody(new Error('boom: secret detail'))).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
  });
});

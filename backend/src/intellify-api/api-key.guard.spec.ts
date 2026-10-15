import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiKeyGuard, INTELLIFY_API_KEYS } from './api-key.guard';
import { HttpErrorFilter } from './http-error.filter';
import { Public } from './public.decorator';

@Controller()
class ProbeController {
  @Get('secret')
  secret() {
    return { ok: true };
  }
  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }
}

describe('ApiKeyGuard', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        { provide: INTELLIFY_API_KEYS, useValue: ['key-one', 'key-two'] },
        { provide: APP_GUARD, useClass: ApiKeyGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
  });
  afterAll(() => app.close());

  const unauthorized = {
    statusCode: 401,
    error: 'Unauthorized',
    message: 'API key required',
  };

  it('rejects a request without a key', async () => {
    const res = await request(app.getHttpServer()).get('/secret').expect(401);
    expect(res.body).toEqual(unauthorized);
  });

  it('rejects a wrong key, including a prefix of a real one', async () => {
    for (const key of ['nope', 'key-on', 'key-one-and-more', '']) {
      const res = await request(app.getHttpServer())
        .get('/secret')
        .set('X-API-Key', key)
        .expect(401);
      expect(res.body).toEqual(unauthorized);
    }
  });

  it('accepts any of the configured keys', async () => {
    for (const key of ['key-one', 'key-two']) {
      await request(app.getHttpServer())
        .get('/secret')
        .set('X-API-Key', key)
        .expect(200);
    }
  });

  it('lets @Public routes through without a key', async () => {
    await request(app.getHttpServer()).get('/open').expect(200);
  });
});

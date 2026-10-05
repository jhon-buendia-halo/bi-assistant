// The services are replaced wholesale: this spec is about routing and body
// mapping, and the real ones pull in the Mastra and session stacks.
jest.mock('./agents.service', () => ({ AgentsService: class {} }));
jest.mock('./eval-runs.service', () => ({ EvalRunsService: class {} }));

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { EvalRunsService } from './eval-runs.service';
import { EvalLogsService } from './eval-logs.service';

describe('AgentsController', () => {
  let app: INestApplication;
  const logs = {
    list: jest.fn(() => ({ logs: [], dirs: ['/logs'] })),
    read: jest.fn(() => ({ ok: false, message: 'Run log "x.json" not found' })),
    compare: jest.fn(() => ({ ok: true, diff: { regressions: [] }, markdown: '# diff' })),
    trend: jest.fn(() => ({ points: [] })),
    changelogDraft: jest.fn(() => ({ ok: true, markdown: '## entry' })),
  };
  const runs = {
    start: jest.fn(),
    startLoop: jest.fn(),
    getLoop: jest.fn(),
    stop: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [
        { provide: AgentsService, useValue: {} },
        { provide: EvalRunsService, useValue: runs },
        { provide: EvalLogsService, useValue: logs },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // Express matches in declaration order: were `logs/:file` declared first,
  // `compare` would be read as a file name and every Compare would 404.
  it('routes evals/logs/compare to compare, not to the :file reader', async () => {
    const response = await request(app.getHttpServer())
      .get('/agents/assistant/evals/logs/compare')
      .query({ a: 'before.json', b: 'after.json' })
      .expect(200);
    expect(response.body).toEqual({
      ok: true,
      diff: { regressions: [] },
      markdown: '# diff',
    });
    expect(logs.compare).toHaveBeenCalledWith('before.json', 'after.json');
    expect(logs.read).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get('/agents/assistant/evals/logs/x.json')
      .expect(200);
    expect(logs.read).toHaveBeenCalledWith('x.json');
  });

  it('lists logs with suite and limit, and trends by suite and arm', async () => {
    await request(app.getHttpServer())
      .get('/agents/assistant/evals/logs')
      .query({ suite: 'genomics', limit: '5' })
      .expect(200, { logs: [], dirs: ['/logs'] });
    expect(logs.list).toHaveBeenCalledWith({ suite: 'genomics', limit: 5 });

    await request(app.getHttpServer())
      .get('/agents/assistant/evals/trend')
      .query({ suite: 'genomics', arm: 'baseline' })
      .expect(200, { points: [] });
    expect(logs.trend).toHaveBeenCalledWith({ suite: 'genomics', arm: 'baseline' });
  });

  it('maps the run body and says when the run was queued', async () => {
    runs.start.mockResolvedValue({ jobId: 'job-2', queued: true });
    const response = await request(app.getHttpServer())
      .post('/agents/assistant/evals/run')
      .send({
        datasourceId: 'wc',
        caseIds: ['a'],
        suiteId: 'world-cup',
        repeat: 3,
        label: 'iter-1',
        arm: 'fixer-off',
        engine: { careful: 'on' },
        includeVariants: true,
        categories: ['control'],
      })
      .expect(201);
    expect(response.body).toEqual({
      ok: true,
      message: 'Eval run queued',
      jobId: 'job-2',
    });
    expect(runs.start).toHaveBeenCalledWith('assistant', {
      datasourceId: 'wc',
      caseIds: ['a'],
      suiteId: 'world-cup',
      datasets: undefined,
      repeat: 3,
      label: 'iter-1',
      arm: 'fixer-off',
      engine: { careful: 'on' },
      includeVariants: true,
      categories: ['control'],
    });

    runs.start.mockResolvedValue({ jobId: 'job-3', queued: false });
    const started = await request(app.getHttpServer())
      .post('/agents/assistant/evals/run')
      .send({ datasourceId: 'wc' });
    expect(started.body.message).toBe('Eval run started');

    runs.start.mockResolvedValue({ error: 'Repeat must be 1, 3 or 5 (got 2)' });
    const rejected = await request(app.getHttpServer())
      .post('/agents/assistant/evals/run')
      .send({ datasourceId: 'wc', repeat: 2 });
    expect(rejected.body).toEqual({
      ok: false,
      message: 'Repeat must be 1, 3 or 5 (got 2)',
    });
  });

  it('queues a loop, reports it, and stops a run', async () => {
    runs.startLoop.mockResolvedValue({
      loopId: 'loop-1',
      jobIds: ['a', 'b'],
      skipped: ['world-cup'],
    });
    const loop = await request(app.getHttpServer())
      .post('/agents/assistant/evals/loop')
      .send({
        datasourceId: 'fixtures',
        suiteIds: ['world-cup', 'genomics'],
        arms: ['baseline'],
        repeat: 3,
        label: 'loop',
        categories: ['ratio-trap'],
      })
      .expect(201);
    expect(loop.body).toEqual({
      ok: true,
      message:
        'Queued 2 eval runs (skipped world-cup: no question in the selected categories)',
      loopId: 'loop-1',
      jobIds: ['a', 'b'],
    });

    runs.getLoop.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get('/agents/assistant/evals/loops/loop-9')
      .expect(200, { ok: false, message: 'Eval loop "loop-9" not found' });

    runs.stop.mockResolvedValue({ ok: true, message: 'Removed from the queue' });
    await request(app.getHttpServer())
      .post('/agents/assistant/evals/runs/job-2/stop')
      .expect(201, { ok: true, message: 'Removed from the queue' });
    expect(runs.stop).toHaveBeenCalledWith('job-2');
  });

  it('drafts a change-log entry from the posted body', async () => {
    await request(app.getHttpServer())
      .post('/agents/assistant/evals/logs/changelog-draft')
      .send({ a: 'a.json', b: 'b.json', lever: 'context', change: 'c', why: 'w', append: true })
      .expect(201, { ok: true, markdown: '## entry' });
    expect(logs.changelogDraft).toHaveBeenCalledWith({
      a: 'a.json',
      b: 'b.json',
      lever: 'context',
      change: 'c',
      why: 'w',
      append: true,
    });
  });
});

// The real Mastra instance pulls in ESM-only packages Jest cannot require.
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/evals/assistant.evals', () => ({
  ASSISTANT_EVAL_SETS: [],
}));
jest.mock('../../mastra/evals/eval-sets', () => ({
  evalSetsFor: () => [],
}));
jest.mock('../llm/llm.service', () => ({ LlmService: class {} }));
jest.mock('../sessions/sessions.service', () => ({
  SessionsService: class {},
  RUN_HOST_ID_PREFIX: 'run-',
}));
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));

import { Test } from '@nestjs/testing';
import BetterSqlite3 from 'better-sqlite3';
import request from 'supertest';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import type { DatasourcesService } from '../datasources/datasources.service';
import type { ChatMessage } from '../sessions/entities/session.entity';
import { QueryEvidenceService } from '../sessions/query-evidence/query-evidence.service';
import type { SessionsService } from '../sessions/sessions.service';
import { WorkflowNodeChatsRepository } from './repositories/workflow-node-chats.repository';
import { WorkflowRunsRepository } from './repositories/workflow-runs.repository';
import type { WorkflowRunDoc } from './workflow-run-steps';
import { WorkflowNodeChatsService } from './workflow-node-chats.service';
import { WorkflowRunsController } from './workflow-runs.controller';
import { WorkflowRunsService } from './workflow-runs.service';

const RANKED =
  'SELECT product, COUNT(*) AS n FROM shop.public.returns GROUP BY product ORDER BY n DESC LIMIT 100';
const RUN_ID = 'a1b2c3d4-0000-4000-8000-000000000000';

const ANSWER: ChatMessage = {
  role: 'assistant',
  content: 'Top products by returns.',
  at: '2026-11-15T10:00:00.000Z',
  data: [
    {
      tool: 'run_readonly_sql',
      input: RANKED,
      columns: ['product', 'n'],
      rows: [{ product: 'a', n: 9 }],
      rowCount: 100,
    },
    { tool: 'run_readonly_sql', input: 'SELECT nope', error: 'no column' },
  ],
};

function runDoc(patch: Partial<WorkflowRunDoc> = {}): WorkflowRunDoc {
  return {
    id: RUN_ID,
    workflowId: 'answer-business-question',
    workflowName: 'Answer a Business Question',
    input: {},
    status: 'success',
    steps: [],
    question: 'Which products are returned most?',
    answer: ANSWER,
    datasets: ['shop'],
    startedAt: '2026-11-15T09:59:00.000Z',
    ...patch,
  };
}

function build() {
  const runReadOnlySql = jest.fn(
    (_id: string, sql: string, _limit: number, maxRows?: number) => {
      if (sql.startsWith('SELECT COUNT(*) AS n')) {
        return Promise.resolve({ columns: ['n'], rows: [{ n: 48912 }] });
      }
      // 143's statement: more rows exist than a download keeps.
      const total = maxRows ? 50_001 : 1870;
      const kept = Math.min(total, maxRows ?? 100);
      return Promise.resolve({
        columns: ['product', 'n'],
        rows: Array.from({ length: kept }, (_, i) => ({
          product: i === 0 ? 'say "hi", ok' : `p${i}`,
          n: i,
        })),
        totalRows: total,
      });
    },
  );
  const datasources = {
    runReadOnlySql,
    sampleRows: jest.fn(),
    get: jest.fn(),
    defaultDatasource: jest.fn(),
  };
  const datasets = {
    getByNames: jest.fn().mockResolvedValue([
      {
        name: 'shop',
        datasourceId: 'ds-1',
        datasourceKind: 'postgres',
        tables: ['shop.public.returns'],
      },
    ]),
  };
  const queryEvidence = new QueryEvidenceService(
    datasets as unknown as DatasetsRepository,
    datasources as unknown as DatasourcesService,
  );
  const sessions = {
    toView: jest.fn(() => Promise.resolve({ panelItems: [] })),
    rateRunAnswer: jest.fn(
      async (
        _runId: string,
        host: { messages: ChatMessage[] },
        messageAt: string,
        rating: string,
      ) => {
        // A slow rating: a write that lands meanwhile must not be lost.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          ...host.messages.find(
            (m) => m.role === 'assistant' && m.at === messageAt,
          ),
          feedback: rating,
        };
      },
    ),
  };
  const db = new BetterSqlite3(':memory:');
  const repository = new WorkflowRunsRepository(
    new SqliteDocStore(db, 'workflow_runs'),
  );
  const service = new WorkflowRunsService(
    {} as never,
    sessions as unknown as SessionsService,
    {} as never,
    {} as never,
    repository,
    new WorkflowNodeChatsRepository(
      new SqliteDocStore(db, 'workflow_run_node_chats'),
    ),
    queryEvidence,
  );
  return { service, repository, runReadOnlySql, sessions };
}

describe('Workflow runs: the query evidence (api.md 139-143)', () => {
  it('139 builds the evidence and sizes each table once, then runs nothing', async () => {
    const ctx = build();
    await ctx.repository.insert(runDoc());

    const run = await ctx.service.prepareEvidence(RUN_ID);

    expect(ctx.runReadOnlySql).toHaveBeenCalledTimes(1);
    expect(ctx.runReadOnlySql).toHaveBeenCalledWith(
      'ds-1',
      'SELECT COUNT(*) AS n FROM "public"."returns"',
      1,
    );
    expect(run.answer?.evidence).toEqual([
      {
        index: 0,
        coverage: 'top-n',
        outerLimit: 100,
        datasourceId: 'ds-1',
        datasourceKind: 'postgres',
        tables: [{ entity: 'shop.public.returns', rows: 48912 }],
      },
      { index: 1 },
    ]);
    expect((await ctx.repository.get(RUN_ID))?.answer?.evidence).toEqual(
      run.answer?.evidence,
    );

    ctx.runReadOnlySql.mockClear();
    const again = await ctx.service.prepareEvidence(RUN_ID);
    expect(ctx.runReadOnlySql).not.toHaveBeenCalled();
    expect(again.answer?.evidence).toEqual(run.answer?.evidence);
  });

  it('applies the shared checks', async () => {
    const ctx = build();
    await expect(ctx.service.prepareEvidence('missing')).rejects.toThrow(
      'Run "missing" not found',
    );
    await ctx.repository.insert(runDoc({ answer: undefined }));
    await expect(ctx.service.prepareEvidence(RUN_ID)).rejects.toThrow(
      `Run "${RUN_ID}" has no answer`,
    );
    await ctx.repository.update(RUN_ID, { answer: ANSWER, status: 'running' });
    await expect(ctx.service.rerunQuery(RUN_ID, 0)).rejects.toThrow(
      'Wait for the run to finish',
    );
    await ctx.repository.update(RUN_ID, { status: 'success' });
    await expect(ctx.service.rerunQuery(RUN_ID, 7)).rejects.toThrow(
      "Query 7 not found in the run's answer",
    );
    await expect(ctx.service.rerunQuery(RUN_ID, 1)).rejects.toThrow(
      'Query 1 has no SQL to run',
    );
  });

  it('142 runs the query again and stores nothing', async () => {
    const ctx = build();
    await ctx.repository.insert(runDoc());
    const before = await ctx.repository.get(RUN_ID);

    const result = await ctx.service.rerunQuery(RUN_ID, 0);

    expect(ctx.runReadOnlySql).toHaveBeenCalledWith('ds-1', RANKED, 100);
    expect(result).toMatchObject({
      rowCount: 100,
      totalRows: 1870,
      coverage: 'partial',
    });
    expect(await ctx.repository.get(RUN_ID)).toEqual(before);
  });

  it('128 rates the answer through the lock, keeping evidence written meanwhile', async () => {
    const ctx = build();
    await ctx.repository.insert(runDoc());

    const [rated, prepared] = await Promise.all([
      ctx.service.rateAnswer(RUN_ID, 'up'),
      ctx.service.prepareEvidence(RUN_ID),
    ]);

    expect(rated.answer?.feedback).toBe('up');
    expect(prepared.answer?.feedback).toBe('up');
    const stored = await ctx.repository.get(RUN_ID);
    expect(stored?.answer?.feedback).toBe('up');
    expect(stored?.answer?.evidence).toHaveLength(2);
  });

  it('patchEvidence merges one entry under the lock', async () => {
    const ctx = build();
    await ctx.repository.insert(runDoc());

    const run = await ctx.service.patchEvidence(RUN_ID, 0, {
      explanation: { steps: [], at: 't' },
    });

    expect(run.answer?.evidence?.[0]).toMatchObject({
      index: 0,
      coverage: 'top-n',
      explanation: { steps: [], at: 't' },
    });
    await expect(ctx.service.patchEvidence(RUN_ID, 5, {})).rejects.toThrow(
      "Query 5 not found in the run's answer",
    );
  });

  it('143 answers CSV with X-Rows-Cut when more than 50,000 rows existed', async () => {
    const ctx = build();
    await ctx.repository.insert(runDoc());
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowRunsController],
      providers: [
        { provide: WorkflowRunsService, useValue: ctx.service },
        { provide: WorkflowNodeChatsService, useValue: {} },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(server)
        .get(`/workflow-runs/${RUN_ID}/answer/queries/0/csv`)
        .expect(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="query-1-a1b2c3d4.csv"',
      );
      expect(res.headers['x-rows-cut']).toBe('50000');
      const lines = res.text.split('\r\n');
      expect(lines[0]).toBe('product,n');
      expect(lines[1]).toBe('"say ""hi"", ok",0');
      expect(lines).toHaveLength(50_002);

      await request(server)
        .get(`/workflow-runs/${RUN_ID}/answer/queries/1/csv`)
        .expect(400)
        .expect(({ body }) =>
          expect((body as { message: string }).message).toBe(
            'Query 1 has no SQL to run',
          ),
        );
      await request(server)
        .post(`/workflow-runs/${RUN_ID}/answer/evidence`)
        .expect(201)
        .expect(({ body }) => expect((body as { ok: boolean }).ok).toBe(true));
    } finally {
      await app.close();
    }
  });
});

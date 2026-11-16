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
import { fallbackExplanation } from '../../mastra/agents/query-explainer.prompts';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import type { DatasourcesService } from '../datasources/datasources.service';
import type { ChatMessage } from '../sessions/entities/session.entity';
import { QueryEvidenceService } from '../sessions/query-evidence/query-evidence.service';
import type {
  QueryEvidence,
  QueryExplanation,
} from '../sessions/query-evidence/query-evidence.types';
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
      rows: [{ product: 'secret-product', n: 9 }],
      rowCount: 100,
      rationale: 'Which products come back most',
    },
    { tool: 'run_readonly_sql', input: 'SELECT nope', error: 'no column' },
    { tool: 'sample_rows', input: 'shop.public.returns', rowCount: 10 },
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

const SQL_ALL = 'SELECT COUNT(*) AS n FROM shop.public.returns';
const SQL_KEPT =
  "SELECT COUNT(*) AS n FROM shop.public.returns WHERE reason = 'x'";
const SQL_GROUPED =
  "SELECT COUNT(DISTINCT product) AS n FROM shop.public.returns WHERE reason = 'x'";

/** What the model answered: a start, a keep, a group and a sort. */
function modelSteps(patch: { keep?: string; foreign?: boolean } = {}) {
  return explanation([
    {
      verb: 'start',
      text: 'All returns',
      table: 'shop.public.returns',
      countSql: SQL_ALL,
      // explanationOf sets the start's size from the sized tables.
      rows: 48912,
    },
    {
      verb: 'keep',
      text: 'Only the ones with a reason',
      countSql: patch.foreign
        ? 'SELECT COUNT(*) AS n FROM shop.public.users'
        : (patch.keep ?? SQL_KEPT),
    },
    { verb: 'group', text: 'By product', countSql: SQL_GROUPED },
    { verb: 'sort', text: 'Most first', countSql: SQL_GROUPED },
  ]);
}

function explanation(
  steps: {
    verb: string;
    text: string;
    table?: string;
    countSql?: string;
    rows?: number;
  }[],
): QueryExplanation {
  return {
    steps: [
      ...steps.map((s) => ({ ...s, unit: 'rows' })),
      { verb: 'show', text: 'Show the first 100', unit: 'rows', rows: 100 },
    ] as QueryExplanation['steps'],
    at: '2026-11-15T10:05:00.000Z',
  };
}

function build(counts: Record<string, number> = {}) {
  const table: Record<string, number> = {
    'SELECT COUNT(*) AS n FROM "public"."returns"': 48912,
    [SQL_ALL]: 48912,
    [SQL_KEPT]: 11306,
    [SQL_GROUPED]: 1870,
    ...counts,
  };
  const runReadOnlySql = jest.fn((_id: string, sql: string) =>
    sql in table
      ? Promise.resolve({ columns: ['n'], rows: [{ n: table[sql] }] })
      : Promise.reject(new Error(`unexpected statement: ${sql}`)),
  );
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
    { runReadOnlySql } as unknown as DatasourcesService,
  );
  const explainQuery = jest.fn(
    async (input: { record: unknown; evidence: QueryEvidence }) => {
      void input;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return modelSteps();
    },
  );
  const db = new BetterSqlite3(':memory:');
  const repository = new WorkflowRunsRepository(
    new SqliteDocStore(db, 'workflow_runs'),
  );
  const service = new WorkflowRunsService(
    {} as never,
    {
      toView: jest.fn(() => Promise.resolve({ panelItems: [] })),
    } as unknown as SessionsService,
    {} as never,
    { explainQuery } as never,
    repository,
    new WorkflowNodeChatsRepository(
      new SqliteDocStore(db, 'workflow_run_node_chats'),
    ),
    queryEvidence,
    // No stored artifact: no workflow here takes one.
    { list: () => Promise.resolve([]) } as never,
  );
  return { service, repository, runReadOnlySql, explainQuery };
}

const storedEvidence = async (ctx: ReturnType<typeof build>, i = 0) =>
  (await ctx.repository.get(RUN_ID))?.answer?.evidence?.[i];

describe('Workflow runs: explain a query (api.md 140)', () => {
  it('stores the explanation once; a second call makes no model request', async () => {
    const ctx = build();
    await ctx.repository.insert(runDoc());

    const run = await ctx.service.explainQuery(RUN_ID, 0);
    const again = await ctx.service.explainQuery(RUN_ID, 0);

    expect(ctx.explainQuery).toHaveBeenCalledTimes(1);
    const steps = run.answer?.evidence?.[0].explanation?.steps ?? [];
    expect(steps.map((s) => s.verb)).toEqual([
      'start',
      'keep',
      'group',
      'sort',
      'show',
    ]);
    expect(again.answer?.evidence?.[0].explanation).toEqual(
      run.answer?.evidence?.[0].explanation,
    );
    expect((await storedEvidence(ctx))?.explanation).toBeDefined();
  });

  it('sends the explainer the sized tables, never the rows it can read', async () => {
    const ctx = build();
    await ctx.repository.insert(runDoc());
    await ctx.service.explainQuery(RUN_ID, 0);
    const [{ evidence }] = ctx.explainQuery.mock.calls[0];
    expect(evidence.tables).toEqual([
      { entity: 'shop.public.returns', rows: 48912 },
    ]);
  });

  it('makes one model request for two concurrent calls', async () => {
    const ctx = build();
    await ctx.repository.insert(runDoc());

    const [a, b] = await Promise.all([
      ctx.service.explainQuery(RUN_ID, 0),
      ctx.service.explainQuery(RUN_ID, 0),
    ]);

    expect(ctx.explainQuery).toHaveBeenCalledTimes(1);
    expect(a.answer?.evidence?.[0].explanation).toEqual(
      b.answer?.evidence?.[0].explanation,
    );
  });

  it('explains a sample_rows record by code, with no model call', async () => {
    const ctx = build();
    await ctx.repository.insert(runDoc());

    const run = await ctx.service.explainQuery(RUN_ID, 2);

    expect(ctx.explainQuery).not.toHaveBeenCalled();
    const e = run.answer?.evidence?.[2].explanation;
    expect(e?.fallback).toBeUndefined();
    expect(e?.steps.map((s) => s.text)).toEqual([
      'all the rows of shop.public.returns',
      'Show 10 sample rows',
    ]);
  });

  it('stores code-built steps with fallback and answers 201 when the reply is no JSON object', async () => {
    const ctx = build();
    ctx.explainQuery.mockImplementation((input) =>
      Promise.resolve(
        fallbackExplanation(input.record as never, input.evidence),
      ),
    );
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
        .post(`/workflow-runs/${RUN_ID}/answer/queries/0/explanation`)
        .expect(201);
      const body = res.body as { ok: boolean; run: { answer: ChatMessage } };
      expect(body.ok).toBe(true);
      expect(body.run.answer.evidence?.[0].explanation?.fallback).toBe(true);

      await request(server)
        .post(`/workflow-runs/${RUN_ID}/answer/queries/0/stage-counts`)
        .expect(201);
      await request(server)
        .post(`/workflow-runs/${RUN_ID}/answer/queries/x/explanation`)
        .expect(400);
    } finally {
      await app.close();
    }
  });

  it('refuses a failed record, an unknown index and a model error', async () => {
    const ctx = build();
    await ctx.repository.insert(runDoc());
    await expect(ctx.service.explainQuery(RUN_ID, 1)).rejects.toThrow(
      'Query 1 has no SQL to explain',
    );
    await expect(ctx.service.explainQuery(RUN_ID, 9)).rejects.toThrow(
      "Query 9 not found in the run's answer",
    );
    ctx.explainQuery.mockRejectedValueOnce(new Error('rate limited'));
    await expect(ctx.service.explainQuery(RUN_ID, 0)).rejects.toThrow(
      'The query could not be explained: rate limited',
    );
    expect((await storedEvidence(ctx))?.explanation).toBeUndefined();
  });
});

describe('Workflow runs: the step counts (api.md 141)', () => {
  const explained = async (ctx: ReturnType<typeof build>) => {
    await ctx.repository.insert(runDoc());
    await ctx.service.explainQuery(RUN_ID, 0);
    ctx.runReadOnlySql.mockClear();
  };

  it('answers 400 "Explain query <index> first" without an explanation', async () => {
    const ctx = build();
    await ctx.repository.insert(runDoc());
    await expect(ctx.service.countQuerySteps(RUN_ID, 0)).rejects.toThrow(
      'Explain query 0 first',
    );
  });

  it('stores the verified counts, then returns them without running anything', async () => {
    const ctx = build();
    await explained(ctx);

    const run = await ctx.service.countQuerySteps(RUN_ID, 0);

    const e = run.answer?.evidence?.[0].explanation;
    expect(e?.stageCounts).toMatchObject({ status: 'verified' });
    expect(e?.steps.map((s) => s.rows)).toEqual([
      48912, 11306, 1870, 1870, 100,
    ]);
    expect(ctx.runReadOnlySql).toHaveBeenCalledTimes(4);

    ctx.runReadOnlySql.mockClear();
    const again = await ctx.service.countQuerySteps(RUN_ID, 0);
    expect(ctx.runReadOnlySql).not.toHaveBeenCalled();
    expect(again.answer?.evidence?.[0].explanation).toEqual(e);
  });

  it('never runs a countSql that names a table the query does not read', async () => {
    const ctx = build();
    ctx.explainQuery.mockResolvedValue(modelSteps({ foreign: true }));
    await explained(ctx);

    const run = await ctx.service.countQuerySteps(RUN_ID, 0);

    expect(ctx.runReadOnlySql).not.toHaveBeenCalled();
    const e = run.answer?.evidence?.[0].explanation;
    expect(e?.stageCounts?.status).toBe('unverified');
    expect(e?.stageCounts?.reason).toContain('shop.public.users');
    // The cheap start and show counts stay; no other step has one.
    expect(e?.steps.map((s) => s.rows)).toEqual([
      48912,
      undefined,
      undefined,
      undefined,
      100,
    ]);
  });

  it('stores unverified with the reason when a check fails', async () => {
    const ctx = build({ [SQL_KEPT]: 99999 });
    await explained(ctx);

    const run = await ctx.service.countQuerySteps(RUN_ID, 0);

    const e = run.answer?.evidence?.[0].explanation;
    expect(e?.stageCounts).toMatchObject({ status: 'unverified' });
    expect(e?.stageCounts?.reason).toMatch(/keep/);
    expect(e?.steps.map((s) => s.rows)).toEqual([
      48912,
      undefined,
      undefined,
      undefined,
      100,
    ]);
  });

  it('stores unverified when a count statement fails', async () => {
    const ctx = build();
    ctx.explainQuery.mockResolvedValue(
      modelSteps({ keep: SQL_KEPT + ' AND 1=1' }),
    );
    await explained(ctx);

    const run = await ctx.service.countQuerySteps(RUN_ID, 0);

    expect(run.answer?.evidence?.[0].explanation?.stageCounts).toMatchObject({
      status: 'unverified',
      reason: expect.stringContaining('unexpected statement') as string,
    });
  });

  it('stores unverified when a step has no countSql, running nothing', async () => {
    const ctx = build();
    const noSql = modelSteps();
    delete noSql.steps[1].countSql;
    ctx.explainQuery.mockResolvedValue(noSql);
    await explained(ctx);

    const run = await ctx.service.countQuerySteps(RUN_ID, 0);

    expect(ctx.runReadOnlySql).not.toHaveBeenCalled();
    expect(run.answer?.evidence?.[0].explanation?.stageCounts?.status).toBe(
      'unverified',
    );
  });

  it('counts nothing for a sample_rows explanation', async () => {
    const ctx = build();
    await ctx.repository.insert(runDoc());
    await ctx.service.explainQuery(RUN_ID, 2);
    ctx.runReadOnlySql.mockClear();

    const run = await ctx.service.countQuerySteps(RUN_ID, 2);

    expect(ctx.runReadOnlySql).not.toHaveBeenCalled();
    expect(run.answer?.evidence?.[2].explanation?.stageCounts?.status).toBe(
      'unverified',
    );
  });
});

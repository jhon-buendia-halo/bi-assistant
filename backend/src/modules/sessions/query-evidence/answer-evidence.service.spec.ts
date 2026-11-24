// The real Mastra instance pulls in ESM-only packages Jest cannot require.
jest.mock('../../../mastra/mastra.service', () => ({
  MastraService: class {},
}));
jest.mock('../../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));

import type { DatasetsRepository } from '../../datasets/repositories/datasets.repository';
import type { DatasourcesService } from '../../datasources/datasources.service';
import type { MastraService } from '../../../mastra/mastra.service';
import type { ChatMessage } from '../entities/session.entity';
import {
  AnswerEvidenceService,
  type AnswerHost,
} from './answer-evidence.service';
import { QueryEvidenceService } from './query-evidence.service';
import type { QueryExplanation } from './query-evidence.types';

const SQL =
  'SELECT product, COUNT(*) AS n FROM shop.public.returns GROUP BY product ORDER BY n DESC LIMIT 100';
const SIZE = 'SELECT COUNT(*) AS n FROM "public"."returns"';
const SQL_ALL = 'SELECT COUNT(*) AS n FROM shop.public.returns';
const PREVIEW =
  'SELECT product, COUNT(*) AS n FROM shop.public.returns GROUP BY product';

const ANSWER: ChatMessage = {
  role: 'assistant',
  content: 'Top products by returns.',
  at: 't',
  data: [
    {
      tool: 'run_readonly_sql',
      input: SQL,
      columns: ['product', 'n'],
      rows: [{ product: 'a', n: 9 }],
      rowCount: 100,
    },
    {
      tool: 'run_readonly_sql',
      input: SQL.replace('returns', 'returns '),
      rowCount: 3,
    },
  ],
};

/** An answer host held in a variable: what it saved, and how often. */
function fakeHost(answer: ChatMessage = ANSWER) {
  const state = { answer, saves: 0 };
  const host: AnswerHost<ChatMessage> = {
    key: 'fake',
    owner: 'fake',
    load: () =>
      Promise.resolve({
        answer: state.answer,
        datasets: ['shop'],
        view: () => Promise.resolve(state.answer),
        save: (next) => {
          state.saves++;
          state.answer = next;
          return Promise.resolve(next);
        },
      }),
  };
  return { host, state };
}

function build() {
  const runReadOnlySql = jest.fn((_id: string, sql: string) => {
    if (sql === SIZE || sql === SQL_ALL) {
      return Promise.resolve({ columns: ['n'], rows: [{ n: 48912 }] });
    }
    return Promise.resolve({
      columns: ['product', 'n'],
      rows: [{ product: 'b', n: 1 }],
    });
  });
  const queryEvidence = new QueryEvidenceService(
    {
      getByNames: jest.fn().mockResolvedValue([
        {
          name: 'shop',
          datasourceId: 'ds-1',
          datasourceKind: 'postgres',
          tables: ['shop.public.returns'],
        },
      ]),
    } as unknown as DatasetsRepository,
    { runReadOnlySql } as unknown as DatasourcesService,
  );
  // The model's steps: the group step has no count statement.
  const modelSteps: QueryExplanation = {
    steps: [
      {
        verb: 'start',
        text: 'All returns',
        unit: 'rows',
        table: 'shop.public.returns',
        countSql: SQL_ALL,
      },
      {
        verb: 'group',
        text: 'By product',
        unit: 'rows',
        previewSql: PREVIEW,
      },
      { verb: 'show', text: 'Show 100', unit: 'rows', rows: 100 },
    ],
    at: 't',
  };
  const explainQuery = jest.fn(() => Promise.resolve(modelSteps));
  const engine = new AnswerEvidenceService(queryEvidence, {
    explainQuery,
  } as unknown as MastraService);
  return { engine, runReadOnlySql, explainQuery };
}

describe('AnswerEvidenceService: the engine on any answer host (plan section 5)', () => {
  it('prepare sizes each table once, then runs nothing and writes nothing', async () => {
    const ctx = build();
    const { host, state } = fakeHost();

    const prepared = await ctx.engine.prepare(host);
    expect(prepared.evidence?.[0].tables).toEqual([
      { entity: 'shop.public.returns', rows: 48912 },
    ]);
    expect(ctx.runReadOnlySql).toHaveBeenCalledTimes(1);
    expect(state.saves).toBe(1);

    await ctx.engine.prepare(host);
    expect(ctx.runReadOnlySql).toHaveBeenCalledTimes(1);
    expect(state.saves).toBe(1);
  });

  it('explain is stored once: a second call, and a concurrent one, make no model request', async () => {
    const ctx = build();
    const { host, state } = fakeHost();

    const [a, b] = await Promise.all([
      ctx.engine.explain(host, 0),
      ctx.engine.explain(host, 0),
    ]);
    const again = await ctx.engine.explain(host, 0);

    expect(ctx.explainQuery).toHaveBeenCalledTimes(1);
    expect(a.evidence?.[0].explanation).toBeDefined();
    expect(b.evidence?.[0].explanation).toEqual(a.evidence?.[0].explanation);
    expect(again.evidence?.[0].explanation).toEqual(
      state.answer.evidence?.[0].explanation,
    );
  });

  it('counts the host does not verify store no count, only the reason', async () => {
    const ctx = build();
    const { host, state } = fakeHost();
    await ctx.engine.explain(host, 0);

    const counted = await ctx.engine.countSteps(host, 0);

    const e = counted.evidence?.[0].explanation;
    expect(e?.stageCounts).toMatchObject({
      status: 'unverified',
      reason: 'Step 2 (group) has no count statement',
    });
    expect(e?.steps.filter((s) => s.verb === 'group')[0].rows).toBeUndefined();
    expect(state.answer.evidence?.[0].explanation?.stageCounts?.status).toBe(
      'unverified',
    );
  });

  it("previews a step once: its statement's first rows, stored on the step; then no query", async () => {
    const ctx = build();
    const { host, state } = fakeHost();
    await ctx.engine.explain(host, 0);
    ctx.runReadOnlySql.mockClear();

    const previewed = await ctx.engine.previewStep(host, 0, 1);
    const step = previewed.evidence?.[0].explanation?.steps[1];
    expect(ctx.runReadOnlySql).toHaveBeenCalledWith('ds-1', PREVIEW, 10);
    expect(step?.preview).toMatchObject({
      columns: ['product', 'n'],
      rows: [{ product: 'b', n: 1 }],
      more: false,
    });
    expect(step?.preview?.check).toBeUndefined();
    expect(state.answer.evidence?.[0].explanation?.steps[1].preview).toEqual(
      step?.preview,
    );

    await ctx.engine.previewStep(host, 0, 1);
    expect(ctx.runReadOnlySql).toHaveBeenCalledTimes(1);
  });

  it('refuses a preview before the explanation, for the show step, a step without a statement, or one reading another table', async () => {
    const ctx = build();
    const { host, state } = fakeHost();
    await expect(ctx.engine.previewStep(host, 0, 1)).rejects.toThrow(
      'Explain query 0 first',
    );
    await ctx.engine.explain(host, 0);
    await expect(ctx.engine.previewStep(host, 0, 2)).rejects.toThrow(
      'Query 0 has no step 2',
    );
    // The model's start step had none; an older explanation has none at all.
    const explanation = state.answer.evidence![0].explanation!;
    state.answer = {
      ...state.answer,
      evidence: [
        {
          ...state.answer.evidence![0],
          explanation: {
            ...explanation,
            steps: [
              { ...explanation.steps[0], previewSql: undefined },
              {
                ...explanation.steps[1],
                previewSql: 'SELECT * FROM shop.public.orders',
              },
              explanation.steps[2],
            ],
          },
        },
        ...state.answer.evidence!.slice(1),
      ],
    };
    await expect(ctx.engine.previewStep(host, 0, 0)).rejects.toThrow(
      'Step 1 has no preview: explain the query again',
    );
    await expect(ctx.engine.previewStep(host, 0, 1)).rejects.toThrow(
      'Step 2 reads shop.public.orders, which the query does not read',
    );
  });

  it('explains a query again on refresh: one more model request, the new steps stored', async () => {
    const ctx = build();
    const { host } = fakeHost();
    await ctx.engine.explain(host, 0);
    await ctx.engine.explain(host, 0, true);
    expect(ctx.explainQuery).toHaveBeenCalledTimes(2);
  });

  it('re-run returns rows and stores nothing', async () => {
    const ctx = build();
    const { host, state } = fakeHost();

    const result = await ctx.engine.rerun(host, 0);

    expect(result.rows).toEqual([{ product: 'b', n: 1 }]);
    expect(state.saves).toBe(0);
    expect(state.answer).toBe(ANSWER);
  });

  it('names the host in its 400s: an index the answer does not have', async () => {
    const ctx = build();
    const { host } = fakeHost();
    await expect(ctx.engine.explain(host, 7)).rejects.toThrow(
      "Query 7 not found in the fake's answer",
    );
    await expect(ctx.engine.exportRows(host, 7)).rejects.toThrow(
      "Query 7 not found in the fake's answer",
    );
  });

  it('serialises two writes on one key, in call order', async () => {
    const ctx = build();
    const order: string[] = [];
    await Promise.all([
      ctx.engine.withLock('k', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('first');
      }),
      ctx.engine.withLock('k', () => {
        order.push('second');
        return Promise.resolve();
      }),
    ]);
    expect(order).toEqual(['first', 'second']);
  });
});

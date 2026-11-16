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
      { verb: 'group', text: 'By product', unit: 'rows' },
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

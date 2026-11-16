// The real Mastra instance and the sessions service pull in ESM-only
// packages Jest cannot require; the session reads are faked over a real
// sessions store below.
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('./sessions.service', () => ({ SessionsService: class {} }));

import { NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import BetterSqlite3 from 'better-sqlite3';
import request from 'supertest';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { MastraService } from '../../mastra/mastra.service';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import type { DatasourcesService } from '../datasources/datasources.service';
import type { ChatMessage, SessionDoc } from './entities/session.entity';
import { AnswerEvidenceService } from './query-evidence/answer-evidence.service';
import { QueryEvidenceService } from './query-evidence/query-evidence.service';
import type { QueryExplanation } from './query-evidence/query-evidence.types';
import { SessionsRepository } from './repositories/sessions.repository';
import { SessionEvidenceService } from './session-evidence.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

const SQL =
  'SELECT product, COUNT(*) AS n FROM shop.public.returns GROUP BY product ORDER BY n DESC LIMIT 100';
const SIZE = 'SELECT COUNT(*) AS n FROM "public"."returns"';
const SQL_ALL = 'SELECT COUNT(*) AS n FROM shop.public.returns';
const SESSION_ID = 'b1c2d3e4-0000-4000-8000-000000000000';

const ANSWER: ChatMessage = {
  role: 'assistant',
  content: 'Top products by returns.',
  at: '2026-11-15T10:00:01.000Z',
  data: [
    {
      tool: 'run_readonly_sql',
      input: SQL,
      columns: ['product', 'n'],
      rows: [{ product: 'a', n: 9 }],
      rowCount: 100,
    },
    { tool: 'run_readonly_sql', input: 'SELECT nope', error: 'no column' },
  ],
};

const SESSION: SessionDoc = {
  id: SESSION_ID,
  name: 'Returns',
  datasets: ['shop'],
  messages: [
    {
      role: 'user',
      content: 'Which products?',
      at: '2026-11-15T10:00:00.000Z',
    },
    ANSWER,
    { role: 'assistant', content: 'No queries here.', at: 't' },
  ],
};

const EXPLANATION: QueryExplanation = {
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

async function build() {
  const db = new BetterSqlite3(':memory:');
  const repository = new SessionsRepository(
    new SqliteDocStore<SessionDoc>(db, 'sessions'),
  );
  // The sessions service's read rule and write, over the real store.
  const sessions = {
    get: jest.fn(async (id: string) => {
      const found = await repository.get(id);
      if (!found) throw new NotFoundException(`Session ${id} not found`);
      return found;
    }),
    toView: jest.fn((session: SessionDoc) => Promise.resolve(session)),
    saveMessage: jest.fn(
      async (id: string, index: number, message: ChatMessage) => {
        const found = (await repository.get(id)) as SessionDoc;
        await repository.updateMessages(
          id,
          found.messages.map((m, i) => (i === index ? message : m)),
        );
      },
    ),
  };
  const runReadOnlySql = jest.fn((_id: string, sql: string) =>
    sql === SIZE || sql === SQL_ALL
      ? Promise.resolve({ columns: ['n'], rows: [{ n: 48912 }] })
      : Promise.resolve({
          columns: ['product', 'n'],
          rows: [{ product: 'b', n: 1 }],
        }),
  );
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
  const explainQuery = jest.fn(() => Promise.resolve(EXPLANATION));
  const engine = new AnswerEvidenceService(queryEvidence, {
    explainQuery,
  } as unknown as MastraService);
  const moduleRef = await Test.createTestingModule({
    controllers: [SessionsController],
    providers: [
      { provide: SessionsService, useValue: sessions },
      { provide: AnswerEvidenceService, useValue: engine },
      SessionEvidenceService,
    ],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  await repository.insert(SESSION);
  const stored = async () => (await repository.get(SESSION_ID)) as SessionDoc;
  return {
    app,
    db,
    repository,
    sessions,
    runReadOnlySql,
    explainQuery,
    stored,
  };
}

const base = `/sessions/${SESSION_ID}/messages`;
type Server = Parameters<typeof request>[0];

/** A response body of 144-147, or an error's. */
interface Body {
  ok?: boolean;
  message: ChatMessage;
  result: { rows: unknown[] };
}
const bodyOf = (res: { body: unknown }) => res.body as Body;
const errorOf = (res: { body: unknown }) =>
  (res.body as { message: string }).message;

describe('A past chat hosts the query inspector (api.md 144-148)', () => {
  let ctx: Awaited<ReturnType<typeof build>>;
  beforeEach(async () => {
    ctx = await build();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.db.close();
  });

  it('144 builds the evidence, sizes the table once and writes it into the stored message', async () => {
    const before = (await ctx.stored()).updatedAt;
    // A later write would stamp a later time.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const res = await request(ctx.app.getHttpServer())
      .post(`${base}/1/answer/evidence`)
      .expect(201);

    const body = bodyOf(res);
    expect(body.ok).toBe(true);
    expect(body.message.content).toBe('Top products by returns.');
    expect(body.message.evidence?.[0].tables).toEqual([
      { entity: 'shop.public.returns', rows: 48912 },
    ]);
    const saved = await ctx.stored();
    expect(saved.messages[1].evidence).toEqual(body.message.evidence);
    // The other messages and the chat's place in the list are untouched.
    expect(saved.messages[0]).toEqual(SESSION.messages[0]);
    expect(saved.updatedAt).toBe(before);

    await request(ctx.app.getHttpServer())
      .post(`${base}/1/answer/evidence`)
      .expect(201);
    expect(ctx.runReadOnlySql).toHaveBeenCalledTimes(1);
  });

  it('145 explains once and stores the explanation in the message; 146 stores the unverified counts', async () => {
    const server = ctx.app.getHttpServer() as Server;
    const explained = await request(server)
      .post(`${base}/1/answer/queries/0/explanation`)
      .expect(201);
    await request(server)
      .post(`${base}/1/answer/queries/0/explanation`)
      .expect(201);
    expect(ctx.explainQuery).toHaveBeenCalledTimes(1);
    expect(
      bodyOf(explained).message.evidence?.[0].explanation?.steps,
    ).toHaveLength(3);

    const counted = await request(server)
      .post(`${base}/1/answer/queries/0/stage-counts`)
      .expect(201);
    expect(
      bodyOf(counted).message.evidence?.[0].explanation?.stageCounts,
    ).toMatchObject({
      status: 'unverified',
      reason: 'Step 2 (group) has no count statement',
    });
    const saved = await ctx.stored();
    expect(
      saved.messages[1].evidence?.[0].explanation?.stageCounts?.status,
    ).toBe('unverified');
  });

  it('147 re-runs and stores nothing; 148 sends the CSV', async () => {
    const server = ctx.app.getHttpServer() as Server;
    const rerun = await request(server)
      .post(`${base}/1/answer/queries/0/rerun`)
      .expect(201);
    expect(bodyOf(rerun).ok).toBe(true);
    expect(bodyOf(rerun).result.rows).toEqual([{ product: 'b', n: 1 }]);
    expect((await ctx.stored()).messages[1]).toEqual(ANSWER);

    const csv = await request(server)
      .get(`${base}/1/answer/queries/0/csv`)
      .expect(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.headers['content-disposition']).toBe(
      'attachment; filename="query-1-b1c2d3e4-1.csv"',
    );
    expect(csv.text).toBe('product,n\r\nb,1\r\n');
    expect(ctx.sessions.saveMessage).not.toHaveBeenCalled();
  });

  it('answers the checks of 140-143 with the message named', async () => {
    const server = ctx.app.getHttpServer() as Server;
    const message = async (path: string, method: 'get' | 'post' = 'post') =>
      errorOf(await request(server)[method](`${base}${path}`).expect(400));

    expect(await message('/0/answer/evidence')).toBe(
      'Message 0 has no answer with queries',
    );
    expect(await message('/2/answer/queries/0/explanation')).toBe(
      'Message 2 has no answer with queries',
    );
    expect(await message('/9/answer/queries/0/rerun')).toBe(
      'Message 9 has no answer with queries',
    );
    expect(await message('/x/answer/evidence')).toBe(
      'Message x has no answer with queries',
    );
    expect(await message('/1/answer/queries/5/csv', 'get')).toBe(
      "Query 5 not found in the message's answer",
    );
    expect(await message('/1/answer/queries/1/rerun')).toBe(
      'Query 1 has no SQL to run',
    );
    expect(await message('/1/answer/queries/1/explanation')).toBe(
      'Query 1 has no SQL to explain',
    );
    expect(await message('/1/answer/queries/0/stage-counts')).toBe(
      'Explain query 0 first',
    );
  });

  it('SHALL NOT serve a session the reader cannot read: 404 as GET /sessions/:id answers', async () => {
    const server = ctx.app.getHttpServer() as Server;
    const unknown = '/sessions/nope/messages/1/answer';
    for (const [method, path] of [
      ['post', `${unknown}/evidence`],
      ['post', `${unknown}/queries/0/explanation`],
      ['post', `${unknown}/queries/0/stage-counts`],
      ['post', `${unknown}/queries/0/rerun`],
      ['get', `${unknown}/queries/0/csv`],
      ['get', '/sessions/nope'],
    ] as const) {
      const res = await request(server)[method](path).expect(404);
      expect(errorOf(res)).toBe('Session nope not found');
    }
    expect(ctx.runReadOnlySql).not.toHaveBeenCalled();
  });

  it('GET /sessions/:id derives the evidence of a message stored without it, storing nothing', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get(`/sessions/${SESSION_ID}`)
      .expect(200);
    const [user, answer, plain] = (res.body as SessionDoc).messages;
    expect(user.evidence).toBeUndefined();
    expect(plain.evidence).toBeUndefined();
    expect(answer.evidence).toEqual([
      { index: 0, coverage: 'top-n', outerLimit: 100 },
      { index: 1 },
    ]);
    expect(ctx.runReadOnlySql).not.toHaveBeenCalled();
    expect((await ctx.stored()).messages[1].evidence).toBeUndefined();
  });
});

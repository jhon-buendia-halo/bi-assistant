/**
 * Border cases of Answer a Business Question that need real rows (agents.md
 * 5.11 Validate, Check data quality, Interpret follow-up; api.md 119), end
 * to end on the real Mastra engine and the World Cup Postgres on 55432: the
 * built backend in its own process and data dir, the stub model scripted
 * per step, and Analyse's queries run for real, so Validate judges real
 * results (cut at the row limit, an arbitrary sample, empty, repaired).
 *
 * Skips, visibly, when the World Cup Postgres is down
 * (`docker compose up -d postgres`).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import {
  messageText,
  startLlmStub,
  STUB_ANSWER,
  type LlmStub,
  type StubReply,
  type StubRequest,
} from '../../frontend/e2e/helpers/llm-stub';
import { type Backend, boot, stop } from './backend-process';
import {
  isAnalyseRequest,
  isPlanRequest,
  isWriteAnswerRequest,
  useV2Steps,
} from './v2-stub';
import { runClient, type StoredRun } from './workflow-run-client';
import {
  WORLD_CUP_CONNECTION,
  runSql,
  worldCupIsUp,
  worldCupPool,
} from './world-cup';

const dataDir = mkdtempSync(join(tmpdir(), 'qti-abq-live-'));
const WORKFLOW = 'answer-business-question';
const DATASET = 'World Cup Live';
const MATCHES = 'world_cup.world_cup.matches';
const COUNT_SQL = `SELECT COUNT(*) AS matches FROM ${MATCHES}`;

jest.setTimeout(180_000);

const describeLive = worldCupIsUp() ? describe : describe.skip;

/** One `run_readonly_sql` call as the model sends it. */
interface SqlCall {
  sql: string;
  limit?: number;
}

/** Whether a request is the `sql-fixer`'s (sql-checks.ts `repairSql`). */
const isFixerRequest = (req: StubRequest) =>
  req.messages.some(
    (m) =>
      m.role === 'system' &&
      messageText(m).startsWith('You repair a single SQL statement'),
  );

/** How many tool results came back since the turn's last user message. */
function toolResultsThisTurn(req: StubRequest): number {
  let count = 0;
  for (const message of [...req.messages].reverse()) {
    if (message.role === 'user') break;
    if (message.role === 'tool') count += 1;
  }
  return count;
}

/**
 * Script Analyse per attempt: attempt `n` (its n-th turn) runs
 * `attempts[n - 1]`'s queries in order (the last list again for any later
 * attempt), then answers. Every other agent call answers `STUB_ANSWER`.
 */
function analyse(attempts: SqlCall[][]) {
  let turns = 0;
  return (req: StubRequest): StubReply => {
    if (!isAnalyseRequest(req)) return { text: STUB_ANSWER };
    const done = toolResultsThisTurn(req);
    if (done === 0 && req.messages.at(-1)?.role !== 'tool') turns += 1;
    const calls = attempts[Math.min(turns, attempts.length) - 1];
    const next = calls[done];
    return next
      ? {
          toolCall: {
            name: 'run_readonly_sql',
            arguments: { ...next, rationale: 'Answer from the matches.' },
          },
        }
      : { text: STUB_ANSWER };
  };
}

/** The stored step `id` of attempt `attempt` (or the only one). */
const stepOf = (run: StoredRun, id: string, attempt?: number) =>
  run.steps.find(
    (step) =>
      step.id === id && (attempt === undefined || step.attempt === attempt),
  );

/** Validate's finding `check` of attempt `attempt`. */
const finding = (run: StoredRun, attempt: number, check: string) =>
  (
    stepOf(run, 'validate', attempt)?.output as
      | { findings?: { check: string; passed: boolean; detail: string }[] }
      | undefined
  )?.findings?.find((f) => f.check === check);

describeLive(
  'Answer a Business Question: border cases on real rows (API, World Cup Postgres)',
  () => {
    let backend: Backend | undefined;
    let stub: LlmStub;
    let totalMatches = 0;
    const http = () => request.agent(backend!.url);
    const client = runClient(() => backend!.url);
    const ask = (
      question: string,
      extra: Record<string, unknown> = {},
      context?: { fromRunId: string },
    ) =>
      client.run(WORKFLOW, {
        input: { question, datasets: [DATASET], ...extra },
        ...(context ? { context } : {}),
      });

    /** The model requests `act` made, in order. */
    const recorded = async <T>(act: () => Promise<T>) => {
      const from = stub.requests.length;
      const result = await act();
      return { result, requests: stub.requests.slice(from) };
    };

    beforeAll(async () => {
      const pool = worldCupPool();
      try {
        const [row] = await runSql(pool, COUNT_SQL);
        totalMatches = Number(row['matches']);
      } finally {
        await pool.end();
      }
      expect(totalMatches).toBeGreaterThan(10);
      stub = await startLlmStub();
      useV2Steps(stub, () => ({ text: STUB_ANSWER }));
      backend = await boot(dataDir);
      expect(
        (
          await http().put('/llm/settings').send({
            provider: 'lenai',
            model: 'stub-deployment',
            baseUrl: stub.baseUrl,
            apiKey: 'sk-stub',
          })
        ).body,
      ).toMatchObject({ ok: true });
      const source = (
        await http()
          .post('/datasources')
          .send({
            kind: 'postgres',
            name: 'World Cup',
            config: { ...WORLD_CUP_CONNECTION, ssl: false },
          })
      ).body as { ok: boolean; message: string; datasource: { id: string } };
      expect(source).toMatchObject({ ok: true });
      expect(
        (
          await http()
            .post('/datasets')
            .send({
              name: DATASET,
              tables: [MATCHES],
              entities: [
                {
                  key: MATCHES,
                  columns: [
                    { name: 'match_number', type: 'integer', nullable: false },
                  ],
                },
              ],
              datasourceId: source.datasource.id,
              datasourceKind: 'postgres',
            })
        ).body,
      ).toMatchObject({ ok: true });
    });

    afterEach(() => {
      stub.intercept = undefined;
      stub.explore = () => ({
        action: 'new-question',
        query: null,
        filters: [],
        sort: [],
        page: { move: 'keep', to: null },
        understood: 'A new question',
      });
      useV2Steps(stub, () => ({ text: STUB_ANSWER }));
    });

    afterAll(async () => {
      await stop(backend);
      await stub?.close();
      rmSync(dataDir, { recursive: true, force: true });
    });

    describe('Validate on real results (one attempt when it passes, a second when it does not)', () => {
      it('a whole aggregate passes in one attempt, and Wrap up counts its real rows', async () => {
        useV2Steps(stub, analyse([[{ sql: COUNT_SQL }]]));
        const res = await ask('How many matches were played?');
        const run = res.run!;
        expect(run).toMatchObject({
          status: 'success',
          output: { sqlQueries: 1, failedQueries: 0, rows: 1 },
        });
        expect(res.steps).toContain('validate:success:1');
        expect(res.steps).not.toContain('analyse:running:2');
        expect(stepOf(run, 'validate', 1)?.output).toMatchObject({ ok: true });
        const calls = stepOf(run, 'analyse', 1)?.toolCalls ?? [];
        expect(calls).toEqual([
          expect.objectContaining({ tool: 'run_readonly_sql', rowCount: 1 }),
        ]);
      });

      it('a statement the read-only guard refuses, then a good one, passes in one attempt', async () => {
        useV2Steps(
          stub,
          analyse([[{ sql: `DELETE FROM ${MATCHES}` }, { sql: COUNT_SQL }]]),
        );
        const res = await ask('How many matches? (after a refused write)');
        const run = res.run!;
        expect(run.status).toBe('success');
        expect(res.steps).not.toContain('analyse:running:2');
        expect(finding(run, 1, 'No unresolved tool error')).toMatchObject({
          passed: true,
          detail: 'Every failed call was followed by a successful one.',
        });
        expect(run.output).toMatchObject({ sqlQueries: 2, failedQueries: 1 });
        // The data is untouched.
        const pool = worldCupPool();
        try {
          const [row] = await runSql(pool, COUNT_SQL);
          expect(Number(row['matches'])).toBe(totalMatches);
        } finally {
          await pool.end();
        }
      });

      it('a statement the engine rejects is repaired by the SQL fixer and runs in the same attempt', async () => {
        useV2Steps(
          stub,
          analyse([
            [
              {
                sql: `SELECT COUNT(*) AS matches FROM ${MATCHES} WHERE no_such_column > 0`,
              },
            ],
          ]),
        );
        stub.intercept = (req) =>
          isFixerRequest(req)
            ? req.tools.includes('json') && req.messages.at(-1)?.role !== 'tool'
              ? { toolCall: { name: 'json', arguments: { sql: COUNT_SQL } } }
              : { text: JSON.stringify({ sql: COUNT_SQL }) }
            : undefined;
        const { result: res, requests } = await recorded(() =>
          ask('How many matches? (with a typo)'),
        );
        const run = res.run!;
        expect(requests.filter(isFixerRequest).length).toBeGreaterThan(0);
        expect(run).toMatchObject({
          status: 'success',
          output: { sqlQueries: 1, failedQueries: 0, rows: 1 },
        });
        expect(res.steps).not.toContain('analyse:running:2');
      });

      it('a result cut at its row limit fails Validate; the second attempt aggregates and passes', async () => {
        useV2Steps(
          stub,
          analyse([
            [
              {
                sql: `SELECT match_number FROM ${MATCHES} ORDER BY match_number`,
                limit: 5,
              },
            ],
            [{ sql: COUNT_SQL }],
          ]),
        );
        const res = await ask('How many matches? (cut)');
        const run = res.run!;
        expect(run.status).toBe('success');
        expect(finding(run, 1, 'No result cut at its row limit')).toMatchObject(
          {
            passed: false,
          },
        );
        expect(stepOf(run, 'validate', 1)?.output).toMatchObject({ ok: false });
        expect(stepOf(run, 'validate', 2)?.output).toMatchObject({ ok: true });
        // The retry was told why.
        expect(stepOf(run, 'analyse', 2)?.input).toMatchObject({
          findings: expect.arrayContaining([
            expect.objectContaining({
              check: 'No result cut at its row limit',
              passed: false,
            }),
          ]) as unknown,
        });
        // Wrap up reads the last attempt.
        expect(run.output).toMatchObject({ sqlQueries: 1, rows: 1 });
      });

      it('an arbitrary sample (a LIMIT with no sort) fails Validate; the second attempt reads the whole data', async () => {
        useV2Steps(
          stub,
          analyse([
            [{ sql: `SELECT match_number FROM ${MATCHES} LIMIT 3` }],
            [{ sql: COUNT_SQL }],
          ]),
        );
        const res = await ask('How many matches? (sampled)');
        const run = res.run!;
        expect(run.status).toBe('success');
        expect(finding(run, 1, 'No answer from a sample')).toMatchObject({
          passed: false,
        });
        expect(finding(run, 2, 'No answer from a sample')).toMatchObject({
          passed: true,
        });
      });

      it('an empty result is a result: it passes in one attempt with no rows', async () => {
        useV2Steps(
          stub,
          analyse([
            [
              {
                sql: `SELECT match_number FROM ${MATCHES} WHERE match_number < 0`,
              },
            ],
          ]),
        );
        const res = await ask('Which matches have a negative number?');
        const run = res.run!;
        expect(run).toMatchObject({
          status: 'success',
          output: { sqlQueries: 1, failedQueries: 0, rows: 0 },
        });
        expect(res.steps).not.toContain('analyse:running:2');
        expect(finding(run, 1, 'Ran a query')).toMatchObject({ passed: true });
      });
    });

    it('Check data quality reviews the table the analysis read, and Write answer gets its findings', async () => {
      useV2Steps(stub, analyse([[{ sql: COUNT_SQL }]]));
      const { result: res, requests } = await recorded(() =>
        ask('How many matches? (quality checked)', { checkDataQuality: true }),
      );
      const run = res.run!;
      expect(run.status).toBe('success');
      expect(res.steps).toEqual(
        expect.arrayContaining([
          'check-data-quality:running',
          'check-data-quality:success',
        ]),
      );
      const checked = stepOf(run, 'check-data-quality')!;
      expect(checked.output).toHaveProperty('dataQuality');
      expect(JSON.stringify(checked.output)).toContain('matches');
      // Write answer runs after the check.
      const order = requests
        .map((req) =>
          isWriteAnswerRequest(req)
            ? 'answer'
            : req.step === 'quality'
              ? 'quality'
              : '',
        )
        .filter(Boolean);
      expect(order.at(-1)).toBe('answer');
    });

    describe('a follow-up over an earlier result (Interpret follow-up, roadmap 1.28.8)', () => {
      /** A first run with one real query to follow up on. */
      const firstRun = async () => {
        useV2Steps(
          stub,
          analyse([
            [
              {
                sql: `SELECT match_number FROM ${MATCHES} ORDER BY match_number`,
              },
            ],
          ]),
        );
        const res = await ask('List the matches by number.');
        expect(res.run?.status).toBe('success');
        useV2Steps(stub, () => ({ text: STUB_ANSWER }));
        return res.run!.id;
      };

      it('"next page" pages the earlier result: no Plan, no Analyse, the explore branch answers', async () => {
        const fromRunId = await firstRun();
        stub.explore = () => ({
          action: 'explore',
          query: null,
          filters: [],
          sort: [],
          page: { move: 'next', to: null },
          understood: 'Page 2',
        });
        const { result: res, requests } = await recorded(() =>
          ask('Show me the next page', {}, { fromRunId }),
        );
        expect(res.run?.status).toBe('success');
        expect(res.steps).toEqual(
          expect.arrayContaining([
            'interpret-follow-up:success',
            'page-result:success',
            'page-answer:success',
          ]),
        );
        expect(res.steps.some((s) => s.startsWith('plan:running'))).toBe(false);
        expect(res.steps.some((s) => s.startsWith('analyse:running'))).toBe(
          false,
        );
        expect(requests.some(isPlanRequest)).toBe(false);
        expect(requests.some(isAnalyseRequest)).toBe(false);
        expect(res.run!.answer?.content).toEqual(expect.any(String));
      });

      it('a new question plans as before', async () => {
        const fromRunId = await firstRun();
        useV2Steps(stub, analyse([[{ sql: COUNT_SQL }]]));
        const { result: res, requests } = await recorded(() =>
          ask('How many matches were there in all?', {}, { fromRunId }),
        );
        expect(res.run?.status).toBe('success');
        expect(res.steps).toContain('plan:success:1');
        expect(res.steps).not.toContain('page-result:running');
        expect(requests.filter(isPlanRequest)).toHaveLength(1);
      });

      it('a model error in Interpret follow-up never fails the run: it plans the question', async () => {
        const fromRunId = await firstRun();
        useV2Steps(stub, analyse([[{ sql: COUNT_SQL }]]));
        stub.intercept = (req) =>
          req.messages.some(
            (m) =>
              m.role === 'system' &&
              messageText(m).startsWith(
                "You turn a user's words about a query's result",
              ),
          )
            ? { status: 400, message: 'The explorer is down.' }
            : undefined;
        const res = await ask('And the next page?', {}, { fromRunId });
        expect(res.run?.status).toBe('success');
        expect(res.steps).toEqual(
          expect.arrayContaining([
            'interpret-follow-up:success',
            'plan:success:1',
            'write-answer:success',
          ]),
        );
        expect(res.steps).not.toContain('page-result:running');
      });
    });
  },
);

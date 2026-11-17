/**
 * Border cases of Answer a Business Question (agents.md 5.11; api.md 118,
 * 119, 138, 150), end to end on the real Mastra engine: the built backend in
 * its own process and data dir, the stub model scripted per step (Plan and
 * Write answer by their instructions' first lines, Analyse and the Image
 * Reader through `reply`, and `intercept` for a failing or malformed reply).
 *
 * Needs no Postgres: the dataset's datasource points at a closed port, so
 * every query Analyse runs fails. The happy path, the clarifying questions
 * and the refusals of a blank input are in workflow-runs.e2e-spec.ts; the
 * border cases that need real rows are in
 * answer-business-question-live.e2e-spec.ts.
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
  stubPlan,
  useV2Steps,
} from './v2-stub';
import { runClient } from './workflow-run-client';

const dataDir = mkdtempSync(join(tmpdir(), 'qti-abq-borders-'));
const WORKFLOW = 'answer-business-question';
const DATASET = 'Closed Core';
const MATCHES = 'world_cup.world_cup.matches';

/** A 1×1 PNG: the smallest image the input check accepts. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

jest.setTimeout(180_000);

/** Whether a request is the Image Reader's (Read images, agents.md 2.15). */
const isImageReaderRequest = (req: StubRequest) =>
  req.messages.some(
    (m) =>
      m.role === 'system' &&
      messageText(m).startsWith('You are the Image Reader.'),
  );

/** A JSON reply as a structured call takes it: through `json` when offered. */
function jsonReply(
  req: StubRequest,
  value: Record<string, unknown>,
): StubReply {
  return req.tools.includes('json') && req.messages.at(-1)?.role !== 'tool'
    ? { toolCall: { name: 'json', arguments: value } }
    : { text: JSON.stringify(value) };
}

/** Analyse runs one query, then answers once the tool's result is back. */
function analyseWithQuery(sql: string) {
  return (req: StubRequest): StubReply =>
    req.messages.at(-1)?.role === 'tool'
      ? { text: STUB_ANSWER }
      : {
          toolCall: {
            name: 'run_readonly_sql',
            arguments: { sql, rationale: 'Count the matches.' },
          },
        };
}

describe('Answer a Business Question: border cases (API, no Postgres)', () => {
  let backend: Backend | undefined;
  let stub: LlmStub;
  const http = () => request.agent(backend!.url);
  const client = runClient(() => backend!.url);
  const ask = (question: string, extra: Record<string, unknown> = {}) =>
    client.run(WORKFLOW, {
      input: { question, datasets: [DATASET], ...extra },
    });

  /** The model requests `act` made, in order. */
  const recorded = async <T>(act: () => Promise<T>) => {
    const from = stub.requests.length;
    const result = await act();
    return { result, requests: stub.requests.slice(from) };
  };

  beforeAll(async () => {
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
          name: 'Closed port',
          config: {
            host: '127.0.0.1',
            port: 1,
            database: 'none',
            user: 'none',
            password: 'none',
            ssl: false,
          },
        })
    ).body as { ok: boolean; datasource: { id: string } };
    expect(source.ok).toBe(true);
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
    stub.hold = undefined;
    useV2Steps(stub, () => ({ text: STUB_ANSWER }));
  });

  afterAll(async () => {
    await stop(backend);
    await stub?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('a model error fails the run at its step; the steps after it do not run', () => {
    it.each([
      ['plan', isPlanRequest],
      ['analyse', isAnalyseRequest],
      ['write-answer', isWriteAnswerRequest],
    ] as const)('%s', async (stepId, isStep) => {
      stub.intercept = (req) =>
        isStep(req)
          ? { status: 400, message: `The model refused the ${stepId} call.` }
          : undefined;
      const res = await ask(`Fail at ${stepId}: how many matches?`);
      expect(res.status).toBe(200);
      const run = res.run ?? (await client.stored(res.frames[0].runId!));
      expect(run.status).toBe('failed');
      expect(run.answer).toBeUndefined();
      const failed = run.steps.filter((step) => step.status === 'failed');
      expect(failed.map((step) => step.id)).toEqual([stepId]);
      // Nothing after the failing step ran.
      const ran = new Set(
        run.steps
          .filter((step) => step.status === 'success')
          .map((step) => step.id),
      );
      const after = {
        plan: ['analyse', 'validate', 'write-answer', 'wrap-up'],
        analyse: ['validate', 'write-answer', 'wrap-up'],
        'write-answer': ['wrap-up'],
      }[stepId];
      for (const id of after) expect(ran.has(id)).toBe(false);
      // The stored run reads the same.
      expect((await client.stored(run.id)).status).toBe('failed');
    });
  });

  it('a Plan reply that is no JSON plans the question as asked, and the run goes on to an answer', async () => {
    const question = 'How many matches were there, roughly?';
    stub.intercept = (req) =>
      isPlanRequest(req) ? { text: 'Sorry, I cannot plan that.' } : undefined;
    const res = await ask(question);
    expect(res.run).toMatchObject({
      status: 'success',
      answer: { content: STUB_ANSWER },
    });
    const plan = res.run!.steps.find((step) => step.id === 'plan')!;
    expect(plan.output).toMatchObject({
      plan: {
        question,
        measures: [],
        needsClarification: false,
        clarification: null,
      },
    });
    expect(res.steps).not.toContain('clarify:suspended:1');
  });

  it('a clarification with fewer than two options is no question: the run does not wait', async () => {
    useV2Steps(stub, () => ({ text: STUB_ANSWER }), {
      plan: () =>
        stubPlan('Which team was best?', {
          needsClarification: true,
          clarification: { question: 'Best by what?', options: ['Wins'] },
        }),
    });
    const res = await ask('Which team was best?');
    expect(res.run?.status).toBe('success');
    expect(res.frames.some((f) => f.type === 'input-required')).toBe(false);
    expect(res.steps).toContain('clarify:skipped');
  });

  it('Plan never asks twice: a plan that asks again after the answer goes on to the analysis', async () => {
    const asking = stubPlan('Which team was most dominant?', {
      needsClarification: true,
      clarification: {
        question: 'Dominant by which measure?',
        options: ['Most wins', 'Most goals'],
      },
    });
    useV2Steps(stub, () => ({ text: STUB_ANSWER }), { plan: () => asking });
    const first = await ask('Which team was most dominant?');
    expect(first.run?.status).toBe('suspended');
    const { result: second, requests } = await recorded(() =>
      client.resume(first.run!.id, { stepId: 'clarify', answer: 'Most wins' }),
    );
    expect(second.status).toBe(200);
    expect(second.run).toMatchObject({
      id: first.run!.id,
      status: 'success',
      answer: { content: STUB_ANSWER },
    });
    expect(second.frames.some((f) => f.type === 'input-required')).toBe(false);
    // Plan ran once more and the run did not wait at Clarify again.
    expect(requests.filter(isPlanRequest)).toHaveLength(1);
    expect(second.steps).toEqual(
      expect.arrayContaining(['plan:success:2', 'write-answer:success']),
    );
    const replanned = second.run!.steps.find(
      (step) => step.id === 'plan' && step.attempt === 2,
    )!;
    expect(replanned.output).toMatchObject({
      plan: { needsClarification: false, clarification: null },
    });
  });

  it('Stop on a run waiting at Clarify stores it stopped as expired; it can no longer be answered', async () => {
    useV2Steps(stub, () => ({ text: STUB_ANSWER }), {
      plan: () =>
        stubPlan('Which team was best?', {
          needsClarification: true,
          clarification: {
            question: 'Best by which measure?',
            options: ['Most wins', 'Most goals'],
          },
        }),
    });
    const waiting = await ask('Which team was best? (stop me)');
    expect(waiting.run?.status).toBe('suspended');
    const runId = waiting.run!.id;
    const stopped = await client.stop(runId);
    expect(stopped.status).toBe(200);
    expect(stopped.body).toMatchObject({
      ok: true,
      message: 'Run stopped',
      run: { id: runId, status: 'stopped', waitingFor: { expired: true } },
    });
    const clarify = stopped.body.run.steps.find((s) => s.id === 'clarify');
    expect(clarify?.status).toBe('stopped');
    const late = await client.resume(runId, {
      stepId: 'clarify',
      answer: 'Most wins',
    });
    // api.md 138: a stopped run that waited reads as expired.
    expect(late.status).toBe(410);
    expect(JSON.parse(late.text)).toMatchObject({
      message:
        'This run can no longer continue — run it again with your answer',
    });
    // Stop is idempotent on an ended run.
    expect((await client.stop(runId)).body).toMatchObject({
      ok: true,
      run: { status: 'stopped' },
    });
  });

  it('a query that fails in both attempts still ends in an answer, with Validate saying why', async () => {
    useV2Steps(
      stub,
      analyseWithQuery(`SELECT COUNT(*) AS matches FROM ${MATCHES}`),
    );
    const { result: res, requests } = await recorded(() =>
      ask('How many matches? (the database is down)'),
    );
    expect(res.run).toMatchObject({
      status: 'success',
      answer: { content: STUB_ANSWER },
      output: { sqlQueries: 1, failedQueries: 1, rows: 0 },
    });
    // Two attempts, each with its failed query, then the answer.
    expect(res.steps).toEqual(
      expect.arrayContaining([
        'analyse:success:1',
        'validate:success:1',
        'analyse:success:2',
        'validate:success:2',
        'write-answer:success',
      ]),
    );
    expect(res.steps).not.toContain('analyse:running:3');
    const validations = res.run!.steps.filter((s) => s.id === 'validate');
    for (const validate of validations) {
      expect(validate.output).toMatchObject({
        ok: false,
        findings: expect.arrayContaining([
          expect.objectContaining({ check: 'Ran a query', passed: false }),
          expect.objectContaining({
            check: 'No unresolved tool error',
            passed: false,
          }),
        ]) as unknown,
      });
    }
    // The retry is told what failed, and Write answer gets the findings.
    const retry = res.run!.steps.find(
      (s) => s.id === 'analyse' && s.attempt === 2,
    )!;
    expect(retry.input).toMatchObject({
      attempt: 1,
      findings: expect.arrayContaining([
        expect.objectContaining({ check: 'No unresolved tool error' }),
      ]) as unknown,
    });
    const writer = requests.filter(isWriteAnswerRequest);
    expect(writer).toHaveLength(1);
    expect(writer[0].messages.map(messageText).join('\n')).toContain(
      'No unresolved tool error',
    );
  });

  it('Check data quality with no query that succeeded runs, says so, and never fails the run', async () => {
    useV2Steps(
      stub,
      analyseWithQuery(`SELECT COUNT(*) AS matches FROM ${MATCHES}`),
    );
    const res = await ask('How many matches? (checked)', {
      checkDataQuality: true,
    });
    expect(res.run?.status).toBe('success');
    expect(res.steps).toEqual(
      expect.arrayContaining([
        'check-data-quality:success',
        'write-answer:success',
      ]),
    );
    expect(res.steps).not.toContain('check-data-quality:skipped');
  });

  describe('reference images (Read images, agents.md 2.15; workflows R35)', () => {
    it('Zoe describes an attached image once, before Receive question, and Plan gets her notes', async () => {
      useV2Steps(stub, (req) =>
        isImageReaderRequest(req)
          ? jsonReply(req, {
              images: [
                {
                  index: 1,
                  kind: 'chart',
                  title: 'Goals by stage',
                  shows: 'A bar chart of goals per tournament stage.',
                  figures: ['Final: 4', 'Semi-final: 7'],
                  text: '',
                },
              ],
            })
          : { text: STUB_ANSWER },
      );
      const { result: res, requests } = await recorded(() =>
        ask('Does the chart match the data?', { images: [PNG] }),
      );
      expect(res.run?.status).toBe('success');
      expect(res.steps.slice(0, 2)).toEqual([
        'read-images:running',
        'read-images:success',
      ]);
      expect(res.run!.input).toMatchObject({
        images: ['inputs/images/1.png'],
      });
      expect(requests.filter(isImageReaderRequest)).toHaveLength(1);
      const plan = requests.find(isPlanRequest)!;
      const planText = plan.messages.map(messageText).join('\n');
      expect(planText).toContain('Goals by stage');
      expect(planText).toContain('Final: 4');
    });

    it('an unreadable Image Reader reply never fails the run: the notes say there is no description', async () => {
      stub.intercept = (req) =>
        isImageReaderRequest(req)
          ? { text: 'I cannot see anything.' }
          : undefined;
      const { result: res, requests } = await recorded(() =>
        ask('What does this chart show?', { images: [PNG] }),
      );
      expect(res.run?.status).toBe('success');
      expect(res.steps).toContain('read-images:success');
      const plan = requests.find(isPlanRequest)!;
      expect(plan.messages.map(messageText).join('\n')).toContain(
        'The Image Reader returned no description.',
      );
    });
  });

  describe('input at its limits, refused before any model call (api.md 118)', () => {
    const NOT_AN_IMAGE = `data:image/png;base64,${Buffer.from('hello').toString('base64')}`;

    it.each([
      [
        'a question one character over 4000',
        { question: 'x'.repeat(4001), datasets: [DATASET] },
        'Question must be at most 4000 characters',
      ],
      [
        'an image whose bytes are no PNG',
        { question: 'Hi', datasets: [DATASET], images: [NOT_AN_IMAGE] },
        'Reference images must be PNG, JPEG or WebP images',
      ],
      [
        'five images',
        {
          question: 'Hi',
          datasets: [DATASET],
          images: [PNG, PNG, PNG, PNG, PNG],
        },
        'Reference images must be at most 4 images',
      ],
      [
        'checkDataQuality that is no boolean',
        { question: 'Hi', datasets: [DATASET], checkDataQuality: 'maybe' },
        'Check data quality: Sarah reviews the tables the analysis used must be true or false',
      ],
    ])('%s', async (_case, input, message) => {
      const before = stub.requests.length;
      const res = await client.run(WORKFLOW, { input });
      expect(res.status).toBe(400);
      expect((JSON.parse(res.text) as { message: string }).message).toBe(
        message,
      );
      expect(stub.requests.length).toBe(before);
    });

    it('a question of exactly 4000 characters runs', async () => {
      const res = await ask(`${'x'.repeat(3990)} how many?`);
      expect(res.status).toBe(200);
      expect(res.run?.status).toBe('success');
    });
  });
});

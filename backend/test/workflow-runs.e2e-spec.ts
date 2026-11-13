/**
 * API-level proof of streamed runs (ADR-0041; api.md 118, 119; agents.md
 * 5.14; workflows R14-R16) of Questions to Insights v2 (`qti-v2-turn`), the
 * one catalogue workflow since 1.23.35: `POST /workflows/:id/runs/stream`
 * runs its steps (Plan, then Clarify or the analysis loop and Write answer),
 * its Analyse step's turn on a run host through the turn engine, so a run
 * asks the stub model for its input with the agent's tools, streams `run`,
 * each `step` with what it received, its output, its times and, in the loop,
 * its attempt, the turn's events and `done { run }`, refuses a bad request
 * (and every removed workflow) with its real status before any stream, and
 * stops when the connection closes. `POST /workflows/:id/runs` (118)
 * answers the stored run.
 *
 * Needs no Postgres: the datasources point at closed ports, and the stub
 * model never calls a tool, so Validate always finds no query and the
 * analysis runs twice (attempts 1 and 2). The stub routes Plan and Write
 * answer by their instructions' first lines (`withV2Steps`). Set
 * `WORKFLOW_RUNS_TRANSCRIPT=<file>` to write
 * the SSE transcript of one v2 run there.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import {
  messageText,
  startLlmStub,
  STUB_ANSWER,
  type LlmStub,
  type StubRequest,
} from '../../frontend/e2e/helpers/llm-stub';
import { type Backend, boot, stop } from './backend-process';
import {
  isAnalyseRequest,
  isPlanRequest,
  stubPlan,
  withV2Steps,
} from './v2-stub';

const dataDir = mkdtempSync(join(tmpdir(), 'qti-workflow-runs-'));

jest.setTimeout(180_000);

interface Frame {
  type: string;
  content?: string;
  runId?: string;
  workflowId?: string;
  id?: string;
  title?: string;
  status?: string;
  attempt?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  run?: {
    id: string;
    workflowId: string;
    status: string;
    steps: {
      id: string;
      status: string;
      attempt?: number;
      input?: Record<string, unknown>;
      startedAt?: string;
      endedAt?: string;
    }[];
    question?: string;
    answer?: { role: string; content: string };
    datasets: string[];
    output?: Record<string, unknown>;
  };
}

/** What a v2 run on the stub model streams: the analysis runs twice. */
const V2_STEP_TRAIL = [
  'receive-question:running',
  'receive-question:success',
  'load-catalog:running',
  'load-catalog:success',
  'plan:running',
  'plan:success',
  'analyse:running:1',
  'analyse:success:1',
  'validate:running:1',
  'validate:success:1',
  'analyse:running:2',
  'analyse:success:2',
  'validate:running:2',
  'validate:success:2',
  'write-answer:running',
  'write-answer:success',
  'wrap-up:running',
  'wrap-up:success',
  // The branch not taken, once the run ended.
  'clarify:skipped',
];

/** A step frame or stored step as `id:status[:attempt]`. */
const trail = (step: { id?: string; status?: string; attempt?: number }) =>
  `${step.id}:${step.status}${step.attempt ? `:${step.attempt}` : ''}`;

/** The frames of an SSE body (api.md 3.1 framing). */
function framesOf(text: string): Frame[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)) as Frame);
}

/**
 * The workspace a turn's file tools are scoped to names its session, so two
 * chats differ there too: `session-<id>` for a chat, `session-run-<id>` for
 * a run (agents.md 5.14). Everything else must be equal.
 */
const WORKSPACE_DIR = /workspaces[\\/]session-[A-Za-z0-9_-]+/g;

/** A model request as the provider sees it, for comparing two turns. */
function asSent(req: StubRequest) {
  return {
    path: req.path,
    stream: req.stream,
    messages: req.messages.map((message) =>
      typeof message.content === 'string'
        ? {
            ...message,
            content: message.content.replace(
              WORKSPACE_DIR,
              'workspaces/session-<host>',
            ),
          }
        : message,
    ),
    tools: req.tools,
    reasoningEffort: req.reasoningEffort,
    model: req.model,
  };
}

describe('Streamed runs of agent workflows (API)', () => {
  let backend: Backend | undefined;
  let stub: LlmStub;
  const http = () => request.agent(backend!.url);
  const transcript: string[] = [];

  /** Every model request `act` made, in order. */
  const recorded = async (act: () => Promise<unknown>) => {
    const from = stub.requests.length;
    await act();
    return stub.requests.slice(from).map(asSent);
  };

  const runStream = async (id: string, body: object) => {
    const res = await fetch(
      `${backend!.url}/workflows/${encodeURIComponent(id)}/runs/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const text = await res.text();
    return { status: res.status, text, frames: framesOf(text) };
  };

  const save = async (path: string, body: object) => {
    const answer = (await http().post(path).send(body)).body as {
      ok: boolean;
      message: string;
      datasource?: { id: string };
    };
    expect({ path, ok: answer.ok, message: answer.message }).toMatchObject({
      ok: true,
    });
    return answer;
  };

  beforeAll(async () => {
    stub = await startLlmStub();
    stub.reply = withV2Steps(stub.reply);
    backend = await boot(dataDir);
    const saved = (
      await http().put('/llm/settings').send({
        provider: 'lenai',
        model: 'stub-deployment',
        baseUrl: stub.baseUrl,
        apiKey: 'sk-stub',
      })
    ).body as { ok: boolean };
    expect(saved).toMatchObject({ ok: true });
    const postgres = await save('/datasources', {
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
    });
    await save('/datasets', {
      name: 'World Cup Core',
      tables: ['world_cup.world_cup.matches'],
      entities: [
        {
          key: 'world_cup.world_cup.matches',
          columns: [{ name: 'match_number', type: 'integer', nullable: false }],
        },
      ],
      datasourceId: postgres.datasource!.id,
      datasourceKind: 'postgres',
    });
    const rest = await save('/datasources', {
      kind: 'rest',
      name: 'Closed REST API',
      config: {
        baseUrl: 'http://127.0.0.1:1',
        auth: { type: 'none' },
        endpoints: [{ name: 'orders', path: '/v1/orders' }],
      },
    });
    await save('/datasets', {
      name: 'Orders API',
      tables: ['rest.api.orders'],
      entities: [
        {
          key: 'rest.api.orders',
          columns: [{ name: 'id', type: 'text', nullable: false }],
        },
      ],
      datasourceId: rest.datasource!.id,
      datasourceKind: 'rest',
    });
  });

  afterAll(async () => {
    await stop(backend);
    await stub?.close();
    rmSync(dataDir, { recursive: true, force: true });
    const file = process.env['WORKFLOW_RUNS_TRANSCRIPT'];
    if (file && transcript.length) writeFileSync(file, transcript.join('\n'));
  });

  it('streams a v2 run: run, its steps each running then done (the analysis twice), the answer, then done with the run', async () => {
    const question = 'How many matches were played?';
    const res = await runStream('qti-v2-turn', {
      input: { question, datasets: ['World Cup Core'] },
    });
    expect(res.status).toBe(200);
    const types = res.frames.map((frame) => frame.type);
    expect(types[0]).toBe('run');
    expect(types.at(-1)).toBe('done');
    expect(types).toContain('text');
    expect(res.frames[0]).toMatchObject({ workflowId: 'qti-v2-turn' });
    transcript.push(
      `# POST /workflows/qti-v2-turn/runs/stream  {"input":{"question":"${question}","datasets":["World Cup Core"]}}`,
      res.text,
    );
    const steps = res.frames.filter((frame) => frame.type === 'step');
    expect(steps.map(trail)).toEqual(V2_STEP_TRAIL);
    // Each step frame carries what the step received (Mastra's step-start
    // `payload.payload`): the first the turn's input, the agent step what
    // the catalogue step passed on.
    expect(steps[0].input).toMatchObject({
      question,
      datasets: ['World Cup Core'],
    });
    // The retry got the first attempt's findings.
    const retry = steps.find(
      (step) => step.id === 'analyse' && step.attempt === 2,
    )!;
    expect(retry.input).toMatchObject({
      attempt: 1,
      findings: expect.arrayContaining([
        expect.objectContaining({ check: 'Ran a query', passed: false }),
      ]) as unknown,
    });
    for (const step of steps.filter((s) => s.status !== 'skipped')) {
      expect(step.input).toBeDefined();
      expect(step.startedAt).toEqual(expect.any(String));
    }
    const run = res.frames.at(-1)!.run!;
    expect(run).toMatchObject({
      id: res.frames[0].runId,
      workflowId: 'qti-v2-turn',
      status: 'success',
      question,
      datasets: ['World Cup Core'],
      answer: { role: 'assistant', content: STUB_ANSWER },
      output: {
        sqlQueries: 0,
        failedQueries: 0,
        rows: 0,
        answer: STUB_ANSWER,
      },
    });
    // The run is never listed with the sessions.
    const sessions = (
      (await http().get('/sessions').expect(200)).body as {
        sessions: { id: string }[];
      }
    ).sessions;
    expect(sessions.some((session) => session.id.includes(run.id))).toBe(false);
  });

  it('each step frame and the stored run carry what the step received, its output and its times', async () => {
    const question = 'Who won the 2002 World Cup?';
    const res = await runStream('qti-v2-turn', {
      input: { question, datasets: ['World Cup Core'] },
    });
    const steps = res.frames.filter(
      (frame) => frame.type === 'step' && frame.status !== 'skipped',
    );
    // A running frame carries the input and the start; its ended frame the
    // same input and start, its output and its end.
    for (let i = 0; i < steps.length; i += 2) {
      const [started, ended] = [steps[i], steps[i + 1]];
      expect(started).toMatchObject({
        status: 'running',
        startedAt: expect.any(String) as string,
      });
      expect(started.input).toBeDefined();
      expect(started).not.toHaveProperty('endedAt');
      expect(ended).toMatchObject({
        id: started.id,
        status: 'success',
        input: started.input,
        startedAt: started.startedAt,
        endedAt: expect.any(String) as string,
      });
      expect(ended.output).toBeDefined();
    }
    // The first step received the run's input.
    expect(steps[0]).toMatchObject({
      id: 'receive-question',
      input: { question, datasets: ['World Cup Core'] },
    });
    const done = res.frames.at(-1)!;
    expect(done.type).toBe('done');
    const stored = (
      await http().get(`/workflow-runs/${done.run!.id}`).expect(200)
    ).body as NonNullable<Frame['run']>;
    expect(stored.steps).toEqual(done.run!.steps);
    // Catalogue order, a retried step's attempts one after the other.
    expect(stored.steps.map(trail)).toEqual([
      'receive-question:success',
      'load-catalog:success',
      'plan:success',
      'clarify:skipped',
      'analyse:success:1',
      'analyse:success:2',
      'validate:success:1',
      'validate:success:2',
      'write-answer:success',
      'wrap-up:success',
    ]);
    stored.steps
      .filter((step) => step.status !== 'skipped')
      .forEach((step) => {
        const frames = steps.filter(
          (frame) => frame.id === step.id && frame.attempt === step.attempt,
        );
        expect(step).toMatchObject({
          input: frames[0].input,
          startedAt: frames[0].startedAt,
          endedAt: frames[1].endedAt,
        });
        expect(Date.parse(step.endedAt!)).toBeGreaterThanOrEqual(
          Date.parse(step.startedAt!),
        );
      });
  });

  it('POST /workflows/qti-v2-turn/runs (118) answers the stored run', async () => {
    const res = await http()
      .post('/workflows/qti-v2-turn/runs')
      .send({
        input: { question: 'Who won in 1998?', datasets: ['World Cup Core'] },
      })
      .expect(200);
    const run = res.body as NonNullable<Frame['run']>;
    expect(run).toMatchObject({
      workflowId: 'qti-v2-turn',
      status: 'success',
      question: 'Who won in 1998?',
      answer: { content: STUB_ANSWER },
    });
    const stored = (await http().get(`/workflow-runs/${run.id}`).expect(200))
      .body as unknown;
    expect(stored).toEqual(run);
  });

  it("a v2 run stores the workflow's contractHash (117), and every step's output keeps its declared contract", async () => {
    const detail = (await http().get('/workflows/qti-v2-turn').expect(200))
      .body as {
      contractHash: string;
      steps: {
        id: string;
        outputSchema: { properties: object; required: string[] };
      }[];
    };
    const run = (
      await http()
        .post('/workflows/qti-v2-turn/runs')
        .send({
          input: { question: 'Who won in 2002?', datasets: ['World Cup Core'] },
        })
        .expect(200)
    ).body as {
      id: string;
      contractHash?: string;
      steps: { id: string; status: string; output?: Record<string, unknown> }[];
    };
    expect(run.contractHash).toBe(detail.contractHash);
    const stored = (await http().get(`/workflow-runs/${run.id}`).expect(200))
      .body as { contractHash?: string };
    expect(stored.contractHash).toBe(detail.contractHash);
    // Every step on the path ran and passed on exactly the fields its schema
    // requires; Clarify, the branch not taken, was skipped.
    expect(
      run.steps.filter((step) => step.status === 'skipped').map((s) => s.id),
    ).toEqual(['clarify']);
    for (const step of run.steps.filter((s) => s.status !== 'skipped')) {
      const declared = detail.steps.find((entry) => entry.id === step.id)!;
      expect({ id: step.id, status: step.status }).toEqual({
        id: step.id,
        status: 'success',
      });
      expect(Object.keys(step.output ?? {})).toEqual(
        expect.arrayContaining(declared.outputSchema.required),
      );
    }
  });

  it('asks the model with the input last and the agent tools, the same each time', async () => {
    /** The last user message of a request, as the provider read it. */
    const lastUser = (req: ReturnType<typeof asSent>) =>
      messageText([...req.messages].reverse().find((m) => m.role === 'user')!);
    const question = 'Which stadium hosted the final?';
    const input = { question, datasets: ['World Cup Core'] };
    const run = await recorded(() => runStream('qti-v2-turn', { input }));
    // Plan, Analyse twice, Write answer: Plan and Write answer without tools.
    expect(run.length).toBe(4);
    const analyse = run.filter((req) => req.tools && req.tools.length > 0);
    expect(analyse).toHaveLength(2);
    expect(lastUser(analyse[0])).toContain(question);
    expect(run[0].tools ?? []).toEqual([]);
    expect(run[3].tools ?? []).toEqual([]);
    // Two runs of the same input send the model the same request.
    const again = await recorded(() => runStream('qti-v2-turn', { input }));
    expect(again).toEqual(run);
  });

  it("a follow-up run sends the earlier run's question and answer first", async () => {
    const first = await runStream('qti-v2-turn', {
      input: { question: 'Who hosted in 2002?', datasets: ['World Cup Core'] },
    });
    const runId = first.frames[0].runId!;
    const sent = await recorded(() =>
      runStream('qti-v2-turn', {
        input: { question: 'And in 2006?', datasets: ['World Cup Core'] },
        context: { fromRunId: runId },
      }),
    );
    const turn = sent.find(isAnalyseRequest)!;
    const dialogue = turn.messages
      .filter((message) => message.role !== 'system')
      .map((message) => [message.role, messageText(message)]);
    expect(dialogue).toEqual([
      ['user', 'Who hosted in 2002?'],
      ['assistant', STUB_ANSWER],
      ['user', 'And in 2006?'],
    ]);
  });

  it('a v2 run sends the analyst its five tools, its skills and the orientation, metrics, knowledge and catalog blocks, in order', async () => {
    // A dataset of its own, so no other test's requests change.
    const datasourceId = (
      (await http().get('/datasets').expect(200)).body as {
        datasets: { name: string; datasourceId?: string }[];
      }
    ).datasets.find((d) => d.name === 'World Cup Core')!.datasourceId!;
    await save('/datasets', {
      name: 'Analyst Goals',
      tables: ['world_cup.world_cup.goals'],
      entities: [
        {
          key: 'world_cup.world_cup.goals',
          columns: [{ name: 'goal_id', type: 'integer', nullable: false }],
        },
      ],
      datasourceId,
      datasourceKind: 'postgres',
    });
    await save('/metrics', {
      name: 'goals_total',
      label: 'Total goals',
      entity: 'world_cup.world_cup.goals',
      expression: 'COUNT(goal_id)',
      datasourceId,
    });
    await http()
      .post('/datasets/Analyst%20Goals/ontology')
      .send({
        kind: 'instruction',
        name: 'Own goals',
        description: 'Own goals count for the team that benefited.',
      })
      .expect(201);
    const question = 'How many goals were scored in total?';
    const sent = await recorded(() =>
      runStream('qti-v2-turn', {
        input: { question, datasets: ['Analyst Goals'] },
      }),
    );
    const turn = sent.find(isAnalyseRequest)!;
    const dump = process.env['V2_REQUEST_DUMP'];
    if (dump) writeFileSync(dump, JSON.stringify(turn, null, 2));
    expect(turn.tools).toEqual(
      expect.arrayContaining([
        'list_entities',
        'describe_entity',
        'sample_rows',
        'run_readonly_sql',
        'ask_clarification',
      ]),
    );
    for (const absent of [
      'create_visual',
      'show_in_panel',
      'update_workflow',
    ]) {
      expect(turn.tools).not.toContain(absent);
    }
    const system = turn.messages
      .filter((message) => message.role === 'system')
      .map((message) => messageText(message));
    const at = (start: string) =>
      system.findIndex((text) => text.startsWith(start));
    expect(at('You are Questions to Insights v2')).toBe(0);
    const orientation = at('Datasets for this session: Analyst Goals.');
    const metrics = at('Governed metric definitions');
    const knowledge = at('Curated dataset knowledge');
    const catalog = at('Catalog loaded for this turn: 1 entity.');
    const plan = at('Analysis plan for this turn:');
    expect(orientation).toBeGreaterThan(0);
    expect(system[orientation]).toContain(
      'Use describe_entity / sample_rows / run_readonly_sql to inspect and query them.',
    );
    expect(system[metrics]).toContain(
      'Total goals (goals_total) on world_cup.world_cup.goals: COUNT(goal_id)',
    );
    expect(system[knowledge]).toContain('[instruction] Own goals:');
    // The per-turn blocks keep the assistant's order, the catalog last.
    expect(orientation).toBeLessThan(metrics);
    expect(metrics).toBeLessThan(knowledge);
    expect(knowledge).toBeLessThan(catalog);
    // Then the plan (agents.md 5.11).
    expect(plan).toBe(catalog + 1);
    // Its on-demand skills reach the model through the framework's catalog.
    const all = system.join('\n');
    for (const skill of [
      'curated-knowledge',
      'sql-analysis',
      'result-validation',
    ]) {
      expect(all).toContain(skill);
    }
  });

  describe('a clarifying question (agents.md 2.11, 5.11)', () => {
    const ASKED = 'Which team performed best?';
    const CLARIFY = 'Which measure should decide the best team?';

    afterEach(() => {
      stub.reply = withV2Steps(() => ({ text: STUB_ANSWER }));
    });

    it('stops the run at Clarify when the plan needs clarification; picking an option plans the pick with its question', async () => {
      const DOMINANT = 'Which team was the most dominant?';
      stub.reply = withV2Steps(() => ({ text: STUB_ANSWER }), {
        plan: (req) =>
          req.messages.some((m) => messageText(m).includes(DOMINANT)) &&
          !req.messages.some((m) => messageText(m).includes('Most wins'))
            ? stubPlan(DOMINANT, {
                needsClarification: true,
                clarification: {
                  question: 'Dominant by which measure?',
                  options: ['Most wins', 'Most goals — over all matches'],
                },
              })
            : stubPlan('Which team won the most matches?'),
      });
      let runId = '';
      const asked = await recorded(async () => {
        const first = await runStream('qti-v2-turn', {
          input: { question: DOMINANT, datasets: ['World Cup Core'] },
        });
        expect(first.frames.at(-1)!.type).toBe('done');
        const run = first.frames.at(-1)!.run! as NonNullable<Frame['run']> & {
          answer?: { clarification?: unknown };
        };
        expect(run.status).toBe('success');
        expect(run.answer).toMatchObject({
          role: 'assistant',
          content: 'Dominant by which measure?',
          clarification: {
            question: 'Dominant by which measure?',
            options: [
              { label: 'Most wins' },
              { label: 'Most goals', description: 'over all matches' },
            ],
          },
        });
        // Clarify ends the run: nothing after it runs.
        expect(run.steps.map(trail)).toEqual([
          'receive-question:success',
          'load-catalog:success',
          'plan:success',
          'clarify:stopped',
          'analyse:skipped',
          'validate:skipped',
          'write-answer:skipped',
          'wrap-up:skipped',
        ]);
        expect(run.output).toEqual({
          question: 'Dominant by which measure?',
          options: ['Most wins', 'Most goals — over all matches'],
        });
        runId = run.id;
      });
      // Only Plan asked the model: no analysis, no answer written.
      expect(asked.map((req) => isPlanRequest(req as StubRequest))).toEqual([
        true,
      ]);
      // The pick is the next run's question; Plan reads it after the
      // clarifying question.
      const sent = await recorded(async () => {
        const second = await runStream('qti-v2-turn', {
          input: { question: 'Most wins', datasets: ['World Cup Core'] },
          context: { fromRunId: runId },
        });
        expect(second.frames.at(-1)!.run).toMatchObject({
          status: 'success',
          answer: { role: 'assistant', content: STUB_ANSWER },
        });
      });
      const planned = stub.requests.find(
        (req, i) =>
          i >= stub.requests.length - sent.length && isPlanRequest(req),
      )!;
      expect(
        planned.messages
          .filter((message) => message.role !== 'system')
          .map((message) => [
            message.role,
            messageText(message).split('\n')[0],
          ]),
      ).toEqual([
        ['user', DOMINANT],
        ['assistant', 'Dominant by which measure?'],
        ['user', 'Question: Most wins'],
      ]);
    });

    it('stops the run at Analyse with the question and its options; picking an option follows up with the answer', async () => {
      const lastUser = (req: StubRequest) =>
        messageText(
          [...req.messages].reverse().find((m) => m.role === 'user')!,
        );
      stub.reply = withV2Steps((req) =>
        req.stream && lastUser(req) === ASKED
          ? {
              toolCall: {
                name: 'ask_clarification',
                arguments: {
                  question: CLARIFY,
                  options: 'Most wins\nMost goals — scored over all matches',
                },
              },
            }
          : { text: STUB_ANSWER },
      );
      const first = await runStream('qti-v2-turn', {
        input: { question: ASKED, datasets: ['World Cup Core'] },
      });
      expect(first.status).toBe(200);
      const run = first.frames.at(-1)!.run! as NonNullable<Frame['run']> & {
        answer?: { clarification?: unknown };
      };
      expect(first.frames.at(-1)!.type).toBe('done');
      expect(run.status).toBe('success');
      expect(run.answer).toMatchObject({
        role: 'assistant',
        content: CLARIFY,
        clarification: {
          question: CLARIFY,
          options: [
            { label: 'Most wins' },
            { label: 'Most goals', description: 'scored over all matches' },
          ],
        },
      });
      // Analyse ends the run with the question: no answer is written.
      expect(run.steps.map(trail)).toEqual([
        'receive-question:success',
        'load-catalog:success',
        'plan:success',
        'clarify:skipped',
        'analyse:stopped:1',
        'validate:skipped',
        'write-answer:skipped',
        'wrap-up:skipped',
      ]);

      // The pick is the next run's question, with the clarification as context.
      const sent = await recorded(async () => {
        const second = await runStream('qti-v2-turn', {
          input: { question: 'Most wins', datasets: ['World Cup Core'] },
          context: { fromRunId: run.id },
        });
        const done = second.frames.at(-1)!;
        expect(done.type).toBe('done');
        expect(done.run).toMatchObject({
          status: 'success',
          answer: { role: 'assistant', content: STUB_ANSWER },
        });
        expect(done.run!.steps.map(trail)).toEqual([
          'receive-question:success',
          'load-catalog:success',
          'plan:success',
          'clarify:skipped',
          'analyse:success:1',
          'analyse:success:2',
          'validate:success:1',
          'validate:success:2',
          'write-answer:success',
          'wrap-up:success',
        ]);
      });
      const turn = sent.find(isAnalyseRequest)!;
      expect(
        turn.messages
          .filter((message) => message.role !== 'system')
          .map((message) => [message.role, messageText(message)]),
      ).toEqual([
        ['user', ASKED],
        ['assistant', CLARIFY],
        ['user', 'Most wins'],
      ]);
    });
  });

  it("streams only Write answer's text as the run's answer, never Analyse's", async () => {
    stub.reply = withV2Steps(() => ({ text: 'An analysis note.' }), {
      answer: () => 'Written: 64 matches.\n\nHow I got this: one count.',
    });
    try {
      const res = await runStream('qti-v2-turn', {
        input: {
          question: 'How many matches in all?',
          datasets: ['World Cup Core'],
        },
      });
      const text = res.frames
        .filter((frame) => frame.type === 'text')
        .map((frame) => frame.content)
        .join('');
      expect(text).toBe('Written: 64 matches.\n\nHow I got this: one count.');
      const run = res.frames.at(-1)!.run!;
      expect(run.answer?.content).toBe(
        'Written: 64 matches.\n\nHow I got this: one count.',
      );
      // Analyse's text stays in its step output, as its note.
      const analyse = run.steps.find((step) => step.id === 'analyse') as {
        output?: { text?: string };
      };
      expect(analyse.output?.text).toBe('An analysis note.');
      const written = run.steps.find((step) => step.id === 'write-answer') as {
        output?: { headline?: string };
      };
      expect(written.output?.headline).toBe('Written: 64 matches.');
    } finally {
      stub.reply = withV2Steps(() => ({ text: STUB_ANSWER }));
    }
  });

  it('closing the connection stops the run: no terminal event, and it has no answer to continue from', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    stub.hold = (req) =>
      req.messages.some((m) => messageText(m).includes('Hold this one'))
        ? held
        : undefined;
    const controller = new AbortController();
    const res = await fetch(
      `${backend!.url}/workflows/qti-v2-turn/runs/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { question: 'Hold this one', datasets: ['World Cup Core'] },
        }),
        signal: controller.signal,
      },
    );
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('"type":"run"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    const runId = framesOf(text)[0].runId!;
    // Wait until the model call is open, then stop.
    const deadline = Date.now() + 10_000;
    while (
      !stub.requests.some((r) =>
        r.messages.some((m) => messageText(m).includes('Hold this one')),
      ) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    controller.abort();
    release();
    stub.hold = undefined;
    // The stopped run is stored without an answer.
    let refusal: { status: number; message?: string } = { status: 0 };
    for (let i = 0; i < 40; i++) {
      const answer = await http()
        .post('/workflows/qti-v2-turn/runs/stream')
        .send({
          input: { question: 'Next', datasets: ['World Cup Core'] },
          context: { fromRunId: runId },
        });
      refusal = {
        status: answer.status,
        message: (answer.body as { message?: string }).message,
      };
      if (refusal.message !== `Run "${runId}" not found`) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(refusal).toEqual({
      status: 400,
      message: `Run "${runId}" has no answer to continue from`,
    });
  });

  describe('refusals before any stream (Style B)', () => {
    const ASK = { question: 'Hi', datasets: ['World Cup Core'] };
    it.each([
      [
        'qti-v2-turn',
        { input: { datasets: ['World Cup Core'] } },
        400,
        'Question is required',
      ],
      [
        'qti-v2-turn',
        { input: { question: 'Hi' } },
        400,
        'Select at least one dataset',
      ],
      [
        'qti-v2-turn',
        { input: { question: 'Hi', datasets: ['Nope'] } },
        400,
        'Dataset "Nope" not found',
      ],
      [
        'qti-v2-turn',
        { input: ASK, context: { fromRunId: 'nope' } },
        400,
        'Run "nope" not found',
      ],
      ['nope', { input: {} }, 404, 'Workflow "nope" not found'],
      // The workflows removed in 1.23.35 are unknown.
      [
        'agent:assistant',
        { input: ASK },
        404,
        'Workflow "agent:assistant" not found',
      ],
      [
        'agent:data-readiness',
        { input: { dataset: 'World Cup Core' } },
        404,
        'Workflow "agent:data-readiness" not found',
      ],
      [
        'seq-text-demo',
        { input: { text: 'Hello' } },
        404,
        'Workflow "seq-text-demo" not found',
      ],
      [
        'deep-analysis',
        { input: ASK },
        404,
        'Workflow "deep-analysis" not found',
      ],
      // The RFP Builder was removed: its workflow is unknown.
      [
        'agent:rfp',
        { input: { message: 'Start', rfpId: 'rfp-1' } },
        404,
        'Workflow "agent:rfp" not found',
      ],
    ])('%s %p answers %d %p', async (id, body, status, message) => {
      const before = stub.requests.length;
      const res = await runStream(id, body);
      expect(res.status).toBe(status);
      expect((JSON.parse(res.text) as { message: string }).message).toBe(
        message,
      );
      expect(stub.requests.length).toBe(before);
    });

    it('a blank question and no datasets answer one JSON 400 with both errors, before any SSE frame; nothing is stored', async () => {
      const history = async () =>
        (
          (await http().get('/workflow-runs').expect(200)).body as {
            runs: { id: string }[];
          }
        ).runs.map((run) => run.id);
      const stored = await history();
      const before = stub.requests.length;
      const res = await fetch(
        `${backend!.url}/workflows/qti-v2-turn/runs/stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: { question: '   ', datasets: [] } }),
        },
      );
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      const text = await res.text();
      expect(text).not.toContain('data:');
      expect(JSON.parse(text)).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Question is required',
        errors: [
          { field: 'question', message: 'Question is required' },
          { field: 'datasets', message: 'Select at least one dataset' },
        ],
      });
      expect(stub.requests.length).toBe(before);
      expect(await history()).toEqual(stored);
    });
  });
});

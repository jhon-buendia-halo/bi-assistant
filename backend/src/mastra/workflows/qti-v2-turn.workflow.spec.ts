// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()`, `.branch()`, `.dountil()` and nested workflows with the
// engine's step events (see it).
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({
    getDatasets: (names: string[]) =>
      Promise.resolve(
        names.map((name) => ({
          name,
          datasourceId: 'ds-pg',
          datasourceKind: 'postgres',
          tables: ['wc.public.matches', 'wc.public.teams'],
          entities: [
            {
              key: 'wc.public.matches',
              columns: [{ name: 'id' }, { name: 'year' }],
            },
          ],
        })),
      ),
  }),
}));

import { RequestContext } from '@mastra/core/request-context';
import type { z } from 'zod';
import { qtiV2TurnWorkflow } from './qti-v2-turn.workflow';
import {
  QTI_V2_TURN_RUNTIME_KEY,
  QTI_V2_TURN_STEPS,
  QTI_V2_TURN_WORKFLOW_ID,
  turnSummaryOf,
  type AnalyseAttempt,
  type QtiV2Plan,
  type QtiV2TurnRuntime,
} from './qti-v2-turn.steps';
import {
  ContractViolationError,
  contractJsonSchema,
} from './workflow-contract';

interface StubNode {
  id: string;
  description?: string;
  inputSchema?: z.ZodCatch<z.ZodType>;
  outputSchema?: z.ZodType;
  entries?: StubEntry[];
}
type StubEntry =
  | { type: 'step'; step: StubNode }
  | { type: 'branch'; pairs: [unknown, StubNode][] }
  | { type: 'dountil'; step: StubNode };

interface StubWorkflow extends StubNode {
  entries: StubEntry[];
  createRun(): Promise<{
    stream(args: { inputData: unknown; requestContext: unknown }): {
      fullStream: AsyncIterable<{
        type: string;
        payload?: { id?: string; status?: string; output?: unknown };
      }>;
      result: Promise<{ status: string; result?: unknown; error?: unknown }>;
    };
  }>;
}

const workflow = qtiV2TurnWorkflow as unknown as StubWorkflow;

/** The leaf steps of a workflow, nested workflows walked depth first. */
function leafSteps(node: StubNode): StubNode[] {
  if (!node.entries) return [node];
  return node.entries.flatMap((entry) =>
    entry.type === 'branch'
      ? entry.pairs.flatMap(([, step]) => leafSteps(step))
      : leafSteps(entry.step),
  );
}

const PLAN: QtiV2Plan = {
  question: 'How many matches are in the data?',
  measures: ['match count'],
  entities: ['wc.public.matches'],
  scope: 'Every match in the data.',
  assumptions: [],
  needsClarification: false,
  clarification: null,
};

const CLARIFYING: QtiV2Plan = {
  ...PLAN,
  needsClarification: true,
  clarification: {
    question: 'Dominant by what measure?',
    options: ['Matches won', 'Goals scored'],
  },
};

const GOOD_ATTEMPT: AnalyseAttempt = {
  calls: [
    { tool: 'list_entities', failed: false },
    { tool: 'run_readonly_sql', rowCount: 1, failed: false },
  ],
  queries: [
    {
      sql: 'SELECT count(*) AS match_count FROM wc.public.matches',
      rationale: 'I count the matches.',
      rows: [{ match_count: 16 }],
      rowCount: 1,
      truncated: false,
    },
  ],
  text: 'There are 16 matches.',
  stopped: false,
};

const FAILED_ATTEMPT: AnalyseAttempt = {
  calls: [{ tool: 'run_readonly_sql', failed: true }],
  queries: [
    {
      sql: 'SELECT nope',
      rows: [],
      rowCount: 0,
      truncated: false,
      error: 'column "nope" does not exist',
    },
  ],
  text: '',
  stopped: false,
};

/** A runtime whose model steps are mocks, each answering as scripted. */
type ScriptedTurn = {
  [K in keyof QtiV2TurnRuntime]: jest.Mock<
    ReturnType<QtiV2TurnRuntime[K]>,
    Parameters<QtiV2TurnRuntime[K]>
  >;
};

/** A runtime whose model steps answer as scripted. */
function runtime(overrides: Partial<QtiV2TurnRuntime> = {}): ScriptedTurn {
  return {
    plan: jest.fn(() => Promise.resolve({ plan: PLAN, stopped: false })),
    clarify: jest.fn(() => Promise.resolve()),
    analyse: jest.fn(() => Promise.resolve(GOOD_ATTEMPT)),
    writeAnswer: jest.fn(() =>
      Promise.resolve({
        answer: {
          headline: 'The data holds 16 matches.',
          answer: 'The data holds 16 matches.\n\nHow I got this: …',
        },
        stopped: false,
      }),
    ),
    ...overrides,
  } as ScriptedTurn;
}

async function run(
  question: string,
  turn: ScriptedTurn | QtiV2TurnRuntime | undefined,
  datasets: unknown = ['World Cup'],
) {
  const requestContext = new RequestContext();
  if (turn) requestContext.set(QTI_V2_TURN_RUNTIME_KEY, turn);
  const output = (await workflow.createRun()).stream({
    inputData: { question, datasets },
    requestContext,
  });
  const events: string[] = [];
  const outputs = new Map<string, unknown>();
  for await (const event of output.fullStream) {
    if (event.payload?.id) {
      events.push(`${event.payload.id}:${event.payload.status}`);
      if (event.type === 'workflow-step-result') {
        outputs.set(event.payload.id, event.payload.output);
      }
    }
  }
  return { events, outputs, result: await output.result };
}

describe('qti-v2-turn workflow (agents.md 5.11, ADR-0034)', () => {
  it('builds the eight catalogue steps, in order, with their titles', () => {
    expect(workflow.id).toBe(QTI_V2_TURN_WORKFLOW_ID);
    expect(leafSteps(workflow).map((s) => [s.id, s.description])).toEqual([
      ['receive-question', 'Receive question'],
      ['load-catalog', 'Load catalog'],
      ['plan', 'Plan'],
      ['clarify', 'Clarify'],
      ['analyse', 'Analyse'],
      ['validate', 'Validate'],
      ['write-answer', 'Write answer'],
      ['wrap-up', 'Wrap up'],
    ]);
  });

  it('is built with .then(), .branch() after Plan, and .dountil() around the analysis attempt', () => {
    expect(workflow.entries.map((entry) => entry.type)).toEqual([
      'step',
      'step',
      'step',
      'branch',
    ]);
    const branch = workflow.entries[3] as Extract<
      StubEntry,
      { type: 'branch' }
    >;
    expect(branch.pairs.map(([, step]) => step.id)).toEqual([
      'clarify',
      'analysis-path',
    ]);
    const path = branch.pairs[1][1];
    expect(path.entries?.map((entry) => entry.type)).toEqual([
      'dountil',
      'branch',
    ]);
    const loop = path.entries![0] as Extract<StubEntry, { type: 'dountil' }>;
    expect(loop.step.id).toBe('analysis-attempt');
    expect(leafSteps(loop.step).map((step) => step.id)).toEqual([
      'analyse',
      'validate',
    ]);
  });

  // The agent's Graph tab draws the catalogue (agents-evals R108): its
  // field names and JSON Schemas must be the built steps' own schemas, in
  // order (agents.md 5.12: one source of truth). The engine sees each
  // declared input schema wrapped so it never refuses (`withContract` does).
  it("matches the step catalogue's ids, fields and JSON Schemas", () => {
    expect(
      leafSteps(workflow).map((step) => ({
        id: step.id,
        input: contractJsonSchema(step.inputSchema!.unwrap(), 'input'),
        output: contractJsonSchema(step.outputSchema!, 'output'),
      })),
    ).toEqual(
      QTI_V2_TURN_STEPS.map((step) => ({
        id: step.id,
        input: step.inputSchema,
        output: step.outputSchema,
      })),
    );
    expect(
      Object.fromEntries(
        QTI_V2_TURN_STEPS.map((step) => [step.id, [step.input, step.output]]),
      ),
    ).toEqual({
      'receive-question': [
        ['question', 'datasets'],
        ['question', 'datasets'],
      ],
      'load-catalog': [
        ['question', 'datasets'],
        ['question', 'catalog', 'columns'],
      ],
      plan: [
        ['question', 'catalog', 'columns'],
        ['question', 'catalog', 'plan'],
      ],
      clarify: [
        ['question', 'catalog', 'plan'],
        ['question', 'options'],
      ],
      analyse: [
        ['question', 'catalog', 'plan', 'attempt', 'findings'],
        [
          'question',
          'catalog',
          'plan',
          'attempt',
          'calls',
          'queries',
          'text',
          'stopped',
        ],
      ],
      validate: [
        [
          'question',
          'catalog',
          'plan',
          'attempt',
          'calls',
          'queries',
          'text',
          'stopped',
        ],
        [
          'ok',
          'attempt',
          'findings',
          'question',
          'catalog',
          'plan',
          'calls',
          'queries',
        ],
      ],
      'write-answer': [
        ['question', 'plan', 'queries', 'findings', 'calls'],
        ['headline', 'answer', 'calls'],
      ],
      'wrap-up': [
        ['answer', 'calls'],
        ['sqlQueries', 'failedQueries', 'rows', 'answer'],
      ],
    });
  });

  it('runs with its inputs validated (validateInputs: true)', () => {
    expect(
      (
        qtiV2TurnWorkflow as unknown as {
          options: { validateInputs?: boolean };
        }
      ).options.validateInputs,
    ).toBe(true);
  });

  it('plans, analyses, validates and writes the answer on a clear question', async () => {
    const turn = runtime();
    const { events, outputs, result } = await run(
      '  How many matches?  ',
      turn,
    );
    expect(events).toEqual([
      'receive-question:running',
      'receive-question:success',
      'load-catalog:running',
      'load-catalog:success',
      'plan:running',
      'plan:success',
      'analysis-path:running',
      'analysis-path.analysis-attempt:running',
      'analysis-path.analysis-attempt.analyse:running',
      'analysis-path.analysis-attempt.analyse:success',
      'analysis-path.analysis-attempt.validate:running',
      'analysis-path.analysis-attempt.validate:success',
      'analysis-path.analysis-attempt:success',
      'analysis-path.answer-path:running',
      'analysis-path.answer-path.write-answer:running',
      'analysis-path.answer-path.write-answer:success',
      'analysis-path.answer-path.wrap-up:running',
      'analysis-path.answer-path.wrap-up:success',
      'analysis-path.answer-path:success',
      'analysis-path:success',
    ]);
    const catalogBlock = [
      'Catalog loaded for this turn: 2 entities.',
      '- wc.public.matches (dataset: World Cup; 2 columns)',
      '- wc.public.teams (dataset: World Cup; ? columns)',
    ].join('\n');
    // Plan also sees each entity's columns (names and types).
    expect(turn.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'How many matches?',
        catalogBlock: [
          catalogBlock,
          '',
          'Columns of each entity (name type):',
          // The stand-in's columns have no type.
          '- wc.public.matches: id, year',
        ].join('\n'),
      }),
    );
    expect(turn.analyse).toHaveBeenCalledTimes(1);
    expect(turn.analyse).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'How many matches?',
        catalogBlock,
        plan: PLAN,
        attempt: 1,
        planBlock: `Analysis plan for this turn:\n${JSON.stringify(PLAN)}`,
      }),
    );
    expect(
      outputs.get('analysis-path.analysis-attempt.validate'),
    ).toMatchObject({ ok: true, attempt: 1 });
    expect(turn.writeAnswer).toHaveBeenCalledWith({
      question: 'How many matches?',
      plan: PLAN,
      queries: GOOD_ATTEMPT.queries,
      findings: expect.arrayContaining([
        expect.objectContaining({ check: 'Ran a query', passed: true }),
      ]) as unknown,
    });
    expect(turn.clarify).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'success',
      result: {
        'analysis-path': {
          'answer-path': {
            sqlQueries: 1,
            failedQueries: 0,
            rows: 1,
            answer: 'The data holds 16 matches.\n\nHow I got this: …',
          },
        },
      },
    });
  });

  it('retries the analysis once when Validate fails, handing it the findings', async () => {
    const turn = runtime({
      analyse: jest
        .fn()
        .mockResolvedValueOnce(FAILED_ATTEMPT)
        .mockResolvedValueOnce(GOOD_ATTEMPT),
    });
    const { events, outputs } = await run('How many matches?', turn);
    expect(
      events.filter((event) => /\.(analyse|validate):/.test(event)),
    ).toEqual([
      'analysis-path.analysis-attempt.analyse:running',
      'analysis-path.analysis-attempt.analyse:success',
      'analysis-path.analysis-attempt.validate:running',
      'analysis-path.analysis-attempt.validate:success',
      'analysis-path.analysis-attempt.analyse:running',
      'analysis-path.analysis-attempt.analyse:success',
      'analysis-path.analysis-attempt.validate:running',
      'analysis-path.analysis-attempt.validate:success',
    ]);
    expect(turn.analyse).toHaveBeenCalledTimes(2);
    const second = turn.analyse.mock.calls[1][0] as unknown as {
      attempt: number;
      planBlock: string;
    };
    expect(second.attempt).toBe(2);
    expect(second.planBlock).toContain(
      'Attempt 1 of this analysis failed validation.',
    );
    expect(second.planBlock).toContain(
      '- Ran a query: None of the 1 SQL query succeeded.',
    );
    expect(
      outputs.get('analysis-path.analysis-attempt.validate'),
    ).toMatchObject({ ok: true, attempt: 2 });
    expect(turn.writeAnswer).toHaveBeenCalledTimes(1);
  });

  it('writes the answer after a second failed attempt, with its findings', async () => {
    const turn = runtime({
      analyse: jest.fn(() => Promise.resolve(FAILED_ATTEMPT)),
    });
    const { result } = await run('How many matches?', turn);
    expect(turn.analyse).toHaveBeenCalledTimes(2);
    expect(turn.writeAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        findings: expect.arrayContaining([
          expect.objectContaining({ check: 'Ran a query', passed: false }),
        ]) as unknown,
      }),
    );
    expect(result.status).toBe('success');
  });

  it('stops at Clarify when the plan needs clarification: no analysis, no answer', async () => {
    const turn = runtime({
      plan: jest.fn(() =>
        Promise.resolve({ plan: CLARIFYING, stopped: false }),
      ),
    });
    const { events, result } = await run('Which team was dominant?', turn);
    expect(events.slice(-2)).toEqual(['clarify:running', 'clarify:bailed']);
    expect(events.some((event) => event.startsWith('analysis-path'))).toBe(
      false,
    );
    expect(turn.clarify).toHaveBeenCalledWith(CLARIFYING.clarification);
    expect(turn.analyse).not.toHaveBeenCalled();
    expect(turn.writeAnswer).not.toHaveBeenCalled();
    // A success with no Wrap up summary (the real engine's result for a
    // bailed branch is `{}`; checked on @mastra/core 1.66, 2026-11-13).
    expect(result.status).toBe('success');
    expect(turnSummaryOf(result.result)).toBeUndefined();
  });

  it('ends the loop and writes no answer when Analyse stops (a stop or ask_clarification)', async () => {
    const turn = runtime({
      analyse: jest.fn(() =>
        Promise.resolve({ ...GOOD_ATTEMPT, stopped: true }),
      ),
    });
    const { events, result } = await run('Go', turn);
    expect(events).toContain('analysis-path.analysis-attempt.analyse:bailed');
    expect(events.some((event) => event.includes('validate'))).toBe(false);
    expect(events.some((event) => event.includes('write-answer'))).toBe(false);
    expect(turn.analyse).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'success',
      result: { 'analysis-path': {} },
    });
  });

  it('ends at Plan when the turn was stopped while it planned', async () => {
    const turn = runtime({
      plan: jest.fn(() => Promise.resolve({ plan: PLAN, stopped: true })),
    });
    const { events, result } = await run('Go', turn);
    expect(events.slice(-2)).toEqual(['plan:running', 'plan:bailed']);
    expect(turn.analyse).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
  });

  it('fails Analyse on an output that breaks its contract, and never writes an answer', async () => {
    const turn = runtime({
      analyse: jest.fn(() =>
        Promise.resolve({
          ...GOOD_ATTEMPT,
          calls: [
            {
              tool: 'run_readonly_sql',
              rowCount: 'many' as unknown as number,
              failed: false,
            },
          ],
        }),
      ),
    });
    const { events, result } = await run('Go', turn);
    expect(events).toContain('analysis-path.analysis-attempt.analyse:failed');
    expect(events.some((event) => event.includes('write-answer'))).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toBeInstanceOf(ContractViolationError);
    expect((result.error as Error).message).toBe(
      'Contract violation in Analyse: calls[0].rowCount Invalid input: expected number, received string',
    );
  });

  it('fails Receive question on a run input that breaks its contract, before any later step', async () => {
    const turn = runtime();
    const { events, result } = await run('Go', turn, 'World Cup');
    expect(events).toEqual([
      'receive-question:running',
      'receive-question:failed',
    ]);
    expect((result.error as Error).message).toBe(
      'Contract violation in Receive question (input): datasets Invalid input: expected array, received string',
    );
    expect(turn.plan).not.toHaveBeenCalled();
  });

  it('no longer fails Receive question on a blank question: the input node refuses it before the run', async () => {
    const { events, result } = await run('   ', runtime());
    expect(events.slice(0, 2)).toEqual([
      'receive-question:running',
      'receive-question:success',
    ]);
    expect(result.status).toBe('success');
  });

  it('fails a model step with its own error', async () => {
    const { events, result } = await run(
      'Go',
      runtime({
        writeAnswer: jest.fn(() => Promise.reject(new Error('model down'))),
      }),
    );
    expect(events).toContain('analysis-path.answer-path.write-answer:failed');
    expect(events.some((event) => event.includes('wrap-up'))).toBe(false);
    expect(result).toMatchObject({ status: 'failed' });
    expect((result.error as Error).message).toBe('model down');
  });

  it('fails Plan when the run has no turn runtime', async () => {
    const { result } = await run('Go', undefined, []);
    expect(result.status).toBe('failed');
    expect((result.error as Error).message).toBe(
      'The Plan step has no turn to run',
    );
  });
});

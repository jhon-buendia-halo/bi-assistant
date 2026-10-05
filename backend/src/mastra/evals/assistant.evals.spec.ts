/**
 * The parity harness, with the production turn and the judge faked.
 *
 * `SessionsService.runTurn` is a jest fake returning `TurnResult`-shaped
 * objects, so nothing here calls a model: what is under test is everything
 * the harness does around a turn — a fresh session per attempt, grading the
 * FINAL text, the result-set check on the final SQL, the judge's retry, the
 * verdict matrix, timeouts, stopping and the pass^k fold.
 *
 * The judge agent is mocked (loading it pulls in Mastra core, whose ESM-only
 * dependencies Jest cannot require); its output schema is rebuilt with zod so
 * the harness's parsing runs for real.
 */
jest.mock('../agents/eval-judge.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  return {
    evalJudgeAgent: { generate: jest.fn() },
    evalJudgeOutputSchema: z.object({
      pass: z.boolean(),
      reason: z.string(),
      confidence: z.enum(['high', 'low']).optional(),
    }),
  };
});
jest.mock('../model-resolver', () => ({
  lastJudgeModelId: jest.fn(() => 'openai/judge-model'),
  // The judge's provider options are filed under the judge's own model.
  resolveJudgeModel: jest.fn(async () => 'openai/judge-model'),
}));

import {
  attemptVerdict,
  mergeEngineOverrides,
  needsVisualSource,
  runAssistantEvalCase,
  runAssistantEvalCaseRepeated,
  runAssistantEvals,
  selectSuiteCases,
  EVAL_STOPPED_ERROR,
} from './assistant.evals';
import type { AssistantEvalCase, EvalCaseContext } from './assistant.evals';
import { evalJudgeAgent } from '../agents/eval-judge.agent';
import { setDatasetToolServices } from '../tool-services';
import type { DatasetSnapshot, DatasetToolServices } from '../tool-services';
import { HARNESS_UNMEASURED_PREFIX } from './result-set-check';
import { loadSuite } from './suite-loader';
import type { EvalSuite } from './suite-loader';
import { ENGINE_DEFAULTS } from '../../modules/engine/engine-options';
import type { TokenUsage } from '../../modules/agents/eval-telemetry';
import type {
  RunTurnOptions,
  TurnResult,
} from '../../modules/sessions/turn-result';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import type { SessionsService } from '../../modules/sessions/sessions.service';

const generate = evalJudgeAgent.generate as unknown as jest.Mock;

/* ------------------------------------------------------------------ fakes */

const snapshots: DatasetSnapshot[] = [
  {
    name: 'Claims',
    datasourceId: 'ds-1',
    datasourceKind: 'postgres',
    tables: ['health.claims', 'health.members'],
  },
];

/** Reference SQL → rows; anything else is a replay of a captured statement. */
let referenceRows: Record<string, Record<string, unknown>[] | Error> = {};
let defaultFilters: { entity: string; predicate: string; title: string }[] = [];

function installServices(): jest.Mock {
  const runReadOnlySql = jest.fn((_datasourceId: string, statement: string) => {
    const rows = referenceRows[statement];
    if (rows instanceof Error) return Promise.reject(rows);
    if (rows) {
      return Promise.resolve({
        columns: Object.keys(rows[0] ?? {}),
        rows,
      });
    }
    return Promise.reject(new Error(`no rows stubbed for "${statement}"`));
  });
  setDatasetToolServices({
    createVisual: jest.fn(),
    updateVisual: jest.fn(),
    getDatasets: jest.fn().mockResolvedValue(snapshots),
    sampleRows: jest.fn(),
    runReadOnlySql,
    defaultFilters: jest.fn(async () => defaultFilters),
  } as unknown as DatasetToolServices);
  return runReadOnlySql;
}

function usage(total: number): TokenUsage {
  return {
    inputTokens: total - 10,
    outputTokens: 10,
    totalTokens: total,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    calls: 1,
  };
}

function sql(input: string, rows: Record<string, unknown>[]): ToolDataRecord {
  return {
    tool: 'run_readonly_sql',
    input,
    columns: Object.keys(rows[0] ?? {}),
    rows,
    rowCount: rows.length,
  };
}

function lastSql(data: ToolDataRecord[]): string | undefined {
  return data
    .filter((record) => record.tool === 'run_readonly_sql' && !record.error)
    .at(-1)?.input;
}

function turn(overrides: Partial<TurnResult> = {}): TurnResult {
  const data = overrides.data ?? [];
  const finalSql = lastSql(data);
  return {
    text: 'The answer.',
    data,
    calledTools: data.map((record) => record.tool),
    steps: data.length,
    ...(finalSql ? { finalSql } : {}),
    repairs: [],
    warnings: [],
    engine: { ...ENGINE_DEFAULTS, promptAblation: [] },
    configHash: 'hash-1',
    aborted: false,
    durationMs: 5,
    ...overrides,
  };
}

type RunTurn = (
  id: string,
  content: string,
  opts: RunTurnOptions,
) => Promise<TurnResult>;

interface FakeSessions {
  create: jest.Mock;
  appendAssistantMessage: jest.Mock;
  delete: jest.Mock;
  runTurn: jest.Mock;
}

function fakeSessions(...turns: (TurnResult | RunTurn)[]): FakeSessions {
  let created = 0;
  let call = 0;
  return {
    create: jest.fn(async () => ({ id: `session-${++created}` })),
    appendAssistantMessage: jest.fn(async () => ({})),
    delete: jest.fn(async () => ({})),
    runTurn: jest.fn(
      async (id: string, content: string, opts: RunTurnOptions) => {
        const next = turns[Math.min(call++, turns.length - 1)];
        return typeof next === 'function' ? next(id, content, opts) : next;
      },
    ),
  };
}

function context(
  sessions: FakeSessions,
  overrides: Partial<EvalCaseContext> = {},
): EvalCaseContext {
  return {
    sessions: sessions as unknown as SessionsService,
    datasets: ['Claims'],
    ...overrides,
  };
}

const figureCase: AssistantEvalCase = {
  id: 'paid-claims',
  category: 'default-filter',
  question: 'How many paid claims are there?',
  intent: 'count with the default filter',
  checks: [{ type: 'finalSqlSucceeded' }],
  expectedSql: 'SELECT reference',
  difficulty: 'easy',
};

const REFERENCE_ROWS = [{ paid_claims: 42 }];

beforeEach(() => {
  referenceRows = { 'SELECT reference': REFERENCE_ROWS };
  defaultFilters = [];
  generate.mockReset();
  installServices();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* ---------------------------------------------------------------- verdicts */

describe('attemptVerdict', () => {
  it('maps checks and errors to PASS / FAIL / GAP / ERROR', () => {
    expect(attemptVerdict([{ passed: true }])).toBe('PASS');
    expect(attemptVerdict([{ passed: true }, { passed: false }])).toBe('FAIL');
    expect(
      attemptVerdict([{ passed: true }, { passed: false, gap: true }]),
    ).toBe('GAP');
    // A measured failure outranks a gap.
    expect(
      attemptVerdict([{ passed: false }, { passed: false, gap: true }]),
    ).toBe('FAIL');
    // Nothing to measure is unmeasured, not passed.
    expect(attemptVerdict([])).toBe('GAP');
    expect(attemptVerdict([{ passed: true }], 'boom')).toBe('ERROR');
  });
});

describe('runAssistantEvalCaseRepeated — one attempt', () => {
  it('PASS: runs the production turn in a fresh session and grades the result set', async () => {
    const sessions = fakeSessions(
      turn({ data: [sql('SELECT answer', [{ n: 42 }])] }),
    );
    const outcome = await runAssistantEvalCaseRepeated(
      figureCase,
      context(sessions, { engine: { sqlRepair: false }, arm: 'fixer-off' }),
      1,
    );

    expect(outcome.result.verdict).toBe('PASS');
    expect(outcome.result.passed).toBe(true);
    expect(outcome.result.checkResults.map((check) => check.id)).toEqual([
      'check-final-sql-succeeded',
      'result-set-match',
    ]);
    expect(outcome.result.finalSql).toBe('SELECT answer');
    expect(outcome.result.difficulty).toBe('easy');
    expect(outcome.logCase).toMatchObject({
      id: 'paid-claims',
      category: 'default-filter',
      difficulty: 'easy',
      verdict: 'PASS',
      runs: 1,
      passes: 1,
      flaky: false,
    });
    expect(outcome.engine).toEqual({ ...ENGINE_DEFAULTS, promptAblation: [] });
    expect(outcome.configHash).toBe('hash-1');
    expect(outcome.stopped).toBe(false);

    expect(sessions.create).toHaveBeenCalledTimes(1);
    expect(sessions.create.mock.calls[0][0]).toMatch(/^eval paid-claims 1 /);
    expect(sessions.create.mock.calls[0][0].length).toBeLessThanOrEqual(64);
    expect(sessions.create.mock.calls[0][1]).toEqual(['Claims']);
    // A fresh session, like a user's first question: no placeholder turn
    // unless the case exercises the visual tools (see needsVisualSource).
    expect(sessions.appendAssistantMessage).not.toHaveBeenCalled();
    expect(sessions.runTurn).toHaveBeenCalledWith(
      'session-1',
      figureCase.question,
      {
        engine: { sqlRepair: false },
        category: 'default-filter',
        arm: 'fixer-off',
        abortSignal: expect.any(AbortSignal),
      },
    );
    expect(sessions.delete).toHaveBeenCalledWith('session-1');
  });

  it('text checks see the FINAL text of the turn', async () => {
    const sessions = fakeSessions(
      turn({ text: 'After synthesis: Argentina won the 2022 final.' }),
    );
    const outcome = await runAssistantEvalCase(
      {
        id: 'champion',
        question: 'Who won?',
        intent: 'i',
        checks: [
          { type: 'includes', value: 'argentina' },
          { type: 'excludes', value: 'France won' },
        ],
      },
      context(sessions),
    );
    expect(outcome.result.verdict).toBe('PASS');
    expect(outcome.result.answer).toBe(
      'After synthesis: Argentina won the 2022 final.',
    );
    expect(outcome.logCase.attempts[0].answer).toBe(
      'After synthesis: Argentina won the 2022 final.',
    );
  });

  it('FAIL: labels the failure, with the Knowledge default filters in scope', async () => {
    defaultFilters = [
      {
        entity: 'health.claims',
        predicate: 'is_test = false',
        title: 'No test claims',
      },
    ];
    const reference =
      "SELECT COUNT(*) AS paid_claims FROM health.claims WHERE status = 'PAID' AND is_test = false";
    const answered =
      "SELECT COUNT(*) AS paid_claims FROM health.claims WHERE status = 'PAID'";
    referenceRows = { [reference]: REFERENCE_ROWS };
    const sessions = fakeSessions(
      turn({ data: [sql(answered, [{ paid_claims: 45 }])] }),
    );
    const outcome = await runAssistantEvalCaseRepeated(
      { ...figureCase, expectedSql: reference },
      context(sessions),
      1,
    );
    expect(outcome.result.verdict).toBe('FAIL');
    expect(outcome.result.passed).toBe(false);
    expect(outcome.result.failureLabel).toBe('missing-default-filter');
    expect(outcome.logCase.failureLabel).toBe('missing-default-filter');
    expect(outcome.logCase.attempts[0].failureLabel).toBe(
      'missing-default-filter',
    );
    expect(outcome.logCase.reason).toBe('result-set-match');
  });

  it('GAP: an unmeasurable result set is never a failure', async () => {
    referenceRows = {
      'SELECT reference': new Error('relation does not exist'),
    };
    const sessions = fakeSessions(
      turn({ data: [sql('SELECT answer', [{ n: 42 }])] }),
    );
    const outcome = await runAssistantEvalCaseRepeated(
      figureCase,
      context(sessions),
      1,
    );
    expect(outcome.result.verdict).toBe('GAP');
    expect(outcome.result.passed).toBe(false);
    expect(outcome.result.failureLabel).toBeUndefined();
    const check = outcome.logCase.attempts[0].checks.find(
      (entry) => entry.id === 'result-set-match',
    );
    expect(check).toMatchObject({ passed: false, gap: true });
    expect(check?.reason).toContain(HARNESS_UNMEASURED_PREFIX);
    expect(outcome.logCase.verdict).toBe('GAP');
  });

  it('a measured failure beside a gap is still a FAIL', async () => {
    referenceRows = {
      'SELECT reference': new Error('relation does not exist'),
    };
    const sessions = fakeSessions(
      turn({ text: 'no idea', data: [sql('SELECT answer', [{ n: 42 }])] }),
    );
    const outcome = await runAssistantEvalCaseRepeated(
      { ...figureCase, checks: [{ type: 'includes', value: 'paid claims' }] },
      context(sessions),
      1,
    );
    expect(outcome.logCase.attempts[0].checks).toEqual([
      expect.objectContaining({ id: 'check-includes', passed: false }),
      expect.objectContaining({ id: 'result-set-match', gap: true }),
    ]);
    expect(outcome.result.verdict).toBe('FAIL');
  });

  it('no SQL where a figure was expected is the agent failing, not a gap', async () => {
    const sessions = fakeSessions(turn({ text: 'About 40, I think.' }));
    const outcome = await runAssistantEvalCaseRepeated(
      figureCase,
      context(sessions),
      1,
    );
    expect(outcome.result.verdict).toBe('FAIL');
    expect(outcome.result.failureLabel).toBe('no-sql');
    expect(
      outcome.result.checkResults.find(
        (check) => check.id === 'result-set-match',
      )?.gap,
    ).toBeUndefined();
  });

  it('GAP: a case with nothing to measure is unmeasured, not passed', async () => {
    const sessions = fakeSessions(turn());
    const outcome = await runAssistantEvalCase(
      { id: 'empty', question: 'q', intent: '', checks: [] },
      context(sessions),
    );
    expect(outcome.result.verdict).toBe('GAP');
    expect(outcome.result.checkResults).toEqual([]);
  });

  it('ERROR: a turn that throws is an error, and its session is still deleted', async () => {
    const sessions = fakeSessions(async () => {
      throw new Error('model unavailable');
    });
    const outcome = await runAssistantEvalCase(figureCase, context(sessions));
    expect(outcome.result.verdict).toBe('ERROR');
    expect(outcome.result.error).toBe('model unavailable');
    expect(outcome.logCase.attempts[0]).toMatchObject({
      verdict: 'ERROR',
      error: 'model unavailable',
      steps: 0,
      sql: [],
    });
    expect(outcome.logCase.reason).toBe('run-error');
    expect(sessions.delete).toHaveBeenCalledWith('session-1');
  });

  it('ERROR: a turn the model provider refused is an error, never graded as a wrong answer', async () => {
    const sessions = fakeSessions(
      turn({
        text: 'The language model provider refused the request (no API credits remaining — …). No analysis was run.',
        providerError: {
          kind: 'quota',
          statusCode: 429,
          message: 'You have no credits remaining. Add credits to continue.',
        },
      }),
    );
    const outcome = await runAssistantEvalCaseRepeated(
      { ...figureCase, judgeRubric: 'Gives the paid claim count.' },
      context(sessions),
      1,
    );
    const expected =
      'provider error (quota): You have no credits remaining. Add credits to continue.';
    expect(outcome.result.verdict).toBe('ERROR');
    expect(outcome.result.passed).toBe(false);
    expect(outcome.result.error).toBe(expected);
    // Nothing was graded: no checks, no result-set comparison, no judge call.
    expect(outcome.result.checkResults).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    expect(outcome.result.failureLabel).not.toBe('no-sql');
    expect(outcome.logCase.attempts[0]).toMatchObject({
      verdict: 'ERROR',
      error: expected,
      checks: [],
    });
    expect(outcome.logCase.verdict).toBe('ERROR');
    expect(sessions.delete).toHaveBeenCalledWith('session-1');
  });

  it('records every SQL statement without its rows, plus the turn’s audit fields', async () => {
    const data: ToolDataRecord[] = [
      {
        tool: 'run_readonly_sql',
        input: 'SELECT broken',
        error: 'no such column',
      },
      {
        ...sql('SELECT answer', [{ n: 42, secret: 'ROW-VALUE-NEVER-LOGGED' }]),
        repairs: [
          {
            original: 'SELECT anwser',
            repaired: 'SELECT answer',
            error: 'syntax error',
            kind: 'syntax',
          },
        ],
      },
    ];
    const sessions = fakeSessions(
      turn({
        data,
        calledTools: [
          'describe_entity',
          'run_readonly_sql',
          'run_readonly_sql',
        ],
        steps: 3,
        repairs: data[1].repairs!,
        warnings: ['metric is constant'],
        review: { status: 'ok', findings: [] },
        crossCheck: { status: 'agree', note: 'same rows' },
        usage: usage(500),
      }),
    );
    const outcome = await runAssistantEvalCase(
      { ...figureCase, checks: [{ type: 'noToolErrors' }] },
      context(sessions),
    );
    const attempt = outcome.logCase.attempts[0];
    expect(attempt.sql).toEqual([
      { sql: 'SELECT broken', ok: false, error: 'no such column' },
      { sql: 'SELECT answer', ok: true, rowCount: 1, repaired: true },
    ]);
    expect(attempt).toMatchObject({
      finalSql: 'SELECT answer',
      steps: 3,
      calledTools: ['describe_entity', 'run_readonly_sql', 'run_readonly_sql'],
      warnings: ['metric is constant'],
      review: 'ok',
      crossCheck: 'agree',
      usage: usage(500),
    });
    expect(attempt.repairs).toHaveLength(1);
    // noToolErrors sees the failed exploratory query.
    expect(attempt.checks[0]).toMatchObject({
      id: 'check-no-tool-errors',
      passed: false,
    });
    expect(JSON.stringify(outcome.logCase)).not.toContain(
      'ROW-VALUE-NEVER-LOGGED',
    );
    // The in-app view keeps a readable trace, aligned to the call order.
    expect(outcome.result.toolCalls.map((call) => call.name)).toEqual([
      'describe_entity',
      'run_readonly_sql',
      'run_readonly_sql',
    ]);
    expect(outcome.result.toolCalls[1].error).toBe('no such column');
    expect(outcome.result.review).toEqual({ status: 'ok', findings: [] });
    expect(outcome.result.repairs).toHaveLength(1);
  });

  it('records the clarifying question when the turn asked one', async () => {
    const sessions = fakeSessions(
      turn({
        text: 'Which year do you mean?',
        calledTools: ['ask_clarification'],
        clarification: { question: 'Which year do you mean?', options: [] },
      }),
    );
    const outcome = await runAssistantEvalCase(figureCase, context(sessions));
    expect(outcome.logCase.attempts[0].clarification).toBe(
      'Which year do you mean?',
    );
    expect(outcome.result.failureLabel).toBe('clarified');
  });
});

/* ------------------------------------------------------- final SQL first */

describe('result set: the final SQL first', () => {
  it('passes via a supporting query and says so', async () => {
    const sessions = fakeSessions(
      turn({
        data: [
          sql('SELECT supporting', [{ n: 42 }]),
          sql('SELECT final', [{ n: 41 }]),
        ],
      }),
    );
    const outcome = await runAssistantEvalCase(figureCase, context(sessions));
    expect(outcome.result.verdict).toBe('PASS');
    expect(outcome.logCase.attempts[0].viaSupportingQuery).toBe(true);
    expect(
      outcome.result.checkResults.find(
        (check) => check.id === 'result-set-match',
      )?.viaSupportingQuery,
    ).toBe(true);
  });

  it('does not flag a pass on the final query', async () => {
    const sessions = fakeSessions(
      turn({
        data: [
          sql('SELECT exploratory', [{ n: 7 }]),
          sql('SELECT final', [{ n: 42 }]),
        ],
      }),
    );
    const outcome = await runAssistantEvalCase(figureCase, context(sessions));
    expect(outcome.result.verdict).toBe('PASS');
    expect(outcome.logCase.attempts[0].viaSupportingQuery).toBeUndefined();
  });

  it('uses the dialect override of the reference', async () => {
    referenceRows = { 'SELECT databricks reference': REFERENCE_ROWS };
    const sessions = fakeSessions(
      turn({ data: [sql('SELECT final', [{ n: 42 }])] }),
    );
    const outcome = await runAssistantEvalCase(
      {
        ...figureCase,
        expectedSqlByDialect: { databricks: 'SELECT databricks reference' },
      },
      context(sessions, { dialect: 'databricks' }),
    );
    expect(outcome.result.verdict).toBe('PASS');
  });

  it('passes on an expectedSqlAlternatives reference, and records which', async () => {
    referenceRows = {
      'SELECT reference': [{ paid_cents: '6318595' }],
      'SELECT dollars': [{ paid_dollars: '63185.950000000000' }],
    };
    const dollarsCase = {
      ...figureCase,
      expectedSqlAlternatives: ['SELECT dollars'],
    };
    const sessions = fakeSessions(
      turn({ data: [sql('SELECT final', [{ paid: 63185.95 }])] }),
    );
    const outcome = await runAssistantEvalCase(dollarsCase, context(sessions));
    expect(outcome.result.verdict).toBe('PASS');
    expect(
      outcome.result.checkResults.find(
        (check) => check.id === 'result-set-match',
      ),
    ).toMatchObject({ passed: true, matchedReference: 1 });
    // The run log carries which reference matched, not just the in-app view.
    expect(
      outcome.logCase.attempts[0].checks.find(
        (check) => check.id === 'result-set-match',
      ),
    ).toMatchObject({ passed: true, matchedReference: 1 });

    // An answer matching neither is still a failure, compared against both.
    const wrong = await runAssistantEvalCase(
      dollarsCase,
      context(
        fakeSessions(turn({ data: [sql('SELECT final', [{ paid: 685.21 }])] })),
      ),
    );
    expect(wrong.result.verdict).toBe('FAIL');
    expect(
      wrong.result.checkResults.find((check) => check.id === 'result-set-match')
        ?.reason,
    ).toContain('nor did it match the 1 alternative reference(s)');
  });
});

/* ------------------------------------------------------------------- judge */

describe('LLM judge', () => {
  const rubricCase: AssistantEvalCase = {
    id: 'clarify-year',
    category: 'clarification',
    question: 'How did we do?',
    intent: 'asks which period',
    checks: [],
    judgeRubric: 'Pass only if the assistant asks which period is meant.',
  };

  function judged(
    verdict: { pass: boolean; reason: string; confidence?: 'high' | 'low' },
    total = 50,
  ) {
    return { object: verdict, usage: usage(total) };
  }

  it('passes on a confident verdict and bills the judge to the attempt', async () => {
    generate.mockResolvedValueOnce(
      judged({ pass: true, reason: 'asks', confidence: 'high' }, 50),
    );
    const sessions = fakeSessions(turn({ usage: usage(1000) }));
    const outcome = await runAssistantEvalCase(rubricCase, context(sessions));
    expect(outcome.result.verdict).toBe('PASS');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(outcome.judgeModel).toBe('openai/judge-model');
    // Usage = the turn + the judge.
    expect(outcome.logCase.attempts[0].usage).toMatchObject({
      totalTokens: 1050,
      calls: 2,
    });
    expect(outcome.result.usage).toMatchObject({ totalTokens: 1050, calls: 2 });
    const [prompt, options] = generate.mock.calls[0];
    expect(prompt).toContain(rubricCase.judgeRubric);
    expect(options).toMatchObject({
      providerOptions: { openai: { temperature: 0 } },
      abortSignal: expect.any(AbortSignal),
    });
  });

  it('re-grades a low-confidence fail once, and the second opinion wins', async () => {
    generate
      .mockResolvedValueOnce(
        judged({ pass: false, reason: 'unsure', confidence: 'low' }, 40),
      )
      .mockResolvedValueOnce(
        judged({ pass: true, reason: 'asks', confidence: 'high' }, 60),
      );
    const sessions = fakeSessions(turn({ usage: usage(1000) }));
    const outcome = await runAssistantEvalCase(rubricCase, context(sessions));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(outcome.result.verdict).toBe('PASS');
    expect(outcome.logCase.attempts[0].usage).toMatchObject({
      totalTokens: 1100,
      calls: 3,
    });
  });

  it('does not re-grade a confident fail', async () => {
    generate.mockResolvedValueOnce(
      judged({ pass: false, reason: 'answered instead', confidence: 'high' }),
    );
    const sessions = fakeSessions(turn());
    const outcome = await runAssistantEvalCase(rubricCase, context(sessions));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(outcome.result.verdict).toBe('FAIL');
    expect(outcome.result.failureLabel).toBe('judge');
    expect(
      outcome.result.checkResults.find((check) => check.id === 'llm-judge')
        ?.reason,
    ).toBe('answered instead');
  });

  it('retries invalid JSON, and two judge errors are a GAP', async () => {
    generate
      .mockResolvedValueOnce({ text: 'not json', usage: usage(30) })
      .mockRejectedValueOnce(new Error('judge provider down'));
    const sessions = fakeSessions(turn());
    const outcome = await runAssistantEvalCase(rubricCase, context(sessions));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(outcome.result.verdict).toBe('GAP');
    const check = outcome.logCase.attempts[0].checks[0];
    expect(check).toMatchObject({ id: 'llm-judge', passed: false, gap: true });
    expect(check.reason).toContain('judge provider down');
    // The unparseable first answer still cost tokens.
    expect(outcome.logCase.attempts[0].usage).toMatchObject({
      totalTokens: 30,
    });
  });

  it('recovers when the retry after a judge error succeeds', async () => {
    generate
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce({
        text: '```json\n{"pass": true, "reason": "ok"}\n```',
      });
    const sessions = fakeSessions(turn());
    const outcome = await runAssistantEvalCase(rubricCase, context(sessions));
    expect(outcome.result.verdict).toBe('PASS');
  });
  it('clarification options are visible to the judge and to the tool trace', async () => {
    generate.mockResolvedValueOnce(
      judged({
        pass: true,
        reason: 'offers concrete options',
        confidence: 'high',
      }),
    );
    const clarification = {
      question: 'Which year do you mean?',
      options: [
        { label: '2019', description: 'the 2019 season' },
        { label: '2020' },
      ],
    };
    const sessions = fakeSessions(
      turn({
        text: 'Which year do you mean?',
        calledTools: ['ask_clarification'],
        clarification,
      }),
    );
    const outcome = await runAssistantEvalCase(rubricCase, context(sessions));
    expect(outcome.result.verdict).toBe('PASS');

    // The judge sees the question AND every option, not a bare question.
    const [prompt] = generate.mock.calls[0];
    expect(prompt).toContain('Which year do you mean?');
    expect(prompt).toContain('Options offered to the user');
    expect(prompt).toContain('2019 — the 2019 season');
    expect(prompt).toContain('2020');

    // The tool trace carries the clarification as ask_clarification's input.
    const call = outcome.result.toolCalls.find(
      (entry) => entry.name === 'ask_clarification',
    );
    expect(call?.input).toContain('2019');
    expect(call?.input).toContain('the 2019 season');

    // The run log's clarification field is the rendered question + options,
    // not just the bare question.
    expect(outcome.logCase.attempts[0].clarification).toContain(
      'Options offered to the user',
    );
    expect(outcome.logCase.attempts[0].clarification).toContain('2019');
  });

  it("a create_visual call's VisualEvent is visible to the judge", async () => {
    generate.mockResolvedValueOnce(
      judged({
        pass: true,
        reason: 'created the requested chart',
        confidence: 'high',
      }),
    );
    const visual = {
      visualId: 'viz-1',
      version: 2,
      title: 'Goals by team',
      action: 'created' as const,
    };
    const sessions = fakeSessions(
      turn({
        text: 'Here is your chart.',
        calledTools: ['create_visual'],
        message: {
          role: 'assistant',
          content: 'Here is your chart.',
          at: new Date().toISOString(),
          visual,
        },
      }),
    );
    const outcome = await runAssistantEvalCase(rubricCase, context(sessions));
    expect(outcome.result.verdict).toBe('PASS');

    const call = outcome.result.toolCalls.find(
      (entry) => entry.name === 'create_visual',
    );
    expect(call?.output).toContain('Goals by team');
    expect(call?.output).toContain('viz-1');

    const [prompt] = generate.mock.calls[0];
    expect(prompt).toContain('Goals by team');
  });

  it('a stop while the judge grades ends the attempt as stopped, without a retry', async () => {
    const stop = new AbortController();
    generate.mockImplementation(
      (_prompt: string, options: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
          setTimeout(() => stop.abort(), 5);
        }),
    );
    const sessions = fakeSessions(turn());
    const outcome = await runAssistantEvalCaseRepeated(
      rubricCase,
      context(sessions, { abortSignal: stop.signal }),
      2,
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(outcome.logCase.attempts).toHaveLength(1);
    expect(outcome.logCase.attempts[0]).toMatchObject({
      verdict: 'ERROR',
      error: EVAL_STOPPED_ERROR,
    });
    expect(outcome.stopped).toBe(true);
  });
});

/* ---------------------------------------------------------------- repeats */

describe('repeats (pass^k)', () => {
  it('runs every attempt in its own session, k times', async () => {
    const sessions = fakeSessions(
      turn({ data: [sql('SELECT final', [{ n: 42 }])] }),
    );
    const onAttempt = jest.fn();
    const outcome = await runAssistantEvalCaseRepeated(
      figureCase,
      context(sessions),
      3,
      { onAttempt },
    );
    expect(sessions.create).toHaveBeenCalledTimes(3);
    expect(sessions.delete).toHaveBeenCalledTimes(3);
    expect(sessions.runTurn.mock.calls.map((call) => call[0])).toEqual([
      'session-1',
      'session-2',
      'session-3',
    ]);
    expect(sessions.delete.mock.calls.map((call) => call[0])).toEqual([
      'session-1',
      'session-2',
      'session-3',
    ]);
    expect(sessions.create.mock.calls.map((call) => call[0])).toEqual([
      expect.stringMatching(/^eval paid-claims 1 /),
      expect.stringMatching(/^eval paid-claims 2 /),
      expect.stringMatching(/^eval paid-claims 3 /),
    ]);
    expect(
      onAttempt.mock.calls.map((call) => [call[0].attempt, call[1]]),
    ).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ]);
    expect(outcome.logCase).toMatchObject({
      verdict: 'PASS',
      runs: 3,
      passes: 3,
      flaky: false,
    });
    expect(outcome.result).toMatchObject({ runs: 3, passes: 3, passed: true });
    expect(outcome.result.attempts).toHaveLength(3);
  });

  it('folds PASS, FAIL, PASS into a flaky FAIL shown by its failing attempt', async () => {
    const sessions = fakeSessions(
      turn({
        text: 'right',
        data: [sql('SELECT final', [{ n: 42 }])],
        usage: usage(100),
        sidePassUsage: { synthesis: usage(20) },
      }),
      turn({
        text: 'wrong',
        data: [sql('SELECT final', [{ n: 41 }])],
        usage: usage(200),
        sidePassUsage: { synthesis: usage(30), grounding: usage(40) },
      }),
      turn({
        text: 'right',
        data: [sql('SELECT final', [{ n: 42 }])],
        usage: usage(300),
      }),
    );
    const outcome = await runAssistantEvalCaseRepeated(
      figureCase,
      context(sessions),
      3,
    );
    expect(outcome.logCase).toMatchObject({
      verdict: 'FAIL',
      runs: 3,
      passes: 2,
      flaky: true,
    });
    expect(outcome.logCase.attempts.map((attempt) => attempt.verdict)).toEqual([
      'PASS',
      'FAIL',
      'PASS',
    ]);
    expect(outcome.result).toMatchObject({
      verdict: 'FAIL',
      passed: false,
      runs: 3,
      passes: 2,
      flaky: true,
      answer: 'wrong',
    });
    // Tokens and time are over every attempt, not the one shown.
    expect(outcome.result.usage).toMatchObject({ totalTokens: 600, calls: 3 });
    expect(outcome.logCase.usage).toMatchObject({ totalTokens: 600 });
    expect(outcome.sidePassUsage).toEqual({
      synthesis: expect.objectContaining({ totalTokens: 50, calls: 2 }),
      grounding: expect.objectContaining({ totalTokens: 40 }),
    });
  });

  it('prices the log case when a rate is known', async () => {
    const sessions = fakeSessions(
      turn({
        data: [sql('SELECT final', [{ n: 42 }])],
        usage: usage(1_000_010),
      }),
    );
    const outcome = await runAssistantEvalCaseRepeated(
      figureCase,
      context(sessions),
      1,
      {
        pricing: {
          model: 'openai/gpt-test',
          table: {
            'openai/gpt-test': {
              inputPerMillionUsd: 1,
              outputPerMillionUsd: 1,
            },
          },
        },
      },
    );
    expect(outcome.logCase.estimatedCostUsd).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------- timeouts and stopping */

describe('timeouts and stopping', () => {
  /** A turn that runs until its signal fires, then hands back partial data. */
  const untilAborted: RunTurn = (_id, _content, opts) =>
    new Promise((resolve) => {
      opts.abortSignal!.addEventListener('abort', () =>
        resolve(
          turn({
            text: 'partial',
            aborted: true,
            data: [sql('SELECT halfway', [{ n: 1 }])],
            usage: usage(70),
          }),
        ),
      );
    });

  it('a timeout is an ERROR that keeps the partial turn', async () => {
    const sessions = fakeSessions(untilAborted);
    const outcome = await runAssistantEvalCase(
      figureCase,
      context(sessions, { timeoutMs: 20 }),
    );
    const attempt = outcome.logCase.attempts[0];
    expect(attempt.verdict).toBe('ERROR');
    expect(attempt.error).toBe('timeout after 0.02s');
    expect(attempt.failureLabel).toBe('timeout');
    expect(attempt.sql).toEqual([
      { sql: 'SELECT halfway', ok: true, rowCount: 1 },
    ]);
    expect(attempt.usage).toMatchObject({ totalTokens: 70 });
    // An interrupted turn is not graded.
    expect(attempt.checks).toEqual([]);
    expect(outcome.stopped).toBe(false);
    expect(sessions.delete).toHaveBeenCalledWith('session-1');
  });

  it('gives up on a turn that ignores its abort after the grace period', async () => {
    const sessions = fakeSessions(
      () => new Promise<TurnResult>(() => undefined),
    );
    const outcome = await runAssistantEvalCase(
      figureCase,
      context(sessions, { timeoutMs: 10, abortGraceMs: 10 }),
    );
    expect(outcome.result.verdict).toBe('ERROR');
    expect(outcome.result.error).toMatch(/^timeout after/);
    expect(sessions.delete).toHaveBeenCalledTimes(1);
  });

  it('a timeout fails only its own attempt', async () => {
    const sessions = fakeSessions(
      untilAborted,
      turn({ data: [sql('SELECT final', [{ n: 42 }])] }),
    );
    const outcome = await runAssistantEvalCaseRepeated(
      figureCase,
      context(sessions, { timeoutMs: 20 }),
      2,
    );
    expect(outcome.logCase.attempts.map((attempt) => attempt.verdict)).toEqual([
      'ERROR',
      'PASS',
    ]);
  });

  it('stopping mid-attempt aborts it and never starts the rest', async () => {
    const stop = new AbortController();
    const sessions = fakeSessions(
      turn({ data: [sql('SELECT final', [{ n: 42 }])] }),
      (id, content, opts) => {
        setTimeout(() => stop.abort(), 5);
        return untilAborted(id, content, opts);
      },
    );
    const outcome = await runAssistantEvalCaseRepeated(
      figureCase,
      context(sessions, { abortSignal: stop.signal }),
      3,
    );
    expect(sessions.runTurn).toHaveBeenCalledTimes(2);
    expect(outcome.stopped).toBe(true);
    const stopped = outcome.logCase.attempts[1];
    expect(stopped).toMatchObject({
      verdict: 'ERROR',
      error: EVAL_STOPPED_ERROR,
    });
    // Stopping is the operator's doing: no failure label.
    expect(stopped.failureLabel).toBeUndefined();
    expect(stopped.answer).toBe('partial');
    expect(outcome.logCase.attempts).toHaveLength(2);
    expect(sessions.delete).toHaveBeenCalledTimes(2);
  });

  it('stopping between attempts leaves the rest unstarted', async () => {
    const stop = new AbortController();
    const sessions = fakeSessions(
      turn({ data: [sql('SELECT final', [{ n: 42 }])] }),
    );
    const outcome = await runAssistantEvalCaseRepeated(
      figureCase,
      context(sessions, { abortSignal: stop.signal }),
      3,
      { onAttempt: () => stop.abort() },
    );
    expect(sessions.runTurn).toHaveBeenCalledTimes(1);
    expect(outcome.stopped).toBe(true);
    expect(outcome.logCase).toMatchObject({ runs: 1, passes: 1 });
  });

  it('an already-stopped run starts nothing', async () => {
    const stop = new AbortController();
    stop.abort();
    const sessions = fakeSessions(turn());
    const outcome = await runAssistantEvalCaseRepeated(
      figureCase,
      context(sessions, { abortSignal: stop.signal }),
      3,
    );
    expect(sessions.create).not.toHaveBeenCalled();
    expect(outcome.result).toMatchObject({
      verdict: 'SKIP',
      runs: 0,
      passed: false,
      error: EVAL_STOPPED_ERROR,
    });
    expect(outcome.logCase.verdict).toBe('SKIP');
    expect(outcome.stopped).toBe(true);
  });
});

/* ------------------------------------------------------------ whole suites */

describe('runAssistantEvals', () => {
  const suite: EvalSuite = loadSuite('world-cup');
  const suiteSnapshots: DatasetSnapshot[] = [
    {
      name: 'World Cup',
      datasourceId: 'ds-wc',
      datasourceKind: 'postgres',
      tables: suite.requiredEntities,
    },
  ];

  beforeEach(() => {
    setDatasetToolServices({
      createVisual: jest.fn(),
      updateVisual: jest.fn(),
      getDatasets: jest.fn().mockResolvedValue(suiteSnapshots),
      sampleRows: jest.fn(),
      runReadOnlySql: jest.fn().mockRejectedValue(new Error('no db in tests')),
    } as unknown as DatasetToolServices);
  });

  it('needs a SessionsService: every case runs the production turn', async () => {
    await expect(
      runAssistantEvals(['World Cup'], undefined, [suite.cases[0].id]),
    ).rejects.toThrow(/SessionsService/);
  });

  it('runs the selected cases with the arm merged under explicit overrides', async () => {
    const sessions = fakeSessions(turn({ text: 'answer' }));
    const onCaseComplete = jest.fn();
    const onOutcome = jest.fn();
    const results = await runAssistantEvals(
      ['World Cup'],
      onCaseComplete,
      [suite.cases[0].id],
      sessions as unknown as SessionsService,
      undefined,
      'world-cup',
      {
        repeat: 2,
        arm: 'fixer-off',
        engine: { descriptiveErrors: false },
        onOutcome,
      },
    );
    expect(results).toHaveLength(1);
    expect(results[0].runs).toBe(2);
    expect(onCaseComplete).toHaveBeenCalledWith(results[0]);
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(sessions.runTurn).toHaveBeenCalledTimes(2);
    expect(sessions.runTurn.mock.calls[0][2]).toMatchObject({
      engine: { sqlRepair: false, descriptiveErrors: false },
      arm: 'fixer-off',
      category: suite.cases[0].category,
    });
  });

  it('refuses a data scope the suite cannot run on', async () => {
    setDatasetToolServices({
      getDatasets: jest.fn().mockResolvedValue([
        {
          name: 'World Cup',
          datasourceId: 'ds',
          datasourceKind: 'postgres',
          tables: [],
        },
      ]),
    } as unknown as DatasetToolServices);
    const sessions = fakeSessions(turn());
    await expect(
      runAssistantEvals(
        ['World Cup'],
        undefined,
        undefined,
        sessions as unknown as SessionsService,
      ),
    ).rejects.toThrow(/Missing entities/);
    expect(sessions.runTurn).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('mergeEngineOverrides puts explicit overrides over the arm preset', () => {
    expect(
      mergeEngineOverrides('fixer-off', { descriptiveErrors: false }),
    ).toEqual({
      sqlRepair: false,
      descriptiveErrors: false,
    });
    expect(mergeEngineOverrides(undefined, undefined)).toEqual({});
    expect(() => mergeEngineOverrides('no-such-arm', undefined)).toThrow(
      /Unknown arm/,
    );
  });

  it('selectSuiteCases selects a case together with its variants', () => {
    const suite: EvalSuite = {
      id: 'demo',
      name: 'Demo',
      datasourceKind: 'postgres',
      datasets: ['Demo'],
      requiredEntities: ['demo.things'],
      cases: [
        {
          id: 'count',
          category: 'control',
          question: 'How many?',
          intent: 'i',
          variants: ['What is the number?'],
        },
        { id: 'other', category: 'control', question: 'q', intent: 'i' },
      ],
    };
    expect(selectSuiteCases(suite, ['count']).map((c) => c.id)).toEqual([
      'count',
    ]);
    expect(selectSuiteCases(suite, ['count'], true).map((c) => c.id)).toEqual([
      'count',
      'count~v1',
    ]);
    expect(selectSuiteCases(suite, [], true)).toEqual([]);
  });
});

describe('needsVisualSource', () => {
  it('seeds a source answer only for cases that expect a visual tool call', () => {
    expect(
      needsVisualSource({
        checks: [
          { type: 'toolOrder', tools: ['run_readonly_sql', 'create_visual'] },
        ],
      }),
    ).toBe(true);
    expect(
      needsVisualSource({
        checks: [{ type: 'calledTool', tool: 'update_visual' }],
      }),
    ).toBe(true);
    // An out-of-scope case asserting the tool was NOT called needs nothing.
    expect(
      needsVisualSource({
        checks: [{ type: 'didNotCall', tool: 'create_visual' }],
      }),
    ).toBe(false);
    expect(needsVisualSource({})).toBe(false);
  });
});

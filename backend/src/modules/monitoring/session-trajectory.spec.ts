import {
  buildSessionFlows,
  SUMMARY_MAX,
  toolRows,
  toolSummary,
} from './session-trajectory';
import { collapseSpans } from './span-collapse';
import {
  flowRows,
  GEN_1,
  GEN_2,
  RUN_1,
  THREAD_ID,
  toSpanEventRows,
  TRACE_1,
  TRACE_2,
} from './testing/span-events.fixture';

/**
 * The trajectory of a session from the real-shape export: turn 1 (four model
 * requests, three tool calls) and turn 2 (one request) of one thread.
 */

const FLOW_TYPES = ['agent_run', 'model_generation', 'model_step', 'tool_call'];

/** The session flows of the given fixture rows (the session query's types). */
function flowsOf(rows: Record<string, unknown>[] = flowRows()) {
  const spans = [...collapseSpans(toSpanEventRows(rows)).values()].filter((s) =>
    FLOW_TYPES.includes(s.spanType),
  );
  return buildSessionFlows(spans);
}

/** Turn 1's describe_entity call (under request 1). */
const DESCRIBE = '400c9b500905e642';

/** Copies of a span's rows under a new spanId, with overrides. */
function copySpan(
  rows: Record<string, unknown>[],
  spanId: string,
  newId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown>[] {
  return rows
    .filter((r) => r.spanId === spanId)
    .map((r) => ({
      ...(JSON.parse(JSON.stringify(r)) as Record<string, unknown>),
      spanId: newId,
      cursorId: undefined,
      ...(r.eventType === 'end' ? overrides : { input: overrides.input }),
    }));
}

describe('toolSummary', () => {
  it('names the entity of describe_entity', () => {
    expect(
      toolSummary('describe_entity', { entity: 'a.b.c', datasourceId: 'x' }),
    ).toBe('a.b.c');
  });

  it('keeps the first 80 chars of run_readonly_sql on one line', () => {
    const sql = `SELECT a,\n       b\n  FROM t\n WHERE ${'x = 1 AND '.repeat(10)}y = 2`;
    const summary = toolSummary('run_readonly_sql', { sql, datasourceId: 'd' });
    expect(summary).not.toContain('\n');
    expect(summary!.startsWith('SELECT a, b FROM t WHERE x = 1')).toBe(true);
    expect(summary).toHaveLength(81);
    expect(summary!.endsWith('…')).toBe(true);
    expect(toolSummary('run_readonly_sql', { sql: 'SELECT 1' })).toBe(
      'SELECT 1',
    );
  });

  it('falls back to the first string value of the input', () => {
    expect(toolSummary('skill', { count: 2, name: 'charts' })).toBe('charts');
    expect(toolSummary('other', { n: 1 })).toBeNull();
    expect(toolSummary('other', null)).toBeNull();
  });
});

describe('toolRows', () => {
  it('reads rowCount, else the rows array, else nothing', () => {
    expect(toolRows({ rowCount: 12, rows: [{}, {}] })).toBe(12);
    expect(toolRows({ rows: [{}, {}] })).toBe(2);
    expect(toolRows({ columns: [] })).toBeNull();
    expect(toolRows(null)).toBeNull();
  });
});

describe('buildSessionFlows (fixture)', () => {
  it('finds one session with two turns and its totals', () => {
    const flows = flowsOf();
    expect([...flows.keys()]).toEqual([THREAD_ID]);
    const flow = flows.get(THREAD_ID)!;
    expect(flow).toMatchObject({
      agents: [{ id: 'assistant', name: 'Questions to Insights Assistant' }],
      turns: 2,
      wallMs: 18310 + 2592,
      modelMs: 18261 + 2579,
      toolCalls: 3,
      inputTokens: 61185 + 18040,
      outputTokens: 2445 + 199,
      errors: 0,
      status: 'succeeded',
    });
    expect(flow.costUsd).toBeCloseTo(0.0729317 + 0.00474, 7);
    expect(flow.turnList.map((t) => [t.index, t.traceId])).toEqual([
      [1, TRACE_1],
      [2, TRACE_2],
    ]);
  });

  it("reads turn 1's facts, question and answer", () => {
    const turn = flowsOf().get(THREAD_ID)!.turnList[0];
    expect(turn).toMatchObject({
      startedAt: '2026-11-10T19:43:43.223Z',
      durationMs: 18310,
      status: 'succeeded',
      agent: { id: 'assistant', name: 'Questions to Insights Assistant' },
      question: 'Which team scored the most goals in total?',
      inputTokens: 61185,
      outputTokens: 2445,
      modelMs: 18261,
      toolMs: 3 + 29 + 15,
      error: null,
    });
    // The answer is the last request's text, not the call's output, which
    // joins the commentary of every request ("I'll start by checking…").
    expect(turn.answer).toMatch(/^\*\*France scored the most goals/);
    expect(turn.answer).not.toContain("I'll start by checking");
    expect(turn.costUsd).toBeCloseTo(0.0729317, 7);
  });

  it('orders the path model → tools → model … with each request’s facts', () => {
    const { steps } = flowsOf().get(THREAD_ID)!.turnList[0];
    expect(steps.map((s) => s.kind)).toEqual([
      'model',
      'tools',
      'model',
      'tools',
      'model',
      'tools',
      'model',
    ]);
    expect(steps[0]).toEqual({
      kind: 'model',
      callId: GEN_1,
      stepIndex: 0,
      model: 'claude-sonnet-5-5',
      durationMs: 3543,
      inputTokens: 12320,
      outputTokens: 409,
      finishReason: 'tool-calls',
      text: "I'll start by checking how goals and matches are structured.",
    });
    const models = steps.filter((s) => s.kind === 'model');
    expect(models.map((s) => s.text?.slice(0, 20))).toEqual([
      "I'll start by checki",
      'Match scores and the',
      'The warning is about',
      '**France scored the ',
    ]);
    expect(
      models.map((s) => [s.stepIndex, s.durationMs, s.finishReason]),
    ).toEqual([
      [0, 3543, 'tool-calls'],
      [1, 6142, 'tool-calls'],
      [2, 5145, 'tool-calls'],
      [3, 3398, 'stop'],
    ]);
    expect(steps[1]).toEqual({
      kind: 'tools',
      tools: [
        {
          name: 'describe_entity',
          count: 1,
          durationMs: 3,
          ok: true,
          summary: 'world_cup.world_cup.goals',
          rows: null,
        },
      ],
    });
    expect(steps[3]).toEqual({
      kind: 'tools',
      tools: [
        {
          name: 'run_readonly_sql',
          count: 1,
          durationMs: 29,
          ok: true,
          summary:
            'SELECT t.id, t.name, MIN(m.kicked_off_at) AS first_match, MAX(m.kicked_off_at) A…',
          rows: 2,
        },
      ],
    });
  });

  it("reads turn 2's question from the chat and its single request", () => {
    const turn = flowsOf().get(THREAD_ID)!.turnList[1];
    expect(turn.question).toBe('And the second?');
    expect(turn.answer).toMatch(/^\*\*Croatia\*\* is second/);
    expect(turn.toolMs).toBeNull();
    expect(turn.steps).toEqual([
      {
        kind: 'model',
        callId: GEN_2,
        stepIndex: 0,
        model: 'claude-sonnet-5-5',
        durationMs: 2564,
        inputTokens: 18040,
        outputTokens: 199,
        finishReason: 'stop',
        text: expect.stringMatching(/^\*\*Croatia\*\* is second/) as string,
      },
    ]);
  });

  it('groups the tool calls of one request by name, with counts, summed time and rows', () => {
    const rows = flowRows();
    rows.push(
      ...copySpan(rows, DESCRIBE, 'describe-2', {
        input: { entity: 'world_cup.world_cup.matches' },
      }),
      ...copySpan(rows, DESCRIBE, 'describe-3', {
        input: { entity: 'world_cup.world_cup.goals' },
        error: { message: 'Entity not found' },
      }),
      ...copySpan(rows, '0bda1902cd4ae3ec', 'sql-under-step-0', {
        parentSpanId: '02db36c1c46e4377',
        output: { rowCount: 7 },
      }),
    );
    const flow = flowsOf(rows).get(THREAD_ID)!;
    const tools = flow.turnList[0].steps[1];
    expect(tools).toEqual({
      kind: 'tools',
      tools: [
        {
          name: 'describe_entity',
          count: 3,
          durationMs: 9,
          ok: false,
          summary: 'world_cup.world_cup.goals, world_cup.world_cup.matches',
          rows: null,
        },
        expect.objectContaining({
          name: 'run_readonly_sql',
          count: 1,
          rows: 7,
        }),
      ],
    });
    expect(flow.toolCalls).toBe(6);
    expect(flow.errors).toBe(1);
    expect(flow.status).toBe('failed');
    expect(flow.turnList[0].status).toBe('failed');
    expect(flow.turnList[0].error).toBe('Entity not found');
    expect(flow.turnList[1].status).toBe('succeeded');
  });

  it(`cuts a group's summary to ${SUMMARY_MAX} chars`, () => {
    const rows = flowRows();
    for (let i = 0; i < 12; i++) {
      rows.push(
        ...copySpan(rows, DESCRIBE, `describe-many-${i}`, {
          input: { entity: `catalog.schema.entity_number_${i}` },
        }),
      );
    }
    const step = flowsOf(rows).get(THREAD_ID)!.turnList[0].steps[1];
    const group = step.kind === 'tools' ? step.tools[0] : null;
    expect(group!.count).toBe(13);
    expect(group!.summary).toHaveLength(SUMMARY_MAX);
    expect(group!.summary!.endsWith('…')).toBe(true);
  });

  it('marks a turn whose agent run has not ended as running', () => {
    const rows = flowRows().filter(
      (r) =>
        !(
          r.traceId === TRACE_2 &&
          r.eventType === 'end' &&
          r.spanType === 'agent_run'
        ),
    );
    const flow = flowsOf(rows).get(THREAD_ID)!;
    expect(flow.status).toBe('running');
    expect(flow.turnList[1].status).toBe('running');
    expect(flow.turnList[1].durationMs).toBeNull();
    expect(flow.wallMs).toBe(18310);
  });

  it('counts a failed agent run as an error, failed over running', () => {
    const rows = flowRows().map((r) =>
      r.spanId === RUN_1 && r.eventType === 'end'
        ? { ...r, error: { message: 'Aborted by the user' } }
        : r,
    );
    const flow = flowsOf(rows).get(THREAD_ID)!;
    expect(flow.errors).toBe(1);
    expect(flow.status).toBe('failed');
    expect(flow.turnList[0].error).toBe('Aborted by the user');
  });

  it("falls back to the run's turn-question when the model input has no user message", () => {
    const rows = flowRows().map((r) =>
      r.spanId === GEN_1 ? { ...r, input: { messages: [] } } : r,
    );
    const turn = flowsOf(rows).get(THREAD_ID)!.turnList[0];
    expect(turn.question).toBe('Which team scored the most goals in total?');
  });

  it('cuts a long answer to 4,000 chars and a request text to 200', () => {
    const long = 'x'.repeat(5000);
    const rows = flowRows().map((r) =>
      r.parentSpanId === GEN_2 &&
      r.spanType === 'model_step' &&
      r.eventType === 'end'
        ? { ...r, output: { text: long } }
        : r,
    );
    const turn = flowsOf(rows).get(THREAD_ID)!.turnList[1];
    expect(turn.answer).toHaveLength(4000);
    const step = turn.steps[0];
    expect(step.kind === 'model' ? step.text : null).toHaveLength(200);
  });

  it("falls back to the call's output when its requests have no text", () => {
    const rows = flowRows().map((r) =>
      r.parentSpanId === GEN_2 && r.spanType === 'model_step'
        ? { ...r, output: null }
        : r,
    );
    const turn = flowsOf(rows).get(THREAD_ID)!.turnList[1];
    expect(turn.answer).toMatch(/^\*\*Croatia\*\* is second/);
  });

  it('leaves out a trace whose agent runs have no thread', () => {
    // The third run of the export has no threadId (an eval-like run).
    const flows = flowsOf();
    expect(
      [...flows.values()].flatMap((f) => f.turnList).map((t) => t.traceId),
    ).toEqual([TRACE_1, TRACE_2]);
  });
});

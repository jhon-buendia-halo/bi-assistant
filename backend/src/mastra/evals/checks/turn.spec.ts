import {
  correctedSql,
  executedSql,
  executedStatements,
  messageText,
  quote,
  turnFromCaseResult,
  turnFromScorerRun,
  writtenStatements,
} from './turn';

/** A Mastra DB message, v2 format, as `runEvals` hands a scorer. */
function message(
  role: 'user' | 'assistant',
  parts: unknown[],
  extra: Record<string, unknown> = {},
) {
  return {
    id: `m-${Math.random()}`,
    role,
    createdAt: new Date(),
    content: { format: 2, parts, ...extra },
  };
}

function invocation(fields: Record<string, unknown>) {
  return { type: 'tool-invocation', toolInvocation: fields };
}

describe('turnFromScorerRun', () => {
  it('reads the question, the answer and every tool call with its result', () => {
    const turn = turnFromScorerRun({
      input: {
        inputMessages: [
          message('user', [
            { type: 'text', text: 'Who won the 2022 World Cup?' },
          ]),
        ],
        rememberedMessages: [],
        systemMessages: [],
        taggedSystemMessages: {},
      },
      output: [
        message('assistant', [
          invocation({
            state: 'result',
            toolCallId: 'c1',
            toolName: 'run_readonly_sql',
            args: { sql: 'SELECT 1', rationale: 'Why.' },
            result: {
              rows: [{ champion: 'Argentina' }],
              correctedSql: 'SELECT 2',
            },
          }),
          { type: 'text', text: 'Argentina won.' },
        ]),
      ],
    });
    expect(turn.question).toBe('Who won the 2022 World Cup?');
    expect(turn.answer).toBe('Argentina won.');
    expect(turn.toolCalls).toEqual([
      {
        name: 'run_readonly_sql',
        args: { sql: 'SELECT 1', rationale: 'Why.' },
        argsReadable: true,
        result: { rows: [{ champion: 'Argentina' }], correctedSql: 'SELECT 2' },
      },
    ]);
    expect(executedSql(turn.toolCalls[0])).toBe('SELECT 2');
  });

  it('marks a returned error, a thrown call and an unfinished call as failed', () => {
    const turn = turnFromScorerRun({
      output: [
        message('assistant', [
          invocation({
            state: 'result',
            toolCallId: 'a',
            toolName: 'run_readonly_sql',
            args: { sql: 'SELECT x' },
            result: { error: 'Datasource "postgres 1" is not used' },
          }),
          invocation({
            state: 'output-error',
            toolCallId: 'b',
            toolName: 'create_visual',
            args: {},
            errorText: 'boom',
          }),
          invocation({
            state: 'call',
            toolCallId: 'c',
            toolName: 'sample_rows',
            args: { entity: 'x' },
          }),
        ]),
      ],
    });
    expect(turn.toolCalls.map((call) => call.error)).toEqual([
      'Datasource "postgres 1" is not used',
      'boom',
      'the call never returned',
    ]);
    expect(executedStatements(turn)).toEqual([]);
    expect(writtenStatements(turn)).toEqual(['SELECT x']);
  });

  it('merges the legacy toolInvocations array, parts winning on a shared id', () => {
    const turn = turnFromScorerRun({
      output: [
        message(
          'assistant',
          [
            invocation({
              state: 'result',
              toolCallId: 'shared',
              toolName: 'run_readonly_sql',
              args: { sql: 'SELECT parts' },
              result: { rows: [] },
            }),
          ],
          {
            toolInvocations: [
              {
                state: 'result',
                toolCallId: 'legacy-only',
                toolName: 'list_entities',
                args: {},
                result: { entities: [] },
              },
              {
                state: 'call',
                toolCallId: 'shared',
                toolName: 'run_readonly_sql',
                args: { sql: 'SELECT legacy' },
              },
            ],
          },
        ),
      ],
    });
    expect(turn.toolCalls.map((call) => call.name)).toEqual([
      'list_entities',
      'run_readonly_sql',
    ]);
    expect(turn.toolCalls[1].error).toBeUndefined();
  });

  it('joins the text of every assistant message, as the Mastra helpers do', () => {
    expect(
      turnFromScorerRun({
        output: [
          message('assistant', [{ type: 'text', text: 'First.' }]),
          message('user', [{ type: 'text', text: 'ignored' }]),
          message('assistant', [{ type: 'text', text: 'Second.' }]),
        ],
      }).answer,
    ).toBe('First. Second.');
    expect(turnFromScorerRun({}).toolCalls).toEqual([]);
    expect(messageText({ content: 'plain' })).toBe('plain');
    expect(
      messageText({ content: { content: 'whole', parts: [{ type: 'text' }] } }),
    ).toBe('whole');
  });
});

describe('turnFromCaseResult (a stored run record)', () => {
  it('parses JSON inputs and outputs, and keeps the error of a failed call', () => {
    const turn = turnFromCaseResult({
      question: 'Q',
      answer: 'A',
      toolCalls: [
        {
          name: 'run_readonly_sql',
          input: '{"sql":"SELECT 1","rationale":"Why."}',
          output: '{"rows":[{"n":1}]}',
        },
        {
          name: 'run_readonly_sql',
          input: '{"sql":"SELECT 2"}',
          output: '{\n  "error": "Datasource \\"rest 1\\" is not used"\n}',
        },
        { name: 'create_visual', input: '{}', error: 'thrown' },
      ],
    });
    expect(turn.toolCalls[0]).toMatchObject({
      args: { sql: 'SELECT 1' },
      result: { rows: [{ n: 1 }] },
    });
    expect(turn.toolCalls[1].error).toBe('Datasource "rest 1" is not used');
    expect(turn.toolCalls[2].error).toBe('thrown');
  });

  it('keeps an output clipped at 2,000 characters as text, and reads what it can', () => {
    const clipped =
      '{\n  "columns": ["a"],\n  "rows": [{"a": 1}],\n  "correctedSql": "SELECT \\"a\\" FROM t",\n  "note": "row li… (truncated)';
    const [call] = turnFromCaseResult({
      toolCalls: [
        {
          name: 'run_readonly_sql',
          input: '{"sql": "SELECT a FROM t", "rationale": "Clipp… (truncated)',
          output: clipped,
        },
      ],
    }).toolCalls;
    expect(call.result).toBeUndefined();
    expect(call.resultText).toBe(clipped);
    expect(call.argsReadable).toBe(false);
    expect(call.error).toBeUndefined();
    expect(correctedSql(call)).toBe('SELECT "a" FROM t');
    const [failed] = turnFromCaseResult({
      toolCalls: [
        {
          name: 'sample_rows',
          output: '{\n  "error": "Entity \\"x\\" is not availa… (truncated)',
        },
      ],
    }).toolCalls;
    expect(failed.error).toBe('the tool failed');
  });
});

describe('quote', () => {
  it('flattens whitespace and clips to 120 characters', () => {
    expect(quote('a\n  b')).toBe('a b');
    expect(quote('x'.repeat(200))).toHaveLength(120);
    expect(quote('x'.repeat(200)).endsWith('…')).toBe(true);
  });
});

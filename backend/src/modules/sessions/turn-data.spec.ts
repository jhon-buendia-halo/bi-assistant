import {
  EMPTY_RESPONSE_FALLBACK,
  PROVIDER_MESSAGE_CHARS,
  STORED_ROWS_CAP,
  classifyProviderError,
  isProviderFailure,
  providerErrorMessage,
  synthesizeToolOnlyTurn,
  toolCallNames,
  toolDataRecord,
  toolRecords,
  toolResultRecord,
  toolResultRecords,
} from './turn-data';

/**
 * The shapes a tool result has actually arrived in. The eval harness captures
 * its SQL evidence through this code (`captureStepRecords` →
 * `toolResultRecords`), so a shape it fails to read is not a missing row in a
 * log — it is an eval case that silently reports no rows and scores as a
 * wrong answer.
 */
describe('toolResultRecord', () => {
  const sqlResult = {
    columns: ['sample_count'],
    rows: [{ sample_count: '125' }],
  };
  const args = {
    sql: 'SELECT COUNT(*) AS sample_count FROM genomics.samples',
    limit: 1,
  };

  /** What @mastra/core 1.66 hands to `onStepFinish` today. */
  it('reads the chunk shape the installed SDK produces', () => {
    const record = toolResultRecord({
      type: 'tool-result',
      runId: 'run-1',
      from: 'AGENT',
      payload: {
        toolCallId: 'call-1',
        toolName: 'run_readonly_sql',
        args,
        result: sqlResult,
      },
    });
    expect(record).toMatchObject({
      tool: 'run_readonly_sql',
      input: args.sql,
      rows: sqlResult.rows,
      rowCount: 1,
    });
  });

  /** The AI SDK's own naming, which `extractToolCalls` already defends against. */
  it('reads the input/output spelling of the same chunk', () => {
    const record = toolResultRecord({
      type: 'tool-result',
      payload: {
        toolName: 'run_readonly_sql',
        input: args,
        output: sqlResult,
      },
    });
    expect(record).toMatchObject({ input: args.sql, rows: sqlResult.rows });
  });

  it('reads the legacy flat shape with no chunk wrapper', () => {
    const record = toolResultRecord({
      toolName: 'run_readonly_sql',
      args,
      result: sqlResult,
    });
    expect(record).toMatchObject({ input: args.sql, rows: sqlResult.rows });
  });

  it('parses a JSON-encoded result and arguments', () => {
    const record = toolResultRecord({
      payload: {
        name: 'run_readonly_sql',
        args: JSON.stringify(args),
        result: JSON.stringify(sqlResult),
      },
    });
    expect(record).toMatchObject({ input: args.sql, rows: sqlResult.rows });
  });

  it('unwraps an AI-SDK output part around the tool value', () => {
    const record = toolResultRecord({
      payload: {
        toolName: 'run_readonly_sql',
        input: args,
        output: { type: 'json', value: sqlResult },
      },
    });
    expect(record).toMatchObject({ input: args.sql, rows: sqlResult.rows });
  });

  it('keeps a result that merely has type and rows of its own', () => {
    const record = toolResultRecord({
      payload: {
        toolName: 'run_readonly_sql',
        input: args,
        output: { type: 'summary', value: 'ignored', rows: sqlResult.rows },
      },
    });
    expect(record?.rows).toEqual(sqlResult.rows);
  });

  it('keeps the error branch and the connector truncation flag', () => {
    expect(
      toolResultRecord({
        payload: {
          toolName: 'run_readonly_sql',
          input: args,
          output: { error: 'relation does not exist' },
        },
      }),
    ).toMatchObject({ error: 'relation does not exist' });
    expect(
      toolResultRecord({
        payload: {
          toolName: 'run_readonly_sql',
          input: args,
          output: { ...sqlResult, truncated: true },
        },
      }),
    ).toMatchObject({ truncated: true });
  });

  it('flags the transcript cap as truncation and keeps the real row count', () => {
    const rows = Array.from({ length: STORED_ROWS_CAP + 5 }, (_, i) => ({
      i,
    }));
    const record = toolResultRecord({
      payload: { toolName: 'run_readonly_sql', input: args, output: { rows } },
    });
    expect(record?.rows).toHaveLength(STORED_ROWS_CAP);
    expect(record?.rowCount).toBe(STORED_ROWS_CAP + 5);
    expect(record?.truncated).toBe(true);
  });

  it('ignores tools that carry no data', () => {
    expect(
      toolResultRecord({ payload: { toolName: 'list_entities', result: {} } }),
    ).toBeNull();
    expect(toolResultRecord(undefined)).toBeNull();
  });
});

describe('toolResultRecords', () => {
  it('collects every data-bearing entry and skips the rest', () => {
    const records = toolResultRecords([
      {
        type: 'tool-result',
        payload: {
          toolName: 'run_readonly_sql',
          args: { sql: 'SELECT 1' },
          result: { rows: [{ a: 1 }] },
        },
      },
      { type: 'tool-result', payload: { toolName: 'list_entities' } },
      null,
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ input: 'SELECT 1', rowCount: 1 });
  });

  it('returns nothing when the batch is not a list', () => {
    expect(toolResultRecords(undefined)).toEqual([]);
  });
});

describe('toolRecords', () => {
  it('reads a non-streamed result through the same shapes', () => {
    expect(
      toolRecords({
        toolResults: [
          {
            payload: {
              toolName: 'run_readonly_sql',
              input: { sql: 'SELECT 2' },
              output: { rows: [{ a: 2 }] },
            },
          },
        ],
      }),
    ).toMatchObject([{ input: 'SELECT 2', rowCount: 1 }]);
  });
});

describe('toolDataRecord — what the bridge did to the statement', () => {
  const repair = {
    original: 'SELECT claimid FROM claims',
    repaired: 'SELECT claim_id FROM claims',
    error: 'column claimid does not exist',
    kind: 'identifier',
    usage: {
      inputTokens: 30,
      outputTokens: 5,
      totalTokens: 35,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      calls: 1,
    },
  };

  it('copies repairs and precheck findings off a SQL result', () => {
    const record = toolDataRecord(
      'run_readonly_sql',
      { sql: 'SELECT claimid FROM claims' },
      {
        columns: ['claim_id'],
        rows: [{ claim_id: 'c1' }],
        correctedSql: 'SELECT claim_id FROM claims',
        repairs: [
          { ...repair, kind: 'semantic', warning: 'The fix changed a filter' },
        ],
        precheck: ['claims is usually filtered with is_test = false'],
      },
    );
    expect(record).toMatchObject({
      input: 'SELECT claim_id FROM claims',
      repairs: [
        { ...repair, kind: 'semantic', warning: 'The fix changed a filter' },
      ],
      precheck: ['claims is usually filtered with is_test = false'],
    });
  });

  it('keeps them on a failed statement too, and drops malformed repairs', () => {
    const record = toolDataRecord(
      'run_readonly_sql',
      { sql: 'SELECT 1' },
      {
        error: 'still failing',
        repairs: [repair, { original: 1 }, null, { ...repair, kind: 'odd' }],
        precheck: [],
      },
    );
    expect(record?.error).toBe('still failing');
    expect(record?.repairs).toEqual([repair, { ...repair, kind: 'unknown' }]);
    expect(record).not.toHaveProperty('precheck');
  });

  it('adds nothing when the bridge attached nothing, or for sample rows', () => {
    const plain = toolDataRecord(
      'run_readonly_sql',
      { sql: 'SELECT 1' },
      { columns: ['n'], rows: [{ n: 1 }] },
    );
    expect(plain).not.toHaveProperty('repairs');
    expect(plain).not.toHaveProperty('precheck');
    const sample = toolDataRecord(
      'sample_rows',
      { entity: 'claims' },
      { columns: ['n'], rows: [], repairs: [repair], precheck: ['x'] },
    );
    expect(sample).not.toHaveProperty('repairs');
    expect(sample).not.toHaveProperty('precheck');
  });
});

describe('toolCallNames', () => {
  it('reads every step of a generate result in call order', () => {
    expect(
      toolCallNames({
        steps: [
          { toolCalls: [{ payload: { toolName: 'describe_entity' } }] },
          {
            toolCalls: [
              { payload: { toolName: 'run_readonly_sql' } },
              { toolName: 'run_readonly_sql' },
            ],
          },
        ],
        toolCalls: [{ toolName: 'ignored-when-steps-exist' }],
      }),
    ).toEqual(['describe_entity', 'run_readonly_sql', 'run_readonly_sql']);
  });

  it('falls back to the top-level calls and tolerates junk', () => {
    expect(
      toolCallNames({ toolCalls: [{ name: 'sample_rows' }, {}, null] }),
    ).toEqual(['sample_rows']);
    expect(toolCallNames(undefined)).toEqual([]);
  });
});

describe('synthesizeToolOnlyTurn', () => {
  const data = [
    { tool: 'run_readonly_sql', input: 'SELECT 1', rows: [{ n: 1 }] },
  ];

  it("reports the pass's token counts through onUsage", async () => {
    const agent = {
      generate: jest.fn().mockResolvedValue({
        text: 'One row.',
        usage: { inputTokens: 40, outputTokens: 8 },
      }),
    };
    const onUsage = jest.fn();

    const text = await synthesizeToolOnlyTurn(
      agent as never,
      'How many?',
      data,
      new AbortController().signal,
      { openai: { reasoningEffort: 'medium' } },
      undefined,
      onUsage,
    );

    expect(text).toBe('One row.');
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 40, outputTokens: 8, calls: 1 }),
    );
  });

  it('never reports a made-up zero, and still works with the old arity', async () => {
    const agent = { generate: jest.fn().mockResolvedValue({ text: '' }) };
    const onUsage = jest.fn();

    await expect(
      synthesizeToolOnlyTurn(
        agent as never,
        'How many?',
        data,
        new AbortController().signal,
        { openai: { reasoningEffort: 'medium' } },
        undefined,
        onUsage,
      ),
    ).resolves.toBe(EMPTY_RESPONSE_FALLBACK);
    expect(onUsage).not.toHaveBeenCalled();
    await expect(
      synthesizeToolOnlyTurn(
        agent as never,
        'How many?',
        data,
        new AbortController().signal,
        { openai: { reasoningEffort: 'medium' } },
      ),
    ).resolves.toBe(EMPTY_RESPONSE_FALLBACK);
  });
});

/** An AI SDK `APICallError` as it reaches the turn: status, raw body, parsed data. */
function apiCallError(
  statusCode: number,
  error: { message: string; type?: string; code?: string },
  extra: Record<string, unknown> = {},
): Error {
  const data = { error: { param: null, ...error } };
  return Object.assign(new Error(error.message), {
    name: 'AI_APICallError',
    statusCode,
    isRetryable: statusCode === 429 || statusCode >= 500,
    url: 'https://api.openai.com/v1/responses',
    responseBody: JSON.stringify(data),
    data,
    ...extra,
  });
}

describe('classifyProviderError', () => {
  it('quota: an OpenAI 429 with insufficient_quota', () => {
    expect(
      classifyProviderError(
        apiCallError(429, {
          message: 'You have no credits remaining. Add credits to continue.',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
        }),
      ),
    ).toEqual({
      kind: 'quota',
      statusCode: 429,
      message: 'You have no credits remaining. Add credits to continue.',
    });
  });

  it('quota: credit_balance_exhausted, and a streamed error chunk with no status', () => {
    expect(
      classifyProviderError(
        apiCallError(429, {
          message: 'Credit balance exhausted.',
          type: 'credit_balance_exhausted',
        }),
      ).kind,
    ).toBe('quota');
    // The Responses API can stream the failure as a plain `{ code, message }`.
    expect(
      classifyProviderError({
        type: 'error',
        code: 'insufficient_quota',
        message: 'You exceeded your current quota.',
      }),
    ).toEqual({ kind: 'quota', message: 'You exceeded your current quota.' });
  });

  it('quota: found behind a retry wrapper', () => {
    const last = apiCallError(429, {
      message: 'You exceeded your current quota, please check your plan.',
      code: 'insufficient_quota',
    });
    const retry = Object.assign(
      new Error(
        'Failed after 3 attempts. Last error: You exceeded your current quota.',
      ),
      {
        name: 'AI_RetryError',
        reason: 'maxRetriesExceeded',
        lastError: last,
        errors: [last],
      },
    );
    expect(classifyProviderError(retry)).toMatchObject({
      kind: 'quota',
      statusCode: 429,
    });
  });

  it('rate-limit: any other 429', () => {
    expect(
      classifyProviderError(
        apiCallError(429, {
          message: 'Rate limit reached for gpt-4o on tokens per min.',
          type: 'tokens',
          code: 'rate_limit_exceeded',
        }),
      ),
    ).toMatchObject({ kind: 'rate-limit', statusCode: 429 });
    expect(
      classifyProviderError(
        Object.assign(new Error('Too Many Requests'), { statusCode: 429 }),
      ).kind,
    ).toBe('rate-limit');
  });

  it('auth: 401 and 403', () => {
    expect(
      classifyProviderError(
        apiCallError(401, {
          message: 'Incorrect API key provided: sk-****.',
          code: 'invalid_api_key',
        }),
      ),
    ).toMatchObject({ kind: 'auth', statusCode: 401 });
    expect(
      classifyProviderError(
        apiCallError(403, { message: 'Project does not have access.' }),
      ).kind,
    ).toBe('auth');
  });

  it('network: connection resets, refused and unresolved hosts', () => {
    const reset = Object.assign(
      new Error('Cannot connect to API: read ECONNRESET'),
      {
        name: 'AI_APICallError',
        isRetryable: true,
        cause: Object.assign(new Error('read ECONNRESET'), {
          code: 'ECONNRESET',
        }),
      },
    );
    expect(classifyProviderError(reset)).toEqual({
      kind: 'network',
      message: 'Cannot connect to API: read ECONNRESET',
    });
    // The code only on the cause, the message a bare "fetch failed".
    const unresolved = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }),
    });
    expect(classifyProviderError(unresolved).kind).toBe('network');
    // A socket that never connected is the network, not a slow model.
    expect(
      classifyProviderError(
        Object.assign(new Error('connect ETIMEDOUT 1.2.3.4:443'), {
          code: 'ETIMEDOUT',
        }),
      ).kind,
    ).toBe('network');
  });

  it('timeout: a headers timeout, and a gateway timeout status', () => {
    expect(
      classifyProviderError(
        new Error('HTTP/2: "headers timeout after 300000"'),
      ),
    ).toEqual({
      kind: 'timeout',
      message: 'HTTP/2: "headers timeout after 300000"',
    });
    expect(
      classifyProviderError(apiCallError(504, { message: 'Gateway error' }))
        .kind,
    ).toBe('timeout');
  });

  it('unknown: anything else, status kept', () => {
    expect(
      classifyProviderError(
        apiCallError(500, { message: 'The server had an error.' }),
      ),
    ).toEqual({
      kind: 'unknown',
      statusCode: 500,
      message: 'The server had an error.',
    });
    expect(classifyProviderError(undefined)).toEqual({
      kind: 'unknown',
      message: 'Unknown provider error',
    });
    expect(classifyProviderError('boom')).toEqual({
      kind: 'unknown',
      message: 'boom',
    });
  });

  it('never classifies on the request body — it holds the prompt', () => {
    const error = apiCallError(
      500,
      { message: 'Internal error' },
      {
        requestBodyValues: {
          input: [{ content: 'What is our rate limit timeout and quota?' }],
        },
      },
    );
    expect(classifyProviderError(error).kind).toBe('unknown');
  });

  it('flattens and clips the message', () => {
    const long = `line one\n\n${'x'.repeat(2 * PROVIDER_MESSAGE_CHARS)}`;
    const { message } = classifyProviderError(new Error(long));
    expect(message.startsWith('line one x')).toBe(true);
    expect(message.length).toBe(PROVIDER_MESSAGE_CHARS);
    expect(message.endsWith('…')).toBe(true);
  });

  it('survives a cyclic cause', () => {
    const error = new Error(
      'Cannot connect to API: socket hang up',
    ) as Error & {
      cause?: unknown;
    };
    error.cause = error;
    expect(classifyProviderError(error).kind).toBe('network');
  });
});

describe('isProviderFailure', () => {
  it('recognises provider errors and nothing else', () => {
    expect(
      isProviderFailure(
        apiCallError(500, { message: 'The server had an error.' }),
      ),
    ).toBe(true);
    expect(
      isProviderFailure(new Error('Cannot connect to API: read ECONNRESET')),
    ).toBe(true);
    expect(
      isProviderFailure(
        Object.assign(new Error('Invalid JSON response'), {
          name: 'AI_JSONParseError',
        }),
      ),
    ).toBe(true);
    expect(
      isProviderFailure(
        new TypeError("Cannot read properties of undefined (reading 'x')"),
      ),
    ).toBe(false);
  });
});

describe('providerErrorMessage', () => {
  const quota = {
    kind: 'quota' as const,
    statusCode: 429,
    message: 'You have no credits remaining.',
  };

  it('says what happened, what to do, and that no analysis ran', () => {
    const text = providerErrorMessage(quota, false);
    expect(text).toBe(
      "The language model provider refused the request (no API credits remaining — add credits in the provider's billing settings, or switch model in Settings → LLM). No analysis was run.",
    );
    expect(text).not.toBe(EMPTY_RESPONSE_FALLBACK);
  });

  it('says the analysis stopped when tools had already run', () => {
    expect(providerErrorMessage(quota, true)).toMatch(
      /The analysis stopped before an answer was written\.$/,
    );
  });

  it('has a line per kind, quoting the provider where it helps', () => {
    expect(
      providerErrorMessage(
        { kind: 'rate-limit', statusCode: 429, message: 'x' },
        false,
      ),
    ).toContain('rate-limiting requests');
    expect(
      providerErrorMessage(
        { kind: 'auth', statusCode: 401, message: 'x' },
        false,
      ),
    ).toContain('HTTP 401 — check the API key in Settings → LLM');
    expect(
      providerErrorMessage(
        { kind: 'network', message: 'Cannot connect to API: read ECONNRESET.' },
        false,
      ),
    ).toContain(
      '(Cannot connect to API: read ECONNRESET — check the connection',
    );
    expect(
      providerErrorMessage(
        { kind: 'timeout', message: 'HTTP/2: "headers timeout after 300000"' },
        false,
      ),
    ).toContain('did not respond in time');
    expect(
      providerErrorMessage(
        {
          kind: 'unknown',
          statusCode: 500,
          message: 'The server had an error.',
        },
        false,
      ),
    ).toContain('returned an error (HTTP 500: The server had an error — retry');
  });
});

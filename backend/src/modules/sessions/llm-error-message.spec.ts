import { chatTurnError, customEndpointErrorMessage } from './llm-error-message';

const BASE = 'http://127.0.0.1:8317/v1';

/** The shape of an AI SDK `APICallError`. */
function apiCallError(
  statusCode: number | undefined,
  url: string,
  cause?: unknown,
) {
  return Object.assign(new Error(`API call failed (${statusCode})`), {
    name: 'AI_APICallError',
    statusCode,
    url,
    cause,
    requestBodyValues: {},
    responseHeaders: { authorization: 'Bearer sk-secret' },
  });
}

/** undici's `TypeError('fetch failed')` with the system error as cause. */
function fetchFailed(code: string): Error {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error(`connect ${code} 127.0.0.1:8317`), { code }),
  });
}

/** The AI SDK `RetryError` wrapping every attempt. */
function retryError(errors: unknown[]) {
  return Object.assign(new Error('Failed after 3 attempts.'), {
    name: 'AI_RetryError',
    errors,
    lastError: errors[errors.length - 1],
  });
}

describe('customEndpointErrorMessage (R50, R51)', () => {
  it.each(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET'])(
    'reports %s as an unreachable host, naming the saved endpoint host',
    (code) => {
      const error = apiCallError(
        undefined,
        `${BASE}/chat/completions`,
        fetchFailed(code),
      );
      expect(customEndpointErrorMessage(error, BASE)).toBe(
        'Could not reach 127.0.0.1:8317 — check the base URL and that the server is running',
      );
    },
  );

  it('finds a network failure behind a retry error', () => {
    const attempt = () =>
      apiCallError(
        undefined,
        `${BASE}/chat/completions`,
        fetchFailed('ECONNREFUSED'),
      );
    const error = retryError([attempt(), attempt(), attempt()]);
    expect(customEndpointErrorMessage(error, BASE)).toMatch(
      /^Could not reach 127\.0\.0\.1:8317/,
    );
  });

  it('treats a bare "fetch failed" as unreachable', () => {
    expect(
      customEndpointErrorMessage(new TypeError('fetch failed'), BASE),
    ).toMatch(/^Could not reach/);
  });

  it('reports a 404 with the full URL requested', () => {
    const error = apiCallError(404, 'http://127.0.0.1:8317/chat/completions');
    expect(customEndpointErrorMessage(error, 'http://127.0.0.1:8317')).toBe(
      'The endpoint answered 404 at http://127.0.0.1:8317/chat/completions — check the base URL (OpenAI-compatible servers usually end in /v1)',
    );
  });

  it('reports a 404 wrapped in a cause chain and a retry error', () => {
    const inner = apiCallError(404, `${BASE}/messages`);
    const error = new Error('stream failed', { cause: retryError([inner]) });
    expect(customEndpointErrorMessage(error, BASE)).toContain(
      `404 at ${BASE}/messages —`,
    );
  });

  it('falls back to the base URL when the error carries no URL', () => {
    const error = Object.assign(new Error('Not Found'), { status: 404 });
    expect(customEndpointErrorMessage(error, BASE)).toContain(
      `404 at ${BASE} —`,
    );
  });

  it('never echoes credentials embedded in the requested URL', () => {
    const error = apiCallError(
      404,
      'http://user:pass@127.0.0.1:8317/v1/chat/completions',
    );
    const message = customEndpointErrorMessage(error, BASE) ?? '';
    expect(message).toContain('http://127.0.0.1:8317/v1/chat/completions');
    expect(message).not.toContain('pass');
  });

  it.each([401, 403])('reports a %s as a rejected key', (status) => {
    const error = apiCallError(status, `${BASE}/chat/completions`);
    const message = customEndpointErrorMessage(error, BASE);
    expect(message).toBe(`The endpoint rejected the API key (${status})`);
    expect(message).not.toContain('sk-secret');
  });

  it('reads the status of an SDK error (`status`, `response.status`)', () => {
    expect(
      customEndpointErrorMessage(
        Object.assign(new Error('x'), { response: { status: 401 } }),
        BASE,
      ),
    ).toBe('The endpoint rejected the API key (401)');
  });

  it.each([400, 429, 500])('leaves an HTTP %s to its own text', (status) => {
    expect(
      customEndpointErrorMessage(
        apiCallError(status, `${BASE}/chat/completions`),
        BASE,
      ),
    ).toBeNull();
  });

  it('leaves other errors alone', () => {
    expect(customEndpointErrorMessage(new Error('boom'), BASE)).toBeNull();
    expect(customEndpointErrorMessage('boom', BASE)).toBeNull();
    expect(customEndpointErrorMessage(undefined, BASE)).toBeNull();
  });

  it('survives a cyclic cause chain', () => {
    const a: Error & { cause?: unknown } = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(customEndpointErrorMessage(a, BASE)).toBeNull();
  });
});

describe('chatTurnError (R51)', () => {
  const refused = () =>
    apiCallError(
      undefined,
      `${BASE}/chat/completions`,
      fetchFailed('ECONNREFUSED'),
    );

  it('maps a custom endpoint failure, keeping the original as the cause', async () => {
    const original = refused();
    const result = await chatTurnError(original, () =>
      Promise.resolve({ provider: 'custom', baseUrl: BASE }),
    );
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(
      /^Could not reach 127\.0\.0\.1:8317/,
    );
    expect((result as Error).cause).toBe(original);
  });

  it.each(['openai', 'anthropic', 'lenai', null] as const)(
    'keeps the original error for provider %s',
    async (provider) => {
      const original = refused();
      const result = await chatTurnError(original, () =>
        Promise.resolve({ provider, baseUrl: BASE }),
      );
      expect(result).toBe(original);
    },
  );

  it('keeps the original error when the failure is not one R51 names', async () => {
    const original = apiCallError(500, `${BASE}/chat/completions`);
    const result = await chatTurnError(original, () =>
      Promise.resolve({ provider: 'custom', baseUrl: BASE }),
    );
    expect(result).toBe(original);
  });

  it('keeps the original error when the settings cannot be read', async () => {
    const original = refused();
    expect(
      await chatTurnError(original, () => Promise.reject(new Error('db down'))),
    ).toBe(original);
    expect(
      await chatTurnError(original, () => {
        throw new Error('sync');
      }),
    ).toBe(original);
  });
});

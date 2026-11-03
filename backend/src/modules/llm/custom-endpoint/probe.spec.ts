import { probeOpenAiStyle, probeStatus } from './probe';
import {
  notFoundMessage,
  RATE_LIMITED_MESSAGE,
  rejectedKeyMessage,
  TIMEOUT_MESSAGE,
  unreachableMessage,
} from './messages';

type FakeAnswer = { status: number; body: string } | Error;

function completion(content: string | null, extra: object = {}): string {
  return JSON.stringify({
    choices: [{ message: { content, ...extra }, finish_reason: 'stop' }],
  });
}

function ok(content: string | null, extra: object = {}): FakeAnswer {
  return { status: 200, body: completion(content, extra) };
}

describe('probeOpenAiStyle (R45, R49, R50, R52)', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;
  let answers: FakeAnswer[];

  const sentBodies = (): Array<Record<string, unknown>> =>
    fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(init.body as string) as Record<string, unknown>,
    );
  const sentHeaders = (call = 0): Record<string, string> =>
    fetchMock.mock.calls[call][1].headers as Record<string, string>;

  beforeEach(() => {
    answers = [];
    fetchMock = jest.fn((_url: string, _init: RequestInit) => {
      void _url;
      void _init;
      const next = answers.shift();
      if (!next) throw new Error('no fake answer queued');
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        text: () => Promise.resolve(next.body),
      } as unknown as Response);
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  const base = {
    baseUrl: 'http://127.0.0.1:8317/v1',
    model: 'qwen3-coder',
  };

  it('passes with the strict JSON-schema request on the first try', async () => {
    answers.push(ok('{"status":"ok"}'));
    const result = await probeOpenAiStyle({ ...base, apiKey: 'sk-secret' });
    expect(result.reply).toBe('ok');
    expect(typeof result.latencyMs).toBe('number');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8317/v1/chat/completions',
    );
    const [body] = sentBodies();
    expect(body.model).toBe('qwen3-coder');
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true, name: 'connection_probe' },
    });
    expect(body.max_tokens).toBe(512);
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(sentHeaders().Authorization).toBe('Bearer sk-secret');
  });

  it('strips trailing slashes from the base URL', async () => {
    answers.push(ok('{"status":"ok"}'));
    await probeOpenAiStyle({ ...base, baseUrl: 'http://127.0.0.1:8317/v1//' });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8317/v1/chat/completions',
    );
  });

  it('sends no credential header without a key (R47)', async () => {
    answers.push(ok('{"status":"ok"}'), ok('{"status":"ok"}'));
    await probeOpenAiStyle(base);
    await probeOpenAiStyle({ ...base, apiKey: '   ' });
    for (const call of [0, 1]) {
      const headers = sentHeaders(call);
      expect(headers).not.toHaveProperty('Authorization');
      expect(headers['Content-Type']).toBe('application/json');
    }
  });

  describe('cap and effort (R17, R52)', () => {
    it('uses max_completion_tokens 4096 and the lowest effort for a reasoning model', async () => {
      answers.push(ok('{"status":"ok"}'));
      await probeOpenAiStyle({ ...base, model: 'gpt-5-mini' });
      const [body] = sentBodies();
      expect(body.max_completion_tokens).toBe(4096);
      expect(body).not.toHaveProperty('max_tokens');
      expect(body.reasoning_effort).toBe('minimal');
    });

    it('sends a requested effort only when it is one of the model levels', async () => {
      answers.push(ok('{"status":"ok"}'), ok('{"status":"ok"}'));
      await probeOpenAiStyle({ ...base, model: 'gpt-5.1', effort: 'low' });
      await probeOpenAiStyle({ ...base, model: 'gpt-5.1', effort: 'xhigh' });
      const bodies = sentBodies();
      expect(bodies[0].reasoning_effort).toBe('low');
      // Not a gpt-5.1 level: the probe falls back to the lowest (R16).
      expect(bodies[1].reasoning_effort).toBe('none');
    });

    it('sends no reasoning_effort when the model has no levels', async () => {
      answers.push(ok('{"status":"ok"}'));
      await probeOpenAiStyle({ ...base, model: 'gpt-4o', effort: 'high' });
      const [body] = sentBodies();
      expect(body).not.toHaveProperty('reasoning_effort');
      expect(body.max_tokens).toBe(512);
    });

    it('sends the lowest fallback level for an unknown model name', async () => {
      answers.push(ok('{"status":"ok"}'));
      await probeOpenAiStyle(base);
      expect(sentBodies()[0].reasoning_effort).toBe('low');
    });
  });

  describe('R49 format fallback', () => {
    it.each([400, 422])(
      'retries with json_object after a %i on the strict schema',
      async (status) => {
        answers.push(
          { status, body: 'response_format json_schema not supported' },
          ok('{"status":"ok"}'),
        );
        const result = await probeOpenAiStyle(base);
        expect(result.reply).toBe('ok');
        const bodies = sentBodies();
        expect(bodies).toHaveLength(2);
        expect(bodies[1].response_format).toEqual({ type: 'json_object' });
      },
    );

    it('retries with no response format after two rejections', async () => {
      answers.push(
        { status: 400, body: 'no json_schema' },
        { status: 422, body: 'no json_object' },
        ok('```json\n{"status": "ok"}\n```'),
      );
      const result = await probeOpenAiStyle(base);
      expect(result.reply).toBe('ok');
      const bodies = sentBodies();
      expect(bodies).toHaveLength(3);
      expect(bodies[2]).not.toHaveProperty('response_format');
      // Every step keeps the same cap and effort.
      for (const body of bodies) {
        expect(body.max_tokens).toBe(512);
        expect(body.reasoning_effort).toBe('low');
      }
    });

    it('fails with the HTTP text when the last step is rejected too', async () => {
      answers.push(
        { status: 400, body: 'a' },
        { status: 400, body: 'b' },
        { status: 400, body: 'x'.repeat(400) },
      );
      await expect(probeOpenAiStyle(base)).rejects.toThrow(
        `Provider request failed (400) — ${'x'.repeat(300)}`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('fails with the structured-output message when every step free-texts', async () => {
      answers.push(
        { status: 400, body: 'no schema' },
        { status: 400, body: 'no object' },
        ok('Sure! The status is ok.'),
      );
      await expect(probeOpenAiStyle(base)).rejects.toThrow(
        'Model answered but could not produce structured JSON output, which every agent here requires — reply="Sure! The status is ok."',
      );
    });

    it('does not fall back on a 200 reply that is not the JSON', async () => {
      answers.push(ok('hello'));
      await expect(probeOpenAiStyle(base)).rejects.toThrow(
        'could not produce structured JSON output',
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not fall back on a failure other than 400 or 422', async () => {
      answers.push({ status: 500, body: 'boom' });
      await expect(probeOpenAiStyle(base)).rejects.toThrow(
        'Provider request failed (500) — boom',
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports a 401 in a fallback step as a rejected key', async () => {
      answers.push(
        { status: 400, body: 'no schema' },
        { status: 401, body: 'unauthorized' },
      );
      await expect(probeOpenAiStyle(base)).rejects.toThrow(
        rejectedKeyMessage(401),
      );
    });
  });

  describe('R50 failure texts', () => {
    it.each(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET'])(
      'reports %s as an unreachable host',
      async (code) => {
        answers.push(
          Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error(`connect ${code}`), { code }),
          }),
        );
        await expect(
          probeOpenAiStyle({ ...base, apiKey: 'sk-secret' }),
        ).rejects.toThrow(unreachableMessage('127.0.0.1:8317'));
      },
    );

    it('reports a 404 with the full URL', async () => {
      answers.push({ status: 404, body: 'Not Found' });
      await expect(
        probeOpenAiStyle({ ...base, baseUrl: 'http://127.0.0.1:8317' }),
      ).rejects.toThrow(
        notFoundMessage('http://127.0.0.1:8317/chat/completions'),
      );
    });

    it.each([401, 403])('reports a %i as a rejected key', async (status) => {
      answers.push({ status, body: 'nope' });
      await expect(
        probeOpenAiStyle({ ...base, apiKey: 'sk-secret' }),
      ).rejects.toThrow(rejectedKeyMessage(status));
    });

    it('reports a 429 as rate limiting', async () => {
      answers.push({ status: 429, body: 'slow down' });
      await expect(probeOpenAiStyle(base)).rejects.toThrow(
        RATE_LIMITED_MESSAGE,
      );
    });

    it('reports other HTTP errors with the first 300 characters of the body', async () => {
      answers.push({ status: 503, body: 'y'.repeat(500) });
      await expect(probeOpenAiStyle(base)).rejects.toThrow(
        `Provider request failed (503) — ${'y'.repeat(300)}`,
      );
    });

    it('times out after 30 s', async () => {
      jest.useFakeTimers();
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const err = new Error('This operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      );
      const pending = probeOpenAiStyle(base);
      const assertion = expect(pending).rejects.toThrow(TIMEOUT_MESSAGE);
      await jest.advanceTimersByTimeAsync(30_000);
      await assertion;
    });

    it('never echoes the API key in an error', async () => {
      const failures: FakeAnswer[] = [
        new TypeError('fetch failed Bearer sk-secret'),
        { status: 401, body: '' },
        { status: 404, body: '' },
        { status: 500, body: 'error' },
      ];
      for (const failure of failures) {
        answers.push(failure);
        const err = await probeOpenAiStyle({
          ...base,
          apiKey: 'sk-secret',
        }).catch((e: Error) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).not.toContain('sk-secret');
        expect((err as Error).message).not.toContain('Authorization');
      }
    });
  });

  describe('R54 key echoed by the server', () => {
    it.each([400, 500])(
      'redacts the key from a %i body the server echoes',
      async (status) => {
        const echo = `bad request: Authorization: Bearer sk-secret-123 ${'z'.repeat(10)}`;
        answers.push(
          { status, body: echo },
          { status, body: echo },
          { status, body: echo },
        );
        const err = await probeOpenAiStyle({
          ...base,
          apiKey: 'sk-secret-123',
        }).catch((e: Error) => e);
        expect((err as Error).message).toContain(
          `Provider request failed (${status})`,
        );
        expect((err as Error).message).not.toContain('sk-secret-123');
      },
    );

    it('redacts the key from a 200 body that is not a chat completion', async () => {
      answers.push({ status: 200, body: 'echo: Bearer sk-secret-123' });
      const err = await probeOpenAiStyle({
        ...base,
        apiKey: 'sk-secret-123',
      }).catch((e: Error) => e);
      expect((err as Error).message).toContain(
        'could not produce structured JSON',
      );
      expect((err as Error).message).not.toContain('sk-secret-123');
    });
  });

  it('times out during a fallback step within the one 30 s budget', async () => {
    jest.useFakeTimers();
    let calls = 0;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          ok: false,
          status: 400,
          text: () => Promise.resolve('no schema'),
        } as unknown as Response);
      }
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const pending = probeOpenAiStyle(base);
    const assertion = expect(pending).rejects.toThrow(TIMEOUT_MESSAGE);
    await jest.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(calls).toBe(2);
  });

  describe('R18 reply checks', () => {
    it('reports an empty reply cut off by the cap', async () => {
      answers.push({
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { content: '' }, finish_reason: 'length' }],
        }),
      });
      await expect(
        probeOpenAiStyle({ ...base, model: 'gpt-5' }),
      ).rejects.toThrow('Model hit the 4096-token limit before replying');
    });

    it('reports a refusal', async () => {
      answers.push(ok(null, { refusal: 'I cannot do that' }));
      await expect(probeOpenAiStyle(base)).rejects.toThrow(
        'Model refused the connection probe — I cannot do that',
      );
    });

    it('reads content given as an array of text parts', async () => {
      answers.push(ok([{ type: 'text', text: '{"status":"ok"}' }] as never));
      await expect(probeOpenAiStyle(base)).resolves.toMatchObject({
        reply: 'ok',
      });
    });

    it('reports a body that is not a chat completion', async () => {
      answers.push({ status: 200, body: '<html>proxy</html>' });
      await expect(probeOpenAiStyle(base)).rejects.toThrow(
        'reply="<html>proxy</html>"',
      );
    });
  });
});

describe('probeStatus', () => {
  it.each([
    ['{"status":"ok"}', 'ok'],
    ['  {"status": " fine "}  ', 'fine'],
    ['```json\n{"status":"ok"}\n```', 'ok'],
    ['```\n{"status":"ok"}\n```', 'ok'],
    ['```{"status":"ok"}```', 'ok'],
  ])('reads %j', (content, expected) => {
    expect(probeStatus(content)).toBe(expected);
  });

  it.each([
    '',
    'ok',
    '{"status":""}',
    '{"status":"   "}',
    '{"status":1}',
    '{"other":"ok"}',
    '["ok"]',
    'null',
    'Here you go: ```json\n{"status":"ok"}\n```',
  ])('rejects %j', (content) => {
    expect(probeStatus(content)).toBeNull();
  });
});

import { listEndpointModels, MODELS_TIMEOUT_MS } from './models';
import {
  MODELS_TIMEOUT_MESSAGE,
  MODELS_UNREADABLE_MESSAGE,
  RATE_LIMITED_MESSAGE,
  notFoundMessage,
  otherHttpMessage,
  rejectedKeyMessage,
  unreachableMessage,
} from './messages';

type FetchArgs = [string, RequestInit];

const realFetch = global.fetch;
let fetchMock: jest.Mock<Promise<Response>, FetchArgs>;

function reply(status: number, body: string): Response {
  return new Response(body, { status });
}

function json(status: number, body: unknown): Response {
  return reply(status, JSON.stringify(body));
}

function lastCall(): { url: string; headers: Record<string, string> } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url, headers: init.headers as Record<string, string> };
}

beforeEach(() => {
  fetchMock = jest.fn<Promise<Response>, FetchArgs>();
  global.fetch = fetchMock;
});

afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
});

describe('listEndpointModels — requests (R45, R46)', () => {
  it('OpenAI style: GET <base>/models with a Bearer key', async () => {
    fetchMock.mockResolvedValue(json(200, { data: [] }));
    await listEndpointModels({
      apiStyle: 'openai',
      baseUrl: 'http://127.0.0.1:8317/v1',
      apiKey: 'sk-secret',
    });
    const { url, headers } = lastCall();
    expect(url).toBe('http://127.0.0.1:8317/v1/models');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(headers['authorization']).toBe('Bearer sk-secret');
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['anthropic-version']).toBeUndefined();
  });

  it('OpenAI style without a key sends no credential header', async () => {
    fetchMock.mockResolvedValue(json(200, { data: [] }));
    await listEndpointModels({
      apiStyle: 'openai',
      baseUrl: 'http://127.0.0.1:8317/v1',
      apiKey: '  ',
    });
    const { headers } = lastCall();
    expect(headers['authorization']).toBeUndefined();
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('Anthropic style: GET <root>/v1/models with x-api-key and anthropic-version', async () => {
    fetchMock.mockResolvedValue(json(200, { data: [] }));
    await listEndpointModels({
      apiStyle: 'anthropic',
      baseUrl: 'http://127.0.0.1:8317/v1',
      apiKey: 'sk-ant',
    });
    const { url, headers } = lastCall();
    expect(url).toBe('http://127.0.0.1:8317/v1/models');
    expect(headers['x-api-key']).toBe('sk-ant');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['authorization']).toBeUndefined();
  });

  it('Anthropic style without a key still sends anthropic-version only', async () => {
    fetchMock.mockResolvedValue(json(200, { data: [] }));
    await listEndpointModels({
      apiStyle: 'anthropic',
      baseUrl: 'http://127.0.0.1:8317/v1',
    });
    const { headers } = lastCall();
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['authorization']).toBeUndefined();
  });
});

describe('listEndpointModels — success (R48)', () => {
  it('returns data[].id in server order with duplicates removed', async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        object: 'list',
        data: [
          { id: 'zeta' },
          { id: 'alpha' },
          { id: 'zeta' },
          { id: 'mid', object: 'model' },
          { noId: true },
          'junk',
          { id: 42 },
        ],
      }),
    );
    await expect(
      listEndpointModels({ apiStyle: 'openai', baseUrl: 'http://h/v1' }),
    ).resolves.toEqual({ ok: true, models: ['zeta', 'alpha', 'mid'] });
  });

  it('is ok with an empty list', async () => {
    fetchMock.mockResolvedValue(json(200, { data: [] }));
    await expect(
      listEndpointModels({ apiStyle: 'anthropic', baseUrl: 'http://h/v1' }),
    ).resolves.toEqual({ ok: true, models: [] });
  });
});

describe('listEndpointModels — unreadable list (R48)', () => {
  it.each([
    ['non-JSON body', reply(200, '<html>hello</html>')],
    ['JSON without data', json(200, { models: ['a'] })],
    ['data not a list', json(200, { data: { id: 'a' } })],
    ['a bare array', json(200, [{ id: 'a' }])],
    ['null', json(200, null)],
  ])('%s', async (_name, response) => {
    fetchMock.mockResolvedValue(response);
    await expect(
      listEndpointModels({ apiStyle: 'openai', baseUrl: 'http://h/v1' }),
    ).resolves.toEqual({ ok: false, message: MODELS_UNREADABLE_MESSAGE });
  });
});

describe('listEndpointModels — failures (R50)', () => {
  it('network failure reports the host, never the key', async () => {
    fetchMock.mockRejectedValue(
      new TypeError('fetch failed: Bearer sk-secret ECONNREFUSED'),
    );
    const result = await listEndpointModels({
      apiStyle: 'openai',
      baseUrl: 'http://127.0.0.1:8317/v1',
      apiKey: 'sk-secret',
    });
    expect(result).toEqual({
      ok: false,
      message: unreachableMessage('127.0.0.1:8317'),
    });
    expect(JSON.stringify(result)).not.toContain('sk-secret');
  });

  it('404 names the full URL called', async () => {
    fetchMock.mockResolvedValue(reply(404, 'not found'));
    await expect(
      listEndpointModels({ apiStyle: 'openai', baseUrl: 'http://h:8317' }),
    ).resolves.toEqual({
      ok: false,
      message: notFoundMessage('http://h:8317/models'),
    });
  });

  it.each([401, 403])('%i is a rejected key', async (status) => {
    fetchMock.mockResolvedValue(reply(status, 'nope'));
    await expect(
      listEndpointModels({
        apiStyle: 'anthropic',
        baseUrl: 'http://h/v1',
        apiKey: 'k',
      }),
    ).resolves.toEqual({ ok: false, message: rejectedKeyMessage(status) });
  });

  it('429 is rate limiting', async () => {
    fetchMock.mockResolvedValue(reply(429, 'slow down'));
    await expect(
      listEndpointModels({ apiStyle: 'openai', baseUrl: 'http://h/v1' }),
    ).resolves.toEqual({ ok: false, message: RATE_LIMITED_MESSAGE });
  });

  it('other statuses keep the provider text with the body', async () => {
    const body = 'x'.repeat(400);
    fetchMock.mockResolvedValue(reply(500, body));
    await expect(
      listEndpointModels({ apiStyle: 'openai', baseUrl: 'http://h/v1' }),
    ).resolves.toEqual({ ok: false, message: otherHttpMessage(500, body) });
  });

  it('times out after 15 s', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const pending = listEndpointModels({
      apiStyle: 'openai',
      baseUrl: 'http://h/v1',
    });
    jest.advanceTimersByTime(MODELS_TIMEOUT_MS - 1);
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(pending).resolves.toEqual({
      ok: false,
      message: MODELS_TIMEOUT_MESSAGE,
    });
    expect(MODELS_TIMEOUT_MS).toBe(15_000);
  });

  it('never throws, even when fetch throws synchronously', async () => {
    fetchMock.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(
      listEndpointModels({ apiStyle: 'openai', baseUrl: 'http://h/v1' }),
    ).resolves.toEqual({ ok: false, message: unreachableMessage('h') });
  });
});

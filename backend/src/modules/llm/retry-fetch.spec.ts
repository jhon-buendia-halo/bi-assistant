import {
  createRetryFetch,
  fetchWithoutRetry,
  installRetryFetch,
} from './retry-fetch';

function response(status: number, headers?: Record<string, string>): Response {
  return new Response(null, { status, headers });
}

describe('createRetryFetch', () => {
  it('retries a 429 honoring Retry-After, then returns the eventual 200', async () => {
    const base = jest
      .fn()
      .mockResolvedValueOnce(response(429, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(response(200));
    const sleep = jest
      .fn<Promise<void>, [number]>()
      .mockResolvedValue(undefined);

    const fetch = createRetryFetch(base, { sleep });
    const res = await fetch('https://example.test/chat/completions');

    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('falls back to exponential backoff (1s/2s/4s) when there is no Retry-After', async () => {
    const base = jest
      .fn()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200));
    const sleep = jest
      .fn<Promise<void>, [number]>()
      .mockResolvedValue(undefined);

    const fetch = createRetryFetch(base, { sleep });
    const res = await fetch('https://example.test/chat/completions');

    expect(res.status).toBe(200);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
  });

  it('gives up after 3 retries (4 attempts total) on sustained 429s', async () => {
    const base = jest.fn().mockResolvedValue(response(429)).mockName('base');
    const sleep = jest
      .fn<Promise<void>, [number]>()
      .mockResolvedValue(undefined);

    const fetch = createRetryFetch(base, { sleep });
    const res = await fetch('https://example.test/chat/completions');

    expect(res.status).toBe(429);
    expect(base).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
  });

  it('retries 500/502/503 the same way as 429', async () => {
    const base = jest
      .fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    const sleep = jest
      .fn<Promise<void>, [number]>()
      .mockResolvedValue(undefined);

    const fetch = createRetryFetch(base, { sleep });
    const res = await fetch('https://example.test/chat/completions');

    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('passes a 404 straight through with no retry', async () => {
    const base = jest.fn().mockResolvedValue(response(404));
    const sleep = jest
      .fn<Promise<void>, [number]>()
      .mockResolvedValue(undefined);

    const fetch = createRetryFetch(base, { sleep });
    const res = await fetch('https://example.test/chat/completions');

    expect(res.status).toBe(404);
    expect(base).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('passes a 401 straight through with no retry', async () => {
    const base = jest.fn().mockResolvedValue(response(401));

    const fetch = createRetryFetch(base, { sleep: jest.fn() });
    const res = await fetch('https://example.test/chat/completions');

    expect(res.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });
});

describe('installRetryFetch', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('wraps globalThis.fetch once and is a no-op on a second install', () => {
    const base = jest.fn();
    globalThis.fetch = base;

    installRetryFetch();
    const wrapped = globalThis.fetch;
    expect(wrapped).not.toBe(base);

    installRetryFetch();
    expect(globalThis.fetch).toBe(wrapped);
  });
});

describe('fetchWithoutRetry (datasources R38)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reaches the fetch under the wrapper, so a 503 comes back at once', async () => {
    const base = jest.fn().mockResolvedValue(response(503));
    globalThis.fetch = base;
    installRetryFetch();

    const res = await fetchWithoutRetry('https://api.example.test/rows');

    expect(res.status).toBe(503);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('calls the global fetch as it is when no wrapper is installed', async () => {
    const base = jest.fn().mockResolvedValue(response(200));
    globalThis.fetch = base;

    await fetchWithoutRetry('https://api.example.test/rows');

    expect(base).toHaveBeenCalledWith(
      'https://api.example.test/rows',
      undefined,
    );
  });
});

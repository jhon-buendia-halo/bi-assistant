import {
  createRetryFetch,
  installRetryFetch,
  RETRY_AFTER_CAP_MS,
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

  it('retries 504 and 529 as well', async () => {
    for (const status of [504, 529]) {
      const base = jest
        .fn()
        .mockResolvedValueOnce(response(status))
        .mockResolvedValueOnce(response(200));
      const fetch = createRetryFetch(base, {
        sleep: jest.fn().mockResolvedValue(undefined),
      });
      expect((await fetch('https://example.test/x')).status).toBe(200);
      expect(base).toHaveBeenCalledTimes(2);
    }
  });

  it("retries a proxy's 520 to 524 (the origin failed or timed out behind it) as well", async () => {
    for (const status of [520, 521, 522, 523, 524]) {
      const base = jest
        .fn()
        .mockResolvedValueOnce(response(status))
        .mockResolvedValueOnce(response(200));
      const fetch = createRetryFetch(base, {
        sleep: jest.fn().mockResolvedValue(undefined),
      });
      expect((await fetch('https://example.test/x')).status).toBe(200);
      expect(base).toHaveBeenCalledTimes(2);
    }
  });

  it('caps a Retry-After in seconds or as an HTTP date at 30 s', async () => {
    const future = new Date(Date.now() + 600_000).toUTCString();
    for (const value of ['600', future]) {
      const base = jest
        .fn()
        .mockResolvedValueOnce(response(429, { 'Retry-After': value }))
        .mockResolvedValueOnce(response(200));
      const sleep = jest
        .fn<Promise<void>, [number, AbortSignal?]>()
        .mockResolvedValue(undefined);
      await createRetryFetch(base, { sleep })('https://example.test/x');
      expect(sleep.mock.calls[0][0]).toBe(RETRY_AFTER_CAP_MS);
    }
  });

  it('ends the wait at once when init.signal aborts and sends no further request', async () => {
    const base = jest.fn().mockResolvedValue(response(503));
    const ctrl = new AbortController();
    const fetch = createRetryFetch(base, {
      sleep: () => new Promise(() => {}),
    });
    const p = fetch('https://example.test/x', { signal: ctrl.signal });
    await new Promise((r) => setTimeout(r, 0));
    const reason = new Error('stopped');
    ctrl.abort(reason);
    await expect(p).rejects.toBe(reason);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("uses the Request input's own signal when init gives none", async () => {
    const base = jest.fn().mockResolvedValue(response(503));
    const ctrl = new AbortController();
    const req = new Request('https://example.test/x', { signal: ctrl.signal });
    const fetch = createRetryFetch(base, {
      sleep: () => new Promise(() => {}),
    });
    const p = fetch(req);
    await new Promise((r) => setTimeout(r, 0));
    ctrl.abort();
    await expect(p).rejects.toBe(ctrl.signal.reason);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('rejects without waiting when the signal is already aborted at a retryable response', async () => {
    const base = jest.fn().mockResolvedValue(response(503));
    const sleep = jest.fn().mockResolvedValue(undefined);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      createRetryFetch(base, { sleep })('https://example.test/x', {
        signal: ctrl.signal,
      }),
    ).rejects.toBe(ctrl.signal.reason);
    expect(sleep).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('default sleep is abortable', async () => {
    const base = jest.fn().mockResolvedValue(response(503));
    const ctrl = new AbortController();
    const p = createRetryFetch(base)('https://example.test/x', {
      signal: ctrl.signal,
    });
    await new Promise((r) => setTimeout(r, 0));
    ctrl.abort();
    await expect(p).rejects.toBe(ctrl.signal.reason);
  });

  it('cancels the body of a retried response and leaves the last one unread', async () => {
    const cancel = jest.fn().mockRejectedValue(new Error('boom'));
    const retried = response(503);
    Object.defineProperty(retried, 'body', { value: { cancel } });
    const last = new Response('tail', { status: 503 });
    const base = jest
      .fn()
      .mockResolvedValueOnce(retried)
      .mockResolvedValue(last);
    const res = await createRetryFetch(base, {
      sleep: jest.fn().mockResolvedValue(undefined),
      maxRetries: 1,
    })('https://example.test/x');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(res).toBe(last);
    expect(res.bodyUsed).toBe(false);
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

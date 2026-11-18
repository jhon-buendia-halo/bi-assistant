/**
 * The guarded model call (workflows R43; agents.md 1.6): a deadline per
 * try, the run's Stop passed through, one retry of a transient failure or a
 * cut reply, and the idle deadline of a streamed agent turn. Fake timers:
 * no test waits for real.
 */
import {
  LONG_MODEL_CALL_DEADLINE_MS,
  MODEL_CALL_DEADLINE_MS,
  MODEL_RETRY_DELAY_MS,
  ModelTimeoutError,
  ReplyCutError,
  STREAM_IDLE_DEADLINE_MS,
  cutReply,
  deadlineFor,
  guardedCall,
  isTransientModelError,
  streamIdleWatch,
  withDeadline,
} from './model-call';

const MINUTE = 60_000;

/** An error shaped as the AI SDK's `APICallError` with an HTTP status. */
function statusError(statusCode: number): Error {
  return Object.assign(new Error(`Request failed (${statusCode})`), {
    name: 'AI_APICallError',
    statusCode,
  });
}

/** A connection reset as undici reports it: `fetch failed`, its cause the socket. */
function resetError(): Error {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
  });
}

/** A call that settles only when its signal aborts, as `stopped`. */
function untilAborted(signal: AbortSignal | undefined): Promise<string> {
  return new Promise((resolve) => {
    if (signal?.aborted) resolve('stopped');
    signal?.addEventListener('abort', () => resolve('stopped'));
  });
}

/** Settle a promise into a value or its error, so a rejection is never unhandled. */
function settled<T>(promise: Promise<T>): Promise<T | Error> {
  return promise.then(
    (value) => value,
    (error: Error) => error,
  );
}

describe('the model call deadlines (workflows R43)', () => {
  it('gives a call five minutes, and ten when its output cap is 16,000 tokens or more', () => {
    expect(MODEL_CALL_DEADLINE_MS).toBe(5 * MINUTE);
    expect(LONG_MODEL_CALL_DEADLINE_MS).toBe(10 * MINUTE);
    expect(STREAM_IDLE_DEADLINE_MS).toBe(5 * MINUTE);
    expect(MODEL_RETRY_DELAY_MS).toBe(2_000);
    expect(deadlineFor(undefined)).toBe(MODEL_CALL_DEADLINE_MS);
    expect(deadlineFor(8000)).toBe(MODEL_CALL_DEADLINE_MS);
    expect(deadlineFor(16000)).toBe(LONG_MODEL_CALL_DEADLINE_MS);
  });

  it('reads only the finish reason "length" as a cut reply', () => {
    expect(cutReply('length')).toBe(true);
    for (const reason of ['stop', 'tool-calls', undefined, null, 'error']) {
      expect(cutReply(reason)).toBe(false);
    }
  });
});

describe('isTransientModelError', () => {
  it('is a network error with no HTTP status, or status 408', () => {
    expect(isTransientModelError(resetError())).toBe(true);
    expect(isTransientModelError(new TypeError('terminated'))).toBe(true);
    expect(
      isTransientModelError(
        Object.assign(new Error('other side closed'), {
          code: 'UND_ERR_SOCKET',
        }),
      ),
    ).toBe(true);
    // The AI SDK wraps the network error, with no status.
    expect(
      isTransientModelError(
        Object.assign(new Error('Cannot connect to API: fetch failed'), {
          name: 'AI_APICallError',
          cause: resetError(),
        }),
      ),
    ).toBe(true);
    expect(isTransientModelError(statusError(408))).toBe(true);
  });

  it('is not a status the fetch wrapper retries, any other status, a timeout or a stop', () => {
    for (const status of [429, 500, 502, 503, 504, 529, 400, 401, 404]) {
      expect(isTransientModelError(statusError(status))).toBe(false);
    }
    // A status decides even when a network error is in the chain.
    expect(
      isTransientModelError(
        Object.assign(statusError(503), { cause: resetError() }),
      ),
    ).toBe(false);
    expect(isTransientModelError(new ModelTimeoutError('Plan', 1000))).toBe(
      false,
    );
    expect(isTransientModelError(new ReplyCutError('Plan'))).toBe(false);
    expect(
      isTransientModelError(
        Object.assign(new Error('This operation was aborted'), {
          name: 'AbortError',
        }),
      ),
    ).toBe(false);
    expect(isTransientModelError(new Error('model has no vision'))).toBe(false);
    expect(isTransientModelError('fetch failed')).toBe(false);
  });
});

describe('withDeadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes the result on when the call answers in time', async () => {
    const result = await withDeadline(
      undefined,
      50,
      () => Promise.resolve('ok'),
      () => new Error('late'),
    );
    expect(result).toBe('ok');
  });

  it('aborts a call that does not settle in time, and rejects with the timeout', async () => {
    let seen: AbortSignal | undefined;
    const pending = settled(
      withDeadline(
        new AbortController().signal,
        MINUTE,
        (signal) => {
          seen = signal;
          return new Promise<string>(() => undefined);
        },
        () => new ModelTimeoutError('Plan', MINUTE),
      ),
    );
    await jest.advanceTimersByTimeAsync(MINUTE);
    const error = await pending;
    expect(error).toBeInstanceOf(ModelTimeoutError);
    expect(seen?.aborted).toBe(true);
  });

  it('a call that resolves as stopped after the deadline fired is still a timeout', async () => {
    const pending = settled(
      withDeadline(
        new AbortController().signal,
        MINUTE,
        untilAborted,
        () => new ModelTimeoutError('Plan', MINUTE),
      ),
    );
    await jest.advanceTimersByTimeAsync(MINUTE);
    expect(await pending).toBeInstanceOf(ModelTimeoutError);
  });

  it("aborts the call when the run's signal aborts, and that is no timeout", async () => {
    const run = new AbortController();
    const pending = withDeadline(run.signal, MINUTE, untilAborted, () => {
      return new ModelTimeoutError('Plan', MINUTE);
    });
    run.abort();
    await expect(pending).resolves.toBe('stopped');
    // The deadline was cleared: nothing fires later.
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
  });

  it('a Stop is no timeout when the call settles after the deadline', async () => {
    const run = new AbortController();
    let finish: (value: string) => void = () => undefined;
    const pending = settled(
      withDeadline(
        run.signal,
        MINUTE,
        () => new Promise<string>((resolve) => (finish = resolve)),
        () => new ModelTimeoutError('Plan', MINUTE),
      ),
    );
    await jest.advanceTimersByTimeAsync(MINUTE - 1000);
    run.abort();
    // The provider is slow to tear down: the call settles past the deadline.
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
    finish('stopped');
    expect(await pending).toBe('stopped');
  });

  it('a run already stopped is no timeout when the call settles after the deadline', async () => {
    const run = new AbortController();
    run.abort();
    let finish: (value: string) => void = () => undefined;
    const pending = settled(
      withDeadline(
        run.signal,
        MINUTE,
        () => new Promise<string>((resolve) => (finish = resolve)),
        () => new ModelTimeoutError('Plan', MINUTE),
      ),
    );
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
    finish('stopped');
    expect(await pending).toBe('stopped');
  });
});

describe('guardedCall', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes a combined signal to the attempt and keeps the run signal apart', async () => {
    const run = new AbortController();
    const attempt = jest.fn((options: { abortSignal?: AbortSignal }) =>
      Promise.resolve(options.abortSignal),
    );
    const signal = await guardedCall(
      { abortSignal: run.signal },
      { label: 'Plan' },
      attempt,
    );
    expect(signal).not.toBe(run.signal);
    expect(signal?.aborted).toBe(false);
  });

  it('rejects with ModelTimeoutError past the deadline, and does not retry a timeout', async () => {
    const attempt = jest.fn((options: { abortSignal?: AbortSignal }) =>
      untilAborted(options.abortSignal),
    );
    const pending = settled(
      guardedCall(
        { abortSignal: new AbortController().signal },
        { label: 'Plan' },
        attempt,
      ),
    );
    await jest.advanceTimersByTimeAsync(MODEL_CALL_DEADLINE_MS);
    const error = await pending;
    expect(error).toBeInstanceOf(ModelTimeoutError);
    expect((error as Error).message).toBe(
      'Plan failed: the model did not answer within 5 minutes. The model may be busy or rate limited: run again later.',
    );
    await jest.advanceTimersByTimeAsync(MODEL_CALL_DEADLINE_MS);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('uses the guard’s own deadline and timeout error', async () => {
    const noRun: { abortSignal?: AbortSignal } = {};
    const pending = settled(
      guardedCall(
        noRun,
        {
          label: 'Review templates',
          deadlineMs: 2 * MINUTE,
          timeoutError: () => new Error('Iris did not answer'),
        },
        (options) => untilAborted(options.abortSignal),
      ),
    );
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
    expect(((await pending) as Error).message).toBe('Iris did not answer');
  });

  it("passes the run's Stop through at once: never retried, never a timeout", async () => {
    const run = new AbortController();
    const attempt = jest.fn((options: { abortSignal?: AbortSignal }) => {
      run.abort();
      return untilAborted(options.abortSignal);
    });
    await expect(
      guardedCall({ abortSignal: run.signal }, { label: 'Plan' }, attempt),
    ).resolves.toBe('stopped');
    // A stopped call that throws is thrown as it is, not retried.
    const failing = jest.fn(() => {
      run.abort();
      return Promise.reject(resetError());
    });
    await expect(
      guardedCall({ abortSignal: run.signal }, { label: 'Plan' }, failing),
    ).rejects.toThrow('fetch failed');
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('retries a reset once after two seconds, reporting one line', async () => {
    const lines: string[] = [];
    const attempt = jest
      .fn<Promise<string>, unknown[]>()
      .mockRejectedValueOnce(resetError())
      .mockResolvedValueOnce('answered');
    const pending = guardedCall(
      { onRetry: (line: string) => lines.push(line) },
      { label: 'Plan' },
      attempt,
    );
    await jest.advanceTimersByTimeAsync(1_999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe('answered');
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(lines).toEqual([
      'Plan: the model call failed (fetch failed). Trying once more in 2 seconds.',
    ]);
  });

  it('retries a status 408 once, and throws a second failure as it is', async () => {
    const second = resetError();
    const attempt = jest
      .fn<Promise<string>, unknown[]>()
      .mockRejectedValueOnce(statusError(408))
      .mockRejectedValueOnce(second);
    const pending = settled(guardedCall({}, { label: 'Plan' }, attempt));
    await jest.advanceTimersByTimeAsync(MODEL_RETRY_DELAY_MS);
    expect(await pending).toBe(second);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('does not retry a status the fetch wrapper already retried', async () => {
    const attempt = jest
      .fn<Promise<string>, unknown[]>()
      .mockRejectedValue(statusError(429));
    await expect(guardedCall({}, { label: 'Plan' }, attempt)).rejects.toThrow(
      'Request failed (429)',
    );
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries a cut reply once; a second cut reply fails with ReplyCutError', async () => {
    const lines: string[] = [];
    const attempt = jest
      .fn<Promise<string>, unknown[]>()
      .mockRejectedValue(new ReplyCutError('Map requirements', 16000));
    const pending = settled(
      guardedCall(
        { onRetry: (line: string) => lines.push(line) },
        { label: 'Map requirements' },
        attempt,
      ),
    );
    await jest.advanceTimersByTimeAsync(MODEL_RETRY_DELAY_MS);
    const error = await pending;
    expect(error).toBeInstanceOf(ReplyCutError);
    expect((error as Error).message).toBe(
      "Map requirements failed: the model's reply was cut at its output limit (16000 tokens) and could not be read. Run again, or choose a model with a larger output limit.",
    );
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(lines).toEqual([
      'Map requirements: the reply was cut at the output limit. Trying once more in 2 seconds.',
    ]);
  });

  it('does not retry when the guard says it cannot', async () => {
    const attempt = jest
      .fn<Promise<string>, unknown[]>()
      .mockRejectedValue(resetError());
    await expect(
      guardedCall(
        {},
        { label: 'Write answer', canRetry: () => false },
        attempt,
      ),
    ).rejects.toThrow('fetch failed');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('a Stop ends the wait before the retry at once, and nothing is retried', async () => {
    const run = new AbortController();
    const failure = resetError();
    const attempt = jest
      .fn<Promise<string>, unknown[]>()
      .mockRejectedValue(failure);
    const pending = settled(
      guardedCall({ abortSignal: run.signal }, { label: 'Plan' }, attempt),
    );
    await jest.advanceTimersByTimeAsync(500);
    run.abort();
    await jest.advanceTimersByTimeAsync(0);
    expect(await pending).toBe(failure);
    await jest.advanceTimersByTimeAsync(MODEL_RETRY_DELAY_MS);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('gives each try its own deadline', async () => {
    const attempt = jest
      .fn<Promise<string>, [{ abortSignal?: AbortSignal }]>()
      .mockRejectedValueOnce(resetError())
      .mockImplementationOnce((options) => untilAborted(options.abortSignal));
    const pending = settled(guardedCall({}, { label: 'Plan' }, attempt));
    await jest.advanceTimersByTimeAsync(MODEL_RETRY_DELAY_MS);
    expect(attempt).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(MODEL_CALL_DEADLINE_MS);
    expect(await pending).toBeInstanceOf(ModelTimeoutError);
  });
});

describe('streamIdleWatch (a streamed agent turn)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** A stream of chunks, each after its wait (fake time). */
  async function* timed(
    steps: { after: number; chunk: unknown }[],
  ): AsyncGenerator<unknown> {
    for (const step of steps) {
      await new Promise((resolve) => setTimeout(resolve, step.after));
      yield step.chunk;
    }
  }

  const TEXT = { type: 'text-delta', payload: { text: 'x' } };

  async function drain(stream: { fullStream: AsyncIterable<unknown> }) {
    const seen: unknown[] = [];
    for await (const chunk of stream.fullStream) seen.push(chunk);
    return seen;
  }

  it('times out when no chunk comes for five minutes, and ends the stream', async () => {
    const watch = streamIdleWatch(new AbortController().signal);
    const stream = watch.watch({
      fullStream: timed([{ after: 6 * MINUTE, chunk: TEXT }]),
      text: Promise.resolve(''),
    });
    const pending = drain(stream);
    await jest.advanceTimersByTimeAsync(STREAM_IDLE_DEADLINE_MS);
    await expect(pending).resolves.toEqual([]);
    expect(watch.signal.aborted).toBe(true);
    expect(watch.timedOut()).toBe(true);
    expect(() => watch.check('Analyse')).toThrow(ModelTimeoutError);
    expect(() => watch.check('Analyse')).toThrow(
      'Analyse failed: the model sent nothing for 5 minutes. The model may be busy or rate limited: run again later.',
    );
    watch.dispose();
  });

  it('does not time out while chunks come every four minutes', async () => {
    const watch = streamIdleWatch(undefined);
    const steps = Array.from({ length: 5 }, () => ({
      after: 4 * MINUTE,
      chunk: TEXT,
    }));
    const pending = drain(watch.watch({ fullStream: timed(steps) }));
    await jest.advanceTimersByTimeAsync(20 * MINUTE);
    await expect(pending).resolves.toHaveLength(5);
    expect(watch.timedOut()).toBe(false);
    expect(() => watch.check('Answer')).not.toThrow();
    watch.dispose();
  });

  it('does not count the time a tool call executes', async () => {
    const watch = streamIdleWatch(undefined);
    const pending = drain(
      watch.watch({
        fullStream: timed([
          {
            after: MINUTE,
            chunk: { type: 'tool-call', payload: { toolCallId: 't1' } },
          },
          {
            after: 6 * MINUTE,
            chunk: { type: 'tool-result', payload: { toolCallId: 't1' } },
          },
          { after: 4 * MINUTE, chunk: TEXT },
        ]),
      }),
    );
    await jest.advanceTimersByTimeAsync(11 * MINUTE);
    await expect(pending).resolves.toHaveLength(3);
    expect(watch.timedOut()).toBe(false);
    watch.dispose();
  });

  it('a Stop during the wait ends the stream and is no timeout', async () => {
    const run = new AbortController();
    const watch = streamIdleWatch(run.signal);
    const pending = drain(
      watch.watch({ fullStream: timed([{ after: 6 * MINUTE, chunk: TEXT }]) }),
    );
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
    run.abort();
    await expect(pending).resolves.toEqual([]);
    expect(watch.signal.aborted).toBe(true);
    expect(watch.timedOut()).toBe(false);
    await jest.advanceTimersByTimeAsync(10 * MINUTE);
    expect(watch.timedOut()).toBe(false);
    watch.dispose();
  });

  it('keeps every other part of the stream as it is', async () => {
    const watch = streamIdleWatch(undefined);
    const source = {
      fullStream: timed([]),
      text: Promise.resolve('the text'),
      read(this: { text: Promise<string> }) {
        return this.text;
      },
    };
    const stream = watch.watch(source);
    await expect(stream.text).resolves.toBe('the text');
    await expect(stream.read()).resolves.toBe('the text');
    watch.dispose();
  });
});

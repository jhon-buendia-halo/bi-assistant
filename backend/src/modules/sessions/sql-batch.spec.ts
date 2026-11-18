import { runOrderedBatch, SQL_BATCH_CONCURRENCY } from './sql-batch';

/** A statement that settles when its test says so, or rejects on abort. */
function deferred(signal: AbortSignal) {
  let resolve: (value: string) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  signal.addEventListener('abort', () => reject(signal.reason), {
    once: true,
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('runOrderedBatch (agents.md 3.2)', () => {
  it('runs at most four statements at a time', async () => {
    expect(SQL_BATCH_CONCURRENCY).toBe(4);
    let inFlight = 0;
    let peak = 0;
    const commits: number[] = [];
    await runOrderedBatch({
      items: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      signal: new AbortController().signal,
      start: async (item) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight -= 1;
        return item;
      },
      commit: (item) => commits.push(item),
    });
    expect(peak).toBe(4);
    expect(commits).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('commits in item order: statement 1 slow, 2 to 4 fast, committed 1, 2, 3, 4', async () => {
    const signal = new AbortController().signal;
    const slow = deferred(signal);
    const started: number[] = [];
    const commits: string[] = [];
    const done = runOrderedBatch({
      items: [1, 2, 3, 4],
      signal,
      start: (item) => {
        started.push(item);
        return item === 1 ? slow.promise : Promise.resolve(`r${item}`);
      },
      commit: (item, outcome) =>
        commits.push(outcome.ok ? outcome.value : `failed ${item}`),
    });
    await tick();
    // 2 to 4 have finished, but nothing is committed before 1.
    expect(started).toEqual([1, 2, 3, 4]);
    expect(commits).toEqual([]);
    slow.resolve('r1');
    await expect(done).resolves.toEqual({ stopped: false });
    expect(commits).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('commits a failed statement as a failure and goes on', async () => {
    const commits: string[] = [];
    const outcome = await runOrderedBatch({
      items: [1, 2, 3],
      signal: new AbortController().signal,
      start: (item) =>
        item === 2
          ? Promise.reject(new Error('column "x" does not exist'))
          : Promise.resolve(`r${item}`),
      commit: (_item, result) =>
        commits.push(
          result.ok
            ? result.value
            : `error: ${(result.error as Error).message}`,
        ),
    });
    expect(outcome).toEqual({ stopped: false });
    expect(commits).toEqual(['r1', 'error: column "x" does not exist', 'r3']);
  });

  it('on Stop starts nothing new, cancels the statements in flight and keeps the committed prefix', async () => {
    const stop = new AbortController();
    const pending = new Map<number, ReturnType<typeof deferred>>();
    const started: number[] = [];
    const signals: AbortSignal[] = [];
    const commits: number[] = [];
    const done = runOrderedBatch({
      items: [1, 2, 3, 4, 5, 6, 7, 8],
      signal: stop.signal,
      start: (item, signal) => {
        started.push(item);
        signals.push(signal);
        const statement = deferred(signal);
        pending.set(item, statement);
        return statement.promise;
      },
      commit: (item) => commits.push(item),
    });
    pending.get(1)!.resolve('r1');
    await tick();
    // 1 committed, 5 started in its place; 2, 3, 4, 5 in flight.
    expect(commits).toEqual([1]);
    expect(started).toEqual([1, 2, 3, 4, 5]);
    // 3 finished but waits behind 2.
    pending.get(3)!.resolve('r3');
    await tick();
    stop.abort(new Error('stopped'));
    await expect(done).resolves.toEqual({ stopped: true });
    // Every statement got the stop signal; none started after the stop; a
    // statement cut by the stop is not committed, nor anything after it.
    expect(signals.every((signal) => signal === stop.signal)).toBe(true);
    expect(started).toEqual([1, 2, 3, 4, 5, 6]);
    expect(commits).toEqual([1]);
  });

  it('starts nothing when the stop came first', async () => {
    const stop = new AbortController();
    stop.abort();
    const start = jest.fn();
    const outcome = await runOrderedBatch({
      items: [1, 2],
      signal: stop.signal,
      start,
      commit: jest.fn(),
    });
    expect(start).not.toHaveBeenCalled();
    expect(outcome).toEqual({ stopped: true });
  });
});

import { earlyWork, memoisedBy } from './early-work';

/** A promise and the functions that settle it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Let every queued microtask and timer callback run. */
const flush = () => new Promise((done) => setImmediate(done));

describe('earlyWork: work a step starts and a later step takes (agents.md 5.13, 5.20)', () => {
  it('buffers the records a job makes and replays them in order when a step takes it', async () => {
    const turn = new AbortController();
    const work = earlyWork(turn.signal);
    const recorded: string[] = [];
    const gate = deferred<void>();
    work.start('rows', async (_signal, record) => {
      record(() => recorded.push('first'));
      await gate.promise;
      record(() => recorded.push('second'));
      return 2;
    });
    gate.resolve();
    await flush();
    // Nothing reaches the turn before the step that takes the job.
    expect(recorded).toEqual([]);
    await expect(work.take<number>('rows')).resolves.toBe(2);
    expect(recorded).toEqual(['first', 'second']);
  });

  it('never leaves a job that rejects before it is taken unhandled, and rethrows it at take', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const work = earlyWork(new AbortController().signal);
      const recorded: string[] = [];
      work.start('notes', (_signal, record) => {
        record(() => recorded.push('before the failure'));
        return Promise.reject(new Error('The model returned an error'));
      });
      await flush();
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
      await expect(work.take('notes')).rejects.toThrow(
        'The model returned an error',
      );
      // What the job recorded before it failed still reaches the turn.
      expect(recorded).toEqual(['before the failure']);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('rethrows a job that throws synchronously at take', async () => {
    const work = earlyWork(new AbortController().signal);
    work.start('sync', () => {
      throw new Error('bad input');
    });
    await expect(work.take('sync')).rejects.toThrow('bad input');
  });

  it("aborts every job's signal when the turn is stopped", async () => {
    const turn = new AbortController();
    const work = earlyWork(turn.signal);
    const signals: AbortSignal[] = [];
    for (const key of ['a', 'b']) {
      work.start(key, (signal) => {
        signals.push(signal);
        return new Promise<string>((done) =>
          signal.addEventListener('abort', () => done(`${key} stopped`)),
        );
      });
    }
    expect(signals.map((signal) => signal.aborted)).toEqual([false, false]);
    turn.abort();
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
    await expect(work.take('a')).resolves.toBe('a stopped');
    await expect(work.take('b')).resolves.toBe('b stopped');
  });

  it('starts a job already aborted when the turn was stopped before it', () => {
    const turn = new AbortController();
    turn.abort();
    const work = earlyWork(turn.signal);
    let seen: boolean | undefined;
    work.start('late', (signal) => {
      seen = signal.aborted;
      return Promise.resolve();
    });
    expect(seen).toBe(true);
  });

  it('settle aborts the jobs no step took, awaits them and drops their buffers', async () => {
    const turn = new AbortController();
    const work = earlyWork(turn.signal);
    const recorded: string[] = [];
    const ended: string[] = [];
    work.start('taken', (_signal, record) => {
      record(() => recorded.push('taken'));
      return Promise.resolve('done');
    });
    const takenSignal: AbortSignal[] = [];
    work.start('untaken', (signal, record) => {
      takenSignal.push(signal);
      record(() => recorded.push('untaken'));
      return new Promise<void>((done) =>
        signal.addEventListener('abort', () => {
          // The job still records on its way out: dropped as well.
          record(() => recorded.push('untaken, late'));
          setImmediate(() => {
            ended.push('untaken');
            done();
          });
        }),
      );
    });
    await work.take('taken');
    await work.settle();
    expect(takenSignal[0].aborted).toBe(true);
    // Awaited: the job had ended when settle returned.
    expect(ended).toEqual(['untaken']);
    expect(recorded).toEqual(['taken']);
    // The turn itself is not stopped by it.
    expect(turn.signal.aborted).toBe(false);
    await expect(work.take('untaken')).rejects.toThrow(
      'No early work "untaken" is held',
    );
  });

  it('settle ends quietly when an untaken job fails on its way out', async () => {
    const work = earlyWork(new AbortController().signal);
    work.start(
      'failing',
      (signal) =>
        new Promise((_done, fail) =>
          signal.addEventListener('abort', () => fail(new Error('aborted'))),
        ),
    );
    await expect(work.settle()).resolves.toBeUndefined();
  });

  it('throws on a second take of one job, and on a job never started', async () => {
    const work = earlyWork(new AbortController().signal);
    work.start('once', () => Promise.resolve(1));
    await work.take('once');
    await expect(work.take('once')).rejects.toThrow(
      'The early work "once" was already taken',
    );
    await expect(work.take('never')).rejects.toThrow(
      'No early work "never" is held',
    );
  });

  describe('progress while a step waits (the no-progress watchdog)', () => {
    const MINUTE = 60_000;
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    /** A job of `count` statements, each committed two minutes after the last. */
    const slowJob =
      (count: number, recorded: number[]) =>
      async (signal: AbortSignal, record: (replay: () => void) => void) => {
        for (let at = 1; at <= count; at++) {
          await new Promise((done) => setTimeout(done, 2 * MINUTE));
          if (signal.aborted) throw new Error('stopped');
          record(() => recorded.push(at));
        }
        return count;
      };

    it('reports each commit while a step waits, none before the take, and replays the records in order at the end', async () => {
      const work = earlyWork(new AbortController().signal);
      const recorded: number[] = [];
      const progress: number[] = [];
      work.start('lineage', slowJob(40, recorded));
      // Ten minutes before the step takes it: five commits, nothing shown.
      await jest.advanceTimersByTimeAsync(10 * MINUTE);
      expect(progress).toEqual([]);
      expect(recorded).toEqual([]);
      const taken = work.take<number>('lineage', (count) =>
        progress.push(count),
      );
      // Each later commit is reported when it is made, so the longest
      // silence is one statement, never the whole batch.
      for (let at = 6; at <= 40; at++) {
        await jest.advanceTimersByTimeAsync(2 * MINUTE);
        expect(progress).toEqual(
          Array.from({ length: at - 5 }, (_v, i) => i + 6),
        );
      }
      await expect(taken).resolves.toBe(40);
      // The records themselves are replayed as before: in order, once.
      expect(recorded).toEqual(Array.from({ length: 40 }, (_v, i) => i + 1));
      expect(progress).toHaveLength(35);
    });

    it('reports nothing for a job no step took, and nothing after the turn was stopped', async () => {
      const turn = new AbortController();
      const work = earlyWork(turn.signal);
      const progress: number[] = [];
      const recorded: number[] = [];
      work.start('lineage', async (_signal, record) => {
        for (let at = 1; at <= 4; at++) {
          await new Promise((done) => setTimeout(done, 2 * MINUTE));
          // Statements that finish after the stop still record.
          record(() => recorded.push(at));
        }
        return 'ended';
      });
      work.start('untaken', async (_signal, record) => {
        await new Promise((done) => setTimeout(done, MINUTE));
        record(() => recorded.push(-1));
      });
      const taken = work.take<string>('lineage', (count) =>
        progress.push(count),
      );
      await jest.advanceTimersByTimeAsync(4 * MINUTE);
      expect(progress).toEqual([1, 2]);
      turn.abort();
      await jest.advanceTimersByTimeAsync(4 * MINUTE);
      expect(progress).toEqual([1, 2]);
      await expect(taken).resolves.toBe('ended');
      // As before: the records the job made are replayed at take.
      expect(recorded).toEqual([1, 2, 3, 4]);
      await work.settle();
      expect(recorded).toEqual([1, 2, 3, 4]);
    });

    it('rethrows a job that fails while a step waits, after the progress it made', async () => {
      const work = earlyWork(new AbortController().signal);
      const progress: number[] = [];
      const recorded: string[] = [];
      work.start('rows', async (_signal, record) => {
        await new Promise((done) => setTimeout(done, 2 * MINUTE));
        record(() => recorded.push('first'));
        await new Promise((done) => setTimeout(done, 2 * MINUTE));
        throw new Error('warehouse down');
      });
      const taken = work.take('rows', (count) => progress.push(count));
      const failed = expect(taken).rejects.toThrow('warehouse down');
      await jest.advanceTimersByTimeAsync(4 * MINUTE);
      await failed;
      expect(progress).toEqual([1]);
      // The statement that finished stays, as a serial run kept it.
      expect(recorded).toEqual(['first']);
    });
  });

  it('refuses to start a job whose key is already held', () => {
    const work = earlyWork(new AbortController().signal);
    work.start('twice', () => Promise.resolve());
    expect(() => work.start('twice', () => Promise.resolve())).toThrow(
      'The early work "twice" has already started',
    );
  });
});

describe('memoisedBy: one call per key for a run (agents.md 5.20)', () => {
  it('calls once per key and hands every caller the same result', async () => {
    const fetch = jest.fn((input: { datasets: string[] }) =>
      Promise.resolve(input.datasets.length),
    );
    const once = memoisedBy(fetch, (input) => input.datasets.join('\n'));
    await expect(once({ datasets: ['World Cup'] })).resolves.toBe(1);
    await expect(once({ datasets: ['World Cup'] })).resolves.toBe(1);
    await expect(once({ datasets: ['A', 'B'] })).resolves.toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('calls again after a failure', async () => {
    const fetch = jest
      .fn<Promise<number>, [string]>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(3);
    const once = memoisedBy(fetch, (key) => key);
    await expect(once('k')).rejects.toThrow('down');
    await expect(once('k')).resolves.toBe(3);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

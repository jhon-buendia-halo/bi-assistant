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

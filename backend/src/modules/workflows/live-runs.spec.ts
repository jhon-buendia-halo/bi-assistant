import {
  IdleWatchdog,
  LIVE_RUN_MAX_EVENTS,
  LIVE_RUN_RETENTION_MS,
  LiveRuns,
  MAX_LIVE_RUNS_DEFAULT,
  RUN_IDLE_MINUTES_DEFAULT,
  RUN_IDLE_MINUTES_MAX,
  RunCheckpoint,
  liveRunCap,
  runIdleLimitMs,
  runStalledMessage,
  type LiveRunFrame,
  type LiveRunListener,
} from './live-runs';

/** A follower that records what it gets, as `<seq>:<type>[:<content>]`. */
function follower(): LiveRunListener & { got: string[]; ended: number } {
  const got: string[] = [];
  const self = {
    got,
    ended: 0,
    event: ({ seq, event }: LiveRunFrame) => {
      const content =
        typeof event['content'] === 'string' ? `:${event['content']}` : '';
      got.push(`${seq}:${event.type}${content}`);
    },
    end: () => {
      self.ended += 1;
    },
  };
  return self;
}

describe('LiveRuns (api.md 119, 138, 149, 150; ADR-0048)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('numbers the events from 1 and replays those after a seq, then the live ones', () => {
    const runs = new LiveRuns();
    runs.begin('run-1');
    runs.publish('run-1', { type: 'run', runId: 'run-1' });
    runs.publish('run-1', { type: 'step', id: 'plan', status: 'running' });
    runs.publish('run-1', { type: 'tool', content: 'run_readonly_sql' });
    const late = follower();
    runs.subscribe('run-1', 1, late);
    expect(late.got).toEqual(['2:step', '3:tool:run_readonly_sql']);
    runs.publish('run-1', { type: 'done' });
    expect(late.got.at(-1)).toBe('4:done');
    const all = follower();
    runs.subscribe('run-1', 0, all);
    expect(all.got).toEqual([
      '1:run',
      '2:step',
      '3:tool:run_readonly_sql',
      '4:done',
    ]);
  });

  it('merges consecutive text and reasoning deltas, and replays only what follows the seq asked', () => {
    const runs = new LiveRuns();
    runs.begin('run-1');
    runs.publish('run-1', { type: 'run' });
    runs.publish('run-1', { type: 'reasoning', content: 'Think' });
    runs.publish('run-1', { type: 'reasoning', content: 'ing' });
    runs.publish('run-1', { type: 'text', content: 'Bra' });
    runs.publish('run-1', { type: 'text', content: 'zil' });
    runs.publish('run-1', { type: 'text', content: ' won.' });
    const all = follower();
    runs.subscribe('run-1', 0, all);
    // One entry per run of deltas, numbered by its last delta.
    expect(all.got).toEqual([
      '1:run',
      '3:reasoning:Thinking',
      '6:text:Brazil won.',
    ]);
    // A client that saw up to "Bra" (seq 4) gets the rest of the text.
    const resumed = follower();
    runs.subscribe('run-1', 4, resumed);
    expect(resumed.got).toEqual(['6:text:zil won.']);
    const mid = follower();
    runs.subscribe('run-1', 2, mid);
    expect(mid.got).toEqual(['3:reasoning:ing', '6:text:Brazil won.']);
  });

  it('sends every live event to every follower, unmerged', () => {
    const runs = new LiveRuns();
    runs.begin('run-1');
    const a = follower();
    const b = follower();
    runs.subscribe('run-1', 0, a);
    runs.subscribe('run-1', 0, b);
    runs.publish('run-1', { type: 'text', content: 'Hel' });
    runs.publish('run-1', { type: 'text', content: 'lo' });
    expect(a.got).toEqual(['1:text:Hel', '2:text:lo']);
    expect(b.got).toEqual(a.got);
  });

  it('a follower that leaves never stops the run; Stop aborts it', () => {
    const runs = new LiveRuns();
    const signal = runs.begin('run-1');
    const a = follower();
    const leave = runs.subscribe('run-1', 0, a)!;
    leave();
    runs.publish('run-1', { type: 'run' });
    expect(a.got).toEqual([]);
    expect(signal.aborted).toBe(false);
    expect(runs.isRunning('run-1')).toBe(true);
    expect(runs.running()).toEqual(['run-1']);
    expect(runs.stop('run-1')).toBe(true);
    expect(signal.aborted).toBe(true);
  });

  it('ends every follower when the run ends; a later follower gets the replay and ends at once; Stop is then a no-op', async () => {
    const runs = new LiveRuns();
    const signal = runs.begin('run-1');
    const a = follower();
    runs.subscribe('run-1', 0, a);
    runs.publish('run-1', { type: 'run' });
    const ended = runs.whenEnded('run-1');
    runs.end('run-1');
    await expect(ended).resolves.toBeUndefined();
    expect(a.ended).toBe(1);
    runs.publish('run-1', { type: 'text', content: 'late' });
    const b = follower();
    runs.subscribe('run-1', 0, b);
    expect(b.got).toEqual(['1:run']);
    expect(b.ended).toBe(1);
    expect(runs.isRunning('run-1')).toBe(false);
    expect(runs.stop('run-1')).toBe(false);
    expect(signal.aborted).toBe(false);
  });

  it('drops an ended run 10 minutes after its end; an unknown run is not followed', () => {
    expect(LIVE_RUN_RETENTION_MS).toBe(10 * 60 * 1000);
    const runs = new LiveRuns();
    runs.begin('run-1');
    runs.end('run-1');
    jest.advanceTimersByTime(LIVE_RUN_RETENTION_MS - 1);
    expect(runs.has('run-1')).toBe(true);
    jest.advanceTimersByTime(1);
    expect(runs.has('run-1')).toBe(false);
    expect(runs.subscribe('run-1', 0, follower())).toBeUndefined();
    expect(runs.whenEnded('run-1')).toBeUndefined();
    expect(runs.stop('run-1')).toBe(false);
  });

  it('a resumed run starts a fresh log whose numbers go on, and is not dropped by its earlier end', () => {
    const runs = new LiveRuns();
    runs.begin('run-1');
    runs.publish('run-1', { type: 'run' });
    runs.publish('run-1', { type: 'done' });
    runs.end('run-1');
    jest.advanceTimersByTime(LIVE_RUN_RETENTION_MS / 2);
    const signal = runs.begin('run-1');
    runs.publish('run-1', { type: 'run' });
    jest.advanceTimersByTime(LIVE_RUN_RETENTION_MS);
    expect(runs.has('run-1')).toBe(true);
    const a = follower();
    runs.subscribe('run-1', 0, a);
    expect(a.got).toEqual(['3:run']);
    expect(signal.aborted).toBe(false);
    expect(() => runs.begin('run-1')).toThrow('Run "run-1" is already running');
  });

  it('caps the log, keeping the first event', () => {
    const runs = new LiveRuns(LIVE_RUN_RETENTION_MS, 3);
    runs.begin('run-1');
    runs.publish('run-1', { type: 'run' });
    for (const id of ['a', 'b', 'c', 'd']) {
      runs.publish('run-1', { type: 'step', id });
    }
    const a = follower();
    runs.subscribe('run-1', 0, a);
    expect(a.got).toEqual(['1:run', '4:step', '5:step']);
  });
});

describe('LiveRuns: the cap on live runs (api.md 119 429)', () => {
  it('reserves a slot until the cap is reached, then refuses; an ended run frees its slot', () => {
    const runs = new LiveRuns(LIVE_RUN_RETENTION_MS, LIVE_RUN_MAX_EVENTS, 2);
    expect(runs.cap).toBe(2);
    const first = runs.reserve();
    const second = runs.reserve();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(runs.reserve()).toBeUndefined();
    runs.begin('run-1', first);
    runs.begin('run-2', second);
    expect(runs.reserve()).toBeUndefined();
    runs.end('run-1');
    const third = runs.reserve();
    expect(third).toBeDefined();
    expect(runs.reserve()).toBeUndefined();
  });

  it('a released reservation (its run was never stored) frees its slot once', () => {
    const runs = new LiveRuns(LIVE_RUN_RETENTION_MS, LIVE_RUN_MAX_EVENTS, 1);
    const slot = runs.reserve()!;
    slot.release();
    slot.release();
    const next = runs.reserve();
    expect(next).toBeDefined();
    expect(runs.reserve()).toBeUndefined();
  });

  it('a run begun without a slot holds none; a claimed slot is never refused and still counts', () => {
    const runs = new LiveRuns(LIVE_RUN_RETENTION_MS, LIVE_RUN_MAX_EVENTS, 1);
    runs.begin('free');
    const held = runs.reserve()!;
    runs.begin('held', held);
    // A resume (138) claims a slot over the cap.
    runs.begin('resumed', runs.claim());
    runs.end('held');
    expect(runs.reserve()).toBeUndefined();
    runs.end('resumed');
    expect(runs.reserve()).toBeDefined();
  });
});

describe('runIdleLimitMs (WORKFLOW_RUN_IDLE_MINUTES)', () => {
  it('is 15 minutes by default; a number above 0 overrides it; 0 turns the watchdog off', () => {
    expect(RUN_IDLE_MINUTES_DEFAULT).toBe(15);
    expect(runIdleLimitMs(undefined)).toBe(15 * 60_000);
    expect(runIdleLimitMs('')).toBe(15 * 60_000);
    expect(runIdleLimitMs('5')).toBe(5 * 60_000);
    expect(runIdleLimitMs(' 0.5 ')).toBe(30_000);
    expect(runIdleLimitMs('0')).toBe(0);
    for (const bad of ['-2', 'many', 'Infinity', '1e999']) {
      expect(runIdleLimitMs(bad)).toBe(15 * 60_000);
    }
  });

  it('caps a limit above what a timer can hold (2^31-1 ms) at RUN_IDLE_MINUTES_MAX whole minutes', () => {
    expect(RUN_IDLE_MINUTES_MAX).toBe(35_791);
    expect(RUN_IDLE_MINUTES_MAX * 60_000).toBeLessThanOrEqual(2 ** 31 - 1);
    expect(runIdleLimitMs('40000')).toBe(RUN_IDLE_MINUTES_MAX * 60_000);
    expect(runIdleLimitMs('1e12')).toBe(RUN_IDLE_MINUTES_MAX * 60_000);
    expect(runIdleLimitMs('35791')).toBe(35_791 * 60_000);
    expect(runStalledMessage(runIdleLimitMs('40000'))).toBe(
      'The run made no progress for 35791 minutes and was stopped',
    );
  });

  it('names the limit in minutes in the stalled run error', () => {
    expect(runStalledMessage(15 * 60_000)).toBe(
      'The run made no progress for 15 minutes and was stopped',
    );
    expect(runStalledMessage(60_000)).toBe(
      'The run made no progress for 1 minute and was stopped',
    );
  });
});

describe('IdleWatchdog (a run that makes no progress is ended)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fires once after the limit with no touch; a touch resets the clock; stop clears it', () => {
    const fired = jest.fn();
    const dog = new IdleWatchdog(15 * 60_000, fired);
    jest.advanceTimersByTime(14 * 60_000);
    dog.touch();
    jest.advanceTimersByTime(14 * 60_000);
    expect(fired).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    expect(fired).toHaveBeenCalledTimes(1);
    dog.touch();
    jest.advanceTimersByTime(60 * 60_000);
    expect(fired).toHaveBeenCalledTimes(1);

    const quiet = jest.fn();
    const stopped = new IdleWatchdog(1_000, quiet);
    stopped.stop();
    stopped.touch();
    jest.advanceTimersByTime(5_000);
    expect(quiet).not.toHaveBeenCalled();
  });

  it('a limit above what a timer can hold does not fire at once', () => {
    const fired = jest.fn();
    new IdleWatchdog(40_000 * 60_000, fired);
    jest.advanceTimersByTime(60 * 60_000);
    expect(fired).not.toHaveBeenCalled();
  });

  it('a limit of 0 never fires', () => {
    const fired = jest.fn();
    new IdleWatchdog(0, fired).touch();
    jest.advanceTimersByTime(24 * 60 * 60_000);
    expect(fired).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('liveRunCap (WORKFLOW_MAX_LIVE_RUNS)', () => {
  it('is 8 by default, a whole number of at least 1 otherwise', () => {
    expect(MAX_LIVE_RUNS_DEFAULT).toBe(8);
    expect(liveRunCap(undefined)).toBe(8);
    expect(liveRunCap('')).toBe(8);
    expect(liveRunCap('3')).toBe(3);
    expect(liveRunCap(' 12 ')).toBe(12);
    for (const bad of ['0', '-2', '2.5', 'many', '1e3']) {
      expect(liveRunCap(bad)).toBe(8);
    }
  });
});

describe('RunCheckpoint (data-model 3.16: progress stored as it happens)', () => {
  /** A write that waits until the test lets it land. */
  function gatedWrites() {
    const landed: string[] = [];
    const gates: (() => void)[] = [];
    const write = jest.fn(
      (patch: { steps: string }) =>
        new Promise<void>((resolve) => {
          gates.push(() => {
            landed.push(patch.steps);
            resolve();
          });
        }),
    );
    const open = async () => {
      gates.shift()?.();
      await flush();
    };
    return { write, landed, open };
  }
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };

  it('keeps one write in flight; a newer state replaces the queued one; saving never waits', async () => {
    const { write, landed, open } = gatedWrites();
    const checkpoint = new RunCheckpoint(write, jest.fn());
    checkpoint.save({ steps: 'a' });
    checkpoint.save({ steps: 'b' });
    checkpoint.save({ steps: 'c' });
    expect(write).toHaveBeenCalledTimes(1);
    await open();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith({ steps: 'c' });
    await open();
    expect(landed).toEqual(['a', 'c']);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('a failed write is reported and the next state is still written', async () => {
    const failed = jest.fn();
    const write = jest
      .fn<Promise<unknown>, [{ steps: string }]>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined);
    const checkpoint = new RunCheckpoint(write, failed);
    checkpoint.save({ steps: 'a' });
    checkpoint.save({ steps: 'b' });
    await flush();
    await checkpoint.close();
    expect(failed).toHaveBeenCalledWith(expect.any(Error));
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('close drops the queued state, waits for the write in flight, and ignores later saves', async () => {
    const { write, landed, open } = gatedWrites();
    const checkpoint = new RunCheckpoint(write, jest.fn());
    checkpoint.save({ steps: 'a' });
    checkpoint.save({ steps: 'b' });
    let closed = false;
    const closing = checkpoint.close().then(() => (closed = true));
    await flush();
    expect(closed).toBe(false);
    await open();
    await closing;
    expect(closed).toBe(true);
    checkpoint.save({ steps: 'c' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(landed).toEqual(['a']);
  });
});

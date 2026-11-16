import {
  LIVE_RUN_RETENTION_MS,
  LiveRuns,
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

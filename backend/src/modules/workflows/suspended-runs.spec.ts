import { SUSPENDED_RUN_TTL_MS, SuspendedRuns } from './suspended-runs';

describe('SuspendedRuns (api.md 138, ADR-0043)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-12T10:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds a waiting run for 30 minutes', () => {
    expect(SUSPENDED_RUN_TTL_MS).toBe(30 * 60 * 1000);
    const runs = new SuspendedRuns<string>(() => Promise.resolve());
    const expiresAt = runs.add('run-1', 'turn');
    expect(new Date(expiresAt).toISOString()).toBe('2026-11-12T10:30:00.000Z');
    expect(runs.has('run-1')).toBe(true);
    expect(runs.ids()).toEqual(['run-1']);
  });

  it('hands a run out once to resume it, before it expires', () => {
    const onExpire = jest.fn(() => Promise.resolve());
    const runs = new SuspendedRuns<string>(onExpire);
    runs.add('run-1', 'turn');
    jest.advanceTimersByTime(29 * 60 * 1000);
    expect(runs.take('run-1')).toEqual({ expired: false, value: 'turn' });
    // Taken: a second resume finds nothing, and it never expires.
    expect(runs.take('run-1')).toBeUndefined();
    jest.advanceTimersByTime(60 * 60 * 1000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('expires a run nobody resumed after 30 minutes: onExpire gets it and it is no longer held', () => {
    const onExpire = jest.fn(() => Promise.resolve());
    const runs = new SuspendedRuns<string>(onExpire);
    runs.add('run-1', 'turn');
    jest.advanceTimersByTime(SUSPENDED_RUN_TTL_MS - 1);
    expect(onExpire).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledWith('run-1', 'turn');
    expect(runs.has('run-1')).toBe(false);
    expect(runs.take('run-1')).toBeUndefined();
  });

  it('answers a run whose time ran out but whose timer has not fired yet as expired', () => {
    const now = { at: 0 };
    const onExpire = jest.fn(() => Promise.resolve());
    const runs = new SuspendedRuns<string>(onExpire, 1000, () => now.at);
    runs.add('run-1', 'turn');
    now.at = 1000;
    expect(runs.has('run-1')).toBe(false);
    expect(runs.take('run-1')).toEqual({ expired: true, value: 'turn' });
    // The caller expires it: the timer no longer does.
    jest.advanceTimersByTime(5000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('restarts the clock when a resumed run waits again, and forgets a removed run', () => {
    const onExpire = jest.fn(() => Promise.resolve());
    const runs = new SuspendedRuns<string>(onExpire);
    runs.add('run-1', 'first');
    jest.advanceTimersByTime(20 * 60 * 1000);
    runs.add('run-1', 'second');
    jest.advanceTimersByTime(20 * 60 * 1000);
    expect(onExpire).not.toHaveBeenCalled();
    expect(runs.remove('run-1')).toBe('second');
    jest.advanceTimersByTime(SUSPENDED_RUN_TTL_MS);
    expect(onExpire).not.toHaveBeenCalled();
    expect(runs.remove('run-1')).toBeUndefined();
  });
});

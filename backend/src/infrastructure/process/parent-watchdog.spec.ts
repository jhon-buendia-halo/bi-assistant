import {
  isProcessAlive,
  parseParentPid,
  watchParentProcess,
} from './parent-watchdog';

describe('parent watchdog (api.md 4.3 Orphan exit)', () => {
  afterEach(() => jest.useRealTimers());

  it('calls onParentGone once, on the first check after the parent dies', () => {
    jest.useFakeTimers();
    let alive = true;
    const onParentGone = jest.fn();
    watchParentProcess(1234, {
      intervalMs: 2000,
      isAlive: () => alive,
      onParentGone,
    });

    jest.advanceTimersByTime(6000);
    expect(onParentGone).not.toHaveBeenCalled();

    alive = false;
    jest.advanceTimersByTime(2000);
    expect(onParentGone).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(10000);
    expect(onParentGone).toHaveBeenCalledTimes(1);
  });

  it('stops checking once stopped', () => {
    jest.useFakeTimers();
    const isAlive = jest.fn(() => false);
    const onParentGone = jest.fn();
    const stop = watchParentProcess(1234, { isAlive, onParentGone });
    stop();
    jest.advanceTimersByTime(10000);
    expect(isAlive).not.toHaveBeenCalled();
    expect(onParentGone).not.toHaveBeenCalled();
  });

  it('treats its own process as alive and an unused PID as gone', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2 ** 30)).toBe(false);
  });

  it.each([
    ['4321', 4321],
    [' 77 ', 77],
    [undefined, null],
    ['', null],
    ['0', null],
    ['-5', null],
    ['12abc', null],
  ])('parses DESKTOP_PARENT_PID %p as %p', (value, expected) => {
    expect(parseParentPid(value)).toBe(expected);
  });
});

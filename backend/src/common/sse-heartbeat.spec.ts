import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { SSE_HEARTBEAT_MS, startSseHeartbeat } from './sse-heartbeat';

class FakeRes extends EventEmitter {
  writableEnded = false;
  destroyed = false;
  written: string[] = [];
  flush = jest.fn();
  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }
}

describe('startSseHeartbeat', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('writes a ": ping" comment frame every 15 s and flushes it', () => {
    const res = new FakeRes();
    startSseHeartbeat(res as unknown as Response);
    jest.advanceTimersByTime(SSE_HEARTBEAT_MS - 1);
    expect(res.written).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(res.written).toEqual([': ping\n\n']);
    jest.advanceTimersByTime(SSE_HEARTBEAT_MS);
    expect(res.written).toHaveLength(2);
    expect(res.flush).toHaveBeenCalledTimes(2);
    expect(SSE_HEARTBEAT_MS).toBe(15_000);
  });

  it('stops when the client closes', () => {
    const res = new FakeRes();
    startSseHeartbeat(res as unknown as Response);
    res.emit('close');
    jest.advanceTimersByTime(SSE_HEARTBEAT_MS * 3);
    expect(res.written).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('writes nothing once the response ended, and clears its timer', () => {
    const res = new FakeRes();
    startSseHeartbeat(res as unknown as Response);
    res.writableEnded = true;
    jest.advanceTimersByTime(SSE_HEARTBEAT_MS * 2);
    expect(res.written).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('can be stopped by hand', () => {
    const res = new FakeRes();
    const stop = startSseHeartbeat(res as unknown as Response);
    stop();
    expect(jest.getTimerCount()).toBe(0);
  });
});
